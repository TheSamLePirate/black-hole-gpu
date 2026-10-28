# Lean tracer kernels — measurements

Reference scenes: `scripts/lib/kernel-profiles.ts`. D3D12 proxy: Tint + DXC at Chrome 156's Dawn (`chromium/8078`),
`cs_6_6`, Dawn's DXC arguments, on this Mac (M1 Max). Calibration: the general kernel's `main` + `env` took **342 s** here.
The recorded Windows figures (`docs/ANALYSE-CHARGEMENT-GPU.md` §9) are 317 s on an RX 5700 XT machine and 90 s on an
RTX 5070 Ti machine, driver step included. So this Mac's proxy runs at about the pace of the 5700 XT machine, and about
3.5× the 5070 Ti's.

A launch compiles a profile's pipelines; the scene's image waits for its `main` (and, before P1, the raster group).

## D3D12 proxy, Tint + DXC seconds per pipeline

Regenerate with `bun scripts/kernel-report.ts docs/progress/kernels/proxy-*.json`.

| profile | pipeline | baseline [s] | p1b [s] | p3 [s] | p4 [s] | p5 [s] | p7 [s] | p10 [s] |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| earth-raster | shade | 50.7 | 46.6 | 53.0 | 50.1 | — | — | 54.2 |
| earth-raster | shadeMark | 0.9 | 0.1 | 0.1 | 0.1 | — | — | 0.1 |
| earth-raster | shadeLite | 2.4 | 1.4 | 1.6 | 1.6 | — | — | 1.7 |
| earth-raster | shadeWater | 3.9 | 2.8 | 3.0 | 2.9 | — | — | 3.1 |
| earth-raster | shadeStars | 0.9 | 0.1 | 0.1 | 0.1 | — | — | 0.1 |
| earth-raster | discs | 57.2 | 29.7 | 37.7 | 36.4 | — | 20.4 | 17.0 |
| earth-raster | clouds | 1.3 | 0.4 | 0.8 | 0.8 | — | — | 0.8 |
| earth-raster | main | 265.2 | 232.5 | 149.3 | 83.3 | — | 59.8 | 34.5 |
| earth-raster | env | 76.5 | 80.8 | 48.5 | 47.3 | 28.3 | — | 24.9 |
| earth-raster | aerial | 1.1 | 0.1 | 0.2 | 0.2 | — | — | 0.2 |
| earth-raster-wx | shade | 94.0 | 98.8 | 103.4 | 99.1 | — | — | 102.8 |
| earth-raster-wx | shadeMark | 1.0 | 0.1 | 0.1 | 0.1 | — | — | 0.1 |
| earth-raster-wx | shadeLite | 2.3 | 1.6 | 1.6 | 1.6 | — | — | 1.7 |
| earth-raster-wx | shadeWater | 3.5 | 2.9 | 2.9 | 2.9 | — | — | 3.0 |
| earth-raster-wx | shadeStars | 0.8 | 0.1 | 0.1 | 0.1 | — | — | 0.1 |
| earth-raster-wx | discs | 53.8 | 34.9 | 36.8 | 37.0 | — | — | 16.5 |
| earth-raster-wx | clouds | 1.6 | 0.8 | 0.8 | 0.8 | — | — | 0.8 |
| earth-raster-wx | main | 429.8 | 418.6 | 213.4 | 98.7 | — | — | 42.8 |
| earth-raster-wx | env | 94.1 | 79.1 | 47.7 | 46.9 | — | — | 24.8 |
| earth-raster-wx | aerial | 1.0 | 0.2 | 0.2 | 0.2 | — | — | 0.2 |
| earth-trace | main | 233.6 | 202.6 | — | — | — | 168.9 | 63.7 |
| earth-trace | env | 80.8 | 73.4 | — | — | 33.5 | — | 29.5 |
| earth-trace | aerial | 0.9 | 0.1 | — | — | — | — | 0.1 |
| earth-photo | main | 241.4 | 210.3 | — | — | — | — | 66.1 |
| game-space | main | 116.6 | 100.0 | — | — | — | 41.5 | 29.6 |
| game-space | env | 52.8 | 42.5 | — | — | 23.2 | — | 21.1 |
| game-space | aerial | 1.0 | 0.1 | — | — | — | — | 0.1 |
| earth-only | main | 86.0 | 31.4 | — | — | — | 19.3 | 23.4 |
| earth-only | env | 34.6 | 10.2 | — | — | 5.7 | — | 7.9 |
| earth-only | aerial | 0.9 | 0.2 | — | — | — | — | 0.2 |
| kerr-jet | main | 43.0 | 1.9 | — | — | — | — | 7.8 |
| kerr-jet | env | 31.1 | 5.4 | — | — | 2.2 | — | 4.8 |
| kerr-jet | lut | 40.3 | 0.9 | — | — | — | — | 6.4 |
| eclipse | main | 72.6 | 28.8 | — | — | — | — | 20.1 |
| eclipse | env | 34.4 | 9.7 | — | — | — | — | 7.0 |
| eclipse | aerial | 0.9 | 0.2 | — | — | — | — | 0.2 |
| general | main | 249.1 | 247.0 | — | — | — | — | 178.8 |
| general | env | 92.4 | 86.2 | — | — | — | — | 32.4 |
| general | lut | 142.4 | 135.7 | — | — | — | — | 109.0 |
| moon | main | — | — | — | — | — | 61.1 | 41.0 |
| moon | env | — | — | — | — | — | — | 21.2 |
| moon | aerial | — | — | — | — | — | — | 0.2 |

