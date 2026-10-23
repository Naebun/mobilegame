"""Builds the prepared arsenal in Blender and writes it to src/arsenal-meshes.js for the game: three held weapons (the
Feedback Beam, the Bass-Drop Grenade, the Airhorn) with Naebun's hands and a mounted torch on the two guns, the three
upgrade pickups (extended clips, speed loader, burst pedal) and the collectible record in four label variants.
Run with: ~/.venvs/blender/bin/python scripts/blender/arsenal.py [--out src/arsenal-meshes.js] [--only beam,grenade]
                                                                [--sheet sheet.png] [--preview NAME --view fp|side|top|rear|iso --png out.png]

Weapons use the frame of weapons.py: x right, y forward (the muzzle end), z up, metres, origin at the grip; the export turns
it into three.js axes (three = (x, z, -y)). Pickups (upgrades, records) are modelled upright around their own centre with
the front at -y, as the drinks are. Part names are what src/arsenal.js drives: `body`, `emitter`, `led0` to `led4`, `band`,
`torch` and `lens` (the torch API every held weapon shares), `hands`. This file is self-contained on purpose: it imports
kit.py and copies the few small helpers it needs from weapons.py, because weapons.py is being edited by others. The names
on the models are invented. Output is repeatable (run twice and cmp).
"""
import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
from kit import Part, lathe, loft, prof, sweep  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

PI = math.pi
cos, sin = math.cos, math.sin
V = Vector

# colours (the same hexes as models.js so the guns still match the world they sit in)
GUNMETAL, STEEL, DARK, BRASS, CHROME = 0x3c3f46, 0x55585e, 0x2a2b2e, 0x9a7a34, 0xc4c6c4
WOOD, WOOD_D, TAPE, RUBBER, CONE, BLACK = 0x6b4a2c, 0x2a1c10, 0x4c483f, 0x161616, 0x2a2420, 0x08080a
# Naebun: skin, jacket (purple leather), cuff and the pink stripe, read from makeNaebun in models.js
SKIN, SKIN_D, JACKET, CUFF, PINK = 0xd9a687, 0xc08a6c, 0x5a2ba6, 0x2e1658, 0xff4f9f

AY = (-PI / 2, 0, 0)  # lathe axis z -> forward (+y)
AX = (0, PI / 2, 0)   # lathe axis z -> right (+x)

# ---------------------------------------------------------------------------------------------
# Small builders. Everything is hand-built (see kit.py), so the output is the same on every run.
# ---------------------------------------------------------------------------------------------

def box(w, d, h, b=0.004, n=1, sub=0.0):
  """A bevelled block: w across x, d along y (length), h along z, centred. n=1 is a chamfer, more rounds it. Give a
  painted block `sub` (about 0.006) so it wears at its edges only (see kit._ring); bare metal needs no extra rings."""
  b = 0.0 if n == 0 else min(b, 0.45 * min(w, d, h))
  return loft([((0, -d / 2, 0), w, h, b), ((0, d / 2, 0), w, h, b)], n=n, bevel=b, bsteps=n, sub=sub)


def rev(pts, seg=20, n=1):
  """A turned part along y: pts are (radius, distance along the axis[, fillet]) from the rear to the front."""
  return lathe(prof(pts, n), seg)


def zrev(pts, seg=20, n=1):
  """A turned part about the vertical axis."""
  return lathe(prof(pts, n), seg)


def tube(pts, r, seg=7, per=3, r1=None, closed=False, up=(0, 0, 1), bevel=0.0):
  """A round rod along a spline through pts."""
  r1 = r if r1 is None else r1
  sz = [(2 * (r + (r1 - r) * i / (len(pts) - 1)),) * 2 for i in range(len(pts))]
  return loft(sweep(pts, sz, per, closed), seg=seg, up=up, closed=closed, bevel=bevel, bsteps=2)


def ring_path(c, r, ry, plane='yz', n=12, a0=0.0, a1=2 * PI):
  """Points round an ellipse centred c in the yz plane (ry along y, r along z) or xz (ry along x)."""
  pts = []
  for i in range(n):
    a = a0 + (a1 - a0) * i / n
    if plane == 'yz':
      pts.append((c[0], c[1] + ry * cos(a), c[2] + r * sin(a)))
    else:
      pts.append((c[0] + ry * cos(a), c[1], c[2] + r * sin(a)))
  return pts


def guard(P, c, ry, rz, r=0.0055, hexc=STEEL, surf='metal'):
  """A trigger guard: a closed loop in the side plane."""
  pts = ring_path(c, rz, ry, 'yz', 10)
  P.add(loft(sweep(pts, [(2 * r, 2 * r)] * len(pts), 1, True), seg=6, up=(1, 0, 0), closed=True), hexc, surf)


def rake(a):
  return Matrix.Rotation(a, 3, 'X')

def lamp_bezel(P, c, r=0.0145, seg=14):
  P.add(rev([(r, 0), (r, 0.003), (r * 0.78, 0.0035)], seg), CHROME, 'chrome', wear=0, at=c, rot=(0, 0, 0))

# ---------------------------------------------------------------------------------------------
# Handles: a raked grip with taped wraps and wooden side panels, built straight and then tilted
# ---------------------------------------------------------------------------------------------

def handle(P, c, L, w, d, tilt, wood=True, tape=4, cap=True, flare=0.004, grooves=2, top=None, mat=(RUBBER, 'rubber'),
           panel=WOOD, bands=TAPE):
  """c is the centre, L the length along the handle, w across (x), d front to back (y). tilt rakes the bottom back."""
  top = w * 0.94 if top is None else top
  st = []
  n = 7
  for i in range(n + 1):
    t = i / n  # 0 top, 1 bottom
    z = L / 2 - L * t
    ww = top + (w - top) * min(1, t * 1.6) + (flare * 2 if t > 0.92 else 0)
    dd = d
    off = 0.0
    if grooves and 0.2 < t < 0.88:  # finger grooves down the front: the back face stays flat
      k = (t - 0.2) / 0.68 * grooves
      g = 0.5 - 0.5 * cos(2 * PI * (k % 1.0))
      dd = d - 0.007 * g
      off = -(d - dd) / 2
    st.append(((0, off, z), ww, dd, 0.012))
  P.add(loft(st, n=1, up=(0, 1, 0), bevel=0.003, bsteps=1), mat[0], mat[1], wear=0, at=c, rot=(tilt, 0, 0))
  for i in range(tape):
    t = 0.18 + 0.7 * (i + 0.5) / tape
    z = L / 2 - L * t
    P.add(loft([((0, 0, z - 0.0055), w * 0.98 + 0.004, d + 0.003, 0.012), ((0, 0, z + 0.0055), w * 0.98 + 0.004, d + 0.003, 0.012)],
               n=1, up=(0, 1, 0), bevel=0.0015, bsteps=1), bands, 'tape', wear=0, at=c, rot=(tilt, 0, 0))
  if wood:
    for s in (-1, 1):
      P.add(loft([((s * (w / 2 + 0.001), -0.002, L * 0.5 - 0.012), 0.009, d * 0.8, 0.003), ((s * (w / 2 + 0.002), -0.002, -L * 0.5 + 0.03), 0.009, d * 0.8, 0.003)],
                 n=1, up=(0, 1, 0), bevel=0.003, bsteps=1), panel, 'wood', wear=0, at=c, rot=(tilt, 0, 0))
  if cap:
    P.add(box(w + 0.01, d + 0.012, 0.012, 0.004, 1), GUNMETAL, 'gloss', at=V(c) + rake(tilt) @ V((0, 0, -L / 2 - 0.004)), rot=(tilt, 0, 0))


