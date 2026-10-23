"""Builds the prop kit for both levels in Blender and writes it to src/prop-meshes.js for the game.
Run with: ~/.venvs/blender/bin/python scripts/blender/props.py [--out src/prop-meshes.js] [--only barrel_a,column_a]
                                                               [--preview sheet.png] [--blend props.blend]

Every prop is modelled on the floor around its own origin in Blender axes (x right, y depth, z up). The front, the side
the player usually sees, is -y; wall props have their back on the plane y = 0 and stick out towards -y. The export
turns that into the game's frame (three = (x, z, -y)), so a prop placed with yaw 0 faces +z.

Each part is tagged with the world mesher it merges into (props, metal, wood, stone, brick, polish, glass, hang, glow
meshers...), so the game's materials stay shared and the draw calls do not rise. The mesher decides roughness and
metalness; here we bake what vertex colour can carry: albedo, edge wear and ambient occlusion (props stand on a
virtual floor, wall props on a virtual wall, so the contact shadows are in). Textured meshers (wood, stone, brick,
polish) multiply their texture by the vertex colour, so parts for them are authored as a tint (see L below).

This file is self-contained on purpose (a small copy of the kit helpers, bevelled box included): kit.py belongs to
the weapons work and may change under it. Output is byte for byte repeatable: nothing here orders data by pointer
hash (no bmesh extrude, bevel or primitive operators; faces are hand-built with explicit outward hints).
"""
import argparse
import base64
import json
import math
import os
import struct
import sys
import time

import bpy  # noqa: F401  (must come first: it makes bmesh and mathutils importable)
import bmesh  # noqa: E402
from mathutils import Euler, Matrix, Vector, noise  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

PI = math.pi
cos, sin = math.cos, math.sin


# ---------------------------------------------------------------------------------------------
# Colour, noise, hashing
# ---------------------------------------------------------------------------------------------

