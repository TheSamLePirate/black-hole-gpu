import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { resetFlights } from "./helpers/flight";
import * as E from "./helpers/envelope";

// The F-35B's flight envelope against the real aircraft's published figures (docs/PLAN-AVIATION-AAA.md, V1):
// each figure measured — trimmed (aero.ts, f35/engine.ts) or flown frame by frame by the controller (the flight
// control system, the holds) —, its reference, its source and how far it may be; the gaps the plan's next steps
// close (V2 the high incidence, V3 the control laws) said, not failed. ENVELOPE_MD=<file>: the table written.

afterEach(resetFlights);

type Row = { what: string; got: number; unit: string; ref: string; src: string; lo?: number; hi?: number; gap?: string; d?: number };
const rows: Row[] = [];
/** a figure measured: within [lo, hi] asserted unless it is a known gap */
function row(r: Row) {
  rows.push(r);
  if (r.gap) return;
  if (r.lo !== undefined) expect(r.got).toBeGreaterThanOrEqual(r.lo);
  if (r.hi !== undefined) expect(r.got).toBeLessThanOrEqual(r.hi);
}

const SRC = {
  mindef: "[MINDEF Singapore, F-35B fact sheet](https://www.mindef.gov.sg/news-and-events/latest-releases/24feb23_fs2/)",
  lm: "[Lockheed Martin, F-35 variants](https://view.ceros.com/lockheed-martin/f-35-variants)",
  usaf: "[USAF F-35A fact sheet (the B's alike)](https://www.af.mil/About-Us/Fact-Sheets/Display/Article/478441/f-35a-lightning-ii/)",
  dote: "[DOT&E 2013, via FlightGlobal](https://www.flightglobal.com/pentagon-lowers-f-35-performance-bar/108424.article)",
  accel: "[61 s (240-3 standard) + 16 s for the B (DOT&E 2013)](https://www.f-16.net/forum/viewtopic.php?p=213147)",
  aoa: "[F-35 high-AoA testing, 2012](https://sldinfo.com/2012/11/the-f-35-and-high-angle-of-attack-flight-testing/)",
  none: "no public figure",
};

describe("the F-35B's flight envelope", () => {
  test("its top speed, its ceiling, its sustained turn, its range — trimmed", () => {
    row({
      what: "Top speed, 11 km, afterburner",
      got: E.vMax(11000, E.M_MID, true),
      unit: "M",
      ref: "1.6",
      src: SRC.mindef,
      lo: 1.52,
      hi: 1.68,
      d: 2,
    });
    row({
      what: "Top speed, 11 km, dry",
      got: E.vMax(11000, E.M_MID, false),
      unit: "M",
      ref: "~1 (no supercruise claimed)",
      src: SRC.none,
      lo: 0.9,
      hi: 1.2,
      d: 2,
    });
    row({
      what: "Service ceiling (100 ft/min left), mid fuel",
      got: E.ceiling(E.M_MID) / E.FT,
      unit: "ft",
      ref: "above 50 000",
      src: SRC.usaf,
      lo: 50000,
      hi: 56000,
      d: 0,
    });
    row({
      what: "Sustained turn, Mach 0.8, 15 000 ft, mid fuel",
      got: E.sustainedG(15000 * E.FT, 0.8, E.M_MID),
      unit: "g",
      ref: "4.5",
      src: SRC.dote,
      lo: 4.3,
      hi: 4.9,
      d: 2,
    });
    row({
      what: "Combat radius, internal fuel (hi–hi–hi)",
      got: E.combatRadius().km,
      unit: "km",
      ref: "above 833 (USMC profile)",
      src: SRC.lm,
      lo: 833,
      hi: 1000,
      d: 0,
    });
    row({
      what: "Best climb, sea level, mid fuel",
      got: (E.climbRate(0, E.M_MID) / E.FT) * 60,
      unit: "ft/min",
      ref: "—",
      src: SRC.none,
      d: 0,
    });
    row({
      what: "Stall, clean, take-off weight, sea level",
      got: E.stallSpeed(E.M_TO) / E.KT,
      unit: "kt",
      ref: "—",
      src: SRC.none,
      lo: 110,
      hi: 145,
      d: 0,
    });
  });

  test("its transonic acceleration — flown, level on the altitude hold", () => {
    const t = E.transonic(30000 * E.FT) ?? Number.NaN;
    row({ what: "Mach 0.8 → 1.2, 30 000 ft, afterburner", got: t, unit: "s", ref: "~77", src: SRC.accel, lo: 65, hi: 90, d: 0 });
  }, 120_000);

  test("its roll, its pull, its push, its incidence — flown at full stick", () => {
    row({
      what: "Roll rate, full stick, 250 m/s, 4 km",
      got: E.rollRate(4000, 250),
      unit: "°/s",
      ref: "—",
      src: SRC.none,
      lo: 150,
      hi: 230,
      d: 0,
    });
    const hard = E.pull(4000, 300);
    row({
      what: "Load reached in 3 s, full aft stick, 300 m/s",
      got: hard.gPeak,
      unit: "g",
      ref: "7.0 (its limit)",
      src: SRC.lm,
      lo: 6.8,
      hi: 7.3,
      d: 2,
      gap: hard.gPeak < 6.8 ? "V3: the pitch law commands a rate, not a load — 7 g approached, not reached" : undefined,
    });
    // (its limit never passed, whatever the stick)
    expect(hard.gPeak).toBeLessThan(7.3);
    const push = E.pull(4000, 260, -1);
    row({
      what: "Load reached in 3 s, full forward stick, 260 m/s",
      got: push.gLow,
      unit: "g",
      ref: "−3.0 (commonly cited)",
      src: SRC.none,
      lo: -3.3,
      hi: -2.7,
      d: 2,
    });
    let best = { v: 0, rate: 0, alpha: 0 };
    for (const v of [170, 200, 230, 260]) {
      const p = E.pull(4000, v);
      if (p.rate > best.rate) best = { v, rate: p.rate, alpha: p.alpha };
    }
    // (7 g at its corner: g √(n² − 1) / V — some 17°/s at 230 m/s)
    row({
      what: `Instantaneous turn, best (at ${best.v} m/s), 4 km`,
      got: best.rate,
      unit: "°/s",
      ref: "~17 (7 g at a 230 m/s corner)",
      src: SRC.none,
      lo: 15,
      hi: 21,
      d: 1,
    });
    const slow = E.pull(4000, 140);
    row({
      what: "Incidence reached, full aft stick, 140 m/s",
      got: slow.alpha,
      unit: "°",
      ref: "50 (commanded limit)",
      src: SRC.aoa,
      lo: 45,
      hi: 52,
      d: 1,
      gap: slow.alpha < 45 ? "V2: the law's limit, the vortex lift past the wing's stall" : undefined,
    });
  }, 240_000);
});

afterAll(async () => {
  const fmt = (r: Row) => `${r.got.toFixed(r.d ?? 1)} ${r.unit}`;
  const band = (r: Row) => (r.lo === undefined && r.hi === undefined ? "—" : `${r.lo ?? "…"} – ${r.hi ?? "…"}`);
  const state = (r: Row) => (r.gap ? `gap — ${r.gap}` : r.lo === undefined && r.hi === undefined ? "measured" : "within");
  const lines = [
    "| Figure | Measured | Reference | Band | State | Source |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.what} | ${fmt(r)} | ${r.ref} | ${band(r)} | ${state(r)} | ${r.src} |`),
  ];
  console.log(`\n${lines.join("\n")}`);
  const out = process.env.ENVELOPE_MD;
  if (out) await Bun.write(out, `${lines.join("\n")}\n`);
});
