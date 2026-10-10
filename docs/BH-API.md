# `__bh` — the page's automation handle

`globalThis.__bh` is how the e2e tests, the scripts, the benches and the devtools drive the game: scenes,
settings, the simulation frozen and stepped, the ship and its autopilots, the game's tools, offline
renders, sound, TARS. It is built in `src/automation.ts` (with members from `src/main.ts`'s context and
`src/game/tools.ts`), and exists in every build, production included.

From a test: `await app.js("__bh.game.status()")` (tests/e2e/lib/app.ts: the expression runs in an async
function, Promises are awaited, the value comes back as JSON — return plain data, not class instances).
From the browser console: the same expressions; `__bh.game.help()` lists the game tools. How to write and
run tests: [E2E.md](E2E.md).

**Conventions.** The sim's own unit is **M** (the black hole's mass in geometric units: lengths GM/c², times
GM/c³; `src/system/solar.ts` `M_METRES`, `M_SECONDS` convert). Most game tools take **km, degrees, m/s**
and say so. "Home frame": our universe's frame, our wormhole's mouth at the origin. Unless said otherwise
a function is synchronous.

**The live list.** `bun scripts/bh-api.ts` prints every member as the running page has it (path, kind,
arity). `bun scripts/bh-api.ts --check` lists the members this page is missing. `tests/e2e/bh-api.e2e.test.ts`
fails when one is missing: every member of `__bh`, and of its namespaces (`game`, `bench`, `iss`, `sky`,
`gpu`, `hud`, `sys`, `pwa`, `tarsVoice`, `tars`), has its own heading or table row here, under its full path.
The big live objects (`settings`, `camera`, `renderer`, `sim`, `fleet`, `mission`, …) are documented by the
members tests use; their source is their full reference.

**Contents**

