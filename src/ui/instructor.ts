// The instructor's pages (docs/PLAN-AVIATION-AAA.md, A4 — controller/instructor.ts, game/instructor.ts,
// game/lessons.ts): its live panel while a manoeuvre is flown — the lesson's diagram with our trace drawn over it and
// the step we are at, each channel's gauge (its tolerance, its limit, where we are), its last call and why —, a button
// that pauses and explains; its debrief at the end — the score, the charts of what was flown against the ideal and
// its corridor, each channel's and each phase's marks, what to work on —; and the flight school: a card for each
// manoeuvre — its diagram (each step marked, picked to be shown on it), its steps with their numbers, its common
// errors —, its demonstration flown by the autopilot, or tried by hand with the instructor watching.

import "./instructor.css";
import type { CameraController } from "../controls";
import { type SpaceLesson, SPACE_LESSONS, type SpaceLessonId } from "../game/spacecourse";
import { CHANNELS, type InstrDebrief, type InstrRun } from "../game/instructor";
import { ILS } from "../game/ils";
import { type Lesson, type LessonId, LESSONS, stepAt } from "../game/lessons";
import { t, tf } from "../i18n";
import { type AssistGraph, drawGraph, type GraphPalette } from "./hud/graph";
import { button, el as h, modal } from "./kit";

export interface InstructorHost {
  camera: CameraController;
  toast(s: string): void;
  /** the simulation held (the explanation read) or let go */
  hold(on: boolean): void;
  /** a lesson's demonstration (the autopilot flies it) or its try (by hand, watched) */
  demo(id: LessonId): string;
  tryIt(id: LessonId): string;
  /** TARS first, then the pilot (I3) */
  guided(id: LessonId): string;
  /** a space lesson (PLAN-VAISSEAUX X9): its scene set up, then guided, demonstrated or tried */
  spaceLesson?(id: SpaceLessonId, mode: "guided" | "demo" | "try"): string;
}

const D = Math.PI / 180;
const lessonOf = (id: string) => LESSONS.find((L) => L.id === id) ?? null;

// ------------------------------------------------------------------------------------------- the diagram

/**
 * A lesson's diagram as SVG: its ideal path (dashed), its steps numbered along it (`sel` ringed), our trace and our
 * dot over it. A profile (the ILS's height against the distance) stretched to its box; a plan or a figure kept to
 * scale.
 */
