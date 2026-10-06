// A flight's quality, measured from its telemetry (a scenario's folder: telemetry.jsonl, graphs.json) —
// what separates an autopilot that gets there from one that flies well: how hard it pulled (load factor,
// angle of attack), how calm it was (α's oscillations, bank reversals, throttle chatter), how long it held
// its assistant's corridor, what it spent (propellant, Δv), how long it took. The campaign adds these to
// every scenario's measures (q_… in the report), whatever the scenario judged.
import { existsSync, readFileSync } from "node:fs";
import type { Sample } from "./lab";

const jsonl = (f: string): Sample[] =>
  existsSync(f)
    ? readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

/** Reversals of a series' direction by more than `min` (its swings: an oscillation counts two a period). */
function reversals(v: number[], min: number) {
  let n = 0,
    dir = 0,
    ext = v[0] ?? 0;
  for (const x of v) {
    const d = x - ext;
    if (dir >= 0 && d < -min) {
      if (dir > 0) n++;
      dir = -1;
      ext = x;
    } else if (dir <= 0 && d > min) {
      if (dir < 0) n++;
      dir = 1;
      ext = x;
    } else if ((dir > 0 && x > ext) || (dir < 0 && x < ext) || dir === 0) ext = dir === 0 ? ext : x;
  }
  return n;
}

const round = (x: number, k = 100) => (Number.isFinite(x) ? Math.round(x * k) / k : null);

export function quality(dir: string): Record<string, number | null> {
  const T = jsonl(`${dir}/telemetry.jsonl`);
  if (T.length < 2) return {};
  const air = T.filter((S) => S.air?.body && (S.air?.q ?? 0) > 0.05);
  const num = (f: (S: Sample) => unknown, from = T) => from.map(f).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const max = (a: number[]) => (a.length ? Math.max(...a) : Number.NaN);
  const out: Record<string, number | null> = {
    q_shipS: round((T[T.length - 1]!.t ?? 0) - (T[0]!.t ?? 0), 1),
    q_gMax: round(max(num((S) => S.air?.g))),
    q_alphaMaxDeg: round(max(num((S) => Math.abs(S.air?.alpha), air))),
    q_alphaSwings: reversals(
      num((S) => S.air?.alpha, air),
      2,
    ),
    q_bankReversals: reversals(
      num((S) => S.bankCmd),
      15,
    ),
    q_qMaxKPa: round(max(num((S) => S.air?.q, air))),
    q_heatMaxKWm2: round(max(num((S) => S.air?.heat, air)), 1),
    q_throttleChanges: reversals(
      num((S) => S.thr),
      0.2,
    ),
    q_fuelUsed: round((T[0]!.fuel ?? Number.NaN) - (T[T.length - 1]!.fuel ?? Number.NaN), 1000),
    q_dvSpentMps: round((T[T.length - 1]!.spent ?? Number.NaN) - (T[0]!.spent ?? Number.NaN), 10),
  };
  // (each assistant's corridor: the share of the samples the craft was in it, of those it was judged)
  const G = existsSync(`${dir}/graphs.json`) ? JSON.parse(readFileSync(`${dir}/graphs.json`, "utf8")) : null;
  for (const [kind, pts] of Object.entries((G?.on ?? {}) as Record<string, [number, number, number, string][]>)) {
    const judged = pts.filter((p) => p[3] === "on" || p[3] === "off");
    if (judged.length >= 5) out[`q_corridor_${kind}_pct`] = round((100 * judged.filter((p) => p[3] === "on").length) / judged.length, 1);
  }
  for (const k of Object.keys(out)) if (out[k] === null || (typeof out[k] === "number" && Number.isNaN(out[k]))) delete out[k];
  return out;
}
