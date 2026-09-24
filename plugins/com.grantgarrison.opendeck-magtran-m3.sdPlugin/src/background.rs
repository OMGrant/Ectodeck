//! Full-panel background for the MagTran M3.
//!
//! Neither OpenDeck nor mirajazz models a device-wide background image, so this
//! speaks the vendor's wire protocol directly through mirajazz's raw write
//! escape hatch.
//!
//! The protocol was recovered by interposing `write()` on the hidraw node while
//! the vendor's own SDK set a background, then confirmed against four images of
//! different sizes:
//!
//! ```text
//!   LOG command packet (padded to 1025 bytes):
//!     [0]      0x00            HID report id
//!     [1..3]   'C','R','T'     magic
//!     [4..5]   0x00 0x00
//!     [6..8]   'L','O','G'     set background
//!     [9]      0x00
//!     [10..12] u24 big-endian  JPEG byte length
//!     [13]     0x01            constant flag
//!   then the JPEG in 1024 byte chunks, each packet prefixed with 0x00
//!   then a CRT/STP packet to commit
//! ```
//!
//! The panel is 854x480 landscape, but the device expects the image rotated 90
//! degrees counter-clockwise, so 480x854 goes on the wire. That rotation was
//! verified by diffing the bytes the vendor put on the wire against both
//! candidate rotations of the same source image.

use image::{DynamicImage, RgbImage, codecs::jpeg::JpegEncoder, imageops};
use mirajazz::{device::Device, error::MirajazzError};
use std::io::Cursor;

/// Panel size as the user sees it, landscape.
pub const PANEL_WIDTH: u32 = 854;
pub const PANEL_HEIGHT: u32 = 480;

const CHUNK: usize = 1024;

/// Key icons are small text and thin lines; the default 75 smears them.
const JPEG_QUALITY: u8 = 88;

/// Scale to cover `w` x `h` preserving aspect ratio, then crop the overflow
/// equally from both sides.
pub fn cover_fit(image: &DynamicImage, w: u32, h: u32) -> DynamicImage {
    let (iw, ih) = (image.width() as f64, image.height() as f64);
    let scale = (w as f64 / iw).max(h as f64 / ih);
    let sw = (iw * scale).round().max(w as f64) as u32;
    let sh = (ih * scale).round().max(h as f64) as u32;
    let scaled = image.resize_exact(sw, sh, image::imageops::FilterType::Lanczos3);
    let x = (sw - w) / 2;
    let y = (sh - h) / 2;
    scaled.crop_imm(x, y, w, h)
}


/// Build the BGPIC command that opens a background-layer transfer.
///
/// Recovered by emitting the vendor transport's `set_background_frame_stream`
/// with varied arguments and reading the bytes off the hidraw node:
///
/// ```text
///   [0]      0x00            HID report id
///   [1..3]   'C','R','T'
///   [4..5]   0x00 0x00
///   [6..10]  'B','G','P','I','C'
///   [11]     0x00
///   [12..14] u24 big-endian  JPEG length
///   [15..16] u16 big-endian  x
///   [17..18] u16 big-endian  y
///   [19..20] u16 big-endian  width
///   [21..22] u16 big-endian  height
///   [23..24] u16 big-endian  framebuffer layer
/// ```
///
/// Then the JPEG in 1024-byte chunks, each prefixed 0x00. There is no
/// terminator: the vendor's own application clears and draws keys immediately
/// after the last data packet. This is the command VSD Craft uses for its
/// background; `LOG` is the boot logo, a one-shot frame that any later key
/// write paints over, which is why everything built on it needed a settle.
fn bgpic_command(len: usize, x: u16, y: u16, w: u16, h: u16) -> Vec<u8> {
    let mut v = vec![0x00, b'C', b'R', b'T', 0x00, 0x00, b'B', b'G', b'P', b'I', b'C', 0x00];
    v.extend_from_slice(&[((len >> 16) & 0xFF) as u8, ((len >> 8) & 0xFF) as u8, (len & 0xFF) as u8]);
    v.extend_from_slice(&x.to_be_bytes());
    v.extend_from_slice(&y.to_be_bytes());
    v.extend_from_slice(&w.to_be_bytes());
    v.extend_from_slice(&h.to_be_bytes());
    v.extend_from_slice(&[0x00, 0x00]); // layer 0
    v
}

fn stop_command() -> Vec<u8> {
    vec![0x00, b'C', b'R', b'T', 0x00, 0x00, b'S', b'T', b'P']
}

