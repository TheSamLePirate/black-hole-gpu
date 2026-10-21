// The air-to-air refuelling for the crew (the `aar` block — game/aar.ts, controller/aar.ts): the phase as the pilot's
// HUD says it, the way it is flown, the tanker and its hose, the pod's lights, the probe's gap to the basket and the
// closing speed, the hose pushed in against its flow range and its breakaway, the fuel taken.
import type { InstrumentAar } from "../../net/instruments";
import type { Units } from "../../ui/unitsys";
import { L } from "../lang";
import { C, clamp, fmt, type Pen, type Rect } from "./kit";

/** the HUD's word in the console's language */
export function aarPhaseName(phase: string): string {
  const N: Record<string, [string, string]> = {
    JOIN: ["RENDEZ-VOUS", "JOIN-UP"],
    "PRE-CONTACT": ["PRÉ-CONTACT", "PRE-CONTACT"],
    CLEARED: ["AUTORISÉ AU CONTACT", "CLEARED CONTACT"],
    CONTACT: ["CONTACT", "CONTACT"],
    "FUEL FLOW": ["TRANSFERT", "FUEL FLOW"],
    FULL: ["PLEIN FAIT", "FULL"],
    BREAKAWAY: ["DÉGAGEMENT", "BREAKAWAY"],
    DEPART: ["DÉPART AUTORISÉ", "CLEARED TO DEPART"],
  };
  const n = N[phase];
  return n ? L(n[0], n[1]) : phase;
}
export const aarModeName = (m: InstrumentAar["mode"]) =>
  m === "auto" ? L("automatique", "automatic") : m === "assisted" ? L("assisté", "assisted") : L("manuel", "manual");
/** the phase's colour: the pod's lights' (amber ready, green flowing, red breakaway) */
export const aarColour = (a: InstrumentAar) =>
  a.lights === "red" ? C.red : a.lights === "green" ? C.green : a.phase === "JOIN" ? C.cyan : C.amber;

/** a short line (the annunciator's, a tile's, the mission strip's): phase · fuel given */
export function aarLine(a: InstrumentAar): string {
  return `AAR ${aarPhaseName(a.phase)} · ${fmt(a.given)} kg`;
}

/** The refuelling's panel in r: the rows and gauges, fitted to its height. */
export function drawAar(p: Pen, r: Rect, a: InstrumentAar, u: Units) {
  const col = aarColour(a);
  const x = r.x + 12,
    w = r.w - 24;
  let y = r.y + 18;
  p.text(aarPhaseName(a.phase), x, y, { col, size: 15, weight: 800 });
  // the pod's light
  const lc = a.lights === "red" ? C.red : a.lights === "green" ? C.green : a.lights === "amber" ? C.amber : "#2a3a44";
  p.circle(x + w - 8, y - 5, 7);
  p.fill(a.lights === "off" ? "#0c161d" : `${lc}cc`);
  p.stroke(lc, 1.5);
  y += 18;
  const side = a.side === "left" ? L("tuyau gauche", "left hose") : L("tuyau droit", "right hose");
  // (narrow: the tanker's name left out first)
  const full = `${a.tanker || "TEXACO"} · ${side} · ${aarModeName(a.mode)}`;
  p.text(p.width(full, 11) <= w ? full : `${side} · ${aarModeName(a.mode)}`, x, y, { col: C.text, size: 11 });
  const row = (k: string, v: string, c: string = C.white) => {
    y += 18;
    if (y > r.y + r.h - 4) return;
    p.text(k, x, y, { col: C.dim, size: 10, weight: 600 });
    p.text(v, x + w, y, { col: c, size: 12, align: "right", weight: 700 });
  };
  const len = (m: number | null) => (m === null ? "—" : `${fmt(u.alt(m), Math.abs(u.alt(m)) < 10 ? 1 : 0)} ${u.altName.toLowerCase()}`);
  if (a.stage === "join") {
    row(L("DISTANCE AU RAVITAILLEUR", "DISTANCE TO THE TANKER"), a.dist === null ? "—" : u.fDist(a.dist), C.cyan);
  } else {
    row(L("SONDE → PANIER", "PROBE → BASKET"), a.takeup !== null ? L("verrouillée", "locked") : len(a.along));
    row(L("HORS AXE", "OFF THE LINE"), len(a.off), a.off !== null && a.off > 0.42 && a.takeup === null ? C.amber : C.white);
    row(
      L("RAPPROCHEMENT", "CLOSING"),
      a.closure === null ? "—" : `${a.closure >= 0 ? "+" : ""}${fmt(u.alt(a.closure), 1)} ${u.altName.toLowerCase()}/s`,
      a.closure !== null && a.closure > 2.6 ? C.red : C.white,
    );
    // the hose pushed in: its flow range green, its breakaway red, where it is now
    y += 16;
    if (y + 10 < r.y + r.h) {
      const top = a.whip + 1;
      const at = (m: number) => x + (clamp(m, 0, top) / top) * w;
      p.text(L("TUYAU ENFONCÉ", "HOSE PUSHED IN"), x, y, { col: C.dim, size: 10, weight: 600 });
      y += 6;
      p.round(x, y, w, 8, 4);
      p.fill("#14242e");
      p.round(at(a.flow[0]), y, at(a.flow[1]) - at(a.flow[0]), 8, 4);
      p.fill(`${C.green}66`);
      p.round(at(a.whip), y, x + w - at(a.whip), 8, 4);
      p.fill(`${C.red}66`);
      if (a.takeup !== null) {
        const tx = at(a.takeup);
        p.seg(tx, y - 4, tx, y + 12, C.white, 2.5);
      }
    }
  }
  // the fuel taken: given against asked
  y += 22;
  if (y + 10 < r.y + r.h) {
    const f = a.want > 0 ? a.given / a.want : 0;
    p.text(a.practice ? L("TRANSFERT (EXERCICE)", "TRANSFER (PRACTICE)") : L("TRANSFÉRÉ", "TRANSFERRED"), x, y, {
      col: C.dim,
      size: 10,
      weight: 600,
    });
    p.text(`${fmt(a.given)} / ${fmt(a.want)} kg`, x + w, y, { col: C.text, size: 11, align: "right", weight: 700 });
    y += 6;
    p.round(x, y, w, 8, 4);
    p.fill("#14242e");
    if (f > 0) {
      p.round(x, y, Math.max(8, w * clamp(f, 0, 1)), 8, 4);
      p.fill(C.green);
    }
  }
  row(L("CONTACTS · RATÉS", "CONTACTS · MISSES"), `${a.contacts} · ${a.misses}`, a.misses ? C.amber : C.white);
}
