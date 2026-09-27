// The game's tools, for the interface (F2) and for code (__bh.game in the console): the Ranger's
// state, placing it (in orbit around any body, on a ground, at a state), the target, the spheres of
// influence, time and warp, every setting, saved games, the audit and the journal.
//
//   __bh.game.help()                               what is there
//   __bh.game.status()                             side, sphere of influence, what the ship does, orbit, target
//   __bh.game.orbit("mars", { altKm: 300, inc: 25 })
//   __bh.game.land("moon", 0.67, 23.47)            Apollo 11's site
//   __bh.game.target("saturn")
//   __bh.game.save("before TMI"); __bh.game.load("before TMI")
//   await __bh.game.audit({ planner: true })

import type { Settings, Target } from "../settings";
import { defaultSettings } from "../settings";
import type { CameraController } from "../controls";
import type { Renderer } from "../renderer";
import { setHolePose, setHomePose } from "../camera";
import { BODY_NAMES } from "../targeting";
import { EPOCH_DATE, M_METRES, M_SECONDS, SOLAR_BODIES, solarBody, solarState } from "../system/solar";
import { soiOf } from "../system/our-side";
import { GARGANTUA_SYSTEM } from "../system/bodies";
import { rangerStatus, type RangerStatus } from "./status";
import { ourGroundPose, ourOrbitPose, theirOrbitPose, universeOf, defaultAltKm, OUR_IDS, THEIR_IDS, type OrbitPlacement, type Pose } from "./place";
import { autosave, downloadSave, parseSave, saveToHash, slots, type GameSave } from "./save";
import { gameLog } from "./log";
import { runAudit, type AuditReport } from "./audit";
import type { V3 } from "./orbit";

export interface GameContext {
  settings: Settings;
  camera: CameraController;
  renderer: Renderer;
  time(): number;
  setTime(t: number): void;
  preset(name: string): void;
  /** settings changed (routed like the panel's: re-trace, resize…) */
  changed(keys: (keyof Settings)[]): void;
  /** many things changed (a placement, a loaded game): the panel, the view, the camera redrawn */
  refresh(): void;
  toast(text: string): void;
  fps(): number;
}

const KM = 1e3 / M_METRES;
const nameOf = (id: string) => (BODY_NAMES as Record<string, string>)[id] ?? solarBody(id)?.name ?? GARGANTUA_SYSTEM.bodies.find((b) => b.id === id)?.name ?? id;

/** The scene's date at time t [M] */
export const dateOf = (t: number) => new Date(EPOCH_DATE + t * M_SECONDS * 1e3);
export const fmtDate = (t: number) => dateOf(t).toISOString().slice(0, 16).replace("T", " ");

export class GameTools {
  readonly log = gameLog;
  private errors: string[] = [];
  private lastStatus: { soi: string; status: string } | null = null;
  lastAudit: AuditReport | null = null;

  constructor(private ctx: GameContext) {
    addEventListener("error", (e) => this.error((e as ErrorEvent).message));
    addEventListener("unhandledrejection", (e) => this.error(String((e as PromiseRejectionEvent).reason)));
  }

  private error(msg: string) {
    this.errors.push(msg);
    this.log.add("error", msg, this.ctx.time());
  }

  /** What is there (a list of the tools, for the console). */
  help() {
    const lines = [
      "status()                      the Ranger: side, sphere of influence, landed/orbit/escape, orbit, target, next event",
      "bodies('ours'|'gargantua')    the bodies: radius, sphere of influence, distance from the ship",
      "soi()                         the sphere of influence the ship is in, and the chain of its primaries",
      "orbit(body, {altKm, peKm, apKm, inc, raan, argPe, nu, retrograde})   put the Ranger in orbit",
      "land(body, lat, lon)          put it on the ground (our solid bodies)",
      "placeAt({frame, X, vel, fwd, up})   put it at a state (home frame / the hole's map)",
      "target(id) · targets()        select the target",
      "warp(x) · pause(on) · realTime()   time: x times real time",
      "setDate('2067-03-01T12:00') · date()   the scene's clock (the bodies move; the ship keeps its place)",
      "set(key, value) · get(key) · settings()   any setting (see the panel, Game section)",
      "preset(name)                  a scene",
      "save(name) · load(name) · saves() · deleteSave(name) · exportSave(name) · importSave(json) · shareLink()",
      "audit({planner})              run the self-checks (await it)",
      "log.events · log.text()       the journal",
    ];
    console.log(lines.join("\n"));
    return lines;
  }

