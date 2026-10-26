# The tremble in flight — 26/10/2026

The complaint: in flight (the F-35, but the others too), the image trembles, in any flight, level or not. A screenshot
does not show it. So: film it, measure it by cause, fix it.

## How it is measured

**What we call jitter.** It is the image moving within a frame by more than it should. For each frame, its motion is
compared with the local trend of its rate (a weighted linear fit over the neighbouring frames within ±0.1 s, the frame
itself left out). That trend is multiplied by the frame's own step. What is left is the jitter, in output pixels per frame.
A steady turn or the ground sliding past count for 0.

**Two instruments that measure the same thing.**

- **The probe** (`src/jitter/probe.ts`, `src/jitter/analyze.ts`, `__bh.jitter` in [BH-API](../BH-API.md)) records every
  layer that places the image, each turn of the loop. Each layer is a candidate cause:

  | channel | the cause | where it comes from |
  |---|---|---|
  | `flight` | the craft's own motion (flight dynamics, flight laws) | the camera's axes through the mount |
  | `mount` | the view's rig and the camera shake turned into it | `shipMatrix()` |
  | `camShake` | the camera shake (runway, buffet, Mach 1, afterburner, engine) | `camshake.ts`, `camera.lastShake` |
  | `display` | the display shake: the whole image offset | `renderer.shake` (`sim.applyRender`) |
  | `pacing` | the loop's timing against the GPU's (latency variation × image speed) | rAF, `renderer.onSubmitDone` |
- **The video** (`scripts/jitter-lab.ts`, `scripts/lib/jitter-video.ts`) records the DevTools screencast, every frame the
  compositor makes, with its time. That is what the screen really showed. Each 128 px tile's motion is found by phase
  correlation for the whole pixels, then Lucas–Kanade for the fraction (±0.01 px). The same residual is computed for each
  tile, with a map of the image. Only the video sees the shaders' own jitter (temporal history, sparse shading, scale
  changes). It is measured on its own with the flight frozen, where nothing should move.

**The levers** isolate each cause in the same flight, in successive stretches:

| stretch | lever |
|---|---|
| `base` | as played |
| `noDisplay` | `__bh.jitter.levers({ airShake: 0 })` |
| `noShakes` | plus `flightShake = 0` |
| `fixedStep` | the flight stepped by a fixed step each frame (`levers({ step })`), which takes pacing out |
| `frozen` | `__bh.freeze(true)`: only the renderer can move the image |

```bash
bun scripts/jitter-lab.ts                                   # F-35, cockpit, 230 m/s at 300 m over the Beauce, here
bun scripts/jitter-lab.ts --view chase --craft a320 --speed 140 --agl 600 --tiles
bun scripts/remote.ts run -- bun scripts/jitter-lab.ts --tiles   # kerr-mini, full screen: the real display's pacing
```

Each stretch leaves `video.mp4` (to watch, each frame with its own duration), `samples.json`, `tiles.json`. The figures go
to `report.md` and `report.json`.

## What was found

The reference case is a simple level flight: F-35, cockpit, 300 m, 230 m/s (q ≈ 30 kPa), autopilot and autothrottle on.
The table gives the visible tremble from the video, as the 90th percentile of the tiles in px/frame, and the probe's
channels.

| | video p90 | display | camShake | flight | pacing |
|---|---|---|---|---|---|
| this Mac (headless, ~55 fps), as played | **2.65** | **2.93 @ 11.5 Hz** | 0.03 | 0.04 | 0.4 |
| without the display shake | 0.15 | 0 | 0.02 | 0.03 | 0.3 |
| kerr-mini (1920×1080, ~33 fps), as played | **5.90** | **6.12 @ 11.3 Hz** | 0.03 | 0.07 | 0.34 |
| without the display shake | 0.23 | 0 | 0.02 | 0.06 | 0.34 |
| fixed step (no pacing) | 0.16 | 0 | 0 | 0.10 | — |
| frozen (the shaders alone) | 0.01 | — | — | — | — |
| A320, 140 m/s, this Mac, as played | **2.59** | **2.35 @ 11.3 Hz** | 0.14 | 0.20 | 1.2 |
| chase view, mini | **0.96** | **3.81** | 0.01 | 0.07 | 0.21 |

**The verdict: the camera, not the shaders, the CPU or the flight.** Nearly all of the tremble was the **display shake** in
`sim.applyRender`.

- It offset the whole image (a UV offset in `renderer.writeDisplay`) by `0.0018 · min(q / 30 kPa, 1)` of its size, ×1.6 in
  the cockpit. That is ±3 to 6 px.
- It was a sum of sines at 6 to 11.3 Hz.
- It was on in **any** flight with dynamic pressure, so in any low pass of any craft.
- No setting controlled it: `flightShake` only drove `camshake.ts`.
- It was an offset, not a turn of the camera, so the HUD and the DOM instruments stood still while the image slid under
  them.
- At 25 to 33 frames a second, an 11 Hz sine is sampled close to its Nyquist frequency. It shows as an erratic shiver
  rather than a vibration.

It came with the entry's look (`f4adff3`, the buffeting of a re-entry) and leaked into ordinary flight through its `q`
term.

The rest is at or below 0.3 px. The fixed step changes nothing, so pacing is not the cause. Frozen, the image does not
move, so the shaders are not the cause. The craft's own motion is at 0.03 to 0.1 px on the F-35. On the A320 it is 0.2 to
0.9 px at 18 fps on the mini, invisible on the video (0.04 px), to watch at low frame rates.

## The fix

1. **The display shake only during a re-entry** (the plasma's heat). It is under the `flightShake` setting and at 2.7 to
   4.9 Hz, well below a 25 fps frame rate's Nyquist. The air's own buffet (Mach 1, the runway, the stall, turbulence) is
   `camshake.ts`'s: a turn of the camera, already under the setting. Smooth air no longer shakes.
2. **The camera shake kept to what the frames can show** (`shownAt` in `camshake.ts`). Each band is weighted 1 up to
   0.3 × the frame rate and 0 from 0.45 × (eased). Above that, a sine folds back into a slower, erratic one: the engine's
   31 Hz hum at 25 fps became a 6 Hz shiver. Its frame rate is measured from its own steps.
3. The **Flight shake** setting is available for every craft, no longer only the F-35. Its help text now includes the
   re-entry.

**After** (same flights):

| | video p90 before | after |
|---|---|---|
| F-35 cockpit, this Mac | 2.65 | **0.15** |
| F-35 cockpit, kerr-mini | 5.90 | **0.26** |
| A320 cockpit, kerr-mini | — | 0.32 (its turbulence at 1.3 Hz: wanted, under the setting) |

Tests: `tests/jitter-analyze.test.ts` (the analysis tells the causes apart), `tests/jitter-video.test.ts` (the tiles'
sub-pixel shift, a steady pan against a shaken one), `tests/jitter-shake.test.ts` (no hum at 25 or 60 fps, the buffet kept).

## Left to do

- The A320's flight channel at 18 fps (0.4 to 0.9 px from the probe, not seen on the video): the flight law runs once a
  frame (`pilot.step`). Sub-step it if a tremble shows at low frame rates.
- Pacing: 0.3 to 0.8 px estimated. It is the latency's variation (rAF stamp to GPU end). If it ever dominates, smooth the
  step or interpolate (a fixed step with interpolation: [jet-camera-aaa](jet-camera-aaa.md), "not done").
