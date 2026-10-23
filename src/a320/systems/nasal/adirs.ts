// The A320's three ADIRUs as FlightGear's Nasal runs them (docs/PLAN-A320.md, A10 — Nasal/Systems/ADIRS/ADR.nas, and
// Nasal/Panels/SwitchingPanel.nas's AIR DATA and ATT HDG selectors): the IR mode selectors (OFF, NAV, ATT), the
// alignment — its time by the latitude, ((0.002 × lat²) + 5) min: 5 min at the equator, 9 at 45°, 15 at 70° —, the
// attitude on the PFD 20 to 25 s after the selector left OFF, the ADR pushbuttons, the power (each unit's AC bus, else
// its battery's: ADIRU 2's for 5 minutes only, ADIRU 3's too unless ATT HDG is on CAPT 3) and ON BAT, the self test
// as a unit comes alive (the lights flashing, ON BAT 5 s), an alignment started again when the aircraft moved, the
// VFE the ADRs compute from the flaps and slats. Pure.

import type { Props } from "../../rig";
import type { NasalModule, StartState } from "../types";
import { bool, Clock, knobArg, Listen, num, setb } from "./util";

const N = 3;
const at = (k: string) => [1, 2, 3].map((i) => k.replace("#", String(i)));
const K = {
  adrFault: at("controls/navigation/adirscp/lights/adr-#-fault"),
  adrOff: at("controls/navigation/adirscp/lights/adr-#-off"),
  irFault: at("controls/navigation/adirscp/lights/ir-#-fault"),
  irOff: at("controls/navigation/adirscp/lights/ir-#-off"),
  onBat: "controls/navigation/adirscp/lights/on-bat",
  adrSw: at("controls/navigation/adirscp/switches/adr-#"),
  irModeSw: at("controls/navigation/adirscp/switches/ir-#-mode"),
  irSw: at("controls/navigation/adirscp/switches/ir-#"),
  adrOperating: at("systems/navigation/adr/operating-#"),
  aligned: at("systems/navigation/aligned-#"),
  /** the NDs' IR flags (efis[0]/nd/ir-1, efis[1]/nd/ir-2, efis[0]/nd/ir-3) */
  nd: ["instrumentation/efis/nd/ir-1", "instrumentation/efis[1]/nd/ir-2", "instrumentation/efis/nd/ir-3"],
  /** (not FlightGear's — its PFD's Nasal reads the units: the attitude shown, the alignment's seconds left) */
  irOperating: at("systems/navigation/ir/operating-#"),
  alignLeft: at("systems/navigation/ir/align-time-left-#"),
  overspeedVFE: "systems/navigation/adr/computation/overspeed-vfe-spd",
  skip: "controls/adirs/skip",
  mcdu: "controls/adirs/mcducbtn",
  alignFault: "systems/navigation/align-fault",
  lat: "position/latitude-deg",
  flap: "fdm/jsbsim/fcs/flap-pos-deg",
  slat: "fdm/jsbsim/fcs/slat-pos-deg",
  airData: "controls/navigation/switching/air-data",
  attHdg: "controls/navigation/switching/att-hdg",
};
/** each unit's supply: AC ESS SHED, AC 2, AC 1; its backup: HOT BUS 1 (unlimited), HOT BUS 2 (5 min), HOT BUS 1 (5 min) */
const MAIN = ["systems/electrical/bus/ac-ess-shed", "systems/electrical/bus/ac-2", "systems/electrical/bus/ac-1"];
const BACKUP = ["systems/electrical/bus/dc-hot-1", "systems/electrical/bus/dc-hot-2", "systems/electrical/bus/dc-hot-1"];

/** the alignment's time [s] at a latitude [°] (ADR.nas calcAlignTime) */
export const calcAlignTime = (lat: number) => (0.002 * lat * lat + 5) * 60;

class Adiru {
  alignTime = 0;
  pfdTime = 0;
  voltageMain = 0;
  voltageBackup = 0;
  limited = false;
  noPowerTime = 0;
  aligned = false;
  operating = false;
  inAlign = false;
  outputOn = true;
  mode = 0;
  energised = false;
  operative = false;
  constructor(
    readonly n: number,
    private A: Adirs,
  ) {}

  setOperative(P: Props, v: boolean) {
    if (v !== this.operative) {
      this.operative = v;
      if (v) this.selfTest(P);
    }
  }

  selfTest(P: Props) {
    const A = this.A,
      n = this.n,
      c = A.clock;
    A.selfTesting = true;
    A.selfTestTime = c.t;
    P[K.adrOff[n]!] = 1;
    P[K.adrFault[n]!] = 1;
    c.after(0.1, () => {
      P[K.adrOff[n]!] = 0;
      P[K.adrFault[n]!] = 0;
    });
    c.after(1.0, () => {
      P[K.adrOff[n]!] = 1;
      P[K.adrFault[n]!] = 1;
      P[K.irFault[n]!] = 1;
      P[K.irOff[n]!] = 1;
    });
    c.after(1.1, () => {
      P[K.adrOff[n]!] = bool(P, K.adrSw[n]!) ? 0 : 1;
      P[K.adrFault[n]!] = 0;
      P[K.irFault[n]!] = 0;
      P[K.irOff[n]!] = 0;
    });
    setb(P, K.onBat, 1);
    A.selfTestLoop = true;
  }

