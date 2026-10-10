---
name: remote-e2e
description: Run this project's e2e tests, scripted flights, test suites or A/B measures on the second Mac on the network (kerr-mini) instead of this one, with scripts/remote.ts. Use when there are several or long e2e/test runs to do, when this Mac should stay free (its GPU, the browser pane), or when the user asks to run tests "on the mini" / "remote" / "à distance".
---

# Remote tests on kerr-mini

`scripts/remote.ts` sends this tree **as it is** (uncommitted and untracked files included, ignored ones
left out) to the Mac mini, runs a command there in a copy of its own, streams the log and brings back
what it wrote. Full reference: `docs/REMOTE-TESTS.md`; the options: the header of `scripts/remote.ts`.

## When

- **Remote**: e2e suites and files, long scripted flights (landing, golden, rates), a full `bun test` or
  `bun run check` while the work goes on here, several runs to queue.
- **Here**: debugging step by step in the browser pane; any perf figure meant for this machine (the
  mini is an M1, 8 GPU cores — its figures compare only with its own: an A/B made there).

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
  display (its ~/.kerr-lab/config.json says kiosk; the test's viewport is scaled to fill the screen), so whoever is at it sees it is in use. Keep it so; `--headless` only when the user asks. `--hold <s>` leaves each
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
