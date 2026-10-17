// The land, filled: the coastlines' lines (Natural Earth's) stitched into rings once — their pieces joined end to end
// across the antimeridian, the longitudes made continuous (a ring may pass 180°), Antarctica closed by its pole.
import coastlines from "../coastlines.json";

export interface Ring {
  pts: [number, number][];
  lo: number;
  hi: number;
}

const key = (p: number[]) => `${Math.abs(p[0]!) === 180 ? 180 : p[0]}:${p[1]}`;

function stitch(lines: number[][][]): Ring[] {
  const open = lines.filter((l) => key(l[0]!) !== key(l.at(-1)!) && l.length > 1);
  const rings: [number, number][][] = lines
    .filter((l) => key(l[0]!) === key(l.at(-1)!) && l.length > 3)
    .map((l) => l.map((p) => [p[0]!, p[1]!]));
  const used = new Set<number>();
  for (let i = 0; i < open.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const ring: [number, number][] = open[i]!.map((p) => [p[0]!, p[1]!]);
    const start = key(ring[0]!);
    for (let guard = 0; guard < open.length && key(ring.at(-1)!) !== start; guard++) {
      const end = key(ring.at(-1)!);
      const j = open.findIndex((l, k) => !used.has(k) && key(l[0]!) === end);
      if (j < 0) break;
      used.add(j);
      for (const p of open[j]!.slice(1)) ring.push([p[0]!, p[1]!]);
    }
    rings.push(ring);
  }
  // the longitudes made continuous; a ring around the pole closed through it
  return rings.map((r) => {
    for (let k = 1; k < r.length; k++) {
      while (r[k]![0] - r[k - 1]![0] > 180) r[k]![0] -= 360;
      while (r[k]![0] - r[k - 1]![0] < -180) r[k]![0] += 360;
    }
    const span = r.at(-1)![0] - r[0]![0];
    if (Math.abs(span) > 300) {
      const pole = r[0]![1] < 0 ? -90 : 90;
      r.push([r.at(-1)![0], pole], [r[0]![0], pole]);
    }
    let lo = Infinity,
      hi = -Infinity;
    for (const p of r) {
      lo = Math.min(lo, p[0]);
      hi = Math.max(hi, p[0]);
    }
    return { pts: r, lo, hi };
  });
}

export const LAND = stitch(coastlines as number[][][]);
