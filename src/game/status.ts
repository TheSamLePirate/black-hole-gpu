// The Ranger's state for the telemetry and the tools: which side of the wormhole, the body of the
// sphere of influence, what the ship is doing there (landed, in the air, suborbital, in orbit,
// escaping), its orbit's elements, the target, and the next event on its free-fall path.
// Physical units: km, m/s, s.

import { t as tx } from "../i18n";
import type { CameraController } from "../controls";
import type { Settings } from "../settings";
import { BODY_NAMES } from "../targeting";
import { M_METRES, M_SECONDS, solarBody, solarState } from "../system/solar";
import { soiOf } from "../system/our-side";
import { altitudeOver, figureUp } from "../system/our-surface";
import { flatteningOf } from "../system/ellipsoid";
import { classify, elements, orbitClearsHeight, orbitExtreme, STATUS_LABEL, type Elements, type Status, type V3 } from "./orbit";
import { airTopKm, equatorAxes, frameRate } from "./place";
import { C_MPS } from "../units";
import { sub } from "../math/vec3";

type Info = ReturnType<CameraController["flightInfo"]>;

const C = C_MPS;
const nameOf = (id: string) => (BODY_NAMES as Record<string, string>)[id] ?? tx(solarBody(id)?.name ?? id);

export interface OrbitFigures {
  /** equatorial radius for orbit drawings; apsis heights cannot be used to reconstruct it */
  radiusKm: number;
  /** the orbit's lowest and highest heights over the surface [km] — geodetic: over the Earth's ellipsoid
   *  not those at the radial apsides (tPe, tAp), the lowest the one the status's clearance is judged by */
  peKm: number;
  apKm: number;
  /** their true anomalies [rad] (from the periapsis; the highest NaN when unbound) */
  peNu: number;
  apNu: number;
  incDeg: number;
  ecc: number;
  /** [s] (∞ unbound) */
  period: number;
  tPe: number;
  tAp: number;
  /** semi-major axis [km] */
  aKm: number;
}

export interface RangerStatus {
  side: "ours" | "gargantua" | "throat";
  /** the body of the sphere of influence */
  soi: string;
  soiName: string;
  /** its radius from the body's centre [km] (∞: the Sun, Gargantua) */
  soiKm: number;
  status: Status | "throat" | "plunge" | "bound" | "unbound";
  label: string;
  /** above the body's surface [km]; speed relative to it and vertical speed [m/s] */
  altKm: number;
  speed: number;
  vVert: number;
  orbit: OrbitFigures | null;
  target: { id: string; name: string; distKm: number; rate: number; caKm: number; caIn: number } | null;
  /** the next event on the free-fall path: leaving / entering a sphere of influence, an impact, the mouth */
  next: { kind: "exit" | "enter" | "impact" | "mouth"; body: string; name: string; inS: number } | null;
  /** Kerr figures on Gargantua's side, far from the planets: r [M], E, L */
  kerr: { r: number; E: number; L: number } | null;
}

function figures(el: Elements, R: number, km: number, sec: number, flattening = 0): OrbitFigures {
  const lowest = orbitExtreme(el, R, flattening),
    highest = orbitExtreme(el, R, flattening, true);
  return {
    radiusKm: R * km,
    peKm: lowest.h * km,
    apKm: highest.h * km,
    peNu: lowest.nu,
    apNu: highest.nu,
    incDeg: (el.i * 180) / Math.PI,
    ecc: el.e,
    period: el.period * sec,
    tPe: el.tPe * sec,
    tAp: el.tAp * sec,
    aKm: el.a * km,
  };
}

