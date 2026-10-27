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
| P3 stable profile | to do | | |
| P4 lean main | to do | | |
| P5 coarse probe | to do | | |
| P6 shade, discs | to do | | |
| P7 NEAR_KIND | to do | | |
| P8 general on demand | to do | | |
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
