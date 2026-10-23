// The A320 on the ground (docs/PLAN-A320.md, A14): its ground services (src/a320/services.ts — the stairs, the GPU, the
// fuel truck refuelling it, the catering, the chocks, the de-icing, the baggage belt) and its pushback (src/a320/
// pushback.ts — FlightGear's Autopush), run each frame of its systems (controller/a320.ts); the tug's push given to the
// thrust and its steering to the nose wheel (controller/piloting.ts), its chocks and its push to the brakes
// (controller/motion.ts); the vehicles drawn about it (main.ts: renderer.a320Ground).

import { FUEL_MAX } from "../a320/fcs";
import { type P2, Pushback, type PushOut, pushRoute } from "../a320/pushback";
import { pushbackPath } from "../game/airportnet";
import { GroundServices, type ServiceId } from "../a320/services";
import { fleet } from "../fleet";
import { t } from "../i18n";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    a320GroundStep(dt: number, onWheels: boolean): void;
    a320Service(id: ServiceId, fuelTo?: number | null): string;
    a320PushCmd(cmd: "call" | "straight" | "left" | "right" | "stop" | "disconnect" | "cycle"): string;
  }
}

const D = Math.PI / 180;
const R_EARTH = 6_371_000;

/** The aircraft on the push's flat local frame (east, north [m] from where the push began — a few hundred metres at
 *  most: a flat approximation is fine), its heading [deg], its speed along its nose [m/s]. */
function where(c: CameraController): { pos: P2; hdg: number; speed: number } | null {
  const g = c.geoNow();
  if (!g) return null;
  const o = (c.a320PushOrigin ??= { lat: g.lat, lon: g.lon });
  const pos: P2 = [(g.lon - o.lon) * D * R_EARTH * Math.cos(o.lat * D), (g.lat - o.lat) * D * R_EARTH];
  const att = c.attitudeNow() as { heading?: number };
  const hdg = ((att.heading ?? g.track) * 180) / Math.PI;
  const speed = g.gs * Math.cos(g.track - (att.heading ?? g.track));
  return { pos, hdg, speed };
}

let pushAir = 0;

/** A path resampled every 2 m (the tug's driver follows near waypoints, as pushRoute gives them). */
function every2m(pts: P2[]): P2[] {
  const out: P2[] = pts.length ? [pts[0]!] : [];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]!,
      b = pts[k]!;
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
    for (let j = 1; j <= n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  return out;
}

function a320GroundStep(this: CameraController, dt: number, onWheels: boolean) {
  const A = this.a320;
  if (!A) return;
  const S = (this.a320Ground ??= new GroundServices());
  const P = this.a320Props;
  const w = where(this);
  const gs = Math.abs(w?.speed ?? 0);
  const r = S.step(P, dt, { onGround: onWheels, gs, fuelKg: A.fuel, fuelMax: FUEL_MAX });
  if (r.moved) this.a320Said?.(t("Ground services withdrawn: the aircraft moved"));
  // (the fuel truck's: the tanks filled as a refuelling does — wings first —, the fleet's fuel with them)
  if (r.fuelAdded > 0) {
    A.setFuel(A.fuel + r.fuelAdded);
    fleet.fuel.a320 = A.fuel;
  }
  // (the pushback: the tug's push and steering while it is on — the brakes, the chocks hold it)
  const T = (this.a320Push ??= new Pushback());
  if (T.phase === "idle" && T.attach <= 0) {
    this.a320PushOut = null;
    return;
  }
  // (off the ground a second — not the moments between parked and rolling as the tug sets it moving —: let go)
  const agl = this.airFlight.cfg.agl;
  pushAir = onWheels || (agl !== undefined && agl < 4) ? 0 : pushAir + dt;
  if (!w || pushAir > 1) {
    T.disconnect();
    this.a320PushOut = null;
    return;
  }
  const out: PushOut = T.step({ dt, pos: w.pos, hdg: w.hdg, speed: w.speed, braked: this.a320Park || S.chocked });
  this.a320PushOut = out;
  if (out.say) this.a320Said?.(t(out.say));
}

function a320Service(this: CameraController, id: ServiceId, fuelTo?: number | null): string {
  const A = this.a320;
  if (!A) return t("Ground services: the A320's");
  const S = (this.a320Ground ??= new GroundServices());
  const w = where(this);
  const onWheels = !!this.rolling || !!this.ourLanded;
  const r = S.toggle(id, { onGround: onWheels, gs: Math.abs(w?.speed ?? 0), fuelKg: A.fuel, fuelMax: FUEL_MAX }, fuelTo);
  return r === "on" ? t("Ground service on") : r === "off" ? t("Ground service off") : t("Ground services: at rest on the ground only");
}

function a320PushCmd(this: CameraController, cmd0: "call" | "straight" | "left" | "right" | "stop" | "disconnect" | "cycle"): string {
  const T = (this.a320Push ??= new Pushback());
  // (its key's: the next step — the tug called, the push straight back, stopped, disconnected)
  const cmd =
    cmd0 !== "cycle"
      ? cmd0
      : T.phase === "idle"
        ? "call"
        : T.phase === "connected"
          ? "straight"
          : T.phase === "pushing"
            ? "stop"
            : T.phase === "stopped"
              ? "disconnect"
              : "call";
  const onWheels = !!this.rolling || !!this.ourLanded;
  if (!this.a320 || !onWheels) return t("Pushback: on the ground only");
  let m: string | null = null;
  if (cmd === "call") m = T.connect();
  else if (cmd === "stop") m = T.stop();
  else if (cmd === "disconnect") m = T.disconnect();
  else {
    // (the route from where the aircraft is: the push's frame anew there)
    this.a320PushOrigin = null;
    const w = where(this);
    if (!w) return t("Pushback: on the ground only");
    // (the chocks taken away for the push — FlightGear's Autopush)
    this.a320Ground?.on.delete("chocks");
    // (at a stand of the airport's network — game/airportnet.ts —: its own push, back onto the taxiway the route out
    // takes; else straight back or round to a side)
    const X = this.a320Taxi;
    const g = this.geoNow();
    const at =
      X?.stand && g ? Math.hypot((g.lon - X.stand.lon) * D * R_EARTH * Math.cos(g.lat * D), (g.lat - X.stand.lat) * D * R_EARTH) : Infinity;
    const net = X?.stand && at < 25 && cmd !== "left" && cmd !== "right" ? pushbackPath(X.stand, X.net, 13.65, 45, X.route) : null;
    const o = this.a320PushOrigin!;
    m = T.push(
      net
        ? every2m(net.pts.map((q): P2 => [(q.lon - o.lon) * D * R_EARTH * Math.cos(o.lat * D), (q.lat - o.lat) * D * R_EARTH]))
        : pushRoute(w.pos, w.hdg, cmd),
    );
  }
  return m ? t(m) : t("Pushback: not now");
}

export function installA320Ground(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { a320GroundStep, a320Service, a320PushCmd });
}
