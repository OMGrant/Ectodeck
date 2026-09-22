//! Calibration aid: panel geometry overrides for a device, read from a file
//! and applied live.
//!
//! A plugin declares where its keys sit on a display behind them, but that
//! geometry is hard to get right without seeing the result. This polls
//! `<config>/panel-overrides.json`, a map of device id to PanelInfo, and when
//! it changes, replaces the panel of each named device and pushes the device
//! list to the frontend, so the device view re-lays itself out at once. Values
//! found here win over what the plugin declared until the file is removed.

use std::collections::HashMap;
use std::time::Duration;

use crate::shared::{config_dir, PanelInfo, DEVICES};

pub fn init_panel_overrides() {
	tokio::spawn(async move {
		let path = config_dir().join("panel-overrides.json");
		let mut last: Option<String> = None;

		loop {
			tokio::time::sleep(Duration::from_secs(1)).await;

			let contents = match std::fs::read_to_string(&path) {
				Ok(c) => c,
				Err(_) => continue,
			};
			if last.as_deref() == Some(contents.as_str()) {
				continue;
			}

			let overrides: HashMap<String, PanelInfo> = match serde_json::from_str(&contents) {
				Ok(o) => o,
				Err(e) => {
					log::warn!("panel-overrides.json is not valid: {}", e);
					last = Some(contents);
					continue;
				}
			};

			let mut changed = false;
			for (id, panel) in overrides {
				if let Some(mut device) = DEVICES.get_mut(&id) {
					log::info!("Applying panel override for {}", id);
					device.panel = Some(panel);
					changed = true;
				}
			}
			if changed {
				crate::events::frontend::update_devices().await;
			}
			last = Some(contents);
		}
	});
}
