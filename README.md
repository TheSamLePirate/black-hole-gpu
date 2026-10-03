# Kerr black hole — WebGPU general-relativistic ray tracer

**Live:** [the simulator](https://thesamlepirate.github.io/black-hole-gpu/) (needs WebGPU: Chrome/Edge 113+, Safari 26+, Firefox 141+) · [Atlas de Kerr](https://thesamlepirate.github.io/black-hole-gpu/docs/), the gallery of renders and videos. Deployed by `.github/workflows/pages.yml` on every push to `main` (`bun run build:pages` → `_site/`: the app at the root, `gallery/` under `docs/` with the videos of `docs/video/`).

Real-time and progressively converged rendering of a rotating (Kerr) black hole, its accretion disk
and the lensed sky, written in TypeScript + WGSL, served with Bun — and, around it, a space game: fly
Interstellar's Ranger (and the Lander, the Endurance) from the pad at the Kennedy Space Center through the
solar system to scale, to the wormhole near Saturn and Gargantua's side (Miller, Mann, Edmunds).

```bash
bun install
bun run dev        # http://localhost:3000 (hot reload; server.ts)
bun test           # physics unit tests (geodesics, closed-form Kerr solutions, ISCO, colorimetry, ephemerides…)
bun run typecheck  # tsc --noEmit
bun run build      # static bundle in dist/ (+ the planner's worker)
bun run build:pages  # the GitHub Pages site in _site/ (app, workers, gallery, docs/comment-jouer.html)
bun run gallery    # the scene gallery's pictures recaptured and compared (visual regression; dev server running)
bun scripts/bench.ts             # frame-time benchmark of the reference scenes (headless Chrome, dev server running)
bun scripts/build-sky.ts <dir>   # rebuild assets/sky/ from the NASA map + HYG catalogue (see assets/sky/README.md)
```

Requires a WebGPU browser (Chrome/Edge ≥ 113, Safari 26, Firefox 141+) whose adapter binds 10 storage
buffers per shader stage (said plainly at start otherwise). The tracer's pipelines compile asynchronously
(`createComputePipelineAsync`): on Windows (D3D12/DXC) the first compile can take a minute, without the
GPU process being lost.

## Documentation

- [`docs/comment-jouer.html`](docs/comment-jouer.html) — **how to play** (French, illustrated): the journey,
  the interface, flying, autopilots, map and planner, camera and time, every key, controller and touch.
  Published with the site under `docs/`.
- [`docs/decouvrir.html`](docs/decouvrir.html) — the presentation page (French): hero, physics, the journey,
  the game's features, the film, a gallery. Published with the site under `docs/`.
- [`docs/systemes/`](docs/systemes/README.md) — **how the code works** (French): one sheet per system —
  the geodesic tracer, the render pipeline, the universe and ephemerides, controls and camera, pilot and
  autopilots, flight planning, 3D models, the interface, game/sound/tools/build.
- [`docs/GAME-TOOLS.md`](docs/GAME-TOOLS.md) — the game tools window (F2), saves, `__bh.game`.
- [`docs/MAP.md`](docs/MAP.md) — the 3D map: gestures, bar, timeline, what it shows.
- [`docs/SOUND.md`](docs/SOUND.md) — the synthesized sound and its director.
- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) — the performance analysis, the profilers, the Game quality.
- `docs/progress/` — a screenshot sheet per step; `docs/video/` — the videos of the gallery.

## The game

