# Lean tracer kernels — progress

The plan: [docs/PLAN-LEAN-TRACER-KERNELS.md](../../PLAN-LEAN-TRACER-KERNELS.md). One commit per phase; each line below
says what was done, what was measured, what is left.

Tools (P0):
- `bun scripts/wgsl-inline-size.ts [profile entry] [--stub a,b] [--json]`: the static size of each kernel once inlined.
- `bun scripts/d3d12-compile-proxy.ts [profiles] [--entries …] [--json out]`: Tint + DXC at Chrome 156's Dawn
  (`chromium/8078`), timed per pipeline. Build the tools with `sh scripts/setup-d3d12-proxy.sh` (~30 min).
- `E2E=1 CASES=… bun test tests/e2e/kernel-compile.e2e.test.ts`: cold launches in the browser, `renderer.compileReport()`.
- `__bh.renderer.compileReport()`: every tracer compile of the session.

Baselines: [BASELINE.md](BASELINE.md).

| Phase | State | Commit | Notes |
|---|---|---|---|
| P0 measure | done | see git log "P0" | analyzer, proxy, compile report, kerr-mini baseline; **finding: dead code costs DXC as much as live code** (→ P1b) |
| P1 queue fixes | in progress | | |
| P1b source specialisation | to do | | added after P0 |
| P2 loading UI | to do | | |
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