def to_linear(c):
  return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def to_srgb(c):
  c = max(0.0, min(1.0, c))
  return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_rgb(h):
  return ((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255


def rgb_hex(r, g, b):
  return (int(max(0, min(1, r)) * 255 + 0.5) << 16) | (int(max(0, min(1, g)) * 255 + 0.5) << 8) | int(max(0, min(1, b)) * 255 + 0.5)


def L(r, g, b):
  """A colour given in linear light (the way world.js writes its colours), as the sRGB hex this file stores."""
  return rgb_hex(to_srgb(r), to_srgb(g), to_srgb(b))


def smooth(t):
  t = max(0.0, min(1.0, t))
  return t * t * (3 - 2 * t)


def sstep(a, b, x):
  return smooth((x - a) / (b - a))


def pnoise(x, y, z, f):
  return 0.5 + 0.5 * noise.noise(Vector((x * f, y * f, z * f)))


def ih(*a):
  """A small deterministic hash to 0..1."""
  h = 2166136261
  for v in a:
    h = ((h ^ (int(v) & 0xffffffff)) * 16777619) & 0xffffffff
  h ^= h >> 15
  h = (h * 2246822519) & 0xffffffff
  h ^= h >> 13
  return h / 4294967296.0


TEXTURED = ('wood', 'stone', 'brick', 'polish', 'paint', 'flag', 'floorboards', 'carpet', 'concrete', 'plaster')  # meshers whose texture needs good coordinates

# colour a worn edge shows, by mesher: bare metal under paint, raw timber, fresh-cut stone
EDGE = {'props': 0xa59f93, 'metal': 0xc2beb2, 'hang': 0xa59f93, 'wood': 0xd8b88a, 'polish': 0xe4c79c, 'stone': 0xe2ddd0,
        'brick': 0xd6b79c, 'glass': 0xffffff, 'paint': 0xd8d0c0}


# ---------------------------------------------------------------------------------------------
# Builders. Each takes a bmesh and adds faces; every face gets an explicit outward hint so winding is right
# without a recalculation pass (which can flip open meshes).
# ---------------------------------------------------------------------------------------------

def _dedupe(pts):
  out = []
  for p in pts:
    if not out or (p - out[-1]).length > 1e-7:
      out.append(p)
  if len(out) > 1 and (out[0] - out[-1]).length <= 1e-7:
    out.pop()
  return out


def _face(bm, pts, hint):
  pts = _dedupe([Vector(p) for p in pts])
  if len(pts) < 3:
    return None
  n = Vector((0, 0, 0))
  for i in range(1, len(pts) - 1):
    n += (pts[i] - pts[0]).cross(pts[i + 1] - pts[0])
  if n.length < 1e-10:
    return None
  if n.dot(hint) < 0:
    pts.reverse()
  try:
    return bm.faces.new([bm.verts.new(p) for p in pts])
  except ValueError:
    return None


BEVEL = 255  # face tag of chamfer strips: they take the worn-edge colour


def bevbox(lo, hi, b=0.02, floor=False, cuts=None):
  """A box from lo to hi (x, y, z corners) with chamfered edges of width b (a number or an (x, y, z) tuple). `floor`:
  stands on the floor, so no bottom face and no chamfer there. `cuts`: {axis: [coords]} extra grid lines on the faces,
  where baked ambient occlusion needs a vertex to hold a gradient."""
  small = min(hi[a] - lo[a] for a in range(3)) < 0.075  # too small for a chamfer to show: a plain box, no wear
  if small:
    b = 0.0

  def build(bm):
    lt = bm.faces.layers.int['tag']
    bw = b if isinstance(b, (tuple, list)) else (b, b, b)
    cu = cuts or {}
    S = []
    for a in range(3):
      lo_i = lo[a] + (0 if (a == 2 and floor) else bw[a])
      hi_i = hi[a] - bw[a]
      S.append([lo_i] + [c for c in sorted(cu.get(a, ())) if lo_i + 1e-6 < c < hi_i - 1e-6] + [hi_i])
    plane = lambda a, s: hi[a] if s > 0 else lo[a]
    inner = lambda a, s: S[a][-1] if s > 0 else S[a][0]

    def pt(vals):
      return Vector((vals[0], vals[1], vals[2]))

    for a in range(3):
      for s in (-1, 1):
        if a == 2 and s < 0 and floor:
          continue
        a2, a3 = (a + 1) % 3, (a + 2) % 3
        hint = Vector((0, 0, 0))
        hint[a] = s
        for i in range(len(S[a2]) - 1):
          for j in range(len(S[a3]) - 1):
            q = []
            for u, v in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
              c = [0, 0, 0]
              c[a], c[a2], c[a3] = plane(a, s), S[a2][u], S[a3][v]
              q.append(pt(c))
            _face(bm, q, hint)
    if max(bw) < 1e-6:
      return
    for a in range(3):
      for a2 in range(a + 1, 3):
        a3 = 3 - a - a2
        for sa in (-1, 1):
          for sa2 in (-1, 1):
            if floor and ((a == 2 and sa < 0) or (a2 == 2 and sa2 < 0)):
              continue
            hint = Vector((0, 0, 0))
            hint[a], hint[a2] = sa, sa2
            for k in range(len(S[a3]) - 1):
              q = []
              for (pa, pa2, k3) in ((plane(a, sa), inner(a2, sa2), k), (plane(a, sa), inner(a2, sa2), k + 1),
                                    (inner(a, sa), plane(a2, sa2), k + 1), (inner(a, sa), plane(a2, sa2), k)):
                c = [0, 0, 0]
                c[a], c[a2], c[a3] = pa, pa2, S[a3][k3]
                q.append(pt(c))
              f = _face(bm, q, hint)
              if f:
                f[lt] = BEVEL
    for sx in (-1, 1):
      for sy in (-1, 1):
        for sz in (-1, 1):
          if floor and sz < 0:
            continue
          ix, iy, iz = inner(0, sx), inner(1, sy), inner(2, sz)
          f = _face(bm, [pt((plane(0, sx), iy, iz)), pt((ix, plane(1, sy), iz)), pt((ix, iy, plane(2, sz)))], Vector((sx, sy, sz)))
          if f:
            f[lt] = BEVEL
  build.flat = small
  build.facewear = True
  return build


def lathe(pts, seg=12, a0=0.0, a1=2 * PI, rmod=None):
  """Surface of revolution about z. pts: (r, z[, tag]). List the profile with the solid on its right: up an outer
  wall, then inwards across a top. a0..a1 sweeps part of a turn (the other side is hidden), leaving the ends open.
  rmod(r, z, theta, tag) bends the radius (flutes, staves, knurls). Faces get their band's tag and column number."""
  def build(bm):
    lt = bm.faces.layers.int['tag']
    ls = bm.faces.layers.int['seg']
    lr = bm.faces.layers.int['rnd']
    luv = bm.loops.layers.uv['uv']
    uvr = max(p[0] for p in pts)
    full = abs((a1 - a0) - 2 * PI) < 1e-9
    n = seg if full else seg + 1
    rings = []
    for p in pts:
      tag = p[2] if len(p) > 2 else 0
      ring = []
      for j in range(n):
        th = a0 + (a1 - a0) * j / seg
        rr = rmod(p[0], p[1], th, tag) if rmod else p[0]
        ring.append(Vector((rr * cos(th), rr * sin(th), p[1])))
      rings.append(ring)
    for i in range(len(pts) - 1):
      A, B = rings[i], rings[i + 1]
      tag = pts[i + 1][2] if len(pts[i + 1]) > 2 else 0
      dr = pts[i + 1][0] - pts[i][0]
      dz = pts[i + 1][1] - pts[i][1]
      for j in range(seg):
        j2 = (j + 1) % n if full else j + 1
        thm = a0 + (a1 - a0) * (j + 0.5) / seg
        f = _face(bm, [A[j], A[j2], B[j2], B[j]], Vector((dz * cos(thm), dz * sin(thm), -dr)))
        if f:
          f[lt] = tag
          f[ls] = j + 1
          side = abs(dr) < 1.7 * abs(dz)  # steeper than 30 degrees from flat: a wall, not a cap
          f[lr] = 2 if side else 1
          if side:  # cylindrical texture coordinates (arc length, height), unwrapped round this face's own angle
            thc = a0 + (a1 - a0) * (j + 0.5) / seg
            for lp in f.loops:
              c = lp.vert.co
              d = (math.atan2(c.y, c.x) - thc + PI) % (2 * PI) - PI
              lp[luv].uv = ((thc + d) * uvr, c.z)
  build.vwear = True
  return build


def tube(p0, p1, r, seg=6, r1=None, caps=0, twist=0.0):
  """A cylinder or cone between two points. caps: 1 closes the p1 end, 2 both ends."""
  def build(bm):
    a, b = Vector(p0), Vector(p1)
    d = (b - a).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
    u = d.cross(up).normalized()
    w = d.cross(u)
    rr1 = r if r1 is None else r1
    ra, rb = [], []
    for j in range(seg):
      th = twist + 2 * PI * j / seg
      dirv = u * cos(th) + w * sin(th)
      ra.append(a + dirv * r)
      rb.append(b + dirv * rr1)
    lr = bm.faces.layers.int['rnd']
    for j in range(seg):
      j2 = (j + 1) % seg
      thm = twist + 2 * PI * (j + 0.5) / seg
      f = _face(bm, [ra[j], ra[j2], rb[j2], rb[j]], u * cos(thm) + w * sin(thm))
      if f:
        f[lr] = 1
    if caps >= 1:
      _face(bm, rb, d)
    if caps >= 2:
      _face(bm, ra, -d)
  return build


def prism_xz(poly, y0, y1):
  """A polygon in the xz plane extruded from y0 to y1 (y0 < y1): planks, arches, straps."""
  def build(bm):
    area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    s = 1 if area > 0 else -1
    _face(bm, [Vector((x, y0, z)) for x, z in poly], Vector((0, -1, 0)))
    _face(bm, [Vector((x, y1, z)) for x, z in poly], Vector((0, 1, 0)))
    for i in range(len(poly)):
      (xa, za), (xb, zb) = poly[i], poly[(i + 1) % len(poly)]
      _face(bm, [Vector((xa, y0, za)), Vector((xb, y0, zb)), Vector((xb, y1, zb)), Vector((xa, y1, za))],
            Vector(((zb - za) * s, 0, -(xb - xa) * s)))
  return build


def prism_xy(poly, z0, z1):
  """A polygon in the xy plane extruded from z0 to z1 (z0 < z1)."""
  def build(bm):
    area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    s = 1 if area > 0 else -1
    _face(bm, [Vector((x, y, z0)) for x, y in poly], Vector((0, 0, -1)))
    _face(bm, [Vector((x, y, z1)) for x, y in poly], Vector((0, 0, 1)))
    for i in range(len(poly)):
      (xa, ya), (xb, yb) = poly[i], poly[(i + 1) % len(poly)]
      _face(bm, [Vector((xa, ya, z0)), Vector((xb, yb, z0)), Vector((xb, yb, z1)), Vector((xa, ya, z1))],
            Vector(((yb - ya) * s, -(xb - xa) * s, 0)))
  return build


def prism_yz(poly, x0, x1):
  """A polygon in the yz plane extruded from x0 to x1 (x0 < x1): the arch of a chest lid, say."""
  def build(bm):
    area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    s = 1 if area > 0 else -1
    _face(bm, [Vector((x0, y, z)) for y, z in poly], Vector((-1, 0, 0)))
    _face(bm, [Vector((x1, y, z)) for y, z in poly], Vector((1, 0, 0)))
    for i in range(len(poly)):
      (ya, za), (yb, zb) = poly[i], poly[(i + 1) % len(poly)]
      _face(bm, [Vector((x0, ya, za)), Vector((x0, yb, zb)), Vector((x1, yb, zb)), Vector((x1, ya, za))],
            Vector((0, (zb - za) * s, -(yb - ya) * s)))
  return build


def prof(pts, n=2):
  """Profile points (r, z[, fillet radius[, tag]]) to a polyline (r, z, tag), each filleted corner rounded by a quadratic
  Bezier of n steps (same convention as kit.prof)."""
  P = [(p[0], p[1], p[2] if len(p) > 2 else 0.0, p[3] if len(p) > 3 else 0) for p in pts]
  out = []
  for i, (r, z, f, t) in enumerate(P):
    if f <= 0 or i == 0 or i == len(P) - 1:
      out.append((r, z, t))
      continue
    a, b, c = Vector((P[i - 1][0], P[i - 1][1])), Vector((r, z)), Vector((P[i + 1][0], P[i + 1][1]))
    da, dc = a - b, c - b
    la, lc = da.length, dc.length
    k = min(f, la * 0.5, lc * 0.5)
    p0, p2 = b + da / la * k, b + dc / lc * k
    for s in range(n + 1):
      u = s / n
      q = (1 - u) ** 2 * p0 + 2 * u * (1 - u) * b + u * u * p2
      out.append((q.x, q.y, t))
  dedup = [out[0]]
  for p in out[1:]:
    if abs(p[0] - dedup[-1][0]) + abs(p[1] - dedup[-1][1]) > 1e-7:
      dedup.append(p)
  return dedup


# ---------------------------------------------------------------------------------------------
# Parts and models
# ---------------------------------------------------------------------------------------------

class Part:
  """One mesh of a prop, merged into the world mesher `m`. q: lowest quality tier that draws it (0 all, 1 medium and
  high, 2 high only). sw: swap the texture's u and v (vertical staves). tint: the part takes the instance tint.
  glow: [hex, gain] for an unlit HDR part (no baked data, the world draws it flat). gain: the game multiplies the part's
  colour by this (above 1 for timber, whose texture is very dark, in a level that is itself dark)."""

  def __init__(self, m, q=0, sw=False, tint=False, glow=None, wear_default=1.0, gain=1.0):
    self.m, self.q, self.sw, self.tint, self.glow, self.gain = m, q, sw, tint, glow, gain
    self.bm = bmesh.new()
    self.l_rgb = self.bm.faces.layers.int.new('rgb')
    self.l_edge = self.bm.faces.layers.int.new('edge')
    self.l_wear = self.bm.faces.layers.float.new('wear')
    self.l_tag = self.bm.faces.layers.int.new('tag')
    self.l_seg = self.bm.faces.layers.int.new('seg')
    self.l_rnd = self.bm.faces.layers.int.new('rnd')
    self.uv = self.bm.loops.layers.uv.new('uv')
    self.wear_default = wear_default
    self.salt = 0

  def add(self, build, hex=0xffffff, wear=None, edge=None, at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), jit=0.0):
    """Build, transform, colour. hex is a colour or {band tag: colour}. jit: tone jitter per lathe column or face."""
    bm = self.bm
    before = set(bm.faces)
    build(bm)
    new = [f for f in bm.faces if f not in before]
    bm.verts.index_update()
    verts = sorted({v for f in new for v in f.verts}, key=lambda v: v.index)
    if tuple(at) != (0, 0, 0) or tuple(rot) != (0, 0, 0) or tuple(scale) != (1, 1, 1):
      bmesh.ops.transform(bm, matrix=Matrix.LocRotScale(Vector(at), Euler(rot), Vector(scale)), verts=verts)
    ed = EDGE.get(self.m, 0xa59f93) if edge is None else edge
    if getattr(build, 'flat', False):
      wear = 0.0
    wv = self.wear_default if wear is None else wear
    for f in new:
      tag = f[self.l_tag]
      base = hex.get(0, 0xff00ff) if isinstance(hex, dict) else hex
      h = hex.get(tag, base) if isinstance(hex, dict) else hex
      if jit:
        seg = f[self.l_seg]
        if seg > 0:
          t = ih(seg, self.salt)
        else:
          c = f.calc_center_median()
          t = ih(int(c.x * 97), int(c.y * 97), int(c.z * 97) + self.salt)
        k = 1 + jit * (t - 0.5) * 2
        r, g, b = hex_rgb(h)
        h = rgb_hex(r * k, g * k, b * k)
      if tag == BEVEL:  # a chamfer strip: the edge shows worn paint, bare metal or raw timber
        r, g, b = [to_linear(x) for x in hex_rgb(h)]
        er, eg, eb = [to_linear(x) for x in hex_rgb(ed)]
        k = 0.8 * wv
        h = rgb_hex(to_srgb(r + (er - r) * k), to_srgb(g + (eg - g) * k), to_srgb(b + (eb - b) * k))
      f[self.l_rgb] = h
      f[self.l_edge] = ed
      f[self.l_wear] = wv if getattr(build, 'vwear', False) else 0.0
    self.salt += 1
    return self


class Model:
  def __init__(self, name, ground=True, wall=False, sharp=38.0):
    self.name, self.ground, self.wall, self.sharp = name, ground, wall, sharp
    self.parts = []

  def part(self, m, **kw):
    p = Part(m, **kw)
    self.parts.append(p)
    return p


def _finish(part, sharp):
  """Weld, triangulate, mark hard edges (beyond `sharp` degrees) and return a Blender mesh."""
  bm = part.bm
  bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=2e-6)
  bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
  bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='SHORT_EDGE', ngon_method='EAR_CLIP')
  bm.normal_update()
  bm.verts.ensure_lookup_table()
  lr = bm.faces.layers.int['rnd']
  for e in bm.edges:
    if len(e.link_faces) == 2:
      limit = 80.0 if e.link_faces[0][lr] and e.link_faces[1][lr] else sharp  # round parts shade smooth, creases stay hard
      if e.calc_face_angle(0) > math.radians(limit):
        e.smooth = False
  for f in bm.faces:
    f.smooth = True
  me = bpy.data.meshes.new('p')
  bm.to_mesh(me)
  return me


