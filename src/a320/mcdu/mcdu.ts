// An A320's MCDU (docs/PLAN-A320.md, A9 — FlightGear's Models/Instruments/MCDU/MCDU.nas and Nasal/MCDU/*.nas): its
// scratchpad (the keys typed into it, CLR — a character, or all of it pressed twice —, +/-, the FMGC's messages shown
// in it when it is empty), its pages (INIT A and B, F-PLN, LAT REV, DIR TO, PERF's phases, PROG, FUEL PRED, RAD NAV,
// DATA, A/C STATUS, the MCDU MENU), the line select keys entering the scratchpad into a field or acting, the page and
// slew keys; its picture (screen.ts). The FMS's data and the flight plan are the host's (types.ts). Pure but the
// drawing.

import { drawScreen, MC, type Ctx, type Run, type Screen, run } from "./screen";
import type { McduApi, McduHost } from "./types";
import { INIT_PAGES } from "./pages-init";
import { FPLN_PAGES } from "./pages-fpln";
import { PERF_PAGES } from "./pages-perf";
import { MISC_PAGES } from "./pages-misc";

/** What a line select key's action gave: done (the scratchpad cleared), nothing, or an error for the scratchpad. */
export type LskResult = boolean | void | "format" | "notallowed" | "notindb";

/** A page: its screen, its line select keys (`sp` the scratchpad's — "CLR" for a deletion, "" none), its slew keys. */
export interface Page {
  screen(m: Mcdu): Screen;
  lsk?(m: Mcdu, side: "L" | "R", n: number, sp: string): LskResult;
  arrow?(m: Mcdu, dir: "left" | "right" | "up" | "down"): boolean;
}

const PAGES: Record<string, Page> = { ...INIT_PAGES, ...FPLN_PAGES, ...PERF_PAGES, ...MISC_PAGES };

/** the page keys (FlightGear's names) → the pages they open */
const PAGE_KEYS: Record<string, string> = {
  init: "inita",
  "f-pln": "fpln",
  dir: "dirto",
  perf: "perf",
  prog: "prog",
  "fuel-pred": "fuelpred",
  radnav: "radnav",
  data: "data",
  mcdu: "menu",
  "sec-fpln": "sec",
  atc: "atc",
  airport: "fpln",
};

const MSG = { format: "FORMAT ERROR", notallowed: "NOT ALLOWED", notindb: "NOT IN DATA BASE" } as const;

export class Mcdu implements McduApi {
  /** the scratchpad's text, the page shown and its own state */
  sp = "";
  pageId = "status";
  /** F-PLN's first waypoint shown, LAT REV's waypoint, DIR TO's list's first, PERF's phase shown (0 TAKE OFF … 5 GO
   *  AROUND), the DATA index's page */
  fplnTop = 0;
  latRev = 0;
  dirTop = 0;
  perfPhase = 0;
  dataPage = 1;
  /** the DIR TO's waypoint chosen (its index) before it is done */
  dirSel: number | null = null;
  private clrAt = -1e9;
  /** a local message (the MCDU's own: FORMAT ERROR…), shown before the FMGC's */
  private msg: string | null = null;

  constructor(
    /** 0 the captain's, 1 the first officer's */
    readonly side: 0 | 1,
    readonly host: McduHost,
    private clock: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  ) {}

  /** the page shown */
  get current(): Page {
    return PAGES[this.pageId] ?? PAGES.status!;
  }

  /** a page opened (its own state reset where it has one) */
  open(id: string) {
    if (!PAGES[id]) return;
    this.pageId = id;
    if (id === "dirto") (this.dirSel = null), (this.dirTop = 0);
  }

  /** a message in the scratchpad (FORMAT ERROR, NOT ALLOWED…) */
  say(m: string) {
    this.msg = m;
  }
  /** the message shown now (the MCDU's, else the FMGC's first) */
  get message(): string | null {
    return this.msg ?? this.host.fms.messages[0] ?? null;
  }

