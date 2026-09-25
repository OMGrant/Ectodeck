//! The weather now in a place, for shaders that show it: from Open-Meteo
//! (free, no account; CC BY 4.0), asked every quarter of an hour on a thread
//! of its own, and again as soon as the place changes. Offline, the last
//! report stands.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How often the weather is asked again for the same place.
const EVERY: Duration = Duration::from_secs(15 * 60);

/// One report, in the place's own time.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Report {
    /// The WMO weather code Open-Meteo gives (0 clear .. 99 thunderstorm with hail).
    pub code: i32,
    /// The wind or its gusts, whichever is stronger, in km/h.
    pub wind: f32,
    /// Sunrise and sunset, in seconds after the place's midnight.
    pub sunrise: f32,
    pub sunset: f32,
    /// The place's offset from UTC, in seconds.
    pub offset: i32,
}

/// The report in an Open-Meteo forecast reply asked for
/// `current=weather_code,wind_speed_10m,wind_gusts_10m&daily=sunrise,sunset&timezone=auto`.
pub fn parse(reply: &serde_json::Value) -> Option<Report> {
    let current = &reply["current"];
    let code = current["weather_code"].as_i64()? as i32;
    let wind = current["wind_speed_10m"].as_f64().unwrap_or(0.0).max(current["wind_gusts_10m"].as_f64().unwrap_or(0.0)) as f32;
    // local times as "2026-09-25T07:12"
    let clock = |v: &serde_json::Value| -> Option<f32> {
        let time = v.as_str()?.split('T').nth(1)?;
        let mut parts = time.split(':').map(|p| p.parse::<f32>().ok());
        let (h, m) = (parts.next()??, parts.next()??);
        Some(h * 3600.0 + m * 60.0)
    };
    Some(Report {
        code,
        wind,
        sunrise: clock(&reply["daily"]["sunrise"][0]).unwrap_or(6.0 * 3600.0),
        sunset: clock(&reply["daily"]["sunset"][0]).unwrap_or(18.0 * 3600.0),
        offset: reply["utc_offset_seconds"].as_i64().unwrap_or(0) as i32,
    })
}

pub fn ask(lat: f32, lon: f32) -> Result<Report, String> {
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?current=weather_code,wind_speed_10m,wind_gusts_10m&daily=sunrise,sunset&timezone=auto&forecast_days=1&latitude={lat}&longitude={lon}"
    );
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(20))).build().into();
    let text = agent.get(&url).call().map_err(|e| e.to_string())?.body_mut().read_to_string().map_err(|e| e.to_string())?;
    let reply: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    parse(&reply).ok_or_else(|| "Open-Meteo's reply had no current weather".into())
}

/// The place a shader's settings name: the app saves a chosen city as its
/// name under NAME and its latitude and longitude under NAME + "At", as
/// `[lat, lon]` (or "lat,lon").
pub fn place_in(params: &serde_json::Map<String, serde_json::Value>, name: &str) -> Option<(f32, f32)> {
    let v = params.get(&format!("{name}At"))?;
    let pair: Vec<f64> = match v {
        serde_json::Value::Array(a) => a.iter().filter_map(|x| x.as_f64()).collect(),
        serde_json::Value::String(s) => s.split(',').filter_map(|x| x.trim().parse().ok()).collect(),
        _ => vec![],
    };
    match pair[..] {
        [lat, lon] if lat.is_finite() && lon.is_finite() => Some((lat as f32, lon as f32)),
        _ => None,
    }
}

/// Keeps the weather for one place up to date while it runs.
pub struct Feed {
    place: Arc<Mutex<Option<(f32, f32)>>>,
    report: Arc<Mutex<Option<Report>>>,
    stop: Arc<AtomicBool>,
}

impl Feed {
    pub fn start() -> Feed {
        let place: Arc<Mutex<Option<(f32, f32)>>> = Arc::default();
        let report: Arc<Mutex<Option<Report>>> = Arc::default();
        let stop = Arc::new(AtomicBool::new(false));
        let (p, r, s) = (place.clone(), report.clone(), stop.clone());
        let _ = std::thread::Builder::new().name("weather".into()).spawn(move || {
            let mut asked: Option<((f32, f32), Instant)> = None;
            while !s.load(Ordering::SeqCst) {
                let now = p.lock().ok().and_then(|p| *p);
                if let Some(at) = now {
                    let due = asked.is_none_or(|(was, when)| was != at || when.elapsed() >= EVERY);
                    if due {
                        match ask(at.0, at.1) {
                            Ok(report) => {
                                if let Ok(mut r) = r.lock() {
                                    *r = Some(report);
                                }
                                asked = Some((at, Instant::now()));
                            }
                            Err(e) => {
                                log::warn!("Weather for {at:?} not fetched: {e}");
                                // try again in a minute, keeping the last report
                                asked = Some((at, Instant::now() - EVERY + Duration::from_secs(60)));
                            }
                        }
                    }
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        });
        Feed { place, report, stop }
    }

    /// Follow the place, if it changed; a new place is asked for at once.
    pub fn set_place(&self, at: Option<(f32, f32)>) {
        if let Ok(mut p) = self.place.lock() {
            if *p != at {
                *p = at;
                if let Ok(mut r) = self.report.lock() {
                    *r = None;
                }
            }
        }
    }

    pub fn report(&self) -> Option<Report> {
        self.report.lock().ok().and_then(|r| *r)
    }
}

impl Drop for Feed {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_open_meteo_reply() {
        let reply = serde_json::json!({
            "utc_offset_seconds": -14400,
            "current": { "weather_code": 73, "wind_speed_10m": 31.5, "wind_gusts_10m": 58.0 },
            "daily": { "sunrise": ["2026-09-25T07:12"], "sunset": ["2026-09-25T19:18"] }
        });
        assert_eq!(parse(&reply), Some(Report { code: 73, wind: 58.0, sunrise: 7.0 * 3600.0 + 12.0 * 60.0, sunset: 19.0 * 3600.0 + 18.0 * 60.0, offset: -14400 }));
        assert_eq!(parse(&serde_json::json!({ "error": true })), None);
    }

    #[test]
    fn reads_the_place_from_settings() {
        let mut params = serde_json::Map::new();
        assert_eq!(place_in(&params, "place"), None);
        params.insert("placeAt".into(), serde_json::json!([27.95, -82.46]));
        assert_eq!(place_in(&params, "place"), Some((27.95, -82.46)));
        params.insert("placeAt".into(), serde_json::json!("51.5, -0.12"));
        assert_eq!(place_in(&params, "place"), Some((51.5, -0.12)));
        params.insert("placeAt".into(), serde_json::json!(""));
        assert_eq!(place_in(&params, "place"), None);
    }
}
