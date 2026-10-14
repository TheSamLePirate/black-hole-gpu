// The CameraController — a challenge flown (docs/PLAN-F35.md, F9; game/challenges.ts): its clock, its gates
// passed or missed, the seconds over its ceiling, the touchdown marked (a runway's, a pad's), the figures
// judged; its result, its medal, the best kept. Its gates for the HUD (their corners seen from the eye).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame } from "../camera";
import {
  AeroJudge,
  better,
  courseMedal,
  enu,
  gateCrossing,
  landingMarks,
  marksMedal,
  toward,
  verticalMarks,
  type Best,
  type ChallengeDef,
  type GateAbs,
  type Medal,
} from "../game/challenges";
import { SITES } from "../game/sites";
import { t, tf, tr } from "../i18n";
import { bodyFixedOf, groundRelief } from "../system/our-surface";
import { store } from "../util/storage";
import type { CameraController } from "../controls";

type V3 = [number, number, number];
const D = Math.PI / 180;
const BEST_KEY = "kerr.challenges";
/** a gate missed: its penalty [s] */
export const MISS_PENALTY = 10;
/** the landing's reference speed [m/s] (140 kt) */
const VREF = 72;

declare module "../controls" {
  interface CameraController {
    challengeStart: typeof challengeStart;
    challengeStep: typeof challengeStep;
    challengeAbort: typeof challengeAbort;
    challengeHud: typeof challengeHud;
  }
}

export interface ChalResult {
  /** a course's time with its penalties [s], or the marks */
  score: number;
  medal: Medal;
  best: boolean;
  /** the marks' parts, the figures' marks */
  parts?: Record<string, number>;
  text: string;
}

/** A challenge running: its course (gates fixed over the ground at the start), the next gate, its clock [s],
 *  the gates missed, the seconds over the ceiling, its state. */
export interface ChalState {
  def: ChallengeDef;
  gates: GateAbs[];
  next: number;
  t: number;
  missed: number;
  over: number;
  splits: number[];
  status: "run" | "done" | "failed";
  result: ChalResult | null;
  prev: { lat: number; lon: number; alt: number } | null;
  aero: AeroJudge | null;
  touch: number;
  /** its clock when it ended (the result shown 15 s, then gone) */
  doneAt: number;
  /** a message to say (main.ts reads it, clears it) */
  say: string | null;
}

/** The best results kept, by challenge. */
export function bests(): Record<string, Best> {
  return store.getJSON<Record<string, Best>>(BEST_KEY, {});
}

const relief = (lat: number, lon: number) => groundRelief("earth", bodyFixedOf("earth", lat, lon, 0));

/** A challenge begun (the craft already placed at its start — ui/challengepanel.ts). */
function challengeStart(this: CameraController, def: ChallengeDef) {
  this.chal = {
    def,
    gates: (def.gates ?? []).map((g) => ({ ...g, alt: relief(g.lat, g.lon) + g.agl })),
    next: 0,
    t: 0,
    missed: 0,
    over: 0,
    splits: [],
    status: "run",
    result: null,
    prev: null,
    aero: def.figures ? new AeroJudge(def.figures) : null,
    touch: this.lastTouch?.n ?? 0,
    doneAt: 0,
    say: tr(def.title),
  };
}

function challengeAbort(this: CameraController) {
  if (this.chal?.status === "run") this.chal.say = t("Challenge abandoned");
  this.chal = null;
}

/** The result: marked, its medal, the best kept if beaten. */
function finish(c: CameraController, score: number, parts?: Record<string, number>) {
  const C = c.chal!;
  const d = C.def;
  const medal = d.kind === "gates" ? courseMedal(score, d.par) : marksMedal(score, d.par);
  const all = bests();
  const isBest = better(d.kind, score, all[d.id]);
  if (isBest) {
    all[d.id] = { score, at: new Date().toISOString(), medal };
    store.set(BEST_KEY, JSON.stringify(all));
  }
  const m = medal === "gold" ? t("GOLD") : medal === "silver" ? t("SILVER") : medal === "bronze" ? t("BRONZE") : t("no medal");
  const sc = d.kind === "gates" ? `${score.toFixed(1)} s` : `${Math.round(score)}/100`;
  C.status = "done";
  C.doneAt = C.t;
  C.result = { score, medal, best: isBest, parts, text: `${tr(d.title)} — ${sc} · ${m}${isBest ? ` · ${t("best")}` : ""}` };
  C.say = C.result.text;
}

