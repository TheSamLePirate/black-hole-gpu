// Flight HUD of the Ranger — laid out like a game's: the centre of the screen stays clear, the
// instruments live on its edges.
//
//  mission bar (top)        modes (SAS / hold / autopilot), time warp, the ship's clock τ against the
//                           distant clock t and their ratio, the tools menu
//  tapes (left / right)     speed (relative to the ZAMO, autopilot target bug) and altitude on a log
//                           scale (horizon, photon orbit, ISCO, periapsis / apoapsis, the star's orbit)
//                           with a vertical-speed bar
//  view markers             the nose, prograde / retrograde, burn, velocity relative to the target
//  target (top left)        distance, range rate, closest approach
//  telemetry (top right)    the last minute of speed, altitude, clock rate and thrust
//  orbit (bottom left)      the effective potential of the ship's orbit (Kerr, with L and Carter's Q):
//                           the energy line, the turning points, the region it can reach
//  cockpit (bottom centre)  the attitude ball inside throttle and g-load arcs, holds and autopilots
//  map (bottom right)       the real motions (centre-of-mass frame), attach points of the camera
//
// N cycles the density: full · minimal (tapes, cockpit, mission bar) · clean (markers only).

import type { Settings } from "../settings";
import type { CameraController } from "../controls";
import { AUTO_NAMES, HOLD_NAMES, type Auto, type Hold } from "../pilot";
import { MOUNT_KEYS, MOUNTS, type Mount } from "../mounts";
import { mouth } from "../wormhole";
import { barycentre, bodyCentre, BODY_NAMES, starCentre, starOmega, starOrbitRadius } from "../targeting";
import { isco } from "../physics";
import { GARGANTUA_SYSTEM } from "../system/bodies";
import { bodyState, meanMotion } from "../system/ephemeris";

type Info = ReturnType<CameraController["flightInfo"]>;
type V3 = [number, number, number];

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const HOLD_KEYS: [Hold, string, string][] = [
  ["prograde", "PRO", "1"], ["retrograde", "RETRO", "2"], ["radialOut", "RAD+", "3"], ["radialIn", "RAD−", "4"],
  ["normal", "NRM+", "5"], ["antinormal", "NRM−", "6"], ["target", "TGT", "7"],
];
const AUTO_KEYS: [Auto, string, string][] = [["hover", "HOLD POS", "8"], ["circularize", "CIRC", "9"], ["approach", "APPROACH", "0"]];

const AMBER = "#ffb35c";
const CYAN = "#7cd6ff";
const RED = "#ff5a46";
const COL: Record<string, string> = {
  prograde: "#d6f55b", retrograde: "#d6f55b", radialOut: "#5fd3ff", radialIn: "#5fd3ff",
  normal: "#e07bff", antinormal: "#e07bff", target: "#ff8a5c", burn: "#4d8dff", tgtPrograde: "#ff8a5c", tgtRetrograde: "#ff8a5c",
};
const GLYPH: Record<string, string> = {
  prograde: "prograde", retrograde: "retrograde", radialOut: "prograde", radialIn: "retrograde", normal: "prograde", antinormal: "retrograde",
  target: "target", burn: "burn", tgtPrograde: "prograde", tgtRetrograde: "retrograde",
};
const FONT = "Inter, system-ui, sans-serif";
const MONO = '"JetBrains Mono", ui-monospace, monospace';

export interface FlightHudActions {
  plan(goal: "orbit" | "star" | "wormhole", r2: number, orbitStar: boolean): void;
  align(goal: "orbit" | "star" | "wormhole"): void;
  addNode(): void;
  nudge(i: number, dv: V3, dt: number): void;
  deleteNode(i: number): void;
  clearPlan(): void;
  execute(): void;
  hold(h: Hold): void;
  auto(a: Auto): void;
  sas(): void;
  roll(): void;
  warp(dir: 1 | -1): void;
  mount(m: Mount): void;
  lookAhead(): void;
  throttle(t: number): void;
}

interface Sample { w: number; speed: number; r: number; dtau: number; g: number }

export class FlightHud {
  private root = h("div", "fl-root");
  private hud: HTMLCanvasElement;
  private warn = h("div", "fl-warn");
  private mission = h("div", "fl-mission fl-panel");
  private missionEls: Record<string, HTMLElement> = {};
  private target = h("div", "fl-target fl-panel");
  private targetEls: Record<string, HTMLElement> = {};
  private tel = h("div", "fl-tel fl-panel");
  private telCanvas = h("canvas", "fl-telc");
  private orbit = h("div", "fl-orbit fl-panel");
  private planner = h("div", "fl-plan fl-panel");
  private planEls: Record<string, HTMLElement> = {};
  private goal: "orbit" | "star" | "wormhole" = "orbit";
  private r2 = 30;
  private starOrbit = true;
  private sel = 0;
  private planSig = "";
  plannerOpen = false;
  private veff = h("canvas", "fl-veff");
  private orbitEls: Record<string, HTMLElement> = {};
  private cockpit = h("div", "fl-cockpit");
  private ball = h("canvas", "fl-ball");
  private right = h("div", "fl-right fl-panel");
  private map = h("canvas", "fl-map");
  private mapBtns: Record<string, HTMLButtonElement> = {};
  private buttons = new Map<string, HTMLButtonElement>();
  private textAt = 0;
  private extent = 40;
  private centre: [number, number] = [0, 0];
  private zoom = 1;
  private view: "top" | "side" = "top";
  /** multi-scale map: radius ∝ ln(1 + r/M) (angles kept) — null: automatic (on in a system) */
  private logMap: boolean | null = null;
  private frame: "cm" | "hole" = "cm";
  private trail: { X: V3; t: number }[] = [];
  private samples: Sample[] = [];
  private ballImg: ImageData | null = null;
  private ballFrame = 0;
  private throttleDrag = false;
  private start: { t: number; tau: number } | null = null;
  /** 0 full · 1 minimal · 2 clean */
  density = 0;
  visible = false;

  constructor(private s: Settings, private act: FlightHudActions) {
    this.hud = h("canvas", "fl-hud");
    try {
      this.density = Math.min(2, Math.max(0, Number(localStorage.getItem("kerr.hud-density")) || 0));
    } catch {
      /* private mode */
    }

    // ---- mission bar
    const chip = (key: string, label: string) => {
      const c = h("span", "fl-chip");
      c.append(h("i"), h("span", "", label));
      this.missionEls[key] = c;
      return c;
    };
    const clock = (key: string, label: string, title: string) => {
      const c = h("div", "fl-clock");
      c.title = title;
      const v = h("b");
      c.append(h("span", "", label), v);
      this.missionEls[key] = v;
      return c;
    };
    const warpBox = h("div", "fl-warpbox");
    const wv = h("b");
    this.missionEls.warp = wv;
    const wb = (d: 1 | -1, t: string) => {
      const b = h("button", "", t) as HTMLButtonElement;
      b.title = d < 0 ? "Slower time [,]" : "Faster time [.]";
      b.onclick = () => act.warp(d);
      return b;
    };
    warpBox.append(h("span", "", "Warp"), wb(-1, "‹"), wv, wb(1, "›"));
    const tools = h("button", "fl-tools", "⋯") as HTMLButtonElement;
    tools.title = "Tools (the app's toolbar)";
    tools.onclick = () => document.body.classList.toggle("show-tools");
    const planBtn = h("button", "fl-tools fl-planbtn", "PLAN") as HTMLButtonElement;
    planBtn.title = "Flight planner: transfers, rendezvous, manoeuvre nodes [O]";
    planBtn.onclick = () => this.togglePlanner();
    this.missionEls.planBtn = planBtn;
    const dens = h("button", "fl-tools", "◐") as HTMLButtonElement;
    dens.title = "HUD density: full · minimal · clean [N]";
    dens.onclick = () => this.cycleDensity();
    this.mission.append(
      chip("sas", "SAS"), chip("hold", "HOLD"), chip("auto", "AUTO"),
      h("span", "fl-vsep"), warpBox, h("span", "fl-vsep"),
      clock("tau", "Ship τ", "Proper time on the ship since you took the controls"),
      clock("t", "Far t", "Coordinate time: the clocks of distant observers"),
      clock("ratio", "τ / t", "Time dilation: how fast the ship's clock runs"),
      clock("lost", "Earth +", "Time gained by the far-away clocks — the Earth's, through the wormhole — over the ship's since you took the controls: t − τ (the two mouths assumed in step)"),
      h("span", "fl-vsep"), planBtn, dens, tools,
    );
    this.buildPlanner();

    // ---- target
    this.target.append(h("div", "fl-title", "Target"));
    for (const [k, label] of [["name", ""], ["dist", "Range"], ["rate", "Range rate"], ["ca", "Closest approach"]] as const) {
      const row = h("div", k === "name" ? "fl-tname" : "fl-kv");
      if (label) row.append(h("span", "", label));
      const v = h("b");
      row.append(v);
      this.targetEls[k] = v;
      this.target.append(row);
    }

    // ---- telemetry
    this.tel.append(h("div", "fl-title", "Telemetry · 60 s"), this.telCanvas);

    // ---- orbit: effective potential + figures
    const orbitHead = h("div", "fl-title", "Orbit · effective potential");
    const grid = h("div", "fl-grid");
    for (const [k, label] of [["course", "Course"], ["pe", "Periapsis"], ["ap", "Apoapsis"], ["el", "E · L"]] as const) {
      const c = h("div", "fl-cell");
      const v = h("b");
      c.append(h("span", "", label), v);
      this.orbitEls[k] = v;
      grid.append(c);
    }
    this.orbit.append(orbitHead, this.veff, grid);

    // ---- cockpit: holds | ball | autopilots
    const mk = (id: string, label: string, key: string, title: string, fn: () => void, glyph?: string, col?: string) => {
      const b = h("button", "fl-btn") as HTMLButtonElement;
      if (glyph) b.append(glyphSvg(glyph, col!));
      b.append(h("span", "", label), h("kbd", "", key));
      b.title = title;
      b.onclick = fn;
      this.buttons.set(id, b);
      return b;
    };
    const holds = h("div", "fl-holds");
    for (const [hold, label, key] of HOLD_KEYS) holds.append(mk(hold, label, key, `Hold ${HOLD_NAMES[hold]}`, () => act.hold(hold), GLYPH[hold], COL[hold]));
    const autos = h("div", "fl-autos");
    autos.append(mk("sas", "SAS", "T", "Stability assist: holds the attitude, damps rotation", () => act.sas()));
    autos.append(mk("roll", "ROLL", "R", "Roll alignment: while the nose is held, the wings stay in the orbital plane (the top towards the orbit's normal)", () => act.roll()));
    for (const [a, label, key] of AUTO_KEYS) autos.append(mk(a, label, key, `Autopilot: ${AUTO_NAMES[a]}`, () => act.auto(a)));
    const ballBox = h("div", "fl-ballbox");
    ballBox.append(this.ball);
    this.cockpit.append(holds, ballBox, autos);
    this.ball.title = "Attitude: sky (away from the hole) and ground, markers around the nose. Left arc: throttle (drag it) · right arc: g-load";
    this.ball.addEventListener("pointerdown", (e) => this.onBall(e, true));
    this.ball.addEventListener("pointermove", (e) => this.onBall(e, false));
    this.ball.addEventListener("pointerup", () => (this.throttleDrag = false));

    // ---- camera + map
    const cams = h("div", "fl-cams");
    cams.append(h("span", "fl-label", "Camera"));
    for (const m of MOUNT_KEYS) {
      const b = h("button", "", MOUNTS[m].short) as HTMLButtonElement;
      b.title = `${MOUNTS[m].label}  [V / ⇧V]`;
      b.onclick = () => act.mount(m);
      this.buttons.set(`mount:${m}`, b);
      cams.append(b);
    }
    const ahead = h("button", "fl-ahead", "↺") as HTMLButtonElement;
    ahead.title = "Look ahead (drag the view to look around from the attach point) [double-click]";
    ahead.onclick = () => act.lookAhead();
    this.buttons.set("ahead", ahead);
    cams.append(ahead);
    const bar = h("div", "fl-mapbar");
    const tog = (id: string, label: string, title: string, fn: () => void) => {
      const b = h("button", "", label) as HTMLButtonElement;
      b.title = title;
      b.onclick = fn;
      this.mapBtns[id] = b;
      return b;
    };
    bar.append(
      h("span", "fl-label", "Map"),
      tog("top", "Top", "Seen from above the spin axis", () => (this.view = "top")),
      tog("side", "Side", "Seen edge-on (along the equator)", () => (this.view = "side")),
      tog("cm", "CoM", "Inertial frame of the centre of mass: Gargantua moves too", () => (this.frame = "cm")),
      tog("hole", "Hole", "Gargantua's frame (fixed at the centre)", () => (this.frame = "hole")),
      tog("log", "Log", "Multi-scale map: distance from the centre as ln(1 + r/M), directions kept — Miller at 10 M and Edmunds at 2 000 M on the same map", () => (this.logMap = !this.isLog())),
    );
    this.map.title = "Wheel: zoom · double-click: fit";
    this.map.addEventListener("wheel", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.zoom = Math.min(20, Math.max(0.03, this.zoom * Math.exp(e.deltaY * 0.0015)));
    }, { passive: false });
    this.map.addEventListener("dblclick", () => (this.zoom = 1));
    this.right.append(cams, bar, this.map);

