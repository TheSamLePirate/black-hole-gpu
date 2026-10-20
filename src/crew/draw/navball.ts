// The NAVBALL (PLAN-VAISSEAUX K4 — the spacecraft's PFD): the attitude against the orbit — the ball's sky the radial-out
// side, its ground the body's, seen from behind the craft (its nose at the centre) —, the orbital markers (prograde,
// retrograde, normal, anti-normal, radial out and in), the plan's next burn; the hold and the SAS, the speeds. From
// the K1/K4 blocks: the state (r, v) and the attitude (nose, up).
import type { V3 } from "../orbitmath";
import { C, fmt, type Pen, type Rect } from "./kit";
import type { Scene } from "./scene";

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const HOLD_FR: Record<string, string> = {
  none: "manuel",
  prograde: "prograde",
  retrograde: "rétrograde",
  radialOut: "radial ext.",
  radialIn: "radial int.",
  normal: "normal",
  antinormal: "anti-normal",
  target: "cible",
  antiTarget: "anti-cible",
  maneuver: "nœud",
};

/** the ball's image (the sky and the ground, the elevation's rings every 30°), cached by its attitude */
let ball: { key: string; c: HTMLCanvasElement } | null = null;
function ballImage(size: number, right: V3, up: V3, nose: V3, rad: V3, pro: V3): HTMLCanvasElement {
  const key = [size, ...right, ...up, ...nose, ...rad, ...pro].map((x) => x.toFixed(3)).join();
  if (ball?.key === key) return ball.c;
  const c = ball?.c ?? document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d")!;
  const img = x.createImageData(size, size);
  const east = unit(cross(rad, pro));
  const fwd = unit(cross(east, rad));
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const u = (2 * i) / size - 1,
        v = (2 * j) / size - 1;
      const q = u * u + v * v;
      if (q > 1) continue;
      const w = Math.sqrt(1 - q);
      // the direction under the pixel (craft frame: u right, −v up, w toward the nose)
      const d: V3 = [
        u * right[0] - v * up[0] + w * nose[0],
        u * right[1] - v * up[1] + w * nose[1],
        u * right[2] - v * up[2] + w * nose[2],
      ];
      const el = Math.asin(Math.max(-1, Math.min(1, dot(d, rad))));
      const az = Math.atan2(dot(d, east), dot(d, fwd));
      const sky = el >= 0;
      const ring =
        Math.abs(((el * 180) / Math.PI) % 30) < 0.6 || Math.abs(((az * 180) / Math.PI) % 45) < 0.5 * (1 + 2 * Math.abs(Math.sin(el)));
      const shade = 0.55 + 0.45 * w;
      let r = sky ? 40 : 120,
        g = sky ? 120 : 76,
        b = sky ? 200 : 40;
      if (ring) {
        r = g = b = sky ? 210 : 190;
      }
      if (Math.abs(el) < 0.012) {
        r = g = b = 255;
      }
      const k = (j * size + i) * 4;
      img.data[k] = r * shade;
      img.data[k + 1] = g * shade;
      img.data[k + 2] = b * shade;
      img.data[k + 3] = 255;
    }
  x.putImageData(img, 0, 0);
  ball = { key, c };
  return c;
}

