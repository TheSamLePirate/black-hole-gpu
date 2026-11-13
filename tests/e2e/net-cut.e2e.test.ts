import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The room's server out of reach while two pages fly linked directly (audit 2026-11-10, NET-11): the first page's
// WebSocket cut — its way back blocked for a while —, its WebRTC link to the second still up. Before 13 Nov 2026
// `sendCraft` left at once without its WebSocket: the second page stopped hearing the first, though their direct link
// lived; and taken back, the first page cleared every track and closed every link — the other craft vanished until
// rebuilt.
// Done when: during the cut the second page still gets the first's samples by the direct link and shows its link cut; the room
// taken back, the first page still has the second's track.
// Duration: ~1 min.

describe.skipIf(!E2E)("the server cut, the direct link flying on", () => {
  let a: App;
  let b: App;
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`__bh.net.create("Cut")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  /** the newest sample a page has of a slot (its sequence), or -1 */
  const seqOf = (p: App, slot: number) =>
    p.js<number>(`(() => { const T = __bh.net.net.remotes.tracks.get(${slot}); return T?.samples.at(-1)?.seq ?? -1; })()`);

  test("cut: the first still heard by the direct link; back: the second's track kept", async () => {
    // (linked directly both ways first)
    await a.waitFor(`__bh.net.net.direct > 30`, 60_000);
    await b.waitFor(`__bh.net.net.direct > 30`, 60_000);
    // the cut: the first page's way to the server blocked, its socket closed
    // (the server out of reach while cut: its WebSocket sent to a closed port — CDP's blocked URLs do not reach a WebSocket)
    await a.js(`(() => {
      const W = window.WebSocket;
      window.__wsReal = W;
      window.WebSocket = class extends W { constructor(u, p) { super(String(u).endsWith("/net") ? "ws://127.0.0.1:9/net" : u, p); } };
      return true;
    })()`);
    await a.js(`(__bh.net.net.link.close(), true)`);
    await a.waitFor(`__bh.net.net.status === "offline"`, 5000);
    const s0 = await seqOf(b, 0);
    const d0 = await a.js<number>(`__bh.net.net.direct`);
    // (in orbit the craft's samples go about once a second: 3 s)
    await Bun.sleep(3000);
    const sent = (await a.js<number>(`__bh.net.net.direct`)) - d0;
    // (the second page told: the first's link cut — its panel's chip, its journal's line)
    await b.js(`(__bh.net.open(), true)`);
    await b.waitFor(`!!document.querySelector("[data-testid=net-cut-0]")`, 5000);
    const told = await b.js<boolean>(`__bh.game.log.events.some((e) => /link to the server is cut|liaison .* coupée/.test(e.text))`);
    await b.snap("remote-results/net-cut/panel.png");
    await b.js(`(__bh.net.closePanel(), true)`);
    const s1 = await seqOf(b, 0);
    const still = await a.js<string>(`__bh.net.net.status`);
    const heard = (s1 - s0 + 0x10000) % 0x10000;
    console.log(`  cut 3 s (the first page ${still}): it sent ${sent} samples directly, the second page heard ${heard}`);
    expect(still).not.toBe("online");
    // the way back: the room taken back
    await a.js(`(window.WebSocket = window.__wsReal, true)`);
    await a.waitFor(`__bh.net.net.status === "online" && !!__bh.net.net.room`, 30_000);
    const kept = await a.js<number>(`__bh.net.net.remotes.track(1)?.samples.length ?? 0`);
    console.log(`  taken back: the first page's track of the second, ${kept} samples at once`);
    expect(told).toBe(true);
    expect(sent).toBeGreaterThan(0);
    expect(heard).toBeGreaterThanOrEqual(Math.max(1, sent - 1));
    expect(kept).toBeGreaterThan(0);
  }, 120_000);
});
