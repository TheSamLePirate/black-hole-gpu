import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NetClient } from "../../src/net/client";
import { App, E2E, stopServer } from "./lib/app";

// What the page keeps of a player, by his slot, once he is gone (audit 2026-11-10, NET-13): a craft handed over (`board`,
// gone), its telemetry, a spacecraft's state, an order's answer — kept by slot and never let go, even in another room. Two
// rooms on the test's server: in the first, a client of the test (slot 1) says his craft handed over; the page leaves and
// makes a second room, where another client takes slot 1 — before 13 Nov 2026 he stayed « handed », his craft never drawn.
// Done when: in the second room, slot 1 is not « handed » and the per-slot states hold only the room's members.
// Duration: ~40 s.

describe.skipIf(!E2E)("a player's state let go with him", () => {
  let app: App;
  let wsUrl = "";
  const clients: NetClient[] = [];
  const client = (name: string) => {
    const c = new NetClient({ url: wsUrl, build: "bot", id: { device: `slotstate-${name}-${Date.now()}`, name, colour: "#ffcc33" } });
    clients.push(c);
    return c;
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.waitFor("__bh.camera.piloting", 60_000);
    wsUrl = new URL("/net", app.url).href.replace(/^http/, "ws");
  }, 180_000);
  afterAll(() => {
    for (const c of clients) c.close();
    app?.close();
    stopServer();
  });

  test("the first room's slot 1 handed over; in the second, slot 1 another's — drawn", async () => {
    await app.js(`__bh.net.create("First").then(() => true)`);
    await app.waitFor(`!!__bh.net.net?.room?.code`, 15_000);
    const code1 = await app.js<string>(`__bh.net.net.room.code`);
    const b = client("Ben");
    await b.join(code1, "pilot");
    expect(b.room?.slot).toBe(1);
    await app.waitFor(`__bh.net.net.room.members.length === 2`, 10_000);
    // (Ben's craft handed over to the page's pilot)
    b.event({ kind: "board", to: 0, gone: true });
    await app.waitFor(`__bh.net.session?.handed.has(1) === true`, 10_000);
    b.close();
    await app.js(`(__bh.net.leave(), true)`);
    await app.js(`__bh.net.create("Second").then(() => true)`);
    await app.waitFor(`!!__bh.net.net?.room?.code && __bh.net.net.room.name === "Second"`, 15_000);
    const code2 = await app.js<string>(`__bh.net.net.room.code`);
    const c = client("Cy");
    await c.join(code2, "pilot");
    expect(c.room?.slot).toBe(1);
    await app.waitFor(`__bh.net.net.room.members.length === 2`, 10_000);
    await Bun.sleep(500);
    const st = await app.js<{ handed: number[]; tel: number[]; space: number[]; answers: number[] }>(`(() => {
      const S = __bh.net.session;
      return { handed: [...S.handed], tel: [...S.tel.keys()], space: [...S.spaceTel.keys()], answers: [...S.orderAnswers.keys()] };
    })()`);
    console.log(`  in the second room (Cy at slot 1): ${JSON.stringify(st)}`);
    expect(st.handed).not.toContain(1);
  }, 120_000);
});