| profile | baseline total [s] | p1b total [s] | p3 total [s] | p4 total [s] | p5 total [s] | p7 total [s] | p10 total [s] |
|---|---:|---:|---:|---:|---:|---:|---:|
| earth-raster | 460 | 394 | 294 | 223 | 28 | 80 | 137 |
| earth-raster-wx | 682 | 637 | 407 | 287 | 0 | 0 | 193 |
| earth-trace | 315 | 276 | 0 | 0 | 34 | 169 | 93 |
| earth-photo | 241 | 210 | 0 | 0 | 0 | 0 | 66 |
| game-space | 170 | 143 | 0 | 0 | 23 | 41 | 51 |
| earth-only | 121 | 42 | 0 | 0 | 6 | 19 | 31 |
| kerr-jet | 114 | 8 | 0 | 0 | 2 | 0 | 19 |
| eclipse | 108 | 39 | 0 | 0 | 0 | 0 | 27 |
| general | 484 | 469 | 0 | 0 | 0 | 0 | 320 |
| moon | 0 | 0 | 0 | 0 | 0 | 61 | 62 |

`baseline`: P0, the whole module for every pipeline. `p1b`: the sources specialised as the renderer now makes them.
`p3`: the Earth-raster profile's constants; `p4`: its lean companion (`NEAR_DETAIL` off) — only the two Earth-raster profiles were rerun; `p5`: the coarse probe (`env` only); `p7`: the near body's kind (`main`, `discs`); `p10`: every profile again after P9 (`ourSegment` once in `traceLook`). Note: the profile keys gained NEAR_KIND at P7 (the earlier columns ran without it).

## kerr-mini, cold launches in the browser (Metal)

