"""Bakes the level textures in Blender and writes WebP files to assets/textures/.
Run with: ~/.venvs/blender/bin/python scripts/blender/textures.py [--only brick,flag] [--out assets/textures]
                                                                  [--debug DIR] [--ss 2]

Each material is modelled as real geometry over one seamless tile: bevelled, uneven bricks and stones with recessed
joints, worn flagstones that sit at different heights, chips knocked out of arrises. Nine copies of the tile are laid out
(the centre one is the texture) so shadowing and ambient occlusion run across the tile edges and the result tiles exactly.
Cycles (CPU) then bakes from that geometry onto a flat target quad: albedo, tangent-space normal, ambient occlusion,
roughness and a small mask. The bake runs at --ss times the final size and is averaged down. Fine grain, stains and
micro relief are added afterwards in numpy from tileable noise, because Blender's noise nodes do not tile.

Outputs, per material (see docs/textures.md for the file table):
  <name>-albedo.webp  sRGB colour with the cavity occlusion multiplied in, then scaled so its mean matches the old
                      generated texture (the level's exposure and tints were set against those)
  <name>-normal.webp  tangent space, +Y up in the image (the OpenGL convention three.js expects), linear data
  <name>-rough.webp   grey, half the albedo's size, linear data, read from the green channel by three.js

Everything is seeded and the pipeline is single-pass, so a rerun gives the same bytes (checked with cmp, see
docs/textures.md). Units are metres. Tile axes: x is u (along the wall or floor), y is v (up the wall).
"""
import argparse
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
import bpy  # noqa: E402

import kit  # noqa: E402  (to_linear / to_srgb: the same colour maths as the other Blender scripts)

MARGIN = 0.14  # geometry kept beyond the tile edge, so occlusion and bevels are continuous across the seam
RING = (0.0, 0.04, 0.12, 0.25, 0.42, 0.64, 0.85, 1.0)  # grid lines across a bevel, as fractions of its width

LIN = np.vectorize(kit.to_linear)
_L = np.array([kit.to_linear(i / 255) for i in range(256)], np.float64)


def srgb_enc(a):
  """linear 0..1 array to sRGB 0..1 (vectorised, same curve as kit.to_srgb)"""
  a = np.clip(a, 0.0, 1.0)
  return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)


def lin(rgb):
  return np.array([_L[int(round(c))] for c in rgb], np.float64)


# ---------------------------------------------------------------------------------------------
# Tileable noise (value noise on a wrapping lattice). x, y are metres; the tile is W by H.
# ---------------------------------------------------------------------------------------------

_lat = {}


def lattice(cx, cy, seed):
  k = (cx, cy, seed)
  if k not in _lat:
    rng = random.Random(seed * 100003 + cx * 1009 + cy)
    _lat[k] = np.array([rng.random() for _ in range(cx * cy)], np.float64).reshape(cy, cx)
  return _lat[k]


def pn(x, y, W, H, cx, cy, seed):
  L = lattice(cx, cy, seed)
  fx = x / W * cx
  fy = y / H * cy
  x0 = np.floor(fx)
  y0 = np.floor(fy)
  tx = fx - x0
  ty = fy - y0
  tx = tx * tx * (3 - 2 * tx)
  ty = ty * ty * (3 - 2 * ty)
  ix0 = x0.astype(np.int64) % cx
  iy0 = y0.astype(np.int64) % cy
  ix1 = (ix0 + 1) % cx
  iy1 = (iy0 + 1) % cy
  a = L[iy0, ix0]
  b = L[iy0, ix1]
  c = L[iy1, ix0]
  d = L[iy1, ix1]
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty


def fbm(x, y, W, H, cells, seed, octaves=3, aspect=(1, 1)):
  """0..1 fractal noise, `cells` lattice cells across the tile at the lowest octave"""
  tot = 0.0
  amp = 1.0
  out = 0.0
  for o in range(octaves):
    f = 2 ** o
    out = out + amp * pn(x, y, W, H, max(1, int(cells * f * aspect[0])), max(1, int(cells * f * aspect[1])), seed + o * 17)
    tot += amp
    amp *= 0.5
  return out / tot


def sst(a, b, v):
  t = np.clip((v - a) / (b - a), 0.0, 1.0)
  return t * t * (3 - 2 * t)


