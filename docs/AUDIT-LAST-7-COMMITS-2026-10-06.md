# Audit — the last 7 commits (`c963fe7` → `a452eb7`)

**Date:** 2026-10-06 · **Auditor:** independent code review (deep analysis, no modifications) · **Rev. 2** (experimental verification pass added)
**Scope:** 7 commits, 74 files, **+4 092 / −578** lines (src, shaders, tests, docs, assets, scripts)
**Verification performed during the audit:**

- `bun test` on a clean worktree at `a452eb7`: **386 pass, 153 skip, 0 fail** (35 085 expect calls, 31.6 s). The 153 skips are the e2e suite (`E2E=1` required a browser — *not* re-run in this audit).
- `bun run check`: clean — Biome, TypeScript, and **9/9 WGSL shaders compile under Metal**.
- Every diff of the 7 commits read line by line, including the WGSL changes.
- **Rev. 2 additions (throwaway Bun scripts against the worktree, since removed):**
  - `minimumOrbitHeight` vs an exhaustive reference search: 2 520 cases (ecc ≤ 0.97, i ∈ [10°, 120°] incl. retrograde, ω swept 30°), then 2 520 *grazing* cases (rp = 50 km, ecc = 0.99, i ∈ {63.4°, 80°, 89°, 89.9°, 90°, 95°, 116.6°}, ω swept **1°**) — **worst optimistic error: 14 µm**. The 64-sample grid + ternary refinement is *not* a grid-miss risk; the height function has at most four minima per orbit and the refinement brackets all of them.
  - `orbitClearsHeight` fuzz: 3 000 random orbits × random thresholds — **zero optimistic false-positives**.
  - Every direct `s.timeSpeed` writer audited against the commit-7 capture heuristic (see §2.7): no safety violation found; two benign capture vectors identified.
  - `P.hd.w` traced to `hd.color.width` — the mip-LOD fix receives the true 8K width on both the JPEG and the compressed path.

**Grade changes in Rev. 2:** commit 6 raised 9.0 → **9.5** (the two sampling heuristics were experimentally verified, not just plausible); commit 7 stays 8.5 but the time-warp heuristic is re-scoped from Medium to Low with evidence. **Series grade: 8.8 / 10.**

---

## 1. The series at a glance

| # | Commit | Subject | +/− | Theme | Grade |
|---|--------|---------|-----|-------|-------|
| 1 | `c963fe7` | Fix WebGPU startup, GPU quality policy and Earth prefetch | +1886/−253 | Startup robustness | **8.5 / 10** |
| 2 | `dd5b059` | Add graphics failure diagnostics and bounded WebGPU startup | +478/−24 | Observability | **8.0 / 10** |
| 3 | `c78718c` | Fix IAU periodic rotation rates + derivative regression tests | +102/−39 | Physics correctness | **9.5 / 10** |
| 4 | `9538f33` | Jupiter Cassini/Juno 8K maps, HD mip filtering | +289/−12 | Assets & rendering | **8.5 / 10** |
| 5 | `699a27c` | Fix atmospheric eclipse coordinates on WGS84 | +111/−7 | Shader correctness | **9.0 / 10** |
| 6 | `8b6562c` | Fix WGS84 ellipsoid consumers across rendering and flight | +1018/−200 | Geometry consistency | **9.5 / 10** (Rev. 2 ↑) |
| 7 | `a452eb7` | Independent hub and user warp control with guidance limits | +212/−47 | Flight-control UX | **8.5 / 10** |

**Series grade: 8.8 / 10** — a coherent, well-documented, test-backed evening of work (20:45 → 01:55), each commit self-contained with its own docs and tests. The deductions are for one high-blast-radius robustness choice (commit 2), and process hygiene (root-level working files, a 32 MB binary asset). The one remaining Medium technical finding (orbit-clearance sampling) was *experimentally refuted* in Rev. 2 — see §2.6.

---

## 2. Per-commit analysis

### 2.1 `c963fe7` — Fix WebGPU startup, GPU quality policy and Earth prefetch (8.5/10)

