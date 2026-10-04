# The Earth's maps

Loaded by `src/system/earth-maps.ts` and packed on the GPU for the tracer (trace.wgsl: the Earth).

Two tiers: `med` (faces 2048², equirectangular maps 4096 × 2048), loaded with the solar system's maps;
`high` (faces 4096², 8192 × 4096), when the camera comes near the Earth.

- `day-med/`, `day-high/` — the surface's colour, a cube map (faces 2048² and 4096²).
- `cloud-med/`, `cloud-high/` — the cloud cover, a cube map (the same faces).
- `ktx2/<tier>-<face>.ktx2` — the day cube GPU-compressed: each face its day colour with its cloud cover
  as alpha, UASTC (RDO, Zstandard), mip-mapped, transcoded by the page to BC7 or ASTC
  (`src/system/ktx2.ts`; a quarter of rgba8's memory). Built by `bun scripts/build-ktx2.ts earth` (needs
  `basisu`: `brew install basis_universal`). Where the GPU has neither format, the JPEG faces above are
  used.
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

Near the camera (`src/system/earth-tiles.ts`), streamed and not stored here: the terrain tiles (Mapzen's
Terrarium on AWS Open Data) and, on their levels up to z 8 (611 m), NASA's imagery from **GIBS** — the
Blue Marble Next Generation by day, VIIRS's night lights (2016) by night —: "We acknowledge the use of
imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth
Science Data and Information System (ESDIS)."
