# Performance analysis (2026-09-27)

Measured in the game (`#scene=game:artemis`, the Ranger in low Earth orbit, full HUD) on an Apple GPU
(Metal 3, WebGPU in Chrome), a 1385 × 965 CSS page at devicePixelRatio 2 — with the tools this
analysis added: the GPU profiler (timestamp queries per pass, `src/gpuprof.ts`), the main-thread
profiler (`src/perf.ts`), both in **F2 › Perf** and `__bh.game.perf()`.

## Before

17 frames rendered per second (the loop itself at 68 Hz), with the settings the game had:
"RT max" quality (a 60 ms GPU budget: *the best image that stays interactive, ≈ 15 fps*), render scale
1.5 (2078 × 1448), one ray per 8 × 8 pixels.

| GPU pass | ms | |
|---|---|---|
| planet light probes | 46 | every 2 s: a hitch — and useless on our side of the wormhole |
| Ranger light probe (trace) | 11 | 8192 long rays a frame |
| display | 9.6 | full resolution, includes waiting for the drawable |
| Ranger composite | 7.6 | a full-screen load/store render pass for the ship's pixels |
| resolve + gather | 7.3 | full resolution |
| trace (the image) | 3.2 | the only part the subsampling scales |
| Ranger MSAA shading + shadow map | 2.2 | |

- The frame was **serialized**: one frame in flight, the next one encoded only after the GPU had
  finished *and* the main thread had come back to the promise — 45 ms of passes became 52 ms per frame.
- The automatic subsampling assumed half the frame scaled with the rays: it stayed at its coarsest
  (8 × 8) although the trace was 7 % of the frame.
- Main thread: the free-fall prediction ran **every frame** (6–12 ms; its cache never hit on our side),
  the HUD redrew all its instruments 60–80 times a second (5.8 ms a loop, the map alone 4 ms).

## What changed

| Change | Effect |
|---|---|
| Two frames in flight (the live view; one for offline renders) | 18.6 → 29.8 fps on its own |
| Free-fall prediction: cached (≤ 4 Hz), computed in the planner's worker | 7.8 ms → 0.02 ms a loop; no 17 ms hitch |
| HUD instruments at their own pace (map 15 Hz, ball 20, plots 10) | 5.8 → 0.6 ms a loop |
| Planet probes: skipped on our side, traced a sixteenth per frame | no 46 ms hitch every 2 s |
| Ranger probe: 1 texel of each 4 × 4, every 4th frame when its view moves slowly | 11 → ~1 ms a frame on average |
| Ranger composited by the display pass (no full-screen pass) | −5 to −7.6 ms |
| Ranger shadow map every other frame; its passes scissored | −0.6 ms |
| Subsampling adapted with the trace pass's own time (the GPU profiler) | finer blocks (2–6) when there is room |
| **Game quality** (the game scenes): 16 ms budget, render scale ≤ 1.25, dynamic resolution | ≈ 60 fps target |
| Dynamic resolution: the render scale lowered by eighths (to ½) when the GPU misses the budget with coarse blocks, raised back when it has room | holds the frame rate on slower GPUs |

## After

| Settings | Before | After |
|---|---|---|
| RT max, render scale 1.5, 30 ms budget | 17 fps (8 × 8 blocks) | 50 fps (2 × 2 blocks) |
| Game (scale 1.25, 16 ms, dynamic resolution) | — | 90–111 fps on a 120 Hz display |

GPU per frame (Game): display 4–6 ms, trace 1.5–3.5, Ranger MSAA 1.5, gather/resolve 1–1.5, Ranger
probe ~1 on average, the rest < 1 each. Main thread: ~1.5 ms a loop.

## Left as they are (measured, for later)

- **display (4–10 ms)**: a trivial shader; its time is mostly the wait for the canvas' drawable and
  scales with the pixels (EDR/HDR canvas). The lever is the render scale.
- **Ranger MSAA (1.5–2.7 ms)**: 4× MSAA over the whole screen (clear + resolve) for a ship that covers
  a part of it — a bbox-sized target would save about half.
- **Ranger probe rays** are ~20× dearer than the image's (long, divergent) — fewer, rarer runs rather
  than cheaper rays.
- **The planner's worker** also runs the free-fall prediction: during a long re-aim the map's path
  can lag by a few seconds.
- A **hidden page** is throttled by the browser (rAF): measure with the page in front.

## Tools

- `__bh.game.perf()` — frame rates, GPU frame and pass times, image size, render scale, block, the
  main thread's sections (mean and worst).
- `__bh.game.quality("game" | "realtime" | …)`, Settings › Render › Quality (**Game** button, key 6),
  *Dynamic resolution*, *Frame budget*, *Pixel ratio*.
- F2 › **Perf**: the same, live; F2 › Audit: the frame rate check.
