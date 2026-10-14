import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The observatory (ui/observe.ts, system/observing.ts): on foot in the fields south of Paris on the night of 10 January 2026
// (Jupiter at its opposition), Y sets the tripod where one stands and the telescope on it; ⇧Y opens what there is
// to see, Jupiter found by its name and looked at now — framed and held there while time runs ×1000 —; Sirius
// taken at its best by TARS, tracked at the centre as the sky turns; Saturn's best moment from its row, by a click.

const SHOTS = process.env.E2E_SHOTS;

describe.skipIf(!E2E)("the observatory", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis", width: 1280, height: 800, lang: "fr", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    // (a clear night: the sky's things seen as they are — the game's weather would put clouds over them)
    await app.js(`(__bh.game.setDate("2026-01-10T21:00:00Z"), __bh.settings.weather = "fair", __bh.settings.earthClouds = 0, true)`);
    await app.js(
      `__bh.tars.tools().find((t) => t.name === "place_ship").run({ mode: "walk", query: "48.40, 2.70" }, new AbortController().signal)`,
    );
    await app.waitFor("__bh.camera.character.active", 30_000);
    await Bun.sleep(1500);
  }, 200_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** How far the view's centre is from a body where the frame shows it (its light's place, aberrated: the overlay's
   *  own reading), or from a direction [°]; the view's field. */
  const off = (what: string) =>
    app.js<{ deg: number; fov: number; target: string; tele: boolean }>(`(() => {
      const v = __bh.camera.viewController();
      let c;
      if (${what.startsWith("[")}) {
        const w = v.rigWorld(), d = ${what.startsWith("[") ? what : "null"}, n = Math.hypot(...d);
        c = (d[0] * w.fwd[0] + d[1] * w.fwd[1] + d[2] * w.fwd[2]) / n;
      } else {
        const i = v.targetInfo();
        c = i.look[0] * i.cam.fwd[0] + i.look[1] * i.cam.fwd[1] + i.look[2] * i.cam.fwd[2];
      }
      return { deg: Math.acos(Math.min(1, c)) * 180 / Math.PI, fov: v.s.fov, target: String(v.s.target), tele: !!v.s.telescope };
    })()`);

  /** a TARS tool run as the model calls it */
  const tool = (name: string, args: object) =>
    app.js(`__bh.tars.tools().find((t) => t.name === ${JSON.stringify(name)}).run(${JSON.stringify(args)}, new AbortController().signal)`);

  test("on foot, Y: the tripod where he stands, the telescope on it", async () => {
    await app.press("KeyY", "y");
    await Bun.sleep(1500);
    expect(await app.js<boolean>(`__bh.camera.character.active`)).toBe(false);
    expect(await app.js<string>(`__bh.camera.viewController().s.rotation`)).toBe("tripod");
    expect(await app.js<boolean>(`__bh.camera.viewController().s.telescope`)).toBe(true);
    // (Y again: the telescope off, the tripod kept)
    await app.press("KeyY", "y");
    await Bun.sleep(500);
    expect(await app.js<boolean>(`__bh.camera.viewController().s.telescope`)).toBe(false);
  }, 60_000);

  test("⇧Y: Jupiter up tonight, looked at now — framed, held there ×1000", async () => {
    await app.press("KeyY", "Y", { shift: true });
    await app.waitFor(`!!document.querySelector("[data-testid=observe]")`, 5_000);
    // (typed: the rows filtered to it, up now — lit)
    await app.click("[data-testid=observe-search]");
    await app.type("Jupiter");
    expect(await app.js<boolean>(`document.querySelector("[data-testid=observe-row-jupiter]").classList.contains("up")`)).toBe(true);
    expect(await app.js<boolean>(`document.querySelector("[data-testid=observe-row-saturn]").hidden`)).toBe(true);
    await app.waitFor(`!document.querySelector("[data-testid=observe-best-jupiter]").disabled`, 20_000);
    expect(await app.js<string>(`document.querySelector("[data-testid=observe-row-jupiter] .ob-when").textContent`)).toMatch(/au mieux/);
    await app.click("[data-testid=observe-aim-jupiter]");
    await app.waitFor(`!document.querySelector("[data-testid=observe]")`, 5_000);
    await Bun.sleep(2500);
    const a = await off("jupiter");
    console.log(`  Jupiter: ${a.deg.toFixed(4)}° off the centre, a ${a.fov.toFixed(3)}° field`);
    expect(a.target).toBe("jupiter");
    expect(a.tele).toBe(true);
    expect(a.fov).toBeLessThan(1);
    expect(a.deg).toBeLessThan(a.fov / 4);
    if (SHOTS) await app.shot(`${SHOTS}/observe-jupiter.png`);
    await app.js(`(__bh.game.warp(1000), true)`);
    await Bun.sleep(3000);
    const b = await off("jupiter");
    await app.js(`(__bh.game.realTime(), true)`);
    console.log(`  ×1000, 3 s on: ${b.deg.toFixed(4)}° off`);
    expect(b.deg).toBeLessThan(b.fov / 4);
  }, 90_000);

  test("Sirius at its best by TARS: the clock taken there, the star held at the centre as the sky turns", async () => {
    const r = await app.js<unknown>(
      `__bh.tars.tools().find((t) => t.name === "observe").run({ action: "when", name: "Sirius" }, new AbortController().signal)`,
    );
    const w = (r as { result?: { windows: { best: string; altDeg: number }[] }; windows?: { best: string; altDeg: number }[] }).result ?? r;
    const win = (w as { windows: { best: string; altDeg: number }[] }).windows;
    expect(win.length).toBeGreaterThan(5);
    expect(Math.abs(win[0]!.altDeg - 24.5)).toBeLessThan(1.5);
    await app.js(
      `__bh.tars.tools().find((t) => t.name === "observe").run({ action: "look", name: "Sirius", at: "best" }, new AbortController().signal)`,
    );
    await Bun.sleep(2000);
    const date = await app.js<string>(`__bh.game.date()`);
    expect(date.slice(0, 10)).toBe(win[0]!.best.slice(0, 10));
    const dir = await app.js<number[]>(`__bh.camera.viewController().rig.star`);
    expect(dir).not.toBeNull();
    const s0 = await off(JSON.stringify(dir));
    expect(s0.deg).toBeLessThan(0.05);
    await app.js(`(__bh.game.warp(1000), true)`);
    await Bun.sleep(3000);
    const s1 = await off(JSON.stringify(dir));
    await app.js(`(__bh.game.realTime(), true)`);
    console.log(`  Sirius: ${s0.deg.toFixed(4)}° then ${s1.deg.toFixed(4)}° off after ×1000`);
    expect(s1.deg).toBeLessThan(0.05);
    if (SHOTS) await app.shot(`${SHOTS}/observe-sirius.png`);
  }, 90_000);

  test("Saturn's best moment from its row: the clock there, the telescope on it, above the horizon", async () => {
    await app.press("KeyY", "Y", { shift: true });
    await app.waitFor(`!!document.querySelector("[data-testid=observe]")`, 5_000);
    await app.waitFor(`!document.querySelector("[data-testid=observe-best-saturn]").disabled`, 30_000);
    // (its best moment from here, as TARS reads it: the window holding now — Saturn sinking in the south-west, its best
    // now — or the next)
    const r = await app.js<{ result?: { windows: { best: string }[] }; windows?: { best: string }[] }>(
      `__bh.tars.tools().find((t) => t.name === "observe").run({ action: "when", name: "Saturn" }, new AbortController().signal)`,
    );
    const best = (r.result ?? r).windows![0]!.best;
    await app.click("[data-testid=observe-best-saturn]");
    await app.waitFor(`!document.querySelector("[data-testid=observe]")`, 5_000);
    await Bun.sleep(2500);
    expect(await app.js<string>(`__bh.game.date()`)).toBe(best.slice(0, 16).replace("T", " ").replace("Z", ""));
    const a = await off("saturn");
    expect(a.target).toBe("saturn");
    expect(a.tele).toBe(true);
    expect(a.deg).toBeLessThan(a.fov / 4);
    // (up: its view looks above the horizon)
    const alt = await app.js<number>(`__bh.mx.framedView().alt`);
    expect(alt).toBeGreaterThan(9);
    if (SHOTS) await app.shot(`${SHOTS}/observe-saturn.png`);
  }, 90_000);

  test("Escape in its search: the search emptied first, then the page closed", async () => {
    await app.press("KeyY", "Y", { shift: true });
    await app.waitFor(`!!document.querySelector("[data-testid=observe]")`, 5_000);
    await app.click("[data-testid=observe-search]");
    await app.type("Mars");
    await app.press("Escape");
    expect(await app.js<string>(`document.querySelector("[data-testid=observe-search]").value`)).toBe("");
    expect(await app.js<boolean>(`!!document.querySelector("[data-testid=observe]")`)).toBe(true);
    await app.press("Escape");
    await app.waitFor(`!document.querySelector("[data-testid=observe]")`, 3_000);
  }, 30_000);

  test("the wormhole: found as Gargantua, at its best near Saturn — its mouth framed whole, the other universe in it", async () => {
    await tool("observe", { action: "look", name: "Gargantua", at: "best" });
    await Bun.sleep(3000);
    const a = await off("wormhole");
    const seen = await app.js<number>(`__bh.camera.viewController().targetInfo().seen * 180 / Math.PI`);
    console.log(`  wormhole: ${a.deg.toFixed(4)}° off, its mouth ${(2 * seen).toFixed(3)}° across in a ${a.fov.toFixed(2)}° field`);
    expect(a.target).toBe("wormhole");
    expect(a.tele).toBe(true);
    // (the mouth framed: three of its diameters in the field)
    expect(a.fov).toBeCloseTo(6 * seen, 1);
    expect(a.deg).toBeLessThan(a.fov / 20);
    expect(await app.js<number>(`__bh.mx.framedView().alt`)).toBeGreaterThan(9);
    // (the spot meter — on by default —: the mouth's disc metered alone; off, the whole night image: a few stops
    // darker. Read as the exposure the meter settles on, and the readout says SPOT)
    const ev = async () => {
      await Bun.sleep(3500);
      return app.js<number>(`__bh.renderer.autoExposureEV`);
    };
    const spotOn = await ev();
    const read = await app.js<{ core: number; sky: number } | null>(`__bh.renderer.spotRead`);
    expect(await app.js<boolean>(`!!__bh.renderer.meterSpot`)).toBe(true);
    // (the mouth's core well over the sky behind it: the black point set there, the other universe on black)
    expect(read!.core / read!.sky).toBeGreaterThan(2);
    if (SHOTS) await app.shot(`${SHOTS}/observe-wormhole.png`);
    await tool("camera", { spot: false });
    const spotOff = await ev();
    expect(await app.js<boolean>(`!!__bh.renderer.meterSpot`)).toBe(false);
    if (SHOTS) await app.shot(`${SHOTS}/observe-wormhole-nospot.png`);
    console.log(
      `  the mouth metered: spot ${spotOn.toFixed(2)} EV (its core ${(read!.core / read!.sky).toFixed(0)}× its sky), the whole image ${spotOff.toFixed(2)} EV`,
    );
    await tool("camera", { spot: true });
    // (Gargantua itself as the target, beyond the mouth: the mouth framed — not a point at the narrowest field)
    await app.js(
      `(() => { const v = __bh.camera.viewController(); v.setTelescope(false); v.selectTarget("hole", { focus: false }); v.setTelescope(true); return 1; })()`,
    );
    await Bun.sleep(2500);
    const g = await off("wormhole");
    expect(g.target).toBe("hole");
    expect(g.fov).toBeGreaterThan(1);
  }, 60_000);
});
