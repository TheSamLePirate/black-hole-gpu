// The flight's report (PLAN-HUB HB4): a landing's or a docking's figures, each judged, and the whole graded
// out of 20 (A to F) — what the flight lab's judge measures, said to the player at the end of the flight.
// Pure: the controller gives the figures (controller/motion.ts at the gear's verdict, docking.ts at the
// capture), the HUD shows the card.

import { t, tf } from "../i18n";

export interface LandingFigures {
  body: string;
  /** the site aimed at (a runway's, a pad's), or null */
  site: string | null;
  /** the gear's verdict */
  verdict: "landed" | "hard";
  /** the sink rate at the touchdown [m/s], the speed along the ground [m/s] */
  sink: number;
  along: number;
  /** on a runway: across its axis [m] and how far past its threshold [m] */
  runway: { across: number; along: number } | null;
  /** off a runway: the distance to the site aimed at [m] (null: none aimed at) */
  padM: number | null;
  /** the flight's greatest load [g] (NaN: none recorded) */
  gMax: number;
  /** the Δv spent over the flight [m/s], its length [s] */
  dv: number;
  flightS: number;
  /** the weather it landed in (PLAN-METEO W8): the surface wind across the runway [m/s, ± from the right],
   *  along it (> 0 head), its gusts' rise [m/s], the visibility [m]; absent: none known */
  weather?: { cross: number; head: number; gust: number; vis: number } | null;
}

export interface DockingFigures {
  target: string;
  port: string;
  /** at the capture: the closing rate [m/s], the ring off the port's axis [m], the ports' axes apart [°],
   *  the turns apart [°/s] */
  closing: number;
  lateral: number;
  angle: number;
  spin: number;
  dv: number;
  flightS: number;
}

export type Quality = "good" | "ok" | "bad";

export interface FlightReport {
  kind: "landing" | "docking" | "ascent" | "insertion" | "rendezvous" | "entry" | "lesson" | "challenge";
  title: string;
  /** out of 20, and its letter */
  score: number;
  letter: "A" | "B" | "C" | "D" | "F";
  lines: { label: string; value: string; q: Quality }[];
  /** the phase's curve for the debrief (PLAN-VAISSEAUX X8): its name, its unit, its points (x: seconds from the
   *  phase's start) */
  curve?: { title: string; unit: string; pts: [number, number][] } | null;
}

const letterOf = (s: number): FlightReport["letter"] => (s >= 17 ? "A" : s >= 14 ? "B" : s >= 10 ? "C" : s >= 6 ? "D" : "F");
const judge = (x: number, good: number, ok: number): Quality => (x <= good ? "good" : x <= ok ? "ok" : "bad");
const dur = (s: number) =>
  !Number.isFinite(s) ? "—" : s < 120 ? `${s.toFixed(0)} s` : s < 7200 ? `${(s / 60).toFixed(0)} min` : `${(s / 3600).toFixed(1)} h`;
