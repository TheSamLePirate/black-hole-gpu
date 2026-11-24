# Universal `__bh` API & 73 TARS Tools Guide

Every feature of the **Black Hole GPU** simulator is exposed on the browser's `window.__bh` object and through **73 TARS tools**. From Linux, you have complete read/write/call access to all of it via:

1. The **`bh` CLI** (easiest for shell scripts, pipelines, and quick inspection)
2. The keyed **`/obc/rpc/<id>.req` → `/obc/rpc/<id>.res`** 9p RPC bridge (works from any language: Rust, Python, Node, C, sh)
3. The **interactive `bh-tui`** explorer (Ratatui live tree browser + TARS tool directory)

---

## 1. The `bh` CLI Cheat Sheet (JSON Input & Output)

```sh
# Explore the live __bh object tree
bh ls                                  # Top-level namespaces (79 members)
bh ls fleet --json                     # Structured JSON listing [{name, kind, preview}]
bh ls camera.pilot --json              # Inspect pilot controls

# Read & write live simulator properties
bh get fleet.active --raw              # -> "ranger" | "f35" | "a320" | ...
bh get camera.attitudeNow --json       # Calls or reads property
bh set settings.shipMount '"cockpit"'  # Set any writable property (JSON value)
bh set settings.shipMount cockpit --raw

# Call methods on __bh
bh call camera.setLook '[0, -15]'      # JSON array of positional arguments
bh call cockpitScreens.setPage '[2, "obc"]'

# Search across BOTH __bh paths and TARS tools
bh search ils --json
bh search mcdu --json

# Evaluate arbitrary JS expression with `bh` bound to window.__bh
bh eval 'bh.fleet.active' --raw
bh eval '({ hdg: bh.camera.attitudeNow().heading * 180 / Math.PI })' --json

# Stream live values continuously
bh watch camera.pilot.throttle --interval 250

# Discover & execute any of the 73 TARS tools
bh tools --json                        # Full catalog [{name, description, params}]
bh tool approach '{"action":"list","field":"KSFO"}'
printf '{"action":"list","field":"LFPB"}\n' | bh tool approach --stdin
```

---

## 2. Raw RPC Wire Protocol (`/obc/rpc/<id>.req` → `/obc/rpc/<id>.res`)

Use this directly from **Rust**, **C**, **Python (`obc.py`)**, or **Node (`obc.mjs`)** — zero shelling out required:

### Request (`BhRpcRequest` written as one JSON line, ending with `\n`, to `/obc/rpc/<id>.req`)

`<id>` is your request id and must be a safe file name (`[A-Za-z0-9_-][A-Za-z0-9_.-]{0,95}`). Make it unique across
processes: the libraries use `<lang>-<pid>-<random 8 hex>-<seq>` (`rs-…`, `py-…`, `js-…`). Create the file exclusively
(`O_CREAT|O_EXCL`), write the whole line; the host takes it once the trailing newline has arrived and deletes it.
Lines over 262 144 characters are refused with `{"ok":false,"code":"E2BIG",…}`. The single slot `/obc/rpc_req` is
the legacy channel, for older hosts without `/obc/rpc` only.

| `op` | Fields | Description |
|---|---|---|
| `"ls"` | `id`, `path` (`""` for root) | Lists `{ name, kind, preview }[]` at `window.__bh[path]` |
| `"get"` | `id`, `path`, `depth?` | Reads property at dotted path (`safeSerialize` cycle-free JSON) |
| `"set"` | `id`, `path`, `value`, `refresh?` | Assigns value to dotted path (optionally triggers `__bh.refresh()`) |
| `"call"` | `id`, `path`, `args` (`unknown[]`) | Invokes method on parent receiver; awaits Promises automatically |
| `"tools"` | `id` | Returns all 73 TARS tools `[{ name, description, params }]` |
| `"tool"` | `id`, `name`, `toolArgs` (`object`) | Validates against tool schema and executes the TARS tool |
| `"search"` | `id`, `query` | Case-insensitive search across `__bh` paths and TARS tools |
| `"eval"` | `id`, `expr` | Evaluates JS expression with `bh` = `window.__bh` |
| `"mcdu"` | `id`, `action`, `side?` (`0\|1`), `page?`, `lskSide?`, `lskNum?`, `text?`, `dir?`, `ecam?` | Direct A320 Captain/FO MCDU (`screen`, `page`, `lsk`, `type`, `button`, `arrow`) & Lower ECAM (`ecam`) |

### Response (`BhRpcResponse` read from `/obc/rpc/<id>.res`, then deleted by you)

```json
{ "id": "rs-412-9f3a01bc-42", "ok": true, "result": { ... } }
```
On error:
```json
{ "id": "rs-412-9f3a01bc-42", "ok": false, "error": "reason" }
```

