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
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use crate::background::{PANEL_HEIGHT, PANEL_WIDTH};

/// Frames per second unless the background's settings choose another rate
/// with a reserved `fps` value: 15, 30, 45 or 60.
pub const FPS: u32 = 30;

pub fn fps_of(params: &Params) -> u32 {
    match params.get("fps").and_then(|v| v.as_f64()).map(|f| f.round() as u32) {
        Some(f @ (15 | 30 | 45 | 60)) => f,
        _ => FPS,
    }
}

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
    // the query goes before any #fragment
    let (base, fragment) = match url.split_once('#') {
        Some((b, f)) => (b, format!("#{f}")),
        None => (url, String::new()),
    };
    format!("{base}{}{}{fragment}", if base.contains('?') { '&' } else { '?' }, query.join("&"))
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
}

/// The deck's controls as the shader thread reads them.
#[derive(Default)]
struct Interaction {
    mouse: [f32; 4],
    pressed_at: Vec<(f32, f32, Instant, f32)>,
}

impl Interaction {
    fn snapshot(&self) -> crate::shader::Interaction {
        crate::shader::Interaction {
            mouse: self.mouse,
            presses: self.pressed_at.iter().map(|&(x, y, at, key)| (x, y, at.elapsed().as_secs_f32(), key)).collect(),
            ..Default::default()
        }
    }
}

pub struct Animation {
    /// frames a second, read by the render thread and the deck's frame loop
    pub fps: Arc<AtomicU32>,
    params: Arc<Mutex<Params>>,
    interaction: Arc<Mutex<Interaction>>,
    latest: Arc<Mutex<FrameSlot>>,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    chrome: Arc<Mutex<Option<ChromeHandle>>>,
    thread: Option<JoinHandle<()>>,
}

