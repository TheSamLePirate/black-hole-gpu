// The A320's pushback (docs/PLAN-A320.md, A14 — FlightGear's Autopush: Nasal/Autopush/autopush.nas, driver.nas,
// route.nas, AircraftConfig/autopush-config.xml): the tug connects at the nose gear, pushes along a route at FlightGear's
// 5.5 km/h — its speed held by a PI on the nose gear's rolling speed (K_p 0.5, F_p 0.15, K_i 0.25, F_i 0.1 [(km/h)/s]
// per km/h) —, its driver steering the nose wheel toward the next waypoint (K_psi 0.03 per degree of the course's error,
// K_psidot 0.03 against the turn rate; a waypoint passed within 15 m — the tightest turn's radius —, the last within
// 5 m), stops, disconnects. The route: the aircraft's reference point's (its main gear's middle), on a flat local
// frame (east, north [m]). Pure.

/** a point on the ground's local frame: east, north [m] */
export type P2 = [number, number];

export type PushPhase = "idle" | "connecting" | "connected" | "pushing" | "stopped" | "disconnecting";

/** FlightGear's autopush-config.xml */
const CFG = { Kp: 0.5, Fp: 0.15, Ki: 0.25, Fi: 0.1, FV: 5.5, Kpsi: 0.03, Fpsi: 1, Kpsidot: 0.03, Fpsidot: 1, rTurn: 15, dStop: 5 };
/** the tug's drive up and away [s], its tow bar's full deflection [deg] */
const CONNECT_S = 6;
export const MAX_STEER_DEG = 70;
/** (FlightGear's accelerations are (km/h)/s, its force their product with the weight in pounds and M2FT/3.6 — JSBSim's
 *  pounds-force as poundals —: some 9 m/s² per (km/h)/s, which the tug's own drawbar pull caps — some 100 kN on the
 *  A320's 65 t: its engines at idle, the apron's slopes — the relief's, 5 % at Paris-CDG's T2 — pushed against) */
const ACCEL_PER = 9.0;
const ACCEL_MAX = 1.5;

