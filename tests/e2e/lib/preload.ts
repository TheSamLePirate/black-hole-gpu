// bun test's preload for the e2e (scripts/e2e.ts passes it: `bun run e2e`): every test recorded — its telemetry,
// frame rate, moments, a picture at its end (tests/e2e/lib/telemetry.ts) — in its own folder.
import { afterAll, afterEach, beforeEach } from "bun:test";
import { recorder } from "./telemetry";

if (process.env.E2E === "1") {
  recorder.enable();
  beforeEach(() => recorder.begin());
  afterEach(() => recorder.end());
  afterAll(() => recorder.close());
}
