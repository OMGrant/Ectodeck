use tauri::command;

use super::Error;
use crate::shared::DEVICES;
use crate::store::profiles::{AnimatedBackground, KeyStyle, acquire_locks_mut};

/// The Background Preset action: tell the interface, which knows each
/// background's presets, to switch the device's background by some steps.
/// The switch is an ordinary settings change, so it is saved and shown.
pub fn step_background_preset(device: &str, steps: i16) {
	use tauri::{Emitter, Manager};
	if let Some(window) = crate::APP_HANDLE.get().and_then(|app| app.get_webview_window("main")) {
		let _ = window.emit("background_preset", serde_json::json!({ "device": device, "steps": steps }));
	}
}

/// The image currently filling the display behind a device's keys, if any.
#[command]
pub async fn get_device_background(device: String) -> Result<Option<String>, Error> {
	let mut locks = acquire_locks_mut().await;
	Ok(locks.device_stores.get_background(&device)?)
}

/// Set or clear that image. Passing `None` clears it.
#[command]
pub async fn set_device_background(device: String, image: Option<String>) -> Result<(), Error> {
	if !DEVICES.contains_key(&device) {
		return Err(Error::new(format!("device {device} not found")));
	}

	{
		let mut locks = acquire_locks_mut().await;
		locks.device_stores.set_background(&device, image.clone())?;
	}

	crate::events::outbound::devices::update_background(device, image).await?;

	Ok(())
}

/// How key images sit on the display behind the keys.
#[command]
pub async fn get_device_key_style(device: String) -> Result<KeyStyle, Error> {
	let mut locks = acquire_locks_mut().await;
	Ok(locks.device_stores.get_key_style(&device)?)
}

#[command]
pub async fn set_device_key_style(device: String, style: KeyStyle) -> Result<(), Error> {
	if !DEVICES.contains_key(&device) {
		return Err(Error::new(format!("device {device} not found")));
	}

	{
		let mut locks = acquire_locks_mut().await;
		locks.device_stores.set_key_style(&device, style)?;
	}

	crate::events::outbound::devices::update_key_style(device, style).await?;

	Ok(())
}

/// The live background, if one is set.
#[command]
pub async fn get_device_animated_background(device: String) -> Result<Option<AnimatedBackground>, Error> {
	let mut locks = acquire_locks_mut().await;
	Ok(locks.device_stores.get_animated_background(&device)?)
}

/// The settings last chosen for the live background of this name on this
/// device, so choosing it again brings them back.
#[command]
pub async fn get_device_background_settings(device: String, name: String) -> Result<Option<serde_json::Map<String, serde_json::Value>>, Error> {
	let mut locks = acquire_locks_mut().await;
	Ok(locks.device_stores.get_background_settings(&device, &name)?)
}

/// Set or clear the live background. Passing `None` returns to the still one.
#[command]
pub async fn set_device_animated_background(device: String, background: Option<AnimatedBackground>) -> Result<(), Error> {
	if !DEVICES.contains_key(&device) {
		return Err(Error::new(format!("device {device} not found")));
	}

	{
		let mut locks = acquire_locks_mut().await;
		locks.device_stores.set_animated_background(&device, background.clone())?;
	}

	crate::events::outbound::devices::update_animated_background(device, background).await?;

	Ok(())
}

/// Keep an HTML file chosen as a live background in the configuration
/// directory, where the preview can load it, and return its path.
#[command]
pub async fn save_background_page(name: String, contents: String) -> Result<String, Error> {
	let dir = crate::shared::config_dir().join("backgrounds");
	std::fs::create_dir_all(&dir).map_err(anyhow::Error::from)?;
	let file = std::path::Path::new(&name).file_name().map(|n| n.to_owned()).unwrap_or_else(|| "background.html".into());
	let path = dir.join(file);
	std::fs::write(&path, contents).map_err(anyhow::Error::from)?;
	Ok(path.to_string_lossy().into_owned())
}

/// A key selected in the device view presses it for the live background too.
#[command]
pub async fn press_device_background(device: String, key: u8) -> Result<(), Error> {
	crate::events::outbound::devices::press_background(device, key).await?;
	Ok(())
}

/// Turn preview frames of the live background on while the device view is
/// visible, and off when it is not.
#[command]
pub async fn set_background_preview(device: String, on: bool) -> Result<(), Error> {
	crate::events::outbound::devices::set_background_preview(device, on).await?;
	Ok(())
}
