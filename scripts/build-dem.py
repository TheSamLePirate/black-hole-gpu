"""
The Moon's and Mars's height maps, from their laser altimeters (NASA PDS, public domain):
  the Moon: LRO LOLA's LDEM_64 (64 pixels a degree, 474 m; height = DN × 0.5 m over the 1 737.4 km sphere)
    https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_64.img (531 MB)
  Mars: MGS MOLA's MEGDR topography at 64 pixels a degree (925 m; metres over the areoid), in four tiles
    https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg064/megt{00n000,00n180,90n000,90n180}gb.img
    (133 MB each)
  Venus: Magellan's altimetry (GTDR, USGS: 4 641 m a pixel, metres over a 6 051.0 km sphere — over the game's 6 051.8 km one,
    800 m less —, its gaps filled from the nearest measured; 8 % of it)
    https://planetarymaps.usgs.gov/mosaic/Venus_Magellan_Topography_Global_4641m_v02.tif (67 MB) → assets/dem/venus_topo_4641m.tif
  Mercury: MESSENGER's USGS global model (665 m, 64 pixels a degree; DN × 0.5 m over a 2 439.4 km sphere — over the game's
    2 439.7 km one, 300 m less)
    https://planetarymaps.usgs.gov/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif (531 MB) → assets/dem/mercury_dem_665m.tif
  Ceres: Dawn's HAMO model by the DLR (137 m, 60 pixels a degree; radii less 470 km), taken over its spheroid (482.07 ×
    445.93 km, fitted to it — server/moon-tiles.ts CERES_A, CERES_C: its relief tiles the same)
    https://planetarymaps.usgs.gov/mosaic/Ceres_Dawn_FC_HAMO_DTM_DLR_Global_60ppd_Oct2016.tif (467 MB)
    → assets/dem/ceres_hamo_dtm_60ppd.tif
  (kept in assets/dem/, not in the repository)

Outputs, assets/planets-hd/<body>-dem.bin: W × W/2, equirectangular like the colour maps (u = 0.5 + east
longitude/360°, v = 0.5 − lat/180°, texel centres), each texel the mean of the grid's cells it covers (box
filter), in the Earth's relief format (scripts/build-earth-relief.py: "ELV1", gzip; i16 heights [m], each
row's first value whole and the others as the difference from the one before, low bytes then high bytes).

usage: python3 scripts/build-dem.py [moon|mars|venus|mercury|ceres] [width]
"""
import gzip
import os
import struct
import sys

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.join(ROOT, "assets/dem")
OUT = os.path.join(ROOT, "assets/planets-hd")


def moon():
    z = np.fromfile(os.path.join(SRC, "ldem_64.img"), dtype="<i2").reshape(11520, 23040).astype(np.float32) * 0.5
    # (its columns from 0° east: rolled to start at 180° west, like the maps)
    return np.roll(z, 11520, axis=1)


def mars():
    t = lambda n: np.fromfile(os.path.join(SRC, f"megt{n}gb.img"), dtype=">i2").reshape(5760, 11520)
    z = np.block([[t("90n000"), t("90n180")], [t("00n000"), t("00n180")]]).astype(np.float32)
    return np.roll(z, 11520, axis=1)


def venus():
    import tifffile
    from scipy import ndimage as nd

    z = tifffile.imread(os.path.join(SRC, "venus_topo_4641m.tif")).astype(np.float32)
    gap = z < -32000
    idx = nd.distance_transform_edt(gap, return_distances=False, return_indices=True)
    z = z[idx[0], idx[1]]
    # (the filled gaps smoothed: their nearest-neighbour cells' edges gone)
    z = np.where(gap, nd.gaussian_filter(z, 3), z)
    # (its columns already from 180° west, east positive)
    return z - 800.0


def geotiff(name, data0, W, H):
    # (the USGS's GeoTIFFs: one little-endian int16 strip a row, rows contiguous from data0 — server/moon-tiles.ts DEM_SOURCES)
    z = np.memmap(os.path.join(SRC, name), dtype="<i2", mode="r", offset=data0, shape=(H, W))
    z = np.asarray(z).astype(np.float32)
    gap = z < -32000
    if gap.any():
        from scipy import ndimage as nd

        idx = nd.distance_transform_edt(gap, return_distances=False, return_indices=True)
        z = z[idx[0], idx[1]]
    # (its columns from 0° east: rolled to start at 180° west, like the maps)
    return np.roll(z, W // 2, axis=1)


def mercury():
    return geotiff("mercury_dem_665m.tif", 92981, 23040, 11520) * 0.5 - 300.0


CERES_A, CERES_C = 482074.8, 445930.7


def ceres():
    z = geotiff("ceres_hamo_dtm_60ppd.tif", 87217, 21600, 10800)
    lat = np.deg2rad(90.0 - (np.arange(z.shape[0]) + 0.5) / 60.0)
    ref = CERES_A * CERES_C / np.hypot(CERES_C * np.cos(lat), CERES_A * np.sin(lat)) - 470000.0
    return z - ref[:, None].astype(np.float32)


def write(name, z, W):
    H = W // 2
    h = np.asarray(Image.fromarray(z, mode="F").resize((W, H), Image.BOX), dtype=np.float32)
    q = np.round(h).astype(np.int32)
    d = q.copy()
    d[:, 1:] = q[:, 1:] - q[:, :-1]
    assert d.min() >= -32768 and d.max() <= 32767
    body = d.astype("<i2").view(np.uint8).reshape(-1, 2).T.copy().tobytes()
    data = struct.pack("<4sIII", b"ELV1", W, H, 0) + body
    path = os.path.join(OUT, f"{name}-dem.bin")
    with open(path, "wb") as o:
        o.write(gzip.compress(data, 9))
    print(name, W, H, "heights", q.min(), "…", q.max(), "→", round(os.path.getsize(path) / 1e6, 1), "MB")


if __name__ == "__main__":
    bodies = {"moon": moon, "mars": mars, "venus": venus, "mercury": mercury, "ceres": ceres}
    names = [sys.argv[1]] if len(sys.argv) > 1 else list(bodies)
    W = int(sys.argv[2]) if len(sys.argv) > 2 else 4096
    for n in names:
        write(n, bodies[n](), W)