def _convexity(bm):
  """Per vertex edge amount: how hard the sharpest convex edge at the vertex turns (0 flat or smooth-shaded, about 0.3
  at a 45 degree chamfer, 1 at a right angle). Only edges marked sharp count, so a faceted lathe is not 'worn' all over."""
  e = []
  for v in bm.verts:
    worst = 0.0
    for ed in v.link_edges:
      if not ed.smooth and len(ed.link_faces) == 2 and ed.is_convex:
        worst = max(worst, ed.calc_face_angle(0))
    e.append(1 - math.cos(min(math.pi / 2, worst)))
  return e


_DIRS = []
for _i in range(40):  # cosine weighted hemisphere, golden spiral, in a +z frame
  _u = (_i + 0.5) / 40
  _r = math.sqrt(_u)
  _a = _i * 2.399963
  _DIRS.append(Vector((_r * math.cos(_a), _r * math.sin(_a), math.sqrt(max(0.0, 1 - _u)))))


def _ao(bvh, p, n, dist):
  t = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
  t = (t - n * t.dot(n)).normalized()
  b = n.cross(t)
  hit = 0.0
  for d in _DIRS:
    res = bvh.ray_cast(p + n * 4e-4, t * d.x + b * d.y + n * d.z, dist)
    if res[0] is not None:
      hit += 1 - res[3] / dist
  return hit / len(_DIRS)


def bake_model(model, ao_strength=0.6, far=0.45, near=0.09):
  """Finish every part, build the occluder (all parts plus a virtual floor or wall) and bake per-vertex colour."""
  for p in model.parts:
    p.mesh = _finish(p, model.sharp)
    p.edgeamt = _convexity(p.bm)
  verts, polys = [], []
  for p in model.parts:
    if p.glow:
      continue
    base = len(verts)
    verts += [v.co.copy() for v in p.mesh.vertices]
    polys += [tuple(base + i for i in poly.vertices) for poly in p.mesh.polygons]
  if model.ground:
    base = len(verts)
    verts += [Vector((-4, -4, -0.0005)), Vector((4, -4, -0.0005)), Vector((4, 4, -0.0005)), Vector((-4, 4, -0.0005))]
    polys.append((base, base + 1, base + 2, base + 3))
  if model.wall:
    base = len(verts)
    verts += [Vector((-4, 0.0005, -1)), Vector((4, 0.0005, -1)), Vector((4, 0.0005, 5)), Vector((-4, 0.0005, 5))]
    polys.append((base, base + 1, base + 2, base + 3))
  bvh = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
  for p in model.parts:
    pack_part(p, bvh, ao_strength, far, near)
  return bvh


def pack_part(part, bvh, ao_strength, far, near):
  me = part.mesh
  me.calc_loop_triangles()
  rgb = me.attributes['rgb'].data
  edge = me.attributes['edge'].data
  wearf = me.attributes['wear'].data
  rnd = me.attributes['rnd'].data
  uvl = me.uv_layers['uv'].data
  textured = part.m in TEXTURED
  cn = [Vector(n) for n in (c.vector for c in me.corner_normals)]
  keys = {}
  verts, nors, cols, idx, uvs = [], [], [], [], []
  for tri in me.loop_triangles:
    poly = tri.polygon_index
    for li in tri.loops:
      vi = me.loops[li].vertex_index
      n = cn[li]
      cyl = textured and rnd[poly].value == 2
      uv = (round(uvl[li].uv[0], 3), round(uvl[li].uv[1], 3)) if cyl else None
      key = (vi, round(n.x, 3), round(n.y, 3), round(n.z, 3), rgb[poly].value, uv)
      if key not in keys:
        keys[key] = len(verts)
        co = me.vertices[vi].co
        verts.append(co.copy())
        nors.append(n.copy())
        uvs.append(uv)
        if not part.glow:
          c = [to_linear(x) for x in hex_rgb(rgb[poly].value)]
          # slow grime and fine speckle, so flat colour is not quite flat
          g = 0.86 + 0.28 * pnoise(co.x, co.y, co.z, 3.1) + 0.08 * (pnoise(co.x, co.y, co.z, 17) - 0.5)
          c = [x * g for x in c]
          e = part.edgeamt[vi]
          wv = sstep(0.1, 0.28, e + (pnoise(co.x, co.y, co.z, 9.0) - 0.5) * 0.25) * wearf[poly].value
          if wv > 0:
            ec = [to_linear(x) for x in hex_rgb(edge[poly].value)]
            c = [x + (ec[k] - x) * wv * 0.8 for k, x in enumerate(c)]
          occ = 0.0
          if n.length > 0:
            nn = n.normalized()
            occ = 0.62 * _ao(bvh, co, nn, far) + 0.38 * _ao(bvh, co, nn, near)
          k = 1 - ao_strength * min(1.0, occ * 1.15)
          cols.append([to_srgb(x * k) for x in c])
      idx.append(keys[key])
  part.packed = (verts, nors, cols, idx)
  part.uvs = uvs


def _b64(fmt, values):
  return base64.b64encode(struct.pack('<%d%s' % (len(values), fmt), *values)).decode()


def encode_part(part):
  verts, nors, cols, idx = part.packed
  tv = [(v.x, v.z, -v.y) for v in verts]  # to the game's frame
  tn = [(n.x, n.z, -n.y) for n in nors]
  mx = max(max(abs(c) for c in v) for v in tv) or 1e-6
  sc = mx / 32767
  out = {
    'm': part.m,
    'n': len(tv),
    'sc': float('%.7g' % sc),
    'p': _b64('h', [int(round(c / sc)) for v in tv for c in v]),
    'nrm': _b64('b', [int(round(max(-1, min(1, c)) * 127)) for n in tn for c in n]),
    'idx': _b64('H', idx),
  }
  if part.q:
    out['q'] = part.q
  if part.sw:
    out['sw'] = 1
  if part.tint:
    out['tn'] = 1
  if part.gain != 1.0:
    out['g'] = part.gain
  if any(u is not None for u in part.uvs):  # texture coordinates in millimetres for round surfaces, -32768 where the game picks them
    out['uv'] = _b64('h', [v for u in part.uvs for v in ((-32768, -32768) if u is None else (int(round(u[0] * 1000)), int(round(u[1] * 1000))))])
  if part.glow:
    out['glow'] = [part.glow[0], part.glow[1]]
  else:
    out['col'] = _b64('B', [int(round(c * 255)) for col in cols for c in col])
  out['tris'] = len(idx) // 3
  return out


def check_orientation(model):
  """Cast a ray from each face centre along its normal: from outside a closed solid it crosses an even number of
  surfaces. Done piece by piece (connected faces), so overlapping pieces do not confuse it. Returns (flipped, total)."""
  bad = total = 0
  for p in model.parts:
    if p.glow:
      continue
    me = p.mesh
    parent = list(range(len(me.polygons)))

    def find(i):
      while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
      return i

    owner = {}
    for poly in me.polygons:
      for v in poly.vertices:
        if v in owner:
          parent[find(poly.index)] = find(owner[v])
        else:
          owner[v] = poly.index
    groups = {}
    for poly in me.polygons:
      groups.setdefault(find(poly.index), []).append(poly)
    for polys in groups.values():
      vs = sorted({v for q in polys for v in q.vertices})
      remap = {v: i for i, v in enumerate(vs)}
      bvh = BVHTree.FromPolygons([me.vertices[v].co.copy() for v in vs], [tuple(remap[v] for v in q.vertices) for q in polys], epsilon=0.0)
      for poly in polys:
        pos = poly.center + poly.normal * 1e-4
        hits = 0
        for _ in range(12):
          r = bvh.ray_cast(pos, poly.normal)
          if r[0] is None:
            break
          hits += 1
          pos = r[0] + poly.normal * 1e-4
        total += 1
        if hits % 2:
          bad += 1
  return bad, total
# ---------------------------------------------------------------------------------------------
# Colours. Textured meshers (wood, stone, brick, polish) take a tint, written in linear light like world.js does.
# ---------------------------------------------------------------------------------------------

OAK = L(0.84, 0.62, 0.42)
OAK_D = L(0.58, 0.41, 0.27)
OAK_L = L(1.0, 0.82, 0.58)
IRON = L(0.12, 0.12, 0.13)
IRON_D = L(0.07, 0.07, 0.08)
RUST = L(0.2, 0.1, 0.06)
STEEL = L(0.55, 0.55, 0.58)
BRASS = L(0.78, 0.56, 0.2)
BLACK = L(0.03, 0.03, 0.034)
STONE = L(0.78, 0.76, 0.72)
STONE_D = L(0.62, 0.6, 0.57)
STONE_L = L(0.86, 0.84, 0.78)


def rz(z, h, rend, rbel):
  return rend + (rbel - rend) * (1 - (2 * z / h - 1) ** 2)


# ---------------------------------------------------------------------------------------------
# Barrel: oak staves, iron hoops, a dished head with a bung. Level 2's cellar casks and level 1's bar kegs.
# ---------------------------------------------------------------------------------------------

