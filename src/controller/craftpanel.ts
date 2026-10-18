// The CameraController — the spacecraft's own HUD panels (docs/PLAN-VAISSEAUX-AAA.md, X4; game/craftpanel.ts): the
// figures gathered for the flown craft's profile (VESSELS.*.space.panel), and the Lander's hover calls (« 60 », « 30 »).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { fleet } from "../fleet";
import { type CraftPanel, descentPanel, hoverCall, hoverSeconds, mothershipPanel } from "../game/craftpanel";
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
    hoverCallStep: typeof hoverCallStep;
  }
}

type Surface = { alt?: number; vVert?: number; vHor?: number; gLocal?: number; landed?: boolean } | null;

/** The flown craft's panel this frame, null when its profile has none to show now. */
function craftPanelNow(this: CameraController, i: FlightInfo): CraftPanel | null {
  const me = fleet.active;
  const kind = VESSELS[me].space?.panel;
  if (kind === "descent") {
    const sf = this.surfaceInfo() as Surface;
    if (!sf || sf.landed || sf.alt === undefined || sf.alt > 15000) return null;
    // (the speed over the ground split along the craft's nose and across, both level)
    const S = i.S as unknown as number[][];
    const nose: V3 = [S[0]![2]!, S[1]![2]!, S[2]![2]!];
    const right: V3 = [-S[0]![0]!, -S[1]![0]!, -S[2]![0]!];
    const up = (i.dirs.up ?? [0, 1, 0]) as V3;
    const lev = (v: V3): V3 => {
      const k = dot(v, up);
      const w: V3 = [v[0] - up[0] * k, v[1] - up[1] * k, v[2] - up[2] * k];
      const l = Math.hypot(...w) || 1;
      return [w[0] / l, w[1] / l, w[2] / l];
    };
    const dr = (i.dirs.drift ?? null) as V3 | null;
    const vh = sf.vHor ?? 0;
    const vFwd = dr ? vh * dot(dr, lev(nose)) : 0;
    const vLat = dr ? vh * dot(dr, lev(right)) : 0;
    const g = (sf.gLocal ?? 0) * G0;
    return descentPanel(
      { h: sf.alt, hDot: sf.vVert ?? 0, vFwd, vLat, dvLeft: this.fcBudget().dv, g, tank: this.propellantOf(me)?.share ?? null },
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
  Object.assign(C.prototype, { craftPanelNow, hoverCallStep });
}
