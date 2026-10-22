// The system display's page as the ECAM chooses it (FlightGear's Nasal/ECAM/SystemDisplay.nas — docs/PLAN-A320.md,
// A11): automatic by the flight phase (DOOR at the stand, WHEEL taxiing, ENG at take-off, CRUISE, WHEEL below
// 16 000 ft with the gear down…), the APU's page while it starts, the ENG page while the ENG MODE is at CRANK or
// IGN/START, the F/CTL page 20 s after the controls' check; a failure's page (a warning's sdPage); the crew's buttons
// on the ECAM control panel — a page pressed again, CLR, back to automatic. Its buttons' lights (ECAM/Lower/light/*).
// Pure.

import type { Props } from "../rig";
import { num } from "../systems/nasal/util";

/** FlightGear's page names (PageList) to the SD's pages (their names on the deck's lights) */
export const PAGES: Record<string, string> = {
  apuPage: "apu",
  bleedPage: "bleed",
  cabPressPage: "press",
  condPage: "cond",
  cruisePage: "cruise",
  doorPage: "door",
  enginePage: "eng",
  elecPage: "elec",
  fctlPage: "fctl",
  fuelPage: "fuel",
  hydraulicPage: "hyd",
  statusPage: "sts",
  wheelPage: "wheel",
};

/** 0 manual, 1 a failure's, 3 automatic (2, advisory, FlightGear's not yet) */
type Mode = 0 | 1 | 3;

export class SystemDisplay {
  /** the page shown (a PAGES key) */
  page = "doorPage";
  private last: string | null = null;
  private lastMode: Mode | null = null;
  mode: Mode = 3;
  private below16000 = false;
  private D = { APU: false, Cruise: false, Elec: false, Engine: false, FCTL: false };
  private T = {
    apuOn: false,
    apu: 0,
    cruiseOn: false,
    cruise: 0,
    engStart: false,
    engOn: false,
    eng: 0,
    fctlStart: false,
    fctlOn: false,
    fctl: 0,
  };
  private lastPhase = 0;
  private lastLever = 0;

  reset() {
    this.page = "doorPage";
    this.last = this.lastMode = null;
    this.mode = 3;
    this.below16000 = false;
    this.D = { APU: false, Cruise: false, Elec: false, Engine: false, FCTL: false };
    this.T = {
      apuOn: false,
      apu: 0,
      cruiseOn: false,
      cruise: 0,
      engStart: false,
      engOn: false,
      eng: 0,
      fctlStart: false,
      fctlOn: false,
      fctl: 0,
    };
  }

  private light(P: Props, page: string, on: boolean) {
    const n = PAGES[page];
    if (n && n !== "cruise") P[`ECAM/Lower/light/${n}`] = on ? 1 : 0;
  }

  /** autoCallLoop: the automatic page */
  private auto(P: Props) {
    if (this.mode !== 3) return;
    const ph = num(P, "ECAM/warning-phase");
    const D = this.D;
    let p = this.page;
    if (D.APU) p = "apuPage";
    else if (D.Engine) p = "enginePage";
    else if (ph === 1) p = D.Elec ? "elecPage" : "doorPage";
    else if (ph === 2) p = D.Elec ? "elecPage" : D.FCTL ? "fctlPage" : "wheelPage";
    else if (ph >= 3 && ph <= 5) p = "enginePage";
    else if (ph === 6) p = num(P, "controls/gear/lever") === 1 && this.below16000 ? "wheelPage" : D.Cruise ? "cruisePage" : "enginePage";
    else if (ph === 7) p = "wheelPage";
    else if (ph === 8 || ph === 9) p = D.Elec ? "elecPage" : "wheelPage";
    else if (ph === 10) p = D.Elec ? "elecPage" : "doorPage";
    this.page = p;
  }

  private autoCall(P: Props) {
    this.mode = 3;
    this.auto(P);
  }