    this.root.append(this.warn, this.mission, this.target, this.tel, this.planner, this.orbit, this.cockpit, this.right);
    document.body.append(this.hud, this.root);
    this.show(false);
  }

  show(on: boolean) {
    this.visible = on;
    this.root.hidden = !on;
    this.hud.hidden = !on;
    document.body.classList.toggle("piloting", on);
    document.body.classList.remove("show-tools");
    this.applyDensity();
    if (!on) (this.trail = []), (this.samples = []), (this.start = null);
  }

  togglePlanner(open = !this.plannerOpen) {
    this.plannerOpen = open;
    this.root.classList.toggle("planning", open);
    this.missionEls.planBtn?.classList.toggle("on", open);
  }

  private buildPlanner() {
    const P = this.planner;
    const head = h("div", "fl-title", "Flight planner");
    const close = h("button", "fl-x", "×") as HTMLButtonElement;
    close.onclick = () => this.togglePlanner(false);
    head.append(close);
    // goal: the body, then what to do there
    const seg = h("div", "fl-seg");
    const goals: [typeof this.goal, string, string][] = [
      ["orbit", "Gargantua", "A circular orbit of the chosen radius around the black hole"],
      ["star", "Star", "Rendezvous with the companion star, then station-keeping"],
      ["wormhole", "Wormhole", "A path through the wormhole's mouth"],
    ];
    for (const [g, label, title] of goals) {
      const b = h("button", "", label) as HTMLButtonElement;
      b.title = title;
      b.onclick = () => {
        this.goal = g;
        this.planSig = "";
      };
      this.planEls[`goal:${g}`] = b;
      seg.append(b);
    }
    const goalRow = h("div", "fl-goal");
    const desc = h("span");
    this.planEls.desc = desc;
    const rBox = h("span", "fl-rbox");
    const rv = h("b");
    this.planEls.r2 = rv;
    const nud = (d: number, t: string) => {
      const b = h("button", "", t) as HTMLButtonElement;
      b.onclick = () => (this.r2 = Math.max(2, Math.round(this.r2 * (d > 0 ? 1.1 : 1 / 1.1) * 10) / 10));
      return b;
    };
    rBox.append(nud(-1, "‹"), rv, nud(1, "›"));
    this.planEls.rBox = rBox;
    // at the star: keep station, or go round it
    const sBox = h("span", "fl-rbox");
    for (const [orbit, label, title] of [[false, "Station", "Stop next to the star and keep station"], [true, "Orbit", "Insert into a circular orbit around the star"]] as const) {
      const b = h("button", "", label) as HTMLButtonElement;
      b.title = title;
      b.onclick = () => (this.starOrbit = orbit);
      this.planEls[`star:${orbit}`] = b;
      sBox.append(b);
    }
    this.planEls.sBox = sBox;
    const go = h("button", "fl-go", "PLAN TRANSFER") as HTMLButtonElement;
    go.title = "Transfer to the goal (from the new plane when a plane change is planned)";
    go.onclick = () => this.act.plan(this.goal, this.r2, this.starOrbit);
    const align = h("button", "fl-align", "ALIGN PLANE") as HTMLButtonElement;
    align.title = "Plane change: turn the orbit into the goal's plane at the next crossing (ascending / descending node) — do it first, transfers are then cheaper";
    align.onclick = () => this.act.align(this.goal);
    this.planEls.align = align;
    const goRow = h("div", "fl-gorow");
    goRow.append(align, go);
    goalRow.append(desc, rBox, sBox);
    // nodes
    const nodes = h("div", "fl-nodes");
    this.planEls.nodes = nodes;
    const edit = h("div", "fl-edit");
    const eb = (label: string, dv: V3, dt: number, title: string) => {
      const b = h("button", "", label) as HTMLButtonElement;
      b.title = title;
      b.onclick = (e) => {
        const k = (e as MouseEvent).shiftKey ? 10 : (e as MouseEvent).altKey ? 0.1 : 1;
        this.act.nudge(this.sel, [dv[0] * k, dv[1] * k, dv[2] * k], dt * k);
      };
      return b;
    };
    const step = 0.002;
    edit.append(
      h("span", "fl-label", "Δv"),
      eb("PRO−", [-step, 0, 0], 0, "Less prograde (⇧ ×10, ⌥ ×0.1)"), eb("PRO+", [step, 0, 0], 0, "More prograde (⇧ ×10, ⌥ ×0.1)"),
      eb("NRM−", [0, -step, 0], 0, "Anti-normal"), eb("NRM+", [0, step, 0], 0, "Normal"),
      eb("RAD−", [0, 0, -step], 0, "Radial in"), eb("RAD+", [0, 0, step], 0, "Radial out"),
      h("span", "fl-label", "Time"), eb("−", [0, 0, 0], -10, "Earlier (⇧ ×10)"), eb("+", [0, 0, 0], 10, "Later (⇧ ×10)"),
    );
    this.planEls.edit = edit;
    const result = h("div", "fl-result");
    this.planEls.result = result;
    const actions = h("div", "fl-actions");
    const btn = (label: string, cls: string, title: string, fn: () => void) => {
      const b = h("button", cls, label) as HTMLButtonElement;
      b.title = title;
      b.onclick = fn;
      return b;
    };
    const exec = btn("EXECUTE ▶", "fl-go", "Fly the plan: warp to each node, burn, then circularize or keep station", () => this.act.execute());
    this.planEls.exec = exec;
    actions.append(
      btn("+ NODE", "", "A manual node a tenth of an orbit ahead: shape the burn with the Δv buttons", () => this.act.addNode()),
      btn("CLEAR", "", "Delete the plan", () => this.act.clearPlan()),
      exec,
    );
    P.append(head, seg, goalRow, goRow, nodes, edit, result, actions);
  }

  private drawPlanner(i: Info, time: number) {
    const s = this.s;
    const E = this.planEls;
    // (in a system the "star" goal is the targeted body: a planet, the companion star)
    const body = s.system !== "none" && s.target !== "hole" && s.target !== "wormhole" && s.target !== "barycentre" ? s.target : null;
    const there = body ? BODY_NAMES[body] : "the star";
    for (const g of ["orbit", "star", "wormhole"] as const) {
      E[`goal:${g}`]!.classList.toggle("on", this.goal === g);
      (E[`goal:${g}`] as HTMLButtonElement).disabled = (g === "star" && !s.sun && !body) || (g === "wormhole" && !s.wormhole);
    }
    const starTab = E["goal:star"]!;
    const tabLabel = body ? BODY_NAMES[body] : "Star";
    if (starTab.textContent !== tabLabel) starTab.textContent = tabLabel;
    E["star:false"]!.title = `Stop next to ${there} and keep station`;
    E["star:true"]!.title = `Insert into a circular orbit around ${there}`;
    E.desc!.textContent = this.goal === "orbit" ? "Circular orbit at r =" : this.goal === "star" ? "Rendezvous, then" : "Dive through the mouth";
    E.rBox!.hidden = this.goal !== "orbit";
    E.sBox!.hidden = this.goal !== "star";
    E["star:true"]!.classList.toggle("on", this.starOrbit);
    E["star:false"]!.classList.toggle("on", !this.starOrbit);
    // the orbit's angle to the goal's plane
    const off = i.planes ? (this.goal === "wormhole" ? i.planes.wormhole : i.planes.orbit) : null;
    E.align!.textContent = off === null ? "ALIGN PLANE" : `ALIGN PLANE · ${off.toFixed(1)}°`;
    E.align!.classList.toggle("aligned", off !== null && off < 0.5);
    (E.align as HTMLButtonElement).disabled = off === null;
    E.r2!.textContent = `${this.r2.toFixed(1)} M`;
    const plan = i.plan;
    const nodes = plan?.nodes ?? [];
    if (this.sel >= nodes.length) this.sel = Math.max(0, nodes.length - 1);
    const sig = plan ? nodes.map((n) => `${n.t.toFixed(1)}:${n.dv.map((x) => x.toFixed(4)).join()}:${n.then}`).join("|") + `:${this.sel}` : "none";
    if (sig !== this.planSig) {
      this.planSig = sig;
      E.nodes!.innerHTML = "";
      nodes.forEach((n, k) => {
        const row = h("div", `fl-node${k === this.sel ? " sel" : ""}`);
        row.onclick = () => {
          this.sel = k;
          this.planSig = "";
        };
        const dv = Math.hypot(...n.dv);
        const parts = ["PRO", "NRM", "RAD"]
          .map((l, j) => (Math.abs(n.dv[j]!) > 5e-5 ? `${l} ${n.dv[j]! >= 0 ? "+" : "−"}${Math.abs(n.dv[j]!).toFixed(3)}` : ""))
          .filter(Boolean)
          .join(" · ");
        const then = n.then === "circularize" ? " → circularize" : n.then === "approach" ? " → keep station" : n.then === "orbit" ? ` → orbit ${there}` : "";
        row.innerHTML = `<b>◆ ${k + 1}</b><span class="t"></span><span class="dv">Δv ${dv.toFixed(3)} c</span><span class="parts">${parts || "no Δv yet"}${then}</span>`;
        const del = h("button", "fl-x", "×") as HTMLButtonElement;
        del.title = "Delete this node";
        del.onclick = (e) => {
          e.stopPropagation();
          this.act.deleteNode(k);
        };
        row.append(del);
        E.nodes!.append(row);
      });
    }
    // countdowns (every refresh)
    E.nodes!.querySelectorAll<HTMLElement>(".fl-node .t").forEach((el, k) => {
      const n = nodes[k];
      if (n) el.textContent = n.t - time >= 0 ? `T−${fmtShort(Math.round(n.t - time))}` : i.auto === "node" ? "now" : "missed";
    });
    E.edit!.hidden = !nodes.length;
    (E.exec as HTMLButtonElement).disabled = !nodes.length && i.auto !== "node";
    E.exec!.classList.toggle("on", i.auto === "node");
    E.exec!.textContent = i.auto === "node" ? (plan?.burning ? "BURNING · STOP ■" : "EXECUTING · STOP ■") : "EXECUTE ▶";
    // what the plan leads to
    let res = plan ? plan.note : "No plan yet: pick a goal and PLAN, or add a node and shape it";
    if (plan?.path && plan.path.pts.length) {
      const last = nodes[nodes.length - 1];
      const pp = plan.path;
      const after = last ? pp.pts.filter((_, j) => pp.times[j]! > last.t) : pp.pts;
      const ra = (after.length ? after : pp.pts).map((q) => Math.hypot(...q));
      const total = nodes.reduce((a, n) => a + Math.hypot(...n.dv), 0);
      const fate = last?.then === "approach" ? "station-keeping at the target" : last?.then === "orbit" ? `in orbit around ${there}` : pp.fate === "wormhole" ? "through the wormhole" : pp.fate === "horizon" ? "into the horizon" : pp.fate === "star" ? `hits ${there}` : pp.fate === "escape" ? "escapes" : `Pe ${Math.min(...ra).toFixed(1)} · Ap ${Math.max(...ra).toFixed(1)} M`;
      res += `${res ? " · " : ""}Δv ${total.toFixed(3)} c · then ${fate}`;
    }
    E.result!.textContent = res;
  }

  /** 0 full · 1 minimal · 2 clean (not remembered: for an automation) */
  setDensity(d: number) {
    this.density = Math.min(2, Math.max(0, Math.round(d)));
    this.applyDensity();
  }

  cycleDensity() {
    this.density = (this.density + 1) % 3;
    try {
      localStorage.setItem("kerr.hud-density", String(this.density));
    } catch {
      /* private mode */
    }
    this.applyDensity();
    return ["Full HUD", "Minimal HUD", "Clean view"][this.density]!;
  }

  private applyDensity() {
    this.root.dataset.density = String(this.density);
  }

  /** Called every frame while piloting. */
  update(info: Info, time: number) {
    if (!this.start) this.start = { t: time, tau: info.properTime };
    this.record(info, time);
    this.drawHud(info);
    if (this.density < 2) this.drawBall(info);
    if (this.density === 0) {
      this.drawMap(info, time);
      this.drawTelemetry();
      this.drawPotential(info);
    }
    const now = performance.now();
    if (now - this.textAt > 100) {
      this.textAt = now;
      this.drawText(info, time);
    }
  }

  private onBall(e: PointerEvent, down: boolean) {
    const r = this.ball.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (down) {
      this.throttleDrag = x < 0.3;
      if (this.throttleDrag) this.ball.setPointerCapture(e.pointerId);
    }
    if (!this.throttleDrag) return;
    this.act.throttle(Math.min(1, Math.max(0, (0.93 - y) / 0.86)));
  }

  /** The ship's trail (black hole's frame, with times) and the telemetry (wall clock). */
  private record(i: Info, t: number) {
    const w = performance.now() / 1000;
    const lastS = this.samples[this.samples.length - 1];
    if (!lastS || w - lastS.w >= 0.1) {
      const gUnit = 2.99792458e8 ** 2 / (1476.625 * this.s.massSolar) / 9.80665;
      this.samples.push({ w, speed: i.speed, r: i.region === "hole" ? i.r : NaN, dtau: i.dtau, g: i.accel * gUnit });
      while (this.samples.length && w - this.samples[0]!.w > 60) this.samples.shift();
    }
    if (!i.X) return;
    const last = this.trail[this.trail.length - 1];
    if (last && (t < last.t || Math.hypot(i.X[0] - last.X[0], i.X[1] - last.X[1], i.X[2] - last.X[2]) > 30)) this.trail = [];
    const step = Math.max(0.2, (2 * Math.PI * i.r ** 1.5) / 400);
    const prev = this.trail[this.trail.length - 1];
    if (!prev || t - prev.t >= step) this.trail.push({ X: [...i.X] as V3, t });
    if (this.trail.length > 500) this.trail.shift();
  }

  // ------------------------------------------------------------------------------------ text panels
  private drawText(i: Info, time: number) {
    const s = this.s;
    const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");
    if (this.plannerOpen) this.drawPlanner(i, time);
    // mission bar
    const M = this.missionEls;
    const setChip = (k: string, on: boolean, text: string) => {
      M[k]!.classList.toggle("on", on);
      (M[k]!.lastChild as HTMLElement).textContent = text;
    };
    setChip("sas", i.sas, "SAS");
    setChip("hold", i.hold !== "none", i.hold === "none" ? "HOLD" : HOLD_NAMES[i.hold].toUpperCase());
    let auto = "AUTO";
    if (i.auto === "node" && i.plan?.nodes.length) {
      const n = i.plan.nodes[0]!;
      auto = i.plan.burning
        ? `NODE ${1} · BURN Δv ${Math.max(0, Math.hypot(...n.dv) - i.plan.done).toFixed(3)}`
        : `NODE 1 · T−${fmtShort(Math.max(0, Math.round(n.t - time)))}`;
    } else if (i.auto !== "none") {
      const phase = i.dirs.burn ? (i.throttle > 0.02 ? "BURN" : "ALIGN") : "RCS";
      auto = `${AUTO_NAMES[i.auto].toUpperCase()} · ${phase}${Number.isFinite(i.dv) ? ` Δv ${i.dv < 1e-3 ? "<.001" : i.dv.toFixed(3)}` : ""}`;
    }
    setChip("auto", i.auto !== "none", auto);
    const wv = s.timeSpeed >= 10 ? Math.round(s.timeSpeed) : +s.timeSpeed.toPrecision(2);
    // beyond 500 M/s the flight rides the rails; they hold the warp back near what needs following
    M.warp!.textContent = !s.animate ? "PAUSE" : i.railsNote ? `×${wv} ↓${i.railsNote}` : s.timeSpeed > 500 ? `×${wv} RAILS` : `×${wv}`;
    M.warp!.title = i.railsNote ? `Rails: the warp is held back by ${i.railsNote}` : "";
    const st = this.start ?? { t: time, tau: i.properTime };
    const dt = time - st.t, dtau = i.properTime - st.tau;
    M.tau!.textContent = fmtClock(dtau, s);
    M.t!.textContent = fmtClock(dt, s);
    M.ratio!.textContent = f(i.dtau, 4);
    M.lost!.textContent = fmtClock(dt - dtau, s);
    // target
    const T = this.targetEls;
    const hasTarget = Number.isFinite(i.targetDist) && i.target !== "hole";
    this.target.classList.toggle("empty", !hasTarget);
    T.name!.textContent = `${BODY_NAMES[i.target]}`;
    T.dist!.textContent = Number.isFinite(i.targetDist) ? fmtLen(i.targetDist, this.s) : "—";
    T.rate!.textContent = Number.isFinite(i.targetRate) ? `${i.targetRate >= 0 ? "▲ +" : "▼ −"}${Math.abs(i.targetRate).toFixed(3)} c` : "—";
    T.rate!.className = i.targetRate < 0 ? "closing" : "";
    const ca = this.closestApproach(i, time);
    T.ca!.textContent = ca ? `${fmtLen(ca.d, this.s)} · ${ca.t > 0 ? `T−${fmtShort(Math.round(ca.t))}` : "now"}` : "—";
    // orbit figures
    const O = this.orbitEls;
    const p = i.path;
    let peri = NaN, apo = NaN, tPe = NaN, tAp = NaN;
    if (p && p.pts.length > 2) {
      p.pts.forEach((q, j) => {
        const r = Math.hypot(...q);
        if (!(r >= peri)) (peri = r), (tPe = (j + 1) * p.dt);
        if (!(r <= apo)) (apo = r), (tAp = (j + 1) * p.dt);
      });
      if (i.r < peri) (peri = i.r), (tPe = 0);
      if (i.r > apo) (apo = i.r), (tAp = 0);
    }
    let course = "—", hot = false;
    if (p) {
      const t = p.pts.length * p.dt;
      if (p.fate === "horizon") (course = `HORIZON T−${fmtShort(Math.round(t))}`), (hot = true);
      else if (p.fate === "star") (course = `${p.hit && p.hit !== "star" ? BODY_NAMES[p.hit].toUpperCase() : "STAR"} T−${fmtShort(Math.round(t))}`), (hot = true);
      else if (p.fate === "wormhole") course = `WORMHOLE T−${fmtShort(Math.round(t))}`;
      else if (p.fate === "escape") course = i.E >= 1 ? "ESCAPE" : "LEAVING";
      else course = i.E < 1 ? "BOUND ORBIT" : "COASTING";
    }
    O.course!.textContent = course;
    O.course!.classList.toggle("hot", hot);
    O.pe!.textContent = Number.isFinite(peri) ? `${f(peri, 1)} M${tPe > 0 ? ` · T−${fmtShort(Math.round(tPe))}` : ""}` : "—";
    O.ap!.textContent = p?.fate === "escape" ? "∞" : Number.isFinite(apo) && p?.fate === "continues" ? `${f(apo, 1)} M${tAp > 0 ? ` · T−${fmtShort(Math.round(tAp))}` : ""}` : "—";
    O.el!.textContent = i.region === "hole" ? `${f(i.E, 4)} · ${f(i.L, 2)}` : "—";
    // warnings
    const w: string[] = [];
    if (p?.fate === "horizon") w.push(`⚠ COLLISION COURSE — HORIZON IN ${fmtM(p.pts.length * p.dt, s).toUpperCase()}`);
    // (not while an autopilot flies around that body: it keeps the ship off it)
    const hit = p?.hit ?? "star";
    const nm = (b: keyof typeof BODY_NAMES) => (b === "star" ? "THE STAR" : BODY_NAMES[b].toUpperCase());
    if (p?.fate === "star" && !((i.auto === "approach" || i.auto === "orbit") && i.target === hit)) w.push(`⚠ COLLISION COURSE — ${nm(hit)}`);
    if (i.landed) w.push(`LANDED ON ${nm(i.landedOn ?? "star")}`);
    if (i.ergo) w.push("ERGOSPHERE · NO STATIC OBSERVER · FRAME DRAGGING");
    else if (i.region === "hole" && i.r < i.photon) w.push("INSIDE THE PHOTON ORBIT");
    else if (i.region === "hole" && i.r < i.isco) w.push("BELOW THE ISCO · NO STABLE ORBIT");
    if (!s.animate) w.push("TIME PAUSED · SPACE TO FLY");
    this.warn.innerHTML = w.map((x) => `<div class="${x.startsWith("⚠") ? "hot" : ""}">${x}</div>`).join("");
    // buttons
    this.buttons.get("sas")!.classList.toggle("on", i.sas);
    this.buttons.get("roll")!.classList.toggle("on", i.rollAlign);
    for (const [hold] of HOLD_KEYS) this.buttons.get(hold)!.classList.toggle("on", i.hold === hold);
    for (const [a] of AUTO_KEYS) this.buttons.get(a)!.classList.toggle("on", i.auto === a);
    for (const m of MOUNT_KEYS) this.buttons.get(`mount:${m}`)!.classList.toggle("on", i.mount === m);
    this.buttons.get("ahead")!.classList.toggle("on", s.shipLookYaw !== 0 || s.shipLookPitch !== 0);
    const massive = s.sun && s.sunMass > 0;
    this.mapBtns.top!.classList.toggle("on", this.view === "top");
    this.mapBtns.side!.classList.toggle("on", this.view === "side");
    this.mapBtns.cm!.hidden = this.mapBtns.hole!.hidden = !massive;
    this.mapBtns.cm!.classList.toggle("on", this.frame === "cm");
    this.mapBtns.log!.classList.toggle("on", this.isLog());
    this.mapBtns.hole!.classList.toggle("on", this.frame === "hole");
  }

  /** Closest approach to the target along the predicted path (both moving; black hole's frame). */
  private closestApproach(i: Info, t0: number) {
    const p = i.path;
    if (!p || !i.X || i.target === "hole" || i.target === "barycentre") return null;
    const s = this.s;
    if (i.target === "star" && !s.sun) return null;
    if (i.target === "wormhole" && !s.wormhole) return null;
    const target = i.target;
    const at = (t: number): V3 => bodyCentre(s, target, t) as V3;
    let best = { d: Math.hypot(...sub(i.X, at(t0))), t: 0 };
    p.pts.forEach((q, j) => {
      const d = Math.hypot(...sub(q, at(t0 + (j + 1) * p.dt)));
      if (d < best.d) best = { d, t: (j + 1) * p.dt };
    });
    return best;
  }

  // ------------------------------------------------------------------------------------ full-screen HUD: tapes, markers
  private drawHud(i: Info) {
    const c = this.hud;
    const dpr = devicePixelRatio;
    const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
    if (c.width !== W || c.height !== H) (c.width = W), (c.height = H);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    const tanH = Math.tan((this.s.fov * Math.PI) / 360);
    const asp = W / H;
    const proj = (d: V3 | null) => {
      if (!d || d[2] <= 0.02) return null;
      const x = d[0] / (d[2] * tanH * asp), y = d[1] / (d[2] * tanH);
      if (Math.abs(x) > 1.05 || Math.abs(y) > 1.05) return null;
      return [((x + 1) / 2) * W, ((1 - y) / 2) * H] as const;
    };
    const r = 11 * dpr;
    ctx.lineWidth = 2 * dpr;
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = 4 * dpr;
    const nose = proj([i.S[0][2], i.S[1][2], i.S[2][2]]);
    if (nose) {
      ctx.strokeStyle = "rgba(255, 200, 90, 0.95)";
      ctx.beginPath();
      ctx.moveTo(nose[0] - 2.2 * r, nose[1]);
      ctx.lineTo(nose[0] - r, nose[1]);
      ctx.lineTo(nose[0] - 0.5 * r, nose[1] + 0.6 * r);
      ctx.lineTo(nose[0], nose[1]);
      ctx.lineTo(nose[0] + 0.5 * r, nose[1] + 0.6 * r);
      ctx.lineTo(nose[0] + r, nose[1]);
      ctx.lineTo(nose[0] + 2.2 * r, nose[1]);
      ctx.stroke();
    }
    for (const k of ["prograde", "retrograde", "burn", "tgtPrograde", "tgtRetrograde"] as const) {
      const p = proj(i.dirs[k]);
      if (p) marker(ctx, GLYPH[k]!, p[0], p[1], r, COL[k]!);
    }
    ctx.shadowBlur = 0;
    if (this.density < 2) {
      // each tape in the free band between the panels above and below it on its side
      const band = (above: HTMLElement[], below: HTMLElement[]) => {
        const shown = (e: HTMLElement) => e.offsetParent !== null && getComputedStyle(e).display !== "none";
        const top = Math.max(60, ...above.filter(shown).map((e) => e.getBoundingClientRect().bottom)) + 40;
        const bottom = Math.min(innerHeight - 210, ...below.filter(shown).map((e) => e.getBoundingClientRect().top)) - 34;
        if (bottom - top < 110) return null; // no room (a tall planner): no tape
        const hgt = Math.min(bottom - top, 330);
        return { cy: ((top + bottom) / 2) * dpr, h: hgt * dpr };
      };
      const L = band([this.target], [this.orbit]);
      if (L) this.speedTape(ctx, i, 30 * dpr, L.cy, L.h, dpr);
      const R = band([this.tel, this.planner], [this.right]);
      if (R && i.region === "hole") this.altTape(ctx, i, W - 30 * dpr, R.cy, R.h, dpr);
    }
  }

  /** Speed tape (left): a moving scale in c, the value box, the autopilot's target bug, the trend. */
  private speedTape(ctx: CanvasRenderingContext2D, i: Info, x0: number, cy: number, hgt: number, dpr: number) {
    const wdt = 58 * dpr;
    const span = 0.24; // c over the tape's height
    const k = hgt / span;
    const y = (v: number) => cy - (v - i.speed) * k;
    panelBg(ctx, x0, cy - hgt / 2, wdt, hgt, dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, cy - hgt / 2, wdt, hgt);
    ctx.clip();
    ctx.strokeStyle = "rgba(230, 236, 245, 0.55)";
    ctx.fillStyle = "rgba(230, 236, 245, 0.75)";
    ctx.lineWidth = 1 * dpr;
    ctx.font = `${10 * dpr}px ${MONO}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const v0 = Math.max(0, Math.floor((i.speed - span / 2) / 0.01) * 0.01);
    for (let v = v0; v <= Math.min(1, i.speed + span / 2); v += 0.01) {
      const yy = y(v);
      const major = Math.round(v * 100) % 5 === 0;
      ctx.beginPath();
      ctx.moveTo(x0 + wdt, yy);
      ctx.lineTo(x0 + wdt - (major ? 12 : 6) * dpr, yy);
      ctx.stroke();
      if (major) ctx.fillText(v.toFixed(2), x0 + wdt - 15 * dpr, yy);
    }
    // the light barrier and the autopilot's target speed
    if (i.speed + span / 2 > 0.95) {
      ctx.fillStyle = "rgba(255, 90, 70, 0.25)";
      ctx.fillRect(x0, y(1), wdt, y(0.95) - y(1));
    }
    if (Number.isFinite(i.wantSpeed)) {
      const yy = y(i.wantSpeed);
      ctx.fillStyle = CYAN;
      ctx.beginPath();
      ctx.moveTo(x0 + wdt, yy);
      ctx.lineTo(x0 + wdt - 8 * dpr, yy - 5 * dpr);
      ctx.lineTo(x0 + wdt - 8 * dpr, yy + 5 * dpr);
      ctx.fill();
    }
    ctx.restore();
    // trend over the last second (where the speed will be in 1 s)
    const s1 = this.samples.find((q) => q.w >= this.samples[this.samples.length - 1]!.w - 1);
    if (s1) {
      const trend = i.speed - s1.speed;
      if (Math.abs(trend * k) > 2 * dpr) {
        ctx.strokeStyle = "#d6f55b";
        ctx.lineWidth = 3 * dpr;
        ctx.beginPath();
        ctx.moveTo(x0 + wdt + 3 * dpr, cy);
        ctx.lineTo(x0 + wdt + 3 * dpr, cy - Math.max(-hgt / 2, Math.min(hgt / 2, trend * k)));
        ctx.stroke();
      }
    }
    valueBox(ctx, x0 + wdt + 8 * dpr, cy, `${i.speed.toFixed(4)}`, "c", `γ ${i.gamma.toFixed(3)}`, "left", dpr);
    label(ctx, x0, cy - hgt / 2 - 8 * dpr, "SPEED", "rel. ZAMO", dpr);
  }

  /** Altitude tape (right): r on a log scale with the orbit's landmarks and a vertical-speed bar. */
  private altTape(ctx: CanvasRenderingContext2D, i: Info, x1: number, cy: number, hgt: number, dpr: number) {
    const wdt = 58 * dpr;
    const x0 = x1 - wdt;
    const perDecade = hgt * 0.75;
    const L = Math.log10(i.r);
    const y = (r: number) => cy - (Math.log10(r) - L) * perDecade;
    panelBg(ctx, x0, cy - hgt / 2, wdt, hgt, dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, cy - hgt / 2, wdt, hgt);
    ctx.clip();
    // the horizon: everything below is black
    const yH = y(i.rH);
    if (yH < cy + hgt / 2) {
      ctx.fillStyle = "rgba(255, 60, 40, 0.28)";
      ctx.fillRect(x0, yH, wdt, cy + hgt / 2 - yH);
    }
    ctx.strokeStyle = "rgba(230, 236, 245, 0.55)";
    ctx.fillStyle = "rgba(230, 236, 245, 0.75)";
    ctx.lineWidth = 1 * dpr;
    ctx.font = `${10 * dpr}px ${MONO}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const lo = L - hgt / 2 / perDecade, hi = L + hgt / 2 / perDecade;
    for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) {
      for (const m of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const rr = m * 10 ** e;
        const yy = y(rr);
        if (yy < cy - hgt / 2 - 5 || yy > cy + hgt / 2 + 5) continue;
        const major = m === 1 || m === 2 || m === 5;
        ctx.beginPath();
        ctx.moveTo(x0, yy);
        ctx.lineTo(x0 + (major ? 12 : 6) * dpr, yy);
        ctx.stroke();
        if (major) ctx.fillText(`${rr}`, x0 + 15 * dpr, yy);
      }
    }
    // landmarks
    const mark = (rr: number, col: string, txt: string) => {
      const yy = y(rr);
      if (!Number.isFinite(yy) || yy < cy - hgt / 2 || yy > cy + hgt / 2) return;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(x0 + wdt - 16 * dpr, yy);
      ctx.lineTo(x0 + wdt, yy);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.textAlign = "right";
      ctx.font = `600 ${8.5 * dpr}px ${FONT}`;
      ctx.fillText(txt, x0 + wdt - 18 * dpr, yy - 6 * dpr);
      ctx.textAlign = "left";
      ctx.font = `${10 * dpr}px ${MONO}`;
    };
    mark(i.rH, RED, "HORIZON");
    mark(i.photon, "#ffdc78", "PHOTON");
    mark(i.isco, "#78e696", "ISCO");
    if (this.s.sun) mark(starOrbitRadius(this.s), "#ffd36b", "STAR");
    const p = i.path;
    if (p && p.pts.length > 2) {
      const rs = p.pts.map((q) => Math.hypot(...q));
      mark(Math.min(...rs, i.r), CYAN, "Pe");
      if (p.fate === "continues") mark(Math.max(...rs, i.r), CYAN, "Ap");
    }
    ctx.restore();
    // vertical speed (radial 3-velocity), ±0.1 c over half the tape
    if (Number.isFinite(i.vr)) {
      const vy = Math.max(-1, Math.min(1, i.vr / 0.1)) * (hgt / 2);
      ctx.fillStyle = i.vr < 0 ? "rgba(255, 150, 90, 0.9)" : "rgba(124, 214, 255, 0.9)";
      ctx.fillRect(x0 - 7 * dpr, Math.min(cy, cy - vy), 3 * dpr, Math.abs(vy));
      ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
      ctx.fillRect(x0 - 7 * dpr, cy - hgt / 2, 3 * dpr, 1 * dpr);
      ctx.fillRect(x0 - 7 * dpr, cy + hgt / 2, 3 * dpr, 1 * dpr);
    }
    valueBox(ctx, x0 - 12 * dpr, cy, `${i.r.toFixed(2)}`, "M", `v_r ${i.vr >= 0 ? "+" : "−"}${Math.abs(i.vr).toFixed(3)} c`, "right", dpr);
    label(ctx, x0, cy - hgt / 2 - 8 * dpr, "ALTITUDE", "r · log", dpr);
  }

  // ------------------------------------------------------------------------------------ telemetry sparklines
  private drawTelemetry() {
    const c = this.telCanvas;
    const dpr = devicePixelRatio;
    const cw = Math.round((c.clientWidth || 250) * dpr), ch = Math.round((c.clientHeight || 150) * dpr);
    if (c.width !== cw || c.height !== ch) (c.width = cw), (c.height = ch);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, cw, ch);
    const S = this.samples;
    if (S.length < 2) return;
    const w1 = S[S.length - 1]!.w;
    const rows: [keyof Sample, string, string, (v: number) => string][] = [
      ["speed", "SPEED", "#d6f55b", (v) => `${v.toFixed(3)} c`],
      ["r", "ALT", CYAN, (v) => `${v.toFixed(1)} M`],
      ["dtau", "dτ/dt", "#e07bff", (v) => v.toFixed(4)],
      ["g", "THRUST", AMBER, (v) => fmtG(v)],
    ];
    const rh = ch / rows.length;
    rows.forEach(([key, name, col, fmt], j) => {
      const y0 = j * rh;
      const vals = S.map((q) => q[key] as number).filter(Number.isFinite);
      if (!vals.length) return;
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (hi - lo < 1e-9) (lo -= 0.5 * Math.abs(lo) * 0.01 + 1e-6), (hi += 0.5 * Math.abs(hi) * 0.01 + 1e-6);
      const pad = (hi - lo) * 0.15;
      lo -= pad;
      hi += pad;
      const X = (w: number) => 56 * dpr + ((w - (w1 - 60)) / 60) * (cw - 62 * dpr);
      const Y = (v: number) => y0 + rh - 5 * dpr - ((v - lo) / (hi - lo)) * (rh - 12 * dpr);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(56 * dpr, y0 + rh - 1 * dpr);
      ctx.lineTo(cw, y0 + rh - 1 * dpr);
      ctx.stroke();
      // area + line
      const g = ctx.createLinearGradient(0, y0, 0, y0 + rh);
      g.addColorStop(0, hexA(col, 0.28));
      g.addColorStop(1, hexA(col, 0));
      ctx.beginPath();
      let started = false;
      for (const q of S) {
        const v = q[key] as number;
        if (!Number.isFinite(v)) continue;
        if (!started) ctx.moveTo(X(q.w), Y(v)), (started = true);
        else ctx.lineTo(X(q.w), Y(v));
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
      ctx.lineTo(X(w1), y0 + rh - 1 * dpr);
      ctx.lineTo(X(S[0]!.w), y0 + rh - 1 * dpr);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.fillStyle = "rgba(200, 208, 222, 0.6)";
      ctx.font = `600 ${8.5 * dpr}px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(name, 2 * dpr, y0 + 4 * dpr);
      ctx.fillStyle = "#fff";
      ctx.font = `500 ${10 * dpr}px ${MONO}`;
      ctx.fillText(fmt(vals[vals.length - 1]!), 2 * dpr, y0 + 16 * dpr);
    });
  }

  // ------------------------------------------------------------------------------------ effective potential
  /**
   * Kerr geodesic, radial equation: (Σ dr/dτ)² = R(r) = [E(r² + a²) − aL]² − Δ[r² + (L − aE)² + Q].
   * V(r): the energy at which r is a turning point (R = 0, future branch) for the ship's L and Q;
   * the ship moves where E ≥ V(r).
   */
  private drawPotential(i: Info) {
    const c = this.veff;
    const dpr = devicePixelRatio;
    const cw = Math.round((c.clientWidth || 290) * dpr), ch = Math.round((c.clientHeight || 120) * dpr);
    if (c.width !== cw || c.height !== ch) (c.width = cw), (c.height = ch);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, cw, ch);
    if (i.region !== "hole" || !Number.isFinite(i.E)) return;
    const a = i.spin, L = i.L, Q = i.Q, E = i.E;
    const V = (r: number) => {
      const r2 = r * r, a2 = a * a;
      const del = r2 - 2 * r + a2;
      const A = (r2 + a2) ** 2 - del * a2;
      const B = -4 * a * L * r;
      const C = a2 * L * L - del * (r2 + Q + L * L);
      const disc = B * B - 4 * A * C;
      return disc < 0 ? NaN : (-B + Math.sqrt(disc)) / (2 * A);
    };
    const r0 = i.rH * 1.02;
    const rMax = Math.max(i.r * 2.5, 40);
    const lx0 = Math.log(r0), lx1 = Math.log(rMax);
    const X = (r: number) => 30 * dpr + ((Math.log(r) - lx0) / (lx1 - lx0)) * (cw - 36 * dpr);
    const n = 160;
    const pts: [number, number][] = [];
    for (let j = 0; j <= n; j++) {
      const r = Math.exp(lx0 + ((lx1 - lx0) * j) / n);
      pts.push([r, V(r)]);
    }
    // the well: from the potential's minimum (outside the photon orbit) to the escape line and E
    const outer = pts.filter(([r, v]) => r > i.photon * 1.05 && Number.isFinite(v)).map((p) => p[1]);
    const vmin = outer.length ? Math.min(...outer) : E - 0.05;
    let lo = Math.min(vmin, E), hi = Math.max(E, 1);
    const span = Math.min(Math.max(hi - lo, 0.02), 0.35);
    lo -= span * 0.25;
    hi = lo + span * 1.5;
    const Y = (v: number) => ch - 16 * dpr - ((v - lo) / (hi - lo)) * (ch - 24 * dpr);
    const yc = (v: number) => Y(Math.min(Math.max(v, lo - span), hi + span));
    // the allowed region (V ≤ E): between the curve and the energy line, where the ship can move
    const g = ctx.createLinearGradient(0, Y(E), 0, Y(lo));
    g.addColorStop(0, "rgba(124, 214, 255, 0.28)");
    g.addColorStop(1, "rgba(124, 214, 255, 0.02)");
    ctx.fillStyle = g;
    let open = false;
    ctx.beginPath();
    for (const [r, v] of pts) {
      const xx = X(r);
      if (Number.isFinite(v) && v < E) {
        if (!open) ctx.moveTo(xx, Y(E)), (open = true);
        ctx.lineTo(xx, yc(v));
      } else if (open) {
        ctx.lineTo(xx, Y(E));
        ctx.closePath();
        open = false;
      }
    }
    if (open) ctx.lineTo(X(rMax), Y(E)), ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(230, 236, 245, 0.85)";
    ctx.lineWidth = 1.4 * dpr;
    ctx.beginPath();
    let pen = false;
    for (const [r, v] of pts) {
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      const yy = yc(v);
      if (!pen) ctx.moveTo(X(r), yy), (pen = true);
      else ctx.lineTo(X(r), yy);
    }
    ctx.stroke();
    if (1 > lo && 1 < hi) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(X(r0), Y(1));
      ctx.lineTo(X(rMax), Y(1));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
      ctx.font = `${8.5 * dpr}px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText("E = 1 · escape", cw - 4 * dpr, Y(1) - 8 * dpr);
    }
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath();
    ctx.moveTo(X(r0), Y(E));
    ctx.lineTo(X(rMax), Y(E));
    ctx.stroke();
    // landmarks on the axis, the ship
    ctx.font = `600 ${8 * dpr}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const [rr, txt, col] of [[i.photon, "γ", "#ffdc78"], [i.isco, "ISCO", "#78e696"]] as const) {
      ctx.fillStyle = col;
      ctx.fillRect(X(rr) - 0.5 * dpr, ch - 16 * dpr, 1 * dpr, 4 * dpr);
      ctx.fillText(txt, X(rr), ch - 11 * dpr);
    }
    ctx.fillStyle = "rgba(200, 208, 222, 0.6)";
    ctx.textAlign = "left";
    ctx.fillText("r (log)", 2 * dpr, ch - 11 * dpr);
    ctx.fillText("V", 2 * dpr, 2 * dpr);
    const sx = X(i.r), sy = Y(E);
    ctx.fillStyle = "#ffc85a";
    ctx.beginPath();
    ctx.arc(sx, sy, 4 * dpr, 0, 2 * Math.PI);
    ctx.fill();
    // which way it moves along r
    if (Number.isFinite(i.vr) && Math.abs(i.vr) > 1e-4) {
      ctx.strokeStyle = "#ffc85a";
      ctx.lineWidth = 1.6 * dpr;
      const d = Math.sign(i.vr) * 12 * dpr;
      ctx.beginPath();
      ctx.moveTo(sx + Math.sign(d) * 6 * dpr, sy);
      ctx.lineTo(sx + d + Math.sign(d) * 6 * dpr, sy);
      ctx.lineTo(sx + d + Math.sign(d) * 2 * dpr, sy - 3 * dpr);
      ctx.moveTo(sx + d + Math.sign(d) * 6 * dpr, sy);
      ctx.lineTo(sx + d + Math.sign(d) * 2 * dpr, sy + 3 * dpr);
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------------------------------ attitude ball + arcs
  private drawBall(i: Info) {
    const c = this.ball;
    // (per-pixel sky/ground in JS: capped at 1.5× CSS resolution, redrawn every other frame)
    const dpr = Math.min(devicePixelRatio, 1.5);
    const size = Math.round(176 * dpr);
    if (c.width !== size) (c.width = size), (c.height = size);
    if ((this.ballFrame = (this.ballFrame + 1) % 2) === 1) return;
    const ctx = c.getContext("2d")!;
    const C0 = size / 2;
    const R0 = size / 2 - 16 * dpr;
    const S = i.S;
    const body = (d: V3): V3 => [
      S[0][0] * d[0] + S[1][0] * d[1] + S[2][0] * d[2],
      S[0][1] * d[0] + S[1][1] * d[1] + S[2][1] * d[2],
      S[0][2] * d[0] + S[1][2] * d[1] + S[2][2] * d[2],
    ];
    if (!this.ballImg || this.ballImg.width !== size) this.ballImg = ctx.createImageData(size, size);
    const img = this.ballImg;
    const up = i.dirs.radialOut ? body(i.dirs.radialOut) : null;
    const px = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5 - C0) / R0, v = (C0 - y - 0.5) / R0;
        const q = u * u + v * v;
        const o = (y * size + x) * 4;
        if (q > 1) {
          px[o + 3] = 0;
          continue;
        }
        const d: V3 = [-u, v, Math.sqrt(1 - q)];
        let col: [number, number, number] = [28, 34, 44];
        if (up) {
          const e = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
          col = e > 0 ? [34, 88, 150] : [92, 60, 34];
          const lat = Math.asin(Math.max(-1, Math.min(1, e))) / (Math.PI / 6);
          if (Math.abs(lat - Math.round(lat)) < 0.035 / Math.max(Math.sqrt(1 - q), 0.2)) col = Math.round(lat) === 0 ? [255, 255, 255] : [200, 206, 218];
        }
        const shade = 0.45 + 0.55 * Math.sqrt(1 - q);
        px[o] = col[0] * shade;
        px[o + 1] = col[1] * shade;
        px[o + 2] = col[2] * shade;
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const Ra = R0 + 9 * dpr;
    const arcGauge = (a0: number, a1: number, t: number, c0: string, c1: string, ccw: boolean) => {
      ctx.lineCap = "butt";
      ctx.lineWidth = 6 * dpr;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.beginPath();
      ctx.arc(C0, C0, Ra, Math.min(a0, a1), Math.max(a0, a1));
      ctx.stroke();
      // ticks every 10 %
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      for (let j = 0; j <= 10; j++) {
        const a = a0 + ((a1 - a0) * j) / 10;
        const r1 = Ra + (j % 5 === 0 ? 6 : 4) * dpr;
        ctx.beginPath();
        ctx.moveTo(C0 + Math.cos(a) * (Ra + 3 * dpr), C0 + Math.sin(a) * (Ra + 3 * dpr));
        ctx.lineTo(C0 + Math.cos(a) * r1, C0 + Math.sin(a) * r1);
        ctx.stroke();
      }
      if (t > 0.001) {
        const g = ctx.createLinearGradient(0, size, 0, 0);
        g.addColorStop(0, c0);
        g.addColorStop(1, c1);
        ctx.strokeStyle = g;
        ctx.lineWidth = 6 * dpr;
        ctx.beginPath();
        ctx.arc(C0, C0, Ra, a0, a0 + (a1 - a0) * t, ccw);
        ctx.stroke();
      }
    };
    // left: throttle (bottom → top), right: g-load relative to the engine's full thrust
    const t = Math.max(0, Math.min(1, i.throttle));
    arcGauge(Math.PI * 0.64, Math.PI * 1.36, t, "#ff6a2c", "#ffd27a", false);
    const gl = Math.max(0, Math.min(1, i.accel / Math.max(this.s.thrust, 1e-12)));
    arcGauge(Math.PI * 0.36, -Math.PI * 0.36, gl, "#3b8cff", "#9fe3ff", true);
    ctx.font = `600 ${9.5 * dpr}px ${FONT}`;
    ctx.textBaseline = "top";
    ctx.fillStyle = "#ffd27a";
    ctx.textAlign = "left";
    ctx.fillText(`THR ${Math.round(t * 100)}%`, 0, 0);
    ctx.fillStyle = "#9fe3ff";
    ctx.textAlign = "right";
    const gUnit = 2.99792458e8 ** 2 / (1476.625 * this.s.massSolar) / 9.80665;
    ctx.fillText(i.accel > 0 ? fmtG(i.accel * gUnit) : "0 g", size, 0);
    // rotation rates: short bars (pitch right side, yaw bottom)
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = "rgba(255, 200, 90, 0.9)";
    const w = i.omega;
    const bar = (mid: number, v: number) => {
      const k = Math.max(-1, Math.min(1, v / 0.75)) * 0.4;
      if (Math.abs(k) < 0.01) return;
      ctx.beginPath();
      ctx.arc(C0, C0, R0 - 3 * dpr, Math.min(mid, mid + k), Math.max(mid, mid + k));
      ctx.stroke();
    };
    bar(0, w[0]);
    bar(Math.PI / 2, -w[1]);
    // orbital markers
    const r = 8 * dpr;
    ctx.lineWidth = 1.8 * dpr;
    for (const k of ["prograde", "retrograde", "radialOut", "radialIn", "normal", "antinormal", "target", "burn", "tgtPrograde"] as const) {
      const dd = i.dirs[k];
      if (!dd) continue;
      const b = body(dd);
      let x = -b[0], y = b[1];
      let alpha = 1;
      if (b[2] < 0) {
        const l = Math.hypot(x, y) || 1;
        (x /= l), (y /= l), (alpha = 0.4);
      }
      ctx.globalAlpha = alpha;
      marker(ctx, GLYPH[k]!, C0 + x * (R0 - r), C0 - y * (R0 - r), r, COL[k]!);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ffc85a";
    ctx.lineWidth = 2.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(C0 - 18 * dpr, C0);
    ctx.lineTo(C0 - 7 * dpr, C0);
    ctx.lineTo(C0, C0 + 6 * dpr);
    ctx.lineTo(C0 + 7 * dpr, C0);
    ctx.lineTo(C0 + 18 * dpr, C0);
    ctx.stroke();
  }

  // ------------------------------------------------------------------------------------ map
  private isLog() {
    return this.logMap ?? this.s.system !== "none";
  }

  private drawMap(i: Info, t0: number) {
    const c = this.map;
    const dpr = devicePixelRatio;
    const cw = Math.round((c.clientWidth || 260) * dpr);
    const ch = Math.round((c.clientHeight || 260) * dpr);
    if (c.width !== cw || c.height !== ch) (c.width = cw), (c.height = ch);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, cw, ch);
    const s = this.s;
    ctx.font = `${10 * dpr}px ${FONT}`;
    if (i.region !== "hole" || !i.X) {
      ctx.fillStyle = "rgba(220, 225, 235, 0.8)";
      ctx.textAlign = "center";
      ctx.fillText(`In the wormhole · ℓ = ${i.ell.toFixed(2)} M`, cw / 2, ch / 2);
      return;
    }
    const X0 = i.X;
    const massive = s.sun && s.sunMass > 0;
    const cm = massive && this.frame === "cm";
    const B = (t: number): V3 => (cm ? barycentre(s, t) : [0, 0, 0]);
    const at = (X: V3, t: number): V3 => sub(X, B(t));
    const side = this.view === "side";
    const log = this.isLog();
    // (multi-scale: the distance from the map's origin — the hole or the centre of mass — as
    // ln(1 + r/M), the direction kept)
    const lg = (r: number) => (log ? Math.log1p(r) : r);
    const pr = (X: V3): [number, number] => {
      const q: [number, number] = side ? [X[0], X[2]] : [X[0], X[1]];
      if (!log) return q;
      const R = Math.hypot(q[0], q[1]);
      return R < 1e-12 ? q : [(q[0] * Math.log1p(R)) / R, (q[1] * Math.log1p(R)) / R];
    };
    const path = i.path;
    const T = path ? Math.max(path.pts.length * path.dt, 50) : 200;
    const pts: [number, number][] = [pr(at(X0, t0)), pr(at([0, 0, 0], t0))];
    if (path) path.pts.forEach((q, j) => pts.push(pr(at(q, t0 + (j + 1) * path.dt))));
    for (const q of this.trail) pts.push(pr(at(q.X, q.t)));
    const pp = i.plan?.path;
    if (pp) pp.pts.forEach((q, j) => pts.push(pr(at(q, pp.times[j]!))));
    if (i.target === "star" && s.sun) {
      pts.push(pr(at(starCentre(s, t0), t0)));
      const ca = this.closestApproach(i, t0);
      if (ca) pts.push(pr(at(starCentre(s, t0 + ca.t), t0 + ca.t)));
    } else if (i.target === "wormhole" && s.wormhole) pts.push(pr(at(mouth(s).C as V3, t0)));
    const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (const p of pts) for (let k = 0; k < 2; k++) (lo[k] = Math.min(lo[k]!, p[k]!)), (hi[k] = Math.max(hi[k]!, p[k]!));
    const hc = pr(at([0, 0, 0], t0));
    const rDisk = s.disk ? s.diskOuter : 6;
    (lo[0] = Math.min(lo[0]!, hc[0] - rDisk)), (hi[0] = Math.max(hi[0]!, hc[0] + rDisk));
    (lo[1] = Math.min(lo[1]!, hc[1] - (side ? 2 : rDisk))), (hi[1] = Math.max(hi[1]!, hc[1] + (side ? 2 : rDisk)));
    const want = (log
      ? Math.max(...pts.map((p) => Math.hypot(p[0], p[1])), lg(12))
      : Math.max((hi[0]! - lo[0]!) / 2, ((hi[1]! - lo[1]!) / 2) * (cw / ch), 6)) * 1.12 * this.zoom;
    const cen: [number, number] = log ? [0, 0] : [(hi[0]! + lo[0]!) / 2, (hi[1]! + lo[1]!) / 2];
    this.extent += (want - this.extent) * 0.1;
    this.centre[0] += (cen[0] - this.centre[0]) * 0.1;
    this.centre[1] += (cen[1] - this.centre[1]) * 0.1;
    const k = (cw / 2 - 8 * dpr) / this.extent;
    const P = (X: V3): [number, number] => {
      const q = pr(X);
      return [cw / 2 + (q[0] - this.centre[0]) * k, ch / 2 - (q[1] - this.centre[1]) * k];
    };
    // radar grid: rings around the centre of the view
    ctx.strokeStyle = "rgba(124, 214, 255, 0.07)";
    ctx.lineWidth = 1 * dpr;
    const gridStep = niceStep(this.extent / 2);
    for (let j = 1; j <= 4; j++) {
      ctx.beginPath();
      ctx.arc(cw / 2, ch / 2, j * gridStep * k, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, ch / 2);
    ctx.lineTo(cw, ch / 2);
    ctx.moveTo(cw / 2, 0);
    ctx.lineTo(cw / 2, ch);
    ctx.stroke();
    const poly = (list: V3[], stroke: string, width: number, dash: number[] = []) => {
      if (list.length < 2) return;
      ctx.beginPath();
      list.forEach((X, j) => (j ? ctx.lineTo(...P(X)) : ctx.moveTo(...P(X))));
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width * dpr;
      ctx.setLineDash(dash.map((d) => d * dpr));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const hole = at([0, 0, 0], t0);
    const ring = (r: number, stroke: string, dash: number[] = []) => {
      ctx.beginPath();
      const [x, y] = P(hole);
      if (side) {
        ctx.moveTo(x - lg(r) * k, y);
        ctx.lineTo(x + lg(r) * k, y);
      } else ctx.arc(x, y, Math.max(lg(r) * k, 0.6), 0, 2 * Math.PI);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.2 * dpr;
      ctx.setLineDash(dash.map((d) => d * dpr));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (s.disk) {
      const [x, y] = P(hole);
      ctx.fillStyle = "rgba(255, 150, 60, 0.14)";
      if (side) ctx.fillRect(x - lg(s.diskOuter) * k, y - 1.5 * dpr, 2 * lg(s.diskOuter) * k, 3 * dpr);
      else {
        ctx.beginPath();
        ctx.arc(x, y, lg(s.diskOuter) * k, 0, 2 * Math.PI);
        ctx.arc(x, y, lg(isco(s.spin)) * k, 0, 2 * Math.PI, true);
        ctx.fill();
      }
    }
    ring(i.isco, "rgba(120, 230, 150, 0.6)", [4, 3]);
    ring(i.photon, "rgba(255, 220, 120, 0.5)", [1.5, 2.5]);
    if (!side) ring(2, "rgba(150, 170, 255, 0.4)", [3, 3]);
    {
      const [x, y] = P(hole);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(lg(i.rH) * k, 2.5 * dpr), 0, 2 * Math.PI);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = 1.2 * dpr;
      ctx.stroke();
    }
    const span = (fn: (t: number) => V3, a: number, b: number, n = 120) =>
      Array.from({ length: n + 1 }, (_, j) => {
        const t = a + ((b - a) * j) / n;
        return at(fn(t), t);
      });
    const tick = niceStep(T / 6);
    const tickTimes = Array.from({ length: Math.floor(T / tick) }, (_, j) => t0 + (j + 1) * tick);
    if (cm) {
      poly(span(() => [0, 0, 0], t0 - T * 0.5, t0), "rgba(255, 255, 255, 0.25)", 1.2);
      poly(span(() => [0, 0, 0], t0, t0 + T), "rgba(255, 255, 255, 0.55)", 1.2, [3, 3]);
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      for (const tt of tickTimes) {
        const [x, y] = P(at([0, 0, 0], tt));
        ctx.fillRect(x - 1.5 * dpr, y - 1.5 * dpr, 3 * dpr, 3 * dpr);
      }
      const [bx, by] = P([0, 0, 0]);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.arc(bx, by, 3.5 * dpr, 0, 2 * Math.PI);
      ctx.moveTo(bx - 6 * dpr, by);
      ctx.lineTo(bx + 6 * dpr, by);
      ctx.moveTo(bx, by - 6 * dpr);
      ctx.lineTo(bx, by + 6 * dpr);
      ctx.stroke();
    }
    if (s.sun) {
      const period = (2 * Math.PI) / Math.max(starOmega(s), 1e-9);
      poly(span((t) => starCentre(s, t), t0, t0 + period, 180), "rgba(255, 220, 140, 0.14)", 1);
      poly(span((t) => starCentre(s, t), t0 - Math.min(T * 0.5, period * 0.3), t0), "rgba(255, 211, 107, 0.35)", 1.5);
      poly(span((t) => starCentre(s, t), t0, t0 + Math.min(T, period)), "rgba(255, 211, 107, 0.85)", 1.5, [4, 3]);
      ctx.fillStyle = "rgba(255, 211, 107, 0.95)";
      for (const tt of tickTimes) {
        const [x, y] = P(at(starCentre(s, tt), tt));
        ctx.beginPath();
        ctx.arc(x, y, 2 * dpr, 0, 2 * Math.PI);
        ctx.fill();
      }
      const [x, y] = P(at(starCentre(s, t0), t0));
      const gl = ctx.createRadialGradient(x, y, 0, x, y, 12 * dpr);
      gl.addColorStop(0, "rgba(255, 211, 107, 0.6)");
      gl.addColorStop(1, "rgba(255, 211, 107, 0)");
      ctx.fillStyle = gl;
      ctx.fillRect(x - 12 * dpr, y - 12 * dpr, 24 * dpr, 24 * dpr);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(s.sunRadius * k, 3.5 * dpr), 0, 2 * Math.PI);
      ctx.fillStyle = "#ffd36b";
      ctx.fill();
    }
    if (s.system === "gargantua") {
      // the system: orbits (a turn from now), places, names; the target ringed
      for (const b of GARGANTUA_SYSTEM.bodies) {
        if (b.universe !== "gargantua" || b.kind === "hole" || b.kind === "mouth") continue;
        const w = meanMotion(GARGANTUA_SYSTEM, b);
        const turn = w > 0 ? (2 * Math.PI) / w : 0;
        const pos = (t: number) => bodyState(GARGANTUA_SYSTEM, b.id, t).pos;
        const col = b.kind === "star" ? "255, 190, 120" : b.id === "miller" ? "120, 210, 225" : b.id === "mann" ? "215, 228, 245" : "220, 170, 120";
        if (turn > 0 && b.parent === "gargantua") poly(span(pos, t0, t0 + turn, 160), `rgba(${col}, 0.28)`, 1);
        const [x, y] = P(at(pos(t0), t0));
        ctx.beginPath();
        ctx.arc(x, y, (b.kind === "star" ? 4 : 3) * dpr, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(${col}, 0.95)`;
        ctx.fill();
        if (i.target === b.id) {
          ctx.beginPath();
          ctx.arc(x, y, 7 * dpr, 0, 2 * Math.PI);
          ctx.strokeStyle = "rgba(255, 138, 92, 0.95)";
          ctx.lineWidth = 1.4 * dpr;
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(${col}, 0.85)`;
        ctx.textAlign = "left";
        ctx.font = `600 ${9.5 * dpr}px ${FONT}`;
        ctx.fillText(b.name, x + 6 * dpr, y - 5 * dpr);
      }
      if (s.wormhole && s.whOrbit) {
        const m0 = mouth(s, t0);
        poly(span((t) => mouth(s, t).C as V3, t0, t0 + (2 * Math.PI) / Math.max(m0.omega, 1e-12), 160), "rgba(200, 140, 255, 0.28)", 1, [2, 3]);
      }
    }
    if (s.wormhole) {
      const m = mouth(s);
      if (cm) poly(span(() => m.C as V3, t0, t0 + T, 60), "rgba(200, 140, 255, 0.35)", 1, [2, 3]);
      const [x, y] = P(at(m.C as V3, t0));
      ctx.beginPath();
      ctx.arc(x, y, Math.max(lg(m.rGlue) * k, 3 * dpr), 0, 2 * Math.PI);
      ctx.strokeStyle = "rgba(200, 140, 255, 0.9)";
      ctx.lineWidth = 1.4 * dpr;
      ctx.stroke();
    }
    poly([...this.trail.map((q) => at(q.X, q.t)), at(X0, t0)], "rgba(124, 214, 255, 0.5)", 1.4);
    if (path && path.pts.length > 1) {
      const fut = [at(X0, t0), ...path.pts.map((q, j) => at(q, t0 + (j + 1) * path.dt))];
      const bad = path.fate === "horizon" || path.fate === "star";
      poly(fut, bad ? "rgba(255, 90, 70, 0.95)" : "rgba(255, 190, 80, 0.95)", 1.7, [5, 3]);
      ctx.textAlign = "left";
      ctx.font = `${9.5 * dpr}px ${FONT}`;
      tickTimes.forEach((tt, j) => {
        const idx = (tt - t0) / path.dt - 1;
        if (idx < 0 || idx >= path.pts.length - 1) return;
        const a = path.pts[Math.floor(idx)]!, b = path.pts[Math.floor(idx) + 1]!;
        const f = idx - Math.floor(idx);
        const [x, y] = P(at([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], tt));
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(x, y, 2.2 * dpr, 0, 2 * Math.PI);
        ctx.fill();
        if (j % 2 === 1) ctx.fillText(`+${fmtShort((j + 1) * tick)}`, x + 4 * dpr, y - 3 * dpr);
      });
      let iMin = -1, iMax = -1, rMin = Infinity, rMax = -Infinity;
      path.pts.forEach((q, j) => {
        const r = Math.hypot(...q);
        if (r < rMin) (rMin = r), (iMin = j);
        if (r > rMax) (rMax = r), (iMax = j);
      });
      const lbl = (j: number, txt: string) => {
        if (j <= 0 || j >= path.pts.length - 1) return;
        const [x, y] = P(at(path.pts[j]!, t0 + (j + 1) * path.dt));
        ctx.fillStyle = CYAN;
        ctx.font = `600 ${10 * dpr}px ${FONT}`;
        ctx.fillText(txt, x + 5 * dpr, y + 11 * dpr);
        ctx.font = `${9.5 * dpr}px ${FONT}`;
      };
      lbl(iMin, "Pe");
      if (path.fate === "continues") lbl(iMax, "Ap");
      if (bad) {
        const [x, y] = P(fut[fut.length - 1]!);
        ctx.strokeStyle = RED;
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.moveTo(x - 4 * dpr, y - 4 * dpr);
        ctx.lineTo(x + 4 * dpr, y + 4 * dpr);
        ctx.moveTo(x + 4 * dpr, y - 4 * dpr);
        ctx.lineTo(x - 4 * dpr, y + 4 * dpr);
        ctx.stroke();
      }
      const ca = this.closestApproach(i, t0);
      if (ca && ca.t > 0) {
        const j = Math.max(0, Math.round(ca.t / path.dt) - 1);
        const q = path.pts[Math.min(j, path.pts.length - 1)]!;
        const tt = t0 + ca.t;
        const tgt: V3 = i.target === "star" ? starCentre(s, tt) : (mouth(s).C as V3);
        const [x1, y1] = P(at(q, tt));
        const [x2, y2] = P(at(tgt, tt));
        ctx.strokeStyle = "rgba(255, 138, 92, 0.9)";
        ctx.lineWidth = 1.2 * dpr;
        ctx.setLineDash([2 * dpr, 2 * dpr]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#ff8a5c";
        ctx.fillText(`CA ${fmtLen(ca.d, this.s)}`, (x1 + x2) / 2 + 5 * dpr, (y1 + y2) / 2);
      }
    }
    // the flight plan: its path through the nodes (cyan), the nodes (diamonds)
    if (i.plan?.path && i.plan.path.pts.length > 1) {
      const pp = i.plan.path;
      poly([at(X0, t0), ...pp.pts.map((q, j) => at(q, pp.times[j]!))], "rgba(90, 220, 255, 0.95)", 1.8, [2, 3]);
      i.plan.nodes.forEach((n, k) => {
        let j = pp.times.findIndex((tt) => tt >= n.t);
        if (j < 0) j = pp.pts.length - 1;
        const [x, y] = P(at(pp.pts[j]!, n.t));
        ctx.fillStyle = k === 0 ? "#5ad8ff" : "#2fa4d0";
        ctx.strokeStyle = "#04121a";
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(x, y - 6 * dpr);
        ctx.lineTo(x + 6 * dpr, y);
        ctx.lineTo(x, y + 6 * dpr);
        ctx.lineTo(x - 6 * dpr, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#dff6ff";
        ctx.textAlign = "left";
        ctx.font = `700 ${9.5 * dpr}px ${FONT}`;
        ctx.fillText(`${k + 1}`, x + 8 * dpr, y - 6 * dpr);
      });
      const lastNode = i.plan.nodes[i.plan.nodes.length - 1];
      if ((lastNode?.then === "approach" || lastNode?.then === "orbit") && s.sun) {
        // the rendezvous: where the star will be then
        const [x, y] = P(at(starCentre(s, lastNode.t), lastNode.t));
        ctx.strokeStyle = "rgba(255, 211, 107, 0.9)";
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([2 * dpr, 2 * dpr]);
        ctx.beginPath();
        ctx.arc(x, y, 7 * dpr, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#ffd36b";
        ctx.font = `600 ${9.5 * dpr}px ${FONT}`;
        ctx.fillText("RDV", x + 9 * dpr, y + 4 * dpr);
      } else if (pp.fate === "horizon" || pp.fate === "star" || pp.fate === "wormhole") {
        const [x, y] = P(at(pp.pts[pp.pts.length - 1]!, pp.times[pp.times.length - 1]!));
        ctx.strokeStyle = pp.fate === "wormhole" ? "#c88cff" : RED;
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(x, y, 5 * dpr, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }
    const [sx, sy] = P(at(X0, t0));
    if (i.look) {
      const q = pr(i.look);
      const l = Math.hypot(q[0], q[1]);
      if (l > 0.05) {
        const a = Math.atan2(-q[1], q[0]);
        const half = Math.min(1.2, ((s.fov * Math.PI) / 360) * 1.4);
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 60 * dpr);
        g.addColorStop(0, "rgba(255, 255, 255, 0.2)");
        g.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, 60 * dpr * Math.min(1, l * 1.5), a - half, a + half);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (i.V) {
      const q = pr(i.V);
      const vl = Math.hypot(q[0], q[1]);
      if (vl > 1e-6) {
        const len = 24 * dpr * Math.min(1, vl * 3 + 0.3);
        ctx.strokeStyle = COL.prograde!;
        ctx.lineWidth = 1.6 * dpr;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + (q[0] / vl) * len, sy - (q[1] / vl) * len);
        ctx.stroke();
      }
    }
    const n = i.nose ? pr(i.nose) : [1, 0];
    const a = Math.hypot(n[0]!, n[1]!) < 1e-3 ? 0 : Math.atan2(-n[1]!, n[0]!);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(9 * dpr, 0);
    ctx.lineTo(-5 * dpr, 5.5 * dpr);
    ctx.lineTo(-2.5 * dpr, 0);
    ctx.lineTo(-5 * dpr, -5.5 * dpr);
    ctx.closePath();
    ctx.fillStyle = "#ffc85a";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 1 * dpr;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    const bar = niceStep(this.extent / 2.5);
    ctx.strokeStyle = "rgba(230, 235, 245, 0.8)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(8 * dpr, ch - 8 * dpr);
    ctx.lineTo(8 * dpr + bar * k, ch - 8 * dpr);
    ctx.stroke();
    ctx.fillStyle = "rgba(230, 235, 245, 0.85)";
    ctx.font = `${9.5 * dpr}px ${MONO}`;
    ctx.textAlign = "left";
    ctx.fillText(`${bar} M`, 8 * dpr, ch - 13 * dpr);
    ctx.textAlign = "right";
    ctx.fillText(`TICK ${fmtShort(tick)}`, cw - 6 * dpr, ch - 8 * dpr);
    ctx.fillText(`${side ? "EDGE-ON · " : ""}Z ${X0[2] >= 0 ? "+" : "−"}${Math.abs(X0[2]).toFixed(1)}`, cw - 6 * dpr, 12 * dpr);
  }
}

// ------------------------------------------------------------------------------------ drawing helpers
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** A tape's background: a vertical gradient that fades at both ends, corner brackets. */
function panelBg(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, dpr: number) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "rgba(8, 12, 20, 0)");
  g.addColorStop(0.18, "rgba(8, 12, 20, 0.5)");
  g.addColorStop(0.82, "rgba(8, 12, 20, 0.5)");
  g.addColorStop(1, "rgba(8, 12, 20, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(124, 214, 255, 0.35)";
  ctx.lineWidth = 1 * dpr;
  const c = 8 * dpr;
  ctx.beginPath();
  ctx.moveTo(x, y + c);
  ctx.lineTo(x, y);
  ctx.lineTo(x + c, y);
  ctx.moveTo(x + w - c, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + c);
  ctx.moveTo(x, y + h - c);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.moveTo(x + w - c, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y + h - c);
  ctx.stroke();
}

/** The current value of a tape: a pointer box with a big number, its unit and a sub-line. */
function valueBox(ctx: CanvasRenderingContext2D, x: number, cy: number, value: string, unit: string, sub2: string, side: "left" | "right", dpr: number) {
  ctx.font = `600 ${17 * dpr}px ${MONO}`;
  const w = ctx.measureText(value).width + 34 * dpr;
  const hgt = 24 * dpr;
  const x0 = side === "left" ? x : x - w;
  const tip = side === "left" ? x0 - 7 * dpr : x0 + w + 7 * dpr;
  ctx.fillStyle = "rgba(6, 10, 18, 0.82)";
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 1.4 * dpr;
  ctx.beginPath();
  if (side === "left") {
    ctx.moveTo(tip, cy);
    ctx.lineTo(x0, cy - hgt / 2);
    ctx.lineTo(x0 + w, cy - hgt / 2);
    ctx.lineTo(x0 + w, cy + hgt / 2);
    ctx.lineTo(x0, cy + hgt / 2);
  } else {
    ctx.moveTo(tip, cy);
    ctx.lineTo(x0 + w, cy - hgt / 2);
    ctx.lineTo(x0, cy - hgt / 2);
    ctx.lineTo(x0, cy + hgt / 2);
    ctx.lineTo(x0 + w, cy + hgt / 2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(255, 179, 92, 0.7)";
  ctx.shadowBlur = 6 * dpr;
  ctx.fillText(value, x0 + 8 * dpr, cy + 1 * dpr);
  ctx.shadowBlur = 0;
  ctx.fillStyle = AMBER;
  ctx.font = `600 ${10 * dpr}px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(unit, x0 + w - 7 * dpr, cy + 1 * dpr);
  ctx.fillStyle = "rgba(220, 228, 240, 0.75)";
  ctx.font = `${10 * dpr}px ${MONO}`;
  ctx.textAlign = side === "left" ? "left" : "right";
  ctx.fillText(sub2, side === "left" ? x0 : x0 + w, cy + hgt / 2 + 10 * dpr);
}

function label(ctx: CanvasRenderingContext2D, x: number, y: number, title: string, sub2: string, dpr: number) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = AMBER;
  ctx.font = `700 ${9.5 * dpr}px ${FONT}`;
  ctx.fillText(title, x, y - 10 * dpr);
  ctx.fillStyle = "rgba(200, 208, 222, 0.55)";
  ctx.font = `${8.5 * dpr}px ${FONT}`;
  ctx.fillText(sub2, x, y);
}

function marker(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, r: number, col: string) {
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.beginPath();
  if (kind === "prograde") {
    ctx.arc(x, y, r * 0.6, 0, 2 * Math.PI);
    ctx.moveTo(x, y - r * 0.6);
    ctx.lineTo(x, y - r * 1.2);
    ctx.moveTo(x - r * 0.6, y);
    ctx.lineTo(x - r * 1.2, y);
    ctx.moveTo(x + r * 0.6, y);
    ctx.lineTo(x + r * 1.2, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.15, 0, 2 * Math.PI);
    ctx.fill();
  } else if (kind === "burn") {
    ctx.arc(x, y, r * 0.8, 0, 2 * Math.PI);
    ctx.moveTo(x - r * 0.5, y);
    ctx.lineTo(x + r * 0.5, y);
    ctx.moveTo(x, y - r * 0.5);
    ctx.lineTo(x, y + r * 0.5);
    ctx.stroke();
  } else if (kind === "target") {
    ctx.rect(x - r * 0.6, y - r * 0.6, r * 1.2, r * 1.2);
    ctx.stroke();
  } else {
    ctx.arc(x, y, r * 0.6, 0, 2 * Math.PI);
    ctx.moveTo(x - r * 0.42, y - r * 0.42);
    ctx.lineTo(x + r * 0.42, y + r * 0.42);
    ctx.moveTo(x + r * 0.42, y - r * 0.42);
    ctx.lineTo(x - r * 0.42, y + r * 0.42);
    ctx.stroke();
  }
}

/** The marker's glyph as a small SVG, for the buttons. */
function glyphSvg(kind: string, col: string) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "-12 -12 24 24");
  svg.setAttribute("class", "fl-glyph");
  const d =
    kind === "prograde" ? "M-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M0 -5V-10M-5 0H-10M5 0H10" :
    kind === "retrograde" ? "M-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M-3.5 -3.5L3.5 3.5M3.5 -3.5L-3.5 3.5" :
    kind === "target" ? "M-6 -6H6V6H-6Z" : "M-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M-4 0H4M0 -4V4";
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", col);
  p.setAttribute("stroke-width", "2");
  svg.append(p);
  return svg;
}