**What it does.** Three interlocking fixes: (a) the 8-bit export pipeline compiles on demand via a new `AsyncResource` abstraction instead of gating first image; (b) quality ceilings (steps/eps/SPP/noise) move from `Renderer` statics into a pure, tested `quality-policy.ts` with an explicit automatic-mode contract; (c) Earth map prefetch warms the HTTP cache before the first image, and the tier cache gets a schema version, an adapter identity check and a 7-day expiry.

**Strengths.**

- `AsyncResource` / `CompileQueue` (`src/util/async-resource.ts`) are exactly right for the problem: honest about non-cancellable WebGPU compiles ("its late result is deliberately ignored"), no unhandled rejections, obsolete queued work skipped *before* it starts via a `current()` liveness predicate. The comment quality is exemplary.
- `Renderer.create()` now races against a 180 s timeout and **destroys the device** if the create path already returned — no leaked GPU device on abandonment. The `onDevice` callback throwing `"Graphics startup already terminated"` is handled correctly by `Promise.race` (late rejections of the racing branch are attached, so no unhandled rejection).
- `rememberedLevel` validates *everything* (schema version, adapter match, integer range, finite timestamp, no future timestamps, max age) and refuses blank adapter ids before persisting. This kills an entire class of corrupted-`localStorage` startup failures.
- `effectiveQuality` preserves manual choices and a deliberately-disabled noise threshold (`0` stays `0`) — the "ceilings and floors, never a raised quality the player did not ask for" contract survived the refactor.
- `prefetchEarthMaps` retains only completion promises, evicts failures so on-demand loading can retry, and consumes the body fully (`arrayBuffer()`) to populate the SW/HTTP cache without decoding into VRAM.
- Tests: `async-resource.test.ts` (124 lines, incl. timeout + late-result-ignored), `quality-policy.test.ts`, `tier.test.ts`, `earth-prefetch.test.ts`, plus a 219-line e2e `gpu-startup.e2e.test.ts`.

**Issues.**

| Sev. | Issue |
|------|-------|
| Low | **`prefetched()` ownership transfer is a foot-gun.** It now *deletes* the map entry on read ("do not retain megabytes after loadSky"). A second consumer of the same URL silently degrades to a full network fetch. Correct today (each URL is consumed once), but nothing documents or enforces the one-shot contract. |
| Low | **`lutQCompile` start condition can dead-path.** It starts on frame completion only `if (this.lutWanted && this.qualityCompile.state === "ready")`. If the quality kernel finishes *after* a frame where `lutWanted` was true, nothing re-checks; `lutQ` then waits for a still view to trigger it. Cosmetic (the LUT still works), but a latent ordering gap. |
| Low | **Naming: `earthMapQuality(..., offline, ...)` receives `t !== this.live`** — "not the live view", not "offline rendering". The comment says exports keep their choice; the parameter name says something else. Confusing at the call site. |
| Info | Prefetch downloads ~10–30 MB of Earth med-maps on *every* scene, including Kerr-only scenes with no Earth. Deliberate (comment says so) and `cache: "force-cache"` mitigates repeats, but on metered connections it is a real bandwidth cost with no setting to opt out. |
| Info | `fetch(url, { priority: "low" })` — `priority` in `RequestInit` is recent; harmless where unsupported, worth a graceful comment. |

---

### 2.2 `dd5b059` — Graphics failure diagnostics and bounded WebGPU startup (8.0/10)

**What it does.** Adds `GpuDiagnostics` (bounded local event log persisted to `localStorage`, downloadable JSON), stage markers through `Renderer.createGraphics`, a 180 s "no first image" watchdog that counts only visible time, and adapter/limits context capture.

**Strengths.**

- Every bound is real: 32 events, 1 024-char messages/stacks, 100 KB storage guard, all persistence wrapped in try/catch ("never break startup for diagnostics"). Private-browsing and corrupt-storage paths handled.
- The watchdog is smart: it accumulates **visible** time only, so a backgrounded tab is not declared dead, and it stops itself on first frame or fatal.
- `Renderer.create`'s abandonment path (device destroyed on timeout), `device.lost` raced *before* runtime callbacks exist, and `uncapturederror` capture during canvas setup close the "silent black image / endless splash" failure class end to end.
- The device-lost handler now reports honestly whether the autosave succeeded instead of claiming it did — a small honesty fix with real UX value.
- 89-line e2e + 57-line unit tests, including "a stalled core compilation terminates with a diagnostic".

