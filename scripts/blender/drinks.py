"""Builds the five power-up drinks in Blender and writes them to src/drink-meshes.js for the game.
Run with: ~/.venvs/blender/bin/python scripts/blender/drinks.py [--out src/drink-meshes.js] [--preview sheet.png]
                                                               [--blend drinks.blend]

Every drink is modelled in its own frame: axis along z (Blender), rim at the top, origin at the grip centre, front
(the label side, towards the player) at -y. Part names, pivots and sizes are what the animation code in
src/models.js expects, so the drinks can be reworked here without touching it. The names on the labels are invented.
"""
import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
from kit import Part, cube, lathe, prism, prof, sphere, wrap  # noqa: E402

PI = math.pi
cos, sin = math.cos, math.sin


def lerp(a, b, t):
  return a + (b - a) * t


# ---------------------------------------------------------------------------------------------
# Wee Dram: a heavy cut-glass whisky tumbler, amber, nine flutes round the foot
# ---------------------------------------------------------------------------------------------

def dram():
  def flute(r, z, th, tag):
    if tag != 1:
      return r
    return r + 0.0011 * (0.5 + 0.5 * cos(9 * th)) * (1 - kit.sstep(0.0, 0.05, z))

  outer = [(0, -0.075), (0.047, -0.075, 0.004, 1), (0.0535, -0.05, 0, 1), (0.058, 0.0, 0, 1), (0.0662, 0.07, 0, 1),
           (0.0668, 0.075, 0.0012, 1)]
  inner = [(0.0622, 0.075, 0.0012), (0.0606, 0.07), (0.0545, 0.0), (0.0486, -0.032, 0.0), (0.049, -0.0355, 0.007),
           (0, -0.0355)]
  glass = Part('glass', 'glass')
  glass.add(lathe(prof(outer + inner), 27, rmod=flute))
  # the amber: follows the inner wall, 0.6 mm clear of it, with a slightly dished surface
  liquid = Part('liquid', 'liquid', origin=(0, 0, -0.035), grad=[0x6a2c06, 0xf08a14, 0.8, 1.0])
  liquid.add(lathe(prof([(0, 0.0003), (0.0462, 0.0003, 0.004), (0.0539, 0.035), (0.0583, 0.085, 0.001),
                         (0.0555, 0.0838), (0, 0.0828)]), 24))
  return [glass, liquid]


# ---------------------------------------------------------------------------------------------
# Bruiser Orange: a glass bottle of fizzy orange, knurled screw cap, paper label with an orange slice
# ---------------------------------------------------------------------------------------------

