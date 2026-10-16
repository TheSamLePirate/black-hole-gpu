import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The flight's radio roles (docs/PLAN-AVIATION-AAA.md, I4): first the Alps as ever; Ana in a fight with an AI
// wingman — Darkstar calls the picture (its subtitle DARKSTAR), her wingman answers (WINGMAN), a bogey dope asked of
// Darkstar —; then on the Ford's final, the F-35C on the carrier's autopilot — Mother clears her (MOTHER), Paddles
// calls the ball (PADDLES) —; Ben in her room hears her carrier's and her LSO's calls on the flight's radio, her name
// before them. (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the flight's radio roles", () => {
  let a: App;
  let b: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (p: App, name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await p.shot(`${shots}/${name}.png`);
  };
  const said = (p: App, sp: string) =>
    p.js<string[]>(`__bh.voice.said.filter((l) => l.speaker === ${JSON.stringify(sp)}).map((l) => l.text)`);
  const tool = (name: string, args: object) =>
    a.js<unknown>(`(async () => { const t = __bh.tars.tools().find((x) => x.name === ${JSON.stringify(name)});
      const o = await t.run(${JSON.stringify(args)}, new AbortController().signal); return o.result ?? o; })()`);
  const SETUP = `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, f35RadioRoles: true, f35ThreatCalls: true, subtitles: true }); return 1; })()`;

  beforeAll(async () => {
    a = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await a.js(SETUP);
    await a.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await a.js(`(() => { __bh.net.setName("Ana"); return 1; })()`);
    await a.js(`__bh.net.create("Radio")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1000, height: 700, lang: "fr", hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(SETUP);
    await b.js(`(() => { __bh.net.setName("Ben"); return 1; })()`);
  }, 480_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await a.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot(a, "alps");
  }, 120_000);

  test("a fight: Darkstar calls the picture, the wingman answers, a bogey dope", async () => {
    await a.js(`(() => { Object.assign(__bh.settings, { f35Invulnerable: true, wingmen: 1 }); return 1; })()`);
    await tool("f35", { action: "fly", id: "bvr" });
    await a.waitFor(`__bh.camera.combat?.status === "run"`, 30_000);
    await a.waitFor(`__bh.voice.said.some((l) => l.speaker === "awacs" && /bandit/i.test(l.text))`, 40_000);
    await a.waitFor(`document.querySelector("[data-testid=subtitles]")?.dataset.speaker === "awacs"`, 10_000).catch(() => {});
    await shot(a, "darkstar");
    console.log(`  Darkstar: ${(await said(a, "awacs")).join(" | ")}`);
    const dope = (await tool("weapons", { action: "bogey_dope" })) as string;
    console.log(`  ${dope}`);
    expect(dope).toMatch(/bogey dope — \d{3}, \d+ km/);
    await a.waitFor(`__bh.voice.said.some((l) => l.speaker === "wingman")`, 60_000);
    console.log(`  the wingman: ${(await said(a, "wingman")).join(" | ")}`);
    // (our own wingman never an ACAS conflict)
    expect(await a.js<boolean>(`__bh.voice.asked.some((l) => /ACAS/.test(l.text) && /Deux|Two/.test(l.text))`)).toBe(false);
    // (TARS no longer calls the picture: Darkstar's)
    expect((await said(a, "tars")).some((x) => /bandits?,/.test(x))).toBe(false);
  }, 180_000);

  test("the Ford's final: Mother clears her, Paddles calls the ball; Ben hears them on the flight's radio", async () => {
    await a.js(`(() => { __bh.camera.combatEnd(); __bh.settings.wingmen = 0; return 1; })()`);
    await a.js(`(() => { __bh.flight.school.tryIt("case1"); return 1; })()`);
    await a.waitFor(`!!__bh.camera.carrierNow()?.length && !!__bh.camera.geoNow()`, 30_000);
    await Bun.sleep(1500);
    await a.js(`(() => { __bh.camera.trapRun = null; __bh.camera.trapLand("ford", { case: "straight" }); return 1; })()`);
    await a.waitFor(`__bh.voice.said.some((l) => l.speaker === "mother")`, 20_000);
    await a.waitFor(`__bh.voice.said.some((l) => l.speaker === "lso")`, 90_000);
    await Bun.sleep(300);
    await shot(a, "paddles");
    console.log(`  Mother: ${(await said(a, "mother")).join(" | ")}\n  Paddles: ${(await said(a, "lso")).join(" | ")}`);
    expect((await said(a, "lso")).every((x) => !x.startsWith("Paddles"))).toBe(true);
    await b.waitFor(`__bh.voice.said.some((l) => l.speaker === "lso" && l.text.startsWith("Ana — "))`, 30_000);
    const heard = await b.js<string[]>(`__bh.voice.said.filter((l) => l.text.startsWith("Ana — ")).map((l) => l.speaker + ": " + l.text)`);
    console.log(`  Ben heard: ${heard.join(" | ")}`);
    expect(heard.some((x) => x.startsWith("mother:"))).toBe(true);
    await shot(b, "ben-hears");
  }, 240_000);
});
