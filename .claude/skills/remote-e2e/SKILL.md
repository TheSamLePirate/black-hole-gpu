---
name: remote-e2e
description: Run this project's e2e tests, scripted flights, test suites or A/B measures on another machine of the lab — the Mac mini (kerr-mini) or the Windows PC with an RTX 5070 Ti (kerr-pc, --host kerr-pc) — instead of this one, with scripts/remote.ts. Use when there are several or long e2e/test runs to do, when this Mac should stay free (its GPU, the browser pane), or when the user asks to run tests "on the mini", "on the PC" / "sur le PC Windows" / "remote" / "à distance".
---

# Remote tests on kerr-mini

`scripts/remote.ts` sends this tree **as it is** (uncommitted and untracked files included, ignored ones
left out) to the Mac mini, runs a command there in a copy of its own, streams the log and brings back
what it wrote. Full reference: `docs/REMOTE-TESTS.md`; the options: the header of `scripts/remote.ts`.

**The Windows PC** (kerr-pc: RTX 5070 Ti, over Tailscale) takes every command below with `--host kerr-pc`
(`bun run e2e --host kerr-pc smoke`, `bun scripts/remote.ts --host kerr-pc doctor|status|logs …`); the monitor
shows all machines. It needs its user logged in at the PC (full-screen Chrome in that session) and runs the
pushed commit under this tree plus this tree's changes. How it differs: `docs/REMOTE-TESTS.md`, "Le PC Windows".

## When

- **Remote**: e2e suites and files, long scripted flights (landing, golden, rates), a full `bun test` or
  `bun run check` while the work goes on here, several runs to queue.
- **Here**: debugging step by step in the browser pane; any perf figure meant for this machine (the
  mini is an M1, 8 GPU cores — its figures compare only with its own: an A/B made there).

## Every run shows what it is doing (the user's rule)

Whoever looks at the mini's screen must see, for every e2e, its frame rate, what it is and how long it takes — and
no figure or picture may come from a tracer still compiling.

- **The FPS on screen.** Never `--headless` (nor `E2E_HEADED=0`) unless the user asks: in full screen `App.load`
  turns the game's meter on (`__bh.settings.showFps = true`) after each load. A test that changes scene, reloads
  or resets the settings sets it again; one that measures a rate says it in its log line too.
- **The banner.** Never `E2E_BANNER=0`. The banner (`tests/e2e/lib/banner.ts`, lower left) reads the test file's
  header comment, so **every e2e file you write or touch starts with**: what it proves (one paragraph), then
  `// Duration: ~N min on kerr-mini` (the estimate per file; the measured median from `tests/e2e/durations.json`
  replaces it once runs exist — refresh it with `bun scripts/e2e-durations.ts`) and `// Done when: …` (the last step
  that ends it). Each `test(...)` title says what that test checks. Missing lines: add them before sending the run.
- **The shaders compiled.** Before any measure, assertion on the image or frame rate, or screenshot:
  `await app.settled()` (it waits `__bh.renderer.tracerSettled` — the tracer compiled, none compiling ahead —
  then three frames). `app.shot` already does it; `fps()` loops, A/B toggles that respecialise the tracer
  (a scene-effect setting) and every page of a two-page test need it explicitly. In the run's log,
  `e2e: the scene's ray tracer still compiling — looked at anyway` means a picture or figure is not valid:
  fix the wait and run again, never report it.
- **The raster pipeline** (the user's preference): the e2e run in `earthPipeline: "raster"` (the default — set it
  explicitly where a test depends on the look) and log `renderer.earthPipelineNow(settings)` beside each figure or
  shot: a run that fell back to `"trace"` (`rasterFellBack`) is said, not passed off as raster. Offline stills
  (`__bh.render`) are traced — not for the e2e's comparisons unless the user asks; for a converged image, freeze
  the world and let the raster's shading go round every pixel (`app.settled()` then a few seconds).
- **The right camera view.** The main view of every e2e is the cockpit (`__bh.settings.shipMount = "cockpit"`, set
  after each `flyAt`, scenario start or vessel change — they reset it). Another mount (chase, around, free, target)
  only for the shots that need it, set with its parameters (`Object.assign(__bh.camera.outside, { yaw, pitch, dist })`;
  `pitch` is clamped — a "top-down" asks the ground in view, check it), given ~1 s to settle, then back to the
  cockpit. Change the mount while the world runs: `__bh.freeze(true)` holds the camera's rig too (a mount set while
  frozen is not applied). `dof: false` and `motionBlur: 0` for a shot meant to show the ground (scene presets turn the depth of field
  on), and for a data comparison `dynamicResolution: false`,
  `earthRasterShading: "every"`, `earthRasterScale: 1` — all put back after. Before a
  view is reported, read `__bh.settings.shipMount` back in the log line, and **look at every picture** brought back:
  the craft where expected, the ground in view, no UI covering it.
