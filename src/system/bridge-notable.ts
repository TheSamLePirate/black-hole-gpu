// PLAN-PONT-ROUTES-AAA B3 (24 Nov 2026) — the great bridges' structures: suspension (towers, main cables on their parabola, vertical
// suspenders, the stiffening girder or truss, the anchorages) and cable-stayed (pylons — portal, inverted Y, single mast —, their stays
// in a fan, a semi-fan or a harp, one plane or two), from a small catalogue of famous bridges with their real figures
// (bridge-catalogue.ts — the data name none of this: OpenMapTiles has no bridge:structure, the BD TOPO no structure either).
//
// Pure: everything in the scene's frame through `local(lat, lon, hEllipsoid)` — the catalogue's heights are over the mean sea level
// (MSL), the geoid's N added here (`geoid(lat, lon)`: N [m]) — WGS84 everywhere. What it returns the scene worker packs: the deck's
// axis with its heights (its drivable surface: scenery-worker.ts deckBridge, the same profile, contact and registry as any deck), the
// painted solids (towers, girders, anchorages — meshes tagged BRIDGE_PAINT | their paint, collidable boxes), the cables (pairs of
// vertices, STRUCT_CABLE: widened to a pixel at least by the raster, their coverage kept — no shimmer at 30 km).

import type { Vec3 } from "../physics";

/** the paints a notable bridge's parts take (trace.wgsl liteMaterial's palette at a painted part's leaf 10 + index / 16) */
export enum BridgePaint {
  /** the Golden Gate's « International Orange » (sRGB #C0362C) */
  InternationalOrange = 0,
  Concrete = 1,
  White = 2,
  DarkSteel = 3,
  Granite = 4,
  GreyGreen = 5,
  Silver = 6,
  Ochre = 7,
}

export interface Wgs84 {
  lat: number;
  lon: number;
}

/** portal: two legs and struts; gothic: two legs, struts (a masonry tower drawn as a portal); inverted-y: two legs meeting above the
 *  deck into one mast; single: one mast on the axis; pier-mast: two shafts from the ground to the deck, a mast over it (Millau) */
export type TowerShape = "portal" | "inverted-y" | "single" | "gothic" | "pier-mast";

/** a famous bridge's figures (all heights over the mean sea level [m]; lengths [m]) */
export interface NotableBridge {
  id: string;
  name: string;
  family: "suspension" | "cable-stayed";
  /** the structure's ends along its axis — the anchorages (suspension) or the main deck's ends (cable-stayed) */
  ends: [Wgs84, Wgs84];
  /** its towers (pylons) in order from ends[0] — the axis runs through them (a curved viaduct's chords) */
  towers: Wgs84[];
  /** the roadway's height at its two ends and at its highest (the main span's middle) over the mean sea level — NaN: the ground's
   *  there (an end), a straight line between the ends (the crest) */
  deckEnds: [number, number];
  deckCrest: number;
  /** the roadway's width and the girder's depth under it (the stiffening truss or box) */
  deckWidth: number;
  girderDepth: number;
  truss: boolean;
  /** the towers' top over the mean sea level — or, `towerAboveDeck`, over the roadway there (a viaduct's masts) */
  towerTop: number;
  towerAboveDeck?: number;
  towerShape: TowerShape;
  /** a pier-mast's pier (its shafts under the deck) paint; the mast's the towers' */
  pierPaint?: BridgePaint;
  /** a tower leg's section at its foot and at its top [m] (along × across the axis) */
  legFoot: [number, number];
  legTop: [number, number];
  /** the legs' centres off the axis [m] (portal, inverted Y); a single mast 0 */
  legOffset: number;
  /** the portal's struts' heights over the deck (portal, gothic) */
  struts?: number[];
  /** suspension: the main cables' diameter, their sag in the main span, the suspenders' spacing and diameter */
  cableDiameter?: number;
  cableSag?: number;
  suspenderSpacing?: number;
  suspenderDiameter?: number;
  /** cable-stayed: the stays' layout, how many each side of a pylon in each plane, their diameter, their planes (1 central, 2 edges) */
  stays?: "fan" | "semi-fan" | "semi-harp" | "harp";
  staysPerSide?: number;
  stayDiameter?: number;
  stayPlanes?: 1 | 2;
  /** the extent of the stays along the deck from a pylon, each way [m] (to the next pylon's half way, or to the end) */
  stayReach?: number;
  towerPaint: BridgePaint;
  cablePaint: BridgePaint;
  girderPaint: BridgePaint;
  /** where each figure comes from */
  sources: string[];
}

