# Agents' entry point

For any AI agent (Claude, Codex, Kimi, …) working in this repository.

- Project rules: [CLAUDE.md](CLAUDE.md) (Bun, not Node; deployment; TARS must reach every feature).
- **Testing in the browser, e2e tests, test campaigns:** [docs/E2E.md](docs/E2E.md) — the two Macs
  (this one headless, `kerr-mini` full screen, one test Chrome at a time on each), `bun run e2e`,
  `--remote`, `--each`, writing a test, the campaign procedure, troubleshooting.
- **The page's automation handle `__bh`** (every member, its arguments, units and examples):
  [docs/BH-API.md](docs/BH-API.md). Live list: `bun scripts/bh-api.ts`.
- **What each e2e file covers, and how long it takes:** [docs/E2E-CATALOGUE.md](docs/E2E-CATALOGUE.md).
- **The e2e dashboard** (for people; agents use the commands): `bun run dashboard` → http://localhost:4700
  — the lab live, runs launched and followed, the history, every test's report (telemetry, commanded
  against flown, frame rate, estimate), the flight lab (launch, steer, reports), every capture, a live page
  driven through `__bh`, the docs. docs/E2E.md §8.
- Remote runs in detail (French): [docs/REMOTE-TESTS.md](docs/REMOTE-TESTS.md); flight campaigns:
  [docs/FLIGHTLAB.md](docs/FLIGHTLAB.md); the iPad: [docs/IPAD-TESTS.md](docs/IPAD-TESTS.md).
- Unit tests: `bun test`. Full check before a push: `bun run check && bun test`.
