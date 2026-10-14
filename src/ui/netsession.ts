// Flying together (docs/PLAN-RESEAU.md, R1) — the frame's side of the network, in the game's bundle: our craft
// sent to the room (30 times a second, 60 near another, twice when parked), its motion's derivatives measured
// between frames; the others brought onto the camera's axes for the renderer, their name tags for the overlay
// and the HUD; the room's time at ×1; a place beside another (the teleport of the tests). The client itself
// (src/net/) is the network module's, loaded when a room was asked for.

import { realTimeSpeed } from "../clock";
import type { CameraController } from "../controls";
import { axesQuat, kindIndex, netFrame, type NetShip } from "../controller/netcraft";
import { fleet } from "../fleet";
import type { JetInputs } from "../f35/pose";
import type { GameTools } from "../game/tools";
import { t, tf } from "../i18n";
import { shipToCamera } from "../mounts";
import type { CraftState } from "../net/remote";
import type { Renderer } from "../renderer";
import type { Settings } from "../settings";
import { netRadar } from "./hud/symbology";
import { M_SECONDS } from "../units";
import { vesselHulls } from "../system/collide";
import { VESSELS } from "../vessels";
import type { NetPanel } from "./netpanel";

type Vec3 = [number, number, number];

/** A name tag over another's craft (ui/overlay.ts draws it): its place on the camera's axes from the eye. */
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
  follow: { slot: number; why: "spectate" | "killcam" } | null = null;
  /** the followed craft's pose and engines this frame (main.ts: the renderer's flown craft's) */
  followJet: NetShip["jet"] | null = null;
  followThrust: NetShip["thrust"] | null = null;
  /** his instruments' figures (his telemetry, 4 times a second) */
  private tel = new Map<number, Record<string, number>>();
  private telAt = 0;
  private telBound: unknown = null;
  private lastSend = -1;
  private prev: { at: number; v: Vec3; ax: [Vec3, Vec3, Vec3] } | null = null;
  private acc: Vec3 = [0, 0, 0];
  private spin: Vec3 = [0, 0, 0];
  private warpSaid = false;
  private collidedAt = -1e9;
  /** our place last frame [m, the Earth's], when it last jumped (a placement), the frames each other has touched */
  private ownAt: number[] | null = null;
  private placedAt = -1e9;
  private touch = new Map<number, number>();
  /** the room whose clock the scene was set on */
  private timedRoom = "";
  /** samples sent, for the link's figures */
  sent = 0;

  constructor(private d: NetSessionDeps) {}

  private get net() {
    return this.d.panel.net;
  }

  /** The frame: our sample sent when due, the others placed, the room's ×1. */
  frame(dt: number) {
    const net = this.net;
    const R = this.d.renderer;
    if (!net?.room) {
      if (this.follow) this.unfollow();
      if (R.netOthers.length) R.netOthers = [];
      if (this.tags.length) this.tags = [];
      if (this.ships.length) this.ships = [];
      if (netFrame.ships.length) netFrame.ships = [];
      if (netRadar.contacts.length) netRadar.contacts = [];
      this.prev = null;
      return;
    }
    const c = this.d.camera;
    const now = performance.now() / 1000;
    // (the room's hour, the scene's: on joining, a scene more than a minute off set on the room's clock —
    // the same Sun, the same sky for everyone)
    if (this.timedRoom !== net.room.code && net.clock.synced) {
      this.timedRoom = net.room.code;
      const tr = net.roomNow();
      if (Number.isFinite(tr) && Math.abs(tr - this.d.sceneTime()) > 60) {
        this.d.tools.setDate(tr / M_SECONDS);
        this.d.toast(t("The scene set on the room's hour"));
      }
    }
    // (a room flies at ×1 — real time: timeSpeed is in M per second —, its time everyone's; a warp asked is
    // refused, said once)
    const rt = realTimeSpeed(this.d.settings);
    if (Math.abs(this.d.settings.timeSpeed - rt) > rt * 1e-6) {
      c.requestWarp(rt);
      if (!this.warpSaid) this.d.toast(t("In a room the time runs at ×1 for everyone"));
      this.warpSaid = true;
    }
    // the others
    const states = net.remotes.states(net.roomNow()).filter((s) => !s.ghost || s.ahead < 10);
    // (his telemetry heard: our instruments show his)
    if (this.telBound !== net) {
      this.telBound = net;
      net.on("event", ({ from, ev }) => {
        if ((ev as { kind?: string }).kind === "tel") this.tel.set(from, (ev as unknown as { v: Record<string, number> }).v);
      });
    }
    const F = this.follow;
    if (F && !net.room.members.some((m) => m.slot === F.slot)) this.unfollow();
    // (a spectator, an instruments screen: the first pilot followed — the instruments in his cockpit)
    if (!this.follow && net.room.role !== "pilot") {
      const p = net.room.members.filter((m) => m.role === "pilot" && net.remotes.tracks.has(m.slot)).sort((a, b) => a.slot - b.slot)[0];
      if (p) {
        this.setFollow(p.slot);
        if (net.room.role === "instruments") this.d.settings.shipMount = "cockpit";
      }
    }
    const all = c.netShips(
      states.filter((s) => !this.hidden.has(s.slot) || s.slot === this.follow?.slot),
      dt,
    );
    const followed = this.follow ? (all.find((s) => s.slot === this.follow!.slot) ?? null) : null;
    this.ships = all.filter((s) => s.slot !== this.follow?.slot);
    // (his state read straight — the craft placed even when ours is far from the Earth: a spectator in orbit)
    const fstate = this.follow ? (states.find((s) => s.slot === this.follow!.slot) ?? null) : null;
    this.puppetFrame(followed, fstate);
    R.netOthers = this.ships.filter((s) => !s.ghost).map((s) => ({ id: s.id, rel: s.rel, axes: s.axes, jet: s.jet, thrust: s.thrust }));
    const members = new Map(net.room.members.map((m) => [m.slot, m]));
    // (on the F-35's radar: each other in his colour, his track, his height against ours)
    netRadar.contacts = this.ships
      .filter((s) => !s.ghost)
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
    this.tags = this.ships.map((s) => {
      const m = members.get(s.slot);
      return {
        slot: s.slot,
        name: m?.name ?? `#${s.slot}`,
        colour: m?.colour ?? "#ffffff",
        at: [s.rel[0] + eye[0], s.rel[1] + eye[1], s.rel[2] + eye[2]] as Vec3,
        dist: s.dist,
        ghost: s.ghost,
        kind: VESSELS[s.id].name,
      };
    });
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
          !sh.ghost && !(sh.state.flags & 1) && sh.dist < reach && sh.state.ahead < 0.3 && steady(net.remotes.tracks.get(sh.slot)?.samples);
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
    const own = c.netOwn();
    if (!own) {
      this.prev = null;
      return;
    }
    // (the motion's derivatives, measured: the velocity's change, the axes' turn — eased over a few frames)
    const ax: [Vec3, Vec3, Vec3] = [own.fwd, own.up, own.right];
    if (this.prev && now > this.prev.at) {
      const h = now - this.prev.at;
      const k = 1 - Math.exp(-h / 0.08);
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
    this.prev = { at: now, v: own.v, ax };
    const speed = Math.hypot(...own.v);
    const parked = ground && speed < 0.5;
    const near = this.ships.some((s) => s.dist < 5000);
    const rate = parked ? 2 : near ? 60 : 30;
    if (now - this.lastSend < 1 / rate - 0.002) return;
    this.lastSend = now;
    const th = this.d.renderer.shipThrust;
    const L = c.airFlight.last;
    const J = this.d.jetIn();
    const cmd = (k: number) => (J ? clamp(0.55 * J.torque[k]! + 0.75 * J.rates[k]!, -1, 1) : 0);
    const boost = th?.boost ?? 1;
    net.sendCraft({
      frame: 0,
      body: 0,
      kind: kindIndex(fleet.active),
      flags: (ground ? 1 : 0) | (parked ? 2 : 0) | (this.d.settings.navLights ? 4 : 0) | (boost > 1.01 ? 8 : 0),
      p: own.p,
      v: own.v,
      q: axesQuat(own.fwd, own.up, own.right),
      w: this.spin,
      a: ground ? [0, 0, 0] : this.acc,
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

  /** Follow another player (our craft his puppet), or stop. */
  setFollow(slot: number | null, why: "spectate" | "killcam" = "spectate") {
    if (slot === null) return this.unfollow();
    this.follow = { slot, why };
  }

  private unfollow() {
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
    c.puppet = () => c.netPlaceBeside(st, 0);
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
    const now = net.roomNow();
    return net.room.members
      .filter((m) => m.slot !== net.room!.slot)
      .map((m) => ({ slot: m.slot, name: m.name, state: net.remotes.tracks.get(m.slot)?.at(now) ?? null }));
  }

  /**
   * Our craft put beside another's (the tests'): `gap` metres off its right wing, at its speed and attitude —
   * in formation; on the ground, parked beside it. Says what it did.
   */
  teleport(slot: number, gap?: number): string {
    const o = this.others().find((x) => x.slot === slot);
    if (!o) return t("No such player in the room");
    if (!o.state) return tf("{0} has no craft on the Earth now", o.name);
    const c = this.d.camera;
    const s = o.state;
    // (clear of both wingspans: the other's half, ours, a margin)
    const half = (id: string) => (id === "f35" ? 5.4 : id === "ranger" ? 12 : id === "lander" ? 8 : 40);
    const kinds = ["ranger", "lander", "endurance", "f35"];
    const g = gap ?? half(kinds[s.kind] ?? "f35") + half(fleet.active) + 8;
    const place = c.netPlaceBeside(s, g);
    if (!place) return t("The teleport needs your craft near the Earth");
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
