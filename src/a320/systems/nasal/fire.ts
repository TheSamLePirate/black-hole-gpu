// The A320's fire protection as FlightGear's Nasal runs it (docs/PLAN-A320.md, A10 — Nasal/Systems/fire.nas): each
// engine's and the APU's detection — two loops a unit, each on its bus, hot past 250 °C with a fire; a warning when
// both see it, or one alone with the other failed or unpowered, or both lost within 5 s (else DET INOP) —, the cargo
// holds' smoke detectors through the CIDS; the extinguishers — an agent's button with its fire button out (and its
// bus): the bottle emptied in half a second, DISCH lit, the fire out most of the time, within 3 s —, the agents'
// timers (AGENT 1's 10 s once the fire button is out, AGENT 2's 30 s once AGENT 1 is gone), an APU fire on the ground
// stopping it and firing its bottle at 3 s; the TEST buttons (the warnings lit while held, with power), the cargo's
// test sequence (3 s steps: the warnings, DISCH, the warnings). The master warning's silencing (ecam.shutUpYou) is the
// ECAM's. Pure but for the dice (rand: the loops burnt, the fire out).

import type { Props } from "../../rig";
import type { NasalModule, StartState } from "../types";
import { assign, bool, Clock, Listen, num, setb } from "./util";

const BUS = {
  dcEss: "systems/electrical/bus/dc-ess",
  dc2: "systems/electrical/bus/dc-2",
  dcBat: "systems/electrical/bus/dc-bat",
  dcHot1: "systems/electrical/bus/dc-hot-1",
  dcHot2: "systems/electrical/bus/dc-hot-2",
};
const F = {
  eng1: "systems/failures/fire/engine-left-fire",
  eng2: "systems/failures/fire/engine-right-fire",
  apu: "systems/failures/fire/apu-fire",
  aft: "systems/failures/fire/cargo-aft-fire",
  fwd: "systems/failures/fire/cargo-fwd-fire",
};
const K = {
  test: ["controls/fire/test-btn-1", "controls/fire/test-btn-2", "controls/fire/apu-test-btn"],
  warn: ["systems/fire/engine1/warning-active", "systems/fire/engine2/warning-active", "systems/fire/apu/warning-active"],
  inop: ["systems/fire/engine1/det-inop", "systems/fire/engine2/det-inop", "systems/fire/apu/det-inop"],
  temp: ["systems/fire/engine1/temperature", "systems/fire/engine2/temperature", "systems/fire/apu/temperature"],
  fireBtn: ["controls/engines/engine/fire-btn", "controls/engines/engine[1]/fire-btn", "controls/apu/fire-btn"],
  aftWarn: "systems/fire/cargo/aft/warning-active",
  fwdWarn: "systems/fire/cargo/fwd/warning-active",
  aftTemp: "systems/fire/cargo/aft/temperature",
  fwdTemp: "systems/fire/cargo/fwd/temperature",
  cargoTest: "controls/fire/cargo/test",
  cargoTestOff: "controls/fire/cargo/test-off",
  dischTest: "systems/fire/cargo/disch-test",
  aftDisch: "controls/fire/cargo/aftdisch",
  fwdDisch: "controls/fire/cargo/fwddisch",
  wow: "fdm/jsbsim/position/wow",
};
const FIRE = [F.eng1, F.eng2, F.apu];

/** a loop's states (fire.nas): 0 quiet, 1 hot, 8 unpowered, 9 failed */
type LoopState = 0 | 1 | 8 | 9;
const lost = (l: LoopState) => l === 8 || l === 9;

interface Bottle {
  /** fire.nas's number: 0 AGENT 1, 1 AGENT 2, 7/8 the cargo's (fwd/aft), 9 the APU's */
  number: number;
  light: string;
  elec: string;
  fail: string;
  warning: string;
  /** [%] (the cargo's two share one bottle) */
  store: { q: number };
  emptying: boolean;
  acc: number;
}

