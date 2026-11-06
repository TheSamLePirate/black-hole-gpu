#!/usr/bin/env python3
"""The USGS imagery's colours brought to the rest of the Earth's (RECHERCHE-DONNEES lot D; earth-tiles.ts USA_FIT).

Per channel, a 256-entry table matching the USGS tiles' (The National Map's USGSImageryOnly, NAIP-based) histogram to EOX's
Sentinel-2 cloudless 2021 as the game shows it (tile-decode.ts eoxColour, reproduced here exactly), on the same z 14 tiles of
24 places across the contiguous states (fields, forests, deserts, mountains, towns, coasts): their distributions matched — the
surveys' dates and seasons differ, no pixel's twin. Monotone, smoothed. Prints the table as TypeScript.

  python3 -I scripts/fit-usgs-colour.py > /tmp/usa-lut.ts
"""
import io, math, subprocess, sys
import numpy as np
from PIL import Image

PLACES = {
    "iowa-fields": (42.0, -93.6), "kansas-fields": (38.5, -98.0), "central-valley": (36.8, -119.8), "texas-hill": (30.3, -98.9),
    "oregon-forest": (44.0, -122.2), "cascades": (47.5, -121.5), "appalachians": (35.6, -83.4), "maine-woods": (45.3, -69.4),
    "phoenix-desert": (33.6, -112.4), "nevada-basin": (39.0, -117.0), "mojave": (35.0, -116.0), "utah-canyons": (38.3, -110.2),
    "grand-canyon": (36.1, -112.1), "rockies": (39.6, -105.9), "yellowstone": (44.6, -110.5), "everglades": (25.9, -80.9),
    "mississippi-delta": (32.5, -90.9), "chesapeake": (38.7, -76.4), "chicago-suburbs": (41.9, -88.0), "atlanta": (33.8, -84.4),
    "denver": (39.74, -104.99), "minnesota-lakes": (46.8, -94.4), "north-dakota": (47.4, -100.8), "carolina-pines": (34.2, -79.0),
}
G = np.array([0.894, 1.548, 3.877])
P = np.array([0.959, 1.205, 1.487])


def tile(lat, lon, z):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)


def get(url):
    data = subprocess.run(["curl", "-s", "-m", "40", url], capture_output=True).stdout
    return np.asarray(Image.open(io.BytesIO(data)).convert("RGB"), dtype=np.uint8)


def lin(v):
    v = v / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def srgb8(v):
    v = np.clip(v, 0, 1)
    s = np.where(v <= 0.0031308, v * 12.92, 1.055 * v ** (1 / 2.4) - 0.055)
    return np.round(255 * s).astype(np.int64)


def eox_colour(px):
    """tile-decode.ts eoxWord: per channel b = g·e^k in linear light for the darker ground, the bright left as it is"""
    e = lin(px.astype(np.float64))
    L = e @ np.array([0.2126, 0.7152, 0.0722])
    t = np.clip((L - 0.06) / 0.29, 0, 1)
    t = t * t * (3 - 2 * t)
    f = np.minimum(1, G * e ** P)
    return srgb8(f * (1 - t[..., None]) + e * t[..., None])


src, dst = [], []
for name, (la, lo) in PLACES.items():
    x, y = tile(la, lo, 14)
    u = get(f"https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/14/{y}/{x}")
    e = get(f"https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/14/{y}/{x}.jpg")
    src.append(u.reshape(-1, 3))
    dst.append(eox_colour(e).reshape(-1, 3))
    print(f"// {name}: USGS mean {u.reshape(-1, 3).mean(0).round(1)}, EOX as shown {dst[-1].mean(0).round(1)}", file=sys.stderr)
S = np.vstack(src)
T = np.vstack(dst)
lut = []
for c in range(3):
    hs = np.bincount(S[:, c], minlength=256).astype(np.float64)
    ht = np.bincount(T[:, c], minlength=256).astype(np.float64)
    cs = np.cumsum(hs) / hs.sum()
    ct = np.cumsum(ht) / ht.sum()
    m = np.interp(cs, ct, np.arange(256))
    # (smoothed over ±3 levels, then monotone; 0 kept 0's neighbour — the decoder's "no image" is r 0)
    k = np.ones(7) / 7
    m = np.convolve(np.pad(m, 3, mode="edge"), k, mode="valid")
    m = np.maximum.accumulate(np.clip(np.round(m), 0, 255))
    lut.append(m.astype(int))
out = np.concatenate(lut)
fitted = np.stack([lut[c][S[:, c]] for c in range(3)], 1)
print(f"// means: USGS {S.mean(0).round(1)}, target {T.mean(0).round(1)}, fitted {fitted.mean(0).round(1)}", file=sys.stderr)
print("export const USA_LUT = Uint8Array.from([")
for i in range(0, 768, 32):
    print("  " + ", ".join(str(v) for v in out[i : i + 32]) + ",")
print("]);")
