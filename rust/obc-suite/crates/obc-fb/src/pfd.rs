//! AAA Primary Flight Display (`obc-pfd-fb`) on `/dev/fb0` — exact 1:1 Airbus/F-35 artificial horizon
//! matching `src/a320/du/pfd.ts` (`v_down = (x-cx)*sin(roll) + (y-cy)*cos(roll) - pitch_px`).

use crate::FbRunOpts;
use anyhow::Result;
use obc_core::{AvionicsBus, Framebuffer, RawKey, RawKeyReader, Telemetry, rgb};
use std::fmt::Write as _;
use std::time::Instant;

const C_BG: u32 = rgb(4, 12, 20);
const C_PANEL: u32 = rgb(8, 22, 34);
const C_BORDER: u32 = rgb(36, 92, 122);
const C_SKY_TOP: u32 = rgb(16, 76, 152);
const C_SKY_HOR: u32 = rgb(42, 134, 212);
const C_GND_HOR: u32 = rgb(146, 84, 34);
const C_GND_BOT: u32 = rgb(78, 42, 18);
const C_WHITE: u32 = rgb(242, 248, 255);
const C_AMBER: u32 = rgb(255, 196, 56);
const C_CYAN: u32 = rgb(98, 230, 255);
const C_GREEN: u32 = rgb(110, 248, 148);
const C_MAG: u32 = rgb(246, 98, 232);
const C_DIM: u32 = rgb(118, 162, 184);

#[inline]
#[must_use]
fn lerp_rgb(a: u32, b: u32, t: f64) -> u32 {
    let t = t.clamp(0.0, 1.0);
    let r = (((a >> 16) & 0xff) as f64 * (1.0 - t) + ((b >> 16) & 0xff) as f64 * t) as u8;
    let g = (((a >> 8) & 0xff) as f64 * (1.0 - t) + ((b >> 8) & 0xff) as f64 * t) as u8;
    let bl = ((a & 0xff) as f64 * (1.0 - t) + (b & 0xff) as f64 * t) as u8;
    rgb(r, g, bl)
}

/// Exact artificial horizon signed vertical coordinate (`< 0` = sky, `>= 0` = ground),
/// matching `src/a320/du/pfd.ts` 1:1 (right bank tilts right horizon DOWN, nose-up shifts horizon DOWN).
#[inline]
#[must_use]
pub fn horizon_v_down(dx: f64, dy: f64, sin_r: f64, cos_r: f64, pitch_px: f64) -> f64 {
    dx * sin_r + dy * cos_r - pitch_px
}

