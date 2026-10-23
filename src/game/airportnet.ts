// An airport's ground network (docs/PLAN-A320.md, A14): OpenStreetMap's (ODbL — the Overpass API's elements, or the
// vector tiles' lines in their stead: game/airportfetch.ts) — its taxiways and taxilanes as a graph (OSM's ways share
// their junctions' nodes), the runways (crossed only when nothing else goes), the holding points, the stands (each
// aeroway=parking_position, a lead-in line or a point, or a gate's: where the nose wheel stops, the nose's heading in,
// its ref); a router (A*: a stand to the runway in use's holding point, the runway's exit to a free stand); the
// pushback's path (back along the stand's axis, then round onto the taxiway). Positions WGS84 (lat, lon); lengths in
// local metres east and north of the airport (a flat approximation over a few kilometres: distances only).
// Pure.

/** An element of OSM's (as the Overpass API gives it: `out body; >; out skel qt;`). */
export interface OsmEl {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

export type EdgeKind = "taxiway" | "taxilane" | "runway" | "stand";

export interface NetNode {
  id: number;
  lat: number;
  lon: number;
  /** east and north of the airport's origin [m] */
  x: number;
  y: number;
  /** a holding point (aeroway=holding_position), on a runway's way */
  hold?: boolean;
  runway?: boolean;
}

export interface NetEdge {
  a: number;
  b: number;
  len: number;
  /** the taxiway's ref ("A", "B12") or name, none */
  name: string | null;
  kind: EdgeKind;
}

export interface Stand {
  /** its ref ("J06", "45") or name, none */
  ref: string | null;
  /** where the nose wheel stops (WGS84) and the nose's heading in [° from north] */
  lat: number;
  lon: number;
  hdg: number;
  /** the graph's node it is reached from (its lead-in's junction) */
  node: number;
  /** a gate's (a passenger bridge's) or an apron's */
  gate: boolean;
}

export interface NetRunway {
  ref: string;
  /** its ends (the way's first and last nodes) */
  a: { lat: number; lon: number; x: number; y: number };
  b: { lat: number; lon: number; x: number; y: number };
  width: number;
}

export interface AirportNet {
  origin: { lat: number; lon: number };
  nodes: Map<number, NetNode>;
  edges: NetEdge[];
  adj: Map<number, { to: number; e: NetEdge }[]>;
  stands: Stand[];
  runways: NetRunway[];
  /** the data's source (its credit): "osm" (Overpass) or "tiles" (OpenMapTiles' lines) */
  source: "osm" | "tiles";
}

const D = Math.PI / 180;
/** metres in a degree of latitude, of longitude at the equator (WGS84's mean — distances only) */
const M_LAT = 111_132.95;
const M_LON = 111_319.49;

/** A place's local metres east and north of an origin. */
export function local(o: { lat: number; lon: number }, lat: number, lon: number): [number, number] {
  return [(lon - o.lon) * M_LON * Math.cos(o.lat * D), (lat - o.lat) * M_LAT];
}
/** …and back. */
export function geoOf(o: { lat: number; lon: number }, x: number, y: number): { lat: number; lon: number } {
  return { lat: o.lat + y / M_LAT, lon: o.lon + x / (M_LON * Math.cos(o.lat * D)) };
}
/** a heading [° from north] from (dx east, dy north) */
export const headingOf = (dx: number, dy: number) => (((Math.atan2(dx, dy) / D) % 360) + 360) % 360;

const TAXI = new Set(["taxiway", "taxilane"]);

/** The network from OSM's elements (an origin given, else their middle). */
export function buildNet(els: OsmEl[], origin?: { lat: number; lon: number }, source: "osm" | "tiles" = "osm"): AirportNet {
  const raw = new Map<number, OsmEl>();
  for (const e of els) if (e.type === "node" && e.lat !== undefined && e.lon !== undefined) raw.set(e.id, e);
  if (!origin) {
    let la = 0,
      lo = 0,
      n = 0;
    for (const e of raw.values()) (la += e.lat!), (lo += e.lon!), n++;
    origin = n ? { lat: la / n, lon: lo / n } : { lat: 0, lon: 0 };
  }
  const O = origin;
  const nodes = new Map<number, NetNode>();
  const nodeOf = (id: number): NetNode | null => {
    const had = nodes.get(id);
    if (had) return had;
    const e = raw.get(id);
    if (!e) return null;
    const [x, y] = local(O, e.lat!, e.lon!);
    const n: NetNode = { id, lat: e.lat!, lon: e.lon!, x, y };
    if (e.tags?.aeroway === "holding_position") n.hold = true;
    nodes.set(id, n);
    return n;
  };
  const edges: NetEdge[] = [];
  const adj = new Map<number, { to: number; e: NetEdge }[]>();
  const link = (a: NetNode, b: NetNode, name: string | null, kind: EdgeKind) => {
    if (a.id === b.id) return;
    const e: NetEdge = { a: a.id, b: b.id, len: Math.hypot(b.x - a.x, b.y - a.y), name, kind };
    edges.push(e);
    (adj.get(a.id) ?? adj.set(a.id, []).get(a.id)!).push({ to: b.id, e });
    (adj.get(b.id) ?? adj.set(b.id, []).get(b.id)!).push({ to: a.id, e });
  };
  const runways: NetRunway[] = [];
  const leadIns: OsmEl[] = [];
  // ---- the ways: the taxiways and taxilanes, the runways; the stands' lead-in lines kept for after
  for (const w of els) {
    if (w.type !== "way" || !w.nodes?.length) continue;
    const a = w.tags?.aeroway ?? "";
    if (a === "parking_position") {
      leadIns.push(w);
      continue;
    }
    if (!TAXI.has(a) && a !== "runway") continue;
    const ns = w.nodes.map(nodeOf).filter((n): n is NetNode => !!n);
    if (ns.length < 2) continue;
    const name = w.tags?.ref ?? w.tags?.name ?? null;
    if (a === "runway") {
      for (const n of ns) n.runway = true;
      const f = ns[0]!,
        l = ns.at(-1)!;
      runways.push({
        ref: w.tags?.ref ?? "",
        a: { lat: f.lat, lon: f.lon, x: f.x, y: f.y },
        b: { lat: l.lat, lon: l.lon, x: l.x, y: l.y },
        width: Number(w.tags?.width) || 45,
      });
    }
    for (let i = 1; i < ns.length; i++) link(ns[i - 1]!, ns[i]!, name, a === "runway" ? "runway" : (a as EdgeKind));
  }
  // (the holding points not on a way: a node of their own, joined to the nearest taxiway node within 40 m)
  const graph = () => [...nodes.values()].filter((n) => adj.has(n.id) && !n.runway);
  for (const e of raw.values())
    if (e.tags?.aeroway === "holding_position" && !nodes.has(e.id)) {
      const n = nodeOf(e.id)!;
      const near = nearestNode(graph(), n.x, n.y, 40);
      if (near) link(n, near, null, "taxiway");
      else nodes.delete(e.id);
    }
  const net: AirportNet = { origin: O, nodes, edges, adj, stands: [], runways, source };
  // ---- the stands: the lead-in lines (the end on the network the way in, the other the stop), the points (the nose
  // away from the nearest taxiway: in, towards the terminal); a gate's point where no stand is within 15 m
  const taxiNodes = graph();
  for (const w of leadIns) {
    const ns = w.nodes!.map((id) => raw.get(id)).filter((e): e is OsmEl => !!e);
    if (ns.length < 2) continue;
    const pts = ns.map((e) => local(O, e.lat!, e.lon!));
    const on = (k: number) => adj.has(ns[k]!.id);
    const dist = (k: number) => {
      const q = nearestNode(taxiNodes, pts[k]![0], pts[k]![1], Infinity);
      return q ? Math.hypot(q.x - pts[k]![0], q.y - pts[k]![1]) : Infinity;
    };
    // (which end is the way in: the one on the network, else the nearer to it)
    const firstIn = on(0) && !on(ns.length - 1) ? true : on(ns.length - 1) && !on(0) ? false : dist(0) <= dist(ns.length - 1);
    const order = firstIn ? pts : [...pts].reverse();
    const ids = firstIn ? ns : [...ns].reverse();
    const stop = order.at(-1)!,
      prev = order.at(-2)!;
    const join = adj.has(ids[0]!.id) ? nodes.get(ids[0]!.id)! : nearestNode(taxiNodes, order[0]![0], order[0]![1], 120);
    if (!join) continue;
    // (the lead-in itself an edge: the last metres to the stand walked on it)
    const g = geoOf(O, stop[0], stop[1]);
    net.stands.push({
      ref: w.tags?.ref ?? w.tags?.name ?? null,
      lat: g.lat,
      lon: g.lon,
      hdg: headingOf(stop[0] - prev[0], stop[1] - prev[1]),
      node: join.id,
      gate: false,
    });
  }
  const points = [...raw.values()].filter((e) => e.tags?.aeroway === "parking_position" || e.tags?.aeroway === "gate");
  // (the parking positions first: a gate's point only where none of them is)
  points.sort((a, b) => Number(b.tags!.aeroway === "parking_position") - Number(a.tags!.aeroway === "parking_position"));
  for (const e of points) {
    const [x, y] = local(O, e.lat!, e.lon!);
    if (net.stands.some((s) => Math.hypot(...local(O, s.lat, s.lon).map((v, k) => v - [x, y][k]!)) < 15)) continue;
    const near = nearestOnEdges(net, x, y, 150);
    if (!near) continue;
    const join = nodes.get(near.d2a < near.d2b ? near.e.a : near.e.b)!;
    net.stands.push({
      ref: e.tags?.ref ?? e.tags?.name ?? null,
      lat: e.lat!,
      lon: e.lon!,
      // (the nose away from the taxiway it is reached from)
      hdg: headingOf(x - near.x, y - near.y),
      node: join.id,
      gate: e.tags?.aeroway === "gate",
    });
  }
  return net;
}

/** The nearest of nodes within r [m] of (x, y). */
export function nearestNode(ns: NetNode[], x: number, y: number, r: number): NetNode | null {
  let best: NetNode | null = null,
    bd = r;
  for (const n of ns) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bd) (bd = d), (best = n);
  }
  return best;
}