- **Scenes** (the toolbar's Scenes button): a gallery of cards by group — *Game* (the missions), *Earth*,
  *Solar system*, *Gargantua*, *Wormhole*, *Black holes* — with a filter and a search (`src/ui/scenes.ts`).
  `#scene=<name>` in the URL starts one (e.g. `#scene=game:interstellar`).
- **Missions**: *Interstellar — the journey* (2067, on the pad at the Kennedy Space Center: take off, reach
  Saturn and the wormhole behind it, then Gargantua; real time, real distances) and *Artemis II — around the
  Moon* (400 km up, the Moon targeted: plan a free return with the flight planner and fly it).
- **Worlds**: the 27 bodies of the solar system on their real ephemerides, the Earth on its real relief;
  Gargantua's planets Miller (its sea), Mann (its ice) and Edmunds (its desert), flown in each planet's own
  frame (`src/landing.ts`: gravity, the primary's tide; land and take off with the autopilots).
- **The air** (`src/aero.ts`, `src/flightair.ts`): every world's atmosphere — the Earth's U.S. Standard
  Atmosphere 1976, the others' exponentials with their temperature and gas — acts on the flown craft through
  its own aerodynamics: a Newtonian box (modified-Newtonian Cp at hypersonic speeds, curved faces), a wing
  (lift with Mach, stall, induced drag, flaps), the transonic rise; lift, drag and their moments where they
  act. The heat of an entry (Sutton–Graves convection, Tauber–Sutton radiation) warms a shield and a hull,
  radiating; past their limits — or a load past the structure — the craft is lost (Settings › Ground & air
  › Damage; a point kept at the entry to resume from). In the air the time warp holds at ×4. The map's paths
  fall through the air with the craft's drag, to their impact.
- **On the wheels**: a level touchdown rolls (the crash judged on the vertical speed); brakes and spoilers
  at idle, the tyres' grip; the take-off roll, the rotation, the lift-off — on our worlds and Gargantua's.
- **Three ways to fly the air** (F; the Ranger and the Lander, the Endurance a rocket): **rocket** (as in
  space), **plane** (fly-by-wire: the control surfaces' authority with the dynamic pressure; let go, the
  climb angle and the bank held, the turns coordinated, the stall kept off; hypersonic, the angle of attack
  held), **flight computer** (the throttle sets the speed — 0 a hover —, the stick the climb and the heading;
  it flies that velocity with thrust in any direction, never into the ground; ⇧F antigravity: the hold
  free). P flaps, ⇧P air brake. The HUD's flight path vector and air data.
- **Entry & landing** (⇧G, or the flight computer's LAND tab; `src/entry.ts`): from orbit the deorbit burn
  timed and sized for a site — the first pass the craft's lift can reach, a day of orbits scanned —, the
  guided entry (the angle of attack held, the bank from a predictor–corrector, its reversals), then the
  Ranger's glide onto the runway's line (an energy-managed approach: arriving against the runway, a
  circuit — downwind a turn's diameter off the axis, the turn onto it at the final's start —; the axis
  intercepted; the Shuttle's profile to a touchdown 450 m past the threshold — a steep slope, the
  pull-up onto a shallow one, the flare —, the air brakes; `__bh.game.glideTo("Edwards")` starts one) and
  its rollout (the nose wheel steered along the axis), or the Lander's powered landing.
  Sites and runway headings: `src/game/sites.ts`.
- **The look of an entry**: the bow shock's plasma marched through (the gas's colour, the stagnation
  point's white core, the ionized wake), the hot skin as a black body, the cabin lit through the windows,
  the vapour cone at Mach 1, the camera shaking, the plasma's roar and the sonic boom.
- **Condensation trails** (`src/contrails.ts`): the engines' exhaust freezing into a trail where the air
  is cold enough (the Schmidt–Appleman criterion for a rocket's wet exhaust: on Earth from ~7 km, on Titan
  everywhere, on Venus never), widening and thinning for a few minutes, carried with the air; the
  Ranger's wingtips' vortices condensing when it pulls near its stall in warm dense air. Drawn lit by the
  sun (strongly forward: bright against it) and the sky, dimming what is behind, hidden by the ground.
- **The flight computer** (the full-screen map, M; `src/fc/`, `src/ui/fc/`): the operations — launch to
  orbit (height, inclination), circularize (at an apsis, or NOW in closed loop), apoapsis, periapsis,
  Hohmann, inclination, resonance; match planes, rendezvous and intercept (their porkchop, a click flies a
  cell), match velocities, approach, hold position, fine-tune the approach; land, deorbit and entry — the
  LAND tab lists each site's next pass within the craft's reach (the body turning under the orbit) and
  plans the plane change that puts a pass right over the chosen one (`src/fc/land-ops.ts`);
  **missions between bodies** (the MISSION tab, O: in both universes — our planets, moons, the ISS, the
  craft, the wormhole; Gargantua's worlds, the star, the mouth — an orbit, a fly-by or a free return, the
  window); Gargantua's own planners about the hole — each **previewed on the map** (its path drawn in
  violet, its burns' Δv and duration, the orbit after, the budget) before it is adopted and flown. The
  hub's buttons (HOLD POS, CIRC, APPROACH, LAND, TAKE OFF, ENTRY) are the same operations; the analysis — the elements and their times, the target's relative
  inclination, phase angle and window, closest approach; the plan's burns editable to the m/s and second,
  snapped to the apsides and nodes. Our side flies them as manoeuvre nodes (the map's n-body path);
  Gargantua's worlds, as the flight computer's own burns in their frames.
- **About Gargantua itself** (`src/fc/kerr-ops.ts`): the same operations — circularize, apoapsis,
  periapsis, Hohmann, inclination, resonance, the target's plane — on the Kerr geodesics, not conics:
  the apsides where the path has them (the periapsis advances by tens of degrees a turn), the circular
  velocity where the free fall has no radial pull, nothing inside the ISCO. The analysis is the
  geodesic's own (apsides and their times, the period and the radial period, the periapsis's advance,
  the equator crossings). The hole's burns last days — a good part of an orbit at 2 g —, so each is
  flown to its goal rather than its Δv: the far apsis (re-estimated in flight by Newton on the path),
  the circle (the velocity still to gain), the plane (the angular momentum turned by Δh × r, coasting
  where the thrust would not turn it), the period; a circularization that ends off its radius gets a
  correction.
- **Saves**: the game saves itself in the browser and resumes at the next visit; named saves, export and
  import, and links (`#save=…`) in the game tools ([docs/GAME-TOOLS.md](docs/GAME-TOOLS.md)). The URL hash
  is read once at start, then cleared.
- **Sky chart** (N · ⇧N constellations and star names, U grids, the toolbar's Sky button; `src/skychart.ts`,
  `src/ui/skypanel.ts`): our sky's constellation figures and names, the bright stars' names, the equatorial
  grid of the date, the horizontal grid of the place the camera stands over, the ecliptic — drawn as the
  camera sees them (its aberration included), over the image where the sky shows; hover a star for its card.
- **Sound** (Settings › Game › Sound, the toolbar's Sound button): synthesized live with Web Audio, no
  sample — engine, RCS, wheels, cabin, the flight computer's calls ([docs/SOUND.md](docs/SOUND.md)).
- **Game tools** (F2, the toolbar's Tools button): the Ranger's state, place it in orbit or on a ground
  anywhere, targets and spheres of influence, time and date, saves, a self-audit, the performance meters
  ([docs/GAME-TOOLS.md](docs/GAME-TOOLS.md)).
- **Touch screens**: the page never zooms; on a phone the HUD is laid out for it, and flying uses a stick, a
  throttle lever and roll buttons (`src/ui/touchflight.ts`, `src/ui/mobile.ts`).
- **Performance tiers** (`src/tier.ts`): the hardware's tier (0 software … 4 high-end) is guessed at start
  from the adapter, the device's memory and a touch screen, and caps the realtime image's pixels (0.5 to
  6 Mpx); the **Game** quality (key 6: a ~16 ms GPU budget, dynamic resolution) works under that cap. The
  kernel is specialised to the scene's features. Details in [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

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
| Disk turbulence | The look of Interstellar's Gargantua: hair-thin hot strands drawn out along the orbits (~60 : 1), breaking up into clouds, dense cool smoke that darkens what lies behind it, open lanes — two fields, the heat (temperature) and the density (optical depth). The gas orbits: thin rings (45 per unit of ln r) each turn rigidly at their Keplerian rate, forever, each with its own pattern — no spiral winding, no pattern resets. Scales finer than the sample's footprint (pixel or realtime block, stretched by the grazing angle) fade out, keeping the mean light |
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
* **The film's camera**: a *Film* tone map (2 EV over, each channel rolling off to warm cream, orange
  mid-tones, cool shadows, the bloom as an additive haze); **depth of field** from a per-pixel depth
  (the ray's length where what it shows became opaque — lensing included), thin-lens circles of
  confusion gathered at half resolution with autofocus on the image's centre; a **lens flare** (tinted
  ghosts through the centre and a chromatic halo, from what burns out beyond white).
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
* `tests/targeting.test.ts`: the aimed ray passes through the star's centre (≤ 1e-3 M) even when the
  straight line falls into the shadow; the light-travel delay moves the aim; picking the hole, the disk,
  the sky, the star and the mouth; a secondary image followed by the warm start gives way to the primary;
  orientation offsets (quaternions) round-trip.
* Star's mass: the traced deflection matches 4m/b × γ(1 − v∥) for a lens moving along the line of sight
  (both directions, to 2 %); the camera is pulled by m/d² (5 %), lands on the surface and rides it.
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
Sky chart: the 88 constellations' traditional figures (676 segments) on the Hipparcos catalogue, 102 named
bright stars (IAU Working Group on Star Names), built by `scripts/build-constellations.ts`.

**The worlds' maps**: colour, normal and height maps derived from NASA/USGS/JPL mission imagery (LRO, MGS/
Viking, MESSENGER, Galileo, Cassini, New Horizons, Dawn) — `assets/planets/`, the close-up ones streamed from
`assets/planets-hd/` (see its README); colour maps GPU-compressed as KTX2 (BC7 / ASTC, `scripts/build-ktx2.ts`).

**The craft and the station**: the Ranger and its cockpit, the Lander, the Endurance (Sketchfab, CC BY 4.0,
modified) and NASA's ISS — credited below and in `assets/ranger/`, `assets/lander/`, `assets/endurance/`,
`assets/iss/` READMEs.

**The Earth's relief**: NOAA/NCEI's **ETOPO 2022** (60″, public domain; doi:10.25921/fd45-gt74) for the whole
globe (`assets/earth/relief-*.bin`, `scripts/build-earth-relief.py`), and near the camera the real ground streamed
in: Mapzen/Tilezen's terrain tiles on AWS Open Data (Terrarium; SRTM — NASA/USGS —, GMTED2010, ETOPO1, EU-DEM
and national surveys such as USGS 3DEP), eight levels from 2.4 km to 19 m a texel (`src/system/earth-tiles.ts`;
the "Real terrain" switch).

**The solar system** (our side of the wormhole), to scale — radii, masses, distances — and where it is:

- **Ephemerides**: NASA/JPL's **DE440** (the Sun, the planets' systems, the Moon: 1990 – 2150) and **JUP365**
  (the Galilean moons: 2040 – 2100), refitted from NAIF's kernels by `scripts/build-ephemeris.ts`
  (`assets/ephemeris/`, 7 MB; the kernels themselves are not in the repository): the Moon to 8 m, the inner
  planets to 1 km, the outer ones to 4 km, continuous across their records. The planets' centres are their
  barycentres less their moons' pull (the Earth: the Moon and DE440's mass ratio; Pluto's centre is 2 100 km
  from its system's). Elsewhere, models: the planets on Standish's mean elements, the Moon on its mean
  elements and main inequalities (~2′), the other moons on JPL's mean elements in their Laplace planes.
  Checked (`tests/ephemeris.test.ts`): the 2020 great conjunction (0.10°), Mars' 2020 closest approach
  (62.07 Mkm), the 2012 transit of Venus, the total eclipse of 12 August 2026 against NASA's path —
  greatest eclipse within a second, 1 km and γ 0.8977.
- **Time**: the clock is UTC; the ephemerides run on TDB (the leap seconds of `naif0012.tls`, + 32.184 s),
  the Earth on UT1 ≈ UTC.
- **Turning**: the IAU models (`pck00010.tpc`: poles, prime meridians — Mars' Airy-0 where its map has it, the
  Moon's physical librations); the Earth's precession (IAU 1976), nutation and apparent sidereal time
  (Greenwich to ~15 m); the moons with no model face their planet.
- **Light-time**: what is drawn is where the light shows it from the camera — the Moon 1.3 s ago, Jupiter 40
  minutes (and turned as it was then). Without it the Sun sat 20″ off the Moon: an eclipse's shadow passed
  40 s late, 40 km off.
- **Eclipses**: the Moon's shadow on the Earth — the Sun's disk uncovered seen from every point of the ground,
  the air and the clouds (the umbra, the penumbra, the sky's own light from the sunlit air around: the
  totality's deep blue, the horizon's glow all round), the Sun's corona (Baumbach's profile: a millionth of
  the Sun, streamers, prominences) and the light meter following it. The scene *Earth: total eclipse over
  Burgos, 12 Aug 2026* starts half a minute before the shadow arrives. Settings › Sky › The Earth › Cloud
  cover clears the sky.

## Settings panel

A schema-driven panel (`src/ui/schema.ts` → `src/ui/panel.ts`): every parameter carries its unit,
range, linear/log scale, a physics explanation (hover the ⓘ), dependencies and what it affects
(re-trace, resolve only, resize or nothing).

* **Search** (⌘K / Ctrl+K) across labels, descriptions and keywords — e.g. "transparency", "blazar", "doppler".
* **Tabs** Camera · Scene · Matter · Sky · Physics · Render · Game; groups collapse, matter groups carry their on/off switch.
* **Log sliders** for wide ranges (distance, mass, optical depth, Γ, tolerance…) plus an editable value
  field: type `1e-5`, `6.5×10^9`, `36 M`; ↑/↓ nudge (⇧ ×10, ⌥ ×0.1); Enter / Esc.
* **Modified markers**: an orange dot per changed setting (click it or double-click the label to reset),
  per-group reset, "Reset everything".
* **Undo / redo** (⌘Z / ⇧⌘Z) of every panel edit; a whole slider drag is one step.
* **Scene presets**, **your own presets** (saved in the browser), **quality** Low → Ultra, RT max and
  Game (shows "Custom" when edited by hand), **Advanced** toggle for expert integrator/sampling parameters.
* **Share link**, **export / import JSON**, keyboard-shortcut sheet (?). `M` shows/hides the panel (⇧M while
  flying, where M is the map); on small screens it becomes a bottom sheet.

## Controls

**Time and camera, one model in every mode** (with or without the Ranger):

- **Time** (the time bar — over the toolbar, in the mission bar while flying): Space runs / pauses,
  `,` `.` step the warp along its ladder (slow motion, real time's multiples, then the classic M/s rungs;
  beyond 500 M/s the ship rides on rails), `/` is real time (by physical position: `;` `:` `!` on AZERTY).
  The warp reads as a multiple of real time; the clock as a UTC date in the game's world. Paused, nothing
  the time drives moves — the ship, its attitude, the cinematics, the liquid throat's waves — and the
  image refines at once; the camera itself stays free (a photo mode).
- **Views** (V · ⇧V): without the ship, around the target · following it · free · on a tripod · falling
  freely (B); with it, its six mounts, around it, free, or a fly-by. Choosing one never moves the camera.
- **Look at the target** (C) in every view — the free and falling cameras, the follow camera, the ship's
  mounts (the look turns on its mount), around the ship (behind it on the target's line). The tripod
  without it keeps a view fixed to its ground: the sky wheels over it. **⇧T sets it down** on a world —
  the target's, else the nearest —, 1.7 m above its relief, level, facing the horizon. The free camera
  near a world's ground (under a fiftieth of its radius) is carried by it, turning with it; leaving the
  ship, the camera stays where its eye was (a mount outside is metres to kilometres from its centre).
- **Telescope** (Y): fields down to 0.02°, held on the target, eased zoom on the wheel, a reticle with the
  angular scale, the focal length and the target's size and distance — the wormhole a lensed degree-wide
  sphere from the Earth, and through it Gargantua's sky.
- **The camera panel** (the toolbar's camera button, the flight HUD's view): the views, the look, the lens,
  the target (search, frame it, **go to it** — anywhere in the world, through the wormhole too), the
  relativistic observer's motion and the cinematics (O auto-orbit, ⇧C dive, T journey — they run with the
  time).
- **Video** (Render › Video) steps the same simulation as the live view (`src/sim.ts`): the scene goes on
  from now as it would live — the camera's mode, the ship and its autopilots, the mission — at the live
  warp, another one, or frozen (bullet time); or it replays a **take** recorded live (● on the time bar:
  what you did, frame by frame, rendered afterwards at full quality). The scene returns to its start.

**The star's mass** (Matter → Companion star → Mass, in units of Gargantua's M; 0.1 by default — a real
star beside a supermassive hole would weigh ~10⁻⁸ M and show nothing): its weak field is added to the Kerr
metric in the flat far-field map as the linearized field of a *moving* mass, h_μν = −2Φ(η_μν + 2u_μu_ν),
Φ = −m/d (rest-frame distance). For light, δH = 2Φγ²(1 − v·p̂)² kicks p_r, p_θ and L after every step
(trapezoidal, on the GPU and in the CPU aiming/picking): deflection 4m/b × (1 − v∥) (Pyne & Birkinshaw
1993), so Gargantua's image is pushed away from the star, the star magnifies itself, and at large masses
secondary images appear on its limb; its own light is redshifted by 1 − m/R. The camera (gravity on)
feels δH = Φ(2γ²(E − v·p)² − 1) — Newton for a slow body, and a moving star exchanges energy with it (a
slingshot) — it can orbit the star while the star carries it round Gargantua, and it lands on (and
rides) the surface instead of crossing it.

