use super::{send_to_all_plugins, send_to_plugin};

use crate::encoder_layouts::generate_encoder_image;
use crate::plugins::{DEVICE_NAMESPACES, info_param::DeviceInfo};

use base64::Engine;
use image::ImageFormat;
use serde::Serialize;
use std::io::Cursor;

#[derive(Serialize)]
#[allow(non_snake_case)]
struct DeviceDidConnectEvent {
	event: &'static str,
	device: String,
	deviceInfo: DeviceInfo,
}

pub async fn device_did_connect(id: &str, info: DeviceInfo) -> Result<(), anyhow::Error> {
	send_to_all_plugins(&DeviceDidConnectEvent {
		event: "deviceDidConnect",
		device: id.to_owned(),
		deviceInfo: info,
	})
	.await
}

#[derive(Serialize)]
struct DeviceDidDisconnectEvent {
	event: &'static str,
	device: String,
}

pub async fn device_did_disconnect(id: &str) -> Result<(), anyhow::Error> {
	send_to_all_plugins(&DeviceDidDisconnectEvent {
		event: "deviceDidDisconnect",
		device: id.to_owned(),
	})
	.await
}

#[derive(Serialize)]
struct SetImageEvent {
	event: &'static str,
	device: String,
	controller: Option<String>,
	position: Option<u8>,
	image: Option<String>,
}

pub async fn update_image(context: crate::shared::Context, image: Option<String>) -> Result<(), anyhow::Error> {
	if let Some(plugin) = DEVICE_NAMESPACES.read().await.get(&context.device[..2]) {
		let image = match (context.controller.as_str(), image) {
			("Encoder", Some(img)) => Some(to_encoder_jpeg_data_uri(&context, &img).await?),
			(_, img) => img,
		};

		send_to_plugin(
			plugin,
			&SetImageEvent {
				event: "setImage",
				device: context.device,
				controller: Some(context.controller),
				position: Some(context.position),
				image,
			},
		)
		.await?;
	} else if context.device.starts_with("sd-") {
		crate::elgato::update_image(&context, image.as_deref()).await?;
	}

	Ok(())
}

async fn to_encoder_jpeg_data_uri(context: &crate::shared::Context, image: &str) -> Result<String, anyhow::Error> {
	let data = image.split_once(',').unwrap().1;
	let bytes = base64::engine::general_purpose::STANDARD.decode(data)?;

	let img = generate_encoder_image(context, &bytes).await?;

	let mut buf = Vec::new();
	img.write_to(&mut Cursor::new(&mut buf), ImageFormat::Jpeg)?;
	let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);

	Ok(format!("data:image/jpeg;base64,{encoded}"))
}

/// Push the image for the display behind a device's keys.
///
/// Reuses the existing `setImage` event with a "Background" controller and no
/// position, so no new event type is needed and plugins built against the
/// published crate can handle it without changes.
pub async fn update_background(device: String, image: Option<String>) -> Result<(), anyhow::Error> {
	if let Some(plugin) = DEVICE_NAMESPACES.read().await.get(&device[..2]) {
		send_to_plugin(
			plugin,
			&SetImageEvent {
				event: "setImage",
				device,
				controller: Some("Background".to_owned()),
				position: None,
				image,
			},
		)
		.await?;
	}

	Ok(())
}

/// Push how key images sit on the display behind the keys.
///
/// Like the background, this rides on `setImage`, with a "KeyStyle"
/// controller and the style as JSON in the image field, so a plugin that does
/// not know it simply ignores a controller it does not recognise.
pub async fn update_key_style(device: String, style: crate::store::profiles::KeyStyle) -> Result<(), anyhow::Error> {
	if let Some(plugin) = DEVICE_NAMESPACES.read().await.get(&device[..2]) {
		send_to_plugin(
			plugin,
			&SetImageEvent {
				event: "setImage",
				device,
				controller: Some("KeyStyle".to_owned()),
				position: None,
				image: Some(serde_json::to_string(&style)?),
			},
		)
		.await?;
	}

	Ok(())
}

