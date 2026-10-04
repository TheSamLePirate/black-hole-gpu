"""
The Moon's and Mars's height maps, from their laser altimeters (NASA PDS, public domain):
  the Moon: LRO LOLA's LDEM_64 (64 pixels a degree, 474 m; height = DN × 0.5 m over the 1 737.4 km sphere)
    https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_64.img (531 MB)
  Mars: MGS MOLA's MEGDR topography at 64 pixels a degree (925 m; metres over the areoid), in four tiles
    https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg064/megt{00n000,00n180,90n000,90n180}gb.img
    (133 MB each)
  (kept in assets/dem/, not in the repository)

Outputs, assets/planets-hd/<body>-dem.bin: W × W/2, equirectangular like the colour maps (u = 0.5 + east
longitude/360°, v = 0.5 − lat/180°, texel centres), each texel the mean of the grid's cells it covers (box
filter), in the Earth's relief format (scripts/build-earth-relief.py: "ELV1", gzip; i16 heights [m], each
row's first value whole and the others as the difference from the one before, low bytes then high bytes).

usage: python3 scripts/build-dem.py [moon|mars] [width]
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
    bodies = {"moon": moon, "mars": mars}
    names = [sys.argv[1]] if len(sys.argv) > 1 else list(bodies)
    W = int(sys.argv[2]) if len(sys.argv) > 2 else 4096
    for n in names:
        write(n, bodies[n](), W)
