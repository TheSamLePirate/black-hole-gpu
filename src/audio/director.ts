// The sound director: watches the flight every frame and turns what changes into sound — the
// flight computer's beeps (SAS, holds, autopilots, targets, manoeuvre countdowns, spheres of
// influence, landings, alarms) and the thrusters and cabin (continuous, see engine.ts). Also the
// interface's clicks, delegated from the DOM.

import type { Settings } from "../settings";
import { t } from "../i18n";
import type { RangerStatus } from "../game/status";
import { gameLog } from "../game/log";
import { fleet } from "../fleet";
import { GEARS, type GearOut } from "../gear";
import { jetLevel, rcsClusters, type ThrustAsked } from "../jets";
import { VESSELS } from "../vessels";
import { sound, type Cue, type EngineSpace } from "./engine";
import { hapticMix, haptics } from "../input/haptics";
import { airCutoff, centroid, doppler, hearing, radialSpeed, type ShipPose, shipSource, soundSpeed } from "./space";
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
  air?: { heat: number; mach: number; inAir: boolean; g?: number; hull?: number } | null;
  /** the engines' proper acceleration [c²/M] (the load in vacuum) */
  accel?: number;
  engine: { fuel: { empty: boolean; fraction: number } | null };
  path: { fate: string } | null;
  /** the target's and the station port's directions from the eye (the camera's frame: right, up, forward) */
  dirs?: { target: [number, number, number] | null; dock?: [number, number, number] | null };
  /** the docking in reach: to what, the rings' distance [m] */
  dock?: { target: string; range: number } | null;
}

export interface Fired {
  throttle: number;
  rcs: number;
  rcsSide: number;
  turn: number;
  yaw: number;
  at: number;
}

/** The panel's screens from the ear (heard from the cabin's seats): 0.75 m ahead of the eyes, 0.4 m below
 *  (ship frame) — the eye's own place drops out (S·(eye + d) + t = S·d): whatever mount the pose was
 *  taken at — a frame's lag behind a change of vessel or of mount put it metres off. */
function panelFrom(pose: ShipPose): [number, number, number] {
  const d = [0, -0.4, 0.75];
  const c = pose.S.map((row) => row[0] * d[0]! + row[1] * d[1]! + row[2] * d[2]!) as [number, number, number];
  return [c[0], c[1], -c[2]];
}

/** An arrival's message (an orbit reached, a body arrived at, a manoeuvre flown), in English or as translated. */
function arrived(text: string): boolean {
  const heads = ["In orbit around {0}", "Arrived: {0}", "Manoeuvre done"].flatMap((k) => [k, t(k)].map((x) => x.split("{0}")[0]!.trim()));
  return heads.some((h) => h && text.toLowerCase().startsWith(h.toLowerCase()));
}

export class SoundDirector {
  /** the last Mach number (the boom when it crosses 1) */
  private mach = 0;
  private prev: {
    sas: boolean;
    hold: string;
    auto: string;
    precision: boolean;
    landed: boolean;
    burning: boolean;
    soi: string;
    side: string;
    target: string;
    mount: string;
    empty: boolean;
    low: boolean;
    toNode: number;
  } | null = null;
  private spin = 0;
  /** the engine's last distance from the ear [m] (its radial speed: the Doppler) */
  private engDist = Number.NaN;
  private vr = 0;
  /** the wheels' loads last frame, the runway's joints' distance (the vibrations — H5) */
  private wheelsWere: number[] = [];
  private jointDist = 0;
  /** the flown craft's place from a standing listener last frame [m], the listener in its Mach cone (S7) */
  private cone: { p: [number, number, number] | null; inside: boolean } = { p: null, inside: false };
  /** the hull's temperature last frame [K] and its rate, smoothed (the thermal ticks — S4) */
  private hullT = Number.NaN;
  private heating = 0;
  /** the flown craft's thruster clusters (S3), by vessel */
  private clusterCache: { vessel: string; cl: ReturnType<typeof rcsClusters> } | null = null;

