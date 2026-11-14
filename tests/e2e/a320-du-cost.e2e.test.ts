import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The A320's displays: what they cost (audit 2026-11-10, FX-19 — « the PFD at 20 Hz, the ISIS at 10: their attitude steps in a fast
// roll; drawn every frame, at what cost? »). The A320 in its cockpit over the sea, 8 s: each display's own rate (its draws counted),
// its drawing time (DuSet.cost, smoothed), the atlas uploads' time (renderer.ship.updateDu timed). A measure: the method's rule 3
// first — a positive witness (2 ms of work injected into the PFD's drawing must show as ~2 ms more) and an A/A (the same 8 s twice, the
// costs alike).
// Done when: the witness seen and the A/A null; the figures printed (the PFDs' and ISIS's cost at every frame worked out).
// Duration: ~1.5 min.

interface Run {
  secs: number;
  frames: number;
  draws: Record<string, number>;
  cost: Record<string, number>;
  uploadMs: number;
  uploads: number;
}

describe.skipIf(!E2E)("the A320's displays: their rates and costs", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.js(`(() => { __bh.settings.vessel = "a320"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "a320"`, 30_000);
    await app.js(
      `(() => { __bh.game.flyAt(42.9, 6.0, 3000, 90, 130); __bh.settings.shipMount = "cockpit"; __bh.camera.pilot.throttle = 0.6; return 1; })()`,
    );
    await app.waitFor(`!!__bh.renderer.a320Du && Object.keys(__bh.renderer.a320Du.cost).length >= 4`, 60_000);
    // (the counters: each display's draws, the uploads' time)
    await app.js(`(() => {
      const D = __bh.renderer.a320Du, S = __bh.renderer.ship;
      window.__du = { draws: {}, uploadMs: 0, uploads: 0, frames: 0, extra: 0 };
      const frame = D.frame.bind(D);
      D.frame = (...a) => { const out = frame(...a); for (const n of D.drawn) window.__du.draws[n] = (window.__du.draws[n] ?? 0) + 1; return out; };
      const up = S.updateDu.bind(S);
      S.updateDu = (parts) => { const t0 = performance.now(); up(parts); window.__du.uploadMs += performance.now() - t0; window.__du.uploads += parts.length; };
      for (const u of D.units) if (u.name === "PFD1") { const draw = u.d.draw.bind(u.d); u.d.draw = (...a) => { const t = performance.now(); while (performance.now() - t < window.__du.extra); return draw(...a); }; }
      const tick = () => { window.__du.frames++; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      return 1; })()`);
    await Bun.sleep(3000);
  }, 240_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const run = async (secs: number, extraMs: number): Promise<Run> => {
    await app.js(`(() => { const U = window.__du; U.draws = {}; U.uploadMs = 0; U.uploads = 0; U.frames = 0; U.extra = ${extraMs};
      for (const k of Object.keys(__bh.renderer.a320Du.cost)) __bh.renderer.a320Du.cost[k] = 0; return 1; })()`);
    await Bun.sleep(secs * 1000);
    return app.js<Run>(`(() => { const U = window.__du; return { secs: ${secs}, frames: U.frames, draws: { ...U.draws },
      cost: { ...__bh.renderer.a320Du.cost }, uploadMs: U.uploadMs, uploads: U.uploads }; })()`);
  };

  test("the witness, the A/A, the figures", async () => {
    const a = await run(8, 0);
    const b = await run(8, 0);
    const w = await run(8, 2);
    await app.js(`(window.__du.extra = 0, 1)`);
    const fmt = (r: Run) =>
      Object.keys(r.cost)
        .sort()
        .map((k) => `${k} ${(r.draws[k] ?? 0) / r.secs} Hz ${r.cost[k]!.toFixed(2)} ms`)
        .join(" · ");
    for (const [n, r] of [
      ["A", a],
      ["A'", b],
      ["witness +2 ms", w],
    ] as const)
      console.log(
        `  ${n}: ${(r.frames / r.secs).toFixed(0)} fps · ${fmt(r)} · uploads ${(r.uploads / r.secs).toFixed(0)}/s, ${(r.uploadMs / Math.max(r.uploads, 1)).toFixed(3)} ms each`,
      );
    // (the PFDs and the ISIS drawn every frame: their drawing and their uploads, per frame)
    const fps = a.frames / a.secs;
    const per = (k: string) => a.cost[k] ?? 0;
    const up = a.uploadMs / Math.max(a.uploads, 1);
    const now = Object.keys(a.cost).reduce((s, k) => s + ((a.draws[k] ?? 0) / a.secs) * (per(k) + up), 0) / fps;
    const every = per("PFD1") + per("PFD2") + per("IESI") + 3 * up + now;
    console.log(
      `  the displays now: ${now.toFixed(2)} ms a frame · with the PFDs and the ISIS every frame: ~${every.toFixed(2)} ms a frame (worked out)`,
    );
    await app.snap("remote-results/a320-du-cost/cockpit.png");
    // (the witness: ~2 ms more on PFD1; the A/A: its cost within 0.3 ms)
    expect(w.cost.PFD1! - a.cost.PFD1!).toBeGreaterThan(1.5);
    expect(Math.abs(a.cost.PFD1! - b.cost.PFD1!)).toBeLessThan(0.3);
  }, 120_000);
});
