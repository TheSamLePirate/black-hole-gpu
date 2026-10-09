import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-COCKPIT K7: a flight flown at the panel, by real clicks (CDP mouse events on the cabin's controls) —
// the glide onto Edwards: ENTRY clicked, the autopilot flies it down; below 3 km AP OFF clicked, the GEAR
// lever down (by hand: the setting off), the FLAPS a detent, ENTRY again — the autopilot lands it, on its
// wheels. The flight itself at fixed steps (__bh.step), the clicks between with the flight live (frozen, the
// pointer works nothing), the cabin drawn.

describe.skipIf(!E2E)("a flight at the panel, by real clicks", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 60_000);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** The look turned towards a control; its place on the page [CSS px], the canvas there. */
  const aim = async (id: string, yaw: number, pitch: number) => {
    await app.js(`(__bh.camera.setLook(${yaw}, ${pitch}), true)`);
    await Bun.sleep(600);
    const r = await app.js<{ x: number; y: number; top: string } | null>(`(() => {
      const n = __bh.cockpitControlAt(${JSON.stringify(id)});
      if (!n) return null;
      const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const b = c.getBoundingClientRect();
      const x = b.left + (n[0] + 1) / 2 * b.width, y = b.top + (1 - n[1]) / 2 * b.height;
      return { x, y, top: document.elementFromPoint(x, y)?.tagName ?? "" };
    })()`);
    expect(r).not.toBeNull();
    expect(r!.top).toBe("CANVAS");
    return r!;
  };
  /** A control clicked: the pointer onto it, pressed, let go. */
  const click = async (id: string, yaw: number, pitch: number) => {
    const p = await aim(id, yaw, pitch);
    await app.mouse("move", p.x - 2, p.y);
    await app.mouse("move", p.x, p.y);
    await Bun.sleep(120);
    expect(await app.js<string | null>("__bh.camera.cockpit.input.hover")).toBe(id);
    await app.mouse("down", p.x, p.y);
    await app.mouse("up", p.x, p.y);
    await Bun.sleep(200);
  };
  /** The flight stepped until `until` holds, or `maxS` seconds of it (the clicks between: live). */
  const fly = (until: string, maxS: number) =>
    app.js<{ t: number; agl: number }>(`(() => {
      const c = __bh.camera;
      __bh.freeze(true);
      let t = 0;
      for (; t < ${maxS}; t += 1 / 30) {
        __bh.step(1 / 30);
        if (${until} || c.airFlight.failure) break;
      }
      __bh.freeze(false);
      return { t, agl: c.airInfo().agl ?? -1 };
    })()`);

  test("the glide onto Edwards flown at the panel: ENTRY, AP OFF, GEAR, FLAPS, ENTRY — landed on its wheels", async () => {
    await app.js(`(() => {
      __bh.freeze(true);
      Object.assign(__bh.settings, { autoGear: false, wind: 0, shipMount: "cockpit" });
      __bh.game.glideTo("Edwards", 30, 5, 220);
      const c = __bh.camera;
      c.pilot.setAuto("none"); c.pilot.hold = "none"; c.pilot.assist = false;
      c.airFlight.cfg.flaps = 0; c.gearDown = false; c.gearExt = 0;
      __bh.step(1 / 30);
      __bh.freeze(false);
      __bh.refresh();
      return true;
    })()`);
    await app.waitFor("__bh.renderer.ship.cabinShown", 20_000);
    await Bun.sleep(1500);
    // ENTRY: the autopilot engaged, its button lit
    await click("autoEntry", 38, -21);
    expect(await app.js<string>("__bh.camera.pilot.auto")).toBe("entry");
    // (flown down to 3 km over the ground)
    const down = await fly("(c.airInfo().agl ?? 1e9) < 3000", 200);
    expect(down.agl).toBeLessThan(3000);
    expect(await app.js<string | null>("__bh.camera.airFlight.failure ?? null")).toBeNull();
    // AP OFF: the pilot's; the gear lowered by hand, the flaps a detent
    await click("apOff", 38, -21);
    expect(await app.js<string>("__bh.camera.pilot.auto")).toBe("none");
    await click("gear", -42, -22);
    expect(await app.js<boolean>("__bh.camera.gearDown")).toBe(true);
    await click("flaps", -42, -22);
    expect(await app.js<number>("__bh.camera.airFlight.cfg.flaps")).toBe(0.5);
    // ENTRY again: the autopilot lands it
    await click("autoEntry", 38, -21);
    expect(await app.js<string>("__bh.camera.pilot.auto")).toBe("entry");
    await fly("c.ourLanded", 400);
    const r = await app.js<{ landed: boolean; belly: boolean; fail: string | null; ext: number; flaps: number }>(`(() => {
      const c = __bh.camera;
      return { landed: !!c.ourLanded, belly: c.onBelly, fail: c.airFlight.failure ?? null, ext: c.gearExt, flaps: c.airFlight.cfg.flaps };
    })()`);
    expect(r.fail).toBeNull();
    expect(r.landed).toBe(true);
    expect(r.belly).toBe(false);
    expect(r.ext).toBe(1);
    expect(r.flaps).toBe(0.5);
    // (and graded on the runway's axis: the report's card — an F there was the report's own error, read
    // within the touchdown's step: motion.ts reportLanding)
    await app.waitFor(`(() => { const r = document.querySelector("[data-testid=flight-report]"); return !!r && !r.hidden; })()`, 10_000);
    const card = await app.js<string>(`document.querySelector("[data-testid=flight-report]").innerText.replace(/\\n/g, " | ")`);
    expect({
      letter: await app.js<string>(`document.querySelector("[data-testid=flight-report] .fl-rp-grade b").textContent`),
      card,
    }).toMatchObject({
      letter: expect.stringMatching(/^[AB]$/),
    });
  }, 600_000);
});
