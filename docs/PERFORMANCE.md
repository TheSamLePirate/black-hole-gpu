# Performance analysis (2026-09-27)

Measured in the game (`#scene=game:artemis`, the Ranger in low Earth orbit, full HUD) on an Apple GPU
(Metal 3, WebGPU in Chrome), a 1385 × 965 CSS page at devicePixelRatio 2 — with the tools this
analysis added: the GPU profiler (timestamp queries per pass, `src/gpuprof.ts`), the main-thread
profiler (`src/perf.ts`), both in **F2 › Perf** and `__bh.game.perf()`.

The sections *Before* → *After* are that analysis. What followed — the audit plan (waves A–C, every
step measured with `scripts/bench.ts`) and the changes since — is summed up under **Since then**
(updated 2026-10-02); the plan's own log, step by step with its measures, is `docs/perf/audit-plan.md`.

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
| **Game quality** (the game scenes): 16 ms budget, pixel ratio ≤ 1.25, dynamic resolution | ≈ 60 fps target |
| Dynamic resolution: the render scale lowered by eighths (to ½) when the GPU misses the budget with coarse blocks, raised back when it has room | holds the frame rate on slower GPUs |

## After

| Settings | Before | After |
|---|---|---|
| RT max, render scale 1.5, 30 ms budget | 17 fps (8 × 8 blocks) | 50 fps (2 × 2 blocks) |
| Game (scale 1.25, 16 ms, dynamic resolution) | — | 90–111 fps on a 120 Hz display |

GPU per frame (Game): display 4–6 ms, trace 1.5–3.5, Ranger MSAA 1.5, gather/resolve 1–1.5, Ranger
probe ~1 on average, the rest < 1 each. Main thread: ~1.5 ms a loop.

## Since then (2026-09-28 → 10-02)

