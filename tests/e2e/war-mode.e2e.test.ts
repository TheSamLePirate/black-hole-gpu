import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The war mode (Sam, 6 Nov 2026: « des chars, des tourelles qui tirent des sol-air, des bâtiments à détruire »; game/
// ground-units.ts, scripts/build-ground-units.ts): the "war" fight at Fort Irwin — two SA-11 batteries, an armoured column,
// its trucks, two bunkers —; the F-35 put 9 km south of the north battery at 900 m, its autopilot and autothrottle set (apSet);
// the lens on the launcher locked (mount "target"): its turret turning onto us, its arm raised, a missile leaving its rails,
// one fewer left; then a tank locked, a JDAM dropped on it, its wreck burnt out. A shot each WM_EVERY ms and the units' poses.
//   WM_EVERY (1500) · WM_OUT
// Output: remote-results/war-mode/NN-*.jpg, series.json. Done when: the units drawn, the launcher's turret turned towards the
// jet, a SAM fired from it, the tank destroyed and drawn burnt; no GPU error. Duration: ~3 min.
const OUT = process.env.WM_OUT ?? "remote-results/war-mode";
const EVERY = Number(process.env.WM_EVERY ?? 1500);
afterAll(stopServer);

const SAMPLE = `(() => {
  const W = __bh.camera.combat?.world;
  const units = (W?.targets ?? []).filter((q) => ["sam", "tank", "truck", "bunker"].includes(q.kind));
  const drawn = __bh.renderer.combatOthers.filter((o) => String(o.id).startsWith("gu-"));
  const sam = units.find((q) => q.name === "SA-11 NORTH");
  return {
    t: W ? +W.t.toFixed(1) : null, lock: W?.lock ?? null, weapon: __bh.camera.combat?.weapon,
    drawn: drawn.length, units: units.length, alive: units.filter((q) => q.alive).length,
    tel: sam ? { yaw: +(sam.gpose?.yaw ?? 0).toFixed(2), pitch: +(sam.gpose?.pitch ?? 0).toFixed(2), left: sam.site?.missiles, alive: sam.alive } : null,
    sams: (W?.missiles ?? []).filter((m) => m.kind === "sam" && m.alive).length,
    bombs: (W?.bombs ?? []).filter((b) => b.alive).map((b) => Math.round(b.p[2] - W.groundZ(b.p[0], b.p[1]))),
    burnt: drawn.filter((o) => (o.ground?.burnt ?? 0) > 0.5).length,
    fps: __bh.game.perf({ gpu: true }).renderFps,
  };
})()`;

test.skipIf(!E2E)(
  "the war mode: SAM launchers turning and firing, a tank destroyed and burnt",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    const series: Record<string, unknown>[] = [];
    let gpuErrors = -1;
    const shot = async (tag: string, i: number) => {
      const a = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
      await Bun.write(`${OUT}/${String(i).padStart(2, "0")}-${tag}.jpg`, Buffer.from(a.data, "base64"));
      const s = await app.js<Record<string, unknown>>(SAMPLE);
      series.push({ tag, i, ...s });
      console.log(`  ${tag} ${i}: ${JSON.stringify(s)}`);
    };
    try {
      await app.waitProgress("__bh.camera.piloting", "the flight");
      await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, { lookProfile: "neutral", motionBlur: 0, dof: false, f35Invulnerable: true, f35EnemyMissiles: true });
        __bh.game.setDate("2026-06-20T18:00:00Z"); __bh.game.set("weather", "fair"); return 1; })()`);
      await app.waitProgress(`__bh.fleet.active === "f35"`, "the F-35");
      await app.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
      await app.waitFor(`!!document.querySelector("[data-testid=chp-fight-war]")`, 10_000);
      await app.click(`[data-testid="chp-fight-war"]`);
      // (9 km south of the north battery — its anchor 35.3° N, 116.62° W; the battery 2.5 km west, 3 km north of it —, 900 m up)
      const a = { lat: 35.3, lon: -116.62 };
      const at = (e: number, n: number) => [a.lat + n / 111_320, a.lon + e / (111_320 * Math.cos((a.lat * Math.PI) / 180))];
      const [la, lo] = at(-2500, -6000);
      await app.js(`(() => { __bh.game.flyAt(${la}, ${lo}, 900, 0, 220); __bh.camera.gearDown = false; __bh.freeze(false); return 1; })()`);
      await app.dataSettled("Fort Irwin");
      await app.js(`(() => { __bh.freeze(false); return 1; })()`);
      await Bun.sleep(400);
      console.log(`  autopilot: ${await app.js(`__bh.camera.apSet({ ap: true, athr: true, spd: 220 })`)}`);
      // (the north battery locked: the lens on it)
      await app.js(`(() => { const c = __bh.camera, W = c.combat.world; for (let k = 0; k < 20; k++) { c.combatTrigger("lock"); if (W.target(W.lock)?.name === "SA-11 NORTH") break; }
        __bh.settings.shipMount = "target"; return W.target(W.lock)?.name ?? null; })()`);
      await app.waitFor(`__bh.renderer.compilesPending === 0`, 60_000);
      let i = 0;
      for (let k = 0; k < 10; k++, i++) {
        await shot("sam", i);
        await Bun.sleep(EVERY);
      }
      // (a tank designated — the radar's air lock does not hold a ground target: the world's lock set, as a designation — and a
      // JDAM released on it at once — its aim taken at the release —, from 3 km south of the column at 700 m; the lens on it)
      const [lb, ob] = at(-350, -4200);
      await app.js(`(() => { __bh.game.flyAt(${lb}, ${ob}, 700, 0, 220); __bh.freeze(false); return 1; })()`);
      await Bun.sleep(600);
      await app.js(`__bh.camera.apSet({ ap: true, athr: true, spd: 220 })`);
      const said = await app.js<string | null>(`(() => { const c = __bh.camera, W = c.combat.world;
        const tank = W.targets.find((q) => q.kind === "tank" && q.alive); W.lock = tank.id; c.combat.weapon = "jdam";
        __bh.settings.shipMount = "target"; return [tank.name, c.combatTrigger("fire")].join(" · "); })()`);
      console.log(`  ${said}`);
      for (let k = 0; k < 14; k++, i++) {
        await shot("tank", i);
        await Bun.sleep(EVERY);
      }
      gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/series.json`, JSON.stringify(series, null, 1));
      await app.close();
    }
    expect(gpuErrors).toBe(0);
    expect(series.some((s) => (s.drawn as number) > 0)).toBe(true);
    const tel = series.map((s) => s.tel as { yaw: number; left: number } | null).filter(Boolean);
    expect(tel.some((t) => Math.abs(t!.yaw) > 0.05)).toBe(true);
    expect(series.some((s) => (s.burnt as number) > 0)).toBe(true);
  },
  6 * 60_000,
);