def hrand(*k):
  """deterministic 0..1 from integers (the same idea as ihash in world.js)"""
  h = 2166136261
  for v in k:
    h = ((h ^ (int(v) & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
    h ^= h >> 15
    h = (h * 2246822519) & 0xFFFFFFFF
  h ^= h >> 13
  return (h & 0xFFFFFF) / 16777216.0


# ---------------------------------------------------------------------------------------------
# Material definitions: tile size, block layout, per-block looks, surface numbers
# ---------------------------------------------------------------------------------------------

def brick_blocks():
  """8 bricks by 12 courses in 1.8 x 0.9 m, odd courses half a brick over: the generated texture was 4 wide, this is twice
  that so the pattern repeats half as often (225 x 75 mm pitch, 215 x 65 mm bricks, 10 mm joints)"""
  cols = [(158, 74, 54), (142, 62, 46), (168, 90, 60), (122, 72, 54), (134, 86, 62), (150, 70, 58), (176, 104, 70)]
  out = []
  for row in range(12):
    for col in range(8):
      i = hrand(col, row, 1)
      if i < 0.025:  # fewer outliers than the 4 wide generated tile had: with 96 bricks they would read as a pattern
        base, glossy = (62, 46, 48), False
      elif i < 0.04:
        base, glossy = (48, 50, 64), True
      elif i < 0.055:
        base, glossy = (186, 140, 110), False
      elif i < 0.09:
        base, glossy = (104, 88, 80), False
      else:
        base, glossy = cols[int(i * 977) % len(cols)], False
      k = 0.86 + 0.28 * hrand(col, row, 2)
      j = [(hrand(col, row, 20 + n) - 0.5) * 2 for n in range(4)]
      b = dict(
        id=(col, row), x0=col * 0.225 + (0.1125 if row & 1 else 0.0) + 0.005 + j[0] * 0.0012, y0=row * 0.075 + 0.005 + j[1] * 0.001,
        w=0.215 + j[2] * 0.0015, h=0.065 + j[3] * 0.001, col=lin([min(255, c * k) for c in base]), rough=0.5 if glossy else 0.86 + 0.06 * hrand(col, row, 5),
        off=(hrand(col, row, 3) - 0.5) * 0.0014, tx=(hrand(col, row, 6) - 0.5) * 0.0014, ty=(hrand(col, row, 7) - 0.5) * 0.001,
        chips=[], flat=glossy)
      if hrand(col, row, 9) < 0.34:
        for n in range(1 + int(hrand(col, row, 10) * 2.2)):
          b['chips'].append(dict(cx=b['w'] * (hrand(col, row, 11 + n) < 0.5), cy=b['h'] * (hrand(col, row, 14 + n) < 0.5),
                                 rc=0.011 + 0.017 * hrand(col, row, 17 + n), dc=0.0012 + 0.0022 * hrand(col, row, 18 + n), s=n))
      out.append(b)
  return out


def flag_blocks():
  """9 flagstones in 2 m (rows 0.69, 0.56 and 0.75 m high), laid out as the generated texture"""
  rows = [(0, 88, [100, 92, 64]), (88, 72, [72, 112, 72]), (160, 96, [96, 80, 80])]
  u = 2.0 / 256
  j = 0.007
  out = []
  for ri, (top, hh, ws) in enumerate(rows):
    acc = 0
    for ci, w in enumerate(ws):
      i = hrand(ci, ri, 32)
      base = (118, 118, 116) if i < 0.4 else (104, 106, 108) if i < 0.75 else (128, 118, 106)
      k = 0.88 + 0.24 * hrand(ci, ri, 33)
      r = [(hrand(ci, ri, 60 + n) - 0.5) * 2 for n in range(4)]
      b = dict(
        id=(ci, ri), x0=acc * u + j + r[0] * 0.003, y0=top * u + j + r[1] * 0.003, w=w * u - 2 * j + r[2] * 0.004, h=hh * u - 2 * j + r[3] * 0.004,
        col=lin([min(255, c * k) for c in base]), rough=0.82, off=(hrand(ci, ri, 62) - 0.5) * 0.005,
        tx=(hrand(ci, ri, 63) - 0.5) * 0.006, ty=(hrand(ci, ri, 64) - 0.5) * 0.006, chips=[], flat=False)
      if hrand(ci, ri, 65) < 0.7:
        for n in range(1 + int(hrand(ci, ri, 66) * 2.5)):
          b['chips'].append(dict(cx=b['w'] * (hrand(ci, ri, 67 + n) < 0.5), cy=b['h'] * (hrand(ci, ri, 70 + n) < 0.5),
                                 rc=0.03 + 0.05 * hrand(ci, ri, 73 + n), dc=0.003 + 0.004 * hrand(ci, ri, 76 + n), s=n))
      out.append(b)
      acc += w
  return out


def stone_blocks():
  """4 courses of ashlar in 1.2 m, two blocks to a course, each course shifted"""
  rows = [[110, 146], [96, 160], [140, 116], [120, 136]]
  offs = [0, 48, 16, 80]
  u = 1.2 / 256
  j = 0.007
  out = []
  for ri in range(4):
    acc = offs[ri]
    for ci, w in enumerate(rows[ri]):
      i = hrand(ci, ri, 21)
      base = (140, 134, 124) if i < 0.25 else (156, 144, 126) if i < 0.55 else (146, 128, 112) if i < 0.8 else (120, 118, 114)
      k = 0.9 + 0.2 * hrand(ci, ri, 22)
      r = [(hrand(ci, ri, 80 + n) - 0.5) * 2 for n in range(4)]
      b = dict(
        id=(ci, ri), x0=acc * u + j + r[0] * 0.002, y0=ri * 64 * u + j + r[1] * 0.002, w=w * u - 2 * j + r[2] * 0.003, h=64 * u - 2 * j + r[3] * 0.002,
        col=lin([min(255, c * k) for c in base]), rough=0.88, off=(hrand(ci, ri, 82) - 0.5) * 0.003,
        tx=(hrand(ci, ri, 83) - 0.5) * 0.004, ty=(hrand(ci, ri, 84) - 0.5) * 0.004, chips=[], flat=False)
      if hrand(ci, ri, 85) < 0.6:
        for n in range(1 + int(hrand(ci, ri, 86) * 2.5)):
          b['chips'].append(dict(cx=b['w'] * (hrand(ci, ri, 87 + n) < 0.5), cy=b['h'] * (hrand(ci, ri, 90 + n) < 0.5),
                                 rc=0.02 + 0.035 * hrand(ci, ri, 93 + n), dc=0.002 + 0.004 * hrand(ci, ri, 96 + n), s=n))
      out.append(b)
      acc += w
  return out


def boards_blocks():
  """8 planks 0.2 m wide along a 1.6 m tile, each cut by one butt joint at a random place (the layout of the generated
  texture). Planks cup a little across their width; the gaps are narrow and dark."""
  cols = [(82, 54, 34), (68, 44, 28), (92, 62, 40), (54, 36, 26)]
  gap = 0.0035
  out = []
  for pl in range(8):
    jx = hrand(pl, 0, 41) * 1.6
    for sg in range(2):
      i = hrand(pl, sg, 43)
      base = cols[0] if i < 0.3 else cols[1] if i < 0.6 else cols[2] if i < 0.85 else cols[3]
      k = 0.86 + 0.28 * hrand(pl, sg, 44)
      x0, x1 = (gap / 2, jx - gap / 2) if sg == 0 else (jx + gap / 2, 1.6 - gap / 2)
      b = dict(id=(pl, sg), x0=x0, y0=pl * 0.2 + gap / 2, w=x1 - x0, h=0.2 - gap, col=lin([min(255, c * k) for c in base]), rough=0.74,
               off=(hrand(pl, sg, 45) - 0.5) * 0.002, tx=(hrand(pl, sg, 46) - 0.5) * 0.003, ty=(hrand(pl, sg, 47) - 0.5) * 0.004, chips=[], flat=False)
      out.append(b)
  return out


# r: arris radius, D: joint depth, famp: face unevenness (m), fcells: its lattice cells per tile, step: mesh spacing,
# mstep: joint mesh spacing, wob: arris wobble (fraction of r). boost: scale on the baked slopes, lowboost: extra scale on
# the gentle (blurred) slopes, ao_pow: how hard the occlusion bites, streak: strength of the drips
SPECS = {
  'brick': dict(W=1.8, H=0.9, res=(1024, 512), blocks=brick_blocks, r=0.0036, D=0.0075, famp=0.0007, fcells=7, step=0.0065, mstep=0.0035, wob=0.45,
                mortar=(128, 120, 106), mamp=0.0009, mcells=60, cvar=0.15, chipcol=(176, 122, 92),
                target=(139.8, 84.2, 65.1), half_rough=True, micro=1.0, grain=0.17, boost=2.0, lowboost=3.0, ao_pow=1.3, ao_mix=1.0, streak=0.14,
                paint=dict(target=(209.0, 201.7, 189.2))),
  'flag': dict(W=2.0, H=2.0, res=(512, 512), blocks=flag_blocks, r=0.013, D=0.016, famp=0.0022, fcells=9, step=0.016, mstep=0.012, wob=0.5,
               mortar=(46, 44, 42), mamp=0.0025, mcells=40, cvar=0.12, chipcol=(150, 146, 138),
               target=(104.1, 104.2, 99.8), half_rough=True, micro=0.7, grain=0.15, boost=2.0, lowboost=5.0, ao_pow=1.3, ao_mix=1.0, streak=0.0),
  'stone': dict(W=1.2, H=1.2, res=(512, 512), blocks=stone_blocks, r=0.0075, D=0.012, famp=0.0016, fcells=8, step=0.011, mstep=0.008, wob=0.55,
                mortar=(66, 62, 56), mamp=0.0016, mcells=40, cvar=0.12, chipcol=(172, 160, 140),
                target=(133.4, 125.6, 113.0), half_rough=True, micro=0.75, grain=0.15, boost=2.0, lowboost=3.0, ao_pow=1.3, ao_mix=1.0, streak=0.12),
  'boards': dict(W=1.6, H=1.6, res=(512, 512), blocks=boards_blocks, r=0.003, D=0.006, famp=0.0006, fcells=5, step=0.02, mstep=0.01, wob=0.2,
                 mortar=(28, 20, 14), mamp=0.0005, mcells=30, cvar=0.10, chipcol=(120, 84, 56), wood=True,
                 target=(64.1, 41.4, 26.7), half_rough=True, micro=1.8, grain=0.0, boost=2.0, lowboost=2.0, ao_pow=1.2, ao_mix=1.0, streak=0.0),
}


# ---------------------------------------------------------------------------------------------
# Geometry: one mesh, per-vertex albedo ('alb'), roughness ('rgh') and mask ('msk': R mortar, G chip, B per-block random)
# ---------------------------------------------------------------------------------------------

def edge_lines(L, r, step):
  a = [r * s for s in RING]
  inner = max(L - 2 * r, 1e-6)
  n = max(1, int(math.ceil(inner / step)))
  mid = [r + inner * i / n for i in range(1, n)]
  b = [L - r * s for s in reversed(RING)]
  return np.array(a + mid + b, np.float64)


class Soup:
  def __init__(self):
    self.v, self.f, self.alb, self.rgh, self.msk = [], [], [], [], []
    self.n = 0

  def add_grid(self, X, Y, Z, alb, rgh, msk):
    ny, nx = X.shape
    self.v.append(np.stack([X, Y, Z], axis=-1).reshape(-1, 3))
    idx = (np.arange(ny * nx).reshape(ny, nx) + self.n)
    a, b, c, d = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
    self.f.append(np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d], 1)]))
    self.alb.append(alb.reshape(-1, 3))
    self.rgh.append(np.broadcast_to(rgh, (ny, nx)).reshape(-1))
    self.msk.append(msk.reshape(-1, 3))
    self.n += ny * nx

  def arrays(self):
    return (np.concatenate(self.v), np.concatenate(self.f), np.concatenate(self.alb), np.concatenate(self.rgh), np.concatenate(self.msk))