export function drawNavball(p: Pen, r: Rect, sc: Scene, compact = false) {
  p.panel(r, compact ? "ATTITUDE" : undefined);
  const s = sc.snap;
  const st = s?.state,
    at = s?.att;
  if (!st || !at) {
    p.text("Attitude ou état orbital non reçus", r.x + r.w / 2, r.y + r.h / 2, { col: C.dim, size: 13, align: "center" });
    return;
  }
  const nose = unit(at.nose),
    up = unit(at.up);
  const right = unit(cross(nose, up));
  const rad = unit(st.r);
  const pro = unit(st.v);
  const nrm = unit(cross(st.r, st.v));
  const R = Math.max(30, Math.min(r.w * (compact ? 0.42 : 0.3), r.h * 0.4));
  const cx = r.x + (compact ? r.w / 2 : r.w * 0.38),
    cy = r.y + r.h / 2 + (compact ? 8 : 0);
  const size = Math.min(420, Math.round(R * 2 * Math.min(devicePixelRatio || 1, 1.5)));
  p.c.save();
  p.circle(cx, cy, R);
  p.c.clip();
  p.c.drawImage(ballImage(size, right, up, nose, rad, pro), cx - R, cy - R, 2 * R, 2 * R);
  p.c.restore();
  p.circle(cx, cy, R);
  p.stroke("#0a1219", 3);
  p.circle(cx, cy, R + 2);
  p.stroke(C.grid2, 1);
  // the markers: a direction on the ball (front hemisphere)
  const at3 = (d: V3): [number, number, boolean] => {
    const x = dot(d, right),
      y = dot(d, up),
      z = dot(d, nose);
    return [cx + x * R, cy - y * R, z > 0];
  };
  const marker = (d: V3, kind: "pro" | "retro" | "nrm" | "anti" | "out" | "in" | "node") => {
    const [x, y, front] = at3(d);
    if (!front) return;
    const col =
      kind === "pro" || kind === "retro" ? "#ffd84a" : kind === "nrm" || kind === "anti" ? C.magenta : kind === "node" ? "#4d8cff" : C.cyan;
    p.circle(x, y, 9);
    p.stroke("#03070a", 4);
    p.circle(x, y, 9);
    p.stroke(col, 2);
    if (kind === "pro" || kind === "out" || kind === "nrm" || kind === "node") {
      p.seg(x, y - 9, x, y - 15, col, 2);
      p.seg(x - 9, y, x - 15, y, col, 2);
      p.seg(x + 9, y, x + 15, y, col, 2);
    } else {
      p.seg(x - 6, y - 6, x + 6, y + 6, col, 2);
      p.seg(x + 6, y - 6, x - 6, y + 6, col, 2);
    }
    if (kind === "pro" || kind === "nrm" || kind === "out" || kind === "node") {
      p.circle(x, y, 2);
      p.fill(col);
    }
  };
  marker(pro, "pro");
  marker([-pro[0], -pro[1], -pro[2]], "retro");
  marker(nrm, "nrm");
  marker([-nrm[0], -nrm[1], -nrm[2]], "anti");
  marker(rad, "out");
  marker([-rad[0], -rad[1], -rad[2]], "in");
  const n = s.nodes?.[0];
  if (n) {
    const radial = unit(cross(nrm, pro));
    const dv: V3 = [
      n.dv[0] * pro[0] + n.dv[1] * nrm[0] + n.dv[2] * radial[0],
      n.dv[0] * pro[1] + n.dv[1] * nrm[1] + n.dv[2] * radial[1],
      n.dv[0] * pro[2] + n.dv[1] * nrm[2] + n.dv[2] * radial[2],
    ];
    if (Math.hypot(...dv) > 0) marker(unit(dv), "node");
  }
  // the craft's own mark: the nose at the centre
  p.seg(cx - 28, cy, cx - 8, cy, C.amber, 3);
  p.seg(cx + 8, cy, cx + 28, cy, C.amber, 3);
  p.seg(cx - 8, cy, cx, cy + 7, C.amber, 3);
  p.seg(cx + 8, cy, cx, cy + 7, C.amber, 3);
  // the readouts
  const A = s.auto;
  const hold = HOLD_FR[A?.hold ?? "none"] ?? A?.hold ?? "—";
  const pitch = (Math.asin(Math.max(-1, Math.min(1, dot(nose, rad)))) * 180) / Math.PI;
  if (compact) {
    p.text(`${A?.sas ? "SAS" : "SAS coupé"} · ${hold}`, r.x + 12, r.y + r.h - 10, {
      col: A?.sas ? C.green : C.amber,
      size: 11,
      weight: 700,
    });
    return;
  }
  const x0 = r.x + r.w * 0.72;
  let y = r.y + 40;
  const row = (name: string, value: string, col: string = C.text) => {
    p.text(name, x0, y, { col: C.dim, size: 11 });
    p.text(value, r.x + r.w - 14, y, { col, size: 13, weight: 700, align: "right" });
    y += 24;
  };
  p.text("BOULE DE NAVIGATION · ORBITE", x0, r.y + 18, { col: C.cyan, size: 11, weight: 700 });
  row("SAS", A?.sas ? "actif" : "coupé", A?.sas ? C.green : C.amber);
  row("Maintien", hold, A?.hold && A.hold !== "none" ? C.green : C.text);
  row("Autopilote", A?.auto && A.auto !== "none" ? A.auto : "—");
  row("Assiette / horizon", `${fmt(pitch, 1)}°`);
  row("Vitesse orbitale", `${fmt(Math.hypot(...st.v) * 1000)} m/s`);
  row("Vitesse radiale", `${fmt(dot(st.v, rad) * 1000, 1)} m/s`);
  if (n) row("Prochaine poussée", `${fmt(Math.hypot(...n.dv), 1)} m/s`, "#4d8cff");
  // the legend
  y += 8;
  for (const [col, t] of [
    ["#ffd84a", "prograde · rétrograde"],
    [C.magenta, "normal · anti-normal"],
    [C.cyan, "radial ext. · int."],
    ["#4d8cff", "nœud de manœuvre"],
  ] as const) {
    p.circle(x0 + 5, y - 4, 5);
    p.stroke(col, 2);
    p.text(t, x0 + 16, y, { col: C.dim, size: 10 });
    y += 17;
  }
}
