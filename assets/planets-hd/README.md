# The solar system's worlds up close

Streamed in by `src/system/hd-maps.ts` for the body near the camera (within 40 of its radii): its colour
map (`<body>-color.jpg`: 8192 wide for the Moon and Mars, 4096 or 2048 for the others) and its relief —
a normal map (`<body>-normal.jpg`: red east, green south) or a height map from which the normals are
computed on the GPU (`<body>-height.jpg`: Mars, Mercury).

Source: the texture pack in `assets/tex/base` (its `<body>-ultra/high/med.jpg`, `<body>-normal-*.jpg`,
`<body>-height-*.jpg`), derived from NASA/USGS/JPL mission imagery (Lunar Reconnaissance Orbiter, MGS/
Viking, MESSENGER, Galileo, Cassini, New Horizons, Dawn).
