// Bridge and Road AAA Corpus & Contracts (PLAN-PONT-ROUTES-AAA.md PR0)
// Defines data types, pure measurement probes, and the 12 reference corpus cases.
// Compliant with WGS84, multi-level support contracts, and Rule 3 (positive/negative witnesses).

export interface SupportRef {
  readonly assetId: string;
  readonly surfaceId: string;
  readonly revision: string;
}

export type CorridorKind = "road" | "rail" | "foot" | "mixed";

export interface BridgePort {
  readonly id: string;
  readonly point: [number, number, number];
  readonly tangent: [number, number, number];
  readonly width: number;
  readonly level: number;
  readonly isOpen: boolean;
  readonly connectedCorridorId?: string;
}

export interface BridgeCrossSection {
  readonly carriagewayWidth: number;
  readonly lanes: number;
  readonly sidewalkLeft: number;
  readonly sidewalkRight: number;
  readonly parapetWidth: number;
  readonly deckThickness: number;
  readonly totalWidth: number;
}

export interface BridgeCorridor {
  readonly id: string;
  readonly source: "bdtopo" | "omt" | "synthetic";
  readonly kind: CorridorKind;
  readonly level: number;
  readonly points: [number, number, number][];
  readonly crossSection: BridgeCrossSection;
  readonly clearanceM: number;
  readonly ports: { readonly a: BridgePort; readonly b: BridgePort };
}

export interface SupportQuery {
  readonly position: [number, number, number];
  readonly volumeRadius?: number;
  readonly previousSupport?: SupportRef;
  readonly vehicleKind?: "car" | "pedestrian" | "train" | "aircraft";
}

export interface SupportSampleResult {
  readonly found: boolean;
  readonly supportRef?: SupportRef;
  readonly elevation: number;
  readonly normal: [number, number, number];
  readonly tangent: [number, number, number];
  readonly surfaceRole: "carriageway" | "sidewalk" | "parapet" | "ground";
  readonly distanceToAxis: number;
}

export interface LegacyBridgeProbeResult {
  readonly clearanceM: number;
  readonly slabs: number;
  readonly firstSlabTopM: number;
  readonly profileEndpointM: number;
  readonly maxAdjacentStepM: number;
  readonly maxContinuousCarVsSlabM: number;
  readonly topM: number[];
}

/**
 * Pure simulator of the legacy `deckBridge` geometry from `scenery-worker.ts`.
 * Replicates the exact arithmetic without string-slicing code at runtime.
 */
export function measureLegacyBridgeSteps(points: [number, number, number][], _width: number, clearance: number): LegacyBridgeProbeResult {
  const span: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    span.push(span[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  }
  const total = span[span.length - 1]!;
  if (total < 1) {
    return {
      clearanceM: clearance,
      slabs: 0,
      firstSlabTopM: 0,
      profileEndpointM: 0,
      maxAdjacentStepM: 0,
      maxContinuousCarVsSlabM: 0,
      topM: [],
    };
  }

  const zA = points[0]![2];
  const zB = points[points.length - 1]![2];
  let lift = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const t = span[i]! / total;
    const env = Math.min(1, 4 * t * (1 - t));
    if (env > 0.05) lift = Math.max(lift, (points[i]![2] + clearance - (zA + (zB - zA) * t)) / env);
  }
  lift = Math.min(Math.max(lift, total > 60 ? clearance * 0.5 : 0.6), 40);

  const deckAt = (sv: number) => {
    const t = sv / total;
    return zA + (zB - zA) * t + lift * Math.min(1, 4 * t * (1 - t)) + 0.4;
  };

  const topM: number[] = [];
  const slabSpans: { minS: number; maxS: number; top: number }[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const length = span[i + 1]! - span[i]!;
    if (length < 0.5) continue;
    const n = Math.max(1, Math.ceil(length / 10));
    for (let k = 0; k < n; k++) {
      const f0 = k / n;
      const f1 = (k + 1) / n;
      const sMid = span[i]! + length * (f0 + f1) * 0.5;
      const top = deckAt(sMid);
      topM.push(top);
      slabSpans.push({
        minS: span[i]! + length * f0,
        maxS: span[i]! + length * f1,
        top,
      });
    }
  }

  let maxStep = 0;
  for (let i = 1; i < topM.length; i++) {
    maxStep = Math.max(maxStep, Math.abs(topM[i]! - topM[i - 1]!));
  }

  let maxCarError = 0;
  for (const slab of slabSpans) {
    for (const s of [slab.minS + 0.01, slab.maxS - 0.01]) {
      maxCarError = Math.max(maxCarError, Math.abs(deckAt(s) - slab.top));
    }
  }

  const round = (v: number) => +v.toFixed(4);
  return {
    clearanceM: clearance,
    slabs: topM.length,
    firstSlabTopM: round(topM[0] ?? 0),
    profileEndpointM: round(deckAt(0)),
    maxAdjacentStepM: round(maxStep),
    maxContinuousCarVsSlabM: round(maxCarError),
    topM: topM.map(round),
  };
}

