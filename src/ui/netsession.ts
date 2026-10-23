// Flying together (docs/PLAN-RESEAU.md, R1) — the frame's side of the network, in the game's bundle: our craft
// sent to the room (30 times a second, 60 near another, twice when parked), its motion's derivatives measured
// between frames; the others brought onto the camera's axes for the renderer, their name tags for the overlay
// and the HUD; the room's time at ×1; a place beside another (the teleport of the tests). The client itself
// (src/net/) is the network module's, loaded when a room was asked for.

import { fmtFactor, realTimeSpeed, roomPace } from "../clock";
import { crewFamilies, fitSnapshot, crewSnapshot, picCatchUp } from "./crew-feed";
import { store } from "../util/storage";

/** the light delay to the crew's ground stations (settings.netLightDelay's values) */
export type LightDelay = "real" | "tenth" | "off";
/** a room's owner token, kept by the page that created it (ui/netpanel.ts: its known rooms) */
const ownerTokenOf = (code: string) =>
  store.getJSON<{ code?: string; owner?: string }[]>("kerr.net.rooms", []).find((k) => k?.code === code)?.owner ?? null;
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
import { BODY_NAMES, type Body, isNetTarget, netTargetId, netTargets } from "../targeting";
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
import { dockedFrame, isAircraft, type VesselId, VESSELS } from "../vessels";
import type { NetPanel } from "./netpanel";
import { formationLabel, formSlotFor } from "../controller/formation";
import { orderOf } from "../game/orders";
import { checkMission, type MissionSpec } from "../game/mission";
import type { MissionShared } from "../controller/mission";
import { type RemoteWing, wingsOut } from "../controller/wingmen";
import { type RadioRole, SHARED_ROLES } from "../game/radio";
import { type RoomResult, refTitle, resultOf, resultText } from "../net/roomboard";
import { COOP_MISSIONS, coopVerdict, type RoleState } from "../game/coopmissions";
import type { FlightReport } from "../game/report";
import { amountOf, amountText, giveAmount, isShareWhat, roomFor, type ShareWhat } from "../net/spaceshare";
import { SYSTEMS } from "../game/systems";
import { propellantKg, spentFor } from "../game/propellant";
import { fuelOn } from "../engine";
import type { ManeuverNode } from "../maneuver";
import { type Act, readCrewAck, sayOf } from "../net/crewcmd";
import { lang } from "../i18n";
import { sound } from "../audio/engine";
import { roomCraft } from "../net/spacefleet";
import {
  isSpaceOrder,
  orderAsk,
  orderPlan,
  proximity,
  rangeText,
  SPACE_VESSELS,
  type SpaceOrder,
  type SpaceTel,
  spaceTelOf,
} from "../net/spacefleet";

type Vec3 = [number, number, number];

/** A name tag over another's craft (ui/overlay.ts draws it): its place on the camera's axes from the eye. */
/** the craft of those away are read as slots from here on (src/net/client.ts AWAY_SLOT, R7) */
const AWAY_SLOT = 200;

/** a craft's door off its side [m] (controller/character.ts accessOffset) */
const ACCESS: Record<VesselId, number> = { ranger: 9, lander: 13, endurance: 75, f35: 8, a320: 12 };

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
  /** a co-op mission's role set up and begun (PLAN-VAISSEAUX N5); what to say */
  coopStart?(missionId: string, roleId: string): string;
  /** a spacecraft's challenge set up and begun (PLAN-VAISSEAUX N4: a room challenge accepted); what to say */
  spaceChallenge?(id: string): string;
  /** a question to the pilot (PLAN-VAISSEAUX N: another's order, his request): accepted or refused, or let lapse */
  ask?(text: string, answer: (yes: boolean) => void, testid?: string): void;
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

