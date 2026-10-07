// The hub card's trends (PLAN-HUB HB2): beside a row's value, ▲ or ▼ when it has moved over the last
// second by at least the last digit it is written to — the same for every row of every autopilot, the
// card's producers writing only their values. Pure: the HUD gives each row's name, its text and the time.

/** The units a trend is shown for, each with its factor to a common one (km → m: a row going from metres
 *  to kilometres keeps its trend) — counted-down times (s, min, h) left out: they always fall. */
const UNITS: Record<string, [string, number]> = {
  m: ["m", 1],
  km: ["m", 1e3],
  "m/s": ["m/s", 1],
  "km/s": ["m/s", 1e3],
  g: ["g", 1],
  kPa: ["kPa", 1],
  "W/cm²": ["W/cm²", 1],
  K: ["K", 1],
  "°": ["°", 1],
  "°/s": ["°/s", 1],
  "%": ["%", 1],
};

export interface Quantity {
  /** the value in its unit's common one */
  x: number;
  unit: string;
  /** the written value's last digit, in the common unit */
  step: number;
}

/**
 * A row's value read as one quantity — "24.2 km", "−0.6 m/s", "44.6°", "15,672 km" —, or null: words
 * first, several figures ("19.1 m · 4.47 m", "cmd 43° · now 49°"), a time, a trend already written.
 */
export function quantity(text: string): Quantity | null {
  if (/[·→▲▼×]/.test(text)) return null;
  const m = /^\s*([+\-−]?)(\d[\d,]*)(?:\.(\d+))?\s*(km\/s|m\/s|°\/s|W\/cm²|kPa|km|m|g|K|°|%)\s*$/.exec(text);
  if (!m) return null;
  const [, sign, int, frac = "", u] = m;
  const [unit, k] = UNITS[u!]!;
  const x = (sign ? -1 : 1) * Number(`${int!.replace(/,/g, "")}.${frac || "0"}`);
  return { x: x * k, unit, step: 10 ** -frac.length * k };
}

/** How long a row's past is kept [ms], how far back it is compared [ms], how long an arrow stays [ms]. */
const KEEP = 3000,
  BACK = 1000,
  HOLD = 1500;

export class Trends {
  private past = new Map<string, { t: number; q: Quantity }[]>();
  private shown = new Map<string, { a: "▲" | "▼"; until: number }>();

  /** A row's arrow now ("" none): its value against what it was a second ago, by its last digit at least. */
  arrow(key: string, text: string, now: number): "▲" | "▼" | "" {
    const q = quantity(text);
    if (!q) {
      this.past.delete(key);
      this.shown.delete(key);
      return "";
    }
    let P = this.past.get(key);
    if (!P || (P.length && P[P.length - 1]!.q.unit !== q.unit)) this.past.set(key, (P = []));
    if (!P.length || now - P[P.length - 1]!.t >= 100) P.push({ t: now, q });
    while (P.length > 1 && now - P[0]!.t > KEEP) P.shift();
    // (the sample at least a second old — the newest such —, else none yet)
    let ref: Quantity | null = null;
    for (let i = P.length - 1; i >= 0; i--)
      if (now - P[i]!.t >= BACK) {
        ref = P[i]!.q;
        break;
      }
    if (ref) {
      const d = q.x - ref.x;
      if (Math.abs(d) >= Math.max(q.step, ref.step) - 1e-9) this.shown.set(key, { a: d > 0 ? "▲" : "▼", until: now + HOLD });
    }
    const s = this.shown.get(key);
    if (!s) return "";
    if (now > s.until) {
      this.shown.delete(key);
      return "";
    }
    return s.a;
  }

  /** Rows gone from the card: their past let go. */
  keep(keys: Set<string>) {
    for (const k of this.past.keys()) if (!keys.has(k)) this.past.delete(k);
    for (const k of this.shown.keys()) if (!keys.has(k)) this.shown.delete(k);
  }
}
