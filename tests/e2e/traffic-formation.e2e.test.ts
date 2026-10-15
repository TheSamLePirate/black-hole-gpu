import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The real traffic in the sky (docs/PLAN-AVIATION-AAA.md, T2 — its criterion): over Paris, a real airliner (live,
// adsb.lol through the relay) drawn — its type's mesh, its label: callsign, registration, type, altitude —; our
// F-35 put 1.5 km behind it, the airliner locked on the radar (neutral), "Formation on the lock": on its wing, held —
// the airliner drawn 30 s behind the real time, flown between its reports (its recent trace asked once followed).
// (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("in formation with a real airliner", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  let pick: { id: string; cs: string; reg: string; type: string; alt: number } | null = null;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; __bh.settings.wind = 0; __bh.settings.traffic = true; __bh.settings.formShape = "echelonR"; __bh.settings.formPos = 2; return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(48.95, 2.45, 3000, 90, 200); return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    await app.waitFor(`(__bh.camera.traffic?.planes.size ?? 0) > 5`, 30_000);
  }, 200_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("a real airliner picked over Paris; our F-35 put behind it; on the radar, neutral", async () => {
    // (airborne, cruising or climbing between 2 500 and 9 000 m, its callsign and registration known, an airliner)
    pick = await app.js(`(() => {
      const L = [...__bh.camera.traffic.planes.values()].map((t) => t.p)
        .filter((p) => !p.gnd && p.alt > 2500 && p.alt < 9000 && p.gs > 120 && p.cs && p.reg && /^(A3|B7|E1|E2|CRJ|BCS|A2)/.test(p.type));
      L.sort((a, b) => Math.abs(a.vs) - Math.abs(b.vs));
      const p = L[0];
      if (!p) return null;
      // (drawn 30 s behind the real time: put us 1.5 km behind where it is drawn)
      const d = 1500 + p.gs * Math.max(0, (__bh.settings.trafficDelay ?? 0) - (Date.now() / 1000 - p.t)), la = p.lat - Math.cos(p.trk * Math.PI / 180) * d / 111195, lo = p.lon - Math.sin(p.trk * Math.PI / 180) * d / (111195 * Math.cos(p.lat * Math.PI / 180));
      __bh.game.flyAt(la, lo, p.alt - 120, p.trk, p.gs);
      return { id: p.id, cs: p.cs, reg: p.reg, type: p.type, alt: p.alt };
    })()`);
    console.log(`  picked ${JSON.stringify(pick)}`);
    expect(pick).not.toBeNull();
    await Bun.sleep(1500);
    await app.js(
      `(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); __bh.settings.shipMount = "chase"; return 1; })()`,
    );
    await app.waitFor(`__bh.camera.radar.tracks.has("trf:${pick!.id}")`, 20_000);
    const iff = await app.js<string>(`__bh.camera.radar.tracks.get("trf:${pick!.id}").iff`);
    expect(iff).toBe("neutral");
  }, 60_000);

  test("Formation on the lock: on its wing, held; its label read — callsign, registration, type", async () => {
    const said = await app.js<string>(`(() => { const c = __bh.camera; c.radar.lockOn("trf:${pick!.id}"); return c.trafficForm(); })()`);
    console.log(`  ${said}`);
    expect(said).toContain(pick!.reg);
    // (settled: within 20 m for ten seconds running — the approach's own overshoot let pass)
    let run = 0;
    const t0 = Date.now();
    while (run < 20 && Date.now() - t0 < 240_000) {
      run = (await app.js<number>(`__bh.camera.form?.last?.dist ?? 1e9`)) < 20 ? run + 1 : 0;
      await Bun.sleep(500);
    }
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      worst = Math.max(worst, await app.js<number>(`__bh.camera.form?.last?.dist ?? 1e9`));
      if (process.env.TRF_DBG)
        console.log(
          await app.js<string>(`(() => { const F = __bh.camera.form, L = F?.last, T = __bh.camera.traffic.planes.get("${pick!.id}");
            return [L?.dist, L?.along, L?.cross, L?.up].map((x) => (x ?? NaN).toFixed(1)).join(" ") + " | rep t " + T?.p.t.toFixed(1) + " alt " + T?.p.alt.toFixed(0) + " vs " + T?.p.vs.toFixed(1) + " trk " + T?.p.trk.toFixed(1) + " gs " + T?.p.gs.toFixed(0) + " now " + (Date.now() / 1000).toFixed(1)
              + " | V " + __bh.camera.jetFigures()?.V.toFixed(0) + " lead " + (() => { const l = __bh.camera.trafficLead("${pick!.id}"); return l ? Math.hypot(...l.v).toFixed(0) + " gap " + Math.hypot(...[0,1,2].map((k) => l.p[k] - __bh.camera.netOwn().p[k])).toFixed(0) : "none"; })()
              + " focus " + __bh.camera.traffic.focus + " " + __bh.camera.traffic.status
              + " | drawn alt " + __bh.camera.trafficNow().find((x) => x.id === "${pick!.id}")?.alt.toFixed(1)
              + " hist " + T?.hist.slice(-8).map((q) => (q.t % 1000).toFixed(1) + ":" + q.alt.toFixed(1) + "/" + q.vs.toFixed(1)).join(" "); })()`),
        );
      await Bun.sleep(500);
    }
    const mark = await app.js<{ label: string; dist: number } | null>(
      `(() => { const m = __bh.camera.trafficOverlay((x) => Math.round(x) + " m").find((m) => m.id === "${pick!.id}"); return m ? { label: m.label, dist: m.dist } : null; })()`,
    );
    console.log(
      `  settled in ${((Date.now() - t0) / 1000).toFixed(0)} s, then held within ${worst.toFixed(1)} m over 20 s; its label "${mark?.label}" at ${mark?.dist.toFixed(0)} m`,
    );
    expect(worst).toBeLessThan(25);
    expect(mark?.label).toContain(pick!.reg);
    await shot("airliner-chase");
    await app.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(800);
    await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: 35, pitch: 10, dist: 95 }); return 1; })()`);
    await Bun.sleep(1500);
    await shot("airliner-around");
  }, 300_000);
});