function niceStep(x: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(x, 1e-9)));
  const m = x / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

function fmtShort(t: number) {
  return t >= 1000 ? `${+(t / 1000).toFixed(1)}k M` : `${t} M`;
}

function fmtG(g: number) {
  return g >= 1e4 ? `${g.toExponential(1)} g` : g >= 100 ? `${g.toFixed(0)} g` : `${g.toPrecision(3)} g`;
}

/** A distance in M, in km (m) for the chosen mass below 0.1 M: near a planet, M is far too coarse. */
function fmtLen(d: number, s: Settings) {
  if (d >= 0.1) return `${d.toFixed(1)} M`;
  const m = d * 1476.625 * s.massSolar;
  return m >= 1e4 ? `${Math.round(m / 1000).toLocaleString("en-US")} km` : `${Math.round(m).toLocaleString("en-US")} m`;
}

/** A coordinate time in M, with its duration for the chosen mass. */
function fmtM(t: number, s: Settings) {
  const sec = t * 4.925490947e-6 * s.massSolar;
  const d = sec < 120 ? `${sec.toFixed(0)} s` : sec < 7200 ? `${(sec / 60).toFixed(0)} min` : sec < 172800 ? `${(sec / 3600).toFixed(1)} h` : `${(sec / 86400).toFixed(1)} d`;
  return `${t.toFixed(0)} M (${d})`;
}

/** A clock: elapsed time for the chosen mass, as d hh:mm:ss. */
function fmtClock(tM: number, s: Settings) {
  const sec = Math.max(0, tM * 4.925490947e-6 * s.massSolar);
  // (years for long flights: Julian years)
  if (sec >= 365.25 * 86400) {
    const y = Math.floor(sec / (365.25 * 86400));
    return `${y}y ${Math.floor((sec - y * 365.25 * 86400) / 86400)}d`;
  }
  const d = Math.floor(sec / 86400);
  const hh = Math.floor((sec % 86400) / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = Math.floor(sec % 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return d > 0 ? `${d}d ${p(hh)}:${p(mm)}` : `${p(hh)}:${p(mm)}:${p(ss)}`;
}
