// The A320's MCDU's lateral pages (docs/PLAN-A320.md, A9 — FlightGear's Nasal/MCDU/F-PLN.nas, LATREV.nas, DIRTO.nas):
// F-PLN — the plan's waypoints in order (the active leg's "to" white, the others green), each leg's course and
// distance, the times over them, their speed and altitude constraints (magenta), the destination's time, distance and
// fuel; a waypoint typed on a line inserted before it (an airfield's code, a lat/lon, a place/bearing/distance), CLR
// deleting it, a constraint typed on its right —; LAT REV — DIR TO it, the next waypoint after it, a new destination
// —; DIR TO — a waypoint typed or chosen, then INSERT.

import type { Waypoint } from "../../game/flightplan";
import type { LskResult, Mcdu, Page } from "./mcdu";
import { brackets, MC, type Line, padR, type Run, run, type Screen } from "./screen";
import { distAlong, fieldWp, hhmm, legInto, parseLatLon, parsePbd, tons, trip } from "./util";

const FT = 0.3048;
const KT = 0.514444;

/** A waypoint from the scratchpad: an airfield's code (the database), a lat/lon, a place/bearing/distance, or one of
 *  the plan by its name (a copy). */
export function resolveWp(m: Mcdu, sp: string): Waypoint | "format" | "notindb" {
  const R = m.host.route();
  const ll = parseLatLon(sp);
  if (ll) return { name: `LL${String(R.wps.filter((w) => w.name.startsWith("LL")).length + 1).padStart(2, "0")}`, ...ll };
  const place = (n: string) => {
    const w = R.wps.find((x) => x.name === n);
    if (w) return w;
    const f = m.host.field(n);
    return f ? { lat: f.lat, lon: f.lon } : null;
  };
  if (sp.includes("/")) {
    const p = parsePbd(sp, place);
    return p ?? "format";
  }
  if (!/^[A-Z0-9]{2,7}$/.test(sp)) return "format";
  const own = R.wps.find((x) => x.name === sp);
  if (own) return { name: own.name, lat: own.lat, lon: own.lon, ...(own.field ? { field: { ...own.field } } : {}) };
  const f = m.host.field(sp);
  return f ? fieldWp(f) : "notindb";
}

/** the altitude's text: a flight level above 18 000 ft ("FL350"), else feet */
const altText = (ft: number) => (ft >= 18000 ? `FL${String(Math.round(ft / 100)).padStart(3, "0")}` : String(Math.round(ft / 10) * 10));

/** the times over the plan's waypoints from here (the ground speed's, 450 kt at least once in the air): a time for
 *  each index from the active one */
function etas(m: Mcdu): Map<number, Date> {
  const R = m.host.route();
  const g = m.host.geo();
  const out = new Map<number, Date>();
  const act = m.host.activeWp();
  const gs = Math.max((g?.gs ?? 0) / KT, m.host.onGround() ? 0 : 200, 1);
  const kt = m.host.onGround() ? 450 : gs;
  const t0 = m.host.now().getTime();
  let nm = 0;
  for (let i = Math.max(act, 0); i < R.wps.length; i++) {
    nm = distAlong(R, g, act, i);
    out.set(i, new Date(t0 + (nm / kt + (m.host.onGround() ? 0.25 : 0)) * 3_600_000));
  }
  return out;
}