**Issues.**

| Sev. | Issue |
|------|-------|
| **High** | **The global `error` / `unhandledrejection` listeners are fatal for the whole app lifetime — and the loop terminates outright.** `reportFatal` sets `startupFailed = true`; the render loop is `if (startupFailed) return;` *before* `requestAnimationFrame(loop)`, so the rAF chain ends permanently, not just pauses. The listeners are registered at the top of `main()` and **never removed** after `gpuDiagnostics.ready()`. Consequence: *any* benign post-startup error permanently kills the app behind an error screen. Real-world benign sources exist: the classic `ResizeObserver loop completed with undelivered notifications` window error, and errors from extension-injected `<script>` elements (these *do* reach the page's `error` event in Chrome, unlike content-script-internal errors). This was correct *before* the first frame (the intended target of the change); leaving it installed afterwards is a robustness regression. Recommendation: after `ready()`, downgrade to recording without `fatal`, or remove the listeners at `firstFrame`. Counter-argument acknowledged: freezing on unknown corruption protects the save; but the app autosaves, so continue-and-log is strictly safer for the user's progress. |
| Low | `persist()` re-serialises the full snapshot (including the `runtime()` closure call) on **every** `record`/`enter`/`setContext`. Bounded and startup-only, but chatty; a dirty-flag would do. |
| Low | `record()` derives `name` via `detail?.constructor.name` — minified production builds will report unhelpful names like `t` or `n`. The message slice still helps; consider `error.name ?? "Error"` first. |
| Info | `downloadGpuDiagnostic` reaches into `document` from a module that is otherwise storage-injectable — the class's testability is undercut by the singleton export. Acceptable for a one-button escape hatch. |

---

### 2.3 `c78718c` — IAU periodic rotation rates (9.5/10)

**What it does.** Removes the spurious `× (180/π)` in `iauRate`'s libration accumulation (the `npm` amplitudes are already in degrees; only the phase argument's derivative needs °/century → rad/day), and adds derivative regression tests.

**Strengths.**

- The fix is one line and provably right: the doc now shows the buggy/corrected ratio is algebraically **180/π = 57.2957795…** for every nonzero periodic term — an analytic identity, not a numerology fit.
- The regression tests are the best in the series: 4 019 epochs per body over ±11 years around J2000 (negative epochs included), a **fourth-order stencil** specifically because the 60 s second-order difference truncates Phobos' fast librations by ~4.8×10⁻⁴ °/day — the author *found and documented* the limits of their own test method mid-commit. Per-term tolerance budgets (1e-6 / 1e-5 °/day) match the physics.
- The doc rewrite is unusually honest: it corrects a **unit bug in its own previously proposed test** (`86400000 * 2` s per step = 2000 days, not 2), re-scopes which consumers were actually affected (`entry-env` was mischaracterised before; `spinRate` uses the memoized mean, so it was never affected), and adds NAIF PCK/pck00010 references — including Mercury's actual five periodic terms with amplitudes.
- A closed-loop check in scene units (`spinVector` projection vs numerical W derivative through `tdbOf(utcOf(t))`) ties the fix to the consumer, not just to the function.

**Issues.**

| Sev. | Issue |
|------|-------|
| Info | The tests check *consistency of the closed form with the W model*, as the doc itself admits — not against an independent observational ephemeris. The doc says this plainly; noting it here so nobody over-reads the green suite. |
| Info | The doc's mention of the pole's separate RA/declination derivatives being out of scope for `spinVector` is a known modelling approximation left open — fair, but it is a *documented* residual, not a fixed bug. |

A model commit: fix, falsification-proof tests, self-correcting documentation.

---

### 2.4 `9538f33` — Jupiter close-ups: Cassini/Juno 8K + HD mip filtering (8.5/10)

**What it does.** Replaces Jupiter's 2K map with an 8K UASTC KTX2 built from the Cassini/Juno composite (`scripts/build-jupiter.ts`, with provenance metadata: source URL + source sha256 + radiometrically weighted linear mean), uploaded **directly as prebuilt mips** (no full-size RGBA staging, no runtime BC encoder), plus the actual rendering fix: HD map mip selection.

**Strengths.**