export function diagramSvg(
  L: Lesson,
  o: { w: number; h: number; trace?: [number, number][]; dot?: [number, number] | null; step?: number; sel?: number },
): string {
  const pts = [...L.path, ...(o.trace ?? [])];
  let x0 = Math.min(...pts.map((p) => p[0])),
    x1 = Math.max(...pts.map((p) => p[0])),
    y0 = Math.min(...pts.map((p) => p[1])),
    y1 = Math.max(...pts.map((p) => p[1]));
  const pad = 14;
  const W = o.w - 2 * pad,
    H = o.h - 2 * pad;
  const profile = L.kind === "ils" || L.kind === "basic";
  if (!profile) {
    // (to scale: the larger span sets it)
    const sx = (x1 - x0) / W,
      sy = (y1 - y0) / H;
    const s = Math.max(sx, sy, 1e-6);
    const cx = (x0 + x1) / 2,
      cy = (y0 + y1) / 2;
    x0 = cx - (s * W) / 2;
    x1 = cx + (s * W) / 2;
    y0 = cy - (s * H) / 2;
    y1 = cy + (s * H) / 2;
  } else if (L.kind === "ils") y0 = Math.min(y0, 0);
  const X = (x: number) => pad + ((x - x0) / Math.max(x1 - x0, 1e-6)) * W;
  const Y = (y: number) => pad + H - ((y - y0) / Math.max(y1 - y0, 1e-6)) * H;
  const poly = (P: [number, number][]) => P.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
  const parts: string[] = [];
  // (the ground, the runway, the deck: where it is)
  if (L.kind === "ils")
    parts.push(
      `<line class="ld-ground" x1="${pad}" y1="${Y(0)}" x2="${pad + W}" y2="${Y(0)}"/>`,
      `<rect class="ld-rwy" x="${X(0)}" y="${Y(0) - 2}" width="${Math.max(X(ILS.gpi + 2500) - X(0), 4)}" height="4"/>`,
    );
  if (L.kind === "carrier")
    parts.push(`<rect class="ld-ship" x="${X(-330)}" y="${Y(20) - 4}" width="${Math.max(X(0) - X(-330), 6)}" height="8" rx="2"/>`);
  // (the circuit's runway from above; the leader seen from behind; the target's track; the gunsight's centre)
  if (L.kind === "circuit")
    parts.push(`<rect class="ld-rwy" x="${X(0)}" y="${Y(0) - 3}" width="${Math.max(X(2500) - X(0), 4)}" height="6"/>`);
  if (L.kind === "formation")
    parts.push(
      `<path class="ld-ship" d="M${X(-18)},${Y(0)} L${X(18)},${Y(0)} M${X(0)},${Y(0)} L${X(0)},${Y(6)}"/>`,
      `<rect class="ld-slot" x="${X(34)}" y="${Y(6)}" width="${Math.max(X(46) - X(34), 4)}" height="${Math.max(Y(-6) - Y(6), 4)}"/>`,
    );
  if (L.kind === "intercept")
    parts.push(
      `<path class="ld-ship" d="M${X(2000)},${Y(0)} L${X(-2500)},${Y(0)}"/><circle class="ld-ship" cx="${X(0)}" cy="${Y(0)}" r="4"/>`,
    );
  if (L.kind === "guns")
    parts.push(
      `<circle class="ld-ideal" cx="${X(0)}" cy="${Y(0)}" r="${Math.abs(X(7) - X(0))}"/><circle class="ld-ship" cx="${X(0)}" cy="${Y(0)}" r="2"/>`,
    );
  parts.push(`<polyline class="ld-ideal" points="${poly(L.path)}"/>`);
  if (o.trace?.length) parts.push(`<polyline class="ld-trace" points="${poly(o.trace)}"/>`);
  L.steps.forEach((st, i) => {
    const p = L.path[Math.min(st.at, L.path.length - 1)]!;
    const cls = i === o.sel ? "ld-step ld-sel" : i === o.step ? "ld-step ld-now" : "ld-step";
    parts.push(
      `<g class="${cls}" data-step="${i}"><circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="8"/><text x="${X(p[0]).toFixed(1)}" y="${(Y(p[1]) + 3.5).toFixed(1)}">${i + 1}</text></g>`,
    );
  });
  if (o.dot) parts.push(`<circle class="ld-dot" cx="${X(o.dot[0]).toFixed(1)}" cy="${Y(o.dot[1]).toFixed(1)}" r="5"/>`);
  parts.push(
    `<text class="ld-axis" x="${pad + W}" y="${o.h - 2}" text-anchor="end">${t(L.axes.x)} →</text>`,
    `<text class="ld-axis" x="${pad}" y="10">↑ ${t(L.axes.y)}</text>`,
  );
  return `<svg class="ld-svg" viewBox="0 0 ${o.w} ${o.h}" width="${o.w}" height="${o.h}" role="img" aria-label="${t(L.title)}">${parts.join("")}</svg>`;
}

/** Our trace in the lesson's plane, from the run's samples. */
function traceOf(R: InstrRun): [number, number][] {
  // (a guided lesson's own: its point in the lesson's plane — controller/course.ts)
  if (R.samples.some((s) => s.v.px !== undefined))
    return R.samples.filter((s) => Number.isFinite(s.v.px)).map((s) => [s.v.px!, s.v.py!] as [number, number]);
  if (R.kind === "ils") return R.samples.filter((s) => Number.isFinite(s.v.h)).map((s) => [s.x, s.v.h!] as [number, number]);
  if (R.kind === "figure") return R.samples.filter((s) => Number.isFinite(s.v.along)).map((s) => [s.v.along!, s.v.up!] as [number, number]);
  // (the carrier's pass from above: along the axis, the line-up)
  return R.samples.map((s) => [s.x, s.v.lineup ?? 0] as [number, number]);
}

// ------------------------------------------------------------------------------------------- the live panel

