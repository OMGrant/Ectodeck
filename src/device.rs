use std::time::Duration;

use data_url::DataUrl;
use image::load_from_memory_with_format;
use mirajazz::{device::Device, error::MirajazzError, state::DeviceStateUpdate};
use openaction::{OUTBOUND_EVENT_MANAGER, SetImageEvent};
use tokio_util::sync::CancellationToken;

use crate::{
    DEVICES, TOKENS, WRITE_GUARD,
    mappings::{
        COL_COUNT, CandidateDevice, ENCODER_COUNT, KEY_COUNT, Kind, ROW_COUNT, image_position,
    },
};

/// Initializes a device and listens for events
pub async fn device_task(candidate: CandidateDevice, token: CancellationToken) {
    log::info!("Running device task for {:?}", candidate);

    // Wrap in a closure so we can use `?` operator
    let device = async || -> Result<Device, MirajazzError> {
        let device = connect(&candidate).await?;

        // Two configuration commands VSD Craft sends on every connection,
        // captured from it byte for byte. The second reads as the magnetic
        // switch sensitivity; without it the deck runs at its power-on default
        // and a marginal switch can register presses by itself.
        let mut qucmd = vec![
            0x00, b'C', b'R', b'T', 0x00, 0x00, b'Q', b'U', b'C', b'M', b'D',
            0x1F, 0x11, 0x00, 0x11, 0x00, 0x11, 0x00,
        ];
        device.write_extended_data(&mut qucmd).await?;
        let mut sens = vec![
            0x00, b'C', b'R', b'T', 0x00, 0x00, b'S', b'E', b'N', b'S', 0x00, 0x01,
        ];
        device.write_extended_data(&mut sens).await?;

        // Brightness 100, matching the vendor. mirajazz's own init sends zero
        // first, so anything lower leaves the panel very dim.
        device.set_brightness(100).await?;

        // Deliberately not calling clear_all_button_images() here. On this
        // device a clear-all before the panel write leaves the panel blank,
        // where the vendor's own sequence (display, brightness, panel) shows it
        // correctly. The keys come up blank from power-on anyway.
        device.flush().await?;

        Ok(device)
    }()
    .await;

    let device: Device = match device {
        Ok(device) => device,
        Err(err) => {
            handle_error(&candidate.id, err).await;

            log::error!(
                "Had error during device init, finishing device task: {:?}",
                candidate
            );

            return;
        }
    };

    log::info!("Registering device {}", candidate.id);
    if let Some(outbound) = OUTBOUND_EVENT_MANAGER.lock().await.as_mut() {
        // Sent raw rather than through `register_device`, because that helper has
        // no touchpoint parameter, while OpenDeck's DeviceInfo deserialises one
        // and defaults it to zero. Declaring a single touchpoint gives the panel
        // its own labelled slot in the device view, at position ROW*COL, instead
        // of spending one of the fifteen keys on a button that is not a button.
        outbound
            .send_event(serde_json::json!({
                "event": "registerDevice",
                "payload": {
                    "id": candidate.id.clone(),
                    "name": candidate.kind.human_name(),
                    "rows": ROW_COUNT,
                    "columns": COL_COUNT,
                    "encoders": ENCODER_COUNT,
                    "touchpoints": 0,
                    "infobars": 0,
                    // The M3's three dials run down the right edge, not
                    // along the bottom as on a Stream Deck Plus.
                    "encoder_placement": "right",
                    // The keys are transparent windows onto one 854x480 panel.
                    "has_background": true,
                    // Where the key windows sit on that panel, in panel pixels.
                    // Measured from a photograph of the deck displaying a labelled
                    // 25-pixel grid: windows 110 square on a 167 pitch, both
                    // axes, the first starting at (38, 18). Columns therefore
                    // run 38, 205, 372, 539, 706 and rows 18, 185, 352.
                    "panel": {
                        "width": crate::background::PANEL_WIDTH,
                        "height": crate::background::PANEL_HEIGHT,
                        "keys_x": 38,
                        "keys_y": 18,
                        "key_size": 110,
                        "pitch_x": 167,
                        "pitch_y": 167,
                    },
                    "type": 0,
                }
            }))
            .await
            .unwrap();
    }

    DEVICES.write().await.insert(candidate.id.clone(), device);

    tokio::select! {
        _ = device_events_task(&candidate) => {},
        _ = device_keep_alive_task(&candidate) => {},
        _ = token.cancelled() => {}
    };

    log::info!("Shutting down device {:?}", candidate);


    if let Some(device) = DEVICES.read().await.get(&candidate.id) {
        device.shutdown().await.ok();
    }

    log::info!("Device task finished for {:?}", candidate);
}

/// Handles errors, returning true if should continue, returning false if an error is fatal
pub async fn handle_error(id: &String, err: MirajazzError) -> bool {
    log::error!("Device {} error: {}", id, err);

    // Some errors are not critical and can be ignored without sending disconnected event
    if matches!(err, MirajazzError::ImageError(_) | MirajazzError::BadData) {
        return true;
    }

    log::info!("Deregistering device {}", id);
    if let Some(outbound) = OUTBOUND_EVENT_MANAGER.lock().await.as_mut() {
        outbound.deregister_device(id.clone()).await.unwrap();
    }

    log::info!("Cancelling tasks for device {}", id);
    if let Some(token) = TOKENS.read().await.get(id) {
        token.cancel();
    }

    log::info!("Removing device {} from the list", id);
    DEVICES.write().await.remove(id);

    log::info!("Finished clean-up for {}", id);

    false
}

