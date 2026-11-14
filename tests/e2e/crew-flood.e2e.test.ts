import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NetClient } from "../../src/net/client";
import { App, E2E, stopServer } from "./lib/app";

// A crew screen that floods the pilot with orders (audit 2026-11-10, NET-25): every `crew-cmd` heard was answered — a malformed one
// before any pacing, a crew-ack sent to the room for each —, and with the light's delay of a ground station each one waited on its own
// timer, the pace of 4 orders a second applied only when it fell due. A client of the test's, joined as instruments, sends 200
// malformed orders at once to the pilot (the page).
// Done when: the page answers a bounded handful of them, not 200.
// Duration: ~40 s.

describe.skipIf(!E2E)("a flood of crew orders, bounded", () => {
  let app: App;
  let bot: NetClient | null = null;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.waitFor("__bh.camera.piloting", 60_000);
  }, 180_000);
  afterAll(() => {
    bot?.close();
    app?.close();
    stopServer();
  });

  test("200 malformed orders at once: a handful answered", async () => {
    await app.js(`__bh.net.create("Flood").then(() => true)`);
    await app.waitFor(`!!__bh.net.net?.room?.code`, 15_000);
    const code = await app.js<string>(`__bh.net.net.room.code`);
    const url = new URL("/net", app.url).href.replace(/^http/, "ws");
    bot = new NetClient({ url, build: "bot", id: { device: `flood-${Date.now()}`, name: "Flood", colour: "#ff3366" } });
    await bot.join(code, "instruments");
    await app.waitFor(`__bh.net.net.room.members.length === 2`, 10_000);
    let acks = 0;
    bot.on("event", ({ ev }) => {
      if ((ev as { kind?: string }).kind === "crew-ack") acks++;
    });
    for (let i = 0; i < 200; i++) bot.event({ kind: "crew-cmd", v: 1, id: `flood-${i}`, to: 0, act: "no-such-order", args: {} } as never);
    await Bun.sleep(3000);
    console.log(`  200 malformed orders sent: ${acks} answered`);
    expect(acks).toBeGreaterThan(0);
    expect(acks).toBeLessThanOrEqual(20);
  }, 60_000);
});
