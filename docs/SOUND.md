# Sound

> Since this page was written (6 Oct), the sound has grown: spatial placement (HRTF, Doppler, the boom),
> a granular rocket engine on the audio thread, the F-35's turbofan and its fights, busses for the **voices**
> and the **music**, the flight radio's roles and the players' voices — see [AUDIO.md](AUDIO.md) (French,
> current: every source, the voices' radio, the measured mix) and, for the callouts, mission control, the
> music and TARS, [TARS.md](TARS.md). What follows describes the director and the cues, and sums up the rest.

Everything is synthesized live with the Web Audio API (`src/audio/engine.ts`): no sample, nothing
downloaded. A director (`src/audio/director.ts`) watches the flight every frame and turns
what changes into sound (`src/main.ts` feeds it every frame and plays the warp ticks). Settings ›
Game › **Sound**: on/off, **Volume** (master), a mix of busses — **Flight computer** (beeps, alarms),
**Engines & RCS**, **Cabin & wind**, **Interface**, **Music volume**, **Voice volume** — and **Headphones
(3D sound)** (HRTF panners instead of equal-power ones). The toolbar's **Sound** button and the
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

**Where the camera is** — the Cockpit and the Cabin hear the ship from inside (the hull's modes, the
panel's beeps, the roar dulled); the hull mounts (Dorsal, Belly, Rear — the nose looking back —, Dock) through its structure: heavy
and close; every other view hears it from outside — further and duller in vacuum (a game's licence), open
in an atmosphere, with its Doppler and the air's absorption. Changing the view while flying: a soft shutter click. The beeps and thrusters pass through a small
procedural cabin reverb.

## The F-35

| Sound | Made of | Follows |
|---|---|---|
| Turbofan (F135) | the compressor's whine (a chord of its stages, ~900 Hz at idle to ~3 kHz at full), the exhaust's broadband roar and low rumble, the afterburner's torn brown noise (its crackle), the lift fan's roar and blade tone in STOVL | the spool, the thrust, the afterburner, the fan; placed at the nozzle with its Doppler; from the seat the roar, rumble and afterburner dulled, the whine through the structure |
| The pilot's mask | his breathing from the cockpit, calm at rest, straining under load, silent in G-LOC, a gasp as he comes to | the load at his eyes; F-35 › *Pilot's breathing*, *G effects* |
| Buffet | a low shaken rumble through the airframe | the wing's buffet at high incidence, by the dynamic pressure |
| A fight | the gun (a 55-rounds-a-second buzz and crackle), our missile's motor going away, an enemy launch's four beeps, the RWR's fast two tones while a missile chases us, explosions late by their distance (quieter and duller far off), a hit on the jet | the fight's world |

Measured at the output (`tests/e2e/f35-sound`, the loudest channel): from the seat idle −31 dBFS, full dry
−16, afterburner −14; from the chase −27, −19, −13.5; peaks under −4.8 dB.

## The radio and the voices

Every radio line is framed by Quindar tones (2525 Hz at its start, 2475 Hz at its end, as Apollo's capcom),
the squelch's click and a hiss in the voice's band. The flight's radio speaks in roles (setting F-35 ›
*Radio roles*): the tower, the wingmen, the AWACS **Darkstar** (the picture: bandits by their BRAA, SAM sites,
kills, a bogey dope), the carrier **Mother** and its LSO **Paddles** (whose calls cut the others) — each its
own Deepgram voice (or another system voice), named in the subtitles; in a room the roles about our own craft
are heard by the other pilots, our name first. The players' own voices (WebRTC, voice-activated, push-to-talk
or open) are played through a radio — a headset's band, a little drive, a hiss and the Quindar tones —, the
engines, the ambience and the music lowered 8 dB under them. Details: [AUDIO.md](AUDIO.md) › *Les voix*,
[NETWORK.md](NETWORK.md).

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
