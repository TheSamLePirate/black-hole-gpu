# `/home/pilot` — Black Hole GPU Linux OBC Workspace

Welcome to the live **aarch64 Linux On-Board Computer** connected to the **Black Hole GPU** simulator.

## Workspace Layout

```text
/home/pilot/
├── CLAUDE.md                 # Auto-loaded by Claude Code (rules, map, sanity checks)
├── AGENTS.md                 # Auto-loaded by Pi & other coding agents
├── README.md                 # This quick-start guide
├── docs/
│   ├── OBC-ARCHITECTURE.md   # 9p /obc/*, telemetry.json, /obc/cmd, AF_VSOCK:4747, SDKs, 3D cockpits
│   ├── BH-API-GUIDE.md       # Universal __bh API & 73 TARS tools (bh CLI + RPC protocol)
│   ├── TTY-AND-FB0.md        # Ratatui/TUI & /dev/fb0 XRGB8888 mmap graphics handbook + templates
│   └── UNKERNEL-LINUX.md     # Unkernel Linux 7.x aarch64 specifics (Alpine/Debian, Wisp, RAM, Cargo)
├── .claude/skills/           # 5 AAA skills auto-discovered by Claude Code
├── .pi/skills/               # Symlink -> .claude/skills (auto-discovered by Pi)
└── .agents/skills/           # Symlink -> .claude/skills (Agent Skills standard)
```

> **Persistence**: `/home/pilot/` is stored on the persistent `/data` disk (IndexedDB). Any scripts, Rust/Python/Node projects, or data you create here survive reboots. System docs/skills are refreshed cleanly from `/obc/pilot-kit/` on boot without touching your own files.

## Built-in Native & Scripted Programs (Zero Setup Required)

All 12 flagship TUIs and `/dev/fb0` apps run **natively in compiled Rust** (`/obc/bin/obc-rs`, 1.0 MB static `aarch64` binary) on first boot — no Python or Node.js required:

| Category | Commands |
|---|---|
| **Diagnostics & Instant CLIs** | `obc-diag`, `obc-orbit`, `obc-reentry`, `obc-ils`, `obc-solar`, `obc-fdr`, `obc-fb-demo` |
| **Ratatui TUIs (native Rust)** | `bh-tui`, `obc-top`, `obc-mission-tui`, `obc-fmc-tui`, `obc-f35-tui`, `obc-a320-tui` |
| **`/dev/fb0` Graphics (native Rust, 20–30 Hz)** | `obc-pfd-fb`, `obc-f35-fb`, `obc-a320-fb`, `obc-ils-fb`, `obc-radar-fb`, `obc-kerr-fb` |
| **Node.js / Python CLIs** | `bh`, `obc-airports`, `obc-f35`, `obc-a320`, `obc-auto`, `obc-nav`, `obc-fuel`, `obc-kerr` |

*(Pass `OBC_LEGACY=1 <cmd>` to run the Python/Node fallback implementation of any TUI or `/dev/fb0` app.)*

## Installing Toolchains (Alpine 3.24 & Debian 13)

```sh
obc-install python    # Python 3 + pip
obc-install node      # Node.js + npm
obc-install bun       # Bun runtime
obc-install rust      # rustc + cargo + C linker (musl-dev / gcc+libc6-dev)
obc-install pi        # Pi coding agent (@earendil-works/pi-coding-agent)
obc-install claude    # Claude Code CLI
obc-install all       # python + pip + node + npm + bun + pi + claude
```

## Launching AI Coding Agents Here

```sh
cd /home/pilot
pi        # Automatically loads AGENTS.md + .pi/skills/*
claude    # Automatically loads CLAUDE.md + .claude/skills/*
```

## Creating Your Own Global Command

```sh
cat > /home/pilot/my-hud.py <<'PY'
#!/usr/bin/env python3
import obc
bus = obc.AvionicsBus()
s = bus.read()
print(f"{s.vessel_id.upper()} @ {s.body} | HDG {s.heading:05.1f}° | ALT {s.altitude_msl:.0f} m | TAS {s.true_airspeed:.1f} m/s")
PY
chmod +x /home/pilot/my-hud.py
ln -sf /home/pilot/my-hud.py "$HOME/.local/bin/my-hud"
my-hud
```
