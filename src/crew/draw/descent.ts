// The DESCENT view (AUDIT-CREW priority 4 — the Lander's, a craft that lands): its height over the ground on a tape,
// its vertical and horizontal speeds, the hover or the landing flown, the time to the ground; the landing point seen
// from above about the craft (its distance, how far it can still be moved — the LPD's reach), the propellant. Landed:
// said so, and where. From the `desc`, `land`, `geo`, `state`, `budget` blocks.
import { L, Lp } from "../lang";
import { autoWords } from "../../net/crewcmd";
import { C, clamp, D, dur, fmt, type Pen, type Rect } from "./kit";
import { bodyName } from "./orbit";
import type { Scene } from "./scene";

/** the landing point from the craft over a sphere of radius R [m]: east, north [m] (a few kilometres: flat) */
function offsetOf(lat0: number, lon0: number, lat: number, lon: number, R: number): [number, number] {
  const dl = (((lon - lon0 + 540) % 360) - 180) * D;
  return [dl * Math.cos(lat0 * D) * R, (lat - lat0) * D * R];
}

export function drawDescent(p: Pen, r: Rect, sc: Scene) {
  p.panel(r);
  const s = sc.snap;
  const d = s?.desc;
  const u = sc.u;
  const landed = s?.craft?.status === "landed";
  if (!s || (!d && !landed)) {
    p.text(L("Pas de descente en cours", "No descent under way"), r.x + r.w / 2, r.y + r.h / 2, { col: C.dim, size: 13, align: "center" });
    p.text(
      L("(le vaisseau est loin d’un sol — elle s’affiche sous 60 km)", "(the craft is far from a ground — it shows below 60 km)"),
      r.x + r.w / 2,
      r.y + r.h / 2 + 18,
      { col: C.dim, size: 10, align: "center" },
    );
    return;
  }
  const where = bodyName(s.craft?.where || s.body);
  if (landed) {
    p.text(L(`POSÉ · ${where.toUpperCase()}`, `LANDED · ${where.toUpperCase()}`), r.x + r.w / 2, r.y + r.h / 2 - 8, {
      col: C.green,
      size: 22,
      align: "center",
      weight: 800,
    });
    if (s.geo)
      p.text(`${fmt(s.geo.lat, 4)}° ${fmt(s.geo.lon, 4)}°`, r.x + r.w / 2, r.y + r.h / 2 + 18, { col: C.text, size: 12, align: "center" });
    return;
  }
  const D0 = d!;
  // the height tape (square-root scale: the last metres wide), the craft's height, its trend over 10 s
  const tape = { x: r.x + 18, y: r.y + 36, w: 64, h: r.h - 60 };
  const top = Math.max(100, (D0.agl ?? 0) * 1.6);
  const Y = (h: number) => tape.y + tape.h * (1 - Math.sqrt(clamp(h, 0, top) / top));
  p.round(tape.x, tape.y, tape.w, tape.h, 6);
  p.fill("#0c1a22");
  p.text(L("HAUTEUR", "HEIGHT"), tape.x, tape.y - 10, { col: C.cyan, size: 10, weight: 700 });
  for (const h of [0, 10, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000].filter((h) => h <= top)) {
    const y = Y(h);
    p.seg(tape.x + tape.w - 10, y, tape.x + tape.w, y, C.dim, 1);
    p.text(fmt(u.alt(h)), tape.x + tape.w - 13, y + 3, { col: C.dim, size: 9, align: "right" });
  }
  if (D0.agl !== null) {
    const y = Y(D0.agl);
    p.seg(tape.x, y, tape.x + tape.w, y, C.white, 2.5);
    const y10 = Y(D0.agl + D0.vz * 10);
    p.seg(tape.x + 8, y, tape.x + 8, y10, D0.vz < -5 ? C.amber : C.green, 4);
  }
  // the figures
  const x0 = tape.x + tape.w + 24,
    w0 = Math.min(r.w * 0.42, 360);
  let y = r.y + 42;
  const row = (k: string, v: string, col: string = C.text, big = false) => {
    p.text(k, x0, y, { col: C.dim, size: 11 });
    p.text(v, x0 + w0, y, { col, size: big ? 18 : 13, weight: 700, align: "right" });
    y += big ? 30 : 23;
  };
  p.text(`${L("DESCENTE", "DESCENT")} · ${where.toUpperCase()}`, x0, r.y + 20, { col: C.cyan, size: 11, weight: 700 });
  row(L("Hauteur sol", "Height AGL"), D0.agl === null ? "—" : `${fmt(u.alt(D0.agl))} ${u.altName.toLowerCase()}`, C.white, true);
  row(
    L("Vitesse verticale", "Vertical speed"),
    `${D0.vz > 0 ? "▲" : D0.vz < 0 ? "▼" : ""} ${fmt(Math.abs(u.vs(D0.vz)), Math.abs(D0.vz) < 10 ? 1 : 0)} ${u.vsName.toLowerCase()}`,
    D0.vz < -5 && (D0.agl ?? 1e9) < 100 ? C.red : D0.vz < -20 ? C.amber : C.text,
  );
  row(
    L("Vitesse horizontale", "Horizontal speed"),
    `${fmt(u.spd(D0.vh), D0.vh < 10 ? 1 : 0)} ${u.spdName.toLowerCase()}`,
    D0.vh > 2 && (D0.agl ?? 1e9) < 50 ? C.amber : C.text,
  );
  row(L("Au sol dans", "Ground in"), dur(D0.ttg), D0.ttg !== null && D0.ttg < 15 ? C.amber : C.text);
  const mode = D0.hover
    ? L("STATIONNAIRE", "HOVER")
    : D0.auto && D0.auto !== "none"
      ? Lp(autoWords(D0.auto)).toUpperCase()
      : L("MANUEL", "MANUAL");
  row(L("Pilote", "Flown by"), mode, D0.hover ? C.green : D0.auto === "land" ? C.cyan : C.amber);
  const B = s.budget;
  if (B)
    row(
      L("Ergols · Δv", "Propellant · Δv"),
      `${B.prop === null ? "—" : `${fmt(B.prop * 100)} %`} · ${B.dv === null ? "∞" : `${fmt(B.dv)} m/s`}`,
    );
  // the landing point from above, about the craft (north up), the LPD's reach
  const site = s.land;
  const box = { x: x0 + w0 + 24, y: r.y + 30, w: r.x + r.w - (x0 + w0 + 24) - 14, h: r.h - 44 };
  if (box.w < 140) return;
  p.text(L("POINT D’ATTERRISSAGE", "LANDING POINT"), box.x, r.y + 20, { col: C.cyan, size: 11, weight: 700 });
  const cx = box.x + box.w / 2,
    cy = box.y + box.h / 2;
  const R = Math.min(box.w, box.h) / 2 - 10;
  p.circle(cx, cy, R);
  p.fill("#0c1a22");
  p.stroke(C.grid2, 1);
  const reach = D0.lpd?.reach ?? 0;
  const off = site && s.geo && s.state ? offsetOf(s.geo.lat, s.geo.lon, site.lat, site.lon, s.state.radius * 1000) : null;
  const span = Math.max(reach * 1.2, off ? Math.hypot(...off) * 1.3 : 0, 500);
  const k = R / span;
  if (reach > 0 && off) {
    p.circle(cx + off[0] * k, cy - off[1] * k, reach * k);
    p.stroke(`${C.amber}88`, 1.2, [4, 4]);
  }
  // the craft at the centre, its speed over the ground
  p.circle(cx, cy, 6);
  p.fill(C.white);
  if (off) {
    const q: [number, number] = [cx + off[0] * k, cy - off[1] * k];
    p.seg(cx, cy, q[0], q[1], `${C.green}88`, 1, [3, 4]);
    p.star(q[0], q[1], 9, site!.moved ? C.amber : C.green, true);
    p.text(site!.name || (site!.moved ? "LPD" : L("point", "point")), q[0] + 12, q[1] + 4, {
      col: site!.moved ? C.amber : C.green,
      size: 11,
      weight: 700,
    });
  }
  p.text(
    `${D0.lpd ? `${fmt(u.alt(D0.lpd.dist))} ${u.altName.toLowerCase()}` : "—"}${reach ? ` · ${L("portée LPD", "LPD reach")} ${fmt(u.alt(reach))} ${u.altName.toLowerCase()}` : ""}`,
    box.x,
    box.y + box.h + 8,
    { col: C.text, size: 11 },
  );
  p.text("N", cx, cy - R + 14, { col: C.dim, size: 10, align: "center", weight: 700 });
}
