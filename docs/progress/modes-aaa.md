# The four game modes, AAA pass: progress

The plan, the request and the user's choices: [PLAN-MODES-AAA.md](../PLAN-MODES-AAA.md).

| Lot | State |
| --- | --- |
| M1 The four modes, the top bar always present | done |
| M2 TARS everywhere | done |
| M3 Pause → offline capture everywhere | done |
| M4 Ship HUD in chase and dorsal, three HUDs | done |
| M5 On-foot HUD | to do |
| M6 The Atlas: maps, POIs, placement, geocoding | to do |
| M7 Tripod and sky events from the view | to do |
| M8 Photo mode: renders and animations | to do |
| M9 Coherence | to do |

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