  constructor(private s: Settings) {
    this.applyMix();
    // (events that are messages rather than states)
    gameLog.on((e) => {
      // (the vibrations first: felt with the sound off — H5)
      if (e.kind === "pilot" && /^Docked to /.test(e.text)) haptics.impulse("dock");
      else if (e.kind === "pilot" && /^Undocked from /.test(e.text)) haptics.impulse("undock");
      else if (/crash|collapsed|broke up/i.test(e.text)) haptics.impulse("crash");
      if (!this.s.sound) return;
      if (e.kind === "warn" && /crash/i.test(e.text)) sound.play("crash");
      else if (e.kind === "error") sound.play("error");
      // (the messages as said — translated: in French the English prefixes never matched, the chime silent)
      else if (e.kind === "pilot" && arrived(e.text)) sound.play("arrive");
      // (docking: the capture, the hooks, the latches; undocking: the springs — S6)
      else if (e.kind === "pilot" && /^Docked to /.test(e.text)) sound.play("dock");
      else if (e.kind === "pilot" && /^Undocked from /.test(e.text)) sound.play("undock");
    });
    // the interface: a click for every button, a breath on hover over the main controls
    addEventListener(
      "pointerdown",
      (e) => {
        const b = (e.target as HTMLElement | null)?.closest?.("button, [role=tab], .sp-seg button, input[type=checkbox], select");
        if (b && !(b as HTMLButtonElement).disabled) this.cue("click");
      },
      { capture: true, passive: true },
    );
    addEventListener(
      "pointerover",
      (e: PointerEvent) => {
        const t = e.target as HTMLElement | null;
        const b = t?.closest?.("#toolbar button, .sg-card, .fl-btn");
        if (b && !b.contains(e.relatedTarget as Node | null)) this.cue("hover");
      },
      { passive: true },
    );
  }

  /** Volumes from the settings (after a change). */
  applyMix() {
    const s = this.s;
    sound.setHeadphones(!!s.soundHeadphones);
    haptics.intensity = s.haptics ?? 0.6;
    sound.setMix(
      {
        master: s.soundVolume,
        beeps: s.soundBeeps,
        engines: s.soundEngines,
        ambience: s.soundAmbience,
        ui: s.soundUi,
        voice: s.soundVoice ?? 0.9,
        music: s.music ? (s.soundMusic ?? 0.6) : 0,
      },
      s.sound,
    );
  }

  cue(c: Cue, arg = 0) {
    if (this.s.sound) sound.play(c, arg);
  }

  /** Where the main engine is from the ear: its nozzles placed by the camera's pose on the ship (or a
   *  spectator's view of it), the air between, the Doppler of a passing ship (S1). */
  private engineSpace(pose: ShipPose | null, air: number, dt: number, warp: number): EngineSpace | null {
    if (!pose) return null;
    const V = VESSELS[fleet.active];
    const at = shipSource(pose, centroid(V.jets.filter((j) => j.main).map((j) => j.p)));
    const dist = Math.hypot(...at);
    // (the radial speed smoothed over ~0.3 s: a frame's jitter is not a pitch; the flight's own, not the
    // screen's — at ×4 a 200 m/s pass closed at 800 m/s, every pass shifted an octave)
    const vr = warp > 0 ? radialSpeed(this.engDist, dist, dt) / warp : 0;
    this.engDist = dist;
    this.vr += (vr - this.vr) * Math.min(1, dt / 0.3);
    return { pos: at, dist, dop: doppler(this.vr, soundSpeed(air)), cutoff: airCutoff(dist, air) };
  }

  /** The wheels for the sound: where each is from the ear, its load; the speed over the ground, the brakes. */
  private groundSound(
    pose: ShipPose | null,
    gear: GearOut | null,
    sf: FlightSnapshot["surface"],
    info: FlightSnapshot | null,
    throttle: number,
  ) {
    const def = GEARS[fleet.active];
    if (!pose || !gear || !def || !sf) return null;
    const wheels = def.legs.map((L, k) => ({ pos: shipSource(pose, L.at), load: gear.legs[k]?.load ?? 0 }));
    const all = gear.contact === def.legs.length;
    return { wheels, speed: Math.hypot(sf.vHor, sf.vVert), brake: all && info?.auto === "none" && throttle < 0.01 ? 1 : 0 };
  }

  /** The station near (S6): the docking in reach — its port where the eye sees it —, else the target when
   *  it is the ISS or the Endurance, within 2 km; docked to it (the flown craft's assembly holding it). */
  private stationSound(info: FlightSnapshot | null, status: RangerStatus | null, pose: ShipPose | null) {
    // (docked to one — the capture over, no docking in reach any more —: heard through the port's ring)
    const held = fleet.assembly(fleet.active).find((v) => (v === "iss" || v === "endurance") && v !== fleet.active);
    if (held && pose) {
      const port = VESSELS[fleet.active].ports[0]?.centre ?? [0, 1, -5];
      const pos = shipSource(pose, port);
      return { pos, dist: Math.hypot(...pos), docked: true };
    }
    const D = info?.dock;
    const T = status?.target;
    const big = (id: string) => (id === "iss" || id === "endurance") && id !== fleet.active;
    let id: string, d: [number, number, number] | null | undefined, dist: number;
    if (D && big(D.target)) {
      id = D.target;
      d = info?.dirs?.dock;
      dist = Math.max(D.range, 2);
    } else if (T && big(T.id)) {
      id = T.id;
      d = info?.dirs?.target;
      dist = T.distKm * 1000;
    } else return null;
    if (!d || !(dist < 2000)) return null;
    const docked = fleet.assembly(fleet.active).includes(id as never);
    return { pos: [d[0] * dist, d[1] * dist, -d[2] * dist] as [number, number, number], dist, docked };
  }

