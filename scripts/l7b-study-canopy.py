# L7b study, phase 2: the shadows predicted by the BD TOPO's buildings gate the image's mask (§9 steps 1-5)
import sys, json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
d, bfile, mfile, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
t = [[np.asarray(Image.open(f"{d}/t_{dx}{dy}.jpg").convert("RGB"), dtype=np.float64) / 255 for dy in (0, 1)] for dx in (0, 1)]
img = np.concatenate([np.concatenate([t[0][0], t[0][1]], axis=0), np.concatenate([t[1][0], t[1][1]], axis=0)], axis=1)
H, W = img.shape[:2]
lin = img ** 2.2
L = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
mpp = 156543.03 / 2 ** 18 * math.cos(math.radians(48.8053))
# (the buildings' heights and footprints on the grid)
hm = Image.new("F", (W, H), 0.0); fp = Image.new("L", (W, H), 0)
dh, df = ImageDraw.Draw(hm), ImageDraw.Draw(fp)
for b in json.load(open(bfile)):
    for ring in b["rings"]:
        pts = [(x, y) for x, y in ring]
        if len(pts) >= 3:
            dh.polygon(pts, fill=b["h"]); df.polygon(pts, fill=255)
Hm0 = np.asarray(hm, dtype=np.float64); FP = np.asarray(fp) > 0
# (phase 3: the LiDAR's canopy height — trees and buildings, true geometry — the occluders; the BD TOPO's where it is taller)
MNH = np.nan_to_num(np.fromfile(mfile, dtype="<f4").reshape(H, W), nan=0.0)
Hm = np.maximum(MNH, Hm0)
# (the receivers: the ground — under 1.5 m, off the footprints —; crowns and roofs never relit)
GROUND = (MNH < 1.5) & ~FP
def shadow(az, el, step=2):
    # (march towards the Sun: image x east, y south — the Sun's azimuth from the north, eastwards)
    dx, dy = math.sin(math.radians(az)), -math.cos(math.radians(az))
    tanE = math.tan(math.radians(el)); S = np.zeros((H, W), bool)
    for s in range(step, int(40 / tanE / mpp) + 1, step):
        ox, oy = int(round(dx * s)), int(round(dy * s))
        sh = np.zeros_like(Hm)
        ys0, ys1 = max(0, -oy), min(H, H - oy); xs0, xs1 = max(0, -ox), min(W, W - ox)
        sh[ys0:ys1, xs0:xs1] = Hm[ys0 + oy:ys1 + oy, xs0 + ox:xs1 + ox]
        S |= sh > s * mpp * tanE
    return S & GROUND
br = (lin[..., 2] + 1e-3) / (lin[..., 0] + 1e-3)
def otsu(v):
    h, e = np.histogram(v, 256); c = (e[:-1] + e[1:]) / 2; w = np.cumsum(h); m = np.cumsum(h * c)
    wb = w; wf = w[-1] - w; mb = m / np.maximum(wb, 1); mf = (m[-1] - m) / np.maximum(wf, 1)
    return c[np.argmax(wb * wf * (mb - mf) ** 2)]
lL = np.log(L + 1e-4)
dark = (lL < otsu(lL)) & (br > np.median(br)) & GROUND
best = None
for az in range(120, 241, 10):
    for el in range(30, 66, 5):
        S = shadow(az, el, 3)
        iou = (S & dark).sum() / max((S | dark).sum(), 1)
        if best is None or iou > best[0]: best = (iou, az, el)
iou, az, el = best
for daz in (-4, 0, 4):
    for de in (-2, 0, 2):
        S = shadow(az + daz, el + de, 2); i2 = (S & dark).sum() / max((S | dark).sum(), 1)
        if i2 > iou: iou, best = i2, (i2, az + daz, el + de)
iou, az, el = best
S = shadow(az, el, 1)
near = np.asarray(Image.fromarray((S * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7)), dtype=bool)
hard = near & dark
a = np.asarray(Image.fromarray((hard * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.GaussianBlur(1.0)), dtype=np.float64) / 255
def box(x, r):
    k = np.ones(2 * r + 1) / (2 * r + 1)
    x = np.apply_along_axis(lambda v: np.convolve(v, k, mode="same"), 0, x)
    return np.apply_along_axis(lambda v: np.convolve(v, k, mode="same"), 1, x)
def guided(I, p, r=3, eps=1e-3):
    mI, mp = box(I, r), box(p, r); cIp = box(I * p, r) - mI * mp; vI = box(I * I, r) - mI * mI
    A = cIp / (vI + eps); B = mp - A * mI
    return box(A, r) * I + box(B, r)
alpha = np.clip(guided(lL / lL.min(), a), 0, 1) * GROUND
dil = np.asarray(Image.fromarray((hard * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)), dtype=bool)
ero = ~np.asarray(Image.fromarray(((~hard) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)), dtype=bool)
ring_sun = dil & ~hard & (a < 0.1) & GROUND; ring_sh = hard & ~ero & (a > 0.9) & GROUND
k = np.clip(np.array([np.median(lin[..., c][ring_sun]) / max(np.median(lin[..., c][ring_sh]), 1e-4) for c in range(3)]), 2, 10)
relit = lin * (1 + (k - 1) * alpha[..., None])
Lr = 0.2126 * relit[..., 0] + 0.7152 * relit[..., 1] + 0.0722 * relit[..., 2]
hp = Lr - box(Lr, 2)
noise = float(np.std(hp[alpha > 0.9]) / np.std(hp[(alpha < 0.05) & GROUND]))
edges = np.abs(np.diff(hard.astype(int), axis=1)).sum() + np.abs(np.diff(hard.astype(int), axis=0)).sum()
band = (alpha > 0.1) & (alpha < 0.9)
Lsun = np.median(Lr[(alpha < 0.05) & GROUND]); Lsh = np.median(Lr[alpha > 0.9])
dev = band & (np.abs(Lr - Lsun) > 0.25 * Lsun) & (np.abs(Lr - Lsh) > 0.25 * Lsh)
roofs_touched = float((alpha[FP] > 0.1).mean()) if FP.any() else 0.0
r = dict(sun=dict(az=az, el=el, iou=round(float(iou), 3)), shadow_share=round(float(hard.mean()), 3), k=[round(float(x), 2) for x in k],
         before=round(float(np.median(L[alpha > 0.9]) / np.median(L[(alpha < 0.05) & GROUND])), 3), after=round(float(Lsh / Lsun), 3),
         noise_ratio=round(noise, 2), halo_m=round(float(dev.sum() / max(edges, 1)) * mpp, 2), roofs_touched=round(roofs_touched, 3), crowns_touched=round(float((alpha[MNH > 2] > 0.1).mean()), 3))
print(json.dumps(r))
res = np.clip(relit, 0, 1) ** (1 / 2.2)
Image.fromarray((res * 255).astype(np.uint8)).save(f"{out}/relit3.png")
Image.fromarray((alpha * 255).astype(np.uint8)).save(f"{out}/mask3.png")
Image.fromarray((S * 255).astype(np.uint8)).save(f"{out}/predicted3.png")
