# Sound

Everything is synthesized live with the Web Audio API (`src/audio/engine.ts`): no sample, nothing
downloaded, no music. A director (`src/audio/director.ts`) watches the flight every frame and turns
what changes into sound. Settings › Game › **Sound** (on/off, volume, and a mix of four busses); the
🔈 toolbar button mutes. Browsers keep audio off until the first click or key.

## The ship

| Sound | Made of | Follows |
|---|---|---|
| Main engine | brown-noise rumble (low-passed), band-passed roar flickering like a flame, a sub-bass shake | the throttle actually applied (manual or autopilot); a thump at ignition, a sigh at cut-off |
| RCS | high-passed hiss panned to the side that fires, a valve pop when it opens and shuts | translation (IJKL HN) and hard turns (when the wheels saturate) |
| Reaction wheels | a faint whine, its pitch with the ship's spin | the attitude effort |
| Cabin | life support: a mains-like hum, air in the ducts | the ship flown |
| Wind | band-passed noise ∝ √(dynamic pressure ½ρv²), brighter with speed | the air's density (Earth, Mars, Titan…) |

**Where the camera is** — on the hull (Dorsal, Belly, Rear) the ship is heard through it: heavy and
close; from outside (Chase, Film, Wing) further and duller in vacuum, open in an atmosphere. All of
it passes through a small procedural cabin reverb.

## The flight computer

| Event | Cue |
|---|---|
| SAS on / off (T) | two rising / falling blips |
| Attitude hold (1–7…) | one blip, its pitch naming the mode; released: a low blip |
| Autopilot engaged / off | a rising / falling arpeggio (take-off: a three-step climb) |
| Precision mode (Caps Lock) | a tiny high double tick |
| Time warp (, .) | a tick, higher with each step; at the end of the range: a buzz |
| Target changed | a soft ping |
| Sphere of influence changed | a two-note FM bell |
| Through the wormhole | a deep sweep and a bell |
| In orbit, arrived, manoeuvre done | a three-note chime |
| Manoeuvre node | 5 … 1 ticks (wall-clock seconds), a long tone at ignition, a double beep at cut-off |
| Touchdown | a thud and a confirmation chirp · a crash: an impact |
| Propellant under 15 %, tank empty, errors | a low buzz |
| **Collision course** (the horizon, an impact within 45 s) | a two-tone alarm, repeating |
| **Fast descent** near the ground (> 12 m/s) | a slow caution tone |
| Interface | a click on every button, a breath on hovering the toolbar and the scene cards |

## For tools

`__bh.sound.play("sas-on")`, `__bh.sound.level()` (output RMS, dBFS), `__bh.sound.ctx`.
Measured (Artemis II, Chase view, default mix): cabin −47 dBFS, RCS −25, main engine −16, a beep
peak −17; climbing out of the Kennedy Space Center −10 to −11 (engine and wind; a limiter at −3).