export interface NotableParts {
  /** (unused: notableDeckAxis gives the deck's points) */
  deck: Vec3[];
  /** solid painted parts: their mesh, their footprint (a closed ring), their bottom and top [the frame's z], their paint */
  solids: { positions: number[]; triangles: number[]; ring: Vec3[]; bottom: number; top: number; paint: BridgePaint }[];
  /** cables: pairs of vertices (a ribbon the raster opens to a pixel), their diameter [m], vertical (opened across the view), paint */
  cables: { positions: number[]; triangles: number[]; diameter: number; vertical: boolean; paint: BridgePaint }[];
}

/** a box between two points on its axis (a → b, any direction), its section w × d at a and w2 × d2 at b — CCW outward faces */
function prism(
  a: Vec3,
  b: Vec3,
  wa: number,
  da: number,
  wb: number,
  db: number,
  up: Vec3 = [0, 0, 1],
): { positions: number[]; triangles: number[] } {
  const ax = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(ax[0]!, ax[1]!, ax[2]!) || 1;
  const t = [ax[0]! / L, ax[1]! / L, ax[2]! / L];
  // (two directions across the axis: u ⟂ t from `up`, v = t × u)
  let u = [up[1] * t[2]! - up[2] * t[1]!, up[2] * t[0]! - up[0] * t[2]!, up[0] * t[1]! - up[1] * t[0]!];
  let ul = Math.hypot(u[0]!, u[1]!, u[2]!);
  if (ul < 1e-6) {
    u = [1, 0, 0];
    ul = 1;
  }
  u = u.map((x) => x / ul);
  const v = [t[1]! * u[2]! - t[2]! * u[1]!, t[2]! * u[0]! - t[0]! * u[2]!, t[0]! * u[1]! - t[1]! * u[0]!];
  const corner = (p: Vec3, w: number, d: number, i: number) => {
    const su = i === 0 || i === 3 ? -1 : 1,
      sv = i < 2 ? -1 : 1;
    return [
      p[0] + u[0]! * su * w * 0.5 + v[0]! * sv * d * 0.5,
      p[1] + u[1]! * su * w * 0.5 + v[1]! * sv * d * 0.5,
      p[2] + u[2]! * su * w * 0.5 + v[2]! * sv * d * 0.5,
    ];
  };
  const positions: number[] = [];
  for (let i = 0; i < 4; i++) positions.push(...corner(a, wa, da, i));
  for (let i = 0; i < 4; i++) positions.push(...corner(b, wb, db, i));
  // (the sides i → i+1 at a and b; the caps)
  const triangles: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    triangles.push(i, j, 4 + j, i, 4 + j, 4 + i);
  }
  triangles.push(0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7);
  // (wind them outward: a face whose normal points to the prism's centre is flipped)
  const P = (k: number) => [positions[k * 3]!, positions[k * 3 + 1]!, positions[k * 3 + 2]!];
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  for (let k = 0; k < triangles.length; k += 3) {
    const [p, q, r] = [P(triangles[k]!), P(triangles[k + 1]!), P(triangles[k + 2]!)];
    const e1 = [q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!],
      e2 = [r[0]! - p[0]!, r[1]! - p[1]!, r[2]! - p[2]!];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const m = [(p[0]! + q[0]! + r[0]!) / 3 - c[0]!, (p[1]! + q[1]! + r[1]!) / 3 - c[1]!, (p[2]! + q[2]! + r[2]!) / 3 - c[2]!];
    if (n[0]! * m[0]! + n[1]! * m[1]! + n[2]! * m[2]! < 0) {
      const tmp = triangles[k + 1]!;
      triangles[k + 1] = triangles[k + 2]!;
      triangles[k + 2] = tmp;
    }
  }
  return { positions, triangles };
}

