// The primary flight display: the attitude over its sky and ground, the speed and altitude tapes with their
// bugs and trends, the vertical speed, the heading, the mode annunciator, the ILS needles and the radio altitude.
import { C, clamp, D, deg360, fmt, MONO, type Pen, wrapPi, type Rect } from "./kit";
import type { Scene } from "./scene";

const ok = Number.isFinite;

function fma(p: Pen, r: Rect, sc: Scene) {
  const a = sc.snap?.auto;
  const cells: [string, string, string][] = [];
  const spd = a?.ab ? ["AB", C.amber] : a?.spd != null ? [`SPD ${fmt(sc.u.spd(a.spd))}`, C.green] : ["MAN", C.dim];
  const lat = a?.lnav
    ? ["LNAV", C.magenta]
    : a?.order
      ? [a.order, C.green]
      : a?.hdg != null
        ? [`HDG ${String(Math.round(deg360(a.hdg * D) / 1)).padStart(3, "0")}`, C.green]
        : a?.hold && a.hold !== "none"
          ? [a.hold.toUpperCase(), C.green]
          : ["—", C.dim];
  const vert = a?.vnav
    ? [`VNAV ${(sc.snap?.nav?.phase ?? "").toUpperCase()}`.trim(), C.magenta]
    : a?.alt != null
      ? [`ALT ${fmt(sc.u.alt(a.alt))}`, C.green]
      : a?.auto && a.auto !== "none"
        ? [a.auto.toUpperCase(), C.green]
        : ["—", C.dim];
  const assist = a?.assist ? a.assist.toUpperCase() : a?.sas ? "SAS" : "—";
  cells.push(
    ["A/THR", spd[0]!, spd[1]!],
    ["LAT", lat[0]!, lat[1]!],
    ["VERT", vert[0]!, vert[1]!],
    ["ASSIST", assist, a?.assist ? C.cyan : C.dim],
  );
  if (r.w > 520) cells.push(["MODE", (a?.mode || sc.own?.kind || "—").toUpperCase(), C.text]);
  const w = r.w / cells.length;
  const fs = clamp(r.h * 0.42, 9, 14);
  cells.forEach(([k, v, col], i) => {
    const x = r.x + i * w;
    if (i) p.seg(x, r.y + 4, x, r.y + r.h - 4, C.grid2);
    p.text(k, x + w / 2, r.y + fs * 0.95, { col: C.dim, size: fs * 0.72, align: "center", weight: 600 });
    p.text(v, x + w / 2, r.y + r.h - 5, { col, size: fs, align: "center", weight: 700 });
  });
}

