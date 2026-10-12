# The four game modes, AAA pass: progress

The plan, the request and the user's choices: [PLAN-MODES-AAA.md](../PLAN-MODES-AAA.md).

| Lot | State |
| --- | --- |
| M1 The four modes, the top bar always present | done |
| M2 TARS everywhere | to do |
| M3 Pause → offline capture everywhere | to do |
| M4 Ship HUD in chase and dorsal, three HUDs | to do |
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
