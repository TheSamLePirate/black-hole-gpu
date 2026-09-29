# Audit plan (§16) — measured progress

Branch `audit-plan`. Every step is measured with `scripts/bench.ts` (headless Chrome, 1469×965 @2×,
Game quality), usually in `--compare` mode: the reference build (served from `git archive`) and this
one alternated scene by scene, two runs each — the machine's own drift in clocks and heat falls on
both. "fixed b4" is the frame time at subsampling 4, full scale: the kernel's cost, which the automatic
controllers otherwise turn into a sharper image instead of fps.

## Wave A (vs `b3a8f3d`, the plan's start) — `bench-wave-a.json`

| Scene | fps (auto) | p95 | fixed b4 | GPU memory |
|---|---|---|---|---|
| Earth orbit (game:artemis) | 60 → 60, rays/px ×1.8 | 18.5 → 18.4 ms | 16.9 → 16.9 ms | 1139 → 1122 MiB |
| Near Gargantua | 49.8 → 54 | 33.7 → 32.5 ms | 49.6 → 45 ms | 739 → 366 MiB |
| Along the disk | 43.2 → 49.2 | 32.5 → 25.9 ms | 132 → 126 ms | 332 → 315 MiB |
| Classic Kerr | 50.5 → 49.5 | 32.1 → 32.9 ms | 72.7 → 81.8 ms | 332 → 315 MiB |
| Saturn backlit | 49.8 → 48.8 | 29.6 → 33.4 ms | 55.1 → 49.7 ms | 757 → 494 MiB |
| Wormhole to Gargantua | 47.9 → 50.7 | 31 → 32.6 ms | 32.3 → 35.8 ms | 580 → 440 MiB |
| Moon's ground | 58.3 → 51.6, rays/px ×1.4 | 22.4 → 32.1 ms | 38.1 → 26.1 ms | 927 → 910 MiB |
| Miller's sea | 40.8 → 52 | 35.9 → 27.5 ms | 110 → 71 ms | 821 → 494 MiB |

Per step (commit messages hold the details): A1 probe resets (no measurable gain here), A2 governor
(Earth 36 → 50 fps), A3 refinement bands (still view 31 → 34 fps), A4 HUD staggering (loop p95
27 → 22 ms), A5 display-fitted budget (Earth p95 46 → 31 ms), A6 optional frosted panels, A7 footprint
streaming (−250 to −750 MiB), A8 step reuse (Miller −12 %), A9 noise hashing (Gargantua −9 %), A10
pow → x*x (Windows/Linux fix), A11 true sRGB maps, A12 block footprint (no strobing / salt in
motion), A13 blue noise + TPDF + averaged meter, A14 polarization buffer and bloom on demand, A15 Kerr
path in the worker, Earth heights on the GPU.

Findings that differ from the audit's estimates: the probe's full reset costs about as much as a
quarter (its pass is bound by its slowest rays); the step bookkeeping (A8) and integer hashing (A9)
are not what bounds the kernel on this Apple GPU — the volumetric disk is (2.4× the thin disk's cost;
smoke alone +50 %), the target of wave B's B3.

## Wave B

