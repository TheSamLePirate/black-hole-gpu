# OBC Architecture, I/O Channels & SDK Reference

This document describes every interface connecting the Linux guest to the **Black Hole GPU** WebGPU simulator.

---

## 1. Host Bridge Overview

The browser runs Linux `aarch64` inside a dedicated Web Worker (`Unkernel`) and connects it to the live simulator through **three channels**:

1. **9p Host Mount (`/obc`)** — Always available from millisecond 0, works from shell, Python, Node.js, Bun, Rust, C, or any process.
2. **`AF_VSOCK` Stream (`CID 2`, port `4747`)** — Low-latency bidirectional newline-delimited JSON RPC for high-frequency control loops.
3. **Virtual Devices** — Serial TTY (xterm HUD + `100×26` 3D cockpit mirror), `/dev/fb0` (`kwfb` 512×512 XRGB8888 framebuffer), `/dev/dsp` / ALSA (optional WebAudio bridge), `/dev/tau` (symlink to `/obc/tau`).

---

## 2. The `/obc` 9p Filesystem Map

| Path | Mode | Direction | Description |
|---|---|---|---|
| `/obc/telemetry.json` | `0444` | Host → Guest | Live `ObcTelemetry` v1 JSON refreshed at **5 Hz (200 ms)**, atomic rename, fixed 2048-byte space-padded |
| `/obc/tau` (`/dev/tau`) | `0444` | Host → Guest | Relativistic time dilation `key=value` (`dtau_dt`, `proper_time_s`, `sim_time_s`, `warp`, `frozen`, `body`) |
| `/obc/status.json` | `0444` | Host → Guest | OBC runtime status (`phase`, `distro`, `memoryMiB`, `fbActive`, `fbWidth`, `fbHeight`, `fbFps`, `wispUrl`, `commandsHandled`) |
| `/obc/cmd` | `0666` | Guest → Host | Fast flight-control command sink (newline-delimited JSON, validated & applied immediately) |
| `/obc/last_result.json` | `0444` | Host → Guest | Result of the most recent `/obc/cmd` write (`{"ok":true,"msg":"..."}`) |
| `/obc/rpc/<id>.req` | new file | Guest → Host | Keyed `__bh` & TARS RPC request (`BhRpcRequest`, one JSON line ending with `\n`; `<id>` = `<lang>-<pid>-<nonce>-<seq>`) |
| `/obc/rpc/<id>.res` | `0444` | Host → Guest | Its reply (`BhRpcResponse`, atomic rename); delete it once read (swept after 60 s) |
| `/obc/rpc_req` | `0666` | Guest → Host | Legacy single-slot request (older hosts without `/obc/rpc`) |
| `/obc/rpc_res` | `0444` | Host → Guest | Every reply, last one wins (fallback; match your `id`) |
| `/obc/bin/obc-rs` | `0755` | Read-only | Native static `aarch64` Rust multi-call binary (12 Ratatui TUIs & `/dev/fb0` apps) |
| `/obc/scripts/*` | `0755` | Read-only | All 28 built-in OBC CLI/TUI/FB0 wrapper & utility scripts |
| `/obc/lib/*` | `0644` | Read-only | Zero-dependency SDKs: `obc.py` (`PYTHONPATH`), `obc.mjs` (`NODE_PATH`), `bh-cli.mjs` |
| `/obc/pilot-kit/*` | `0444` | Read-only | Canonical copy of these docs & skills synced into `/home/pilot/` on boot |

> **Important 9p rule**: Never assume `/obc/telemetry.json` is unpadded — it is padded with trailing spaces to 2047 chars + `\n` so `st_size` stays constant across 5 Hz refreshes (preventing Linux 9p read truncation). Always `.trim()` before parsing, and keep your previous parsed snapshot if a concurrent rename causes a transient read error.

---

## 3. Exact `/obc/telemetry.json` Schema (`ObcTelemetry` v1)

