import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The map under fingers (U5.4, audit §8.9): two fingers apart zoom in, together zoom out, moved
// together pan — not a turn of the view —; and in the map view, its controls are 44 px for a finger.

describe.skipIf(!E2E)("touch: the map", () => {
  let app: App;
  let c: { x: number; y: number };
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.press("KeyM");
    await app.waitFor(`document.querySelector(".fl-root.mapview") && __bh.mapView()`, 10_000);
    await Bun.sleep(1500);
    c = await app.js(`(() => { const b = document.querySelector(".fl-root.mapview .m3-stage").getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  });
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** Two fingers about the map's centre, `from` → `to` px apart (horizontally), their middle moved by `shift`. */
  const pinch = (from: number, to: number, shift = 0) =>
    app.touch(
      Array.from({ length: 12 }, (_, i) => {
        const k = i / 11,
          h = (from + (to - from) * k) / 2,
          dx = shift * k;
        return [
          { x: c.x - h + dx, y: c.y },
          { x: c.x + h + dx, y: c.y },
        ];
      }),
    );

  test("fingers apart zoom in, together zoom out", async () => {
    const d0 = (await app.js<{ dist: number }>("__bh.mapView()")).dist;
    await pinch(80, 240);
    const d1 = (await app.js<{ dist: number }>("__bh.mapView()")).dist;
    expect(d1 / d0).toBeLessThan(0.5);
    await pinch(240, 80);
    const d2 = (await app.js<{ dist: number }>("__bh.mapView()")).dist;
    expect(d2 / d1).toBeGreaterThan(2);
  });

  test("two fingers moved together pan, without turning the view", async () => {
    const v0 = await app.js<{ dist: number; yaw: number; focus: number[] }>("__bh.mapView()");
    await pinch(120, 120, 160);
    const v1 = await app.js<{ dist: number; yaw: number; focus: number[] }>("__bh.mapView()");
    expect(Math.hypot(...v1.focus.map((f, i) => f - v0.focus[i]!))).toBeGreaterThan(v0.dist * 0.05);
    expect(v1.yaw).toBeCloseTo(v0.yaw, 6);
    expect(v1.dist / v0.dist).toBeCloseTo(1, 1);
  });

  test("a finger's controls are 44 px in the map view", async () => {
    // (touch emulation on — the app.touch above — so the page's pointer is coarse)
    expect(await app.js<boolean>(`matchMedia("(pointer: coarse)").matches`)).toBe(true);
    const small = await app.js<string[]>(`[...document.querySelectorAll(".fl-root.mapview .fl-mapbar button")]
      .filter((b) => b.getClientRects().length && getComputedStyle(b).display !== "none")
      .map((b) => b.getBoundingClientRect()).filter((r) => r.height < 44 || r.width < 44).map((r) => r.width + "×" + r.height)`);
    expect(small).toEqual([]);
    expect(app.cdp.errors).toEqual([]);
  });
});
