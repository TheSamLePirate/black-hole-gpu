# The e2e catalogue

Every e2e file (`tests/e2e/*.e2e.test.ts`), by theme: what it proves, the scene it boots, its usual time on kerr-mini, what it needs beyond Chrome and the production server. Guide: [E2E.md](E2E.md). Times: the sum of the tests' own times in the last full run (2026-10-09, 58 files, 1137 s wall); a file's boot (about 5–15 s) comes on top. `bun run e2e --each` measures whole files. `?`: not in that run. A new e2e file gets its row here.

### Harness & startup

| file | what it proves | scene(s) booted | ~s on the mini | needs |
|---|---|---|---|---|
| harness.e2e.test.ts | A hung page fails at its time limit, a dead Chrome fails every call at once, the Chrome lock is released with it. | none (raw Chrome via `lib/cdp.ts`) | 4 | — |
| bh-api.e2e.test.ts | Every member of `__bh` and of its namespaces, read live, has its entry in docs/BH-API.md. | game:artemis | 3 | — |
| gpu-startup.e2e.test.ts | WebGPU startup, quality-LUT and adaptive-kernel fallbacks, device loss at init: diagnostics shown, never an endless splash. | Earth low orbit (Amazon) and other scenes; 320×240 and 640×480; fault `initScript`s | 69 | fault injection in page (no key) |
| gpu-recovery.e2e.test.ts | After a simulated GPU device loss the renderer returns on a new device and the flight goes on; a third loss in a minute gives up. | game:artemis, 1280×800 | 4 | simulated loss (`__bh.gpu.lose()`) |
| reload.e2e.test.ts | Cold and warm reloads both complete the GPU image with no GPU or console errors. | game:artemis | 5 | — |
| first-image-downloads.e2e.test.ts | The first image no longer waits for Earth's maps or JUP365; Jupiter still waits for JUP365 before placement. | Io: Jupiter in the sky; Ranger: approaching Gargantua; 640×400 | 9 | — |
| title.e2e.test.ts | Title screen: opens at launch with time held, keyboard and click entries, Continue only with a saved flight. | default (title) | 2 | — |
| pad.e2e.test.ts | A standard-mapping gamepad walks the menus (D-pad, A, B, Start) in the title screen and in a mission. | default | 2 | simulated `navigator.getGamepads` |
| prefs.e2e.test.ts | Player settings survive a reload and a scene change, and a loaded save leaves them alone (saves carry none). | game:artemis | 3 | — |

### Flight & autopilots

