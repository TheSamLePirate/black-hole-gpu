// Flying together (docs/PLAN-RESEAU.md, R1) — the frame's side of the network, in the game's bundle: our craft
// sent to the room (30 times a second, 60 near another, twice when parked), its motion's derivatives measured
// between frames; the others brought onto the camera's axes for the renderer, their name tags for the overlay
// and the HUD; the room's time at ×1; a place beside another (the teleport of the tests). The client itself
// (src/net/) is the network module's, loaded when a room was asked for.

import { fmtFactor, realTimeSpeed, roomPace } from "../clock";
import type { CameraController } from "../controls";
import { axesQuat, kindIndex, kindOf, NET_BODIES, NET_COAST, netFrame, type NetShip, netStateHome, quatAxes } from "../controller/netcraft";
import { type Body, isNetTarget, netTargetId, netTargets } from "../targeting";
import { fleet } from "../fleet";
import type { JetInputs } from "../f35/pose";
import type { GameTools } from "../game/tools";
import { t, tf } from "../i18n";
import { shipToCamera } from "../mounts";
import type { CraftState } from "../net/remote";
import type { Renderer } from "../renderer";
import type { Settings } from "../settings";
import { netRadar } from "./hud/symbology";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { C_MPS, M_METRES, M_SECONDS } from "../units";
import { keplerProp } from "../system/our-plan";
import { solarBody } from "../system/solar";
import { vesselHulls } from "../system/collide";
import { type VesselId, VESSELS } from "../vessels";
import type { NetPanel } from "./netpanel";

type Vec3 = [number, number, number];

/** A name tag over another's craft (ui/overlay.ts draws it): its place on the camera's axes from the eye. */
/** a craft's door off its side [m] (controller/character.ts accessOffset) */
const ACCESS: Record<VesselId, number> = { ranger: 9, lander: 13, endurance: 75, f35: 8 };

/** an Earth-fixed place [m] and nose → geodetic latitude, longitude, heading [°] */
function parkedAt(p: Vec3, fwd: Vec3) {
  const g = cartToGeodetic(WGS84_A, WGS84_F, p);
  const north: Vec3 = [-Math.sin(g.lat) * Math.cos(g.lon), -Math.sin(g.lat) * Math.sin(g.lon), Math.cos(g.lat)];
  const east: Vec3 = [-Math.sin(g.lon), Math.cos(g.lon), 0];
  const D = 180 / Math.PI;
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return { lat: g.lat * D, lon: g.lon * D, heading: (Math.atan2(dot(fwd, east), dot(fwd, north)) * D + 360) % 360 };
}

/** the acceleration measured on a craft in space [m/s²] less the pull of its body's centre: the rest of its pull */
function perturbation(own: { body: number; p: Vec3 }, acc: Vec3): Vec3 {
  const b = solarBody(NET_BODIES[own.body] ?? "");
  const r = Math.hypot(...own.p);
  if (!b || !(r > 0)) return [0, 0, 0];
  const mu = b.mass * C_MPS * C_MPS * M_METRES;
  return [0, 1, 2].map((k) => clamp(acc[k]! + (mu * own.p[k]!) / r ** 3, -1, 1)) as Vec3;
}

/** a coasting craft carried along its orbit about a body (the body's inertial frame, m and m/s) by dt [s] */
function keplerOf(body: number, p: Vec3, v: Vec3, dt: number): { p: Vec3; v: Vec3 } | null {
  const b = solarBody(NET_BODIES[body] ?? "");
  if (!b || !(b.mass > 0)) return null;
  const o = keplerProp(b.mass, scale3(p, 1 / M_METRES), scale3(v, 1 / C_MPS), dt / M_SECONDS);
  return { p: scale3(o.r as Vec3, M_METRES), v: scale3(o.v as Vec3, C_MPS) };
}
const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

export interface NetTag {
  slot: number;
  name: string;
  colour: string;
  /** right, up, forward from the eye [m] */
  at: Vec3;
  dist: number;
  ghost: boolean;
  kind: string;
}

export interface NetSessionDeps {
  camera: CameraController;
  renderer: Renderer;
  settings: Settings;
  tools: GameTools;
  panel: NetPanel;
  toast(s: string): void;
  /** the F-35's flight controls' inputs this frame (main.ts: the poser's), null: not the F-35 */
  jetIn(): JetInputs | null;
  /** the scene's time [s] */
  sceneTime(): number;
  /** a mid-air collision with another's craft (main.ts: destroyed — a match's: shot down by it) */
  onCollide(slot: number, name: string): void;
}

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** On the ground: the gear touching, the craft set down (parked: no gear contact then), or within 3 m of it. */
const onGround = (c: CameraController, h: number | undefined) => (c.gearLast?.contact ?? 0) > 0 || !!c.landed || (h ?? 99) < 3;

