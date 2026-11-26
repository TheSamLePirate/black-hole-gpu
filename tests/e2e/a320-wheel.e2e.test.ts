import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-A320-VOL-AAA W1–W2: the A320's own wheel by the real Tab key and the real mouse — before 26 Nov 2026 the A320 was shown the
// spacecraft's (SAS, orbits…). Lined up at Le Bourget by day, clear sky: Tab held opens the A320's sectors (Autopilot, FCU,
// Configuration, Approach, Instruments, Easy take-off, Assistance, View — no SAS); « Easy take-off » clicked flies the take-off
// through the A320's own controls (CONF 1+F, TOGA, the side stick at VR, gear up, AP1, CL at 1 500 ft, flaps up); then FCU ▸ ALT ▸
// +1000 ft and « OP CLB / OP DES » (the knob pulled, FlightGear's call): OP CLB on the FMA; Instruments ▸ ND range ×2: the deck's ND.
// Duration: ~3 min on kerr-mini.
// Done when: the ND's range doubled from the wheel.

const DIR = "remote-results/a320-wheel";
mkdirSync(DIR, { recursive: true });
const tab = { code: "Tab", key: "Tab", windowsVirtualKeyCode: 9 };
const labels = `[...document.querySelectorAll("[data-testid=wheel] .rw-label b")].map((b) => b.textContent)`;