function attitude(p: Pen, r: Rect, sc: Scene) {
  const c = p.c,
    s = sc.s;
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2;
  const ppd = r.h / 46; // pixels per degree of pitch
  const known = ok(s.pitch) && ok(s.bank);
  const pitch = known ? s.pitch / D : 0,
    bank = known ? s.bank : 0;
  c.save();
  p.round(r.x, r.y, r.w, r.h, 8);
  c.clip();
  c.translate(cx, cy);
  c.rotate(-bank);
  c.translate(0, pitch * ppd);
  const big = Math.hypot(r.w, r.h) * 1.5;
  if (known) {
    const sky = c.createLinearGradient(0, -big, 0, 0);
    sky.addColorStop(0, "#071a3a");
    sky.addColorStop(0.75, C.sky2);
    sky.addColorStop(1, C.sky);
    c.fillStyle = sky;
    c.fillRect(-big, -big, big * 2, big);
    const gr = c.createLinearGradient(0, 0, 0, big * 0.6);
    gr.addColorStop(0, C.ground);
    gr.addColorStop(1, C.ground2);
    c.fillStyle = gr;
    c.fillRect(-big, 0, big * 2, big);
    p.seg(-big, 0, big, 0, C.white, 2);
    // the pitch ladder
    for (let d = -90; d <= 90; d += 2.5) {
      if (d === 0 || Math.abs(d - pitch) > 24) continue;
      const y = -d * ppd;
      const major = d % 10 === 0,
        mid = d % 5 === 0;
      const hw = major ? r.w * 0.16 : mid ? r.w * 0.08 : r.w * 0.035;
      p.seg(-hw, y, hw, y, C.white, major ? 1.6 : 1.1);
      if (major) {
        p.text(String(Math.abs(d)), -hw - 6, y + 4, { col: C.white, size: 12, align: "right", weight: 600 });
        p.text(String(Math.abs(d)), hw + 6, y + 4, { col: C.white, size: 12, weight: 600 });
      }
    }
  } else {
    c.fillStyle = "#0a131b";
    c.fillRect(-big, -big, big * 2, big * 2);
  }
  c.restore();
  if (!known) {
    p.text("ATTITUDE INDISPONIBLE", cx, cy - 30, { col: C.amber, size: 13, align: "center", weight: 700 });
    p.text(sc.own?.sample.frame === 2 ? "repère Gargantua" : "pilote sans données d’attitude", cx, cy - 12, {
      col: C.dim,
      size: 11,
      align: "center",
    });
  }
  // the bank scale and its pointer
  const R = Math.max(10, Math.min(r.w * 0.42, r.h * 0.44));
  c.save();
  c.translate(cx, cy);
  c.beginPath();
  c.arc(0, 0, R, -Math.PI / 2 - 60 * D, -Math.PI / 2 + 60 * D);
  p.stroke(C.white, 1.4);
  for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const a = d * D - Math.PI / 2;
    const l = d === 0 ? 0 : Math.abs(d) % 30 === 0 ? 12 : 7;
    if (d === 0) {
      c.beginPath();
      c.moveTo(0, -R);
      c.lineTo(-7, -R - 11);
      c.lineTo(7, -R - 11);
      c.closePath();
      p.fill(C.white);
      continue;
    }
    p.seg(Math.cos(a) * R, Math.sin(a) * R, Math.cos(a) * (R + l), Math.sin(a) * (R + l), C.white, 1.4);
  }
  if (known) {
    c.rotate(-bank);
    c.beginPath();
    c.moveTo(0, -R + 1);
    c.lineTo(-8, -R + 13);
    c.lineTo(8, -R + 13);
    c.closePath();
    p.fill(Math.abs(bank) > 35 * D ? C.amber : C.white);
    // the slip: the trapezoid under the pointer
    const slip = ok(s.beta) ? clamp(-s.beta / (5 * D), -1, 1) * 14 : 0;
    p.round(-9 + slip, -R + 15, 18, 5, 1);
    p.fill(C.white);
  }
  c.restore();
  // the flight path vector, where the craft goes (the track's drift, the path's angle)
  if (known && ok(s.fpa)) {
    const drift = ok(s.track) && ok(s.hdg) ? wrapPi(s.track - s.hdg) : 0;
    const fx = (drift / D) * ppd,
      fy = -(s.fpa / D - pitch) * ppd;
    const x = cx + fx * Math.cos(bank) - fy * Math.sin(bank),
      y = cy + fx * Math.sin(bank) + fy * Math.cos(bank);
    if (Math.abs(x - cx) < r.w * 0.45 && Math.abs(y - cy) < r.h * 0.45) {
      c.save();
      c.translate(x, y);
      c.rotate(-bank);
      p.circle(0, 0, 7);
      p.glow(C.green, 2, 0.25);
      p.seg(-7, 0, -18, 0, C.green, 2);
      p.seg(7, 0, 18, 0, C.green, 2);
      p.seg(0, -7, 0, -14, C.green, 2);
      c.restore();
    }
  }
  // the aircraft's reference (the "W")
  c.save();
  c.translate(cx, cy);
  const wy = r.w * 0.18;
  for (const sgn of [-1, 1]) {
    c.beginPath();
    c.moveTo(sgn * wy, -3);
    c.lineTo(sgn * wy * 0.42, -3);
    c.lineTo(sgn * wy * 0.42, 10);
    c.lineTo(sgn * wy * 0.42 - sgn * 6, 10);
    c.lineTo(sgn * wy * 0.42 - sgn * 6, 3);
    c.lineTo(sgn * wy, 3);
    c.closePath();
    p.fill("#000");
    p.stroke(C.amber, 2);
  }
  p.round(-4, -4, 8, 8, 1);
  p.fill("#000");
  p.stroke(C.amber, 2);
  c.restore();
  // the radio altitude, low
  if (ok(s.agl) && s.agl < 760) {
    const col = s.agl < 60 ? C.amber : C.green;
    p.text(`${fmt(sc.u.alt(s.agl))}`, cx, r.y + r.h - 16, { col, size: 18, align: "center", weight: 700, bg: "#000a" });
    p.text("RA", cx + 46, r.y + r.h - 16, { col: C.dim, size: 10 });
  }
  // the load and the incidence
  const fs = 11;
  if (ok(s.g)) {
    const gMax = sc.snap?.flight?.gMax;
    const col = gMax && Math.abs(s.g) > gMax * 0.9 ? C.red : Math.abs(s.g) > 4 ? C.amber : C.text;
    p.text(`G ${fmt(s.g, 1)}`, r.x + 10, r.y + r.h - 12, { col, size: 13, weight: 700, bg: "#0008" });
  }
  if (ok(s.aoa)) {
    const st = sc.snap?.flight?.stallAoa;
    const col = st && s.aoa > st * 0.9 ? C.red : st && s.aoa > st * 0.75 ? C.amber : C.text;
    p.text(`α ${fmt(s.aoa / D, 1)}°`, r.x + r.w - 10, r.y + r.h - 12, { col, size: 13, align: "right", weight: 700, bg: "#0008" });
  }
  // the ILS's needles
  const ils = sc.snap?.ils;
  if (ils) {
    p.text(ils.id, r.x + 10, r.y + 20, { col: C.magenta, size: fs, weight: 700, bg: "#0008" });
    p.text(`${fmt(ils.dme / 1000, 1)} km`, r.x + 10, r.y + 36, { col: C.magenta, size: fs, bg: "#0008" });
    const sy = r.y + r.h - 34,
      half = r.w * 0.3;
    for (let k = -2; k <= 2; k++) if (k) p.circle(cx + (k * half) / 2, sy, 3), p.stroke(C.white, 1.2);
    if (ils.loc !== null) {
      const x = cx + clamp(ils.loc, -2.3, 2.3) * (half / 2);
      p.c.beginPath();
      p.c.moveTo(x, sy - 7);
      p.c.lineTo(x + 7, sy);
      p.c.lineTo(x, sy + 7);
      p.c.lineTo(x - 7, sy);
      p.c.closePath();
      p.fill(C.magenta);
    }
    const sx = r.x + r.w - 16,
      vh = r.h * 0.3;
    for (let k = -2; k <= 2; k++) if (k) p.circle(sx, cy + (k * vh) / 2, 3), p.stroke(C.white, 1.2);
    if (ils.gs !== null) {
      const y = cy + clamp(ils.gs, -2.3, 2.3) * (vh / 2);
      p.c.beginPath();
      p.c.moveTo(sx - 7, y);
      p.c.lineTo(sx, y - 7);
      p.c.lineTo(sx + 7, y);
      p.c.lineTo(sx, y + 7);
      p.c.closePath();
      p.fill(C.magenta);
    }
  }
}

