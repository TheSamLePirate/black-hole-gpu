//! AAA Orbital & Tactical Phosphor Radar Scope (`obc-radar-fb`) on `/dev/fb0`.

use crate::FbRunOpts;
use anyhow::Result;
use obc_core::{AvionicsBus, Framebuffer, RawKey, RawKeyReader, Telemetry, rgb};
use std::f64::consts::TAU;
use std::fmt::Write as _;
use std::time::Instant;

const C_BG: u32 = rgb(3, 12, 16);
const C_PANEL: u32 = rgb(7, 22, 28);
const C_RING: u32 = rgb(24, 86, 98);
const C_CYN: u32 = rgb(92, 232, 255);
const C_GRN: u32 = rgb(94, 246, 146);
const C_AMB: u32 = rgb(255, 194, 62);
const C_WHT: u32 = rgb(236, 248, 255);

pub fn render_radar(
    fb: &mut Framebuffer,
    t: &Telemetry,
    sweep_rad: f64,
    zoom: f64,
    fps: f64,
    scratch: &mut String,
) {
    let w = fb.width as i32;
    let h = fb.height as i32;
    fb.clear(C_BG);

    let cx = w / 2;
    let cy = h / 2 + 4;
    let radius = (w.min(h) / 2 - 52).max(80);

    fb.fill_rect(0, 0, w, 30, C_PANEL);
    fb.hline(0, w - 1, 30, C_RING);
    scratch.clear();
    let _ = write!(
        scratch,
        "RS-RADAR {}  BODY:{}  ZOOM:{:.1}X",
        t.vessel_id.to_uppercase(),
        t.body.to_uppercase(),
        zoom
    );
    fb.draw_text(8, 11, scratch, C_CYN, 1);

    for i in 1..=4 {
        fb.circle(cx, cy, radius * i / 4, C_RING);
    }
    fb.hline(cx - radius, cx + radius, cy, C_RING);
    fb.vline(cx, cy - radius, cy + radius, C_RING);

    // Phosphor rotating sweep
    for k in 0..14 {
        let a = sweep_rad - f64::from(k) * 0.04;
        let alpha = 240u8.saturating_sub((k as u8) * 16);
        let col = rgb(alpha / 5, alpha, alpha / 2);
        let ex = cx + (f64::from(radius - 2) * a.sin()).round() as i32;
        let ey = cy - (f64::from(radius - 2) * a.cos()).round() as i32;
        fb.line(cx, cy, ex, ey, col);
    }

    // Primary planet body + Keplerian orbital ellipse
    let body_r = ((f64::from(radius) * 0.28) * zoom).clamp(16.0, f64::from(radius) * 0.6) as i32;
    fb.fill_circle(cx, cy, body_r, rgb(14, 58, 92));
    fb.circle(cx, cy, body_r, C_CYN);

    let ecc = t
        .orbit
        .as_ref()
        .map_or(0.05, |o| o.eccentricity.clamp(0.0, 0.85));
    let a_px = (f64::from(radius) * 0.65 * zoom).clamp(f64::from(body_r + 12), f64::from(radius - 8));
    let b_px = a_px * (1.0 - ecc * ecc).sqrt();
    let c_px = a_px * ecc;
    let mut prev = None;
    for step in 0..=96 {
        let th = (f64::from(step) / 96.0) * TAU;
        let px = f64::from(cx) - c_px + a_px * th.cos();
        let py = f64::from(cy) + b_px * th.sin();
        if let Some((lx, ly)) = prev {
            fb.line(lx as i32, ly as i32, px as i32, py as i32, C_GRN);
        }
        prev = Some((px, py));
    }

    // Pe / Ap markers & live spacecraft position
    let pe_x = (f64::from(cx) - c_px + a_px).round() as i32;
    let ap_x = (f64::from(cx) - c_px - a_px).round() as i32;
    fb.fill_circle(pe_x, cy, 4, C_AMB);
    fb.draw_text(pe_x + 6, cy - 10, "PE", C_AMB, 1);
    fb.fill_circle(ap_x, cy, 4, C_CYN);
    fb.draw_text(ap_x - 18, cy - 10, "AP", C_CYN, 1);

    let sc_ang = (t.sim_time_s * 0.08) % TAU;
    let sc_x = (f64::from(cx) - c_px + a_px * sc_ang.cos()).round() as i32;
    let sc_y = (f64::from(cy) + b_px * sc_ang.sin()).round() as i32;
    fb.fill_circle(sc_x, sc_y, 5, C_WHT);

    fb.fill_rect(0, h - 26, w, 26, C_PANEL);
    fb.hline(0, w - 1, h - 26, C_RING);
    scratch.clear();
    let _ = write!(
        scratch,
        "ECC {:.3}  ALT {:6.1}KM  SPD {:6.0}M/S  FPS {:2.0} [+-PQ]",
        ecc,
        t.position.altitude_msl_m * 1e-3,
        t.flight.true_airspeed_mps,
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

    let mut zoom = 1.0_f64;
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
        let sweep = (start.elapsed().as_secs_f64() * 1.8) % TAU;
        render_radar(&mut fb, &tel, sweep, zoom, fps, &mut scratch);
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
                RawKey::Up | RawKey::Char('+' | '=') => zoom = (zoom + 0.15).min(2.0),
                RawKey::Down | RawKey::Char('-' | '_') => zoom = (zoom - 0.15).max(0.5),
                RawKey::Right | RawKey::Char('p' | 'P') => {
                    let _ = bus.set_hold("prograde");
                }
                RawKey::Left => {
                    let _ = bus.set_hold("retrograde");
                }
                _ => {}
            }
        }
    }
    Ok(())
}
