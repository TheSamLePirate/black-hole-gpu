"""
Q7 L8 / VIPER B3 — the ground's detail scans (docs/progress/refraction-horizons/Q7.md, "L8"): five CC0 materials from ambientCG
(grass, soil, gravel, rock, asphalt; their 1K JPG downloads, kept outside the repository: ~/.kerr-lab/detail-scans/zips) into one
small image each — 512² RGBA, linear: R the luminance's ratio to the scan's own mean (halved: 0–2 → 0–1; the photograph's hue and
mean kept, only its detail added), G B the tangent-space normal's x and y (0.5 the flat), A 1 —, then basisu (UASTC, linear,
mip-mapped, Zstandard) to assets/detail/<name>.ktx2, the page's KTX2 path (src/system/ktx2.ts).

  python3 scripts/build-detail-scans.py [zips dir] [out dir]

Each zip is read in place (no file in it executed: images only).
"""
import io, os, subprocess, sys, zipfile
import numpy as np
from PIL import Image

ZIPS = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/.kerr-lab/detail-scans/zips")
OUT = sys.argv[2] if len(sys.argv) > 2 else "assets/detail"
TMP = os.path.expanduser("~/.kerr-lab/detail-scans/png")
SIDE = 512
# (the game's order: shadeLite's DETAIL_* — grass, soil, gravel, rock, asphalt)
MATERIALS = [("grass", "Grass004"), ("soil", "Ground054"), ("gravel", "Gravel022"), ("rock", "Rock035"), ("asphalt", "Asphalt012")]
os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)


def member(z, suffix):
    names = [n for n in z.namelist() if n.endswith(suffix)]
    if not names:
        raise SystemExit(f"{z.filename}: no *{suffix}")
    return Image.open(io.BytesIO(z.read(names[0])))


for name, asset in MATERIALS:
    with zipfile.ZipFile(f"{ZIPS}/{asset}.zip") as z:
        col = member(z, "_Color.jpg").convert("RGB").resize((SIDE, SIDE), Image.LANCZOS)
        nrm = member(z, "_NormalGL.jpg").convert("RGB").resize((SIDE, SIDE), Image.LANCZOS)
    c = np.asarray(col, dtype=np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    L = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    ratio = np.clip(L / max(L.mean(), 1e-4), 0.0, 2.0)
    # (its mean back to 1 once clipped: the photograph's mean kept)
    ratio = np.clip(ratio / max(ratio.mean(), 1e-4), 0.0, 2.0)
    n = np.asarray(nrm, dtype=np.float64) / 255.0
    out = np.zeros((SIDE, SIDE, 4), dtype=np.uint8)
    out[..., 0] = np.round(ratio / 2.0 * 255)
    out[..., 1] = np.round(n[..., 0] * 255)
    out[..., 2] = np.round(n[..., 1] * 255)
    out[..., 3] = 255
    png = f"{TMP}/{name}.png"
    Image.fromarray(out, "RGBA").save(png)
    ktx = f"{OUT}/{name}.ktx2"
    subprocess.run(
        ["basisu", "-uastc", "-uastc_level", "2", "-uastc_rdo_l", "0.5", "-ktx2", "-ktx2_zstandard_level", "18", "-mipmap", "-linear", "-mip_linear", "-file", png, "-output_file", ktx],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    print(f"{name}\t{asset}\tmean linear luminance {L.mean():.3f}\tratio σ {ratio.std():.3f}\t{os.path.getsize(ktx) / 1024:.0f} KiB")