class DetectorUnit {
  loop: [LoopState, LoopState] = [0, 0];
  condition = 100;
  failTime: [number, number] = [0, 0];
  failTimer = false;
  inopTimer = false;
  constructor(readonly sys: number) {}
}

export class Fire implements NasalModule {
  readonly name = "FIRE";
  private clock = new Clock();
  private L = new Listen();
  private units = [0, 1, 2].map((s) => new DetectorUnit(s));
  /** the cargo's smoke detectors: aft (two), fwd */
  private cargo = [0, 1, 2].map(() => ({ loop: [0, 0] as [LoopState, LoopState] }));
  private bottles: Bottle[] = [];
  private cargoBottles: Bottle[] = [];
  /** the agents' timers: eng 1 AGENT 1, AGENT 2, eng 2 AGENT 1, AGENT 2, APU */
  private agents = [
    { prop: "systems/fire/engine1/agent1-timer", back99: true },
    { prop: "systems/fire/engine1/agent2-timer", back99: true },
    { prop: "systems/fire/engine2/agent1-timer", back99: true },
    { prop: "systems/fire/engine2/agent2-timer", back99: true },
    { prop: "systems/fire/apu/agent-timer", back99: false },
  ].map((a) => ({ ...a, at: 0, run: false }));
  private cargoStage = 0;
  private cargoStageTime = 0;
  private tick = 0;
  private apuAutoDisch = false;

  /** apu: the APU stopped by its fire (apu.ts); rand: the dice (Math.random; a test's own) */
  constructor(
    private apu?: { emergencyStop(P: Props): void },
    readonly rand: () => number = Math.random,
  ) {
    this.fill();
  }

  private fill() {
    const b = (number: number, light: string, elec: string, fail: string, warning: string, store = { q: 100 }): Bottle => ({
      number,
      light,
      elec,
      fail,
      warning,
      store,
      emptying: false,
      acc: 0,
    });
    this.bottles = [
      b(0, "systems/fire/engine1/disch1", BUS.dcHot1, F.eng1, K.warn[0]!),
      b(1, "systems/fire/engine1/disch2", BUS.dc2, F.eng1, K.warn[0]!),
      b(0, "systems/fire/engine2/disch1", BUS.dcHot2, F.eng2, K.warn[1]!),
      b(1, "systems/fire/engine2/disch2", BUS.dc2, F.eng2, K.warn[1]!),
      b(9, "systems/fire/apu/disch", BUS.dcBat, F.apu, K.warn[2]!),
    ];
    const cargo = { q: 250 };
    this.cargoBottles = [
      b(8, "systems/fire/cargo/disch", BUS.dcBat, F.aft, K.aftWarn, cargo),
      b(7, "systems/fire/cargo/disch", BUS.dcBat, F.fwd, K.fwdWarn, cargo),
    ];
  }

  // ---- the detection
  private loopTemp(P: Props, sys: number) {
    // (the zone's temperature is a320-engine-fire.xml's; without it, a fire is hot)
    const t = P[K.temp[sys]!];
    return t === undefined ? (bool(P, FIRE[sys]!) ? 300 : 0) : num(P, K.temp[sys]!);
  }

  /** a loop on its bus (detectorLoop.updateTemp): its signal, its power */
  private updateLoop(P: Props, sys: number, type: 1 | 2) {
    const elec = sys === 2 ? BUS.dcBat : (sys === 0) === (type === 1) ? BUS.dcEss : BUS.dc2;
    const u = this.units[sys]!;
    const k = type - 1;
    if (this.loopTemp(P, sys) > 250 && bool(P, FIRE[sys]!) && num(P, elec) >= 25) {
      // (the flames may burn the loops)
      if (this.rand() >= 0.98) {
        this.failLoop(u, 1);
        this.failLoop(u, 2);
      }
      if (u.loop[k] !== 9 && u.loop[k] !== 8 && u.condition !== 0) u.loop[k] = 1;
    } else if (num(P, elec) >= 25) {
      if (u.loop[k] !== 9) u.loop[k] = 0;
    } else u.loop[k] = 8;
  }

