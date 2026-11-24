//! Display units of the guest apps, mirroring the simulator's `src/ui/unitsys.ts`: metric by default (metres, metres a
//! second, kilometres), imperial as the option (feet, knots, nautical miles, feet a minute). The telemetry carries the
//! player's choice (`units`); `OBC_UNITS=metric|imperial` in the environment overrides it for one program. Physics
//! stays SI: only what is shown changes.

use std::sync::OnceLock;

/// The unit system shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum UnitSys {
    #[default]
    Metric,
    Imperial,
}

const FT_PER_M: f64 = 1.0 / 0.3048;
const KT_PER_MPS: f64 = 3600.0 / 1852.0;
/// One nautical mile [m].
pub const NM_M: f64 = 1852.0;

static ENV_OVERRIDE: OnceLock<Option<UnitSys>> = OnceLock::new();

impl UnitSys {
    /// `"imperial"` (any case) is imperial; anything else, metric.
    #[must_use]
    pub fn parse(s: &str) -> Self {
        if s.trim().eq_ignore_ascii_case("imperial") {
            Self::Imperial
        } else {
            Self::Metric
        }
    }

    /// The player's choice from the telemetry, unless `OBC_UNITS` overrides it.
    #[must_use]
    pub fn resolve(from_telemetry: &str) -> Self {
        let env = *ENV_OVERRIDE.get_or_init(|| {
            std::env::var("OBC_UNITS")
                .ok()
                .filter(|v| !v.trim().is_empty())
                .map(|v| Self::parse(&v))
        });
        env.unwrap_or_else(|| Self::parse(from_telemetry))
    }

    #[must_use]
    pub const fn is_metric(self) -> bool {
        matches!(self, Self::Metric)
    }

    /// A height [m] in the units shown (m | ft).
    #[must_use]
    pub fn alt(self, m: f64) -> f64 {
        if self.is_metric() { m } else { m * FT_PER_M }
    }

    /// A speed [m/s] in the units shown (m/s | kt).
    #[must_use]
    pub fn spd(self, mps: f64) -> f64 {
        if self.is_metric() {
            mps
        } else {
            mps * KT_PER_MPS
        }
    }

    /// A vertical speed [m/s] in the units shown (m/s | ft/min).
    #[must_use]
    pub fn vs(self, mps: f64) -> f64 {
        if self.is_metric() {
            mps
        } else {
            mps * FT_PER_M * 60.0
        }
    }

    /// A distance [m] in the units shown (km | NM).
    #[must_use]
    pub fn dist(self, m: f64) -> f64 {
        m / self.dist_unit_m()
    }

    /// The distance unit [m] (1000 | 1852).
    #[must_use]
    pub const fn dist_unit_m(self) -> f64 {
        if self.is_metric() { 1000.0 } else { NM_M }
    }

    /// Upper-case names (the framebuffer font has no lower case).
    #[must_use]
    pub const fn alt_name(self) -> &'static str {
        if self.is_metric() { "M" } else { "FT" }
    }
    #[must_use]
    pub const fn spd_name(self) -> &'static str {
        if self.is_metric() { "M/S" } else { "KT" }
    }
    #[must_use]
    pub const fn vs_name(self) -> &'static str {
        if self.is_metric() { "M/S" } else { "FPM" }
    }
    #[must_use]
    pub const fn dist_name(self) -> &'static str {
        if self.is_metric() { "KM" } else { "NM" }
    }

    /// Lower-case names (TUI text): "m" | "ft", "m/s" | "kt", "m/s" | "ft/min", "km" | "NM".
    #[must_use]
    pub const fn alt_unit(self) -> &'static str {
        if self.is_metric() { "m" } else { "ft" }
    }
    #[must_use]
    pub const fn spd_unit(self) -> &'static str {
        if self.is_metric() { "m/s" } else { "kt" }
    }
    #[must_use]
    pub const fn vs_unit(self) -> &'static str {
        if self.is_metric() { "m/s" } else { "ft/min" }
    }
    #[must_use]
    pub const fn dist_unit(self) -> &'static str {
        if self.is_metric() { "km" } else { "NM" }
    }

    /// Written out like `unitsys.ts`: "240 m/s" | "450 kt".
    #[must_use]
    pub fn f_spd(self, mps: f64) -> String {
        format!("{:.0} {}", self.spd(mps), self.spd_unit())
    }
    /// "4500 m" | "14764 ft".
    #[must_use]
    pub fn f_alt(self, m: f64) -> String {
        format!("{:.0} {}", self.alt(m), self.alt_unit())
    }
    /// "12.3 km" | "6.6 NM".
    #[must_use]
    pub fn f_dist(self, m: f64, digits: usize) -> String {
        format!("{:.*} {}", digits, self.dist(m), self.dist_unit())
    }
    /// "+1.2 m/s" | "+240 ft/min".
    #[must_use]
    pub fn f_vs(self, mps: f64) -> String {
        if self.is_metric() {
            format!("{:+.1} m/s", mps)
        } else {
            format!("{:+.0} ft/min", self.vs(mps))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metric_by_default_imperial_on_request() {
        assert_eq!(UnitSys::parse(""), UnitSys::Metric);
        assert_eq!(UnitSys::parse("metric"), UnitSys::Metric);
        assert_eq!(UnitSys::parse("Imperial"), UnitSys::Imperial);
        assert_eq!(UnitSys::default(), UnitSys::Metric);
        let m = UnitSys::Metric;
        assert_eq!(m.f_spd(240.0), "240 m/s");
        assert_eq!(m.f_alt(4500.0), "4500 m");
        assert_eq!(m.f_dist(12_345.0, 1), "12.3 km");
        assert_eq!(m.f_vs(1.234), "+1.2 m/s");
        let i = UnitSys::Imperial;
        assert_eq!(i.f_spd(205.778), "400 kt");
        assert_eq!(i.f_alt(1828.8), "6000 ft");
        assert_eq!(i.f_dist(18_520.0, 1), "10.0 NM");
        assert_eq!(i.f_vs(5.08), "+1000 ft/min");
        assert_eq!((m.alt_name(), i.alt_name()), ("M", "FT"));
        assert_eq!((m.spd_name(), i.spd_name()), ("M/S", "KT"));
        assert_eq!((m.dist_name(), i.dist_name()), ("KM", "NM"));
    }
}
