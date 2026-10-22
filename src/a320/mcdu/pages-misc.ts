// The A320's MCDU's other pages (docs/PLAN-A320.md, A9 — FlightGear's Nasal/MCDU/PROG.nas, FUELPRED.nas, RADNAV.nas,
// DATA.nas, MCDU.nas): PROG (the cruise level, the optimum and the maximum, the bearing and distance to the
// destination, the navigation's accuracy), FUEL PRED (the fuel and the times at the destination and the alternate, the
// gross weight and its CG, the fuel on board, the reserves), RADIO NAV (the ILS: the arrival runway's, tuned by the
// FMGC, or entered), DATA INDEX and A/C STATUS (the engines, the navigation database), the MCDU MENU, the SEC INDEX and
// the ATC MENU (the game has no secondary plan nor datalink yet).

import { gcCourse, gcDist } from "../../game/flightplan";
import type { LskResult, Mcdu, Page } from "./mcdu";
import { brackets, MC, type Line, run, type Screen } from "./screen";
import { fuelFigures } from "./pages-init";
import { distAlong, dur, hhmm, num, tons, trip } from "./util";

const D = Math.PI / 180;
const NM = 1852;
const PHASE_NAME: Record<string, string> = {
  preflight: "PREFLIGHT",
  takeoff: "TO",
  climb: "CLB",
  cruise: "CRZ",
  descent: "DES",
  approach: "APPR",
  "go around": "GA",
  done: "DONE",
};
const fl = (x: number | null) => (x === null ? "-----" : `FL${String(Math.round(x)).padStart(3, "0")}`);

/** the ILS of the arrival runway (or the one entered): its identifier, its frequency (a localizer's: odd tenths from
 *  108.10 to 111.95), its course */
export function ilsOf(m: Mcdu): { id: string; freq: string; course: number; auto: boolean } | null {
  const F = m.host.fms;
  const dest = m.host.route().wps.at(-1);
  const rwy = dest?.field?.rwy;
  if (F.ils) return { id: F.ils.id, freq: freqOf(F.ils.id), course: F.ils.course, auto: false };
  if (!dest || rwy === undefined) return null;
  const id = `I${dest.name.slice(1, 4)}`;
  return { id, freq: freqOf(id + String(Math.round(rwy))), course: Math.round(rwy) % 360 || 360, auto: true };
}
function freqOf(s: string): string {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (108.1 + 0.2 * (h % 20)).toFixed(2);
}

const prog: Page = {
  screen(m): Screen {
    const F = m.host.fms;
    const G = m.host.fmgc();
    const g = m.host.geo();
    const dest = m.host.route().wps.at(-1);
    const brg = g && dest ? Math.round(gcCourse(g, dest) / D) % 360 || 360 : null;
    const dist = g && dest ? gcDist(g, dest) / NM : null;
    const lines: Line[] = [
      {
        ls: [run(" CRZ")],
        l: [run(fl(F.crzFl), MC.cyan)],
        cs: [run("OPT")],
        c: [run(F.crzFl !== null ? fl(Math.min(F.crzFl + 20, 390)) : "-----", MC.green)],
        rs: [run("REC MAX ")],
        r: [run("FL398", MC.magenta)],
      },
      { l: [run("<REPORT")] },
      { ls: [run(" POSITION UPDATE AT")], l: [run("*[        ]", MC.cyan)] },
      {
        ls: [run("  BRG /DIST")],
        l: [
          run(
            brg !== null && dist !== null ? `${String(brg).padStart(3, "0")}°/${dist.toFixed(dist < 100 ? 1 : 0)}` : "---°/----.-",
            MC.green,
          ),
        ],
        rs: [run("TO ")],
        r: [run(dest?.name ?? "[    ]", dest ? MC.green : MC.cyan)],
      },
      { ls: [run(" PREDICTIVE")], l: [run("<GPS")], r: [run("GPS PRIMARY", MC.green)] },
      {
        ls: [run("REQUIRED ACCUR ESTIMATED")],
        l: [run("3.70NM", MC.cyan, true)],
        c: [run("HIGH", MC.green)],
        r: [run("0.07NM", MC.green)],
      },
    ];
    return { title: [run(PHASE_NAME[G?.phase ?? "preflight"] ?? "PREFLIGHT", MC.green), run(` ${F.fltNbr}`, MC.white)], lines };
  },
  lsk(m, side, n, sp): LskResult {
    if (`${side}${n}` !== "L1" || !sp) return sp ? "notallowed" : undefined;
    const p = /^(?:FL)?(\d{1,3})$/.exec(sp);
    if (!p) return "format";
    const f = Number(p[1]);
    if (f < 10 || f > 398) return "notallowed";
    m.host.fms.crzFl = f;
    m.host.route().cruiseAlt = f * 100 * 0.3048;
    m.host.routeChanged();
    return true;
  },
};

