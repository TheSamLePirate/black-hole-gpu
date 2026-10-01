# The Earth's maps

Loaded by `src/system/earth-maps.ts` and packed on the GPU for the tracer (trace.wgsl: the Earth).

- `day-med/`, `day-high/` — the surface's colour, a cube map (faces 2048² and 4096²).
- `cloud-med/`, `cloud-high/` — the cloud cover, a cube map (the same faces).
- `night/` — the city lights at night, a cube map (2048²; its red channel is used).
- `ocean-med.jpg`, `ocean-high.jpg` — the oceans' mask (white: water), equirectangular.
- `relief-med.bin` (4096 × 2048), `relief-high.bin` (8192 × 4096) — the height above the sea [m],
  equirectangular, from NOAA's ETOPO 2022 (60″ surface elevation, the ice sheets' surface; public domain),
  built by `python3 scripts/build-earth-relief.py` (the grid's format there). The relief's normals are
  computed from them on the GPU.

Cube faces: `ft` looks at Greenwich (lat 0°, lon 0°), `rt` at 90° E, `bk` at 180°, `lf` at 90° W, `up` at
the north pole (Greenwich at its bottom edge), `dn` at the south pole (Greenwich at its top edge).

Sources: from the texture pack in `assets/tex` (its `cubemap/earth-*` and `base/earth-*` sets). The imagery
is that of NASA's Blue Marble (day, clouds) and Black Marble (night lights) — NASA imagery, in the
public domain. The heights: NOAA National Centers for Environmental Information, ETOPO 2022 15 Arc-Second
Global Relief Model (here its 60″ grid), doi:10.25921/fd45-gt74.
