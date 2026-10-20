# The title's planispheres (PLAN-TITRE-AAA E6): the Earth, the Moon and Mars as small equirectangular maps
# (longitude −180° at the left, the north up — the game's own day textures), for On foot's place preview.
# python3 scripts/build-title-maps.py → assets/title/map-{earth,moon,mars}.webp
from PIL import Image, ImageEnhance

SRC = {"earth": "assets/textures/earth_daymap.jpg", "moon": "assets/textures/moon_daymap.jpg", "mars": "assets/textures/mars_daymap.jpg"}
for body, path in SRC.items():
    im = Image.open(path).convert("RGB").resize((1024, 512), Image.LANCZOS)
    # (a little darker: the marks drawn over it read better)
    im = ImageEnhance.Brightness(im).enhance(0.82)
    out = f"assets/title/map-{body}.webp"
    im.save(out, "WEBP", quality=50 if body == "moon" else 72, method=6)
    print(out)