/** a vertical tape: values about v, labels every `label`, ticks every `tick`, `span` shown over its height */
function tape(
  p: Pen,
  r: Rect,
  v: number,
  span: number,
  tick: number,
  label: number,
  right: boolean,
  bugs: { v: number; col: string; kind: "bug" | "band" }[],
  trend: number,
  title: string,
  unit: string,
  target: { text: string; col: string } | null,
) {
  const c = p.c;
  c.save();
  p.round(r.x, r.y, r.w, r.h, 6);
  p.fill("#0b151dee");
  c.clip();
  const cy = r.y + r.h / 2,
    k = r.h / span;
  const y = (x: number) => cy - (x - v) * k;
  if (ok(v)) {
    const lo = Math.floor((v - span / 2) / tick) * tick;
    for (let x = lo; x <= v + span / 2; x += tick) {
      const yy = y(x),
        major = Math.abs(x / label - Math.round(x / label)) < 1e-6;
      const x0 = right ? r.x : r.x + r.w,
        dir = right ? 1 : -1;
      p.seg(x0, yy, x0 + dir * (major ? 12 : 6), yy, C.white, 1.2);
      if (major && Math.abs(yy - cy) > 20)
        p.text(fmt(x), x0 + dir * 16, yy + 4, { col: C.white, size: 12, align: right ? "left" : "right", weight: 600 });
    }
    for (const b of bugs) {
      if (!ok(b.v)) continue;
      if (b.kind === "band") {
        const yy = y(b.v);
        if (yy < r.y + r.h) {
          c.fillStyle = "#c2531f88";
          c.fillRect(r.x, yy, r.w, r.y + r.h - yy);
          for (let h = yy; h < r.y + r.h; h += 8) p.seg(r.x, h + 8, r.x + r.w, h, "#ff9b4d66", 1);
        }
        continue;
      }
      const yy = clamp(y(b.v), r.y + 6, r.y + r.h - 6);
      const x0 = right ? r.x + 1 : r.x + r.w - 1,
        dir = right ? 1 : -1;
      c.beginPath();
      c.moveTo(x0, yy - 8);
      c.lineTo(x0 + dir * 8, yy - 8);
      c.lineTo(x0 + dir * 8, yy - 3);
      c.lineTo(x0 + dir * 4, yy);
      c.lineTo(x0 + dir * 8, yy + 3);
      c.lineTo(x0 + dir * 8, yy + 8);
      c.lineTo(x0, yy + 8);
      c.closePath();
      p.stroke(b.col, 2);
    }
    if (ok(trend) && Math.abs(trend) > span * 0.01) {
      const x = right ? r.x + 3 : r.x + r.w - 3;
      const t = clamp(trend, -span / 2, span / 2);
      p.seg(x, cy, x, y(v + t), C.green, 2.5);
    }
  }
  c.restore();
  p.round(r.x, r.y, r.w, r.h, 6);
  p.stroke(C.grid2, 1);
  // the readout's box
  const bh = 30,
    bw = r.w + 8;
  const bx = right ? r.x - 2 : r.x - 6;
  p.box(bx, cy - bh / 2, bw, bh, C.white);
  p.text(ok(v) ? fmt(v) : "—", bx + bw / 2, cy + 7, { col: C.white, size: 18, align: "center", weight: 700 });
  if (target) p.text(target.text, r.x + r.w / 2, r.y - 7, { col: target.col, size: 13, align: "center", weight: 700 });
  p.text(`${title} ${unit}`, r.x + r.w / 2, r.y + r.h + 13, { col: C.dim, size: 10, align: "center", weight: 600 });
}

