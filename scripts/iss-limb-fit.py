"""
Q6-ISS ISS2 — a fixed camera's tilt, roll and field from the Earth's limb (docs/progress/refraction-horizons/Q6-ISS.md, "ISS2").

From an altitude h the limb is the cone of directions dipping δ = acos(R / (R + h)) below the local horizontal (20.3° at 420 km).
In a pinhole camera of horizontal field F, tilted θ below the horizontal (its axis) and rolled φ about its axis, each image column's
limb row follows from those three numbers; they are fitted on the limb found in the frames (per column, the first row from the top
where the image turns from space's black to the Earth's or the air's brightness, the overlays' rows left out) by a grid search
then a local refinement, the median residual [px] reported. No lens distortion modelled (a wide angle's barrel shows in the
residual's shape across the width).

  python3 scripts/iss-limb-fit.py <frames.jpg> … [--alt 420] [--top 0.08] [--bottom 0.80] [--distort 1]

--distort 1: a wide angle's barrel too — the projection between the pinhole (r = f tan θ) and the equidistant fisheye (r = f θ):
r = f ((1 − k) tan θ + k θ), k fitted in [0, 1] with the rest (Q6-ISS ISS5: the Sun seen at the top of Sen's frame where the
pinhole's field ends below it).

The frames are not the repository's (Sen's images: ~/.kerr-lab/iss-corpus); only the fitted numbers are reported.
"""
import math, sys
import numpy as np
from PIL import Image

R = 6371.0
args, opt = [], {}
it = iter(sys.argv[1:])
for a in it:
    if a.startswith("--"):
        opt[a[2:]] = float(next(it))
    else:
        args.append(a)
alt = opt.get("alt", 420.0)
top, bottom = opt.get("top", 0.08), opt.get("bottom", 0.80)
dip = math.acos(R / (R + alt))


def limb_rows(path):
    """per column (every 8th), the limb's row: the first row below `top` where the luminance passes a third of the column's
    bright level, after a dark run (space); None where none"""
    a = np.asarray(Image.open(path).convert("L"), dtype=np.float64)
    H, W = a.shape
    y0, y1 = int(top * H), int(bottom * H)
    cols, rows = [], []
    for x in range(16, W - 16, 8):
        c = a[y0:y1, x - 2 : x + 3].mean(axis=1)
        hi = np.percentile(c, 90)
        if hi < 40 or c[:10].mean() > 0.25 * hi:
            continue  # (no dark sky above the limb in this column: Earth to the top, or the frame's overlay)
        k = np.argmax(c > hi / 3)
        if k == 0:
            continue
        cols.append(x)
        rows.append(y0 + k)
    return W, H, np.array(cols, float), np.array(rows, float)


def theta_of(rho, k):
    """the angle off the axis whose projected radius is rho (in units of f): (1 − k) tan θ + k θ = rho, by Newton"""
    th = np.arctan(rho) if k < 0.5 else np.minimum(rho, 1.5)
    for _ in range(12):
        g = (1 - k) * np.tan(th) + k * th - rho
        dg = (1 - k) / np.cos(th) ** 2 + k
        th = np.clip(th - g / dg, 0.0, 1.55)
    return th