| Step | Result (measured, alternated with the commit before) |
|---|---|
| B1 temporal reprojection (TAAU) | realtime vs converged PSNR in a frame-locked turn: classic Kerr 19.8 → 23.8 dB, near Gargantua 14.7 → 18.2, Earth orbit 28.2 → 30.6, Moon's ground =, Saturn −1 dB; 0.4 ms |
| B3 disk noise baked (3D texture) | along the disk 93 → 67 ms (fixed b4), near Gargantua 41 → 34, Miller 82 → 71; same look, another draw of the noise |
| B2 kernel specialisation (HAS_*) | features compiled out per scene, built in the background: near Gargantua −12 %, along the disk −11 %; without the wormhole: classic Kerr 76 → 39 ms, Luminet 43 → 23, jet 56 → 30; without bodies: classic Kerr 42.6 → 26.7 ms |
| B5 hardware tier | pixel budget for the Game quality (0.5–6 Mpx by tier); this Mac tier 2 (2.2 Mpx) — unchanged here |
| B6 KTX2 colour maps (BC7/ASTC) | GPU memory: Earth orbit 1160 → 694 MiB, Earthrise 948 → 770, Saturn 532 → 450; +100 MB in the repository, ~4× the Earth's high-tier download (UASTC quality chosen) |
| B7 | GPU profiler on one frame in eight (it cost 2–3 %); gather + resolve fusion not worth it (a 2D gather) |
| B8 Ranger | smooth normals from the coarse mesh (no more faceting), MSAA resolved on c/(1+L) |
| B10 robustness | device loss: autosave + reload panel; uncaptured GPU errors shown; Earth maps under an OOM scope, falling back a tier |
| B4 dynamic resolution without reallocation | not done: a resize costs 0.5–1 ms of CPU and no frame over 20 ms on this machine — measured, no gain to take |
| B8 ship shadow on the traced ground | the Ranger's own shadow map, orthographic from the environment's dominant light, read by the traced ground (`0a1c2e3`) |
| B9 the Endurance (LOD, GGX) | four levels (5 / 10 / 40 / 100 % of the triangles; Blender's decimation at 2 % left spikes) picked by the box's width with hysteresis, each downloaded when first needed (0.7 MB at first sight instead of 5.8 MB); GGX (Smith, Schlick, split-sum) lit by the disk projected on order-2 harmonics from the ship's place each frame (its light wraps round the ring; highlights from its dominant direction); box depth in `rg16float` and kept ≤ 1.5× its need: 96 → 76 B/px (a full-screen ship: ~207 → ~164 MiB); bind groups cached. Cost unmeasurable next to the tracer (full-screen ship ±1 fps). Composite pass not merged into the display (it feeds the bloom). `docs/progress/109_endurance_lod_ggx.jpg` (before │ after, far and near) |

## Wave C (so far)

| Step | Result |
|---|---|
| Fixed simulation step | sub-step budget per second of frame instead of per frame; measured: the time warp was already the same at 30, 60 and 120 Hz here (another limit paces the ship's clock) — a full fixed-timestep loop not adopted (144 Hz displays would get frames with no step; at 240 Hz ~3 ms of CPU a frame) |
| Far-field LUT | scenes with only the hole and its disk: rays between clean samples (escaped untouched, r > 6, equator crossed beyond 1.5 × the disk) interpolated; Luminet +7 %, Schwarzschild +5 % at full resolution; converged images within 50 dB (stars moved by a fraction of a pixel) |
| f16 / subgroups | not done: after B3 the remaining cost is the geodesics' RK4, which needs f32 (removing the disk or the sky barely changes a frame) |
| Volumetric clouds | below 30 km, the Earth's clouds marched as a volume (1.5 km to a top rising with the cover, 16 samples crowded near the camera, ≤ 250 km): the flat layer's cover shaped in height by the baked 3D noise (cumulus domes, not walls), Henyey–Greenstein + powder + a multiple-scattering term, the sky's light dimmed under the cloud; Brittany at b4: 58.4 → 53.7 fps (−8 %), orbit unchanged (the shell); setting `volumetricClouds`; `docs/progress/108_volumetric_clouds.jpg` (shell │ volume) |
| Virtual texturing, wavefront, adaptive sparse tracing | not done yet |

## Now vs the plan's start (`b3a8f3d`) — `bench-now-vs-start.json`

Alternated, 2 runs each, the specialised tracers compiled during a 35 s warm-up.

| Scene | fps (auto) | rays/px (auto) | fixed b4 | GPU memory |
|---|---|---|---|---|
| Earth orbit | 59.6 → 59.2 | 0.043 → 0.043 | 17.0 → 17.0 ms | 1246 → 695 MiB |
| Near Gargantua | 47.5 → 56.0 | 0.0054 → 0.0339 (×6.3) | 36.4 → 16.8 ms (−54 %) | 1151 → 376 MiB |
| Along the disk | 46.3 → 43.4 | 0.0021 → 0.0034 (+62 %) | 82.5 → 38.5 ms (−53 %) | 1160 → 385 MiB |
| Classic Kerr | 52.0 → 57.0 | 0.0035 → 0.0153 (×4.4) | 53.1 → 17.1 ms (−68 %) | 1160 → 385 MiB |
| Saturn backlit | 45.3 → 45.1 | 0.0054 → 0.0061 | 41.5 → 38.2 ms | 1269 → 451 MiB |
| Wormhole to Gargantua | 47.8 → 45.8 | 0.0047 → 0.0083 (+77 %) | 29.8 → 20.4 ms (−32 %) | 1182 → 385 MiB |
| Moon's ground | 51.8 → 53.5 | 0.0072 → 0.0083 | 20.6 → 19.7 ms | 1439 → 771 MiB |
| Miller's sea | 47.3 → 48.5 | 0.0019 → 0.0034 (+79 %) | 84.3 → 49.5 ms (−41 %) | 1333 → 451 MiB |

The automatic controls turn the kernel's savings into image (rays per pixel) at ~the same frame rate;
the realtime image is further sharpened by the temporal reprojection (B1: +2.4 to +4 dB).
