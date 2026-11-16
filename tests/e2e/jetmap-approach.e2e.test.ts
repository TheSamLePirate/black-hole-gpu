import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { HELD } from "./lib/held";
import { expectFlightPhase } from "./lib/flight-state";

// The approaches on the tactical map (docs/PLAN-APPROCHES.md AP4), real input (CDP): the F-35 flying towards Marseille from the
// south-east; LFML clicked on the map — its card: the automatic choice and why, each runway end with the wind on it and its
// approaches (« ILS 31R · 111.15 · 4.0° · CAT I · nav.dat 2013 »…) —; its ILS 31R chosen on the card: drawn (its cone, its fixes,
// its missed approach); another approach chosen by a click on its axis drawn faint, then the 31R again; armed from the card: the
// autopilot flies that one (31R), its join drawn magenta from the craft; the vertical profile under the map.
//
// Done when: the card lists I31R and says the automatic choice; the chip chooses I31R (approachState) and the map draws it (its
// parts to click); a click on another approach's axis chooses it, a click on 31R's again; « Arm the approach » engages the ILS on
// 31R (ilsRun, approachLast I31R) and the map draws it engaged with its join; the profile shown.
// Duration: about 1 min 30 (the boot, the F-35 placed, the map's tiles; clicks and two seconds of flight).

describe.skipIf(!E2E)("the approaches on the tactical map", () => {
  let a: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await a.shot(`${shots}/${name}.png`);
  };
  const box = (sel: string) =>
    a.js<{ x: number; y: number; w: number; h: number } | null>(
      `(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; })()`,
    );
  /** a real click at a point of the map's canvas [its CSS px] */
  const clickMap = async (x: number, y: number) => {
    const m = (await box("[data-testid=jetmap] canvas"))!;
    await a.mouse("move", m.x + x, m.y + y);
    await a.mouse("down", m.x + x, m.y + y);
    await a.mouse("up", m.x + x, m.y + y);
    await Bun.sleep(250);
  };
  const hits = () => a.js<{ approach?: string; rwy?: string; x: number; y: number }[]>(`__bh.flight.hud.tacMap.approachHitsNow()`);
  beforeAll(async () => {
    a = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await a.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, damage: false, weather: "fair", wind: 0 }); return 1; })()`,
    );
    await a.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    // (35 km south-east of Marseille, flying north-west at 2 000 m; the autopilot holding it)
    await a.js(`(() => { __bh.game.flyAt(43.21, 5.53, 2000, 305, 170); ${HELD} const c = __bh.camera;
      __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await a.waitFor(`!!__bh.camera.geoNow() && __bh.camera.geoNow().gs > 100`, 15_000);
    // (rule 13 of E2E-VOLS: placed as a pilot leaves it — its holds, its thrust, its gear — asserted)
    await expectFlightPhase(a, "cruise", {}, "placed");
    await a.js(`(() => { const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
      __bh.camera.approachSelect({ field: "auto" }); const m = __bh.flight.hud.tacMap; m.range = 4; m.northUp = true; return 1; })()`);
    await a.waitFor(`!!document.querySelector("[data-testid=jetmap]")?.getBoundingClientRect().width`, 20_000);
    // (the map made large — its top-left corner dragged, as a player would — to read it on the captures)
    const g = (await box("[data-testid=map-grip]"))!;
    await a.mouse("move", g.x + 6, g.y + 6);
    await a.mouse("down", g.x + 6, g.y + 6);
    for (let k = 1; k <= 10; k++) await a.mouse("move", g.x + 6 - 45 * k, g.y + 6 - 35 * k);
    await a.mouse("up", g.x + 6 - 450, g.y + 6 - 350);
    await Bun.sleep(300);
    // (Marseille's approaches in: the card lists them)
    await a.js(`__bh.sys.approaches("LFML").then((l) => l.length)`);
    await a.waitFor(`__bh.flight.hud.tacMap.fieldHitsNow().some((h) => h.code === "LFML")`, 30_000);
  }, 300_000);
  afterAll(() => {
    a?.close();
    stopServer();
  });

  test("LFML's card: the automatic choice, each end's wind and approaches; its ILS 31R chosen and drawn", async () => {
    const h = await a.js<{ x: number; y: number }>(`__bh.flight.hud.tacMap.fieldHitsNow().find((h) => h.code === "LFML")`);
    await clickMap(h.x, h.y);
    await a.waitFor(`!document.querySelector("[data-testid=jm-card]").hidden`, 3000);
    const card = await a.js<string>(`document.querySelector("[data-testid=jm-card]").innerText`);
    console.log(`  LFML's card:\n    ${card.split("\n").slice(0, 14).join("\n    ")}`);
    expect(card).toMatch(/Auto/);
    expect(card).toMatch(/ILS 31R · 111\.15 · 4\.0° · CAT I/);
    await shot("jetmap-approach-card");
    await a.click(`[data-testid=jm-appr-I31R]`);
    await a.waitFor(`__bh.camera.approachState().sel.approach === "I31R"`, 3000);
    await a.waitFor(`__bh.flight.hud.tacMap.approachHitsNow().some((h) => h.approach === "I31R")`, 5000);
    await a.js(`(() => { document.querySelector("[data-testid=jm-card]").hidden = true; return 1; })()`);
    await Bun.sleep(400);
    await shot("jetmap-approach-chosen");
  }, 60_000);

  test("another approach chosen by a click on its axis, then the 31R again by its own", async () => {
    const H = await hits();
    const other = H.find((x) => x.approach && x.approach !== "I31R");
    console.log(
      `  the approaches to click: ${H.filter((x) => x.approach)
        .map((x) => x.approach)
        .join(" ")}`,
    );
    expect(other).toBeTruthy();
    await clickMap(other!.x, other!.y);
    await a.waitFor(`__bh.camera.approachState().sel.approach === ${JSON.stringify(other!.approach)}`, 3000);
    const back = (await hits()).find((x) => x.approach === "I31R")!;
    await clickMap(back.x, back.y);
    await a.waitFor(`__bh.camera.approachState().sel.approach === "I31R"`, 3000);
  }, 30_000);

  test("armed from the card: the autopilot flies the 31R, its join drawn engaged; the vertical profile", async () => {
    const h = await a.js<{ x: number; y: number }>(`__bh.flight.hud.tacMap.fieldHitsNow().find((h) => h.code === "LFML")`);
    await clickMap(h.x, h.y);
    await a.waitFor(`!document.querySelector("[data-testid=jm-card]").hidden`, 3000);
    await a.click(`[data-testid=jm-arm]`);
    await a.waitFor(`!!__bh.camera.ilsRun`, 5000);
    await a.waitFor(`!!__bh.camera.ilsRun?.join`, 5000);
    const r = await a.js<{ rwy: string; id: string; engaged: boolean; join: number }>(`(() => { const m = __bh.camera.approachMapData();
      return { rwy: __bh.camera.ilsRun.rwy.des, id: __bh.camera.approachLast.approach.id, engaged: m.engaged, join: m.join.length }; })()`);
    console.log(`  armed: ${JSON.stringify(r)}`);
    expect(r).toMatchObject({ rwy: "31R", id: "I31R", engaged: true });
    await a.click(`[data-testid=jm-prof]`);
    expect(await a.js<boolean>(`__bh.flight.hud.tacMap.profile`)).toBe(true);
    await Bun.sleep(1500);
    await shot("jetmap-approach-armed");
    await a.click(`[data-testid=jm-prof]`);
    await a.js(`(() => { __bh.camera.ilsOff(); __bh.camera.approachSelect({ field: "auto" }); return 1; })()`);
  }, 60_000);
});
