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
SO = 0  # seed offset for the noise of one variant of a surface (0 for the first, so that bake does not change)


def lattice(cx, cy, seed):
  k = (cx, cy, seed, SO)
  if k not in _lat:
    rng = random.Random((seed + SO) * 100003 + cx * 1009 + cy)
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


def flag_blocks(v=0):
  """9 or 8 flagstones in 2 m, laid out as the generated texture (variant 0: rows 0.69, 0.56 and 0.75 m high). Variant 1 is
  another layout for the second half of the atlas. Every row starts a slab at x = 0 and the rows fill 0 to 256, so a joint
  runs along the tile edge in every variant and any two variants meet at a joint; the courses may jog there, as flagging does."""
  rows = [(0, 88, [100, 92, 64]), (88, 72, [72, 112, 72]), (160, 96, [96, 80, 80])] if v == 0 else \
         [(0, 72, [60, 96, 100]), (72, 104, [112, 144]), (176, 80, [70, 70, 116])]
  u = 2.0 / 256
  j = 0.007
  out = []
  for ri, (top, hh, ws) in enumerate(rows):
    acc = 0
    for ci, w in enumerate(ws):
      cc, rr = ci + 10 * v, ri + 10 * v  # a different set of random numbers per variant
      i = hrand(cc, rr, 32)
      base = (118, 118, 116) if i < 0.4 else (104, 106, 108) if i < 0.75 else (128, 118, 106)
      k = 0.88 + 0.24 * hrand(cc, rr, 33)
      r = [(hrand(cc, rr, 60 + n) - 0.5) * 2 for n in range(4)]
      b = dict(
        id=(cc, rr), x0=acc * u + j + r[0] * 0.003, y0=top * u + j + r[1] * 0.003, w=w * u - 2 * j + r[2] * 0.004, h=hh * u - 2 * j + r[3] * 0.004,
        col=lin([min(255, c * k) for c in base]), rough=0.82, off=(hrand(cc, rr, 62) - 0.5) * 0.005,
        tx=(hrand(cc, rr, 63) - 0.5) * 0.006, ty=(hrand(cc, rr, 64) - 0.5) * 0.006, chips=[], flat=False)
      if hrand(cc, rr, 65) < 0.7:
        for n in range(1 + int(hrand(cc, rr, 66) * 2.5)):
          b['chips'].append(dict(cx=b['w'] * (hrand(cc, rr, 67 + n) < 0.5), cy=b['h'] * (hrand(cc, rr, 70 + n) < 0.5),
                                 rc=0.03 + 0.05 * hrand(cc, rr, 73 + n), dc=0.003 + 0.004 * hrand(cc, rr, 76 + n), s=n))
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
  'flag': dict(nvar=2, W=2.0, H=2.0, res=(512, 512), blocks=flag_blocks, r=0.013, D=0.016, famp=0.0022, fcells=9, step=0.016, mstep=0.012, wob=0.5,
               mortar=(46, 44, 42), mamp=0.0025, mcells=40, cvar=0.12, chipcol=(150, 146, 138),
               target=(104.1, 104.2, 99.8), wet=True, half_rough=True, micro=0.7, grain=0.15, boost=2.0, lowboost=5.0, ao_pow=1.3, ao_mix=1.0, streak=0.0),
  'stone': dict(W=1.2, H=1.2, res=(512, 512), blocks=stone_blocks, r=0.0075, D=0.012, famp=0.0016, fcells=8, step=0.011, mstep=0.008, wob=0.55,
                mortar=(66, 62, 56), mamp=0.0016, mcells=40, cvar=0.12, chipcol=(172, 160, 140),
                target=(133.4, 125.6, 113.0), half_rough=True, micro=0.75, grain=0.15, boost=2.0, lowboost=3.0, ao_pow=1.3, ao_mix=1.0, streak=0.12),
  'boards': dict(W=1.6, H=1.6, res=(512, 512), blocks=boards_blocks, r=0.003, D=0.006, famp=0.0006, fcells=5, step=0.02, mstep=0.01, wob=0.2,
                 mortar=(28, 20, 14), mamp=0.0005, mcells=30, cvar=0.10, chipcol=(120, 84, 56), wood=True,
                 target=(64.1, 41.4, 26.7), half_rough=True, micro=1.8, grain=0.0, boost=2.0, lowboost=2.0, ao_pow=1.2, ao_mix=1.0, streak=0.0),
  # field surfaces (see run_field): edge keeps variant features off the tile edge, pad_h and wave are the trowel relief in metres,
  # crack_hw the half width of a crack's mouth, chip_r and chip_d the radius and depth of a spall, damp_r a stain's radius,
  # stripe the trowel streaks in the micro relief. The two variants are one atlas, 1024 x 512, tile 4 x 2 m.
  'plaster': dict(field=True, W=2.0, H=2.0, res=(512, 512), step=0.0025, edge=0.14, pad_h=0.0003, wave=0.0010, pits=34,
                  base=(196, 186, 168), brick_col=(140, 100, 84), lath_col=(70, 56, 44), crack_len=(0.5, 1.1), crack_hw=0.0024,
                  chip_r=(0.04, 0.09), chip_d=(0.005, 0.009), damp_r=(0.35, 0.6), target=(107.6, 97.4, 85.2), boost=2.0, lowboost=6.0,
                  micro=1.0, stripe=0.08, grain=0.2, ao_pow=1.3, ao_mix=1.0,
                  variants=[dict(seed=101, cracks=3, chips=1, patches=0, damps=1, soot=1), dict(seed=202, cracks=4, chips=1, patches=2, damps=0, soot=1)]),
  # one slab per tile (the joints are on the tile edge), 2.4 m, no atlas
  'concrete': dict(field=True, W=2.4, H=2.4, res=(512, 512), step=0.003, wave=0.0008, pits=140, base=(190, 190, 186), crack_len=(0.4, 1.0), crack_hw=0.0022,
                   joint_d=0.006, oil_r=(0.08, 0.2), damp_r=(0.2, 0.45), polish_r=(0.35, 0.8), target=(104.8, 104.8, 102.6), boost=2.0, lowboost=6.0,
                   micro=1.2, stripe=0.0, grain=0.22, ao_pow=1.3, ao_mix=1.0,
                   variants=[dict(seed=303, cracks=3, oils=2, damps=1, polish=3)]),
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


