//! AAA F-35B/C TSD & AN/APG-81 Tactical Radar (`obc-f35-fb`) on `/dev/fb0`.

use crate::FbRunOpts;
use anyhow::Result;
use obc_core::{AvionicsBus, Framebuffer, RawKey, RawKeyReader, Telemetry, rgb};
use serde_json::{Value, json};
use std::fmt::Write as _;
use std::time::Instant;

const C_BG: u32 = rgb(3, 14, 10);
const C_PANEL: u32 = rgb(7, 26, 18);
const C_RING: u32 = rgb(24, 96, 62);
const C_GRN: u32 = rgb(75, 232, 138);
const C_CYN: u32 = rgb(86, 224, 245);
const C_AMB: u32 = rgb(255, 194, 64);
const C_RED: u32 = rgb(255, 86, 78);
const C_WHT: u32 = rgb(232, 248, 240);

#[derive(Debug, Clone)]
pub struct Track {
    pub id: String,
    pub brg_deg: f64,
    pub dist_km: f64,
    pub alt_m: f64,
    pub hostile: bool,
}

#[allow(clippy::too_many_arguments)]
pub fn render_f35_tsd(
    fb: &mut Framebuffer,
    t: &Telemetry,
    tracks: &[Track],
    range_km: f64,
    radar_mode: &str,
    sweep_deg: f64,
    fps: f64,
    scratch: &mut String,
) {
    let w = fb.width as i32;
    let h = fb.height as i32;
    fb.clear(C_BG);

    let cx = w / 2;
    let cy = h / 2 + 12;
    let radius = (w.min(h) / 2 - 58).max(80);
    let hdg = t.heading_wrapped();

    // Header bar
    fb.fill_rect(0, 0, w, 30, C_PANEL);
    fb.hline(0, w - 1, 30, C_RING);
    scratch.clear();
    let _ = write!(
        scratch,
        "RS-F35 TSD  HDG {:03.0}  RNG {:3.0}KM  RDR:{}  TRK:{}",
        hdg,
        range_km,
        radar_mode,
        tracks.len()
    );
    fb.draw_text(8, 11, scratch, C_GRN, 1);

    // Concentric tactical range rings
    for i in 1..=3 {
        let r = radius * i / 3;
        fb.circle(cx, cy, r, C_RING);
    }

    // ±60° AN/APG-81 AESA radar sector boundary lines
    for deg in [-60.0_f64, 60.0_f64] {
        let a = deg.to_radians();
        let ex = cx + (f64::from(radius) * a.sin()).round() as i32;
        let ey = cy - (f64::from(radius) * a.cos()).round() as i32;
        fb.line(cx, cy, ex, ey, C_RING);
    }

    // Animated AESA sweep beam with phosphor trail
    for trail in 0..8 {
        let ang = (sweep_deg - f64::from(trail) * 2.2).clamp(-60.0, 60.0).to_radians();
        let fade = 255u8.saturating_sub((trail as u8) * 28);
        let col = rgb(fade / 4, fade, fade / 2);
        let ex = cx + (f64::from(radius - 2) * ang.sin()).round() as i32;
        let ey = cy - (f64::from(radius - 2) * ang.cos()).round() as i32;
        fb.line(cx, cy, ex, ey, col);
    }

    // Heading-up compass rose ticks & N/E/S/W labels
    for deg in (0..360).step_by(30) {
        let rel = (f64::from(deg) - hdg).to_radians();
        let r0 = f64::from(radius - 4);
        let r1 = f64::from(radius + 4);
        fb.line(
            cx + (r0 * rel.sin()).round() as i32,
            cy - (r0 * rel.cos()).round() as i32,
            cx + (r1 * rel.sin()).round() as i32,
            cy - (r1 * rel.cos()).round() as i32,
            C_GRN,
        );
        let label = match deg {
            0 => Some("N"),
            90 => Some("E"),
            180 => Some("S"),
            270 => Some("W"),
            _ => None,
        };
        if let Some(lbl) = label {
            let lx = cx + (f64::from(radius + 14) * rel.sin()).round() as i32;
            let ly = cy - (f64::from(radius + 14) * rel.cos()).round() as i32 - 3;
            fb.draw_text_centered(lx, ly, lbl, if deg == 0 { C_AMB } else { C_CYN }, 1);
        }
    }

    // Plot live tracks relative to ownship heading
    for trk in tracks.iter().take(24) {
        if trk.dist_km > range_km {
            continue;
        }
        let rel = (trk.brg_deg - hdg).to_radians();
        let dpx = (trk.dist_km / range_km) * f64::from(radius - 6);
        let tx = cx + (dpx * rel.sin()).round() as i32;
        let ty = cy - (dpx * rel.cos()).round() as i32;
        let col = if trk.hostile { C_RED } else { C_CYN };
        if trk.hostile {
            fb.fill_triangle((tx, ty - 5), (tx - 5, ty + 4), (tx + 5, ty + 4), col);
        } else {
            fb.stroke_rect(tx - 4, ty - 4, 8, 8, col);
        }
        scratch.clear();
        let _ = write!(scratch, "{} FL{:02.0}", trk.id.chars().take(5).collect::<String>(), trk.alt_m * 0.0328);
        fb.draw_text(tx + 7, ty - 3, scratch, col, 1);
    }

    // Ownship F-35 delta icon at center
    fb.fill_triangle((cx, cy - 8), (cx - 7, cy + 7), (cx + 7, cy + 7), C_WHT);

    // Footer bar
    fb.fill_rect(0, h - 26, w, 26, C_PANEL);
    fb.hline(0, w - 1, h - 26, C_RING);
    scratch.clear();
    let _ = write!(
        scratch,
        "TAS {:3.0}KT ALT {:5.0}FT P{:+4.1} R{:+4.1} FPS {:2.0} [+-RLCQ]",
        t.tas_knots(),
        t.alt_msl_feet(),
        t.attitude.pitch_deg,
        t.attitude.roll_deg,
        fps
    );
    fb.draw_text(8, h - 17, scratch, C_WHT, 1);
}

