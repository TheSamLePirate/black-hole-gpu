// The A320's flight deck (docs/PLAN-A320.md, A5 — scripts/build-a320-cockpit.py → assets/a320/a320-cockpit.bin,
// src/a320/deck.ts): the mesh as built (its rig, its controls, its objects, its displays' cells), the properties the
// flight gives it (the gear lever's travel, the thrust levers, the autobrake's lights), and its rig moving what they
// move (the side stick aft, a light shown or hidden).
import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { DeckPoser, type DeckInputs, type DeckMesh, parseDeck } from "../src/a320/deck";
import { leverAngle } from "../src/a320/fadec";
import { partCount, rigMatrices } from "../src/a320/rig";

const load = async (): Promise<DeckMesh> => {
  const b = gunzipSync(new Uint8Array(await Bun.file("assets/a320/a320-cockpit.bin").arrayBuffer()));
  return parseDeck(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const inputs = (o: Partial<DeckInputs> = {}): DeckInputs => ({
  dt: 1 / 60,
  stick: [0, 0],
  pedals: 0,
  tiller: 0,
  gearDown: true,
  fcs: null,
  lever: 0,
  reverse: 0,
  flapLever: 0,
  speedBrake: 0,
  spoilersArmed: false,
  parkBrake: false,
  powered: true,
  ...o,
});
/** a vertex k posed by the rig's maps (rows of 3 × 4, its part's) */
const posed = (m: DeckMesh, mats: Float32Array, k: number) => {
  const p = Math.floor(m.verts[10 * k + 7]!);
  const r = 12 * p;
  const x = m.verts[10 * k]!,
    y = m.verts[10 * k + 1]!,
    z = m.verts[10 * k + 2]!;
  return [0, 1, 2].map((i) => mats[r + 4 * i]! * x + mats[r + 4 * i + 1]! * y + mats[r + 4 * i + 2]! * z + mats[r + 4 * i + 3]!);
};
/** the vertices of an object's triangles */
const verticesOf = (m: DeckMesh, name: string) => {
  const o = m.objects.indexOf(name);
  const out = new Set<number>();
  for (let t = 0; t < m.triObj.length; t++) if (m.triObj[t] === o) for (let c = 0; c < 3; c++) out.add(m.idx[3 * t + c]!);
  return [...out];
};

describe("A320 flight deck", () => {
  test("the mesh: in the nose, its rig, its controls, its displays' cells", async () => {
    const m = await load();
    // (the deck between the nose's frames: 15 to 17.5 m ahead of the reference, the eye inside it)
    expect(m.lo[2]).toBeGreaterThan(14.5);
    expect(m.hi[2]).toBeLessThan(17.6);
    expect(m.hi[0] - m.lo[0]).toBeLessThan(3.4);
    expect(m.nodes.length).toBeGreaterThan(1000);
    expect(m.controls.length).toBeGreaterThan(480);
    expect(m.triObj.length).toBe(m.idx.length / 3);
    expect(Math.max(...m.triObj)).toBeLessThan(m.objects.length);
    // (every vertex's part a node or the deck itself, every material the deck's)
    for (let i = 0; i < m.verts.length; i += 10) {
      expect(Math.floor(m.verts[i + 7]!)).toBeLessThan(partCount(m));
      expect(m.verts[i + 6]!).toBeGreaterThanOrEqual(120);
      expect(m.verts[i + 6]!).toBeLessThan(140);
    }
    for (const k of ["PFD1", "ND1", "UECAM", "LECAM", "ND2", "PFD2", "MCDU1", "MCDU2", "IESI", "DCDU1", "DCDU2"]) {
      const [u, v, w, h] = m.screens[k]!;
      expect(u + w).toBeLessThanOrEqual(1);
      expect(v + h).toBeLessThanOrEqual(1);
    }
  });

  test("the levers: the gear lever's travel, the thrust levers' angle, the autobrake's lights", () => {
    const P = new DeckPoser();
    let t = 0;
    let p = P.step(inputs({ gearDown: false, dt: 1 }));
    expect(p["controls/cockpit/gear-lever"]).toBe(0);
    // (down: pulled out, moved, pushed in — 3 at 4.5 a second)
    while (Number(p["controls/cockpit/gear-lever"]) < 3) {
      p = P.step(inputs({ gearDown: true }));
      t += 1 / 60;
    }
    expect(t).toBeCloseTo(3 / 4.5, 1);
    p = P.step(inputs({ lever: 1 }));
    expect(p["controls/cockpit/throttle-lever[0]"]).toBeCloseTo(leverAngle(1) / 45, 6);
    p = P.step(inputs({ fcs: { autobrake: 2 } as never }));
    expect(p["controls/indicators/autobrake-med-on"]).toBe(1);
    expect(p["controls/indicators/autobrake-low-on"]).toBe(0);
  });

  test("the rig: the side stick pulled aft, a light shown by its system", async () => {
    const m = await load();
    const P = new DeckPoser();
    const rest = rigMatrices(m, { ...P.step(inputs({ dt: 1 })) }, {});
    const aft = rigMatrices(m, { ...new DeckPoser().step(inputs({ dt: 1, stick: [1, 0] })) }, {});
    // (the stick's grip: its highest vertices, moved aft — the ship's z the nose)
    const vs = verticesOf(m, "sidestick_1");
    expect(vs.length).toBeGreaterThan(0);
    const top = vs.reduce((a, b) => (m.verts[10 * b + 1]! > m.verts[10 * a + 1]! ? b : a));
    const dz = posed(m, aft, top)[2]! - posed(m, rest, top)[2]!;
    expect(dz).toBeLessThan(-0.01);
    // (the autobrake's LO light: hidden at rest, shown when armed)
    const lo = verticesOf(m, "abs_low_on")[0]!;
    const part = Math.floor(m.verts[10 * lo + 7]!);
    const zero = (mats: Float32Array) => mats.slice(12 * part, 12 * part + 12).every((x) => x === 0);
    expect(zero(rest)).toBeTrue();
    const armed = rigMatrices(m, { ...new DeckPoser().step(inputs({ dt: 1, fcs: { autobrake: 1 } as never })) }, {});
    expect(zero(armed)).toBeFalse();
  });
});
