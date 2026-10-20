# The menus — intro, title, launch screens, pause, settings

*[Version française](MENUS.fr.md)* — *up to date on 2026-10-20*

How one gets into KERR and moves about it: the intro played while the game loads, the title by way of playing, a
launch screen per way to play, the way into the game, the pause, the player's settings and the Lab. One visual
language (deep black, the disk's amber for what is chosen, Rajdhani capitals), one router, one focus in two
dimensions for the keyboard, the mouse, touch and a controller.

- The plan: [PLAN-TITRE-AAA.md](PLAN-TITRE-AAA.md) (phases E0–E11) and its progress sheets, one per phase, in French,
  with their pictures and measurements: [`docs/progress/title-aaa/`](progress/title-aaa/) — the whole in
  [FINAL.jpg](progress/title-aaa/FINAL.jpg).
- The credits: [CREDITS.md](../CREDITS.md), written from `src/ui/title/credits.ts`.

## The path

| moment | what one sees | code |
|---|---|---|
| **Intro** | black; SAMLEPIRATE as a film's card; KERR; the emblem (the game's own black hole); a procedural background and the loading orb. A key, a click or a touch passes it; the short version once seen. All of it static in `index.html` and animated on the compositor: it plays before the game's script arrives | `index.html`, `src/intro/` (intro.ts, intro.css; worker.ts and painter.ts draw the background and the orb on an OffscreenCanvas) |
| **Title** | the emblem and KERR (glided from the intro); Continue; four ways to play as cards — On foot, By plane, By ship, Free camera —; More…; Settings. Built at the page's start, usable while the game loads: a launch chosen meanwhile is kept and run before the first image | `src/ui/title/title.ts`, `activities.ts`, `art.ts` |
| **On foot** | a tab per world (Earth, Moon, Mars), the place (the Atlas's destinations, an address, coordinates) pinned on its planisphere, the hour of that place's own day, the weather (Earth) | `src/ui/title/foot.ts` |
| **By plane** | Free flight (airfield, start, hour, weather, fuel — kept), Combat (the air missions, the fights), Flight school, Challenges (with their best marks). A flight starts in the cockpit | `src/ui/title/plane.ts` |
| **By ship** | the hangar: a tab per craft with its sheet and turntable, the destinations it can reach (a ground closed to the Endurance, said), its missions and scenes | `src/ui/title/ship.ts` |
| **Free camera** | the gallery full screen, a tab per kind (black holes, Gargantua, wormhole, solar system, Earth, landscapes), the focused scene behind | `src/ui/title/free.ts` |
| **More…** | Play (every scene, load), Create (photo, missions), Together, Learn (how to play, discover, controls), Measure (the Kerr Bench, confirmed), The game (credits, language); the credits roll | `title.ts` (moreScreen, creditsScreen), `credits.ts` |
| **Into the game** | the menu slides out, the black comes in (400 ms), the launch runs under it; a scene loading screen if the scene's tracer must compile (its picture, the orb, the stage, a tip); the black lifts and the HUD lights up element by element | `src/ui/entry.ts` |
| **Pause** | Escape (Start): a column on the left — resume, save, load, release, five drawers (Capture, World, Sky, Change mode, Settings), play together, the title —, the context on the right (the mission and its objectives, or the flight's figures; the time played, the last save, a tip). In a network room the game goes on | `src/ui/pause.ts`, `pausemenu.ts` |
| **Settings** | eight tabs (Game, Graphics, Display & HUD, Audio, Controls, Accessibility, Interface, Network), a row per setting, the focused one explained, risky ones back after 15 s unless kept, R resets the tab, ⌘K searches here and in the Lab; a graphics setting's GPU cost (measured on kerr-mini, `costs.ts`); the language changed in place — the menus and the Lab at once, the HUD at the next load | `src/ui/settings/` (menu.ts — which settings, from the schema —, values.ts, player.ts) |
| **Lab** | the drawer of every control (camera, scene, matter, sky, physics, rendering, game), its search, presets and history — from the settings' LAB ›, their search, ⇧M, the pause's Settings › Lab | `src/ui/panel.ts`, `src/ui/schema.ts` |

## The keys

| | keyboard | controller |
|---|---|---|
| move | arrows (the focus in two dimensions) | D-pad, left stick |
| choose | Enter, a click | A |
| back (out of a drawer, a screen; out of the pause from its first column) | Escape | B |
| tab (a mode's screen, the settings, the hangar's craft) | Q / E (A / E on AZERTY: by their place), Page ↑ / ↓ | LB / RB |
| change a setting's value | ← → | D-pad ← → |
| reset the settings' tab | R | Y |
| search the settings (both screens) | ⌘K / Ctrl+K | — |

The prompts at the foot of each screen follow the device used last (`ui/menu/glyphs.ts`).

## The foundation (`src/ui/menu/`)

- **The router** (`router.ts`): a stack of screens in a host, each remembering its focused item; Escape and B on the
  game's Escape stack (a screen may keep it: a drawer, a confirmation); screens changed by a View Transition where
  the browser has them (the pause's and the settings' at once: `cut`).
- **The focus** (`focus.ts`): the nearest item in the direction pressed, by the items' geometry.
- **The actions** (`actions.ts`): one meaning per key for the keyboard and the pad.
- **The pad** (`ui/padnav.ts`): its buttons sent as those keys while a menu is up — in full on the title, the
  pause and the settings.

## For the tests: `__bh.menu`, `__bh.entry`

- `__bh.menu.state()` → `{ title, pause, settings, entry }`: the title's screen (`"title"`, `"mode:ship"`,
  `"plane:field"`…), the pause's (`"pause"`, `"pause:save"`…), the settings' tab, the entry's veil up — null when
  closed. `__bh.menu.title(mode?)`, `pause()`, `settings(tab?)` open them.
- `__bh.entry.busy`; `__bh.entry.compile(ms)` holds the scene tracer's stage to show the loading screen.
- The e2e: `title`, `title-plane`, `title-ship`, `title-foot`, `title-more`, `pause`, `settings`, `entry`, `pad`,
  `intro` and the whole path in `menus-campaign` ([E2E-CATALOGUE.md](E2E-CATALOGUE.md)).

## Measures

The title and the intro cost nothing to the first image: A/B on kerr-mini at each phase (E1, E2, E3) and against
the code before the menus at the close (E11, `bun scripts/ab-commit.ts e664e0aa`: cold 1 341 ms against 1 355,
warm 865 against 933 — medians of 6 starts on kerr-mini). The title answers 170–180 ms after the page's start cold,
40 ms warm, long before the graphics.