**The frame's hidden costs** (outside the GPU's passes):
- The HUD's glows are drawn, not blurred (`0491062`): the canvas's `shadowBlur` was a Gaussian blur
  the GPU ran per draw (the orbit's 240 segments: 133 ms of GPU a frame). LEO: 9 → 23 rendered fps.
- No backdrop blur behind panels by default (`3ca979b`, `82e651e`): the browser re-blurred what lay
  under each panel every frame, its compositing delaying the tracer's frames (27.8 → 32.6 fps in LEO).
  Settings › Render › Realtime › *Frosted panels* brings it back.
- The HUD's heavy instruments one a frame, the most overdue (`4825766`): loop p95 27 → 22 ms. The
  flight HUD drawn on the loop's turns that rendered an image (`e2fc250`).
- Main thread: the Kerr free-fall path computed in the planner's worker (`src/lenses.ts` shared);
  the Earth's heights extracted by the GPU into a one-byte texture, read back in bands (`f2e9014`).

**The automatic controls** (subsampling, dynamic resolution, refinement):
- The budget is fitted to a whole number of the display's refreshes, a tenth under — the Game's 16 ms
  is 15 on a 60 Hz screen, two refreshes on a 120 Hz one; a *Frame rate cap* (Display, 30, 60, 120)
  leaves room the subsampling spends on a sharper image (`e2fc250`).
- Robust to spikes (`a791d21`): each frame bounded by twice the median of the last 15, frames after new
  resources or a probe reset left out; coarser after 150 ms over the budget, finer after 400 ms of room.
- Coarser only where it is measured to pay (`31e5b33`): each block size and each render scale keeps
  its measured frame time (20 s, 30 s); a coarser block or a smaller scale only when unmeasured or a
  tenth faster at least (a frame bound by the browser's compositing gains nothing from fewer pixels);
  a new scale held 3 s before it is judged. The dynamic resolution moves by eighths, every 1.5 s,
  between half the pixel ratio and all of it.
- The converging phase's bands sized to the quality's budget (`4f1048e`, ≤ 28 ms).

**The hardware tier** (`src/tier.ts`, `935f7b6`): guessed at start from the adapter's info (vendor,
architecture, fallback/software), `navigator.deviceMemory` and a coarse pointer — 0 software 0.5 Mpx ·
1 integrated, Intel, touch or ≤ 4 GB 0.9 · 2 Apple, mobile/laptop NVIDIA/AMD 2.2 · 3 discrete 3.5 ·
(4: 6 Mpx, never guessed today). With the dynamic resolution on (the Game quality) the realtime image
stays within that pixel budget (`cappedRatio`) — a 4K screen no longer renders 4× a laptop's pixels;
the finer qualities keep the ratio asked for. This Mac: tier 2, unchanged. Shown in `perf().tier`.

**The kernel:**
- Specialised to the scene (`a0899ba`, `f35567a`, `148399f`): features (radio bands, polarization,
  jet, hot spot, hot flow, wormhole, thick disk, bodies) are WGSL `override` constants; a pipeline with
  the unused ones compiled out is built in the background (~10 s) and swapped in, the general one
  meanwhile; cached by feature set. Classic Kerr 53 → 17 ms at fixed b4.
- Disk turbulence read from a baked 3D noise texture (`743ea28`, `src/noise3d.ts`): along the disk
  93 → 67 ms (b4). Integer hashing for the noise (`a00d41f`), step reuse (`8900ecf`).
- Far-field LUT (`ef51aac`, setting *Far-field LUT*): rays between clean samples interpolated in scenes
  with only the hole and its disk (+5–7 %).
- Temporal reprojection (TAAU, `03988c3`, *Temporal reprojection*): the history carried by the
  camera's rotation, +2.4 to +4 dB on the realtime image for 0.4 ms.
- **Compilation**: the tracer compiles in seconds (`842e5a0`: `traceLook` and the Earth's drawing each
  called at one place — every call site is a copy the compiler builds; it was 33 s + 45 s). Its five
  general pipelines and the precision probe are built with `createComputePipelineAsync`, all at once
  (`f86c03a`): on Windows (D3D12 → DXC) a synchronous compile of the trace shader stalled the GPU
  process past the browser's watchdog. The adapter must offer 10 storage buffers a stage (said at start).

**Memory** (Earth orbit 1246 → 695 MiB over the plan):
- Maps streamed by footprint and freed (`b1bd4ae`): the Earth's none / med / high by its disk's size and
  the texel under the camera; a world's HD maps once its coarse texel outgrows a pixel, freed beyond
  twice that.
- Colour maps GPU-compressed (`c84750b`): KTX2 (UASTC + Zstandard, mip-mapped, `scripts/build-ktx2.ts`)
  transcoded in a worker (`src/system/ktx-worker.ts`, Basis Universal in `vendor/basis`) to BC7 or
  ASTC 4×4 — a quarter of rgba8 —, the JPEG path kept without either; HD maps stay JPEG.
- The polarization buffer and the bloom's passes only when used (`beeacef`).
- The real terrain's clipmap (`ad67843`): 8 levels of 4 × 4 elevation tiles round the camera, 32 MB of
  GPU memory; ~13.6 MB downloaded on arriving somewhere. Yosemite 32 ms vs 16 (more march steps on
  real cliffs), Burgos 37 vs 85 (the octaves the data holds are skipped).

**Robustness** (`229bc17`): a lost device autosaves the flight and offers a Reload panel; uncaptured
GPU errors counted, the first three toasted; the Earth's maps load under an out-of-memory scope and
fall back a tier (high → med → the solar system's map).

**The ships:** the Endurance in four levels of detail, each downloaded when first needed (`adcac61`);
the Ranger's cockpit with a depth pre-pass and its own lean shader (`fsCabin`, `089c112`): ~19 → 35–45
renders/s in headless Chrome at 1600 × 900 (50 outside).

## Left as they are (measured, for later)

- **display (4–10 ms)**: a trivial shader; its time is mostly the wait for the canvas' drawable and
  scales with the pixels (EDR/HDR canvas). The lever is the render scale.
- **Ranger MSAA (1.5–2.7 ms)**: now drawn in targets the size of the ship's screen box (the mesh's box
  corners projected, rounded up by 128 px: 27–33 % of the image in the chase view), copied into its
  image. Measured A/B in the chase view: 3.9 vs 4.4 ms, within the noise — the pass is the shading of
  the ship's own pixels (GGX reflections, 12-tap shadow PCF, procedural plating), not the full-screen
  clear and resolve. The gain is memory: ~144 MB of 4× targets at 2078 × 1448 → ~39 MB.
- **The Ranger's fragment shader**, measured in isolation (its passes alone, 40 per submission, the
  scene frozen; chase view, 1280 × 640 box): a whole ship draw ≈ 2.7 ms, of which a flat shader
  already costs ≈ 1.9 (the 4× MSAA raster of 32 k two-sided triangles, the copy; the shadow map 0.17
  per frame) — the lighting ≈ 0.8. Per part (removed one at a time): relief ≈ 0.6 → 0.4 after the
  change, grime noise, shadow PCF and environment reflections ≈ 0.2 each.
  Kept: the relief's plane picked by one-hot weights (3 plate evaluations instead of 12, no branch):
  2.81 → 2.62 ms (−20 % of the lighting); an 8-tap shadow PCF (neutral, simpler). Tried and dropped:
  per-pixel branches (skipping sub-pixel noise octaves, the shadow on faces away from the light, the
  relief on smooth parts) — each measured *slower* than the arithmetic it skipped on this GPU; no
  anisotropic filtering on the reflections — no effect. What is left is mostly fixed (the MSAA raster).
