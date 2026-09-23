use tauri::command;

use super::Error;
use crate::shared::DEVICES;
use crate::store::profiles::{AnimatedBackground, KeyStyle, acquire_locks_mut};

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
