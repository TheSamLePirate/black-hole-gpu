# Kerr black hole — WebGPU general-relativistic ray tracer

Real-time and progressively converged rendering of a rotating (Kerr) black hole, its accretion disk
and the lensed sky, written in TypeScript + WGSL, served with Bun.

```bash
bun install
bun run dev        # http://localhost:3000 (hot reload)
bun test           # physics unit tests (geodesics, closed-form Kerr solutions, ISCO, colorimetry…)
bun run build      # static bundle in dist/
bun scripts/build-sky.ts <dir>   # rebuild assets/sky/ from the NASA map + HYG catalogue (see assets/sky/README.md)
```

Requires a WebGPU browser (Chrome/Edge ≥ 113, Safari 26, Firefox 141+).

## Physics

| Effect | Model |
| --- | --- |
| Spacetime | Kerr metric, Boyer–Lindquist coordinates, spin −0.999 … 0.999 (a = 0 → Schwarzschild) |
| Light propagation | Null geodesics from the Hamiltonian `H = ½ g^{μν} p_μ p_ν`, conserved E and L_z, traced backwards from the camera: **RK4** with an adaptive affine step (horizon, photon sphere and polar-axis aware) in realtime, error-controlled **Dormand–Prince 5(4)** (FSAL) in converged/offline passes; compensated (Kahan) state updates |
| Observer | Local ZAMO tetrad + Lorentz boost: static, circular orbit, free fall from infinity ("rain" frame) or arbitrary boost → relativistic **aberration** and Doppler of the observer |
| Shadow, photon ring, Einstein ring, higher-order images | Emerge from the geodesics (validated against analytic critical impact parameters in `tests/`) |
| Frame dragging | Asymmetric (D-shaped) shadow, ergosphere negative-energy photons handled |
| Thin disk | Novikov–Thorne / Page–Thorne flux from the ISCO, gas on Keplerian orbits, T ∝ F^¼ |
| Disk transparency | Grey LTE slab of vertical optical depth τ(r) (turbulence opens gaps): each crossing adds `B(gT)(1 − e^{−τ/μ})` and transmits `e^{−τ/μ}`, front to back, so higher-order images and the sky show through |
| Frequency shift | Exact `g = ν_obs/ν_em = (p·u)_obs/(p·u)_em` (gravitational + Doppler + transverse). Since I_ν/ν³ is invariant, a blackbody at T is observed as a blackbody at g·T → **beaming** and colour shift are exact |
| Colour | Planck spectrum × CIE 1931 observer → linear sRGB LUT; or bolometric g⁴σT⁴ mode (Luminet 1979) |
| Limb darkening | Chandrasekhar electron-scattering law, emission angle measured in the fluid frame |
| Light travel time | Disk turbulence, jet knots and the hot spot are evaluated at the retarded (emission) time along each ray |
| Disk turbulence | Gradient noise sheared by the Keplerian flow (flow-map advection), trailing logarithmic spiral arms, patches, clumps and ridged filaments |
| Returning radiation | Disk light bent back onto the disk (Cunningham 1976): one cosine-weighted secondary geodesic per disk hit, blackbody at g₁₂T₂ re-emitted with an albedo (quality passes) |
| Polarization | Walker–Penrose constant κ = (A − iB)(r − ia cos θ) carried along every geodesic and inverted at the camera: exact EVPA for any observer. Disk: Chandrasekhar scattering polarization; hot flow & jet: synchrotron E ⟂ B (toroidal/radial/vertical/spiral fields). EHT-style ticks, polarized-intensity view |
| Millimetre band | 86/230/345 GHz thermal synchrotron with self-absorption: dT_b/ds = α_ν(ν/g)(g·T_e − T_b) (Kirchhoff + I_ν/ν³ invariance), RIAF profiles; afmhot 230 GHz view, false colour, instrument beam (EHT 20 µas) |
| Hot spot | Gaussian blob on a Keplerian orbit (flare): Doppler flaring, lensed arcs, light echoes |
| Relativistic jet | Parabolic (R ∝ z^0.6), limb-brightened synchrotron plasma along the spin axis with bulk Lorentz factor Γ measured by the local ZAMO; j_ν ∝ ν^{1/3}e^{−ν/ν_c} in the fluid frame, transferred with g³. Doppler boosting, de-boosted/reddened counter-jet and apparent superluminal knot motion (retarded time) emerge from the geodesics |
| Hot flow (optional) | Geometrically thick, optically thin emission, j_ν ∝ ρ ν^−α, invariant radiative transfer `dI = g^{3+α} j (−p·u) dλ` |
| Interstellar's wormhole | The **Double Negative wormhole** of *Interstellar* (James, von Tunzelmann, Franklin & Thorne, Am. J. Phys. 83, 486, 2015): ds² = −dt² + dℓ² + r(ℓ)²dΩ², throat radius ρ, cylinder length 2a, lensing width W = 1.42953 M (film: 2a = 0.01ρ, W = 0.05ρ). Our universe (ℓ < 0, the real sky) on one side, the black hole's universe on the other, where the far mouth orbits the hole. Rays are followed in segments **Kerr → Dneg → Kerr** through a gluing sphere around the far mouth (each metric neglects the other's gravity there); both universes stay right-handed (no mirror image). The camera flies through the throat along spatial geodesics |
| Sky | **Real sky**: 119 614 Hipparcos/HYG stars as point sources (blackbody at their B−V temperature, seen at g·T) + the Gaia DR2 Milky Way of NASA's Deep Star Maps 2020, orientable in galactic coordinates. Or procedural stars + Milky Way, a lat/long grid, or your own panorama. Every lookup is filtered over the pixel's **lensed footprint** |

The black hole's universe seen through the wormhole shows a procedural **distant galaxy** (as in the
film, nearer its centre than the Sun is to ours: a broad bright band and bulge, H II / O III / reflection
nebulae, dust lanes, denser stars), pre-filtered over the lensed pixel footprint like the real sky.