  /**
   * The sonic boom (S7): a standing listener — a spectator, the fly-by's camera — hears it as the craft's
   * Mach cone sweeps it: the craft's place and velocity seen from it (frame to frame, the flight's own time),
   * the listener inside the cone — behind the craft, within asin(1/M) of its wake's axis — now and not the
   * frame before. The cone is where the sound emitted on the way has reached: its delay is in it already.
   */
  private sonicCone(pose: ShipPose | null, M: number, dt: number, warp: number, standing: boolean) {
    const p = pose ? ([...pose.t] as [number, number, number]) : null;
    const prev = this.cone.p;
    this.cone.p = p;
    if (!p || !prev || !standing || !(M > 1) || !(warp > 0) || !(dt > 0)) {
      this.cone.inside = false;
      return;
    }
    const v = [0, 1, 2].map((k) => (p[k]! - prev[k]!) / (dt * warp));
    const vl = Math.hypot(...v);
    const d = Math.hypot(...p);
    // (a camera's jump — the fly-by moving on to wait further —: no motion of the craft)
    if (vl < 100 || vl > 4000 || d < 1) return;
    const cosA = (p[0] * v[0]! + p[1] * v[1]! + p[2] * v[2]!) / (d * vl);
    const inside = cosA > Math.sqrt(1 - 1 / (M * M));
    if (inside && !this.cone.inside) {
      if (this.s.sound) sound.boomAt(Math.min(1, Math.sqrt(400 / d)), 0.06 + 15 / (M * 300));
      haptics.impulse("boom", Math.min(1, Math.sqrt(400 / d)));
    }
    this.cone.inside = inside;
  }

  /**
   * The vibrations (PLAN-HOTAS H5, input/haptics.ts) — felt with the sound off too: the continuous rumble (the
   * engine, the plasma, the rolling), each wheel's touch, the runway's joints.
   */
  private feel(dt: number, on: boolean, throttle: number, plasma: number, ground: ReturnType<SoundDirector["groundSound"]>) {
    const rolling = on && ground?.wheels.some((w) => w.load > 0) ? ground.speed : 0;
    haptics.continuous(on ? hapticMix({ throttle, plasma, rolling }) : { strong: 0, weak: 0 });
    if (!on || !ground) {
      this.wheelsWere = [];
      return;
    }
    ground.wheels.forEach((w, k) => {
      if ((this.wheelsWere[k] ?? 0) <= 0 && w.load > 0 && ground.speed > 10) haptics.impulse("wheel", Math.min(ground.speed / 100, 1));
      this.wheelsWere[k] = w.load;
    });
    if (rolling > 3) {
      this.jointDist += rolling * dt;
      if (this.jointDist > 15) {
        this.jointDist %= 15;
        haptics.impulse("joint", Math.min(rolling / 60, 1));
      }
    }
  }

  /** The load the crew feels [g]: the air's on the airframe, else the engines' push (in vacuum). */
  private felt(info: FlightSnapshot | null) {
    if (!info) return 1;
    if (info.air?.inAir && info.air.g !== undefined) return info.air.g;
    const gUnit = 2.99792458e8 ** 2 / (1476.625 * this.s.massSolar) / 9.80665;
    return (info.accel ?? 0) * gUnit;
  }

  /** The hull heating [K/s], smoothed over ~2 s. */
  private hullHeating(info: FlightSnapshot | null, dt: number) {
    const T = info?.air?.hull;
    if (T === undefined || !Number.isFinite(T) || dt <= 0) return 0;
    const r = Number.isFinite(this.hullT) ? (T - this.hullT) / dt : 0;
    this.hullT = T;
    this.heating += (r - this.heating) * Math.min(1, dt / 2);
    return this.heating;
  }

  /** Each attitude thruster cluster where it sits from the ear and how hard it fires — the jets the renderer
   *  draws (jets.ts), the clusters' strongest (S3). */
  private clusterSound(pose: ShipPose, th: ThrustAsked) {
    const V = VESSELS[fleet.active];
    if (this.clusterCache?.vessel !== V.id) this.clusterCache = { vessel: V.id, cl: rcsClusters(V) };
    return this.clusterCache.cl.slice(0, 8).map((c) => ({
      pos: shipSource(pose, c.p),
      level: Math.max(0, ...c.jets.map((i) => jetLevel(V, V.jets[i]!, i, th))),
    }));
  }

