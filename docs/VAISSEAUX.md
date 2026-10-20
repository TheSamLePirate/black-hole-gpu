# The spacecraft — Ranger, Lander, Endurance

*[Version française](VAISSEAUX.fr.md)* — *up to date on 2026-10-20*

Three spacecraft brought to the F-35's level, solo or in a room: the **Ranger** (the agile spaceplane), the
**Lander** (the heavy powered-descent crane) and the **Endurance** (the slow mothership with its turning ring), on
both sides of the wormhole. Four assistance levels and a recovery key, automatic protections, station keeping, a
full ISS-style rendezvous, a landing point designator, an editable mission plan, consumables and failures with
their checklists, a HUD for each craft, an eleven-sector wheel, a pad and HOTAS layout, three cockpits, a voice
per craft, phase reports out of 20, a space school of fifteen lessons, seven challenges, a mission library and the
Interstellar campaign — and the whole of it played together: the room's fleet, orders, sharing, a copilot aboard,
the controls handed over, room challenges and co-op missions with roles.

- The plan: [PLAN-VAISSEAUX-AAA.md](PLAN-VAISSEAUX-AAA.md) — the flight (X0–X5), the crew console (K1–K7), the
  immersion (X6–X8), school, challenges and missions (X9–X11), the network (N1–N6).
- The progress sheets: [`docs/progress/vaisseaux/`](progress/vaisseaux/) (one per step, in French, with their
  pictures and measurements).
- What TARS knows of it: the knowledge base [`docs/spatial/en/`](spatial/en/orbits.md) (six pages:
  [orbits](spatial/en/orbits.md), [manoeuvres](spatial/en/maneuvers.md),
  [rendezvous and docking](spatial/en/rendezvous-docking.md), [entry and landing](spatial/en/entry-landing.md),
  [systems and emergencies](spatial/en/systems-emergencies.md), [relativity](spatial/en/relativity.md)).
- Playing together: [NETWORK.md](NETWORK.md); the crew console: [CREW.md](CREW.md); the HUD:
  [HUD.md](HUD.md); controllers and HOTAS: [HOTAS.md](HOTAS.md); the cockpits: [COCKPIT.md](COCKPIT.md); the
  fighter: [F35.md](F35.md).

Units are metric by default (m, m/s, km, t, kWh), imperial as an option (Settings › Game › HUD aids › Units); the
figures below are the game's own measurements.

## The three craft

| | Ranger | Lander | Endurance |
|---|---|---|---|
| Mass | 40 t | 160 t | 900 t |
| Engines | 2, wings, wheeled gear, heat shield | 6 in two pods, skids | 4, the ring (the whole craft turns) |
| Load limit | 9 g | 6 g | 1.5 g |
| Battery | 60 kWh | 120 kWh | 2 MWh |
| Lands · flies in air | yes · yes (a plane in the air, F) | yes · no | no (refused, explained) · no |
| Its HUD panel | the shared HUD (Atmosphere, Space, Approach) | DESCENT | the mothership's, titled ENDURANCE |
| Its voice | the reference, lively | heavy and low (engine ×0.72) | deep and slow (engine ×0.48) |

The Endurance's tanks hold 22 Rangers' worth of propellant (it weighs 22 Rangers); its crew is twelve, the
Ranger's four (40 kg of oxygen: 11.9 days).

## Getting in

- **K** (or the wheel off flight, Tab held › **Fly**) flies the Ranger; **[ · ]** (^ · $ on a French AZERTY)
  switch to the Lander and the Endurance — the craft left coast on, turning as they were. Near Gargantua, [ ] go
  only to a craft docked to the one flown or within 10 km.
