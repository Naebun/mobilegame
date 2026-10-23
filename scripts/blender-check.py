"""Checks that Blender (the bpy module) is installed and can work headless here.
Run with: /home/user/.venvs/blender/bin/python scripts/blender-check.py [out_dir]
Install check only: a 64 x 64 Cycles render of the default cube, a 16 x 16 test bake on a plane, and a list of what is
available. The outputs are throwaway; no game assets are made here."""
import os
import sys
import tempfile

import bpy

out = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()
os.makedirs(out, exist_ok=True)
print("Blender", bpy.app.version_string)

bpy.ops.wm.read_factory_settings(use_empty=False)
scene = bpy.context.scene

# Cycles on the CPU is what a headless container can do (there is no GPU, so no EEVEE). The "CUEW/HIPEW" warnings
# Blender prints just mean there is no CUDA or HIP library; the CPU device is unaffected.
scene.render.engine = "CYCLES"
assert scene.render.engine == "CYCLES", "Cycles is not available"
scene.cycles.device = "CPU"
scene.cycles.samples = 8
scene.render.resolution_x = 64
scene.render.resolution_y = 64
scene.render.filepath = os.path.join(out, "blender-check.png")
bpy.ops.render.render(write_still=True)
size = os.path.getsize(scene.render.filepath)
print("engine used:", scene.render.engine, "| test render:", scene.render.filepath, f"({size} bytes)")
assert size > 100, "render looks empty"

# a tiny bake: a plane with a coloured material baked into a 16 x 16 image, the operation texture work will rely on
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.mesh.primitive_plane_add(size=2)
plane = bpy.context.active_object
mat = bpy.data.materials.new("check")
mat.use_nodes = True
mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.8, 0.2, 0.1, 1.0)
plane.data.materials.append(mat)
img = bpy.data.images.new("bake-check", 16, 16)
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = img
mat.node_tree.nodes.active = tex
scene.cycles.bake_type = "DIFFUSE"
scene.render.bake.use_pass_direct = False
scene.render.bake.use_pass_indirect = False
bpy.ops.object.bake(type="DIFFUSE")
px = list(img.pixels)
avg = [sum(px[i::4]) / (len(px) / 4) for i in range(3)]
print("test bake average colour:", [round(v, 2) for v in avg])
assert max(avg) > 0.1, "bake produced an empty image"

print("glTF exporter available:", hasattr(bpy.ops.export_scene, "gltf"))
print("OK")