const norm180 = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
/** the course [deg, from north, clockwise] from a to b */
export const course = (a: P2, b: P2) => (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;

export interface PushIn {
  dt: number;
  /** the aircraft's reference point, its heading [deg], its speed along its nose [m/s, > 0 forward] */
  pos: P2;
  hdg: number;
  speed: number;
  /** its brakes held (the parking brake, the chocks): the tug waits */
  braked: boolean;
}

export interface PushOut {
  /** the tug's push or pull along the nose [m/s² of the aircraft: < 0 backwards], the nose wheel's steering −1…1 (> 0
   *  to the right) — none: the tug not driving */
  accel: number;
  steer: number | null;
  /** the tow bar's angle off the nose [deg, > 0 the tug to the right] (the tug's mesh turned so), its distance in from
   *  where it waits 0…1 (connecting, disconnecting) */
  bar: number;
  attach: number;
  /** a message when the phase changes */
  say: string | null;
}

/** The route of a push back from where the aircraft is: straight back, then (a "tail left" or "right") a quarter
 *  turn of 25 m radius, the tail swinging to that side as seen from the cockpit, and 16 m straight on — FlightGear's
 *  route.nas's waypoints, 2 m apart. (PART A's stands give a stand's own — game/airportnet.ts pushbackPath.) */
export function pushRoute(pos: P2, hdg: number, kind: "straight" | "left" | "right", back = 30): P2[] {
  const r = (hdg * Math.PI) / 180;
  const fwd: P2 = [Math.sin(r), Math.cos(r)];
  const right: P2 = [Math.cos(r), -Math.sin(r)];
  const out: P2[] = [pos];
  const straight = kind === "straight" ? back + 20 : back;
  for (let s = 2; s <= straight; s += 2) out.push([pos[0] - fwd[0] * s, pos[1] - fwd[1] * s]);
  if (kind === "straight") return out;
  // (the arc: its centre to the side the tail goes, the path backing round it a quarter turn)
  const side = kind === "left" ? -1 : 1;
  const R = 25;
  const start = out.at(-1)!;
  const c: P2 = [start[0] + right[0] * side * R, start[1] + right[1] * side * R];
  for (let a = 5; a <= 90; a += 5) {
    const t = (a * Math.PI) / 180;
    // (from the start, round the centre: the backward direction turning toward the side)
    const ux = -right[0] * side,
      uy = -right[1] * side;
    out.push([c[0] + R * (ux * Math.cos(t) - fwd[0] * Math.sin(t)), c[1] + R * (uy * Math.cos(t) - fwd[1] * Math.sin(t))]);
  }
  // (then straight on a while: the aircraft's axis settling on the new line)
  const end = out.at(-1)!;
  const along: P2 = [side * right[0], side * right[1]];
  for (let s = 2; s <= 16; s += 2) out.push([end[0] + along[0] * s, end[1] + along[1] * s]);
  return out;
}

export class Pushback {
  phase: PushPhase = "idle";
  route: P2[] = [];
  private to = 1;
  private t = 0;
  private int = 0;
  private lastPsi: number | null = null;
  attach = 0;
  bar = 0;

  /** The tug called (it drives up to the nose gear). */
  connect(): string | null {
    if (this.phase !== "idle") return null;
    this.phase = "connecting";
    this.t = 0;
    return "Pushback: the tug is coming";
  }

  /** The push begun along a route (the tug connected, the brakes off). */
  push(route: P2[]): string | null {
    if (this.phase !== "connected" && this.phase !== "stopped") return this.phase === "idle" ? "Pushback: call the tug first" : null;
    if (route.length < 2) return "Pushback: no route";
    this.route = route;
    this.to = 1;
    this.int = 0;
    this.lastPsi = null;
    this.phase = "pushing";
    return "Pushback: release the parking brake";
  }

  stop(): string | null {
    if (this.phase !== "pushing") return null;
    this.phase = "stopped";
    return "Pushback stopped";
  }

  disconnect(): string | null {
    if (this.phase === "idle" || this.phase === "disconnecting") return null;
    this.phase = "disconnecting";
    this.t = 0;
    return "Pushback: tow bar disconnected, the tug drives away";
  }

  /** A frame. */
  step(i: PushIn): PushOut {
    let say: string | null = null;
    let accel = 0,
      steer: number | null = null;
    this.t += i.dt;
    if (this.phase === "connecting") {
      this.attach = Math.min(this.t / CONNECT_S, 1);
      if (this.attach >= 1) {
        this.phase = "connected";
        say = "Pushback connected: chocks off, release the brakes";
      }
    } else if (this.phase === "disconnecting") {
      this.attach = Math.max(1 - this.t / CONNECT_S, 0);
      this.bar += (0 - this.bar) * Math.min(i.dt * 2, 1);
      if (this.attach <= 0) this.phase = "idle";
    } else if (this.phase === "pushing" || this.phase === "stopped" || this.phase === "connected") {
      // (the driver: the course to the next waypoint against the motion's — backwards: the heading turned round)
      let target = 0;
      if (this.phase === "pushing") {
        const wp = this.route[this.to]!;
        const last = this.to === this.route.length - 1;
        const D = Math.hypot(wp[0] - i.pos[0], wp[1] - i.pos[1]);
        const leg = course(this.route[this.to - 1]!, wp);
        const A = course(i.pos, wp);
        if (last ? D < CFG.dStop || Math.abs(norm180(A - leg)) > 90 : D < CFG.rTurn || Math.abs(norm180(A - leg)) > 90) {
          if (last) {
            this.phase = "stopped";
            say = "Pushback complete: set the parking brake";
          } else this.to++;
        }
        const psi = i.hdg + 180;
        const dA = clamp(CFG.Kpsi * norm180(course(i.pos, this.route[this.to]!) - psi), -CFG.Fpsi, CFG.Fpsi);
        const dPsi = this.lastPsi === null || i.dt <= 0 ? 0 : norm180(this.lastPsi - psi) / i.dt;
        this.lastPsi = psi;
        const mdot = clamp(CFG.Kpsidot * dPsi, -CFG.Fpsidot, CFG.Fpsidot);
        // (pushing: the sign turned round — FlightGear's _sign)
        steer = clamp(-(dA + mdot), -1, 1);
        target = this.phase === "pushing" ? -CFG.FV : 0;
      }
      // (the speed held: a PI on the rolling speed [km/h]; the brakes on: the tug only waits)
      const V = i.speed * 3.6;
      const dV = target - V;
      if (!i.braked && i.dt > 0 && i.dt < 0.1) this.int = clamp(this.int + CFG.Ki * dV * i.dt, -CFG.Fi, CFG.Fi);
      accel = i.braked ? 0 : clamp((clamp(CFG.Kp * dV, -CFG.Fp, CFG.Fp) + this.int) * ACCEL_PER, -ACCEL_MAX, ACCEL_MAX);
      if (this.phase !== "pushing" && Math.abs(i.speed) < 0.05) accel = 0;
      if (steer !== null) this.bar += (steer * MAX_STEER_DEG - this.bar) * Math.min(i.dt * 3, 1);
    }
    return { accel, steer, bar: this.bar, attach: this.attach, say };
  }
}
