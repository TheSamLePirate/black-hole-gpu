import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The wheel's « Approach » sector (docs/PLAN-APPROCHES.md AP8, ui/approach-wheel.ts), by real input (DevTools key and mouse events,
// E2E.md): the F-35 towards Marseille, Tab held — the wheel —, the pointer on « Approach », Tab released: its sector. There the
// automatic choice said (« Auto — LFMA 32 built », the nearest ahead); « Airfield » › LFML chosen; « Runway (LFML) » › 31R; « Approach » › ILS 31R; « Arm the
// approach »: the ILS on 31R flown; « Displays » › all the runways off, then on; « Go around »: the missed approach; « Disarm ». (The
// Labo's tail-wind limit is checked without a browser: tests/approach-choice.test.ts.)
//
// Done when: each pick changes the pilot's state as the map's, the crew's and TARS's do — approachSel LFML / 31R / I31R, the ILS
// engaged on 31R, hudAllRunways flipped by the wheel, a missed approach counted after « Go around » (and the round again); the captures taken.
// Duration: about 1 min 30 (the boot with the relief's tiles, the F-35 placed; some ten wheel picks).

describe.skipIf(!E2E)("the wheel's Approach sector", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const tab = { code: "Tab", key: "Tab", windowsVirtualKeyCode: 9 };
  /** The wheel's labels now (their text, the ▸ of a sub-wheel kept). */
  const labels = () => app.js<string[]>(`[...document.querySelectorAll("[data-testid=wheel] .rw-label b")].map((b) => b.textContent)`);
  /** The pointer on the label matching `re`, a real click: its item done (a sub-wheel opened). */
  const pick = async (re: RegExp) => {
    const L = await labels();
    const i = L.findIndex((l) => re.test(l));
    if (i < 0) throw new Error(`no ${re} in the wheel: ${L.join(" | ")}`);
    const p = await app.js<{ x: number; y: number }>(
      `(() => { const r = document.querySelectorAll("[data-testid=wheel] .rw-label")[${i}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    );
    await app.mouse("move", p.x, p.y);
    await Bun.sleep(80);
    await app.mouse("down", p.x, p.y);
    await app.mouse("up", p.x, p.y);
    await Bun.sleep(150);
  };
  /** Tab held, the pointer on « Approach », Tab released: its sector open. */
  const openApproach = async () => {
    const [w, h] = await app.js<[number, number]>("[innerWidth, innerHeight]");
    // (a wheel left open by a failed step: closed first)
    for (let k = 0; k < 4 && (await app.js<boolean>(`!!document.querySelector("[data-testid=wheel]")`)); k++) await app.press("Escape");
    await app.mouse("move", w / 2, h / 2);
    await app.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...tab });
    await app.waitFor(`!!document.querySelector("[data-testid=wheel]")`, 3000);
    const L = await labels();
    const i = L.findIndex((l) => /^(Approach|Approche) ▸/.test(l));
    if (i < 0) throw new Error(`no Approach sector: ${L.join(" | ")}`);
    const p = await app.js<{ x: number; y: number }>(
      `(() => { const r = document.querySelectorAll("[data-testid=wheel] .rw-label")[${i}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    );
    await app.mouse("move", p.x, p.y);
    await Bun.sleep(80);
    await app.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...tab });
    await app.waitFor(`[...document.querySelectorAll("[data-testid=wheel] .rw-label b")].some((b) => /^Auto/.test(b.textContent))`, 3000);
  };
  const closed = () => app.waitFor(`!document.querySelector("[data-testid=wheel]")`, 3000);

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, damage: false, weather: "fair", wind: 0, hudAllRunways: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(43.21, 5.53, 2000, 305, 170); __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await app.waitFor(`!!__bh.camera.geoNow() && __bh.camera.geoNow().gs > 100`, 15_000);
    await app.js(`(() => { const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
      c.approachSelect({ field: "auto" }); __bh.fleet.fuel.f35 = 6000; return 1; })()`);
    // (Marseille's field and approaches in: the automatic choice has its ILS to say)
    await app.js(`__bh.sys.approaches("LFML").then((l) => l.length)`);
    await app.waitFor(`(() => { const p = __bh.camera.approachPreview(); return !!p && p !== "loading" && !p.say; })()`, 15_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the sector: the automatic choice said; the airfield, the runway, the approach chosen; armed", async () => {
    await openApproach();
    const L = await labels();
    console.log(`  the sector: ${L.join(" | ")}`);
    // (the automatic choice said: the field the controller's rules give from here — LFMA's built 32 ahead of the F-35, 15 Nov 2026)
    expect(L[0]).toMatch(/^Auto — [A-Z0-9]{3,4} /);
    await shot("approach-wheel-sector");
    await pick(/^(Airfield|Terrain) ▸/);
    console.log(`  airfields: ${(await labels()).join(" | ")}`);
    await pick(/^LFML/);
    await closed();
    expect(await app.js<string>(`__bh.camera.approachSel.field`)).toBe("LFML");
    // (the runway)
    await openApproach();
    await pick(/^(Runway|Piste) \(LFML\) ▸/);
    console.log(`  ends: ${(await labels()).join(" | ")}`);
    await shot("approach-wheel-runways");
    await pick(/^31R$/);
    await closed();
    expect(await app.js<string>(`__bh.camera.approachSel.rwy`)).toBe("31R");
    // (the approach)
    await openApproach();
    await pick(/^(Approach|Approche) ▸/);
    console.log(`  approaches: ${(await labels()).join(" | ")}`);
    await pick(/^ILS 31R$/);
    await closed();
    expect(await app.js<string>(`__bh.camera.approachSel.approach`)).toBe("I31R");
    // (armed)
    await openApproach();
    await pick(/^(Arm the approach|Armer l'approche)$/);
    await closed();
    await app.waitFor(`!!__bh.camera.ilsRun`, 5000);
    expect(await app.js<string>(`__bh.camera.ilsRun.rwy.des`)).toBe("31R");
  }, 90_000);

  test("the displays flipped from the wheel; the go-around; disarmed", async () => {
    await openApproach();
    await pick(/^(Displays|Affichages) ▸/);
    await shot("approach-wheel-displays");
    await pick(/^(All the runways \(HUD\)|Toutes les pistes \(HUD\))$/);
    await closed();
    expect(await app.js<boolean>(`__bh.settings.hudAllRunways`)).toBe(false);
    await openApproach();
    await pick(/^(Displays|Affichages) ▸/);
    await pick(/^(All the runways \(HUD\)|Toutes les pistes \(HUD\))$/);
    await closed();
    expect(await app.js<boolean>(`__bh.settings.hudAllRunways`)).toBe(true);
    // (the go-around: the F-35's approach to its missed approach)
    await openApproach();
    await pick(/^(Go around|Remise de gaz)$/);
    await closed();
    // (counted as a missed approach; high already — over 600 m above the field —, it rounds again at once by a new join)
    const ga = await app.js<{ missed: number; phase: string }>(
      `({ missed: __bh.camera.ilsRun?.missed ?? 0, phase: String(__bh.camera.ilsRun?.phase) })`,
    );
    console.log(`  after the go-around: ${JSON.stringify(ga)}`);
    expect(ga.missed).toBe(1);
    expect(ga.phase).toMatch(/^(missed|toIaf)$/);
    await openApproach();
    await pick(/^(Disarm|Désarmer)$/);
    await closed();
    expect(await app.js<boolean>(`!!__bh.camera.ilsRun`)).toBe(false);
  }, 60_000);
});
