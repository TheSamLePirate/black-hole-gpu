// The A320's MCDU's PERF pages (docs/PLAN-A320.md, A9 — FlightGear's Nasal/MCDU/PERFTO.nas, PERFCLB.nas, PERFCRZ.nas,
// PERFDES.nas, PERFAPPR.nas, PERFGA.nas): a page a phase of the flight, the active one's title green, NEXT PHASE / PREV
// PHASE between them — TAKE OFF (V1, VR, V2 — proposed by the FMS once the weights are in —, the transition altitude,
// THR RED/ACC, the runway, FLAPS/THS, FLEX TO TEMP, the engine-out acceleration), CLB / CRZ / DES (the speed mode,
// the cost index, the ECON speeds), APPR (QNH, the temperature, the wind, the minima, the landing configuration, VAPP,
// VLS), GO AROUND; the flaps', slats' and clean speeds (F, S, green dot) by the weight.

import { vs1g } from "../du/data";
import type { LskResult, Mcdu, Page } from "./mcdu";
import { boxes, brackets, MC, type Line, type Run, run, type Screen } from "./screen";
import { fuelFigures } from "./pages-init";
import { num } from "./util";

const PHASES = ["TAKE OFF", "CLB", "CRZ", "DES", "APPR", "GO AROUND"];
const ACTIVE: Record<string, number> = { takeoff: 0, preflight: 0, climb: 1, cruise: 2, descent: 3, approach: 4, "go around": 5 };

/** the mass the page's speeds are for [kg]: in the air the gross weight's; on the ground the take-off's (or the
 *  landing's on APPR) from INIT B, else the gross weight's */
function massFor(m: Mcdu, landing = false): number {
  const f = fuelFigures(m);
  if (!m.host.onGround()) return m.host.gwKg();
  const t = landing ? f.lw : f.tow;
  return t !== null ? t * 1000 : m.host.gwKg();
}

/** F, S and green dot [kt] at a mass [kg] (the FMGC's: fmgc/a320ap.ts) */
const fso = (kg: number) => ({ f: Math.round(vs1g(kg, 3) * 1.26), s: Math.round(vs1g(kg, 1) * 1.23), o: Math.round(2 * (kg / 1000) + 85) });

function title(m: Mcdu, k: number): Screen["title"] {
  const act = ACTIVE[m.host.fmgc()?.phase ?? "preflight"] ?? 0;
  return [run(PHASES[k]!, k === act ? MC.green : MC.white)];
}
const prev: Line = { ls: [run(" PREV")], l: [run("<PHASE")] };
const next: Line["r"] = [run("PHASE>")];

/** the runs padded to n columns */
function padRuns(rs: Run[] | undefined, n: number): Run[] {
  const out = [...(rs ?? [])];
  const w = out.reduce((a, r) => a + [...r.t].length, 0);
  if (w < n) out.push(run(" ".repeat(n - w)));
  return out;
}

/** the F / S / O speeds on lines 1–3 from column `col` (their labels a column before: the real pages' columns — 7 on
 *  TAKE OFF, 10 on APPR, past its wind) */
function centre(lines: Line[], kg: number, col = 7) {
  const s = fso(kg);
  const put = (k: number, label: string, v: string) => {
    lines[k]!.ls = [...padRuns(lines[k]!.ls, col - 1), run(label)];
    lines[k]!.l = [...padRuns(lines[k]!.l, col), run(v, MC.green)];
  };
  put(0, "FLP RETR", `F=${s.f}`);
  put(1, "SLT RETR", `S=${s.s}`);
  put(2, " CLEAN", `O=${s.o}`);
}