  // ------------------------------------------------------------------------------ state
  status(): RangerStatus {
    const c = this.ctx.camera;
    return rangerStatus(this.ctx.settings, c, c.flightInfo(), this.ctx.time());
  }

  /** Called every HUD tick: journal the changes of sphere of influence and of status. */
  watch(st: RangerStatus) {
    const prev = this.lastStatus;
    if (prev && prev.soi !== st.soi) this.log.add("soi", `Sphere of influence: ${nameOf(prev.soi)} → ${st.soiName}`, this.ctx.time());
    if (prev && prev.status !== st.status && prev.soi === st.soi) this.log.add("status", `${st.soiName}: ${st.label}`, this.ctx.time());
    this.lastStatus = { soi: st.soi, status: st.status };
  }

  date() {
    return fmtDate(this.ctx.time());
  }

  /** The pilot's modes in a line. */
  pilotState() {
    const c = this.ctx.camera, p = c.pilot;
    if (!c.piloting) return "not flying (the Ranger off)";
    const parts = [p.sas ? "SAS" : "SAS off"];
    if (p.hold !== "none") parts.push(`hold ${p.hold}`);
    if (p.auto !== "none") parts.push(`auto ${p.auto}`);
    parts.push(`throttle ${Math.round(100 * p.throttle)} %`);
    if (c.plan.nodes.length) parts.push(`${c.plan.nodes.length} node${c.plan.nodes.length > 1 ? "s" : ""}`);
    if (c.landed) parts.push("landed");
    return parts.join(" · ");
  }

  /** The bodies of a universe (default: the ship's) with their spheres of influence and distances. */
  bodies(universe?: "ours" | "gargantua") {
    const st = this.status();
    const u = universe ?? (st.side === "ours" ? "ours" : "gargantua");
    const t = this.ctx.time();
    const info = this.ctx.camera.flightInfo();
    if (u === "ours") {
      return SOLAR_BODIES.map((b) => {
        const P = solarState(b.id, t).pos;
        const d = info.ref && info.X ? Math.hypot(P[0] - info.X[0], P[1] - info.X[1], P[2] - info.X[2]) / KM : NaN;
        return { id: b.id, name: b.name, parent: b.parent, radiusKm: b.radius / KM, soiKm: soiOf(b.id, t) / KM, distKm: d, altKm: d - b.radius / KM };
      });
    }
    return GARGANTUA_SYSTEM.bodies.filter((b) => b.universe === "gargantua").map((b) => ({ id: b.id, name: b.name, parent: b.parent, radiusKm: (b.radius * 1476.625 * this.ctx.settings.massSolar) / 1e3 }));
  }

  /** The sphere of influence the ship is in, and its primaries up to the Sun (our side). */
  soi() {
    const st = this.status();
    const t = this.ctx.time();
    const chain: { id: string; name: string; soiKm: number }[] = [];
    let id: string | null = st.soi;
    while (id && universeOf(id) === "ours") {
      chain.push({ id, name: nameOf(id), soiKm: soiOf(id, t) / KM });
      id = solarBody(id)?.parent ?? null;
    }
    return { body: st.soi, name: st.soiName, soiKm: st.soiKm, altKm: st.altKm, chain };
  }

  // ------------------------------------------------------------------------------ placing
  /** The Ranger on, flying (the ship shown, the flight controls). */
  private shipOn() {
    const s = this.ctx.settings;
    if (!s.ship) {
      s.ship = true;
      this.ctx.changed(["ship"]);
    }
  }

  /** Puts the Ranger at a pose (see place.ts) and restarts its flight there. */
  placeAt(p: Pose) {
    const s = this.ctx.settings, c = this.ctx.camera;
    this.shipOn();
    if (p.frame === "ours") {
      if (!s.wormhole) throw new Error("our universe is reached through the wormhole: pick a Gargantua-system scene (game:interstellar)");
      setHomePose(s, p.X, p.fwd, p.up, p.vel);
      s.anchor = "wormhole";
    } else setHolePose(s, p.X, p.fwd, p.up, p.vel);
    s.motion = "geodesic";
    c.setCinematic(null);
    c.setPilot(true);
    c.setOurLanded(p.landed ?? null);
    c.sync();
    this.ctx.refresh();
    this.log.add("place", p.note, this.ctx.time());
    this.ctx.toast(p.note);
    return p.note;
  }

