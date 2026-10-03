import { expect, test } from "bun:test";
import { defaultSettings } from "../src/settings";
import { drawSymbology, type SymInfo } from "../src/ui/hud/symbology";
import { recorder } from "./helpers/recorder";

// The HUD's conformal symbology drawn into a recording context: the heading where the nose points, the
// pitch ladder about the horizon, nothing of the pilot's instruments from outside or in the clean view,
// no NaN anywhere, every save restored.

type V3 = [number, number, number];
const deg = Math.PI / 180;
const W = 1600, H = 900;
const S = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** the camera pitched up by `pitch` and turned right to heading `hdg` [°] (camera axes: x right, y up, z ahead) */
function dirsFor(pitch: number, hdg: number): Record<string, V3> {
  const p = pitch * deg, h = hdg * deg;
  // (looking up, the world's up leans towards the line of sight)
  const up: V3 = [0, Math.cos(p), Math.sin(p)];
  // north, level, at heading 0 straight ahead; turned right by hdg it swings to the left
  const n0: V3 = [-Math.sin(h), 0, Math.cos(h)];
  const north: V3 = [n0[0], -n0[2] * Math.sin(p), n0[2] * Math.cos(p)];
  return { up, north };
}

function draw(i: Partial<SymInfo> & { dirs: SymInfo["dirs"] }, o: { outside?: boolean; density?: number } = {}) {
  const R = recorder();
  drawSymbology({ ctx: R.ctx, W, H, dpr: 1, fov: 60, s: defaultSettings(), outside: !!o.outside, density: o.density ?? 0, top: 60, i: { S, ...i } });
  return R;
}

test("level flight, nose north: the heading 000° boxed at the centre, the ±10° rungs symmetric about it", () => {
  const R = draw({ dirs: dirsFor(0, 0) });
  const box = R.find(/^\d{3}°$/)!;
  expect(box.text).toBe("000°");
  expect(box.x).toBeCloseTo(W / 2, 0);
  const up10 = R.texts.filter((t) => t.text === "10"), dn10 = R.texts.filter((t) => t.text === "-10");
  expect(up10.length).toBeGreaterThan(0);
  expect(dn10.length).toBeGreaterThan(0);
  expect(up10[0]!.y + dn10[0]!.y).toBeCloseTo(H, 0);
  expect(R.balanced()).toBe(true);
});

test("pitched up 10°: the 10° rung through the centre of the view", () => {
  const R = draw({ dirs: dirsFor(10, 0) });
  const r10 = R.texts.filter((t) => t.text === "10");
  expect(r10.length).toBeGreaterThan(0);
  expect(Math.abs(r10[0]!.y - H / 2)).toBeLessThan(4);
});

test("heading east: 090° in the box", () => {
  const R = draw({ dirs: dirsFor(0, 90) });
  expect(R.find(/^\d{3}°$/)!.text).toBe("090°");
});

test("from outside the ship, or in the clean view: no heading tape, no ladder", () => {
  for (const o of [{ outside: true }, { density: 2 }]) {
    const R = draw({ dirs: { ...dirsFor(0, 0), prograde: [0, 0.1, 0.995] } }, o);
    expect(R.has(/^\d{3}°$/)).toBe(false);
    expect(R.has(/^-?10$/)).toBe(false);
    expect(R.balanced()).toBe(true);
  }
});

test("no NaN in what is drawn, whatever the attitude", () => {
  for (const [p, h] of [[0, 0], [45, 30], [89.9, 180], [-89.9, 270], [180, 0]] as const) {
    const R = draw({ dirs: { ...dirsFor(p, h), prograde: [0.3, 0.2, 0.93], retrograde: [-0.3, -0.2, -0.93] } });
    for (const [x, y] of R.points) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    for (const t of R.texts) expect(Number.isFinite(t.x) && Number.isFinite(t.y)).toBe(true);
    expect(R.balanced()).toBe(true);
  }
});
