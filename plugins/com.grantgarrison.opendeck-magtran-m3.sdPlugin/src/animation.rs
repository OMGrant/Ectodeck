//! Animated backgrounds. A source renders frames on its own thread and keeps
//! the newest one; the frame loop in `frame` takes it, composites the keys on
//! top and sends it to the deck.
//!
//! Two sources:
//!
//! - `Web`: any page, rendered by a headless Chrome or Chromium at the panel's
//!   size and streamed back with the DevTools protocol's screencast. Chrome is
//!   driven over a private pipe (`--remote-debugging-pipe`), so nothing
//!   listens on the network, and it exits by itself if the plugin dies.
//! - `Shader`: a Shadertoy-format fragment shader, rendered natively on the
//!   GPU (see `shader`).

use image::RgbImage;
use std::{
    io::{BufRead, BufReader, Write},
    os::fd::{FromRawFd, RawFd},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use crate::background::{PANEL_HEIGHT, PANEL_WIDTH};

/// Frames per second. The deck shows more, but 30 is indistinguishable from
/// 60 on it and costs half as much.
pub const FPS: u32 = 30;

pub type Params = serde_json::Map<String, serde_json::Value>;

#[derive(Clone, Debug, PartialEq)]
pub enum Source {
    Web { url: String, params: Params },
    Shader { code: String, params: Params },
}

impl Source {
    /// Whether `other` is the same animation, perhaps with other parameters,
    /// so it can be adjusted in place rather than restarted.
    pub fn same_program(&self, other: &Source) -> bool {
        match (self, other) {
            (Source::Web { url: a, .. }, Source::Web { url: b, .. }) => a == b,
            (Source::Shader { code: a, .. }, Source::Shader { code: b, .. }) => a == b,
            _ => false,
        }
    }

    pub fn params(&self) -> &Params {
        match self {
            Source::Web { params, .. } | Source::Shader { params, .. } => params,
        }
    }
}

/// A web background's address with its parameters in the query string:
/// numbers as they are, booleans as 1 or 0, colours and points as
/// comma-separated components.
pub fn web_address(url: &str, params: &Params) -> String {
    if params.is_empty() {
        return url.to_string();
    }
    let query: Vec<String> = params
        .iter()
        .map(|(k, v)| {
            let value = match v {
                serde_json::Value::Bool(b) => (*b as u8).to_string(),
                serde_json::Value::Array(a) => a.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(","),
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            format!("{}={}", encode(k), encode(&value))
        })
        .collect();
    format!("{url}{}{}", if url.contains('?') { '&' } else { '?' }, query.join("&"))
}

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b',' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Something done on the deck that a background can react to.
#[derive(Clone, Copy, Debug)]
pub enum Input {
    /// A key pressed or released; centre in panel pixels, top-left origin.
    Key { index: u8, down: bool, x: f32, y: f32 },
    /// A dial turned by some detents.
    Dial { index: u8, ticks: i16 },
}

/// The deck's controls as the shader thread reads them.
#[derive(Default)]
struct Interaction {
    mouse: [f32; 4],
    pressed_at: Vec<(f32, f32, Instant, f32)>,
    dials: [f32; 3],
}

impl Interaction {
    fn snapshot(&self) -> crate::shader::Interaction {
        crate::shader::Interaction {
            mouse: self.mouse,
            presses: self.pressed_at.iter().map(|&(x, y, at, key)| (x, y, at.elapsed().as_secs_f32(), key)).collect(),
            dials: self.dials,
        }
    }
}

pub struct Animation {
    params: Arc<Mutex<Params>>,
    interaction: Arc<Mutex<Interaction>>,
    latest: Arc<Mutex<Option<RgbImage>>>,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    chrome: Arc<Mutex<Option<ChromeHandle>>>,
    thread: Option<JoinHandle<()>>,
}

impl Animation {
    pub fn start(source: Source) -> Animation {
        let params = Arc::new(Mutex::new(source.params().clone()));
        let interaction = Arc::new(Mutex::new(Interaction::default()));
        let latest = Arc::new(Mutex::new(None));
        let stop = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(AtomicBool::new(false));
        let chrome = Arc::new(Mutex::new(None));
        let (l, s, p, c) = (latest.clone(), stop.clone(), paused.clone(), chrome.clone());
        let (pr, ia) = (params.clone(), interaction.clone());
        let thread = std::thread::Builder::new()
            .name("animation".into())
            .spawn(move || {
                match source {
                    Source::Shader { code, .. } => {
                        if let Err(e) = run_shader(&code, &pr, &ia, &l, &s, &p) {
                            log::error!("Shader background stopped: {e}");
                        }
                    }
                    // Chrome can exit under us (a crash, an update replacing
                    // its files); start it again, backing off if it keeps
                    // failing
                    Source::Web { url, params } => {
                        let url = web_address(&url, &params);
                        let mut delay = Duration::from_secs(2);
                        while !s.load(Ordering::SeqCst) {
                            let started = Instant::now();
                            if let Err(e) = run_web(&url, &l, &s, &p, &c) {
                                log::error!("Web background stopped: {e}");
                            }
                            if let Ok(mut chrome) = c.lock() {
                                if let Some(h) = chrome.take() {
                                    h.kill();
                                }
                            }
                            if s.load(Ordering::SeqCst) {
                                break;
                            }
                            if started.elapsed() > Duration::from_secs(60) {
                                delay = Duration::from_secs(2);
                            }
                            std::thread::sleep(delay);
                            delay = (delay * 2).min(Duration::from_secs(60));
                        }
                    }
                }
            })
            .ok();
        Animation { params, interaction, latest, stop, paused, chrome, thread }
    }

    /// Adjust the parameters of the running animation. A shader picks them up
    /// on its next frame; a web page is reloaded with them in its address.
    pub fn set_params(&self, source: &Source) {
        if let Ok(mut p) = self.params.lock() {
            *p = source.params().clone();
        }
        if let Source::Web { url, params } = source {
            if let Ok(mut chrome) = self.chrome.lock() {
                if let Some(c) = chrome.as_mut() {
                    let _ = c.send("Page.navigate", serde_json::json!({ "url": web_address(url, params) }), true);
                }
            }
        }
    }

    /// Tell the background about a key or dial.
    pub fn input(&self, input: Input) {
        if let Ok(mut ia) = self.interaction.lock() {
            match input {
                Input::Key { index, down, x, y } => {
                    // Shadertoy measures from the bottom left
                    let gy = PANEL_HEIGHT as f32 - y;
                    if down {
                        ia.mouse = [x, gy, x, gy];
                        ia.pressed_at.insert(0, (x, gy, Instant::now(), index as f32));
                        ia.pressed_at.truncate(8);
                    } else {
                        ia.mouse[2] = -ia.mouse[2].abs();
                        ia.mouse[3] = -ia.mouse[3].abs();
                    }
                }
                Input::Dial { index, ticks } => {
                    if let Some(d) = ia.dials.get_mut(index as usize) {
                        *d += ticks as f32;
                    }
                }
            }
        }
        if let Ok(mut chrome) = self.chrome.lock() {
            if let Some(c) = chrome.as_mut() {
                let _ = c.deliver(input);
            }
        }
    }

    /// The newest frame, if one has been rendered yet.
    pub fn latest(&self) -> Option<RgbImage> {
        self.latest.lock().ok().and_then(|f| f.clone())
    }

    /// Stop rendering while the deck is asleep, and resume after.
    pub fn set_paused(&self, paused: bool) {
        if self.paused.swap(paused, Ordering::SeqCst) == paused {
            return;
        }
        if let Ok(mut chrome) = self.chrome.lock() {
            if let Some(c) = chrome.as_mut() {
                let _ = if paused { c.stop_screencast() } else { c.start_screencast() };
            }
        }
    }
}

impl Drop for Animation {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // killing Chrome ends the web thread's blocking read
        if let Ok(mut chrome) = self.chrome.lock() {
            if let Some(c) = chrome.take() {
                c.kill();
            }
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn run_shader(
    code: &str,
    params: &Mutex<Params>,
    interaction: &Mutex<Interaction>,
    latest: &Mutex<Option<RgbImage>>,
    stop: &AtomicBool,
    paused: &AtomicBool,
) -> Result<(), String> {
    let mut renderer = crate::shader::ShaderRenderer::new(code, PANEL_WIDTH, PANEL_HEIGHT)?;
    log::info!("Shader background running");
    let period = Duration::from_secs_f64(1.0 / FPS as f64);
    let mut clock = 0.0f32;
    let mut last = Instant::now();
    while !stop.load(Ordering::SeqCst) {
        let now = Instant::now();
        if paused.load(Ordering::SeqCst) {
            last = now;
            std::thread::sleep(Duration::from_millis(100));
            continue;
        }
        clock += (now - last).as_secs_f32();
        last = now;
        let values = params.lock().map(|p| p.clone()).unwrap_or_default();
        let controls = interaction.lock().map(|i| i.snapshot()).unwrap_or_default();
        let frame = renderer.render(clock, &values, &controls);
        if let Ok(mut l) = latest.lock() {
            *l = Some(frame);
        }
        let spent = now.elapsed();
        if spent < period {
            std::thread::sleep(period - spent);
        }
    }
    Ok(())
}

/// A headless Chrome and the pipe that drives it.
pub struct ChromeHandle {
    child: Child,
    writer: std::fs::File,
    session: String,
    next_id: u64,
}

impl ChromeHandle {
    fn send(&mut self, method: &str, params: serde_json::Value, session: bool) -> std::io::Result<u64> {
        self.next_id += 1;
        let mut msg = serde_json::json!({ "id": self.next_id, "method": method, "params": params });
        if session {
            msg["sessionId"] = serde_json::Value::String(self.session.clone());
        }
        let mut bytes = serde_json::to_vec(&msg).unwrap_or_default();
        bytes.push(0);
        self.writer.write_all(&bytes)?;
        Ok(self.next_id)
    }

    fn start_screencast(&mut self) -> std::io::Result<u64> {
        // the page runs at 60; every second frame gives the 30 we send
        self.send(
            "Page.startScreencast",
            serde_json::json!({ "format": "jpeg", "quality": 85, "maxWidth": PANEL_WIDTH, "maxHeight": PANEL_HEIGHT, "everyNthFrame": 60 / FPS }),
            true,
        )
    }

    /// Pass a key or dial to the page: a real click at the key for pages
    /// that react to the pointer, and an `ectodeck:press` or `ectodeck:dial`
    /// event for pages written to react to the deck.
    fn deliver(&mut self, input: Input) -> std::io::Result<()> {
        let script = match input {
            Input::Key { index, down, x, y } => {
                let kind = if down { "mousePressed" } else { "mouseReleased" };
                self.send("Input.dispatchMouseEvent", serde_json::json!({ "type": kind, "x": x, "y": y, "button": "left", "clickCount": 1 }), true)?;
                format!(
                    "window.dispatchEvent(new CustomEvent('ectodeck:press', {{ detail: {{ key: {index}, down: {down}, x: {}, y: {} }} }}))",
                    x / PANEL_WIDTH as f32,
                    y / PANEL_HEIGHT as f32
                )
            }
            Input::Dial { index, ticks } => {
                format!("window.dispatchEvent(new CustomEvent('ectodeck:dial', {{ detail: {{ dial: {index}, ticks: {ticks} }} }}))")
            }
        };
        self.send("Runtime.evaluate", serde_json::json!({ "expression": script }), true)?;
        Ok(())
    }

    fn stop_screencast(&mut self) -> std::io::Result<u64> {
        self.send("Page.stopScreencast", serde_json::json!({}), true)
    }

    fn kill(mut self) {
        let pid = self.child.id() as i32;
        // Chrome runs in its own process group (see spawn); end all of it
        unsafe {
            libc::killpg(pid, libc::SIGTERM);
        }
        let _ = self.child.wait();
    }
}

/// Chrome or Chromium, from ECTODECK_CHROME or the usual names on PATH.
fn find_chrome() -> Option<String> {
    if let Ok(p) = std::env::var("ECTODECK_CHROME") {
        return Some(p);
    }
    let path = std::env::var("PATH").unwrap_or_default();
    for name in ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave-browser", "microsoft-edge"] {
        for dir in path.split(':') {
            let candidate = std::path::Path::new(dir).join(name);
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}

fn pipe() -> std::io::Result<(RawFd, RawFd)> {
    let mut fds = [0; 2];
    if unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok((fds[0], fds[1]))
}

fn run_web(
    url: &str,
    latest: &Mutex<Option<RgbImage>>,
    stop: &AtomicBool,
    paused: &AtomicBool,
    slot: &Mutex<Option<ChromeHandle>>,
) -> Result<(), String> {
    use std::os::unix::process::CommandExt;

    let chrome = find_chrome().ok_or("no Chrome or Chromium found; install one or set ECTODECK_CHROME")?;
    let profile = std::env::var_os("XDG_CACHE_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".cache")))
        .ok_or("no cache directory")?
        .join("ectodeck-chrome");

    // Chrome reads commands on fd 3 and writes replies on fd 4
    let (to_chrome_r, to_chrome_w) = pipe().map_err(|e| e.to_string())?;
    let (from_chrome_r, from_chrome_w) = pipe().map_err(|e| e.to_string())?;
    let mut command = Command::new(&chrome);
    command
        .args([
            "--headless=new",
            "--remote-debugging-pipe",
            "--no-first-run",
            "--no-default-browser-check",
            "--mute-audio",
            "--hide-scrollbars",
            "--disable-extensions",
            // without these Chrome renders WebGL in software, on every core
            "--enable-gpu",
            "--ignore-gpu-blocklist",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--disable-backgrounding-occluded-windows",
            "--autoplay-policy=no-user-gesture-required",
        ])
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg(format!("--window-size={PANEL_WIDTH},{PANEL_HEIGHT}"))
        .arg("about:blank")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    unsafe {
        command.pre_exec(move || {
            // Move both ends clear of 3 and 4 first: a pipe end that already
            // is fd 3 or 4 would otherwise be overwritten, or keep its
            // close-on-exec flag through a no-op dup2.
            let r = libc::fcntl(to_chrome_r, libc::F_DUPFD, 10);
            let w = libc::fcntl(from_chrome_w, libc::F_DUPFD, 10);
            if r < 0 || w < 0 || libc::dup2(r, 3) < 0 || libc::dup2(w, 4) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            libc::setsid();
            Ok(())
        });
    }
    let child = command.spawn().map_err(|e| format!("could not start {chrome}: {e}"))?;
    unsafe {
        libc::close(to_chrome_r);
        libc::close(from_chrome_w);
    }
    let writer = unsafe { std::fs::File::from_raw_fd(to_chrome_w) };
    let mut reader = BufReader::new(unsafe { std::fs::File::from_raw_fd(from_chrome_r) });

    let mut handle = ChromeHandle { child, writer, session: String::new(), next_id: 0 };
    let mut read = move || -> Result<serde_json::Value, String> {
        let mut buf = Vec::new();
        let n = reader.read_until(0, &mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("Chrome closed the pipe".into());
        }
        buf.pop();
        serde_json::from_slice(&buf).map_err(|e| e.to_string())
    };
    let wait_for = |id: u64, read: &mut dyn FnMut() -> Result<serde_json::Value, String>| -> Result<serde_json::Value, String> {
        loop {
            let m = read()?;
            if m.get("id").and_then(|v| v.as_u64()) == Some(id) {
                if let Some(e) = m.get("error") {
                    return Err(format!("Chrome refused a command: {e}"));
                }
                return Ok(m["result"].clone());
            }
        }
    };

    let id = handle.send("Target.createTarget", serde_json::json!({ "url": "about:blank" }), false).map_err(|e| e.to_string())?;
    let target = wait_for(id, &mut read)?["targetId"].as_str().unwrap_or_default().to_string();
    let id = handle.send("Target.attachToTarget", serde_json::json!({ "targetId": target, "flatten": true }), false).map_err(|e| e.to_string())?;
    handle.session = wait_for(id, &mut read)?["sessionId"].as_str().unwrap_or_default().to_string();
    let id = handle
        .send("Emulation.setDeviceMetricsOverride", serde_json::json!({ "width": PANEL_WIDTH, "height": PANEL_HEIGHT, "deviceScaleFactor": 1, "mobile": false }), true)
        .map_err(|e| e.to_string())?;
    wait_for(id, &mut read)?;
    let id = handle.send("Page.enable", serde_json::json!({}), true).map_err(|e| e.to_string())?;
    wait_for(id, &mut read)?;
    let id = handle.send("Page.navigate", serde_json::json!({ "url": url }), true).map_err(|e| e.to_string())?;
    wait_for(id, &mut read)?;
    // A screencast started before the page has loaded is cancelled by the
    // load and never delivers a frame, so wait for it.
    loop {
        let m = read()?;
        if m.get("method").and_then(|v| v.as_str()) == Some("Page.loadEventFired") {
            break;
        }
    }
    let id = handle.send("Page.bringToFront", serde_json::json!({}), true).map_err(|e| e.to_string())?;
    wait_for(id, &mut read)?;
    if !paused.load(Ordering::SeqCst) {
        handle.start_screencast().map_err(|e| e.to_string())?;
    }
    log::info!("Web background running: {url}");

    // hand the pipe to the owner so it can pause, resume and stop Chrome
    let session = handle.session.clone();
    let ack_writer = handle.writer.try_clone().map_err(|e| e.to_string())?;
    *slot.lock().map_err(|_| "lock poisoned")? = Some(handle);
    let mut ack_writer = ack_writer;
    let mut ack_id = 1_000_000u64;

    while !stop.load(Ordering::SeqCst) {
        let m = read()?;
        let method = m.get("method").and_then(|v| v.as_str());
        if method == Some("Page.loadEventFired") {
            // a reload (new parameters) ends the screencast; start it again
            if !paused.load(Ordering::SeqCst) {
                if let Ok(mut chrome) = slot.lock() {
                    if let Some(c) = chrome.as_mut() {
                        let _ = c.start_screencast();
                    }
                }
            }
            continue;
        }
        if method != Some("Page.screencastFrame") {
            continue;
        }
        let p = &m["params"];
        // acknowledge first so Chrome keeps the next frame coming
        ack_id += 1;
        let ack = serde_json::json!({ "id": ack_id, "sessionId": session, "method": "Page.screencastFrameAck", "params": { "sessionId": p["sessionId"] } });
        let mut bytes = serde_json::to_vec(&ack).unwrap_or_default();
        bytes.push(0);
        let _ = ack_writer.write_all(&bytes);

        use base64::Engine;
        let Some(data) = p["data"].as_str().and_then(|d| base64::engine::general_purpose::STANDARD.decode(d).ok()) else { continue };
        let Ok(img) = image::load_from_memory(&data) else { continue };
        let mut frame = img.to_rgb8();
        if frame.dimensions() != (PANEL_WIDTH, PANEL_HEIGHT) {
            frame = image::imageops::resize(&frame, PANEL_WIDTH, PANEL_HEIGHT, image::imageops::FilterType::Triangle);
        }
        if let Ok(mut l) = latest.lock() {
            *l = Some(frame);
        }
    }
    Ok(())
}