def orange():
  outer = [(0, -0.1135), (0.021, -0.1185), (0.054, -0.12, 0.009, 1), (0.054, 0.082, 0, 1), (0.0505, 0.12, 0.016, 1),
           (0.036, 0.15, 0.012, 1), (0.022, 0.18, 0.012, 1), (0.0198, 0.215, 0.0, 1), (0.0236, 0.222, 0.004, 1),
           (0.0238, 0.26, 0.0, 1), (0.0245, 0.265, 0.001, 1)]
  inner = [(0.0185, 0.265, 0.0008), (0.0165, 0.24), (0.016, 0.19, 0.0), (0.032, 0.15, 0.006), (0.045, 0.12, 0.01),
           (0.05, 0.08), (0.05, -0.09, 0.012), (0.04, -0.108, 0.01), (0.012, -0.106), (0, -0.105)]
  glass = Part('glass', 'glass')
  glass.add(lathe(prof(outer + inner), 26))
  liquid = Part('liquid', 'liquid', origin=(0, 0, -0.105), grad=[0xb83000, 0xff7a0a, 0.8, 1.0])
  liquid.add(lathe(prof([(0, 0.001), (0.0455, 0.001, 0.005), (0.0495, 0.02), (0.0493, 0.19), (0.0452, 0.213, 0.003),
                         (0.0, 0.2125)]), 20))

  # label: cream paper with a scalloped top edge, an orange band and a dark foot band, then the slice emblem
  R = 0.0543
  label = Part('label', 'pbr', origin=(0, 0, -0.02))

  def scallop(r, z, th, tag):
    return z - (0.0045 * (0.5 + 0.5 * cos(6 * th)) if tag == 2 else 0.0)

  label.add(lathe(prof([(R, -0.05, 0, 0), (R + 0.0009, -0.05, 0, 0), (R + 0.0009, 0.05, 0, 2), (R, 0.05, 0, 2)]), 48,
                  zmod=scallop, closed=True), 0xeee4c8, 'paper', wear=0)
  label.add(lathe(prof([(R, -0.04), (R + 0.0014, -0.04), (R + 0.0014, -0.012), (R, -0.012)]), 48, closed=True),
            0xe86a10, 'gloss', wear=0)
  label.add(lathe(prof([(R, -0.0465), (R + 0.0014, -0.0465), (R + 0.0014, -0.042), (R, -0.042)]), 48, closed=True),
            0x1a1a1a, 'gloss', wear=0)
  # slice emblem on the front, bent to the bottle. The discs are lathes turned to face -y, thickness outwards.
  w = wrap(R + 0.0008)
  ez = 0.0165
  face = (PI / 2, 0, 0)
  label.add(lathe(prof([(0, 0), (0.0235, 0), (0.0235, 0.0011), (0, 0.0011)]), 28), 0x1a1a1a, 'gloss', wear=0, rot=face, at=(0, 0, ez), warp=w)
  label.add(lathe(prof([(0, 0.0006), (0.0215, 0.0006), (0.0215, 0.0016), (0, 0.0016)]), 28), 0xff8a14, 'gloss', wear=0, rot=face,
            at=(0, 0, ez), warp=w)
  label.add(lathe(prof([(0, 0.0012), (0.0188, 0.0012), (0.0188, 0.0021), (0, 0.0021)]), 28), 0xf4e6c0, 'paper', wear=0, rot=face,
            at=(0, 0, ez), warp=w)
  for i in range(8):
    a0, a1 = i * PI / 4 + 0.07, (i + 1) * PI / 4 - 0.07
    poly = [(0.0016 * cos((a0 + a1) / 2), 0.0016 * sin((a0 + a1) / 2))]
    poly += [(0.0172 * cos(a0 + (a1 - a0) * k / 3), 0.0172 * sin(a0 + (a1 - a0) * k / 3)) for k in range(4)]
    label.add(prism(poly, 0.0007), 0xffb23c, 'gloss', wear=0, at=(0, -0.0021, ez), warp=w)

  # cap: knurled skirt, domed top, a tamper band cut off below a groove
  def knurl(r, z, th, tag):
    return r + (0.0009 * (0.5 + 0.5 * cos(18 * th)) if tag == 1 else 0.0)

  cap = Part('cap', 'pbr', origin=(0, 0, 0.281))
  cap.add(lathe(prof([(0, 0.0168), (0.0125, 0.0168, 0.004), (0.0262, 0.0156, 0.003, 1), (0.0262, -0.006, 0, 1),
                      (0.0252, -0.0066), (0.0242, -0.0075), (0.0262, -0.0078), (0.0262, -0.0158, 0.001), (0.0238, -0.016),
                      (0.0238, -0.0085), (0, -0.0085)]), 54, rmod=knurl), 0xd9701a, 'gloss')
  return [glass, liquid, label, cap]


# ---------------------------------------------------------------------------------------------
# Pint of Heavy: a nonic pint glass of dark ale with a lumpy cream head
# ---------------------------------------------------------------------------------------------