  /** the ECAM's 1 s update (ECAMTimer), and its listeners on the phase and the gear lever */
  update(P: Props, now: number) {
    const ph = num(P, "ECAM/warning-phase");
    const lever = num(P, "controls/gear/lever");
    if ((ph !== this.lastPhase || lever !== this.lastLever) && this.mode === 3) this.autoCall(P);
    this.lastPhase = ph;
    this.lastLever = lever;
    const D = this.D,
      T = this.T;
    const set = (k: keyof typeof D, v: boolean) => {
      if (D[k] !== v) {
        D[k] = v;
        this.auto(P);
      }
    };
    const below = num(P, "position/altitude-ft") < 16000;
    if (below !== this.below16000) {
      this.below16000 = below;
      this.auto(P);
    }
    set("Elec", num(P, "controls/electrical/switches/emer-gen-test") !== 0);
    // (the APU's page from its MASTER until 10 s after 95 %)
    if (num(P, "controls/apu/master")) {
      if (num(P, "engines/engine[2]/n1") > 95 && !T.apuOn) {
        T.apuOn = true;
        T.apu = now;
      }
      set("APU", !T.apuOn || now - T.apu < 10);
    } else {
      T.apuOn = false;
      T.apu = 0;
      set("APU", false);
    }
    // (the flight controls moved: F/CTL, 20 s after they rest)
    if (
      Math.abs(num(P, "controls/flight/aileron")) > 0.05 ||
      Math.abs(num(P, "controls/flight/elevator")) > 0.05 ||
      Math.abs(num(P, "controls/flight/rudder")) > 0.5
    ) {
      T.fctlStart = true;
      set("FCTL", true);
      this.auto(P);
    } else if (!T.fctlOn && T.fctlStart) {
      T.fctlOn = true;
      T.fctlStart = false;
      T.fctl = now;
    } else if (T.fctlOn) {
      if (now - T.fctl < 20) set("FCTL", true);
      else {
        T.fctlOn = false;
        T.fctl = 0;
      }
    } else {
      set("FCTL", false);
      T.fctl = 0;
    }
    // (in cruise: at once with the flaps up and no take-off power, else after a minute)
    if (ph === 6) {
      if (!num(P, "ECAM/phases/phase-calculation/takeoff-power") && num(P, "controls/flight/flaps-pos") === 0) set("Cruise", true);
      else if (!D.Cruise) {
        if (!T.cruiseOn) {
          T.cruiseOn = true;
          T.cruise = now;
        } else if (now - T.cruise > 60) set("Cruise", true);
      }
    } else {
      T.cruise = 0;
      T.cruiseOn = false;
      set("Cruise", false);
    }
    // (the ENG MODE at CRANK or IGN/START: ENG, 10 s after it is back to NORM)
    const sel = num(P, "controls/ignition/start-sw");
    if (sel === 0 || sel === 2) {
      set("Engine", true);
      if (sel === 2) T.engStart = true;
    } else {
      if (T.engStart && !T.engOn) {
        T.engOn = true;
        T.eng = now;
      }
      if (T.engOn) {
        if (now - T.eng < 10) set("Engine", true);
        else {
          T.engStart = T.engOn = false;
          T.eng = 0;
          set("Engine", false);
        }
      } else set("Engine", false);
    }
  }

  /** failureCall: a warning's page */
  failure(P: Props, page: string) {
    if (!PAGES[page]) return;
    this.light(P, this.page, false);
    this.last = this.page;
    this.page = page;
    this.lastMode = this.mode;
    this.mode = 1;
    this.light(P, page, true);
  }

  /** manCall: a page's button (pressed again: automatic), or "CLR" (back from a failure's or the crew's page) */
  man(P: Props, page: string) {
    if (PAGES[page]) {
      if (this.page === page && this.mode !== 3) {
        this.light(P, this.page, false);
        this.autoCall(P);
      } else {
        this.light(P, this.page, false);
        if (this.mode === 1) {
          this.last = this.page;
          this.lastMode = this.mode;
        } else if (this.mode === 3) this.lastMode = 3;
        this.page = page;
        this.mode = 0;
        this.light(P, page, true);
      }
    } else if (page === "CLR") {
      if (this.mode === 1) {
        this.light(P, this.page, false);
        if (this.lastMode === 0 && this.last) {
          this.page = this.last;
          this.light(P, this.page, true);
          this.last = null;
          this.mode = 0;
        } else this.autoCall(P);
        this.lastMode = 3;
      } else if (this.mode === 0) {
        this.light(P, this.page, false);
        if (this.lastMode === 1 && this.last) {
          this.page = this.last;
          this.light(P, this.page, true);
          this.last = null;
          this.mode = 1;
        } else this.autoCall(P);
        this.lastMode = 3;
      }
    }
  }
}
