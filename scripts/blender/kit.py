"""Small modelling kit for the game's Blender scripts (bpy as a module, headless).

Parts are authored in the drink's own frame with Blender axes (z up, the drink's front is -y), then exported to the
game's three.js frame (x right, y up, z towards the viewer): three = (x, z, -y). Colour, surface type and wear are
stored per face while modelling; ambient occlusion and edge wear are baked per vertex at export. Units are metres.
"""
import base64
import math
import struct

import bpy  # noqa: F401  (must come first: it makes bmesh and mathutils importable)
import bmesh  # noqa: E402
from mathutils import Euler, Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

# Surface types: roughness, metalness, whether paint wear applies. Same table as SURF in src/models.js.
SURF = {
  'paint': (0.5, 0.22, True), 'gloss': (0.3, 0.12, True), 'metal': (0.4, 0.88, False), 'chrome': (0.2, 1.0, False),
  'brass': (0.34, 1.0, False), 'rubber': (0.93, 0.0, False), 'plastic': (0.35, 0.0, False), 'paper': (0.92, 0.0, False),
  'leather': (0.5, 0.0, False),
}
SURF_IDS = list(SURF)
WEAR_COL = (0.376, 0.347, 0.292)  # 0xa59f93 in linear light, as in models.js


def to_linear(c):
  return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def to_srgb(c):
  c = max(0.0, min(1.0, c))
  return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_rgb(h):
  return ((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255


def smooth(t):
  t = max(0.0, min(1.0, t))
  return t * t * (3 - 2 * t)


def sstep(a, b, x):
  return smooth((x - a) / (b - a))


def pnoise(x, y, z, f):
  return 0.5 + 0.5 * noise.noise(Vector((x * f, y * f, z * f)))


# ---------------------------------------------------------------------------------------------
# Profiles and primitives (each builder takes a bmesh and adds geometry around the local origin)
# ---------------------------------------------------------------------------------------------

def prof(pts, n=2):
  """Profile points (r, z[, fillet radius[, tag]]) to a polyline (r, z, tag), with each filleted corner rounded
  by a quadratic Bezier of n steps. The tag lets a radial modifier pick out the outer wall, say."""
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


def offset_prof(p, d):
  """Offset an open profile polyline sideways by d (to the right of its direction of travel): glass wall thickness."""
  out = []
  for i, (r, z, t) in enumerate(p):
    a = Vector((p[max(i - 1, 0)][0], p[max(i - 1, 0)][1]))
    c = Vector((p[min(i + 1, len(p) - 1)][0], p[min(i + 1, len(p) - 1)][1]))
    tan = (c - a).normalized()
    nrm = Vector((tan.y, -tan.x))
    out.append((r + nrm.x * d, z + nrm.y * d, t))
  return out


def lathe(pts, seg=32, rmod=None, zmod=None, closed=False):
  """Surface of revolution about z. pts from prof(); points on the axis become poles. `closed` joins the last point
  back to the first (a ring profile). rmod(r, z, theta, tag) and zmod(...) let flutes, knurls and wavy edges in."""
  def build(bm):
    rings = []
    for (r, z, t) in pts:
      if r < 1e-9:
        rings.append(bm.verts.new((0, 0, z)))
        continue
      ring = []
      for j in range(seg):
        th = 2 * math.pi * j / seg
        rr = rmod(r, z, th, t) if rmod else r
        zz = zmod(r, z, th, t) if zmod else z
        ring.append(bm.verts.new((rr * math.cos(th), rr * math.sin(th), zz)))
      rings.append(ring)
    n = len(pts)
    for i in range(n if closed else n - 1):
      a, b = rings[i], rings[(i + 1) % n]
      la, lb = isinstance(a, list), isinstance(b, list)
      for j in range(seg):
        j2 = (j + 1) % seg
        if la and lb:
          bm.faces.new((a[j], a[j2], b[j2], b[j]))
        elif la:
          bm.faces.new((a[j], a[j2], b))
        elif lb:
          bm.faces.new((a, b[j2], b[j]))
  return build


def sphere(r, u=12, v=8):
  """A UV sphere as a lathe (the bmesh primitive is not repeatable run to run)."""
  pts = [(r * math.sin(math.pi * i / v), -r * math.cos(math.pi * i / v), 0) for i in range(v + 1)]
  return lathe(pts, u)


def prism(poly, t):
  """A flat polygon (x, z points, in the xz plane) extruded by t towards -y, the drink's front. Built by hand: the
  bmesh extrude operator orders its output by pointer hash, so the exported file would change on every run."""
  def build(bm):
    a = [bm.verts.new((x, 0, z)) for x, z in poly]
    b = [bm.verts.new((x, -t, z)) for x, z in poly]
    bm.faces.new(a)
    bm.faces.new(b)
    n = len(poly)
    for i in range(n):
      bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
  return build


def cube(sx, sy, sz):
  def build(bm):
    v = [bm.verts.new((x * sx / 2, y * sy / 2, z * sz / 2)) for z in (-1, 1) for y in (-1, 1) for x in (-1, 1)]
    for q in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
      bm.faces.new([v[i] for i in q])
  return build


def wrap(radius, front=0.0):
  """Bend a flat design round a cylinder of the given radius: x is arc length, -y is height off the surface,
  z stays z. `front` rotates the design round the bottle (radians, 0 faces -y)."""
  def f(co):
    th = co.x / radius + front
    d = radius - co.y
    return Vector((d * math.sin(th), -d * math.cos(th), co.z))
  return f


# ---------------------------------------------------------------------------------------------
# Parts
# ---------------------------------------------------------------------------------------------

class Part:
  """One mesh of a drink. kind: pbr (baked vertex colour and surface), glass, darkglass, liquid (gradient from
  `grad`), glow (flat HDR colour from `glow`). `origin` is the part's pivot in the drink frame."""

  def __init__(self, name, kind='pbr', origin=(0, 0, 0), grad=None, glow=None):
    self.name, self.kind, self.origin = name, kind, Vector(origin)
    self.grad, self.glow = grad, glow
    self.bm = bmesh.new()
    self.l_rgb = self.bm.faces.layers.int.new('rgb')
    self.l_surf = self.bm.faces.layers.int.new('surf')
    self.l_wear = self.bm.faces.layers.float.new('wear')

  def add(self, build, hex=0xffffff, surf='plastic', wear=1.0, at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), warp=None):
    bm = self.bm
    before = set(bm.faces)
    build(bm)
    new = [f for f in bm.faces if f not in before]
    bm.verts.index_update()
    verts = sorted({v for f in new for v in f.verts}, key=lambda v: v.index)  # sets iterate in hash order
    bmesh.ops.transform(bm, matrix=Matrix.LocRotScale(Vector(at), Euler(rot), Vector(scale)), verts=verts)
    if warp:
      for v in verts:
        v.co = warp(v.co)
    r, g, b = hex_rgb(hex)
    packed = (int(r * 255 + 0.5) << 16) | (int(g * 255 + 0.5) << 8) | int(b * 255 + 0.5)
    for f in new:
      f[self.l_rgb] = packed
      f[self.l_surf] = SURF_IDS.index(surf)
      f[self.l_wear] = wear
    return self

  def displace(self, fn):
    """Move every vertex: fn(co, normal) -> new co."""
    self.bm.normal_update()
    for v in self.bm.verts:
      v.co = fn(v.co.copy(), v.normal.copy())


# ---------------------------------------------------------------------------------------------
# Finishing: smoothing, baked vertex data, packing
# ---------------------------------------------------------------------------------------------

def _finish(part):
  """Triangulate, recalc normals, mark hard edges (over ~38 degrees) sharp, and return a Blender mesh."""
  bm = part.bm
  bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-7)
  bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
  bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='SHORT_EDGE', ngon_method='EAR_CLIP')
  bm.normal_update()
  bm.verts.ensure_lookup_table()
  for e in bm.edges:
    if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(38):
      e.smooth = False
  for f in bm.faces:
    f.smooth = True
  me = bpy.data.meshes.new(part.name)
  bm.to_mesh(me)
  return me