const fpln: Page = {
  screen(m): Screen {
    const R = m.host.route();
    const W = R.wps;
    const act = m.host.activeWp();
    const T = etas(m);
    const F = m.host.fms;
    const lines: Line[] = [];
    m.fplnTop = Math.min(Math.max(m.fplnTop, 0), Math.max(W.length - 1, 0));
    for (let k = 0; k < 5; k++) {
      const i = m.fplnTop + k;
      const w = W[i];
      if (!w) {
        if (i === W.length) lines.push({ l: [run(W.length ? "------END OF F-PLN------" : "------NO F-PLN------", MC.white)] });
        else lines.push({});
        continue;
      }
      const leg = legInto(R, i);
      // (the columns as the real page's: the name, the time from column 8, the speed / altitude right; above each the
      // leg's course and its distance)
      const head = k === 0 && i === 0 ? padR(" FROM", 9) : leg ? padR(` C${String(leg.crs).padStart(3, "0")}°`, 9) : padR("", 9);
      const ls: Run[] = [run(head, k === 0 && i === 0 ? MC.white : MC.green)];
      if (k === 0) ls.push(run("TIME", MC.white));
      else if (leg) ls.push(run(`${Math.round(leg.nm)}NM`, MC.green));
      const rs: Run[] = k === 0 ? [run("SPD/ALT ", MC.white)] : [];
      const col = i === act ? MC.white : MC.green;
      const name = w.field
        ? `${w.name}${w.field.rwy !== undefined ? String(Math.round(w.field.rwy / 10) || 36).padStart(2, "0") : ""}`
        : w.name;
      const eta = T.get(i);
      // (the constraint, magenta; else the predicted level: the field's, the cruise's)
      const cstr = w.alt !== undefined || w.spd !== undefined;
      const alt =
        w.alt !== undefined
          ? altText(w.alt / FT)
          : w.field
            ? String(Math.round(w.field.elev / FT))
            : `FL${String(Math.round(R.cruiseAlt / FT / 100)).padStart(3, "0")}`;
      const spd = w.spd !== undefined ? String(Math.round(w.spd / KT)) : "---";
      lines.push({
        ls,
        rs,
        l: [run(padR(name, 8), col), run(eta ? hhmm(eta) : "----", col, true)],
        r: [run(`${cstr ? "*" : ""}${spd}/${alt}`, cstr ? MC.magenta : col, !cstr)],
      });
    }
    // (the destination: its time, its distance, the fuel left there)
    const dest = W.at(-1);
    const nm = dest ? distAlong(R, m.host.geo(), act) : 0;
    const efob = m.host.fobKg() / 1000 - trip(nm, m.host.onGround()).t - (m.host.onGround() ? F.taxi : 0);
    lines.push({
      ls: [run(" DEST   TIME  DIST  EFOB", MC.white)],
      l: [run(dest ? dest.name : "----", MC.white)],
      c: [run(dest && T.get(W.length - 1) ? hhmm(T.get(W.length - 1)!) : "----", MC.green)],
      r: [run(dest ? `${String(Math.round(nm)).padStart(4)} ${tons(Math.max(efob, 0)).padStart(4)}` : "---- ----", MC.green)],
    });
    return { title: [run("FROM", MC.white, true), run(`  ${F.fltNbr || ""}`, MC.white, true)], lines, ud: W.length > 4 };
  },
  lsk(m, side, n, sp): LskResult {
    if (n > 5) return;
    const R = m.host.route();
    const i = m.fplnTop + n - 1;
    const w = R.wps[i];
    if (side === "L") {
      if (!w) {
        // (the line after the last: a waypoint typed there appended)
        if (i !== R.wps.length || !sp || sp === "CLR") return;
        const nw = resolveWp(m, sp);
        if (typeof nw === "string") return nw;
        R.wps.push(nw);
        m.host.routeChanged();
        return true;
      }
      if (!sp) {
        m.latRev = i;
        m.open("latrev");
        return;
      }
      if (sp === "CLR") {
        if (i === 0 || i === R.wps.length - 1) return "notallowed";
        R.wps.splice(i, 1);
        m.host.routeChanged();
        return true;
      }
      const nw = resolveWp(m, sp);
      if (typeof nw === "string") return nw;
      R.wps.splice(Math.max(i, 1), 0, nw);
      m.host.routeChanged();
      return true;
    }
    // (the right: a constraint — "250/FL100", "/5000", "250/" — or CLR)
    if (!w || !sp) return;
    if (sp === "CLR") {
      delete w.alt;
      delete w.spd;
      m.host.routeChanged();
      return true;
    }
    const p = /^(\d{3})?(?:\/(?:FL(\d{1,3})|(\d{3,5})))?$/.exec(sp);
    if (!p || (!p[1] && !p[2] && !p[3])) return "format";
    if (p[1]) w.spd = Number(p[1]) * KT;
    if (p[2]) w.alt = Number(p[2]) * 100 * FT;
    if (p[3]) w.alt = Number(p[3]) * FT;
    m.host.routeChanged();
    return true;
  },
  arrow(m, dir) {
    const W = m.host.route().wps;
    if (dir === "up") m.fplnTop = Math.min(m.fplnTop + 1, Math.max(W.length - 1, 0));
    else if (dir === "down") m.fplnTop = Math.max(m.fplnTop - 1, 0);
    else return false;
    return true;
  },
};

