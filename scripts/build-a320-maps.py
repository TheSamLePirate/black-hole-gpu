"""
The A320's texture layers and liveries (docs/PLAN-A320.md, A1), from FlightGear's A320-family (GPL v2 —
~/Documents/DEV/A320/flightgear-a320, not in the repository):

  python3 scripts/build-a320-maps.py [path/to/flightgear-a320]      (Pillow, numpy, scipy; basisu on the PATH)

Three layers of 4096² (ship.wgsl's A320 block: the materials 100–119 sample them):
  0  the livery's fuselage (its paint, its windows, its doors) — written by the livery chosen (below);
  1  the static elements (Static-Elements.png: the wing's root, the gear bays, the doors' insides…);
  2  an atlas of 2048² cells: the engines' paint (the livery's — CFM56-white by default), the landing gear, the
     placards (decals: their alpha kept), a cell left for later.
Each a colour map (sRGB) and a normal map (tangent space, +y up the image: FlightGear's Fuse-Main-Normal and
Engine-CFM56-Normal; flat elsewhere). No metal-roughness: the finishes are the materials' (ship.wgsl).

The liveries (assets/a320/liveries.json): the house's "Kerr" (white, the deep-space fin with Gargantua's ring, the
title, dark nacelles with a gold ring) and a plain white one — both made here from SWISS's (its red titles and
fin painted over) —, then FlightGear's real ones for the CFM56 (American, Austrian, Delta, SWISS: trade dress of
their owners, offered as options only). Each a fuselage (4096², layer 0) and an engine (2048², layer 2's first
cell): a320-livery-<id>.ktx2, a320-livery-<id>-engine.ktx2.

KTX2: UASTC with RDO and Zstandard, mip-mapped (the page transcodes it to BC7 or ASTC: src/system/ktx2.ts).
"""
import json, os, subprocess, sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FG = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Documents/DEV/A320/flightgear-a320")
RES = FG + "/Models/Fuselage/res"
LIV = FG + "/Models/Liveries/CFM"
LM = FG + "/Models/Effects/Lightmaps"
WORK = ROOT + "/assets/airplanes/a320-work"
OUT = ROOT + "/assets/a320"
N = 4096
os.makedirs(WORK, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
ONLY = os.environ.get("ONLY", "")  # (a comma list of what to build: layers, liveries, or livery ids)


def ktx(png, out, kind, rdo):
    if os.environ.get("PREVIEW"):
        return
    flags = ["-uastc", "-uastc_level", "1", "-uastc_rdo_l", rdo, "-ktx2", "-ktx2_zstandard_level", "18", "-mipmap"]
    if kind == "normal":
        flags += ["-normal_map"]
    subprocess.run(["basisu", *flags, "-output_file", out, png], check=True, stdout=subprocess.DEVNULL)
    print(out, f"{os.path.getsize(out) / 1e6:.1f} MB", flush=True)


def rgba(path, size=None):
    im = Image.open(path).convert("RGBA")
    return im.resize((size, size), Image.LANCZOS) if size and im.size != (size, size) else im


def want(name):
    return not ONLY or any(k in ONLY.split(",") for k in (name, name.split("-")[0]))


# ------------------------------------------------------------------------------------------------- the layers
if want("layers"):
    FLATN = (128, 128, 255, 255)
    # layer 1: the static elements
    rgba(f"{RES}/Static-Elements.png", N).save(f"{WORK}/albedo-1.png")
    Image.new("RGB", (N, N), FLATN[:3]).save(f"{WORK}/normal-1.png")
    # layer 2: the atlas — engine (white CFM56) | gear / placards | (free)
    H = N // 2
    at = Image.new("RGBA", (N, N), (128, 128, 128, 255))
    at.paste(rgba(f"{LIV}/2k/CFM56-white.png", H), (0, 0))
    at.paste(rgba(f"{RES}/LandingGears.png", H), (H, 0))
    pl = rgba(f"{RES}/placards.png", H)
    # (the decals' transparent texels take their neighbours' colour: no dark fringe where they are blended)
    a = np.asarray(pl).astype(np.float32)
    m = a[:, :, 3] > 8
    idx = ndimage.distance_transform_edt(~m, return_distances=False, return_indices=True)
    a[:, :, :3] = a[idx[0], idx[1], :3]
    at.paste(Image.fromarray(a.astype(np.uint8)), (0, H))
    at.save(f"{WORK}/albedo-2.png")
    nat = Image.new("RGB", (N, N), FLATN[:3])
    nat.paste(rgba(f"{LM}/Engine-CFM56-Normal.png", H).convert("RGB"), (0, 0))
    nat.save(f"{WORK}/normal-2.png")
    # layer 0's normals (the livery changes the colour alone)
    rgba(f"{LM}/Fuse-Main-Normal.png", N).convert("RGB").save(f"{WORK}/normal-0.png")
    for k in (1, 2):
        ktx(f"{WORK}/albedo-{k}.png", f"{OUT}/a320-albedo-{k}.ktx2", "albedo", "2.0")
    for k in (0, 1, 2):
        ktx(f"{WORK}/normal-{k}.png", f"{OUT}/a320-normal-{k}.ktx2", "normal", "2.0")

# ------------------------------------------------------------------------------------------------- the liveries
swr = np.asarray(Image.open(f"{LIV}/4k/SWR-fuselage.png").convert("RGB")).astype(np.float32)
redness = swr[:, :, 0] - np.maximum(swr[:, :, 1], swr[:, :, 2])
red = redness > 60
lab, n = ndimage.label(ndimage.binary_dilation(red, iterations=6))
sizes = ndimage.sum(red, lab, range(1, n + 1))
objs = ndimage.find_objects(lab)
# (SWISS's paint: its fin — the largest red area —, its titles — the letters on each side, in a row)
fin_lab = 1 + int(np.argmax(sizes))
fin = ndimage.binary_fill_holes(lab == fin_lab)
titles = []  # (x0, y0, x1, y1) per side
for y0 in (291, 1283):
    xs = [(o[1].start, o[0].start, o[1].stop, o[0].stop) for o, s in zip(objs, sizes) if s > 3000 and abs(o[0].start - y0) < 40]
    titles.append((min(b[0] for b in xs), min(b[1] for b in xs), max(b[2] for b in xs), max(b[3] for b in xs)))


def whiten(im):
    """SWISS's red paint → the white about it (the windows drawn over it kept): every texel of a red letter or of
    the fin, and their soft edges, the paper's — save the windows' dark glass and frames."""
    paint = ndimage.binary_dilation(redness > 12, iterations=3)
    keep = np.zeros_like(red)
    keep[3800:, :] = True  # (the wing's walkway arrows: red markings every A320 wears)
    lum = im.mean(axis=2)
    window = (lum < 150) & (redness < 25)
    k = (paint & ~keep & ~window).astype(np.float32)
    k = ndimage.gaussian_filter(k, 0.7)[:, :, None]
    return im * (1 - k) + np.array([243.0, 243.0, 243.0]) * k


white = whiten(swr)


def font(size):
    for f, i in (("/System/Library/Fonts/Supplemental/Futura.ttc", 4), ("/System/Library/Fonts/Supplemental/Futura.ttc", 0), ("/System/Library/Fonts/Avenir Next.ttc", 8)):
        try:
            return ImageFont.truetype(f, size, index=i)
        except Exception:
            continue
    return ImageFont.load_default()


# SWISS's registration (HB-JLS) on the rear fuselage's two sides — the nose gear's doors show it too: their UVs share
# the place —, the right side's turned half a turn: (x, y, w, h) in the fuselage's image
REGS = [(2865, 483, 153, 37, False), (2865, 1255, 154, 37, True)]


def register(im, reg):
    """The registration painted over SWISS's: the paper there, the letters in its dark grey."""
    out = im.copy()
    d = ImageDraw.Draw(out)
    for x, y, w, h, turned in REGS:
        d.rectangle((x - 6, y - 4, x + w + 6, y + h + 4), fill=(243, 243, 243))
        tile = Image.new("RGBA", (w + 12, h + 8), (0, 0, 0, 0))
        t = ImageDraw.Draw(tile)
        f = font(int(h * 1.05))
        bb = t.textbbox((0, 0), reg, font=f)
        t.text(((w + 12 - (bb[2] - bb[0])) / 2 - bb[0], (h + 8 - (bb[3] - bb[1])) / 2 - bb[1]), reg, font=f, fill=(32, 32, 34, 255))
        if turned:
            tile = tile.rotate(180)
        out.paste(tile, (x - 6, y - 4), tile)
    return out


NAVY = np.array([10.0, 14.0, 34.0])
GOLD = np.array([235.0, 168.0, 70.0])


def kerr(base):
    """The house's: white, the fin a deep-space blue-black with Gargantua's ring, KERR in navy on each side."""
    im = base.copy()
    H_, W_ = fin.shape
    yy, xx = np.mgrid[0:H_, 0:W_]
    # the fin: its two sides (the fin area's halves), each a gradient from the root (lighter) to the tip, the ring
    # at its centre
    area = fin
    sl = ndimage.find_objects(area.astype(int))[0]
    y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
    t = np.clip((yy - y0) / max(y1 - y0, 1), 0, 1)
    deep = NAVY * (0.55 + 0.6 * t[:, :, None]) + np.array([4.0, 2.0, 18.0]) * (1 - t[:, :, None])
    paint = deep
    alpha = ndimage.gaussian_filter(area.astype(np.float32), 1.2)
    # (two rings, where SWISS's crosses were: the fin's two sides — each cross a hole in the red, away from where
    # the two sides' areas overlap)
    rf = ndimage.binary_dilation(red & (lab == fin_lab), iterations=5)
    holes = ndimage.binary_fill_holes(rf) & ~rf
    hl, hn = ndimage.label(ndimage.binary_opening(holes, iterations=3))
    hs = ndimage.sum(holes, hl, range(1, hn + 1))
    big = [i + 1 for i in np.argsort(-hs)[:2]]
    rings = []
    for i in big:
        ys, xs = np.nonzero(hl == i)
        rings.append((xs.mean(), ys.mean(), 0.5 * (ys.max() - ys.min())))
    glow = np.zeros((H_, W_))
    core = np.zeros((H_, W_))
    for rx, ry, R in rings:
        R *= 1.05
        dx, dy = xx - rx, yy - ry
        # (the disk seen nearly edge on: a flat ellipse; the photon ring: a circle; the shadow: black)
        e = np.sqrt((dx / (1.55 * R)) ** 2 + (dy / (0.3 * R)) ** 2)
        c = np.sqrt(dx**2 + dy**2) / R
        glow = np.maximum(glow, np.exp(-((e - 0.82) ** 2) / 0.012) * 1.0)
        glow = np.maximum(glow, np.exp(-((c - 0.62) ** 2) / 0.004) * 0.95)
        core = np.maximum(core, (c < 0.56).astype(float))
    gl = glow[:, :, None]
    paint = paint * (1 - gl) + (GOLD * (0.8 + 0.4 * gl)) * gl
    paint = paint * (1 - 0.92 * core[:, :, None] * (1 - gl))
    im = im * (1 - alpha[:, :, None]) + np.clip(paint, 0, 255) * alpha[:, :, None]
    # the titles: KERR (the left side as written; the right side's strip turned half a turn)
    out = Image.fromarray(np.clip(im, 0, 255).astype(np.uint8))
    for k, (x0, y0, x1, y1) in enumerate(titles):
        w, h = x1 - x0, y1 - y0
        tile = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(tile)
        f = font(int(h * 0.92))
        bb = d.textbbox((0, 0), "KERR", font=f)
        d.text(((w - (bb[2] - bb[0])) / 2 - bb[0], (h - (bb[3] - bb[1])) / 2 - bb[1]), "KERR", font=f, fill=(18, 24, 58, 255))
        # (a thin gold line under it)
        d.rectangle((int(w * 0.06), int(h * 0.97), int(w * 0.94), h - 1), fill=(220, 160, 70, 255))
        if k == 1:
            tile = tile.rotate(180)
        # (the windows stay over the title: pasted where the paint was, the windows' grey left)
        base_px = np.asarray(out).astype(np.float32)
        tl = np.asarray(tile).astype(np.float32)
        region = base_px[y0:y1, x0:x1]
        win = region.mean(axis=2) < 150  # (the windows: dark glass and frames)
        a_ = tl[:, :, 3:4] / 255 * (~win)[:, :, None]
        base_px[y0:y1, x0:x1] = region * (1 - a_) + tl[:, :, :3] * a_
        out = Image.fromarray(base_px.astype(np.uint8))
    return out


def kerr_engine():
    """CFM56-white with Delta's nacelle area (its blue) painted navy, a gold band at its front."""
    w = np.asarray(Image.open(f"{LIV}/2k/CFM56-white.png").convert("RGB")).astype(np.float32)
    dl = np.asarray(Image.open(f"{LIV}/2k/DAL-engine.png").convert("RGB")).astype(np.float32)
    m = ndimage.gaussian_filter((np.abs(dl - w).max(axis=2) > 40).astype(np.float32), 1.0)[:, :, None]
    shade = w / 255.0
    paint = NAVY * (0.6 + 0.6 * shade)
    out = w * (1 - m) + paint * m
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


LIVERIES = [
    {"id": "kerr", "name": "Kerr", "reg": "F-KERR", "real": False},
    {"id": "white", "name": "White", "reg": "F-WWBA", "real": False},
    {"id": "SWR", "name": "Swiss (HB-JLS)", "reg": "HB-JLS", "real": True},
    {"id": "AUA", "name": "Austrian", "reg": "", "real": True},
    {"id": "DAL", "name": "Delta", "reg": "", "real": True},
    {"id": "AAL", "name": "American", "reg": "", "real": True},
]
for L in LIVERIES:
    lid = L["id"]
    if not (want("liveries") or want(lid)):
        continue
    if lid == "kerr":
        fus, en = register(kerr(white), L["reg"]), kerr_engine()
    elif lid == "white":
        fus, en = register(Image.fromarray(np.clip(white, 0, 255).astype(np.uint8)), L["reg"]), Image.open(f"{LIV}/2k/CFM56-white.png").convert("RGB")
    else:
        # (a livery without its own engines: the white ones — Austrian's)
        eng = f"{LIV}/2k/{lid}-engine.png"
        fus = Image.open(f"{LIV}/4k/{lid}-fuselage.png").convert("RGB")
        en = Image.open(eng if os.path.exists(eng) else f"{LIV}/2k/CFM56-white.png").convert("RGB")
    fus.save(f"{WORK}/livery-{lid}.png")
    en.resize((N // 2, N // 2), Image.LANCZOS).save(f"{WORK}/livery-{lid}-engine.png")
    ktx(f"{WORK}/livery-{lid}.png", f"{OUT}/a320-livery-{lid}.ktx2", "albedo", "3.0")
    ktx(f"{WORK}/livery-{lid}-engine.png", f"{OUT}/a320-livery-{lid}-engine.ktx2", "albedo", "3.0")
with open(f"{OUT}/liveries.json", "w") as f:
    json.dump(LIVERIES, f, indent=1)
