# The four game modes, AAA pass: plan

The request:

- **Four game modes:** Ship, On foot (third person), Free camera across the whole system, and Photo (renders).
- **The top menu:** always present, with a way to hide it.
- **TARS:** reachable everywhere, its animation always on screen, always informed, able to act on everything (more
  external tools, computation and autonomy will come later).
- **Pause:** gives an offline capture in every mode.
- **Ship HUD:**
  - shown only in the dorsal and chase views, never in the cockpit;
  - three HUDs by type of flight.
- **On foot:** its own HUD, with lateral position (lat/lon), altitude, a compass, a zoomable oriented planisphere
  map, and the ship's position.
- **Earth, the Moon, Mars:**
  - a quality map with many destinations (POIs);
  - placement of the ship or the character (in orbit, on the ground, on foot);
  - address search (geocoding).
- **On Earth on foot:**
  - a tripod mode;
  - multiple exposures, transits, eclipses, selenelion and circumpolar trails, built from the current view;
  - "living" the capture (watching the frames being taken).
- **Photo mode:**
  - quality renders and animations;
  - low-resolution video drafts to test a shot;
  - all the camera moves (auto-orbit, dive, journey, director).
- **Every system:** perfect, coherent across the app (the API, TARS, the settings, the panels, the HUDs, the
  menus), best code practice.

The user's choices:

| Topic | Choice |
| --- | --- |
| Three HUDs | Atmosphere (fighter), Space (orbit, manoeuvres, targets), Approach and landing (runway, glide, hover). Chosen automatically by the flight's phase; the player can force one. |
| Geocoding | Photon (komoot, OpenStreetMap), with Nominatim as fallback |
| Video | MP4 H.264 (WebCodecs, already in `src/video.ts`), WebM as fallback; quick low-resolution draft, final converged render |
| Switching modes | A four-tab selector in the top bar, always visible, plus F1 Ship, F2 On foot, F3 Free camera, F4 Photo |

## What exists (mapped before starting)

- **Modes:** spread over `settings.ship`, `camera.piloting`, `camera.spectator`, `camera.character`, `PhotoMode`.
  There is no single notion of the mode. `flying()` in main.ts is the master predicate.
- **Menus:**
  - the app toolbar (bottom: scenes, camera, music, sky, photo, help) is hidden while flying;
  - the flight HUD has its own top "mission bar" (chips, time, clocks, actions);
  - H hides the interface, but not in flight (H is an RCS key there).
- **TARS:**
  - F6 works in the flight layer only;
  - its state `tarsView` is filled only while flying, and its 1 Hz loop returns when not piloting;
  - its console is `TarsPanel`, its emblem an animated SVG (since 2026-10-20 a thinking orb: ui/tars/orb.ts);
  - it has about 40 tools, but none for renders or video.
- **Pause:** the pause menu has no capture. The offline render dialog (`renderdialog.ts`) is reachable only from
  photo mode. Video renders exist (live, take, orbit, journey, dive; H.264 MP4).
- **HUD:**
  - shown in every mount, the cockpit included;
  - the symbology knows only `outside`;
  - phases come from `game/phase.ts`, declutter from `hud/declutter.ts`;
  - the jet HUD (`hud/jethud.ts`) is a template for a self-contained per-type HUD.
- **On foot:**
  - `PlanetCharacter` walks on every solid body;
  - its HUD is a status card;
  - there is a local ground map on M;
  - no lat/lon, compass or minimap.
- **Maps and places:**
  - `GroundTrack` (globe and planisphere), `LocalGroundMap`, the place panel (lat/lon, globe pick, 18 `SITES`);
  - `LANDSCAPES`: 14 viewpoints;
  - no geocoding;
  - imagery: Earth tiles (GIBS ≤ z8, EOX z9–13), Moon and Mars HD maps (LRO/LOLA, MOLA).
- **Sky photography:**
  - multiple exposure (analemma, eclipse, trails, moon path, ISS) in `src/photo/`;
  - the eclipse calculator;
  - the tripod (`standOn`).

## The lots

Each lot is delivered tested (unit tests here, e2e written for the Macs), documented in `docs/progress/modes-aaa.md`
with its manual tests, and committed.

### M1. The four modes, and the top bar always present

**`src/game/modes.ts` (pure):**

- `GameMode = "ship" | "foot" | "free" | "photo"`;
- `modeOf(state)`;
- `planMode(state, mode)`: the steps to a mode, or the reason it is refused;
- the transitions:
  - **ship:** the ship flown, back from the spectator or on board;
  - **foot:** disembarking a landed craft, or else putting the explorer down on the nearest world under the view;
  - **free:** the spectator if a ship flies (it flies on), else the free camera of the whole system (rig,
    cinematics, travels);
  - **photo:** the photo mode over the current mode, back to it on exit.

**`src/ui/topbar.ts`, the app's single bar at the top, in every mode:**

- the mode selector (four tabs with icons);
- the mode's own group (the ship's chips and clocks; the walker's place; the free camera's target);
- the time;
- the actions (scenes, place, map, weather, eclipses, camera, sky, music, sound, photo, render, settings, help);
- TARS;
- a hide button (and H wherever H is free) with a slim handle to bring it back.

The flight HUD's mission bar moves into it. The app's bottom toolbar goes away; its buttons keep their ids
(`btn-camera`, `btn-music`…).

