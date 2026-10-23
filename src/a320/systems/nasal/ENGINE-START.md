# The A320's engine start in FlightGear (for the FADEC's step)

What FlightGear's A320 family does to start an engine — Nasal/Systems/engines.nas, fadec-common.nas, fadec-cfm.nas and
Systems/a320-ignition.xml (the sequence itself is JSBSim's, not Nasal's). Paths as the systems' bag has them (no
leading "/", no "[0]"). Engine 1 shown; engine 2 is the same with `engine[1]`, `-2`, `ign-2`, `ac-2`, `tank[6]`.

## The pilot's controls

| control | property | values |
|---|---|---|
| ENG MODE selector | `controls/ignition/start-sw` | 0 CRANK, 1 NORM (FlightGear's init), 2 IGN/START |
| ENG 1 MASTER | `controls/engines/engine/cutoff-switch` | 1 OFF (cutoff), 0 ON |
| MAN START 1 (overhead) | `controls/engines/engine/start-switch` | 0 / 1 (ENGINES.init: 0) |

## Ignition (a320-ignition.xml, channel "Ignition")

- `systems/ignition/ign-1/ign-a` = 1 when ENG MODE = IGN/START and (`systems/electrical/sources/si-1/output-volt` ≥ 110
  or `systems/electrical/bus/ac-ess` ≥ 110) — the static inverter first.
- `systems/ignition/ign-1/ign-b` = 1 when ENG MODE = IGN/START and `systems/electrical/bus/ac-1` ≥ 110 (engine 2: `ac-2`).
- `systems/ignition/ign-1/ign-avail` = ign-a or ign-b.
- The igniters lit ("Ignition 2"): `systems/ignition/ign-1/igniter-a` / `igniter-b` — none without ign-avail; on in
  state 2 (the start); in state 3 (running) only airborne with IGN/START; the automatic start alternates them
  (`systems/acconfig/options/igniter-select-1`: 0 A, 1 B, … — engines.nas's updateIgniterSelect changes it at each
  start, when state becomes 1).

## The start (channel "Engine Start/Stop")

1. `systems/ignition/can-run-1` = the engine's feed tank (`propulsion/tank[5]/contents-lbs`) ≥ 1 lb.
2. `systems/ignition/cutoff-1` = 0 when MASTER 1 is ON and can-run-1, else 1.
3. `systems/ignition/can-start-1` = 0 if the bleed duct is under 20 psi (`systems/pneumatics/psi/engine-1-psi`), if
   N2 (`engines/engine/n2-actual`) ≥ the starter's cut-out (`systems/ignition/starter-cutoff-n2`: CFM 50 %, IAE 43 %),
   if no igniter (ign-avail ≠ 1), or if the MASTER went OFF while running (cutoff-1 = 1 and state ≥ 2); else 1.
4. **Automatic start** `systems/ignition/auto-start-1` = can-start-1 and cutoff-1 = 0 and MAN START off. (ENG MODE must
   be IGN/START for an igniter, hence for can-start.)
5. MAN START (`systems/ignition/start-switch-1`) is pushed back to 0 by the system once the start can't go on or the
   automatic start runs (written back to `controls/engines/engine/start-switch`).
6. **Starter valve**: `systems/ignition/start-valve-1-cmd` = auto-start-1 or start-switch-1; the valve
   (`systems/ignition/start-valve-1`) opens in 1 s, closes at once; `systems/ignition/starter-1` = valve open →
   `systems/pneumatics/valves/starter-valve-1` (the ECAM's START VALVE).
7. **Fuel on**: with the automatic start, the fuel waits for N2 ≥ `systems/ignition/starter-engage-n2` (CFM 16 %, IAE
   19 %) — `cutoff-delay-cmd-1` = starter-1 and N2 ≥ that, rate-limited (0.45 /s auto, 1 /s manual) into
   `cutoff-delay-1`; `systems/ignition/cutoff-jsb-1` (JSBSim's cutoff) stays 1 while the automatic start's delay is
   < 1, else follows cutoff-1. In a manual start the fuel comes with the MASTER.
8. The starter JSBSim sees (`systems/ignition/starter-jsb-1`) is held on past the cut-out N2 while cutoff-1 = 0 and
   fuel is there (JSBSim would kill an engine whose starter drops early); otherwise starter-1.
9. **The engine's state** `engines/engine/state` (`systems/ignition/state-1`): 3 RUN when fuelled and N2 ≥
   `options/ign-run-n2` (CFM 58 %, IAE 59 %, neo 68 %); 2 STARTING when fuelled with the starter; 1 CRANKING with the
   starter alone; 0 OFF.

## Around it (Nasal)

- fadec-cfm.nas: `systems/fadec/power-avail` once AC 1, AC 2 or AC ESS ≥ 110 V; `systems/fadec/powerup` for 5 min
  after (`systems/fadec/powered-time`); `systems/fadec/powered1` when N2 ≥ 3.5 %, or with power and ENG MODE IGN/START,
  or ground power (`controls/fadec/gnd-power-1`); `systems/fadec/eng1-off-power` for 5 min after MASTER 1 went OFF
  (`systems/fadec/eng1-master-time`); the ECAM's N1/N2/EGT/FF shown (`systems/fadec/eng1/n1`) when any of those.
- fuel.nas (ported, fuel.ts): state 3 → the centre tank's pumps on 2 min (`systems/fuel/ctr-pump-cmd-on-eng-start`);
  state 2 → `systems/fuel/offset-left` takes the fuel used so far.
- engines.nas: IGNITION.fastStart(n) (FlightGear's quick start) = MASTER ON and JSBSim's
  `fdm/jsbsim/propulsion/set-running` = n; fastStop(n) = MASTER OFF, N1 and N2 to 0.1 % 0.1 s later.
- Bleed for the starter: the APU's (`controls/pneumatics/switches/apu`), an engine's cross-bled, or ground air — the duct's
  pressure is a320-pneumatic.xml's (`systems/pneumatics/psi/engine-1-psi`).
- FlightGear's "ready to taxi" (acconfig.nas taxi_c/taxi_d): fastStart both, then the APU's MASTER and bleed off.
