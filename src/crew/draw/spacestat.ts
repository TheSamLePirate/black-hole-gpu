// The spacecraft's status panel (PLAN-VAISSEAUX K2): the dashboard's flight computer column — the propellant and its
// Δv, the burn flown, the plan's burns, the next event, the target; the systems (X3); the clocks and the link. And the
// F-35's mission panel (its objective, its weapons, its alerts) for the tactical console.
import { bodyName } from "./orbit";
import { C, dur, fmt, type Pen, type Rect } from "./kit";
import type { Scene } from "./scene";
import { aarColour, aarPhaseName } from "./aar";
import { L, lang } from "../lang";

const FAILURE_FR: Record<string, string> = {
  engine: "MOTEUR PRINCIPAL ÉTEINT",
  rcsStuck: "RCS BLOQUÉ OUVERT",
  gyro: "DÉRIVE CENTRALE",
  bus: "COURT-CIRCUIT BUS",
  o2Leak: "FUITE D’OXYGÈNE",
  scrubber: "ÉPURATEUR EN PANNE",
};
const FAILURE_EN: Record<string, string> = {
  engine: "MAIN ENGINE OUT",
  rcsStuck: "RCS STUCK OPEN",
  gyro: "IMU DRIFT",
  bus: "BUS SHORT",
  o2Leak: "OXYGEN LEAK",
  scrubber: "SCRUBBER FAILED",
};
export const failureName = (k: string) => (lang() === "fr" ? FAILURE_FR : FAILURE_EN)[k] ?? k.toUpperCase();
const ROLE_FR: Record<string, string> = {
  depart: "départ",
  circ: "circularisation",
  mcc: "correction",
  capture: "capture",
  mccReturn: "correction retour",
  captureHome: "capture au retour",
  arrive: "arrivée",
};
const ROLE_EN: Record<string, string> = {
  depart: "departure",
  circ: "circularization",
  mcc: "correction",
  capture: "capture",
  mccReturn: "return correction",
  captureHome: "capture at home",
  arrive: "arrival",
};
/** a burn's part in a mission, in the console's language (a node when it has none) */
export const roleName = (r: string) => (r ? ((lang() === "fr" ? ROLE_FR : ROLE_EN)[r] ?? r) : L("nœud", "node"));
const EVENT_FR: Record<string, string> = {
  impact: "Impact",
  exit: "Sortie de sphère",
  enter: "Entrée en sphère",
  mouth: "Bouche du trou de ver",
};
const EVENT_EN: Record<string, string> = {
  impact: "Impact",
  exit: "Sphere exit",
  enter: "Sphere entry",
  mouth: "Wormhole mouth",
};
/** the next event on the free-fall path, in the console's language: its kind, its body by the console's name (the pilot's word for it
 *  from an older pilot sending no body) */
export function eventName(n: { kind: string; name: string; body?: string }): string {
  const kind = (lang() === "fr" ? EVENT_FR : EVENT_EN)[n.kind];
  const where = n.kind === "mouth" ? "" : n.body ? bodyName(n.body) : n.name;
  return kind ? `${kind}${where ? ` · ${where}` : ""}` : where || n.kind;
}

/** a bar: its share filled, toned by thresholds */
function bar(p: Pen, x: number, y: number, w: number, share: number | null, warn = 0.25, alarm = 0.1) {
  p.round(x, y, w, 6, 3);
  p.fill("#14262f");
  if (share === null) return;
  const s = Math.max(0, Math.min(1, share));
  p.round(x, y, Math.max(2, w * s), 6, 3);
  p.fill(s < alarm ? C.red : s < warn ? C.amber : C.green);
}

