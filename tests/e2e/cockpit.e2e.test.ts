import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-COCKPIT: the cockpit's controls worked with the mouse, by real pointer events (CDP) — K2: over a
// control it is lit and its tip names it; a click on the SAS button toggles the SAS, on the flaps' lever moves
// them a detent on; the air brake's lever dragged down puts it out; the wheel over the CABIN knob dims the
// lights; a switch flipped; the right button's drag still turns the look; a click on the cabin's wall picks
// nothing beyond it. K3: over a screen its tabs show; a click on one shows that page there, kept; again,
// back to automatic.

describe.skipIf(!E2E)("the cockpit's controls by the mouse", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.js(`(__bh.settings.shipMount = "cockpit", __bh.refresh(), true)`);
    await app.waitFor("__bh.renderer.ship.cabinShown", 20_000);
    await Bun.sleep(1500);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** The look turned towards a control, and the control's place on the page [CSS px] — proven to be the
   *  canvas there (no panel over it). */
  const aim = async (id: string, yaw: number, pitch: number) => {
    await app.js(`(__bh.camera.setLook(${yaw}, ${pitch}), true)`);
    await Bun.sleep(500);
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
  const click = async (p: { x: number; y: number }) => {
    await app.mouse("move", p.x, p.y);
    await app.mouse("down", p.x, p.y);
    await app.mouse("up", p.x, p.y);
    await Bun.sleep(150);
  };

  test("hovered: the control lit, its tip named; a click on the SAS toggles it", async () => {
    const p = await aim("sas", 38, -21);
    await app.mouse("move", p.x - 3, p.y);
    await app.mouse("move", p.x, p.y);
    await Bun.sleep(150);
    const h = await app.js<{ hover: string | null; tip: string; shown: boolean; sas: boolean }>(`({
      hover: __bh.camera.cockpit.input.hover,
      tip: document.querySelector("[data-testid=cockpit-tip]").textContent,
      shown: document.querySelector("[data-testid=cockpit-tip]").style.display !== "none",
      sas: __bh.camera.pilot.sas,
    })`);
    expect(h.hover).toBe("sas");
    expect(h.shown).toBe(true);
    expect(h.tip).toContain("SAS");
    await click(p);
    expect(await app.js<boolean>("__bh.camera.pilot.sas")).toBe(!h.sas);
    await click(p);
    expect(await app.js<boolean>("__bh.camera.pilot.sas")).toBe(h.sas);
  });

  test("the flaps' lever clicked: a detent on; the air brake's dragged down: out", async () => {
    await app.js(`(__bh.camera.airFlight.cfg.flaps = 0, __bh.camera.airBrake = 0, true)`);
    const f = await aim("flaps", -42, -22);
    await click(f);
    expect(await app.js<number>("__bh.camera.airFlight.cfg.flaps")).toBe(0.5);
    const a = await aim("airBrake", -42, -22);
    await app.mouse("move", a.x, a.y);
    await app.mouse("down", a.x, a.y);
    for (let k = 1; k <= 8; k++) await app.mouse("move", a.x, a.y + k * 18);
    await app.mouse("up", a.x, a.y + 144);
    expect(await app.js<number>("__bh.camera.airBrake")).toBeCloseTo(1, 3);
  });

  test("the wheel over the CABIN knob dims the cabin; the NAV switch flipped", async () => {
    await app.js(`(__bh.settings.cabinLight = 1, __bh.settings.navLights = false, true)`);
    const k = await aim("dimmer", -21, -22);
    await app.mouse("move", k.x, k.y);
    for (let i = 0; i < 4; i++) await app.mouse("wheel", k.x, k.y, { deltaY: 100 });
    const lit = await app.js<number>("__bh.settings.cabinLight");
    expect(lit).toBeLessThan(0.75);
    expect(lit).toBeGreaterThan(0.45);
    const n = await aim("navLights", -21, -22);
    await click(n);
    expect(await app.js<boolean>("__bh.settings.navLights")).toBe(true);
  });

  test("the right button's drag still turns the look; a click on a wall picks nothing", async () => {
    const p = await aim("sas", 38, -21);
    const yaw0 = await app.js<number>("__bh.settings.shipLookYaw");
    await app.mouse("move", p.x, p.y);
    await app.mouse("down", p.x, p.y, { button: "right" });
    for (let k = 1; k <= 6; k++) await app.mouse("move", p.x + k * 20, p.y);
    await app.mouse("up", p.x + 120, p.y, { button: "right" });
    expect(Math.abs((await app.js<number>("__bh.settings.shipLookYaw")) - yaw0)).toBeGreaterThan(2);
    // (the floor, looking down: a wall — the target kept)
    await app.js(`(__bh.camera.setLook(0, -70), true)`);
    await Bun.sleep(400);
    const target = await app.js<string>("__bh.settings.target");
    await click({ x: 720, y: 600 });
    expect(await app.js<string>("__bh.settings.target")).toBe(target);
  });

  test("K3: a screen's tabs under the pointer; ORB clicked: the PFD's display shows the orbit, kept; again: automatic", async () => {
    await app.js(`(__bh.settings.cockpitPages = "", __bh.camera.setLook(0, -35), true)`);
    await Bun.sleep(600);
    const toPx = (n: [number, number]) =>
      app.js<{ x: number; y: number; top: string }>(`(() => {
        const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const b = c.getBoundingClientRect();
        const x = b.left + (${n[0]} + 1) / 2 * b.width, y = b.top + (1 - ${n[1]}) / 2 * b.height;
        return { x, y, top: document.elementFromPoint(x, y)?.tagName ?? "" };
      })()`);
    const n = await app.js<[number, number] | null>(`__bh.cockpitScreenPoint(0, "orbit")`);
    expect(n).not.toBeNull();
    const p = await toPx(n!);
    expect(p.top).toBe("CANVAS");
    await app.mouse("move", p.x - 2, p.y);
    await app.mouse("move", p.x, p.y);
    await Bun.sleep(200);
    expect(await app.js<boolean>("__bh.camera.cockpit.input.overTab")).toBe(true);
    await click(p);
    expect(await app.js<string>("__bh.settings.cockpitPages")).toBe("orbit,,,,,,,");
    expect(await app.js<string | null>("__bh.cockpitScreens.pages[0]")).toBe("orbit");
    await click(p);
    expect(await app.js<string>("__bh.settings.cockpitPages")).toBe("");
  });

  test("K4b: the GEAR lever clicked in orbit: the gear commanded down — its tip says it is moving", async () => {
    await app.js(`(__bh.settings.autoGear = false, __bh.camera.gearDown = false, __bh.camera.gearExt = 0, true)`);
    const g = await aim("gear", -42, -22);
    await click(g);
    expect(await app.js<boolean>("__bh.camera.gearDown")).toBe(true);
    await app.mouse("move", g.x + 1, g.y);
    await Bun.sleep(400);
    expect(await app.js<string>(`document.querySelector("[data-testid=cockpit-tip]").textContent`)).toMatch(
      /in transit|en mouvement|down and locked|sorti/,
    );
  });

  test("K5: the flaps' key — their lever seen travelling there; CIRC at the panel engages, lit; AP OFF", async () => {
    await app.js(`(__bh.camera.airFlight.cfg.flaps = 0, true)`);
    await Bun.sleep(800);
    // (the flaps: the second control — their lever's angle in the poses' uniform, each frame after the key)
    const angles = await app.js<number[]>(`new Promise((done) => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyP", key: "p" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyP", key: "p" }));
      const out = [], t0 = performance.now();
      const tick = () => {
        out.push(__bh.renderer.cockpitControls[1 * 16 + 3]);
        if (performance.now() - t0 < 900) requestAnimationFrame(tick); else done(out);
      };
      requestAnimationFrame(tick);
    })`);
    expect(await app.js<number>("__bh.camera.airFlight.cfg.flaps")).toBe(0.5);
    // (from up — 30° — to half — 0° —, through the angles between)
    expect(angles.some((a) => a > 0.05 && a < 0.47)).toBe(true);
    expect(Math.abs(angles.at(-1)!)).toBeLessThan(1e-3);
    // CIRC: an orbit to circularize, the pilot's real time
    await app.js(
      `(__bh.game.orbit("earth", { peKm: 300, apKm: 600, nu: 60 }), __bh.camera.setWarpAuthority(false), __bh.game.warp(1), true)`,
    );
    await Bun.sleep(1500);
    await app.js(`(__bh.settings.shipMount = "cockpit", __bh.refresh(), true)`);
    await app.waitFor("__bh.renderer.ship.cabinShown", 20_000);
    const c = await aim("autoCirc", 38, -16);
    await click(c);
    await app.waitFor(`["node", "circularize"].includes(__bh.camera.pilot.auto)`, 10_000);
    // (its lamp lit: the CIRC button — the 10th control's lamp in the uniform)
    await app.waitFor(`__bh.renderer.cockpitControls[9 * 16 + 13] > 0.5`, 5_000);
    const off = await aim("apOff", 38, -21);
    await click(off);
    expect(await app.js<string>("__bh.camera.pilot.auto")).toBe("none");
  });
});
