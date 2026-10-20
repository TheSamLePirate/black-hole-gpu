"""The title's pictures (PLAN-TITRE-AAA E3) from the renders of scripts/title-art.ts (snapshots/): each way to play's
picture cropped twice — a card (3:4, 600 x 800) and a wide one (16:9, 1280 x 720), each round its subject — and each
craft's 36 views (16:9, 512 x 288) in one 6 x 6 sheet; all of it webp in assets/title/.
usage: python3 scripts/build-title-art.py"""
from PIL import Image

OUT = "assets/title"
# (the subject's centre in each picture, as fractions of its width and height: the crops keep it in)
MODES = {
    "foot": (0.45, 0.42),
    "plane": (0.68, 0.45),
    "ship": (0.6, 0.52),
    "free": (0.42, 0.45),
}


def crop(im, aspect, cx, cy):
    """the largest crop of this aspect (w / h) round (cx, cy), inside the picture"""
    W, H = im.size
    if W / H > aspect:
        h = H
        w = round(H * aspect)
    else:
        w = W
        h = round(W / aspect)
    x = min(max(round(cx * W - w / 2), 0), W - w)
    y = min(max(round(cy * H - h / 2), 0), H - h)
    return im.crop((x, y, x + w, y + h))


for mode, (cx, cy) in MODES.items():
    im = Image.open(f"snapshots/title-{mode}.png").convert("RGB")
    crop(im, 3 / 4, cx, cy).resize((600, 800), Image.LANCZOS).save(f"{OUT}/mode-{mode}-card.webp", "WEBP", quality=80, method=6)
    crop(im, 16 / 9, cx, cy).resize((1280, 720), Image.LANCZOS).save(f"{OUT}/mode-{mode}-wide.webp", "WEBP", quality=80, method=6)
    print(mode)

# the hangar's turntables: the craft in the upper middle of each square view, the Earth below
FW, FH, COLS = 512, 288, 6
for v in ("ranger", "lander", "endurance"):
    sheet = Image.new("RGB", (FW * COLS, FH * 6))
    for k in range(36):
        im = Image.open(f"snapshots/turn-{v}-{k:02d}.png").convert("RGB")
        f = crop(im, 16 / 9, 0.5, 0.55).resize((FW, FH), Image.LANCZOS)
        sheet.paste(f, ((k % COLS) * FW, (k // COLS) * FH))
    sheet.save(f"{OUT}/turn-{v}.webp", "WEBP", quality=76, method=6)
    print(v)
