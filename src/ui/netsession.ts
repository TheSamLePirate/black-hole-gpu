// Flying together (docs/PLAN-RESEAU.md, R1) — the frame's side of the network, in the game's bundle: our craft
// sent to the room (30 times a second, 60 near another, twice when parked), its motion's derivatives measured
// between frames; the others brought onto the camera's axes for the renderer, their name tags for the overlay
// and the HUD; the room's time at ×1; a place beside another (the teleport of the tests). The client itself
// (src/net/) is the network module's, loaded when a room was asked for.

import { fmtFactor, realTimeSpeed, roomPace } from "../clock";
import { crewFamilies, crewSnapshot } from "./crew-feed";
import { CrewExec } from "./crew-exec";
import type { Tool } from "../ai/agent";
import type { Info } from "./flighthud";
import type { RangerStatus } from "../game/status";
import type { CameraController } from "../controls";
import type { CarrierSpawn } from "../game/carrier";
import {
  axesQuat,
  kindIndex,
  kindOf,
  NET_BODIES,
  NET_COAST,
  netDockPose,
  netFrame,
  type NetShip,
  netStateHome,
  quatAxes,
} from "../controller/netcraft";
import { netDock } from "../controller/docking";
import { bankAccel, formationBank } from "../game/formation";
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
import { zonalAccel } from "../system/geopotential";
import { solarBody } from "../system/solar";
import { vesselHulls } from "../system/collide";
import { dockedFrame, type VesselId, VESSELS } from "../vessels";
import type { NetPanel } from "./netpanel";
import { formationLabel, formSlotFor } from "../controller/formation";
import { orderOf } from "../game/orders";
import { checkMission, type MissionSpec } from "../game/mission";
import type { MissionShared } from "../controller/mission";
import { type RemoteWing, wingsOut } from "../controller/wingmen";
import { type RadioRole, SHARED_ROLES } from "../game/radio";

type Vec3 = [number, number, number];

/** A name tag over another's craft (ui/overlay.ts draws it): its place on the camera's axes from the eye. */
/** the craft of those away are read as slots from here on (src/net/client.ts AWAY_SLOT, R7) */
const AWAY_SLOT = 200;

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

/** a body's pull at p (its inertial frame [m]) besides its centre's — its flattening: J2, J3, J4 — at scene time t
 *  [s], in m/s² (the game's own model: geopotential.ts) */