function fail(c: CameraController, why: string) {
  const C = c.chal!;
  C.status = "failed";
  C.doneAt = C.t;
  C.result = { score: NaN, medal: null, best: false, text: `${tr(C.def.title)} — ${why}` };
  C.say = C.result.text;
}

/** A frame of the challenge: its clock, its gates, its ceiling, its touchdown, its figures. */
function challengeStep(this: CameraController, dt: number) {
  const C = this.chal;
  if (!C || !(dt > 0)) return;
  if (C.status !== "run") {
    C.t += dt;
    if (C.t - C.doneAt > 15) this.chal = null;
    return;
  }
  const g = this.geoNow();
  if (!g) return;
  const cam = cameraFrame(this.s);
  const fr = this.sfFrame(cam);
  const agl = fr?.h ?? 0;
  C.t += dt;
  const d = C.def;
  const onGround = !!this.rolling || !!this.ourLanded;
  const pos = { lat: g.lat, lon: g.lon, alt: relief(g.lat, g.lon) + agl };
  const touched = this.lastTouch && this.lastTouch.n !== C.touch ? this.lastTouch : null;
  if (touched) C.touch = touched.n;
  if (d.kind === "gates") {
    if (onGround || touched) return fail(this, t("on the ground"));
    if (d.ceiling && agl > d.ceiling) C.over += dt;
    const G = C.gates[C.next];
    if (G && C.prev) {
      const x = gateCrossing(G, C.prev, pos);
      if (x) {
        C.splits.push(C.t);
        if (x.inside) C.say = tf("Gate {0}/{1} · {2} s", C.next + 1, C.gates.length, C.t.toFixed(1));
        else {
          C.missed++;
          // (which way it was missed: the farther out of its frame, across or up)
          const ax = Math.abs(x.across) - G.w / 2,
            ay = Math.abs(x.up) - G.h / 2;
          const way = ax > ay ? (x.across > 0 ? t("right") : t("left")) : x.up > 0 ? t("high") : t("low");
          C.say = tf("Gate {0} missed · {1} m {2} · +{3} s", C.next + 1, Math.round(Math.max(ax, ay)), way, MISS_PENALTY);
        }
        C.next++;
        if (C.next >= C.gates.length) finish(this, C.t + C.missed * MISS_PENALTY + C.over);
      }
    }
    C.prev = pos;
    // (lost: 25 km from the next gate)
    const N = C.gates[C.next];
    if (N && toward(g, N).dist > 25_000) fail(this, t("off the course"));
    return;
  }
  if (d.kind === "landing" && "field" in d.start) {
    if (!touched) return;
    if (touched.gear !== "landed" && touched.gear !== "hard") return fail(this, t("crashed"));
    const site = this.runwayInUse(SITES.find((s) => s.name.includes((d.start as { field: string }).field))!);
    const [e, n] = enu(site, g);
    const h = (site.rwy ?? 0) * D;
    const past = e * Math.sin(h) + n * Math.cos(h),
      off = e * Math.cos(h) - n * Math.sin(h);
    const speed = this.airFlight.last?.speed ?? touched.along;
    const r = landingMarks({ sink: touched.sink, past, off, dv: speed - VREF });
    return finish(this, r.marks, { ...r.parts, sinkMs: touched.sink, pastM: past, offM: off, speedMs: speed });
  }
  if (d.kind === "vertical" && d.pad) {
    if (!touched) return;
    if (touched.gear !== "landed" && touched.gear !== "hard") return fail(this, t("crashed"));
    const dist = toward(g, d.pad).dist;
    const r = verticalMarks({ dist, sink: touched.sink, drift: g.gs });
    return finish(this, r.marks, { ...r.parts, distM: dist, sinkMs: touched.sink, driftMs: g.gs });
  }
  if (d.kind === "aero" && C.aero) {
    if (onGround || touched) return fail(this, t("on the ground"));
    const a = this.attitudeNow() as { bank?: number; heading?: number };
    const sp = this.airFlight.last?.speed ?? 0;
    const f = C.aero.step({
      t: C.t,
      bank: a.bank ?? 0,
      heading: a.heading ?? 0,
      gamma: Math.asin(Math.max(-1, Math.min(1, g.vs / Math.max(sp, 1)))),
      alt: g.alt,
      lat: g.lat,
      lon: g.lon,
    });
    if (f)
      C.say = tf("{0}: {1}/10", tr(f.figure === "roll" ? { fr: "Tonneau", en: "Roll" } : { fr: "Boucle", en: "Loop" }), f.marks.toFixed(1));
    if (C.aero.done) finish(this, C.aero.total(), Object.fromEntries(C.aero.marks.map((m, i) => [`${C.aero!.figures[i]}${i + 1}`, m])));
    if (C.t > 300) fail(this, t("out of time"));
  }
}