  // ---------------------------------------------------------------- the keys

  button(k: string) {
    if (k === "CLR") return this.clr();
    // (a key over a message: the message goes first)
    if (this.msg) this.msg = null;
    if (this.sp === "CLR") this.sp = "";
    if (k === "PLUSMINUS") {
      if (this.sp.endsWith("-")) this.sp = `${this.sp.slice(0, -1)}+`;
      else if (this.sp.endsWith("+")) this.sp = `${this.sp.slice(0, -1)}-`;
      else this.sp += "-";
    } else if (k === "SP") this.sp += " ";
    else if (k === "OVFY") this.sp += "Δ";
    else if (/^[A-Z0-9./]$/.test(k)) this.sp += k;
    this.sp = this.sp.slice(0, 22);
  }

  /** CLR: the message cleared; else a character; pressed again within 0.6 s, all of it; on nothing, "CLR" itself (a
   *  field then deleted by its line select key) */
  private clr() {
    const now = this.clock();
    if (this.msg) this.msg = null;
    else if (!this.sp && this.host.fms.messages.length) this.host.fms.messages.shift();
    else if (!this.sp) this.sp = "CLR";
    else if (this.sp === "CLR") this.sp = "";
    else if (now - this.clrAt < 600) this.sp = "";
    else this.sp = this.sp.slice(0, -1);
    this.clrAt = now;
  }

  lsk(side: "L" | "R", n: number) {
    const P = this.current;
    if (!P.lsk) return;
    const sp = this.sp.trim();
    const r = P.lsk(this, side, n, sp);
    if (r === true) this.sp = "";
    else if (r === "format" || r === "notallowed" || r === "notindb") this.say(MSG[r]);
  }

  page(name: string) {
    const id = PAGE_KEYS[name];
    if (!id) return;
    if (name === "airport") this.fplnTop = Math.max(this.host.route().wps.length - 5, 0);
    if (id === "perf") this.perfPhase = phaseIndex(this.host.fmgc()?.phase);
    this.open(id);
  }

  arrow(dir: "left" | "right" | "up" | "down") {
    this.current.arrow?.(this, dir);
  }

  /** the computer's keyboard (its keyboard mode): letters, digits, ".", "/", space; "-" and "+"; backspace / delete
   *  as CLR */
  type(text: string) {
    for (const ch of text.toUpperCase()) {
      if (ch === "\b" || ch === "\x7f") this.button("CLR");
      else if (ch === " ") this.button("SP");
      else if (ch === "-" || ch === "+") {
        if (this.msg) this.msg = null;
        this.sp = `${this.sp}${ch}`.slice(0, 22);
      } else this.button(ch);
    }
  }

  // ---------------------------------------------------------------- the picture

  /** the scratchpad's runs: its text (white), else the message (white; amber for the FMGC's — CHECK …) */
  scratch(): Run[] {
    if (this.msg) return [run(this.msg, MC.white)];
    if (this.sp) return [run(this.sp, MC.white)];
    const m = this.host.fms.messages[0];
    return m ? [run(m, /^CHECK|LIMIT|^NOT/.test(m) ? MC.amber : MC.white)] : [];
  }

  render(ctx: Ctx, w: number, h: number) {
    let S: Screen;
    try {
      S = this.current.screen(this);
    } catch (e) {
      console.error("MCDU", this.pageId, e);
      S = { title: [run("MCDU")], lines: [] };
    }
    drawScreen(ctx, S, this.scratch(), w, h);
  }
}

/** PERF's phase shown at its key: the FMGC's (0 TAKE OFF, 1 CLB, 2 CRZ, 3 DES, 4 APPR, 5 GO AROUND) */
export function phaseIndex(p: string | undefined): number {
  switch (p) {
    case "climb":
      return 1;
    case "cruise":
      return 2;
    case "descent":
      return 3;
    case "approach":
      return 4;
    case "go around":
      return 5;
    default:
      return 0;
  }
}
