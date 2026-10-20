# The e2e catalogue

Every e2e file (`tests/e2e/*.e2e.test.ts`), by theme: what it proves, the scene it boots, its usual time on kerr-mini, what it needs beyond Chrome and the production server. Guide: [E2E.md](E2E.md). Times: the sum of the tests' own times in the last full run (2026-10-09, 58 files, 1137 s wall); a file's boot (about 5–15 s) comes on top. `bun run e2e --each` measures whole files. `?`: not in that run. A new e2e file gets its row here.

### Regional satellite ground

| file | what it proves | scene(s) booted | ~s on the mini | needs |
|---|---|---|---|---|
| earth-surface.e2e.test.ts | Both real Sentinel-2/WorldCover packs, region switch/release, airplane capture, realtime A/B timings at blocks 1 and 2, RGBA fallback, 16-texture adapter, unavailable class worker. Writes captures and perf JSON in remote-results/. Set SURFACE_LIVE_TERRAIN=1 to also load the real DEM. | Earth: the Blue Marble; regional camera views; Le Bourget glide | ~165 s locally with DEM | committed regional packs; native WebGPU for meaningful GPU timings |
| earth-scenery.e2e.test.ts | Live WorldCover/Sentinel-2 WMS + OpenStreetMap buildings, roads, water, bridges and rails in Paris, Cévennes, Tokyo and Sydney; captures after shader readiness and 60 profiled frames; image difference with/without cast shadows; high airplane mode; release and eight-storage-buffer fallback. | Earth: the Blue Marble; low, oblique geographic views | ~3–5 min locally, depends on network/compiler | live Terrascope, OpenFreeMap and Terrarium; native WebGPU |
| scenery-bench.e2e.test.ts | Calibrated, isolated comparisons with networks/volumes off, on without cast shadows, and on with cast shadows: identical satellite colour, terrain, camera, buffer and kernel; per-frame GPU trace medians and p10/p90 over 180 samples, seven blocks per place. | Cévennes and Tokyo | depends on initial kernel compilation | `SCENERY_BENCH=1`; run without other CPU/build jobs; native WebGPU and live tiles |

### Harness & startup