**Gargantua orbits the centre of mass** (whenever the star has a mass): the relative orbit has
Ω² = (M + m)/D³ (Kerr correction kept), and Gargantua circles the centre of mass at q·D, q = m/(M + m)
(6.4 M at 0.011 c for m = 0.1 M), opposite the star. Everything is still traced in Gargantua's frame,
which falls freely towards the star, so the uniform "indirect" field of that fall is added —
g_tt = −(1 + 2a·x), a = m x★/D³ — for light (a kick like the star's) and for the camera's geodesic;
the distant sky, at rest in the centre-of-mass frame, is aberrated (and Doppler-shifted) by Gargantua's
velocity at the time each ray escapes, which together with the indirect field gives the right sky
direction at the camera. In free rotation (and when orbiting the new target **Centre of mass** ⊕) the
camera stays at rest in the centre-of-mass frame — it drifts in Gargantua's frame and takes its velocity
(motion "At rest (centre of mass)") — so Gargantua and the star are seen circling ⊕ against fixed stars;
orbiting Gargantua or the star follows them instead. While the flight keys move the camera (and inside the throat, where
"aiming at the wormhole" means nothing) the aim pauses and the flight carries the view, so Z/W takes
the camera straight through the wormhole in either direction; the aim resumes from the orientation the
flight left, without a jump. Tests: Ω, −B̈ = m x★/D³, and a distant body at rest
in the centre-of-mass frame stays at rest there (3 %; without the indirect field it drifts away).
The wormhole's mouth stays bound to Gargantua.

**Seamless gluing.** Rays cross the gluing sphere without a visible edge: their clock goes on through
the Dneg region (Gargantua's coordinate time, dt² = dr²/α⁴ + r²dΩ²/α², integrated along the path — a
reset clock had drawn the disk behind the mouth ~100 M off, a sharp circle), Dneg steps end exactly on
the sphere (no overshoot for grazing rays), Gargantua's weak field still bends them inside the sphere,
the mouth's far field (2M_w/b: Dneg is the spatial part of a Schwarzschild field far out) bends them
outside, and their energy at infinity is kept across it.

**The International Space Station** (Sky → The Earth → Space station, or the scene "Earth: docking to the
ISS") — NASA's model of the station as flown (NASA 3D Resources; see `assets/iss/README.md`), on its real
orbit: CelesTrak's latest elements, propagated with SGP4 and turned into the Earth's axes by the sidereal
time the game turns the Earth by; flying +XVV, its solar arrays turned to the Sun (alpha joints and beta
gimbals), its radiators edge-on. Within 30 km of the Ranger it falls by the game's own gravity and drag, as
the ship does. The Ranger docks to Harmony's ports (IDA-2, IDA-3) rear first; its docking camera, the
station's, a docking aid in the HUD. The docking autopilot (B, AUTO-DOCK in the docking panel, or the end of a
PLAN to the ISS) flies the last of it on the thrusters: round the station if it stands in the way, to the
port's axis, in along it with a hold 10 m out, to the capture at under 0.1 m/s.

**The Endurance** (Matter → Endurance, or the preset "Interstellar: the Endurance before Gargantua") —
[“Interstellar | Endurance” by devPilot](https://sketchfab.com/3d-models/interstellar-endurance-901fec2809704b74bec891e9a40a8726),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), modified (see `assets/endurance/README.md`) — on a
circular Keplerian orbit around the hole, its ring turning, at a cinematic scale (its diameter in M: at 64 m it
would be far below a pixel next to a hole of 10⁸ M☉). Seen along straight rays from the camera (retarded and
aberrated like the local patch, not lensed), rasterized with the tracer's pinhole into a box of the image
(4× MSAA), hidden where the traced depth is nearer, lit by the disk, composited before bloom.

**The fleet: the Ranger, the Lander, the Endurance** (Game → Craft, [ and ] in flight, or the scenes "Earth:
the Endurance, 800 km up" and "Earth: the Lander, 500 km up") — three craft to fly, each with its mass, engines,
turning, docking ports, thrusters and attach points (`src/vessels.ts`): the Ranger (40 t, its rear hatch), the
Lander ([“Endurance Lander from Interstellar” by Crusty Bread](https://sketchfab.com/3d-models/endurance-lander-from-interstellar-0bcbd25523794779826e3e19770dc1f2),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), modified — see `assets/lander/README.md`; 160 t, 24 m,
its painted maps, its dorsal hatch) and the Endurance at its true 64 m (900 t, its hub's two ends). They start
near the Earth in the space station's plane, the Endurance 800 km up, the Lander 500 km up. The one flown
carries the camera; the others coast on Kepler orbits, or stay docked (`src/fleet.ts`) — docked craft fly as
one: the one flown pushes the others, the masses added, the assembly turning about its common centre of mass,
slower by its moment of inertia. All are drawn in one pass (`ship.wgsl`: their depths shared, reversed in
float; those not flown hidden by what the traced image holds nearer), lit like the Ranger. The craft not flown
are targets like the bodies (Tab, a click, the camera panel's Spacecraft, Go to): on the 3D map with their
orbits, their ground tracks on the globe and the planisphere, the lock-on HUD (the distance to the hull); PLAN
gives a rendezvous 200 m off a free docking port of theirs, then the docking autopilot. Any free port docks to
any other — a craft's, the station's: the capture makes one rigid assembly (the momenta shared), held by the
station when docked to it; UNDOCK lets the flown craft go, what is left coasting as its own assembly. The
craft collide with each other and with the station (a blow shared by their masses).

**The Ranger's cockpit** (the view "Cockpit", the pilot's seat) — the Ranger's cabin ("Interstellar Ranger
One Cockpit", Sketchfab, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), modified — see
`assets/ranger/README.md`) at its own proportions, drawn alone from inside (the hull alone from outside): its
glass see-through (the lamps' highlights on it), the outside's light let in only through it (the sky each
point sees, baked; the Sun's patches through the windows from the shadow map), cool lamps along the ceiling,
the consoles charcoal with their silk-screened labels and LEDs, the screens in the film's cyan — block
diagrams, text, the attitude (the horizon turning with the ship), the orbit —, the flight sticks moving with
the commands (the pilot's and the autopilots'). The screens show the flight's real telemetry, drawn sharp
(`src/ui/cockpitscreens.ts`, a 2048 × 1024 texture of eight displays redrawn eight times a second): the
attitude (horizon, pitch ladder, roll, the motion's marker, speed and height), the orbit to scale, the target
and the path's next event, the systems (thrust, propellant, mass, SAS, autopilot), the docking cross-hair, the
manoeuvre plan, the clocks, the pilot's log — each screen its display by where it is, the attitude straight
before the pilot. The view "Cabin" lets the camera move about it (the flight keys; it glides along the walls),
the drag or the arrows turning the look. The cabin has its own lean shader (`fsCabin`) and a depth pre-pass.

**The Ranger — a camera holder** (K, the toolbar's ship button, Scene → Spaceship, or the preset
"Ranger: approaching Gargantua"; ⇧K cycles the attach points: hull quarter (the film's view), chase, dorsal,
wingtip, belly, nose looking back). Interstellar's Ranger — [“Interstellar Ranger One” by Max Vizell](https://sketchfab.com/3d-models/interstellar-ranger-one-77c63df2062d4fd9863cc64711450c6f),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), modified (see `assets/ranger/README.md`) — (OBJ prepared by `scripts/build-ranger.ts`: n-gons
ear-clipped in their plane, 40° auto-smooth normals, one material per part; the model's own textures were
baked on another UV layout and are not used) carries the camera. A few metres across, it lives in the camera's
local flat patch of spacetime and is rigid in its rest frame, so it is rasterized with the tracer's own pinhole
(4× MSAA) and composited over the resolved HDR image, before bloom — the disk's glare spills over its
silhouette. It is lit by a **light probe traced by the ray tracer itself**: 256×128 directions around the camera,
in its rest frame (lensed disk, Gargantua, sky, aberration and Doppler of the camera's motion included), one
texel of each 2×2 block refreshed per frame, each texel a running mean that converges while the camera holds
still. The probe is pre-filtered with the GGX lobe per roughness (filtered importance sampling, split-sum BRDF
with multiple-scattering compensation) and projected on order-2 spherical harmonics (diffuse irradiance,
Ramamoorthi & Hanrahan); a shadow map follows the dominant light direction (the L1 band). The mesh is refined
to ≤ 0.45 m edges (crack-free red-green refinement) and carries **ambient occlusion baked** by ray casting
(96 rays per vertex against a BVH). Surfaces: light grey paint under a **clear coat** (sharp reflections of the
disk at grazing angles), a **procedural normal map** evaluated in the ship's frame (1.2 cm seam grooves,
rivet rows, pillowed and slightly tilted panels, so reflections break panel by panel; features narrower
than a few pixels fade out), wear, dark glass, metal nozzles; specular occlusion, horizon fade of bumped
reflections and specular anti-aliasing from the normal's variation within the pixel. A lighting gain (1 =
physical: against the disk the hull is a black silhouette, since it receives a few hundred times less light
than the disk's surface brightness; default 30), hull brightness, metalness, roughness and clear coat are settings.

**Flying the Ranger** (on whenever the ship is: K; `src/pilot.ts`, `src/ui/flighthud.ts`). A flight model rather
than a camera mount: the ship follows the Kerr geodesic (star's weak field included) in the scene's time;
its main engine (the Thrust setting, c²/M, shown in g for the chosen mass) and its RCS (8 %) give it a proper
acceleration along its own axes; its attitude has inertia (reaction wheels, 0.75 rad/s, 1.6 rad/s², in the
pilot's seconds). The flight computer adds **SAS** (fly-by-wire rate command, damping), **attitude holds**
(prograde, retrograde, radial ±, normal ±, target — the target's direction aberrated by the ship's motion,
as the tracer draws it) and **autopilots** that fly like real ones — they point the main engine along the
required burn, throttle it once aligned and leave fine corrections to the RCS: *hold position* (a static
observer, gravity fed forward from the geodesic; the ZAMO inside the ergosphere, where no static observer
exists), *circularize* (the tangential speed whose free fall has no radial acceleration, found by probing the
geodesic — exact off the equator too), *approach target* (station-keeping 4 radii from the star, cancelling its
pull, or 1.3 gluing radii from the wormhole's mouth). Displays: flight data (r, speed and γ relative to the ZAMO,
dτ/dt, thrust, E and L, periapsis and apoapsis of the predicted path, course — bound, escape, horizon or star in
so many M and hours —, target distance and range rate, proper time, time warp), an **attitude ball** (sky and
ground relative to the hole, the orbital markers around the nose), prograde / retrograde / burn / nose markers
in the view, warnings (collision course, ergosphere, below the ISCO, inside the photon orbit), and a **top-view
map**: horizon, ergosphere, photon orbit, ISCO, disk, the star and its orbit, the mouth, the ship, its velocity
and its **future geodesic** with periapsis, apoapsis and impact — the same path drawn, lensed, in the view.
**Piloting aids over the view** ([docs/HUD.md](docs/HUD.md), each switchable in Settings › HUD aids): the
horizon and a pitch ladder where they are, the heading tape, the bank scale, radial and normal markers and
arrows to those off screen; in the air the angle of attack drawn against the best lift-to-drag and the stall,
the sideslip ball, the energy chevron, the load, the flight director; the predicted path in perspective (both
universes), the places to come (+10/+30/+60 s, a quarter orbit) and the impact or entry point with its
countdown; the runway where it is with its aim point and offsets, the vertical landing's drift scope and
stop-burn countdown; the burn cue (countdown, Δv, length, aim); the docking gates and scope; near Gargantua
the relativity box (dτ/dt, γ, Doppler, bound or escaping, the critical radii, the tide).
The **flight HUD** is laid out like a game's, on the edges of the screen so the view stays clear (² / ` cycles
full · minimal · clean; the app's toolbar folds behind ⋯): a mission bar (SAS / hold / autopilot lamps, time
warp, the ship's clock τ against the distant clock t and their ratio), a **speed tape** (moving scale, value
box, the autopilot's target bug, trend) and an **altitude tape** (log r with horizon, photon orbit, ISCO, the
star's orbit, periapsis and apoapsis bugs, vertical-speed bar), placed in the free band between the panels;
the target panel (range, range rate, closest approach), **telemetry** charts of the last minute (speed,
altitude, clock rate, thrust), the **effective potential** of the orbit — V(r) for the ship's E, L and Carter
constant Q, R(r) = [E(r² + a²) − aL]² − Δ[r² + (L − aE)² + Q] = 0, with the energy line, the escape line and the
region the ship can reach —, and the cockpit: the attitude ball inside throttle and g-load arc gauges, holds
on the left, SAS and autopilots on the right.
The full-screen map is drawn on the GPU — the tracer's own maps on true spheres, the Earth's clouds and
city lights, Saturn's rings, Gargantua's disk and photon ring, its worlds procedural; the orbits and paths as
anti-aliased lines cut exactly where a body stands in front of them; the globe and the planisphere lit pixel
by pixel — with labels and a legend over it ([docs/MAP.md](docs/MAP.md)). The map's tabs add the **ground track** of the world the ship orbits (in its sphere of influence: our
planets and moons, Mann, Edmunds): a **globe** — its map lit by the Sun, the day and the night, turning under
the ship (drag it, the wheel zooms, a double click follows the ship again) — or a **planisphere**; on both the
track left (fading), the free-fall path ahead and the planned one through the nodes, periapsis and apoapsis
with their heights, the horizon the ship sees (acos R/(R + h) about the point under it), the point under the
Sun, the latitude, longitude, altitude and orbit (M: full screen).
The **map shows the real motions**: when the star has a mass, in the inertial frame of the centre of mass —
Gargantua circles it too, the mouth with it — with the ship's trail and predicted geodesic, the star's and the
hole's paths over the same span, common time ticks (where each will be at +100 M, +200 M…), the closest
approach to the target (both moving), the camera's view cone; top or edge-on view, or Gargantua's frame. The
**camera travels** between attach points (V / ⇧V, the Camera strip, the pad's D-pad ▲▼) in 0.6 s while the ship
keeps its attitude. The **cockpit** takes the bottom edge while flying (the toolbar moves up, the camera tools
that would fight the pilot leave it): speed and altitude, the attitude ball inside a throttle arc (drag it),
the autopilot's phase and remaining Δv, SAS / holds (with their marker glyphs) / autopilots; the orbit panel
adds periapsis and apoapsis with the time to reach them and the closest approach. The target hold points at
the target where it is seen: light delay and aberration included.
Keys (KSP's layout, by physical position — Z S · Q D · A E on AZERTY): W S / A D / Q E pitch, yaw, roll;
I K · J L · H N RCS translation; ⇧ / Alt (or ↑ ↓) throttle up / down, Z full, X cut; Caps Lock precision
controls; T SAS; R roll alignment; 1–7 holds; autopilots 8 hold position · 9 circularize · 0 approach · G land ·
U take off · B dock; O missions (the flight computer's MISSION tab); M the 3D map, ⇧M the settings; V · ⇧V camera; ⇧R camera reset; ⇧Y the
future path in the view; [ ] the craft flown; ⇧K leave the ship; , . time warp; drag looks around from the
attach point. The pad: left stick, bumpers and triggers fly; A SAS, B cut, X/Y prograde/retrograde, D-pad ▲▼
camera. Touch: a stick, a throttle lever, roll buttons. Default lighting of the hull: 1 (physical: strong
contrasts).

**Automatic flight: the flight planner** (O, or PLAN in the mission bar; `src/maneuver.ts`). Manoeuvre nodes —
an impulse Δ(γβ) at a coordinate time, split along the orbital frame (prograde, normal, radial) — and the
path through them, computed on the real Kerr geodesics (star included) and drawn on the map in cyan with the
nodes as diamonds, the Pe / Ap after the last burn and its fate (horizon, star, escape, through the wormhole).
Pick a goal — **Gargantua** (a circular orbit of radius r), the **companion star** (rendezvous) or the
**wormhole** (through its mouth) — and the planner finds the burns by shooting:
*align plane* turns the orbit into the goal's plane (Gargantua's equator — the disk's and the star's orbit's —,
or the plane through the hole and the mouth) at the cheaper of the next two crossings, the velocity rotated
with its speed kept (Δv ≈ 2v sin(i/2)); a transfer planned after it starts from the aligned orbit;
*circular orbit* is Hohmann-like — a prograde (retrograde) burn whose opposite apsis, found by bisection on the
geodesic, is r, then a circularizing burn there; *rendezvous* scans that burn's departure time so the star
is there too and matches its velocity at the closest approach, then keeps station; *wormhole* solves for the
3-D Δv whose path passes through the mouth's centre (Gauss–Newton on the miss vector, departure time scanned for
the cheapest). Or **simulate a burn**: + NODE and shape it with PRO± NRM± RAD± (0.002 c, ⇧ ×10, ⌥ ×0.1) and
its time — the predicted path updates live. **EXECUTE** flies the plan: time warps to the node, the nose turns
onto the burn, the main engine fires centred on the node's time (its direction fixed when it starts), stops when
the Δv is delivered, then the next node, then circularize, station-keeping or an orbit. The first burn is always a
few seconds of warp ahead, so there is time to turn.
At the star, **Station** stops next to it, **Orbit** inserts into a circular orbit around it: the rendezvous aims
the closest approach at 3.2 stellar radii (never through the star) and the last burn gives the star's velocity
plus the circular speed √(m/d) around it, in its orbital plane; the *orbit* autopilot then holds that orbit
(radius and plane errors closed over a fraction of a turn) — needed, since at 8 M Gargantua's tides (the Hill
radius is ≈ 0.32 × 70 M) would stretch a free prograde orbit to 3–14 M in a few turns. **Roll alignment** (R,
on by default): whenever the nose is held — holds, autopilots, burns — the ship also rolls so that its top
points along the orbit's normal, wings in the orbital plane (with the nose on the normal, the top faces the hole).

**The Interstellar mission** (preset "Mission: through the wormhole to the companion star"; `src/mission.ts`)
flies the whole trip with these systems alone, as a film: on our side of the wormhole the Ranger lights its
engine towards the throat, reaching exactly the circular speed of the point where it will leave the far mouth —
aimed along the orbit's tangent, at right angles to the radius — crosses the throat, turns its view to Gargantua
and circularizes at r ≈ 21 M; that orbit would come back through the mouth one turn later, so a transfer raises
it to 33 M, clear of the gluing sphere; after a while in orbit (prograde, wings level), a plane change of ≈ 21°
brings it into the star's orbital plane, a transfer with orbit insertion takes it to the star, and the orbit
autopilot keeps it there. Captions tell each phase; the camera cuts between attach points (quarter, wing,
chase, dorsal, belly) and a camera director turns the view on its mount towards Gargantua or the star during
burns and some coasts. Esc hands the controls back. `__bh.freeze()` / `__bh.step(dt)` step the simulation frame
by frame for offline videos (docs/video/mission.mp4).

**Cinematic mode — the liquid wormhole** (L, the toolbar's wave button, Scene → Cinematic mode, or the
preset "Cinematic: the liquid wormhole"). An artistic effect, not physics: a liquid surface covered in tiny
ripples (wavelengths of 2π/150 of the throat radius and less) is stretched across the throat (ℓ = 0). It only
shows up close: each ripple fades out once it spans fewer than ~8–24 pixels (the pixel's footprint on the
throat, like a mip-mapped normal map), and once even the longest is unresolved the whole effect — reflection,
tint, glow — is off, so from afar the wormhole is exactly the physical one. Dneg steps land exactly on it; each ray crossing it is either
reflected (probability given by Schlick's Fresnel term, so the rim of the sphere turns into a mirror of the
camera's own universe, Gargantua's disk included) or refracted by the slope of the waves, and the light
that goes through picks up a thin aqueous tint, caustics where the surface curvature focuses it, and a
glow scattered in the liquid (bright on the crests, a sheen towards the rim). The surface carries patchy
trains of fine travelling ripples in eight directions (ω ∝ √k), droplets that fall now and then, and a **splash**
spreading from the point where the camera goes through. The waves run on their own clock (they move with
time paused; wave speed 0 freezes them so the view can refine); in a video they follow the video's time.
Settings: ripples, reflectance at normal incidence, liquid colour and colour density (the transmitted light
is filtered towards the colour, more at grazing incidence), glow and glow colour, wave speed. By default the reflectance and
the glow are 0 (a clear liquid: ripples, caustics and tint only); 0 reflectance means no reflection at all.

**Game controller** (Xbox, PlayStation — any pad with the browser's standard mapping; `src/gamepad.ts`):
left stick flies (forward/back, sideways; L3 held: boost), right stick orbits the target (free: looks),
RT/LT up/down, LB/RB roll; A flies to the target, B gravity, X auto-orbit, Y around ⟷ free, D-pad
◀ ▶ previous/next target and ▲ ▼ closer/farther, R3 recentre, View runs/pauses time, Menu opens the
settings. Radial dead zone and a gentle response curve; a rumble when the camera crosses the wormhole's
throat. The browser exposes a pad once a button is pressed with the page focused. On macOS 26 a wired
Xbox 360 pad (045E:028E) has a system driver but Chromium browsers (Chrome, Edge, Arc) never hand it to
the Gamepad API: "Connect a USB controller" (help sheet, settings menu) opens it through **WebHID** instead
and decodes its 20-byte report (standard mapping; remembered, reopened on the next visit). Connection
toasts are debounced (Safari hands a pad over between two internal providers).

**Placements** in detail (V, the camera panel, Camera → View):

- **Around the target**: drag orbits the selected body — Gargantua, the companion star or the wormhole's
  mouth — with momentum; the wheel sets the distance to it; right-drag offsets the view. The camera keeps
  aiming at the body's **apparent image**, found on the CPU by shooting rays through the Kerr metric and
  correcting them (Gauss–Newton) until one passes through the body's centre: light bending, the star's
  light-travel delay (it is seen where it was) and the camera's aberration are included, and the primary
  image is preferred (the one closest to the straight line; a warm start that drifted onto an image bent
  around the hole is dropped). Orbiting the star follows it along its orbit in its rotating frame, and the
  camera becomes **co-moving** (it takes the velocity of the star's rotating frame, v = ϖ(Ω★ − ω)/α,
  eased in and out), so the star shows no Doppler shift.
- **Free**: drag turns the camera about itself, right-drag rolls, the wheel moves it forward and back
  (with the flight's inertia).

**Selecting a body**: click its image — picking traces the pixel's ray (horizon or disk → the hole, star,
gluing sphere → the wormhole), so even a lensed secondary image works; the hover label names it. Tab cycles
the targets available in the camera's universe (our side: the Sun, the planets and moons, the wormhole,
the station and the craft not flown; Gargantua's: the hole, the star, its planets, the mouth).
Double-click a body to orbit it and **fly the view to it**: the orientation turns by a quaternion slerp
while the camera flies on an arc around the body to a framing distance, bending its approach so that the
line of sight clears the hole and its disk. Double-click the sky (or ⇧R) to recentre (free: level the
horizon). While the camera is handled, brackets mark the target's apparent image with its name and
distance (an arrow at the edge when it is off-screen), then fade. With gravity on, the position follows
the geodesic and the view keeps tracking the target. O auto-orbits the target.
Alt+wheel: FOV · arrows, +/−: orbit / zoom.
**Wormhole** (Scene → Interstellar wormhole, or the preset "Interstellar: wormhole to Gargantua"): target
the wormhole to orbit it; the wheel then sets the distance to the throat. **Free flight, six degrees of freedom** (keys by physical position: Z Q S D /
A E / W X on AZERTY = W A S D / Q E / Z X on QWERTY): forward/left/back/right, down/up, roll; ⇧ faster;
right-drag turns the camera about its own axes with no gimbal limit. Near the wormhole the camera
follows its geodesics, so it can cross the throat; it re-anchors to the nearest object and can go
anywhere outside the black hole's horizon. These keys are reserved for flight. A **middle click** switches to
game-style flight: pointer locked, the mouse turns the camera, the wheel sets the speed, movements ease
in and out (inertia), Esc leaves.

**Gravity (B)**: while time runs, the camera becomes a massive body in free fall: a timelike Kerr
geodesic (`src/geodesic.ts`: Hamiltonian in Boyer–Lindquist coordinates, RK4 in proper time, advanced
by the scene's coordinate time so the camera, the flow and the star share one clock) released at rest
w.r.t. the local ZAMO; the flight keys fire thrusters (proper acceleration, setting "Thrust"). The view is
that of the moving observer (aberration, Doppler), its orientation is kept fixed on the stars (gyroscope),
and near the wormhole — whose metric has no gravity — it coasts along the Dneg geodesics. The predicted
free-fall path (about one orbital period, no thrust) is drawn **by the ray tracer** as a glowing dashed
tube tested against every step of every ray, so it is lensed like the rest of the scene: an orbit's far
half becomes an Einstein ring around the shadow, a plunge wraps around it (red end = horizon). Tests:
circular orbits keep their radius and Keplerian period, u·u = −1, and the proper time of a radial fall
matches the cycloid solution. **T** runs the
journey: line up with the mouth, cross the throat, emerge facing the black hole and settle into orbit (from
the black hole's universe: the way back home).

Keys: space time · , . / warp and real time · V view · C look at the target · Y telescope · Tab target ·
R · ⇧R next view · recentre · O cinematic orbit · ⇧C free-fall dive (exact E=1, L=Q=0 geodesic in proper time,
seen from the rain frame) · T wormhole journey · ⇧T tripod on the ground · B free fall · middle click mouse look ·
N · ⇧N constellations · star names · U sky grids · J jet · G shadow guide · L liquid wormhole ·
K fly the Ranger (flight keys in the help sheet) · I readouts · M settings · ⌘K search · ⌘Z undo ·
1–6 quality (5 RT max, 6 Game) · P PNG · F fullscreen · H hide UI · F2 game tools · ? the shortcut sheet.

The URL is not kept in sync with the settings any more: a link (`#save=…`, Copy a link in the game tools;
or the panel's share link) restores a moment, `#scene=…` starts a scene, and old setting links are read once.

In dev, `window.__bh` exposes `settings`, `touch()`, `preset(name)`, `snapshot(name)` (saves the
converged frame to `snapshots/`) and `render(name, preset, patch, options)` (offline render saved to
`snapshots/`); `__bh.renderer.precisionProbe(...)` runs the GPU precision probe; `__bh.game` holds the
game tools (`__bh.game.help()`, see [docs/GAME-TOOLS.md](docs/GAME-TOOLS.md)), `__bh.iss` the station,
`__bh.sky` the sky chart, `__bh.captureScenes()` the scene gallery's pictures (`scripts/scene-thumbs.ts`).
