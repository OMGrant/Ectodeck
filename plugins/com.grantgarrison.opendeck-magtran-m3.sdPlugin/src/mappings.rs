use mirajazz::{
    device::DeviceQuery,
    types::HidDeviceInfo,
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

}
