//! Six AAA interactive Ratatui TUIs for the embedded Linux On-Board Computer:
//! - `bh_tui`: Universal `__bh` & 73 TARS Tools Explorer (`BH-TUI`)
//! - `top`: Real-time Avionics System Monitor (`OBC-TOP`)
//! - `mission`: Orbital Flight Director with Braille Canvas (`OBC-MISSION-TUI`)
//! - `fmc`: Flight Management Computer & ILS/WGS84 Monitor (`OBC-FMC-TUI`)
//! - `f35_tui`: F-35B/C WSO Tactical & Radar Console (`OBC-F35-TUI`)
//! - `a320_tui`: Airbus A320 FCU + Live Captain MCDU & ECAM Console (`OBC-A320-TUI`)

pub mod a320_tui;
pub mod bh_tui;
pub mod f35_tui;
pub mod fmc;
pub mod fuzzy;
pub mod mission;
pub mod top;

use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ratatui::backend::{CrosstermBackend, TestBackend};
use ratatui::layout::Rect;
use ratatui::{Frame, Terminal, TerminalOptions, Viewport};
use std::io::{self, Stdout, Write};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, Default)]
pub struct TuiRunOpts {
    pub frames: Option<u32>,
}

impl TuiRunOpts {
    #[must_use]
    pub fn from_args(args: &[String]) -> Self {
        let mut frames = None;
        let mut i = 0;
        while i < args.len() {
            if args[i] == "--frames"
                && let Some(n) = args.get(i + 1).and_then(|s| s.parse::<u32>().ok())
                && n > 0
            {
                frames = Some(n);
                i += 2;
                continue;
            }
            i += 1;
        }
        Self { frames }
    }
}

/// Trait implemented by all 6 Ratatui avionics applications (clean Elm/TEA architecture).
pub trait TuiApp {
    /// Refresh telemetry / RPC state on each tick.
    fn tick(&mut self);
    /// Handle one keyboard event; return `true` to quit cleanly.
    fn on_key(&mut self, key: KeyEvent) -> bool;
    /// Render the Ratatui UI frame.
    fn draw(&mut self, frame: &mut Frame);
}

struct TerminalGuard {
    active: bool,
    alt_screen: bool,
}

impl TerminalGuard {
    fn enter(alt_screen: bool) -> Result<Self> {
        enable_raw_mode()?;
        let mut out = io::stdout();
        if alt_screen {
            execute!(out, EnterAlternateScreen)?;
        }
        Ok(Self {
            active: true,
            alt_screen,
        })
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        if self.active {
            let _ = disable_raw_mode();
            let mut out = io::stdout();
            // Always clear any mouse/focus reporting modes on exit
            let _ = out.write_all(b"\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1004l");
            if self.alt_screen {
                let _ = execute!(out, LeaveAlternateScreen);
            } else {
                let _ = execute!(out, crossterm::cursor::Show);
            }
            let _ = out.flush();
        }
    }
}

/// Detect the exact live terminal dimensions:
/// 1. `/obc/tty_size` (live 9p host file written by `xterm.js` `FitAddon` on open, Split/TTY toggle, and panel resize)
/// 2. Kernel `TIOCGWINSZ` (`crossterm::terminal::size()`) when valid (`>= 40×10`)
/// 3. `COLUMNS`/`LINES` env vars, else safe `100×26` default.
#[must_use]
fn detect_tty_size() -> (u16, u16) {
    if let Ok(raw) = std::fs::read_to_string("/obc/tty_size") {
        let mut parts = raw.split_whitespace();
        if let (Some(cs), Some(rs)) = (parts.next(), parts.next())
            && let (Ok(c), Ok(r)) = (cs.parse::<u16>(), rs.parse::<u16>())
            && (40..=240).contains(&c)
            && (10..=80).contains(&r)
        {
            return (c, r);
        }
    }
    if let Ok((c, r)) = crossterm::terminal::size()
        && c >= 40
        && r >= 10
    {
        return (c.min(240), r.min(80));
    }
    let cols = std::env::var("COLUMNS")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .filter(|&n| n >= 40)
        .unwrap_or(100);
    let rows = std::env::var("LINES")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .filter(|&n| n >= 10)
        .unwrap_or(26);
    (cols, rows)
}

fn make_fixed_terminal(cols: u16, rows: u16) -> Result<Terminal<CrosstermBackend<Stdout>>> {
    let backend = CrosstermBackend::new(io::stdout());
    let mut terminal = Terminal::with_options(
        backend,
        TerminalOptions {
            viewport: Viewport::Fixed(Rect::new(0, 0, cols, rows)),
        },
    )?;
    execute!(
        io::stdout(),
        crossterm::terminal::Clear(crossterm::terminal::ClearType::All),
        crossterm::cursor::MoveTo(0, 0)
    )?;
    terminal.clear()?;
    Ok(terminal)
}

