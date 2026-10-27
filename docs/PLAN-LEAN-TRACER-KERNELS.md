# lean-tracer-kernels

- Source: ht_plan_set
- Created: 2026-10-26T23:35:55.273Z

## Sidebar steps

- [ ] **P0** — Measure: analyzer script, Mac baselines, local D3D12 proxy (Tint + DXC)
- [ ] **P1** — Compile-queue fixes (order, shade optional, slots)
- [ ] **P2** — Honest loading UI + Windows iGPU hint
- [ ] **P3** — Stable Earth-raster profile + pre-warm
- [ ] **P4** — Lean raster-companion main (near detail out)
- [ ] **P5** — Coarse light probe (env, keyLight)
- [ ] **P6** — Retire shade from the hard path; discs merge A/B
- [ ] **P7** — NEAR_KIND: planets without Earth code
- [ ] **P8** — General kernel family on demand only
- [ ] **P9** — Cut inlining (single call sites, gnoise, wormhole)
- [ ] **P10** — Budgets guard, docs, final proxy + Mac re-measure
## Detailed plan

# Plan — Lean tracer kernels in the raster era (fast loading on Windows/D3D12, RTX 4050 class)

## 0. Objective

A Windows laptop with an RTX 4050 hangs at "Compilation du lancer de rayons … 94 %" when a scene is launched. The cause is not a bug in the shaders. It is **how much code is compiled, in what order, and how often**:

- On D3D12 every function is inlined into its entry point (WGSL → HLSL → DXC → DXIL → driver), so compile time is roughly proportional to the inlined size. Calibration from `docs/ANALYSE-CHARGEMENT-GPU.md` §9: general kernel ≈ 205k inlined lines → 317 s (RX 5700 XT machine) and 90 s (RTX 5070 Ti machine); key 516 ≈ 14k lines → 28 s.
- One Earth-raster key compiles about **380k inlined lines** across 9 kernels. About 280k of it is the old traced near-ground, which the raster replaced in flight:
  - `main` 122k
  - `env` 109k
  - `shade` 82k
  - `discs` 44k
  - the raster kernels (`shadeLite`, `shadeWater`, `clouds`, `shadeMark`, `shadeStars`, `aerial`) ≈ 26k
- The queue makes it worse: the raster group (with `shade` 82k and `discs` 44k) goes before `main` while nothing can draw the scene; a running job of another key cannot be skipped; the general family (≈ 200k per entry) compiles alongside.
- Feature bits that change at run time (surface/scenery arriving, weather, aurora, eclipse) create new keys. Each new key is a cold compile, and none of them is ever a Chrome-cache hit across sessions.
- Chrome on a Windows laptop ignores `powerPreference: "high-performance"`, so the game probably runs on the integrated GPU.

**Goal:** the Earth and the planets look and behave exactly as today with the raster, including every atmospheric and physical effect, and the black holes, relativity and wormholes stay as they are. Targets:
- **First launch** of an Earth scene on a 4050 laptop: **under 60 s** from Launch to image, honest progress meanwhile.
- **Every later launch: a few seconds** (Chrome shader cache hits on stable keys).
- **No visual regression** in flight (raster), photo mode, offline, walking, space or relativistic scenes.

**Constraint: no Windows measurements for now.** There will be no graphics diagnostics from Windows players and no Windows machine to test on. Windows compile cost is therefore measured with a **local proxy for the D3D12 compile chain** (P0.3): the same Tint that Chrome uses, translating WGSL to HLSL with the pipeline's override values, then the same DXC compiling HLSL to DXIL. The proxy is calibrated against the few Windows figures already recorded in `docs/ANALYSE-CHARGEMENT-GPU.md` §9. Runtime and image checks are done on Apple (kerr-mini, the M1 Max). Anything only a real Windows GPU can show (the driver's own DXIL → GPU code compile, the integrated GPU's speed) stays an estimate until a Windows machine or player report becomes available. It is optional and never blocks a phase.

