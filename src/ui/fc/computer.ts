// The flight computer's interface, over the full-screen map (M): on the left the operations — the
// orbit's (circularize, apoapsis, periapsis, Hohmann, inclination, resonance), the target's (planes,
// rendezvous with its porkchop, intercept, velocities, the closest approach), the landing's (the sites,
// the deorbit and the guided entry), the missions' (the universes' own planners) —, each planned before
// it is flown: its burns, their Δv and duration, the orbit they make, against the propellant left; on the
// right the analysis — the orbit's elements and times, the target's relation (relative inclination,
// phase angle and the window, closest approach), the Δv budget, the plan's burns, each editable to the
// metre per second and the second, snapped to the apsides and nodes.

import "./fc.css";
import { circularize, hohmann, matchPlanes, matchVelocities, relation, resonant, setApoapsis, setInclination, setPeriapsis, transfer, fineTune, type Burn, type FcContext, type OpResult, type Porkchop } from "../../fc/ops";
import { elements, len, nodesAgainst, timeTo, type Elements, type V3 } from "../../fc/kepler";
import * as kep from "../../fc/kepler";
import type { Site } from "../../game/sites";
import type { KerrOrbit } from "../../fc/kerr-ops";
import { alignOverSite, firstReachable, sitePasses, type Pass, type SiteTrack } from "../../fc/land-ops";
import { horizon, isco } from "../../physics";
import { BODY_NAMES } from "../../targeting";
import { AU_M, C_MPS, G0 } from "../../units";
import { store } from "../../util/storage";

/** What the computer needs from the flight (controls.ts). */
export interface FcHost {
  /** the craft about the body of its sphere: the context (SI), the body's name and radius, the
   *  universe; null far from any body (or about Gargantua itself: see kerr) */
  context(): { ctx: FcContext; body: string; bodyName: string; targetName: string | null; universe: "ours" | "gargantua" } | null;
  /** about Gargantua (Kerr): its own planners */
  kerr(): { r: number; target: string | null } | null;
  kerrPlan(kind: "circular" | "align" | "target" | "wormhole", r?: number): string | null;
  /** about Gargantua: the orbit on the geodesics (apsides, times [M, absolute]), now [M], the scene's
   *  seconds and metres per M, the spin */
  kerrInfo(): { o: KerrOrbit; t: number; Msec: number; Mm: number; a: number } | null;
  /** about Gargantua: an orbital operation on the geodesics (fc/kerr-ops.ts) */
  kerrOp(kind: "circ" | "ap" | "pe" | "hohmann" | "inc" | "res" | "plane", x?: number | "now" | "pe" | "ap"): OpResult | string;
  /** an operation previewed — its path drawn on the maps before it is executed —; null: none */
  preview(burns: Burn[] | null, note: string): void;
  /** the plan flown: set (replacing), executed, cleared; the current one as burns (s from now) */
  setPlan(burns: Burn[], note: string): string | null;
  execute(): string | null;
  clear(): void;
  plan(): { burns: Burn[]; note: string; executing: boolean } | null;
  /** the propellant: the Δv left [m/s] and the acceleration at full thrust [m/s²] */
  budget(): { dv: number; accel: number };
  /** landing: the body's sites, the chosen one, the entry flown (planned when engaged) */
  sites(): Site[];
  site(): Site | null;
  setSite(s: Site | null): void;
  /** a site as the LAND tab follows it: where it will be (the body turning it under the orbit), the
   *  craft's reach across its track (fc/land-ops.ts) */
  siteTrack(s: Site): SiteTrack | null;
  land(): string | null;
  /** the MISSION tab: the destinations from here, a mission planned (previewed: its path on the maps),
   *  adopted into the plan */
  missionTargets(): { universe: "ours" | "gargantua" | null; here: string | null; list: { id: string; name: string; group: string; far: string }[] };
  missionPlan(spec: { target: string; arrival?: "orbit" | "flyby" | "freeReturn"; altKm?: number; retKm?: number; orbit?: boolean }): Promise<
    { ok: true; note: string; burns: Burn[]; dvTotal: number; arrive: { body: string; t: number } | null; afterText: string } | { ok: false; note: string }>;
  missionCommit(): string | null;
  /** the current target (the map's, the analysis's) */
  target(): string;
  /** the autopilots — the hub's own buttons do the same: engaged (not toggled), their state (on, why
   *  not); the launch to orbit (its height, its inclination: the hub's TAKE OFF flies them too) */
  engage(a: "hover" | "circularize" | "approach" | "land" | "takeoff" | "entry", now?: boolean): string | null;
  disengage(): void;
  autoState(a: "hover" | "circularize" | "approach" | "land" | "takeoff" | "entry"): { on: boolean; why: string };
  launch(altKm: number | null, incDeg: number | null): string | null;
  launchGoal(): { altKm: number | null; incDeg: number | null };
  say(t: string): void;
}

