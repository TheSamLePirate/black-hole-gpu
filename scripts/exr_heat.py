"""Visualises how an HDR display would show a render: SDR tone-mapped image next to a heat map of
the display level (in units of SDR white) produced by the extended-range mapping (display.wgsl)."""
import sys, struct, numpy as np
from PIL import Image, ImageDraw, ImageFont

def read_exr(path):
    b = open(path, 'rb').read()
    i = 8
    attrs = {}
    while b[i] != 0:
        j = b.index(0, i); name = b[i:j].decode(); i = j + 1
        j = b.index(0, i); typ = b[i:j].decode(); i = j + 1
        size = struct.unpack_from('<i', b, i)[0]; i += 4
        attrs[name] = b[i:i + size]; i += size
    i += 1
    x0, y0, x1, y1 = struct.unpack('<4i', attrs['dataWindow'])
    W, H = x1 - x0 + 1, y1 - y0 + 1
    offs = struct.unpack_from(f'<{H}Q', b, i)
    img = np.zeros((H, W, 3), np.float32)
    for o in offs:
        y, n = struct.unpack_from('<2i', b, o)
        row = np.frombuffer(b, np.float16, 3 * W, o + 8).astype(np.float32).reshape(3, W)
        img[y - y0] = row[::-1].T  # B,G,R → R,G,B
    return img

def hdr_map(c, peak):
    m = c.max(-1, keepdims=True)
    knee = min(0.6, 0.5 * peak); span = peak - knee
    m2 = np.where(m <= knee, m, knee + span * (1 - np.exp(-(m - knee) / span)))
    return m2[..., 0]

exr, png, out, peak = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]) if len(sys.argv) > 4 else 4
img = read_exr(exr)
lvl = hdr_map(img, peak)
t = np.clip(np.log2(np.maximum(lvl, 1e-4)) / np.log2(peak), 0, 1)  # 0 = SDR white, 1 = peak
sdr = np.asarray(Image.open(png).convert('RGB')).astype(np.float32) / 255
grey = sdr.mean(-1, keepdims=True) * 0.55
heat = np.stack([np.clip(1.5 * t, 0, 1), np.clip(1.5 * t - 0.5, 0, 1), np.clip(3 * t - 2, 0, 1) * 0.9 + 0.1 * t], -1)
vis = np.where((lvl > 1)[..., None], 0.25 + 0.75 * heat, grey)
H, W = lvl.shape
canvas = np.concatenate([sdr, vis], 1)
im = Image.fromarray((canvas * 255).astype(np.uint8)).resize((1600, int(1600 * H / (2 * W))), Image.LANCZOS)
d = ImageDraw.Draw(im)
try:
    f = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 18)
except Exception:
    f = None
d.text((14, 10), 'SDR (AgX punchy)', fill=(255, 255, 255), font=f)
d.text((814, 10), f'HDR : niveaux au-dessus du blanc SDR (1x -> {peak:g}x)', fill=(255, 255, 255), font=f)
for k in range(200):
    tt = k / 199
    col = tuple(int(255 * (0.25 + 0.75 * v)) for v in (min(1, 1.5 * tt), min(1, max(0, 1.5 * tt - 0.5)), min(1, max(0, 3 * tt - 2)) * 0.9 + 0.1 * tt))
    d.line([(1380 + k, im.height - 24), (1380 + k, im.height - 12)], fill=col)
d.text((1340, im.height - 30), '1x', fill=(255, 255, 255), font=f)
d.text((1586 - 8, im.height - 30), f'{peak:g}x', fill=(255, 255, 255), font=f)
im.save(out, quality=88)
print('fraction of pixels above SDR white: %.2f %%' % (100 * (lvl > 1).mean()), 'max level', lvl.max())