```json
{
  "v": 1,
  "wall_ms": 1763850000000,
  "sim_time_s": 124.5,
  "sim_dt": 0.0167,
  "warp": 1,
  "frozen": false,
  "dtau_dt": 0.999999997,
  "proper_time_s": 124.5,
  "vessel_id": "f35",
  "vessel_kind": "aircraft",
  "body": "earth",
  "position": {
    "lat_deg": 48.9694,
    "lon_deg": 2.4414,
    "height_ellipsoid_m": 1020.4,
    "altitude_msl_m": 975.1,
    "height_over_ground_m": 910.0
  },
  "attitude": {
    "heading_deg": 248.2,
    "pitch_deg": -7.5,
    "roll_deg": -29.7
  },
  "flight": {
    "true_airspeed_mps": 241.8,
    "ground_speed_mps": 240.2,
    "vertical_speed_mps": -12.4,
    "mach": 0.72,
    "dynamic_pressure_pa": 34200,
    "alpha_deg": 3.2,
    "beta_deg": 0.1,
    "g_load": 1.28,
    "stalled": false,
    "on_ground": false,
    "hull_temp_k": 291.4
  },
  "orbit": {
    "apoapsis_m": 435000,
    "periapsis_m": 399600,
    "eccentricity": 0.0026,
    "inclination_deg": 24.0,
    "period_s": 5575,
    "body_radius_m": 6371000
  },
  "systems": {
    "throttle": 0.72,
    "fuel_frac": 0.94,
    "fuel_kg": 6120,
    "gear": 0,
    "flaps": 0,
    "sas": true,
    "autopilot": "none",
    "hold": "none",
    "rcs_mode": "rotate"
  },
  "nav": {
    "target": { "name": "Moon", "dist_m": 409556000, "rel_speed_mps": -6.73 },
    "runway": {
      "icao": "LFPB",
      "ident": "25",
      "dist_m": 6670,
      "loc_dots": -0.18,
      "gs_dots": 0.12
    }
  }
}
```

- `vessel_id`: `"ranger"`, `"f35"`, `"a320"`, `"shuttle"`, `"capsule"`, etc.
- `vessel_kind`: `"aircraft"` or `"spacecraft"`.
- `orbit`: `null` when not in a Keplerian orbit; object when orbiting a body.
- `nav.target` & `nav.runway`: nullable objects.

---

## 4. Fast Flight Control Channel (`/obc/cmd`)

Write one JSON object per line to `/obc/cmd` (supports both explicit `{ "kind": ... }` and shorthand):

| Kind | Payload | Shorthand | Constraints |
|---|---|---|---|
| `throttle` | `{"kind":"throttle","value":0.75}` | `{"throttle":0.75}` | Clamped `[0, 1]` |
| `stick` | `{"kind":"stick","pitch":0.2,"roll":-0.3,"yaw":0,"duration_ms":250}` | `{"pitch":0.2,"roll":-0.3}` | Axes `[-1, 1]`, duration `[20, 5000]` ms |
| `autopilot` | `{"kind":"autopilot","mode":"circularize"}` | `{"autopilot":"circularize"}` | Allowed: `none`, `off`, `hover`, `circularize`, `approach`, `orbit`, `node`, `transfer`, `land`, `takeoff`, `dock`, `entry`, `burns`, `keep`, `ils`, `hold`, `tf`, `goAround` |
| `hold` | `{"kind":"hold","mode":"prograde"}` | `{"hold":"prograde"}` | Allowed: `none`, `off`, `prograde`, `retrograde`, `radialOut`, `radialIn`, `normal`, `antinormal`, `target`, `antiTarget`, `maneuver` |
| `sas` | `{"kind":"sas","on":true}` | `{"sas":true}` | Boolean |
| `gear` | `{"kind":"gear","down":true}` | `{"gear":true}` | Boolean |
| `flaps` | `{"kind":"flaps","value":0.5}` | — | Clamped `[0, 1]` |
| `say` | `{"kind":"say","text":"On glidepath"}` | `{"say":"On glidepath"}` | Max 220 chars, displayed on simulator HUD |
| `ping` | `{"kind":"ping","id":1}` | — | Round-trip check |

Example from shell:
```sh
printf '{"kind":"throttle","value":0.65}\n' > /obc/cmd && cat /obc/last_result.json
```