/** a polyline as a cable's ribbon: each point twice (the raster opens the pair), two triangles between consecutive pairs */
function ribbon(points: Vec3[]): { positions: number[]; triangles: number[] } {
  const positions: number[] = [],
    triangles: number[] = [];
  for (const p of points) positions.push(...p, ...p);
  for (let i = 0; i + 1 < points.length; i++) {
    const k = 2 * i;
    triangles.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  return { positions, triangles };
}

const footRing = (c: Vec3, along: [number, number], w: number, d: number): Vec3[] => {
  const [ux, uy] = along;
  const p = (sa: number, sc: number): Vec3 => [
    c[0] + ux * sa * w * 0.5 - uy * sc * d * 0.5,
    c[1] + uy * sa * w * 0.5 + ux * sc * d * 0.5,
    0,
  ];
  return [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1), p(-1, -1)];
};

/** the scene's frame functions a notable bridge is built with */
export interface NotableFrame {
  /** a place [°] and its height over the ellipsoid [m] → the scene's frame */
  local: (lat: number, lon: number, h: number) => Vec3;
  /** the geoid's N there [m] (the sea's level over the ellipsoid) */
  geoid: (lat: number, lon: number) => number;
  /** the ground's height over the ellipsoid there [m] */
  ground: (lat: number, lon: number) => number;
}