/** The instructor's live panel (left, between the avionics and the radar): shown while a manoeuvre is watched. */
export class InstructorPanel {
  private el = h("div", "ins-panel");
  private key = "";
  private at = 0;
  private folded = false;

  constructor(private host: InstructorHost) {
    this.el.dataset.testid = "instructor-panel";
    this.el.hidden = true;
    document.body.append(this.el);
  }

  tick() {
    const c = this.host.camera;
    const R = c.instr;
    const C = c.course?.run ? c.course : null;
    const full = (c.s.f35Instructor ?? "full") === "full";
    if ((!R && !C) || !full) {
      if (!this.el.hidden) this.el.hidden = true;
      this.key = "";
      return;
    }
    const id = R?.id ?? C!.id;
    const now = performance.now();
    if (now - this.at < 250 && this.key === id) return;
    this.at = now;
    this.key = id;
    this.el.hidden = false;
    const L = lessonOf(id);
    const S = R?.samples[R.samples.length - 1];
    const parts: (HTMLElement | string)[] = [];
    const head = h("div", "ins-head");
    head.append(
      h("b", "ins-title", `${t("Instructor")} · ${R?.title ?? (L ? t(L.title) : id)}`),
      h("span", "ins-phase", S ? t(S.phase) : ""),
    );
    const fold = button({ label: this.folded ? "▸" : "▾", title: t("Fold"), onClick: () => ((this.folded = !this.folded), (this.at = 0)) });
    head.append(fold);
    parts.push(head);
    // (a guided lesson: who flies, its steps, TARS's last words)
    if (C?.run) {
      const run = C.run;
      const st = run.steps[run.i];
      const box = h("div", "ins-course");
      box.dataset.testid = "course-panel";
      const who =
        st?.who === "you" ? h("span", "ins-who ins-who-you", t("YOUR CONTROLS")) : h("span", "ins-who ins-who-tars", t("TARS FLYING"));
      const top = h("div", "");
      top.append(who, document.createTextNode(st ? ` ${run.i + 1}/${run.steps.length} · ${t(st.name)}` : ""));
      const list = h("ol", "ins-csteps");
      run.steps.forEach((x, k) => {
        const li = h(
          "li",
          `${k < run.i ? "ins-cdone" : k === run.i ? "ins-cnow" : ""}${x.who === "you" ? " ins-cyou" : ""}`,
          String(k + 1),
        );
        li.title = t(x.name);
        list.append(li);
      });
      box.append(top, list);
      if (C.said) box.append(h("span", "ins-said", C.said));
      parts.push(box);
    }
    if (!this.folded && R) {
      // (the diagram, our trace and our dot over it, the step we are at)
      if (L) {
        const tr = traceOf(R);
        const dot = tr[tr.length - 1] ?? null;
        const step = dot ? stepAt(L, dot) : 0;
        const d = h("div", "ins-diagram");
        d.innerHTML = diagramSvg(L, { w: 316, h: 140, trace: tr, dot, step });
        parts.push(d);
        const st = L.steps[step];
        if (st) {
          const nx = L.steps[step + 1];
          const s = h("div", "ins-step");
          s.append(h("b", "", `${step + 1}. ${t(st.name)}`), h("span", "", st.detail ? t(st.detail) : ""));
          if (nx) s.append(h("i", "", tf("Next: {0}", t(nx.name))));
          parts.push(s);
        }
      }
      // (the gauges: each channel — its tolerance green, its limit amber, where we are)
      for (const ch of CHANNELS[R.kind]) {
        const v = S?.v[ch.key];
        if (v === undefined || !Number.isFinite(v)) continue;
        const g = h("div", "ins-gauge");
        const k = Math.max(-1, Math.min(1, v / (2 * ch.warn)));
        const state = Math.abs(v) <= ch.tol ? "on" : Math.abs(v) <= ch.warn ? "near" : "off";
        g.innerHTML = `<span class="ins-glabel">${t(ch.label)}</span><span class="ins-gbar"><i class="ins-gwarn" style="left:${50 - (25 * ch.warn) / ch.warn}%;width:${50}%"></i><i class="ins-gtol" style="left:${50 - (25 * ch.tol) / ch.warn}%;width:${(50 * ch.tol) / ch.warn}%"></i><b class="ins-gptr ins-${state}" style="left:${50 + 50 * k}%"></b></span><span class="ins-gval ins-${state}">${v >= 0 ? "+" : ""}${v.toFixed(Math.abs(v) < 10 ? 1 : 0)} ${ch.unit === "dots" ? t("dots") : ch.unit}</span>`;
        parts.push(g);
      }
      // (the last call, its fix; faded after 8 s)
      if (R.last && R.t - R.last.at < 8) {
        const cl = h("div", "ins-call");
        cl.append(h("b", "", t(R.last.text)), h("span", "", t(R.last.fix)));
        parts.push(cl);
      }
      const row = h("div", "ins-row");
      row.append(
        button({
          label: t("Explain"),
          testid: "ins-explain",
          onClick: () => {
            this.host.hold(true);
            if (L) lessonCard(this.host, L, () => this.host.hold(false));
          },
        }),
      );
      parts.push(row);
    }
    this.el.replaceChildren(...parts);
  }
}

