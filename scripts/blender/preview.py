"""Cycles contact sheet of the drinks, for reviewing the models in Blender before they go into the game.
Used by drinks.py --preview. Cycles on the CPU is all a headless container has; keep the samples low."""
import math

import bpy
from mathutils import Vector

import kit

SPACING = 0.2


def _material(part):
  m = bpy.data.materials.new(part.name)
  m.use_nodes = True
  nt = m.node_tree
  nt.nodes.clear()
  out = nt.nodes.new('ShaderNodeOutputMaterial')
  if part.kind == 'pbr':
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    col = nt.nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'col'
    sf = nt.nodes.new('ShaderNodeVertexColor')
    sf.layer_name = 'sf'
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(sf.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Red'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Metallic'])
  elif part.kind in ('glass', 'darkglass'):
    bsdf = nt.nodes.new('ShaderNodeBsdfGlass') if part.kind == 'glass' else nt.nodes.new('ShaderNodeBsdfPrincipled')
    if part.kind == 'glass':
      bsdf.inputs['IOR'].default_value = 1.5
      bsdf.inputs['Roughness'].default_value = 0.02
    else:
      bsdf.inputs['Base Color'].default_value = (0.01, 0.025, 0.015, 1)
      bsdf.inputs['Roughness'].default_value = 0.05
      bsdf.inputs['Transmission Weight'].default_value = 0.6
      bsdf.inputs['IOR'].default_value = 1.5
  elif part.kind == 'liquid':
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    c0, c1 = (kit.hex_rgb(h) for h in part.grad[:2])
    mid = [kit.to_linear((a + b) / 2) for a, b in zip(c0, c1)]
    bsdf.inputs['Base Color'].default_value = (*mid, 1)
    bsdf.inputs['Roughness'].default_value = 0.2 if part.name != 'foam' else 0.8
    bsdf.inputs['Emission Color'].default_value = (*mid, 1)
    bsdf.inputs['Emission Strength'].default_value = 0.35
  else:  # glow
    bsdf = nt.nodes.new('ShaderNodeEmission')
    bsdf.inputs['Color'].default_value = (*[kit.to_linear(c) for c in kit.hex_rgb(part.glow[0])], 1)
    bsdf.inputs['Strength'].default_value = 4.0
  nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
  return m


def _object(part, x):
  me = part.mesh.copy()
  verts, nors, cols, sfs, idx = part.packed
  # corner colours for the preview: the baked values, matched through the same unique-vertex keys
  if part.kind == 'pbr':
    me.calc_loop_triangles()
    ca = me.color_attributes.new('col', 'FLOAT_COLOR', 'CORNER')
    sa = me.color_attributes.new('sf', 'FLOAT_COLOR', 'CORNER')
    k = 0
    for tri in me.loop_triangles:
      for li in tri.loops:
        vi = idx[k]
        c = cols[vi]
        ca.data[li].color = (kit.to_linear(c[0]), kit.to_linear(c[1]), kit.to_linear(c[2]), 1)
        sa.data[li].color = (sfs[vi][0], sfs[vi][1], 0, 1)
        k += 1
  ob = bpy.data.objects.new(part.name, me)
  ob.location = Vector((x, 0, 0)) + part.origin
  ob.data.materials.append(_material(part))
  bpy.context.scene.collection.objects.link(ob)
  return ob


def scene(built, png, blend):
  sc = bpy.context.scene
  for ob in list(sc.objects):  # the default cube, camera and light
    bpy.data.objects.remove(ob)
  sc.render.engine = 'CYCLES'
  sc.cycles.device = 'CPU'
  sc.cycles.samples = 48
  sc.cycles.use_denoising = True
  sc.render.resolution_x, sc.render.resolution_y = 1800, 800
  sc.render.film_transparent = False
  sc.view_settings.view_transform = 'Standard'
  w = bpy.data.worlds.new('w')
  w.use_nodes = True
  w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.016, 0.014, 1)
  w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
  sc.world = w
  n = len(built)
  for i, (did, parts) in enumerate(built.items()):
    x = (i - (n - 1) / 2) * SPACING
    low = min(min(v.z for v in p.packed[0]) + p.origin.z for p in parts)  # stand each drink on the bar
    for p in parts:
      ob = _object(p, x)
      ob.location.z -= low
  # a dark bar top
  bpy.ops.mesh.primitive_plane_add(size=3, location=(0, 0, 0))
  floor = bpy.context.active_object
  fm = bpy.data.materials.new('floor')
  fm.use_nodes = True
  b = fm.node_tree.nodes['Principled BSDF']
  b.inputs['Base Color'].default_value = (0.05, 0.028, 0.016, 1)
  b.inputs['Roughness'].default_value = 0.35
  floor.data.materials.append(fm)

  def area(loc, energy, size, colour):
    d = bpy.data.lights.new('l', 'AREA')
    d.energy, d.size, d.color = energy, size, colour
    o = bpy.data.objects.new('l', d)
    o.location = loc
    bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = (Vector((0, 0, 0.1)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()

  area((-0.5, -0.9, 0.8), 90, 0.6, (1.0, 0.82, 0.62))
  area((0.9, -0.7, 0.5), 40, 0.5, (0.7, 0.8, 1.0))
  area((0.0, 0.9, 0.55), 70, 0.8, (1.0, 0.7, 0.5))
  cam = bpy.data.cameras.new('cam')
  cam.lens = 52
  co = bpy.data.objects.new('cam', cam)
  co.location = (0, -2.0, 0.2)
  co.rotation_euler = (Vector((0, 0, 0.2)) - co.location).to_track_quat('-Z', 'Y').to_euler()
  bpy.context.scene.collection.objects.link(co)
  sc.camera = co
  if blend:
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print('saved', blend)
  if png:
    sc.render.filepath = png
    bpy.ops.render.render(write_still=True)
    print('rendered', png)
