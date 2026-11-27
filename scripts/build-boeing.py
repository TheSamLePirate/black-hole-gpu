"""Build the airport traffic Boeings from FGAddon model directories (see assets/traffic/boeing/README.md).
Usage: python3 scripts/build-boeing.py <directory containing 737-800, 777 and 747-400 model files>
"""
import gzip
import json
from a320.trafficrig import prepare, export
from pathlib import Path
import re
import struct
import sys
from xml.etree import ElementTree
import numpy as np
from PIL import Image
from a320.fgac import read_ac, walk
from a320.fgmesh import triangles

source = Path(sys.argv[1])
output = Path("assets/traffic/boeing")
models = {
    "b738": ("737-800", "737-800 LWing RWing HorzStab VertStab nosegear winglet", 150),
    "b772": ("777", "777-200ER", 151),
    "b77w": ("777", "777-300ER", 151),
    "b744": ("747-400", "747-400_fuselage 747-400_wings 747-400_gear", 152),
}
for model, (package, parts, material) in models.items():
    directory = source / package
    components = [(part, np.zeros(3)) for part in parts.split()]
    if model == "b744":
        for node in ElementTree.parse(directory / "747-400_wings.xml").findall("model"):
            if node.findtext("name", "").startswith("engine."):
                components.append(("GE_CF6-80C2B1F", np.array([float(node.findtext("offsets/"+axis+"-m")) for axis in "xyz"])))
    # Retain the paint map resolution on the twins. The 747's UV islands reference nine maps.
    maps = (["737-800.png"] if model == "b738" else ["paint1.png"] if package == "777" else
            sorted(["747-400_engine.png","747-400_gear.png","747-400_misc.png","747-400_tire1.png",
                    "747-400_tire3.png","747-400_wingbottom.png","747-400_wingtop.png","BOE.png","cockpit.png"]))
    grid = 3 if model == "b744" else 1
    tile = 2048 // grid
    atlas = Image.new("RGB", (2048, 2048), "white")
    for i, name in enumerate(maps):
        skin = {"paint1.png":"white.png","BOE.png":"blank.png"}.get(name, name)
        im = Image.open(directory/skin).convert("RGB").resize((tile,tile), Image.Resampling.LANCZOS)
        atlas.paste(im, ((i%grid)*tile,(i//grid)*tile))
    atlas.save(output/(package+".jpg"), quality=93)
    corners = []
    nodes, parts = [], {}
    for part, offset in components:
        materials, root = read_ac(str(directory/(part+".ac")))
        xml = directory / (part+".xml")
        if part == "nosegear": xml = directory/"NoseGear.xml"
        if part == "737-800": xml = directory/"737-model-common.xml"
        graph = prepare(root, xml, offset)
        export(graph, offset, nodes, parts)
        for obj, _ in walk(root):
            name = obj["name"].lower()
            texture = obj["texture"]
            if texture == "light_spot.png" or re.search(r'flare|\.spot|flash|^strobe|^beacon|cabinlighting|^a-light|^navlights|^(red|green)nav|^rlightext',name):
                continue
            tri = triangles(obj)
            if tri is None:
                continue
            p = (tri["pos"] + offset)[:,:,[1,2,0]] * [-1,1,-1]
            n = tri["nrm"][:,:,[1,2,0]] * [-1,1,-1]
            uv = tri["uv"].copy()
            uv[:,:,1] = 1 - uv[:,:,1]
            gear = (part.endswith("gear") or bool(re.search(r'gear(?!door)|strut|tyre|wheel(?!well)|axle|brace|damper|^mg|^frt|^lhmg|^rhmg|^lhgd|^rhgd',name)))
            mat = material + 3*gear
            if texture in maps:
                i = maps.index(texture)
                if grid > 1:
                    uv = (np.clip(uv,0,1)*(tile-1)+0.5 + np.array([i%grid,i//grid])*tile)/2048
            else:
                # Unmapped glass, metal and rubber keep their AC3D diffuse colours.
                rgb = np.array([materials[m].rgb for m in tri["mat"]])
                if texture=="transparent.png" or "window" in name or "glass" in name:
                    rgb[:] = [.14,.22,.27]
                # Same flat-colour packing as carrier parts (90), decoded in ship.wgsl.
                flat = np.round(np.clip(rgb,0,1)*255)
                uv[:,:,0] = (flat[:,1]*256+flat[:,0])[:,None]
                uv[:,:,1] = flat[:,2,None]/255
                mat = 157 if gear else 156
                if texture=="transparent.png" or "window" in name or "glass" in name: mat = 158
                elif "chrome" in name: mat = 159
            count = p.shape[:2]
            corners.append(np.concatenate([p,n,np.full((*count,1),mat),np.full((*count,1),parts.get(id(obj),0)+0.99),uv],axis=2).reshape(-1,10))
    vertices, indices = np.unique(np.concatenate(corners).astype('<f4'),axis=0,return_inverse=True)
    bounds = list(vertices[:,:3].min(0))+list(vertices[:,:3].max(0))
    buf = struct.pack('<4sIII6f',b'TRFC',1,len(vertices),len(indices),*bounds)+vertices.tobytes()+indices.astype('<u4').tobytes()
    (output/(model+'.bin')).write_bytes(gzip.compress(buf,mtime=0))
    (output/(model+"-rig.json")).write_text(json.dumps(nodes,separators=(",",":")))
    print(model,len(indices)//3, "joints",len(nodes), np.round(bounds,2))