/** The Ranger's status from the controller's flight figures at scene time t. */
export function rangerStatus(s: Settings, cam: CameraController, info: Info, t: number): RangerStatus {
  const kmM = M_METRES / 1e3;
  const out: RangerStatus = {
    side: "ours",
    soi: "sun",
    soiName: tx("Sun"),
    soiKm: Infinity,
    status: "orbit",
    label: "",
    altKm: NaN,
    speed: NaN,
    vVert: NaN,
    orbit: null,
    target: null,
    next: null,
    kerr: null,
  };
  // Map projection in Dneg is not an orbital state. Only the physical cylinder is a tunnel.
  if (info.region === "throat" && info.map && (info.map.tunnel.inside || !info.ref)) {
    const tunnel = info.map.tunnel;
    return {
      ...out,
      side: tunnel.inside ? "throat" : info.map.universe,
      soi: "wormhole",
      soiName: tx("Wormhole"),
      status: tunnel.inside ? "throat" : "escape",
      label: tunnel.inside ? "IN THE THROAT" : tx("Near the wormhole"),
      speed: info.speed * C,
    };
  }
  // ---- our universe (home frame, Newton)
  if (info.ref && info.X && info.V) {
    const ref = info.ref;
    const b = solarBody(ref)!;
    const B = solarState(ref, t);
    const r = sub(info.X as V3, B.pos as V3),
      v = sub(info.V as V3, B.vel as V3);
    const el = elements(b.mass, r, v, equatorAxes(ref));
    const soi = soiOf(ref, t);
    const f = flatteningOf(ref);
    const altitude = altitudeOver(ref, info.X as V3, t);
    const top = airTopKm(ref) / kmM;
    const st = classify(el, {
      R: b.radius,
      airTop: b.radius + top,
      soi,
      landed: info.landed,
      clearOfAir: orbitClearsHeight(el, b.radius, f, top),
      altitude: altitude / M_METRES,
    });
    const vertical = figureUp(ref, info.X as V3, t);
    Object.assign(out, {
      side: "ours",
      soi: ref,
      soiName: tx(b.name),
      soiKm: soi * kmM,
      status: st,
      label: STATUS_LABEL[st],
      // (over the figure: the Earth's ellipsoid — the poles 21 km nearer the centre than the equator)
      altKm: altitude / 1e3,
      speed: el.v * C,
      vVert: (vertical[0] * v[0] + vertical[1] * v[1] + vertical[2] * v[2]) * C,
      orbit: st === "landed" ? null : figures(el, b.radius, kmM, M_SECONDS, f),
    });
    if (info.target && info.target !== "hole" && Number.isFinite(info.targetDist)) {
      out.target = {
        id: info.target,
        name: nameOf(info.target),
        distKm: info.targetDist * kmM,
        rate: info.targetRate * C,
        caKm: info.ourCa ? info.ourCa.d * kmM : NaN,
        caIn: info.ourCa ? info.ourCa.t * M_SECONDS : NaN,
      };
    }
    // the free-fall path: the next change of sphere of influence, an impact, the mouth
    const p = st === "landed" ? null : info.ourFree;
    if (p && p.pts.length > 1) {
      const k = p.refs.findIndex((q) => q !== p.refs[0]);
      if (k > 0) {
        const to = p.refs[k]!;
        const enter = solarBody(to)?.parent === p.refs[0];
        out.next = {
          kind: enter ? "enter" : "exit",
          body: enter ? to : p.refs[0]!,
          name: nameOf(enter ? to : p.refs[0]!),
          inS: (p.times[k]! - t) * M_SECONDS,
        };
      } else if (p.fate === "impact" && p.hit) {
        out.next = { kind: "impact", body: p.hit, name: nameOf(p.hit), inS: (p.times.at(-1)! - t) * M_SECONDS };
      } else if (p.fate === "wormhole") {
        out.next = { kind: "mouth", body: "wormhole", name: tx("Wormhole"), inS: (p.times.at(-1)! - t) * M_SECONDS };
      }
    }
    return out;
  }
  // ---- inside the wormhole's throat region
  if (info.region === "throat") {
    return {
      ...out,
      side: "throat",
      soi: "wormhole",
      soiName: tx("Wormhole"),
      status: "throat",
      label: "IN THE THROAT",
      altKm: NaN,
      speed: info.speed * C,
    };
  }
  // ---- Gargantua's side
  out.side = "gargantua";
  const sec = 4.925490947e-6 * s.massSolar;
  const loc = cam.local;
  if (loc) {
    // a planet's frame: proper lengths, turning with its orbit (inertial velocity: w + Ω ẑ × ξ)
    const { F, L } = loc;
    const W = frameRate(F);
    const w: V3 = [L.w[0] - W * L.xi[1], L.w[1] + W * L.xi[0], L.w[2]];
    const el = elements(F.m, L.xi as V3, w);
    const km = F.mPerM / 1e3;
    const top = F.atm ? F.R + (12 * F.atm.H) / F.mPerM : F.R;
    const st = classify(el, { R: F.R, airTop: top, landed: L.landed });
    Object.assign(out, {
      soi: F.id,
      soiName: nameOf(F.id),
      status: st,
      label: STATUS_LABEL[st],
      altKm: (el.r - F.R) * km,
      speed: el.v * C,
      vVert: ((L.xi[0] * w[0] + L.xi[1] * w[1] + L.xi[2] * w[2]) / el.r) * C,
      orbit: st === "landed" ? null : figures(el, F.R, km, sec),
    });
  } else {
    // Gargantua: a Kerr orbit (bound when E < 1); the path's fate
    const fate = info.path?.fate;
    const st = fate === "horizon" ? "plunge" : info.E < 1 ? "bound" : "unbound";
    Object.assign(out, {
      soi: "gargantua",
      soiName: "Gargantua",
      status: st,
      label: st === "plunge" ? "PLUNGING" : st === "bound" ? "KERR ORBIT" : "UNBOUND",
      altKm: (info.r * M_METRES * (s.massSolar / 1e8)) / 1e3,
      speed: info.speed * C,
      vVert: info.vr * C,
      kerr: { r: info.r, E: info.E, L: info.L },
    });
  }
  if (info.target && info.target !== "hole" && Number.isFinite(info.targetDist)) {
    const kmPerM = (1476.625 * s.massSolar) / 1e3;
    out.target = {
      id: info.target,
      name: nameOf(info.target),
      distKm: info.targetDist * kmPerM,
      rate: info.targetRate * C,
      caKm: NaN,
      caIn: NaN,
    };
  }
  return out;
}
