# The music, AAA pass: progress and tests to run

The request: much better music; several rich themes with sub bass, drums, synths and ethereal guitar; many themes
at AAA quality; a panel to manage, set up and listen to them; an AAA music system.

## What was built

| Part | File | What it does |
| --- | --- | --- |
| Theory | `src/audio/music/theory.ts` | Modes (minor, Dorian, Phrygian, Lydian, major, Mixolydian, harmonic minor); diatonic chords (triad, 7th, 9th, sus2, sus4, add9, power); voice leading; a seeded random |
| Themes | `src/audio/music/themes.ts` | 12 themes, each with a key, mode, tempo, form (intro, verse, build, drop, break), progressions, a band and its space (reverb, delay) |
| Composer | `src/audio/music/composer.ts` | Plays a theme bar by bar, deterministically (see below) |
| Instruments | `src/audio/music/instruments.ts` | Everything synthesized in Web Audio (see below) |
| Engine | `src/audio/music/engine.ts` | Bars scheduled ahead of the clock; theme changes on the bar, crossfaded; the mixer and effects (see below) |
| System | `src/audio/music.ts`, `src/audio/score.ts` | The modes, the moments, the contexts, the flight's intensity, preferences kept in the browser |
| Panel | `src/ui/musicpanel.ts` | Toolbar › Music, or the ♫ button on the flight HUD |
| Render | `scripts/render-music.ts` | Renders the themes offline (WAV and MP3) and checks clipping, loudness and sub |

**The composer, bar by bar:**

- **Form:** each bar's section and chord, and its energy (the section's, scaled by the flight's intensity).
- **Drums:** six styles (four-on-the-floor, half-time, break, epic, pulse, tribal) plus distant booms. Fills come
  before a stronger section, a crash and a boom at a drop, a riser at the end of a build.
- **Pitched parts:** sub bass (sub, pulse, octave, syncopated, drone, growl); held pads, organ and choir;
  arpeggios (up, up-down, cascade, random).
- **Ethereal guitar:** dotted-eighth arpeggios, swells, high harmonics.
- **Lead:** a two-bar motif, answered, landing on chord tones on the strong beats.
- **Variation:** another seed gives another melody.

**The instruments, all synthesized in Web Audio:**

- **Drums:** kick with its click, snare, clap, hats, shaker, toms, taiko boom, crash, riser.
- **Bass:** sub bass and its growl.
- **Pads:** supersaw, warm analog, glass.
- **Arpeggio:** pluck, FM bell, glass.
- **Leads:** saw and soft.
- **Ethereal guitar:** Karplus–Strong strings, chorused, plucked, swelled or as harmonics.
- **Organ:** the Interstellar organ's drawbars, as one wave.
- **Choir:** formants.

**The engine's mixer and effects:**

- one bus per layer, with level, mute, solo and meter;
- sidechain ducking (the kick pumps the sub, the pads and the arpeggio);
- reverbs (hall, plate, cathedral) from impulse responses made here;
- a ping-pong delay on the beat;
- a glue compressor, a limiter, and the spectrum.

**The music system:**

- **Modes:**
  - **Moments** (the default, silence otherwise): lift-off, re-entry, final, wormhole, Gargantua, Miller, docking,
    low pass.
  - **Adaptive:** the moments plus a theme by context (orbit, deep space, in the air, landed, on foot).
  - **Playlist.**
  - **Off.**
- **Intensity:** from the flight (engine, plasma, Mach, ground proximity, load, alarm) or set by hand.
- **Preferences:** kept in the browser (`kerr.music`).

**The panel:**

- **Now playing:** theme, why it plays, section, bar and beat, BPM, chord, energy, intensity, live spectrum.
- **Transport:** previous, listen or stop, next, and back to the game's choice.
- **Mode, intensity, variation, volume.**
- **Theme cards:** click to listen; a checkbox for the playlist.
- **Mixer:** fader, mute, solo and meter for 8 layers, plus reverb, delay, sidechain and master.
- **Which theme when:** 13 cues.
- **Crossfade time, playlist length, defaults.**