`tests/e2e/kernel-compile.e2e.test.ts`, `KC_COLD=1` (Chrome's Metal cache emptied before each case). F-35 over Tarifa in
the raster, booted on `game:artemis`. Times are from the Earth key's first compile.

| | P0 | P1 | P1b |
|---|---:|---:|---:|
| the Earth key's tracer lands | 139 s | 56 s | ~60 s (P4: raster at 42 s) |
| its raster material | 45 s | 58 s | 61 s |
| the key with surface + scenery: its tracer | 221 s | 184 s | 0 s at P3 (same pipeline) |
| all compiles settled | 277 s | 253 s | 238 s (P3: 204 s) |

On Apple, Metal already discards dead code cheaply: the source specialisation is a D3D12 win. Key 516's `main` takes
3 s on the mini either way.

## P10 — the final measurements (27/10)

**D3D12 proxy, `p10` column above.** The busy Mac inflates wall times: where the DXIL is the same as at an earlier phase
(Kerr + jet: 103 / 81 / 36 KB at P1b and P10), the time is the machine's, not the code's — `scripts/d3d12-ab.ts`
(DXC CPU time, interleaved) is the fair comparison (P9's table in PROGRESS.md). The general kernel itself shrank
(484 → 320 s); the calibration keeps P0's ratio (342 s here): ×0.93 to the RX 5700 XT machine, ×0.26 to the RTX 5070 Ti.

What a launch waits for, the scene's `main` (Tint + DXC) — and that estimate on the two Windows machines:

| scene | P0 | P10 | RX 5700 XT (est.) | RTX 5070 Ti (est.) |
|---|---:|---:|---:|---:|
| Earth, raster flight | 265 s | 35 s | ~32 s | ~9 s |
| Earth, raster, weather and aurora | 430 s | 43 s | ~40 s | ~11 s |
| Earth traced (on foot) | 234 s | 64 s | ~59 s | ~17 s |
| photo mode (the refining kernel) | 241 s | 66 s | ~61 s | ~17 s |
| the game's universe from space | 117 s | 30 s | ~28 s | ~8 s |
| the Moon | 98 s (P7) | 41 s | ~38 s | ~11 s |
| Kerr + jet | 43 s | 2–8 s | seconds | seconds |
| the general kernel (no longer at start) | 249 + 92 s | 178 + 32 s | — | — |

**kerr-mini (Metal), `kernel-compile`, F-35 over Tarifa booted on `game:artemis`** (times from the Earth key's first
compile; cold: `KC_COLD=1`, the system's Metal cache emptied, a fresh Chrome profile; again: `KC_WARM=1`, the same case
launched a second time on the same Chrome profile — a returning player):

| | P0 | P8 | P9 | P10 cold | P10 again |
|---|---:|---:|---:|---:|---:|
| Earth raster: first image | 134 s | 31 s | 24 s | 19–25 s | **3.8 s** |
| Earth raster: all settled | 276 s | 73 s | 47 s | 42–64 s | **10 s** |
| Earth raster: compile in all | 443 s | 122 s | 75 s | 68–91 s | 17 s (0 cold) |
| Earth traced: first trace / settled | — | — | — | 18 / 65 s | 3.1 / 24 s |
| the Moon: settled | — | — | 7.9 s | 7.9 s | 3.7 s |
| the wormhole: settled | — | — | 8.7 s | 8.6 s | — |
| Kerr: settled | — | — | 3.2 s | 3.1 s | — |

A cached pipeline still takes 2–4.5 s on the mini (the Metal library loaded from Chrome's cache). The Earth traced's
second launch compiled one key the first had not met (67113952, the scenery not in yet: 14 s) — the load's timing.

**The earlier "warm" figures were not a returning player's.** Each e2e Chrome had its own fresh profile, removed on
close: Chrome's shader cache, which lives in the profile, was always empty; a second run only met the system's Metal
cache, which kept some pipelines and not others (the Earth's `main` and `env`, the Moon's `main` compiled again in full).
`App.boot({ profile })` now keeps a profile; `KC_WARM=1` uses it.

**Frame cost, `perf-suite` on kerr-mini, before the plan (`85a1b645`, A) against P9 (`ccf68415`, B)**, A B B A, the
mean of each side's two runs, 60 profiled frames, realtime subsampling ×4, full screen ([perf-p10.txt](perf-p10.txt)):

| scene | trace A [ms] | trace B [ms] | frame A [ms] | frame B [ms] |
|---|---:|---:|---:|---:|
| Interstellar, along the disk | 101.3 | 97.7 | 117.0 | 116.0 |
| Kerr a=0.94, near edge-on | 10.8 | 10.9 | 20.4 | 20.4 |
| volumetric disk + jet | 75.3 | 74.2 | 90.2 | 92.6 |
| Miller, Gargantua over the sea | 122.7 | 123.0 | 157.7 | 157.1 |
| Saturn, backlit | 56.0 | **45.3** | 76.0 | **62.2** |
| the Moon's plains | 67.5 | 62.7 | 93.2 | 83.5 |
| Yosemite, Tunnel View | 9.8 | **3.8** | 48.2 | 41.5 |
| flight, the Alps, cockpit | 7.2 | 5.8 | 29.8* | 38.8 |
| flight, Tarifa, cockpit | 8.2 | 5.8 | 42.4 | 43.2 |

\* the Alps' A frames: 39.1 and 20.5 ms — the second an outlier; B 38.8 both times.

No scene's frame got slower; the trace pass is the same or cheaper everywhere (smaller kernels, fewer registers). In the
flights the trace is 6 ms of a 40 ms frame: the frame is the raster's and the scenery's, not the tracer's. The time to a
measured frame in the suite fell with the compiles (Tarifa's test 176 → 29 s, Yosemite's 179 → 64 s).

## Windows, measured — kerr-pc (RTX 5070 Ti, Ryzen 9 5950X, Chrome 156, D3D12 + DXC) — 28/10

`kernel-compile` on the lab's PC (`--host kerr-pc`, full screen), `KC_WARM=1`: each case launched twice on one Chrome
profile, the second closed by `Browser.close` (`App.quit()` — Windows' `taskkill /F` otherwise ends Chrome before it
writes its caches). Commit 511285b1 (P10's kernels). Logs: [win-p10.txt](win-p10.txt).

| | first launch | again (same profile) | again, `--disable-gpu-sandbox` |
|---|---:|---:|---:|
| Earth raster: first image (the scene's `main`) | 118–151 s | 116 s | 58–60 s |
| Earth raster: all settled | 408–526 s | 406 s | 223 s |
| the Moon: settled (`main` / `env`) | 74–90 s (127–157 / 76–91 s) | 72–86 s | 33 s (68 / 35 s) |
| the wormhole: settled | 69–79 s | 68–79 s | 32 s |
| Kerr: settled | 6.3 s (13.4 s `main`) | 3.0 s (0.3 s) | — |

**The proxy was 3.4 × too optimistic.** The WGSL and constants the game handed Chrome on the PC, captured in the page
(`createShaderModule` / `createComputePipelineAsync` wrapped), compiled here by the proxy's Tint + DXC:

| pipeline | WGSL | DXIL | proxy here (M1 Max, DXC CPU) | on the PC (in Chrome) |
|---|---:|---:|---:|---:|
| Earth raster `main` (key 1677722336) | 243 KB | 920 KB | 33.6 s | 119.5 s |
| its `env` | 234 KB | 927 KB | 24.2 s | 83.6 s |
| `shade` | 217 KB | 1285 KB | 51.0 s | 143.5 s |
| `discs` (DISC_ONLY) | 174 KB | 526 KB | 15.7 s | 48.1 s |
| `shadeWater` | 94 KB | 315 KB | 2.7 s | 15.0 s |
| `shadeLite` | 99 KB | 151 KB | 1.3 s | 4.5 s |

Same source, so the gap is the machine's: roughly half the driver's own compile (DXIL → NVIDIA's code: what
`--disable-gpu-sandbox` takes off a second launch — the sandboxed GPU process never writes NVIDIA's DXCache, nothing
was written there during the runs), half Chrome's DXC being slower than the Mac's (~2 × on the same source).

**A returning player gets nothing from Chrome's shader cache on Windows** for the big kernels: with the sandbox, the
second launch compiles everything again (only Kerr's, small, come back cached); without it, only the driver's part goes.
Dawn's blob cache did not hit for any of the Earth's pipelines, the small ones included (`clouds` 2.5 → 1.1 s, the
driver's share) — why is open (Chrome's Dawn cache size, its eviction, the key?). On the Mac the same relaunch gives
the Earth in 3.8 s.

Levers, in order:
1. **The raster's first image waits for the tracer's `main`** ("raster 120 s" a few seconds after "first trace"):
   `shadeLite` is ready in 4.5 s. A ground drawn before the sky kernel (a plain sky until it comes) would bring the
   Earth's first image on Windows from ~2 min to seconds.
2. Smaller kernels still: the DXIL of `main`, `env`, `shade` is ~1 MB each; every KB counts double on Windows (DXC and
   the driver). The third `ourSegment` copy (todo.md) is in `main`/`env` of every game kernel.
3. Why Dawn's cache misses on Windows: a Chrome-side question (a minimal page with one ~1 MB-DXIL pipeline, launched
   twice, would tell size from key).
