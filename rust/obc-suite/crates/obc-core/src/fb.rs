//! Zero-allocation `/dev/fb0` XRGB8888 framebuffer renderer and non-blocking POSIX TTY raw key reader.

use anyhow::{Context, Result};
use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::mem::MaybeUninit;
use std::os::unix::io::{AsRawFd, RawFd};
use std::ptr;
use std::slice;

/// Pack `(r, g, b)` into little-endian XRGB8888 (`0xFFRRGGBB`, stored `[B, G, R, 0xFF]` in RAM).
#[inline]
#[must_use]
pub const fn rgb(r: u8, g: u8, b: u8) -> u32 {
    0xff00_0000 | ((r as u32) << 16) | ((g as u32) << 8) | (b as u32)
}

/// Linearly blend two XRGB8888 colors (`alpha` in `0..=255`).
#[inline]
#[must_use]
pub const fn blend_rgb(dst: u32, src: u32, alpha: u8) -> u32 {
    let a = alpha as u32;
    let inv = 255 - a;
    let r = (((src >> 16) & 0xff) * a + ((dst >> 16) & 0xff) * inv) >> 8;
    let g = (((src >> 8) & 0xff) * a + ((dst >> 8) & 0xff) * inv) >> 8;
    let b = ((src & 0xff) * a + (dst & 0xff) * inv) >> 8;
    0xff00_0000 | (r << 16) | (g << 8) | b
}

