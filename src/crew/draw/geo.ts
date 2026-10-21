// The map and the globe. The map: OpenStreetMap at night (its tiles turned to night, draw/tiles.ts) in Web Mercator, tinted to the
// console's blue, the vector land beneath it while tiles come (or offline); the globe: orthographic, shaded, its
// atmosphere's rim, the stars behind. Over both: the zones, the trail coloured by height, the path predicted with its
// minutes, the plan, every unit about (the real traffic, a mission's, the ships) and the players — their labels never
// covering one another.
import { drawFields } from "../../world/runwaydraw";
import { fieldShown, fieldsNearCached } from "../../world/runways";
import coastlines from "../coastlines.json";
import { C, D, fmt, Labels, missileCue, type Pen, ramp, SIDE, trailDots, unitSymbol, type Point, type Rect } from "./kit";
import { LAND } from "./land";
import { mercX, mercY, metresPerPx, night, TILE_CREDIT, type Tiles } from "./tiles";
import { EARTH_CREDIT, type EarthGlobe } from "./earth";
import type { Scene } from "./scene";

const COAST = coastlines as number[][][];

export interface GeoView {
  globe: boolean;
  lat: number;
  lon: number;
  /** the globe: its scale (1: the disc in the view); the map: the Web Mercator zoom level */
  zoom: number;
  tiles?: Tiles;
  /** the globe's photographed Earth (draw/earth.ts) and the Sun's point lighting it */
  earth?: EarthGlobe;
  sun?: { lat: number; lon: number } | null;
  dpr?: number;
  pick?: (pt: Point, what: { slot?: number; contact?: string; wp?: number }) => void;
}

let stars: { w: number; h: number; pts: [number, number, number][] } | null = null;
function starfield(w: number, h: number) {
  if (stars && stars.w === w && stars.h === h) return stars.pts;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pts: [number, number, number][] = [];
  for (let i = 0; i < Math.min(600, (w * h) / 900); i++) pts.push([rnd() * w, rnd() * h, rnd() ** 3]);
  stars = { w, h, pts };
  return pts;
}

