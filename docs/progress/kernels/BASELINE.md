# Lean tracer kernels — measurements

Reference scenes: `scripts/lib/kernel-profiles.ts`. D3D12 proxy: Tint + DXC at Chrome 156's Dawn (`chromium/8078`),
`cs_6_6`, Dawn's DXC arguments, on this Mac (M1 Max). Calibration: the general kernel's `main` + `env` took **342 s** here.
The recorded Windows figures (`docs/ANALYSE-CHARGEMENT-GPU.md` §9) are 317 s on an RX 5700 XT machine and 90 s on an
RTX 5070 Ti machine, driver step included. So this Mac's proxy runs at about the pace of the 5700 XT machine, and about
3.5× the 5070 Ti's.

A launch compiles a profile's pipelines; the scene's image waits for its `main` (and, before P1, the raster group).

## D3D12 proxy, Tint + DXC seconds per pipeline

Regenerate with `bun scripts/kernel-report.ts docs/progress/kernels/proxy-*.json`.

| profile | pipeline | baseline [s] | p1b [s] |
|---|---|---:|---:|
| earth-raster | shade | 50.7 | 46.6 |
| earth-raster | shadeMark | 0.9 | 0.1 |
| earth-raster | shadeLite | 2.4 | 1.4 |
| earth-raster | shadeWater | 3.9 | 2.8 |
| earth-raster | shadeStars | 0.9 | 0.1 |
| earth-raster | discs | 57.2 | 29.7 |
| earth-raster | clouds | 1.3 | 0.4 |
| earth-raster | main | 265.2 | 232.5 |
| earth-raster | env | 76.5 | 80.8 |
| earth-raster | aerial | 1.1 | 0.1 |
| earth-raster-wx | shade | 94.0 | 98.8 |
| earth-raster-wx | shadeMark | 1.0 | 0.1 |
| earth-raster-wx | shadeLite | 2.3 | 1.6 |
| earth-raster-wx | shadeWater | 3.5 | 2.9 |
| earth-raster-wx | shadeStars | 0.8 | 0.1 |
| earth-raster-wx | discs | 53.8 | 34.9 |
| earth-raster-wx | clouds | 1.6 | 0.8 |
| earth-raster-wx | main | 429.8 | 418.6 |
| earth-raster-wx | env | 94.1 | 79.1 |
| earth-raster-wx | aerial | 1.0 | 0.2 |
| earth-trace | main | 233.6 | 202.6 |
| earth-trace | env | 80.8 | 73.4 |
| earth-trace | aerial | 0.9 | 0.1 |
| earth-photo | main | 241.4 | 210.3 |
| game-space | main | 116.6 | 100.0 |
| game-space | env | 52.8 | 42.5 |
| game-space | aerial | 1.0 | 0.1 |
| earth-only | main | 86.0 | 31.4 |
| earth-only | env | 34.6 | 10.2 |
| earth-only | aerial | 0.9 | 0.2 |
| kerr-jet | main | 43.0 | 1.9 |
| kerr-jet | env | 31.1 | 5.4 |
| kerr-jet | lut | 40.3 | 0.9 |
| eclipse | main | 72.6 | 28.8 |
| eclipse | env | 34.4 | 9.7 |
| eclipse | aerial | 0.9 | 0.2 |
| general | main | 249.1 | 247.0 |
| general | env | 92.4 | 86.2 |
| general | lut | 142.4 | 135.7 |

| profile | baseline total [s] | p1b total [s] |
|---|---:|---:|
| earth-raster | 460 | 394 |
| earth-raster-wx | 682 | 637 |
| earth-trace | 315 | 276 |
| earth-photo | 241 | 210 |
| game-space | 170 | 143 |
| earth-only | 121 | 42 |
| kerr-jet | 114 | 8 |
| eclipse | 108 | 39 |
| general | 484 | 469 |

`baseline`: P0, the whole module for every pipeline. `p1b`: the sources specialised as the renderer now makes them.

## kerr-mini, cold launches in the browser (Metal)

`tests/e2e/kernel-compile.e2e.test.ts`, `KC_COLD=1` (Chrome's Metal cache emptied before each case). F-35 over Tarifa in
the raster, booted on `game:artemis`. Times are from the Earth key's first compile.

| | P0 | P1 | P1b |
|---|---:|---:|---:|
| the Earth key's tracer lands | 139 s | 56 s | ~60 s |
| its raster material | 45 s | 58 s | 61 s |
| the key with surface + scenery: its tracer | 221 s | 184 s | — |
| all compiles settled | 277 s | 253 s | 238 s |

On Apple, Metal already discards dead code cheaply: the source specialisation is a D3D12 win. Key 516's `main` takes
3 s on the mini either way.
