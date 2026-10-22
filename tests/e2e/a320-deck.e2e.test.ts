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
});
