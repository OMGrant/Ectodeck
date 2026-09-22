//! Per-unit key image offset.
//!
//! The deck draws each key's 96x96 image into a fixed window under the key
//! cap. On this unit the window and the cap do not coincide exactly, so the
//! icon sits off-centre. Shifting the image's content by the difference moves
//! the icon under the cap. The offset is read from
//! `~/.config/opendeck-magtran-m3/offset.json` on every draw:
//!
//! ```json
//! { "x": -5, "y": 5 }
//! ```
//!
//! Values are in panel pixels; positive x moves the icon right, positive y
//! moves it down. A key window is about 110 panel pixels across and shows the
//! 96-pixel image scaled, so the shift is converted at 96/110.

use image::{DynamicImage, RgbImage};
use std::path::PathBuf;

const KEY: u32 = 96;
const WINDOW: f32 = 110.0;

fn path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config/opendeck-magtran-m3/offset.json"))
}

fn read_offset() -> (i32, i32) {
    let Some(p) = path() else { return (0, 0) };
    let Ok(text) = std::fs::read_to_string(p) else { return (0, 0) };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return (0, 0) };
    let x = v.get("x").and_then(|n| n.as_f64()).unwrap_or(0.0);
    let y = v.get("y").and_then(|n| n.as_f64()).unwrap_or(0.0);
    ((x * KEY as f64 / WINDOW as f64).round() as i32, (y * KEY as f64 / WINDOW as f64).round() as i32)
}

pub fn apply(image: DynamicImage) -> DynamicImage {
    let (dx, dy) = read_offset();
    if dx == 0 && dy == 0 {
        return image;
    }
    let src = image.resize_exact(KEY, KEY, image::imageops::FilterType::Lanczos3).to_rgb8();
    let mut out = RgbImage::from_pixel(KEY, KEY, image::Rgb([0, 0, 0]));
    for (x, y, px) in src.enumerate_pixels() {
        let nx = x as i32 + dx;
        let ny = y as i32 + dy;
        if nx >= 0 && ny >= 0 && (nx as u32) < KEY && (ny as u32) < KEY {
            out.put_pixel(nx as u32, ny as u32, *px);
        }
    }
    DynamicImage::ImageRgb8(out)
}