impl Animation {
    pub fn start(source: Source) -> Animation {
        let fps = Arc::new(AtomicU32::new(fps_of(source.params())));
        let params = Arc::new(Mutex::new(source.params().clone()));
        let interaction = Arc::new(Mutex::new(Interaction::default()));
        let latest = Arc::new(Mutex::new(FrameSlot::default()));
        let stop = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(AtomicBool::new(false));
        let chrome = Arc::new(Mutex::new(None));
        let (l, s, p, c) = (latest.clone(), stop.clone(), paused.clone(), chrome.clone());
        let (pr, ia, rate) = (params.clone(), interaction.clone(), fps.clone());
        let thread = std::thread::Builder::new()
            .name("animation".into())
            .spawn(move || {
                match source {
                    Source::Shader { code, .. } => {
                        if let Err(e) = run_shader(&code, &pr, &ia, &l, &s, &p, &rate) {
                            log::error!("Shader background stopped: {e}");
                        }
                    }
                    // Chrome can exit under us (a crash, an update replacing
                    // its files); start it again, backing off if it keeps
                    // failing
                    Source::Web { url, .. } => {
                        // a page that dances to music gets the sound as events,
                        // sent from a thread of their own while the page runs
                        if crate::audio::wanted_by_page(&url) {
                            let (s2, p2, c2) = (s.clone(), p.clone(), c.clone());
                            let _ = std::thread::Builder::new().name("audio-events".into()).spawn(move || feed_page_audio(&s2, &p2, &c2));
                        }
                        let mut delay = Duration::from_secs(2);
                        while !s.load(Ordering::SeqCst) {
                            let started = Instant::now();
                            // with the settings as they are now, if Chrome has to start again
                            let now = web_address(&url, &pr.lock().map(|p| p.clone()).unwrap_or_default());
                            if let Err(e) = run_web(&now, &l, &s, &p, &c, &rate) {
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
        Animation { fps, params, interaction, latest, stop, paused, chrome, thread }
    }

    /// Adjust the parameters of the running animation. A shader picks them up
    /// on its next frame; a web page is reloaded with them in its address.
    pub fn set_params(&self, source: &Source) {
        if let Ok(mut p) = self.params.lock() {
            *p = source.params().clone();
        }
        let fps = fps_of(source.params());
        if self.fps.swap(fps, Ordering::SeqCst) != fps {
            // the page's frames come at a rate set when the screencast starts
            if let Ok(mut chrome) = self.chrome.lock() {
                if let Some(c) = chrome.as_mut() {
                    c.fps = fps;
                    let _ = c.stop_screencast();
                    let _ = c.start_screencast();
                }
            }
        }
        if let Source::Web { url, params } = source {
            if let Ok(mut chrome) = self.chrome.lock() {
                if let Some(c) = chrome.as_mut() {
                    // A page that listens for ectodeck:params takes new settings in
                    // place, so a scene keeps running; any other page reloads with
                    // them in its address.
                    if crate::audio::page_mentions(url, "ectodeck:params") {
                        let script = format!(
                            "history.replaceState(null, '', {}); window.dispatchEvent(new CustomEvent('ectodeck:params', {{ detail: {} }}))",
                            serde_json::Value::String(web_address(url, params)),
                            serde_json::Value::Object(params.clone())
                        );
                        let _ = c.send("Runtime.evaluate", serde_json::json!({ "expression": script }), true);
                    } else {
                        let _ = c.send("Page.navigate", serde_json::json!({ "url": web_address(url, params) }), true);
                    }
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
		self.latest.lock().ok().and_then(|mut f| f.get())
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
    latest: &Mutex<FrameSlot>,
    stop: &AtomicBool,
    paused: &AtomicBool,
    fps: &AtomicU32,
) -> Result<(), String> {
    let mut renderer = crate::shader::ShaderRenderer::new(code, PANEL_WIDTH, PANEL_HEIGHT)?;
    log::info!("Shader background running");
    let mut tap = if crate::audio::wanted_by_shader(code) { crate::audio::AudioTap::start() } else { None };
    // a shader with a place gets the weather there, kept up to date on a thread of its own
    let place_input = renderer.place_input().map(str::to_owned);
    let feed = place_input.as_ref().map(|_| crate::weather::Feed::start());
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
        let mut controls = interaction.lock().map(|i| i.snapshot()).unwrap_or_default();
        if let Some(t) = tap.as_mut() {
            let sound = t.frame();
            controls.audio_bands = sound.bands;
            controls.audio_level = sound.level;
        }
        let place = place_input.as_deref().and_then(|name| crate::weather::place_in(&values, name));
        if let Some(f) = &feed {
            f.set_place(place);
        }
        let world = crate::shader::World::now(place, feed.as_ref().and_then(|f| f.report()));
        let frame = renderer.render(clock, &values, &controls, &world);
        if let Ok(mut l) = latest.lock() {
            l.set_now(frame);
        }
        let period = Duration::from_secs_f64(1.0 / fps.load(Ordering::SeqCst) as f64);
        let spent = now.elapsed();
        if spent < period {
            std::thread::sleep(period - spent);
        }
    }
    Ok(())
}

/// Sends the sound to a web background each frame as an `ectodeck:audio` event.
fn feed_page_audio(stop: &AtomicBool, paused: &AtomicBool, chrome: &Mutex<Option<ChromeHandle>>) {
    let Some(mut tap) = crate::audio::AudioTap::start() else { return };
    let period = Duration::from_secs_f64(1.0 / FPS as f64);
    while !stop.load(Ordering::SeqCst) {
        let started = Instant::now();
        if !paused.load(Ordering::SeqCst) {
            let sound = tap.frame();
            let script = format!(
                "window.dispatchEvent(new CustomEvent('ectodeck:audio', {{ detail: {{ bands: {:?}, level: {}, wave: {:?}, hits: {:?} }} }}))",
                sound.bands.map(|b| (b * 1000.0).round() / 1000.0),
                (sound.level * 1000.0).round() / 1000.0,
                sound.wave,
                sound.hits
            );
            if let Ok(mut c) = chrome.lock() {
                if let Some(c) = c.as_mut() {
                    let _ = c.send("Runtime.evaluate", serde_json::json!({ "expression": script }), true);
                }
            }
        }
        std::thread::sleep(period.saturating_sub(started.elapsed()));
    }
}

/// A headless Chrome and the pipe that drives it.
pub struct ChromeHandle {
    child: Child,
    writer: std::fs::File,
    session: String,
    next_id: u64,
    /// frames a second to ask the screencast for
    fps: u32,
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
        // the page runs at 60; every second frame gives the 30 we send. At
        // quality 100, near lossless: the frame is compressed again for the
        // deck, and two ordinary JPEG passes show blocks in smooth skies
        self.send(
            "Page.startScreencast",
            serde_json::json!({ "format": "jpeg", "quality": 100, "maxWidth": PANEL_WIDTH, "maxHeight": PANEL_HEIGHT, "everyNthFrame": (60 / self.fps).max(1) }),
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
    latest: &Mutex<FrameSlot>,
    stop: &AtomicBool,
    paused: &AtomicBool,
    slot: &Mutex<Option<ChromeHandle>>,
    fps: &AtomicU32,
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
            // and on the graphics card by Vulkan: started from the desktop's
            // autostart there is no display in the environment, and Chrome's
            // default OpenGL path then falls back to software (SwiftShader),
            // which runs a WebGL background at a few frames a second
            "--use-angle=vulkan",
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

    let mut handle = ChromeHandle { child, writer, session: String::new(), next_id: 0, fps: fps.load(Ordering::SeqCst) };
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
    let mut flat_run = 0u32;

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
        // Headless Chrome now and then hands over a frame holding nothing but
        // a canvas's clear colour between two drawn ones (seen with Vanta's
        // clouds on Sky), which flashes on the deck. Keep the last picture
        // over up to two such frames; a page that really turns one colour
        // shows it from the third.
        if is_flat(&frame) {
            flat_run += 1;
            if flat_run <= 2 {
                continue;
            }
        		} else {
			flat_run = 0;
		}
		if let Ok(mut l) = latest.lock() {
			l.offer(frame);
		}
    }
    Ok(())
}

/// The picture the deck shows, with a web page's newest frames held back a
/// moment. Headless Chrome now and then hands over a broken frame between
/// good ones: a backdrop not drawn (the Aquarium), a blank canvas (Sky). Such
/// a frame breaks sharply away from the picture showing while one of the two
/// frames after it comes straight back to it; holding frames until the next
/// two arrive lets those be dropped. A real change (a cut, a jump) keeps
/// going, so it passes. A held frame is shown anyway once it is a little old,
/// so a page that stops changing still shows its last picture.
#[derive(Default)]
pub struct FrameSlot {
	shown: Option<RgbImage>,
	shown_look: Option<Vec<f32>>,
	held: std::collections::VecDeque<(RgbImage, Vec<f32>, Instant)>,
}

/// how long a frame may wait for the ones after it
const HOLD: Duration = Duration::from_millis(80);
/// how far apart two frames' brightness must be, on average out of 255, to
/// count as a break
const BREAK: f32 = 16.0;

impl FrameSlot {
	/// A frame to show as it is, as a shader renders it.
	pub fn set_now(&mut self, frame: RgbImage) {
		self.shown = Some(frame);
		self.shown_look = None;
		self.held.clear();
	}

	/// A web page's frame, which waits for the next two before it is shown.
	pub fn offer(&mut self, frame: RgbImage) {
		let look = look_of(&frame);
		self.held.push_back((frame, look, Instant::now()));
		while self.held.len() > 2 {
			let (frame, look, _) = self.held.pop_front().unwrap();
			let broken = self.shown_look.as_ref().is_some_and(|shown| {
				difference(shown, &look) > BREAK && self.held.iter().any(|(_, later, _)| difference(shown, later) < BREAK / 3.0)
			});
			if broken {
				log::debug!("Dropped a broken frame from the page");
			} else {
				self.shown = Some(frame);
				self.shown_look = Some(look);
			}
		}
	}

	/// The picture to show now.
	pub fn get(&mut self) -> Option<RgbImage> {
		while self.held.front().is_some_and(|(_, _, at)| at.elapsed() > HOLD) {
			let (frame, look, _) = self.held.pop_front().unwrap();
			self.shown = Some(frame);
			self.shown_look = Some(look);
		}
		self.shown.clone()
	}
}

/// A frame's brightness on a coarse grid, enough to tell a break from motion.
fn look_of(frame: &RgbImage) -> Vec<f32> {
	let (w, h) = frame.dimensions();
	let mut look = Vec::with_capacity(32 * 18);
	for j in 0..18u32 {
		for i in 0..32u32 {
			let p = frame.get_pixel(i * (w - 1) / 31, j * (h - 1) / 17).0;
			look.push(0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32);
		}
	}
	look
}

fn difference(a: &[f32], b: &[f32]) -> f32 {
	a.iter().zip(b).map(|(x, y)| (x - y).abs()).sum::<f32>() / a.len() as f32
}

/// Whether a frame is a single colour all over, judged on a grid of samples.
fn is_flat(frame: &image::RgbImage) -> bool {
    let (w, h) = frame.dimensions();
    let first = frame.get_pixel(0, 0).0;
    (0..9u32).all(|j| {
        (0..16u32).all(|i| {
            let p = frame.get_pixel(i * (w - 1) / 15, j * (h - 1) / 8).0;
            p.iter().zip(first.iter()).all(|(a, b)| a.abs_diff(*b) <= 2)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    	fn scene(shade: u8, x: u32) -> image::RgbImage {
		// a picture: a gradient, with a bright block that moves
		let mut img = image::RgbImage::from_fn(PANEL_WIDTH, PANEL_HEIGHT, |px, py| image::Rgb([(px / 4) as u8, (py / 2) as u8, shade]));
		for py in 100..200 {
			for px in x..(x + 80).min(PANEL_WIDTH) {
				img.put_pixel(px, py, image::Rgb([255, 255, 255]));
			}
		}
		img
	}

	#[test]
	fn a_broken_frame_between_good_ones_is_dropped() {
		let mut slot = FrameSlot::default();
		let dark = image::RgbImage::from_fn(PANEL_WIDTH, PANEL_HEIGHT, |px, _| image::Rgb([0, 0, (px % 3) as u8]));
		for (k, frame) in [scene(120, 100), scene(120, 104), dark.clone(), scene(120, 112), scene(120, 116), scene(120, 120)].into_iter().enumerate() {
			slot.offer(frame);
			let shown = slot.get().map(|f| f.get_pixel(5, 5).0);
			assert_ne!(shown, Some([0, 0, 0]), "the broken frame was shown after frame {k}");
		}
		// and two broken frames in a row are dropped too
		for frame in [dark.clone(), dark, scene(120, 124), scene(120, 128), scene(120, 132)] {
			slot.offer(frame);
			assert_ne!(slot.get().map(|f| f.get_pixel(5, 5).0), Some([0, 0, 0]));
		}
	}

	#[test]
	fn a_real_change_is_shown() {
		let mut slot = FrameSlot::default();
		for frame in [scene(20, 100), scene(20, 104), scene(250, 108), scene(250, 112), scene(250, 116)] {
			slot.offer(frame);
		}
		assert_eq!(slot.get().map(|f| f.get_pixel(5, 5).0[2]), Some(250), "a cut that stays was dropped");
	}

	#[test]
	fn a_page_that_stops_still_shows_its_last_frame() {
		let mut slot = FrameSlot::default();
		slot.offer(scene(60, 100));
		std::thread::sleep(HOLD + Duration::from_millis(20));
		assert!(slot.get().is_some());
	}

	#[test]
	fn a_flat_frame_is_told_from_a_picture() {
        let flat = image::RgbImage::from_pixel(PANEL_WIDTH, PANEL_HEIGHT, image::Rgb([255, 255, 255]));
        assert!(is_flat(&flat));
        let mut sky = flat.clone();
        for (x, _, p) in sky.enumerate_pixels_mut() {
            *p = image::Rgb([100, 150, (x % 256) as u8]);
        }
        assert!(!is_flat(&sky));
    }

    #[test]
    fn web_address_puts_parameters_before_the_fragment() {
        let mut p = Params::new();
        p.insert("speed".into(), serde_json::json!(1.2));
        p.insert("react".into(), serde_json::json!(false));
        p.insert("glow".into(), serde_json::json!([1, 0.5, 0, 1]));
        assert_eq!(
            web_address("file:///x/blob.html#v1", &p),
            "file:///x/blob.html?glow=1,0.5,0,1&react=0&speed=1.2#v1"
        );
        assert_eq!(web_address("https://a.b/?q=1", &Params::new()), "https://a.b/?q=1");
    }
}
