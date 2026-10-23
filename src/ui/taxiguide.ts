// The taxi's guidance in the view (docs/PLAN-A320.md, A14): the route ahead (controller/a320taxi.ts) drawn on the
// ground as a magenta line — a "follow the greens" of our own, from 18 m ahead of the reference point (nearer, the nose
// hides it from the seat) to 400 m on —, and a small panel over the view: the next taxiway, the turn's side and
// distance, the speed to roll at, in the player's units (ui/unitsys.ts). The ground's points projected by the view's
// own camera (ship.ts cabinProject: the ship's frame — x left, y up, z the nose).

import type { CameraController } from "../controls";
import { local } from "../game/airportnet";
import { t, tf } from "../i18n";
import { unitsFor, type UnitSys } from "./unitsys";

type V3 = [number, number, number];
const KT = 0.514444;
/** the ground under the A320's reference point [m, ship frame] (its gear's height — gear.ts) */
const GROUND_Y = -1.55;

export class TaxiGuide {
  private cv = Object.assign(document.createElement("canvas"), { className: "taxi-line" });
  private panel = Object.assign(document.createElement("div"), { className: "taxi-panel" });

  constructor() {
    this.cv.dataset.testid = "taxi-line";
    this.panel.dataset.testid = "taxi-panel";
    document.body.append(this.cv, this.panel);
  }

  /** A frame: shown on the ground with a route to roll (none: hidden). */
  frame(c: CameraController, project: ((p: V3) => [number, number] | null) | null, view: DOMRect, units: UnitSys | undefined) {
    const T = c.a320Taxi;
    const g = c.geoNow();
    // (once cleared: the way out after the tower's word, the way in at once)
    const on = !!(T?.route && T.cleared && T.cue && !T.cue.done && g && (c.rolling || c.ourLanded) && project);
    this.cv.style.display = this.panel.style.display = on ? "block" : "none";
    if (!on) return;
    const cue = T!.cue!;
    const U = unitsFor({ units });
    // ---- the panel
    const next = cue.next;
    const turn = next ? (next.turn === "left" ? t("left") : t("right")) : "";
    this.panel.textContent = next
      ? tf(
          "{0} {1} in {2} onto {3} · {4}",
          next.turn === "left" ? "↰" : "↱",
          turn,
          U.fAlt(next.dist),
          next.name ?? t("the apron"),
          U.fSpd(cue.adviseKt * KT),
        )
      : tf("{0} left · {1}", U.fAlt(cue.toEnd), U.fSpd(cue.adviseKt * KT));
    // ---- the line: the route's points ahead, every 4 m, into the ship's frame
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = Math.round(view.width * dpr),
      H = Math.round(view.height * dpr);
    if (this.cv.width !== W || this.cv.height !== H) Object.assign(this.cv, { width: W, height: H });
    Object.assign(this.cv.style, { left: `${view.left}px`, top: `${view.top}px`, width: `${view.width}px`, height: `${view.height}px` });
    const ctx = this.cv.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    const at = { lat: g!.lat, lon: g!.lon };
    const h = (c.attitudeNow() as { heading?: number }).heading ?? g!.track;
    const ship = (e: number, n: number): V3 => [-e * Math.cos(h) + n * Math.sin(h), GROUND_Y, e * Math.sin(h) + n * Math.cos(h)];
    const pts = T!.route!.pts.slice(cue.i);
    const scr: [number, number, number][] = [];
    let run = 0;
    for (let k = 0; k < pts.length - 1 && run < 400; k++) {
      const [e0, n0] = local(at, pts[k]!.lat, pts[k]!.lon);
      const [e1, n1] = local(at, pts[k + 1]!.lat, pts[k + 1]!.lon);
      const L = Math.hypot(e1 - e0, n1 - n0);
      for (let s = 0; s < L && run < 400; s += 4, run += 4) {
        const p = ship(e0 + ((e1 - e0) * s) / L, n0 + ((n1 - n0) * s) / L);
        if (p[2] < 18) continue;
        const q = project!(p);
        if (q && Math.abs(q[0]) < 1.5 && Math.abs(q[1]) < 1.5) scr.push([((q[0] + 1) / 2) * W, ((1 - q[1]) / 2) * H, p[2]]);
        else if (scr.length) scr.push([Number.NaN, 0, 0]);
      }
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let k = 1; k < scr.length; k++) {
      const [x0, y0, z0] = scr[k - 1]!,
        [x1, y1] = scr[k]!;
      if (Number.isNaN(x0) || Number.isNaN(x1)) continue;
      // (nearer, wider and stronger — a line painted on the ground, seen in perspective)
      ctx.strokeStyle = `rgba(255, 77, 255, ${Math.max(0.25, 0.9 - z0 / 500)})`;
      ctx.lineWidth = Math.max(1.5, (60 / Math.max(z0, 18)) * dpr * 3);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
}