def heavy():
  outer = [(0, -0.1285), (0.034, -0.13), (0.0425, -0.13, 0.004, 1), (0.0452, -0.1, 0, 1), (0.0525, 0.02, 0, 1),
           (0.0565, 0.07, 0.01, 1), (0.0641, 0.09, 0.012, 1), (0.06, 0.111, 0.012, 1), (0.0628, 0.13, 0.0015, 1)]
  inner = [(0.0585, 0.13, 0.0012), (0.0576, 0.1), (0.0526, 0.02), (0.0472, -0.06, 0.0), (0.0415, -0.1, 0.005),
           (0.038, -0.115, 0.01), (0, -0.115)]
  glass = Part('glass', 'glass')
  glass.add(lathe(prof(outer + inner), 26))
  liquid = Part('liquid', 'liquid', origin=(0, 0, -0.113), grad=[0x120802, 0x4a2008, 0.9, 1.0])
  liquid.add(lathe(prof([(0, 0.0005), (0.0375, 0.0005, 0.004), (0.042, 0.015), (0.0499, 0.1), (0.0563, 0.2, 0.0015),
                         (0, 0.2)]), 20))
  foam = Part('foam', 'liquid', origin=(0, 0, 0.087), grad=[0xcdb888, 0xefe2bc, 0.9, 1.05])
  foam.add(lathe(prof([(0, 0), (0.0563, 0), (0.0572, 0.010, 0.004), (0.056, 0.026, 0.01), (0.03, 0.040, 0.012),
                       (0, 0.0455)]), 24))
  # bubbles and lumps in the head: noise pushed along the normal, stronger towards the top
  foam.displace(lambda co, n: co + n * 0.0013 * (kit.pnoise(co.x, co.y, co.z, 160) - 0.45) * (0.4 + co.z * 18))
  return [glass, liquid, foam]


# ---------------------------------------------------------------------------------------------
# Bassline Energy: a slim black can, magenta and cyan glow stripes, a lightning bolt, a pull tab
# ---------------------------------------------------------------------------------------------

def energy():
  can = Part('can', 'pbr')
  # body with a domed base, a chamfered chime, the neck-in and a recessed lid
  can.add(lathe(prof([(0, -0.1285), (0.0185, -0.1335), (0.026, -0.135, 0.003), (0.0312, -0.1285, 0.004),
                      (0.0345, -0.115, 0.006), (0.0357, -0.1, 0.0), (0.0357, 0.1, 0.006), (0.0345, 0.118, 0.006),
                      (0.028, 0.128, 0.004), (0.0262, 0.132), (0, 0.132)]), 30), 0x2e2e3a, 'gloss', wear=0.7)
  can.add(lathe(prof([(0.0262, 0.1318), (0.0286, 0.1318, 0.001), (0.0292, 0.1395, 0.0015), (0.0268, 0.1398, 0.001),
                      (0.0262, 0.1368), (0.0, 0.1366)]), 36), 0xc4c6c4, 'chrome')
  can.add(lathe(prof([(0.0226, -0.1335), (0.0300, -0.1346, 0.002), (0.0312, -0.1285), (0.027, -0.1318)]), 30),
          0xc4c6c4, 'chrome')
  # pour opening, a dark kidney on the lid behind the tab
  can.add(lathe(prof([(0, 0.0004), (0.0112, 0.0004, 0.002), (0.0112, -0.0003), (0, -0.0003)]), 20), 0x07070a, 'plastic',
          at=(0, 0.0072, 0.1369), scale=(1, 1.05, 1))
  # the bolt, bent to the can
  bolt = [(0.003, 0.018), (-0.007, -0.002), (-0.001, -0.002), (-0.004, -0.018), (0.007, 0.004), (0.001, 0.004)]
  can.add(prism(bolt, 0.0009), 0xff4aa6, 'gloss', wear=0, at=(0, 0, 0.085), warp=wrap(0.0356))

  def band(name, z, hexcol):
    p = Part(name, 'glow', origin=(0, 0, z), glow=[hexcol, 1.8])
    p.add(lathe(prof([(0.0353, -0.008), (0.0362, -0.0072, 0.0004), (0.0362, 0.0072, 0.0004), (0.0353, 0.008)]), 28,
                closed=True))
    return p

  # pull tab: pivots on its rivet, a little forward of the lid centre; the finger ring stays inside the rim
  tab = Part('tab', 'pbr', origin=(0, -0.004, 0.138))
  tab.add(lathe(prof([(0.0042, -0.0005), (0.0075, -0.0005, 0.0006), (0.0075, 0.0007, 0.0006), (0.0042, 0.0007, 0.0005)]), 24,
                closed=True), 0xc4c6c4, 'chrome', at=(0, -0.0165, -0.0005))
  tab.add(cube(0.012, 0.019, 0.0012), 0xc4c6c4, 'chrome', at=(0, -0.0025, -0.0004))
  tab.add(lathe(prof([(0, -0.0016), (0.0034, -0.0016), (0.0034, 0.0006, 0.0006), (0, 0.0009)]), 14), 0x8d9096, 'chrome')
  return [can, band('stripeM', 0.045, 0xff2e93), band('stripeC', 0.018, 0x22d3ee), tab]


