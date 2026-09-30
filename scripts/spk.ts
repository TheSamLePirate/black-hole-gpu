// NASA/JPL NAIF's SPK files (DAF, little-endian): their type-2 segments (Chebyshev positions) read and
// evaluated — scripts/build-ephemeris.ts refits the app's ephemerides from them.

export interface Seg { target: number; center: number; et0: number; et1: number; init: number; intlen: number; rsize: number; n: number; data: Float64Array }

export async function readSpk(path: string): Promise<Seg[]> {
  const buf = await Bun.file(path).arrayBuffer();
  const dv = new DataView(buf);
  const id = new TextDecoder().decode(new Uint8Array(buf, 0, 8));
  const fmt = new TextDecoder().decode(new Uint8Array(buf, 88, 8));
  if (!id.startsWith("DAF/SPK") || fmt !== "LTL-IEEE") throw new Error(`${path}: not a little-endian SPK (${id}, ${fmt})`);
  const ND = dv.getInt32(8, true), NI = dv.getInt32(12, true);
  const SS = ND + Math.ceil(NI / 2);
  const out: Seg[] = [];
  for (let rec = dv.getInt32(76, true); rec; ) {
    const o = (rec - 1) * 1024;
    const nsum = dv.getFloat64(o + 16, true);
    for (let i = 0; i < nsum; i++) {
      const so = o + 24 + i * SS * 8;
      const et0 = dv.getFloat64(so, true), et1 = dv.getFloat64(so + 8, true);
      const [target, center, frame, type, a0, a1] = [0, 1, 2, 3, 4, 5].map((k) => dv.getInt32(so + 16 + 4 * k, true)) as number[];
      if (frame !== 1 || type !== 2) continue; // (J2000, Chebyshev position only)
      const data = new Float64Array(buf.slice((a0! - 1) * 8, a1! * 8));
      const [init, intlen, rsize, n] = data.slice(-4) as unknown as number[];
      out.push({ target: target!, center: center!, et0, et1, init: init!, intlen: intlen!, rsize: rsize!, n: n!, data });
    }
    rec = dv.getFloat64(o, true);
  }
  return out;
}

/** A segment's position [km, J2000 equatorial] at ET [TDB s past J2000]. */
export function evalSeg(s: Seg, et: number): [number, number, number] {
  const i = Math.min(s.n - 1, Math.max(0, Math.floor((et - s.init) / s.intlen)));
  const o = i * s.rsize;
  const mid = s.data[o]!, rad = s.data[o + 1]!;
  const x = (et - mid) / rad;
  const deg1 = (s.rsize - 2) / 3;
  const r: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let t0 = 1, t1 = x, sum = s.data[o + 2 + c * deg1]!;
    if (deg1 > 1) sum += s.data[o + 3 + c * deg1]! * x;
    for (let k = 2; k < deg1; k++) {
      const t2 = 2 * x * t1 - t0;
      sum += s.data[o + 2 + c * deg1 + k]! * t2;
      t0 = t1;
      t1 = t2;
    }
    r[c] = sum;
  }
  return r;
}

