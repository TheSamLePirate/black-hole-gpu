import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { NetClient } from "../../src/net/client";
import { BODIES, emptyVisual, FRAME_FIXED, KINDS } from "../../src/net/proto";
import { geodeticToCart, WGS84_A, WGS84_F } from "../../src/system/ellipsoid";
import { App, E2E, stopServer } from "./lib/app";

// The network's input boundary (PLAN-RESEAU-DURCISSEMENT RD0/RD1; audit NET-01, NET-07, AR-03): one page in a room of the
// test server, a second member — a Bun client, as any peer could be — sends what the game never sends: a match without
// its fields, a combat state without its missiles, a dock without its place, a telemetry of strings, samples of NaN and
// infinity. Before RD1 the audit predicted the page's image frozen (an exception before the render, every frame) and the
// server replaying the bad match to every newcomer. Each case on a fresh page; the page's GPU frames counted over 2 s.
// One page only (the other session's measures share this GPU); tiles and IGN blocked.
// Done when: every case leaves the page drawing, its errors counted, not thrown; the newcomer not sent the bad match.
// Duration: ~2 min.

const OUT = "remote-results/net-inbound";
const BLOCK = ["*celestrak.org*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*", "*geopf.fr*", "*ign.fr*"];

describe.skipIf(!E2E)("the network's input: a malformed event or sample never stops the image", () => {
  let app: App;
  let peer: NetClient | null = null;
  let code = "";
  let mySlot = 0;
  const wsUrl = () => new URL("/net", app.url).href.replace(/^http/, "ws");
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: BLOCK });
    await app.waitFor("__bh.camera.piloting", 60_000);
  }, 180_000);
  afterAll(() => {
    peer?.close();
    app?.close();
    stopServer();
  });

  /** a fresh page in a fresh room, the peer joined to it */
  const fresh = async (name: string) => {
    peer?.close();
    peer = null;
    await app.load("scene=game:artemis");
    await app.cdp.send("Network.setBlockedURLs", { urls: BLOCK });
    await app.waitFor("__bh.camera.piloting", 60_000);
    code = await app.js<string>(`(async () => { await __bh.net.create(${JSON.stringify(name)}); return __bh.net.net.room.code; })()`);
    mySlot = await app.js<number>("__bh.net.net.room.slot");
    peer = new NetClient({ url: wsUrl(), build: "test", id: { device: `evil-${name}`, name: "Evil", colour: "#ff0000" } });
    await peer.join(code, "pilot");
    await app.waitFor("__bh.net.net.room.members.length === 2", 10_000);
  };
  /** the page's GPU frames completed over `ms` (the image drawn or not) */
  const framesOver = async (ms = 2000) => {
    const a = await app.js<number>("__bh.gpu.frames().completedFrames");
    await Bun.sleep(ms);
    return (await app.js<number>("__bh.gpu.frames().completedFrames")) - a;
  };
  /** the events and samples the test server's rooms dropped (GET /net: rooms.health()) */
  const serverRejected = async () => ((await (await fetch(new URL("/net", app.url))).json()) as { rejected?: number }).rejected ?? 0;
  const errorsSince = (n: number) => app.cdp.errors.slice(n).map((e) => String(e).slice(0, 160));

  /** the page in an F-35 held over the Atlantic, the peer's F-35 200 m beside it, its samples 20 a second (so its tag,
   *  its telemetry's line and a dock to us are drawn) — stopped by the returned function */
  const beside = async () => {
    const g = await app.js<{ lat: number; lon: number; alt: number }>(`(() => {
      __bh.freeze(true); __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane"; __bh.settings.damage = false;
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      __bh.game.flyAt(38.5, -14, 3000, 90, 160);
      for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      return __bh.camera.geoNow(); })()`);
    const D = Math.PI / 180;
    const P = geodeticToCart(WGS84_A, WGS84_F, g.lat * D, (g.lon + 0.0023) * D, g.alt);
    const timer = setInterval(() => {
      peer?.sendCraft({
        frame: FRAME_FIXED,
        body: BODIES.indexOf("earth"),
        kind: KINDS.indexOf("f35"),
        flags: 0,
        p: [P[0]!, P[1]!, P[2]!],
        v: [0, 0, 0],
        q: [0, 0, 0, 1],
        w: [0, 0, 0],
        a: [0, 0, 0],
        vis: emptyVisual(),
      } as never);
    }, 50);
    await app.waitFor(`__bh.net.session.tags.length > 0`, 10_000).catch(async () => {
      throw new Error(`the peer's craft not tagged: ${JSON.stringify(await app.js("__bh.net.session.tags"))}`);
    });
    return () => clearInterval(timer);
  };

  const CASES: [string, () => Record<string, unknown>, boolean][] = [
    ["a match without its fields", () => ({ kind: "match", m: { id: "x" } }), false],
    ["a telemetry of strings", () => ({ kind: "tel", v: { tau: "0", alt: "high" } }), true],
    ["a dock to us without its place", () => ({ kind: "dock", to: mySlot, port: 0, ownPort: 0 }), true],
  ];

  for (const [what, ev, near] of CASES)
    test(`${what}: the page still draws`, async () => {
      await fresh(what.split(" ")[1]!);
      const stop = near ? await beside() : () => {};
      try {
        const before = await framesOver();
        const n = app.cdp.errors.length;
        const r0 = await serverRejected();
        peer!.event(ev() as never);
        await Bun.sleep(300);
        const after = await framesOver();
        const errs = errorsSince(n);
        const counted = await app.js<number>("__bh.net.net.inbound?.rejected ?? -1");
        const atServer = (await serverRejected()) - r0;
        console.log(
          `  ${what}: GPU frames over 2 s ${before} → ${after}; page errors ${errs.length}; rejected by the page ${counted}, by the server ${atServer}`,
        );
        for (const e of errs.slice(0, 2)) console.log(`    ${e}`);
        await app.shot(`${OUT}/${what.replace(/\W+/g, "-")}.png`);
        expect(after).toBeGreaterThan(before * 0.5);
        expect(errs).toEqual([]);
        // (refused at the boundary — the server's, before it reaches the page —, counted: not handed to the game)
        expect(atServer + Math.max(0, counted)).toBeGreaterThanOrEqual(1);
      } finally {
        stop();
      }
    }, 90_000);

  test("samples of NaN and infinity: the peer's track keeps no poison, the page still draws", async () => {
    await fresh("samples");
    const s = (t: number, x: number) => ({
      t,
      frame: FRAME_FIXED,
      body: BODIES.indexOf("earth"),
      kind: KINDS.indexOf("f35"),
      flags: 0,
      p: [x, 0, 6.4e6] as [number, number, number],
      v: [0, 0, 0] as [number, number, number],
      q: [0, 0, 0, 1] as [number, number, number, number],
      w: [0, 0, 0] as [number, number, number],
      a: [0, 0, 0] as [number, number, number],
      vis: emptyVisual(),
    });
    const now = peer!.roomNow();
    peer!.sendCraft(s(now, 0) as never);
    peer!.sendCraft(s(now + 0.05, Number.NaN) as never);
    peer!.sendCraft(s(Number.POSITIVE_INFINITY, 0) as never);
    await Bun.sleep(500);
    const tr = await app.js<{ n: number; finite: boolean } | null>(`(() => {
      const T = [...__bh.net.net.remotes.tracks.values()].find((x) => x.slot === ${await peerSlot()});
      if (!T) return null;
      const xs = T.samples;
      return { n: xs.length, finite: xs.every((q) => Number.isFinite(q.t) && q.p.every(Number.isFinite)) };
    })()`);
    console.log(`  the peer's track: ${JSON.stringify(tr)}`);
    expect(tr === null || tr.finite).toBe(true);
    expect(await framesOver()).toBeGreaterThan(10);
  }, 90_000);

  test("relayed by a server that does not read them (an older one): the page's own reading drops them", async () => {
    await fresh("older");
    await beside().then((stop) => stop());
    const before = await framesOver();
    const n = app.cdp.errors.length;
    const from = await peerSlot();
    // (the link's message as an older server would pass it on: straight into the page's client)
    const got = await app.js<{ rejected: number }>(`(() => {
      const net = __bh.net.net;
      for (const ev of [{ kind: "match", m: { id: "x" } }, { kind: "tel", v: { tau: "0" } }, { kind: "dock", to: net.room.slot, port: 0, ownPort: 0 }])
        net.onMessage(JSON.stringify({ type: "event", from: ${from}, ev }));
      return { rejected: net.inbound.rejected };
    })()`);
    await Bun.sleep(300);
    const after = await framesOver();
    console.log(`  an older server's relay: rejected by the page ${got.rejected}; GPU frames over 2 s ${before} → ${after}`);
    expect(got.rejected).toBe(3);
    expect(after).toBeGreaterThan(before * 0.5);
    expect(errorsSince(n)).toEqual([]);
  }, 90_000);

  test("the server does not replay a malformed match to a newcomer", async () => {
    await fresh("replay");
    peer!.event({ kind: "match", m: { id: "x" } } as never);
    await Bun.sleep(300);
    const late = new NetClient({ url: wsUrl(), build: "test", id: { device: "late", name: "Late", colour: "#00ff00" } });
    const seen: unknown[] = [];
    late.on("event", ({ ev }) => seen.push(ev));
    await late.join(code, "spectator");
    await Bun.sleep(800);
    late.close();
    console.log(`  the newcomer was sent: ${JSON.stringify(seen).slice(0, 160)}`);
    expect(seen.filter((e) => (e as { kind?: string }).kind === "match")).toEqual([]);
  }, 60_000);

  const peerSlot = () => app.js<number>(`__bh.net.net.room.members.find((m) => m.name === "Evil").slot`);
});