def build_geometry(spec, vi=0):
  W, H = spec['W'], spec['H']
  soup = Soup()
  blocks = spec["blocks"](vi) if spec.get("nvar") else spec["blocks"]()
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


def post(spec, A, N, AO, R, M, res, calib=True):
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
  crown = np.zeros_like(X)
  wetm = np.zeros_like(X)
  if spec.get('wet'):
    crown = sst(0.45, 0.6, f(5, 131, 3)) * face * (1 - edge)
    wetm = sst(0.62, 0.8, f(5, 132, 3)) * face
    alb = alb * (1 - 0.3 * wetm)[..., None]  # wet stone is darker
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
  if calib:
    alb = calibrate(alb, spec["target"])

  rgh = np.clip(R[..., 0] + (f(int(W / 0.02), 79, 2) - 0.5) * 0.1 + white * 0.1, 0.05, 1.0)
  # damp areas are a little glossier
  rgh = rgh - 0.18 * damp * face
  # flags: boots polish the crowns, and damp patches are wet and glossy (the old generated floor had both, and the torch
  # finds them in the Vaults)
  rgh = rgh - 0.3 * crown
  rgh = rgh * (1 - wetm) + 0.3 * wetm
  return (srgb_enc(alb) if calib else alb), nrm, np.clip(rgh, 0.04, 1.0), out


def hrand_field(res, seed):
  rng = np.random.default_rng(seed + SO)
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


# ---------------------------------------------------------------------------------------------
# Field surfaces (plaster, concrete): one continuous skin instead of blocks. The surface is a heightfield on a periodic grid
# (so it tiles exactly), meshed at a few millimetres and baked like the block surfaces. A texture may be an atlas of
# several variants side by side: every variant has the same background (trowel pads, grain, soft stains: one seed) and its
# own cracks, chips, patches and stains, all kept clear of the tile edge. world.js picks a variant for each ceiling tile, so
# neighbouring tiles join without a seam and a long vault does not repeat the same crack every 2 m.
# ---------------------------------------------------------------------------------------------

class Grid:
  def __init__(self, W, H, step):
    self.W, self.H = W, H
    self.nx, self.ny = int(round(W / step)), int(round(H / step))
    self.step = W / self.nx
    xs = np.arange(self.nx) * self.step
    ys = np.arange(self.ny) * self.step
    self.X, self.Y = np.meshgrid(xs, ys)

  def box(self, cx, cy, ext):
    """periodic box of half-size ext around (cx, cy): local offsets DX, DY, the index tuple into a (ny, nx) field, and the
    unwrapped world coordinates (for the tileable noise, which wraps by itself)"""
    r = int(math.ceil(ext / self.step)) + 1
    i0, j0 = int(round(cx / self.step)), int(round(cy / self.step))
    ii = np.arange(i0 - r, i0 + r + 1)
    jj = np.arange(j0 - r, j0 + r + 1)
    GX, GY = np.meshgrid(ii * self.step, jj * self.step)
    return GX - cx, GY - cy, np.ix_(jj % self.ny, ii % self.nx), GX, GY


