"""
Ceres's colour maps (PLAN-PLANETES-AAA P8): the texture pack's was not Ceres (an invented map, no craters) — Dawn's global
mosaic now, its baked shading taken off with Dawn's relief.

  the mosaic: Dawn FC's global clear-filter mosaic by the DLR (20.5 pixels a degree, 400 m; 8-bit, columns from 0° east)
    https://planetarymaps.usgs.gov/mosaic/Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif (27 MB) → assets/dem/ceres_fc_20ppd.tif
  the relief: Dawn's HAMO model (scripts/build-dem.py ceres's source, assets/dem/ceres_hamo_dtm_60ppd.tif)

Its shading: the mosaic's grey regressed, block by block (each frame its own Sun), on the relief's east and north slopes at
the mosaic's texels; that linear part (the blocks' coefficients smoothed) taken off; the polar gaps (no light) filled, and
the map eased past 70°, towards its ground's mean round them (the low Sun's shadows there unresolved: the relief shades them). Then a neutral grey (Ceres's spectrum is flat), at the
coarse map's brightness (the page keeps it: hd-maps.ts mean).

Outputs: assets/planets-hd/ceres-color.jpg (4096 × 2048) and assets/planets/ceres.jpg (1024 × 512, its KTX2 copy by
bun scripts/build-ktx2.ts planets).

usage: python3 scripts/build-ceres-color.py
"""
import os

import numpy as np
import tifffile
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.join(os.path.dirname(__file__), "..")
SRC = os.path.join(ROOT, "assets/dem")

m = tifffile.imread(os.path.join(SRC, "ceres_fc_20ppd.tif")).astype(np.float32)
H, W = m.shape
z = np.memmap(os.path.join(SRC, "ceres_hamo_dtm_60ppd.tif"), dtype="<i2", mode="r", offset=87217, shape=(10800, 21600))
z = np.asarray(z).astype(np.float32)
z[z < -32000] = 0
z = np.asarray(Image.fromarray(z).resize((W, H), Image.BOX), dtype=np.float32)
# (the slopes [m/m]: a texel 400 m north–south, 400 cos(lat) east–west)
lat = np.deg2rad(90.0 - (np.arange(H) + 0.5) * 180.0 / H)
px = 2 * np.pi * 470000.0 / W
sx = np.gradient(z, axis=1) / (px * np.maximum(np.cos(lat), 0.05)[:, None])
sy = -np.gradient(z, axis=0) / px

gap = m < 2
hp = lambda a: a - nd.gaussian_filter(a, 12)
I, X, Y = hp(m), hp(sx), hp(sy)
B = 48
by, bx = H // B + 1, W // B + 1
cb = np.zeros((by, bx), np.float32)
cc = np.zeros((by, bx), np.float32)
for j in range(by):
    for i in range(bx):
        s = (slice(j * B, (j + 1) * B), slice(i * B, (i + 1) * B))
        ok = ~gap[s]
        if ok.sum() < B * B // 3:
            continue
        A = np.stack([X[s][ok], Y[s][ok]], 1)
        sol, *_ = np.linalg.lstsq(A, I[s][ok], rcond=None)
        cb[j, i], cc[j, i] = sol
cb = nd.gaussian_filter(cb, 1.0)
cc = nd.gaussian_filter(cc, 1.0)
fb = np.asarray(Image.fromarray(cb).resize((W, H), Image.BILINEAR))
fc = np.asarray(Image.fromarray(cc).resize((W, H), Image.BILINEAR))
a = m - (fb * sx + fc * sy)
print("shading taken off: rms", float(np.sqrt(np.mean((fb * sx + fc * sy)[~gap] ** 2))), "of", float(m[~gap].std()))
# (the gaps — the poles' night —, and the low Sun's unresolved shadows round them: past 70° the map eased towards its
# ground's mean over 62–70° in that hemisphere, all of it past 82°)
deg = np.rad2deg(lat)[:, None] * np.ones((1, W))
ring = lambda lo, hi: float(np.mean(a[(deg >= lo) & (deg <= hi) & ~gap]))
L = np.where(deg > 0, ring(62, 70), ring(-70, -62))
k = np.clip((np.abs(deg) - 70.0) / 12.0, 0, 1)
k = k * k * (3 - 2 * k)
a = np.where(gap, L, a * (1 - k) + L * k)
a = np.clip(a, 1, 255)
a = np.roll(a, W // 2, axis=1)
# (its brightness: the mosaic's own scale — the page sets the body's)
g = np.clip(a / np.percentile(a, 99.5) * 235.0, 0, 255).astype(np.uint8)
img = Image.fromarray(g).convert("RGB")
img.resize((4096, 2048), Image.LANCZOS).save(os.path.join(ROOT, "assets/planets-hd/ceres-color.jpg"), quality=92)
img.resize((1024, 512), Image.LANCZOS).save(os.path.join(ROOT, "assets/planets/ceres.jpg"), quality=92)
print("ceres colour → assets/planets-hd/ceres-color.jpg, assets/planets/ceres.jpg")
