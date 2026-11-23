//! AAA Gargantua Relativistic Kerr Spacetime Visualizer (`obc-kerr-fb`) on `/dev/fb0`.
//! Renders Doppler-beamed accretion disk, shadow/horizon/ISCO rings, effective potential well,
//! and live gravitational time-dilation gauge `dτ/dt`.

use crate::FbRunOpts;
use anyhow::Result;
use obc_core::{AvionicsBus, Framebuffer, RawKey, RawKeyReader, Telemetry, kerr_metrics, rgb};
use std::fmt::Write as _;
use std::time::Instant;

const C_BG: u32 = rgb(4, 6, 14);
const C_PANEL: u32 = rgb(12, 16, 28);
const C_BORDER: u32 = rgb(58, 78, 118);
const C_WHT: u32 = rgb(242, 246, 255);
const C_CYN: u32 = rgb(104, 224, 255);
const C_AMB: u32 = rgb(255, 186, 72);

pub fn render_kerr(
    fb: &mut Framebuffer,
    t: &Telemetry,
    spin: f64,
    phase: f64,
    fps: f64,
    scratch: &mut String,
) {
    let w = fb.width as i32;
    let h = fb.height as i32;
    fb.clear(C_BG);

    let m = kerr_metrics(spin, 2.5);
    let cx = w / 2;
    let cy = h / 2 - 36;
    let scale_m = (f64::from(w.min(h)) * 0.048).max(16.0);

    // Header
    fb.fill_rect(0, 0, w, 30, C_PANEL);
    fb.hline(0, w - 1, 30, C_BORDER);
    scratch.clear();
    let _ = write!(
        scratch,
        "RS-KERR GARGANTUA  A*={:.4}  R+={:.2}M  ISCO={:.2}M",
        m.spin, m.r_horizon, m.r_isco_pro
    );
    fb.draw_text(8, 11, scratch, C_AMB, 1);

    // Relativistic Doppler-beamed accretion disk (tilted 18° ellipse)
    let r_in = (m.r_isco_pro * scale_m).max(18.0);
    let r_out = (7.2 * scale_m).min(f64::from(w / 2 - 20));
    let tilt = 0.30_f64;

    let y_min = (cy - (r_out * tilt) as i32 - 26).max(34);
    let y_max = (cy + (r_out * tilt) as i32 + 26).min(h - 130);
    let x_min = (cx - r_out as i32 - 4).max(4);
    let x_max = (cx + r_out as i32 + 4).min(w - 4);
    let r_shadow = (m.r_photon_pro * 1.15 * scale_m).max(18.0);

    // Lensed upper/lower Einstein photon ring halo
    for y in y_min..y_max {
        let dy = f64::from(y - cy);
        let row = (y as usize) * fb.width;
        for x in x_min..x_max {
            let dx = f64::from(x - cx);
            let r_sphere = (dx * dx + dy * dy).sqrt();
            // Disk plane coordinates
            let dy_disk = dy / tilt;
            let r_disk = (dx * dx + dy_disk * dy_disk).sqrt();

            // Event horizon shadow occludes back side
            if r_sphere < r_shadow && dy < 0.0 {
                continue;
            }
            let mut intensity = 0.0_f64;
            let mut doppler = 0.0_f64;
            if r_disk >= r_in && r_disk <= r_out {
                let radial = ((r_out - r_disk) / (r_out - r_in)).powf(1.3);
                let ang = dy_disk.atan2(dx) + phase;
                let spiral = 0.8 + 0.2 * (ang * 3.0 + r_disk * 0.08).sin();
                doppler = (-dx / r_disk).clamp(-1.0, 1.0); // left approaching -> blue/bright
                intensity = (radial * spiral * (1.0 + 0.65 * doppler)).clamp(0.0, 1.5);
            }
            // Gravitational lensed photon ring
            let ring_dist = (r_sphere - r_shadow).abs();
            if ring_dist < 5.5 {
                let glow = (1.0 - ring_dist / 5.5).powi(2) * 0.95;
                if glow > intensity {
                    intensity = glow;
                    doppler = (-dx / r_sphere.max(1.0)) * 0.4;
                }
            }
            if intensity > 0.02 {
                let r_c = ((intensity * (245.0 - 35.0 * doppler)).clamp(0.0, 255.0)) as u8;
                let g_c = ((intensity * (170.0 + 45.0 * doppler)).clamp(0.0, 255.0)) as u8;
                let b_c = ((intensity * (95.0 + 145.0 * doppler.max(-0.4))).clamp(0.0, 255.0)) as u8;
                fb.pixels[row + x as usize] = rgb(r_c, g_c, b_c);
            }
        }
    }

    // Central event horizon silhouette (front-disk stays visible where dy > 0 & r_disk > r_in)
    fb.fill_circle(cx, cy, (r_shadow * 0.88) as i32, rgb(0, 0, 0));
    fb.circle(cx, cy, r_shadow as i32, rgb(255, 210, 130));

    // Bottom relativistic potential well & dτ/dt bar
    let box_y = h - 122;
    let box_h = 88;
    fb.fill_rect(12, box_y, w - 24, box_h, C_PANEL);
    fb.stroke_rect(12, box_y, w - 24, box_h, C_BORDER);
    fb.draw_text(20, box_y + 6, "EFFECTIVE POTENTIAL V_EFF(R) & DTAU/DT", C_CYN, 1);

    let mut prev = None;
    for i in 0..=120 {
        let r_m = 1.2 + (f64::from(i) / 120.0) * 14.0;
        let l = 3.6;
        let v_eff = -1.0 / r_m + (l * l) / (2.0 * r_m * r_m) - (l * l) / (r_m * r_m * r_m);
        let px = 20 + (i * (w - 40)) / 120;
        let py = (box_y + box_h - 18) - ((v_eff + 0.12) * 140.0).clamp(-10.0, 48.0) as i32;
        if let Some((lx, ly)) = prev {
            fb.line(lx, ly, px, py, C_AMB);
        }
        prev = Some((px, py));
    }

    // Time dilation readout bar
    let bar_w = w - 40;
    let fill_w = (t.dtau_dt.clamp(0.0, 1.0) * f64::from(bar_w)).round() as i32;
    fb.fill_rect(20, box_y + box_h - 14, bar_w, 8, C_BG);
    fb.fill_rect(20, box_y + box_h - 14, fill_w, 8, C_CYN);

    fb.fill_rect(0, h - 26, w, 26, C_PANEL);
    fb.hline(0, w - 1, h - 26, C_BORDER);
    scratch.clear();
    let _ = write!(
        scratch,
        "DTAU/DT {:.6}  R_PH {:.2}M  FPS {:2.0}  [+- SPIN, Q]",
        t.dtau_dt, m.r_photon_pro, fps
    );
    fb.draw_text(8, h - 17, scratch, C_WHT, 1);
}

pub fn run(args: &[String]) -> Result<()> {
    let opts = FbRunOpts::from_args(args);
    let mut fb = Framebuffer::open()?;
    let mut bus = AvionicsBus::new();
    let keys = RawKeyReader::enter();
    let mut scratch = String::with_capacity(128);

    let mut spin = 0.998_f64;
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
        let phase = start.elapsed().as_secs_f64() * 1.4;
        render_kerr(&mut fb, &tel, spin, phase, fps, &mut scratch);
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
                RawKey::Right | RawKey::Char('+' | '=') => spin = (spin + 0.05).min(0.9998),
                RawKey::Left | RawKey::Char('-' | '_') => spin = (spin - 0.05).max(0.0),
                RawKey::Up => spin = (spin + 0.01).min(0.9998),
                RawKey::Down => spin = (spin - 0.01).max(0.0),
                _ => {}
            }
        }
    }
    Ok(())
}
