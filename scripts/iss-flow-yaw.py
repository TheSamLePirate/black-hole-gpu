"""
Q6-ISS ISS2 — a fixed camera's yaw from the ground's motion across its frames (docs/progress/refraction-horizons/Q6-ISS.md,
"ISS2"). The limb gives a camera's tilt, roll and field (scripts/iss-limb-fit.py) but not where it looks round the vertical;
the ground's flow does: the station flies along its orbit holding its attitude to the local vertical (LVLH), so a fixed
camera sees the ground stream away from the direction of flight and towards it. For each yaw (the camera's axis turned
about the nadir from the direction of flight, 0° ahead, 90° starboard) and either handedness of the image (a mirrored
picture), the features matched between two frames dt apart (SIFT, ratio test, below the limb, the overlays left out, the
station's own structure — still — left out) are carried forward: each pixel to its ground point (a sphere, the camera at
`alt`), the station moved along its orbit by ω dt with its frame turned with it, the point projected again; the yaw whose
predicted displacements best match the observed ones in direction (the median angle) is kept, and the ratio of their
lengths reported (a check on dt, the altitude and the field). The Earth's own rotation (≤ 0.46 km/s against 7.66, a few
degrees of direction) is not modelled.

  python3 scripts/iss-flow-yaw.py <frame a.jpg> <frame b.jpg> [<a> <b> …] [--dt 10] [--alt 422] [--fov 95] [--tilt 47.5]
                                  [--limb 0.20] [--bottom 0.84] [--fitfov 1] [--badge 1]

--fitfov 1: the horizontal field too — the one whose predicted lengths match the observed (their median ratio 1), once the yaw is
found (a nadir camera's: `--tilt 90 --limb 0 --bottom 1 --badge 0 --fitfov 1`; its "yaw" the picture's turn about its axis from
the direction of flight).

The frames are not the repository's (Sen's images: ~/.kerr-lab/iss-corpus); only the fitted numbers are reported.
dt [s]: the frames' interval (their capture times' difference when not given: the file names' …THHMMSSZ).
"""
import math, re, sys
import numpy as np
import cv2

R = 6371.0
args, opt = [], {}
it = iter(sys.argv[1:])
for a in it:
    if a.startswith("--"):
        opt[a[2:]] = float(next(it))
    else:
        args.append(a)
alt = opt.get("alt", 422.0)
FOV = math.radians(opt.get("fov", 95.0))
TILT = math.radians(opt.get("tilt", 47.5))
LIMB, BOTTOM = opt.get("limb", 0.20), opt.get("bottom", 0.84)
OMEGA = math.sqrt(398600.4418 / (R + alt) ** 3)  # [rad/s]


def stamp(p):
    m = re.search(r"T(\d\d)(\d\d)(\d\d)Z", p)
    return int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3]) if m else None


def matches(pa, pb):
    a = cv2.imread(pa, cv2.IMREAD_GRAYSCALE)
    b = cv2.imread(pb, cv2.IMREAD_GRAYSCALE)
    H, W = a.shape
    mask = np.zeros_like(a)
    mask[int(LIMB * H) : int(BOTTOM * H), :] = 255
    if opt.get("badge", 1.0) > 0.5:
        mask[: int(0.2 * H), : int(0.2 * W)] = 0  # (the station's structure and the LIVE badge, top left)
    s = cv2.SIFT_create(4000)
    ka, da = s.detectAndCompute(a, mask)
    kb, db = s.detectAndCompute(b, mask)
    if da is None or db is None:
        return W, H, np.zeros((0, 2)), np.zeros((0, 2))
    m = cv2.BFMatcher().knnMatch(da, db, k=2)
    good = [p[0] for p in m if len(p) == 2 and p[0].distance < 0.7 * p[1].distance]
    A = np.array([ka[g.queryIdx].pt for g in good])
    B = np.array([kb[g.trainIdx].pt for g in good])
    if len(A) == 0:
        return W, H, A, B
    d = np.linalg.norm(B - A, axis=1)
    # (the station's structure — still — and the outliers far off the bulk's lengths left out)
    keep = (d > 2.0) & (d < 8 * np.median(d[d > 2.0]) if (d > 2.0).any() else d > 2.0)
    return W, H, A[keep], B[keep]


def camera(yaw, mirror):
    """the camera's axes in the station's local frame (x forward, y starboard, z up)"""
    fwd = np.array([math.cos(TILT) * math.cos(yaw), math.cos(TILT) * math.sin(yaw), -math.sin(TILT)])
    right = np.array([-math.sin(yaw), math.cos(yaw), 0.0])
    up = np.cross(fwd, right)
    return fwd, (-right if mirror else right), up


