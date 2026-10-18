// Built only into the simulator: the crew receives small display snapshots, never a physics engine.
import type { CameraController } from "../controls";
import type { InstrumentSnapshot } from "../net/instruments";
import type { RangerStatus } from "../game/status";
import type { Info } from "./flighthud";
import { shownSpeed } from "./hud/model";
import { C_MPS, M_METRES, M_SECONDS } from "../units";
import { cartToGeodetic, flatteningOf } from "../system/ellipsoid";
import { toBodyFixed } from "../system/our-surface";
import { solarBody } from "../system/solar";
import { fuelPlan } from "../game/flightplan";
import type { Family } from "../net/crewcmd";
import { fleet } from "../fleet";
import { VESSELS } from "../vessels";
import { cruiseBurn } from "../f35/cruise";
import { CARRIER } from "../game/carrier";
import { enuAt } from "../controller/traffic";
import { WGS84_A, WGS84_F, wgs84Inverse, wgs84Offset } from "../system/ellipsoid";

const D = Math.PI / 180;

/**
 * The crew's families open now (net/crewcmd.ts): the flight plan over the Earth; the configuration on a craft that
 * flies; the jet's autopilot in plane mode in the air, the spacecraft's out of it; the weapons in the F-35.
 */
export function crewFamilies(c: CameraController): Family[] {
  const A = c.airInfo();
  const out: Family[] = [];
  if (c.geoNow()) out.push("nav");
  if (VESSELS[fleet.active].flies) out.push("config");
  if (A.inAir && A.mode === "plane") out.push("jet");
  else if (!A.inAir || A.mode === "rocket") out.push("space");
  if (fleet.active === "f35") out.push("weapons");
  return out;
}
const fin = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** The alerts lit for the crew's annunciator, in their order of urgency. */
function warnings(i: Info, status: RangerStatus | null, fuelKg: number | null, bingo: number | null): string[] {
  const w: string[] = [];
  const A = i.air;
  if (i.gcas?.flyUp) w.push("FLY UP");
  if (Number.isFinite(i.terrainAhead) && i.terrainAhead < 12) w.push("PULL UP");
  else if (i.gcas?.near) w.push("TERRAIN");
  if (i.body.gloc) w.push("G-LOC");
  if (i.combat?.radar.missiles.some((m) => m.red)) w.push("MISSILE");
  if (A?.inAir && A.stalled) w.push("STALL");
  if (A?.aoaWarn) w.push("AOA");
  if (A?.inAir && A.gMax > 0 && Math.abs(A.g) > A.gMax) w.push("OVER G");
  if (A?.gearWarn) w.push("GEAR");
  if (A?.failure) w.push("FAILURE");
  if (fuelKg !== null && bingo !== null && fuelKg < bingo) w.push("BINGO");
  if (i.engine.fuel && i.engine.fuel.fraction < 0.1) w.push("FUEL LOW");
  // (the free-fall path's impact: a rocket's, a glider's out of the air — an aircraft flying always "hits" on it)
  if (status?.next?.kind === "impact" && status.next.inS < 120 && !(A?.inAir && A.mode !== "rocket")) w.push("IMPACT");
  return w;
}