def block_grid(S, spec, b):
  """one block over its own local grid; returns local X, Y and everything the soup needs (positions are tile-local metres)"""
  W, H = spec['W'], spec['H']
  w, h = b['w'], b['h']
  r = spec['r'] * (0.65 + 0.8 * hrand(b['id'][0], b['id'][1], 51))  # arris radius varies from stone to stone
  xs = edge_lines(w, r, spec['step'])
  ys = edge_lines(h, r, spec['step'])
  X, Y = np.meshgrid(xs, ys)
  gx, gy = b['x0'] + X, b['y0'] + Y
  seed = b['id'][0] * 31 + b['id'][1] * 7
  dx = np.minimum(X, w - X)
  dy = np.minimum(Y, h - Y)
  ux = np.clip(1 - dx / r, 0, 1)
  uy = np.clip(1 - dy / r, 0, 1)
  s = np.clip(1 - np.hypot(ux, uy), 0, 1)  # 0 on the very edge and corner, 1 once past the arris, corners rounded
  s = np.clip(s + (pn(gx, gy, W, H, int(W / 0.05), int(H / 0.05), 5) - 0.5) * 2 * spec['wob'] * 0.5 * (s < 0.999) * (s > 0.001), 0, 1)
  ease = np.sqrt(1 - (1 - s) ** 2)
  drop = spec['D'] * 1.7 + 0.003  # always deeper than the joint fill, which varies in depth
  z = -drop * (1 - ease)
  # an uneven face: per-block offset and tilt, then slow undulation across the tile
  z = z + b['off'] + b['tx'] * (X / w - 0.5) + b['ty'] * (Y / h - 0.5)
  fa = 0.35 if b['flat'] else 1.0
  z = z + fa * spec['famp'] * (fbm(gx, gy, W, H, spec['fcells'], 11, 3) - 0.5) * 2
  chip = np.zeros_like(z)
  for c in b['chips']:
    dd = np.hypot(X - c['cx'], Y - c['cy']) + (pn(gx, gy, W, H, int(W / 0.03), int(H / 0.03), 40 + c['s']) - 0.5) * c['rc'] * 0.9
    m = sst(0.0, 0.4, 1 - dd / c['rc'])
    z = z - c['dc'] * m
    chip = np.maximum(chip, sst(0.0, 0.2, 1 - dd / c['rc']))
  var = (fbm(gx, gy, W, H, 14, 23, 2) - 0.5) * 2 * spec['cvar']
  col = b['col'][None, None, :] * (1 + var[..., None])
  col = col * (1 - chip[..., None]) + lin(spec['chipcol'])[None, None, :] * chip[..., None]
  msk = np.zeros(X.shape + (3,))
  msk[..., 1] = chip
  msk[..., 2] = hrand(b['id'][0], b['id'][1], 99)
  return X, Y, z, col, b['rough'] + (fbm(gx, gy, W, H, 20, 29, 2) - 0.5) * 0.08, msk