**Not in scope:** removing the traced Earth. It stays as the **reference/quality family** (photo mode, offline, `earthPipeline: "trace"`, walking), compiled on demand.

## 1. Facts this plan relies on (verified in code)

| Fact | Where |
|---|---|
| Loading % for an indeterminate stage tends to 95 % and never reaches it | `src/loading.ts fracOf`; `src/ui/entry.ts:106`; `src/intro/intro.ts info()` |
| Scene pill stays until a frame is traced; `rtGivenUp` does not provide a pipeline | `renderer.ts noteSceneTracer`, `dispatchTrace` (`if (!pipeline) return false`) |
| `rasterFirst` is true as soon as *any* key has an `rt`, even one that cannot draw this key | `renderer.ts realtimeCascade` (~4220) |
| Raster dropped if `shade` missing; `rasterReady` needs `shade`/`shadeMark`; cascade requires `shade` | `renderer.ts` ~4603, ~4174, ~4120 |
| `shade` only shades pixels `shadeLite` leaves (trees against the sky, box margins) | `trace.wgsl shade` → `rasterLiteTakes` |
| Running compile holds the single queue slot; stall limit = max(60 s, 3 × longest) | `src/util/async-resource.ts CompileQueue` |
| Runways already removed from the raster key (U5), raster kernels always carry runway code | `docs/progress/raster-aaa/TERRE-UNREAL.md` U5 |
| `earthNear` (traced near ground) is in every key with bodies; Earth-only parts gated at run time by `isEarth(k)` | `trace.wgsl earthNear`, `trace()` |
| `env` contains `earthLook` twice (probe ground + `keyLight` sun transmittance with t = −1) | `trace.wgsl env`, `keyLight` |
| General kernel: all `HAS_*` on, raster/cache off; started after the scene's `env` and runs concurrently | `renderer.ts generalCompile` |
| Raster is Earth-only (< 100 km); planets are traced (air worlds by `earthNear`, airless by `nearMarch`) | `renderer.ts` terrainRasterEligible; `trace.wgsl trace()` |
| Chrome/Windows ignores `powerPreference` on dual-GPU laptops | Chrome WebGPU troubleshooting docs |

Static estimates, from the inline-size analysis (upper bounds, still to be confirmed by measurement):

| Kernel / scenario | Inlined lines |
|---|---:|
| Earth raster `main` today | 122k |
| … without airless-near path (`nearMarch`, `shadeNear`) | 96k |
| … plus near-only detail out (sub-cell detail, traced scenery/forests, windsocks/airport, sea relief hit, water mirror), far ground kept | **31k** |
| … sky-only (raster rings reach the horizon) | **15k** |
| Earth `env` today / coarse probe ground | 109k / **38k** |
| `shade` today / with near detail out | 82k / 17k (or removed) |
| Planet scene (bodies only) `main` today / without `earthNear` | 72k / 40k |
| Key 516 (Kerr + jet) `main` | 14k |

## 2. Approach (phases)

Each phase can ship on its own and is measured before the next one. Every behaviour change sits behind a renderer flag reachable through `__bh` for A/B testing and rollback, and documented in `docs/BH-API.md`.

### P0 — Measure first (no behaviour change)
1. **Analyzer as a script:** `scripts/wgsl-inline-size.ts`. It composes the tracer as `Renderer.create()` does, prunes constant-false branches and const-false helpers, and reports per entry point and per profile: unique lines, inlined lines, top multipliers (copies × subtree). It also prints the "what if" stub scenarios.
2. **Baselines on kerr-mini** (`tests/e2e/compile-time.e2e.test.ts`, extended with scenes and per-entry `pipeline-compiled` records):
   - Earth raster: Paris low, Tarifa sea, Alps at sunset
   - Moon surface, Mars
   - Kerr / Interstellar
   - wormhole
   - eclipse at Burgos

   Cold cache (fresh profile) and warm cache.
