// The living ground's layout, one source for the CPU and the GPU: what grows on each WorldCover class (its
// blades' heights, widths, bends, colours, clumps, rows, flowers), the lattice the blades stand on, how they
// thin with distance (and widen to keep the field's cover), and the levels of detail with their budgets.
// The shader (character.wgsl, the grass section) reads the table as uniforms (packVegetation): change it here.

/** the blades' lattice spacing [m] at full density (≈ 178 blades a square metre, each a narrow tuft) */
export const GRASS_SPACING = 0.075;
/** the farthest a blade is drawn [m] (the setting's reach is clamped to it) */
export const GRASS_REACH_MAX = 30;
/** the ground grid under the blades: 1 m cells, ±40 m round its centre (snapped to 8 m) */
export const GRASS_GRID = 81;
export const GRASS_GRID_SNAP = 8;
/** the scenery's shade on the grass: 0.5 m cells, ±32 m */
export const GRASS_LIGHT_GRID = 129;
export const GRASS_LIGHT_CELL = 0.5;
/** footprints: a ring of 128² cells of 12.5 cm (16 m, wrapped round the world) */
export const TRAMPLE_GRID = 128;
export const TRAMPLE_CELL = 0.125;
/** how long a footprint takes to rise again [s] (to 1/e) */
export const TRAMPLE_RECOVERY_S = 9;

/** Levels of detail, near to far: the blade's segments, until what distance [m], how many blades at most. */
export const GRASS_LODS = [
  { segments: 7, until: 6, capacity: 36864 },
  { segments: 4, until: 15, capacity: 90112 },
  { segments: 2, until: GRASS_REACH_MAX, capacity: 98304 },
] as const;
/** a blade's instance: three vec4 (position and height; width, bend, tip offset; packed seeds, colour, squash, phase) */
export const GRASS_INSTANCE_BYTES = 48;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The share of the lattice's blades drawn at d [m]: all within 5 m, then fewer — 18 % at 30 m. */
export function grassKeep(d: number): number {
  return d <= 5 ? 1 : Math.max(0.18, (5 / d) ** 1.1);
}
/** The width a kept blade takes to hold the field's cover where its neighbours are thinned out (2.4 at most). */
export function grassWiden(keep: number): number {
  return Math.min(2.4, 1 / Math.sqrt(Math.max(keep, 1e-3)));
}
/** The blades' height at d of a reach [m]: full, then sinking into the ground over its last 4 m (no edge to the field). */
export function grassRise(d: number, reach: number): number {
  return 1 - smoothstep(reach - 4, reach, d);
}
/** The level of detail of a blade at d [m]. */
export function grassLod(d: number): number {
  return d < GRASS_LODS[0].until ? 0 : d < GRASS_LODS[1].until ? 1 : 2;
}

/** A kind of vegetation (its blades' figures, metres; colours linear). */
export interface Vegetation {
  name: string;
  /** the share of the lattice's points it grows on (before the distance's thinning) */
  density: number;
  height: [number, number];
  width: [number, number];
  /** how far the blade's tip leans over, a share of its height */
  bend: [number, number];
  /** the share of blades flowering (their heads coloured) */
  flowers: number;
  /** its clumps' size [m] (Voronoi cells: heights and lean shared, gaps between tufts when sparse) */
  clump: number;
  /** its rows' spacing [m] (a crop; 0: none) */
  rows: number;
  /** how much of the hue comes from the satellite's colour there (0…1) */
  satellite: number;
  /** its colours: at the root, at the tip (linear) */
  base: [number, number, number];
  tip: [number, number, number];
  /** heads: 0 none, 1 an ear (a crop's), 2 a reed's plume */
  head: number;
}

