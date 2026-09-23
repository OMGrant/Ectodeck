use device::{handle_error, handle_set_image};
use mirajazz::device::Device;
use openaction::*;
use std::{collections::HashMap, process::exit, sync::LazyLock};
use tokio::sync::{Mutex, RwLock};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use watcher::watcher_task;

#[cfg(not(target_os = "windows"))]
use tokio::signal::unix::{SignalKind, signal};

mod animation;
mod background;
mod device;
mod inputs;
mod mappings;
mod shader;
mod frame;
mod layout;
mod watcher;

pub static DEVICES: LazyLock<RwLock<HashMap<String, Device>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));
/// Serialises every multi-packet write to the hardware. A panel write is
/// dozens of packets and a key write landing in the middle of it corrupts the
/// transfer, so nothing touches the device without holding this.
pub static WRITE_GUARD: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

pub static TOKENS: LazyLock<RwLock<HashMap<String, CancellationToken>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));
pub static TRACKER: LazyLock<Mutex<TaskTracker>> = LazyLock::new(|| Mutex::new(TaskTracker::new()));

struct GlobalEventHandler {}
impl openaction::GlobalEventHandler for GlobalEventHandler {
    async fn plugin_ready(
        &self,
        _outbound: &mut openaction::OutboundEventManager,
    ) -> EventHandlerResult {
        let tracker = TRACKER.lock().await.clone();

        let token = CancellationToken::new();
        tracker.spawn(watcher_task(token.clone()));
        tracker.spawn(frame::watch_layout(token.clone()));

        TOKENS
            .write()
            .await
            .insert("_watcher_task".to_string(), token);

        log::info!("Plugin initialized");

        Ok(())
    }

    async fn set_image(
        &self,
        event: SetImageEvent,
        _outbound: &mut OutboundEventManager,
    ) -> EventHandlerResult {
        log::debug!("Asked to set image: {:#?}", event);

        // Skip knobs images
        if event.controller == Some("Encoder".to_string()) {
            log::debug!("Looks like a knob, no need to set image");
            return Ok(());
        }

        let id = event.device.clone();
        let result = if event.controller == Some("Background".to_string()) {
            device::handle_set_background(&id, event).await
        } else if event.controller == Some("BackgroundPreview".to_string()) {
            device::handle_background_preview(&id, event).await
        } else if event.controller == Some("AnimatedBackground".to_string()) {
            device::handle_animated_background(&id, event).await
        } else if event.controller == Some("KeyStyle".to_string()) {
            device::handle_key_style(&id, event).await
        } else {
            handle_set_image(&id, event).await
        };
        if let Err(error) = result {
            handle_error(&id, error).await;
        }

        Ok(())
    }

    async fn set_brightness(
        &self,
        event: SetBrightnessEvent,
        _outbound: &mut OutboundEventManager,
    ) -> EventHandlerResult {
        log::debug!("Asked to set brightness: {:#?}", event);

        let id = event.device.clone();
        frame::set_paused(&id, event.brightness == 0).await;

        if let Some(device) = DEVICES.read().await.get(&event.device) {
            device
                .set_brightness(event.brightness)
                .await
                .map_err(async |err| handle_error(&id, err).await)
                .ok();
        } else {
            log::error!("Received event for unknown device: {}", event.device);
        }

        Ok(())
    }

    async fn system_did_wake_up(
        &self,
        _event: SystemDidWakeUpEvent,
        outbound: &mut OutboundEventManager,
    ) -> EventHandlerResult {
        log::info!("The system is woke now, resetting devices");

        let devices = DEVICES.write().await;

        for (id, device) in devices.iter() {
            let _ = device.reset().await;
            let _ = outbound.rerender_images(id.to_string()).await;
        }

        Ok(())
    }
}

struct ActionEventHandler {}
impl openaction::ActionEventHandler for ActionEventHandler {}

async fn shutdown() {
    let tokens = TOKENS.write().await;

    for (_, token) in tokens.iter() {
        token.cancel();
    }
}

async fn connect() {
    if let Err(error) = init_plugin(GlobalEventHandler {}, ActionEventHandler {}).await {
        log::error!("Failed to initialize plugin: {}", error);
        exit(1);
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
async fn sigterm() -> Result<(), Box<dyn std::error::Error>> {
    let mut sig = signal(SignalKind::terminate())?;

    sig.recv().await;

    Ok(())
}

#[cfg(target_os = "windows")]
async fn sigterm() -> Result<(), Box<dyn std::error::Error>> {
    // Future that would never resolve, so select only acts on OpenDeck connection loss
    // TODO: Proper windows termination handling
    std::future::pending::<()>().await;

    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    simplelog::TermLogger::init(
        simplelog::LevelFilter::Info,
        simplelog::Config::default(),
        simplelog::TerminalMode::Stdout,
        simplelog::ColorChoice::Never,
    )
    .unwrap();

    tokio::select! {
        _ = connect() => {},
        _ = sigterm() => {},
    }

    log::info!("Shutting down");

    shutdown().await;

    let tracker = TRACKER.lock().await.clone();

    log::info!("Waiting for tasks to finish");

    tracker.close();
    tracker.wait().await;

    log::info!("Tasks are finished, exiting now");

    Ok(())
}
