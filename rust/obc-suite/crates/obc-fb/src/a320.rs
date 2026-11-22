//! AAA Airbus A320 ARC-Mode Navigation Display (`obc-a320-fb`) on `/dev/fb0`.

use crate::FbRunOpts;
use anyhow::Result;
use obc_core::{
    AvionicsBus, Framebuffer, RawKey, RawKeyReader, Telemetry, WORLD_AIRPORTS, rgb, wgs84_bearing_dist,
};
use std::fmt::Write as _;
use std::time::Instant;

const C_BG: u32 = rgb(4, 8, 16);
const C_PANEL: u32 = rgb(10, 18, 30);
const C_BORDER: u32 = rgb(42, 82, 118);
const C_WHT: u32 = rgb(236, 244, 255);
const C_GRN: u32 = rgb(88, 242, 134);
const C_CYN: u32 = rgb(82, 214, 255);
const C_MAG: u32 = rgb(246, 98, 232);
const C_AMB: u32 = rgb(255, 194, 58);

pub fn render_a320_nd(
    fb: &mut Framebuffer,
    t: &Telemetry,
    range_nm: f64,
    fps: f64,
    scratch: &mut String,
) {
    let w = fb.width as i32;
    let h = fb.height as i32;
    fb.clear(C_BG);

    let cx = w / 2;
    let cy = h - 78;
    let radius = (h - 140).min(w / 2 - 20).max(120);
    let hdg = t.heading_wrapped();
    let (xmin, ymin, xmax, ymax) = (10.0, 42.0, f64::from(w - 10), f64::from(h - 32));

    // Top corners: GS / TAS on left, Waypoint / Dist on right, HDG box center
    fb.fill_rect(0, 0, w, 38, C_PANEL);
    fb.hline(0, w - 1, 38, C_BORDER);
    scratch.clear();
    let _ = write!(scratch, "GS {:3.0} TAS {:3.0}", t.flight.ground_speed_mps * 1.94384, t.tas_knots());
    fb.draw_text(8, 8, scratch, C_GRN, 1);
    scratch.clear();
    let _ = write!(scratch, "RNG {:3.0}NM", range_nm);
    fb.draw_text(8, 22, scratch, C_CYN, 1);

    fb.fill_rect(cx - 28, 6, 56, 24, C_BG);
    fb.stroke_rect(cx - 28, 6, 56, 24, C_AMB);
    scratch.clear();
    let _ = write!(scratch, "{:03.0}", hdg);
    fb.draw_text_centered(cx, 14, scratch, C_WHT, 1);

    let rwy_lbl = t
        .nav
        .runway
        .as_ref()
        .map_or("NAV ARC", |r| r.ident.as_str());
    scratch.clear();
    let _ = write!(scratch, "RS-A320 ND  {}", rwy_lbl);
    fb.draw_text(w - (scratch.len() as i32) * 6 - 10, 8, scratch, C_MAG, 1);
    scratch.clear();
    let _ = write!(
        scratch,
        "ALT {:5.0}FT  AP:{}",
        t.alt_msl_feet(),
        if t.systems.autopilot.is_empty() { "OFF" } else { &t.systems.autopilot }
    );
    fb.draw_text(w - (scratch.len() as i32) * 6 - 10, 22, scratch, C_GRN, 1);

    // 140° Airbus ARC range rings (1/4, 1/2, 3/4, full)
    for step in 1..=4 {
        let r = f64::from(radius) * f64::from(step) / 4.0;
        let mut prev = None;
        for deg in (-70..=70).step_by(4) {
            let a = f64::from(deg).to_radians();
            let px = f64::from(cx) + r * a.sin();
            let py = f64::from(cy) - r * a.cos();
            if let Some((lx, ly)) = prev {
                fb.line_clipped(
                    lx,
                    ly,
                    px,
                    py,
                    xmin,
                    ymin,
                    xmax,
                    ymax,
                    if step == 4 { C_WHT } else { C_BORDER },
                    false,
                );
            }
            prev = Some((px, py));
        }
    }

    // Rotating compass tick marks along outer arc
    let base_h = (hdg / 10.0).floor() * 10.0;
    for k in -7..=7 {
        let mark = base_h + f64::from(k) * 10.0;
        let rel = mark - hdg;
        if rel.abs() > 68.0 {
            continue;
        }
        let a = rel.to_radians();
        let r0 = f64::from(radius);
        let r1 = f64::from(radius + 8);
        fb.line_clipped(
            f64::from(cx) + r0 * a.sin(),
            f64::from(cy) - r0 * a.cos(),
            f64::from(cx) + r1 * a.sin(),
            f64::from(cy) - r1 * a.cos(),
            xmin,
            ymin,
            xmax,
            ymax,
            C_WHT,
            false,
        );
        let wrapped = mark.rem_euclid(360.0).round() as i32 % 360;
        if wrapped % 30 == 0 {
            let lx = cx + (f64::from(radius + 16) * a.sin()).round() as i32;
            let ly = cy - (f64::from(radius + 16) * a.cos()).round() as i32 - 3;
            scratch.clear();
            let _ = write!(scratch, "{:02}", wrapped / 10);
            fb.draw_text_centered(lx, ly, scratch, C_CYN, 1);
        }
    }

    // Plot nearby WGS84 world airports & active approach route leg
    let mut nearest_pt: Option<(f64, f64, f64)> = None;
    for apt in WORLD_AIRPORTS {
        let (brg, dist_km) = wgs84_bearing_dist(
            t.position.lat_deg,
            t.position.lon_deg,
            apt.lat_deg,
            apt.lon_deg,
        );
        let dist_nm = dist_km * 0.539_956_8;
        if dist_nm > range_nm * 1.15 {
            continue;
        }
        let rel = (brg - hdg).to_radians();
        let dpx = (dist_nm / range_nm) * f64::from(radius);
        let px = f64::from(cx) + dpx * rel.sin();
        let py = f64::from(cy) - dpx * rel.cos();
        if px >= xmin && px <= xmax && py >= ymin && py <= ymax {
            let (ix, iy) = (px.round() as i32, py.round() as i32);
            fb.circle(ix, iy, 4, C_MAG);
            fb.draw_text(ix + 7, iy - 3, apt.icao, C_MAG, 1);
            if nearest_pt.is_none_or(|(_, _, best)| dist_nm < best) {
                nearest_pt = Some((px, py, dist_nm));
            }
        }
    }
    if let Some((nx, ny, _)) = nearest_pt {
        fb.line_clipped(f64::from(cx), f64::from(cy), nx, ny, xmin, ymin, xmax, ymax, C_GRN, true);
    }

    // Airbus yellow aircraft symbol at ARC origin
    fb.hline(cx - 10, cx + 10, cy, C_AMB);
    fb.vline(cx, cy - 8, cy + 12, C_AMB);
    fb.hline(cx - 5, cx + 5, cy + 9, C_AMB);

    // Footer bar
    fb.fill_rect(0, h - 26, w, 26, C_PANEL);
    fb.hline(0, w - 1, h - 26, C_BORDER);
    scratch.clear();
    let _ = write!(
        scratch,
        "FLAPS {:2.0}% GEAR:{} FUEL {:3.0}% FPS {:2.0} [+-IAGQ]",
        t.systems.flaps * 100.0,
        if t.systems.gear > 0.5 { "DN" } else { "UP" },
        t.systems.fuel_frac * 100.0,
        fps
    );
    fb.draw_text(8, h - 17, scratch, C_WHT, 1);
}

pub fn run(args: &[String]) -> Result<()> {
    let opts = FbRunOpts::from_args(args);
    let mut fb = Framebuffer::open()?;
    let mut bus = AvionicsBus::new();
    let keys = RawKeyReader::enter();
    let mut scratch = String::with_capacity(128);

    let ranges = [10.0_f64, 20.0, 40.0, 80.0, 160.0];
    let mut rng_idx = 2usize;
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
        let tel = bus.telemetry().clone();
        render_a320_nd(&mut fb, &tel, ranges[rng_idx], fps, &mut scratch);
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
                RawKey::Char('i' | 'I') => {
                    let _ = bus.set_autopilot("ils");
                }
                RawKey::Char('a' | 'A') => {
                    let _ = bus.set_autopilot("ap");
                }
                RawKey::Char('g' | 'G') => {
                    let _ = bus.set_gear(tel.systems.gear < 0.5);
                }
                _ => {}
            }
        }
    }
    Ok(())
}
