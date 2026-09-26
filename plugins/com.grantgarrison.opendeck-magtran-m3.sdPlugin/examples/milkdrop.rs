//! Renders the Milkdrop background offline through the plugin's own projectM
//! renderer, in real time (projectM keeps its own clock), so it can be looked
//! at as the deck will show it.
//!
//! cargo run --release --example milkdrop -- <out-dir> <seconds> [params-json] [sound] [presses]
//!   sound:   "music" (a synthetic 120 bpm beat, the default), "speakers"
//!            (what the computer is playing) or "silence"
//!   presses: seconds at which a key is pressed, e.g. 3.0,6.5
//! Every frame is saved, at 30 frames a second, as frame-00001.png and on.
#[path = "../src/shader.rs"]
#[allow(dead_code)]
mod shader;
#[path = "../src/weather.rs"]
#[allow(dead_code)]
mod weather;
#[path = "../src/milkdrop.rs"]
#[allow(dead_code)]
mod milkdrop;

use std::time::{Duration, Instant};

fn main() {
	let args: Vec<String> = std::env::args().collect();
	let out = std::path::PathBuf::from(&args[1]);
	std::fs::create_dir_all(&out).unwrap();
	let seconds: f32 = args[2].parse().unwrap();
	let params: serde_json::Map<String, serde_json::Value> = args.get(3).filter(|s| !s.is_empty()).and_then(|s| serde_json::from_str(s).ok()).unwrap_or_default();
	let sound = args.get(4).map(String::as_str).unwrap_or("music");
	let presses: Vec<f32> = args.get(5).filter(|s| !s.is_empty()).map(|s| s.split(',').map(|t| t.parse().unwrap()).collect()).unwrap_or_default();
	let folder = milkdrop::preset_folder().expect("presets");
	let mode = if sound == "speakers" { milkdrop::Sound::Speakers } else { milkdrop::Sound::Given };
	let mut r = milkdrop::MilkdropRenderer::new(854, 480, &folder, mode).expect("projectM");
	let start = Instant::now();
	let (mut last, mut frame, mut rendered, mut spent) = (0.0f32, 0u32, 0u32, Duration::ZERO);
	let mut sample = 0u64;
	loop {
		let t = start.elapsed().as_secs_f32();
		if t > seconds {
			break;
		}
		if sound != "speakers" {
			// the sound since the last frame: a kick on every beat, a hat on every eighth, a soft pad
			let n = ((t * 44_100.0) as u64).saturating_sub(sample);
			let mut pcm = Vec::with_capacity(n as usize * 2);
			for i in 0..n {
				let s = (sample + i) as f32 / 44_100.0;
				let v = if sound == "silence" {
					0.0
				} else {
					let kick = (-(s * 2.0 % 1.0) * 9.0).exp() * (std::f32::consts::TAU * 55.0 * s).sin() * 0.8;
					let noise = ((sample + i).wrapping_mul(2654435761) % 1000) as f32 / 500.0 - 1.0;
					let hat = (-(s * 8.0 % 1.0) * 30.0).exp() * noise * 0.25;
					let pad = (std::f32::consts::TAU * 220.0 * s).sin() * 0.1 * (0.5 + 0.5 * (s * 0.7).sin());
					kick + hat + pad
				};
				pcm.push(v);
				pcm.push(v);
			}
			sample += n;
			r.give(&pcm);
		}
		let recent: Vec<(f32, f32, f32, f32)> = presses.iter().rev().filter(|p| **p <= t).map(|p| (427.0, 240.0, t - p, 7.0)).collect();
		let controls = shader::Interaction { presses: recent, ..Default::default() };
		let began = Instant::now();
		let image = r.render(t, t - last, &params, &controls);
		spent += began.elapsed();
		rendered += 1;
		last = t;
		// every frame, at 30 a second
		while (frame as f32) / 30.0 <= t {
			frame += 1;
			image.save(out.join(format!("frame-{frame:05}.png"))).unwrap();
		}
		std::thread::sleep(Duration::from_millis(16).saturating_sub(began.elapsed()));
	}
	eprintln!("{rendered} frames drawn, {:.2} ms a frame to draw and read back", spent.as_secs_f64() * 1000.0 / rendered as f64);
}
