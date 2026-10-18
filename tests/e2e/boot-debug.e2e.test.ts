import { afterAll, describe, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A boot's diagnosis (when App.boot times out): the page's errors and the graphics diagnostic, printed.
// SCENE=<hash scene>.

describe.skipIf(!E2E)("a boot's diagnosis", () => {
  let app: App | undefined;
  afterAll(() => {
    app?.close();
    stopServer();
  });
  test("the page's errors and the graphics diagnostic", async () => {
    try {
      app = await App.boot({
        width: 1280,
        height: 800,
        hash: `scene=${process.env.SCENE ?? "game:artemis"}`,
        tiles: true,
        startupFailure: true,
      });
      await Bun.sleep(60_000);
      console.log("  booted");
    } catch (e) {
      console.log(`  boot failed: ${(e as Error).message.slice(0, 200)}`);
    }
    const a = app;
    if (!a) return;
    const errs = a.cdp.errors;
    console.log(
      `  errors (${errs.length}):\n${errs
        .slice(0, 20)
        .map((x) => `    ${x.slice(0, 400)}`)
        .join("\n")}`,
    );
    const diag = await a.js<string>(`JSON.stringify(__bh.graphicsDiagnostic?.() ?? null).slice(0, 4000)`).catch((e) => String(e));
    console.log(`  diagnostic: ${diag}`);
  }, 300_000);
});