/** Another's last three samples consistent with one another (each where the one before's motion put it, within
 *  50 m): not a placement's jump. */
function steady(S: { t: number; p: number[]; v: number[] }[] | undefined) {
  if (!S || S.length < 3) return false;
  for (let i = S.length - 2; i < S.length; i++) {
    const a = S[i - 1]!,
      b = S[i]!;
    const h = b.t - a.t;
    if (h <= 0 || h > 1) return false;
    if (Math.hypot(...b.p.map((x, k) => x - a.p[k]! - a.v[k]! * h)) > 50) return false;
  }
  return true;
}

export class NetSession {
  /** the name tags this frame */
  tags: NetTag[] = [];
  /** the others' craft this frame */
  ships: NetShip[] = [];
  /** the slots not shown now (shot down in a match, waiting to fly again — ui/netmatch.ts) */
  hidden = new Map<number, boolean>();
  /**
   * The player followed (docs/PLAN-RESEAU.md R4): our craft his puppet — every view on him, his surfaces, his
   * flame, his instruments (his telemetry) —; why: a spectator's choice, a match's kill cam. Null: none.
   */
  follow: { slot: number; why: "spectate" | "killcam" | "passenger" } | null = null;
  /** who is aboard whose craft (R5): a passenger's slot → the pilot's */
  aboard = new Map<number, number>();
  /** our own craft as we left it parked to board another's: put back there when we get off */
  private parkedOwn: { kind: VesselId; lat: number; lon: number; heading: number } | null = null;
  /** getting off, its second step due (alightStep) */
  private alighting: {
    at: number;
    park: { lat: number; lon: number; heading: number } | null;
    door: Vec3 | null;
    fwd: Vec3;
  } | null = null;
  /** the followed craft's pose and engines this frame (main.ts: the renderer's flown craft's) */
  followJet: NetShip["jet"] | null = null;
  followThrust: NetShip["thrust"] | null = null;
  /** his instruments' figures (his telemetry, 4 times a second) */
  private tel = new Map<number, Record<string, number>>();
  private telAt = 0;
  private telBound: unknown = null;
  private lastSend = -1;
  private prev: { at: number; st: number; frame: number; v: Vec3; ax: [Vec3, Vec3, Vec3] } | null = null;
  private acc: Vec3 = [0, 0, 0];
  private spin: Vec3 = [0, 0, 0];
  private collidedAt = -1e9;
  private walkSentAt = -1;
  private walkPrev: Vec3 | null = null;
  private walkPrevSt = 0;
  /** our place last frame [m, the Earth's], when it last jumped (a placement), the frames each other has touched */
  private ownAt: number[] | null = null;
  private placedAt = -1e9;
  private touch = new Map<number, number>();
  /** the room whose clock the scene was set on */
  private timedRoom = "";
  /** our warp ask last told the room (×), when; the last time the scene was set on the room's clock */
  private wantSent = Number.NaN;
  private wantAt = -1e9;
  private resyncAt = -1e9;
  /** samples sent, for the link's figures */
  sent = 0;
  /** the last sample sent coasting (R6): whether, what — the orbit the others carry us on —, its other pulls */
  private coastSent = false;
  private lastCoast: { t: number; body: number; p: Vec3; v: Vec3; a: Vec3 } | null = null;
  private coastA: Vec3 = [0, 0, 0];

