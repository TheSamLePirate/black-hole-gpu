import { afterAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// Two F-35s in formation on two Macs (the room server in production between them): the same heading, height,
// speed and settings (calm air, the same holds) — does one drift from the other? Each page logs, twice a second,
// its own craft (Earth-fixed [m], the room's scene time) and the other as its page draws him (his track read at
// that time); the logs, put side by side by scene time, give the true gap and what each saw of it.
//
//   leader (this Mac):  E2E=1 NET_ROLE=lead NET_CODE_FILE=<f> NET_LOG=<f.json> bun test … net-formation…
//   wingman (another):  E2E=1 NET_ROLE=wing NET_CODE=<code> NET_LOG=<f.json> bun test … net-formation…
// (NET_SECONDS: how long they fly side by side, 180 by default; NET_WIND: the wind's level, 0 calm by default)

const ROLE = process.env.NET_ROLE ?? "";
const SECONDS = Number(process.env.NET_SECONDS ?? 180);
const WIND = Number(process.env.NET_WIND ?? 0);
const SERVER = process.env.NET_SERVER ?? "wss://stream.samlepirate.org/";
const HOLDS = { alt: 3000, hdg: 90, spd: 220 };

/** the page's logger: its craft and the other, twice a second */
const LOGGER = (other: number) => `(() => {
  window.__fl = [];
  const S = __bh.net.session, c = __bh.camera;
  window.__flTimer = setInterval(() => {
    const t = S.d.sceneTime(), o = c.netOwn(), f = c.jetFigures();
    const W = __bh.net.net?.remotes.track(${other})?.at(t);
    window.__fl.push({ t, wall: Date.now(), p: o?.p, v: o?.v, h: f?.h, hdg: f?.hdg, V: f?.V,
      other: W ? { p: W.p, v: W.v, frame: W.frame, ghost: W.ghost, ahead: W.ahead, kind: W.kind } : null,
      modes: { ...c.jetModes }, auto: c.pilot.auto });
  }, 500);
  return 1;
})()`;

/** the same settings and holds on both: calm air, the F-35 in plane mode, the autopilot on 3000 m, 090°, 220 m/s */
const HOLD = `(() => {
  const c = __bh.camera, D = Math.PI / 180;
  const a = c.jetModes.alt === null ? c.jetToggle("ap") : "";
  const b = c.jetModes.spd === null ? c.jetToggle("athr") : "";
  c.jetModes.alt = ${HOLDS.alt}; c.jetModes.hdg = ${HOLDS.hdg} * D; c.jetModes.spd = ${HOLDS.spd};
  return a + " · " + b;
})()`;

/** where the page has its craft: the jet's figures, landed or not, the gap to the other, the scene against the room */
const PROBE = (other: number) => `(() => {
  const c = __bh.camera, f = c.jetFigures(), o = c.netOwn(), S = __bh.net.session, t = S.d.sceneTime();
  const W = __bh.net.net.remotes.track(${other})?.at(t);
  const gap = W && o ? Math.round(Math.hypot(...[0, 1, 2].map((k) => W.p[k] - o.p[k]))) : -1;
  return [f ? Math.round(f.h) + " m " + Math.round(f.V) + " m/s" : "no figures", "landed " + c.landed, "gap " + gap + " m",
    "lag " + S.lag.toFixed(2) + " s", "v " + (o ? Math.round(Math.hypot(...o.v)) : -1)].join(" · ");
})()`;

const SETUP = `(() => { __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane"; __bh.settings.wind = ${WIND};
  __bh.settings.weather = "fair"; return 1; })()`;

describe.skipIf(!E2E || !ROLE)(`two F-35s in formation (${ROLE})`, () => {
  let p: App;
  afterAll(async () => {
    p?.close();
    stopServer();
  });

  test(ROLE === "lead" ? "the leader flies on, logging" : "the wingman joins on the right, logging", async () => {
    const hash = `scene=game:artemis&server=${SERVER}${ROLE === "wing" ? `&join=${process.env.NET_CODE}` : ""}`;
    p = await App.boot({ width: 1280, height: 800, hash, tiles: false });
    await p.waitFor("__bh.camera.piloting", 120_000);
    await p.js(SETUP);
    // (the craft switched — a frame on, the F-35 put on the nearest runway —: before any placing, or it undoes it)
    await p.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    let other = -1;
    if (ROLE === "lead") {
      await p.js(`(() => { __bh.net.setName("Ana"); return 1; })()`);
      await p.js(`__bh.net.create("Formation")`);
      await p.waitFor(`!!__bh.net.net?.room && __bh.net.net.clock.synced`, 30_000);
      const code = await p.js<string>(`__bh.net.net.room.code`);
      await p.js(`(() => { __bh.game.flyAt(34.95, -117.80, ${HOLDS.alt - 700}, ${HOLDS.hdg}, ${HOLDS.spd}); return 1; })()`);
      await Bun.sleep(1500);
      console.log(`  Ana: ${await p.js<string>(HOLD)} — room ${code}`);
      await Bun.write(process.env.NET_CODE_FILE ?? "/tmp/net-formation.code", code);
      await p.waitFor(`__bh.net.session.others().length > 0`, 900_000);
      other = await p.js<number>(`__bh.net.session.others()[0].slot`);
      await p.js(LOGGER(other));
      // (his craft beside ours: from then on, the time flown side by side)
      await p.waitFor(
        `(() => { const t = __bh.net.session.d.sceneTime(), W = __bh.net.net.remotes.track(${other})?.at(t), o = __bh.camera.netOwn();
          return !!W && !W.ghost && W.kind === 3 && !!o && Math.hypot(...[0, 1, 2].map((k) => W.p[k] - o.p[k])) < 120; })()`,
        600_000,
      );
      console.log("  Ben in formation");
      await Bun.sleep(SECONDS * 1000 + 15_000);
    } else {
      await p.waitFor(`__bh.net?.net?.room?.code === "${process.env.NET_CODE}" && __bh.net.net.clock.synced`, 60_000);
      await p.js(`(() => { __bh.net.setName("Ben"); return 1; })()`);
      other = await p.js<number>(`__bh.net.session.others().find((o) => o.name === "Ana").slot`);
      await p.waitFor(`__bh.net.net.remotes.track(${other})?.latest?.kind === 3`, 30_000);
      let said = "";
      for (let k = 0; k < 30; k++) {
        said = await p.js<string>(`__bh.net.session.teleport(${other}, 40)`);
        if (said.includes("formation")) break;
        await Bun.sleep(1000);
      }
      console.log(`  Ben: ${said}`);
      expect(said).toContain("formation");
      // (where his page has him the next seconds: in the air beside her — not set back on a runway by a loss
      // before the teleport, his F-35 chosen in orbit)
      for (let k = 0; k < 6; k++) {
        console.log(`  +${k} s: ${await p.js<string>(PROBE(other))}`);
        await Bun.sleep(1000);
      }
      console.log(`  Ben's log: ${await p.js<string>(`__bh.game.log.text().split(String.fromCharCode(10)).slice(-6).join(" | ")`)}`);
      expect(await p.js<string>(PROBE(other))).toMatch(/^\d+ m .*gap \d{2,3} m/);
      console.log(`  Ben: ${await p.js<string>(HOLD)}`);
      await p.js(LOGGER(other));
      await Bun.sleep(SECONDS * 1000 + 10_000);
    }
    const log = await p.js<unknown[]>(`(() => { clearInterval(window.__flTimer); return window.__fl; })()`);
    await Bun.write(process.env.NET_LOG ?? `/tmp/net-formation-${ROLE}.json`, JSON.stringify({ role: ROLE, other, log }));
    console.log(`  ${log.length} samples logged`);
    expect(log.length).toBeGreaterThan(SECONDS);
  }, 1_500_000);
});
