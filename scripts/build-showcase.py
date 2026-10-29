"""The title's and the marketing's pictures from the game's showcase shots (scripts/showcase-shots.ts →
remote-results/showcase/<name>.png, 1920 x 1080):
- assets/title/: each way to play's card (3:4, 600 x 800) and wide picture (16:9, 1280 x 720); By plane's free flight's —
  the aircraft (plane-<id>.webp), the airfield (field.webp), the weathers (wx-<preset>.webp), the hours (hour-<id>.webp);
- docs/marketing/: the best shots full size (jpg), posters with the emblem and a line, a contact sheet of all.
usage: python3 scripts/build-showcase.py"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC = "remote-results/showcase"
TITLE = "assets/title"
MKT = "docs/marketing"
os.makedirs(MKT, exist_ok=True)


def shot(name):
    p = f"{SRC}/{name}.png"
    return Image.open(p).convert("RGB") if os.path.exists(p) else None


def crop(im, aspect, cx, cy):
    """the largest crop of this aspect (w / h) round (cx, cy), inside the picture"""
    W, H = im.size
    if W / H > aspect:
        h, w = H, round(H * aspect)
    else:
        w, h = W, round(W / aspect)
    x = min(max(round(cx * W - w / 2), 0), W - w)
    y = min(max(round(cy * H - h / 2), 0), H - h)
    return im.crop((x, y, x + w, y + h))


def webp(im, path, size, aspect, cx=0.5, cy=0.5, q=80):
    crop(im, aspect, cx, cy).resize(size, Image.LANCZOS).save(path, "WEBP", quality=q, method=6)


# ---- the ways to play: (shot, subject's centre)
MODES = {
    "plane": ("f35-diamond-montblanc", 0.42, 0.45),
    "foot": ("foot-alps-sunset", 0.48, 0.5),
    "ship": ("ship-ranger-terminator", 0.6, 0.55),
    "free": ("gargantua-disk", 0.45, 0.5),
}
for mode, (name, cx, cy) in MODES.items():
    im = shot(name)
    if im is None:
        print(f"(no {name}: mode {mode} kept)")
        continue
    webp(im, f"{TITLE}/mode-{mode}-card.webp", (600, 800), 3 / 4, cx, cy)
    webp(im, f"{TITLE}/mode-{mode}-wide.webp", (1280, 720), 16 / 9, cx, cy)
    print("mode", mode)

# ---- By plane's free flight: the aircraft, the airfield, the weathers, the hours
PLANE = {
    "plane-f35": "f35-echelon-corsica",
    "plane-a320": "a320-above-clouds",
    "field": "a320-runway",
    **{f"wx-{w}": f"wx-{w}" for w in ("fair", "cloudy", "overcast", "rain", "storm", "windy", "fog")},
    **{f"hour-{h}": f"hour-{h}" for h in ("dawn", "morning", "noon", "dusk", "night")},
}
for out, name in PLANE.items():
    im = shot(name)
    if im is None:
        print(f"(no {name})")
        continue
    webp(im, f"{TITLE}/{out}.webp", (1280, 720), 16 / 9, q=78)
    print(out)

# ---- marketing: the shots full size, posters, a contact sheet
names = sorted(f[:-4] for f in os.listdir(SRC) if f.endswith(".png"))
# (the weathers' and hours' set is the title's: the rest full size)
for n in names:
    if n.startswith(("wx-", "hour-")):
        continue
    shot(n).save(f"{MKT}/{n}.jpg", "JPEG", quality=90, optimize=True, progressive=True)

FONT = "/System/Library/Fonts/Avenir Next.ttc"


def font(size, index=8):
    # (Avenir Next: 8 Heavy, 2 Demi Bold, 5 Medium — as the collection orders them)
    try:
        return ImageFont.truetype(FONT, size, index=index)
    except OSError:
        return ImageFont.load_default()


mark = Image.open(f"{TITLE}/kerr-mark.webp").convert("RGBA")
POSTERS = [
    ("f35-diamond-montblanc", "KERR", "Pilotez au-dessus du vrai monde", "Fly over the real world"),
    ("a320-above-clouds", "KERR", "Au-dessus des nuages, en A320", "Above the clouds, in the A320"),
    ("f35-sea-glint", "KERR", "Le soleil sur la mer", "The Sun on the sea"),
    ("f35-rainbow", "KERR", "Une météo vivante", "A living weather"),
    ("f35-crepuscular", "KERR", "Chaque lumière, chaque nuage", "Every light, every cloud"),
    ("gargantua-disk", "KERR", "Au bord de Gargantua", "At the edge of Gargantua"),
    ("foot-alps-sunset", "KERR", "Marchez sur les mondes", "Walk the worlds"),
    ("ship-ranger-terminator", "KERR", "En orbite, la Terre sous vous", "In orbit, the Earth below"),
    ("ship-endurance-gargantua", "KERR", "Jusqu'à Gargantua", "All the way to Gargantua"),
]
for name, title, fr, en in POSTERS:
    im = shot(name)
    if im is None:
        continue
    W, H = im.size
    # (a soft shade along the foot for the words)
    shade = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(shade)
    for y in range(int(H * 0.62), H):
        d.line([(0, y), (W, y)], fill=int(190 * max((y - H * 0.62) / (H * 0.38), 0.0) ** 1.4))
    dark = Image.new("RGB", (W, H), (0, 0, 0))
    im = Image.composite(dark, im, shade)
    draw = ImageDraw.Draw(im)
    m = mark.resize((int(H * 0.11), int(H * 0.11 * mark.height / mark.width)), Image.LANCZOS)
    x0, y0 = int(W * 0.05), int(H * 0.80)
    im.paste(m, (x0, y0 - m.height // 2 + int(H * 0.02)), m)
    tx = x0 + m.width + int(W * 0.018)
    draw.text((tx, y0 - int(H * 0.035)), title, font=font(int(H * 0.075)), fill=(240, 236, 228))
    draw.text((tx, y0 + int(H * 0.05)), fr, font=font(int(H * 0.032), 2), fill=(226, 170, 92))
    draw.text((tx, y0 + int(H * 0.093)), en, font=font(int(H * 0.024), 5), fill=(200, 196, 188))
    im.save(f"{MKT}/poster-{name}.jpg", "JPEG", quality=90, optimize=True, progressive=True)
    print("poster", name)

# (the contact sheet: every shot, its name under it)
cols, tw, th = 5, 384, 216
rows = (len(names) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * (th + 24)), (8, 8, 10))
dr = ImageDraw.Draw(sheet)
for i, n in enumerate(names):
    t = shot(n).resize((tw, th), Image.LANCZOS)
    x, y = (i % cols) * tw, (i // cols) * (th + 24)
    sheet.paste(t, (x, y))
    dr.text((x + 6, y + th + 4), n, font=font(14, 5), fill=(200, 196, 188))
sheet.save(f"{MKT}/contact-sheet.jpg", "JPEG", quality=85)
print(f"{len(names)} shots, contact sheet")
