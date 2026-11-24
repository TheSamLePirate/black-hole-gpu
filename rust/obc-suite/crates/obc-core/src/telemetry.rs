//! Strongly-typed OBC avionics telemetry matching `src/obc/types.ts` (`ObcTelemetry` v1).
//! The field names are checked against the TypeScript, Python and Node schemas by
//! `tests/obc-telemetry-contract.test.ts`: a field added on one side only fails that test.

use crate::units::UnitSys;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

pub const TELEMETRY_PATH: &str = "/obc/telemetry.json";
pub const TAU_PATH: &str = "/obc/tau";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Position {
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub height_ellipsoid_m: f64,
    pub altitude_msl_m: f64,
    pub height_over_ground_m: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Attitude {
    pub heading_deg: f64,
    pub pitch_deg: f64,
    pub roll_deg: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Flight {
    pub true_airspeed_mps: f64,
    pub ground_speed_mps: f64,
    pub vertical_speed_mps: f64,
    pub mach: f64,
    pub dynamic_pressure_pa: f64,
    pub alpha_deg: f64,
    pub beta_deg: f64,
    pub g_load: f64,
    pub stalled: bool,
    pub on_ground: bool,
    pub hull_temp_k: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Orbit {
    pub body: String,
    pub apoapsis_m: f64,
    pub periapsis_m: f64,
    pub semi_major_m: f64,
    pub eccentricity: f64,
    pub inclination_deg: f64,
    pub period_s: f64,
    pub speed_mps: f64,
    pub altitude_m: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Systems {
    pub throttle: f64,
    pub fuel_frac: f64,
    pub fuel_kg: Option<f64>,
    pub gear: f64,
    pub flaps: f64,
    pub sas: bool,
    pub autopilot: String,
    pub hold: String,
    pub rcs_mode: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct RunwayNav {
    pub ident: String,
    pub name: String,
    pub dist_m: f64,
    pub loc_deg: f64,
    pub gs_deg: f64,
    pub elev_m: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Nav {
    pub target: Option<String>,
    pub runway: Option<RunwayNav>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Telemetry {
    pub v: u32,
    pub wall_ms: f64,
    pub sim_time_s: f64,
    pub sim_dt: f64,
    pub warp: f64,
    pub frozen: bool,
    pub dtau_dt: f64,
    pub proper_time_s: f64,
    pub vessel_id: String,
    pub vessel_kind: String,
    pub body: String,
    /// The player's display units (`"metric"` default | `"imperial"`), `settings.units` in the simulator.
    pub units: String,
    pub position: Position,
    pub attitude: Attitude,
    pub flight: Flight,
    pub orbit: Option<Orbit>,
    pub systems: Systems,
    pub nav: Nav,
}

impl Default for Telemetry {
    fn default() -> Self {
        Self {
            v: 1,
            wall_ms: 0.0,
            sim_time_s: 0.0,
            sim_dt: 0.0,
            warp: 1.0,
            frozen: false,
            dtau_dt: 1.0,
            proper_time_s: 0.0,
            vessel_id: "unknown".into(),
            vessel_kind: "free".into(),
            body: "earth".into(),
            units: "metric".into(),
            position: Position::default(),
            attitude: Attitude::default(),
            flight: Flight::default(),
            orbit: None,
            systems: Systems::default(),
            nav: Nav::default(),
        }
    }
}

impl Telemetry {
    /// Read and parse `/obc/telemetry.json`, falling back to `prev` on transient 9p read races.
    #[must_use]
    pub fn read_or_keep(path: impl AsRef<Path>, prev: &Self) -> Self {
        let Ok(raw) = fs::read_to_string(path) else {
            return prev.clone();
        };
        let trimmed = raw.trim_end_matches(['\0', ' ', '\n', '\r', '\t']);
        serde_json::from_str::<Self>(trimmed).unwrap_or_else(|_| prev.clone())
    }

    /// True if active craft is an atmospheric aircraft (F-35 / A320 / CRJ / etc.).
    #[must_use]
    pub fn is_aircraft(&self) -> bool {
        self.vessel_kind == "aircraft"
            || self.vessel_id.starts_with("f35")
            || self.vessel_id.starts_with("a320")
    }

    /// Wrapped compass heading in `[0, 360)`.
    #[must_use]
    pub fn heading_wrapped(&self) -> f64 {
        self.attitude.heading_deg.rem_euclid(360.0)
    }

    /// The display units: the player's choice (metric unless imperial), `OBC_UNITS` overriding it.
    #[must_use]
    pub fn unit_sys(&self) -> UnitSys {
        UnitSys::resolve(&self.units)
    }

    /// True airspeed in knots (imperial displays; prefer `unit_sys().spd(..)`).
    #[must_use]
    pub fn tas_knots(&self) -> f64 {
        self.flight.true_airspeed_mps * 1.943_844_492_44
    }

    /// Altitude MSL in feet.
    #[must_use]
    pub fn alt_msl_feet(&self) -> f64 {
        self.position.altitude_msl_m * 3.280_839_895
    }

    /// Vertical speed in feet per minute.
    #[must_use]
    pub fn vs_fpm(&self) -> f64 {
        self.flight.vertical_speed_mps * 196.850_393_7
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_padded_telemetry_json() {
        let raw = format!(
            "{}{}",
            r#"{"v":1,"vessel_id":"f35b","vessel_kind":"aircraft","body":"earth","attitude":{"heading_deg":241.3,"pitch_deg":-5.6,"roll_deg":-29.9},"flight":{"true_airspeed_mps":205.78,"mach":0.62,"g_load":1.15},"position":{"altitude_msl_m":1828.8,"height_over_ground_m":1750.0},"systems":{"throttle":0.65,"fuel_frac":0.92,"gear":0,"autopilot":"ap"}}"#,
            " ".repeat(256)
        );
        let dir = std::env::temp_dir().join("obc_core_tel_test.json");
        fs::write(&dir, raw).unwrap();
        let t = Telemetry::read_or_keep(&dir, &Telemetry::default());
        let _ = fs::remove_file(&dir);
        assert!(t.is_aircraft());
        assert!((t.heading_wrapped() - 241.3).abs() < 1e-6);
        assert!((t.attitude.roll_deg - (-29.9)).abs() < 1e-6);
        assert!((t.tas_knots() - 400.0).abs() < 0.2);
        assert!((t.alt_msl_feet() - 6000.0).abs() < 1.0);
        // No "units" in the frame (an older host): metric.
        assert_eq!(t.units, "metric");
    }

    #[test]
    fn units_follow_the_telemetry() {
        let mut t: Telemetry = serde_json::from_str(r#"{"v":1,"units":"imperial"}"#).unwrap();
        if std::env::var("OBC_UNITS").is_err() {
            assert_eq!(t.unit_sys(), UnitSys::Imperial);
            t.units = "metric".into();
            assert_eq!(t.unit_sys(), UnitSys::Metric);
        }
    }
}
