import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The approaches on the radars (docs/PLAN-APPROCHES.md AP5): the F-35 towards Marseille, its radar on; on the HUD's scope, by
// real clicks, LFML's dot — its approach chosen (automatic there) and drawn —, then another approach's axis — that one chosen —;
// on the panoramic display's TSD an approach's part touched — chosen too —, its header naming it; and what drawing it costs the
// HUD (its section of the main thread's time, the approach drawn and not, alternated — an A/A beside: indicative, the probe has no
// positive witness).
//
// Done when: the scope's LFML dot chooses LFML (approachState), its approach drawn there (its parts among the scope's hits); a
// click on another approach's axis chooses that one; a TSD touch on an approach's part chooses it; the A/B said (ms, % of the
// main loop's median).
// Duration: about 1 min 30 (the boot, the F-35 placed, the radar's first sweep; clicks; 24 s of alternated windows).

describe.skipIf(!E2E)("the approaches on the radars", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const hits = () => app.js<{ id: string; x: number; y: number; r: number }[]>(`__bh.radar.hits()`);
  const click = async (x: number, y: number) => {
    await app.mouse("move", x, y);
    await app.mouse("down", x, y);
    await app.mouse("up", x, y);
    await Bun.sleep(300);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, damage: false, weather: "fair", wind: 0 }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(43.21, 5.53, 2000, 305, 170); __bh.settings.shipMount = "cockpit";
      __bh.settings.f35Radar = true; __bh.settings.f35RadarRange = "80"; return 1; })()`);
    await app.waitFor(`!!__bh.camera.geoNow() && __bh.camera.geoNow().gs > 100`, 15_000);
    await app.js(`(() => { const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
      c.approachSelect({ field: "auto" }); c.nav.route.wps.length = 0; return 1; })()`);
    await app.js(`__bh.sys.approaches("LFML").then((l) => l.length)`);
    await app.waitFor(`__bh.radar.hits().some((h) => h.id === "field:LFML")`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("on the HUD's scope: LFML's dot clicked — its approach chosen and drawn —; another approach's axis clicked — chosen", async () => {
    const F = (await hits()).find((h) => h.id === "field:LFML")!;
    await click(F.x, F.y);
    await app.waitFor(`__bh.camera.approachState().sel.field === "LFML"`, 3000);
    await app.waitFor(`__bh.radar.hits().some((h) => h.id.startsWith("appr:"))`, 5000);
    const H = await hits();
    const drawn = await app.js<string>(`__bh.camera.approachMapData().id`);
    const appr = H.filter((h) => h.id.startsWith("appr:")).map((h) => h.id.slice(5));
    console.log(`  LFML chosen: drawn ${drawn}; the approaches to click: ${appr.join(" ")}`);
    await shot("radar-approach-scope");
    const other = H.find((h) => h.id.startsWith("appr:") && h.id !== `appr:${drawn}`);
    expect(other).toBeTruthy();
    await click(other!.x, other!.y);
    await app.waitFor(`__bh.camera.approachState().sel.approach === ${JSON.stringify(other!.id.slice(5))}`, 3000);
  }, 60_000);

  test("on the TSD: an approach's part touched — chosen; its header names it", async () => {
    await app.waitFor(`[...__bh.pcd.pcd.hits.values()].flat().some((b) => b.r.w === 36)`, 15_000);
    const before = await app.js<string>(`__bh.camera.approachState().gen`);
    const r = await app.js<{ u: number; v: number } | null>(`(() => { const p = __bh.pcd.pcd;
      for (const list of p.hits.values()) for (const b of list) if (b.r.w === 36) return { u: (b.r.x + 18) / p.canvas.width, v: (b.r.y + 18) / p.canvas.height };
      return null; })()`);
    expect(r).not.toBeNull();
    const said = await app.js<string | null>(`__bh.pcd.pcd.touch(${r!.u}, ${r!.v})`);
    console.log(`  TSD touched: ${said}`);
    expect(said).toMatch(/Approach|Approche/);
    expect(await app.js<number>(`__bh.camera.approachState().gen`)).toBeGreaterThan(Number(before));
    await shot("radar-approach-tsd");
  }, 30_000);

  test("its cost to the HUD: drawn and not, alternated (A A B B A B, 4 s each) — indicative", async () => {
    const section = async () =>
      app.js<{ hud: number; loop: number }>(`(() => { const p = __bh.game.perf();
        return { hud: p.cpu.find((c) => c.section === "HUD: markers & tapes")?.ms ?? NaN, loop: p.loopCpu.p50 }; })()`);
    const set = (on: boolean) =>
      app.js(`(() => { __bh.camera.approachSelect(${on ? `{ field: "LFML", approach: "I31R" }` : `{ field: "auto" }`}); return 1; })()`);
    const seq = [false, false, true, true, false, true];
    const R: { on: boolean; hud: number; loop: number }[] = [];
    for (const on of seq) {
      await set(on);
      await Bun.sleep(4000);
      R.push({ on, ...(await section()) });
    }
    const mean = (on: boolean) => {
      const v = R.filter((x) => x.on === on).map((x) => x.hud);
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    const aa = Math.abs(R[0]!.hud - R[1]!.hud);
    const d = mean(true) - mean(false);
    const loop = R.reduce((a, x) => a + x.loop, 0) / R.length;
    console.log(
      `  the HUD's section: ${R.map((x) => `${x.on ? "B" : "A"} ${x.hud.toFixed(3)}`).join(" · ")} ms — A/A ${aa.toFixed(3)} ms, B − A ${d.toFixed(3)} ms (${((100 * d) / loop).toFixed(2)} % of the loop's median ${loop.toFixed(2)} ms)`,
    );
    expect(Number.isFinite(d)).toBe(true);
  }, 60_000);
});
