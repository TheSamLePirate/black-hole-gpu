import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { HELD } from "./lib/held";
import { expectFlightPhase } from "./lib/flight-state";

// The approach in the headset (docs/PLAN-APPROCHES.md AP9): the F-35 on Sofia's ILS 09 (LBSF — nav.dat: its localizer, its outer,
// middle and inner markers), the sound on. Its clearance said with real values (« Sofia approach: cleared ILS approach runway 09,
// descend …, QNH 1013 »); its localizer's ident keyed in Morse once received; each marker heard as the craft passes over it —
// counted by the sound engine and measured on the beeps' bus: the spectrum's peak at its tone (400, 1 300, 3 000 Hz) over the
// band beside it (10–20 bins away, ±230–470 Hz: a tone stands out of it, a broadband sound does not). The witnesses (method rule 3): positive — each marker's tone found while over it —; negative — the same
// passage with `markerAudio` off: no count, no peak.
//
// Done when: the clearance said — established on the final: no altitude; engaged far out, off the axis: the join's (climb,
// descend or maintain) —, its runway and QNH in it; the ident keyed once (its letters nav.dat's); O, M and I each counted
// with a peak at its tone ≥ 15 dB over the band beside it; the outer passed again with the setting off: no count and no peak.
// Duration: about 2 min (the boot; four placings, each some 15–25 s of live flight to the beacon).

interface Heard {
  idents: number;
  lastIdent: string;
  markers: { O: number; M: number; I: number };
  marker: string | null;
}

