// The SYSTEM MAP view (PLAN-VAISSEAUX K3): the solar system or Gargantua's in 3D — orientable (dragged), zoomed (pinched,
// the wheel), centred on the craft's body, the craft or the Sun, true or logarithmic scale, the prediction scrolled
// ahead. WebGPU when the device has it, else the canvas (sys3d/). The labels, the legend and the scale over either.
import { defaultCamera, type MapCamera, project } from "../sys3d/camera";
import { drawSystem2d } from "../sys3d/draw2d";
import type { SystemRenderer } from "../sys3d/gpu";
import { type Focus, systemScene } from "../sys3d/scene";
import { C, dur, fmt, type Pen, type Rect } from "./kit";
import { bodyName } from "./orbit";
import type { Scene } from "./scene";

export interface SystemMapState {
  cam: MapCamera;
  focus: Focus;
  /** the prediction scrolled ahead [s] */
  ahead: number;
}
export const defaultMapState = (): SystemMapState => ({ cam: defaultCamera(), focus: "body", ahead: 0 });

const lengthLabel = (x: number, unit: "km" | "M") =>
  unit === "M"
    ? `${fmt(x, x < 10 ? 1 : 0)} M`
    : x >= 1.496e8 * 0.5
      ? `${fmt(x / 1.496e8, x < 1.496e9 ? 2 : 1)} ua`
      : x >= 1e6
        ? `${fmt(x / 1e6, 1)} Mkm`
        : `${fmt(x)} km`;

/** The view; returns the longest prediction it can scroll [s] (the slider's end). */
export function drawSystemMap(p: Pen, r: Rect, sc: Scene, st: SystemMapState, R: SystemRenderer, dpr: number): number {
  p.panel(r);
  const scene = systemScene(sc.snap, st.focus, st.ahead);
  if (!scene) {
    p.text("Pas de carte du système reçue", r.x + r.w / 2, r.y + r.h / 2, { col: C.dim, size: 13, align: "center" });
    p.text(
      "(le pilote suit un avion, ou un pilote plus ancien — les corps arrivent une fois par seconde)",
      r.x + r.w / 2,
      r.y + r.h / 2 + 18,
      {
        col: C.dim,
        size: 10,
        align: "center",
      },
    );
    return 0;
  }
  R.start();
  const P = project(scene, st.cam, r.w, r.h);
  const c = p.c;
  c.save();
  p.clip(r);
  c.translate(r.x, r.y);
  if (R.gpu) {
    R.gpu.render(P, r.w, r.h, dpr);
    c.drawImage(R.gpu.canvas, 0, 0, r.w, r.h);
  } else drawSystem2d(c, P);
  // the labels: the bodies (the big ones first, no two on one another), the marks
  const taken: [number, number, number, number][] = [];
  const free = (x: number, y: number, w: number, h: number) => {
    if (taken.some((t) => x < t[0] + t[2] && x + w > t[0] && y < t[1] + t[3] && y + h > t[1])) return false;
    taken.push([x, y, w, h]);
    return true;
  };
  for (const m of P.marks) {
    if (m.kind === "craft" || m.kind === "ghost") {
      c.beginPath();
      c.arc(m.x, m.y, m.kind === "craft" ? 5 : 4, 0, Math.PI * 2);
      c.fillStyle = m.kind === "craft" ? C.white : "transparent";
      c.fill();
      c.strokeStyle = m.colour;
      c.lineWidth = 2;
      c.stroke();
    } else if (m.kind === "node") p.star(m.x, m.y, 6, C.magenta, true);
    else if (m.kind === "target") {
      c.beginPath();
      c.arc(m.x, m.y, 9, 0, Math.PI * 2);
      c.strokeStyle = C.amber;
      c.lineWidth = 1.5;
      c.stroke();
    }
    const w = p.width(m.label, 11, 700) + 8;
    if (free(m.x + 8, m.y - 16, w, 15)) p.text(m.label, m.x + 10, m.y - 5, { col: m.colour, size: 11, weight: 700, bg: "#050a0ec0" });
  }
  for (const d of [...P.discs].sort((a, b) => b.r - a.r)) {
    if (d.x < -50 || d.y < -50 || d.x > r.w + 50 || d.y > r.h + 50) continue;
    const name = bodyName(d.id);
    const w = p.width(name, 10, 600) + 6;
    const y = d.y + d.r + 12;
    if (free(d.x - w / 2, y - 10, w, 13))
      p.text(name, d.x, y, { col: d.shade === "star" ? C.amber : C.text, size: 10, weight: 600, align: "center" });
  }
  // the scale bar (true scale at the focus), the mode
  if (!st.cam.log) {
    const target = r.w * 0.18;
    const raw = target / P.k;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const nice = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= raw * 0.7) ?? pow;
    const px = nice * P.k;
    p.seg(14, r.h - 16, 14 + px, r.h - 16, C.white, 2);
    p.text(lengthLabel(nice, scene.unit), 14 + px / 2, r.h - 22, { col: C.white, size: 10, align: "center" });
  }
  const side = scene.side === "hole" ? "GARGANTUA" : "SYSTÈME SOLAIRE";
  const focus =
    scene.side === "hole"
      ? "Gargantua"
      : st.focus === "sun"
        ? "Soleil"
        : st.focus === "craft"
          ? "vaisseau"
          : bodyName(sc.snap?.state?.body ?? "");
  p.text(`${side} · ${st.cam.log ? "échelle log" : "échelle vraie"} · centre ${focus}`, 12, 18, { col: C.cyan, size: 11, weight: 700 });
  p.text(R.kind === "webgpu" ? "WebGPU" : R.kind === "canvas" ? "canvas (sans WebGPU)" : "…", r.w - 12, 18, {
    col: C.dim,
    size: 10,
    align: "right",
  });
  if (st.ahead > 0 && scene.side === "ours") p.text(`prédiction +${dur(st.ahead)}`, 12, 34, { col: C.cyan, size: 11 });
  // the legend
  const legend: [string, string][] =
    scene.side === "hole"
      ? [
          ["#ffbf4d", "orbite des photons"],
          ["#ff5c4d", "ISCO"],
          ["#9a73ff", "ergosphère"],
          ["#3fd8ff", "chute libre"],
        ]
      : [
          ["#3fd8ff", "trajectoire libre"],
          ["#ff5ce1", "trajectoire planifiée · poussées"],
          ["#8cb3cc", "sphère d’influence"],
        ];
  // (top right, under the renderer's name: the zoom's buttons hold the bottom right)
  let ly = 36;
  const lw = Math.max(...legend.map(([, n]) => p.width(n, 10))) + 30;
  for (const [col, name] of legend) {
    p.seg(r.w - lw - 6, ly - 3, r.w - lw + 12, ly - 3, col, 2);
    p.text(name, r.w - 12, ly + 1, { col: C.dim, size: 10, align: "right" });
    ly += 15;
  }
  c.restore();
  return scene.span;
}
