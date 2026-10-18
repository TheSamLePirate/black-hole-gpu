// The spacecraft's own HUD panels (docs/PLAN-VAISSEAUX-AAA.md, X4), each craft its own, as the F-35 has its avionics:
//  - the Lander's DESCENT (Apollo's LM): the height H and its rate Ḣ, the speeds forward and across over the ground,
//    the hover's seconds left (the propellant's Δv over the local weight) — the « 60 » and « 30 » calls —, the tank;
//  - the Endurance's MOTHERSHIP: its ring's turn and weight, its hub's ports (free, or who is docked), its assembly's
//    mass, the propellant of each craft docked.
// Pure: the figures in, the rows out (ui/hud/symbology.ts draws them).

export type PanelTone = "norm" | "dim" | "warn" | "bad" | "good";
export interface CraftPanel {
  title: string;
  rows: { label: string; value: string; tone?: PanelTone }[];
}

/** The Lander's descent figures: height [m], its rate [m/s, up +], the speeds forward and across [m/s], the Δv left
 *  [m/s], the local weight [m/s²], the tank's share. */
export interface DescentIn {
  h: number;
  hDot: number;
  vFwd: number;
  vLat: number;
  dvLeft: number;
  g: number;
  tank: number | null;
}

/** The hover's seconds left: the Δv the tank still holds spent holding the weight. */
export const hoverSeconds = (dvLeft: number, g: number) => (g > 0 && Number.isFinite(dvLeft) ? dvLeft / g : Number.POSITIVE_INFINITY);

const m = (x: number) => (Math.abs(x) >= 10_000 ? `${(x / 1000).toFixed(1)} km` : `${Math.round(x)} m`);
const ms = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(Math.abs(x) < 10 ? 1 : 0)} m/s`;

/** The DESCENT panel. Labels are given translated by the caller (loc). */
export function descentPanel(d: DescentIn, loc: (s: string) => string): CraftPanel {
  const hs = hoverSeconds(d.dvLeft, d.g);
  return {
    title: loc("DESCENT"),
    rows: [
      { label: "H", value: m(d.h) },
      { label: "V/S", value: ms(d.hDot), tone: d.hDot < -Math.max(3, 0.1 * d.h) ? "warn" : "norm" },
      { label: loc("FWD · LAT"), value: `${ms(d.vFwd)} · ${ms(d.vLat)}`, tone: Math.abs(d.vLat) > 2 && d.h < 50 ? "warn" : "norm" },
      {
        label: loc("HOVER"),
        // (a scene's fictional engine — 0.29 c of Δv — leaves years of hover: past an hour, said so)
        value: !Number.isFinite(hs) ? "∞" : hs >= 3600 ? "> 1 h" : `${Math.round(hs)} s`,
        tone: hs < 30 ? "bad" : hs < 60 ? "warn" : "good",
      },
      ...(d.tank !== null
        ? [{ label: loc("PROPELLANT"), value: `${Math.round(d.tank * 100)} %`, tone: (d.tank < 0.1 ? "bad" : "norm") as PanelTone }]
        : []),
    ],
  };
}

/** The hover's call crossed this frame (60 s, then 30 s left — Apollo's), null when none. */
export function hoverCall(before: number, now: number): 60 | 30 | null {
  if (before > 60 && now <= 60) return 60;
  if (before > 30 && now <= 30) return 30;
  return null;
}

/** The Endurance's figures: its ring [rpm, g], its ports (name, who is docked or null), its assembly's mass [kg], the
 *  propellant of each craft of it (name, share). */
export interface MothershipIn {
  rpm: number;
  g: number;
  ports: { name: string; docked: string | null }[];
  massKg: number;
  tanks: { name: string; share: number }[];
}

/** The MOTHERSHIP panel. */
export function mothershipPanel(d: MothershipIn, loc: (s: string) => string): CraftPanel {
  return {
    title: "ENDURANCE",
    rows: [
      {
        label: loc("RING"),
        value: `${d.rpm.toFixed(1)} rpm · ${d.g.toFixed(2)} g`,
        tone: d.rpm > 7.05 ? "warn" : d.rpm > 0.05 ? "good" : "dim",
      },
      ...d.ports.map((p) => ({
        label: p.name.toUpperCase(),
        value: p.docked ?? loc("free"),
        tone: (p.docked ? "good" : "dim") as PanelTone,
      })),
      {
        label: loc("MASS"),
        value: `${Math.round(d.massKg / 1000)
          .toLocaleString("en")
          .replace(/,/g, " ")} t`,
      },
      ...d.tanks.map((k) => ({
        label: k.name.toUpperCase(),
        value: `${Math.round(k.share * 100)} %`,
        tone: (k.share < 0.1 ? "bad" : "norm") as PanelTone,
      })),
    ],
  };
}