  align(P: Props, time: number) {
    const t = this.A.clock.t;
    P[K.irFault[this.n]!] = 0;
    if (this.aligned || this.inAlign || !this.operative) return;
    if (!bool(P, K.skip)) {
      if (time <= 0) return;
      this.alignTime = t + time;
      this.pfdTime = t + 20 + this.A.rand() * 5;
    } else {
      this.alignTime = t + 5;
      this.pfdTime = t + 1;
    }
    this.inAlign = true;
  }

  stopAlignNoAlign(P: Props) {
    this.inAlign = false;
    this.aligned = false;
    P[K.nd[this.n]!] = 0;
    P[K.aligned[this.n]!] = 0;
    this.operating = false;
  }

  stopAlignAligned(P: Props) {
    this.inAlign = false;
    this.aligned = true;
    P[K.nd[this.n]!] = 1;
    P[K.aligned[this.n]!] = 1;
  }

  /** the alignment's timer (alignLoop) */
  alignLoop(P: Props) {
    const t = this.A.clock.t;
    if (bool(P, K.alignFault)) {
      this.stopAlignNoAlign(P);
      this.update(P);
      this.align(P, calcAlignTime(num(P, K.lat)));
    } else if (!this.operative) this.stopAlignNoAlign(P);
    else if (t >= this.alignTime) this.stopAlignAligned(P);
    if (!this.operating && t >= this.pfdTime) this.operating = true;
  }

  instAlign(P: Props) {
    this.stopAlignAligned(P);
    this.operating = true;
  }

  /** the unit's power (update): operative or not; → whether it runs on its battery */
  update(P: Props): boolean {
    const t = this.A.clock.t;
    if (this.energised && !this.voltageMain && this.limited && this.noPowerTime === 0) this.noPowerTime = t;
    if (this.energised && this.mode) {
      if (this.voltageMain) {
        this.noPowerTime = 0;
        this.setOperative(P, true);
        return false;
      }
      if (((t < this.noPowerTime + 300 && this.limited) || !this.limited) && this.voltageBackup) {
        this.setOperative(P, true);
        return true;
      }
    }
    this.noPowerTime = 0;
    this.setOperative(P, false);
    return false;
  }
}

export class Adirs implements NasalModule {
  readonly name = "ADIRS";
  readonly clock = new Clock();
  units: Adiru[];
  selfTesting = false;
  selfTestTime = 0;
  selfTestLoop = false;
  /** the backup's limit by unit (ATT HDG on CAPT 3: ADIRU 3's battery unlimited) */
  private backupLimited = [false, true, true];
  private cacheOperative = [false, false, false];
  private cacheOutputOn = [true, true, true];
  private L = new Listen();

  /** rand: the PFD's 20 to 25 s (Math.random; a test's own) */
  constructor(readonly rand: () => number = Math.random) {
    this.units = [0, 1, 2].map((n) => new Adiru(n, this));
  }

  // ---- ADIRSControlPanel
  adrSw(P: Props, n: number) {
    if (n < 0 || n >= N) return;
    const was = bool(P, K.adrSw[n]!);
    setb(P, K.adrSw[n]!, !was);
    this.units[n]!.outputOn = !was;
    setb(P, K.adrOff[n]!, was);
  }
  irSw(P: Props, n: number) {
    if (n < 0 || n >= N) return;
    const was = bool(P, K.irSw[n]!);
    setb(P, K.irSw[n]!, !was);
    // (ADR.nas lights IR OFF with the ADR's state — kept)
    setb(P, K.irOff[n]!, bool(P, K.adrSw[n]!) ? 0 : 1);
  }
  irModeSw(P: Props, n: number, mode: number) {
    if (n < 0 || n >= N || mode < 0 || mode > 2) return;
    const u = this.units[n]!;
    u.mode = mode;
    u.energised = mode !== 0;
    P[K.irModeSw[n]!] = mode;
    if (mode === 0) {
      P[K.irFault[n]!] = 0;
      u.stopAlignNoAlign(P);
    } else if (!u.aligned) {
      this.power(P, n);
      u.update(P);
      u.align(P, calcAlignTime(num(P, K.lat)));
    }
  }

  // ---- SwitchingPanel (what the systems see of it: the selectors, ATT HDG's backup for ADIRU 3)
  doAirData(P: Props, v: number) {
    if (v < -1 || v > 1) return;
    P[K.airData] = v;
  }
  doAttHdg(P: Props, v: number) {
    if (v < -1 || v > 1) return;
    this.backupLimited[2] = v !== -1;
    P[K.attHdg] = v;
  }

  private power(P: Props, i: number) {
    const u = this.units[i]!;
    u.voltageMain = num(P, MAIN[i]!);
    if (!u.voltageMain) {
      u.voltageBackup = num(P, BACKUP[i]!);
      u.limited = this.backupLimited[i]!;
    }
  }

