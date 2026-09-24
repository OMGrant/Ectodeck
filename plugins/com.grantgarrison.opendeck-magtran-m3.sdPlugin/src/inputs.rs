use mirajazz::{error::MirajazzError, types::DeviceInput};

use crate::mappings::{ENCODER_COUNT, KEY_COUNT};

/// Input codes for the MagTran M3.
///
/// Keys report 0x01 through 0x0F in plain reading order, top left first, with a
/// state byte of 0x01 for press and 0x00 for release. Confirmed from a raw HID
/// capture of the device.
///
/// The encoders differ from the rest of this family: the third encoder uses
/// 0xA0/0xA1 where the N3 uses 0x60/0x61, and its press is 0x37 where the N3
/// uses 0x34. Taken from the vendor SDK's `StreamDockM3` decoder.
pub fn process_input(input: u8, state: u8) -> Result<DeviceInput, MirajazzError> {
    log::info!("Processing input: {:#04x}, {}", input, state);
    // how long each key was held, for telling a finger from a switch glitch
    if (0x01..=0x0F).contains(&input) {
        static DOWN: std::sync::Mutex<[Option<std::time::Instant>; 16]> = std::sync::Mutex::new([None; 16]);
        if let Ok(mut down) = DOWN.lock() {
            if state == 1 {
                down[input as usize] = Some(std::time::Instant::now());
            } else if let Some(at) = down[input as usize].take() {
                log::info!("Key {:#04x} held {} ms", input, at.elapsed().as_millis());
            }
        }
    }

    match input {
        0x00..=0x0F => read_button_press(input, state),
        0x50 | 0x51 | 0x90 | 0x91 | 0xA0 | 0xA1 => read_encoder_value(input),
        0x33 | 0x35 | 0x37 => read_encoder_press(input, state),
        _ => Err(MirajazzError::BadData),
    }
}

fn read_button_states(states: &[u8]) -> Vec<bool> {
    let mut bools = vec![];

    for i in 0..KEY_COUNT {
        bools.push(states[i + 1] != 0);
    }

    bools
}

fn read_button_press(input: u8, state: u8) -> Result<DeviceInput, MirajazzError> {
    let mut button_states = vec![0x01];
    button_states.extend(vec![0u8; KEY_COUNT + 1]);

    // 0 is the "all released" report
    if input == 0 {
        return Ok(DeviceInput::ButtonStateChange(read_button_states(
            &button_states,
        )));
    }

    let pressed_index: usize = match input {
        0x01..=0x0F => input as usize,
        _ => return Err(MirajazzError::BadData),
    };

    button_states[pressed_index] = state;

    Ok(DeviceInput::ButtonStateChange(read_button_states(
        &button_states,
    )))
}

fn read_encoder_value(input: u8) -> Result<DeviceInput, MirajazzError> {
    let mut encoder_values = vec![0i8; ENCODER_COUNT];

    let (encoder, value): (usize, i8) = match input {
        // Left encoder
        0x50 => (0, -1),
        0x51 => (0, 1),
        // Middle encoder
        0x90 => (1, -1),
        0x91 => (1, 1),
        // Right encoder
        0xA0 => (2, -1),
        0xA1 => (2, 1),
        _ => return Err(MirajazzError::BadData),
    };

    encoder_values[encoder] = value;
    Ok(DeviceInput::EncoderTwist(encoder_values))
}

fn read_encoder_press(input: u8, state: u8) -> Result<DeviceInput, MirajazzError> {
    let mut encoder_states = vec![false; ENCODER_COUNT];

    let encoder: usize = match input {
        0x35 => 0, // Left encoder
        0x33 => 1, // Middle encoder
        0x37 => 2, // Right encoder
        _ => return Err(MirajazzError::BadData),
    };

    encoder_states[encoder] = state != 0;
    Ok(DeviceInput::EncoderStateChange(encoder_states))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_key_code_maps_to_its_reading_order_index() {
        for code in 0x01..=0x0Fu8 {
            let input = read_button_press(code, 1).unwrap();
            match input {
                DeviceInput::ButtonStateChange(states) => {
                    let pressed: Vec<usize> = states
                        .iter()
                        .enumerate()
                        .filter(|(_, s)| **s)
                        .map(|(i, _)| i)
                        .collect();
                    assert_eq!(pressed, vec![(code - 1) as usize]);
                }
                _ => panic!("expected a button state change"),
            }
        }
    }

    #[test]
    fn encoder_codes_are_distinct_and_cover_three_encoders() {
        for (code, encoder, dir) in [
            (0x50u8, 0usize, -1i8),
            (0x51, 0, 1),
            (0x90, 1, -1),
            (0x91, 1, 1),
            (0xA0, 2, -1),
            (0xA1, 2, 1),
        ] {
            match read_encoder_value(code).unwrap() {
                DeviceInput::EncoderTwist(vals) => {
                    assert_eq!(vals[encoder], dir, "code {:#04x}", code);
                    assert_eq!(vals.iter().filter(|v| **v != 0).count(), 1);
                }
                _ => panic!("expected an encoder twist"),
            }
        }
    }

    #[test]
    fn unknown_codes_are_rejected_rather_than_guessed() {
        assert!(process_input(0x77, 1).is_err());
        assert!(process_input(0xFF, 1).is_err());
    }
}
