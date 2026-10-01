"""
The Earth's height map for the tracer, from NOAA's ETOPO 2022 (60 arc-second surface elevation, the
ice sheets' surface, bathymetry; public domain):
  ETOPO_2022_v1_60s_N90W180_surface.nc
  https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc
  (478 MB, kept in assets/etopo/, not in the repository)

Outputs, assets/earth/:
  relief-high.bin  8192 × 4096   (4.9 km a texel at the equator)
  relief-med.bin   4096 × 2048
equirectangular (u = 0.5 + lon/360°, v = 0.5 − lat/180°, texel centres), each texel the mean of the
grid's cells it covers (area-weighted: PIL's box filter), the sea floor left out (the tracer draws the
sea at 0: a third of the size). Format (gzip): u32 magic "ELV1", width, height, 0, then the i16 heights
[m] row by row, each row's first value whole and the others as the difference from the one before,
little-endian, in two planes: all the low bytes, then all the high bytes (gzip packs the small
differences far better: 10.6 MB for the high map).

usage: python3 scripts/build-earth-relief.py [path to the .nc]
"""
import gzip
import os
import struct
import sys

import h5py
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "assets/etopo/ETOPO_2022_v1_60s_N90W180_surface.nc")
OUT = os.path.join(ROOT, "assets/earth")

with h5py.File(SRC, "r") as f:
    lat = f["lat"][:]
    lon = f["lon"][:]
    z = f["z"][:].astype(np.float32)
print("grid", z.shape, "lat", lat[0], "…", lat[-1], "lon", lon[0], "…", lon[-1], "z", z.min(), "…", z.max())
# (the grid's rows south to north: flipped, the north at the top like the maps)
if lat[0] < lat[-1]:
    z = z[::-1]
assert abs(lon[0] + 180 - 0.5 * (lon[1] - lon[0])) < 1e-6, "cells centred from −180°"

img = Image.fromarray(z, mode="F")
for name, W in (("high", 8192), ("med", 4096)):
    H = W // 2
    h = np.asarray(img.resize((W, H), Image.BOX), dtype=np.float32)
    q = np.maximum(np.round(h), 0).astype(np.int32)
    d = q.copy()
    d[:, 1:] = q[:, 1:] - q[:, :-1]
    assert d.min() >= -32768 and d.max() <= 32767
    body = d.astype("<i2").view(np.uint8).reshape(-1, 2).T.copy().tobytes()
    data = struct.pack("<4sIII", b"ELV1", W, H, 0) + body
    path = os.path.join(OUT, f"relief-{name}.bin")
    with open(path, "wb") as o:
        o.write(gzip.compress(data, 9))
    print(name, W, H, "heights", q.min(), "…", q.max(), "→", os.path.getsize(path) / 1e6, "MB")
