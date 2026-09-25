# Kerr black hole — WebGPU general-relativistic ray tracer

Real-time and progressively converged rendering of a rotating (Kerr) black hole, its accretion disk
and the lensed sky, written in TypeScript + WGSL, served with Bun.

```bash
bun install
bun run dev        # http://localhost:3000 (hot reload)
bun test           # physics unit tests (geodesics, ISCO, Novikov–Thorne, colorimetry)
bun run build      # static bundle in dist/
```

Requires a WebGPU browser (Chrome/Edge ≥ 113, Safari 26, Firefox 141+).

## Physics

| Effect | Model |
| --- | --- |
| Spacetime | Kerr metric, Boyer–Lindquist coordinates, spin −0.999 … 0.999 (a = 0 → Schwarzschild) |
| Light propagation | Null geodesics from the Hamiltonian `H = ½ g^{μν} p_μ p_ν`, conserved E and L_z, **RK4** with adaptive affine step (horizon, photon sphere and polar-axis aware), traced backwards from the camera |
| Observer | Local ZAMO tetrad + Lorentz boost: static, circular orbit, free fall from infinity ("rain" frame) or arbitrary boost → relativistic **aberration** and Doppler of the observer |
| Shadow, photon ring, Einstein ring, higher-order images | Emerge from the geodesics (validated against analytic critical impact parameters in `tests/`) |
| Frame dragging | Asymmetric (D-shaped) shadow, ergosphere negative-energy photons handled |
| Thin disk | Novikov–Thorne / Page–Thorne flux from the ISCO, gas on Keplerian orbits, T ∝ F^¼ |
| Disk transparency | Grey LTE slab of vertical optical depth τ(r) (turbulence opens gaps): each crossing adds `B(gT)(1 − e^{−τ/μ})` and transmits `e^{−τ/μ}`, front to back, so higher-order images and the sky show through |
| Frequency shift | Exact `g = ν_obs/ν_em = (p·u)_obs/(p·u)_em` (gravitational + Doppler + transverse). Since I_ν/ν³ is invariant, a blackbody at T is observed as a blackbody at g·T → **beaming** and colour shift are exact |
| Colour | Planck spectrum × CIE 1931 observer → linear sRGB LUT; or bolometric g⁴σT⁴ mode (Luminet 1979) |
| Limb darkening | Chandrasekhar electron-scattering law, emission angle measured in the fluid frame |
| Light travel time | Disk turbulence is evaluated at the retarded (emission) time along each ray |
| Relativistic jet | Parabolic (R ∝ z^0.6), limb-brightened synchrotron plasma along the spin axis with bulk Lorentz factor Γ measured by the local ZAMO; j_ν ∝ ν^{1/3}e^{−ν/ν_c} in the fluid frame, transferred with g³. Doppler boosting, de-boosted/reddened counter-jet and apparent superluminal knot motion (retarded time) emerge from the geodesics |
| Hot flow (optional) | Geometrically thick, optically thin emission, j_ν ∝ ρ ν^−α, invariant radiative transfer `dI = g^{3+α} j (−p·u) dλ` |
| Sky | Blackbody stars (flux-conserving PSF) + procedural Milky Way, gravitationally blue/redshifted for the observer; lat/long grid; or your own equirectangular image |

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
* Error-controlled RK4: step doubling estimates the local error, Richardson extrapolation makes each
  step 5th order; tolerance 1e-5 (high) to 1e-6 (reference). Compiled into a separate "quality"
  pipeline so the realtime kernel stays small.
* Gaussian pixel filter (importance-sampled), R2 low-discrepancy sequences, per-pixel adaptive
  sampling (stops when the relative standard error of the mean falls under a threshold).
* Offline renders freeze the scene and render any resolution up to the GPU's limits (4K, 8K, …) in
  bands of rows over as many frames as needed, with a per-frame GPU budget, pause/resume, progress
  and ETA, optional motion blur (shutter in M), and export to **PNG**, **16-bit PNG** and linear
  **OpenEXR** (half float, scene-referred).
* HDR post: energy-conserving multi-scale bloom (optical PSF), AgX / ACES tone mapping.

**Volumetric disk** (thickness H/R > 0): Gaussian vertical profile, LTE source B(g·T), grey absorption,
front-to-back transfer dI = T·S·(1 − e^{−dτ}) with dτ = κρ (−p·u) dλ; the tracer never steps over the
layer (distance-to-layer step limiter). **Spectral colours** of the jet (x^{1/3}e^{−x/gν_c}) and hot flow
(ν^{−α}) come from CIE 1931 integration of the actual spectra (I_λ ∝ I_ν ν²), not RGB samples.

Units: G = c = M = 1, distances in M (= GM/c²), time in M (= GM/c³).

## Controls

Drag: orbit (with momentum) · right-drag / shift-drag: look around · wheel / pinch: distance ·
alt+wheel: FOV · double-click: recentre view · arrows, +/−: move.
Keys: O cinematic orbit · D free-fall dive (exact E=1, L=Q=0 geodesic in proper time, seen from the
rain frame) · J jet · G shadow guide · I readouts · 1–4 quality · space time · P PNG · F fullscreen · H hide UI.

Settings that differ from the defaults are kept in the URL hash, so a view can be shared by link.

In dev, `window.__bh` exposes `settings`, `touch()`, `preset(name)` and `snapshot(name)`
(saves the converged frame to `snapshots/`).