/** The nearest point on the taxiways' edges within r [m]: the edge, the point, the distances to its ends. */
export function nearestOnEdges(net: AirportNet, x: number, y: number, r: number, kinds: EdgeKind[] = ["taxiway", "taxilane"]) {
  let best: { e: NetEdge; x: number; y: number; d: number; d2a: number; d2b: number } | null = null;
  for (const e of net.edges) {
    if (!kinds.includes(e.kind)) continue;
    const A = net.nodes.get(e.a)!,
      B = net.nodes.get(e.b)!;
    const vx = B.x - A.x,
      vy = B.y - A.y;
    const L2 = vx * vx + vy * vy || 1;
    const u = Math.min(Math.max(((x - A.x) * vx + (y - A.y) * vy) / L2, 0), 1);
    const px = A.x + vx * u,
      py = A.y + vy * u;
    const d = Math.hypot(px - x, py - y);
    if (d < r && (!best || d < best.d)) best = { e, x: px, y: py, d, d2a: u * Math.sqrt(L2), d2b: (1 - u) * Math.sqrt(L2) };
  }
  return best;
}

/** A route on the ground: its nodes, its polyline (WGS84), its length [m], its taxiways in order ("A", "B"…). */
export interface TaxiRoute {
  nodes: number[];
  pts: { lat: number; lon: number }[];
  len: number;
  via: string[];
  /** each point's taxiway (the edge from it), the runways crossed (their refs) */
  names: (string | null)[];
  crosses: string[];
}

