//! Milkdrop, Winamp's music visualiser, drawn by projectM (libprojectM,
//! LGPL-2.1, built from third_party/libprojectM by build.rs) on the graphics
//! card with no window, and dancing to what the computer is playing.
//!
//! A background asks for it with a shader source whose ISF header says
//! `"RENDERER": "projectM"`; the header's INPUTS are the settings, as for
//! any shader, so the app's Adjust panel works the same:
//!
//! - `preset`: 0 changes on its own; 1 and up is that preset of the pack.
//! - `every`: seconds between changes when changing on its own.
//! - `blend`: seconds a change blends over.
//! - `shuffle`: changes in a random order rather than the pack's.
//! - `brightness`: the picture dimmed, since many presets run bright and the
//!   keys' icons sit over them.
//!
//! The presets are the .milk files in the plugin's `milkdrop` folder, named
//! 001.milk, 002.milk and so on in the pack's order.
//!
//! The sound is recorded from the default output's monitor (what comes out
//! of the speakers) with `parec`, at 44.1 kHz in stereo, and handed to
//! projectM as it arrives. A key press is a beat: a thump of bass mixed into
//! the sound, as the web version did.
//!
//! projectM draws its finished picture into the context's own surface, so
//! the surface is an offscreen pbuffer the size of the picture, read back
//! each frame. An OpenGL context belongs to the thread that made it current,
//! so a renderer is created and used on one thread.

use image::RgbImage;
use khronos_egl as egl;
use std::ffi::CString;
use std::io::Read;
use std::os::raw::{c_char, c_uint, c_void};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use crate::shader::{open_display, Egl, Interaction};

#[allow(non_camel_case_types)]
type projectm_handle = *mut c_void;
const PROJECTM_STEREO: c_uint = 2;

unsafe extern "C" {
    fn projectm_create() -> projectm_handle;
    fn projectm_destroy(instance: projectm_handle);
    fn projectm_load_preset_file(instance: projectm_handle, filename: *const c_char, smooth_transition: bool);
    fn projectm_set_window_size(instance: projectm_handle, width: usize, height: usize);
    fn projectm_set_fps(instance: projectm_handle, fps: i32);
    fn projectm_set_mesh_size(instance: projectm_handle, width: usize, height: usize);
    fn projectm_set_soft_cut_duration(instance: projectm_handle, seconds: f64);
    fn projectm_set_preset_duration(instance: projectm_handle, seconds: f64);
    fn projectm_set_hard_cut_enabled(instance: projectm_handle, enabled: bool);
    fn projectm_set_preset_locked(instance: projectm_handle, lock: bool);
    fn projectm_set_aspect_correction(instance: projectm_handle, enabled: bool);
    fn projectm_opengl_render_frame(instance: projectm_handle);
    fn projectm_pcm_add_float(instance: projectm_handle, samples: *const f32, count: c_uint, channels: c_uint);
}

/// Does a shader source ask for projectM rather than its own GLSL?
pub fn wanted_by(source: &str) -> bool {
    let trimmed = source.trim_start();
    let Some(body) = trimmed.strip_prefix("/*") else { return false };
    let Some(end) = body.find("*/") else { return false };
    serde_json::from_str::<serde_json::Value>(body[..end].trim())
        .map(|h| h["RENDERER"].as_str() == Some("projectM"))
        .unwrap_or(false)
}

/// Where the presets are: beside the plugin when it is installed (the
/// binary is at <plugin>/<target>/bin/), or in the source's assets when run
/// from a checkout; ECTODECK_MILKDROP_PRESETS overrides both.
pub fn preset_folder() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("ECTODECK_MILKDROP_PRESETS") {
        return Some(PathBuf::from(dir));
    }
    let installed = std::env::current_exe().ok().and_then(|exe| Some(exe.parent()?.parent()?.parent()?.join("milkdrop")));
    let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets/milkdrop");
    [installed, Some(checkout)].into_iter().flatten().find(|d| d.join("001.milk").exists())
}

