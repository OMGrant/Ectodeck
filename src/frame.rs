//! The panel as one picture.
//!
//! The firmware draws key images into fifteen windows whose positions it owns,
//! and on this unit those windows do not sit under the caps. Nothing in the
//! protocol moves them, so the plugin never sends a key image at all. It keeps
//! the background and the fifteen key images itself, composites them into one
//! 854x480 frame with the keys placed by `layout`, and sends that frame as the
//! background layer, which the device shows wherever its own key windows are
//! empty. The windows are cleared once after the first frame and stay clear.
//!
//! Changes arrive in bursts (a profile switch is one background and fifteen
//! keys), and a frame is dozens of packets, so a change only marks the frame
//! dirty and the repaint runs a moment later with whatever has arrived by then.

use crate::{
    DEVICES, WRITE_GUARD,
    background::{PANEL_HEIGHT, PANEL_WIDTH, cover_fit},
    device::handle_error,
    layout::{Layout, layout},
    mappings::KEY_COUNT,
};
use image::{DynamicImage, RgbImage, imageops};
use std::{
    collections::HashMap,
    sync::{Arc, LazyLock},
    time::Duration,
};
use tokio::sync::{Mutex, RwLock};

/// How long a repaint waits for the rest of a burst.
const SETTLE: Duration = Duration::from_millis(40);

struct Frame {
    /// Cover-fitted to the panel once, when set.
    background: Option<RgbImage>,
    /// As received from OpenDeck, scaled at paint time.
    keys: Vec<Option<DynamicImage>>,
    repaint_scheduled: bool,
    windows_cleared: bool,
    /// The last frame put on the wire, so a change that nets out to the same
    /// picture (a press and release inside one settle window) sends nothing.
    last_sent: Option<RgbImage>,
}

impl Frame {
    fn new() -> Self {
        Frame {
            background: None,
            keys: vec![None; KEY_COUNT],
            repaint_scheduled: false,
            windows_cleared: false,
            last_sent: None,
        }
    }
}

static FRAMES: LazyLock<RwLock<HashMap<String, Arc<Mutex<Frame>>>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

async fn frame_for(id: &str) -> Arc<Mutex<Frame>> {
    if let Some(f) = FRAMES.read().await.get(id) {
        return f.clone();
    }
    FRAMES
        .write()
        .await
        .entry(id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(Frame::new())))
        .clone()
}

/// Drop everything held for a device that has gone away.
pub async fn forget(id: &str) {
    FRAMES.write().await.remove(id);
}

pub async fn set_background(id: &str, image: Option<DynamicImage>) {
    let frame = frame_for(id).await;
    let mut f = frame.lock().await;
    let fitted = image.map(|i| cover_fit(&i, PANEL_WIDTH, PANEL_HEIGHT).to_rgb8());
    if fitted == f.background {
        return;
    }
    f.background = fitted;
    schedule(id, &frame, &mut f);
}

pub async fn set_key(id: &str, pos: u8, image: Option<DynamicImage>) {
    if pos as usize >= KEY_COUNT {
        log::error!("Key {pos} is out of range");
        return;
    }
    let frame = frame_for(id).await;
    let mut f = frame.lock().await;
    // OpenDeck re-sends a key's image on every press and release even when
    // nothing about it changed; an identical image is not worth a frame.
    if image == f.keys[pos as usize] {
        return;
    }
    f.keys[pos as usize] = image;
    schedule(id, &frame, &mut f);
}

pub async fn clear_keys(id: &str) {
    let frame = frame_for(id).await;
    let mut f = frame.lock().await;
    f.keys.iter_mut().for_each(|k| *k = None);
    schedule(id, &frame, &mut f);
}

/// Paint the current state again, for a device that has just come up.
pub async fn repaint(id: &str) {
    let frame = frame_for(id).await;
    let mut f = frame.lock().await;
    schedule(id, &frame, &mut f);
}

fn schedule(id: &str, frame: &Arc<Mutex<Frame>>, f: &mut Frame) {
    if f.repaint_scheduled {
        return;
    }
    f.repaint_scheduled = true;
    tokio::spawn(repaint_later(id.to_string(), frame.clone()));
}

