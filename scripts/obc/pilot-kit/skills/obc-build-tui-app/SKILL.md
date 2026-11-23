---
name: obc-build-tui-app
description: Build an interactive real-time TUI (Rust Ratatui 0.29, Python, or Node.js) for the Linux OBC that works cleanly on Unkernel's TIOCGWINSZ=(0,0) serial TTY, 100x26 3D cockpit mirror, and headless --frames N tests.
---

# Skill: Build an Interactive OBC TUI

Use this skill whenever asked to create a terminal dashboard, avionics console, mission planner, or interactive tool in the Linux OBC.

## Prerequisites
- Read `docs/TTY-AND-FB0.md` and `docs/BH-API-GUIDE.md`.

## Mandatory Design Rules
1. **Handle `TIOCGWINSZ = (0, 0)`**:
   - Unkernel's virtual serial TTY reports `(0, 0)` to `TIOCGWINSZ`.
   - In **Rust / Ratatui**, fall back to `Terminal::with_options(backend, TerminalOptions { viewport: Viewport::Fixed(Rect::new(0, 0, cols, rows)) })` with `cols = COLUMNS || 100`, `rows = LINES || 26`.
   - In **Python / Node**, fall back to `(100, 26)` whenever `os.get_terminal_size()` / `process.stdout.columns` is missing or `< 40`.
2. **Fit inside `100×26` cleanly**: The 3D cockpit displays and `__bh.obc.readScreen()` mirror a `100×26` `TermBuffer`. Never emit lines wider than 100 chars when using the default viewport.
3. **Support `--frames N` cleanly**:
   - When `!isatty(1)` (piped/scripted verification): render `N` frames via `TestBackend::new(96, 28)` (Ratatui) or plain ANSI/UTF-8 output to stdout and exit `0`.
   - When `isatty(1)` with `--frames N`: draw on the **main screen** (no `EnterAlternateScreen`/`LeaveAlternateScreen`), park cursor at `(0, rows - 1)` with no trailing newline so the final frame stays visible.
   - When interactive (no `--frames`): use `EnterAlternateScreen` + raw mode, and restore `LeaveAlternateScreen` + cooked mode on `Drop` / `finally`.
4. **Interactive Simulator Control**:
   - Bind intuitive single-key hotkeys (`[↑/↓]` navigate, `[Tab]` switch tabs, `[+/-]` throttle/range, `[a]` AP, `[g]` gear, `[s]` SAS, `[r]` refresh, `[q]` / `Ctrl+C` quit).
   - Dispatch actions via `/obc/cmd` (fast flight controls) or `/obc/rpc_req` (full `__bh` & 73 TARS tools).
   - Never use `Atomics.wait` in Node.js TUIs.

## Verification Checklist
1. Run `<app> --frames 1 | head -n 30` (piped) → verify exit code `0`, crisp layout, and live telemetry values.
2. Run `<app> --frames 2` on the TTY → verify colors, borders, and clean shell restoration.
3. Confirm `q` and `Ctrl+C` exit immediately without leaving raw mode stuck.
4. Symlink the finished binary/script into `$HOME/.local/bin/<app>`.
