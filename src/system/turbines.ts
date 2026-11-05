// Q8 D1 — the wind turbines (docs/progress/refraction-horizons/Q8.md, "D1"): Overture's base theme (base.pmtiles, its
// infrastructure layer: OpenStreetMap's power=generator + generator:source=wind, ODbL) read round the scenery's centre, each
// turbine its tower, nacelle and three blades as triangles in the scenery's frame — packScenery's turbines, after the bridges',
// drawn by the raster as the buildings' meshes (scenery-raster.ts meshFs: RASTER_CODE.turbine), shaded by shadeLite (white,
// matte: the shared air, Sun and shadows), cast into the buildings' shadow map and the relief's cascades.
// Built facing TURBINE_FACING; the raster turns each head to the weather's wind and its blades by the game's clock. The far
// reach and the night's red obstruction lights are the next steps.

/** the base theme's archive in a release (the buildings' bucket — pmtiles.ts OVERTURE_BUCKET) */
export const overtureBaseUrl = (bucket: string, release: string) => `${bucket}tiles/${release}/base.pmtiles`;
/** its finest level */
export const TURBINE_Z = 13;
/** the turbines kept round the scenery's centre [m] — far past the scenery's own reach: a turbine is seen from 20–30 km, its
 *  triangles drawn at any distance, shaded white without the scenery's data — and at most (the nearest) */
export const TURBINE_REACH_M = 15000;
export const TURBINE_MAX = 160;
/** where the rotor faces [° from north]: the prevailing wind's in western Europe (south-west), until it follows the weather's */
export const TURBINE_FACING = 240;