def build_geometry(spec):
  W, H = spec['W'], spec['H']
  soup = Soup()
  blocks = spec['blocks']()
  # joint fill: one plane over the whole extended area, a little below the deepest face
  xs = np.arange(-MARGIN, W + MARGIN + 1e-9, spec['mstep'])
  ys = np.arange(-MARGIN, H + MARGIN + 1e-9, spec['mstep'])
  X, Y = np.meshgrid(xs, ys)
  depth = spec['D'] * (0.45 + 1.1 * fbm(X, Y, W, H, max(2, int(W / 0.2)), 6, 2))  # some joints sit deeper, some nearly flush
  z = -depth + spec['mamp'] * (fbm(X, Y, W, H, spec['mcells'], 3, 3) - 0.5) * 2
  base = lin(spec['mortar'])
  col = base[None, None, :] * (1 + (fbm(X, Y, W, H, 12, 8, 3) - 0.5)[..., None] * 0.35)
  msk = np.zeros(X.shape + (3,))
  msk[..., 0] = 1
  soup.add_grid(X, Y, z, col, np.full(X.shape, 0.96), msk)
  nblocks = 0
  for b in blocks:
    X, Y, z, col, rgh, msk = block_grid(None, spec, b)
    for oy in (-1, 0, 1):
      for ox in (-1, 0, 1):
        x0, y0 = b['x0'] + ox * W, b['y0'] + oy * H
        if x0 > W + MARGIN or x0 + b['w'] < -MARGIN or y0 > H + MARGIN or y0 + b['h'] < -MARGIN:
          continue
        soup.add_grid(X + b['x0'] + ox * W, Y + b['y0'] + oy * H, z, col, rgh, msk)
        nblocks += 1
  return soup, blocks, nblocks