const fuelPred: Page = {
  screen(m): Screen {
    const F = m.host.fms;
    const R = m.host.route();
    const f = fuelFigures(m);
    const ground = m.host.onGround();
    const dest = R.wps.at(-1);
    const nm = dest ? distAlong(R, ground ? null : m.host.geo(), ground ? 0 : m.host.activeWp()) : 0;
    const tr = trip(nm, ground);
    const fob = m.host.fobKg() / 1000;
    const efob = fob - tr.t - (ground ? F.taxi : 0);
    const now = m.host.now().getTime();
    const at = (h: number) => hhmm(new Date(now + h * 3_600_000));
    const gw = m.host.gwKg() / 1000;
    const lines: Line[] = [
      {
        ls: [run(" AT"), run("       UTC   EFOB", MC.white)],
        l: [run(dest?.name ?? "----", MC.green)],
        c: [run(dest ? at(tr.h) : "----", MC.green)],
        r: [run(dest ? tons(Math.max(efob, 0)) : "--.-", MC.green)],
      },
      {
        l: [run(F.altn ?? "----", MC.green)],
        c: [run(f.altnTrip && dest ? at(tr.h + f.altnTrip.h) : "----", MC.green)],
        r: [run(f.altnTrip && dest ? tons(Math.max(efob - f.altnTrip.t, 0)) : "--.-", MC.green)],
      },
      {
        ls: [run("RTE RSV/%")],
        l: [run(tons(f.rsv), MC.cyan), run(`/${F.rtePct.toFixed(1)}`, MC.cyan)],
        rs: [run("GW/   CG")],
        r: [run(`${tons(gw)}/${(F.zfwcg ?? 25).toFixed(1)}`, MC.green)],
      },
      {
        ls: [run("ALTN/TIME")],
        l: [run(f.altnTrip ? `${tons(f.altnTrip.t)}/${dur(f.altnTrip.h)}` : "---.-/----", MC.green)],
        rs: [run("FOB")],
        r: [run(tons(fob), MC.green)],
      },
      { ls: [run("FINAL/TIME")], l: [run(`${tons(f.final)}/${dur(F.finalMin / 60)}`, MC.cyan)] },
      {
        ls: [run("EXTRA/TIME")],
        l: [run(`${tons(Math.max(efob - f.final - (f.altnTrip?.t ?? 0), 0))}`, MC.green)],
        rs: [run("MIN DEST FOB")],
        r: [run(tons(f.final + (f.altnTrip?.t ?? 0)), MC.cyan, true)],
      },
    ];
    return { title: [run("FUEL PRED")], lines };
  },
};

const radnav: Page = {
  screen(m): Screen {
    const I = ilsOf(m);
    const lines: Line[] = [
      { ls: [run("VOR1/FREQ")], l: [run("[ ]/[ . ]", MC.cyan)], rs: [run("FREQ/VOR2")], r: [run("[ . ]/[ ]", MC.cyan)] },
      { ls: [run("CRS")], l: [brackets(3)], rs: [run("CRS")], r: [brackets(3)] },
      {
        ls: [run("LS  /FREQ")],
        l: I ? [run(I.id, MC.cyan, I.auto), run(`/${I.freq}`, MC.cyan, I.auto)] : [run("[  ]/[ . ]", MC.cyan)],
      },
      { ls: [run("CRS")], l: I ? [run(String(I.course).padStart(3, "0"), MC.cyan, I.auto)] : [run("---")] },
      { ls: [run("ADF1/FREQ")], l: [run("[ ]/[ . ]", MC.cyan)], rs: [run("FREQ/ADF2")], r: [run("[ . ]/[ ]", MC.cyan)] },
      {},
    ];
    return { title: [run("RADIO NAV")], lines };
  },
  lsk(m, side, n, sp): LskResult {
    const F = m.host.fms;
    const key = `${side}${n}`;
    if (!sp) return;
    if (key === "L3") {
      if (sp === "CLR") return (F.ils = null), true;
      const p = /^([A-Z]{2,4})?(?:\/(1\d{2}\.\d{1,2}))?$/.exec(sp);
      if (!p || (!p[1] && !p[2])) return "format";
      const cur = ilsOf(m);
      F.ils = { id: p[1] ?? cur?.id ?? "ILS", course: cur?.course ?? 360 };
      return true;
    }
    if (key === "L4") {
      const c = num(sp, 0, 360);
      if (c === null || !Number.isInteger(c)) return "format";
      const cur = ilsOf(m);
      F.ils = { id: cur?.id ?? "ILS", course: c % 360 || 360 };
      return true;
    }
    return "notallowed";
  },
};