  private failLoop(u: DetectorUnit, loop: 1 | 2) {
    u.loop[loop - 1] = 9;
    if (u.loop[2 - loop] === 9) return;
    u.failTime[loop - 1] = this.clock.t;
    u.failTimer = true;
  }

  private triggerWarning(P: Props, sys: number) {
    setb(P, K.warn[sys]!, 1);
    if (sys === 2 && bool(P, K.wow)) {
      this.apu?.emergencyStop(P);
      // (TTM ATA 26: the APU's bottle 3 s later)
      if (!this.apuAutoDisch) {
        this.apuAutoDisch = true;
        this.clock.after(3, () => this.discharge(P, this.bottles[4]!));
      }
    }
  }

  private updateUnit(P: Props, u: DetectorUnit) {
    if (u.condition === 0) return;
    for (let s = 0; s < 3; s++) {
      this.updateLoop(P, s, 1);
      this.updateLoop(P, s, 2);
    }
    const [a, b] = u.loop;
    if (!bool(P, FIRE[u.sys]!) && !bool(P, K.test[u.sys]!) && !lost(a) && !lost(b)) {
      u.loop = [0, 0];
      setb(P, K.warn[u.sys]!, 0);
      if (u.sys === 2) this.apuAutoDisch = false;
      return;
    }
    if ((a === 1 && b === 1) || (lost(a) && b === 1) || (a === 1 && lost(b))) this.triggerWarning(P, u.sys);
  }

  /** the loops lost: both within 5 s, a fire; else DET INOP once both are (checkTimeFire, checkTwoInop) */
  private failTimers(P: Props, u: DetectorUnit) {
    const t = this.clock.t;
    if (u.failTimer) {
      const [f1, f2] = u.failTime;
      if ((f1 !== 0 && t > f1 + 5) || (f2 !== 0 && t > f2 + 5)) {
        u.failTimer = false;
        u.inopTimer = true;
      }
      if (u.loop[0] === 9 && u.loop[1] === 9) {
        u.failTimer = false;
        this.triggerWarning(P, u.sys);
      }
    }
    if (u.inopTimer && u.loop[0] === 9 && u.loop[1] === 9) {
      setb(P, K.inop[u.sys]!, 1);
      u.inopTimer = false;
    }
  }

  private updateCargo(P: Props) {
    const temps = [K.aftTemp, K.aftTemp, K.fwdTemp];
    const fires = [F.aft, F.aft, F.fwd];
    for (let i = 0; i < 3; i++) {
      const t = P[temps[i]!] === undefined ? (bool(P, fires[i]!) ? 300 : 0) : num(P, temps[i]!);
      if (t > 250 && bool(P, fires[i]!)) for (const k of [0, 1]) if (this.cargo[i]!.loop[k] !== 9) this.cargo[i]!.loop[k] = 1;
    }
    const smoke = (i: number) => {
      const [a, b] = this.cargo[i]!.loop;
      return (a === 1 && b === 1) || (a === 1 && b === 9) || (a === 9 && b === 1);
    };
    // (the CIDS's two channels, on DC ESS and DC 2)
    for (const ch of [BUS.dcEss, BUS.dc2]) {
      if (num(P, ch) < 25) continue;
      if (smoke(0) || smoke(1)) setb(P, K.aftWarn, 1);
      if (smoke(2)) setb(P, K.fwdWarn, 1);
    }
  }

  // ---- the extinguishers
  private discharge(P: Props, b: Bottle) {
    if (num(P, b.elec) < 25) return;
    b.emptying = true;
    b.acc = 0.05;
  }