/**
 * Probe deduplication key: demonstrates why local `${id}:${round(x)}` fails
 * across different cell origins while global canonical key succeeds.
 */
export function probeBridgeKeys(
  id: number,
  globalPoint: [number, number],
  cellOrigins: { lat: number; lon: number; toCellMeters: (pt: [number, number]) => [number, number] }[],
): { legacyKeys: string[]; canonicalKey: string } {
  const legacyKeys = cellOrigins.map((origin) => {
    const local = origin.toCellMeters(globalPoint);
    return `${id}:${Math.round(local[0])}`;
  });
  const canonicalKey = `bridge:${id}`;
  return { legacyKeys, canonicalKey };
}

/**
 * Rule 3 Step Witness probe:
 * Injects a step of size `stepM` into a sampled profile and tests whether the probe detects it.
 * Passing threshold = 0.05m (5 cm).
 */
export function evaluateStepWitness(
  profileSamples: number[],
  injectedStepM: number,
  stepIndex = Math.floor(profileSamples.length / 2),
): { detected: boolean; maxDetectedStepM: number; passedAcceptance: boolean } {
  const modified = [...profileSamples];
  for (let i = stepIndex; i < modified.length; i++) {
    modified[i] = (modified[i] ?? 0) + injectedStepM;
  }
  let maxDetected = 0;
  for (let i = 1; i < modified.length; i++) {
    maxDetected = Math.max(maxDetected, Math.abs(modified[i]! - modified[i - 1]!));
  }
  return {
    detected: maxDetected >= Math.abs(injectedStepM) * 0.9,
    maxDetectedStepM: +maxDetected.toFixed(4),
    passedAcceptance: maxDetected <= 0.05,
  };
}

// -------------------------------------------------------------------------------------------------
// The 12 reference corpus cases defined in PLAN-PONT-ROUTES-AAA.md §10.1
// -------------------------------------------------------------------------------------------------

export interface CorpusCase {
  readonly id: string;
  readonly name: string;
  readonly kind: CorridorKind;
  readonly geographic: { lat: number; lon: number; datum: "WGS84" | "MSL" | "synthetic" };
  readonly lengthM: number;
  readonly widthM: number;
  readonly clearanceM: number;
  readonly points: [number, number, number][];
  readonly targetInvariants: {
    readonly maxInternalDiscontinuityM: number; // <= 0.05 m
    readonly maxWheelToSurfaceErrorM: number; // <= 0.02 m
    readonly modeSeparation: boolean;
    readonly stableGlobalId: boolean;
  };
}

