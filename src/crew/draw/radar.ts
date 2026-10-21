// The tactical scope: its sweep and the phosphor's afterglow, its rings; the pilot's own radar tracks (the sensor) or
// everything shared — the players, the real traffic, a mission's units, the ships — with their bearings, distances and
// heights; the nearest listed beside it when there is room.
import { relative } from "../model";
import { C, deg360, fmt, type Pen, polar, SIDE, TAU, unitSymbol, type Point, type Rect } from "./kit";
import type { Scene } from "./scene";
import { L } from "../lang";

export interface RadarOpts {
  range: number;
  north: boolean;
  sensor: boolean;
  selected: string | null;
  pick?: (pt: Point, what: { slot?: number; contact?: string; wp?: number }) => void;
}

interface Blip {
  e: number;
  n: number;
  dz: number | null;
  name: string;
  col: string;
  kind: string;
  side: string;
  hdg: number | null;
  locked: boolean;
  id: string;
  slot?: number;
}

export function drawRadar(p: Pen, r: Rect, sc: Scene, o: RadarOpts) {
  const c = p.c,
    u = sc.u,
    own = sc.own,
    s = sc.s;
  const list = r.w > r.h * 1.35 && r.w > 640;
  const area = list ? { ...r, w: r.w - 250 } : r;
  const cx = area.x + area.w / 2,
    cy = area.y + area.h / 2 + 6;
  const R = Math.max(20, Math.min(area.w, area.h) * 0.42);
  const up = o.north || !Number.isFinite(s.hdg) ? 0 : s.hdg;
  const k = R / o.range;
  // the blips
  const blips: Blip[] = [];
  if (own && o.sensor)
    for (const t of sc.snap?.radar?.contacts ?? [])
      blips.push({
        e: t.e,
        n: t.n,
        dz: t.dz,
        name: t.name,
        col: t.iff === "hostile" ? C.red : t.iff === "friend" ? C.cyan : C.amber,
        kind: "air",
        side: t.iff === "hostile" ? "hostile" : t.iff === "friend" ? "friend" : "neutral",
        hdg: null,
        locked: t.locked,
        id: t.id,
      });
  // (the missiles and decoys in the air: on the Sensor view too — the pilot's DAS sees them)
  if (own?.geo && o.sensor)
    for (const t of sc.contacts.filter((x) => x.kind === "missile" || x.kind === "decoy")) {
      const q = polar(own.geo.lat, own.geo.lon, t.lat, t.lon);
      blips.push({
        e: Math.sin(q.b) * q.d,
        n: Math.cos(q.b) * q.d,
        dz: t.alt !== null && Number.isFinite(s.alt) ? t.alt - s.alt : null,
        name: t.name,
        col: SIDE[t.side] ?? C.white,
        kind: t.kind,
        side: t.kind === "decoy" ? t.type : t.side,
        hdg: t.hdg,
        locked: false,
        id: t.id,
      });
    }
  if (own && !o.sensor) {
    for (const cr of sc.crafts) {
      if (cr === own) continue;
      const rel = cr.geo && own.geo ? null : relative(own, cr);
      let e: number, n: number, dz: number | null;
      if (rel) [e, n, dz] = [rel.e, rel.n, rel.dz];
      else if (cr.geo && own.geo) {
        const q = polar(own.geo.lat, own.geo.lon, cr.geo.lat, cr.geo.lon);
        e = Math.sin(q.b) * q.d;
        n = Math.cos(q.b) * q.d;
        dz = cr.metrics.alt !== undefined && own.metrics.alt !== undefined ? cr.metrics.alt - own.metrics.alt : null;
      } else continue;
      blips.push({
        e,
        n,
        dz,
        name: cr.member.name,
        col: cr.member.colour,
        kind: "player",
        side: "friend",
        hdg: cr.geo?.heading ?? null,
        locked: false,
        id: `p:${cr.member.slot}`,
        slot: cr.member.slot,
      });
    }
    if (own.geo)
      for (const t of sc.contacts) {
        const q = polar(own.geo.lat, own.geo.lon, t.lat, t.lon);
        blips.push({
          e: Math.sin(q.b) * q.d,
          n: Math.cos(q.b) * q.d,
          dz: t.alt !== null && Number.isFinite(s.alt) ? t.alt - s.alt : null,
          name: t.name,
          col: SIDE[t.side] ?? C.white,
          kind: t.kind,
          side: t.kind === "decoy" ? t.type : t.side,
          hdg: t.hdg,
          locked: false,
          id: t.id,
        });
      }
  }
  const scr = (b: Blip): Point => {
    const a = Math.atan2(b.e, b.n) - up,
      d = Math.hypot(b.e, b.n) * k;
    return [cx + Math.sin(a) * d, cy - Math.cos(a) * d];
  };
  c.save();
  p.round(r.x, r.y, r.w, r.h, 10);
  c.clip();
  const bg = c.createRadialGradient(cx, cy, 0, cx, cy, R * 1.2);
  bg.addColorStop(0, "#08201f");
  bg.addColorStop(0.8, "#04100f");
  bg.addColorStop(1, "#03080a");
  c.fillStyle = bg;
  c.fillRect(r.x, r.y, r.w, r.h);
  // the sweep: a conic gradient trailing the beam
  const sweep = (sc.now * 1.4) % TAU;
  const beam = sweep - Math.PI / 2;
  c.save();
  p.circle(cx, cy, R);
  c.clip();
  if (c.createConicGradient) {
    const g = c.createConicGradient(beam - 1.2, cx, cy);
    g.addColorStop(0, "#3ff2c400");
    g.addColorStop(0.19, "#3ff2c42a");
    g.addColorStop(0.191, "#00000000");
    g.addColorStop(1, "#00000000");
    c.fillStyle = g;
    c.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  p.seg(cx, cy, cx + Math.cos(beam) * R, cy + Math.sin(beam) * R, "#7dffd8aa", 1.5);
  c.restore();
  // the rings, the spokes
  for (let j = 1; j <= 4; j++) {
    p.circle(cx, cy, (R * j) / 4);
    p.stroke(j === 4 ? "#2f8f7f" : "#17463f", j === 4 ? 1.6 : 1);
    const v = (o.range * j) / 4 / u.distM;
    p.text(fmt(v, v < 10 ? 1 : 0), cx + 4, cy - (R * j) / 4 + 13, { col: "#5fb3a3", size: 10 });
  }
  for (let d = 0; d < 360; d += 30) {
    const a = d * (Math.PI / 180) - up;
    p.seg(cx, cy, cx + Math.sin(a) * R, cy - Math.cos(a) * R, "#123a34", 1);
    const name = { 0: "N", 90: "E", 180: "S", 270: L("O", "W") }[d] ?? String(d).padStart(3, "0");
    p.text(name, cx + Math.sin(a) * (R + 14), cy - Math.cos(a) * (R + 14) + 4, {
      col: d % 90 ? "#5fb3a3" : C.cyan,
      size: 11,
      align: "center",
      weight: 700,
    });
  }
  // the blips, brightest just swept
  const inRange = blips.filter((b) => Math.hypot(b.e, b.n) <= o.range * 1.05);
  for (const b of inRange) {
    const [x, y] = scr(b);
    const ang = Math.atan2(x - cx, -(y - cy));
    const since = (((sweep - ang) % TAU) + TAU) % TAU;
    const glow = 0.45 + 0.55 * Math.exp(-since / 1.6);
    c.globalAlpha = glow;
    if (b.kind === "player") {
      c.save();
      c.translate(x, y);
      c.rotate((b.hdg ?? 0) - up);
      p.aircraft(16, b.col);
      c.restore();
    } else if (b.kind === "missile" || b.kind === "decoy") unitSymbol(p, x, y, b.kind, b.side, b.hdg, up, 6);
    else if (o.sensor) {
      p.round(x - 6, y - 6, 12, 12, 2);
      p.fill(`${b.col}33`);
      p.stroke(b.col, 1.8);
    } else unitSymbol(p, x, y, b.kind, b.side, b.hdg, up, 6);
    if (b.locked) {
      p.round(x - 11, y - 11, 22, 22, 3);
      p.stroke(b.col, 2);
      p.seg(cx, cy, x, y, `${b.col}99`, 1, [3, 4]);
    }
    if (b.id === o.selected) {
      p.circle(x, y, 15);
      p.stroke(C.amber, 2, [4, 3]);
    }
    c.globalAlpha = 1;
    p.text(b.name, x + 12, y - 1, { col: b.col, size: 10, weight: 700 });
    if (b.dz !== null) {
      const dh = Math.round(u.alt(b.dz) / 100);
      p.text(`${dh >= 0 ? "+" : "−"}${String(Math.abs(dh)).padStart(2, "0")}`, x + 12, y + 11, { col: C.dim, size: 9 });
    }
    o.pick?.([x, y], b.slot !== undefined ? { slot: b.slot } : { contact: b.id });
  }
  // the craft at the centre
  c.save();
  c.translate(cx, cy);
  c.rotate(Number.isFinite(s.hdg) ? s.hdg - up : 0);
  p.aircraft(18, C.amber, "#000");
  c.restore();
  c.restore();
  p.text(
    o.sensor ? `${L("CAPTEUR", "SENSOR")} · ${sc.snap?.radar?.mode || "—"}` : L("PARTAGÉ · JOUEURS + TRAFIC", "SHARED · PLAYERS + TRAFFIC"),
    r.x + 12,
    r.y + 20,
    {
      col: C.green,
      size: 11,
      weight: 700,
    },
  );
  p.text(
    `${o.north ? L("NORD EN HAUT", "NORTH UP") : L("CAP EN HAUT", "HEADING UP")} · ${fmt(o.range / u.distM, o.range / u.distM < 10 ? 1 : 0)} ${u.distName}`,
    r.x + 12,
    r.y + 36,
    { col: C.dim, size: 10 },
  );
  if (o.sensor && !sc.snap?.radar)
    p.text(L("Radar du pilote indisponible", "The pilot's radar is unavailable"), cx, r.y + r.h - 18, {
      col: C.amber,
      size: 12,
      align: "center",
    });
  // the nearest, listed
  if (list) {
    const x0 = r.x + r.w - 240,
      y0 = r.y + 14;
    p.panel({ x: x0, y: y0, w: 228, h: r.h - 28 }, `CONTACTS · ${inRange.length}`);
    const rows = [...inRange].sort((a, b) => Math.hypot(a.e, a.n) - Math.hypot(b.e, b.n)).slice(0, Math.floor((r.h - 70) / 34));
    rows.forEach((b, i) => {
      const y = y0 + 44 + i * 34;
      if (b.id === o.selected) {
        p.round(x0 + 6, y - 14, 216, 31, 5);
        p.fill("#ffb43c18");
      }
      p.circle(x0 + 16, y - 3, 4);
      p.fill(b.col);
      p.text(b.name.slice(0, 16), x0 + 26, y, { col: C.white, size: 11, weight: 700 });
      const brg = String(Math.round(deg360(Math.atan2(b.e, b.n)))).padStart(3, "0");
      p.text(`${brg}° ${fmt(u.dist(Math.hypot(b.e, b.n)), 1)} ${u.distName.toLowerCase()}`, x0 + 26, y + 13, { col: C.dim, size: 10 });
      if (b.dz !== null)
        p.text(`${b.dz >= 0 ? "+" : "−"}${fmt(u.alt(Math.abs(b.dz)))}`, x0 + 218, y, { col: C.dim, size: 10, align: "right" });
      o.pick?.([x0 + 110, y - 2], b.slot !== undefined ? { slot: b.slot } : { contact: b.id });
    });
    if (!rows.length)
      p.text(L("Aucun contact dans la portée", "No contact in range"), x0 + 114, y0 + 60, { col: C.dim, size: 11, align: "center" });
  }
}
