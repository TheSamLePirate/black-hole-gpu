import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// What the autosave costs the frame (audit 2026-11-10, AR-05; wave 4.8 — src/game/persistence.ts writes it in the loop, every
// 10 s and after a setting changed): its parts timed on the main thread — the snapshot (status, three structuredClone),
// JSON.stringify, localStorage.setItem — in an orbit (Artemis) and in an F-35's low flight over the Atlantic (tiles and IGN
// blocked), 30 times each. The probe checked first (method rule 3 of 13 Nov 2026): a positive witness (5 ms injected into the
// snapshot, read back) and an A/A (the same measure twice, medians within 0.3 ms). No assertion on the cost itself: a measure.
// Done when: the witness read, the A/A null, the parts' median, 95th centile and worst written. Duration: ~1 min.

const OUT = "remote-results/autosave-cost";

interface Parts {
  snap: number[];
  json: number[];
  write: number[];
  whole: number[];
  bytes: number;
}
const stat = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return { med: s[s.length >> 1]!, p95: s[Math.floor(s.length * 0.95)]!, max: s.at(-1)! };
};
const fmt = (v: number[]) => {
  const x = stat(v);
  return `${x.med.toFixed(2)} / ${x.p95.toFixed(2)} / ${x.max.toFixed(2)} ms`;
};

describe.skipIf(!E2E)("the autosave's cost in the frame", () => {
  let app: App;
  const rows: Record<string, unknown> = {};
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.cdp.send("Network.setBlockedURLs", {
      urls: ["*celestrak.org*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*", "*geopf.fr*", "*ign.fr*"],
    });
    await app.waitFor("__bh.camera.piloting", 60_000);
  }, 300_000);
  afterAll(async () => {
    await Bun.write(`${OUT}/parts.json`, JSON.stringify(rows, null, 2));
    app?.close();
    stopServer();
  });

  // (the parts, `n` times; `extraMs`: a busy wait added to the snapshot — the witness)
  const measure = (n: number, extraMs = 0) =>
    app.js<Parts>(`(() => {
      const g = __bh.game, out = { snap: [], json: [], write: [], whole: [], bytes: 0 };
      const busy = (ms) => { const t = performance.now(); while (performance.now() - t < ms); };
      for (let i = 0; i < ${n}; i++) {
        const t0 = performance.now();
        const s = g.snapshot("autosave"); busy(${extraMs});
        const t1 = performance.now();
        const j = JSON.stringify(s);
        const t2 = performance.now();
        localStorage.setItem("kerr.autosave-probe", j);
        const t3 = performance.now();
        out.snap.push(t1 - t0); out.json.push(t2 - t1); out.write.push(t3 - t2); out.whole.push(t3 - t0); out.bytes = j.length;
      }
      localStorage.removeItem("kerr.autosave-probe");
      return out;
    })()`);

  test("the probe: a 5 ms witness read back; A/A null", async () => {
    const a = await measure(30);
    const b = await measure(30);
    const w = await measure(30, 5);
    const da = Math.abs(stat(a.whole).med - stat(b.whole).med);
    const dw = stat(w.whole).med - stat(a.whole).med;
    console.log(`  A/A: ${fmt(a.whole)} vs ${fmt(b.whole)} (Δ median ${da.toFixed(2)} ms); witness +5 ms read as +${dw.toFixed(2)} ms`);
    rows.probe = { a: stat(a.whole), b: stat(b.whole), witness: stat(w.whole) };
    expect(da).toBeLessThan(0.3);
    expect(dw).toBeGreaterThan(4.5);
    expect(dw).toBeLessThan(5.5);
  }, 60_000);

  test("in orbit (Artemis): the parts", async () => {
    const p = await measure(30);
    console.log(
      `  orbit — snapshot ${fmt(p.snap)} · stringify ${fmt(p.json)} · setItem ${fmt(p.write)} · whole ${fmt(p.whole)} (median / p95 / worst) · ${(p.bytes / 1024).toFixed(0)} KB`,
    );
    rows.orbit = { snap: stat(p.snap), json: stat(p.json), write: stat(p.write), whole: stat(p.whole), bytes: p.bytes };
  }, 60_000);

  test("an F-35 at 3 000 m over the Atlantic: the parts", async () => {
    const placed = await app.js<string>(`(() => {
      __bh.freeze(true); __bh.settings.animate = true; __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane";
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      if (__bh.fleet.active !== "f35") return "not switched: " + __bh.fleet.active;
      __bh.game.flyAt(38.5, -14, 3000, 90, 160);
      for (let i = 0; i < 30; i++) __bh.step(1 / 30);
      __bh.freeze(false);
      return "ok"; })()`);
    expect(placed).toBe("ok");
    await Bun.sleep(1000);
    const p = await measure(30);
    console.log(
      `  F-35 — snapshot ${fmt(p.snap)} · stringify ${fmt(p.json)} · setItem ${fmt(p.write)} · whole ${fmt(p.whole)} (median / p95 / worst) · ${(p.bytes / 1024).toFixed(0)} KB`,
    );
    rows.f35 = { snap: stat(p.snap), json: stat(p.json), write: stat(p.write), whole: stat(p.whole), bytes: p.bytes };
  }, 60_000);
});
