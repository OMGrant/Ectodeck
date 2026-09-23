//! What the computer is playing, for backgrounds that dance to music.
//!
//! While a background that asks for sound is showing, `parec` records the
//! default output's monitor (what comes out of the speakers, never the
//! microphone) as mono floats. Each frame the newest samples become a
//! waveform and a spectrum:
//!
//! - `bands`: 32 bands from 40 Hz to 11 kHz, spaced like hearing is, each
//!   0 to 1; they rise at once and fall back gently, so beats read clearly.
//! - `level`: overall loudness, 0 to 1, with the same rise and fall.
//! - `wave`: the last 1024 samples as bytes centred on 128, the form Web
//!   Audio's `getByteTimeDomainData` gives (what Milkdrop presets expect).
//!
//! Shaders get `iAudioBands[32]` and `iAudioLevel`; pages get an
//! `ectodeck:audio` event with `{ bands, level, wave }`.

use std::{
    io::Read,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
};

pub const BANDS: usize = 32;
const RATE: u32 = 22050;
const WINDOW: usize = 1024;

#[derive(Clone, Debug)]
pub struct AudioFrame {
    pub bands: [f32; BANDS],
    pub level: f32,
    pub wave: Vec<u8>,
}

impl Default for AudioFrame {
    fn default() -> Self {
        AudioFrame { bands: [0.0; BANDS], level: 0.0, wave: vec![128; WINDOW] }
    }
}

/// Does this background ask for sound? Shaders by naming the uniforms,
/// pages by listening for the event.
pub fn wanted_by_shader(code: &str) -> bool {
    code.contains("iAudioBands") || code.contains("iAudioLevel")
}

pub fn wanted_by_page(url: &str) -> bool {
    // a page kept on this computer, given as a path or a file:// address
    let local = url.strip_prefix("file://").unwrap_or(url);
    if !local.starts_with('/') {
        return false;
    }
    let path = local.split(['#', '?']).next().unwrap_or(local);
    std::fs::read_to_string(path).map(|page| page.contains("ectodeck:audio")).unwrap_or(false)
}

pub struct AudioTap {
    child: Child,
    samples: Arc<Mutex<Vec<f32>>>,
    smooth: [f32; BANDS],
    level: f32,
}

impl AudioTap {
    pub fn start() -> Option<AudioTap> {
        let mut child = Command::new("parec")
            .args(["--device=@DEFAULT_MONITOR@", "--format=float32le", "--channels=1", "--raw", "--latency-msec=20"])
            .arg(format!("--rate={RATE}"))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| log::warn!("No sound for music backgrounds: could not start parec: {e}"))
            .ok()?;
        let mut out = child.stdout.take()?;
        let samples = Arc::new(Mutex::new(Vec::with_capacity(WINDOW * 4)));
        let buffer = samples.clone();
        std::thread::Builder::new()
            .name("audio".into())
            .spawn(move || {
                let mut raw = [0u8; 4096];
                while let Ok(n) = out.read(&mut raw) {
                    if n == 0 {
                        break;
                    }
                    let fresh = raw[..n - n % 4].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]));
                    if let Ok(mut s) = buffer.lock() {
                        s.extend(fresh);
                        let excess = s.len().saturating_sub(WINDOW * 2);
                        s.drain(..excess);
                    }
                }
            })
            .ok()?;
        log::info!("Listening to the output for a music background");
        Some(AudioTap { child, samples, smooth: [0.0; BANDS], level: 0.0 })
    }

    /// The sound right now, for one frame.
    pub fn frame(&mut self) -> AudioFrame {
        let mut window = self.samples.lock().map(|s| s[s.len().saturating_sub(WINDOW)..].to_vec()).unwrap_or_default();
        window.resize(WINDOW, 0.0);
        let wave = window.iter().map(|&v| (128.0 + v.clamp(-1.0, 1.0) * 127.0) as u8).collect();

        // spectrum of the Hann-windowed samples
        let mut re: Vec<f32> = window.iter().enumerate().map(|(i, &v)| v * (0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / (WINDOW - 1) as f32).cos())).collect();
        let mut im = vec![0.0f32; WINDOW];
        fft(&mut re, &mut im);
        let hz_per_bin = RATE as f32 / WINDOW as f32;
        let (lo, hi) = (40.0f32, 11000.0f32);
        for b in 0..BANDS {
            let f0 = lo * (hi / lo).powf(b as f32 / BANDS as f32);
            let f1 = lo * (hi / lo).powf((b + 1) as f32 / BANDS as f32);
            let (a, z) = ((f0 / hz_per_bin) as usize, ((f1 / hz_per_bin) as usize).max((f0 / hz_per_bin) as usize + 1).min(WINDOW / 2));
            let power = (a..z).map(|k| re[k] * re[k] + im[k] * im[k]).fold(0.0f32, f32::max);
            // decibels from -70 to -10 become 0 to 1
            let db = 10.0 * (power.max(1e-12) / (WINDOW as f32 * WINDOW as f32 / 16.0)).log10();
            let v = ((db + 70.0) / 60.0).clamp(0.0, 1.0);
            let s = &mut self.smooth[b];
            *s = if v > *s { v } else { *s * 0.82 + v * 0.18 };
        }
        let rms = (window.iter().map(|v| v * v).sum::<f32>() / WINDOW as f32).sqrt();
        let v = (rms * 4.0).clamp(0.0, 1.0);
        self.level = if v > self.level { v } else { self.level * 0.85 + v * 0.15 };
        AudioFrame { bands: self.smooth, level: self.level, wave }
    }
}

impl Drop for AudioTap {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// In-place radix-2 FFT; the length must be a power of two.
fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let angle = -std::f32::consts::TAU / len as f32;
        for start in (0..n).step_by(len) {
            for k in 0..len / 2 {
                let (wr, wi) = ((angle * k as f32).cos(), (angle * k as f32).sin());
                let (a, b) = (start + k, start + k + len / 2);
                let (xr, xi) = (re[b] * wr - im[b] * wi, re[b] * wi + im[b] * wr);
                re[b] = re[a] - xr;
                im[b] = im[a] - xi;
                re[a] += xr;
                im[a] += xi;
            }
        }
        len <<= 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_is_found_by_path_or_file_address() {
        let dir = std::env::temp_dir().join("ectodeck-audio-test");
        std::fs::create_dir_all(&dir).unwrap();
        let page = dir.join("music.html");
        std::fs::write(&page, "<script>addEventListener('ectodeck:audio', f)</script>").unwrap();
        let path = page.display().to_string();
        assert!(wanted_by_page(&format!("{path}#abc")));
        assert!(wanted_by_page(&format!("file://{path}?x=1#abc")));
        assert!(!wanted_by_page("https://example.com/music.html"));
    }

    #[test]
    fn a_tone_lights_its_own_band() {
        let mut re: Vec<f32> = (0..WINDOW).map(|i| (std::f32::consts::TAU * 1000.0 * i as f32 / RATE as f32).sin()).collect();
        let mut im = vec![0.0; WINDOW];
        fft(&mut re, &mut im);
        let peak = (0..WINDOW / 2).max_by(|&a, &b| (re[a].hypot(im[a])).partial_cmp(&re[b].hypot(im[b])).unwrap()).unwrap();
        let hz = peak as f32 * RATE as f32 / WINDOW as f32;
        assert!((hz - 1000.0).abs() < 25.0, "{hz}");
    }
}