// ------------------------------------------------------------------------------------------- the debrief

const PAL: GraphPalette = {
  bg: null,
  grid: "rgba(160, 210, 255, 0.16)",
  text: "#e8f0fa",
  dim: "rgba(190, 215, 240, 0.7)",
  ideal: "rgba(120, 255, 170, 0.9)",
  corridor: "rgba(120, 255, 170, 0.16)",
  flown: "#ffffff",
  on: "#5dff8a",
  off: "#ffb03a",
  wait: "#6fe8ff",
  font: "Rajdhani, Inter, system-ui, sans-serif",
};

/** The run's charts: the ILS's height and its lateral gap against the distance; the carrier's glide path's error and
 *  line-up; a figure's load against the time — each with its ideal and its corridor. */
function chartsOf(R: InstrRun): AssistGraph[] {
  const S = R.samples;
  const mk = (
    title: string,
    x: AssistGraph["x"],
    y: AssistGraph["y"],
    flown: [number, number][],
    ideal: [number, number][],
    lo: [number, number][],
    hi: [number, number][],
  ): AssistGraph => ({
    kind: "lesson",
    title,
    x,
    y,
    ideal,
    lo,
    hi,
    flown,
    now: null,
    marks: [],
    state: "on",
  });
  const xs = S.map((s) => s.x);
  const xMin = Math.min(...xs),
    xMax = Math.max(...xs);
  const span = (k: number) => Array.from({ length: 24 }, (_, i) => xMin + ((xMax - xMin) * i) / 23).map(k === 0 ? (x) => x : (x) => x);
  if (R.kind === "ils") {
    const gs = (x: number, d: number) => Math.max((ILS.gpi - x) * Math.tan((ILS.glide + d) * D), 0);
    const X = span(0);
    const hs = S.filter((s) => Number.isFinite(s.v.h));
    const yMax = Math.max(...hs.map((s) => s.v.h!), gs(xMin, 0)) * 1.1;
    const lat = S.filter((s) => Number.isFinite(s.v.across));
    const aMax = Math.max(60, ...lat.map((s) => Math.abs(s.v.across!))) * 1.2;
    const band = (x: number) => Math.tan(ILS.locDot * D) * (4500 + ILS.locBeyond - x);
    return [
      mk(
        t("Height against the distance"),
        { label: t("To the threshold"), unit: "km", min: xMin / 1000, max: xMax / 1000 },
        { label: t("Height"), unit: "m", min: 0, max: yMax },
        hs.map((s) => [s.x / 1000, s.v.h!]),
        X.map((x) => [x / 1000, gs(x, 0)]),
        X.map((x) => [x / 1000, gs(x, -ILS.gsDot)]),
        X.map((x) => [x / 1000, gs(x, ILS.gsDot)]),
      ),
      mk(
        t("Off the centreline"),
        { label: t("To the threshold"), unit: "km", min: xMin / 1000, max: xMax / 1000 },
        { label: t("Across"), unit: "m", min: -aMax, max: aMax },
        lat.map((s) => [s.x / 1000, s.v.across!]),
        X.map((x) => [x / 1000, 0]),
        X.map((x) => [x / 1000, -band(x)]),
        X.map((x) => [x / 1000, band(x)]),
      ),
    ];
  }
  if (R.kind === "carrier") {
    const X = span(0);
    const gl = S.map((s) => [s.x, s.v.glide ?? 0] as [number, number]);
    const lu = S.map((s) => [s.x, s.v.lineup ?? 0] as [number, number]);
    const gMax = Math.max(1, ...gl.map((p) => Math.abs(p[1]))) * 1.2;
    const lMax = Math.max(8, ...lu.map((p) => Math.abs(p[1]))) * 1.2;
    return [
      mk(
        t("Glide path (the ball)"),
        { label: t("To the wires"), unit: "m", min: xMin, max: xMax },
        { label: t("Error"), unit: "°", min: -gMax, max: gMax },
        gl,
        X.map((x) => [x, 0]),
        X.map((x) => [x, -0.25]),
        X.map((x) => [x, 0.25]),
      ),
      mk(
        t("Line-up"),
        { label: t("To the wires"), unit: "m", min: xMin, max: xMax },
        { label: t("To port"), unit: "m", min: -lMax, max: lMax },
        lu,
        X.map((x) => [x, 0]),
        X.map((x) => [x, -2]),
        X.map((x) => [x, 2]),
      ),
    ];
  }
  if (R.kind !== "figure") {
    // (a guided lesson's: each of its first two channels against the time, its tolerance about 0)
    const T = S.map((s) => s.t);
    const t0 = Math.min(...T),
      t1 = Math.max(...T);
    const X = Array.from({ length: 24 }, (_, i) => t0 + ((t1 - t0) * i) / 23);
    return CHANNELS[R.kind]
      .map((c) => ({ c, pts: S.filter((s) => Number.isFinite(s.v[c.key])).map((s) => [s.t, s.v[c.key]!] as [number, number]) }))
      .filter((x) => x.pts.length > 3)
      .slice(0, 2)
      .map(({ c, pts }) => {
        const m = Math.max(c.warn * 1.5, ...pts.map((p) => Math.abs(p[1]))) * 1.15;
        return mk(
          t(c.label),
          { label: t("Time"), unit: "s", min: t0, max: t1 },
          { label: t("Off"), unit: c.unit as AssistGraph["y"]["unit"], min: -m, max: m },
          pts,
          X.map((x) => [x, 0]),
          X.map((x) => [x, -c.tol]),
          X.map((x) => [x, c.tol]),
        );
      });
  }
  const X = span(0);
  const gg = S.filter((s) => Number.isFinite(s.v.g)).map((s) => [s.x, s.v.g!] as [number, number]);
  const m = Math.max(2, ...gg.map((p) => Math.abs(p[1]))) * 1.2;
  return [
    mk(
      t("The load against the one asked"),
      { label: t("Time"), unit: "s", min: xMin, max: xMax },
      { label: t("Off"), unit: "g", min: -m, max: m },
      gg,
      X.map((x) => [x, 0]),
      X.map((x) => [x, -0.7]),
      X.map((x) => [x, 0.7]),
    ),
  ];
}