# ---------------------------------------------------------------------------------------------
# Hands and forearms
# ---------------------------------------------------------------------------------------------

def wrap_fingers(P, c0, p, q, n3, Hp, Hq, zs, rf=0.0125, tips=1.0, hexc=SKIN):
  """Fingers curled round a grip. The grip is a rectangle in the plane spanned by p (the way the fingers travel
  forward along the flank) and q (across the front), centred c0, half sizes Hp, Hq; n3 is the plane normal that the
  fingers are stacked along at offsets zs. A finger starts at the rear of the flank (the knuckle), runs forward
  along it, rounds the corner and crosses the front face."""
  for i, z in enumerate(zs):
    r = rf * (0.88 if i == len(zs) - 1 else 1.0)  # the little finger is slimmer
    cc = c0 + p * Hp - q * Hq  # the corner of the grip

    def d(a):
      return -q * cos(a) + p * sin(a)

    pts = [c0 - p * (Hp - 0.006) - q * (Hq + r * 0.9),
           c0 + p * (Hp * 0.55) - q * (Hq + r * 0.98),
           cc + r * d(PI * 0.2),
           cc + r * d(PI * 0.42),
           c0 + p * (Hp + r * 0.94) + q * (Hq * 0.15),
           c0 + p * (Hp + r * 0.7) + q * (Hq * 0.78 * tips)]
    pts = [pt + n3 * z for pt in pts]
    sz = [(2 * r * 1.02, 2 * r * 1.06), (2 * r, 2 * r * 1.04), (2 * r * 0.98, 2 * r * 1.04), (2 * r * 0.95, 2 * r * 1.02),
          (2 * r * 0.9, 2 * r * 1.0), (2 * r * 0.78, 2 * r * 0.94)]
    P.add(loft(sweep(pts, sz, 1), seg=6, up=n3, bevel=r * 0.6, bsteps=1), hexc, 'skin')


def finger_path(P, pts, sizes, up, hexc=SKIN, per=1, seg=6, bevel=0.007):
  P.add(loft(sweep(pts, sizes, per), seg=seg, up=up, bevel=bevel, bsteps=1), hexc, 'skin')


def _rot_to(fwd, up):
  """Euler angles that turn the local frame (y forward, z up) so y points along fwd and z along up."""
  fwd = V(fwd).normalized()
  up = (V(up) - fwd * V(up).dot(fwd)).normalized()
  m = Matrix((fwd.cross(up), fwd, up)).transposed()  # columns x, y, z
  return tuple(m.to_euler())


def forearm(P, W, d, up=(0, 0, 1), length=0.5, watch=False):
  """The wrist (skin), a DJ wristband or a chunky watch, a ribbed cuff and the purple leather sleeve, from the wrist W
  back along the vector d for `length`. Only the first part shows: the arm leaves the bottom of the screen."""
  d = V(d).normalized()
  n1 = (V(up) - d * V(up).dot(d)).normalized()
  P.add(loft(sweep([W - d * 0.03, W + d * 0.075], [(0.056, 0.05), (0.052, 0.046)], 1), seg=10, up=up), SKIN, 'skin', wear=0)
  b0 = W + d * 0.012
  if watch:  # a black rubber strap with a chunky case on top of the wrist
    P.add(loft([(b0, 0.07, 0.066, 0.02), (b0 + d * 0.026, 0.07, 0.066, 0.02)], seg=10, up=up), RUBBER, 'rubber', wear=0)
    cp = b0 + d * 0.013 + n1 * 0.0345
    P.add(box(0.036, 0.034, 0.008, 0.003, 1, sub=0.0), CHROME, 'chrome', wear=0, at=cp, rot=_rot_to(d, n1))
    P.add(box(0.026, 0.024, 0.01, 0.002, 1, sub=0.0), BLACK, 'plastic', wear=0, at=cp + n1 * 0.0015, rot=_rot_to(d, n1))
  else:  # a woven pink sweatband
    P.add(loft([(b0, 0.074, 0.07, 0.02), (b0 + d * 0.032, 0.074, 0.07, 0.02)], seg=10, up=up), PINK, 'cloth', wear=0)
  c0 = W + d * 0.05
  P.add(loft([(c0, 0.1, 0.092), (c0 + d * 0.026, 0.1, 0.092)], seg=10, up=up), CUFF, 'rubber', wear=0)
  P.add(loft([(c0 + d * 0.028, 0.108, 0.1), (c0 + d * 0.044, 0.12, 0.112), (c0 + d * 0.06, 0.108, 0.1), (c0 + d * 0.09, 0.116, 0.108),
              (c0 + d * length, 0.13, 0.122)], seg=10, up=up, bevel=0.004, bsteps=1), JACKET, 'leather', wear=0)
  # the pink stripe round the forearm, as on his third-person jacket
  P.add(loft([(c0 + d * 0.2, 0.1275, 0.1195), (c0 + d * 0.215, 0.1275, 0.1195)], seg=10, up=up), PINK, 'gloss', wear=0)


def grip_axes(tilt, side):
  """Directions for a hand on a raked handle: p forward along the depth, u up the handle, q across the front."""
  R = rake(tilt)
  return R @ V((0, 1, 0)), R @ V((0, 0, 1)), V((-side, 0, 0))


def hand(H, side, c0, tilt, Hp, Hq, zs, index, thumb, arm, watch=False, palm_u=0.0, palm_h=0.125, rf=0.0125, reach=0.08):
  """A hand on a handle of half depth Hp and half width Hq centred c0 (raked by tilt). side is +1 for the right hand
  (knuckles on the right of the handle) or -1 for the left. index and thumb are lists of (x, y, z) points on the gun
  with x counted towards the knuckle side (so a left hand mirrors them); arm is the forearm's direction in the
  handle's frame, again with x towards the knuckle side."""
  c0 = V(c0)
  R = rake(tilt)
  p, u, q = grip_axes(tilt, side)

  def at(x, y, z):
    return c0 + R @ V((side * x, y, z))

  def ap(pt):
    return V((side * pt[0], pt[1], pt[2]))

  wrap_fingers(H, c0, p, q, u, Hp, Hq, zs, rf)
  if index:
    ix = [(2 * rf * 1.04, 2 * rf * 1.04), (2 * rf, 2 * rf), (2 * rf * 0.92, 2 * rf * 0.92), (2 * rf * 0.8, 2 * rf * 0.84)]
    finger_path(H, [ap(pt) for pt in index], ix[:len(index)] if len(index) <= 4 else ix + [ix[-1]] * (len(index) - 4), (0, 0, 1))
  if thumb:
    tz = [(2 * rf * 1.3, 2 * rf * 1.2), (2 * rf * 1.12, 2 * rf * 1.08), (2 * rf * 1.0, 2 * rf * 0.98), (2 * rf * 0.86, 2 * rf * 0.86)]
    finger_path(H, [ap(pt) for pt in thumb], tz[:len(thumb)], (0, 0, 1), bevel=0.008)
  # the back of the hand, widest on the grip and narrowing to the wrist
  w0 = 2 * Hq + 0.05
  s = [(at(0.006, -(Hp - 0.006), palm_u), w0, palm_h, 0.03),
       (at(0.012, -(Hp + 0.042), palm_u * 0.9), w0 * 0.82, palm_h * 0.78, 0.028),
       (at(0.014, -(Hp + reach), palm_u * 0.8), 0.06, 0.062, 0.022)]
  H.add(loft(s, n=1, up=u, bevel=0.012, bsteps=1), SKIN, 'skin')
  ad = R @ V((side * arm[0], arm[1], arm[2]))
  forearm(H, s[2][0], ad, (0, 0, 1), watch=watch)



