import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-A320 A11: the A320's ECAM and failures in the game, by real pointer events (CDP), from the captain's seat at Le
// Bourget, the engines running: an engine fire injected from the tablet's Systems page — the master warning lit, ENG 1
// FIRE and its procedure on the E/WD, the SD's ENG page —; the procedure flown with the mouse — the master warning
// cancelled, ENG MASTER 1 OFF (its line gone), the fire pushbutton, agent 1 —; a checklist's item shown on the deck.

const shots = process.env.E2E_SHOTS;
const shot = (app: App, name: string) => (shots ? app.shot(`${shots}/${name}.png`) : Promise.resolve());

describe.skipIf(!E2E)("the A320's ECAM and its failures", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(() => {
      __bh.settings.vessel = "a320";
      __bh.settings.a320Start = "ready";
      __bh.refresh();
      __bh.game.lineUp("Paris – Le Bourget");
      __bh.settings.shipMount = "cockpit";
      __bh.refresh();
      return true;
    })()`);
    await app.waitFor("!!__bh.renderer.ship.deckMats", 60_000);
    await app.waitFor(`!document.body.innerText.includes("Compiling the ray tracer")`, 240_000).catch(() => {});
    await app.waitFor("!!__bh.camera.a320Ecam", 30_000);
    await app.waitFor("__bh.renderer.ship.a320Maps?.albedo?.depthOrArrayLayers === 7", 60_000);
    await Bun.sleep(2000);
  }, 400_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** The look turned to a control, and its place on the page [CSS px]. */
  const aim = async (what: string) => {
    const at = await app.js<{ p: number[] } | null>(`__bh.a320DeckAt(${JSON.stringify(what)})`);
    expect(at, what).not.toBeNull();
    const eye = [0.45, 3.22, 16.193];
    const d = at!.p.map((x, k) => x - eye[k]!);
    const yaw = (Math.atan2(-d[0]!, d[2]!) * 180) / Math.PI;
    const pitch = (Math.atan2(d[1]!, Math.hypot(d[0]!, d[2]!)) * 180) / Math.PI + 12;
    await app.js(`(__bh.camera.setLook(${yaw}, ${pitch}), true)`);
    await Bun.sleep(700);
    const r = await app.js<{ x: number; y: number } | null>(`(() => {
      const n = __bh.a320DeckAt(${JSON.stringify(what)})?.ndc;
      if (!n) return null;
      const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const b = c.getBoundingClientRect();
      return { x: b.left + (n[0] + 1) / 2 * b.width, y: b.top + (1 - n[1]) / 2 * b.height };
    })()`);
    expect(r).not.toBeNull();
    return r!;
  };
  const click = async (what: string) => {
    const p = await aim(what);
    await app.mouse("move", p.x - 2, p.y);
    await app.mouse("move", p.x, p.y);
    await Bun.sleep(150);
    const over = await app.js<string | null>(`(() => {
      const id = __bh.camera.cockpit.input.hover, c = __bh.renderer.ship.a320DeckMesh.controls[id ?? -1];
      return c ? c.label || c.objects[0] : null;
    })()`);
    expect(over, what).toBe(what);
    await app.mouse("down", p.x, p.y);
    await app.mouse("up", p.x, p.y);
    await Bun.sleep(400);
  };
  const prop = (k: string) => app.js<number>(`Number(__bh.camera.a320Props[${JSON.stringify(k)}] ?? 0)`);
  const ewd = () => app.js<string[]>(`__bh.camera.a320Ecam.left().map((l) => l.colour + ":" + l.text.trim())`);
  /** a select of the tablet's set (its change event) */
  const choose = (testid: string, value: string) =>
    app.js(`(() => {
      const s = document.querySelector("[data-testid=${testid}]");
      s.value = ${JSON.stringify(value)};
      s.dispatchEvent(new Event("change"));
      return s.value;
    })()`);

  test("an engine fire from the tablet: the master warning, ENG 1 FIRE and its procedure, the ENG page", async () => {
    expect(await app.js<boolean>(`__bh.camera.a320Ecam.masterWarning`)).toBeFalse();
    await app.press("KeyM");
    await app.click("[data-testid=tablet-systems]");
    await app.waitFor(`!!document.querySelector("[data-testid=a320-page]")`, 5000);
    await choose("a320-fail-cat", "fire");
    await choose("a320-fail", "eng1-fire");
    await choose("a320-fail-when", "now");
    await shot(app, "a320-ecam-tablet");
    await app.click("[data-testid=a320-fail-arm]");
    // (the detection loops: some seconds — fire.nas)
    await app.waitFor(`__bh.camera.a320Ecam.masterWarning`, 30_000);
    await app.press("KeyM");
    const L = await ewd();
    console.log(`  E/WD: ${L.join(" | ")}`);
    expect(L[0]).toBe("r:ENG 1 FIRE");
    expect(L.some((l) => l.includes("ENG MASTER 1") && l.startsWith("c:"))).toBeTrue();
    expect(await prop("ECAM/warnings/master-warning-light")).toBe(1);
    expect(await app.js<string | null>(`__bh.camera.a320Ecam.sdPage`)).toBe("enginePage");
    await app.js(`(__bh.camera.setLook(0, -14), true)`);
    await Bun.sleep(1500);
    await shot(app, "a320-ecam-fire");
  }, 120_000);

  test("the procedure by the mouse: the master warning cancelled, ENG MASTER 1 OFF, the fire pushbutton, agent 1", async () => {
    await click("Cancel warning");
    expect(await prop("ECAM/warnings/master-warning-light")).toBe(0);
    // (the master switch lifted and pulled down: its knob's "decrease" — the wheel down)
    const sw = await aim("Left engine cutoff");
    await app.mouse("move", sw.x, sw.y);
    await Bun.sleep(150);
    await app.mouse("wheel", sw.x, sw.y, { deltaY: 50 });
    await Bun.sleep(400);
    expect(await prop("controls/engines/engine/cutoff-switch")).toBe(1);
    await Bun.sleep(1500);
    const L = await ewd();
    console.log(`  after ENG MASTER 1 OFF: ${L.join(" | ")}`);
    expect(L.some((l) => l.includes("ENG MASTER 1"))).toBeFalse();
    expect(await app.js<boolean>(`__bh.camera.a320.engines[0].running`)).toBeFalse();
    // (the fire pushbutton under its guard, then agent 1)
    await click("Engine 1 Fire Cover");
    await click("Engine 1 Fire Pushbutton");
    expect(await prop("controls/engines/engine/fire-btn")).toBe(1);
    await click("Eng1FireAgt1Btn1S");
    await Bun.sleep(2500);
    const L2 = await ewd();
    console.log(`  after the fire pushbutton and agent 1: ${L2.join(" | ")}`);
    expect(L2.some((l) => l.includes("FIRE P/B"))).toBeFalse();
    await app.js(`(__bh.camera.setLook(-10, 55), true)`);
    await Bun.sleep(1500);
    await shot(app, "a320-ecam-fire-panel");
  }, 120_000);

  test("a checklist's item shown on the deck: its ring over the control", async () => {
    await app.js(`(__bh.camera.a320Fail.clearAll(__bh.camera.a320Props), true)`);
    await app.js(`(__bh.camera.setLook(0, -10), true)`);
    await app.press("KeyM");
    await app.click("[data-testid=tablet-systems]");
    await choose("a320-checklist", "Procedures|0");
    // (Power-On's ENG MODE: its eye)
    const shown = await app.js<boolean>(`(() => {
      const rows = [...document.querySelectorAll("[data-testid=a320-page] .sy-step")];
      const r = rows.find((x) => x.textContent.startsWith("ENG MODE"));
      r?.querySelector(".sy-eye")?.click();
      return !!r;
    })()`);
    expect(shown).toBeTrue();
    await app.press("KeyM");
    await aim("Engine mode selector");
    await Bun.sleep(1200);
    const m = await app.js<{ shown: boolean; x: number; y: number }>(`(() => {
      const e = document.querySelector("[data-testid=deck-marker]"), r = e.getBoundingClientRect();
      return { shown: getComputedStyle(e).display !== "none", x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    console.log(`  the ring at ${m.x.toFixed(0)}, ${m.y.toFixed(0)}`);
    expect(m.shown).toBeTrue();
    await shot(app, "a320-checklist-marker");
  }, 60_000);
});
