"""The logo's mark (PLAN-TITRE-AAA E1) from a render of the game's own black hole: snapshots/<name>.png, rendered
by scripts/logo-render.ts (the game's ray tracer, offline, the sky black) — cropped wide, its disk faded out at
the sides, its black made transparent (alpha from the brightest channel, the colour un-premultiplied), saved as
assets/title/kerr-mark.webp.
usage: python3 scripts/build-logo.py [snapshots/logo-c2.png] [assets/title/kerr-mark.webp]"""
import sys
import numpy as np
from PIL import Image

src = sys.argv[1] if len(sys.argv) > 1 else "snapshots/logo-c2.png"
out = sys.argv[2] if len(sys.argv) > 2 else "assets/title/kerr-mark.webp"
im = np.asarray(Image.open(src).convert("RGB"), dtype=np.float32) / 255.0
H, W, _ = im.shape
# (wide: the disk's band and the lensed arcs over and under the shadow)
y0, y1 = int(0.17 * H), int(0.83 * H)
im = im[y0:y1]
h, w, _ = im.shape
# (the disk's ends faded out, not cut by the frame)
x = np.linspace(-1, 1, w)[None, :]
fade = np.clip((1 - np.abs(x)) / 0.22, 0, 1) ** 1.5
a = np.clip(im.max(axis=2) * 1.08, 0, 1) * fade[0]
rgb = np.where(a[..., None] > 1e-4, np.clip(im / np.maximum(im.max(axis=2, keepdims=True), 1e-4), 0, 1), 0)
# (opaque inside its outer edge — the shadow black, the gaps between the rings as rendered: the sky behind must not
# show through it; the dark reached from the frame is the outside, everything else the inside)
from PIL import ImageDraw, ImageFilter

lum = im.max(axis=2) * fade[0]
probe = Image.fromarray(np.where(lum < 0.16, 0, 255).astype(np.uint8), "L").copy()
for x0 in range(0, w, 16):
    for y0 in (0, h - 1):
        if probe.getpixel((x0, y0)) == 0:
            ImageDraw.floodfill(probe, (x0, y0), 128)
for y0 in range(0, h, 16):
    for x0 in (0, w - 1):
        if probe.getpixel((x0, y0)) == 0:
            ImageDraw.floodfill(probe, (x0, y0), 128)
inside = (np.asarray(probe) != 128).astype(np.uint8) * 255
soft = np.asarray(Image.fromarray(inside).filter(ImageFilter.GaussianBlur(1.5)), dtype=np.float32) / 255
a = np.maximum(a, soft)
rgb = soft[..., None] * im * fade[0][..., None] + (1 - soft[..., None]) * rgb
rgba = np.dstack([rgb, a])
img = Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").resize((640, int(640 * h / w)), Image.LANCZOS)
img.save(out, "WEBP", quality=84, method=6)
print(out, img.size)
