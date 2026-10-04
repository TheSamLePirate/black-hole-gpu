import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { FLIGHTS } from "./lib/flights";

// The flight does not depend on the frame rate, nor on the flight before it: the reference flights
// flown at 30 and at 120 steps a second end within metres (the integrators' first-order error), and
// one flown twice in a row ends the same (a new flight carries nothing of the last: its phase, its pilot,
// its gear — within metres: the ground the gear stands on is streamed, its tiles asked for by the views
// drawn between the flights, the network off here filled from the map at their texels — the start's
// height off by a millimetre or so, a 30 s entry's guided glide 3 m apart at its end. A state carried
// over shows far more: the last flight's body rates, before, turned the next glide from its first step).

interface End {
  label: string;
  auto: string;
  alt: number;
  speed: number;
}

const fly = (app: App, name: string, hz: number) => {
  const f = FLIGHTS[name]!;
  return app.js<End>(`(async () => {
    __bh.freeze(true);
    __bh.setDate(Date.UTC(2026, 9, 1, 12));
    __bh.preset(${JSON.stringify(f.scene)});
          // (a scene with no time of its own — none set, none from a place of the real time — at 0, not
          // wherever the page's clock stood)
          if (__bh.presets[${JSON.stringify(f.scene)}].time === undefined && __bh.presets[${JSON.stringify(f.scene)}].pose === undefined) __bh.setTime(0);
    ${f.setup};
    for (let i = 0; i < ${Math.round((f.steps / 30) * hz)}; i++) __bh.step(1 / ${hz});
    const st = __bh.game.status();
    const out = { label: st.label, auto: __bh.camera.pilot.auto, alt: st.altKm * 1000, speed: st.speed };
    __bh.freeze(false);
    __bh.setDate(null);
    return out;
  })()`);
};

// The flight's start set and the views drawn until the Earth's maps it wants are in: the ground the gear
// stands on is the heights drawn (renderer: setGroundRelief), the finer tier streamed in once the camera
// is near — a flight flown while it loads would stand on another ground than the next (13 m after 30 s)
const settle = async (app: App, name: string) => {
  const f = FLIGHTS[name]!;
  await app.js(`(async () => { __bh.setDate(Date.UTC(2026, 9, 1, 12)); __bh.preset(${JSON.stringify(f.scene)}); ${f.setup}; return 0 })()`);
  await app.waitFor("__bh.renderer.earthSettled", 120_000);
};

describe.skipIf(!E2E)("the flight against the frame rate and its history", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot();
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  for (const name of ["entry-glide-edwards", "moon-takeoff", "iss-autodock", "orbit-retro-hold"])
    test(`${name}: 30 and 120 Hz agree`, async () => {
      const a = await fly(app, name, 30);
      const b = await fly(app, name, 120);
      expect(b.label).toBe(a.label);
      expect(b.auto).toBe(a.auto);
      // (measured: 9 m and 0.06 m/s after 30 s of entry; 5 m after the Moon's 20 s climb)
      expect(Math.abs(b.alt - a.alt), `${name} altitude ${a.alt} vs ${b.alt} m`).toBeLessThan(30);
      expect(Math.abs(b.speed - a.speed), `${name} speed ${a.speed} vs ${b.speed} m/s`).toBeLessThan(0.5);
    }, 120_000);

  test("a flight flown twice ends the same (nothing carried over)", async () => {
    await settle(app, "entry-glide-edwards");
    const a = await fly(app, "entry-glide-edwards", 30);
    await settle(app, "entry-glide-edwards");
    const b = await fly(app, "entry-glide-edwards", 30);
    expect(b.label).toBe(a.label);
    expect(b.auto).toBe(a.auto);
    expect(Math.abs(b.alt - a.alt), `altitude ${a.alt} vs ${b.alt} m`).toBeLessThan(10);
    expect(Math.abs(b.speed - a.speed), `speed ${a.speed} vs ${b.speed} m/s`).toBeLessThan(0.5);
  }, 300_000);
});
