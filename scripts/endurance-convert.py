# Blender (background) step of scripts/build-endurance.ts: the FBX's 145 objects (instanced meshes)
# made single-user, transforms applied, joined into one mesh, decimated to `ratio` of its triangles
# (1: all of them), triangulated and written as OBJ with its materials.
#
#   Blender -b --python scripts/endurance-convert.py -- in.fbx out.obj ratio
import bpy, sys

argv = sys.argv[sys.argv.index("--") + 1:]
src, out, ratio = argv[0], argv[1], float(argv[2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes:
    o.select_set(True)
bpy.ops.object.make_single_user(object=True, obdata=True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
if ratio < 1:
    m = ob.modifiers.new("dec", 'DECIMATE')
    m.ratio = ratio
    m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier="dec")
m = ob.modifiers.new("tri", 'TRIANGULATE')
bpy.ops.object.modifier_apply(modifier="tri")
print("endurance:", len(ob.data.vertices), "vertices", len(ob.data.polygons), "triangles")
bpy.ops.wm.obj_export(filepath=out, export_selected_objects=True, export_materials=True, export_uv=False,
                      export_normals=False, apply_modifiers=True, forward_axis='Y', up_axis='Z')