  /** In orbit around a body (ours or Gargantua's side; the hole: `rM` its radius in M). */
  orbit(body: string, o: Omit<OrbitPlacement, "body"> & { rM?: number } = {}) {
    const u = universeOf(body);
    if (!u) throw new Error(`unknown body "${body}" — ours: ${OUR_IDS.join(", ")}; Gargantua's: ${THEIR_IDS.join(", ")}`);
    const s = this.ctx.settings, t = this.ctx.time();
    if (u === "gargantua" && !(s.system === "gargantua")) throw new Error("Gargantua's planets live in the Gargantua-system scenes");
    const pose = u === "ours" ? ourOrbitPose({ body, ...o }, t) : theirOrbitPose({ body, ...o }, t, s.spin, s.massSolar);
    const note = this.placeAt(pose);
    if (s.target === body) this.target(u === "ours" && body !== "sun" ? "sun" : "hole");
    return note;
  }

  /** On the ground of one of our solid bodies, at latitude and east longitude [°]. */
  land(body: string, lat = 0, lon = 0) {
    return this.placeAt(ourGroundPose(body, lat, lon, this.ctx.time()));
  }

  /** In orbit around the current target (its default altitude). */
  orbitTarget(altKm?: number) {
    const tgt = String(this.ctx.settings.target);
    return this.orbit(tgt === "hole" ? "gargantua" : tgt, { altKm: altKm ?? (universeOf(tgt) === "ours" ? defaultAltKm(tgt) : undefined) });
  }

  // ------------------------------------------------------------------------------ target, time, settings
  target(id: string) {
    const ok = this.ctx.camera.selectTarget(id as Target, { focus: false });
    if (!ok) throw new Error(`${nameOf(id)} is not in this universe`);
    this.ctx.refresh();
    return `Target: ${nameOf(id)}`;
  }
  targets() {
    const st = this.status();
    return st.side === "ours" ? [...SOLAR_BODIES.map((b) => b.id), "wormhole"] : ["hole", "miller", "mann", "k2", "edmunds", "wormhole"];
  }

