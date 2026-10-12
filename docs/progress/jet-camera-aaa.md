# Jet flight and camera, AAA pass: progress and tests to run

The request: a Cinemachine-style camera system (third person, flight, rocket, planets, systems), a better HUD for
plane mode flown like a jet with all of a jet's options, and fewer alarm beeps when flying low.

| Lot | Topic | State |
| --- | --- | --- |
| 1 | Ground alerts on the flight path (GPWS) | done |
| 2 | Jet HUD and jet systems | done |
| 3 | Camera brain (virtual cameras, blends, noise, dynamic FOV) | done |
| 4 | Cinemachine options, no jerks anywhere, softened chase and dorsal, docking jerk, speed effects | done |

## Lot 4: Cinemachine options, smooth everywhere, speed effects

**The rig** (`src/cine/follow.ts`, pure and tested in `tests/cine-follow.test.ts`; applied in
`src/controller/camrig.ts`):

| Cinemachine | Here | Setting (Game › Camera rig) |
| --- | --- | --- |
| Transposer binding modes | Lock to target, lock without roll, world up (horizon level), world | Binding |
| Rotation damping per axis | Critically damped spring on the orientation, per axis. A steady turn (the Endurance's spin) is followed with no lag; only jolts are smoothed, without overshoot. | Damping: pitch, yaw, roll |
| Position damping | The camera falls behind under acceleration (afterburner) and catches up | Damping: position |
| Composer lookahead and screen position | The aim leads along the motion; the craft sits at an x/y offset on screen | Lookahead, Composer x / y |
| Lens dutch | Roll of the view | Dutch angle |
| Noise profiles (Basic Multi-Channel Perlin) | None, hand-held, shake, rumble, vibration, with amplitude and frequency gains | Noise profile, amplitude, frequency |
| Impulse sources and listener | Wheel contact, touchdown, sonic boom, transonic, docking latches, crash (the haptic events) | Impulses |
| Default blend | Ease in-out, ease in, ease out, hard in, hard out, linear, cut, plus a time | Blend, Blend time |
| Dynamic lens | Wider at speed and with the afterburner | Speed lens |
| Which views get the rig | Chase and dorsal (default), every outside hull view, or off | Softened views |

**The rig runs after the flight, each frame** (Cinemachine's LateUpdate). Running before, it showed each turn
rigid first, then smoothed a frame late. Moving it also fixes the port camera's one-frame lag.

**No more cuts:**

- **Between views (V):** the eye swings round the craft and the look direction is slerped. It never passes
  through the hull, and never flips 180° between a forward view and a backward one (cockpit → docking camera).
  The old point lerp flipped about 0.2 s in.
- **Between vessels ([ ]):** the view is carried from the craft left to the new one.
- **Spectator (F3):** it now leaves from the eye itself and arcs back behind the ship. Returning, it is carried
  onto the view.
- **Between planets, craft and the ISS** (go to, when not flying): a travel. The distance is eased on a log
  scale, the camera looks at the destination midway, and takes 1.2 to 6 s. Tested in `tests/travel.test.ts`.
- **Target change while orbiting a planet:** the turn to the new aim is blended (it used to snap).
- **Coasting craft with the free camera:** they are now stepped every frame. Before, the switch between
  analytic coast and integration made them jump about 5 s after leaving the seat.

**Docking with the spinning Endurance** (`tests/dock-spin.test.ts`, a real docking flown headless).

- **Causes found:**
  - the warp ladder flickered ×10↔×5 around 150 m;
  - at ×10 the Endurance's 18°/s looked like 180°/s, beyond what the Ranger can turn;
  - the turn rate was computed at the previous frame's warp;
  - the capture snapped the Ranger onto the port.
- **Fixes:**
  - the warp steps hold within a 15 % band;
  - the warp is capped at what the Ranger can turn with;
  - the warp is eased over 1.5 s;
  - the rate is read after the warp is set;
  - the capture is carried (0.6 s).
- **Measured:** the view's worst frame-to-frame change in turn rate fell from 0.053 to 0.007 rad/s. The docking
  takes 141 s.

**Speed effects** (`src/ui/speedfx.ts`, setting HUD aids › Speed effects 0.7, Grey-out under load):

- streaks of air flowing past the eye, in world coordinates, so a turn sweeps them across the view;
- more of them faster, close to the ground and with the afterburner; none in vacuum;
- edges darkened with speed;
- grey-out from 5 g, narrowing to a tunnel at 9 g;
- a camera jolt on every haptic impulse;
- a wider lens at speed in the softened views.

### Tests to run on the Macs (manual)

1. **Hard roll in the chase.** Plane mode, chase view. The view follows the roll with a slight lag and no
   jerk. With Softened views = Off it is rigid again. Binding = World up keeps the horizon level.
2. **Dorsal and position damping.** Dorsal view, ⇧Z (afterburner): the craft pulls away a little, then the
   camera catches up.
3. **Views.** Go round all the views with V, especially cockpit → docking camera (180°): no flip. Blend = Cut
   gives clean cuts. Blend time 3 s gives slow blends.
4. **Vessels.** [ and ] in the Endurance scene: the camera glides from one craft to the other.
5. **Spectator.** F3 from the cockpit: the camera leaves the cockpit and arcs back behind. F3 again: back to the
   seat, eased.
6. **Planets.** Free camera, camera panel › go to Mars, then the Moon, then the ISS: a travel with no jump.
7. **Endurance docking.** "Earth: the Endurance tumbling" preset, B: no flicker or jolt in the hatch camera;
   the capture is soft.
8. **Speed.** At 300 m and Mach 0.9: streaks and darker edges. A 7 g pull: grey-out. A touchdown: a jolt.
9. **Noise.** Profiles hand-held, then shake, then vibration, with the amplitude raised.
10. **Composer and dutch.** Composer x = 0.25 puts the craft right of centre; dutch 10° tilts the view.

**Not done (Cinemachine features with no equivalent yet):**

- Tracked Dolly (a camera on a path);
- Group Composer (framing several targets);
- Confiner and Collider for the hull views;
- a fixed-step simulation with interpolation (rAF jitter and dropped frames still show as is).

## Lot 3: the camera director (Cinemachine-style)

**The brain** (`src/cine/brain.ts` and `src/cine/rig.ts`, pure and tested in `tests/cine.test.ts`).

- **Shots.** Virtual cameras, each with a body, an aim, a lens, damping (critically damped springs) and noise:

  | Shot | What it does |
  | --- | --- |
  | Chase | Behind the direction of travel, lagging the turns, the horizon mostly level in the air. |
  | Slow orbit | One turn round the craft every 45 s. |
  | Fly-by | A camera fixed in the world ahead of the craft, following it past with a long lens. |
  | Ground tracking | On the ground 900 m to the side, the lens closing as the craft climbs away (a launch shot). |
  | Planet's limb | The world's horizon behind the craft, seen from above and behind. |
  | Destination | The target (else the Sun) behind the craft, with a longer lens. |

- **Director.** It picks the shots by flight phase (ground, launch, low, air, orbit, deep space) and holds each
  for 8 to 20 s. It cuts to and from the still cameras (fly-by, tracking) and blends 1.6 s between the moving
  ones. The fly-by ends once the craft has passed.
- **Lens.** The chase widens with Mach (up to +14 %) and with the afterburner (+7 %). The still cameras use a long
  lens that keeps the craft a third of the frame high.
- **Noise.** Air buffeting (strongest through Mach 1), engine rumble, afterburner, and hand tremor on a long lens.

**In the app** (`src/controller/cine.ts`):

- A new outside view, **Director** (in the V cycle and the view buttons). The craft keeps its attitude: the existing
  view easing re-orients the camera, not the craft. `tests/cine-flight.test.ts` checks that a flight seen from the
  Director is the same as from the chase, within 0.5 m and 0.01°.
- The view carries a camera up vector (`MountPose.up`), so the horizon stays level.
- The lens is taken while the Director is on and given back afterwards. The mouse wheel sets the shot distance.
- **Key `\`** (` on a French Mac keyboard): switches to the Director, then cycles through "director chooses",
  then each shot.
- **Settings** (Ranger): Director's shot, camera shake (0.5), dynamic lens (on).
- **Sound.** In the fly-by and tracking shots, the sonic boom is heard as a standing listener.

**On foot** (`src/controller/character.ts`):

- The camera sits over the right shoulder (setting Over the shoulder: 0.45 m).
- Its pivot follows the head with a 70 ms lag and is saved in snapshots.
- It dips with the legs on a landing and jolts in proportion to the fall.
- The field widens by 7 % when running (disabled along with the dynamic lens).

### Tests to run on the Macs (manual)

1. **Low pass.** Ranger in plane mode, low pass at 300 m, `\` (Director): chase first, then fly-by (a cut), slow
   orbit, chase again. No jerks, and the horizon stays level in the chase.
2. **Supersonic.** Mach 1.2 in the chase: the field widens and the camera shakes at the sonic transition. With
   shake set to 0 it is steady.
3. **Afterburner.** ⇧Z in the chase: a small lens kick and more rumble.
4. **Launch.** Take off with U from Kennedy in the Director: the tracking shot from the ground, the long lens
   closing, the boom heard from the ground.
5. **Orbit.** At 400 km in the Director: the planet's limb behind the Ranger, the horizon visible in the upper
   third. Then the chase, the slow orbit, and the destination with the Moon targeted.
6. **Deep space.** Transfer to Mars in the Director: the destination shot shows Mars behind the craft.
7. **Fixed shot.** Setting Director's shot = Chase: no cuts. Wheel: the distance changes (×0.35 to ×10).
8. **Leaving.** V to the cockpit view: the field of view returns to its value (eased).
9. **On foot.** Walk on the Earth: the shoulder offset, running widens the view, a jump lands with a dip and a
   jolt. F5 then F9 (save, load): the camera is restored identically.
10. **Performance.** No measurable CPU cost (the brain is a few vectors per frame), visible in the "flight HUD"
    and "sound" profiler rows.

## Lot 2: jet systems and the jet HUD

**Systems** (`src/game/jet.ts`, pure and tested in `tests/jet.test.ts`; flown in `src/controller/jet.ts`, tested in
the real sim in `tests/jet-flight.test.ts`). They work in plane mode (F).

| Key | System | Behaviour |
| --- | --- | --- |
| `'` (ù on AZERTY) | Autopilot | Holds the current altitude (rounded to 10 m) and heading. It climbs or descends at most 12° and 40 m/s, and turns at most 30° of bank. Control-wheel steering: the stick flies through the holds, and when released the new altitude and heading are held. |
| ⇧`'` | Autothrottle | Holds the current speed. ⇧ and Alt (throttle up and down) then change the target speed by 10 m/s per second held. Z, X or moving the lever disengages it. |
| ⇧Z | Afterburner | Full throttle, thrust ×1.5, propellant ×3, a longer and brighter flame, a louder engine. It switches off when the throttle drops below 95 %. It is exclusive with the autothrottle. |

Other behaviour:

- An autopilot of the flight computer, or the ground, disengages the holds. Any other flight mode turns all the
  jet systems off.
- **Pitch trim.** The plane law already trims itself: it holds the flight path when the stick is released.

**Jet HUD** (`src/ui/hud/jethud.ts`; setting HUD aids › Jet HUD: Knots · feet (default), Metric, Off). It shows in
plane mode, in the air, from the pilot's seat:

- the ladder, heading and bank scale turn green;
- an airspeed tape on the left and an altitude tape on the right, each value boxed, with magenta bugs for the
  autothrottle speed and the autopilot altitude;
- under the speed: Mach, G with its peak, and α (amber at 85 % of stall, red at stall);
- under the altitude: the vertical speed and the radar altitude, boxed below 1500 m;
- the mode annunciators (ALT, HDG, A/T);
- the throttle bar, with AB blinking.

### Tests to run on the Macs (manual)

1. **Afterburner.** Ranger in plane mode, on the runway at Edwards: ⇧Z, take off. Expect THR 100 with AB amber and
   blinking, a longer flame, more noise. Throttle down below 95 %: AB goes out.
2. **Autopilot.** At 2000 m, `'`: expect "ALT 6560 HDG 090". Hands off: the altitude stays within ±30 m and the
   heading within ±2°.
3. **Control-wheel steering.** With the autopilot on, pull 3 s then release: the new altitude is held and the
   magenta bug on the tape moves to it. Roll 2 s then release: the new heading is held.
4. **Autothrottle.** ⇧`'`, then ⇧ held 3 s: A/T goes up by about 60 kt, the throttle follows, the speed settles
   without oscillating. Z: A/T is off.
5. **HUD.** Check knots/feet, then Metric in the settings. On iPad (compact), only the annunciators and the
   throttle show, without tapes. In the around and fly-by views the jet HUD is hidden.
6. **AZERTY.** The ù key works for the autopilot. The `-` and `=` zoom keys are unchanged.

## Lot 1: ground alerts on the flight path

**Why it beeped.** The collision alarm sounded whenever the free-fall (ballistic) impact was under 45 s away.
Flying low on the wings, that is always true: a jet at 150 m has a free-fall impact about 5 s away all the time.
On top of that, the terrain caution sounded on any descent faster than 12 m/s, at any height.

**Now** (`src/game/gpws.ts`, pure and tested in `tests/gpws.test.ts`):

- **Look-ahead along the flight path.** `terrainAhead` gives the seconds until the straight flight path, along
  the velocity over the ground, meets the relief. It samples every 0.5 s up to 6 s, then every 1 s up to 20 s.
  It runs only within 3 km of the ground. The controller computes it in `terrainAheadNow()`
  (`src/controller/motion.ts`) and it reaches the flight info as `terrainAhead`.
- **Which time counts.** On the wings (dynamic pressure above 2 kPa, not stalled, not rocket mode), the time used
  is the shorter of the look-ahead and the straight-down closure. Otherwise (a rocket, a stall) only the closure
  counts.
- **Landing configuration** (gear down, flaps out, or on a final). The landing's sink-rate envelope applies
  instead, as before. The look-ahead triggers a warning only when it is very short. Nothing sounds in the flare
  (below 15 m).
- **The `groundAlerts` setting** (Game › Sound › Ground alerts):

  | Level | Pull-up warning | Terrain caution | Heights and sink rate |
  | --- | --- | --- | --- |
  | Airliner | 7 s ahead | 14 s ahead | always called |
  | Fighter (default) | 4 s ahead | 7 s ahead | only in landing configuration |
  | Off | 2.5 s ahead | none | never |

- **Above 3 km**, the old ballistic collision alarm (impact under 45 s) still applies, and so does the event
  horizon alarm.

### Tests to run on the Macs (manual)

1. **Low pass over flat ground.** Fly the Ranger in plane mode at 150 m and about 250 m/s with the gear up, over
   the Beauce or the sea. Expect no alarm, no "Terrain" and no radio heights.
2. **Ridge ahead.** Fly level at 300 m towards the Alps from Grenoble. Expect the terrain caution tone about
   7 s before the ridge and "Terrain! Pull up!" plus the warning about 4 s before. A pull-up silences both.
3. **Dive.** Push into a 30° dive from 1500 m. Expect the pull-up at about 4 s from the ground, and silence once
   the dive is recovered.
4. **Landing.** On a manual ILS approach with the gear down, expect the heights (300, 100, 50 … 10) and
   "Minimums", no pull-up on the normal glide, and silence in the flare.
5. **Entry autopilot (steep Ranger glide).** Expect no false pull-up, the heights called and the sink rate only
   beyond the envelope.
6. **Airliner level.** Same as test 1. Expect the heights to be called on the way down.
7. **Off level.** Same as test 2. Expect only the last-moment pull-up.
8. **Rocket mode, Lander on the Moon.** No air means no look-ahead. Expect the ballistic alarm above 3 km and the
   ground closure below 3 km.

### Automated

- `bun test tests/gpws.test.ts` covers the look-ahead, the three levels, the landing envelope, rockets, and the
  callouts gated by level.
