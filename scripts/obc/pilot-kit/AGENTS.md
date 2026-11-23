# Agents' Entry Point — Black Hole GPU Linux OBC (`/home/pilot`)

For **Pi** (`@earendil-works/pi-coding-agent`), **Claude Code** (`claude`), and any autonomous coding agent operating inside this embedded Linux On-Board Computer.

- **Primary instructions & non-negotiable Unkernel rules**: [CLAUDE.md](CLAUDE.md)
- **Quick-start & workspace layout**: [README.md](README.md)
- **OBC hardware, 9p `/obc/*`, `telemetry.json`, `/obc/cmd`, `AF_VSOCK:4747`, SDKs**: [docs/OBC-ARCHITECTURE.md](docs/OBC-ARCHITECTURE.md)
- **Full `window.__bh` API & 73 TARS tools from Linux**: [docs/BH-API-GUIDE.md](docs/BH-API-GUIDE.md)
- **Building TUIs (Ratatui / Python / Node) & `/dev/fb0` real-time graphics**: [docs/TTY-AND-FB0.md](docs/TTY-AND-FB0.md)
- **Unkernel Linux 7.x `aarch64` administration (Alpine/Debian, Wisp, RAM, Cargo, persistence)**: [docs/UNKERNEL-LINUX.md](docs/UNKERNEL-LINUX.md)

## Agent Skills

Both `.pi/skills/` and `.claude/skills/` (and `.agents/skills/`) expose the same 5 operational skills:

1. `obc-build-fb-app` — Real-time `/dev/fb0` XRGB8888 `mmap` graphical avionics apps (Rust / Python / Node).
2. `obc-build-tui-app` — Interactive TUIs (Ratatui / Python / Node) compatible with `TIOCGWINSZ=(0,0)` & 3D cockpits.
3. `obc-control-sim` — End-to-end simulator control (F-35, A320, Ranger, Gargantua, airports, ILS, MCDU, 73 TARS tools).
4. `obc-manage-linux` — Package/toolchain management (`obc-install`), Wisp networking, disk/RAM tuning, publishing CLI tools.
5. `obc-rust-dev` — Compiling & testing Rust + Ratatui + `/dev/fb0` crates cleanly inside the OBC VM.

## Golden Workflow for Creating New Programs in `/home/pilot`

1. Read `CLAUDE.md` and the matching guide in `docs/` (plus the relevant skill in `.pi/skills/` or `.claude/skills/`).
2. Inspect live simulator state first with `cat /obc/telemetry.json` and `bh ls` / `bh search <topic>`.
3. Place source & executable scripts in `/home/pilot/<project>/` and symlink runnable CLIs into `$HOME/.local/bin/<name>` (`chmod +x`).
4. Verify non-interactively before finishing:
   - CLI: test `--help` and `--json` output, check exit code `0`.
   - TUI: test `--frames 1` piped (`!isatty`) AND live TTY size fallback (`100×26`).
   - `/dev/fb0`: test `--seconds 1.5`, verify `ioctl(FBIOGET_VSCREENINFO)` + `mmap` exits `0` with zero `ENOSPC` and restores terminal cleanly.