def frame_at(t):
    """the station's place and its local axes (forward, starboard, up) in an inertial frame, its orbit in the x-z plane"""
    th = OMEGA * t
    S = (R + alt) * np.array([math.sin(th), 0.0, math.cos(th)])
    return S, np.array([math.cos(th), 0.0, -math.sin(th)]), np.array([0.0, -1.0, 0.0]), np.array([math.sin(th), 0.0, math.cos(th)])


def predict(W, H, P, dt, yaw, mirror):
    f = (W / 2) / math.tan(FOV / 2)
    cf, cr, cu = camera(yaw, mirror)
    out = np.full(P.shape, np.nan)
    S0, x0, y0, z0 = frame_at(0.0)
    S1, x1, y1, z1 = frame_at(dt)
    to_inertial = lambda v, x, y, z: v[0] * x + v[1] * y + v[2] * z
    for i, (px, py) in enumerate(P):
        u, w = (px - W / 2) / f, -(py - H / 2) / f
        dl = cf + u * cr + w * cu
        d = to_inertial(dl / np.linalg.norm(dl), x0, y0, z0)
        # (the ray's first meeting with the sphere)
        b = np.dot(S0, d)
        c = np.dot(S0, S0) - R * R
        disc = b * b - c
        if disc < 0:
            continue
        G = S0 + (-b - math.sqrt(disc)) * d
        v = G - S1
        vl = np.array([np.dot(v, x1), np.dot(v, y1), np.dot(v, z1)])
        a_, b_, c_ = np.dot(vl, cf), np.dot(vl, cr), np.dot(vl, cu)
        if a_ <= 0:
            continue
        out[i] = [W / 2 + f * b_ / a_, H / 2 - f * c_ / a_]
    return out


def score(W, H, A, B, dt, yaw, mirror):
    Pb = predict(W, H, A, dt, yaw, mirror)
    ok = np.isfinite(Pb[:, 0])
    if ok.sum() < 0.5 * len(A):
        return 1e9, np.nan
    po, pp = (B - A)[ok], (Pb - A)[ok]
    ang = np.abs(np.arctan2(po[:, 1], po[:, 0]) - np.arctan2(pp[:, 1], pp[:, 0]))
    ang = np.minimum(ang, 2 * math.pi - ang)
    ratio = np.median(np.linalg.norm(po, axis=1) / np.maximum(np.linalg.norm(pp, axis=1), 1e-6))
    return math.degrees(np.median(ang)), ratio


pairs = list(zip(args[0::2], args[1::2]))
res = []
res_fov = []
for pa, pb in pairs:
    W, H, A, B = matches(pa, pb)
    dt = opt.get("dt") or ((stamp(pb) or 0) - (stamp(pa) or 0))
    name = f"{pa.split('/')[-1]} → {pb.split('/')[-1]}"
    if len(A) < 30 or not dt:
        print(f"{name}\ttoo few matches ({len(A)}) or no dt")
        continue
    best = None
    for mirror in (False, True):
        for yd in np.arange(0, 360, 2.0):
            s, r = score(W, H, A, B, dt, math.radians(yd), mirror)
            if best is None or s < best[0]:
                best = (s, yd, mirror, r)
    s, yd, mirror, r = best
    for step in (0.5, 0.1):
        for _ in range(8):
            for dy in (-step, step):
                s2, r2 = score(W, H, A, B, dt, math.radians(yd + dy), mirror)
                if s2 < s:
                    s, yd, r = s2, yd + dy, r2
    fov = ""
    if opt.get("fitfov"):
        lo, hi = math.radians(5), math.radians(160)
        for _ in range(30):
            FOV = 0.5 * (lo + hi)
            _, rr = score(W, H, A, B, dt, math.radians(yd), mirror)
            # (a wider field: shorter predicted displacements, a larger observed/predicted ratio)
            if rr > 1:
                hi = FOV
            else:
                lo = FOV
        fov = f"\tfield {math.degrees(FOV):.1f}°"
        res_fov.append(math.degrees(FOV))
        FOV = math.radians(opt.get("fov", 95.0))
    res.append((yd % 360, s, r, mirror))
    print(f"{name}\tdt {dt:.0f} s\t{len(A)} matches\tyaw {yd % 360:.1f}°\t{'mirrored' if mirror else 'direct'}\tmedian angle {s:.1f}°\tlength ratio {r:.2f}{fov}")
if res:
    a = np.array([[y, s, r] for y, s, r, _ in res])
    ys = np.radians(a[:, 0])
    mean = math.degrees(math.atan2(np.median(np.sin(ys)), np.median(np.cos(ys)))) % 360
    if res_fov:
        print(f"MEDIAN\tfield {np.median(res_fov):.1f}° (spread {np.std(res_fov):.1f}°)")
    print(f"MEDIAN\tyaw {mean:.1f}°\tmedian angle {np.median(a[:, 1]):.1f}°\tlength ratio {np.median(a[:, 2]):.2f}\t(n {len(a)}; mirrored {sum(1 for r in res if r[3])})")