describe.skipIf(!E2E)("the A320's wheel: Tab held, its sectors, the easy take-off, the FCU", () => {
  let app: App;
  let size: [number, number] = [0, 0];
  const at = (i: number, n: number) => {
    const a = (i / n) * 2 * Math.PI;
    return { x: size[0] / 2 + 150 * Math.sin(a), y: size[1] / 2 - 150 * Math.cos(a) };
  };
  const click = async (p: { x: number; y: number }) => {
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", clickCount: 1 });
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 });
    await Bun.sleep(250);
  };
  /** The wheel opened by Tab held, the path of items clicked (each by its label); the wheel closed after. */
  const choose = async (...path: string[]) => {
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: size[0] / 2, y: size[1] / 2 });
    await app.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...tab });
    await app.waitFor(`document.querySelectorAll("[data-testid=wheel] .rw-sector").length > 0`, 3000);
    for (const p of path) {
      const L = await app.js<string[]>(labels);
      const i = L.findIndex((l) => l === p || l === `${p} ▸` || l.startsWith(`${p} `));
      if (i < 0) throw new Error(`no « ${p} » in the wheel: ${L.join(" | ")}`);
      await click(at(i, L.length));
    }
    await app.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...tab });
    await Bun.sleep(300);
  };

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(() => {
      Object.assign(__bh.settings, { vessel: "a320", a320Start: "ready", a320Assist: "realistic", traffic: false, weather: "fair", wind: 0, earthClouds: 0, language: "en" });
      __bh.setDate(Date.UTC(2026, 10, 5, 12) - 2.44 * 240000);
      return true;
    })()`);
    await app.waitFor(`__bh.fleet.active === "a320"`, 30_000);
    await app.js(`(__bh.game.lineUp("Paris – Le Bourget"), __bh.settings.shipMount = "cockpit", __bh.refresh(), true)`);
    await app.waitFor("!!__bh.camera.a320Sys", 30_000);
    await app.settled(90_000);
    size = await app.js<[number, number]>("[innerWidth, innerHeight]");
  }, 400_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("Tab held: the A320's sectors, no spacecraft's", async () => {
    app.step("Tab held: the A320's wheel");
    await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: size[0] / 2, y: size[1] / 2 });
    await app.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...tab });
    await app.waitFor(`document.querySelectorAll("[data-testid=wheel] .rw-sector").length > 0`, 3000);
    const L = await app.js<string[]>(labels);
    console.log(`  1. the wheel: ${L.join(" | ")}`);
    await app.shot(`${DIR}/wheel.png`);
    await app.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...tab });
    // (Tab let go over no sector: the wheel closes by itself — an Escape here opened the pause menu)
    await app.waitFor(`!document.querySelector("[data-testid=wheel]")`, 3000);
    for (const want of ["Autopilot ▸", "FCU ▸", "Configuration ▸", "Instruments ▸", "Easy take-off", "Assistance ▸"])
      expect(L).toContain(want);
    expect(L.some((l) => /^SAS|Holds|Docking/.test(l))).toBeFalse();
  }, 60_000);

  test("Easy take-off: off the runway, gear up, AP1, CL at 1 500 ft, flaps up — through the A320's own controls", async () => {
    app.step("Easy take-off from the wheel");
    await choose("Easy take-off");
    const s0 = await app.js<{ thr: number; flaps: number; to: boolean }>(
      `({ thr: __bh.camera.pilot.throttle, flaps: __bh.camera.airFlight.cfg.flaps, to: !!__bh.camera.a320To })`,
    );
    console.log(`  2. easy take-off asked: ${JSON.stringify(s0)}`);
    expect(s0.to).toBeTrue();
    expect(s0.thr).toBeGreaterThan(0.9);
    await app.waitFor("!__bh.camera.rolling && !__bh.camera.ourLanded", 90_000);
    console.log("  3. off the ground");
    await app.shot(`${DIR}/liftoff.png`);
    await app.waitFor("(__bh.camera.a320FmgcIn?.ra ?? 0) > 1600", 120_000);
    await app.waitFor("__bh.camera.airFlight.cfg.flaps === 0", 120_000);
    const s1 = await app.js<{ gear: boolean; ap: boolean; athr: boolean; thr: number; fma: unknown; fail: string | null }>(`(() => {
      const c = __bh.camera, F = c.a320Fmgc;
      return { gear: c.gearDown, ap: F.ap, athr: F.athr, thr: c.pilot.throttle, fma: F.fma(), fail: c.airFlight.failure };
    })()`);
    console.log(`  4. climbing: ${JSON.stringify(s1)}`);
    await app.shot(`${DIR}/climb.png`);
    expect(s1.fail).toBeNull();
    expect(s1.gear).toBeFalse();
    expect(s1.ap).toBeTrue();
    expect(s1.athr).toBeTrue();
    expect(s1.thr).toBeCloseTo(0.6, 2);
  }, 400_000);

  test("FCU ▸ Altitude ▸ +1000 ft, then pulled from the wheel: OP CLB", async () => {
    app.step("FCU ▸ Altitude from the wheel");
    const a0 = await app.js<number>("__bh.camera.a320Fmgc.alt");
    const alt = await app.js<number>("__bh.camera.a320FmgcIn.alt");
    // (the FCU's altitude set above the craft: + enough thousands)
    const n = Math.max(1, Math.ceil((alt + 2000 - a0) / 1000));
    for (let k = 0; k < n; k++) await choose("FCU", `Altitude ${await app.js<number>("__bh.camera.a320Fmgc.alt")}`, "+1000 ft");
    const a1 = await app.js<number>("__bh.camera.a320Fmgc.alt");
    await choose("FCU", `Altitude ${a1}`, "OP CLB / OP DES");
    const v = await app.js<string>("__bh.camera.a320Fmgc.vert");
    console.log(`  5. ALT ${a0} → ${a1} ft, pulled: ${v}`);
    expect(a1).toBeGreaterThan(alt);
    expect(v).toMatch(/OP CLB/);
  }, 120_000);

  test("Instruments ▸ ND range ×2: the deck's ND range doubled", async () => {
    app.step("Instruments ▸ ND range");
    const r0 = await app.js<number>(`Number(__bh.renderer.a320Deck["instrumentation/efis/inputs/range-nm"] ?? 40)`);
    await choose("Instruments", "ND: range ×2");
    const r1 = await app.js<number>(`Number(__bh.renderer.a320Deck["instrumentation/efis/inputs/range-nm"] ?? 40)`);
    console.log(`  6. ND range ${r0} → ${r1} NM`);
    expect(r1).toBe(Math.min(r0 * 2, 320));
    await app.shot(`${DIR}/nd.png`);
  }, 60_000);
});