pub async fn connect(candidate: &CandidateDevice) -> Result<Device, MirajazzError> {
    let firmware_version = Device::read_firmware_version(&candidate.dev).await;

    let firmware_version = match firmware_version {
        Ok(fw) => fw,
        Err(e) => {
            log::error!("Failed to read firmware version from {}", &candidate.id);

            return Err(e);
        }
    };

    log::info!(
        "Connecting to {} with fw {:?}",
        &candidate.id,
        &firmware_version
    );

    let result = Device::connect(
        &candidate.dev,
        candidate.kind.protocol_version(),
        KEY_COUNT,
        ENCODER_COUNT,
    )
    .await;

    match result {
        Ok(device) => Ok(device),
        Err(e) => {
            log::error!("Error while connecting to device: {e}");

            Err(e)
        }
    }
}

/// Handles events from device to OpenDeck
async fn device_events_task(candidate: &CandidateDevice) -> Result<(), MirajazzError> {
    log::info!("Connecting to {} for incoming events", candidate.id);

    let devices_lock = DEVICES.read().await;
    let reader = match devices_lock.get(&candidate.id) {
        Some(device) => device.get_reader(crate::inputs::process_input),
        None => return Ok(()),
    };
    drop(devices_lock);

    log::info!("Connected to {} for incoming events", candidate.id);

    log::info!("Reader is ready for {}", candidate.id);

    loop {
        log::info!("Reading updates...");

        let updates = match reader.read(None).await {
            Ok(updates) => updates,
            Err(e) => {
                if !handle_error(&candidate.id, e).await {
                    break;
                }

                continue;
            }
        };

        for update in updates {
            log::info!("New update: {:#?}", update);

            let id = candidate.id.clone();

            if let Some(outbound) = OUTBOUND_EVENT_MANAGER.lock().await.as_mut() {
                match update {
                    DeviceStateUpdate::ButtonDown(key) => outbound.key_down(id, key).await.unwrap(),
                    DeviceStateUpdate::ButtonUp(key) => outbound.key_up(id, key).await.unwrap(),
                    DeviceStateUpdate::EncoderDown(encoder) => {
                        outbound.encoder_down(id, encoder).await.unwrap();
                    }
                    DeviceStateUpdate::EncoderUp(encoder) => {
                        outbound.encoder_up(id, encoder).await.unwrap();
                    }
                    DeviceStateUpdate::EncoderTwist(encoder, val) => {
                        outbound
                            .encoder_change(id, encoder, val as i16)
                            .await
                            .unwrap();
                    }
                }
            }
        }
    }

    Ok(())
}

pub async fn device_keep_alive_task(candidate: &CandidateDevice) -> Result<(), MirajazzError> {
    log::info!("Starting keep alive task for {}", candidate.id);

    // Wait before the first one. Otherwise a keep-alive lands between connect
    // and the first panel write, which the working sequence never does.
    tokio::time::sleep(Duration::from_secs(15)).await;

    loop {
        log::debug!("Sending keep alive request");

        let devices_lock = DEVICES.read().await;
        match devices_lock.get(&candidate.id) {
            Some(device) => {
                let _write = WRITE_GUARD.lock().await;
                device.keep_alive().await?
            }
            None => return Ok(()),
        };
        drop(devices_lock);

        tokio::time::sleep(Duration::from_secs(15)).await;
    }
}


/// Paints or clears the background layer behind the keys.
///
/// OpenDeck sends this as an ordinary `setImage` with a "Background" controller
/// and no position. The layer is independent of the keys: they composite onto
/// it, survive it being replaced, and show it through wherever they are clear.
pub async fn handle_set_background(
    device: &Device,
    _device_id: String,
    evt: SetImageEvent,
) -> Result<(), MirajazzError> {
    let _write = WRITE_GUARD.lock().await;

    match evt.image {
        Some(image) => {
            let url = DataUrl::process(image.as_str()).unwrap();
            let (body, _fragment) = url.decode_to_vec().unwrap();
            let decoded = image::load_from_memory(body.as_slice())?;
            crate::background::set_background(device, &decoded).await?;
        }
        None => {
            crate::background::clear_background(device).await?;
        }
    }

    Ok(())
}

/// Handles different combinations of "set image" event, including clearing the specific buttons and whole device
pub async fn handle_set_image(device: &Device, _device_id: String, evt: SetImageEvent) -> Result<(), MirajazzError> {
    let _write = WRITE_GUARD.lock().await;

    match (evt.position, evt.image) {
        (Some(position), Some(image)) => {
            log::info!("Setting image for button {}", position);

            // OpenDeck sends image as a data url, so parse it using a library
            let url = DataUrl::process(image.as_str()).unwrap(); // Isn't expected to fail, so unwrap it is
            let (body, _fragment) = url.decode_to_vec().unwrap(); // Same here

            // Allow only image/jpeg mime for now
            if url.mime_type().subtype != "jpeg" {
                log::error!("Incorrect mime type: {}", url.mime_type());

                return Ok(()); // Not a fatal error, enough to just log it
            }

            let image = load_from_memory_with_format(body.as_slice(), image::ImageFormat::Jpeg)?;
            let image = crate::offset::apply(image);

            device
                .set_button_image(
                    image_position(position),
                    Kind::from_vid_pid(device.vid, device.pid)
                        .unwrap()
                        .image_format(),
                    image,
                )
                .await?;
            device.flush().await?;
        }
        (Some(position), None) => {
            device.clear_button_image(image_position(position)).await?;
            device.flush().await?;
        }
        (None, None) => {
            device.clear_all_button_images().await?;
            device.flush().await?;
        }
        _ => {}
    }

    Ok(())
}
