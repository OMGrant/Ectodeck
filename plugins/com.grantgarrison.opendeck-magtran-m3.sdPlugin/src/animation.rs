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

#[derive(Clone, Debug, PartialEq)]
pub enum Source {
    Web(String),
    Shader(String),
}

pub struct Animation {
    latest: Arc<Mutex<Option<RgbImage>>>,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    chrome: Arc<Mutex<Option<ChromeHandle>>>,
    thread: Option<JoinHandle<()>>,
}

impl Animation {
    pub fn start(source: Source) -> Animation {
        let latest = Arc::new(Mutex::new(None));
        let stop = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(AtomicBool::new(false));
        let chrome = Arc::new(Mutex::new(None));
        let (l, s, p, c) = (latest.clone(), stop.clone(), paused.clone(), chrome.clone());
        let thread = std::thread::Builder::new()
            .name("animation".into())
            .spawn(move || {
                match source {
                    Source::Shader(code) => {
                        if let Err(e) = run_shader(&code, &l, &s, &p) {
                            log::error!("Shader background stopped: {e}");
                        }
                    }
                    // Chrome can exit under us (a crash, an update replacing
                    // its files); start it again, backing off if it keeps
                    // failing
                    Source::Web(url) => {
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
        Animation { latest, stop, paused, chrome, thread }
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

fn run_shader(code: &str, latest: &Mutex<Option<RgbImage>>, stop: &AtomicBool, paused: &AtomicBool) -> Result<(), String> {
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
        let frame = renderer.render(clock);
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
        if m.get("method").and_then(|v| v.as_str()) != Some("Page.screencastFrame") {
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
