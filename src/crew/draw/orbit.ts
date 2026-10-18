// The ORBIT view (PLAN-VAISSEAUX K2): the craft's conic about its body, seen from above its plane — the body to
// scale, its periapsis and apoapsis with their heights, the craft, the plan's burns where they fall on the orbit, the
// free path when it leaves (another sphere); its figures beside it. From the K1 state alone (orbitmath.ts).
import { type Conic, conicOf, conicPoints, inPlane, nuAfter, radiusAt } from "../orbitmath";
import { C, dur, fmt, type Pen, type Rect } from "./kit";
import type { Scene } from "./scene";

export const BODY_FR: Record<string, string> = {
  sun: "Soleil",
  mercury: "Mercure",
  venus: "Vénus",
  earth: "Terre",
  moon: "Lune",
  mars: "Mars",
  phobos: "Phobos",
  deimos: "Déimos",
  jupiter: "Jupiter",
  io: "Io",
  europa: "Europe",
  ganymede: "Ganymède",
  callisto: "Callisto",
  saturn: "Saturne",
  titan: "Titan",
  enceladus: "Encelade",
  uranus: "Uranus",
  neptune: "Neptune",
  triton: "Triton",
  pluto: "Pluton",
  wormhole: "Trou de ver",
  gargantua: "Gargantua",
};
export const bodyName = (id: string) => BODY_FR[id] ?? (id ? id[0]!.toUpperCase() + id.slice(1) : "—");

const km = (x: number) => (Math.abs(x) >= 1e6 ? `${fmt(x / 1e6, 2)} Mkm` : `${fmt(x)} km`);

/** The view; `compact` a dashboard's panel (its figures fewer). */
export function drawOrbit(p: Pen, r: Rect, sc: Scene, compact = false): Conic | null {
  p.panel(r, compact ? "ORBITE" : undefined);
  const st = sc.snap?.state;
  if (!st) {
    p.text("Pas d’orbite reçue", r.x + r.w / 2, r.y + r.h / 2, { col: C.dim, size: 13, align: "center" });
    p.text("(le pilote suit un appareil sans état orbital, ou un pilote plus ancien)", r.x + r.w / 2, r.y + r.h / 2 + 18, {
      col: C.dim,
      size: 10,
      align: "center",
    });
    return null;
  }
  const o = conicOf(st.r, st.v, st.mu);
  if (!o) return null;
  const R = st.radius;
  const rNow = Math.hypot(...st.r);
  // the scale: the whole ellipse (or a hyperbola's arm to twice the craft's distance), the body seen
  const rMax = o.e < 1 ? Math.min(o.ra, Math.max(st.soi || Infinity, rNow * 1.3)) : Math.max(rNow * 2, o.rp * 4);
  const figW = compact ? 0 : Math.min(260, r.w * 0.32);
  const area: Rect = { x: r.x + 10, y: r.y + (compact ? 26 : 10), w: r.w - 20 - figW, h: r.h - (compact ? 36 : 20) };
  // (the ellipse's centre in the middle: x from −ra to rp)
  const xMin = o.e < 1 ? -o.ra : -rMax,
    xMax = o.e < 1 ? o.rp : o.rp + 0.2 * rMax,
    yMax = o.e < 1 ? o.a * Math.sqrt(1 - o.e * o.e) : rMax;
  const spanX = Math.max(xMax - xMin, 2 * R * 1.2),
    spanY = Math.max(2 * yMax, 2 * R * 1.2);
  const k = Math.min(area.w / spanX, area.h / spanY) * 0.9;
  const cx = area.x + area.w / 2 - ((xMin + xMax) / 2) * k,
    cy = area.y + area.h / 2;
  // (the periapsis up: x along the screen's −y)
  const S = (q: [number, number]): [number, number] => [cx + q[1] * k, cy - q[0] * k];
  const [bx, by] = S([0, 0]);
  // the body to scale
  p.circle(bx, by, Math.max(R * k, 3));
  p.fill("#12364a");
  p.stroke(C.cyan, 1);
  p.text(bodyName(st.body), bx, by + 4, { col: C.white, size: 11, align: "center", weight: 700 });
  // the conic: below the ground red
  const pts = conicPoints(o, rMax).map(S);
  p.path(pts);
  p.glow(o.rp < R ? C.amber : C.cyan, 1.6);
  // its periapsis and apoapsis
  const mark = (nu: number, name: string, col: string) => {
    const rr = radiusAt(o, nu);
    if (!Number.isFinite(rr)) return;
    const [x, y] = S([rr * Math.cos(nu), rr * Math.sin(nu)]);
    p.circle(x, y, 4);
    p.fill(col);
    p.text(`${name} ${km(rr - R)}`, x + 8, y + 4, { col, size: 11, weight: 700, bg: "#050a0ec0" });
  };
  mark(0, "Pe", o.rp < R ? C.red : C.green);
  if (o.e < 1) mark(Math.PI, "Ap", C.green);
  // the free path's other pieces (a sphere left: drawn in its body's frame no more — only this sphere's)
  const seg = sc.snap?.traj?.free.find((s) => s.body === st.body);
  if (seg && o.e >= 1) {
    p.path(seg.pts.map((q) => S(inPlane(o, q))));
    p.stroke(C.cyan, 1, [3, 4]);
  }
  // the plan's burns where they fall
  for (const n of sc.snap?.nodes ?? []) {
    if (!(n.in > 0)) continue;
    const nu = nuAfter(o, n.in);
    const rr = radiusAt(o, nu);
    if (!Number.isFinite(rr)) continue;
    const [x, y] = S([rr * Math.cos(nu), rr * Math.sin(nu)]);
    p.star(x, y, 6, C.magenta, true);
    p.text(`Δv ${fmt(Math.hypot(...n.dv))} m/s · ${dur(n.in)}`, x + 9, y - 6, { col: C.magenta, size: 10, bg: "#050a0ec0" });
  }
  // the craft
  const [sx, sy] = S(inPlane(o, st.r));
  p.circle(sx, sy, 6);
  p.fill(C.white);
  p.stroke("#03070a", 2);
  // the figures
  if (!compact) {
    const x0 = r.x + r.w - figW + 4;
    let y = r.y + 42;
    const row = (name: string, value: string, col: string = C.text) => {
      p.text(name, x0, y, { col: C.dim, size: 11 });
      p.text(value, r.x + r.w - 14, y, { col, size: 13, weight: 700, align: "right" });
      y += 24;
    };
    p.text(`ORBITE · ${bodyName(st.body).toUpperCase()}`, x0, r.y + 16, { col: C.cyan, size: 11, weight: 700 });
    row("Périapside", km(o.rp - R), o.rp < R ? C.red : C.text);
    row("Apoapside", o.e < 1 ? km(o.ra - R) : "libre", o.e >= 1 ? C.amber : C.text);
    row("Excentricité", fmt(o.e, 4));
    row("Inclinaison", `${fmt((o.inc * 180) / Math.PI, 2)}°`);
    row("Demi-grand axe", Number.isFinite(o.a) ? km(Math.abs(o.a)) : "∞");
    row("Période", dur(o.period));
    row("Altitude", km(rNow - R));
    row("Vitesse", `${fmt(Math.hypot(...st.v), 3)} km/s`);
    const nx = sc.snap?.next;
    if (nx) row("Prochain", `${nx.name || nx.kind} · ${dur(nx.in)}`, C.amber);
    if (sc.snap?.traj?.fate === "impact") row("Sort", `impact · ${bodyName(sc.snap.traj.hit)}`, C.red);
  }
  return o;
}
