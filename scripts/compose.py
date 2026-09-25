"""Side-by-side comparison sheet for progress screenshots.
usage: compose.py out.jpg "caption" img1 "label1" img2 "label2" ... [--width 1600] [--crop x0,y0,x1,y1]"""
import sys
from PIL import Image, ImageDraw, ImageFont

args = sys.argv[1:]
width, crop = 1600, None
if '--width' in args:
    i = args.index('--width'); width = int(args[i + 1]); del args[i:i + 2]
if '--crop' in args:
    i = args.index('--crop'); crop = tuple(float(v) for v in args[i + 1].split(',')); del args[i:i + 2]
out, caption, rest = args[0], args[1], args[2:]
pairs = list(zip(rest[0::2], rest[1::2]))
ims = []
for path, _ in pairs:
    im = Image.open(path).convert('RGB')
    if crop:
        W, H = im.size
        im = im.crop((int(crop[0] * W), int(crop[1] * H), int(crop[2] * W), int(crop[3] * H)))
    ims.append(im)
n = len(ims)
cols = n if n <= 3 else 2
rows = (n + cols - 1) // cols
cw = width // cols
ch = int(cw * ims[0].height / ims[0].width)
top = 44
sheet = Image.new('RGB', (cw * cols, ch * rows + top), (12, 12, 16))
d = ImageDraw.Draw(sheet)
try:
    f = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 16)
    fb = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Unicode.ttf', 19)
except Exception:
    f = fb = None
d.text((14, 11), caption, fill=(235, 235, 240), font=fb)
for k, (im, (_, label)) in enumerate(zip(ims, pairs)):
    x, y = (k % cols) * cw, top + (k // cols) * ch
    sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y))
    tw = d.textlength(label, font=f) if f else 8 * len(label)
    d.rectangle([x + 8, y + 8, x + 20 + tw, y + 34], fill=(0, 0, 0))
    d.text((x + 14, y + 11), label, fill=(255, 255, 255), font=f)
sheet.save(out, quality=88)