### The themes

| Theme | Plays at | Tempo, key | Band |
| --- | --- | --- | --- |
| Event Horizon | Gargantua | 60, A minor | organ, sub drone, guitar swells, choir, booms |
| Ascent | lift-off | 124, D Lydian | four-on-the-floor, octave bass, supersaws, pluck arpeggio, saw lead, guitar arpeggio |
| Re-entry Fire | re-entry | 92, D Phrygian | tribal toms and taiko, growl, choir, bells |
| Final Approach | final | 100, F Lydian | soft pulse, sub, glass pads, guitar arpeggio, soft lead |
| Through the Throat | wormhole | 140, E minor | half-time, syncopated sub, supersaws, cascade, lead, choir, harmonics |
| Miller's Tide | Miller | 48 (1.25 s tick), A minor | the tick, organ, drone, guitar swells, booms |
| Orbit Drift | in orbit (adaptive) | 76, B Dorian | pulse, sub, glass pads, bells, guitar arpeggio |
| Low Pass | low pass | 118, A minor | synthwave drums, octave bass, supersaws, saw lead |
| Soft Capture | docking | 84, G minor | pulse hats, syncopated sub, bells, harmonics |
| Deep Space | deep space (adaptive) | 64, C♯ minor | choir, warm pads, drone, swells, booms |
| Endurance | in the air (adaptive) | 96, E minor | epic drums, octave bass, organ, supersaws, lead, choir |
| New Worlds | landed, on foot (adaptive) | 90, D Mixolydian | break with swing, pulse bass, guitar arpeggio, soft lead |

### Checks

- **Unit tests:**
  - `tests/music-composer.test.ts`: all 12 themes over 96 bars at three intensities. Every note is in time, in
    range and in the mode. The band builds with the energy, fills, risers, crashes and booms appear, the output is
    deterministic, and chord names are right.
  - `tests/score.test.ts`: the moments, the contexts, the intensity.
- **Offline render** (`bun scripts/render-music.ts remote-results/music --secs 60`): each theme's peak (no clipping
  past −0.1 dBFS), RMS and sub level. "Through the Throat" first rendered 40 s of music in 68 s in the container,
  then in about 40 s after the node optimisations (organ as one wave, a shared filter per pad and choir chord).
- **e2e for the Macs:** `tests/e2e/music-panel.e2e.test.ts` (the panel, listening, the mixer, all themes) and the
  existing `tests/e2e/music.e2e.test.ts`.

## Tests to run on the Macs (manual)

1. **Each theme.** Toolbar › Music, click each card. Listen for:
   - the sub's weight;
   - the drums' groove and the sidechain pumping;
   - the ethereal guitar's delay tails;
   - no crackle (audio thread overload). Watch Ascent, Through the Throat and Endurance, the heaviest.
2. **Intensity.** Move the slider from 0 to 1: the band thins out to pads and guitar, then fills up to lead and
   16th hats.
3. **Another melody.** The lead and the arpeggio change; the original comes back with Original.
4. **Mixer.** Solo the guitar, then the sub bass. Mute the drums. Raise the reverb and the delay. Reload the page:
   the settings are kept.
5. **Moments.** Take off with U: Ascent. Re-entry: Re-entry Fire. Final: Final Approach. Dock with B: Soft Capture.
   Fly a low pass at 300 m: Low Pass. Each change waits for the bar and crossfades.
6. **Adaptive.** In orbit: Orbit Drift. Interplanetary transfer: Deep Space. On foot (⇧K): New Worlds.
7. **Miller.** The tick every 1.25 s, in time with the theme (48 BPM, a beat every 1.25 s).
8. **iPad / Windows.** CPU load with the most demanding theme playing.