export function drawGeo(p: Pen, r: Rect, sc: Scene, v: GeoView) {
  const c = p.c,
    u = sc.u,
    own = sc.own;
  const W = r.w,
    H = r.h,
    cx = r.x + W / 2,
    cy = r.y + H / 2;
  const R = Math.max(20, Math.min(W, H) * 0.42 * v.zoom);
  const lat0 = v.lat * D,
    lon0 = v.lon * D;
  const sl0 = Math.sin(lat0),
    cl0 = Math.cos(lat0);
  const S = 256 * 2 ** v.zoom,
    mx0 = mercX(v.lon) * S,
    my0 = mercY(v.lat) * S;
  const earth = !own || own.body === "earth";
  /** the screen's point, and whether it is on the globe's near side */
  const proj = (lat: number, lon: number): [number, number, boolean] => {
    if (!v.globe) {
      let dx = mercX(lon) * S - mx0;
      if (dx > S / 2) dx -= S;
      else if (dx < -S / 2) dx += S;
      return [cx + dx, cy + mercY(lat) * S - my0, true];
    }
    const ph = lat * D,
      l = lon * D - lon0;
    const cp = Math.cos(ph),
      sp = Math.sin(ph),
      cl = Math.cos(l);
    const z = sl0 * sp + cl0 * cp * cl;
    return [cx + R * cp * Math.sin(l), cy - R * (cl0 * sp - sl0 * cp * cl), z >= 0];
  };
  const at = (lat: number, lon: number): Point | null => {
    const q = proj(lat, lon);
    return q[2] ? [q[0], q[1]] : null;
  };
  const jump = v.globe ? Infinity : Math.min(W * 0.6, S / 2);
  const mpp = v.globe ? 6.371e6 / R : metresPerPx(v.lat, v.zoom);
  const labels = new Labels(p);
  let photo = false;
  c.save();
  p.round(r.x, r.y, W, H, 10);
  c.clip();
  if (v.globe) {
    c.fillStyle = "#020408";
    c.fillRect(r.x, r.y, W, H);
    for (const [x, y, b] of starfield(Math.round(W), Math.round(H))) {
      c.globalAlpha = 0.25 + b * 0.75;
      c.fillStyle = b > 0.6 ? "#dfefff" : "#8fb3c9";
      c.fillRect(r.x + x, r.y + y, b > 0.8 ? 2 : 1, b > 0.8 ? 2 : 1);
    }
    c.globalAlpha = 1;
    // (the Earth photographed, lit, when its imagery has come — else the shaded vector globe)
    photo = earth && !!v.earth?.draw(c, r, { lat: v.lat, lon: v.lon, R, cx, cy, sun: v.sun ?? null }, v.dpr ?? 1);
  }
  if (v.globe && !photo) {
    const halo = c.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.12);
    halo.addColorStop(0, "#3fb6ff66");
    halo.addColorStop(0.4, "#1a6fd022");
    halo.addColorStop(1, "#00000000");
    p.circle(cx, cy, R * 1.12);
    p.fill(halo);
    const sea = c.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    sea.addColorStop(0, "#1b4c6e");
    sea.addColorStop(0.6, "#0d2b42");
    sea.addColorStop(1, "#06121d");
    p.circle(cx, cy, R);
    p.fill(sea);
  }
  if (v.globe) {
    c.save();
    p.circle(cx, cy, R);
    c.clip();
    if (photo) c.globalAlpha = 0.3;
    for (let la = -75; la < 90; la += 15) {
      p.path(Array.from({ length: 121 }, (_, i) => at(la, i * 3 - 180)));
      p.stroke(la === 0 ? C.grid2 : C.grid, 1);
    }
    for (let lo = -180; lo < 180; lo += 15) {
      p.path(Array.from({ length: 61 }, (_, i) => at(i * 3 - 90, lo)));
      p.stroke(lo === 0 ? C.grid2 : C.grid, 1);
    }
    c.globalAlpha = 1;
  } else {
    c.fillStyle = "#0a1620";
    c.fillRect(r.x, r.y, W, H);
  }
  // the land: vector (the globe's, the map's while its tiles come or offline), then the map's tiles over it
  const tiled = earth && !v.globe && !!v.tiles?.online;
  if (earth && !photo) {
    // (under the tiles the day's colours: inverted with them, the night's sea and land where none has come yet)
    if (tiled) {
      c.fillStyle = "#aad3df";
      c.fillRect(r.x, r.y, W, H);
    }
    c.beginPath();
    for (const ring of LAND) {
      if (v.globe) {
        ring.pts.forEach(([lo, la], i) => {
          const q = proj(la, lo);
          let x = q[0],
            y = q[1];
          if (!q[2]) {
            const d = Math.hypot(x - cx, y - cy) || 1;
            x = cx + ((x - cx) / d) * R;
            y = cy + ((y - cy) / d) * R;
          }
          if (i) c.lineTo(x, y);
          else c.moveTo(x, y);
        });
        c.closePath();
        continue;
      }
      for (const o of [-1, 0, 1]) {
        const x0 = cx + (mercX(ring.lo) + o) * S - mx0,
          x1 = cx + (mercX(ring.hi) + o) * S - mx0;
        if (x1 < r.x || x0 > r.x + W) continue;
        ring.pts.forEach(([lo, la], i) => {
          const x = cx + (mercX(lo) + o) * S - mx0,
            y = cy + mercY(la) * S - my0;
          if (i) c.lineTo(x, y);
          else c.moveTo(x, y);
        });
        c.closePath();
      }
    }
    const land = c.createLinearGradient(0, r.y, 0, r.y + H);
    land.addColorStop(0, "#14302f");
    land.addColorStop(1, "#0e2524");
    p.fill(tiled ? "#f2efe9" : land);
    if (tiled) {
      v.tiles!.draw(c, r, mercX(v.lon), mercY(v.lat), v.zoom, v.dpr ?? 1);
      night(c, r);
    } else {
      c.beginPath();
      for (const line of COAST) {
        let prev: Point | null = null;
        for (const q of line) {
          const s = at(q[1]!, q[0]!);
          if (!s) {
            prev = null;
            continue;
          }
          if (prev && Math.abs(s[0] - prev[0]) < jump) c.lineTo(s[0], s[1]);
          else c.moveTo(s[0], s[1]);
          prev = s;
        }
      }
      c.globalAlpha = 0.16;
      p.stroke(C.coast, 4);
      c.globalAlpha = 1;
      p.stroke("#5fc3da", 1.1);
    }
  } else if (!earth && own)
    p.text(own.body.toUpperCase(), cx, cy, { col: "#ffffff10", size: Math.min(W, H) * 0.12, align: "center", weight: 800 });
  if (!v.globe) {
    const vg = c.createRadialGradient(cx, cy, Math.min(W, H) * 0.35, cx, cy, Math.hypot(W, H) * 0.6);
    vg.addColorStop(0, "#00000000");
    vg.addColorStop(1, "#000000a0");
    c.fillStyle = vg;
    c.fillRect(r.x, r.y, W, H);
  }
  // the world's airfields (src/world/runways.ts — PLAN-RADAR-AAA RD11): the map's level of detail, about its centre
  if (earth && !v.globe) {
    const reach = (Math.max(W, H) / 2) * mpp;
    drawFields(c, fieldsNearCached(`geo${Math.round(reach)}`, v.lat, v.lon, reach * 1.2, (f) => fieldShown(f, reach)).slice(0, 300), {
      at,
      mpp,
      labels: true,
      marked: new Set((sc.snap?.route ?? []).map((q) => q.name.toUpperCase())),
      box: r,
    });
  } else if (earth && v.globe && R > 3000) {
    drawFields(c, fieldsNearCached("globe", v.lat, v.lon, (6.371e6 * 2) / Math.max(R / 400, 1), (f) => f.kind === "large").slice(0, 200), {
      at,
      mpp,
      labels: false,
    });
  }
  // the zones
  for (const z of sc.zones) {
    const q = at(z.lat, z.lon);
    if (!q) continue;
    const rr = Math.max(4, z.r / mpp);
    p.circle(q[0], q[1], rr);
    if (z.kind === "threat") {
      p.fill("#ff4d4d1c");
      p.stroke(C.red, 1.4, [7, 5]);
    } else {
      p.fill("#ffb43c14");
      p.stroke(C.amber, 1.6, z.waiting ? [4, 6] : []);
    }
    labels.put(z.name, q[0] - p.width(z.name, 10, 700) / 2, q[1] - rr - 5, {
      col: z.kind === "threat" ? C.red : C.amber,
      size: 10,
      weight: 700,
    });
  }
  // the trail, coloured by height
  const hist = sc.history.slice(-600).filter((h) => h.geo && h.body === own?.body);
  if (hist.length > 1) {
    const hs = hist.map((h) => h.metrics.alt ?? 0);
    const lo = Math.min(...hs),
      hi = Math.max(...hs, lo + 1);
    let prev: Point | null = null;
    for (let i = 0; i < hist.length; i++) {
      const g = hist[i]!.geo!;
      const q = at(g.lat, g.lon);
      if (q && prev && Math.abs(q[0] - prev[0]) < jump) {
        c.beginPath();
        c.moveTo(prev[0], prev[1]);
        c.lineTo(q[0], q[1]);
        c.globalAlpha = 0.3 + (0.7 * i) / hist.length;
        p.stroke(ramp((hs[i]! - lo) / (hi - lo)), 3);
      }
      prev = q;
    }
    c.globalAlpha = 1;
  }
  const snap = sc.snap;
  // the plan
  if (snap?.route.length) {
    const act = snap.nav?.active ?? -1;
    p.path(
      snap.route.map((w) => at(w.lat, w.lon)),
      jump,
    );
    p.glow(C.magenta, 2, 0.22);
    snap.route.forEach((w, i) => {
      const q = at(w.lat, w.lon);
      if (!q) return;
      p.star(q[0], q[1], 7, C.magenta, i === act);
      labels.keep(q[0], q[1], 7);
      v.pick?.(q, { wp: i });
      labels.put(w.name, q[0] + 9, q[1] - 7, { col: i === act ? C.white : C.magenta, size: 11, weight: 700, bg: "#050a0ed0" }, true);
    });
  }
  // the path predicted (its hidden side cut on the globe), its minutes ticked
  if (snap?.ahead.length) {
    const pts = snap.ahead.map((q) => proj(q.lat, q.lon));
    c.beginPath();
    let prev: [number, number, boolean] | null = null;
    for (const q of pts) {
      if (prev?.[2] && q[2] && Math.abs(q[0] - prev[0]) < jump) c.lineTo(q[0], q[1]);
      else c.moveTo(q[0], q[1]);
      prev = q;
    }
    p.glow(C.amber, 2, 0.22);
    let next = 60;
    snap.ahead.forEach((a, i) => {
      const q = pts[i]!;
      if (a.t === undefined || a.t < next || !q[2]) return;
      next = (Math.floor(a.t / 60) + 1) * 60;
      p.circle(q[0], q[1], 3);
      p.fill(C.amber);
    });
    const end = snap.ahead.at(-1)!;
    const q = at(end.lat, end.lon);
    if (q && end.t !== undefined) labels.put(`+${Math.round(end.t / 60)} min`, q[0] + 6, q[1] - 6, { col: C.amber, size: 10, weight: 700 });
  }
  // the players first (their labels win), then everything about
  const placed: { cr: (typeof sc.crafts)[number]; q: Point }[] = [];
  for (const cr of sc.crafts) {
    if (!cr.geo || (own && cr.body !== own.body)) continue;
    const q = at(cr.geo.lat, cr.geo.lon);
    if (q) {
      placed.push({ cr, q });
      labels.keep(q[0], q[1], 14);
    }
  }
  if (!v.globe) {
    labels.keepRect(r.x, r.y + H - 52, 280, 52);
    labels.keepRect(r.x + W - 70, r.y + H - 130, 70, 130);
    labels.keepRect(r.x + W - 230, r.y, 230, 26);
  }
  // (the units' labels after the players': theirs win the room)
  const later: (() => void)[] = [];
  const nameZoom = v.globe ? v.zoom > 2.5 : v.zoom >= 8;
  for (const t of sc.contacts) {
    const q = at(t.lat, t.lon);
    if (!q || q[0] < r.x - 20 || q[0] > r.x + W + 20 || q[1] < r.y - 20 || q[1] > r.y + H + 20) continue;
    trailDots(p, t, sc.trails, at);
    if (missileCue(p, q[0], q[1], t)) continue;
    // (the truth on the map; what the pilot's sensors do not hold faded — RD6)
    unitSymbol(p, q[0], q[1], t.kind, t.kind === "decoy" ? t.type : t.side, t.hdg, 0, t.kind === "sea" ? 6 : 5, {
      tcas: t.adv,
      ...(t.sensors === 0 || t.state === "truth" ? { state: "truth" as const } : {}),
      ...(t.locked ? { locked: true } : {}),
    });
    const col = SIDE[t.side] ?? C.white;
    if (nameZoom || t.side !== "traffic") {
      const alt = t.kind === "air" && t.alt !== null && v.zoom >= 9 && !v.globe ? ` ${fmt(u.alt(t.alt) / 100)}` : "";
      later.push(() => labels.put(`${t.name}${alt}`, q[0] + 9, q[1] + 4, { col: `${col}dd`, size: 10, weight: 600 }));
    }
    v.pick?.(q, { contact: t.id });
  }
  for (const { cr, q } of placed) {
    const sel = cr === own;
    const geo = cr.geo!;
    if (sel) {
      const halo = c.createRadialGradient(q[0], q[1], 0, q[0], q[1], 34);
      halo.addColorStop(0, `${C.cyan}55`);
      halo.addColorStop(1, `${C.cyan}00`);
      p.circle(q[0], q[1], 34);
      p.fill(halo);
      // the heading's line, a minute ahead
      if (!v.globe && Number.isFinite(sc.s.gs)) {
        const len = Math.min(400, (sc.s.gs * 60) / mpp);
        p.seg(q[0], q[1], q[0] + Math.sin(geo.heading) * len, q[1] - Math.cos(geo.heading) * len, `${C.white}88`, 1.2, [2, 4]);
      }
    }
    c.save();
    c.translate(q[0], q[1]);
    c.rotate(geo.heading);
    p.aircraft(sel ? 26 : 20, cr.age > 3 ? C.dim : cr.member.colour, "#000");
    c.restore();
    // (its name and figures beside it — right, left, above, below: where they cover nothing)
    const alt = cr.metrics.alt;
    const sub =
      alt !== undefined
        ? `${fmt(u.alt(alt))} ${u.altName.toLowerCase()} · ${fmt(u.spd(cr.metrics.speed ?? 0))} ${u.spdName.toLowerCase()}`
        : "";
    const wN = Math.max(p.width(cr.member.name, 12, 700), sub ? p.width(sub, 10) : 0);
    const spots: [number, number][] = [
      [q[0] + 18, q[1] - 3],
      [q[0] - 18 - wN, q[1] - 3],
      [q[0] - wN / 2, q[1] - 30],
      [q[0] - wN / 2, q[1] + 30],
      [q[0] + 18, q[1] + 26],
      [q[0] - 18 - wN, q[1] + 26],
    ];
    const at2 = labels.putAny(cr.member.name, spots, { col: C.white, size: 12, weight: 700, bg: "#050a0ed8" }, sel);
    if (at2 && sub) labels.put(sub, at2[0], at2[1] + 15, { col: C.text, size: 10, bg: "#050a0ec0" }, true);
    v.pick?.(q, { slot: cr.member.slot });
  }
  for (const f of later) f();
  if (v.globe) c.restore();
  c.restore();
  if (photo)
    p.text(EARTH_CREDIT(), r.x + W - 8, r.y + H - 6, {
      col: "#9fb3bdcc",
      size: 9,
      align: "right",
      font: "system-ui, sans-serif",
      bg: "#050a0e99",
    });
  // the scale and the credits (the map)
  if (!v.globe) {
    const want = mpp * W * 0.18;
    const unit = u.distM;
    const pow = 10 ** Math.floor(Math.log10(want / unit));
    const nice = [1, 2, 5, 10].map((m) => m * pow).find((m) => m * unit >= want * 0.6) ?? pow;
    const px = (nice * unit) / mpp;
    const x0 = r.x + 14,
      y0 = r.y + H - 22;
    p.round(x0 - 8, y0 - 22, px + 16, 30, 6);
    p.fill("#050a0ec0");
    p.seg(x0, y0, x0 + px, y0, C.white, 2);
    p.seg(x0, y0 - 5, x0, y0 + 2, C.white, 2);
    p.seg(x0 + px, y0 - 5, x0 + px, y0 + 2, C.white, 2);
    p.text(`${fmt(nice, nice < 1 ? 1 : 0)} ${u.distName.toLowerCase()}`, x0 + px / 2, y0 - 8, {
      col: C.white,
      size: 10,
      align: "center",
      weight: 600,
    });
    if (tiled)
      p.text(TILE_CREDIT, r.x + W - 80, r.y + 16, {
        col: "#b9cbd4",
        size: 10,
        align: "right",
        font: "system-ui, sans-serif",
        bg: "#050a0eb0",
      });
    p.text(`N ▲  z${fmt(v.zoom, 1)}`, r.x + W - 10, r.y + 16, { col: C.dim, size: 10, align: "right", weight: 700 });
  }
}
