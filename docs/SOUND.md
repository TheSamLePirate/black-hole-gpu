# Sound

Everything is synthesized live with the Web Audio API (`src/audio/engine.ts`): no sample, nothing
downloaded, no music. A director (`src/audio/director.ts`) watches the flight every frame and turns
what changes into sound (`src/main.ts` feeds it every frame and plays the warp ticks). Settings ›
Game › **Sound**: on/off, **Volume** (master), and a mix of four busses — **Flight computer** (beeps,
alarms), **Engines & RCS**, **Cabin & wind**, **Interface**. The toolbar's **Sound** button and the
flight HUD's speaker button mute / unmute (a toast says which). Browsers keep audio off until the first
click or key; the context sleeps while the tab is hidden. Paused (or the simulation frozen), the
thrusters fall quiet; the cabin hums on while the ship is flown.

## The ship

| Sound | Made of | Follows |
|---|---|---|
| Main engine | brown-noise rumble (low-passed), band-passed roar flickering like a flame, a sub-bass shake | the throttle actually applied (manual or autopilot); a thump at ignition, a sigh at cut-off |
| RCS | high-passed hiss panned to the side that fires, a valve pop when it opens and shuts | translation (IJKL HN) and hard turns (when the wheels saturate) |
| Reaction wheels | a faint whine, its pitch with the ship's spin | the attitude effort |
| Cabin | life support: a mains-like hum, air in the ducts | the ship flown |
| Wind | band-passed noise ∝ √(dynamic pressure ½ρv²), brighter with speed | the air's density (Earth, Mars, Titan…) |

**Where the camera is** — on the hull (Dorsal, Belly, Rear — the nose looking back) the ship is heard
through it: heavy and close, the cabin louder; every other view (Chase, Film, Wing, Dock, the outside
views — and, as the code stands, Cockpit and Cabin too) hears it further and duller in vacuum, open in
an atmosphere. Changing the view while flying: a soft shutter click. The beeps and thrusters pass through a small
procedural cabin reverb.

## The flight computer

| Event | Cue |
|---|---|
| SAS on / off (T) | two rising / falling blips |
| Attitude hold (1–7: prograde … target; also anti-target, manoeuvre) | one blip, its pitch naming the mode; released: a low blip |
| Autopilot engaged / off (8 hover, 9 circularize, 0 approach, G land, U take-off) | a rising / falling arpeggio (take-off: a three-step climb) |
| Precision mode (Caps Lock) | a tiny high double tick |
| Time warp (, .) | a tick, higher with each rung; at the end of the ladder, or refused while a manoeuvre's auto warp holds it: a buzz |
| Target changed | a soft ping |
| Sphere of influence changed | a two-note FM bell |
| Through the wormhole | a deep sweep and a bell |
| In orbit, arrived, manoeuvre done | a three-note chime |
| Manoeuvre node | 5 … 1 ticks (wall-clock seconds), a long tone at ignition, a double beep at cut-off |
| Touchdown | a thud and a confirmation chirp · a crash (a "crash" warning in the log): an impact |
| Propellant under 15 %, tank empty, errors (any error in the log) | a low buzz |
| **Collision course** (the horizon, an impact within 45 s) | a two-tone alarm, repeating |
| **Fast descent** near the ground (sinking > 12 m/s in flight, no collision alarm already) | a slow caution tone |
| Interface | a click on every button, a breath on hovering the toolbar and the scene cards |

## For tools

`__bh.sound.play("sas-on")` (any cue of `Cue` in `engine.ts`), `__bh.sound.level()` (output RMS,
dBFS), `__bh.sound.ctx`; `__bh.audio` is the director. The `sound*` settings survive a change of scene
(`KEEP_ON_PRESET`).
Measured (Artemis II, Chase view, default mix): cabin −47 dBFS, RCS −25, main engine −16, a beep
peak −17; climbing out of the Kennedy Space Center −10 to −11 (engine and wind; a limiter at −3).