# ---------------------------------------------------------------------------------------------
# Last Orders: a big dark-glass bottle, gold foil neck and a gold label with a bell
# ---------------------------------------------------------------------------------------------

def lastorders():
  glass = Part('glass', 'darkglass')
  glass.add(lathe(prof([(0, -0.138), (0.026, -0.1455), (0.0415, -0.16, 0.003), (0.056, -0.16, 0.006),
                        (0.062, -0.15, 0.008, 1), (0.062, 0.07, 0.02, 1), (0.045, 0.13, 0.014, 1), (0.03, 0.16, 0.014, 1),
                        (0.024, 0.19, 0.008, 1), (0.0235, 0.26, 0.0, 1), (0.026, 0.275, 0.003, 1), (0.026, 0.29, 0.003, 1),
                        (0, 0.29)]), 28))
  liquid = Part('liquid', 'liquid', origin=(0, 0, -0.15), grad=[0x9a5a00, 0xffc030, 0.9, 1.5])
  liquid.add(lathe(prof([(0, 0.004), (0.0575, 0.004, 0.0), (0.0585, 0.2, 0.0), (0.05, 0.23, 0.01), (0.032, 0.255, 0.004),
                         (0, 0.255)]), 22))

  # foil: a flared skirt, pleated neck, crowned top, a ring at the hem
  def pleat(r, z, th, tag):
    return r + (0.0005 * cos(12 * th) * kit.sstep(0.19, 0.24, z) if tag == 1 else 0.0)

  foil = Part('foil', 'pbr')
  foil.add(lathe(prof([(0.0326, 0.113), (0.0378, 0.114, 0.0015, 1), (0.0372, 0.119, 0.0, 1), (0.0343, 0.13, 0.005, 1),
                       (0.0282, 0.165, 0.01, 1), (0.0268, 0.215, 0.0, 1), (0.0268, 0.272, 0.003, 1),
                       (0.0305, 0.279, 0.003, 1), (0.0312, 0.287, 0.002, 1), (0.0295, 0.2925, 0.002, 1), (0, 0.2925)]), 48,
                 rmod=pleat), 0xd4a52a, 'brass')
  foil.add(lathe(prof([(0.0368, 0.108), (0.0402, 0.108, 0.002), (0.0402, 0.1134, 0.002), (0.0368, 0.1134)]), 32, closed=True),
           0xb88a20, 'brass')

  # label: gold paper with a wavy top and foot, dark bands and the bell emblem
  R = 0.0624
  label = Part('label', 'pbr', origin=(0, 0, -0.03))

  def wave(r, z, th, tag):
    if tag == 2:
      return z - 0.006 * (0.5 + 0.5 * cos(4 * th))
    if tag == 3:
      return z + 0.004 * (0.5 + 0.5 * cos(4 * th + 2))
    return z

  label.add(lathe(prof([(R, -0.06, 0, 3), (R + 0.0008, -0.06, 0, 3), (R + 0.0008, 0.06, 0, 2), (R, 0.06, 0, 2)]), 48,
                  zmod=wave, closed=True), 0xd4a52a, 'gloss', wear=0.3)
  label.add(lathe(prof([(R, -0.05), (R + 0.0014, -0.05), (R + 0.0014, -0.04), (R, -0.04)]), 48, closed=True),
            0x1a1208, 'gloss', wear=0)
  label.add(lathe(prof([(R, 0.04), (R + 0.0014, 0.04), (R + 0.0014, 0.047), (R, 0.047)]), 48, closed=True),
            0x1a1208, 'gloss', wear=0)
  w = wrap(R + 0.0008)
  diamond = [(0, 0.0318), (0.0318, 0), (0, -0.0318), (-0.0318, 0)]
  label.add(prism(diamond, 0.0018), 0x1a1208, 'metal', wear=0, at=(0, 0, 0.0), warp=w)
  d2 = [(0, 0.0235), (0.0235, 0), (0, -0.0235), (-0.0235, 0)]
  label.add(prism(d2, 0.0006), 0xe6bc40, 'brass', at=(0, -0.0018, 0.0), warp=w)
  # the bell: a lathe squashed flat so it reads as relief
  bell = lathe(prof([(0, 0.0105), (0.0016, 0.0105, 0.001), (0.0042, 0.0075, 0.003), (0.0062, 0.0, 0.0), (0.0092, -0.0075, 0.003),
                     (0.0098, -0.0092, 0.001), (0.0, -0.0092)], 3), 20)
  label.add(bell, 0x1a1208, 'gloss', scale=(1, 0.22, 1), at=(0, -0.0021, 0.0006), warp=w)
  label.add(sphere(0.0026, 8, 6), 0x1a1208, 'gloss', scale=(1, 0.5, 1), at=(0, -0.0021, -0.0112), warp=w)
  return [glass, liquid, foil, label]


