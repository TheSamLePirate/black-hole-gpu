import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-A320-VOL-AAA K1: the FCU's four knobs worked by the real mouse and keyboard, as FlightGear's A320 has them — the wheel
// turns, a click pushes (managed), Shift held and a click pulls (selected); the Shift held over a knob leaves the thrust levers
// where they were (Shift is the throttle-up key: before 26 Nov 2026 a Shift-click never reached the deck — it turned the look, a
// click always pushed — and the Shift held moved the levers). The A320 flying over the Paris region at 3 000 m by day, clear sky,
// AP1 on; each knob's mode read on the FMA (the FMGC's own state): ALT pulled → OP CLB, pushed → CLB; SPD pulled → selected,
// pushed → managed; HDG pulled → HDG; V/S pulled → V/S.
// Duration: ~2 min on kerr-mini.
// Done when: the V/S knob pulled, V/S on the FMA.

const DIR = "remote-results/a320-fcu-knobs";
mkdirSync(DIR, { recursive: true });

describe.skipIf(!E2E)("the A320's FCU knobs by the mouse: turned, pushed, pulled with Shift", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(() => {
      Object.assign(__bh.settings, { vessel: "a320", a320Start: "ready", traffic: false, weather: "fair", wind: 0, earthClouds: 0 });
      // (Paris's solar noon: by day)
      __bh.setDate(Date.UTC(2026, 10, 5, 12) - 2.44 * 240000);
      return true;
    })()`);
    await app.waitFor(`__bh.fleet.active === "a320"`, 30_000);
    await app.js(`(() => {
      __bh.game.flyAt(48.75, 2.2, 3000, 270, 128);
      const c = __bh.camera;
      c.gearDown = false; c.airFlight.cfg.flaps = 0; c.pilot.throttle = 0.6;
      __bh.settings.shipMount = "cockpit";
      __bh.refresh();
      return true;
    })()`);
    await app.waitFor("!!__bh.renderer.ship.deckMats", 60_000);
    await app.settled(60_000);
    // (the A320's AP engages 5 s after a lift-off: 6 s of flight as placed, on the sim's clock)
    const simS = "__bh.sim.time * 4.925490947e-6 * __bh.settings.massSolar";
    const t0 = await app.js<number>(simS);
    await app.waitFor(`${simS} > ${t0 + 6}`, 30_000);
    await app.js(
      `(() => { const c = __bh.camera; if (!c.a320Fmgc?.ap) c.a320ApKey("ap"); if (!c.a320Fmgc.athr) c.a320ApKey("athr"); return c.a320Fmgc.ap; })()`,
    );
    expect(await app.js<boolean>("__bh.camera.a320Fmgc.ap")).toBeTrue();
    console.log(`  1. in the air, AP1 on: ${await fma()}`);
  }, 400_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const fma = () =>
    app.js<string>(
      `(() => { const F = __bh.camera.a320Fmgc; return JSON.stringify({ vert: F.vert, lat: F.lat, spdManaged: F.spdManaged, alt: F.alt, hdg: F.hdg, spd: F.spd, vs: F.vs }); })()`,
    );

  /** The look turned to a control, its place on the page [CSS px] (a320-deck.e2e's aim). */
  const aim = async (name: string | RegExp) => {
    // (by its object's name, or by a pattern on FlightGear's label — « Scroll for heading … »: the HDG knob's object has another name)
    const what =
      typeof name === "string"
        ? name
        : ((await app.js<string | null>(
            `__bh.renderer.ship.a320DeckMesh.controls.map((c) => c.label ?? c.objects[0]).find((l) => ${name.toString()}.test(l)) ?? null`,
          )) ?? String(name));
    const at = await app.js<{ p: number[] } | null>(`__bh.a320DeckAt(${JSON.stringify(what)})`);
    if (!at) {
      const near = await app.js<string[]>(
        `__bh.renderer.ship.a320DeckMesh.controls.map((c) => c.label ?? c.objects[0]).filter((l) => /sel|spd|hdg|head|alt|vs|fcu/i.test(l)).slice(0, 80)`,
      );
      throw new Error(`no control "${what}" — near: ${near.join(", ")}`);
    }
    const eye = [0.45, 3.22, 16.193];
    const d = at.p.map((x, k) => x - eye[k]!);
    const yaw = (Math.atan2(-d[0]!, d[2]!) * 180) / Math.PI;
    const pitch = (Math.atan2(d[1]!, Math.hypot(d[0]!, d[2]!)) * 180) / Math.PI + 12;
    await app.js(`(__bh.camera.setLook(${yaw}, ${pitch}), true)`);
    await Bun.sleep(700);
    const r = await app.js<{ x: number; y: number; top: string } | null>(`(() => {
      const n = __bh.a320DeckAt(${JSON.stringify(what)})?.ndc;
      if (!n) return null;
      const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const b = c.getBoundingClientRect();
      const x = b.left + (n[0] + 1) / 2 * b.width, y = b.top + (1 - n[1]) / 2 * b.height;
      return { x, y, top: document.elementFromPoint(x, y)?.tagName ?? "" };
    })()`);
    expect(r?.top).toBe("CANVAS");
    await app.mouse("move", r!.x - 2, r!.y);
    await app.mouse("move", r!.x, r!.y);
    await Bun.sleep(200);
    return r!;
  };
  const click = async (p: { x: number; y: number }) => {
    await app.mouse("down", p.x, p.y);
    await app.mouse("up", p.x, p.y);
    await Bun.sleep(300);
  };
  /** Shift held (the real key, 400 ms: past the levers' 100 ms), a click with it, Shift let go; the levers before and after. */
  const shiftClick = async (p: { x: number; y: number }) => {
    const thr0 = await app.js<number>("__bh.camera.pilot.throttle");
    const ev = { code: "ShiftLeft", key: "Shift", windowsVirtualKeyCode: 16, modifiers: 8 };
    await app.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...ev });
    await Bun.sleep(400);
    await app.mouse("down", p.x, p.y, { shift: true });
    await app.mouse("up", p.x, p.y, { shift: true });
    await Bun.sleep(200);
    await app.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...ev, modifiers: 0 });
    await Bun.sleep(300);
    const thr1 = await app.js<number>("__bh.camera.pilot.throttle");
    return { thr0, thr1 };
  };
  const wheel = async (p: { x: number; y: number }, notches: number) => {
    for (let n = 0; n < Math.abs(notches); n++) await app.mouse("wheel", p.x, p.y, { deltaY: notches > 0 ? -50 : 50 });
    await Bun.sleep(300);
  };

  test("ALT: turned up 1 000 ft, pulled with Shift (OP CLB), pushed (CLB); the levers left where they were", async () => {
    const k = await aim("alt-sel");
    const a0 = await app.js<number>("__bh.camera.a320Fmgc.alt");
    // (the FCU's altitude turned 1 000 ft over the craft's: a climb)
    const here = await app.js<number>("__bh.camera.a320FmgcIn.alt");
    await wheel(k, Math.max(1, Math.ceil((here + 1000 - a0) / 100)));
    const a1 = await app.js<number>("__bh.camera.a320Fmgc.alt");
    console.log(`  2. ALT turned: ${a0} → ${a1} ft`);
    expect(a1).toBeGreaterThan(a0);
    const t = await shiftClick(k);
    console.log(`  3. ALT pulled with Shift: ${await fma()} · levers ${t.thr0} → ${t.thr1}`);
    expect(await app.js<string>("__bh.camera.a320Fmgc.vert")).toMatch(/OP CLB|EXP CLB/);
    expect(t.thr1).toBe(t.thr0);
    await app.shot(`${DIR}/alt-pulled.png`);
    await click(k);
    console.log(`  4. ALT pushed: ${await fma()}`);
    expect(await app.js<string>("__bh.camera.a320Fmgc.vert")).toMatch(/^(CLB|ALT)/);
  }, 90_000);

  test("SPD: pulled with Shift (selected), pushed (managed)", async () => {
    const k = await aim("spd-sel");
    await app.js(`(__bh.camera.a320Fmgc.spdManaged = true, true)`);
    await shiftClick(k);
    console.log(`  5. SPD pulled: ${await fma()}`);
    expect(await app.js<boolean>("__bh.camera.a320Fmgc.spdManaged")).toBeFalse();
    await click(k);
    console.log(`  6. SPD pushed: ${await fma()}`);
    expect(await app.js<boolean>("__bh.camera.a320Fmgc.spdManaged")).toBeTrue();
  }, 90_000);

  test("HDG: turned 20°, pulled with Shift: HDG on the FMA", async () => {
    const k = await aim(/^Scroll for (heading|hdg)/i);
    await wheel(k, 20);
    await shiftClick(k);
    console.log(`  7. HDG pulled: ${await fma()}`);
    expect(await app.js<string>("__bh.camera.a320Fmgc.lat")).toMatch(/HDG|TRK/);
    await app.shot(`${DIR}/hdg-pulled.png`);
  }, 90_000);

  test("V/S: pulled with Shift: V/S on the FMA", async () => {
    const k = await aim("vs-sel");
    await shiftClick(k);
    console.log(`  8. V/S pulled: ${await fma()}`);
    expect(await app.js<string>("__bh.camera.a320Fmgc.vert")).toMatch(/V\/S|FPA/);
    await app.shot(`${DIR}/vs-pulled.png`);
  }, 90_000);
});
