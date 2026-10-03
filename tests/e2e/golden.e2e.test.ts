import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { FLIGHTS } from "./lib/flights";

// Golden flights: scenes flown at fixed steps (__bh.freeze + step, 1/30 s), their end state against the
// one recorded — the flight's code (controls.ts, its integrators, the autopilots) moved or split must
// fly the same. The flight is deterministic at fixed steps (the same page, the same numbers to the last
// bits). UPDATE=1 bun run e2e records them anew (after a change of the physics, on purpose).

const FILE = `${import.meta.dir}/golden/flights.json`;
const UPDATE = process.env.UPDATE === "1";

type State = Record<string, number | string | null>;

/** The state a flight ends in: the clock, where and how fast, the pilot's modes, the ship's pose. */
const STATE = `(() => {
  const st = __bh.game.status(), i = __bh.camera.flightInfo(), p = __bh.camera.pilot, s = __bh.settings;
  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const v = (a, k) => (Array.isArray(a) ? num(a[k]) : null);
  return {
    t: num(__bh.sim.time), label: st.label, soi: st.soi ?? null, alt: num(st.altKm), speed: num(st.speed),
    hold: p.hold, auto: p.auto, throttle: num(p.throttle), landed: String(!!i.landed),
    X0: v(i.X, 0), X1: v(i.X, 1), X2: v(i.X, 2), V0: v(i.V, 0), V1: v(i.V, 1), V2: v(i.V, 2),
    yaw: num(s.yaw), pitch: num(s.pitch), distance: num(s.distance),
  };
})()`;

describe.skipIf(!E2E)("golden flights at fixed steps", () => {
  let app: App;
  let golden: Record<string, State> = {};
  const recorded: Record<string, State> = {};
  beforeAll(async () => {
    app = await App.boot();
    golden = (await Bun.file(FILE).exists()) ? await Bun.file(FILE).json() : {};
  }, 300_000);
  afterAll(async () => {
    if (UPDATE || !Object.keys(golden).length) await Bun.write(FILE, `${JSON.stringify({ ...golden, ...recorded }, null, 1)}\n`);
    app?.close();
    stopServer();
  });

  for (const [name, f] of Object.entries(FLIGHTS))
    test(name, async () => {
      const s = await app.js<State>(`(async () => {
          __bh.freeze(true);
          // (the scenes of "now" — the station — on a fixed date)
          __bh.setDate(Date.UTC(2026, 9, 1, 12));
          __bh.preset(${JSON.stringify(f.scene)});
          // (a scene with no time of its own — none set, none from a place of the real time — at 0, not
          // wherever the page's clock stood)
          if (__bh.presets[${JSON.stringify(f.scene)}].time === undefined && __bh.presets[${JSON.stringify(f.scene)}].pose === undefined) __bh.setTime(0);
          ${f.setup};
          for (let i = 0; i < ${f.steps}; i++) __bh.step(1 / 30);
          const out = ${STATE};
          __bh.freeze(false);
          __bh.setDate(null);
          return out;
        })()`);
      recorded[name] = s;
      const g = golden[name];
      if (UPDATE || !g) return;
      for (const [k, want] of Object.entries(g)) {
        const got = s[k];
        if (typeof want === "number" && typeof got === "number")
          expect(Math.abs(got - want), `${name}.${k}: ${got} vs ${want}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want)));
        else expect(got, `${name}.${k}`).toEqual(want);
      }
    }, 120_000);
});