- The mip fix is the real bug repair and it is subtle and correct: previously `mapLodV` was clamped to [0, 11] *before* adding `log2(width/2048)`, forcing any 8K map to level ≥ 1.55 at sub-texel footprints — throwing away the very detail the asset exists for. Now `setMapLod` keeps the raw footprint, `mapLod()` clamps only for the 2K consumers, and `hdMapLod(width)` applies the texture-width offset with a floor at 0. Applied consistently to colour (`P.hd.w`) and relief (`textureDimensions(hdRelief).x`).
- `jupiterCompressed` validates the KTX2 against its own metadata (dimensions *and* mip-chain length) before touching VRAM, nests validation + out-of-memory error scopes properly (`popErrorScope` in `finally`, awaited after), destroys both textures on any failure, and falls back to the 4K JPEG with a diagnostic event. Failure handling is textbook.
- `hdColorFormat` fix matters beyond Jupiter: the old code returned `"rgba8unorm-srgb"` for **any** non-BC7 texture — an *invalid view format* for ASTC devices (`astc-4x4-unorm` texture viewed as `rgba8unorm-srgb` is not a compatible srgb variant). The new `endsWith("-srgb")` short-circuit makes BC7 and ASTC both work. This was a latent crash/black-texture bug on ASTC-only hardware (some mobile GPUs), fixed in passing.
- `bitmap()` now checks `response.ok` — silent-404-to-blank-bitmap class removed.
- Reproducible pipeline: pinned source, atomic `.part` → rename, sRGB-linear mean computed with cosine latitude weighting (not naive averaging), `means.json` kept in sync.

**Issues.**

| Sev. | Issue |
|------|-------|
| Medium | **32 MB binary (`assets/planets-hd/jupiter-color.ktx2`) committed to the repo.** It is an app asset, so shipping it is the point — but it lives in git history forever; every clone pays it, and a future re-encode doubles it. Consider LFS or the existing build-from-source path (the script already reproduces it deterministically, with a sha256 pin). Repo currently grows ~35 MB in this commit alone. |
| Low | `Image.MAX_IMAGE_PIXELS = 110000000` sits only ~6% above the source's 103.68 M pixels — one上游 re-export slightly larger and Pillow throws; brittle but cheap to bump. |
| Low | Hard-coded S3 source URL will rot; the script fails loudly (good) but has no alternative mirror or `--source` flag. |
| Info | `build-jupiter.ts` shells out to `basisu` and Python/Pillow without version pinning — reproducibility depends on local tool state; the sha256 of the *source* is recorded, not of the *output*. |

---

### 2.5 `699a27c` — Atmospheric eclipse coordinates on the WGS84 ellipsoid (9.0/10)

**What it does.** The atmospheric march runs in squashed (ellipsoid→unit-sphere) axes; the eclipse shadow computation compared squashed-space positions and directions against physical Moon/Sun geometry. Adds `AIR.ab` to `AirSpec`, an `eclipsePhysical` un-squash (`v.z / AIR.ab`), and routes `sunSeen`/`skySeen` (including the four 200 km penumbra samples and the re-normalised `Ls`) through physical axes.

**Strengths.**

- Minimal, surgical, and the reasoning is stated at the point of use: "The atmospheric march uses squashed axes; eclipse positions and angular radii use physical axes."
- Direction handling is right: `normalize(eclipsePhysical(Ls))` before the disk-overlap math, and `skySeen` computes the orthonormal frame `e1/e2` from the *physical* light direction so the 200 km offsets are 200 physical km, not 200 squashed (which would be ~200·(1−f)·… wrong at the pole).
- The e2e test (`eclipse-atmosphere.e2e.test.ts`, 94 lines) exercises a real total eclipse scene rather than a synthetic one.

**Issues.**

| Sev. | Issue |
|------|-------|
| Low | `eclipsePhysical` un-squashes positions *and* directions with the same transform, then re-normalises — correct for directions only after normalisation; the code does this consistently, but a `physicalDirection` helper (as commit 6 later adds, `airPhysicalDirection`) would have made the intent impossible to get wrong. Commit 6 in fact generalises this properly — this commit is the correct first slice of that. |
| Info | The double normalisation (`sunSeen` → `sunSeenPhysical(normalize(...))`) is redundant but harmless. |

