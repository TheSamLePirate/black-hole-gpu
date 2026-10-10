# End-to-end tests and test campaigns — the guide

For anyone — a developer or an LLM agent — who writes e2e tests for this game or runs campaigns of them.
It is self-contained: read it, then [BH-API.md](BH-API.md) (the page's automation handle `__bh`), then
[E2E-CATALOGUE.md](E2E-CATALOGUE.md) (what each existing test covers and how long it takes).

The game is a WebGPU app. Its e2e tests drive it in a **real Chrome over the DevTools protocol** (no
Playwright, no dependency): a production server of the tree, real key/mouse/touch events, and page code
evaluated through `__bh`. They run on **two Macs**: this one (headless) and **kerr-mini** (full screen).

---

## 1. In five commands

```bash
bun run e2e smoke                       # one e2e file, here, headless (name, path or part of a name)
bun run e2e --remote landing gear       # two files on kerr-mini, full screen there; log streamed back
bun run e2e --remote --detach golden    # queued on the mini, back at once with a job id
bun scripts/remote.ts logs <id> -f      # follow it; exits with the job's code; results in remote-results/<id>/
bun scripts/lab-monitor.ts              # what runs on both Macs: the Chrome lock, its queue, jobs, campaigns
bun run dashboard                       # the e2e dashboard, http://localhost:4700 — all of the above in a page (§8)
```

`bun run e2e` with no name runs **all** e2e files (~20 min on the mini, ~70 files). `bun run e2e --list`
lists them. Flags after the names go to `bun test` (`bun run e2e smoke -t "radial wheel"`).

Plain `bun test` runs the unit tests only: every e2e file is `describe.skipIf(!E2E)`, and `bun run e2e`
sets `E2E=1`.

---

## 2. The lab: two Macs, one Chrome each

| | this Mac (the main one) | kerr-mini (Mac mini M1, 8 GPU cores) |
|---|---|---|
| reached as | here | ssh alias `kerr-mini` (`bun scripts/remote.ts doctor` checks it) |
| Chrome shows | **headless**, the test's own viewport | **full screen (kiosk)**, the page at the screen's size 1:1 — whoever sits at it sees a test is running |
| set by | `~/.kerr-lab/config.json` `{"chrome": "headless"}` | `~/.kerr-lab/config.json` `{"chrome": "kiosk"}` |
| use it for | quick checks, debugging a test, perf figures meant for this machine | suites, long flights, queues of jobs — while this Mac keeps working |

**One test Chrome at a time per Mac.** Every Chrome the repository starts (e2e tests, flight lab, benches,
galleries, the WGSL check) first takes that Mac's lock, `~/.kerr-lab/chrome.lock`
([scripts/lib/chrome-lock.ts](../scripts/lib/chrome-lock.ts)). Others wait their turn in arrival order
(`chrome-lock: waiting — Chrome held by pid …` every 30 s). Two renderers on one GPU slow each other down
and skew every measurement. A lock whose process died is cleared. A test Chrome left orphaned (its parent
killed) is ended the next time anyone takes the lock (`lab-monitor --sweep` ends it now). On the mini, the
remote runner also queues GPU jobs one at a time (`remote.ts status`: `queued` / `running`).

So you **never** start two browser runs on the same Mac expecting them to run side by side. Use both
Macs: one batch here, one there.

How it shows, and how to override it:

- **Full screen (kiosk, the mini): the page is the screen's own size at 1:1** (1920×1080 there), whatever
  size the test asked — the user's choice: a test on the mini fills its screen. Headless (here) or in a
  window: the size the test asked (1440×900 by default; some ask 1280×800, 640×400…). A test that resizes
  the page itself mid-run (`s5`, `hub-card`: narrow windows on purpose) still does. So a test must not
  depend on its boot size unless it sets it itself with `Emulation.setDeviceMetricsOverride`.
- In kiosk the game's frame-rate meter is on (`__bh.settings.showFps = true` after each load, by
  `App.load`), so whoever watches the mini sees how each test runs. A test about that meter sets it itself.