| file | what it proves | scene(s) booted | ~s on the mini | needs |
|---|---|---|---|---|
| crew-actions.e2e.test.ts | The crew's orders on the real simulator (docs/PLAN-CREW-ACTIONS.md): the crew console in a frame joined as instruments, its own buttons — configuration, the pilot's lock, the flight plan (menus, constraint, drag, direct), the MCP (AP, A/THR, selectors, LNAV, orbit), the flight computer beside the ISS (hold, a manoeuvre previewed), the F-35's weapons in a room's free fight (radar, weapon, decoys, a held shot). | game:artemis, Earth: docking to the ISS | ~20 s on kerr-mini (+ boot) | run on the mini when this Mac is loaded; captures remote-results/crew-actions-a*.png |
| crew.e2e.test.ts | Independent crew shell without WebGPU; mobile/tablet/landscape controls; real room and simulator telemetry; bidirectional WebRTC; multi-touch PTT, cancellation and permission races; instruments QR URL. | crew/ then game:artemis | ~95 s locally | fake microphone, same-Chrome second screen; captures remote-results/crew-*.png |
| harness.e2e.test.ts | A hung page fails at its time limit, a dead Chrome fails every call at once, the Chrome lock is released with it. | none (raw Chrome via `lib/cdp.ts`) | 4 | — |
| bh-api.e2e.test.ts | Every member of `__bh` and of its namespaces, read live, has its entry in docs/BH-API.md. | game:artemis | 3 | — |
| gpu-startup.e2e.test.ts | WebGPU startup, quality-LUT and adaptive-kernel fallbacks, device loss at init: diagnostics shown, never an endless splash. | Earth low orbit (Amazon) and other scenes; 320×240 and 640×480; fault `initScript`s | 69 | fault injection in page (no key) |
| gpu-recovery.e2e.test.ts | After a simulated GPU device loss the renderer returns on a new device and the flight goes on; a third loss in a minute gives up. | game:artemis, 1280×800 | 4 | simulated loss (`__bh.gpu.lose()`) |
| reload.e2e.test.ts | Cold and warm reloads both complete the GPU image with no GPU or console errors. | game:artemis | 5 | — |
| first-image-downloads.e2e.test.ts | The first image no longer waits for Earth's maps or JUP365; Jupiter still waits for JUP365 before placement. | Io: Jupiter in the sky; Ranger: approaching Gargantua; 640×400 | 9 | — |
| intro.e2e.test.ts | The intro (PLAN-TITRE-AAA E1). Played whole: the studio, the name, the emblem, the WebGL2 background drawn by its Worker, the orb's state and its detail. The title, once it opens, takes over the name. The intro lifts only after the first image and the sky. A key passes it. The second time it plays its short version, with no console error. Use `#slowboot` to hold it; `SHOTS=1` writes its moments to docs/progress/title-aaa. | default (title), `fullIntro` | ~45 s on this Mac | — |
| boot-time.e2e.test.ts | The boot's timeline from `__bh.boot()` (PLAN-TITRE-AAA E0). RUNS (3) runs, each a cold start on a fresh profile then a warm reload: when each stage is reached, the first image, the main thread's long tasks and frame gaps. With NET=Mbit/s, RUNS visits over a throttled link with the cache off, each in its own Chrome; FIRST=1 with no flight saved, otherwise a returning player. It lists the downloads begun before the splash lifted. `#slowboot=10` holds the graphics 10 s and the title still opens. OUT=file.json keeps the figures. | default (title) | ~35 s on this Mac (+ ~17 s with NET) | — |
| title-plane.e2e.test.ts | By plane on the title (PLAN-TITRE-AAA E4). Its four tabs by Q/E. The free flight is set by the keys (the hour by → on its row, kept for the next visit) and the airfield found by "bourget". A mission's briefing opens from Combat. The flight is launched: the F-35B at the field chosen. A challenge is launched from its tab. `SHOTS=1` writes its screens. | default (title) | ~60 s on kerr-mini | — |
| title-ship.e2e.test.ts | By ship on the title (PLAN-TITRE-AAA E5). The hangar: a tab per craft by Q/E, its sheet and its turntable. The Endurance's grounds shown closed (a click launches nothing, the preview says why). The Ranger's missions with their picture, difficulty and length. Real launches: the Lander landed on the Moon, the Endurance in Martian orbit, the Ranger on Gargantua's side of the wormhole. The mission selector's labels left and whole. `SHOTS=1` writes its screens. | default (title) | ~2 min on kerr-mini | — |
| title-foot.e2e.test.ts | On foot and the free camera on the title (PLAN-TITRE-AAA E6). The worlds by Q/E (the weather only on the Earth), the place pinned on the planisphere, the hour by →. A place found by a search ("eiffel"; the addresses logged when the service answers). A walk on the Moon at noon of its own day (the probe's Sun cosine > 0.9), then at night (≈ 0). The free camera's gallery by Q/E, a scene launched, the free camera in it. `SHOTS=1` writes its screens. | default (title) | ~1 min on kerr-mini | address search needs the network |
| title-more.e2e.test.ts | More… and the credits on the title (PLAN-TITRE-AAA E7). More…'s groups and the language's row; Load a game, a screen of its own; How to play, its page in a new tab (window.open caught); the Kerr Bench confirmed first, cancelled. The credits roll by themselves, Page Down takes them over, every section there (the landscapes' photographers among them), Escape back to More…. `SHOTS=1` writes its screens. | default (title) | ~30 s | — |
| pause.e2e.test.ts | The pause menu (PLAN-TITRE-AAA E8). Its column: a short first level, nothing past its box (finding 4), no diagnostic there (finding 5); the context beside (flight figures, time played, tip). A drawer opened by → and left by ← or Escape, the menu still open; the diagnostic in Settings ›. Save and Load as screens of their own. Change mode › By plane: the title's launch screen alone, its back the pause again. An air mission's objectives in the context. `SHOTS=1` writes its screens. | default (title, then low orbit) | ~1 min | — |
| settings.e2e.test.ts | The player's settings (PLAN-TITRE-AAA E9). Opened from the title: a row per setting, the one focused explained, → changing it at once, R resetting the tab. The tabs by Q/E, the quality preset by →. A risky setting (the render scale) back by itself after 15 s, kept when kept. The common search: a setting here, the hole's spin in the Lab, opened on it. From the pause: the Controls tab's keys screen, its back the settings, theirs the pause. `SHOTS=1` writes its screens. | default (title) | ~1 min | — |
| entry.e2e.test.ts | The way into the game (PLAN-TITRE-AAA E10). A launch from the title: the menu slides out, the black comes in, the launch runs under it, the black lifts, the HUD lights up — the veil's phases recorded in the page. A launch whose scene's tracer compiles (held 4 s by `__bh.entry.compile`): the scene loading screen with its picture, orb, stage and tip. The asset pill's orb. `SHOTS=1` writes its moments. | default (title, then low orbit) | ~1 min | — |
| menus-campaign.e2e.test.ts | The menus' campaign (PLAN-TITRE-AAA E11): one player's path by real events — the intro passed by a key; during #slowboot By plane › Free flight › Fly, the F-35B in its cockpit on the runway once the game is there; By ship › Lander › landed on the Moon; On foot › Earth › Monument Valley found by its name; Free camera › Gargantua; Continue; the pause by the keyboard and a page's own pad; a setting changed and found after a reload; a phone's screen with reduced motion. `SHOTS=1` writes FINAL-*. | default (title) | ~3 min | — |
| title.e2e.test.ts | The title screen (PLAN-TITRE-AAA E2). It opens at launch with the time held, and Escape is not the pause. The four cards are walked in 2D. A mode's screen picks the craft by Q/E; the craft's turntable turns, and Escape goes back to its card. A launch is chosen while the game still loads (`#slowboot=12`): the title is there before the renderer, the launch is kept and run once the game is, the ship is in low Earth orbit. From the pause, the title again, and Continue resumes. `SHOTS=1` writes its screens to docs/progress/title-aaa. | default (title) | ~60 s on this Mac | — |
| pad.e2e.test.ts | A standard-mapping gamepad walks the title's cards (D-pad ◀ ▶). A opens a mode and launches (by ship, low orbit), B goes back; in the game, Start pauses and B resumes. | default | 2 | simulated `navigator.getGamepads` |
| prefs.e2e.test.ts | Player settings survive a reload and a scene change, and a loaded save leaves them alone (saves carry none). | game:artemis | 3 | — |

### Flight & autopilots

| file | what it proves | scene(s) booted | ~s on the mini | needs |
|---|---|---|---|---|
| smoke.e2e.test.ts | The app played as a player: real keys and clicks, hints, radial wheel, toasts, map, pause menu, saves, master caution. | game:artemis | 18 | — |
| golden.e2e.test.ts | Four reference flights at fixed steps end on their recorded state; a refactor of the flight code must fly the same. | default; flights entry-glide-edwards, moon-takeoff, iss-autodock, orbit-retro-hold | 2 | `UPDATE=1` re-records `golden/flights.json` (after a physics change, on purpose) |
| school-demos.e2e.test.ts | Every flight-school demonstration watched whole, started by real clicks (school › card › Watch): the first flight's seven steps, the circuit, the landing and the ILS down to a stop at Edwards, Case I to a wire, the formation's minute, the intercept, the guns' kill, the ten figures. A watchdog every 2 s on `__bh.flight.school.state()`: never stalled 45 s, no step left at its time at most, no debrief, pause or craft-lost screen over it, no page error; a stall dumps the state and a view. `DEMOS=a,b` runs those only. | game:artemis (Alps, then each lesson's place) | ~25 min all (lessons ~16, figures ~6) | tiles |
| aar.e2e.test.ts | The air refuelling: TEXACO 11 set close by over the Mediterranean (6 000 m, light turbulence), the F-35B joined behind its right hose, cleared, the probe flown into the basket by the systems (auto), the fuel taken to full, back out, cleared to depart; the views (the tanker and its hose, pre-contact on the HUD, the contact outside and from the cockpit). | game:artemis, 1600×1000 | ~430 locally | — |
| net-wing-fight.e2e.test.ts | Two pages in a room: Ben joins Ana's wing by the wheel (Tab held › Patrouille › Ailier de Ana, real pointer; the wheel ≥ 520 px), Beside then the formation held 20 s; the free fight (F-35s in a room, no match): each the other's target, friendly fire on; Ana locks Ben (Tab) and fires an AIM-120 — down, her kill on both sheets, he flies again. | game:artemis ×2 | ~3 min | the room server (local) |
| rates.e2e.test.ts | Reference flights end within metres at 30 and 120 steps/s, and a flight run twice in a row ends the same (nothing carried over). | default (reference flights) | 19 | — |
| spectator.e2e.test.ts | The spectator camera (F3) moves round the ship, which keeps its orbit; a ship landed on the Moon keeps its ground streamed. | Earth: the Blue Marble | 20 | — |
| vaisseaux-x1.e2e.test.ts | The spacecraft's new controls (docs/PLAN-VAISSEAUX-AAA.md X0–X1), real input: the Assistance set in the settings panel (the SAS chip says MANUAL), ⇧X stops a tumble, ⇧9 the RCS translation mode (W moves the craft), ⇧8 station keeping near the ISS, B held at Waypoint 2 (20 m), ⇧O the mission plan of a lunar transfer (cleared from its button), the Lander's ground protection (caution, hover, the HUD alert), F7 + W the landing point designator. | game:artemis, Earth: docking to the ISS | ~3 min here, ~4 min on kerr-mini (+ boot) | — |
| vaisseaux-x5.e2e.test.ts | The spacecraft's wheel and pad (docs/PLAN-VAISSEAUX-AAA.md X5), real input: Tab held near the ISS opens the Ranger's wheel (eleven sectors, no aircraft entry), Autopilots ▸ Station keeping clicked keeps station; the Endurance's Systems ▸ shows its ring; a fake standard pad: A the SAS, D-pad ▲ prograde, L3 the RCS translation, Y held the wheel aimed by the right stick (A opens Holds ▸, B back, Y let go closes it). | game:artemis, Earth: docking to the ISS | ~20 s here (+ boot) | — |
| space-school.e2e.test.ts | The space flight school (docs/PLAN-VAISSEAUX-AAA.md X9), real clicks: the school opened in a spacecraft lists its fifteen space lessons first; the holds lesson's card, its demonstration — the scene set up, TARS flying every step — to its report (20.0 / 20). | game:artemis | ~1 min here (+ boot) | — |
| space-missions.e2e.test.ts | The spacecraft's missions (docs/PLAN-VAISSEAUX-AAA.md X11), real clicks: the panel (seven campaign chapters, only the first open; five library missions), the Moon landing flown from its card, a budget forced over → its debrief; a mission made in the editor (two objectives, a Δv budget) flown, its link copied and opened in a reloaded page. | game:artemis | ~1.5 min here (+ boot) | — |
| net-fleet.e2e.test.ts | The room's fleet of spacecraft (docs/PLAN-VAISSEAUX-AAA.md N1), two browsers: the Fleet tab lists Ana's Endurance and Ben's Ranger (where, Δv, range); Ben 180 m off closing → the proximity warning; Ana orders Ben to dock (real clicks), his card accepted → his docking autopilot on her craft, her panel says accepted. | game:artemis ×2 | ~1 min here (+ 2 boots) | — |
| net-share.e2e.test.ts | Sharing between docked spacecraft (PLAN-VAISSEAUX N2), two browsers: Ben docked to Ana's Endurance asks for power then oxygen (real clicks), her card accepted — his filled, hers lowered (reserve kept); her target and mission plan sent to him. | game:artemis ×2 | ~1 min here (+ 2 boots) | — |
| net-crew.e2e.test.ts | Aboard another's spacecraft (PLAN-VAISSEAUX N3), two browsers: Ben goes aboard Ana's Endurance from his docked Ranger, as her copilot holds prograde and spins her ring; asks for the controls, she accepts — he flies the Endurance from where it was, she rides with him, her old craft gone from his world. | game:artemis ×2 | ~1.5 min here (+ 2 boots) | — |
| net-board.e2e.test.ts | The room's challenges and board (PLAN-VAISSEAUX N4), two browsers: Ana proposes a challenge to the room (real clicks), Ben accepts — both at its start, ghosts to each other; their results told to the room, the Results tab ranks them. | game:artemis ×2 | ~1.5 min here (+ 2 boots) | — |
| net-coop.e2e.test.ts | A co-op mission with roles (PLAN-VAISSEAUX N5), two browsers: Ana proposes the Moon together as the Endurance (real clicks), Ben takes the Lander; Ana spins the ring up at the keyboard, Ben's eased — won on both screens; then Ben leaves: his role free. | game:artemis ×2 | ~1.5 min here (+ 2 boots) | — |
| net-time.e2e.test.ts | Time and the rest (PLAN-VAISSEAUX N6), three pages: Ben fires his engine 400 m off — Ana hears it; she asks for ×10 — held by Ben, burning; a crew screen gets Ben's craft in Ana's snapshot, the ORBIT view draws him. | game:artemis ×2 + crew | ~1 min here (+ 3 boots) | — |
| crew-space.e2e.test.ts | The crew console's two profiles (docs/PLAN-VAISSEAUX-AAA.md K2): a test client flies an F-35 then the Ranger in orbit in a real room; the console turns tactical (badge, MISSION AÉRIENNE first, no ORBIT) then spacecraft (badge, Δv and apsides tiles, its dashboard first, no radar), ORBIT clicked; the SYSTEM MAP (K3: its renderer, about the Earth, the Sun in the log scale, the prediction scrolled, Gargantua's side). E2E_SHOTS: the views. | crew page | ~15 s here (+ boot) | — |
| crew-stations.e2e.test.ts | The crew's stations and the light delay (docs/PLAN-VAISSEAUX-AAA.md K5): FIDO chosen in the lobby joins a real room; its call in the room; the pilot 2 s of light away — snapshots shown 2 s late, the badge, a message heard 2 s late; behind the wormhole the link cut — the badge, an order refused, a message recorded, delivered with its age once back. E2E_SHOTS: the views. | crew page | ~15 s here (+ boot) | — |
| crew-space-actions.e2e.test.ts | The spacecraft's crew orders on the real simulator (docs/PLAN-VAISSEAUX-AAA.md K6): the Ranger by the ISS in a room, the crew console in a frame joined as EECOM — a failure's checklist ticked from its Systems pop (the pilot's ticks the same), its action held back until then, given, fixed; station keeping from the Docking pop; the Moon taken for the target from the system map's menu; a burn moved two minutes along the orbit. | Earth: docking to the ISS | ~1 min here (+ boot) | — |
| crew-demo-space.e2e.test.ts | The crew demo room (scripts/crew-demo.ts --space, docs/PLAN-VAISSEAUX-AAA.md K7) against the test's server — the leader's F-35 and three scripted spacecraft — and the console WITHOUT WebGPU (CAPCOM): Cooper's system map on the canvas (the fallback), his failure's checklist ticked and its action given; Brand's ground view; Romilly by Gargantua, the ground's link cut. E2E_SHOTS: the views. | crew page + demo | ~1 min here (+ boot) | — |
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
| f35-pcd.e2e.test.ts | The F-35's panoramic display by real pointer events in its cockpit, flying (docs/PLAN-PCD-AAA.md): a title opens the pages' menu and SMS is chosen in it; the corner shows a side as one portal, then two; the AP page's button engages the autopilot, the altitude's + selects 100 m more; the display's CPU cost under 0.70 ms a frame (the one before Q1), no frame over 8 ms. | game:artemis, 1440×900, no tiles | 3 | CDP mouse events; the click's place found by the cockpit's own pick (renderer.ship.jetPick) |
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
| atlas.e2e.test.ts | The Atlas: F8 opens it; on Mars "olympus" found and the free camera put above Olympus Mons; on the Moon Apollo 11 walked to (the craft landed beside, mode on foot); TARS's atlas tool finds Mont Blanc; the pause menu's Atlas item. `ATLAS_LIVE=1`: an address through Photon. | Earth: the Blue Marble, 1440×900 | ? | live Photon with ATLAS_LIVE |
| sky-events.e2e.test.ts | The tripod and the sky's events: walking in Paris, ⇧T sets the tripod where one stands (free camera on the Earth's ground); ⇧F8 opens the sky's events (trails at once, eclipses from the worker); "Go there" sets the field; TARS's sky_events lists them and lives the analemma, stopped after three exposures, the stack offered; the game's time given back. | Earth: the Blue Marble, 1440×900 | ? | — |
| photo-video.e2e.test.ts | The photo mode's films: F4, the bar's video row films a one-second orbit draft (its progress shown), played in the preview with its length read back; TARS's video tool lists the shots, refuses the director's without a ship, films a live draft; the render dialog built with its draft and format. | Earth: the Blue Marble, 1440×900 | ? | WebCodecs (H.264, else VP9) |
| hud-kinds.e2e.test.ts | The ship's three HUDs: in orbit in the chase view the whole HUD, the Space kind and its orbit block; forced to Approach its radar altitude box; ⇧² cycles the kind; the cockpit and the film's view keep the warnings and the cards only; every view with "HUD in the views: everywhere"; the dorsal view whole. | game:artemis, 1440×900 | ? | — |
| modes.e2e.test.ts | The four modes and the top bar: the bar in every mode, its tab following `__bh.mode`; F1 puts the Ranger in, F3 the spectator and back, F4 the photo mode over the ship and Esc back to it; on foot out of a craft landed on the Moon (F2), the on-foot HUD (compass, place, craft distance, minimap zoom), TARS there (F6 opens his console, his state has the walker's place and the craft's distance), the free camera from the walker's view (F3), back on board (F1); the bar hidden and brought back by its handle with TARS in it; the offline capture converged on foot, in the free camera and in the ship (TARS's `capture`, 320×180, 16 spp), the pause menu's Capture item; TARS's `set_mode`. | Earth: the Blue Marble, 1440×900 | ? | — |
| a11y.e2e.test.ts | Controls named for screen readers, dialogs announced, no invisible layer over the view, in English and French. | game:artemis (en, then fr) | 3 | — |
| s5.e2e.test.ts | Text readable over the bright disc (WCAG AA), no leaks over 30 openings, layouts at every size, unlabelled-control ratchet. | game:artemis | 31 | `RATCHET=update` rewrites the ratchet |
| touch.e2e.test.ts | The map under fingers: pinch zooms, two-finger pan without turning the view, 44 px controls. | game:artemis | 5 | touch emulation |
| wormhole-map.e2e.test.ts | The tunnel map stays populated through the wormhole, also on a narrow screen with failing GPU pipelines. | Earth: the Blue Marble (1280×900 and default) | 18 | — |
| place.e2e.test.ts | The Place panel from the HUD: asked first, then beside Mars at rest with the hover autopilot; on foot — the ship landed and the astronaut out walking beside it (the Moon); Escape closes it. | game:artemis | 3 | — |
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
| music.e2e.test.ts | The score plays its theme and tick on Miller, silence when music is off, none in orbit round Earth. | Miller: Gargantua over the sea, 1280×800 | 14 | — |
| music-panel.e2e.test.ts | The music console: opened from the toolbar, a theme listened to and heard, its section and chord, the mixer kept in the browser, all twelve themes played without an error. Captures `music-panel.png`. | Earth: the Blue Marble, 1400×900 | 50 | — |
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