def barrel_parts(m, h=1.05, rend=0.375, rbel=0.47, seg=12, wood=OAK, hoop=IRON_D, hoops=(0.1, 0.3, 0.7, 0.9), arc=None,
                 heads=1, at=(0, 0, 0), rot=(0, 0, 0), bung=True, zs=(0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0), gain=1.0):
  """Adds a barrel's parts to model m, standing on the floor at `at`. seg is the segment count for a full turn; arc:
  (a0, a1) sweeps only the visible side. heads: 0 none, 1 top, 2 both ends."""
  a0, a1 = arc if arc else (0.0, 2 * PI)
  n = max(3, round(seg * (a1 - a0) / (2 * PI)))
  w = []
  if heads == 2:
    w += [(0.0, 0.026, 1), (rend - 0.04, 0.026, 1), (rend - 0.026, -0.012, 0)]
  w += [(rz(f * h, h, rend, rbel) - (0.012 if f == 0 and heads != 2 else 0), f * h, 0) for f in zs]
  if heads:
    w += [(rend - 0.004, h + 0.012, 0), (rend - 0.03, h + 0.012, 0), (rend - 0.042, h - 0.028, 1), (0.05, h - 0.028, 1), (0.0, h - 0.024, 1)]
  body = m.part('wood', sw=True, gain=gain)
  body.add(lathe(w, n, a0, a1), {0: wood, 1: wood}, jit=0.08, at=at, rot=rot)
  hp = m.part('metal')
  for f in hoops:
    z0, z1 = f * h - 0.03, f * h + 0.03
    hp.add(lathe([(rz(z0, h, rend, rbel) + 0.011, z0), (rz(z1, h, rend, rbel) + 0.011, z1), (rz(z1, h, rend, rbel) - 0.002, z1)],
                 n, a0, a1), hoop, wear=0.25, at=at, rot=rot)
  if bung and heads:
    bp = m.part('props', q=2)
    bp.add(lathe([(0.0, h - 0.01), (0.034, h - 0.01), (0.034, h + 0.012), (0.0, h + 0.012)], 8), L(0.1, 0.07, 0.05),
           at=(at[0] + 0.14, at[1] + 0.08, at[2]), rot=rot)


def barrel(variant):
  mdl = Model('barrel_' + variant)
  if variant == 'a':
    barrel_parts(mdl, hoops=(0.1, 0.5, 0.9), zs=(0.0, 0.2, 0.5, 0.8, 1.0), gain=1.8)
  elif variant == 'b':  # a smaller, darker, rustier one
    barrel_parts(mdl, h=0.98, rend=0.36, rbel=0.445, wood=OAK_D, hoop=RUST, hoops=(0.12, 0.5, 0.88), zs=(0.0, 0.2, 0.5, 0.8, 1.0), gain=1.8)
  else:  # newer and paler, brass-banded: the bar's kegs
    barrel_parts(mdl, h=1.0, rend=0.37, rbel=0.455, wood=OAK_L, hoop=BRASS, hoops=(0.1, 0.5, 0.9), zs=(0.0, 0.2, 0.5, 0.8, 1.0), gain=1.3)
  return mdl


def cask_stack():
  """Level 2's 'S': four casks standing, two long ones lying across them. Only the outward arcs of the standing four
  are built, and not their heads: the lying casks sit on them."""
  mdl = Model('cask_stack')
  for k, (sx, sy) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
    a = math.atan2(sy, sx)
    barrel_parts(mdl, h=0.98, rend=0.37, rbel=0.465, seg=9, wood=(OAK, OAK_D, OAK_L, OAK)[k], hoops=(0.14, 0.5, 0.86), zs=(0.0, 0.25, 0.5, 0.75, 1.0),
                 arc=(a - 0.78 * PI, a + 0.78 * PI), heads=0, at=(sx * 0.5, sy * 0.5, 0), gain=1.8)
  for k, sx in enumerate((-0.5, 0.5)):
    barrel_parts(mdl, h=1.86, rend=0.37, rbel=0.455, seg=9, wood=(OAK_D, OAK)[k], hoops=(0.1, 0.3, 0.7, 0.9), heads=2, zs=(0.0, 0.25, 0.5, 0.75, 1.0),
                 at=(sx, 0.93, 1.42), rot=(PI / 2, 0, 0), bung=False, gain=1.8)
  w = mdl.part('wood', gain=1.8)  # cradle boards under the casks
  for sx in (-0.5, 0.5):
    for sy in (-0.62, 0.62):
      w.add(bevbox((sx - 0.2, sy - 0.04, 0.98), (sx + 0.2, sy + 0.04, 1.06), 0.01), OAK_D)
  return mdl


# ---------------------------------------------------------------------------------------------
# Stone column: plinth, moulded base, a slightly swelling shaft, astragal, echinus and abacus up to the ceiling.
# ---------------------------------------------------------------------------------------------

def column(variant='a'):
  mdl = Model('column_' + variant)
  H = 3.4
  tint = STONE if variant == 'a' else L(0.7, 0.68, 0.64)
  s = mdl.part('stone')
  s.add(bevbox((-0.78, -0.78, 0), (0.78, 0.78, 0.3), 0.05, floor=True, cuts={2: [0.1]}), STONE_D)
  s.add(lathe(prof([(0.66, 0.3), (0.66, 0.36, 0.0), (0.58, 0.42, 0.03), (0.52, 0.44)], 1), 10), STONE_D)  # moulded base
  s.add(lathe([(0.52, 0.44), (0.5, 1.5), (0.45, 2.78)], 10), tint, jit=0.05)
  s.add(lathe([(0.45, 2.78), (0.5, 2.8), (0.5, 2.86), (0.45, 2.88)], 10), STONE_D)  # astragal
  s.add(lathe([(0.45, 2.88), (0.6, 3.0), (0.76, 3.16)], 10), tint)  # echinus
  s.add(bevbox((-0.8, -0.8, 3.16), (0.8, 0.8, H), 0.05, cuts={2: [3.3]}), STONE_D)
  return mdl


# ---------------------------------------------------------------------------------------------
# Chest: iron-bound oak with a barrel lid, a brass lock plate and feet. Level 2's 'x'.
# ---------------------------------------------------------------------------------------------

def arch_pts(w, z0, rise, n):
  return [(w * cos(PI * k / n), z0 + rise * sin(PI * k / n)) for k in range(n + 1)]


def chest(variant='a'):
  mdl = Model('chest_' + variant)
  wood = OAK if variant == 'a' else OAK_D
  W, D, B = 0.78, 0.5, 0.58  # half width, half depth, body height
  w = mdl.part('wood', gain=1.8)
  w.add(bevbox((-W, -D, 0.07), (W, D, B), 0.025), wood, jit=0.05)
  # the lid: an arch across the depth (axis along x), so the polygon lives in the yz plane
  arc = [(D * cos(PI * k / 7), B + 0.27 * sin(PI * k / 7)) for k in range(8)]
  w.add(prism_yz([(-D - 0.015, B - 0.04), (D + 0.015, B - 0.04)] + [(y, z) for y, z in reversed(arc[1:-1])], -W - 0.015, W + 0.015),
        wood, jit=0.03)
  m = mdl.part('metal')
  for sx in (-0.5, 0.5):  # straps over the lid and down the front, back and ends of the body
    outer = [(D * 1.04 * cos(PI * k / 7), B + 0.275 * sin(PI * k / 7) + 0.012) for k in range(8)]
    inner = [(D * cos(PI * k / 7) * 1.0, B + 0.27 * sin(PI * k / 7) - 0.0) for k in range(8)]
    m.add(prism_yz(outer + list(reversed(inner)), sx - 0.055, sx + 0.055), IRON_D, wear=0.4)
    for sy in (-1, 1):
      m.add(bevbox((sx - 0.055, sy * (D + 0.012) - 0.012, 0.07), (sx + 0.055, sy * (D + 0.012) + 0.012, B - 0.02), 0.004, cuts={2: [0.3]}), IRON_D, wear=0.4)
  for sx in (-1, 1):  # corner brackets at the feet
    for sy in (-1, 1):
      m.add(bevbox((min(sx * (W - 0.1), sx * (W + 0.025)), min(sy * (D - 0.1), sy * (D + 0.025)), 0.0),
                   (max(sx * (W - 0.1), sx * (W + 0.025)), max(sy * (D - 0.1), sy * (D + 0.025)), 0.16), 0.01, floor=True), IRON_D, wear=0.5)
  b = mdl.part('metal', q=2)
  b.add(bevbox((-0.1, -D - 0.03, 0.34), (0.1, -D, 0.52), 0.008), BRASS, wear=0.6)  # lock plate
  b.add(bevbox((-0.012, -D - 0.035, 0.38), (0.012, -D - 0.028, 0.46), 0.002), BLACK, wear=0.0)  # keyhole
  b.add(bevbox((-0.05, -D - 0.045, B + 0.0), (0.05, -D - 0.012, B + 0.07), 0.008), BRASS, wear=0.6)  # hasp
  for sx in (-1, 1):  # end handles
    b.add(tube((sx * (W + 0.03), -0.09, 0.4), (sx * (W + 0.03), 0.09, 0.4), 0.012, 5, caps=2), IRON, wear=0.2)
    for sy in (-0.09, 0.09):
      b.add(tube((sx * W, sy, 0.4), (sx * (W + 0.03), sy, 0.4), 0.012, 5), IRON, wear=0.2)
  return mdl


# ---------------------------------------------------------------------------------------------
# Flight case: black ply, aluminium edges, ball corners, butterfly latches, recessed handles, gaff tape.
# ---------------------------------------------------------------------------------------------