function pertOf(body: number, p: Vec3, t: number): Vec3 {
  const id = NET_BODIES[body] ?? "";
  const b = solarBody(id);
  if (!b) return [0, 0, 0];
  const z = zonalAccel(id, b.mass, scale3(p, 1 / M_METRES), t / M_SECONDS);
  return z ? scale3(z as Vec3, (C_MPS * C_MPS) / M_METRES) : [0, 0, 0];
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
  /** another's mission heard (P1): flown with him, on his wing */
  missionJoin?(spec: MissionSpec, from: number, name: string): void;
  /** the game's tools, which the crew's orders run through (main.ts: TARS's — called directly) */
  crewTools?(): Tool[];
  /** another's radio line (I4: his wingmen, his carrier, his LSO) heard on the flight's radio */
  radioHeard?(role: RadioRole, text: string, name: string): void;
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
  private crewSent = -Infinity;
  /** the crew's orders carried out (docs/PLAN-CREW-ACTIONS.md), made at the first one heard */
  private crewExecOf: CrewExec | null = null;
  private get crewExec() {
    const d = this.d;
    this.crewExecOf ??= new CrewExec({
      camera: d.camera,
      settings: d.settings,
      tools: () => d.crewTools?.() ?? [],
      toast: (s) => d.toast(s),
      nameOf: (slot) => this.nameOf(slot),
      families: () => crewFamilies(d.camera),
    });
    return this.crewExecOf;
  }
  private crewAround = -Infinity;

  /** At most 4 Hz, only while an instruments screen is present. No simulator on that screen. */
  instruments(info: Info, status: RangerStatus | null) {
    const net = this.net;
    const now = performance.now();
    if (!net?.room || net.room.role !== "pilot" || this.follow || !this.d.camera.piloting || now - this.crewSent < 250) return;
    if (!net.room.members.some((m) => m.role === "instruments")) return;
    this.crewSent = now;
    // (the surroundings — the traffic, the units, the ships — once a second: the heavier part)
    const around = now - this.crewAround >= 1000;
    if (around) this.crewAround = now;
    net.event({ kind: "instruments", data: crewSnapshot(this.d.camera, info, status, this.d.sceneTime(), around) });
  }
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
  /** when our AI wingmen were last sent [s] */
  private wingSent = 0;
  /** whose wing each player flies in formation (heard every 2 s: his leader's slot, his place in it) — the places
   *  taken when we join the same leader */
  readonly formOf = new Map<number, { lead: number; pos: number; at: number }>();
  private formSent = { lead: -1, pos: 0, at: 0 };
  private cvSent = 0;
  /** the mission we lead last sent (its id, when), the one we last joined */
  private msnSent = { id: "", at: 0 };
  private msnJoined = "";
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
  private lastCoast: { t: number; body: number; p: Vec3; v: Vec3 } | null = null;

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
    // the others' craft to dock to and to meet (R7): their ports held by those docked to them
    netDock.targets = () => {
      const me = this.net?.room?.slot;
      return this.ships
        .filter((sh) => !sh.ghost && this.links.get(sh.slot)?.host !== me)
        .map((sh) => ({
          id: `net:${sh.slot}` as const,
          space: sh.state.frame === 1,
          title: this.awayNames.has(sh.slot)
            ? tf("{0}'s {1} (away)", this.awayNames.get(sh.slot)!.name, VESSELS[sh.id].name)
            : tf("{0}'s {1}", this.nameOf(sh.slot), VESSELS[sh.id].name),
          kind: sh.id,
          used: new Set([...this.links.values()].filter((l) => l.host === sh.slot).map((l) => l.port)),
          pose: (t: number) => {
            const st = this.net?.remotes.track(sh.slot)?.raw(t * M_SECONDS);
            return st ? netDockPose(st, t) : null;
          },
        }));
    };
    netDock.slot = () => this.net?.room?.slot ?? -1;
    netDock.onDock = (d) => {
      const host = slotOf(d.id as Body);
      const me = this.net?.room?.slot ?? -1;
      this.links.set(me, { host, port: d.port, ownPort: d.ownPort, c: d.c, ax: d.ax });
      this.net?.event({ kind: "dock", to: host, port: d.port, ownPort: d.ownPort, c: d.c, ax: d.ax });
    };
    netDock.onUndock = (id) => {
      this.links.delete(this.net?.room?.slot ?? -1);
      this.net?.event({ kind: "undock", to: slotOf(id as Body) });
    };
    netDock.onBump = (id, dv) => this.net?.event({ kind: "bump", to: slotOf(id as Body), dv: dv.map((x) => Math.round(x * 1000) / 1000) });
  }

  /** the blows another's craft dealt ours (R7) */
  bumped = 0;

  /** who is docked to whom (R7): a guest's slot → his host's, the ports, his frame in the host's [m] */
  links = new Map<number, { host: number; port: number; ownPort: number; c: Vec3; ax: [Vec3, Vec3, Vec3] }>();

  private get net() {
    return this.d.panel.net;
  }

  /** The frame: our sample sent when due, the others placed, the room's ×1. */
  frame(dt: number) {
    const net = this.net;
    const R = this.d.renderer;
    if (!net?.room) {
      if (this.follow) this.unfollow();
      // (a formation on another player — not on an airliner of the traffic, slot −1 —: let go out of the room)
      if (this.d.camera.form && this.d.camera.form.slot >= 0) this.d.camera.formOff(t("Formation off — out of the room"));
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
      this.d.camera.radarSources.delete("net");
      this.prev = null;
      return;
    }
    const c = this.d.camera;
    const now = performance.now() / 1000;
    // (TARS's "join <name>" on a room player: his wing — controller/copilot.ts)
    c.netFormation ??= (name) => {
      const n = name.trim().toLowerCase();
      const p = this.others().find((x) => x.name.trim().toLowerCase() === n);
      return p ? this.formation(p.slot) : null;
    };
    // (our orders as the flight's leader: sent to the room)
    if (!c.orderSinks.has("net")) c.orderSinks.set("net", (o) => this.net?.room && this.net.event({ kind: "order", o }));
    // (our AI wingmen sent to the room, 20 times a second — we fly them; the others' heard, a stale host's dropped)
    if (c.wing?.list.length && now - this.wingSent > 0.05) {
      this.wingSent = now;
      net.event({ kind: "wng", w: wingsOut(c) });
    }
    for (const [slot, R] of c.remoteWings) if (now - R.at > 3) c.remoteWings.delete(slot);
    // (our place in a formation on a room player told — at once when it changes, else every 2 s; the others' kept 6 s)
    const fl = c.form?.slot ?? -1;
    const fp = c.form?.pos ?? 0;
    if (fl !== this.formSent.lead || fp !== this.formSent.pos || (fl >= 0 && now - this.formSent.at > 2)) {
      this.formSent = { lead: fl, pos: fp, at: now };
      net.event({ kind: "fml", lead: fl, pos: fp });
    }
    for (const [slot, F] of this.formOf) if (now - F.at > 6) this.formOf.delete(slot);
    // (those on our wing: the protections' leave them be — controller/gcas.ts)
    const me = net.room?.slot;
    c.formWithMe = new Set([...this.formOf].filter(([, F]) => F.lead === me).map(([slot]) => slot));
    // (the carriers at sea sent to the room every 5 s — their course a function of the room's clock: the same
    // carrier on every page, one joining later told too)
    if (c.carriers?.length && now - this.cvSent > 5) {
      this.cvSent = now;
      net.event({ kind: "cv", list: c.carriers });
    }
    // (a mission we lead sent to the room — P1: again every 10 s, for those joining later —; what one has done in it
    // shared as it is done)
    const M = c.mission;
    if (M?.lead && !M.ended && !M.pending.length && (M.run.spec.id !== this.msnSent.id || now - this.msnSent.at > 10)) {
      this.msnSent = { id: M.run.spec.id, at: now };
      net.event({ kind: "msn", spec: M.run.spec });
    }
    c.onMissionState = (st) => this.net?.room && this.net.event({ kind: "mst", st });
    if (!c.radarSources.has("rwg"))
      c.radarSources.set("rwg", (fix) =>
        [...c.remoteWings.entries()].flatMap(([slot, R]) =>
          // (one shot down, falling to its crash: no longer a track)
          R.list
            .filter((w) => !w.x)
            .map((w) => ({
              id: `rwg:${slot}:${w.k}`,
              r: fix.toLocal(w.p as [number, number, number]),
              v: [0, 1, 2].map((i) => (i === 0 ? fix.E : i === 1 ? fix.N : fix.U).reduce((s, x, k) => s + x * w.v[k]!, 0)) as [
                number,
                number,
                number,
              ],
              rcs: 4,
              kind: "air" as const,
              iff: "friend" as const,
              name: `${R.name} ${w.k}`,
              squawk: true,
              offboard: true,
            })),
        ),
      );
    this.alightStep(now);
    this.pace(net, now);
    // the others
    // (each other's craft at our scene's time — what we draw; the samples carry their sender's — R6: a clock a
    // little off the room's misplaces nobody)
    const states = net.remotes.states(this.d.sceneTime()).filter((s) => !s.ghost || s.ahead < 10);
    // (his telemetry heard: our instruments show his)
    if (this.telBound !== net) {
      this.telBound = net;
      // the persistent world (R7): the craft of those away, each where he left it (on its orbit, carried on)
      const placeAway = () => {
        for (const tr of [...net.remotes.tracks.values()]) if (tr.slot >= AWAY_SLOT) net.remotes.drop(tr.slot);
        this.awayNames.clear();
        net.away.forEach((a, i) => {
          net.remotes.setAway(AWAY_SLOT + i, a.sample);
          this.awayNames.set(AWAY_SLOT + i, { name: a.name, colour: a.colour });
        });
      };
      placeAway();
      net.on("world", placeAway);
      net.on("event", ({ from, ev }) => {
        const e = ev as { kind?: string; to?: number };
        if (e.kind === "crew-cmd") void this.crewExec.handle(net, from, ev);
        else if (e.kind === "tel") this.tel.set(from, (ev as unknown as { v: Record<string, number> }).v);
        else if (e.kind === "wng") {
          // (another's AI wingmen — F3: his host's flying, drawn and on our radar here)
          const list = (ev as unknown as { w?: unknown }).w;
          if (!Array.isArray(list)) return;
          const ok = (a: unknown, n = 3) => Array.isArray(a) && a.length === n && a.every((x) => Number.isFinite(x));
          this.d.camera.remoteWings.set(from, {
            at: performance.now() / 1000,
            name: this.nameOf(from),
            list: (list as RemoteWing[]).filter((w) => Number.isFinite(w.k) && ok(w.p) && ok(w.v) && ok(w.f) && ok(w.u)).slice(0, 3),
          });
        } else if (e.kind === "cv") {
          // (another's carriers — M2: each kind the one set off first, the room's)
          const list = (ev as unknown as { list?: unknown }).list;
          if (!Array.isArray(list)) return;
          const cam = this.d.camera;
          const ok = (x: CarrierSpawn) =>
            ["ford", "kiev", "implacable"].includes(x?.kind) &&
            [x.lat, x.lon, x.heading, x.speed, x.t0, x.seed].every((v) => Number.isFinite(v));
          const mine = new Map((cam.carriers ?? []).map((x) => [x.kind, x]));
          for (const x of (list as CarrierSpawn[]).filter(ok).slice(0, 3)) {
            const had = mine.get(x.kind);
            if (!had || x.t0 < had.t0) mine.set(x.kind, { ...x });
          }
          cam.carriers = [...mine.values()];
        } else if (e.kind === "msn") {
          // (another's mission — P1: flown with him once, unless we fly it already)
          const { spec } = checkMission((ev as unknown as { spec?: unknown }).spec);
          const cam = this.d.camera;
          if (!spec || cam.mission?.run.spec.id === spec.id || this.msnJoined === spec.id) return;
          this.msnJoined = spec.id;
          this.d.missionJoin?.(spec, from, this.nameOf(from));
        } else if (e.kind === "mst") {
          // (what another has done in our shared mission)
          const st = (ev as unknown as { st?: MissionShared }).st;
          if (!st || typeof st.id !== "string" || !st.state || typeof st.state !== "object") return;
          this.d.camera.missionApply(st);
        } else if (e.kind === "radio") {
          // (another's roles on the flight's radio — I4: his wingmen, his carrier, its LSO)
          const r = ev as unknown as { role?: unknown; text?: unknown };
          if (typeof r.text !== "string" || !SHARED_ROLES.includes(r.role as RadioRole)) return;
          this.d.radioHeard?.(r.role as RadioRole, r.text.slice(0, 240), this.nameOf(from));
        } else if (e.kind === "fml") {
          const f = ev as unknown as { lead?: unknown; pos?: unknown };
          if (typeof f.lead === "number" && f.lead >= 0 && typeof f.pos === "number")
            this.formOf.set(from, { lead: f.lead, pos: f.pos, at: performance.now() / 1000 });
          else this.formOf.delete(from);
        } else if (e.kind === "order") {
          // (a leader's order — F2: heard, carried out in formation on him; "rejoin" heard out of one: on his wing)
          const o = orderOf((ev as unknown as { o: unknown }).o);
          if (!o) return;
          const cam = this.d.camera;
          const said = cam.orderHeard(o, { name: this.nameOf(from), slot: from });
          cam.onPilotMessage?.(said);
          cam.onRadio?.(said);
          if (o.id === "rejoin" && cam.form?.slot !== from && VESSELS[fleet.active].flies) this.formation(from);
        } else if (e.kind === "board" && typeof e.to === "number") {
          this.aboard.set(from, e.to);
          if (e.to === net.room?.slot) this.d.toast(tf("{0} is aboard", this.nameOf(from)));
        } else if (e.kind === "dock" && typeof e.to === "number") {
          const d = ev as unknown as { port: number; ownPort: number; c: Vec3; ax: [Vec3, Vec3, Vec3] };
          this.links.set(from, { host: e.to, port: d.port, ownPort: d.ownPort, c: d.c, ax: d.ax });
          if (e.to === net.room?.slot) this.d.toast(tf("{0} docked to your {1}", this.nameOf(from), VESSELS[fleet.active].name));
        } else if (e.kind === "undock") {
          if (this.links.get(from)?.host === net.room?.slot) this.d.toast(tf("{0} undocked", this.nameOf(from)));
          this.links.delete(from);
        } else if (e.kind === "bump" && e.to === net.room?.slot) {
          const dv = (ev as unknown as { dv: Vec3 }).dv;
          if (Array.isArray(dv) && dv.length === 3) {
            this.d.camera.netBumped(dv);
            this.bumped++;
          }
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
    for (const [g, l] of this.links)
      if (!net.room.members.some((m) => m.slot === g) || !net.room.members.some((m) => m.slot === l.host)) this.links.delete(g);
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
    // (those docked to our craft: held on it)
    const attached = new Map([...this.links].filter(([, l]) => l.host === net.room!.slot).map(([g, l]) => [g, { c: l.c, ax: l.ax }]));
    const all = c.netShips(
      states.filter((s) => !this.hidden.has(s.slot) || s.slot === this.follow?.slot),
      dt,
      Infinity,
      attached,
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
      .map((s) => ({
        slot: s.slot,
        side: s.side,
        id: s.id,
        rel: s.rel,
        axes: s.axes,
        X: s.X,
        axesHome: s.axesHome,
        jet: s.jet,
        thrust: s.thrust,
      }));
    const members = new Map(net.room.members.map((m) => [m.slot, m]));
    // (the F-35's radar — controller/radar.ts —: the room's others over the Earth, friends on its datalink — a
    // match's are its fight's targets instead)
    if (!c.radarSources.has("net"))
      c.radarSources.set("net", (fix) => {
        if (!this.net?.room || c.combat?.net) return [];
        const mem = new Map(this.net.room.members.map((m) => [m.slot, m]));
        return this.ships
          .filter((s) => !s.ghost && s.state.frame === 0 && s.state.body === 0)
          .map((s) => {
            const v = s.state.v as Vec3;
            return {
              id: `net:${s.slot}`,
              r: fix.toLocal(s.state.p as Vec3),
              v: [
                v[0] * fix.E[0] + v[1] * fix.E[1] + v[2] * fix.E[2],
                v[0] * fix.N[0] + v[1] * fix.N[1] + v[2] * fix.N[2],
                v[0] * fix.U[0] + v[1] * fix.U[1] + v[2] * fix.U[2],
              ] as Vec3,
              rcs: s.id === "f35" ? 0.005 : 20,
              kind: s.state.flags & 1 ? ("ground" as const) : ("air" as const),
              iff: "friend" as const,
              name: this.nameOf(s.slot),
              squawk: true,
              offboard: true,
              colour: mem.get(s.slot)?.colour ?? this.awayNames.get(s.slot)?.colour,
            };
          });
      });
    // (on the F-35's radar: each other in his colour, his track, his height against ours)
    netRadar.contacts = this.ships
      .filter((s) => !s.ghost && s.dist < 60_000)
      .map((s) => ({
        ...s.radar,
        air: !(s.state.flags & 1),
        alive: true,
        locked: false,
        seen: true,
        name: this.nameOf(s.slot),
        colour: members.get(s.slot)?.colour ?? this.awayNames.get(s.slot)?.colour ?? "#ffffff",
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
        name: this.nameOf(s.slot),
        colour: m?.colour ?? this.awayNames.get(s.slot)?.colour ?? "#ffffff",
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
    // (those on the other side of the wormhole: a tag on its mouth, the way to them)
    const seen = new Set(this.tags.map((g) => g.slot));
    const mouthAt = c.netMouthCam();
    const byHole = mouthAt ? c.netOwnState()?.frame === 2 : false;
    if (mouthAt)
      for (const st of states) {
        if (seen.has(st.slot) || st.ghost || st.kind === 4) continue;
        const there = (st.frame === 2) !== byHole;
        if (!there) continue;
        seen.add(st.slot);
        this.tags.push({
          slot: st.slot,
          name: this.nameOf(st.slot),
          colour: members.get(st.slot)?.colour ?? "#ffffff",
          at: mouthAt.at,
          dist: mouthAt.dist,
          ghost: false,
          kind: st.frame === 2 ? t("by Gargantua — through the wormhole") : t("in our solar system — through the wormhole"),
        });
      }
    // (their clocks: a proper time far off the room's — by Gargantua — said on their tags; R8)
    for (const g of this.tags) {
      const tau = this.tel.get(g.slot)?.tau;
      if (tau !== undefined && tau < 0.95) g.kind += ` · τ ×${tau < 0.01 ? tau.toExponential(1) : tau.toFixed(2)}`;
    }
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
    // (in the Earth's air only: in space a touch is the docking's contact — its bounce, its share of the blow)
    if (!ground && ownNow && ownNow.h < 100_000 && now - this.collidedAt > 5 && now - this.placedAt > 2)
      for (const sh of this.ships) {
        if (sh.state.frame !== 0) continue;
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
        // (a glitch cut, not a pull: by Gargantua an orbit about Miller is pulled 6 km/s² — R8)
        const aMax = own.frame === 2 ? 1e5 : 400;
        this.acc[i] = this.acc[i]! + (clamp(a[i]!, -aMax, aMax) - this.acc[i]!) * k;
        this.spin[i] = this.spin[i]! + (clamp(w[i]!, -10, 10) - this.spin[i]!) * k;
      }
    }
    this.prev = { at: now, st, frame: own.frame, v: own.v, ax };
    const speed = Math.hypot(...own.v);
    // (on the Earth: its ground as the collisions read it; landed elsewhere — the Moon, Mars —: on it)
    const onGnd = own.frame === 0 && (own.body === 0 ? ground : true);
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
            // (as the others reckon it: Kepler, and the body's flattening at the place — remote.ts)
            const k = keplerOf(LC.body, LC.p, LC.v, st - LC.t);
            const g = k ? pertOf(LC.body, k.p, st) : null;
            return k && g ? Math.hypot(...k.p.map((x, i) => x + 0.5 * g[i]! * (st - LC.t) ** 2 - own.p[i]!)) : Infinity;
          })()
        : Infinity;
    if (now - this.lastSend < 1 / rate - 0.002 && coast === this.coastSent && !(coast && off > 20)) return;
    this.lastSend = now;
    this.coastSent = coast;
    const L = c.airFlight.last;
    const J = this.d.jetIn();
    const cmd = (k: number) => (J ? clamp(0.55 * J.torque[k]! + 0.75 * J.rates[k]!, -1, 1) : 0);
    const boost = th?.boost ?? 1;
    this.lastCoast = coast ? { t: st, body: own.body, p: own.p, v: own.v } : null;
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
      // (coasting: none — the others reckon its pulls with the game's own model)
      a: onGnd || coast ? [0, 0, 0] : this.acc,
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
          // (our proper time's rate against the room's clock — R8: by Gargantua, slow)
          tau: Math.round(c.netClockRate() * 1e4) / 1e4,
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
    net.remotes.env.pert ??= pertOf;
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
  /** A line of our own roles (I4) on the flight's radio: the room's pilots hear it. */
  radio(role: RadioRole, text: string) {
    if (this.net?.room && SHARED_ROLES.includes(role)) this.net.event({ kind: "radio", role, text });
  }

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
    const away = this.awayNames.get(slot);
    if (away) return tf("{0} (away)", away.name);
    return this.net?.room?.members.find((m) => m.slot === slot)?.name ?? `#${slot}`;
  }

  /** the craft of those away (R7): their pseudo-slots' names and colours */
  awayNames = new Map<number, { name: string; colour: string }>();

  /**
   * Back to our craft as we left it in this room (R7): its kind, its place — parked where it stood, or on its orbit
   * carried on to now. Says what it did.
   */
  resume(): string {
    const net = this.net;
    const S = net?.mine;
    const id = S ? kindOf(S.kind) : null;
    if (!net?.room || !S || !id) return t("No craft of yours in this room's world");
    if (!net.clock.synced || this.timedRoom !== net.room.code) return t("The room's clock is still being set — a moment");
    const c = this.d.camera;
    const st = net.remotes.stateOf(S, this.d.sceneTime());
    if (!st) return t("No craft of yours in this room's world");
    if (fleet.active !== id) this.d.tools.set("vessel", id);
    const place = c.netPlaceBeside(st, 0);
    if (!place) return t("The teleport needs your craft on our side of the wormhole");
    const ground = (st.flags & 1) !== 0;
    this.d.tools.placeAt({ frame: "ours", ...place, note: t("Back to your craft") });
    c.pilot.auto = "none";
    c.gearInit = true;
    c.gearDown = ground || st.vis.gear > 0.5;
    c.gearExt = c.gearDown ? 1 : 0;
    c.pilot.throttle = 0;
    net.mine = null;
    this.prev = null;
    return t("Back to your craft");
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

  /**
   * Our craft put on the axis of another's free docking port (the tests', R7): `dist` metres out, its own port
   * facing it, closing at `closing` m/s; with its velocity and turn. Says what it did.
   */
  placeAtPort(slot: number, dist = 20, closing = 0): string {
    const N = netDock.targets().find((q) => q.id === `net:${slot}`);
    if (!N) return t("No such player in the room");
    const t0 = this.d.camera.nowTime();
    const H = N.pose(t0);
    const k = VESSELS[N.kind].ports.findIndex((_, i) => !N.used.has(i));
    const gp = VESSELS[fleet.active].ports[0];
    if (!H || k < 0 || !gp) return t("No free port to dock to");
    const hp = VESSELS[N.kind].ports[k]!;
    const on = (A: [Vec3, Vec3, Vec3], v: Vec3): Vec3 => [0, 1, 2].map((i) => A[0][i]! * v[0] + A[1][i]! * v[1] + A[2][i]! * v[2]) as Vec3;
    const D = dockedFrame(gp, hp, [0, 1, 0]);
    const ha = on(H.ax, hp.axis);
    const X = [0, 1, 2].map((i) => H.X[i]! + (on(H.ax, D.c)[i]! + ha[i]! * dist) / M_METRES) as Vec3;
    const ax = D.ax.map((col) => on(H.ax, col)) as [Vec3, Vec3, Vec3];
    const r = [0, 1, 2].map((i) => X[i]! - H.X[i]!) as Vec3;
    const w = H.w ?? [0, 0, 0];
    const wr: Vec3 = [w[1] * r[2] - w[2] * r[1], w[2] * r[0] - w[0] * r[2], w[0] * r[1] - w[1] * r[0]];
    const vel = [0, 1, 2].map((i) => H.V[i]! + wr[i]! - (ha[i]! * closing) / C_MPS) as Vec3;
    this.d.tools.placeAt({
      frame: "ours",
      X,
      vel,
      fwd: ax[2],
      up: ax[1],
      note: tf("On {0}'s {1}, {2} m out", N.title, hp.name, Math.round(dist)),
    });
    const c = this.d.camera;
    if (c.pilot.auto !== "none") c.pilot.setAuto(c.pilot.auto);
    c.pilot.auto = "none";
    c.pilot.throttle = 0;
    this.prev = null;
    return tf("On {0}'s {1}, {2} m out", N.title, hp.name, Math.round(dist));
  }

  /**
   * Beside another on foot (R5): our craft parked by his on that ground (when his stands there), then on foot
   * 2.5 m off his right, facing his way. Says what it did.
   */
  private besideOnFoot(name: string, W: CraftState, craft: CraftState | null): string {
    const c = this.d.camera;
    const body = NET_BODIES[W.body];
    if (!body) return tf("{0} walks where we cannot follow", name);
    if (craft && craft.body === W.body && craft.frame === 0 && craft.flags & 1) {
      const half = (id: string) => (id === "f35" ? 5.4 : id === "ranger" ? 12 : id === "lander" ? 8 : 40);
      const place = c.netPlaceBeside(craft, half(kindOf(craft.kind) ?? "f35") + half(fleet.active) + 8);
      if (place) {
        this.d.tools.placeAt({ ...place, frame: place.frame ?? "ours", note: tf("Parked by {0}'s craft", name) });
        c.pilot.auto = "none";
        c.gearInit = true;
        c.gearDown = true;
        c.gearExt = 1;
        c.pilot.throttle = 0;
      }
    }
    const ax = quatAxes(W.q);
    const at = [0, 1, 2].map((k) => W.p[k]! + ax.right[k]! * 2.5) as Vec3;
    const err = c.character.startAt(body, at, ax.fwd);
    this.prev = null;
    return err ?? tf("On foot beside {0}", name);
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
  /**
   * Formation flight on another's craft (game/formation.ts): our jet's systems flying a slot off his wing —
   * `side` his right or left, `back` behind him (15 m), `up` above [m], the gap clear of both wingspans by 15 m —, he read off the network each
   * frame (his track at our scene's time, his acceleration over its last second). Far off (> 20 km) or on
   * the ground: Beside first, then the formation. Again on the same one: off.
   */
  /** the player whose wing we fly in formation, null: none */
  formSlot(): number | null {
    return this.d.camera.form?.slot ?? null;
  }

  /** The first place free in a formation on `lead` (2–4): not his AI wingmen's, not another player's on his wing
   *  (heard); none free: 0. */
  freePlace(lead: number): number {
    const c = this.d.camera;
    const taken = new Set<number>();
    for (const w of c.remoteWings.get(lead)?.list ?? []) taken.add(w.k);
    const me = this.net?.room?.slot;
    for (const [slot, F] of this.formOf) if (slot !== me && F.lead === lead) taken.add(F.pos);
    for (const p of [2, 3, 4]) if (!taken.has(p)) return p;
    return 0;
  }

  /** The room's pilots flying in the Earth's air now — whose wing we may join (the wheel's Flight). */
  leaders(): { slot: number; name: string }[] {
    return this.others()
      .filter((x) => x.state && x.state.frame === 0 && x.state.body === 0 && (x.state.flags & 1) === 0)
      .map((x) => ({ slot: x.slot, name: x.name }));
  }

  formation(slot: number, o: { side?: "right" | "left"; gap?: number; back?: number; up?: number } = {}): string {
    const c = this.d.camera;
    if (c.form?.slot === slot) {
      c.formOff();
      return t("Formation off — altitude, heading and speed held");
    }
    if (!this.net?.room) return t("Not in a room");
    const p = this.others().find((x) => x.slot === slot);
    if (!p) return t("No such player in the room");
    const s = p.state;
    if (!s || s.frame !== 0 || s.body !== 0 || (s.flags & 1) !== 0)
      return tf("{0} is not flying in the Earth's air — formation in the air only", p.name);
    if (!VESSELS[fleet.active].flies) return t("Formation: a craft that flies (the F-35, the Ranger)");
    const half = (id: string) => (id === "f35" ? 5.4 : id === "ranger" ? 12 : id === "lander" ? 8 : 40);
    const kinds = ["ranger", "lander", "endurance", "f35"];
    // (an echelon: clear of both wingspans by 15 m, 15 m back — room for his roll into a turn, a gust)
    const gap = o.gap ?? half(kinds[s.kind] ?? "f35") + half(fleet.active) + 15;
    // (in his air, near enough to rejoin: from where we are — else Beside first)
    const own = c.netOwn();
    const far = !own || !c.jetFigures() || Math.hypot(...[0, 1, 2].map((k) => s.p[k]! - own.p[k]!)) > 20_000;
    if (far) {
      const n = this.d.tools.placings;
      const said = this.teleport(slot, gap);
      if (this.d.tools.placings === n) return said;
    }
    this.d.settings.flightMode = "plane";
    if (c.icpt) c.icptOff();
    c.brk = c.holdPat = null;
    c.jetModes.bankMax = c.jetModes.order = undefined;
    const tr = () => this.net?.remotes.track(slot);
    // (his turn from his bank — eased over a quarter second, his roll's own shake left out — and led by his roll's
    // rate 0.8 s on: ours to answer it takes about that)
    let phi = Number.NaN,
      roll = 0,
      at = Number.NaN;
    // (the place: as asked — a side, a gap —, else ours in the formation chosen, its close slots widened to the
    // two craft's spans)
    const S = this.d.settings;
    // (our place: the first free on his wing — his AI wingmen's and the others' heard taken —; all taken: trailing
    // him, a place further back for each of us)
    const free = this.freePlace(slot);
    const trail = free === 0 ? 1 + [...this.formOf.values()].filter((F) => F.lead === slot && F.pos === 0).length : 0;
    const legacy = o.side !== undefined || o.gap !== undefined || o.back !== undefined || o.up !== undefined || trail > 0;
    const pos = free || S.formPos;
    const place = trail
      ? { right: 0, back: 60 * trail + 20, up: -10 * trail }
      : legacy
        ? { right: o.side === "left" ? -gap : gap, back: o.back ?? 15, up: o.up ?? 0 }
        : formSlotFor(S.formShape, pos, S.formSpacing, gap / 26);
    c.form = {
      slot,
      name: p.name,
      at: place,
      shape: legacy ? undefined : S.formShape,
      pos: legacy ? 0 : pos,
      spacing: S.formSpacing,
      kspan: gap / 26,
      since: performance.now() / 1000,
      armed: false,
      last: null,
      lead: () => {
        const T = tr();
        const now = this.d.sceneTime();
        const W = T?.at(now);
        if (!W || W.ghost || W.frame !== 0 || W.body !== 0 || (W.flags & 1) !== 0) return null;
        // (his acceleration over the last second: his turns, his speed's changes — the samples' noise averaged)
        const W0 = T!.at(now - 1);
        const a = W0 && !W0.ghost ? [0, 1, 2].map((k) => W.v[k]! - W0.v[k]!) : [0, 0, 0];
        const ax = quatAxes(W.q);
        const raw = formationBank(W.p, ax.up, ax.right);
        if (Number.isFinite(phi) && now > at) {
          const dt = now - at;
          const next = phi + (raw - phi) * Math.min(1, dt / 0.25);
          roll += ((next - phi) / dt - roll) * Math.min(1, dt / 0.5);
          phi = next;
        } else if (!Number.isFinite(phi)) phi = raw;
        at = now;
        return { p: W.p, v: W.v, a, fwd: ax.fwd, aLat: bankAccel(phi + roll * 0.8) };
      },
    };
    if (trail) return tf("In trail behind {0} — {1} m", p.name, place.back);
    if (!legacy) return tf("Formation {0} on {1} — #{2}", formationLabel(S.formShape), p.name, pos);
    const where = o.side === "left" ? tf("off {0}'s left wing", p.name) : tf("off {0}'s right wing", p.name);
    return tf("Formation {0} — {1} m", where, Math.round(gap));
  }

  teleport(slot: number, gap?: number): string {
    // (not before our scene is on the room's clock: set on it after, we would be carried off his place)
    if (!this.net?.clock.synced || this.timedRoom !== this.net.room?.code) return t("The room's clock is still being set — a moment");
    const o = this.others().find((x) => x.slot === slot);
    if (!o) return t("No such player in the room");
    // (he walks: we walk beside him — our craft parked by his, if his stands on that ground)
    const W = this.net.remotes.track(slot, true)?.at(this.d.sceneTime());
    if (W && !W.ghost) return this.besideOnFoot(o.name, W, o.state);
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
    this.d.tools.placeAt({ ...place, frame: place.frame ?? "ours", note: tf("Beside {0}", o.name) });
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