# ---------------------------------------------------------------------------------------------
# The torch every held weapon carries: a `torch` body (painted in the gun's style) and a `lens` that the game lights
# up. Built along +y from the centre c of its rear face. Returns the lens position and direction.
# ---------------------------------------------------------------------------------------------

def torch_unit(T, L, c, r=0.017, length=0.075, body=GUNMETAL, band=CHROME, fins=0, bandc=None, lens_r=None):
  c = V(c)
  lens_r = lens_r or r * 0.8
  # barrel: a turned tube with a rolled front lip, and a flat rear cap
  T.add(rev([(0, 0), (r * 0.9, 0, 0.003), (r, 0.006), (r, length - 0.012), (r * 1.18, length - 0.008, 0.003), (r * 1.18, length), (lens_r * 1.06, length),
             (lens_r * 1.06, length - 0.006), (0, length - 0.006)], 16), body, 'gloss', at=c, rot=AY, wear=0.7)
  if fins:  # cooling fins (a stage lamp)
    for i in range(fins):
      y = length * (0.18 + 0.5 * i / max(1, fins - 1))
      T.add(rev([(r * 0.98, y - 0.0025), (r * 1.2, y - 0.0025), (r * 1.2, y + 0.0025), (r * 0.98, y + 0.0025)], 14), band, 'metal', wear=0, at=c, rot=AY)
  if bandc is not None:  # a painted band
    T.add(rev([(r * 0.99, length * 0.3), (r * 1.06, length * 0.3), (r * 1.06, length * 0.5), (r * 0.99, length * 0.5)], 16), bandc, 'gloss', wear=0, at=c, rot=AY)
  # chrome bezel round the glass, a push switch on top
  T.add(rev([(lens_r * 1.0, length - 0.004), (lens_r * 1.12, length - 0.004), (lens_r * 1.12, length + 0.002), (lens_r * 1.0, length + 0.002)], 16), band, 'chrome', wear=0, at=c, rot=AY)
  T.add(box(0.008, 0.012, 0.006, 0.0015, 1, sub=0.0), RUBBER, 'rubber', wear=0, at=c + V((0, length * 0.3, r + 0.002)))
  # the lens: a shallow glass disc in the bezel (the game drives its glow)
  L.add(rev([(0, 0), (lens_r * 0.98, 0), (lens_r * 0.9, 0.0025), (0, 0.004)], 14), 0xffffff, 'plastic', wear=0, at=c + V((0, length - 0.0035, 0)), rot=AY)
  return dict(pos=(c.x, c.y + length + 0.001, c.z), dir=(0, 1, 0))


def clamp_bracket(P, a, b, w=0.012, hexc=STEEL):
  """A flat strap between two points (a plate along the line from a to b)."""
  a, b = V(a), V(b)
  d = b - a
  P.add(loft([(a, w, 0.004, 0.0015), (b, w, 0.004, 0.0015)], n=1, up=(0, 0, 1) if abs(d.z) < abs(d.x) + abs(d.y) else (0, 1, 0)), hexc, 'metal', wear=0)


# ---------------------------------------------------------------------------------------------
# Feedback Beam: a stage-monitor wedge with a microphone-ball emitter. Five LEDs on each flank are the charge meter.
# ---------------------------------------------------------------------------------------------

CARPET, CARPET_D = 0x3e4150, 0x2c2f38  # a blue-grey painted wedge: black carpet disappeared in the dark
LED_COLOURS = [(0xff3a1a, 5.0), (0xffa020, 5.0), (0x40e8ff, 5.0), (0x40e8ff, 5.0), (0x9ff4ff, 6.0)]


def beam():
  P, E, H = Part('body'), Part('emitter', 'glow', glow=[0x7ff0ff, 7.0]), Part('hands', smooth=80)
  T, L = Part('torch'), Part('lens', 'glow', glow=[0xfff0d8, 3.0])
  leds = [Part(f'led{i}', 'glow', glow=[c, k]) for i, (c, k) in enumerate(LED_COLOURS)]
  zc = 0.048
  # the wedge: tall at the back, lower at the front, black carpet on ply with chrome corners
  P.add(loft([((0, -0.07, zc + 0.004), 0.074, 0.098, 0.014), ((0, 0.23, zc - 0.006), 0.074, 0.076, 0.014)], n=2, bevel=0.005, bsteps=1, sub=0.0),
        CARPET, 'gloss', wear=0)
  for y in (-0.07, 0.23):
    for sx in (-1, 1):
      for sz in (-1, 1):
        zz = zc + sz * (0.049 if y < 0 else 0.038) + (0.004 if y < 0 else -0.006)
        P.add(box(0.012, 0.016, 0.012, 0.0025, 0), CHROME, 'chrome', wear=0, at=(sx * 0.0345, y + (0.004 if y < 0 else -0.004), zz))
  # a steel top rail and a recessed meter plate on each flank
  P.add(box(0.026, 0.2, 0.007, 0.0025, 1), STEEL, 'metal', at=(0, 0.07, zc + 0.054))
  for s in (-1, 1):
    P.add(box(0.004, 0.17, 0.026, 0.001, 0), BLACK, 'plastic', wear=0, at=(s * 0.0375, 0.07, zc + 0.022))
    for i, p in enumerate(leds):
      p.add(box(0.005, 0.022, 0.012, 0.001, 0), 0xffffff, 'plastic', wear=0, at=(s * 0.0398, -0.002 + i * 0.034, zc + 0.022))
    P.add(box(0.004, 0.17, 0.003, 0.0005, 0), 0x40d8e8, 'gloss', wear=0, at=(s * 0.0375, 0.07, zc + 0.04))   # cyan pinstripe
  # barrel and the grille ball that is the microphone head
  P.add(rev([(0.022, 0.22), (0.022, 0.31)], 14), CHROME, 'chrome', at=(0, 0, zc), rot=AY)
  P.add(rev([(0.0245, 0.24), (0.0245, 0.262)], 14), 0xb0287d, 'gloss', wear=0, at=(0, 0, zc), rot=AY)
  P.add(rev([(0.027, 0.3), (0.034, 0.3, 0.002), (0.034, 0.326, 0.002), (0.027, 0.326)], 16), BRASS, 'brass', at=(0, 0, zc), rot=AY)
  bc = V((0, 0.386, zc))
  br = 0.05
  E.add(kit.sphere(0.03, 12, 8), 0xffffff, 'plastic', wear=0, at=bc)
  for dy in (-0.03, 0.0, 0.03):  # latitude hoops
    rr = math.sqrt(br * br - dy * dy)
    P.add(rev([(rr - 0.0022, dy - 0.0022), (rr + 0.0022, dy - 0.0022), (rr + 0.0022, dy + 0.0022), (rr - 0.0022, dy + 0.0022)], 14), CHROME, 'chrome', wear=0, at=bc, rot=AY)
  for k in range(6):  # meridian ribs, pole to pole
    th = PI * k / 6
    pts = []
    for j in range(7):
      ph = PI * (0.04 + 0.92 * j / 6)
      pts.append(bc + V((br * sin(ph) * cos(th), br * cos(ph), br * sin(ph) * sin(th))))
    P.add(tube(pts, 0.0024, seg=4, per=1), CHROME, 'chrome', wear=0)
  # rear: an XLR socket with a cable that drops away behind the grip
  P.add(rev([(0.022, -0.07), (0.022, -0.094, 0.003), (0.0, -0.094)], 14), STEEL, 'metal', at=(0, 0, zc + 0.004), rot=AY)
  P.add(rev([(0.016, -0.093), (0.016, -0.0965), (0.0, -0.0965)], 12), BLACK, 'plastic', wear=0, at=(0, 0, zc + 0.004), rot=AY)
  P.add(tube([(0, -0.1, zc + 0.004), (0, -0.15, zc + 0.004), (0.004, -0.2, zc - 0.05), (0.03, -0.215, -0.1), (0.055, -0.19, -0.19)], 0.0075, seg=5, per=2), RUBBER, 'rubber', wear=0)
  # trigger, guard and the raked grip of the pistol
  guard(P, (0, 0.012, -0.036), 0.03, 0.026)
  P.add(loft([((0, 0.026, -0.015), 0.01, 0.007, 0.002), ((0, 0.019, -0.033), 0.01, 0.007, 0.002)], n=1, up=(1, 0, 0), bevel=0.002, bsteps=1), STEEL, 'metal', wear=0)
  lamp_bezel(P, (0, -0.04, zc + 0.058))
  handle(P, (0, -0.03, -0.085), 0.17, 0.062, 0.078, -0.2, panel=CARPET_D, tape=3)
  # a foregrip under the barrel for the left hand
  fg = (0, 0.2, -0.04)
  handle(P, fg, 0.1, 0.04, 0.042, 0.0, wood=False, tape=3, grooves=0)
  P.add(box(0.05, 0.05, 0.016, 0.004, 1), STEEL, 'metal', at=(0, 0.2, 0.004))
  # the torch: a stage lamp clamped to the left flank, looking where the barrel looks
  lens = torch_unit(T, L, (-0.058, 0.04, zc - 0.002), r=0.019, length=0.085, body=0x1a1a1e, band=CHROME, fins=4, bandc=0xb0287d)
  clamp_bracket(P, (-0.0375, 0.055, zc - 0.002), (-0.05, 0.055, zc - 0.002), w=0.03)
  clamp_bracket(P, (-0.0375, 0.1, zc - 0.002), (-0.05, 0.1, zc - 0.002), w=0.02)
  # hands: the pistol's right hand on the grip, the SMG's left hand round the foregrip
  hand(H, 1, (0, -0.03, -0.085), -0.2, 0.039, 0.031, [0.005, -0.021, -0.046],
       index=[(0.046, -0.045, -0.016), (0.04, -0.008, -0.017), (0.03, 0.008, -0.023), (0.007, 0.011, -0.027)],
       thumb=[(-0.02, -0.06, 0.0), (-0.04, -0.02, 0.014), (-0.043, 0.035, 0.022), (-0.04, 0.08, 0.027)],
       arm=(0.2, -0.86, -0.46))
  left_hand(H, fg)
  return dict(body=P, emitter=E, torch=T, lens=L, hands=H, muzzle=(0, 0.44, zc), lamp=(0, -0.04, zc + 0.063), lensPose=lens, extra=leds)