/** What the HUD draws of it: its banner, its next gates seen from the craft (their corners, camera coordinates
 *  — null behind), the next one's distance; null: none. */
function challengeHud(this: CameraController, C3: (v: V3 | null) => V3 | null) {
  const C = this.chal;
  if (!C) return null;
  const d = C.def;
  const g = this.geoNow();
  const cam = cameraFrame(this.s);
  const fr = this.sfFrame(cam);
  const gates: { c: (V3 | null)[]; k: number; n: number; dist: number }[] = [];
  if (g && fr && C.status === "run" && d.kind === "gates") {
    const here = relief(g.lat, g.lon) + fr.h;
    for (let i = C.next; i < Math.min(C.next + 3, C.gates.length); i++) {
      const G = C.gates[i]!;
      const [e0, n0] = enu(g, G);
      const dist = Math.hypot(e0, n0);
      // (the Earth's curve: a point d away lies d²/2R below the craft's horizon)
      const u0 = G.alt - here - (dist * dist) / (2 * 6.371e6);
      const h = G.hdg * D;
      const rx = Math.cos(h),
        ry = -Math.sin(h);
      const corner = (sx: number, sy: number): V3 | null => {
        const e = e0 + rx * sx * (G.w / 2),
          n = n0 + ry * sx * (G.w / 2),
          u = u0 + sy * (G.h / 2);
        const w: V3 = [0, 1, 2].map((k) => fr.east[k]! * e + fr.north[k]! * n + fr.up[k]! * u) as V3;
        const l = Math.hypot(...w);
        return C3(fr.toLocal([w[0] / l, w[1] / l, w[2] / l]).map((x) => x * l) as V3);
      };
      gates.push({ c: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], k: i - C.next, n: i + 1, dist });
    }
  }
  const time = d.kind === "gates" ? C.t + C.missed * MISS_PENALTY + C.over : C.t;
  // (the radar's frame — heading up, x right, y ahead [m]: the course's gates ahead, the next first; the pad)
  const hd = (this.attitudeNow() as { heading?: number }).heading ?? 0;
  const cs = Math.cos(hd),
    sn = Math.sin(hd);
  const radar =
    g && C.status === "run"
      ? {
          contacts: [
            ...C.gates.slice(C.next, C.next + 6).map((G, k) => {
              const [e, n] = enu(g, G);
              return { x: e * cs - n * sn, y: e * sn + n * cs, gate: k + C.next + 1, next: k === 0, trk: G.hdg * D - hd };
            }),
            ...(d.pad
              ? [
                  (() => {
                    const [e, n] = enu(g, d.pad!);
                    return { x: e * cs - n * sn, y: e * sn + n * cs, gate: 0, next: true, trk: null };
                  })(),
                ]
              : []),
          ],
        }
      : null;
  return {
    radar,
    title: tr(d.title),
    kind: d.kind,
    time,
    next: C.next,
    count: C.gates.length,
    missed: C.missed,
    over: C.over,
    ceiling: d.ceiling ?? null,
    status: C.status,
    result: C.result,
    figures: C.aero ? { idx: C.aero.idx, list: C.aero.figures, marks: C.aero.marks } : null,
    gates,
  };
}

export function installChallenge(Ctl: { prototype: CameraController }) {
  Object.assign(Ctl.prototype, { challengeStart, challengeStep, challengeAbort, challengeHud });
}
