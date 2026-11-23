//! AAA Split Plan View + 3° Glidepath Profile ILS Display (`obc-ils-fb`) on `/dev/fb0`.

use crate::FbRunOpts;
use anyhow::Result;
use obc_core::{AvionicsBus, Framebuffer, RawKey, RawKeyReader, Telemetry, rgb};
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

pub fn render_ils(
    fb: &mut Framebuffer,
    t: &Telemetry,
    range_nm: f64,
    fps: f64,
    scratch: &mut String,
) {
    let w = fb.width as i32;
    let h = fb.height as i32;
    fb.clear(C_BG);

    let rwy_id = t.nav.runway.as_ref().map_or("NO ILS", |r| r.ident.as_str());
    let dist_nm = t
        .nav
        .runway
        .as_ref()
        .map_or(0.0, |r| r.dist_m * 0.000_539_956_8);
    let loc_deg = t.nav.runway.as_ref().map_or(0.0, |r| r.loc_deg);
    let gs_deg = t.nav.runway.as_ref().map_or(0.0, |r| r.gs_deg);

    // Header
    fb.fill_rect(0, 0, w, 30, C_PANEL);
    fb.hline(0, w - 1, 30, C_BORDER);
    scratch.clear();
    let _ = write!(
        scratch,
        "RS-ILS {}  DME {:4.1}NM  LOC {:+4.2}  GS {:+4.2}",
        rwy_id, dist_nm, loc_deg, gs_deg
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

    // FAF / IF markers at 5 NM & 10 NM
    for (nm, lbl) in [(5.0, "FAF"), (10.0, "IF")] {
        if nm <= range_nm {
            let mx = left_x + ((nm / range_nm) * span_x).round() as i32;
            fb.vline(mx, plan_cy - 6, plan_cy + 6, C_MAG);
            fb.draw_text_centered(mx, plan_cy + 10, lbl, C_MAG, 1);
        }
    }

    // Live aircraft position in plan view
    let ac_x = left_x + ((dist_nm / range_nm).clamp(0.0, 1.0) * span_x).round() as i32;
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

    // Ideal 3° glideslope line (tan(3°) ≈ 318 ft/NM)
    let max_alt_ft = range_nm * 360.0;
    let ideal_top_y = ground_y - ((range_nm * 318.4 / max_alt_ft).clamp(0.0, 1.0) * prof_h).round() as i32;
    fb.line(left_x, ground_y, right_x, ideal_top_y, C_MAG);

    // Live aircraft altitude dot (AGL ft)
    let agl_ft = (t.position.height_over_ground_m * 3.280_84).max(0.0);
    let ac_py = ground_y - ((agl_ft / max_alt_ft).clamp(0.0, 1.0) * prof_h).round() as i32;
    fb.fill_circle(ac_x, ac_py, 5, C_AMB);
    scratch.clear();
    let _ = write!(scratch, "{:.0}FT", agl_ft);
    fb.draw_text(ac_x - 16, (ac_py - 14).max(prof_top + 16), scratch, C_WHT, 1);

    // Footer
    fb.fill_rect(0, h - 26, w, 26, C_PANEL);
    fb.hline(0, w - 1, h - 26, C_BORDER);
    scratch.clear();
    let _ = write!(
        scratch,
        "AGL {:4.0}M  TAS {:3.0}KT  VS {:+5.0}FPM  RNG {:2.0}NM  FPS {:2.0} [+-IGQ]",
        t.position.height_over_ground_m,
        t.tas_knots(),
        t.vs_fpm(),
        range_nm,
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

    let ranges = [10.0_f64, 20.0, 40.0];
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
                RawKey::Up | RawKey::Char('+' | '=') => rng_idx = (rng_idx + 1).min(ranges.len() - 1),
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