def model_rows(W, H, cols, F, tilt, roll, kb=0.0):
    """the limb's row at each column for a camera of horizontal field F [rad], tilt below the horizontal, roll [rad], its
    projection's barrel k (0 a pinhole)"""
    f = (W / 2) / ((1 - kb) * math.tan(F / 2) + kb * F / 2)
    # camera axes in the local frame (x forward horizontal, y right, z up): the axis tilted down, then rolled about it
    fwd = np.array([math.cos(tilt), 0.0, -math.sin(tilt)])
    up0 = np.array([math.sin(tilt), 0.0, math.cos(tilt)])
    right0 = np.cross(fwd, up0)
    right = right0 * math.cos(roll) + up0 * math.sin(roll)
    up = np.cross(right, fwd)
    out = np.full(cols.shape, np.nan)
    s = -math.sin(dip)  # the limb: d · z = −sin δ
    for i, x in enumerate(cols):
        u = (x - W / 2) / f
        # d(v) = fwd + u right + w up (w = −(row − H/2)/f): solve (fwd + u right + w up)·z / |…| = s for w (scan, then bisect)
        ws = np.linspace(-1.5, 1.5, 601)
        if kb > 0:
            rho = np.hypot(u, ws)
            th = theta_of(rho, kb)
            sc = np.where(rho > 1e-9, np.sin(th) / np.maximum(rho, 1e-9), 1.0)
            d = np.cos(th)[:, None] * fwd[None, :] + sc[:, None] * (u * right[None, :] + ws[:, None] * up[None, :])
        else:
            d = fwd[None, :] + u * right[None, :] + ws[:, None] * up[None, :]
        g = d[:, 2] / np.linalg.norm(d, axis=1) - s
        k = np.nonzero(np.sign(g[:-1]) != np.sign(g[1:]))[0]
        if len(k) == 0:
            continue
        j = k[0]
        w = ws[j] - g[j] * (ws[j + 1] - ws[j]) / (g[j + 1] - g[j])
        out[i] = H / 2 - w * f
    return out


KS = [0.0, 0.25, 0.5, 0.75, 1.0] if opt.get("distort") else [0.0]


def fit(W, H, cols, rows):
    best = None
    for k in KS:
        for F in np.radians(np.arange(60, 151, 5)):
            for tilt in np.radians(np.arange(30, 61, 2.5)):
                for roll in np.radians(np.arange(-5, 5.1, 2.5)):
                    m = model_rows(W, H, cols, F, tilt, roll, k)
                    r = np.nanmedian(np.abs(m - rows)) if np.isfinite(m).sum() > len(cols) * 0.8 else 1e9
                    if best is None or r < best[0]:
                        best = (r, F, tilt, roll, k)
    r, F, tilt, roll, k = best
    for step in (np.radians(1.0), np.radians(0.25)):
        for _ in range(3):
            for dF in (-step, 0, step):
                for dt in (-step, 0, step):
                    for dr in (-step, 0, step):
                        for dk in ((-0.05, 0, 0.05) if opt.get("distort") else (0,)):
                            kk = min(max(k + dk, 0.0), 1.0)
                            m = model_rows(W, H, cols, F + dF, tilt + dt, roll + dr, kk)
                            rr = np.nanmedian(np.abs(m - rows)) if np.isfinite(m).sum() > len(cols) * 0.8 else 1e9
                            if rr < r:
                                r, F, tilt, roll, k = rr, F + dF, tilt + dt, roll + dr, kk
    return r, F, tilt, roll, k


res = []
for p in args:
    W, H, cols, rows = limb_rows(p)
    if len(cols) < 40:
        print(f"{p.split('/')[-1]}\tlimb not found ({len(cols)} columns)")
        continue
    r, F, tilt, roll, k = fit(W, H, cols, rows)
    # (the vertical half-field: the top edge's angle off the axis)
    fpx = (W / 2) / ((1 - k) * math.tan(F / 2) + k * F / 2)
    vhalf = math.degrees(float(theta_of(np.array([(H / 2) / fpx]), k)[0]))
    res.append((math.degrees(F), math.degrees(tilt), math.degrees(roll), r, k, vhalf))
    print(f"{p.split('/')[-1]}\tfield {math.degrees(F):.1f}°\ttilt {math.degrees(tilt):.1f}°\troll {math.degrees(roll):.1f}°\tk {k:.2f}\tvertical half-field {vhalf:.1f}°\tresidual {r:.1f} px\t({len(cols)} columns)")
if res:
    a = np.array(res)
    print(f"MEDIAN\tfield {np.median(a[:,0]):.1f}°\ttilt {np.median(a[:,1]):.1f}°\troll {np.median(a[:,2]):.1f}°\tk {np.median(a[:,4]):.2f}\tvertical half-field {np.median(a[:,5]):.1f}°\tresidual {np.median(a[:,3]):.1f} px\t(n {len(a)}; spread field {a[:,0].std():.1f}°, tilt {a[:,1].std():.1f}°, roll {a[:,2].std():.1f}°, k {a[:,4].std():.2f})")
