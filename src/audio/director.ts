// The sound director: watches the flight every frame and turns what changes into sound — the
// flight computer's beeps (SAS, holds, autopilots, targets, manoeuvre countdowns, spheres of
// influence, landings, alarms) and the thrusters and cabin (continuous, see engine.ts). Also the
// interface's clicks, delegated from the DOM.

import type { Settings } from "../settings";
import type { RangerStatus } from "../game/status";
import { gameLog } from "../game/log";
import { sound, type Cue } from "./engine";

/** The attach points riding on the hull: the camera hears the ship through it (the others: outside). */
const ON_HULL = new Set(["dorsal", "belly", "rear"]);
const HOLDS = ["prograde", "retrograde", "normal", "antinormal", "radialOut", "radialIn", "target", "antiTarget", "maneuver"];

/** What the director reads of the flight (a subset of CameraController.flightInfo()). */
export interface FlightSnapshot {
  sas: boolean;
  hold: string;
  auto: string;
  precision: boolean;
  landed: boolean;
  plan: { nodes: { t: number }[]; burning: boolean; now: number } | null;
  surface: { air: number; vVert: number; vHor: number } | null;
  engine: { fuel: { empty: boolean; fraction: number } | null };
  path: { fate: string } | null;
}

export interface Fired {
  throttle: number;
  rcs: number;
  rcsSide: number;
  turn: number;
  yaw: number;
  at: number;
}

export class SoundDirector {
  private prev: {
    sas: boolean; hold: string; auto: string; precision: boolean; landed: boolean; burning: boolean; soi: string; side: string;
    target: string; mount: string; empty: boolean; low: boolean; toNode: number;
  } | null = null;
  private spin = 0;

  constructor(private s: Settings) {
    this.applyMix();
    // (events that are messages rather than states)
    gameLog.on((e) => {
      if (!this.s.sound) return;
      if (e.kind === "warn" && /crash/i.test(e.text)) sound.play("crash");
      else if (e.kind === "error") sound.play("error");
      else if (e.kind === "pilot" && /^(In orbit|Arrived|Manoeuvre done)/i.test(e.text)) sound.play("arrive");
    });
    // the interface: a click for every button, a breath on hover over the main controls
    addEventListener("pointerdown", (e) => {
      const b = (e.target as HTMLElement | null)?.closest?.("button, [role=tab], .sp-seg button, input[type=checkbox], select");
      if (b && !(b as HTMLButtonElement).disabled) this.cue("click");
    }, { capture: true, passive: true });
    addEventListener("pointerover", (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      const b = t?.closest?.("#toolbar button, .sg-card, .fl-btn");
      if (b && !b.contains(e.relatedTarget as Node | null)) this.cue("hover");
    }, { passive: true });
  }

  /** Volumes from the settings (after a change). */
  applyMix() {
    const s = this.s;
    sound.setMix({ master: s.soundVolume, beeps: s.soundBeeps, engines: s.soundEngines, ambience: s.soundAmbience, ui: s.soundUi }, s.sound);
  }

  cue(c: Cue, arg = 0) {
    if (this.s.sound) sound.play(c, arg);
  }

  /** Every frame. `flying`: the Ranger is piloted and shown; `live`: the simulation's time runs. */
  update(dt: number, o: { flying: boolean; live: boolean; info: FlightSnapshot | null; status: RangerStatus | null; fired: Fired }) {
    const s = this.s;
    const { info, status, flying } = o;
    // ---- continuous: thrusters, cabin, wind
    const fresh = flying && performance.now() - o.fired.at < 300;
    const f = fresh ? o.fired : { throttle: 0, rcs: 0, rcsSide: 0, turn: 0, yaw: 0, at: 0 };
    this.spin += (f.yaw - this.spin) * Math.min(1, dt * 4);
    const sf = info?.surface ?? null;
    sound.update({
      throttle: f.throttle,
      // (turning hard fires the RCS too, as the wheels saturate)
      rcs: Math.max(f.rcs, 0.55 * Math.max(0, f.turn - 0.6) / 0.4),
      rcsPan: f.rcs > 0.05 ? -f.rcsSide : -0.5 * Math.sign(f.yaw),
      spin: this.spin,
      torque: f.turn,
      inside: ON_HULL.has(s.shipMount),
      air: sf ? Math.min(sf.air / 1.225, 2) : 0,
      airspeed: sf ? Math.hypot(sf.vVert, sf.vHor) : 0,
      aboard: flying,
      live: o.live,
    });
    if (!flying || !info) {
      sound.alarm("collision", false);
      sound.alarm("terrain", false);
      this.prev = null;
      return;
    }

    // ---- the flight computer: what changed since the last frame
    const burning = !!info.plan?.burning;
    const fuel = info.engine.fuel;
    const node = info.plan?.nodes[0];
    const toNode = node && info.plan && info.auto === "node" && !burning && s.timeSpeed > 0 ? (node.t - info.plan.now) / s.timeSpeed : Infinity;
    const now = {
      sas: info.sas, hold: info.hold, auto: info.auto, precision: info.precision, landed: info.landed, burning,
      soi: status?.soi ?? "", side: status?.side ?? "", target: s.target, mount: s.shipMount,
      empty: !!fuel?.empty, low: !!fuel && !fuel.empty && fuel.fraction < 0.15, toNode,
    };
    const p = this.prev;
    this.prev = now;
    if (!p) return;
    if (now.sas !== p.sas) this.cue(now.sas ? "sas-on" : "sas-off");
    if (now.hold !== p.hold) now.hold === "none" ? this.cue("hold-off") : this.cue("hold", Math.max(0, HOLDS.indexOf(now.hold)));
    if (now.auto !== p.auto) {
      if (now.auto === "none") this.cue("auto-off");
      else if (now.auto === "takeoff") this.cue("liftoff");
      else this.cue("auto-on");
    }
    if (now.precision !== p.precision) this.cue(now.precision ? "precision-on" : "precision-off");
    if (now.landed && !p.landed) this.cue("touchdown");
    if (now.target !== p.target) this.cue("target");
    if (now.mount !== p.mount) this.cue("mount");
    if (now.side !== p.side && p.side && now.side && now.side !== "throat" && p.side !== "throat") this.cue("wormhole");
    else if (now.soi !== p.soi && p.soi && now.soi) this.cue("soi");
    // a manoeuvre: 5 … 1 before the node (the wall clock's seconds), then the ignition, the cut-off
    for (let k = 5; k >= 1; k--) if (p.toNode > k && now.toNode <= k && now.toNode > k - 1) this.cue("node-tick");
    if (burning && !p.burning) this.cue("node-go");
    if (!burning && p.burning) this.cue("burn-end");
    if (now.low && !p.low) this.cue("error");
    if (now.empty && !p.empty) this.cue("error");
    // alarms: a collision course (the horizon, a body), the ground coming fast
    const impact = status?.next?.kind === "impact" ? status.next.inS : Infinity;
    const horizon = info.path?.fate === "horizon";
    sound.alarm("collision", s.sound && !info.landed && (horizon || impact < 45), "warning");
    const descent = sf && !info.landed && sf.vVert < -12 && Number.isFinite(sf.vVert) && status?.status === "flight";
    sound.alarm("terrain", s.sound && !!descent && !(impact < 45), "caution");
  }
}