def flight_case(H, tape, name):
  mdl = Model(name)
  W, D = 0.85, 0.7
  b = mdl.part('props')
  b.add(bevbox((-W, -D, 0.07), (W, D, H), 0.03), L(0.06, 0.06, 0.066), jit=0.05)
  seam = H * 0.62
  b.add(bevbox((-W - 0.004, -D - 0.004, seam - 0.012), (W + 0.004, D + 0.004, seam + 0.012), 0.002), L(0.012, 0.012, 0.014), wear=0.0)
  for k, (x0, x1, z0, z1, col) in enumerate(tape):  # tape strips, stickers
    b.add(bevbox((x0, -D - 0.006, z0), (x1, -D, z1), 0.001), col, wear=0.3)
  m = mdl.part('metal')
  for z0, z1 in ((seam + 0.012, seam + 0.05), (seam - 0.05, seam - 0.012), (H - 0.045, H), (0.07, 0.115)):  # extrusion rails
    m.add(bevbox((-W - 0.012, -D - 0.012, z0), (W + 0.012, D + 0.012, z1), 0.008), STEEL, wear=0.6)
  for sx in (-1, 1):
    for sy in (-1, 1):
      for zc, up in ((0.1, 0), (H - 0.06, 1)):
        m.add(bevbox((sx * W - 0.07 if sx > 0 else sx * W - 0.02, sy * D - 0.07 if sy > 0 else sy * D - 0.02, zc - 0.05),
                     (sx * W + 0.02 if sx > 0 else sx * W + 0.07, sy * D + 0.02 if sy > 0 else sy * D + 0.07, zc + 0.07 if up else zc + 0.09), 0.0), STEEL, wear=0.0)
  for x in (-0.45, 0.45):  # butterfly latches
    m.add(bevbox((x - 0.05, -D - 0.026, seam - 0.075), (x + 0.05, -D - 0.008, seam + 0.075), 0.006), STEEL, wear=0.5)
    m.add(bevbox((x - 0.03, -D - 0.04, seam - 0.02), (x + 0.03, -D - 0.026, seam + 0.02), 0.005), IRON, wear=0.5)
  for sx in (-1, 1):  # recessed end handles
    m.add(bevbox((sx * (W + 0.012) - 0.012, -0.13, H * 0.48), (sx * (W + 0.012) + 0.012, 0.13, H * 0.48 + 0.1), 0.006), STEEL, wear=0.6)
    m.add(bevbox((sx * (W + 0.004) - 0.004, -0.09, H * 0.48 + 0.02), (sx * (W + 0.004) + 0.004, 0.09, H * 0.48 + 0.08), 0.002), BLACK, wear=0.0)
  f = mdl.part('props', q=2)
  for sx in (-0.7, 0.7):
    for sy in (-0.5, 0.5):
      f.add(bevbox((sx - 0.05, sy - 0.05, 0.0), (sx + 0.05, sy + 0.05, 0.07), 0.0, floor=True), L(0.02, 0.02, 0.022), wear=0.0)
  return mdl



# ---------------------------------------------------------------------------------------------
# Crate: a slatted shipping crate with corner posts and iron bands. Level 1's stairwell and cloakroom 'x'.
# ---------------------------------------------------------------------------------------------

def crate(H, name, paint):
  mdl = Model(name)
  W, D = 0.8, 0.75
  w = mdl.part('wood', gain=1.4)
  w.add(bevbox((-W + 0.03, -D + 0.03, 0.06), (W - 0.03, D - 0.03, H - 0.03), 0.01), OAK_D, wear=0.0)  # the dark core: gaps read as shadow
  n = max(3, int(H / 0.2))
  slat = (H - 0.06) / n
  for sy in (-1, 1):
    for k in range(n):  # slats on the long faces
      z0 = 0.06 + k * slat + 0.012
      w.add(bevbox((-W + 0.1, min(sy * (D - 0.03), sy * D), z0), (W - 0.1, max(sy * (D - 0.03), sy * D), z0 + slat - 0.024), 0.008),
            OAK_L if (k + (sy > 0)) % 2 else OAK, jit=0.08)
  for sx in (-1, 1):
    for k in range(n):  # and on the ends
      z0 = 0.06 + k * slat + 0.012
      w.add(bevbox((min(sx * (W - 0.03), sx * W), -D + 0.1, z0), (max(sx * (W - 0.03), sx * W), D - 0.1, z0 + slat - 0.024), 0.008),
            OAK if (k + (sx > 0)) % 2 else OAK_L, jit=0.08)
  for sx in (-1, 1):  # corner posts
    for sy in (-1, 1):
      w.add(bevbox((min(sx * (W - 0.1), sx * W), min(sy * (D - 0.1), sy * D), 0.0), (max(sx * (W - 0.1), sx * W), max(sy * (D - 0.1), sy * D), H), 0.0, floor=True), OAK_L, jit=0.05)
  w.add(bevbox((-W - 0.015, -D - 0.015, H - 0.03), (W + 0.015, D + 0.015, H + 0.025), 0.01), OAK, jit=0.03)  # lid
  m = mdl.part('metal')
  for z0 in (0.14, H - 0.2):  # iron bands round the crate
    m.add(bevbox((-W - 0.018, -D - 0.018, z0), (W + 0.018, D + 0.018, z0 + 0.06), 0.006), IRON, wear=0.5)
  p = mdl.part('props')
  p.add(bevbox((paint[0], -D - 0.02, 0.28), (paint[1], -D - 0.018, 0.28 + paint[2]), 0.0), paint[3], wear=0.2)  # a stencilled patch
  return mdl


# ---------------------------------------------------------------------------------------------
# Tomb: a chest tomb on a plinth with raised panels and a coped lid, a cross or a worn effigy on top.
# ---------------------------------------------------------------------------------------------

def tomb(variant):
  mdl = Model('tomb_' + variant)
  s = mdl.part('stone')
  tint = STONE if variant != 'c' else L(0.66, 0.62, 0.6)
  s.add(bevbox((-0.7, -1.0, 0), (0.7, 1.0, 0.14), 0.035, floor=True), STONE_D)
  s.add(bevbox((-0.6, -0.9, 0.14), (0.6, 0.9, 0.6), 0.025, cuts={2: [0.22, 0.5]}), tint, jit=0.04)
  s.add(bevbox((-0.7, -1.0, 0.6), (0.7, 1.0, 0.76), 0.04), STONE_L if variant != 'c' else tint)
  for sx in (-1, 1):  # raised panels on the long sides
    for y0, y1 in ((-0.8, -0.04), (0.04, 0.8)):
      s.add(bevbox((min(sx * 0.6, sx * 0.62), y0, 0.24), (max(sx * 0.6, sx * 0.62), y1, 0.52), 0.01), STONE_L, wear=0.5)
  for sy in (-1, 1):
    s.add(bevbox((-0.48, min(sy * 0.9, sy * 0.92), 0.24), (0.48, max(sy * 0.9, sy * 0.92), 0.52), 0.01), STONE_L, wear=0.5)
  if variant == 'b':  # a recumbent figure, worn smooth: head on a pillow, shroud, crossed hands
    s.add(bevbox((-0.2, -0.62, 0.76), (0.2, -0.38, 0.84), 0.03), STONE_L)
    s.add(lathe(prof([(0.0, -0.1), (0.11, -0.1), (0.13, 0.0), (0.11, 0.12), (0.0, 0.14)]), 8), STONE_L, at=(0, -0.5, 0.97), scale=(1, 1.15, 1))
    s.add(prism_xy([(-0.17, -0.38), (0.17, -0.38), (0.2, 0.0), (0.14, 0.78), (-0.14, 0.78), (-0.2, 0.0)], 0.76, 0.87), STONE_L)
    s.add(prism_xy([(-0.12, -0.12), (0.12, -0.12), (0.12, 0.04), (-0.12, 0.04)], 0.87, 0.9), STONE_L)
  else:
    s.add(bevbox((-0.42, -0.82, 0.76), (0.42, 0.82, 0.82), 0.025), STONE_L)
    s.add(bevbox((-0.07, -0.55, 0.82), (0.07, 0.55, 0.86), 0.012), STONE_D, wear=0.8)  # carved cross
    s.add(bevbox((-0.28, -0.08, 0.82), (0.28, 0.06, 0.86), 0.012), STONE_D, wear=0.8)
  if variant == 'c':  # the Tour's tomb carries a velvet runner
    p = mdl.part('props')
    p.add(bevbox((-0.5, -0.2, 0.88), (0.5, 0.6, 0.9), 0.004), L(0.35, 0.05, 0.08), wear=0.0)
  return mdl


# ---------------------------------------------------------------------------------------------
# Hand cart: plank bed and sides, two spoked wheels on an axle, two handles. Long axis along x, handles to +x.
# ---------------------------------------------------------------------------------------------

def cart(variant):
  mdl = Model('cart_' + variant)
  w = mdl.part('wood', gain=1.8)
  w.add(bevbox((-0.88, -0.52, 0.56), (0.88, 0.52, 0.64), 0.015), OAK, jit=0.04)
  for sy in (-1, 1):  # side boards and posts
    w.add(bevbox((-0.88, min(sy * 0.5, sy * 0.56), 0.64), (0.88, max(sy * 0.5, sy * 0.56), 0.9), 0.012), OAK_D, jit=0.05)
    for x in (-0.82, 0.0, 0.82):
      w.add(bevbox((x - 0.035, min(sy * 0.5, sy * 0.59), 0.6), (x + 0.035, max(sy * 0.5, sy * 0.59), 0.94), 0.01), OAK, wear=0.8)
  w.add(bevbox((-0.92, -0.55, 0.64), (-0.84, 0.55, 0.9), 0.012), OAK_D, jit=0.04)  # tailboard
  for sy in (-0.3, 0.3):  # the shafts rest on the ground at the front, inside the tile
    w.add(tube((0.7, sy, 0.62), (0.94, sy * 1.1, 0.08), 0.032, 5), OAK, wear=0.5)
  m = mdl.part('metal')
  m.add(tube((0.0, -0.66, 0.42), (0.0, 0.66, 0.42), 0.03, 6, caps=2), IRON, wear=0.3)  # the axle
  for sy in (-1, 1):
    m.add(bevbox((-0.12, min(sy * 0.44, sy * 0.53), 0.52), (0.12, max(sy * 0.44, sy * 0.53), 0.58), 0.008), IRON_D, wear=0.5)
    wy = sy * 0.62
    m.add(lathe([(0.395, -0.034), (0.42, -0.034), (0.42, 0.034), (0.395, 0.034)], 12), IRON_D, wear=0.4, rot=(PI / 2, 0, 0), at=(0, wy, 0.42))  # tyre
    m.add(lathe([(0.04, -0.05), (0.08, -0.05), (0.08, 0.05), (0.04, 0.05)], 6), IRON, wear=0.3, rot=(PI / 2, 0, 0), at=(0, wy + sy * 0.03, 0.42))  # hub
  ww = mdl.part('wood', gain=1.8)
  for sy in (-1, 1):
    wy = sy * 0.62
    ww.add(lathe([(0.33, -0.028), (0.396, -0.028), (0.396, 0.028), (0.33, 0.028)], 12), OAK_D, jit=0.1, rot=(PI / 2, 0, 0), at=(0, wy, 0.42))  # felloe
    for k in range(4):  # eight spokes, four long sticks through the hub
      a = PI * k / 4
      ww.add(tube((-0.34 * cos(a), wy, 0.42 - 0.34 * sin(a)), (0.34 * cos(a), wy, 0.42 + 0.34 * sin(a)), 0.02, 4), OAK, wear=0.3, at=(0, 0, 0))
  if variant == 'b':  # sacks of something, and a tied bundle
    p = mdl.part('props')
    for (x, y, r) in ((-0.4, -0.2, 0.3), (0.2, 0.15, 0.27)):
      p.add(lathe(prof([(0.0, 0.0), (r * 0.9, 0.0), (r, 0.14), (r * 0.8, 0.3), (r * 0.35, 0.42), (0.0, 0.45)], 1), 7),
            L(0.45, 0.4, 0.3), jit=0.08, at=(x, y, 0.64), scale=(1, 1.2, 1))
  return mdl