/// Crisp 5×7 uppercase + symbols + digits bitmap font (bit 4 = leftmost pixel).
#[inline]
#[must_use]
fn glyph_5x7(ch: u8) -> [u8; 7] {
    match ch.to_ascii_uppercase() {
        b'0' => [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
        b'1' => [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
        b'2' => [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
        b'3' => [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
        b'4' => [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
        b'5' => [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
        b'6' => [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
        b'7' => [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
        b'8' => [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
        b'9' => [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
        b'A' => [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
        b'B' => [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
        b'C' => [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
        b'D' => [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
        b'E' => [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
        b'F' => [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
        b'G' => [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
        b'H' => [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
        b'I' => [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
        b'J' => [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
        b'K' => [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
        b'L' => [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
        b'M' => [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
        b'N' => [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
        b'O' => [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
        b'P' => [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
        b'Q' => [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
        b'R' => [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
        b'S' => [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
        b'T' => [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
        b'U' => [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
        b'V' => [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
        b'W' => [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
        b'X' => [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
        b'Y' => [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
        b'Z' => [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
        b'-' => [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
        b'+' => [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
        b'.' => [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
        b',' => [0x00, 0x00, 0x00, 0x00, 0x04, 0x04, 0x08],
        b':' => [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
        b'/' => [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
        b'%' => [0x19, 0x19, 0x02, 0x04, 0x08, 0x13, 0x13],
        b'=' => [0x00, 0x00, 0x1f, 0x00, 0x1f, 0x00, 0x00],
        b'[' => [0x0e, 0x08, 0x08, 0x08, 0x08, 0x08, 0x0e],
        b']' => [0x0e, 0x02, 0x02, 0x02, 0x02, 0x02, 0x0e],
        b'(' => [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
        b')' => [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
        b'<' => [0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02],
        b'>' => [0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08],
        b'_' => [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f],
        b'*' => [0x00, 0x04, 0x15, 0x0e, 0x15, 0x04, 0x00],
        b'|' => [0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
        b'!' => [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
        b'?' => [0x0e, 0x11, 0x01, 0x06, 0x04, 0x00, 0x04],
        b'#' => [0x0a, 0x1f, 0x0a, 0x0a, 0x1f, 0x0a, 0x00],
        _ => [0; 7],
    }
}

/// Pre-allocated XRGB8888 backbuffer targeting `/dev/fb0` via zero-copy `mmap` (with `write` fallback).
pub struct Framebuffer {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u32>,
    file: Option<File>,
    mapped: *mut u8,
    mapped_len: usize,
}

impl Framebuffer {
    /// Open `/dev/fb0`, query exact active `xres × yres` via `FBIOGET_VSCREENINFO`, and `mmap` it.
    pub fn open() -> Result<Self> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open("/dev/fb0")
            .context("open /dev/fb0")?;
        let (width, height) = Self::detect_size(file.as_raw_fd());
        let byte_len = width * height * 4;
        // SAFETY: Mapping `/dev/fb0` for `width * height * 4` bytes with `MAP_SHARED`.
        let ptr = unsafe {
            libc::mmap(
                ptr::null_mut(),
                byte_len,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_SHARED,
                file.as_raw_fd(),
                0,
            )
        };
        let (mapped, mapped_len) = if ptr == libc::MAP_FAILED {
            (ptr::null_mut(), 0)
        } else {
            (ptr.cast::<u8>(), byte_len)
        };
        Ok(Self {
            width,
            height,
            pixels: vec![0xff00_0000; width * height],
            file: Some(file),
            mapped,
            mapped_len,
        })
    }

    /// Create an off-screen framebuffer for unit tests & benchmarks (no `/dev/fb0` needed).
    #[must_use]
    pub fn offscreen(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            pixels: vec![0xff00_0000; width * height],
            file: None,
            mapped: ptr::null_mut(),
            mapped_len: 0,
        }
    }

    #[must_use]
    fn detect_size(fd: RawFd) -> (usize, usize) {
        // Linux `fb_var_screeninfo`: first two `u32` fields are `xres` and `yres` (`FBIOGET_VSCREENINFO = 0x4600`).
        #[cfg(target_os = "linux")]
        {
            const FBIOGET_VSCREENINFO: libc::c_ulong = 0x4600;
            let mut info = [0u32; 40];
            // SAFETY: `ioctl(fd, FBIOGET_VSCREENINFO, &mut info)` populates `fb_var_screeninfo` (160 bytes).
            let rc = unsafe { libc::ioctl(fd, FBIOGET_VSCREENINFO as _, info.as_mut_ptr()) };
            if rc == 0 {
                let (w, h) = (info[0] as usize, info[1] as usize);
                if (128..=2048).contains(&w) && (128..=2048).contains(&h) {
                    return (w, h);
                }
            }
        }
        let _ = fd;
        if let Ok(raw) = std::fs::read_to_string("/sys/class/graphics/fb0/modes")
            && let Some(line) = raw.lines().next()
            && let Some(dims) = line.split(':').nth(1)
            && let Some(wh) = dims.split('-').next()
            && let Some((ws, hs)) = wh.split_once('x')
            && let (Ok(w), Ok(h)) = (ws.parse::<usize>(), hs.parse::<usize>())
            && (128..=2048).contains(&w)
            && (128..=2048).contains(&h)
        {
            return (w, h);
        }
        (512, 512)
    }

    #[inline]
    pub fn clear(&mut self, color: u32) {
        self.pixels.fill(color);
    }

    #[inline]
    pub fn set_px(&mut self, x: i32, y: i32, color: u32) {
        if x >= 0 && y >= 0 {
            let (ux, uy) = (x as usize, y as usize);
            if ux < self.width && uy < self.height {
                self.pixels[uy * self.width + ux] = color;
            }
        }
    }

    #[inline]
    pub fn blend_px(&mut self, x: i32, y: i32, color: u32, alpha: u8) {
        if x >= 0 && y >= 0 {
            let (ux, uy) = (x as usize, y as usize);
            if ux < self.width && uy < self.height {
                let idx = uy * self.width + ux;
                self.pixels[idx] = blend_rgb(self.pixels[idx], color, alpha);
            }
        }
    }

    #[inline]
    pub fn hline(&mut self, x0: i32, x1: i32, y: i32, color: u32) {
        if y < 0 || y as usize >= self.height {
            return;
        }
        let a = x0.min(x1).max(0) as usize;
        let b = (x0.max(x1) + 1).min(self.width as i32).max(0) as usize;
        if a >= b {
            return;
        }
        let row = (y as usize) * self.width;
        self.pixels[row + a..row + b].fill(color);
    }

    #[inline]
    pub fn vline(&mut self, x: i32, y0: i32, y1: i32, color: u32) {
        if x < 0 || x as usize >= self.width {
            return;
        }
        let ux = x as usize;
        let a = y0.min(y1).max(0) as usize;
        let b = (y0.max(y1) + 1).min(self.height as i32).max(0) as usize;
        for y in a..b {
            self.pixels[y * self.width + ux] = color;
        }
    }

    pub fn fill_rect(&mut self, x: i32, y: i32, w: i32, h: i32, color: u32) {
        if w <= 0 || h <= 0 {
            return;
        }
        let x0 = x.max(0) as usize;
        let y0 = y.max(0) as usize;
        let x1 = (x + w).min(self.width as i32).max(0) as usize;
        let y1 = (y + h).min(self.height as i32).max(0) as usize;
        if x0 >= x1 || y0 >= y1 {
            return;
        }
        for row in y0..y1 {
            let base = row * self.width;
            self.pixels[base + x0..base + x1].fill(color);
        }
    }

    pub fn stroke_rect(&mut self, x: i32, y: i32, w: i32, h: i32, color: u32) {
        if w <= 0 || h <= 0 {
            return;
        }
        self.hline(x, x + w - 1, y, color);
        self.hline(x, x + w - 1, y + h - 1, color);
        self.vline(x, y, y + h - 1, color);
        self.vline(x + w - 1, y, y + h - 1, color);
    }

    /// Bresenham integer line rasterizer.
    pub fn line(&mut self, mut x0: i32, mut y0: i32, x1: i32, y1: i32, color: u32) {
        let dx = (x1 - x0).abs();
        let sx = if x0 < x1 { 1 } else { -1 };
        let dy = -(y1 - y0).abs();
        let sy = if y0 < y1 { 1 } else { -1 };
        let mut err = dx + dy;
        loop {
            self.set_px(x0, y0, color);
            if x0 == x1 && y0 == y1 {
                break;
            }
            let e2 = 2 * err;
            if e2 >= dy {
                err += dy;
                x0 += sx;
            }
            if e2 <= dx {
                err += dx;
                y0 += sy;
            }
        }
    }

    /// Liang-Barsky clipped line segment inside `[xmin..=xmax] × [ymin..=ymax]`.
    #[allow(clippy::too_many_arguments)]
    pub fn line_clipped(
        &mut self,
        x0: f64,
        y0: f64,
        x1: f64,
        y1: f64,
        xmin: f64,
        ymin: f64,
        xmax: f64,
        ymax: f64,
        color: u32,
        thick: bool,
    ) {
        let Some((cx0, cy0, cx1, cy1)) = clip_segment(x0, y0, x1, y1, xmin, ymin, xmax, ymax) else {
            return;
        };
        let (ix0, iy0) = (cx0.round() as i32, cy0.round() as i32);
        let (ix1, iy1) = (cx1.round() as i32, cy1.round() as i32);
        self.line(ix0, iy0, ix1, iy1, color);
        if thick {
            if (ix1 - ix0).abs() >= (iy1 - iy0).abs() {
                if (iy0 + 1) as f64 <= ymax && (iy1 + 1) as f64 <= ymax {
                    self.line(ix0, iy0 + 1, ix1, iy1 + 1, color);
                }
            } else if (ix0 + 1) as f64 <= xmax && (ix1 + 1) as f64 <= xmax {
                self.line(ix0 + 1, iy0, ix1 + 1, iy1, color);
            }
        }
    }

    /// Midpoint circle outline.
    pub fn circle(&mut self, cx: i32, cy: i32, r: i32, color: u32) {
        if r <= 0 {
            return;
        }
        let mut x = r;
        let mut y = 0;
        let mut err = 1 - r;
        while x >= y {
            self.set_px(cx + x, cy + y, color);
            self.set_px(cx + y, cy + x, color);
            self.set_px(cx - y, cy + x, color);
            self.set_px(cx - x, cy + y, color);
            self.set_px(cx - x, cy - y, color);
            self.set_px(cx - y, cy - x, color);
            self.set_px(cx + y, cy - x, color);
            self.set_px(cx + x, cy - y, color);
            y += 1;
            if err < 0 {
                err += 2 * y + 1;
            } else {
                x -= 1;
                err += 2 * (y - x) + 1;
            }
        }
    }

    /// Solid filled disk using fast horizontal scanlines.
    pub fn fill_circle(&mut self, cx: i32, cy: i32, r: i32, color: u32) {
        if r <= 0 {
            return;
        }
        let r2 = r * r;
        for dy in -r..=r {
            let dx = ((r2 - dy * dy) as f64).sqrt() as i32;
            self.hline(cx - dx, cx + dx, cy + dy, color);
        }
    }

    /// Filled triangle via scanline edge interpolation.
    pub fn fill_triangle(&mut self, p0: (i32, i32), p1: (i32, i32), p2: (i32, i32), color: u32) {
        let mut pts = [p0, p1, p2];
        pts.sort_by_key(|p| p.1);
        let [(x0, y0), (x1, y1), (x2, y2)] = pts;
        if y0 == y2 {
            self.hline(x0.min(x1).min(x2), x0.max(x1).max(x2), y0, color);
            return;
        }
        let interp = |ya: i32, xa: i32, yb: i32, xb: i32, y: i32| -> i32 {
            if yb == ya {
                xa
            } else {
                xa + ((xb - xa) * (y - ya)) / (yb - ya)
            }
        };
        for y in y0..=y2 {
            let xa = interp(y0, x0, y2, x2, y);
            let xb = if y < y1 {
                interp(y0, x0, y1, x1, y)
            } else {
                interp(y1, x1, y2, x2, y)
            };
            self.hline(xa, xb, y, color);
        }
    }

    /// Draw crisp 5×7 bitmap text with integer scaling (`scale >= 1`).
    pub fn draw_text(&mut self, x: i32, y: i32, text: &str, color: u32, scale: i32) {
        let sc = scale.max(1);
        let adv = 6 * sc;
        let mut cx = x;
        for b in text.bytes() {
            if b != b' ' {
                let rows = glyph_5x7(b);
                for (ry, &bits) in rows.iter().enumerate() {
                    if bits == 0 {
                        continue;
                    }
                    for rx in 0..5 {
                        if (bits & (1 << (4 - rx))) != 0 {
                            if sc == 1 {
                                self.set_px(cx + rx, y + ry as i32, color);
                            } else {
                                self.fill_rect(cx + rx * sc, y + (ry as i32) * sc, sc, sc, color);
                            }
                        }
                    }
                }
            }
            cx += adv;
        }
    }

    /// Draw text horizontally centered at `cx`.
    pub fn draw_text_centered(&mut self, cx: i32, y: i32, text: &str, color: u32, scale: i32) {
        let w = (text.len() as i32) * 6 * scale.max(1) - scale.max(1);
        self.draw_text(cx - w / 2, y, text, color, scale);
    }

    /// Blit backbuffer to `/dev/fb0` via zero-copy `mmap` memcpy (or `write_all` fallback).
    pub fn present(&mut self) -> Result<()> {
        let byte_len = self.pixels.len() * 4;
        if !self.mapped.is_null() && self.mapped_len >= byte_len {
            // SAFETY: `self.mapped` is a valid `mmap`'d `/dev/fb0` region of at least `byte_len` bytes,
            // non-overlapping with heap-allocated `self.pixels`.
            unsafe {
                ptr::copy_nonoverlapping(self.pixels.as_ptr().cast::<u8>(), self.mapped, byte_len);
            }
            return Ok(());
        }
        let Some(file) = self.file.as_mut() else {
            return Ok(());
        };
        file.seek(SeekFrom::Start(0))?;
        // SAFETY: `self.pixels` is a contiguous `Vec<u32>` on little-endian aarch64/x86_64.
        let bytes = unsafe { slice::from_raw_parts(self.pixels.as_ptr().cast::<u8>(), byte_len) };
        file.write_all(bytes)?;
        Ok(())
    }
}

impl Drop for Framebuffer {
    fn drop(&mut self) {
        if !self.mapped.is_null() && self.mapped_len > 0 {
            // SAFETY: `self.mapped` was returned by `libc::mmap` with length `self.mapped_len`.
            unsafe {
                let _ = libc::munmap(self.mapped.cast(), self.mapped_len);
            }
        }
    }
}

/// Pure Liang-Barsky segment clipper (unit-tested independently of framebuffer).
#[must_use]
#[allow(clippy::too_many_arguments)]
pub fn clip_segment(
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    xmin: f64,
    ymin: f64,
    xmax: f64,
    ymax: f64,
) -> Option<(f64, f64, f64, f64)> {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let mut t0 = 0.0_f64;
    let mut t1 = 1.0_f64;
    for (p, q) in [(-dx, x0 - xmin), (dx, xmax - x0), (-dy, y0 - ymin), (dy, ymax - y0)] {
        if p.abs() < 1e-12 {
            if q < 0.0 {
                return None;
            }
        } else {
            let r = q / p;
            if p < 0.0 {
                if r > t1 {
                    return None;
                }
                if r > t0 {
                    t0 = r;
                }
            } else {
                if r < t0 {
                    return None;
                }
                if r < t1 {
                    t1 = r;
                }
            }
        }
    }
    Some((x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RawKey {
    Char(char),
    Esc,
    Enter,
    Tab,
    Up,
    Down,
    Left,
    Right,
    CtrlC,
}

/// RAII non-blocking POSIX cbreak TTY key reader for `/dev/fb0` graphical applications.
/// Restores original `termios` attributes automatically on `Drop`.
pub struct RawKeyReader {
    fd: RawFd,
    orig: Option<libc::termios>,
}

impl RawKeyReader {
    #[must_use]
    pub fn enter() -> Self {
        let fd = libc::STDIN_FILENO;
        // SAFETY: `isatty` and `tcgetattr`/`tcsetattr` operate on standard input fd 0.
        let orig = unsafe {
            if libc::isatty(fd) == 1 {
                let mut t = MaybeUninit::<libc::termios>::uninit();
                if libc::tcgetattr(fd, t.as_mut_ptr()) == 0 {
                    let saved = t.assume_init();
                    let mut raw = saved;
                    raw.c_lflag &= !(libc::ICANON | libc::ECHO);
                    raw.c_cc[libc::VMIN] = 0;
                    raw.c_cc[libc::VTIME] = 0;
                    let _ = libc::tcsetattr(fd, libc::TCSANOW, &raw const raw);
                    Some(saved)
                } else {
                    None
                }
            } else {
                None
            }
        };
        Self { fd, orig }
    }

    /// Non-blocking poll for one keypress (`timeout_ms = 0` returns immediately).
    #[must_use]
    pub fn poll(&self, timeout_ms: i32) -> Option<RawKey> {
        self.orig?;
        let mut pfd = libc::pollfd {
            fd: self.fd,
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: `poll` and `read` operate on valid stack buffer and stdin fd.
        let ready = unsafe { libc::poll(&raw mut pfd, 1, timeout_ms) };
        if ready <= 0 || (pfd.revents & libc::POLLIN) == 0 {
            return None;
        }
        let mut buf = [0u8; 8];
        let n = unsafe { libc::read(self.fd, buf.as_mut_ptr().cast(), buf.len()) };
        if n <= 0 {
            return None;
        }
        let bytes = &buf[..n as usize];
        match bytes {
            [3, ..] => Some(RawKey::CtrlC),
            [27] => Some(RawKey::Esc),
            [27, b'[' | b'O', b'A', ..] => Some(RawKey::Up),
            [27, b'[' | b'O', b'B', ..] => Some(RawKey::Down),
            [27, b'[' | b'O', b'C', ..] => Some(RawKey::Right),
            [27, b'[' | b'O', b'D', ..] => Some(RawKey::Left),
            [b'\r' | b'\n', ..] => Some(RawKey::Enter),
            [b'\t', ..] => Some(RawKey::Tab),
            [c, ..] if c.is_ascii_graphic() || *c == b' ' => Some(RawKey::Char(*c as char)),
            _ => None,
        }
    }
}

impl Drop for RawKeyReader {
    fn drop(&mut self) {
        if let Some(saved) = self.orig {
            // SAFETY: Restores saved terminal attributes on exit.
            unsafe {
                let _ = libc::tcsetattr(self.fd, libc::TCSANOW, &raw const saved);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn liang_barsky_clips_segments_precisely() {
        let clipped = clip_segment(-50.0, 50.0, 150.0, 50.0, 0.0, 0.0, 100.0, 100.0).unwrap();
        assert!((clipped.0 - 0.0).abs() < 1e-6);
        assert!((clipped.2 - 100.0).abs() < 1e-6);
        assert!(clip_segment(-50.0, -10.0, 150.0, -10.0, 0.0, 0.0, 100.0, 100.0).is_none());
    }

    #[test]
    fn offscreen_fb_renders_primitives_and_text_safely() {
        let mut fb = Framebuffer::offscreen(128, 128);
        fb.clear(rgb(4, 16, 24));
        fb.fill_rect(10, 10, 20, 20, rgb(255, 0, 0));
        fb.draw_text(4, 4, "PFD 241", rgb(0, 255, 128), 1);
        fb.circle(64, 64, 30, rgb(255, 255, 255));
        fb.fill_triangle((64, 20), (58, 30), (70, 30), rgb(255, 210, 0));
        assert_eq!(fb.pixels[15 * 128 + 15], rgb(255, 0, 0));
        assert_eq!(fb.pixels[25 * 128 + 64], rgb(255, 210, 0));
    }
}
