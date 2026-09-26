//! The weather now in a place, for shaders that show it: from Open-Meteo
//! (free, no account; CC BY 4.0), the weather and the air, asked every
//! quarter of an hour, and in the United States the warnings in force there
//! from the National Weather Service (free, public domain), asked every
//! three minutes, as a tornado warning lasts under an hour. All on a thread
//! of its own, and again as soon as the place changes. Offline, the last
//! report stands.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How often the weather is asked again for the same place.
const EVERY: Duration = Duration::from_secs(15 * 60);
/// How often the warnings are asked again.
const ALERTS_EVERY: Duration = Duration::from_secs(3 * 60);

/// The most serious warning in force at the place, as the National Weather
/// Service issues them.
pub const NO_ALERT: i32 = 0;
pub const TROPICAL_STORM_WARNING: i32 = 1;
pub const HURRICANE_WARNING: i32 = 2;
pub const TORNADO_WARNING: i32 = 3;

/// One report, in the place's own time.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
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
    /// How much of the sky is cloud, 0 to 1.
    pub cloud: f32,
    /// Rain, showers and snow falling now, each in mm an hour of water (snow as
    /// the rain it would melt to).
    pub rain: f32,
    pub showers: f32,
    pub snow: f32,
    /// The steady wind in km/h, and the way it blows from, in degrees from north.
    pub wind_speed: f32,
    pub wind_from: f32,
    /// How far one can see, in km, and the temperature, in degrees Celsius.
    pub visibility: f32,
    pub temperature: f32,
    /// The air: fine particles (PM2.5) and dust in micrograms a cubic metre, and
    /// the aerosol optical depth (haze or smoke), with whether it has come.
    pub pm25: f32,
    pub dust: f32,
    pub haze: f32,
    pub air_known: bool,
    /// The most serious warning in force, one of the constants above.
    pub alert: i32,
}

const CURRENT: &str = "weather_code,cloud_cover,rain,showers,snowfall,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,temperature_2m";

/// The report in an Open-Meteo forecast reply asked for `current=` [CURRENT]
/// `&daily=sunrise,sunset&timezone=auto`.
pub fn parse(reply: &serde_json::Value) -> Option<Report> {
    let current = &reply["current"];
    let code = current["weather_code"].as_i64()? as i32;
    let n = |k: &str| current[k].as_f64().unwrap_or(0.0) as f32;
    let wind = n("wind_speed_10m").max(n("wind_gusts_10m"));
    // the current amounts cover the fifteen minutes before, so four times them
    // is the rate an hour; snowfall comes in cm, about a tenth of that in water
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
        cloud: n("cloud_cover") / 100.0,
        rain: n("rain") * 4.0,
        showers: n("showers") * 4.0,
        snow: n("snowfall") * 4.0 * 10.0 * 0.1,
        wind_speed: n("wind_speed_10m"),
        wind_from: n("wind_direction_10m"),
        visibility: current["visibility"].as_f64().map_or(20.0, |v| v as f32 / 1000.0),
        temperature: n("temperature_2m"),
        ..Report::default()
    })
}

/// The air in an Open-Meteo air quality reply asked for
/// `current=pm2_5,dust,aerosol_optical_depth`: PM2.5, dust, optical depth.
pub fn parse_air(reply: &serde_json::Value) -> Option<(f32, f32, f32)> {
    let c = &reply["current"];
    Some((c["pm2_5"].as_f64()? as f32, c["dust"].as_f64().unwrap_or(0.0) as f32, c["aerosol_optical_depth"].as_f64().unwrap_or(0.0) as f32))
}