/// Push the live background, or `None` to stop it. Rides on `setImage` with an
/// "AnimatedBackground" controller; the image field carries JSON the plugin
/// reads as `{"kind":"web","url":...}` or `{"kind":"shader","source":...}`.
/// Pages kept on disk are sent as file URLs, which the plugin's renderer
/// opens directly.
pub async fn update_animated_background(device: String, background: Option<crate::store::profiles::AnimatedBackground>) -> Result<(), anyhow::Error> {
	use crate::store::profiles::AnimatedBackground;
	let image = match background {
		None => None,
		Some(AnimatedBackground::Web { url, params, .. }) => {
			let url = if url.starts_with('/') { format!("file://{url}") } else { url };
			Some(serde_json::json!({ "kind": "web", "url": url, "params": params }).to_string())
		}
		Some(AnimatedBackground::Shader { source, params, .. }) => Some(serde_json::json!({ "kind": "shader", "source": source, "params": params }).to_string()),
	};
	if let Some(plugin) = DEVICE_NAMESPACES.read().await.get(&device[..2]) {
		send_to_plugin(
			plugin,
			&SetImageEvent {
				event: "setImage",
				device,
				controller: Some("AnimatedBackground".to_owned()),
				position: None,
				image,
			},
		)
		.await?;
	}

	Ok(())
}

/// Ask the plugin to send, or stop sending, preview frames of the live
/// background. The window turns this on only while it is showing.
pub async fn set_background_preview(device: String, on: bool) -> Result<(), anyhow::Error> {
	if let Some(plugin) = DEVICE_NAMESPACES.read().await.get(&device[..2]) {
		send_to_plugin(
			plugin,
			&SetImageEvent {
				event: "setImage",
				device,
				controller: Some("BackgroundPreview".to_owned()),
				position: None,
				image: on.then(|| "on".to_owned()),
			},
		)
		.await?;
	}

	Ok(())
}

/// A key pressed in the window: the plugin passes it to the live background as
/// a press of that key on the deck, so the background reacts as it would.
pub async fn press_background(device: String, key: u8) -> Result<(), anyhow::Error> {
	if let Some(plugin) = DEVICE_NAMESPACES.read().await.get(&device[..2]) {
		send_to_plugin(
			plugin,
			&SetImageEvent {
				event: "setImage",
				device,
				controller: Some("BackgroundPress".to_owned()),
				position: Some(key),
				image: None,
			},
		)
		.await?;
	}

	Ok(())
}

pub async fn clear_screen(device: String) -> Result<(), anyhow::Error> {
	if let Some(plugin) = DEVICE_NAMESPACES.read().await.get(&device[..2]) {
		send_to_plugin(
			plugin,
			&SetImageEvent {
				event: "setImage",
				device,
				controller: None,
				position: None,
				image: None,
			},
		)
		.await?;
	} else if device.starts_with("sd-") {
		crate::elgato::clear_screen(&device).await?;
	}

	Ok(())
}

#[derive(Serialize)]
struct SetBrightnessEvent {
	event: &'static str,
	device: String,
	brightness: u8,
}

/// Set the brightness for all devices.
pub async fn set_brightness(brightness: u8) -> Result<(), anyhow::Error> {
	for device in crate::shared::DEVICES.iter() {
		set_device_brightness(&device.id, brightness).await?;
	}

	Ok(())
}

/// Set the brightness for a specific device.
pub async fn set_device_brightness(device: &str, brightness: u8) -> Result<(), anyhow::Error> {
	if crate::device_sleep::is_device_sleeping(device) {
		return Ok(());
	}

	if let Some(plugin) = DEVICE_NAMESPACES.read().await.get(&device[..2]) {
		send_to_plugin(
			plugin,
			&SetBrightnessEvent {
				event: "setBrightness",
				device: device.to_owned(),
				brightness,
			},
		)
		.await?;
	} else if device.starts_with("sd-") {
		crate::elgato::set_brightness(device, brightness).await;
	}

	Ok(())
}