## Exploration planétaire

| file | what it proves | scene(s) booted | ~s here | needs |
|---|---|---|---|---|
| character.e2e.test.ts | Real skinned astronaut on Moon/Earth/Mars; Shift+K disembark/board, save reload, local-gravity jump; Earth grass from actual WorldCover, roots bounded, no grass on Moon or in flight. Captures require satellite, terrain, scenery, render/lighting shaders and 120 settled frames; JSON readiness beside PNG. | Earth: the Blue Marble, 960×540 | ~50–90; cold network/compilation can take longer | live terrain/WorldCover/OSM for Earth capture; licensed astronaut assets in tree |
| character-aaa.e2e.test.ts | On foot as a game is judged: before the landed vessel the astronaut is drawn over its hull (screen patches with/without him and the ship) and stopped by it (10 s walked into it, never inside); lit by the vessel's light probe and reading its shadow map; per-world light from the probe (`characterLight()`: the Moon's shadow deepest, the Earth's softer, none at midnight); the jump with real Space keys (buffered on landing, the legs give, no gait in the air); after a 22 km teleport the settled frame never comes before the new place's scenery. Captures `character-aaa-*.png` with readiness JSON. | Earth: the Blue Marble (Moon landing; Moon/Mars/Cévennes/Paris on foot), 960×540 | ~4–8 min; cold network and kernel compilation longer | native WebGPU; live terrain/WorldCover/OSM for the Earth parts; licensed astronaut assets in tree |
| grass-aaa.e2e.test.ts | The living ground in real WorldCover places: a Cévennes meadow dense (>15 000 blades drawn, each level under its capacity), its GPU cost (blades' compute < 2.5 ms, draw < 4 ms, frame difference with/without < 5 ms at 1280×720); crops, reeds, scrub and forest floor where the raster has them round Le Bourget and the Cévennes; footprints from a real 3 s walk (>40 cells pressed) rising again after 20 s. Captures `grass-aaa-*.png` + readiness, measures in `grass-aaa-*.json`. | Earth: the Blue Marble, 1280×720 | ~6–12 min (network, kernels) | native WebGPU; live terrain/WorldCover/OSM; GPU timestamps for the cost |
| landscapes.e2e.test.ts | The exceptional landscapes beside their photographs: each `Earth: …` scene of `src/system/landscapes.ts` (camera, heading, hour and lens of a real Wikimedia Commons photo) loaded on the real ground — relief, scenery and lighting settled, nothing failed, two windows of 150 frames unchanged — then captured at 3:2 (2:3 for portrait photos) so the vertical field matches the photo's. Writes `remote-results/landscapes/<slug>.png` + `.json` (readiness, pose) and `index.html` (each capture beside its photograph, loaded from Commons). `LANDSCAPES="Matterhorn|Fuji"` narrows it. | the 14 landscape scenes, 1440×960 | ~3–6 min per scene (network) | native WebGPU; live terrain/WorldCover/OSM; Commons for the report's photos |
| forest-aaa.e2e.test.ts | The procedural forests on real places: the Vosges (mixed conifers), the Landes (pines), the Amazon (broadleaf, palms), each from the forest floor and from 300 m: > 50 000 trees each (the grid's, no cap; `forestCells`, a 7 m cell), dappled shade under the canopy (the floor with/without the scenery's shadows), the frame's cost with the scenery on and off (`__bh.game.perf()`). Captures `forest-aaa-<place>-<view>.png`, measures in `forest-aaa.json`. | Earth: the Blue Marble, 1280×720 | ~15–25 min (network, three places × two views) | native WebGPU; live terrain/WorldCover/OSM |

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

## Contacts et carte locale au sol

| file | what it proves | scene | duration | needs |
|---|---|---|---|---|
| ground-details.e2e.test.ts | Loaded Earth: native character depth versus vessel, foreground depth-plane occlusion, hull shadow on Earth, local planisphere at zoom 18, wheel/buttons and M on foot. Readiness JSON with captures. | Earth: the Blue Marble, 960×540 | 16–70 s here, network/compile dependent | live terrain/scenery and licensed astronaut |
| ground-planets.e2e.test.ts | Carte à pied Lune/Mars : atlas chargé, zoom 18, coordonnées, dézoom ; Mann : quadrillage sans atlas. Captures après chargement. | Lune, Mars, Mann, 960×540 | ~19 s ici | atlas locaux et astronaute licencié |
| scenery-hitboxes.e2e.test.ts | Contours CPU roses des arbres/bâtiments réels ; activation et désactivation ; captures après chargement. | Terre, Le Bourget, 960×540 | ~36 s, réseau dépendant | terrain/décor et astronaute |
| gargantua-ground.e2e.test.ts | Mann/Miller/Edmunds : posé avant sortie ⇧K, contact pieds/terrain, proximité du vaisseau, réembarquement et placement On foot. Captures chargées et diagnostics métriques. | game:interstellar, 960×540 | ~28–47 s ici | astronaute licencié ; aucune tuile réseau |
