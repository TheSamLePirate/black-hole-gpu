"""Burns a mission's captions into its rendered frames (a film's lower third, faded in and out), with a fade
from and to black; the frames are then ready for ffmpeg.

usage: captions.py <prefix> <out_prefix> [--fps 24]
  reads snapshots/<prefix>NNNN.png and snapshots/<prefix>caps.json ([step, title, line, phase] per frame),
  writes snapshots/<out_prefix>NNNN.png
"""
import json
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

args = sys.argv[1:]
fps = 24
if "--fps" in args:
    i = args.index("--fps")
    fps = int(args[i + 1])
    del args[i : i + 2]
prefix, out = args[0], args[1]
caps = json.load(open(f"snapshots/{prefix}caps.json"))
n = len(caps)

AVENIR = "/System/Library/Fonts/Avenir Next.ttc"
fin, fout = int(0.6 * fps), int(0.35 * fps)

# caption segments: runs of the same title
seg_start, seg_end = [0] * n, [0] * n
s = 0
for i in range(1, n + 1):
    if i == n or caps[i][1] != caps[s][1]:
        for k in range(s, i):
            seg_start[k], seg_end[k] = s, i
        s = i


def spaced(d, xy, text, font, fill, spacing, anchor_centre=True):
    """Text with letter spacing, centred on x."""
    widths = [d.textlength(c, font=font) for c in text]
    total = sum(widths) + spacing * max(len(text) - 1, 0)
    x = xy[0] - total / 2 if anchor_centre else xy[0]
    for c, w in zip(text, widths):
        d.text((x, xy[1]), c, font=font, fill=fill)
        x += w + spacing


for i in range(n):
    im = Image.open(f"snapshots/{prefix}{i:04d}.png").convert("RGB")
    W, H = im.size
    k = W / 1280
    step, title, line = caps[i][0], caps[i][1], caps[i][2]
    a = 0.0
    if title:
        a = min(1.0, (i - seg_start[i] + 1) / fin, (seg_end[i] - i) / fout if seg_end[i] < n else 1.0)
    if a > 0:
        f_small = ImageFont.truetype(AVENIR, int(12 * k), index=2)
        f_title = ImageFont.truetype(AVENIR, int(34 * k), index=10)
        f_line = ImageFont.truetype(AVENIR, int(17 * k), index=7)
        # the text on its own layer: a soft shadow under it, then the text, faded together
        layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
        shadow = Image.new("RGBA", im.size, (0, 0, 0, 0))
        for tgt, col_small, col_title, col_line in (
            (shadow, (0, 0, 0, 230), (0, 0, 0, 230), (0, 0, 0, 230)),
            (layer, (124, 214, 255, 235), (255, 255, 255, 255), (230, 234, 243, 225)),
        ):
            d = ImageDraw.Draw(tgt)
            y0 = H * 0.785
            spaced(d, (W / 2, y0), step.upper(), f_small, col_small, 3.6 * k)
            spaced(d, (W / 2, y0 + 20 * k), title.upper(), f_title, col_title, 6.5 * k)
            spaced(d, (W / 2, y0 + 66 * k), line, f_line, col_line, 0.6 * k)
        shadow = shadow.filter(ImageFilter.GaussianBlur(7 * k))
        comb = Image.alpha_composite(shadow, layer)
        alpha = comb.getchannel("A").point(lambda v: int(v * a))
        comb.putalpha(alpha)
        im = Image.alpha_composite(im.convert("RGBA"), comb).convert("RGB")
    # fade from black, to black
    edge = min((i + 1) / fps, (n - i) / fps)
    if edge < 1:
        im = Image.blend(Image.new("RGB", im.size), im, max(edge, 0))
    im.save(f"snapshots/{out}{i:04d}.png")
    if i % 200 == 0:
        print(i, "/", n, flush=True)
print("done", n)
