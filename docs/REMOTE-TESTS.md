# Remote tests — a second Mac on the network

The e2e suites, the scripted flights and the A/B measures take minutes each and hold the GPU. A second
Mac on the network runs them while this one goes on with the work: `scripts/remote.ts` copies **this
tree as it is** there — uncommitted changes, untracked files (the DEMs, the stars…) with it, what
`.gitignore` leaves out left out (the raw NASA grids, `dist/`, `node_modules/`) —, runs the command in
that copy, streams its log here and brings back what it wrote.

That Mac needs no write access to the repository, nor a clone: it never pulls, it is sent the files.

```bash
bun scripts/remote.ts run -- E2E=1 bun test tests/e2e/landing.e2e.test.ts --timeout 600000
bun scripts/remote.ts run --cpu -- bun test
bun scripts/remote.ts run --headless --detach -- bun scripts/trace-ab.ts --ref … --new …
bun scripts/remote.ts status
bun scripts/remote.ts logs <id> -f
bun scripts/remote.ts cancel <id>
```

(`bun run e2e <file>` runs **every** e2e: the script's own `tests/e2e` filter adds to the file's.)

## What it does

- **The copy.** `git ls-files -co --exclude-standard` (~985 files, ~420 MB the first time; then only what
  changed — a second, ~0.5 MB) is sent by rsync to `~/kerr-runner/base/` there, the files no longer here
  removed from it. Each job then gets its own copy, `runs/<id>/`: an APFS clone of the base (free; a job
  that writes a file — a golden, a shot — writes it in its own copy only), `node_modules` shared. So a
  job runs on the tree as it was when it started, whatever is edited here meanwhile.
- **`bun install`** there only when `bun.lock` changed (`--frozen-lockfile`).
- **That Mac's own clone** (`~/Documents/DEV/black-hole-gpu`, `KERR_REMOTE_CLONE`; empty: none) is brought
  up to GitHub's `main` at each sync (fetch, then fast-forward only — a warning, never a failure, when it
  cannot: local changes there, no network). The jobs do not run on it: the copy sent from here is newer
  (what is not pushed, not committed).
- **One browser job at a time** (`~/kerr-runner/gpu.lock`): two renderers on one GPU halve both, and the
  measures with them. The others wait in a queue (`status` shows it). `--cpu`: a job without a browser
  (unit tests, typecheck) runs beside them.
- **Full screen, by default.** Every e2e Chrome opens full screen on that Mac's display (`E2E_HEADED=1`,
  `tests/e2e/lib/cdp.ts`: kiosk, no tabs nor address bar; the page's viewport the emulated one, as
  headless — 1440 × 900 unless the test sets another, in the screen's top-left corner) — who sits at that
  Mac sees it is in use, and anyone can watch a test by screen sharing. `--headless` for none. The measuring scripts (`bench.ts`, `trace-ab.ts`, `gallery.ts`, `quality.ts`,
  `check-wgsl.ts`) are headless whatever: a window's frames follow the display.
- **`--hold <s>`**: each e2e Chrome left open `<s>` seconds at its close (`E2E_HOLD`), to see where a
  test left the app.
- **Awake.** While a browser job runs, `caffeinate -dimsu` keeps that Mac and its display awake.
- **Detached there.** The job runs in its own session: the ssh that started it can drop, it runs on;
  `logs <id> -f` picks it up again. `cancel <id>` ends it with what it started (server, Chrome).
- **What comes back**, in `remote-results/<id>/` (ignored by git): `log`, `meta.json` (the command, the
  times, the exit code) and `artifacts/` — every file the job wrote in its copy, at its path (a golden
  re-recorded, `docs/perf/bench-*`, shots). Nothing is applied to this tree: compare, then copy.
- **Exit code**: the job's, so `remote.ts run … && …` chains.

## Setting up the remote Mac (once)

1. **Remote Login** on (System Settings › General › Sharing), and this Mac's ssh key in its
   `~/.ssh/authorized_keys` (`ssh-copy-id user@host`).
2. **bun** — the same version as here (`bun --version`):
   `curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"`.
3. **Google Chrome** in `/Applications`.
4. **A session open on its screen**, never locked (the full-screen mode needs it; `remote-runner.ts` refuses
   such a job when nobody is logged in at the console): automatic login, screen saver and lock off.
5. **A wired network if possible.** Over a weak Wi-Fi, transfers get cut (resumed: 3 attempts) and,
   without the internet, Chrome — headless too — hangs at its start, its DevTools never answering
   ("Chrome did not start"); the runner warns when that Mac does not reach the internet.
6. Here, an ssh alias — the repository names none of this machine:

   ```
   Host kerr-mini
     HostName <its-name>.local
     User <user>
     ControlMaster auto
     ControlPath ~/.ssh/cm-%r@%h-%p
     ControlPersist 10m
     ServerAliveInterval 30
   ```

   Another alias or folder: `KERR_REMOTE=<alias>`, `KERR_REMOTE_DIR=<folder in its home>`.

Then: `bun scripts/remote.ts run -- E2E=1 bun test tests/e2e/title.e2e.test.ts --timeout 600000`
(~30 s; the first run also sends the tree and installs the dependencies).

## Watching

Finder › Network › that Mac › *Share Screen* (or `open vnc://<its-name>.local`). The screen
captures (`screencapture`) are not available over ssh — macOS grants the screen to apps, not to sshd.

## Measures

A frame rate measured there is that Mac's — an M1 (8 GPU cores) is not this machine. What holds is an
A/B made there on both sides (`trace-ab.ts --ref --new`, both builds served there), never a figure there
against one here.

## Housekeeping

`bun scripts/remote.ts clean --keep 10` removes the older runs there (the running ones kept);
`remote-results/` here is yours to empty.
