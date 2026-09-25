//! Renders a background shader offline through the plugin's own renderer,
//! so a new effect can be looked at exactly as the deck will draw it.
//!
//! cargo run --release --example render -- <shader> <out-dir> [times] [presses] [params-json]
//!   times:   seconds to capture, e.g. 1,3,6          (default 1,3,6)
//!   presses: key@seconds, e.g. 7@2.0,12@4.5          (keys 0-14, row by row)
//!   params:  settings to render with, as JSON, e.g. {"style":2}
//!   music:   "music" plays a synthetic 120 bpm beat into iAudioBands and iAudioLevel
//!
//! A shader with a place input is drawn at the place in its settings (its
//! NAME + "At"), with the weather there from Open-Meteo, or with a pretend
//! report from RENDER_WEATHER="code,wind,sunrise,sunset" (seconds after the
//! place's midnight), e.g. RENDER_WEATHER=73,60,25200,69000.
//!
//! RENDER_FPS sets the frames a second stepped through (30 by default; the
//! deck runs at the fps in its settings, and a simulation that steps a fixed
//! amount each frame runs at that pace).
//!
//! RENDER_CHANGE="seconds:json" changes settings part-way, as the app does,
//! e.g. RENDER_CHANGE='2:{"weather":2}', to look at a transition.
#[path = "../src/shader.rs"]
#[allow(dead_code)]
mod shader;
#[path = "../src/weather.rs"]
#[allow(dead_code)]
mod weather;

use shader::{Interaction, ShaderRenderer, World};

fn key_centre(key: usize) -> (f32, f32) {
	let (c, r) = ((key % 5) as f32, (key / 5) as f32);
	let x = 43.0 + c * 164.5 + 55.0;
	let y = 20.0 + r * 165.0 + 55.0;
	(x, 480.0 - y)
}

fn main() {
	let args: Vec<String> = std::env::args().collect();
	let source = std::fs::read_to_string(&args[1]).expect("shader");
	let out = std::path::PathBuf::from(&args[2]);
	std::fs::create_dir_all(&out).unwrap();
	let times: Vec<f32> = args.get(3).map(|s| s.split(',').map(|t| t.parse().unwrap()).collect()).unwrap_or(vec![1.0, 3.0, 6.0]);
	let presses: Vec<(usize, f32)> = args
		.get(4)
		.filter(|s| !s.is_empty())
		.map(|s| s.split(',').map(|p| { let (k, t) = p.split_once('@').unwrap(); (k.parse().unwrap(), t.parse().unwrap()) }).collect())
		.unwrap_or_default();
	let overrides: serde_json::Map<String, serde_json::Value> = args.get(5).filter(|s| !s.is_empty()).and_then(|s| serde_json::from_str(s).ok()).unwrap_or_default();
	let (_, mut defaults) = shader::parse_inputs(&source);
	defaults.extend(overrides);
	let mut renderer = ShaderRenderer::new(&source, 854, 480).expect("compile");
	let place = renderer.place_input().and_then(|name| weather::place_in(&defaults, name));
	let report = match std::env::var("RENDER_WEATHER") {
		Ok(v) => {
			let n: Vec<f32> = v.split(',').map(|x| x.trim().parse().unwrap()).collect();
			let zone = World::now(None, None).timezone;
			Some(weather::Report { code: n[0] as i32, wind: n[1], sunrise: n[2], sunset: n[3], offset: zone as i32 })
		}
		Err(_) => place.and_then(|(lat, lon)| weather::ask(lat, lon).map_err(|e| eprintln!("no weather: {e}")).ok()),
	};
	// step through time at RENDER_FPS frames a second, so simulations and
	// feedback buffers evolve as they would, saving the requested moments
	let last = times.iter().cloned().fold(0.0, f32::max);
	let change: Option<(f32, serde_json::Map<String, serde_json::Value>)> = std::env::var("RENDER_CHANGE").ok().and_then(|v| {
		let (at, json) = v.split_once(':')?;
		Some((at.parse().ok()?, serde_json::from_str(json).ok()?))
	});
	let fps: f32 = std::env::var("RENDER_FPS").ok().and_then(|v| v.parse().ok()).unwrap_or(30.0);
	let mut frame = 0;
	let mut t = 0.0f32;
	while t <= last + 1e-3 {
		let mut recent: Vec<(f32, f32, f32, f32)> = presses
			.iter()
			.filter(|(_, at)| *at <= t)
			.map(|(k, at)| { let (x, y) = key_centre(*k); (x, y, t - at, *k as f32) })
			.collect();
		recent.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap());
		recent.truncate(8);
		let mouse = recent.first().map(|p| [p.0, p.1, p.0, p.1]).unwrap_or([0.0; 4]);
		let mut controls = Interaction { mouse, presses: recent, ..Default::default() };
		if args.get(6).map(|a| a == "music").unwrap_or(false) {
			let kick = (-((t * 2.0) % 1.0) * 9.0).exp();
			let hat = (-((t * 8.0) % 1.0) * 14.0).exp() * 0.4;
			for (i, b) in controls.audio_bands.iter_mut().enumerate() {
				let low = if i < 5 { kick * (1.0 - i as f32 / 6.0) } else { 0.0 };
				let high = if i > 20 { hat * (1.0 - (i - 20) as f32 / 14.0) } else { 0.0 };
				*b = (low + high + 0.2 * (t * 1.3 + i as f32 * 0.4).sin().abs() * (1.0 - i as f32 / 32.0)).min(1.0);
			}
			controls.audio_level = (kick * 0.8 + 0.2).min(1.0);
		}
		if let Some((at, values)) = &change {
			if t >= *at {
				defaults.extend(values.clone());
			}
		}
		let image = renderer.render(t, &defaults, &controls, &World::now(place, report));
		if times.iter().any(|x| (x - t).abs() < 0.5 / fps) {
			image.save(out.join(format!("t{:05.2}.png", t))).unwrap();
		}
		frame += 1;
		t = frame as f32 / fps;
	}
}