**Keys:**

| Key | Mode | What moves |
| --- | --- | --- |
| F1 | Ship | — |
| F2 | On foot | the developer tools move to F10 |
| F3 | Free camera | F3 was the spectator, which is now this mode with a ship flying |
| F4 | Photo | the autopilot's assist moves to ⇧F4 |

The keymap's help and the tests are updated.

**Everywhere:** the `__bh.mode` API, the TARS `set_mode` tool, `/mode`, settings, French.

### M2. TARS everywhere

- **The emblem:** always on screen, in the top bar's corner, animated with its states. A click opens the console.
- **F6:** moves to the system layer (every mode).
- **`tarsView`:** filled in every mode:
  - the mode;
  - on foot: the body, lat/lon, altitude, heading, the craft's distance and bearing;
  - in free camera: where it is and what it looks at;
  - in photo mode: the render and its progress.
- **The 1 Hz loop:** gives each mode's events.
- **New tools:** mode, render (offline photo, video and its draft), places (search, POIs, geocoding), tripod and
  sky events, the HUD's kind.

### M3. Pause gives the offline capture, everywhere

- The pause menu gets "Capture (offline render)": the current view rendered converged, the dialog's options.
- The top bar gets a Render button.
- The render dialog works in every mode (ship, on foot, free camera, photo).

### M4. Ship HUD: in chase and dorsal only, three HUDs by type of flight

- **Where the HUD shows:**
  - The HUD (symbology and flight panels) shows only in the chase and dorsal views. The setting "HUD in the views"
    can widen it (chase and dorsal, every outside view, everywhere).
  - In the cockpit, the cabin's own screens.
  - The warnings and the top bar stay in every view.
- **Atmosphere** (fighter, the jet HUD extended to every atmospheric flight):
  - speed and altitude tapes, the ladder, the flight path marker;
  - Mach, G, α, vertical speed, radar altitude;
  - the autopilot's modes.
- **Space:**
  - orbital speed (surface or target), apoapsis and periapsis with their times, inclination;
  - the burn's countdown and Δv;
  - the prograde, normal, radial and target markers;
  - the attitude;
  - near Gargantua: τ/t and the radii.
- **Approach:**
  - the runway and its glide slope with the deviations;
  - large radar altitude and vertical speed;
  - the flare cue, the drift scope for a vertical landing;
  - gear and flaps.
- **Selection:** by the phase (`game/phase.ts`) with hysteresis; the player can force one (setting and key).

### M5. On-foot HUD

- **Readouts:**
  - a compass tape (heading, the craft's and the targets' bearings);
  - the place (lat/lon, the body);
  - altitude above the sea or the datum and above the ground;
  - speed;
  - the craft's distance and bearing.
- **The minimap:** circular, heading-up, zoomable (wheel, + and −), on the local ground map (Earth: the scenery;
  Moon and Mars: the HD maps). The craft and the POIs are on it; a click opens the full map.
- **Bodies:** Earth, the Moon, Mars, and every solid body.

### M6. The Atlas: maps, destinations, placement, geocoding

- **The map:** a full-screen zoomable map of Earth, the Moon and Mars.
  - Earth: GIBS/EOX tiles from the public live sources already used. The Moon and Mars: the HD maps.
  - Graticule, terminator, the craft and the walker.
- **Destinations (POIs):**
  - Earth: the sites, the landscapes, iconic places, launch sites, summits.
  - The Moon: the Apollo sites, the craters, the poles.
  - Mars: the landing sites, Olympus Mons, Valles Marineris…
  - Each with its kind and a description.
- **Search:** addresses through Photon (Earth), and names of POIs everywhere.
- **Actions on a place:**
  - put the craft in orbit over it;
  - set it down there;
  - walk there;
  - put the free camera there;
  - put the tripod there.

### M7. Tripod and sky events from the current view (on foot, Earth first)

- **"Tripod here":** from the walker's view, the camera set down where he stands, looking where he looked.
- **The sky events panel:** based on the place and the view.
  - Multiple exposure (analemma, Moon, ISS);
  - circumpolar trails (toward the pole if visible, else along the view);
  - the next transit;
  - the next eclipse visible here;
  - selenelion (a lunar eclipse with the Sun and the Moon both on the horizon);
  - eclipse view.
  - Each with its date, its framing, "go there", "live it" and "render".
- **"Living" the capture:** the time runs, the frames are taken and stacked on screen as the event unfolds, with
  the progress and the time left.

### M8. Photo mode: renders and animations

- **The mode:** photo mode becomes a real mode (F4), over the current one, back to it on exit.
- **Shots:**
  - still renders (converged, presets);
  - animations: live, take, auto-orbit, dive, journey, the director's shots and the multiple exposures.
- **Video draft:** low resolution, few samples, realtime path, to test a shot and its timing in seconds before the
  final render.
- **The bar:** shot, length, fps, draft or final, progress, export.

### M9. Coherence

- The API (`__bh`, `docs/BH-API.md`), TARS's tools and `/` commands, the settings (schema and French), the help
  sheet, the key hints, the tablet.
- The duplicated CSS, the dead buttons and the wrong toast found by the survey, cleaned.
- e2e tests per mode for the Macs. The progress sheet.
