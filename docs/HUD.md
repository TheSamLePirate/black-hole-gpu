# The HUD's piloting aids

Over the view while flying (`src/ui/hud/symbology.ts`, drawn on `canvas.fl-hud` each frame under the
nose symbol and the flight path vector), each aid where it helps, each with its switch in
**Settings › Game › HUD aids**. Directions come from `flightInfo()` in camera coordinates (at infinity:
right from any mount); points (the future path, the runway, the docking gates) with their distances.

- **Views**: full in the pilot's seat and the views on the hull (chase, dorsal…); from outside the ship
  (around, free, fly-by, the port's camera) the markers only. The ² density *clean*: the markers only.
- **Small screens** (under 1000 × 560 CSS px — a phone): the symbology in the view kept; the heading tape,
  the bank scale, the boxes and the scopes left to the HUD's panels.
- **Colours**: the game's palette — cyan the instruments and the predictions, amber the craft and the
  cautions, green what is right (on speed, on the axis, aimed), red the limits; each stroke over a dark
  outline, read on a bright sky.

## Everywhere near a world

| Aid | What |
|---|---|
| Horizon & pitch ladder | The local horizontal where it is; rungs every 5° (labelled every 10°), solid above, dashed below, their end ticks to the horizon, curved as the lens draws them; within a central field fading towards its rim; zenith and nadir. In orbit the local horizontal stands above the planet's limb by the horizon's dip (~20° at 400 km). |
| Heading tape | At the top: the view's heading against the world's north (its spin axis), boxed; carets for the nose (amber), the track (green: through the air, or the orbit's) and the target (orange). |
| Bank scale | Fixed to the craft, its pointer to the sky's up; red past 60°. |
| Radial & normal | Radial out / in (cyan), normal / anti-normal (magenta) in the view as on the attitude ball. |
| Arrows at the edge | The prograde, the burn, the docking port off screen: an arrow at the edge of the free frame (clear of the mission bar and the hub), the marker's glyph by it. |

## In the air

| Aid | What |
|---|---|
| Angle of attack | Drawn where it is, along the arc from the flight path vector to the nose in the craft's plane of symmetry: a green bracket on the best lift-to-drag incidence (C_L = √(C_D0 π AR e), ±1.5°), an amber tick at 85 % of the stall, a red bar at the stall; the nose symbol among them shows the margin; α in figures. STALL flashes, AOA past 92 %. |
| Sideslip | A ball under the flight path vector, off centre by β (8° full scale). |
| Energy | A chevron by the flight path's wing: the speed's rate as the flight path angle it would buy, atan(dV/dt / g) — above the wings gaining speed, below losing it. |
| Load | In g when it departs from 1 g, amber at 70 % of the craft's limit, red at 90 %. |
| Flight director | With the sci-fi flight computer: where it wants the flight path (its climb angle, its heading), a magenta cue and a dotted line to it. |

## The future

| Aid | What |
|---|---|
| Predicted path | The free fall from the ship's place, in perspective (both universes; on Gargantua's side the lensed tube ⇧Y draws it when on): relative to its body — over the ground as it turns near it and in the air, the orbit as it is higher —, cut where the body stands in front of it. Hidden while a wing carries the craft (the flight path vector tells where it goes). |
| Places to come | +10, +30, +60 s and a quarter of the orbit; about the hole an eighth, a quarter, a half of the prediction (a sample is minutes to hours there). |
| Impact & entry | Where the path meets the ground — the spot as the ground turns now —, the air's top on the way down, Gargantua's horizon; the countdown; off screen an arrow at the edge. |

## Approach & landing

| Aid | What |
|---|---|
| Runway | The entry's own, else the nearest on the world within 80 km below 20 km: its outline (4.5 km × 90 m), the threshold, the centreline drawn 15 km back. |
| Aim point | The steep slope's (19° at most, ~3 km short of the threshold): the direction to it is the glide path — the flight path vector on the diamond, the craft on its glide path. The autopilot then pulls up at 90 m onto a 1.5° slope and flares onto the touchdown, 450 m past the threshold. |
| Runway box | The runway, the distance to the threshold, the offset across the axis (L / R, ON AXIS), the glide path's error on the final; FLARE below 60 m. |
| Drift scope | Low and slow (under 3 km): the velocity over the ground, heading up, its scale chosen for it; the vertical speed's bar; the height. |
| Stop burn | At full thrust against gravity ((TWR − 1) g): the stopping distance v²/2a and the time until the burn must start — BURN IN …, BURN NOW, TWR < 1. |
| Touchdown spot | Down the height, along the drift for as long as the fall lasts. |

## In space

| Aid | What |
|---|---|
| Burn cue | The plan's next burn: its countdown, Δv, its length at full thrust; the aim — a ring about the manoeuvre marker, green within 2°, amber within 10°, red beyond — and TURN TO THE BURN when it nears with the craft not turned. |
| Docking guide | Gates 5–100 m out along the free port's axis (those still ahead); a scope down the axis — the offset across it, its drift over 10 s —; range, closing (red too fast within 20 m), the lateral offset and rate, the ports' angle. |

## Near Gargantua

| Aid | What |
|---|---|
| Relativity box | dτ/dt and its bar; the speed against the local observer, γ, the sky ahead's Doppler factor; E per unit mass — bound and the margin to escape, or escaping; the radius against the ISCO, the photon orbit and the horizon (red inside, or in the ergosphere); the tide per metre of the craft. The radial-in marker named GARGANTUA. |

## The hub's card

Beside the ring of the autopilots (bottom centre), while one flies: what it does now, its figures, and what
it predicts (`CameraController.hubInfo`, redone four times a second; `FlightHud.drawHubCard`).

| Autopilot | Phase | Figures | Prediction |
|---|---|---|---|
| CIRC | coasting to the apsis (the time sped up), turning to it, burning, trimming | the burn in, Δv, its length; burning, Δv and time left (a bar); trimming, the error and the orbit | → circular at the apsis' height |
| NODE | the same for any planned burn | the same | → the orbit the burn leaves (Pe × Ap) |
| ENTRY | planning; coasting to the deorbit; the burn (a bar); the guided entry; the glide — joining the axis, to the final's start, downwind, the turn, the final (its steep slope, pull-up, shallow slope, flare) | the entry: the site, its range and the heading off it (Δψ), the flow (Mach, q), the height, the bank asked and flown, the load and its peak, the heat, the peaks still ahead; the glide: the distance to the threshold, the height, the speed, the height off the profile | → the deorbit's heat, load and shield; the hand-over's miss; the touchdown 450 m past the threshold and when |
| LAND | killing the sideways speed, descending, the touchdown | height, vertical and sideways speed | → the touchdown in ~… |
| TAKE OFF | through the thick air, the gravity turn | height and apoapsis over the ground's figure, speed against the circular, the path's angle and heading against the command's, q and its peak, the gravity turn and MECO in | → the orbit's height, then CIRC; once above the ground, its Pe × Ap |
| DOCK | to the port's axis, held 10 m out, in along the axis | range, along and across the axis, closing, the ports' axes, the turns apart | → in the corridor (its cone) |
| APPROACH | closing on the target, backing off | the distance to the stand-off, the closing speed | → beside it in ~… |
| HOLD POS | holding the place | the offset, the drift | |

The hub's CIRC stays lit while its own burn is flown as a node. On a phone held upright, the card sits above
the ring. ORBIT (the target's orbit) and DOCK have their buttons on the ring and the map's strip too.

**Its rows, alike for every autopilot** (PLAN-HUB HB2): a value moving shows its trend beside it, **▲** or
**▼** — the HUD's own for every row (`ui/hud/trend.ts`): a single figure with its unit, against itself a
second before, by its last written digit at least, held 1.5 s; times counted down and rows of several
figures have none. A figure past its mark is **amber**, well past it **red with ⚠** (`HubRow`'s third
element, set by the autopilot):

| Row | Amber | Red |
|---|---|---|
| ENTRY · Load | > 2.5 g | > 4 g |
| ENTRY · Heat | > 1.1 × the peak planned | > 1.3 × |
| ENTRY · Profile (final) | off by a fifth of the height (10 m at least) | by half of it (30 m at least) |
| LAND · V/S (under 50 m) | falling > 2 m/s | > 3 m/s |
| LAND · Sideways (under 100 m) | > 1 m/s | > 2 m/s |
| TAKE OFF · Path angle (above 1 km) | 10° off the command's | 20° |
| DOCK · Closing | a quarter over the profile's rate | half over (the graph's "off") |
| DOCK · Ports' axes, turns apart (within 30 m) | > 3°, > 1°/s | > 6°, > 2°/s |

**Its height bounded**: the phase and the prediction take two lines at most; the small graph is 96 px; on a
window too short for the card under the mission's bar (below 620 px the cockpit already shrinks to ×0.72),
the small graph folds away — its title stays — and comes back once there is room (with a margin).

**Its graph opened large** (HB3): a click on the small graph opens it at up to 600 × 300 above the card
and the ball — its title, what it shows (and what to do out of the corridor), its axes named, a legend,
the reading under the pointer (the abscissa, the optimum, the corridor); ✕ or Esc closes it, the autopilot
untouched.

## The flight's telemetry and its report

- **The recorder** (`game/recorder.ts`, `__bh.recorder`): height, the HUD's speed, vertical speed, load, q,
  Mach, heat flux, throttle, Δv spent, propellant — one sample per step of the scene's time, the step
  doubled when the record is full (4 000 samples): the whole flight kept, coarser as it lasts. Started
  again with each flight.
- **The tablet's TELEMETRY page** (M): up to three curves stacked on one time axis, a window of 1 min,
  10 min, 1 h or the whole flight; each curve's last value, its least and its most; **Export CSV**.
- **The flight's report** (`game/report.ts`): at a landing (the gear's verdict) and at a docking (the
  capture), a card graded out of 20, A to F, each figure judged (good, fair, poor) — the sink, the axis or
  the site's distance, the load's peak, the gear; the closing rate, the ring off the axis, the ports'
  axes, the turns apart; the Δv spent and the flight's length. It stays 20 s (✕ or Esc), and the journal
  keeps its line.

