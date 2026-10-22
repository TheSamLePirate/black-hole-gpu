// The A320's APU as FlightGear's Nasal runs it (docs/PLAN-A320.md, A10 — Nasal/Systems/APU.nas): the MASTER SW powering
// it up (the 3 minutes on the DC BAT bus, the fuel's LP valve opened, the air intake's flap opening in 12 s, the oil's
// level checked at 8 s), START (the starter once the flap is open and the oil checked, the fuel at 4.9 %, the starter
// off and AVAIL at 99.9 %), the stop (at once if it was starting; else a cooldown of 2 minutes after the bleed was last
// used), the automatic stops (the oil's pressure or temperature, the power lost, EMER ELEC without the generator), the
// emergency stop (its fire button, a fire on the ground). FlightGear's APU turns in JSBSim (engine[2], its N1): here
// it turns in this module — the starter spinning it to the light-off, then its own acceleration (A/C manuals: AVAIL
// about a minute after the MASTER SW) and its run down once the fuel is cut (spool, on by default). Pure.

import type { Props } from "../../rig";
import type { NasalModule, StartState } from "../types";
import { assign, bool, Clock, Door, Listen, num, setb } from "./util";

const K = {
  master: "controls/apu/master",
  fire: "controls/apu/fire-btn",
  bleed: "controls/pneumatics/switches/apu",
  oilLevel: "systems/apu/oil/level-l",
  oilPsi: "systems/apu/oil/oil-pressure-psi",
  oilTemp: "systems/apu/oil/oil-temperature-degC",
  threeMin: "systems/apu/dc-bat-three-minutes",
  fuelCmd: "systems/fuel/valves/apu-lp-valve-cmd",
  fuelPos: "systems/fuel/valves/apu-lp-valve",
  flap: "controls/apu/inlet-flap/position-norm",
  starter: "controls/engines/engine[2]/starter",
  cutoff: "controls/engines/engine[2]/cutoff",
  rpm: "engines/engine[2]/n1",
  start: "systems/apu/start",
  avail: "systems/apu/available",
  fault: "systems/apu/fault",
  powerLoss: "systems/apu/shutdown-power-loss",
  dcBat: "systems/electrical/bus/dc-bat",
  emerElec: "systems/electrical/some-electric-thingie/emer-elec-config",
  emerElec45: "systems/electrical/some-electric-thingie/emer-elec-config-45",
  emerGen: "systems/electrical/relay/emer-glc/output",
  autoconfig: "systems/acconfig/autoconfig-running",
  /** (not FlightGear's: the state machine's, for the displays and the tests) */
  state: "systems/apu/state",
} as const;

/** the APU's states (APU.nas): off, power up, watch, starting preparation, starting, run, cooldown, shutdown */
export const APU_STATE = ["OFF", "POWER UP", "WATCH", "START PREP", "STARTING", "RUN", "COOLDOWN", "SHUTDOWN"] as const;

export class Apu implements NasalModule {
  readonly name = "APU";
  state = 0;
  private clock = new Clock();
  private L = new Listen();
  private inlet = new Door(K.flap, 12);
  private listenSignals = false;
  private listenStopSignal = false;
  private bleedTime = 0;
  private cooldownEndTime = 0;
  private fastStart = false;
  private inhibitEMERELEC = false;
  private lowOilLevel = false;
  private oilTestComplete = false;
  private bleedWasUsed = false;
  private autoshutdown = false;
  private masterTime = 0;
  // (FlightGear's maketimers: running or not)
  private tCheckStart = false;
  private tStart = false;
  private tStart2 = false;
  private tCooldown = false;
  private tShutdown = false;
  private tThreeMin = false;

  /** spool: this module turns the APU (engine[2]'s N1) — false when something else does */
  constructor(readonly spool = true) {}

  private resetStuff(P: Props) {
    this.state = 0;
    this.lowOilLevel = false;
    this.listenSignals = false;
    this.listenStopSignal = false;
    this.bleedTime = 0;
    this.cooldownEndTime = 0;
    this.oilTestComplete = false;
    this.bleedWasUsed = false;
    P[K.fault] = 0;
    this.autoshutdown = false;
    this.inhibitEMERELEC = false;
    this.tCheckStart = this.tStart = this.tStart2 = this.tShutdown = this.tCooldown = false;
  }

  private checkOil(P: Props) {
    this.lowOilLevel = num(P, K.oilLevel, 5.4) < 3.69;
    this.oilTestComplete = true;
  }

