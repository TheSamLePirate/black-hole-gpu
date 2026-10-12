# The four game modes, AAA pass: progress

The plan, the request and the user's choices: [PLAN-MODES-AAA.md](../PLAN-MODES-AAA.md).

| Lot | State |
| --- | --- |
| M1 The four modes, the top bar always present | done |
| M2 TARS everywhere | done |
| M3 Pause → offline capture everywhere | done |
| M4 Ship HUD in chase and dorsal, three HUDs | done |
| M5 On-foot HUD | done |
| M6 The Atlas: maps, POIs, placement, geocoding | done |
| M7 Tripod and sky events from the view | done |
| M8 Photo mode: renders and animations | done |
| M9 Coherence | done |

## M1. The four modes, and the top bar always present

### What changed

**The modes (`src/game/modes.ts`, pure).**

- `modeOf(state)` reads the mode from the app's state: `settings.ship`, `camera.piloting`, the spectator, the walker
  and the photo mode.
- `planMode(state, to)` gives the steps from one mode to another, or why not. The steps:
  - close or open the photo mode;
  - start or stop the spectator;
  - board, stop walking, disembark, or walk here;
  - put the ship in.
- `main.ts` carries the steps out (`setGameMode`). Leaving the walk for the free camera keeps the walker's camera
  where it was: with a ship flown it becomes the spectator; without one, the free camera takes its place.
- Walking "here" uses `camera.groundBelow()` (`controller/piloting.ts`): the solid world under the camera, within
  two radii of its surface, and the point under it.

**The top bar (`src/ui/topbar.ts`), on screen in every mode.**

- TARS's emblem: always there, breathing at rest (a new "ambient" emblem in `ui/tars/emblem.ts`), its colour and
  motion following his state. The console mirrors its state to it (`TarsPanel.mirror`). A click opens the console.
- The four mode tabs (F1–F4). The active one is lit amber with its name. A mode refused now is dimmed, the reason in
  its tip.
- The mode's group:
  - **Ship:** the flight HUD's chips (SAS, hold, autopilot), clocks (τ, t, τ/t, Earth +), the craft, the plan, the
    view, the path and the density, moved out of the old mission bar.
  - **Free camera:** the camera's button (its mode, its target).
  - **On foot:** the world and the latitude and longitude.
  - **Photo:** the way back.
- The time: the transport bar always lives in the top bar. It is compact while flying, since the HUD's clocks
  stand beside it.
- The actions: place, scenes, weather, eclipses, sky, music, sound, offline render, details, help, settings, and
  the game tools (dev).
  - The actions that do not fit the window go into a ⋯ menu, the least used first (`overflowed`, pure).
  - The page's toolbar buttons are moved in with their ids. The photo tab carries `btn-photo`.
- The hide button: the bar goes, and a slim handle with TARS breathing in it brings it back. The choice is
  remembered (`kerr.topbar.hidden`).
- In the photo mode, H hides the photo bar and the top bar together, for a clean view.

**What went.**

- The bottom toolbar and the transport dock above it.
- The flight HUD's mission bar and its duplicated buttons: place, weather, eclipses, sound, music, tools, and the
  "⋯ the app's toolbar".
- The status pill is opened from the bar's ⓘ (I). The settings opener shows only when the bar is hidden.
- The duplicated photo-mode CSS block in `menus.css`.

**Keys.**

| Key | Now | Before |
| --- | --- | --- |
| F1 | Ship | — |
| F2 | On foot | the game tools, which moved to F10 |
| F3 | Free camera | the spectator |
| F4 | Photo | assisted flight, which moved to ⇧F4 |

The help sheet, the key hints, the tips and the French follow.

**Everywhere.**

- `__bh.mode`: `get`, `set`, `state`, `bar`, `hideBar` (docs/BH-API.md).
- TARS's `set_mode` tool (the mode, and showing or hiding the bar); `get_state` gives the mode.
- `/play ship|foot|free|photo` and `/bar show|hide`.
- French in `src/i18n/fr-modes.ts`.

**Layout.** The HUD's safe frame, its panels' room, the hub card and the large graph all keep below the top bar
(`#topbar` instead of `.fl-mission`). The camera and sky panels and the toasts open below it in every mode.

### Tests

**Unit, run here:**