def _convexity(bm):
  """Per vertex edge amount: how far the adjacent faces turn away from the vertex normal, convex edges only.
  Matches the `edge` attribute in models.js (0 flat, about 0.3 at a 45 degree bevel)."""
  e = []
  for v in bm.verts:
    n = v.normal
    worst = 0.0
    convex = 0.0
    for f in v.link_faces:
      worst = max(worst, math.acos(max(-1.0, min(1.0, n.dot(f.normal)))))
      convex += (f.calc_center_median() - v.co).dot(n)
    e.append(0.0 if convex > 0 else 1 - math.cos(min(math.pi / 2, 2 * worst)))
  return e


_DIRS = []
for _i in range(48):  # cosine-weighted hemisphere, golden spiral, in a +z frame
  _u = (_i + 0.5) / 48
  _r = math.sqrt(_u)
  _a = _i * 2.399963
  _DIRS.append(Vector((_r * math.cos(_a), _r * math.sin(_a), math.sqrt(max(0.0, 1 - _u)))))


def _ao(bvh, p, n, dist=0.03):
  t = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
  t = (t - n * t.dot(n)).normalized()
  b = n.cross(t)
  hit = 0.0
  for d in _DIRS:
    w = (t * d.x + b * d.y + n * d.z)
    res = bvh.ray_cast(p + n * 3e-4, w, dist)
    if res[0] is not None:
      hit += 1 - res[3] / dist
  return hit / len(_DIRS)