def left_hand(H, fg, dz=0.0):
  """The SMG's left hand (round a short foregrip, sleeve coming up from the lower left), moved to a foregrip at fg."""
  fg = V(fg)
  d = fg - V((0, 0.31, -0.052))
  thumb = [(-0.012, 0.28, 0.0), (-0.03, 0.305, 0.016), (-0.034, 0.34, 0.024), (-0.03, 0.375, 0.028)]
  thumb = [(t[0], t[1] + d.y, t[2] + d.z) for t in thumb]
  hand(H, -1, fg, 0.0, 0.021, 0.02, [0.036, 0.011, -0.014, -0.039], rf=0.0116, palm_h=0.115, reach=0.075, watch=True,
       index=None, thumb=thumb, arm=(0.7, -0.45, -0.75))


# ---------------------------------------------------------------------------------------------
# Cycles previews (for reviewing the models before they go in the game). preview.py supplies the materials.
# ---------------------------------------------------------------------------------------------

def render_view(parts, png, view='iso', size=(900, 600), samples=40, crop=None, x=0.15, hide=(), target=None, dist=0.9, spin=0.0):
  """Render parts. view: fp (the game's viewmodel pose), iso, left, right, front, rear, top, side, or pick (a pickup,
  seen from the front and a little above, `dist` away, turned by `spin`)."""
  import bpy
  import preview
  from mathutils import Euler
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
    ob = preview._object(p, 0)
    ob.location = p.origin
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
    mg = Matrix.LocRotScale((x, -0.24, -0.62), Euler((0.03, 0.07, 0), 'XYZ'), (0.68, 0.68, 0.68))
    mb = preview._game_to_blender(mg)
    for ob in objs:
      ob.matrix_world = mb @ Matrix.LocRotScale(ob.location, ob.rotation_euler, None)
    cam.sensor_fit = 'VERTICAL'
    cam.angle_y = math.radians(70)
    co.location = (0, 0, 0)
    co.rotation_euler = (math.pi / 2, 0, 0)
    cam.clip_start = 0.02
    sun((0.5, -0.6, 1.0), 3.0)
    sun((-0.6, 0.2, 0.3), 0.8, (0.7, 0.8, 1.0))
  else:
    cam.clip_start = 0.01
    if spin:
      for ob in objs:
        ob.rotation_euler = (0, 0, spin)
    tgt = Vector(target) if target is not None else Vector((0, 0.05, -0.02))
    if view in ('side', 'top'):
      cam.type = 'ORTHO'
      cam.ortho_scale = dist
    d = {'side': (1.5, 0, 0), 'top': (0, 0, 1.5), 'rear': (0.35, -0.9, 0.18), 'iso': (0.65, -0.6, 0.38), 'front': (0.5, 0.9, 0.2),
         'left': (-0.8, 0.45, 0.25), 'right': (0.8, 0.45, 0.25), 'pick': (0.0, -1.0, 0.28)}[view]
    loc = tgt + Vector(d) * (dist if view not in ('side', 'top') else 1.0)
    co.location = loc
    co.rotation_euler = (tgt - loc).to_track_quat('-Z', 'Y').to_euler()
    cam.lens = 50
    sun((0.5, -0.6, 1.0), 3.0)
    sun((-0.6, 0.4, 0.3), 1.2, (0.7, 0.8, 1.0))
  if crop:
    sc.render.use_border = True
    sc.render.use_crop_to_border = True
    sc.render.border_min_x, sc.render.border_max_x, sc.render.border_min_y, sc.render.border_max_y = crop
  sc.render.filepath = png
  bpy.ops.render.render(write_still=True)
  print('rendered', png)


# ---------------------------------------------------------------------------------------------
# Airhorn: a red gas can for a grip with a black trumpet horn on its valve. Naebun's left hand steadies the horn.
# ---------------------------------------------------------------------------------------------

CAN_RED, CREAM, HORN_BLACK, HORN = 0xb3261e, 0xe9dfc8, 0x18181c, 0x353c4b