- `E2E_HEADED=1` forces full screen, `E2E_HEADED=0` headless (`remote.ts run --headless` sets 0).
- `E2E_HOLD=<s>` keeps each Chrome open `<s>` seconds after its test, to see where it ended
  (`remote.ts run --hold 20` / `bun run e2e --remote --hold 20 …`).
- Measurement scripts (`bench.ts`, `trace-ab.ts`, `gallery.ts`, `quality.ts`, `check-wgsl.ts`) are always
  headless: a window's frame rate follows the display. They still take the lock.
- `KERR_CHROME_LOCK=0` skips the lock — only on a machine with nothing else rendering (a CI runner).

Checking the lab before a campaign:

```bash
bun scripts/remote.ts doctor     # mini: reached, internet, screen session, Chrome, bun version, Chrome mode, test Chromes, sleep, queue
bun scripts/lab-monitor.ts       # both Macs: lock holder + waiters, live Chrome processes (⚠ if > 1), jobs, flight-lab campaigns
```

---

## 3. Running

### Here

```bash
bun run e2e <names…> [bun test flags]
bun run e2e --each <names…>        # one bun test per file: a pass/fail/skip/seconds table at the end, and
                                   # remote-results/e2e-summary-<time>.json (E2E_SUMMARY=<file> to choose)
E2E=1 bun test tests/e2e/smoke.e2e.test.ts --timeout 600000   # the same as the first, by hand
```

The run is in the foreground. For anything over a minute, an agent should start it in the background
and wait to be notified, rather than block on it.

### On kerr-mini

```bash
bun run e2e --remote <names…>                 # = bun scripts/remote.ts run -- E2E=1 bun test <files> --timeout 600000
bun run e2e --remote --detach <names…>        # queued; returns the job id
bun run e2e --remote --headless <names…>      # no window there (only if the user asks: full screen is the lab's choice)
bun run e2e --remote --name nightly           # every e2e there, its job named
bun scripts/remote.ts run [--cpu] -- <any command>   # any command in a copy of this tree there (see REMOTE-TESTS.md)
```

`remote.ts` sends **this tree as it is**: uncommitted and untracked files are included, ignored ones left
out. It runs the command in a fresh copy on the mini, streams the log, and brings back what the job wrote
to `remote-results/<id>/` (`log`, `meta.json`, `artifacts/<path in the tree>`). The command ends with the
job's exit code. `--cpu` runs a job without a browser (`bun test`, `bun run check`) beside the GPU queue.

Job control: `status`, `logs <id> [-f]`, `fetch <id>`, `cancel <id>`, `clean --keep 10`. Full reference
in [REMOTE-TESTS.md](REMOTE-TESTS.md) (French).

### Which Mac

- A single quick file (< 1 min), or a test being written or debugged: **here**.
- A suite, several files, long flights (landing, golden, rates, assist-*), anything the user wants to
  watch: **the mini**.
- A campaign: **both**. Split the files by duration ([E2E-CATALOGUE.md](E2E-CATALOGUE.md)), one half here
  and one half on the mini (`--detach`), then collect both.
- Perf figures compare only within one machine (an A/B on the same Mac). Never mix the two Macs' numbers.

---

## 4. Writing a test

### The template

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// What this file proves, in one or two lines (the catalogue is built from these headers).

