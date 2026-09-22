//! Where the fifteen keys sit on the panel, and the per-unit configuration
//! directory that holds it.
//!
//! The M3's key caps are windows onto one 854x480 panel. The firmware has its
//! own idea of where those windows are and on this unit it is wrong: its grid
//! is anchored at the top-right cap but its pitch is smaller than the caps',
//! so every other key's picture drifts up and to the right of its cap. The
//! plugin therefore places the keys itself (see `frame`), and this is the
//! geometry it places them with: four margins between the outer keys and the
//! panel edge, and the key size, all in panel pixels. The gaps between keys
//! follow from those five numbers, so centring the grid under the caps is a
//! matter of calling a margin up or down.
//!
//! Overridable per unit in `~/.config/opendeck-magtran-m3/layout.json`;
//! without it, `Layout::CALIBRATED` applies:
//!
//! ```json
//! { "left": 43, "top": 20, "right": 43, "bottom": 20, "key": 110 }
//! ```
//!
//! The file is watched: an edit repaints the deck within half a second.
//! `"calibrate": true` overlays each key's outline and centre cross.

use crate::{
    background::{PANEL_HEIGHT, PANEL_WIDTH},
    mappings::{COL_COUNT, ROW_COUNT},
};
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub key: f64,
    /// Draw each key's outline and a centre cross over its image, so the
    /// grid can be judged against the physical caps while it is tuned.
    pub calibrate: bool,
}

impl Layout {
    /// The firmware's own grid, measured from a photograph of the deck showing
    /// a labelled 25-pixel grid: 110-pixel windows on a 167 pitch, the first
    /// at (38, 18). Top and right are right for this unit's caps; the rest is
    /// the starting point for calibration.
    #[cfg(test)]
    pub const FIRMWARE: Layout = Layout { left: 38.0, top: 18.0, right: 38.0, bottom: 18.0, key: 110.0, calibrate: false };

    /// Tuned by eye on the deck against the physical caps, starting from the
    /// firmware grid: every key centred under its cap. The default.
    pub const CALIBRATED: Layout = Layout { left: 43.0, top: 20.0, right: 43.0, bottom: 20.0, key: 110.0, calibrate: false };

    /// Distance between the left edges of neighbouring columns.
    pub fn pitch_x(&self) -> f64 {
        (PANEL_WIDTH as f64 - self.left - self.right - self.key) / (COL_COUNT - 1) as f64
    }

    /// Distance between the top edges of neighbouring rows.
    pub fn pitch_y(&self) -> f64 {
        (PANEL_HEIGHT as f64 - self.top - self.bottom - self.key) / (ROW_COUNT - 1) as f64
    }

    /// Top-left corner of the key at OpenDeck position `pos` (reading order),
    /// in panel pixels.
    pub fn origin(&self, pos: u8) -> (i64, i64) {
        let col = (pos as usize % COL_COUNT) as f64;
        let row = (pos as usize / COL_COUNT) as f64;
        (
            (self.left + col * self.pitch_x()).round() as i64,
            (self.top + row * self.pitch_y()).round() as i64,
        )
    }

    pub fn key_px(&self) -> u32 {
        self.key.round().max(1.0) as u32
    }
}

pub fn config_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config/opendeck-magtran-m3"))
}

/// The configured layout, or the calibrated grid when the file is absent.
/// Keys missing from the file keep their calibrated value.
pub fn layout() -> Layout {
    let mut l = Layout::CALIBRATED;
    let Some(dir) = config_dir() else { return l };
    let Ok(text) = std::fs::read_to_string(dir.join("layout.json")) else { return l };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        log::warn!("layout.json is not valid JSON, using the calibrated grid");
        return l;
    };
    let f = |k: &str, cur: f64| v.get(k).and_then(|n| n.as_f64()).unwrap_or(cur);
    l.left = f("left", l.left);
    l.top = f("top", l.top);
    l.right = f("right", l.right);
    l.bottom = f("bottom", l.bottom);
    l.key = f("key", l.key);
    l.calibrate = v.get("calibrate").and_then(|b| b.as_bool()).unwrap_or(false);
    l
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn firmware_grid_reproduces_the_measured_pitch() {
        let l = Layout::FIRMWARE;
        assert_eq!(l.pitch_x(), 167.0);
        assert_eq!(l.pitch_y(), 167.0);
        assert_eq!(l.origin(0), (38, 18));
        assert_eq!(l.origin(4), (706, 18));
        assert_eq!(l.origin(10), (38, 352));
        assert_eq!(l.origin(14), (706, 352));
    }

    #[test]
    fn shrinking_left_and_bottom_margins_leaves_the_top_right_key_alone() {
        let l = Layout { left: 28.0, bottom: 8.0, ..Layout::FIRMWARE };
        assert_eq!(l.origin(4), (706, 18));
        assert_eq!(l.origin(0), (28, 18));
        assert_eq!(l.origin(14), (706, 362));
        assert_eq!(l.origin(10), (28, 362));
        // the middle column and row split the difference
        assert_eq!(l.origin(7), (367, 190));
    }
}