def airhorn():
  P, H = Part('body'), Part('hands', smooth=80)
  T, L = Part('torch'), Part('lens', 'glow', glow=[0xfff0d8, 3.0])
  zc = 0.05
  c = (0, -0.03, -0.085)
  tilt = -0.2
  # the can (the grip): a lathe along z, raked back like a pistol grip; a cream label band and a rolled foot
  P.add(zrev([(0, -0.092), (0.03, -0.092, 0.004), (0.0345, -0.084, 0.004), (0.0345, 0.074), (0.03, 0.086, 0.006), (0.016, 0.092), (0.0, 0.092)], 22),
        CAN_RED, 'gloss', at=c, rot=(tilt, 0, 0), wear=0.9)
  P.add(zrev([(0.0343, -0.05), (0.0358, -0.05), (0.0358, 0.03), (0.0343, 0.03)], 22), CREAM, 'paper', wear=0, at=c, rot=(tilt, 0, 0))
  for z in (-0.056, 0.036):  # black rings above and below the label
    P.add(zrev([(0.0343, z - 0.004), (0.036, z - 0.004), (0.036, z + 0.004), (0.0343, z + 0.004)], 22), HORN_BLACK, 'gloss', wear=0, at=c, rot=(tilt, 0, 0))
  P.add(zrev([(0.0, -0.095), (0.026, -0.095, 0.003), (0.03, -0.088), (0.0, -0.088)], 18), CHROME, 'chrome', wear=0, at=c, rot=(tilt, 0, 0))
  # the valve block on top of the can, and the throat of the horn
  top = V(c) + rake(tilt) @ V((0, 0, 0.092))
  P.add(box(0.05, 0.05, 0.02, 0.005, 1), CHROME, 'chrome', at=(0, top.y + 0.004, top.z + 0.006))
  P.add(box(0.03, 0.018, 0.026, 0.004, 1), STEEL, 'metal', at=(0, top.y - 0.01, top.z + 0.026))
  # horn: a flared trumpet with a rolled lip and a brass throat. Closed profile (outer wall, lip, inner wall).
  outer = [(0.0, -0.062), (0.013, -0.062), (0.0155, -0.045, 0.004), (0.02, 0.06), (0.034, 0.17), (0.058, 0.27), (0.083, 0.345, 0.006), (0.087, 0.352)]
  inner = [(0.0842, 0.352), (0.08, 0.345), (0.055, 0.268), (0.031, 0.17), (0.0175, 0.06), (0.0118, -0.04), (0.0, -0.045)]
  P.add(rev(outer + inner, 24), HORN, 'gloss', at=(0, 0, zc), rot=AY, wear=0.8)
  P.add(rev([(0.0608, 0.28), (0.0643, 0.28), (0.071, 0.304), (0.0675, 0.304)], 24), CAN_RED, 'gloss', wear=0, at=(0, 0, zc), rot=AY)  # a red band, like the can
  P.add(rev([(0.0885, 0.34), (0.0925, 0.34), (0.0925, 0.356, 0.003), (0.0845, 0.356)], 24), CHROME, 'chrome', wear=0, at=(0, 0, zc), rot=AY)
  P.add(rev([(0.0155, -0.036), (0.0215, -0.036), (0.0215, -0.012), (0.0155, -0.012)], 18), BRASS, 'brass', wear=0, at=(0, 0, zc), rot=AY)
  for y, r in ((0.12, 0.0275), (0.215, 0.047)):  # chrome hoops round the bell
    P.add(rev([(r * 0.97, y - 0.004), (r * 1.1, y - 0.004), (r * 1.1, y + 0.004), (r * 0.97, y + 0.004)], 24), CHROME, 'chrome', wear=0, at=(0, 0, zc), rot=AY)
  P.add(rev([(0.0885, 0.352 - 0.02), (0.0885, 0.352 - 0.014)], 4), CHROME, 'chrome', wear=0, at=(0, 0, zc), rot=AY) if False else None
  # trigger and guard on the front of the valve block
  guard(P, (0, 0.016, -0.035), 0.03, 0.026)
  P.add(loft([((0, 0.026, -0.015), 0.01, 0.007, 0.002), ((0, 0.019, -0.033), 0.01, 0.007, 0.002)], n=1, up=(1, 0, 0), bevel=0.002, bsteps=1), STEEL, 'metal', wear=0)
  P.add(box(0.01, 0.012, 0.018, 0.002, 1, sub=0.0), STEEL, 'metal', wear=0, at=(0, 0.012, -0.004))
  lamp_bezel(P, (0, -0.052, top.z + 0.04))
  # foregrip, clamped to the horn
  fg = (0, 0.18, -0.052)
  handle(P, fg, 0.11, 0.04, 0.042, 0.0, wood=False, tape=3, grooves=0)
  P.add(rev([(0.0345, 0.18 - 0.012), (0.0375, 0.18 - 0.012), (0.0375, 0.18 + 0.012), (0.0345, 0.18 + 0.012)], 22), RUBBER, 'rubber', wear=0, at=(0, 0, zc), rot=AY)
  P.add(box(0.034, 0.03, 0.018, 0.004, 1, sub=0.0), STEEL, 'metal', at=(0, 0.18, -0.002))
  # the torch: a slim red-banded lamp strapped to the left of the horn throat
  lens = torch_unit(T, L, (-0.056, 0.03, zc - 0.004), r=0.0155, length=0.078, body=0x1c1c20, band=CHROME, fins=0, bandc=CAN_RED)
  P.add(rev([(0.0325, 0.052), (0.036, 0.052), (0.036, 0.064), (0.0325, 0.064)], 18), RUBBER, 'rubber', wear=0, at=(0, 0, zc), rot=AY)
  clamp_bracket(P, (-0.036, 0.058, zc - 0.004), (-0.05, 0.058, zc - 0.004), w=0.02)
  hand(H, 1, c, tilt, 0.039, 0.031, [0.005, -0.021, -0.046],
       index=[(0.046, -0.045, -0.016), (0.04, -0.008, -0.017), (0.03, 0.008, -0.023), (0.007, 0.011, -0.027)],
       thumb=[(-0.02, -0.06, 0.0), (-0.04, -0.02, 0.014), (-0.043, 0.035, 0.022), (-0.04, 0.08, 0.027)],
       arm=(0.2, -0.86, -0.46))
  left_hand(H, fg)
  return dict(body=P, torch=T, lens=L, hands=H, muzzle=(0, 0.36, zc), lamp=(0, -0.052, top.z + 0.045), lensPose=lens)


# ---------------------------------------------------------------------------------------------
# Bass-Drop Grenade: a hand-sized subwoofer cabinet with a woofer cone in the top and bottom, a magenta light band, a
# flip lever and a pin with a ring. Held in the right hand; the same body, without the hand, is what flies.
# ---------------------------------------------------------------------------------------------

def woofer(P, c, face, r=0.034, cone=CONE):
  """A speaker set into a face: chrome surround, paper cone dished in, dust cap. `face` is the direction it looks: 'up',
  'back' (-y, towards the player) or 'front' (+y)."""
  rot = {'up': (0, 0, 0), 'back': (PI / 2, 0, 0), 'front': (-PI / 2, 0, 0)}[face]
  P.add(zrev([(r * 0.9, 0.0), (r * 1.17, 0.0, 0.0015), (r * 1.17, 0.003), (r * 0.9, 0.004)], 22), CHROME, 'chrome', wear=0, at=c, rot=rot)
  P.add(zrev([(r * 0.96, 0.0015), (r * 0.9, -0.0005), (r * 0.5, -0.011, 0.003), (r * 0.46, -0.011), (r * 0.46, -0.009), (r * 0.5, -0.0095),
              (r * 0.9, 0.0015)], 22), cone, 'paper', wear=0, at=c, rot=rot)
  P.add(zrev([(0, -0.011), (r * 0.3, -0.0105, 0.002), (r * 0.26, -0.0035), (0, -0.002)], 12), BLACK, 'plastic', wear=0, at=c, rot=rot)