DRINKS = {'dram': dram, 'orange': orange, 'heavy': heavy, 'energy': energy, 'lastorders': lastorders}


def build_all():
  out = {}
  built = {}
  for did, fn in DRINKS.items():
    t0 = time.time()
    parts = fn()
    for p in parts:
      kit.bake_part(p, None)
    bvh = kit.occluder_bvh(parts)
    out[did] = {p.name: kit.encode_part(p, bvh) for p in parts}
    built[did] = parts
    tris = sum(v['tris'] for v in out[did].values())
    verts = sum(v['n'] for v in out[did].values())
    print(f'{did:11s} {len(parts)} parts  {verts:5d} verts  {tris:5d} tris  ({time.time() - t0:.1f}s)')
  return out, built


HEADER = """// Generated by scripts/blender/drinks.py from the Blender models of the five power-up drinks. Do not edit by hand:
// change the script and run it again (see README.md, "Blender").
// Per part: `pos` is the pivot in the drink's frame, `p` quantised positions (int16 x `sc`), `nrm` normals (int8),
// `idx` triangle indices (uint16), and for baked parts `col` (sRGB bytes, ambient occlusion and wear included) and
// `sf` (roughness, metalness bytes). `grad` is a liquid's [bottom, top, bottom gain, top gain], `glow` is [colour, gain].
export const DRINK_MESHES = """


def main():
  ap = argparse.ArgumentParser()
  here = os.path.dirname(os.path.abspath(__file__))
  ap.add_argument('--out', default=os.path.join(here, '..', '..', 'src', 'drink-meshes.js'))
  ap.add_argument('--preview')
  ap.add_argument('--blend')
  a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
  data, built = build_all()
  for d in data.values():
    for p in d.values():
      p.pop('tris')
  with open(a.out, 'w') as f:
    f.write(HEADER + json.dumps(data, separators=(',', ':')).replace('},"', '},\n"') + ';\n')
  print('wrote', os.path.relpath(a.out), f'({os.path.getsize(a.out) / 1024:.0f} KB)')
  if a.preview or a.blend:
    import preview
    preview.scene(built, a.preview, a.blend)


if __name__ == '__main__':
  main()