/** A*: the shortest way from a node to another — the runways only crossed (each metre on one counted eight). */
export function route(net: AirportNet, from: number, to: number): TaxiRoute | null {
  const N = net.nodes;
  const goal = N.get(to);
  if (!goal || !N.has(from)) return null;
  const h = (id: number) => {
    const n = N.get(id)!;
    return Math.hypot(n.x - goal.x, n.y - goal.y);
  };
  const g = new Map<number, number>([[from, 0]]);
  const came = new Map<number, { id: number; e: NetEdge }>();
  const open = new Set([from]);
  const f = new Map<number, number>([[from, h(from)]]);
  while (open.size) {
    let cur = -1,
      fb = Infinity;
    for (const id of open) {
      const v = f.get(id) ?? Infinity;
      if (v < fb) (fb = v), (cur = id);
    }
    if (cur === to) break;
    open.delete(cur);
    for (const { to: nx, e } of net.adj.get(cur) ?? []) {
      const cost = e.len * (e.kind === "runway" ? 8 : e.kind === "stand" ? 1.5 : 1);
      const ng = g.get(cur)! + cost;
      if (ng < (g.get(nx) ?? Infinity)) {
        g.set(nx, ng);
        came.set(nx, { id: cur, e });
        f.set(nx, ng + h(nx));
        open.add(nx);
      }
    }
  }
  if (from !== to && !came.has(to)) return null;
  const ids = [to];
  const es: NetEdge[] = [];
  for (let c = to; c !== from; ) {
    const p = came.get(c)!;
    es.unshift(p.e);
    ids.unshift(p.id);
    c = p.id;
  }
  const via: string[] = [];
  const crosses: string[] = [];
  for (const e of es) {
    if (e.kind === "runway") {
      const r = nearestRunwayRef(net, e);
      if (r && crosses.at(-1) !== r) crosses.push(r);
      continue;
    }
    if (e.name && via.at(-1) !== e.name) via.push(e.name);
  }
  return {
    nodes: ids,
    pts: ids.map((id) => ({ lat: N.get(id)!.lat, lon: N.get(id)!.lon })),
    len: es.reduce((s, e) => s + e.len, 0),
    via,
    names: [...es.map((e) => e.name), null],
    crosses,
  };
}

