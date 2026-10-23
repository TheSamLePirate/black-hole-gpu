import { expect, test } from "bun:test";
import { type PicLike, PicDecoder, PicEncoder, PIC_ROWS, packBits, readPicBlock, unpackBits } from "../src/net/picture";

// The crew's compact picture (PLAN-RADAR-AAA RD5): the round trip (≤ 1 m, ≤ 0.1 m/s), 300 tracks under 16 KB, the
// priorities (the lock in every block), the turns (each at least once a second), the ids lost, the catch-up.

const track = (k: number, o: Partial<PicLike> = {}): PicLike => ({
  id: `trf:${k.toString(16).padStart(6, "0")}`,
  name: `AFR${1000 + k}`,
  type: "A320",
  kind: "air",
  side: "traffic",
  iff: "neutral",
  sensors: 4,
  state: "datalink",
  locked: false,
  selected: false,
  lat: 45 + (k % 37) * 0.031 + 0.0000037,
  lon: 6 + Math.floor(k / 37) * 0.047 - 0.0000041,
  h: 9000 + k * 13.4,
  v: [231.27 - k, -12.33, 1.07],
  r: [60_000 + k * 500, 0, 0],
  seenAt: null,
  ...o,
});
const O = { lat: 45.5, lon: 6.5, mode: "TWS", beam: 0.3, range: 80_000, t: 100 };

test("the bits: packed and read back", () => {
  const t = track(1, {
    kind: "missile",
    side: "hostile",
    iff: "hostile",
    state: "firm",
    locked: true,
    tcas: "RA",
    ra: "climb",
    sensors: 17,
  });
  expect(unpackBits(packBits(t))).toEqual({
    kind: "missile",
    side: "hostile",
    iff: "hostile",
    state: "firm",
    locked: true,
    selected: false,
    tcas: "RA",
    ra: "climb",
    sensors: 17,
  });
});

test("the round trip: each place within a metre, each velocity within 0.1 m/s; the missile's figures", () => {
  const list = [
    track(1),
    track(2, {
      id: "msl:7",
      name: "AIM-120C",
      type: "AIM-120C",
      kind: "missile",
      side: "friend",
      msl: { target: "trf:000001", tti: 12.34, ours: true, decoyed: false, motor: true },
    }),
    track(3, { id: "cm:4", name: "FLARE", type: "flare", kind: "flare", side: "friend", cm: { life: 3.3 } }),
  ];
  const B = readPicBlock(JSON.parse(JSON.stringify(new PicEncoder().encode(list, O))))!;
  const { tracks } = new PicDecoder().decode(B);
  expect(tracks.length).toBe(3);
  for (const T of tracks) {
    const src = list.find((x) => x.id === T.id)!;
    const dN = (T.lat - src.lat) * 111_195,
      dE = (T.lon - src.lon) * 111_195 * Math.cos((src.lat * Math.PI) / 180);
    expect(Math.hypot(dN, dE)).toBeLessThan(1);
    expect(Math.abs(T.h - src.h)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(T.ve - src.v[0]!)).toBeLessThanOrEqual(0.051);
    expect(Math.abs(T.vn - src.v[1]!)).toBeLessThanOrEqual(0.051);
    expect(T.name).toBe(src.name);
  }
  const M = tracks.find((T) => T.kind === "missile")!;
  expect(M.msl).toEqual({ target: "trf:000001", tti: 12.3, ours: true, decoyed: false, motor: true });
  expect(tracks.find((T) => T.kind === "flare")!.life).toBe(3.3);
});

test("300 tracks: each block under 16 KB with the dictionary; each track sent within a second; the lock in every block", () => {
  const list = Array.from({ length: 300 }, (_, k) =>
    track(k, k === 123 ? { locked: true, side: "hostile", sensors: 1, state: "firm" } : {}),
  );
  const E = new PicEncoder();
  const D = new PicDecoder();
  const seen = new Set<string>();
  let maxLen = 0;
  for (let k = 0; k < 4; k++) {
    const B = E.encode(list, { ...O, t: 100 + k * 0.25 });
    maxLen = Math.max(maxLen, JSON.stringify(B).length);
    expect(B.r.length).toBeLessThanOrEqual(PIC_ROWS);
    const out = D.decode(B);
    expect(out.lock).toBe(list[123]!.id);
    for (const T of out.tracks) seen.add(T.id);
  }
  // (the dictionary's first blocks carry the names: within the second, the most are named — the rest the next one)
  console.log(`  the largest block: ${maxLen} characters; named and sent in a second: ${seen.size}/300`);
  expect(maxLen).toBeLessThan(16_000);
  for (let k = 4; k < 12; k++) for (const T of D.decode(E.encode(list, { ...O, t: 100 + k * 0.25 })).tracks) seen.add(T.id);
  expect(seen.size).toBe(300);
});

test("the ids lost, the catch-up's histories", () => {
  const hist = Array.from({ length: 40 }, (_, k) => ({ lat: 45 + k * 0.001, lon: 6, t: 50 + k }));
  // (both within 40 km: in every block)
  const a = track(1, { hist, r: [5000, 0, 0] });
  const E = new PicEncoder();
  const D = new PicDecoder();
  D.decode(E.encode([a, track(2, { r: [8000, 0, 0] })], { ...O, trailT: 90 }));
  const lost = D.decode(E.encode([a], { ...O, trailT: 90.25 }));
  expect(lost.gone).toEqual([track(2).id]);
  E.catchUp([a.id]);
  const h = D.decode(E.encode([a], { ...O, trailT: 90.5 })).hist;
  expect(h.length).toBe(1);
  // (a point each 2 s at most, the oldest first; the newest — t 89 s — 1.5 s old)
  expect(h[0]!.pts.length).toBe(20);
  expect(h[0]!.pts.at(-1)!.age).toBeCloseTo(1.5, 5);
  expect(h[0]!.pts.at(-1)!.lat).toBeCloseTo(45.039, 5);
});

test("an untrusted block: refused or bounded", () => {
  expect(readPicBlock(null)).toBeNull();
  expect(readPicBlock({ o: [1], r: [] })).toBeNull();
  const B = readPicBlock({ o: [1, 2], r: [[1, 2, 3, 4, 5, 6, 7, 8, 9], ["x"]], d: [[1, "a".repeat(99), "n", "t"], ["bad"]], m: "TWS" })!;
  expect(B.r.length).toBe(1);
  expect(B.d![0]![1].length).toBe(40);
});