const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
const r1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Everything about over the Earth (the crew's map and radar): the real traffic (the nearest), a mission's units and
 * its zones, the carriers at sea, a fight's targets (their offsets from us, flat over a few tens of km).
 */
function surroundings(c: CameraController, i: Info, here: { lat: number; lon: number; alt: number } | null) {
  const traffic: NonNullable<InstrumentSnapshot["traffic"]> = [];
  const zones: NonNullable<InstrumentSnapshot["zones"]> = [];
  if (!here) return { traffic, zones };
  const marks = c.missionMarks();
  for (const m of marks) {
    if (m.kind === "zone" || m.kind === "threat") {
      if (m.r)
        zones.push({ lat: r5(m.lat), lon: r5(m.lon), r: Math.round(m.r), name: m.label, kind: m.kind, waiting: m.state === "waiting" });
      continue;
    }
    traffic.push({
      id: `m:${m.unit ?? m.label}`,
      name: m.label,
      kind: m.kind === "carrier" ? "sea" : m.air ? "air" : "ground",
      side: m.kind,
      lat: r5(m.lat),
      lon: r5(m.lon),
      alt: null,
      hdg: m.hdg !== undefined ? r1(m.hdg) * D : null,
      spd: null,
      type: "",
    });
  }
  for (const k of c.carrierNow())
    if (!marks.some((m) => m.kind === "carrier" && Math.abs(m.lat - k.P.lat) < 1e-3))
      traffic.push({
        id: `cv:${k.sp.kind}`,
        name: CARRIER[k.sp.kind].name,
        kind: "sea",
        side: "carrier",
        lat: r5(k.P.lat),
        lon: r5(k.P.lon),
        alt: 0,
        hdg: k.sp.heading,
        spd: k.sp.speed,
        type: k.sp.kind,
      });
  // a fight without a mission: its targets from the radar's picture (heading up → east/north)
  const cb = i.combat;
  if (cb && !marks.length) {
    const psi = (c.attitudeNow() as { heading?: number }).heading ?? 0;
    const cs = Math.cos(psi),
      sn = Math.sin(psi);
    cb.radar.contacts.forEach((q, j) => {
      const e = q.x * cs + q.y * sn,
        n = -q.x * sn + q.y * cs;
      const at = wgs84Offset(here.lat, here.lon, e, n);
      traffic.push({
        id: `f:${j}`,
        name: q.name,
        kind: q.air ? "air" : "ground",
        side: !q.alive ? "dead" : q.colour?.startsWith("rgba(110") ? "friend" : "hostile",
        lat: r5(at.lat),
        lon: r5(at.lon),
        alt: Math.round(here.alt + q.dz),
        hdg: q.trk !== null ? q.trk + psi : null,
        spd: null,
        type: "",
      });
    });
  }
  if (c.s.traffic) {
    const near = c
      .trafficNow()
      .map((a) => {
        const g = cartToGeodetic(WGS84_A, WGS84_F, a.p as [number, number, number]);
        const lat = g.lat / D,
          lon = g.lon / D;
        const d = wgs84Inverse(here.lat, here.lon, lat, lon).d;
        return { a, lat, lon, h: g.h, d };
      })
      .sort((x, y) => x.d - y.d)
      .slice(0, 64);
    for (const { a, lat, lon, h } of near) {
      const f = enuAt(lat, lon);
      const ve = a.v[0]! * f.E[0]! + a.v[1]! * f.E[1]! + a.v[2]! * f.E[2]!;
      const vn = a.v[0]! * f.N[0]! + a.v[1]! * f.N[1]! + a.v[2]! * f.N[2]!;
      traffic.push({
        id: `t:${a.id}`,
        name: a.cs.trim() || a.reg || a.id,
        kind: "air",
        side: "traffic",
        lat: r5(lat),
        lon: r5(lon),
        alt: Math.round(h),
        hdg: Math.round(Math.atan2(ve, vn) * 1000) / 1000,
        spd: Math.round(Math.hypot(ve, vn)),
        type: a.gnd ? `${a.type} SOL` : a.type,
      });
    }
  }
  return { traffic, zones };
}

export function crewSnapshot(c: CameraController, i: Info, status: RangerStatus | null, t: number, around = false): InstrumentSnapshot {
  const g = c.geoNow();
  const body = status?.soi ?? i.ref ?? (i.region === "hole" ? "gargantua" : "unknown");
  const b = solarBody(body);
  const path = i.ourPlan ?? i.ourFree;
  const ahead: InstrumentSnapshot["ahead"] = [];
  const flying = !!(i.air?.inAir && i.air.mode !== "rocket" && g);
  if (flying && g) {
    // an aircraft's path ahead: its turn now carried on (the rate its bank gives at its speed), its climb, 3 minutes —
    // over the WGS84 ellipsoid a step at a time (the free-fall path is not what a wing flies)
    const bank = (c.attitudeNow() as { velBank?: number; bank?: number }).velBank ?? (c.attitudeNow() as { bank?: number }).bank ?? 0;
    const rate = Math.max(-0.2, Math.min(0.2, (9.80665 * Math.tan(bank)) / Math.max(g.gs, 30)));
    let lat = g.lat,
      lon = g.lon,
      trk = g.track;
    const dt = 6;
    for (let k = 1; k <= 30; k++) {
      trk += rate * dt;
      const q = wgs84Offset(lat, lon, Math.sin(trk) * g.gs * dt, Math.cos(trk) * g.gs * dt);
      lat = q.lat;
      lon = q.lon;
      ahead.push({ lat: r5(lat), lon: r5(lon), t: k * dt, h: g.alt + g.vs * k * dt });
    }
  } else if (path && b) {
    const step = Math.max(1, Math.ceil(path.pts.length / 48));
    for (let j = 0; j < path.pts.length; j += step) {
      if (path.refs[j] !== body) continue;
      const q = toBodyFixed(body, path.pts[j]!, path.times[j]!);
      const ll = cartToGeodetic(b.radius, flatteningOf(body), q);
      ahead.push({ lat: ll.lat / D, lon: ll.lon / D, t: path.times[j]! * M_SECONDS - t, h: ll.h * M_METRES });
    }
  }
  // geoNow is Earth-only. Other solid bodies use their own fixed axes and figure.
  let geo: InstrumentSnapshot["geo"] = g ? { lat: g.lat, lon: g.lon, heading: i.radar?.heading ?? g.track } : null;
  if (!geo && b && i.X) {
    const ll = cartToGeodetic(b.radius, flatteningOf(body), toBodyFixed(body, i.X, t / M_SECONDS));
    geo = { lat: ll.lat / D, lon: ll.lon / D, heading: 0 };
  }
  const A = i.air;
  const att = c.attitudeNow() as { pitch?: number; bank?: number; heading?: number };
  const av = i.avionics;
  const m = i.jet?.modes ?? null;
  const N = c.nav;
  const L = N.last.l;
  const V = N.last.v;
  const routed = body === "earth" && N.route.wps.length > 0;
  const bingo = av ? fin(av.bingo) : null;
  const fuelKg = av ? av.fuel : (i.engine.jet?.kg ?? null);
  // the plan's rest, from the active point on (the F-35's cruise model; the leg flown at its flow now)
  let fuelToGo: number | null = null,
    timeToGo: number | null = null;
  if (routed && L && av) {
    const rest = fuelPlan(N.route, cruiseBurn, L.active);
    const ete = Number.isFinite(L.ete) ? L.ete : 0;
    timeToGo = ete + rest.time;
    fuelToGo = av.flow * ete + rest.fuel;
  }
  return {
    v: 1,
    t,
    body,
    geo,
    ahead,
    metrics: {
      ...(status ? { alt: status.altKm * 1000, vz: status.vVert } : {}),
      speed: shownSpeed(i).v * C_MPS,
      ...(A ? { g: A.g, q: A.q, mach: A.mach, heat: A.heat } : {}),
      throttle: i.throttle,
      ...(i.engine.fuel ? { fuel: i.engine.fuel.fraction } : {}),
      tau: c.netClockRate(),
    },
    flight:
      att.pitch !== undefined && att.bank !== undefined && att.heading !== undefined
        ? {
            pitch: att.pitch,
            bank: att.bank,
            hdg: att.heading,
            ...(g ? { track: g.track, gs: g.gs, fpa: Math.atan2(g.vs, Math.max(g.gs, 1)) } : {}),
            ...(A?.inAir
              ? {
                  aoa: A.alpha,
                  beta: A.beta,
                  tas: A.speed,
                  eas: A.speed * Math.sqrt(Math.max(A.rho, 0) / 1.225),
                  nz: A.nz,
                  gMax: av ? av.gLimit : A.gMax,
                  buffet: A.buffet,
                  ...(A.stallA !== null ? { stallAoa: A.stallA } : {}),
                }
              : {}),
            ...(i.surface && Number.isFinite(i.surface.alt) ? { agl: i.surface.alt } : {}),
            ...(A?.wind ? { wind: { spd: A.wind.speed, from: A.wind.from * D } } : {}),
            ...(Number.isFinite(i.terrainAhead) ? { terrain: i.terrainAhead } : {}),
          }
        : null,
    auto: {
      mode: A?.mode ?? "",
      assist: av ? c.assistLevel() : i.assist ? "assisted" : "",
      alt: m?.alt ?? null,
      hdg: m?.hdg ?? null,
      spd: m?.spd ?? null,
      ab: !!m?.ab,
      lnav: N.on.l,
      vnav: N.on.v,
      auto: i.auto,
      hold: i.hold,
      sas: i.sas,
      order: m?.order ?? (m?.icpt ? "ICPT" : m?.form ? "FORM" : m?.tf !== undefined ? "TF" : ""),
      hub: i.hub ? { title: i.hub.title, phase: i.hub.phase, next: i.hub.next ?? "", bar: i.hub.bar } : null,
    },
    nav:
      routed && L
        ? {
            active: L.active,
            dist: L.dist,
            brg: L.brg,
            ete: fin(L.ete),
            xtk: L.xtk,
            dtk: L.dtk,
            phase: V?.phase ?? "",
            tod: fin(V?.tod),
            altT: fin(V?.alt),
            spdT: fin(V?.spd),
            cruiseAlt: N.route.cruiseAlt,
            cruiseSpd: N.route.cruiseSpd,
            bingo,
            fuelToGo,
            timeToGo,
          }
        : null,
    sys: {
      engine: i.engine.kind,
      spool: av ? av.spool : null,
      thrust: av ? av.thrustKn : null,
      ab: av ? av.ab : null,
      flow: av ? av.flow : null,
      fuelKg: av ? (av.infiniteFuel ? av.full : av.fuel) : fuelKg,
      fuelFull: av ? av.full : (i.engine.jet?.full ?? null),
      gear: i.gear.ext,
      gearDown: i.gear.down,
      flaps: i.gear.flaps,
      brake: i.gear.brake,
      stovl: av?.stovl ?? "",
      hull: A && A.hullMax > 0 ? A.hull / A.hullMax : null,
      shield: A && A.shieldMax > 0 ? A.shield / A.shieldMax : null,
      damage: av ? av.damage : null,
      mass: fin(i.mass),
    },
    ils: i.ils ? { id: i.ils.id, loc: i.ils.loc, gs: i.ils.gs, dme: i.ils.dme, phase: i.ils.phase } : null,
    orbit: status?.orbit
      ? {
          pe: status.orbit.peKm,
          ap: status.orbit.apKm,
          inc: status.orbit.incDeg,
          ecc: status.orbit.ecc,
          period: fin(status.orbit.period),
          tPe: fin(status.orbit.tPe),
          tAp: fin(status.orbit.tAp),
        }
      : null,
    next: status?.next ? { kind: status.next.kind, name: status.next.name, in: status.next.inS } : null,
    msn: i.msn ? { name: i.msn.name, brg: i.msn.brg * D, dist: i.msn.dist, dz: i.msn.dz } : null,
    warn: warnings(i, status, fuelKg, bingo),
    caps: { on: c.s.netCrewActions !== false, fam: crewFamilies(c) },
    ...(around && body === "earth" ? surroundings(c, i, g ? { lat: g.lat, lon: g.lon, alt: g.alt } : null) : {}),
    radar: i.radar
      ? {
          mode: i.radar.mode,
          contacts: i.radar.contacts
            .slice(0, 24)
            .map((p) => ({ id: p.id.slice(0, 64), name: p.name.slice(0, 64), e: p.e, n: p.n, dz: p.dz, iff: p.iff, locked: p.locked })),
        }
      : null,
    route: routed
      ? N.route.wps.slice(0, 32).map((p) => ({
          name: p.name.slice(0, 64),
          lat: p.lat,
          lon: p.lon,
          ...(p.alt !== undefined ? { alt: p.alt } : p.field ? { alt: p.field.elev } : {}),
          ...(p.spd !== undefined ? { spd: p.spd } : {}),
        }))
      : [],
  };
}
