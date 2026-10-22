// The A320's system display, the lower ECAM (docs/PLAN-A320.md, A7): FlightGear's thirteen pages
// (Models/Instruments/Lower-ECAM/res/*.svg), each fetched with its first showing and driven as Lower-ECAM-*.nas drives
// it (sd-pages.ts), the bottom strip on every page (TAT, SAT, UTC, G LOAD, GW). The page: the one the ECAM control
// panel's button asked (the deck's "ecam/sd-page" — deckgame.ts; STS, again: back to automatic), else the FWC's own
// (Lower-ECAM.nas / the FWC's phases): the ENG page at take-off power and while climbing with the slats out, the
// F/CTL page for 20 s after a flight controls' check on the ground, the WHEEL page on the ground and with the gear down
// below 16 000 ft, the CRZ page in cruise.

import type { DuData } from "./data";
import { type Ctx, Display, fontOf } from "./display";
import { bottomStrip, EcamSvg } from "./ecam-common";
import { PAGES, type SdPage, type SdState } from "./sd-pages";

export class Sd extends Display {
  private pages = new Map<string, { page: SdPage; svg: EcamSvg; inited: boolean }>();
  private state: SdState = { fctlUntil: -Infinity, last: "" };
  /** the page drawn (tests, captures) */
  shown = "";

  constructor() {
    super(0, null);
    this.hz = 5;
    for (const [name, page] of Object.entries(PAGES)) this.pages.set(name, { page, svg: new EcamSvg(page.url), inited: false });
  }

  /** The page wanted now: the panel's, else the FWC's. */
  pageFor(d: DuData, t: number): string {
    const asked = String(d.deck["ecam/sd-page"] ?? "");
    if (asked && this.pages.has(asked)) return asked;
    const S = this.state;
    // (a flight controls' check on the ground: the surfaces moved past a third of their travel)
    const s = d.surfaces;
    if (d.onGround && (Math.abs(s.ailL) > 8 || Math.abs(s.ailR) > 8 || Math.abs(s.elevL) > 8 || Math.abs(s.rudder) > 10))
      S.fctlUntil = t + 20;
    const takeoff = d.eng.some((e) => e.n1 > 70);
    if (d.onGround) return takeoff ? "enginePage" : t < S.fctlUntil ? "fctlPage" : "wheelPage";
    if (d.gear.down && d.alt < 16000) return "wheelPage";
    if (d.confName !== "0" && d.vs > 300) return "enginePage";
    return "cruisePage";
  }

  override ready(): boolean {
    return true;
  }

  draw(ctx: Ctx, d: DuData, t: number) {
    const name = this.pageFor(d, t);
    const P = this.pages.get(name)!;
    // (the others fetched in the background: no blank screen on the next button)
    for (const q of this.pages.values()) q.svg.get();
    const doc = P.svg.get();
    if (!doc) return;
    if (!P.inited) {
      P.page.init(doc);
      P.inited = true;
    }
    P.page.update(doc, d, this.state, t);
    bottomStrip(doc, d);
    this.state.last = name;
    this.shown = name;
    doc.draw(ctx, 1024, 1024, fontOf);
  }
}