function vsi(p: Pen, r: Rect, vz: number, unit: string, conv: (x: number) => number, target: number | null) {
  const c = p.c;
  p.round(r.x, r.y, r.w, r.h, 6);
  p.fill("#0b151dcc");
  p.stroke(C.grid2);
  const cy = r.y + r.h / 2,
    half = r.h / 2 - 10;
  const top = conv(30);
  const y = (x: number) => cy - Math.sign(x) * Math.sqrt(Math.min(Math.abs(x), top) / top) * half;
  for (const t of [0, 1, 2, 5, 10, 20, 30].map(conv)) {
    for (const sgn of t ? [-1, 1] : [1]) {
      const yy = y(sgn * t);
      p.seg(r.x, yy, r.x + (t ? 6 : 10), yy, C.white, 1);
      if ([conv(5), conv(10), conv(20)].includes(t)) p.text(fmt(t), r.x + 8, yy + 4, { col: C.dim, size: 9 });
    }
  }
  if (target !== null && ok(target)) {
    const yy = y(conv(target));
    p.seg(r.x + 2, yy, r.x + r.w - 2, yy, C.cyan, 2);
  }
  if (ok(vz)) {
    const v = conv(vz);
    const yy = y(v);
    c.beginPath();
    c.moveTo(r.x + r.w + 6, cy);
    c.lineTo(r.x + 4, yy);
    p.stroke(Math.abs(vz) > 30 ? C.amber : C.green, 2.5);
    p.text(fmt(v), r.x + r.w / 2, vz >= 0 ? r.y - 6 : r.y + r.h + 13, { col: C.green, size: 11, align: "center", weight: 700 });
  }
  p.text(unit, r.x + r.w / 2, vz >= 0 ? r.y + r.h + 13 : r.y - 6, { col: C.dim, size: 9, align: "center" });
}

