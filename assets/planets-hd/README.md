# The solar system's worlds up close

Streamed in by `src/system/hd-maps.ts` for the body near the camera, once its coarse map's texel outgrows a
pixel under it (within ~4 of its radii at a 60° view; freed beyond twice that — `src/renderer.ts`), one
body at a time: its colour map (`<body>-color.jpg`: 8192 wide for the Moon and Mars, 4096 for Jupiter's fallback,
4096 for most — Ceres's too, Dawn's —, 2048 for Phobos, 1600 for Mimas), its brightness kept to the coarse map's mean,
and its relief: for the Moon, Mars, Venus, Mercury and Ceres their measured heights (`<body>-dem.bin`, below) — the ground
drawn, stood on and lit, its normals taken from them —; elsewhere a normal map (`<body>-normal.jpg`: red
east, green south) or a height map from which the normals are computed on the GPU (`<body>-height.jpg`: none
now); Jupiter and Saturn have colour only.

Except for Jupiter (below), these stay JPEG: the coarser maps of `assets/planets` have GPU-compressed KTX2 copies
(`scripts/build-ktx2.ts`), but 8K maps in UASTC would add hundreds of MB to the repository.

Source: the texture pack in `assets/tex/base` (local, git-ignored) (its `<body>-ultra/high/med.jpg`, `<body>-normal-*.jpg`,
`<body>-height-*.jpg`), derived from NASA/USGS/JPL mission imagery (Lunar Reconnaissance Orbiter, MGS/
Viking, MESSENGER, Galileo, Cassini, New Horizons, Dawn).

## Jupiter: Cassini + Juno

`jupiter-color.ktx2`: 8192 × 4096 UASTC with all 14 mip levels, transcoded in a worker to native
BC7 or ASTC 4×4 sRGB. The complete GPU colour texture occupies about 42.7 MiB, uploaded directly
without a full-resolution RGBA staging texture or a runtime compression pass. It is a 32 MB download
and ~96 MB of transcoder heap while it decodes (the worker is terminated once idle), so only hardware
tiers ≥ 2 fetch it; lower tiers (phones, weak GPUs, ≤ 4 GB devices), devices without these
compression formats or with a smaller texture limit, and failed compressed uploads use the 4096 × 2048
JPEG. A compressed-path failure is recorded as `jupiter-hd-fallback` in GPU diagnostics and not retried
for the session. The Service Worker keeps it, like every hashed asset, cache-first.
Only the nearby body's HD map is resident; the existing unload distance still applies.

Source: Björn Jónsson's [merged Cassini and Juno global map](https://www.planetary.org/space-images/merged-cassini-and-juno),
14400 × 7200 equirectangular, including Juno's polar observations.
Credit: NASA / JPL-Caltech / SSI / Southwest Research Institute / Malin Space Science Systems /
Italian Space Agency (ASI) / Italian National Institute for Astrophysics (INAF) / JIRAM / Björn Jónsson.
Licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
Changes: Lanczos resizing, JPEG/UASTC compression and mip generation; no synthetic cloud detail.
The source's orientation is preserved in both the 2K coarse map and the HD maps, so cloud features
stay aligned when HD streaming finishes. This is a historical composite, not Jupiter's current weather.

Rebuild with `PYTHON=/path/to/python-with-Pillow bun scripts/build-jupiter.ts` (requires `basisu`).
The original and intermediate PNGs stay in git-ignored `assets/tex`; `jupiter.json` records the source
URL, SHA-256, dimensions and area-weighted linear luminance used by the renderer.
The shader computes each map's mip level from the **unclamped** angular pixel footprint: clamping
the 2K level before scaling to HD had previously prevented the finest HD mips from being sampled.
At extreme proximity, the map still has finite resolution (about 55 km per equatorial 8K texel).

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

## Mercury's and Ceres's heights, Ceres's map (PLAN-PLANETES-AAA P8)

`mercury-dem.bin` and `ceres-dem.bin`: 2048 × 1024 (3.7 and 1.4 km a texel: their tiles finer round the camera), `python3 scripts/build-dem.py mercury|ceres`, from

- Mercury: **MESSENGER**'s USGS global model, 665 m (heights over a 2 439.4 km sphere; here over the game's 2 439.7 km) —
  <https://planetarymaps.usgs.gov/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif>
- Ceres: **Dawn**'s HAMO model by the DLR, 137 m, taken over its spheroid (482.07 × 445.93 km, fitted to it) —
  <https://planetarymaps.usgs.gov/mosaic/Ceres_Dawn_FC_HAMO_DTM_DLR_Global_60ppd_Oct2016.tif>

Their finer relief streams in tiles from the room server (server/moon-tiles.ts), Mercury's albedo detail from MESSENGER's
low-incidence mosaic (Mercury Trek).

`ceres-color.jpg` (and `../planets/ceres.jpg`, its KTX2 copy): the texture pack's map was not Ceres (an invented one, no
craters). Now **Dawn FC**'s global mosaic by the DLR (400 m, <https://planetarymaps.usgs.gov/mosaic/Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif>),
its baked shading taken off with Dawn's relief, its polar night filled — `python3 scripts/build-ceres-color.py`. Its
normal map (flat) is gone: the heights give the relief. NASA/JPL-Caltech/UCLA/MPS/DLR/IDA, public domain.

## The moons set right (PLAN-PLANETES-AAA P8 A4)

The pack's maps of Callisto (173.2°), Enceladus, Rhea, Mimas, Pluto (180°), Phobos (north and south swapped) and Deimos
(both; its coarse map turned only) were not on the game's axes — a moon's longitude 0 towards its planet, east positive;
Pluto's IAU — and are turned or flipped by `python3 scripts/fix-moon-maps.py` (from their originals at cf85871c; flipped
normal maps' green negated). `callisto-color.jpg` and `enceladus-color.jpg` (4096 × 2048, new): their coarse maps' colour
with the USGS's global mosaics' detail (Cassini ISS 100 m; Voyager–Galileo SSI 1 km, via its WMS, kept in assets/dem/) —
`python3 scripts/build-moon-hd.py`. USGS / NASA / JPL-Caltech / SSI, public domain.
