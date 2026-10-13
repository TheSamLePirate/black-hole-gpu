"""
The F-35's texture atlases (docs/PLAN-F35.md, F1), from the images scripts/build-f35.py took out of the model
(assets/airplanes/f35-work/: each material's base colour, metal-roughness and normals, and atlas.json —
which cell of which layer each material's UVs were moved to):

  python3 scripts/build-f35-maps.py        (Pillow; basisu 2.x on the PATH — brew install basis_universal)

Two layers of 4096²: layer 0 the airframe's paint alone (its maps are 4096² already), layer 1 the rest — the
gear, the pilot, the seat and dashboard, the nozzle, the helmet, the canopy's glass, the lights, the visor —,
each scaled into its cell. Three maps a layer: the colour (sRGB; its alpha the glass's cover), the normals
(tangent space, glTF's: +y up the image) and metal-roughness as glTF holds it (g roughness, b metalness;
r = 1; 2048²). Each written as KTX2, UASTC with RDO and Zstandard, mip-mapped (the page transcodes it to BC7 or ASTC:
src/system/ktx2.ts) → assets/f35/f35-{albedo,normal,mr}-{0,1}.ktx2.
"""
import json, os, subprocess, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = f"{ROOT}/assets/airplanes/f35-work"
OUT = f"{ROOT}/assets/f35"
N = 4096
A = json.load(open(f"{WORK}/atlas.json"))
cells, maps = A["cells"], A["maps"]

FLAT = {"base": (128, 128, 128, 255), "normal": (128, 128, 255, 255)}
for layer in (0, 1):
    for kind in ("base", "normal", "mr"):
        img = Image.new("RGBA", (N, N), (0, 0, 0, 255) if kind != "normal" else FLAT["normal"])
        for mat, (L, u0, v0, w, h) in cells.items():
            if L != layer:
                continue
            m = maps[mat]
            W, H = round(w * N), round(h * N)
            if kind in m:
                src = Image.open(f"{WORK}/{m[kind]}").convert("RGBA")
                if kind == "mr":
                    # (glTF: the map times the material's factors)
                    r, g, b, a = src.split()
                    g = g.point(lambda x, k=m["rough"]: round(x * k))
                    b = b.point(lambda x, k=m["metal"]: round(x * k))
                    src = Image.merge("RGBA", (r, g, b, a))
                src = src.resize((W, H), Image.LANCZOS)
            elif kind == "mr":
                src = Image.new("RGBA", (W, H), (255, round(255 * m["rough"]), round(255 * m["metal"]), 255))
            else:
                src = Image.new("RGBA", (W, H), FLAT[kind])
            img.paste(src, (round(u0 * N), round(v0 * N)))
        name = {"base": "albedo", "normal": "normal", "mr": "mr"}[kind]
        png = f"{WORK}/{name}-{layer}.png"
        if kind != "base":
            img = img.convert("RGB")
        if kind == "mr":
            # (roughness and metalness vary slowly: half the size — and a quarter of the bytes)
            img = img.resize((N // 2, N // 2), Image.LANCZOS)
        img.save(png)
        out = f"{OUT}/f35-{name}-{layer}.ktx2"
        # (the atlas layer's colour, busier, a little more: under the 8 MB a file the repository allows)
        rdo = {"base": "3.0" if layer else "2.0", "normal": "2.0", "mr": "3.0"}[kind]
        flags = ["-uastc", "-uastc_level", "1", "-uastc_rdo_l", rdo, "-ktx2", "-ktx2_zstandard_level", "18", "-mipmap"]
        if kind == "normal":
            flags += ["-normal_map"]
        elif kind == "mr":
            flags += ["-linear"]
        subprocess.run(["basisu", *flags, "-output_file", out, png], check=True, stdout=subprocess.DEVNULL)
        print(out, f"{os.path.getsize(out) / 1e6:.1f} MB", flush=True)