# ---------------------------------------------------------------------------------------------
# Speaker stack: three black cabinets stepping back, a woofer on each of the lower two, horns on top. Level 1's 'S'.
# ---------------------------------------------------------------------------------------------

def woofer(part_m, part_c, r, at):
  """A speaker front at `at` (a point on the baffle), facing -y: steel surround, dark cone with a ridge, dust cap."""
  rot = (PI / 2, 0, 0)  # lathe z -> -y: out of the cabinet
  part_m.add(lathe([(r + 0.015, 0.0), (r + 0.015, 0.022), (r - 0.07, 0.03)], 10), STEEL, wear=0.3, rot=rot, at=at)
  part_c.add(lathe([(r - 0.07, 0.03), (r - 0.2, 0.026), (0.1, 0.034), (0.0, 0.034)], 10), L(0.025, 0.025, 0.028), rot=rot, at=at, wear=0.0)
  part_c.add(lathe([(0.1, 0.034), (0.08, 0.05), (0.0, 0.058)], 10), L(0.08, 0.08, 0.085), rot=rot, at=at, wear=0.0)


def speaker():
  mdl = Model('speaker')
  c = mdl.part('props')
  m = mdl.part('metal')
  cab = L(0.026, 0.026, 0.03)
  tiers = [(0.06, 0.98, 0.95), (0.98, 1.9, 0.62), (1.9, 2.8, 0.3)]  # z0, z1, how far back the cabinet goes
  for z0, z1, back in tiers:
    c.add(bevbox((-0.95, -0.95, z0), (0.95, back, z1 - 0.012), 0.03), cab, jit=0.04)
  for y in (-0.8, 0.5):  # runners under the bottom cabinet
    c.add(bevbox((-0.9, y - 0.05, 0.0), (0.9, y + 0.05, 0.07), 0.0, floor=True), L(0.02, 0.02, 0.022))
  woofer(m, c, 0.4, (0, -0.935, 0.52))  # the cone sits a little into the baffle, so nothing leaves the tile
  woofer(m, c, 0.4, (0, -0.935, 1.44))
  for x in (-0.36, 0.36):  # the horns: a flared box mouth on a dark plate
    c.add(bevbox((x - 0.27, -0.97, 2.14), (x + 0.27, -0.95, 2.62), 0.0), L(0.02, 0.02, 0.022), wear=0.0)
    for z in (2.2, 2.42):
      m.add(bevbox((x - 0.25, -0.99, z), (x + 0.25, -0.95, z + 0.03), 0.0), STEEL, wear=0.0)
    m.add(bevbox((x - 0.27, -0.99, 2.1), (x + 0.27, -0.95, 2.14), 0.0), STEEL, wear=0.0)
    m.add(bevbox((x - 0.27, -0.99, 2.62), (x + 0.27, -0.95, 2.66), 0.0), STEEL, wear=0.0)
  for z0, z1, back in tiers[:2]:  # steel corner caps on the front edges and a handle on each side
    for sx in (-1, 1):
      m.add(bevbox((sx * 0.95 - 0.02 if sx > 0 else sx * 0.95 - 0.04, -0.97, z0), (sx * 0.95 + 0.04 if sx > 0 else sx * 0.95 + 0.02, -0.86, z0 + 0.1)), STEEL, wear=0.0)
      m.add(bevbox((sx * 0.95 - 0.015 if sx > 0 else sx * 0.95 - 0.045, -0.2, (z0 + z1) / 2 + 0.05), (sx * 0.95 + 0.045 if sx > 0 else sx * 0.95 + 0.015, 0.2, (z0 + z1) / 2 + 0.12)), IRON, wear=0.0)
  m.add(bevbox((-0.5, 0.95, 0.35), (0.5, 0.97, 0.7)), IRON_D, wear=0.0)  # connector plate on the back
  return mdl


# ---------------------------------------------------------------------------------------------
# Round table with three stools: polished top, cast pedestal, a candle and a glass. Level 1's 'o'.
# ---------------------------------------------------------------------------------------------

def table():
  mdl = Model('table')
  p = mdl.part('polish')
  p.add(lathe(prof([(0.14, 0.78), (0.5, 0.782), (0.545, 0.805), (0.545, 0.84, 0.02), (0.5, 0.866), (0.0, 0.866)], 1), 12), L(0.62, 0.45, 0.28), jit=0.03)
  m = mdl.part('metal')
  m.add(lathe([(0.34, 0.0), (0.34, 0.025), (0.1, 0.13), (0.075, 0.22), (0.075, 0.7), (0.14, 0.78)], 6), IRON, wear=0.4)
  s_ = mdl.part('props')
  for k in range(3):  # stools
    a = k * 2 * PI / 3 + 0.35
    sx, sy = cos(a) * 0.78, sin(a) * 0.78
    m.add(lathe([(0.18, 0.0), (0.05, 0.05), (0.032, 0.1), (0.032, 0.56)], 6), IRON, wear=0.3, at=(sx, sy, 0))
    s_.add(lathe([(0.0, 0.55), (0.19, 0.57), (0.205, 0.62), (0.19, 0.665), (0.0, 0.67)], 8), L(0.32, 0.06, 0.08), at=(sx, sy, 0), jit=0.06)
  g = mdl.part('glass', q=2)
  g.add(lathe([(0.04, 0.866), (0.05, 0.95), (0.052, 0.99)], 6), L(0.5, 0.5, 0.46), at=(0.2, -0.12, 0))
  c = mdl.part('props', q=2)
  c.add(lathe([(0.0, 0.866), (0.045, 0.866), (0.04, 0.885), (0.0, 0.885)], 6), BRASS, at=(-0.12, 0.05, 0), wear=0.0)
  c.add(lathe([(0.018, 0.885), (0.018, 0.94), (0.0, 0.94)], 5), L(0.8, 0.76, 0.62), at=(-0.12, 0.05, 0), wear=0.0)
  mdl.part('gPend', q=2, glow=[0xffa040, 3.0]).add(lathe([(0.0, 0.94), (0.012, 0.95), (0.0, 0.975)], 4), 0xffa040, at=(-0.12, 0.05, 0))
  return mdl


# ---------------------------------------------------------------------------------------------
# Coat rail: iron frame and a steel pole with six coats on hangers. Level 1's 'r'. a: winter coats, b: bright costumes.
# ---------------------------------------------------------------------------------------------

COATS_A = [L(0.1, 0.1, 0.14), L(0.22, 0.17, 0.12), L(0.3, 0.3, 0.32), L(0.16, 0.08, 0.1), L(0.12, 0.2, 0.16), L(0.35, 0.28, 0.2)]
COATS_B = [L(0.6, 0.12, 0.2), L(0.75, 0.62, 0.15), L(0.12, 0.35, 0.45), L(0.5, 0.2, 0.55), L(0.8, 0.8, 0.78), L(0.7, 0.3, 0.1)]


def rail(variant):
  mdl = Model('rail_' + variant)
  m = mdl.part('metal')
  for sx in (-0.85, 0.85):
    m.add(tube((sx, 0, 0.04), (sx, 0, 1.55), 0.022, 6), IRON, wear=0.0)
    m.add(bevbox((sx - 0.04, -0.55, 0.0), (sx + 0.04, 0.55, 0.05), 0.0, floor=True), IRON, wear=0.0)
  m.add(tube((-0.88, 0, 1.52), (0.88, 0, 1.52), 0.026, 8, caps=2), STEEL, wear=0.0)
  cols = COATS_A if variant == 'a' else COATS_B
  c = mdl.part('props')
  for k in range(6):
    x = -0.72 + k * 0.29
    ln = 0.8 + ih(k, 7, 70) * 0.35
    top = 1.46
    c.add(lathe([(0.23, top - ln), (0.21, top - 0.4), (0.17, top - 0.08), (0.0, top)], 6,
                rmod=lambda r, z, th, tag: r * (1 + 0.07 * cos(3 * th + x * 9))), cols[k], at=(x, 0, 0), scale=(1, 0.55, 1), jit=0.1, wear=0.0)
    m.add(tube((x - 0.13, 0, top - 0.03), (x, 0, top + 0.05), 0.008, 3), STEEL, wear=0.0)
    m.add(tube((x + 0.13, 0, top - 0.03), (x, 0, top + 0.05), 0.008, 3), STEEL, wear=0.0)
  return mdl