Diagnostic views: redshift map, disk temperature, image order (equatorial crossings), integration cost.
**Kerr shadow guide**: the analytic critical curve (spherical photon orbits, Bardeen 1973) projected
through the observer's actual ZAMO tetrad and Lorentz boost — exact at any distance and velocity, and
tested against the integrator (`tests/shadow.test.ts`).
**Physical readouts** for any mass (M☉): r_g, horizon, ISCO period, radiative efficiency, Ω_H,
irreducible mass, Hawking temperature, Bekenstein–Hawking entropy, observer lapse/speed.
Frequency-shift toggles let you switch off Doppler, beaming, or all shifts ("Interstellar" rendering).

## Rendering

**Realtime** (camera or time changing)
* One ray per N×N tile at a rotating, farthest-point-ordered offset (auto N from GPU timing).
  With a still camera the tiles fill in over N² frames → full resolution, temporally accumulated
  (jittered, exponential blend) while the flow animates. Pixels that are stale for the current camera
  are reconstructed bilinearly from the current frame's samples.
* Rays leaving all emitting matter stop early; the remaining path uses the analytic weak-field
  deflection δ = (2M/b)(1 − √(r² − b²)/r) (error O(M²/r²), far below a pixel).

**Converged** (everything still) and **Offline render** (toolbar → Render)
* Error-controlled Dormand–Prince 5(4) with FSAL (6 evaluations per step, half the cost of the former
  RK4 step doubling at equal accuracy); tolerance 1e-5 (high) to 1e-6 (reference). Compiled into a
  separate "quality" pipeline so the realtime kernel stays small. Disk crossings: root of the cubic
  Hermite interpolant + one RK4 sub-step + Newton correction.
* **Ray footprints**: each 8×8 workgroup shares its escape directions, every ray solves for the
  Jacobian ∂(sky direction)/∂(pixel) from its best-conditioned neighbours; stars, the Milky Way and
  panoramas are pre-filtered over that anisotropic footprint (exact magnification, no sparkle near
  the critical curve).
* Gaussian pixel filter (importance-sampled), R2 low-discrepancy sequences, per-pixel adaptive
  sampling (stops when the relative standard error of the mean falls under a threshold).
