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
//! - `hits`: drum hits heard since the last frame, as counts for the bass,
//!   the middle and the highs. Hits are found on the audio thread every 10 ms,
//!   far finer than frames: a drum hit is over within a frame, and fast
//!   drumming (a double kick is 7 or more a second) was missed at 30 a second.
//!
//! Shaders get `iAudioBands[32]` and `iAudioLevel`; pages get an
//! `ectodeck:audio` event with `{ bands, level, wave, hits }`.

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
    pub hits: [u32; 3],
}

impl Default for AudioFrame {
    fn default() -> Self {
        AudioFrame { bands: [0.0; BANDS], level: 0.0, wave: vec![128; WINDOW], hits: [0; 3] }
    }
}

/// Does this background ask for sound? Shaders by naming the uniforms,
/// pages by listening for the event.
pub fn wanted_by_shader(code: &str) -> bool {
    code.contains("iAudioBands") || code.contains("iAudioLevel")
}

pub fn wanted_by_page(url: &str) -> bool {
    page_mentions(url, "ectodeck:audio")
}

/// Does a page kept on this computer (a path or a file:// address) mention
/// this text, such as an event it listens for?
pub fn page_mentions(url: &str, text: &str) -> bool {
    let local = url.strip_prefix("file://").unwrap_or(url);
    if !local.starts_with('/') {
        return false;
    }
    let path = local.split(['#', '?']).next().unwrap_or(local);
    std::fs::read_to_string(path).map(|page| page.contains(text)).unwrap_or(false)
}

pub struct AudioTap {
    child: Child,
    samples: Arc<Mutex<Vec<f32>>>,
    hits: Arc<Mutex<[u32; 3]>>,
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
        let hits = Arc::new(Mutex::new([0u32; 3]));
        let found = hits.clone();
        std::thread::Builder::new()
            .name("audio".into())
            .spawn(move || {
                let mut raw = [0u8; 4096];
                let mut onsets = Onsets::default();
                let mut recent: std::collections::VecDeque<f32> = std::collections::VecDeque::with_capacity(ONSET_WINDOW + 1);
                let mut since = 0usize;
                while let Ok(n) = out.read(&mut raw) {
                    if n == 0 {
                        break;
                    }
                    let fresh = raw[..n - n % 4].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]));
                    let fresh: Vec<f32> = fresh.collect();
                    // drum hits, every ONSET_HOP samples over the newest ONSET_WINDOW
                    for &v in &fresh {
                        recent.push_back(v);
                        since += 1;
                        if recent.len() > ONSET_WINDOW {
                            recent.pop_front();
                        }
                        if since >= ONSET_HOP && recent.len() == ONSET_WINDOW {
                            since = 0;
                            let heard = onsets.step(recent.make_contiguous());
                            if heard.iter().any(|&h| h) {
                                if let Ok(mut c) = found.lock() {
                                    for (k, &h) in heard.iter().enumerate() {
                                        c[k] += h as u32;
                                    }
                                }
                            }
                        }
                    }
                    if let Ok(mut s) = buffer.lock() {
                        s.extend(fresh);
                        let excess = s.len().saturating_sub(WINDOW * 2);
                        s.drain(..excess);
                    }
                }
            })
            .ok()?;
        log::info!("Listening to the output for a music background");
        Some(AudioTap { child, samples, hits, smooth: [0.0; BANDS], level: 0.0 })
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
        let hits = self.hits.lock().map(|mut c| std::mem::take(&mut *c)).unwrap_or_default();
        AudioFrame { bands: self.smooth, level: self.level, wave, hits }
    }
}

/// Drum hits: every 10 ms the newest 512 samples become 32 unsmoothed bands
/// on the same decibel scale as `bands`. A part's onset strength is how much
/// its bands rose since the last step; it is a hit when it stands 1.3
/// standard deviations above how much this song has been rising lately (about
/// the last 1.7 s), which catches a drum through loud, compressed guitars and
/// follows each song as it changes. Tuned on fast metal, against hits found
/// in the raw sound at 5 ms: 76% of kicks and 81% of snares caught, where
/// frames at 30 a second caught 29%.
const ONSET_WINDOW: usize = 512;
const ONSET_HOP: usize = 220;
/// bass, middle and highs, as ranges of the 32 bands
const PARTS: [(usize, usize); 3] = [(0, 4), (6, 13), (18, 31)];