  /** the VFE [kt] by the flaps and slats [°] (1024: clean) */
  private vfe(P: Props) {
    const f = num(P, K.flap),
      s = num(P, K.slat);
    if (f >= 23 && s >= 25) return 181;
    if (f >= 18) return 189;
    if (f >= 13 || s > 20) return 204;
    if (s <= 20 && f > 2) return 219;
    if (s >= 2 && s <= 20) return 234;
    return 1024;
  }

  step(P: Props, dt: number) {
    this.clock.tick(dt);
    if (this.L.edge(P, K.skip) && bool(P, K.skip)) for (const u of this.units) if (u.inAlign) u.instAlign(P);
    // (ON BAT: any unit on its battery — ADR.nas has each unit set it in turn, the last one's kept)
    let onBat = false;
    for (let i = 0; i < N; i++) {
      const u = this.units[i]!;
      this.power(P, i);
      if (u.update(P)) onBat = true;
      if (u.operative !== this.cacheOperative[i] || u.outputOn !== this.cacheOutputOn[i]) {
        this.cacheOperative[i] = u.operative;
        this.cacheOutputOn[i] = u.outputOn;
        setb(P, K.adrOperating[i]!, u.outputOn && u.operative);
      }
      // (a unit set to NAV or ATT while unpowered aligns once it has power — ADR.nas waits for the next turn of the
      // selector; FlightGear's HOT BUS 1 always has the batteries')
      if (u.energised && u.operative && !u.aligned && !u.inAlign) u.align(P, calcAlignTime(num(P, K.lat)));
      if (u.inAlign) u.alignLoop(P);
      else if (!u.operating && u.aligned && this.clock.t >= u.pfdTime) u.operating = true;
      setb(P, K.irOperating[i]!, u.operating);
      P[K.alignLeft[i]!] = u.inAlign ? Math.max(0, u.alignTime - this.clock.t) : 0;
    }
    if (!this.selfTesting) setb(P, K.onBat, onBat);
    if (this.selfTestLoop && this.clock.t > this.selfTestTime + 5) {
      setb(P, K.onBat, 0);
      this.selfTestLoop = false;
      this.selfTesting = false;
    }
    P[K.overspeedVFE] = this.vfe(P);
  }

  call(fn: string, args: (number | string)[], P: Props): boolean {
    const n = typeof args[0] === "number" ? args[0] : Number(args[0]);
    switch (fn) {
      case "systems.ADIRSControlPanel.adrSw":
        this.adrSw(P, n);
        return true;
      case "systems.ADIRSControlPanel.irSw":
        this.irSw(P, n);
        return true;
      case "systems.ADIRSControlPanel.irModeSw": {
        // (the knob's notch: "….getValue() ± 1" from where it is, its ends kept)
        const m = knobArg(args[1], num(P, K.irModeSw[n] ?? ""));
        if (m !== null && m >= 0 && m <= 2) this.irModeSw(P, n, m);
        return true;
      }
      case "systems.SwitchingPanel.doAirData":
      case "systems.SwitchingPanel.doAttHdg": {
        const air = fn.endsWith("doAirData");
        const m = knobArg(args[0], num(P, air ? K.airData : K.attHdg));
        if (m !== null) (air ? this.doAirData : this.doAttHdg).call(this, P, m);
        return true;
      }
    }
    const inst = /^systems\.ADIRS\.ADIRunits\[(\d)\]\.instAlign$/.exec(fn);
    if (inst) {
      this.units[Number(inst[1])]?.instAlign(P);
      return true;
    }
    return false;
  }

  reset(P: Props, s: StartState) {
    this.clock.clear();
    this.selfTesting = this.selfTestLoop = false;
    this.backupLimited = [false, true, true];
    const nav = s !== "cold";
    for (let i = 0; i < N; i++) {
      const u = new Adiru(i, this);
      this.units[i] = u;
      P[K.adrSw[i]!] = 1;
      P[K.irSw[i]!] = 0;
      P[K.adrFault[i]!] = P[K.adrOff[i]!] = P[K.irFault[i]!] = P[K.irOff[i]!] = 0;
      P[K.irModeSw[i]!] = nav ? 1 : 0;
      u.mode = nav ? 1 : 0;
      u.energised = nav;
      // (FlightGear's "before start" aligns them at once; their self test long done)
      u.operative = nav;
      u.aligned = u.operating = nav;
      setb(P, K.aligned[i]!, nav);
      setb(P, K.nd[i]!, nav);
      setb(P, K.adrOperating[i]!, nav);
      setb(P, K.irOperating[i]!, nav);
      P[K.alignLeft[i]!] = 0;
      this.cacheOperative[i] = nav;
      this.cacheOutputOn[i] = true;
    }
    setb(P, K.onBat, 0);
    setb(P, K.mcdu, nav);
    P[K.airData] = 0;
    P[K.attHdg] = 0;
    if (P[K.skip] === undefined) P[K.skip] = 0;
    P[K.overspeedVFE] = this.vfe(P);
    this.L.prime(P, [K.skip]);
  }
}