* **Realtime max** (quality "RT max", key 5): aims at ~15 fps (60 ms of GPU per frame) instead of 30: finer
  realtime blocks (2×2 instead of 8×8 in the wormhole scene) and finer realtime steps. The automatic block
  size follows a GPU budget per frame using each block size's measured time (part of a frame is a fixed
  full-resolution cost). While time runs, samples older than 1.5 M are dropped and stale pixels rebuilt by
  normalized convolution, so the turning disk is not smeared.
* Offline renders freeze the scene and render any resolution up to the GPU's limits (4K, 8K, …) in
  bands of rows over as many frames as needed, with a per-frame GPU budget, pause/resume, progress
  and ETA, optional motion blur (shutter in M), and export to **PNG**, **16-bit PNG** and linear
  **OpenEXR** (half float, scene-referred). Render presets: **Video** (Full HD frames, 64 spp, 180° shutter)
  and **Mega photo** (8K, or the largest size the GPU holds; 1024 spp, Dormand–Prince 1e-6, 0.2 % noise).
* **Video export (MP4)**: the journey through the wormhole, the cinematic orbit or the current view with
  time running, rendered frame by frame offline (the flow turns, the star orbits, optional motion blur) and
  encoded in the browser with WebCodecs (H.264) into a fragmented MP4 written by `src/video.ts` (no
  dependency).