---

### 2.6 `8b6562c` — WGS84 ellipsoid consumers across rendering and flight (9.5/10, Rev. 2 ↑)

**What it does.** The largest commit: propagates the ellipsoid consistently into every consumer that still assumed a sphere — geodetic apsis heights and orbit classification, geodetic vertical speed, launch/entry/landing guidance (`figureUp`, `env.normal`), runway grading in physical metres (CPU *and* GPU), sea/wind frames, night-side city-light altitude, sunlight metering, air-march geometry (height model, step scale, normals, moonlight), and the ISS/dawn-dusk eclipse share via a new exact `figureSourceElevation`/`figureDiskShare` pair mirrored in WGSL as `figureSunShare`.

**Strengths.**

- **The math is verified, not just plausible.** Highlights checked during the audit:
  - `apsisHeights` / `minimumOrbitHeight` exploit the fact that the position's z-component in the equatorial frame is `r·sin i·sin(ω+ν)` — *independent of Ω* — so the geodetic height needs only the 2D reduced problem `[√(r²−z²), 0, z]`. Correct and elegant.
  - `orbitClearsHeight`'s early exits are **provably safe** *and* (Rev. 2) **fuzz-verified**: `h ≥ |p − p_s| ≥ r − a` by the triangle inequality (the ellipsoid's max radius is `a`), so `rp − R ≥ threshold ⇒ cleared`; the `rp − R(1−f) < threshold ⇒ not cleared` exit reduces trivially to `rp − R < threshold − R·f < threshold`. 3 000 random orbits × random thresholds produced **zero optimistic false-positives**.
  - `figureSourceElevation` derives the limb angle exactly from the tangent cone intersected with the observer/source plane (quadratic in the squashed frame), with the angular-normal tilt correction — and `tests/e2e/ellipsoid.e2e.test.ts` executes the **WGSL `figureSunShare` and `runwayGrade` on the actual GPU** and compares against the TypeScript mirrors. GPU/CPU parity is *tested*, which is far above the norm for shader code.
  - The air march changes are dimensionally coherent: `stepScale = airRayScale(rd)` restores physical path lengths through squashed space, `airHeight` reuses the ground's height model (`earthSq`-style projection), `sunThrough` gets the *physical* normal rather than the raw squashed position direction — scattering tables and eclipse share now agree with the ground renderer.
- Guidance changes are behavioural fixes with teeth: `figureUp` (geodetic) replaces radial `up` in the horizon frame, launch assist, entry interface and touchdown attitude; `vVert` becomes a true geodetic vertical speed; entry `range` uses geodetic normals on both ends.
- `classify` keeps full backward compatibility for non-"ours" callers via `o.clearOfAir ?? el.rp >= top` and `o.altitude ?? el.r − o.R`.
- Test investment matches the risk: 157-line consumer unit tests, 183-line GPU e2e including WGSL execution, runway-parity reworked instead of deleted.

**Issues.**

| Sev. | Issue |
|------|-------|
| ~~Medium~~ → **Verified safe (Rev. 2)** | ~~**`minimumOrbitHeight` is a sampling heuristic.**~~ **Experimentally refuted.** An exhaustive comparison against a 4 096-sample + golden-section reference over 5 040 cases — including 2 520 grazing orbits at rp = 50 km, ecc = 0.99, near-polar and retrograde inclinations with ω swept at 1° — produced a worst optimistic error of **14 µm**. The geodetic height function has at most four minima per orbit (from `r(ν)` and `sin(ω+ν)`), the 64-point grid brackets all of them, and the 24-step ternary refinement converges. No action required; the concern is withdrawn. |
| Low | `radiusAtHeight` runs a fixed 3 Newton iterations with **no convergence check**, and recomputes `cartToGeodetic` twice per iteration. Fine for WGS84's `f = 1/298.26` (converges in 1–2), silently wrong-by-unreported for exotic flattenings. A `|Δh| < ε` assert or one more iteration would future-proof it. |
| Low | `patchGeodetic(near, WGS84_F)` inside `seaParams` is safe *only* because the caller guards `near.index !== earthK`. The function itself applies WGS84 flattening unconditionally — hidden Earth-only coupling; a `flattening` parameter or an assert would prevent a future Titan-sea reuse from silently using Earth's flattening. |
| Low | `earthSunlight` dropped its `this.earthMaps.tier` gate (intended: "physical geometry is independent of material availability") — but `meterInAir = earthIsNear` also lost a tier condition; the meter now applies atmospheric attenuation on scenes where the air is rendered but no Earth maps ever loaded. Consistent, but it *changes tonemapping* in placeholder/no-map scenes; the e2e screenshots should be eyeballed for a global brightness shift there. |
| Info | `figureUp` calls `cartToGeodetic` per invocation and is now used in several per-frame guidance paths (`horizonAxes`, `sfFrame`, `standOn`, `ourSurfaceWant`). Cost is trivial (µs), but it is redundant work that a per-frame memo could fold if the hot path ever grows. |
| Info | `hasAir`/`isEarth` no longer require `earthOn()` — deliberate (air is physical, not a function of map availability), but it means air *can* now render in scene states where it previously did not; no test in the unit suite pins the no-maps air behaviour (the e2e does partially). |