# ---------------------------------------------------------------------------------------------
# Blender: highpoly mesh, target quad, bakes
# ---------------------------------------------------------------------------------------------

def make_mesh_object(name, V, F, alb, rgh, msk):
  me = bpy.data.meshes.new(name)
  me.from_pydata(V.astype(np.float32), [], F.astype(np.int32).tolist())
  me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), bool))
  for nm, data in (('alb', np.concatenate([alb, np.ones((len(alb), 1))], 1)), ('rgh', np.stack([rgh, rgh, rgh, np.ones_like(rgh)], 1)),
                   ('msk', np.concatenate([msk, np.ones((len(msk), 1))], 1))):
    ca = me.color_attributes.new(nm, 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', data.astype(np.float32).ravel())
  ob = bpy.data.objects.new(name, me)
  bpy.context.scene.collection.objects.link(ob)
  mat = bpy.data.materials.new(name + '-mat')
  mat.use_nodes = True
  nt = mat.node_tree
  nt.nodes.clear()
  out = nt.nodes.new('ShaderNodeOutputMaterial')
  bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
  def attr(n):
    a = nt.nodes.new('ShaderNodeVertexColor')
    a.layer_name = n
    return a
  nt.links.new(attr('alb').outputs['Color'], bsdf.inputs['Base Color'])
  nt.links.new(attr('rgh').outputs['Color'], bsdf.inputs['Roughness'])
  nt.links.new(attr('msk').outputs['Color'], bsdf.inputs['Emission Color'])
  bsdf.inputs['Emission Strength'].default_value = 1.0
  bsdf.inputs['Specular IOR Level'].default_value = 0.5
  nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
  me.materials.append(mat)
  return ob


def make_target(W, H):
  me = bpy.data.meshes.new('target')
  me.from_pydata([(0, 0, 0), (W, 0, 0), (W, H, 0), (0, H, 0)], [], [(0, 1, 2, 3)])
  uv = me.uv_layers.new(name='UVMap')
  for lp, c in zip(me.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
    uv.data[lp.index].uv = c
  ob = bpy.data.objects.new('target', me)
  bpy.context.scene.collection.objects.link(ob)
  mat = bpy.data.materials.new('target-mat')
  mat.use_nodes = True
  me.materials.append(mat)
  return ob


def bake(target, high, kind, size, samples=None):
  sw, sh = size
  sc = bpy.context.scene
  img = bpy.data.images.new('bake-' + kind, sw, sh, alpha=False, float_buffer=True)
  img.colorspace_settings.name = 'Non-Color'
  nt = target.data.materials[0].node_tree
  nt.nodes.clear()
  tn = nt.nodes.new('ShaderNodeTexImage')
  tn.image = img
  nt.nodes.active = tn
  for o in bpy.context.scene.objects:
    o.select_set(False)
  high.select_set(True)
  target.select_set(True)
  bpy.context.view_layer.objects.active = target
  if samples:
    sc.cycles.samples = samples
  b = sc.render.bake
  b.use_selected_to_active = True
  b.cage_extrusion = 0.05
  b.max_ray_distance = 0.12
  b.margin = 0
  b.use_clear = True
  if kind == 'NORMAL':
    b.normal_space = 'TANGENT'
    b.normal_r, b.normal_g, b.normal_b = 'POS_X', 'POS_Y', 'POS_Z'
  b.use_pass_direct = False
  b.use_pass_indirect = False
  b.use_pass_color = True
  bpy.ops.object.bake(type=kind)
  px = np.empty(sw * sh * 4, np.float32)
  img.pixels.foreach_get(px)
  bpy.data.images.remove(img)
  return px.reshape(sh, sw, 4)[..., :3].astype(np.float64)


def down(a, k):
  if k == 1:
    return a
  h, w = a.shape[:2]
  return a.reshape(h // k, k, w // k, k, -1).mean(axis=(1, 3))


# ---------------------------------------------------------------------------------------------
# Post: detail, calibration, packing, encode
# ---------------------------------------------------------------------------------------------

def blur(a, r, passes=3):
  """wrapping box blur, for the low-frequency part of the relief"""
  for _ in range(passes):
    for ax in (0, 1):
      a = sum(np.roll(a, k, ax) for k in range(-r, r + 1)) / (2 * r + 1)
  return a


def post(spec, A, N, AO, R, M, res):
  """Everything after the bake, in numpy and tileable. Returns sRGB albedo, normal, roughness and any extra albedos."""
  W, H = spec['W'], spec['H']
  rw, rh = res
  X, Y = np.meshgrid((np.arange(rw) + 0.5) / rw * W, (np.arange(rh) + 0.5) / rh * H)
  wood = spec.get('wood', False)

  def f(cells, seed, octaves=3):
    return fbm(X, Y, W, H, cells, seed, octaves)

  mortar = np.clip(M[..., 0], 0, 1)
  chip = np.clip(M[..., 1], 0, 1)
  face = 1 - mortar
  white = hrand_field(res, 75) - 0.5

  # wood grain runs along x: thin stripes, bent by slow noise, plus a few knots
  if wood:
    Yw = Y + 0.012 * (f(6, 100, 2) - 0.5) * 2
    gl = pn(X, Yw, W, H, 3, int(H / 0.006), 101) * 0.45 + pn(X, Yw, W, H, 7, int(H / 0.0022), 102) * 0.35 + pn(X, Yw, W, H, 2, int(H / 0.02), 103) * 0.2
    knot = np.zeros_like(X)
    kh = np.zeros_like(X)
    for k in range(7):
      kx, ky, kr = hrand(k, 1, 300) * W, hrand(k, 2, 300) * H, 0.018 + 0.026 * hrand(k, 3, 300)
      dx = (X - kx + W / 2) % W - W / 2
      dy = (Y - ky + H / 2) % H - H / 2
      rr = np.hypot(dx * 0.7, dy * 1.5) / kr
      m = np.clip(1 - rr / 2.2, 0, 1)
      knot = np.maximum(knot, m * (0.55 + 0.45 * np.sin(rr * 7)))
      kh = kh - sst(0.0, 1.0, 1 - rr) * 0.9 + sst(1.0, 1.9, rr) * (1 - sst(1.9, 2.4, rr)) * 0.3

  # normal: from the bake, with its low-frequency part lifted (gentle slopes are real but invisible at 1:1), plus micro relief
  n = N * 2 - 1
  n = n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
  sx0 = n[..., 0] / np.maximum(n[..., 2], 0.2)
  sy0 = n[..., 1] / np.maximum(n[..., 2], 0.2)
  lb = spec['lowboost'] - 1
  rr_ = max(2, int(rw / 90))
  sx = (sx0 + lb * blur(sx0, rr_)) * spec['boost']
  sy = (sy0 + lb * blur(sy0, rr_)) * spec['boost']
  if wood:
    hf = gl * 0.8 + white * 0.25 + kh * 0.35
    pit = np.zeros_like(X)
  else:
    hf = f(int(W / 0.02), 71, 2) * 0.5 + f(int(W / 0.006), 72, 2) * 0.3 + hrand_field(res, 81) * 0.2
    pit = sst(0.74, 0.86, f(int(W / 0.008), 73, 2))
    hf = hf - 0.9 * pit
  gx = (np.roll(hf, -1, 1) - np.roll(hf, 1, 1)) * 0.5
  gy = (np.roll(hf, -1, 0) - np.roll(hf, 1, 0)) * 0.5
  k = spec['micro'] * (0.6 + 0.8 * mortar)
  sx = sx - gx * k
  sy = sy - gy * k
  inv = 1 / np.sqrt(sx * sx + sy * sy + 1)
  nrm = np.stack([sx * inv, sy * inv, inv], -1)

  # albedo (linear): cavity occlusion, arris wear lightens, grain, patches of soot and damp, pale salts
  alb = A.copy()
  ao = np.clip(AO[..., 0], 0, 1) ** spec['ao_pow']
  alb *= (1 - spec['ao_mix'] + spec['ao_mix'] * ao)[..., None]
  slope = np.hypot(n[..., 0], n[..., 1])
  edge = sst(0.04, 0.4, slope) * face * (1 - chip)
  alb *= (1 + (0.1 if wood else 0.22) * edge)[..., None]
  if wood:
    alb *= (1 + (gl - 0.5) * 2 * 0.7 + white * 0.2)[..., None]
    alb *= (1 - 0.7 * knot * face)[..., None]
    wear = sst(0.62, 0.82, f(max(2, int(W / 0.4)), 104, 3))  # scuffed, trodden pale
    alb *= (1 + 0.28 * wear * face)[..., None]
  else:
    grain = ((f(int(W / 0.05), 74, 2) - 0.5) * 2 * 0.9 + (f(int(W / 0.012), 82, 2) - 0.5) * 2 * 0.7 + white * 1.2) * spec['grain']
    grain = grain * (1 + 0.8 * mortar)
    alb *= (1 - 0.4 * pit * (1 - 0.5 * mortar))[..., None]
    alb *= (1 + grain)[..., None]
  patch = f(max(2, int(W / 0.35)), 76, 3)
  soot = sst(0.5, 0.78, patch)
  alb *= (1 - 0.38 * soot * face)[..., None]
  streak = sst(0.5, 0.8, pn(X, Y, W, H, max(2, int(W / 0.05)), max(1, int(H / 0.8)), 90) * 0.65 + f(int(W / 0.3), 91, 2) * 0.35)  # drips run down the wall
  alb *= (1 - spec['streak'] * streak * (0.6 + 0.4 * mortar))[..., None]
  damp = sst(0.55, 0.85, f(max(2, int(W / 0.5)), 77, 2))
  alb *= (1 - 0.14 * damp)[..., None]
  if not wood:
    salt = sst(0.76, 0.92, f(max(2, int(W / 0.25)), 78, 3)) * face * 0.7
    alb = alb * (1 - 0.3 * salt)[..., None] + (0.22 * salt)[..., None] * np.array([0.8, 0.78, 0.72])[None, None, :]
  out = {}

  def calibrate(a, target):
    tgt = np.mean(target) / 255
    g = 1.0
    for _ in range(8):
      g *= (tgt / srgb_enc(a * g).mean()) ** 2.2
    return a * g

  # whitewash over the same bricks: the relief and rough map are shared, only the colour is new (drips, peeling to brick)
  if spec.get('paint'):
    pw = lin((232, 227, 214))[None, None, :] * (0.96 + white * 0.1 + (f(int(W / 0.012), 82, 2) - 0.5) * 0.12)[..., None]
    pw = pw * (1 - 0.32 * mortar)[..., None] * (1 + 0.06 * edge)[..., None]
    pw = pw * (1 - 0.12 * streak - 0.12 * soot)[..., None] * (1 - 0.25 * pit)[..., None]
    pw = pw * (1 - 0.9 + 0.9 * ao)[..., None]
    pm = f(max(2, int(W / 0.2)), 120, 2) * 0.55 + f(max(2, int(W / 0.07)), 121, 2) * 0.45
    peel = np.clip((pm - 0.62) / 0.12, 0, 0.7) * face
    out['paint'] = srgb_enc(calibrate(pw * (1 - peel)[..., None] + calibrate(alb, spec['target']) * peel[..., None], spec['paint']['target']))
  # calibrate the mean sRGB to the generated texture the level was lit against
  alb = calibrate(alb, spec['target'])

  rgh = np.clip(R[..., 0] + (f(int(W / 0.02), 79, 2) - 0.5) * 0.1 + white * 0.1, 0.05, 1.0)
  # damp areas are a little glossier
  rgh = rgh - 0.18 * damp * face
  return srgb_enc(alb), nrm, np.clip(rgh, 0.04, 1.0), out


def hrand_field(res, seed):
  rng = np.random.default_rng(seed)
  return rng.random((res[1], res[0]))


def save_webp(path, rgb, quality, size=None, grey=False):
  """rgb: (h, w, 3) floats 0..1, row 0 = bottom (v = 0). Written through a byte image in Non-Color so nothing is transformed."""
  h, w = rgb.shape[:2]
  img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False, float_buffer=False)
  img.colorspace_settings.name = 'Non-Color'
  px = np.concatenate([rgb, np.ones((h, w, 1))], axis=2).astype(np.float32)
  img.pixels.foreach_set(px.ravel())
  img.file_format = 'WEBP'
  img.save(filepath=path, quality=quality)
  bpy.data.images.remove(img)
  return os.path.getsize(path)


def save_png(path, rgb):
  h, w = rgb.shape[:2]
  img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False, float_buffer=False)
  img.colorspace_settings.name = 'Non-Color'
  img.pixels.foreach_set(np.concatenate([rgb, np.ones((h, w, 1))], axis=2).astype(np.float32).ravel())
  img.file_format = 'PNG'
  img.save(filepath=path)
  bpy.data.images.remove(img)


QUALITY = {'albedo': 82, 'normal': 90, 'rough': 80}


def setup_scene(seed):
  bpy.ops.wm.read_factory_settings(use_empty=True)
  sc = bpy.context.scene
  sc.render.engine = 'CYCLES'
  sc.cycles.device = 'CPU'
  sc.cycles.seed = seed
  sc.cycles.use_animated_seed = False
  sc.cycles.use_denoising = False
  sc.cycles.samples = 16
  sc.cycles.use_adaptive_sampling = False
  sc.view_settings.view_transform = 'Standard'
  w = bpy.data.worlds.new('w')
  w.use_nodes = True
  sc.world = w
  w.light_settings.ao_factor = 1.0
  w.light_settings.distance = 0.03
  return sc


def run(name, out_dir, ss, debug=None):
  spec = SPECS[name]
  t0 = time.time()
  sc = setup_scene(7)
  soup, blocks, nb = build_geometry(spec)
  V, F, alb, rgh, msk = soup.arrays()
  high = make_mesh_object(name + '-high', V, F, alb, rgh, msk)
  tgt = make_target(spec['W'], spec['H'])
  t1 = time.time()
  res = spec['res']
  size = (res[0] * ss, res[1] * ss)
  A = bake(tgt, high, 'DIFFUSE', size, samples=4)
  t2 = time.time()
  Nn = bake(tgt, high, 'NORMAL', size, samples=4)
  M = bake(tgt, high, 'EMIT', size, samples=4)
  Rr = bake(tgt, high, 'ROUGHNESS', size, samples=4)
  t3 = time.time()
  AOb = bake(tgt, high, 'AO', res, samples=32)  # smooth, so baked at the final size, 32 samples a pixel
  t4 = time.time()
  A, M, Rr = (down(a, ss) for a in (A, M, Rr))
  Nn = down(Nn * 2 - 1, ss)
  Nn = Nn / np.maximum(np.linalg.norm(Nn, axis=-1, keepdims=True), 1e-6) * 0.5 + 0.5
  alb_srgb, nrm, rgh_out, extra = post(spec, A, Nn, AOb, Rr, M, res)
  t5 = time.time()
  os.makedirs(out_dir, exist_ok=True)
  sizes = {}
  sizes['albedo'] = save_webp(os.path.join(out_dir, f'{name}-albedo.webp'), alb_srgb, QUALITY['albedo'])
  sizes['normal'] = save_webp(os.path.join(out_dir, f'{name}-normal.webp'), nrm * 0.5 + 0.5, QUALITY['normal'])
  rg = down(rgh_out[..., None], 2)[..., 0] if spec['half_rough'] else rgh_out
  sizes['rough'] = save_webp(os.path.join(out_dir, f'{name}-rough.webp'), np.stack([rg, rg, rg], -1), QUALITY['rough'])
  for en, ea in extra.items():
    sizes[en + ' albedo'] = save_webp(os.path.join(out_dir, f'{en}-albedo.webp'), ea, QUALITY['albedo'])
  if debug:
    for en, ea in extra.items():
      os.makedirs(debug, exist_ok=True)
      save_png(os.path.join(debug, f'{en}-albedo.png'), ea)
    os.makedirs(debug, exist_ok=True)
    save_png(os.path.join(debug, f'{name}-albedo.png'), alb_srgb)
    save_png(os.path.join(debug, f'{name}-normal.png'), nrm * 0.5 + 0.5)
    save_png(os.path.join(debug, f'{name}-rough.png'), np.stack([rgh_out] * 3, -1))
    save_png(os.path.join(debug, f'{name}-ao.png'), np.clip(AOb, 0, 1))
    save_png(os.path.join(debug, f'{name}-mask.png'), np.clip(M, 0, 1))
    # a 2 x 2 repeat of the albedo, to look for seams and repeats
    save_png(os.path.join(debug, f'{name}-albedo-2x2.png'), np.tile(alb_srgb, (2, 2, 1)))
    save_png(os.path.join(debug, f'{name}-normal-2x2.png'), np.tile(nrm * 0.5 + 0.5, (2, 2, 1)))
  print(f'{name}: {nb} blocks, {len(V)} verts; geometry {t1 - t0:.1f}s, albedo {t2 - t1:.1f}s, normal+mask+rough {t3 - t2:.1f}s, '
        f'ao {t4 - t3:.1f}s, post {t5 - t4:.1f}s, total {time.time() - t0:.1f}s; bytes ' + ', '.join(f'{k} {v}' for k, v in sizes.items()) +
        f' (sum {sum(sizes.values())})')
  return sizes


def main():
  ap = argparse.ArgumentParser()
  ap.add_argument('--only', default='brick,flag')
  ap.add_argument('--out', default='assets/textures')
  ap.add_argument('--debug', default=None)
  ap.add_argument('--ss', type=int, default=2)
  a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
  tot = {}
  for nme in a.only.split(','):
    for k, v in run(nme, a.out, a.ss, a.debug).items():
      tot[k] = tot.get(k, 0) + v
  print('total bytes', sum(tot.values()), tot)


if __name__ == '__main__':
  main()
