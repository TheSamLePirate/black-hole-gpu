// The WebM writer (video.ts, PLAN-MODES-AAA M8): its EBML sizes, and a file read back — the header, the segment, the
// seek head pointing at the info, the track and the cues, a cluster per key frame, the cues at each cluster.
import { expect, test } from "bun:test";
import { ebmlSize, WebmWriter } from "../src/video";

test("EBML sizes: the shortest variable-length integer", () => {
  expect([...ebmlSize(0)]).toEqual([0x80]);
  expect([...ebmlSize(126)]).toEqual([0xfe]);
  expect([...ebmlSize(127)]).toEqual([0x40, 0x7f]);
  expect([...ebmlSize(16382)]).toEqual([0x7f, 0xfe]);
  expect([...ebmlSize(16383)]).toEqual([0x20, 0x3f, 0xff]);
});

/** A tiny EBML reader: the elements in [from, to) — id, payload offset and length. */
function read(b: Uint8Array, from: number, to: number) {
  const out: { id: number; at: number; len: number; start: number }[] = [];
  let p = from;
  while (p < to) {
    const start = p;
    const idLen = Math.clz32(b[p]!) - 23;
    let id = 0;
    for (let i = 0; i < idLen; i++) id = id * 256 + b[p + i]!;
    p += idLen;
    const sLen = Math.clz32(b[p]!) - 23;
    let len = b[p]! & (0xff >> sLen);
    for (let i = 1; i < sLen; i++) len = len * 256 + b[p + i]!;
    p += sLen;
    out.push({ id, at: p, len, start });
    p += len;
  }
  expect(p).toBe(to);
  return out;
}
const num = (b: Uint8Array, at: number, len: number) => {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + b[at + i]!;
  return v;
};

test("a WebM file read back: segment, seek head, clusters per key frame, cues", async () => {
  const w = new WebmWriter(64, 36, 30, "V_VP9");
  for (let i = 0; i < 90; i++)
    w.add({ data: new Uint8Array(i % 30 === 0 ? 400 : 50).fill(i), key: i % 30 === 0, timestampUs: Math.round((i * 1e6) / 30) });
  const blob = w.finish();
  expect(blob.type).toBe("video/webm");
  const b = new Uint8Array(await blob.arrayBuffer());
  const top = read(b, 0, b.length);
  expect(top.map((e) => e.id)).toEqual([0x1a45dfa3, 0x18538067]);
  const seg = top[1]!;
  const kids = read(b, seg.at, seg.at + seg.len);
  expect(kids.map((e) => e.id)).toEqual([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1f43b675, 0x1f43b675, 0x1c53bb6b]);
  // (the seek head's positions: each element's start from the segment's payload)
  for (const s of read(b, kids[0]!.at, kids[0]!.at + kids[0]!.len)) {
    const [idE, posE] = read(b, s.at, s.at + s.len);
    const id = num(b, idE!.at, idE!.len);
    const pos = num(b, posE!.at, posE!.len);
    expect(kids.find((k) => k.start - seg.at === pos)!.id).toBe(id);
  }
  // (each cluster: its time, then 30 blocks, the first a key frame)
  const clusters = kids.filter((k) => k.id === 0x1f43b675);
  clusters.forEach((c, i) => {
    const [time, ...blocks] = read(b, c.at, c.at + c.len);
    expect(num(b, time!.at, time!.len)).toBe(i * 1000);
    expect(blocks.length).toBe(30);
    expect(b[blocks[0]!.at + 3]).toBe(0x80);
    expect(b[blocks[1]!.at + 3]).toBe(0);
  });
  // (the cues: one per cluster, at its place)
  const cues = read(b, kids[6]!.at, kids[6]!.at + kids[6]!.len);
  expect(cues.length).toBe(3);
  cues.forEach((cp, i) => {
    const [, pos] = read(b, cp.at, cp.at + cp.len);
    const [, at] = read(b, pos!.at, pos!.at + pos!.len);
    expect(num(b, at!.at, at!.len)).toBe(clusters[i]!.start - seg.at);
  });
});