- `tests/modes.test.ts`: the modes and their plans.
- `tests/topbar.test.ts`: the overflow.
- `tests/keymap.test.ts`: F1–F4 in every layer, ⇧F4 assist, F10 tools.
- `tests/i18n.test.ts`.

**e2e, for the Macs:** `tests/e2e/modes.e2e.test.ts` (row in docs/E2E-CATALOGUE.md), and the updated
`a11y.e2e.test.ts` and `s5.e2e.test.ts` (the top bar instead of the toolbar).

```bash
bun run e2e --remote modes a11y s5 photo-fps place eclipses metar music-panel bh-api
```

### Manual tests to do (on the Mac)

1. **Start, free camera (the ship off).**
   - The top bar is at the top centre: TARS breathing (a slow green wave), the four tabs with Free camera lit, the
     camera button (mode and target), the time with its date, the actions.
   - Nothing remains at the bottom.
2. **F1.** The Ranger comes in; Ship is lit.
   - The chips, clocks, craft, plan, view, path and density appear in the bar.
   - The time shrinks: no date, the clocks beside it.
   - The HUD's panels and tapes stand below the bar, nothing overlapping.
3. **F3 while flying.** The view glides out as the spectator; Free camera is lit. **F1** carries it back aboard
   with no cut.
4. **F4.** The photo mode opens over the ship; the bar shows "Photo · Esc: back to Ship".
   - H hides the photo bar and the top bar together; H again brings both back.
   - Esc goes back to Ship.
5. **On foot.**
   - Land on the Moon (Place › ground), wait still, then F2: the explorer steps out. On foot is lit, the bar shows
     "Moon" and the latitude and longitude.
   - F3: the free camera stays where the walker's camera was.
   - F1: back on board.
6. **On foot without a ship.**
   - With the free camera near the Earth's ground (Go to Earth, a tripod), F2 sets the explorer down under the
     camera.
   - Far out in space, the On foot tab is dimmed and its tip says why.
7. **Narrow window (1280, then 1100 px).** The actions that do not fit go into ⋯, the least used first: info, help,
   game tools, then weather and eclipses. The ⋯ menu lists them with their names and keys, and they work from it.
8. **Hide.** The ⌃ button at the end hides the bar; a slim handle stays with TARS breathing in it. A click brings the
   bar back. Reload the page: the choice is kept.
9. **TARS.** Click the emblem: the console opens. Ask "passe en caméra libre", then "reviens au vaisseau": the mode
   changes and the tabs follow. While he thinks or acts, the bar's emblem moves and changes colour.
10. **Keys.**
    - F10 opens the game tools (dev).
    - ⇧F4 toggles assisted flight.
    - The help sheet (?) lists F1–F4, F10 and ⇧F4.
11. **Phone or tablet.** The bar fits within the width, the names shortened. Upright, the time goes onto a second
    row.

## M2. TARS everywhere

### What changed

- **F6:** moved to the keyboard's system layer, so it works in every mode (ship, on foot, free camera, photo). The
  top bar's emblem (M1) also opens the console.
- **What he knows** (`TarsState`, sent with every question and given by `get_state`):
  - the flight, only while a craft is flown (no stale flight figures once it is left);
  - the mode, always;
  - on foot (`foot`): the world, the latitude and longitude, the height above the datum and the ground, the view's
    heading, the speed, the landed craft's distance and bearing;
  - in the free camera (`view`): the nearest world and the height above it, the target, the look, the telescope,
    the lens, a cinematic, the spectator;
  - in the photo mode and during a render (`photo`): the mode under the photo, the render's progress.
- **New helpers:**
  - `character.place()` (`controller/character.ts`): where the walker stands, as a map and a compass read it.
  - `src/game/geo.ts`: local axes, azimuths, great circles, the place written, compass points (pure). The on-foot
    HUD (M5) will use them too.
- **His offline answers** ("where are we", "how fast") know the walk and the free camera.
- **His figures** handle negative values (a height below the datum).
- **His 1 s loop** runs in every mode:
  - the mode's changes (`mode`) and a render's end (`render`) are new events his rules can wait on (`schedule`);
  - his timed rules fire outside the flight too;
  - the flight's own events stay the flight's;
  - his console's hub card clears once the flight is left.
- **His prompt** describes the four modes and the fields he is given.
- **The `interface` tool** opens the music console and the render dialog too.
- **Every way into the photo mode** goes through the mode change: the pause menu, the title screen, TARS.
- **Docs:** `docs/systemes/10-tars-agent.md` gets a section "Dans tous les modes", and its events, tools and
  commands are updated.