  /** x times real time (0: pause) */
  warp(x: number) {
    const s = this.ctx.settings;
    if (x <= 0) return this.pause(true);
    s.timeSpeed = x / (4.925490947e-6 * s.massSolar);
    s.animate = true;
    this.ctx.changed(["timeSpeed", "animate"]);
    return `Warp ×${x}`;
  }
  realTime() {
    return this.warp(1);
  }
  pause(on = true) {
    this.ctx.settings.animate = !on;
    this.ctx.changed(["animate"]);
    return on ? "Paused" : "Running";
  }
  /** The scene's clock to a date (ISO) or a time [M]; the bodies move, the ship keeps its place. */
  setDate(d: string | number) {
    const t = typeof d === "number" ? d : (Date.parse(d.endsWith("Z") ? d : `${d}Z`) - EPOCH_DATE) / 1e3 / M_SECONDS;
    if (!Number.isFinite(t)) throw new Error(`not a date: ${d}`);
    this.ctx.setTime(t);
    this.log.add("info", `Clock set to ${fmtDate(t)}`, t);
    return fmtDate(t);
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.ctx.settings[key];
  }
  set<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (!(key in this.ctx.settings)) throw new Error(`no setting "${String(key)}"`);
    this.ctx.settings[key] = value;
    this.ctx.changed([key]);
    return value;
  }
  settings() {
    return { ...this.ctx.settings };
  }
  preset(name: string) {
    this.ctx.preset(name);
    this.log.add("info", `Scene: ${name}`, this.ctx.time());
  }

  // ------------------------------------------------------------------------------ saved games
  snapshot(name = "autosave"): GameSave {
    const c = this.ctx.camera, s = this.ctx.settings;
    let summary = "";
    try {
      const st = this.status();
      const alt = Number.isFinite(st.altKm) && st.side === "ours" ? ` ${st.altKm >= 1e5 ? `${(st.altKm / 1.496e8).toFixed(2)} AU` : `${Math.round(st.altKm)} km`}` : "";
      summary = `${st.soiName} · ${st.label}${alt} · ${fmtDate(this.ctx.time())}`;
    } catch {
      summary = fmtDate(this.ctx.time());
    }
    const L = c.ourLandedOn;
    return {
      v: 1, name, savedAt: Date.now(), summary, settings: { ...s }, time: this.ctx.time(),
      ship: {
        piloting: c.piloting, sas: c.pilot.sas, hold: c.pilot.hold, auto: c.pilot.auto, throttle: c.pilot.throttle, precision: c.pilot.precision,
        speedMode: c.speedMode, landed: L ? { body: L.body, q: [...L.q] as V3 } : null, spent: c.spent, properTime: c.properTime,
      },
      plan: c.plan.nodes.length ? { nodes: c.plan.nodes.map((n) => ({ ...n })), note: c.plan.note, mission: c.ourMission } : null,
    };
  }

  /** Restores a saved game (a slot's name, or the save itself). */
  load(g: string | GameSave) {
    const save = typeof g === "string" ? (g === "autosave" ? autosave.get() : slots.get(g)) : g;
    if (!save) throw new Error(`no saved game "${g}"`);
    const s = this.ctx.settings, c = this.ctx.camera;
    const pixelRatio = s.pixelRatio;
    Object.assign(s, defaultSettings(), save.settings, { pixelRatio });
    this.ctx.setTime(save.time);
    c.setCinematic(null);
    if (save.ship.piloting && s.ship) {
      c.setPilot(true);
      // (setPilot's own choices — time running, the path shown — give way to the saved ones)
      Object.assign(s, save.settings, { pixelRatio });
      const p = c.pilot;
      p.sas = save.ship.sas;
      p.precision = save.ship.precision;
      p.throttle = save.ship.throttle;
      c.speedMode = save.ship.speedMode;
      c.spent = save.ship.spent;
      c.properTime = save.ship.properTime;
      if (save.plan) {
        c.plan = { nodes: save.plan.nodes, path: null, at: 0, note: save.plan.note };
        c.ourMission = save.plan.mission as typeof c.ourMission;
      }
      p.hold = save.ship.hold;
      if (save.ship.auto !== "none" && (save.ship.auto !== "node" || save.plan)) p.auto = save.ship.auto;
    }
    c.setOurLanded(save.ship.landed);
    c.sync();
    this.ctx.refresh();
    this.log.add("save", `Loaded "${save.name}" — ${save.summary}`, save.time);
    return save.summary;
  }

  save(name?: string) {
    const g = this.snapshot(name?.trim() || `Save ${new Date().toLocaleString()}`);
    if (!slots.put(g)) throw new Error("the browser refused to store it (storage full or private mode)");
    this.log.add("save", `Saved "${g.name}" — ${g.summary}`, g.time);
    return g.name;
  }
  saves() {
    return slots.list().map((g) => ({ name: g.name, summary: g.summary, savedAt: new Date(g.savedAt).toLocaleString() }));
  }
  deleteSave(name: string) {
    slots.remove(name);
    this.log.add("save", `Deleted "${name}"`, this.ctx.time());
  }
  exportSave(name?: string) {
    const g = name ? (name === "autosave" ? autosave.get() : slots.get(name)) : this.snapshot("ranger");
    if (!g) throw new Error(`no saved game "${name}"`);
    downloadSave(g);
    return g.name;
  }
  importSave(json: string, store = true) {
    const g = parseSave(json);
    if (store) slots.put(g);
    return this.load(g);
  }
  /** A link carrying this moment (the plan left out). */
  shareLink() {
    return `${location.origin}${location.pathname}${saveToHash(this.snapshot("shared"))}`;
  }
  autosaveNow() {
    return autosave.set(this.snapshot("autosave"));
  }

  // ------------------------------------------------------------------------------ audit
  async audit(o: { planner?: boolean } = {}) {
    const c = this.ctx.camera, r = this.ctx.renderer;
    const info = c.flightInfo();
    const st = rangerStatus(this.ctx.settings, c, info, this.ctx.time());
    const frames = async (n: number, f: () => Promise<number> | number) => {
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        out.push(await f());
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      }
      return out;
    };
    const rep = await runAudit({
      settings: this.ctx.settings, time: this.ctx.time(), status: st,
      ship: info.ref && info.X && info.V ? { X: info.X as V3, V: info.V as V3, ref: info.ref } : null,
      snapshot: () => this.snapshot("audit"), fps: () => this.ctx.fps(), gpuMs: () => r.lastGpuMs,
      probeSeries: async (n) => (this.ctx.settings.ship && r.shipReady ? frames(n, () => r.readShipLight()) : null),
      evSeries: (n) => frames(n, () => r.autoEV),
      errors: () => this.errors,
    }, o);
    this.lastAudit = rep;
    this.log.add("audit", `Audit: ${rep.counts.pass} pass, ${rep.counts.warn} warn, ${rep.counts.fail} fail, ${rep.counts.skip} skipped`, this.ctx.time(), rep);
    return rep;
  }
}
