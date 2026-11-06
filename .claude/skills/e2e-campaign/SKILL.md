---
name: e2e-campaign
description: Write, run or plan this game's end-to-end tests (a real Chrome over DevTools driving the app through the __bh automation handle) — one file, a theme, or a whole campaign split between this Mac (a visible window) and kerr-mini (full screen). Use when asked to test a feature in the browser, write an e2e test, run "the e2e", check a change end to end, fly a craft in a test, or run a test campaign.
---

# E2E tests and campaigns

Read **docs/E2E.md** first (the guide: the lab, running, writing, the campaign procedure, troubleshooting), then
**docs/E2E-VOLS.md** for any test that flies a craft, waits on compiles or tiles, or plays with time (the recipes, the
time controls, the waits, and the frequent failures found in 4 034 runs of the project's history — flight tests fail
three times as often as rendering ones), **docs/BH-API.md** for the page's handle `__bh` (the heights' datums, the
readiness predicates, what a placement resets), and **docs/E2E-CATALOGUE.md** for what each file covers and how long
it takes. The flight models: docs/VOL-AVIONS.md, docs/VOL-VAISSEAUX.md. The map of every doc: docs/README.md.

## The commands

```bash
bun run e2e smoke                          # here, in a window (Sam watches) — names, paths or parts of names
bun run e2e smoke > remote-results/smoke.log 2>&1; grep -nE "\(fail\)|^ *[0-9]+ (pass|fail)|error:" remote-results/smoke.log
bun run e2e --remote landing gear          # on kerr-mini, full screen
bun run e2e --remote --detach --each a b   # queued there; one process per file and a summary table + JSON
bun scripts/remote.ts logs <id> -f         # follow a detached job (brings remote-results/<id>/ back)
bun scripts/remote.ts doctor               # the mini's health before a campaign
bun scripts/lab-monitor.ts                 # both Macs: the Chrome lock, its queue, each e2e's test, jobs, heat
bun scripts/bh-api.ts [--check]            # the live __bh members (and what BH-API.md misses)
bun run dashboard                          # the e2e dashboard for the user: http://localhost:4700
```

When the user wants to watch, browse results or drive the page themselves, point them to the dashboard
(start it with the preview tool, config `e2e-dashboard` in .claude/launch.json, or `bun run dashboard`).

## Rules

- **One test Chrome per Mac** (the lock in scripts/lib/chrome-lock.ts): never expect two browser runs on one Mac to
  run in parallel. Use both Macs: short targeted runs (1–2 min), split here and on the mini; keep working while they
  run; no long queues.
- **A window here, full screen on the mini** (each Mac's `~/.kerr-lab/config.json`: `window` here since 4 Nov 2026,
  `kiosk` there). Don't pass `--headless` / `E2E_HEADED=0` unless the user asks. Measures (bench, A/B) run headless
  by themselves.
- **`bun run e2e`, not a bare `E2E=1 bun test`** (only the former records telemetry and reports). **Never pipe the
  output into `tail`**: the whole log in a file, then grep it (677 runs of the history ended with no verdict that way).
- Run anything over a minute in the background and put its estimated duration in the task's title.
- Before a measure (bench, A/B, frame times), `bun scripts/thermal.ts --all` (docs/THERMAL.md): a pressure other than
  Nominal makes the figures doubtful — wait, or report it beside them. Each test's `summary.json` carries `thermal`.
- After a shader edit: `bun scripts/check-wgsl.ts` before the e2e. After a test edit: `bun run typecheck`.
- One IGN-heavy e2e at a time across both Macs (same public IP → 429).
- Watching a run (yours or another session's, here or on the mini): `lab-monitor` names each e2e's file and test
  (~/.kerr-lab/live, docs/E2E.md "Every e2e is live"); the dashboard's Monitor (#monitor) shows it with a picture on
  demand. A picture is only taken when asked: never "Auto" on another session's A/B.
- Real input for UI (`app.click`, `app.press`), never Escape to close a screen (it pauses); `waitFor` / `app.settled()`
  / `app.dataSettled()` / `app.waitProgress()` rather than sleeps, capped (data 30–60 s, a kernel 90 s, a cold compile
  180 s) and failing with what is missing, never `.catch(() => {})`; `app.cdp.errors` asserted; `close()` +
  `stopServer()`.
- **Flying a craft** (docs/E2E-VOLS.md §0): switch the craft, wait `__bh.fleet.active`, then place; a placement resets
  throttle, autopilot, tanks, flaps; `flyAt`'s height is measured once on the relief loaded then (`placeLow` in
  tests/e2e/lib/place.ts); `jetToggle` toggles and refuses until the jet flies in plane mode — use `apSet` after a few
  steps; low flights with the gear down and the autothrottle on (Sam's stable-flight protocol); a judged flight in
  **one** `app.js` call, frozen, fixed steps; a crash pauses the game; heights: `geoNow().alt` / `status().altKm` are
  over the sea, AGL is `__bh.sys.heightOverGround`.
- **Camera**: cockpit by default; after every placement, vessel switch or import: `shipMount = "cockpit"`,
  `__bh.refresh()`, `__bh.camera.viewReset()`, a few steps, read the mount back.
- **Banner**: every e2e file starts with what it proves, then `// Duration: …` and `// Done when: …` at line start.
- **Shots**: at each state judged, before its `expect`, under `remote-results/`; look at them, and show them to Sam in
  T3 (`html_preview` then `html_render`, CLAUDE.md "Montrer les résultats dans T3 Code").
- A failure: read the whole error; rerun that test alone (`-t`), then on the other Mac. Report regression / flaky /
  environment / test bug, with the log path (`remote-results/…`) and the commit (+dirty). A fix gets a test that fails
  without it.
- A new `__bh` member → its entry in docs/BH-API.md (`bh-api.e2e.test.ts` checks it). A new e2e file → a header
  comment and a row in docs/E2E-CATALOGUE.md. A lesson learnt from a failure → a row in docs/E2E-VOLS.md §7.
- Tests needing keys (`TARS_LIVE=1`, `DEEPGRAM_API_KEY`) cost money or need the user's keys: only when asked.