### Tests

- **Unit:**
  - `tests/geo.test.ts`;
  - `tests/tars.test.ts`: on foot and in the free camera;
  - `tests/keymap.test.ts`: F6 in the system layer;
  - `tests/i18n.test.ts`.
- **e2e (Macs):** `modes.e2e.test.ts` now presses F6 on foot (the console opens) and reads `get_state` (the mode,
  the world, the craft's distance).

### Manual tests to do (on the Mac)

1. **Every mode.** On foot, in the free camera and in the photo mode, F6 tapped opens his field and F6 held
   listens. The emblem in the bar moves while he listens, thinks and speaks.
2. **On foot.** Ask "où sommes-nous ?": the world, the place, the height and the craft's distance and direction.
   - Offline (no key): his written answer says the same.
   - Online: he can also say how to walk back to the craft.
3. **Free camera near Mars.** Ask "où suis-je ?": the height above Mars and the target.
4. **His rules.**
   - Ask "préviens-moi quand je repasse en mode vaisseau": a rule `mode` → `ship`. Switch with F1: he wakes and
     speaks.
   - Ask "dis-moi quand le rendu est fini", start an offline render (the bar's render button), let it finish: he
     says so.
5. **Leaving the flight.** Walk off a landed craft: the hub card on his console clears.
6. **Commands.**
   - "ouvre la musique": the music console.
   - "ouvre le rendu": the render dialog.
   - "mode photo": the photo mode, Esc back.

## M3. Pause gives the offline capture, everywhere

### What changed

- **The capture** (`renderdialog.ts` `capture()`): the view now, rendered offline at once with the dialog's
  settings, or a preset, a size and samples given.
  - It renders whatever the view is: the ship's, the walker's (the explorer drawn in it), the free camera's, the
    photo mode's. The offline passes draw the station, the character and the crafts as the live view does.
  - The PNG is saved by itself once converged (or a 16-bit PNG, an EXR, nothing).
  - A box in the dialog keeps the same choice for a render started by hand. A capture's choice is its own: a
    render started by hand afterwards does not inherit it.
- **The pause menu:** "Capture (offline render)" (primary, right under Resume) and "Render…" (the dialog: a
  picture or a video).
- **The top bar:** a Capture button (the shutter), beside the Render one.
- **TARS:** the `capture` tool (start with a preset or a size and samples, status, save, stop) and `/capture`. The
  `render` event (M2) tells him when it ends.
- **Docs:** the TARS tools table; the e2e catalogue.

### Tests

- **e2e (Macs), `modes.e2e.test.ts`:**
  - a 320×180, 16 spp capture converges on foot, in the free camera and in the ship, with no GPU error;
  - the pause menu shows the Capture item.

### Manual tests to do (on the Mac)

1. **Pause, then Capture.**
   - Flying, in chase: Esc, then "Capture (offline render)". The render dialog shows the progress. Once
     converged, the PNG downloads by itself, the Ranger in it.
   - On foot: the explorer is in the picture.
   - In the free camera and in the photo mode: the view as framed.
2. **The bar's shutter button:** the same, without the pause.
3. **By hand.** In the dialog, check "Save the PNG when done" and Start: the PNG comes by itself. Unchecked: it
   does not.
4. **A capture, then by hand.** After a capture, start a render by hand with the box unchecked: nothing is saved
   by itself.
5. **TARS.**
   - "fais une capture 4K de cette vue": a 3840×2160 render, saved at the end.
   - "dis-moi quand c'est fini": he speaks when it ends.
6. **A video running:** a capture is refused with a toast, and the video goes on.

## M4. Ship HUD: in the chase and dorsal views, three HUDs by type of flight

### What changed

**Where the HUD shows** (`game/hudkind.ts` `hudInView`, setting "HUD in the views").

- By default the whole HUD (the symbology, its tapes, the flight's panels) shows in the chase and dorsal views.
- In the cockpit, the cabin's screens are the instruments.
- The other views keep the warnings, the autopilot's card, the docking aid, the spectator's bar and the menus.
- "Every outside view" and "Everywhere" widen it.
- The speed effects (streaks, grey-out) stay in every view: they are the eye's, not the HUD's.

**Three HUDs** (setting "The ship's HUD", ⇧², the HUD chip in the top bar).

- **Atmosphere:** the fighter's (`hud/jethud.ts`) for every flight in the air, not only plane mode. Its figures are
  computed in the air whatever the flight law; its modes engage in plane mode.
- **Space** (`hud/kindhud.ts`): a cyan block right of the centre with:
  - the orbit about the sphere of influence's body;
  - the apsides with their heights and times;
  - the inclination, the eccentricity, the period;
  - the next event (an impact in red);
  - the target's range and closing rate.
- **Approach:**
  - the radar altitude and the vertical speed, large;
  - the glide's and the axis's deviations as an ILS's dots, from the runway's MLS guidance;
  - the gear, the flaps and the air brake (the gear up low: red, blinking);
  - the existing runway guidance and vertical landing scope.
- **Automatic:**
  - chosen by the flight's phase: the air and the entry are Atmosphere; the final, the approach, a low hover and
    the ground are Approach; the rest is Space;
  - a change is held 1.5 s before it shows, so nothing flickers at a boundary;
  - a forced kind applies at once.
- **What each kind leaves out:** `hudShownFor` crosses the phases' matrix with the kind's own.
- **The telemetry** gives the gear, the flaps and the air brake.
- **TARS:** the `interface` tool sets `hudKind` and `hudViews`; `get_state` gives them.
- **Docs:** `docs/systemes/08-interface.md`, sections 5 (the top bar) and 6.3 bis.

### Tests

- **Unit:**
  - `tests/hudkind.test.ts`: the kind by the phase, the hold, the forced kind, the cycle, the views;
  - `tests/kindhud.test.ts`: the Space HUD's lines, the deviations, the formats.
- **e2e (Macs):**
  - new `tests/e2e/hud-kinds.e2e.test.ts`;
  - `hud-layout.e2e.test.ts` now runs with the HUD in every view, so the docking and film states keep their
    panels to measure.

### Manual tests to do (on the Mac)

1. **Chase, in orbit.**
   - The HUD chip reads "HUD SPACE" (dim: automatic).
   - The cyan block right of the centre: ORBIT · EARTH, AP and PE with their T−, INC, e, P.
   - Target the ISS: its range and closing rate (green when closing).
2. **Dorsal:** the same. **Cockpit:** no tapes or panels over the view, the cabin's screens; the warnings and
   the autopilot's card stay. **Film, Wing, Director:** the image clean.
3. **The setting.** Settings › HUD aids › "HUD in the views": Everywhere brings the HUD back over the cockpit;
   Every outside view brings it over the film's views.
4. **Entry, then the glide.**
   - The HUD turns Atmosphere (green tapes, Mach, G) about 1.5 s after the entry begins, in rocket mode too.
   - On the final it turns Approach: RA and VS large, the G/S and axis diamonds moving the right way (fly toward
     the diamond), GEAR DN green, FLAPS.
5. **Gear up low:** below 300 m with the gear up, GEAR UP blinks red.
6. **Vertical landing on the Moon:** Approach, with the drift scope and the RA.
7. **⇧²:** automatic → Atmosphere → Space → Approach → automatic, a toast each time. The chip is lit while forced.
8. **Speed effects:** in the cockpit, a fast low pass still streaks.
9. **TARS:** "mets le HUD d'approche", then "remets le HUD automatique".

## M5. On-foot HUD

### What changed

- **`src/ui/foothud.ts`**, shown on every solid world while walking (the full map closed).
- **The compass**, under the top bar:
  - a 120° heading tape, ticks every 5°, the cardinal points named, the north in red;
  - the view's heading boxed;
  - the landed craft (gold, with its distance), the Sun, the Moon (on Earth) and the target at their azimuths,
    hollow below the horizon, pinned at the tape's end when beyond it (`character.skyAzEl`).
- **The place**, bottom left: the world, the latitude and longitude, the height above the datum and above the
  ground, the speed (m/s and km/h), the heading, the craft's distance and direction.
- **The minimap**, bottom right:
  - a disc of the local map, heading-up: the Earth's scenery, the other worlds' planispheres;
  - the north on its rim, the craft on it, the walker an arrow at its centre;
  - the wheel and its + and − buttons zoom it (8 to 20); a click opens the full map (M);
  - its picture is redrawn only when the walker moves a few pixels on it or it zooms.
- **New:** `character.skyAzEl`, `LocalGroundMap.minimal` and `metresPerPixel()`, `GroundTrack.atlas(body)`.
- **The old exploration card** keeps its keys and its board button, below the compass; its status line goes (the
  place says it).
- **Phones:** a smaller minimap, a shorter card.

### Tests

- **Unit:** `tests/foothud.test.ts` (the tape's ticks, the marks on it, the distances).
- **e2e (Macs):** `modes.e2e.test.ts` on the Moon checks the HUD shown, the craft's distance, and the minimap's +.

### Manual tests to do (on the Mac)

1. **On the Moon, out of the Lander.**
   - The compass: N, NE…, the CRAFT mark with its distance. Turn the view: the tape scrolls, the box reads the
     heading.
   - The Earth's mark where the Earth hangs in the sky, the Sun's where the Sun is (hollow when below the horizon).
2. **The place.** MOON · latitude and longitude, ALT, SOL, the speed while running, CAP, the craft's distance
   growing as you walk away and its direction pointing back to it.
3. **The minimap.**
   - Turn the view: the map turns, the N on the rim moves, the arrow stays up.
   - Walk: the ground scrolls under the arrow.
   - The + and − buttons and the wheel zoom.
   - A click opens the full map; Esc closes it and the HUD comes back.
4. **On Earth** (a forest, a city): the minimap shows the streamed scenery (buildings, roads, water) around you.
5. **Mars, a Gargantua world:** the planisphere or the graticule. The Sun mark is absent on Gargantua's side.
6. **H hides everything.** The photo mode hides the HUD.
7. **A phone:** the smaller minimap, nothing over the touch controls.

## M6. The Atlas: maps, destinations, placement, geocoding

### What changed

- **`ui/atlas.ts`, a full page** opened by F8, the top bar's Atlas button, the pause menu and TARS.
- **The worlds:**
  - the Earth on Web Mercator from its imagery's tiles (NASA GIBS's Blue Marble to level 8, EOX Sentinel-2
    cloudless to 13: the same live public sources as the scenery);
  - the Moon and Mars on the plate carrée from their maps (2048 px at once, 8192 px once zoomed).
- **The map** (`ui/mapview.ts`):
  - dragged, zoomed about the pointer (the wheel, a pinch, a double click), flown to a place eased;
  - the world always filling the view;
  - the night darkened with the Earth's city lights (VIIRS) through it and the terminator drawn;
  - a graticule; names that do not overlap.
- **Destinations** (`game/pois.ts`, about 90): launch sites, summits, wonders, observatories, cities, poles; the
  Apollo sites, craters, seas; the rovers, volcanoes, canyons and caps of Mars. Each has its kind and a line. The
  runways and sites, and the landscapes' viewpoints, join them.
- **Search:** destinations by name (French or English, accents ignored), coordinates (decimal or DMS), and on the
  Earth addresses through Photon with Nominatim as fallback (`game/geocode.ts`: one request a second at most,
  answers kept for the session).
- **A place picked** (a mark, a result, anywhere):
  - its card: the place, the elevation, the distance and direction from you, day or night there;
  - its actions: in orbit over it, the craft set down there, walk there, the free camera above it (30° down,
    carried with the ground; the spectator if a ship flies), a tripod on it;
  - "This view, as photographed" for a viewpoint; "Ask TARS";
  - a mission running ends only after a second click.
- **TARS:** the `atlas` tool (search, go, open), `/atlas` and `/visit`.
- **Compass points** are translated everywhere (O, SO, NO in French).
- **Docs:** `docs/systemes/08-interface.md` § 6.3 quater; the TARS tools table; the e2e catalogue.

### Tests

- **Unit:**
  - `tests/mapproj.test.ts`: the projections both ways, the terminator, the tiles;
  - `tests/pois.test.ts`: every destination valid, the search, Photon's and Nominatim's answers, typed coordinates.
- **e2e (Macs):** `tests/e2e/atlas.e2e.test.ts`. `ATLAS_LIVE=1` adds a live address search.
- **Checked here** in a headless page: the Moon with its destinations, the Earth with GIBS's tiles and Photon's
  answers live, the night with the city lights.

### Manual tests to do (on the Mac)

1. **F8.** The Atlas on the world you are on, centred on you.
   - Drag, wheel, pinch on a trackpad, double click: smooth.
   - Zoom on Paris: the EOX imagery sharpens to the streets' scale.
2. **Night.** The terminator and the night with the cities lit on the Earth. Change the date (the time panel), then
   reopen: the night has moved.
3. **Search.**
   - "mont blanc": the destination, then the addresses.
   - "48.8584, 2.2945": the coordinates.
   - "Tour Eiffel": Photon's result.
   - On the Moon "tycho"; on Mars "jezero".
4. **Each action, from a destination:**
   - In orbit over Everest: the craft passes over it now.
   - Set the craft down at Gale crater.
   - Walk at Apollo 11: on foot beside the craft.
   - Free camera above Valles Marineris.
   - Tripod at Paranal: the camera on the ground, looking north.
5. **A viewpoint:** "This view, as photographed" opens the landscape.
6. **A mission running:** the first click warns, the second goes.
7. **TARS.**
   - "emmène-moi au-dessus du Grand Canyon en caméra libre".
   - "pose-nous au cratère Gale".
   - "/visit tour eiffel".
8. **Narrow window and phone:** the map above, the list and the card under it.

## M7. The tripod and the sky's events from the view

### What changed

- **⇧T on foot** sets the tripod where one stands, looking the same way (`tripodHere` in `main.ts`): the free
  camera on the ground, fixed to the world, the sky wheeling overhead. `cameraAt` takes a heading and a pitch.
- **The sky from here** (`ui/skyevents.ts`), opened by ⇧F8, the top bar, the pause menu, TARS and `/skyevents`.
  - From the Earth (walking, the tripod, or the free camera under 130 km) and the way the view looks.
  - Its cards, dated (UTC), each with where to look (azimuth, altitude), the field and the 35 mm lens:
    - star trails: around the pole when it stands 10° up (circumpolar), else along the view; four hours from the
      dark sky (the Sun at −12°);
    - the analemma: at the time it is now if the whole figure stays up, else at local mean solar noon, 10:00,
      14:00, 9:00 or 15:00; none in the polar circles;
    - the Moon's path tonight; the next visible ISS pass;
    - the ISS's closest approach to the Moon and the Sun over three days; a transit (under 0.26°) marked amber;
    - the next solar and lunar eclipses seen here, the next selenelion (both bodies within −1…+2° of the horizon
      during the umbral phase), the next transits of Mercury and Venus with the Sun up.
  - The cards come in as they are computed: the page opens at once (about 20 ms), the main thread given back
    between groups (175 ms at most measured), the eclipses from the planner's worker over thirty years.
- **Three ways for each event:**
  - **Go there:** the clock to that date, the tripod at the same place aimed (azimuth, altitude), the field set.
  - **Live it** (`ui/livecapture.ts`): the exposures taken one by one in the game (the date set, the scene settled,
    the image exported) and stacked (lighten) on a card at the bottom right that grows with the event, with the
    progress, the exposure and the time left. The game's time is held, then given back. At the end: the stack as a
    PNG, or the full-quality render. The ISS, which the scene does not draw from the ground, is drawn on each
    exposure: its lit streak, or its silhouette across the disc for a transit.
  - **Render:** the multiple exposure's dialog, filled (trails, analemma, Moon, ISS, eclipse or transit).
- **The geometry** is pure (`photo/skyevents.ts`): `angSep`, `poleView`, `trailsAim`, `shotTimes`, `lensMm`,
  `selenelionAt`, `closestApproach`.
- **TARS:** the `sky_events` tool (list, take with go / live / render, open) and the `skyevents` panel.
- **French** for every text; the ⇧T help line updated.
- **Docs:** `docs/systemes/08-interface.md` § 6.3 quinquies; the TARS tools table; the e2e catalogue.

### Tests

- **Unit:**
  - `tests/skyevents.test.ts`: the angles, the pole, the trails' aim, the times and lenses, the selenelion, the
    ISS's closest approach;
  - `tests/livecapture.test.ts`: the lighten stack, the time left.
- **e2e (Macs):** `tests/e2e/sky-events.e2e.test.ts`.
- **Checked here** in a headless page with the real ephemerides, from Paris on 12 Oct 2026 at 19:00 UTC:
  - circumpolar trails;
  - the analemma at 11:51 UTC (solar noon), a 59° field;
  - the ISS 2.1° from the Moon on 13 Oct, and across the Sun (0.17°) on 14 Oct at 11:43 UTC;
  - the penumbral lunar eclipse of 20 Feb 2027 and the partial solar eclipse of 2 Aug 2027 (magnitude 0.63);
  - a selenelion on 31 Dec 2028 at 15:53 UTC;
  - the transit of Mercury on 13 Nov 2032;
  - the live card stacking 30 exposures, then its actions.

### Manual tests to do (on the Mac)

1. **⇧T on foot** in a field on the Earth: the camera stays where you stood, looking the same way. Let time run: the
   sky turns, the ground stays.
2. **⇧F8** there: the page opens at once, the cards come in, the eclipses last.
   - At the North Cape: the analemma is missing.
   - Near the equator: the trails go along the view, not to the pole.
3. **Go there** on the trails at night: the tripod faces the pole at its height, the field is 60°.
4. **Live it:**
   - the trails: 48 exposures, the arcs grow on the card, the time left falls;
   - Stop halfway: the stack is kept, Save it as a PNG, the time runs again if it ran;
   - the Moon's path, then Full-quality render: the dialog opens filled.
5. **The ISS:**
   - a pass lived: its streak crosses the stack;
   - a transit (amber card) lived: its silhouette on the disc. Use a solar filter for the Sun.
6. **The free camera** over the ground (F3, under 130 km): ⇧F8 works. Higher up, or on the Moon: the refusal toast.
7. **TARS:**
   - "qu'est-ce que je peux photographier d'ici ?" (he lists them);
   - "fais-moi vivre le filé d'étoiles";
   - "/skyevents".
8. **The pause menu:** "The sky from here".
9. **Phone width:** one column of cards; the live card fits.

## M8. The photo mode: renders and films

### What changed

- **The render dialog** is built in TypeScript in the interface's language (`renderdialog.ts`, `mountPanel`). The
  static HTML is gone from `index.html`; the ids are kept.
- **A video is a job:** `startVideo(job)`, `videoState()`, `stopVideo()`, `shots()`. The dialog, the photo bar and
  TARS start it the same way. Its shots:
  - live, the recorded take, the auto-orbit, the dive, the journey;
  - **the director's cameras** on a ship flown (the Director view put on for the video, then put back).
- **The draft** (`photo/videoplan.ts`): the same shot at 640×360 at most (a portrait at 360×640), 4 samples, the
  fixed-step integrator, no motion blur.
  - It opens by itself in the **preview** (`ui/videopreview.ts`): played in a loop, its facts shown.
  - Its buttons: "Save the draft" and "Render the final" (the same shot, length and rate, at the dialog's size and
    quality).
  - A final is saved, then shown in the same preview.
- **The formats:** MP4 (H.264) or WebM (VP9, else VP8), chosen in the dialog.
  - The other one is used when the browser cannot encode the first.
  - The WebM writer has no dependency (`WebmWriter` in `video.ts`: seek head, track, a cluster per key frame, the
    cues to seek by).
- **The photo bar** has a video row:
  - the shot (those that cannot film now are greyed), the length, the frame rate, Draft and Render video;
  - while it renders: its gauge, the frame, the time left and Stop.
- **The multiple exposures animated:** the lived capture (M7) also offers its time-lapse, the stack growing
  exposure by exposure (about four seconds, the last image held a second and a half).
- **TARS:** the `video` tool (start, status, stop, shots), `/draft` and `/video`.
- **French** for every text of the dialog, the bar and the preview.
- **Docs:** `docs/systemes/08-interface.md` § 6.3 sexies; the TARS tools table; the e2e catalogue.

### Tests

- **Unit:**
  - `tests/webm.test.ts`: the EBML sizes; a file read back (segment, seek head positions, a cluster per key frame,
    the cues);
  - `tests/videoplan.test.ts`: the draft's size, the frames, the names;
  - `tests/livecapture.test.ts`: the time-lapse's rate, the even crop.
- **e2e (Macs):** `tests/e2e/photo-video.e2e.test.ts`.
- **Checked here** in headless Chromium, which has no H.264 encoder:
  - MP4 asked falls back to WebM VP9;
  - the file reads back at 640×360 for 2.0 s and seeks to 1.2 s;
  - the photo bar's video row is drawn while rendering, and the preview plays the draft.

### Manual tests to do (on the Mac)

1. **F4, the video row:**
   - an orbit, 10 s, 24 fps, Draft: the gauge, the frame and the time left move;
   - the preview opens and loops; Save the draft;
   - Render the final: the dialog's size, the progress, then saved and shown.
2. **Each shot as a draft:**
   - live (in flight, the autopilot on);
   - dive; journey (near Gargantua);
   - a take: record 10 s with ●, then its draft;
   - director: in flight with the ship flown; on foot it is greyed.
3. **Formats:**
   - WebM chosen: the file plays in Chrome and in VLC;
   - MP4 in Safari and QuickTime.
4. **Stop** a draft halfway: nothing is saved, the scene comes back where it was.
5. **The render dialog** (Render…) in French: every label, tooltip and option.
6. **A lived capture** (⇧F8 → Live it, trails): at the end, Time-lapse (MP4/WebM) saves the growing stack.
7. **TARS:**
   - "fais-moi un brouillon d'une orbite de 8 secondes";
   - "/video dive";
   - "où en est la vidéo ?".
8. **Narrow window and tablet:** the bar's rows wrap and stay usable.

## M9. Coherence

### What changed

- **The wrong toasts.** "Leave the Ranger (⇧K)" pointed at the wrong key: ⇧K is the next view off a flight, and
  disembarking once landed.
  - The dive and the journey now say "K puts the Ranger away".
  - The Ranger's tripod refusal now says: landed, ⇧K takes you out on foot and ⇧T sets the tripod there.
  - Both messages are fixed in `main.ts` and `controller/piloting.ts`, with their French.
- **⇧T from the spectator** sets its own camera on the ground (`viewController().standOn`), no longer refused while
  a ship flies on.
- **Key hints.**
  - Free camera: V, Tab, ⇧T · ⇧F8 (tripod, the sky from here), F8 (Atlas), F1 · F2 · F4 (the other modes).
  - On foot: the key line adds ⇧T (tripod here) and, on the Earth, ⇧F8.
- **Tablet.** The top bar has a Tripod action on foot and in the free camera; it does what ⇧T does.
- **The page's own buttons** moved into the top bar now have their tooltips in French: scenes, sky chart, music,
  camera, details. The first-run hint is translated.
- **Dead CSS** of the old toolbar removed: rotation, target, fly, gravity, orbit, dive and journey buttons, the sound
  icons, and the phone rule's missing buttons.
- **TARS:**
  - he knows a video rendering (its shot, draft or final, frame, time left) and a capture lived (its exposures);
  - his `render` waking tells a video's end only, not each of its frames;
  - his tools table and his `/` commands are documented in full: `find_eclipses`, `eclipse_local`,
    `go_see_eclipse`, `iss_passes`, `multiple_exposure`, `weather_at`, and the commands of the camera, flight, HUD
    and saves.
- **The `__bh` API:** `docs/BH-API.md` covers `__bh.mode` and its members, the only new ones from M1 to M8.

### The e2e tests per mode (Macs)

| Mode | Files |
| --- | --- |
| Ship | `modes`, `hud-kinds`, `hud-layout`, the flight files |
| On foot | `modes` (out of a landed craft, the HUD, TARS), `atlas` (walked to Apollo 11), `sky-events` (the tripod) |
| Free camera | `modes` (spectator and back, the capture), `atlas` (above Olympus Mons), `sky-events` (the sky's events) |
| Photo | `modes` (F4 over the ship, the capture), `photo-video` (the draft, the preview, TARS's video) |

### Manual tests to do (on the Mac)

1. **In flight in the Ranger:** press ⇧C (dive). The toast says "K puts the Ranger away".
2. **Landed:** press ⇧T. The toast names ⇧K then ⇧T. Press ⇧K, then ⇧T: the tripod stands where you stood.
3. **F3 with the ship flying (spectator):** press ⇧T. The spectator's camera is set on the ground below, and the ship
   flies on.
4. **Key hints:** in the free camera the strip shows the tripod, the Atlas and the modes; on foot on the Earth the
   key line ends with ⇧T and ⇧F8.
5. **Tablet (or a narrow window, touch):**
   - the Tripod action on foot and in the free camera;
   - Atlas, the sky from here, capture: each reachable from the top bar or its ⋯ menu.
6. **French browser:** the top bar's tooltips (scenes, sky chart, music, camera) and the first-run hint are in French.
7. **TARS during a video:** ask "où en est la vidéo ?"; he answers with the frame and the time left. Set a rule "quand
   le rendu est fini, préviens-moi": it fires once, at the video's end.