export function drawSpaceStatus(p: Pen, r: Rect, sc: Scene) {
  p.panel(r, L("ORDINATEUR DE VOL", "FLIGHT COMPUTER"));
  const s = sc.snap;
  const x = r.x + 12,
    w = r.w - 24;
  let y = r.y + 40;
  const line = (name: string, value: string, col: string = C.text) => {
    if (y > r.y + r.h - 8) return;
    p.text(name, x, y, { col: C.dim, size: 11 });
    p.text(value, x + w, y, { col, size: 12, weight: 700, align: "right" });
    y += 20;
  };
  const head = (t: string) => {
    if (y > r.y + r.h - 20) return;
    y += 6;
    p.text(t, x, y, { col: C.cyan, size: 10, weight: 700 });
    y += 16;
  };
  if (!s) return;
  const B = s.budget;
  line(
    L("Δv restant", "Δv left"),
    B?.dv == null ? L("non compté", "not counted") : `${fmt(B.dv)} m/s`,
    B?.dv != null && B.dv < 200 ? C.amber : C.text,
  );
  if (B?.prop != null) {
    p.text(L("Ergols", "Prop."), x, y, { col: C.dim, size: 11 });
    bar(p, x + 60, y - 7, w - 110, B.prop);
    p.text(`${fmt(B.prop * 100)} %`, x + w, y, { col: C.text, size: 12, weight: 700, align: "right" });
    y += 20;
  }
  if (s.burn) line(L("Poussée en cours", "Burn under way"), `${fmt(s.burn.left)} m/s ${L("restants", "left")}`, C.magenta);
  const nodes = s.nodes ?? [];
  if (nodes.length) {
    head(`PLAN · ${nodes.length} ${L("POUSSÉE", "BURN")}${nodes.length > 1 ? "S" : ""}`);
    for (const n of nodes.slice(0, 4))
      line(`${roleName(n.role)} · ${L("dans", "in")} ${dur(n.in)}`, `${fmt(Math.hypot(...n.dv), 1)} m/s`, C.magenta);
  }
  if (s.next) line(L("Prochain événement", "Next event"), `${eventName(s.next)} · ${dur(s.next.in)}`, C.amber);
  const T = s.target;
  if (T) {
    head(`${L("CIBLE", "TARGET")} · ${T.name.toUpperCase()}`);
    line("Distance", T.dist >= 10_000 ? `${fmt(T.dist / 1000, 1)} km` : `${fmt(T.dist)} m`);
    line(L("Rapprochement", "Closing"), `${fmt(T.rate, 2)} m/s`, T.rate < 0 ? C.dim : C.text);
    if (Number.isFinite(T.caIn)) line(L("Approche minimale", "Closest approach"), `${fmt(T.ca / 1000, 2)} km · ${dur(T.caIn)}`);
  }
  const Y = s.sysx;
  if (Y) {
    head(L("SYSTÈMES", "SYSTEMS"));
    p.text(L("Batterie", "Battery"), x, y, { col: C.dim, size: 11 });
    bar(p, x + 60, y - 7, w - 110, Y.battery);
    p.text(`${fmt(Y.battery * 100)} %`, x + w, y, { col: C.text, size: 12, weight: 700, align: "right" });
    y += 20;
    line(L("Bilan électrique", "Power balance"), `${Y.balance >= 0 ? "+" : ""}${fmt(Y.balance, 1)} kW`, Y.balance < 0 ? C.amber : C.green);
    line(L("Oxygène", "Oxygen"), `${dur(Y.o2h * 3600)} ${L("pour", "for")} ${Y.crew}`, Y.o2h < 24 ? C.red : C.text);
    line(L("Épurateurs CO₂", "CO₂ scrubbers"), `${fmt(Y.scrub, 1)} ${L("j", "d")}`, Y.scrub < 1 ? C.amber : C.text);
    for (const f of Y.failures)
      line(failureName(f.kind), f.fixing ? L("réparation…", "repairing…") : L("PANNE", "FAILED"), f.fixing ? C.amber : C.red);
  }
  if (s.ring) {
    head(L("ANNEAU", "RING"));
    line(L("Rotation · gravité", "Spin · gravity"), `${fmt(s.ring.rpm, 1)} ${L("tr/min", "rpm")} · ${fmt(s.ring.g, 2)} g`);
    for (const q of s.ports ?? []) line(q.name, q.docked || L("libre", "free"), q.docked ? C.green : C.dim);
  }
  head(L("HORLOGES ET LIAISON", "CLOCKS AND LINK"));
  if (s.time) {
    line(L("Facteur de temps", "Time warp"), `×${fmt(s.time.warp, s.time.warp < 10 ? 1 : 0)}`);
    line("dτ/dt", fmt(s.time.dtau, 4), s.time.dtau < 0.99 ? C.amber : C.text);
  }
  if (s.link)
    line(
      L("Liaison Terre", "Earth link"),
      s.link.cut ? L("coupée (trou de ver)", "cut (wormhole)") : `${L("lumière", "light")} ${dur(s.link.light)}`,
      s.link.cut ? C.red : C.text,
    );
  if (s.state) line(L("Sphère", "Sphere"), bodyName(s.state.body));
}

/** The F-35's mission panel: its objective, its weapons, its alerts — the tactical console's strip. */
export function drawAirStatus(p: Pen, r: Rect, sc: Scene) {
  p.panel(r, L("MISSION AÉRIENNE", "AIR MISSION"));
  const s = sc.snap;
  if (!s) return;
  let x = r.x + 12;
  const y = r.y + 40;
  const cell = (name: string, value: string, col: string = C.text) => {
    const w = Math.max(p.width(value, 13, 700), p.width(name, 10)) + 22;
    if (x + w > r.x + r.w) return;
    p.text(name, x, y, { col: C.dim, size: 10 });
    p.text(value, x, y + 18, { col, size: 13, weight: 700 });
    x += w;
  };
  const m = s.msn;
  cell(L("Objectif", "Objective"), m ? `${m.name} · ${sc.u.fDist(m.dist)}` : L("aucun", "none"), m ? C.amber : C.dim);
  const a = s.arms;
  if (a) {
    cell("Combat", a.live ? L("EN COURS", "LIVE") : L("hors combat", "no fight"), a.live ? C.red : C.dim);
    cell(L("Arme", "Weapon"), a.sel || "—");
    cell("Radar", a.mode || "—", C.green);
    cell(L("Verrou", "Lock"), a.lock || "—", a.lock ? C.red : C.dim);
    const st = Object.entries(a.stores)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ");
    cell(L("Emports", "Stores"), st || "—");
  }
  // (the refuelling: its phase and the fuel taken)
  if (s.aar) cell(L("Ravitaillement", "Refuelling"), `${aarPhaseName(s.aar.phase)} · ${fmt(s.aar.given)} kg`, aarColour(s.aar));
  const w = s.warn ?? [];
  cell(L("Alertes", "Alerts"), w.length ? w.join(" · ") : L("aucune", "none"), w.length ? C.red : C.green);
}
