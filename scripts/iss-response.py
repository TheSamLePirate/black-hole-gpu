"""
Q6-ISS ISS3 — a camera's response: the live stream's frames against the game's view through the same camera at the same
instant (tests/e2e/iss-cameras.e2e.test.ts with ISS_AT, the image's profile neutral) — docs/progress/refraction-horizons/
Q6-ISS.md, "ISS3". The scenes differ in their clouds (the game's weather is not that day's), so each picture is reduced to two
populations in a box of its Earth (the overlays, the station's structure and the sky left out by the box): the ocean — its
darkest half by luminance — and the clouds — its brightest 3 % —; of each the mean sRGB colour, its linear luminance, and the
ocean's chroma (max − min of its sRGB channels). The ratios game / stream are what a camera profile would have to change
(exposure, white balance, contrast between ocean and cloud, saturation) — or what the rendering has wrong: the two are told
apart only with care (a camera's auto-exposure against a scene's real radiances).

  python3 scripts/iss-response.py --real <frame.jpg> … --box x0,y0,x1,y1 --game <shot.png> --gbox x0,y0,x1,y1

Boxes in fractions of the width and height. The frames are not the repository's (~/.kerr-lab/iss-corpus); only the numbers are
reported.
"""
import sys
import numpy as np
from PIL import Image

args = {"real": [], "game": []}
key = None
opt = {}
for a in sys.argv[1:]:
    if a in ("--real", "--game"):
        key = a[2:]
    elif a in ("--box", "--gbox"):
        key = a[2:]
    elif key in ("box", "gbox"):
        opt[key] = [float(v) for v in a.split(",")]
        key = None
    else:
        args[key].append(a)


def lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def stats(paths, box):
    oc, cl = [], []
    for p in paths:
        a = np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)
        H, W, _ = a.shape
        x0, y0, x1, y1 = box
        r = a[int(y0 * H) : int(y1 * H), int(x0 * W) : int(x1 * W)].reshape(-1, 3)
        L = 0.2126 * lin(r[:, 0]) + 0.7152 * lin(r[:, 1]) + 0.0722 * lin(r[:, 2])
        o = r[L <= np.percentile(L, 50)]
        c = r[L >= np.percentile(L, 97)]
        oc.append(o.mean(axis=0))
        cl.append(c.mean(axis=0))
    oc, cl = np.mean(oc, axis=0), np.mean(cl, axis=0)
    Lum = lambda c: float(0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]))
    return {"ocean": oc, "cloud": cl, "Locean": Lum(oc), "Lcloud": Lum(cl), "chroma": float(oc.max() - oc.min())}


R = stats(args["real"], opt["box"])
G = stats(args["game"], opt.get("gbox", opt["box"]))
fmt = lambda c: "(" + ", ".join(f"{v:.0f}" for v in c) + ")"
for name, s in (("stream", R), ("game", G)):
    print(f"{name}\tocean sRGB {fmt(s['ocean'])}  L {s['Locean']:.4f}  chroma {s['chroma']:.0f}\tcloud sRGB {fmt(s['cloud'])}  L {s['Lcloud']:.3f}\tcloud/ocean {s['Lcloud'] / max(s['Locean'], 1e-6):.1f}")
print(
    f"game/stream\tocean L ×{G['Locean'] / R['Locean']:.2f}  cloud L ×{G['Lcloud'] / R['Lcloud']:.2f}  contrast ×{(G['Lcloud'] / G['Locean']) / (R['Lcloud'] / R['Locean']):.2f}  ocean chroma ×{G['chroma'] / max(R['chroma'], 1):.2f}"
)
# (the ocean's colour's balance: its channels over its green, stream against game)
bo = lambda c: c / max(c[1], 1)
print(f"ocean balance R/G B/G\tstream {bo(R['ocean'])[0]:.2f} {bo(R['ocean'])[2]:.2f}\tgame {bo(G['ocean'])[0]:.2f} {bo(G['ocean'])[2]:.2f}")