def grenade():
  P, B, H = Part('body'), Part('band', 'glow', glow=[0xff3aa8, 6.0]), Part('hands', smooth=80)
  hc = V((0, 0.02, 0.092))  # the head: a bass drum with a woofer in each face, on a short handle, like a stick grenade
  R, hl = 0.058, 0.05
  P.add(rev([(0, -hl), (R - 0.008, -hl, 0.005), (R, -hl + 0.006), (R, hl - 0.006), (R - 0.008, hl, 0.005), (0, hl)], 28), 0x3a3c48, 'gloss', at=hc, rot=AY, wear=0)
  for s in (-1, 1):  # chrome rim hoops
    P.add(rev([(R - 0.006, s * (hl - 0.012) - 0.0045), (R + 0.003, s * (hl - 0.012) - 0.0045), (R + 0.003, s * (hl - 0.012) + 0.0045), (R - 0.006, s * (hl - 0.012) + 0.0045)], 28),
          CHROME, 'chrome', wear=0, at=hc, rot=AY)
  for k in range(8):  # tension lugs
    a = 2 * PI * k / 8 + PI / 8
    for s in (-1, 1):
      P.add(box(0.008, 0.012, 0.01, 0.002, 1, sub=0.0), CHROME, 'chrome', wear=0, at=hc + V((0, s * (hl - 0.012), 0)) + V((sin(a) * (R + 0.003), 0, cos(a) * (R + 0.003))), rot=(0, a, 0)) if False else None
  woofer(P, hc + V((0, -hl, 0)), 'back', 0.04, 0x8a7358)
  woofer(P, hc + V((0, hl, 0)), 'front', 0.04, 0x8a7358)
  # the light band round the drum
  B.add(rev([(R - 0.001, -0.0045), (R + 0.0025, -0.0045), (R + 0.0025, 0.0045), (R - 0.001, 0.0045)], 28), 0xffffff, 'plastic', wear=0, at=hc, rot=AY)
  # neck on the handle, then the pin and its ring on top of the drum
  P.add(box(0.05, 0.06, 0.03, 0.006, 1), STEEL, 'metal', at=(0, 0.002, 0.026))
  fz = hc + V((0.0, 0.0, R))
  P.add(zrev([(0.0, -0.004), (0.012, -0.004), (0.012, 0.013, 0.002), (0.0, 0.013)], 12), CHROME, 'chrome', wear=0, at=fz)
  P.add(tube([fz + V((0, 0.012, 0.008)), fz + V((0, -0.03, 0.008))], 0.0021, seg=5, per=1), CHROME, 'chrome', wear=0)
  ring = ring_path(fz + V((0.0, -0.04, 0.004)), 0.014, 0.014, 'xz', 10)
  P.add(loft(sweep(ring, [(0.005, 0.005)] * len(ring), 1, True), seg=5, up=(0, 1, 0), closed=True), BRASS, 'brass', wear=0)
  # trigger lever and guard, then the grip
  guard(P, (0, 0.012, -0.036), 0.03, 0.026)
  P.add(loft([((0, 0.026, -0.015), 0.01, 0.007, 0.002), ((0, 0.019, -0.033), 0.01, 0.007, 0.002)], n=1, up=(1, 0, 0), bevel=0.002, bsteps=1), STEEL, 'metal', wear=0)
  handle(P, (0, -0.03, -0.085), 0.17, 0.062, 0.078, -0.2, panel=CARPET_D)
  hand(H, 1, (0, -0.03, -0.085), -0.2, 0.039, 0.031, [0.005, -0.021, -0.046],
       index=[(0.046, -0.045, -0.016), (0.04, -0.008, -0.017), (0.03, 0.008, -0.023), (0.007, 0.011, -0.027)],
       thumb=[(-0.02, -0.06, 0.0), (-0.04, -0.02, 0.014), (-0.043, 0.035, 0.022), (-0.04, 0.08, 0.027)],
       arm=(0.2, -0.86, -0.46))
  return dict(body=P, band=B, hands=H, muzzle=(0, 0.1, 0.092), lamp=(0.0, -0.075, 0.14))


# ---------------------------------------------------------------------------------------------
# Upgrade pickups: modelled upright around their centre, front at -y, about 0.3 m across (the game scales them up)
# ---------------------------------------------------------------------------------------------

AMBER_GLOW, CYAN_GLOW, VIOLET = (0xffb030, 6.0), (0x40e8ff, 6.0), 0x6b46c4


def clip_pickup():
  """Extended clips: two curved magazines taped head to tail, brass rounds in the top, a glowing plus on the front."""
  P, G = Part('body'), Part('glow', 'glow', glow=list(AMBER_GLOW))
  for k, sx in enumerate((-1, 1)):
    sg = 1 if k == 0 else -1  # the second magazine is upside down
    st = [(V((sx * 0.034, 0.03 * u ** 1.6 - 0.012, sg * (0.15 - 0.3 * u))), 0.052, 0.088, 0.008) for u in (0, 0.25, 0.5, 0.75, 1)]
    P.add(loft(st, n=1, up=(0, 1, 0), bevel=0.003, bsteps=1, sub=0.006), 0x23262b, 'gloss', wear=0.9)
    for u in (0.2, 0.45, 0.7, 0.9):  # ribs
      z = sg * (0.15 - 0.3 * u)
      y = 0.03 * u ** 1.6 - 0.012
      P.add(box(0.056, 0.092, 0.006, 0.002, 1, sub=0.0), 0x34373c, 'metal', at=(sx * 0.034, y, z))
    # a base plate at the bottom of the magazine, in amber
    zb = sg * (0.15 - 0.3 - 0.0)
    P.add(box(0.058, 0.096, 0.016, 0.004, 1), 0xffb030, 'gloss', at=(sx * 0.034, 0.03 - 0.012, zb), wear=0.6)
    # brass rounds poking out of the top
    zt = sg * 0.15
    for j in (-1, 1):
      P.add(rev([(0.0, 0.0), (0.0085, 0.0, 0.0015), (0.0085, 0.022), (0.006, 0.034, 0.004), (0.0, 0.042)], 10), BRASS, 'brass', wear=0,
             at=(sx * 0.034 + j * 0.012, -0.012, zt - sg * 0.004), rot=(0, 0, 0) if sg > 0 else (PI, 0, 0))
  # tape round both
  for z in (-0.045, 0.045):
    P.add(box(0.146, 0.1, 0.022, 0.004, 1, sub=0.0), TAPE, 'tape', wear=0, at=(0, 0.005, z))
  # the plus: a glowing sign on the front of the tape
  G.add(box(0.07, 0.006, 0.016, 0.001, 0), 0xffffff, 'plastic', wear=0, at=(0, -0.058, 0.0))
  G.add(box(0.016, 0.006, 0.07, 0.001, 0), 0xffffff, 'plastic', wear=0, at=(0, -0.058, 0.0))
  P.add(box(0.1, 0.01, 0.1, 0.004, 1, sub=0.0), 0x14161a, 'plastic', wear=0, at=(0, -0.052, 0.0))
  # and the same sign on the back, so it shows as the pickup turns
  G.add(box(0.07, 0.006, 0.016, 0.001, 0), 0xffffff, 'plastic', wear=0, at=(0, 0.0645, 0.0))
  G.add(box(0.016, 0.006, 0.07, 0.001, 0), 0xffffff, 'plastic', wear=0, at=(0, 0.0645, 0.0))
  P.add(box(0.1, 0.01, 0.1, 0.004, 1, sub=0.0), 0x14161a, 'plastic', wear=0, at=(0, 0.0585, 0.0))
  return dict(body=P, glow=G)