/// Shared event loop for interactive TTY mode (`CrosstermBackend`) and headless `--frames N` mode (`TestBackend`).
pub fn run_tui<A: TuiApp>(app: &mut A, opts: TuiRunOpts, tick_ms: u64) -> Result<()> {
    // SAFETY: `isatty` checks stdout fd 1.
    let is_tty = unsafe { libc::isatty(libc::STDOUT_FILENO) == 1 };
    if let Some(n) = opts.frames
        && !is_tty
    {
        // Headless/piped execution (e.g. `vm.exec("obc-top --frames 2")`): render cleanly with TestBackend.
        let mut term = Terminal::new(TestBackend::new(96, 28))?;
        for _ in 0..n {
            app.tick();
            term.draw(|f| app.draw(f))?;
        }
        let buf = term.backend().buffer();
        let mut out = io::stdout().lock();
        for y in 0..buf.area.height {
            let mut line = String::with_capacity(buf.area.width as usize);
            for x in 0..buf.area.width {
                line.push_str(buf[(x, y)].symbol());
            }
            writeln!(out, "{}", line.trim_end())?;
        }
        return Ok(());
    }

    // Interactive sessions use the alternate screen (clean restore on `q`).
    // Explicit `--frames N` on a TTY draws on the main screen so the final Ratatui frame remains visible.
    let alt_screen = opts.frames.is_none();
    let _guard = TerminalGuard::enter(alt_screen)?;
    let (mut cur_cols, mut cur_rows) = detect_tty_size();
    let mut terminal = make_fixed_terminal(cur_cols, cur_rows)?;

    let tick_rate = Duration::from_millis(tick_ms.max(40));
    let mut last_tick = Instant::now().checked_sub(tick_rate).unwrap_or_else(Instant::now);
    let mut rendered = 0u32;

    loop {
        // Dynamically track live xterm.js resizes (Split/TTY toggle, Manager drawer, draggable window resize)
        let (next_cols, next_rows) = detect_tty_size();
        if (next_cols, next_rows) != (cur_cols, cur_rows) {
            cur_cols = next_cols;
            cur_rows = next_rows;
            terminal = make_fixed_terminal(cur_cols, cur_rows)?;
        }

        if last_tick.elapsed() >= tick_rate {
            app.tick();
            last_tick = Instant::now();
        }
        terminal.draw(|f| app.draw(f))?;
        rendered += 1;
        if let Some(limit) = opts.frames
            && rendered >= limit
        {
            if !alt_screen {
                let _ = execute!(
                    io::stdout(),
                    crossterm::cursor::MoveTo(0, cur_rows.saturating_sub(1))
                );
            }
            break;
        }
        let wait = tick_rate.saturating_sub(last_tick.elapsed());
        if event::poll(wait)? {
            match event::read()? {
                Event::Key(key) if key.kind == KeyEventKind::Press => {
                    if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
                        break;
                    }
                    if app.on_key(key) {
                        break;
                    }
                }
                Event::Resize(c, r) => {
                    let (tc, tr) = if c >= 40 && r >= 10 {
                        (c.min(240), r.min(80))
                    } else {
                        detect_tty_size()
                    };
                    if (tc, tr) != (cur_cols, cur_rows) {
                        cur_cols = tc;
                        cur_rows = tr;
                        terminal = make_fixed_terminal(cur_cols, cur_rows)?;
                    }
                }
                _ => {}
            }
        }
    }
    Ok(())
}

/// Render one frame into a plain text snapshot string using `TestBackend` (for unit tests).
#[must_use]
pub fn render_snapshot<A: TuiApp>(app: &mut A, width: u16, height: u16) -> String {
    let mut term = Terminal::new(TestBackend::new(width, height)).expect("TestBackend");
    term.draw(|f| app.draw(f)).expect("draw");
    let buf = term.backend().buffer();
    let mut out = String::new();
    for y in 0..buf.area.height {
        let mut line = String::with_capacity(buf.area.width as usize);
        for x in 0..buf.area.width {
            line.push_str(buf[(x, y)].symbol());
        }
        out.push_str(line.trim_end());
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_six_ratatui_apps_render_without_panicking() {
        let mut bh = bh_tui::BhTuiApp::offline();
        let s_bh = render_snapshot(&mut bh, 100, 30);
        assert!(s_bh.contains("BH-TUI"));
        // Tab switches to TARS TOOLS
        bh.on_key(KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE));
        let s_tars = render_snapshot(&mut bh, 100, 30);
        assert!(s_tars.contains("TARS TOOLS"));

        let mut top_app = top::TopApp::offline();
        assert!(render_snapshot(&mut top_app, 100, 30).contains("OBC-TOP"));

        let mut mis = mission::MissionApp::offline();
        assert!(render_snapshot(&mut mis, 100, 30).contains("OBC-MISSION-TUI"));

        let mut fmc_app = fmc::FmcApp::offline();
        assert!(render_snapshot(&mut fmc_app, 100, 30).contains("OBC-FMC-TUI"));

        let mut f35 = f35_tui::F35TuiApp::offline();
        assert!(render_snapshot(&mut f35, 100, 30).contains("OBC-F35-TUI"));

        let mut a320 = a320_tui::A320TuiApp::offline();
        let s_a320 = render_snapshot(&mut a320, 100, 30);
        assert!(s_a320.contains("OBC-A320-TUI"));
        assert!(s_a320.contains("OBC LINUX LINK"));

        // Verify arrow keys work cleanly across all 6 TUIs without panicking
        for code in [KeyCode::Right, KeyCode::Left, KeyCode::Down, KeyCode::Up] {
            let ev = KeyEvent::new(code, KeyModifiers::NONE);
            bh.on_key(ev);
            top_app.on_key(ev);
            mis.on_key(ev);
            fmc_app.on_key(ev);
            f35.on_key(ev);
            a320.on_key(ev);
        }
        assert!(render_snapshot(&mut top_app, 100, 30).contains("[↑↓]"));
        assert!(render_snapshot(&mut f35, 100, 30).contains("[←→]"));
        assert!(render_snapshot(&mut a320, 100, 30).contains("[←→]"));
    }
}