1. [The loop, scenes, settings and rendering](#the-loop-scenes-settings-and-rendering) — `freeze`, `step`,
   `preset`, `settings`, `render`, `video`, `gpu`, `pwa`, `hud`, …
2. [The game's tools — `__bh.game`](#the-games-tools--__bhgame) — status, orbit, land, glide, saves, warp, targets
3. [The ship, its flight, the world](#the-ship-its-flight-the-world) — `camera` (the pilot, autopilots,
   holds), `fleet`, `mission`, `sys`, `iss`, `sky`, the cockpit
4. [Sound, voices, TARS, the bench](#sound-voices-tars-the-bench)

---

## The loop, scenes, settings and rendering

These paths drive the simulation's clock, load a scene, read and write the settings, render an offline still or a video, and read the GPU, the Service Worker and the HUD's room. Units are in the game's geometric units unless said: lengths and times in M (GM/c², GM/c³ of the black hole), angles in degrees, time in M for `time`/`setTime`, milliseconds of wall clock where said. The scene's own real-second value is `secondsPerM = 4.925490947e-6 s × massSolar`. Most paths are synchronous; `snapshot`, `render`, `video`, `captureScenes`, `pwa.ready()`, `pwa.stats()`, `pwa.clearTiles()` and `skyLoading` return Promises.

**Determinism pattern (used by most flight and scene tests).** The live loop steps the simulation on its own clock, so a test takes it over:

```js
__bh.freeze(true);                       // the loop stops stepping the simulation
__bh.game.preset("Earth: the Blue Marble");
for (let i = 0; i < 150; i++) __bh.step(1 / 30); // each call advances camera, ship, mission, clock by dt s
__bh.freeze(false);
```

`freeze(true)` stops the loop's own `sim.step` (and the flight clock and the rain clock); the image still redraws. `step(dt)` is what moves time. Fix the calendar with `setDate` when a scene uses "now" (the station, the fleet). Grep `tests/e2e` for `__bh.freeze(true)` (about 33 occurrences) for more.

**Loading a scene.** Two routes:
- By URL: `App.boot({ hash: "scene=game:artemis" })` (tests/e2e/lib/app.ts) navigates to `…?e2e=…#scene=game:artemis`. At start, `main.ts` reads `scene` from the hash and calls `applyPreset(scene)` when `presets[scene]` exists, skipping the title screen. A `#save=…` link wins over it.
- In the page: `__bh.preset("Earth: the Blue Marble")`. It replaces the scene's settings with the defaults, then the preset's; the player's `pref` settings and the image's `carried` settings are kept (`SETTING_KIND` in `settings.ts`). An unknown name is not an error: it silently resets to the defaults.

Scene names that exist: `__bh.scenes()` (about 80 keys of `__bh.presets`, e.g. `"Interstellar (no shifts)"`, `"Earth: docking to the ISS"`, `"Miller: the water world"`, `"game:artemis"`, `"game:interstellar"`). The `game:` ones are flight scenes.

### `__bh.freeze(on: boolean)` → void

Stops (`true`) or resumes (`false`) the live loop's `sim.step`, and with it the flight clock and the rain clock, so that the simulation only moves when a test calls `__bh.step`. It does not stop redraws. It has no effect on an offline render or a video, which step on their own. Call `freeze(false)` before leaving the test: while frozen the loop never steps the simulation.

```js
(__bh.freeze(false), __bh.game.importSave(json, false), true)
```
*Used in:* `tests/e2e/worlds.e2e.test.ts`, `tests/e2e/landing.e2e.test.ts`, `tests/e2e/dock-undock.e2e.test.ts` (about 33 occurrences of `freeze(true)` in `tests/e2e`).

### `__bh.step(dt: number)` → number

Advances the whole scene by `dt` seconds of wall time: the frame clock (`frameclock.ts`), `sim.step(dt)` (camera and ship and their autopilots, the mission, the clock if `animate` and `timeSpeed > 0`), the ship's render state, then a redraw is requested. Returns the scene time after the step [M]. `step(0)` runs the step with no time passing: used after a manual `sim.setTime` so the display catches up. Works frozen or not; the usual step is `1/30` s.

```js
(() => { for (let i = 0; i < 5; i++) { __bh.step(1 / 30); if (c.ourLanded || c.airFlight.failure) return true; } return false; })()
```
*Used in:* `tests/e2e/worlds.e2e.test.ts`, `tests/e2e/callouts.e2e.test.ts`, `tests/e2e/wormhole-map.e2e.test.ts`.

### `__bh.time()` → number

The scene's time [M] (`sim.time`). It only moves while `settings.animate` is on and `timeSpeed > 0` (or when a step runs), so a test compares two reads to see whether time is running.

```js
const t0 = __bh.time(); /* … */ __bh.time() > t0
```
*Used in:* `tests/e2e/smoke.e2e.test.ts`, `tests/e2e/title.e2e.test.ts`.

### `__bh.setTime(t: number)` → void

Sets the scene's time to `t` [M] (sets `sim.time`, marks it dirty, and updates the wormhole's own clock). Use it to put a scene at a moment; the preset's own `time` is the usual value. For a scene with no `time` of its own, the tests set `0` so the picture is the same every run.

```js
if (__bh.presets[name].time === undefined) __bh.setTime(0);
```
*Used in:* `tests/e2e/rates.e2e.test.ts`, `tests/e2e/golden.e2e.test.ts`.

### `__bh.setDate(ms: number | null)` → void

Fixes "now" for the scenes of the real time (the station, the fleet, the solar system's placement), as milliseconds since 1970. `null` frees it back to the wall clock. Call it before `preset` for a scene whose layout depends on the date.

```js
__bh.setDate(Date.UTC(2026, 9, 1, 12)); __bh.game.preset("Earth: docking to the ISS");
```
*Used in:* `tests/e2e/dock-undock.e2e.test.ts`, `tests/e2e/rates.e2e.test.ts`, `tests/e2e/golden.e2e.test.ts` (restored with `setDate(null)`).

### `__bh.touch()` → void

Marks the scene changed so the next frame is drawn again. Direct assignments to `settings` bypass the routing that the panel uses (`main.ts`: a change says what it affects), so a test that sets a field directly calls `touch()` afterwards. Use `refresh()` instead when the change also needs the panels rebuilt.

```js
(__bh.settings.exposure = 0, __bh.touch(), 1)
```
*Used in:* `tests/e2e/smoke.e2e.test.ts` (10 uses in `tests/`, 3 of them in smoke), `tests/e2e/photo-fps.e2e.test.ts`.

### `__bh.refresh()` → void

Refreshes the settings panels (their values, the scene card, the quality line) and the buttons from `settings` (`refreshGui` in `main.ts`). Whether it also rebuilds the cockpit or the geometry is unclear: it does not do so in `refreshGui`. Call it after a change the panels must show, for instance the camera's attach point:

```js
(__bh.settings.shipMount = "cockpit", __bh.refresh(), true)
```
*Used in:* `tests/e2e/cockpit.e2e.test.ts`, `tests/e2e/hotas.e2e.test.ts`, `tests/e2e/audio-space.e2e.test.ts`, `tests/e2e/rain.e2e.test.ts`.

### `__bh.preset(name: string)` → void

Loads a scene by its key in `__bh.presets` (the same as `#scene=…` at start, see above). Every setting goes back to `defaultSettings()` except the kept ones (the `pref` and `carried` kinds, `KEEP_ON_PRESET` in `main.ts`), then the scene's fields apply. Through `applyPreset` it also stops the mission, the voices, the callouts, the score and the music, resets the camera (`newFlight`), leaves the spectator, sets the scene's `time` when it has one, and refreshes the GUI. Unknown names are not reported: `presets[name] ?? {}` gives the defaults.

```js
(__bh.setDate(Date.UTC(2026, 9, 1, 12)), __bh.preset("Earth: the Blue Marble"), __bh.touch(), 1)
```
*Used in:* `tests/e2e/rates.e2e.test.ts`, `tests/e2e/ellipsoid.e2e.test.ts`, `tests/e2e/golden.e2e.test.ts`.

### `__bh.presets` → object `Record<string, Preset>` (about 80 keys)

The built-in scenes. Each value is a partial `Settings` plus `time?`, `mission?`, `pose?` (a body view such as `"iss"`, `"earth"`, `"fleet"`, or `{ body, at:[lat,lon], altKm, look, … }`), and `issDistance?`. Tests add or override a scene by writing a key and then loading it with `preset`.

```js
__bh.presets["WGS84 polar audit"] = { ...__bh.presets["Earth: the Blue Marble"], animate: false, pose: { body: "earth", at: [90, 0], altKm: 400, look: "earth" }, earthClouds: 0 };
__bh.preset("WGS84 polar audit"); __bh.touch();
```
*Used in:* `tests/e2e/planet-detail.e2e.test.ts`, `tests/e2e/ellipsoid.e2e.test.ts`, `tests/e2e/rates.e2e.test.ts` (it reads `presets[name].time`).

### `__bh.scenes()` → string[]

The built-in scene names: `Object.keys(presets)`. Use it to loop over every scene No test or script calls it: `scripts/gallery.ts` reads `presets` itself.

### `__bh.settings` → `Settings` (object, about 257 fields)

The live settings of the view and the game: every field of `src/settings.ts` `Settings`, read and written directly (`__bh.settings.spin = 0.5`). Writes take effect on the next frame; after a write, call `__bh.touch()` (redraw) or `__bh.refresh()` (rebuild the panels and buttons). `preset` resets every field to `defaultSettings()` except the kept ones (see `__bh.preset`), so a field the scene does not set comes back at its default, not at its last value. Units and defaults of the most used fields:

| field | type | unit / values | default | meaning |
|---|---|---|---|---|
| `spin` | number | a/M, dimensionless | 0.94 | the black hole's spin |
| `distance` | number | M | 36 | the camera's radius (Boyer–Lindquist) |
| `inclination` | number | degrees from the spin axis | 82 | the camera's polar angle |
| `azimuth` | number | degrees | 0 | the camera's azimuth |
| `fov` | number | degrees, vertical | 45 | field of view |
| `target` | Target | `"hole"`, `"star"`, `"wormhole"`, `"barycentre"`, a body (`"earth"`, `"moon"`, `"miller"`, `"iss"`, `"ranger"`, `"lander"`, `"endurance"`…) | `"hole"` | the body the camera orbits or aims at |
| `animate` | boolean | | true | the clock runs (`sim` moves time with `step`) |
| `timeSpeed` | number | M per second | 6 | the time warp (a multiple of the scene's real time) |
| `massSolar` | number | solar masses | 6.5e9 | the black hole's mass, for the physical readouts and the seconds per M |
| `exposure` | number | EV | 0 | exposure (0 = none); `autoExposure` is a separate switch |
| `targetSpp` | number | samples per pixel | 64 | samples of the converged still image |
| `adaptiveIntegrator` | boolean | | true | error-controlled RK4 in the converged pass |
| `noiseThreshold` | number | relative std error | 0.01 | adaptive sampling stop (0 = off) |
| `denoise` | boolean | | true | variance-guided filter on the accumulated image |
| `renderMode` | string | `"physical"` … | `"physical"` | the rendering model |
| `quality` | string | `"low"`, `"medium"`, `"high"`, `"ultra"`, `"realtime"`, `"game"` | `"high"` | quality preset (`QUALITY`) |
| `pixelRatio` | number | canvas ratio | min(devicePixelRatio, 1.5) | image resolution relative to the canvas |
| `temporalReprojection` | boolean | | true | realtime: the previous image carried over by the camera's rotation |
| `showFps` | boolean | | false | the frame rate shown in a corner |
| `autoWarp` | boolean | | true | a hub or manoeuvre sets the warp by itself |
| `disk` | boolean | | true | the accretion disk |
| `jet` | boolean | | true | the relativistic jet |
| `iss` | boolean | | true | the ISS on its real orbit near the Earth |
| `sun` | boolean | | false | a companion star |
| `system` | string | `"none"`, `"gargantua"` | `"none"` | the planetary system from the body registry |
| `wormhole` | boolean | | false | Interstellar's wormhole |
| `anchor` | string | `"hole"`, `"wormhole"` | `"hole"` | what the camera orbits |
| `whL` | number | M (< 0: our side) | -14 | camera position ℓ when orbiting the wormhole |
| `ship` | boolean | | false | the spaceship carrying the camera |
| `vessel` | string | `"ranger"`, `"lander"`, `"endurance"` | `"ranger"` | the craft flown |
| `shipMount` | string | attach point (`ship.ts` MOUNTS: `"quarter"`, `"cockpit"`, `"cabin"`, `"dorsal"`, `"chase"`, `"dock"`…) | `"quarter"` | where the camera sits on the craft (`refresh()` after a change) |
| `shipLookYaw` | number | degrees | 0 | free look: the camera turned on its mount |
| `navLights` | boolean | | false | the navigation lights |
| `nightLighting` | boolean | | false | the cabin lit red at night |
| `cabinLight` | number | 0 … 1 | 1 | the cabin's ceiling lights |
| `cockpitPages` | string | 8 page ids, comma-separated | `""` | each cockpit display's page (empty: automatic) |
| `autoGear` | boolean | | false | landing gear lowered and raised by itself below 600 m |
| `weather` | string | a weather preset (`weather.ts`) | `"fair"` | the weather flown through |
| `wind` | 0–3 | calm, light, moderate, strong | 1 | the wind and its turbulence |
| `damage` | boolean | | true | the air can destroy the craft |
| `flightMode` | string | `"rocket"`, `"plane"`, `"sf"` | `"plane"` | how the craft flies in the air |
| `antigrav` | boolean | | false | the flight computer's modes hold against gravity for free |
| `autosave` / `autosaveEvery` | boolean / number | s | true / 10 | the flight kept in the browser |
| `hudBank` | boolean | | true | the HUD's bank scale |
| `keyHints` | boolean | | true | the key hints strip |
| `uiScale` | number | 0.8 … 1.5 | 1 | interface scale |
| `voice` | boolean | | true | the voices spoken (callouts, mission control, TARS); off: subtitles only |
| `subtitles` | boolean | | true | the line being said, its speaker named |
| `sound` | boolean | | true | the sound |
| `soundVolume` | number | 0 … 1 | 0.7 | master volume |
| `soundVoice` | number | 0 … 1 | 0.9 | voices volume |
| `soundMusic` | number | 0 … 1 | 0.6 | score volume |
| `music` | boolean | | true | the score at the flight's great moments |
| `tarsOnline` | boolean | | true | TARS through OpenRouter when a key is there |
| `tarsModel` | string | OpenRouter model id | `"z-ai/glm-5.3-flash"` | the model TARS thinks with |
| `tarsWake` | boolean | | true | his reflexes and rules wake him |
| `tarsRemarks` | boolean | | true | TARS speaks unasked at the flight's moments |
| `tarsHonesty` | number | 0 … 100 % | 90 | his honesty |
| `tarsHumour` | number | 0 … 100 % | 75 | his humour |
| `tarsBudget` | number | USD per hour | 0.05 | what his own initiatives may cost |
| `tarsEar` | string | `"auto"`, `"deepgram"`, `"browser"` | `"auto"` | what hears the pilot |
| `tarsEarModel` | string | `"nova-3"`, `"nova-2"` | `"nova-3"` | Deepgram's recognition model |
| `tarsEarLang` | string | `"game"`, `"fr"`, `"en"`, `"multi"` | `"game"` | the language heard |
| `tarsVoiceEngine` | string | `"auto"`, `"deepgram"`, `"robot"`, `"system"` | `"auto"` | his voice |
| `radioVoiceEngine` | string | `"auto"`, `"deepgram"`, `"system"` | `"auto"` | mission control's and the tower's voices |
| `haptics` | number | 0 … 1 | 0.6 | the controllers' vibrations |
| `dynamicResolution` | boolean | | false | lower the render scale when the GPU misses its budget |

Not in the table (see `Settings` in `src/settings.ts`, about 257 fields): the thin disk and jet parameters (`diskTemp`, `jetLorentz`…), the hot spot, the polarization, the wormhole's water, the HUD aids (`hud*`), the gear and the atmosphere's details, the TARS and sound details.

*Used in:* `tests/e2e/cockpit.e2e.test.ts`, `tests/e2e/audio-space.e2e.test.ts`, `tests/e2e/smoke.e2e.test.ts`, `tests/e2e/rates.e2e.test.ts` (`settings.target`, `settings.shipMount`, `settings.weather`, `settings.massSolar`, `settings.timeSpeed`, `settings.wind`, `settings.vessel`, `settings.voice`).

### `__bh.resize()` → void

Re-reads the canvas size and resizes the renderer's targets to `pixelRatio` times the canvas, then redraws. With dynamic resolution on, the ratio is capped to the hardware tier's pixel budget, and the renderer's targets follow the current render scale. Call it after a change of `pixelRatio` or `uiScale`, or when the window's size changed in a test. No e2e test calls it directly.

### `__bh.forceScale(x: number | null)` → void

Holds the render scale for the image (0.25 … 1, values out of range are clamped), upscaled by the display; `null` releases it to the governor. No caller in `src/bench/`, `tests/` or `scripts/` was found. Calls `resize()` itself.

### `__bh.spectate(on: boolean)` → boolean

Puts the camera out of the ship as a free spectator (`on: true`; the ship goes on flying) or back into it (`false`). Returns whether the spectator is out. Refused with a toast ("fly one first (K)") when no craft is being flown: the spectator starts only from a piloted ship (`startSpectator` in `controller/spectator.ts`). No e2e test calls it.

### `__bh.snapshot(name?: string)` → Promise<Response>

Exports the current view as a PNG (`renderer.exportPNG(settings)`) and POSTs it to the dev server at `/__snapshot?name=…` (`snapshots/<name>.png`, default name `"snapshot"`). The POST goes to `server.ts`, which answers 404 `disabled` outside dev (the `fetch` does not throw). Run it in the dev server only.

```js
await __bh.snapshot("pass-2")
```
*Used in:* no e2e test and no script in `tests/` or `scripts/` calls it.

### `__bh.render(name: string, preset: string | null, patch?: Partial<Settings>, o?: Partial<OfflineOptions> & { time?: number })` → Promise<string>

An offline still at 1920 × 1080, 128 samples per pixel by default, after `applyPreset(preset)` and the `patch`. It waits for the Earth's maps and terrain (up to 30 s), then runs the offline job to the end (`renderer.startOffline`), saves `snapshots/<name>.png` and returns `"<name>: <seconds> s"`. Throws on a renderer error, returns `"cancelled"` when cancelled. `animate: false`, `exposure: 0` and `renderMode: "physical"` are set first, then the `patch` on top. `o.time` is the scene time of the still (default: the current `sim.time`).

```js
await __bh.render("hero", "Kerr a=0.94, near edge-on", { exposure: 0.3 }, { width: 1920, spp: 128 })
```
*Used in:* no e2e test (the offline renders are for the sets of pictures).

### `__bh.video(name: string, o?: { seconds?: number; fps?: number; rate?: number; path?: (u: number) => Partial<Settings> } & Partial<OfflineOptions>)` → Promise<string>

A video of the current view: each frame an offline render at the scene's time advancing by `rate` M per second of video (`rate` defaults to `settings.timeSpeed`). With `path(u)` (u from 0 to 1) the camera moves frame by frame instead; without it the scene runs live, stepped by the video at 1/60 s. H.264 in an MP4, posted to `snapshots/<name>.mp4`. Progress is in `videoState`. Returns `H.264 at W×H not supported` as its result (it does not throw) when the browser has no encoder. It sets `settings.timeSpeed` to `rate` for the video and restores it afterwards. Defaults: 10 s, 30 fps, 1920 × 1080, 24 spp.

```js
__bh.video("pass", { seconds: 10, fps: 30, rate: 8, width: 1920, height: 1080, spp: 24, path: (u) => ({ azimuth: 40 + 12 * u }) })
```
*Used in:* `tests/e2e/gpu-startup.e2e.test.ts` (an injected failure, one second at 1 fps, to test that a failed video leaves the game alive).

### `__bh.videoState` → `{ frame, frames, started, done, result }`

The last video's progress: `frame` (frames done), `frames` (total), `started` (performance.now ms), `done` (boolean), `result` (the message: `"<name>.mp4: N frames in S s"`, `"cancelled"`, or the error text).

*Used in:* no direct e2e read; the video's own status.

### `__bh.captureScenes(names?: string[], maxMs?: number)` → Promise<number>

For each scene: applies its defaults and the scene (`quality: "high"`), waits until it converges (still scenes; flights and missions get 9 s), crops the picture to 16:9, 640 × 360, and posts it to `snapshots/scene-<slug>.webp`. Returns the number of scenes. Then run `bun scripts/scene-thumbs.ts`. `maxMs` (default 14 000) caps the wait for a still scene.

```js
await __bh.captureScenes(["Earth: sunset from orbit"])
```
*Used in:* `scripts/gallery.ts` (one scene at a time, line 226); `scripts/scene-thumbs.ts` only mentions it in its comments.

### `__bh.skyLoading` → Promise<unknown>

The real sky's loading (`renderer.loadSky()`), resolved once it is in (it redraws then). A failure is caught and logged, so the Promise resolves in every case: the procedural sky is used when the real one is not there. Await it before a sky screenshot.

### `__bh.mx` → object

The multiple-exposure runners the game wires into the automation (PLAN-CIEL C8): `runAnalemma`, `runEclipse`, `runTrails`, `runMoonPath`, `runIss`, `issPasses`, `planEclipse`, and the `host` and `dialog` objects of the multiple-exposure feature. This entry only names them; their own arguments are not documented here.

### `__bh.graphicsDiagnostic()` → object

The GPU diagnostic report (`gpu-diagnostics.ts`): `version`, `timestamp`, `status`, `stage`, `elapsedMs`, the adapter and the events (`events[].message`), and `previousIncompleteSession` when the last session ended unexpectedly. The same report the page downloads as `graphics-diagnostic.json`.

```js
__bh.graphicsDiagnostic().events.filter((e) => e.message.includes("after the first image")).length === 2
```
*Used in:* `tests/e2e/gpu-startup.e2e.test.ts` (4 lines use it).

### `__bh.gpu` → object

The GPU device's handle: `lose()`, `generation()`, `lost()`, `frames()` (below). Use them to test the loss and recovery.

### `__bh.gpu.frames()` → `{ completedFrames, firstFrameDoneAt, durationsMs }`

Completed GPU submissions (not browser animation callbacks): their count, the performance.now ms of the first finished frame, and the recent frame durations in ms.

```js
__bh.gpu.frames().completedFrames > 30
```
*Used in:* `tests/e2e/gpu-recovery.e2e.test.ts`.

### `__bh.gpu.generation()` → number

The renderer's generation: 1 at start, plus one for each renderer made again on a new device after a loss.

*Used in:* `tests/e2e/gpu-recovery.e2e.test.ts`.

### `__bh.gpu.lose()` → void

Destroys the device on purpose (`renderer.simulateLoss()`): the page then recovers, with a new generation, as a reset (not a reload). Used to test the recovery.

```js
(__bh.gpu.lose(), true)
```
*Used in:* `tests/e2e/gpu-recovery.e2e.test.ts`.

### `__bh.gpu.lost()` → string | null

The loss's reason when the device is lost (null while it is up).

*Used in:* `tests/e2e/gpu-recovery.e2e.test.ts`.

### `__bh.renderer` → `Renderer` (class, about 340 members)

The renderer (`src/renderer.ts`). The members the tests read:

| member | type | meaning |
|---|---|---|
| `firstFrameDoneAt` | number | performance.now ms when the first GPU frame finished (0 before) |
| `completedFrames` | number | GPU submissions finished |
| `gpuErrors` | number | uncaptured GPU errors so far (0 expected) |
| `lost` | string \| null | why the device is lost, or null |
| `generation` | number | the renderer's generation (see `gpu.generation`) |
| `pipelineStatus` | object | the compile states: `general`, `quality`, `qualityError`, `lut`, `lutQuality` (`"pending"`, `"ready"`… ) |
| `variantReady` | boolean | the scene's specialised tracer compiled (or none needed) |
| `earthSettled` | boolean | the Earth's maps and terrain tiles are in and nothing is loading |
| `tier` | `{ level, capMpx, label }` | the hardware tier and its pixel budget |
| `adapter` | object \| null | the GPU adapter: `vendor`, `architecture`, `device`, `description`, `fallback`, `features` (sorted), `limits` |
| `device` | GPUDevice | the WebGPU device (private in the source; read at run time: `device.features.has(…)`, `device.limits`) |
| `frameTelemetry` | getter | the same figures as `gpu.frames()` |
| `offlineActive` | boolean | an offline render is running |
| `offlineState` | `{ width, height, progress, spp, targetSpp, elapsed, eta, paused, done, error? }` \| null | the running offline render's progress |
| `startOffline(s, time, opts)` / `cancelOffline()` | methods | start or cancel an offline render (used by `render` and `video`) |
| `exportPNG(s)` / `exportRGBA(s)` | Promise | the current image as a PNG Blob, or RGBA pixels |
| `effectiveQuality(s)` | method | the quality the renderer uses for `s` on this tier |
| `simulateLoss()` | method | the device destroyed on purpose (`gpu.lose`) |
| `ship` | ShipRenderer | the spaceship's renderer: `cabinShown` (the cabin is on screen), `cabinRay(x, y)` and `cabinProject(p)` (cabin ndc ↔ ray/point) |
| `rain`, `rainClock` | object, number | the rain (weather): its state and clock |
| `weatherReal` | WeatherState \| null | the airfields' real weather when it came in |
| `shipPose`, `shipPlace`, `shipThrust`, `shake` | state | the ship's pose, where it is drawn in a spectator's view, its thrust flame and the buffeting |
| `hdMap` | object (private) | the Earth's high-resolution map: `name`, `hasRelief`, `color` (`width`, `height`, `format`, `mipLevelCount`) |
| `earthMaps` | object (private) | the Earth's map set; `earthMaps.tier` (unclear: its type and meaning were not checked here) |
| `prof` | GpuProfiler | the GPU profiler (`enabled`) |
| `lastFrameDoneAt` | getter | when the GPU last finished a frame (performance.now ms) |

Hooks set by the page (not read by tests): `onLost`, `onGpuError`, `onAssets`. `resize(w, h)` takes the pixel size of the image (the page calls it through `__bh.resize`).

*Used in:* `tests/e2e/gpu-startup.e2e.test.ts` (`renderer.pipelineStatus.quality`, `firstFrameDoneAt`), `tests/e2e/reload.e2e.test.ts` (`gpuErrors`), `tests/e2e/planet-detail.e2e.test.ts` (`hdMap.hasRelief`).

### `__bh.sim` → `Simulation` (class, `src/sim.ts`)

The simulation's step, shared by the live loop, `__bh.step` and the video.

| member | type | meaning |
|---|---|---|
| `time` | number | the scene's time [M] (the bodies, the disk, the ship's flight) |
| `play` | number | the playback clock [s]: the flames' flicker and the liquid's waves; frozen when time is paused |
| `timeDirty` | boolean | the scene's time moved since the last frame |
| `mission` | `{ update(dt) }` \| null | the mission, stepped with the camera |
| `setTime(t)` | method | sets the scene's time [M] (same as `__bh.setTime`) |
| `step(dt)` | method | one step of `dt` s; returns whether the camera moved |
| `applyRender(info)` | method | what the renderer draws of the flight; returns whether the image must be redone |

```js
__bh.sim.setTime(c.nowTime()); __bh.step(0);
```
*Used in:* `tests/e2e/wormhole-map.e2e.test.ts` (`sim.setTime`, then `step(0)` to refresh the display), `tests/e2e/smoke.e2e.test.ts` (`sim.time`).

### `__bh.pwa` → `Pwa` (object, `src/pwa.ts`)

The page's Service Worker (the offline cache, PLAN-MONDE M1). It is registered only when the page allows it: not in the e2e tests unless `App.boot({ sw: true })` (adds `&sw=1`), not on the dev server's reload, not on the benchmark page (`#bench`). Entries below.

### `__bh.pwa.ready()` → Promise<boolean>

Resolves to `true` once the worker controls the page (the cache's content is not checked here: unclear whether the shell is in it); `false` when the worker is not registered or failed.

```js
await __bh.pwa.ready()
```
*Used in:* `tests/e2e/pwa.e2e.test.ts`.

### `__bh.pwa.stats()` → Promise<{ build, shell, tiles, tileBytes, tileBudget } | null>

The cache's figures: the build's id, the shell's number of files, the tiles cached and their bytes against the budget. `null` when the worker does not answer (3 s).

```js
(await __bh.pwa.stats())?.tiles > 5
```
*Used in:* `tests/e2e/pwa.e2e.test.ts`.

### `__bh.pwa.clearTiles()` → Promise<void>

Empties the tiles' cache (the terrain tiles the worker kept). Used by a test that starts from an empty cache.

### `__bh.pwa.registration` → ServiceWorkerRegistration \| null

The registration, or null when the page does not register the worker (see above).

### `__bh.pwa.waiting` → boolean

True when a new build is installed and waiting: a toast then asks the user to reload.

### `__bh.pwa.update()` → void

Makes the waiting worker take over (`skip-waiting`); the page then reloads onto the new build. Does nothing when none waits.

### `__bh.hud` → object

The HUD's room (`ui/hud/layout.ts`). Its one member is `boxes()`.

### `__bh.hud.boxes()` → `Box[]`

The panels shown on the screen and the boxes the HUD's canvas drew this frame, in CSS px: `{ x, y, w, h, id }` (`id` is the panel's class such as `.fl-tel`, or an instrument's name). `boxes()` calls `remeasure()` first, so the panels are measured afresh on each call (the 250 ms cache of `panels()` is bypassed). The "nothing overlaps" test reads them: boxes that overlap are a bug.

```js
const boxes = __bh.hud.boxes(); // expect boxes.length > 5 when the HUD is up
```
*Used in:* `tests/e2e/hud-layout.e2e.test.ts` (after a save is imported and 2.5 s of settling).

### `__bh.mapView()` → `{ dist, yaw, pitch, focus: number[] }` \| null

The flight's 3D map view: its distance and angles, the goal the map's gestures set. Null when the flight HUD has no map. The map is open with `document.querySelector(".fl-root.mapview")`.

```js
const d0 = (await app.js("__bh.mapView()")).dist;
```
*Used in:* `tests/e2e/touch.e2e.test.ts` (the pinch and the drag on the map).

### `__bh.phase()` → `FlightPhase` \| null

The flight's phase (`game/phase.ts`): `{ mode, control, stage, detail }`, e.g. `{ mode: "flight", control: "manual", stage: "orbit", detail: "" }`. Null when there is no phase yet.

```js
__bh.phase().control === "hold"
```
*Used in:* `tests/e2e/smoke.e2e.test.ts`.

### `__bh.relief(body: string, lat: number, lon: number)` → number

The height of the ground above the body's mean radius, at a latitude and an east longitude in degrees, in metres (the relief the craft stands on; the Earth's comes from its streamed tiles, so it reads correctly once they are in). Used to wait for the ground before a landing. It is 0 for a body with no relief function.

```js
await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 60_000); // Edwards
```
*Used in:* `tests/e2e/landing.e2e.test.ts`, `tests/e2e/callouts.e2e.test.ts`, `tests/flight/scenarios/helpers.ts`.

### `__bh.goTo(b: Target)` → string \| null

Points the free camera at a target (the camera panel's "Go to"): null when it went, or the reason in a string when it did not (the Ranger flown: "the planner (O), the autopilot (0: approach)"; a craft of the fleet outside the Gargantua wormhole scenes). Works the same with a spectator out.

```js
__bh.goTo("earth")
```
*Used in:* no e2e test; the camera panel calls it.

---

## The game's tools — `__bh.game`

`__bh.game` is the `GameTools` instance (src/game/tools.ts) behind the F2 window. It places the Ranger (in orbit, on the ground, beside a body, at a state), sets the target, the clock and the warp, reads the status, manages saves and settings, and keeps the journal. Units: heights in km, angles in degrees, speeds in m/s, times in seconds of sim time, scene time `t` in M (geometric units: `M_SECONDS` seconds each). Placement and time calls are synchronous and return a note string unless stated; they need a scene with the game's world (`__bh.freeze(false)` or `__bh.freeze(true)` as the test needs), and Gargantua's planets need a Gargantua-system scene (`settings.system === "gargantua"`).

### `__bh.game` — class instance (GameTools)

| member | type | meaning |
|---|---|---|
| `status()` | function → RangerStatus | the Ranger's state (see below) |
| `orbit(body, o)` / `orbitOver` / `orbitTarget` | function | put the Ranger in orbit |
| `land(body, lat, lon)` / `hoverOver` / `near` / `wormhole` | function | put it on a ground, at rest over a place, beside a body, before a mouth |
| `glideTo(site, …)` | function | on a runway's approach, the entry autopilot lands it |
| `target(id)` · `targets()` | function | the target and the valid ids |
| `warp(x)` · `pause(on)` · `realTime()` · `setDate(d)` · `date()` · `now()` · `jumpTo(t)` | function | time |
| `set(key, v)` · `get(key)` · `settings()` · `quality(q)` | function | settings and quality levels |
| `preset(name)` | function | a scene |
| `save` · `load` · `saves` · `deleteSave` · `snapshot` · `exportSave` · `importSave` · `shareLink` · `autosaveNow` | function | saved games |
| `perf()` · `audit({planner})` · `help()` | function | performance, self-checks, the list of tools |
| `log` | object | the journal (`log.events`, `log.text()`) |
| `lastAudit` | field | the last audit report (null until run) |
| `errors` | private field, read at runtime | uncaught errors since the page loaded (an array of strings) |
| `ctx`, `lastStatus`, `error`, `hover`, `shipOn` | private | see their entries; callable at runtime |

Prefer the tests' own forms: `__bh.game.orbit("earth", { altKm: 400, inc: 51.6 })`, `__bh.game.glideTo("Edwards")`, `__bh.game.status().label`.

### `__bh.game.audit` → Promise<AuditReport>

Runs the self-checks (settings finite, ephemeris, ship state, SOI agreement, Kepler vs free fall, save round trip, frame rate, light and exposure steadiness, errors; with `planner: true` also the flight planner on the target). Async: `await` it. Sets `__bh.game.lastAudit` and writes an `audit` event to the journal (its `data` is the report). Slow (it samples frames); not used by any e2e test.

```js
const rep = await __bh.game.audit({ planner: false });
// rep = { at, sceneDate, checks: [{ id, name, verdict: "pass"|"warn"|"fail"|"skip", detail, value?, ms? }], counts: { pass, warn, fail, skip } }
```
*Used in:* none under tests/e2e or scripts.

### `__bh.game.autosaveNow()` → unclear (the store's setJSON result)

Writes the autosave slot now, from `snapshot("autosave")`. The game autosaves every `autosaveEvery` s (setting range 2–120, default 10; Settings › Game › Saved games).

```js
__bh.game.autosaveNow();
```
*Used in:* none.

### `__bh.game.bodies(universe?)` → array

`universe` is `"ours"` or `"gargantua"` (default: the ship's side). Ours: `[{ id, name, parent, radiusKm, soiKm, distKm, altKm }]` for the 27 solar bodies (distance and altitude are NaN when the ship has no reference frame). Gargantua's: `[{ id, name, parent, radiusKm }]`.

```js
__bh.game.bodies("ours").find((b) => b.id === "moon").distKm   // km from the ship to the Moon's centre
```
*Used in:* none.

### `__bh.game.ctx` → object (GameContext)

The context given to the tools by main.ts: `{ settings, camera, renderer, time(), setTime(t), preset(name), changed(keys), refresh(), toast(text), fps(), renderScale(), scene: { get(), set(name) } }`. Private field; use the other tools instead. (Writing to it is not a supported path.)

*Used in:* none.

### `__bh.game.date()` → string

The scene's date now, UTC, `"YYYY-MM-DD HH:MM"`.

```js
__bh.game.date()   // "2026-10-10 12:00"
```
*Used in:* `tests/e2e/time.e2e.test.ts`, `tests/e2e/eclipses.e2e.test.ts`.

### `__bh.game.deleteSave(name)` → void

Removes the named slot from the browser's saves (journal entry `save`). An unknown name is not an error.

```js
__bh.game.deleteSave("before TMI");
```
*Used in:* none.

### `__bh.game.error(msg)` → void

Private in the class, callable at runtime: pushes `msg` to `__bh.game.errors` and writes an `error` event to the journal. The window's `error` and `unhandledrejection` listeners call it.

*Used in:* none.

### `__bh.game.errors` → string[]

Uncaught errors since the page loaded: the window `error` and `unhandledrejection` events, as text (a private field, read as a plain array).

```js
__bh.game.errors.length   // 0 when clean
```
*Used in:* `scripts/live-entry.ts` (`__bh.game.errors?.length`).

### `__bh.game.exportSave(name?)` → string

Downloads a save as a JSON file (`name` a slot, `"autosave"`, or omitted for a snapshot named `"ranger"`) and returns its name. Triggers a browser download (`downloadSave`).

```js
__bh.game.exportSave("before TMI");
```
*Used in:* none.

### `__bh.game.get(key)` → the setting's value

Reads one setting by its key (the keys of the settings schema: `src/settings.ts`).

```js
__bh.game.get("crashSpeed")
```
*Used in:* none.

### `__bh.game.glideTo(site, distKm = 80, altKm = 25, speed = 750, o = {})` → string

Places the Ranger on the approach of one of our worlds' sites, `distKm` km out on the runway's line (its final into the wind when the wind blows along it), `altKm` km up, flying at `speed` m/s; the entry autopilot's glide takes it from there. The first argument (the parameter is `name`) is matched by case-insensitive substring of a site's name (`SITES`); no match throws with the list. Our worlds only (Gargantua's throw). `o.acrossKm` (km, positive to the right of the line) and `o.headingDeg` (degrees, positive clockwise; course relative to the runway's). Sets `camera.entrySite` and the `entry` auto mode. Synchronous.

```js
__bh.game.glideTo("Edwards");                                   // defaults: 80 km out, 25 km up, 750 m/s
__bh.game.glideTo("Edwards", 30, 5, 220);                       // closer, slower
__bh.game.glideTo("Edwards", 6, 0.25, 120);
__bh.game.glideTo("Edwards", -5, 6, 250, { headingDeg: 180 });  // (as landing.e2e.test.ts: distKm negative, course reversed)
```
*Used in:* `tests/e2e/landing.e2e.test.ts`, `gear.e2e.test.ts`, `runway-wind.e2e.test.ts`, `approach-charts.e2e.test.ts`, `assist-entry.e2e.test.ts`, `assist-handover.e2e.test.ts`, `assist-final.e2e.test.ts`, `audio-space.e2e.test.ts`, `hotas-flight.e2e.test.ts`, `cockpit-flight.e2e.test.ts`, `callouts.e2e.test.ts`, `rain.e2e.test.ts`, `tests/e2e/lib/flights.ts`, `tests/flight/scenarios/landing.ts`, `smoke.ts`, `tests/flight/lib/quality.ts`.

### `__bh.game.help()` → string[]

Prints the list of the tools to the console and returns it as an array of lines (one per tool, with its signature in brief).

```js
__bh.game.help().length
```
*Used in:* none under tests/e2e or scripts.

### `__bh.game.hover()` → void

Private in the class, callable at runtime: re-engages the hover autopilot at rest where the Ranger is (`pilot.auto` "none", then "hover"). `hoverOver`, `near` and `wormhole` call it.

*Used in:* none directly.

### `__bh.game.hoverOver(body, lat, lon, altKm = 1.5)` → string

Places the Ranger `altKm` km (default 1.5) above one of our solid bodies' ground at latitude / east longitude (degrees), at rest over it (carried by the planet's turning), and engages the hover autopilot. G lands it from there (a powered landing's last minutes). Our worlds only.

```js
__bh.game.hoverOver("moon", 0.674, 23.473, 1.5);   // over Tranquility Base
```
*Used in:* `tests/e2e/tars-eval.e2e.test.ts`, `tests/flight/scenarios/vertical.ts`.

### `__bh.game.importSave(json, store = true)` → string

Parses a save from its JSON text, stores it in a slot (unless `store` is false), loads it, and returns its summary. Throws on a bad file.

```js
(__bh.freeze(false), __bh.game.importSave(${JSON.stringify(json)}, false), true)
```
*Used in:* `hub-graph.e2e.test.ts`, `hub-card.e2e.test.ts`, `report.e2e.test.ts`, `telemetry.e2e.test.ts`, `hud-layout.e2e.test.ts`, `saves.e2e.test.ts`, `scripts/hud-gallery.ts`.

### `__bh.game.jumpTo(t)` → `{ date, planDropped }`

Sets the scene's clock to `t` [M] and carries the ship with the world: on our side it keeps its orbit or its place over its body; by a mouth it stays against it; on Gargantua's side it keeps its place in the world's frame; landed, it stays where it stands. A plan made on the old clock (nodes, burns, an entry) is dropped and `planDropped` is true. Also journals the change.

```js
__bh.game.jumpTo(__bh.game.now() + 1000);   // t in M: 1000 M later (`M_SECONDS` from src/units.ts, re-exported by src/system/solar.ts, gives the seconds per M)
```
*Used in:* none under tests or scripts (`setDate` calls it).

### `__bh.game.land(body, lat = 0, lon = 0)` → string

Puts the Ranger on the ground at latitude / east longitude (degrees). Our solid bodies, or Gargantua's worlds (`miller`, `mann`, `edmunds`: lat / lon on the world's frame, x away from Gargantua, z its pole; needs the Gargantua-system scene). `gargantua` has no ground and throws.

```js
__bh.game.land("earth", 28.573, -80.649);            // KSC pad
__bh.game.land("moon", 0.674, 23.473);               // Tranquility Base
__bh.game.land("mars", 18.44, -102.55);
```
*Used in:* `tests/e2e/weather-panel.e2e.test.ts`, `eclipses.e2e.test.ts`, `multiexposure.e2e.test.ts`, `pwa.e2e.test.ts`, `spectator.e2e.test.ts`, `assist-climb.e2e.test.ts`, `metar.e2e.test.ts`, `tars-eval.e2e.test.ts`, `assist-handover.e2e.test.ts`, `tests/flight/scenarios/gargantua.ts`, `vertical.ts`.

### `__bh.game.lastAudit` → AuditReport | null

The last `audit()` report (null until one ran). Shape: see `__bh.game.audit`.

*Used in:* none.

### `__bh.game.lastStatus` → `{ soi, status }` | null

Private bookkeeping of the journal: the last sphere of influence and status seen by `watch()`. Not for tests.

*Used in:* none.

### `__bh.game.load(g, o = {})` → string

Restores a saved game: `g` is a slot's name, `"autosave"`, or a `GameSave` object (from `snapshot()`). Own preferences (budget, display, sound, aids) stay the player's; the scene, the ship, the fleet, the plan and the clock come from the save. `o.quiet` keeps it out of the journal. Returns the save's summary. Throws `no saved game "<g>"`.

```js
const save = __bh.game.snapshot("test");
__bh.game.load(save, { quiet: true });
```
*Used in:* `prefs.e2e.test.ts`, `wormhole-map.e2e.test.ts`.

### `__bh.game.log` → GameLog

The journal. Members:

| member | type | meaning |
|---|---|---|
| `events` | LogEvent[] | the events, oldest first (at most 2000; the oldest dropped) |
| `text(dateOf?)` | function → string | one line per event: wall clock, scene date (when `dateOf` is given), kind, text |
| `add(kind, text, t?, data?)` | function → LogEvent | writes an event |
| `on(f)` | function → unsubscribe | calls `f` on each new event |
| `clear()` | function | empties the journal |

#### Event shape (`__bh.game.log.events[i]`)

| field | type | meaning |
|---|---|---|
| `at` | number | `Date.now()`: the wall clock, ms |
| `t` | number | the scene's time [M] (NaN when none) |
| `kind` | `"info"` \| `"pilot"` \| `"phase"` \| `"soi"` \| `"status"` \| `"place"` \| `"save"` \| `"audit"` \| `"warn"` \| `"error"` | what it is |
| `text` | string | the message (`pilot` events: the pilot's spoken lines, e.g. `"Touchdown …"`, `"Landing · … — B ("`) |
| `data?` | unknown | an extra payload: for `audit`, the AuditReport |

```js
__bh.game.log.events.filter((e) => e.kind === "pilot").map((e) => e.text)
__bh.game.log.events.filter((e) => e.kind === "phase").at(-1)?.text ?? ""
__bh.game.log.events.some((e) => /Landing · .* — [ABCDF] \(/.test(e.text))
```
*Used in:* `worlds.e2e.test.ts`, `landing.e2e.test.ts`, `gear.e2e.test.ts`, `hotas-flight.e2e.test.ts`, `approach-charts.e2e.test.ts`, `assist-entry.e2e.test.ts`, `runway-wind.e2e.test.ts`, `smoke.e2e.test.ts`, `report.e2e.test.ts`, `tests/flight/lib/lab.ts`.

### `__bh.game.near(body, o = {})` → string

Places the Ranger beside a body at rest, targets it, and engages the hover autopilot. Ours: `o.altKm` (km above the surface; default two of its radii). Gargantua's: `o.rM` (M, its distance from the hole's centre; `"gargantua"` targets the hole).

```js
__bh.game.near("moon", { altKm: 3 });
__bh.game.near("moon", { altKm: 20000 });
__bh.game.near("jupiter", { altKm: 50000 });
__bh.game.near("gargantua", { rM: 12 });   // a static observer 12 M from Gargantua
```
*Used in:* `assist-approach.e2e.test.ts`, `assist-descent.e2e.test.ts`, `assist-handover.e2e.test.ts`, `place-docked.e2e.test.ts`, `tests/flight/scenarios/orbit.ts`.

### `__bh.game.now()` → number

The scene's time now [M] (`ctx.time()`).

*Used in:* `tests/flight/scenarios/dock.ts`, `tests/flight/scenarios/missions.ts`.

### `__bh.game.orbit(body, o = {})` → string

Puts the Ranger in orbit around a body (ours, or Gargantua's side). Options (`OrbitPlacement` + `rM`):

| field | unit | meaning |
|---|---|---|
| `altKm` | km | a circular orbit's height above the surface; or the periapsis/apoapsis below |
| `peKm`, `apKm` | km | the periapsis and apoapsis heights (above the surface) |
| `inc` | ° | inclination, relative to the body's equator (the Sun: the ecliptic) |
| `raan` | ° | the node's longitude (Ω) |
| `argPe` | ° | argument of periapsis (ω) |
| `nu` | ° | true anomaly: where on the orbit the ship is |
| `retrograde` | boolean | turning against the body's spin |
| `rM` | M | Gargantua only: a Kerr circular orbit's radius (default 12) |

If that body was the camera's target, the target moves to the Sun (for our bodies other than the Sun) or to the hole (Gargantua's). For the Sun itself the code passes `"hole"`, which is not a solar id (unclear whether that is intended: `src/game/tools.ts`, `orbit`). Throws for an unknown body (lists the ids) or a Gargantua planet outside the Gargantua-system scene.

```js
__bh.game.orbit("earth", { altKm: 400, inc: 51.6 });
__bh.game.orbit("earth", { peKm: 300, apKm: 600, nu: 60 });
__bh.game.orbit("earth", { peKm: 300, apKm: 420, inc: 20, nu: 165 });
__bh.game.orbit("earth", { altKm: 400, inc: 40 });
__bh.game.orbit("gargantua", { rM: 12 });   // Kerr circular orbit
```
*Used in:* `time.e2e.test.ts`, `landing.e2e.test.ts`, `cockpit.e2e.test.ts`, `assist-burn.e2e.test.ts`, `hub-warp.e2e.test.ts`, `tars-eval.e2e.test.ts`, `assist-handover.e2e.test.ts`, `tests/flight/scenarios/gargantua.ts`, `landing.ts`, `orbit.ts`, `smoke.ts`.

### `__bh.game.orbitOver(body, lat, lon, o = {})` → string

An orbit passing over a place now (latitude / east longitude, degrees): the node and anomaly are found, the inclination raised to the latitude if lower. `o` takes `inc`, `argPe`, `retrograde`, `altKm` / `peKm` / `apKm` (not `raan` or `nu`, which are found).

```js
__bh.game.orbitOver("earth", 48.86, 2.35, { altKm: 400, inc: 51.6 });   // passing over Paris now
```
*Used in:* `tests/flight/scenarios/vertical.ts`.

### `__bh.game.orbitTarget(altKm?)` → string

Orbit around the current target at its default height (or `altKm`, km). For Gargantua's hole, no height is passed: the Kerr default (`rM` 12).

```js
__bh.game.target("moon"); __bh.game.orbitTarget();
```
*Used in:* none.

### `__bh.game.pause(on = true)` → "Paused" | "Running"

Stops or resumes the scene's clock (sets `settings.animate`).

```js
__bh.game.pause(false);   // running
__bh.game.pause(true);    // frozen
```
*Used in:* `rain.e2e.test.ts`.

### `__bh.game.perf(o = {})` → object

Where the frame's time goes. `o.gpu !== false` (the default) switches on the GPU timestamps the first time (read again a few seconds later). Returns:

| field | meaning |
|---|---|
| `loopFps`, `renderFps`, `worstLoopMs`| the loop's and the rendered frame rates; the worst loop time [ms] |
| `gpuFrameMs`, `gpuPassesMs`, `gpuProfiled`, `gpuSupported` | GPU time per frame, its passes' total, the frames profiled, whether timestamps are supported |
| `image` | the canvas size, e.g. `"1920×1080"` |
| `pixelRatio`, `renderScale`, `quality`, `budgetMs`, `block` | the pixel ratio, dynamic-resolution fraction, quality level, the realtime frame budget [ms], realtime block |
| `tier` | the renderer's tier |
| `cpu` | `[{ section, ms, worst }]` main-thread sections |
| `gpu` | `[{ pass, ms, last, frames }]` GPU passes |

```js
const p = __bh.game.perf(); [p.loopFps, p.worstLoopMs, p.tier]
```
*Used in:* `scripts/ipad.ts` (`loopFps`, `worstLoopMs`, `tier`).

### `__bh.game.pilotState()` → string

The pilot's modes in one line, e.g. `"SAS · auto hover · throttle 0 % · landed"` (the hold appears only when one is set), or `"not flying (the Ranger off)"`.

```js
__bh.game.pilotState()
```
*Used in:* `tars-agent-live.e2e.test.ts`, `tars-eval.e2e.test.ts`.

### `__bh.game.placeAt(pose)` → string

Puts the Ranger at a state, the restart of its flight there. `pose`: `{ frame, X, vel, fwd, up, landed?, note }`:

| field | meaning |
|---|---|
| `frame` | `"ours"` (the home frame; needs the wormhole scene), `"hole"` (Gargantua's Boyer–Lindquist map), `"mouth"` (by the far mouth, on Gargantua's side) |
| `X`, `vel`, `fwd`, `up` | 3-vectors: position, velocity (ours: d/dt; hole: β along the ZAMO axes), forward and up directions (unclear: the units of `X` per frame; read `src/game/place.ts`, or take the vectors from `snapshot()`) |
| `landed?` | `{ body, q }` when on a body |
| `note` | a line for the journal and the toast (required) |

Throws when the scene is not loaded: `"ours"` and `"mouth"` need the wormhole scene (`settings.wormhole`).

*Used in:* `tests/flight/scenarios/dock.ts`, `missions.ts`.

### `__bh.game.preset(name)` → void

Loads a scene by name (`"game:artemis"`, `"game:interstellar"`, `"Earth: docking to the ISS"`, …). The app applies the scene after the call (unclear whether it is complete on return; the tests wait with `await new Promise((r) => setTimeout(r, 3000))`). Journals `Scene: <name>`.

```js
__bh.game.preset("game:artemis"); await new Promise((r) => setTimeout(r, 3000));
__bh.game.preset("Earth: docking to the ISS");
```
*Used in:* `worlds.e2e.test.ts`, `dock-undock.e2e.test.ts`, `audio-space.e2e.test.ts`, `scripts/trace-ab.ts`, `tests/flight/scenarios/helpers.ts`. (`tars-eval.e2e.test.ts` calls the root `__bh.preset`, the same scene loader.)

### `__bh.game.quality(q)` → string

Applies a quality level's budgets (`QUALITY[q]`: samples, steps, integrator tolerance, realtime budget ...) and sets `settings.quality`. `q` is one of `"low"`, `"medium"`, `"high"`, `"ultra"`, `"realtime"`, `"game"` (≈ 60 fps); throws for another name.

```js
__bh.game.quality("game");
__bh.game.quality("realtime");   // ≈ 15 fps (the comment in src/settings.ts)
```
*Used in:* none under tests/e2e or scripts.

### `__bh.game.realTime()` → "Warp ×1"

Same as `warp(1)`: real time.

*Used in:* none.

### `__bh.game.save(name?)` → string

Snapshots the game into a named browser slot and returns the name (default: `"Save <locale date>"`). Journals it. Throws if the browser refuses the storage.

```js
__bh.game.save("before TMI");
```
*Used in:* none under tests/e2e or scripts.

### `__bh.game.saves()` → `{ name, summary, savedAt }[]`

The named slots, newest first. `summary` is the one-line state (`"Earth · IN ORBIT 400 km · 2026-10-10 12:00"`); `savedAt` a locale string.

```js
__bh.game.saves().map((g) => g.name)   // the slots' names, newest first
```
*Used in:* `smoke.e2e.test.ts`.

### `__bh.game.set(key, value)` → value

Sets a setting by key (the keys of `src/settings.ts`), routed as the panel does (`changed([key])`: re-trace, resize ...). Throws `no setting "<key>"` for an unknown key.

```js
__bh.game.set("uiScale", 1.25);
__bh.game.set("hudPalette", "okabe");
__bh.game.set("reduceMotion", true);
__bh.game.set("crewG", 5);
__bh.game.set("soundHeadphones", true);
__bh.game.set("haptics", 0.6);
```
*Used in:* `a11y.e2e.test.ts`, `audio-space.e2e.test.ts`, `hotas.e2e.test.ts`.

### `__bh.game.setDate(d)` → string

Sets the scene's clock: `d` an ISO string (`"2067-06-01T12:00"` without `Z` is UTC) or a number [M]. Returns the new date (`"YYYY-MM-DD HH:MM"`). The bodies move; the ship keeps its place (via `jumpTo`).

```js
__bh.game.setDate("2026-01-01T12:00:00Z");
__bh.game.setDate(new Date().toISOString());
__bh.game.setDate("2067-06-01T10:30:00");
```
*Used in:* `eclipses.e2e.test.ts`, `multiexposure.e2e.test.ts`, `rain.e2e.test.ts`, `metar.e2e.test.ts`, `tests/flight/scenarios/airports.ts`. (`dock-undock` and `audio-space` use the root `__bh.setDate`.)

### `__bh.game.settings()` → object

A shallow copy of all the settings (the full `Settings` object).

```js
__bh.game.settings().weather
```
*Used in:* none.

### `__bh.game.shareLink()` → string

The URL carrying this moment (`#save=…`, the plan left out).

*Used in:* none.

### `__bh.game.shipOn()` → void

Private in the class, callable at runtime: turns the Ranger on (`settings.ship = true`) if it was off. `placeAt` does it too.

*Used in:* none.

### `__bh.game.snapshot(name = "autosave")` → GameSave

A save object, not stored: `{ v: 2, name, savedAt, summary, scene, settings, time, ship: { piloting, sas, hold, auto, throttle, precision, speedMode, landed, spent, spentBy, properTime, tunnelEntry, entrySite, entryPlan }, fleet, plan, camera }`. Its `settings` are the scene's and what it carries (not the player's own). Pass it to `load()`.

```js
__bh.game.snapshot("wx").settings.weather   // a scene setting, e.g. the weather
const save = __bh.game.snapshot("test"); __bh.game.load(save, { quiet: true });
```
*Used in:* `weather-panel.e2e.test.ts`, `wormhole-map.e2e.test.ts`, `prefs.e2e.test.ts`, `tests/flight/lib/lab.ts`.

### `__bh.game.soi()` → object

The sphere of influence the ship is in and the chain of its primaries up to the Sun (ours):

```js
// { body, name, soiKm, altKm, chain: [{ id, name, soiKm }] }
__bh.game.soi().chain.map((c) => c.id)   // e.g. ["moon", "earth", "sun"]
```
*Used in:* none.

### `__bh.game.status()` → RangerStatus

The Ranger's state, the same figures as the Ranger tab. Units: km, m/s, s.

| field | type | meaning |
|---|---|---|
| `side` | `"ours"` \| `"gargantua"` \| `"throat"` | which side of the wormhole |
| `soi`, `soiName` | string | the body of the sphere of influence (`"earth"`), its name |
| `soiKm` | number | its radius from the body's centre [km] (∞ for the Sun) |
| `status` | `"landed"` \| `"flight"` \| `"suborbital"` \| `"orbit"` \| `"escape"` \| `"hyperbolic"` \| `"throat"` \| `"plunge"` \| `"bound"` \| `"unbound"` | what the ship does |
| `label` | string | its display label: `"LANDED"`, `"IN FLIGHT"`, `"SUBORBITAL"`, `"IN ORBIT"`, `"ESCAPING"`, `"HYPERBOLIC"`, `"IN THE THROAT"`, `"PLUNGING"`, `"KERR ORBIT"`, `"UNBOUND"` (translated in the UI) |
| `altKm` | number | above the body's surface [km] (over the figure) |
| `speed` | number | speed relative to the body [m/s] |
| `vVert` | number | vertical speed [m/s] |
| `orbit` | OrbitFigures \| null | null when landed; see below |
| `target` | `{ id, name, distKm, rate, caKm, caIn }` \| null | distance [km], rate [m/s] (sign: unclear), closest approach [km] and its time [s] (`caKm`, `caIn`; NaN on Gargantua's side) |
| `next` | `{ kind: "exit"\|"enter"\|"impact"\|"mouth", body, name, inS }` \| null | the next event on the free-fall path; `inS` in s |
| `kerr` | `{ r, E, L }` \| null | Gargantua's side, far from the planets: r [M], energy, angular momentum |

`orbit` (OrbitFigures): `peKm`, `apKm` (lowest and highest heights over the surface [km], geodetic); `peNu`, `apNu` (their true anomalies [rad]; apNu NaN unbound); `incDeg` [°]; `ecc`; `period` [s] (∞ unbound); `tPe`, `tAp` [s] (time to the apsides); `aKm` (semi-major axis [km]); `radiusKm` (equatorial radius, for drawing); `circular` (`{ km, swingKm }` when near-circular: the height over the mean radius and its swing, else null).

```js
const s = __bh.game.status();
s.label                       // "IN ORBIT"
s.orbit.peKm, s.orbit.apKm    // km
s.altKm * 1000                // metres above ground
```
*Used in:* `smoke.e2e.test.ts` (label), `time.e2e.test.ts` (soi, peKm, apKm, incDeg), `spectator.e2e.test.ts` (`soi`, `altKm`, `status`), `tars-agent-live.e2e.test.ts`, `tars-eval.e2e.test.ts`, `golden.e2e.test.ts`, `rates.e2e.test.ts`, `assist.e2e.test.ts` (`speed`), `assist-climb.e2e.test.ts` (`altKm`), `place.e2e.test.ts` (side, soi), `gpu-recovery.e2e.test.ts`, `a11y.e2e.test.ts`, `saves.e2e.test.ts`, `place-docked.e2e.test.ts`, `worlds.e2e.test.ts`, `scripts/ipad.ts`, `scripts/live-entry.ts`.

### `__bh.game.target(id)` → string

Targets a body (ours: the solar ids; Gargantua's: `hole`, `miller`, `mann`, `edmunds`, `k2`), `"wormhole"`, or `"iss"` (in the `Target` type; unclear whether every scene accepts it). Throws `<name> is not in this universe`. Returns `"Target: <name>"`. Does not move the camera (`focus: false`).

```js
__bh.game.target("iss");
__bh.game.target("mars");
```
*Used in:* `tests/e2e/place-docked.e2e.test.ts`, `dock-undock.e2e.test.ts`, `tars-eval.e2e.test.ts`, `tars-agent.e2e.test.ts`, `tests/flight/scenarios/dock.ts`, `gargantua.ts`, `missions.ts`, `orbit.ts`.

### `__bh.game.targets()` → string[]

The ids the target can take: on our side the 27 solar bodies and `"wormhole"`; on Gargantua's `["hole", "miller", "mann", "k2", "edmunds", "wormhole"]`.

*Used in:* none.

### `__bh.game.warp(x)` → "Warp ×x"

Runs the clock at `x` times real time (`settings.timeSpeed`, animation on). `x <= 0` pauses (returns `"Paused"`).

```js
__bh.game.warp(1000);
__bh.game.warp(30);
__bh.game.warp(1);   // real time
```
*Used in:* `landing.e2e.test.ts`, `assist-burn.e2e.test.ts`, `cockpit.e2e.test.ts`, `assist-handover.e2e.test.ts`, `tests/flight/scenarios/gargantua.ts`, `landing.ts`, `missions.ts`, `orbit.ts`.

### `__bh.game.watch(st)` → void

Public. Journals the changes of the sphere of influence (`soi`) and of the status (`status`), given a RangerStatus. Called each tick by the main loop while the Ranger flies (`src/main.ts`) and by the F2 window (`src/ui/gametools.ts`); tests do not need it.

*Used in:* none.

### `__bh.game.wormhole(side = "ours", dM?)` → string

Places the Ranger before a mouth of the wormhole, `dM` [M] from the mouth's centre (default: the approach's stand-off), at rest, targets the mouth, engages the hover autopilot. `"ours"` (our side's mouth: the home frame's origin) or `"gargantua"`. Needs a scene with the wormhole (`settings.wormhole`).

```js
__bh.game.wormhole("gargantua");
__bh.game.wormhole("ours");
```
*Used in:* `tests/flight/scenarios/gargantua.ts`.

---
Section counts: 48 `__bh.game.*` paths plus `__bh.game` itself.

---

## The ship, its flight, the world

The flown craft and its controller (`__bh.camera`, the `pilot` flight computer and the air model), the fleet and the
station, the flight's record and mission, the sky and the cabin. Units are the sim's own unless said otherwise:
**M** = 1 M = GM/c² of the hole, `M_METRES` = 1.476625e11 m, `M_SECONDS` = 492.5490947 s (src/units.ts, re-exported by
src/system/solar.ts); **c** = C_MPS = 299792458 m/s. So a length in M × 1.476625e11 = metres, a time in M × 492.549 = seconds,
a speed in c × 299792458 = m/s. Frames: the **home frame** is our universe (our side of the wormhole, its mouth at the
origin): positions in M, velocities in c, times in M of the sim clock (`__bh.time()`). The **body-fixed** frame turns with a body.
The **hole frame** is Gargantua's Cartesian frame (Boyer–Lindquist `r, θ, φ` in M on the hole's side).

### `__bh.camera` → CameraController (the flight controller)

The camera and the ship flown. About 480 members (src/controls.ts, plus src/controller/*.ts mixed in). Only the members tests
use are tabled below; the rest are internal. Most functions are synchronous and read the live state, so call them after
`__bh.freeze(true)` or `__bh.step(dt)` when a test needs a settled frame. Async (return a Promise): `missionPlan`, and `planOurs` (the planner's core, not tabled).

| member | type | meaning |
|---|---|---|
| `piloting` | boolean | the Ranger is flown (on whenever the ship is). |
| `pilot` | FlightComputer | the flight computer; see the table below. |
| `hubInfo()` | → HubInfo \| null | the hub card: `mode`, `title`, `phase`, `rows: [label, value, severity?][]` (severity "warn" or "bad", optional), `next` (the prediction, "→ …", or null), `bar` (phase progress 0…1 or null), `graph`, `cue`, `say`. Cached 250 ms. |
| `flightInfo()` | → FlightInfo | the HUD figures for this frame (a partial list: also `dv`, `accel`, `railsNote`, `rollAlign`, `precision`, `hub`, `plan`, `engine`, `planes`, and more, see src/controller/telemetry.ts): `region` ("hole" \| "throat"), `r, theta, phi` (BL, M), `ell, n` (throat), `speed` [c], `gamma`, `dtau`, `E, L, Q`, `spin`, `vr`, `rH, isco, photon` [M], `ergo`, `wantSpeed` [c], `throttle` (0…1), `sas`, `hold`, `auto`, `assist`, `director`, `omega`, `properTime`, `landed`, `landedOn`, `dirs` (camera coords), `ourAlt` [M], `ourVr`, `ourCa`, `targetDist`, `targetRate`, `target`, `ref`, `dock`, `dockPhase`, `links`, `vessel`, `assembly`, `mass` [kg], `map`, `surface`, `air`, `entry`. |
| `airFlight` | AirFlight | the air model of the flown craft: `g` (load, in g: the current), `gPeak`, `heatPeak`, `skin` (thermal), `inAir` (getter), `reset(vessel, T?)`. |
| `airFlight.cfg.flaps` | number 0…1 | the flaps setting, as the aero model reads it (`cfg: AeroConfig`, `{}` by default, all fields optional: `flaps`, `brake` 0…1, `gear` (boolean), `agl` [m], `deflect`; so `flaps` may be undefined until set). Used by 7 test lines (`airFlight.cfg.flaps`). |
| `airFlight.failure` | string \| null | set when a limit is passed (the craft is lost): `"<craft>: broke up under N g (its limit …)"`, `"<craft>: the heat shield failed at … K (its limit …)"`, `"<craft>: the hull burnt through at … K (its limit …)"`; null while fine. |
| `spent` | number (get/set) | the Δv the flown craft's engines spent since its tank was filled, in units of c (multiply by `C_MPS` for m/s, as `gargantua.ts` does). Set to `1e12` to empty the tank (`smoke.e2e.test.ts`). Stored per craft in `fleet.spent`. |
| `spectating` | boolean (readonly) | a spectator view is out (the free camera, the ship flying on). |
| `weatherReal` | WeatherState \| null (settable) | the real weather over the flight, when the setting is "real" (source "metar" \| "model" \| "random" \| "preset"; `visibility` [m], `layers`, `model.T`). |
| `weatherRealInfo` | RealInfo \| null | why the real weather is or is not in use (`why`, e.g. "out-of-range"). |
| `docked` | boolean (getter) | the flown craft is held by the station (directly or through craft docked to it). |
| `landed` | boolean | the camera stands on a star's surface (gravity on). |
| `ourLanded` | `{body, q}` \| null | our side: resting on a body's ground (`q`: its coordinates). |
| `gearDown` / `gearExt` | boolean / number 0…1 | landing gear commanded down, and its extension (8 s each way). |
| `nowTime()` | → number | the sim time now [M] (the ship's time once it is set). |
| `activePoseNow(evenOff?)` | → Pose & {t} \| null | the flown craft's place [M, c] and axes at `nowTime()`. |
| `ourNav(cam)` | → nav \| null | our side's navigation state: `X` [M], `V` [c] (home frame), `t` [M], `ref` (reference body), `refPos`, `refVel`, `radial`. Needs `cameraFrame(settings)` as argument: from the page use `__bh.sys.nav()`. |
| `attitudeNow()` | → `{pitch, bank, heading}` [rad] \| `{}` | the flown craft's attitude over the ground below (bank: right positive). |
| `thrustMax()` | → number | the engine's maximum proper acceleration [c²/M]; 0 once the tank is empty. |
| `fcPlan()` | → `{burns, note, executing}` \| null | the flight computer's plan. Each burn: `t` [s from now], `dv` [m/s, 3 components: prograde, normal, radial], `label`. `executing` true while it flies. |
| `fcExecute()` | → string \| null | starts the planned burns (node autopilot on our side or about the hole; the "burns" autopilot elsewhere). Returns null when started, else why not ("No burns planned"). |
| `fcSetPlan(burns, note)` | → string \| null | adopts a plan (as returned by a planner: `burns` with `t`, `dv`, `label`). Same return convention. |
| `fcKerrInfo()` | → `{o, t, Msec, Mm, a}` \| null | the orbit about the hole (Kerr): `Msec` [s per M], `Mm` [m per M], `a` = spin. Null unless about the hole. |
| `missionPlan(spec)` | → Promise `{ok, note, burns, dvTotal, arrive, afterText}` \| `{ok:false, note}` | plans a mission: `spec = {target, arrival?: "orbit" \| "flyby" \| "freeReturn", altKm?, retKm?, orbit?}`. Async. |
| `missionCommit()` | → string \| null | adopts the previewed mission into the plan (null: done; string: why not). |
| `undock()` | → void | releases the flown craft from its links; the springs push it 5 cm/s off the first port. Nothing if not docked. |
| `runwayView()` | → RunwayView \| null | the runway in reach as the eye sees it (`RunwayView`, src/controls.ts: directions in camera coordinates, distances [m]: `name`, `along`, `across`, `agl`, `papi`, `fix`, `wind`, `mls`, `site`, `fixes`, …). Cached 100 ms. |
| `goAround(why?)` | → boolean | starts a go-around (`why`: `{what: "axis" \| "high" \| "low", by}`), false if it cannot. Only during the entry autopilot's glide to a runway (`pilot.auto === "entry"`, not already going around, not rolling out); otherwise false. |
| `requestWarp(speed)` | → void | the pilot's warp (×speed, the time bar's value); capped by the autopilot's ceiling. |
| `setWarpAuthority(auto)` | → void | sets `settings.autoWarp`. `true`: the hub (or the manoeuvre) sets the warp while an autopilot flies; `false`: the pilot sets it, below the autopilot's ceiling. Clears the hub's and the node's pending warp wishes. |
| `setLook(yaw, pitch)` | → void | turns the camera on its mount, degrees (yaw wraps, pitch clamped to ±85); the ship stays put. Used in cockpit tests to aim at a control. |
| `planTransfer(goal, r2?, o?)` | → string | plans a transfer to `"orbit" \| "star" \| "wormhole"`. `r2` (default 30) is the orbit's radius in M, floored at max(1.02 × ISCO, horizon + 2 M); with the Crew engine it is a low-thrust plan (`o.orbitStar` for the star). Returns a message string. |

Flight computer: `__bh.camera.pilot` (src/pilot.ts, class FlightComputer). Members of the object, as tests use them:

| member | type | meaning |
|---|---|---|
| `pilot.throttle` | number 0…1 | the main engine's command. Clamped to 0…1 each step; the stick moves it at up to 0.6/s (0.15/s precision). Writes take effect at once (`hotas.e2e.test.ts` sets it to 0.2, `gargantua.ts` to 1 and 0). |
| `pilot.engineNow` | number 0…1 | the engine's thrust now, as a share of its maximum (lags the command: spool). |
| `pilot.accel` | number [c²/M] | last proper acceleration. |
| `pilot.omega` | [number, number, number] [rad/s] | body rates about the ship's x (left), y (up), z (nose). |
| `pilot.fired` | object | what fired last step: `throttle`, `rcs`, `rcsSide`, `turn`, `yaw`, `at`, `force`, `torque`. |
| `pilot.sas` | boolean | stability assist (default true). Toggled by a key or the cockpit's SAS control (`title.e2e.test.ts`, `cockpit.e2e.test.ts`). |
| `pilot.hold` | Hold | an attitude hold: `"none"`, `"prograde"`, `"retrograde"`, `"radialOut"`, `"radialIn"`, `"normal"`, `"antinormal"`, `"target"`, `"antiTarget"`, `"maneuver"`. |
| `pilot.auto` | Auto | the autopilot engaged: `"none"`, `"hover"`, `"circularize"`, `"approach"`, `"orbit"`, `"node"`, `"transfer"`, `"land"`, `"takeoff"`, `"dock"`, `"entry"`, `"burns"`. |
| `pilot.setAuto(a)` | → void | toggles the autopilot `a`: when `a` is already engaged it goes to `"none"`. Clears the anchor. When not assisted, it also clears the hold; when it switches off (or is assisted) the throttle goes to 0. Examples: `__bh.camera.pilot.setAuto("takeoff")`, `__bh.camera.pilot.setAuto("dock")`, `tests/flight/scenarios/helpers.ts:41` (`auto = "none"` then `setAuto(auto)`). |
| `pilot.setHold(h)` | → void | toggles the hold `h`: same hold → `"none"`. When not assisted and a hold is set, it clears the autopilot. Example: `__bh.camera.pilot.setHold("retrograde")`. |
| `pilot.assist` | boolean | assisted: the autopilots compute their cue (`director`) but the pilot flies. Off: they fly (`assist.e2e.test.ts:21`, `:30`). |
| `pilot.director` | Director \| null | the assisted cue, in camera coords: `nose`, `up` (unit vectors or null), `throttle`, `rcs`, `align`. Null when none. |
| `pilot.rollAlign` | boolean | rolls the wings into the orbital plane while the nose is pointed. |
| `pilot.precision` | boolean | fine rotation and throttle (as Caps Lock). |
| `pilot.anchor` | V3 \| null | the position an autopilot holds (set when it engages). |

Valid values, from src/pilot.ts: `Hold` = none, prograde, retrograde, radialOut, radialIn, normal, antinormal, target,
antiTarget, maneuver. `Auto` = none, hover, circularize, approach, orbit, node, transfer, land, takeoff, dock, entry, burns.
An unknown name is not checked: it is stored, and nothing flies it.

*Used in:* `tests/e2e/smoke.e2e.test.ts:48`, `tests/e2e/hotas.e2e.test.ts:84`, `tests/e2e/assist.e2e.test.ts:21`,
`tests/flight/scenarios/helpers.ts:41`, `tests/flight/scenarios/gargantua.ts:259`, `tests/flight/scenarios/missions.ts:25`,
`tests/flight/scenarios/dock.ts:28`, `tests/flight/scenarios/orbit.ts:235`.

### `__bh.fleet` → Fleet (src/fleet.ts)

The craft (`ranger`, `lander`, `endurance`), their poses, their docking links and the propellant. Positions are in the
home frame [M], velocities in [c]; times in M.

| member | type | meaning |
|---|---|---|
| `active` | VesselId (get/set) | the flown craft: `"ranger"`, `"lander"` or `"endurance"`. |
| `free` | `Partial<Record<VesselId, FreeState>>` | the coasting craft: a Pose (`X` [M], `V` [c], `ax`, `w`) plus `t` [M] and `ref` (the body it coasts about). Example: `__bh.fleet.free.lander` (`orbit.ts:383`). |
| `links` | DockLink[] | the docking links: `a`, `b` (craft, or "iss" for `a`), `pa`, `pb` (port indices), `c`, `ax`. `__bh.fleet?.links?.length` (`lab.ts:73`). |
| `pose(id, t, fromStation?, exact?)` | → Pose \| null | a craft's pose at `t` [M] in the home frame. `exact` (default): integrates when near the body. Example: `__bh.fleet.pose("endurance", t)` (`dock.ts:69`). |
| `flownAssembly()` | → VesselId[] | the flown craft's assembly, the station left out. Example: `__bh.fleet.flownAssembly().includes("endurance")` (`dock.ts:88`). |
| `assembly(id)` | → (VesselId \| "iss")[] | the craft (and the station) docked with `id`, `id` included. |
| `heldByStation()` | boolean | the flown craft's assembly is held by the station. |
| `massProps(root?)` | `{mass, …}` | the assembly's mass [kg] and its centre. |
| `massLeft(id)` | number 0…1 | a craft's mass now over its full mass (its propellant burnt). |
| `spent` | `Partial<Record<VesselId, number>>` | per craft: the Δv spent, in c (see `__bh.camera.spent`). |
| `tanks` | `{exhaust, massRatio}` \| null | the tanks' model. |
| `others(t, all?)` | → `{id, pose}[]` | the other craft's poses at `t`. |
| `coast(f, t, exact?)` | → Pose | (private in src/fleet.ts; the test calls it anyway: `orbit.ts:387`) a free craft's pose at `t` from its `FreeState` (`exact` default true: integrates near a body). |

*Used in:* `tests/flight/scenarios/dock.ts:69-88`, `tests/flight/scenarios/orbit.ts:383-387`, `tests/flight/lib/lab.ts:73`.

### `__bh.mission` → Mission (src/mission.ts)

The scripted mission of the Interstellar scene (the Ranger on our side of the wormhole): its phases, its captions. Phases in
order, by `key`: `start`, `ignition`, `throat`, `arrival`, `raise`, `orbit`, `align`, `transfer`, `star`.

| member | type | meaning |
|---|---|---|
| `active` | boolean | the mission runs. |
| `phase` | string (getter) | the current phase's key (above); `""` when not active. |
| `captionText` | `[string, string, string]` (getter) | the three caption lines on screen; `["", "", ""]` when the caption is off. |
| `start()` | → void | sets the scene itself (the ship on, the wormhole and the Sun on, target = wormhole, the pilot on, the ship placed on the mouth's axis, its light raised), then begins the first phase. Not "already applied". |
| `stop(why?)` | → void | ends it: restores the geodesic display and the ship's light, centres the look, hides the caption, calls `onEnd`; `why` is said as a message. Does nothing if not active. |
| `update(dt)` | → void | advances it by `dt` [s of wall clock] while `settings.animate` is on (paused: it waits). Called by the simulation each step (src/sim.ts). |

*Used in:* `tests/flight/scenarios/gargantua.ts:171-172` (`lab.fixed({until: "!__bh.mission.active"})`, then `captionText`),
`tests/flight/lib/lab.ts:77` (`__bh.mission.phase`).

### `__bh.recorder` → FlightRecorder (src/game/recorder.ts)

The tablet's telemetry record: the flight's figures against the scene's time, in SI. The record keeps the whole flight,
coarser as it grows (`step` doubles each time it fills). A new flight (reset in src/controller/piloting.ts), or the time going back (a load, a jump), starts it again.

| member | type | meaning |
|---|---|---|
| `samples` | RecSample[] | the record. Each: `t` [s, scene time], `alt` [m] (NaN about the hole), `speed` [m/s], `vz` [m/s], `g` [g], `q` [Pa], `mach`, `heat` [W/m²], `throttle` (0…1), `dv` [m/s, spent since the flight began], `fuel` (0…1 or null). |
| `step` | number [s] | the least time between two samples. |
| `window(seconds)` | → RecSample[] | the last `seconds` of the flight (`Infinity`: all). |
| `csv()` | → string | the record as CSV, with a header, one row per sample, SI units. |
| `reset()` | → void | empties it. |

*Used in:* `tests/e2e/telemetry.e2e.test.ts:21` (`__bh.recorder.samples.length > 6`), `:39` (`__bh.recorder.csv()`).

### `__bh.ourState(id, t)` → `{pos, vel, dtau}`

A body's place and velocity in the home frame (our side) at time `t` [M]. `id` is a body name of Gargantua's system
(`"sun"`, `"earth"`, `"moon"`, `"jupiter"`, …). `pos` in M, `vel` in c, `dtau` the body's clock rate. Synchronous.
It is `bodyState(GARGANTUA_SYSTEM, id, t)` (src/system/our-side.ts), the same as `__bh.sys.bodyState`.

```js
// as missions.ts does, inside app.js(`…`)
const t = __bh.game.now(), iss = __bh.iss.orbit(t), E = __bh.ourState("earth", t);
```
*Used in:* `tests/flight/scenarios/missions.ts:32`.

### `__bh.sys` (the system: the hole's frame, our side, the geodesy)

An object of helpers for the frames and the navigation. Each member is listed below.

### `__bh.sys.bodyState(id, t)` → `{pos, vel, dtau}`

The same as `__bh.ourState`: a body of Gargantua's system at coordinate time `t` [M]; `pos` [M], `vel` [c]. Synchronous.

### `__bh.sys.geodetic()` → `{body, lat, lon, altM, radiusM} | null`

Where the camera is over the body it is nearest, on our side: `lat`, `lon` in degrees, `altM` = height over the ellipsoid [m],
`radiusM` = the body's radius [m]. Null about the hole, when the camera is not on our side, or when the nearest body is the Sun (no surface to measure). Synchronous.

```js
const G = L ? null : __bh.sys.geodetic();   // tests/flight/scenarios/vertical.ts:49
```

### `__bh.sys.homePosition()` → `[x, y, z] | null`

The camera's place in the home frame [M] (our universe, the mouth at the origin), when it is in the throat on our side
(`ell < 0`); null otherwise.

### `__bh.sys.look(id)` → look direction

Where the camera sees body `id` (CPU geodesics, retarded, aberrated): the `look` vector of `bodyLook`. (unclear: the frame of
the returned vector, read `bodyLook` in src/ — camera coordinates is the likely one.)

### `__bh.sys.mouth(t?)` → `Mouth`

The wormhole's mouth at time `t` [M] (default: the scene's time): `C` (its centre, BH frame, M), `ex`, `ey`, `ez` (the mouth's
axes), `w` (its metric), `V` (the centre's coordinate velocity, c), `rGlue`, `lGlue`, `lFar` (in M and ℓ). Synchronous. Mostly for the frame conversions.

### `__bh.sys.nav()` → nav \| null

The flown craft's navigation state on our side, the same as `__bh.camera.ourNav` with the camera's frame: `X` [M], `V` [c]
(home frame), `t` [M], `ref`, `refPos`, `refVel`, `radial`. Null elsewhere. What the autopilots fly from. (No test uses it yet.)

### `__bh.sys.predictClosest(id, days = 5)` → `{km, t, steps} \| null`

The planner's own prediction (no node) from the flown craft's state: its closest approach to body `id` within `days` days.
`km` = height above its surface [km], `t` = the time of that approach [M], `steps` = the path's points. Null if no state or not
within reach. Synchronous.

### `__bh.sys.predictAt(X, V, t, nodes, tAt)` → `{X, V, t}`

The planner's coast (`predictOurs`) from a state `X` [M], `V` [c] at time `t` [M], with burn `nodes` `{t, dv: [P, N, R]}`
(M and c), to the time `tAt` [M]; returns the state there. Use it to compare a planned burn with a flown one (the lab).

### `__bh.sys.setHolePose(settings, X, fwd, up?, vel?)` → void

Writes a pose as a camera orbiting the hole: `X` is the position in the hole frame [M] (Cartesian), `fwd` and `up` unit vectors,
`vel` the camera's 3-velocity [c]. The **first argument is the settings object** (`__bh.settings`), as the tests pass it
(`tests/lowthrust-orbit.test.ts:24`, `tests/wormhole-flight.test.ts:23`). It writes into the settings; redraw with `__bh.touch()`.

### `__bh.sys.setHomePose(X, fwd, up?, vel?)` → void

The same, on our side of the wormhole: the **home frame** [M] (our mouth at the origin, beyond its throat); `X` [M], `fwd` and `up`
unit vectors, `vel` [c]. No settings argument (the settings are captured). Writes the pose into the settings
(src/camera.ts `setHomePose`); redraw with `__bh.touch()`.

```js
// tests/wormhole-arrival.test.ts:43 (vitest, direct import): X = our mouth's x + r, fwd -x, up +z, vel -0.01 c along x
__bh.sys.setHomePose([M0 + r, M1, M2], [-1, 0, 0], [0, 0, 1], [-0.01, 0, 0]);
```

### `__bh.iss` (the space station)

The station's orbit (SGP4 from the latest elements), the tracker the game flies it with, its geometry, and the start beside it.

### `__bh.iss.elements()` → Elements

The orbital elements in use: `epochMs` [ms, UTC], `n` [rev/day], `e`, `i` [deg], and the others (SGP4's mean elements). Fetched once
and cached 6 h in the browser; a newer set replaces them. Synchronous.

### `__bh.iss.orbit(t)` → `{X, V} \| null`

The station's place and velocity at time `t` [M] in the home frame, on the Earth's own axes at the Earth's centre: `X` [M], `V` [c].
Null when its orbit has decayed in the propagation. Synchronous.

```js
const iss = __bh.iss.orbit(__bh.game.now());   // tests/flight/scenarios/missions.ts:32
```

### `__bh.iss.track` → IssTracker

The station the renderer and the game fly: `state(t, ship)` returns `{X, V}` at `t` [M], flown from its last state when the ship
is within reach (its own fall), else SGP4. `peek(t)` gives the place without changing the tracker. Fields: `near` (boolean),
`anchors` (times it was put back on SGP4).

### `__bh.iss.start(t, dist = 150, offset = [0, 0, 0])` → `{X, fwd, up, vel} \| null`

A start beside the station: the Ranger `dist` **metres** out along the axis of IDA-2 (Harmony's forward port), nose along that axis,
top to the zenith, its rear hatch to the port. `offset` [m, in the station's frame]. Returns the position `X` [M] and
`fwd`, `up` (unit), `vel` [c] in the home frame; null when the orbit has decayed. Use it to start a docking test:

```js
const p = __bh.iss.start(__bh.game.now(), 150, [0, 0, 0]);  // tests/flight/scenarios/dock.ts:14
```

### `__bh.iss.station` → `{joints, ports}`

The station's geometry (src/station.ts): its joints (the moving parts, their axes) and its ports (`name`, `centre`, `axis`, in the
station frame, m). The ports: "IDA-2 · Harmony forward", "IDA-3 · Harmony zenith".

### `__bh.iss.hulls` → `{ranger, station}`

The collision hulls (src/system/collide.ts): `ranger` is the Ranger's hull (an object with a `bvh`, as docking.ts reads it), `station` the
station's parts (an array of BVH or null).

### `__bh.sky` (the sky chart)

The chart of constellations and named stars (src/skychart.ts). Named stars and constellations are looked up on our side only.

### `__bh.sky.goTo(name)` → void

Turns the view to a constellation (by name or its abbreviation) or a named star (a name in `NAMED_STARS`). Unknown names throw
`no constellation or star named …`. On the ship it turns the look; off our side it shows a toast and returns.

### `__bh.sky.update()` → void

Rebuilds the chart now (a video frame). It is `updateChart(true)`.

### `__bh.sky.chart()` → ChartFrame \| null

What the chart drew this frame: `segs` (Float32Array of the line segments), `count`, `labels` (on screen, NDC), `picks` (the named
stars and constellations on the screen: `{kind, index, x, y}`, NDC), `figures` (for hovering a constellation), `horizon`.

### `__bh.cabinPick(ndcX, ndcY)` → CabinHit \| null

What a pixel shows in the Ranger's cabin. `ndcX`, `ndcY` in −1…1, y up. Returns the first cabin face along the ray: `t` (distance
from the eye, m), `p` (the point, ship frame, m), `n` (its normal, towards the eye), `mat` (the material id: 60 floor … 68 screens …
72 sticks, scripts/build-cockpit.ts), and on a screen: `screen: {slot, u, v}` (the display 0…7 and the point on it, 0…1).
Null when nothing is hit within 8 m (or the cabin is not loaded). Synchronous.

### `__bh.cockpitControlAt(id)` → `[x, y] \| null`

Where a cockpit control is in the view: the centre of its box, in NDC (−1…1, y up), or null when the control is not in the view.
`id` is one of: `gear`, `flaps`, `airBrake`, `dimmer`, `night`, `navLights`, `strobe`, `landingLights`, `autoTakeoff`, `autoCirc`,
`autoApproach`, `holdPrograde`, `holdRetrograde`, `holdTarget`, `assist`, `autoEntry`, `autoLand`, `sas`, `chrono`, `apOff`
(src/cockpit/controls.ts). Aim first with `__bh.camera.setLook(yaw, pitch)` (degrees).

```js
await app.js(`(__bh.camera.setLook(${yaw}, ${pitch}), true)`);
const n = __bh.cockpitControlAt("sas");   // then map NDC to CSS px, see tests/e2e/cockpit.e2e.test.ts:31
```
*Used in:* `tests/e2e/cockpit.e2e.test.ts:31`, `tests/e2e/cockpit-flight.e2e.test.ts:27`.

### `__bh.cockpitScreenPoint(slot, page)` → `[x, y] \| null`

A point of the view (NDC, y up) on display `slot` (0…7), on its tab for `page`. The view is scanned; null when the display is not in view.
`page` is one of the `PAGES`: `pfd`, `orbit`, `nav`, `systems`, `docking`, `plan`, `clocks`, `log`, `approach`, `landing`
(src/ui/cockpitscreens.ts).

```js
const n = await app.js(`__bh.cockpitScreenPoint(0, "orbit")`);   // tests/e2e/cockpit.e2e.test.ts:121
```

### `__bh.cockpitScreens` → CockpitScreens

The cabin's eight displays (canvas: 4 × 2 slots of 512 px, the PFD first). Its `pages` array holds each display's page (`PageId \| null`: null
is its automatic page, `SLOT_PAGE`: pfd, orbit, nav, systems, docking, plan, clocks, log). Methods: `setPage(slot, page)`, `clickScreen(slot, u, v)`,
`hoverScreen(slot, u, v)`, `pagesSetting()` (the setting's string), `message(text)`, `draw(d)`.

```js
__bh.cockpitScreens.pages[0]   // "orbit" after the test sets it (tests/e2e/cockpit.e2e.test.ts:131)
```

---

## Sound, voices, TARS, the bench

The sound (the Web Audio engine, the cockpit's and the mission's voices, the score), TARS (the in-game agent: his
model, his memory, his voice) and the Kerr Bench (the measure of the rendering). Sound needs a key press first
(the browser's rule: the context starts on a user gesture, so `__sound.ctx?.state === "running"` is the test's wait).
The online model of TARS needs an OpenRouter key; without it his answers are offline. Times are in ms unless said.

### `__bh.sound` → SoundEngine

The game's sound engine (`src/audio/engine.ts`, also `window.__sound`). It plays cues, places the sources in the
ship's space, and meters every bus. Nothing sounds until `ctx.state === "running"`; `play` is a no-op otherwise or
when the sound is off.

| member | type | meaning |
|---|---|---|
| `play(cue, arg?)` | `(cue: Cue, arg = 0) => void` | one cue of the flight computer or the interface (`sas-on`, `hold`, `warp-up`, `touchdown`, `boom`, `dock`, `transonic`, …; the full union is `Cue` in engine.ts) |
| `ctx` | `AudioContext \| null` | the Web Audio context (null before the first gesture) |
| `running` | `boolean` | the context is running |
| `level()` | `() => number` | the output's RMS now [dBFS] (`-Infinity` when unmetered) |
| `levels()` | `() => [number, number]` | left and right channels' RMS [dBFS] |
| `busLevels()` | `() => Record<string, number>` | each bus's RMS [dBFS] and the output `peak` |
| `busSpectrum(bus)` | `(bus: string) => number[] \| null` | a bus's spectrum now, dB per bin (0 … Nyquist) |
| `spaceState()` | `() => …` | the engine's panner, the rain, the cabin and the clusters (the spatial audio's state) |
| `setMix(m, enabled?)` | `(m: Partial<Mix>, enabled?) => void` | the buses' levels: master, beeps, engines, ambience, ui, voice, music |
| `setHeadphones(on)` | `(on: boolean) => void` | HRTF panners (headphones) or equal-power (speakers) |
| `radio(on, staticLevel?)` | `(on: boolean, staticLevel = 0) => void` | the radio's squelch and hiss on the voice bus |
| `alarm(id, on, kind?)` | `(id: string, on: boolean, kind?: "caution" \| "warning") => void` | a looping alarm, by id, until switched off (`kind` defaults to `"warning"`; off when the context is not running or the sound is off) |
| `stopRobot()` | `() => void` | cuts TARS's own voice now |

```js
// the score's test: a key starts the audio, then the music bus is heard
await app.press("KeyH", "h");
await app.waitFor(`__sound.ctx?.state === 'running'`, 10_000);
await app.js(`__sound.busLevels().music`); // dBFS of the music bus
```
*Used in:* `tests/e2e/music.e2e.test.ts`, `tests/e2e/audio-space.e2e.test.ts` (`__sound.levels()`, `__sound.spaceState()`), `tests/e2e/rain.e2e.test.ts`, `tests/e2e/tars-voice.e2e.test.ts` (`__sound.busLevels().voice`)

### `__bh.audio` → SoundDirector

The game's sound director (`src/audio/director.ts`): it turns the flight's state (the throttle, the RCS, the gear,
the air, the heating, the wheels on the ground) into the cues and the continuous sounds, each frame. It holds the
settings' mix (`applyMix()`), and `cue(c, arg?)` sends a cue to `__bh.sound` when the sound setting is on. Its
internal state (creaks, breaths, the spin) is private; read the output through `__bh.sound` instead.

| member | type | meaning |
|---|---|---|
| `cue(c, arg?)` | `(c: Cue, arg = 0) => void` | plays a cue through `__bh.sound.play` when `settings.sound` is on |
| `applyMix()` | `() => void` | re-sends the settings' mix to the engine |
| `update(dt, o)` | `(dt: number, o: {flying, live, info, status, fired, pose?, spectator?, thrust?, gear?, groundWind?, rain?}) => void` | called every frame by main.ts; `dt` in seconds, clamped to 0.1 s |

*Used in:* no e2e test reads it directly (the tests use `__sound` and `__bh.voice`).

### `__bh.voice` → Speech

The voices of the game (`src/audio/voice.ts`): callouts, mission control, the tower, TARS, the computer. A line is
shown as a subtitle, then said by the system voice (or by TARS's own voice, played by the game's audio). Lines queue
by priority; a more urgent line cuts the one being said. With `settings.voice` off, a line lasts its reading time
(`max(2.5 s, 0.9 s + 60 ms per character)`), which keeps the rhythm the same everywhere. The same happens when the browser has no speech synthesis, and on a test page (`?e2e=` in the URL: silent, timed and subtitled).

| member | type | meaning |
|---|---|---|
| `say(line)` | `(line: VoiceLine) => void` | asks a line; see below |
| `cut()` | `() => void` | cuts the line being said (its `onEnd` still runs) |
| `stop()` | `() => void` | cuts it and forgets the queue |
| `queue` | `VoiceQueue` | `current` (the line being said, or null), `waiting` (count), `push`, `next`, `done`, `clear` |
| `said` | `{text, speaker, at}[]` | every line said (the last 200), `at` in `performance.now()` ms |
| `asked` | `{id?, text, speaker}[]` | every line asked, said or not (the last 400) |

A `VoiceLine` is `{ text, speaker, priority, id?, radio?, ttl? }`: `speaker` is `"callout" | "mission" | "tower" |
"tars" | "computer"`; `priority` is 0 (the most urgent) to 3 (chatter), and a lower number cuts a higher one being
said; `id`: a line asked again with the same id within 4 s is dropped, and one with that id still waiting is replaced; `radio` adds the squelch and
the hiss; `ttl` drops a line still not started that many ms after it was asked.

```js
// a radio line from mission control, then chatter: the subtitle shows the speaker
await app.js(`(__bh.voice.stop(),
  __bh.voice.say({ text: "Ranger, Houston, you are go for entry.", speaker: "mission", priority: 2, radio: true }),
  __bh.voice.say({ text: "Fuel is fine. Probably.", speaker: "tars", priority: 3 }), true)`);
// a sink-rate callout cuts the line being said
await app.js(`(__bh.voice.say({ text: "Sink rate!", speaker: "callout", priority: 0 }), true)`);
await app.js(`__bh.voice.queue.current?.speaker ?? null`); // "callout"
```
*Used in:* `tests/e2e/voice.e2e.test.ts` (subtitles, the cut, the order), `tests/e2e/callouts.e2e.test.ts` (`__bh.voice.asked` filtered by speaker and id during a glide to Edwards), `tests/e2e/tars-voice.e2e.test.ts`, `tests/e2e/tars-agent.e2e.test.ts` (`__bh.voice.said.some(...)`)

### `__bh.voice.say` → `(line: VoiceLine) => void`

Asks a line to be said; the queue orders it, cuts the one being said when this one is more urgent (`priority` lower),
and pumps the next line. Returns nothing: check the result in `__bh.voice.said` or `__bh.voice.asked`.

*Used in:* `tests/e2e/voice.e2e.test.ts`, `tests/e2e/tars-voice.e2e.test.ts` (`__bh.voice.say({ text: "Sink rate!", speaker: "callout", priority: 0 })` cutting a TARS line)

### `__bh.voice.said` → `{ text: string; speaker: Speaker; at: number }[]`

Every line said, oldest first (the last 200). Tests filter it, e.g. `__bh.voice.said.some((l) => l.speaker === "tars" && l.text === "Mars en cible, vent modéré.")`.

*Used in:* `tests/e2e/tars-agent.e2e.test.ts` (TARS's answer said)

### `__bh.voice.queue` → VoiceQueue

The lines waiting to be said (`src/audio/voice.ts`): `current` is the line being said (null when none), `waiting` the
count of lines queued behind it. Lines are ordered by `priority` (the most urgent first); a line with an `id` asked again
within 4 s is dropped, and one with a `ttl` not started within that many ms of being asked is skipped when its turn comes.

```js
await app.waitFor(`!__bh.voice.queue.current`, 12_000); // the line being said is over
await app.js(`__bh.voice.queue.current?.speaker ?? null`);
```
*Used in:* `tests/e2e/tars-voice.e2e.test.ts` (`__bh.voice.queue.current` waited for, and its speaker read)

### `__bh.voice.stop` → `() => void`

Cuts the line being said and clears the queue. Used before a test's own lines so that nothing from the flight is left in the queue.

*Used in:* `tests/e2e/voice.e2e.test.ts`, `tests/e2e/tars-voice.e2e.test.ts` (`__bh.voice.stop()` before its lines)

### `__bh.capcom` → Capcom

Mission control and the runway's tower (`src/game/capcom.ts`): Houston's and the tower's radio lines on the flight's
own moments (lift-off, a good orbit, the deorbit burn, the plasma blackout and its end, the final's clearance, the
wheels stopped with the landing's grade, a docking, the wormhole, an accident). It is pure: `update(input)` takes a
frame's state (`CapcomInput`: `now` in wall ms, `side`, `stage`, `mode`, `callsign`, `orbit`, `entry`, `final`,
`plasma` 0…1, `stopped`, `docked`, `grade`, `failed`, `lightS`, `warp`, and `site` (the entry's landing site, null: none), built by main.ts each frame) and returns
`Timed[]` (`{ line: VoiceLine, at }`, `at` the wall ms it is said). Houston's lines are delayed by the light's time
from the Earth and dropped when that delay (the light's time divided by the warp) is past 60 s of wall time; the tower's are at once. Radio is lost in the plasma above 0.45 and back below
0.25.

| member | type | meaning |
|---|---|---|
| `update(input)` | `(i: CapcomInput) => Timed[]` | the frame's lines and when they arrive |
| `reset()` | `() => void` | forgets the flight's history (a new flight) |
| `blackout` | `boolean` | in the plasma's blackout now (the lines held till it ends) |

*Used in:* no e2e test reads `__bh.capcom` directly (its lines reach the game through `__bh.voice`, as the callouts test observes).

### `__bh.music` → Music

The score (`src/audio/music.ts`, the pieces in `src/audio/score.ts`), synthesized in the game's audio context on the
music bus (nothing downloaded). One piece per moment: `liftoff`, `entry`, `final`, `wormhole`, `gargantua`,
`miller`. A moment's piece fades in, its chords turn every `chordS`, and it fades out when the moment is over; a new
moment crossfades. `update(m)` is called every frame with the moment now, or `null` for silence (main.ts passes `null` when the sound or the
music setting is off, or there is no moment). Without an output (no audio context yet) `update` does nothing, and `moment` is not set.

| member | type | meaning |
|---|---|---|
| `update(m)` | `(m: Moment \| null) => void` | the moment now (called each frame) |
| `stop()` | `() => void` | silences the score now |
| `moment` | `Moment \| null` | the moment playing now (null: silence) |
| `notes` | `number` | notes started so far |
| `ticks` | `number` | the ticks started so far (Miller's tick, every 1.25 s) |

```js
// on Miller: its piece and its tick, heard on the music bus
await app.waitFor(`__bh.music.moment === "miller"`, 10_000);
const t0 = await app.js(`__bh.music.ticks`);
await Bun.sleep(5000);
const n = (await app.js(`__bh.music.ticks`)) - t0; // about 4
```
*Used in:* `tests/e2e/music.e2e.test.ts` (on Miller: the ticks counted over 5 s, the music bus level; off in orbit: silence)

### `__bh.tars` → object

TARS, the in-game agent (`src/ai/tars-agent.ts`, memory in `src/ai/memory.ts`), built in `src/main.ts` (the `tars:` key of
the handle). It groups the agent, his memory, his tools and the cost, and the voice's checks.

| member | type | meaning |
|---|---|---|
| `agent` | `TarsAgent` | the agent: `ask`, `last`, `lastText`, `busy`, `stop` (see below) |
| `memory` | `TarsMemory` | his memory of the pilot: turns, notes, summary (see below) |
| `tools()` | `() => Tool[]` | the game's tools (`src/ai/game-tools.ts`, as built in main.ts), all of them; the agent cuts them by his mode (`act`, `plan`, `watch`: `modeTools` in tars-agent.ts) |
| `spent()` | `() => number` | the OpenRouter spend so far [USD] |
| `earTrail()` | `() => string[]` | the ear's log (push-to-talk): what the microphone did, step by step |
| `voiceSynth(text, model)` | `(text: string, model: string) => Promise<number>` | a line rendered by Deepgram's speech (for example `"aura-2-hector-fr"`): its length in samples, 0 when Deepgram gives nothing (`src/audio/deepgram-voice.ts`; it needs a Deepgram key, pasted in TARS's console, or the dev server's relay) |

*Used in:* `tests/e2e/tars-eval.e2e.test.ts` (`__bh.tars.spent()` before and after a turn: the cost in USD),
`tests/e2e/tars-ear.e2e.test.ts` (`__bh.tars.earTrail?.()`, `__bh.tars.voiceSynth("Orbite stable, Cooper.", "aura-2-hector-fr")`)

### `__bh.tars.agent` → TarsAgent

The agent: it reads the pilot's question, sends it to the model with the game's tools (by mode: `act`, `plan` = propose, `watch` = observe),
runs the calls on the game, and answers in his voice. `busy` is true while a turn runs. `last` holds the last
turn's actions and `lastText` its answer (the tests and the panel read them).

| member | type | meaning |
|---|---|---|
| `ask(q)` | `(q: string) => Promise<string \| null>` | a question: his answer (also said); `""` when stopped by `stop()`; `null` when the model failed, or when a newer question superseded this one (the caller then runs the offline path: unclear whether intended) |
| `stop()` | `() => void` | aborts the turn running |
| `busy` | `boolean` | a turn is running |
| `last` | `Action[]` | the last turn's actions: `{ tool, args, ok, result }` |
| `lastText` | `string \| null` | the last turn's answer |
| `pending` | `Proposal \| null` | a plan he proposed and the pilot has not answered yet (`propose_plan`) |

`Action.ok` is false when the game refused the call (its `result` is the error). A question is kept in the memory
after each turn.

```js
await app.js(`(__bh.tars.agent.ask("Attends qu'on soit posés."), true)`);
await app.waitFor(`!__bh.tars.agent.busy`, 15_000);
await app.js(`__bh.tars.agent.last.map((a) => (a.ok ? "✓ " : "✗ ") + a.tool)`);
```
*Used in:* `tests/e2e/tars-agent.e2e.test.ts` (`__bh.tars.agent.ask`, `__bh.tars.agent.stop()`, `!__bh.tars.agent.busy`, `lastText` as the answer), `tests/e2e/tars-agent-live.e2e.test.ts` and `tests/e2e/tars-eval.e2e.test.ts` (`__bh.tars.agent.last`)

### `__bh.tars.agent.ask` → `(q: string) => Promise<string | null>`

A question (or an order) to TARS, as if typed in his field. Awaited by App.js. The answer is also kept in `lastText`.
A new question stops the turn running (`ask` calls `stop()` first). The stopping words (`stop`, `arrête`, …) are read by the
caller, main.ts, which calls `stop()` instead of `ask` while a turn runs (`TarsAgent.isStop`); `ask` itself does not read them.
The turn is kept in the memory after it ends: with its answer, or with an empty answer when stopped; not when the model failed.

*Used in:* `tests/e2e/tars-agent.e2e.test.ts` (`ask("Attends qu'on soit posés.")`, then `stop()`)

### `__bh.tars.agent.lastText` → `string | null`

His last answer, the words said. `null` before any turn, or when the model failed (offline answer).

```js
await app.waitFor(`__bh.tars.agent.lastText === "Mars en cible, vent modéré."`, 15_000);
```
*Used in:* `tests/e2e/tars-agent.e2e.test.ts` (waited for on each turn)

### `__bh.tars.agent.busy` → `boolean`

True while a turn runs (the model answering, the tools running). Wait for it to fall before reading `last`.

*Used in:* `tests/e2e/tars-agent.e2e.test.ts` (`waitFor("!__bh.tars.agent.busy")`)

### `__bh.tars.agent.last` → `Action[]`

The last turn's actions: each `{ tool, args, ok, result }`, in order. `ok` false: the game refused the call.

```js
await app.js(`__bh.tars.agent.last.map((a) => (a.ok ? "✓ " : "✗ ") + a.tool + " " + JSON.stringify(a.args))`);
```
*Used in:* `tests/e2e/tars-agent-live.e2e.test.ts`, `tests/e2e/tars-eval.e2e.test.ts`

### `__bh.tars.memory` → TarsMemory

His memory of the pilot (`src/ai/memory.ts`): the last turns (`TURNS_KEPT` = 24), his notes (what he chose to remember,
`NOTES_MAX` = 40) and a summary written when the turns are full (`compact`: the turns beyond the newest 12 are folded into it). Stored in this browser under the key
`kerr.tars.memory`. The model is given the summary, the notes, then the turns, and the tools he called in his last
answer.

| member | type | meaning |
|---|---|---|
| `turns` | `{ at, user, tars, did? }[]` | the turns kept (`user` the pilot's words, `tars` his answer, `did` the actions) |
| `notes` | `string[]` | his notes |
| `summary` | `string` | the summary of the earlier turns |
| `empty` | `boolean` | no turn, no note, no summary |
| `add(turn)` | `(t: Turn) => void` | keeps a turn (the agent calls it after each turn; `did` cut to 12 lines) |
| `remember(note)` | `(note: string) => boolean` | keeps a note (trimmed, 200 characters max); a note already kept (case-insensitive) returns true without a copy; false when the note is empty or the notes are full (40) |
| `forget(about)` | `(about: string) => number` | drops the notes containing this text (case-insensitive); the count dropped |
| `clear()` | `() => void` | forgets everything (turns, notes, summary) and removes the stored memory |
| `clearTurns()` | `() => void` | forgets the turns and the summary; the notes are kept |
| `full` | `boolean` | the turns are more than 24: a summary is due |
| `compact(summarize, force?)` | `(…) => Promise<void>` | folds the older turns into the summary (`summarize` is the model's; when it fails, the turns are dropped and their gist lost); `force` (`/compact`) keeps only the last two turns |
| `carry()` | `() => string` | the actions of the last turn, noted at the head of the next words |
| `context()` | `AgentMessage[]` | what the model is given after its system prompt |

```js
await app.js(`__bh.tars.memory.clear()`);
await app.waitFor(`__bh.tars.memory.empty`, 5_000);
```
*Used in:* `tests/e2e/tars-agent.e2e.test.ts` (`__bh.tars.memory.notes`, `.turns.length`, `.turns.at(-1)?.user`, `.empty`, `.clear()`), `tests/e2e/tars-agent-live.e2e.test.ts` (`__bh.tars.memory.notes.join(" ")`)

### `__bh.tars.earTrail` → `() => string[]`

The log of his ear (push-to-talk): each step of the microphone and the recognition, in order. Read when a test of the
ear fails, to see where it stopped.

*Used in:* `tests/e2e/tars-ear.e2e.test.ts` (`__bh.tars.earTrail?.()`, logged when no word is heard)

### `__bh.tars.spent` → `() => number`

The OpenRouter spend since the page was loaded [USD] (the sum of the calls' reported cost). Take it before and after a
turn to get that turn's cost.

```js
const spent0 = await app.js(`__bh.tars.spent()`);
// ... a turn ...
const usd = (await app.js(`__bh.tars.spent()`)) - spent0;
```
*Used in:* `tests/e2e/tars-eval.e2e.test.ts`

### `__bh.tars.tools` → `() => Tool[]`

The tools TARS is given (the game's tools, `src/ai/game-tools.ts`, as built in main.ts). A test can check their names and
schema; the agent's mode (`act`, `plan`, `watch`) cuts the list the model sees (`modeTools` in tars-agent.ts).

*Used in:* `tests/e2e/tars-agent.e2e.test.ts` (the mock model records the tool names it was sent in `window.__lastTools`; the test checks `press_key` is among them)

### `__bh.tars.voiceSynth` → `(text: string, model: string) => Promise<number>`

Renders a line with Deepgram's speech and returns its length in samples (0 when Deepgram gave nothing). Needs a
Deepgram key (pasted in TARS's console) or the dev server's relay (`src/audio/deepgram-voice.ts`; the key handling is in `src/ai/deepgram.ts`). The test checks that a French line comes back with a non-zero length.

```js
await app.js(`__bh.tars.voiceSynth("Orbite stable, Cooper.", "aura-2-hector-fr")`); // > 0
```
*Used in:* `tests/e2e/tars-ear.e2e.test.ts`

### `__bh.tarsVoice` → object

TARS's robot voice's parts (`src/audio/g2p.ts`, `src/audio/formant.ts`, `src/audio/engine.ts`): a text to phonemes, the
phonemes to samples (a formant synthesizer, offline), and the robot's chain placed in a context. 

| member | type | meaning |
|---|---|---|
| `phonemes(text)` | `(text: string) => string[]` | the text's phonemes (`,` for a pause) |
| `synthesize(ph, sr?, o?)` | `(ph: string[], sr = 22050, o = {}) => Float32Array` | the samples of a phoneme list (the formant voice) |
| `robotVoice(ctx, samples, sampleRate, out, inside, hrtf)` | `(…) => AudioBufferSourceNode` | the robot's chain (presence, a metallic comb, saturation), his seat in the cabin, into `out`; started |

*Used in:* no e2e test calls these parts directly (`tests/e2e/tars-voice.e2e.test.ts` reads the voice bus level instead).

### `__bh.tarsVoice.phonemes` → `(text: string) => string[]`

The phonemes of a text (letters to sounds, French or English). `|` marks a word's end, `,` a short pause and `.` a long one (`src/audio/g2p.ts`, header comment for the phoneme set).

```js
__bh.tarsVoice.phonemes("Honesty setting at ninety percent.");
```

### `__bh.tarsVoice.synthesize` → `(ph: string[], sr?: number, o?: VoiceShape) => Float32Array`

The formant synthesizer: a phoneme list to mono samples at `sr` (22050 Hz default). 50 ms of tail. Pure (no audio context).

### `__bh.tarsVoice.robotVoice` → `(ctx, samples, sampleRate, out, inside, hrtf) => AudioBufferSourceNode`

Plays samples through TARS's robot chain into `out` (an `AudioNode`). `inside` puts his seat in the cabin (ahead, from
outside); `hrtf` uses the panner's HRTF model. Returns the started source (`stop()` cuts it). The `ctx` may be the game's
`__sound.ctx` or an offline context.

*Used in:* no e2e test calls it directly; the game's own TARS voice uses it (`__sound.stopRobot()` cuts it).

### `__bh.bench` → object

The Kerr Bench (`src/bench/runner.ts`, suites in `src/bench/suites.ts`, the report's shape in `src/bench/report.ts`):
it measures the rendering of the reference scenes and the suites (worlds, vessels, weather, flights) and gives the
Kerr Score. The screen of the bench is at `…/#bench`. Times in the report are ms; the estimate is in seconds.

| member | type | meaning |
|---|---|---|
| `run(o)` | `(o: {mode, machineLabel?, scenes?, subsampling?, suites?, onProgress?, shot?}) => Promise<BenchReport>` | a whole run |
| `scene(name, quick?)` | `(name: string, quick = false) => Promise<SceneReport>` | one scene |
| `scenes` | `string[]` | the reference scenes (8) |
| `items` | `string[]` | the suites' items as `"suite/id (depth)"` (36) |
| `item(id, mode?)` | `(id: string, mode: BenchMode = "quick") => Promise<SceneReport>` | one suite item by its id, at a depth |
| `estimate(mode, suites)` | `(mode: BenchMode, suites: SuiteId[]) => number` | the run's estimated wall time [s] (shown before the start) |
| `vram()` | `() => {mib, peakMiB} \| null` | the GPU memory measured (MiB); null when not measured |

`BenchMode` is `"quick" | "standard" | "complete" | "full"` (deeper = more warm-up and more sweeps). `SuiteId` is
`"core" | "worlds" | "vessels" | "weather" | "flights"`. `run` measures the core scenes only unless `suites` is given
(the default is `["core"]`); `scripts/bench.ts` passes only `core` unless `--suites all` (or a list) is given. The quick scene timing is `{ warm 2500, auto 4000,
fixedWarm 1500, fixed 3000 }`, the standard one `{ 4000, 8000, 2500, 5000 }`.

```js
// the quick measure of one scene (the smoke test)
await app.js(`__bh.bench.scene("game:artemis", true)`); // { status: "ok", fixed: { mraysPerS, fps }, … }
```
*Used in:* `tests/e2e/smoke.e2e.test.ts` (`__bh.bench.scene("game:artemis", true)`: `status` "ok", `fixed.mraysPerS` > 0). The full run is `scripts/bench.ts`, which calls `__bh.bench.run({ mode, machineLabel, scenes, subsampling, suites, onProgress, shot })` in a headless Chrome against a running server and writes the folder `docs/perf/bench-<label>/` (its `report.json`) and `docs/perf/bench-<label>.json`; the default `--suites` is `core`.

### `__bh.bench.run` → `(o) => Promise<BenchReport>`

A whole run. `mode` is required; `scenes` defaults to the eight reference scenes (the first four in quick mode);
`subsampling` sweeps the realtime frame rate (`auto`, 1, 2, 3, 4, 6, 8) on the first two scenes at the complete and full
depths; `onProgress({ frac, phase, scene, … })` reports the run; `shot(name)` captures a screen. The result is the
`BenchReport` (`kerr-bench/2`: the system, each scene's phases, the suites' summaries and the Kerr Score).

```js
await app.js(`__bh.bench.run({ mode: "quick", scenes: ["game:artemis"], suites: ["core"] })`); // long: wait with a 120 s timeout
```

### `__bh.bench.scene` → `(name: string, quick?: boolean) => Promise<SceneReport>`

One reference scene: it is set (`__bh.preset`), settled, warmed, then measured in phase A (the Game quality, its automatic
subsampling) and phase B (subsampling 4, the image at about 1.44 Mpx: `fixed.mraysPerS`, `fixed.fps`). An unknown name
gives `status: "skipped"`. `quick` shortens the warm-up and measures.

*Used in:* `tests/e2e/smoke.e2e.test.ts`

### `__bh.bench.scenes` → `string[]`

The reference scenes' names, in the run's order (`game:artemis`, `Ranger: approaching Gargantua`, `Interstellar: along the disk …`, `Saturn: backlit`, `Kerr a=0.94, near edge-on`, `Interstellar: wormhole to Gargantua`, `Moon: an afternoon on the plains`, `Miller: Gargantua over the sea`). `scripts/bench.ts` reads it when no `--scenes` is given.

*Used in:* `scripts/bench.ts`

### `__bh.bench.items` → `string[]`

The suites' items as `"suite/id (depth)"`, for example `worlds/amazon (standard)`, `weather/wx-storm (quick)`,
`flights/final-edwards (quick)`. The ids are what `__bh.bench.item` takes.

### `__bh.bench.item` → `(id: string, mode?: BenchMode) => Promise<SceneReport>`

One suite item by its id at a depth (default `"quick"`): a view (warmed, measured as in the game, then at the fixed
setting) or a flight (flown, measured as it flies). An unknown id throws, listing the ids.

```js
await app.js(`__bh.bench.item("final-edwards")`); // a flight: the final to Edwards, quick
```
*Used in:* no e2e test; ids as in `src/bench/suites.ts` (for example `final-edwards`, `entry-edwards`, `amazon`, `wx-storm`, `iss`)

### `__bh.bench.estimate` → `(mode: BenchMode, suites: SuiteId[]) => number`

The run's estimated wall time [s] for these suites at this depth: the core scenes (about 3 s of setup each), their sweeps
at the deep depths, and the items. The screen shows it before a run starts.

```js
await app.js(`Math.round(__bh.bench.estimate("quick", ["core"]))`);
```

### `__bh.bench.vram` → `() => { mib: number; peakMiB: number } \| null`

The GPU memory the app has allocated (its buffers and textures, MiB), and its peak since the start. Null when the
allocation hook is not installed (no GPU device, or not measured yet). `scripts/bench.ts` reads it once after the run.

```js
await app.js(`__bh.bench.vram()?.peakMiB ?? null`);
```
*Used in:* `scripts/bench.ts` (`__bh.bench.vram()?.peakMiB` printed after the run)

---