---

### 2.7 `a452eb7` — Independent hub and user warp control (8.5/10)

**What it does.** Introduces `hubWarpWant` / `hubWarpLimit` on the controller: autopilot ("hub") warp ceilings combine per frame (the tightest wins, none may relax an earlier one), the user's requested warp is retained separately and clamped to the ceiling, with HUD toggle (`WARP: HUB/YOU`), toast/i18n, transport wiring, and both unit and e2e tests (including an assist-on *and* assist-off pass).

**Strengths.**

- Rev. 2 verification: the capture heuristic's six writers were all audited (see Issues); the safety invariant `timeSpeed ≤ hubWarpLimit` holds in every path because `setHubWarp` is the sole writer of the clamped value and always clamps. The `restoreWarp` mis-capture (plan.ts:1033 does not touch `warpSet`) turns out to be *semantically correct* — the restored `userWarp` genuinely is the user's wish.
- The state model is right: `setHubWarp(ceiling)` = `{limit = min(limit ?? ∞, ceiling); wish = autoWarp ? null : (wish ?? current); warpWant = null; timeSpeed = min(autoWarp ? ceiling : wish, limit)}` — monotone limit combination across multiple simultaneous safety constraints in a frame is exactly the invariant a flight game needs, and `warpWant = null` explicitly stops the rails from restoring a wish above the hub's limit.
- The e2e test is genuinely adversarial: it *fabricates a short countdown* (`tBurn = now + 20`) to force guidance to override a user request mid-flight, asserts `hubWarpWant` retained the higher request, then lengthens the countdown and asserts the retained request is restored. Both assisted and AUTO paths. This is how you test a state machine with a hostile clock.
- Unit tests cover the combining/min semantics, the manual slow-motion retention (0.25 stays 0.25 under a 100× ceiling), and the node-warp manual/held transition.
- `glideAlpha`'s manual branch correctly *clamps down* (`Math.min(timeSpeed, 1/Msec)`) instead of snapping, respecting user agency below the ceiling.
- i18n, aria-pressed, testids and the `hubSig` recomputation trigger (`+ this.s.autoWarp`) are all wired — UI and state agree.

**Issues.**

