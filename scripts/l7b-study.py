# L7b study: shadow de-lighting of an IGN orthophoto (no scenery prediction yet: the image-only part of steps 3-5),
# with the go/no-go metrics of decision 19: the halo width at shadow edges, the noise of relit areas against sunlit ones.
import sys, json
import numpy as np
from PIL import Image, ImageFilter
d = sys.argv[1]; out = sys.argv[2]
t = [[np.asarray(Image.open(f"{d}/t_{dx}{dy}.jpg").convert("RGB"), dtype=np.float64) / 255 for dy in (0, 1)] for dx in (0, 1)]
img = np.concatenate([np.concatenate([t[0][0], t[0][1]], axis=0), np.concatenate([t[1][0], t[1][1]], axis=0)], axis=1)
lin = img ** 2.2  # (sRGB → linear, near enough)
L = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
# (shadow index: low luminance and a high blue/red ratio — the shadow lit by the blue sky)
br = (lin[..., 2] + 1e-3) / (lin[..., 0] + 1e-3)
def otsu(v):
    h, e = np.histogram(v, 256); c = (e[:-1] + e[1:]) / 2; w = np.cumsum(h); m = np.cumsum(h * c)
    mt = m[-1]; wb = w; wf = w[-1] - w; mb = m / np.maximum(wb, 1); mf = (mt - m) / np.maximum(wf, 1)
    return c[np.argmax(wb * wf * (mb - mf) ** 2)]
lL = np.log(L + 1e-4)
thrL = otsu(lL); thrB = np.median(br)
hard = (lL < thrL) & (br > thrB)
# (soft mask: the hard one opened/closed a little and blurred over ~1 px — the penumbra; then guided by the image's luminance)
m = Image.fromarray((hard * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(3))
a = np.asarray(m.filter(ImageFilter.GaussianBlur(1.0)), dtype=np.float64) / 255
def box(x, r): 
    k = np.ones(2 * r + 1) / (2 * r + 1)
    x = np.apply_along_axis(lambda v: np.convolve(v, k, mode="same"), 0, x)
    return np.apply_along_axis(lambda v: np.convolve(v, k, mode="same"), 1, x)
def guided(I, p, r=3, eps=1e-3):
    mI, mp = box(I, r), box(p, r); cIp = box(I * p, r) - mI * mp; vI = box(I * I, r) - mI * mI
    A = cIp / (vI + eps); B = mp - A * mI
    return box(A, r) * I + box(B, r)
alpha = np.clip(guided(lL / lL.min(), a), 0, 1)
# (k per colour: pairs across the shadow's edges — the median of sunlit over shadowed in a ring 2–5 px either side)
edge_in = (a > 0.9); edge_out = (a < 0.1)
dil = np.asarray(Image.fromarray((hard * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)), dtype=bool)
ero = ~np.asarray(Image.fromarray(((~hard) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5)), dtype=bool)
ring_sun = dil & ~hard & edge_out; ring_sh = hard & ~ero & edge_in
k = np.array([np.median(lin[..., c][ring_sun]) / max(np.median(lin[..., c][ring_sh]), 1e-4) for c in range(3)])
k = np.clip(k, 2, 10)
relit = lin * (1 + (k - 1) * alpha[..., None])
res = np.clip(relit, 0, 1) ** (1 / 2.2)
# (metrics) noise: the high-pass std in relit areas (alpha > 0.9) against sunlit ones (alpha < 0.05), on the luminance
Lr = 0.2126 * relit[..., 0] + 0.7152 * relit[..., 1] + 0.0722 * relit[..., 2]
hp = Lr - box(Lr, 2)
noise_ratio = float(np.std(hp[alpha > 0.9]) / np.std(hp[alpha < 0.05]))
# halo: along the soft mask's edges, the band where the relit luminance departs from both sides' medians by > 15 %
band = (alpha > 0.1) & (alpha < 0.9)
band_w = float(band.sum() / max((np.abs(np.diff(hard.astype(int), axis=1)).sum() + np.abs(np.diff(hard.astype(int), axis=0)).sum()), 1))
Lsun = np.median(Lr[alpha < 0.05]); Lsh = np.median(Lr[alpha > 0.9])
dev = band & (np.abs(Lr - Lsun) > 0.25 * Lsun) & (np.abs(Lr - Lsh) > 0.25 * Lsh)
halo_px = float(dev.sum() / max((np.abs(np.diff(hard.astype(int), axis=1)).sum() + np.abs(np.diff(hard.astype(int), axis=0)).sum()), 1))
# (the residual: shadowed and sunlit luminance after the relight — 1 if the shadow is gone)
resid = float(Lsh / Lsun)
pre = float(np.median(L[alpha > 0.9]) / np.median(L[alpha < 0.05]))
mpp = 156543.03 / 2 ** 18 * np.cos(np.radians(48.8053))
r = dict(px_m=round(mpp, 3), shadow_share=round(float(hard.mean()), 3), k=[round(x, 2) for x in k], before_shadow_over_sun=round(pre, 3),
         after_shadow_over_sun=round(resid, 3), noise_ratio=round(noise_ratio, 2), penumbra_band_px_per_edge_px=round(band_w, 2),
         halo_px_per_edge_px=round(halo_px, 2), halo_m=round(halo_px * mpp, 2))
print(json.dumps(r))
Image.fromarray((img * 255).astype(np.uint8)).save(f"{out}/ortho.png")
Image.fromarray((res * 255).astype(np.uint8)).save(f"{out}/relit.png")
Image.fromarray((alpha * 255).astype(np.uint8)).save(f"{out}/mask.png")