export type Tab = "orbit" | "target" | "land" | "mission";
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const D = 180 / Math.PI;
const km = (m: number) => (!Number.isFinite(m) ? "∞" : Math.abs(m) >= 1e9 ? `${(m / AU_M).toFixed(3)} AU` : Math.abs(m) >= 1e6 ? `${(m / 1e3).toFixed(0)} km` : Math.abs(m) >= 1e4 ? `${(m / 1e3).toFixed(1)} km` : `${m.toFixed(0)} m`);
const dur = (s: number) => {
  if (!Number.isFinite(s)) return "—";
  const a = Math.abs(s);
  const sg = s < 0 ? "−" : "";
  if (a < 60) return `${sg}${a.toFixed(0)} s`;
  if (a < 3600) return `${sg}${Math.floor(a / 60)} min ${Math.round(a % 60).toString().padStart(2, "0")} s`;
  if (a < 86400) return `${sg}${Math.floor(a / 3600)} h ${Math.round((a % 3600) / 60).toString().padStart(2, "0")} min`;
  return `${sg}${(a / 86400).toFixed(a < 864000 ? 1 : 0)} d`;
};
const C = C_MPS;
const ms = (v: number) => (!Number.isFinite(v) ? "∞" : Math.abs(v) >= 3e6 ? `${(v / C).toFixed(4)} c` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} km/s` : `${v.toFixed(Math.abs(v) < 10 ? 2 : 1)} m/s`);
/** A burn's part: m/s, or km/s for the hole's (fractions of c). */
const part = (v: number, big: boolean) => (big ? (v / 1000).toFixed(0) : v.toFixed(1));
/** A radius about the hole: in M, and its distance. */
const rM = (r: number, Mm: number) => (!Number.isFinite(r) ? "∞" : `${r.toFixed(2)} M · ${km(r * Mm)}`);

/** A number field with its unit and steppers (⇧ ×10, ⌥ ×0.1). */
function numField(label: string, value: number, unit: string, step: number, onChange: (v: number) => void, o: { min?: number; max?: number; digits?: number } = {}) {
  const w = h("label", "fc-num");
  const l = h("span", "fc-num-l", label);
  const inp = h("input");
  inp.type = "number";
  inp.step = String(step);
  inp.value = value.toFixed(o.digits ?? 0);
  const u = h("span", "fc-num-u", unit);
  const set = (v: number) => {
    const c = Math.min(Math.max(v, o.min ?? -Infinity), o.max ?? Infinity);
    inp.value = c.toFixed(o.digits ?? 0);
    onChange(c);
  };
  const bump = (k: number) => (e: MouseEvent) => set(Number(inp.value) + k * step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1));
  const minus = h("button", "fc-step", "−");
  const plus = h("button", "fc-step", "+");
  minus.onclick = bump(-1);
  plus.onclick = bump(1);
  inp.onchange = () => set(Number(inp.value));
  inp.onkeydown = (e) => e.stopPropagation();
  w.append(l, minus, inp, plus, u);
  return { el: w, get: () => Number(inp.value), set: (v: number) => (inp.value = v.toFixed(o.digits ?? 0)) };
}

export class FlightComputer {
  readonly root = h("div", "fc-root");
  private ops = h("div", "fc-panel fc-ops");
  private info = h("div", "fc-panel fc-info");
  private tab: Tab = "orbit";
  private tabs: Record<Tab, HTMLButtonElement> = {} as Record<Tab, HTMLButtonElement>;
  private body = h("div", "fc-body");
  private ctxLine = h("div", "fc-ctx");
  private result = h("div", "fc-result");
  private pending: { r: OpResult; ctx: FcContext } | null = null;
  private infoEls: Record<string, HTMLElement> = {};
  private sel = 0;
  private shown = false;
  private lastInfo = 0;
  private sig = "";

  constructor(private host: FcHost) {
    // the operations
    const head = h("div", "fc-head");
    head.append(h("span", "fc-title", "FLIGHT COMPUTER"), this.ctxLine);
    // (each panel folds to its edge — the map then takes the room; a click on the tab brings it back)
    const fold = (panel: HTMLElement, side: "l" | "r", label: string) => {
      const b = h("button", "fc-fold", side === "l" ? "‹" : "›");
      b.dataset.tip = `Fold the ${label} to the edge (the map takes the room)`;
      const tab = h("button", "fc-tab", label);
      tab.onclick = b.onclick = () => {
        const off = !panel.classList.contains("min");
        panel.classList.toggle("min", off);
        this.root.closest(".fl-root")?.classList.toggle(`fc-${side}-off`, off);
        store.set(`kerr.fc-${side}`, off ? "0" : "1");
      };
      panel.append(b, tab);
      if (store.get(`kerr.fc-${side}`) === "0") requestAnimationFrame(() => b.click());
    };
    fold(this.ops, "l", "FLIGHT COMPUTER");
    fold(this.info, "r", "ANALYSIS");
    this.info.querySelector(".fc-fold")!.textContent = "›";
    const tb = h("div", "fc-tabs");
    for (const [t, label] of [["orbit", "ORBIT"], ["target", "TARGET"], ["land", "LAND"], ["mission", "MISSION"]] as [Tab, string][]) {
      const b = h("button", "", label);
      b.onclick = () => this.setTab(t);
      this.tabs[t] = b;
      tb.append(b);
    }
    this.ops.append(head, tb, this.body, this.result);
    // the analysis
    const sec = (title: string, id: string) => {
      const s = h("div", "fc-sec");
      s.append(h("div", "fc-sec-t", title));
      const b = h("div", "fc-sec-b");
      s.append(b);
      this.infoEls[id] = b;
      return s;
    };
    this.info.append(h("div", "fc-info-head", "ANALYSIS"), sec("ORBIT", "orbit"), sec("TARGET", "target"), sec("Δv BUDGET", "budget"), sec("PLAN", "plan"));
    this.root.append(this.ops, this.info);
    this.root.hidden = true;
    this.setTab("orbit");
  }

  /** A tab brought up (the HUD's planner key: the MISSION tab). */
  openTab(t: Tab) {
    this.setTab(t);
  }

  /** Shown with the full-screen map. */
  show(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    this.root.hidden = !on;
    if (on) this.setTab(this.tab);
    else this.host.preview(null, "");
  }

  private setTab(t: Tab) {
    this.tab = t;
    for (const [k, b] of Object.entries(this.tabs)) b.classList.toggle("on", k === t);
    this.body.replaceChildren();
    this.result.replaceChildren();
    this.pending = null;
    this.landRefresh = null;
    this.host.preview(null, "");
    const k = this.host.kerr();
    if (k && t !== "land" && t !== "mission") return this.buildKerr(t);
    if (t === "orbit") this.buildOrbit();
    else if (t === "target") this.buildTarget();
    else if (t === "land") this.buildLand();
    else this.buildMission();
  }

  /** The autopilots' rows' buttons, kept up to date (engaged, why not) a few times a second. */
  private autoBtns: { a: "hover" | "circularize" | "approach" | "land" | "takeoff" | "entry"; b: HTMLButtonElement; verb: string }[] = [];

  /**
   * An autopilot's row — the same as the hub's button: ENGAGE (the hub's lit button the same), its
   * state shown (ENGAGED — a click disengages), dimmed with the hub's reason when it cannot.
   */
  private autoOp(a: "hover" | "circularize" | "approach" | "land" | "takeoff" | "entry", title: string, help: string, fields: HTMLElement[] = [], go?: () => string | null, verb = "ENGAGE") {
    const r = h("div", "fc-op fc-auto");
    const t = h("div", "fc-op-t", title);
    t.append(h("span", "fc-hub", "HUB"));
    const p = h("div", "fc-op-h", help);
    const f = h("div", "fc-op-f");
    f.append(...fields);
    const b = h("button", "fc-go", verb);
    b.onclick = () => {
      const st = this.host.autoState(a);
      if (st.on) {
        this.host.disengage();
        return;
      }
      const e = go ? go() : this.host.engage(a);
      if (e) this.host.say(e);
    };
    r.append(t, p, f, b);
    this.body.append(r);
    this.autoBtns.push({ a, b, verb });
  }

  private syncAutos() {
    for (const { a, b, verb } of this.autoBtns) {
      if (!b.isConnected) continue;
      const st = this.host.autoState(a);
      const txt = st.on ? "ENGAGED — DISENGAGE" : verb;
      if (b.textContent !== txt) b.textContent = txt;
      b.classList.toggle("fc-on", st.on);
      b.classList.toggle("fc-off", !st.on && !!st.why);
      if (st.why && !st.on) b.dataset.why = st.why;
      else delete b.dataset.why;
    }
    this.autoBtns = this.autoBtns.filter((x) => x.b.isConnected);
  }

  /** An operation's row: its title, help, fields, and the button that plans it. */
  private op(title: string, help: string, fields: HTMLElement[], plan: () => OpResult | string | null, verb = "PLAN") {
    const r = h("div", "fc-op");
    const t = h("div", "fc-op-t", title);
    const p = h("div", "fc-op-h", help);
    const f = h("div", "fc-op-f");
    f.append(...fields);
    const b = h("button", "fc-go", verb);
    b.onclick = () => {
      // (the result under its operation, in view)
      r.after(this.result);
      const res = plan();
      if (typeof res === "string") this.host.say(res);
      else if (res) this.preview(res);
      this.result.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    r.append(t, p, f, b);
    this.body.append(r);
  }

  private ctxOrSay(): { ctx: FcContext; R: number } | null {
    const c = this.host.context();
    if (!c) {
      this.host.say("The flight computer: near a body (in its sphere of influence)");
      return null;
    }
    return { ctx: c.ctx, R: c.ctx.R };
  }

  /** The launch to orbit (the hub's TAKE OFF): its height and inclination fields. */
  private launchOp() {
    const g = this.host.launchGoal();
    const alt = numField("Orbit altitude", g.altKm ?? 200, "km", 10, () => {}, { min: 0 });
    const inc = numField("Inclination", g.incDeg ?? 0, "°", 1, () => {}, { min: 0, max: 180, digits: 1 });
    const east = h("label", "fc-check");
    const cb = h("input");
    cb.type = "checkbox";
    cb.checked = g.incDeg === null;
    east.append(cb, h("span", "", "Due east (the ground's turn given)"));
    this.autoOp("takeoff", "Launch to orbit", "Straight up through the thick air, the gravity turn, then circular at the height — the hub's TAKE OFF flies the same", [alt.el, inc.el, east], () => this.host.launch(alt.get(), cb.checked ? null : inc.get()), "LAUNCH");
  }

  private buildOrbit() {
    this.launchOp();
    const c = this.host.context();
    const R = c?.ctx.R ?? 6371e3;
    const el = c ? elements(c.ctx.mu, c.ctx.r, c.ctx.v, c.ctx.pole) : null;
    const alt = (x: number) => Math.max((x - R) / 1e3, 0);
    let where: "ap" | "pe" | "now" = "ap";
    const seg = h("div", "fc-seg");
    for (const [w, l] of [["ap", "AT AP"], ["pe", "AT PE"], ["now", "NOW"]] as ["ap" | "pe" | "now", string][]) {
      const b = h("button", w === where ? "on" : "", l);
      b.onclick = () => {
        where = w;
        for (const x of seg.children) x.classList.toggle("on", x === b);
      };
      seg.append(b);
    }
    this.op("Circularize", "The speed made circular there, the flight path levelled — NOW: the autopilot, closed on the circular speed where the ship is (the hub's CIRC burns at the next apsis above the air)", [seg], () => {
      if (where === "now") {
        const e = this.host.engage("circularize", true);
        this.host.say(e ?? "Circularize NOW: the autopilot closed on the circular speed where the ship is");
        return null;
      }
      const x = this.ctxOrSay();
      return x && circularize(x.ctx, where);
    });
    const ap = numField("Apoapsis", el ? alt(el.ra === Infinity ? el.rp * 2 : el.ra) : 400, "km", 10, () => {}, { min: 0 });
    this.op("Apoapsis", "A burn at the periapsis (or now) raises or lowers the far side", [ap.el], () => {
      const x = this.ctxOrSay();
      return x && setApoapsis(x.ctx, x.R + ap.get() * 1e3, "pe");
    });
    const pe = numField("Periapsis", el ? alt(el.rp) : 200, "km", 10, () => {}, { min: -100 });
    this.op("Periapsis", "A burn at the apoapsis (or now) raises or lowers the near side — below the air's top: an entry", [pe.el], () => {
      const x = this.ctxOrSay();
      return x && setPeriapsis(x.ctx, x.R + pe.get() * 1e3, "ap");
    });
    const ho = numField("Altitude", el ? alt(el.a) * 2 : 1000, "km", 50, () => {}, { min: 0 });
    this.op("Hohmann transfer", "Two burns to a circular orbit: from one apsis, circularize at the other", [ho.el], () => {
      const x = this.ctxOrSay();
      return x && hohmann(x.ctx, x.R + ho.get() * 1e3);
    });
    const inc = numField("Inclination", el ? el.i * D : 0, "°", 1, () => {}, { min: 0, max: 180, digits: 1 });
    this.op("Inclination", "The plane turned at the cheaper node (the farther, slower one)", [inc.el], () => {
      const x = this.ctxOrSay();
      return x && setInclination(x.ctx, inc.get() / D);
    });
    const rs = numField("Period ×", 1.333, "", 0.25, () => {}, { min: 0.2, max: 20, digits: 3 });
    this.op("Resonant orbit", "The period a ratio of this one's — back here every few turns (a constellation's spacing)", [rs.el], () => {
      const x = this.ctxOrSay();
      return x && resonant(x.ctx, rs.get());
    });
  }

  private buildTarget() {
    this.autoOp("approach", "Approach the target", "Flies to the target and stops beside it, station-keeping — the hub's APPROACH");
    this.autoOp("hover", "Hold position", "Kills the speed relative to the body and holds the place — the hub's HOLD POS");
    const c = this.host.context();
    const name = c?.targetName ?? null;
    if (!name || !c?.ctx.target) {
      this.body.append(h("div", "fc-empty", "No target about this body — pick one (a click on the map: a craft, a moon, the station)"));
      return;
    }
    this.body.append(h("div", "fc-tgt", `Target: ${name}`));
    this.op("Match planes", "At the next relative node, the orbit turned into the target's plane", [], () => {
      const x = this.ctxOrSay();
      return x && matchPlanes(x.ctx);
    });
    this.op("Rendezvous", "The porkchop of departures × flight times (Lambert's arcs), the cheapest kept: a departure and the velocity matched on arrival", [], () => {
      const x = this.ctxOrSay();
      return x && transfer(x.ctx, { rendezvous: true });
    });
    this.op("Intercept", "The cheapest arc reaching the target (the departure alone — a flyby)", [], () => {
      const x = this.ctxOrSay();
      return x && transfer(x.ctx, { rendezvous: false });
    });
    this.op("Match velocities", "At the closest approach, the craft's velocity made the target's", [], () => {
      const x = this.ctxOrSay();
      return x && matchVelocities(x.ctx);
    });
    const ft = numField("Burn in", 5, "min", 1, () => {}, { min: 0, digits: 1 });
    this.op("Fine-tune the approach", "A small burn bringing the closest approach nearest", [ft.el], () => {
      const x = this.ctxOrSay();
      return x && fineTune(x.ctx, ft.get() * 60);
    });
  }

  /**
   * LAND: the world's sites, each with where the orbit leaves it — its next pass within the craft's
   * reach (when, how far across), or how far the closest one misses it —; the site chosen in detail
   * (its next passes, north- or southbound, in reach or not); the plane change that puts a pass over it
   * (previewed, then flown as a burn); the entry autopilot (deorbit, entry, landing) and the landing
   * where the craft is.
   */
  /** the LAND tab's passes redone in place (its sites' lines, the chosen one's card) */
  private landRefresh: (() => void) | null = null;
  private landAt = 0;

  private buildLand() {
    const sites = this.host.sites();
    const cur = this.host.site();
    if (!sites.length) {
      this.autoOp("land", "Land here", "Down where the ship is: the descent rate held, the sideways speed killed, the touchdown — the hub's LAND");
      this.body.append(h("div", "fc-empty", "No landing site on this body for the guided entry — a world with ground and its sites (Earth, Mars, the Moon, Titan, Miller, Mann, Edmunds)"));
      return;
    }
    // each site's passes over the coming day of orbits (the body turning under the orbit) — redone every
    // two seconds while the tab is open (the countdowns, the orbit changed by a burn)
    const passesOf = () => sites.map((st) => {
      const tr = this.host.siteTrack(st);
      const c = this.host.context();
      const passes = tr && c ? sitePasses(c.ctx, tr, { orbits: 16, perOrbit: 120 }) : [];
      return { st, tr, passes, first: tr ? firstReachable(passes, tr.reach) : null, closest: passes.length ? Math.min(...passes.map((p) => p.across)) : NaN };
    });
    const info = passesOf();
    const reach = info.find((x) => x.tr)?.tr?.reach;
    if (reach) this.body.append(h("div", "fc-tgt", `Reach across the track: ${km(reach)} (the entry's lift) · passes over the next 16 orbits`));
    const status = (x: (typeof info)[number]) =>
      !x.passes.length ? `<i class="fc-dim">no orbit to pass over it</i>` : x.first ? `<i class="fc-okc">▸ pass in ${dur(x.first.t)} · ${km(x.first.across)} off</i>` : `<i class="fc-warnc">out of reach · closest ${km(x.closest)}</i>`;
    const nearest = (inf: typeof info) => {
      const soonest = inf.filter((x) => x.first).sort((a, b) => a.first!.t - b.first!.t)[0];
      return `the site the orbit passes nearest${soonest ? ` — now ${soonest.st.name.split(",")[0]}` : ""}`;
    };
    const list = h("div", "fc-sites");
    const auto = h("button", "fc-site" + (!cur ? " on" : ""));
    auto.innerHTML = `<b>Nearest</b><small>${nearest(info)}</small>`;
    auto.onclick = () => {
      this.host.setSite(null);
      this.setTab("land");
    };
    list.append(auto);
    const lines: HTMLElement[] = [];
    for (const x of info) {
      const s = x.st;
      const b = h("button", "fc-site" + (cur && cur.name === s.name ? " on" : ""));
      b.innerHTML = `<b>${s.name}</b><small>${Math.abs(s.lat).toFixed(2)}° ${s.lat >= 0 ? "N" : "S"} · ${Math.abs(s.lon).toFixed(2)}° ${s.lon >= 0 ? "E" : "W"}${s.runway ? ` · runway ${String(Math.round((s.rwy ?? 0) / 10) % 36 || 36).padStart(2, "0")}` : ""}</small><small>${status(x)}</small>`;
      lines.push(b.lastElementChild as HTMLElement);
      b.onclick = () => {
        this.host.setSite(s);
        this.setTab("land");
      };
      list.append(b);
    }
    this.body.append(list);
    // the site chosen: its next passes; the plane change over it
    const sel = cur ? info.find((x) => x.st.name === cur.name) : null;
    if (sel && sel.tr) {
      const card = h("div", "fc-card");
      card.append(h("div", "fc-card-t", `${sel.st.name.split(",")[0]} — the next passes`));
      const tab = h("table", "fc-burns");
      const none = h("div", "fc-after", "No pass: the craft is not on a closed orbit about this world");
      const table = (x: (typeof info)[number]) => {
        const rows = x.passes.slice(0, 5);
        tab.innerHTML = `<tr><th>in</th><th>across</th><th>going</th><th></th></tr>` + rows.map((p: Pass) => `<tr><td>${dur(p.t)}</td><td>${km(p.across)}</td><td>${p.north ? "north" : "south"}</td><td>${p.across <= x.tr!.reach ? `<b class="fc-okc">in reach</b>` : `<span class="fc-warnc">out</span>`}</td></tr>`).join("");
        none.hidden = rows.length > 0;
      };
      table(sel);
      card.append(tab, none);
      this.body.append(card);
      this.landRefresh = () => {
        const inf = passesOf();
        auto.lastElementChild!.textContent = nearest(inf);
        inf.forEach((x, i) => (lines[i]!.innerHTML = status(x)));
        const y = inf.find((x) => x.st.name === sel.st.name);
        if (y && y.tr) table(y);
      };
      this.op(
        "Align the orbit over the site",
        `A plane change that puts a pass right over ${sel.st.name.split(",")[0]} within a day — the burn's point along the next orbit and the arrival chosen for the least Δv (v Δi, the velocity turned); then the entry finds that pass`,
        [],
        () => {
          const c = this.host.context();
          if (!c) return "The flight computer: near a body (in its sphere of influence)";
          // (the lead: a minute to turn, and half of a plane change's burn — a few km/s — before its centre)
          const a = this.host.budget().accel;
          return alignOverSite(c.ctx, sel.tr!, { orbits: 16, lead: 90 + (a > 0 ? Math.min(1500 / a, 1800) : 120) });
        },
      );
    } else {
      this.body.append(h("div", "fc-empty", "Choose a site above: its passes, and the plane change that puts one over it"));
      this.landRefresh = () => {
        const inf = passesOf();
        auto.lastElementChild!.textContent = nearest(inf);
        inf.forEach((x, i) => (lines[i]!.innerHTML = status(x)));
      };
    }
    this.autoOp("entry", "Deorbit, entry & landing", "From orbit: the burn timed and sized for the site (its pass with the least crossrange), the guided entry — the angle of attack held, the bank flown — then the glide and the landing (the Ranger), or the engines' (the Lander) — the hub's ENTRY");
    this.autoOp("land", "Land here", "Down where the ship is: the descent rate held, the sideways speed killed, the touchdown — the hub's LAND");
  }

  /** The mission's choices, kept from one opening to the next. */
  private mis = { target: "", arrival: "orbit" as "orbit" | "flyby" | "freeReturn", altKm: 200, retKm: 200, orbit: true };

  /**
   * MISSION: to another body — the destinations from here (grouped, how far), the arrival (an orbit, a
   * flyby, a free return; about Gargantua's worlds: in orbit or beside), PLAN: the mission computed,
   * its path previewed on the maps, its burns and arrival in the card; EXECUTE / TO THE PLAN adopt it.
   */
  private buildMission() {
    const T = this.host.missionTargets();
    if (!T.universe || !T.list.length) {
      this.body.append(h("div", "fc-empty", "Missions: from an orbit in our solar system, or about Gargantua"));
      return;
    }
    const M = this.mis;
    const ids = T.list.map((x) => x.id);
    if (!ids.includes(M.target) || M.target === T.here) {
      const tg = this.host.target();
      M.target = ids.includes(tg) && tg !== T.here ? tg : T.list.find((x) => x.id !== T.here && x.group !== "Planets")?.id ?? T.list.find((x) => x.id !== T.here)!.id;
    }
    this.body.append(h("div", "fc-tgt", `From: ${T.here ? (T.list.find((x) => x.id === T.here)?.name ?? T.here) : T.universe === "ours" ? "our solar system" : "Gargantua's orbit"}`));
    // the destinations
    const list = h("div", "fc-dests");
    let group = "";
    for (const d of T.list) {
      if (d.group !== group) {
        group = d.group;
        list.append(h("div", "fc-dest-g", group));
      }
      const b = h("button", "fc-dest" + (d.id === M.target ? " on" : "") + (d.id === T.here ? " here" : ""));
      b.innerHTML = `<b>${d.name}</b><small>${d.id === T.here ? "here" : d.far}</small>`;
      b.disabled = d.id === T.here;
      b.onclick = () => {
        M.target = d.id;
        this.setTab("mission");
      };
      list.append(b);
    }
    this.body.append(list);
    requestAnimationFrame(() => list.querySelector(".fc-dest.on")?.scrollIntoView({ block: "nearest" }));
    // the arrival
    const dest = T.list.find((x) => x.id === M.target)!;
    const craft = ["iss", "ranger", "lander", "endurance"].includes(dest.id);
    const fields: HTMLElement[] = [];
    let help = "";
    if (T.universe === "ours" && !craft && dest.id !== "wormhole") {
      const seg = h("div", "fc-seg");
      for (const [w, l] of [["orbit", "ORBIT"], ["flyby", "FLYBY"], ["freeReturn", "FREE RETURN"]] as [typeof M.arrival, string][]) {
        const b = h("button", w === M.arrival ? "on" : "", l);
        b.onclick = () => {
          M.arrival = w;
          this.setTab("mission");
        };
        seg.append(b);
      }
      fields.push(seg, numField(M.arrival === "orbit" ? "Orbit altitude" : "Closest approach", M.altKm, "km", 50, (v) => (M.altKm = v), { min: 10 }).el);
      if (M.arrival === "freeReturn") fields.push(numField("Back home at", M.retKm, "km", 50, (v) => (M.retKm = v), { min: 10 }).el);
      help = "Patched conics aimed with the n-body predictor — the departure in its window, mid-course corrections, the capture; the B-plane aimed at the height asked";
    } else if (craft) help = "A rendezvous 200 m off its free docking port — departure, two corrections, arrival — then the docking autopilot";
    else if (dest.id === "wormhole") help = T.universe === "ours" ? "Into our mouth: the throat crossed to Gargantua's side" : "A 3-D burn aimed by Newton's method at the mouth's centre";
    else {
      const seg = h("div", "fc-seg");
      for (const [w, l] of [[true, "IN ORBIT"], [false, "BESIDE IT"]] as [boolean, string][]) {
        const b = h("button", w === M.orbit ? "on" : "", l);
        b.onclick = () => {
          M.orbit = w;
          this.setTab("mission");
        };
        seg.append(b);
      }
      fields.push(seg);
      help = "On Kerr's geodesics: the apsis burn timed for the world to be there, a velocity match at the closest approach — then in orbit about it, or station-keeping beside it";
    }
    this.op(`To ${dest.name}`, help, fields, () => {
      this.result.replaceChildren(h("div", "fc-busy", `Planning the mission to ${dest.name}… (the n-body paths aimed)`));
      void this.host.missionPlan({ target: M.target, arrival: M.arrival, altKm: M.altKm, retKm: M.retKm, orbit: M.orbit }).then((r) => {
        if (this.tab !== "mission") return;
        if (!r.ok) {
          if (r.note) this.preview({ ok: false, note: r.note, burns: [], dvTotal: 0 });
          else this.result.replaceChildren();
          return;
        }
        this.preview({ ok: true, note: r.note, burns: r.burns, dvTotal: r.dvTotal, afterText: r.afterText, mission: true });
      });
      return null;
    });
  }

  /** About Gargantua itself: the orbital operations on the Kerr geodesics (fc/kerr-ops.ts), the
   *  rendezvous and the wormhole by Gargantua's own planners. */
  private buildKerr(t: Tab) {
    const k = this.host.kerr()!;
    const I = this.host.kerrInfo();
    const o = I?.o;
    if (t === "orbit") {
      if (I) {
        const iscoR = isco(o!.prograde ? Math.abs(I.a) : -Math.abs(I.a));
        this.body.append(h("div", "fc-tgt", `1 M = ${km(I.Mm)} · ${(I.Msec).toFixed(0)} s — horizon ${horizon(I.a).toFixed(2)} M, ISCO ${iscoR.toFixed(2)} M (${o!.prograde ? "prograde" : "retrograde"})`));
      }
      let where: "ap" | "pe" | "now" = "ap";
      const seg = h("div", "fc-seg");
      for (const [w, l] of [["ap", "AT AP"], ["pe", "AT PE"], ["now", "NOW"]] as ["ap" | "pe" | "now", string][]) {
        const b = h("button", w === where ? "on" : "", l);
        b.onclick = () => {
          where = w;
          for (const x of seg.children) x.classList.toggle("on", x === b);
        };
        seg.append(b);
      }
      this.op("Circularize", "The velocity made the circular orbit's there — tangential, the speed whose free fall has no radial pull (not Kepler's: the hole's own) — NOW: the autopilot (the hub's CIRC)", [seg], () => {
        if (where === "now") {
          const e = this.host.engage("circularize");
          this.host.say(e ?? "Circularize: the autopilot (the hub's CIRC)");
          return null;
        }
        return this.host.kerrOp("circ", where);
      });
      const fin = (x: number) => (Number.isFinite(x) ? x : 0);
      const ap = numField("Apoapsis", Math.round(fin(o?.ra ?? k.r) * 1.5), "M", 1, () => {}, { min: 2, digits: 1 });
      this.op("Apoapsis", "A burn at the periapsis: the far side put there — found on the real path (it precesses)", [ap.el], () => this.host.kerrOp("ap", ap.get()));
      const pe = numField("Periapsis", Math.round(fin(o?.rp ?? k.r) * 0.8), "M", 1, () => {}, { min: 0.5, digits: 1 });
      this.op("Periapsis", "A burn at the apoapsis: the near side put there — inside the horizon, a plunge", [pe.el], () => this.host.kerrOp("pe", pe.get()));
      const ho = numField("Radius", Math.round(k.r * 2), "M", 1, () => {}, { min: 2, digits: 1 });
      this.op("Hohmann transfer", "From the periapsis (to rise) or the apoapsis (to fall), the far apsis there, circularized on arrival — not below the ISCO", [ho.el], () => this.host.kerrOp("hohmann", ho.get()));
      const inc = numField("Inclination", o ? (o.inc * 180) / Math.PI : 0, "°", 1, () => {}, { min: 0, max: 180, digits: 1 });
      this.op("Inclination", "To the equator — the disk's, the worlds' — turned at the cheaper crossing of the new plane (0°: into the disk)", [inc.el], () => this.host.kerrOp("inc", inc.get()));
      const rs = numField("Period ×", 1.5, "", 0.25, () => {}, { min: 0.2, max: 20, digits: 3 });
      this.op("Resonant orbit", "The period a ratio of this one's — back where it is every few turns — on the geodesic's own clock", [rs.el], () => this.host.kerrOp("res", rs.get()));
    } else if (t === "target") {
      this.autoOp("approach", "Approach the target", "Flies to the target and stops beside it, station-keeping — the hub's APPROACH");
      this.autoOp("hover", "Hold position", "Kills the speed relative to the hole's frame and holds the place — the hub's HOLD POS");
      this.body.append(h("div", "fc-tgt", `Target: ${k.target ? BODY_NAMES[k.target as keyof typeof BODY_NAMES] ?? k.target : "—"}`));
      this.op("Match planes", "The orbit turned into the target's plane (a world's, the companion's) where it crosses it", [], () => this.host.kerrOp("plane"));
      // (a rendezvous, the wormhole: the MISSION tab's planner — previewed before it is flown)
      const mission = (target: string, orbit: boolean) => () => {
        this.result.replaceChildren(h("div", "fc-busy", "Planning on the geodesics…"));
        void this.host.missionPlan({ target, orbit }).then((r) => {
          if (this.tab !== "target") return;
          if (!r.ok) return r.note ? this.preview({ ok: false, note: r.note, burns: [], dvTotal: 0 }) : this.result.replaceChildren();
          this.preview({ ok: true, note: r.note, burns: r.burns, dvTotal: r.dvTotal, afterText: r.afterText, mission: true });
        });
        return null;
      };
      const tg = k.target && k.target !== "hole" && k.target !== "barycentre" && k.target !== "wormhole" ? k.target : null;
      if (tg) {
        this.op("Orbit the target", "The apsis burn timed for it to be there, a velocity match at the closest approach, then in orbit about it", [], mission(tg, true));
        this.op("Rendezvous", "The same, then beside it, station-keeping", [], mission(tg, false));
      }
      this.op("The wormhole", "A 3-D burn aimed by Newton's method at the mouth's centre", [], mission("wormhole", false));
    } else this.body.append(h("div", "fc-empty", "About Gargantua: ORBIT and TARGET (Kerr's geodesics)"));
  }

  /** A planned operation, before it is flown: its burns, the orbit after, the budget; its porkchop. */
  private preview(r: OpResult) {
    this.result.replaceChildren();
    if (!r.ok) {
      this.host.preview(null, "");
      this.result.append(h("div", "fc-err", r.note));
      return;
    }
    // (its path on the maps at once — the operation previewed, not yet the plan; a mission: its own,
    // already there)
    if (!r.mission) this.host.preview(r.burns, r.note);
    const c = this.host.context();
    const B = this.host.budget();
    const card = h("div", "fc-card");
    card.append(h("div", "fc-card-t", r.note));
    const tab = h("table", "fc-burns");
    // (about the hole the burns are fractions of c: their parts in km/s)
    const big = r.burns.some((b) => len(b.dv) >= 1e5);
    // (the normal and radial columns only when a burn has them)
    const top = Math.max(...r.burns.map((b) => len(b.dv)), 1e-9);
    const tiny = (k: number) => r.burns.every((b) => Math.abs(b.dv[k]) < 0.02 * top);
    const showN = !tiny(1), showR = !tiny(2);
    const col = (on: boolean, x: string) => (on ? x : "");
    tab.innerHTML = `<tr><th>${big ? "km/s" : ""}</th><th>T−</th><th>PRO</th>${col(showN, "<th>NRM</th>")}${col(showR, "<th>RAD</th>")}<th>|Δv|</th><th>BURN</th></tr>` + r.burns.map((b, i) =>
      `<tr><td>◆${i + 1} ${b.label}</td><td>${dur(b.t)}</td><td>${part(b.dv[0], big)}</td>${col(showN, `<td>${part(b.dv[1], big)}</td>`)}${col(showR, `<td>${part(b.dv[2], big)}</td>`)}<td><b>${big ? part(len(b.dv), true) : ms(len(b.dv))}</b></td><td>${B.accel > 0 ? dur(len(b.dv) / B.accel) : "—"}</td></tr>`).join("");
    card.append(tab);
    const a = r.after;
    if (a && c) {
      const R = c.ctx.R;
      card.append(h("div", "fc-after", `After: Pe ${km(a.rp - R)} · Ap ${km(a.ra - R)} · i ${(a.i * D).toFixed(2)}° · e ${a.e.toFixed(4)} · T ${dur(a.T)}`));
    } else if (r.afterText) card.append(h("div", "fc-after", r.afterText));
    const ok = r.dvTotal <= B.dv;
    const bar = h("div", "fc-budget");
    bar.innerHTML = `<i><b style="width:${Number.isFinite(B.dv) ? Math.min(100, (r.dvTotal / Math.max(B.dv, 1e-9)) * 100) : 0}%" class="${ok ? "" : "hot"}"></b></i><span>${ms(r.dvTotal)}${Number.isFinite(B.dv) ? ` of ${ms(B.dv)} left` : " · no propellant gauge"}</span>`;
    card.append(bar);
    if (r.grid) card.append(this.porkchop(r.grid));
    const row = h("div", "fc-row");
    const fly = h("button", "fc-go fc-exec", "EXECUTE");
    const adopt = () => (r.mission ? this.host.missionCommit() : this.host.setPlan(r.burns, r.note));
    fly.onclick = () => {
      const e = adopt() ?? this.host.execute();
      this.host.say(e ?? `Executing: ${r.note}`);
    };
    const set = h("button", "fc-go", "TO THE PLAN");
    set.onclick = () => this.host.say(adopt() ?? `Planned: ${r.note} — the map shows it (EXECUTE, or edit the burns)`);
    const no = h("button", "fc-go fc-no", "DISCARD");
    no.onclick = () => {
      this.result.replaceChildren();
      this.host.preview(null, "");
    };
    row.append(fly, set, no);
    card.append(row);
    this.result.append(card);
    this.pending = c ? { r, ctx: c.ctx } : null;
  }

  /** The porkchop: Δv over departure × flight time (log colour), the best marked; a click there plans it. */
  private porkchop(g: Porkchop) {
    const W = 300, H = 170;
    const cv = h("canvas", "fc-pork");
    const dpr = devicePixelRatio;
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;
    const ctx = cv.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const nD = g.dep.length, nT = g.tof.length;
    const vals = g.dv.flat().filter(Number.isFinite);
    const lo = Math.log(Math.min(...vals)), hi = Math.log(Math.min(Math.max(...vals), Math.min(...vals) * 8));
    const L = 34, B = 18;
    const cw = (W - L) / nD, ch = (H - B) / nT;
    for (let i = 0; i < nD; i++) for (let j = 0; j < nT; j++) {
      const v = g.dv[i]![j]!;
      const x = Number.isFinite(v) ? Math.min(Math.max((Math.log(v) - lo) / (hi - lo), 0), 1) : 1;
      // (cool to hot: the cheap blue-white, the dear dark red)
      const r = Math.round(255 * Math.min(1, 0.15 + 1.6 * x)), gg = Math.round(255 * Math.max(0, 0.9 - 1.1 * x) ** 0.8), b = Math.round(255 * Math.max(0, 1 - 1.8 * x));
      ctx.fillStyle = Number.isFinite(v) ? `rgb(${r},${gg},${b})` : "#111";
      ctx.fillRect(L + i * cw, (nT - 1 - j) * ch, cw + 0.6, ch + 0.6);
    }
    const bx = L + (g.best.i + 0.5) * cw, by = (nT - 1 - g.best.j + 0.5) * ch;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bx, by, 5, 0, 2 * Math.PI);
    ctx.moveTo(bx - 9, by);
    ctx.lineTo(bx + 9, by);
    ctx.moveTo(bx, by - 9);
    ctx.lineTo(bx, by + 9);
    ctx.stroke();
    ctx.fillStyle = "rgba(205,220,240,0.85)";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.fillText("departure →", L + 4, H - 5);
    ctx.save();
    ctx.translate(11, H - B - 4);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("flight →", 0, 0);
    ctx.restore();
    ctx.fillText(`${dur(g.dep[nD - 1]!)}`, W - 52, H - 5);
    const wrap = h("div", "fc-porkw");
    wrap.append(h("div", "fc-pork-t", `PORKCHOP · best ${ms(g.dv[g.best.i]![g.best.j]!)} — click a cell to fly it`), cv);
    cv.onclick = (e) => {
      const rc = cv.getBoundingClientRect();
      const i = Math.floor((e.clientX - rc.left - L) / cw), j = nT - 1 - Math.floor((e.clientY - rc.top) / ch);
      if (i < 0 || i >= nD || j < 0 || j >= nT || !this.pending) return;
      const x = this.pending.ctx;
      const res = transferAt(x, g.dep[i]!, g.tof[j]!, this.pending.r.burns.length > 1);
      if (res) this.preview({ ...res, grid: { ...g, best: { i, j } } });
    };
    return wrap;
  }

  /** Each frame: the analysis (a few times a second). */
  update() {
    if (!this.shown) return;
    const now = performance.now();
    if (now - this.lastInfo < 250) return;
    this.lastInfo = now;
    this.syncAutos();
    const c = this.host.context();
    const k = this.host.kerr();
    const sig = `${c?.body}|${c?.targetName}|${!!k}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.setTab(this.tab);
    }
    if (this.tab === "land" && this.landRefresh && now - this.landAt > 2000) {
      this.landAt = now;
      this.landRefresh();
    }
    this.ctxLine.textContent = c ? `${c.bodyName}${c.targetName ? ` · target ${c.targetName}` : ""}` : k ? "Gargantua · Kerr geodesics" : "far from any body";
    const E = this.infoEls;
    if (c) {
      const x = c.ctx;
      const el = elements(x.mu, x.r, x.v, x.pole);
      const R = x.R;
      const nd = nodesAgainst(el, x.pole ?? [0, 0, 1]);
      const rows: [string, string][] = [
        ["Apoapsis", `${km(el.ra - R)} · T− ${dur(el.e < 1 ? timeTo(el, Math.PI) : Infinity)}`],
        ["Periapsis", `${km(el.rp - R)} · T− ${dur(timeTo(el, 0))}`],
        ["Altitude", km(len(x.r) - R)],
        ["Speed", ms(len(x.v))],
        ["Period", dur(el.T)],
        ["a · e", `${km(el.a)} · ${el.e.toFixed(5)}`],
        ["Inclination", `${(el.i * D).toFixed(3)}°`],
        ["Node · periapsis", `${(el.raan * D).toFixed(2)}° · ${(el.argp * D).toFixed(2)}°`],
        ["True anomaly", `${(el.nu * D).toFixed(2)}°`],
        ["Equator AN · DN", nd ? `T− ${dur(timeTo(el, nd.an))} · ${dur(timeTo(el, nd.dn))}` : "—"],
      ];
      E.orbit!.innerHTML = rows.map(([a, b]) => `<div class="fc-kv"><span>${a}</span><b>${b}</b></div>`).join("");
      const rel = x.target ? relation(x) : null;
      E.target!.innerHTML = rel
        ? [
          ["Target", c.targetName ?? ""], ["Distance", km(rel.distance)], ["Relative speed", ms(rel.vRel)],
          ["Rel. inclination", `${(rel.relInc * D).toFixed(3)}°`], ["To AN · DN", `${dur(rel.toAN)} · ${dur(rel.toDN)}`],
          ["Phase angle", `${(rel.phase * D).toFixed(1)}° (Hohmann: ${(rel.phaseWant * D).toFixed(1)}°)`], ["Window", `T− ${dur(rel.window)}`],
          ["Synodic period", dur(rel.synodic)], ["Closest approach", `${km(rel.ca.dist)} in ${dur(rel.ca.t)}`],
        ].map(([a, b]) => `<div class="fc-kv"><span>${a}</span><b>${b}</b></div>`).join("")
        : `<div class="fc-empty">${c.targetName ? `${c.targetName}: not about ${c.bodyName}` : "No target"}</div>`;
    } else if (k && this.host.kerrInfo()) {
      // about the hole: the orbit as its geodesic has it
      const I = this.host.kerrInfo()!;
      const o = I.o;
      const tm = (t: number) => (Number.isFinite(t) ? `T− ${dur((t - I.t) * I.Msec)}` : "—");
      const rows: [string, string][] = [
        ["Periapsis", `${rM(o.rp, I.Mm)} · ${tm(o.tPe)}`],
        ["Apoapsis", o.fate === "escape" ? "— (an escape)" : `${rM(o.ra, I.Mm)} · ${tm(o.tAp)}`],
        ["Radius", rM(o.rNow, I.Mm)],
        ["Period", Number.isFinite(o.T) ? `${dur(o.T * I.Msec)} (${o.T.toFixed(0)} M)` : "—"],
        ["Radial period", Number.isFinite(o.Tr) ? `${dur(o.Tr * I.Msec)} · periapsis +${(o.advance * D).toFixed(1)}°/turn` : "— (circular)"],
        ["Inclination", `${(o.inc * D).toFixed(3)}° · ${o.prograde ? "prograde" : "retrograde"}`],
        ["Equator crossings", o.tNodes.length ? o.tNodes.map(tm).join(" · ") : "—"],
        ["ISCO · horizon", `${isco(o.prograde ? Math.abs(I.a) : -Math.abs(I.a)).toFixed(2)} M · ${horizon(I.a).toFixed(2)} M`],
        ["Fate", o.fate === "horizon" ? "into the horizon" : o.fate === "escape" ? "an escape" : "bound"],
      ];
      E.orbit!.innerHTML = rows.map(([a, b]) => `<div class="fc-kv"><span>${a}</span><b>${b}</b></div>`).join("");
      E.target!.innerHTML = `<div class="fc-empty">${k.target && k.target !== "hole" ? `Target: ${BODY_NAMES[k.target as keyof typeof BODY_NAMES] ?? k.target}` : "No target"}</div>`;
    } else {
      E.orbit!.innerHTML = `<div class="fc-empty">${k ? `About Gargantua: r = ${k.r.toFixed(2)} M (the map's apsides)` : "Far from any body"}</div>`;
      E.target!.innerHTML = "";
    }
    const B = this.host.budget();
    const P = this.host.plan();
    const need = P ? P.burns.reduce((a, b) => a + len(b.dv), 0) : 0;
    E.budget!.innerHTML = `<div class="fc-budget"><i><b style="width:${Number.isFinite(B.dv) ? Math.min(100, (need / Math.max(B.dv, 1e-9)) * 100) : 0}%" class="${need > B.dv ? "hot" : ""}"></b></i><span>${Number.isFinite(B.dv) ? `${ms(B.dv)} left` : "no gauge"} · plan ${ms(need)} · ${(B.accel / G0).toFixed(2)} g</span></div>`;
    this.drawPlan(P);
  }

  private planSig = "";
  /** The plan's burns, each editable: its time, its prograde, normal and radial parts; snapped to the
   *  apsides and nodes; deleted. */
  private drawPlan(P: { burns: Burn[]; note: string; executing: boolean } | null) {
    const E = this.infoEls.plan!;
    const sig = P ? `${P.note}|${P.executing}|${P.burns.map((b) => b.dv.map((x) => x.toFixed(2)).join(",") + "@" + Math.round(b.t / 5)).join(";")}` : "none";
    if (sig === this.planSig) return;
    this.planSig = sig;
    E.replaceChildren();
    if (!P || !P.burns.length) {
      E.append(h("div", "fc-empty", "No burns planned"));
      return;
    }
    E.append(h("div", "fc-note", P.note + (P.executing ? " · EXECUTING" : "")));
    this.sel = Math.min(this.sel, P.burns.length - 1);
    const list = h("div", "fc-nodes");
    P.burns.forEach((b, i) => {
      const r = h("button", "fc-node" + (i === this.sel ? " on" : ""));
      r.innerHTML = `<b>◆${i + 1}</b><span>T− ${dur(b.t)}</span><span>${ms(len(b.dv))}</span><small>${b.label}</small>`;
      r.onclick = () => {
        this.sel = i;
        this.planSig = "";
      };
      list.append(r);
    });
    E.append(list);
    const b = P.burns[this.sel]!;
    // (the hole's burns in km/s)
    const f = P.burns.some((x) => len(x.dv) >= 1e5) ? 1000 : 1;
    const edit = (k: number) => (v: number) => {
      const nb = P.burns.map((x) => ({ ...x, dv: [...x.dv] as V3 }));
      // (edited by hand: flown as given, its goal dropped)
      delete nb[this.sel]!.goal;
      if (k < 3) nb[this.sel]!.dv[k] = v * f;
      else nb[this.sel]!.t = Math.max(v * 60, 0);
      this.host.setPlan(nb, P.note);
      this.planSig = "";
    };
    const box = h("div", "fc-insp");
    box.append(
      numField("Prograde", b.dv[0] / f, f > 1 ? "km/s" : "m/s", 1, edit(0), { digits: 2 }).el,
      numField("Normal", b.dv[1] / f, f > 1 ? "km/s" : "m/s", 1, edit(1), { digits: 2 }).el,
      numField("Radial", b.dv[2] / f, f > 1 ? "km/s" : "m/s", 1, edit(2), { digits: 2 }).el,
      numField("Time", b.t / 60, "min", 1, edit(3), { digits: 2, min: 0 }).el,
    );
    // (snapped to where the orbit is then: its apsides, its equator's nodes, a turn on or back)
    const c = this.host.context();
    const I = c ? null : this.host.kerrInfo();
    const snaps = h("div", "fc-seg fc-snap");
    if (I) {
      // (about the hole: the geodesic's own apsides and equator crossings, its radial period)
      const s = (t: number) => (t - I.t) * I.Msec;
      const opts: [string, number][] = [["AP", s(I.o.tAp)], ["PE", s(I.o.tPe)], ...I.o.tNodes.map((t, i) => [i ? "NODE 2" : "NODE", s(t)] as [string, number])];
      // (a turn: the radial period — back at the same apsis —, the orbital one for a circle)
      const turn = Number.isFinite(I.o.Tr) ? I.o.Tr : I.o.T;
      if (Number.isFinite(turn)) opts.push(["+1 ORBIT", b.t + turn * I.Msec], ["−1 ORBIT", b.t - turn * I.Msec]);
      for (const [l, t] of opts) {
        if (!Number.isFinite(t) || t < 0) continue;
        const bt = h("button", "", l);
        bt.onclick = () => edit(3)(t / 60);
        snaps.append(bt);
      }
    }
    if (c) {
      const el = elements(c.ctx.mu, c.ctx.r, c.ctx.v, c.ctx.pole);
      const nd = nodesAgainst(el, c.ctx.pole ?? [0, 0, 1]);
      const opts: [string, number][] = [["AP", el.e < 1 ? timeTo(el, Math.PI) : NaN], ["PE", timeTo(el, 0)]];
      if (nd) opts.push(["AN", timeTo(el, nd.an)], ["DN", timeTo(el, nd.dn)]);
      if (Number.isFinite(el.T)) opts.push(["+1 ORBIT", b.t + el.T], ["−1 ORBIT", b.t - el.T]);
      for (const [l, t] of opts) {
        if (!Number.isFinite(t) || t < 0) continue;
        const bt = h("button", "", l);
        bt.onclick = () => edit(3)(t / 60);
        snaps.append(bt);
      }
    }
    const row = h("div", "fc-row");
    const ex = h("button", "fc-go fc-exec", P.executing ? "EXECUTING…" : "EXECUTE");
    ex.onclick = () => this.host.say(this.host.execute() ?? "Executing the plan");
    const del = h("button", "fc-go", "DELETE BURN");
    del.onclick = () => {
      const nb = P.burns.filter((_, i) => i !== this.sel);
      if (nb.length) this.host.setPlan(nb, P.note);
      else this.host.clear();
      this.planSig = "";
    };
    const clr = h("button", "fc-go fc-no", "CLEAR");
    clr.onclick = () => {
      this.host.clear();
      this.planSig = "";
    };
    row.append(ex, del, clr);
    E.append(box, snaps, row);
  }
}

/** A transfer flown at a chosen departure and flight time (a porkchop's cell). */
function transferAt(c: FcContext, dep: number, tof: number, rendezvous: boolean): OpResult | null {
  const T = c.target;
  if (!T) return null;
  const { lambert, propagate, toPNR, add, unit, cross } = kep;
  const s = propagate(c.mu, c.r, c.v, dep);
  const tg = propagate(c.mu, T.r, T.v, dep + tof);
  const L = lambert(c.mu, s.r, tg.r, tof, unit(cross(c.r, c.v)));
  if (!L) return null;
  const burns: Burn[] = [{ t: dep, dv: toPNR(s.r, s.v, add(L.v1, s.v, -1)), label: "departure" }];
  if (rendezvous) burns.push({ t: dep + tof, dv: toPNR(tg.r, L.v2, add(tg.v, L.v2, -1)), label: "match" });
  return { ok: true, note: `${rendezvous ? "Rendezvous" : "Intercept"} with ${T.name}: departing in ${dur(dep)}, ${dur(tof)} of flight`, burns, dvTotal: burns.reduce((a, b) => a + len(b.dv), 0) };
}

export type { Elements };
