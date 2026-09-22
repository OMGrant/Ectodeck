use mirajazz::{
    device::DeviceQuery,
    types::{HidDeviceInfo, ImageFormat, ImageMirroring, ImageMode, ImageRotation},
};

/// Must be unique between all the plugins, 2 characters long, and match the
/// `DeviceNamespace` field in `manifest.json`.
pub const DEVICE_NAMESPACE: &str = "m3";

pub const ROW_COUNT: usize = 3;
pub const COL_COUNT: usize = 5;
pub const KEY_COUNT: usize = ROW_COUNT * COL_COUNT;
pub const ENCODER_COUNT: usize = 3;

#[derive(Debug, Clone)]
pub enum Kind {
    MagtranM3,
}

pub const VSDINSIDE_VID: u16 = 0x5548;
pub const MAGTRAN_M3_PID: u16 = 0x1020;

/// Usage page 65440 (0xFFA0) and usage id 1, read directly from the device's HID
/// report descriptor, which begins `06 a0 ff 09 01`. Same as the rest of this
/// device family.
pub const MAGTRAN_M3_QUERY: DeviceQuery =
    DeviceQuery::new(65440, 1, VSDINSIDE_VID, MAGTRAN_M3_PID);

pub const QUERIES: [DeviceQuery; 1] = [MAGTRAN_M3_QUERY];

impl Kind {
    pub fn from_vid_pid(vid: u16, pid: u16) -> Option<Self> {
        match vid {
            VSDINSIDE_VID => match pid {
                MAGTRAN_M3_PID => Some(Kind::MagtranM3),
                _ => None,
            },
            _ => None,
        }
    }

    /// The USB stack reports this device as "HOTSPOTEKUSB HID DEMO", which is the
    /// OEM's string rather than the product, so give it a real name.
    pub fn human_name(&self) -> String {
        match &self {
            Self::MagtranM3 => "VSDinside MagTran M3",
        }
        .to_string()
    }

    /// Protocol 3: the device reports both press (0x01) and release (0x00) states,
    /// confirmed from a raw HID capture, and the vendor SDK configures a 1025 byte
    /// report, matching mirajazz's 1024 byte packet for protocol 2 and above.
    pub fn protocol_version(&self) -> usize {
        match self {
            Self::MagtranM3 => 3,
        }
    }

    /// Key images are 96x96 rotated 90 degrees, taken from the vendor SDK's
    /// `key_image_format()` for this device. The vendor writes PNG to its own
    /// native library; mirajazz speaks JPEG on the wire like the rest of the family.
    pub fn image_format(&self) -> ImageFormat {
        match self {
            Self::MagtranM3 => ImageFormat {
                mode: ImageMode::JPEG,
                size: (96, 96),
                rotation: ImageRotation::Rot90,
                mirror: ImageMirroring::None,
            },
        }
    }
}

/// The M3 addresses key images in a different order than it reports key presses.
///
/// Presses arrive in plain reading order, top left first. Image addressing has the
/// rows reversed: the top row is addressed last. This is taken from the vendor
/// SDK's `_IMAGE_KEY_MAP`, where logical keys 1-5 map to image indices 11-15,
/// 6-10 map to themselves, and 11-15 map to 1-5.
///
/// OpenDeck always speaks in reading order, so translate on the way out to the
/// device. Presses need no translation.
pub fn image_position(position: u8) -> u8 {
    let row = position as usize / COL_COUNT;
    let col = position as usize % COL_COUNT;
    let flipped_row = ROW_COUNT - 1 - row;

    (flipped_row * COL_COUNT + col) as u8
}

#[derive(Debug, Clone)]
pub struct CandidateDevice {
    pub id: String,
    pub dev: HidDeviceInfo,
    pub kind: Kind,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_position_flips_rows_and_is_an_involution() {
        // top row goes to the bottom
        assert_eq!(image_position(0), 10);
        assert_eq!(image_position(4), 14);
        // middle row is unchanged
        for p in 5..10u8 {
            assert_eq!(image_position(p), p);
        }
        // bottom row goes to the top
        assert_eq!(image_position(10), 0);
        assert_eq!(image_position(14), 4);
        // applying it twice returns the original
        for p in 0..KEY_COUNT as u8 {
            assert_eq!(image_position(image_position(p)), p);
        }
    }
}