| Sev. | Issue |
|------|-------|
| Low (re-scoped from Medium, Rev. 2) | **User-change detection is a heuristic — verified benign, not fragile in the way first feared.** `flyShip` captures a user change as `!s.autoWarp && s.timeSpeed !== this.warpSet` (piloting.ts:701). All six direct writers were audited in Rev. 2: `plan.ts:128` and `lowthrust.ts:559` update `warpSet` in the same statement (no misfire); `plan.ts:1033` (`restoreWarp`) and `tools.ts:390` restore or set the *user's own* warp, so capturing them as the user's wish is semantically correct; `mission.ts:73` runs outside autopilot. The one genuine vector is `renderdialog.ts:386`: recording a video at a fixed rate while an autopilot is engaged captures the *recording rate* as the user's wish. Critically, **the safety invariant holds regardless**: `setHubWarp` always clamps `timeSpeed ≤ hubWarpLimit`, so no misfire can ever raise the warp above a guidance ceiling — the worst outcome is a warp-state surprise after the ceiling lifts (warp jumps to the recording rate). An input-path flag would still be cleaner, but this is cosmetic, not a control-integrity risk. |
| Low | **`dockWant` leaves `D.warp` vestigial.** It still maintains the `D.warp` memory (`if (s.timeSpeed !== D.set ...) D.warp = s.timeSpeed`) whose only purpose — manual-warp recall below cap — is now subsumed by `hubWarpWant`. Dead state with a live writer is a future-confusion magnet. |
| Low | **`glideAlpha`'s manual clamp never restores.** Below 1 500 m AGL the warp is clamped to 1/Msec but `hubWarpWant` is untouched (possibly `null`); after climbing out, nothing re-raises the warp — the user must re-request. Same as pre-commit behaviour, so not a regression, but the new machinery makes the asymmetry (wish retained in the entry path, not in the glide path) visible. |
| Low (new, Rev. 2) | **`piloting.ts:787` assigns `hubWarpLimit` directly** (`this.hubWarpLimit = AIR_WARP / Msec`) instead of min-combining, breaking the pattern every other ceiling writer follows. It is safe *only* because it runs before `entryStep`/`burnsStep` in the same frame (the first write after the per-frame reset to `null`). A future reordering would let the ×4 air ceiling silently *relax* a tighter guidance ceiling — violating the commit's own "tightest wins" invariant. One-line hardening: `this.hubWarpLimit = Math.min(this.hubWarpLimit ?? Infinity, AIR_WARP / Msec)`. |
| Low | **`toggleAutoWarp` in `main.ts` reaches into controller internals** (`hubWarpWant`, `nodeWarpWant`, and conditionally re-invokes `setHubWarp`) while `flyShip` also manages the same fields each frame. Two owners of one state machine; works because main only acts on user events, but the boundary should be a controller method (e.g. `setWarpAuthority(auto)`) rather than field surgery from the UI layer. |
| Info | `hubWarpLimit` is reset per frame in `flyShip` and re-established by guidance — a `setWarp` keypress processed between frames caps against the *previous* frame's ceiling. Immaterial at 60 fps; noted for completeness. |
| Info (Rev. 2) | Call-order trace confirmed for `flyShip`: capture (line ~700) → `rails()` (~762, may restore `warpWant`, updates `warpSet`) → thick-air clamp + line 787 (~780) → `entryStep`/`burnsStep` (~821, `setHubWarp` min-combines). The `warpWant = null` inside `setHubWarp` therefore takes effect from the *next* frame's rails pass — coherent, no double-application. |

---

## 3. Cross-cutting findings

1. **Robustness policy is inconsistent about post-startup fatality (highest-value fix).** Commit 2's global error listeners are fatal forever *and terminate the rAF chain*; meanwhile the rest of the series goes to great lengths to make failures *non-fatal* (optional pipelines, KTX2 fallbacks, prefetch retries). The single change with the best cost/benefit ratio in this audit: after `gpuDiagnostics.ready()`, make `reportFatal` record-not-kill, and rely on the already-existing device-lost / submission-failure paths for real fatal conditions.

2. ~~**The heuristics are all reasonable, none are instrumented.**~~ **Rev. 2 update:** two of the three heuristics have now been instrumented *by this audit* — `minimumOrbitHeight` (worst error 14 µm over 5 040 adversarial cases) and `orbitClearsHeight` (0 false-positives in 3 000 fuzz cases) are proven, and the time-warp heuristic is re-scoped to cosmetic. `radiusAtHeight`'s fixed 3 Newton iterations remain un-instrumented but are bounded by WGS84's f ≈ 1/298 (converges in 1–2 iterations by construction).

3. **Test discipline is unusually strong** (GPU-executed WGSL parity, adversarial e2e with manipulated countdowns, honest negative-space testing in the IAU suite), **but 153 e2e tests are skipped in ordinary local runs** — CI must run `bun run e2e` (a browser) for the suite that actually covers the shader changes of commits 4–6. Nothing in this audit could re-verify the e2e layer.

4. **Repo hygiene:** `audit kimi modif.md` (421 lines, commit 1) is a working file committed at the repo root next to real `docs/`; the Jupiter commit adds ~35 MB of binaries (two KTX2 + two JPEGs + a PNG) without LFS. Both are cheap to fix and compound over time.

