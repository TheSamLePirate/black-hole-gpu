// Bridge & Road AAA — Common Surface & Support Service (PLAN-PONT-ROUTES-AAA.md PR2)
// Provides continuous C1 profile resolution, intrados clearance guarantees,
// multi-level support queries with hysteresis, and canonical surface evaluation.

export interface SupportRef {
  readonly assetId: string;
  readonly surfaceId: string;
  readonly revision: string;
}

export interface SupportSampleResult {
  readonly found: boolean;
  readonly supportRef?: SupportRef;
  readonly point: [number, number, number];
  readonly elevation: number;
  readonly normal: [number, number, number];
  readonly tangent: [number, number, number];
  readonly crossTangent: [number, number, number];
  readonly surfaceRole: "carriageway" | "sidewalk" | "parapet" | "ground";
  readonly distanceToAxis: number;
  readonly sM: number;
  readonly uM: number;
}

export interface BridgeProfileParams {
  readonly points: readonly [number, number, number][];
  readonly width: number;
  readonly thickness?: number;
  readonly clearance?: number;
  readonly flags?: number;
  readonly approachSlopeA?: number;
  readonly approachSlopeB?: number;
  readonly baseLiftM?: number;
}

export class BridgeContinuousProfile {
  readonly totalLength: number;
  readonly spans: number[];
  readonly zA: number;
  readonly zB: number;
  readonly lift: number;
  readonly width: number;
  readonly thickness: number;
  readonly clearance: number;
  readonly flags: number;
  private readonly points: readonly [number, number, number][];

  constructor(params: BridgeProfileParams) {
    this.points = params.points;
    this.width = params.width;
    this.thickness = params.thickness ?? 1.5;
    this.clearance = params.clearance ?? 5.5;
    this.flags = params.flags ?? 0;

    const span: number[] = [0];
    for (let i = 1; i < this.points.length; i++) {
      const p0 = this.points[i - 1]!;
      const p1 = this.points[i]!;
      span.push(span[i - 1]! + Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));
    }
    this.spans = span;
    this.totalLength = span[span.length - 1]!;

    if (this.totalLength < 0.5) {
      this.zA = this.points[0]?.[2] ?? 0;
      this.zB = this.points[this.points.length - 1]?.[2] ?? this.zA;
      this.lift = 0;
      return;
    }

    this.zA = this.points[0]![2];
    this.zB = this.points[this.points.length - 1]![2];

    // Compute required lift so that intrados (deck - thickness) clears obstacle points
    let requiredLift = 0;
    for (let i = 1; i < this.points.length - 1; i++) {
      const t = span[i]! / this.totalLength;
      const env = Math.min(1, 4 * t * (1 - t));
      if (env > 0.05) {
        const baselineZ = this.zA + (this.zB - this.zA) * t;
        // Intrados clearance requirement: deckZ - thickness >= groundZ + clearance
        const targetDeckZ = this.points[i]![2] + this.clearance + this.thickness;
        const needed = (targetDeckZ - baselineZ) / env;
        requiredLift = Math.max(requiredLift, needed);
      }
    }

