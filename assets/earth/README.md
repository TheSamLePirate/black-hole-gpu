# The Earth's maps

Loaded by `src/system/earth-maps.ts` and packed on the GPU for the tracer (trace.wgsl: the Earth).

- `day-med/`, `day-high/` — the surface's colour, a cube map (faces 2048² and 4096²).
- `cloud-med/`, `cloud-high/` — the cloud cover, a cube map (the same faces).
- `night/` — the city lights at night, a cube map (2048²; its red channel is used).
- `normal-med.jpg`, `normal-high.jpg` — the relief's normals, equirectangular (4096 × 2048, 8192 × 4096;
  red: east, green: south).
- `ocean-med.jpg`, `ocean-high.jpg` — the oceans' mask (white: water), equirectangular.
- `height-med.jpg` (4000 × 2000), `height-high.jpg` (8192 × 4096, resampled from a 21600 × 10800 map) —
  the height above the sea, 0 → 8 848 m, equirectangular.

Cube faces: `ft` looks at Greenwich (lat 0°, lon 0°), `rt` at 90° E, `bk` at 180°, `lf` at 90° W, `up` at
the north pole (Greenwich at its bottom edge), `dn` at the south pole (Greenwich at its top edge).

Sources: from the texture pack in `assets/tex` (its `cubemap/earth-*` and `base/earth-*` sets). The imagery
is that of NASA's Blue Marble (day, clouds) and Black Marble (night lights) with its derived relief —
NASA imagery, in the public domain.
