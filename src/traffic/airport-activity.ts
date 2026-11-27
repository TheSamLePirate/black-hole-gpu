import { trafficWind } from "./attitude";
import type { WeatherState } from "../weather";
// Supplemental ground activity uses mapped taxiways and yields to every observed aircraft.
// A single path reservation prevents synthetic head-on conflicts; holding points are hard stops.
import { departureRoute, local, route, pushbackPath, geoOf, type AirportNet, type RunwayEnd } from "../game/airportnet";
import type { TrackedPlane, Plane } from "./feed";
import { groundPath, pathPoint, pathPose, crossesRunway, type GroundPath } from "./ground-path";
let session = 0;
interface Actor {
  retired: boolean;
  id: string;
  path: GroundPath;
  distance: number;
  speed: number;
  at: number;
  waiting: boolean;
  pushUntil: number;
  holdNode: number;
  phase: "pushback" | "taxi" | "hold" | "lineup" | "roll" | "climb";
  clearAt: number;
  flightDistance: number;
  airborne: boolean;
  nextPath: GroundPath | null;
  end: RunwayEnd;
}
export class AirportActivity {
  enabled = true;
  private session = ++session;
  private clock: number | null = null;
  private actors: Actor[] = [];
  private last = -Infinity;
  private serial = 0;
  constructor(
    readonly net: AirportNet,
    readonly code: string,
  ) {}
  clear() {
    this.actors = [];
    this.last = -Infinity;
  }
  step(t: number, observed: readonly Plane[], end: RunwayEnd | null, weather?: WeatherState | null): TrackedPlane[] {
    if (!this.enabled) return [];
    if (this.clock !== null && (t < this.clock || t - this.clock > 10)) this.clear();
    this.clock = t;
    const net = this.net;
    if (!end) return [];
    const positions = observed
      .filter((p) => p.gnd)
      .map((p) => {
        const [x, y] = local(net.origin, p.lat, p.lon);
        return { x, y, len: 60 };
      });
    // One reservation covers the whole supplemental path, avoiding head-on synthetic conflicts.
    if (
      this.actors.length === 0 &&
      t - this.last > 90 &&
      observed.filter((p) => p.gnd && p.gs > 2 && Math.hypot(...local(net.origin, p.lat, p.lon)) < 6000).length < 6
    ) {
      this.last = t;
      for (const stand of net.stands) {
        const node = net.nodes.get(stand.node);
        if (!node || positions.some((p) => Math.hypot(p.x - node.x, p.y - node.y) < 100)) continue;
        const r = departureRoute(net, stand.node, end);
        if (!r || r.len < 100 || r.len > 3000 || r.crosses.length || r.nodes.some((id) => net.nodes.get(id)?.runway)) continue;
        const points = r.pts.map((p) => {
          const [x, y] = local(net.origin, p.lat, p.lon);
          return { x, y };
        });
        const j = points[0]!,
          direction = points[1]!;
        const reverse = geoOf(net.origin, j.x - (direction.x - j.x), j.y - (direction.y - j.y));
        const push = pushbackPath(stand, net, 13.65, 30, { ...r, pts: [r.pts[0]!, reverse] });
        const pushPoints = push.pts.map((p) => {
          const [x, y] = local(net.origin, p.lat, p.lon);
          return { x, y };
        });
        const path = groundPath(pushPoints, 6);
        const pushUntil = path.length;
        const nextPath = groundPath([path.points.at(-1)!, ...points], 8);
        if (crossesRunway(net, path) || crossesRunway(net, nextPath)) continue;
        // Appear stationary at the mapped start, then accelerate. The identity is explicitly synthetic.
        this.actors.push({
          id: `sim-${this.code}-${this.session}-${(++this.serial).toString(16).padStart(6, "0")}`,
          retired: false,
          path,
          distance: 0,
          speed: 0,
          at: t,
          waiting: false,
          pushUntil,
          holdNode: r.nodes.at(-1)!,
          phase: "pushback",
          clearAt: NaN,
          flightDistance: 0,
          airborne: false,
          nextPath,
          end: { ...end },
        });
        break;
      }
    }
    const out: TrackedPlane[] = [];
    for (const actor of this.actors) {
      const dt = Math.max(0, Math.min(0.25, t - actor.at));
      actor.at = t;
      const [ex, ey] = local(net.origin, actor.end.lat, actor.end.lon);
      const ux = Math.sin((actor.end.hdg * Math.PI) / 180),
        uy = Math.cos((actor.end.hdg * Math.PI) / 180);
      const runway = net.runways.find((r) => Math.min(Math.hypot(r.a.x - ex, r.a.y - ey), Math.hypot(r.b.x - ex, r.b.y - ey)) < 250);
      const runwayLength = runway ? Math.hypot(runway.b.x - runway.a.x, runway.b.y - runway.a.y) : 0;
      const blocked = observed.some((p) => {
        const [x, y] = local(net.origin, p.lat, p.lon);
        const ve = p.gs * Math.sin((p.trk * Math.PI) / 180),
          vn = p.gs * Math.cos((p.trk * Math.PI) / 180);
        for (let sec = 0; sec <= 70; sec += 5) {
          const dx = x + ve * sec - ex,
            dy = y + vn * sec - ey;
          const along = dx * ux + dy * uy,
            cross = dx * uy - dy * ux;
          if (Math.abs(cross) < (p.gnd ? 100 : 350) && along > (p.gnd ? -150 : -6000) && along < runwayLength + 300) return true;
        }
        return false;
      });
      if (actor.phase === "hold" && runway && runwayLength > 2200) {
        if (blocked) actor.clearAt = NaN;
        else if (!Number.isFinite(actor.clearAt)) actor.clearAt = t;
        if (t - actor.clearAt > 20) {
          const nodes = [...net.nodes.values()]
            .filter((n) => n.runway)
            .sort((a, b) => Math.hypot(a.x - ex, a.y - ey) - Math.hypot(b.x - ex, b.y - ey));
          const start = nodes[0];
          const link = start ? route(net, actor.holdNode, start.id) : null;
          if (link && link.len < 800 && link.crosses.every((ref) => ref === runway.ref) && Math.hypot(start!.x - ex, start!.y - ey) < 100) {
            const points = link.pts.map((p) => {
              const [x, y] = local(net.origin, p.lat, p.lon);
              return { x, y };
            });
            const lineup = groundPath([pathPoint(actor.path, actor.distance), ...points], 10);
            if (!crossesRunway(net, lineup, runway)) {
              actor.path = lineup;
              actor.distance = 0;
              actor.phase = "lineup";
              actor.pushUntil = 0;
            } else actor.clearAt = t;
          }
        }
      }
      if (actor.phase === "lineup" && actor.path.length - actor.distance < 3 && actor.speed < 1 && !blocked && runwayLength > 2200) {
        actor.path = groundPath([
          pathPoint(actor.path, actor.distance),
          { x: ex, y: ey },
          { x: ex + ux * (runwayLength + 10000), y: ey + uy * (runwayLength + 10000) },
        ]);
        actor.distance = 0;
        actor.speed = 0;
        actor.phase = "roll";
      }
      if (actor.phase === "pushback" && actor.path.length - actor.distance < 3 && actor.speed < 0.1) {
        if (!Number.isFinite(actor.clearAt)) actor.clearAt = t;
        if (t - actor.clearAt > 5 && actor.nextPath) {
          actor.path = groundPath([pathPoint(actor.path, actor.distance), ...actor.nextPath.points], 6);
          actor.nextPath = null;
          actor.distance = 0;
          actor.phase = "taxi";
          actor.clearAt = NaN;
        }
      }
      const p = pathPoint(actor.path, actor.distance);
      if (!actor.airborne && positions.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 60)) {
        actor.retired = true;
        this.last = t;
        continue;
      }
      const look = pathPoint(actor.path, actor.distance + Math.max(35, actor.speed * 8));
      const occupied = positions.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 75 || Math.hypot(q.x - look.x, q.y - look.y) < 80);
      const left = actor.path.length - actor.distance;
      const curve = pathPose(net, actor.path, Math.min(actor.path.length, actor.distance + 20), 6);
      const turnSpeed = Math.sqrt(0.7 / Math.max(Math.abs(curve.omega) / 6, 0.001));
      const target =
        actor.phase === "hold"
          ? 0
          : actor.phase === "roll" || actor.phase === "climb"
            ? blocked && !actor.airborne
              ? 0
              : 90
            : occupied || (blocked && actor.phase === "lineup")
              ? 0
              : Math.min(actor.phase === "pushback" ? 1.5 : 6, turnSpeed, Math.sqrt(2 * 0.8 * Math.max(0, left - 2)));
      actor.speed += Math.max(-1.2 * dt, Math.min((actor.phase === "roll" ? 2 : 0.5) * dt, target - actor.speed));
      // Never cross a newly observed aircraft even when a report arrives inside braking distance.
      const next = pathPoint(actor.path, actor.distance + actor.speed * dt);
      if (!positions.some((q) => Math.hypot(q.x - next.x, q.y - next.y) < 65))
        actor.distance = Math.min(actor.path.length - 1, actor.distance + actor.speed * dt);
      else actor.speed = 0;
      actor.waiting = left < 3;
      if (actor.phase === "taxi" && left < 3 && actor.speed < 0.5) actor.phase = "hold";
      const wind = trafficWind(weather, 0) ?? [0, 0];
      if (actor.phase === "roll" && actor.speed > 40 && Math.hypot(actor.speed * ux - wind[0]!, actor.speed * uy - wind[1]!) > 74) {
        actor.phase = "climb";
        actor.airborne = true;
        actor.flightDistance = actor.distance;
      }
      const pose = pathPose(net, actor.path, actor.distance, actor.speed);
      const climbDistance = Math.max(0, actor.distance - actor.flightDistance);
      const slope = Math.tan((7 * Math.PI) / 180);
      const height = actor.airborne ? slope * (climbDistance - 150 * (1 - Math.exp(-climbDistance / 150))) : 0;
      if (actor.airborne) {
        pose.airborne = true;
        pose.over = height;
        pose.vu = actor.speed * slope * (1 - Math.exp(-climbDistance / 150));
      }
      const p0: Plane = {
        id: actor.id,
        cs: `SIM ${this.serial}`,
        reg: "",
        type: "A320",
        cat: "A3",
        lat: pose.lat,
        lon: pose.lon,
        alt: 0,
        gs: actor.speed,
        trk: pose.heading,
        hdg: actor.phase === "pushback" ? (pose.heading + 180) % 360 : pose.heading,
        vs: pose.vu ?? 0,
        roll: 0,
        rate: (pose.omega * 180) / Math.PI,
        gnd: !actor.airborne,
        t,
        src: "synthetic",
      };
      out.push({ p: p0, prev: null, hist: [p0], heard: t, origin: "synthetic", groundPose: pose });
    }
    this.actors = this.actors.filter((a) => !a.retired && (a.phase !== "climb" || a.distance - a.flightDistance < 7000));
    return out;
  }
}