/** an age said short: 4 min, 2 h 10, 3 d */
function formatAge(s: number): string {
  if (s < 3600) return tf("{0} min", Math.max(1, Math.round(s / 60)));
  if (s < 86400 * 2) return tf("{0} h {1}", Math.floor(s / 3600), String(Math.floor((s % 3600) / 60)).padStart(2, "0"));
  return tf("{0} d", Math.round(s / 86400));
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
      aboard: (slot) => this.aboard.get(slot) === this.net?.room?.slot,
      spaceOrder: (slot, o) => this.spaceOrder(slot, o),
    });
    return this.crewExecOf;
  }
  private crewAround = -Infinity;
  /** the snapshots lightened to fit the room's limit (RD1: a long one would be dropped by the server) */
  crewCut = 0;
  /** the crew screens met (a new one: the picture's catch-up — RD5) */
  private crewsSeen = new Set<number>();
  /** the crew screens' stations aboard, as we answered them (AUDIT-CREW priority 6: aboard on the pilot's agreement) */
  crewAboard = new Map<number, boolean>();
  /** the light's link to the ground now (the last snapshot's): the ground stations' orders and messages held by it */
  groundLink: { light: number; delay?: number; cut: boolean } | null = null;
  /** the ground stations' messages held behind the wormhole, delivered when the link comes back */
  private heldMsgs: (() => void)[] = [];
  /** a crew screen on the ground (not accepted aboard): its orders and messages held the light's time, refused cut */
  groundOf(from: number): { delay: number; cut: boolean } | null {
    const m = this.net?.room?.members.find((x) => x.slot === from);
    if (m?.role !== "instruments" || this.crewAboard.get(from) === true) return null;
    const L = this.groundLink;
    return L ? { delay: L.cut ? 0 : Math.max(0, L.delay ?? L.light), cut: L.cut } : { delay: 0, cut: false };
  }
  /** the room's light delay to the ground, its owner's (AUDIT-CREW priority 6 — server-checked: null, none said yet) */
  roomDelay: LightDelay | null = null;
  private roomDelayCode: string | null = null;
  private delaySent: LightDelay | null = null;
  /** the light delay played for the crew's ground stations: the room's, else our own setting (an older server) */
  lightDelay(): LightDelay {
    return this.roomDelay ?? this.d.settings.netLightDelay;
  }
  /** whether we own the room we are in (its token kept here: we created it) */
  ownsRoom(): boolean {
    const room = this.net?.room;
    return !!room && !!ownerTokenOf(room.code);
  }
  /** the room's light delay: ours, its owner, said to the room when it changes — the server checks the token and keeps it
   *  for newcomers (a server without the feature: nothing said, each pilot's own setting) */
  private roomDelayStep() {
    const net = this.net!;
    const room = net.room!;
    if (this.roomDelayCode !== room.code) {
      this.roomDelayCode = room.code;
      this.roomDelay = null;
      this.delaySent = null;
    }
    if (!net.server.f.includes("room-delay")) return;
    const owner = ownerTokenOf(room.code);
    const want = this.d.settings.netLightDelay;
    if (owner && this.delaySent !== want && net.status === "online") {
      if (net.event({ kind: "room-delay", value: want, owner } as never)) {
        this.delaySent = want;
        this.roomDelay = want;
      }
    }
  }

  /** At most 4 Hz, only while an instruments screen is present. No simulator on that screen. */
  instruments(info: Info, status: RangerStatus | null) {
    this.lastStatus = status;
    const net = this.net;
    const now = performance.now();
    if (!net?.room || net.room.role !== "pilot" || this.follow || !this.d.camera.piloting || now - this.crewSent < 250) return;
    if (!net.room.members.some((m) => m.role === "instruments")) return;
    this.crewSent = now;
    // (a crew come: the picture's dictionary and histories sent again — RD5)
    const crews = net.room.members.filter((m) => m.role === "instruments").map((m) => m.slot);
    if (crews.some((s) => !this.crewsSeen.has(s))) picCatchUp(this.d.camera);
    this.crewsSeen = new Set(crews);
    // (the surroundings — the traffic, the units, the ships — once a second: the heavier part)
    const around = now - this.crewAround >= 1000;
    if (around) this.crewAround = now;
    // (under the room's limit on an event: the heaviest parts lightened first — what was cut counted, RD1)
    const fit = fitSnapshot(
      crewSnapshot(
        this.d.camera,
        info,
        status,
        this.d.sceneTime(),
        around,
        this.lightDelay(),
        [...this.crewAboard].filter(([, v]) => v).map(([k]) => k),
      ),
    );
    if (fit.cut.length) this.crewCut++;
    this.groundLink = fit.data.link ?? null;
    if (this.heldMsgs.length && !this.groundLink?.cut) for (const say of this.heldMsgs.splice(0)) say();
    net.event({ kind: "instruments", data: fit.data });
  }
  /** the flight's status last told (main.ts, each frame: instruments) */
  private lastStatus: RangerStatus | null = null;
  /** the room's spacecraft as their pilots tell them (PLAN-VAISSEAUX N1 — net/spacefleet.ts), ours among them */
  spaceTel = new Map<number, SpaceTel>();
  private stelAt = -Infinity;
  /** the others' craft from ours: how far [m], how fast closing [m/s] — this frame's, seen in our universe */
  near = new Map<number, { range: number; closing: number }>();
  private nearPrev = new Map<number, { d: number; at: number }>();
  private proxAt = new Map<number, number>();
  /** the orders we gave, their answers (slot → what was said back) */
  orderAnswers = new Map<number, { o: SpaceOrder; yes: boolean }>();
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
      sound.othersFrame(null);
      roomCraft.list = () => [];
      if (netFrame.ships.length) netFrame.ships = [];
      if (netRadar.contacts.length) netRadar.contacts = [];
      this.d.camera.radarSources.delete("net");
      this.prev = null;
      this.roomDelay = null;
      this.roomDelayCode = null;
      this.crewAboard.clear();
      return;
    }
    this.roomDelayStep();
    const c = this.d.camera;
    const now = performance.now() / 1000;
    // (our co-op role's progress told to the room — N5)
    c.onMissionProgress ??= (p) => this.coopProgress(p);
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
        if (e.kind === "crew-cmd") {
          // (a ground station's order: the light's time held here — whatever its console did —, refused behind the
          // wormhole; one aboard, accepted: at once — AUDIT-CREW priority 6)
          const G = e.to === net.room?.slot ? this.groundOf(from) : null;
          if (G?.cut) return void this.crewExec.refuseCut(net, from, ev);
          if (G && G.delay > 0.05) setTimeout(() => void this.crewExec.handle(net, from, ev), G.delay * 1000);
          else void this.crewExec.handle(net, from, ev);
        } else if (e.kind === "crew-aboard" && e.to === net.room?.slot) {
          // (a crew screen asks for a station aboard: the pilot's agreement — its orders live then, no light's time)
          const m = net.room?.members.find((x) => x.slot === from);
          if (m?.role !== "instruments") return;
          const st = String((ev as unknown as { station?: unknown }).station ?? "").slice(0, 24);
          const answer = (yes: boolean) => {
            this.crewAboard.set(from, yes);
            this.net?.event({ kind: "crew-aboard-ok", to: from, ok: yes });
            this.d.toast(yes ? tf("{0} is aboard", this.nameOf(from)) : tf("{0} stays on the ground", this.nameOf(from)));
          };
          if (this.d.ask) this.d.ask(tf("{0} asks to be aboard ({1})", this.nameOf(from), st), answer, "net-crew-aboard");
          else answer(false);
        } else if (e.kind === "crew-msg") {
          // (a crew member's message — PLAN-VAISSEAUX K5: the ground's arrive late; behind the wormhole, recorded and
          // delivered when the link came back, its age said)
          const m = ev as unknown as { text?: unknown; rec?: unknown; to?: unknown };
          // (to the pilot it was meant for)
          if (typeof m.to === "number" && m.to !== net.room?.slot) return;
          const text = typeof m.text === "string" ? m.text.slice(0, 280) : "";
          if (!text) return;
          const rec = typeof m.rec === "number" && Number.isFinite(m.rec) && m.rec > 60 ? m.rec : 0;
          const who = this.nameOf(from);
          const say = () =>
            this.d.toast(rec ? tf("Recorded message from {0} ({1} ago): {2}", who, formatAge(rec), text) : tf("{0}: {1}", who, text));
          // (from the ground: the light's time held here, kept behind the wormhole until the link comes back)
          const G = this.groundOf(from);
          if (G?.cut) this.heldMsgs.push(say);
          else if (G && G.delay > 0.05) setTimeout(say, G.delay * 1000);
          else say();
        } else if (e.kind === "tel") this.tel.set(from, (ev as unknown as { v: Record<string, number> }).v);
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
          // (his craft handed over — N3: gone, his last samples no craft any more; the one he boards flown again)
          if ((ev as unknown as { gone?: unknown }).gone === true) this.handed.add(from);
          this.handed.delete(e.to);
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
        } else if (e.kind === "stel") {
          // (another's spacecraft — N1: the fleet's row)
          const T = spaceTelOf((ev as unknown as { v?: unknown }).v);
          if (T) this.spaceTel.set(from, T);
          else this.spaceTel.delete(from);
        } else if (e.kind === "sorder" && e.to === net.room?.slot) {
          // (another pilot's order to our spacecraft — N1: proposed, ours to accept)
          const o = (ev as unknown as { o?: unknown }).o;
          if (!isSpaceOrder(o)) return;
          const who = this.nameOf(from);
          const answer = (yes: boolean) => {
            if (yes) this.d.toast(this.carryOrder(from, o));
            this.net?.event({ kind: "sorder-ack", to: from, o, yes });
          };
          if (this.d.ask) this.d.ask(orderAsk(o, who), answer, "net-order");
          else this.d.toast(orderAsk(o, who));
        } else if (e.kind === "sorder-ack" && e.to === net.room?.slot) {
          const a = ev as unknown as { o?: unknown; yes?: unknown };
          if (!isSpaceOrder(a.o)) return;
          this.orderAnswers.set(from, { o: a.o, yes: !!a.yes });
          this.d.toast(a.yes ? tf("{0} accepts: on the way", this.nameOf(from)) : tf("{0} refuses", this.nameOf(from)));
        } else if (e.kind === "xask" && e.to === net.room?.slot) {
          // (a craft docked to ours short of something — N2: ours to give, as much as we can spare)
          const a = ev as unknown as { what?: unknown; need?: unknown };
          const need = amountOf(a.need);
          if (!isShareWhat(a.what) || need === null) return;
          const what = a.what;
          const who = this.nameOf(from);
          const reply = (amt: number, why?: string) => void this.net?.event({ kind: "xgive", to: from, what, amt, why });
          if (!this.dockedWith(from)) return reply(0, "not docked");
          const ask = tf("{0} asks for {1}", who, amountText(what, need));
          const answer = (yes: boolean) => {
            if (!yes) return reply(0, "refused");
            const C = this.consumable(what);
            const amt = C ? giveAmount(C.have, C.cap, need) : 0;
            if (amt <= 0) {
              this.d.toast(tf("Nothing to spare for {0}", who));
              return reply(0, "none to spare");
            }
            this.setConsumable(what, C!.have - amt);
            this.shared.gave += amt;
            this.d.toast(tf("Given to {0}: {1}", who, amountText(what, amt)));
            reply(amt);
          };
          if (this.d.ask) this.d.ask(ask, answer, "net-share");
          else answer(true);
        } else if (e.kind === "xgive" && e.to === net.room?.slot) {
          const g = ev as unknown as { what?: unknown; amt?: unknown; why?: unknown };
          if (!isShareWhat(g.what)) return;
          const amt = amountOf(g.amt);
          const who = this.nameOf(from);
          if (amt === null) {
            this.d.toast(tf("{0} gives nothing ({1})", who, t(typeof g.why === "string" ? g.why.slice(0, 40) : "refused")));
            return;
          }
          const C = this.consumable(g.what);
          if (C) this.setConsumable(g.what, Math.min(C.cap, C.have + amt));
          this.shared.got += amt;
          this.d.toast(tf("Received from {0}: {1}", who, amountText(g.what, amt)));
        } else if (e.kind === "xtgt" && e.to === net.room?.slot) {
          // (another's target sent — N2: ours too; his own craft when he aimed at ours)
          const id = (ev as unknown as { id?: unknown }).id;
          if (typeof id !== "string" || id.length > 40) return;
          const mine = id === String(netTargetId(net.room!.slot)) ? String(netTargetId(from)) : id;
          this.d.camera.selectTarget(mine as never);
          const named = isNetTarget(mine) ? netTargets.name(mine as never) : (BODY_NAMES[mine as Body] ?? mine);
          this.d.toast(tf("{0} sent their target: {1}", this.nameOf(from), named));
        } else if (e.kind === "xplan" && e.to === net.room?.slot) {
          // (another's mission plan sent — N2: its burns, on the room's clock, ours to fly)
          const nodes = (ev as unknown as { nodes?: unknown }).nodes;
          if (!Array.isArray(nodes) || !nodes.length || nodes.length > 12) return;
          const ok = (n: { t?: unknown; dv?: unknown }) =>
            Number.isFinite(n?.t) && Array.isArray(n.dv) && n.dv.length === 3 && n.dv.every((x) => Number.isFinite(x));
          if (!nodes.every(ok)) return;
          const c = this.d.camera;
          const now = c.nowTime();
          const ahead = (nodes as ManeuverNode[]).filter((n) => n.t > now).map((n) => ({ t: n.t, dv: [...n.dv] as Vec3 }));
          if (!ahead.length) return this.d.toast(tf("{0}'s plan: its burns are past", this.nameOf(from)));
          c.clearPlan();
          c.plan = { nodes: ahead, path: null, at: now, note: tf("{0}'s plan", this.nameOf(from)) };
          c.refreshPlan(true);
          this.d.toast(tf("{0} sent their plan: {1} burn(s)", this.nameOf(from), ahead.length));
        } else if (e.kind === "crew-ack" && e.to === net.room?.slot && this.follow?.why === "passenger") {
          // (our copilot's order answered by the pilot — N3)
          const A = readCrewAck(ev);
          if (!A) return;
          const said = sayOf(A.act, {})[lang === "fr" ? "fr" : "en"];
          this.d.toast(A.ok ? tf("Copilot: {0}", A.msg || said) : tf("Copilot refused: {0}", A.msg || said));
        } else if (e.kind === "room-delay") {
          // (the room's light delay — its owner's, checked by the server: one without the feature passes anything on)
          const v = (ev as unknown as { value?: unknown }).value;
          if (net.server.f.includes("room-delay") && (v === "real" || v === "tenth" || v === "off")) this.roomDelay = v;
        } else if (e.kind === "helm-ask" && e.to === net.room?.slot) {
          // (our passenger asks for the controls — N3: ours to hand over, then we ride with him)
          if (this.aboard.get(from) !== net.room!.slot) return;
          const who = this.nameOf(from);
          const answer = (yes: boolean) => {
            if (!yes) return void this.net?.event({ kind: "helm-no", to: from });
            this.d.toast(this.handOver(from));
          };
          if (this.d.ask) this.d.ask(tf("{0} asks to take the controls", who), answer, "net-helm");
          else answer(false);
        } else if (e.kind === "helm-no" && e.to === net.room?.slot) {
          this.d.toast(tf("{0} keeps the controls", this.nameOf(from)));
        } else if (e.kind === "helm" && e.to === net.room?.slot && this.follow?.why === "passenger" && this.follow.slot === from) {
          this.d.toast(this.takeHelm(from, (ev as unknown as { st?: unknown }).st));
        } else if (e.kind === "rpt") {
          // (another's result — N4: the room's board)
          const R = resultOf((ev as unknown as { r?: unknown }).r, from, this.nameOf(from), Date.now());
          if (!R) return;
          this.addResult(R);
          this.d.toast(tf("{0} — {1}: {2}", R.name, refTitle(R), resultText(R)));
        } else if (e.kind === "rchal") {
          // (a room challenge proposed — N4: the same start for all who take it, the others ghosts)
          const id = (ev as unknown as { id?: unknown }).id;
          if (typeof id !== "string" || !/^[\w-]{1,40}$/.test(id) || !this.d.spaceChallenge) return;
          this.roomChal = { id, by: from, slots: new Set([from]), at: Date.now() };
          const title = refTitle({ ref: `challenge:${id}`, title: id });
          const answer = (yes: boolean) => {
            if (!yes || !this.net?.room) return;
            this.roomChal?.slots.add(this.net.room.slot);
            this.net.event({ kind: "rchal-in", id });
            this.d.toast(this.d.spaceChallenge!(id));
          };
          if (this.d.ask) this.d.ask(tf("{0} proposes a room challenge: {1}", this.nameOf(from), title), answer, "net-rchal");
        } else if (e.kind === "rchal-in") {
          const id = (ev as unknown as { id?: unknown }).id;
          if (this.roomChal && this.roomChal.id === id) this.roomChal.slots.add(from);
        } else if (e.kind === "coop") {
          // (a co-op mission proposed — N5: a role for us, if one is free)
          const c0 = ev as unknown as { id?: unknown; role?: unknown };
          const M = COOP_MISSIONS.find((m) => m.id === c0.id);
          if (!M || !M.roles.some((r) => r.id === c0.role) || !this.d.coopStart) return;
          this.coop = {
            id: M.id,
            roles: new Map(M.roles.map((r) => [r.id, { slot: null, i: 0, n: r.objectives.length, ended: false, ok: false }])),
            mine: null,
            told: false,
          };
          this.coop.roles.get(c0.role as string)!.slot = from;
          const free = M.roles.find((r) => r.id !== c0.role);
          if (!free) return;
          const answer = (yes: boolean) => {
            if (yes) this.d.toast(this.takeRole(free.id));
          };
          if (this.d.ask)
            this.d.ask(
              tf("{0} proposes a co-op mission: {1} — your role: {2}", this.nameOf(from), t(M.title), t(free.title)),
              answer,
              "net-coop",
            );
        } else if (e.kind === "coop-in") {
          const c1 = ev as unknown as { id?: unknown; role?: unknown };
          const r = this.coop?.id === c1.id ? this.coop?.roles.get(c1.role as string) : undefined;
          if (r && (r.slot === null || r.slot === from)) r.slot = from;
        } else if (e.kind === "coopst") {
          const c2 = ev as unknown as { id?: unknown; role?: unknown; i?: unknown; ended?: unknown; ok?: unknown };
          const r = this.coop?.id === c2.id ? this.coop?.roles.get(c2.role as string) : undefined;
          if (!r || r.slot !== from || typeof c2.i !== "number") return;
          r.i = Math.max(0, Math.min(r.n, c2.i));
          r.ended = !!c2.ended;
          r.ok = !!c2.ok;
          this.coopCheck();
        } else if (e.kind === "alight") {
          if (this.aboard.get(from) === net.room?.slot) this.d.toast(tf("{0} got off", this.nameOf(from)));
          this.aboard.delete(from);
        }
      });
    }
    const F = this.follow;
    if (F && !net.room.members.some((m) => m.slot === F.slot)) this.unfollow();
    // (a co-op role's pilot gone — N5: the role free for another)
    if (this.coop)
      for (const [k, r] of this.coop.roles)
        if (r.slot !== null && !net.room.members.some((m) => m.slot === r.slot)) {
          r.slot = null;
          this.d.toast(tf("A pilot left: the role {0} is free (Network › Results)", this.roleTitle(k)));
        }
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
      states
        .filter((s) => (!this.hidden.has(s.slot) && !this.handed.has(s.slot)) || s.slot === this.follow?.slot)
        .map((s) => (this.ghostOf(s.slot) ? { ...s, ghost: true } : s)),
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
    this.nearStep(all, net.room.slot);
    // (the room's other spacecraft for the crew's map — N6)
    roomCraft.list = () =>
      this.ships
        .filter((s) => !s.ghost && !s.side && SPACE_VESSELS.includes(s.id as never))
        .map((s) => ({
          name: this.nameOf(s.slot),
          colour: members.get(s.slot)?.colour ?? "#cccccc",
          vessel: VESSELS[s.id].name,
          X: [...s.X] as [number, number, number],
        }));
    // (another's engine heard — N6: the nearest firing within 3 km, at its place)
    const loud = this.ships.filter((s) => !s.ghost && s.dist < 3000 && s.thrust.throttle > 0.05).sort((p, q) => p.dist - q.dist)[0];
    sound.othersFrame(loud ? { at: loud.rel as [number, number, number], throttle: loud.thrust.throttle, air: loud.thrust.air } : null);
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
              rcs: isAircraft(s.id) ? 0.005 : 20,
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
    // (our spacecraft for the room's fleet — N1: once a second)
    if (now - this.stelAt > 1) {
      this.stelAt = now;
      const v = this.ourSpaceTel();
      if (v) {
        net.event({ kind: "stel", v });
        this.spaceTel.set(net.room!.slot, v);
      } else if (this.spaceTel.delete(net.room!.slot)) net.event({ kind: "stel", v: null });
    }
  }

  /** Our spacecraft as the room's fleet shows it (null: not flying one). */
  private ourSpaceTel(): SpaceTel | null {
    const c = this.d.camera;
    const v = fleet.active;
    if (!this.d.settings.ship || !SPACE_VESSELS.includes(v as never)) return null;
    const st = this.lastStatus;
    const sys = c.systemsInfo();
    const dv = c.fcBudget?.().dv;
    return {
      vsl: v as SpaceTel["vsl"],
      body: st ? (st.side === "gargantua" && !st.soi ? "hole" : st.soi || "sun") : "sun",
      alt: st && Number.isFinite(st.altKm) ? Math.round(st.altKm * 10) / 10 : 0,
      st: st ? st.status : "flight",
      dv: Number.isFinite(dv) ? Math.round(dv!) : null,
      fails: sys ? sys.failures.filter((f) => !f.fixing).length : 0,
      docked: !!(c.docked || c.netDocked),
      o2h: sys && Number.isFinite(sys.o2Hours) ? Math.round(Math.min(sys.o2Hours, 1e6) * 10) / 10 : null,
      bat: sys && Number.isFinite(sys.battery) ? Math.round(clamp(sys.battery, 0, 1) * 100) / 100 : null,
      side: st?.side ?? "ours",
    };
  }

  /** The others' range and closing from ours this frame; a craft closing in near, not docked: the proximity warning. */
  private nearStep(all: NetShip[], me: number) {
    const now = performance.now() / 1000;
    // (riding in another's craft: not ours to measure from)
    if (this.follow) {
      this.near.clear();
      this.nearPrev.clear();
      return;
    }
    const seen = new Set<number>();
    for (const s of all) {
      if (s.ghost || s.slot >= 200 || !Number.isFinite(s.dist)) continue;
      seen.add(s.slot);
      const P = this.nearPrev.get(s.slot);
      const dt = P ? now - P.at : 0;
      const was = this.near.get(s.slot);
      // (closing smoothed over half a second: the samples' steps)
      let raw = P && dt > 0.05 ? (P.d - s.dist) / dt : (was?.closing ?? 0);
      // (a jump — a placing, a craft put elsewhere —: not a speed; the closing starts again from it)
      const jump = Math.abs(raw) > 3000;
      if (jump) raw = 0;
      const closing = was && !jump ? was.closing + (raw - was.closing) * Math.min(1, dt / 0.5) : raw;
      if (!P || dt > 0.05) this.nearPrev.set(s.slot, { d: s.dist, at: now });
      this.near.set(s.slot, { range: s.dist, closing });
      // (docked together, aboard: no warning)
      const linked = this.links.get(s.slot)?.host === me || this.links.get(me)?.host === s.slot || this.aboard.get(me) === s.slot;
      const W = !linked && SPACE_VESSELS.includes(fleet.active as never) ? proximity(s.dist, closing) : "none";
      if (W !== "none" && now - (this.proxAt.get(s.slot) ?? -Infinity) > 15) {
        this.proxAt.set(s.slot, now);
        const said = tf(
          W === "warning" ? "PROXIMITY — {0}: {1}, closing {2} m/s" : "Traffic — {0}: {1}, closing {2} m/s",
          this.nameOf(s.slot),
          rangeText(s.dist),
          closing.toFixed(1),
        );
        this.d.toast(said);
        this.d.camera.onPilotMessage?.(said);
        this.proximityAlerts++;
      }
    }
    for (const k of [...this.near.keys()]) if (!seen.has(k)) this.near.delete(k), this.nearPrev.delete(k);
  }
  /** the proximity warnings given (the e2e's count) */
  proximityAlerts = 0;

  /** Another's craft our target (the fleet's Target). What to say. */
  target(slot: number): string {
    this.d.camera.selectTarget(netTargetId(slot) as never);
    return tf("Target: {0}", this.nameOf(slot));
  }

  /** the co-op mission under way (N5): which, each role's pilot and progress, ours, whether its end was told */
  coop: { id: string; roles: Map<string, RoleState>; mine: string | null; told: boolean } | null = null;

  private roleTitle(k: string): string {
    const M = COOP_MISSIONS.find((m) => m.id === this.coop?.id);
    return t(M?.roles.find((r) => r.id === k)?.title ?? k);
  }

  /** A co-op mission proposed to the room (N5): our role taken and begun, the others offered. What to say. */
  proposeCoop(id: string, roleId: string): string {
    const net = this.net;
    const M = COOP_MISSIONS.find((m) => m.id === id);
    if (!net?.room || !M || !this.d.coopStart) return t("Not in a room");
    this.coop = {
      id,
      roles: new Map(M.roles.map((r) => [r.id, { slot: null, i: 0, n: r.objectives.length, ended: false, ok: false }])),
      mine: null,
      told: false,
    };
    net.event({ kind: "coop", id, role: roleId });
    this.takeRole(roleId, false);
    return tf("Co-op mission proposed: {0}", t(M.title));
  }

  /** A role of the co-op mission taken (N5): ours if free, told to the room, begun. What to say. */
  takeRole(roleId: string, tell = true): string {
    const net = this.net;
    const C = this.coop;
    const r = C?.roles.get(roleId);
    if (!net?.room || !C || !r) return t("No co-op mission here");
    if (r.slot !== null && r.slot !== net.room.slot) return tf("The role {0} is taken", this.roleTitle(roleId));
    r.slot = net.room.slot;
    C.mine = roleId;
    net.event({ kind: "coop-in", id: C.id, role: roleId });
    const said = this.d.coopStart!(C.id, roleId);
    if (tell) this.d.toast(said);
    return tf("Your role: {0}", this.roleTitle(roleId));
  }

  /** Our role's progress (the mission controller's): ours updated, told to the room. */
  private coopProgress(p: { id: string; i: number; n: number; ended: boolean; ok: boolean }) {
    const C = this.coop;
    if (!C?.mine || p.id !== `coop:${C.id}:${C.mine}`) return;
    const r = C.roles.get(C.mine)!;
    Object.assign(r, { i: p.i, n: p.n, ended: p.ended, ok: p.ok });
    this.net?.event({ kind: "coopst", id: C.id, role: C.mine, i: p.i, ended: p.ended, ok: p.ok });
    this.coopCheck();
  }

  /** The co-op mission won or lost: said once, its report (every role's line) — shared as any. */
  private coopCheck() {
    const C = this.coop;
    if (!C || C.told) return;
    const v = coopVerdict(C.roles);
    if (v === "on") return;
    C.told = true;
    const M = COOP_MISSIONS.find((m) => m.id === C.id)!;
    const roles = [...C.roles];
    const done = roles.reduce((a, [, r]) => a + r.i, 0);
    const all = roles.reduce((a, [, r]) => a + r.n, 0);
    const score = v === "won" ? 20 : Math.round((200 * done) / Math.max(all, 1)) / 10;
    this.d.camera.onFlightReport?.({
      kind: "mission",
      ref: `mission:${M.id}`,
      title: tf("Co-op · {0}", t(M.title)),
      score,
      letter: score >= 17 ? "A" : score >= 14 ? "B" : score >= 10 ? "C" : score >= 6 ? "D" : "F",
      lines: roles.map(([k, r]) => ({
        label: `${this.roleTitle(k)} · ${r.slot === null ? "—" : this.nameOf(r.slot)}`,
        value: `${r.i}/${r.n}${r.ended ? (r.ok ? " ✓" : " ✗") : ""}`,
        q: (r.ok ? "good" : "bad") as "good" | "bad",
      })),
    });
    this.d.toast(v === "won" ? tf("Co-op mission accomplished: {0}", t(M.title)) : tf("Co-op mission failed: {0}", t(M.title)));
  }

  /** the room's results heard and ours (N4: its board), the latest 120 */
  results: RoomResult[] = [];
  /** the room challenge under way (N4): which, who proposed it, who took it */
  roomChal: { id: string; by: number; slots: Set<number>; at: number } | null = null;

  private addResult(R: RoomResult) {
    this.results.push(R);
    if (this.results.length > 120) this.results.shift();
    // (a room challenge's pilot done: no more a ghost to the others)
    if (this.roomChal && R.ref === `challenge:${this.roomChal.id}`) this.roomChal.slots.delete(R.slot);
  }

  /** Another's craft a ghost to ours (N4): both flying the same room challenge — drawn as a tag, never struck. */
  private ghostOf(slot: number): boolean {
    const RC = this.roomChal;
    const me = this.net?.room?.slot;
    return !!RC && me !== undefined && RC.slots.has(me) && RC.slots.has(slot) && Date.now() - RC.at < 30 * 60_000;
  }

  /** Our result told to the room (N4: its board) — every report of the flight's, in a room. */
  shareReport(r: FlightReport | null) {
    const net = this.net;
    if (!r || !net?.room) return;
    // (a co-op role's own debrief: the room hears the mission's, every role's line in it)
    if (r.ref?.startsWith("mission:coop:")) return;
    const v = {
      kind: r.kind,
      title: r.title,
      score: Math.round(r.score * 10) / 10,
      letter: r.letter,
      ref: r.ref ?? null,
      medal: r.medal ?? null,
      metric: r.metric ?? null,
    };
    const R = resultOf(v, net.room.slot, this.nameOf(net.room.slot), Date.now());
    if (!R) return;
    this.addResult(R);
    net.event({ kind: "rpt", r: v });
  }

  /** A challenge proposed to the room (N4): begun here, offered to each pilot. What to say. */
  proposeChallenge(id: string): string {
    const net = this.net;
    if (!net?.room) return t("Not in a room");
    if (!this.d.spaceChallenge) return t("Not here");
    this.roomChal = { id, by: net.room.slot, slots: new Set([net.room.slot]), at: Date.now() };
    net.event({ kind: "rchal", id });
    this.d.toast(this.d.spaceChallenge(id));
    return tf("Room challenge proposed: {0}", refTitle({ ref: `challenge:${id}`, title: id }));
  }

  /** what was given and received this session (N2: the e2e's counts, in the unit of each) */
  shared = { gave: 0, got: 0 };

  /** Whether our craft and another's are docked together (either on the other). */
  dockedWith(slot: number): boolean {
    const me = this.net?.room?.slot;
    if (me === undefined) return false;
    return this.links.get(slot)?.host === me || this.links.get(me)?.host === slot || this.d.camera.netDocked?.id === `net:${slot}`;
  }

  /** The flown craft's store of a consumable: what it has, what it holds (null: not counted — an aircraft, the
   *  propellant not counted in the scene). */
  private consumable(what: ShareWhat): { have: number; cap: number } | null {
    const c = this.d.camera;
    const v = fleet.active;
    if (!SPACE_VESSELS.includes(v as never)) return null;
    if (what === "prop") {
      if (!fuelOn(this.d.settings) || !fleet.tanks) return null;
      const p = propellantKg(VESSELS[v].mass, fleet.tanks, fleet.spent[v] ?? 0);
      return { have: p.kg, cap: p.full };
    }
    const S = c.systemsOf(v);
    if (!S) return null;
    const spec = SYSTEMS[v as keyof typeof SYSTEMS];
    return what === "power" ? { have: S.battery, cap: spec.batteryKWh } : { have: S.o2, cap: spec.o2Kg };
  }
  private setConsumable(what: ShareWhat, x: number) {
    const v = fleet.active;
    if (what === "prop") {
      if (fleet.tanks) fleet.spent[v] = spentFor(VESSELS[v].mass, fleet.tanks, Math.max(0, x));
      return;
    }
    const S = this.d.camera.systemsOf(v);
    if (!S) return;
    if (what === "power") S.battery = Math.max(0, x);
    else S.o2 = Math.max(0, x);
  }

  /** Something asked of the craft docked to ours (N2): as much as ours can hold. What to say. */
  shareAsk(slot: number, what: ShareWhat): string {
    if (!this.net?.room) return t("Not in a room");
    if (!this.dockedWith(slot)) return t("Docked together first");
    const C = this.consumable(what);
    if (!C) return what === "prop" ? t("The propellant is not counted in this scene") : t("Systems: a spacecraft's");
    const need = roomFor(C.have, C.cap);
    if (need < (what === "prop" ? 1 : 0.1)) return t("Already full");
    this.net.event({ kind: "xask", to: slot, what, need });
    return tf("Asked {0} for {1}", this.nameOf(slot), amountText(what, need));
  }

  /** Our target sent to another (N2). What to say. */
  shareTarget(slot: number): string {
    if (!this.net?.room) return t("Not in a room");
    const id = String(this.d.settings.target);
    this.net.event({ kind: "xtgt", to: slot, id });
    return tf("Target sent to {0}", this.nameOf(slot));
  }

  /** Our mission plan sent to another (N2): its burns, his to fly. What to say. */
  sharePlan(slot: number): string {
    if (!this.net?.room) return t("Not in a room");
    const nodes = this.d.camera.plan.nodes.filter((n) => !n.goal).map((n) => ({ t: n.t, dv: n.dv }));
    if (!nodes.length) return t("No plan to send (the map, MISSION)");
    this.net.event({ kind: "xplan", to: slot, nodes: nodes.slice(0, 12) });
    return tf("Plan sent to {0}: {1} burn(s)", this.nameOf(slot), nodes.length);
  }

  /** An order to another pilot's spacecraft (N1): sent, his answer heard later. What to say. */
  spaceOrder(slot: number, o: SpaceOrder): string {
    const net = this.net;
    if (!net?.room) return t("Not in a room");
    if (!SPACE_VESSELS.includes(fleet.active as never)) return t("Orders to the fleet: from a spacecraft");
    if (!this.spaceTel.has(slot)) return t("Not a spacecraft of the room");
    this.orderAnswers.delete(slot);
    net.event({ kind: "sorder", to: slot, o });
    return tf("Order sent to {0}", this.nameOf(slot));
  }

  /** An order accepted: his craft our target, the autopilot on it as far as it reaches. What to say. */
  private carryOrder(from: number, o: SpaceOrder): string {
    const c = this.d.camera;
    c.selectTarget(netTargetId(from) as never);
    const P = orderPlan(o, this.near.get(from)?.range ?? null);
    if (P.auto) c.pilot.setAuto(P.auto);
    return P.say;
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
          ? tf("{0} asked — waiting for {1}", fmtFactor(mine), this.holders(room, (w) => w < mine * 0.999, W).join(", "))
          : "";
    // (a speed-up asked by another: offered to us)
    const ask = Math.max(0, ...room.members.filter((m) => m.role === "pilot" && m.slot !== room.slot).map((m) => room.wants[m.slot] ?? 0));
    const offer = room.role === "pilot" && ask > W * 1.001 && want < ask * 0.999 ? { warp: ask, by: names((w) => w === ask) } : null;
    if (offer && offer.warp !== this.offer?.warp)
      this.d.toast(tf("{0} asks for {1} — warp up to accept", offer.by.join(", "), fmtFactor(offer.warp)));
    this.offer = offer;
    if (offer && !roomPace.note) roomPace.note = tf("{0} asks for {1}", offer.by.join(", "), fmtFactor(offer.warp));
  }

  /** The pilots holding the room's warp back, each with why (N6: a burn under way holds it — said so). */
  private holders(
    room: { members: { slot: number; name: string; role: string }[]; wants: Record<number, number>; slot: number },
    f: (w: number) => boolean,
    W: number,
  ): string[] {
    return room.members
      .filter((m) => m.role === "pilot" && m.slot !== room.slot && f(room.wants[m.slot] ?? W))
      .map((m) => {
        const T = this.tel.get(m.slot);
        return T && ((T.eng ?? 0) > 0.02 || (T.thr ?? 0) > 0.02) ? tf("{0} (burning)", m.name) : m.name;
      });
  }
  /** the pilots holding the room's warp now (the panel's, the tests') */
  get warpHolders(): string[] {
    const room = this.net?.room;
    if (!room) return [];
    const W = this.net!.roomWarp();
    const mine = room.wants[room.slot] ?? W;
    return mine > W * 1.001 ? this.holders(room, (w) => w < mine * 0.999, W) : [];
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
    // (docked to another's craft in space — N3: through the hatch, aboard it)
    const host = c.netDocked ? Number(String(c.netDocked.id).slice(4)) : -1;
    if (host >= 0 && host < AWAY_SLOT) return this.boardSpace(host);
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

  /** boarded from our craft docked to his (N3): getting off is back through the hatch, whenever */
  private spaceBoard = false;
  /** those whose craft was handed over (N3): their last samples no craft — not drawn, not docked to, not struck */
  handed = new Set<number>();
  /** riding in the craft we handed over (N3): ours is his now — no craft of our own to get back to */
  private handedOver = false;

  /** Aboard another's craft our own is docked to (N3): his passenger — every view his —, his copilot. What to say. */
  boardSpace(slot: number): string {
    const net = this.net;
    if (!net?.room) return t("Not in a room");
    const c = this.d.camera;
    if (c.netDocked?.id !== `net:${slot}`) return t("Docked to their craft first");
    this.spaceBoard = true;
    this.setFollow(slot, "passenger");
    net.event({ kind: "board", to: slot });
    return tf("Aboard {0}'s craft — their copilot (the Fleet tab); ⇧K back to yours", this.nameOf(slot));
  }

  /** An order to the craft we ride in, as its copilot (N3): sent as a crew screen's, its answer heard. */
  copilot(act: Act, args: Record<string, unknown> = {}): string {
    const net = this.net;
    const F = this.follow;
    if (!net?.room || F?.why !== "passenger") return t("Aboard another's craft first");
    const id = `cp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
    net.event({ kind: "crew-cmd", v: 1, id, to: F.slot, act, args });
    return tf("To {0}: {1}", this.nameOf(F.slot), sayOf(act, args)[lang === "fr" ? "fr" : "en"]);
  }

  /** The controls asked of the pilot we ride with (N3). What to say. */
  helmAsk(): string {
    const net = this.net;
    const F = this.follow;
    if (!net?.room || F?.why !== "passenger") return t("Aboard another's craft first");
    net.event({ kind: "helm-ask", to: F.slot });
    return tf("Asked {0} for the controls", this.nameOf(F.slot));
  }

  /** Our craft handed over to our passenger (N3): its state sent to him — he flies it from now —, we ride with him. */
  private handOver(slot: number): string {
    const net = this.net!;
    const c = this.d.camera;
    const P = c.activePoseNow();
    const v = fleet.active;
    if (!P || !SPACE_VESSELS.includes(v as never) || this.lastStatus?.side === "gargantua")
      return t("The controls change hands in our universe, in a spacecraft");
    const S = c.systemsOf(v);
    net.event({
      kind: "helm",
      to: slot,
      st: {
        vessel: v,
        X: [...P.X],
        V: [...P.V],
        fwd: [...P.ax[2]],
        up: [...P.ax[1]],
        spent: fleet.spent[v] ?? 0,
        battery: S?.battery ?? null,
        o2: S?.o2 ?? null,
      },
    });
    c.pilot.setAuto("none");
    c.pilot.throttle = 0;
    this.aboard.delete(slot);
    this.spaceBoard = true;
    this.handedOver = true;
    this.setFollow(slot, "passenger");
    net.event({ kind: "board", to: slot, gone: true });
    return tf("Controls handed to {0} — you ride as their copilot", this.nameOf(slot));
  }

  /** The craft we ride in taken over (N3): ours set to it — its kind, its state —, the pilot now our passenger. */
  private takeHelm(from: number, x: unknown): string {
    const st = x as {
      vessel?: unknown;
      X?: unknown;
      V?: unknown;
      fwd?: unknown;
      up?: unknown;
      spent?: unknown;
      battery?: unknown;
      o2?: unknown;
    } | null;
    const v3 = (a: unknown) => Array.isArray(a) && a.length === 3 && a.every((k) => Number.isFinite(k));
    if (!st || !SPACE_VESSELS.includes(st.vessel as never) || !v3(st.X) || !v3(st.V) || !v3(st.fwd) || !v3(st.up))
      return t("The controls could not be taken");
    const c = this.d.camera;
    // (riding no more — no "off" told: he rides with us now)
    this.follow = null;
    this.followJet = null;
    this.followThrust = null;
    c.puppet = null;
    this.spaceBoard = false;
    this.handedOver = false;
    if (c.netDocked) c.netUndock();
    const v = st.vessel as VesselId;
    if (fleet.active !== v) this.d.tools.set("vessel", v);
    // (where we rode: his craft as his samples have it — relative to its body, on the room's clock: what we saw —;
    // else the state he sent. Placed once the craft switched to has taken its own place: a moment later)
    const place = () => {
      const tr = this.net?.remotes.track(from)?.at(this.d.sceneTime());
      const P = tr && !tr.ghost ? c.netPlaceBeside(tr, 0) : null;
      if (P) this.d.tools.placeAt({ frame: "ours", ...P, note: t("Controls taken") });
      else
        this.d.tools.placeAt({
          frame: "ours",
          X: st.X as Vec3,
          vel: st.V as Vec3,
          fwd: st.fwd as Vec3,
          up: st.up as Vec3,
          note: t("Controls taken"),
        });
      c.pilot.setAuto("none");
      c.pilot.throttle = 0;
      this.prev = null;
    };
    place();
    setTimeout(place, 250);
    if (Number.isFinite(st.spent)) fleet.spent[v] = st.spent as number;
    const S = c.systemsOf(v);
    if (S && Number.isFinite(st.battery)) S.battery = st.battery as number;
    if (S && Number.isFinite(st.o2)) S.o2 = st.o2 as number;
    c.pilot.setAuto("none");
    c.pilot.throttle = 0;
    this.aboard.set(from, this.net!.room!.slot);
    this.helmTaken++;
    return tf("You have the controls of the {0} — {1} rides with you", VESSELS[v].name, this.nameOf(from));
  }
  /** the controls taken (the e2e's count) */
  helmTaken = 0;

  /** Off the craft we ride in, at its door — landed and still —; our own craft back where we left it. */
  private alight(): string {
    const net = this.net!;
    const F = this.follow!;
    // (boarded in space from our docked craft: back through the hatch, our craft still docked)
    if (this.handedOver) return t("Your craft is theirs now: take the controls back to fly it");
    if (this.spaceBoard) {
      this.spaceBoard = false;
      const name = this.nameOf(F.slot);
      this.unfollow();
      return tf("Back aboard your craft, docked to {0}'s", name);
    }
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
    const kind = kindOf(st.kind);
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
      const half = (id: string) => (id === "f35" ? 5.4 : id === "a320" ? 18 : id === "ranger" ? 12 : id === "lander" ? 8 : 40);
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
    const half = (id: string) => (id === "f35" ? 5.4 : id === "a320" ? 18 : id === "ranger" ? 12 : id === "lander" ? 8 : 40);
    const kinds = ["ranger", "lander", "endurance", "f35", "walker", "a320"];
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
    const half = (id: string) => (id === "f35" ? 5.4 : id === "a320" ? 18 : id === "ranger" ? 12 : id === "lander" ? 8 : 40);
    const kinds = ["ranger", "lander", "endurance", "f35", "walker", "a320"];
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