describe.skipIf(!E2E)("the thing: in its scene", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" }); // a scene by its URL hash
    await app.waitFor("__bh.camera.piloting", 30_000);    // the scene's own readiness
  }, 300_000);
  afterAll(() => {
    app?.close();   // ends Chrome, lets the lock go
    stopServer();   // ends the production server this file started
  });

  test("a player's action does what it should", async () => {
    await app.press("Digit1");                                   // a real key, by physical code
    await app.waitFor(`__bh.camera.pilot.hold === "prograde"`, 5000);
    expect(await app.js<string>("__bh.game.status().label")).toBe("IN ORBIT");
    expect(app.cdp.errors).toEqual([]);                          // no page exception, no console error
  });
});
```

File name: `tests/e2e/<topic>.e2e.test.ts`. A file boots one page in `beforeAll` and its tests share it,
so order matters within a file. Keep a file under ~2 min. Split a longer one.

### `App` — tests/e2e/lib/app.ts

| member | what it does |
|---|---|
| `App.boot(o)` | starts (once per process) a **production** server of the tree on a free port, launches Chrome (after the lock), loads the page, waits for the first frame and the splash to lift. Options: `hash` (`"scene=game:artemis"`, `"scene=Moon: an afternoon on the plains"`, `"bench"`), `width`/`height` (1440×900), `dpr`, `lang` (`"en"` default, `"fr"`), `tiles` (false: S3 terrain and GIBS imagery blocked, so runs are reproducible), `sw` (register the Service Worker), `initScript` (page code run before the app's), `startupFailure` (expect the error screen), `args` (extra Chrome flags, e.g. a fake microphone) |
| `app.load(hash)` | navigates again (a fresh page, same Chrome) and waits as boot does; `app.lastLoadMs` |
| `app.js<T>(expr)` | evaluates `expr` in the page (wrapped in an async function: `await` works, Promises are awaited), returns its JSON value; a page exception rejects with its message |
| `app.waitFor(expr, ms = 10000)` | polls `expr` every 100 ms until truthy (returns it) or throws with the last value / error |
| `app.press(code, key?, {shift})` | a key down + up by physical code (`KeyW`, `Digit1`, `Space`, `F2`, `Escape`, `Tab`, `Enter`, `Backspace`, `ArrowUp`, `Slash`, …) |
| `app.hold(code, ms, during?)` | a key held `ms`, `during()` run while down (push-to-talk) |
| `app.type(text)` | text into the focused field (input-method style: no flight keys fire) |
| `app.hit(sel)` | the element's centre, **proven to receive the pointer** (else throws with the elements in the way) |
| `app.click(sel)` | a real mouse click at that proven point |
| `app.mouse(type, x, y, o)` | raw `move` / `down` / `up` / `wheel` at CSS px (`button`, `deltaY`, `shift`) |
| `app.touch(steps, stepMs)` | fingers: each step lists every finger's point; the first puts them down, the last lifts them |
| `app.shot(file)` | a PNG of the page (write under `remote-results/` so remote runs bring it back) |
| `app.cdp.send(method, params, timeoutS?)` | any DevTools call (`Emulation.*`, `Network.*`, `Input.*` …) |
| `app.cdp.errors` | the page's exceptions and console errors so far (assert it is `[]`, or filter what is expected) |
| `app.close()` | Chrome ended, its profile removed, the lock released |

Other helpers: `tests/e2e/lib/cdp.ts` (`launch()`: a bare Chrome, no app), `tests/e2e/lib/flights.ts`
(the reference flights replayed by `golden.e2e.test.ts`), `tests/e2e/lib/contrast.ts` (text contrast),
`tests/e2e/lib/bh-api.ts` (the `__bh` walker). `tests/helpers/flight.ts` flies the controller **without a
page** — a unit test, faster, for autopilot logic.

### Environment variables

| variable | effect |
|---|---|
| `E2E=1` | e2e files run (else skipped); set by `bun run e2e` |
| `E2E_URL=http://localhost:3000/` | use a server already running instead of starting one (e.g. the dev server — but its bundles can be stale, see §7) |
| `E2E_HEADED=1` / `0` | full screen / headless, whatever the Mac's config says |
| `E2E_HOLD=<s>` | Chrome kept open `<s>` s at close |
| `E2E_CDP_TIMEOUT=<s>` | a DevTools call fails after this (300 s): nothing waits forever |
| `CHROME=<path>` | another Chrome binary |
| `KERR_CHROME_LOCK=0` | no lock (dedicated machine only) |
| `UPDATE=1` | `golden.e2e.test.ts` re-records `tests/e2e/golden/flights.json` (compare with the previous one before keeping it) |
| `RATCHET=update` | `s5.e2e.test.ts` rewrites its test-id ratchet |
| `SHOT=<file>`, `HUD_BOXES=1` | some tests' screenshots / HUD box dump |
| `TARS_LIVE=1` (+ `OPENROUTER_API_KEY` in `.env`), `TARS_MODEL`, `TARS_LONG=1` | the live-model TARS tests (paid: only when asked) |
| `DEEPGRAM_API_KEY` in `.env` | `tars-ear.e2e.test.ts` (the microphone through Deepgram) runs |