    // Smooth bounded lift: no arbitrary +0.4 offset at ends!
    // Minimum aesthetic lift for long bridges (> 60m)
    const minLift = this.totalLength > 60 ? this.clearance * 0.4 : 0.0;
    this.lift = Math.min(Math.max(requiredLift, minLift), 40.0);
  }

  /**
   * Continuous elevation at curvilinear coordinate s in [0, totalLength].
   * At s=0, returns exactly zA (no +0.4m step!).
   * At s=totalLength, returns exactly zB.
   */
  elevationAt(s: number): number {
    if (this.totalLength <= 0) return this.zA;
    const clampedS = Math.max(0, Math.min(this.totalLength, s));
    const t = clampedS / this.totalLength;
    // Parabolic profile: 4*t*(1-t) is strictly 0 at t=0 and t=1
    const parabolicEnv = Math.min(1, 4 * t * (1 - t));
    return this.zA + (this.zB - this.zA) * t + this.lift * parabolicEnv;
  }

  /**
   * Intrados (underside of the deck) elevation at s.
   */
  intradosAt(s: number): number {
    return this.elevationAt(s) - this.thickness;
  }

  /**
   * Evaluates 3D position, unit tangent and normal on the bridge deck at (s, u).
   * s in [0, totalLength], u in [-width/2, width/2] (across axis).
   */
  sample(
    s: number,
    u: number,
  ): {
    position: [number, number, number];
    normal: [number, number, number];
    tangent: [number, number, number];
    crossTangent: [number, number, number];
    role: "carriageway" | "sidewalk" | "parapet";
  } {
    const clampedS = Math.max(0, Math.min(this.totalLength, s));
    let segIdx = 1;
    while (segIdx < this.spans.length - 1 && this.spans[segIdx]! < clampedS) {
      segIdx++;
    }
    const s0 = this.spans[segIdx - 1]!;
    const s1 = this.spans[segIdx]!;
    const segLen = s1 - s0;
    const f = segLen > 1e-6 ? (clampedS - s0) / segLen : 0;

    const p0 = this.points[segIdx - 1]!;
    const p1 = this.points[segIdx]!;

    const cx = p0[0] + (p1[0] - p0[0]) * f;
    const cy = p0[1] + (p1[1] - p0[1]) * f;
    const cz = this.elevationAt(clampedS);

    const segL2D = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    const tx = (p1[0] - p0[0]) / segL2D;
    const ty = (p1[1] - p0[1]) / segL2D;

    // Normal across in XY (to the left of tangent)
    const nx = -ty;
    const ny = tx;

    // Slope dz/ds
    const tNorm = clampedS / Math.max(this.totalLength, 1e-6);
    const dEnvDt = 4 * (1 - 2 * tNorm);
    const dzDs = (this.zB - this.zA) / Math.max(this.totalLength, 1e-6) + (this.lift * dEnvDt) / Math.max(this.totalLength, 1e-6);

    const tangentL = Math.hypot(1, dzDs);
    const unitTx = tx / tangentL;
    const unitTy = ty / tangentL;
    const unitTz = dzDs / tangentL;

    // Cross tangent along u
    const crossTx = nx;
    const crossTy = ny;
    const crossTz = 0;

    // Normal is Cross(tangent, crossTangent) pointing upwards
    const normX = -unitTz * ny;
    const normY = unitTz * nx;
    const normZ = unitTx * ny - unitTy * nx;
    const nLen = Math.hypot(normX, normY, normZ) || 1;

    // Cross section role and height adjustment
    const halfWidth = this.width / 2;
    const absU = Math.abs(u);
    let role: "carriageway" | "sidewalk" | "parapet" = "carriageway";
    let roleHeightOffset = 0;

    if (absU > halfWidth - 0.3) {
      role = "parapet";
      roleHeightOffset = 1.0;
    } else if (absU > halfWidth - 2.0 && this.width >= 10.0) {
      role = "sidewalk";
      roleHeightOffset = 0.15;
    }

    return {
      position: [cx + nx * u, cy + ny * u, cz + roleHeightOffset],
      normal: [normX / nLen, normY / nLen, normZ / nLen],
      tangent: [unitTx, unitTy, unitTz],
      crossTangent: [crossTx, crossTy, crossTz],
      role,
    };
  }

  /**
   * Finds the closest point on the bridge axis from local (x, y).
   */
  project(x: number, y: number): { s: number; u: number; distance: number } {
    let bestDist = Infinity;
    let bestS = 0;
    let bestU = 0;

    for (let i = 0; i < this.points.length - 1; i++) {
      const p0 = this.points[i]!;
      const p1 = this.points[i + 1]!;
      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const L2 = dx * dx + dy * dy;
      if (L2 < 1e-6) continue;

      const t = Math.max(0, Math.min(1, ((x - p0[0]) * dx + (y - p0[1]) * dy) / L2));
      const projX = p0[0] + dx * t;
      const projY = p0[1] + dy * t;
      const dist = Math.hypot(x - projX, y - projY);

      if (dist < bestDist) {
        bestDist = dist;
        const segLen = this.spans[i + 1]! - this.spans[i]!;
        bestS = this.spans[i]! + segLen * t;

        // Signed u: cross product (dx, dy) x (x - projX, y - projY)
        const L = Math.sqrt(L2);
        const signedU = (dx * (y - projY) - dy * (x - projX)) / L;
        bestU = signedU;
      }
    }

    return { s: bestS, u: bestU, distance: bestDist };
  }
}

