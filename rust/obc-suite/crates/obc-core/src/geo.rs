//! WGS84 ellipsoidal geodesy, reference airports, and Kerr black hole relativistic physics.

use std::f64::consts::PI;

/// WGS84 equatorial semi-major axis [m].
pub const WGS84_A: f64 = 6_378_137.0;
/// WGS84 flattening.
pub const WGS84_F: f64 = 1.0 / 298.257_223_563;
/// WGS84 first eccentricity squared.
pub const WGS84_E2: f64 = WGS84_F * (2.0 - WGS84_F);

#[derive(Debug, Clone, Copy)]
pub struct Airport {
    pub icao: &'static str,
    pub name: &'static str,
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub elev_m: f64,
}

pub const WORLD_AIRPORTS: &[Airport] = &[
    Airport { icao: "LFPB", name: "Paris Le Bourget", lat_deg: 48.9694, lon_deg: 2.4414, elev_m: 67.0 },
    Airport { icao: "LFPG", name: "Paris CDG", lat_deg: 49.0097, lon_deg: 2.5479, elev_m: 119.0 },
    Airport { icao: "LFPO", name: "Paris Orly", lat_deg: 48.7233, lon_deg: 2.3794, elev_m: 89.0 },
    Airport { icao: "LFTH", name: "Toulon-Hyeres", lat_deg: 43.0973, lon_deg: 6.1460, elev_m: 4.0 },
    Airport { icao: "LFMN", name: "Nice Cote d'Azur", lat_deg: 43.6584, lon_deg: 7.2159, elev_m: 4.0 },
    Airport { icao: "LFML", name: "Marseille Provence", lat_deg: 43.4367, lon_deg: 5.2150, elev_m: 21.0 },
    Airport { icao: "EGLL", name: "London Heathrow", lat_deg: 51.4700, lon_deg: -0.4543, elev_m: 25.0 },
    Airport { icao: "LSGG", name: "Geneva", lat_deg: 46.2381, lon_deg: 6.1090, elev_m: 430.0 },
    Airport { icao: "KJFK", name: "New York JFK", lat_deg: 40.6413, lon_deg: -73.7781, elev_m: 4.0 },
    Airport { icao: "KSFO", name: "San Francisco", lat_deg: 37.6213, lon_deg: -122.3790, elev_m: 4.0 },
    Airport { icao: "RJTT", name: "Tokyo Haneda", lat_deg: 35.5494, lon_deg: 139.7798, elev_m: 11.0 },
    Airport { icao: "OMDB", name: "Dubai Intl", lat_deg: 25.2532, lon_deg: 55.3657, elev_m: 19.0 },
];

/// Compute initial true bearing [deg 0..360) and geodesic distance [km] on the WGS84 ellipsoid
/// using local meridional & prime-vertical curvature radii at mid-latitude (accurate to <0.1%).
#[must_use]
pub fn wgs84_bearing_dist(lat1_deg: f64, lon1_deg: f64, lat2_deg: f64, lon2_deg: f64) -> (f64, f64) {
    let lat1 = lat1_deg.to_radians();
    let lat2 = lat2_deg.to_radians();
    let dlat = lat2 - lat1;
    let dlon = (lon2_deg - lon1_deg).to_radians();

    let mid_lat = 0.5 * (lat1 + lat2);
    let sin_m = mid_lat.sin();
    let w = (1.0 - WGS84_E2 * sin_m * sin_m).sqrt();
    // Local Gaussian mean curvature radius R_g = sqrt(M * N)
    let r_n = WGS84_A / w;
    let r_m = WGS84_A * (1.0 - WGS84_E2) / (w * w * w);
    let r_eff = (r_m * r_n).sqrt();

    let a = (0.5 * dlat).sin().powi(2) + lat1.cos() * lat2.cos() * (0.5 * dlon).sin().powi(2);
    let c = 2.0 * a.clamp(0.0, 1.0).sqrt().atan2((1.0 - a).max(0.0).sqrt());
    let dist_km = (r_eff * c) * 1e-3;

    let y = dlon.sin() * lat2.cos();
    let x = lat1.cos() * lat2.sin() - lat1.sin() * lat2.cos() * dlon.cos();
    let bearing = (y.atan2(x).to_degrees()).rem_euclid(360.0);
    (bearing, dist_km)
}

