import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A room's F-35s (docs/PLAN-RESEAU.md, PLAN-AVIATION-AAA): Ana flies on her holds over Edwards; Ben, by the wheel
// (Tab held › Patrouille › "Ailier de Ana", a real pointer), joins her wing — Beside first, far off — and the formation
// autopilot holds his place (its first free one); the wheel itself large and readable. Then the free fight — in a room,
// in the F-35, no match: weapons live, everyone a target —: Ben leaves her wing and runs ahead, Ana locks Ben (Tab) and fires
// an AIM-120 — his down, her kill on both sheets, he flies again. (NET_SHOTS=<dir>: the wheel, the formation, the fight.)

describe.skipIf(!E2E)("a room's F-35s: the wingman by the wheel, the free fight", () => {
  let a: App;
  let b: App;
  let sa = 0;
  let sb = 0;
  const shots = process.env.NET_SHOTS ?? "remote-results/net-wing-fight";
  const shot = async (p: App, name: string) => {
    await Bun.$`mkdir -p ${shots}`;
    await p.shot(`${shots}/${name}.png`);
  };
  const SETUP = `(() => { __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane"; __bh.settings.wind = 0; __bh.settings.wingmen = 0; return 1; })()`;
  beforeAll(async () => {
    a = await App.boot({ width: 1440, height: 900, lang: "fr", hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(SETUP);
    await a.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await a.js(`(() => { __bh.net.setName("Ana"); return 1; })()`);
    await a.js(`__bh.net.create("Wing")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    b = await App.boot({ width: 1440, height: 900, lang: "fr", hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(SETUP);
    await b.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await b.js(`(() => { __bh.net.setName("Ben"); __bh.settings.formShape = "echelonR"; return 1; })()`);
    sb = await b.js<number>(`__bh.net.net.room.slot`);
    await b.waitFor(`__bh.net.net.clock.synced && !__bh.net.session.teleport(-1).includes("clock")`, 30_000);
    await a.js(`(() => { __bh.game.flyAt(34.95, -117.80, 2300, 90, 220); return 1; })()`);
    await Bun.sleep(1000);
    await a.js(
      `(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.alt = 3000; c.jetModes.hdg = Math.PI / 2; c.jetModes.spd = 220; return 1; })()`,
    );
    // (Ben far off, flying too: over Mojave, 60 km west)
    await b.js(
      `(() => { __bh.game.flyAt(34.95, -118.45, 2300, 90, 220); __bh.camera.jetToggle("ap"); __bh.camera.jetToggle("athr"); return 1; })()`,
    );
    await b.waitFor(
      `__bh.net.net.remotes.track(${sa})?.latest?.kind === 3 && !(__bh.net.net.remotes.track(${sa}).latest.flags & 1)`,
      30_000,
    );
  }, 480_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  /** The wheel's sector whose label reads `re`: the pointer moved onto it (real events) — its label's centre. */
  const pointAt = async (p: App, re: string) => {
    const at = await p.js<{ x: number; y: number } | null>(`(() => {
      const l = [...document.querySelectorAll("[data-testid=wheel] .rw-label")].find((e) => new RegExp(${JSON.stringify(re)}, "i").test(e.textContent));
      if (!l) return null; const r = l.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!at)
      throw new Error(`no sector ${re}: ${await p.js<string>(`document.querySelector("[data-testid=wheel]")?.textContent ?? "no wheel"`)}`);
    await p.mouse("move", at.x, at.y);
    return at;
  };

  test("Ben: Tab held › Patrouille › Ailier de Ana — Beside, then the formation flown in his place", async () => {
    await b.js(`(() => { document.activeElement?.blur?.(); return 1; })()`);
    const tab = { code: "Tab", key: "Tab", windowsVirtualKeyCode: 9 };
    await b.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...tab });
    await b.waitFor(`!!document.querySelector("[data-testid=wheel]")`, 3000);
    // (the wheel large: its ring at least 520 px across here, its labels 13 px and more)
    const size = await b.js<{ ring: number; font: number; items: number }>(`(() => {
      const r = document.querySelector(".rw-ring").getBoundingClientRect(); const l = document.querySelector(".rw-label b");
      return { ring: r.width, font: parseFloat(getComputedStyle(l).fontSize), items: document.querySelectorAll(".rw-label").length }; })()`);
    console.log(`  the wheel: ${Math.round(size.ring)} px, ${size.font} px labels, ${size.items} sectors`);
    expect(size.ring).toBeGreaterThan(520);
    expect(size.font).toBeGreaterThanOrEqual(13);
    expect(size.items).toBeLessThanOrEqual(12);
    await pointAt(b, "Patrouille");
    await Bun.sleep(300);
    await shot(b, "wheel-main");
    await b.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...tab });
    // (a sub-wheel: open in place)
    await b.waitFor(`/Ailier de Ana/.test(document.querySelector("[data-testid=wheel]")?.textContent ?? "")`, 3000);
    await pointAt(b, "Ailier de Ana");
    await Bun.sleep(300);
    await shot(b, "wheel-flight");
    const at = await pointAt(b, "Ailier de Ana");
    await b.mouse("down", at.x, at.y);
    await b.mouse("up", at.x, at.y);
    await b.waitFor(`__bh.camera.form?.slot === ${sa}`, 10_000);
    // (in his place — held 3 s: Beside's placing reads a moment near it before the formation flies to it)
    await b.waitFor(
      `(() => { const d = __bh.camera.form?.last?.dist ?? 1e9; window.__inSlot = d < 15 ? (window.__inSlot ?? performance.now()) : null; return window.__inSlot !== null && performance.now() - window.__inSlot > 3000; })()`,
      180_000,
    );
    const pos = await b.js<number>(`__bh.camera.form.pos`);
    console.log(`  Ben on Ana's wing: place #${pos}, ${(await b.js<number>(`__bh.camera.form.last.dist`)).toFixed(1)} m off it`);
    expect(pos).toBe(2);
    // (held a while — both pages' tracers compiled for the place first: two pages on one GPU stall while one compiles)
    for (const p of [a, b]) await p.waitFor(`__bh.renderer.tracerSettled`, 120_000).catch(() => {});
    let worst = 0;
    const trace: string[] = [];
    for (let i = 0; i < 20; i++) {
      await Bun.sleep(1000);
      const d = await b.js<number>(`__bh.camera.form?.last?.dist ?? 1e9`);
      worst = Math.max(worst, d);
      const an = await a.js<string>(
        `(() => { const c = __bh.camera, f = c.jetFigures(); return Math.round(f.h) + " m " + Math.round(f.V) + " m/s" + (c.gcas?.escape ? " ACAS" : "") + (c.gcas?.flyUp ? " GCAS" : ""); })()`,
      );
      trace.push(`${i + 1}s ${d.toFixed(1)} m (Ana ${an})`);
    }
    console.log(`  ${trace.join(" · ")}`);
    console.log(`  held 20 s within ${worst.toFixed(1)} m`);
    expect(worst).toBeLessThan(20);
    await b.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(1500);
    await shot(b, "formation");
    await b.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
  }, 300_000);

  test("the free fight: both armed, each the other's target — no match asked", async () => {
    for (const p of [a, b]) await p.waitFor(`__bh.net.match.match?.mode === "free" && !!__bh.camera.combat?.free`, 20_000);
    for (const [p, other] of [
      [a, sb],
      [b, sa],
    ] as const)
      await p.waitFor(`__bh.camera.combat.world.targets.some((q) => q.peer === ${other} && q.alive && !q.friendly)`, 20_000);
    expect(await a.js<boolean>(`__bh.camera.combat.world.opts.friendlyFire`)).toBe(true);
  }, 60_000);

  test("Ben leaves her wing and runs ahead; Ana locks him (Tab) and fires an AIM-120 — shot down, he flies again", async () => {
    // (Ben away ahead on the afterburner, Ana slowed behind: some 4 km on, before her nose — her radar's cone)
    await b.js(
      `(() => { __bh.camera.formOff(); const c = __bh.camera; c.jetModes.alt = 3200; c.jetModes.hdg = Math.PI / 2; c.jetModes.spd = 300; return 1; })()`,
    );
    await a.js(`(() => { const c = __bh.camera; c.jetModes.alt = 3000; c.jetModes.hdg = Math.PI / 2; c.jetModes.spd = 190; return 1; })()`);
    await a.waitFor(
      `(() => { const o = __bh.camera.radarObjects.find((x) => x.id === "cmb:${10_000 + sb}"); return !!o && Math.hypot(...o.r) > 4000; })()`,
      90_000,
    );
    // (each other's flight unchanged by it: no protection climbing either away — two craft side by side, no conflict)
    for (const p of [a, b]) expect(await p.js<number>(`Math.abs(__bh.camera.jetFigures().h - __bh.camera.jetModes.alt)`)).toBeLessThan(150);
    await a.waitFor(`__bh.camera.combat.world.targets.some((q) => q.peer === ${sb} && q.alive)`, 10_000);
    // (her radar's lock on him by Tab — the next track each time —, the AIM-120 chosen, Enter: fox three)
    for (let k = 0; k < 8 && !(await a.js<boolean>(`__bh.camera.combat.world.lock === ${10_000 + sb}`)); k++) {
      await a.press("Tab");
      await Bun.sleep(300);
    }
    if (!(await a.js<boolean>(`__bh.camera.combat.world.lock === ${10_000 + sb}`)))
      console.log(
        `  Ana: ${await a.js<string>(`JSON.stringify({ lock: __bh.camera.radar.lock, tracks: [...__bh.camera.radar.tracks.values()].map((T) => T.id + ":" + Math.round(Math.hypot(...T.r))) })`)}`,
      );
    expect(await a.js<number>(`__bh.camera.combat.world.lock`)).toBe(10_000 + sb);
    while ((await a.js<string>(`__bh.camera.combat.weapon`)) !== "aim120") await a.press("Equal", "=");
    for (let k = 0; k < 3; k++) {
      await a.press("Enter");
      await a.waitFor(`__bh.camera.combat.world.ownMissiles().length > 0`, 5000).catch(() => {});
      if (k === 0) {
        await Bun.sleep(1500);
        await shot(a, "fight-fox3");
      }
      const down = await b
        .waitFor(`__bh.camera.combat?.downAt !== null`, 40_000)
        .then(() => true)
        .catch(() => false);
      if (down) break;
      console.log(`  shot ${k + 1} missed — again`);
    }
    await b.waitFor(`__bh.camera.combat?.downAt !== null`, 1000);
    await shot(b, "fight-down");
    for (const p of [a, b]) await p.waitFor(`__bh.net.match.sheet.row(${sa}).kills === 1`, 10_000);
    const feed = await a.js<string>(`[...document.querySelectorAll(".nm-feed-row")].map((e) => e.textContent).join(" | ")`);
    console.log(`  the feed: ${feed}`);
    // (out of control to his crash from some 3 km — game/wreckfall.ts —, then the wait)
    await b.waitFor(`__bh.camera.combat?.downAt === null`, 90_000);
    console.log(`  Ben flies again`);
    for (const p of [a, b]) expect(p.cdp.errors.filter((e) => !/Failed to load resource|net::ERR/.test(e))).toEqual([]);
  }, 300_000);
});