### Every test is recorded

Under `bun run e2e` (its preload, `tests/e2e/lib/preload.ts`) every page the harness loads gets the flight
lab's sampler (`tests/flight/lib/sampler.ts`) and every test leaves a record, written as a flight-lab
scenario's (`tests/e2e/lib/telemetry.ts`):

```
remote-results/e2e-reports/<time>-<host>/<file>/<NN>/     (NN: the test's place in its file; 00: its setup)
  telemetry.jsonl   a sample each ½ s of stepped time (__bh.step is wrapped) or of the page's frames:
                    the craft, orbit, autopilot/hold/assist, the hub's card, the entry and its guidance
                    (commanded bank, predicted miss, aimed and flown slopes), air, attitude, rollout,
                    docking, nodes, propellant, the frame rate
  events.jsonl      moments (autopilot, hold, hub, entry phase, docking, landing…), pilot messages, the
                    game's log, the page's errors
  fps.jsonl         the frame rate each second and its worst frame
  graphs.json       the assistants' graphs (optimum, corridor, flown) and the craft's points on them
  summary.json      the file, the test's index, start, end, wall time, samples, frame-rate statistics
  shots/end.jpg     the page at the test's end
```

The run's line `e2e reports: <root>` says where (a mini run's come back in its artifacts). The test's name
and verdict are matched from bun test's output, in order. `E2E_REPORT_ROOT` chooses the root,
`E2E_TELEMETRY=0` or `App.boot({ telemetry: false })` turns it off. The sampler only observes: it keeps
the hub's caches (recomputing them mid-flight changed the flight — a landing failed until it did not).
Plain `E2E=1 bun test …` (no preload) records nothing.

### Rules that keep tests honest

1. **Real input for UI.** Use `app.click`/`app.press`/`app.mouse`/`app.touch`, never `element.click()` in
   `app.js`. An invisible overlay once swallowed every real click while JS clicks kept passing. `app.hit`
   proves the element receives the pointer.
2. **Wait on a condition, never a fixed sleep.** `await app.waitFor("…")` with the state you expect. A
   `Bun.sleep` that works here fails on the slower mini.
3. **Determinism for physics.** The page's own frame loop runs between two `app.js` calls. For a
   reproducible flight, freeze it and step it yourself **inside one call**:
   ```js
   await app.js(`(() => { __bh.freeze(true); __bh.game.glideTo("Edwards");
     for (let i = 0; i < 900; i++) __bh.step(1 / 30);
     return __bh.game.status(); })()`);
   ```
   Judge a flight over several seeds (`__bh.setTime(t0 + k * 0.37)`), not one run.
4. **Long flights in chunks.** A single page call that flies for minutes looks hung. Fly ~2 s of sim per
   call (60 steps), print progress from the Bun side, cap the wall time and the sim time.
5. **Network off by default.** CelesTrak, the S3 terrain tiles and GIBS are blocked, so the app uses its
   bundled data and runs are the same every day. Ask for `tiles: true` only when testing the tiles, and
   expect the ground under an autopilot to change.
6. **Assert `app.cdp.errors`** at least once per file.
7. **Clean up**: `app.close()` and `stopServer()` in `afterAll`, so the lock and the port are freed even
   when a test fails.