export interface Turbine {
  lat: number;
  lon: number;
  /** the hub's height over the ground and the rotor's diameter [m] */
  hub: number;
  rotor: number;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * A feature of the infrastructure layer as a turbine (null: not one). Its hub and rotor from OSM's height:hub and rotor:diameter
 * where given, else from its total height (the hub ~62 % of it, the rotor twice the rest — the fleet's usual proportions), else
 * a 2 MW machine's (hub 95 m, rotor 90 m); held to plausible sizes.
 */
export function turbineOf(props: Record<string, unknown>, lat: number, lon: number): Turbine | null {
  if (props.subtype !== "power" || props.class !== "generator") return null;
  let tags: Record<string, unknown> = {};
  try {
    tags = typeof props.source_tags === "string" ? JSON.parse(props.source_tags) : ((props.source_tags as Record<string, unknown>) ?? {});
  } catch {
    tags = {};
  }
  const source = String(tags["generator:source"] ?? "");
  const method = String(tags["generator:method"] ?? "");
  if (source !== "wind" && method !== "wind_turbine") return null;
  const total = num(props.height) ?? num(tags.height);
  let hub = num(tags["height:hub"]);
  let rotor = num(tags["rotor:diameter"]);
  if (hub === null && total !== null) hub = total * 0.62;
  if (rotor === null && total !== null && hub !== null && total > hub) rotor = 2 * (total - hub);
  hub = Math.min(Math.max(hub ?? 95, 20), 200);
  rotor = Math.min(Math.max(rotor ?? 90, 10), 1.8 * hub);
  return { lat, lon, hub, rotor };
}

/**
 * A turbine's triangles in a frame whose x is east, y north, z up [m]: at (x, y), its foot at z0. A tower tapering from its foot
 * to the hub, a nacelle along the facing, three tapered blades in the rotor's plane (one upward), in front of the nacelle.
 */
export function turbineMesh(x: number, y: number, z0: number, t: Turbine, facing = TURBINE_FACING) {
  const positions: number[] = [],
    triangles: number[] = [];
  const a = (facing * Math.PI) / 180;
  // (the facing — towards the wind — and across it, on the ground)
  const fx = Math.sin(a),
    fy = Math.cos(a),
    sx = fy,
    sy = -fx;
  const v = (along: number, across: number, up: number) => {
    positions.push(x + fx * along + sx * across, y + fy * along + sy * across, z0 + up);
    return positions.length / 3 - 1;
  };
  const quad = (p: number, q: number, r: number, s: number) => triangles.push(p, q, r, p, r, s);
  // (a closed box from its eight corners: along × across × up ranges)
  const box = (c: (i: number) => [number, number, number]) => {
    const k = Array.from({ length: 8 }, (_, i) => v(...c(i)));
    quad(k[0]!, k[1]!, k[3]!, k[2]!);
    quad(k[4]!, k[6]!, k[7]!, k[5]!);
    quad(k[0]!, k[4]!, k[5]!, k[1]!);
    quad(k[2]!, k[3]!, k[7]!, k[6]!);
    quad(k[0]!, k[2]!, k[6]!, k[4]!);
    quad(k[1]!, k[5]!, k[7]!, k[3]!);
  };
  const H = t.hub,
    R = t.rotor / 2;
  // tower: 12 sides, its foot sunk a metre, its radius ~2.2 % of the hub's height at the foot, 60 % of that at the top
  const n = 12,
    r0 = Math.max(1.8, 0.022 * H),
    r1 = 0.6 * r0,
    top = H - 1.5;
  const ring = (r: number, z: number) =>
    Array.from({ length: n }, (_, i) => {
      const th = (2 * Math.PI * i) / n;
      return v(r * Math.cos(th), r * Math.sin(th), z);
    });
  const b0 = ring(r0, -1),
    b1 = ring(r1, top);
  for (let i = 0; i < n; i++) quad(b0[i]!, b0[(i + 1) % n]!, b1[(i + 1) % n]!, b1[i]!);
  // nacelle: ~11 % of the rotor's diameter long, mostly behind the tower's axis; 2 m either side of the hub
  const L = Math.max(6, 0.11 * t.rotor),
    w = Math.max(1.6, 0.017 * t.rotor);
  // (the obstruction light on the nacelle's roof, over the tower's axis: a 60 cm block — scenery-raster.ts meshVs widens it to a
  // few pixels, shadeLite lights it red at night, flashing)
  const lampFrom = triangles.length / 3,
    lampZ = H + w + 0.3;
  box((i) => [i & 1 ? 0.3 : -0.3, i & 2 ? 0.3 : -0.3, lampZ + (i & 4 ? 0.3 : -0.3)]);
  // (the head — nacelle, hub, blades — from here: it turns about the tower's axis to face the wind, scenery-raster.ts meshVertex)
  const headFrom = triangles.length / 3;
  const n0 = -0.7 * L,
    n1 = 0.3 * L;
  box((i) => [i & 1 ? n1 : n0, i & 2 ? w : -w, H + (i & 4 ? w : -w)]);
  // hub: a short block before the nacelle
  const h0 = n1,
    h1 = n1 + 0.06 * t.rotor;
  box((i) => [i & 1 ? h1 : h0, i & 2 ? 0.8 * w : -0.8 * w, H + (i & 4 ? 0.8 * w : -0.8 * w)]);
  // blades: in the plane across the facing, at the hub's front, one upward and the others at 120°; each tapered from its root's
  // chord (~3.5 % of the diameter) to its tip's (~1 %), 40 cm thick
  const s = h0 + 0.5 * (h1 - h0);
  const bladesFrom = triangles.length / 3;
  for (let k = 0; k < 3; k++) {
    const th = Math.PI / 2 + (2 * Math.PI * k) / 3;
    const ux = Math.cos(th),
      uz = Math.sin(th);
    // (along the blade: (ux across, uz up); its chord across it in the plane: (−uz, ux))
    const at = (r: number, c: number, d: number): [number, number, number] => [s + d, ux * r - uz * c, H + uz * r + ux * c];
    const c0 = 0.0175 * t.rotor,
      c1 = 0.005 * t.rotor,
      th2 = 0.2;
    box((i) => {
      const r = i & 1 ? R : 1.2 * w;
      const c = (i & 1 ? c1 : c0) * (i & 2 ? 1 : -1);
      return at(r, c, i & 4 ? th2 : -th2);
    });
  }
  // (the rotor: its hub, its axis — the facing, level —, its turn rate: a tip speed of ~60 m/s, the fleet's at a fresh breeze —,
  // its phase from its place; the blades its last triangles — scenery-raster.ts meshVertex turns them about the axis)
  const hub: [number, number, number] = [x + fx * s, y + fy * s, z0 + H];
  return {
    positions,
    triangles,
    blades: triangles.length / 3 - bladesFrom,
    /** the head's triangles (nacelle and hub), before the blades */
    head: bladesFrom - headFrom,
    /** the obstruction light's triangles (before the head) and its centre's height over the foot [m] */
    lamp: headFrom - lampFrom,
    lampZ: z0 + lampZ,
    /** the tower's axis on the ground (x, y) */
    tower: [x, y] as [number, number],
    hub,
    axis: [fx, fy, 0] as [number, number, number],
    omega: Math.min(2.5, 60 / R),
    phase: ((Math.abs(Math.sin(x * 12.9898 + y * 78.233)) * 43758.5453) % 1) * 2 * Math.PI,
  };
}
/** a turbine's mesh as packScenery takes it */
export type TurbineMesh = ReturnType<typeof turbineMesh>;