const takeOff: Page = {
  screen(m): Screen {
    const F = m.host.fms;
    const tow = F.tow;
    const prop = tow !== null ? F.proposeV(tow * 1000, F.toConf ?? 1) : null;
    const v = (x: number | null, p: number | undefined) =>
      x !== null ? [run(String(x), MC.cyan)] : p !== undefined ? [run(String(p), MC.cyan, true)] : [boxes(3)];
    const rwy = m.host.route().wps[0]?.field?.rwy;
    const lines: Line[] = [
      {
        ls: [run(" V1")],
        l: v(F.v1, prop?.v1),
        rs: [run("RWY ")],
        r: [run(rwy !== undefined ? String(Math.round(rwy / 10) || 36).padStart(2, "0") : "---", MC.green)],
      },
      { ls: [run(" VR")], l: v(F.vr, prop?.vr), rs: [run("TO SHIFT")], r: [run("[M][   ]*", MC.cyan, true)] },
      {
        ls: [run(" V2")],
        l: v(F.v2, prop?.v2),
        rs: [run("FLAPS/THS")],
        r: [run(F.toConf !== null ? `${F.toConf}/${F.ths || "[   ]"}` : "[]/[   ]", MC.cyan)],
      },
      {
        ls: [run("TRANS ALT")],
        l: [run("5000", MC.cyan, true)],
        rs: [run("FLEX TO TEMP")],
        r: [F.flex !== null ? run(`${F.flex}°`, MC.cyan) : run("[ ]°", MC.cyan)],
      },
      {
        ls: [run("THR RED/ACC")],
        l: [run(`${F.thrRed}/${F.acc}`, MC.cyan, true)],
        rs: [run("ENG OUT ACC")],
        r: [run(String(F.acc), MC.cyan, true)],
      },
      { rs: [run("NEXT ")], r: next },
    ];
    centre(lines, massFor(m), 6);
    return { title: title(m, 0), lines };
  },
  lsk(m, side, n, sp): LskResult {
    const F = m.host.fms;
    const key = `${side}${n}`;
    if (key === "R6") return void (m.perfPhase = 1);
    const vk = { L1: "v1", L2: "vr", L3: "v2" } as const;
    if (key in vk) {
      const k = vk[key as keyof typeof vk];
      if (sp === "CLR") return (F[k] = null), true;
      // (empty: the proposal taken)
      if (!sp) {
        const tow = F.tow;
        if (tow === null) return;
        F[k] = F.proposeV(tow * 1000, F.toConf ?? 1)[k];
        return;
      }
      const v = num(sp, 90, 350);
      if (v === null || !Number.isInteger(v)) return "format";
      F[k] = v;
      return true;
    }
    if (!sp) return;
    switch (key) {
      case "L5": {
        const p = /^(\d{3,4})?\/?(\d{3,4})?$/.exec(sp);
        if (!p || (!p[1] && !p[2])) return "format";
        if (p[1]) F.thrRed = Number(p[1]);
        if (p[2]) F.acc = Number(p[2]);
        return true;
      }
      case "R3": {
        const p = /^([123])?(?:\/((?:UP|DN)\d(?:\.\d)?))?$/.exec(sp);
        if (!p || (!p[1] && !p[2])) return "format";
        if (p[1]) F.toConf = Number(p[1]);
        if (p[2]) F.ths = p[2];
        return true;
      }
      case "R4": {
        if (sp === "CLR") return (F.flex = null), true;
        const t = num(sp, 0, 99);
        if (t === null || !Number.isInteger(t)) return "format";
        F.flex = t;
        return true;
      }
    }
    return "notallowed";
  },
};

/** CLB, CRZ, DES: the speed mode, the cost index, the ECON speeds */
function enroute(k: 1 | 2 | 3): Page {
  return {
    screen(m): Screen {
      const F = m.host.fms;
      const e = F.econ();
      const G = m.host.fmgc();
      const managed = G ? G.spdManaged : true;
      const mach = `.${String(Math.round(e.crzMach * 100))}`;
      const spd = k === 1 ? `${e.clb}/${mach}` : k === 2 ? mach : `${mach}/${e.des}`;
      const lines: Line[] = [
        {
          ls: [run("ACT MODE")],
          l: [run(managed ? "MANAGED" : "SELECTED", MC.green)],
          rs: k === 2 ? [run("DES CABIN RATE")] : [],
          r: k === 2 ? [run("-350FT/MN", MC.cyan, true)] : [],
        },
        { ls: [run(" CI")], l: [run(F.costIndex !== null ? String(F.costIndex) : "---", MC.cyan)] },
        { ls: [run(" MANAGED")], l: [run(`*${spd}`, MC.green)] },
        { ls: [run(" PRESEL")], l: [run("*[    ]", MC.cyan)] },
        k === 2 ? { rs: [run("CRZ FL ")], r: [run(F.crzFl !== null ? `FL${String(F.crzFl).padStart(3, "0")}` : "-----", MC.cyan)] } : {},
        { ...prev, rs: [run("NEXT ")], r: next },
      ];
      return { title: title(m, k), lines };
    },
    lsk(m, side, n, sp): LskResult {
      const key = `${side}${n}`;
      if (key === "L6") return void (m.perfPhase = k - 1);
      if (key === "R6") return void (m.perfPhase = k + 1);
      if (key === "L2" && sp) {
        const ci = num(sp, 0, 999);
        if (ci === null) return "format";
        m.host.fms.costIndex = ci;
        return true;
      }
      return sp ? "notallowed" : undefined;
    },
  };
}