/// Render one complete PFD frame into `fb` with zero per-pixel heap allocations.
pub fn render_pfd(fb: &mut Framebuffer, t: &Telemetry, fps: f64, scratch: &mut String) {
    let w = fb.width as i32;
    let h = fb.height as i32;
    fb.clear(C_BG);

    // Layout geometry (scaled cleanly for 512×512, 640×480, 800×600)
    let top_h = 34;
    let bot_h = 68;
    let tape_w = 78;
    let ai_x0 = tape_w + 10;
    let ai_x1 = w - tape_w - 10;
    let ai_y0 = top_h + 10;
    let ai_y1 = h - bot_h - 14;
    let cx = (ai_x0 + ai_x1) / 2;
    let cy = (ai_y0 + ai_y1) / 2;
    let cx_f = f64::from(cx);
    let cy_f = f64::from(cy);
    let ai_h_f = f64::from(ai_y1 - ai_y0);

    let pitch_deg = t.attitude.pitch_deg.clamp(-89.0, 89.0);
    let roll_deg = t.attitude.roll_deg;
    let hdg_deg = t.heading_wrapped();
    let roll_rad = roll_deg.to_radians();
    let sin_r = roll_rad.sin();
    let cos_r = roll_rad.cos();
    let px_per_deg = (ai_h_f / 54.0).max(4.5);
    let pitch_px = pitch_deg * px_per_deg;

    // ── 1. Fast scanline artificial horizon fill (sky gradient / ground gradient) ──
    for y in ai_y0..ai_y1 {
        let dy = f64::from(y) - cy_f;
        let row_off = (y as usize) * fb.width;
        let sky_t = ((f64::from(y - ai_y0)) / ai_h_f).clamp(0.0, 1.0);
        let sky_col = lerp_rgb(C_SKY_TOP, C_SKY_HOR, sky_t);
        let gnd_col = lerp_rgb(C_GND_HOR, C_GND_BOT, sky_t);

        if sin_r.abs() < 1e-4 {
            // Near-level fast path: entire scanline is uniform sky or ground
            let v = dy * cos_r - pitch_px;
            let col = if v < 0.0 { sky_col } else { gnd_col };
            fb.pixels[row_off + ai_x0 as usize..row_off + ai_x1 as usize].fill(col);
        } else {
            // Exact split x where dx*sin_r + dy*cos_r - pitch_px = 0
            let dx_split = (pitch_px - dy * cos_r) / sin_r;
            let x_split = (cx_f + dx_split).round() as i32;
            let left_is_sky = sin_r > 0.0;
            let (c_left, c_right) = if left_is_sky {
                (sky_col, gnd_col)
            } else {
                (gnd_col, sky_col)
            };
            let split_clamped = x_split.clamp(ai_x0, ai_x1);
            if split_clamped > ai_x0 {
                fb.pixels[row_off + ai_x0 as usize..row_off + split_clamped as usize].fill(c_left);
            }
            if split_clamped < ai_x1 {
                fb.pixels[row_off + split_clamped as usize..row_off + ai_x1 as usize].fill(c_right);
            }
        }
    }

    // Horizon-to-screen transform helper (u right along horizon, v down perpendicular to horizon)
    let ai_pt = |u: f64, v: f64| -> (f64, f64) {
        let v_shift = v + pitch_px;
        let x = cx_f + u * cos_r + v_shift * sin_r;
        let y = cy_f - u * sin_r + v_shift * cos_r;
        (x, y)
    };

    let (xmin, ymin, xmax, ymax) = (
        f64::from(ai_x0 + 2),
        f64::from(ai_y0 + 2),
        f64::from(ai_x1 - 2),
        f64::from(ai_y1 - 2),
    );

    // ── 2. Crisp white horizon line ──
    let (hx0, hy0) = ai_pt(-280.0, 0.0);
    let (hx1, hy1) = ai_pt(280.0, 0.0);
    fb.line_clipped(hx0, hy0, hx1, hy1, xmin, ymin, xmax, ymax, C_WHITE, true);

    // ── 3. Clipped Pitch Ladder (-30°..+30° every 5°) ──
    for deg in (-30..=30).step_by(5) {
        if deg == 0 {
            continue;
        }
        let v = -f64::from(deg) * px_per_deg;
        let is_major = deg % 10 == 0;
        let half_w = if is_major { 42.0 } else { 20.0 };
        let col = if deg > 0 { C_WHITE } else { C_AMBER };
        let tick_dir = if deg > 0 { 6.0 } else { -6.0 };

        if deg > 0 {
            let (p0x, p0y) = ai_pt(-half_w, v);
            let (p1x, p1y) = ai_pt(half_w, v);
            fb.line_clipped(p0x, p0y, p1x, p1y, xmin, ymin, xmax, ymax, col, is_major);
        } else {
            // Airbus/F-35 dashed negative pitch rungs (left & right split)
            for (a, b) in [(-half_w, -10.0), (10.0, half_w)] {
                let (p0x, p0y) = ai_pt(a, v);
                let (p1x, p1y) = ai_pt(b, v);
                fb.line_clipped(p0x, p0y, p1x, p1y, xmin, ymin, xmax, ymax, col, is_major);
            }
        }
        if is_major {
            for side in [-half_w, half_w] {
                let (t0x, t0y) = ai_pt(side, v);
                let (t1x, t1y) = ai_pt(side, v + tick_dir);
                fb.line_clipped(t0x, t0y, t1x, t1y, xmin, ymin, xmax, ymax, col, false);
            }
            let (lx, ly) = ai_pt(half_w + 8.0, v - 3.0);
            if lx >= xmin && lx <= xmax - 18.0 && ly >= ymin && ly <= ymax - 10.0 {
                scratch.clear();
                let _ = write!(scratch, "{:+}", deg);
                fb.draw_text(lx as i32, ly as i32, scratch, col, 1);
            }
        }
    }

    // ── 4. Top Bank-Angle Arc (0°, ±10°, ±20°, ±30°, ±45°, ±60°) + Roll Sky Pointer ──
    let arc_r = (ai_h_f * 0.42).min(132.0);
    for bank_mark in [-60_i32, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60] {
        let a = f64::from(bank_mark).to_radians();
        let len = if bank_mark == 0 || bank_mark.abs() == 30 || bank_mark.abs() == 60 {
            10.0
        } else {
            6.0
        };
        let x0 = cx_f + arc_r * a.sin();
        let y0 = cy_f - arc_r * a.cos();
        let x1 = cx_f + (arc_r + len) * a.sin();
        let y1 = cy_f - (arc_r + len) * a.cos();
        fb.line_clipped(x0, y0, x1, y1, xmin, ymin, xmax, ymax, C_WHITE, bank_mark == 0);
    }
    // Live roll pointer triangle rotating around top arc
    let ptr_ang = -roll_deg.clamp(-65.0, 65.0).to_radians();
    let tip_x = (cx_f + (arc_r - 2.0) * ptr_ang.sin()).round() as i32;
    let tip_y = (cy_f - (arc_r - 2.0) * ptr_ang.cos()).round() as i32;
    let b1x = (cx_f + (arc_r - 12.0) * (ptr_ang - 0.06).sin()).round() as i32;
    let b1y = (cy_f - (arc_r - 12.0) * (ptr_ang - 0.06).cos()).round() as i32;
    let b2x = (cx_f + (arc_r - 12.0) * (ptr_ang + 0.06).sin()).round() as i32;
    let b2y = (cy_f - (arc_r - 12.0) * (ptr_ang + 0.06).cos()).round() as i32;
    fb.fill_triangle((tip_x, tip_y), (b1x, b1y), (b2x, b2y), C_AMBER);

    // ── 5. Fixed Airbus/F-35 Boresight Aircraft Symbol ──
    fb.fill_rect(cx - 56, cy - 2, 34, 5, C_BG);
    fb.fill_rect(cx - 55, cy - 1, 32, 3, C_AMBER);
    fb.fill_rect(cx - 25, cy - 1, 3, 10, C_AMBER);

    fb.fill_rect(cx + 22, cy - 2, 34, 5, C_BG);
    fb.fill_rect(cx + 23, cy - 1, 32, 3, C_AMBER);
    fb.fill_rect(cx + 22, cy - 1, 3, 10, C_AMBER);

    fb.fill_rect(cx - 4, cy - 4, 9, 9, C_BG);
    fb.stroke_rect(cx - 3, cy - 3, 7, 7, C_AMBER);
    fb.set_px(cx, cy, C_WHITE);

    // ── 6. ILS Localizer & Glideslope Scales + Magenta Diamonds (when runway active) ──
    if let Some(rwy) = &t.nav.runway {
        // LOC horizontal bar at bottom of AI
        let loc_y = ai_y1 - 12;
        for d in [-2, -1, 0, 1, 2] {
            let dx = cx + d * 24;
            fb.circle(dx, loc_y, if d == 0 { 3 } else { 2 }, C_WHITE);
        }
        let loc_px = (rwy.loc_deg / 2.5).clamp(-1.0, 1.0) * 48.0;
        let lx = cx + loc_px.round() as i32;
        fb.fill_triangle((lx, loc_y - 5), (lx - 5, loc_y), (lx + 5, loc_y), C_MAG);
        fb.fill_triangle((lx, loc_y + 5), (lx - 5, loc_y), (lx + 5, loc_y), C_MAG);

        // GS vertical bar at right edge of AI
        let gs_x = ai_x1 - 12;
        for d in [-2, -1, 0, 1, 2] {
            let dy = cy + d * 24;
            fb.circle(gs_x, dy, if d == 0 { 3 } else { 2 }, C_WHITE);
        }
        let gs_px = -(rwy.gs_deg / 0.7).clamp(-1.0, 1.0) * 48.0;
        let gy = cy + gs_px.round() as i32;
        fb.fill_triangle((gs_x - 5, gy), (gs_x, gy - 5), (gs_x, gy + 5), C_MAG);
        fb.fill_triangle((gs_x + 5, gy), (gs_x, gy - 5), (gs_x, gy + 5), C_MAG);
    }

    fb.stroke_rect(ai_x0, ai_y0, ai_x1 - ai_x0, ai_y1 - ai_y0, C_BORDER);

    // ── 7. Left Airspeed Tape (aircraft: the player's units, m/s by default or kt; spacecraft: m/s) ──
    let is_ac = t.is_aircraft();
    let u = t.unit_sys();
    let ac_metric = !is_ac || u.is_metric();
    let spd_val = if is_ac {
        u.spd(t.flight.true_airspeed_mps)
    } else {
        t.flight.true_airspeed_mps
    };
    let spd_step = match (is_ac, ac_metric) {
        (false, _) => 500.0,
        (true, true) => 10.0,
        (true, false) => 20.0,
    };
    fb.fill_rect(4, ai_y0, tape_w, ai_y1 - ai_y0, C_PANEL);
    fb.stroke_rect(4, ai_y0, tape_w, ai_y1 - ai_y0, C_BORDER);
    let base_s = (spd_val / spd_step).floor() * spd_step;
    for k in -4..=4 {
        let v = base_s + f64::from(k) * spd_step;
        if v < 0.0 {
            continue;
        }
        let y = cy - ((v - spd_val) / spd_step * 34.0).round() as i32;
        if y > ai_y0 + 16 && y < ai_y1 - 8 {
            fb.hline(4 + tape_w - 10, 4 + tape_w - 2, y, C_WHITE);
            scratch.clear();
            let _ = write!(scratch, "{:.0}", v);
            fb.draw_text(10, y - 3, scratch, C_DIM, 1);
        }
    }
    fb.draw_text(10, ai_y0 + 4, if is_ac { u.spd_name() } else { "M/S" }, C_CYAN, 1);
    fb.fill_rect(6, cy - 12, tape_w - 4, 24, C_BG);
    fb.stroke_rect(6, cy - 12, tape_w - 4, 24, C_CYAN);
    scratch.clear();
    let _ = write!(scratch, "{:>5.0}", spd_val);
    fb.draw_text(12, cy - 4, scratch, C_GREEN, 1);
    scratch.clear();
    let _ = write!(scratch, "M{:.2}", t.flight.mach);
    fb.draw_text(12, ai_y1 - 14, scratch, C_CYAN, 1);

    // ── 8. Right Altitude Tape (aircraft: m by default or ft; spacecraft: km) + VSI ──
    let alt_val = if is_ac {
        u.alt(t.position.altitude_msl_m)
    } else {
        t.position.altitude_msl_m * 1e-3
    };
    let alt_step = match (is_ac, ac_metric) {
        (false, _) => 50.0,
        (true, true) => 100.0,
        (true, false) => 500.0,
    };
    let alt_x = w - tape_w - 4;
    fb.fill_rect(alt_x, ai_y0, tape_w, ai_y1 - ai_y0, C_PANEL);
    fb.stroke_rect(alt_x, ai_y0, tape_w, ai_y1 - ai_y0, C_BORDER);
    let base_a = (alt_val / alt_step).floor() * alt_step;
    for k in -4..=4 {
        let v = base_a + f64::from(k) * alt_step;
        let y = cy - ((v - alt_val) / alt_step * 34.0).round() as i32;
        if y > ai_y0 + 16 && y < ai_y1 - 8 {
            fb.hline(alt_x + 2, alt_x + 10, y, C_WHITE);
            scratch.clear();
            let _ = write!(scratch, "{:.0}", v);
            fb.draw_text(alt_x + 14, y - 3, scratch, C_DIM, 1);
        }
    }
    fb.draw_text(alt_x + 14, ai_y0 + 4, if is_ac { u.alt_name() } else { "KM" }, C_CYAN, 1);
    fb.fill_rect(alt_x + 2, cy - 12, tape_w - 4, 24, C_BG);
    fb.stroke_rect(alt_x + 2, cy - 12, tape_w - 4, 24, C_CYAN);
    scratch.clear();
    let _ = write!(scratch, "{:>6.0}", alt_val);
    fb.draw_text(alt_x + 6, cy - 4, scratch, C_GREEN, 1);
    scratch.clear();
    // Vertical speed: m/s (metric, one decimal) or hundreds of ft/min (imperial, as on an airliner's VSI)
    if is_ac && !ac_metric {
        let _ = write!(scratch, "VS{:+.0}", u.vs(t.flight.vertical_speed_mps) * 0.01);
    } else {
        let _ = write!(scratch, "VS{:+.1}", t.flight.vertical_speed_mps);
    }
    fb.draw_text(alt_x + 6, ai_y1 - 14, scratch, C_AMBER, 1);

    // ── 9. Bottom Scrolling Heading Compass Tape + Boxed HDG ──
    let comp_y = ai_y1 + 6;
    let comp_h = 26;
    fb.fill_rect(ai_x0, comp_y, ai_x1 - ai_x0, comp_h, C_PANEL);
    fb.stroke_rect(ai_x0, comp_y, ai_x1 - ai_x0, comp_h, C_BORDER);
    let base_h = (hdg_deg / 10.0).floor() * 10.0;
    for k in -6..=6 {
        let h_mark = base_h + f64::from(k) * 10.0;
        let x = cx + ((h_mark - hdg_deg) * 4.2).round() as i32;
        if x > ai_x0 + 12 && x < ai_x1 - 12 {
            fb.vline(x, comp_y + 1, comp_y + 7, C_WHITE);
            let wrapped = h_mark.rem_euclid(360.0).round() as i32 % 360;
            scratch.clear();
            match wrapped {
                0 => scratch.push('N'),
                90 => scratch.push('E'),
                180 => scratch.push('S'),
                270 => scratch.push('W'),
                d if d % 30 == 0 => {
                    let _ = write!(scratch, "{:02}", d / 10);
                }
                _ => {}
            }
            if !scratch.is_empty() {
                fb.draw_text_centered(x, comp_y + 12, scratch, C_CYAN, 1);
            }
        }
    }
    fb.fill_rect(cx - 22, comp_y + 3, 44, 20, C_BG);
    fb.stroke_rect(cx - 22, comp_y + 3, 44, 20, C_AMBER);
    scratch.clear();
    let _ = write!(scratch, "{:03.0}", hdg_deg);
    fb.draw_text_centered(cx, comp_y + 9, scratch, C_WHITE, 1);

    // ── 10. Top FMA Banner & Bottom Status Strip ──
    fb.fill_rect(0, 0, w, top_h, C_PANEL);
    fb.hline(0, w - 1, top_h, C_BORDER);
    scratch.clear();
    let _ = write!(
        scratch,
        "RS-PFD {} THR {:3.0}% AP:{} {}",
        t.vessel_id.to_uppercase(),
        t.systems.throttle * 100.0,
        if t.systems.autopilot.is_empty() { "OFF" } else { &t.systems.autopilot },
        if t.systems.sas { "SAS" } else { "MAN" }
    );
    fb.draw_text(8, 12, scratch, C_CYAN, 1);

    let foot_y = h - 24;
    fb.fill_rect(0, foot_y - 4, w, 28, C_PANEL);
    fb.hline(0, w - 1, foot_y - 4, C_BORDER);
    scratch.clear();
    let _ = write!(
        scratch,
        "P {:+5.1} R {:+5.1} G {:+4.1} AGL {:5.0}{} FPS {:2.0} [Q]",
        pitch_deg,
        roll_deg,
        t.flight.g_load,
        u.alt(t.position.height_over_ground_m),
        u.alt_name(),
        fps
    );
    fb.draw_text(8, foot_y + 4, scratch, C_WHITE, 1);
}