const latrev: Page = {
  screen(m): Screen {
    const R = m.host.route();
    const w = R.wps[m.latRev];
    const lines: Line[] = [
      { l: [run("<DIR TO")], r: [run("FIX INFO>", MC.white)] },
      { rs: [run("LL XING/INCR/NO")], r: [run("[  ]°/[ ]°/[]", MC.cyan, true)] },
      { rs: [run("NEXT WPT ")], r: [brackets(6)] },
      { rs: [run("NEW DEST ")], r: [brackets(5)] },
      {},
      { l: [run("<RETURN")] },
    ];
    if (m.latRev === 0 && w?.field) lines[0]!.l = [run("<DEPARTURE")];
    return {
      title: [run("LAT REV ", MC.white), run("FROM ", MC.white, true), run(w?.name ?? "----", MC.green)],
      lines,
    };
  },
  lsk(m, side, n, sp): LskResult {
    const R = m.host.route();
    const i = m.latRev;
    const key = `${side}${n}`;
    if (key === "L6") return m.open("fpln");
    if (key === "L1") {
      if (i === 0) return "notallowed";
      m.host.directTo(i);
      m.open("fpln");
      return;
    }
    if (!sp || sp === "CLR") return sp === "CLR" ? "notallowed" : undefined;
    if (key === "R3") {
      const nw = resolveWp(m, sp);
      if (typeof nw === "string") return nw;
      R.wps.splice(Math.min(i + 1, Math.max(R.wps.length - 1, 1)), 0, nw);
      m.host.routeChanged();
      m.open("fpln");
      return true;
    }
    if (key === "R4") {
      const f = m.host.field(sp);
      if (!f) return "notindb";
      const nw = fieldWp(f);
      R.wps.splice(i + 1, R.wps.length - i - 1, nw);
      m.host.fms.to = nw.name;
      m.host.routeChanged();
      m.open("fpln");
      return true;
    }
    return "notallowed";
  },
};

const dirto: Page = {
  screen(m): Screen {
    const R = m.host.route();
    const act = Math.max(m.host.activeWp(), 0);
    const list = R.wps.map((w, i) => ({ w, i })).filter((x) => x.i >= act);
    m.dirTop = Math.min(Math.max(m.dirTop, 0), Math.max(list.length - 4, 0));
    const sel = m.dirSel !== null ? R.wps[m.dirSel] : null;
    const lines: Line[] = [{ ls: [run(" WAYPOINT")], l: [sel ? run(sel.name, MC.yellow) : brackets(10)], rs: [run("DIST  UTC ")] }];
    for (let k = 0; k < 4; k++) {
      const x = list[m.dirTop + k];
      lines.push(x ? { ls: k === 0 ? [run(" F-PLN WPTS")] : [], l: [run(`<${x.w.name}`, MC.white)] } : {});
    }
    lines.push(sel ? { l: [run("<ERASE", MC.amber)], r: [run("INSERT*", MC.amber)] } : {});
    return { title: [run("DIR TO")], lines, ud: list.length > 4 };
  },
  lsk(m, side, n, sp): LskResult {
    const R = m.host.route();
    const act = Math.max(m.host.activeWp(), 0);
    const key = `${side}${n}`;
    if (key === "L6") {
      m.dirSel = null;
      return;
    }
    if (key === "R6") {
      if (m.dirSel === null) return;
      m.host.directTo(m.dirSel);
      m.dirSel = null;
      m.open("fpln");
      return;
    }
    if (key === "L1") {
      if (!sp || sp === "CLR") return;
      const at = R.wps.findIndex((w, i) => i >= act && w.name === sp);
      if (at >= 0) {
        m.dirSel = at;
        return true;
      }
      const nw = resolveWp(m, sp);
      if (typeof nw === "string") return nw;
      // (a waypoint off the plan: put before the active one, to fly to it then the rest)
      R.wps.splice(Math.max(act, 1), 0, nw);
      m.host.routeChanged();
      m.dirSel = Math.max(act, 1);
      return true;
    }
    if (side === "L" && n >= 2 && n <= 5) {
      const list = R.wps.map((_, i) => i).filter((i) => i >= act);
      const i = list[m.dirTop + n - 2];
      if (i === undefined) return;
      m.dirSel = i;
      return;
    }
  },
  arrow(m, dir) {
    if (dir === "up") m.dirTop++;
    else if (dir === "down") m.dirTop = Math.max(m.dirTop - 1, 0);
    else return false;
    return true;
  },
};

export const FPLN_PAGES: Record<string, Page> = { fpln, latrev, dirto };
