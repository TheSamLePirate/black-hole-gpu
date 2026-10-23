import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The Lander's landing radar (PLAN-RADAR-AAA, RD4's leftover — radar/landing.ts): the Lander put 10 km over the Moon's
// Mare Tranquillitatis — the altitude beam locked, not the velocities (ALT) —, then 3 km — both (ALT · VEL), its height
// the probes' —, then 400 m — the Approach HUD's height read off it (LR) —; the DESCENT panel's LR row each time.
// (E2E_SHOTS=<dir>: the panel at 3 km, the Approach HUD at 400 m.)

describe.skipIf(!E2E)("the Lander's landing radar", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { __bh.settings.vessel = "lander"; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "lander"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const at = async (agl: number) => {
    await app.js(`(() => { __bh.game.flyAt(0.67, 23.47, ${agl}, 0, 20, "moon"); __bh.settings.shipMount = "chase"; return 1; })()`);
    await app.waitFor(
      `(() => { const r = __bh.camera.flightInfo().landRadar; return !!r && Math.abs((r.h ?? __bh.camera.surfaceInfo().alt) - ${agl}) < ${agl} * 0.2; })()`,
      30_000,
    );
    await Bun.sleep(1500);
    return app.js<{ alt: boolean; vel: boolean; h: number | null; probe: number; row: string | null }>(`(() => {
      const c = __bh.camera, i = c.flightInfo(), r = i.landRadar;
      return { alt: r.alt, vel: r.vel, h: r.h, probe: c.surfaceInfo().alt, row: i.craftPanel?.rows.find((x) => x.label === "LR")?.value ?? null }; })()`);
  };

  test("10 km up: ALT only; 3 km: ALT · VEL, its height the probes'; 400 m: the Approach HUD's", async () => {
    const hi = await at(10_000);
    console.log(`  10 km: ALT ${hi.alt} VEL ${hi.vel} · ${hi.row}`);
    expect(hi.alt).toBe(true);
    expect(hi.vel).toBe(false);
    expect(hi.row).toBe("ALT");
    const mid = await at(3_000);
    console.log(`  3 km: ALT ${mid.alt} VEL ${mid.vel} · H ${mid.h?.toFixed(0)} m (probes ${mid.probe.toFixed(0)} m) · ${mid.row}`);
    expect(mid.alt && mid.vel).toBe(true);
    expect(Math.abs(mid.h! - mid.probe)).toBeLessThan(1);
    expect(mid.row).toBe("ALT · VEL");
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await app.shot(`${shots}/lander-lr-3km.png`);
    }
    const low = await at(400);
    const kind = await app.js<string | undefined>(`document.querySelector(".fl-root")?.dataset.kind`);
    console.log(`  400 m: ALT ${low.alt} VEL ${low.vel} · HUD ${kind}`);
    expect(low.alt && low.vel).toBe(true);
    if (shots) await app.shot(`${shots}/lander-lr-approach.png`);
  }, 180_000);
});