function nearestRunwayRef(net: AirportNet, e: NetEdge): string | null {
  const A = net.nodes.get(e.a)!;
  let best: string | null = null,
    bd = Infinity;
  for (const r of net.runways) {
    const d = Math.min(Math.hypot(r.a.x - A.x, r.a.y - A.y), Math.hypot(r.b.x - A.x, r.b.y - A.y)) + segDist(r, A.x, A.y) * 4;
    if (d < bd) (bd = d), (best = r.ref);
  }
  return best;
}
function segDist(r: NetRunway, x: number, y: number) {
  const vx = r.b.x - r.a.x,
    vy = r.b.y - r.a.y;
  const L2 = vx * vx + vy * vy || 1;
  const u = Math.min(Math.max(((x - r.a.x) * vx + (y - r.a.y) * vy) / L2, 0), 1);
  return Math.hypot(r.a.x + vx * u - x, r.a.y + vy * u - y);
}

/** A runway's end the take-off starts from: its threshold (WGS84) and its heading [°]. */
export interface RunwayEnd {
  lat: number;
  lon: number;
  hdg: number;
}

/** The holding point of a runway's end: a holding position near its threshold (within 600 m, off the runway), else
 *  the taxiway node nearest the threshold 45–200 m off its centreline. */
export function holdingPoint(net: AirportNet, end: RunwayEnd): NetNode | null {
  const [tx, ty] = local(net.origin, end.lat, end.lon);
  const ux = Math.sin(end.hdg * D),
    uy = Math.cos(end.hdg * D);
  const off = (n: NetNode) => Math.abs((n.x - tx) * uy - (n.y - ty) * ux);
  const along = (n: NetNode) => (n.x - tx) * ux + (n.y - ty) * uy;
  const cand = [...net.nodes.values()].filter((n) => net.adj.has(n.id) && !n.runway);
  const score = (n: NetNode) => Math.hypot(n.x - tx, n.y - ty) + Math.max(-along(n) - 60, 0) * 3;
  const holds = cand.filter((n) => n.hold && Math.hypot(n.x - tx, n.y - ty) < 600 && off(n) > 25 && along(n) > -150);
  if (holds.length) return holds.reduce((a, b) => (score(a) <= score(b) ? a : b));
  const near = cand.filter((n) => off(n) > 45 && off(n) < 200 && Math.hypot(n.x - tx, n.y - ty) < 600 && along(n) > -150);
  return near.length ? near.reduce((a, b) => (score(a) <= score(b) ? a : b)) : null;
}