/**
 * Surface Registry: manages multiple levels of support (ground, bridges, elevated roads)
 * without camera/view dependence, supporting hysteresis for consistent actor queries.
 */
export class SupportSurfaceRegistry {
  private readonly bridges = new Map<
    string,
    {
      readonly ref: SupportRef;
      readonly profile: BridgeContinuousProfile;
      readonly level: number;
    }
  >();

  registerBridge(ref: SupportRef, profile: BridgeContinuousProfile, level = 1): void {
    this.bridges.set(ref.surfaceId, { ref, profile, level });
  }

  unregisterBridge(surfaceId: string): void {
    this.bridges.delete(surfaceId);
  }

  /**
   * Queries a bridge deck at local (x, y) with optional level / layer and vertical window.
   * If expectedLevel is supplied, only bridges matching that level are considered.
   * If expectedZ is supplied, only bridge decks within maxDeltaZ of expectedZ are considered.
   * Returns null if no bridge matches or if the query falls outside the deck boundaries.
   */
  queryBridgeAt(
    x: number,
    y: number,
    options?: {
      readonly expectedZ?: number;
      readonly expectedLevel?: number;
      readonly maxDeltaZ?: number;
    },
  ): SupportSampleResult | null {
    let bestCandidate: {
      ref: SupportRef;
      profile: BridgeContinuousProfile;
      s: number;
      u: number;
      deckZ: number;
      level: number;
    } | null = null;
    let minVertDist = Infinity;

    for (const entry of this.bridges.values()) {
      if (options?.expectedLevel !== undefined && entry.level !== options.expectedLevel) {
        continue;
      }
      const proj = entry.profile.project(x, y);
      const halfWidth = entry.profile.width / 2 + 0.5;
      if (proj.distance <= halfWidth) {
        const sample = entry.profile.sample(proj.s, proj.u);
        const deckZ = sample.position[2];

        if (options?.expectedZ !== undefined) {
          const deltaZ = Math.abs(options.expectedZ - deckZ);
          const maxDelta = options.maxDeltaZ ?? 2.5;
          if (deltaZ > maxDelta) continue;
          if (deltaZ < minVertDist) {
            minVertDist = deltaZ;
            bestCandidate = {
              ref: entry.ref,
              profile: entry.profile,
              s: proj.s,
              u: proj.u,
              deckZ,
              level: entry.level,
            };
          }
        } else {
          // If no expectedZ, pick candidate with matching level or closest 2D projection
          bestCandidate = {
            ref: entry.ref,
            profile: entry.profile,
            s: proj.s,
            u: proj.u,
            deckZ,
            level: entry.level,
          };
          break;
        }
      }
    }

    if (!bestCandidate) return null;
    const s = bestCandidate.profile.sample(bestCandidate.s, bestCandidate.u);
    return {
      found: true,
      supportRef: bestCandidate.ref,
      point: s.position,
      elevation: s.position[2],
      normal: s.normal,
      tangent: s.tangent,
      crossTangent: s.crossTangent,
      surfaceRole: s.role,
      distanceToAxis: Math.abs(bestCandidate.u),
      sM: bestCandidate.s,
      uM: bestCandidate.u,
    };
  }

  sample(ref: SupportRef, sM: number, uM: number): SupportSampleResult | null {
    const entry = this.bridges.get(ref.surfaceId);
    if (!entry) return null;

    const s = entry.profile.sample(sM, uM);
    return {
      found: true,
      supportRef: entry.ref,
      point: s.position,
      elevation: s.position[2],
      normal: s.normal,
      tangent: s.tangent,
      crossTangent: s.crossTangent,
      surfaceRole: s.role,
      distanceToAxis: Math.abs(uM),
      sM,
      uM,
    };
  }