const data: Page = {
  screen(m): Screen {
    const lines: Line[] =
      m.dataPage === 1
        ? [
            { ls: [run(" POSITION")], l: [run("<MONITOR")] },
            { ls: [run(" IRS")], l: [run("<MONITOR")] },
            { ls: [run(" GPS")], l: [run("<MONITOR")] },
            { l: [run("<A/C STATUS")] },
            { ls: [run(" CLOSEST")], l: [run("<AIRPORTS")], rs: [run("PRINT ")], r: [run("FUNCTION>")] },
            { ls: [run(" EQUITIME")], l: [run("<POINT")], rs: [run("AOC ")], r: [run("FUNCTION>")] },
          ]
        : [
            { l: [run("<WAYPOINTS")], rs: [run("PILOTS ")], r: [run("WAYPOINTS>")] },
            { l: [run("<NAVAIDS")], r: [run("NAVAIDS>")] },
            { l: [run("<RUNWAYS")], r: [run("RUNWAYS>")] },
            { l: [run("<ROUTES")], r: [run("ROUTES>")] },
            {},
            {},
          ];
    return { title: [run("DATA INDEX")], page: `${m.dataPage}/2`, lines, lr: true };
  },
  lsk(m, side, n): LskResult {
    if (m.dataPage === 1 && `${side}${n}` === "L4") return void m.open("status");
    m.say("NOT AVAILABLE");
  },
  arrow(m, dir) {
    if (dir !== "left" && dir !== "right") return false;
    m.dataPage = m.dataPage === 1 ? 2 : 1;
    return true;
  },
};

const status: Page = {
  screen(): Screen {
    const lines: Line[] = [
      { ls: [run(" ENG")], l: [run("CFM56-5B4", MC.green)] },
      { ls: [run(" ACTIVE NAV DATA BASE")], l: [run(" 26OCT-23NOV", MC.cyan)], r: [run("KERR2610", MC.green)] },
      { ls: [run(" SECOND NAV DATA BASE")], l: [run(" 23NOV-21DEC", MC.cyan, true)] },
      {},
      { ls: [run("CHG CODE")], l: [run("[  ]", MC.cyan)] },
      { ls: [run("IDLE/PERF")], l: [run("+0.0/+0.0", MC.green)], r: [run("STATUS/XLOAD>")] },
    ];
    return { title: [run("A320-214")], lines };
  },
  lsk(m, side, n): LskResult {
    if (`${side}${n}` === "R6") m.say("NOT AVAILABLE");
  },
};

const menu: Page = {
  screen(): Screen {
    const lines: Line[] = [
      { l: [run("<FMGC", MC.green)], rs: [run("SELECT ")], r: [run("NAV B/UP>")] },
      { l: [run("<ATSU")] },
      { l: [run("<AIDS")] },
      { l: [run("<CFDS")] },
      {},
      {},
    ];
    return { title: [run("MCDU MENU")], lines };
  },
  lsk(m, side, n): LskResult {
    if (`${side}${n}` === "L1") return void m.open("status");
    m.say("NOT AVAILABLE");
  },
};

const sec: Page = {
  screen(): Screen {
    const lines: Line[] = [{ l: [run("<COPY ACTIVE")], r: [run("ACTIVATE SEC*", MC.white)] }, { l: [run("<SEC F-PLN")] }, {}, {}, {}, {}];
    return { title: [run("SEC INDEX")], lines };
  },
  lsk(m): LskResult {
    m.say("NOT AVAILABLE");
  },
};

const atc: Page = {
  screen(): Screen {
    const lines: Line[] = [{}, {}, { c: [run("NO ACTIVE ATC", MC.green)] }, {}, {}, { l: [run("<RETURN")] }];
    return { title: [run("ATC MENU")], lines };
  },
  lsk(m, side, n): LskResult {
    if (`${side}${n}` === "L6") m.open("menu");
  },
};

export const MISC_PAGES: Record<string, Page> = { prog, fuelpred: fuelPred, radnav, data, status, menu, sec, atc };