  powerOn(P: Props) {
    this.resetStuff(P);
    if (num(P, K.dcBat) < 25) {
      this.clock.after(0.2, () => {
        if (num(P, K.dcBat) >= 25) return;
        this.resetStuff(P);
        // (APU.nas lets its 3 s and 8 s timers run on: unpowered, nothing of the APU's wakes)
        this.clock.cancel("power");
      });
    }
    this.state = 1;
    P[K.fuelCmd] = 1;
    this.inlet.open();
    this.listenSignals = true;
    this.clock.after(
      3,
      () => {
        if (bool(P, K.master) && !bool(P, K.autoconfig)) this.state = 2;
      },
      "power",
    );
    this.clock.after(8, () => this.checkOil(P), "power");
  }

  startCommand(P: Props, fast = false) {
    if (this.listenSignals && (this.state === 1 || this.state === 2)) {
      setb(P, K.start, 1);
      this.state = 3;
      this.tCheckStart = true;
      this.fastStart = fast;
    }
  }

  private fuelValve(P: Props) {
    // (the valve's position is a320-fuel.xml's; without it, its command)
    return P[K.fuelPos] !== undefined ? bool(P, K.fuelPos) : bool(P, K.fuelCmd);
  }

  private checkApuStart(P: Props) {
    if (this.fastStart) this.inlet.setpos(P, 1);
    if (
      num(P, K.rpm) < 7 &&
      this.fuelValve(P) &&
      num(P, K.flap) === 1 &&
      this.oilTestComplete &&
      !this.lowOilLevel &&
      !this.inhibitEMERELEC
    ) {
      this.state = 4;
      this.listenStopSignal = true;
      this.tCheckStart = false;
      P[K.starter] = 1;
      this.tStart = true;
    }
  }

  private waitStart(P: Props) {
    if (num(P, K.rpm) >= 4.9 || this.fastStart) {
      P[K.cutoff] = 0;
      if (this.fastStart) P[K.rpm] = 100;
      this.tStart = false;
      this.tStart2 = true;
    }
  }

  private waitStart2(P: Props) {
    if (num(P, K.rpm) >= 99.9) {
      P[K.starter] = 0;
      setb(P, K.start, 0);
      P[K.avail] = 1;
      this.state = 5;
      this.tStart2 = false;
    }
  }

  private cooldown(P: Props) {
    if (bool(P, K.master)) {
      this.tCooldown = false;
      this.state = 5;
      return;
    }
    if (this.clock.t >= this.cooldownEndTime) {
      this.tCooldown = false;
      this.stopAPU(P);
      this.state = 7;
      this.tShutdown = true;
    }
  }

  private shutdown(P: Props) {
    if (!this.autoshutdown && bool(P, K.master)) {
      this.powerOn(P);
      return;
    }
    P[K.cutoff] = 1;
    P[K.starter] = 0;
    if (!this.autoshutdown && num(P, K.rpm) < 95 && bool(P, K.avail)) P[K.avail] = 0;
    if (this.autoshutdown && (bool(P, K.avail) || !bool(P, K.fault))) {
      P[K.avail] = 0;
      P[K.fault] = 1;
    }
    if (num(P, K.rpm) < 7 && !bool(P, K.master)) {
      this.inlet.close();
      P[K.fuelCmd] = 0;
      this.state = 0;
      this.resetStuff(P);
      this.tShutdown = false;
    }
  }

  stop(P: Props) {
    if (this.listenStopSignal && this.state === 4) {
      setb(P, K.start, 0);
      this.stopAPU(P);
      this.state = 7;
      this.tShutdown = true;
      return;
    }
    if (bool(P, K.start)) setb(P, K.start, 0);
    if (this.bleedWasUsed) {
      if (this.bleedTime === 0) this.shutBleed(P);
      if (120 - (this.clock.t - this.bleedTime) > 0) {
        this.cooldownEndTime = this.bleedTime + 120;
        this.state = 6;
        this.tCooldown = true;
      } else {
        this.stopAPU(P);
        this.state = 7;
        this.tShutdown = true;
      }
    } else {
      this.stopAPU(P);
      this.state = 7;
      this.tShutdown = true;
    }
  }

  autoStop(P: Props) {
    this.tCheckStart = false;
    if (this.state >= 4) {
      this.tStart = this.tStart2 = this.tCooldown = false;
      this.stopAPU(P);
      this.state = 7;
      this.tShutdown = true;
    } else {
      this.inlet.close();
      P[K.fuelCmd] = 0;
      this.state = 0;
    }
    this.autoshutdown = true;
    P[K.fault] = 1;
  }

  emergencyStop(P: Props) {
    if (this.listenSignals && this.state < 4) {
      this.tCheckStart = false;
      this.inlet.close();
      P[K.fuelCmd] = 0;
      this.autoshutdown = true;
      P[K.fault] = 1;
      this.state = 0;
    } else if (this.state >= 4) {
      P[K.fuelCmd] = 0;
      this.autoStop(P);
    }
  }

