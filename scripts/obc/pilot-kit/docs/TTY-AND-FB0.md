# TTY, Interactive TUIs (Ratatui / Python / Node) & `/dev/fb0` Graphics Guide

This handbook documents the exact hardware contract of Unkernel's virtual serial TTY and `/dev/fb0` (`kwfb`) display device so every TUI and graphical app you build runs at **20–30 Hz** on both the HUD console and all 3D cockpits.

---

## 1. Virtual Serial TTY & Interactive TUIs

### Critical Gotcha #1: `TIOCGWINSZ` Returns `(0, 0)`

Unkernel's serial console (`/dev/hvc0` / `/dev/ttyS0`) does not support dynamic SIGWINCH resizing, so `ioctl(TIOCGWINSZ)` returns **`(0, 0)`**.
If you call Ratatui's `Terminal::new(CrosstermBackend::new(io::stdout()))` directly, Ratatui gets `Rect(0, 0, 0, 0)` and **draws zero characters**!

**Mandatory Ratatui 0.29 pattern:**
```rust
use ratatui::backend::CrosstermBackend;
use ratatui::layout::Rect;
use ratatui::{Terminal, TerminalOptions, Viewport};
use std::io;

let tty_size = crossterm::terminal::size().unwrap_or((0, 0));
let (mut terminal, vp_height) = if tty_size.0 >= 40 && tty_size.1 >= 12 {
    (Terminal::new(CrosstermBackend::new(io::stdout()))?, tty_size.1)
} else {
    let cols = std::env::var("COLUMNS").ok().and_then(|v| v.parse().ok()).filter(|&n| n >= 40).unwrap_or(100);
    let rows = std::env::var("LINES").ok().and_then(|v| v.parse().ok()).filter(|&n| n >= 12).unwrap_or(26);
    (
        Terminal::with_options(
            CrosstermBackend::new(io::stdout()),
            TerminalOptions { viewport: Viewport::Fixed(Rect::new(0, 0, cols, rows)) },
        )?,
        rows,
    )
};
```

### Critical Gotcha #2: `100×26` 3D Cockpit Mirror Budget

The simulator mirrors the live terminal into a `TermBuffer(100, 26)` (for Ranger MFD, F-35 PCD, A320 LECAM, Crew console, and `__bh.obc.readScreen()`).
- Keep default TUI dimensions to **`100×26`** (or smaller) so full-width borders never wrap or scroll row 0 off the 3D cockpit screen.
- Put your app title on row 0 and hotkey legend on the bottom row.

### Critical Gotcha #3: Interactive vs `--frames N` vs Piped Mode

Always support three clean execution modes in every TUI:
1. **Piped (`!isatty(1)`) with `--frames N`**: Render into Ratatui `TestBackend::new(96, 28)` (or plain UTF-8 lines in Python/Node) and dump clean text to stdout — enables instant scripted testing.
2. **TTY with `--frames N`**: Do **NOT** enter/leave alternate screen (`?1049h`/`?1049l`), otherwise the final frame vanishes on exit. Clear screen, render `N` colorful frames, park cursor at `(0, vp_height - 1)` without printing a trailing newline, and restore cursor visibility + cooked mode.
3. **Interactive TTY (no `--frames`)**: Enter raw mode + `EnterAlternateScreen`, poll keys with a 50–120 ms tick, quit cleanly on `q`, `Esc`, or `Ctrl+C`, and restore cooked mode + `LeaveAlternateScreen` via RAII `Drop` / `try..finally`.

### Keyboard Routing

The HUD console captures keys in the DOM capture phase (`keydown`/`keyup`) and forwards them directly to the Linux PTY — including `Tab`, `Esc`, arrows (`\x1b[A..D`), `Enter`, `Backspace`, `Ctrl+C` (`\x03`), `F1–F10`, and printable keys — **even when the console is in `/dev/fb0`-only mode** (xterm hidden!).

---

## 2. Real-Time `/dev/fb0` Graphical Applications (`kwfb`)

Opening `/dev/fb0` automatically activates the live hardware display panel in the HUD console **and** projects the framebuffer onto any active 3D cockpit OBC screen (Ranger MFD, F-35 PCD `OBC`, A320 Lower ECAM `obcPage`). Closing `/dev/fb0` automatically restores the terminal display.

### Hardware Format

- **Device**: `/dev/fb0`
- **Active resolution**: Default **`512×512`** (user-configurable 256–1024 px in HUD Options)
- **Pixel format**: **XRGB8888**, 32 bits/pixel (4 bytes/pixel), little-endian `u32`:
  - `pixel = 0xFF00_0000 | (r << 16) | (g << 8) | b`
  - Byte order in memory: `[B, G, R, 0xFF]`
- **Host refresh rate**: Polled up to **30 Hz** (`33 ms`); aim for **20–30 FPS** inside the guest.

### Critical Gotcha #4: NEVER Write `virtual_size` Bytes (`ENOSPC`!)