def occluder_bvh(parts):
  verts, polys = [], []
  for p in parts:
    if p.kind == 'liquid' or p.kind == 'glow':
      continue
    me = p.mesh
    base = len(verts)
    verts += [v.co + p.origin for v in me.vertices]
    polys += [tuple(base + i for i in poly.vertices) for poly in me.polygons]
  return BVHTree.FromPolygons(verts, polys, epsilon=0.0)


def bake_part(part, bvh):
  """Finish the mesh and compute per-corner data. Sets part.mesh and part.corners (a list of dicts)."""
  me = _finish(part)
  part.mesh = me
  part.edge = _convexity(part.bm)


def pack_part(part, bvh, ao_strength=0.7):
  me = part.mesh
  me.calc_loop_triangles()
  rgb = me.attributes['rgb'].data
  surf = me.attributes['surf'].data
  wearf = me.attributes['wear'].data
  cn = [Vector(n) for n in (c.vector for c in me.corner_normals)]
  keys = {}
  verts, nors, cols, sfs, idx = [], [], [], [], []
  ao_cache = {}
  o = part.origin
  for tri in me.loop_triangles:
    poly = tri.polygon_index
    for li in tri.loops:
      vi = me.loops[li].vertex_index
      n = cn[li]
      key = (vi, round(n.x, 3), round(n.y, 3), round(n.z, 3), rgb[poly].value, surf[poly].value)
      if key not in keys:
        keys[key] = len(verts)
        co = me.vertices[vi].co
        verts.append(co.copy())
        nors.append(n.copy())
        if part.kind == 'pbr':
          packed = rgb[poly].value
          sid = surf[poly].value
          kr, km, paint = SURF[SURF_IDS[sid]]
          w = o + co
          c = [to_linear(x) for x in hex_rgb(packed)]
          speck = 0.84 + 0.3 * pnoise(w.x, w.y, w.z, 23) + 0.06 * (pnoise(w.x, w.y, w.z, 110) - 0.5)
          c = [x * speck for x in c]
          rough, metal = kr, km
          if paint:
            e = part.edge[vi]
            wv = sstep(0.1, 0.28, e + (pnoise(w.x, w.y, w.z, 5.3) - 0.5) * 0.2) * wearf[poly].value
            c = [x + (WEAR_COL[k] - x) * wv * 0.85 for k, x in enumerate(c)]
            rough += (0.38 - rough) * wv
            metal += (0.85 - metal) * wv
          occ = _ao(bvh, w, n.normalized()) if n.length > 0 else 0.0
          k = 1 - ao_strength * occ
          cols.append([to_srgb(x * k) for x in c])
          sfs.append((rough, metal))
      idx.append(keys[key])
  return verts, nors, cols, sfs, idx


def _b64(fmt, values):
  return base64.b64encode(struct.pack('<%d%s' % (len(values), fmt), *values)).decode()


def encode_part(part, bvh):
  verts, nors, cols, sfs, idx = pack_part(part, bvh)
  # to the game's frame: (x, y, z) -> (x, z, -y)
  tv = [(v.x, v.z, -v.y) for v in verts]
  tn = [(n.x, n.z, -n.y) for n in nors]
  mx = max(max(abs(c) for c in v) for v in tv) or 1e-6
  sc = mx / 32767
  out = {
    'kind': part.kind,
    'pos': [round(part.origin.x, 5), round(part.origin.z, 5), round(-part.origin.y, 5)],
    'sc': float('%.7g' % sc),
    'n': len(tv),
    'p': _b64('h', [int(round(c / sc)) for v in tv for c in v]),
    'nrm': _b64('b', [int(round(max(-1, min(1, c)) * 127)) for n in tn for c in n]),
    'idx': _b64('H', idx),
    'tris': len(idx) // 3,
  }
  if part.kind == 'pbr':
    out['col'] = _b64('B', [int(round(c * 255)) for c in (x for col in cols for x in col)])
    out['sf'] = _b64('B', [int(round(c * 255)) for s in sfs for c in s])
  if part.grad:
    out['grad'] = part.grad
  if part.glow:
    out['glow'] = part.glow
  part.packed = (verts, nors, cols, sfs, idx)
  return out
