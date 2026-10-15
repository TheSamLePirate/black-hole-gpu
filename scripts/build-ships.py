# The real traffic's container ship (docs/PLAN-AVIATION-AAA.md, T3): the supplied FBX (assets/porte-avion/, kept out
# of the repository) put in its own axes (its rotation and scale applied) and lightened (its large parts decimated
# to a quarter), as a GLB scripts/build-ships.ts reads.
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/build-ships.py -- <Ship.fbx> <out.glb> 0.25
import bpy, sys
argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, ratio = argv[0], argv[1], float(argv[2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = [o for o in bpy.context.scene.objects if o.type=='MESH'][0]
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
for o in bpy.context.scene.objects:
    if o.type != 'MESH': continue
    if len(o.data.polygons) > 20000:
        m = o.modifiers.new("dec", 'DECIMATE'); m.ratio = ratio
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="dec")
    import mathutils
    ws = [o.matrix_world @ v.co for v in o.data.vertices]
    lo = [min(w[i] for w in ws) for i in range(3)]; hi = [max(w[i] for w in ws) for i in range(3)]
    print("OBJ", o.name, len(o.data.polygons), "lo", [round(x,2) for x in lo], "hi", [round(x,2) for x in hi])
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_apply=True, export_yup=True)