  /**
   * Multi-level support query:
   * Finds the appropriate support surface at local (x, y, z) among ground and bridges.
   * If `previousSupport` is provided, applies hysteresis to prevent popping between levels.
   */
  query(position: [number, number, number], groundZ: number, volumeRadius = 2.0, previousSupport?: SupportRef): SupportSampleResult {
    const [x, y, z] = position;

    // 1. Hysteresis check: if previousSupport is set and valid, check if actor is still on it
    if (previousSupport) {
      const prev = this.bridges.get(previousSupport.surfaceId);
      if (prev) {
        const proj = prev.profile.project(x, y);
        const halfWidth = prev.profile.width / 2 + 1.0; // 1m margin
        if (proj.distance <= halfWidth) {
          const sample = prev.profile.sample(proj.s, proj.u);
          // Check if actor elevation is still within vertical range of this deck (e.g. 2.5m)
          if (Math.abs(z - sample.position[2]) <= Math.max(volumeRadius, 2.5)) {
            return {
              found: true,
              supportRef: prev.ref,
              point: sample.position,
              elevation: sample.position[2],
              normal: sample.normal,
              tangent: sample.tangent,
              crossTangent: sample.crossTangent,
              surfaceRole: sample.role,
              distanceToAxis: Math.abs(proj.u),
              sM: proj.s,
              uM: proj.u,
            };
          }
        }
      }
    }

    // 2. Candidate search among bridges
    interface Candidate {
      ref: SupportRef;
      profile: BridgeContinuousProfile;
      s: number;
      u: number;
      deckZ: number;
      deltaZ: number;
    }
    const candidates: Candidate[] = [];

    for (const entry of this.bridges.values()) {
      const proj = entry.profile.project(x, y);
      const halfWidth = entry.profile.width / 2 + 0.5;
      if (proj.distance <= halfWidth) {
        const sample = entry.profile.sample(proj.s, proj.u);
        const deckZ = sample.position[2];
        const deltaZ = z - deckZ; // positive if actor is above deck
        candidates.push({
          ref: entry.ref,
          profile: entry.profile,
          s: proj.s,
          u: proj.u,
          deckZ,
          deltaZ,
        });
      }
    }

    // If actor is close to a bridge deck (within volumeRadius or deltaZ >= -0.5m and deltaZ <= 3.0m)
    // Select the best matching bridge above ground
    let bestCandidate: Candidate | null = null;
    let minVertDist = Infinity;

    for (const c of candidates) {
      // If actor is closer to this bridge deck than to the ground, or above the bridge
      const distToDeck = Math.abs(c.deltaZ);
      const distToGround = Math.abs(z - groundZ);

      if (distToDeck < distToGround && distToDeck <= Math.max(volumeRadius * 2, 3.5)) {
        if (distToDeck < minVertDist) {
          minVertDist = distToDeck;
          bestCandidate = c;
        }
      }
    }

    if (bestCandidate) {
      const s = bestCandidate.profile.sample(bestCandidate.s, bestCandidate.u);
      return {
        found: true,
        supportRef: bestCandidate.ref,
        point: s.position,
        elevation: s.position[2],
        normal: s.normal,
        tangent: s.tangent,
        crossTangent: s.crossTangent,
        surfaceRole: s.role,
        distanceToAxis: Math.abs(bestCandidate.u),
        sM: bestCandidate.s,
        uM: bestCandidate.u,
      };
    }

    // 3. Fallback to ground support
    return {
      found: true,
      point: [x, y, groundZ],
      elevation: groundZ,
      normal: [0, 0, 1],
      tangent: [1, 0, 0],
      crossTangent: [0, 1, 0],
      surfaceRole: "ground",
      distanceToAxis: 0,
      sM: 0,
      uM: 0,
    };
  }
}