export const CORPUS_CASES: Record<string, CorpusCase> = {
  // Case 1: Pont droit synthétique 100 m
  CASE_SYNTH_FLAT_100M: {
    id: "synth:flat_100m",
    name: "Pont droit synthétique 100 m",
    kind: "road",
    geographic: { lat: 48.85, lon: 2.35, datum: "synthetic" },
    lengthM: 100,
    widthM: 10,
    clearanceM: 5.5,
    points: Array.from({ length: 6 }, (_, i) => [20 * i, 0, 0]),
    targetInvariants: {
      maxInternalDiscontinuityM: 0.05,
      maxWheelToSurfaceErrorM: 0.02,
      modeSeparation: true,
      stableGlobalId: true,
    },
  },

  // Case 2: Pont court incliné sur terrain accidenté
  CASE_SYNTH_STEEP_RAMP: {
    id: "synth:steep_ramp_40m",
    name: "Pont court incliné sur terrain accidenté",
    kind: "road",
    geographic: { lat: 45.18, lon: 5.72, datum: "synthetic" },
    lengthM: 40,
    widthM: 8,
    clearanceM: 4.5,
    points: [
      [0, 0, 200],
      [10, 0, 202],
      [20, 0, 205],
      [30, 0, 209],
      [40, 0, 214],
    ],
    targetInvariants: {
      maxInternalDiscontinuityM: 0.05,
      maxWheelToSurfaceErrorM: 0.02,
      modeSeparation: true,
      stableGlobalId: true,
    },
  },

  // Case 3: Courbe, élargissement et culée en biais
  CASE_SYNTH_CURVE_SKEW: {
    id: "synth:curve_skew_80m",
    name: "Courbe, élargissement et culée en biais",
    kind: "road",
    geographic: { lat: 43.6, lon: 1.44, datum: "synthetic" },
    lengthM: 80,
    widthM: 12,
    clearanceM: 5.0,
    points: [
      [0, 0, 50],
      [20, 5, 51],
      [40, 15, 52],
      [60, 28, 52],
      [80, 45, 50],
    ],
    targetInvariants: {
      maxInternalDiscontinuityM: 0.05,
      maxWheelToSurfaceErrorM: 0.02,
      modeSeparation: true,
      stableGlobalId: true,
    },
  },

  // Case 4: Deux étages superposés (route sous pont)
  CASE_SYNTH_TWO_TIERS: {
    id: "synth:two_tiers_cross",
    name: "Deux étages superposés avec route inférieure",
    kind: "road",
    geographic: { lat: 48.88, lon: 2.32, datum: "synthetic" },
    lengthM: 60,
    widthM: 14,
    clearanceM: 5.5,
    points: [
      [-30, 0, 30],
      [0, 0, 30.5],
      [30, 0, 30],
    ],
    targetInvariants: {
      maxInternalDiscontinuityM: 0.05,
      maxWheelToSurfaceErrorM: 0.02,
      modeSeparation: true,
      stableGlobalId: true,
    },
  },

  // Case 5: Ouvrage mixte, voies parallèles et bifurcation
  CASE_SYNTH_MIXED_MODES: {
    id: "synth:mixed_road_rail_fork",
    name: "Ouvrage mixte route et rail avec bifurcation",
    kind: "mixed",
    geographic: { lat: 48.84, lon: 2.37, datum: "synthetic" },
    lengthM: 120,
    widthM: 20,
    clearanceM: 6.0,
    points: [
      [0, 0, 40],
      [40, 0, 42],
      [80, 0, 42],
      [120, 0, 40],
    ],
    targetInvariants: {
      maxInternalDiscontinuityM: 0.05,
      maxWheelToSurfaceErrorM: 0.02,
      modeSeparation: true,
      stableGlobalId: true,
    },
  },

  // Case 6: Ouvrage multi-tuiles traversant frontière de cellules z14/z15
  CASE_SYNTH_MULTI_TILE: {
    id: "synth:multi_tile_border_250m",
    name: "Ouvrage traversant frontière de cellules z14/z15",
    kind: "road",
    geographic: { lat: 48.86, lon: 2.33, datum: "WGS84" },
    lengthM: 250,
    widthM: 14,
    clearanceM: 5.5,
    points: [
      [-125, 0, 35],
      [-50, 0, 37],
      [0, 0, 38], // tile edge at 0
      [50, 0, 37],
      [125, 0, 35],
    ],
    targetInvariants: {
      maxInternalDiscontinuityM: 0.05,
      maxWheelToSurfaceErrorM: 0.02,
      modeSeparation: true,
      stableGlobalId: true,
    },
  },

  // Case 7: Long viaduc avec centre hors champ
  CASE_SYNTH_LONG_VIADUCT: {
    id: "synth:long_viaduct_1200m",
    name: "Long viaduc avec centre hors champ",
    kind: "road",
    geographic: { lat: 44.08, lon: 3.02, datum: "synthetic" },
    lengthM: 1200,
    widthM: 16,
    clearanceM: 80.0,
    points: [
      [0, 0, 320],
      [300, 0, 350],
      [600, 0, 370],
      [900, 0, 350],
      [1200, 0, 320],
    ],
    targetInvariants: {
      maxInternalDiscontinuityM: 0.05,
      maxWheelToSurfaceErrorM: 0.02,
      modeSeparation: true,
      stableGlobalId: true,
    },
  },

  // Case 8: Paris — Alexandre III et ponts de Seine
  CASE_REAL_SEINE_ALEXANDRE_III: {
    id: "real:seine_alexandre_iii",
    name: "Pont Alexandre III (Paris, Seine)",
    kind: "road",
    geographic: { lat: 48.8637, lon: 2.3135, datum: "WGS84" },
    lengthM: 160,
    widthM: 40,
    clearanceM: 5.5,
    points: [
      [-80, 0, 32],
      [-40, 0, 35],
      [0, 0, 36.5],
      [40, 0, 35],
      [80, 0, 32],
    ],
    targetInvariants: {
      maxInternalDiscontinuityM: 0.05,
      maxWheelToSurfaceErrorM: 0.02,
      modeSeparation: true,
      stableGlobalId: true,
    },
  },

  // Case 9: Toulon / côte varoise (viaduc et rail)
  CASE_REAL_TOULON_VIADUCT: {
    id: "real:toulon_viaduc_rail",
    name: "Viaduc ferroviaire et littoral varois (Toulon)",
    kind: "rail",
    geographic: { lat: 43.12, lon: 5.93, datum: "WGS84" },
    lengthM: 320,
    widthM: 10,
    clearanceM: 12.0,
    points: [
      [0, 0, 25],
      [80, 10, 30],
      [160, 20, 32],
      [240, 25, 30],
      [320, 28, 25],
    ],
    targetInvariants: {
      maxInternalDiscontinuityM: 0.05,
      maxWheelToSurfaceErrorM: 0.02,
      modeSeparation: true,
      stableGlobalId: true,
    },
  },

  // Case 10: Route de montagne sur relief grossier
  CASE_REAL_MOUNTAIN_PASS: {
    id: "real:mountain_pass_coarse",
    name: "Route de montagne sur relief grossier (hors France)",
    kind: "road",
    geographic: { lat: 46.55, lon: 8.56, datum: "WGS84" },
    lengthM: 180,
    widthM: 7,
    clearanceM: 6.0,
    points: [
      [0, 0, 1850],
      [45, 10, 1853],
      [90, 25, 1858],
      [135, 45, 1864],
      [180, 70, 1872],
    ],
    targetInvariants: {
      maxInternalDiscontinuityM: 0.05,
      maxWheelToSurfaceErrorM: 0.02,
      modeSeparation: true,
      stableGlobalId: true,
    },
  },

  // Case 11: Région roulant à gauche
  CASE_REAL_LEFT_HAND_TRAFFIC: {
    id: "real:left_hand_bridge_london",
    name: "Pont routier urbain à circulation à gauche (UK)",
    kind: "road",
    geographic: { lat: 51.5074, lon: -0.1278, datum: "WGS84" },
    lengthM: 220,
    widthM: 18,
    clearanceM: 7.0,
    points: [
      [0, 0, 15],
      [55, 0, 18],
      [110, 0, 20],
      [165, 0, 18],
      [220, 0, 15],
    ],
    targetInvariants: {
      maxInternalDiscontinuityM: 0.05,
      maxWheelToSurfaceErrorM: 0.02,
      modeSeparation: true,
      stableGlobalId: true,
    },
  },

  // Case 12: Source partielle ou contradictoire (repli déterministe)
  CASE_DATA_DEGRADED_FALLBACK: {
    id: "data:degraded_fallback_missing_z",
    name: "Ouvrage avec cote Z absente et géométrie partielle",
    kind: "road",
    geographic: { lat: 48.0, lon: 2.0, datum: "MSL" },
    lengthM: 90,
    widthM: 8,
    clearanceM: 5.5,
    points: [
      [0, 0, 100],
      [45, 0, 100],
      [90, 0, 100],
    ],
    targetInvariants: {
      maxInternalDiscontinuityM: 0.05,
      maxWheelToSurfaceErrorM: 0.02,
      modeSeparation: true,
      stableGlobalId: true,
    },
  },
};
