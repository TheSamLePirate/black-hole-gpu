# Unkernel Linux 7.x `aarch64` Specifics & System Administration

This Linux OBC runs on **Unkernel** — a real Linux 7.3.4+ `aarch64` kernel compiled to WebAssembly with an aarch64 JIT running inside a browser Web Worker. Most standard Linux commands work identically to a physical ARM64 machine, with a handful of important specifics documented below.

---

## 1. Dual Distribution Support (Alpine 3.24 & Debian 13 Trixie)

The user can switch distributions live from the HUD topbar or `__bh.obc.switchDistro("alpine" | "debian")`:

| Property | Alpine 3.24 (default) | Debian 13 (Trixie) |
|---|---|---|
| C library | `musl` | `glibc` |
| Package manager | `apk` (`apk add --no-cache ...`) | `apt-get` (`apt-get update && apt-get install -y ...`) |
| Boot time | ~0.6–0.9 s | ~9–13 s |
| Default shell | `ash` (`/bin/sh`) | `bash` |
| Rust package version | `rust 1.96.1` / `cargo 1.96.1` | `rustc 1.85.1` / `cargo 1.85.1` |
| Python / Node | `Python 3.14` / `Node v24` | `Python 3.13` / `Node v26` |

**Writing distro-portable scripts**:
```sh
if command -v apk >/dev/null 2>&1; then
  # Alpine Linux
  apk add --no-cache jq
elif command -v apt-get >/dev/null 2>&1; then
  # Debian 13
  apt-get update && apt-get install -y --no-install-recommends jq
fi
```

---

## 2. Filesystem Layout & Persistence

| Mount / Dir | Backing Store | Survives Reboot? | Notes |
|---|---|---|---|
| `/` | EROFS image + tmpfs/overlay | Root packages persist only if written to `/data` or overlay | Fast read-only base OS |
| `/home/pilot` | Persistent `/data` (IndexedDB) | **YES** (when `persistData` enabled) | Put all user scripts, Rust/Python/Node projects, and configs here |
| `/data` | IndexedDB block device | **YES** | Persistent storage partition |
| `/obc` | Live 9p Host `MemoryFs` | Refreshed from host every boot | Read-only `/obc/bin`, `/obc/scripts`, `/obc/lib`, `/obc/pilot-kit`; live `/obc/telemetry.json`, `/obc/cmd`, `/obc/rpc_req` |
| `/tmp` | `tmpfs` (RAM) | No | Fast scratch space (counts against VM RAM!) |

---

## 3. Memory Budgets (512 MiB · 1 GiB · 2 GiB default · 4 GiB)

Check live memory anytime with `free -m` or `cat /obc/status.json`.
- Default RAM is **2048 MiB** (user can pick 512 / 1024 / 2048 / 4096 MiB in HUD Options).
- **Node.js heap cap**: `/etc/profile.d/obc.sh` automatically sets `NODE_OPTIONS="--max-old-space-size=..."` scaled to VM RAM so V8 never OOMs.
- **Rust / Cargo compilation inside the guest**:
  - Always set **`CARGO_BUILD_JOBS=1`** (or `2` on 4 GiB) and **`CARGO_INCREMENTAL=0`** when compiling crates in the VM to keep peak LLVM RAM well under 800 MiB.
  - Prefer `opt-level = 2` (or `dev` during iteration) instead of `lto = "fat"` inside the guest; reserve `lto = "fat"` for final release builds on ≥ 2 GiB RAM.
  - Keep `/tmp` clean (`rm -rf /tmp/*`) — files in `/tmp` consume RAM directly.

---

## 4. Networking (Wisp v1 WebSocket-to-TCP Relay)

Outbound Internet access goes through a **Wisp v1** relay (`wss://code.samlepirate.org/` in production, `/__wisp` in local dev):
- **Works transparently**: `apk`, `apt-get`, `curl`, `wget`, `pip`, `npm`, `bun`, `cargo`, `git clone https://...`, `claude`, `pi`, HTTPS APIs, DNS.
- **Does NOT work**: Raw ICMP `ping`, raw sockets, UDP broadcast/multicast, inbound server ports from outside the browser.
- **Diagnostics**: Check `cat /obc/status.json` (`netEnabled`, `wispUrl`) or test with `curl -fsSI https://code.samlepirate.org/health`.

---

## 5. PATH & `/usr/lib/kw/bin` Stubs

Unkernel places lazy-install stub wrappers inside `/usr/lib/kw/bin/`. Always ensure real binaries precede it:
```sh
export PATH="/obc/bin:/obc/scripts:$HOME/.local/bin:$HOME/.bun/bin:/home/user/.local/bin:/home/user/.bun/bin:/usr/local/bin:$PATH:/usr/lib/kw/bin"
```
This is configured automatically in `/etc/profile.d/obc.sh` and `/etc/bash.bashrc`.
To check whether a tool is genuinely installed (and not a `/usr/lib/kw/bin` stub):
```sh
obc-diag        # Reports exact installed versions or "not-installed"
which -a node   # Real binary is in /usr/bin/node or /usr/local/bin/node
```

---

## 6. Installing Toolchains (`obc-install`)

Use the built-in multi-distro installer (handles both Alpine `apk` and Debian `apt-get` + Node/Bun/Pi/Claude/Rust):
```sh
obc-install python    # Python 3 + pip
obc-install node      # Node.js + npm
obc-install bun       # Bun (aarch64 native)
obc-install rust      # rustc + cargo + C toolchain
obc-install pi        # npm install -g --ignore-scripts @earendil-works/pi-coding-agent
obc-install claude    # Claude Code CLI
obc-install all       # All 7 core tools (python, pip, node, npm, bun, pi, claude)
```

---

## 7. Known Emulation Gotchas Checklist

1. **No `Atomics.wait` in Node.js** — `futex_wait` can stall on emulated `aarch64`. Never use `Atomics.wait` for synchronous sleeps; use `setTimeout` / async loops or `/bin/sleep`.
2. **Serial TTY `TIOCGWINSZ = (0, 0)`** — Always fall back to `100×26` in TUIs (see `docs/TTY-AND-FB0.md`).
3. **`/dev/fb0` `virtual_size` vs `xres × yres`** — Always use `FBIOGET_VSCREENINFO` (`0x4600`) + `mmap` (never `write()` `virtual_size` bytes).
4. **9p `/obc/telemetry.json` atomic rename** — Read into string, `.trim()`, and keep last valid frame on transient `ENOENT` or partial read.
5. **Running as `root` vs `user`** — Shell commands may run as `uid 0` (root) or `uid 1000` (`user`). Install shared executables in `/home/pilot/bin` or `$HOME/.local/bin` with `chmod 755` so both users can execute them.
6. **Audio output (`/dev/dsp` / ALSA)** — Available only when the user enables **Sound** in HUD Options (`soundEnabled: true` in `/obc/status.json`).
7. **Snapshots & Hibernation** — The user can suspend/resume the VM at any time. Always flush important files to `/home/pilot/` (not `/tmp/`) so work survives hibernation.
