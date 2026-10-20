import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-PCD-AAA (docs/PLAN-PCD-AAA.md, Q9): the F-35's panoramic display worked with the mouse, by real pointer
// events (CDP) in the cockpit view, the F-35 flying — a portal's title opens the pages' menu and a page is chosen
// in it; the corner shows a side as one portal; the AP page's button engages the autopilot and its altitude's +
// selects 100 m more; the display's cost stays under the 0.70 ms a frame it had before Q1. FPS shown.

describe.skipIf(!E2E)("the F-35's panoramic display by the mouse", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(__bh.settings.vessel = "f35", true)`);
    await Bun.sleep(1500);
    await app.js(`(() => {
      __bh.game.flyAt(34.6, -117.6, 2000, 220, 200);
      __bh.settings.shipMount = "cockpit";
      __bh.settings.shipLookYaw = 0;
      __bh.settings.shipLookPitch = -26;
      __bh.settings.fov = 70;
      const p = __bh.pcd.pcd;
      p.pages = ["TSD", "FCR", "AP", "FUEL"];
      p.halves = ["split", "split"];
      return true;
    })()`);
    await app.waitFor("__bh.pcd.stats.frames > 30 && __bh.camera.airFlight.inAir", 60_000);
    await Bun.sleep(2500);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** Where a point of the display (px on its canvas) is on the page [CSS px]: the view's pixels searched for it by the
   *  cockpit's own pick (renderer.ship.jetPick) — proven to be the canvas there. */
  const at = async (px: number, py: number) => {
    const r = await app.js<{ x: number; y: number; top: string; err: number } | null>(`(() => {
      const S = __bh.renderer.ship;
      const want = [${px} / 2048, ${py} / 768];
      let best = null;
      const look = (nx, ny) => {
        const h = S.jetPick(nx, ny);
        if (!h?.screen) return;
        const e = Math.hypot((h.screen.u - want[0]) * 2048, (h.screen.v - want[1]) * 768);
        if (!best || e < best.e) best = { nx, ny, e };
      };
      for (let ny = -1; ny <= 1; ny += 0.02) for (let nx = -1; nx <= 1; nx += 0.02) look(nx, ny);
      if (!best) return null;
      for (let s = 0.01; s > 0.0005; s /= 2) {
        const b = { ...best };
        for (const [dx, dy] of [[s, 0], [-s, 0], [0, s], [0, -s]]) look(b.nx + dx, b.ny + dy);
      }
      const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const R = c.getBoundingClientRect();
      const x = R.left + (best.nx + 1) / 2 * R.width, y = R.top + (1 - best.ny) / 2 * R.height;
      return { x, y, top: document.elementFromPoint(x, y)?.tagName ?? "", err: best.e };
    })()`);
    expect(r).not.toBeNull();
    expect(r!.err).toBeLessThan(6);
    expect(r!.top).toBe("CANVAS");
    return r!;
  };
  const click = async (p: { x: number; y: number }) => {
    await app.mouse("move", p.x, p.y);
    await app.mouse("down", p.x, p.y);
    await app.mouse("up", p.x, p.y);
    await Bun.sleep(400);
  };
  /** a portal's frame on the display's canvas [px] */
  const frame = (k: number) => app.js<{ x: number; y: number; w: number; h: number }>(`__bh.pcd.pcd.portals()[${k}].frame`);

  test("a title opens the pages' menu, a page chosen in it; the corner shows a side as one portal", async () => {
    const f = await frame(1);
    await click(await at(f.x + f.w / 2 + 30, f.y + 23));
    expect(await app.js<number | null>("__bh.pcd.pcd.menu")).toBe(1);
    // (the menu's first row, third button: SMS)
    await Bun.sleep(300);
    await click(await at(f.x + 20 + (2.5 * (f.w - 40)) / 3, f.y + 46 + 30 + 32));
    expect(await app.js<string>("__bh.pcd.pcd.pages[1]")).toBe("SMS");
    expect(await app.js<number | null>("__bh.pcd.pcd.menu")).toBeNull();
    const t = await frame(0);
    await click(await at(t.x + t.w - 30, t.y + 23));
    expect(await app.js<string[]>("__bh.pcd.pcd.halves")).toEqual(["full", "split"]);
    await click(await at(t.x + 2 * t.w - 30 + 8, t.y + 23));
    expect(await app.js<string[]>("__bh.pcd.pcd.halves")).toEqual(["split", "split"]);
  }, 120_000);

  test("the AP page: the autopilot engaged by its button, the altitude's + selecting 100 m more", async () => {
    const f = await frame(2);
    const r = { x: f.x, y: f.y + 46, w: f.w };
    await click(await at(r.x + 16 + (r.w - 48) / 4, r.y + 40));
    const alt0 = await app.js<number | null>("__bh.camera.jetModes.alt");
    if (alt0 === null)
      console.log(
        "  AP refused:",
        await app.js(
          `[__bh.camera.airFlight.inAir, __bh.camera.airInfo().mode, __bh.pcd.pcd.touch(${(r.x + 16 + (r.w - 48) / 4) / 2048}, ${(r.y + 40) / 768})]`,
        ),
      );
    expect(alt0).not.toBeNull();
    await click(await at(r.x + r.w - 48, r.y + 92 + 140 + 28));
    expect(await app.js<number | null>("__bh.camera.jetModes.alt")).toBe(alt0! + 100);
  }, 120_000);

  test("its cost: under the 0.70 ms a frame it had before Q1, no frame over 8 ms", async () => {
    await app.js("(__bh.pcd.stats.reset(), true)");
    await Bun.sleep(10_000);
    const s = await app.js<{ frames: number; ms: number; max: number; up: number; read: number }>("({ ...__bh.pcd.stats })");
    console.log(
      `  the display: ${(s.ms / s.frames).toFixed(3)} ms a frame (upload ${(s.up / s.frames).toFixed(3)}, data ${(s.read / s.frames).toFixed(3)}), worst ${s.max.toFixed(2)} ms (${s.frames} frames)`,
    );
    expect(s.frames).toBeGreaterThan(200);
    expect(s.ms / s.frames).toBeLessThan(0.7);
    expect(s.max).toBeLessThan(8);
  }, 60_000);
});