3. **Local D3D12 compile proxy:** `scripts/d3d12-compile-proxy.ts` (needs no Windows machine).
   - **Tools:**
     - **Tint**, built from the Dawn commit that matches current Chrome stable (the `tint` command-line tool, HLSL output, override values substituted);
     - **DXC**, the prebuilt Linux release or a macOS build, run in Docker if the macOS build is a problem.
   - **For each entry point × profile** (the scenes of P0.2), it composes the tracer as `Renderer.create()` does, then measures:
     - the HLSL size;
     - the time and peak memory of Tint and of `dxc -T cs_6_x` with the options Dawn uses;
     - the DXIL size and instruction count.
   - **Calibration** against the recorded Windows figures (`docs/ANALYSE-CHARGEMENT-GPU.md` §9):
     - RX 5700 XT machine: key 516 27.8 s, general kernel 317 s, wormhole scene 213 s;
     - RTX 5070 Ti machine: general kernel 90 s.

     The proxy gives Tint + DXC time; the gap to those totals is attributed to the driver step and to the machine's CPU. Record it as a ratio.
   - **What it covers:** the browser-side compile on Windows, which grows with the inlined size and is the cost targeted here.
   - **What it does not cover:** the NVIDIA/AMD/Intel driver turning DXIL into GPU code, and the speed of the integrated GPU's driver. Report both as estimates.
   - **Cross-check:** compare the analyzer's inlined-line estimates with the measured DXIL instruction counts. The analyzer becomes the fast check; the proxy is the reference.
4. **Apple compile times** as a second check: Chrome on macOS (Tint → MSL → Metal compiler). These are real browser compiles. Metal does not inline the way DXC does, so its gains will be smaller, but they will go in the same direction.
5. Expose `__bh.renderer.compileReport()`: per entry, per key, duration, cache hit (< 5 s), queue wait time.

**Exit:** in `docs/progress/kernels/BASELINE.md`, a baseline table of scene × entry × (analyzer lines, proxy Tint + DXC seconds and DXIL size, kerr-mini browser seconds), with the calibration ratio to the recorded Windows figures. It confirms that compile time is proportional to size.

### P1 — Compile-queue fixes (TypeScript only, low risk)
1. **`rasterFirst` only when the trace can be drawn:** `this.tracePipeline || this.coveringVariant(key, "rt")`.
2. **`shade` optional when `rasterLite`:**
   - `dispatchTrace` drops the raster only if `shadeLite` (and `shadeMark` at rate > 1) is missing;
   - `rasterReady` requires `shadeLite`/`shadeWater` instead of `shade`;
   - `shade` and `discs` move to a **late group** compiled after `main` + `env`.
   - While `shade` is absent, `main` must not skip the pixels `shade` would take (tree against the sky: `RASTER_ID` without hint). Add a param flag `RASTER_SHADE_READY` read by `main`'s `rasterSkip`.
3. **Second slot for the camera key:** if the running job belongs to another key (title `env`/`lut`, a stalled job), the camera key's urgent `main` may start in a second slot (at most two concurrent).
4. **Title screen:** don't start non-urgent jobs (title `lut`, `aerial`, quality) while the title is open; they resume after launch only if still wanted.
5. **General kernel start** deferred while the camera key's `main` is compiling (no two monoliths side by side on slow machines).

**Exit:** cold Earth launch on kerr-mini: time from Launch to the first traced frame cut by at least 40 % against the baseline. `entry.e2e`, `raster-primary.e2e`, `raster-flight.e2e`, `gpu-startup.e2e` green.