/// The sound from the speakers, 44.1 kHz stereo floats, as it arrives.
struct Pcm {
    child: Child,
    fresh: Arc<Mutex<Vec<f32>>>,
}

const RATE: f32 = 44_100.0;

impl Pcm {
    fn start() -> Option<Pcm> {
        let mut child = Command::new("parec")
            .args(["--device=@DEFAULT_MONITOR@", "--format=float32le", "--channels=2", "--rate=44100", "--raw", "--latency-msec=20"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| log::warn!("No sound for Milkdrop: could not start parec: {e}"))
            .ok()?;
        let mut out = child.stdout.take()?;
        let fresh: Arc<Mutex<Vec<f32>>> = Arc::default();
        let queue = fresh.clone();
        std::thread::Builder::new()
            .name("milkdrop-audio".into())
            .spawn(move || {
                let mut raw = [0u8; 8192];
                let mut carry: Vec<u8> = vec![];
                while let Ok(n) = out.read(&mut raw) {
                    if n == 0 {
                        break;
                    }
                    carry.extend_from_slice(&raw[..n]);
                    let whole = carry.len() - carry.len() % 8;
                    let samples: Vec<f32> = carry[..whole].chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
                    carry.drain(..whole);
                    if let Ok(mut q) = queue.lock() {
                        q.extend(samples);
                        // a second at most, should the renderer stall
                        let excess = q.len().saturating_sub(RATE as usize * 2);
                        q.drain(..excess);
                    }
                }
            })
            .ok()?;
        log::info!("Listening to the output for Milkdrop");
        Some(Pcm { child, fresh })
    }

    fn take(&self) -> Vec<f32> {
        self.fresh.lock().map(|mut q| std::mem::take(&mut *q)).unwrap_or_default()
    }
}

impl Drop for Pcm {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Where the sound comes from: the speakers, or (for looking at it offline)
/// samples handed in directly.
pub enum Sound {
    Speakers,
    #[allow(dead_code)]
    Given,
}

pub struct MilkdropRenderer {
    egl: Egl,
    display: egl::Display,
    context: egl::Context,
    surface: egl::Surface,
    gl: glow::Context,
    handle: projectm_handle,
    width: u32,
    height: u32,
    presets: Vec<PathBuf>,
    order: Vec<usize>,
    /// the place in `order` shown now
    at: usize,
    changed_at: f32,
    chosen: i64,
    pcm: Option<Pcm>,
    given: Vec<f32>,
    seed: u64,
}

impl MilkdropRenderer {
    pub fn new(width: u32, height: u32, folder: &Path, sound: Sound) -> Result<Self, String> {
        let mut presets: Vec<PathBuf> = std::fs::read_dir(folder)
            .map_err(|e| format!("no Milkdrop presets in {}: {e}", folder.display()))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x == "milk"))
            .collect();
        presets.sort();
        if presets.is_empty() {
            return Err(format!("no Milkdrop presets in {}", folder.display()));
        }
        let egl = unsafe { Egl::load_required() }.map_err(|e| format!("no EGL library: {e}"))?;
        let display = open_display(&egl)?;
        egl.initialize(display).map_err(|e| format!("EGL initialise failed: {e}"))?;
        egl.bind_api(egl::OPENGL_ES_API).map_err(|e| format!("no OpenGL ES: {e}"))?;
        let attributes = [
            egl::SURFACE_TYPE, egl::PBUFFER_BIT,
            egl::RENDERABLE_TYPE, egl::OPENGL_ES3_BIT,
            egl::RED_SIZE, 8, egl::GREEN_SIZE, 8, egl::BLUE_SIZE, 8, egl::ALPHA_SIZE, 8,
            egl::NONE,
        ];
        let config = egl
            .choose_first_config(display, &attributes)
            .map_err(|e| format!("EGL config: {e}"))?
            .ok_or("no EGL config for OpenGL ES 3 offscreen rendering")?;
        let context = egl
            .create_context(display, config, None, &[egl::CONTEXT_CLIENT_VERSION, 3, egl::NONE])
            .map_err(|e| format!("EGL context: {e}"))?;
        // projectM draws its finished picture into the surface itself, so it is the picture's size
        let surface = egl
            .create_pbuffer_surface(display, config, &[egl::WIDTH, width as i32, egl::HEIGHT, height as i32, egl::NONE])
            .map_err(|e| format!("EGL pbuffer: {e}"))?;
        egl.make_current(display, Some(surface), Some(surface), Some(context))
            .map_err(|e| format!("EGL make current: {e}"))?;
        let gl = unsafe { glow::Context::from_loader_function(|name| egl.get_proc_address(name).map_or(std::ptr::null(), |p| p as *const _)) };
        let handle = unsafe { projectm_create() };
        if handle.is_null() {
            return Err("projectM could not start (it needs OpenGL ES 3)".into());
        }
        unsafe {
            projectm_set_window_size(handle, width as usize, height as usize);
            projectm_set_fps(handle, 60);
            projectm_set_mesh_size(handle, 48, 32);
            projectm_set_aspect_correction(handle, true);
            // the changes are ours to make: projectM never changes preset on its own
            projectm_set_preset_duration(handle, 1e9);
            projectm_set_hard_cut_enabled(handle, false);
            projectm_set_preset_locked(handle, true);
        }
        let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1) | 1;
        let pcm = match sound {
            Sound::Speakers => Pcm::start(),
            Sound::Given => None,
        };
        let count = presets.len();
        Ok(MilkdropRenderer {
            egl, display, context, surface, gl, handle, width, height, presets,
            order: (0..count).collect(), at: 0, changed_at: 0.0, chosen: -1, pcm, given: vec![], seed,
        })
    }

    /// Samples to use as the sound (interleaved stereo at 44.1 kHz), for Sound::Given.
    #[allow(dead_code)]
    pub fn give(&mut self, samples: &[f32]) {
        self.given.extend_from_slice(samples);
    }

    fn random(&mut self) -> u64 {
        // xorshift, enough for a shuffle
        self.seed ^= self.seed << 13;
        self.seed ^= self.seed >> 7;
        self.seed ^= self.seed << 17;
        self.seed
    }

    fn show(&mut self, index: usize, blend: f64) {
        let Some(path) = self.presets.get(index) else { return };
        let Ok(name) = CString::new(path.to_string_lossy().as_bytes()) else { return };
        unsafe {
            projectm_set_soft_cut_duration(self.handle, blend.max(0.0));
            projectm_load_preset_file(self.handle, name.as_ptr(), blend > 0.0);
        }
    }

    /// Draw the frame for `time` seconds since the background started, with
    /// its settings and the deck's controls.
    pub fn render(&mut self, time: f32, dt: f32, params: &serde_json::Map<String, serde_json::Value>, controls: &Interaction) -> RgbImage {
        let num = |k: &str, d: f64| params.get(k).and_then(|v| v.as_f64()).unwrap_or(d);
        let chosen = num("preset", 0.0).round() as i64;
        let every = num("every", 30.0) as f32;
        let blend = num("blend", 2.5);
        let shuffle = params.get("shuffle").and_then(|v| v.as_bool()).unwrap_or(true);
        let brightness = num("brightness", 0.8).clamp(0.0, 1.0) as f32;

        // the preset: the one chosen, or changing on its own every so often
        if chosen != self.chosen {
            let first = self.chosen < 0;
            if chosen > 0 {
                self.show((chosen as usize - 1).min(self.presets.len() - 1), if first { 0.0 } else { blend.min(1.0) });
            } else {
                self.order = (0..self.presets.len()).collect();
                if shuffle {
                    for i in (1..self.order.len()).rev() {
                        let j = (self.random() % (i as u64 + 1)) as usize;
                        self.order.swap(i, j);
                    }
                }
                self.at = 0;
                let next = if first { self.order[0] } else { self.order[(self.at + 1) % self.order.len()] };
                self.show(next, if first { 0.0 } else { blend.min(1.0) });
            }
            self.chosen = chosen;
            self.changed_at = time;
        } else if chosen <= 0 && every > 0.0 && time - self.changed_at > every {
            self.at = (self.at + 1) % self.order.len();
            let next = self.order[self.at];
            self.show(next, blend);
            self.changed_at = time;
        }

        // the sound, with a thump of bass for a key press: a decaying 50 Hz swell
        let mut samples = match &self.pcm {
            Some(p) => p.take(),
            None => std::mem::take(&mut self.given),
        };
        let frames = samples.len() / 2;
        if let Some(&(_, _, age, _)) = controls.presses.first() {
            for f in 0..frames {
                // how long ago the press was, at this sample (the last sample is now)
                let since = age - (frames - 1 - f) as f32 / RATE;
                if (0.0..0.45).contains(&since) {
                    let thump = (-since * 7.0).exp() * 0.9 * (std::f32::consts::TAU * 50.0 * since).sin();
                    samples[f * 2] = (samples[f * 2] + thump).clamp(-1.0, 1.0);
                    samples[f * 2 + 1] = (samples[f * 2 + 1] + thump).clamp(-1.0, 1.0);
                }
            }
        }
        let _ = dt;
        unsafe {
            let _ = self.egl.make_current(self.display, Some(self.surface), Some(self.surface), Some(self.context));
            if frames > 0 {
                projectm_pcm_add_float(self.handle, samples.as_ptr(), frames as c_uint, PROJECTM_STEREO);
            }
            projectm_opengl_render_frame(self.handle);
        }
        let (w, h) = (self.width, self.height);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        unsafe {
            use glow::HasContext;
            self.gl.bind_framebuffer(glow::FRAMEBUFFER, None);
            self.gl.read_pixels(0, 0, w as i32, h as i32, glow::RGBA, glow::UNSIGNED_BYTE, glow::PixelPackData::Slice(Some(&mut rgba)));
        }
        // OpenGL rows run bottom to top; dimmed by the brightness setting
        let mut out = RgbImage::new(w, h);
        for y in 0..h {
            let row = &rgba[((h - 1 - y) * w * 4) as usize..((h - y) * w * 4) as usize];
            for x in 0..w {
                let i = (x * 4) as usize;
                let dim = |v: u8| (v as f32 * brightness).round() as u8;
                out.put_pixel(x, y, image::Rgb([dim(row[i]), dim(row[i + 1]), dim(row[i + 2])]));
            }
        }
        out
    }
}

impl Drop for MilkdropRenderer {
    fn drop(&mut self) {
        unsafe {
            let _ = self.egl.make_current(self.display, Some(self.surface), Some(self.surface), Some(self.context));
            projectm_destroy(self.handle);
        }
        let _ = self.egl.make_current(self.display, None, None, None);
        let _ = self.egl.destroy_surface(self.display, self.surface);
        let _ = self.egl.destroy_context(self.display, self.context);
        let _ = self.egl.terminate(self.display);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_a_projectm_source() {
        assert!(wanted_by(r#"/*{ "RENDERER": "projectM", "INPUTS": [] }*/"#));
        assert!(!wanted_by(r#"/*{ "INPUTS": [] }*/ void mainImage(out vec4 c, in vec2 p) {}"#));
        assert!(!wanted_by("void mainImage(out vec4 c, in vec2 p) {}"));
    }

    #[test]
    fn finds_the_presets_in_a_checkout() {
        let folder = preset_folder().expect("presets");
        assert!(folder.join("001.milk").exists() && folder.join("100.milk").exists());
    }
}
