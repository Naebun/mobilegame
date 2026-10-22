// Procedural models for the first-person game: robots, weapons, pickups, projectiles and effects.
// Pure three.js geometry and flat colours, no DOM, so it also runs under plain Node.
// Everything faces -z at yaw 0. Geometry and materials live in module-level caches and are shared.
import * as THREE from '../vendor/three.module.min.js';
import { COLOURS } from './consts.js';

export const WEAPON_IDS = ['pistol', 'shotgun', 'smg', 'launcher'];

// ---------------------------------------------------------------------------------------------
// Cache and geometry helpers
// ---------------------------------------------------------------------------------------------

const cache = new Map();
function once(key, make) {
  let v = cache.get(key);
  if (v === undefined) {
    v = make();
    cache.set(key, v);
  }
  return v;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
const ball = (r, ws = 8, hs = 6) => new THREE.SphereGeometry(r, ws, hs);
const ring = (r, tube, seg = 14) => new THREE.TorusGeometry(r, tube, 5, seg);
const cone = (r, h, seg = 8, open = false) => new THREE.ConeGeometry(r, h, seg, 1, open);

function starShape(points, outer, inner) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points;
    const r = i & 1 ? inner : outer;
    if (i === 0) s.moveTo(Math.sin(a) * r, Math.cos(a) * r);
    else s.lineTo(Math.sin(a) * r, Math.cos(a) * r);
  }
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

