---
name: obc-control-sim
description: Control any aircraft (F-35B/C, Airbus A320), spacecraft (Ranger, Artemis, Gargantua, JWST/Lagrange), airport/ILS approach, 3D cockpit display, camera, or TARS tool directly from the Linux OBC.
---

# Skill: Control the Entire Black Hole GPU Simulator from Linux

Use this skill whenever asked to fly a craft, set up a mission or approach, inspect live physics, configure 3D cockpit displays, or automate a flight sequence from Linux.

## Prerequisites
- Read `docs/BH-API-GUIDE.md` and `docs/OBC-ARCHITECTURE.md`.

## Decision Tree — Choose the Right Channel

1. **High-rate flight controls (throttle, stick, SAS, gear, flaps, autopilot, attitude hold, HUD callout)**:
   - Write JSONL to `/obc/cmd` (or use `obc.AvionicsBus` / `obc-auto`), read back `/obc/last_result.json`.
   - For 20–50 Hz closed-loop guidance in Python, connect via `AF_VSOCK` `(CID=2, port=4747)`.
2. **F-35B/C operations (spawn, cruise/final, AP/ATHR, AN/APG-81 radar, weapons, lock/fire, PCD routing)**:
   - Use `obc-f35` (`obc-f35 fly LFPB final`, `obc-f35 ap hdg=150 alt=1800 spd=210 ap=on athr=on`, `obc-f35 radar TWS`, `obc-f35 pcd 0 OBC`).
3. **Airbus A320 operations (spawn, FCU, Captain/FO MCDU pages/LSKs/scratchpad, Lower ECAM)**:
   - Use `obc-a320` (`obc-a320 fly LFPB`, `obc-a320 mcdu page obc`, `obc-a320 mcdu type LFPB`, `obc-a320 ecam obcPage`) or RPC `op: "mcdu"`.
4. **World airports, real FAA CIFP / nav.dat ILS/RNAV approaches & routes**:
   - Use `obc-airports list --json`, `obc-airports info <ICAO> --json`, `obc-airports select <ICAO>`, `obc-airports route <FROM> <TO>`.
5. **Anything else in the game (weather, time warp, camera, scenes, Lagrange/JWST, orbital maneuvers, docking, challenges, crew)**:
   - Discover first: `bh search <keyword> --json` and `bh tools --json` (73 live TARS tools!).
   - Inspect live objects: `bh ls <path> --json` and `bh get <path> --json`.
   - Execute: `bh tool <name> '<json>'` (or pipe JSON with `--stdin`) or `bh call <path> '[args]'`.

## Verification Discipline
- Always verify state transitions by reading back `/obc/telemetry.json` or `bh get ...` (remember: `__bh.camera.attitudeNow()` is in **radians**, while `/obc/telemetry.json` is in **degrees**!).
- Never confuse WGS84 ellipsoid height, MSL altitude, and AGL (`height_over_ground_m`).
- When switching cockpits or camera mounts (`bh set settings.shipMount '"cockpit"'`), call `bh call refresh '[]'` so the renderer applies immediately.