const appr: Page = {
  screen(m): Screen {
    const F = m.host.fms;
    const kg = massFor(m, true);
    const dest = m.host.route().wps.at(-1);
    const lines: Line[] = [
      { ls: [run("QNH")], l: [F.qnh !== null ? run(F.qnh < 100 ? F.qnh.toFixed(2) : String(Math.round(F.qnh)), MC.cyan) : boxes(4)] },
      {
        ls: [run("TEMP")],
        l: [F.appTemp !== null ? run(`${F.appTemp}°`, MC.cyan) : run("[ ]°", MC.cyan)],
        rs: [run("BARO")],
        r: [F.mda !== null ? run(String(F.mda), MC.cyan) : brackets(4)],
      },
      {
        ls: [run("MAG WIND")],
        l: [F.appWind ? run(`${String(F.appWind.dir).padStart(3, "0")}°/${F.appWind.kt}`, MC.cyan) : run("[ ]°/[ ]", MC.cyan)],
        rs: [run("RADIO")],
        r: [F.dh !== null ? run(F.dh < 0 ? "NO" : String(F.dh), MC.cyan) : brackets(4)],
      },
      {
        ls: [run("TRANS FL")],
        l: [run("FL060", MC.cyan, true)],
        rs: [run("LDG CONF")],
        r: [F.ldgConf === 3 ? run("CONF3", MC.green) : run("CONF3*", MC.cyan)],
      },
      {
        ls: [run("VAPP")],
        l: [run(String(F.vapp(kg, dest?.field?.rwy)), MC.cyan, F.vappSet === null)],
        cs: [run("VLS")],
        c: [run(String(Math.round(F.vls(kg))), MC.green)],
        r: [F.ldgConf === 4 ? run("FULL", MC.green) : run("FULL*", MC.cyan)],
      },
      { ...prev, rs: [run("NEXT ")], r: next },
    ];
    centre(lines, kg, 10);
    return { title: title(m, 4), lines };
  },
  lsk(m, side, n, sp): LskResult {
    const F = m.host.fms;
    const key = `${side}${n}`;
    if (key === "L6") return void (m.perfPhase = 3);
    if (key === "R6") return void (m.perfPhase = 5);
    if (key === "R4") return void (F.ldgConf = 3);
    if (key === "R5" && !sp) return void (F.ldgConf = 4);
    if (!sp) return;
    const clr = sp === "CLR";
    switch (key) {
      case "L1": {
        if (clr) return (F.qnh = null), true;
        const q = /^\d{4}$/.test(sp) && Number(sp) > 2000 && Number(sp) < 3300 ? Number(sp) / 100 : num(sp, 22, 1100);
        if (q === null || (q > 33 && q < 745)) return "format";
        F.qnh = q;
        return true;
      }
      case "L2": {
        if (clr) return (F.appTemp = null), true;
        const t = num(sp, -99, 99);
        if (t === null) return "format";
        F.appTemp = t;
        return true;
      }
      case "L3": {
        if (clr) return (F.appWind = null), true;
        const p = /^(\d{1,3})\/(\d{1,3})$/.exec(sp);
        if (!p || Number(p[1]) > 360) return "format";
        F.appWind = { dir: Number(p[1]) % 360, kt: Number(p[2]) };
        return true;
      }
      case "L5": {
        if (clr) return (F.vappSet = null), true;
        const v = num(sp, 90, 350);
        if (v === null) return "format";
        F.vappSet = v;
        return true;
      }
      case "R2": {
        if (clr) return (F.mda = null), true;
        const v = num(sp, 0, 5000);
        if (v === null) return "format";
        F.mda = v;
        return true;
      }
      case "R3": {
        if (clr) return (F.dh = null), true;
        if (sp === "NO") return (F.dh = -1), true;
        const v = num(sp, 0, 5000);
        if (v === null) return "format";
        F.dh = v;
        return true;
      }
    }
    return "notallowed";
  },
};

const goAround: Page = {
  screen(m): Screen {
    const F = m.host.fms;
    const lines: Line[] = [
      {},
      {},
      {},
      {},
      {
        ls: [run("THR RED/ACC")],
        l: [run(`${F.thrRed}/${F.acc}`, MC.cyan, true)],
        rs: [run("ENG OUT ACC")],
        r: [run(String(F.acc), MC.cyan, true)],
      },
      prev,
    ];
    centre(lines, massFor(m, true));
    return { title: title(m, 5), lines };
  },
  lsk(m, side, n): LskResult {
    if (`${side}${n}` === "L6") m.perfPhase = 4;
  },
};

const PHASE_PAGES = [takeOff, enroute(1), enroute(2), enroute(3), appr, goAround];

/** PERF: the page of the phase shown (Mcdu.perfPhase) */
const perf: Page = {
  screen: (m) => PHASE_PAGES[m.perfPhase]!.screen(m),
  lsk: (m, side, n, sp) => PHASE_PAGES[m.perfPhase]!.lsk?.(m, side, n, sp),
};

export const PERF_PAGES: Record<string, Page> = { perf };