/// Clear the background layer. `03` is the layer index the vendor uses.
/// Unused: the plugin always owns the layer, so it replaces rather than clears.
#[cfg(test)]
fn bgcle_command() -> Vec<u8> {
    vec![0x00, b'C', b'R', b'T', 0x00, 0x00, b'B', b'G', b'C', b'L', b'E', 0x03]
}

/// Encode a landscape picture for the wire.
///
/// The panel's native framebuffer is portrait, 480 wide by 854 tall, mounted
/// rotated in the housing, so pictures are rotated 90 degrees counter-clockwise
/// and declared at their portrait size.
fn encode(picture: &RgbImage) -> Result<Vec<u8>, MirajazzError> {
    let rotated = imageops::rotate270(picture);
    let mut out = Cursor::new(Vec::new());
    let encoder = JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
    rotated.write_with_encoder(encoder)?;
    Ok(out.into_inner())
}

/// Where a landscape rectangle lands in the portrait framebuffer after that
/// rotation: landscape (x, y) maps to portrait (y, 854 - x - width).
/// Confirmed on the deck by sending a tile to one key's rectangle under each
/// rotation: this one landed on its key upright, the other on the key
/// diametrically opposite, upside down.
pub fn portrait_rect(x: u32, y: u32, w: u32, h: u32) -> (u16, u16, u16, u16) {
    (y as u16, (PANEL_WIDTH - x - w) as u16, h as u16, w as u16)
}

/// Paint `picture` into the layer with its top-left corner at landscape
/// (`x`, `y`), leaving the rest of the layer as it was. A whole-panel frame
/// is the case x = y = 0 at 854x480.
pub async fn send_region(device: &Device, picture: &RgbImage, x: u32, y: u32) -> Result<usize, MirajazzError> {
    let jpeg = encode(picture)?;
    let (px, py, pw, ph) = portrait_rect(x, y, picture.width(), picture.height());

    let mut cmd = bgpic_command(jpeg.len(), px, py, pw, ph);
    device.write_extended_data(&mut cmd).await?;

    for chunk in jpeg.chunks(CHUNK) {
        let mut packet = Vec::with_capacity(1 + CHUNK);
        packet.push(0x00);
        packet.extend_from_slice(chunk);
        device.write_extended_data(&mut packet).await?;
    }

    // STP commits the region.
    let mut stp = stop_command();
    device.write_extended_data(&mut stp).await?;

    Ok(jpeg.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bgpic_header_matches_the_captured_layout() {
        // 7107-byte frame, 854x480 at the origin, layer 0, as captured
        let c = bgpic_command(7107, 0, 0, 854, 480);
        assert_eq!(&c[0..12], &[0x00, b'C', b'R', b'T', 0, 0, b'B', b'G', b'P', b'I', b'C', 0]);
        assert_eq!(&c[12..15], &[0x00, 0x1B, 0xC3]);
        assert_eq!(&c[15..19], &[0, 0, 0, 0]);
        assert_eq!(&c[19..21], &[0x03, 0x56]);
        assert_eq!(&c[21..23], &[0x01, 0xE0]);
        assert_eq!(&c[23..25], &[0, 0]);
    }

    #[test]
    fn bgcle_matches_the_captured_bytes() {
        assert_eq!(bgcle_command(), vec![0x00, b'C', b'R', b'T', 0, 0, b'B', b'G', b'C', b'L', b'E', 0x03]);
    }

    #[test]
    fn cover_fit_never_stretches() {
        let src = DynamicImage::new_rgb8(2000, 1000);
        let out = cover_fit(&src, PANEL_WIDTH, PANEL_HEIGHT);
        assert_eq!((out.width(), out.height()), (PANEL_WIDTH, PANEL_HEIGHT));
        let sq = DynamicImage::new_rgb8(500, 500);
        let out = cover_fit(&sq, PANEL_WIDTH, PANEL_HEIGHT);
        assert_eq!((out.width(), out.height()), (PANEL_WIDTH, PANEL_HEIGHT));
    }

    #[test]
    fn portrait_rect_matches_the_deck() {
        // key 8 of the test layout: landscape (367, 190) -> portrait (190, 377)
        assert_eq!(portrait_rect(367, 190, 110, 110), (190, 377, 110, 110));
        assert_eq!(portrait_rect(0, 0, PANEL_WIDTH, PANEL_HEIGHT), (0, 0, 480, 854));
    }

    #[test]
    fn layer_frame_is_portrait_on_the_wire() {
        let jpeg = encode(&RgbImage::new(PANEL_WIDTH, PANEL_HEIGHT)).unwrap();
        let d = image::load_from_memory(&jpeg).unwrap();
        assert_eq!((d.width(), d.height()), (PANEL_HEIGHT, PANEL_WIDTH));
    }
}
