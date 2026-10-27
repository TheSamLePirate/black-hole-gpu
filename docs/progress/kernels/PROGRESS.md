# Lean tracer kernels — progress

The plan: [docs/PLAN-LEAN-TRACER-KERNELS.md](../../PLAN-LEAN-TRACER-KERNELS.md). One commit per phase; each line below
says what was done, what was measured, what is left.

Tools (P0):
- `bun scripts/wgsl-inline-size.ts [profile entry] [--stub a,b] [--json]`: the static size of each kernel once inlined.
- `bun scripts/d3d12-compile-proxy.ts [profiles] [--entries …] [--json out]`: Tint + DXC at Chrome 156's Dawn
  (`chromium/8078`), timed per pipeline. Build the tools with `sh scripts/setup-d3d12-proxy.sh` (~30 min).
- `E2E=1 CASES=… bun test tests/e2e/kernel-compile.e2e.test.ts`: cold launches in the browser, `renderer.compileReport()`.
- `__bh.renderer.compileReport()`: every tracer compile of the session.

Measurements: [BASELINE.md](BASELINE.md).

| Phase | State | Commit | Notes |
|---|---|---|---|
| P0 measure | done | see git log "P0" | analyzer, proxy, compile report, kerr-mini baseline; **finding: dead code costs DXC as much as live code** (→ P1b) |
| P1 queue fixes | done | see git log "P1" | Earth key's tracer 139 → 56 s after the launch (kerr-mini, cold) |
| P1b source specialisation | done | see git log "P1b" | D3D12 proxy: Kerr 114 → 8 s, Earth-only 121 → 42 s, game Earth raster 460 → 394 s; same images |
| P2 loading UI | done | see git log "P2" | time run / time left instead of "94 %"; first-time note; Windows iGPU tip (toast, TARS) |
| P3 stable profile | done | see git log "P3" | one compile set per Earth flight; D3D12 Earth raster 394 → 294 s; kerr-mini settled 238 → 204 s |
| P4 lean main | done | see git log "P4" | D3D12 Earth raster main 149 → 97 s; kerr-mini raster image 62 → 42 s after launch; images within noise |
| P5 coarse probe | done | see git log "P5" | D3D12 env: Earth raster 46 → 27 s, Earth traced 72 → 32 s, Kerr 4.6 → 1.8 s; craft light within the probe's noise |
| P6 shade, discs | done | see git log "P6" | shade only when the scenery is in; discs kernel kept (70 vs 90 ms in the telescope) |
| P7 NEAR_KIND | done | see git log "P7" | D3D12: Earth raster main 97 → 58 s, discs 36 → 20 s; space 98 → 40 s; kerr-mini raster at 37 s |
| P8 general on demand | done | see git log "P8" | no general kernel at start; kerr-mini cold Earth: settled 166 → 73 s, raster at 31 s |
| P9 inlining | to do | | |
| P10 guard, docs | to do | | |

## Journal

### P0 — measure (27/10)

- `src/system/tracer-source.ts` (`composeTracer`) and `src/system/tracer-kernels.ts` (`tracerConstants`): the tracer's
  composition and a pipeline's override constants, out of `Renderer` and shared with the tools (no behaviour change).
- `renderer.compileReport()`: each compile (entry, key, seconds, cache hit < 5 s, before the first image), the general
  pipelines included.
- `scripts/lib/wgsl-inline.ts` + `scripts/wgsl-inline-size.ts`: the inlined-size estimate. Constant-false branches are pruned
  (overrides, `let` conjunctions, false bool helpers, `var`s never assigned another value).