def reload_pickup():
  """A speed loader: a steel disc holding a ring of brass rounds, seen head on, in a cyan arrow that spins."""
  P, G = Part('body'), Part('glow', 'glow', glow=list(CYAN_GLOW))
  R = 0.09
  # the disc, axis along y with its face to -y
  P.add(rev([(0, -0.03), (R - 0.01, -0.03, 0.006), (R, -0.02), (R, 0.02), (R - 0.006, 0.03, 0.004), (0, 0.03)], 28), STEEL, 'metal', rot=AY * 1 if False else (PI / 2, 0, 0))
  P.add(rev([(0, -0.03), (0.034, -0.03, 0.004), (0.034, -0.045, 0.004), (0.026, -0.052, 0.004), (0, -0.052)], 18), CHROME, 'chrome', wear=0, rot=(PI / 2, 0, 0)) if False else None
  # twist knob in the middle of the face
  P.add(rev([(0, 0.0), (0.034, 0.0, 0.003), (0.034, 0.02, 0.004), (0.026, 0.03, 0.005), (0, 0.03)], 20), CHROME, 'chrome', wear=0, at=(0, -0.03, 0), rot=(PI / 2, 0, 0))
  for k in range(6):  # rounds in a ring, bases towards the viewer
    a = 2 * PI * k / 6 + PI / 6
    x, z = 0.058 * cos(a), 0.058 * sin(a)
    P.add(rev([(0, 0.0), (0.0105, 0.0, 0.0015), (0.0105, 0.026), (0.0085, 0.032, 0.003), (0, 0.032)], 12), BRASS, 'brass', wear=0, at=(x, -0.03, z), rot=(PI / 2, 0, 0))
    P.add(rev([(0, -0.002), (0.004, -0.002), (0.004, 0.001), (0, 0.001)], 8), 0xc9c2a0, 'metal', wear=0, at=(x, -0.0325, z), rot=(PI / 2, 0, 0))
  # a cyan ring round the rim and three chevrons that say "faster"
  G.add(rev([(R + 0.002, -0.012), (R + 0.012, -0.012), (R + 0.012, 0.012), (R + 0.002, 0.012)], 36), 0xffffff, 'plastic', wear=0, rot=(PI / 2, 0, 0))
  for i in range(3):
    x0 = -0.045 + i * 0.05
    chev = [(x0 - 0.026, 0.026), (x0 - 0.006, 0.0), (x0 - 0.026, -0.026), (x0 - 0.01, -0.026), (x0 + 0.01, 0.0), (x0 - 0.01, 0.026)]
    G.add(kit.prism(chev, 0.01), 0xffffff, 'plastic', wear=0, at=(0, -0.05, -0.128))
  return dict(body=P, glow=G)


def altfire_pickup():
  """A stompbox for the SMG: a violet die-cast box with three knobs, a jewel LED, a chrome footswitch and a glowing bolt."""
  P, G = Part('body'), Part('glow', 'glow', glow=[0x40e8ff, 6.0])
  G2 = Part('led', 'glow', glow=[0xff3a5a, 7.0])
  w, h, d = 0.15, 0.21, 0.058
  P.add(loft([((0, -d / 2, 0), w, h, 0.012), ((0, d / 2, 0), w, h, 0.012)], n=2, bevel=0.006, bsteps=1, sub=0.008), VIOLET, 'gloss', wear=1.0)
  # a lid line, four screws, a cream label panel
  P.add(box(w + 0.002, d + 0.002, 0.003, 0.0008, 0), 0x2a1a5a, 'plastic', wear=0, at=(0, 0, 0.07))
  for sx in (-1, 1):
    for sz in (-1, 1):
      P.add(rev([(0, 0), (0.008, 0, 0.001), (0.008, 0.003), (0, 0.003)], 8), CHROME, 'chrome', wear=0, at=(sx * 0.063, -d / 2 - 0.0005, sz * 0.092), rot=(PI / 2, 0, 0))
  # three knobs
  for i in range(3):
    x = -0.045 + i * 0.045
    P.add(rev([(0, 0), (0.015, 0, 0.002), (0.0145, 0.016), (0.0125, 0.02, 0.002), (0, 0.02)], 16), 0x141418, 'rubber', wear=0, at=(x, -d / 2, 0.062), rot=(PI / 2, 0, 0))
    P.add(box(0.003, 0.003, 0.014, 0.0005, 0), CHROME, 'chrome', wear=0, at=(x, -d / 2 - 0.0205, 0.0685))
  # a jewel LED and the footswitch
  P.add(rev([(0.0, 0), (0.0095, 0, 0.001), (0.0095, 0.004), (0, 0.004)], 12), CHROME, 'chrome', wear=0, at=(0, -d / 2, 0.036), rot=(PI / 2, 0, 0))
  G2.add(kit.sphere(0.0065, 8, 5), 0xffffff, 'plastic', wear=0, at=(0, -d / 2 - 0.004, 0.036))
  P.add(rev([(0, 0), (0.024, 0, 0.003), (0.024, 0.02, 0.004), (0.019, 0.026, 0.004), (0, 0.026)], 20), CHROME, 'chrome', wear=0, at=(0, -d / 2, -0.078), rot=(PI / 2, 0, 0))
  # the label panel with a lightning bolt
  P.add(box(0.12, 0.004, 0.062, 0.001, 1, sub=0.0), 0x14141a, 'plastic', wear=0, at=(0, -d / 2 - 0.0005, -0.01))
  bolt = [(0.012, 0.027), (-0.026, -0.004), (-0.004, -0.004), (-0.014, -0.027), (0.026, 0.006), (0.004, 0.006)]
  G.add(kit.prism(bolt, 0.004), 0xffffff, 'plastic', wear=0, at=(0, -d / 2 - 0.0025, -0.01))
  # the back: a plate with the same bolt, so it shows as the pickup turns
  P.add(box(0.12, 0.004, 0.1, 0.001, 1, sub=0.0), 0x14141a, 'plastic', wear=0, at=(0, d / 2 + 0.0005, 0.0))
  G.add(kit.prism([(-x, z) for x, z in bolt], 0.004), 0xffffff, 'plastic', wear=0, at=(0, d / 2 + 0.0045, 0.0))
  # jack sockets on the sides
  for s in (-1, 1):
    P.add(rev([(0, 0), (0.011, 0, 0.001), (0.011, 0.014), (0, 0.014)], 10), CHROME, 'chrome', wear=0, at=(s * w / 2, 0.0, 0.05), rot=(0, s * PI / 2, 0))
  return dict(body=P, glow=G, led=G2)


# ---------------------------------------------------------------------------------------------
# Collectible records: a 12 inch record pulled half out of its sleeve, in four label variants
# ---------------------------------------------------------------------------------------------

RECORD_VARIANTS = [
  # sleeve colour, art colour, label colour, label ring, accent (the plinth ring), art style
  dict(sleeve=0x1f2a5a, art=0xff5a8a, label=0xe8d34a, ring=0x14110a, accent=0xff5a8a, style='sun'),
  dict(sleeve=0xe9dfc8, art=0x141418, label=0xe0357c, ring=0xf6e8d0, accent=0xe0357c, style='stripes'),
  dict(sleeve=0x141418, art=0x22b8d4, label=0x22b8d4, ring=0x08161a, accent=0x22d3ee, style='rings'),
  dict(sleeve=0xd9742b, art=0x3a1a08, label=0x7ac943, ring=0x10200a, accent=0x7ac943, style='check'),
]