5. **Commit sequencing is honest.** The eclipse slice (5) lands before the broad consumer fix (6), which generalises it (`AIR.ab`, `airPhysical*`); the diagnostics (2) precede the asset work (4) whose failure paths use them. No commit depends on a later one; each is bisectable. The two-paragraph-per-decision comment style (`src/quality-policy.ts`, `ellipsoid.ts`) matches what the code actually does — spot-checked, no comment/code drift found.

---

## 4. Verdict

| Dimension | Assessment |
|-----------|------------|
| Correctness | Strong. The three physics/rendering fixes (IAU, eclipse, WGS84) are each backed by analytic reasoning plus numerical/GPU parity tests. No correctness bug found in the fixes themselves; the orbit-clearance sampling heuristic was experimentally refuted as a risk (Rev. 2). |
| Robustness | Good, with one exception: the never-removed fatal global error listeners (commit 2) are a genuine post-startup stability risk — and they terminate the rAF chain outright (Rev. 2 confirmation). |
| Tests | Excellent unit/e2e layering; e2e skipped-by-default locally is the main blind spot. |
| Performance | Net positive (on-demand export compile, prefetch while compiling, direct mip upload). No regression identified; the added per-frame geodetic math is negligible. |
| Maintainability | High for the new modules; medium for `hubWarp` (field surgery from `main.ts`, vestigial `D.warp`) and `minimumOrbitHeight`. |
| Process/hygiene | Good sequencing, good docs; dinged for root-level working file and 35 MB of committed binaries. |

**Overall: 8.8 / 10.** Ship-worthy as committed. Priority follow-ups, in order (Rev. 2 re-ranked after experimental verification):

1. (High) Demote global `error`/`unhandledrejection` handling to non-fatal after the first frame — `src/main.ts`. *The only High finding, and the only one that can hurt a user with working hardware.*
2. (Medium) Move the Jupiter KTX2 (and future HD packs) to LFS or build-on-release; relocate `audit kimi modif.md` into `docs/` or delete it.
3. (Low) One-line min-combine at `src/controller/piloting.ts:787` to make the "tightest wins" invariant order-independent.
4. ~~(Medium) Harden `minimumOrbitHeight` sampling~~ — **withdrawn in Rev. 2**: experimentally accurate to 14 µm across 5 040 adversarial orbits.
5. ~~(Medium) Replace the `timeSpeed !== warpSet` user-warp heuristic with an input-path flag~~ — **re-scoped to cosmetic in Rev. 2**: all six writers audited; the safety invariant holds; only the `renderdialog` fixed-rate recording produces a (harmless) surprise.
6. (Low) The cosmetic items listed per commit (dead `D.warp`, `offline` parameter name, `lutQCompile` start gap, `radiusAtHeight` convergence check, AsyncResource failed-state has no retry path — by design, reload re-arms).

---

## 5. Rev. 2 — what the experimental pass changed

| First-pass claim | Evidence gathered | Verdict |
|---|---|---|
| `minimumOrbitHeight` grid can miss narrow minima (Medium) | 5 040 adversarial cases vs exhaustive reference, incl. grazing ecc = 0.99 near-polar | **Refuted** — worst error 14 µm. Withdrawn. |
| `orbitClearsHeight` provable but untested in the band | 3 000 fuzzed orbits × thresholds | **Confirmed safe** — zero false-positives. |
| time-warp heuristic misfires could corrupt warp state (Medium) | All 6 direct `s.timeSpeed` writers audited line by line | **Re-scoped Low** — invariant `timeSpeed ≤ hubWarpLimit` is structurally guaranteed; worst case is a harmless warp jump after recording. |
| `hubWarpLimit` combining invariant sound | Call-order trace of `flyShip` + discovery of the direct assignment at line 787 | **Sound today, one ordering fragility** — new Low finding added. |
| `P.hd.w` correctness for the 8K Jupiter mip fix | Traced to `hd.color.width` (renderer.ts `set(62, …)`) | **Correct** on both JPEG and compressed paths; e2e asserts width/mips/format. |
| Suite health | `bun run check` + `bun test` | Biome, tsc, **9/9 WGSL under Metal**, 386 pass / 0 fail. |
