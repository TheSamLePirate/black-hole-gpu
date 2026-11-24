"""The traffic's plain airliners' colour maps made plain white (src/traffic/livery.ts — Sam, 24 Nov 2026: each airline's colours,
no trade dress): the supplied A320's map (assets/traffic/a320.jpg — Airbus's rollout scheme: its blue, red, orange and yellow
sweep, its « A320 » titles, its F-WWBA registration, « AIRBUS INDUSTRIE ») and the CRJ-900's (assets/traffic/crj900.jpg —
CityJet's: its maroon and tan cheatlines, its « CITYJET » titles on the fuselage and the fin) painted over with the white of the
airframe about them; the windows, doors, panel lines, small markings and every thin line kept (a colour's area thinner than
~6 px at 2048² is not paint: an opening of the mask leaves it). The livery's colours are laid on by the craft's shader
(ship.wgsl trafficPaint) over this white.

    python3 scripts/whiten-airliner-maps.py            (rewrites both maps in place — run after scripts/build-airliners.ts)
"""

import sys

import numpy as np
from PIL import Image
from scipy import ndimage

OUT = "assets/traffic"


def hsv(a):
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return h, sat, mx


def paper(a, mask):
    """the airframe's white about the paint: the median of the bright, plain texels"""
    h, s, v = hsv(a)
    ok = (~mask) & (s < 0.06) & (v > 0.85)
    return np.median(a[ok], axis=0)


def whiten(name, colour_mask, rects, keep=lambda a: np.zeros(a.shape[:2], bool), opening=3):
    im = Image.open(f"{OUT}/{name}.jpg").convert("RGB")
    a = np.asarray(im).astype(np.float32) / 255
    h, s, v = hsv(a)
    m = colour_mask(a)
    # (a paint's area, not a line: what an opening leaves)
    if opening:
        m = ndimage.binary_opening(m, iterations=opening)
    # (the titles' and registrations' boxes: every texel in them not the white's)
    for x0, y0, x1, y1 in rects:
        box = np.zeros_like(m)
        box[y0:y1, x0:x1] = True
        m |= box & ((v < 0.93) | (s > 0.08))
    k = keep(a)
    # (grown over its soft edge — the texels still tinted by it, not the windows' greys nor their dark glass)
    for _ in range(5):
        m |= ndimage.binary_dilation(m) & (s > 0.06) & (v > 0.45) & ~k
    # (and its last ring of greys — the letters' antialiasing, the map's compression about them: two texels)
    m |= ndimage.binary_dilation(m, iterations=2) & (v > 0.45) & (v < 0.86) & ~k
    m = ndimage.binary_dilation(m, iterations=1) & ~k
    # (the white about each painted place: the plain texels' mean along its row — the maps' fuselages lie along their rows, their
    # shading round the fuselage down their columns: kept —, within ~60 texels, else ~250, else the map's white)
    p = paper(a, m)
    plain = (~m) & (s < 0.08) & (v > 0.6) & ~k
    local = np.broadcast_to(p, a.shape).copy()
    for sigma in (250, 60):
        num = np.stack([ndimage.gaussian_filter1d(a[..., c] * plain, sigma, axis=1) for c in range(3)], axis=2)
        den = ndimage.gaussian_filter1d(plain.astype(np.float32), sigma, axis=1)[..., None]
        local = np.where(den > 0.05, num / np.maximum(den, 1e-6), local)
    # (the edges eased: the paint's border blurred into the white over a texel; what is kept, kept)
    soft = np.maximum(ndimage.gaussian_filter(m.astype(np.float32), 0.8), m)[..., None]
    out = a * (1 - soft) + local * soft
    out[k] = a[k]
    Image.fromarray(np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8)).save(f"{OUT}/{name}.jpg", quality=90)
    print(f"{name}: {int(m.sum())} texels painted white ({100 * m.mean():.1f} %), the white {np.round(p * 255).astype(int).tolist()}")


# ---- the A320: its sweep and titles — coloured (saturated) texels, not the map's lavender ground about its pieces
LAVENDER = np.array([150, 150, 200]) / 255


def a320_mask(a):
    h, s, v = hsv(a)
    ground = np.abs(a - LAVENDER).max(axis=2) < 0.1
    return (s > 0.45) & (v > 0.12) & ~ground


def a320_keep(a):
    # (the lavender ground and the green markers about the pieces: untouched)
    return np.abs(a - LAVENDER).max(axis=2) < 0.1


A320_RECTS = [
    (740, 965, 870, 1005),  # F-WWBA, the left side
    (740, 1155, 870, 1195),  # F-WWBA, the right side
    (110, 1495, 230, 1545),  # AIRBUS INDUSTRIE, the left side
    (110, 1880, 230, 1925),  # AIRBUS INDUSTRIE, the right side
]

# ---- the CRJ-900: its cheatlines and the JET of its titles (maroon, tan: red to orange hues), the CITY of its titles (a dark grey)
# in their boxes; its windows (blue) kept


def crj_mask(a):
    h, s, v = hsv(a)
    warm = (h < 45) | (h > 320)
    return warm & (s > 0.14) & (v > 0.2) & (v < 0.95)


def crj_keep(a):
    h, s, v = hsv(a)
    return (h > 170) & (h < 250) & (s > 0.15)


CRJ_RECTS = [
    (95, 585, 290, 725),  # the fin's title, the left side
    (1515, 730, 1735, 780),  # the fuselage's title, the left side
    (315, 1140, 530, 1190),  # the fuselage's title, the right side
    (1755, 980, 1935, 1135),  # the fin's title, the right side
]

if __name__ == "__main__":
    which = sys.argv[1:] or ["a320", "crj900"]
    if "a320" in which:
        whiten("a320", a320_mask, A320_RECTS, a320_keep)
    if "crj900" in which:
        whiten("crj900", crj_mask, CRJ_RECTS, crj_keep, opening=0)
