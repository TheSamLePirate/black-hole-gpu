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
  /** the flight's greatest load [g] */
  gMax: number;
  /** the Δv spent over the flight [m/s], its length [s] */
  dv: number;
  flightS: number;
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
  kind: "landing" | "docking";
  title: string;
  /** out of 20, and its letter */
  score: number;
  letter: "A" | "B" | "C" | "D" | "F";
  lines: { label: string; value: string; q: Quality }[];
}

const letterOf = (s: number): FlightReport["letter"] => (s >= 17 ? "A" : s >= 14 ? "B" : s >= 10 ? "C" : s >= 6 ? "D" : "F");
const judge = (x: number, good: number, ok: number): Quality => (x <= good ? "good" : x <= ok ? "ok" : "bad");
const dur = (s: number) =>
  !Number.isFinite(s) ? "—" : s < 120 ? `${s.toFixed(0)} s` : s < 7200 ? `${(s / 60).toFixed(0)} min` : `${(s / 3600).toFixed(1)} h`;
const metres = (m: number) => (Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(m < 10 ? 1 : 0)} m`);

/**
 * A landing graded: 20 less a penalty for each figure past its mark — the sink beyond 0.6 m/s (−4 a
 * m/s), on a runway the axis beyond 3 m (−1 per 5 m), off one the site beyond 5 m (−1 per 20 m, 8 at
 * most), the load beyond 2.5 g (−3 a g); a hard landing −6.
 */
export function gradeLanding(f: LandingFigures): FlightReport {
  let s = 20;
  s -= Math.max(0, f.sink - 0.6) * 4;
  if (f.runway) s -= Math.max(0, Math.abs(f.runway.across) - 3) / 5;
  else if (f.padM !== null) s -= Math.min(8, Math.max(0, f.padM - 5) / 20);
  s -= Math.max(0, f.gMax - 2.5) * 3;
  if (f.verdict === "hard") s -= 6;
  const score = Math.max(0, Math.min(20, s));
  const lines: FlightReport["lines"] = [
    { label: t("Sink rate"), value: `${f.sink.toFixed(1)} m/s`, q: judge(f.sink, 1, 2) },
    { label: t("Speed along"), value: `${f.along.toFixed(0)} m/s`, q: "good" },
  ];
  if (f.runway) {
    lines.push({ label: t("Off the axis"), value: metres(Math.abs(f.runway.across)), q: judge(Math.abs(f.runway.across), 5, 15) });
    lines.push({ label: t("Past the threshold"), value: metres(f.runway.along), q: "good" });
  } else if (f.padM !== null) lines.push({ label: t("From the site"), value: metres(f.padM), q: judge(f.padM, 10, 100) });
  lines.push(
    { label: t("Greatest load"), value: `${f.gMax.toFixed(1)} g`, q: judge(f.gMax, 2.5, 4) },
    { label: t("Δv spent"), value: `${f.dv.toFixed(0)} m/s`, q: "good" },
    { label: t("Flight"), value: dur(f.flightS), q: "good" },
  );
  if (f.verdict === "hard") lines.unshift({ label: t("Gear"), value: t("damaged — a hard landing"), q: "bad" });
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