def voronoi(g, cells, seed):
  """tileable Voronoi: F1, F2, offset from the nearest point, and the nearest cell's id"""
  cw, ch = g.W / cells, g.H / cells
  pxs = np.empty((cells, cells))
  pys = np.empty((cells, cells))
  for j in range(cells):
    for i in range(cells):
      pxs[j, i] = (i + 0.15 + 0.7 * hrand(i, j, seed)) * cw
      pys[j, i] = (j + 0.15 + 0.7 * hrand(i, j, seed + 1)) * ch
  ci = np.floor(g.X / cw).astype(np.int64)
  cj = np.floor(g.Y / ch).astype(np.int64)
  f1 = np.full(g.X.shape, 1e9)
  f2 = np.full(g.X.shape, 1e9)
  ox = np.zeros(g.X.shape)
  oy = np.zeros(g.X.shape)
  idx = np.zeros(g.X.shape, np.int64)
  for dj in (-1, 0, 1):
    for di in (-1, 0, 1):
      ii, jj = ci + di, cj + dj
      fx = pxs[jj % cells, ii % cells] + (ii // cells) * g.W
      fy = pys[jj % cells, ii % cells] + (jj // cells) * g.H
      d = np.hypot(g.X - fx, g.Y - fy)
      closer = d < f1
      f2 = np.where(closer, f1, np.minimum(f2, d))
      ox = np.where(closer, g.X - fx, ox)
      oy = np.where(closer, g.Y - fy, oy)
      idx = np.where(closer, (jj % cells) * cells + (ii % cells), idx)
      f1 = np.where(closer, d, f1)
  return f1, f2, ox, oy, idx


def wrap_pad(a, m):
  return np.pad(a, [(m, m), (m, m)] + [(0, 0)] * (a.ndim - 2), mode='wrap')


def seg_dist(px, py, ax, ay, bx, by):
  """distance from points to the segment a-b, and the position t (0..1) along it"""
  vx, vy = bx - ax, by - ay
  l2 = vx * vx + vy * vy + 1e-12
  t = np.clip(((px - ax) * vx + (py - ay) * vy) / l2, 0, 1)
  return np.hypot(px - (ax + t * vx), py - (ay + t * vy)), t


def crack_paths(rng, n, lo, hi, length, hw):
  """n hairline cracks as lists of (x, y, half width): a wandering main run plus short branches that taper to nothing.
  Everything stays inside [lo, hi] so no crack touches the tile edge."""
  paths = []
  for _ in range(n):
    x, y = rng.uniform(lo + 0.25, hi - 0.25), rng.uniform(lo + 0.25, hi - 0.25)
    th = rng.uniform(0, 2 * math.pi)
    steps = int(rng.uniform(*length) / 0.012)
    main = []
    for k in range(steps):
      t = k / max(1, steps - 1)
      main.append((x, y, hw * (0.35 + 0.65 * math.sin(math.pi * min(1, t * 1.15 + 0.08)) ** 0.6)))
      th += rng.gauss(0, 0.2) + (rng.gauss(0, 0.8) if rng.random() < 0.03 else 0)  # smooth wander, now and then a kink
      x, y = x + 0.012 * math.cos(th), y + 0.012 * math.sin(th)
      if not (lo < x < hi and lo < y < hi):
        break
    if len(main) < 6:
      continue
    paths.append(main)
    for _b in range(rng.choice((1, 2, 2, 3))):
      k0 = rng.randrange(2, len(main) - 2)
      bx, by, bw = main[k0]
      bth = math.atan2(main[k0 + 1][1] - main[k0 - 1][1], main[k0 + 1][0] - main[k0 - 1][0]) + rng.choice((-1, 1)) * rng.uniform(0.4, 0.9)
      bl = int(rng.uniform(0.08, 0.3) / 0.012)
      br = []
      for k in range(bl):
        t = k / max(1, bl - 1)
        br.append((bx, by, bw * 0.7 * (1 - t) ** 0.8 + 0.0003))
        bth += rng.gauss(0, 0.25)
        bx, by = bx + 0.012 * math.cos(bth), by + 0.012 * math.sin(bth)
        if not (lo < bx < hi and lo < by < hi):
          break
      if len(br) > 4:
        paths.append(br)
  return paths


def plaster_field(spec, vi):
  """heightfield, albedo (linear), roughness and mask for one plaster variant, on the periodic grid. Heights in metres,
  positive towards the viewer. mask: R crack, G chip, B repaired patch."""
  v = spec['variants'][vi]
  g = Grid(spec['W'], spec['H'], spec['step'])
  W, H = g.W, g.H
  X, Y = g.X, g.Y
  rng = random.Random(v['seed'])
  lo, hi = spec['edge'], W - spec['edge']  # variant features stay inside this

  def f(cells, seed, octaves=3):
    return fbm(X, Y, W, H, cells, seed, octaves)

  # ---- background, the same for every variant ----
  f1, f2, ox, oy, cid = voronoi(g, 4, 11)
  cr = np.array([[hrand(i, 0, 301), hrand(i, 1, 301), hrand(i, 2, 301), hrand(i, 3, 301)] for i in range(16)])
  pad = cr[cid, 0] * 2 - 1
  h = spec["pad_h"] * pad + 0.0008 * ((cr[cid, 1] * 2 - 1) * ox + (cr[cid, 2] * 2 - 1) * oy) / 0.25  # each float of the trowel sits a little differently
  h = h + 0.0003 * np.exp(-(((f2 - f1) / 0.011) ** 2))  # a ridge where one pad meets the next
  h = h + spec["wave"] * ((f(5, 21, 3) - 0.5) * 2 + 0.6 * (f(11, 25, 2) - 0.5) * 2)
  h = blur(h, 5, 2)
  alb = np.broadcast_to(lin(spec['base'])[None, None, :], X.shape + (3,)).copy()
  tone = 1 + 0.09 * (f(7, 22, 3) - 0.5) * 2 + 0.03 * (cr[cid, 3] - 0.5) * 2
  rgh = 0.9 + 0.035 * (f(12, 23, 2) - 0.5) * 2
  msk = np.zeros(X.shape + (3,))
  # blown-lime pits: small round craters
  for k in range(spec['pits']):
    px_, py_ = hrand(k, 1, 700) * W, hrand(k, 2, 700) * H
    r = 0.004 + 0.007 * hrand(k, 3, 700) ** 1.5
    DX, DY, ix, GX, GY = g.box(px_, py_, r * 1.6)
    d = np.hypot(DX, DY) / r
    dep = 0.0006 + 0.0016 * hrand(k, 4, 700)
    h[ix] += -dep * (1 - sst(0.2, 1.0, d)) + 0.0003 * np.exp(-(((d - 1.15) / 0.2) ** 2))
    alb[ix] *= (1 - 0.25 * (1 - sst(0.4, 1.0, d)))[..., None]

  # ---- this variant: cracks, chips, patches, damp, soot ----
  crack_d = np.zeros(X.shape)  # groove depth
  crack_s = np.zeros(X.shape)  # soft dirt line beside it
  for path in crack_paths(rng, v.get('cracks', 0), lo, hi, spec['crack_len'], spec['crack_hw']):
    for (ax, ay, aw), (bx, by, bw) in zip(path[:-1], path[1:]):
      DX, DY, ix, GX, GY = g.box((ax + bx) / 2, (ay + by) / 2, max(aw, bw) * 3 + 0.01)
      d, t = seg_dist(GX, GY, ax, ay, bx, by)
      hw = aw + (bw - aw) * t
      crack_d[ix] = np.maximum(crack_d[ix], np.clip(1 - d / hw, 0, 1) * hw * 1.05)
      crack_s[ix] = np.maximum(crack_s[ix], np.clip(1 - d / (hw * 3.0), 0, 1))
  h -= crack_d
  alb *= (1 - 0.62 * np.clip(crack_d / 0.0012, 0, 1) - 0.18 * crack_s)[..., None]
  msk[..., 0] = np.clip(crack_d / 0.001, 0, 1)

  chipm = np.zeros(X.shape)
  for ci_ in range(v.get('chips', 0)):
    cx, cy = rng.uniform(lo + 0.1, hi - 0.1), rng.uniform(lo + 0.1, hi - 0.1)
    r = rng.uniform(*spec['chip_r'])
    dep = rng.uniform(*spec['chip_d'])
    ph = [rng.uniform(0, 6.3) for _ in range(5)]
    brick = rng.random() < 0.6
    DX, DY, ix, GX, GY = g.box(cx, cy, r * 1.9)
    th = np.arctan2(DY, DX)
    R = r * (1 + sum(0.13 / (k + 1) ** 0.5 * np.cos((k + 2) * th + ph[k]) for k in range(5)))
    R = R * (1 + 0.45 * (pn(GX, GY, W, H, 36, 36, 51 + ci_) - 0.5) + 0.2 * (pn(GX, GY, W, H, 110, 110, 55 + ci_) - 0.5))
    d = np.hypot(DX, DY)
    inside = sst(0.0, 0.006, R - d)  # steep walls, a thumb wide
    fl = (pn(GX, GY, W, H, 90, 90, 52 + ci_) - 0.5) * 0.0024 + (pn(GX, GY, W, H, 30, 30, 53 + ci_) - 0.5) * 0.002
    h[ix] = h[ix] * (1 - inside) + (-dep + fl) * inside + 0.0006 * np.exp(-(((d - R - 0.004) / 0.004) ** 2)) * (1 - inside)  # crumbled lip
    col = lin(spec['brick_col'] if brick else spec['lath_col'])[None, None, :] * (0.75 + 0.5 * pn(GX, GY, W, H, 60, 60, 54 + ci_))[..., None]
    alb[ix] = alb[ix] * (1 - inside)[..., None] + col * inside[..., None]
    rgh[ix] = rgh[ix] * (1 - inside) + 0.97 * inside
    chipm[ix] = np.maximum(chipm[ix], inside)
  msk[..., 1] = chipm

  patchm = np.zeros(X.shape)
  for pi_ in range(v.get('patches', 0)):
    cx, cy = rng.uniform(lo + 0.3, hi - 0.3), rng.uniform(lo + 0.3, hi - 0.3)
    a, b = rng.uniform(0.11, 0.26), rng.uniform(0.09, 0.22)
    rot = rng.uniform(0, math.pi)
    amp = rng.uniform(0.0014, 0.0026)
    tn = rng.choice((0.92, 1.0, 1.08, 1.14)) * np.array([1.0, 0.99, 0.96])
    gapped = rng.random() < 0.7
    DX, DY, ix, GX, GY = g.box(cx, cy, max(a, b) * 1.5 + 0.04)
    qx = DX * math.cos(rot) + DY * math.sin(rot)
    qy = -DX * math.sin(rot) + DY * math.cos(rot)
    rr = 0.04
    q0, q1 = np.abs(qx) - (a - rr), np.abs(qy) - (b - rr)
    sdf = np.hypot(np.maximum(q0, 0), np.maximum(q1, 0)) + np.minimum(np.maximum(q0, q1), 0) - rr
    sdf = sdf + (pn(GX, GY, W, H, 30, 30, 61 + pi_) - 0.5) * 0.045
    inside = 1 - sst(-0.006, 0.014, sdf)
    h[ix] += amp * inside
    if gapped:  # the hairline where the patch meets the old plaster
      gap = np.clip(1 - np.abs(sdf - 0.004) / 0.0022, 0, 1)
      h[ix] -= 0.0022 * gap
      alb[ix] *= (1 - 0.4 * gap)[..., None]
      mk = msk[..., 0]
      mk[ix] = np.maximum(mk[ix], gap * 0.7)
    alb[ix] = alb[ix] * (1 - inside)[..., None] + alb[ix] * (tn[None, None, :] * (1 + 0.05 * (pn(GX, GY, W, H, 12, 12, 62 + pi_) - 0.5) * 2)[..., None]) * inside[..., None]
    rgh[ix] = rgh[ix] - 0.07 * inside  # trowelled smoother
    patchm[ix] = np.maximum(patchm[ix], inside)
  msk[..., 2] = patchm

  # damp: a stain with a dark tide line at its edge
  for di_ in range(v.get('damps', 0)):
    cx, cy = rng.uniform(lo + 0.35, hi - 0.35), rng.uniform(lo + 0.35, hi - 0.35)
    r = rng.uniform(*spec['damp_r'])
    asp = rng.uniform(0.6, 1.0)
    rot = rng.uniform(0, math.pi)
    DX, DY, ix, GX, GY = g.box(cx, cy, r * 1.6)
    qx = DX * math.cos(rot) + DY * math.sin(rot)
    qy = (-DX * math.sin(rot) + DY * math.cos(rot)) / asp
    d = np.hypot(qx, qy) / r + (pn(GX, GY, W, H, 9, 9, 71 + di_) - 0.5) * 0.7 + (pn(GX, GY, W, H, 26, 26, 72 + di_) - 0.5) * 0.18
    gxm, gym = GX % W, GY % H
    win = sst(0.08, 0.22, np.minimum(np.minimum(gxm, W - gxm), np.minimum(gym, H - gym)))  # fade out before the tile edge
    inner = (1 - sst(0.55, 1.0, d)) * win
    tide = np.exp(-(((d - 0.95) / 0.07) ** 2)) * win
    stain = np.array([0.74, 0.64, 0.5])
    mott = 0.75 + 0.5 * pn(GX, GY, W, H, 14, 14, 73 + di_)
    wgt = (inner * 0.8 * mott)[..., None]
    alb[ix] = alb[ix] * (1 - wgt) + alb[ix] * stain[None, None, :] * wgt
    alb[ix] *= (1 - 0.32 * tide)[..., None]
    rgh[ix] = rgh[ix] - 0.2 * inner  # damp plaster is a little glossier
    h[ix] += -0.0006 * inner + 0.0004 * tide  # blistered and swollen

  # a grey bloom of soot where the smoke sits
  for si_ in range(v.get('soot', 0)):
    cx, cy = rng.uniform(lo + 0.3, hi - 0.3), rng.uniform(lo + 0.3, hi - 0.3)
    r = rng.uniform(0.18, 0.4)
    DX, DY, ix, GX, GY = g.box(cx, cy, r * 1.5)
    d = np.hypot(DX, DY) / r + (pn(GX, GY, W, H, 10, 10, 81 + si_) - 0.5) * 0.6
    alb[ix] *= ((1 - 0.28 * (1 - sst(0.2, 1.0, d)))[..., None]) * np.array([1.0, 1.0, 1.03])[None, None, :]

  alb = alb * tone[..., None] * (1 - 0.1 * sst(0.55, 0.8, f(4, 24, 3)))[..., None]
  return g, h, alb, np.clip(rgh, 0.3, 1.0), msk


def concrete_field(spec, vi):
  """a trowelled slab: expansion joints on the tile edge (every slab is one tile), air holes, hairline cracks, oil and damp
  stains, polished boot tracks and a few patches where the cement skin has worn off and the aggregate shows. Same outputs as
  plaster_field. Features may cross the tile edge: the stamps wrap."""
  v = spec['variants'][vi]
  g = Grid(spec['W'], spec['H'], spec['step'])
  W, H = g.W, g.H
  X, Y = g.X, g.Y
  rng = random.Random(v['seed'])

  def f(cells, seed, octaves=3):
    return fbm(X, Y, W, H, cells, seed, octaves)

  h = spec['wave'] * ((f(5, 121, 3) - 0.5) * 2 + 0.6 * (f(12, 125, 2) - 0.5) * 2)
  f1, f2, ox, oy, cid = voronoi(g, 5, 12)
  h = h + 0.00035 * (np.array([hrand(i, 0, 321) for i in range(25)])[cid] * 2 - 1) + 0.00025 * np.exp(-(((f2 - f1) / 0.012) ** 2))  # trowel passes
  h = blur(h, 4, 2)
  alb = np.broadcast_to(lin(spec['base'])[None, None, :], X.shape + (3,)).copy()
  tone = 1 + 0.12 * (f(6, 122, 3) - 0.5) * 2 + 0.05 * (f(18, 123, 2) - 0.5) * 2
  rgh = 0.86 + 0.04 * (f(10, 124, 2) - 0.5) * 2
  msk = np.zeros(X.shape + (3,))
  # air holes
  for k in range(spec['pits']):
    px_, py_ = hrand(k, 1, 710) * W, hrand(k, 2, 710) * H
    r = 0.003 + 0.007 * hrand(k, 3, 710) ** 1.6
    DX, DY, ix, GX, GY = g.box(px_, py_, r * 1.6)
    d = np.hypot(DX, DY) / r
    h[ix] += -(0.0012 + 0.0022 * hrand(k, 4, 710)) * (1 - sst(0.2, 1.0, d))
    alb[ix] *= (1 - 0.4 * (1 - sst(0.4, 1.0, d)))[..., None]
  # worn skin: the pale cement film gone from a path, the grit showing
  worn = sst(0.6, 0.78, f(4, 126, 3)) * (0.5 + 0.5 * f(24, 127, 2))
  alb *= (1 - 0.12 * worn)[..., None]
  # expansion joints: a groove along the tile edge with a chamfer on each slab, filled with dust and old bitumen
  dxe = np.minimum(X, W - X)
  dye = np.minimum(Y, H - Y)
  dj = np.minimum(dxe, dye)
  wob = (pn(X, Y, W, H, 30, 30, 128) - 0.5) * 0.0016
  jd = np.maximum(dj + wob, 0)
  h -= spec["joint_d"] * (1 - sst(0.003, 0.011, jd))
  jm = 1 - sst(0.003, 0.009, jd)
  alb *= (1 - 0.6 * jm)[..., None]
  msk[..., 0] = jm
  # cracks
  crack_d = np.zeros(X.shape)
  crack_s = np.zeros(X.shape)
  for path in crack_paths(rng, v.get('cracks', 0), 0.05, W - 0.05, spec['crack_len'], spec['crack_hw']):
    for (ax, ay, aw), (bx, by, bw) in zip(path[:-1], path[1:]):
      DX, DY, ix, GX, GY = g.box((ax + bx) / 2, (ay + by) / 2, max(aw, bw) * 3 + 0.01)
      d, t = seg_dist(GX, GY, ax, ay, bx, by)
      hw = aw + (bw - aw) * t
      crack_d[ix] = np.maximum(crack_d[ix], np.clip(1 - d / hw, 0, 1) * hw * 1.05)
      crack_s[ix] = np.maximum(crack_s[ix], np.clip(1 - d / (hw * 3.0), 0, 1))
  h -= crack_d
  alb *= (1 - 0.6 * np.clip(crack_d / 0.0012, 0, 1) - 0.15 * crack_s)[..., None]
  msk[..., 0] = np.maximum(msk[..., 0], np.clip(crack_d / 0.001, 0, 1))
  # stains: oil (dark, glossy), damp (darker, glossy, pale salts at the edge) and polished boot tracks (smooth, a little lighter)
  stainm = np.zeros(X.shape)
  for kind, key in (('oil', 'oils'), ('damp', 'damps'), ('polish', 'polish')):
    for si_ in range(v.get(key, 0)):
      cx, cy = rng.uniform(0, W), rng.uniform(0, H)
      r = rng.uniform(*spec[kind + '_r'])
      asp = rng.uniform(0.35, 1.0) if kind == 'polish' else rng.uniform(0.6, 1.0)
      rot = rng.uniform(0, math.pi)
      DX, DY, ix, GX, GY = g.box(cx, cy, r * 1.6)
      qx = DX * math.cos(rot) + DY * math.sin(rot)
      qy = (-DX * math.sin(rot) + DY * math.cos(rot)) / asp
      d = np.hypot(qx, qy) / r + (pn(GX, GY, W, H, 9, 9, 131 + si_) - 0.5) * 0.7 + (pn(GX, GY, W, H, 28, 28, 132 + si_) - 0.5) * 0.2
      inner = (1 - sst(0.15, 1.0, d)) * (0.55 + 0.45 * pn(GX, GY, W, H, 12, 12, 134 + si_))
      edge = np.exp(-(((d - 0.95) / 0.08) ** 2))
      mott = 0.7 + 0.6 * pn(GX, GY, W, H, 16, 16, 133 + si_)
      if kind == 'oil':
        alb[ix] *= (1 - 0.62 * inner * mott)[..., None] * np.array([1.0, 0.97, 0.9])[None, None, :]
        rgh[ix] = rgh[ix] * (1 - inner) + 0.38 * inner
      elif kind == 'damp':
        alb[ix] *= (1 - 0.4 * inner * mott - 0.1 * edge)[..., None] * np.array([1.0, 1.0, 1.04])[None, None, :]
        alb[ix] = alb[ix] * (1 - 0.35 * edge[..., None]) + (0.3 * edge)[..., None] * np.array([0.8, 0.78, 0.72])[None, None, :] * 0.3
        rgh[ix] = rgh[ix] * (1 - inner * 0.8) + 0.45 * inner * 0.8
      else:
        alb[ix] *= (1 + 0.14 * inner)[..., None]
        rgh[ix] = rgh[ix] * (1 - inner) + 0.42 * inner
        h[ix] -= 0.00025 * inner
      stainm[ix] = np.maximum(stainm[ix], inner)
  msk[..., 2] = stainm
  alb = alb * tone[..., None]
  return g, h, alb, np.clip(rgh, 0.3, 1.0), msk


FIELDS = {'plaster': plaster_field, 'concrete': concrete_field}


def field_geometry(name, spec, vi):
  """the periodic fields wrapped into a margin, as one mesh soup"""
  g, h, alb, rgh, msk = FIELDS[name](spec, vi)
  m = int(math.ceil(MARGIN / g.step))
  xs = (np.arange(g.nx + 2 * m) - m) * g.step
  ys = (np.arange(g.ny + 2 * m) - m) * g.step
  X, Y = np.meshgrid(xs, ys)
  soup = Soup()
  soup.add_grid(X, Y, wrap_pad(h, m), wrap_pad(alb, m), wrap_pad(rgh, m), wrap_pad(msk, m))
  return soup, g


def post_field(name, spec, vi, A, N, AO, R, M, res):
  """numpy detail on one variant's bake. Returns linear albedo (not yet calibrated), normal, roughness."""
  W, H = spec['W'], spec['H']
  rw, rh = res
  X, Y = np.meshgrid((np.arange(rw) + 0.5) / rw * W, (np.arange(rh) + 0.5) / rh * H)

  def f(cells, seed, octaves=3):
    return fbm(X, Y, W, H, cells, seed, octaves)

  crack = np.clip(M[..., 0], 0, 1)
  chip = np.clip(M[..., 1], 0, 1)
  patch = np.clip(M[..., 2], 0, 1)
  white = hrand_field(res, 75) - 0.5
  n = N * 2 - 1
  n = n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
  sx0 = n[..., 0] / np.maximum(n[..., 2], 0.2)
  sy0 = n[..., 1] / np.maximum(n[..., 2], 0.2)
  lb = spec['lowboost'] - 1
  rr_ = max(2, int(rw / 60))
  sx = (sx0 + lb * blur(sx0, rr_)) * spec['boost']
  sy = (sy0 + lb * blur(sy0, rr_)) * spec['boost']
  # micro relief: sand grain and the faint stripes a trowel leaves (a direction per pad, so it does not read as a pattern)
  _, _, _, _, cid = voronoi(Grid(W, H, W / rw), 4, 11)
  ang = np.array([hrand(i, 0, 310) * math.pi for i in range(16)])[cid]
  stripe = np.sin((X * np.cos(ang) + Y * np.sin(ang)) * (2 * math.pi / 0.012) + 6 * f(20, 91, 2)) * 0.5 + 0.5
  stripe = stripe * sst(0.35, 0.65, f(14, 92, 2))
  hf = f(int(W / 0.02), 71, 2) * 0.5 + f(int(W / 0.008), 72, 2) * 0.3 + white * 0.06 + stripe * spec["stripe"]
  hf = hf * (1 - 0.65 * patch) * (1 - 0.5 * chip) + chip * (f(int(W / 0.004), 93, 2) - 0.5) * 0.8
  gx = (np.roll(hf, -1, 1) - np.roll(hf, 1, 1)) * 0.5
  gy = (np.roll(hf, -1, 0) - np.roll(hf, 1, 0)) * 0.5
  sx = sx - gx * spec['micro']
  sy = sy - gy * spec['micro']
  inv = 1 / np.sqrt(sx * sx + sy * sy + 1)
  nrm = np.stack([sx * inv, sy * inv, inv], -1)

  alb = A.copy()
  ao = np.clip(AO[..., 0], 0, 1) ** spec['ao_pow']
  alb *= (1 - spec['ao_mix'] + spec['ao_mix'] * ao)[..., None]
  grain = ((f(int(W / 0.04), 74, 2) - 0.5) * 2 * 0.6 + (f(int(W / 0.012), 82, 2) - 0.5) * 2 * 0.5 + white * 1.3) * spec['grain']
  alb *= (1 + grain * (1 - 0.5 * patch) * (1 + 2.0 * chip))[..., None]
  fleck = sst(0.8, 0.9, f(int(W / 0.006), 94, 2))  # dark impurities in the lime
  alb *= (1 - 0.22 * fleck * (1 - chip))[..., None]
  lime = sst(0.82, 0.92, f(int(W / 0.01), 95, 2))  # unslaked lime: little pale lumps
  alb = alb * (1 - 0.5 * lime)[..., None] + (0.35 * lime)[..., None] * np.array([0.85, 0.82, 0.76])[None, None, :]
  # the broken edge of a chip shows the chalky white of the top coat
  rim = np.clip(np.clip(blur(chip, 3) - chip, 0, 1) * 3, 0, 1) * (1 - chip)
  alb = alb * (1 - 0.8 * rim)[..., None] + (0.64 * rim)[..., None] * np.array([0.9, 0.87, 0.8])[None, None, :]
  rgh_out = np.clip(R[..., 0] + (f(int(W / 0.02), 79, 2) - 0.5) * 0.06 + white * 0.08, 0.2, 1.0)
  return alb, nrm, rgh_out


def run_field(name, out_dir, ss, debug=None):
  spec = SPECS[name]
  t0 = time.time()
  res = spec['res']
  nv = len(spec['variants'])
  albs, nrms, rghs = [], [], []
  for vi in range(nv):
    setup_scene(7)
    ta = time.time()
    soup, g = field_geometry(name, spec, vi)
    V, F, alb, rgh, msk = soup.arrays()
    high = make_mesh_object(f'{name}-high', V, F, alb, rgh, msk)
    tgt = make_target(spec['W'], spec['H'])
    tb = time.time()
    size = (res[0] * ss, res[1] * ss)
    A = bake(tgt, high, 'DIFFUSE', size, samples=4)
    Nn = bake(tgt, high, 'NORMAL', size, samples=4)
    M = bake(tgt, high, 'EMIT', size, samples=4)
    Rr = bake(tgt, high, 'ROUGHNESS', size, samples=4)
    AOb = bake(tgt, high, 'AO', res, samples=32)
    tc = time.time()
    A, M, Rr = (down(a, ss) for a in (A, M, Rr))
    Nn = down(Nn * 2 - 1, ss)
    Nn = Nn / np.maximum(np.linalg.norm(Nn, axis=-1, keepdims=True), 1e-6) * 0.5 + 0.5
    a, n, r = post_field(name, spec, vi, A, Nn, AOb, Rr, M, res)
    albs.append(a)
    nrms.append(n)
    rghs.append(r)
    if debug:
      os.makedirs(debug, exist_ok=True)
      save_png(os.path.join(debug, f'{name}{vi}-ao.png'), np.clip(AOb, 0, 1))
      save_png(os.path.join(debug, f'{name}{vi}-mask.png'), np.clip(M, 0, 1))
    print(f'  {name} variant {vi}: {len(V)} verts; geometry {tb - ta:.1f}s, bakes {tc - tb:.1f}s, post {time.time() - tc:.1f}s')
  # one gain for the whole atlas (so every variant keeps the same background at the shared tile edges), then each channel's
  # mean onto the old generated texture's: exposure and tints were set against that
  lin_all = np.concatenate(albs, axis=1)
  alb_s = np.empty_like(lin_all)
  for c in range(3):
    gain = 1.0
    for _ in range(8):
      gain *= (spec['target'][c] / 255 / srgb_enc(lin_all[..., c] * gain).mean()) ** 2.2
    alb_s[..., c] = srgb_enc(lin_all[..., c] * gain)
  nrm_all = np.concatenate(nrms, axis=1)
  rgh_all = np.concatenate(rghs, axis=1)
  os.makedirs(out_dir, exist_ok=True)
  sizes = {}
  sizes['albedo'] = save_webp(os.path.join(out_dir, f'{name}-albedo.webp'), alb_s, QUALITY['albedo'])
  sizes['normal'] = save_webp(os.path.join(out_dir, f'{name}-normal.webp'), nrm_all * 0.5 + 0.5, QUALITY['normal'])
  rg = down(rgh_all[..., None], 2)[..., 0]
  sizes['rough'] = save_webp(os.path.join(out_dir, f'{name}-rough.webp'), np.stack([rg, rg, rg], -1), QUALITY['rough'])
  if debug:
    save_png(os.path.join(debug, f'{name}-albedo.png'), alb_s)
    save_png(os.path.join(debug, f'{name}-normal.png'), nrm_all * 0.5 + 0.5)
    save_png(os.path.join(debug, f'{name}-rough.png'), np.stack([rgh_all] * 3, -1))
    save_png(os.path.join(debug, f'{name}-albedo-2x2.png'), np.tile(alb_s, (2, 2, 1)))
  print(f'{name}: {nv} variants, total {time.time() - t0:.1f}s; bytes ' + ', '.join(f'{k} {v}' for k, v in sizes.items()) + f' (sum {sum(sizes.values())})')
  return sizes


def run_atlas(name, out_dir, ss, debug=None):
  """a block surface with several layouts side by side (flags): each variant has its own layout and noise, the mean colour is
  calibrated over the whole atlas. World.js gives each floor tile one variant, as it does for the plaster ceiling."""
  global SO
  spec = SPECS[name]
  t0 = time.time()
  res = spec['res']
  albs, nrms, rghs = [], [], []
  for vi in range(spec['nvar']):
    SO = 1000 * vi
    sc = setup_scene(7)
    ta = time.time()
    soup, blocks, nb = build_geometry(spec, vi)
    V, F, alb, rgh, msk = soup.arrays()
    high = make_mesh_object(f'{name}-high', V, F, alb, rgh, msk)
    tgt = make_target(spec['W'], spec['H'])
    tb = time.time()
    size = (res[0] * ss, res[1] * ss)
    A = bake(tgt, high, 'DIFFUSE', size, samples=4)
    Nn = bake(tgt, high, 'NORMAL', size, samples=4)
    M = bake(tgt, high, 'EMIT', size, samples=4)
    Rr = bake(tgt, high, 'ROUGHNESS', size, samples=4)
    AOb = bake(tgt, high, 'AO', res, samples=32)
    A, M, Rr = (down(a, ss) for a in (A, M, Rr))
    Nn = down(Nn * 2 - 1, ss)
    Nn = Nn / np.maximum(np.linalg.norm(Nn, axis=-1, keepdims=True), 1e-6) * 0.5 + 0.5
    a, n, r, _ = post(spec, A, Nn, AOb, Rr, M, res, calib=False)
    albs.append(a)
    nrms.append(n)
    rghs.append(r)
    print(f'  {name} variant {vi}: {nb} blocks, {len(V)} verts; geometry {tb - ta:.1f}s, bakes {time.time() - tb:.1f}s')
  SO = 0
  lin_all = np.concatenate(albs, axis=1)
  tgt_m = np.mean(spec['target']) / 255
  gain = 1.0
  for _ in range(8):
    gain *= (tgt_m / srgb_enc(lin_all * gain).mean()) ** 2.2
  alb_s = srgb_enc(lin_all * gain)
  nrm_all = np.concatenate(nrms, axis=1)
  rgh_all = np.concatenate(rghs, axis=1)
  os.makedirs(out_dir, exist_ok=True)
  sizes = {}
  sizes['albedo'] = save_webp(os.path.join(out_dir, f'{name}-albedo.webp'), alb_s, QUALITY['albedo'])
  sizes['normal'] = save_webp(os.path.join(out_dir, f'{name}-normal.webp'), nrm_all * 0.5 + 0.5, QUALITY['normal'])
  rg = down(rgh_all[..., None], 2)[..., 0]
  sizes['rough'] = save_webp(os.path.join(out_dir, f'{name}-rough.webp'), np.stack([rg, rg, rg], -1), QUALITY['rough'])
  if debug:
    os.makedirs(debug, exist_ok=True)
    save_png(os.path.join(debug, f'{name}-albedo.png'), alb_s)
    save_png(os.path.join(debug, f'{name}-albedo-2x2.png'), np.tile(alb_s, (2, 1, 1)))
    save_png(os.path.join(debug, f'{name}-normal.png'), nrm_all * 0.5 + 0.5)
  print(f'{name}: {spec["nvar"]} variants, total {time.time() - t0:.1f}s; bytes ' + ', '.join(f'{k} {v}' for k, v in sizes.items()) + f' (sum {sum(sizes.values())})')
  return sizes


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
  ap.add_argument('--only', default='brick,flag,stone,boards,plaster,concrete')
  ap.add_argument('--out', default='assets/textures')
  ap.add_argument('--debug', default=None)
  ap.add_argument('--ss', type=int, default=2)
  a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
  tot = {}
  for nme in a.only.split(','):
    for k, v in (run_field if SPECS[nme].get('field') else run_atlas if SPECS[nme].get('nvar') else run)(nme, a.out, a.ss, a.debug).items():
      tot[k] = tot.get(k, 0) + v
  print('total bytes', sum(tot.values()), tot)


if __name__ == '__main__':
  main()
