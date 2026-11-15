// The crew's Approach view (docs/PLAN-APPROCHES.md §5.3, AP6): the approach the pilot flies or has chosen, laid out as an
// approach chart would — produced by us from the game's data, not a published chart reproduced —: above, the plan view (the final
// course up, the runway, the localizer's cone, the fixes and their altitudes, the join planned, the missed approach, the hold, the
// craft live); on the side, its words (the approach, its source, its fixes and altitudes, the decision; what is chosen and
// flown, and why); below, the vertical profile (the relief under the final, the 3° slope, the fixes, the craft).

import { drawApproach, drawApproachProfile } from "../../world/approach-draw";
import { drawFields } from "../../world/runwaydraw";
import { fieldsNearCached } from "../../world/runways";
import { L } from "../lang";
import { C, fmt, type Pen, type Point, type Rect } from "./kit";
import type { Scene } from "./scene";

export function drawApproachView(p: Pen, r: Rect, sc: Scene) {
  const c = p.c,
    u = sc.u;
  const A = sc.snap?.apprMap ?? null;
  c.fillStyle = C.bg;
  c.fillRect(r.x, r.y, r.w, r.h);
  if (!A) {
    p.text(
      L(
        "Aucune approche choisie ni volée — la boîte APP du MCP, la carte ou le radar la choisissent",
        "No approach chosen nor flown — the MCP's APP box, the map or the radar choose one",
      ),
      r.x + r.w / 2,
      r.y + r.h / 2,
      { col: C.dim, size: 13, align: "center" },
    );
    return;
  }
  const side = r.w > 760 ? 260 : 0;
  const plan = { x: r.x + 8, y: r.y + 8, w: r.w - side - 16, h: Math.round(r.h * 0.64) - 12 };
  const prof = { x: r.x + 8, y: plan.y + plan.h + 8, w: r.w - side - 16, h: r.y + r.h - (plan.y + plan.h + 8) - 8 };
  // the plan view: centred 12 km before the threshold, the final course up, 32 km across its narrower side
  const D = Math.PI / 180;
  const cr = A.crs * D;
  const cosL = Math.cos(A.thr.lat * D);
  const mpp = 32_000 / Math.min(plan.w, plan.h);
  const cx = plan.x + plan.w / 2,
    cy = plan.y + plan.h / 2;
  // (a place's offsets from the threshold [m], turned so the final course points up; the centre 12 km before it)
  const at = (lat: number, lon: number): Point | null => {
    const e = (lon - A.thr.lon) * 111_320 * cosL,
      n = (lat - A.thr.lat) * 111_320;
    const along = e * Math.sin(cr) + n * Math.cos(cr);
    const across = e * Math.cos(cr) - n * Math.sin(cr);
    const x = cx + across / mpp,
      y = cy - (along + 12_000) / mpp;
    return x < plan.x - 40 || x > plan.x + plan.w + 40 || y < plan.y - 40 || y > plan.y + plan.h + 40 ? null : [x, y];
  };
  c.save();
  p.round(plan.x, plan.y, plan.w, plan.h, 8);
  c.fillStyle = "#06101a";
  c.fill();
  c.clip();
  // (the airfields there, their runways at scale)
  drawFields(c, fieldsNearCached("crew-appr", A.thr.lat, A.thr.lon, 25_000).slice(0, 30), { at, mpp, labels: true });
  const geo = sc.own?.geo ?? null;
  drawApproach(c, A, { at, from: A.engaged && geo ? [geo.lat, geo.lon] : undefined, alt: (m) => `${fmt(u.alt(m))}` });
  // (the craft live: a white triangle on its heading, turned as the chart)
  if (geo) {
    const q = at(geo.lat, geo.lon);
    if (q) {
      c.save();
      c.translate(q[0], q[1]);
      c.rotate((Number.isFinite(sc.s.hdg) ? sc.s.hdg : 0) - cr);
      c.fillStyle = C.white;
      c.beginPath();
      c.moveTo(0, -9);
      c.lineTo(6, 7);
      c.lineTo(-6, 7);
      c.closePath();
      c.fill();
      c.restore();
    }
  }
  // (the scale: 5 km)
  const bar = 5000 / mpp;
  p.seg(plan.x + 12, plan.y + plan.h - 14, plan.x + 12 + bar, plan.y + plan.h - 14, C.dim, 2);
  p.text(`${fmt(u.dist(5000), 0)} ${u.distName.toLowerCase()}`, plan.x + 12 + bar + 6, plan.y + plan.h - 10, { col: C.dim, size: 10 });
  c.restore();
  // the profile
  drawApproachProfile(c, A, prof, geo && Number.isFinite(sc.s.alt) ? { lat: geo.lat, lon: geo.lon, alt: sc.s.alt } : null, {
    alt: (m) => `${fmt(u.alt(m))}`,
    label: `${fmt(u.dist(25_000), 0)} ${u.distName.toLowerCase()} · ${u.altName}`,
  });
  // the words
  if (side) {
    const x = r.x + r.w - side + 4;
    let y = r.y + 24;
    const line = (s: string, o: { col?: string; size?: number; weight?: number } = {}) => {
      p.text(s, x, y, { col: o.col ?? C.text, size: o.size ?? 12, weight: o.weight ?? 500 });
      y += (o.size ?? 12) + 7;
    };
    line(`${A.field} ${A.id}`, { col: A.engaged ? C.magenta : C.cyan, size: 18, weight: 700 });
    line(A.label, { col: C.dim });
    line(A.engaged ? L("Volée", "Flown") : L("Choisie", "Chosen"), { col: A.engaged ? C.magenta : C.cyan, weight: 700 });
    y += 4;
    line(L("Repères", "Fixes"), { col: C.dim, weight: 700 });
    for (const F of A.fixes.slice(0, 12)) {
      const a = F.alt;
      const alt = a
        ? a[0] !== null && a[1] !== null && a[0] === a[1]
          ? `${fmt(u.alt(a[0]))}`
          : a[0] !== null
            ? `≥ ${fmt(u.alt(a[0]))}`
            : a[1] !== null
              ? `≤ ${fmt(u.alt(a[1]))}`
              : ""
        : "";
      line(`${F.role === "fix" ? "   " : F.role.padEnd(3)} ${F.name.padEnd(6)} ${alt}${alt ? ` ${u.altName}` : ""}`, { size: 11 });
    }
    // (the highest relief under the final, 25 km out: not a published MSA — said as what it is)
    if (A.profile) {
      const top = Math.max(...A.profile.ground);
      y += 4;
      line(`${L("Relief max sous la finale", "Highest relief under the final")} : ${fmt(u.alt(top))} ${u.altName}`, {
        size: 11,
        col: C.amber,
      });
    }
    const why = sc.snap?.appr?.flown?.why;
    if (why) {
      y += 4;
      line(L("Pourquoi", "Why"), { col: C.dim, weight: 700 });
      line(why.slice(0, 40), { size: 11 });
      if (why.length > 40) line(why.slice(40, 80), { size: 11 });
    }
  }
}
