import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED } from "./lib/j0-scene";
// PLAN-J6 J6-5 — the journeys « move away in free camera » and « film then return to the game » (strategy §19.13), in the main profile:
// the F-35 at 300 m over the Maures' hills (43.22° N, 6.33° E), east at 140 m/s under its autopilot and autothrottle; the real key F3 —
// the free camera —, then placed 6 km away looking at the hills (__bh.viewAt), 20 s; F1 back aboard; then F4 — the photo mode —, 6 s,
// Escape. At every image: the world's clock (__bh.time — never back), the craft's place (no jump: each image's step within twice its
// speed's), the contact ground under the craft (earthTiles.contactAt: its level the contact level all along — the camera away does not
// take the flight's ground, §19.4), the page's gaps. Asserted: the contact level kept under the craft while the camera is away, the clock
// never back, no jump of the craft, the autopilot's holds the same after F1 and after the photo mode, the craft's height held, no GPU
// error, the page never frozen over 1 s.
// Duration: ~4 min on kerr-mini.
// Done when: back from the photo mode with the holds checked, parcours-camera.json written.
afterAll(stopServer);
const OUT = process.env.PC_OUT ?? "remote-results/parcours-camera";
const AT = [43.22, 6.33, 300, 90, 140] as const;
type Seg = { frames: number; gapMax: number; back: number; jumpMax: number; stepMax: number; levelOff: number; at: unknown };
test.skipIf(!E2E)(
  "J6-5: free camera 6 km away and the photo mode in flight — the craft's ground kept, no jump, the clock forward, the holds kept",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = { startedAt: new Date().toISOString(), at: AT };
    try {
      await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); Object.assign(__bh.settings, { dof: false, motionBlur: 0, damage: false });
        return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const place = `(() => { __bh.game.setDate("2026-07-10T13:30:00Z"); __bh.game.flyAt(${AT.join(", ")}); __bh.settings.shipMount = "cockpit";
        __bh.refresh(); __bh.camera.viewReset(); return 1; })()`;
      await app.js(place);
      await app.dataSettled("the Maures", { maxMs: 90_000 }).catch((e) => console.log(`  (not settled: ${String(e).slice(0, 160)})`));
      await app.js(place);
      await app.settled(90_000);
      await app.js(`(() => { const c = __bh.camera, g = c.geoNow(); c.apSet({ ap: true, athr: true, alt: Math.round(g.alt), hdg: ${AT[3]} * Math.PI / 180, spd: ${AT[4]} });
        return 1; })()`);
      // in the page: `ms` of images — the clock, the craft's place and step, the contact under it —; one call, so the measure is continuous
      const seg = (ms: number) =>
        app.js<Seg>(`(async () => {
          const R = __bh.renderer, t = R.earthTiles, c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
          let gapMax = 0, back = 0, jumpMax = 0, stepMax = 0, levelOff = 0, frames = 0, last = performance.now();
          let t0 = __bh.time(), g0 = c.geoNow(); const s0 = performance.now();
          while (performance.now() - s0 < ${ms}) {
            const now = await f(); gapMax = Math.max(gapMax, now - last); last = now; frames++;
            const tt = __bh.time(), g = c.geoNow();
            if (tt < t0) back++;
            if (g && g0) {
              const d = Math.hypot((g.lat - g0.lat) * 111320, (g.lon - g0.lon) * 111320 * Math.cos(g.lat * Math.PI / 180), g.alt - g0.alt);
              const dtS = (tt - t0) * 492.5490947; // (M to s)
              stepMax = Math.max(stepMax, d);
              // (a jump: a step over twice what its speed covers in the image's simulated time, and over 5 m)
              if (d > Math.max(2 * ${AT[4]} * Math.max(dtS, 0), 5)) jumpMax = Math.max(jumpMax, d);
              const k = t.contactAt?.(g.lat, g.lon), want = t.contactLevel?.(g.lat, g.lon);
              if (k && want && (k.contactZ ?? k.z) < want) levelOff++;
            }
            t0 = tt; g0 = g;
          }
          const g = c.geoNow(), m = c.jetModes;
          return { frames, gapMax: +gapMax.toFixed(1), back, jumpMax: +jumpMax.toFixed(1), stepMax: +stepMax.toFixed(1), levelOff,
            at: g && { lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4), alt: Math.round(g.alt), gs: Math.round(g.gs ?? 0),
              holds: [m.alt && Math.round(m.alt), m.hdg && Math.round(m.hdg * 180 / Math.PI), m.spd], mode: __bh.mode.get(),
              spectating: !!c.spectating, photo: document.body.classList.contains("photo") } }; })()`);
      const segs: Record<string, Seg> = {};
      segs.aboard = await seg(10_000);
      console.log(`  aboard: ${JSON.stringify(segs.aboard)}`);
      const holds0 = (segs.aboard.at as { holds: unknown }).holds;
      // (F3: the free camera, then 6 km north of the craft, 1 500 m up, looking south at the hills)
      await app.press("F3", "F3");
      await app.waitFor(`__bh.camera.spectating`, 10_000);
      const why = await app.js<string | null>(`(() => { const g = __bh.camera.geoNow();
        return __bh.viewAt(g.lat + 0.055, g.lon, { altM: 1500, heading: 180, pitch: -12, fov: 50 }) ?? null; })()`);
      if (why) throw new Error(`viewAt: ${why}`);
      segs.away = await seg(20_000);
      console.log(`  camera away: ${JSON.stringify(segs.away)}`);
      await app.shot(`${OUT}/1-camera-away.png`);
      await app.press("F1", "F1");
      await app.waitFor(`!__bh.camera.spectating && __bh.mode.get() === "ship"`, 10_000);
      segs.backAboard = await seg(8_000);
      console.log(`  back aboard: ${JSON.stringify(segs.backAboard)}`);
      await app.shot(`${OUT}/2-back-aboard.png`);
      // (F4: the photo mode, 6 s; Escape: back)
      await app.press("F4", "F4");
      await app.waitFor(`document.body.classList.contains("photo")`, 5_000);
      segs.photo = await seg(6_000);
      console.log(`  photo mode: ${JSON.stringify(segs.photo)}`);
      await app.shot(`${OUT}/3-photo.png`);
      await app.press("Escape", "Escape");
      await app.waitFor(`!document.body.classList.contains("photo")`, 5_000);
      segs.afterPhoto = await seg(6_000);
      console.log(`  after the photo mode: ${JSON.stringify(segs.afterPhoto)}`);
      out.segments = segs;
      const all = Object.values(segs);
      const alt0 = (segs.aboard.at as { alt: number }).alt;
      for (const [k, s] of Object.entries(segs)) {
        expect(s.back, `${k}: the clock went back`).toBe(0);
        expect(s.jumpMax, `${k}: the craft jumped`).toBe(0);
        expect(s.levelOff, `${k}: the contact level lost under the craft`).toBe(0);
        expect(s.gapMax, `${k}: the page frozen`).toBeLessThan(1000);
        expect(Math.abs((s.at as { alt: number }).alt - alt0), `${k}: the height held`).toBeLessThan(60);
      }
      expect((segs.backAboard.at as { holds: unknown }).holds).toEqual(holds0);
      expect((segs.afterPhoto.at as { holds: unknown }).holds).toEqual(holds0);
      out.summary = { frames: all.reduce((a, s) => a + s.frames, 0), gapMax: Math.max(...all.map((s) => s.gapMax)) };
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      out.finishedAt = new Date().toISOString();
      await Bun.write(`${OUT}/parcours-camera.json`, JSON.stringify(out, null, 1));
      app.close();
    }
  },
  900_000,
);