function headingTape(p: Pen, r: Rect, sc: Scene) {
  const c = p.c,
    s = sc.s;
  c.save();
  p.round(r.x, r.y, r.w, r.h, 6);
  p.fill("#0b151dee");
  c.clip();
  const span = 70,
    k = r.w / span,
    cx = r.x + r.w / 2;
  const hdg = ok(s.hdg) ? deg360(s.hdg) : Number.NaN;
  const x = (deg: number) => cx + (((deg - hdg + 540) % 360) - 180) * k;
  if (ok(hdg)) {
    for (let d = Math.floor((hdg - span / 2) / 5) * 5; d <= hdg + span / 2; d += 5) {
      const dd = (d + 360) % 360,
        xx = x(dd);
      const major = dd % 10 === 0;
      p.seg(xx, r.y, xx, r.y + (major ? 10 : 5), C.white, 1.2);
      if (dd % 30 === 0) {
        const name = { 0: "N", 90: "E", 180: "S", 270: "O" }[dd] ?? String(dd / 10).padStart(2, "0");
        p.text(name, xx, r.y + 24, { col: dd % 90 === 0 ? C.cyan : C.white, size: 13, align: "center", weight: 700 });
      } else if (major) p.text(String(dd / 10).padStart(2, "0"), xx, r.y + 23, { col: C.dim, size: 10, align: "center" });
    }
    const mark = (deg: number, col: string, kind: "bug" | "diamond" | "caret") => {
      const xx = clamp(x(deg), r.x + 6, r.x + r.w - 6);
      c.beginPath();
      if (kind === "diamond") {
        c.moveTo(xx, r.y + 2);
        c.lineTo(xx + 5, r.y + 8);
        c.lineTo(xx, r.y + 14);
        c.lineTo(xx - 5, r.y + 8);
        c.closePath();
        p.stroke(col, 2);
      } else if (kind === "caret") {
        c.moveTo(xx - 6, r.y + r.h);
        c.lineTo(xx, r.y + r.h - 9);
        c.lineTo(xx + 6, r.y + r.h);
        c.closePath();
        p.fill(col);
      } else {
        c.moveTo(xx - 8, r.y);
        c.lineTo(xx - 8, r.y + 7);
        c.lineTo(xx - 3, r.y + 7);
        c.lineTo(xx, r.y + 3);
        c.lineTo(xx + 3, r.y + 7);
        c.lineTo(xx + 8, r.y + 7);
        c.lineTo(xx + 8, r.y);
        p.stroke(col, 2);
      }
    };
    const a = sc.snap?.auto;
    if (a?.hdg != null) mark(deg360(a.hdg), C.cyan, "bug");
    if (sc.snap?.nav) mark(deg360(sc.snap.nav.brg), C.magenta, "caret");
    if (sc.snap?.msn) mark(deg360(sc.snap.msn.brg), C.amber, "caret");
    if (ok(s.track)) mark(deg360(s.track), C.green, "diamond");
  }
  c.restore();
  p.round(r.x, r.y, r.w, r.h, 6);
  p.stroke(C.grid2);
  const bw = 54;
  p.box(cx - bw / 2, r.y - 26, bw, 24, C.white);
  p.text(ok(hdg) ? String(Math.round(hdg) % 360).padStart(3, "0") : "—", cx, r.y - 8, {
    col: C.white,
    size: 16,
    align: "center",
    weight: 700,
  });
  p.c.beginPath();
  p.c.moveTo(cx - 5, r.y - 2);
  p.c.lineTo(cx + 5, r.y - 2);
  p.c.lineTo(cx, r.y + 4);
  p.fill(C.white);
}

