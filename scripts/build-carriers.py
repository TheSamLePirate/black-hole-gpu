# The carriers (docs/PLAN-AVIATION-AAA.md, M2): the supplied models (assets/porte-avion/, kept out of the
# repository) with their objects' transforms applied, the parked aircraft left out (the Kiev's Ka-25s and Yak-38s:
# the deck kept clear to land on), as GLBs scripts/build-carriers.ts reads.
#   Blender -b --python scripts/build-carriers.py -- <src (.fbx | .glb | .blend)> <out.glb> [prefixes to drop] [decimation]
# Beside the GLB, <out>.colours.json: each material's mean colour (its base colour map's) — the parts drawn flat.
import bpy, sys

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
drop = argv[2].split(",") if len(argv) > 2 and argv[2] else []
bpy.ops.wm.read_factory_settings(use_empty=True)
if src.endswith(".blend"):
    bpy.ops.wm.open_mainfile(filepath=src)
elif src.endswith(".glb") or src.endswith(".gltf"):
    bpy.ops.import_scene.gltf(filepath=src)
else:
    bpy.ops.import_scene.fbx(filepath=src)
# (the parked aircraft and what else is named to drop)
for o in list(bpy.context.scene.objects):
    if any(o.name.startswith(p) for p in drop):
        bpy.data.objects.remove(o, do_unlink=True)
for o in list(bpy.context.scene.objects):
    if o.type not in ("MESH", "EMPTY"):
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action="SELECT")
# (instanced meshes — the propellers — made single: their transforms applied one by one)
bpy.ops.object.make_single_user(object=True, obdata=True)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.context.view_layer.objects.active = meshes[0]
# (parented objects: their world transforms kept, then applied)
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# (the heavy objects lightened: a ratio — argv[3] — for those over a size — argv[4], 3 000 faces)
ratio = float(argv[3]) if len(argv) > 3 else 1.0
if ratio < 1.0:
    big = int(argv[4]) if len(argv) > 4 else 3000
    for o in [o for o in bpy.context.scene.objects if o.type == "MESH" and len(o.data.polygons) > big]:
        m = o.modifiers.new("dec", "DECIMATE")
        m.ratio = ratio
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="dec")
# each material's mean colour (its base colour map's, sampled; else its colour): the parts drawn without a map
import json
cols = {}
for mat in bpy.data.materials:
    c = [0.5, 0.5, 0.5]
    if mat.use_nodes:
        bsdf = next((x for x in mat.node_tree.nodes if x.type == "BSDF_PRINCIPLED"), None)
        if bsdf:
            inp = bsdf.inputs["Base Color"]
            if inp.is_linked and inp.links[0].from_node.type == "TEX_IMAGE" and inp.links[0].from_node.image:
                img = inp.links[0].from_node.image
                px = img.pixels[:]
                step = max(4, (len(px) // 4 // 20000) * 4)
                acc = [0.0, 0.0, 0.0]
                k = 0
                for i in range(0, len(px) - 3, step):
                    acc[0] += px[i]; acc[1] += px[i + 1]; acc[2] += px[i + 2]; k += 1
                if k: c = [acc[0] / k, acc[1] / k, acc[2] / k]
            else:
                v = inp.default_value
                c = [v[0], v[1], v[2]]
    cols[mat.name] = [round(x, 4) for x in c]
with open(dst.replace(".glb", ".colours.json"), "w") as f:
    json.dump(cols, f)
n = sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == "MESH")
print("KEPT", len([o for o in bpy.context.scene.objects if o.type == "MESH"]), "objects,", n, "faces")
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_apply=True, export_yup=True)