- `scripts/d3d12-compile-proxy.ts` + `scripts/setup-d3d12-proxy.sh`: the D3D12 proxy (Tint `--format hlsl --overrides`, DXC
  with Dawn's arguments `-opt-disable structurize-loop-exits-for-unroll /Gis /O3 /Zpr -HV 2018`, `cs_6_6`).
- `tests/e2e/kernel-compile.e2e.test.ts`: cold launches, kerr-mini.

**kerr-mini, cold Earth launch in the game** (F-35 over Tarifa, raster; boot on `game:artemis`):
- first trace of the Earth scene after **134 s**; compiles settled at 276 s; 443 s of compile in total;
- the order seen:
  - the raster group, with `shade` (15 / 27 s) and `discs` (17 / 14 s), compiled **twice**: the key, and the one compiled ahead with surface + scenery;
  - the general kernel (115 s) alongside;
  - then each key's `main` (51 / 83 s) and `env` (35 s).
- The Earth key in the game carries Kerr, the wormhole and the thick disk (512, 32, 64): the game's universe has them.

**D3D12 proxy (this Mac, M1 Max):**
- key 516 `main`: Tint 3.7 s, DXC 41 s;
- the general `main`: DXC 245 s;
- the game's Earth-raster `main`: 233 s.

Tint writes the same 649 KB of HLSL for every key: it does not remove the branches an override makes dead.

**Finding (→ P1b):**
- Removing the constant-false branches from the WGSL before Tint gives the **same DXIL** (same 16 205 lines; phi order only differs).
- Key 516 `main`: DXC 41 s → **1.6 s**, Tint 3.7 → 1.0 s.
- Earth-raster `main`: 233 → 155 s.
- The general kernel: unchanged (nothing to remove).

### P1 — the compile queue (27/10)

- **`rasterFirst` only when this key's trace can already be drawn** (the general kernel, or a covering key): before, the
  boot key's tracer — which does not cover the Earth's — sent the raster group, `shade` and `discs` included, ahead of
  the Earth's own `main`.
- **`shade` off the hard path when the material is on** (`rasterLite`):
  - the raster no longer drops without it;
  - `rasterReady` waits for `shadeLite` + `shadeWater`;
  - until `shade` lands, the pixels the material does not take are traced (`RASTER_SHADE_LATE_FLAG`, trace.wgsl `main`'s `rasterSkip`).
  - `shade` and `discs` now compile late, after `env`.
- **`CompileQueue`:**
  - a second slot for the frame's own compiles beside a running one that is not urgent (another key's, the title's LUT);
  - the slot handed over after a task, not a microtask: the cascade's next urgent compile is queued first (before, a key
    compiled ahead took the slot: its 91 s tracer ran before the frame's 1-second raster kernels);
  - an `onIdle` hook.
- **The general kernel waits** until no compile of the frame's own is waiting or running, and while the title holds the
  game (`renderer.backgroundHold`, set by main.ts `titleHold`). A key's LUT and aerial table wait for the title too.
- `tests/e2e/gpu-startup`: the general pipelines are counted by their constants (the mask's and the warp grid's `main`
  were counted too).

Measured (kerr-mini, `KC_COLD=1`, the Metal cache emptied; F-35 over Tarifa, raster, boot on `game:artemis`):

| | before (P0) | P1 |
|---|---:|---:|
| the Earth key's tracer lands (from its first compile) | 139 s | **56 s** |
| its raster material | 45 s (useless before the tracer) | 58 s |
| the key with surface + scenery: its tracer | 221 s | 184 s |
| all compiles settled | 277 s | 253 s |

Left for later phases:
- the key compiled ahead still recompiles `main` + `env` (P3);
- each `main` is still 50–100 s on the mini (P1b, P4).

### P1b — source-level specialisation (27/10)

- `src/system/wgsl-specialise.ts` (`WgslSpecialiser`): the module parsed once, then for each pipeline:
  - its constant-false branches are removed (`if (false) {}` left, the `else` kept);
  - only the functions its entry point still reaches are kept.
- The sound rules: an override false (or `!X` with X true, or a numeric comparison of a constant); a `let` of such a
  conjunction declared once, not a module or parameter name; a `bool` helper returning one; a `var` given a literal and
  never another value nor its address. Conditions with `||` are left alone.
- The renderer makes every specialised pipeline (the realtime cascade and the quality one) from such a module, cached
  by its text (`renderer.sourceSpecialise`, `globalThis.__kernelSpecialise = false` before load to turn it off). If a
  specialised source is ever rejected, the pipeline is rebuilt from the whole module and the diagnostic says so.
- The general pipelines keep the whole module (P8 deals with them).
- `scripts/check-wgsl.ts` validates every reference scene's specialised sources (61 shaders).
- `scripts/d3d12-compile-proxy.ts --specialise [--equiv]`: specialised timings, and the DXIL of both sources compared.
  `main` and `env` of key 516 are identical (names and order aside). `lut` loses 300 lines of DXIL: the dead code had
  changed DXC's optimisation decisions, and the offline renders are identical.
- `tests/e2e/kernel-equivalence.e2e.test.ts`: six scenes rendered offline, whole module against specialised, same page
  and clock: at most 24 of 92 160 values off by more than one level (the A/A floor is 7 to 17).

**D3D12 proxy (Tint + DXC, s), baseline → specialised:**

| | before | after |
|---|---:|---:|
| Kerr + jet | 114 | 8 |
| Earth-only scene | 121 | 42 |
| eclipse | 108 | 39 |
| the game's universe (736) | 170 | 143 |
| the game's Earth raster flight | 460 | 394 |
| Earth raster with weather and aurora | 682 | 637 |
| the general kernel | 484 | 469 |

The game's Earth kernels are large because they are genuinely full: the Kerr metric, the wormhole and the thick disk
(the game's universe) and every Earth feature. Next: P3 (stable profile), P4 (lean companion), P9 (`ourSegment`
copies).

kerr-mini (Metal): no notable change. Metal already discards dead code cheaply. All e2e green:
- `raster-primary`, `eclipse-raster`, `gpu-startup` (21), `entry`, `kernel-compile`.

### P2 — an honest loading screen; the Windows laptop on its integrated GPU (27/10)

- `loading.describe(stage)`: a stage with no measurable progress (a compile) says how long it has run (`2:17`) and, when
  known, the time left (`1:00 · ~1:00 left`), never a share creeping towards 95 % — the "stuck at 94 %" that started this
  plan. Its bar follows the time left when known (`Stage.remaining`).
- `renderer.sceneCompileEta()`: the scene's tracer's seconds left.
  - It works from the pace of this session's large cold compiles (`main`, `env`: seconds per KB of specialised source)
    and the size of this key's `main` source.
  - It is null until a first cold compile has taught the pace. It feeds the scene and first-image stages and the
    compile meter.
- The scene loading screen adds, after 12 s of compile: "First time on this computer: the ray tracer is being compiled
  for your graphics card, once — a few minutes on some PCs. Later launches will be fast."
- `tier.ts windowsIntegratedGpu()`: Windows with an Intel (not Arc) adapter, or an AMD "Radeon Graphics" without an RX
  model. That is a laptop on its integrated GPU: Chrome ignores the page's `powerPreference` there.
  - The tip (`ui/gpu-tip.ts`): Windows Settings › System › Display › Graphics › Chrome › High performance.
  - It is shown once as a toast at the first image and recorded in the diagnostic.
  - It is in TARS's `get_state` → `graphics`, with the compiles running and queued, the time left and the adapter.

### P3 — the Earth-raster profile, the pipeline memo, pre-warming (27/10)

- `FEATURE_RASTER_PRIMARY` (bit 29): set while the raster draws the near Earth (`rasterPrimary`). Under it,
  `tracerConstants` fixes the bits that came and went in flight:
  - the material kernels carry the regional surface's and the scenery's code, their parameters (zero when absent)
    saying whether any;
  - the traced kernels (`main`, `discs`, `env`, `aerial`) do not;
  - all carry the weather's, the aurora's and a body's shadow's code. Their code is guarded by their parameters
    (`WX_W`, `P.bary.z`, the shadow count). Checked: a fair-weather raster view is the same within the run-to-run noise.
- **Pipeline memo** in `mkVariant`: the same entry, quality, source and constants give the same pipeline. Another key
  whose constants are the same (the surface's and the scenery's bits arriving) is now no compile at all.
  - kerr-mini, cold: the second key's ten pipelines take 0.0 s (they were 100 s for its `main` alone);
  - 23 compiles, 7 cold; settled 238 → 204 s.
- `renderer.prewarmEarthFlight(settings)` compiles the Earth's low flight ahead while the title is open. main.ts calls
  it 8 s after the intro with the title still open, not on e2e pages; `prewarmStop()` when the title closes. Its
  compiles are not urgent: a launch elsewhere passes them.
- **The bug P3's tests found (fixed in its own commit, "P1 (correctif)").** The material pass (`shadeLite` and its water)
  sat inside `shade`'s block. While `shade` compiled (P1's `RASTER_SHADE_LATE`), the ground was not drawn: a black image
  (raster-primary at 3 km on kerr-mini).

**D3D12 proxy (Tint + DXC, s):**

| | P0 | P1b | P3 |
|---|---:|---:|---:|
| Earth raster flight: `main` | 265 | 233 | **149** |
| Earth raster flight: `env` | 77 | 81 | **49** |
| Earth raster flight: total | 460 | 394 | **294** |
| with weather, aurora, cache: `main` | 430 | 419 | **213** |
| with weather, aurora, cache: total | 682 | 637 | **407** |

e2e green: `raster-primary`, `title` (4), `entry` (3), `kernel-compile`.

### P4 — the raster's lean companion (27/10)

- `override NEAR_DETAIL` (trace.wgsl) gates the near ground's sub-pixel detail:
  - the relief's procedural detail under the map's cell (`earthDetail`, its three height functions);
  - the scenery's traced trees and buildings (`worldScenery`) and their shadows (`sceneryShadow`);
  - the sea's waves in relief (`seaSurfaceHit`) and the near world mirrored in it (`seaSSR`).
- Off in the Earth-raster profile's `main` and `discs` (`renderer.leanMain`, default true). The raster draws the near
  ground. The trace draws the sky, and the far ground beyond the raster's rings, where all this is sub-pixel.
- Analyzer: the profile's `main` 131k → **76k** inlined lines. Proxy (DXC): **149 → 97 s**.
- `tests/e2e/raster-companion.e2e.test.ts` captures the same raster view with the whole and the lean kernels, against
  the realtime view's own noise (whole vs whole). Lean vs whole, PSNR (noise in brackets):
  - Kennedy at 900 m: 44.34 dB (44.34);
  - Alps at 3 km: 25.33 dB (25.34);
  - Alps at 12 km: 53.44 dB (53.52);
  - Alps at 60 km: 55.97 dB (55.97).

  That is the noise, with the sky identical and the far ground within it.
- kerr-mini, cold Earth launch: the raster draws at **42 s** (62 s at P3), all settled at 184 s.
- e2e green: `raster-primary` (same figures as P3), `eclipse-raster`, `kernel-compile`.

### P5 — the coarse light probe (27/10)

- `env`, the light probe (a low-resolution panorama for the craft's light), is compiled with `NEAR_DETAIL` off whatever
  the scene (`renderer.coarseProbe`): the near ground's sub-pixel detail is invisible at its resolution.
- `earthLook` is split into its sky (`earthLookSky`: the clouds, the air), its ground and their composition
  (`earthLookCompose`). `keyLight` — the Sun's light on the craft, a ray that never meets the ground — calls
  `earthLookNoGround` and no longer carries a copy of the ground's code. Its result is unchanged: `tHit = -1` drew no
  ground before either.
- Analyzer, `env` (inlined lines):

  | scene | before | after |
  |---|---:|---:|
  | Earth raster | 115k | 59k |
  | Earth traced | 161k | 67k |
  | the game's universe | 109k | 52k |
  | Kerr | 32k | 13k |
  | Earth-only | 52k | 24k |

- Proxy (DXC + Tint), `env`, before → after:

  | scene | before | after |
  |---|---:|---:|
  | Earth raster | 46 s | 27 s |
  | Earth traced | 72 s | 32 s |
  | the game's universe | 41 s | 22 s |
  | Earth-only | 8.7 s | 4.7 s |
  | Kerr | 4.6 s | 1.8 s |

- `tests/e2e/probe-coarse.e2e.test.ts` reads the craft's light (the probe's harmonics) with the whole and the coarse
  probe, against two reads of the whole one. Coarse vs whole (noise in brackets):
  - F-35 over Tarifa: 0.00 % (0.01 %);
  - Ranger in low orbit: 1.05 % (2.26 %);
  - Ranger at Gargantua: 0.06 % (0.19 %).
- e2e green: `kernel-equivalence` (six scenes, as at P1b), `eclipse-raster`, `kernel-compile`. Cold Earth launch on
  kerr-mini: the raster at 48 s, settled at 181 s.

### P6 — shade only when it has pixels; the discs' kernel measured (27/10)

- **`shade`, the leftovers' kernel** (about 50 s of DXC):
  - with the material on (`rasterLite`), its only pixels are the scenery's: a tree against the sky, a box's margin;
  - it now compiles only once the scenery is in (`shadeWanted`), lazily, and the cascade asks for it again when the
    scenery comes. Without the material it draws the whole ground and is compiled as before.
  - It was already off the hard path (P1, `RASTER_SHADE_LATE`).
- **The discs' kernel** (`main` with `DISC_ONLY`, U9), A/B with the lean `main` drawing the discs in its layers instead
  (`renderer.discsKernel`, `disc-cost.e2e` now taking JavaScript levers). Eclipse at Burgos in the telescope at 1.6°,
  kerr-mini, 1920 × 1080:

  | | GPU ms | fps |
  |---|---:|---:|
  | the kernel | 70.2 / 69.6 | 14.5 |
  | `main`'s layers | 90.0 / 90.3 | 11.3 / 11.0 |

  It still pays at the full field: kept, compiled late (P1), after the image.
- e2e green: `kernel-compile` (raster at 42 s), `raster-companion` (lean = noise), `raster-primary` (as before).

### P7 — NEAR_KIND: the near body's kind in the camera's kernels (27/10)

- `override NEAR_KIND` (trace.wgsl): 0 any, 1 the Earth, 2 another world with air, 3 a world without air, 4 none.
  - In `trace()`, the world-with-air path (`earthNear`) and the airless path (`nearMarch`, `shadeNear`) are now two
    `if`s, each out of the kernels whose near body cannot take it.
  - In `earthNear`, the Earth's own code goes through `nearEarth(k)`, which is false for the other worlds.
- Key bits 26–28 (the tune id shrinks to 6 bits, 20–25). Set by `writeParams` from the near body (`bodyHasAir`, kept in
  step with trace.wgsl's `airOf` by `tests/near-kind.test.ts`).
  - Only for `main` and `discs`: the probes see the near body from elsewhere.
  - `renderer.nearKinds` turns it off.
- Analyzer (`main`, inlined lines):

  | scene | before | after |
  |---|---:|---:|
  | Earth raster | 76k | 55k |
  | Earth raster, `discs` | 52k | 31k |
  | Earth traced | 157k | 136k |
  | the game's universe from space | 115k | 68k |
  | the Moon | 115k | 89k |
  | Earth-only | 58k | 37k |

- Proxy (DXC):

  | scene | before | after |
  |---|---:|---:|
  | Earth raster `main` | 97 s | 58 s |
  | Earth raster `discs` | 36 s | 20 s |
  | space | 98 s | 40 s |
  | the Moon | 98 s | 60 s |
  | Earth-only | 28 s | 18 s |
  | Earth traced | 201 s | 167 s |

- `kernel-equivalence` now takes `KE_FLAG` (the switch compared). With `KE_FLAG=nearKinds`, six offline scenes come
  out the same. The Andes once differed on kerr-mini: the Earth's maps were still streaming in for the first render.
  The test now waits for `earthSettled`, and locally gives 4 values off of 92 160.
- kerr-mini, cold Earth launch: the raster at **37 s** (42 s at P6), settled at 166 s. The discs telescope is unchanged
  (68 ms either way).
- e2e green: `kernel-equivalence` (both switches), `kernel-compile` (Earth, Moon, Kerr), `raster-companion`,
  `eclipse-raster`, `disc-cost`.
- Trade-off noted: leaving the Earth for another body is now a new key for `main`. In practice it coincides with the
  key changes that already happen (the raster's bits dropping above 100 km).

### P8 — the general kernel family on demand only (27/10)

- `renderer.generalOnDemand` (default true): no start compiles the general kernels (every feature: `main` + `env`, then
  their quality kernel and LUTs) any more. They are about 330 s of DXC on this Mac, minutes on a Windows PC, in the
  background of every first session. They still compile:
  - when a scene's own kernels fail (the fallback);
  - for the `FEATURES_ALL` key;
  - on an explicit start.
- A still view converges on the scene's own refining kernel, and offline exports use it too (already so since §9 of the
  analysis).
- **Found with it:** since P7 the near body's kind made the planets' light probes' key (no kind) miss the camera's
  `env`. `coveringVariant` now leaves the kind out where it is not compiled in (env, LUTs, the material kernels); a
  kernel for "any" near body covers a given one. Before P8 the general `env` had been hiding it.
- `tests/e2e/gpu-startup`:
  - a new test: a start compiles no general kernel at all;
  - the three tests of the general family's own quality kernel and LUTs ask for it explicitly (`generalOnDemand = false`).
- kerr-mini, cold Earth launch: the raster at **31 s**, all settled at **73 s** (166 s at P7), 122 s of compile in all
  (443 s at P0).
- Unrelated and pre-existing: `offline-settings` fails twice the same way at P7 (a settings tab renamed).