/** the whole display in r */
export function drawPfd(p: Pen, r: Rect, sc: Scene) {
  const s = sc.s,
    u = sc.u;
  if (r.w < 260 || r.h < 200) {
    p.text("Agrandir pour le PFD", r.x + r.w / 2, r.y + r.h / 2, { col: C.dim, size: 11, align: "center" });
    return;
  }
  const fh = clamp(r.h * 0.085, 30, 42);
  const pad = 8;
  fma(p, { x: r.x + pad, y: r.y + pad, w: r.w - pad * 2, h: fh }, sc);
  const top = r.y + pad + fh + 26,
    hh = clamp(r.h * 0.09, 32, 44);
  const bottom = r.y + r.h - hh - 10;
  const sw = clamp(r.w * 0.13, 58, 96),
    aw = clamp(r.w * 0.15, 66, 108),
    vw = clamp(r.w * 0.05, 26, 40);
  const mid = { x: r.x + pad + sw + 12, y: top, w: r.w - pad * 2 - sw - aw - vw - 34, h: bottom - top - 34 };
  attitude(p, mid, sc);
  const auto = sc.snap?.auto,
    nav = sc.snap?.nav;
  // the speed tape (the target bug, the trend over 10 s)
  const spd = u.spd(s.spd);
  const sTick = u.sys === "metric" ? 5 : 10;
  tape(
    p,
    { x: r.x + pad, y: mid.y, w: sw, h: mid.h },
    spd,
    sTick * 18,
    sTick,
    sTick * 2,
    false,
    [
      { v: auto?.spd != null ? u.spd(auto.spd) : Number.NaN, col: C.cyan, kind: "bug" },
      { v: nav?.spdT != null && auto?.vnav ? u.spd(nav.spdT) : Number.NaN, col: C.magenta, kind: "bug" },
    ],
    ok(s.acc) ? u.spd(s.acc * 10) : Number.NaN,
    sc.snap?.flight?.tas !== undefined ? "TAS" : "VIT",
    u.spdName,
    nav?.spdT != null && auto?.vnav
      ? { text: fmt(u.spd(nav.spdT)), col: C.magenta }
      : auto?.spd != null
        ? { text: fmt(u.spd(auto.spd)), col: C.cyan }
        : null,
  );
  if (ok(s.mach) && s.mach > 0.05)
    p.text(`M ${fmt(s.mach, 2)}`, r.x + pad + sw / 2, mid.y + mid.h + 32, {
      col: s.mach > 1 ? C.amber : C.text,
      size: 13,
      align: "center",
      weight: 700,
    });
  if (ok(s.gs)) p.text(`GS ${fmt(u.spd(s.gs))}`, r.x + pad + sw / 2, mid.y + mid.h + 48, { col: C.dim, size: 11, align: "center" });
  // the altitude tape (the target, the ground)
  const alt = u.alt(s.alt);
  const aTick = u.sys === "metric" ? 20 : 100;
  const ax = mid.x + mid.w + 12;
  tape(
    p,
    { x: ax, y: mid.y, w: aw, h: mid.h },
    alt,
    aTick * 25,
    aTick,
    aTick * 5,
    true,
    [
      { v: auto?.alt != null ? u.alt(auto.alt) : Number.NaN, col: C.cyan, kind: "bug" },
      { v: nav?.altT != null && auto?.vnav ? u.alt(nav.altT) : Number.NaN, col: C.magenta, kind: "bug" },
      { v: ok(s.agl) && ok(s.alt) ? u.alt(s.alt - s.agl) : Number.NaN, col: C.amber, kind: "band" },
    ],
    ok(s.vz) ? u.alt(s.vz * 6) : Number.NaN,
    "ALT",
    u.altName,
    nav?.altT != null && auto?.vnav
      ? { text: fmt(u.alt(nav.altT)), col: C.magenta }
      : auto?.alt != null
        ? { text: fmt(u.alt(auto.alt)), col: C.cyan }
        : null,
  );
  vsi(p, { x: ax + aw + 6, y: mid.y + mid.h * 0.12, w: vw, h: mid.h * 0.76 }, s.vz, u.vsName, u.vs, null);
  headingTape(p, { x: mid.x, y: r.y + r.h - hh - 8, w: mid.w, h: hh }, sc);
  // the next point, low right
  if (nav && sc.snap?.route[nav.active]) {
    const wp = sc.snap.route[nav.active]!;
    const x = r.x + r.w - pad,
      y = r.y + r.h - hh + 4;
    p.text(wp.name, x, y, { col: C.magenta, size: 12, align: "right", weight: 700 });
    p.text(`${fmt(u.dist(nav.dist), 1)} ${u.distName.toLowerCase()}`, x, y + 15, { col: C.text, size: 11, align: "right" });
  }
  if (ok(s.vz) || ok(s.spd)) return;
  p.text("En attente des mesures de vol…", r.x + r.w / 2, r.y + r.h / 2, { col: C.dim, size: 13, align: "center", font: MONO });
}
