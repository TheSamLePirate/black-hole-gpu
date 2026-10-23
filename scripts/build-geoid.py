"""
The Earth's geoid for the game (src/system/geoid.ts): the undulation N of the EGM2008 geoid above the WGS84
ellipsoid [m], from GeographicLib's 5-minute grid (NGA's EGM2008, public domain; GeographicLib's PGM, MIT):
  egm2008-5.pgm, in https://sourceforge.net/projects/geographiclib/files/geoids-distrib/egm2008-5.tar.bz2
  (10 MB; kept out of the repository)

Output: assets/earth/geoid-egm2008-15.bin — 1440 × 720 (15′), equirectangular like the relief maps
(u = 0.5 + lon/360°, v = 0.5 − lat/180°, texel centres), each texel the 5′ grid read bilinearly at its
centre; the heights' file format (heights-file.ts, "ELV1", gzip) with N in **centimetres** (−10 691 … 8 574).
Read back bilinearly, it stays within 7 cm rms and 2.5 m at worst of the 5′ grid (the steepest trenches and
ridges; 0.6 m at the 99.9th percentile) — the 5′ grid itself is within 0.5 m of EGM2008's full expansion.

usage: python3 -I scripts/build-geoid.py path/to/egm2008-5.pgm
"""
import gzip
import os
import struct
import sys

import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = sys.argv[1]
OUT = os.path.join(ROOT, "assets/earth/geoid-egm2008-15.bin")
W, H = 1440, 720

raw = open(SRC, "rb").read()
offset = scale = None
i, fields = 0, []
while len(fields) < 3:
    j = raw.index(b"\n", i)
    line, i = raw[i:j], j + 1
    if line.startswith(b"# Offset"):
        offset = float(line.split()[2])
    elif line.startswith(b"# Scale"):
        scale = float(line.split()[2])
    elif not line.startswith(b"#"):
        fields.append(line)
gw, gh = map(int, fields[1].split())
assert fields[0] == b"P5" and offset is not None and scale is not None
grid = np.frombuffer(raw[i : i + gw * gh * 2], dtype=">u2").reshape(gh, gw).astype(np.float64) * scale + offset
# (the grid's points: 90° N to 90° S, longitudes 0° to 360° − step; wrapped once for the interpolation)
grid = np.concatenate([grid, grid[:, :1]], axis=1)
step = 360 / gw

lat = 90 - (np.arange(H) + 0.5) * 180 / H
lon = -180 + (np.arange(W) + 0.5) * 360 / W
gy = (90 - lat) / step
gx = np.mod(lon, 360) / step
y0 = np.minimum(np.floor(gy).astype(int), gh - 2)
x0 = np.floor(gx).astype(int)
fy = (gy - y0)[:, None]
fx = (gx - x0)[None, :]
n = (grid[y0][:, x0] * (1 - fx) + grid[y0][:, x0 + 1] * fx) * (1 - fy) + (grid[y0 + 1][:, x0] * (1 - fx) + grid[y0 + 1][:, x0 + 1] * fx) * fy

q = np.round(n * 100).astype(np.int32)
d = q.copy()
d[:, 1:] = q[:, 1:] - q[:, :-1]
assert d.min() >= -32768 and d.max() <= 32767 and q.min() >= -32768 and q.max() <= 32767
body = d.astype("<i2").view(np.uint8).reshape(-1, 2).T.copy().tobytes()
with open(OUT, "wb") as o:
    o.write(gzip.compress(struct.pack("<4sIII", b"ELV1", W, H, 0) + body, 9))
print(f"geoid {W}×{H}: N {q.min() / 100} … {q.max() / 100} m → {os.path.getsize(OUT) / 1e6:.2f} MB")
