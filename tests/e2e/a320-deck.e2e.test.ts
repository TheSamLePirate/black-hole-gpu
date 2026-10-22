import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-A320 A6: the A320's flight deck worked with the mouse, by real pointer events (CDP), from the captain's seat
// lined up at Le Bourget — over a control its tip names it (FlightGear's label, in French); a click on the strobe
// switch lights the strobes, the wheel puts it back; the autobrake's MED button arms the autobrake; the parking brake's
// handle sets it; the flap lever turned a notch; the thrust levers dragged forward; the annunciators' test switch.

/** where the shots go (E2E_SHOTS=dir; none: not taken) */
const shots = process.env.E2E_SHOTS;
const shot = (app: App, name: string) => (shots ? app.shot(`${shots}/${name}.png`) : Promise.resolve());

describe.skipIf(!E2E)("the A320's flight deck by the mouse", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(() => {
      __bh.settings.vessel = "a320";
      __bh.refresh();
      __bh.game.lineUp("Paris – Le Bourget");
      __bh.settings.shipMount = "cockpit";
      __bh.refresh();
      return true;
    })()`);
    // (the deck's mesh and maps loaded, drawn; the tracer compiled)
    await app.waitFor("!!__bh.renderer.ship.deckMats", 60_000);
    await app.waitFor(`!document.body.innerText.includes("Compiling the ray tracer")`, 240_000).catch(() => {});
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
    // (the ship's x the left; the seat's look 12° down)
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
  const click = async (p: { x: number; y: number }) => {
    await app.mouse("move", p.x - 2, p.y);
    await app.mouse("move", p.x, p.y);
    await app.mouse("down", p.x, p.y);
    await app.mouse("up", p.x, p.y);
    await Bun.sleep(200);
  };
  const label = (id: string | null) =>
    app.js<string | null>(
      `(() => { const c = __bh.renderer.ship.a320DeckMesh.controls[${id ?? -1}]; return c ? c.label ?? c.objects[0] : null; })()`,
    );

  test("the strobe switch: hovered, named; clicked on; the wheel off", async () => {
    const p = await aim("Strobe lights switch");
    await app.mouse("move", p.x - 2, p.y);
    await app.mouse("move", p.x, p.y);
    await Bun.sleep(200);
    const h = await app.js<{ hover: string | null; tip: string; shown: boolean }>(`({
      hover: __bh.camera.cockpit.input.hover,
      tip: document.querySelector("[data-testid=cockpit-tip]").textContent,
      shown: document.querySelector("[data-testid=cockpit-tip]").style.display !== "none",
    })`);
    expect(await label(h.hover)).toBe("Strobe lights switch");
    expect(h.shown).toBeTrue();
    expect(h.tip.length).toBeGreaterThan(3);
    await app.js(`(__bh.settings.strobeLights = false, true)`);
    await Bun.sleep(200);
    await click(p);
    expect(await app.js<boolean>(`__bh.settings.strobeLights`)).toBeTrue();
    await app.mouse("wheel", p.x, p.y, { deltaY: 50 });
    await Bun.sleep(200);
    expect(await app.js<boolean>(`__bh.settings.strobeLights`)).toBeFalse();
    await shot(app, "a320-deck-strobe");
  }, 60_000);

  test("the autobrake's MED button, the parking brake", async () => {
    await click(await aim("Autobrake Medium"));
    expect(await app.js<number>(`__bh.camera.a320.autobrake`)).toBe(2);
    await click(await aim("Parking brake"));
    expect(await app.js<boolean>(`__bh.camera.a320Park`)).toBeTrue();
    await shot(app, "a320-deck-autobrake");
  }, 60_000);

  test("the flap lever a notch down by the wheel, the thrust levers dragged forward", async () => {
    const f = await aim("Flaps");
    await app.mouse("move", f.x, f.y);
    await Bun.sleep(150);
    await app.mouse("wheel", f.x, f.y, { deltaY: 50 });
    await Bun.sleep(250);
    expect(await app.js<number>(`__bh.camera.airFlight.cfg.flaps`)).toBeCloseTo(0.25, 6);
    const t = await aim("Engine 1 throttle");
    await app.mouse("move", t.x, t.y);
    await app.mouse("down", t.x, t.y);
    for (let i = 1; i <= 10; i++) await app.mouse("move", t.x, t.y - 6 * i);
    await app.mouse("up", t.x, t.y - 60);
    const thr = await app.js<number>(`__bh.camera.pilot.throttle`);
    expect(thr).toBeGreaterThan(0.05);
    await app.js(`(__bh.camera.pilot.throttle = 0, true)`);
  }, 60_000);

  test("the annunciators' test: every light of the overhead on", async () => {
    await click(await aim("Annunciator light test switch"));
    expect(await app.js<number>(`__bh.renderer.a320Deck["controls/switches/annun-test"]`)).toBe(1);
    await app.js(`(__bh.camera.setLook(-15, 62), true)`);
    await Bun.sleep(1500);
    await shot(app, "a320-deck-annun-test");
  }, 60_000);

  test("the displays (A7): each drawn, lit, the ND's range knob read", async () => {
    // (every display drawn in the last seconds: its canvas's middle row not all black)
    await Bun.sleep(3000);
    const lit = await app.js<Record<string, number>>(`(() => {
      const D = __bh.renderer.a320Du, out = {};
      for (const n of ["PFD1", "PFD2", "ND1", "ND2", "UECAM", "LECAM", "IESI"]) {
        const c = D.canvasOf(n), x = c.getContext("2d").getImageData(0, 400, 1024, 224).data;
        let k = 0; for (let i = 0; i < x.length; i += 16) if (x[i] + x[i + 1] + x[i + 2] > 60) k++;
        out[n] = k;
      }
      return out;
    })()`);
    for (const [n, k] of Object.entries(lit)) expect(k, n).toBeGreaterThan(200);
    // (the ND's range a notch out by the deck's knob — fcu.setNDRange)
    const r0 = await app.js<number>(`__bh.renderer.a320Deck["instrumentation/efis/inputs/range-nm"]`);
    const k = await aim("ND range");
    await app.mouse("move", k.x, k.y);
    await Bun.sleep(150);
    await app.mouse("wheel", k.x, k.y, { deltaY: -50 });
    await Bun.sleep(300);
    expect(await app.js<number>(`__bh.renderer.a320Deck["instrumentation/efis/inputs/range-nm"]`)).toBe(r0 * 2);
    await app.js(`(__bh.camera.setLook(10, -12), true)`);
    await Bun.sleep(1500);
    await shot(app, "a320-deck-displays");
  }, 60_000);

  test("the FCU (A8): the A/THR button, the speed knob turned then pulled, its window", async () => {
    // (on the ground: the A/THR armed by its button; the speed knob's wheel preselects, its pull selects)
    await app.js(`(__bh.camera.a320Fmgc && (__bh.camera.a320Fmgc.athr = false), true)`);
    await click(await aim("a-thr"));
    expect(await app.js<boolean>(`__bh.camera.a320Fmgc.athr`)).toBeTrue();
    const k = await aim("spd-sel");
    await app.mouse("move", k.x, k.y);
    await Bun.sleep(150);
    const s0 = await app.js<number>(`__bh.camera.a320Fmgc.spd`);
    for (let n = 0; n < 4; n++) await app.mouse("wheel", k.x, k.y, { deltaY: -50 });
    await Bun.sleep(200);
    expect(await app.js<number>(`__bh.camera.a320Fmgc.spd`)).toBe(s0 + 4);
    // (the window shows it: the deck's property)
    await Bun.sleep(600);
    expect(await app.js<number>(`__bh.renderer.a320Deck["it-autoflight/input/kts-display"]`)).toBe(s0 + 4);
    expect(await app.js<number>(`__bh.renderer.a320Deck["it-autoflight/custom/show-spd"]`)).toBe(1);
    await shot(app, "a320-deck-fcu");
  }, 60_000);

  test("the MCDU (A9): INIT, FROM/TO typed on its keys, the plan built", async () => {
    await click(await aim("init.cpt"));
    for (const k of "LFPG/EGLL") await click(await aim(k === "/" ? "/.cpt" : `${k.toLowerCase()}.cpt`));
    await click(await aim("R1.cpt"));
    await Bun.sleep(300);
    const wps = await app.js<string[]>(`__bh.camera.nav.route.wps.map((w) => w.name)`);
    expect(wps[0]).toBe("LFPG");
    expect(wps.at(-1)).toBe("EGLL");
    expect(await app.js<string | null>(`__bh.camera.a320Fmgc.fms.to`)).toBe("EGLL");
    // (the MCDU's screen drawn: its canvas lit)
    const lit = await app.js<number>(`(() => {
      const x = __bh.renderer.a320Du.canvasOf("MCDU1").getContext("2d").getImageData(0, 0, 1024, 864).data;
      let k = 0; for (let i = 0; i < x.length; i += 64) if (x[i] + x[i + 1] + x[i + 2] > 120) k++;
      return k;
    })()`);
    expect(lit).toBeGreaterThan(300);
    await app.js(`(__bh.camera.setLook(30, -38), __bh.settings.fov = 40, true)`);
    await Bun.sleep(1500);
    await shot(app, "a320-deck-mcdu");
  }, 120_000);
});