def record(v):
  P = Part('body')
  S = 0.31
  P.add(loft([((0, -0.002, 0), S, S, 0.003), ((0, 0.002, 0), S, S, 0.003)], n=1, up=(0, 0, 1), bevel=0.001, bsteps=1, sub=0.02), v['sleeve'], 'paper', wear=0)
  st = v['style']
  for sg in (-1, 1):  # the same art on the front (-y) and the back (+y), so the pickup looks right as it turns
    f = 0.0022 * sg
    o = 0.0003 * sg
    if st == 'sun':
      P.add(rev([(0.0, 0.0), (0.085, 0.0), (0.085, 0.0012), (0.0, 0.0012)], 28), v['art'], 'paper', wear=0, at=(0, f, 0.02), rot=(PI / 2, 0, 0))
      P.add(box(S, 0.0012, 0.05, 0.0, 0), 0x0c1230, 'paper', wear=0, at=(0, f + o, -0.115))
    elif st == 'stripes':
      for i in range(5):
        P.add(box(0.012, 0.0012, S - 0.04, 0.0, 0), v['art'], 'paper', wear=0, at=(-0.1 + i * 0.05, f + o, 0.0))
    elif st == 'rings':
      for i, r in enumerate((0.11, 0.08, 0.05)):
        P.add(rev([(r - 0.007, 0.0), (r, 0.0), (r, 0.0012), (r - 0.007, 0.0012)], 28), v['art'], 'paper', wear=0, at=(0, f, 0.0), rot=(PI / 2, 0, 0))
    else:
      for i in range(4):
        for j in range(4):
          if (i + j) % 2 == 0:
            P.add(box(0.05, 0.0012, 0.05, 0.0, 0), v['art'], 'paper', wear=0, at=(-0.075 + i * 0.05, f + o, -0.075 + j * 0.05))
  f = -0.0022
  # the disc, pulled out to the lower right so its label shows: grooves in three shades, then the label
  dc = V((0.1, f - 0.006, -0.06))
  R = 0.15
  for r0, r1, col in ((0.056, 0.085, 0x0c0c10), (0.085, 0.118, 0x15151a), (0.118, 0.143, 0x0e0e12), (0.143, R, 0x1c1c22)):
    P.add(rev([(r0, -0.0015), (r1, -0.0015), (r1, 0.0015), (r0, 0.0015)], 30), col, 'gloss', wear=0, at=dc, rot=(PI / 2, 0, 0))
  P.add(rev([(0, -0.0017), (0.056, -0.0017), (0.056, 0.0015), (0, 0.0015)], 28), v['label'], 'paper', wear=0, at=dc, rot=(PI / 2, 0, 0))
  P.add(rev([(0.03, -0.0021), (0.036, -0.0021), (0.036, 0.0), (0.03, 0.0)], 24), v['ring'], 'paper', wear=0, at=dc + V((0, -0.0001, 0)), rot=(PI / 2, 0, 0))
  P.add(rev([(0, -0.0024), (0.0075, -0.0024), (0.0075, 0.0), (0, 0.0)], 12), 0x0a0a0c, 'plastic', wear=0, at=dc + V((0, -0.0002, 0)), rot=(PI / 2, 0, 0))
  return dict(body=P)


PICKUPS = {'clip': clip_pickup, 'reload': reload_pickup, 'altfire': altfire_pickup}
for _i, _v in enumerate(RECORD_VARIANTS):
  PICKUPS[f'record{_i}'] = (lambda v=_v: record(v))


WEAPONS = {'beam': beam, 'grenade': grenade, 'airhorn': airhorn}
PART_ORDER = ('body', 'emitter', 'led0', 'led1', 'led2', 'led3', 'led4', 'band', 'torch', 'lens', 'hands')


def build_weapons(ids):
  out, built, meta = {}, {}, {}
  for wid in ids:
    t0 = time.time()
    w = WEAPONS[wid]()
    extra = w.pop('extra', [])
    parts = [w[k] for k in PART_ORDER if k in w] + [p for p in extra if p.name not in w]
    parts.sort(key=lambda p: PART_ORDER.index(p.name))
    for p in parts:
      kit.bake_part(p, None)
    bvh = kit.occluder_bvh(parts)
    out[wid] = {p.name: kit.encode_part(p, bvh) for p in parts}
    built[wid] = parts
    g = lambda v: [round(c, 5) for c in (v[0], v[2], -v[1])]  # noqa: E731  to the game's frame
    m = {k: g(w[k]) for k in ('muzzle', 'lamp') if k in w}
    if 'lensPose' in w:
      m['lens'] = {'pos': g(w['lensPose']['pos']), 'dir': g(w['lensPose']['dir'])}
    meta[wid] = m
    print(f'{wid:9s} ' + '  '.join(f"{p.name} {out[wid][p.name]['tris']}" for p in parts) + f"   total {sum(v['tris'] for v in out[wid].values())} tris  ({time.time() - t0:.1f}s)")
  return out, built, meta


def build_pickups(ids):
  out, built = {}, {}
  for pid in ids:
    t0 = time.time()
    w = PICKUPS[pid]()
    parts = [w[k] for k in w if isinstance(w[k], Part)]
    for p in parts:
      kit.bake_part(p, None)
    bvh = kit.occluder_bvh(parts)
    out[pid] = {p.name: kit.encode_part(p, bvh) for p in parts}
    built[pid] = parts
    print(f'{pid:9s} ' + '  '.join(f"{p.name} {out[pid][p.name]['tris']}" for p in parts) + f"   total {sum(v['tris'] for v in out[pid].values())} tris  ({time.time() - t0:.1f}s)")
  return out, built


HEADER = """// Generated by scripts/blender/arsenal.py from the Blender models of the prepared arsenal: three held weapons with Naebun's
// hands, three upgrade pickups and the collectible record in four label variants. Do not edit by hand: change the script and
// run it again (see README.md, "Blender").
// `weapons`: per weapon `muzzle`, `lamp` and `lens` ({ pos, dir }, the torch lens) in the weapon's frame (-z forward, y up) and
// `parts` (body, emitter, led0 to led4, band, torch, lens, hands). `pickups`: `parts` around the item's own centre.
// Per part: `pos` is the pivot, `p` quantised positions (int16 x `sc`), `nrm` normals (int8), `idx` triangle indices (uint16),
// `col` sRGB bytes (ambient occlusion and wear included) and `sf` (roughness, metalness bytes) for painted parts, `glow` is
// [colour, gain] for lit parts.
export const ARSENAL_MESHES = """


def main():
  ap = argparse.ArgumentParser()
  here = os.path.dirname(os.path.abspath(__file__))
  ap.add_argument('--out', default=os.path.join(here, '..', '..', 'src', 'arsenal-meshes.js'))
  ap.add_argument('--only')
  ap.add_argument('--preview')
  ap.add_argument('--view', default='fp')
  ap.add_argument('--png')
  ap.add_argument('--hide', default='')
  ap.add_argument('--landscape', action='store_true')
  ap.add_argument('--crop')
  ap.add_argument('--zoom', type=float, default=2.0)
  ap.add_argument('--dist', type=float, default=0.9)
  ap.add_argument('--spin', type=float, default=0.0)
  a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
  ids = [a.preview] if a.preview else (a.only.split(',') if a.only else list(WEAPONS) + list(PICKUPS))
  wids = [i for i in ids if i in WEAPONS]
  pids = [i for i in ids if i in PICKUPS]
  data, built, meta = build_weapons(wids)
  pdata, pbuilt = build_pickups(pids)
  built.update(pbuilt)
  if not a.preview and not a.only:
    for d in list(data.values()) + list(pdata.values()):
      for m in d.values():
        m.pop('tris')
    doc = {'weapons': {wid: dict(meta[wid], parts=data[wid]) for wid in data}, 'pickups': {pid: {'parts': pdata[pid]} for pid in pdata}}
    with open(a.out, 'w') as f:
      f.write(HEADER + json.dumps(doc, separators=(',', ':')).replace('},"', '},\n"') + ';\n')
    print('wrote', os.path.relpath(a.out), f'({os.path.getsize(a.out) / 1024:.0f} KB)')
  if a.preview:
    size = (844, 390) if a.landscape else (390, 844)
    size = (int(size[0] * a.zoom), int(size[1] * a.zoom))
    if a.view != 'fp':
      size = (900, 600)
    crop = tuple(float(v) for v in a.crop.split(',')) if a.crop else None
    render_view(built[a.preview], a.png or f'/tmp/{a.preview}-{a.view}.png', a.view, size=size, hide=a.hide.split(','), crop=crop,
                x=0.375 if a.landscape else 0.15, dist=a.dist, target=(0, 0, 0) if a.preview in PICKUPS else None,
                spin=a.spin)


if __name__ == '__main__':
  main()
