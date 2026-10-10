---
name: e2e-campaign
description: Write, run or plan this game's end-to-end tests (a real Chrome over DevTools driving the app through the __bh automation handle) — one file, a theme, or a whole campaign split between this Mac (headless) and kerr-mini (full screen). Use when asked to test a feature in the browser, write an e2e test, run "the e2e", check a change end to end, or run a test campaign.
---

# E2E tests and campaigns

Read **docs/E2E.md** first (the guide: the lab, running, writing, the campaign procedure, troubleshooting),
then **docs/BH-API.md** for the page's handle `__bh`, and **docs/E2E-CATALOGUE.md** for what each file
covers and how long it takes.

## The commands

```bash
bun run e2e smoke                          # here, headless — names, paths or parts of names
bun run e2e --remote landing gear          # on kerr-mini, full screen
bun run e2e --remote --detach --each a b   # queued there; one process per file and a summary table + JSON
bun scripts/remote.ts logs <id> -f         # follow a detached job (brings remote-results/<id>/ back)
bun scripts/remote.ts doctor               # the mini's health before a campaign
bun scripts/lab-monitor.ts                 # both Macs: the Chrome lock, its queue, jobs
bun scripts/bh-api.ts [--check]            # the live __bh members (and what BH-API.md misses)
bun run dashboard                          # the e2e dashboard for the user: http://localhost:4700
```

When the user wants to watch, browse results or drive the page themselves, point them to the dashboard
(start it with the preview tool, config `e2e-dashboard` in .claude/launch.json, or `bun run dashboard`).

## Rules

- **One test Chrome per Mac** (the lock in scripts/lib/chrome-lock.ts): never expect two browser runs on
  one Mac to run in parallel. Use both Macs: long files on the mini (`--detach`), short ones here.
- **Headless here, full screen on the mini** (each Mac's `~/.kerr-lab/config.json`). Don't pass
  `--headless` to the mini unless the user asks.
- Run anything over a minute in the background and put its estimated duration in the task's title.
- Real input for UI (`app.click`, `app.press`), `waitFor` rather than sleeps, `freeze(true)` + `step(1/30)`
  inside one `app.js` call for reproducible flights, `app.cdp.errors` asserted, `close()` + `stopServer()`.
- A failure: rerun that file alone, then on the other Mac. Report regression / flaky / environment,
  with the log path (`remote-results/…`) and the commit (+dirty).
- A new `__bh` member → its entry in docs/BH-API.md (`bh-api.e2e.test.ts` checks it). A new e2e file →
  a header comment and a row in docs/E2E-CATALOGUE.md.
- Tests needing keys (`TARS_LIVE=1`, `DEEPGRAM_API_KEY`) cost money or need the user's keys: only when asked.
