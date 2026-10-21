// The navigation display: the compass's arc (heading up) or rose (north up), the plan's legs and points, the path
// predicted, the descent's top, the wind, and everything about — the players, the real traffic (TCAS's diamonds and
// their relative heights), a mission's units, the ships, the zones, the pilot's own radar tracks.
import { relative } from "../model";
import { C, clamp, D, deg360, dur, fmt, Labels, type Pen, polar, SIDE, TAU, unitSymbol, type Point, type Rect } from "./kit";
import type { Scene } from "./scene";
import { L } from "../lang";

export interface NdOpts {
  range: number;
  north: boolean;
  /** an arc ahead (the aircraft low) or the whole rose about the centre */
  arc: boolean;
  sensor: boolean;
  /** what can be picked: a player's slot, a contact's id */
  pick?: (pt: Point, what: { slot?: number; contact?: string; wp?: number }) => void;
}

/** the display in r; its geometry back (the craft's place on it, pixels a metre, the bearing up) for the touches */
export function drawNd(p: Pen, r: Rect, sc: Scene, o: NdOpts): { cx: number; cy: number; k: number; up: number } {
  const c = p.c,
    s = sc.s,
    u = sc.u,
    own = sc.own,
    snap = sc.snap;
  const cx = r.x + r.w / 2;
  const cy = o.arc ? r.y + r.h * 0.78 : r.y + r.h / 2 + 8;
  const R = Math.max(20, o.arc ? Math.min(r.h * 0.66, r.w * 0.47) : Math.min(r.w, r.h) * 0.42);
  const up = o.north || !Number.isFinite(s.hdg) ? 0 : s.hdg;
  const k = R / o.range;
  const geo = own?.geo ?? null;
  /** a place on the display (null: no position of ours) */
  const at = (lat: number, lon: number): Point | null => {
    if (!geo) return null;
    const q = polar(geo.lat, geo.lon, lat, lon);
    const a = q.b - up;
    return [cx + Math.sin(a) * q.d * k, cy - Math.cos(a) * q.d * k];
  };
  const labels = new Labels(p);
  labels.keep(cx, cy, 16);
  c.save();
  p.round(r.x, r.y, r.w, r.h, 10);
  c.clip();
  // the face: a faint radial glow about the craft
  const bg = c.createRadialGradient(cx, cy, 0, cx, cy, R * 1.3);
  bg.addColorStop(0, "#0b1b25");
  bg.addColorStop(1, "#04080c");
  c.fillStyle = bg;
  c.fillRect(r.x, r.y, r.w, r.h);
  // the range rings
  for (const f of [0.25, 0.5, 0.75]) {
    p.circle(cx, cy, R * f);
    p.stroke(C.grid2, 1, f === 0.5 ? [] : [3, 6]);
    const lbl = (o.range * f) / u.distM;
    p.text(fmt(lbl, lbl < 10 ? 1 : 0), cx + Math.sin(-0.6) * R * f - 4, cy - Math.cos(-0.6) * R * f, {
      col: C.dim,
      size: 10,
      align: "right",
    });
  }
  // the mission's zones, the SAMs' reach
  for (const z of sc.zones) {
    const q = at(z.lat, z.lon);
    if (!q) continue;
    p.circle(q[0], q[1], Math.max(4, z.r * k));
    if (z.kind === "threat") {
      p.fill("#ff4d4d14");
      p.stroke(C.red, 1.2, [6, 5]);
    } else p.stroke(C.amber, 1.4, z.waiting ? [4, 6] : []);
    p.text(z.name, q[0], q[1] - Math.max(4, z.r * k) - 4, { col: z.kind === "threat" ? C.red : C.amber, size: 10, align: "center" });
  }
  // the plan: the legs flown dim, the active one magenta, the next ones white; the points and their constraints
  const route = snap?.route ?? [];
  const nav = snap?.nav;
  if (route.length && geo) {
    const pts = route.map((w) => at(w.lat, w.lon));
    const act = nav?.active ?? 1;
    for (let i = 1; i < pts.length; i++) {
      const a = i === act && nav ? at(geo.lat, geo.lon) : pts[i - 1],
        b = pts[i];
      if (!a || !b) continue;
      c.beginPath();
      c.moveTo(a[0], a[1]);
      c.lineTo(b[0], b[1]);
      if (i === act) p.glow(C.magenta, 2.2, 0.22);
      else p.stroke(i < act ? "#5d6a73" : C.white, 1.4, i < act ? [3, 5] : []);
    }
    route.forEach((w, i) => {
      const q = pts[i];
      if (!q || Math.hypot(q[0] - cx, q[1] - cy) > R * 1.25) return;
      const col = i === act ? C.magenta : i < act ? "#5d6a73" : C.white;
      p.star(q[0], q[1], 7, col, i === act);
      o.pick?.(q, { wp: i });
      p.text(w.name, q[0] + 10, q[1] - 4, { col, size: 11, weight: 700 });
      if (w.alt !== undefined) p.text(fmt(u.alt(w.alt)), q[0] + 10, q[1] + 9, { col: C.dim, size: 9 });
    });
    // the descent's top, along the active leg then the next ones
    if (nav?.tod != null && nav.tod > 0) {
      let left = nav.tod,
        from: { lat: number; lon: number } = geo;
      for (let i = act; i < route.length && left > 0; i++) {
        const w = route[i]!;
        const q = polar(from.lat, from.lon, w.lat, w.lon);
        if (q.d >= left) {
          const f = left / q.d;
          const lat = from.lat + (w.lat - from.lat) * f,
            lon = from.lon + (w.lon - from.lon) * f;
          const t = at(lat, lon);
          if (t) {
            p.circle(t[0], t[1], 5);
            p.stroke(C.green, 2);
            p.text("T/D", t[0] + 8, t[1] + 4, { col: C.green, size: 10, weight: 700 });
          }
          break;
        }
        left -= q.d;
        from = w;
      }
    }
  }
  // the predicted path, its minutes ticked
  if (snap?.ahead.length && geo) {
    const pts = snap.ahead.map((q) => at(q.lat, q.lon));
    p.path(pts);
    p.stroke(C.green, 1.6, [6, 5]);
    let next = 60;
    for (let i = 0; i < snap.ahead.length; i++) {
      const t = snap.ahead[i]!.t,
        q = pts[i];
      if (t === undefined || !q || t < next) continue;
      next = (Math.floor(t / 60) + 1) * 60;
      p.circle(q[0], q[1], 2.5);
      p.fill(C.green);
    }
  }
  // the mission's objective
  if (snap?.msn) {
    const a = snap.msn.brg - up,
      d = Math.min(snap.msn.dist * k, R * 1.02);
    const x = cx + Math.sin(a) * d,
      y = cy - Math.cos(a) * d;
    c.beginPath();
    c.moveTo(x, y - 8);
    c.lineTo(x + 8, y);
    c.lineTo(x, y + 8);
    c.lineTo(x - 8, y);
    c.closePath();
    p.stroke(C.amber, 2);
    p.text(snap.msn.name, x + 11, y + 4, { col: C.amber, size: 10, weight: 700 });
  }
  // everything about
  const myAlt = s.alt;
  for (const t of sc.contacts) {
    const q = at(t.lat, t.lon);
    if (!q || Math.hypot(q[0] - cx, q[1] - cy) > R * 1.15) continue;
    unitSymbol(p, q[0], q[1], t.kind, t.side, t.hdg, up, t.kind === "sea" ? 6 : 6);
    const col = SIDE[t.side] ?? C.white;
    if (t.kind === "air" && t.alt !== null && Number.isFinite(myAlt)) {
      const dh = Math.round(u.alt(t.alt - myAlt) / 100);
      p.text(`${dh > 0 ? "+" : dh < 0 ? "−" : ""}${String(Math.abs(dh)).padStart(2, "0")}`, q[0], dh >= 0 ? q[1] - 11 : q[1] + 19, {
        col,
        size: 10,
        align: "center",
        weight: 700,
      });
    }
    if ((o.range < 160_000 && r.w > 420) || t.side !== "traffic") labels.put(t.name, q[0] + 10, q[1] + 4, { col: `${col}cc`, size: 9 });
    o.pick?.(q, { contact: t.id });
  }
  // the pilot's own radar tracks
  if (o.sensor && own)
    for (const t of snap?.radar?.contacts ?? []) {
      const d = Math.hypot(t.e, t.n);
      if (d > o.range * 1.1) continue;
      const a = Math.atan2(t.e, t.n) - up;
      const x = cx + Math.sin(a) * d * k,
        y = cy - Math.cos(a) * d * k;
      const col = t.iff === "hostile" ? C.red : t.iff === "friend" ? C.cyan : C.amber;
      p.round(x - 5, y - 5, 10, 10, 1);
      p.stroke(col, 1.8);
      if (t.locked) {
        p.round(x - 9, y - 9, 18, 18, 2);
        p.stroke(col, 1.8);
        p.seg(cx, cy, x, y, `${col}88`, 1, [2, 4]);
      }
      p.text(t.name, x + 11, y + 4, { col, size: 10, weight: 600 });
      o.pick?.([x, y], { contact: t.id });
    }
  // the other players
  for (const cr of sc.crafts) {
    if (!own || cr === own || cr.body !== own.body) continue;
    let q: Point | null = null;
    if (cr.geo && geo) q = at(cr.geo.lat, cr.geo.lon);
    else {
      const rel = relative(own, cr);
      if (rel) {
        const a = Math.atan2(rel.e, rel.n) - up,
          d = Math.hypot(rel.e, rel.n);
        q = [cx + Math.sin(a) * d * k, cy - Math.cos(a) * d * k];
      }
    }
    if (!q || Math.hypot(q[0] - cx, q[1] - cy) > R * 1.15) continue;
    c.save();
    c.translate(q[0], q[1]);
    c.rotate((cr.geo?.heading ?? 0) - up);
    p.aircraft(16, cr.age > 3 ? C.dim : cr.member.colour);
    c.restore();
    const dist = relative(own, cr)?.distance;
    labels.put(cr.member.name, q[0] + 12, q[1] - 2, { col: C.white, size: 11, weight: 700 }, true);
    if (dist !== undefined)
      labels.put(`${fmt(u.dist(dist), 1)} ${u.distName.toLowerCase()}`, q[0] + 12, q[1] + 11, { col: C.dim, size: 9 }, true);
    o.pick?.(q, { slot: cr.member.slot });
  }
  c.restore();
  // the compass (over the picture)
  c.save();
  c.beginPath();
  c.arc(cx, cy, R, 0, TAU);
  p.stroke(C.white, 1.4);
  for (let d = 0; d < 360; d += 5) {
    const a = d * D - up - Math.PI / 2;
    const l = d % 10 === 0 ? 10 : 5;
    const x0 = cx + Math.cos(a) * R,
      y0 = cy + Math.sin(a) * R;
    if (y0 < r.y || y0 > r.y + r.h) continue;
    p.seg(x0, y0, cx + Math.cos(a) * (R - l), cy + Math.sin(a) * (R - l), C.white, 1.2);
    if (d % 30 === 0) {
      const name = { 0: "N", 90: "E", 180: "S", 270: L("O", "W") }[d] ?? String(d / 10);
      p.text(name, cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22) + 4, {
        col: d % 90 === 0 ? C.cyan : C.white,
        size: 12,
        align: "center",
        weight: 700,
      });
    }
  }
  // the bugs on the ring: the autopilot's heading, the track, the active point's bearing
  const ring = (ang: number, col: string, kind: "bug" | "diamond" | "tri") => {
    const a = ang - up - Math.PI / 2;
    c.save();
    c.translate(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    c.rotate(a + Math.PI / 2);
    c.beginPath();
    if (kind === "bug") {
      c.moveTo(-8, -6);
      c.lineTo(-8, 0);
      c.lineTo(-3, 0);
      c.lineTo(0, 5);
      c.lineTo(3, 0);
      c.lineTo(8, 0);
      c.lineTo(8, -6);
      p.stroke(col, 2);
    } else if (kind === "diamond") {
      c.moveTo(0, -1);
      c.lineTo(5, 6);
      c.lineTo(0, 13);
      c.lineTo(-5, 6);
      c.closePath();
      p.stroke(col, 2);
    } else {
      c.moveTo(0, 2);
      c.lineTo(6, -9);
      c.lineTo(-6, -9);
      c.closePath();
      p.fill(col);
    }
    c.restore();
  };
  const a = snap?.auto;
  if (a?.hdg != null) ring(a.hdg, C.cyan, "bug");
  if (nav) ring(nav.brg, C.magenta, "tri");
  if (Number.isFinite(s.track)) ring(s.track, C.green, "diamond");
  // the craft
  c.translate(cx, cy);
  c.rotate(Number.isFinite(s.hdg) ? s.hdg - up : 0);
  p.aircraft(22, C.amber, "#000");
  c.restore();
  // the heading's box
  const hdg = Number.isFinite(s.hdg) ? Math.round(deg360(s.hdg)) % 360 : null;
  const by = o.arc ? cy - R - 30 : r.y + 10;
  p.box(cx - 30, by, 60, 24);
  p.text(hdg === null ? "—" : String(hdg).padStart(3, "0"), cx, by + 18, { col: C.white, size: 16, align: "center", weight: 700 });
  p.text(o.north ? L("NORD", "NORTH") : L("CAP", "HDG"), cx + 38, by + 17, { col: C.green, size: 10, weight: 700 });
  // the corners: speeds and wind; the active point; the range
  const fs = clamp(r.w / 34, 10, 13);
  p.text(`GS ${fmt(u.spd(s.gs))}  TAS ${fmt(u.spd(s.spd))}`, r.x + 10, r.y + 20, { col: C.white, size: fs, weight: 700 });
  const w = snap?.flight?.wind;
  if (w) {
    p.text(`${String(Math.round(deg360(w.from))).padStart(3, "0")}° / ${fmt(u.spd(w.spd))}`, r.x + 10, r.y + 20 + fs * 1.5, {
      col: C.text,
      size: fs,
    });
    c.save();
    c.translate(r.x + 22, r.y + 26 + fs * 3);
    c.rotate(w.from - up);
    p.seg(0, -11, 0, 11, C.text, 2);
    c.beginPath();
    c.moveTo(0, 13);
    c.lineTo(-5, 5);
    c.lineTo(5, 5);
    c.closePath();
    p.fill(C.text);
    c.restore();
  }
  if (nav && route[nav.active]) {
    const x = r.x + r.w - 10;
    p.text(route[nav.active]!.name, x, r.y + 20, { col: C.magenta, size: fs + 1, align: "right", weight: 700 });
    p.text(`${fmt(u.dist(nav.dist), 1)} ${u.distName}`, x, r.y + 20 + fs * 1.4, { col: C.white, size: fs, align: "right" });
    p.text(`ETE ${dur(nav.ete)}`, x, r.y + 20 + fs * 2.8, { col: C.white, size: fs, align: "right" });
    if (Math.abs(nav.xtk) > 30)
      p.text(`XTK ${fmt(u.dist(Math.abs(nav.xtk)), 2)}${nav.xtk > 0 ? L("D", "R") : L("G", "L")}`, x, r.y + 20 + fs * 4.2, {
        col: C.amber,
        size: fs,
        align: "right",
      });
  }
  p.text(`${fmt(o.range / u.distM, o.range / u.distM < 10 ? 1 : 0)} ${u.distName}`, r.x + 14, r.y + r.h - 14, {
    col: C.cyan,
    size: fs,
    weight: 700,
    bg: "#04080ce0",
  });
  const n = sc.contacts.length;
  if (n) p.text(`${n} contact${n > 1 ? "s" : ""}`, r.x + 10, r.y + 20 + fs * (w ? 5.2 : 1.5), { col: C.dim, size: fs - 1 });
  if (!geo && own && own.sample.frame === 2)
    p.text(L("Repère Gargantua · positions locales indisponibles", "Gargantua's frame · local positions unavailable"), cx, r.y + r.h - 34, {
      col: C.amber,
      size: 11,
      align: "center",
    });
  return { cx, cy, k, up };
}
