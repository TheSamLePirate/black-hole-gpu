// The flight plan: its vertical profile (the planned levels and constraints, the descent's top, the height the path
// predicted will fly, the craft) over the distance to go, and its legs' table — the active one magenta —, with what is
// left of the time and the fuel at the arrival.
import { C, clamp, dur, fmt, type Pen, polar, type Rect } from "./kit";
import type { Scene } from "./scene";
import { L, locale } from "../lang";

/** the plan in r, scrolled; each leg's row given to `pick` (its rectangle, its waypoint's index) */
export function drawPlan(p: Pen, r: Rect, sc: Scene, scroll = 0, pick?: (q: Rect, wp: number) => void) {
  const snap = sc.snap,
    u = sc.u,
    s = sc.s,
    nav = snap?.nav;
  const route = snap?.route ?? [];
  const geo = sc.own?.geo;
  if (!route.length || !geo) {
    p.panel(r, L("PLAN DE VOL", "FLIGHT PLAN"));
    p.text(L("Aucun plan de vol transmis", "No flight plan sent"), r.x + r.w / 2, r.y + r.h / 2 - 10, {
      col: C.dim,
      size: 14,
      align: "center",
      weight: 700,
    });
    p.text(
      L("Le pilote le crée dans son panneau Plan de vol (avion, Terre).", "The pilot makes it in his Flight plan panel (aircraft, Earth)."),
      r.x + r.w / 2,
      r.y + r.h / 2 + 12,
      {
        col: C.dim,
        size: 11,
        align: "center",
      },
    );
    const hub = snap?.auto?.hub,
      next = snap?.next;
    if (hub)
      p.text(`${hub.title} · ${hub.phase}${hub.next ? ` · ${hub.next}` : ""}`, r.x + r.w / 2, r.y + r.h / 2 + 44, {
        col: C.cyan,
        size: 11,
        align: "center",
      });
    if (next)
      p.text(
        `${L("Prochain événement", "Next event")} : ${next.kind} ${next.name} ${L("dans", "in")} ${dur(next.in)}`,
        r.x + r.w / 2,
        r.y + r.h / 2 + 64,
        {
          col: C.amber,
          size: 11,
          align: "center",
        },
      );
    return;
  }
  const act = clamp(nav?.active ?? 1, 0, route.length - 1);
  // the distances along: to the active point, then the legs
  const legs: { name: string; leg: number; cum: number; alt?: number; spd?: number; i: number }[] = [];
  let cum = 0,
    from: { lat: number; lon: number } = geo;
  for (let i = act; i < route.length; i++) {
    const w = route[i]!;
    const leg = i === act && nav ? nav.dist : polar(from.lat, from.lon, w.lat, w.lon).d;
    cum += leg;
    legs.push({ name: w.name, leg, cum, alt: w.alt, spd: w.spd, i });
    from = w;
  }
  const total = Math.max(cum, 1);
  const narrow = r.w < 620;
  const vsd = { x: r.x, y: r.y - scroll, w: r.w, h: narrow ? Math.max(200, r.h * 0.42) : Math.max(230, r.h * 0.48) };
  // ---- the profile
  p.panel(vsd, L("PROFIL VERTICAL", "VERTICAL PROFILE"));
  const g = { x: vsd.x + 58, y: vsd.y + 34, w: vsd.w - 76, h: vsd.h - 64 };
  const cruise = nav?.cruiseAlt ?? Math.max(...legs.map((l) => l.alt ?? 0), s.alt || 0);
  const ahead = snap?.ahead ?? [];
  const aheadPts: [number, number][] = [];
  let ad = 0,
    prev: { lat: number; lon: number } = geo;
  for (const q of ahead) {
    ad += polar(prev.lat, prev.lon, q.lat, q.lon).d;
    prev = q;
    if (q.h !== undefined && ad <= total * 1.02) aheadPts.push([ad, q.h]);
  }
  const hiAlt = Math.max(cruise, s.alt || 0, ...legs.map((l) => l.alt ?? 0), ...aheadPts.map((a) => a[1])) * 1.15 + 100;
  const X = (d: number) => g.x + (d / total) * g.w,
    Y = (h: number) => g.y + g.h - (Math.max(h, 0) / hiAlt) * g.h;
  for (let j = 0; j <= 4; j++) {
    const h = (hiAlt * j) / 4;
    p.seg(g.x, Y(h), g.x + g.w, Y(h), C.grid, 1);
    p.text(fmt(u.alt(h)), g.x - 6, Y(h) + 4, { col: C.dim, size: 9, align: "right" });
  }
  for (let j = 0; j <= 4; j++) {
    const d = (total * j) / 4;
    p.text(`${fmt(u.dist(d))}`, X(d), g.y + g.h + 14, { col: C.dim, size: 9, align: "center" });
  }
  p.text(u.distName.toLowerCase(), g.x + g.w, g.y + g.h + 26, { col: C.dim, size: 9, align: "right" });
  // the planned levels: the cruise between the constraints, the 3° descent before them
  const plan: [number, number][] = [[0, Number.isFinite(s.alt) ? s.alt : cruise]];
  for (const l of legs) plan.push([l.cum, l.alt ?? cruise]);
  const fill = p.c.createLinearGradient(0, g.y, 0, g.y + g.h);
  fill.addColorStop(0, "#ff5ce122");
  fill.addColorStop(1, "#ff5ce100");
  p.c.beginPath();
  p.c.moveTo(X(0), Y(0));
  for (const [d, h] of plan) p.c.lineTo(X(d), Y(h));
  p.c.lineTo(X(total), Y(0));
  p.c.closePath();
  p.fill(fill);
  p.path(plan.map(([d, h]) => [X(d), Y(h)]));
  p.glow(C.magenta, 1.8, 0.2);
  for (const l of legs) {
    const x = X(l.cum),
      y = Y(l.alt ?? cruise);
    p.seg(x, g.y, x, g.y + g.h, "#ff5ce133", 1, [2, 4]);
    p.star(x, y, 6, C.magenta, l.i === act);
    p.text(l.name, x, g.y - 6, { col: l.i === act ? C.white : C.magenta, size: 10, align: "center", weight: 700 });
    if (l.alt !== undefined) {
      p.seg(x - 8, y + 9, x + 8, y + 9, C.amber, 1.5);
      p.seg(x - 8, y - 9, x + 8, y - 9, C.amber, 1.5);
    }
  }
  if (nav?.tod != null && nav.tod > 0 && nav.tod < total) {
    const x = X(nav.tod),
      y = Y(cruise);
    p.circle(x, y, 5);
    p.stroke(C.green, 2);
    p.text("T/D", x, y - 10, { col: C.green, size: 10, align: "center", weight: 700 });
  }
  // the predicted heights
  if (aheadPts.length > 1) {
    p.path(aheadPts.map(([d, h]) => [X(d), Y(h)]));
    p.stroke(C.green, 1.8, [6, 4]);
  }
  // the craft
  const cy = Y(Number.isFinite(s.alt) ? s.alt : 0);
  p.c.save();
  p.c.translate(X(0), cy);
  p.c.rotate(Math.PI / 2 - (Number.isFinite(s.fpa) ? s.fpa : 0));
  p.aircraft(18, C.amber, "#000");
  p.c.restore();
  // ---- the legs' table
  const ty = vsd.y + vsd.h + 10;
  const rowH = 30;
  const th = Math.max(r.y + r.h - ty + scroll, 70 + legs.length * rowH + 64);
  const tbl = { x: r.x, y: ty, w: r.w, h: th };
  p.panel(tbl, `PLAN · ${route[0]?.name ?? ""} → ${route.at(-1)?.name ?? ""}`);
  const gs = Number.isFinite(s.gs) && s.gs > 5 ? s.gs : (nav?.cruiseSpd ?? 0);
  const cols = narrow
    ? [
        ["POINT", 0.04, "left"],
        ["DIST", 0.42, "right"],
        ["ETE", 0.66, "right"],
        ["ALT", 0.96, "right"],
      ]
    : [
        ["POINT", 0.03, "left"],
        ["BRANCHE", 0.3, "right"],
        ["CUMUL", 0.44, "right"],
        ["ETE", 0.58, "right"],
        ["ETA", 0.7, "right"],
        ["ALT", 0.84, "right"],
        ["VIT", 0.97, "right"],
      ];
  const hy = ty + 42;
  // (the columns' heads in the console's language — their keys stay)
  const head: Record<string, string> = {
    POINT: L("POINT", "WPT"),
    BRANCHE: L("BRANCHE", "LEG"),
    CUMUL: L("CUMUL", "CUM"),
    VIT: L("VIT", "SPD"),
  };
  for (const [t, f, al] of cols)
    p.text(head[t as string] ?? (t as string), tbl.x + tbl.w * (f as number), hy, {
      col: C.dim,
      size: 10,
      align: al as CanvasTextAlign,
      weight: 700,
    });
  p.seg(tbl.x + 10, hy + 8, tbl.x + tbl.w - 10, hy + 8, C.grid2);
  const clock = new Date();
  legs.forEach((l, j) => {
    const y = hy + 30 + j * rowH;
    const on = l.i === act;
    pick?.({ x: tbl.x + 6, y: y - 19, w: tbl.w - 12, h: rowH - 4 }, l.i);
    if (on) {
      p.round(tbl.x + 6, y - 19, tbl.w - 12, rowH - 4, 5);
      p.fill("#ff5ce11c");
    }
    const ete = gs > 5 ? l.cum / gs : null;
    const eta = ete !== null ? new Date(clock.getTime() + ete * 1000) : null;
    const vals: Record<string, string> = {
      POINT: l.name,
      BRANCHE: `${fmt(u.dist(l.leg), 1)}`,
      DIST: `${fmt(u.dist(l.cum), 1)}`,
      CUMUL: `${fmt(u.dist(l.cum), 1)}`,
      ETE: dur(ete),
      ETA: eta ? eta.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) : "—",
      ALT: l.alt !== undefined ? fmt(u.alt(l.alt)) : `(${fmt(u.alt(cruise))})`,
      VIT: l.spd !== undefined ? fmt(u.spd(l.spd)) : `(${fmt(u.spd(nav?.cruiseSpd ?? 0))})`,
    };
    for (const [t, f, al] of cols)
      p.text(vals[t as string] ?? "", tbl.x + tbl.w * (f as number), y, {
        col: on ? (t === "POINT" ? C.magenta : C.white) : t === "ALT" && l.alt === undefined ? C.dim : C.text,
        size: 12,
        align: al as CanvasTextAlign,
        weight: t === "POINT" ? 700 : 500,
      });
  });
  // what is left at the arrival
  const fy = hy + 30 + legs.length * rowH + 10;
  p.seg(tbl.x + 10, fy - 16, tbl.x + tbl.w - 10, fy - 16, C.grid2);
  const fuel = snap?.sys?.fuelKg;
  const left = nav?.fuelToGo != null && fuel != null ? fuel - nav.fuelToGo : null;
  const items: [string, string, string][] = [
    [L("RESTE", "TO GO"), `${fmt(u.dist(total), 1)} ${u.distName.toLowerCase()}`, C.white],
    [L("TEMPS", "TIME"), dur(nav?.timeToGo ?? (gs > 5 ? total / gs : null)), C.white],
    [
      L("CARB. ARRIVÉE", "FUEL AT DEST."),
      left !== null ? `${fmt(left)} kg` : "—",
      left !== null && nav?.bingo != null && left < 0 ? C.red : C.green,
    ],
    ["PHASE", (nav?.phase || "—").toUpperCase(), C.cyan],
  ];
  items.forEach(([k, v, col], i) => {
    const x = tbl.x + 14 + (i * (tbl.w - 28)) / items.length;
    p.text(k, x, fy + 2, { col: C.dim, size: 9, weight: 700 });
    p.text(v, x, fy + 20, { col, size: 13, weight: 700 });
  });
}

/** the plan's height for a width (its canvas scrolls when it is taller) */
export function planHeight(sc: Scene, w: number, h: number) {
  const n = Math.max(1, (sc.snap?.route.length ?? 0) - (sc.snap?.nav?.active ?? 1) + 1);
  const narrow = w < 620;
  const vsd = narrow ? Math.max(200, h * 0.42) : Math.max(230, h * 0.48);
  return Math.max(h, vsd + 10 + 70 + n * 30 + 64);
}
