// Q6-ISS ISS2 — a live-stream camera's mount on the station from the structure its picture shows (docs/progress/refraction-
// horizons/Q6-ISS.md, "ISS2"). Above the limb space is black: there a lit pixel is the station's own structure. The camera's
// rays (its registry line of sight, picture's up and field — iss-cameras.ts issCameraFrame —, direct or mirrored) that rise over
// the limb's dip — the sky's cells — are compared: the picture's lit ones (lit in most frames) against the ones the game's
// station mesh (assets/iss/iss-lod1.bin, its parts at rest) covers within REACH_M from a candidate mount (a grid over a box of
// the station's frame: x ahead, y starboard, z nadir [m]), by their intersection over union (the overlays' boxes out; a mount
// inside a part, nearly every ray blocked, scores none).
//
//   bun scripts/iss-mount-fit.ts <id> <frames dir> <from HHMMSS> <to HHMMSS> [x0,x1,y0,y1,z0,z1] [step]
//   bun scripts/iss-mount-fit.ts sen-horizon ~/.kerr-lab/iss-corpus/dense-20261105-1059 105950 110830 10,18,0,10,2,8 0.5
//
// The frames are not the repository's (Sen's images: ~/.kerr-lab/iss-corpus); only the fitted numbers are reported. Their grey
// levels are read with Python's PIL (no image package in this repository).

import { readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { Vec3 } from "../src/physics";
import { TriBVH } from "../src/system/collide";
import { type IssCameraId, issCameraFrame } from "../src/system/iss-cameras";

const [id, dir, from, to, boxArg, stepArg] = process.argv.slice(2) as [IssCameraId, string, string, string, string?, string?];
const box = (boxArg ?? "10,18,0,10,2,8").split(",").map(Number);
const step = Number(stepArg ?? 0.5);
const GW = 96,
  GH = 54;
const REACH_M = 80;
const ALT_KM = 422;

// (the frames on the grid)
const files = readdirSync(dir)
  .filter((f) => f.startsWith(`${id.split("-")[0]}-`) && f.endsWith(".jpg"))
  .filter((f) => {
    const m = f.match(/T(\d{6})Z/);
    return m && m[1]! >= from && m[1]! <= to;
  })
  .sort();
if (files.length < 5) throw new Error(`${files.length} frames: too few`);
const py = Bun.spawnSync([
  "python3",
  "-I",
  "-c",
  "import sys,json\nfrom PIL import Image\nW,H=int(sys.argv[1]),int(sys.argv[2])\nprint(json.dumps([list(Image.open(f).convert('L').resize((W,H),Image.BILINEAR).getdata()) for f in sys.argv[3:]]))",
  String(GW),
  String(GH),
  ...files.map((f) => `${dir}/${f}`),
]);
const stack = (JSON.parse(py.stdout.toString()) as number[][]).map((a) => Float32Array.from(a));

// (a cell's ray, the station's frame; the sky's cells: rising over the limb's dip δ = acos(R / (R + h)))
const fr = issCameraFrame(id);
const tc = (2 * Math.tan((fr.fovDeg * Math.PI) / 360)) / GW;
const DIP = Math.acos(6371 / (6371 + ALT_KM));
const ray = (i: number, j: number, mirror: boolean): Vec3 => {
  const u = (i + 0.5 - GW / 2) * tc * (mirror ? -1 : 1),
    w = -(j + 0.5 - GH / 2) * tc;
  const d = [0, 1, 2].map((k) => fr.look[k]! + u * fr.right[k]! + w * fr.up[k]!) as Vec3;
  const l = Math.hypot(...d);
  return [d[0] / l, d[1] / l, d[2] / l];
};
const inRegion = (i: number, j: number) => {
  const x = (i + 0.5) / GW,
    y = (j + 0.5) / GH;
  if (Math.asin(-ray(i, j, false)[2]) < -DIP + 0.03) return false;
  if (x > 0.88 && y < 0.15) return false; // (Sen's logo)
  if (x > 0.02 && x < 0.11 && y > 0.04 && y < 0.1) return false; // (the LIVE badge)
  return true;
};
const real = new Uint8Array(GW * GH);
for (let p = 0; p < GW * GH; p++) {
  let lit = 0;
  for (const s of stack) if (s[p]! > 45) lit++;
  real[p] = lit > 0.6 * stack.length ? 1 : 0;
}
let region = 0,
  lit = 0,
  ascii = "";
for (let j = 0; j < GH; j++)
  for (let i = 0; i < GW; i++)
    if (inRegion(i, j)) {
      region++;
      lit += real[j * GW + i]!;
    }
for (let j = 0; j < GH; j += 3) {
  for (let i = 0; i < GW; i += 2) ascii += !inRegion(i, j) ? " " : real[j * GW + i] ? "#" : ".";
  ascii += "\n";
}
console.log(`${files.length} frames; ${region} sky cells, ${lit} of them lit (the structure's)\n${ascii}`);

// (the station's mesh, its parts at rest)
const raw = gunzipSync(new Uint8Array(await Bun.file(new URL("../assets/iss/iss-lod1.bin", import.meta.url)).arrayBuffer()));
const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
const u32 = new Uint32Array(buf, 0, 6);
const [nv, ni, nj, np] = [u32[2]!, u32[3]!, u32[4]!, u32[5]!];
const off = 24 + nj * 48 + np * 32;
const fl = new Float32Array(buf, off, (nv * 24) / 4);
const pos = new Float32Array(nv * 3);
for (let k = 0; k < nv; k++) pos.set(fl.subarray(6 * k, 6 * k + 3), 3 * k);
const bvh = new TriBVH(pos, new Uint32Array(buf, off + nv * 24, ni));

const score = (m: Vec3, mirror: boolean) => {
  let inter = 0,
    uni = 0,
    hits = 0,
    n = 0;
  for (let j = 0; j < GH; j++)
    for (let i = 0; i < GW; i++) {
      if (!inRegion(i, j)) continue;
      const d = ray(i, j, mirror);
      const hit = bvh.segment(m, [m[0] + d[0] * REACH_M, m[1] + d[1] * REACH_M, m[2] + d[2] * REACH_M]) ? 1 : 0;
      hits += hit;
      n++;
      const r = real[j * GW + i]!;
      if (hit && r) inter++;
      if (hit || r) uni++;
    }
  return hits > 0.9 * n ? 0 : inter / Math.max(uni, 1);
};

const results: { m: Vec3; mirror: boolean; iou: number }[] = [];
for (let x = box[0]!; x <= box[1]! + 1e-9; x += step)
  for (let y = box[2]!; y <= box[3]! + 1e-9; y += step)
    for (let z = box[4]!; z <= box[5]! + 1e-9; z += step)
      for (const mirror of process.env.MOUNT_DIRECT ? [false] : [false, true]) results.push({ m: [x, y, z], mirror, iou: score([x, y, z], mirror) });
results.sort((a, b) => b.iou - a.iou);
console.log(
  `registry mount [${fr.mount.join(", ")}]: IoU direct ${score(fr.mount, false).toFixed(3)}, mirrored ${score(fr.mount, true).toFixed(3)}`,
);
for (const r of results.slice(0, 10))
  console.log(`mount [${r.m.map((v) => v.toFixed(1)).join(", ")}] ${r.mirror ? "mirrored" : "direct"}\tIoU ${r.iou.toFixed(3)}`);
