// The A320's MCDU's INIT pages (docs/PLAN-A320.md, A9 — FlightGear's Nasal/MCDU/INITA.nas, INITB.nas): INIT A — the
// route's ends (FROM/TO: the flight plan made from its departure to its arrival, the points between kept), the
// alternate, the flight number, the cost index, the cruise level and its temperature, the tropopause —; INIT B — the
// weights (ZFW and its CG, the block fuel, the taxi's), the trip's fuel and time, the reserves, TOW and LW.

import type { Mcdu, Page } from "./mcdu";
import { boxes, brackets, MC, type Line, run, type Screen } from "./screen";
import { distAlong, dur, fieldWp, num, tons, trip } from "./util";

const ISA = (fl: number) => Math.round(15 - (1.98 * fl) / 10);

/** INIT B's figures: the trip [t, h] from the plan's departure, the route reserve, the alternate's, the final reserve,
 *  TOW, LW, the extra fuel — null: the weights not entered */
export function fuelFigures(m: Mcdu) {
  const F = m.host.fms;
  const R = m.host.route();
  const nm = R.wps.length >= 2 ? distAlong(R, null, 0) : 0;
  const tr = trip(nm, true);
  const altn = F.altn && F.to ? m.host.field(F.altn) : null;
  const dest = R.wps.at(-1);
  const altnTrip = altn && dest ? trip(distAlong({ ...R, wps: [dest, fieldWp(altn)] }, null, 0), false) : null;
  const rsv = (tr.t * F.rtePct) / 100;
  const final = (2.2 * F.finalMin) / 60;
  const tow = F.tow;
  const lw = tow !== null ? tow - tr.t : null;
  const extra = F.block !== null ? F.block - F.taxi - tr.t - rsv - (altnTrip?.t ?? 0) - final : null;
  return { nm, tr, rsv, altnTrip, final, tow, lw, extra };
}

const initA: Page = {
  screen(m): Screen {
    const F = m.host.fms;
    const ft = !!(F.from && F.to);
    const lines: Line[] = [
      {
        ls: [run("CO RTE")],
        l: [ft ? run("NONE", MC.cyan) : brackets(8)],
        rs: [run("FROM/TO  ")],
        r: [ft ? run(`${F.from}/${F.to}`, MC.cyan) : run("□□□□/□□□□", MC.amber)],
      },
      {
        ls: [run("ALTN/CO RTE")],
        l: [ft ? run(`${F.altn ?? "NONE"}`, MC.cyan) : run("----", MC.white), run("/----", ft ? MC.cyan : MC.white)],
        rs: [run("INIT ")],
        r: [run("REQUEST*", ft ? MC.white : MC.amber)],
      },
      { ls: [run("FLT NBR")], l: [F.fltNbr ? run(F.fltNbr, MC.cyan) : boxes(8)], r: [run("IRS INIT>")] },
      { r: [run("WIND/TEMP>")] },
      { ls: [run("COST INDEX")], l: [F.costIndex !== null ? run(String(F.costIndex), MC.cyan) : ft ? boxes(3) : run("---")] },
      {
        ls: [run("CRZ FL/TEMP")],
        l:
          F.crzFl !== null
            ? [run(`FL${String(F.crzFl).padStart(3, "0")}`, MC.cyan), run(`/${F.crzTemp ?? ISA(F.crzFl)}°`, MC.cyan, F.crzTemp === null)]
            : [ft ? run("□□□□□", MC.amber) : run("-----"), run("/---°")],
        rs: [run("TROPO")],
        r: [run(String(F.tropo), MC.cyan, true)],
      },
    ];
    return { title: [run("INIT")], lines, lr: true };
  },
  lsk(m, side, n, sp) {
    const F = m.host.fms;
    if (!sp) return;
    const key = `${side}${n}`;
    if (sp === "CLR") {
      if (key === "L2") return (F.altn = null), true;
      if (key === "L3") return (F.fltNbr = ""), true;
      return "notallowed";
    }
    switch (key) {
      case "R1": {
        const p = /^([A-Z0-9]{3,4})\/([A-Z0-9]{3,4})$/.exec(sp);
        if (!p) return "format";
        const dep = m.host.field(p[1]!),
          arr = m.host.field(p[2]!);
        if (!dep || !arr) return "notindb";
        F.from = dep.icao || dep.ident;
        F.to = arr.icao || arr.ident;
        // (the plan: the departure and the arrival at its ends, the points between kept)
        const R = m.host.route();
        const mid = R.wps.filter((w, i) => !((i === 0 || i === R.wps.length - 1) && w.field));
        R.wps = [fieldWp(dep), ...mid, fieldWp(arr)];
        m.host.routeChanged();
        return true;
      }
      case "L2": {
        if (sp === "NONE") return (F.altn = null), true;
        const a = m.host.field(sp);
        if (!a) return "notindb";
        F.altn = a.icao || a.ident;
        return true;
      }
      case "L3":
        if (!/^[A-Z0-9]{1,8}$/.test(sp)) return "format";
        F.fltNbr = sp;
        return true;
      case "L5": {
        const ci = num(sp, 0, 999);
        if (ci === null || !Number.isInteger(ci)) return "format";
        F.costIndex = ci;
        return true;
      }
      case "L6": {
        const p = /^(?:FL)?(\d{1,3})?(?:\/([+-]?\d{1,2}))?$/.exec(sp);
        if (!p || (p[1] === undefined && p[2] === undefined)) return "format";
        if (p[1] !== undefined) {
          const fl = Number(p[1]);
          if (fl < 10 || fl > 398) return "notallowed";
          F.crzFl = fl;
          // (the game's plan cruises there)
          m.host.route().cruiseAlt = fl * 100 * 0.3048;
          m.host.routeChanged();
        }
        if (p[2] !== undefined) F.crzTemp = Number(p[2]);
        return true;
      }
      case "R6": {
        const t = num(sp, 1000, 60000);
        if (t === null) return "format";
        F.tropo = Math.round(t / 10) * 10;
        return true;
      }
    }
    return "notallowed";
  },
  arrow(m, dir) {
    if (dir === "left" || dir === "right") return m.open("initb"), true;
    return false;
  },
};

