import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

const OUT = "remote-results/pwa-update";

// A new version of the game, installed (audit 2026-11-10, QA-16): its service worker found by an update (the server under
// KERR_SW_FRESH makes a new build at each ask, as in development) waits for the page to tell it to take over. The player must
// be offered that: the notice's button runs it, the page reloads onto the new build. Before 13 Nov 2026 only a toast said
// « reload the page to run it » — no button, and a reload left the old worker in charge (a waiting worker is not activated by
// reloading its only tab). Done when: the update found, the notice and its button there, its button pressed → the new build
// in charge (no worker waiting). Duration: ~40 s.

process.env.KERR_SW_FRESH = "1";

describe.skipIf(!E2E)("a new version of the installed game", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", sw: true, tiles: false });
    await app.waitFor("__bh.camera.piloting", 60_000);
    expect(await app.js<boolean>("__bh.pwa.ready()")).toBe(true);
    await app.waitFor("!!navigator.serviceWorker.controller", 30_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const build = () => app.js<string | null>(`__bh.pwa.stats().then((s) => s?.build ?? null)`);

  test("the update found, offered with a button, run by it", async () => {
    const b0 = await build();
    await app.js(`__bh.pwa.registration.update().then(() => true)`);
    await app.waitFor("__bh.pwa.waiting === true", 30_000);
    const notice = await app.js<boolean>(`!!document.querySelector("[data-testid=pwa-update]")`);
    await app.snap(`${OUT}/notice.png`);
    console.log(`  build in charge ${b0}; a new one waiting; the notice with its button: ${notice}`);
    expect(notice).toBe(true);
    // (its button, pressed as a hand would: the new worker takes over, the page reloads onto it)
    await app.click("[data-testid=pwa-update-run]");
    await app.waitFor(`performance.now() < 20000 && !!navigator.serviceWorker.controller`, 60_000);
    await app.waitFor("__bh.camera?.piloting", 60_000);
    const b1 = await build();
    const waiting = await app.js<boolean>(`navigator.serviceWorker.getRegistration().then((r) => !!r?.waiting)`);
    console.log(`  after the button: build in charge ${b1}, a worker waiting ${waiting}`);
    expect(b1).not.toBe(b0);
    expect(waiting).toBe(false);
  }, 120_000);

  test("a reload alone keeps the old worker in charge — why the button (the witness)", async () => {
    // (a new one found again, then a plain reload — no button —: still waiting after it)
    await app.js(`__bh.pwa.registration.update().then(() => true)`);
    await app.waitFor("__bh.pwa.waiting === true", 30_000);
    const b0 = await build();
    await app.load("scene=game:artemis");
    await app.waitFor("__bh.camera?.piloting", 60_000);
    const waiting = await app.js<boolean>(`navigator.serviceWorker.getRegistration().then((r) => !!r?.waiting)`);
    const b1 = await build();
    console.log(`  a reload alone: build in charge ${b0} → ${b1}, a worker still waiting ${waiting}`);
    expect(waiting).toBe(true);
    expect(b1).toBe(b0);
  }, 120_000);
});
