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
| B8 ship shadow on the traced ground, B9 the Endurance (LOD, GGX) | not done yet |
