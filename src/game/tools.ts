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

import { windowsIntegratedGpu } from "../tier";
import { gpuTipText } from "../ui/gpu-tip";
import { runwaySitesNear, siteByName, worldSite } from "../world/fieldsite";
import { fieldByCode } from "../world/runways";
import { pushbackPath, standOf, standPlace } from "./airportnet";
import { loadAirportNet } from "./airportfetch";
import { worldRunwaysUpdate } from "../world/runways3d";
import { fleet } from "../fleet";
import { VESSEL_IDS } from "../vessels";
import { GEARS } from "../gear";
import { setMountVessel } from "../mounts";
import type { Settings, Target } from "../settings";
import { defaultSettings, pickSettings, QUALITY } from "../settings";
import type { CameraController } from "../controls";
import type { Renderer } from "../renderer";
import { setHolePose, setHomePose, setRepPose } from "../camera";
import { ellOfR, mouth, sphericalFrame } from "../wormhole";
import { betaToCoord, planetFrame, toGlobal, toLocal, zamoBeta } from "../landing";
import { BODY_NAMES } from "../targeting";
import { bodyAxes, EPOCH_DATE, M_METRES, M_SECONDS, SOLAR_BODIES, solarBody, solarState, spinVector, utcOf } from "../system/solar";
import { bodyFixedOf, fromBodyFixed, GEAR, gearHeight, groundVelocity, solidBody, toBodyFixed } from "../system/our-surface";
import { EARTH_RUNWAYS, RUNWAY_LENGTH, runwayFrame, SITES, type Site } from "./sites";
import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { ourState, soiOf } from "../system/our-side";
import { GARGANTUA_SYSTEM } from "../system/bodies";
import { rangerStatus, type RangerStatus } from "./status";
import {
  orbitOver,
  overPlace,
  ourGroundPose,
  ourGroundPoseOn,
  ourMouthPose,
  ourNearPose,
  ourOrbitPose,
  theirMouthPose,
  theirNearPose,
  theirGroundAt,
  theirOrbitPose,
  universeOf,
  defaultAltKm,
  OUR_IDS,
  THEIR_IDS,
  type OrbitPlacement,
  type Pose,
} from "./place";
import { autosave, downloadSave, parseSave, saveToHash, slots, type GameSave } from "./save";
import { gameLog } from "./log";
import { runAudit, type AuditReport } from "./audit";
import type { V3 } from "./orbit";
import { cpuProf } from "../perf";
import { C_MPS } from "../units";

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
  /** the dynamic resolution's fraction of the pixel ratio */
  renderScale(): number;
  /** the scene applied last (kept in saves, shown by the panel) */
  scene?: { get(): string | null; set(name: string | null): void };
}