async fn repaint_later(id: String, frame: Arc<Mutex<Frame>>) {
    tokio::time::sleep(SETTLE).await;

    // Take the write slot first, then read the state, so a change that lands
    // during this transfer gets a transfer of its own with everything in it.
    let _write = WRITE_GUARD.lock().await;
    let lay = layout();
    let (picture, clear_windows, last) = {
        let mut f = frame.lock().await;
        f.repaint_scheduled = false;
        let picture = render(&f, &lay);
        if f.last_sent.as_ref() == Some(&picture) {
            return;
        }
        (picture, !f.windows_cleared, f.last_sent.clone())
    };

    let result = {
        let devices = DEVICES.read().await;
        let Some(device) = devices.get(&id) else {
            log::warn!("Frame ready for {id} but it is not connected");
            return;
        };
        let sent = match regions(last.as_ref(), &picture, &lay) {
            // Only some keys changed: repaint just their squares, a few
            // kilobytes each instead of a hundred for the panel.
            Some(keys) => {
                let mut r = Ok(0);
                for (x, y, w, h) in keys {
                    let tile = imageops::crop_imm(&picture, x, y, w, h).to_image();
                    r = crate::background::send_region(device, &tile, x, y).await;
                    if r.is_err() {
                        break;
                    }
                }
                r
            }
            None => {
                log::info!("Sending panel frame");
                crate::background::send_region(device, &picture, 0, 0).await
            }
        };
        match sent {
            Ok(_) if clear_windows => {
                // The firmware may still hold key images from before this
                // plugin ran; empty its windows so the layer shows through
                // them. Once is enough.
                device
                    .clear_all_button_images()
                    .await
                    .and(device.flush().await)
                    .map(|_| true)
            }
            other => other.map(|_| false),
        }
    };

    match result {
        Ok(cleared) => {
            let mut f = frame.lock().await;
            f.last_sent = Some(picture);
            if cleared {
                f.windows_cleared = true;
            }
        }
        Err(e) => {
            handle_error(&id, e).await;
        }
    }
}

/// The key squares that differ between the frame on the device and the new
/// one, or None when a whole frame is the better send: nothing sent yet,
/// something outside the keys changed (background, layout), or most keys
/// changed at once (a profile switch).
fn regions(last: Option<&RgbImage>, next: &RgbImage, layout: &Layout) -> Option<Vec<(u32, u32, u32, u32)>> {
    let last = last?;
    let k = layout.key_px();
    let rects: Vec<(u32, u32, u32, u32)> = (0..KEY_COUNT as u8)
        .map(|pos| {
            let (x, y) = layout.origin(pos);
            let x = x.clamp(0, (PANEL_WIDTH - k) as i64) as u32;
            let y = y.clamp(0, (PANEL_HEIGHT - k) as i64) as u32;
            (x, y, k, k)
        })
        .collect();
    let inside = |px: u32, py: u32| rects.iter().any(|&(x, y, w, h)| px >= x && px < x + w && py >= y && py < y + h);
    let mut changed = vec![false; rects.len()];
    for (px, py, p) in next.enumerate_pixels() {
        if last.get_pixel(px, py) == p {
            continue;
        }
        match rects.iter().position(|&(x, y, w, h)| px >= x && px < x + w && py >= y && py < y + h) {
            Some(i) => changed[i] = true,
            None if !inside(px, py) => return None,
            None => {}
        }
    }
    let keys: Vec<_> = rects.into_iter().zip(changed).filter(|(_, c)| *c).map(|(r, _)| r).collect();
    if keys.len() > 6 { None } else { Some(keys) }
}

/// Composite the background and keys into a landscape panel frame.
fn render(frame: &Frame, layout: &Layout) -> RgbImage {
    let mut canvas = match &frame.background {
        Some(bg) => bg.clone(),
        None => RgbImage::new(PANEL_WIDTH, PANEL_HEIGHT),
    };
    let key = layout.key_px();
    for (pos, image) in frame.keys.iter().enumerate() {
        let Some(image) = image else { continue };
        let tile = image
            .resize_exact(key, key, imageops::FilterType::Lanczos3)
            .to_rgb8();
        let (x, y) = layout.origin(pos as u8);
        imageops::replace(&mut canvas, &tile, x, y);
    }
    if layout.calibrate {
        overlay_guides(&mut canvas, layout);
    }
    canvas
}