struct Onsets {
    prev: [f32; BANDS],
    mean: [f32; 3],
    var: [f32; 3],
    since: [u32; 3],
}

impl Default for Onsets {
    fn default() -> Self {
        Onsets { prev: [0.0; BANDS], mean: [0.0; 3], var: [0.0004; 3], since: [100; 3] }
    }
}

impl Onsets {
    fn step(&mut self, window: &[f32]) -> [bool; 3] {
        let n = window.len();
        let mut re: Vec<f32> = window.iter().enumerate().map(|(i, &v)| v * (0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / (n - 1) as f32).cos())).collect();
        let mut im = vec![0.0f32; n];
        fft(&mut re, &mut im);
        let hz_per_bin = RATE as f32 / n as f32;
        let (lo, hi) = (40.0f32, 11000.0f32);
        let mut bands = [0.0f32; BANDS];
        for (b, band) in bands.iter_mut().enumerate() {
            let f0 = lo * (hi / lo).powf(b as f32 / BANDS as f32);
            let f1 = lo * (hi / lo).powf((b + 1) as f32 / BANDS as f32);
            let a = ((f0 / hz_per_bin) as usize).max(1);
            let z = ((f1 / hz_per_bin) as usize).max(a + 1).min(n / 2);
            let power = (a..z).map(|k| re[k] * re[k] + im[k] * im[k]).fold(0.0f32, f32::max);
            let db = 10.0 * (power.max(1e-12) / (n as f32 * n as f32 / 16.0)).log10();
            *band = ((db + 70.0) / 60.0).clamp(0.0, 1.0);
        }
        let mut heard = [false; 3];
        for (k, &(from, to)) in PARTS.iter().enumerate() {
            let flux = (from..=to).map(|b| (bands[b] - self.prev[b]).max(0.0)).sum::<f32>() / (to - from + 1) as f32;
            self.since[k] = self.since[k].saturating_add(1);
            // at least 70 ms apart
            if flux > self.mean[k] + 1.3 * self.var[k].sqrt() && flux > 0.012 && self.since[k] >= 7 {
                heard[k] = true;
                self.since[k] = 0;
            }
            let d = flux - self.mean[k];
            self.mean[k] += d * 0.006;
            self.var[k] += (d * d - self.var[k]) * 0.006;
        }
        self.prev = bands;
        heard
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
    fn drum_hits_are_found_and_a_steady_tone_is_not() {
        // a steady tone for a second: no hits once it has settled
        let mut onsets = Onsets::default();
        let tone: Vec<f32> = (0..RATE as usize).map(|i| 0.3 * (std::f32::consts::TAU * 440.0 * i as f32 / RATE as f32).sin()).collect();
        let mut steady = 0;
        for (k, start) in (0..tone.len() - ONSET_WINDOW).step_by(ONSET_HOP).enumerate() {
            let h = onsets.step(&tone[start..start + ONSET_WINDOW]);
            if k > 10 {
                steady += h.iter().filter(|&&x| x).count();
            }
        }
        assert_eq!(steady, 0, "hits in a steady tone");
        // then a kick (a thump at 60 Hz) every 0.25 s over quiet noise
        let mut seed = 1u32;
        let sound: Vec<f32> = (0..RATE as usize * 2)
            .map(|i| {
                seed = seed.wrapping_mul(1103515245).wrapping_add(12345);
                let noise = ((seed >> 16) as f32 / 65536.0 - 0.5) * 0.02;
                let since = (i % (RATE as usize / 4)) as f32 / RATE as f32;
                noise + 0.6 * (-since * 30.0).exp() * (std::f32::consts::TAU * 60.0 * since).sin()
            })
            .collect();
        let mut kicks = 0;
        for start in (0..sound.len() - ONSET_WINDOW).step_by(ONSET_HOP) {
            kicks += onsets.step(&sound[start..start + ONSET_WINDOW])[0] as usize;
        }
        assert!((6..=9).contains(&kicks), "{kicks} kicks heard of 8");
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