/** The debrief's letter for a score out of 20. */
const letterOf = (s: number) => (s >= 17 ? "A" : s >= 14 ? "B" : s >= 11 ? "C" : s >= 8 ? "D" : "F");

/** The debrief: the score, the charts, each channel's and each phase's marks, what to work on; again, its card. */
/** The debrief shown (one at a time). */
let debriefOpen: { root: HTMLElement; close: () => void } | null = null;

/** The debrief shown closed (a new lesson, the craft placed elsewhere). */
export function closeDebrief() {
  if (debriefOpen?.root.isConnected) debriefOpen.close();
  debriefOpen = null;
}

export function debriefInstr(host: InstructorHost, last: { run: InstrRun; debrief: InstrDebrief }) {
  closeDebrief();
  const { run: R, debrief: B } = last;
  const body = h("div", "ins-debrief");
  const top = h("div", "ins-score");
  top.append(h("b", `ins-letter ins-l${letterOf(B.score)}`, letterOf(B.score)), h("span", "", `${B.score.toFixed(1)}/20`));
  body.append(top);
  // (the charts)
  const charts = h("div", "ins-charts");
  for (const G of chartsOf(R)) {
    const cv = h("canvas", "ins-chart");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = 360 * dpr;
    cv.height = 200 * dpr;
    cv.style.width = "360px";
    cv.style.height = "200px";
    const g = cv.getContext("2d");
    if (g) {
      g.font = `${12 * dpr}px ${PAL.font}`;
      g.fillStyle = PAL.text;
      g.fillText(G.title, 6 * dpr, 14 * dpr);
      drawGraph(g, G, { x: 0, y: 18 * dpr, w: cv.width, h: cv.height - 18 * dpr }, PAL, dpr, { names: true });
    }
    charts.append(cv);
  }
  body.append(charts);
  // (each channel: its share within the tolerance, its worst)
  const tab = h("table", "ins-table");
  tab.innerHTML = `<tr><th>${t("Channel")}</th><th>${t("Within tolerance")}</th><th>${t("Worst")}</th><th>${t("Mark")}</th></tr>${B.channels
    .map(
      (c) =>
        `<tr><td>${t(c.label)}</td><td>${Math.round(c.inTol * 100)} %</td><td>${c.worst >= 0 ? "+" : ""}${c.worst.toFixed(Math.abs(c.worst) < 10 ? 1 : 0)} ${c.unit === "dots" ? t("dots") : c.unit}</td><td><i class="ins-mark" style="width:${Math.round(c.mark * 100)}%"></i></td></tr>`,
    )
    .join("")}`;
  body.append(tab);
  // (each phase's mark)
  const ph = h("div", "ins-phases");
  for (const p of B.phases) {
    const r = h("div", "ins-phaserow");
    r.innerHTML = `<span>${t(p.phase)}</span><i class="ins-mark" style="width:${Math.round(p.mark * 100)}%"></i><em>${Math.round(p.secs)} s</em>`;
    ph.append(r);
  }
  body.append(h("h4", "ins-h", t("By phase")), ph);
  if (B.tips.length) {
    body.append(h("h4", "ins-h", t("To work on")));
    const ul = h("ul", "ins-tips");
    for (const tp of B.tips) {
      const li = h("li");
      li.append(h("b", "", t(tp.text)), document.createTextNode(` — ${t(tp.fix)}`));
      ul.append(li);
    }
    body.append(ul);
  } else body.append(h("p", "ins-good", t("Clean: every channel within its tolerance.")));
  const m = modal({ title: tf("Debrief — {0}", R.title), body: [body], cls: "ins-frame", testid: "instructor-debrief" });
  debriefOpen = m;
  const row = h("div", "ins-row");
  const L = lessonOf(R.id);
  row.append(
    button({
      label: t("Again"),
      kind: "primary",
      testid: "ins-again",
      onClick: () => {
        m.close();
        host.toast(host.tryIt(R.id as LessonId));
      },
    }),
  );
  if (L) row.append(button({ label: t("The lesson's card"), onClick: () => (m.close(), lessonCard(host, L)) }));
  row.append(button({ label: t("Close"), onClick: () => m.close() }));
  body.append(row);
}

