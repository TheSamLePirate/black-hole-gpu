//! AAA Split Plan View + 3° Glidepath Profile ILS Display (`obc-ils-fb`) on `/dev/fb0`.

use crate::FbRunOpts;
use anyhow::Result;
use obc_core::{AvionicsBus, Framebuffer, NM_M, RawKey, RawKeyReader, Telemetry, rgb};
use std::fmt::Write as _;
use std::time::Instant;

const C_BG: u32 = rgb(4, 10, 18);
const C_PANEL: u32 = rgb(10, 22, 34);
const C_BORDER: u32 = rgb(44, 96, 128);
const C_WHT: u32 = rgb(238, 246, 255);
const C_CYN: u32 = rgb(92, 228, 255);
const C_GRN: u32 = rgb(96, 246, 146);
const C_MAG: u32 = rgb(246, 98, 232);
const C_AMB: u32 = rgb(255, 194, 58);

/// Split ILS display; `range` is in the display units (km metric, NM imperial: `Telemetry::unit_sys`). The geometry is
/// computed in metres; only the labels change with the units.
pub fn render_ils(
    fb: &mut Framebuffer,
    t: &Telemetry,
    range: f64,
    fps: f64,
    scratch: &mut String,
) {
    let w = fb.width as i32;
    let h = fb.height as i32;
    fb.clear(C_BG);
    let u = t.unit_sys();
    let range_m = range * u.dist_unit_m();

    let rwy_id = t.nav.runway.as_ref().map_or("NO ILS", |r| r.ident.as_str());
    let dist_m = t.nav.runway.as_ref().map_or(0.0, |r| r.dist_m);
    let loc_deg = t.nav.runway.as_ref().map_or(0.0, |r| r.loc_deg);
    let gs_deg = t.nav.runway.as_ref().map_or(0.0, |r| r.gs_deg);

    // Header
    fb.fill_rect(0, 0, w, 30, C_PANEL);
    fb.hline(0, w - 1, 30, C_BORDER);
    scratch.clear();
    let _ = write!(
        scratch,
        "RS-ILS {}  DME {:4.1}{}  LOC {:+4.2}  GS {:+4.2}",
        rwy_id,
        u.dist(dist_m),
        u.dist_name(),
        loc_deg,
        gs_deg
    );
    fb.draw_text(8, 11, scratch, C_CYN, 1);

    let mid_y = h / 2;
    let left_x = 34;
    let right_x = w - 26;
    let span_x = f64::from(right_x - left_x);

    // ── Top half: Plan View (Runway threshold on left, approach corridor extending right) ──
    let plan_cy = (34 + mid_y - 10) / 2;
    fb.stroke_rect(8, 36, w - 16, mid_y - 44, C_BORDER);
    fb.draw_text(16, 42, "PLAN VIEW (LOC)", C_CYN, 1);
    fb.hline(left_x, right_x, plan_cy, C_CYN);
    // Runway threshold box
    fb.fill_rect(left_x - 10, plan_cy - 5, 16, 11, C_WHT);
    // ±2.5° localizer cone
    let cone_h = 46;
    fb.line(left_x, plan_cy, right_x, plan_cy - cone_h, C_BORDER);
    fb.line(left_x, plan_cy, right_x, plan_cy + cone_h, C_BORDER);

    // FAF / IF markers at 5 NM & 10 NM (9.3 and 18.5 km)
    for (mark_m, lbl) in [(5.0 * NM_M, "FAF"), (10.0 * NM_M, "IF")] {
        if mark_m <= range_m {
            let mx = left_x + ((mark_m / range_m) * span_x).round() as i32;
            fb.vline(mx, plan_cy - 6, plan_cy + 6, C_MAG);
            fb.draw_text_centered(mx, plan_cy + 10, lbl, C_MAG, 1);
        }
    }

    // Live aircraft position in plan view
    let ac_x = left_x + ((dist_m / range_m).clamp(0.0, 1.0) * span_x).round() as i32;
    let ac_y = plan_cy + ((loc_deg / 2.5).clamp(-1.2, 1.2) * f64::from(cone_h)).round() as i32;
    fb.fill_triangle((ac_x - 7, ac_y), (ac_x + 5, ac_y - 5), (ac_x + 5, ac_y + 5), C_AMB);

    // ── Bottom half: 3° Vertical Glidepath Profile ──
    let prof_top = mid_y + 4;
    let prof_bot = h - 34;
    let ground_y = prof_bot - 14;
    let prof_h = f64::from(ground_y - prof_top - 22);
    fb.stroke_rect(8, prof_top, w - 16, prof_bot - prof_top, C_BORDER);
    fb.draw_text(16, prof_top + 6, "3 DEG GLIDEPATH PROFILE", C_CYN, 1);
    fb.hline(left_x, right_x, ground_y, C_GRN);

    // Ideal 3° glideslope line (tan 3° = 0.0524); the profile's top is a 3.4° slope (0.0592)
    let max_h_m = range_m * 0.059_2;
    let ideal_top_y = ground_y - ((range_m * 0.052_4 / max_h_m).clamp(0.0, 1.0) * prof_h).round() as i32;
    fb.line(left_x, ground_y, right_x, ideal_top_y, C_MAG);

    // Live aircraft height dot (AGL)
    let agl_m = t.position.height_over_ground_m.max(0.0);
    let ac_py = ground_y - ((agl_m / max_h_m).clamp(0.0, 1.0) * prof_h).round() as i32;
    fb.fill_circle(ac_x, ac_py, 5, C_AMB);
    scratch.clear();
    let _ = write!(scratch, "{:.0}{}", u.alt(agl_m), u.alt_name());
    fb.draw_text(ac_x - 16, (ac_py - 14).max(prof_top + 16), scratch, C_WHT, 1);

    // Footer
    fb.fill_rect(0, h - 26, w, 26, C_PANEL);
    fb.hline(0, w - 1, h - 26, C_BORDER);
    scratch.clear();
    let _ = write!(
        scratch,
        "AGL {:4.0}{}  TAS {:3.0}{}  VS {:+5.1}{}  RNG {:2.0}{}  FPS {:2.0} [+-IGQ]",
        u.alt(t.position.height_over_ground_m),
        u.alt_name(),
        u.spd(t.flight.true_airspeed_mps),
        u.spd_name(),
        u.vs(t.flight.vertical_speed_mps),
        u.vs_name(),
        range,
        u.dist_name(),
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

    // Range ladders in the display units: km (metric, the default) or NM (imperial).
    let ranges_km = [20.0_f64, 40.0, 80.0];
    let ranges_nm = [10.0_f64, 20.0, 40.0];
    let ranges_len = ranges_km.len();
    let mut rng_idx = 0usize;
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
        let ranges = if tel.unit_sys().is_metric() { &ranges_km } else { &ranges_nm };
        render_ils(&mut fb, &tel, ranges[rng_idx], fps, &mut scratch);
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
                RawKey::Up | RawKey::Char('+' | '=') => rng_idx = (rng_idx + 1).min(ranges_len - 1),
                RawKey::Down | RawKey::Char('-' | '_') => rng_idx = rng_idx.saturating_sub(1),
                RawKey::Left | RawKey::Enter | RawKey::Char('i' | 'I') => {
                    let _ = bus.set_autopilot("ils");
                }
                RawKey::Right | RawKey::Char('g' | 'G') => {
                    let _ = bus.set_gear(tel.systems.gear < 0.5);
                }
                _ => {}
            }
        }
    }
    Ok(())
}
