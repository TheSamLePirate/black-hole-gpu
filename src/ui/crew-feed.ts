// Built only into the simulator: the crew receives small display snapshots, never a physics engine.
import type { CameraController } from "../controls";
import type { InstrumentSnapshot } from "../net/instruments";
import type { RangerStatus } from "../game/status";
import type { Info } from "./flighthud";
import { shownSpeed } from "./hud/model";
import { C_MPS, M_SECONDS } from "../units";
import { cartToGeodetic, flatteningOf } from "../system/ellipsoid";
import { toBodyFixed } from "../system/our-surface";
import { solarBody } from "../system/solar";

export function crewSnapshot(c: CameraController, i: Info, status: RangerStatus | null, t: number): InstrumentSnapshot {
  const g = c.geoNow();
  const body = status?.soi ?? i.ref ?? (i.region === "hole" ? "gargantua" : "unknown");
  const b = solarBody(body);
  const path = i.ourPlan ?? i.ourFree;
  const ahead: InstrumentSnapshot["ahead"] = [];
  if (path && b) {
    const step = Math.max(1, Math.ceil(path.pts.length / 48));
    for (let j = 0; j < path.pts.length; j += step) {
      if (path.refs[j] !== body) continue;
      const q = toBodyFixed(body, path.pts[j]!, path.times[j]!);
      const ll = cartToGeodetic(b.radius, flatteningOf(body), q);
      ahead.push({ lat: (ll.lat * 180) / Math.PI, lon: (ll.lon * 180) / Math.PI });
    }
  }
  // geoNow is Earth-only. Other solid bodies use their own fixed axes and figure.
  let geo: InstrumentSnapshot["geo"] = g ? { lat: g.lat, lon: g.lon, heading: i.radar?.heading ?? g.track } : null;
  if (!geo && b && i.X) {
    const ll = cartToGeodetic(b.radius, flatteningOf(body), toBodyFixed(body, i.X, t / M_SECONDS));
    geo = { lat: (ll.lat * 180) / Math.PI, lon: (ll.lon * 180) / Math.PI, heading: 0 };
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
      ...(i.air ? { g: i.air.g, q: i.air.q, mach: i.air.mach, heat: i.air.heat } : {}),
      throttle: i.throttle,
      ...(i.engine.fuel ? { fuel: i.engine.fuel.fraction } : {}),
      tau: c.netClockRate(),
    },
    radar: i.radar
      ? {
          mode: i.radar.mode,
          contacts: i.radar.contacts
            .slice(0, 24)
            .map((p) => ({ id: p.id.slice(0, 64), name: p.name.slice(0, 64), e: p.e, n: p.n, dz: p.dz, iff: p.iff, locked: p.locked })),
        }
      : null,
    route: body === "earth" ? c.nav.route.wps.slice(0, 32).map((p) => ({ name: p.name.slice(0, 64), lat: p.lat, lon: p.lon })) : [],
  };
}
