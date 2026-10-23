// The CameraController — the spacecraft's own HUD panels (docs/PLAN-VAISSEAUX-AAA.md, X4; game/craftpanel.ts): the
// figures gathered for the flown craft's profile (VESSELS.*.space.panel), the Lander's landing radar reading them
// (radar/landing.ts — PLAN-RADAR-AAA, RD4's leftover), and the Lander's hover calls (« 60 », « 30 »).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { fleet } from "../fleet";
import { type CraftPanel, descentPanel, hoverCall, hoverSeconds, mothershipPanel } from "../game/craftpanel";
import { LANDING_RADARS, type LandingRadarOut, landingRadar } from "../radar/landing";
import { t } from "../i18n";
import { G0 } from "../units";
import { VESSELS, type VesselId } from "../vessels";
import type { CameraController } from "../controls";
import type { FlightInfo } from "./telemetry";

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

declare module "../controls" {
  interface CameraController {
    /** the hover's seconds left last frame (the calls' crossing) */
    hoverSecPrev?: number;
    craftPanelNow: typeof craftPanelNow;
    descentFigures: typeof descentFigures;
    landingRadarNow: typeof landingRadarNow;
    hoverCallStep: typeof hoverCallStep;
  }
}

type Surface = { alt?: number; vVert?: number; vHor?: number; gLocal?: number; landed?: boolean } | null;

/** The ground under the craft as its probes find it (surfaceInfo): the height over it [m], its rate [m/s], the speeds
 *  forward and across over it [m/s] (both level), the belly's tilt off the vertical [rad], landed, the local weight
 *  [m/s²]; null away from a world's ground or above 15 km. */
function descentFigures(this: CameraController, i: FlightInfo) {
  const sf = this.surfaceInfo() as Surface;
  if (!sf || sf.alt === undefined || sf.alt > 15000) return null;
  // (the speed over the ground split along the craft's nose and across, both level)
  const S = i.S as unknown as number[][];
  const nose: V3 = [S[0]![2]!, S[1]![2]!, S[2]![2]!];
  const right: V3 = [-S[0]![0]!, -S[1]![0]!, -S[2]![0]!];
  const top: V3 = [S[0]![1]!, S[1]![1]!, S[2]![1]!];
  const up = (i.dirs.up ?? [0, 1, 0]) as V3;
  const lev = (v: V3): V3 => {
    const k = dot(v, up);
    const w: V3 = [v[0] - up[0] * k, v[1] - up[1] * k, v[2] - up[2] * k];
    const l = Math.hypot(...w) || 1;
    return [w[0] / l, w[1] / l, w[2] / l];
  };
  const dr = (i.dirs.drift ?? null) as V3 | null;
  const vh = sf.vHor ?? 0;
  return {
    h: sf.alt,
    hDot: sf.vVert ?? 0,
    vFwd: dr ? vh * dot(dr, lev(nose)) : 0,
    vLat: dr ? vh * dot(dr, lev(right)) : 0,
    tilt: Math.acos(Math.min(Math.max(dot(top, up), -1), 1)),
    landed: !!sf.landed,
    g: (sf.gLocal ?? 0) * G0,
  };
}

/** The flown craft's landing radar's reading this frame (the Lander's — radar/landing.ts): its locks, the figures it
 *  holds; null: no such radar, or no ground below. */
function landingRadarNow(this: CameraController, i: FlightInfo): LandingRadarOut | null {
  const spec = LANDING_RADARS[fleet.active];
  const d = spec ? this.descentFigures(i) : null;
  return spec && d ? landingRadar(spec, d) : null;
}

/** The flown craft's panel this frame, null when its profile has none to show now. */
function craftPanelNow(this: CameraController, i: FlightInfo): CraftPanel | null {
  const me = fleet.active;
  const kind = VESSELS[me].space?.panel;
  if (kind === "descent") {
    const d = this.descentFigures(i);
    if (!d || d.landed) return null;
    const lr = i.landRadar ?? null;
    return descentPanel(
      { ...d, dvLeft: this.fcBudget().dv, tank: this.propellantOf(me)?.share ?? null, lr: lr ? { alt: lr.alt, vel: lr.vel } : null },
      t,
    );
  }
  if (kind === "mothership") {
    const R = this.ringInfo();
    const ports = VESSELS[me].ports.map((p, k) => {
      const l = fleet.links.find((q) => (q.a === me && q.pa === k) || (q.b === me && q.pb === k));
      const other = l ? (l.a === me ? l.b : l.a) : null;
      return { name: t(p.name), docked: other ? (other === "iss" ? "ISS" : VESSELS[other as VesselId].name) : null };
    });
    const tanks = fleet
      .assembly(me)
      .filter((v): v is VesselId => v !== "iss")
      .flatMap((v) => {
        const p = this.propellantOf(v);
        return p ? [{ name: VESSELS[v].name, share: p.share }] : [];
      });
    return mothershipPanel({ rpm: R?.rpm ?? 0, g: R?.g ?? 0, ports, massKg: fleet.massProps().mass, tanks }, t);
  }
  return null;
}

/** The Lander's hover calls: « 60 seconds », « 30 seconds » of hover left (Apollo's), each once as it is crossed. */
function hoverCallStep(this: CameraController) {
  if (VESSELS[fleet.active].space?.panel !== "descent") return;
  const sf = this.surfaceInfo() as Surface;
  if (!sf || sf.landed || sf.alt === undefined || sf.alt > 15000) {
    this.hoverSecPrev = undefined;
    return;
  }
  const now = hoverSeconds(this.fcBudget().dv, (sf.gLocal ?? 0) * G0);
  const call = this.hoverSecPrev !== undefined ? hoverCall(this.hoverSecPrev, now) : null;
  this.hoverSecPrev = now;
  if (call === 60) this.onPilotMessage?.(t("Sixty seconds of hover left"));
  else if (call === 30) this.onPilotMessage?.(t("Thirty seconds of hover left — land or abort"));
}

export function installCraftPanel(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { craftPanelNow, descentFigures, landingRadarNow, hoverCallStep });
}
