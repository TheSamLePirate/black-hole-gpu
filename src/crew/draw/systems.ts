// The systems' synoptic: the engine, the fuel (its bingo, endurance and range, what the plan leaves), the
// configuration (the gear's lights, the flaps, the air brake, STOVL), the load and the incidence, the structure's
// heat, the orbit drawn, the autopilot's and the assistance's modes, the alerts — cards laid out to the width.
import { C, clamp, D, deg360, dur, fmt, type Pen, TAU, type Rect } from "./kit";
import type { Scene } from "./scene";

const ok = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

function arc(
  p: Pen,
  cx: number,
  cy: number,
  R: number,
  v: number | null,
  lo: number,
  hi: number,
  bands: [number, number, string][],
  col = C.white,
) {
  const a0 = Math.PI * 0.75,
    a1 = Math.PI * 2.25;
  const at = (x: number) => a0 + ((clamp(x, lo, hi) - lo) / (hi - lo)) * (a1 - a0);
  p.c.beginPath();
  p.c.arc(cx, cy, R, a0, a1);
  p.stroke("#1d3340", R * 0.16);
  for (const [b0, b1, bc] of bands) {
    p.c.beginPath();
    p.c.arc(cx, cy, R, at(b0), at(b1));
    p.stroke(bc, R * 0.16);
  }
  if (ok(v)) {
    p.c.beginPath();
    p.c.arc(cx, cy, R * 0.82, a0, at(v));
    p.glow(col, R * 0.07, 0.2);
    const a = at(v);
    p.seg(cx, cy, cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92, col, 2.5);
  }
  p.circle(cx, cy, 4);
  p.fill(C.white);
}

function bar(p: Pen, x: number, y: number, w: number, h: number, f: number | null, col: string, label: string, value: string) {
  p.text(label, x, y - 5, { col: C.dim, size: 10, weight: 600 });
  p.text(value, x + w, y - 5, { col: C.text, size: 10, align: "right", weight: 700 });
  p.round(x, y, w, h, h / 2);
  p.fill("#14242e");
  if (ok(f) && f > 0) {
    p.round(x, y, Math.max(h, w * clamp(f, 0, 1)), h, h / 2);
    p.fill(col);
  }
}

function lamp(p: Pen, x: number, y: number, w: number, on: boolean, text: string, col = C.green) {
  p.round(x, y, w, 22, 4);
  p.fill(on ? `${col}26` : "#0c161d");
  p.stroke(on ? col : "#22333d", 1.2);
  p.text(text, x + w / 2, y + 15, { col: on ? col : "#4c616c", size: 10, align: "center", weight: 700 });
}

type Card = { title: string; h: number; draw: (r: Rect) => void };