/** The kinds, by index (0: nothing grows). */
export const VEGETATION: Vegetation[] = [
  {
    name: "none",
    density: 0,
    height: [0, 0],
    width: [0, 0],
    bend: [0, 0],
    flowers: 0,
    clump: 1,
    rows: 0,
    satellite: 0,
    base: [0, 0, 0],
    tip: [0, 0, 0],
    head: 0,
  },
  {
    name: "meadow",
    density: 1,
    height: [0.3, 0.62],
    width: [0.011, 0.024],
    bend: [0.25, 0.6],
    flowers: 0.035,
    clump: 1.2,
    rows: 0,
    satellite: 0.45,
    base: [0.012, 0.03, 0.006],
    tip: [0.13, 0.24, 0.035],
    head: 0,
  },
  {
    name: "crop",
    density: 1,
    height: [0.62, 0.84],
    width: [0.012, 0.02],
    bend: [0.04, 0.16],
    flowers: 0,
    clump: 3.5,
    rows: 0.17,
    satellite: 0.75,
    base: [0.03, 0.05, 0.012],
    tip: [0.36, 0.3, 0.08],
    head: 1,
  },
  {
    name: "scrub",
    density: 0.38,
    height: [0.16, 0.5],
    width: [0.01, 0.022],
    bend: [0.2, 0.6],
    flowers: 0.01,
    clump: 0.9,
    rows: 0,
    satellite: 0.55,
    base: [0.03, 0.035, 0.012],
    tip: [0.2, 0.2, 0.08],
    head: 0,
  },
  {
    name: "forest floor",
    density: 0.32,
    height: [0.1, 0.32],
    width: [0.014, 0.03],
    bend: [0.25, 0.6],
    flowers: 0.004,
    clump: 0.7,
    rows: 0,
    satellite: 0.2,
    base: [0.006, 0.016, 0.004],
    tip: [0.06, 0.13, 0.02],
    head: 0,
  },
  {
    name: "reeds",
    density: 0.75,
    height: [0.8, 1.5],
    width: [0.009, 0.016],
    bend: [0.08, 0.28],
    flowers: 0,
    clump: 1.6,
    rows: 0,
    satellite: 0.35,
    base: [0.02, 0.035, 0.012],
    tip: [0.18, 0.2, 0.08],
    head: 2,
  },
  {
    name: "sparse",
    density: 0.07,
    height: [0.06, 0.22],
    width: [0.01, 0.02],
    bend: [0.25, 0.65],
    flowers: 0,
    clump: 0.6,
    rows: 0,
    satellite: 0.6,
    base: [0.05, 0.045, 0.025],
    tip: [0.24, 0.21, 0.12],
    head: 0,
  },
  {
    name: "moss",
    density: 1,
    height: [0.02, 0.055],
    width: [0.02, 0.04],
    bend: [0.3, 0.7],
    flowers: 0,
    clump: 0.4,
    rows: 0,
    satellite: 0.3,
    base: [0.02, 0.035, 0.01],
    tip: [0.11, 0.16, 0.05],
    head: 0,
  },
];

/** The kind growing on a WorldCover class (10 trees, 20 shrubs, 30 grass, 40 crops, 60 bare, 90 wetland, 95 mangroves, 100 moss). */
export function vegetationOf(cover: number): number {
  switch (cover) {
    case 30:
      return 1;
    case 40:
      return 2;
    case 20:
      return 3;
    case 10:
    case 95:
      return 4;
    case 90:
      return 5;
    case 60:
      return 6;
    case 100:
      return 7;
    default:
      return 0;
  }
}

/** the vec4s each kind takes in the shader's table */
export const VEGETATION_VEC4S = 5;
/** The table as the shader reads it: per kind (density, hMin, hMax, flowers), (wMin, wMax, bMin, bMax),
 *  (clump, rows, satellite, head), (base rgb, 0), (tip rgb, 0). */
export function packVegetation(): Float32Array {
  const out = new Float32Array(VEGETATION.length * VEGETATION_VEC4S * 4);
  VEGETATION.forEach((v, k) => {
    out.set(
      [
        v.density,
        v.height[0],
        v.height[1],
        v.flowers,
        v.width[0],
        v.width[1],
        v.bend[0],
        v.bend[1],
        v.clump,
        v.rows,
        v.satellite,
        v.head,
        ...v.base,
        0,
        ...v.tip,
        0,
      ],
      k * VEGETATION_VEC4S * 4,
    );
  });
  return out;
}

/**
 * The blades at most a field holds within reach [m] at a density share (the lattice's points kept, each level's):
 * the budget the levels' capacities must hold, the camera looking straight down on the densest kind.
 */
export function grassBudget(reach: number, density = 1): number[] {
  const out = [0, 0, 0];
  const step = 0.05;
  for (let d = step / 2; d < Math.min(reach, GRASS_REACH_MAX); d += step) {
    out[grassLod(d)]! += (2 * Math.PI * d * step * grassKeep(d) * density) / GRASS_SPACING ** 2;
  }
  return out;
}
