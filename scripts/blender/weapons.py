"""Builds the five weapon viewmodels, and Naebun's hands and forearms gripping them, in Blender and writes them to
src/weapon-meshes.js for the game.
Run with: ~/.venvs/blender/bin/python scripts/blender/weapons.py [--out src/weapon-meshes.js] [--only pistol,smg]
                                                                 [--sheet sheet.png]
                                                                 [--preview NAME --view fp|side|top|rear|iso --png out.png]

Frame: x right, y forward (the muzzle end), z up, metres, origin at the grip: the same as the old procedural weapons
(models.js turns it into three.js axes on export, three = (x, z, -y)). Part names are what models.js and the game drive:
`body`, `pump` (shotgun fore-end, slides along z in the game's frame), `cradle` (vinyl platter, tilted by models.js,
the record on it is still code so it can spin), and `hands`, which models.js leaves out of pickups. The muzzle, lamp
and cradle pivot go into the data file beside the meshes. The names on the guns are invented.
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


# ---------------------------------------------------------------------------------------------
# Speaker parts shared by the weapons: a paper cone with a chrome surround, seen from the side or from the muzzle
# ---------------------------------------------------------------------------------------------

def speaker_muzzle(P, y0, y1, r0, r1, c=(0, 0, 0), ring=0.006, cap=0.6):
  """A flared speaker cone as a muzzle: narrow end at y0, wide mouth at y1. A chrome surround rolls round the mouth,
  a dark dust cap sits deep in the cone."""
  P.add(rev([(r0, y0), (r1 - 0.002, y1 - 0.004, 0), (r1 - ring * 0.2, y1 - 0.002), (r1 * cap + 0.004, y0 + (y1 - y0) * 0.35, 0),
             (r1 * cap, y0 + (y1 - y0) * 0.32), (0, y0 + (y1 - y0) * 0.30)], 24), CONE, 'paper', wear=0, at=c, rot=AY)
  P.add(rev([(r1 - ring * 1.4, y1 - ring * 0.8), (r1 + ring * 0.6, y1 - ring * 0.4), (r1 + ring * 0.6, y1 + ring * 0.4),
             (r1 - ring * 1.4, y1 + ring * 0.6)], 24), CHROME, 'chrome', wear=0, at=c, rot=AY)
  # the dust cap: a dark dome
  yc = y0 + (y1 - y0) * 0.30
  P.add(rev([(0, yc), (r1 * cap, yc + 0.001), (r1 * cap * 0.95, yc + (y1 - y0) * 0.1, 0.004), (0, yc + (y1 - y0) * 0.14)], 16),
        BLACK, 'plastic', wear=0, at=c, rot=AY)


def speaker_side(P, c, r, side=1, depth=0.006):
  """A small speaker on the flank of a gun, facing sideways: surround, paper cone, dust cap and four grille bars."""
  at = V(c)
  rot = (0, side * PI / 2, 0)
  P.add(rev([(r * 0.99, 0), (r, 0.0005), (r, depth * 0.5), (r * 0.78, depth * 0.55)], 16), CHROME, 'chrome', wear=0, at=at, rot=rot)
  P.add(rev([(r * 0.8, depth * 0.5), (r * 0.58, depth * 0.2, 0), (r * 0.5, depth * 0.2), (r * 0.26, depth * 0.35, 0), (0, depth * 0.35)], 16),
        CONE, 'paper', wear=0, at=at, rot=rot)
  P.add(rev([(0, depth * 0.3), (r * 0.26, depth * 0.34, 0.002), (r * 0.2, depth * 0.7, 0.002), (0, depth * 0.8)], 10),
        BLACK, 'plastic', wear=0, at=at, rot=rot)
  for k in (-1, 1):  # a pair of chrome grille bars across the face
    P.add(box(0.003, 0.003, r * 1.7, 0.0008, 1), CHROME, 'chrome', wear=0, at=at + V((side * depth * 0.75, k * r * 0.4, 0)))


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
# Bass Pistol: the accurate sidearm. A slim slide with a speaker-cone muzzle.
# ---------------------------------------------------------------------------------------------

def pistol():
  P, H = Part('body'), Part('hands', smooth=80)
  zc = 0.045
  # slide: tapered at the front, a flat rib on top, serrations at the back
  P.add(loft([((0, -0.045, zc), 0.058, 0.07, 0.012), ((0, 0.0, zc), 0.058, 0.074, 0.012), ((0, 0.30, zc), 0.058, 0.074, 0.012),
              ((0, 0.355, zc - 0.004), 0.05, 0.062, 0.012)], n=2, bevel=0.004, bsteps=1, sub=0.007), GUNMETAL, 'gloss', wear=0.8)
  P.add(box(0.024, 0.27, 0.007, 0.0025, 1), STEEL, 'metal', at=(0, 0.12, 0.0845))
  for i in range(5):
    for s in (-1, 1):
      P.add(box(0.004, 0.0035, 0.056, 0.001, 0), BLACK, 'plastic', wear=0, at=(s * 0.0295, -0.025 + i * 0.0085, zc))
  for s in (-1, 1):  # ejection port and a speaker-grille slot, each side
    P.add(box(0.003, 0.055, 0.02, 0.001, 0), BLACK, 'plastic', wear=0, at=(s * 0.0295, 0.075, zc + 0.012))
  P.add(box(0.003, 0.05, 0.007, 0.001, 0), BRASS, 'brass', wear=0, at=(0.0295, 0.105, zc - 0.014))
  for s in (-1, 1):  # cyan enamel pinstripe, the HUD colour
    P.add(box(0.003, 0.05, 0.0025, 0.0005, 0), 0x1f9fb0, 'gloss', wear=0, at=(s * 0.0295, 0.21, zc + 0.022))
  # frame and dust cover
  P.add(loft([((0, -0.02, 0.002), 0.052, 0.042, 0.01), ((0, 0.19, 0.002), 0.052, 0.04, 0.01)], n=2, bevel=0.004, bsteps=1, sub=0.007), DARK, 'gloss')
  P.add(box(0.044, 0.05, 0.014, 0.003, 1), STEEL, 'metal', at=(0, 0.16, -0.022))
  # sights
  P.add(box(0.02, 0.012, 0.016, 0.003, 1), STEEL, 'metal', at=(0, -0.03, 0.093))
  P.add(box(0.01, 0.01, 0.012, 0.002, 1), STEEL, 'metal', at=(0, 0.31, 0.0905))
  # muzzle: a bushing and the speaker cone
  P.add(rev([(0.0165, 0.33), (0.0165, 0.375)], 12), STEEL, 'metal', at=(0, 0, zc), rot=AY)
  speaker_muzzle(P, 0.345, 0.4, 0.02, 0.049, c=(0, 0, zc))
  # trigger and guard
  guard(P, (0, 0.012, -0.036), 0.03, 0.026)
  P.add(loft([((0, 0.026, -0.015), 0.01, 0.007, 0.002), ((0, 0.019, -0.033), 0.01, 0.007, 0.002)], n=1, up=(1, 0, 0), bevel=0.002, bsteps=1), STEEL, 'metal', wear=0)
  lamp_bezel(P, (0, -0.005, 0.0825))
  handle(P, (0, -0.03, -0.085), 0.17, 0.062, 0.078, -0.2)
  # right hand: three fingers round the grip, index on the trigger, thumb along the left of the frame
  hand(H, 1, (0, -0.03, -0.085), -0.2, 0.039, 0.031, [0.005, -0.021, -0.046],
       index=[(0.046, -0.045, -0.016), (0.04, -0.008, -0.017), (0.03, 0.008, -0.023), (0.007, 0.011, -0.027)],
       thumb=[(-0.02, -0.06, 0.0), (-0.04, -0.02, 0.014), (-0.043, 0.035, 0.022), (-0.04, 0.08, 0.027)],
       arm=(0.2, -0.86, -0.46))
  return dict(body=P, hands=H, muzzle=(0, 0.4, zc), lamp=(0, -0.005, 0.088))


# ---------------------------------------------------------------------------------------------
# Subwoofer Shotgun: a pump gun whose muzzle is a speaker cone
# ---------------------------------------------------------------------------------------------

def shotgun():
  P, S, H, HP = Part('body'), Part('pump'), Part('hands', smooth=80), Part('handsPump', smooth=80)
  # receiver
  P.add(loft([((0, -0.11, 0.03), 0.078, 0.1, 0.014), ((0, 0.11, 0.03), 0.078, 0.1, 0.014)], n=2, bevel=0.006, bsteps=1, sub=0.008),
        GUNMETAL, 'gloss', wear=0.9)
  P.add(box(0.003, 0.07, 0.03, 0.001, 0), BLACK, 'plastic', wear=0, at=(0.0395, 0.02, 0.045))      # ejection port
  P.add(box(0.003, 0.034, 0.012, 0.001, 0), BRASS, 'brass', wear=0, at=(0.0395, -0.045, 0.03))
  P.add(box(0.05, 0.06, 0.004, 0.001, 0), BRASS, 'brass', wear=0, at=(0, 0.03, -0.0205))           # loading gate
  P.add(box(0.003, 0.05, 0.003, 0.0005, 0), 0xc07a1c, 'gloss', wear=0, at=(0.0395, 0.0, 0.07))     # amber pinstripe
  P.add(box(0.003, 0.05, 0.003, 0.0005, 0), 0xc07a1c, 'gloss', wear=0, at=(-0.0395, 0.0, 0.07))
  # barrel, magazine tube, rib and bead
  P.add(rev([(0.033, 0.04), (0.036, 0.06, 0.002), (0.036, 0.5), (0.04, 0.505)], 22), STEEL, 'metal', at=(0, 0, 0.05), rot=AY)
  P.add(rev([(0.027, 0.07), (0.028, 0.08), (0.028, 0.46), (0.03, 0.47)], 18), 0x3a3d42, 'metal', at=(0, 0, 0.0), rot=AY)
  P.add(box(0.04, 0.3, 0.012, 0.003, 1, sub=0.0), STEEL, 'metal', at=(0, 0.3, 0.092))
  for i in range(5):
    P.add(box(0.03, 0.008, 0.003, 0.0005, 0), BLACK, 'plastic', wear=0, at=(0, 0.17 + i * 0.05, 0.0985))
  P.add(kit.sphere(0.0085, 8, 6), BRASS, 'brass', at=(0, 0.5, 0.099))
  for y in (0.2, 0.42):  # brass bands round the barrel, clamped to the tube
    P.add(rev([(0.0345, y - 0.008), (0.039, y - 0.008), (0.039, y + 0.008), (0.0345, y + 0.008)], 20), BRASS, 'brass', at=(0, 0, 0.05), rot=AY)
    P.add(box(0.03, 0.016, 0.07, 0.003, 1, sub=0.0), BRASS, 'brass', at=(0, y, 0.022))
  P.add(rev([(0.027, 0.455), (0.032, 0.455, 0.002), (0.032, 0.472, 0.002), (0.027, 0.472)], 16), BRASS, 'brass', at=(0, 0, 0.0), rot=AY)
  # the speaker-cone muzzle
  P.add(rev([(0.036, 0.49), (0.044, 0.49, 0.002), (0.044, 0.52, 0.002), (0.036, 0.52)], 20), 0x3a3d42, 'metal', at=(0, 0, 0.05), rot=AY)
  speaker_muzzle(P, 0.515, 0.59, 0.04, 0.1, c=(0, 0, 0.05), ring=0.009)
  # stock, wrist, guard and trigger
  P.add(loft([((0, -0.07, 0.022), 0.056, 0.082, 0.014), ((0, -0.16, 0.0), 0.058, 0.092, 0.016), ((0, -0.245, -0.026), 0.06, 0.122, 0.016)],
             n=2, bevel=0.008, bsteps=1, sub=0.006), WOOD, 'wood', wear=0)
  P.add(box(0.064, 0.022, 0.128, 0.006, 1, sub=0.0), RUBBER, 'rubber', wear=0, at=(0, -0.257, -0.028), rot=(0.22, 0, 0))
  P.add(box(0.062, 0.003, 0.09, 0.001, 0), WOOD_D, 'wood', wear=0, at=(0, -0.2, 0.0))
  handle(P, (0, -0.06, -0.08), 0.14, 0.056, 0.062, -0.25, wood=False, tape=3, grooves=2, cap=False, mat=(WOOD, 'wood'), bands=WOOD_D)
  guard(P, (0, -0.012, -0.04), 0.032, 0.03)
  P.add(loft([((0, 0.0, -0.022), 0.01, 0.007, 0.002), ((0, -0.008, -0.04), 0.01, 0.007, 0.002)], n=1, up=(1, 0, 0), bevel=0.002, bsteps=1), STEEL, 'metal', wear=0)
  lamp_bezel(P, (0.03, -0.07, 0.0795))
  # a bandolier of three shells on the right of the stock: red cases, brass heads
  for k in range(3):
    y = -0.1 - k * 0.04
    P.add(rev([(0.0105, -0.02), (0.0105, 0.018), (0.0095, 0.024), (0.0, 0.024)], 10), 0x9a2a1e, 'plastic', wear=0, at=(0.034, y, 0.024), rot=(0, 0, 0))
    P.add(rev([(0.0115, -0.024), (0.0115, -0.018), (0.0105, -0.018)], 10), BRASS, 'brass', wear=0, at=(0.034, y, 0.024))
  # the pump (separate mesh: it slides): a wooden fore-end gripped under the tube
  S.add(loft([((0, 0.2, -0.02), 0.088, 0.066, 0.018), ((0, 0.36, -0.02), 0.088, 0.066, 0.018)], n=2, bevel=0.008, bsteps=1, sub=0.006),
        WOOD, 'wood', wear=0)
  for i in range(4):
    S.add(box(0.09, 0.008, 0.068, 0.002, 1, sub=0.0), WOOD_D, 'wood', wear=0, at=(0, 0.23 + i * 0.035, -0.02))
  for y in (0.196, 0.364):
    S.add(box(0.09, 0.012, 0.07, 0.003, 1, sub=0.0), STEEL, 'metal', at=(0, y, -0.02))
  # right hand on the wrist: three fingers round it, index on the trigger, thumb over the top left
  hand(H, 1, (0, -0.06, -0.08), -0.25, 0.031, 0.028, [0.012, -0.014, -0.04],
       index=[(0.04, -0.07, -0.022), (0.036, -0.04, -0.026), (0.026, -0.02, -0.03), (0.005, -0.02, -0.032)],
       thumb=[(-0.02, -0.08, -0.035), (-0.045, -0.07, -0.01), (-0.05, -0.045, 0.028), (-0.046, -0.005, 0.043)],
       arm=(0.2, -0.86, -0.46))
  # left hand under the pump: palm below, fingers round the right side, thumb up the left. It rides with the pump.
  c0 = V((0, 0.28, -0.02))
  wrap_fingers(HP, c0, V((1, 0, 0)), V((0, 0, 1)), V((0, 1, 0)), 0.044, 0.033, [0.047, 0.021, -0.005, -0.03], rf=0.0125)
  HP.add(loft([((-0.075, 0.275, -0.07), 0.125, 0.034, 0.014), ((0.03, 0.272, -0.072), 0.12, 0.032, 0.014)], n=2, bevel=0.012, bsteps=2), SKIN, 'skin')
  finger_path(HP, [(-0.06, 0.23, -0.06), (-0.058, 0.225, -0.025), (-0.052, 0.245, 0.012), (-0.032, 0.3, 0.016)],
              [(0.032, 0.03), (0.029, 0.027), (0.025, 0.024), (0.021, 0.02)], (0, 0, 1), bevel=0.008)
  forearm(HP, V((-0.095, 0.235, -0.072)), (-0.75, -0.4, -0.7), watch=True)
  return dict(body=P, pump=S, hands=H, handsPump=HP, muzzle=(0, 0.6, 0.05), lamp=(0.03, -0.07, 0.084))


# ---------------------------------------------------------------------------------------------
# Tweeter SMG: compact, a dome tweeter for a muzzle and a speaker in each flank
# ---------------------------------------------------------------------------------------------

def smg():
  P, H = Part('body'), Part('hands', smooth=80)
  zc = 0.03
  P.add(loft([((0, -0.09, zc), 0.056, 0.085, 0.014), ((0, 0.25, zc), 0.056, 0.085, 0.014)], n=2, bevel=0.005, bsteps=1, sub=0.007),
        0x34373c, 'gloss', wear=0.9)
  P.add(box(0.03, 0.3, 0.02, 0.004, 1, sub=0.0), 0x202225, 'metal', at=(0, 0.08, 0.083))
  for i in range(6):  # rail slots
    P.add(box(0.032, 0.007, 0.004, 0.0005, 0), BLACK, 'plastic', wear=0, at=(0, 0.0 + i * 0.03, 0.0935))
  P.add(box(0.042, 0.14, 0.05, 0.006, 1), 0x4a4d52, 'metal', at=(0, 0.32, 0.035))   # handguard
  for s in (-1, 1):
    for i in range(3):
      P.add(box(0.003, 0.018, 0.03, 0.0005, 0), BLACK, 'plastic', wear=0, at=(s * 0.0212, 0.28 + i * 0.04, 0.035))
  P.add(rev([(0.0135, 0.38), (0.0135, 0.5)], 12), STEEL, 'metal', at=(0, 0, 0.035), rot=AY)
  speaker_muzzle(P, 0.49, 0.53, 0.014, 0.031, c=(0, 0, 0.035), ring=0.005, cap=0.75)
  # curved magazine with ribs and a base plate
  mag = [((0, 0.1 + 0.05 * t ** 1.7, -0.015 - 0.255 * t), 0.037, 0.052, 0.008) for t in (0, 0.25, 0.5, 0.75, 1.0)]
  P.add(loft(mag, n=1, up=(0, 1, 0), bevel=0.003, bsteps=1), 0x1a1a1a, 'gloss', wear=0.6)
  for t in (0.3, 0.5, 0.7):
    P.add(box(0.04, 0.056, 0.006, 0.002, 1, sub=0.0), 0x2e2f33, 'metal', at=(0, 0.1 + 0.05 * t ** 1.7, -0.015 - 0.255 * t))
  P.add(box(0.044, 0.06, 0.012, 0.003, 1, sub=0.0), STEEL, 'metal', at=(0, 0.15, -0.276))
  handle(P, (0, -0.05, -0.08), 0.13, 0.05, 0.056, -0.25, wood=False, tape=4, grooves=2)
  fg = (0, 0.31, -0.052)
  handle(P, fg, 0.11, 0.04, 0.042, 0.0, wood=False, tape=3, grooves=0)
  # wire stock and butt plate
  for s in (-1, 1):
    P.add(tube([(s * 0.016, -0.08, zc), (s * 0.016, -0.18, zc), (s * 0.016, -0.27, 0.012)], 0.0065, seg=6, per=2), STEEL, 'metal')
  P.add(box(0.044, 0.014, 0.06, 0.003, 1, sub=0.0), RUBBER, 'rubber', wear=0, at=(0, -0.275, 0.01))
  P.add(box(0.052, 0.008, 0.008, 0.002, 1, sub=0.0), STEEL, 'metal', at=(0, -0.2, 0.03))
  # cocking handle, trigger and guard
  P.add(box(0.014, 0.04, 0.014, 0.003, 1, sub=0.0), STEEL, 'metal', at=(0.036, 0.02, 0.05))
  P.add(box(0.016, 0.016, 0.016, 0.003, 1, sub=0.0), STEEL, 'metal', at=(0.045, 0.0, 0.05))
  guard(P, (0, 0.015, -0.026), 0.026, 0.024)
  P.add(loft([((0, 0.026, -0.012), 0.009, 0.007, 0.002), ((0, 0.02, -0.03), 0.009, 0.007, 0.002)], n=1, up=(1, 0, 0), bevel=0.002, bsteps=1), STEEL, 'metal', wear=0)
  for s in (-1, 1):
    speaker_side(P, (s * 0.028, 0.13, zc), 0.034, s)
  lamp_bezel(P, (0, -0.07, 0.093))
  for s in (-1, 1):  # violet enamel pinstripe, the HUD colour
    P.add(box(0.003, 0.06, 0.0025, 0.0005, 0), 0x6b46c4, 'gloss', wear=0, at=(s * 0.028, 0.0, 0.066))
  # right hand on the grip; left hand round the short foregrip
  hand(H, 1, (0, -0.05, -0.08), -0.25, 0.028, 0.025, [0.0, -0.026, -0.05], rf=0.0118,
       index=[(0.036, -0.065, -0.014), (0.032, -0.03, -0.018), (0.024, 0.0, -0.022), (0.004, 0.0, -0.026)],
       thumb=[(-0.015, -0.07, -0.01), (-0.035, -0.03, 0.008), (-0.039, 0.02, 0.018), (-0.036, 0.07, 0.024)],
       arm=(0.2, -0.86, -0.46))
  hand(H, -1, fg, 0.0, 0.021, 0.02, [0.036, 0.011, -0.014, -0.039], rf=0.0116, palm_h=0.115, reach=0.075, watch=True,
       index=None, thumb=[(-0.012, 0.28, 0.0), (-0.03, 0.305, 0.016), (-0.034, 0.34, 0.024), (-0.03, 0.375, 0.028)],
       arm=(0.7, -0.45, -0.75))
  return dict(body=P, hands=H, muzzle=(0, 0.53, 0.035), lamp=(0, -0.07, 0.096))


# ---------------------------------------------------------------------------------------------
# Reverb Launcher: a fat tube ending in a speaker horn
# ---------------------------------------------------------------------------------------------

def launcher():
  P, H = Part('body'), Part('hands', smooth=80)
  zc = 0.03
  # the tube, with a rolled rear edge, and a flared collar at the back
  P.add(rev([(0, -0.05), (0.068, -0.05, 0.004), (0.075, -0.042, 0.004), (0.075, 0.445), (0.0, 0.445)], 30), 0x4a4d52, 'gloss', at=(0, 0, zc), rot=AY, wear=0.9)
  P.add(rev([(0, -0.125), (0.066, -0.125, 0.004), (0.086, -0.108, 0.003), (0.086, -0.05, 0.003), (0.074, -0.05)], 26), 0x2a2b2e, 'metal', at=(0, 0, zc), rot=AY)
  P.add(rev([(0, -0.132), (0.055, -0.132, 0.004), (0.055, -0.12), (0, -0.12)], 20), RUBBER, 'rubber', wear=0, at=(0, 0, zc), rot=AY)
  for y in (0.05, 0.2, 0.33):
    P.add(rev([(0.074, y - 0.008), (0.083, y - 0.008, 0.002), (0.083, y + 0.008, 0.002), (0.074, y + 0.008)], 28), BRASS, 'brass', at=(0, 0, zc), rot=AY)
  P.add(box(0.022, 0.5, 0.004, 0.001, 0), 0xb0287d, 'gloss', wear=0, at=(0, 0.2, 0.1055))         # magenta enamel stripe
  speaker_muzzle(P, 0.44, 0.6, 0.074, 0.17, c=(0, 0, zc), ring=0.012, cap=0.55)
  # rear grip (wood), foregrip, guard and trigger
  handle(P, (0, -0.03, -0.1), 0.15, 0.056, 0.066, -0.2, wood=True, tape=4, grooves=3)
  handle(P, (0, 0.22, -0.1), 0.1, 0.042, 0.042, 0.0, wood=False, tape=3, grooves=0)
  guard(P, (0, 0.02, -0.052), 0.024, 0.024)
  P.add(loft([((0, 0.03, -0.035), 0.009, 0.007, 0.002), ((0, 0.024, -0.05), 0.009, 0.007, 0.002)], n=1, up=(1, 0, 0), bevel=0.002, bsteps=1), STEEL, 'metal', wear=0)
  # sights: a block with the lamp, a flip-up ring and post at the front
  P.add(box(0.022, 0.04, 0.05, 0.005, 1), 0x3a3d42, 'metal', at=(0, 0.1, 0.122))
  lamp_bezel(P, (0, 0.1, 0.1475))
  P.add(loft(sweep(ring_path((0, 0.42, 0.164), 0.02, 0.0, 'xz', 12), [(0.008, 0.008)] * 12, 1, True), seg=6, up=(0, 1, 0), closed=True), STEEL, 'metal')
  P.add(box(0.012, 0.012, 0.05, 0.003, 1, sub=0.0), STEEL, 'metal', at=(0, 0.42, 0.115))
  # a side speaker and a rust-brown ammo plate
  speaker_side(P, (0.0745, 0.27, zc), 0.03, 1, depth=0.01)
  P.add(box(0.07, 0.12, 0.05, 0.008, 1), 0x6b3a1c, 'paint', at=(0.07, 0.15, 0.04))
  for k in (-1, 1):
    P.add(kit.sphere(0.0045, 6, 4), STEEL, 'metal', at=(0.0, 0.15 + k * 0.045, 0.067), scale=(1, 1, 0.7)) if False else None
  # right hand on the rear grip, left hand round the foregrip
  hand(H, 1, (0, -0.03, -0.1), -0.2, 0.033, 0.028, [0.012, -0.014, -0.04],
       index=[(0.04, -0.06, -0.044), (0.036, -0.035, -0.047), (0.026, -0.008, -0.05), (0.006, -0.005, -0.052)],
       thumb=[(-0.02, -0.065, -0.04), (-0.05, -0.04, -0.034), (-0.055, 0.0, -0.03), (-0.05, 0.04, -0.028)],
       arm=(0.2, -0.86, -0.46))
  hand(H, -1, (0, 0.22, -0.1), 0.0, 0.021, 0.021, [0.036, 0.012, -0.012, -0.036], rf=0.0116, palm_h=0.115, reach=0.075, watch=True,
       index=None, thumb=[(-0.012, 0.19, -0.05), (-0.03, 0.215, -0.044), (-0.056, 0.25, -0.04), (-0.056, 0.29, -0.034)],
       arm=(0.7, -0.45, -0.75))
  return dict(body=P, hands=H, muzzle=(0, 0.63, zc), lamp=(0, 0.1, 0.152))


# ---------------------------------------------------------------------------------------------
# Vinyl Disc: a black turntable deck, a record spinning on a tilted platter, a chrome flinger rail
# ---------------------------------------------------------------------------------------------

def vinyl():
  P, C, H = Part('body'), Part('cradle', origin=(0, 0.1, 0.128)), Part('hands', smooth=80)
  P.add(loft([((0, -0.13, 0.03), 0.28, 0.075, 0.024), ((0, 0.33, 0.03), 0.28, 0.075, 0.024)], n=2, bevel=0.012, bsteps=2),
        0x1c1c22, 'plastic', wear=0)
  P.add(box(0.26, 0.44, 0.012, 0.005, 1), 0x2c2c34, 'metal', at=(0, 0.1, 0.07))
  for y in (0.328, -0.128):
    P.add(box(0.282, 0.02, 0.012, 0.004, 1, sub=0.0), CHROME, 'chrome', at=(0, y, 0.062))
  for s in (-1, 1):
    P.add(box(0.014, 0.45, 0.012, 0.004, 1, sub=0.0), CHROME, 'chrome', at=(s * 0.138, 0.1, 0.062))
    for y in (-0.1, 0.3):
      P.add(box(0.04, 0.04, 0.03, 0.0, 0), RUBBER, 'rubber', wear=0, at=(s * 0.115, y, -0.012))
  # the platter's pivot block
  P.add(zrev([(0, -0.035), (0.08, -0.035), (0.06, 0.035), (0, 0.035)], 14), STEEL, 'metal', at=(0, 0.1, 0.085))
  # flinger rail: two chrome rods climbing to a gate, on a rubber strip
  for s in (-1, 1):
    P.add(tube([(s * 0.05, 0.2, 0.1), (s * 0.05, 0.54, 0.166)], 0.011, seg=8, per=1), CHROME, 'chrome')
    P.add(box(0.016, 0.016, 0.085, 0.004, 1, sub=0.0), CHROME, 'chrome', at=(s * 0.05, 0.54, 0.19))
    P.add(box(0.014, 0.014, 0.05, 0.003, 1, sub=0.0), STEEL, 'metal', at=(s * 0.05, 0.25, 0.085))
    P.add(box(0.012, 0.012, 0.1, 0.003, 1, sub=0.0), STEEL, 'metal', at=(s * 0.05, 0.4, 0.1), rot=(0.5, 0, 0))
  P.add(box(0.08, 0.31, 0.008, 0.003, 1, sub=0.0), RUBBER, 'rubber', wear=0, at=(0, 0.37, 0.124), rot=(0.19, 0, 0))
  P.add(box(0.15, 0.022, 0.036, 0.006, 1, sub=0.0), STEEL, 'metal', at=(0, 0.25, 0.11))
  P.add(box(0.12, 0.016, 0.016, 0.004, 1, sub=0.0), CHROME, 'chrome', at=(0, 0.54, 0.232))
  P.add(box(0.12, 0.022, 0.03, 0.006, 1, sub=0.0), STEEL, 'metal', at=(0, 0.54, 0.152))
  # deck controls: three knobs and a pitch fader, a speaker and a brass plate on the left flank
  for i in range(3):
    k = (CHROME, 'chrome') if i != 1 else (BRASS, 'brass')
    P.add(zrev([(0.017, -0.011), (0.017, 0.011), (0, 0.011)], 10), k[0], k[1], at=(-0.095, -0.1 + i * 0.05, 0.085))
  P.add(box(0.014, 0.12, 0.004, 0.001, 0), BLACK, 'plastic', wear=0, at=(0.1, 0.2, 0.077))
  P.add(box(0.03, 0.022, 0.016, 0.005, 1, sub=0.0), BRASS, 'brass', at=(0.1, 0.18, 0.082))
  speaker_side(P, (-0.14, 0.14, 0.025), 0.05, -1, depth=0.01)
  P.add(box(0.006, 0.08, 0.028, 0.002, 1, sub=0.0), BRASS, 'brass', at=(-0.142, -0.03, 0.028))
  lamp_bezel(P, (-0.1, -0.07, 0.076))
  # grips, guard, trigger and the cable
  handle(P, (0, -0.06, -0.09), 0.17, 0.058, 0.075, -0.2, tape=3)
  handle(P, (0, 0.24, -0.07), 0.1, 0.046, 0.046, 0.0, wood=False, tape=2, grooves=0)
  guard(P, (0, 0.03, -0.02), 0.026, 0.026)
  P.add(loft([((0, 0.04, -0.005), 0.009, 0.007, 0.002), ((0, 0.034, -0.025), 0.009, 0.007, 0.002)], n=1, up=(1, 0, 0), bevel=0.002, bsteps=1), STEEL, 'metal', wear=0)
  P.add(tube([(-0.03, -0.13, 0.03), (-0.07, -0.19, 0.0), (-0.09, -0.19, -0.09), (-0.07, -0.15, -0.16)], 0.009, seg=6, per=1), RUBBER, 'rubber', wear=0)
  # the platter, in its own frame: origin at its centre, z out of the face, y towards the muzzle
  C.add(zrev([(0, -0.011), (0.13, -0.011, 0.002), (0.132, -0.008), (0.132, 0.008), (0.13, 0.011, 0.002), (0, 0.011)], 26),
        CHROME, 'chrome', wear=0)
  C.add(zrev([(0, 0.011), (0.122, 0.011, 0.002), (0.122, 0.0215, 0.002), (0, 0.0215)], 24), 0x5a141c, 'cloth', wear=0)
  arc = [(0.15 * cos(PI * i / 6), 0.15 * sin(PI * i / 6), 0.036) for i in range(7)]
  C.add(loft(sweep(arc, [(0.017, 0.017)] * 7, 1), seg=8, up=(0, 0, 1), bevel=0.004, bsteps=1), CHROME, 'chrome')
  for f in (0, 0.5, 1):
    C.add(box(0.014, 0.014, 0.04, 0.003, 1, sub=0.0), STEEL, 'metal', at=(0.15 * cos(f * PI), 0.15 * sin(f * PI), 0.016))
  C.add(zrev([(0.028, -0.02), (0.028, 0.02, 0.003), (0.02, 0.02)], 18), CHROME, 'chrome', at=(0.15, -0.14, 0.02))
  C.add(tube([(0.15, -0.14, 0.045), (0.15, -0.08, 0.06), (0.115, 0.02, 0.06), (0.08, 0.09, 0.055)], 0.0065, seg=7, per=3), CHROME, 'chrome')
  C.add(box(0.032, 0.055, 0.008, 0.003, 1, sub=0.0), CHROME, 'chrome', at=(0.075, 0.115, 0.05), rot=(0, 0, -0.4))
  C.add(rev([(0.017, -0.022), (0.017, 0.022, 0.003), (0.012, 0.022)], 14), BRASS, 'brass', at=(0.15, -0.18, 0.05))
  # right hand on the rear grip, left hand round the foregrip
  hand(H, 1, (0, -0.06, -0.09), -0.2, 0.0375, 0.029, [0.0, -0.026, -0.052],
       index=[(0.04, -0.085, -0.014), (0.037, -0.05, -0.017), (0.028, -0.01, -0.02), (0.006, 0.0, -0.022)],
       thumb=[(-0.02, -0.085, 0.0), (-0.04, -0.06, 0.004), (-0.05, -0.02, 0.006), (-0.052, 0.03, 0.01)],
       arm=(0.2, -0.86, -0.46))
  hand(H, -1, (0, 0.24, -0.07), 0.0, 0.023, 0.023, [0.036, 0.011, -0.014, -0.039], rf=0.0116, palm_h=0.115, reach=0.075, watch=True,
       index=None, thumb=[(-0.012, 0.21, -0.03), (-0.03, 0.235, -0.025), (-0.056, 0.27, -0.022), (-0.056, 0.31, -0.018)],
       arm=(0.7, -0.45, -0.75))
  return dict(body=P, cradle=C, hands=H, muzzle=(0, 0.54, 0.19), lamp=(-0.1, -0.07, 0.082), cradleTilt=0.36)


WEAPONS = {'pistol': pistol, 'shotgun': shotgun, 'smg': smg, 'launcher': launcher, 'vinyl': vinyl}
PART_ORDER = ('body', 'pump', 'cradle', 'hands', 'handsPump')


def build_all(ids):
  out, built, meta = {}, {}, {}
  for wid in ids:
    t0 = time.time()
    w = WEAPONS[wid]()
    parts = [w[k] for k in PART_ORDER if k in w]
    for p in parts:
      kit.bake_part(p, None)
    bvh = kit.occluder_bvh([p for p in parts if p.name != 'cradle'])  # the hands shade the grips and the guns shade the hands
    out[wid] = {p.name: kit.encode_part(p, kit.occluder_bvh([p]) if p.name == 'cradle' else bvh) for p in parts}
    built[wid] = parts
    # to the game's frame (x, y, z) -> (x, z, -y)
    m = {k: [round(c, 5) for c in (v[0], v[2], -v[1])] for k, v in w.items() if k in ('muzzle', 'lamp')}
    if 'cradleTilt' in w:
      m['cradleTilt'] = w['cradleTilt']
    meta[wid] = m
    print(f'{wid:9s} ' + '  '.join(f"{p.name} {out[wid][p.name]['tris']} tris" for p in parts) + f'  ({time.time() - t0:.1f}s)')
  return out, built, meta


HEADER = """// Generated by scripts/blender/weapons.py from the Blender models of the five weapons and Naebun's hands. Do not edit by
// hand: change the script and run it again (see README.md, "Blender").
// Per weapon: `muzzle` and `lamp` in the weapon's frame (-z forward, y up), `cradleTilt` for the vinyl's platter, and
// `parts` (body, pump, cradle, hands, handsPump). Per part: `pos` is the pivot, `p` quantised positions (int16 x `sc`),
// `nrm` normals (int8), `idx` triangle indices (uint16), `col` sRGB bytes (ambient occlusion and wear included) and
// `sf` (roughness, metalness bytes).
export const WEAPON_MESHES = """


def main():
  ap = argparse.ArgumentParser()
  here = os.path.dirname(os.path.abspath(__file__))
  ap.add_argument('--out', default=os.path.join(here, '..', '..', 'src', 'weapon-meshes.js'))
  ap.add_argument('--only')
  ap.add_argument('--preview', help='render the named weapon (to --png)')
  ap.add_argument('--sheet', help='render a contact sheet of every built weapon to this png (iso and first-person rows)')
  ap.add_argument('--view', default='fp')
  ap.add_argument('--png')
  ap.add_argument('--hide', default='')
  ap.add_argument('--landscape', action='store_true')
  ap.add_argument('--crop', help='x0,x1,y0,y1 fractions of the frame (y up), fp view only')
  ap.add_argument('--zoom', type=float, default=2.0)
  a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
  ids = a.only.split(',') if a.only else (list(WEAPONS) if not a.preview else [a.preview])
  data, built, meta = build_all(ids)
  if a.sheet:
    import preview
    preview.weapon_sheet(built, a.sheet, tilts={'cradle': 0.36})
  if a.preview:
    import preview
    size = (844, 390) if a.landscape else (390, 844)
    size = (int(size[0] * a.zoom), int(size[1] * a.zoom))
    if a.view != 'fp':
      size = (900, 600)
    crop = tuple(float(v) for v in a.crop.split(',')) if a.crop else None
    preview.weapon_view(built[a.preview], a.png or f'/tmp/{a.preview}-{a.view}.png', a.view, size=size, hide=a.hide.split(','),
                        portrait=not a.landscape, crop=crop, tilts={'cradle': 0.36},
                        x=(0.375 if a.landscape else 0.15) - (0.03 if a.preview in ('launcher', 'vinyl') else 0))
    return
  if a.only:
    print('--only builds a subset: not writing', a.out)
    return
  doc = {}
  for wid, parts in data.items():
    for m in parts.values():
      m.pop('tris')
    doc[wid] = dict(meta[wid], parts=parts)
  with open(a.out, 'w') as f:
    f.write(HEADER + json.dumps(doc, separators=(',', ':')).replace('},"', '},\n"') + ';\n')
  print('wrote', os.path.relpath(a.out), f'({os.path.getsize(a.out) / 1024:.0f} KB)')


if __name__ == '__main__':
  main()
