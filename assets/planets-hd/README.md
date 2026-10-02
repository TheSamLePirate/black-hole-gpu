# The solar system's worlds up close

Streamed in by `src/system/hd-maps.ts` for the body near the camera, once its coarse map's texel outgrows a
pixel under it (within ~4 of its radii at a 60° view; freed beyond twice that — `src/renderer.ts`), one
body at a time: its colour map (`<body>-color.jpg`: 8192 wide for the Moon and Mars, 6000 for Jupiter,
4096 for most, 2048 for Ceres and Phobos, 1600 for Mimas), its brightness kept to the coarse map's mean,
and its relief — a normal map (`<body>-normal.jpg`: red east, green south) or a height map from which the normals are
computed on the GPU (`<body>-height.jpg`: Mars, Mercury); Jupiter and Saturn have colour only.

These stay JPEG: the coarser maps of `assets/planets` have GPU-compressed KTX2 copies
(`scripts/build-ktx2.ts`), but 8K maps in UASTC would add hundreds of MB to the repository.

Source: the texture pack in `assets/tex/base` (local, git-ignored) (its `<body>-ultra/high/med.jpg`, `<body>-normal-*.jpg`,
`<body>-height-*.jpg`), derived from NASA/USGS/JPL mission imagery (Lunar Reconnaissance Orbiter, MGS/
Viking, MESSENGER, Galileo, Cassini, New Horizons, Dawn).