/// The most serious warning in a National Weather Service alerts reply.
pub fn parse_alerts(reply: &serde_json::Value) -> i32 {
    let mut worst = NO_ALERT;
    for f in reply["features"].as_array().into_iter().flatten() {
        let rank = match f["properties"]["event"].as_str().unwrap_or("") {
            "Tornado Warning" => TORNADO_WARNING,
            "Hurricane Warning" | "Extreme Wind Warning" => HURRICANE_WARNING,
            "Tropical Storm Warning" => TROPICAL_STORM_WARNING,
            _ => NO_ALERT,
        };
        worst = worst.max(rank);
    }
    worst
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(20))).build().into()
}
fn get_json(url: &str, user_agent: Option<&str>) -> Result<serde_json::Value, String> {
    let mut request = agent().get(url);
    if let Some(ua) = user_agent {
        request = request.header("User-Agent", ua).header("Accept", "application/geo+json");
    }
    let text = request.call().map_err(|e| e.to_string())?.body_mut().read_to_string().map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// The warnings in force at a place in the United States, or None elsewhere
/// (or when the service cannot be reached).
pub fn ask_alerts(lat: f32, lon: f32) -> Option<i32> {
    // the service asks every caller to name itself
    let reply = get_json(&format!("https://api.weather.gov/alerts/active?point={lat:.4},{lon:.4}"), Some("Ectodeck (github.com/OMGrant/Ectodeck)")).ok()?;
    reply.get("features").map(|_| parse_alerts(&reply))
}

/// The weather and the air at a place (the air left unknown if it cannot be had).
pub fn ask(lat: f32, lon: f32) -> Result<Report, String> {
    let reply = get_json(&format!("https://api.open-meteo.com/v1/forecast?current={CURRENT}&daily=sunrise,sunset&timezone=auto&forecast_days=1&latitude={lat}&longitude={lon}"), None)?;
    let mut report = parse(&reply).ok_or("Open-Meteo's reply had no current weather")?;
    if let Some((pm25, dust, haze)) = get_json(&format!("https://air-quality-api.open-meteo.com/v1/air-quality?current=pm2_5,dust,aerosol_optical_depth&latitude={lat}&longitude={lon}"), None).ok().as_ref().and_then(parse_air) {
        (report.pm25, report.dust, report.haze, report.air_known) = (pm25, dust, haze, true);
    }
    Ok(report)
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
            // warnings: when last asked, and whether the place has them at all
            // (outside the United States the service answers nothing)
            let mut alerts: Option<((f32, f32), Instant, bool)> = None;
            let mut alert = NO_ALERT;
            while !s.load(Ordering::SeqCst) {
                let now = p.lock().ok().and_then(|p| *p);
                if let Some(at) = now {
                    let alerts_due = alerts.is_none_or(|(was, when, served)| was != at || (served && when.elapsed() >= ALERTS_EVERY));
                    if alerts_due {
                        let found = ask_alerts(at.0, at.1);
                        let fresh = alerts.is_none_or(|(was, ..)| was != at);
                        // a place asked for the first time that has no answer is outside the service
                        let served = found.is_some() || (!fresh && alerts.is_some_and(|(.., s)| s));
                        alert = found.unwrap_or(if served { alert } else { NO_ALERT });
                        alerts = Some((at, Instant::now(), served));
                        if let Ok(mut r) = r.lock() {
                            if let Some(report) = r.as_mut() {
                                report.alert = alert;
                            }
                        }
                    }
                    let due = asked.is_none_or(|(was, when)| was != at || when.elapsed() >= EVERY);
                    if due {
                        match ask(at.0, at.1) {
                            Ok(mut report) => {
                                report.alert = alert;
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
            "current": { "weather_code": 73, "wind_speed_10m": 31.5, "wind_gusts_10m": 58.0, "wind_direction_10m": 270, "cloud_cover": 85,
                         "rain": 0.5, "showers": 0.0, "snowfall": 0.2, "visibility": 1800.0, "temperature_2m": -3.5 },
            "daily": { "sunrise": ["2026-09-25T07:12"], "sunset": ["2026-09-25T19:18"] }
        });
        let r = parse(&reply).unwrap();
        assert_eq!((r.code, r.wind, r.offset), (73, 58.0, -14400));
        assert_eq!((r.sunrise, r.sunset), (7.0 * 3600.0 + 12.0 * 60.0, 19.0 * 3600.0 + 18.0 * 60.0));
        assert_eq!((r.cloud, r.rain, r.wind_speed, r.wind_from, r.visibility, r.temperature), (0.85, 2.0, 31.5, 270.0, 1.8, -3.5));
        assert!((r.snow - 0.8).abs() < 1e-5);
        assert_eq!(parse(&serde_json::json!({ "error": true })), None);
        assert_eq!(parse_air(&serde_json::json!({ "current": { "pm2_5": 35.5, "dust": 12.0, "aerosol_optical_depth": 0.9 } })), Some((35.5, 12.0, 0.9)));
    }

    #[test]
    fn reads_the_worst_warning() {
        let alerts = |events: &[&str]| serde_json::json!({ "features": events.iter().map(|e| serde_json::json!({ "properties": { "event": e } })).collect::<Vec<_>>() });
        assert_eq!(parse_alerts(&alerts(&[])), NO_ALERT);
        assert_eq!(parse_alerts(&alerts(&["Flood Watch", "Tropical Storm Warning"])), TROPICAL_STORM_WARNING);
        assert_eq!(parse_alerts(&alerts(&["Hurricane Warning", "Tornado Warning", "Heat Advisory"])), TORNADO_WARNING);
        assert_eq!(parse_alerts(&alerts(&["Tornado Watch"])), NO_ALERT);
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