| file | what it proves | scene(s) booted | ~s on the mini | needs |
|---|---|---|---|---|
| smoke.e2e.test.ts | The app played as a player: real keys and clicks, hints, radial wheel, toasts, map, pause menu, saves, master caution. | game:artemis | 18 | — |
| golden.e2e.test.ts | Four reference flights at fixed steps end on their recorded state; a refactor of the flight code must fly the same. | default; flights entry-glide-edwards, moon-takeoff, iss-autodock, orbit-retro-hold | 2 | `UPDATE=1` re-records `golden/flights.json` (after a physics change, on purpose) |
| rates.e2e.test.ts | Reference flights end within metres at 30 and 120 steps/s, and a flight run twice in a row ends the same (nothing carried over). | default (reference flights) | 19 | — |
| spectator.e2e.test.ts | The spectator camera (F3) moves round the ship, which keeps its orbit; a ship landed on the Moon keeps its ground streamed. | Earth: the Blue Marble | 20 | — |
| dock-undock.e2e.test.ts | Let go at once of a docked craft: it leaves on the springs and does not bounce back into the port. | game:artemis | 6 | — |
| assist.e2e.test.ts | Assistants (C0) work out the commands and leave the ship to the pilot; the hub card's button gives control back; an alert explains itself. | Earth: the Blue Marble | 5 | — |
| assist-approach.e2e.test.ts | Approach assistant: closing rate against the braking curve; handed over it closes on its curve; ORBIT flies the target's orbit. | Earth: the Blue Marble | 7 | — |
| assist-burn.e2e.test.ts | A burn flown by hand, assisted: planned at apoapsis, Δv followed, cut at the cue, circular orbit reached. | Earth: the Blue Marble | 41 | — |
| assist-climb.e2e.test.ts | Take-off assistant: director angle and heading, gravity-turn countdown; handed over, it climbs on its optimum, max-Q passed. | Earth: the Blue Marble (from the Cape) | 50 | — |
| assist-dock.e2e.test.ts | Docking assistant: the card says what the docking autopilot would do and why; handed over, it enters the corridor and counts contact. | Earth: docking to the ISS | 54 | — |
| assist-entry.e2e.test.ts | Entry assistant in the plane law: the pilot follows the ring hypersonic (the wing's stall limit), then glides to Edwards as the autopilot would. | game:artemis, 1440×900 | 3 | stepped at fixed steps |
| assist-handover.e2e.test.ts | Auto ⇄ assisted handovers for every autopilot: throttle carried over, director on and off, the card's own button. | Earth: the Blue Marble, plus set-ups by game tools (Cape, Moon, orbit, Kennedy) | 22 | — |

### Landing & ground

| file | what it proves | scene(s) booted | ~s on the mini | needs |
|---|---|---|---|---|
| landing.e2e.test.ts | Entry autopilot glides from 80 km onto Edwards: touchdown under 2 m/s, rollout stops on the runway, in still and light wind. | game:artemis | 11 | fixed steps; Earth heights in first |
| runway-wind.e2e.test.ts | In a 5 m/s wind from 040° the glide takes runway 04, the far end, a head wind, and lands on its axis. | game:artemis | 4 | — |
| approach-charts.e2e.test.ts | Runway 22's chart on the tablet with its fixes ahead; a TOGA missed approach flown, then a second approach landed. | game:artemis, 1440×900 | 14 | `SHOT=` optional screenshot path |
| gear.e2e.test.ts | Gear commanded: lowered in 8 s and drawn coming down, locked on the ground, belly landing with gear up jams, alarm low and slow. | game:artemis, 1280×800 | 7 | fixed steps |
| callouts.e2e.test.ts | Landing callouts in order (radio heights, minimums), never "sink rate" or "pull up"; tower clearance and "wheels stop". | game:artemis, 1280×800 | 20 | fixed steps (loop frames between calls) |
| assist-final.e2e.test.ts | Final flown by hand on Kennedy with the glide autopilot let go: PAPI, gates, glide error and flare countdown stay on the HUD. | Earth: the Blue Marble | 10 | — |
| assist-descent.e2e.test.ts | Vertical descent over the Moon flown by hand (hold let go); descent rate against the braking curve; assisted landing. | Earth: the Blue Marble (Moon) | 1 | — |

### Cockpit & HUD

| file | what it proves | scene(s) booted | ~s on the mini | needs |
|---|---|---|---|---|
| cockpit.e2e.test.ts | Cabin controls worked by real pointer events: hover lights and tips, SAS, flaps, air brake, cabin knob, switches, screen tabs, GEAR, NIGHT. | game:artemis, 1440×900 | 16 | CDP mouse events |
| cockpit-flight.e2e.test.ts | A glide to Edwards flown only by panel clicks (ENTRY, AP OFF, GEAR, FLAPS, ENTRY): landed on its wheels. | game:artemis, 1440×900 | 14 | fixed steps between clicks |
| hotas.e2e.test.ts | Three simulated Thrustmaster devices: stick roll, throttle lever pick-up, buttons, toe brakes, known profiles, controllers screen, vibrations. | game:artemis, 1280×800 | 9 | simulated gamepads in page (no real device) |
| hotas-flight.e2e.test.ts | Flight from 25 km out at 180 m/s with stick, lever and director, a climb, a banked turn, down to the runway. | game:artemis, 1280×800 | 8 | simulated gamepads; whole flight stepped |
| hud-layout.e2e.test.ts | HUD panels and canvas instruments never overlap, in every HUD-gallery flight state at 1440×900. | game:artemis, 1440×900, plus `tests/hud/states/` | 25 | `HUD_BOXES=1` prints the boxes (optional) |
| hub-card.e2e.test.ts | Hub card rows and trend arrows alike for every autopilot; short windows fold the long take-off card's graph away. | game:artemis, 1440×900 | 7 | — |
| hub-graph.e2e.test.ts | The hub graph opened large by a real click, its pointer readout; Escape closes it and the autopilot keeps flying. | game:artemis, 1440×900 | 1 | — |
| hub-warp.e2e.test.ts | The hub warp button in auto and assisted entry keeps the user's warp under changing guidance limits. | Earth: the Blue Marble, 1280×900 | 8 | — |
| report.e2e.test.ts | Flight report graded A–F after a landing and a docking; the Lander is graded on its site; Escape closes it; a load closes it. | game:artemis, 1440×900 | 84 | — |
| telemetry.e2e.test.ts | Telemetry recorder fills while flying, the TELEMETRY page draws curves, a curve chosen by click, CSV export. | game:artemis, 1440×900 | 2 | — |

### Map & UI

| file | what it proves | scene(s) booted | ~s on the mini | needs |
|---|---|---|---|---|
| a11y.e2e.test.ts | Controls named for screen readers, dialogs announced, no invisible layer over the view, in English and French. | game:artemis (en, then fr) | 3 | — |
| s5.e2e.test.ts | Text readable over the bright disc (WCAG AA), no leaks over 30 openings, layouts at every size, unlabelled-control ratchet. | game:artemis | 31 | `RATCHET=update` rewrites the ratchet |
| touch.e2e.test.ts | The map under fingers: pinch zooms, two-finger pan without turning the view, 44 px controls. | game:artemis | 5 | touch emulation |
| wormhole-map.e2e.test.ts | The tunnel map stays populated through the wormhole, also on a narrow screen with failing GPU pipelines. | Earth: the Blue Marble (1280×900 and default) | 18 | — |
| place.e2e.test.ts | The Place panel from the HUD: asked first, then beside Mars at rest with the hover autopilot; Escape closes it. | game:artemis | 2 | — |
| place-docked.e2e.test.ts | A craft docked to the station, placed elsewhere, lets go of its links and goes. | Earth: docking to the ISS, 1000×700 | ? | — |
| time.e2e.test.ts | Date and time panel by clicks: thirty days on the ship keeps its orbit; back to the start; a date chosen in UTC. | Earth: the Blue Marble | 2 | — |
| eclipses.e2e.test.ts | Eclipse calculator by clicks: the 12 Aug 2026 total eclipse from Paris, "Go and see", the moons tab. | game:artemis, 1440×900, lang fr | ? | — |
| photo-fps.e2e.test.ts | Photo mode left by its own button, its bar hidden and brought back; frame rate shown on request in Settings › Render. | Earth: the Blue Marble, 1280×800 | ? | — |

### Sky & rendering

| file | what it proves | scene(s) booted | ~s on the mini | needs |
|---|---|---|---|---|
| near-air.e2e.test.ts | Gargantua worlds' air (Miller, Mann, Edmunds) as the tracer draws it: zenith transmittance and sky lit on the GPU. | default, 320×240 | 4 | WebGPU in Chrome; light stubbed in shader |
| planet-detail.e2e.test.ts | The real shader's footprint helpers run on the GPU rather than a TS copy of their arithmetic. | Kerr a=0.94 near edge-on, 320×240 | 13 | WebGPU |
| ellipsoid.e2e.test.ts | GPU geometry, moonlight and optical lengths keep their contracts; the polar renderer keeps WGS84 with no Earth textures. | default and "Earth: total eclipse over Burgos", 320×240 | 12 | WebGPU; reads `src/shaders/trace.wgsl` |
| eclipse-atmosphere.e2e.test.ts | Burgos atmospheric eclipse uses physical axes through WGS84 and spherical march spaces, checked on the GPU. | Kerr a=0.94 near edge-on, 320×240 | 4 | WebGPU; reads `assets/ephemeris/de440.bin` |
| metar.e2e.test.ts | Real weather: a METAR (page stand-in, fog) at Le Bourget; Open-Meteo and GIBS stand-ins at Burgos; 2067 falls back to a fixed map. | game:artemis | 2 | network answers faked in page; no network needed |
| weather-panel.e2e.test.ts | Weather panel: preset, flight category, vertical cut, save; the planisphere layer; weather in the image, rain, Mars dust. | game:artemis, 1440×900 | 17 | — |
| rain.e2e.test.ts | Rain at Le Bourget: frozen when paused, falling when running; heard on the canopy and outside. | game:artemis, 960×600 | ? | — |
| worlds.e2e.test.ts | Gargantua's six worlds' scenes each flown 5 s at fixed steps; the Ranger is not broken at load; no sea crash. | game:artemis, then six world scenes (Miller, Mann, Edmunds) | 1 | fixed steps |
| multiexposure.e2e.test.ts | Photo mode's analemma and the eclipse multiple exposure, by real clicks; composite shown, game restored. | game:artemis, 1440×900, lang fr | ? | `tiles: true` (Earth tiles streamed) |

### Audio & voices

| file | what it proves | scene(s) booted | ~s on the mini | needs |
|---|---|---|---|---|
| audio-space.e2e.test.ts | Engine, thrusters, cabin, ground, station, Mach boom and Doppler placed in the sound's space, metered at the output. | game:artemis, 1280×800 | 85 | `--mute-audio` (metered at the graph, not the speakers) |
| voice.e2e.test.ts | Voices say lines with subtitles and speaker; an urgent line cuts the one being said; subtitles off shows none. | game:artemis, 1280×800 | 6 | voice off in the test (reading-time rhythm) |
| music.e2e.test.ts | The score plays its piece and tick on Miller, silence when music is off, none in orbit round Earth. | Miller: Gargantua over the sea, 1280×800 | 14 | — |
| tars-voice.e2e.test.ts | TARS's robot voice is synthesised, subtitled, queued until its end, and cut at once by a more urgent line. | game:artemis, 1280×800 | 6 | — |

### TARS

| file | what it proves | scene(s) booted | ~s on the mini | needs |
|---|---|---|---|---|
| tars.e2e.test.ts | F6 opens his field, a typed question gets an answer from the flight state; "honesty 70" sets his setting; typing does not fly. | game:artemis, 1280×800 | 1 | — |
| tars-online.e2e.test.ts | OpenRouter with the network simulated: a key pasted and kept out of exports, a GLM answer with its cost, the sign-in popup callback. | game:artemis, 1280×800 | 1 | openrouter.ai answered by the page (no key) |
| tars-agent.e2e.test.ts | TARS the agent with a scripted model: calls run on the game, a refused setting corrected, Escape stops a turn, memory cleared, F6 speaks. | game:artemis (booted twice) | ? | scripted model in page (no key); browser recognition faked |
| tars-agent-live.e2e.test.ts | Live OpenRouter: French orders in his field run on the game, judged by what the game reads back; memory recalled. | game:artemis | ? | `OPENROUTER_API_KEY` (sk-or-…) and `TARS_LIVE=1`; a few tenths of a cent per run |
| tars-eval.e2e.test.ts | Live TARS directs a Moon landing from a hover, a docking, the interface, a teleport undone, a plan proposed then accepted; judged by game state; per-turn JSON in `remote-results/`. | per-task scenes (Moon, ISS, Earth), game:artemis boot | ? | `OPENROUTER_API_KEY`, `TARS_LIVE=1`; `TARS_LONG=1` for the long flights; `TARS_MODEL=`; `--timeout 7200000`; about a cent per run |
| tars-ear.e2e.test.ts | Chrome's fake microphone plays a French phrase; the relay sends it to Deepgram; the words show as spoken; asked on release. | game:artemis, 1280×800 (production server with the relay) | ? | `DEEPGRAM_API_KEY` in `.env`; fake mic file `tests/data/tars-phrase-fr.wav`; `AudioServiceSandbox` off |

### Saves, PWA, misc

| file | what it proves | scene(s) booted | ~s on the mini | needs |
|---|---|---|---|---|
| saves.e2e.test.ts | A saved flight reloads as it was whatever flew before: the craft, its docks, the entry site, a fall saved after a burn. | default (HUD-gallery states) | 1 | — |
| pwa.e2e.test.ts | Service worker registers and caches the shell and manifest; the network cut reloads from cache and the scene plays; tiles kept under budget. | Earth: the Blue Marble, service worker and tiles | 6 | `sw=1`; `tiles: true`; network cut in the test |

## Slow (> 60 s)

On the m10 log (sum of test times per file):

- audio-space.e2e.test.ts: 85 s (9 tests)
- report.e2e.test.ts: 84 s (3 tests)
- gpu-startup.e2e.test.ts: 69 s (16 tests)

Near the line (54 s to 50 s): assist-dock (54 s; 69 s in the earlier `e2e-merge` log), assist-climb (50 s).

## Skipped unless a key/env is set

Every file runs only with `E2E=1` (the `bun run e2e` script sets it). Beyond that:

- `tars-agent-live.e2e.test.ts`: needs `TARS_LIVE=1` and an `OPENROUTER_API_KEY` starting `sk-or-` (`.env`); skipped otherwise.
- `tars-eval.e2e.test.ts`: needs `TARS_LIVE=1` and the same key; its two long-flight tests also need `TARS_LONG=1`; `TARS_MODEL` picks the model (default `z-ai/glm-5.3-flash`).
- `tars-ear.e2e.test.ts`: needs `DEEPGRAM_API_KEY` (`.env`) in addition to `E2E=1`; skipped otherwise.
- `golden.e2e.test.ts`: `UPDATE=1` re-records the golden states; without it, the recorded ones are checked.
- `s5.e2e.test.ts`: `RATCHET=update` rewrites the unlabelled-control ratchet.
- `hud-layout.e2e.test.ts`: `HUD_BOXES=1` prints the measured boxes; `approach-charts.e2e.test.ts`: `SHOT=<path>` saves a screenshot. Both optional.
