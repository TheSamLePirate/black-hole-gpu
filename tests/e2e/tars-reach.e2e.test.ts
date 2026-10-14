import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// TARS reaches the whole game (docs/PLAN-OBSERVATOIRE.md O4), through its tools as the model calls them: an F-35 flight
// prepared at Edwards (lined up, at dawn, half its fuel, a plan to another field), the plan edited and flown by LNAV,
// the challenges listed and one flown, the music set, every page opened, the game shared as a link.

describe.skipIf(!E2E)("TARS reaches the rest of the game", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis", width: 1280, height: 800, tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
  }, 200_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  /** a tool run as TARS runs it: its result (the game's lines put aside) */
  const tool = async <T = unknown>(name: string, args: object) =>
    app.js<T>(
      `Promise.resolve(__bh.tars.tools().find((t) => t.name === ${JSON.stringify(name)}).run(${JSON.stringify(args)}, new AbortController().signal)).then((r) => (r && typeof r === "object" && "result" in r ? r.result : r))`,
    );

  test("an F-35 flight prepared at Edwards: the jet lined up there, its plan to China Lake flown by LNAV", async () => {
    const fields = await tool<{ icao: string | null; name: string }[]>("f35", { action: "fields" });
    expect(fields.some((f) => f.icao === "KEDW")).toBe(true);
    const r = await tool<string>("f35", {
      action: "prepare",
      field: "KEDW",
      start: "runway",
      fuel: 0.5,
      dest: fields.find((f) => f.icao && f.icao !== "KEDW")!.icao,
    });
    expect(r).toMatch(/KEDW/);
    await Bun.sleep(1500);
    expect(await app.js<string>(`__bh.fleet.active`)).toBe("f35");
    const plan = await tool<{ waypoints: { name: string }[] }>("flight_plan", { action: "show" });
    expect(plan.waypoints.length).toBe(2);
    const more = await tool<{ waypoints: { name: string }[] }>("flight_plan", {
      action: "add",
      lat: 35.5,
      lon: -117.5,
      altM: 4000,
      index: 1,
    });
    expect(more.waypoints.length).toBe(3);
    const nav = await tool<{ lnav: boolean; vnav: boolean }>("flight_plan", { action: "nav", lnav: true, vnav: true });
    expect(nav).toMatchObject({ lnav: true, vnav: true });
  }, 90_000);

  test("the challenges listed and one flown, then given up", async () => {
    const c = await tool<{ challenges: { id: string }[]; fights: { id: string }[] }>("f35", { action: "challenges" });
    expect(c.challenges.length).toBeGreaterThan(3);
    expect(c.fights.length).toBeGreaterThan(0);
    await tool("f35", { action: "fly", id: c.challenges[0]!.id });
    await Bun.sleep(1500);
    expect(await app.js<string | null>(`__bh.camera.chal?.status ?? null`)).toBe("run");
    expect(await tool<string>("f35", { action: "abort" })).toMatch(/given up/);
  }, 60_000);

  test("the music set; every page opened by TARS; the game shared as a link", async () => {
    const themes = await tool<{ id: string }[]>("music", { action: "themes" });
    expect(themes.length).toBeGreaterThan(3);
    expect(await tool<string>("music", { action: "set", mode: "adaptive", layer: "choir", level: 0.4 })).toMatch(/adaptive/);
    expect(await app.js<string>(`__bh.music.prefs.mode`)).toBe("adaptive");
    for (const [panel, testid] of [
      ["flighthub", "flight-hub"],
      ["route", "route-panel"],
      ["challenges", "challenge-panel"],
      ["multiexposure", "multi-exposure"],
    ] as const) {
      await tool("interface", { open: panel });
      await app.waitFor(`!!document.querySelector("[data-testid=${testid}]")`, 5_000);
      await app.press("Escape");
      await app.waitFor(`!document.querySelector("[data-testid=${testid}]")`, 5_000);
    }
    const link = await tool<{ link: string }>("saves", { action: "share" });
    expect(link.link).toMatch(/^http/);
  }, 90_000);
});