// ------------------------------------------------------------------------------------------- the flight school

/** A lesson's card: its diagram (a step picked shown ringed on it), its steps, its errors; demonstrated or tried. */
export function lessonCard(host: InstructorHost, L: Lesson, onClose?: () => void) {
  const body = h("div", "ins-card");
  const diag = h("div", "ins-bigdiagram");
  const draw = (sel?: number) => (diag.innerHTML = diagramSvg(L, { w: 560, h: 260, sel }));
  draw();
  const steps = h("ol", "ins-steps");
  L.steps.forEach((st, i) => {
    const li = h("li", "ins-stepitem");
    li.append(h("b", "", t(st.name)), h("span", "", st.detail ? t(st.detail) : ""));
    li.onmouseenter = () => draw(i);
    li.onfocus = () => draw(i);
    li.onmouseleave = () => draw();
    li.tabIndex = 0;
    steps.append(li);
  });
  // (a step's marker picked on the diagram: its line lit)
  diag.onclick = (e) => {
    const g = (e.target as Element).closest("[data-step]");
    if (!g) return;
    const i = Number(g.getAttribute("data-step"));
    draw(i);
    [...steps.children].forEach((c, k) => c.classList.toggle("ins-lit", k === i));
  };
  const errs = h("ul", "ins-errors");
  for (const e of L.errors) errs.append(h("li", "", t(e)));
  body.append(
    h("p", "ins-summary", t(L.summary)),
    diag,
    h("h4", "ins-h", t("Its steps")),
    steps,
    h("h4", "ins-h", t("What it is lost to")),
    errs,
  );
  const m = modal({ title: t(L.title), body: [body], cls: "ins-frame", testid: "lesson-card", onClose });
  const row = h("div", "ins-row");
  row.append(
    button({ label: t("Watch the demonstration"), testid: "lesson-demo", onClick: () => (m.close(), host.toast(host.demo(L.id))) }),
    button({
      label: t("Guided: TARS, then you"),
      kind: "primary",
      testid: "lesson-guided",
      onClick: () => (m.close(), host.toast(host.guided(L.id))),
    }),
    button({ label: t("Try it"), testid: "lesson-try", onClick: () => (m.close(), host.toast(host.tryIt(L.id))) }),
  );
  body.append(row);
}