#[derive(Debug, Clone, Copy)]
pub struct KerrMetrics {
    pub spin: f64,
    pub r_horizon: f64,
    pub r_ergo_eq: f64,
    pub r_photon_pro: f64,
    pub r_photon_retro: f64,
    pub r_isco_pro: f64,
    pub r_isco_retro: f64,
    pub dtau_dt_static: f64,
    pub omega_frame_drag: f64,
}

/// Exact Boyer-Lindquist equatorial Kerr black hole radii & dilation (units of G=c=M=1).
#[must_use]
pub fn kerr_metrics(spin_raw: f64, r_over_m: f64) -> KerrMetrics {
    let a = spin_raw.clamp(0.0, 0.9999);
    let r = r_over_m.max(1.001);
    let r_horizon = 1.0 + (1.0 - a * a).max(0.0).sqrt();
    let r_ergo_eq = 2.0;
    let r_photon_pro = 2.0 * (1.0 + ((2.0 / 3.0) * (-a).acos()).cos());
    let r_photon_retro = 2.0 * (1.0 + ((2.0 / 3.0) * a.acos()).cos());

    let one_m_a2 = (1.0 - a * a).max(0.0);
    let z1 = 1.0 + one_m_a2.cbrt() * ((1.0 + a).cbrt() + (1.0 - a).max(0.0).cbrt());
    let z2 = (3.0 * a * a + z1 * z1).sqrt();
    let radical = ((3.0 - z1) * (3.0 + z1 + 2.0 * z2)).max(0.0).sqrt();
    let r_isco_pro = 3.0 + z2 - radical;
    let r_isco_retro = 3.0 + z2 + radical;

    let dtau_dt_static = (1.0 - 2.0 / r).max(0.0).sqrt();
    let omega_frame_drag = (2.0 * a * r) / ((r * r + a * a).powi(2) - a * a * (r * r - 2.0 * r + a * a));

    KerrMetrics {
        spin: a,
        r_horizon,
        r_ergo_eq,
        r_photon_pro,
        r_photon_retro,
        r_isco_pro,
        r_isco_retro,
        dtau_dt_static,
        omega_frame_drag,
    }
}

/// Normalize signed angle difference `target - current` into `[-180, 180)`.
#[must_use]
pub fn angle_diff_deg(target: f64, current: f64) -> f64 {
    let mut d = (target - current + 180.0).rem_euclid(360.0) - 180.0;
    if d < -180.0 {
        d += 360.0;
    }
    let _ = PI;
    d
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wgs84_paris_to_nice_matches_geodesy() {
        let (brg, dist_km) = wgs84_bearing_dist(48.9694, 2.4414, 43.6584, 7.2159);
        assert!(dist_km > 685.0 && dist_km < 705.0, "dist_km={dist_km}");
        assert!(brg > 145.0 && brg < 155.0, "brg={brg}");
    }

    #[test]
    fn kerr_schwarzschild_and_gargantua_limits() {
        let sch = kerr_metrics(0.0, 10.0);
        assert!((sch.r_horizon - 2.0).abs() < 1e-6);
        assert!((sch.r_photon_pro - 3.0).abs() < 1e-6);
        assert!((sch.r_isco_pro - 6.0).abs() < 1e-6);

        let garg = kerr_metrics(0.998, 2.5);
        assert!(garg.r_horizon > 1.0 && garg.r_horizon < 1.1);
        assert!(garg.r_isco_pro > 1.2 && garg.r_isco_pro < 1.3);
    }
}