# ---------------------------------------------------------------------------------------------
# Booth: a buttoned leather lounge seat on a dark plinth with a channelled backrest. Level 1's 'v'. Back at +y.
# ---------------------------------------------------------------------------------------------

def booth():
  mdl = Model('booth')
  LEATHER = L(0.3, 0.06, 0.08)
  w = mdl.part('props')
  w.add(bevbox((-0.95, -0.95, 0.0), (0.95, 0.95, 0.4), 0.04, floor=True), L(0.09, 0.05, 0.05))
  w.add(bevbox((-0.93, -0.94, 0.4), (0.93, 0.5, 0.6), 0.06), LEATHER, jit=0.04)  # seat cushion
  for k in range(5):  # channelled backrest
    x0 = -0.93 + k * 0.372
    w.add(bevbox((x0 + 0.01, 0.5, 0.6), (x0 + 0.362, 0.95, 1.2), 0.04), LEATHER if k % 2 else L(0.34, 0.07, 0.09), jit=0.03)
  m = mdl.part('metal')
  m.add(bevbox((-0.95, 0.5, 1.2), (0.95, 0.95, 1.26), 0.0), BRASS, wear=0.0)
  b = mdl.part('metal', q=2)
  for k in range(4):
    for z in (0.78, 1.02):
      b.add(lathe([(0.022, 0.0), (0.0, 0.016)], 4), BRASS, wear=0.0, rot=(PI / 2, 0, 0), at=(-0.56 + k * 0.372, 0.495, z))
  return mdl


# ---------------------------------------------------------------------------------------------
# Bar counter section: panelled front, polished top, brass foot rail, a lower stainless back counter. Level 1's 'b'.
# The customer side is -y (south in the game), the staff side +y. A tile wide, so the row reads as one bar.
# ---------------------------------------------------------------------------------------------

def bar():
  mdl = Model('bar')
  p = mdl.part('props')  # painted oxblood panelling on the customer side: it reads in the dark where timber does not
  p.add(bevbox((-1.0, -0.8, 0.0), (1.0, -0.08, 1.04), 0.03, floor=True), L(0.2, 0.045, 0.05), jit=0.03)
  for x0, x1 in ((-0.94, -0.04), (0.04, 0.94)):  # raised and fielded panels
    p.add(bevbox((x0, -0.83, 0.2), (x1, -0.8, 0.92), 0.0), L(0.3, 0.065, 0.07), jit=0.04)
    p.add(bevbox((x0 + 0.05, -0.835, 0.25), (x1 - 0.05, -0.83, 0.87), 0.0), L(0.24, 0.05, 0.055), wear=0.0)
  p.add(bevbox((-1.0, -0.76, 0.0), (1.0, -0.74, 0.12), 0.0), L(0.05, 0.03, 0.025), wear=0.0)  # toe kick
  w = mdl.part('wood')
  w.add(bevbox((-1.0, -0.08, 0.0), (1.0, 0.98, 0.86), 0.03, floor=True), L(0.5, 0.34, 0.22), jit=0.03)  # back counter
  q = mdl.part('polish')
  q.add(bevbox((-1.0, -0.98, 1.04), (1.0, -0.04, 1.12), 0.035), L(0.8, 0.58, 0.38), jit=0.03)  # the bar top
  m = mdl.part('metal')
  m.add(tube((-1.0, -0.88, 0.2), (1.0, -0.88, 0.2), 0.034, 8, caps=0), BRASS, wear=0.0)  # foot rail
  for x in (-0.72, 0.72):
    m.add(bevbox((x - 0.025, -0.88, 0.14), (x + 0.025, -0.8, 0.26), 0.0), BRASS, wear=0.0)
  m.add(bevbox((-1.0, -0.84, 0.99), (1.0, -0.8, 1.03), 0.0), BRASS, wear=0.0)  # a brass band under the top
  m.add(bevbox((-1.0, -0.075, 0.86), (1.0, 0.98, 0.9), 0.012), L(0.5, 0.5, 0.52), wear=0.6)  # stainless worktop
  m.add(bevbox((-0.3, 0.2, 0.895), (0.3, 0.62, 0.9), 0.0), IRON_D, wear=0.0)  # drip tray
  return mdl


# ---------------------------------------------------------------------------------------------
# Brick pillar: a stone plinth and capital round a chamfered brick shaft. Level 1's 'P'.
# ---------------------------------------------------------------------------------------------

def pillar():
  mdl = Model('pillar')
  s = mdl.part('stone')
  s.add(bevbox((-1.0, -1.0, 0.0), (1.0, 1.0, 0.34), 0.06, floor=True, cuts={2: [0.1]}), L(0.8, 0.76, 0.7), jit=0.03)
  s.add(bevbox((-0.92, -0.92, 0.34), (0.92, 0.92, 0.46), 0.03), L(0.78, 0.74, 0.68))
  s.add(bevbox((-0.92, -0.92, 3.0), (0.92, 0.92, 3.14), 0.03), L(0.78, 0.74, 0.68))
  s.add(bevbox((-1.0, -1.0, 3.14), (1.0, 1.0, 3.4), 0.06, cuts={2: [3.27]}), L(0.8, 0.76, 0.7), jit=0.03)
  b = mdl.part('brick')
  b.add(bevbox((-0.85, -0.85, 0.44), (0.85, 0.85, 3.02), 0.07, cuts={2: [0.75, 1.6, 2.5]}), L(0.9, 0.78, 0.74), jit=0.03)
  return mdl


# ---------------------------------------------------------------------------------------------
# Wall torch bracket (back on y = 0, the flame is drawn by the level), hanging brazier, pendant lamp shade.
# ---------------------------------------------------------------------------------------------

def torch():
  mdl = Model('torch', ground=False, wall=True)
  m = mdl.part('metal')
  m.add(bevbox((-0.055, -0.03, 1.46), (0.055, 0.0, 1.8), 0.0), IRON, wear=0.0)  # wall plate
  for z in (1.5, 1.76):
    m.add(tube((0, -0.03, z), (0, -0.045, z), 0.014, 5, caps=1), IRON_D, wear=0.0)  # rivet heads
  m.add(tube((0, -0.03, 1.52), (0, -0.22, 1.56), 0.02, 5), IRON, wear=0.0)  # arm
  m.add(tube((0, -0.03, 1.74), (0, -0.2, 1.62), 0.014, 5), IRON, wear=0.0)  # brace
  m.add(lathe([(0.05, 0.0), (0.085, 0.14), (0.095, 0.22)], 8), IRON, wear=0.2, at=(0, -0.24, 1.58))  # cup
  m.add(lathe([(0.095, 0.2), (0.1, 0.2), (0.1, 0.225), (0.095, 0.225)], 8), IRON_D, wear=0.0, at=(0, -0.24, 1.58))
  p = mdl.part('props')
  p.add(lathe([(0.032, 0.0), (0.036, 0.3), (0.0, 0.3)], 6), L(0.18, 0.11, 0.07), at=(0, -0.24, 1.62), wear=0.0)  # the stick
  p.add(lathe([(0.04, 0.0), (0.065, 0.04), (0.068, 0.1), (0.045, 0.15), (0.0, 0.17)], 7), L(0.04, 0.03, 0.025), at=(0, -0.24, 1.76), wear=0.0)  # charred rag
  return mdl


def brazier():
  mdl = Model('brazier', ground=False)
  m = mdl.part('metal')
  m.add(lathe([(0.0, -0.14), (0.1, -0.14), (0.3, 0.08), (0.36, 0.2), (0.33, 0.2), (0.3, 0.18)], 10), IRON, wear=0.4)
  m.add(lathe([(0.345, 0.12), (0.375, 0.12), (0.375, 0.155), (0.345, 0.155)], 10), IRON_D, wear=0.3)
  for k in range(4):  # ribs up the bowl
    a = k * PI / 2 + 0.4
    m.add(tube((cos(a) * 0.12, sin(a) * 0.12, -0.12), (cos(a) * 0.35, sin(a) * 0.35, 0.18), 0.012, 4), IRON_D, wear=0.0)
  c = mdl.part('props')
  c.add(lathe([(0.0, 0.17), (0.3, 0.17), (0.0, 0.2)], 8), L(0.05, 0.02, 0.015), wear=0.0)
  g = mdl.part('metal', q=2)
  for k in range(4):  # embers
    a = k * 2.4
    g.add(lathe([(0.05, 0.0), (0.04, 0.03), (0.0, 0.035)], 4), L(0.5, 0.12, 0.04), wear=0.0, at=(cos(a) * 0.15 * (1 + k % 2), sin(a) * 0.15, 0.19))
  h = mdl.part('hang')
  for k in range(3):
    a = k * 2 * PI / 3
    h.add(tube((cos(a) * 0.35, sin(a) * 0.35, 0.2), (0, 0, 1.1), 0.013, 4), IRON_D, wear=0.0)
  return mdl


def pendant():
  mdl = Model('pendant', ground=False)
  h = mdl.part('hang', tint=True)
  h.add(lathe([(0.375, 0.0), (0.2, 0.17), (0.085, 0.3), (0.0, 0.31)], 10), L(0.9, 0.9, 0.9), jit=0.02, wear=0.5)
  rim = mdl.part('metal')
  rim.add(lathe([(0.37, -0.012), (0.385, 0.0), (0.37, 0.018)], 10), BRASS, wear=0.3)
  ch = mdl.part('hang')
  ch.add(tube((0, 0, 0.3), (0, 0, 0.95), 0.012, 4), IRON_D, wear=0.0)
  for k in range(4):
    z = 0.42 + k * 0.14
    ch.add(bevbox((-0.025, -0.008, z), (0.025, 0.008, z + 0.07), 0.0) if k % 2 else bevbox((-0.008, -0.025, z), (0.008, 0.025, z + 0.07), 0.0), IRON, wear=0.0)
  return mdl