  constructor(private d: NetSessionDeps) {
    // the others' craft as targets (R6): the HUD's, the rendezvous', the map's
    const slotOf = (id: Body) => Number(String(id).slice(4));
    netTargets.list = () => this.ships.filter((s) => !s.ghost).map((s) => netTargetId(s.slot));
    netTargets.name = (id) => this.nameOf(slotOf(id));
    netTargets.colour = (id) => {
      const c = this.net?.room?.members.find((m) => m.slot === slotOf(id))?.colour ?? "#ffffff";
      return [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16) || 255).join(", ");
    };
    netTargets.state = (id, t) => {
      const st = this.net?.remotes.track(slotOf(id))?.raw(t * M_SECONDS);
      return st ? netStateHome(st, t) : null;
    };
  }

  private get net() {
    return this.d.panel.net;
  }

  /** The frame: our sample sent when due, the others placed, the room's ×1. */
  frame(dt: number) {
    const net = this.net;
    const R = this.d.renderer;
    if (!net?.room) {
      if (this.follow) this.unfollow();
      roomPace.cap = Infinity;
      roomPace.ease = 1;
      roomPace.note = "";
      this.wantSent = Number.NaN;
      // (a player targeted: gone with the room)
      if (isNetTarget(this.d.settings.target)) this.d.settings.target = "earth";
      if (R.netWalkers.length) R.netWalkers = [];
      if (R.netOthers.length) R.netOthers = [];
      if (R.netShipsCam.length) R.netShipsCam = [];
      if (this.tags.length) this.tags = [];
      if (this.ships.length) this.ships = [];
      if (netFrame.ships.length) netFrame.ships = [];
      if (netRadar.contacts.length) netRadar.contacts = [];
      this.prev = null;
      return;
    }
    const c = this.d.camera;
    const now = performance.now() / 1000;
    this.alightStep(now);
    this.pace(net, now);
    // the others
    // (each other's craft at our scene's time — what we draw; the samples carry their sender's — R6: a clock a
    // little off the room's misplaces nobody)
    const states = net.remotes.states(this.d.sceneTime()).filter((s) => !s.ghost || s.ahead < 10);
    // (his telemetry heard: our instruments show his)
    if (this.telBound !== net) {
      this.telBound = net;
      net.on("event", ({ from, ev }) => {
        const e = ev as { kind?: string; to?: number };
        if (e.kind === "tel") this.tel.set(from, (ev as unknown as { v: Record<string, number> }).v);
        else if (e.kind === "board" && typeof e.to === "number") {
          this.aboard.set(from, e.to);
          if (e.to === net.room?.slot) this.d.toast(tf("{0} is aboard", this.nameOf(from)));
        } else if (e.kind === "alight") {
          if (this.aboard.get(from) === net.room?.slot) this.d.toast(tf("{0} got off", this.nameOf(from)));
          this.aboard.delete(from);
        }
      });
    }
    const F = this.follow;
    if (F && !net.room.members.some((m) => m.slot === F.slot)) this.unfollow();
    if (isNetTarget(this.d.settings.target) && !net.room.members.some((m) => netTargetId(m.slot) === this.d.settings.target))
      this.d.settings.target = "earth";
    for (const [p, q] of this.aboard)
      if (!net.room.members.some((m) => m.slot === p) || !net.room.members.some((m) => m.slot === q)) this.aboard.delete(p);
    // (a spectator, an instruments screen: the first pilot followed — the instruments in his cockpit)
    if (!this.follow && net.room.role !== "pilot") {
      const p = net.room.members.filter((m) => m.role === "pilot" && !!net.remotes.track(m.slot)).sort((a, b) => a.slot - b.slot)[0];
      if (p) {
        this.setFollow(p.slot);
        if (net.room.role === "instruments") this.d.settings.shipMount = "cockpit";
      }
    }
    const all = c.netShips(
      states.filter((s) => !this.hidden.has(s.slot) || s.slot === this.follow?.slot),
      dt,
    );
    // the others on foot: in the home frame, the renderer brings them onto its camera
    R.netWalkers = states
      .filter((s) => s.kind === 4 && !s.ghost && !this.hidden.has(s.slot))
      .map((s) => c.netWalkerHome(s))
      .filter((w): w is NonNullable<typeof w> => !!w);
    // (no one on foot: their last tags gone — the renderer places them only while someone walks)
    if (!R.netWalkers.length) R.netWalkersCam = [];
    const followed = this.follow ? (all.find((s) => s.slot === this.follow!.slot) ?? null) : null;
    this.ships = all.filter((s) => s.slot !== this.follow?.slot);
    // (his state read straight — the craft placed even when ours is far from the Earth: a spectator in orbit)
    const fstate = this.follow ? (states.find((s) => s.slot === this.follow!.slot) ?? null) : null;
    this.puppetFrame(followed, fstate);
    R.netOthers = this.ships
      .filter((s) => !s.ghost && s.dist < 60_000)
      .map((s) => ({ slot: s.slot, id: s.id, rel: s.rel, axes: s.axes, X: s.X, axesHome: s.axesHome, jet: s.jet, thrust: s.thrust }));
    const members = new Map(net.room.members.map((m) => [m.slot, m]));
    // (on the F-35's radar: each other in his colour, his track, his height against ours)
    netRadar.contacts = this.ships
      .filter((s) => !s.ghost && s.dist < 60_000)
      .map((s) => ({
        ...s.radar,
        air: !(s.state.flags & 1),
        alive: true,
        locked: false,
        seen: true,
        name: members.get(s.slot)?.name ?? `#${s.slot}`,
        colour: members.get(s.slot)?.colour ?? "#ffffff",
      }));
    const eye =
      this.d.settings.ship && R.shipPose
        ? shipToCamera(R.shipPose, this.d.settings.shipLookYaw, this.d.settings.shipLookPitch).t
        : ([0, 0, 0] as Vec3);
    // (their name tags: over the walkers' heads too — where the renderer put them last frame)
    const walkerTags: NetTag[] = R.netWalkersCam.map((w) => {
      const m = members.get(w.slot);
      return {
        slot: w.slot,
        name: m?.name ?? `#${w.slot}`,
        colour: m?.colour ?? "#ffffff",
        at: w.at,
        dist: w.dist,
        ghost: false,
        kind: t("on foot"),
      };
    });
    // (where the renderer drew each last — from its camera: a walker's far from his craft —, else from ours)
    const drawn = new Map(R.netShipsCam.map((d) => [d.slot, d]));
    this.tags = this.ships.map((s) => {
      const m = members.get(s.slot);
      const D = drawn.get(s.slot);
      return {
        slot: s.slot,
        name: m?.name ?? `#${s.slot}`,
        colour: m?.colour ?? "#ffffff",
        at: D?.at ?? ([s.rel[0] + eye[0], s.rel[1] + eye[1], s.rel[2] + eye[2]] as Vec3),
        dist: D?.dist ?? s.dist,
        ghost: s.ghost,
        kind: [
          VESSELS[s.id].name,
          ...[...this.aboard].filter(([, q]) => q === s.slot).map(([p]) => tf("{0} aboard", members.get(p)?.name ?? `#${p}`)),
        ].join(" · "),
      };
    });
    this.tags.push(...walkerTags);
    // our walker, 15 times a second (a pilot's: on foot, his craft parked beside — both sent)
    const W = net.room.role === "pilot" && !this.follow ? c.netOwnWalker() : null;
    if (W && now - this.walkSentAt > 1 / 15) {
      const h = now - this.walkSentAt;
      this.walkSentAt = now;
      // (his velocity per second of the scene's time, as the others carry him on: at a warp, his steps slow on it)
      const hs = this.d.sceneTime() - this.walkPrevSt;
      this.walkPrevSt = this.d.sceneTime();
      const v: Vec3 = this.walkPrev && h < 0.5 && hs > 0 ? ([0, 1, 2].map((k) => (W.p[k]! - this.walkPrev![k]!) / hs) as Vec3) : [0, 0, 0];
      this.walkPrev = W.p;
      net.sendCraft({
        t: this.d.sceneTime(),
        frame: 0,
        body: W.body,
        kind: 4,
        flags: W.grounded ? 1 : 0,
        p: W.p,
        v,
        q: axesQuat(W.fwd, W.up, W.right),
        w: [0, 0, 0],
        a: [0, 0, 0],
        vis: {
          throttle: 0,
          boost: 1,
          gear: 0,
          flaps: 0,
          brake: 0,
          stovl: 0,
          fan: 0,
          nozzle: 0,
          pitch: 0,
          roll: 0,
          yaw: 0,
          steer: 0,
          comp: 0,
          alpha: 0,
          cl: 0,
          mach: W.speed / 100,
        },
      });
    } else if (!W) this.walkPrev = null;
    // (a mid-air collision: our hull and another's touching, both flying — each side finds its own. Not on a
    // placement's heels — ours or his: a craft put somewhere jumps, its old and new samples a moment apart —:
    // his samples fresh and steady, our place steady 2 s, the touch two frames running)
    const ownNow = c.netOwn();
    const ground = onGround(c, ownNow?.h);
    if (ownNow && this.ownAt && Math.hypot(...ownNow.p.map((x, k) => x - this.ownAt![k]!)) > 500) this.placedAt = now;
    this.ownAt = ownNow?.p ?? null;
    if (!ground && ownNow && now - this.collidedAt > 5 && now - this.placedAt > 2)
      for (const sh of this.ships) {
        const reach = 0.55 * (vesselHulls[sh.id].radius + vesselHulls[fleet.active].radius);
        const touching =
          !sh.ghost && !(sh.state.flags & 1) && sh.dist < reach && sh.state.ahead < 0.3 && steady(net.remotes.track(sh.slot)?.samples);
        const n = touching ? (this.touch.get(sh.slot) ?? 0) + 1 : 0;
        this.touch.set(sh.slot, n);
        if (n >= 2) {
          this.collidedAt = now;
          this.touch.clear();
          this.d.onCollide(sh.slot, members.get(sh.slot)?.name ?? `#${sh.slot}`);
          break;
        }
      }
    // ours, when due (not while our craft is another's puppet)
    if (net.room.role !== "pilot" || this.follow) return;
    const own = c.netOwnState();
    if (!own) {
      this.prev = null;
      return;
    }
    // (the motion's derivatives, measured: the velocity's change, the axes' turn — eased over a few frames)
    const ax: [Vec3, Vec3, Vec3] = [own.fwd, own.up, own.right];
    // (per second of the scene's time — the others carry it on in the room's: at a warp, not per second of ours)
    const st = this.d.sceneTime();
    if (this.prev && now > this.prev.at && st > this.prev.st && own.frame === this.prev.frame) {
      const h = st - this.prev.st;
      const k = 1 - Math.exp(-(now - this.prev.at) / 0.08);
      const a = [0, 1, 2].map((i) => (own.v[i]! - this.prev!.v[i]!) / h) as Vec3;
      // (ω = ½ Σ eᵢ × eᵢ' / h: the triad's turn)
      const w: Vec3 = [0, 0, 0];
      for (let j = 0; j < 3; j++) {
        const e0 = this.prev.ax[j]!,
          e1 = ax[j]!;
        w[0] += (e0[1] * e1[2] - e0[2] * e1[1]) / (2 * h);
        w[1] += (e0[2] * e1[0] - e0[0] * e1[2]) / (2 * h);
        w[2] += (e0[0] * e1[1] - e0[1] * e1[0]) / (2 * h);
      }
      for (let i = 0; i < 3; i++) {
        this.acc[i] = this.acc[i]! + (clamp(a[i]!, -400, 400) - this.acc[i]!) * k;
        this.spin[i] = this.spin[i]! + (clamp(w[i]!, -10, 10) - this.spin[i]!) * k;
      }
    }
    this.prev = { at: now, st, frame: own.frame, v: own.v, ax };
    const speed = Math.hypot(...own.v);
    const onGnd = own.frame === 0 && ground;
    const parked = onGnd && speed < 0.5;
    const near = this.ships.some((s) => s.dist < 5000);
    const th = this.d.renderer.shipThrust;
    // (in space, no thrust: its orbit carries it — a sample a second, the others propagate it; at once when it
    // changes — docs/PLAN-RESEAU.md R6)
    const coast = own.frame === 1 && (th?.throttle ?? 0) < 0.005 && !c.pilot.engineNow;
    // (coasting: oftener as the room's warp runs faster — its orbit's own pull besides Kepler's stays small between two)
    const warpNow = net.roomWarp();
    const rate = parked ? 2 : coast ? clamp(warpNow / 20, 1, 30) : near ? 60 : 30;
    // (coasting: also at once when we are no longer where the others carry us — a placing, a push: our orbit
    // changed)
    const LC = this.lastCoast;
    const off =
      coast && LC && LC.body === own.body
        ? (() => {
            const k = keplerOf(LC.body, LC.p, LC.v, st - LC.t);
            return k ? Math.hypot(...k.p.map((x, i) => x + 0.5 * LC.a[i]! * (st - LC.t) ** 2 - own.p[i]!)) : Infinity;
          })()
        : Infinity;
    if (now - this.lastSend < 1 / rate - 0.002 && coast === this.coastSent && !(coast && off > 20)) return;
    this.lastSend = now;
    this.coastSent = coast;
    const L = c.airFlight.last;
    const J = this.d.jetIn();
    const cmd = (k: number) => (J ? clamp(0.55 * J.torque[k]! + 0.75 * J.rates[k]!, -1, 1) : 0);
    const boost = th?.boost ?? 1;
    this.coastA = coast ? perturbation(own, this.acc) : [0, 0, 0];
    this.lastCoast = coast ? { t: st, body: own.body, p: own.p, v: own.v, a: this.coastA } : null;
    net.sendCraft({
      // (stamped with our scene's time: the pose's)
      t: this.d.sceneTime(),
      frame: own.frame,
      body: own.body,
      kind: kindIndex(fleet.active),
      flags: (onGnd ? 1 : 0) | (parked ? 2 : 0) | (this.d.settings.navLights ? 4 : 0) | (boost > 1.01 ? 8 : 0) | (coast ? NET_COAST : 0),
      p: own.p,
      v: own.v,
      q: axesQuat(own.fwd, own.up, own.right),
      w: this.spin,
      // (coasting: what pulls it besides the body's centre — its flattening, the Moon, the Sun —, added by the others
      // to the Kepler orbit they carry it on)
      a: onGnd ? [0, 0, 0] : coast ? this.coastA : this.acc,
      vis: {
        throttle: th?.throttle ?? 0,
        boost,
        gear: c.gearExt,
        flaps: c.airFlight.cfg.flaps ?? 0,
        brake: c.airFlight.cfg.brake ?? 0,
        stovl: J?.stovl ?? 0,
        fan: c.stovl?.on ? 1 : 0,
        nozzle: J?.nozzle ?? 0,
        pitch: cmd(0),
        yaw: cmd(1),
        roll: cmd(2),
        steer: J?.steer ?? 0,
        comp: J ? (J.comp[0] + J.comp[1] + J.comp[2]) / 3 : 0,
        alpha: ((L?.out.alpha ?? 0) * 180) / Math.PI,
        cl: L?.out.cl ?? 0,
        mach: L?.out.mach ?? 0,
      },
    });
    this.sent++;
    // (our instruments' figures for those who follow us: 4 times a second)
    if (now - this.telAt > 0.25) {
      this.telAt = now;
      net.event({
        kind: "tel",
        v: {
          fuel: Math.round(fleet.fuel[fleet.active] ?? 0),
          thr: Math.round((c.pilot.throttle ?? 0) * 1000) / 1000,
          eng: Math.round((c.pilot.engineNow ?? 0) * 1000) / 1000,
          gear: c.gearExt,
          flaps: c.airFlight.cfg.flaps ?? 0,
          brake: c.airFlight.cfg.brake ?? 0,
        },
      });
    }
  }

  /**
   * The room's clock (docs/PLAN-RESEAU.md R6): on joining, the scene set on the room's hour and our warp on its
   * pace; then, every frame, the warp we ask for told to the room (the pilots': the room runs at the slowest asked
   * — a speed-up waits for everyone's), and the scene's time kept on the room's — never faster than its pace,
   * eased onto its clock (from half to twice its pace), set on it at once if it fell far off (a stall, a tab put
   * aside).
   */
  private pace(net: NonNullable<NetPanel["net"]>, now: number) {
    const room = net.room!;
    const s = this.d.settings;
    const rt = realTimeSpeed(s);
    // (the others' tracks: read at the room's pace, a coasting craft carried along its orbit)
    net.remotes.env.pace = Math.max(1, net.roomWarp());
    net.remotes.env.kepler ??= keplerOf;
    if (!net.clock.synced) return;
    const tr = net.roomNow();
    const W = net.roomWarp();
    if (this.timedRoom !== room.code) {
      this.timedRoom = room.code;
      this.wantSent = Number.NaN;
      const off = tr - this.d.sceneTime();
      if (Number.isFinite(tr) && Math.abs(off) > 0.25) {
        this.d.tools.setDate(tr / M_SECONDS);
        if (Math.abs(off) > 60) this.d.toast(t("The scene set on the room's hour"));
      }
      // (the room's pace taken as ours: our ask is the room's — nobody slowed by our coming)
      if (W > 0) this.d.camera.requestWarp(W * rt);
      s.animate = true;
    }
    // our ask (a pilot's), when it changed
    const want = s.animate ? s.timeSpeed / rt : 0;
    // (a slowdown at once — the air's limit, a pause —; a speed-up at most 5 times a second)
    if (
      room.role === "pilot" &&
      !(Math.abs(want - this.wantSent) <= 1e-3 * Math.max(1, want)) &&
      (want < this.wantSent || now - this.wantAt > 0.2)
    ) {
      this.wantSent = want;
      this.wantAt = now;
      net.warp(Math.round(want * 1e4) / 1e4);
    }
    // the scene on the room's clock (as at this frame's instant: the step brought the scene to it)
    const e = this.d.sceneTime() - net.roomAt(Number(document.timeline.currentTime ?? performance.now()));
    this.lag = e;
    if (Math.abs(e) > Math.max(30, 10 * W) && now - this.resyncAt > 5) {
      this.resyncAt = now;
      this.d.tools.setDate(tr / M_SECONDS);
      this.d.toast(t("The scene set on the room's hour"));
    }
    roomPace.cap = W * rt;
    roomPace.ease = W > 0 ? clamp(1 - e / (2 * W), 0.5, 2) : 1;
    // (what holds the room: the paused, the slowest, those asked to follow a speed-up)
    const names = (f: (w: number) => boolean) =>
      room.members.filter((m) => m.role === "pilot" && m.slot !== room.slot && f(room.wants[m.slot] ?? W)).map((m) => m.name);
    const mine = room.wants[room.slot] ?? want;
    roomPace.note =
      W === 0
        ? tf("paused by {0}", names((w) => w === 0).join(", ") || t("the room"))
        : mine > W * 1.001
          ? tf("{0} asked — waiting for {1}", fmtFactor(mine), names((w) => w < mine * 0.999).join(", "))
          : "";
    // (a speed-up asked by another: offered to us)
    const ask = Math.max(0, ...room.members.filter((m) => m.role === "pilot" && m.slot !== room.slot).map((m) => room.wants[m.slot] ?? 0));
    const offer = room.role === "pilot" && ask > W * 1.001 && want < ask * 0.999 ? { warp: ask, by: names((w) => w === ask) } : null;
    if (offer && offer.warp !== this.offer?.warp)
      this.d.toast(tf("{0} asks for {1} — warp up to accept", offer.by.join(", "), fmtFactor(offer.warp)));
    this.offer = offer;
    if (offer && !roomPace.note) roomPace.note = tf("{0} asks for {1}", offer.by.join(", "), fmtFactor(offer.warp));
  }

  /** our scene's time less the room's, at the end of the frame's step [s] (R6) */
  lag = 0;

  /** a faster warp another pilot asks for, offered to us (accepted: ours too) */
  offer: { warp: number; by: string[] } | null = null;

  /** Accept the warp offered: ours set to it — the room speeds up once every pilot asks for it. */
  acceptWarp() {
    if (!this.offer) return false;
    this.d.camera.requestWarp(this.offer.warp * realTimeSpeed(this.d.settings));
    this.d.settings.animate = true;
    return true;
  }

  /** Follow another player (our craft his puppet), or stop. */
  setFollow(slot: number | null, why: "spectate" | "killcam" | "passenger" = "spectate") {
    if (slot === null) return this.unfollow();
    this.follow = { slot, why };
  }

  private nameOf(slot: number) {
    return this.net?.room?.members.find((m) => m.slot === slot)?.name ?? `#${slot}`;
  }

  /** Another's craft by us on foot (R5): the nearest landed one whose door (either side) is within 4 m, or
   *  its hull within 2 m; null: none. */
  private craftNear(): { slot: number; state: CraftState; d: number } | null {
    const net = this.net;
    const ch = this.d.camera.character;
    if (!net?.room || !ch.active || !ch.ours || ch.body !== "earth") return null;
    const now = this.d.sceneTime();
    let best: { slot: number; state: CraftState; d: number } | null = null;
    for (const m of net.room.members) {
      if (m.slot === net.room.slot) continue;
      const s = net.remotes.track(m.slot)?.at(now);
      const id = s && !s.ghost ? kindOf(s.kind) : null;
      if (!s || !id) continue;
      const ax = quatAxes(s.q);
      const off = ACCESS[id];
      const dist = (o: number) => Math.hypot(...[0, 1, 2].map((k) => ch.q[k]! - (s.p[k]! + ax.right[k]! * o)));
      const d = Math.min(dist(off), dist(-off));
      const reach = d < 4 || dist(0) < vesselHulls[id].radius + 2;
      if (reach && (!best || d < best.d)) best = { slot: m.slot, state: s, d };
    }
    return best;
  }

  /**
   * ⇧K in a room (docs/PLAN-RESEAU.md R5): aboard another's craft, off it — landed and still —, on foot at its
   * door; on foot by another's landed craft, aboard it as his passenger (every view his, his instruments, his
   * flight). What it did or why not (a toast); undefined: not ours (our own craft's hatch, no one near).
   */
  boardToggle(): string | undefined {
    const net = this.net;
    if (!net?.room) return undefined;
    if (this.follow?.why === "passenger") return this.alight();
    const c = this.d.camera;
    const near = this.craftNear();
    if (!near) return undefined;
    // (our own hatch nearer: ours)
    if (c.character.accessDistance() <= 3 && c.character.accessDistance() < near.d) return undefined;
    const name = this.nameOf(near.slot);
    if (!(near.state.flags & 1) || Math.hypot(...near.state.v) > 0.5) return tf("{0}'s craft must be landed and still", name);
    const own = c.netOwn();
    this.parkedOwn = own ? { kind: fleet.active, ...parkedAt(own.p, own.fwd) } : null;
    c.character.stop();
    this.setFollow(near.slot, "passenger");
    net.event({ kind: "board", to: near.slot });
    return tf("Aboard {0}'s craft — ⇧K to get off once landed", name);
  }

  /** Off the craft we ride in, at its door — landed and still —; our own craft back where we left it. */
  private alight(): string {
    const net = this.net!;
    const F = this.follow!;
    const s = net.remotes.track(F.slot)?.at(this.d.sceneTime());
    const name = this.nameOf(F.slot);
    const id = s ? kindOf(s.kind) : null;
    if (s && id && (!(s.flags & 1) || Math.hypot(...s.v) > 0.5)) return tf("Wait until {0}'s craft is landed and still", name);
    this.unfollow();
    // our own craft where we left it — then, a moment later (its place read again), on foot at the door
    const P = this.parkedOwn;
    this.parkedOwn = null;
    if (P) {
      if (fleet.active !== P.kind) this.d.tools.set("vessel", P.kind);
      this.park(P.lat, P.lon, P.heading);
    }
    const ax = s && id ? quatAxes(s.q) : null;
    this.alighting = {
      at: performance.now() / 1000,
      park: P,
      door: ax && id ? ([0, 1, 2].map((k) => s!.p[k]! + ax.right[k]! * ACCESS[id]) as Vec3) : null,
      fwd: ax?.fwd ?? [0, 0, 1],
    };
    return tf("Off {0}'s craft", name);
  }

  /** our craft parked on its gear (its ground gone: left where it is) */
  private park(lat: number, lon: number, heading: number) {
    const c = this.d.camera;
    try {
      this.d.tools.parkAt("earth", lat, lon, heading, t("Your craft is back where you left it"));
      c.pilot.auto = "none";
      c.gearInit = true;
      c.gearDown = true;
      c.gearExt = 1;
      c.pilot.throttle = 0;
    } catch {
      /* its ground gone */
    }
  }

  /** Getting off, its second step (a few frames on): our craft's place read — the pose's point and the craft's own
   *  origin some metres apart: put again, that offset taken out —, then on foot at the door, its nose ahead. */
  private alightStep(now: number) {
    const A = this.alighting;
    if (!A || now - A.at < 0.2) return;
    this.alighting = null;
    const c = this.d.camera;
    const got = A.park ? c.netOwn() : null;
    if (A.park && got) {
      const g = parkedAt(got.p, got.fwd);
      if (Math.hypot(g.lat - A.park.lat, g.lon - A.park.lon) > 2e-6)
        this.park(2 * A.park.lat - g.lat, 2 * A.park.lon - g.lon, A.park.heading);
    }
    if (A.door) {
      const err = c.character.startAt("earth", A.door, A.fwd);
      if (err) this.d.toast(err);
    }
  }

  private unfollow() {
    if (this.follow?.why === "passenger" && this.net?.room) this.net.event({ kind: "alight", to: this.follow.slot });
    this.follow = null;
    this.followJet = null;
    this.followThrust = null;
    this.d.camera.puppet = null;
  }

  /** The followed craft as ours this frame: his kind, his pose (the puppet's), his surfaces and flame, his figures. */
  private puppetFrame(sh: NetShip | null, st: CraftState | null) {
    const c = this.d.camera;
    if (!this.follow || !st) {
      if (this.follow && !st) c.puppet = null;
      this.followJet = null;
      this.followThrust = null;
      return;
    }
    if (!this.d.settings.ship) this.d.tools.set("ship", true);
    const kinds = ["ranger", "lander", "endurance", "f35"] as const;
    const kind = kinds[st.kind];
    if (kind && fleet.active !== kind) {
      try {
        this.d.tools.set("vessel", kind);
      } catch {
        /* not here */
      }
    }
    const ground = (st.flags & 1) !== 0;
    c.puppet = () => {
      const P = c.netPlaceBeside(st, 0);
      return P && { ...P, ground };
    };
    this.followJet = sh?.jet ?? null;
    this.followThrust = sh?.thrust ?? null;
    const slot = this.follow.slot;
    const T = this.tel.get(slot);
    if (T) {
      if (kind) fleet.fuel[kind] = T.fuel ?? fleet.fuel[kind];
      c.pilot.throttle = T.thr ?? c.pilot.throttle;
      c.pilot.engineNow = T.eng ?? c.pilot.engineNow;
      c.gearExt = T.gear ?? c.gearExt;
      c.gearDown = (T.gear ?? 0) > 0.5;
      c.airFlight.cfg.flaps = T.flaps ?? 0;
      c.airFlight.cfg.brake = T.brake ?? 0;
    }
  }

  /** After the render's figures: the followed craft's flame (the renderer's flown craft's engines are his). */
  afterRender() {
    const th = this.followThrust;
    if (!th || !this.follow) return;
    const R = this.d.renderer;
    R.shipThrust = {
      throttle: th.throttle,
      boost: th.boost,
      air: th.air,
      force: [0, 0, 0],
      torque: [0, 0, 0],
      time: performance.now() / 1000,
    };
  }

  /** The others in the room with a craft now (the teleport's choice). */
  others(): { slot: number; name: string; state: CraftState | null }[] {
    const net = this.net;
    if (!net?.room) return [];
    const now = this.d.sceneTime();
    return net.room.members
      .filter((m) => m.slot !== net.room!.slot)
      .map((m) => ({ slot: m.slot, name: m.name, state: net.remotes.track(m.slot)?.at(now) ?? null }));
  }

  /**
   * Our craft put beside another's (the tests'): `gap` metres off its right wing, at its speed and attitude —
   * in formation; on the ground, parked beside it. Says what it did.
   */
  teleport(slot: number, gap?: number): string {
    // (not before our scene is on the room's clock: set on it after, we would be carried off his place)
    if (!this.net?.clock.synced || this.timedRoom !== this.net.room?.code) return t("The room's clock is still being set — a moment");
    const o = this.others().find((x) => x.slot === slot);
    if (!o) return t("No such player in the room");
    if (!o.state) return tf("{0} has no craft on our worlds now", o.name);
    const c = this.d.camera;
    const s = o.state;
    // (clear of both wingspans: the other's half, ours, a margin)
    const half = (id: string) => (id === "f35" ? 5.4 : id === "ranger" ? 12 : id === "lander" ? 8 : 40);
    const kinds = ["ranger", "lander", "endurance", "f35"];
    const g = gap ?? half(kinds[s.kind] ?? "f35") + half(fleet.active) + 8;
    const place = c.netPlaceBeside(s, g);
    if (!place) return t("The teleport needs your craft on our side of the wormhole");
    const ground = (s.flags & 1) !== 0;
    this.d.tools.placeAt({ frame: "ours", ...place, note: tf("Beside {0}", o.name) });
    if (c.pilot.auto !== "none") c.pilot.setAuto(c.pilot.auto);
    c.pilot.auto = "none";
    c.gearInit = true;
    c.gearDown = ground || s.vis.gear > 0.5;
    c.gearExt = c.gearDown ? 1 : 0;
    c.pilot.throttle = ground ? 0 : s.vis.throttle;
    this.prev = null;
    return ground ? tf("On the ground beside {0}", o.name) : tf("In formation off {0}'s right wing — {1} m", o.name, Math.round(g));
  }
}