/// Outline every key's square and cross its centre, in white with a black
/// edge so it reads over any image.
fn overlay_guides(canvas: &mut RgbImage, layout: &Layout) {
    let k = layout.key_px() as i64;
    let (w, h) = (canvas.width() as i64, canvas.height() as i64);
    let mut put = |x: i64, y: i64, c: [u8; 3]| {
        if x >= 0 && y >= 0 && x < w && y < h {
            canvas.put_pixel(x as u32, y as u32, image::Rgb(c));
        }
    };
    for pos in 0..KEY_COUNT as u8 {
        let (x0, y0) = layout.origin(pos);
        let (cx, cy) = (x0 + k / 2, y0 + k / 2);
        for (t, c) in [(0, [255, 255, 255]), (1, [255, 255, 255]), (2, [0, 0, 0])] {
            for i in 0..k {
                put(x0 + i, y0 + t, c);
                put(x0 + i, y0 + k - 1 - t, c);
                put(x0 + t, y0 + i, c);
                put(x0 + k - 1 - t, y0 + i, c);
            }
        }
        for i in -18..=18 {
            for t in -1..=1 {
                put(cx + i, cy + t, [255, 255, 255]);
                put(cx + t, cy + i, [255, 255, 255]);
            }
        }
    }
}

/// Repaint every device whenever layout.json changes, so the grid can be
/// tuned live.
pub async fn watch_layout(token: tokio_util::sync::CancellationToken) {
    let mut seen = layout();
    loop {
        tokio::select! {
            _ = token.cancelled() => return,
            _ = tokio::time::sleep(Duration::from_millis(400)) => {}
        }
        let now = layout();
        if now == seen {
            continue;
        }
        log::info!("Layout changed: {:?}", now);
        seen = now;
        let ids: Vec<String> = FRAMES.read().await.keys().cloned().collect();
        for id in ids {
            repaint(&id).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(w: u32, h: u32, rgb: [u8; 3]) -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_pixel(w, h, image::Rgb(rgb)))
    }

    #[test]
    fn keys_land_where_the_layout_says() {
        let mut f = Frame::new();
        f.keys[0] = Some(solid(96, 96, [255, 0, 0]));
        f.keys[14] = Some(solid(72, 72, [0, 0, 255]));
        let l = Layout { left: 28.0, bottom: 8.0, ..Layout::FIRMWARE };
        let out = render(&f, &l);
        assert_eq!((out.width(), out.height()), (PANEL_WIDTH, PANEL_HEIGHT));
        // key 1 fills (28,18)..(138,128)
        assert_eq!(out.get_pixel(28, 18).0, [255, 0, 0]);
        assert_eq!(out.get_pixel(137, 127).0, [255, 0, 0]);
        assert_eq!(out.get_pixel(27, 18).0, [0, 0, 0]);
        assert_eq!(out.get_pixel(138, 18).0, [0, 0, 0]);
        // key 15 fills (706,362)..(816,472)
        assert_eq!(out.get_pixel(706, 362).0, [0, 0, 255]);
        assert_eq!(out.get_pixel(815, 471).0, [0, 0, 255]);
        assert_eq!(out.get_pixel(816, 471).0, [0, 0, 0]);
    }

    #[test]
    fn a_key_change_repaints_only_that_key() {
        let mut f = Frame::new();
        let l = Layout::FIRMWARE;
        let before = render(&f, &l);
        f.keys[3] = Some(solid(96, 96, [200, 0, 0]));
        let after = render(&f, &l);
        assert_eq!(regions(Some(&before), &after, &l), Some(vec![(539, 18, 110, 110)]));
        assert_eq!(regions(None, &after, &l), None);
        f.background = Some(RgbImage::from_pixel(PANEL_WIDTH, PANEL_HEIGHT, image::Rgb([5, 5, 5])));
        assert_eq!(regions(Some(&after), &render(&f, &l), &l), None);
    }

    #[test]
    fn background_shows_between_keys_and_a_cleared_key_shows_it_too() {
        let mut f = Frame::new();
        f.background = Some(RgbImage::from_pixel(PANEL_WIDTH, PANEL_HEIGHT, image::Rgb([9, 9, 9])));
        f.keys[7] = Some(solid(96, 96, [0, 255, 0]));
        let out = render(&f, &Layout::FIRMWARE);
        assert_eq!(out.get_pixel(0, 0).0, [9, 9, 9]);
        assert_eq!(out.get_pixel(372 + 55, 185 + 55).0, [0, 255, 0]);
        f.keys[7] = None;
        let out = render(&f, &Layout::FIRMWARE);
        assert_eq!(out.get_pixel(372 + 55, 185 + 55).0, [9, 9, 9]);
    }
}