  /** a bottle emptying, 10 % each 0.05 s; empty: DISCH, and the fire out — or not */
  private empty(P: Props, b: Bottle, dt: number) {
    b.acc += dt;
    while (b.emptying && b.acc >= 0.05) {
      b.acc -= 0.05;
      b.store.q -= 10;
      if (b.store.q > 0) continue;
      b.emptying = false;
      P[b.light] = 1;
      const out = b.number === 0 ? 0.9 : b.number === 7 || b.number === 8 ? 0.95 : 0.999;
      if (this.rand() < out) {
        const cargo = b.number === 7 || b.number === 8;
        const warnOff = !cargo || this.rand() <= 0.2;
        this.clock.after(this.rand() * 3, () => {
          P[b.fail] = 0;
          // (the cargo's agent seen as smoke: its warning likely to stay)
          if (warnOff) P[b.warning] = 0;
        });
      }
    }
  }

  private startAgent(P: Props, i: number, s: number) {
    const a = this.agents[i]!;
    P[a.prop] = s;
    a.at = this.clock.t + s + 1;
    a.run = true;
  }

  private agentTimers(P: Props) {
    for (const a of this.agents) {
      if (!a.run) continue;
      if (num(P, a.prop) > 0) P[a.prop] = Math.trunc(a.at - this.clock.t);
      else {
        if (a.back99) P[a.prop] = 99;
        a.run = false;
      }
    }
  }

  // ---- the tests
  private powered(P: Props) {
    return num(P, BUS.dcBat) > 25 || num(P, BUS.dcEss) > 25;
  }

  private cargoTest(P: Props) {
    if (this.cargoStage === 0) return;
    if (!bool(P, K.cargoTest)) {
      this.cargoStage = 0;
      return;
    }
    if (this.clock.t <= this.cargoStageTime + 3) return;
    const next = () => {
      this.cargoStage++;
      this.cargoStageTime = this.clock.t;
    };
    const both = (v: number) => {
      P[K.aftWarn] = v;
      P[K.fwdWarn] = v;
    };
    switch (this.cargoStage) {
      case 1:
        if (this.powered(P)) {
          both(1);
          next();
        } else this.cargoStage = 0;
        break;
      case 2:
        both(0);
        setb(P, K.dischTest, 1);
        next();
        break;
      case 3:
        setb(P, K.dischTest, 0);
        if (this.powered(P)) {
          both(1);
          next();
        } else this.cargoStage = 0;
        break;
      case 4:
        both(0);
        this.cargoStage = 0;
        break;
    }
  }

