use tauri::command;

use super::Error;
use crate::shared::DEVICES;
use crate::store::profiles::{KeyStyle, acquire_locks_mut};

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
