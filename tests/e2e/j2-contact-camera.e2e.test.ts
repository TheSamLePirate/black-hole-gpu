import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED } from "./lib/j0-scene";

// PLAN-J2 J2-2 (docs/PLAN-J2-PAGES-RECONSTRUCTION.md; FICHE-J2-1 §1: the tile under the craft out of the fine windows, which follow the
// camera, 271 to 740 images in 760 with the camera 1.5 km off): the contact ground under the craft must not depend on the camera
// (strategy §19.4; CLAUDE.md). Two phases, each image read:
//  - ground: the F-35 set down on its gear on Mont Faron's southern flank (Toulon — France: the IGN's z 17 its contact level; a slope:
//    a level coarser is metres off; `game.land`, the simulation running — a frozen one holds the camera's rig too), the tiles in from
//    the cockpit, set down again on them; then the camera outside 1.5 km and 3 km behind it, 10 s each, and back in the cockpit — under
//    the craft each image: the contact ground (sys.groundAt, over the ellipsoid, as the gear stands on it), the craft's height over
//    the sea and over the ground, the finest drawn level holding the craft's tile (earthTiles.coverAt), and since J2-2 the contact's
//    own level and source (earthTiles.contactAt: the drawn ground, or the world's tiles held round the craft). Before J2-2 the ground
//    under a craft at rest moves with the camera; after, it must not.
//  - flight: the Beauce at 300 m, 140 m/s east (j2-page-camera's), autopilot + autothrottle + gear held (E2E-VOLS §5.4); the cockpit,
//    outside 1.5 km behind, outside 1.5 km ahead looking back, the cockpit again, 12 s each: the contact's level under the craft each
//    image, and (after) how far the drawn ground there is from it — what the craft would have stood on.
//  - ai (Sam's decision, 12 Nov 2026: reproduce the jump on an AI airliner at rest before anchoring the craft the camera follows):
//    an A320 of the traffic made up and parked on that same flank (`camera.traffic.planes`, on the ground: its height the ground's
//    under it plus its wheels, each image — controller/traffic.ts restAt), our F-35 set down 15 km away (its own anchor far from
//    it), the free camera following the airliner (spectator, target "trf:…", chase view) at ~60 m, 1.5 km, 3 km and ~60 m again,
//    10 s each — each image: its height over the ellipsoid, the contact ground under it, the drawn level holding its tile, the
//    contact's level and source, the camera's distance to it.
// Run on both sides of J2-2 by scripts/ab-e2e.ts (AB_SIDE/AB_RUN name the results). Not a pass/fail on the ground: the difference is
// the result (docs/progress/j2/FICHE-J2-2). It fails on a GPU error, a frozen page, the autopilot not engaged.
// Duration: ~4 min a side on kerr-mini (cold boot, the tiles, 30 s of hold, 48 s of flight).
// Done when: both phases read, j2-contact-camera.json written, no GPU error.

const MACHINE = process.env.J2_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
const SIDE = process.env.AB_SIDE ? `${process.env.AB_SIDE}${process.env.AB_RUN ?? ""}` : "";
const OUT = process.env.J2_OUT ?? `remote-results/j2-contact-camera/${MACHINE}${SIDE ? `-ab/${SIDE}` : ""}`;
const PHASES = (process.env.J2CC_PHASES ?? "ground,flight").split(",");
/** the AI airliner's id, our F-35's place for the ai phase (15 km east-north-east of the flank: Solliès, its anchor far) */
const AI_ID = "e2eai1";
const AI_PLAYER = [43.18, 6.12] as const;
/** the chase view's zooms about an A320 (2.4 × its 37.6 m length × zoom behind it): ~60 m, ~1.5 km, ~3 km */
const AI_VIEWS = [
  { name: "chase-60m", zoom: 0.66 },
  { name: "chase-1500m", zoom: 16.6 },
  { name: "chase-3000m", zoom: 33.2 },
  { name: "chase-60m-again", zoom: 0.66 },
];
const W = 1920,
  H = 1080;