> **CRITICAL field names**:
> - Response payload is ALWAYS `"result"` (never `"value"`).
> - `op: "ls"` returns items with `"kind"` (`"fn"`, `"obj"`, `"number"`, `"string"`, `"boolean"`).
> - `op: "tool"` expects `"toolArgs"` (never `"args"`).
> - `op: "mcdu"` expects `"action"`, `"page"`, `"ecam"`, `"text"`, `"lskSide"`, `"lskNum"`.
> - Poll `/obc/rpc/<id>.res` (and, as a fallback, the single slot `/obc/rpc_res`, which also receives every reply) until the parsed JSON has your `"id"`, then delete `<id>.res` (unread replies are swept after 60 s). Synchronous host RPCs resolve immediately inside `onChange` (~1–5 ms).
> - Over `AF_VSOCK:4747` the same requests go one JSON line each; an oversize line is answered with `E2BIG` and skipped up to its newline.

---

## 3. Critical Units & Coordinate Conventions

| Quantity | `/obc/telemetry.json` | Direct `__bh` JS API |
|---|---|---|
| Heading / Pitch / Roll | **Degrees** (`heading_deg`, `pitch_deg`, `roll_deg`) | `__bh.camera.attitudeNow()` returns **radians** (`heading`, `pitch`, `bank`) — multiply by `180 / Math.PI` |
| Latitude / Longitude | **Degrees** (WGS84) | Degrees (WGS84) |
| Ellipsoid height | `position.height_ellipsoid_m` (m) | WGS84 ellipsoidal height (m) |
| Altitude MSL | `position.altitude_msl_m` (m) | EGM96 mean sea level (m); convert to ft via `× 3.28084` |
| Altitude AGL | `position.height_over_ground_m` (m) | Height above local terrain / runway (m) |
| Airspeed / Ground speed | **m/s** (`true_airspeed_mps`) | m/s; convert to knots via `× 1.943844` |
| Vertical speed | **m/s** (`vertical_speed_mps`) | m/s; convert to fpm via `× 196.8504` |
| Geodesy | **WGS84** (`a = 6378137 m`, `f = 1/298.257223563`) | Never treat Earth as a sphere in precision nav code |

---

## 4. High-Value `__bh` Namespaces & Aircraft/Spacecraft Recipes

### F-35B/C Tactical Fighter
```sh
obc-f35 fly LFPB final                     # Spawn F-35 on final approach to Paris-Le Bourget
obc-f35 fly LFPB cruise                    # Spawn in cruise near LFPB
obc-f35 ap hdg=150 alt=1800 spd=210 ap=on athr=on
obc-f35 radar TWS                          # RWS | TWS | STT
obc-f35 weapon aim120                      # aim120 | aim9x | gbu32 | jsm
obc-f35 lock 0                             # Lock radar track index 0
obc-f35 pcd 0 OBC                          # Route Linux OBC onto 3D F-35 PCD left half
obc-f35 status --json
```

### Airbus A320 Airliner (FCU, MCDU & Lower ECAM)
```sh
obc-a320 fly LFPB                          # Spawn A320 at Paris-Le Bourget
obc-airports route LFPB LFMN               # Build WGS84 flight plan Paris -> Nice
obc-a320 mcdu page obc --json              # Open OBC LINUX LINK page on Captain MCDU
obc-a320 mcdu screen --json                # Read all live lines + scratchpad of Captain MCDU
obc-a320 mcdu type LFPB --json             # Type into MCDU scratchpad
obc-a320 mcdu lsk L 1                      # Press Left Line Select Key 1
obc-a320 ecam obcPage --json               # Show Linux OBC on 3D Lower ECAM
obc-a320 ap hdg=250 alt=3000 spd=180 ap=on athr=on
```

### World Airports & Real FAA CIFP / nav.dat Approaches
```sh
obc-airports list --json                   # Nearest world airfields with WGS84 bearing & distance
obc-airports info KSFO --json              # Real runways + ILS/RNAV/VOR approaches (24 at KSFO)
obc-airports info LFPB --json              # Real approaches at Paris-Le Bourget (8 at LFPB)
obc-airports select LFPB                   # Select active approach & arm guidance
```

### Orbital Mechanics, Gargantua & Lagrange / JWST
```sh
bh ls lagrange --json                      # Earth-Moon / Sun-Earth L1-L5 & Halo orbit controls
bh ls jwst --json                          # James Webb Space Telescope at SE-L2
bh ls flight --json                        # Maneuver nodes, circularize, Hohmann, docking
obc-orbit                                  # Live orbital elements & Hohmann Δv
obc-kerr 0.998 2.5 --json                  # Kerr horizon, photon sphere, ISCO, dτ/dt
```

### Camera, Cockpit View & Time Control
```sh
bh set settings.shipMount '"cockpit"'      # Enter 3D cockpit view ("cockpit" | "chase" | "free")
bh call camera.setLook '[0, -18]'          # Pan/tilt cockpit look angle (degrees)
bh call refresh '[]'                       # Trigger immediate settings refresh
bh ls sim --json                           # Freeze, step, warp, pause, time of day
```

### OBC Self-Management via `__bh.obc`
```sh
bh call obc.status '[]' --json             # Phase, distro, RAM, fbActive, fbFps, wispUrl
bh call obc.captureFbDataUrl '[]'          # Capture /dev/fb0 as base64 PNG data URL
bh call obc.readScreen '[]' --json         # Read current 100×26 mirrored terminal lines
```