### P1b — Source-level specialisation (added after P0's measurements)
**Found in P0 with the proxy:** Tint does not remove the branches an override constant makes dead. It writes the whole
reachable code into the HLSL (649 KB for every key's `main`), and DXC parses and inlines all of it before folding the
constants. Dead code costs DXC almost as much as live code:
- key 516 (Kerr + jet) `main`: **41 s of DXC, then 1.6 s** once the dead branches are removed from the WGSL first. Same DXIL (16 205 lines; only phi-node order differs).
- Earth-raster `main`: 233 s → 155 s, again with the same DXIL.

**Change:** the renderer builds each specialised pipeline from a **module specialised as source**: the constant-false
branches are removed in JS before `createShaderModule` (`specialiseWgsl`, shared with the tools). Modules are cached
by their text, so pipelines with the same text share one module, and Chrome's shader cache still hits across sessions
(the text is deterministic).

**Safety:**
- unit tests on the pruning rules;
- `check-wgsl` validates every profile's specialised source;
- the proxy compares the DXIL of the specialised and unspecialised compiles (identical up to the order of SSA names);
- a renderer flag (`renderer.sourceSpecialise`) for A/B and rollback.

**Exit:**
- the proxy's DXC time drops on every specialised profile, with identical DXIL;
- kerr-mini e2e (`kernel-compile`, `raster-primary`, `eclipse-raster`, `compile-time`) green, images unchanged.

### P2 — Honest loading UI and the Windows GPU hint
1. Replace the asymptotic % for compile stages with elapsed time, queue count and an **ETA**:
   - weights per entry/profile come from the analyzer (generated table at build time);
   - pace = ms per line measured on the first real compile of the session (warm-cache compiles under 5 s excluded).
2. Message on a cold compile: "first launch on this PC: compiling shaders (one time); later launches are fast".
3. **Windows hybrid-GPU hint:** Windows + adapter vendor Intel/AMD integrated (or `guessTier` level ≤ 1 on Windows) → a one-time tip with the steps (Windows Settings › Display › Graphics › Chrome › High performance; NVIDIA Control Panel). Reachable from TARS and the pause menu help.
4. The entry veil's 90 s cap stays, but the pill shows the same ETA afterwards.

**Exit:** `entry.e2e` (with `__bh.entry.compile(ms)`), i18n check (`scripts/check-i18n-calls.ts`), TARS can tell the compile state and the GPU tip.

### P3 — A stable Earth-raster profile and pre-warming
1. **Key bits that must not recompile `main`/`env` in raster mode** (as was done for runways in U5):
   - `4096` surface and `8192` scenery: out of `main`/`env` constants when raster primary + lite. The raster kernels always compile the surface/scenery code (runtime params decide).
   - `1024` weather, `16384` aurora and `2048` eclipse: always on in the Earth profile (raster kernels and lean `main`), so their params decide at run time.
   - The `aheadKey` mechanism is no longer needed in raster mode; keep it for the traced pipeline.
2. **Per-entry key canonicalisation:** `entryKey(key, entry)` masks the bits an entry does not read. The pipeline map is keyed per entry, so `env`/`lut`/`aerial` are shared across keys.
3. **Profiles:**
   - `EARTH_RASTER`
   - `EARTH_TRACE` (photo/walk/trace option)
   - `SPACE_BH` (feature bits as today: BH keys are already lean)
   - `PLANET_AIR`
   - `PLANET_AIRLESS`
   - `WORMHOLE`

   A launch resolves to one profile key, which stays stable for the whole flight.
4. **Pre-warm:**
   - while the title is open, compile the launch target's profile (last played, or the mode under the cursor);
   - store the last profiles in `localStorage` and request them at boot (a cache hit is about 0.2 s);
   - when the craft lands/stops on Earth, pre-warm `EARTH_TRACE` for walking.

**Exit:** a full Paris flight (taking off, the city's scenery arriving, weather change) logs **one** realtime key; the second session's launch is under 5 s to image on kerr-mini (Chrome's cache works the same way on every platform: a stable key is what makes it hit). The proxy reports a single compile set per flight.

### P4 — Lean raster-companion `main`
1. New override **`RASTER_COMPANION`**, set for `main` when the frame is **raster primary + lite** (a dedicated key bit, distinct from the hint-only mode, which still marches with full detail). It compiles out:
   - procedural sub-cell detail (`earthDetail`);
   - traced scenery and forests (`worldScenery`, `forest*`, `sceneryQuery`);
   - windsocks and airport scenery;
   - the sea relief hit (`seaSurfaceHit`) and the water mirror (`waterMirror`);
   - fine relief normals beyond the far-ground needs.

   It keeps `earthMarchHinted`/`earthMarch` at coarse level and `earthLook` (air, clouds, sea at far range, eclipses, refraction) for the ground beyond the raster's outer ring. **Target ≤ 35k inlined lines.**
2. Optional later step: **raster rings to the horizon** below 100 km (a few coarse clipmap levels), so `main` becomes sky-only (target about 15k). Decide after P4.1 is measured.
3. Fallback while the raster kernels compile (a few seconds, they compile first): the lean `main` draws coarse ground. Acceptable; documented.
4. Where the raster drops for a long time (walking, photo mode, > 100 km, the inspector), the key leaves the raster profile and the right family is used (P3).

**Exit:**
- Image A/B (flag) at Paris low, Tarifa, Alps sunset, 3 km / 10 km / 50 km altitude, horizon and ring edge: no visible difference. `flight-quality` PSNR within the run-to-run noise.
- `raster-paths.e2e`, `raster-motion.e2e`, `terrain-raster.e2e` green. Runtime per pass equal or better (`perf-ab.e2e`; registers on Apple).
- Measured `main` compile down in line with the estimate.

### P5 — Coarse light probe (`env`, `keyLight`)
1. Override **`PROBE_COARSE`** for `env`: probe ground without the water mirror, the relief-shadow march (the far sun shadow map where available), sub-cell detail or scenery shadows; probe-resolution footprint.
2. `keyLight`: the sun's transmittance from a small dedicated function (air columns + cloud shadow map + eclipse share), not the full `earthLook`.
3. Constant gating in `env` (`HAS_BODIES &&` directly in the `if`s), so black-hole keys are guaranteed free of Earth code.

**Exit:** probe output (`envBuf` SH / mean colours) within a set tolerance against today's on reference scenes (day, sunset, night, eclipse, low orbit). Hull lighting captures unchanged (F-35, Ranger). `env` compile down to about 40k (Earth).

### P6 — `shade` off the hard path; `discs` merge A/B
1. Handle the leftover pixels without the 82k kernel:
   - (a) `shadeLite` takes trees against the sky through `sceneryTreeLite` (a miss leaves the pixel to the sky via a marker); or
   - (b) `shade` compiled with `RASTER_COMPANION`-like stubs (target ≤ 20k) in the late group.

   Choose after visual comparison of tree silhouettes (low forest flight, Paris parks).
2. **`discs`:** with a lean `main`, A/B `discs` kernel vs `main` layers (`disc-cost.e2e`, telescope eclipse, full Moon) for runtime on Apple, and for compile cost with the proxy. Keep the separate kernel only if it still pays for its compile (the U9 register lesson).

**Exit:** `eclipse-raster.e2e`, `disc-cost.e2e`, `raster-primary.e2e` green; telescope frame times not worse; per-key compile set ≤ 140k lines (Earth raster).

### P7 — `NEAR_KIND`: planets without the Earth's code
1. Override **`NEAR_KIND`**, from the near body: 0 none, 1 Earth, 2 world with air (Mars, Titan), 3 airless world with relief (Moon, Gargantua's planets). It compile-gates:
   - the Earth-only parts of `earthNear` (DEM relief march, scenery, forests, sea, runways);
   - `nearMarch`/`shadeNear`.
2. Key layout: review the packed key (bits 15, 16–19 cost view, 20–27 tunes, 30 raster). Either use free bits or move to a structured `KernelProfile` mapped to constants. No sign-bit use.

**Exit:** Moon, Mars and Saturn scenes look identical (captures); `main` for an airless planet down to about 40k; Earth keys lose the airless path (−26k).

### P8 — The general kernel family on demand only
1. The fallback for a key not compiled yet becomes the covering profile kernel or the lean companion. The general `main`/`env` stop compiling at every start.
2. General quality/LUT kept for offline export and the `trace` option only, compiled when asked (`renderdialog` already waits for quality).
3. Check every user of `tracePipeline` / `generalCompile` / `qualityCompile`: offline, photo mode, bench, probes, calibration (`calibrationReady`).

**Exit:** a normal session compiles no FEATURES_ALL pipeline. Offline export, photo mode and the bench still work (`renderdialog`, bench e2e).

### P9 — Cut inlining at the source (helps Metal too)
1. **Single call site** (the call inside a loop, trip count known only at run time so the compiler keeps the loop):
   - `waterMirror → earthHeight` ×5
   - `earthMarchHinted → marchClear` ×5
   - `earthTerrainShadow → earthHeightStep` ×3
   - `reliefNormal → reliefBase` ×3
   - `shadeNear → reliefNormal` ×2
   - `earthMarchFrom → earthHeight` ×2
2. **`gnoise`** with a corner loop like `gnoiseI`: bit-identical output. Verify that DXC/Metal do not unroll it back (measure).
3. **Wormhole:** `ourSegment` (about 48k lines per copy) called once in `traceLook` (a two-iteration loop or a merged call), plus constant gating `HAS_WH && seg == 1u`.

**Exit:** bit-identical or within-noise images (`trace-ab`, precision probe for the geodesic code); compile reductions measured with the proxy and on kerr-mini; the wormhole profile's proxy time cut by at least half (the 213 s Windows data point scaled by the calibration ratio).

### P10 — Guard, docs, final measurement (proxy + Apple)
1. **Budget test** in `bun test`: the analyzer's inlined size per entry/profile must stay under a budget (fails on regressions such as a new noise call in an unbounded call site).
2. Docs:
   - `docs/ANALYSE-CHARGEMENT-GPU.md` (new section);
   - `docs/BH-API.md` (new flags, `compileReport`);
   - `docs/E2E-CATALOGUE.md`;
   - `docs/systemes/02-pipeline-rendu.md` (the kernel families).
3. Re-measure with the D3D12 proxy and on kerr-mini (cold and warm cache); update the baseline table with before/after and the estimated Windows times (proxy × calibration ratio).
4. Optional, never blocking: if a Windows machine, a cloud Windows VM with a GPU, or a player report becomes available, check the estimate. That includes integrated vs NVIDIA GPU, using the in-game diagnostic, which already records every compile's duration.

## 3. Files and areas affected

| Area | Files |
|---|---|
| Compile queue, cascade, keys, profiles, fallback | `src/renderer.ts` (realtimeCascade, traceVariant, mkVariant, rasterReady, dispatchTrace, generalCompile, featureKey, aheadKey), `src/util/async-resource.ts` |
| Loading UI | `src/loading.ts`, `src/ui/entry.ts`, `src/intro/intro.ts`, `src/main.ts` (compile meter), `src/i18n/*` |
| GPU hint | `src/tier.ts`, `src/renderer.ts` (adapter info), TARS (`src/ui/tars-panel.ts` and its tools) |
| Shader constants and gating | `src/shaders/trace.wgsl` (earthNear, trace, env, keyLight, shade, traceLook, gnoise, terrain height callers), composition helpers in `src/system/*`, `src/forest-shader.ts` |
| Pre-warm | `src/ui/title/title.ts`, `src/main.ts`, `src/renderer.ts` |
| Tooling | `scripts/wgsl-inline-size.ts` (new), `scripts/d3d12-compile-proxy.ts` (new; Tint + DXC, pinned versions, Docker image if needed), `scripts/check-wgsl.ts` (new profiles validated), `tests/e2e/compile-time.e2e.test.ts` |
| Docs | as listed in P10 |

## 4. Validation (every phase)

- `bun run check && bun test` before every push.
- `bun scripts/check-wgsl.ts`: every profile/constant combination validates.
- E2E (docs/E2E.md, on kerr-mini with `--remote`):
  - startup and entry: `compile-time`, `entry`, `gpu-startup`, `boot-time`;
  - raster: `raster-primary`, `raster-flight`, `raster-paths`, `raster-motion`, `raster-pulse`;
  - discs and eclipse: `eclipse-raster`, `disc-cost`;
  - performance: `perf-ab`, `perf-suite`;
  - image quality: `flight-quality`.
- Captures A/B (flag on/off) on the reference scenes:
  - Earth: Paris low, Tarifa, Alps sunset, cumulus crossing, night with Moon, eclipse at Burgos, low orbit (400 km), 100 km boundary;
  - planets: Moon surface, Mars;
  - relativistic: Gargantua, Kerr, wormhole.
- Windows cost: the D3D12 proxy (Tint + DXC) per entry/profile, before/after each shader phase. A phase passes only if its proxy figures go down as its estimate says.
- Optional: Windows field reports when available (not a gate).

## 5. Expected gains (estimates, to be confirmed by P0 and each exit)

| Step | Earth-raster cold launch (lines on the critical path) | Later launches |
|---|---|---|
| Today | about 280k before the image (raster group 154k + `main` 122k), plus the running title job, plus the general kernel alongside | new keys keep missing the cache |
| P1 | about 122k (`main` alone first) | same |
| P3 | same | **cache hit: seconds** |
| P4 + P5 + P6 | about 30–35k before the image; per-key total about 95–140k (−65 to −75 %) | cache hit |
| P9 | a further −20 to −40 % on the traced families (photo/walk/trace, planets, wormhole) | cache hit |

Rough timing for a 4050 laptop at about 1 ms per line (an assumption: proxy-measured and calibrated in P0, never field-measured): today **5–8 min** → after P1 about 2 min → after P4–P6 about **30–40 s** cold, a few seconds warm.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Far ground beyond the raster ring loses visible detail | A/B at 3 / 10 / 50 km and at the ring edge; keep the coarse march and `earthLook`; option of extending the rings (P4.2) |
| Register pressure / runtime changes (Apple, U9/U10 lessons) | Measure per pass with `perf-ab`; keep `discs` separate if the merge loses |
| `shade` leftovers (tree silhouettes against the sky) | Option (a) or (b) in P6 chosen on captures; marker so `main` covers them meanwhile |
| Walking now needs an on-demand full compile | Pre-warm when landing/stopping; a loading pill; later consider raster on foot |
| Key layout collisions (packed bits) | Review in P7; structured profile if needed; unit tests on key ↔ constants |
| DXC dead-code behaviour differs from the estimate | The P0 proxy runs the real Tint + DXC; every shader phase's exit is measured with it |
| No Windows measurements: the driver step and the integrated GPU are unknown | Calibrate the proxy against the recorded 5700 XT / 5070 Ti figures; show estimates as estimates; keep the in-game Windows GPU tip (P2), which needs no data; check in the field when possible |
| The proxy's Tint/DXC differ from the player's Chrome | Pin Tint to Chrome stable's Dawn branch; update it at each Chrome release; relative before/after comparisons are robust to version differences |
| Every `trace.wgsl` change invalidates players' caches | Batch shader changes per release; note it in DEPLOY.md |
| Second compile slot raises memory/CPU pressure on weak machines | Limit to the camera key's urgent `main`; off when `guessTier` ≤ 1 or measured pace is slow |
| Photo/offline/trace option regress | They keep the full family; their e2e and captures in each phase |

## 7. Rollback / cleanup

- Each phase behind a renderer flag (`renderer.compileOrderV2`, `renderer.stableProfiles`, `renderer.leanMain`, `renderer.coarseProbe`, `renderer.shadeOptional`, `renderer.nearKind`, `renderer.generalOnDemand`), toggled by `__bh` for A/B testing. Default on only after its exit criteria pass; removed (old path deleted) one release later.
- One commit or PR per phase; revert per phase.
- Delete `/tmp/wa` once the analyzer is in `scripts/`.

## 8. Order and first deliverable

P0 → P1 → P1b → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9 → P10. P2 can run in parallel with P1; P9 can start any time after P0.

**First deliverable:** P0 + P1 (analyzer, Mac baselines, the D3D12 proxy, queue fixes). The queue fixes are a small TypeScript-only change that should roughly halve the cold Earth launch, and P0 gives the Windows-like measurements that the later shader phases depend on, without needing a Windows machine.
