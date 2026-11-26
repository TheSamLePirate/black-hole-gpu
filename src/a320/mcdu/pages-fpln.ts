// The A320's MCDU's lateral pages (docs/PLAN-A320.md, A9 — FlightGear's Nasal/MCDU/F-PLN.nas, LATREV.nas, DIRTO.nas):
// F-PLN — the plan's waypoints in order (the active leg's "to" white, the others green), each leg's course and
// distance, the times over them, their speed and altitude constraints (magenta), the destination's time, distance and
// fuel; a waypoint typed on a line inserted before it (an airfield's code, a lat/lon, a place/bearing/distance), CLR
// deleting it, a constraint typed on its right —; LAT REV — DIR TO it, the next waypoint after it, a new destination
// —; DIR TO — a waypoint typed or chosen, then INSERT.

import type { Waypoint } from "../../game/flightplan";
import type { Approach } from "../../world/approaches";
import { insertTerminal, type Terminal, terminalsFor, terminalWaypoints } from "../../world/terminals";
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
  if (f) return fieldWp(f);
  // (a radio aid or a fix of the navigation database — PLAN-A320-VOL-AAA N1)
  const n = m.host.navPoint?.(sp);
  return n ? { name: n.id, lat: n.lat, lon: n.lon, nav: { kind: n.kind, ...(n.freq ? { freq: n.freq } : {}) } } : "notindb";
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
      // (a leg along an airway: its name, as the MCDU writes it; else the course)
      const via = w.nav?.via;
      const head =
        k === 0 && i === 0
          ? padR(" FROM", 9)
          : via
            ? padR(` ${via}`, 9)
            : leg
              ? padR(` C${String(leg.crs).padStart(3, "0")}°`, 9)
              : padR("", 9);
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
      { r: m.latRev < R.wps.length - 1 && m.host.airway ? [run("AIRWAYS>")] : [] },
      { l: [run("<RETURN")] },
    ];
    if (m.latRev === 0 && w?.field) lines[0]!.l = [run("<DEPARTURE")];
    // (the destination's: its arrival — PLAN-APPROCHES AP3)
    if (m.latRev > 0 && m.latRev === R.wps.length - 1 && w?.field && m.host.approaches) lines[0]!.r = [run("ARRIVAL>")];
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
    // (AIRWAYS — PLAN-A320-VOL-AAA N2: from this waypoint, VIA an airway TO a point of it)
    if (key === "R5" && i < R.wps.length - 1 && m.host.airway) return m.open("airways");
    if (key === "R1" && i > 0 && i === R.wps.length - 1 && R.wps[i]?.field && m.host.approaches) {
      m.arrTop = 0;
      m.arrMode = "appr";
      m.arrApp = m.arrVia = null;
      return m.open("arrival");
    }
    if (key === "L1") {
      if (i === 0) {
        if (!R.wps[0]?.field || !m.host.terminals) return "notallowed";
        m.depMode = "rwy";
        m.depTop = 0;
        m.depRwy = m.depSid = m.depTrans = null;
        return m.open("departure");
      }
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

/** The destination's code and its approaches (the host's: real and built). */
function arrivalOf(m: Mcdu): { code: string; list: Approach[] } | null {
  const dest = m.host.route().wps.at(-1);
  if (!dest?.field) return null;
  const code = dest.field.icao ?? dest.name;
  const list = m.host.approaches?.(code);
  return list ? { code, list } : null;
}
/** The destination's STARs for the approach's runway (all while none is chosen) and the one in the plan (its points' marks). */
function starOf(m: Mcdu, a: Approach | null): { list: Terminal[]; active: { star: string; trans: string | null } | null } {
  const R = m.host.route();
  const dest = R.wps.at(-1);
  const T = dest?.field && m.host.terminals ? m.host.terminals(dest.field.icao ?? dest.name) : null;
  const w = R.wps.find((x) => x.proc?.star);
  return {
    list: T ? terminalsFor(T.star, a?.rwy ?? null) : [],
    active: w?.proc?.star ? { star: w.proc.star, trans: w.proc.trans ?? null } : null,
  };
}
const srcOf = (a: Approach) => (a.source === "cifp" ? "FAA" : a.source === "navdat" ? "NAVDAT" : "BUILT");
// (the published transitions only — the CIFP's —: a built approach's IAF on the axis is no VIA)
const viasOf = (a: Approach) => (a.source === "cifp" ? a.transitions.map((t) => t[0]?.fix ?? "").filter(Boolean) : []);

/**
 * ARRIVAL (PLAN-APPROCHES AP3, the A320's FMS): the destination's approaches — ILS, LOC, RNAV, VOR… the FAA's published ones, nav.dat's
 * ILS, the built ones —, then the chosen one's transitions (VIAS); INSERT selects it (the simulation's approach state: the crew,
 * TARS and the ILS read the same) and puts its fixes in the plan. Temporary choices yellow, the active one green.
 */
const arrival: Page = {
  screen(m): Screen {
    const A = arrivalOf(m);
    const sel = m.host.approachSel?.();
    const active = A && sel && (sel.field === A.code || A.list.some((a) => a.field === sel.field)) ? sel : null;
    const app = m.arrApp ?? (active && active.approach !== "auto" ? active.approach : null);
    const via = m.arrVia ?? (active && active.via !== "auto" ? active.via : null);
    const tmp = m.arrApp !== null || m.arrVia !== null;
    const col = tmp ? MC.yellow : MC.green;
    const lines: Line[] = [
      {
        ls: [run(" APPR"), run("      VIA", MC.white)],
        l: [run(app ?? "------", app ? col : MC.white), run(`  ${via ?? (app ? "NO VIA" : "------")}`, via || app ? col : MC.white)],
      },
    ];
    const a = A?.list.find((x) => x.id === app) ?? null;
    // (the STAR — PLAN-A320-VOL-AAA N2: the CIFP's, for the approach's runway; its en-route transition)
    const st = starOf(m, a);
    const star = m.arrStar ?? st.active?.star ?? null;
    const trans = m.arrTrans ?? (m.arrStar === null ? (st.active?.trans ?? null) : null);
    const stTmp = m.arrStar !== null || m.arrTrans !== null;
    lines[0]!.rs = [run("STAR ")];
    lines[0]!.r = [run(star ? `${star}${trans ? `.${trans}` : ""}` : "------", star ? (stTmp ? MC.yellow : MC.green) : MC.white)];
    const sT = st.list.find((x) => x.id === star) ?? null;
    const items: { label: string; right: string }[] =
      m.arrMode === "via" && a
        ? [{ label: "NO VIA", right: "VECTORS" }, ...viasOf(a).map((v) => ({ label: v, right: "" }))]
        : m.arrMode === "star"
          ? [
              { label: "NO STAR", right: "" },
              ...st.list.map((x) => ({ label: x.id, right: x.enroute.length ? `${x.enroute.length} TRANS` : "" })),
            ]
          : m.arrMode === "trans" && sT
            ? [{ label: "NO TRANS", right: "" }, ...sT.enroute.map((x) => ({ label: x.name, right: "" }))]
            : (A?.list ?? []).map((x) => ({
                label: x.id,
                right: `${x.kind}${x.loc?.cat ? ` CAT ${x.loc.cat}` : ""} ${srcOf(x)}`,
              }));
    m.arrTop = Math.min(Math.max(m.arrTop, 0), Math.max(items.length - 3, 0));
    const right = st.list.length
      ? m.arrMode === "star" && sT?.enroute.length
        ? [run("TRANS>")]
        : m.arrMode === "star"
          ? []
          : [run("STARS>")]
      : [];
    lines.push(
      m.arrMode === "via"
        ? { ls: [run(" VIAS")], l: [run("<APPR")], r: right }
        : m.arrMode === "star"
          ? { ls: [run(" STARS")], l: [run("<APPR")], r: right }
          : m.arrMode === "trans"
            ? { ls: [run(" TRANS")], l: [run("<APPR")], r: [run("STARS>")] }
            : { ls: [run(" APPR AVAILABLE")], l: a && viasOf(a).length ? [run("<VIAS")] : [], r: right },
    );
    for (let k = 0; k < 3; k++) {
      const it = items[m.arrTop + k];
      lines.push(it ? { l: [run(`<${it.label}`, MC.cyan)], r: [run(it.right, MC.green, true)] } : {});
    }
    lines.push(tmp || stTmp ? { l: [run("<TMPY", MC.amber)], r: [run("INSERT*", MC.amber)] } : { l: [run("<RETURN")] });
    return {
      title: [run("ARRIVAL ", MC.white), run("TO ", MC.white, true), run(A?.code ?? "----", MC.green)],
      lines,
      ud: items.length > 3,
    };
  },
  lsk(m, side, n): LskResult {
    const A = arrivalOf(m);
    if (!A) return "notindb";
    const key = `${side}${n}`;
    const sel = m.host.approachSel?.();
    const app = m.arrApp ?? (sel && sel.approach !== "auto" ? sel.approach : null);
    const a = A.list.find((x) => x.id === app) ?? null;
    const st = starOf(m, a);
    if (key === "L6") {
      if (m.arrApp !== null || m.arrVia !== null || m.arrStar !== null || m.arrTrans !== null) {
        m.arrApp = m.arrVia = m.arrStar = m.arrTrans = null;
        return;
      }
      return m.open("fpln");
    }
    if (key === "R6") {
      const apTmp = m.arrApp !== null || m.arrVia !== null;
      if (!apTmp && m.arrStar === null && m.arrTrans === null) return;
      const R = m.host.route();
      if (m.arrStar !== null || m.arrTrans !== null) {
        const id = m.arrStar ?? st.active?.star ?? null;
        const T = st.list.find((x) => x.id === id);
        const tr = m.arrTrans === "NO TRANS" ? null : (m.arrTrans ?? null);
        insertTerminal(R.wps, T ? terminalWaypoints(T, a?.rwy ?? null, tr) : [], "STAR");
        m.host.routeChanged();
      }
      if (apTmp) {
        const via = m.arrVia === null ? "auto" : m.arrVia === "NO VIA" ? "none" : m.arrVia;
        const r = m.host.selectApproach?.({ field: A.code, approach: app ?? "auto", via });
        if (!r?.ok) return "notallowed";
      }
      m.host.insertArrival?.();
      m.arrApp = m.arrVia = m.arrStar = m.arrTrans = null;
      m.arrMode = "appr";
      return m.open("fpln");
    }
    if (key === "L2") {
      if (m.arrMode !== "appr") m.arrMode = "appr";
      else if (a && viasOf(a).length) m.arrMode = "via";
      m.arrTop = 0;
      return;
    }
    if (key === "R2") {
      if (!st.list.length) return;
      const star = m.arrStar ?? st.active?.star ?? null;
      const T = st.list.find((x) => x.id === star);
      m.arrMode = m.arrMode === "star" && T?.enroute.length ? "trans" : "star";
      m.arrTop = 0;
      return;
    }
    if (side === "L" && n >= 3 && n <= 5 && (m.arrMode === "star" || m.arrMode === "trans")) {
      const k = m.arrTop + n - 3;
      if (m.arrMode === "star") {
        if (k === 0) {
          m.arrStar = "NO STAR";
          m.arrTrans = null;
          return;
        }
        const T = st.list[k - 1];
        if (!T) return;
        m.arrStar = T.id;
        m.arrTrans = null;
        if (T.enroute.length) (m.arrMode = "trans"), (m.arrTop = 0);
        return;
      }
      const T = st.list.find((x) => x.id === (m.arrStar ?? st.active?.star));
      if (!T) return;
      if (k === 0) m.arrTrans = "NO TRANS";
      else {
        const e = T.enroute[k - 1];
        if (!e) return;
        m.arrTrans = e.name;
      }
      if (m.arrStar === null) m.arrStar = T.id;
      return;
    }
    if (side === "L" && n >= 3 && n <= 5) {
      if (m.arrMode === "via" && a) {
        const k = m.arrTop + n - 3;
        if (k === 0) m.arrVia = "NO VIA";
        else {
          const v = viasOf(a)[k - 1];
          if (!v) return;
          m.arrVia = v;
        }
        if (m.arrApp === null) m.arrApp = a.id;
        return;
      }
      const x = A.list[m.arrTop + n - 3];
      if (!x) return;
      m.arrApp = x.id;
      m.arrVia = null;
      if (viasOf(x).length) (m.arrMode = "via"), (m.arrTop = 0);
      return;
    }
    return "notallowed";
  },
  arrow(m, dir) {
    if (dir === "up") m.arrTop++;
    else if (dir === "down") m.arrTop = Math.max(m.arrTop - 1, 0);
    else return false;
    return true;
  },
};

/**
 * AIRWAYS (PLAN-A320-VOL-AAA N2 — FlightGear's AIRWAYS.nas): from LAT REV's waypoint, an airway typed with the point to leave it at —
 * « UN872/LESDO » on a VIA/GO TO line —: its points along it (world/navdb.ts airwayLegs) inserted after the waypoint, each marked by
 * the airway (F-PLN shows it). Walked in the database (its tiles fetched as the airway goes): « AWY/WPT MISMATCH » when the waypoint is
 * not on that airway or the point not reached along it.
 */
const airways: Page = {
  screen(m): Screen {
    const R = m.host.route();
    const w = R.wps[m.latRev];
    return {
      title: [run("AIRWAYS ", MC.white), run("FROM ", MC.white, true), run(w?.name ?? "----", MC.green)],
      lines: [
        { ls: [run(" VIA", MC.white, true)], l: [brackets(5)], rs: [run("GO TO ", MC.white, true)], r: [brackets(5)] },
        { ls: [run(" VIA/GO TO", MC.white, true)], l: [run("[   ]/[   ]", MC.cyan, true)] },
        {},
        {},
        {},
        { l: [run("<RETURN")] },
      ],
    };
  },
  lsk(m, side, n, sp): LskResult {
    if (side === "L" && n === 6) return m.open("latrev");
    if (!sp || sp === "CLR" || !m.host.airway) return sp === "CLR" ? "notallowed" : undefined;
    const mm = /^([A-Z0-9]{2,6})\/([A-Z0-9]{2,7})$/.exec(sp);
    if (!mm) return "format";
    const R = m.host.route();
    const i = m.latRev;
    const from = R.wps[i];
    if (!from) return "notallowed";
    const via = mm[1]!,
      to = mm[2]!;
    void m.host.airway(via, from, to).then((pts) => {
      if (!pts || pts.length < 2) {
        m.say("AWY/WPT MISMATCH");
        return;
      }
      // (the airway's points after the waypoint — the first is the waypoint itself)
      const add = pts.slice(1).map((p) => ({ ...p, nav: { ...(p.nav ?? { kind: "FIX" }), via } }));
      const at = R.wps.indexOf(from);
      if (at < 0) return;
      R.wps.splice(at + 1, 0, ...add);
      m.host.routeChanged();
      m.open("fpln");
    });
    return true;
  },
};

/** The departure's runway ends (the longest first), its SIDs, the one in the plan. */
function departureOf(m: Mcdu) {
  const R = m.host.route();
  const o = R.wps[0];
  const code = o?.field ? (o.field.icao ?? o.name) : null;
  const f = code ? m.host.field(code) : null;
  const ends = (f?.runways ?? [])
    .flatMap((r) => [
      { name: r.le, len: r.len, crs: r.hdg },
      { name: r.he, len: r.len, crs: (r.hdg + 180) % 360 },
    ])
    .filter((e) => e.name)
    .sort((x, y) => y.len - x.len || x.name.localeCompare(y.name));
  const T = code && m.host.terminals ? m.host.terminals(code) : null;
  const w = R.wps.find((x) => x.proc?.sid);
  return {
    code,
    ends,
    sids: T?.sid ?? null,
    active: w?.proc?.sid ? { rwy: w.proc.rwy ?? null, sid: w.proc.sid, trans: w.proc.trans ?? null } : null,
  };
}

/**
 * DEPARTURE (PLAN-A320-VOL-AAA N2 — FlightGear's DEPARTURE.nas): the origin's runways, then the SIDs that serve the runway chosen (the
 * FAA's CIFP: US airports — « NONE » elsewhere), then the SID's en-route transitions; INSERT puts its fixes after the origin (the old
 * ones out), each with its constraint. Temporary choices yellow, the plan's green.
 */
const departure: Page = {
  screen(m): Screen {
    const D = departureOf(m);
    const rwy = m.depRwy ?? D.active?.rwy ?? null;
    const sid = m.depSid ?? (m.depRwy === null ? (D.active?.sid ?? null) : null);
    const trans = m.depTrans ?? (m.depSid === null && m.depRwy === null ? (D.active?.trans ?? null) : null);
    const tmp = m.depRwy !== null || m.depSid !== null || m.depTrans !== null;
    const col = tmp ? MC.yellow : MC.green;
    const lines: Line[] = [
      {
        ls: [run(" RWY"), run("      SID", MC.white)],
        l: [run(rwy ?? "---", rwy ? col : MC.white), run(`  ${sid ?? "------"}`, sid ? col : MC.white)],
        rs: [run("TRANS ")],
        r: [run(trans ?? "------", trans ? col : MC.white)],
      },
    ];
    const S = D.sids ? terminalsFor(D.sids, rwy) : [];
    const sT = S.find((x) => x.id === sid) ?? null;
    const items: { label: string; right: string }[] =
      m.depMode === "sid"
        ? [{ label: "NO SID", right: "" }, ...S.map((x) => ({ label: x.id, right: x.enroute.length ? `${x.enroute.length} TRANS` : "" }))]
        : m.depMode === "trans" && sT
          ? [{ label: "NO TRANS", right: "" }, ...sT.enroute.map((x) => ({ label: x.name, right: "" }))]
          : D.ends.map((e) => ({ label: e.name, right: `${Math.round(e.len)}M  CRS${String(Math.round(e.crs) % 360).padStart(3, "0")}` }));
    m.depTop = Math.min(Math.max(m.depTop, 0), Math.max(items.length - 3, 0));
    const second: Line =
      m.depMode === "rwy"
        ? {
            ls: [run(" AVAILABLE RUNWAYS")],
            r: rwy ? [run(D.sids === null ? "SIDS…" : D.sids.length ? "SIDS>" : "NO SIDS", MC.white)] : [],
          }
        : m.depMode === "sid"
          ? { ls: [run(" SIDS")], l: [run("<RWYS")], r: sT?.enroute.length ? [run("TRANS>")] : [] }
          : { ls: [run(" TRANS")], l: [run("<RWYS")], r: [run("SIDS>")] };
    lines.push(second);
    for (let k = 0; k < 3; k++) {
      const it = items[m.depTop + k];
      lines.push(it ? { l: [run(`<${it.label}`, MC.cyan)], r: [run(it.right, MC.green, true)] } : {});
    }
    lines.push(tmp ? { l: [run("<TMPY", MC.amber)], r: [run("INSERT*", MC.amber)] } : { l: [run("<RETURN")] });
    return {
      title: [run("DEPARTURES ", MC.white), run("FROM ", MC.white, true), run(D.code ?? "----", MC.green)],
      lines,
      ud: items.length > 3,
    };
  },
  lsk(m, side, n): LskResult {
    const D = departureOf(m);
    if (!D.code) return "notindb";
    const key = `${side}${n}`;
    const rwy = m.depRwy ?? D.active?.rwy ?? null;
    const S = D.sids ? terminalsFor(D.sids, rwy) : [];
    const sid = m.depSid ?? (m.depRwy === null ? (D.active?.sid ?? null) : null);
    const sT = S.find((x) => x.id === sid) ?? null;
    const tmp = m.depRwy !== null || m.depSid !== null || m.depTrans !== null;
    if (key === "L6") {
      if (tmp) {
        m.depRwy = m.depSid = m.depTrans = null;
        m.depMode = "rwy";
        return;
      }
      return m.open("fpln");
    }
    if (key === "R6") {
      if (!tmp) return;
      const R = m.host.route();
      const tr = m.depTrans === "NO TRANS" ? null : (m.depTrans ?? (m.depSid === null ? (D.active?.trans ?? null) : null));
      insertTerminal(R.wps, sT ? terminalWaypoints(sT, rwy, tr) : [], "SID");
      m.host.routeChanged();
      m.depRwy = m.depSid = m.depTrans = null;
      m.depMode = "rwy";
      return m.open("fpln");
    }
    if (key === "L2") {
      if (m.depMode === "rwy") return;
      m.depMode = "rwy";
      m.depTop = 0;
      return;
    }
    if (key === "R2") {
      if (m.depMode === "rwy") {
        if (!rwy || !D.sids?.length) return;
        m.depMode = "sid";
      } else if (m.depMode === "sid") {
        if (!sT?.enroute.length) return;
        m.depMode = "trans";
      } else m.depMode = "sid";
      m.depTop = 0;
      return;
    }
    if (side === "L" && n >= 3 && n <= 5) {
      const k = m.depTop + n - 3;
      if (m.depMode === "rwy") {
        const e = D.ends[k];
        if (!e) return;
        m.depRwy = e.name;
        m.depSid = m.depTrans = null;
        if (D.sids?.length) (m.depMode = "sid"), (m.depTop = 0);
        return;
      }
      if (m.depMode === "sid") {
        if (k === 0) {
          m.depSid = "NO SID";
          m.depTrans = null;
          return;
        }
        const T = S[k - 1];
        if (!T) return;
        if (m.depRwy === null) m.depRwy = rwy;
        m.depSid = T.id;
        m.depTrans = null;
        if (T.enroute.length) (m.depMode = "trans"), (m.depTop = 0);
        return;
      }
      if (!sT) return;
      if (m.depRwy === null) m.depRwy = rwy;
      if (m.depSid === null) m.depSid = sT.id;
      if (k === 0) m.depTrans = "NO TRANS";
      else {
        const e = sT.enroute[k - 1];
        if (!e) return;
        m.depTrans = e.name;
      }
      return;
    }
    return "notallowed";
  },
  arrow(m, dir) {
    if (dir === "up") m.depTop++;
    else if (dir === "down") m.depTop = Math.max(m.depTop - 1, 0);
    else return false;
    return true;
  },
};

export const FPLN_PAGES: Record<string, Page> = { fpln, latrev, dirto, arrival, airways, departure };
