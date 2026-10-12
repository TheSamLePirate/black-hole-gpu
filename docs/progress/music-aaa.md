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

## The orchestral pass: Hans Zimmer, John Williams, Max Richter

The request: every theme in Hans Zimmer's or John Williams's manner, and one like Max Richter's *On the Nature of
Daylight*; less of the 80s–90s; better synths; the pieces taken up as well as possible.

**What "taken up" means here.** The films' melodies are protected works: the game does not transcribe them. Each
theme is the game's own, written in the composer's manner:
- **Zimmer:** the pipe organ and its pedal, minimal ostinatos, the ticking clock, braams, taikos, the rising Shepard
  tone, the choir, suspended chords.
- **Williams:** heroic brass melodies with their leaps, the Lydian brightness, the march's snare and timpani, the
  strings' sixteenths, the fanfare's triplets, the harp's glissandi, the celesta.
- **Richter:** a string elegy — a slow loop of chords, the viola's long melody, the violins over it later, the cellos
  under, no percussion.

### What changed

| Part | What it is now |
| --- | --- |
| Themes (`themes.ts`) | The same 12 ids (preferences, cues and tests unchanged). Each has its manner, its orchestra and its **written melody**: phrases in scale degrees, fitted to its chords (≥ 80 % chord tones on the strong beats, tested). |
| Composer (`composer.ts`) | The orchestra by energy: strings and organ first; then basses, harp and celesta, choir, ostinato, percussion, melody, brass, braams, the full percussion, the fanfare; then the melody doubled an octave away. Before a stronger section: a snare roll (march, action) or a timpani roll. At a build's end: a suspended cymbal swelling. At a drop: a clash, a boom and the timpani. A variation ornaments the written melody (neighbour notes, passing notes); it no longer invents a new one. |
| Instruments (`instruments.ts`) | No more kick, hats, clap, supersaws, plucks, saw leads, ethereal guitar or sidechain pumping. See below. |
| Engine (`engine.ts`) | One bus per orchestral section. No ducking. The glue compressor is gentle (orchestral dynamics kept). Reverbs: a 3.2 s hall, a 7 s cathedral, a 2.2 s plate. The delay only touches the harp and the celesta, lightly. |
| Panel (`musicpanel.ts`) | Each theme shows its manner. The mixer lists the orchestra's sections. The sidechain fader is gone. |
| Preferences | Kept ones from the old band (drums, guitar, pump) are dropped on load. |

**The instruments:**

- **Strings:** an ensemble of bows per note (3 voices, a few cents and milliseconds apart), a vibrato that comes in
  late, the bow's noise at the attack, the body's resonances (air ~280 Hz, bridge ~2.8 kHz). Variants:
  - held chords, tremolo;
  - solo lines: violins, viola, cello, contrabass;
  - the elegy's long bows that swell and ease.
- **Brass:**
  - a rich wave whose filter opens with the breath, a scoop into the pitch, a soft saturation;
  - horns, horn chords, trumpets;
  - the braam: low brass cluster, distorted, a sub under it.
- **Rendered once per note, then played back:**
  - piano: inharmonic partials, two strings beating, double decay, three hammer layers;
  - celesta;
  - timpani: the membrane's modes, the pitch settling, the mallet;
  - harp and pizzicato: Karplus–Strong;
  - spiccato;
  - the fanfare's brass stabs;
  - the organ's sixteenths;
  - taikos, toms, bass drum, snare.
- **Pipe organ:**
  - principal chorus ranks as one wave, a second rank detuned (the pipes' beating);
  - the pipes' chiff, the swell box, a 32' pedal;
  - a tremulant for the organ melody.
- **Others:**
  - choir: "ah" or "oo" formants, three singers a voice;
  - flute: breath and vibrato;
  - Shepard tone: rising two semitones a bar, seamless;
  - suspended cymbal, clash, snare roll, timpani roll, the clock's tick.

**The themes:**

| Theme | Manner | Plays at | Tempo, key | Orchestra |
| --- | --- | --- | --- | --- |
| Event Horizon | Zimmer | Gargantua | 60, A minor | organ melody and chords, 32' pedal, organ pendulum, high strings, horns, choir, booms |
| Ascent | Williams | lift-off | 112, D Lydian | trumpet melody over horns, string sixteenths, march (snare, bass drum, timpani), fanfare, harp glissandi |
| Re-entry Fire | Zimmer | re-entry | 92, D Phrygian | braams, taikos, low strings' eighths, tremolo, horn and cello half-step motif, choir |
| Final Approach | Williams | final | 96, F Lydian | horn line doubled by violins, held strings, harp arpeggios, celesta, timpani |
| Through the Throat | Zimmer | wormhole | 120, E minor | Shepard tone, organ sixteenths, high violins, horns, braams, choir, taikos |
| Miller's Tide | Zimmer | Miller | 48, A minor | the 1.25 s tick, organ and pedal, strings, horns, braams, choir "oo", booms |
| Earthlight | Richter | in orbit | 54, F minor | strings alone: viola melody, violins over it, cellos and basses |
| Low Pass | Williams | low pass | 138, A harmonic minor | trumpet fanfare doubled by horns, stabs, string sixteenths, action toms and taikos |
| Soft Capture | Zimmer | docking | 96, G minor | organ sixteenths building, clock eighths, strings, horn line |
| Deep Space | Zimmer | deep space | 64, C♯ minor | sparse piano, organ, choir "oo", low strings, heartbeat |
| Endurance | Zimmer and Williams | in the air | 96, E minor | horn melody doubled by trumpets, organ, string eighths, taikos, braams, choir |
| New Worlds | Williams | landed, on foot | 84, D Lydian | flute and violins, celesta, harp, held strings, timpani |

### Checks

- **Unit tests (`tests/music-composer.test.ts`):**
  - three manners present;
  - each phrase is whole bars, fitted to its progression, with ≥ 80 % chord tones on the strong beats;
  - 96 bars at three intensities: notes in time, in range and in the mode, all instruments orchestral;
  - no synth-pop instrument left;
  - the elegy uses strings alone;
  - Williams's march, fanfare and glissando; Zimmer's organ, pedal, braams and Shepard tone;
  - the roll, the cymbal swell, the drop's hits;
  - deterministic; variations ornament the melody.
- **Offline render (60 s per theme, intensity rising then easing):**
  - all 12 pass, peaks −0.8 to −2 dBFS, RMS −11 to −17 dBFS;
  - section balance per stem: the melody leads (about −20 dB), percussion about −18 dB;
  - cost in the container: "Through the Throat" renders 40 s of music in 40.7 s, against 37.5 s for the old band.
    The short notes (spiccato, stabs, organ sixteenths, drums) are rendered once per note, and the slow filters
    are k-rate.

### Tests to run on the Macs (manual)

1. **Each theme**, from Toolbar › Music. Listen for:
   - the strings' ensemble (no "synth pad"), the horns opening up as they get louder;
   - the organ's chiff and size, the timpani's pitch;
   - no crackle.
2. **Earthlight:** strings only. The viola's melody first; the violins join it in the later sections.
3. **Ascent and Low Pass:** the march and the fanfare's triplets at full intensity; the harp glissando into each
   section.
4. **Through the Throat:** the Shepard tone never seems to stop rising.
5. **Intensity 0 → 1:** strings and organ alone, then the percussion, the melody, the brass, the doubling.
6. **Another melody:** the same theme, its melody ornamented otherwise.
7. **A saved mixer from before:** reload; no stale "Drums" or "Guitar" mute is left.
8. **iPad:** CPU load with Through the Throat and Low Pass.