/** The flight school: the lessons' cards, each its diagram in small. */
export function flightSchool(host: InstructorHost, o: { spaceFirst?: boolean } = {}) {
  const grid = h("div", "ins-school");
  // (the spacecraft's school beside the aeroplane's — PLAN-VAISSEAUX X9: its lessons first in a spacecraft)
  const space = h("div", "ins-school");
  for (const L of SPACE_LESSONS) {
    const c = h("button", "ins-lesson ins-space");
    c.type = "button";
    c.dataset.testid = `space-lesson-${L.id}`;
    c.append(h("b", "", t(L.title)), h("span", "", t(L.summary)));
    c.onclick = () => (m.close(), spaceLessonCard(host, L));
    space.append(c);
  }
  const inSpace = o.spaceFirst ?? (host.camera.piloting && host.camera.s.vessel !== "f35" && host.camera.s.vessel !== "a320");
  const body = inSpace
    ? [h("h4", "ins-h", t("The space school")), space, h("h4", "ins-h", t("The aeroplane school")), grid]
    : [grid, h("h4", "ins-h", t("The space school")), space];
  const m = modal({ title: t("Flight school"), body, cls: "ins-frame ins-wide", testid: "flight-school" });
  for (const L of LESSONS) {
    const c = h("button", "ins-lesson");
    c.type = "button";
    c.dataset.testid = `lesson-${L.id}`;
    const d = h("div", "ins-mini");
    d.innerHTML = diagramSvg(L, { w: 200, h: 90 });
    c.append(d, h("b", "", t(L.title)), h("span", "", t(L.summary)));
    c.onclick = () => (m.close(), lessonCard(host, L));
    grid.append(c);
  }
}

/** A space lesson's card (PLAN-VAISSEAUX X9): its summary, its steps (TARS's and the pilot's), the three ways to take it. */
export function spaceLessonCard(host: InstructorHost, L: SpaceLesson) {
  const body = h("div", "ins-card");
  const steps = h("ol", "ins-steps");
  for (const st of L.steps) {
    const li = h("li", "ins-stepitem");
    li.append(h("b", "", `${st.who === "tars" ? "TARS" : t("You")} · ${t(st.name)}`), h("span", "", t(st.say)));
    steps.append(li);
  }
  body.append(h("p", "ins-summary", t(L.summary)), h("h4", "ins-h", t("Its steps")), steps);
  const m = modal({ title: t(L.title), body: [body], cls: "ins-frame", testid: "space-lesson-card" });
  const go = (mode: "guided" | "demo" | "try") => () => {
    m.close();
    host.toast(host.spaceLesson?.(L.id, mode) ?? t("No such lesson"));
  };
  const row = h("div", "ins-row");
  row.append(
    button({ label: t("Watch the demonstration"), testid: "space-lesson-demo", onClick: go("demo") }),
    button({ label: t("Guided: TARS, then you"), kind: "primary", testid: "space-lesson-guided", onClick: go("guided") }),
    button({ label: t("Try it alone"), testid: "space-lesson-try", onClick: go("try") }),
  );
  body.append(row);
}