- **The images loaded.** No shot or image assertion before the world under the view is in, with a bounded wait that
  says what was still missing rather than failing silently:
  `r.earthMaps.tier === "high" && r.earthTiles.pending === 0 && r.earthTiles.orthoPending === 0 &&
  !r.earthSurface.pending && r.earthScenery.stats().status === "ready" && !r.earthScenery.stats().pending`
  (`r = __bh.renderer`; the full list for a walker: `tests/e2e/lib/character-ready.ts`). Then `app.settled()`, and
  for a still meant to compare data a converged image: `__bh.freeze(true)` then a few seconds (the raster's
  shading round every pixel). A moving realtime image is rebuilt from a fraction of the pixels: never judge ground
  detail (imagery, relief) on it. (`__bh.render` stills, when asked: read back with `renderer.exportPNG` — the e2e
  server is a production one, `/__snapshot` is off — and they leave `animate: false`, their exposure and the offline
  image on: `renderer.cancelOffline()` and the settings put back after.)

## How

```bash
# e2e files by name (docs/E2E.md): --each gives a timed table per file
bun run e2e --remote --each landing gear
# the same by hand
bun scripts/remote.ts run -- E2E=1 bun test tests/e2e/landing.e2e.test.ts --timeout 600000
# no browser in it: beside the browser jobs, without waiting for the GPU
bun scripts/remote.ts run --cpu -- bun test
# several at once: --detach each (they queue there, one browser job at a time), then follow
bun scripts/remote.ts run --detach -- E2E=1 bun test tests/e2e/smoke.e2e.test.ts --timeout 600000
bun scripts/remote.ts status
bun scripts/remote.ts logs <id> -f      # streams, fetches remote-results/<id>/, exits with the job's code
```

- **Full screen by default** — the user's choice: every e2e Chrome opens full screen on the mini's
  display (its ~/.kerr-lab/config.json says kiosk; the page is the screen's size, 1:1), so whoever is at it sees it is in use. Keep it so; `--headless` only when the user asks. `--hold <s>` leaves each
  Chrome open at its close, when the user wants to see the end state.
- Run `remote.ts run` with Bash `run_in_background: true` for anything over a minute (you are
  notified when it ends); put the estimated duration in the task's title (e.g. "e2e landing on the
  mini (~4 min)"). A full e2e suite there: ~3.5 min.
- The command is run by zsh in the copy: `VAR=1 cmd`, `&&` work as typed.
- A whole flight live, orbit → runway: `bun scripts/live-entry.ts --site Bourget --inc 52` (~14 min; ends
  0 stopped on the runway). To instrument the page without touching the code: a script outside the
  repo, `scp` to `kerr-mini:/tmp/`, run as `bun /tmp/x.ts` (imports by `process.cwd()`) — the recipes and
  the troubleshooting table: `docs/REMOTE-TESTS.md` (French, the user's guide).
- Each run also pulls the mini's own clone (`~/Documents/DEV/black-hole-gpu`) — the user wants it kept
  current. A `WARNING … not pulled` line: tell the user (local changes there, or no network).
- Results land in `remote-results/<id>/` (git-ignored): `log`, `meta.json`, `artifacts/` (every file the
  job wrote, at its path). **Never copy an artifact into the tree without looking at it** — a golden
  re-recorded there (`UPDATE=1`) is compared with the one here first, and said to the user.
- `cancel <id>` stops a job and what it started; `clean --keep 10` trims the runs there.

## The iPad (plugged into the mini)

The user's iPad Pro M1 is plugged into the mini by USB; `scripts/ipad.ts` drives its Safari over
`safaridriver` — reference: `docs/IPAD-TESTS.md`. Always `--cpu` (the iPad renders, not the mini):

```bash
bun scripts/remote.ts run --cpu --name ipad-check -- bun scripts/ipad.ts check          # ~1 min
bun scripts/remote.ts run --cpu --name ipad-flight -- bun scripts/ipad.ts flight --site Bourget --no-shots  # ~15 min
bun scripts/remote.ts run --cpu --name ipad-settings -- bun scripts/ipad.ts settings
```

- It tests the **deployed site** (WebGPU needs HTTPS on the iPad), not the tree here: say which version
  ran (`version.json` on the site) — a push mid-series changes the code under the next flights.
- One iPad session at a time; the script waits for the last one to be let go (up to 2 min).
- The iPad must stay unlocked (Auto-Lock: Never). `invalid session id` mid-flight: Safari dropped the
  page (memory) — report it, try `--no-shots`; don't loop retries.
- Screenshots: `remote-results/<id>/artifacts/remote-results/ipad-…/` — look at them, send the telling
  ones to the user (SendUserFile).

## When it fails

- `Chrome did not start` / a test stuck at its boot: the mini has likely lost the internet (Chrome
  hangs at its start without it, headless too; the runner prints a WARNING). Tell the user — it is on
  their side (Wi-Fi) — rather than retrying.
- `rsync failed 3 times` / ssh errors: the mini is off the network or asleep. `ssh kerr-mini true` to
  check. A host-key warning: never bypass it — tell the user.
- `no graphical session`: nobody is logged in at the mini's screen; ask the user, or `--headless` if
  they agree.
- A test that passes here and fails there: the M1 is slower — a `waitFor` timeout may be too tight.
  Say so rather than loosening it unasked.