const initB: Page = {
  screen(m): Screen {
    const F = m.host.fms;
    const f = fuelFigures(m);
    const w = F.zfw !== null && F.block !== null;
    const lines: Line[] = [
      {
        ls: [run("TAXI")],
        l: [run(tons(F.taxi), MC.cyan)],
        rs: [run("ZFWCG/ZFW")],
        r:
          F.zfw !== null
            ? [run(`${(F.zfwcg ?? 25).toFixed(1)}`, MC.cyan, F.zfwcg === null), run(`/${tons(F.zfw)}`, MC.cyan)]
            : [run("□□.□/□□.□", MC.amber)],
      },
      {
        ls: [run("TRIP/TIME")],
        l: w ? [run(`${tons(f.tr.t)}/${dur(f.tr.h)}`, MC.green)] : [run("---.-/----")],
        rs: [run("BLOCK")],
        r: [F.block !== null ? run(tons(F.block), MC.cyan) : run("□□.□", MC.amber)],
      },
      {
        ls: [run("RTE RSV/%")],
        l: w ? [run(tons(f.rsv), MC.cyan), run(`/${F.rtePct.toFixed(1)}`, MC.cyan)] : [run("---.-/"), run(F.rtePct.toFixed(1), MC.cyan)],
      },
      {
        ls: [run("ALTN/TIME")],
        l: f.altnTrip && w ? [run(`${tons(f.altnTrip.t)}/${dur(f.altnTrip.h)}`, MC.green)] : [run("---.-/----")],
        rs: [run("TOW/LW")],
        r: f.tow !== null && f.lw !== null ? [run(`${tons(f.tow)}/${tons(f.lw)}`, MC.green)] : [run("---.-/---.-")],
      },
      {
        ls: [run("FINAL/TIME")],
        l: [run(tons(f.final), MC.cyan), run(`/${dur(F.finalMin / 60)}`, MC.cyan)],
        rs: [run("TRIP WIND")],
        r: [run("HD000", MC.cyan, true)],
      },
      {
        ls: [run("EXTRA/TIME")],
        l: f.extra !== null ? [run(`${tons(f.extra)}/${dur(Math.max(f.extra, 0) / 2.2)}`, MC.green)] : [run("---.-/----")],
        rs: [run("MIN DEST FOB")],
        r: w ? [run(tons(f.final + (f.altnTrip?.t ?? 0)), MC.cyan, true)] : [run("-----")],
      },
    ];
    return { title: [run("INIT")], lines, lr: true };
  },
  lsk(m, side, n, sp) {
    const F = m.host.fms;
    if (!sp) return;
    if (sp === "CLR") return "notallowed";
    switch (`${side}${n}`) {
      case "L1": {
        const t = num(sp, 0, 9.9);
        if (t === null) return "format";
        F.taxi = t;
        return true;
      }
      case "R1": {
        const p = /^(\d{1,2}(?:\.\d)?)?\/(\d{1,3}(?:\.\d)?)?$/.exec(sp) ?? /^()(\d{1,3}(?:\.\d)?)$/.exec(sp);
        if (!p || (!p[1] && !p[2])) return "format";
        if (p[2]) {
          const z = Number(p[2]);
          if (z < 35 || z > 64.3) return "notallowed";
          F.zfw = z;
        }
        if (p[1]) {
          const cg = Number(p[1]);
          if (cg < 8 || cg > 50) return "notallowed";
          F.zfwcg = cg;
        }
        return true;
      }
      case "R2": {
        const b = num(sp, 0, 40);
        if (b === null) return "format";
        F.block = b;
        return true;
      }
      case "L3": {
        const p = /^\/(\d{1,2}(?:\.\d)?)$/.exec(sp);
        if (!p) return "format";
        const pct = Number(p[1]);
        if (pct > 15) return "notallowed";
        F.rtePct = pct;
        return true;
      }
      case "L5": {
        const p = /^\/(\d{2})(\d{2})$/.exec(sp);
        if (!p) return "format";
        F.finalMin = Number(p[1]) * 60 + Number(p[2]);
        return true;
      }
    }
    return "notallowed";
  },
  arrow(m, dir) {
    if (dir === "left" || dir === "right") return m.open("inita"), true;
    return false;
  },
};

export const INIT_PAGES: Record<string, Page> = { inita: initA, initb: initB };
