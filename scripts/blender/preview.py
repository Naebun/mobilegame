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


# ---------------------------------------------------------------------------------------------
# Weapons: one Cycles render per view, for reviewing a weapon (and the hands on it) before it goes in the game
# ---------------------------------------------------------------------------------------------

def _game_to_blender(m):
  """A 4x4 in the game's frame (x right, y up, z towards the player) as a 4x4 in the models' frame (z up, y forward)."""
  from mathutils import Matrix
  c = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
  return c @ m @ c.inverted()


def weapon_view(parts, png, view='fp', size=(560, 700), samples=40, hide=(), portrait=True, x=0.15, crop=None, tilts=None):
  """Render one weapon. view: fp (as the game draws the viewmodel), side, top, rear, iso. `hide` lists part names."""
  from mathutils import Euler, Matrix
  sc = bpy.context.scene
  for ob in list(sc.objects):
    bpy.data.objects.remove(ob)
  sc.render.engine = 'CYCLES'
  sc.cycles.device = 'CPU'
  sc.cycles.samples = samples
  sc.cycles.use_denoising = True
  sc.render.resolution_x, sc.render.resolution_y = size
  sc.view_settings.view_transform = 'Standard'
  w = bpy.data.worlds.new('w')
  w.use_nodes = True
  w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.48, 0.5, 1)
  w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.55
  sc.world = w
  objs = []
  for p in parts:
    if p.name in hide:
      continue
    ob = _object(p, 0)
    ob.location = p.origin
    if tilts and p.name in tilts:  # the game tilts the vinyl's platter about x
      ob.rotation_euler = (tilts[p.name], 0, 0)
      bpy.context.view_layer.update()
      disc = bpy.data.objects.new('record', _record())
      disc.parent = ob
      disc.location = (0, 0, 0.0294)
      sc.collection.objects.link(disc)
      objs.append(disc)
    objs.append(ob)

  def sun(direction, energy, colour=(1, 0.97, 0.92)):
    d = bpy.data.lights.new('s', 'SUN')
    d.energy, d.color, d.angle = energy, colour, 0.15
    o = bpy.data.objects.new('s', d)
    o.rotation_euler = (-Vector(direction)).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(o)

  cam = bpy.data.cameras.new('cam')
  co = bpy.data.objects.new('cam', cam)
  sc.collection.objects.link(co)
  sc.camera = co
  if view == 'fp':
    # the game's viewmodel pose: wroot at (0.15, -0.24, -0.62), rotation (0.03, 0.07, 0), scale 0.68, camera at the origin, fov 70
    mg = Matrix.LocRotScale((x, -0.24, -0.62), Euler((0.03, 0.07, 0), 'XYZ'), (0.68, 0.68, 0.68))
    mb = _game_to_blender(mg)
    for ob in objs:
      if ob.parent is None:
        ob.matrix_world = mb @ Matrix.LocRotScale(ob.location, ob.rotation_euler, None)
    cam.sensor_fit = 'VERTICAL'
    cam.angle_y = math.radians(70)  # the game never narrows the viewmodel camera
    co.location = (0, 0, 0)
    co.rotation_euler = (math.pi / 2, 0, 0)
    cam.clip_start = 0.02
    sun((0.5, -0.6, 1.0), 3.0)
    sun((-0.6, 0.2, 0.3), 0.8, (0.7, 0.8, 1.0))
  else:
    cam.clip_start = 0.01
    if view in ('side', 'top', 'lside'):
      cam.type = 'ORTHO'
      cam.ortho_scale = 0.95
    target = Vector((0, 0.05, -0.02))
    loc = {'side': (1.5, 0.05, -0.02), 'top': (0, 0.05, 1.5), 'rear': (0.35, -0.9, 0.18), 'iso': (0.65, -0.6, 0.38),
           'front': (0.5, 0.9, 0.2), 'lside': (-1.5, 0.05, -0.02), 'liso': (-0.65, -0.6, 0.38), 'lfront': (-0.5, 0.9, 0.2)}[view]
    co.location = loc
    co.rotation_euler = (target - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    if view in ('rear', 'iso', 'front', 'liso', 'lfront'):
      cam.lens = 48
    left = view.startswith('l')
    sun((-0.5 if left else 0.5, -0.6, 1.0), 3.0)
    sun((0.6 if left else -0.6, 0.4, 0.3), 1.2, (0.7, 0.8, 1.0))
  if crop:  # a sub-rectangle of the frame, as fractions (x0, x1, y0, y1) with y up, rendered at full resolution
    sc.render.use_border = True
    sc.render.use_crop_to_border = True
    sc.render.border_min_x, sc.render.border_max_x, sc.render.border_min_y, sc.render.border_max_y = crop
  sc.render.filepath = png
  bpy.ops.render.render(write_still=True)
  print('rendered', png)


def _record():
  """A stand-in for the game's spinning record (code in models.js): a black disc with a magenta label."""
  import bmesh as _bm
  me = bpy.data.meshes.new('record')
  bm = _bm.new()
  for r, z, mat in ((0.115, 0.0069, 0), (0.05, 0.0072, 1)):
    ring = [bm.verts.new((r * math.cos(a * math.pi / 12), r * math.sin(a * math.pi / 12), z)) for a in range(24)]
    ring2 = [bm.verts.new((r * math.cos(a * math.pi / 12), r * math.sin(a * math.pi / 12), -0.0069)) for a in range(24)]
    f = bm.faces.new(ring)
    f.material_index = mat
    if mat == 0:
      bm.faces.new(ring2[::-1])
      for i in range(24):
        bm.faces.new((ring[i], ring2[i], ring2[(i + 1) % 24], ring[(i + 1) % 24]))
  bm.to_mesh(me)
  bm.free()
  for col, emit in (((0.01, 0.01, 0.012, 1), 0), ((1.0, 0.1, 0.5, 1), 2.0)):
    m = bpy.data.materials.new('r')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = col
    b.inputs['Roughness'].default_value = 0.3
    if emit:
      b.inputs['Emission Color'].default_value = col
      b.inputs['Emission Strength'].default_value = emit
    me.materials.append(m)
  return me


def weapon_sheet(built, png, views=(('iso', None), ('fp', (0.3, 1.0, 0.0, 0.5))), size=(520, 420), samples=24, tilts=None):
  """A contact sheet of every weapon: one row per view, one column per weapon. Each cell is a separate render, pasted
  into one image (numpy is all the merge needs). `views` is (name, crop) pairs; the fp crop is a fraction of the frame."""
  import numpy as np
  import os
  import tempfile
  tmp = tempfile.mkdtemp()
  cells = []
  for vi, (view, crop) in enumerate(views):
    row = []
    for wid, parts in built.items():
      f = os.path.join(tmp, f'{wid}-{view}.png')
      if view == 'fp':
        sz = (int(390 * 2), int(844 * 2))
        weapon_view(parts, f, 'fp', size=sz, samples=samples, crop=crop, tilts=tilts, x=0.15 - (0.03 if wid in ('launcher', 'vinyl') else 0))
      else:
        weapon_view(parts, f, view, size=size, samples=samples, tilts=tilts)
      img = bpy.data.images.load(f)
      w, h = img.size
      px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
      bpy.data.images.remove(img)
      row.append(px)
    cells.append(row)
  # resize every cell to the cell box by nearest-neighbour sampling, then tile
  cw, ch = size
  out = np.zeros((ch * len(cells), cw * len(cells[0]), 4), dtype=np.float32)
  for r, row in enumerate(cells):
    for c, px in enumerate(row):
      h, w = px.shape[:2]
      s = min(cw / w, ch / h)
      nw, nh = max(1, int(w * s)), max(1, int(h * s))
      ys = (np.arange(nh) / s).astype(int).clip(0, h - 1)
      xs = (np.arange(nw) / s).astype(int).clip(0, w - 1)
      cell = px[ys][:, xs]
      y0, x0 = r * ch + (ch - nh) // 2, c * cw + (cw - nw) // 2
      out[y0:y0 + nh, x0:x0 + nw] = cell
  # blender images are bottom-up, so the first row of cells is the bottom of the array: flip the row order
  flipped = np.concatenate([out[(len(cells) - 1 - r) * ch:(len(cells) - r) * ch] for r in range(len(cells))], axis=0)
  im = bpy.data.images.new('sheet', width=out.shape[1], height=out.shape[0])
  im.pixels = flipped.ravel().tolist()
  im.filepath_raw = png
  im.file_format = 'PNG'
  im.save()
  print('sheet', png)