- **Place the ship** (the wheel off flight): an orbit, a ground, a site — the place panel.
- **The scenes** (the gallery's presets) set a craft in its situation: *Earth: docking to the ISS*, *Earth: the
  Endurance, 800 km up*, *Earth: the Lander, 500 km up*, *Earth: the Endurance tumbling, 300 km up*,
  *Gargantua: the Ranger by the Endurance* (150 m off its fore port, 0.24 c about the hole) and *Mann: the
  tumbling Endurance* (the film's docking, 3 rpm).
- **The space school, the challenges and the missions**: Tab held › **School & challenges** (in a spacecraft
  the space school comes first, the flight school after).
- The F-35 has its own page: [F35.md](F35.md).

## Assistance and recovery (Settings › Game › Spacecraft)

- **Assistance**:
  - **Manual**: no SAS — the stick spins the craft faster and faster, a turn kept until stopped by hand;
  - **Realistic** (the default): the SAS as the pilot sets it (T);
  - **Assisted**: the SAS always on; within 1 km of a craft or the station, the RCS let go holds the drift
    against it at nothing (measured: 0.30 m/s of drift 150 m off the Endurance → 0.002 m/s in 20 s);
  - **Beginner**: the same within 2 km, at half the turning rates, never a failure.
  The HUD's SAS chip says the level (`SAS`, `MANUAL`, `SAS · ASSISTED`, `SAS · BEGINNER`, `SAS · DRIFT HELD`,
  `RCS TRANSL.`); T explains when the level imposes the SAS.
- **⇧X — Recover**, at every level: over a ground within 3 km, a **hover** at once; otherwise holds and
  autopilots off, the engine cut, the **turn stopped**, then **prograde held** in orbit (near a craft: the
  attitude kept, the drift nulled). The stick taken back cancels it. Measured: the Ranger tumbling at 18°/s 100 km
  over the Moon, stable and prograde in 0.6 s; the Lander falling 1.5 km over Tranquility, hovering, drift under
  2 m/s after 25 s. A Ranger flown as a plane gets the F-35's recovery (wings level, a gentle climb).
- **Automatic protections** (on by default), **Failures** (off · rare, about one in 20 h · realistic, one in 3 h
  · hard, one in 1.5 h; seeded), **Consumables**, **Infinite propellant**. The Ranger's handling (turn rate…) is
  in its own group.

## Keys (QWERTY names — the physical keys: AZERTY's in brackets)

| Keys | What |
|---|---|
| W S · A D · Q E (Z S · Q D · A E) | Pitch · yaw · roll |
| Shift · Alt (or ↑ ↓) | Throttle up · down (held) |
| Z · X (W · X) | Full throttle (on the entry's approach: go around) · cut |
| ⇧X | Recover: the turn stopped; over a ground a hover, in orbit prograde held |
| T · R · Caps Lock | SAS · roll alignment (wings in the orbital plane) · precision controls |
| 1 – 7 | Hold prograde · retrograde · radial out · radial in · normal · anti-normal · to the target |
| I K · J L · H N | RCS translation: down/up · left/right · forward/back |
| 8 · ⇧8 | Hover (hold position) · **station keeping** (docked: undock, back off 30 m, hold) |
| 9 · ⇧9 | Circularize · **RCS mode**: rotation ⟷ translation (then W S up · down, A D left · right, ⇧ Alt forward · back; Q E still roll) |
| 0 · ⇧0 | Approach · orbit the target |
| B | **Rendezvous & docking**: within 3 km the docking autopilot; beyond, the whole rendezvous planned, flown, then docked |
| F7 · U · ⇧G | Descent & landing (W S · A D re-designate the point: the LPD) · take off to orbit · entry & landing (Ranger) |
| O · ⇧O | The flight computer's MISSION tab · the **mission plan** |
| ⇧F4 | The autopilot flies, or assists (you fly, its director on the HUD) |
| ⇧[ · ⇧] | The Endurance's ring: a revolution a minute lower · higher |
| [ · ] | The craft flown: Ranger, Lander, Endurance |
| F · G · P · ⇧P | Ranger in the air: rocket ⟷ plane · gear · flaps · air brake |
| ⇧K | Disembark / board a landed craft; docked to another player's in orbit: go aboard (N3) |
| Tab (tap) · Tab (held) | Next target · the craft's wheel (below) |
| Enter · ⌫ | Acknowledge the master caution · release the controls (mission, hold, autopilot) |
| M · ⇧M · ⇧Y | 3D map · settings · the future path in the view |
| ² (`) · ⇧² | HUD density · HUD kind (automatic, Atmosphere, Space, Approach) |
| V · ⇧R | Next view · camera reset |
| F6 | TARS (tap: write · hold: speak) |

The digits go by position (the top row's keys on AZERTY). Every key can be rebound (pause › Controls); the help
sheet (?) lists them as *Flying a spacecraft (K)*.

### The wheel (Tab held)

`ui/spacewheel.ts`, built at each opening from the craft and its state — eleven sectors, each craft its own:

- **SAS** (T).
- **Holds ›** the nine (the seven above, away from the target, the manoeuvre node) and manual.
- **Autopilots ›** circularize, execute the node, transfer, approach, orbit the target, rendezvous & docking (B),
  station keeping (⇧8); hover, descent & landing, take-off to orbit for a craft that lands; entry for the Ranger.
- **Flight computer ›** ORBIT, TARGET, LAND (a craft that lands), MISSION, the mission plan (⇧O), execute.
- **Systems ›** RCS mode, the Systems page (with its failures' count), acknowledge, stop the tumble, gear, the
  Ranger's navigation and landing lights, the Endurance's **ring ±**.
- **Docking ›** dock or station keeping; docked: undock, refuel, undock and hold 30 m off; next target.
- **Fleet ›** the craft one can fly; in a room the room's fleet and the three orders to the pilot targeted.
- **Navigation ›** map, place, next target — the aircraft's entries (flight plan, mission map, ILS, prepare a
  flight) only while the Ranger flies as a plane.
- **School & challenges ›** flight school, missions, challenges. **Camera ›** next view, photo, replay, trailer.
- **Craft ›** assistance (the four levels), flight mode (Ranger), next HUD, fine controls.

### On a controller and a HOTAS

`input/spacepad.ts`, on the standard mapping (a profile of the player's own keeps the lead):

| Control | What |
|---|---|
| Left stick | Pitch · yaw — in RCS translation: up · down · left · right |
| Right stick | Look about — the wheel open: aims its sectors |
| RT · LT | Throttle up · down — in translation: forward · back |
| LB · RB · L3 | Roll left · right · RCS mode |
| A | SAS — the wheel open: do the sector |
| B | Tap: acknowledge · hold: stop the tumble — the wheel open: back |
| X | Tap: dock (the rendezvous beyond 3 km) · hold: station keeping |
| Y | Tap: next target · hold: the wheel (let go: does the sector) |
| D-pad | Prograde · retrograde · to the target · radial and normal in turn |
| View · Menu | Tap: next view — hold: the map · tap: the pause — hold: the mission plan |

A HOTAS: **6-DOF spacecraft profile** in the Controllers screen — on a standard pad the docking layout (right
stick the attitude, left stick the translations, triggers forward and back); on a throttle its rocker translates
forward and back instead of the pedals, the mini-stick the sideways ones ([HOTAS.md](HOTAS.md)).

## The autopilots

- **Station keeping** (⇧8, `controller/stationkeep.ts`): held where it is against the station or a craft within
  5 km (one's own or another player's), on the RCS alone, the attitude left to the SAS. The point is held in the
  target's own frame — the ISS's orbital frame (LVLH: a point on its R-bar or V-bar); a target turning faster than
  0.2°/s (the tumbling Endurance) its orbital frame —, rejoined at 1 m/s at most, braked at 0.02 m/s²; the time
  warp limited to ×10. Docked, ⇧8 undocks, backs off 30 m and holds. Measured: 150 m off the Endurance drifting
  at 0.30 m/s → 0.04 m from the point and 0.005 m/s after 240 s. The HUD's **KEEP** button and its card
  (the offset, the drift, the frame).
- **Rendezvous and docking** (B, `docking-guidance.ts`): a target beyond 3 km — the station or a craft — and the
  whole rendezvous is planned and flown (its burns executed), then the docking follows. The approach holds at
  Dragon's waypoints: **Waypoint 1 at 220 m** (30 s, "go for approach"), **Waypoint 2 at 20 m** (20 s, "go for
  capture"), each only if the approach began beyond it, then the aligned hold at 10 m and the capture. The docking
  card names the zone: outside, in the **approach ellipsoid** (4 × 2 × 2 km in the target's orbital frame), in the
  **keep-out sphere** (200 m); the closing profile carries WP1 and WP2. Measured: from the Lander 500 km up to the
  Endurance at 800 km, "200 m off its rear port · departure in 15.1 h, 735 min of flight · Δv 636.9 m/s", four
  burns, the last one docking; in the game, held at Waypoint 1 at 220.2 m, 0.00 m/s.
- **The landing point designator** (LPD, `X1d`): during the automatic landing (F7) towards a site or the point
  under the craft, the stick re-designates the point — W S fore · aft, A D (or the translation keys) left ·
  right —, the attitude still the autopilot's. The point slides at 5 % of the height a second (5 m/s at least),
  never farther from its first place than the height (250 m at least), below 5 km. On the HUD a cross in a circle
  on the ground, "LPD 2.8 km", green while the autopilot's, amber once moved. Measured: moved 298 m forward, landed
  0.0 m from it at 0.8 m/s. The hoverslam is an aid, not an autopilot: the vertical descent's graph and the stop
  burn's countdown.
- **The mission plan** (⇧O, `ui/missionplan.ts`, `game/missiontimeline.ts`): in a spacecraft in space, in our
  solar system (a craft flown as a plane in the air keeps the flight plan; near Gargantua, the flight computer's
  burns, O). The **timeline**: each burn (its role — departure,
  correction, capture, arrival —, when, its Δv, its length at full thrust), each sphere of influence entered, an
  impact, and what the autopilot does at the end ("then the docking autopilot", "then a circular orbit"); the
  next burn highlighted, refreshed every 0.7 s. The **budget**: Δv planned, Δv in the tanks, the margin (red when
  short), a gauge. **Execute**, **Clear**, the flight computer (O) to plan. A rendezvous plan over 10 km/s is
  refused with its reason (the ISS's orbit is known only near today's date). Measured: a lunar transfer from low
  orbit, departure 3 089 m/s (2 min 38 s), capture 804 m/s (41 s), 3 893 m/s planned.
- **The others**: hover (8), circularize (9), approach (0), orbit the target (⇧0), execute the node, transfer,
  take off to orbit (U), descent & landing (F7), entry (⇧G, the Ranger: the deorbit for a site chosen in the LAND
  tab, the guided entry, the glide and the landing). ⇧F4 flies any of them or leaves you its director.
- **The ascent and inclination**: every place measures inclination against the **pole of date** (it used
  J2000): from Tranquility to a 1° orbit, 1.00°, and the HUD says so. An ascent costs +19 % over the impulsive
  minimum on the Moon (2 040–2 051 m/s for 1 722) and +27–30 % on Earth (gravity losses alone ~15 % at the
  Ranger's thrust-to-weight).

## The protections (`game/spaceguard.ts`)

The spacecraft's Auto-GCAS and Auto-ACAS:

- **The ground**: coming down on the engines faster than they can still stop above it (90 % of the thrust, 2 s to
  turn and spool, 20 m of margin; only past 80 % of the crash speed) — an **amber caution** first ("SINK RATE · 105
  M/S · STOP 600 M"), then the **hover** engaged by itself, a **red alarm** while it tames the descent. Measured:
  the Lander dropped from 2.5 km over Tranquility, hovering at 507 m from 80 m/s, 505 m and 1.6 m/s 30 s later
  (in Manual: "the gear collapsed at 90 m/s").
- **The keep-out sphere** (200 m about the station or a craft): closing faster than its limit — 0.05 m/s + 0.5 %
  of the range (1 m/s at its edge, 0.1 m/s at 10 m) — a caution at 1.5×, **station keeping** engaged at 2×
  (measured: the Ranger thrown at 2 m/s at the Endurance from 150 m, stopped at 148 m).
- **The docking corridor is exempt** (N2): a slow approach (≤ 0.5 m/s) on a port's axis (off by less than 15 % of
  the range), the ports facing (< 15°), is never taken over — the guard used to grab a docking.
- **Armed** in the Assisted and Beginner levels, in Realistic with *Automatic protections*; **never in Manual**
  (caution only); never under an autopilot, docked or landed; not for a craft flying on its wings (its GPWS).
  Each alarm has its *why* and *what to do* on the HUD; the stick or ⇧X take back the controls.

## The Endurance, mothership

- **The ring** (⇧[ · ⇧], `controller/ring.ts`): the whole craft turns about its axis for weight in its ring's
  modules (ω²r at 30 m). The rate asked goes from 0 to 10 rpm a revolution at a time; its thrusters take it
  there slowly (0.01 rad/s²: 5 rpm in about 50 s) and hold it; 0 stops it and gives the roll back to the stick.
  HUD: "RING 2.4 RPM → 5 · 0.20 G", then "RING 5.0 RPM · 0.84 G"; amber past 7 rpm. 1 g is 5.5 rpm. To dock at the
  hub, match its turn.
- **Refuelling** (`controller/refuel.ts`): each craft has its propellant. Docked to a craft of the fleet, the
  docking panel shows each one's tanks and **REFUEL · 12 %**: the flown craft's tank filled from the Endurance
  (else from the fullest), never more than one has nor than the other holds, the mass conserved. Measured: 33.4 t
  moved, the Endurance at 96 %. The Lander's release from the Endurance: fly the Lander, UNDOCK.
- **Both sides of the wormhole** (`controller/holeendurance.ts`): by Gargantua the Endurance is a real
  mothership — its orbit the scene's, in Gargantua's equatorial plane where its circle is a Kerr geodesic (a craft
  beside it stays beside it: 0.85 m in 60 s); its true model (64 m) drawn within 60 km; docked to like the
  station, held at its port as the orbit carries both; **B** docks there too (from 150 m: docked at 0.09 m/s in
  266 s). A craft left there follows its own geodesic; [ ] fly the Endurance itself; undocked pieces leave on
  their geodesics, no capture for 5 s. **The crossing docked**: the Endurance with the Ranger at its hub goes from
  the Earth to Gargantua and back, the assembly kept.
- **Mann, tumbling** (*Mann: the tumbling Endurance*): the Endurance on Mann's orbit turning at **3 rpm** about its
  hub's axis; B flies the target's turn ahead and steers the centre's velocity minus ω × r — from 18°/s of
  mismatch, the turn matched (0.00°/s in the last 12 m), docked at 0.09 m/s in 265 s. (The film's ~67 rpm is
  beyond the Ranger's turning rate.)

## Systems, consumables, failures, checklists

`game/systems.ts` (pure), `controller/systems.ts`, the tablet's **Systems** page (M):

- **Power**: a battery fed by its generators (fuel cells, panels, reactor) and drawn by the systems, the thrusters
  and the reaction wheels by their effort; **flat**, no RCS and no wheels until it is back at 5 %.
- **Oxygen**: 0.84 kg a person a day (NASA's figure), the days left shown; the **CO₂ scrubbers** and their life.
- **Failures** (seeded: the same flight, the same failures): **main engine out** (the relight fails one time in
  three: half thrust then), **RCS thruster stuck open** (the craft drifts; isolating the block takes a quarter of
  the RCS), **inertial platform drift**, **main bus short** (three times the draw), **cabin oxygen leak** (empty in
  about 6 h), **scrubber failure**.
- **Alarms**: each failure lights its alarm on the HUD (a red warning, then an amber caution during the repair)
  with **WHY / WHAT TO DO** — its checklist's steps; also battery low, oxygen low, scrubbers spent.
- **Checklists**: a failure's on the Systems page — each step ticked, then its action ("ISOLATE THE BLOCK",
  "RELIGHT THE ENGINE"…) enabled, the repair a few seconds; the **normal** ones (pre-launch, orbit insertion,
  rendezvous and docking, deorbit and entry, powered landing). The ticks are shared with the cockpit's CKL page and
  the crew console (`camera.sysTicks`).
- Off: *Consumables* off, *Failures* off.

## The HUDs

Each craft its panel (`VESSELS.*.space.panel`, `ui/hud/symbology.ts drawCraftPanel`), placed by the HUD's layout
(left, under the top cards) — details in [HUD.md](HUD.md):

- **Lander — DESCENT** (the Apollo LM's): H, the vertical speed, the forward · lateral speeds over the ground, the
  **hover seconds** left (the tank's Δv over the local gravity: green, amber under 60 s, red under 30 s), the
  propellant; the calls **"Sixty seconds"** and **"Thirty seconds — land or abort"**. Below 15 km, not landed.
- **Endurance — the mothership** (titled ENDURANCE): the ring (rpm, g), **each port** (free, or the craft
  docked), the assembly's mass, each docked craft's propellant.
- **COAS**, the last 60 m of a docking: a cross on the craft's port axis, the target port a circle — green within
  1°, amber within 5° (in the hatch camera's view).
- Over an airless world the HUD is Space, and Approach below 5 km (no more "ATMOSPHERE HUD" over the Moon).
- The docking card by Gargantua has its lines (range, axis · across, closing, ports' axes, rotation); the ports
  named (fore · aft hub, rear · dorsal hatch).
- The alerts of the protections, the ring and the failures, the LPD's marker, the station keeping's card, the
  proximity warning of a room (below).

## The cockpits

- **Ranger** (`ui/cockpitscreens.ts`): **touch screens** like the F-35's PCD — a touch on a page's button acts —,
  the tabs in 2 × 6: PFD, ORB, NAV, SYS (its SAS · RCS TR · PRO · RETRO buttons), DCK, PLN, CLK, LOG, APP, LDG,
  **CKL** (the current failure's checklist, a button per step, then the action; without a failure the normal
  checklists, NEXT CHECKLIST) and **ECS** (battery, oxygen, scrubbers, balance, crew, failures). Two physical
  buttons on panel C: **RCS TRANS** (lit amber) and **MASTER** (blinking red while a failure runs; a press
  acknowledges). The night lighting covers the new pages.
- **Lander and Endurance**: the film's shared cabin (*endurance lander cockpit*) set at each craft's own offset
  (`VESSELS.*.cabin.offset`) — behind the Lander's nose windows, in the Endurance's hub command module —, its
  screens showing the craft flown (the Lander's descent, the Endurance with its docked Ranger).

## Sound, shake, replay

- **A voice per craft** (`VESSELS.*.sound`): the Lander's engine ×0.72 in pitch, its RCS ×0.8, its structure's
  rumble lower; the Endurance an octave down (×0.48), its RCS a rumble (×0.6), its structure groaning.
- **Shake for all three** (`camshake.ts`): the rocket's thrust through the structure (stronger for a heavy craft),
  the entry's plasma, the Endurance's ring changing rate, the touchdown's blow by its sink rate (once a contact).
- **The replay's space moments**: the docking capture and a burn's start, chosen by the trailer ("Docking",
  "Engine burn").
- In a room, the others' engines are heard (below).

## Telemetry and phase reports

- **The craft's channels** in the flight recorder (the tablet's TELEMETRY page, CSV, TARS's charts): Δv left, the
  plan's Δv, battery, oxygen, docking range and speed, the Earth's time ahead of the craft's.
- **Reports out of 20 at each phase's end** (`game/report.ts`, `controller/phasereports.ts`): **ascent** (the
  efficiency: the least Δv over the Δv spent, 20/20 from 85 %), **insertion** (the orbit's precision against the
  launch target or the apsis aimed), **rendezvous** (Δv spent against the plan's, the time), **entry** (the
  corridor — peak load and heat flux — and the miss), with the landing's and the docking's. Each card draws its
  phase's curve (the ascent's altitude, the entry's load, the rendezvous' Δv). Measured: the Ranger from
  Tranquility to 100 km, "Ascent · Moon: 19.1" (84 %, 2 042 m/s for 1 718), "Orbit insertion: 20.0" (100.1 ×
  101.0 km).
- **Clocks**: the cockpit's CLOCKS shows the **MET** and **EARTH +…** when the Earth's clock is ahead (Miller's
  hours: red past a day). The log keeps each report.

## The space school

Tab held › School & challenges › Flight school (or `__bh.flight.school.space`). **Fifteen lessons**
(`game/spacecourse.ts`), each with its setup (a scene, an orbit, a ground, a hover, the ISS at a range, a target):
1 attitude and the RCS · 2 the holds and the SAS · 3 orbital basics: up and down · 4 circularize and the Hohmann
transfer · 5 the plane change · 6 the rendezvous · 7 docking by hand (6 DOF) · 8 deorbit and entry · 9 the glide
and the runway (Ranger) · 10 the lunar powered descent (Lander, the LPD) · 11 take-off and the ascent · 12 docking
to the turning Endurance · 13 the gravity assist (a lunar flyby) · 14 flying near Gargantua (the two clocks) ·
15 emergencies (RCS stuck, engine out).

- **Guided** (TARS flies his steps and says them, then your controls), **demonstration** (TARS flies yours too,
  "I'll do it: …"), **try** (your steps alone).
- A step is done when what it asks holds a moment (a hold within 5°, an apsis reached, circular, an inclination,
  docked, landed, within 1 km, a failure fixed, a point designated, the turn stopped…); else it passes at its time
  limit — a lesson never blocks. The report: 20 shared among your steps done, each with its time.
- Measured: *The holds and the SAS* demonstrated in low orbit, 20/20 (retrograde in 6 s, normal in 4 s).

## Challenges

`game/spacechallenges.ts`, the wheel's School & challenges › Challenges — lower is better, the goal held 1 s, a
maximum time:

| Challenge | Start | Measure | Gold · silver · bronze |
|---|---|---|---|
| Docking against the clock | the ISS 60 m off | time | 2 min · 3 min 20 · 5 min 20 |
| Pinpoint landing on the Moon | 3 km over Tranquility | miss | 15 · 50 · 150 m |
| Pinpoint landing on Mars | 3 km over Jezero | miss | 25 · 80 · 250 m |
| The hoverslam | 2 km, engine off, falling | Δv spent | 170 · 220 · 300 m/s |
| The entry corridor | a 400 km orbit | peak load | 3 · 4 · 5.5 g |
| The rendezvous on the least Δv | the ISS 20 km off | Δv spent | 25 · 50 · 100 m/s |
| The tumbling Endurance | the film's scene | time | 3 · 5 · 8 min |

The miss is the great-circle arc on the body from the craft's geodetic position. The result is a report (the
medal, the gold's mark, the best — "new record"); 20 for gold, 15 silver, 10 bronze; the bests kept on the device
(`kerr.space.bests`). Measured: the lunar pinpoint flown by the landing autopilot, 0.1 m, gold.

## Missions

`game/spacemissions.ts`, `controller/spacemission.ts`, the wheel's School & challenges › Missions — ordered
objectives each held 1 s and announced by TARS, a Δv and time budget (over it: failed, the rest marked missed),
failures injected and messages at fixed times; a debrief (each objective ✓ with its time or ✗, the Δv against the
budget, the time, the reason, the next chapter opened), its grade the share of objectives reached.

- **The library**: **Artemis II** (a free return planned → the Moon's sphere → back into the Earth's; 4 000 m/s),
  **To the ISS** (from 20 km behind: within 1 km → docked; 150 m/s, 2 h), **Landing on the Moon** (the Lander from
  50 km: under 10 km → landed; 2 200 m/s, 2 h), **Landing on Mars** (from 200 km: into the air under 60 km →
  landed; 2 h), **The rescue** (the tumbling Endurance at 300 km, a thruster sticking at 60 s: docked; 25 min).
- **The Interstellar campaign**, seven chapters, each opened when the one before was flown whole (kept in
  `kerr.space.campaign`): 1 lift-off from Cape Canaveral to orbit · 2 the Endurance (the ring at 4 rpm, the
  departure planned) · 3 the wormhole · 4 Miller's planet (down to the sea, back up before the wave, 30 min) ·
  5 Mann (dock to the turning Endurance) · 6 the slingshot (dive under 8 M of Gargantua, be thrown beyond 40 M) ·
  7 Edmunds (land there).
- **The editor** (*Make a mission from here…*): the start is the flight as it is now, saved in the mission; the
  objectives chosen among thirteen conditions with their value or choice (body, side), the Δv and time budget,
  messages ("60: the text"); **Fly** at once, **Copy its link** — a `#smission=…` that reloads the page and flies
  it (checked; never counted as a chapter). Measured: *Landing on the Moon*, landed at 74 s for 117 of 2 200 m/s,
  20/20.

## The crew console

A phone, a tablet or a second screen in the room ([CREW.md](CREW.md)) takes the **spacecraft profile** whenever the
pilot followed flies one (blue theme, the `VAISSEAU · RANGER` badge — the console is in French; tiles Δv,
propellant, Pe, Ap, period, next event, load, dτ/dt, link): the Dashboard, ORBIT (with the room's other craft, N6),
the **3D system map** of the Sun or of Gargantua (WebGPU, a 2D fallback), the navball, docking, Δv, EECOM, timeline,
relativity and ground views. Each crew member picks a **station** — aboard (copilot, navigator, flight engineer,
live) or on the ground (FLIGHT, FIDO, GUIDO, EECOM, CAPCOM) with the **light delay** (*Network › Light delay to the
ground*: real, a tenth, none; cut behind the wormhole, messages recorded). Its actions: target, station keeping,
undock, refuel, RCS mode, the ring, a burn dragged along the orbit, a failure's checklist ticked and its action
given — "everything but flying". `bun scripts/crew-demo.ts --space` opens a demo room (Cooper's Ranger at the ISS,
Brand's Lander over the Moon, Romilly's Endurance by Gargantua).

## Playing together

Everything above works in a room ([NETWORK.md](NETWORK.md), *Spacecraft together*):

- **The room's fleet** (N1): each craft's state once a second (kind, body, altitude, flight state, Δv, failures,
  docking, O₂, battery, side). The Network panel's **Fleet** tab lists the pilots in a spacecraft, oneself first,
  then nearest first — where, Δv, consumables, failures, range and closing (▼) or opening (▲) speed.
- **Orders** — *Come to me*, *Hold on me*, *Dock to me* — from the Fleet tab or the wheel (Fleet › Room fleet,
  then the pilot targeted): a card at the other's (Accept / Refuse, 30 s); accepted, his craft targets ours and his
  autopilot docks or keeps station within reach (3 km), else it targets and says to plan the rendezvous.
- **Proximity**: "PROXIMITY" under 200 m faster than 1 m/s or under 1 km and a minute from impact, "Traffic" under
  2 km and 3 min — never between docked craft nor for a passenger, once a craft per 15 s.
- **Sharing between docked craft** (N2): *Ask for propellant · power · oxygen* — what one's tank can still hold;
  the giver never goes under **25 % of his own capacity**; *Send my target*, *Send my plan* (up to 12 burns, at
  their times on the room's clock, the past ones dropped). Measured: 50 kWh moved, 2 000 → 1 950 kWh at the giver.
- **Aboard, the copilot, the controls** (N3): docked to another's craft in orbit, **Go aboard** (Fleet tab or ⇧K)
  — his craft and instruments yours to see, yours left docked, ⇧K back. As **copilot**: SAS, prograde, retrograde,
  hold off, station keeping, autopilot off, ring + and −, execute the plan — sent as crew orders, under the
  pilot's crew lock. **Take the controls**: the pilot accepts, the passenger flies the craft from where he saw it
  (its propellant, battery, oxygen), the former pilot his passenger; on our side of the wormhole.
- **Room challenges and results** (N4): every report flown in a room goes to all (a toast); the **Results** tab
  ranks each pilot's best per thing flown (a challenge by its result, the rest by the grade). *Propose to the room*
  on a challenge's card: those who accept start at the same place, **ghosts** to each other while both fly it.
- **Co-op missions with roles** (N5): *The Moon together* (Endurance — the orbit: 120 km, the ring past 2 rpm,
  held above 100 km · Lander — the descent from 50 km to the ground) and *The rescue together* (Endurance — stop
  the tumble · Ranger — the docking). One pilot a role; the mission won when every role is done, lost as soon as a
  role ends without its objectives; a pilot leaving frees his role (*Take the role*).
- **Time and sound** (N6): the room runs at the slowest pilot's warp and a pilot burning holds it — now said ("×10
  asked — waiting for Ben (burning)"); the nearest craft burning within 3 km is heard at its place; the crew's
  ORBIT view draws the room's other craft.

## Automation (`__bh`)

`__bh.flight.school.space(id, mode)` (a space lesson: `"attitude"` … `"emergencies"`; `"guided"`, `"demo"`,
`"try"`), `__bh.flight.spaceChallenges` (`open`, `go`), `__bh.flight.spaceMissions` (`open`, `go`, `fly`, `link`),
`__bh.camera.systemsFail(kind)` and `systemsInfo()` (a failure, the systems' state), `__bh.camera.missionPlan(spec)`,
`fcPlan`, `fcExecute`, `undock`; the room's parts under `__bh.net`. Reference: [BH-API.md](BH-API.md).

## Tests

Unit: `spaceassist`, `stationkeep`, `spaceguard`, `lpd`, `missiontimeline`, `takeoff-flight`, `ring`, `propellant`,
`hole-endurance`, `dock-spin`, `systems`, `craftpanel`, `spacepad`, `cockpit-pages`, `cabin`, `space-fx`,
`phase-reports`, `spacecourse`, `knowledge`, `spacechallenges`, `spacemissions`, `netspace`, `crew-space`,
`crew-profile`, `crew-system`, `crew-station`. End to end (real keys and clicks): `vaisseaux-x1`, `vaisseaux-x5`,
`space-school`, `space-missions`, `crew-space`, `crew-stations`, `crew-space-actions`, `crew-demo-space`, and with
two browsers `net-fleet`, `net-share`, `net-crew`, `net-board`, `net-coop`, `net-time`, `net-dock`. What each covers:
[E2E-CATALOGUE.md](E2E-CATALOGUE.md).

## Not yet

- **Flight**: the two-stage ascent (insertion with Ap at the target height, then circularize) — the ascent stays
  +19 % (Moon) and +27–30 % (Earth) over the impulsive minimum; the Jupiter mission (the n-body planner believes
  itself on its aim); the entry corridor's protection (bounce, overheating); the far rendezvous flown end to end
  in an e2e (≈ 15 h of game time); editing burns from the timeline (the flight computer and the crew map do it).
- **Endurance**: a ring turning apart from a still hub; the film's ~67 rpm (3 rpm here); a mass ratio per craft;
  docked craft not drawn inside the wormhole's throat itself.
- **HUD and cockpits**: the spacecraft HUD's colour and brightness; the "AAA" navball on the HUD (the crew console
  has its navball); a Lander instrument panel and an Endurance bridge of their own (Blender or a CC-BY model, to be
  proposed before any download); the cockpits' GPU cost not measured.
- **Immersion**: space views of exception (the scenes exist in the gallery); the replay off the Earth (a lunar
  landing is not caught).
- **School and missions**: the lessons' diagrams and a per-lesson instructor; only *The holds* verified end to end
  (the long demonstrations rely on the autopilots and the watchdog); a lesson for two; launch windows and a
  per-mission map in the 3D system view; the automatic journey as the campaign's demonstration.
- **Network**: the room's own Endurance taken on a lease and resumed on disconnection (needs craft ids rather than
  one craft a player); boarding from the host to its docked guest (only the guest goes through the airlock);
  mission control as a counted co-op role; taking a role back after reconnecting; a remote Ranger's lights and
  gear drawn (`F_LIGHTS` is sent); the other craft on the crew's 3D system map; recorded voice messages behind the
  wormhole (text ones exist); the assembly's mass for the host; the markers bent by the lens far off.
