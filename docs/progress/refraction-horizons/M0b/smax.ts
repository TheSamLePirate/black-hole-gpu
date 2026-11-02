// M0b: S_max per body — the steepest slope of each drawn component (global DEM at its texel; the procedural craters at 0.25 m)
import { gunzipSync } from "node:zlib";
import { craterRelief } from "/Users/olivierveinand/Documents/DEV/black-hole-gpu/src/terrain";
const root = "/Users/olivierveinand/Documents/DEV/black-hole-gpu/assets/planets-hd/";
const R: Record<string, number> = { moon: 1737.4e3, mars: 3389.5e3, mercury: 2439.7e3, ceres: 470e3, venus: 6051.8e3 };
const out: Record<string, unknown> = {};
for (const b of ["moon", "mars", "mercury", "ceres"]) {
  const buf = gunzipSync(await Bun.file(`${root}${b}-dem.bin`).arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const W = dv.getUint32(4, true), H = dv.getUint32(8, true), n = W * H;
  const lo = new Uint8Array(buf.buffer, buf.byteOffset + 16, n), hi = new Uint8Array(buf.buffer, buf.byteOffset + 16 + n, n);
  const map = new Int16Array(n);
  for (let y = 0; y < H; y++) { let v = 0; for (let x = 0, o = y * W; x < W; x++, o++) map[o] = v = v + (((lo[o]! | (hi[o]! << 8)) << 16) >> 16); }
  const dy = (Math.PI * R[b]!) / H;
  const s: number[] = [];
  for (let y = 1; y < H - 1; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI, dx = ((2 * Math.PI * R[b]!) / W) * Math.max(Math.cos(lat), 0.05);
    for (let x = 0; x < W; x++) {
      const gx = (map[y * W + ((x + 1) % W)]! - map[y * W + ((x - 1 + W) % W)]!) / (2 * dx);
      const gy = (map[(y + 1) * W + x]! - map[(y - 1) * W + x]!) / (2 * dy);
      s.push(Math.hypot(gx, gy));
    }
  }
  s.sort((a, c) => a - c);
  const deg = (g: number) => +((Math.atan(g) * 180) / Math.PI).toFixed(1);
  out[b] = { W, H, texelKm: +(dy / 1000).toFixed(2), demMaxDeg: deg(s.at(-1)!), dem999Deg: deg(s[Math.floor(0.999 * s.length)]!), dem99Deg: deg(s[Math.floor(0.99 * s.length)]!) };
}
// the procedural craters (and rocks, moonOwn, the 90 m swell — all of craterRelief): finite differences at 0.25 m, 200 000 points
const IDX: Record<string, number> = { moon: 1, mars: 2, mercury: 3, ceres: 12 };
for (const b of ["moon", "mercury", "ceres", "mars"]) {
  const m = IDX[b]!, mR = R[b]!, e = 0.25;
  let worst = 0; const all: number[] = [];
  for (let i = 0; i < 200000; i++) {
    const z = 2 * Math.random() - 1, t = 2 * Math.PI * Math.random(), c = Math.sqrt(1 - z * z);
    const q: [number, number, number] = [c * Math.cos(t), c * Math.sin(t), z];
    const east: [number, number, number] = [-Math.sin(t), Math.cos(t), 0];
    const step = (d: [number, number, number], k: number): [number, number, number] => { const p = [q[0] + d[0] * k, q[1] + d[1] * k, q[2] + d[2] * k]; const l = Math.hypot(...p); return [p[0]! / l, p[1]! / l, p[2]! / l]; };
    const h0 = craterRelief(m, q, mR, 0.05), h1 = craterRelief(m, step(east, e / mR), mR, 0.05);
    const g = Math.abs(h1 - h0) / e; all.push(g); if (g > worst) worst = g;
  }
  all.sort((a, c) => a - c);
  const deg = (g: number) => +((Math.atan(g) * 180) / Math.PI).toFixed(1);
  (out[b] as Record<string, unknown>).proceduralMaxDeg = deg(worst);
  (out[b] as Record<string, unknown>).procedural999Deg = deg(all[Math.floor(0.999 * all.length)]!);
  (out[b] as Record<string, unknown>).procedural99Deg = deg(all[Math.floor(0.99 * all.length)]!);
}
console.log(JSON.stringify(out, null, 1));
await Bun.write("/tmp/smax/smax.json", JSON.stringify(out, null, 1));