  /** Every frame. `flying`: the Ranger is piloted and shown; `live`: the simulation's time runs; `pose`: the
   *  camera's against the ship (a spectator's view of it: `spectator`). */
  update(
    dt: number,
    o: {
      flying: boolean;
      live: boolean;
      info: FlightSnapshot | null;
      status: RangerStatus | null;
      fired: Fired;
      pose?: ShipPose | null;
      spectator?: boolean;
      /** the thrust asked (the renderer's: its plumes), the thruster clusters' (S3) */
      thrust?: ThrustAsked | null;
      /** the gear's last state (its legs' loads) and the wind at the ground [m/s] (S5) */
      gear?: GearOut | null;
      groundWind?: number;
      /** the rain where the view is (PLAN-PLUIE P5; 0: none, or the time held) */
      rain?: number;
    },
  ) {
    const s = this.s;
    const { info, status, flying } = o;
    // ---- continuous: thrusters, cabin, wind
    const fresh = flying && performance.now() - o.fired.at < 300;
    const f = fresh ? o.fired : { throttle: 0, rcs: 0, rcsSide: 0, turn: 0, yaw: 0, at: 0 };
    this.spin += (f.yaw - this.spin) * Math.min(1, dt * 4);
    const sf = info?.surface ?? null;
    const ground = this.groundSound(o.pose ?? null, o.gear ?? null, sf, info, f.throttle);
    const plasma = info?.air?.inAir ? Math.min(Math.max((Math.log10(Math.max(info.air.heat, 1)) - 4.6) / 1.7, 0), 1) : 0;
    this.feel(dt, flying && o.live, f.throttle, plasma, ground);
    sound.update({
      throttle: f.throttle,
      // (turning hard fires the RCS too, as the wheels saturate)
      rcs: Math.max(f.rcs, (0.55 * Math.max(0, f.turn - 0.6)) / 0.4),
      rcsPan: f.rcs > 0.05 ? -f.rcsSide : -0.5 * Math.sign(f.yaw),
      spin: this.spin,
      torque: f.turn,
      // (the cockpit and the cabin aboard, the hull's mounts through its structure — the audit's § 12: the
      // cockpit was heard as an outside view)
      inside: hearing(s.shipMount, !!o.spectator) !== "outside",
      rcsClusters: fresh && o.pose && o.thrust ? this.clusterSound(o.pose, o.thrust) : null,
      // (the cabin — S4: how the view hears the ship, the load the crew feels, the hull heating, the panel)
      hearing: hearing(s.shipMount, !!o.spectator),
      g: this.felt(info),
      heating: this.hullHeating(info, dt),
      panel: o.pose ? panelFrom(o.pose) : null,
      // (the ground — S5: the wheels where they are, their loads; the speed over it; the brakes as motion.ts
      // sets them — the engine idle, no autopilot, every wheel down)
      ground,
      groundWind: o.groundWind ?? 0,
      station: this.stationSound(info, status, o.pose ?? null),
      space: this.engineSpace(
        o.pose ?? null,
        sf ? Math.min(sf.air / 1.225, 2) : 0,
        dt,
        o.live ? s.timeSpeed * 4.925490947e-6 * s.massSolar : 0,
      ),
      air: sf ? Math.min(sf.air / 1.225, 2) : 0,
      airspeed: sf ? Math.hypot(sf.vVert, sf.vHor) : 0,
      plasma,
      aboard: flying,
      live: o.live,
      rain: o.rain ?? 0,
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
    const toNode =
      node && info.plan && info.auto === "node" && !burning && s.timeSpeed > 0 ? (node.t - info.plan.now) / s.timeSpeed : Infinity;
    const now = {
      sas: info.sas,
      hold: info.hold,
      auto: info.auto,
      precision: info.precision,
      landed: info.landed,
      burning,
      soi: status?.soi ?? "",
      side: status?.side ?? "",
      target: s.target,
      mount: s.shipMount,
      empty: !!fuel?.empty,
      low: !!fuel && !fuel.empty && fuel.fraction < 0.15,
      toNode,
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
    // through Mach 1 in the air, aboard (and on the views riding with the ship): the airframe's shudder —
    // one's own boom is never heard (S7); the boom is a standing listener's, its Mach cone sweeping it
    const M = info.air?.inAir ? info.air.mach : 0;
    const standing = !!o.spectator || s.shipMount === "flyby";
    if (this.mach < 1 !== M < 1 && this.mach > 0 && M > 0 && Math.abs(M - this.mach) < 0.2 && !standing) {
      this.cue("transonic");
      haptics.impulse("transonic");
    }
    this.mach = M;
    this.sonicCone(o.pose ?? null, M, dt, o.live ? s.timeSpeed * 4.925490947e-6 * s.massSolar : 0, standing);
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