const metres = (m: number) => (Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(m < 10 ? 1 : 0)} m`);

/**
 * How hard the weather made the landing (0 calm … 1): the cross wind past 3 m/s (all of it at 13 — 25 kt), the
 * gusts (all at 12 m/s), a visibility under a mile (+0.3), a tail wind (+0.2 a m/s past 1).
 */
export function weatherDifficulty(w: LandingFigures["weather"]): number {
  if (!w) return 0;
  const d = Math.max(Math.abs(w.cross) - 3, 0) / 10 + w.gust / 12 + (w.vis < 1609 ? 0.3 : 0) + Math.max(-w.head - 1, 0) * 0.2;
  return Math.min(Math.max(d, 0), 1);
}

/**
 * A landing graded: 20 less a penalty for each figure past its mark — the sink beyond 0.6 m/s (−4 a
 * m/s), on a runway the axis beyond 3 m (−1 per 5 m), off one the site beyond 5 m (−1 per 20 m, 8 at
 * most), the load beyond 2.5 g (−3 a g); a hard landing −6. The weather's marks wider (W8): the sink's by
 * 0.5 m/s and the axis's by 4 m at its hardest (weatherDifficulty), as a check pilot's are.
 */
export function gradeLanding(f: LandingFigures): FlightReport {
  const d = weatherDifficulty(f.weather);
  let s = 20;
  s -= Math.max(0, f.sink - 0.6 - 0.5 * d) * 4;
  if (f.runway) s -= Math.max(0, Math.abs(f.runway.across) - 3 - 4 * d) / 5;
  else if (f.padM !== null) s -= Math.min(8, Math.max(0, f.padM - 5) / 20);
  if (Number.isFinite(f.gMax)) s -= Math.max(0, f.gMax - 2.5) * 3;
  if (f.verdict === "hard") s -= 6;
  const score = Math.max(0, Math.min(20, s));
  const lines: FlightReport["lines"] = [
    { label: t("Sink rate"), value: `${f.sink.toFixed(1)} m/s`, q: judge(f.sink, 1 + 0.5 * d, 2 + 0.5 * d) },
    { label: t("Speed along"), value: `${f.along.toFixed(0)} m/s`, q: "good" },
  ];
  if (f.runway) {
    lines.push({
      label: t("Off the axis"),
      value: metres(Math.abs(f.runway.across)),
      q: judge(Math.abs(f.runway.across), 5 + 4 * d, 15 + 4 * d),
    });
    lines.push({ label: t("Past the threshold"), value: metres(f.runway.along), q: "good" });
  } else if (f.padM !== null) lines.push({ label: t("From the site"), value: metres(f.padM), q: judge(f.padM, 10, 100) });
  lines.push(
    {
      label: t("Greatest load"),
      value: Number.isFinite(f.gMax) ? `${f.gMax.toFixed(1)} g` : "—",
      q: Number.isFinite(f.gMax) ? judge(f.gMax, 2.5, 4) : "good",
    },
    { label: t("Δv spent"), value: `${f.dv.toFixed(0)} m/s`, q: "good" },
    { label: t("Flight"), value: dur(f.flightS), q: "good" },
  );
  if (f.verdict === "hard") lines.unshift({ label: t("Gear"), value: t("damaged — a hard landing"), q: "bad" });
  // (the weather it was flown in — its wind across and its gusts, the visibility —: what widened the marks)
  if (f.weather && (d > 0 || Math.abs(f.weather.cross) >= 1 || f.weather.vis < 8000)) {
    const w = f.weather;
    const parts = [
      Math.abs(w.cross) >= 1 ? tf("cross {0} m/s", Math.abs(w.cross).toFixed(0)) : null,
      w.head < -1 ? tf("tail {0} m/s", (-w.head).toFixed(0)) : null,
      w.gust >= 1 ? tf("gusts +{0}", w.gust.toFixed(0)) : null,
      w.vis < 8000 ? tf("visibility {0}", metres(w.vis)) : null,
    ].filter(Boolean);
    lines.push({ label: t("Weather"), value: parts.join(" · ") || t("calm"), q: d > 0.6 ? "bad" : d > 0.25 ? "ok" : "good" });
  }
  return {
    kind: "landing",
    title: f.site ? tf("Landing · {0}", f.site) : tf("Landing · {0}", f.body),
    score,
    letter: letterOf(score),
    lines,
  };
}

/**
 * A docking graded: 20 less — the closing rate beyond 0.1 m/s (−20 a m/s), the ring off the axis beyond 5
 * cm (−20 a metre), the ports' axes beyond 2° (−0.5 a degree), the turns apart beyond 0.5°/s (−1 a °/s).
 */
export function gradeDocking(f: DockingFigures): FlightReport {
  let s = 20;
  s -= Math.max(0, f.closing - 0.1) * 20;
  s -= Math.max(0, f.lateral - 0.05) * 20;
  s -= Math.max(0, f.angle - 2) * 0.5;
  s -= Math.max(0, f.spin - 0.5);
  const score = Math.max(0, Math.min(20, s));
  return {
    kind: "docking",
    title: tf("Docking · {0}", `${f.target} · ${f.port}`),
    score,
    letter: letterOf(score),
    lines: [
      { label: t("Closing rate"), value: `${f.closing.toFixed(2)} m/s`, q: judge(f.closing, 0.15, 0.3) },
      { label: t("Off the axis"), value: `${(f.lateral * 100).toFixed(0)} cm`, q: judge(f.lateral, 0.1, 0.2) },
      { label: t("Ports' axes"), value: `${f.angle.toFixed(1)}°`, q: judge(f.angle, 3, 6) },
      { label: t("Turn against it"), value: `${f.spin.toFixed(1)}°/s`, q: judge(f.spin, 1, 2) },
      { label: t("Δv spent"), value: `${f.dv.toFixed(0)} m/s`, q: "good" },
      { label: t("Flight"), value: dur(f.flightS), q: "good" },
    ],
  };
}

// ---------------------------------------------------------------- a spacecraft's phases (PLAN-VAISSEAUX X8)

/** An ascent to orbit: the Δv it took against the least it could have (the orbit's speed less the ground's turn,
 *  the climb's potential — the losses to gravity and the air on top), the orbit reached, how long. */
export interface AscentFigures {
  body: string;
  /** the Δv spent from the ground to orbit [m/s], the least it could have been [m/s] */
  dv: number;
  ideal: number;
  /** the orbit's periapsis and apoapsis heights [km], the flight's length [s], its greatest load [g] */
  peKm: number;
  apKm: number;
  flightS: number;
  gMax: number;
}
/** An ascent graded: 20 at 85 % efficiency and better, 1 off a point of efficiency below; a load past 4 g −2 a g. */
export function gradeAscent(f: AscentFigures): FlightReport {
  const eff = f.ideal / Math.max(f.dv, 1);
  let s = 20 - Math.max(0, 0.85 - eff) * 100;
  s -= Math.max(0, (Number.isFinite(f.gMax) ? f.gMax : 0) - 4) * 2;
  const score = Math.max(0, Math.min(20, s));
  return {
    kind: "ascent",
    title: tf("Ascent to orbit · {0}", f.body),
    score,
    letter: letterOf(score),
    lines: [
      { label: t("Efficiency"), value: `${Math.round(eff * 100)} %`, q: eff >= 0.85 ? "good" : eff >= 0.7 ? "ok" : "bad" },
      { label: t("Δv spent"), value: `${f.dv.toFixed(0)} m/s`, q: "good" },
      { label: t("Least possible"), value: `${f.ideal.toFixed(0)} m/s`, q: "good" },
      { label: t("Orbit"), value: `${f.peKm.toFixed(0)} × ${f.apKm.toFixed(0)} km`, q: "good" },
      { label: t("Greatest load"), value: Number.isFinite(f.gMax) ? `${f.gMax.toFixed(1)} g` : "—", q: judge(f.gMax || 0, 4, 6) },
      { label: t("Flight"), value: dur(f.flightS), q: "good" },
    ],
  };
}

/** An orbit's insertion: the orbit reached against the one aimed at (its heights [km], its inclination [°]). */
export interface InsertionFigures {
  body: string;
  peKm: number;
  apKm: number;
  incDeg: number;
  /** the orbit aimed at: its height [km] (circular), its inclination [°] (null: any) */
  aimKm: number;
  aimInc: number | null;
}
/** An insertion graded: the heights' errors past 1 % of the aim (−1 a %), the inclination's past 0.2° (−2 a °). */
export function gradeInsertion(f: InsertionFigures): FlightReport {
  const errPe = Math.abs(f.peKm - f.aimKm) / Math.max(f.aimKm, 1);
  const errAp = Math.abs(f.apKm - f.aimKm) / Math.max(f.aimKm, 1);
  const errInc = f.aimInc === null ? 0 : Math.abs(f.incDeg - f.aimInc);
  let s = 20 - Math.max(0, errPe - 0.01) * 100 - Math.max(0, errAp - 0.01) * 100 - Math.max(0, errInc - 0.2) * 2;
  s = Math.max(0, Math.min(20, s));
  return {
    kind: "insertion",
    title: tf("Orbit insertion · {0}", f.body),
    score: s,
    letter: letterOf(s),
    lines: [
      { label: t("Periapsis"), value: `${f.peKm.toFixed(1)} km`, q: judge(errPe, 0.01, 0.05) },
      { label: t("Apoapsis"), value: `${f.apKm.toFixed(1)} km`, q: judge(errAp, 0.01, 0.05) },
      { label: t("Aimed at"), value: `${f.aimKm.toFixed(0)} km`, q: "good" },
      {
        label: t("Inclination"),
        value: `${f.incDeg.toFixed(2)}°${f.aimInc === null ? "" : ` / ${f.aimInc.toFixed(2)}°`}`,
        q: judge(errInc, 0.2, 1),
      },
    ],
  };
}

/** A rendezvous: from where it began to within a kilometre of the target — the Δv it took, the time, against a
 *  Hohmann's worth for the distance (the least, as a pilot's mark). */
export interface RendezvousFigures {
  target: string;
  /** the Δv spent [m/s], the least a planner gave (null: none known), the time it took [s] */
  dv: number;
  ideal: number | null;
  flightS: number;
}
/** A rendezvous graded: 20 within 120 % of the least Δv (−1 a 5 % past it); unknown least: by the Δv's size. */
export function gradeRendezvous(f: RendezvousFigures): FlightReport {
  const ratio = f.ideal && f.ideal > 0 ? f.dv / f.ideal : null;
  let s = ratio === null ? 20 - Math.max(0, f.dv - 150) / 25 : 20 - Math.max(0, ratio - 1.2) * 20;
  s = Math.max(0, Math.min(20, s));
  return {
    kind: "rendezvous",
    title: tf("Rendezvous · {0}", f.target),
    score: s,
    letter: letterOf(s),
    lines: [
      { label: t("Δv spent"), value: `${f.dv.toFixed(1)} m/s`, q: ratio === null ? judge(f.dv, 150, 300) : judge(ratio, 1.2, 1.6) },
      { label: t("Least possible"), value: f.ideal ? `${f.ideal.toFixed(1)} m/s` : "—", q: "good" },
      { label: t("Time"), value: dur(f.flightS), q: "good" },
    ],
  };
}

/** An entry: its corridor (the greatest load and heat flux), the distance it came down from the site aimed at. */
export interface EntryFigures {
  body: string;
  site: string | null;
  /** the greatest load [g] and heat flux [W/m²], the distance from the site at the touchdown or the chutes [m] */
  gMax: number;
  heatMax: number;
  missM: number | null;
  flightS: number;
}
/** An entry graded: the load past 4 g (−3 a g), the heat past 150 W/cm² (−1 a 25), the site missed past 2 km (−1
 *  a km, 8 at most). */
export function gradeEntry(f: EntryFigures): FlightReport {
  const heat = f.heatMax / 1e4;
  let s = 20 - Math.max(0, f.gMax - 4) * 3 - Math.max(0, heat - 150) / 25;
  if (f.missM !== null) s -= Math.min(8, Math.max(0, f.missM - 2000) / 1000);
  s = Math.max(0, Math.min(20, s));
  return {
    kind: "entry",
    title: tf("Entry · {0}", f.site ? `${f.body} · ${f.site}` : f.body),
    score: s,
    letter: letterOf(s),
    lines: [
      { label: t("Greatest load"), value: `${f.gMax.toFixed(1)} g`, q: judge(f.gMax, 4, 6) },
      { label: t("Greatest heat flux"), value: `${heat.toFixed(0)} W/cm²`, q: judge(heat, 150, 250) },
      {
        label: t("Off the site"),
        value: f.missM === null ? "—" : metres(f.missM),
        q: f.missM === null ? "good" : judge(f.missM, 2000, 10_000),
      },
      { label: t("Flight"), value: dur(f.flightS), q: "good" },
    ],
  };
}