- **Fewer MSAA samples for a small ship** — measured, not adopted. With the frame loop stopped and the
  ship's passes alone (image 1039 × 724, the ship shrunk with the field of view), per draw:

  | ship on screen | 4× | 1× |
  |---|---|---|
  | 631 × 274 px | 1.31 ms | 1.15 ms |
  | 309 × 136 px | 1.64 ms | 1.36 ms |
  | 137 × 62 px | 1.62 ms | 1.21 ms |
  | 54 × 26 px | 1.11 ms | 1.03 ms |

  The cost hardly follows the ship's size or its samples: an empty clear-only pass or a 128 × 128 copy
  measures the same ~0.9 ms there — a per-pass floor. A small ship costs next to nothing above it, so
  one sample would save ~0.1 ms and make its edges shimmer. (WebGPU offers 1 or 4 samples only.)
- **Back faces of the Ranger culled** (its shading pass): 1.85 → 1.53 ms per ship draw (−17 %). The
  mesh looked unfit (542 open edges, 5070 inconsistently wound, ~24 % of the hull's triangles facing
  in by ray parity), but rendering it with and without culling from 288 viewpoints around it (6 mounts ×
  12 yaws × 4 pitches, 25.4 M ship pixels) leaves **0** pixels missing: the inward-wound triangles are
  hidden inner faces. A re-oriented mesh (each triangle turned towards the side its rays escape from,
  single sheets doubled) was tried and dropped: 1938 pixels missing from the same viewpoints. The
  shadow map keeps both faces.
- **The thrusters' flames** (the plumes, marched volumes): a pass of their own at half resolution,
  added by the display, only while something fires. Its path, measured in the chase view at full
  throttle (image 1731 × 1206; in parentheses, relative to the shadow map timed in the same run, the
  machine's load varying): a box proxy at full resolution in the MSAA pass, 24 steps and value noise
  34.7 ms (≈ 70×) → a tight frustum, 14 steps, a sine flicker 6.6 ms → one sample (5.7×) → half
  resolution reading the hull's MSAA depth for occlusion (≈ 3×) → the hull's depth redrawn at half
  resolution in the same pass, hardware depth test (≈ 1.5–2×, under 1 ms unloaded). The MSAA depth
  reads and stores alone cost ~2 ms; the ship's MSAA box no longer grows to hold the flames.
- **Ranger probe rays** are ~20× dearer than the image's (long, divergent) — fewer, rarer runs rather
  than cheaper rays.
- **The planner's worker** also runs the free-fall prediction: during a long re-aim the map's path
  can lag by a few seconds.
- A **hidden page** is throttled by the browser (rAF): measure with the page in front.

## Tools

- `__bh.game.perf()` — frame rates (loop and rendered), GPU frame and pass times, image size, pixel
  ratio, hardware tier, render scale, quality, budget, block, the main thread's sections (mean and
  worst). The GPU timestamps are on from the start when the device has them (`renderer.ts`: the
  realtime subsampling uses them; they sample one frame in eight, `7194173`: every frame cost 2–3 %);
  `perf()` only switches them back on if they were turned off.
- `__bh.game.quality("game" | "realtime" | …)`, Settings › Render › Quality (**Game** button; keys 1–6,
  6 = Game, outside flight — in flight 1–7 are the attitude holds), and in Render › Realtime:
  *Dynamic resolution*, *Frame budget*, *Frame rate cap*, *Temporal reprojection*, *Far-field LUT*,
  *Frosted panels*; Render › Image: *Pixel ratio*.
- F2 › **Perf**: the same, live; F2 › Audit: the frame rate check.
- `bun scripts/bench.ts [--label name] [--scenes "a|b"] [--quick | --mode complete] [--subsampling auto,1,2,4,6,8] [--no-shots] [--out dir]`
  — the Kerr Bench (`__bh.bench.run`) in headless Chrome: eight reference scenes, each at the Game
  quality (frame intervals p50/p95/p99, rays per pixel), then a fixed subsampling 4 at ~1.44 Mpx (the
  kernel's cost, Mrays/s — the Kerr Score), then **its realtime subsampling swept** — auto (with the
  dynamic resolution, as in the game), 1×, 2×, 3×, 4×, 6×, 8× (at the Game pixel ratio, full scale): the
  frame rate and its percentiles, a histogram of the frame times, the GPU time per frame and per pass,
  Mrays/s, rays per frame and per pixel, the blocks the automatic choice took. Writes a folder
  `docs/perf/bench-<label>/`: `report.json` and `shots/<scene>/` — each subsampling's image in motion
  (`rt-auto.jpg`, `rt-x1.jpg` …, at the render's own pixels) and the image still, refined
  (`still.jpg`). `--compare <url> [--reps 2]` alternates a reference build scene by scene instead
  (`docs/perf/bench-<label>.json`). The in-app Complete run (…/#bench) sweeps the subsampling too.
  Measure alone: another page rendering shares the GPU.