* HDR post: energy-conserving multi-scale bloom (optical PSF), AgX / ACES tone mapping, and a
  **variance-guided à-trous denoiser** (SVGF-style edge stopping on each pixel's Monte Carlo variance).
* **HDR / EDR output**: on high-dynamic-range screens the canvas is rgba16float with "extended" tone
  mapping, highlights roll off to a chosen peak (× SDR white) instead of being compressed.

**Volumetric disk** (thickness H/R > 0): Gaussian vertical profile, LTE source B(g·T), grey absorption,
front-to-back transfer dI = T·S·(1 − e^{−dτ}) with dτ = κρ (−p·u) dλ; the tracer never steps over the
layer (distance-to-layer step limiter). **Spectral colours** of the jet (x^{1/3}e^{−x/gν_c}) and hot flow
(ν^{−α}) come from CIE 1931 integration of the actual spectra (I_λ ∝ I_ν ν²), not RGB samples.

Units: G = c = M = 1, distances in M (= GM/c²), time in M (= GM/c³).

## Validation

* `tests/`: critical impact parameters (±0.001 M), null constraint, ISCO, Novikov–Thorne flux,
  colorimetry, the Bardeen shadow guide vs the integrator (static and moving observers), Dormand–Prince
  vs step doubling, EXR/PNG encoders.
* `tests/wormhole.test.ts`: the Dneg r(ℓ) against its integral form (Eq. 5a), W/M = 1.42953, null
  constraint, rays with b < ρ cross the throat and b > ρ turn back, time reversibility, step convergence
  (1e-5 rad), orientation of the gluing frames.
* `src/analytic.ts`: closed-form Kerr geodesics (Carlson elliptic integrals; Mino time of the n-th
  equatorial crossing, Gralla & Lupsasca 2020), tested against the float64 integrator to 1e-6.
* GPU probe (`probe` entry point of `trace.wgsl`, `Renderer.precisionProbe`, reference data from
  `scripts/precision-probe.ts`): the renderer's own disk-hit radii agree with the closed form to
  ~1e-6 M (median), ~1e-5 M for the n = 2 photon-ring images; float32 round-off (not the tolerance)
  limits the escape directions, ~1000× below the sky spread of 1/100 of a pixel.

Progress screenshots of each improvement step are in `docs/progress/`.

## Data

Real sky: NASA/Goddard Space Flight Center Scientific Visualization Studio, *Deep Star Maps 2020*
(Gaia DR2: ESA/Gaia/DPAC); HYG star database v4.4 (CC BY-SA 4.0). Details in `assets/sky/README.md`.

## Settings panel

A schema-driven panel (`src/ui/schema.ts` → `src/ui/panel.ts`): every parameter carries its unit,
range, linear/log scale, a physics explanation (hover the ⓘ), dependencies and what it affects
(re-trace, resolve only, resize or nothing).

* **Search** (`/`) across labels, descriptions and keywords — e.g. "transparency", "blazar", "doppler".
* **Tabs** Scene · Matter · Sky · Physics · Render; groups collapse, matter groups carry their on/off switch.
* **Log sliders** for wide ranges (distance, mass, optical depth, Γ, tolerance…) plus an editable value
  field: type `1e-5`, `6.5×10^9`, `36 M`; ↑/↓ nudge (⇧ ×10, ⌥ ×0.1); Enter / Esc.
* **Modified markers**: an orange dot per changed setting (click it or double-click the label to reset),
  per-group reset, "Reset everything".
* **Undo / redo** (⌘Z / ⇧⌘Z) of every panel edit; a whole slider drag is one step.
* **Scene presets**, **your own presets** (saved in the browser), **quality** Low → Ultra (shows
  "Custom" when edited by hand), **Advanced** toggle for expert integrator/sampling parameters.
* **Share link**, **export / import JSON**, keyboard-shortcut sheet. `S` shows/hides the panel; on small
  screens it becomes a bottom sheet.

## Controls

Drag: orbit (with momentum) · right-drag / shift-drag: turn the camera (yaw, pitch, no limit) · wheel / pinch: distance ·
alt+wheel: FOV · double-click: recentre view · arrows, +/−: move.
**Wormhole** (Scene → Interstellar wormhole, or the preset "Interstellar: wormhole to Gargantua"): the
orbit controls turn around the wormhole or the black hole (switching keeps the view); the wheel sets the
distance to the throat. **Free flight, six degrees of freedom** (keys by physical position: Z Q S D /
A E / W X on AZERTY = W A S D / Q E / Z X on QWERTY): forward/left/back/right, down/up, roll; ⇧ faster;
right-drag turns the camera about its own axes with no gimbal limit. Near the wormhole the camera
follows its geodesics, so it can cross the throat; it re-anchors to the nearest object and can go
anywhere outside the black hole's horizon. These keys are reserved for flight. **V** switches to
game-style flight: pointer locked, the mouse turns the camera, the wheel sets the speed, movements ease
in and out (inertia), Esc leaves.

**Gravity (B)**: while time runs, the camera becomes a massive body in free fall: a timelike Kerr
geodesic (`src/geodesic.ts`: Hamiltonian in Boyer–Lindquist coordinates, RK4 in proper time, advanced
by the scene's coordinate time so the camera, the flow and the star share one clock) released at rest
w.r.t. the local ZAMO; the flight keys fire thrusters (proper acceleration, setting "Thrust"). The view is
that of the moving observer (aberration, Doppler), its orientation is kept fixed on the stars (gyroscope),
and near the wormhole — whose metric has no gravity — it coasts along the Dneg geodesics. The predicted
free-fall path is drawn as a dashed line (straight lines of sight, not lensed; red end = horizon). Tests:
circular orbits keep their radius and Keplerian period, u·u = −1, and the proper time of a radial fall
matches the cycloid solution. **T** runs the
journey: line up with the mouth, cross the throat, emerge facing the black hole and settle into orbit (from
the black hole's universe: the way back home).

Keys: O cinematic orbit · C free-fall dive (exact E=1, L=Q=0 geodesic in proper time, seen from the
rain frame) · T wormhole journey · V game-style flight · B gravity · J jet · G shadow guide · I readouts · M settings · / search · ⌘Z undo · 1–5 quality ·
space time · P PNG · F fullscreen · H hide UI.

Settings that differ from the defaults are kept in the URL hash, so a view can be shared by link.

In dev, `window.__bh` exposes `settings`, `touch()`, `preset(name)`, `snapshot(name)` (saves the
converged frame to `snapshots/`) and `render(name, preset, patch, options)` (offline render saved to
`snapshots/`); `__bh.renderer.precisionProbe(...)` runs the GPU precision probe.