# ---------------------------------------------------------------------------------------------
# The kit
# ---------------------------------------------------------------------------------------------

KIT = {
  'barrel_a': lambda: barrel('a'), 'barrel_b': lambda: barrel('b'), 'barrel_c': lambda: barrel('c'),
  'cask_stack': cask_stack,
  'column_a': lambda: column('a'),
  'chest_a': lambda: chest('a'), 'chest_b': lambda: chest('b'),
  'flight_a': lambda: flight_case(0.85, [(-0.62, -0.5, 0.1, 0.26, L(0.75, 0.62, 0.1)), (0.2, 0.62, 0.4, 0.62, L(0.7, 0.1, 0.1))], 'flight_a'),
  'flight_b': lambda: flight_case(1.0, [(0.3, 0.4, 0.1, 0.6, L(0.75, 0.62, 0.1)), (-0.7, -0.2, 0.7, 0.9, L(0.12, 0.35, 0.45))], 'flight_b'),
  'flight_c': lambda: flight_case(1.2, [(-0.5, 0.0, 0.2, 0.5, L(0.8, 0.8, 0.78)), (0.45, 0.55, 0.1, 1.0, L(0.75, 0.62, 0.1))], 'flight_c'),
  'crate_a': lambda: crate(0.9, 'crate_a', (-0.5, 0.0, 0.26, L(0.7, 0.68, 0.6))),
  'crate_b': lambda: crate(1.05, 'crate_b', (0.1, 0.55, 0.22, L(0.6, 0.12, 0.1))),
  'tomb_a': lambda: tomb('a'), 'tomb_b': lambda: tomb('b'), 'tomb_c': lambda: tomb('c'),
  'cart_a': lambda: cart('a'), 'cart_b': lambda: cart('b'),
  'speaker': speaker, 'table': table, 'rail_a': lambda: rail('a'), 'rail_b': lambda: rail('b'), 'booth': booth, 'bar': bar,
  'pillar': pillar, 'torch': torch, 'brazier': brazier, 'pendant': pendant,
}

# ---------------------------------------------------------------------------------------------
# Cycles contact sheet, for reviewing the models before they go into the game (CPU only: keep the samples low)
# ---------------------------------------------------------------------------------------------

# what the world's material does to a part: texture albedo (linear, as an average), roughness, metalness
MESHER_LOOK = {
  'props': ((1, 1, 1), 0.7, 0.0), 'metal': ((1, 1, 1), 0.38, 0.9), 'hang': ((1, 1, 1), 0.6, 0.2), 'glass': ((1, 1, 1), 0.07, 0.0),
  'wood': ((0.1, 0.055, 0.03), 0.72, 0.0), 'polish': ((0.1, 0.055, 0.03), 0.42, 0.0), 'stone': ((0.3, 0.26, 0.2), 0.88, 0.0),
  'brick': ((0.3, 0.07, 0.045), 0.88, 0.0), 'paint': ((0.75, 0.72, 0.65), 0.9, 0.0),
}


def preview_scene(built, png, blend, yaw=0.6, res=(1800, 800), samples=40, spacing=None):
  sc = bpy.context.scene
  for ob in list(sc.objects):
    bpy.data.objects.remove(ob)
  sc.render.engine = 'CYCLES'
  sc.cycles.device = 'CPU'
  sc.cycles.samples = samples
  sc.cycles.use_denoising = True
  sc.render.resolution_x, sc.render.resolution_y = res
  sc.view_settings.view_transform = 'Standard'
  w = bpy.data.worlds.new('w')
  w.use_nodes = True
  w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.03, 0.025, 0.022, 1)
  sc.world = w
  widths = []
  for mdl in built.values():
    xs = [v.x for p in mdl.parts if not p.glow for v in p.packed[0]]
    widths.append(max(xs) - min(xs))
  gap = 0.25
  total = sum(widths) + gap * (len(widths) - 1)
  x = -total / 2
  height = 0.0
  for (name, mdl), wd in zip(built.items(), widths):
    xs = [v.x for p in mdl.parts if not p.glow for v in p.packed[0]]
    cx = x + wd / 2 - (max(xs) + min(xs)) / 2
    x += wd + gap
    for p in mdl.parts:
      me = p.mesh.copy()
      verts, nors, cols, idx = p.packed
      alb, rough, metal = MESHER_LOOK.get(p.m, ((1, 1, 1), 0.6, 0.0))
      mat = bpy.data.materials.new('m')
      mat.use_nodes = True
      nt = mat.node_tree
      nt.nodes.clear()
      out = nt.nodes.new('ShaderNodeOutputMaterial')
      if p.glow:
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (*[to_linear(c) for c in hex_rgb(p.glow[0])], 1)
        em.inputs['Strength'].default_value = 3.0
        nt.links.new(em.outputs[0], out.inputs['Surface'])
      else:
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        vc = nt.nodes.new('ShaderNodeVertexColor')
        vc.layer_name = 'col'
        nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
        me.calc_loop_triangles()
        ca = me.color_attributes.new('col', 'FLOAT_COLOR', 'CORNER')
        k = 0
        for tri in me.loop_triangles:
          for li in tri.loops:
            c = cols[idx[k]]
            ca.data[li].color = (to_linear(c[0]) * alb[0], to_linear(c[1]) * alb[1], to_linear(c[2]) * alb[2], 1)
            k += 1
      ob = bpy.data.objects.new(name, me)
      ob.location = (cx, 0, 0)
      ob.data.materials.append(mat)
      sc.collection.objects.link(ob)
    height = max(height, max(v.z for p in mdl.parts if not p.glow for v in p.packed[0]))
  bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.001))
  fl = bpy.context.active_object
  fm = bpy.data.materials.new('floor')
  fm.use_nodes = True
  b = fm.node_tree.nodes['Principled BSDF']
  b.inputs['Base Color'].default_value = (0.09, 0.085, 0.08, 1)
  b.inputs['Roughness'].default_value = 0.8
  fl.data.materials.append(fm)

  def area(loc, energy, size, colour):
    d = bpy.data.lights.new('l', 'AREA')
    d.energy, d.size, d.color = energy, size, colour
    o = bpy.data.objects.new('l', d)
    o.location = loc
    sc.collection.objects.link(o)
    o.rotation_euler = (Vector((0, 0, height * 0.4)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()

  r = max(total, height * 1.6, 2.0)
  area((-0.6 * r, -0.9 * r, 1.1 * r), 260 * r * r / 4, 1.2, (1.0, 0.82, 0.62))
  area((0.9 * r, -0.6 * r, 0.6 * r), 110 * r * r / 4, 1.0, (0.7, 0.8, 1.0))
  area((0.0, 0.9 * r, 0.7 * r), 130 * r * r / 4, 1.5, (1.0, 0.7, 0.5))
  cam = bpy.data.cameras.new('cam')
  cam.lens = 40
  co = bpy.data.objects.new('cam', cam)
  dist = max(total * 1.2, height * 2.2, 2.6)
  co.location = (math.sin(yaw) * dist * 0.35, -dist, height * 0.5 + dist * 0.3)
  co.rotation_euler = (Vector((0, 0, height * 0.42)) - co.location).to_track_quat('-Z', 'Y').to_euler()
  sc.collection.objects.link(co)
  sc.camera = co
  if blend:
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print('saved', blend)
  if png:
    sc.render.filepath = png
    bpy.ops.render.render(write_still=True)
    print('rendered', png)


# ---------------------------------------------------------------------------------------------
# The file
# ---------------------------------------------------------------------------------------------

HEADER = """// Generated by scripts/blender/props.py from the Blender models of the level props. Do not edit by hand:
// change the script and run it again (see README.md, "Blender").
// Per prop: `parts`, each merged into the world mesher `m`. A part has `n` vertices, `p` positions (int16 x `sc`, in
// metres, x right, y up, z towards the viewer, standing on y = 0), `nrm` normals (int8), `idx` triangle indices
// (uint16) and `col` baked sRGB colour with ambient occlusion and edge wear in it. `q` is the lowest quality tier
// that draws the part (0 all, 1 medium and high, 2 high), `sw` swaps the texture axes, `tn` takes the instance tint,
// `glow` is [hex, gain] for an unlit part. `h` is the prop's height.
export const PROP_MESHES = """


def build(names, verbose=True):
  out, built = {}, {}
  for name in names:
    t0 = time.time()
    mdl = KIT[name]()
    bake_model(mdl)
    parts = [encode_part(p) for p in mdl.parts]
    top = max(max(v.z for v in p.packed[0]) for p in mdl.parts if p.packed[0])
    bad, tot = check_orientation(mdl)
    out[name] = {'h': round(top, 3), 'parts': parts}
    built[name] = mdl
    if verbose:
      print(f'{name:14s} {len(parts):2d} parts {sum(p["n"] for p in parts):5d} verts {sum(p["tris"] for p in parts):5d} tris'
            f'  flipped {bad}/{tot}  ({time.time() - t0:.1f}s)')
  return out, built


def main():
  ap = argparse.ArgumentParser()
  here = os.path.dirname(os.path.abspath(__file__))
  ap.add_argument('--out', default=os.path.join(here, '..', '..', 'src', 'prop-meshes.js'))
  ap.add_argument('--only')
  ap.add_argument('--preview')
  ap.add_argument('--blend')
  a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
  names = a.only.split(',') if a.only else list(KIT)
  data, built = build(names)
  if not a.only:
    for d in data.values():
      for p in d['parts']:
        p.pop('tris')
    with open(a.out, 'w') as f:
      f.write(HEADER + json.dumps(data, separators=(',', ':')).replace('},"', '},\n"') + ';\n')
    print('wrote', os.path.relpath(a.out), f'({os.path.getsize(a.out) / 1024:.0f} KB)')
  if a.preview or a.blend:
    preview_scene(built, a.preview, a.blend)


if __name__ == '__main__':
  main()