describe.skipIf(!E2E)("the approach in the headset (Sofia ILS 09)", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  let A: {
    crs: number;
    thr: { lat: number; lon: number; elev: number };
    ident: string;
    markers: { kind: string; lat: number; lon: number }[];
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 60_000);
    // (a key: the page's gesture — the audio context runs)
    await app.press("KeyT");
    await app.press("KeyT");
    await app.waitFor(`__sound.ctx?.state === "running"`, 10_000);
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", sound: true, traffic: false, damage: false, weather: "fair", wind: 0, ilsIdentAudio: true, markerAudio: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    A = await app.js(`__bh.sys.approaches("LBSF").then((l) => { const a = l.find((x) => x.id === "I09");
      return { crs: a.crs, thr: a.thr, ident: a.loc.ident, markers: a.markers }; })`);
    console.log(`  LBSF I09: ident ${A.ident}, markers ${A.markers.map((m) => m.kind).join(" ")}`);
    // (the radio's lines kept)
    await app.js(`(() => { const c = __bh.camera, was = c.onRadio; window.__radio = [];
      c.onRadio = (text, role) => { window.__radio.push(text); return was?.(text, role); };
      // (the band beside a tone: the mean level 10–20 bins away on either side [dB] — a tone stands out of it, a broadband sound
      // does not)
      window.__side = (s, bin) => { let sum = 0, n = 0; for (let k = 10; k <= 20; k++) for (const j of [bin - k, bin + k]) if (s[j] > -Infinity) { sum += s[j]; n++; } return n ? sum / n : -200; };
      return 1; })()`);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** On the axis `out` m before the threshold, on the 3° slope, heading in at 85 m/s; the ILS on 09 engaged. */
  const placeAt = async (out: number) => {
    await app.scenario(`LBSF 09 · F-35 · ${(out / 1000).toFixed(1)} km out`);
    await app.js(`(() => { const D = Math.PI / 180, R = 6371000, a = ${JSON.stringify(A)};
      const back = (a.crs + 180) * D, d = ${out} / R, la = a.thr.lat * D, lo = a.thr.lon * D;
      const lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(back));
      const lon = lo + Math.atan2(Math.sin(back) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
      __bh.camera.ilsOff(); __bh.game.flyAt(lat / D, lon / D, Math.max((${out} + 300) * Math.tan(3 * D), 60), a.crs, 85); ${HELD}
      __bh.settings.shipMount = "cockpit"; __bh.fleet.fuel.f35 = 3000; return 1; })()`);
    await app.waitFor(`!!__bh.camera.geoNow() && __bh.camera.geoNow().gs > 60`, 10_000);
    // (rule 13 of E2E-VOLS: placed as a pilot leaves it — its holds, its thrust, its gear — asserted)
    await expectFlightPhase(app, "approach", {}, "placed");
    const said = await app.js<string>(`__bh.camera.ilsStart("LBSF", { runway: "09" })`);
    await app.waitFor(`!!__bh.camera.ilsRun`, 5000);
    return said;
  };
  /** Each marker's along distance before the threshold [m]. */
  const outOf = (kind: string) => {
    const m = A.markers.find((x) => x.kind === kind)!;
    const D = Math.PI / 180;
    const e = (m.lon - A.thr.lon) * D * 6371000 * Math.cos(A.thr.lat * D),
      n = (m.lat - A.thr.lat) * D * 6371000;
    return -(e * Math.sin(A.crs * D) + n * Math.cos(A.crs * D));
  };
  /** Live until the marker `kind` is heard, then over it: the beeps' spectrum's peak at `hz` over its median [dB] (the most found). */
  const passage = (kind: string, hz: number, maxS: number) =>
    app.js<{ heard: Heard; peak: number; over: number }>(`(async () => {
      const t0 = performance.now(); let peak = -Infinity, over = 0;
      const bin = Math.round(${hz} / (__sound.ctx.sampleRate / 2048));
      while (performance.now() - t0 < ${maxS * 1000}) {
        await new Promise((q) => setTimeout(q, 60));
        if (__sound.approachHeard().marker !== ${JSON.stringify(kind)}) { if (over > 25) break; continue; }
        over++;
        const s = __sound.busSpectrum("beeps"); if (!s) continue;
        const p = Math.max(s[bin - 1], s[bin], s[bin + 1]) - window.__side(s, bin);
        if (p > peak) peak = p;
      }
      return { heard: __sound.approachHeard(), peak, over };
    })()`);

  test("the clearance with real values; the localizer's ident keyed; the outer marker's 400 Hz", async () => {
    const said = await placeAt(outOf("O") + 1500);
    console.log(`  ${said}`);
    await app.waitFor(`__sound.approachHeard().idents >= 1`, 10_000);
    const radio = await app.js<string[]>(`window.__radio`);
    const clr = radio.find((r) => /cleared|autorisé/i.test(r)) ?? "";
    console.log(`  the radio: ${clr}`);
    expect(clr).toMatch(/09/);
    expect(clr).toMatch(/QNH 1013/);
    const r = await passage("O", 400, 40);
    console.log(`  outer: ${JSON.stringify(r)}`);
    expect(r.heard.lastIdent).toBe(A.ident);
    expect(r.heard.idents).toBe(1);
    expect(r.heard.markers.O).toBeGreaterThanOrEqual(1);
    expect(r.peak).toBeGreaterThan(15);
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await app.shot(`${shots}/approach-audio-outer.png`);
    }
  }, 90_000);

  test("the middle's 1 300 Hz, the inner's 3 000 Hz", async () => {
    await placeAt(outOf("M") + 900);
    const m = await passage("M", 1300, 30);
    console.log(`  middle: ${JSON.stringify(m)}`);
    expect(m.heard.markers.M).toBeGreaterThanOrEqual(1);
    expect(m.peak).toBeGreaterThan(15);
    if (A.markers.some((x) => x.kind === "I")) {
      await placeAt(outOf("I") + 500);
      const i = await passage("I", 3000, 25);
      console.log(`  inner: ${JSON.stringify(i)}`);
      expect(i.heard.markers.I).toBeGreaterThanOrEqual(1);
      expect(i.peak).toBeGreaterThan(15);
    }
  }, 120_000);

  test("the negative witness: the outer passed again with the markers off — no count, no peak", async () => {
    await app.js(`(() => { __bh.settings.markerAudio = false; return 1; })()`);
    const before = await app.js<Heard>(`__sound.approachHeard()`);
    await placeAt(outOf("O") + 1200);
    // (over the beacon by the controller's reckoning: the spectrum read there)
    const r = await app.js<{ count: number; peak: number; over: number }>(`(async () => {
      const t0 = performance.now(); let peak = -Infinity, over = 0;
      const bin = Math.round(400 / (__sound.ctx.sampleRate / 2048));
      while (performance.now() - t0 < 35000) {
        await new Promise((q) => setTimeout(q, 60));
        const a = __bh.camera.approachAudio();
        if (a?.marker !== "O") { if (over > 25) break; continue; }
        over++;
        const s = __sound.busSpectrum("beeps");
        peak = Math.max(peak, Math.max(s[bin - 1], s[bin], s[bin + 1]) - window.__side(s, bin));
      }
      return { count: __sound.approachHeard().markers.O, peak, over };
    })()`);
    console.log(`  outer, markers off: ${JSON.stringify(r)} (before: ${before.markers.O})`);
    expect(r.over).toBeGreaterThan(10);
    expect(r.count).toBe(before.markers.O);
    expect(r.peak).toBeLessThan(10);
    await app.js(`(() => { __bh.settings.markerAudio = true; __bh.camera.ilsOff(); return 1; })()`);
  }, 60_000);

  test("engaged far out, off the axis: the clearance gives the join's altitude (climb, descend or maintain)", async () => {
    // (30 km west of the field, 8 km north of the axis, at 2 000 m, heading east: the join planned — its first altitude said)
    await app.js(`(() => { const a = ${JSON.stringify(A)}; __bh.camera.ilsOff();
      __bh.game.flyAt(a.thr.lat + 0.072, a.thr.lon - 0.37, 1500, 90, 140); ${HELD} return 1; })()`);
    await app.waitFor(`!!__bh.camera.geoNow() && __bh.camera.geoNow().gs > 100`, 10_000);
    // (rule 13 of E2E-VOLS: placed as a pilot leaves it — its holds, its thrust, its gear — asserted)
    await expectFlightPhase(app, "cruise", {}, "placed");
    await app.js(`(() => { window.__radio.length = 0; return __bh.camera.ilsStart("LBSF", { runway: "09" }); })()`);
    const clr = (await app.js<string[]>(`window.__radio`)).find((r) => /cleared|autorisé/i.test(r)) ?? "";
    console.log(`  the radio, far out: ${clr}`);
    expect(clr).toMatch(/(descend|climb|maintain|descendez|montez|maintenez) \d/);
    expect(clr).toMatch(/QNH 1013/);
    await app.js(`(() => { __bh.camera.ilsOff(); return 1; })()`);
  }, 60_000);
});