/** Mont Faron's southern flank, over Toulon [°] (the craft set down there) */
const GROUND = [43.1405, 5.942] as const;
/** the Beauce (j2-page-camera's) */
const FLY = [48.36, 1.62, 300, 90, 140] as const;
const HOLD_S = Number(process.env.J2_HOLD_S ?? 10);
const FLY_S = Number(process.env.J2_FLY_S ?? 12);
const cockpit = `__bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
const outside = (yaw: number, dist: number) =>
  `__bh.settings.shipMount = "around"; __bh.refresh(); __bh.camera.viewReset(); Object.assign(__bh.camera.outside, { yaw: ${yaw}, pitch: 8, dist: ${dist} });`;
const HOLD_VIEWS = [
  { name: "cockpit", set: cockpit },
  { name: "outside-behind-1500m", set: outside(0, 1500) },
  { name: "outside-behind-3000m", set: outside(0, 3000) },
  { name: "cockpit-again", set: cockpit },
];
const FLY_VIEWS = [
  { name: "cockpit", set: cockpit },
  { name: "outside-behind-1500m", set: outside(0, 1500) },
  { name: "outside-ahead-1500m", set: outside(180, 1500) },
  { name: "cockpit-again", set: cockpit },
];
const out: Record<string, unknown> = { machine: MACHINE, side: SIDE, output: `${W}×${H}`, startedAt: new Date().toISOString() };

async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`the page did not answer in ${ms / 1000} s (${what}) — frozen?`)), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    clearTimeout(timer);
  }
}

/** in the page: `ms` of images, under the craft each: [t, contact ground (over the ellipsoid), drawn level holding its tile, the
 *  contact's level (−1 before J2-2), its source (1 the held tiles, 0 the drawn, −1 n/a), the tiles' height (contact), the drawn
 *  ground's (tiles, before detail and geoid), the camera's horizontal distance to the craft [m], the craft's height over the sea,
 *  over the ground [m], its ground speed [m/s]] */
const chunkJs = (ms: number, touch: boolean) => `(async () => {
  const t = __bh.renderer.earthTiles, c = __bh.camera, S = __bh.sys, frame = () => new Promise((q) => requestAnimationFrame(q));
  const rows = []; const t0 = performance.now(); let last = t0, gapMax = 0;
  const agl = () => { const F = __bh.fleet, t = __bh.sim.time, p = F.pose(F.active, t); return +S.heightOverGround("earth", p.X, t).toFixed(3); };
  const dist = (a, b) => { const k = Math.PI / 180, x = (b.lon - a.lon) * k * Math.cos(a.lat * k), y = (b.lat - a.lat) * k;
    return Math.hypot(x * 6371000, y * 6371000); };
  while (performance.now() - t0 < ${ms}) {
    ${touch ? "__bh.touch();" : ""}
    const now = await frame(); gapMax = Math.max(gapMax, now - last); last = now;
    const g = c.geoNow(); if (!g) continue;
    const v = t.coverAt({ lat: g.lat, lon: g.lon });
    const k = t.contactAt ? t.contactAt(g.lat, g.lon) : null;
    const gh = S.groundAt(g.lat, g.lon);
    rows.push([+now.toFixed(1), +gh.toFixed(3), v.atZ, k ? k.z : -1, k ? (k.src === "anchor" ? 1 : 0) : -1,
      k ? +k.h.toFixed(3) : null, k ? +k.drawnH.toFixed(3) : null,
      // (the camera's place: the tiles' reference — earthTiles follows it — against the craft's, horizontally)
      Math.round(dist({ lat: g.lat, lon: g.lon }, { lat: Math.asin(t.sinLat) * 180 / Math.PI, lon: t.lon * 180 / Math.PI })),
      +g.alt.toFixed(3), agl(), +g.gs.toFixed(2)]);
  }
  const g = c.geoNow();
  const k = t.contactAt && g ? t.contactAt(g.lat, g.lon) : null;
  return { rows, gapMax: +gapMax.toFixed(1), craft: g ? { lat: +g.lat.toFixed(6), lon: +g.lon.toFixed(6), alt: Math.round(g.alt) } : null,
    contact: k, ap: c.jetModes.alt !== null, mount: __bh.settings.shipMount };
})()`;

type Row = [number, number, number, number, number, number | null, number | null, number, number, number, number];

function summarise(name: string, rows: Row[], ref: number | null) {
  const hs = rows.map((r) => r[1]);
  const lv = (i: number) => {
    const c: Record<string, number> = {};
    for (const r of rows) {
      const k = String(r[i]);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  };
  const off = rows.filter((r) => r[5] !== null && r[6] !== null).map((r) => Math.abs((r[5] as number) - (r[6] as number)));
  const s = [...off].sort((a, b) => a - b);
  return {
    view: name,
    images: rows.length,
    ground: { min: Math.min(...hs), max: Math.max(...hs), first: hs[0], last: hs[hs.length - 1] },
    // (hold: the contact ground against the cockpit's, under the same still craft)
    vsCockpit:
      ref === null
        ? null
        : { maxAbs: +Math.max(...hs.map((h) => Math.abs(h - ref))).toFixed(3), last: +((hs[hs.length - 1] ?? 0) - ref).toFixed(3) },
    drawnLevel: lv(2),
    contactLevel: lv(3),
    fromHeld: rows.filter((r) => r[4] === 1).length,
    // (after: the drawn ground's distance from the contact under the craft — what it would have stood on)
    drawnOff: off.length
      ? {
          p50: +(s[Math.floor(s.length / 2)] ?? 0).toFixed(3),
          p95: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(3),
          max: +(s[s.length - 1] ?? 0).toFixed(3),
          over0_1m: off.filter((x) => x > 0.1).length,
        }
      : null,
    camDist: [Math.min(...rows.map((r) => r[7])), Math.max(...rows.map((r) => r[7]))],
    // (the craft: its height over the sea, over the ground — the gear's measure —, its ground speed)
    craftAlt: [Math.min(...rows.map((r) => r[8])), Math.max(...rows.map((r) => r[8]))],
    craftAgl: [Math.min(...rows.map((r) => r[9])), Math.max(...rows.map((r) => r[9]))],
    gsMax: Math.max(...rows.map((r) => r[10])),
  };
}

describe.skipIf(!E2E)("J2-2: the craft's contact ground whatever the camera", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: W, height: H, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
  }, 300_000);
  afterAll(async () => {
    out.finishedAt = new Date().toISOString();
    await Bun.write(`${OUT}/j2-contact-camera.json`, JSON.stringify(out, null, 1));
    console.log(`  ${OUT}/j2-contact-camera.json`);
    await app?.close();
    stopServer();
  });

  /** placed frozen, the relief in from the cockpit (pending 0, z ≥ 14 for 3 s, 60 s at most), placed again (E2E-VOLS rule 5) */
  async function place(at: readonly number[], label: string) {
    const [lat, lon, agl, hdg, spd] = at;
    const go = `(async () => { __bh.freeze(false); __bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair");
    __bh.game.set("earthClouds", 0); __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, ${spd}); ${cockpit}
    for (let i = 0; i < 40; i++) await new Promise((q) => requestAnimationFrame(q)); __bh.freeze(true); return 1; })()`;
    await app.js(go);
    await app.settled(180_000);
    const relief = await app.js<{ ok: boolean; finest: number; pending: number }>(`(async () => {
    const t = __bh.renderer.earthTiles, frame = () => new Promise((q) => requestAnimationFrame(q));
    const t0 = performance.now(); let calm = 0;
    while (performance.now() - t0 < 60000) { const ok = t.pending === 0 && t.finest >= 14; calm = ok ? calm || performance.now() : 0;
      if (calm && performance.now() - calm > 3000) break; __bh.touch(); await frame(); }
    return { ok: calm > 0, finest: t.finest, pending: t.pending }; })()`);
    console.log(`  ${label} relief: ${JSON.stringify(relief)}`);
    if (!relief.ok) console.log(`  ${label}: the relief not all in within 60 s (pending ${relief.pending}) — measured anyway`);
    await app.js(go);
    await app.dataSettled(label, { maxMs: 60_000 }).catch((e) => console.log(`  ${String(e).slice(0, 160)}`));
    await app.settled(60_000);
    return relief;
  }

  async function views(list: { name: string; set: string }[], s: number, touch: boolean, tag: string) {
    const res: Record<string, unknown>[] = [];
    let ref: number | null = null;
    for (const v of list) {
      await within(
        app.js(
          `(async () => { ${v.set} for (let i = 0; i < 20; i++) { ${touch ? "__bh.touch();" : ""} await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`,
        ),
        20_000,
        `${v.name}: view set`,
      );
      const rows: Row[] = [];
      let last: Record<string, unknown> = {};
      for (let k = 0; k < s; k++) {
        const r = await within(app.js<{ rows: Row[]; [k: string]: unknown }>(chunkJs(1000, touch)), 20_000, `${v.name} at ${k} s`);
        rows.push(...r.rows);
        const { rows: _r, ...rest } = r;
        last = rest;
      }
      await app.shot(`${OUT}/${tag}-${v.name}.png`);
      if (tag === "ground" && v.name === "cockpit") ref = rows[rows.length - 1]?.[1] ?? null;
      const sum = summarise(v.name, rows, tag === "ground" ? ref : null);
      console.log(`  ${tag} ${v.name}: ${JSON.stringify(sum)} last ${JSON.stringify(last)}`);
      const t0 = rows[0]?.[0] ?? 0;
      res.push({ ...sum, last, rows: rows.map((r) => [+(r[0] - t0).toFixed(0), ...r.slice(1)]) });
    }
    return res;
  }

  test.skipIf(!PHASES.includes("ground"))(
    "ground: a craft at rest on a slope, the camera 1.5 and 3 km off — its contact ground each image",
    async () => {
      const [lat, lon] = GROUND;
      // (set down on its gear, the simulation running; the relief in from the cockpit; set down again on it — E2E-VOLS rule 5)
      const land = `(async () => { __bh.freeze(false); __bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair");
      __bh.game.set("earthClouds", 0); const note = __bh.game.land("earth", ${lat}, ${lon}); ${cockpit}
      for (let i = 0; i < 60; i++) await new Promise((q) => requestAnimationFrame(q)); return note; })()`;
      console.log(`  land: ${await app.js(land)}`);
      await app.settled(180_000);
      const relief = await app.js<{ ok: boolean; finest: number; pending: number }>(`(async () => {
      const t = __bh.renderer.earthTiles, frame = () => new Promise((q) => requestAnimationFrame(q));
      const t0 = performance.now(); let calm = 0;
      while (performance.now() - t0 < 60000) { const ok = t.pending === 0 && t.finest >= 14; calm = ok ? calm || performance.now() : 0;
        if (calm && performance.now() - calm > 3000) break; await frame(); }
      return { ok: calm > 0, finest: t.finest, pending: t.pending }; })()`);
      console.log(`  Mont Faron relief: ${JSON.stringify(relief)}`);
      console.log(`  land again: ${await app.js(land)}`);
      await app.dataSettled("Mont Faron", { maxMs: 60_000 }).catch((e) => console.log(`  ${String(e).slice(0, 160)}`));
      await app.settled(60_000);
      // (at rest: its ground speed under 0.5 m/s for 2 s, 20 s at most)
      out.groundPlaced = {
        relief,
        rest: await app.js(`(async () => { const c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
        const t0 = performance.now(); let calm = 0; while (performance.now() - t0 < 20000) { const g = c.geoNow();
        const ok = g && g.gs < 0.5; calm = ok ? calm || performance.now() : 0; if (calm && performance.now() - calm > 2000) break; await f(); }
        const g = c.geoNow(); return { atRest: calm > 0, gs: g?.gs, lat: g?.lat, lon: g?.lon, alt: g?.alt, label: __bh.game.status().label }; })()`),
      };
      console.log(`  at rest: ${JSON.stringify(out.groundPlaced)}`);
      out.ground = await views(HOLD_VIEWS, HOLD_S, false, "ground");
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      expect(out.gpuErrors).toBe(0);
    },
    400_000,
  );

  test.skipIf(!PHASES.includes("flight"))(
    "flight: the Beauce at 300 m, the camera in, behind, ahead — the contact's level under the craft each image",
    async () => {
      const [, , , hdg, spd] = FLY;
      out.flyPlaced = await place(FLY, "the Beauce");
      const ap = await app.js<{ ap: boolean; athr: boolean }>(`(async () => { __bh.freeze(false);
      const c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
      for (let i = 0; i < 90; i++) { await f(); __bh.settings.autoGear = false; c.gearDown = true; c.gearExt = 1; c.gearInit = true;
        if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        if (c.jetModes.alt !== null && c.jetModes.spd !== null && i > 10) break; }
      const g = c.geoNow(); if (g && c.jetModes.alt !== null) { c.jetModes.alt = g.alt; c.jetModes.hdg = ${hdg} * Math.PI / 180; }
      c.jetModes.spd = ${spd}; return { ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null }; })()`);
      if (!ap.ap || !ap.athr) throw new Error(`the autopilot ${ap.ap} / autothrottle ${ap.athr} not engaged`);
      out.flight = await views(FLY_VIEWS, FLY_S, false, "flight");
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      expect(out.gpuErrors).toBe(0);
    },
    500_000,
  );

  test.skipIf(!PHASES.includes("ai"))(
    "ai: an AI airliner at rest on the slope, the camera following it at 60 m, 1.5 km, 3 km — its ground each image",
    async () => {
      const [lat, lon] = GROUND;
      // (our F-35 set down far from it; the airliner made up, parked on the flank — its reports' clock the page's: no age)
      const setup = `(async () => { __bh.freeze(false); __bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair");
      __bh.game.set("earthClouds", 0); const note = __bh.game.land("earth", ${AI_PLAYER[0]}, ${AI_PLAYER[1]}); ${cockpit}
      const F = __bh.camera.traffic, now = Date.now() / 1000;
      const p = { id: "${AI_ID}", cs: "E2EAI1", reg: "F-TEST", type: "A320", cat: "A3", lat: ${lat}, lon: ${lon}, alt: 0, gs: 0, trk: 90,
        hdg: 90, vs: 0, roll: null, gnd: true, t: now, src: "adsb.lol" };
      F.planes.set(p.id, { p, prev: null, hist: [p], heard: now });
      for (let i = 0; i < 30; i++) await new Promise((q) => requestAnimationFrame(q));
      // (as the camera panel's Chase tile does: the free camera's target and view, let go of our craft — camerapanel.ts)
      __bh.spectate(true); const vc = __bh.camera.viewController();
      __bh.settings.target = vc.s.target = "trf:${AI_ID}"; __bh.settings.subjectView = vc.s.subjectView = "chase";
      __bh.camera.setSpectatorFollow(false); vc.subject.yaw = vc.subject.pitch = 0; vc.subject.zoom = ${AI_VIEWS[0]!.zoom};
      for (let i = 0; i < 60; i++) await new Promise((q) => requestAnimationFrame(q));
      const c = __bh.camera.trafficNow().find((x) => x.id === "${AI_ID}");
      const t = __bh.renderer.earthTiles, k = Math.PI / 180;
      const camKm = Math.hypot((t.lon / k - ${lon}) * Math.cos(${lat} * k), Math.asin(t.sinLat) / k - ${lat}) * k * 6371;
      return { note, ai: c ? { alt: c.alt, gnd: c.gnd } : null, spectating: __bh.camera.spectating, target: vc.s.target,
        view: vc.s.subjectView, active: vc.subjectActive(), camKm: +camKm.toFixed(2) }; })()`;
      const s0 = await app.js<{ ai: unknown; spectating: boolean }>(setup);
      console.log(`  ai setup: ${JSON.stringify(s0)}`);
      if (!s0.ai) throw new Error("the made-up airliner is not in the traffic (camera.trafficNow)");
      // (the free camera by the airliner — the tiles' reference within a kilometre of it —, not left by our craft)
      if (!((s0 as { camKm?: number }).camKm! < 1)) throw new Error(`the camera is not following the airliner: ${JSON.stringify(s0)}`);
      await app.settled(180_000);
      const relief = await app.js<{ ok: boolean; finest: number; pending: number }>(`(async () => {
      const t = __bh.renderer.earthTiles, frame = () => new Promise((q) => requestAnimationFrame(q));
      const t0 = performance.now(); let calm = 0;
      while (performance.now() - t0 < 60000) { const ok = t.pending === 0 && t.finest >= 14; calm = ok ? calm || performance.now() : 0;
        if (calm && performance.now() - calm > 3000) break; await frame(); }
      return { ok: calm > 0, finest: t.finest, pending: t.pending }; })()`);
      console.log(`  Mont Faron relief (camera by the airliner): ${JSON.stringify(relief)}`);
      out.aiPlaced = { setup: s0, relief };
      const res: Record<string, unknown>[] = [];
      // (twice: its ground not held — the flown craft's alone, as before Sam's decision —, then held — renderer.anchorSubject)
      for (const anchored of [false, true]) {
        await app.js(`(() => { __bh.renderer.anchorSubject = ${anchored}; return 1; })()`);
        let ref: number | null = null;
        for (const v of AI_VIEWS) {
          await app.js(`(async () => { __bh.camera.viewController().subject.zoom = ${v.zoom};
        for (let i = 0; i < 20; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`);
          const rows: [number, number, number, number, number, number, number, number][] = [];
          for (let k = 0; k < HOLD_S; k++) {
            const r = await within(
              app.js<{ rows: typeof rows }>(`(async () => {
            const t = __bh.renderer.earthTiles, S = __bh.sys, frame = () => new Promise((q) => requestAnimationFrame(q));
            const rows = []; const t0 = performance.now();
            const dist = (a, b) => { const k = Math.PI / 180, x = (b.lon - a.lon) * k * Math.cos(a.lat * k), y = (b.lat - a.lat) * k; return Math.hypot(x, y) * 6371000; };
            while (performance.now() - t0 < 1000) {
              const now = await frame();
              const c = __bh.camera.trafficNow().find((x) => x.id === "${AI_ID}"); if (!c) continue;
              const v = t.coverAt({ lat: ${lat}, lon: ${lon} }), k = t.contactAt ? t.contactAt(${lat}, ${lon}) : null;
              rows.push([+now.toFixed(1), +c.alt.toFixed(3), +S.groundAt(${lat}, ${lon}).toFixed(3), v.atZ, k ? k.z : -1,
                k ? (k.src === "anchor" ? 1 : 0) : -1,
                Math.round(dist({ lat: ${lat}, lon: ${lon} }, { lat: Math.asin(t.sinLat) * 180 / Math.PI, lon: t.lon * 180 / Math.PI })),
                c.gnd ? 1 : 0]);
            }
            return { rows }; })()`),
              20_000,
              `${v.name} at ${k} s`,
            );
            rows.push(...r.rows);
          }
          await app.shot(`${OUT}/ai-${anchored ? "held" : "free"}-${v.name}.png`);
          const alts = rows.map((r) => r[1]);
          if (v.name === "chase-60m") ref = alts[alts.length - 1] ?? null;
          const lv = (i: number) => {
            const c: Record<string, number> = {};
            for (const r of rows) c[String(r[i])] = (c[String(r[i])] ?? 0) + 1;
            return c;
          };
          const sum = {
            anchored,
            view: v.name,
            images: rows.length,
            alt: { min: Math.min(...alts), max: Math.max(...alts) },
            vsNear: ref === null ? null : +Math.max(...alts.map((a) => Math.abs(a - ref!))).toFixed(3),
            drawnLevel: lv(3),
            contactLevel: lv(4),
            fromHeld: rows.filter((r) => r[5] === 1).length,
            camDist: [Math.min(...rows.map((r) => r[6])), Math.max(...rows.map((r) => r[6]))],
            onGround: rows.filter((r) => r[7] === 1).length,
          };
          console.log(`  ai ${anchored ? "held" : "free"} ${v.name}: ${JSON.stringify(sum)}`);
          const t0 = rows[0]?.[0] ?? 0;
          res.push({ ...sum, rows: rows.map((r) => [+(r[0] - t0).toFixed(0), ...r.slice(1)]) });
        }
      }
      out.ai = res;
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      expect(out.gpuErrors).toBe(0);
    },
    500_000,
  );
});