  private stopAPU(P: Props) {
    P[K.cutoff] = 1;
  }

  private shutBleed(P: Props) {
    P[K.bleed] = 0;
    this.bleedTime = this.clock.t;
  }

  /** The APU turning (engine[2]'s N1 [%]): the starter alone to the light-off, its own acceleration with the fuel
   *  (slower at first, then towards 100 % — about 45 s from the starter to AVAIL), its run down without. */
  private turn(P: Props, dt: number) {
    let r = num(P, K.rpm);
    const starter = bool(P, K.starter);
    const lit = !bool(P, K.cutoff) && this.fuelValve(P) && r >= 4.5 && (starter || r >= 50);
    if (lit) r = Math.min(100, r + Math.min(0.8 + 0.05 * r, (100.4 - r) / 3) * dt);
    else if (starter) r = Math.min(20, r + 2 * dt);
    else r = Math.max(0, r - Math.max(r / 8, 0.5) * dt);
    P[K.rpm] = r;
  }

  step(P: Props, dt: number) {
    this.clock.tick(dt);
    if (this.spool) this.turn(P, dt);
    this.inlet.step(P, dt);
    // (the listeners)
    if (this.L.edge(P, K.powerLoss) && bool(P, K.powerLoss)) {
      if (bool(P, K.starter)) P[K.starter] = 0;
      if (this.state !== 0) this.autoStop(P);
    }
    if (this.L.edge(P, K.master)) {
      if (bool(P, K.master) && this.state === 0) {
        this.tShutdown = false;
        P[K.threeMin] = 1;
        this.tThreeMin = true;
        this.masterTime = this.clock.t;
        this.powerOn(P);
      } else if (!bool(P, K.master)) this.stop(P);
    }
    if (this.L.edge(P, K.bleed)) {
      if (bool(P, K.bleed)) this.bleedWasUsed = true;
      else this.bleedTime = this.clock.t;
    }
    // (the timers)
    if (this.tThreeMin && (!bool(P, K.master) || this.clock.t >= this.masterTime + 180)) {
      P[K.threeMin] = 0;
      this.tThreeMin = false;
    }
    if (this.tCheckStart) this.checkApuStart(P);
    if (this.tStart) this.waitStart(P);
    if (this.tStart2) this.waitStart2(P);
    if (this.tCooldown) this.cooldown(P);
    if (this.tShutdown) this.shutdown(P);
    // (update: the oil — a320-apu.xml's figures, when they are there —, EMER ELEC)
    const psi = P[K.oilPsi] !== undefined ? num(P, K.oilPsi) : null;
    const degC = P[K.oilTemp] !== undefined ? num(P, K.oilTemp) : null;
    if ((this.state === 5 && psi !== null && psi < 35) || (degC !== null && degC > 135)) this.autoStop(P);
    this.inhibitEMERELEC = num(P, K.emerElec) === 1 && num(P, K.emerElec45) !== 1 && num(P, K.emerGen) < 110;
    P[K.state] = this.state;
  }

  call(fn: string, args: (number | string)[], P: Props): boolean {
    switch (fn) {
      case "systems.APUController.APU.startCommand":
        this.startCommand(P, args[0] === 1);
        return true;
      case "systems.APUController.APU.powerOn":
        this.powerOn(P);
        return true;
      case "systems.APUController.APU.emergencyStop":
        this.emergencyStop(P);
        return true;
    }
    return false;
  }

  reset(P: Props, s: StartState) {
    this.clock.clear();
    this.resetStuff(P);
    this.tThreeMin = false;
    const on = s === "apu";
    assign(P, {
      [K.master]: on ? 1 : 0,
      [K.start]: 0,
      [K.avail]: on ? 1 : 0,
      [K.fault]: 0,
      [K.threeMin]: 0,
      // (the valve's position: a320-fuel.xml's, from its command)
      [K.fuelCmd]: on ? 1 : 0,
      [K.starter]: 0,
      [K.cutoff]: on ? 0 : 1,
      [K.rpm]: on ? 100 : 0,
      [K.bleed]: on ? 1 : 0,
    });
    if (P[K.oilLevel] === undefined) P[K.oilLevel] = 5.4;
    this.inlet.setpos(P, on ? 1 : 0);
    if (on) {
      // (as FlightGear's "before start": powered up, started fast, its bleed on)
      this.state = 5;
      this.listenSignals = this.listenStopSignal = this.oilTestComplete = this.bleedWasUsed = true;
    }
    P[K.state] = this.state;
    this.L.prime(P, [K.master, K.bleed, K.powerLoss]);
  }
}
