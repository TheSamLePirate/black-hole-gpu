# The solar system's worlds up close

Streamed in by `src/system/hd-maps.ts` for the body near the camera, once its coarse map's texel outgrows a
pixel under it (within ~4 of its radii at a 60° view; freed beyond twice that — `src/renderer.ts`), one
body at a time: its colour map (`<body>-color.jpg`: 8192 wide for the Moon and Mars, 6000 for Jupiter,
4096 for most, 2048 for Ceres and Phobos, 1600 for Mimas), its brightness kept to the coarse map's mean,
and its relief: for the Moon and Mars their laser altimeters' heights (`<body>-dem.bin`, below) — the ground
drawn, stood on and lit, its normals taken from them —; elsewhere a normal map (`<body>-normal.jpg`: red
east, green south) or a height map from which the normals are computed on the GPU (`<body>-height.jpg`:
Mercury); Jupiter and Saturn have colour only.

These stay JPEG: the coarser maps of `assets/planets` have GPU-compressed KTX2 copies
(`scripts/build-ktx2.ts`), but 8K maps in UASTC would add hundreds of MB to the repository.

Source: the texture pack in `assets/tex/base` (local, git-ignored) (its `<body>-ultra/high/med.jpg`, `<body>-normal-*.jpg`,
`<body>-height-*.jpg`), derived from NASA/USGS/JPL mission imagery (Lunar Reconnaissance Orbiter, MGS/
Viking, MESSENGER, Galileo, Cassini, New Horizons, Dawn).

## The Moon's and Mars's heights

`moon-dem.bin` and `mars-dem.bin`: 4096 × 2048 equirectangular (2.7 km a texel on the Moon, 5.2 on Mars),
whole metres, in the Earth's relief format ("ELV1", gzip: `src/system/heights-file.ts`), reduced by
`python3 scripts/build-dem.py` (each texel the mean of the grid's cells it covers) from:

- the Moon: **LRO LOLA** LDEM_64 (64 pixels a degree; heights over the 1 737.4 km sphere) —
  <https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/>
- Mars: **MGS MOLA** MEGDR topography at 64 pixels a degree (heights over the areoid) —
  <https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg064/>

NASA data, public domain (NASA PDS Geosciences Node). The raw grids (1 GB) stay out of the repository, in
`assets/dem/`. They replace the texture pack's Moon normal map (offset by a texel from LOLA, its relief
weak) and Mars height map (an 8-bit copy of MOLA's).