  step(P: Props, dt: number) {
    this.clock.tick(dt);
    // (the agents' timers first: one started this frame counts from the next, as FlightGear's 0.1 s timers do)
    this.agentTimers(P);
    const L = this.L;
    // (the agents' buttons, with their fire buttons out)
    const agentBtn = [
      ["controls/engines/engine/agent1-btn", K.fireBtn[0]!],
      ["controls/engines/engine/agent2-btn", K.fireBtn[0]!],
      ["controls/engines/engine[1]/agent1-btn", K.fireBtn[1]!],
      ["controls/engines/engine[1]/agent2-btn", K.fireBtn[1]!],
      ["controls/apu/agent-btn", K.fireBtn[2]!],
    ] as const;
    agentBtn.forEach(([btn, fire], i) => {
      if (L.edge(P, btn) && num(P, btn) === 1 && num(P, fire) === 1) this.discharge(P, this.bottles[i]!);
    });
    if (L.edge(P, K.aftDisch) && num(P, K.aftDisch) === 1) this.discharge(P, this.cargoBottles[0]!);
    if (L.edge(P, K.fwdDisch) && num(P, K.fwdDisch) === 1) this.discharge(P, this.cargoBottles[1]!);
    // (the fire buttons out: AGENT 1's 10 s; AGENT 1 gone: AGENT 2's 30 s; the APU's stopped)
    if (L.edge(P, K.fireBtn[0]!) && num(P, K.fireBtn[0]!) === 1) this.startAgent(P, 0, 10);
    if (L.edge(P, K.fireBtn[1]!) && num(P, K.fireBtn[1]!) === 1) this.startAgent(P, 2, 10);
    if (L.edge(P, K.fireBtn[2]!) && num(P, K.fireBtn[2]!) === 1) {
      this.apu?.emergencyStop(P);
      this.startAgent(P, 4, 10);
    }
    if (L.edge(P, "systems/fire/engine1/disch1") && num(P, "systems/fire/engine1/disch1") === 1) this.startAgent(P, 1, 30);
    if (L.edge(P, "systems/fire/engine2/disch1") && num(P, "systems/fire/engine2/disch1") === 1) this.startAgent(P, 3, 30);
    // (the TEST buttons: the warning lit while held, with power; no test over a real fire)
    for (let s = 0; s < 3; s++) {
      if (!L.edge(P, K.test[s]!) || bool(P, FIRE[s]!)) continue;
      if (num(P, K.test[s]!) === 1) {
        if (this.powered(P)) setb(P, K.warn[s]!, 1);
      } else setb(P, K.warn[s]!, 0);
    }
    if (L.edge(P, K.cargoTest)) {
      const off =
        bool(P, "systems/failures/fire/aft-cargo-fire") ||
        bool(P, "systems/failures/fire/fwd-cargo-fire") ||
        num(P, BUS.dcBat) < 25 ||
        num(P, BUS.dcEss) < 25;
      if (!off) {
        if (bool(P, K.cargoTest)) {
          this.cargoStage = 1;
          this.cargoStageTime = this.clock.t;
        } else {
          assign(P, { [K.aftWarn]: 0, [K.fwdWarn]: 0, [K.dischTest]: 0, [K.cargoTestOff]: 1 });
          this.cargoStage = 0;
        }
      }
    }
    this.cargoTest(P);
    for (const b of [...this.bottles, ...this.cargoBottles]) if (b.emptying) this.empty(P, b, dt);
    for (const u of this.units) this.failTimers(P, u);
    // (the detection's turn, every 0.25 s)
    this.tick += dt;
    if (this.tick >= 0.25) {
      this.tick %= 0.25;
      for (const u of this.units) this.updateUnit(P, u);
      this.updateCargo(P);
    }
  }

  reset(P: Props, _s: StartState) {
    this.clock.clear();
    this.units = [0, 1, 2].map((s) => new DetectorUnit(s));
    this.cargo = [0, 1, 2].map(() => ({ loop: [0, 0] as [LoopState, LoopState] }));
    this.fill();
    for (const a of this.agents) a.run = false;
    this.cargoStage = 0;
    this.tick = 0;
    this.apuAutoDisch = false;
    const vals: Record<string, number> = {
      "controls/OH/protectors/fwddisch": 0,
      "controls/OH/protectors/aftdisch": 0,
      [K.fwdDisch]: 0,
      [K.aftDisch]: 0,
      [K.cargoTest]: 0,
      [K.cargoTestOff]: 0,
      [K.dischTest]: 0,
      [K.aftWarn]: 0,
      [K.fwdWarn]: 0,
      "controls/engines/engine/agent1-btn": 0,
      "controls/engines/engine/agent2-btn": 0,
      "controls/engines/engine[1]/agent1-btn": 0,
      "controls/engines/engine[1]/agent2-btn": 0,
      "controls/apu/agent-btn": 0,
      "systems/fire/cargo/disch": 0,
    };
    for (const f of Object.values(F)) vals[f] = 0;
    for (let s = 0; s < 3; s++) vals[K.test[s]!] = vals[K.warn[s]!] = vals[K.inop[s]!] = vals[K.fireBtn[s]!] = 0;
    for (const b of this.bottles) vals[b.light] = 0;
    for (const a of this.agents) vals[a.prop] = 99;
    assign(P, vals);
    this.L.prime(P, Object.keys(vals));
  }
}
