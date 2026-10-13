"""Offline COG window reads only; no GeoTIFF decoding in the game.

Setup: python3 -m venv .cache/earth-build &&
       .cache/earth-build/bin/pip install -r scripts/earth-surface-requirements.txt
Run through `bun run build:earth-surface` (Basis Universal encodes the PNGs).
"""

import gzip
import json
import math
import re
import sys
from contextlib import ExitStack
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.vrt import WarpedVRT

ROOT = Path(__file__).resolve().parent.parent
SIZE, GUTTER = 1024, 2
CORE = SIZE - 2 * GUTTER
YEAR = 2021
RGB_BANDS = (1, 2, 3)  # COG metadata: B04 red, B03 green, B02 blue, B08 infrared.


def encode_srgb(colour, classes):
    """Linear reflectance / 10000 -> sRGB, preserving RGB order and nodata."""
    linear = np.clip(colour.transpose(1, 2, 0).astype(np.float32) * 0.0001, 0, 1)
    srgb = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(linear, 1/2.4) - 0.055)
    rgba = np.zeros((*classes.shape, 4), dtype=np.uint8)
    rgba[:, :, :3] = np.rint(srgb * 255).astype(np.uint8)
    rgba[:, :, 3] = np.where(np.any(colour > 0, axis=0) & (classes > 0), 255, 0)
    return rgba


# Check primaries and nodata before every real build.
primary = np.array([[[10000, 0, 0, 0]], [[0, 10000, 0, 0]], [[0, 0, 10000, 0]]], dtype=np.uint16)
assert encode_srgb(primary, np.full((1, 4), 40, dtype=np.uint8)).tolist() == [[[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [0, 0, 0, 0]]]
assert encode_srgb(np.full((3, 1, 1), 1000, dtype=np.uint16), np.full((1, 1), 40, dtype=np.uint8))[0, 0, 0] == 89
if "--self-test" in sys.argv:
    print("RGB reflectance preparation: OK")
    sys.exit(0)


def coord(v, positive, negative):
    return f"{positive if v >= 0 else negative}{abs(v):0{2 if positive == 'N' else 3}d}"


def source(lat, lon, composite):
    tile = coord(lat, "N", "S") + coord(lon, "E", "W")
    if composite:
        return f"https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/rgbnir/{YEAR}/{coord(lat, 'N', 'S')}/ESA_WorldCover_10m_{YEAR}_v200_{tile}_S2RGBNIR.tif"
    return f"https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/{YEAR}/map/ESA_WorldCover_10m_{YEAR}_v200_{tile}_Map.tif"


regions = json.loads((ROOT / "assets/earth-surface/regions.json").read_text())
seen = set()
for region in regions:
    if not re.fullmatch("[a-z]+", region["id"]) or region["id"] in seen:
        raise ValueError("Region identifiers must be unique lowercase words")
    seen.add(region["id"])
    if not all(isinstance(region[k], int) and 1 <= region[k] <= 4 for k in ("columns", "rows")):
        raise ValueError("This pilot supports at most 4 by 4 pages per region")
    if not (math.isfinite(region["step"]) and 0 < region["step"] <= 1 and
            -180 <= region["west"] < region["west"] + region["columns"] * region["step"] <= 180 and
            -90 <= region["north"] - region["rows"] * region["step"] < region["north"] <= 90):
        raise ValueError("Invalid region bounds or page size")
out = ROOT / "assets/earth-surface/v1"
scratch = ROOT / ".cache/earth-surface"
scratch.mkdir(parents=True, exist_ok=True)
manifest = {"version": 1, "year": YEAR, "size": SIZE, "gutter": GUTTER,
            "sourceBands": ["B04", "B03", "B02", "B08"], "reflectanceScale": 0.0001, "regions": []}

# The COG server supports HTTP Range; bounded GDAL cache and retries. These are
# build-time resources, separate from the browser's CPU/GPU and offline cache.
with rasterio.Env(GDAL_CACHEMAX=64 * 1024 * 1024, GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                  CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="1"):
    for region in regions:
        west, north, step = region["west"], region["north"], region["step"]
        east, south = west + step * region["columns"], north - step * region["rows"]
        padding = step * GUTTER / CORE
        urls = {True: [], False: []}
        for composite, span in ((True, 1), (False, 3)):
            for lat in range(math.floor((south-padding)/span)*span, math.ceil((north+padding)/span)*span, span):
                for lon in range(math.floor((west-padding)/span)*span, math.ceil((east+padding)/span)*span, span):
                    urls[composite].append(source(lat, lon, composite))
        directory = out / region["id"]
        directory.mkdir(parents=True, exist_ok=True)
        pages = []
        with ExitStack() as stack:
            sources = {kind: [stack.enter_context(rasterio.open(url)) for url in paths] for kind, paths in urls.items()}
            for src in sources[True]:
                # Read the storage contract, not Sentinel's numerical band ordering.
                order = re.findall(r"Band \d+: (B\d{2})", src.tags().get("bands", ""))
                if order != ["B04", "B03", "B02", "B08"] or not all(abs(scale - 0.0001) < 1e-10 for scale in src.scales):
                    raise ValueError(f"Unexpected RGBNIR band order/scale: {src.name}, {order}, {src.scales}")
            for y in range(region["rows"]):
                for x in range(region["columns"]):
                    name = f"{x}-{y}"
                    bounds = (west+x*step-padding, north-(y+1)*step-padding, west+(x+1)*step+padding, north-y*step+padding)
                    transform = from_bounds(*bounds, SIZE, SIZE)
                    colour = np.zeros((3, SIZE, SIZE), dtype=np.uint16)
                    classes = np.zeros((SIZE, SIZE), dtype=np.uint8)
                    for kind in (True, False):
                        for src in sources[kind]:
                            if src.bounds.right <= bounds[0] or src.bounds.left >= bounds[2] or src.bounds.top <= bounds[1] or src.bounds.bottom >= bounds[3]:
                                continue
                            with WarpedVRT(src, crs="EPSG:4326", transform=transform, width=SIZE, height=SIZE,
                                           resampling=Resampling.bilinear if kind else Resampling.nearest, nodata=0) as vrt:
                                data = vrt.read(RGB_BANDS if kind else 1)
                                if kind:
                                    mask = np.any(data > 0, axis=0)
                                    colour[:, mask] = data[:, mask]
                                else:
                                    mask = data > 0
                                    classes[mask] = data[mask]
                    # Reflectance scaled by 10,000 is linear. Encode to sRGB for
                    # GPU decoding; no baked lighting or artificial exposure gain.
                    rgba = encode_srgb(colour, classes)
                    Image.fromarray(rgba).save(scratch / f"{region['id']}-{name}.png")
                    (directory / f"{name}.classes.gz").write_bytes(gzip.compress(classes.tobytes(), mtime=0))
                    pages.append(name)
                    print(f"{region['id']} {name}: {np.count_nonzero(rgba[:,:,3]) / SIZE**2:.1%} valid", flush=True)
        manifest["regions"].append({**region, "pages": pages, "sources": urls[True] + urls[False]})
(scratch / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