const KM = 1e3 / M_METRES;
const nameOf = (id: string) =>
  (BODY_NAMES as Record<string, string>)[id] ?? solarBody(id)?.name ?? GARGANTUA_SYSTEM.bodies.find((b) => b.id === id)?.name ?? id;

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
      "walk(body, lat, lon)          on foot: the ship landed there, the astronaut out beside it (third person)",
      "near(body, {altKm, rM})       beside a body at rest (the hover autopilot holds it there)",
      "hoverOver(body, lat, lon, altKm)   over a place of a ground, at rest over it, hovering (G lands it)",
      "wormhole('ours'|'gargantua', dM)   before a mouth of the wormhole, at rest",
      "placeAt({frame, X, vel, fwd, up})   put it at a state (home frame / the hole's map)",
      "target(id) · targets()        select the target",
      "warp(x) · pause(on) · realTime()   time: x times real time",
      "setDate('2067-03-01T12:00') · date()   the scene's clock (the bodies move; the ship keeps its place)",
      "set(key, value) · get(key) · settings()   any setting (see the panel, Game section)",
      "quality('game'|'realtime'|…) · perf()   performance: the quality level; frame rates, GPU passes, CPU sections",
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
    const c = this.ctx.camera,
      p = c.pilot;
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
        return {
          id: b.id,
          name: b.name,
          parent: b.parent,
          radiusKm: b.radius / KM,
          soiKm: soiOf(b.id, t) / KM,
          distKm: d,
          altKm: d - b.radius / KM,
        };
      });
    }
    return GARGANTUA_SYSTEM.bodies
      .filter((b) => b.universe === "gargantua")
      .map((b) => ({ id: b.id, name: b.name, parent: b.parent, radiusKm: (b.radius * 1476.625 * this.ctx.settings.massSolar) / 1e3 }));
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

  /** how many times the craft was placed (a placing awaited — the room's runway after a loss — let go by a later one) */
  placings = 0;

  /** Puts the Ranger at a pose (see place.ts) and restarts its flight there. */
  placeAt(p: Pose) {
    const s = this.ctx.settings,
      c = this.ctx.camera;
    this.placings++;
    this.shipOn();
    // (the pose is the craft's — its nose, its top —: the camera's own axes from them through the view's
    // mount, as a craft flown to is placed — fleet.ts placeOnPose —; set as the camera's, the chase view's
    // look down tilted the craft 5–7° nose up on its gear, the cockpit's another way)
    {
      // (the view's mount at its place — not still easing from another craft's —: the craft's axes through it)
      c.settleMount();
      const S = c.shipMatrix();
      const up = p.up,
        f = p.fwd;
      const left: V3 = [up[1] * f[2] - up[2] * f[1], up[2] * f[0] - up[0] * f[2], up[0] * f[1] - up[1] * f[0]];
      const ax: [V3, V3, V3] = [left, up, f];
      const cam = (k: number): V3 => {
        const v: V3 = [0, 1, 2].map((i) => ax[0][i]! * S[k]![0]! + ax[1][i]! * S[k]![1]! + ax[2][i]! * S[k]![2]!) as V3;
        const l = Math.hypot(...v) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      };
      p = { ...p, fwd: cam(2), up: cam(1) };
    }
    // (docked, the craft would stay where its station carries it: let go of its links first — no push, it
    // is moved anyway)
    if (c.docked) fleet.links = fleet.links.filter((l) => l.a !== fleet.active && l.b !== fleet.active);
    if (p.frame === "ours") {
      if (!s.wormhole) throw new Error("our universe is reached through the wormhole: pick a Gargantua-system scene (game:interstellar)");
      setHomePose(s, p.X, p.fwd, p.up, p.vel);
      s.anchor = "wormhole";
    } else if (p.frame === "mouth") {
      if (!s.wormhole) throw new Error("the wormhole lives in the game's world: pick a scene of it first");
      const r = Math.hypot(...p.X);
      setRepPose(s, { l: ellOfR(mouth(s).w, r), n: [p.X[0] / r, p.X[1] / r, p.X[2] / r], fwd: p.fwd, up: p.up, vel: p.vel });
    } else setHolePose(s, p.X, p.fwd, p.up, p.vel);
    s.motion = "geodesic";
    // (a view still carried from a craft just left — controller/camrig.ts —: dropped, the place is this one)
    c.viewCarry = null;
    c.setCinematic(null);
    c.setPilot(true);
    c.newFlight();
    c.setOurLanded(p.landed ?? null);
    if (p.localLanded) {
      const F = planetFrame(p.localLanded.body, this.ctx.time(), s.spin, s.massSolar);
      c.local = { F, L: { xi: [...p.localLanded.xi], w: [0, 0, 0], landed: true }, key: c.poseKeyNow() };
      c.landed = true;
      c.gearDown = true;
    }
    c.sync();
    this.ctx.refresh();
    this.log.add("place", p.note, this.ctx.time());
    this.ctx.toast(p.note);
    return p.note;
  }

  /**
   * Lined up on a runway of the Earth, `alongM` past its threshold, its nose down the runway in use (into
   * the wind), at rest on its gear — a take-off's start (the F-35's: docs/PLAN-F35.md). `name` matched as
   * glideTo's; none: the runway nearest the flown craft (Edwards when it is not near the Earth).
   */
  lineUp(name?: string | Site, alongM = 60) {
    const runways = SITES.filter((q) => q.body === "earth" && q.runway);
    const t = this.ctx.time();
    // (a site given, or by its name or code — the game's eight, or any airfield of the world whose tile is in:
    // PLAN-RADAR-AAA RD13)
    let found = typeof name === "object" ? name : name ? (siteByName(name) ?? undefined) : undefined;
    if (found && found.body !== "earth") found = undefined;
    if (name && !found)
      throw new Error(
        `no runway "${typeof name === "string" ? name : name.name}" — ${runways.map((q) => q.name).join(", ")}, or an airfield's code`,
      );
    if (!found) {
      // (the nearest of the world's a jet takes off from, within 60 km; else the game's)
      const g = this.ctx.camera.geoNow();
      const w = g ? runwaySitesNear(g.lat, g.lon, 60_000, 1200)[0] : undefined;
      if (w) found = w;
    }
    if (!found) {
      const here = fleet.pose(fleet.active, t)?.X;
      const E = solarState("earth", t).pos;
      const near = here && Math.hypot(here[0] - E[0], here[1] - E[1], here[2] - E[2]) * M_METRES < 2e7;
      found = runways.find((q) => q.name.startsWith("Edwards"))!;
      if (near) {
        let best = Infinity;
        for (const q of runways) {
          const P = fromBodyFixed("earth", bodyFixedOf("earth", q.lat, q.lon, 0), t);
          const d = Math.hypot(P[0] - here![0], P[1] - here![1], P[2] - here![2]);
          if (d < best) (best = d), (found = q);
        }
      }
    }
    const site = this.ctx.camera.runwayInUse(found);
    // (a point along the runway as it is drawn — its WGS84 frame, sites.ts EARTH_RUNWAYS: the threshold, the
    // landing direction —, alongM past the end in use; the nose down its axis: a sphere's lat/lon steps put it
    // 0.3° off, 24 m from the axis at the far end)
    // (the world's: its frame here — and the world's runways about it brought in now: graded under the gear at once)
    if (found.len) worldRunwaysUpdate(found.lat, found.lon, performance.now(), true);
    const R =
      EARTH_RUNWAYS.find(
        (r) => r.site.name === found.name || (Math.abs(r.site.lat - found.lat) < 1e-5 && Math.abs(r.site.lon - found.lon) < 1e-5),
      ) ?? runwayFrame(found, found.len ?? RUNWAY_LENGTH);
    const L = R.len;
    const rev = !!site.reverse;
    const pt = (m: number): [number, number] => {
      const k = rev ? L - m : m;
      const q = R.origin.map((o, i) => o + R.along[i]! * k) as V3;
      const geo = cartToGeodetic(WGS84_A, WGS84_F, q);
      return [(geo.lat * 180) / Math.PI, (geo.lon * 180) / Math.PI];
    };
    // (another craft parked there — the F-35 left on the runway —: further down it, clear of it — 90 m on
    // until none is within 60 m)
    const alongM0 = alongM;
    for (let k = 0; k < 20; k++) {
      const [la, lo] = pt(alongM);
      // (on the ground there — not on the ellipsoid: Edwards stands 700 m over it)
      const P = ourGroundPose("earth", la, lo, t).X;
      const near = VESSEL_IDS.some((v) => {
        if (v === fleet.active) return false;
        const q = fleet.pose(v, t);
        return !!q && Math.hypot(q.X[0] - P[0], q.X[1] - P[1], q.X[2] - P[2]) * M_METRES < 60;
      });
      if (!near || alongM > L - 300) break;
      alongM += 90;
    }
    const [lat, lon] = pt(alongM);
    const g = ourGroundPose("earth", lat, lon, t);
    const ahead = fromBodyFixed("earth", bodyFixedOf("earth", ...pt(alongM + 200), 0), t);
    const d: V3 = [ahead[0] - g.X[0], ahead[1] - g.X[1], ahead[2] - g.X[2]];
    const k = d[0] * g.up[0] + d[1] * g.up[1] + d[2] * g.up[2];
    const f: V3 = [d[0] - k * g.up[0], d[1] - k * g.up[1], d[2] - k * g.up[2]];
    const l = Math.hypot(...f) || 1;
    return this.placeAt({
      ...g,
      fwd: [f[0] / l, f[1] / l, f[2] / l],
      note: `${site.name}: lined up, runway ${Math.round((site.rwy ?? 0) / 10)}${alongM > alongM0 + 1 ? ` — ${Math.round(alongM)} m down it, clear of a parked craft` : ""}`,
    });
  }

  /**
   * At a stand of an Earth airfield (the A320's start at the gate — docs/PLAN-A320.md, A14): the airport's ground
   * network fetched (OpenStreetMap: game/airportfetch.ts), the stand by its ref (none: the nearest the airfield's middle
   * — a gate's first), the aircraft on its ground there, its nose wheel on the stop, its nose on the stand's heading in,
   * the parking brake set; its route out to the runway in use made (controller/a320taxi.ts). Its line.
   */
  async atStand(airport: string, ref?: string | null): Promise<string> {
    let site = siteByName(airport);
    if (!site) {
      const f = await fieldByCode(airport);
      site = f ? worldSite(f, 1200) : null;
    }
    if (!site || site.body !== "earth") throw new Error(`no airfield "${airport}"`);
    const code = (site.icao ?? airport).toUpperCase();
    const net = await loadAirportNet(code, site.lat, site.lon);
    if (!net) throw new Error(`${code}: no ground network (OpenStreetMap unreachable, or none mapped)`);
    // (none asked: of the stands named or at a gate, the nearest the airfield's middle — all when none is)
    const named = net.stands.filter((s) => s.gate || s.ref);
    const stand = ref ? standOf(net, ref) : standOf({ ...net, stands: named.length ? named : net.stands }, null);
    if (!stand) throw new Error(`${code}: no stand mapped`);
    if (site.len) worldRunwaysUpdate(site.lat, site.lon, performance.now(), true);
    const t = this.ctx.time();
    // (the nose wheel on the stop: the A320's reference point 13.65 m behind it — gear.ts)
    const noseZ = fleet.active === "a320" ? (GEARS.a320?.legs[0]?.at[2] ?? 13.65) : 0;
    const P = standPlace(stand, noseZ);
    // (set on its wheels as the apron's relief has them — not level on its reference point: its legs sunk to their
    // stops by the relief's metre-high bumps, let go by the tug, flung up)
    const g = ourGroundPoseOn("earth", P.lat, P.lon, t, GEARS[fleet.active]?.legs ?? null, P.hdg, GEAR);
    const note = this.placeAt({ ...g, note: `${site.name}: stand ${stand.ref ?? "—"}` });
    const c = this.ctx.camera;
    c.a320Park = true;
    if (fleet.active === "a320") c.a320TaxiOut(code, net, stand);
    return note;
  }

  /**
   * The A320 pushed back from its stand (the tug's work done at once — PART B's tug does it frame by frame): at the end
   * of its pushback's path (game/airportnet.ts pushbackPath), its nose along the taxiway, the parking brake set, its
   * route out kept. Its line.
   */
  pushedBack(): string {
    const c = this.ctx.camera;
    const T = c.a320Taxi;
    if (!T?.stand) throw new Error("not at a stand (atStand first)");
    const P = pushbackPath(T.stand, T.net, GEARS.a320?.legs[0]?.at[2] ?? 13.65, 45, T.route);
    const end = P.pts.at(-1)!;
    const t = this.ctx.time();
    const g = ourGroundPoseOn("earth", end.lat, end.lon, t, GEARS[fleet.active]?.legs ?? null, P.hdgEnd, GEAR);
    const note = this.placeAt({ ...g, note: `pushed back from stand ${T.stand.ref ?? "—"}` });
    c.a320Park = true;
    c.a320Taxi = { ...T, cue: null };
    return note;
  }

  /**
   * On a site's approach (our worlds): `distKm` before its runway's threshold on the runway's line (or
   * north of a pad), `altKm` up, flying towards it at `speed` m/s — the entry autopilot's glide takes
   * it from there (the practice of the last minutes of an entry). `o.acrossKm` puts it off the runway's
   * line (> 0 to its right), `o.headingDeg` turns its course off the runway's (> 0 clockwise).
   */
  glideTo(name: string, distKm = 80, altKm = 25, speed = 750, o: { acrossKm?: number; headingDeg?: number } = {}) {
    const found = SITES.find((q) => q.name.toLowerCase().includes(name.toLowerCase())) ?? siteByName(name);
    if (!found) throw new Error(`no site "${name}" — ${SITES.map((q) => q.name).join(", ")}, or an airfield's code`);
    if (universeOf(found.body) !== "ours") throw new Error("glideTo: our worlds' sites");
    // (a runway's final into the wind: its far end's when the wind blows down it — W4)
    const site = this.ctx.camera.runwayInUse(found);
    const t = this.ctx.time();
    const b = solarBody(site.body)!;
    const P = solarState(site.body, t).pos;
    const D = Math.PI / 180;
    const T = fromBodyFixed(site.body, bodyFixedOf(site.body, site.lat, site.lon, 0), t);
    const sub = (a: V3, c: V3): V3 => [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
    const unit = (a: V3): V3 => {
      const l = Math.hypot(...a) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    };
    const dot = (a: V3, c: V3) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    const cross = (a: V3, c: V3): V3 => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
    const up = unit(sub(T, P));
    const pole = unit(spinVector(b, t) as V3);
    const north = unit(sub(pole, up.map((x) => x * dot(pole, up)) as V3));
    const east = cross(north, up);
    const hd = (site.rwy ?? 180) * D;
    const along: V3 = [
      north[0] * Math.cos(hd) + east[0] * Math.sin(hd),
      north[1] * Math.cos(hd) + east[1] * Math.sin(hd),
      north[2] * Math.cos(hd) + east[2] * Math.sin(hd),
    ];
    const ang = (distKm * 1e3) / (b.radius * M_METRES);
    const right = cross(along, up);
    const off = ((o.acrossKm ?? 0) * 1e3) / (b.radius * M_METRES);
    const dir = unit([
      up[0] * Math.cos(ang) - along[0] * Math.sin(ang) + right[0] * off,
      up[1] * Math.cos(ang) - along[1] * Math.sin(ang) + right[1] * off,
      up[2] * Math.cos(ang) - along[2] * Math.sin(ang) + right[2] * off,
    ]);
    // (the height above the ground there — the relief's, once known)
    // (over the figure — the Earth's ellipsoid, not its equator's sphere — measured there and set right)
    const r0 = b.radius + (altKm * 1e3) / M_METRES;
    const h0 = gearHeight(site.body, [P[0] + dir[0] * r0, P[1] + dir[1] * r0, P[2] + dir[2] * r0], t) + GEAR;
    const r = r0 + (altKm * 1e3 - h0) / M_METRES;
    const X: V3 = [P[0] + dir[0] * r, P[1] + dir[1] * r, P[2] + dir[2] * r];
    const hc = (o.headingDeg ?? 0) * D;
    const course: V3 = [0, 1, 2].map((i) => along[i]! * Math.cos(hc) + right[i]! * Math.sin(hc)) as V3;
    const fwd = unit(sub(course, dir.map((x) => x * dot(course, dir)) as V3));
    const g = groundVelocity(site.body, X, t);
    const k = speed / C_MPS;
    const vel: V3 = [g[0] + fwd[0] * k, g[1] + fwd[1] * k, g[2] + fwd[2] * k];
    const note = this.placeAt({
      frame: "ours",
      X,
      vel,
      fwd,
      up: dir,
      note: `${site.name}: ${distKm} km out${o.acrossKm ? `, ${o.acrossKm} km across` : ""}, ${altKm} km up, ${speed} m/s — the approach`,
    });
    const c = this.ctx.camera;
    c.entrySite = site;
    c.pilot.auto = "none";
    c.pilot.setAuto("entry");
    return note;
  }

  /**
   * In the air over a place of the Earth (latitude, east longitude [°]), `aglM` above its ground, flying a
   * heading [° true] at a speed through the air [m/s], level, flown by hand (no autopilot), clean — a
   * challenge's start (docs/PLAN-F35.md, F9).
   */
  flyAt(lat: number, lon: number, aglM: number, headingDeg: number, speed: number, body = "earth") {
    if (universeOf(body) !== "ours") throw new Error("flyAt: our worlds");
    const t = this.ctx.time();
    const b = solarBody(body)!;
    const P = solarState(body, t).pos;
    const D = Math.PI / 180;
    const sub = (a: V3, c: V3): V3 => [a[0] - c[0], a[1] - c[1], a[2] - c[2]];
    const unit = (a: V3): V3 => {
      const l = Math.hypot(...a) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    };
    const dot = (a: V3, c: V3) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    const cross = (a: V3, c: V3): V3 => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
    const T = fromBodyFixed(body, bodyFixedOf(body, lat, lon, 0), t);
    const up = unit(sub(T, P));
    const pole = unit(spinVector(b, t) as V3);
    const north = unit(sub(pole, up.map((x) => x * dot(pole, up)) as V3));
    const east = cross(north, up);
    const hd = headingDeg * D;
    const fwd: V3 = [0, 1, 2].map((i) => north[i]! * Math.cos(hd) + east[i]! * Math.sin(hd)) as V3;
    // (the height over the ground there, measured — the relief's — and set right)
    const r0 = b.radius + aglM / M_METRES;
    const h0 = gearHeight(body, [P[0] + up[0] * r0, P[1] + up[1] * r0, P[2] + up[2] * r0], t) + GEAR;
    const r = r0 + (aglM - h0) / M_METRES;
    const X: V3 = [P[0] + up[0] * r, P[1] + up[1] * r, P[2] + up[2] * r];
    const g = groundVelocity(body, X, t);
    const k = speed / C_MPS;
    const note = this.placeAt({
      frame: "ours",
      X,
      vel: [g[0] + fwd[0] * k, g[1] + fwd[1] * k, g[2] + fwd[2] * k],
      fwd,
      up,
      note: `${nameOf(body)}: ${Math.round(aglM)} m over ${lat.toFixed(3)}°, ${lon.toFixed(3)}°, heading ${Math.round(headingDeg)}°, ${Math.round(speed)} m/s`,
    });
    const c = this.ctx.camera;
    if (c.pilot.auto !== "none") c.pilot.setAuto(c.pilot.auto);
    c.pilot.auto = "none";
    c.gearInit = true;
    c.gearDown = false;
    c.gearExt = 0;
    return note;
  }

  /**
   * Over a place of one of our solid bodies (latitude, east longitude [°]), `altKm` above its ground, at
   * rest over it — carried by its turning —, the hover autopilot holding it there: the practice of a
   * powered landing's last minutes (G lands it), as glideTo is of an entry's.
   */
  hoverOver(body: string, lat: number, lon: number, altKm = 1.5) {
    if (universeOf(body) !== "ours") throw new Error("hoverOver: our worlds");
    const t = this.ctx.time();
    const g = ourGroundPose(body, lat, lon, t);
    const k = (altKm * 1e3) / M_METRES;
    const X: V3 = [g.X[0] + g.up[0] * k, g.X[1] + g.up[1] * k, g.X[2] + g.up[2] * k];
    const note = this.placeAt({
      frame: "ours",
      X,
      vel: groundVelocity(body, X, t),
      fwd: g.fwd,
      up: g.up,
      note: `${nameOf(body)}: ${altKm} km over ${lat.toFixed(2)}°, ${lon.toFixed(2)}° — hovering`,
    });
    this.hover();
    return note;
  }

  /** In orbit around a body (ours or Gargantua's side; the hole: `rM` its radius in M). */
  orbit(body: string, o: Omit<OrbitPlacement, "body"> & { rM?: number } = {}) {
    const u = universeOf(body);
    if (!u) throw new Error(`unknown body "${body}" — ours: ${OUR_IDS.join(", ")}; Gargantua's: ${THEIR_IDS.join(", ")}`);
    const s = this.ctx.settings,
      t = this.ctx.time();
    if (u === "gargantua" && !(s.system === "gargantua")) throw new Error("Gargantua's planets live in the Gargantua-system scenes");
    const pose = u === "ours" ? ourOrbitPose({ body, ...o }, t) : theirOrbitPose({ body, ...o }, t, s.spin, s.massSolar);
    const note = this.placeAt(pose);
    if (s.target === body) this.target(u === "ours" && body !== "sun" ? "sun" : "hole");
    return note;
  }

  /**
   * On the ground at latitude and east longitude [°]: one of our solid bodies, or one of Gargantua's
   * worlds (on its frame's axes: x away from Gargantua, z its pole).
   */
  land(body: string, lat = 0, lon = 0) {
    if (universeOf(body) === "gargantua") {
      const s = this.ctx.settings;
      if (body === "gargantua") throw new Error("Gargantua has no ground");
      if (s.system !== "gargantua") throw new Error("Gargantua's planets live in the Gargantua-system scenes");
      const D = Math.PI / 180;
      const q: V3 = [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
      return this.placeAt(theirGroundAt(body, q, this.ctx.time(), s.spin, s.massSolar));
    }
    // (on a runway of the Earth — a site's place, a click on the strip —: lined up on it, on its axis, its
    // nose down the end in use, that far along it)
    if (body === "earth") {
      const D = Math.PI / 180;
      const q = geodeticToCart(WGS84_A, WGS84_F, lat * D, lon * D, 0);
      for (const R of EARTH_RUNWAYS) {
        const d = q.map((x, i) => x - R.origin[i]!);
        const a = d[0]! * R.along[0] + d[1]! * R.along[1] + d[2]! * R.along[2];
        const c = d[0]! * R.across[0] + d[1]! * R.across[1] + d[2]! * R.across[2];
        const L = R.len;
        if (a < -200 || a > L + 200 || Math.abs(c) > Math.max(150, R.halfWidth + 60)) continue;
        const rev = !!this.ctx.camera.runwayInUse(R.site).reverse;
        // (near either end — the site's own place is its published threshold —: at the start of the end in use,
        // ready to take off; elsewhere on the strip, where it was set)
        const along = a < 400 || a > L - 400 ? 60 : Math.min(Math.max(rev ? L - a : a, 60), L - 60);
        return this.lineUp(R.world ? { ...R.site, len: R.len } : R.site.name, along);
      }
    }
    // (on its gear, as the ground under each leg has it — a slope tilts it —, its nose where it pointed)
    const hd = (this.ctx.camera.attitudeNow() as { heading?: number }).heading;
    const heading = Number.isFinite(hd) ? (hd! * 180) / Math.PI : 90;
    // (another craft parked there: a little aside — 70 m east until none is within 50 m)
    const t = this.ctx.time();
    let lo = lon;
    for (let k = 0; k < 10; k++) {
      const P = ourGroundPose(body, lat, lo, t).X;
      const near = VESSEL_IDS.some((v) => {
        if (v === fleet.active) return false;
        const q = fleet.pose(v, t);
        return !!q && Math.hypot(q.X[0] - P[0], q.X[1] - P[1], q.X[2] - P[2]) * M_METRES < 50;
      });
      if (!near) break;
      lo += 70 / ((solarBody(body)?.radius ?? 1) * M_METRES * Math.cos((lat * Math.PI) / 180)) / (Math.PI / 180);
    }
    return this.placeAt(ourGroundPoseOn(body, lat, lo, t, GEARS[fleet.active]?.legs ?? null, heading, GEAR));
  }

  /** Parked on its gear at latitude, east longitude [°] and a heading [°] — where it was left (no runway's
   *  lining up, no moving aside: docs/PLAN-RESEAU.md R5, our craft back after riding in another's). */
  parkAt(body: string, lat: number, lon: number, heading: number, note?: string) {
    const P = ourGroundPoseOn(body, lat, lon, this.ctx.time(), GEARS[fleet.active]?.legs ?? null, heading, GEAR);
    return this.placeAt(note ? { ...P, note } : P);
  }

  /**
   * On foot at latitude and east longitude [°]: the ship landed there (as land()), then the astronaut
   * steps out beside it, walking — the third-person controller. A spot refused (water, an obstruction)
   * leaves the ship landed and says why: the astronaut is not put down.
   */
  walk(body: string, lat = 0, lon = 0) {
    const note = this.land(body, lat, lon);
    const refused = this.ctx.camera.character.disembark(body);
    if (refused) throw new Error(`the ship landed, but no walk from it: ${refused}`);
    return note;
  }

  /**
   * In orbit passing over a place now (latitude, east longitude [°]): the node and the anomaly found,
   * the inclination raised to the latitude if lower; the rest as orbit() takes it.
   */
  orbitOver(body: string, lat: number, lon: number, o: Omit<OrbitPlacement, "body" | "raan" | "nu"> = {}) {
    // (over the place's geodetic normal, at the orbit's height there: an eccentric one's found again once the
    // anomaly over the place is known)
    const t = this.ctx.time();
    // (the heights as ourOrbitPose reads them)
    const alt = o.altKm ?? defaultAltKm(body),
      h1 = o.peKm ?? alt,
      h2 = o.apKm ?? o.peKm ?? alt;
    const pe = Math.min(h1, h2),
      ap = Math.max(h1, h2);
    const R = ((solarBody(body)?.radius ?? 0) * M_METRES) / 1e3;
    const e = (ap - pe) / (ap + pe + 2 * R);
    let hKm = pe;
    let w = orbitOver(body, overPlace(body, lat, lon, hKm) as V3, t, { inc: o.inc ?? 0, argPe: o.argPe ?? 0, retrograde: !!o.retrograde });
    for (let k = 0; k < 2 && e > 1e-9; k++) {
      hKm = ((R + pe) * (1 + e)) / (1 + e * Math.cos((w.nu * Math.PI) / 180)) - R;
      w = orbitOver(body, overPlace(body, lat, lon, hKm) as V3, t, { inc: o.inc ?? 0, argPe: o.argPe ?? 0, retrograde: !!o.retrograde });
    }
    return this.orbit(body, { ...o, inc: w.inc, raan: w.raan, nu: w.nu });
  }

  /**
   * Beside a body, at rest against it — `altKm` above it (by default two of its radii), Gargantua
   * `rM` [M] from its centre —, the body targeted, the hover autopilot holding the ship there.
   */
  near(body: string, o: { altKm?: number; rM?: number } = {}) {
    const u = universeOf(body);
    if (!u) throw new Error(`unknown body "${body}" — ours: ${OUR_IDS.join(", ")}; Gargantua's: ${THEIR_IDS.join(", ")}`);
    const s = this.ctx.settings,
      t = this.ctx.time();
    const note = this.placeAt(u === "ours" ? ourNearPose(body, t, o.altKm) : theirNearPose(body, t, s.spin, s.massSolar, o.altKm, o.rM));
    this.target(body === "gargantua" ? "hole" : body);
    this.hover();
    return note;
  }

  /** Before the wormhole on our side or on Gargantua's, `dM` [M] from its mouth's centre (by default the
   *  approach's stand-off), the mouth targeted, the hover autopilot holding the ship there. */
  wormhole(side: "ours" | "gargantua" = "ours", dM?: number) {
    const s = this.ctx.settings,
      t = this.ctx.time();
    if (!s.wormhole) throw new Error("the wormhole lives in the game's world: pick a scene of it first");
    const note = this.placeAt(side === "ours" ? ourMouthPose(s, t, dM) : theirMouthPose(s, t, dM));
    this.target("wormhole");
    this.hover();
    return note;
  }

  /** the hover autopilot engaged afresh (a placement's: at rest where it was put) */
  private hover() {
    const p = this.ctx.camera.pilot;
    p.auto = "none";
    p.setAuto("hover");
  }

  /** The scene's time now [M]. */
  now() {
    return this.ctx.time();
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
  /**
   * The scene's clock set to t [M], the ship carried as the world moves on: on our side with the body it
   * moves about (its reference body's motion added: the same orbit, the same place over it), against
   * the mouth when by it; on Gargantua's side in its world's frame; landed, where it stands (its place is
   * the ground's). A plan made on the old clock (nodes, the flight computer's burns, an entry) is
   * dropped — said in the journal and returned.
   */
  jumpTo(t1: number) {
    const s = this.ctx.settings,
      c = this.ctx.camera,
      t0 = this.ctx.time();
    if (!Number.isFinite(t1)) throw new Error(`not a time: ${t1}`);
    let carry: (() => void) | null = null;
    if (s.ship && !c.ourLanded && s.system === "gargantua") {
      const st = this.status();
      if (st.side === "ours" && st.soi) {
        const p = c.activePoseNow();
        const camAx = c.camAxesHome();
        // (near a world's ground — in its air, under 100 km —: kept over the same ground, at the same height, its
        // attitude and its motion over the turning ground the same — the hour changed, the flight does not: the Earth
        // turned under a craft carried in space, 50 m over the sea it met the water)
        if (p && camAx && solidBody(st.soi) && st.altKm < 100) {
          const ref = st.soi;
          const A0 = bodyAxes(solarBody(ref)!, t0);
          const fixed = (v: readonly number[]): V3 =>
            [0, 1, 2].map((k) => v[0]! * A0[k]![0]! + v[1]! * A0[k]![1]! + v[2]! * A0[k]![2]!) as V3;
          const q = toBodyFixed(ref, p.X as V3, t0);
          const gv0 = groundVelocity(ref, p.X as V3, t0);
          const vRel = fixed([0, 1, 2].map((i) => p.V[i]! - gv0[i]!));
          const fwd = fixed(camAx[2]),
            up = fixed(camAx[1]);
          carry = () => {
            const A1 = bodyAxes(solarBody(ref)!, t1);
            const home = (v: V3): V3 => [0, 1, 2].map((i) => v[0] * A1[0]![i]! + v[1] * A1[1]![i]! + v[2] * A1[2]![i]!) as V3;
            const X = fromBodyFixed(ref, q, t1) as V3;
            const gv1 = groundVelocity(ref, X, t1);
            const hv = home(vRel);
            setHomePose(s, X, home(fwd), home(up), [0, 1, 2].map((i) => gv1[i]! + hv[i]!) as V3);
            s.anchor = "wormhole";
          };
        } else if (p && Math.hypot(...p.X) > 3 * mouth(s).rGlue) {
          // (by the mouth — within a few of its gluing radii —: kept against it, the home frame's origin)
          const a = ourState(st.soi, t0),
            ref = st.soi;
          carry = () => {
            const b = ourState(ref, t1);
            const X = [0, 1, 2].map((i) => p.X[i]! - a.pos[i]! + b.pos[i]!) as V3;
            const V = [0, 1, 2].map((i) => p.V[i]! - a.vel[i]! + b.vel[i]!) as V3;
            setHomePose(s, X, p.ax[2], p.ax[1], V);
            s.anchor = "wormhole";
          };
        }
      } else if (st.side === "gargantua" && st.soi && st.soi !== "gargantua" && s.anchor === "hole") {
        const D = Math.PI / 180,
          r = s.distance,
          th = s.inclination * D,
          ph = s.azimuth * D;
        const X: V3 = [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)];
        const L = toLocal(planetFrame(st.soi, t0, s.spin, s.massSolar), X, betaToCoord(X, [s.velR, s.velT, s.velP], s.spin));
        const ref = st.soi;
        carry = () => {
          const g = toGlobal(planetFrame(ref, t1, s.spin, s.massSolar), L);
          const f = sphericalFrame(g.X);
          s.distance = f.r;
          s.inclination = Math.min(Math.max(f.th / D, 0.2), 179.8);
          s.azimuth = f.ph / D;
          [s.velR, s.velT, s.velP] = zamoBeta(g.X, g.V, s.spin);
        };
      }
    }
    // (the plan's times were the old clock's)
    const auto = c.pilot.auto;
    const planned = c.plan.nodes.length > 0 || auto === "node" || auto === "burns" || auto === "transfer" || auto === "entry";
    c.fcClear();
    if (c.pilot.auto === "entry") c.pilot.setAuto("entry");
    c.entryRun = null;
    // (the view on a world's ground — a tripod, a spectator's — carried with it to the new time)
    const view = c.viewController();
    const ground = view !== c || !s.ship ? view.groundHold() : null;
    // (the carriers at sea where they are: their courses set off as much later — game/carrier.ts)
    const dSec = (utcOf(t1) - utcOf(t0)) / 1000;
    for (const sp of c.carriers ?? []) sp.t0 += dSec;
    this.ctx.setTime(t1);
    // (the controller's clock with it at once — paused, no frame steps it: the craft read at the old hour)
    c.time = t1;
    c.shipTime = Number.NaN;
    carry?.();
    c.sync();
    ground?.(t1);
    this.ctx.refresh();
    const note = `Clock set to ${fmtDate(t1)}${planned ? " — the plan made on the old clock dropped" : ""}`;
    this.log.add("info", note, t1);
    return { date: fmtDate(t1), planDropped: planned };
  }

  setDate(d: string | number) {
    const t = typeof d === "number" ? d : (Date.parse(d.endsWith("Z") ? d : `${d}Z`) - EPOCH_DATE) / 1e3 / M_SECONDS;
    if (!Number.isFinite(t)) throw new Error(`not a date: ${d}`);
    return this.jumpTo(t).date;
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
  /** A quality level with its budgets (low · medium · high · ultra · realtime · game). */
  quality(q: Settings["quality"]) {
    if (!(q in QUALITY)) throw new Error(`no quality "${q}" — ${Object.keys(QUALITY).join(", ")}`);
    Object.assign(this.ctx.settings, QUALITY[q], { quality: q });
    this.ctx.changed([...(Object.keys(QUALITY[q]) as (keyof Settings)[]), "quality", "pixelRatio"]);
    return q;
  }
  preset(name: string) {
    this.ctx.preset(name);
    this.log.add("info", `Scene: ${name}`, this.ctx.time());
  }

  // ------------------------------------------------------------------------------ saved games
  snapshot(name = "autosave"): GameSave {
    const c = this.ctx.camera,
      s = this.ctx.settings;
    let summary = "";
    try {
      const st = this.status();
      const alt =
        Number.isFinite(st.altKm) && st.side === "ours"
          ? ` ${st.altKm >= 1e5 ? `${(st.altKm / 1.496e8).toFixed(2)} AU` : `${Math.round(st.altKm)} km`}`
          : "";
      summary = `${st.soiName} · ${st.label}${alt} · ${fmtDate(this.ctx.time())}`;
    } catch {
      summary = fmtDate(this.ctx.time());
    }
    const L = c.ourLandedOn;
    return {
      v: 2,
      name,
      savedAt: Date.now(),
      summary,
      scene: this.ctx.scene?.get() ?? null,
      // (not the player's own: a save is the game, not the screen it was played on)
      settings: pickSettings(s, "carried", "scene"),
      time: this.ctx.time(),
      ship: {
        piloting: c.piloting,
        sas: c.pilot.sas,
        hold: c.pilot.hold,
        auto: c.pilot.auto,
        throttle: c.pilot.throttle,
        precision: c.pilot.precision,
        speedMode: c.speedMode,
        landed: L ? { body: L.body, q: [...L.q] as V3 } : null,
        spent: c.spent,
        spentBy: { ...fleet.spent },
        properTime: c.properTime,
        tunnelEntry: c.tunnelEntry ?? undefined,
        entrySite: c.entrySite?.name ?? null,
        route: c.nav.route.wps.length ? structuredClone(c.nav.route) : null,
        // (waited for, or under way: what is left of it)
        entryPlan:
          c.entryRun && (c.entryRun.phase === "wait" || c.entryRun.phase === "burn")
            ? {
                tBurn: c.entryRun.tBurn,
                dv: c.entryRun.dv - c.entryRun.done,
                trim: c.entryRun.trim && !c.entryRun.trim.done ? { t: c.entryRun.trim.t, dv: c.entryRun.trim.dv } : null,
                plan: c.entryRun.plan ?? null,
              }
            : null,
        // (the camera on the craft: its attitude is the camera's through it — a director's shot is not saved)
        view: c.piloting && s.ship ? structuredClone(c.lastPose ?? c.shipPose()) : null,
      },
      // (the fleet as it flies: the craft flown, the others' coasts, the docks — reloaded, the craft flown
      // is not "switched to": a Lander saved over Kennedy once reloaded in its 500 km orbit)
      fleet: { active: fleet.active, free: structuredClone(fleet.free), links: structuredClone(fleet.links) },
      plan: c.plan.nodes.length
        ? { nodes: c.plan.nodes.map((n) => ({ ...n })), note: c.plan.note, mission: c.ourMission, universe: c.plan.universe }
        : null,
      character: c.character.snapshot(),
      camera: { gravity: c.gravity && !c.piloting },
    };
  }

  /** Restores a saved game (a slot's name, or the save itself); quiet: not in the journal (a video's
   *  return to its start). */
  load(g: string | GameSave, o: { quiet?: boolean } = {}) {
    const save = typeof g === "string" ? (g === "autosave" ? autosave.get() : slots.get(g)) : g;
    if (!save) throw new Error(`no saved game "${g}"`);
    const s = this.ctx.settings,
      c = this.ctx.camera;
    // (the player's own — the budget, the display, the sound, the aids — stay theirs: settings.ts SETTING_KIND)
    const own = pickSettings(s, "pref");
    Object.assign(s, defaultSettings(), save.settings, own);
    this.ctx.setTime(save.time);
    c.setCinematic(null);
    c.newFlight();
    // (the fleet as saved, the craft flown the save's — not switched to from the one flown before: the
    // switch puts the camera where the fleet had that craft, not where the save has it)
    if (save.fleet) {
      fleet.free = structuredClone(save.fleet.free);
      fleet.links = structuredClone(save.fleet.links);
    }
    fleet.active = save.fleet?.active ?? s.vessel;
    s.vessel = fleet.active;
    setMountVessel(fleet.active);
    // (the camera straight at the saved craft's attach point, as a scene does: the last craft's pose kept
    // turned the ship by its own mount — a docking reloaded 169° off the port's axis, spun back at 30°/s)
    c.settleMount();
    c.tunnelEntry = save.ship.tunnelEntry ?? null;
    if (save.ship.piloting && s.ship) {
      c.setPilot(true);
      c.tunnelEntry = save.ship.tunnelEntry ?? null;
      // (setPilot's own choices — time running, the path shown — give way to the saved ones)
      Object.assign(s, save.settings, own);
      const p = c.pilot;
      p.sas = save.ship.sas;
      p.precision = save.ship.precision;
      p.throttle = save.ship.throttle;
      c.speedMode = save.ship.speedMode;
      if (save.ship.spentBy) fleet.spent = { ...save.ship.spentBy };
      c.spent = save.ship.spent;
      c.properTime = save.ship.properTime;
      if (save.plan) {
        c.plan = { nodes: save.plan.nodes, path: null, at: 0, note: save.plan.note, universe: save.plan.universe };
        c.ourMission = save.plan.mission as typeof c.ourMission;
      }
      p.hold = save.ship.hold;
      if (save.ship.auto !== "none" && (save.ship.auto !== "node" || save.plan)) p.auto = save.ship.auto;
      // (the craft as it pointed: through the camera's pose on it then — the director's shot, a view dragged)
      if (save.ship.view) c.holdMount(save.ship.view);
    }
    c.setOurLanded(save.ship.landed);
    // (the entry's site: the save's, not the nearest pass's — a deorbit to Le Bourget reloaded to Baikonur;
    // none saved, none: the last flight's kept graded a Lander at Kennedy on its distance to Le Bourget)
    const site = save.ship.entrySite ? SITES.find((q) => q.name === save.ship.entrySite) : undefined;
    c.entrySite = site ?? null;
    // (the flight plan: kept, its guidance off — engaged again by the pilot)
    const rt = save.ship.route;
    if (rt && Array.isArray(rt.wps)) {
      c.nav.route = structuredClone(rt);
      c.nav.on = { l: false, v: false };
      c.routeChanged();
    }
    c.entryResume = save.ship.entryPlan ?? null;
    // (the free camera falling freely: again, from its saved velocity)
    if (!s.ship && !!save.camera?.gravity !== c.gravity) {
      const vel = [s.velR, s.velT, s.velP];
      c.setGravity(!!save.camera?.gravity);
      if (c.gravity) [s.velR, s.velT, s.velP] = vel as [number, number, number];
    }
    c.sync();
    if (save.character) c.character.restore(save.character);
    this.ctx.scene?.set(save.scene ?? null);
    this.ctx.refresh();
    if (!o.quiet) this.log.add("save", `Loaded "${save.name}" — ${save.summary}`, save.time);
    return save.summary;
  }

  save(name?: string) {
    const g = this.snapshot(name?.trim() || `Save ${new Date().toLocaleString()}`);
    if (!slots.put(g)) throw new Error("the browser refused to store it (storage full or private mode)");
    this.savedAt = Date.now();
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
    const ok = autosave.set(this.snapshot("autosave"));
    if (ok) this.savedAt = Date.now();
    return ok;
  }
  /** this visit's last save — the autosave or one's own — [ms since 1970] (null: none yet) */
  savedAt: number | null = null;

  // ------------------------------------------------------------------------------ performance
  /**
   * Where the frame's time goes: the loop's and the rendered frame rates, the main thread's sections
   * (mean and worst), the GPU's passes (timestamps: switched on by the first call — read again a
   * few seconds later), the image size and the realtime subsampling.
   */
  perf(o: { gpu?: boolean } = {}) {
    const r = this.ctx.renderer,
      s = this.ctx.settings;
    if (o.gpu !== false && !r.prof.enabled) {
      r.prof.enabled = true;
      r.prof.reset();
    }
    const cv = document.getElementById("view") as HTMLCanvasElement | null;
    const r2 = (x: number) => Math.round(x * 100) / 100;
    return {
      loopFps: r2(cpuProf.loopFps),
      renderFps: r2(cpuProf.renderFps),
      worstLoopMs: r2(cpuProf.worstLoop),
      gpuFrameMs: r2(r.lastGpuMs),
      gpuPassesMs: r2(r.prof.frameMs),
      gpuProfiled: r.prof.frames,
      gpuSupported: r.prof.supported,
      image: cv ? `${cv.width}×${cv.height}` : "",
      pixelRatio: s.pixelRatio,
      tier: r.tier,
      renderScale: this.ctx.renderScale(),
      quality: s.quality,
      budgetMs: s.realtimeBudget,
      terrainCache: r.terrainCacheStats,
      terrainRaster: r.terrainRasterStats,
      earthSurface: r.earthSurface.stats(),
      earthScenery: r.earthScenery.stats(),
      streaming: r.streamingState,
      character: this.ctx.camera.character.state(),
      grass: r.characterRenderer.stats(),
      block: r.realtimeBlockNow,
      // (the shader compiles: running, queued, the scene's tracer's time left; a Windows laptop on its integrated GPU, and
      // the way out — docs/PLAN-LEAN-TRACER-KERNELS.md P2)
      graphics: {
        compiling: r.compilingNow,
        compilesPending: r.compilesPending,
        sceneCompileEtaS: r.sceneCompileEta(),
        adapter: r.adapter ? `${r.adapter.vendor} ${r.adapter.description}`.trim() : null,
        integratedGpu:
          r.adapter &&
          windowsIntegratedGpu({
            userAgent: navigator.userAgent,
            vendor: r.adapter.vendor,
            description: r.adapter.description,
            architecture: r.adapter.architecture,
          })
            ? gpuTipText()
            : null,
      },
      cpu: cpuProf.table().map((c) => ({ section: c.label, ms: r2(c.ms), worst: r2(c.max) })),
      gpu: r.prof.table().map((p) => ({ pass: p.label, ms: r2(p.ms), last: r2(p.last), frames: p.n })),
    };
  }

  // ------------------------------------------------------------------------------ audit
  async audit(o: { planner?: boolean } = {}) {
    const c = this.ctx.camera,
      r = this.ctx.renderer;
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
    const rep = await runAudit(
      {
        settings: this.ctx.settings,
        time: this.ctx.time(),
        status: st,
        ship: info.ref && info.X && info.V ? { X: info.X as V3, V: info.V as V3, ref: info.ref } : null,
        snapshot: () => this.snapshot("audit"),
        fps: () => this.ctx.fps(),
        gpuMs: () => r.lastGpuMs,
        probeSeries: async (n) => (this.ctx.settings.ship && r.shipReady ? frames(n, () => r.readShipLight()) : null),
        evSeries: (n) => frames(n, () => r.autoEV),
        errors: () => this.errors,
      },
      o,
    );
    this.lastAudit = rep;
    this.log.add(
      "audit",
      `Audit: ${rep.counts.pass} pass, ${rep.counts.warn} warn, ${rep.counts.fail} fail, ${rep.counts.skip} skipped`,
      this.ctx.time(),
      rep,
    );
    return rep;
  }
}