Unkernel's `kwfb` driver reports double-buffered dimensions in `/sys/class/graphics/fb0/virtual_size` (e.g. `512,1024`), while the mappable/writable single-frame buffer is **`xres × yres × 4`** (`512 × 512 × 4 = 1,048,576` bytes).
Writing `512 × 1024 × 4` bytes fails with **`ENOSPC` (os error 28)**!

**Mandatory `/dev/fb0` initialization (Rust / C / Python):**
1. Open `/dev/fb0` with `O_RDWR` (`read(true).write(true)`).
2. Query active `xres, yres` via **`ioctl(fd, FBIOGET_VSCREENINFO /* 0x4600 */, &mut fb_var_screeninfo)`** — the first two `u32` fields are `xres` and `yres` (fallback `(512, 512)`).
3. Map exact `byte_len = xres * yres * 4` via **`mmap(NULL, byte_len, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0)`**.
4. Render into a pre-allocated backbuffer (`Vec<u32>` / `bytearray` / `Uint32Array`) with **zero per-frame heap allocations**, then `memcpy` the entire buffer into the `mmap` slice once per frame (`flush()`).
5. On `Drop` / exit: `munmap` and close `/dev/fb0`.

### Minimal Rust `/dev/fb0` Zero-Alloc Starter

```rust
use std::fs::OpenOptions;
use std::os::unix::io::AsRawFd;
use std::ptr;

const FBIOGET_VSCREENINFO: libc::c_ulong = 0x4600;

#[inline]
const fn rgb(r: u8, g: u8, b: u8) -> u32 {
    0xff00_0000 | ((r as u32) << 16) | ((g as u32) << 8) | (b as u32)
}

fn open_fb() -> std::io::Result<(std::fs::File, usize, usize, *mut u8, usize)> {
    let f = OpenOptions::new().read(true).write(true).open("/dev/fb0")?;
    let mut info = [0u32; 40];
    let rc = unsafe { libc::ioctl(f.as_raw_fd(), FBIOGET_VSCREENINFO as _, info.as_mut_ptr()) };
    let (w, h) = if rc == 0 && (128..=2048).contains(&info[0]) && (128..=2048).contains(&info[1]) {
        (info[0] as usize, info[1] as usize)
    } else {
        (512, 512)
    };
    let len = w * h * 4;
    let map = unsafe {
        libc::mmap(ptr::null_mut(), len, libc::PROT_READ | libc::PROT_WRITE, libc::MAP_SHARED, f.as_raw_fd(), 0)
    };
    assert_ne!(map, libc::MAP_FAILED, "mmap /dev/fb0 failed");
    Ok((f, w, h, map.cast::<u8>(), len))
}
```

### Minimal Python `/dev/fb0` Starter (using pre-installed `/obc/lib/obc.py`)

```python
#!/usr/bin/env python3
import time, obc

bus = obc.AvionicsBus()
fb = obc.Framebuffer()
with obc.RawKeys() as keys:
    t0 = time.monotonic()
    while time.monotonic() - t0 < 15.0:
        if keys.read() in ("q", "\x1b", "\x03"):
            break
        s = bus.read()
        fb.clear(0x061018)
        fb.text(16, 16, f"{s.vessel_id.upper()} HDG {s.heading:03.0f} ALT {s.altitude_msl:.0f}M", 0x62E6FF, scale=2)
        fb.flush()
        time.sleep(0.04)
fb.close()
```

### Non-Blocking Keyboard Input in `/dev/fb0` Apps

Always put `STDIN_FILENO` into raw mode (`termios`: clear `ICANON | ECHO`) with an RAII guard, and poll with `libc::poll(&mut pollfd { fd: 0, events: POLLIN }, 1, 0)` each frame. Handle `q`, `Esc` (`0x1b`), and `Ctrl+C` (`0x03`) so the pilot can always exit cleanly from `/dev/fb0`-only mode.

---

## 3. Exact 1:1 PFD Artificial Horizon Math (Verified Against Simulator HUD)

When building flight instruments (PFD, HUD, attitude indicator):
- Read `pitch_deg` (+nose up) and `roll_deg` (+right wing down) from `/obc/telemetry.json`.
- For a screen pixel `(dx, dy)` relative to the attitude center `(cx, cy)` (`+dy` is down):
  - Rotate into the aircraft-horizon frame by `roll = roll_deg.to_radians()`:
    - `u =  dx * cos(roll) + dy * sin(roll)`
    - `v = -dx * sin(roll) + dy * cos(roll)`
  - Horizon line lies at **`v_horizon = pitch_deg * px_per_deg`** (`+pitch` moves the horizon **down**, showing more blue sky above center!).
  - Pixel is **sky** when `v < v_horizon`, **ground** when `v >= v_horizon`.
- Verified 1:1 against the 3D F-35 HUD at `-29.7°` left bank / `-7.5°` pitch.