---

## 5. High-Frequency `AF_VSOCK` Stream (`CID 2`, port `4747`)

Connect via `AF_VSOCK` (`socket.AF_VSOCK = 40`, `(2, 4747)`) for 20–50 Hz closed-loop avionics without filesystem round-trips. Send newline-terminated JSON:

- `{"op":"read"}` → `{"ok":true,"telemetry":{...}}`
- `{"op":"cmd","cmd":{"kind":"throttle","value":0.5}}` → `{"ok":true,"msg":"..."}`
- `{"op":"ping","id":42}` → `{"ok":true,"id":42,"pong":true}`
- `{"op":"bh","req":{...}}` → executes any `BhRpcRequest` (see `docs/BH-API-GUIDE.md`)

---

## 6. 3D Cockpit Displays & HUD Integration

Everything you display in TTY or `/dev/fb0` automatically appears in **both the F11 HUD console AND the 3D cockpits**:

- **Ranger spacecraft**: MFD slot page `"obc"` (`bh call cockpitScreens.setPage '[2, "obc"]'`) mirrors the live `100×26` terminal OR `/dev/fb0` directly onto the 3D cockpit screen with touch bezel keys.
- **F-35B/C**: Panoramic Cockpit Display (`PCD`) page `"OBC"` (`obc-f35 pcd 0 OBC`) projects `/dev/fb0` (e.g. `obc-f35-fb` TSD) or terminal onto the wide 3D cockpit glass.
- **Airbus A320**:
  - Captain & FO **MCDU** page `"obc"` (`obc-a320 mcdu page obc`) displays `OBC LINUX LINK` live telemetry & controls.
  - **Lower ECAM** page `"obcPage"` (`obc-a320 ecam obcPage`) projects `/dev/fb0` (e.g. `obc-a320-fb` ARC ND) or terminal onto the 3D center pedestal display.
- **Crew Station**: Mirrors the OBC screen live over `BroadcastChannel("kerr-obc")`.

---

## 7. Pre-Installed Zero-Dependency SDKs

- **Python (`/obc/lib/obc.py`, on `PYTHONPATH`)**:
  - `obc.AvionicsBus(prefer_vsock=True)`: `.read() -> State`, `.tau()`, `.send(cmd)`, `.set_throttle()`, `.set_stick()`, `.set_autopilot()`, `.set_hold()`, `.set_sas()`, `.set_gear()`, `.set_flaps()`, `.say()`, `.bh_rpc()`, `.bh_ls()`, `.bh_get()`, `.bh_set()`, `.bh_call()`, `.tars_tools()`, `.tars_tool()`, `.mcdu()`
  - `obc.Framebuffer`: `open()`, `clear()`, `px()`, `rect()`, `line()`, `circle()`, `text()`, `flush()`, `close()` (XRGB8888 `mmap`)
  - `obc.RawKeys`: non-blocking POSIX raw key context manager
- **Node.js / Bun (`/obc/lib/obc.mjs`, on `NODE_PATH`)**:
  - `AvionicsBus`: `.read()`, `.tau()`, `.send()`, `.setThrottle()`, `.setStick()`, `.setAutopilot()`, `.setHold()`, `.setSas()`, `.setGear()`, `.setFlaps()`, `.say()`, `.bhRpc()`, `.bhLs()`, `.bhGet()`, `.bhSet()`, `.bhCall()`, `.tarsTools()`, `.tarsTool()`, `.mcdu()`
  - `Framebuffer`: `Uint32Array` XRGB8888 renderer + 5×7 font + primitives + `flush()`
  - `ansiBar()` & terminal helpers
- **Rust (`obc-rs` binary at `/obc/bin/obc-rs`)**:
  - Multi-call binary implementing all 6 Ratatui TUIs and all 6 `/dev/fb0` apps (`obc-rs --list` to enumerate).
  - You can compile your own Rust crates in `/home/pilot/` once `obc-install rust` is installed (see `docs/UNKERNEL-LINUX.md` and `.claude/skills/obc-rust-dev/SKILL.md`).
