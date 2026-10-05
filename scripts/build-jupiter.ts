// Build Jupiter's close-up map from observational imagery, with no synthetic detail.
// Requires basisu and Python/Pillow (PYTHON may name a configured Python executable).
// Raw images stay in assets/tex (git-ignored); the app ships 8K UASTC plus a 4K JPEG fallback.
import { $ } from "bun";
import { mkdirSync, renameSync } from "node:fs";

const source = "https://planetary.s3.amazonaws.com/assets/images/5-jupiter/2018/jupiter_map_css_plus_juno_bj.png";
const raw = "assets/tex/jupiter-cassini-juno.png";
mkdirSync("assets/tex", { recursive: true });
if (!(await Bun.file(raw).exists())) {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Jupiter source: HTTP ${response.status}`);
  await Bun.write(`${raw}.part`, response);
  renameSync(`${raw}.part`, raw);
}
const input = "assets/tex/jupiter-8k.png";
const python = process.env.PYTHON ?? "python3";
const py = `
from PIL import Image
import json, math
Image.MAX_IMAGE_PIXELS = 110000000
im = Image.open("${raw}").convert("RGB")
assert im.size == (14400, 7200), im.size
im8 = im.resize((8192, 4096), Image.Resampling.LANCZOS)
im8.save("${input}")
im.resize((4096, 2048), Image.Resampling.LANCZOS).save("assets/planets-hd/jupiter-color.jpg", quality=95, subsampling=0, optimize=True)
im.resize((2048, 1024), Image.Resampling.LANCZOS).save("assets/planets/jupiter.jpg", quality=95, subsampling=0, optimize=True)
small = im8.resize((64, 32), Image.Resampling.LANCZOS)
def lin(c):
    v = c / 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
s = total = 0
for y in range(32):
    weight = math.cos(((y + 0.5) / 32 - 0.5) * math.pi)
    for x in range(64):
        r,g,b = small.getpixel((x,y))
        s += weight * (0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b))
        total += weight
print(json.dumps({"width":8192,"height":4096,"mean":max(s/total,1e-3)}))
`;
const metadata = JSON.parse(await $`${python} -c ${py}`.text());
const hash = new Bun.CryptoHasher("sha256");
hash.update(await Bun.file(raw).arrayBuffer());
metadata.sourceSha256 = hash.digest("hex");
metadata.source = source;
await Bun.write("assets/planets-hd/jupiter.json", `${JSON.stringify(metadata, null, 2)}\n`);
await $`basisu -uastc -uastc_level 2 -uastc_rdo_l 0.5 -ktx2 -ktx2_zstandard_level 18 -mipmap -output_file assets/planets-hd/jupiter-color.ktx2 ${input}`.quiet();
await $`basisu -uastc -uastc_level 2 -uastc_rdo_l 0.5 -ktx2 -ktx2_zstandard_level 18 -mipmap -output_file assets/planets/ktx2/jupiter.ktx2 assets/planets/jupiter.jpg`.quiet();
const meansPath = "assets/planets/ktx2/means.json";
const means = await Bun.file(meansPath).json();
means.jupiter = metadata.mean;
await Bun.write(meansPath, `${JSON.stringify(means, null, 1)}\n`);
console.log("Jupiter 8K KTX2 + 4K JPEG built", metadata);
