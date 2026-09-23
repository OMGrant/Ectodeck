use std::time::Duration;

use data_url::DataUrl;
use image::DynamicImage;
use mirajazz::{device::Device, error::MirajazzError, state::DeviceStateUpdate};
use openaction::{OUTBOUND_EVENT_MANAGER, SetImageEvent};
use tokio_util::sync::CancellationToken;

use crate::{
    DEVICES, TOKENS, WRITE_GUARD,
    mappings::{COL_COUNT, CandidateDevice, ENCODER_COUNT, KEY_COUNT, ROW_COUNT},
};

/// Initializes a device and listens for events
pub async fn device_task(candidate: CandidateDevice, token: CancellationToken) {
    log::info!("Running device task for {:?}", candidate);

    // Wrap in a closure so we can use `?` operator
    let device = async || -> Result<Device, MirajazzError> {
        let device = connect(&candidate).await?;

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
    let layout = crate::layout::layout();
    if let Some(outbound) = OUTBOUND_EVENT_MANAGER.lock().await.as_mut() {
        // Sent raw rather than through `register_device`, because that helper
        // has no way to carry the fields OpenDeck's fork reads below.
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
                    // Where the keys sit on that panel, in panel pixels: the
                    // same geometry the plugin paints them with.
                    "panel": {
                        "width": crate::background::PANEL_WIDTH,
                        "height": crate::background::PANEL_HEIGHT,
                        // whole pixels: OpenDeck reads these as u16
                        "keys_x": layout.left.round() as u16,
                        "keys_y": layout.top.round() as u16,
                        "key_size": layout.key_px(),
                        "pitch_x": layout.pitch_x(),
                        "pitch_y": layout.pitch_y(),
                    },
                    "type": 0,
                }
            }))
            .await
            .unwrap();
    }

    DEVICES.write().await.insert(candidate.id.clone(), device);
    crate::frame::repaint(&candidate.id).await;

    tokio::select! {
        _ = device_events_task(&candidate) => {},
        _ = device_keep_alive_task(&candidate) => {},
        _ = token.cancelled() => {}
    };

    log::info!("Shutting down device {:?}", candidate);

    crate::frame::forget(&candidate.id).await;
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


/// Decode the image of a `setImage` event, if it carries one.
fn decode(image: Option<String>) -> Result<Option<DynamicImage>, MirajazzError> {
    let Some(image) = image else { return Ok(None) };
    // OpenDeck sends a data url; these unwraps mirror the reference plugins
    let url = DataUrl::process(image.as_str()).unwrap();
    let (body, _fragment) = url.decode_to_vec().unwrap();
    Ok(Some(image::load_from_memory(body.as_slice())?))
}

/// The display behind the keys, sent by OpenDeck as a `setImage` with a
/// "Background" controller and no position.
pub async fn handle_set_background(device_id: &str, evt: SetImageEvent) -> Result<(), MirajazzError> {
    crate::frame::set_background(device_id, decode(evt.image)?).await;
    Ok(())
}

/// An animated background, sent as a `setImage` with an "AnimatedBackground"
/// controller whose image field carries JSON: `{"kind":"web","url":...}` or
/// `{"kind":"shader","source":...}`. No image stops it.
pub async fn handle_animated_background(device_id: &str, evt: SetImageEvent) -> Result<(), MirajazzError> {
    let v: Option<serde_json::Value> = evt.image.as_deref().and_then(|s| serde_json::from_str(s).ok());
    let source = v.and_then(|v| {
        let text = |k: &str| v.get(k).and_then(|s| s.as_str()).map(str::to_owned);
        match v.get("kind").and_then(|k| k.as_str()) {
            Some("web") => text("url").map(crate::animation::Source::Web),
            Some("shader") => text("source").map(crate::animation::Source::Shader),
            _ => None,
        }
    });
    crate::frame::set_animation(device_id, source).await;
    Ok(())
}

/// The key style chosen in OpenDeck, sent as a `setImage` with a "KeyStyle"
/// controller whose image field carries JSON: `{"backdrop":bool}`.
pub async fn handle_key_style(device_id: &str, evt: SetImageEvent) -> Result<(), MirajazzError> {
    let v: serde_json::Value = evt
        .image
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let d = crate::frame::KeyStyle::default();
    let style = crate::frame::KeyStyle {
        backdrop: v.get("backdrop").and_then(|b| b.as_bool()).unwrap_or(d.backdrop),
    };
    crate::frame::set_style(device_id, style).await;
    Ok(())
}

/// A key image, a single key cleared, or every key cleared. None of these touch
/// the hardware directly: the frame repaints with the change in it.
pub async fn handle_set_image(device_id: &str, evt: SetImageEvent) -> Result<(), MirajazzError> {
    match (evt.position, evt.image) {
        (Some(position), image) => {
            let kind = image.as_deref().and_then(|i| i.split(';').next()).unwrap_or("clear");
            log::info!("Setting image for button {} ({})", position, kind);
            crate::frame::set_key(device_id, position, decode(image)?).await;
        }
        (None, None) => crate::frame::clear_keys(device_id).await,
        _ => {}
    }
    Ok(())
}
