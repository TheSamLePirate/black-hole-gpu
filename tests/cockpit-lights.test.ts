import { expect, test } from "bun:test";
import { cabinUniform, displayColours, lampsOf, SCREEN_LIGHTS, screenLights } from "../src/cockpit/lights";

// PLAN-COCKPIT K6: the cabin's light — the screens before the pilots as lights (from the cabin's own mesh),
// their colours (each display's mean), the lamps' level and red, the shader's uniform.

async function cabin() {
  const raw = await Bun.file(`${import.meta.dir}/../assets/ranger/cockpit.bin`).arrayBuffer();
  const ab = new TextDecoder().decode(new Uint8Array(raw, 0, 4)) === "CKPT" ? raw : Bun.gunzipSync(new Uint8Array(raw)).buffer;
  const [ver, nv, ni] = new Uint32Array(ab, 4, 3) as unknown as [number, number, number];
  const off = ver >= 2 ? 44 + 16 * new Uint32Array(ab, 40, 1)[0]! : 40;
  return {
    verts: new Float32Array(ab.slice(off, off + nv * 40)),
    idx: new Uint32Array(ab.slice(off + nv * 40, off + nv * 40 + ni * 4)),
  };
}

test("the screen lights: the screens before the pilots, grouped — facing into the cabin, each display's share", async () => {
  const { verts, idx } = await cabin();
  const L = screenLights(verts, idx);
  expect(L.length).toBeGreaterThanOrEqual(5);
  expect(L.length).toBeLessThanOrEqual(SCREEN_LIGHTS);
  for (const s of L) {
    expect(s.c[2]).toBeGreaterThan(2.2);
    expect(Math.hypot(...s.n)).toBeCloseTo(1, 6);
    // (facing the pilots' heads)
    const to = [0 - s.c[0], 1.4 - s.c[1], 2.0 - s.c[2]];
    expect(to[0]! * s.n[0] + to[1]! * s.n[1] + to[2]! * s.n[2]).toBeGreaterThan(0);
    expect(s.members.reduce((a, m) => a + m.area, 0)).toBeCloseTo(s.area, 9);
    for (const m of s.members) expect(m.slot).toBeLessThan(8);
  }
  // (the dashboard's two, left and right of the middle)
  expect(L.filter((s) => s.c[2] > 3.7 && Math.abs(s.c[0]) < 1.2 && Math.abs(s.c[0]) > 0.5).length).toBe(2);
});

test("the displays' colours: each one's mean, linear; the lamps; the uniform's layout", () => {
  // (a 4 × 2 picture of 8 × 8 px displays: the first white, the sixth half-covered pure red, the rest clear)
  const w = 32,
    h = 16;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px.set([255, 255, 255, 255], 4 * (y * w + x));
  for (let y = 8; y < 12; y++) for (let x = 8; x < 16; x++) px.set([255, 0, 0, 255], 4 * (y * w + x));
  const c = displayColours(px, w, h);
  expect([...c.subarray(0, 3)]).toEqual([1, 1, 1]);
  expect(c[15]).toBeCloseTo(0.5, 9);
  expect(c[16]).toBe(0);
  expect(c[3]).toBe(0);
  expect(lampsOf({ cabinLight: 0.8, nightLighting: false })).toMatchObject({ level: 0.8, red: 0 });
  const red = lampsOf({ cabinLight: 0.8, nightLighting: true });
  expect(red.red).toBe(1);
  expect(red.level).toBeLessThan(0.5);
  const L = [
    {
      c: [1, 2, 3] as [number, number, number],
      n: [0, 0, -1] as [number, number, number],
      area: 0.4,
      members: [
        { slot: 0, area: 0.1 },
        { slot: 5, area: 0.3 },
      ],
    },
  ];
  const u = cabinUniform({ level: 0.5, red: 0 }, L, c);
  expect(u.length).toBe(4 + SCREEN_LIGHTS * 12);
  expect([...u.subarray(0, 4)]).toEqual([0.5, 0, 1, 1]);
  expect([...u.subarray(4, 12)]).toEqual([1, 2, 3, Math.fround(0.4), 0, 0, -1, 0]);
  // (its colour: a quarter white, three quarters the half red)
  expect(u[12]).toBeCloseTo(0.25 + 0.75 * 0.5, 6);
  expect(u[13]).toBeCloseTo(0.25, 6);
});
