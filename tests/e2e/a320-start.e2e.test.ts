import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-A320 A10: the A320 started from cold and dark by the mouse, by real pointer events (CDP), from the captain's
// seat at Le Bourget — its systems FlightGear's (src/a320/systems): everything dark; BAT 1 and 2 (the overhead's lights
// on the batteries), the APU's MASTER and START (AVAIL a minute later, its generator: the displays lit), its bleed; the
// ENG MODE at IGN/START, ENG 1 then ENG 2 MASTER ON: each engine's starter, its fuel, idle — the IDGs' AC 1 and 2.

const shots = process.env.E2E_SHOTS;
const shot = (app: App, name: string) => (shots ? app.shot(`${shots}/${name}.png`) : Promise.resolve());

describe.skipIf(!E2E)("the A320 started from cold and dark", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(() => {
      __bh.settings.vessel = "a320";
      __bh.settings.a320Start = "cold";
      __bh.refresh();
      __bh.game.lineUp("Paris – Le Bourget");
      __bh.settings.shipMount = "cockpit";
      __bh.refresh();
      return true;
    })()`);
    await app.waitFor("!!__bh.renderer.ship.deckMats", 60_000);
    await app.waitFor(`!document.body.innerText.includes("Compiling the ray tracer")`, 240_000).catch(() => {});
    await app.waitFor("!!__bh.camera.a320Sys", 30_000);
    // (the deck's own maps in: the A320's colour array's seven layers)
    await app.waitFor("__bh.renderer.ship.a320Maps?.albedo?.depthOrArrayLayers === 7", 60_000);
    await Bun.sleep(2000);
  }, 400_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** The look turned to a control (its object's middle), and its place on the page [CSS px] — the canvas there. */
  const aim = async (what: string) => {
    const at = await app.js<{ p: number[] } | null>(`__bh.a320DeckAt(${JSON.stringify(what)})`);
    expect(at).not.toBeNull();
    const eye = [0.45, 3.22, 16.193];
    const d = at!.p.map((x, k) => x - eye[k]!);
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
    expect(r).not.toBeNull();
    expect(r!.top).toBe("CANVAS");
    return r!;
  };
  const click = async (what: string) => {
    const p = await aim(what);
    await app.mouse("move", p.x - 2, p.y);
    await app.mouse("move", p.x, p.y);
    await Bun.sleep(150);
    // (the pointer over that control: its tip's)
    const over = await app.js<string | null>(`(() => {
      const id = __bh.camera.cockpit.input.hover, c = __bh.renderer.ship.a320DeckMesh.controls[id ?? -1];
      return c ? c.label ?? c.objects[0] : null;
    })()`);
    expect(over, what).toBe(what);
    await app.mouse("down", p.x, p.y);
    await app.mouse("up", p.x, p.y);
    await Bun.sleep(300);
  };
  const prop = (k: string) => app.js<number>(`Number(__bh.camera.a320Props[${JSON.stringify(k)}] ?? 0)`);
  const bus = (b: string) => prop(`systems/electrical/bus/${b}`);
  /** a display's canvas lit (its middle rows: pixels not black) */
  const lit = (n: string) =>
    app.js<number>(`(() => {
      const x = __bh.renderer.a320Du.canvasOf(${JSON.stringify(n)}).getContext("2d").getImageData(0, 300, 1024, 424).data;
      let k = 0; for (let i = 0; i < x.length; i += 16) if (x[i] + x[i + 1] + x[i + 2] > 60) k++;
      return k;
    })()`);
  const until = async (what: string, s: number) => {
    const t0 = Date.now();
    await app.waitFor(what, s * 1000);
    return (Date.now() - t0) / 1000;
  };

  test("cold and dark: the buses dead, the engines stopped, the displays black", async () => {
    expect(await bus("dc-bat")).toBeLessThan(5);
    expect(await bus("ac-ess")).toBeLessThan(5);
    expect(await app.js<boolean>(`__bh.camera.a320.engines.some((e) => e.running)`)).toBeFalse();
    await Bun.sleep(1500);
    expect(await lit("PFD1")).toBeLessThan(50);
    await app.js(`(__bh.camera.setLook(0, -10), true)`);
    await Bun.sleep(1200);
    await shot(app, "a320-start-cold");
  }, 60_000);

  test("BAT 1 and 2, the APU: AVAIL, its generator, the displays lit", async () => {
    await click("Connect battery 1 to busses");
    await click("Connect battery 2 to busses");
    expect(await prop("controls/electrical/switches/bat-1")).toBe(1);
    await Bun.sleep(2000);
    expect(await bus("dc-bat")).toBeGreaterThan(25);
    await click("APU master switch");
    expect(await prop("controls/apu/master")).toBe(1);
    await Bun.sleep(4000);
    await click("APU start switch");
    await app.js(`(__bh.camera.setLook(-15, 62), true)`);
    await Bun.sleep(1500);
    await shot(app, "a320-start-apu-starting");
    const t = await until(`Number(__bh.camera.a320Props["systems/apu/available"]) === 1`, 150);
    console.log(`  APU AVAIL ${t.toFixed(0)} s after START`);
    await Bun.sleep(4000);
    expect(await bus("ac-1")).toBeGreaterThan(100);
    expect(await bus("ac-ess")).toBeGreaterThan(100);
    await click("APU bleed pushbutton");
    expect(await prop("controls/pneumatics/switches/apu")).toBe(1);
    await Bun.sleep(2500);
    for (const n of ["PFD1", "UECAM", "LECAM"]) expect(await lit(n), n).toBeGreaterThan(200);
    await app.js(`(__bh.camera.setLook(0, -10), true)`);
    await Bun.sleep(1500);
    await shot(app, "a320-start-apu");
  }, 240_000);

  test("ENG MODE IGN/START, ENG 1 then 2 MASTER ON: idle, AC 1 and 2 from the IDGs", async () => {
    // (the selector turned to IGN/START: its wheel, a notch)
    const m = await aim("Engine mode selector");
    await app.mouse("move", m.x, m.y);
    await Bun.sleep(150);
    for (let k = 0; k < 3 && (await prop("controls/ignition/start-sw")) !== 2; k++) {
      await app.mouse("wheel", m.x, m.y, { deltaY: -50 });
      await Bun.sleep(300);
    }
    expect(await prop("controls/ignition/start-sw")).toBe(2);
    for (const [k, sw] of [
      [0, "Left engine cutoff"],
      [1, "Right engine cutoff"],
    ] as const) {
      await click(sw);
      expect(await app.js<string>(`document.querySelector("[data-testid=cockpit-tip]").textContent`)).not.toContain("Not wired");
      expect(await prop(`controls/engines/engine${k ? "[1]" : ""}/cutoff-switch`)).toBe(0);
      await Bun.sleep(8000);
      if (k === 0) {
        await app.js(`(__bh.camera.setLook(0, -18), true)`);
        await Bun.sleep(800);
        await shot(app, "a320-start-eng1-cranking");
      }
      const t = await until(`__bh.camera.a320.engines[${k}].running`, 150);
      console.log(`  ENG ${k + 1} at idle ${(t + 8).toFixed(0)} s after its MASTER`);
    }
    await Bun.sleep(3000);
    expect(await prop("engines/engine/state")).toBe(3);
    expect(await prop("engines/engine[1]/state")).toBe(3);
    expect(await bus("ac-2")).toBeGreaterThan(100);
    expect(await prop("systems/hydraulic/green-psi")).toBeGreaterThan(2500);
    await app.js(`(__bh.camera.setLook(0, -18), true)`);
    await Bun.sleep(1500);
    await shot(app, "a320-start-engines");
  }, 400_000);
});
