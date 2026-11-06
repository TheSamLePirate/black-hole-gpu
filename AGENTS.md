# Agents' entry point

For any AI agent (Claude, Codex, Kimi, …) working in this repository.

- Project rules: [CLAUDE.md](CLAUDE.md) (Bun, not Node; the WebGPU AAA destination and its journal; WGS84; TARS must
  reach every feature; results shown in T3).
- **The map of every document** — what to read for which task, the nature of each doc, which doc to update when the
  code changes: [docs/README.md](docs/README.md).
- **Testing in the browser, e2e tests, test campaigns:** [docs/E2E.md](docs/E2E.md) — the lab (this Mac in a visible
  window, `kerr-mini` full screen, `kerr-pc` on demand; one test Chrome at a time on each), `bun run e2e`, `--remote`,
  `--each`, writing a test, the campaign procedure, troubleshooting.
- **E2E tests that fly a craft, wait on compiles or tiles, or play with time:** [docs/E2E-VOLS.md](docs/E2E-VOLS.md) —
  placing a craft, freeze / step / pause / warp, the readiness waits, autopilots, throttle, gear, the camera, and the
  frequent failures of the project's history with their causes.
- **How the aircraft and the spacecraft fly** (models, controls, systems, limits, driving them from `__bh`):
  [docs/VOL-AVIONS.md](docs/VOL-AVIONS.md), [docs/VOL-VAISSEAUX.md](docs/VOL-VAISSEAUX.md).
- **The page's automation handle `__bh`** (every member, its arguments, units and examples; the heights' datums; the
  readiness predicates): [docs/BH-API.md](docs/BH-API.md). Live list: `bun scripts/bh-api.ts`.
- **What each e2e file covers, and how long it takes:** [docs/E2E-CATALOGUE.md](docs/E2E-CATALOGUE.md).
- **The graphics pipeline** (every pass, compile, load step, and how to measure it):
  [docs/GRAPHICS-PIPELINE.md](docs/GRAPHICS-PIPELINE.md).
- **The e2e dashboard** (for people; agents use the commands): `bun run dashboard` → http://localhost:4700
  — the lab live, runs launched and followed, the history, every test's report (telemetry, commanded
  against flown, frame rate, estimate), the flight lab (launch, steer, reports), every capture, a live page
  driven through `__bh`, the docs. docs/E2E.md §8.
- Remote runs in detail (French): [docs/REMOTE-TESTS.md](docs/REMOTE-TESTS.md); flight campaigns:
  [docs/FLIGHTLAB.md](docs/FLIGHTLAB.md); the iPad: [docs/IPAD-TESTS.md](docs/IPAD-TESTS.md).
- Unit tests: `bun test`. Full check before a push: `bun run check && bun test`.
