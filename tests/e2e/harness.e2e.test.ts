import { describe, expect, test } from "bun:test";
import { holder } from "../../scripts/lib/chrome-lock";
import { launch } from "./lib/cdp";
import { E2E } from "./lib/app";

// The harness itself (tests/e2e/lib/cdp.ts): a call on a hung page fails at its time limit, a Chrome that dies
// fails every call at once — no test, no flight lab campaign waits for ever —, and this machine's Chrome lock
// is held while the browser lives and let go with it.

describe.skipIf(!E2E)("the e2e harness: no wait for ever, one Chrome", () => {
  test("a hung page's call times out; a dead Chrome fails the next call at once; the lock follows the browser", async () => {
    const cdp = await launch();
    try {
      expect(holder()?.pid).toBe(process.pid);
      const t0 = Date.now();
      const hung = cdp.send("Runtime.evaluate", { expression: "new Promise(() => {})", awaitPromise: true }, 2);
      await expect(hung).rejects.toThrow(/unanswered after 2 s/);
      expect(Date.now() - t0).toBeLessThan(5000);
      // (the browser killed under the test)
      Bun.spawnSync(["pkill", "-9", "-f", "remote-debugging-port=.*kerr-e2e"]);
      await Bun.sleep(1000);
      const t1 = Date.now();
      await expect(cdp.send("Runtime.evaluate", { expression: "1" })).rejects.toThrow(/Chrome|closed/);
      expect(Date.now() - t1).toBeLessThan(2000);
    } finally {
      cdp.close();
    }
    expect(holder()).toBeNull();
  }, 60_000);
});
