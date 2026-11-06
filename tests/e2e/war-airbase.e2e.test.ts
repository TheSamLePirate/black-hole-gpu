import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The war mode's airfield (Sam, 6 Nov 2026: « des bâtiments à détruire, des aéroports »): the "war-airbase" fight at Bicycle Lake
// Army Airfield — three hardened shelters, the tower, the fuel farm, an SA-11 —; two buildings bombed (Sam): SHELTER 2 watched
// from the lens on it (mount "target"), then the TOWER from the weapon's view (mount "missile": riding the JDAM down, round the
// impact 7 s, back behind the jet); each run from 3 km south at 700 m, the JDAM released at once (autopilot, autothrottle).
//   WA_OUT · WA_DATE ("2026-06-20T15:00:00Z")
// Output: remote-results/war-airbase/NN-*.jpg, series.json. Done when: the airfield's targets drawn, the shelter and the tower
// destroyed, the weapon's view riding the bomb then round the impact; no GPU error. Duration: ~2 min.
const OUT = process.env.WA_OUT ?? "remote-results/war-airbase";
afterAll(stopServer);

const SAMPLE = `(() => {
  const W = __bh.camera.combat?.world;
  const drawn = __bh.renderer.combatOthers.filter((o) => String(o.id).startsWith("gu-"));
  const sh = W?.targets.find((q) => q.name === "SHELTER 2");
  const tw = W?.targets.find((q) => q.name === "TOWER");
  return { t: W ? +W.t.toFixed(1) : null, drawn: drawn.map((o) => o.id).join(","), shelter: sh?.alive ?? null, tower: tw?.alive ?? null,
    mount: __bh.settings.shipMount, riding: !!__bh.camera.missileShip?.(), orbit: __bh.camera.impactShip?.()?.age ?? null,
    craters: W?.craters.length ?? 0, miss: sh && W?.craters.length ? Math.round(Math.min(...W.craters.map((k) => Math.hypot(k.p[0] - sh.p[0], k.p[1] - sh.p[1])))) : null, bombs: (W?.bombs ?? []).filter((b) => b.alive).length, fps: __bh.game.perf({ gpu: true }).renderFps };
})()`;

test.skipIf(!E2E)(
  "the war mode's airbase: shelters, tower and fuel drawn; a shelter and the tower destroyed, the bombs bursting in them",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    const series: Record<string, unknown>[] = [];
    let gpuErrors = -1;
    let i = 0;
    const shot = async (tag: string) => {
      const a = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
      await Bun.write(`${OUT}/${String(i).padStart(2, "0")}-${tag}.jpg`, Buffer.from(a.data, "base64"));
      const s = await app.js<Record<string, unknown>>(SAMPLE);
      series.push({ tag, i: i++, ...s });
      console.log(`  ${tag}: ${JSON.stringify(s)}`);
    };
    try {
      await app.waitProgress("__bh.camera.piloting", "the flight");
      await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, { lookProfile: "neutral", motionBlur: 0, dof: false, f35Invulnerable: true });
        __bh.game.setDate("${process.env.WA_DATE ?? "2026-06-20T15:00:00Z"}"); __bh.game.set("weather", "fair"); return 1; })()`);
      await app.waitProgress(`__bh.fleet.active === "f35"`, "the F-35");
      await app.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
      await app.waitFor(`!!document.querySelector("[data-testid=chp-fight-war-airbase]")`, 10_000);
      await app.click(`[data-testid="chp-fight-war-airbase"]`);
      const a = { lat: 35.2803, lon: -116.6291 };
      const at = (e: number, n: number) => [a.lat + n / 111_320, a.lon + e / (111_320 * Math.cos((a.lat * Math.PI) / 180))];
      // (a run on a building: the jet put 3 km south of it at 700 m, frozen till its ground is in, then let go and the JDAM
      // released on it at once — designated and fired in one go: the radar's air lock would drop the designation; flown on 20 s
      // before, the jet had passed it —; its autopilot and autothrottle set; the view `mount`)
      const run = async (name: string, mount: string) => {
        const pos = await app.js<[number, number]>(
          `(() => { const q = __bh.camera.combat.world.targets.find((x) => x.name === ${JSON.stringify(name)}); return [q.p[0], q.p[1]]; })()`,
        );
        const [la, lo] = at(pos[0], pos[1] - 3000);
        await app.js(
          `(() => { __bh.game.flyAt(${la}, ${lo}, 700, 0, 220); __bh.freeze(true); __bh.settings.shipMount = ${JSON.stringify(mount)}; return 1; })()`,
        );
        await app.dataSettled(name);
        await app.waitFor(`__bh.renderer.compilesPending === 0`, 60_000);
        console.log(
          `  ${await app.js(`(() => { const c = __bh.camera, W = c.combat.world; __bh.freeze(false); c.apSet({ ap: true, athr: true, spd: 220 });
          W.lock = W.targets.find((q) => q.name === ${JSON.stringify(name)}).id; c.combat.weapon = "jdam"; return c.combatTrigger("fire"); })()`)}`,
        );
      };
      // (1 — SHELTER 2, the lens on it — mount "target" —: its fall, its impact)
      await run("SHELTER 2", "target");
      await shot("shelter-run");
      await app.waitFor(
        `(() => { const W = __bh.camera.combat.world, b = W.bombs.find((x) => x.alive); return !b || b.p[2] - W.groundZ(b.p[0], b.p[1]) < 250; })()`,
        40_000,
      );
      for (let k = 0; k < 16; k++) {
        await shot("shelter");
        await Bun.sleep(500);
      }
      // (2 — the TOWER, the weapon's view — mount "missile" —: riding the bomb down, round the impact, back to the jet)
      await run("TOWER", "missile");
      for (let k = 0; k < 40; k++) {
        await shot("tower");
        await Bun.sleep(700);
      }
      gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/series.json`, JSON.stringify(series, null, 1));
      await app.close();
    }
    expect(gpuErrors).toBe(0);
    expect(series.some((s) => String(s.drawn).includes("gu-has") && String(s.drawn).includes("gu-tower"))).toBe(true);
    expect(series.some((s) => s.shelter === false)).toBe(true);
    expect(series.some((s) => s.tower === false)).toBe(true);
    // (a bomb burst in a building leaves no crater — one on the ground does: unit-tested, combat.test)
    // (the weapon's view: riding the bomb, then round the impact)
    expect(series.some((s) => s.tag === "tower" && s.riding)).toBe(true);
    expect(series.some((s) => s.tag === "tower" && s.orbit !== null)).toBe(true);
  },
  5 * 60_000,
);