/** a notable bridge's axis: its nodes (its ends and its towers, in order) at the sea's level in the scene's frame, their abscissas */
function axisOf(nb: NotableBridge, f: NotableFrame) {
  const nodes = [nb.ends[0], ...nb.towers, nb.ends[1]];
  const pts = nodes.map((g) => f.local(g.lat, g.lon, f.geoid(g.lat, g.lon)));
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const L = s[s.length - 1]!;
  const seg = (x: number) => {
    let k = 1;
    while (k < s.length - 1 && s[k]! < x) k++;
    return k;
  };
  /** the place at abscissa x (the nodes' latitudes and longitudes interpolated: chords of a few hundred metres) */
  const geoAt = (x: number): Wgs84 => {
    const k = seg(x);
    const t = s[k]! > s[k - 1]! ? (Math.max(0, Math.min(L, x)) - s[k - 1]!) / (s[k]! - s[k - 1]!) : 0;
    return {
      lat: nodes[k - 1]!.lat + (nodes[k]!.lat - nodes[k - 1]!.lat) * t,
      lon: nodes[k - 1]!.lon + (nodes[k]!.lon - nodes[k - 1]!.lon) * t,
    };
  };
  /** the axis's direction at x (its chord's) */
  const dirAt = (x: number): [number, number] => {
    const k = seg(x);
    const a = pts[k - 1]!,
      b = pts[k]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  return { nodes, s, L, geoAt, dirAt, towerS: s.slice(1, s.length - 1) };
}

/** the roadway's height over the mean sea level the catalogue gives at x (each end's — or its ground's — to the crest at the main
 *  span's middle, a parabola each side; no crest: a straight line) */
function catalogueRoadway(nb: NotableBridge, f: NotableFrame, ax: ReturnType<typeof axisOf>) {
  const endH = nb.deckEnds.map((h, k) => {
    if (Number.isFinite(h)) return h;
    const g = nb.ends[k]!;
    return f.ground(g.lat, g.lon) - f.geoid(g.lat, g.lon);
  }) as [number, number];
  const ts = ax.towerS;
  const mid = ts.length >= 2 ? (ts[0]! + ts[ts.length - 1]!) / 2 : ts.length === 1 ? ts[0]! : ax.L / 2;
  return (x: number) => {
    const c = Math.max(0, Math.min(ax.L, x));
    if (!Number.isFinite(nb.deckCrest)) return endH[0] + ((endH[1] - endH[0]) * c) / (ax.L || 1);
    if (c <= mid) {
      const t = mid > 0 ? c / mid : 1;
      return endH[0] + (nb.deckCrest - endH[0]) * (1 - (1 - t) * (1 - t));
    }
    const t = ax.L - mid > 0 ? (ax.L - c) / (ax.L - mid) : 1;
    return endH[1] + (nb.deckCrest - endH[1]) * (1 - (1 - t) * (1 - t));
  };
}

/**
 * A notable bridge's deck axis in the scene's frame: points every 20 m at most from its first end to its last (its towers among them),
 * z the catalogue's roadway there — the drivable deck's points (scenery-worker.ts deckBridge builds its profile through them, within
 * its grade).
 */
export function notableDeckAxis(nb: NotableBridge, f: NotableFrame): Vec3[] {
  const ax = axisOf(nb, f);
  const road = catalogueRoadway(nb, f, ax);
  const out: Vec3[] = [];
  for (let k = 1; k < ax.s.length; k++) {
    const a = ax.s[k - 1]!,
      b = ax.s[k]!;
    const n = Math.max(1, Math.ceil((b - a) / 20));
    for (let i = k === 1 ? 0 : 1; i <= n; i++) {
      const x = a + ((b - a) * i) / n;
      const g = ax.geoAt(x);
      out.push(f.local(g.lat, g.lon, road(x) + f.geoid(g.lat, g.lon)));
    }
  }
  return out;
}

/**
 * A notable bridge's structure in the scene's frame, hung on its drivable deck: `deckZ(x)` that deck's top [the frame's z] at abscissa
 * x along the same axis (its profile's deckAt — one owner: the towers' struts, the cables' and stays' anchors, the girder under it all
 * follow the surface the cars and the craft stand on). Its feet never under the ground nor the sea.
 */
export function notableParts(nb: NotableBridge, f: NotableFrame, deckZ?: (x: number) => number): NotableParts {
  const ax = axisOf(nb, f);
  const L = ax.L;
  const road = catalogueRoadway(nb, f, ax);
  /** the scene's point at x along the axis, `off` across it (+ left), `hMsl` over the mean sea level */
  const at = (x: number, off = 0, hMsl = 0): Vec3 => {
    const g = ax.geoAt(x);
    const d = ax.dirAt(x);
    const p = f.local(g.lat, g.lon, hMsl + f.geoid(g.lat, g.lon));
    return [p[0] - d[1] * off, p[1] + d[0] * off, p[2]];
  };
  /** the roadway over the mean sea level at x: the drivable deck's when given (its frame z less the sea's there), else the catalogue's */
  const roadway = (x: number) => (deckZ ? deckZ(x) - at(x, 0, 0)[2] : road(x));
  const ts = ax.towerS;
  const sMain = ts.length >= 2 ? [ts[0]!, ts[ts.length - 1]!] : ts.length === 1 ? [ts[0]!, ts[0]!] : [0, L];
  const out: NotableParts = { deck: [], solids: [], cables: [] };
  const N = (g: Wgs84) => f.geoid(g.lat, g.lon);
  const along = (x: number) => ax.dirAt(x);

  // (the girder under the roadway: a box every 20 m at most, its paint the structure's — the truss's or the box girder's)
  const slab = 0.6;
  const nDeck = Math.max(2, Math.ceil(L / 20));
  for (let i = 0; i < nDeck; i++) {
    const s0 = (L * i) / nDeck,
      s1 = (L * (i + 1)) / nDeck;
    const a = at(s0, 0, roadway(s0) - slab - nb.girderDepth / 2),
      b = at(s1, 0, roadway(s1) - slab - nb.girderDepth / 2);
    const m = prism(a, b, nb.deckWidth, nb.girderDepth, nb.deckWidth, nb.girderDepth);
    out.solids.push({
      ...m,
      ring: footRing(at((s0 + s1) / 2), along((s0 + s1) / 2), s1 - s0, nb.deckWidth),
      bottom: Math.min(a[2], b[2]) - nb.girderDepth / 2,
      top: Math.max(a[2], b[2]) + nb.girderDepth / 2,
      paint: nb.girderPaint,
    });
  }

  // (the towers: their legs from the water or the ground up to the top, tapering; a portal's struts; an inverted Y's legs meeting
  // over the deck into one mast; a single mast on the axis; a viaduct's two shafts up to its deck and its mast over it)
  const topAt = (x: number) => (nb.towerAboveDeck !== undefined ? roadway(x) + nb.towerAboveDeck : nb.towerTop);
  nb.towers.forEach((g, k) => {
    const x = ts[k]!;
    const d = along(x);
    const foot = Math.max(f.ground(g.lat, g.lon) - N(g), 0) - 2;
    const top = topAt(x);
    const deckAt = roadway(x);
    const legs: { a: Vec3; b: Vec3; paint: BridgePaint; foot: [number, number]; head: [number, number] }[] = [];
    const leg = (a: Vec3, b: Vec3, paint = nb.towerPaint, fs = nb.legFoot, hs = nb.legTop) =>
      legs.push({ a, b, paint, foot: fs, head: hs });
    if (nb.towerShape === "single") leg(at(x, 0, foot), at(x, 0, top));
    else if (nb.towerShape === "inverted-y") {
      const join = deckAt + (top - deckAt) * 0.45;
      for (const side of [-1, 1]) leg(at(x, side * nb.legOffset, foot), at(x, side * nb.legTop[1] * 0.4, join));
      leg(at(x, 0, join - 2), at(x, 0, top));
    } else if (nb.towerShape === "pier-mast") {
      const under = deckAt - slab - nb.girderDepth;
      for (const side of [-1, 1])
        leg(at(x, side * nb.legOffset, foot), at(x, side * nb.legOffset, under), nb.pierPaint ?? BridgePaint.Concrete);
      leg(at(x, 0, deckAt), at(x, 0, top), nb.towerPaint, [nb.legTop[0] * 1.6, nb.legTop[1] * 1.6], nb.legTop);
    } else for (const side of [-1, 1]) leg(at(x, side * nb.legOffset, foot), at(x, side * nb.legOffset, top));
    for (const l of legs) {
      const m = prism(l.a, l.b, l.foot[0], l.foot[1], l.head[0], l.head[1], [d[0], d[1], 0]);
      const c: Vec3 = [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2, 0];
      const spread = Math.hypot(l.a[0] - l.b[0], l.a[1] - l.b[1]);
      out.solids.push({
        ...m,
        ring: footRing(c, d, l.foot[0], l.foot[1] + spread),
        bottom: Math.min(l.a[2], l.b[2]),
        top: Math.max(l.a[2], l.b[2]),
        paint: l.paint,
      });
    }
    for (const h of nb.towerShape === "portal" || nb.towerShape === "gothic" ? (nb.struts ?? []) : []) {
      const z = deckAt + h;
      if (z > top - 1) continue;
      const a = at(x, -nb.legOffset, z),
        b = at(x, nb.legOffset, z);
      const sz = Math.max(3, nb.legTop[0] * 0.8);
      const m = prism(a, b, nb.legTop[0] * 0.9, sz, nb.legTop[0] * 0.9, sz, [d[0], d[1], 0]);
      out.solids.push({
        ...m,
        ring: footRing(at(x), d, nb.legTop[0], 2 * nb.legOffset),
        bottom: Math.min(a[2], b[2]) - sz / 2,
        top: Math.max(a[2], b[2]) + sz / 2,
        paint: nb.towerPaint,
      });
    }
  });

  if (nb.family === "suspension" && ts.length >= 2) {
    // (the anchorages: a block at each end where the cables come down into the ground)
    for (const [k, e] of [
      [0, 0],
      [1, L],
    ] as const) {
      const g = nb.ends[k];
      const foot = Math.max(f.ground(g.lat, g.lon) - N(g), 0) - 3;
      const top = roadway(e) + 4;
      const x = e + (k === 0 ? -12 : 12);
      const d = along(e);
      const a = at(x, 0, foot),
        b = at(x, 0, top);
      const m = prism(a, b, 26, nb.deckWidth + 8, 26, nb.deckWidth + 8, [d[0], d[1], 0]);
      out.solids.push({ ...m, ring: footRing(at(x), d, 26, nb.deckWidth + 8), bottom: a[2], top: b[2], paint: BridgePaint.Concrete });
    }
    // (the main cables, one each side: anchorage → tower tops, sagging in each span — a parabola under its chord, the main span's
    // sag the catalogue's (else the tops' height to 3 m over the crest), a side span's in proportion to its length squared)
    const off = nb.deckWidth / 2 - 0.5;
    const mainLen = sMain[1]! - sMain[0]! || 1;
    const crest = roadway((sMain[0]! + sMain[1]!) / 2);
    const sag = nb.cableSag ?? Math.max(10, topAt(sMain[0]!) - 1.5 - (crest + 3));
    const knots: { s: number; z: number }[] = [
      { s: 0, z: roadway(0) + 2 },
      ...ts.map((x) => ({ s: x, z: topAt(x) - 1.5 })),
      { s: L, z: roadway(L) + 2 },
    ];
    const cableAt = (x: number) => {
      let k = 0;
      while (k < knots.length - 2 && knots[k + 1]!.s < x) k++;
      const p = knots[k]!,
        q = knots[k + 1]!;
      const span = q.s - p.s || 1;
      const t = Math.max(0, Math.min(1, (x - p.s) / span));
      return p.z + (q.z - p.z) * t - 4 * sag * (span / mainLen) ** 2 * t * (1 - t);
    };
    for (const side of [-1, 1]) {
      const pts: Vec3[] = [];
      for (let k = 0; k + 1 < knots.length; k++) {
        const p = knots[k]!,
          q = knots[k + 1]!;
        const n = Math.max(4, Math.ceil((q.s - p.s) / 25));
        for (let i = k === 0 ? 0 : 1; i <= n; i++) {
          const x = p.s + ((q.s - p.s) * i) / n;
          pts.push(at(x, side * off, cableAt(x)));
        }
      }
      out.cables.push({ ...ribbon(pts), diameter: nb.cableDiameter ?? 0.9, vertical: false, paint: nb.cablePaint });
    }
    // (the suspenders: every spacing along the spans, from the cable down to the girder's edge — none within 5 m of a tower)
    const step = nb.suspenderSpacing ?? 15;
    for (let x = step; x < L - step / 2; x += step) {
      if (ts.some((t) => Math.abs(t - x) < 5)) continue;
      const zc = cableAt(x),
        zd = roadway(x) + 1;
      if (zc - zd < 1) continue;
      for (const side of [-1, 1])
        out.cables.push({
          ...ribbon([at(x, side * off, zc), at(x, side * off, zd)]),
          diameter: nb.suspenderDiameter ?? 0.07,
          vertical: true,
          paint: nb.cablePaint,
        });
    }
  } else if (nb.family === "cable-stayed") {
    // (the stays: from each pylon, each way along the deck to its reach, n a side and a plane; their anchors on the pylon from its top
    // down — a fan all near the top, a semi-fan over its upper quarter, a semi-harp over its upper half, a harp over its height above
    // the deck — and on the deck evenly from 12 m off the pylon)
    const n = nb.staysPerSide ?? 12;
    const planes = nb.stayPlanes === 1 ? [0] : [-1, 1];
    const spread = nb.stays === "fan" ? 0.05 : nb.stays === "semi-fan" ? 0.28 : nb.stays === "semi-harp" ? 0.5 : 0.85;
    const central = nb.towerShape === "inverted-y" || nb.towerShape === "single" || nb.towerShape === "pier-mast";
    for (const x of ts) {
      const top = topAt(x) - 2;
      const deckAt = roadway(x);
      const reach = nb.stayReach ?? (sMain[1]! - sMain[0]! || L) / 2;
      for (const dir of [-1, 1])
        for (let i = 0; i < n; i++) {
          const t = (i + 1) / n;
          const xd = x + dir * (12 + (reach - 14) * t);
          if (xd < 2 || xd > L - 2) continue;
          const zTop = top - (top - deckAt - 6) * spread * (1 - t);
          for (const pl of planes) {
            const offDeck = pl * (nb.deckWidth / 2 - 0.4);
            const offPyl = central ? pl * 0.6 : pl * nb.legOffset;
            out.cables.push({
              ...ribbon([at(x, offPyl, zTop), at(xd, offDeck, roadway(xd) + 0.5)]),
              diameter: nb.stayDiameter ?? 0.2,
              vertical: false,
              paint: nb.cablePaint,
            });
          }
        }
    }
  }
  return out;
}
