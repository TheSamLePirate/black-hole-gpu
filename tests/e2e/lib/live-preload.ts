// bun test's preload for every run (bunfig.toml): an e2e run without `bun run e2e`'s own preload — `E2E=1 bun test
// tests/e2e/x.e2e.test.ts`, the remote runner's jobs, the A/B — still tells the lab what it is doing
// (tests/e2e/lib/live.ts: ~/.kerr-lab/live/e2e-<pid>.json — its file, its test, its time, a picture on demand),
// without recording it: its page is not sampled, the measures stay as they were. With the full preload
// (tests/e2e/lib/preload.ts) the recorder does all of it and these hooks stand aside. Nothing at all outside the
// e2e (E2E unset) or with E2E_LIVE=0.
import { afterAll, afterEach, beforeEach } from "bun:test";

if (process.env.E2E === "1" && process.env.E2E_LIVE !== "0") {
  const { recorder } = await import("./telemetry");
  recorder.lightOn();
  beforeEach(() => recorder.begin("live"));
  afterEach(() => recorder.end("live"));
  afterAll(() => recorder.close("live"));
}