export function drawSystems(p: Pen, r: Rect, sc: Scene) {
  const snap = sc.snap,
    sys = snap?.sys,
    f = snap?.flight,
    a = snap?.auto,
    u = sc.u,
    s = sc.s;
  const m = sc.own?.metrics ?? {};
  const cards: Card[] = [];
  // the engine
  cards.push({
    title: `MOTEUR · ${(sys?.engine || "—").toUpperCase()}`,
    h: 190,
    draw: (q) => {
      const R = Math.max(14, Math.min(q.w * 0.19, 52));
      const spool = sys?.spool ?? m.throttle ?? null;
      const gx = q.x + R + 16;
      arc(p, gx, q.y + R + 34, R, ok(spool) ? spool * 100 : null, 0, 110, [[100, 110, "#ff4d4d66"]], C.green);
      p.text(ok(spool) ? `${fmt(spool * 100)}%` : "—", gx, q.y + R * 1.62 + 38, { col: C.white, size: 15, align: "center", weight: 700 });
      p.text("RÉGIME", gx, q.y + R * 2 + 52, { col: C.dim, size: 9, align: "center", weight: 600 });
      const x = q.x + R * 2 + 34,
        w = q.x + q.w - 12 - x;
      bar(p, x, q.y + 46, w, 7, m.throttle ?? null, C.cyan, "GAZ", ok(m.throttle) ? `${fmt(m.throttle * 100)} %` : "—");
      bar(p, x, q.y + 80, w, 7, ok(sys?.ab) ? sys!.ab! / 5 : null, C.amber, "PC", ok(sys?.ab) && sys!.ab! > 0 ? `${fmt(sys!.ab)}` : "—");
      p.text("POUSSÉE", x, q.y + 108, { col: C.dim, size: 9, weight: 600 });
      p.text(ok(sys?.thrust) ? `${fmt(sys!.thrust, 1)} kN` : "—", x, q.y + 124, { col: C.white, size: 13, weight: 700 });
      p.text("DÉBIT", x, q.y + 146, { col: C.dim, size: 9, weight: 600 });
      p.text(ok(sys?.flow) ? `${fmt(sys!.flow! * 3600)} kg/h` : "—", x, q.y + 162, { col: C.white, size: 13, weight: 700 });
    },
  });
  // the fuel
  const fuelKg = sys?.fuelKg ?? null,
    full = sys?.fuelFull ?? null;
  const frac = ok(fuelKg) && ok(full) && full > 0 ? fuelKg / full : (m.fuel ?? null);
  cards.push({
    title: "CARBURANT",
    h: 190,
    draw: (q) => {
      const tx = q.x + 14,
        ty = q.y + 32,
        tw = 34,
        th = q.h - 50;
      p.round(tx, ty, tw, th, 8);
      p.fill("#0c1a22");
      if (ok(frac)) {
        const fh = th * clamp(frac, 0, 1);
        const g = p.c.createLinearGradient(0, ty + th - fh, 0, ty + th);
        const col = frac < 0.1 ? C.red : frac < 0.25 ? C.amber : C.green;
        g.addColorStop(0, col);
        g.addColorStop(1, `${col}55`);
        p.round(tx, ty + th - fh, tw, fh, 8);
        p.fill(g);
      }
      p.round(tx, ty, tw, th, 8);
      p.stroke("#2b4655", 1.4);
      const nav = snap?.nav;
      if (ok(nav?.bingo) && ok(full) && full > 0) {
        const y = ty + th * (1 - clamp(nav!.bingo! / full, 0, 1));
        p.seg(tx - 6, y, tx + tw + 6, y, C.amber, 2);
      }
      const x = q.x + 60,
        w = q.w - 72;
      const row = (y: number, k: string, v: string, col = C.white) => {
        p.text(k, x, y, { col: C.dim, size: 9, weight: 600 });
        p.text(v, x + w, y, { col, size: 12, align: "right", weight: 700 });
      };
      row(q.y + 46, "RESTANT", ok(fuelKg) ? `${fmt(fuelKg)} kg` : ok(frac) ? `${fmt(frac * 100)} %` : "—");
      const flow = sys?.flow;
      const endu = ok(fuelKg) && ok(flow) && flow > 1e-4 ? fuelKg / flow : null;
      row(q.y + 72, "AUTONOMIE", dur(endu));
      row(q.y + 98, "RAYON", ok(endu) && ok(s.gs) ? `${fmt(u.dist(endu * s.gs))} ${u.distName.toLowerCase()}` : "—");
      if (nav && ok(nav.fuelToGo) && ok(fuelKg)) {
        const left = fuelKg - nav.fuelToGo;
        row(q.y + 124, "ARRIVÉE", `${fmt(left)} kg`, ok(nav.bingo) && left < 0 ? C.red : left < 900 ? C.amber : C.green);
        row(q.y + 150, "BINGO", ok(nav.bingo) ? `${fmt(nav.bingo)} kg` : "—", C.amber);
      } else if (ok(frac)) row(q.y + 124, "NIVEAU", `${fmt(frac * 100)} %`);
    },
  });
  // the configuration
  cards.push({
    title: "CONFIGURATION",
    h: 190,
    draw: (q) => {
      const size = Math.min(q.w * 0.24, 62),
        k = size / 10;
      const cx = q.x + q.w * 0.27,
        cy = q.y + 34 + size * 1.15;
      p.c.save();
      p.c.translate(cx, cy);
      p.aircraft(size, "#1c3442", "#3f6577");
      p.c.restore();
      const gear = sys?.gear ?? 0,
        down = !!sys?.gearDown;
      const col = down && gear >= 0.99 ? C.green : gear > 0.01 || down ? C.amber : "#33444e";
      for (const [gx, gy] of [
        [0, -5.5],
        [-2.6, 2.8],
        [2.6, 2.8],
      ] as const) {
        p.round(cx + gx * k - 6, cy + gy * k - 6, 12, 12, 3);
        p.fill(col === "#33444e" ? "#0b141a" : `${col}44`);
        p.stroke(col, 1.6);
      }
      const label = down ? (gear >= 0.99 ? "TRAIN SORTI" : "TRAIN EN SORTIE") : gear > 0.01 ? "TRAIN EN RENTRÉE" : "TRAIN RENTRÉ";
      p.text(label, cx, cy + size * 1.25 + 8, { col: gear > 0.01 || down ? col : C.dim, size: 10, align: "center", weight: 700 });
      const x = q.x + q.w * 0.56,
        w = q.w * 0.4;
      bar(p, x, q.y + 46, w, 8, sys?.flaps ?? null, C.cyan, "VOLETS", ok(sys?.flaps) ? `${fmt(sys!.flaps * 100)} %` : "—");
      bar(p, x, q.y + 84, w, 8, sys?.brake ?? null, C.amber, "AÉROFREIN", ok(sys?.brake) ? `${fmt(sys!.brake * 100)} %` : "—");
      lamp(p, x, q.y + 108, w, !!sys?.stovl, sys?.stovl ? `STOVL ${sys.stovl}` : "STOVL", C.cyan);
      lamp(p, x, q.y + 136, w, !!a?.sas, "SAS");
    },
  });
  // the load and the incidence
  cards.push({
    title: "CHARGE · INCIDENCE",
    h: 190,
    draw: (q) => {
      const R = Math.max(14, Math.min(q.w * 0.17, 50));
      const gMax = f?.gMax ?? 9;
      const g = Number.isFinite(s.g) ? s.g : null;
      const g1 = q.x + q.w * 0.27;
      arc(
        p,
        g1,
        q.y + R + 30,
        R,
        g,
        -3,
        gMax + 1,
        [
          [gMax, gMax + 1, "#ff4d4d88"],
          [-3, -1, "#ffb43c55"],
        ],
        g !== null && g > gMax * 0.9 ? C.red : C.cyan,
      );
      p.text(g === null ? "—" : `${fmt(g, 1)}g`, g1, q.y + R * 1.62 + 34, { col: C.white, size: 14, align: "center", weight: 700 });
      p.text(`LIMITE ${fmt(gMax, 1)}`, g1, q.y + R * 2 + 50, { col: C.dim, size: 9, align: "center" });
      const cx = q.x + q.w * 0.73;
      const aoa = Number.isFinite(s.aoa) ? s.aoa / D : null;
      const st = ok(f?.stallAoa) ? f!.stallAoa! / D : 20;
      arc(
        p,
        cx,
        q.y + R + 30,
        R,
        aoa,
        -5,
        Math.max(30, st * 1.3),
        [[st, Math.max(30, st * 1.3), "#ff4d4d88"]],
        aoa !== null && aoa > st * 0.85 ? C.amber : C.green,
      );
      p.text(aoa === null ? "—" : `${fmt(aoa, 1)}°`, cx, q.y + R * 1.62 + 34, { col: C.white, size: 14, align: "center", weight: 700 });
      p.text("INCIDENCE α", cx, q.y + R * 2 + 50, { col: C.dim, size: 9, align: "center" });
      if (ok(f?.buffet) && f!.buffet! > 0.05)
        p.text(`BUFFETING ${fmt(f!.buffet! * 100)} %`, q.x + q.w / 2, q.y + q.h - 10, {
          col: C.amber,
          size: 10,
          align: "center",
          weight: 700,
        });
    },
  });
  // the structure and the air
  cards.push({
    title: "STRUCTURE · AIR",
    h: 190,
    draw: (q) => {
      const x = q.x + 14,
        w = q.w - 28;
      bar(
        p,
        x,
        q.y + 46,
        w,
        8,
        sys?.hull ?? null,
        ok(sys?.hull) && sys!.hull! > 0.8 ? C.red : C.amber,
        "TEMPÉRATURE COQUE",
        ok(sys?.hull) ? `${fmt(sys!.hull! * 100)} %` : "—",
      );
      bar(p, x, q.y + 82, w, 8, sys?.shield ?? null, C.cyan, "BOUCLIER THERMIQUE", ok(sys?.shield) ? `${fmt(sys!.shield! * 100)} %` : "—");
      bar(p, x, q.y + 118, w, 8, sys?.damage ?? null, C.red, "DOMMAGES", ok(sys?.damage) ? `${fmt(sys!.damage! * 100)} %` : "—");
      const cells: [string, string][] = [
        ["MASSE", ok(sys?.mass) ? `${fmt(sys!.mass! / 1000, 1)} t` : "—"],
        ["PRESSION DYN.", ok(m.q) ? `${fmt(m.q / 1000, 1)} kPa` : "—"],
        ["FLUX", ok(m.heat) ? `${fmt(m.heat / 1e4, 1)} W/cm²` : "—"],
      ];
      cells.forEach(([k, v], i) => {
        const cx = q.x + (q.w / 3) * (i + 0.5);
        p.text(k, cx, q.y + 150, { col: C.dim, size: 9, align: "center", weight: 600 });
        p.text(v, cx, q.y + 168, { col: C.white, size: 12, align: "center", weight: 700 });
      });
    },
  });
  // the autopilot and the assistance
  cards.push({
    title: "PILOTE AUTOMATIQUE · ASSISTANCE",
    h: 190,
    draw: (q) => {
      const cols = 3,
        gw = (q.w - 28 - (cols - 1) * 6) / cols;
      const lamps: [string, boolean, string][] = [
        [a?.alt != null ? `ALT ${fmt(u.alt(a.alt))}` : "ALT", a?.alt != null, C.green],
        [a?.hdg != null ? `CAP ${String(Math.round(deg360(a.hdg)) % 360).padStart(3, "0")}` : "CAP", a?.hdg != null, C.green],
        [a?.spd != null ? `VIT ${fmt(u.spd(a.spd))}` : "A/THR", a?.spd != null, C.green],
        ["LNAV", !!a?.lnav, C.magenta],
        ["VNAV", !!a?.vnav, C.magenta],
        ["PC", !!a?.ab, C.amber],
        [a?.auto && a.auto !== "none" ? a.auto.toUpperCase() : "AUTO", !!a?.auto && a.auto !== "none", C.cyan],
        [a?.hold && a.hold !== "none" ? a.hold.toUpperCase() : "TENUE", !!a?.hold && a.hold !== "none", C.cyan],
        [a?.order || "ORDRE", !!a?.order, C.cyan],
      ];
      lamps.forEach(([t, on, col], i) =>
        lamp(p, q.x + 14 + (i % cols) * (gw + 6), q.y + 34 + Math.floor(i / cols) * 28, gw, on, t.slice(0, 14), col),
      );
      p.text(`ASSISTANCE ${(a?.assist || "—").toUpperCase()} · MODE ${(a?.mode || "—").toUpperCase()}`, q.x + 14, q.y + 134, {
        col: C.cyan,
        size: 10,
        weight: 700,
      });
      const hub = a?.hub;
      if (hub) {
        p.text(`${hub.title} · ${hub.phase}`.slice(0, 48), q.x + 14, q.y + 154, { col: C.white, size: 11, weight: 700 });
        if (ok(hub.bar)) bar(p, q.x + 14, q.y + 166, q.w - 28, 6, hub.bar, C.cyan, "", "");
        if (hub.next) p.text(hub.next.slice(0, 56), q.x + 14, q.y + q.h - 6, { col: C.dim, size: 10 });
      }
    },
  });
  // the orbit, when there is one
  const orb = snap?.orbit;
  if (orb)
    cards.push({
      title: `ORBITE · ${(snap?.body ?? "").toUpperCase()}`,
      h: 190,
      draw: (q) => {
        const cx = q.x + q.w * 0.3,
          cy = q.y + 104;
        const Rb = 6371,
          rp = Rb + orb.pe,
          ra = orb.ap > 0 ? Rb + orb.ap : rp * 3;
        const aa = (rp + ra) / 2,
          e = (ra - rp) / (ra + rp),
          b = aa * Math.sqrt(1 - e * e);
        const k = Math.min((q.w * 0.26) / aa, 62 / b);
        p.circle(cx + (aa - rp) * k, cy, Rb * k);
        const body = p.c.createRadialGradient(cx + (aa - rp) * k - 6, cy - 6, 2, cx + (aa - rp) * k, cy, Rb * k);
        body.addColorStop(0, "#2d7fb8");
        body.addColorStop(1, "#0b2a44");
        p.fill(body);
        p.c.beginPath();
        p.c.ellipse(cx, cy, aa * k, b * k, 0, 0, TAU);
        p.glow(C.cyan, 1.6, 0.2);
        p.circle(cx - aa * k, cy, 3.5);
        p.fill(C.green);
        p.text("Pe", cx - aa * k - 6, cy - 6, { col: C.green, size: 10, align: "right", weight: 700 });
        if (orb.ap > 0) {
          p.circle(cx + aa * k, cy, 3.5);
          p.fill(C.amber);
          p.text("Ap", cx + aa * k + 6, cy - 6, { col: C.amber, size: 10, weight: 700 });
        }
        const x = q.x + q.w * 0.62,
          w = q.w * 0.34;
        const row = (y: number, k2: string, v: string) => {
          p.text(k2, x, y, { col: C.dim, size: 10, weight: 600 });
          p.text(v, x + w, y, { col: C.white, size: 12, align: "right", weight: 700 });
        };
        row(q.y + 46, "APOGÉE", orb.ap > 0 ? `${fmt(orb.ap)} km` : "∞");
        row(q.y + 68, "PÉRIGÉE", `${fmt(orb.pe)} km`);
        row(q.y + 90, "INCLINAISON", `${fmt(orb.inc, 1)}°`);
        row(q.y + 112, "EXCENTRICITÉ", fmt(orb.ecc, 3));
        row(q.y + 134, "PÉRIODE", dur(orb.period));
        row(q.y + 156, "→ Ap / Pe", `${dur(orb.tAp)} / ${dur(orb.tPe)}`);
      },
    });
  // the alerts and the next event
  const warn = snap?.warn ?? [];
  cards.push({
    title: "ALERTES · ÉVÉNEMENTS",
    h: 190,
    draw: (q) => {
      if (!warn.length) p.text("AUCUNE ALERTE", q.x + q.w / 2, q.y + 70, { col: C.green, size: 13, align: "center", weight: 700 });
      const gw = (q.w - 34) / 2;
      warn.slice(0, 8).forEach((w, i) => {
        const red = /PULL|FLY|STALL|G-LOC|MISSILE|OVER|IMPACT|FAIL/.test(w);
        const blink = red && Math.floor(sc.now * 2.5) % 2 === 0;
        lamp(p, q.x + 14 + (i % 2) * (gw + 6), q.y + 34 + Math.floor(i / 2) * 28, gw, !blink || !red, w, red ? C.red : C.amber);
      });
      const next = snap?.next;
      if (next) {
        const name = { impact: "IMPACT", exit: "SORTIE SOI", enter: "ENTRÉE SOI", mouth: "BOUCHE" }[next.kind] ?? next.kind.toUpperCase();
        p.text(`${name} ${next.name} · ${dur(next.in)}`, q.x + 14, q.y + q.h - 14, {
          col: next.kind === "impact" ? C.red : C.cyan,
          size: 11,
          weight: 700,
        });
      }
      if (ok(f?.terrain) && f!.terrain! < 60)
        p.text(`SOL DANS ${dur(f!.terrain!)}`, q.x + 14, q.y + q.h - 32, {
          col: f!.terrain! < 15 ? C.red : C.amber,
          size: 11,
          weight: 700,
        });
    },
  });
  // the layout: columns to the width, the cards' heights shared out to fill the height when they fit
  const cols = r.w > 1000 ? 4 : r.w > 640 ? 3 : r.w > 380 ? 2 : 1;
  const gap = 10;
  const cw = (r.w - gap * (cols + 1)) / cols;
  const rows = Math.ceil(cards.length / cols);
  const ch = Math.max(180, (r.h - gap * (rows + 1)) / rows);
  cards.forEach((card, i) => {
    const q = { x: r.x + gap + (i % cols) * (cw + gap), y: r.y + gap + Math.floor(i / cols) * (ch + gap), w: cw, h: ch };
    if (q.y > r.y + r.h) return;
    p.panel(q, card.title, 10);
    p.c.save();
    p.clip(q);
    const dy = Math.max(0, Math.min(40, (q.h - 200) / 2));
    card.draw({ ...q, y: q.y + dy, h: Math.min(q.h - dy, 200) });
    p.c.restore();
  });
}

/** the synoptic's own height for a width (its canvas scrolls when the cards do not fit) */
export function systemsHeight(w: number, n = 8) {
  const cols = w > 1000 ? 4 : w > 640 ? 3 : w > 380 ? 2 : 1;
  return Math.ceil(n / cols) * 190 + (Math.ceil(n / cols) + 1) * 10;
}