/** A stand's route out: from its junction to the runway end's holding point. */
export function departureRoute(net: AirportNet, from: number, end: RunwayEnd): TaxiRoute | null {
  const hp = holdingPoint(net, end);
  return hp ? route(net, from, hp.id) : null;
}

/** A free stand after landing: of the nearest dozen (none within 40 m of an occupied place), the shortest route from
 *  where the aircraft is; the route ends on the stand's stop. */
export function arrivalRoute(
  net: AirportNet,
  at: { lat: number; lon: number },
  occupied: { lat: number; lon: number }[] = [],
): { stand: Stand; route: TaxiRoute } | null {
  const [x, y] = local(net.origin, at.lat, at.lon);
  const start = nearestOnEdges(net, x, y, 400, ["taxiway", "taxilane", "runway"]);
  if (!start) return null;
  const from = start.d2a < start.d2b ? start.e.a : start.e.b;
  const free = net.stands.filter(
    (s) =>
      !occupied.some((o) => Math.hypot(...local(net.origin, o.lat, o.lon).map((v, k) => v - local(net.origin, s.lat, s.lon)[k]!)) < 40),
  );
  const near = free
    .map((s) => ({ s, d: Math.hypot(...local(net.origin, s.lat, s.lon).map((v, k) => v - [x, y][k]!)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 12);
  let best: { stand: Stand; route: TaxiRoute } | null = null;
  for (const { s } of near) {
    const r = route(net, from, s.node);
    if (r && (!best || r.len < best.route.len)) best = { stand: s, route: withStop(r, s) };
  }
  return best;
}

/** a route to a stand's junction, carried on to its stop */
export function withStop(r: TaxiRoute, s: Stand): TaxiRoute {
  const last = r.pts.at(-1)!;
  const [dx, dy] = local(last, s.lat, s.lon);
  return {
    ...r,
    pts: [...r.pts, { lat: s.lat, lon: s.lon }],
    names: [...r.names.slice(0, -1), null, null],
    len: r.len + Math.hypot(dx, dy),
  };
}

/** The nearest stand to a place (WGS84), within r [m]; a ref matched first when given. */
export function standOf(net: AirportNet, ref?: string | null, near?: { lat: number; lon: number }): Stand | null {
  if (ref) {
    const q = ref.trim().toUpperCase();
    const s = net.stands.find((s) => (s.ref ?? "").toUpperCase() === q);
    if (s) return s;
  }
  if (!net.stands.length) return null;
  const at = near ?? net.origin;
  const [x, y] = local(net.origin, at.lat, at.lon);
  return net.stands.reduce((a, b) => {
    const da = Math.hypot(...local(net.origin, a.lat, a.lon).map((v, k) => v - [x, y][k]!));
    const db = Math.hypot(...local(net.origin, b.lat, b.lon).map((v, k) => v - [x, y][k]!));
    return da <= db ? a : b;
  });
}

/** Where the aircraft's reference point stands at a stand: its nose wheel on the stop, `noseZ` [m] ahead of it. */
export function standPlace(s: Stand, noseZ: number): { lat: number; lon: number; hdg: number } {
  const g = geoOf({ lat: s.lat, lon: s.lon }, -Math.sin(s.hdg * D) * noseZ, -Math.cos(s.hdg * D) * noseZ);
  return { lat: g.lat, lon: g.lon, hdg: s.hdg };
}

/** The pushback's path (PART B's tug follows it): from the stand's stop straight back along its axis to the
 *  taxiway (its junction), then round along the taxiway for `turnM` metres — towards the route out's first node when
 *  given, else along the taxiway's longer branch. The aircraft's reference point's track (WGS84) and the nose's
 *  heading at its end (the push backwards: the nose opposite the last leg's direction). */
export function pushbackPath(
  s: Stand,
  net: AirportNet,
  noseZ = 13.65,
  turnM = 45,
  toward?: TaxiRoute | null,
): { pts: { lat: number; lon: number }[]; hdgEnd: number } {
  const O = net.origin;
  const start = standPlace(s, noseZ);
  const J = net.nodes.get(s.node)!;
  const [sx, sy] = local(O, start.lat, start.lon);
  const pts: [number, number][] = [[sx, sy]];
  // (straight back: the axis's line, to the point abeam the junction — the tail then over the taxiway's line)
  const bx = -Math.sin(s.hdg * D),
    by = -Math.cos(s.hdg * D);
  const back = Math.max((J.x - sx) * bx + (J.y - sy) * by, 0);
  const cx = sx + bx * back,
    cy = sy + by * back;
  for (let k = 1; k <= 4; k++) pts.push([sx + (bx * back * k) / 4, sy + (by * back * k) / 4]);
  // (then along the taxiway from the junction: the branch towards the way out, or the longest)
  const nb = net.adj.get(J.id) ?? [];
  let to: NetNode | null = null;
  if (toward && toward.nodes.length > 1 && toward.nodes[0] === J.id) to = net.nodes.get(toward.nodes[1]!) ?? null;
  // (pushed tail first towards the side opposite the way out: the aircraft then rolls forward along it)
  const branches = nb.filter((b) => b.e.kind !== "runway" && b.e.kind !== "stand").map((b) => net.nodes.get(b.to)!);
  let dir: NetNode | null = null;
  if (to) {
    const opp = branches.filter((n) => n.id !== to!.id);
    dir = opp.length ? opp.reduce((a, b) => (dist(a, J) >= dist(b, J) ? a : b)) : null;
    if (!dir) {
      // (no branch the other way: the tail turned the way out's opposite all the same — 180° about the junction)
      const vx = J.x - to.x,
        vy = J.y - to.y;
      const l = Math.hypot(vx, vy) || 1;
      dir = { ...J, x: J.x + (vx / l) * turnM, y: J.y + (vy / l) * turnM };
    }
  } else dir = branches.length ? branches.reduce((a, b) => (dist(a, J) >= dist(b, J) ? a : b)) : null;
  let hdgEnd = s.hdg;
  if (dir) {
    const vx = dir.x - J.x,
      vy = dir.y - J.y;
    const l = Math.hypot(vx, vy) || 1;
    const ux = vx / l,
      uy = vy / l;
    // (a quarter circle from the axis onto the taxiway: from (cx, cy) moving back, to the taxiway's line)
    const n = 8;
    const ex = J.x + ux * Math.min(turnM, l),
      ey = J.y + uy * Math.min(turnM, l);
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      // (a quadratic Bézier: the turn's corner the junction)
      const x = (1 - u) * (1 - u) * cx + 2 * (1 - u) * u * J.x + u * u * ex;
      const y = (1 - u) * (1 - u) * cy + 2 * (1 - u) * u * J.y + u * u * ey;
      pts.push([x, y]);
    }
    // (pushed backwards: the nose facing back along the taxiway, the way out ahead)
    hdgEnd = headingOf(-ux, -uy);
  }
  return { pts: pts.map(([x, y]) => geoOf(O, x, y)), hdgEnd };
}
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** The taxiway lines near a place (the ND's airport map): the edges within r [m], as (lat, lon) pairs. */
export function edgesNear(net: AirportNet, at: { lat: number; lon: number }, r: number): [number, number, number, number, EdgeKind][] {
  const [x, y] = local(net.origin, at.lat, at.lon);
  const out: [number, number, number, number, EdgeKind][] = [];
  for (const e of net.edges) {
    const A = net.nodes.get(e.a)!,
      B = net.nodes.get(e.b)!;
    if (Math.hypot(A.x - x, A.y - y) > r && Math.hypot(B.x - x, B.y - y) > r) continue;
    out.push([A.lat, A.lon, B.lat, B.lon, e.kind]);
  }
  return out;
}