fn fetch_tracks(bus: &AvionicsBus) -> Vec<Track> {
    let Some(val) = bus.tars_tool("traffic", &json!({ "action": "list" })) else {
        return Vec::new();
    };
    let arr = val
        .get("aircraft")
        .or_else(|| val.get("tracks"))
        .and_then(Value::as_array)
        .or_else(|| val.as_array());
    let Some(list) = arr else {
        return Vec::new();
    };
    list.iter()
        .map(|item| {
            let id = item
                .get("callsign")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("TRK")
                .to_string();
            let brg_deg = item
                .get("bearing_deg")
                .or_else(|| item.get("bearing"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            let dist_km = item
                .get("distance_km")
                .or_else(|| item.get("dist_km"))
                .and_then(Value::as_f64)
                .or_else(|| item.get("dist_m").and_then(Value::as_f64).map(|m| m * 1e-3))
                .unwrap_or(15.0);
            let alt_m = item
                .get("altitude_msl_m")
                .or_else(|| item.get("alt_m"))
                .and_then(Value::as_f64)
                .unwrap_or(3000.0);
            let hostile = item
                .get("hostile")
                .and_then(Value::as_bool)
                .unwrap_or_else(|| id.starts_with("BOG") || id.starts_with("BND"));
            Track {
                id,
                brg_deg,
                dist_km,
                alt_m,
                hostile,
            }
        })
        .collect()
}

pub fn run(args: &[String]) -> Result<()> {
    let opts = FbRunOpts::from_args(args);
    let mut fb = Framebuffer::open()?;
    let mut bus = AvionicsBus::new();
    let keys = RawKeyReader::enter();
    let mut scratch = String::with_capacity(128);

    let ranges = [20.0_f64, 40.0, 80.0, 160.0];
    let mut rng_idx = 1usize;
    let modes = ["RWS", "TWS", "STT"];
    let mut mode_idx = 1usize;
    let mut tracks = fetch_tracks(&bus);
    let mut last_trk = Instant::now();
    let start = Instant::now();
    let mut frames = 0u32;
    let mut fps_win = Instant::now();
    let mut fps = 30.0_f64;

    loop {
        if let Some(secs) = opts.seconds
            && start.elapsed().as_secs_f64() >= secs
        {
            break;
        }
        let t_frame = Instant::now();
        if last_trk.elapsed().as_secs_f64() >= 1.5 {
            tracks = fetch_tracks(&bus);
            last_trk = Instant::now();
        }
        let tel = bus.telemetry().clone();
        let sweep = (start.elapsed().as_secs_f64() * 2.2).sin() * 60.0;
        render_f35_tsd(
            &mut fb,
            &tel,
            &tracks,
            ranges[rng_idx],
            modes[mode_idx],
            sweep,
            fps,
            &mut scratch,
        );
        fb.present()?;

        frames += 1;
        let ew = fps_win.elapsed().as_secs_f64();
        if ew >= 0.5 {
            fps = f64::from(frames) / ew;
            frames = 0;
            fps_win = Instant::now();
        }

        let wait_ms = (33_i32 - t_frame.elapsed().as_millis() as i32).clamp(1, 33);
        if let Some(k) = keys.poll(wait_ms) {
            match k {
                RawKey::Char('q' | 'Q') | RawKey::Esc | RawKey::CtrlC => break,
                RawKey::Char('+' | '=') => rng_idx = (rng_idx + 1).min(ranges.len() - 1),
                RawKey::Char('-' | '_') => rng_idx = rng_idx.saturating_sub(1),
                RawKey::Char('r' | 'R') => {
                    mode_idx = (mode_idx + 1) % modes.len();
                    let _ = bus.tars_tool("f35_radar", &json!({ "action": "mode", "mode": modes[mode_idx] }));
                }
                RawKey::Char('l' | 'L') => {
                    let _ = bus.tars_tool("f35_radar", &json!({ "action": "lock_next" }));
                }
                RawKey::Char('c' | 'C') => {
                    let _ = bus.tars_tool("f35_weapons", &json!({ "action": "countermeasures" }));
                }
                _ => {}
            }
        }
    }
    Ok(())
}
