"""
Enceladus's and Callisto's finer colour maps (PLAN-PLANETES-AAA P8 A4): they had none — their 1024-wide coarse maps alone up
close. The USGS's global mosaics (Cassini ISS's of Enceladus, 100 m; Voyager and Galileo SSI's of Callisto, 1 km), grey,
taken from its WMS at 4096 × 2048 in east longitudes (the game's axes: scripts/fix-moon-maps.py) and kept in assets/dem/:
  https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/saturn/enceladus_simp_cyl.map&service=WMS&version=1.1.1
    &request=GetMap&layers=CASSINI_100m&styles=&srs=EPSG:4326&bbox=-180,-90,180,90&width=4096&height=2048&format=image/png
    → assets/dem/enceladus_usgs_wms_4096.png
  (callisto: jupiter/callisto_simp_cyl.map, layer GALILEO_VOYAGER → assets/dem/callisto_usgs_wms_4096.png)
The colour the coarse map's (set right by fix-moon-maps.py), its detail the mosaic's over its own mean round it (a ratio, 0.5
… 2) — the mosaic's seams between its image sets evened out first, column by column —, the mosaic's gaps — Callisto's
poles, black — the colour alone.

usage: python3 scripts/build-moon-hd.py
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.join(os.path.dirname(__file__), "..")
for name in ("enceladus", "callisto"):
    g = np.asarray(Image.open(os.path.join(ROOT, f"assets/dem/{name}_usgs_wms_4096.png")).convert("L"), dtype=np.float32)
    H, W = g.shape
    gap = g < 4
    # (the mosaic's seams between its image sets — Callisto's Voyager and Galileo, a step down a whole meridian —: each column
    # brought to the mean of its neighbours', over its measured texels, in eight bands of latitude)
    for b in range(8):
        rows = slice(b * H // 8, (b + 1) * H // 8)
        gb, ok = g[rows], ~gap[rows]
        col = (gb * ok).sum(0) / np.maximum(ok.sum(0), 1)
        has = ok.sum(0) > 4
        col = np.where(has, col, np.nan)
        x = np.arange(W)
        col = np.interp(x, x[has], col[has], period=W) if has.any() else np.ones(W)
        ref = nd.uniform_filter1d(col, 81, mode="wrap")
        g[rows] = np.where(ok, gb * (ref / np.maximum(col, 1))[None, :], gb)
    w = nd.gaussian_filter((~gap).astype(np.float32), 24)
    mean = nd.gaussian_filter(np.where(gap, 0, g), 24) / np.maximum(w, 1e-3)
    ratio = np.where(gap | (w < 0.5), 1.0, np.clip(g / np.maximum(mean, 1), 0.5, 2.0))
    # (the gaps' edges eased: no seam where the detail stops)
    ratio = 1 + (ratio - 1) * np.clip((w - 0.5) / 0.4, 0, 1)
    c = np.asarray(Image.open(os.path.join(ROOT, f"assets/planets/{name}.jpg")).convert("RGB").resize((W, H), Image.BICUBIC), dtype=np.float32)
    out = np.clip(c * ratio[..., None], 0, 255).astype(np.uint8)
    Image.fromarray(out).save(os.path.join(ROOT, f"assets/planets-hd/{name}-color.jpg"), quality=90)
    print(name, W, H, "detail ratio", float(ratio.min()), "…", float(ratio.max()))
