//! Renders a background shader offline through the plugin's own renderer,
//! so a new effect can be looked at exactly as the deck will draw it.
//!
//! cargo run --release --example render -- <shader> <out-dir> [times] [presses] [look]
//!   times:   seconds to capture, e.g. 1,3,6          (default 1,3,6)
//!   presses: key@seconds, e.g. 7@2.0,12@4.5          (keys 0-14, row by row)
//!   look:    the look step, as the "Background look" action sets it, e.g. 2
//!   music:   "music" plays a synthetic 120 bpm beat into iAudioBands and iAudioLevel
#[path = "../src/shader.rs"]
#[allow(dead_code)]
mod shader;

use shader::{Interaction, ShaderRenderer};

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
	let look: f32 = args.get(5).and_then(|s| s.split(',').next()?.parse().ok()).unwrap_or(0.0);
	let (_, defaults) = shader::parse_inputs(&source);
	let mut renderer = ShaderRenderer::new(&source, 854, 480).expect("compile");
	// step through time at the deck's 30 frames a second, so simulations and
	// feedback buffers evolve as they would, saving the requested moments
	let last = times.iter().cloned().fold(0.0, f32::max);
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
		let mut controls = Interaction { mouse, presses: recent, look, ..Default::default() };
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
		let image = renderer.render(t, &defaults, &controls);
		if times.iter().any(|x| (x - t).abs() < 0.5 / 30.0) {
			image.save(out.join(format!("t{:05.2}.png", t))).unwrap();
		}
		frame += 1;
		t = frame as f32 / 30.0;
	}
}
