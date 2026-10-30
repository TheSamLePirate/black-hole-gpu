"""
The texture pack's maps of seven worlds set right on the game's axes (PLAN-PLANETES-AAA P8 A4): a moon's longitude 0 towards
its planet, east positive (solar.ts bodyAxes), Pluto's IAU's — the USGS's mosaics' (its WMS, east longitudes; checked on
named features: Callisto's Valhalla at 56° W, Mimas's Herschel at 112° W, Rhea's wispy trailing side about 90° E, Pluto's
Sputnik Planitia about 175° E, Phobos's Stickney south of the equator).

Each map compared with the USGS's mosaic of its world (gradient magnitudes, every turn and both flips — the scores in
docs/progress/planetes-aaa/P8.md):
  Callisto      turned 173.2° east (its pack map centred elsewhere)
  Enceladus, Rhea, Mimas, Pluto
                turned 180° (centred on 180° instead of 0°)
  Phobos        north and south swapped
  Deimos        both (its coarse map only turned: it was not flipped)
Europa, Io, Ganymede, Dione and Tethys already matched (their peaks at 0 px).

Read from the commit before the change (cf85871c: running it twice does not turn them twice); a flipped normal map's
green (south) negated. The coarse maps' KTX2 copies redone after (bun scripts/build-ktx2.ts would redo every planet:
basisu on the seven alone, below); their mean albedos unchanged (a turn or a flip keeps the mean).

usage: python3 scripts/fix-moon-maps.py
"""
import io
import os
import subprocess

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
REV = "cf85871c"
FIX = {
    "callisto": (173.23, False),
    "enceladus": (180.0, False),
    "rhea": (180.0, False),
    "mimas": (180.0, False),
    "pluto": (180.0, False),
    "phobos": (0.0, True),
    "deimos": (180.0, True),
}


def original(path):
    data = subprocess.run(["git", "-C", ROOT, "show", f"{REV}:{path}"], check=True, capture_output=True).stdout
    return Image.open(io.BytesIO(data)).convert("RGB")


def fix(path, deg, flip, normal):
    a = np.asarray(original(path)).copy()
    if flip:
        a = a[::-1].copy()
        if normal:
            a[..., 1] = 255 - a[..., 1]
    a = np.roll(a, int(round(deg / 360 * a.shape[1])), axis=1)
    Image.fromarray(a).save(os.path.join(ROOT, path), quality=92)
    print(path, a.shape[1], "×", a.shape[0], f"turned {deg}°", "flipped" if flip else "")


UASTC = ["-uastc", "-uastc_level", "1", "-uastc_rdo_l", "1.0", "-ktx2", "-ktx2_zstandard_level", "18", "-mipmap"]
for name, (deg, flip) in FIX.items():
    for kind, normal in (("color", False), ("normal", True)):
        p = f"assets/planets-hd/{name}-{kind}.jpg"
        if os.path.exists(os.path.join(ROOT, p)):
            fix(p, deg, flip, normal)
    # (Deimos's coarse map: not flipped like its finer one)
    fix(f"assets/planets/{name}.jpg", deg, flip and name != "deimos", False)
    subprocess.run(
        ["basisu", *UASTC, "-resample", "1024", "512", "-output_file", f"assets/planets/ktx2/{name}.ktx2", f"assets/planets/{name}.jpg"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