pub fn run(args: &[String]) -> Result<()> {
    let opts = FbRunOpts::from_args(args);
    let mut fb = Framebuffer::open()?;
    let mut bus = AvionicsBus::new();
    let keys = RawKeyReader::enter();
    let mut scratch = String::with_capacity(128);

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
        render_pfd(&mut fb, &tel, fps, &mut scratch);
        fb.present()?;

        frames += 1;
        let elapsed_win = fps_win.elapsed().as_secs_f64();
        if elapsed_win >= 0.5 {
            fps = f64::from(frames) / elapsed_win;
            frames = 0;
            fps_win = Instant::now();
        }

        let wait_ms = (33_i32 - t_frame.elapsed().as_millis() as i32).clamp(1, 33);
        if let Some(k) = keys.poll(wait_ms) {
            match k {
                RawKey::Char('q' | 'Q') | RawKey::Esc | RawKey::CtrlC => break,
                RawKey::Up | RawKey::Char('+' | '=') => {
                    let _ = bus.set_throttle(tel.systems.throttle + 0.1);
                }
                RawKey::Down | RawKey::Char('-' | '_') => {
                    let _ = bus.set_throttle(tel.systems.throttle - 0.1);
                }
                RawKey::Left | RawKey::Char('s' | 'S') => {
                    let _ = bus.set_sas(!tel.systems.sas);
                }
                RawKey::Right | RawKey::Char('g' | 'G') => {
                    let _ = bus.set_gear(tel.systems.gear < 0.5);
                }
                RawKey::Enter | RawKey::Char('a' | 'A') => {
                    let next = if tel.systems.autopilot.is_empty() || tel.systems.autopilot == "off" {
                        "ap"
                    } else {
                        "off"
                    };
                    let _ = bus.set_autopilot(next);
                }
                _ => {}
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pfd_horizon_orientation_matches_simulator_pfd() {
        // Level flight, pitch 0: top of AI (dy < 0) is sky (v_down < 0), bottom (dy > 0) is ground (v_down > 0)
        assert!(horizon_v_down(0.0, -50.0, 0.0, 1.0, 0.0) < 0.0);
        assert!(horizon_v_down(0.0, 50.0, 0.0, 1.0, 0.0) > 0.0);

        // Nose-up (+10° -> pitch_px > 0): center pixel (0, 0) becomes sky (horizon shifted down)
        assert!(horizon_v_down(0.0, 0.0, 0.0, 1.0, 50.0) < 0.0);

        // Banked 30° left (roll = -30° -> sin_r < 0): right side (dx > 0, dy = 0) is sky (v_down < 0)
        let r = (-30.0_f64).to_radians();
        assert!(horizon_v_down(60.0, 0.0, r.sin(), r.cos(), 0.0) < 0.0);
        assert!(horizon_v_down(-60.0, 0.0, r.sin(), r.cos(), 0.0) > 0.0);
    }

    #[test]
    fn pfd_renders_banked_frame_cleanly() {
        let mut fb = Framebuffer::offscreen(512, 512);
        let mut t = Telemetry {
            vessel_id: "f35b".into(),
            vessel_kind: "aircraft".into(),
            ..Telemetry::default()
        };
        t.attitude.heading_deg = 241.0;
        t.attitude.pitch_deg = -5.6;
        t.attitude.roll_deg = -29.9;
        t.flight.true_airspeed_mps = 240.0;
        t.position.altitude_msl_m = 1800.0;
        let mut s = String::new();
        render_pfd(&mut fb, &t, 30.0, &mut s);
        // Top-right corner of AI must be sky-colored (more blue than red)
        let px = fb.pixels[80 * 512 + 380];
        let r = (px >> 16) & 0xff;
        let b = px & 0xff;
        assert!(b > r, "expected sky pixel, got 0x{px:06x}");
    }
}