8. **Write artifacts under `remote-results/`** (git-ignored, brought back from the mini).
9. **A feature reachable by TARS** (see CLAUDE.md) gets its tool tested in `tests/tars-tools.test.ts` and,
   end to end, in `tars-agent.e2e.test.ts` with the mock model.

---

## 5. Exploring the page without writing a test

The automation handle is documented in [BH-API.md](BH-API.md). To see it live:

```bash
bun scripts/bh-api.ts                 # every __bh member: path, kind, arity (boots game:artemis headless, ~15 s)
bun scripts/bh-api.ts --check         # the members docs/BH-API.md is missing (exit 1)
```

A throw-away probe (keep it outside the repository, e.g. in a scratch folder; run it from the repo root):

```ts
// probe.ts — bun /path/to/probe.ts
import { App, stopServer } from "./tests/e2e/lib/app";   // (paths from the repo root: run with cwd = repo)
const app = await App.boot({ hash: "scene=game:artemis" });
try {
  console.log(await app.js(`__bh.game.status()`));
  await app.shot("remote-results/probe.png");
} finally { app.close(); stopServer(); }
```

On the mini: `scp probe.ts kerr-mini:/tmp/ && bun scripts/remote.ts run -- bun /tmp/probe.ts` (its imports
resolve against the job's copy when they are written `process.cwd()`-relative; see REMOTE-TESTS.md).

In the browser pane (the dev server, `bun --hot server.ts`, port 3000), the same expressions run in the
console: `__bh.game.help()` lists the game tools.

Bigger tools built on the same harness:

| tool | what | doc |
|---|---|---|
| `scripts/flightlab.ts` | autopilot flight campaigns, scored, shardable across the two Macs, steerable mid-run (`ctl`) | [FLIGHTLAB.md](FLIGHTLAB.md) |
| `scripts/live-entry.ts` | one whole flight live, orbit → runway (~14 min) | REMOTE-TESTS.md |
| `scripts/bench.ts`, `scripts/trace-ab.ts` | the Kerr Bench, GPU A/B traces | [PERFORMANCE.md](PERFORMANCE.md) |
| `scripts/ipad.ts` | the deployed site on the iPad plugged into the mini (Safari WebDriver) | [IPAD-TESTS.md](IPAD-TESTS.md) |
| `scripts/hud-gallery.ts`, `scripts/gallery.ts` | screenshots of every HUD / scene | — |

---

## 6. Running a campaign (the procedure for an agent)

A campaign is a set of e2e files (or flight-lab scenarios) run to answer a question: "is main green?",
"did this change break flight?", "does the cockpit still work on the M1?".

1. **Check the lab.** `bun scripts/remote.ts doctor` (all ✓) and `bun scripts/lab-monitor.ts` (no Chrome
   held by someone else here; the mini's queue). If the mini is unreachable or has no internet, say so to
   the user. Chrome hangs at start without the internet. Don't retry in a loop.
2. **Choose the files.** From [E2E-CATALOGUE.md](E2E-CATALOGUE.md): by theme, and by the paths the
   change touched (`git diff --stat`). Note the ones that need a key or `UPDATE=1`: skip them unless asked.
3. **Split by duration.** Sum the catalogue's times. Put the long ones on the mini (`--detach`, one job
   per group so a failure is easy to rerun) and the short ones here. Name each job (`--name`). Give each
   background task a title with its estimated duration (e.g. "e2e flight group on the mini (~6 min)").
4. **Run.** Prefer `--each`: a file's crash cannot take the others with it, and the closing table and
   its JSON give each file's verdict and wall time. Here: `bun run e2e --each <files>` in the background.
   There: `bun run e2e --remote --detach --each --name g1 <files>`,
   then `bun scripts/remote.ts logs <id> -f` in the background (it fetches the results at the end).
5. **Read the results.** `bun test` prints `(pass)` / `(fail)` per test with its time, and the totals.
   Remote: `remote-results/<id>/log` and `artifacts/`. Look at screenshots before reporting them.
6. **A failure:** rerun **that file alone** on the same Mac once. If it passes, it's flaky: report it as
   flaky with both logs. If it fails again, rerun it on the other Mac. Failing on both means a regression.
   Failing on the mini only usually means a timeout that is too tight on the M1: report it, and don't
   loosen it unless asked. Read the test and the source before concluding.
7. **Report:** a table per Mac — file, pass/fail counts, duration — then each failure with its first error
   line, the log path, and the verdict (regression / flaky / environment). Give the commit tested
   (`git rev-parse --short HEAD`, plus "with uncommitted changes" if `git status` is not clean).

Flight-lab campaigns follow the same pattern: `bun scripts/flightlab.ts run --shard 1/2` here and
`bun run remote -- run --detach --name lab -- bun scripts/flightlab.ts run --shard 2/2` there (FLIGHTLAB.md).

---

## 7. Troubleshooting

| symptom | cause, fix |
|---|---|
| `chrome-lock: waiting — Chrome held by pid N (label)` | another run holds this Mac's Chrome: wait, or see it with `lab-monitor`. A dead holder is cleared by itself |
| `Chrome did not start` / a test stuck at boot on the mini | the mini lost the internet (Chrome hangs at start without it). Tell the user |
| `… is not clickable: div.x > …` | `app.hit` found another element on top: an overlay or a panel. The test caught a real bug, or it must close that panel first |
| `waitFor(…): 10000 ms, last …` | the state never came. Read `last`. On the mini, the M1 may simply be slower |
| `unanswered after 300 s` | the page hung (an infinite loop in page code, a flight that never ends). Chunk long work (§4.4) |
| behaviour contradicts the source with `E2E_URL` on the dev server | the Bun dev server served a stale bundle: restart it. Without `E2E_URL` each run builds its own production server, so this cannot happen |
| `rsync failed` / ssh errors | the mini is asleep or off the network: `ssh kerr-mini true`, `remote.ts doctor`. Never bypass a host-key warning |
| `no graphical session` on the mini | nobody is logged in at its screen. Ask the user (or `--headless` if they agree) |
| a WebGPU device lost mid-test | `__bh.gpu.generation()` grew. See `gpu-recovery.e2e.test.ts`. On the mini, report it with the log |
| two Chromes on one Mac in `lab-monitor` (⚠) | something launched Chrome without the lock (a new script: use `launch()` from tests/e2e/lib/cdp.ts or `chromeLock()`), or an orphan: `lab-monitor --sweep` |

---

## 8. The e2e dashboard

```bash
bun run dashboard          # → http://localhost:4700 (E2E_DASH_PORT); listens on 127.0.0.1 only
```

A web page of its own (not the game), over this same harness. Everything in it is also reachable from the
command line. The page is for people, the commands are for agents.

| view | what it does |
|---|---|
| **Overview** | both Macs live: each one's Chrome mode, its lock holder and waiters, live test Chromes (⚠ if more than one), the mini's jobs (**Follow live** attaches to one started elsewhere), flight-lab campaigns, orphans; the last runs, the pass rate, the files failing now and the ones flaky lately; *Doctor (mini)* |
| **Run tests** | every e2e file by theme (the catalogue's), its last result, its history (passed / runs), its usual time; quick picks (smoke, failed last time, flaky lately, never run); **where** (this Mac headless, kerr-mini full screen), `--each`, `-t`, `UPDATE=1`, `--hold`; the estimated time; Launch |
| **Live** | a run as it goes: files and tests ticking, pass/fail counters, progress, the coloured log following; Cancel (the process group here, the job on the mini) |
| **History** | every run on disk: the dashboard's (`remote-results/dash/<id>/`), the remote runner's jobs, the `--each` summaries, the flight-lab campaigns (their `report.html`); filters; a run's page: failures with their error blocks, per-file table, every test, its pictures, the log (search, errors only), **Run again** / **Rerun the failed files** |
| **Test report** (a test's *Report ▸*, in a run or live) | what it tests (its file's words, the catalogue), how long it took against its estimate (the median of its past runs), its frame rate (median, p5, min, and the chart), samples, moments, errors; **commanded against flown**: the assistants' corridors with the optimum and the flown track (each point in or out), the entry's commanded bank against the flown one, the approach's aimed slope against the flown one, the line against the runway's axis, the guidance's predicted miss, the docking's axis; the approach, rollout and docking charts; the hub's card each time it changed (its figures and their warning colours); the quality measures (q_…: loads, α swings, bank reversals, throttle chatter, time in the corridors, propellant, Δv); every telemetry chart; the events (filtered by kind); the pictures; the raw files. Charts: hover for every series' value, the crosshair follows on every chart of the same time axis, ⤢ enlarges |
| **Flight lab** | every scenario of `scripts/flightlab.ts` (by family and tags, its estimate, its last verdicts — each a link to its report), flown **here, on the mini, or both** (dealt in two by estimated time: `--shard 1/2` here, `2/2` there), retries, the time limit; the campaigns **in flight now** on either Mac: the scenario, its progress, the latest sample (status, height, speed, autopilot, the hub's card live), its events, and its controls — pause, resume, skip, abort, a note, a picture now, page code evaluated; every campaign on disk (here and brought back from the mini) and each scenario's report |
| **Captures** | every picture the runs left (`remote-results/`, `flight-results/`, the live page's), by run, in a lightbox (← →, Esc) |
| **Live page · __bh** | the app booted in this Mac's test Chrome (it takes the lock like any e2e): its picture streamed (DevTools screencast, ~30 fps); clicks, wheel and keys sent to it as real input (click the picture, then type; Esc twice to leave); a scene picker; screenshots kept in `remote-results/dash/shots/`; a REPL on the page (`let`, `await`, the last value back as JSON), `__bh` paths completed (Tab), history (↑↓), snippets; the page's console |
| **__bh API** | docs/BH-API.md, searchable, entry by entry: *Try the example* / *Inspect* send it to the live page's REPL |
| **Docs** | this guide, the catalogue, the `__bh` reference, the remote tests, the flight lab, the iPad, rendered with a table of contents |

Keys: `1`–`8` switch views, `/` focuses the search. Light or dark follows the system (◐ to force one).

Its parts: `scripts/dashboard/server.ts` (Bun.serve: the API, the WebSocket, the HTML import),
`runs.ts` (runs started through `scripts/e2e.ts`, streamed and kept; the history), `probe.ts` (the live
page), `lab.ts` (both Macs through `lab-monitor.ts --json`), `parse-log.ts` (bun test's output, line by
line), `markdown.ts` (the docs), `ui/` (the page: no framework, a DOM morph keeps nodes across live updates).
Tests: `tests/dashboard-parse-log.test.ts`, `tests/dashboard-markdown.test.ts`.

A run started from the dashboard is an ordinary `bun scripts/e2e.ts …` process: it takes the Chrome lock,
and on the mini it is an ordinary remote job. Stopping the dashboard stops its live page, not the runs
already going (they end on their own; their logs stay in `remote-results/dash/`).

---

## 9. Keeping this harness whole

- A new `__bh` member gets its entry in [BH-API.md](BH-API.md) (full path in backquotes).
  `bh-api.e2e.test.ts` fails otherwise; `bun scripts/bh-api.ts --check` lists what's missing.
- A new e2e file gets a header comment and a row in [E2E-CATALOGUE.md](E2E-CATALOGUE.md).
- A new script that opens Chrome takes the lock: use `launch()` (tests/e2e/lib/cdp.ts) or
  `await chromeLock()` (scripts/lib/chrome-lock.ts) before spawning it.
- A dashboard change: `bun test tests/dashboard-*.test.ts`, then `bun run dashboard` and look at it.
- `harness.e2e.test.ts` proves the harness itself: a hung call times out, a dead Chrome fails fast, the
  lock follows the browser.