## The assistants: every autopilot flown by hand

**F4** (or the card's **AUTO / ASSISTED** button) switches all the autopilots at once: assisted, the
autopilot works out what it would do — where the nose and the top go, the throttle, the thrusters' push —
and leaves the ship to the pilot (`FlightComputer.assist`, its commands kept as `director`); back to AUTO, it
flies on from where the ship is. A hold (1 – 7) keeps an assisted autopilot: it is the pilot's way to follow
the ring.

- **The flight director** (over the view): a ring where the nose should point — amber, green within 3° —
  the top's tick, the thrusters' arrow, an arrow on the edge when out of view; under it the autopilot's
  name and the phase's own words (below the master caution's banner and the docking panel): the throttle
  to set or to cut, and per phase:

| Phase | The director says |
|---|---|
| A burn (node, CIRC, Hohmann, plane, rendezvous, intercept, the FC's burns, the deorbit) | IGNITION IN … (large figures over its last 10 s), Δv LEFT and a gauge, CUT THE ENGINE (blinking) — the Δv counted along the burn as the pilot gives it, the burn lit by hand in its last half before its start, done once cut at the cue; the time no faster than real for the ignition's last seconds |
| Take-off | PATH ° · HDG ° (asked), GRAVITY TURN IN, MAX-Q … kPa near it, MECO IN ~ |
| Entry | ENTRY INTERFACE IN, BANK ° LEFT/RIGHT, REVERSAL IN ~ |
| Final | GLIDE ▲▼ °, FLARE IN |
| Vertical descent, hold low | DESCENT flown → asked m/s, BURN IN / BURN NOW, DRIFT |
| Approach | CLOSING flown → asked m/s, BRAKE IN / BRAKE NOW |
| Docking | CLOSE flown → asked m/s, OFFSET · CONE, PORTS °, HOLD AT 10 m — ALIGN or CONTACT IN ~ |

- **The graph** under the hub's card (its title folds it; remembered), the same on the cockpit's PLAN screen:
  one figure against another, the autopilot's optimum (dashed), its corridor (filled), the trace flown, the
  craft's dot — green in the corridor, amber out of it (a line under the graph then says what to do), cyan
  not yet in it or slower than it on the safe side; its title's tooltip says what it shows
  (`src/ui/hud/graph.ts`, data from `hubCompute`).

| Graph | x · y | Optimum · corridor |
|---|---|---|
| Burn | time from the node · Δv left | the burn centred on the node · started up to 15 % of its length early or late |
| Ascent | downrange · height | the take-off's command integrated (`climbProfile`) · 15 % of the downrange, 2 km and a fifth of the height either side; the apoapsis and the height asked as levels |
| Entry corridor | speed · height | the guidance's predicted fall · the lift's top, the heat's and the load's floor at the angle of attack held (`entryCorridor`) |
| Final | distance to the threshold · height | the landing profile · the PAPI's ±1° from the touchdown |
| Vertical descent | descent rate · height | the landing autopilot's braking curve · a quarter to 1.25 ×, never past a 90 % stop |
| Approach | distance to the stand-off · closing rate | the approach's braking curve (60 % thrust) · from a quarter up to a 90 % stop |
| Docking | distance along the axis · closing rate | 8 cm/s + 1.2 cm/s a metre (3 m/s at most) · half to 1.5 ×; the 10 m hold marked |

- **By hand, no autopilot**: on a runway's final (on its axis, heading down it, below 6 km, within 40 km)
  the profile is the one the autopilot would fly from where the final began, frozen there — the PAPI, the
  gates, the aim and the glide's error work as under the autopilot, the card is the runway's; in a
  descent on the engines (below 5 km, slow, falling) the card is the descent's.
- **Alerts explained**: every alert's line has a tooltip, and a click opens why it is on and what to do.
- **The key hints** add F4 (assisted) and F3 (the free camera: the ship flies on) while an autopilot flies.

## On the cockpit's screens

The same aids on the cabin's screens (`src/ui/cockpitscreens.ts`, redrawn 8 times a second while the cabin
is seen; the switch **Aids on the cockpit's screens**, each aid also by its own switch):

| Screen | What it adds |
|---|---|
| PFD | In the air the flight path marker through the air (red stalled), the angle-of-attack bracket and stall marks above it, the energy chevron, the sideslip ball, the flight director on the rolled ladder; a heading tape over the ball. |
| NAV → APPROACH | A runway in reach (40 km): the runway from above with its centreline, the aim point and the craft (its offset across ×4); the localizer's and the glide path's needles (an ILS's), the distance to the threshold, the offset, the height. |
| DOCKING | The scope oriented down the port's axis: the offset where it is, its drift over 10 s; the closing rate coloured by the range. |
| DOCKING → LANDING | Low and slow with no port in reach: the drift scope (the ship's forward up), the vertical speed's bar, DRIFT, V/S, the stop burn's countdown, TWR. |
| PLAN | The next burn, large: its countdown, Δv, length at full thrust, the aim; the assistant's graph under it (or alone) — the burn's, the ascent's, the entry corridor, the final, the descent, the approach, the docking. |
| ORBIT | About Gargantua: the relativity box — dτ/dt, speed and γ, the sky ahead's Doppler, the energy, r against the ISCO, the photon orbit and the horizon, the tide. |
| CLOCKS | About Gargantua: dτ/dt in place of the local time. |

Cost: the symbology is a few hundred canvas strokes a frame; the future path and the runway are
recomputed ten times a second at most (`futureView`, `runwayView`). Full screen at 1280 × 720 and on a
phone: 16.7 ms a frame (median).