// Merge primitives into one non-indexed geometry with per-vertex colours. Each part is
// [geometry, hex, [x, y, z], [rx, ry, rz], [sx, sy, sz]]. `base` is subtracted from every
// position so a group can be built in world-ish coordinates around its own pivot.
function merge(parts, base = [0, 0, 0], grit = 0.16) {
  const pos = [];
  const nor = [];
  const col = [];
  for (const [geo, hex, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    _e.set(r[0], r[1], r[2]);
    _q.setFromEuler(_e);
    _p.set(p[0] - base[0], p[1] - base[1], p[2] - base[2]);
    _s.set(s[0], s[1], s[2]);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    const c0 = new THREE.Color(hex);
    const a = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < a.count; i++) {
      pos.push(a.getX(i), a.getY(i), a.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      // Scuffing: a stable brightness wobble per triangle, plus a grubby darkening towards the floor.
      const tri = (pos.length / 9) | 0;
      const f = 1 + grit * (((Math.sin(tri * 12.9898 + 4.1) * 43758.5453) % 1 + 1) % 1 - 0.5) * 2;
      const dirt = grit > 0 ? 0.85 + 0.15 * clamp((p[1] - base[1]) / 1.5 + 0.5, 0, 1) : 1;
      col.push(c0.r * f * dirt, c0.g * f * dirt, c0.b * f * dirt);
    }
    g.dispose();
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------

// Lit, vertex-coloured, flat-shaded. A faint tinted emissive keeps robots readable in a dark scene.
const litMat = (key, emissive) => once(`lit:${key}`, () => new THREE.MeshLambertMaterial({
  vertexColors: true, flatShading: true, emissive,
}));
// Unlit vertex-coloured glow (neon strips, rockets, bottles).
const glowMat = () => once('glowVC', () => new THREE.MeshBasicMaterial({ vertexColors: true }));
const flatGlow = (hex, fog = true) => once(`flat:${hex}:${fog}`, () => new THREE.MeshBasicMaterial({ color: hex, fog }));
const whiteMat = () => once('white', () => new THREE.MeshBasicMaterial({ color: 0xffffff }));
const addMat = (hex, opacity) => once(`add:${hex}:${opacity}`, () => new THREE.MeshBasicMaterial({
  color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
}));

// ---------------------------------------------------------------------------------------------
// Robots
// ---------------------------------------------------------------------------------------------

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;
const smooth = (t) => t * t * (3 - 2 * t);

// Per-kind rig numbers. Positions are absolute heights above the feet; geometry is built relative to its pivot.
const SPEC = {
  drpepper: {
    height: 2.1, radius: 0.55, headY: 1.62, hip: 0.45, neck: 1.62, bodyR: 0.5,
    legX: 0.26, shoulderX: 0.64, shoulderY: 1.38, eyeEmissive: 0xff5a22, emissive: 0x1a0d0a, lamp: [0.14, 1.36, -0.512, 0xffa030],
    walkRate: 6.5, bob: 0.05, stride: 0.75, eyeX: 0.17, eyeY: 1.84, eyeZ: -0.31, eyeTilt: 0.2,
    cannon: false, bothArms: false,
  },
  wray: {
    height: 2.0, radius: 0.5, headY: 1.5, hip: 0.42, neck: 1.5, bodyR: 0.47,
    legX: 0.22, shoulderX: 0.54, shoulderY: 1.05, eyeEmissive: 0x35e6ff, emissive: 0x15120e, lamp: [0.26, 0.75, -0.46, 0xffa030],
    walkRate: 7.5, bob: 0.04, stride: 0.7, eyeX: 0.11, eyeY: 1.68, eyeZ: -0.235, eyeTilt: 0,
    cannon: true, bothArms: false,
  },
  bouncer: {
    height: 3.3, radius: 0.95, headY: 2.62, hip: 0.8, neck: 2.62, bodyR: 0.82,
    legX: 0.42, shoulderX: 1.2, shoulderY: 2.35, eyeEmissive: 0xff2a2a, emissive: 0x120d0e, lamp: null,
    walkRate: 4.6, bob: 0.07, stride: 0.55, eyeX: 0.27, eyeY: 2.94, eyeZ: -0.445, eyeTilt: 0.18,
    cannon: false, bothArms: true,
  },
};

// Look: battered painted sheet metal, grubby chrome, black rubber, rust patches. Glow is limited to the
// eyes and a tiny indicator lamp. Colours are deliberately dull; merge() adds per-face scuffing.
const RUST = 0x6b3a1c;
const RUBBER = 0x141414;
const CHROME = 0x9a9c98;

function drPepperGeo() {
  const HIP = 0.45;
  const NECK = 1.62;
  const maroon = 0x6e222c;
  const dark = 0x241819;
  const steel = 0x575c63;
  const band = 0xa06c5c;
  const head = 0x4a4e52;
  return {
    leg: merge([
      [cyl(0.12, 0.11, 0.34), steel, [0, -0.17, 0]],
      [cyl(0.135, 0.135, 0.06), RUBBER, [0, -0.1, 0]],
      [box(0.3, 0.12, 0.44), RUBBER, [0, -0.39, -0.07]],
      [box(0.3, 0.03, 0.44), 0x3a2a22, [0, -0.33, -0.07]],
    ]),
    torso: merge([
      [cyl(0.34, 0.4, 0.16), dark, [0, 0.46, 0]],
      [cyl(0.48, 0.48, 1.1), maroon, [0, 1.0, 0]],
      [cyl(0.5, 0.5, 0.08), CHROME, [0, 0.52, 0]],
      [cyl(0.5, 0.5, 0.1), CHROME, [0, 1.5, 0]],
      [cyl(0.4, 0.5, 0.07), CHROME, [0, 1.58, 0]],
      [cyl(0.495, 0.495, 0.22), band, [0, 1.0, 0]],
      [cyl(0.16, 0.2, 0.1), RUBBER, [0, 1.62, 0]],
      // vending-machine front: coin slot, buttons and a delivery flap
      [box(0.4, 0.34, 0.07), 0x2b2c2e, [0, 1.25, -0.47]],
      [box(0.2, 0.025, 0.02), 0x0a0a0a, [0.06, 1.34, -0.51]],
      [box(0.06, 0.04, 0.02), 0x8a2a20, [-0.12, 1.2, -0.51]],
      [box(0.06, 0.04, 0.02), 0xb89a3a, [-0.04, 1.2, -0.51]],
      [box(0.06, 0.04, 0.02), 0x4a6a4a, [0.04, 1.2, -0.51]],
      [box(0.3, 0.1, 0.05), 0x1a1a1a, [0, 1.08, -0.49]],
      // rust and scrape patches
      [box(0.2, 0.26, 0.03), RUST, [-0.3, 0.82, -0.37], [0, 0.6, 0]],
      [box(0.16, 0.12, 0.03), RUST, [0.32, 1.38, -0.35], [0, -0.6, 0]],
      [box(0.22, 0.3, 0.03), RUST, [0.1, 0.72, 0.47], [0, 3.14, 0]],
      [box(0.1, 0.4, 0.03), 0x8a8a84, [-0.36, 1.1, -0.32], [0, 0.8, 0]],
      // rubber hose wrapped round the waist
      [ring(0.5, 0.035, 16), RUBBER, [0, 0.64, 0], [HALF, 0, 0]],
    ], [0, HIP, 0]),
    head: merge([
      [box(0.7, 0.4, 0.56), head, [0, 1.82, 0]],
      [box(0.62, 0.17, 0.06), 0x0a0a0c, [0, 1.84, -0.29]],
      [box(0.27, 0.06, 0.07), dark, [-0.17, 1.955, -0.3], [0, 0, -0.3]],
      [box(0.27, 0.06, 0.07), dark, [0.17, 1.955, -0.3], [0, 0, 0.3]],
      [cyl(0.07, 0.07, 0.1), CHROME, [-0.38, 1.82, 0], [0, 0, HALF]],
      [cyl(0.07, 0.07, 0.1), CHROME, [0.38, 1.82, 0], [0, 0, HALF]],
      [box(0.36, 0.07, 0.05), dark, [0, 1.68, -0.29]],
      [box(0.05, 0.06, 0.03), CHROME, [-0.1, 1.68, -0.31]],
      [box(0.05, 0.06, 0.03), CHROME, [0, 1.68, -0.31]],
      [box(0.05, 0.06, 0.03), CHROME, [0.1, 1.68, -0.31]],
      [ring(0.085, 0.022), CHROME, [0, 2.045, 0.06], [HALF, 0, 0]],
      [box(0.1, 0.02, 0.1), CHROME, [0, 2.03, -0.04]],
      [box(0.22, 0.14, 0.03), RUST, [0.2, 1.8, 0.29]],
      [box(0.03, 0.12, 0.03), 0x1a1a1a, [-0.3, 2.08, 0.1]],
    ], [0, NECK, 0]),
    eye: box(0.15, 0.085, 0.04),
    lamp: ball(0.032, 6, 5),
    arm: merge([
      [ball(0.17), CHROME],
      [cyl(0.17, 0.16, 0.36), 0x484d55, [0, -0.3, 0]],
      [cyl(0.19, 0.19, 0.05), RUBBER, [0, -0.13, 0]],
      [cyl(0.19, 0.19, 0.05), RUBBER, [0, -0.47, 0]],
      [cyl(0.075, 0.075, 0.3), 0xb4b6b2, [0, -0.6, 0]],
      [box(0.46, 0.4, 0.46), maroon, [0, -0.84, 0]],
      [box(0.46, 0.07, 0.07), CHROME, [0, -0.74, -0.26]],
      [box(0.5, 0.05, 0.5), dark, [0, -0.66, 0]],
      [box(0.14, 0.2, 0.03), RUST, [0.1, -0.86, -0.24]],
      [ring(0.17, 0.028, 12), RUBBER, [0.0, -0.3, 0], [HALF, 0, 0], [1.2, 1.2, 1]],
    ]),
  };
}

function wrayGeo() {
  const HIP = 0.42;
  const NECK = 1.5;
  const cream = 0xc9bd9c;
  const dark = 0x25262c;
  const steel = 0x7c8086;
  const gun = 0x363a40;
  return {
    leg: merge([
      [cyl(0.1, 0.09, 0.3), steel, [0, -0.15, 0]],
      [cyl(0.115, 0.115, 0.05), RUBBER, [0, -0.1, 0]],
      [box(0.26, 0.12, 0.4), RUBBER, [0, -0.36, -0.06]],
    ]),
    torso: merge([
      [cyl(0.3, 0.36, 0.12), 0x1e1f24, [0, 0.42, 0]],
      [cyl(0.46, 0.46, 0.77), cream, [0, 0.755, 0]],
      [cyl(0.47, 0.47, 0.07), 0x8a7f66, [0, 0.41, 0]],
      [cyl(0.475, 0.475, 0.34), dark, [0, 0.75, 0]],
      [cyl(0.2, 0.46, 0.4), cream, [0, 1.34, 0]],
      // worn tape stripes either side of the label band, grime and a rust bloom
      [cyl(0.48, 0.48, 0.03), 0xa88c3a, [0, 0.58, 0]],
      [cyl(0.48, 0.48, 0.03), 0xa88c3a, [0, 0.92, 0]],
      [box(0.24, 0.12, 0.03), 0x5a5a56, [0.0, 0.75, -0.47]],
      [box(0.2, 0.22, 0.03), RUST, [0.3, 1.12, -0.34], [0, -0.7, 0]],
      [box(0.14, 0.3, 0.03), 0x8a7a5a, [-0.34, 0.5, -0.3], [0, 0.8, 0]],
      [ring(0.45, 0.03, 16), RUBBER, [0, 1.1, 0], [HALF, 0, 0]],
    ], [0, HIP, 0]),
    head: merge([
      [cyl(0.22, 0.25, 0.36), cream, [0, 1.68, 0]],
      [cyl(0.235, 0.235, 0.17), dark, [0, 1.68, 0]],
      [cyl(0.29, 0.29, 0.1), 0x7a6a2e, [0, 1.89, 0]],
      [cyl(0.2, 0.29, 0.05), 0x7a6a2e, [0, 1.965, 0]],
      [ring(0.29, 0.022), 0x9a8a4a, [0, 1.84, 0], [HALF, 0, 0]],
      [box(0.1, 0.1, 0.02), RUST, [0.0, 1.55, 0.24]],
    ], [0, NECK, 0]),
    eye: cyl(0.085, 0.085, 0.03, 10),
    lamp: ball(0.03, 6, 5),
    arm: merge([
      [ball(0.1), steel],
      [cyl(0.05, 0.05, 0.5), steel, [0, -0.3, 0]],
      [cyl(0.065, 0.065, 0.06), RUBBER, [0, -0.2, 0]],
      [box(0.13, 0.15, 0.13), 0x1e1f24, [0, -0.62, 0]],
    ]),
    // Cannon arm: points along local -y, so rotating it about x aims it.
    cannon: merge([
      [ball(0.14), steel],
      [cyl(0.12, 0.12, 0.34), gun, [0, -0.22, 0]],
      [cyl(0.075, 0.075, 0.6), 0x6a6e74, [0, -0.62, 0]],
      [cyl(0.1, 0.1, 0.04), 0x7a6a2e, [0, -0.45, 0]],
      [cyl(0.1, 0.1, 0.04), 0x7a6a2e, [0, -0.72, 0]],
      [cyl(0.075, 0.13, 0.12), gun, [0, -0.96, 0]],
      [ring(0.12, 0.028, 12), RUBBER, [0, -0.06, 0], [HALF, 0, 0]],
      [box(0.08, 0.16, 0.03), RUST, [0.0, -0.22, 0.12]],
    ]),
  };
}

function bouncerGeo() {
  const HIP = 0.8;
  const NECK = 2.62;
  const maroon = 0x6e222c;
  const black = 0x1a1a1e;
  return {
    leg: merge([
      [cyl(0.2, 0.18, 0.62), black, [0, -0.31, 0]],
      [box(0.46, 0.2, 0.7), 0x08080a, [0, -0.7, -0.1]],
      [box(0.4, 0.03, 0.66), 0x2a2420, [0, -0.6, -0.1]],
    ]),
    torso: merge([
      [cyl(0.55, 0.65, 0.2), 0x241819, [0, 0.8, 0]],
      [cyl(0.82, 0.82, 0.95), maroon, [0, 1.17, 0]],
      [cyl(0.84, 0.84, 0.1), CHROME, [0, 0.76, 0]],
      [cyl(0.83, 0.83, 0.3), 0xa06c5c, [0, 1.1, 0]],
      [box(0.3, 0.4, 0.03), RUST, [-0.4, 0.95, -0.75], [0, 0.5, 0]],
      // dinner jacket: body, lapels, shirt front, bow tie, shoulder slab
      [box(1.7, 1.05, 1.2), black, [0, 2.075, 0]],
      [box(0.36, 0.9, 0.05), 0xc9c4b4, [0, 2.07, -0.615]],
      [box(0.22, 0.95, 0.06), 0x2a2a30, [-0.3, 2.05, -0.62], [0, 0, 0.2]],
      [box(0.22, 0.95, 0.06), 0x2a2a30, [0.3, 2.05, -0.62], [0, 0, -0.2]],
      [box(2.1, 0.4, 1.05), 0x202024, [0, 2.4, 0]],
      [cone(0.14, 0.3), 0x7a1a28, [-0.17, 2.45, -0.66], [0, 0, -HALF]],
      [cone(0.14, 0.3), 0x7a1a28, [0.17, 2.45, -0.66], [0, 0, HALF]],
      [ball(0.075), 0x5a1220, [0, 2.45, -0.68]],
      [box(0.1, 0.1, 0.03), 0xc9c4b4, [0.5, 2.3, -0.61]],
      [cyl(0.25, 0.3, 0.12), RUBBER, [0, 2.62, 0]],
      [ring(0.84, 0.04, 18), RUBBER, [0, 1.5, 0], [HALF, 0, 0]],
    ], [0, HIP, 0]),
    head: merge([
      [box(1.1, 0.6, 0.8), 0x4a4e52, [0, 2.92, 0]],
      [box(0.98, 0.22, 0.06), 0x08080a, [0, 2.94, -0.41]],
      [box(0.42, 0.09, 0.08), 0x241819, [-0.27, 3.1, -0.43], [0, 0, -0.3]],
      [box(0.42, 0.09, 0.08), 0x241819, [0.27, 3.1, -0.43], [0, 0, 0.3]],
      [box(0.6, 0.1, 0.05), 0x241819, [0, 2.74, -0.41]],
      [box(0.08, 0.09, 0.03), CHROME, [-0.18, 2.74, -0.44]],
      [box(0.08, 0.09, 0.03), CHROME, [0, 2.74, -0.44]],
      [box(0.08, 0.09, 0.03), CHROME, [0.18, 2.74, -0.44]],
      [cyl(0.1, 0.1, 0.12), CHROME, [-0.6, 2.9, 0], [0, 0, HALF]],
      [box(0.1, 0.2, 0.14), 0x08080a, [0.6, 2.88, 0]],
      [cyl(0.015, 0.015, 0.32), 0x08080a, [0.62, 2.68, 0.06]],
      [ring(0.14, 0.03), CHROME, [0, 3.26, 0.1], [HALF, 0, 0]],
      [box(0.3, 0.2, 0.03), RUST, [-0.3, 2.85, 0.41]],
      [box(0.5, 0.04, 0.03), 0x8a8a84, [0.1, 3.18, -0.42], [0, 0, 0.2]],
    ], [0, NECK, 0]),
    eye: box(0.28, 0.09, 0.04),
    arm: merge([
      [ball(0.26), black],
      [cyl(0.26, 0.3, 0.8), black, [0, -0.5, 0]],
      [cyl(0.29, 0.29, 0.08), 0xc9c4b4, [0, -0.92, 0]],
      [box(0.7, 0.6, 0.65), maroon, [0, -1.28, 0]],
      [box(0.7, 0.1, 0.1), CHROME, [0, -1.15, -0.38]],
      [box(0.2, 0.3, 0.03), RUST, [0.15, -1.3, -0.34]],
      [box(0.5, 0.3, 0.04), 0x2a2a30, [0, -0.5, -0.31], [0.0, 0, 0]],
    ]),
  };
}

const ROBOT_GEO = { drpepper: drPepperGeo, wray: wrayGeo, bouncer: bouncerGeo };
let robotCount = 0;

export function makeRobot(kind) {
  const spec = SPEC[kind];
  if (!spec) throw new Error(`makeRobot: unknown kind "${kind}"`);
  const geo = once(`robot:${kind}`, ROBOT_GEO[kind]);
  const lit = litMat(kind, spec.emissive);
  const phase = robotCount++ * 1.7;
  const meshes = [];

  const mk = (g, m, parent, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.userData.base = m;
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  const group = new THREE.Group();
  group.name = `robot-${kind}`;
  const root = new THREE.Group();
  group.add(root);

  const legL = mk(geo.leg, lit, root, -spec.legX, spec.hip, 0);
  const legR = mk(geo.leg, lit, root, spec.legX, spec.hip, 0);

  const upper = new THREE.Group();
  upper.position.y = spec.hip;
  root.add(upper);
  mk(geo.torso, lit, upper);
  if (spec.lamp) mk(geo.lamp, flatGlow(spec.lamp[3]), upper, spec.lamp[0], spec.lamp[1] - spec.hip, spec.lamp[2]);

  const headG = new THREE.Group();
  headG.position.y = spec.neck - spec.hip;
  upper.add(headG);
  mk(geo.head, lit, headG);

  // Eye material is per robot so the integrator can tint it without touching the others.
  const eyeMat = new THREE.MeshBasicMaterial({ color: spec.eyeEmissive, fog: false });
  const eyes = [-1, 1].map((side) => {
    const e = mk(geo.eye, eyeMat, headG, side * spec.eyeX, spec.eyeY - spec.neck, spec.eyeZ);
    if (kind === 'wray') e.rotation.x = Math.PI / 2;
    else e.rotation.z = -side * spec.eyeTilt;
    return e;
  });

  let earGlow = null;
  if (kind === 'bouncer') {
    earGlow = mk(once('bouncer:ear', () => ball(0.055)), flatGlow(COLOURS.cyan), headG, 0.66, 2.95 - spec.neck, -0.02);
  }

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-spec.shoulderX, spec.shoulderY - spec.hip, 0);
  armR.position.set(spec.shoulderX, spec.shoulderY - spec.hip, 0);
  upper.add(armL, armR);
  mk(geo.arm, lit, armL);
  let cannonMesh = null;
  let cannonGlow = null;
  let muzzle = null;
  if (spec.cannon) {
    cannonMesh = new THREE.Group();
    armR.add(cannonMesh);
    mk(geo.cannon, lit, cannonMesh);
    cannonGlow = mk(geo.lamp, flatGlow(0x35e6ff), cannonMesh, 0.0, -0.3, 0.125);
    muzzle = new THREE.Object3D();
    muzzle.name = 'muzzle';
    muzzle.position.set(0, -1.05, 0);
    cannonMesh.add(muzzle);
  } else {
    mk(geo.arm, lit, armR);
  }

  const rest = spec.bothArms ? 0.16 : 0.1;
  const white = whiteMat();

  function reset() {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    legL.rotation.set(0, 0, 0);
    legR.rotation.set(0, 0, 0);
    legL.position.set(-spec.legX, spec.hip, 0);
    legR.position.set(spec.legX, spec.hip, 0);
    upper.position.set(0, spec.hip, 0);
    upper.rotation.set(0, 0, 0);
    upper.scale.set(1, 1, 1);
    headG.position.set(0, spec.neck - spec.hip, 0);
    headG.rotation.set(0, 0, 0);
    armL.rotation.set(0, 0, -rest);
    armR.rotation.set(0, 0, rest);
    if (cannonMesh) {
      cannonMesh.position.set(0, 0, 0);
      cannonMesh.scale.set(1, 1, 1);
    }
    if (cannonGlow) cannonGlow.scale.set(1, 1, 1);
    for (const e of eyes) {
      e.visible = true;
      e.scale.set(1, 1, 1);
    }
  }

  const eyeScale = (s) => {
    for (const e of eyes) e.scale.set(s, s, 1);
  };

  function idle(t) {
    const s = t + phase;
    upper.scale.y = 1 + 0.012 * Math.sin(s * 2.2);
    upper.rotation.z = 0.025 * Math.sin(s * 1.1);
    upper.rotation.x = 0.02 * Math.sin(s * 0.9 + 1);
    armL.rotation.x = 0.06 * Math.sin(s * 1.7);
    if (cannonMesh) armR.rotation.x = 0.35 + 0.04 * Math.sin(s * 1.7 + 1.5);
    else armR.rotation.x = 0.06 * Math.sin(s * 1.7 + 1.5);
    headG.rotation.y = 0.14 * Math.sin(s * 0.7);
    eyeScale(1 + 0.08 * Math.sin(s * 5));
  }

  // Arms overhead (a = 0..1 of the way up). The bouncer lifts both fists, the others use the right arm.
  function raiseArms(a) {
    armR.rotation.x = a * 2.9;
    armL.rotation.x = spec.bothArms ? a * 2.9 : a * 0.8;
    if (spec.bothArms) {
      armL.rotation.z = -rest - a * 0.15;
      armR.rotation.z = rest + a * 0.15;
    }
  }

  function walk(t) {
    const c = t * spec.walkRate + phase;
    const sL = Math.sin(c);
    legL.rotation.x = sL * spec.stride;
    legR.rotation.x = -sL * spec.stride;
    armL.rotation.x = -sL * 0.5;
    armR.rotation.x = cannonMesh ? 0.5 + 0.06 * sL : sL * 0.5;
    root.position.y = Math.abs(sL) * spec.bob;
    upper.rotation.z = sL * 0.05;
    upper.rotation.x = -0.08;
    headG.rotation.y = -sL * 0.05;
    headG.rotation.x = 0.04;
    eyeScale(1 + 0.05 * Math.sin(c * 2));
  }

  function windup(k) {
    const a = easeOut(k);
    raiseArms(a);
    upper.rotation.x = a * 0.28;
    upper.rotation.z = Math.sin(k * 60) * 0.012 * a;
    legL.rotation.x = 0.25 * a;
    legR.rotation.x = -0.2 * a;
    headG.rotation.x = -0.15 * a;
    eyeScale(1 + 0.4 * a);
  }

  function swing(k) {
    const p = clamp(k / 0.45, 0, 1);
    const slam = easeIn(p);
    const settle = smooth(clamp((k - 0.45) / 0.55, 0, 1));
    const armA = lerp(2.9, 0.35, slam) + settle * 0.35;
    armR.rotation.x = armA;
    armL.rotation.x = spec.bothArms ? armA : lerp(0.8, 0.2, slam);
    if (spec.bothArms) {
      armL.rotation.z = -rest - 0.15 * (1 - slam);
      armR.rotation.z = rest + 0.15 * (1 - slam);
    }
    upper.rotation.x = lerp(0.28, -0.45, slam) + settle * 0.25;
    root.position.z = -0.3 * slam * (1 - settle * 0.7);
    root.position.y = k > 0.45 && k < 0.7 ? -0.03 * Math.sin((k - 0.45) * 12.5) : 0;
    legL.rotation.x = lerp(0.25, -0.15, slam);
    legR.rotation.x = lerp(-0.2, 0.25, slam);
    headG.rotation.x = lerp(-0.15, 0.3, slam);
    eyeScale(1.3);
  }

  function aim(t) {
    const a = easeOut(clamp(t / 0.25, 0, 1));
    const sway = Math.sin(t * 7 + phase) * 0.012;
    if (cannonMesh) {
      armR.rotation.x = lerp(0.35, 1.5, a) + sway;
      armR.rotation.z = lerp(rest, 0.02, a);
      armL.rotation.x = 0.25 * a;
      armL.rotation.z = -rest - 0.5 * a;
      upper.rotation.x = -0.05 * a;
      headG.rotation.x = 0.1 * a;
    } else {
      armR.rotation.x = 1.3 * a;
      armL.rotation.x = 1.3 * a;
      upper.rotation.x = -0.08 * a;
    }
    eyeScale(1 + 0.2 * a);
  }

  function shoot(k) {
    const r = Math.exp(-k * 7);
    if (cannonMesh) {
      armR.rotation.x = 1.5 + 0.45 * r;
      armR.rotation.z = 0.02;
      cannonMesh.position.y = 0.18 * r;
      cannonGlow.scale.set(1 + 0.5 * r, 1, 1 + 0.5 * r);
      armL.rotation.x = 0.25;
      armL.rotation.z = -rest - 0.5;
      upper.rotation.x = 0.18 * r - 0.05;
      root.position.z = 0.1 * r;
      headG.rotation.x = 0.1 + 0.15 * r;
    } else {
      swing(k);
      return;
    }
    eyeScale(1.2 + 0.3 * r);
  }

  function hurt(t) {
    idle(t);
    const s = Math.max(0, 1 - t / 0.4);
    upper.rotation.x += 0.35 * s;
    upper.rotation.z += Math.sin(t * 38) * s * 0.1;
    root.position.z = 0.1 * s;
    headG.rotation.x = 0.4 * s;
    armL.rotation.x += 0.5 * s;
    armR.rotation.x += 0.5 * s;
    eyeScale(1 + 0.5 * s);
  }

  function dead(k) {
    // Topple backwards, bounce once, head pops off and rolls aside, eyes sputter out.
    const fall = easeIn(clamp(k / 0.7, 0, 1));
    const bounce = k > 0.7 ? Math.sin(clamp((k - 0.7) / 0.3, 0, 1) * Math.PI) * 0.06 : 0;
    const theta = fall * (Math.PI / 2);
    root.rotation.x = theta;
    root.rotation.z = 0.15 * fall;
    root.position.y = spec.bodyR * Math.sin(theta) + bounce;
    root.position.z = spec.bodyR * 0.4 * fall;
    const pop = smooth(clamp((k - 0.5) / 0.4, 0, 1));
    headG.position.x = (spec.radius * 0.9) * pop;
    headG.position.y = spec.neck - spec.hip - 0.2 * pop;
    headG.position.z = -spec.radius * 0.3 * pop;
    headG.rotation.z = -0.8 * pop;
    headG.rotation.y = 0.6 * pop;
    upper.rotation.z = 0.2 * fall;
    armL.rotation.x = 0.4 * fall;
    armR.rotation.x = -0.3 * fall;
    armL.rotation.z = -rest - 1.1 * fall;
    armR.rotation.z = rest + 1.0 * fall;
    legL.rotation.x = 0.5 * fall;
    legR.rotation.x = -0.3 * fall;
    legR.rotation.z = 0.3 * fall;
    const on = k < 0.12 || (k < 0.5 && Math.sin(k * 90) > 0);
    for (const e of eyes) e.visible = on;
    if (earGlow) earGlow.visible = on;
  }

  function setPose(state, t, k) {
    t = Math.max(0, num(t, 0));
    k = clamp(num(k, 0), 0, 1);
    reset();
    if (earGlow) earGlow.visible = true;
    switch (state) {
      case 'walk': walk(t); break;
      case 'windup': windup(k); break;
      case 'swing': swing(k); break;
      case 'aim': aim(t); break;
      case 'shoot': shoot(k); break;
      case 'hurt': hurt(t); break;
      case 'dead': dead(k); break;
      default: idle(t);
    }
  }

  function flash(on) {
    for (const m of meshes) m.material = on ? white : m.userData.base;
  }

  setPose('idle', 0, 0);
  return {
    group, height: spec.height, radius: spec.radius, headY: spec.headY, eyes, setPose, flash,
    muzzle, // wray only: the cannon tip, for spawning shots (getWorldPosition)
  };
}

// ---------------------------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------------------------

const GUN_EMISSIVE = 0x1a1612;
// Plinth ring colour per weapon, and the colour of each gun's small indicator lamp.
const WEAPON_COLOUR = { pistol: COLOURS.cyan, shotgun: COLOURS.amber, smg: 0xa77bff, launcher: COLOURS.magenta };
const HALF = Math.PI / 2;
const WOOD = 0x6b4a2c;
const TAPE = 0x8a8678;
const BRASS = 0x8a6a30;
const PAPER = 0x2a2420; // speaker cone

// Parts are [geometry, hex, pos, rot, scale]. 'body' is lit, 'glow' is just the indicator lamp,
// 'pump' (shotgun) can slide.
const WEAPON_PARTS = {
  pistol() {
    const rake = [-0.2, 0, 0];
    return {
      muzzle: [0, 0.045, -0.4],
      body: [
        [box(0.062, 0.075, 0.38), 0x5a5d62, [0, 0.045, -0.15]],
        [box(0.052, 0.04, 0.2), 0x2a2b2e, [0, 0.0, -0.08]],
        [cyl(0.02, 0.048, 0.06), PAPER, [0, 0.045, -0.37], [HALF, 0, 0]],
        [ring(0.049, 0.007), CHROME, [0, 0.045, -0.4]],
        [box(0.062, 0.17, 0.078), 0x161616, [0, -0.085, 0.03], rake],
        ...[-0.05, 0, 0.05].map((d) => [box(0.067, 0.014, 0.083), TAPE, [0, -0.085 + d, 0.03 - 0.2 * d], rake]),
        [box(0.024, 0.03, 0.05), 0x2a2b2e, [0, 0.0, -0.01]],
        [box(0.03, 0.03, 0.02), 0x3a3d42, [0, 0.095, 0.03]],
        [box(0.012, 0.02, 0.012), 0x3a3d42, [0, 0.092, -0.3]],
      ],
      glow: [[ball(0.011, 6, 5), WEAPON_COLOUR.pistol, [0, 0.086, 0.0]]],
    };
  },
  shotgun() {
    return {
      muzzle: [0, 0.05, -0.6],
      body: [
        [box(0.078, 0.1, 0.22), 0x3d4046, [0, 0.03, 0]],
        [cyl(0.036, 0.036, 0.5), 0x55585e, [0, 0.05, -0.3], [HALF, 0, 0]],
        [cyl(0.028, 0.028, 0.4), 0x3a3d42, [0, 0.0, -0.27], [HALF, 0, 0]],
        [box(0.058, 0.09, 0.14), WOOD, [0, 0.0, 0.17], [0.12, 0, 0]],
        [box(0.056, 0.14, 0.062), WOOD, [0, -0.08, 0.06], [-0.25, 0, 0]],
        [cyl(0.04, 0.1, 0.07), PAPER, [0, 0.05, -0.545], [HALF, 0, 0]],
        [cyl(0.044, 0.044, 0.03), 0x3a3d42, [0, 0.05, -0.5], [HALF, 0, 0]],
        [ring(0.1, 0.009), CHROME, [0, 0.05, -0.582]],
        [cyl(0.039, 0.039, 0.016), BRASS, [0, 0.05, -0.42], [HALF, 0, 0]],
        [cyl(0.039, 0.039, 0.016), BRASS, [0, 0.05, -0.2], [HALF, 0, 0]],
        [box(0.08, 0.03, 0.06), 0x6b3a1c, [0, 0.085, 0.0]],
      ],
      pump: [[box(0.088, 0.066, 0.16), WOOD, [0, -0.02, -0.28]]],
      glow: [[ball(0.012, 6, 5), WEAPON_COLOUR.shotgun, [0.03, 0.084, 0.07]]],
    };
  },
  smg() {
    const sides = [-1, 1];
    const rake = [-0.25, 0, 0];
    return {
      muzzle: [0, 0.035, -0.53],
      body: [
        [box(0.056, 0.085, 0.34), 0x34373c, [0, 0.03, -0.08]],
        [box(0.03, 0.02, 0.3), 0x202225, [0, 0.083, -0.08]],
        [box(0.042, 0.05, 0.14), 0x4a4d52, [0, 0.035, -0.32]],
        [cyl(0.014, 0.014, 0.14), 0x55585e, [0, 0.035, -0.44], [HALF, 0, 0]],
        [ball(0.028, 8, 5), PAPER, [0, 0.035, -0.505], [0, 0, 0], [1, 1, 0.6]],
        [ring(0.03, 0.005), CHROME, [0, 0.035, -0.5]],
        [box(0.037, 0.25, 0.052), 0x1a1a1a, [0, -0.145, -0.1], [0.15, 0, 0]],
        [box(0.05, 0.13, 0.056), 0x161616, [0, -0.08, 0.05], rake],
        ...[-0.04, 0.01, 0.06].map((d) => [box(0.054, 0.012, 0.06), TAPE, [0, -0.08 + d, 0.05 - 0.25 * d], rake]),
        [box(0.03, 0.04, 0.12), 0x55585e, [0, 0.03, 0.15]],
        // a small side-mounted speaker: paper cone, chrome ring and three grille bars
        ...sides.map((s) => [cyl(0.034, 0.034, 0.008), PAPER, [s * 0.029, 0.03, -0.13], [0, 0, HALF]]),
        ...sides.map((s) => [ring(0.034, 0.005, 12), CHROME, [s * 0.032, 0.03, -0.13], [0, HALF, 0]]),
        ...sides.flatMap((s) => [-0.012, 0, 0.012].map((z) => [box(0.004, 0.056, 0.003), CHROME, [s * 0.034, 0.03, -0.13 + z]])),
      ],
      glow: [[ball(0.011, 6, 5), WEAPON_COLOUR.smg, [0, 0.096, 0.07]]],
    };
  },
  launcher() {
    const rake = [-0.2, 0, 0];
    return {
      muzzle: [0, 0.03, -0.63],
      body: [
        [cyl(0.075, 0.075, 0.5), 0x4a4d52, [0, 0.03, -0.2], [HALF, 0, 0]],
        [cyl(0.086, 0.074, 0.06), 0x2a2b2e, [0, 0.03, 0.08], [HALF, 0, 0]],
        [cyl(0.074, 0.17, 0.16), PAPER, [0, 0.03, -0.52], [HALF, 0, 0]],
        [ring(0.168, 0.012), CHROME, [0, 0.03, -0.6]],
        ...[-0.05, -0.2, -0.33].map((z) => [cyl(0.083, 0.083, 0.016), BRASS, [0, 0.03, z], [HALF, 0, 0]]),
        [box(0.056, 0.15, 0.066), WOOD, [0, -0.1, 0.03], rake],
        ...[-0.04, 0.01, 0.06].map((d) => [box(0.06, 0.012, 0.07), TAPE, [0, -0.1 + d, 0.03 - 0.2 * d], rake]),
        [box(0.042, 0.1, 0.042), 0x161616, [0, -0.1, -0.22]],
        [box(0.022, 0.05, 0.04), 0x3a3d42, [0, 0.12, -0.1]],
        [box(0.06, 0.05, 0.12), 0x6b3a1c, [0.07, 0.04, -0.27]],
      ],
      glow: [[ball(0.012, 6, 5), WEAPON_COLOUR.launcher, [0, 0.152, -0.1]]],
    };
  },
};

export function makeWeaponModel(id) {
  const build = WEAPON_PARTS[id];
  if (!build) throw new Error(`makeWeaponModel: unknown weapon "${id}"`);
  const parts = once(`weapon:${id}`, () => {
    const p = build();
    return {
      muzzle: p.muzzle,
      body: merge(p.body),
      glow: merge(p.glow, [0, 0, 0], 0),
      pump: p.pump ? merge(p.pump) : null,
    };
  });
  const g = new THREE.Group();
  g.name = `weapon-${id}`;
  const body = new THREE.Mesh(parts.body, litMat('weapon', GUN_EMISSIVE));
  body.name = 'body';
  const glow = new THREE.Mesh(parts.glow, glowMat());
  glow.name = 'glow'; // the small indicator lamp
  g.add(body, glow);
  if (parts.pump) {
    const pump = new THREE.Mesh(parts.pump, litMat('weapon', GUN_EMISSIVE));
    pump.name = 'pump'; // slides along z for the pump action
    g.add(pump);
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(...parts.muzzle);
  g.add(muzzle);
  return g;
}

// A plain glowing ring on the floor so pickups can be found in a dark room.
function plinth(colour) {
  const g = new THREE.Group();
  const ringGeo = once('plinth:ring', () => new THREE.TorusGeometry(0.4, 0.03, 5, 24));
  const rim = new THREE.Mesh(ringGeo, flatGlow(colour));
  rim.rotation.x = HALF;
  rim.position.y = 0.03;
  g.add(rim);
  return g;
}

const PICKUP_SCALE = { pistol: 2.4, shotgun: 1.9, smg: 2.0, launcher: 1.8 };

export function makeWeaponPickup(id) {
  const g = new THREE.Group();
  g.name = `pickup-${id}`;
  g.add(plinth(WEAPON_COLOUR[id] ?? COLOURS.cyan));
  const item = new THREE.Group();
  item.name = 'item';
  const model = makeWeaponModel(id);
  // Pickups sit in a dim room, so lift the metal a little with a separate material.
  model.traverse((o) => { if (o.isMesh && o.material === litMat('weapon', GUN_EMISSIVE)) o.material = litMat('weaponPickup', 0x2e2820); });
  // Centre the model on its own bounding box so it spins about its middle.
  const bb = new THREE.Box3().setFromObject(model);
  const c = bb.getCenter(new THREE.Vector3());
  model.position.set(-c.x, -c.y, -c.z);
  item.add(model);
  item.scale.setScalar(PICKUP_SCALE[id] ?? 1.8);
  item.position.y = 0.95;
  g.add(item);
  return g;
}

export function makeHealthPickup() {
  const g = new THREE.Group();
  g.name = 'pickup-health';
  g.add(plinth(0xff3030));
  // A dented first-aid tin with a painted cross.
  const red = 0xa81c1c;
  const kitGeo = once('medkit:body', () => merge([
    [box(0.54, 0.38, 0.2), 0xcfc9b8, [0, 0, 0]],
    [box(0.56, 0.03, 0.22), 0x8a8678, [0, 0.0, 0]],
    [box(0.22, 0.05, 0.06), 0x3a3d42, [0, 0.215, 0]],
    [box(0.04, 0.06, 0.06), 0x3a3d42, [-0.1, 0.19, 0]],
    [box(0.04, 0.06, 0.06), 0x3a3d42, [0.1, 0.19, 0]],
    [box(0.06, 0.4, 0.22), 0x55585e, [-0.28, 0, 0]],
    [box(0.06, 0.4, 0.22), 0x55585e, [0.28, 0, 0]],
    [box(0.22, 0.07, 0.012), red, [0, 0.03, -0.106]],
    [box(0.07, 0.22, 0.012), red, [0, 0.03, -0.106]],
    [box(0.22, 0.07, 0.012), red, [0, 0.03, 0.106]],
    [box(0.07, 0.22, 0.012), red, [0, 0.03, 0.106]],
    [box(0.05, 0.08, 0.02), CHROME, [-0.12, 0.02, -0.11]],
    [box(0.05, 0.08, 0.02), CHROME, [0.12, 0.02, -0.11]],
    [box(0.16, 0.12, 0.012), 0x6b3a1c, [0.1, -0.1, 0.108]],
  ]));
  const kit = new THREE.Mesh(kitGeo, litMat('weaponPickup', 0x2e2820));
  kit.position.y = 0.62;
  g.add(kit);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Projectiles and effects
// ---------------------------------------------------------------------------------------------

export function makeProjectile(kind) {
  const g = new THREE.Group();
  g.name = `projectile-${kind}`;
  if (kind === 'rocket') {
    // Unlit so it stays visible in the dark: a scuffed tube with a small speaker cone for a tail.
    const geo = once('proj:rocket', () => merge([
      [cyl(0.045, 0.045, 0.28), 0x8a8d90, [0, 0, 0.0], [HALF, 0, 0]],
      [cone(0.048, 0.14), 0x8a2a20, [0, 0, -0.21], [-HALF, 0, 0]],
      [cyl(0.047, 0.047, 0.03), CHROME, [0, 0, -0.06], [HALF, 0, 0]],
      [box(0.1, 0.012, 0.07), 0x6b3a1c, [0, 0, 0.12]],
      [box(0.012, 0.1, 0.07), 0x6b3a1c, [0, 0, 0.12]],
      [cyl(0.02, 0.055, 0.05), PAPER, [0, 0, 0.17], [HALF, 0, 0]],
    ]));
    const body = new THREE.Mesh(geo, glowMat());
    const trailGeo = once('proj:trail', () => new THREE.ConeGeometry(0.05, 0.36, 8, 1, true));
    const trail = new THREE.Mesh(trailGeo, addMat(0xffa030, 0.5));
    trail.rotation.x = HALF;
    trail.position.z = 0.34;
    g.add(body, trail);
    return g;
  }
  // 'bottle': a glass bottle with a burning rag in the neck. Axis along y inside a 'spin' child, so
  // rotating spin about x tumbles it end over end.
  const spin = new THREE.Group();
  spin.name = 'spin';
  const geo = once('proj:bottle', () => merge([
    [cyl(0.06, 0.06, 0.16), 0xc47a20, [0, -0.04, 0]],
    [cyl(0.026, 0.06, 0.05), 0xc47a20, [0, 0.065, 0]],
    [cyl(0.026, 0.026, 0.06), 0xd89a3a, [0, 0.12, 0]],
    [cyl(0.014, 0.01, 0.05), 0xd8d0b0, [0, 0.175, 0]],
    [cone(0.032, 0.09), 0xffa030, [0, 0.25, 0]],
    [cyl(0.062, 0.062, 0.05), 0xe8dcc0, [0, -0.04, 0]],
  ], [0, 0, 0], 0.08));
  spin.add(new THREE.Mesh(geo, glowMat()));
  const halo = new THREE.Mesh(once('proj:halo', () => ball(0.12, 8, 6)), addMat(0xff8a2a, 0.1));
  g.add(spin, halo);
  return g;
}

// Effect materials are cloned per instance so the integrator can fade each one by opacity.
function fxMat(hex, opacity) {
  return new THREE.MeshBasicMaterial({
    color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
}

export function makeMuzzleFlash() {
  const g = new THREE.Group();
  g.name = 'muzzle-flash';
  const star = once('fx:star', () => merge([
    [starShape(8, 0.15, 0.045), 0xffffff],
    [starShape(5, 0.1, 0.03), 0xffffff, [0, 0, 0.001], [0, 0, 0.3]],
  ]));
  const core = once('fx:flash-core', () => starShape(6, 0.07, 0.03));
  const cone = once('fx:flash-cone', () => new THREE.ConeGeometry(0.08, 0.3, 8, 1, true));
  const a = new THREE.Mesh(star, fxMat(0xffe9a0, 0.95));
  const b = new THREE.Mesh(core, fxMat(0xffffff, 1));
  b.position.z = 0.002;
  const c = new THREE.Mesh(cone, fxMat(0xffb347, 0.7));
  c.rotation.x = -HALF; // tip forward (-z), base at the muzzle
  c.position.z = -0.15;
  g.add(a, b, c);
  return g;
}

export function makeImpact() {
  const g = new THREE.Group();
  g.name = 'impact';
  const geo = once('fx:impact', () => merge([
    [starShape(6, 0.11, 0.025), 0xffffff],
    [starShape(6, 0.11, 0.025), 0xffffff, [0, 0, 0], [0, HALF, 0.3]],
    [starShape(6, 0.11, 0.025), 0xffffff, [0, 0, 0], [HALF, 0, 0.6]],
  ]));
  g.add(new THREE.Mesh(geo, fxMat(0xfff2b0, 1)));
  return g;
}
