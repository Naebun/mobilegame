// Procedural models for the first-person game: robots, weapons, drinks, pickups, projectiles and effects.
// Pure three.js geometry and baked vertex data (PBR colour, roughness and metalness per vertex), no images and no
// DOM, so it also runs under plain Node. Everything faces -z at yaw 0. Geometry and materials live in
// module-level caches and are shared. Glowing parts use HDR colours (above 1) so the post pass blooms them.
import * as THREE from '../vendor/three.module.min.js';
import { COLOURS } from './consts.js';
import { DRINK_MESHES } from './drink-meshes.js';

const cache = new Map();
function once(key, make) {
  let v = cache.get(key);
  if (v === undefined) {
    v = make();
    cache.set(key, v);
  }
  return v;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------
// Smooth, bevelled geometry and the baking pass (PBR vertex data)
// ---------------------------------------------------------------------------------------------

const HALF = Math.PI / 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;
const smooth = (t) => t * t * (3 - 2 * t);
const sstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));

// Rounded box: a cube grid whose vertices are pushed onto a rounded shape, with smooth normals.
// `fine` adds extra rings across each bevel for the hero parts.
function rbox(w, h, d, r = 0.03, fine = false, grid = null) {
  const a = [w / 2, h / 2, d / 2];
  const sharp = r < 0.006 || (Math.min(a[0], a[1], a[2]) < 0.03 && r < 0.02); // thin parts are plain boxes: 12 triangles
  r = sharp ? 0 : Math.min(r, Math.min(a[0], a[1], a[2]) * 0.98);
  const ticks = a.map((x, ax) => {
    if (sharp) return [-x, x];
    if (grid && grid[ax] > 1) {
      // extra rings between the bevels, so big flat panels can take dents
      const n = grid[ax];
      return [-x, -x + r, ...Array.from({ length: n - 1 }, (_, i) => -x + r + ((2 * (x - r)) * (i + 1)) / n), x - r, x];
    }
    return fine ? [-x, -x + r * 0.4, -x + r, x - r, x - r * 0.4, x] : [-x, -x + r, x - r, x];
  });
  const pos = [];
  const nor = [];
  const edge = [];
  const idx = [];
  let base = 0;
  for (let k = 0; k < 3; k++) {
    const i = (k + 1) % 3;
    const j = (k + 2) % 3;
    const ti = ticks[i];
    const tj = ticks[j];
    for (const s of [1, -1]) {
      for (let n = 0; n < tj.length; n++) {
        for (let m = 0; m < ti.length; m++) {
          const p = [0, 0, 0];
          p[k] = s * a[k];
          p[i] = ti[m];
          p[j] = tj[n];
          if (sharp) {
            pos.push(p[0], p[1], p[2]);
            const nn = [0, 0, 0];
            nn[k] = s;
            nor.push(nn[0], nn[1], nn[2]);
            edge.push(0);
            continue;
          }
          const q = [clamp(p[0], -a[0] + r, a[0] - r), clamp(p[1], -a[1] + r, a[1] - r), clamp(p[2], -a[2] + r, a[2] - r)];
          const dx = p[0] - q[0];
          const dy = p[1] - q[1];
          const dz = p[2] - q[2];
          const l = Math.hypot(dx, dy, dz) || 1;
          const nn = [dx / l, dy / l, dz / l];
          pos.push(q[0] + nn[0] * r, q[1] + nn[1] * r, q[2] + nn[2] * r);
          nor.push(nn[0], nn[1], nn[2]);
          edge.push(1 - Math.abs(nn[k]));
        }
      }
      const W = ti.length;
      for (let n = 0; n < tj.length - 1; n++) {
        for (let m = 0; m < W - 1; m++) {
          const a0 = base + n * W + m;
          const b = a0 + 1;
          const c = a0 + W;
          const e = c + 1;
          if (s > 0) idx.push(a0, b, e, a0, e, c);
          else idx.push(a0, e, b, a0, c, e);
        }
      }
      base += W * tj.length;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  return g;
}

// Edge amount for lathe parts: how far the surface normal leans away from flat or straight-sided.
function withEdge(g) {
  const n = g.attributes.normal;
  const e = new Float32Array(n.count);
  for (let i = 0; i < n.count; i++) e[i] = 1 - Math.max(Math.abs(n.getY(i)), Math.hypot(n.getX(i), n.getZ(i)));
  g.setAttribute('edge', new THREE.BufferAttribute(e, 1));
  return g;
}

const v2 = (x, y) => new THREE.Vector2(x, y);
const lathe = (pts, seg = 20) => withEdge(new THREE.LatheGeometry(pts.map(([x, y]) => v2(x, y)), seg));

// Rounded cylinder (bevelled rims), axis y, centred. `hs` adds rings along the side for dents.
function rcyl(rt, rb, h, r = 0.02, seg = 20, hs = 1) {
  r = Math.min(r, Math.min(rt, rb) * 0.95, h * 0.48);
  seg = Math.min(seg, Math.max(10, Math.round(Math.max(rt, rb) * 38)));
  const pts = [[0, -h / 2]];
  const N = r > 0.03 ? 2 : 1;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * HALF;
    pts.push([rb - r + r * Math.sin(t), -h / 2 + r - r * Math.cos(t)]);
  }
  for (let i = 1; i < hs; i++) {
    const f = i / hs;
    const y = -h / 2 + r + f * (h - 2 * r);
    pts.push([lerp(rb, rt, (y + h / 2) / h), y]);
  }
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * HALF;
    pts.push([rt - r + r * Math.cos(t), h / 2 - r + r * Math.sin(t)]);
  }
  pts.push([0, h / 2]);
  return lathe(pts, seg);
}

const ball = (r, ws = 10, hs = 6) => withEdge(new THREE.SphereGeometry(r, Math.min(ws, r < 0.03 ? 7 : 10), Math.min(hs, r < 0.03 ? 4 : 6)));
const torus = (r, tube, seg = 16, rad = 6) => new THREE.TorusGeometry(r, tube, tube < 0.012 ? 3 : 4, clamp(Math.round(r * 56), 8, seg));
const capsule = (r, len, seg = 10) => new THREE.CapsuleGeometry(r, len, 2, r < 0.03 ? 6 : 8);
const cone = (r, h, seg = 10, open = false) => new THREE.ConeGeometry(r, h, seg, 1, open);
const tube = (pts, radius, segs = 24, rad = 6) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))), Math.max(6, Math.round(segs * 0.45)), radius, radius < 0.02 ? 4 : 5, false);

// Push a dent into a part (local space): vertices move against their normal near `c`, normals are rebuilt
// by position so lathe seams stay smooth, and the dent is darkened a little in the 'ao' attribute.
function dent(g, dents, dir = null) {
  const P = g.attributes.position;
  const N = g.attributes.normal;
  const ao = g.attributes.ao ? g.attributes.ao.array : new Float32Array(P.count).fill(1);
  for (let i = 0; i < P.count; i++) {
    for (const [cx, cy, cz, rad, depth] of dents) {
      const d = Math.hypot(P.getX(i) - cx, P.getY(i) - cy, P.getZ(i) - cz);
      if (d >= rad) continue;
      const f = Math.pow(Math.cos((d / rad) * HALF), 2);
      // `dir` pushes the whole sheet one way (a dent in a panel), otherwise each vertex moves against its normal
      if (dir) P.setXYZ(i, P.getX(i) + dir[0] * depth * f, P.getY(i) + dir[1] * depth * f, P.getZ(i) + dir[2] * depth * f);
      else P.setXYZ(i, P.getX(i) - N.getX(i) * depth * f, P.getY(i) - N.getY(i) * depth * f, P.getZ(i) - N.getZ(i) * depth * f);
      ao[i] = Math.min(ao[i], 1 - 0.35 * f);
    }
  }
  g.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
  weldNormals(g);
  return g;
}

function weldNormals(g) {
  const P = g.attributes.position;
  const idx = g.index.array;
  const acc = new Map();
  const key = (i) => `${Math.round(P.getX(i) * 2000)},${Math.round(P.getY(i) * 2000)},${Math.round(P.getZ(i) * 2000)}`;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    a.fromBufferAttribute(P, idx[t]);
    b.fromBufferAttribute(P, idx[t + 1]);
    c.fromBufferAttribute(P, idx[t + 2]);
    const n = b.sub(a).cross(c.sub(a)); // area weighted
    for (let k = 0; k < 3; k++) {
      const kk = key(idx[t + k]);
      const v = acc.get(kk) || [0, 0, 0];
      v[0] += n.x;
      v[1] += n.y;
      v[2] += n.z;
      acc.set(kk, v);
    }
  }
  const N = g.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    const v = acc.get(key(i));
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    N.setXYZ(i, v[0] / l, v[1] / l, v[2] / l);
  }
}

// Surface types: roughness, metalness, whether paint wear applies. Stored per vertex and read by the shared material.
const SURF = {
  paint: { r: 0.5, m: 0.22, paint: true },
  gloss: { r: 0.3, m: 0.12, paint: true },
  metal: { r: 0.4, m: 0.88 },
  chrome: { r: 0.2, m: 1 },
  brass: { r: 0.34, m: 1 },
  rubber: { r: 0.93, m: 0 },
  plastic: { r: 0.35, m: 0 },
  glass: { r: 0.08, m: 0 },
  cloth: { r: 0.9, m: 0 },
  silk: { r: 0.4, m: 0 },
  leather: { r: 0.5, m: 0 },
  wood: { r: 0.78, m: 0 },
  tape: { r: 0.72, m: 0 },
  paper: { r: 0.92, m: 0 },
};

const WEAR_COL = new THREE.Color(0xa59f93);
const GRIME = new THREE.Color(0x1c140e);
const RUST_A = new THREE.Color(0x7a3d1c);
const RUST_B = new THREE.Color(0x472210);

function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function vnoise(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const fz = smooth(z - zi);
  const l = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(l(0, 0, 0), l(1, 0, 0), fx), lerp(l(0, 1, 0), l(1, 1, 0), fx), fy),
    lerp(lerp(l(0, 0, 1), l(1, 0, 1), fx), lerp(l(0, 1, 1), l(1, 1, 1), fx), fy),
    fz,
  );
}

// A part: geometry, colour, surface type, position, rotation, scale and options { rust, wear }.
const P = (geo, hex, surf = 'paint', p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], o = {}) => ({
  geo, hex, surf, p, r, s, rust: o.rust || 0, wear: o.wear ?? 1,
});

const _nm = new THREE.Matrix3();
const _vv = new THREE.Vector3();
const _nn = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();

// Merge parts into one indexed geometry with baked vertex colour (albedo with scuffing, grime, edge wear and
// rust) and per-vertex roughness/metalness in `surf`. `originY` is the pivot's height above the floor.
function bake(parts, { base = [0, 0, 0], originY = base[1], seed = 0, tint = 0 } = {}) {
  const pos = [];
  const nor = [];
  const col = [];
  const surf = [];
  const idx = [];
  let off = 0;
  for (const o of parts) {
    const g = o.geo;
    const sd = SURF[o.surf];
    _e.set(o.r[0], o.r[1], o.r[2]);
    _q.setFromEuler(_e);
    _p.set(o.p[0] - base[0], o.p[1] - base[1], o.p[2] - base[2]);
    _s.set(o.s[0], o.s[1], o.s[2]);
    _m.compose(_p, _q, _s);
    _nm.getNormalMatrix(_m);
    const Pa = g.attributes.position;
    const Na = g.attributes.normal;
    const Ea = g.attributes.edge;
    const Aa = g.attributes.ao;
    const Va = g.attributes.vcol; // optional flat colour per vertex (tartan), replaces the part colour
    const c0 = new THREE.Color(o.hex);
    if (sd.paint && tint) c0.offsetHSL(0.004 * seed, 0, tint);
    for (let i = 0; i < Pa.count; i++) {
      _vv.fromBufferAttribute(Pa, i).applyMatrix4(_m);
      _nn.fromBufferAttribute(Na, i).applyMatrix3(_nm).normalize();
      pos.push(_vv.x, _vv.y, _vv.z);
      nor.push(_nn.x, _nn.y, _nn.z);
      const wy = _vv.y + originY;
      const n1 = vnoise(_vv.x * 5.3 + seed * 13.1, wy * 5.3, _vv.z * 5.3);
      const n2 = vnoise(_vv.x * 23 + seed * 7.7, wy * 23, _vv.z * 23);
      const st = vnoise(_vv.x * 9, wy * 1.7 + seed, _vv.z * 9);
      (Va ? _c.setRGB(Va.getX(i), Va.getY(i), Va.getZ(i)) : _c.copy(c0)).multiplyScalar(0.84 + 0.3 * n2);
      const yy = clamp(wy / 1.3, 0, 1);
      _c.multiplyScalar(0.72 + 0.28 * smooth(yy));
      _c.lerp(GRIME, (1 - yy) * 0.16);
      let rough = sd.r;
      let metal = sd.m;
      if (sd.paint) {
        const e = Ea ? Ea.getX(i) : 0;
        const w = sstep(0.1, 0.28, e + (n1 - 0.5) * 0.2) * o.wear;
        _c.lerp(WEAR_COL, w * 0.85);
        rough = lerp(rough, 0.38, w);
        metal = lerp(metal, 0.85, w);
      }
      if (o.rust > 0) {
        const t = sstep(1 - o.rust * 0.85, 1 - o.rust * 0.85 + 0.18, n1 * 0.65 + st * 0.45 + (1 - yy) * 0.14);
        _c2.copy(RUST_A).lerp(RUST_B, n2);
        _c.lerp(_c2, t);
        rough = lerp(rough, 0.92, t);
        metal = lerp(metal, 0.12, t);
      }
      if (Aa) _c.multiplyScalar(Aa.getX(i));
      col.push(_c.r, _c.g, _c.b);
      surf.push(rough, metal);
    }
    const ia = g.index.array;
    for (let t = 0; t < ia.length; t++) idx.push(ia[t] + off);
    off += Pa.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('surf', new THREE.Float32BufferAttribute(surf, 2));
  out.setIndex(idx);
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// A bolt head sticking out radially at angle `a` on a circle of radius `rad`.
const bolts = (n, rad, y, hex, size = 0.022, a0 = 0, span = Math.PI * 2) => {
  const g = once(`bolt:${size}`, () => withEdge(new THREE.CylinderGeometry(size, size, size * 0.9, 5, 1)));
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (n > 1 ? (i / (span === Math.PI * 2 ? n : n - 1)) * span : 0);
    return P(g, hex, 'metal', [Math.sin(a) * rad, y, Math.cos(a) * rad], [0, a + HALF, HALF]);
  });
};

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------

// One shared PBR material for everything that is baked: vertex colour is albedo, and the `surf` attribute
// overrides roughness and metalness per vertex (so a single draw can mix paint, chrome and rubber).
const pbrMat = () => once('pbr', () => {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 surf;\nvarying vec2 vSurf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = surf;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSurf;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vSurf.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vSurf.y;');
  };
  m.customProgramCacheKey = () => 'pbr-surf';
  return m;
});

const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const glowBasic = (hex, k, fog = true) => once(`glow:${hex}:${k}:${fog}`, () => new THREE.MeshBasicMaterial({ color: hdr(hex, k), fog }));
const whiteMat = () => once('white', () => new THREE.MeshBasicMaterial({ color: hdr(0xffffff, 1.6) }));
const addHdr = (hex, k, opacity) => once(`addh:${hex}:${k}:${opacity}`, () => new THREE.MeshBasicMaterial({
  color: hdr(hex, k), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
}));

// ---------------------------------------------------------------------------------------------
// Robots: geometry
// ---------------------------------------------------------------------------------------------

// Per-kind rig numbers. Positions are absolute heights above the feet; geometry is built relative to its pivot.
const SPEC = {
  fizzbang: {
    height: 2.1, radius: 0.55, headY: 1.62, hip: 0.45, neck: 1.62, bodyR: 0.5,
    legX: 0.26, shoulderX: 0.64, shoulderY: 1.38, wrist: -0.5,
    eye: 0xff5a22, eyeK: 2.6, lamp: [0.15, 1.355, -0.512, 0xffa030],
    walkRate: 6.5, bob: 0.05, stride: 0.75, eyeX: 0.17, eyeY: 1.84, eyeZ: -0.305, eyeTilt: 0.2,
    cannon: false, bothArms: false, hoseAt: [0, 1.52, 0.3],
  },
  bampot: {
    height: 2.0, radius: 0.5, headY: 1.5, hip: 0.42, neck: 1.5, bodyR: 0.47,
    legX: 0.22, shoulderX: 0.54, shoulderY: 1.05, wrist: 0,
    eye: 0x35e6ff, eyeK: 2.2, lamp: [0.26, 0.75, -0.485, 0xffa030],
    walkRate: 7.5, bob: 0.04, stride: 0.7, eyeX: 0.11, eyeY: 1.68, eyeZ: -0.235, eyeTilt: 0,
    cannon: true, bothArms: false, hoseAt: [0, 1.15, 0.3],
  },
  bouncer: {
    height: 3.3, radius: 0.95, headY: 2.62, hip: 0.8, neck: 2.62, bodyR: 0.82,
    legX: 0.42, shoulderX: 1.2, shoulderY: 2.35, wrist: -0.95,
    eye: 0xff2a2a, eyeK: 2.8, lamp: null,
    walkRate: 4.6, bob: 0.07, stride: 0.55, eyeX: 0.27, eyeY: 2.94, eyeZ: -0.44, eyeTilt: 0.18,
    cannon: false, bothArms: false, bothArms2: true, hoseAt: null,
  },
};
SPEC.bouncer.bothArms = true;

const C = {
  maroon: 0x7a2430, maroonD: 0x52181f, band: 0xb27d66, chrome: 0xc4c6c4, steel: 0x5d6269, steelD: 0x383c42,
  dark: 0x2a2021, rubber: 0x181818, brass: 0x9a7a34, grey: 0x52575d, cream: 0xd2c4a2, creamD: 0x8d8268,
  black: 0x1a1a1f, jacket: 0x202026, shirt: 0xcfc9b8, glass: 0x0a0b0d,
};

function fizzbangGeo(v) {
  const HIP = 0.45;
  const NECK = 1.62;
  const o = { seed: v, tint: [0, 0.05, -0.04][v] };
  const can = dent(rcyl(0.48, 0.48, 1.1, 0.06, 22, 5), [[0, 0.1, -0.48, 0.24, 0.05], [0.47, -0.2, -0.06, 0.2, 0.045], [-0.4, 0.28, -0.26, 0.2, 0.04]]);
  const btn = once('fz:btn', () => rcyl(0.03, 0.03, 0.03, 0.008, 12));
  const slat = once('fz:slat', () => rbox(0.05, 0.025, 0.22, 0.01));
  return {
    leg: bake([
      P(rcyl(0.125, 0.11, 0.34, 0.03, 16), C.steel, 'metal', [0, -0.18, 0], [0, 0, 0], [1, 1, 1], { rust: 0.2 }),
      P(torus(0.125, 0.03, 16, 6), C.rubber, 'rubber', [0, -0.1, 0], [HALF, 0, 0]),
      P(capsule(0.022, 0.2), C.chrome, 'chrome', [0, -0.18, 0.14]),
      P(rcyl(0.135, 0.135, 0.08, 0.03, 16), C.rubber, 'rubber', [0, -0.31, 0]),
      P(rbox(0.32, 0.14, 0.46, 0.05), C.rubber, 'rubber', [0, -0.38, -0.07]),
      P(rbox(0.3, 0.05, 0.3, 0.02), C.dark, 'paint', [0, -0.315, -0.12], [0, 0, 0], [1, 1, 1], { rust: 0.5 }),
    ], { originY: HIP, ...o }),
    torso: bake([
      P(rcyl(0.34, 0.4, 0.16, 0.04, 18), C.dark, 'paint', [0, 0.46, 0], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      P(can, C.maroon, 'paint', [0, 1.0, 0], [0, 0, 0], [1, 1, 1], { rust: 0.55 }),
      P(rcyl(0.51, 0.51, 0.09, 0.035, 26), C.chrome, 'chrome', [0, 0.52, 0], [0, 0, 0], [1, 1, 1], { rust: 0.2 }),
      P(rcyl(0.51, 0.51, 0.1, 0.035, 26), C.chrome, 'chrome', [0, 1.5, 0], [0, 0, 0], [1, 1, 1], { rust: 0.15 }),
      P(rcyl(0.4, 0.5, 0.08, 0.03, 26), C.chrome, 'chrome', [0, 1.58, 0]),
      P(rcyl(0.5, 0.5, 0.22, 0.02, 26), C.band, 'paint', [0, 1.0, 0], [0, 0, 0], [1, 1, 1], { rust: 0.35 }),
      P(rcyl(0.17, 0.2, 0.1, 0.03, 16), C.rubber, 'rubber', [0, 1.62, 0]),
      // vending-machine front
      P(rbox(0.46, 0.4, 0.1, 0.035), 0x2d2f33, 'paint', [0, 1.27, -0.45], [0, 0, 0], [1, 1, 1], { rust: 0.2 }),
      P(rbox(0.34, 0.15, 0.04, 0.02), C.glass, 'glass', [0, 1.35, -0.5]),
      P(rbox(0.15, 0.028, 0.03, 0.01), 0x050505, 'plastic', [0.1, 1.2, -0.5]),
      P(btn, 0xa02a22, 'plastic', [-0.17, 1.2, -0.5], [HALF, 0, 0]),
      P(btn, 0xc9a23a, 'plastic', [-0.1, 1.2, -0.5], [HALF, 0, 0]),
      P(btn, 0x4a7a52, 'plastic', [-0.03, 1.2, -0.5], [HALF, 0, 0]),
      P(rbox(0.34, 0.11, 0.07, 0.03), C.rubber, 'rubber', [0, 1.06, -0.48]),
      P(capsule(0.012, 0.2), C.chrome, 'chrome', [0, 1.06, -0.525], [0, 0, HALF]),
      // side vents, back exhaust pipe, bolts and waist hose
      ...[-1, 1].flatMap((s) => [1.2, 1.26, 1.32, 1.38].map((y) => P(slat, 0x1c1c1e, 'metal', [s * 0.487, y, 0.0]))),
      P(rcyl(0.06, 0.06, 0.85, 0.02, 12), C.steel, 'metal', [0.26, 1.0, 0.47], [0, 0, 0], [1, 1, 1], { rust: 0.4 }),
      P(rcyl(0.075, 0.075, 0.06, 0.02, 12), C.rubber, 'rubber', [0.26, 0.72, 0.47]),
      P(rcyl(0.075, 0.075, 0.06, 0.02, 12), C.rubber, 'rubber', [0.26, 1.25, 0.47]),
      P(rcyl(0.07, 0.07, 0.04, 0.015, 12), C.brass, 'brass', [0.26, 1.46, 0.47]),
      ...bolts(8, 0.515, 0.52, C.steelD, 0.02),
      ...bolts(8, 0.515, 1.5, C.steelD, 0.02),
      P(torus(0.5, 0.035, 28, 6), C.rubber, 'rubber', [0, 0.64, 0], [HALF, 0, 0]),
      P(rbox(0.08, 0.1, 0.09, 0.02), C.chrome, 'chrome', [0, 0.64, -0.52]),
    ], { base: [0, HIP, 0], ...o }),
    head: bake([
      P(rbox(0.72, 0.42, 0.58, 0.07, true), C.grey, 'paint', [0, 1.83, 0], [0, 0, 0], [1, 1, 1], { rust: 0.35 }),
      P(rbox(0.64, 0.18, 0.08, 0.04), C.glass, 'glass', [0, 1.85, -0.27]),
      P(rbox(0.3, 0.065, 0.08, 0.025), C.dark, 'paint', [-0.17, 1.97, -0.29], [0, 0, -0.28]),
      P(rbox(0.3, 0.065, 0.08, 0.025), C.dark, 'paint', [0.17, 1.97, -0.29], [0, 0, 0.28]),
      P(rbox(0.4, 0.08, 0.06, 0.02), 0x111113, 'plastic', [0, 1.68, -0.28]),
      ...[-0.12, -0.04, 0.04, 0.12].map((x) => P(rbox(0.05, 0.07, 0.03, 0.01), C.chrome, 'chrome', [x, 1.68, -0.305])),
      P(rcyl(0.075, 0.075, 0.12, 0.02, 14), C.chrome, 'chrome', [-0.4, 1.83, 0], [0, 0, HALF]),
      P(rcyl(0.075, 0.075, 0.12, 0.02, 14), C.chrome, 'chrome', [0.4, 1.83, 0], [0, 0, HALF]),
      P(torus(0.09, 0.022, 16, 6), C.chrome, 'chrome', [0, 2.07, 0.07], [HALF, 0, 0]),
      P(rbox(0.12, 0.025, 0.12, 0.01), C.chrome, 'chrome', [0, 2.04, -0.04]),
    ], { base: [0, NECK, 0], ...o }),
    eye: rbox(0.16, 0.085, 0.05, 0.03),
    lamp: ball(0.034, 10, 7),
    arm: bake([
      P(ball(0.17), C.chrome, 'chrome'),
      P(torus(0.16, 0.03, 16, 6), C.rubber, 'rubber', [0, -0.06, 0], [HALF, 0, 0]),
      P(rcyl(0.17, 0.16, 0.4, 0.05, 18), 0x484d55, 'metal', [0, -0.28, 0], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      P(rcyl(0.19, 0.19, 0.05, 0.02, 18), C.chrome, 'chrome', [0, -0.12, 0]),
      P(rcyl(0.19, 0.19, 0.05, 0.02, 18), C.chrome, 'chrome', [0, -0.44, 0]),
      ...bolts(6, 0.172, -0.28, C.steelD, 0.02),
      P(tube([[0.17, -0.1, 0.06], [0.24, -0.25, 0.09], [0.17, -0.44, 0.06]], 0.028, 14, 5), C.rubber, 'rubber'),
      P(rcyl(0.14, 0.14, 0.12, 0.03, 16), C.rubber, 'rubber', [0, -0.5, 0]),
    ], { originY: 1.38, ...o }),
    fist: bake([
      P(capsule(0.07, 0.14), C.chrome, 'chrome', [0, -0.1, 0]),
      P(rbox(0.46, 0.4, 0.46, 0.1, true), C.maroon, 'paint', [0, -0.34, 0], [0, 0, 0], [1, 1, 1], { rust: 0.35 }),
      P(rbox(0.46, 0.07, 0.07, 0.025), C.chrome, 'chrome', [0, -0.2, -0.235]),
      ...[-0.1, 0, 0.1].map((x) => P(rbox(0.022, 0.26, 0.03, 0.01), C.dark, 'paint', [x, -0.38, -0.225])),
      P(rbox(0.12, 0.14, 0.1, 0.04), C.maroon, 'paint', [0.255, -0.28, -0.08], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
    ], { originY: 0.88, ...o }),
    hose: bake([
      P(tube([[0, 0, 0], [-0.2, 0.06, 0.1], [-0.38, -0.14, 0.12], [-0.43, -0.5, 0.1], [-0.34, -0.85, 0.1]], 0.036, 28, 6), C.rubber, 'rubber'),
      P(rcyl(0.055, 0.055, 0.08, 0.02, 12), C.chrome, 'chrome', [0, 0, 0], [HALF, 0, 0]),
      P(rcyl(0.055, 0.055, 0.08, 0.02, 12), C.chrome, 'chrome', [-0.34, -0.85, 0.1]),
    ], { originY: 1.2, ...o }),
  };
}

function bottleProfile() {
  const pts = [[0, 0], [0.38, 0], [0.43, 0.02], [0.46, 0.08]];
  for (let y = 0.2; y < 0.62; y += 0.1) pts.push([0.46, y]);
  pts.push([0.46, 0.62]);
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    pts.push([lerp(0.46, 0.21, smooth(t)), 0.62 + t * 0.55]);
  }
  pts.push([0, 1.17]);
  return pts;
}

function bampotGeo(v) {
  const HIP = 0.42;
  const NECK = 1.5;
  const o = { seed: v, tint: [0, 0.04, -0.05][v] };
  const bottle = dent(lathe(bottleProfile(), 22), [[-0.2, 0.35, -0.46, 0.2, 0.05], [0.4, 0.5, -0.15, 0.17, 0.04], [-0.1, 0.9, -0.3, 0.13, 0.03]]);
  return {
    leg: bake([
      P(rcyl(0.1, 0.09, 0.3, 0.03, 14), C.steel, 'metal', [0, -0.16, 0]),
      P(torus(0.105, 0.025, 14, 6), C.rubber, 'rubber', [0, -0.08, 0], [HALF, 0, 0]),
      P(rcyl(0.115, 0.115, 0.07, 0.02, 14), C.rubber, 'rubber', [0, -0.27, 0]),
      P(rbox(0.28, 0.12, 0.42, 0.045), C.rubber, 'rubber', [0, -0.36, -0.06]),
    ], { originY: HIP, ...o }),
    torso: bake([
      P(rcyl(0.3, 0.36, 0.12, 0.03, 18), 0x1e1f24, 'paint', [0, 0.42, 0]),
      P(bottle, C.cream, 'gloss', [0, 0.37, 0], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      P(rcyl(0.47, 0.47, 0.34, 0.02, 28), 0x24252b, 'paint', [0, 0.75, 0], [0, 0, 0], [1, 1, 1], { rust: 0.25 }),
      P(torus(0.473, 0.012, 28, 5), C.brass, 'brass', [0, 0.58, 0], [HALF, 0, 0]),
      P(torus(0.473, 0.012, 28, 5), C.brass, 'brass', [0, 0.92, 0], [HALF, 0, 0]),
      P(rbox(0.3, 0.17, 0.03, 0.012, true), 0x8d8f8c, 'metal', [0, 0.75, -0.475], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      ...[[-0.12, 0.7], [0.12, 0.7], [-0.12, 0.8], [0.12, 0.8]].map(([x, y]) => P(ball(0.013, 6, 4), C.chrome, 'chrome', [x, y, -0.495])),
      P(torus(0.435, 0.03, 28, 6), C.rubber, 'rubber', [0, 1.12, 0], [HALF, 0, 0]),
      P(rcyl(0.1, 0.1, 0.5, 0.03, 14), C.steelD, 'metal', [0, 0.9, 0.47], [0, 0, 0], [1, 1, 1], { rust: 0.4 }),
      P(rcyl(0.04, 0.04, 0.08, 0.015, 10), C.chrome, 'chrome', [0, 1.19, 0.47]),
    ], { base: [0, HIP, 0], ...o }),
    head: bake([
      P(lathe([[0, 1.5], [0.22, 1.5], [0.205, 1.56], [0.2, 1.8], [0.222, 1.83], [0.222, 1.87], [0, 1.87]], 26), C.cream, 'gloss', [0, 0, 0], [0, 0, 0], [1, 1, 1], { rust: 0.2 }),
      P(rcyl(0.236, 0.236, 0.17, 0.03, 26), 0x1b1c20, 'plastic', [0, 1.68, 0]),
      ...[-1, 1].map((s) => P(torus(0.098, 0.014, 18, 5), C.steelD, 'metal', [s * 0.11, 1.68, -0.232])),
      ...[-1, 1].map((s) => P(rbox(0.2, 0.04, 0.07, 0.02), C.dark, 'paint', [s * 0.11, 1.785, -0.2], [0, 0, s * 0.25])),
    ], { base: [0, NECK, 0], ...o }),
    cap: bake([
      P(rcyl(0.29, 0.29, 0.11, 0.04, 26), C.brass, 'brass', [0, 0.05, 0], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      P(rcyl(0.3, 0.3, 0.04, 0.015, 26), C.brass, 'brass', [0, 0.0, 0]),
      P(rcyl(0.2, 0.29, 0.07, 0.03, 26), C.brass, 'brass', [0, 0.12, 0], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      P(torus(0.296, 0.012, 26, 5), C.steelD, 'metal', [0, 0.03, 0], [HALF, 0, 0]),
    ], { originY: 1.84, ...o }),
    eye: rcyl(0.085, 0.085, 0.035, 0.012, 16),
    lamp: ball(0.032, 10, 7),
    arm: bake([
      P(ball(0.1), C.steel, 'metal'),
      P(capsule(0.05, 0.4), C.steel, 'metal', [0, -0.3, 0], [0, 0, 0], [1, 1, 1], { rust: 0.2 }),
      P(torus(0.06, 0.02, 12, 5), C.rubber, 'rubber', [0, -0.18, 0], [HALF, 0, 0]),
      P(tube([[0.05, -0.08, 0.02], [0.1, -0.3, 0.07], [0.05, -0.55, 0.03]], 0.02, 12, 5), C.rubber, 'rubber'),
      P(rbox(0.14, 0.16, 0.14, 0.05), 0x1e1f24, 'rubber', [0, -0.64, 0]),
      P(capsule(0.025, 0.06), C.rubber, 'rubber', [-0.04, -0.75, -0.04]),
      P(capsule(0.025, 0.06), C.rubber, 'rubber', [0.04, -0.75, -0.04]),
    ], { originY: 1.05, ...o }),
    cannon: bake([
      P(ball(0.14), C.steel, 'metal'),
      P(rcyl(0.15, 0.15, 0.04, 0.012, 18), C.brass, 'brass', [0, -0.04, 0]),
      P(rcyl(0.125, 0.125, 0.34, 0.04, 18), C.steelD, 'metal', [0, -0.22, 0], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      ...[-0.1, -0.16, -0.22, -0.28].map((y) => P(torus(0.13, 0.014, 18, 5), C.brass, 'brass', [0, y, 0], [HALF, 0, 0])),
      ...[-1, 1].map((s) => P(rbox(0.03, 0.2, 0.05, 0.01), C.chrome, 'chrome', [s * 0.135, -0.22, 0])),
      P(tube([[0.1, -0.05, 0.1], [0.2, -0.25, 0.15], [0.12, -0.42, 0.08]], 0.025, 12, 5), C.rubber, 'rubber'),
    ], { originY: 1.05, ...o }),
    barrel: bake([
      P(rcyl(0.075, 0.075, 0.65, 0.02, 18, 3), 0x6a6e74, 'metal', [0, -0.675, 0], [0, 0, 0], [1, 1, 1], { rust: 0.15 }),
      P(rcyl(0.095, 0.095, 0.04, 0.012, 18), C.brass, 'brass', [0, -0.5, 0]),
      P(rcyl(0.095, 0.095, 0.04, 0.012, 18), C.brass, 'brass', [0, -0.82, 0]),
      ...[-0.62, -0.7, -0.78].flatMap((y) => [-1, 1].map((s) => P(rbox(0.03, 0.05, 0.02, 0.008), 0x0a0a0c, 'plastic', [s * 0.074, y, 0]))),
      P(rcyl(0.07, 0.135, 0.12, 0.025, 18), C.steelD, 'metal', [0, -0.99, 0]),
      P(torus(0.135, 0.013, 18, 5), C.brass, 'brass', [0, -1.05, 0], [HALF, 0, 0]),
      P(rcyl(0.1, 0.1, 0.01, 0.004, 16), 0x050505, 'plastic', [0, -1.055, 0]),
    ], { originY: 1.05, ...o }),
    tip: ball(0.03, 8, 6),
    hose: bake([
      P(tube([[0, 0, 0], [0.22, 0.05, 0.12], [0.36, -0.2, 0.14], [0.38, -0.55, 0.1]], 0.034, 24, 6), C.rubber, 'rubber'),
      P(rcyl(0.05, 0.05, 0.08, 0.02, 12), C.chrome, 'chrome', [0.38, -0.55, 0.1]),
    ], { originY: 1.15, ...o }),
  };
}

function bouncerGeo(v) {
  const HIP = 0.8;
  const NECK = 2.62;
  const o = { seed: v, tint: [0, 0.04, -0.04][v] };
  const skirt = dent(rcyl(0.82, 0.82, 0.95, 0.07, 24, 5), [[0, 0.0, -0.82, 0.3, 0.07], [-0.8, 0.1, -0.2, 0.25, 0.06], [0.78, -0.2, 0.2, 0.25, 0.05]]);
  return {
    leg: bake([
      P(rcyl(0.21, 0.19, 0.62, 0.05, 16, 2), C.black, 'cloth', [0, -0.33, 0]),
      P(rbox(0.48, 0.2, 0.72, 0.08, true), 0x0c0c10, 'leather', [0, -0.68, -0.1]),
      P(rbox(0.5, 0.05, 0.74, 0.02), C.rubber, 'rubber', [0, -0.77, -0.1]),
      P(rbox(0.3, 0.04, 0.2, 0.02), 0x2a2a30, 'gloss', [0, -0.59, -0.3]),
    ], { originY: HIP, ...o }),
    torso: bake([
      P(rcyl(0.55, 0.65, 0.2, 0.04, 20), 0x241819, 'paint', [0, 0.8, 0]),
      P(skirt, C.maroon, 'paint', [0, 1.17, 0], [0, 0, 0], [1, 1, 1], { rust: 0.45 }),
      P(rcyl(0.845, 0.845, 0.1, 0.035, 30), C.chrome, 'chrome', [0, 0.76, 0], [0, 0, 0], [1, 1, 1], { rust: 0.2 }),
      P(rcyl(0.835, 0.835, 0.3, 0.03, 30), C.band, 'paint', [0, 1.1, 0], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      ...bolts(10, 0.85, 0.77, C.steelD, 0.03),
      P(torus(0.84, 0.045, 30, 6), C.rubber, 'rubber', [0, 1.48, 0], [HALF, 0, 0]),
      // the dinner jacket
      P(rbox(1.72, 1.1, 1.25, 0.2, true), C.jacket, 'cloth', [0, 2.1, 0]),
      P(rbox(2.12, 0.42, 1.08, 0.17, true), 0x26262c, 'cloth', [0, 2.4, 0]),
      P(rbox(0.38, 0.92, 0.05, 0.02), C.shirt, 'cloth', [0, 2.07, -0.62]),
      P(rbox(0.24, 0.98, 0.07, 0.03), 0x34343c, 'silk', [-0.3, 2.07, -0.635], [0, 0, 0.2]),
      P(rbox(0.24, 0.98, 0.07, 0.03), 0x34343c, 'silk', [0.3, 2.07, -0.635], [0, 0, -0.2]),
      ...[1.85, 2.05].map((y) => P(ball(0.02, 6, 4), C.chrome, 'chrome', [0, y, -0.65])),
      P(cone(0.15, 0.32, 12), 0x7a1a28, 'silk', [-0.19, 2.47, -0.68], [0, 0, -HALF]),
      P(cone(0.15, 0.32, 12), 0x7a1a28, 'silk', [0.19, 2.47, -0.68], [0, 0, HALF]),
      P(rbox(0.1, 0.1, 0.08, 0.03), 0x5a1220, 'silk', [0, 2.47, -0.69]),
      P(rbox(0.12, 0.08, 0.03, 0.012), C.shirt, 'cloth', [0.55, 2.3, -0.64], [0, 0, 0.2]),
      P(rcyl(0.25, 0.3, 0.12, 0.03, 16), C.rubber, 'rubber', [0, 2.62, 0]),
    ], { base: [0, HIP, 0], ...o }),
    head: bake([
      P(rbox(1.12, 0.62, 0.84, 0.11, true), 0x555a60, 'paint', [0, 2.93, 0], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      P(rbox(1.0, 0.23, 0.1, 0.06, true), C.glass, 'glass', [0, 2.95, -0.395]),
      P(rbox(0.44, 0.1, 0.1, 0.04), C.dark, 'paint', [-0.27, 3.11, -0.4], [0, 0, -0.3]),
      P(rbox(0.44, 0.1, 0.1, 0.04), C.dark, 'paint', [0.27, 3.11, -0.4], [0, 0, 0.3]),
      P(rbox(0.62, 0.11, 0.07, 0.03), 0x111113, 'plastic', [0, 2.75, -0.4]),
      ...[-0.2, -0.07, 0.07].map((x) => P(rbox(0.08, 0.09, 0.04, 0.015), C.chrome, 'chrome', [x, 2.75, -0.44])),
      P(rbox(0.08, 0.09, 0.04, 0.015), C.brass, 'brass', [0.2, 2.75, -0.44]),
      P(rcyl(0.1, 0.1, 0.14, 0.03, 16), C.chrome, 'chrome', [-0.6, 2.9, 0], [0, 0, HALF]),
      P(rbox(0.1, 0.22, 0.15, 0.04), C.black, 'plastic', [0.6, 2.88, 0]),
      P(tube([[0.62, 2.78, 0.03], [0.7, 2.62, 0.1], [0.6, 2.5, 0.15], [0.62, 2.4, 0.1]], 0.014, 16, 5), C.rubber, 'rubber'),
      P(torus(0.15, 0.03, 18, 6), C.chrome, 'chrome', [0, 3.265, 0.1], [HALF, 0, 0]),
      P(rbox(0.2, 0.03, 0.2, 0.01), C.chrome, 'chrome', [0, 3.245, -0.05]),
    ], { base: [0, NECK, 0], ...o }),
    eye: rbox(0.28, 0.09, 0.05, 0.03),
    lamp: ball(0.055, 10, 7),
    arm: bake([
      P(ball(0.27, 14, 10), C.jacket, 'cloth'),
      P(rcyl(0.27, 0.31, 0.8, 0.07, 20, 2), C.jacket, 'cloth', [0, -0.5, 0]),
      P(rcyl(0.3, 0.3, 0.09, 0.025, 20), C.shirt, 'cloth', [0, -0.92, 0]),
      P(ball(0.03, 8, 5), C.brass, 'brass', [0.3, -0.92, 0]),
      P(ball(0.03, 8, 5), C.brass, 'brass', [-0.3, -0.92, 0]),
    ], { originY: 2.35, ...o }),
    fist: bake([
      P(capsule(0.1, 0.12), C.chrome, 'chrome', [0, -0.08, 0]),
      P(rbox(0.72, 0.62, 0.66, 0.15, true), C.maroon, 'paint', [0, -0.38, 0], [0, 0, 0], [1, 1, 1], { rust: 0.35 }),
      P(rbox(0.72, 0.1, 0.1, 0.04), C.chrome, 'chrome', [0, -0.2, -0.36]),
      ...[-0.15, 0, 0.15].map((x) => P(rbox(0.025, 0.4, 0.03, 0.01), C.dark, 'paint', [x, -0.45, -0.325])),
      P(rbox(0.2, 0.22, 0.18, 0.06), C.maroon, 'paint', [0.4, -0.3, -0.12], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      P(torus(0.1, 0.028, 16, 6), C.brass, 'brass', [-0.24, -0.38, -0.34], [0.2, 0, 0.1]),
    ], { originY: 1.4, ...o }),
  };
}

const ROBOT_GEO = { fizzbang: fizzbangGeo, bampot: bampotGeo, bouncer: bouncerGeo };
const VARIANTS = 3;

let robotCount = 0;

// ---------------------------------------------------------------------------------------------
// Robots: rig and animation
// ---------------------------------------------------------------------------------------------

const variantCount = {};

export function makeRobot(kind) {
  if (kind === 'shielded') return makeShielded();
  if (kind === 'tourguide') return makeTourGuide();
  const spec = SPEC[kind];
  if (!spec) throw new Error(`makeRobot: unknown kind "${kind}"`);
  const variant = (variantCount[kind] = (variantCount[kind] ?? -1) + 1) % VARIANTS;
  const geo = once(`robot:${kind}:${variant}`, () => ROBOT_GEO[kind](variant));
  const mat = pbrMat();
  const phase = (robotCount++) * 1.7;
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

  const legL = mk(geo.leg, mat, root, -spec.legX, spec.hip, 0);
  const legR = mk(geo.leg, mat, root, spec.legX, spec.hip, 0);

  const upper = new THREE.Group();
  upper.position.y = spec.hip;
  root.add(upper);
  mk(geo.torso, mat, upper);

  const headG = new THREE.Group();
  headG.position.y = spec.neck - spec.hip;
  upper.add(headG);
  mk(geo.head, mat, headG);

  // Eye and lamp materials are per robot so the integrator can tint them without touching the others.
  const eyeMat = new THREE.MeshBasicMaterial({ color: hdr(spec.eye, spec.eyeK), fog: false });
  const eyes = [-1, 1].map((side) => {
    const e = mk(geo.eye, eyeMat, headG, side * spec.eyeX, spec.eyeY - spec.neck, spec.eyeZ);
    if (kind === 'bampot') e.rotation.x = HALF;
    else e.rotation.z = -side * spec.eyeTilt;
    return e;
  });
  const lampMat = new THREE.MeshBasicMaterial({ color: hdr(spec.lamp ? spec.lamp[3] : COLOURS.cyan, 2.6), fog: false });
  let lamp = null;
  if (spec.lamp) lamp = mk(geo.lamp, lampMat, upper, spec.lamp[0], spec.lamp[1] - spec.hip, spec.lamp[2]);
  if (kind === 'bouncer') lamp = mk(geo.lamp, lampMat, headG, 0.66, 2.96 - spec.neck, -0.02);

  let cap = null;
  if (kind === 'bampot') cap = mk(geo.cap, mat, headG, 0, 1.84 - spec.neck, 0);

  let hose = null;
  if (spec.hoseAt) {
    hose = new THREE.Group();
    hose.position.set(spec.hoseAt[0], spec.hoseAt[1] - spec.hip, spec.hoseAt[2]);
    upper.add(hose);
    mk(geo.hose, mat, hose);
  }

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-spec.shoulderX, spec.shoulderY - spec.hip, 0);
  armR.position.set(spec.shoulderX, spec.shoulderY - spec.hip, 0);
  upper.add(armL, armR);
  mk(geo.arm, mat, armL);
  let fistL = null;
  let fistR = null;
  let cannonMesh = null;
  let barrelG = null;
  let tip = null;
  let cannonLamp = null;
  let muzzle = null;
  if (spec.cannon) {
    cannonMesh = new THREE.Group();
    armR.add(cannonMesh);
    mk(geo.cannon, mat, cannonMesh);
    barrelG = new THREE.Group();
    cannonMesh.add(barrelG);
    mk(geo.barrel, mat, barrelG);
    tip = mk(geo.tip, glowBasic(0x35e6ff, 5, false), barrelG, 0, -1.07, 0);
    cannonLamp = mk(geo.lamp, glowBasic(0x35e6ff, 4, false), cannonMesh, 0, -0.22, -0.13);
    muzzle = new THREE.Object3D();
    muzzle.name = 'muzzle';
    muzzle.position.set(0, -1.1, 0);
    barrelG.add(muzzle);
  } else {
    mk(geo.arm, mat, armR);
    fistL = mk(geo.fist, mat, armL, 0, spec.wrist, 0);
    fistR = mk(geo.fist, mat, armR, 0, spec.wrist, 0);
  }

  const rest = spec.bothArms ? 0.16 : 0.1;
  const white = whiteMat();
  const wr = spec.wrist;

  function reset() {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    legL.rotation.set(0, 0, 0);
    legR.rotation.set(0, 0, 0);
    upper.position.set(0, spec.hip, 0);
    upper.rotation.set(0, 0, 0);
    upper.scale.set(1, 1, 1);
    headG.position.set(0, spec.neck - spec.hip, 0);
    headG.rotation.set(0, 0, 0);
    armL.rotation.set(0, 0, -rest);
    armR.rotation.set(0, 0, rest);
    if (fistL) {
      fistL.position.set(0, wr, 0);
      fistR.position.set(0, wr, 0);
    }
    if (hose) hose.rotation.set(0, 0, 0);
    if (cap) {
      cap.position.set(0, 1.84 - spec.neck, 0);
      cap.rotation.set(0, 0, 0);
    }
    if (cannonMesh) {
      cannonMesh.position.set(0, 0, 0);
      barrelG.position.set(0, 0, 0);
      tip.scale.setScalar(1);
    }
    for (const e of eyes) {
      e.visible = true;
      e.scale.set(1, 1, 1);
    }
    if (lamp) lamp.visible = true;
  }

  const eyeScale = (s) => {
    for (const e of eyes) e.scale.set(s, s, 1);
  };
  const fists = (l, r) => {
    if (fistL) {
      fistL.position.y = wr + l;
      fistR.position.y = wr + r;
    }
  };

  function idle(t) {
    const s = t + phase;
    upper.scale.y = 1 + 0.012 * Math.sin(s * 2.2);
    upper.scale.x = upper.scale.z = 1 - 0.005 * Math.sin(s * 2.2);
    upper.rotation.z = 0.025 * Math.sin(s * 1.1);
    upper.rotation.x = 0.02 * Math.sin(s * 0.9 + 1);
    armL.rotation.x = 0.06 * Math.sin(s * 1.7);
    if (cannonMesh) armR.rotation.x = 0.35 + 0.04 * Math.sin(s * 1.7 + 1.5);
    else armR.rotation.x = 0.06 * Math.sin(s * 1.7 + 1.5);
    fists(0.012 * Math.sin(s * 2.6), 0.012 * Math.sin(s * 2.6 + 2));
    headG.rotation.y = 0.14 * Math.sin(s * 0.7);
    headG.rotation.x = 0.02 * Math.sin(s * 1.3);
    if (hose) hose.rotation.set(0.05 * Math.sin(s * 1.3 + 1), 0, 0.07 * Math.sin(s * 1.9));
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
    upper.rotation.x = -0.08 + 0.02 * Math.cos(c * 2);
    headG.rotation.y = -sL * 0.05;
    headG.rotation.x = 0.04 - 0.03 * Math.cos(c * 2);
    fists(0.02 * Math.cos(c), -0.02 * Math.cos(c));
    if (hose) hose.rotation.set(0.12 * Math.cos(c * 2), 0, 0.12 * sL);
    if (cap) cap.rotation.z = 0.03 * Math.cos(c * 2);
    eyeScale(1 + 0.05 * Math.sin(c * 2));
  }

  function windup(k) {
    const a = easeOut(k);
    raiseArms(a);
    upper.rotation.x = a * 0.28;
    upper.rotation.z = Math.sin(k * 60) * 0.012 * a;
    root.position.y = -0.04 * a;
    legL.rotation.x = 0.25 * a;
    legR.rotation.x = -0.2 * a;
    headG.rotation.x = -0.15 * a;
    fists(0.1 * a, 0.1 * a);
    if (hose) hose.rotation.x = -0.3 * a;
    eyeScale(1 + 0.4 * a);
  }

  function swing(k) {
    const p = clamp(k / 0.45, 0, 1);
    const slam = easeIn(p);
    const q = Math.max(0, k - 0.45);
    const settle = smooth(clamp(q / 0.55, 0, 1));
    const osc = Math.sin(q * 16) * Math.exp(-q * 6); // overshoot and ring after the impact
    const armA = lerp(2.9, 0.35, slam) + settle * 0.3 + osc * 0.14;
    armR.rotation.x = armA;
    armL.rotation.x = spec.bothArms ? armA : lerp(0.8, 0.2, slam);
    if (spec.bothArms) {
      armL.rotation.z = -rest - 0.15 * (1 - slam);
      armR.rotation.z = rest + 0.15 * (1 - slam);
    }
    const ext = -0.16 * slam * (1 - smooth(clamp((k - 0.55) / 0.4, 0, 1)));
    fists(spec.bothArms ? ext : 0.04 * (1 - slam), ext);
    upper.rotation.x = lerp(0.28, -0.5, slam) + settle * 0.3 + osc * 0.05;
    root.position.z = -0.3 * slam * (1 - settle * 0.7);
    root.position.y = k > 0.45 ? -0.045 * Math.exp(-q * 10) : -0.04 * (1 - slam);
    legL.rotation.x = lerp(0.25, -0.15, slam);
    legR.rotation.x = lerp(-0.2, 0.25, slam);
    headG.rotation.x = lerp(-0.15, 0.3, slam) + osc * 0.06;
    if (hose) hose.rotation.x = lerp(-0.3, 0.5, slam) + osc * 0.2;
    eyeScale(1.3);
  }

  function aim(t) {
    const a = easeOut(clamp(t / 0.25, 0, 1));
    const sway = Math.sin(t * 7 + phase) * 0.012;
    if (cannonMesh) {
      armR.rotation.x = lerp(0.35, 1.5, a) + sway + Math.sin(a * Math.PI) * 0.06;
      armR.rotation.z = lerp(rest, 0.02, a);
      armL.rotation.x = 0.25 * a;
      armL.rotation.z = -rest - 0.5 * a;
      upper.rotation.x = -0.05 * a;
      headG.rotation.x = 0.1 * a;
      barrelG.position.y = 0.03 * (1 - a);
      if (cap) cap.rotation.z = 0.02 * Math.sin(t * 30) * (1 - a);
    } else {
      armR.rotation.x = 1.3 * a;
      armL.rotation.x = 1.3 * a;
      upper.rotation.x = -0.08 * a;
    }
    if (hose) hose.rotation.x = 0.1 * Math.sin(t * 4) * (1 - a);
    eyeScale(1 + 0.2 * a);
  }

  function shoot(k) {
    if (!cannonMesh) {
      swing(k);
      return;
    }
    const r = Math.exp(-k * 7);
    armR.rotation.x = 1.5 + 0.5 * r;
    armR.rotation.z = 0.02;
    barrelG.position.y = 0.2 * r;
    tip.scale.setScalar(1 + 2.5 * r);
    armL.rotation.x = 0.25;
    armL.rotation.z = -rest - 0.5;
    upper.rotation.x = 0.2 * r - 0.05;
    root.position.z = 0.12 * r;
    headG.rotation.x = 0.1 + 0.18 * r;
    cap.rotation.z = Math.sin(k * 70) * 0.06 * r;
    cap.position.y += 0.015 * r;
    if (hose) hose.rotation.x = 0.3 * r;
    eyeScale(1.2 + 0.3 * r);
  }

  function hurt(t) {
    idle(t);
    const s = Math.max(0, 1 - t / 0.4);
    const lean = 0.38 * s * (1 + 0.3 * Math.cos(t * 18));
    upper.rotation.x += lean;
    upper.rotation.z += Math.sin(t * 38) * s * 0.1;
    root.position.z = 0.1 * s;
    headG.rotation.x = 0.45 * s;
    armL.rotation.x += 0.5 * s;
    armR.rotation.x += 0.5 * s;
    fists(0.06 * s, 0.06 * s);
    if (hose) hose.rotation.x += 0.6 * s * Math.sin(t * 20);
    if (cap) {
      cap.position.y += 0.05 * s;
      cap.rotation.z = Math.sin(t * 45) * 0.1 * s;
    }
    eyeScale(1 + 0.5 * s);
  }

  function dead(k) {
    // Topple backwards, bounce once, head pops off and rolls aside, eyes sputter out.
    const fall = easeIn(clamp(k / 0.7, 0, 1));
    const bounce = k > 0.7 ? Math.sin(clamp((k - 0.7) / 0.3, 0, 1) * Math.PI) * 0.06 : 0;
    const theta = fall * HALF;
    root.rotation.x = theta;
    root.rotation.z = 0.15 * fall;
    root.position.y = spec.bodyR * Math.sin(theta) + bounce;
    root.position.z = spec.bodyR * 0.4 * fall;
    const pop = smooth(clamp((k - 0.5) / 0.4, 0, 1));
    headG.position.x = spec.radius * 0.9 * pop;
    headG.position.y = spec.neck - spec.hip - 0.2 * pop;
    headG.position.z = -spec.radius * 0.3 * pop;
    headG.rotation.z = -0.8 * pop;
    headG.rotation.y = 0.6 * pop;
    if (cap) {
      cap.position.x = 0.35 * pop;
      cap.position.y = 1.84 - spec.neck + 0.3 * Math.sin(pop * Math.PI) - 0.1 * pop;
      cap.position.z = -0.2 * pop;
      cap.rotation.z = 2.4 * pop;
    }
    upper.rotation.z = 0.2 * fall;
    armL.rotation.x = 0.4 * fall;
    armR.rotation.x = -0.3 * fall;
    armL.rotation.z = -rest - 1.1 * fall;
    armR.rotation.z = rest + 1.0 * fall;
    fists(-0.25 * fall, -0.3 * fall);
    legL.rotation.x = 0.5 * fall;
    legR.rotation.x = -0.3 * fall;
    legR.rotation.z = 0.3 * fall;
    if (hose) hose.rotation.z = 0.7 * fall;
    if (cannonMesh) barrelG.position.y = 0.05 * fall;
    const on = k < 0.12 || (k < 0.5 && Math.sin(k * 90) > 0);
    for (const e of eyes) e.visible = on;
    if (lamp) lamp.visible = on;
  }

  function setPose(state, t, k) {
    t = Math.max(0, num(t, 0));
    k = clamp(num(k, 0), 0, 1);
    reset();
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

  // Optional self-running details: eyes flicker and drop out for a blink, the indicator lamp pulses.
  let clock = 0;
  let lastEye = 1;
  let lastLamp = 1;
  function update(dt) {
    clock += clamp(num(dt, 0), 0, 0.1);
    const h = (Math.sin(Math.floor(clock * 6) * 12.9898 + phase) * 43758.5453) % 1;
    const blink = (h + 1) % 1 > 0.95 ? 0.45 : 1;
    const f = (1 + 0.14 * Math.sin(clock * 37 + phase) * Math.sin(clock * 9 + phase * 0.7)) * blink;
    eyeMat.color.multiplyScalar(f / lastEye);
    lastEye = f;
    const l = Math.sin(clock * 2.2 + phase) > -0.2 ? 1 : 0.2;
    lampMat.color.multiplyScalar(l / lastLamp);
    lastLamp = l;
  }

  setPose('idle', 0, 0);
  return {
    group, height: spec.height, radius: spec.radius, headY: spec.headY, eyes, setPose, flash, update,
    muzzle, // bampot only: the cannon tip, for spawning shots (getWorldPosition)
  };
}

// ---------------------------------------------------------------------------------------------
// Level 2 robots: the Shielded Fizzbang and the Tour Guide. Same rig conventions as makeRobot (feet at the origin,
// facing -z, setPose(state, t, k) resets and poses every call), with extras listed on each builder.
// ---------------------------------------------------------------------------------------------

const wallNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Eye flicker and indicator pulse, the same as makeRobot's update(), plus a way to recolour the eyes (enrage) that
// keeps the flicker ratio consistent.
function flickerRig(phase, eyeMat, lampMat) {
  let clock = 0;
  let lastEye = 1;
  let lastLamp = 1;
  return {
    update(dt) {
      clock += clamp(num(dt, 0), 0, 0.1);
      const h = (Math.sin(Math.floor(clock * 6) * 12.9898 + phase) * 43758.5453) % 1;
      const blink = (h + 1) % 1 > 0.95 ? 0.45 : 1;
      const f = (1 + 0.14 * Math.sin(clock * 37 + phase) * Math.sin(clock * 9 + phase * 0.7)) * blink;
      eyeMat.color.multiplyScalar(f / lastEye);
      lastEye = f;
      if (lampMat) {
        const l = Math.sin(clock * 2.2 + phase) > -0.2 ? 1 : 0.2;
        lampMat.color.multiplyScalar(l / lastLamp);
        lastLamp = l;
      }
    },
    tintEyes(hex, k) {
      eyeMat.color.copy(hdr(hex, k)).multiplyScalar(lastEye);
    },
  };
}

// Two-bone arm solve (shoulder S to grip G, elbow pulled towards `pole`). Fills `elbow` and returns the stretch the
// bones need if G is further than they reach (a telescoping piston arm, so the hand never lets go of the shield).
const _tb = { d: new THREE.Vector3(), dir: new THREE.Vector3(), pp: new THREE.Vector3() };
function twoBone(S, G, pole, L1, L2, elbow) {
  const { d, dir, pp } = _tb;
  d.copy(G).sub(S);
  const len = d.length() || 1;
  dir.copy(d).divideScalar(len);
  const stretch = Math.max(1, len / ((L1 + L2) * 0.97));
  const l1 = L1 * stretch;
  const l2 = L2 * stretch;
  const dist = Math.max(0.05, len);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  pp.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  elbow.copy(S).addScaledVector(dir, a).addScaledVector(pp, h);
  return stretch;
}

const SHIELD = { w: 1.3, h: 1.7, d: 0.1, cy: 1.03, z: -0.9, grip: [0.4, 0.2, 0.12] };

function lightning(w, h) {
  const s = new THREE.Shape();
  [[0.1, 1], [-0.55, -0.05], [-0.08, -0.05], [-0.3, -1], [0.55, 0.1], [0.08, 0.1], [0.4, 1]].forEach(([x, y], i) => (i ? s.lineTo(x * w, y * h) : s.moveTo(x * w, y * h)));
  s.closePath();
  return new THREE.ShapeGeometry(s);
}

function shieldedGeo(v) {
  const HIP = 0.45;
  const NECK = 1.7;
  const o = { seed: v + 4, tint: [0, 0.05, -0.04][v] };
  const fz = once(`robot:fizzbang:${v}`, () => fizzbangGeo(v));
  const GREEN = 0x3f5f4a;
  const BLUE = 0x6f8f9c;
  const can = dent(rcyl(0.48, 0.48, 1.14, 0.06, 22, 5), [[0.22, 0.1, 0.45, 0.26, 0.05], [-0.47, -0.2, 0.1, 0.22, 0.045], [0.45, 0.3, -0.15, 0.2, 0.04], [0, -0.3, 0.48, 0.2, 0.04]]);
  const slat = once('fz:slat', () => rbox(0.05, 0.025, 0.22, 0.01));
  const pipe = (r, h, x, y, z, hex, surf = 'metal', rust = 0.35) => P(rcyl(r, r, h, 0.015, 12), hex, surf, [x, y, z], [0, 0, 0], [1, 1, 1], { rust });
  const ring = (r, x, y, z) => P(rcyl(r + 0.017, r + 0.017, 0.05, 0.01, 12), C.brass, 'brass', [x, y, z]);

  // the door: a dented vending-machine front, built round its own centre, front face towards -z
  const slab = dent(rbox(SHIELD.w, SHIELD.h, SHIELD.d, 0.035, false, [12, 15, 1]), [
    [0.12, -0.12, -0.025, 0.3, 0.075], [-0.5, -0.2, -0.025, 0.22, 0.055], [0.5, 0.78, -0.025, 0.2, 0.05], [-0.1, 0.8, -0.025, 0.16, 0.04],
  ], [0, 0, 1]);
  const f = -0.052; // front face z
  const rivet = once('sh:rivet', () => withEdge(new THREE.CylinderGeometry(0.017, 0.017, 0.014, 5, 1)));
  const tin = once('sh:tin', () => withEdge(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 8, 1)));
  const tins = [];
  [[0.5, 0], [0.28, 1]].forEach(([sy, row]) => {
    for (let i = 0; i < 6; i++) {
      if ((i + row * 2) % 5 === 3) continue; // a few sold out
      tins.push(P(tin, [0x9a3a2a, 0x3a6a8a, 0xc9a23a, 0x4a7a52, 0x7a2430, 0x8a7a60][(i + row * 3) % 6], 'gloss', [-0.46 + i * 0.12 + row * 0.02, sy + 0.08, f - 0.002], [0, 0, i === 4 && row === 1 ? 0.5 : 0]));
    }
  });
  const shield = bake([
    P(slab, BLUE, 'paint', [0, 0, 0], [0, 0, 0], [1, 1, 1], { rust: 0.2 }),
    // product window: dark backing, shelves, a few tins, cracks
    P(rbox(0.8, 0.68, 0.03, 0.012), 0x07090b, 'glass', [-0.16, 0.4, f]),
    P(rbox(0.86, 0.74, 0.02, 0.012), 0x3a3f44, 'metal', [-0.16, 0.4, f + 0.012], [0, 0, 0], [1, 1, 1], { rust: 0.45 }),
    ...[0.28, 0.5].map((y) => P(rbox(0.74, 0.022, 0.05, 0.006), C.steel, 'metal', [-0.16, y, f - 0.012])),
    ...tins,
    ...[[-0.3, 0.55, 0.9, 0.2], [-0.3, 0.55, -0.4, 0.22], [-0.3, 0.55, 2.3, 0.16], [-0.3, 0.55, 0.1, 0.12]].map(([cx, cy, a, l]) => P(rbox(l, 0.006, 0.006, 0.002), 0xb4bcbe, 'glass', [cx + Math.cos(a) * l * 0.5, cy + Math.sin(a) * l * 0.5, f - 0.032], [0, 0, a])),
    // coin slot and keypad
    P(rbox(0.3, 0.6, 0.025, 0.01), 0x8a8d8f, 'metal', [0.43, 0.22, f], [0, 0, 0], [1, 1, 1], { rust: 0.4 }),
    P(rbox(0.12, 0.13, 0.02, 0.008), 0x1a1b1d, 'plastic', [0.43, 0.41, f - 0.014]),
    P(rbox(0.065, 0.014, 0.02, 0.004), 0x000000, 'plastic', [0.43, 0.43, f - 0.026]),
    P(rbox(0.014, 0.05, 0.02, 0.004), C.brass, 'brass', [0.43, 0.37, f - 0.026]),
    ...[0, 1, 2].flatMap((i) => [0, 1].map((j) => P(rcyl(0.025, 0.025, 0.018, 0.006, 10), [0xa02a22, 0xc9a23a, 0x4a7a52][(i + j) % 3], 'plastic', [0.35 + i * 0.075, 0.24 - j * 0.07, f - 0.014], [HALF, 0, 0]))),
    P(torus(0.045, 0.012, 14, 5), C.chrome, 'chrome', [0.43, 0.04, f - 0.014]),
    P(rcyl(0.032, 0.032, 0.01, 0.004, 12), 0x050505, 'plastic', [0.43, 0.04, f - 0.012], [HALF, 0, 0]),
    // the delivery flap, pushed in
    P(rbox(0.54, 0.2, 0.04, 0.012), 0x2a2c2f, 'paint', [-0.12, -0.52, f], [0, 0, 0.04], [1, 1, 1], { rust: 0.5 }),
    P(rbox(0.5, 0.025, 0.03, 0.008), C.chrome, 'chrome', [-0.12, -0.42, f - 0.022], [0, 0, 0.04]),
    ...[-0.34, 0.1].map((x) => P(ball(0.016, 6, 4), C.steelD, 'metal', [x, -0.41, f - 0.03])),
    // faded stickers, shapes only: a washed-out starburst, a lightning bolt, a peeling corner
    P(rcyl(0.15, 0.15, 0.006, 0.002, 20), 0xd2bd7a, 'paper', [0.4, -0.5, f - 0.001], [HALF, 0, 0]),
    P(starShape(8, 0.12, 0.065), 0xa8402a, 'paper', [0.4, -0.5, f - 0.006], [0, Math.PI, 0.2]),
    P(lightning(0.07, 0.11), 0xd8b02a, 'paper', [0.4, -0.5, f - 0.008], [0, Math.PI, 0]),
    P(rbox(0.2, 0.16, 0.005, 0.002), 0xc9b68a, 'paper', [-0.45, 0.75, f - 0.003], [0, 0, 0.12]),
    P(rbox(0.07, 0.07, 0.006, 0.002), 0x9a8a62, 'paper', [-0.375, 0.7, f - 0.006], [0, 0, 0.9]),
    // rust runs down from the window sill and the coin panel
    ...[[-0.5, 0.03, 0.3], [-0.25, 0.03, 0.17], [0.0, 0.03, 0.34], [0.2, 0.03, 0.22], [0.38, -0.08, 0.26], [0.5, -0.08, 0.14], [-0.57, -0.3, 0.3]]
      .map(([x, y, l], i) => P(rbox(i % 3 ? 0.014 : 0.026, l, 0.004, 0.0015), i % 2 ? 0x4e2c1a : 0x5d3a1f, 'paint', [x, y - l / 2, f - 0.0015], [0, 0, 0], [1, 1, 1], { wear: 0 })),
    // hazard chevrons along the foot, and rivets round the rim
    ...Array.from({ length: 13 }, (_, i) => P(rbox(0.05, 0.11, 0.01, 0.003), i % 2 ? 0x15151a : 0xb89a2a, 'paint', [-0.6 + i * 0.1, -0.78, f - 0.002], [0, 0, 0.6])),
    ...Array.from({ length: 8 }, (_, i) => [-1, 1].map((s) => P(rivet, C.steelD, 'metal', [s * 0.62, -0.62 + i * 0.18, f - 0.002], [HALF, 0, 0]))).flat(),
    ...Array.from({ length: 5 }, (_, i) => P(rivet, C.steelD, 'metal', [-0.4 + i * 0.2, 0.82, f - 0.002], [HALF, 0, 0])),
    // the back: grip bar, braces, a ripped-out cable
    P(rcyl(0.03, 0.03, 0.46, 0.01, 12), C.steel, 'metal', [SHIELD.grip[0], SHIELD.grip[1], SHIELD.grip[2]]),
    ...[-0.2, 0.2].map((dy) => P(rbox(0.05, 0.05, 0.08, 0.012), C.steelD, 'metal', [SHIELD.grip[0], SHIELD.grip[1] + dy, 0.09])),
    P(rbox(1.1, 0.07, 0.05, 0.012), C.steelD, 'metal', [0, -0.3, 0.075], [0, 0, 0], [1, 1, 1], { rust: 0.5 }),
    P(rbox(0.07, 1.4, 0.05, 0.012), C.steelD, 'metal', [-0.4, 0, 0.075], [0, 0, 0], [1, 1, 1], { rust: 0.5 }),
    P(tube([[-0.1, 0.5, 0.07], [0.0, 0.3, 0.14], [-0.2, 0.1, 0.16], [-0.15, -0.1, 0.1]], 0.016, 14, 5), C.rubber, 'rubber'),
  ], { originY: SHIELD.cy, ...o, seed: v + 9 });

  return {
    leg: fz.leg,
    eye: fz.eye,
    arm: fz.arm,
    lamp: ball(0.034, 10, 7),
    shield,
    torso: bake([
      P(rcyl(0.34, 0.4, 0.16, 0.04, 18), C.dark, 'paint', [0, 0.46, 0], [0, 0, 0], [1, 1, 1], { rust: 0.4 }),
      P(can, GREEN, 'paint', [0, 1.03, 0], [0, 0, 0], [1, 1, 1], { rust: 0.42 }),
      P(rcyl(0.51, 0.51, 0.09, 0.035, 26), C.chrome, 'chrome', [0, 0.53, 0], [0, 0, 0], [1, 1, 1], { rust: 0.35 }),
      P(rcyl(0.51, 0.51, 0.1, 0.035, 26), C.chrome, 'chrome', [0, 1.57, 0], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      P(rcyl(0.4, 0.5, 0.08, 0.03, 26), C.chrome, 'chrome', [0, 1.65, 0], [0, 0, 0], [1, 1, 1], { rust: 0.2 }),
      P(rcyl(0.5, 0.5, 0.2, 0.02, 26), 0xb5a57a, 'paint', [0, 1.0, 0], [0, 0, 0], [1, 1, 1], { rust: 0.5 }),
      P(rcyl(0.17, 0.2, 0.1, 0.03, 16), C.rubber, 'rubber', [0, 1.7, 0]),
      ...[-1, 1].flatMap((s) => [1.2, 1.26, 1.32, 1.38].map((y) => P(slat, 0x1c1c1e, 'metal', [s * 0.487, y, 0.0]))),
      ...bolts(8, 0.515, 0.54, C.steelD, 0.02),
      ...bolts(8, 0.515, 1.57, C.steelD, 0.02),
      P(torus(0.5, 0.035, 28, 6), C.rubber, 'rubber', [0, 0.68, 0], [HALF, 0, 0]),
      // the back is bare: a service hatch with the door ripped off, pipes, a gauge and a gas bottle
      P(rbox(0.6, 0.82, 0.06, 0.02), 0x1d1816, 'paint', [0, 1.02, 0.47], [0, 0, 0], [1, 1, 1], { rust: 0.6 }),
      P(rbox(0.66, 0.05, 0.05, 0.012), 0x4a3a30, 'metal', [0, 1.45, 0.5], [0, 0, 0.03], [1, 1, 1], { rust: 0.8 }),
      P(rbox(0.05, 0.86, 0.05, 0.012), 0x4a3a30, 'metal', [0.32, 1.02, 0.5], [0, 0, -0.02], [1, 1, 1], { rust: 0.8 }),
      P(rbox(0.05, 0.4, 0.05, 0.012), 0x4a3a30, 'metal', [-0.32, 1.2, 0.5], [0, 0, 0.05], [1, 1, 1], { rust: 0.8 }),
      pipe(0.06, 0.95, -0.17, 1.0, 0.58, 0x9a5c38),
      pipe(0.045, 0.95, 0.0, 1.0, 0.57, 0x6a6e74),
      pipe(0.07, 0.9, 0.17, 0.98, 0.58, 0x3d5a63, 'paint', 0.5),
      ...[0.75, 1.0, 1.25].flatMap((y) => [ring(0.06, -0.17, y, 0.58), ring(0.07, 0.17, y - 0.02, 0.58)]),
      P(rcyl(0.05, 0.05, 0.62, 0.012, 12), C.steel, 'metal', [0, 1.4, 0.64], [0, 0, HALF], [1, 1, 1], { rust: 0.3 }),
      P(torus(0.06, 0.013, 14, 5), 0xb02a22, 'paint', [0.17, 1.4, 0.7]),
      ...[0, 1, 2].map((i) => P(rbox(0.1, 0.012, 0.012, 0.003), 0xb02a22, 'paint', [0.17, 1.4, 0.7], [0, 0, (i * Math.PI) / 3])),
      P(torus(0.075, 0.015, 16, 5), C.chrome, 'chrome', [-0.17, 1.28, 0.68]),
      P(rcyl(0.07, 0.07, 0.02, 0.006, 16), 0xd7cfb8, 'paper', [-0.17, 1.28, 0.665], [HALF, 0, 0]),
      P(rbox(0.012, 0.055, 0.01, 0.003), 0x9a1c1c, 'plastic', [-0.17 + 0.01, 1.3, 0.678], [0, 0, 0.6]),
      P(rcyl(0.09, 0.09, 0.56, 0.035, 14), 0x6a6e4a, 'paint', [0, 0.74, 0.66], [0, 0, HALF], [1, 1, 1], { rust: 0.6 }),
      P(rcyl(0.025, 0.025, 0.06, 0.008, 10), C.brass, 'brass', [0.3, 0.74, 0.66], [0, 0, HALF]),
      P(torus(0.07, 0.012, 14, 5), C.steelD, 'metal', [-0.12, 0.74, 0.66], [0, HALF, 0]),
      P(torus(0.07, 0.012, 14, 5), C.steelD, 'metal', [0.12, 0.74, 0.66], [0, HALF, 0]),
      // a chimney that clears the shoulders, and loose wiring
      pipe(0.055, 0.62, -0.3, 1.62, 0.42, C.steelD, 'metal', 0.45),
      P(rcyl(0.075, 0.075, 0.05, 0.015, 12), C.rubber, 'rubber', [-0.3, 1.93, 0.42]),
      ring(0.055, -0.3, 1.5, 0.42),
      P(tube([[-0.25, 1.35, 0.52], [-0.35, 1.2, 0.6], [-0.3, 0.95, 0.6], [-0.4, 0.8, 0.5]], 0.014, 16, 5), C.rubber, 'rubber'),
      P(tube([[0.25, 1.4, 0.52], [0.38, 1.25, 0.56], [0.36, 1.05, 0.5]], 0.012, 14, 5), 0xa02a22, 'rubber'),
    ], { base: [0, HIP, 0], ...o }),
    head: bake([
      P(rbox(0.72, 0.46, 0.58, 0.07, true), 0x55606a, 'paint', [0, 1.93, 0], [0, 0, 0], [1, 1, 1], { rust: 0.4 }),
      P(rbox(0.64, 0.17, 0.08, 0.04), C.glass, 'glass', [0, 2.05, -0.27]),
      P(rbox(0.3, 0.065, 0.08, 0.025), C.dark, 'paint', [-0.17, 2.135, -0.29], [0, 0, -0.28]),
      P(rbox(0.3, 0.065, 0.08, 0.025), C.dark, 'paint', [0.17, 2.135, -0.29], [0, 0, 0.28]),
      P(rbox(0.4, 0.08, 0.06, 0.02), 0x111113, 'plastic', [0, 1.82, -0.28]),
      ...[-0.12, -0.04, 0.04, 0.12].map((x) => P(rbox(0.05, 0.07, 0.03, 0.01), C.chrome, 'chrome', [x, 1.82, -0.305])),
      P(rcyl(0.075, 0.075, 0.12, 0.02, 14), C.chrome, 'chrome', [-0.4, 1.93, 0], [0, 0, HALF]),
      P(rcyl(0.075, 0.075, 0.12, 0.02, 14), C.chrome, 'chrome', [0.4, 1.93, 0], [0, 0, HALF]),
      // a dented lid, a patch plate and tape across the visor
      P(rcyl(0.3, 0.34, 0.04, 0.015, 20), C.steel, 'metal', [0.02, 2.16, 0.02], [0.04, 0, 0.03], [1, 1, 1], { rust: 0.5 }),
      P(rbox(0.2, 0.18, 0.02, 0.008), 0x6a4a30, 'metal', [-0.365, 1.92, -0.05], [0, 0, 0], [1, 1, 1], { rust: 0.8 }),
      P(rbox(0.3, 0.025, 0.012, 0.004), C.black, 'tape', [0.1, 2.05, -0.318], [0, 0, 0.7]),
      P(rbox(0.3, 0.025, 0.012, 0.004), C.black, 'tape', [0.1, 2.05, -0.32], [0, 0, -0.7]),
      P(tube([[0.24, 2.17, 0.12], [0.27, 2.19, 0.14], [0.25, 2.2, 0.12]], 0.011, 10, 4), C.steelD, 'metal'),
    ], { base: [0, NECK, 0], ...o }),
    fist: bake([
      P(capsule(0.07, 0.14), C.chrome, 'chrome', [0, -0.1, 0]),
      P(rbox(0.46, 0.4, 0.46, 0.1, true), GREEN, 'paint', [0, -0.34, 0], [0, 0, 0], [1, 1, 1], { rust: 0.45 }),
      P(rbox(0.46, 0.07, 0.07, 0.025), C.chrome, 'chrome', [0, -0.2, -0.235]),
      ...[-0.1, 0, 0.1].map((x) => P(rbox(0.022, 0.26, 0.03, 0.01), C.dark, 'paint', [x, -0.38, -0.225])),
      P(rbox(0.12, 0.14, 0.1, 0.04), GREEN, 'paint', [0.255, -0.28, -0.08], [0, 0, 0], [1, 1, 1], { rust: 0.4 }),
    ], { originY: 0.88, ...o }),
    shoulder: bake([
      P(ball(0.17), C.chrome, 'chrome'),
      P(torus(0.16, 0.03, 16, 6), C.rubber, 'rubber', [0, -0.06, 0], [HALF, 0, 0]),
      P(rcyl(0.19, 0.19, 0.05, 0.02, 18), C.chrome, 'chrome', [0, -0.12, 0]),
      ...bolts(6, 0.19, -0.12, C.steelD, 0.02),
    ], { originY: 1.4, ...o }),
    boneU: bake([
      P(rcyl(0.15, 0.12, 0.42, 0.04, 16), 0x484d55, 'metal', [0, -0.26, 0], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      P(rcyl(0.17, 0.17, 0.05, 0.02, 16), C.chrome, 'chrome', [0, -0.08, 0]),
      P(ball(0.13), C.chrome, 'chrome', [0, -0.5, 0]),
      P(torus(0.13, 0.025, 14, 5), C.rubber, 'rubber', [0, -0.5, 0], [0, HALF, 0]),
      P(tube([[0.1, -0.1, 0.12], [0.16, -0.25, 0.14], [0.1, -0.44, 0.1]], 0.024, 12, 5), C.rubber, 'rubber'),
    ], { originY: 1.2, ...o }),
    boneL: bake([
      P(rcyl(0.12, 0.1, 0.34, 0.035, 16), C.steel, 'metal', [0, -0.2, 0], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      P(rcyl(0.045, 0.045, 0.3, 0.01, 12), C.chrome, 'chrome', [0, -0.42, 0]),
      P(rcyl(0.07, 0.07, 0.06, 0.02, 14), C.brass, 'brass', [0, -0.28, 0]),
      P(rbox(0.22, 0.16, 0.2, 0.05), C.steelD, 'metal', [0, -0.55, 0], [0, 0, 0], [1, 1, 1], { rust: 0.4 }),
    ], { originY: 1.0, ...o }),
    hose: bake([
      P(tube([[0, 0, 0], [0.14, 0.05, 0.1], [0.26, -0.15, 0.14], [0.3, -0.5, 0.12], [0.22, -0.75, 0.12]], 0.04, 24, 6), C.rubber, 'rubber'),
      P(rcyl(0.055, 0.055, 0.08, 0.02, 12), C.chrome, 'chrome', [0.22, -0.78, 0.12]),
    ], { originY: 1.2, ...o }),
    glow: radialDisc(0.5, 0xffb060, 2.2),
  };
}

// The Shielded Fizzbang: melee only, carries a vending-machine door. Extras: shieldHit() makes the door recoil and
// flash for about 0.12 s (safe every frame). Poses: idle, walk, windup, swing, hurt, dead (aim and shoot fall back to
// windup and swing so nothing breaks if the game asks for them).
function makeShielded() {
  const kind = 'shielded';
  const variant = (variantCount[kind] = (variantCount[kind] ?? -1) + 1) % VARIANTS;
  const geo = once(`robot:${kind}:${variant}`, () => shieldedGeo(variant));
  const mat = pbrMat();
  const phase = (robotCount++) * 1.7;
  const HIP = 0.45;
  const NECK = 1.7;
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
  const legL = mk(geo.leg, mat, root, -0.26, HIP, 0);
  const legR = mk(geo.leg, mat, root, 0.26, HIP, 0);
  const upper = new THREE.Group();
  upper.position.y = HIP;
  root.add(upper);
  mk(geo.torso, mat, upper);
  const headG = new THREE.Group();
  headG.position.y = NECK - HIP;
  upper.add(headG);
  mk(geo.head, mat, headG);
  const eyeMat = new THREE.MeshBasicMaterial({ color: hdr(0xff7a1e, 3), fog: false });
  const eyes = [-1, 1].map((side) => {
    const e = mk(geo.eye, eyeMat, headG, side * 0.17, 2.06 - NECK, -0.305);
    e.rotation.z = -side * 0.2;
    return e;
  });
  const lampMat = new THREE.MeshBasicMaterial({ color: hdr(0xffa030, 2.6), fog: false });
  const lamp = mk(geo.lamp, lampMat, upper, 0.0, 1.5 - HIP, 0.54);
  const hose = new THREE.Group();
  hose.position.set(0.3, 1.5 - HIP, 0.42);
  upper.add(hose);
  mk(geo.hose, mat, hose);

  const armL = new THREE.Group();
  armL.position.set(-0.64, 1.38 - HIP, 0);
  upper.add(armL);
  mk(geo.arm, mat, armL);
  const fistL = mk(geo.fist, mat, armL, 0, -0.5, 0);

  // right side: a ball joint, two telescoping bones and the door on the end of them
  const S0 = new THREE.Vector3(0.64, 1.4 - HIP, 0);
  const shoulderG = new THREE.Group();
  shoulderG.position.copy(S0);
  upper.add(shoulderG);
  mk(geo.shoulder, mat, shoulderG);
  const boneU = mk(geo.boneU, mat, upper);
  const boneL = mk(geo.boneL, mat, upper);
  const shieldG = new THREE.Group();
  shieldG.name = 'shield';
  upper.add(shieldG);
  mk(geo.shield, mat, shieldG);
  const glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const glow = new THREE.Mesh(geo.glow, glowMat);
  glow.position.set(0, 0.1, -0.08);
  glow.scale.set(1.2, 1.5, 1);
  glow.visible = false;
  glow.rotation.y = Math.PI;
  shieldG.add(glow);

  const rig = flickerRig(phase, eyeMat, lampMat);
  const white = whiteMat();
  const REST = { y: SHIELD.cy - HIP, z: SHIELD.z };
  const rest = 0.1;
  const down = new THREE.Vector3(0, -1, 0);
  const _G = new THREE.Vector3();
  const _E = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _pole = new THREE.Vector3(0.9, -0.45, 0.55);
  let limp = 0; // 0..1: the right arm hangs instead of holding the door

  function reset() {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    legL.rotation.set(0, 0, 0);
    legR.rotation.set(0, 0, 0);
    upper.position.set(0, HIP, 0);
    upper.rotation.set(0, 0, 0);
    upper.scale.set(1, 1, 1);
    headG.position.set(0, NECK - HIP, 0);
    headG.rotation.set(0, 0, 0);
    armL.rotation.set(0, 0, -rest);
    fistL.position.set(0, -0.5, 0);
    hose.rotation.set(0, 0, 0);
    shoulderG.position.copy(S0);
    if (shieldG.parent !== upper) upper.add(shieldG);
    shieldG.position.set(0, REST.y, REST.z);
    shieldG.rotation.set(0, 0, 0);
    glow.visible = false;
    limp = 0;
    for (const e of eyes) {
      e.visible = true;
      e.scale.set(1, 1, 1);
    }
    lamp.visible = true;
  }
  const eyeScale = (s) => {
    for (const e of eyes) e.scale.set(s, s, 1);
  };

  function idle(t) {
    const s = t + phase;
    upper.scale.y = 1 + 0.012 * Math.sin(s * 2.2);
    upper.scale.x = upper.scale.z = 1 - 0.005 * Math.sin(s * 2.2);
    upper.rotation.z = 0.02 * Math.sin(s * 1.1);
    upper.rotation.x = 0.02 * Math.sin(s * 0.9 + 1);
    armL.rotation.x = 0.06 * Math.sin(s * 1.7);
    fistL.position.y = -0.5 + 0.012 * Math.sin(s * 2.6);
    headG.rotation.y = 0.1 * Math.sin(s * 0.7);
    headG.rotation.x = 0.02 * Math.sin(s * 1.3);
    hose.rotation.set(0.05 * Math.sin(s * 1.3 + 1), 0, 0.07 * Math.sin(s * 1.9));
    shieldG.position.y += 0.012 * Math.sin(s * 2.2);
    shieldG.position.x = 0.015 * Math.sin(s * 1.3);
    shieldG.rotation.y = 0.03 * Math.sin(s * 0.8);
    shieldG.rotation.z = 0.012 * Math.sin(s * 1.6);
    eyeScale(1 + 0.08 * Math.sin(s * 5));
  }

  function walk(t) {
    const c = t * 5.5 + phase;
    const sL = Math.sin(c);
    legL.rotation.x = sL * 0.7;
    legR.rotation.x = -sL * 0.7;
    armL.rotation.x = -sL * 0.5;
    root.position.y = Math.abs(sL) * 0.05;
    upper.rotation.z = sL * 0.04;
    upper.rotation.x = -0.05 + 0.02 * Math.cos(c * 2);
    headG.rotation.y = -sL * 0.05;
    headG.rotation.x = 0.04 - 0.03 * Math.cos(c * 2);
    fistL.position.y = -0.5 + 0.02 * Math.cos(c);
    hose.rotation.set(0.12 * Math.cos(c * 2), 0, 0.12 * sL);
    // the door is heavy: it lags and rocks with each step
    shieldG.position.y += 0.03 * Math.abs(Math.cos(c));
    shieldG.position.x = 0.03 * sL;
    shieldG.rotation.y = 0.06 * sL;
    shieldG.rotation.z = 0.03 * Math.cos(c);
    eyeScale(1 + 0.05 * Math.sin(c * 2));
  }

  // The door is drawn back and turned, the whole body coils behind it.
  function windup(k) {
    const a = easeOut(k);
    shieldG.position.z = lerp(REST.z, -0.66, a);
    shieldG.position.y += 0.08 * a;
    shieldG.position.x = -0.05 * a;
    shieldG.rotation.y = 0.45 * a;
    shieldG.rotation.x = 0.12 * a;
    upper.rotation.y = 0.28 * a;
    upper.rotation.x = -0.1 * a;
    upper.rotation.z = Math.sin(k * 60) * 0.012 * a;
    root.position.y = -0.04 * a;
    legL.rotation.x = 0.25 * a;
    legR.rotation.x = -0.2 * a;
    headG.rotation.x = -0.1 * a;
    headG.rotation.y = -0.2 * a;
    armL.rotation.x = 0.5 * a;
    armL.rotation.z = -rest - 0.25 * a;
    fistL.position.y = -0.5 + 0.1 * a;
    hose.rotation.x = -0.3 * a;
    eyeScale(1 + 0.4 * a);
  }

  // Shove: the door is slammed forward and the body follows it in, then everything settles.
  function swing(k) {
    const p = clamp(k / 0.35, 0, 1);
    const slam = easeIn(p);
    const q = Math.max(0, k - 0.35);
    const settle = smooth(clamp(q / 0.6, 0, 1));
    const osc = Math.sin(q * 18) * Math.exp(-q * 6);
    shieldG.position.z = lerp(-0.66, -1.12, slam) + settle * 0.2 + osc * 0.03;
    shieldG.position.y += 0.08 * (1 - slam) - 0.02 * slam;
    shieldG.position.x = lerp(-0.05, 0, slam);
    shieldG.rotation.y = lerp(0.45, -0.08, slam) * (1 - settle);
    shieldG.rotation.x = lerp(0.12, -0.1, slam) * (1 - settle);
    shoulderG.position.z = -0.22 * slam * (1 - settle);
    upper.rotation.y = lerp(0.28, -0.18, slam) * (1 - settle);
    upper.rotation.x = lerp(-0.1, 0.22, slam) * (1 - settle * 0.6);
    root.position.z = -0.32 * slam * (1 - settle * 0.7);
    root.position.y = k > 0.35 ? -0.045 * Math.exp(-q * 10) : -0.04 * (1 - slam);
    legL.rotation.x = lerp(0.25, -0.2, slam);
    legR.rotation.x = lerp(-0.2, 0.3, slam);
    headG.rotation.x = lerp(-0.1, 0.2, slam);
    headG.rotation.y = lerp(-0.2, 0, slam);
    armL.rotation.x = lerp(0.5, -0.2, slam);
    armL.rotation.z = -rest - 0.25 * (1 - slam);
    hose.rotation.x = lerp(-0.3, 0.5, slam) + osc * 0.2;
    eyeScale(1.3);
  }

  function hurt(t) {
    idle(t);
    const s = Math.max(0, 1 - t / 0.4);
    upper.rotation.x += 0.3 * s * (1 + 0.3 * Math.cos(t * 18));
    upper.rotation.z += Math.sin(t * 38) * s * 0.08;
    root.position.z = 0.1 * s;
    headG.rotation.x = 0.4 * s;
    armL.rotation.x += 0.5 * s;
    fistL.position.y += 0.06 * s;
    shieldG.position.z += 0.1 * s;
    shieldG.rotation.x += 0.12 * s;
    hose.rotation.x += 0.6 * s * Math.sin(t * 20);
    eyeScale(1 + 0.5 * s);
  }

  // Topples backwards like the rest, but the door is thrown clear and lands flat in front of the body.
  function dead(k) {
    const fall = easeIn(clamp(k / 0.7, 0, 1));
    const bounce = k > 0.7 ? Math.sin(clamp((k - 0.7) / 0.3, 0, 1) * Math.PI) * 0.06 : 0;
    const theta = fall * HALF;
    root.rotation.x = theta;
    root.rotation.z = 0.15 * fall;
    root.position.y = 0.5 * Math.sin(theta) + bounce;
    root.position.z = 0.2 * fall;
    const pop = smooth(clamp((k - 0.5) / 0.4, 0, 1));
    headG.position.x = 0.6 * pop;
    headG.position.y = NECK - HIP - 0.2 * pop;
    headG.position.z = -0.2 * pop;
    headG.rotation.z = -0.8 * pop;
    headG.rotation.y = 0.6 * pop;
    upper.rotation.z = 0.2 * fall;
    armL.rotation.x = 0.4 * fall;
    armL.rotation.z = -rest - 1.1 * fall;
    fistL.position.y = -0.5 - 0.25 * fall;
    legL.rotation.x = 0.5 * fall;
    legR.rotation.x = -0.3 * fall;
    legR.rotation.z = 0.3 * fall;
    hose.rotation.z = 0.7 * fall;
    limp = fall;
    // the door tips forward off its bottom edge, thumps down and rings once
    group.add(shieldG);
    const tip = easeIn(clamp(k / 0.5, 0, 1));
    const th = HALF * tip;
    const yb = lerp(0.2, 0.07, tip);
    const ring = k > 0.5 ? Math.sin(clamp((k - 0.5) / 0.25, 0, 1) * Math.PI) * 0.05 : 0;
    shieldG.position.set(0, yb + SHIELD.h / 2 * Math.cos(th) + 0.05 * Math.sin(th) + ring, SHIELD.z - SHIELD.h / 2 * Math.sin(th));
    shieldG.rotation.set(-th, 0, 0);
    const on = k < 0.12 || (k < 0.5 && Math.sin(k * 90) > 0);
    for (const e of eyes) e.visible = on;
    lamp.visible = on;
  }

  // Shield hit: a timer that update(dt) runs down, and a wall-clock stamp as a back-stop for callers that never update.
  let hitT = 0;
  let hitAt = -1e9;
  function hitFactor() {
    return clamp(Math.min(hitT / 0.12, 1 - (wallNow() - hitAt) / 120), 0, 1);
  }
  function shieldHit() {
    hitT = 0.12;
    hitAt = wallNow();
  }

  // The right arm follows the door's handle, wherever the pose has put it.
  function placeArm() {
    if (limp > 0) {
      _G.copy(S0).add(_v.set(0.15, -0.9, 0.15 * limp)); // hanging: a point below the shoulder
    } else {
      _G.set(SHIELD.grip[0], SHIELD.grip[1], SHIELD.grip[2]).applyEuler(shieldG.rotation).add(shieldG.position);
    }
    const S = shoulderG.position;
    const stretch = twoBone(S, _G, _pole, 0.5, 0.55, _E);
    boneU.position.copy(S);
    boneU.quaternion.setFromUnitVectors(down, _v.copy(_E).sub(S).normalize());
    boneU.scale.set(1, stretch, 1);
    boneL.position.copy(_E);
    boneL.quaternion.setFromUnitVectors(down, _v.copy(_G).sub(_E).normalize());
    boneL.scale.set(1, stretch, 1);
  }

  function setPose(state, t, k) {
    t = Math.max(0, num(t, 0));
    k = clamp(num(k, 0), 0, 1);
    reset();
    switch (state) {
      case 'walk': walk(t); break;
      case 'windup': case 'aim': windup(k); break;
      case 'swing': case 'shoot': swing(k); break;
      case 'hurt': hurt(t); break;
      case 'dead': dead(k); break;
      default: idle(t);
    }
    const f = state === 'dead' ? 0 : hitFactor();
    if (f > 0) {
      shieldG.position.z += 0.1 * f;
      shieldG.rotation.x += 0.07 * f;
      shieldG.rotation.z += 0.03 * f * Math.sin(wallNow() * 0.05);
      upper.rotation.x += 0.03 * f;
      glow.visible = true;
      glowMat.opacity = f;
    }
    placeArm();
  }

  function flash(on) {
    for (const m of meshes) m.material = on ? white : m.userData.base;
  }

  function update(dt) {
    hitT = Math.max(0, hitT - Math.max(0, num(dt, 0)));
    rig.update(dt);
  }

  setPose('idle', 0, 0);
  return { group, height: 2.1, radius: 0.7, headY: 1.7, eyes, setPose, flash, update, shieldHit, muzzle: null };
}

// ---- The Tour Guide ----

// Tartan from flat-coloured cells: `at(u, v, out)` writes a point on any surface, each cell takes the colour of the
// warp stripe crossing the weft stripe, normals follow the surface. Cheap, and it reads as plaid at game distances.
const TARTAN = { r: 0xa3202a, g: 0x1f5a36, k: 0x14161c, y: 0xd2ae3a };
const TARTAN_SETT = 'rrkgggkrry'.split('').map((c) => new THREE.Color(TARTAN[c]));

function tartanGeo(nu, nv, at, { inward = false, plain = null, sett = TARTAN_SETT } = {}) {
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  const P0 = new THREE.Vector3();
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const Nn = new THREE.Vector3();
  const pts = [];
  const nrm = [];
  const e = 0.002;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      at(u, v, P0);
      at(Math.min(1, u + e), v, A);
      at(Math.max(0, u - e), v, B);
      const du = A.clone().sub(B);
      at(u, Math.min(1, v + e), A);
      at(u, Math.max(0, v - e), B);
      const dv = A.sub(B);
      Nn.crossVectors(du, dv).normalize();
      if (Nn.x * P0.x + Nn.z * P0.z < 0) Nn.negate(); // surfaces here all wrap an upright axis: outward
      if (inward) Nn.negate();
      pts.push(P0.clone());
      nrm.push(Nn.clone());
    }
  }
  const W = nu + 1;
  const c = new THREE.Color();
  let n = 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const corners = [j * W + i, j * W + i + 1, (j + 1) * W + i + 1, (j + 1) * W + i];
      if (plain !== null) c.set(plain);
      else {
        c.copy(sett[i % sett.length]).lerp(sett[j % sett.length], 0.5).multiplyScalar((i + j) % 4 < 2 ? 1 : 0.86);
      }
      for (const k of corners) {
        pos.push(pts[k].x, pts[k].y, pts[k].z);
        nor.push(nrm[k].x, nrm[k].y, nrm[k].z);
        col.push(c.r, c.g, c.b);
      }
      // wind the cell so its face points the way the normal does
      const q0 = pts[corners[0]];
      const gn = new THREE.Vector3().crossVectors(pts[corners[1]].clone().sub(q0), pts[corners[2]].clone().sub(q0));
      if (gn.dot(nrm[corners[0]]) >= 0) idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
      else idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
      n += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('vcol', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// Radius of a lathe profile at height y (profile given bottom to top as [r, y]).
function profileR(pts, y) {
  for (let i = 1; i < pts.length; i++) {
    if (y <= pts[i][1]) {
      const [r0, y0] = pts[i - 1];
      const [r1, y1] = pts[i];
      return lerp(r0, r1, clamp((y - y0) / (y1 - y0 || 1), 0, 1));
    }
  }
  return pts[pts.length - 1][0];
}

const GUIDE = { hip: 0.8, neck: 2.15, shoulderX: 0.68, shoulderY: 1.92, wrist: -0.78, hatY: 2.58 };
const GUIDE_BOTTLE = [[0, 0.78], [0.34, 0.78], [0.42, 0.84], [0.48, 0.95], [0.51, 1.15], [0.51, 1.35], [0.48, 1.55], [0.42, 1.72], [0.34, 1.86], [0.24, 1.98], [0.16, 2.06], [0.14, 2.18], [0, 2.18]];
const BELL_INNER = [[0, -0.92], [0.05, -0.92], [0.05, -1.0], [0.07, -1.08], [0.14, -1.22], [0.22, -1.37], [0.3, -1.5], [0.36, -1.6], [0.36, -1.64]];
const BELL_OUTER = [[0.36, -1.64], [0.4, -1.64], [0.4, -1.6], [0.33, -1.5], [0.24, -1.37], [0.16, -1.22], [0.1, -1.08], [0.08, -1.0], [0.08, -0.92], [0, -0.92]];
const GUIDE_COAT = [[0.78, 0.6], [0.74, 0.75], [0.66, 1.0], [0.6, 1.25], [0.56, 1.5], [0.5, 1.68]];

function tourGuideGeo(v) {
  const HIP = GUIDE.hip;
  const NECK = GUIDE.neck;
  const o = { seed: v + 14, tint: [0, 0.04, -0.04][v] };
  const BLACK = 0x1a171c;
  const BOTTLE = 0x1f4a32;
  const BRASS_B = 0xb08a3a;
  const bottle = dent(lathe(GUIDE_BOTTLE, 28), [[-0.3, 0.1, -0.4, 0.2, 0.025], [0.4, -0.3, 0.2, 0.2, 0.02]]);
  const skirt = (pts, phi0, phiL, seg = 30) => withEdge(new THREE.LatheGeometry(pts.map(([r, y]) => v2(r, y)), seg, phi0, phiL));
  const coatOuter = skirt(GUIDE_COAT, -2.2, 4.4);
  const coatInner = skirt(GUIDE_COAT.map(([r, y]) => [r - 0.035, y]).reverse(), -2.2, 4.4);

  // the cape hangs from the shoulders round the back, the sash crosses the chest from the right shoulder
  const capeAt = (u, w, out) => {
    const th = lerp(-2.05, 2.05, u);
    const y = lerp(1.98, 1.18, w);
    const r = lerp(0.42, 0.66, Math.pow(w, 0.85)) + Math.sin(th * 5.5) * 0.04 * smooth(w);
    out.set(Math.sin(th) * r, y, Math.cos(th) * r);
  };
  const cape = tartanGeo(44, 13, capeAt);
  const capeLining = tartanGeo(10, 4, (u, w, out) => { capeAt(u, w, out); out.x *= 0.95; out.z *= 0.95; out.y -= 0.01; }, { inward: true, plain: 0x4a1216 });
  const sashAt = (u, w, out) => {
    const x0 = lerp(0.27, -0.4, w);
    const y0 = lerp(1.84, 1.0, w);
    // across the sash: perpendicular to its run in the x-y plane
    const dx = -0.67;
    const dy = -0.84;
    const l = Math.hypot(dx, dy);
    const t = (u - 0.5) * 0.26;
    const x = x0 + (dy / l) * t * -1;
    const y = y0 + (dx / l) * t;
    const R = profileR(GUIDE_BOTTLE, y) + 0.03;
    out.set(x, y, -Math.sqrt(Math.max(0.0004, R * R - x * x)));
  };
  const sash = tartanGeo(5, 22, sashAt);
  const hem = tartanGeo(64, 2, (u, w, out) => {
    const th = lerp(-2.2, 2.2, u);
    const y = lerp(0.6, 0.74, w);
    const r = profileR(GUIDE_COAT, y) + 0.012;
    out.set(Math.sin(th) * r, y, Math.cos(th) * r);
  });
  const hatBand = tartanGeo(30, 2, (u, w, out) => {
    const th = u * Math.PI * 2;
    out.set(Math.sin(th) * 0.231, 0.05 + w * 0.09, Math.cos(th) * 0.231);
  });
  const bz = -Math.sqrt(Math.max(0.01, (profileR(GUIDE_BOTTLE, 1.78) + 0.03) ** 2 - 0.27 ** 2)) - 0.012;
  const bolt = once('tg:bolt', () => withEdge(new THREE.CylinderGeometry(0.02, 0.02, 0.018, 5, 1)));
  const edgeTube = (sgn) => tube([[0.63, 0.62, -0.46], [0.53, 1.0, -0.39], [0.47, 1.4, -0.34], [0.4, 1.68, -0.3]].map(([x, y, z]) => [sgn * x, y, z]), 0.028, 20, 5);

  return {
    leg: bake([
      P(rcyl(0.15, 0.13, 0.44, 0.04, 16, 2), 0x1f3b2a, 'cloth', [0, -0.22, 0]),
      P(rcyl(0.155, 0.155, 0.05, 0.015, 16), 0x8a1c20, 'cloth', [0, -0.46, 0]),
      P(rcyl(0.125, 0.105, 0.3, 0.035, 16), 0x1f3b2a, 'cloth', [0, -0.6, 0]),
      P(rcyl(0.14, 0.12, 0.15, 0.03, 16), 0xd8d2bf, 'cloth', [0, -0.66, 0]),
      ...[0.5, 0.62, 0.74].map((y) => P(rbox(0.012, 0.012, 0.01, 0.003), C.brass, 'brass', [0, -y, -0.13])),
      P(rbox(0.3, 0.17, 0.5, 0.08, true), BLACK, 'leather', [0, -0.725, -0.09]),
      P(rbox(0.32, 0.05, 0.54, 0.02), C.rubber, 'rubber', [0, -0.775, -0.09]),
      P(rbox(0.2, 0.09, 0.1, 0.04), BRASS_B, 'brass', [0, -0.73, -0.3], [0, 0, 0], [1, 1, 1], { rust: 0.15 }),
      P(rbox(0.1, 0.1, 0.02, 0.008), BRASS_B, 'brass', [0, -0.68, -0.12]),
      P(torus(0.14, 0.02, 14, 5), C.brass, 'brass', [0, -0.12, 0], [HALF, 0, 0]),
    ], { originY: HIP, ...o }),
    torso: bake([
      P(rcyl(0.43, 0.43, 0.1, 0.03, 22), C.black, 'leather', [0, 0.86, 0]),
      P(rbox(0.15, 0.13, 0.025, 0.012), BRASS_B, 'brass', [0, 0.86, -0.435]),
      P(bottle, BOTTLE, 'gloss', [0, 0, 0], [0, 0, 0], [1, 1, 1], { rust: 0.12 }),
      ...[1.0, 1.5, 1.78].map((y) => P(torus(profileR(GUIDE_BOTTLE, y) + 0.01, 0.014, 28, 5), BRASS_B, 'brass', [0, y, 0], [HALF, 0, 0])),
      // nameplate on the belly and buttons on the coat front
      P(rbox(0.2, 0.12, 0.02, 0.01), BRASS_B, 'brass', [0.2, 1.12, -0.515], [0, 0.15, 0]),
      P(rbox(0.15, 0.07, 0.012, 0.005), 0x16120e, 'plastic', [0.2, 1.12, -0.527], [0, 0.15, 0]),
      ...[0, 1, 2].map((i) => P(ball(0.022, 8, 6), BRASS_B, 'brass', [0.34 - i * 0.0, 1.45 - i * 0.2, -0.43 + i * 0.03])),
      P(coatOuter, BLACK, 'cloth', [0, 0, 0], [0, 0, 0], [1, 1, 1], { wear: 0.4 }),
      P(coatInner, 0x3a1014, 'cloth'),
      P(hem, 0xffffff, 'cloth'),
      P(capeLining, 0xffffff, 'cloth'),
      P(cape, 0xffffff, 'cloth'),
      P(sash, 0xffffff, 'cloth'),
      P(edgeTube(1), BRASS_B, 'brass'),
      P(edgeTube(-1), BRASS_B, 'brass'),
      // collar, brooch on the sash, yoke and shoulder caps
      P(lathe([[0.14, 1.98], [0.23, 2.04], [0.27, 2.1], [0.22, 2.18], [0.17, 2.2], [0.15, 2.12]], 20), 0xd8d2bf, 'cloth', [0, 0, 0]),
      P(rcyl(0.07, 0.07, 0.025, 0.008, 14), BRASS_B, 'brass', [0.27, 1.78, bz], [HALF, 0, 0]),
      P(ball(0.032, 8, 6), 0xd08a1c, 'glass', [0.27, 1.78, bz - 0.02]),
      P(capsule(0.1, 0.8), BLACK, 'cloth', [0, 1.9, 0], [0, 0, HALF]),
      ...[-1, 1].map((s) => P(ball(0.19, 14, 8), BRASS_B, 'brass', [s * GUIDE.shoulderX, 2.0, 0], [0, 0, 0], [1, 0.55, 1], { rust: 0.15 })),
      // a steam pack on the back
      P(rcyl(0.16, 0.16, 0.56, 0.05, 18), BRASS_B, 'brass', [0, 1.45, 0.76], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      ...[1.22, 1.68].map((y) => P(torus(0.165, 0.016, 18, 5), C.steelD, 'metal', [0, y - 0.23, 0.76], [HALF, 0, 0])),
      P(rcyl(0.04, 0.04, 0.16, 0.012, 10), C.chrome, 'chrome', [0, 1.8, 0.76]),
      P(torus(0.055, 0.012, 14, 5), C.chrome, 'chrome', [0.1, 1.5, 0.915]),
      P(rcyl(0.05, 0.05, 0.02, 0.006, 14), 0xd7cfb8, 'paper', [0.1, 1.5, 0.905], [HALF, 0, 0]),
      ...bolts(6, 0.162, 1.25, C.steelD, 0.016, 0.3).map((b) => ({ ...b, p: [b.p[0], b.p[1], b.p[2] + 0.76] })),
    ], { base: [0, HIP, 0], ...o }),
    head: bake([
      P(lathe([[0, 2.15], [0.2, 2.15], [0.25, 2.2], [0.27, 2.3], [0.27, 2.56], [0.24, 2.66], [0.16, 2.72], [0, 2.74]], 26), C.cream, 'gloss', [0, 0, 0], [0, 0, 0], [1, 1, 1], { rust: 0.2 }),
      P(rcyl(0.285, 0.285, 0.2, 0.03, 26), 0x1b1c20, 'plastic', [0, 2.45, 0]),
      ...[-1, 1].map((s) => P(torus(0.1, 0.017, 18, 5), BRASS_B, 'brass', [s * 0.12, 2.45, -0.283])),
      P(rbox(0.04, 0.03, 0.03, 0.01), BRASS_B, 'brass', [0, 2.45, -0.29]),
      // handlebar moustache, mutton chops and a monocle chain
      ...[-1, 1].map((s) => P(tube([[s * 0.02, 2.29, -0.285], [s * 0.1, 2.265, -0.3], [s * 0.2, 2.28, -0.28], [s * 0.29, 2.34, -0.24], [s * 0.3, 2.42, -0.2]], 0.032, 22, 6), 0xcfcbc0, 'cloth')),
      ...[-1, 1].map((s) => P(ball(0.075, 10, 7), 0xcfcbc0, 'cloth', [s * 0.26, 2.3, -0.07], [0, 0, 0], [0.7, 1.5, 1])),
      P(rbox(0.16, 0.045, 0.03, 0.012), 0x0a0a0c, 'plastic', [0, 2.2, -0.27]),
      P(tube([[0.2, 2.38, -0.29], [0.33, 2.3, -0.24], [0.34, 2.12, -0.2]], 0.007, 14, 4), BRASS_B, 'brass'),
      P(rcyl(0.03, 0.03, 0.016, 0.005, 10), BRASS_B, 'brass', [0.34, 2.11, -0.2], [HALF, 0, 0]),
      P(rcyl(0.04, 0.04, 0.05, 0.015, 12), BRASS_B, 'brass', [0, 2.745, 0]),
    ], { base: [0, NECK, 0], ...o }),
    hat: bake([
      P(rcyl(0.37, 0.37, 0.045, 0.018, 28), BLACK, 'cloth', [0, 0.02, 0], [0.03, 0, 0.02]),
      P(rcyl(0.25, 0.22, 0.4, 0.03, 26), BLACK, 'cloth', [0, 0.22, 0]),
      P(torus(0.25, 0.013, 26, 5), 0x302a30, 'cloth', [0, 0.41, 0], [HALF, 0, 0]),
      P(hatBand, 0xffffff, 'cloth'),
      P(rbox(0.1, 0.12, 0.02, 0.008), BRASS_B, 'brass', [0, 0.12, -0.24]),
      P(rbox(0.055, 0.07, 0.024, 0.006), 0x120e0c, 'plastic', [0, 0.12, -0.246]),
      P(ball(0.04, 8, 6), 0x7a3a8a, 'cloth', [0.2, 0.15, -0.15]),
      P(cone(0.035, 0.13, 6), 0x2f6a3a, 'cloth', [0.22, 0.09, -0.15], [0.3, 0, -0.5]),
    ], { originY: GUIDE.hatY, ...o }),
    eye: rcyl(0.075, 0.075, 0.035, 0.012, 16),
    arm: bake([
      P(ball(0.14), BRASS_B, 'brass'),
      P(rcyl(0.14, 0.115, 0.56, 0.04, 16, 2), BLACK, 'cloth', [0, -0.34, 0]),
      P(rcyl(0.125, 0.125, 0.07, 0.02, 16), 0x8a1c20, 'cloth', [0, -0.64, 0]),
      P(rcyl(0.1, 0.1, 0.03, 0.01, 14), BRASS_B, 'brass', [0, -0.69, 0]),
      P(rbox(0.19, 0.2, 0.2, 0.07), C.black, 'leather', [0, -0.79, 0]),
      P(capsule(0.035, 0.07), C.black, 'leather', [0.1, -0.76, -0.05], [0.5, 0, 0.5]),
    ], { originY: GUIDE.shoulderY, ...o }),
    pole: bake([
      P(rcyl(0.04, 0.04, 2.1, 0.012, 12, 3), 0x4a3020, 'wood', [0, 0.5, 0], [0, 0, 0], [1, 1, 1], { rust: 0.1 }),
      P(rcyl(0.055, 0.045, 0.14, 0.02, 12), BRASS_B, 'brass', [0, -0.5, 0]),
      ...[-0.3, 0.3].map((y) => P(rcyl(0.052, 0.052, 0.04, 0.012, 12), BRASS_B, 'brass', [0, y, 0])),
      P(rcyl(0.052, 0.052, 0.07, 0.015, 12), BRASS_B, 'brass', [0, 1.5, 0]),
      P(ball(0.05, 8, 6), BRASS_B, 'brass', [0, 1.57, 0]),
      P(tube([[0, 1.46, 0], [-0.05, 1.62, 0], [-0.17, 1.66, 0], [-0.26, 1.57, 0], [-0.27, 1.45, 0]], 0.014, 16, 5), BRASS_B, 'brass'),
    ], { originY: 1.2, ...o }),
    lantern: bake([
      P(tube([[0, 0, 0], [0.01, -0.06, 0], [0, -0.12, 0.01], [0, -0.18, 0]], 0.012, 8, 4), C.steelD, 'metal'),
      P(torus(0.03, 0.01, 10, 4), BRASS_B, 'brass', [0, 0.0, 0], [HALF, 0, 0]),
      P(cone(0.17, 0.12, 8), BRASS_B, 'brass', [0, -0.25, 0], [0, 0, 0], [1, 1, 1], { rust: 0.2 }),
      P(rcyl(0.15, 0.15, 0.025, 0.01, 8), BRASS_B, 'brass', [0, -0.32, 0]),
      ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz]) => P(rbox(0.022, 0.4, 0.022, 0.007), BRASS_B, 'brass', [sx * 0.115, -0.53, sz * 0.115])),
      P(rbox(0.3, 0.035, 0.3, 0.012), BRASS_B, 'brass', [0, -0.74, 0], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      P(cone(0.1, 0.07, 8), C.steelD, 'metal', [0, -0.8, 0], [Math.PI, 0, 0]),
    ], { originY: 1.2, ...o }),
    cannon: bake([
      P(ball(0.14), BRASS_B, 'brass'),
      P(rcyl(0.14, 0.115, 0.56, 0.04, 16, 2), BLACK, 'cloth', [0, -0.34, 0]),
      P(rcyl(0.125, 0.125, 0.07, 0.02, 16), 0x8a1c20, 'cloth', [0, -0.64, 0]),
      P(rcyl(0.15, 0.15, 0.3, 0.04, 18), BRASS_B, 'brass', [0, -0.85, 0], [0, 0, 0], [1, 1, 1], { rust: 0.25 }),
      ...[-0.74, -0.96].map((y) => P(torus(0.155, 0.015, 18, 5), C.steelD, 'metal', [0, y, 0], [HALF, 0, 0])),
      P(rbox(0.07, 0.2, 0.07, 0.025), C.black, 'leather', [0, -0.88, 0.17], [-0.15, 0, 0]),
      P(torus(0.05, 0.012, 14, 5), C.chrome, 'chrome', [0, -0.96, 0.12], [0, HALF, 0]),
      P(tube([[0.1, -0.6, 0.1], [0.18, -0.75, 0.2], [0.1, -0.95, 0.17]], 0.022, 12, 5), C.rubber, 'rubber'),
      P(torus(0.05, 0.012, 14, 5), C.chrome, 'chrome', [0.155, -0.85, 0], [0, HALF, 0]),
      P(rcyl(0.045, 0.045, 0.02, 0.006, 14), 0xd7cfb8, 'paper', [0.15, -0.85, 0], [0, 0, HALF]),
    ], { originY: GUIDE.shoulderY, ...o }),
    barrel: bake([
      P(lathe(BELL_INNER, 26), 0x2a1e10, 'brass', [0, 0, 0], [0, 0, 0], [1, 1, 1], { rust: 0.3 }),
      P(lathe(BELL_OUTER, 26), BRASS_B, 'brass', [0, 0, 0], [0, 0, 0], [1, 1, 1], { rust: 0.15 }),
      ...[-1.62, -1.37, -1.2].map((y) => P(torus(profileR(BELL_OUTER.slice(1, 8), y) + 0.012, 0.016, 24, 5), C.steelD, 'metal', [0, y, 0], [HALF, 0, 0])),
      ...Array.from({ length: 8 }, (_, i) => P(bolt, C.steelD, 'metal', [Math.sin((i / 8) * 6.283) * 0.38, -1.645, Math.cos((i / 8) * 6.283) * 0.38], [0, 0, 0])),
    ], { originY: GUIDE.shoulderY, ...o }),
    tip: ball(0.07, 12, 8),
    core: ball(0.075, 10, 8),
    halo: radialDisc(0.4, 0xffa040, 0.7),
  };
}

// The Tour Guide: a Bampot-camp boss, so it shoots. Poses: idle, walk, hurt, dead, aim, shoot and slam (a wide
// overhead swing of the lantern pole; the hit lands at about k = 0.45). enrage() turns the eyes, lantern and
// bullhorn glow hot; it is safe to call repeatedly. `muzzle` is at the bullhorn mouth.
function makeTourGuide() {
  const kind = 'tourguide';
  const variant = (variantCount[kind] = (variantCount[kind] ?? -1) + 1) % VARIANTS;
  const geo = once(`robot:${kind}:${variant}`, () => tourGuideGeo(variant));
  const mat = pbrMat();
  const phase = (robotCount++) * 1.7;
  const HIP = GUIDE.hip;
  const NECK = GUIDE.neck;
  const SY = GUIDE.shoulderY - HIP;
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
  const legL = mk(geo.leg, mat, root, -0.3, HIP, 0);
  const legR = mk(geo.leg, mat, root, 0.3, HIP, 0);
  const upper = new THREE.Group();
  upper.position.y = HIP;
  root.add(upper);
  mk(geo.torso, mat, upper);
  const headG = new THREE.Group();
  headG.position.y = NECK - HIP;
  upper.add(headG);
  mk(geo.head, mat, headG);
  const hat = mk(geo.hat, mat, headG, 0, GUIDE.hatY - NECK, 0);
  hat.name = 'hat';
  const eyeMat = new THREE.MeshBasicMaterial({ color: hdr(0xfff0cc, 2.6), fog: false });
  const eyes = [-1, 1].map((s) => {
    const e = mk(geo.eye, eyeMat, headG, s * 0.12, 2.45 - NECK, -0.272);
    e.rotation.x = HALF;
    return e;
  });

  // left arm holds the lantern pole; the pole pivots at the hand so it can swing on its own
  const armL = new THREE.Group();
  armL.position.set(-GUIDE.shoulderX, SY, 0);
  upper.add(armL);
  mk(geo.arm, mat, armL);
  const poleG = new THREE.Group();
  poleG.name = 'pole';
  poleG.position.set(0, GUIDE.wrist, 0);
  armL.add(poleG);
  mk(geo.pole, mat, poleG, 0, 0, 0);
  const lanternG = new THREE.Group();
  lanternG.name = 'lantern';
  lanternG.position.set(-0.27, 1.43, 0);
  poleG.add(lanternG);
  mk(geo.lantern, mat, lanternG);
  const FLAME = 0xffa838;
  const lanternMat = new THREE.MeshBasicMaterial({ color: hdr(FLAME, 4.5), fog: false });
  const haloMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const core = mk(geo.core, lanternMat, lanternG, 0, -0.53, 0);
  core.scale.set(1, 1.5, 1);
  const halo = new THREE.Mesh(geo.halo, haloMat);
  halo.position.set(0, -0.53, 0);
  lanternG.add(halo);
  // a soft glow that always faces the camera
  const _hq = new THREE.Quaternion();
  const _cq = new THREE.Quaternion();
  halo.onBeforeRender = (rend, scn, cam) => {
    halo.parent.getWorldQuaternion(_hq).invert();
    halo.quaternion.copy(_hq.multiply(cam.getWorldQuaternion(_cq)));
    halo.updateMatrix();
    halo.matrixWorld.multiplyMatrices(halo.parent.matrixWorld, halo.matrix);
  };

  // right arm: the bullhorn that fires the bottles
  const armR = new THREE.Group();
  armR.position.set(GUIDE.shoulderX, SY, 0);
  upper.add(armR);
  const cannonMesh = new THREE.Group();
  armR.add(cannonMesh);
  mk(geo.cannon, mat, cannonMesh);
  const barrelG = new THREE.Group();
  cannonMesh.add(barrelG);
  mk(geo.barrel, mat, barrelG);
  const tipMat = new THREE.MeshBasicMaterial({ color: hdr(0xff8a28, 2.6), fog: false });
  const tip = mk(geo.tip, tipMat, barrelG, 0, -1.56, 0);
  tip.scale.set(1.8, 0.5, 1.8);
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, -1.66, 0);
  barrelG.add(muzzle);

  const rig = flickerRig(phase, eyeMat, null);
  const white = whiteMat();
  const rest = 0.12;
  let enraged = false;
  let flame = 1;

  function reset() {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    legL.rotation.set(0, 0, 0);
    legR.rotation.set(0, 0, 0);
    upper.position.set(0, HIP, 0);
    upper.rotation.set(0, 0, 0);
    upper.scale.set(1, 1, 1);
    headG.position.set(0, NECK - HIP, 0);
    headG.rotation.set(0, 0, 0);
    hat.position.set(0, GUIDE.hatY - NECK, 0);
    hat.rotation.set(0, 0, 0);
    pole(0, -0.05);
    armR.rotation.set(0.4, 0, rest);
    barrelG.position.set(0, 0, 0);
    tip.scale.set(1.8, 0.5, 1.8);
    lanternG.rotation.set(0, 0, 0);
    core.visible = true;
    halo.visible = true;
    for (const e of eyes) {
      e.visible = true;
      e.scale.set(1, 1, 1);
    }
  }
  // Left arm raised by `theta`, the pole pitched to `psi` in the world (0 up, negative leans forward).
  // The pose functions only say where the arm and pole should end up; setPose applies it once the body's lean is known,
  // so the pole's pitch in the world is what the pose asked for whichever way the body is leaning.
  let tTheta = 0;
  let tPsi = 0;
  let tOut = rest;
  function pole(theta, psi, out = rest) {
    tTheta = theta;
    tPsi = psi;
    tOut = out;
  }
  const eyeScale = (s) => {
    const k = s * (enraged ? 1.12 : 1);
    for (const e of eyes) e.scale.set(k, k, 1);
  };

  function idle(t) {
    const s = t + phase;
    const hot = enraged ? 1.5 : 1;
    upper.scale.y = 1 + 0.01 * Math.sin(s * 2 * hot);
    upper.scale.x = upper.scale.z = 1 - 0.004 * Math.sin(s * 2 * hot);
    upper.rotation.z = 0.02 * Math.sin(s * 1.05);
    upper.rotation.x = 0.015 * Math.sin(s * 0.8 + 1);
    pole(0.03 * Math.sin(s * 1.5), -0.06 + 0.03 * Math.sin(s * 1.2));
    armR.rotation.x = 0.4 + 0.04 * Math.sin(s * 1.6 + 1.5);
    headG.rotation.y = 0.18 * Math.sin(s * 0.6);
    headG.rotation.x = 0.02 * Math.sin(s * 1.3);
    hat.rotation.z = 0.02 * Math.sin(s * 1.1);
    lanternG.rotation.set(0.07 * Math.sin(s * 1.9), 0, 0.11 * Math.sin(s * 1.4 + 1));
    eyeScale(1 + 0.08 * Math.sin(s * 5));
  }

  function walk(t) {
    const c = t * 5.4 * (enraged ? 1.15 : 1) + phase;
    const sL = Math.sin(c);
    legL.rotation.x = sL * 0.62;
    legR.rotation.x = -sL * 0.62;
    root.position.y = Math.abs(sL) * 0.05;
    upper.rotation.z = sL * 0.04;
    upper.rotation.x = -0.07 + 0.02 * Math.cos(c * 2);
    // the pole is planted every other step like a walking stick
    pole(-sL * 0.12, -0.12 - sL * 0.14);
    armR.rotation.x = 0.5 + 0.06 * sL;
    headG.rotation.y = -sL * 0.05;
    headG.rotation.x = 0.04 - 0.03 * Math.cos(c * 2);
    hat.rotation.z = 0.04 * Math.cos(c * 2);
    lanternG.rotation.set(0.2 * Math.cos(c), 0, 0.15 * sL);
    eyeScale(1 + 0.05 * Math.sin(c * 2));
  }

  function aim(t) {
    const a = easeOut(clamp(t / 0.3, 0, 1));
    const sway = Math.sin(t * 7 + phase) * 0.012;
    armR.rotation.x = lerp(0.4, 1.35, a) + sway + Math.sin(a * Math.PI) * 0.06;
    armR.rotation.z = lerp(rest, 0.03, a);
    pole(0.3 * a, -0.06 + 0.1 * a);
    upper.rotation.x = -0.06 * a;
    headG.rotation.x = 0.08 * a;
    barrelG.position.y = 0.04 * (1 - a);
    hat.rotation.z = 0.02 * Math.sin(t * 30) * (1 - a);
    lanternG.rotation.set(0.05 * Math.sin(t * 5), 0, 0.1 * Math.sin(t * 4));
    eyeScale(1 + 0.2 * a);
  }

  function shoot(k) {
    const r = Math.exp(-k * 7);
    armR.rotation.x = 1.35 + 0.45 * r;
    armR.rotation.z = 0.03;
    barrelG.position.y = 0.26 * r;
    tip.scale.set(1.8 + 1.4 * r, 0.5 + 1.2 * r, 1.8 + 1.4 * r);
    pole(0.3, 0.04);
    upper.rotation.x = 0.2 * r - 0.06;
    root.position.z = 0.14 * r;
    headG.rotation.x = 0.08 + 0.2 * r;
    hat.rotation.z = Math.sin(k * 70) * 0.07 * r;
    hat.position.y += 0.02 * r;
    lanternG.rotation.set(0.5 * r * Math.sin(k * 30), 0, 0.3 * r);
    eyeScale(1.2 + 0.3 * r);
  }

  // Overhead swing of the pole. k 0..0.3 raises it back over the shoulder, a beat of shudder, then the fast arc down
  // through the vertical (impact at k about 0.45), and the follow-through eases back towards a guard.
  function slam(k) {
    const w = easeOut(clamp(k / 0.27, 0, 1));
    const s = Math.pow(clamp((k - 0.3) / 0.15, 0, 1), 1.7);
    const q = clamp((k - 0.45) / 0.55, 0, 1);
    const rec = smooth(clamp((q - 0.25) / 0.75, 0, 1));
    const osc = k > 0.45 ? Math.sin((k - 0.45) * 26) * Math.exp(-(k - 0.45) * 9) : 0;
    const theta = lerp(lerp(0, 1.5, w), 1.3, s);
    const psi = lerp(lerp(-0.06, 1.25, w), -1.75, s);
    pole(lerp(theta, 0.2, rec), lerp(psi - osc * 0.2, -0.3, rec), lerp(rest, 0.02, w * (1 - rec)));
    const shudder = k > 0.26 && k < 0.31 ? Math.sin(k * 300) * 0.015 : 0;
    upper.rotation.x = lerp(lerp(0, -0.2, w) + shudder, 0.38, s) * (1 - rec) + 0.05 * osc;
    upper.rotation.y = lerp(0, 0.3, w) * (1 - s) * (1 - rec);
    root.position.z = -0.5 * s * (1 - rec * 0.8);
    root.position.y = -0.06 * s * (1 - rec);
    legL.rotation.x = lerp(0, 0.3, w) * (1 - rec) - 0.35 * s * (1 - rec);
    legR.rotation.x = lerp(0, -0.25, w) * (1 - rec) + 0.4 * s * (1 - rec);
    headG.rotation.x = lerp(-0.12 * w, 0.3, s) * (1 - rec);
    hat.rotation.x = -0.12 * s * (1 - rec);
    armR.rotation.x = 0.4 - 0.55 * w * (1 - rec) + 0.7 * s * (1 - rec);
    lanternG.rotation.set(-0.6 * s * (1 - rec) + osc * 0.6, 0, 0.35 * w * (1 - s));
    eyeScale(1.35);
  }

  function hurt(t) {
    idle(t);
    const s = Math.max(0, 1 - t / 0.4);
    upper.rotation.x += 0.34 * s * (1 + 0.3 * Math.cos(t * 18));
    upper.rotation.z += Math.sin(t * 38) * s * 0.08;
    root.position.z = 0.1 * s;
    headG.rotation.x = 0.4 * s;
    tTheta += 0.3 * s;
    armR.rotation.x += 0.4 * s;
    hat.position.y += 0.06 * s;
    hat.rotation.z = Math.sin(t * 45) * 0.12 * s;
    lanternG.rotation.z += 0.5 * s * Math.sin(t * 22);
    eyeScale(1 + 0.5 * s);
  }

  function dead(k) {
    // Topples backwards; the hat spins off, the pole drops and the lantern gutters out.
    const fall = easeIn(clamp(k / 0.7, 0, 1));
    const bounce = k > 0.7 ? Math.sin(clamp((k - 0.7) / 0.3, 0, 1) * Math.PI) * 0.07 : 0;
    const theta = fall * HALF;
    root.rotation.x = theta;
    root.rotation.z = 0.12 * fall;
    root.position.y = 0.5 * Math.sin(theta) + bounce;
    root.position.z = 0.25 * fall;
    const pop = smooth(clamp((k - 0.45) / 0.45, 0, 1));
    headG.rotation.z = -0.5 * pop;
    headG.rotation.y = 0.5 * pop;
    headG.position.y = NECK - HIP - 0.1 * pop;
    hat.position.x = 0.7 * pop;
    hat.position.y = GUIDE.hatY - NECK + 0.7 * Math.sin(pop * Math.PI) - 0.2 * pop;
    hat.position.z = -0.5 * pop;
    hat.rotation.z = 3.2 * pop;
    upper.rotation.z = 0.2 * fall;
    pole(0.5 * fall, 0.4 * fall, rest + 0.9 * fall);
    armR.rotation.set(0.4 - 0.7 * fall, 0, rest + 0.9 * fall);
    barrelG.position.y = 0.05 * fall;
    legL.rotation.x = 0.5 * fall;
    legR.rotation.x = -0.3 * fall;
    legR.rotation.z = 0.3 * fall;
    lanternG.rotation.set(0.4 * fall, 0, 0.4 * fall);
    const on = k < 0.12 || (k < 0.5 && Math.sin(k * 90) > 0);
    for (const e of eyes) e.visible = on;
    const lit = k < 0.3 || (k < 0.7 && Math.sin(k * 60) > 0);
    core.visible = lit;
    halo.visible = lit;
  }

  function setPose(state, t, k) {
    t = Math.max(0, num(t, 0));
    k = clamp(num(k, 0), 0, 1);
    reset();
    switch (state) {
      case 'walk': walk(t); break;
      case 'aim': aim(t); break;
      case 'shoot': shoot(k); break;
      case 'slam': case 'swing': slam(k); break;
      case 'windup': slam(k * 0.3); break;
      case 'hurt': hurt(t); break;
      case 'dead': dead(k); break;
      default: idle(t);
    }
    const lean = state === 'dead' ? 0 : upper.rotation.x;
    armL.rotation.set(tTheta, 0, -tOut);
    poleG.rotation.set(tPsi - tTheta - lean, 0, 0);
    lanternG.rotation.x -= tPsi * 0.9; // the lantern hangs from its hook whichever way the pole points
  }

  function flash(on) {
    for (const m of meshes) m.material = on ? white : m.userData.base;
  }

  function enrage() {
    if (!enraged) {
      enraged = true;
      rig.tintEyes(0xff1e0a, 2.4);
      lanternMat.color.copy(hdr(0xff3a10, 4.5));
      haloMat.color.setRGB(1, 0.3, 0.2); // the glow's vertex colours are amber: this pushes them towards red
      tipMat.color.copy(hdr(0xff2a08, 3.2));
      halo.scale.setScalar(1.2);
    }
  }

  let clock = 0;
  function update(dt) {
    rig.update(dt);
    clock += clamp(num(dt, 0), 0, 0.1);
    const f = 1 + 0.16 * Math.sin(clock * 23 + phase) * Math.sin(clock * 7.3) + 0.06 * Math.sin(clock * 41);
    if (Math.abs(f - flame) > 1e-4) {
      lanternMat.color.multiplyScalar(f / flame);
      flame = f;
    }
  }

  setPose('idle', 0, 0);
  return {
    group, height: 3.0, radius: 0.9, headY: 2.45, eyes, setPose, flash, update, enrage, muzzle,
    get enraged() { return enraged; },
  };
}

// ---------------------------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------------------------

export const WEAPON_IDS = ['pistol', 'shotgun', 'smg', 'launcher', 'vinyl'];

// Plinth ring colour per weapon and the colour of each gun's small indicator lamp.
const WEAPON_COLOUR = { pistol: COLOURS.cyan, shotgun: COLOURS.amber, smg: 0xa77bff, launcher: COLOURS.magenta, vinyl: 0xff4fd8 };
const WOOD = 0x6b4a2c;
const TAPE = 0x4c483f;
const BRASS = 0x9a7a34;
const PAPER = 0x2a2420; // speaker cone
const STEEL = 0x55585e;
const GUNMETAL = 0x3c3f46;
const GW = { originY: 1.3 }; // weapons are not grimed towards the floor

const rot = (a, b = 0, c = 0) => [a, b, c];
const gp = (...a) => P(...a);
const fwd = [HALF, 0, 0]; // lay a cylinder along z


// Glowing parts merged into one geometry with HDR vertex colours (for MeshBasicMaterial({ vertexColors: true })).
// parts: { geo, hex, k, p, r, s }
function glowMerge(parts) {
  const pos = [];
  const nor = [];
  const col = [];
  const idx = [];
  let off = 0;
  for (const o of parts) {
    const g = o.geo;
    _e.set(...(o.r || [0, 0, 0]));
    _q.setFromEuler(_e);
    _p.set(...(o.p || [0, 0, 0]));
    _s.set(...(o.s || [1, 1, 1]));
    _m.compose(_p, _q, _s);
    _nm.getNormalMatrix(_m);
    const c = hdr(o.hex, o.k);
    const Pa = g.attributes.position;
    const Na = g.attributes.normal;
    for (let i = 0; i < Pa.count; i++) {
      _vv.fromBufferAttribute(Pa, i).applyMatrix4(_m);
      _nn.fromBufferAttribute(Na, i).applyMatrix3(_nm).normalize();
      pos.push(_vv.x, _vv.y, _vv.z);
      nor.push(_nn.x, _nn.y, _nn.z);
      col.push(c.r, c.g, c.b);
    }
    const ia = g.index.array;
    for (let t = 0; t < ia.length; t++) idx.push(ia[t] + off);
    off += Pa.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

// A vinyl record of radius R lying flat (axis y): black grooved disc and a two-tone HDR label, one half magenta and one
// half hot pink with a notch cut out, so a spin is easy to see. Returns a Group named 'record'; spin it about y.
const flatRing = (r0, r1, a0 = 0, a = Math.PI * 2) => new THREE.RingGeometry(r0, r1, 40, 1, a0, a);
function recordParts(R) {
  const h = R * 0.06; // half thickness
  const top = [-HALF, 0, 0];
  const bot = [HALF, 0, 0];
  const grooves = [[0.9, 0.95], [0.8, 0.84], [0.7, 0.74], [0.6, 0.64], [0.5, 0.53]];
  return {
    vinyl: [
      P(lathe([[0, -h], [R - 0.004, -h], [R, -h + 0.004], [R, h - 0.004], [R - 0.004, h], [0, h]], 40), 0x0b0b0e, 'gloss'),
      ...grooves.flatMap(([a, b]) => [
        P(flatRing(R * a, R * b), 0x2c2c36, 'gloss', [0, h + 0.0004, 0], top),
        P(flatRing(R * a, R * b), 0x2c2c36, 'gloss', [0, -h - 0.0004, 0], bot),
      ]),
      P(withEdge(new THREE.CylinderGeometry(R * 0.07, R * 0.07, h * 4, 14, 1)), C.chrome, 'chrome'),
    ],
    label: [
      // the main label with a 50-degree notch, a half-ring inside it in a hotter pink, and a pip on the rim
      { geo: flatRing(R * 0.2, R * 0.46, 0.9, Math.PI * 2 - 0.9), hex: COLOURS.magenta, k: 3.2, p: [0, h + 0.0012, 0], r: top },
      { geo: flatRing(R * 0.2, R * 0.46, 0.9, Math.PI * 2 - 0.9), hex: COLOURS.magenta, k: 3.2, p: [0, -h - 0.0012, 0], r: bot },
      { geo: flatRing(R * 0.1, R * 0.2, 0, Math.PI), hex: 0xffa6e6, k: 3.4, p: [0, h + 0.0016, 0], r: top },
      { geo: flatRing(R * 0.1, R * 0.2, 0, Math.PI), hex: 0xffa6e6, k: 3.4, p: [0, -h - 0.0016, 0], r: bot },
      { geo: new THREE.SphereGeometry(R * 0.07, 8, 6), hex: 0xffffff, k: 4, p: [R * 0.78, 0, 0] },
    ],
  };
}

function makeRecord(R, seed = 5) {
  const g = new THREE.Group();
  g.name = 'record';
  const geo = once(`record:${R}`, () => {
    const parts = recordParts(R);
    return { vinyl: bake(parts.vinyl, { ...GW, seed }), label: glowMerge(parts.label) };
  });
  const body = new THREE.Mesh(geo.vinyl, pbrMat());
  body.name = 'vinyl';
  const label = new THREE.Mesh(geo.label, once('recordLabelMat', () => new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
  label.name = 'label';
  g.add(body, label);
  return g;
}

const WEAPON_PARTS = {
  pistol() {
    const rake = rot(-0.2);
    return {
      muzzle: [0, 0.045, -0.4],
      lamp: [0, 0.088, -0.005],
      body: [
        gp(rbox(0.062, 0.075, 0.38, 0.014, true), GUNMETAL, 'gloss', [0, 0.045, -0.15], [0, 0, 0], [1, 1, 1], { rust: 0.1 }),
        ...[0, 1, 2, 3, 4].map((i) => gp(rbox(0.066, 0.05, 0.007, 0.002), 0x14151a, 'metal', [0, 0.05, 0.02 - i * 0.02])),
        gp(rbox(0.052, 0.04, 0.2, 0.014), 0x2a2b2e, 'gloss', [0, 0.0, -0.08]),
        gp(rcyl(0.014, 0.014, 0.06, 0.004, 10), STEEL, 'metal', [0, 0.045, -0.365], fwd),
        gp(rcyl(0.02, 0.048, 0.06, 0.01, 18), PAPER, 'paper', [0, 0.045, -0.37], fwd),
        gp(torus(0.049, 0.007, 20, 5), C.chrome, 'chrome', [0, 0.045, -0.4]),
        gp(rcyl(0.032, 0.032, 0.006, 0.002, 14), 0x050505, 'plastic', [0, 0.045, -0.396], fwd),
        gp(torus(0.026, 0.006, 14, 5), STEEL, 'metal', [0, -0.034, -0.02], [0, HALF, 0]),
        gp(capsule(0.006, 0.014), STEEL, 'metal', [0, -0.025, -0.02]),
        gp(rbox(0.062, 0.17, 0.078, 0.02, true), 0x161616, 'rubber', [0, -0.085, 0.03], rake),
        ...[-0.05, -0.01, 0.03, 0.07].map((d) => gp(rbox(0.067, 0.012, 0.083, 0.004), TAPE, 'tape', [0, -0.085 + d, 0.03 - 0.2 * d], rake)),
        ...[-1, 1].map((s) => gp(rbox(0.008, 0.11, 0.06, 0.003), WOOD, 'wood', [s * 0.034, -0.08, 0.03], rake)),
        gp(rbox(0.02, 0.03, 0.03, 0.006), STEEL, 'metal', [0, 0.092, 0.05]),
        gp(rbox(0.03, 0.014, 0.014, 0.004), STEEL, 'metal', [0, 0.087, 0.03]),
        gp(rbox(0.01, 0.016, 0.012, 0.003), STEEL, 'metal', [0, 0.087, -0.31]),
      ],
    };
  },
  shotgun() {
    return {
      muzzle: [0, 0.05, -0.6],
      lamp: [0.03, 0.084, 0.07],
      body: [
        gp(rbox(0.078, 0.1, 0.22, 0.02, true), GUNMETAL, 'gloss', [0, 0.03, 0], [0, 0, 0], [1, 1, 1], { rust: 0.15 }),
        gp(rbox(0.012, 0.03, 0.06, 0.004), 0x0a0a0c, 'plastic', [0.04, 0.04, -0.02]),
        gp(rcyl(0.036, 0.036, 0.5, 0.01, 18), STEEL, 'metal', [0, 0.05, -0.3], fwd, [1, 1, 1], { rust: 0.15 }),
        gp(rcyl(0.028, 0.028, 0.4, 0.008, 14), 0x3a3d42, 'metal', [0, 0.0, -0.27], fwd),
        gp(rcyl(0.039, 0.039, 0.016, 0.005, 18), BRASS, 'brass', [0, 0.05, -0.42], fwd),
        gp(rcyl(0.039, 0.039, 0.016, 0.005, 18), BRASS, 'brass', [0, 0.05, -0.2], fwd),
        gp(rcyl(0.032, 0.032, 0.014, 0.004, 14), BRASS, 'brass', [0, 0.0, -0.44], fwd),
        gp(rbox(0.04, 0.012, 0.3, 0.004), STEEL, 'metal', [0, 0.092, -0.3]),
        ...[0, 1, 2, 3, 4, 5].map((i) => gp(rbox(0.03, 0.014, 0.008, 0.002), 0x0a0a0c, 'plastic', [0, 0.093, -0.17 - i * 0.045])),
        gp(ball(0.01, 8, 6), BRASS, 'brass', [0, 0.1, -0.5]),
        gp(rcyl(0.04, 0.1, 0.07, 0.012, 22), PAPER, 'paper', [0, 0.05, -0.545], fwd),
        gp(rcyl(0.044, 0.044, 0.03, 0.006, 16), 0x3a3d42, 'metal', [0, 0.05, -0.5], fwd),
        gp(torus(0.1, 0.009, 26, 5), C.chrome, 'chrome', [0, 0.05, -0.582]),
        gp(rcyl(0.07, 0.07, 0.006, 0.002, 18), 0x050505, 'plastic', [0, 0.05, -0.577], fwd),
        gp(rbox(0.058, 0.09, 0.14, 0.02), WOOD, 'wood', [0, 0.0, 0.17], rot(0.12)),
        gp(rbox(0.06, 0.1, 0.02, 0.006), 0x161616, 'rubber', [0, 0.0, 0.245], rot(0.12)),
        gp(rbox(0.056, 0.14, 0.062, 0.015), WOOD, 'wood', [0, -0.08, 0.06], rot(-0.25)),
        ...[0, 1, 2].map((i) => gp(rbox(0.058, 0.004, 0.064, 0.001), 0x2a1c10, 'wood', [0, -0.05 - i * 0.03, 0.05 + i * 0.008], rot(-0.25))),
        gp(torus(0.03, 0.006, 14, 5), STEEL, 'metal', [0, -0.04, 0.02], [0, HALF, 0]),
      ],
      pump: [
        gp(rbox(0.088, 0.066, 0.16, 0.02, true), WOOD, 'wood', [0, -0.02, -0.28]),
        ...[0, 1, 2, 3].map((i) => gp(rbox(0.09, 0.068, 0.008, 0.002), 0x2a1c10, 'wood', [0, -0.02, -0.22 - i * 0.04])),
      ],
    };
  },
  smg() {
    const sides = [-1, 1];
    const rake = rot(-0.25);
    return {
      muzzle: [0, 0.035, -0.53],
      lamp: [0, 0.096, 0.07],
      body: [
        gp(rbox(0.056, 0.085, 0.34, 0.016, true), 0x34373c, 'gloss', [0, 0.03, -0.08], [0, 0, 0], [1, 1, 1], { rust: 0.12 }),
        gp(rbox(0.03, 0.02, 0.3, 0.006), 0x202225, 'metal', [0, 0.083, -0.08]),
        ...[0, 1, 2, 3, 4, 5, 6].map((i) => gp(rbox(0.032, 0.006, 0.008, 0.002), 0x08080a, 'plastic', [0, 0.094, -0.18 + i * 0.03])),
        gp(rbox(0.042, 0.05, 0.14, 0.012), 0x4a4d52, 'metal', [0, 0.035, -0.32]),
        ...sides.flatMap((s) => [0, 1, 2].flatMap((i) => [0, 1].map((j) => gp(rbox(0.004, 0.012, 0.014, 0.002), 0x08080a, 'plastic', [s * 0.0215, 0.022 + j * 0.028, -0.275 - i * 0.04])))),
        gp(rcyl(0.014, 0.014, 0.14, 0.004, 10), STEEL, 'metal', [0, 0.035, -0.44], fwd),
        gp(ball(0.028, 12, 8), PAPER, 'paper', [0, 0.035, -0.505], [0, 0, 0], [1, 1, 0.6]),
        gp(torus(0.03, 0.005, 20, 5), C.chrome, 'chrome', [0, 0.035, -0.5]),
        gp(rbox(0.037, 0.25, 0.052, 0.012, true), 0x1a1a1a, 'gloss', [0, -0.145, -0.1], rot(0.15)),
        ...[0, 1, 2, 3, 4].map((i) => gp(rbox(0.04, 0.006, 0.054, 0.002), 0x2e2f33, 'metal', [0, -0.07 - i * 0.04, -0.1 - (0.07 + i * 0.04) * 0.15], rot(0.15))),
        gp(rbox(0.05, 0.13, 0.056, 0.015), 0x161616, 'rubber', [0, -0.08, 0.05], rake),
        ...[-0.04, 0.0, 0.04, 0.08].map((d) => gp(rbox(0.054, 0.011, 0.06, 0.003), TAPE, 'tape', [0, -0.08 + d, 0.05 - 0.25 * d], rake)),
        ...sides.map((s) => gp(capsule(0.006, 0.14), STEEL, 'metal', [s * 0.014, 0.03, 0.2], fwd)),
        gp(rbox(0.04, 0.056, 0.012, 0.004), 0x161616, 'rubber', [0, 0.03, 0.27]),
        gp(rbox(0.014, 0.014, 0.04, 0.004), STEEL, 'metal', [0.036, 0.05, -0.02]),
        gp(torus(0.024, 0.005, 14, 5), STEEL, 'metal', [0, -0.03, -0.02], [0, HALF, 0]),
        // a small side-mounted speaker: paper cone, chrome ring, grille bars
        ...sides.map((s) => gp(rcyl(0.034, 0.034, 0.008, 0.003, 16), PAPER, 'paper', [s * 0.029, 0.03, -0.13], [0, 0, HALF])),
        ...sides.map((s) => gp(torus(0.034, 0.005, 14, 5), C.chrome, 'chrome', [s * 0.032, 0.03, -0.13], [0, HALF, 0])),
        ...sides.flatMap((s) => [-0.012, 0, 0.012].map((z) => gp(rbox(0.004, 0.056, 0.003, 0.001), C.chrome, 'chrome', [s * 0.034, 0.03, -0.13 + z]))),
      ],
    };
  },
  launcher() {
    const rake = rot(-0.2);
    return {
      muzzle: [0, 0.03, -0.63],
      lamp: [0, 0.152, -0.1],
      body: [
        gp(rcyl(0.075, 0.075, 0.5, 0.02, 22), 0x4a4d52, 'gloss', [0, 0.03, -0.2], fwd, [1, 1, 1], { rust: 0.35 }),
        gp(rcyl(0.086, 0.074, 0.06, 0.015, 22), 0x2a2b2e, 'metal', [0, 0.03, 0.08], fwd),
        gp(rcyl(0.074, 0.17, 0.16, 0.02, 26), PAPER, 'paper', [0, 0.03, -0.52], fwd),
        gp(torus(0.168, 0.012, 30, 5), C.chrome, 'chrome', [0, 0.03, -0.6]),
        gp(rcyl(0.14, 0.14, 0.008, 0.003, 24), 0x050505, 'plastic', [0, 0.03, -0.595], fwd),
        ...[-0.05, -0.2, -0.33].map((z) => gp(rcyl(0.083, 0.083, 0.016, 0.005, 22), BRASS, 'brass', [0, 0.03, z], fwd)),
        gp(rbox(0.056, 0.15, 0.066, 0.018), WOOD, 'wood', [0, -0.1, 0.03], rake),
        ...[-0.04, 0.0, 0.04, 0.08].map((d) => gp(rbox(0.06, 0.012, 0.07, 0.003), TAPE, 'tape', [0, -0.1 + d, 0.03 - 0.2 * d], rake)),
        gp(rbox(0.042, 0.1, 0.042, 0.014), 0x161616, 'rubber', [0, -0.1, -0.22]),
        ...[-0.03, 0.0, 0.03].map((d) => gp(rbox(0.046, 0.012, 0.046, 0.003), TAPE, 'tape', [0, -0.1 + d, -0.22])),
        gp(rbox(0.022, 0.05, 0.04, 0.008), 0x3a3d42, 'metal', [0, 0.12, -0.1]),
        gp(torus(0.02, 0.004, 14, 5), STEEL, 'metal', [0, 0.14, -0.42]),
        gp(rbox(0.012, 0.05, 0.012, 0.003), STEEL, 'metal', [0, 0.115, -0.42]),
        gp(rbox(0.07, 0.1, 0.03, 0.01), 0x161616, 'rubber', [0, 0.03, 0.115]),
        gp(rcyl(0.03, 0.03, 0.01, 0.004, 14), PAPER, 'paper', [0.081, 0.03, -0.27], [0, 0, HALF]),
        gp(torus(0.03, 0.005, 14, 5), C.chrome, 'chrome', [0.084, 0.03, -0.27], [0, HALF, 0]),
        gp(rbox(0.07, 0.05, 0.12, 0.012), 0x6b3a1c, 'paint', [0.07, 0.04, -0.15], [0, 0, 0], [1, 1, 1], { rust: 0.9 }),
        gp(torus(0.024, 0.005, 14, 5), STEEL, 'metal', [0, -0.05, -0.02], [0, HALF, 0]),
      ],
    };
  },
  // The Vinyl Disc: a chunky black turntable deck with a record spinning on a tilted platter and a chrome flinger rail
  // at the front. The platter ('cradle') is tilted back towards the player so the label shows; the record itself is a
  // named, spinnable group added by makeWeaponModel.
  vinyl() {
    const rake = rot(-0.2);
    const sides = [-1, 1];
    const cyl = (r, h, seg = 24) => withEdge(new THREE.CylinderGeometry(r, r, h, seg, 1));
    return {
      muzzle: [0, 0.19, -0.54],
      lamp: [-0.1, 0.082, 0.07],
      cradleAt: [0, 0.128, -0.1],
      cradleTilt: 0.36,
      body: [
        gp(rbox(0.28, 0.075, 0.46, 0.024, true), 0x1c1c22, 'plastic', [0, 0.03, -0.1]),
        gp(rbox(0.26, 0.012, 0.44, 0.005), 0x2c2c34, 'metal', [0, 0.07, -0.1]),
        gp(rbox(0.282, 0.012, 0.02, 0.004), C.chrome, 'chrome', [0, 0.062, -0.328]),
        gp(rbox(0.282, 0.012, 0.02, 0.004), C.chrome, 'chrome', [0, 0.062, 0.128]),
        ...sides.map((sx) => gp(rbox(0.014, 0.012, 0.45, 0.004), C.chrome, 'chrome', [sx * 0.138, 0.062, -0.1])),
        ...sides.flatMap((sx) => [0.1, -0.3].map((z) => gp(rbox(0.04, 0.03, 0.04, 0.012), 0x161616, 'rubber', [sx * 0.115, -0.012, z]))),
        // the platter's pivot block, and the front flinger rail: two chrome rods climbing on a rubber strip to a gate
        gp(rcyl(0.06, 0.08, 0.07, 0.015, 18), STEEL, 'metal', [0, 0.085, -0.1]),
        ...sides.map((sx) => gp(rcyl(0.011, 0.011, 0.35, 0.004, 10), C.chrome, 'chrome', [sx * 0.05, 0.133, -0.37], [HALF + 0.19, 0, 0])),
        gp(rbox(0.08, 0.008, 0.31, 0.003), 0x161616, 'rubber', [0, 0.124, -0.37], [0.19, 0, 0]),
        gp(rbox(0.15, 0.036, 0.022, 0.008), STEEL, 'metal', [0, 0.11, -0.25]),
        ...sides.map((sx) => gp(rbox(0.014, 0.05, 0.014, 0.004), STEEL, 'metal', [sx * 0.05, 0.085, -0.25])),
        ...sides.map((sx) => gp(rbox(0.016, 0.085, 0.016, 0.005), C.chrome, 'chrome', [sx * 0.05, 0.19, -0.54])),
        gp(rbox(0.12, 0.016, 0.016, 0.005), C.chrome, 'chrome', [0, 0.232, -0.54]),
        gp(rbox(0.12, 0.03, 0.022, 0.008), STEEL, 'metal', [0, 0.152, -0.54]),
        ...sides.map((sx) => gp(rbox(0.012, 0.1, 0.012, 0.004), STEEL, 'metal', [sx * 0.05, 0.085, -0.4], [-0.5, 0, 0])),
        // deck controls: three knobs and a play button at the back left, a pitch fader at the front right
        ...[0, 1, 2].map((i) => gp(cyl(0.017, 0.022, 14), i === 1 ? BRASS : C.chrome, i === 1 ? 'brass' : 'chrome', [-0.095, 0.085, 0.1 - i * 0.05])),
        gp(rbox(0.014, 0.005, 0.12, 0.002), 0x050505, 'plastic', [0.1, 0.077, -0.2]),
        gp(rbox(0.03, 0.016, 0.022, 0.006), BRASS, 'brass', [0.1, 0.082, -0.18]),
        // side speaker: paper cone, chrome ring, brass plate
        gp(cyl(0.05, 0.012, 28), PAPER, 'paper', [-0.14, 0.025, -0.14], [0, 0, HALF]),
        gp(new THREE.TorusGeometry(0.054, 0.008, 5, 28), C.chrome, 'chrome', [-0.145, 0.025, -0.14], [0, HALF, 0]),
        gp(cyl(0.014, 0.014, 10), C.chrome, 'chrome', [-0.148, 0.025, -0.14], [0, 0, HALF]),
        gp(rbox(0.006, 0.028, 0.08, 0.002), BRASS, 'brass', [-0.142, 0.028, 0.03]),
        // grips: a raked rubber handle with tape wraps, a fore-grip, a trigger ring and the cable
        gp(rbox(0.058, 0.17, 0.075, 0.02, true), 0x161616, 'rubber', [0, -0.09, 0.06], rake),
        ...[-0.05, -0.01, 0.03, 0.07].map((d) => gp(rbox(0.062, 0.012, 0.08, 0.003), TAPE, 'tape', [0, -0.09 + d, 0.06 - 0.2 * d], rake)),
        gp(rbox(0.046, 0.1, 0.046, 0.014), 0x161616, 'rubber', [0, -0.07, -0.24]),
        ...[-0.03, 0.0, 0.03].map((d) => gp(rbox(0.05, 0.012, 0.05, 0.003), TAPE, 'tape', [0, -0.07 + d, -0.24])),
        gp(torus(0.026, 0.006, 14, 5), STEEL, 'metal', [0, -0.02, -0.03], [0, HALF, 0]),
        gp(tube([[0, 0.03, 0.13], [0, 0.0, 0.22], [0.04, -0.1, 0.2], [0.02, -0.17, 0.17]], 0.009, 14, 5), C.rubber, 'rubber'),
      ],
      // everything on the tilted platter, in its own frame (origin at the platter centre, +y out of the platter)
      cradle: [
        gp(cyl(0.132, 0.022, 36), C.chrome, 'chrome', [0, 0, 0], [0, 0, 0], [1, 1, 1], { rust: 0.15 }),
        gp(cyl(0.122, 0.008, 36), 0x5a141c, 'cloth', [0, 0.014, 0]),
        // a chrome guide rail round the front half of the record, on four posts
        gp(new THREE.TorusGeometry(0.15, 0.0085, 5, 28, Math.PI), C.chrome, 'chrome', [0, 0.036, 0], [-HALF, 0, 0]),
        ...[0, 0.5, 1].map((f) => gp(rbox(0.014, 0.04, 0.014, 0.004), STEEL, 'metal', [Math.cos(f * Math.PI) * 0.15, 0.016, -Math.sin(f * Math.PI) * 0.15])),
        // tonearm at the back right, resting over the record
        gp(cyl(0.028, 0.04, 16), C.chrome, 'chrome', [0.15, 0.02, 0.14]),
        gp(tube([[0.15, 0.045, 0.14], [0.15, 0.06, 0.08], [0.115, 0.06, -0.02], [0.08, 0.055, -0.09]], 0.006, 16, 5), C.chrome, 'chrome'),
        gp(rbox(0.032, 0.008, 0.055, 0.003), C.chrome, 'chrome', [0.075, 0.05, -0.115], [0, 0.4, 0]),
        gp(cyl(0.017, 0.045, 12), BRASS, 'brass', [0.15, 0.05, 0.18], [HALF, 0, 0]),
      ],
    };
  },
};

export function makeWeaponModel(id) {
  const build = WEAPON_PARTS[id];
  if (!build) throw new Error(`makeWeaponModel: unknown weapon "${id}"`);
  const parts = once(`weapon:${id}`, () => {
    const p = build();
    const seed = WEAPON_IDS.indexOf(id) + 1;
    return {
      muzzle: p.muzzle,
      lamp: p.lamp,
      body: bake(p.body, { ...GW, seed }),
      pump: p.pump ? bake(p.pump, { ...GW, seed }) : null,
      cradle: p.cradle ? { at: p.cradleAt, tilt: p.cradleTilt, geo: bake(p.cradle, { ...GW, seed }) } : null,
    };
  });
  const g = new THREE.Group();
  g.name = `weapon-${id}`;
  const body = new THREE.Mesh(parts.body, pbrMat());
  body.name = 'body';
  const glow = new THREE.Mesh(once('lampBall', () => ball(0.011, 8, 6)), glowBasic(WEAPON_COLOUR[id], 5, false));
  glow.name = 'glow'; // the small indicator lamp
  glow.position.set(...parts.lamp);
  g.add(body, glow);
  if (parts.pump) {
    const pump = new THREE.Mesh(parts.pump, pbrMat());
    pump.name = 'pump'; // slides along z for the pump action
    g.add(pump);
  }
  if (parts.cradle) {
    // The record sits on the tilted platter. It spins when the integrator calls g.userData.update(t) with a clock in
    // seconds (the pickup forwards the same call); it is also findable as g.getObjectByName('record').
    const cradle = new THREE.Group();
    cradle.name = 'cradle';
    cradle.position.set(...parts.cradle.at);
    cradle.rotation.x = parts.cradle.tilt;
    cradle.add(new THREE.Mesh(parts.cradle.geo, pbrMat()));
    const rec = makeRecord(0.115);
    rec.position.y = 0.0225 + 0.115 * 0.06;
    cradle.add(rec);
    g.add(cradle);
    g.userData.record = rec;
    g.userData.update = (t) => {
      rec.rotation.y = -num(t, 0) * 2.2;
    };
    g.userData.update(0);
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(...parts.muzzle);
  g.add(muzzle);
  return g;
}

// A plain glowing ring on the floor so pickups can be found in a dark room.
function plinth(colour, k = 2.2, extra = null) {
  const g = new THREE.Group();
  const ringGeo = once('plinth:ring', () => new THREE.TorusGeometry(0.4, 0.03, 6, 32));
  const rim = new THREE.Mesh(ringGeo, glowBasic(colour, k));
  rim.rotation.x = HALF;
  rim.position.y = 0.03;
  g.add(rim);
  if (extra !== null) {
    const r2 = new THREE.Mesh(once('plinth:ring2', () => new THREE.TorusGeometry(0.32, 0.022, 6, 28)), glowBasic(extra, k));
    r2.rotation.x = HALF;
    r2.position.y = 0.03;
    g.add(r2);
  }
  return g;
}

const PICKUP_SCALE = { pistol: 2.4, shotgun: 1.9, smg: 2.0, launcher: 1.8, vinyl: 2.1 };

export function makeWeaponPickup(id) {
  const g = new THREE.Group();
  g.name = `pickup-${id}`;
  g.add(plinth(WEAPON_COLOUR[id] ?? COLOURS.cyan));
  const item = new THREE.Group();
  item.name = 'item';
  const model = makeWeaponModel(id);
  // Centre the model on its own bounding box so it spins about its middle.
  const bb = new THREE.Box3().setFromObject(model);
  const c = bb.getCenter(new THREE.Vector3());
  model.position.set(-c.x, -c.y, -c.z);
  item.add(model);
  item.scale.setScalar(PICKUP_SCALE[id] ?? 1.8);
  item.position.y = 0.95;
  g.add(item);
  if (model.userData.update) g.userData.update = (t) => model.userData.update(t); // the record keeps spinning
  return g;
}

// The old medkit, kept because it is harmless: a dented first-aid tin with a painted cross.
export function makeHealthPickup() {
  const g = new THREE.Group();
  g.name = 'pickup-health';
  g.add(plinth(0xff3030));
  const kitGeo = once('medkit:body', () => bake([
    gp(rbox(0.54, 0.38, 0.2, 0.04, true), 0xcfc9b8, 'gloss', [0, 0, 0], [0, 0, 0], [1, 1, 1], { rust: 0.2 }),
    gp(rbox(0.56, 0.03, 0.22, 0.008), 0x8a8678, 'metal', [0, 0, 0]),
    gp(rbox(0.22, 0.05, 0.06, 0.02), 0x3a3d42, 'metal', [0, 0.215, 0]),
    gp(rbox(0.06, 0.4, 0.22, 0.02), STEEL, 'metal', [-0.28, 0, 0]),
    gp(rbox(0.06, 0.4, 0.22, 0.02), STEEL, 'metal', [0.28, 0, 0]),
    gp(rbox(0.22, 0.07, 0.012, 0.004), 0xa81c1c, 'paint', [0, 0.03, -0.106]),
    gp(rbox(0.07, 0.22, 0.012, 0.004), 0xa81c1c, 'paint', [0, 0.03, -0.106]),
    gp(rbox(0.22, 0.07, 0.012, 0.004), 0xa81c1c, 'paint', [0, 0.03, 0.106]),
    gp(rbox(0.07, 0.22, 0.012, 0.004), 0xa81c1c, 'paint', [0, 0.03, 0.106]),
    gp(rbox(0.05, 0.08, 0.02, 0.008), C.chrome, 'chrome', [-0.12, 0.02, -0.11]),
    gp(rbox(0.05, 0.08, 0.02, 0.008), C.chrome, 'chrome', [0.12, 0.02, -0.11]),
  ], GW));
  const kit = new THREE.Mesh(kitGeo, pbrMat());
  kit.position.y = 0.62;
  g.add(kit);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Projectiles and effects (HDR, additive: they bloom)
// ---------------------------------------------------------------------------------------------

export function makeProjectile(kind) {
  const g = new THREE.Group();
  g.name = `projectile-${kind}`;
  if (kind === 'rocket') {
    // A scuffed tube with a little speaker cone for a tail, a bright exhaust and wave rings in its wake.
    const geo = once('proj:rocket', () => bake([
      gp(rcyl(0.045, 0.045, 0.28, 0.012, 14), 0x8a8d90, 'gloss', [0, 0, 0], fwd, [1, 1, 1], { rust: 0.2 }),
      gp(cone(0.048, 0.14, 14), 0x8a2a20, 'gloss', [0, 0, -0.21], [-HALF, 0, 0]),
      gp(rcyl(0.047, 0.047, 0.03, 0.006, 14), C.chrome, 'chrome', [0, 0, -0.06], fwd),
      ...[0, HALF, Math.PI, -HALF].map((a) => gp(rbox(0.075, 0.012, 0.07, 0.003), 0x6b3a1c, 'metal', [Math.sin(a) * 0.06, Math.cos(a) * 0.06, 0.12], [0, 0, a + HALF])),
      gp(rcyl(0.02, 0.055, 0.05, 0.01, 14), PAPER, 'paper', [0, 0, 0.17], fwd),
    ], { ...GW, seed: 7 }));
    const body = new THREE.Mesh(geo, pbrMat());
    const flame = new THREE.Mesh(once('proj:flame', () => new THREE.ConeGeometry(0.05, 0.4, 10, 1, true)), addHdr(0xff7a20, 2.4, 0.6));
    flame.rotation.x = HALF;
    flame.position.z = 0.4;
    const core = new THREE.Mesh(once('proj:flame2', () => new THREE.ConeGeometry(0.028, 0.24, 10, 1, true)), addHdr(0xffd890, 3, 0.8));
    core.rotation.x = HALF;
    core.position.z = 0.32;
    const waves = new THREE.Mesh(once('proj:waves', () => bake([0.06, 0.082, 0.104].map((r, i) => gp(torus(r, 0.005, 20, 4), 0xffffff, 'plastic', [0, 0, 0.5 + i * 0.07]))) ), addHdr(0x7fe8ff, 3, 0.7));
    g.add(body, flame, core, waves);
    return g;
  }
  if (kind === 'disc') {
    // The Vinyl Disc's shot: a black grooved record (radius 0.3) with a bright two-tone HDR label that has a notch
    // cut out, a glowing rim and a pip, so a spin shows. Tilted a little towards the player. The game can spin the
    // whole group about y (it wobbles) or the 'spin' child (a clean spin about the disc's own axis).
    const tilt = new THREE.Group();
    tilt.rotation.x = 0.45;
    const spin = new THREE.Group();
    spin.name = 'spin';
    tilt.add(spin);
    const geo = once('proj:disc', () => {
      const parts = recordParts(0.3);
      parts.label.push({ geo: new THREE.TorusGeometry(0.3, 0.009, 4, 40), hex: COLOURS.magenta, k: 2.6, r: [HALF, 0, 0] });
      return { vinyl: bake(parts.vinyl, { ...GW, seed: 5 }), label: glowMerge(parts.label) };
    });
    spin.add(
      new THREE.Mesh(geo.vinyl, pbrMat()),
      new THREE.Mesh(geo.label, once('discLabelMat', () => new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }))),
    );
    // a soft pink glow either side of the disc so it can be found in the dark
    const haze = new THREE.Mesh(once('proj:disc-haze', () => radialDisc(0.42, COLOURS.magenta, 0.55)), once('discHazeMat', () => new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    })));
    haze.rotation.x = -HALF;
    tilt.add(haze);
    g.add(tilt);
    return g;
  }
  // 'bottle': a glass bottle with a burning rag in the neck. Axis along y inside a 'spin' child, so
  // rotating spin about x tumbles it end over end.
  const spin = new THREE.Group();
  spin.name = 'spin';
  const glass = once('proj:bottle', () => bake([
    gp(rcyl(0.06, 0.06, 0.16, 0.025, 16), 0x7a4a14, 'glass', [0, -0.04, 0]),
    gp(rcyl(0.026, 0.06, 0.05, 0.01, 16), 0x7a4a14, 'glass', [0, 0.065, 0]),
    gp(rcyl(0.026, 0.026, 0.06, 0.008, 12), 0x8a5a1c, 'glass', [0, 0.12, 0]),
    gp(rcyl(0.062, 0.062, 0.06, 0.005, 16), 0xe8dcc0, 'paper', [0, -0.04, 0]),
  ], { ...GW, seed: 3 }));
  spin.add(new THREE.Mesh(glass, pbrMat()));
  const liquid = new THREE.Mesh(once('proj:liquid', () => new THREE.CylinderGeometry(0.052, 0.052, 0.15, 12)), glowBasic(0xe08a20, 1.4));
  liquid.position.y = -0.04;
  spin.add(liquid);
  const rag = new THREE.Mesh(once('proj:rag', () => new THREE.CylinderGeometry(0.014, 0.01, 0.06, 8)), glowBasic(0xd8d0b0, 1));
  rag.position.y = 0.17;
  spin.add(rag);
  const flame = new THREE.Mesh(once('proj:bflame', () => new THREE.ConeGeometry(0.04, 0.13, 10)), glowBasic(0xff9020, 3));
  flame.position.y = 0.25;
  spin.add(flame);
  const flameOuter = new THREE.Mesh(once('proj:bflame2', () => new THREE.ConeGeometry(0.065, 0.2, 10)), addHdr(0xff6a1a, 1.8, 0.4));
  flameOuter.position.y = 0.26;
  spin.add(flameOuter);
  const halo = new THREE.Mesh(once('proj:halo', () => ball(0.16, 10, 8)), addHdr(0xff8a2a, 1.5, 0.05));
  halo.position.y = 0.1;
  g.add(spin, halo);
  return g;
}

// Effect materials are cloned per instance so the integrator can fade each one by opacity.
function fxMat(hex, k, opacity) {
  return new THREE.MeshBasicMaterial({
    color: hdr(hex, k), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
}

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

// A soft round glow: vertex colours fall off to black towards the rim, which adds nothing when blended additively.
function radialDisc(r, hex, k) {
  const g = new THREE.CircleGeometry(r, 24);
  const Pa = g.attributes.position;
  const col = new Float32Array(Pa.count * 3);
  for (let i = 0; i < Pa.count; i++) {
    const f = Math.max(0, 1 - Math.hypot(Pa.getX(i), Pa.getY(i)) / r);
    _c.set(hex).multiplyScalar(k * f * f);
    col.set([_c.r, _c.g, _c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function makeMuzzleFlash() {
  const g = new THREE.Group();
  g.name = 'muzzle-flash';
  const star = once('fx:star', () => bake([
    P(starShape(8, 0.15, 0.04), 0xffffff, 'plastic'),
    P(starShape(5, 0.1, 0.03), 0xffffff, 'plastic', [0, 0, 0.001], [0, 0, 0.3]),
  ], GW));
  const core = once('fx:flash-core', () => starShape(6, 0.07, 0.03));
  const halo = once('fx:flash-halo', () => radialDisc(0.17, 0xff9a40, 2.2));
  const cone = once('fx:flash-cone', () => new THREE.ConeGeometry(0.08, 0.34, 10, 1, true));
  const a = new THREE.Mesh(star, fxMat(0xffc870, 2.4, 0.95));
  const b = new THREE.Mesh(core, fxMat(0xfff0d0, 3.2, 1));
  b.position.z = 0.002;
  const h = new THREE.Mesh(halo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  h.position.z = -0.002;
  const c = new THREE.Mesh(cone, fxMat(0xff9030, 2, 0.6));
  c.rotation.x = -HALF; // tip forward (-z), base at the muzzle
  c.position.z = -0.17;
  g.add(a, b, h, c);
  return g;
}

export function makeImpact() {
  const g = new THREE.Group();
  g.name = 'impact';
  const geo = once('fx:impact', () => bake([
    P(starShape(6, 0.11, 0.025), 0xffffff, 'plastic'),
    P(starShape(6, 0.11, 0.025), 0xffffff, 'plastic', [0, 0, 0], [0, HALF, 0.3]),
    P(starShape(6, 0.11, 0.025), 0xffffff, 'plastic', [0, 0, 0], [HALF, 0, 0.6]),
  ], GW));
  g.add(new THREE.Mesh(geo, fxMat(0xffc880, 2.6, 1)));
  const dot = new THREE.Mesh(once('fx:impact-dot', () => new THREE.SphereGeometry(0.035, 8, 6)), fxMat(0xfff0d0, 3.2, 0.9));
  g.add(dot);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Drinks: pickups and first-person drinking animations
// ---------------------------------------------------------------------------------------------

export const DRINK_IDS = ['dram', 'orange', 'heavy', 'energy', 'lastorders'];

const SKIN = 0xc89b82;
const glassMat = () => once('drinkGlass', () => new THREE.MeshStandardMaterial({
  color: 0xa8bcc6, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide,
}));
const darkGlassMat = () => once('drinkGlassDark', () => new THREE.MeshStandardMaterial({
  color: 0x0c1812, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.62, depthWrite: false,
}));
const liquidMat = () => once('liquidVC', () => new THREE.MeshBasicMaterial({ vertexColors: true }));

// The drink meshes are modelled in Blender (scripts/blender/drinks.py) and stored as packed arrays in
// drink-meshes.js, so this file stays free of images and DOM. Decoding is a few thousand vertices, once per drink.
function bytes(s, Type) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
  return new Type(u.buffer);
}

const SRGB_LIN = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function meshGeo(m) {
  const g = new THREE.BufferGeometry();
  const p = bytes(m.p, Int16Array);
  const pos = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) pos[i] = p[i] * m.sc;
  const n = bytes(m.nrm, Int8Array);
  const nor = new Float32Array(n.length);
  for (let i = 0; i < n.length; i++) nor[i] = n[i] / 127;
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(bytes(m.idx, Uint16Array), 1));
  if (m.kind === 'pbr') {
    const c = bytes(m.col, Uint8Array);
    const col = new Float32Array(c.length);
    for (let i = 0; i < c.length; i++) col[i] = SRGB_LIN[c[i]];
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const sf = bytes(m.sf, Uint8Array);
    const surf = new Float32Array(sf.length);
    for (let i = 0; i < sf.length; i++) surf[i] = sf[i] / 255;
    g.setAttribute('surf', new THREE.BufferAttribute(surf, 2));
  } else if (m.grad) {
    // a liquid: HDR gradient from the bottom colour to the top colour, by height
    const [h0, h1, k0, k1] = m.grad;
    const a = new THREE.Color(h0).multiplyScalar(k0);
    const b = new THREE.Color(h1).multiplyScalar(k1);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      lo = Math.min(lo, pos[i + 1]);
      hi = Math.max(hi, pos[i + 1]);
    }
    const col = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      _c.copy(a).lerp(b, clamp((pos[i + 1] - lo) / (hi - lo), 0, 1));
      col[i] = _c.r;
      col[i + 1] = _c.g;
      col[i + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

const softMat = () => once('softAdd', () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));

// Soft effect discs that are not part of the modelled drink: the fizz and the puff of gas hide until their moment
// in the animation, the halo glows round the Last Orders bottle.
const DRINK_FX = {
  orange: { fizz: { geo: () => radialDisc(0.05, 0xfff0d8, 0.45), mat: softMat, pos: [0, 0.27, 0.03], hidden: true } },
  energy: { puff: { geo: () => radialDisc(0.06, 0xdde8ff, 0.4), mat: softMat, pos: [0, 0.14, 0.03], hidden: true } },
  lastorders: {
    halo: {
      geo: () => radialDisc(0.16, 0xffb030, 0.8),
      mat: () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      pos: [0, 0.06, 0.07],
      scale: [1, 2.2, 1],
    },
  },
};

// Each recipe returns named meshes: geometry, material and position in the drink's own frame
// (origin at the grip centre, axis along y, rim at +y).
function drinkRecipe(id) {
  const recipe = {};
  for (const [name, m] of Object.entries(DRINK_MESHES[id])) {
    const glass = m.kind === 'glass' || m.kind === 'darkglass';
    const mat = {
      pbr: pbrMat,
      glass: glassMat,
      darkglass: darkGlassMat,
      liquid: liquidMat,
      glow: () => glowBasic(m.glow?.[0], m.glow?.[1], false),
    }[m.kind]();
    recipe[name] = { geo: meshGeo(m), mat, pos: m.pos, order: glass ? 2 : 0 };
  }
  for (const [name, fx] of Object.entries(DRINK_FX[id] || {})) recipe[name] = { ...fx, geo: fx.geo(), mat: fx.mat() };
  return recipe;
}

// Per-drink numbers. R and gy are the grip radius and height; rim is how far the rim sits from the origin;
// tilt is the peak tilt in radians; `out` is where the tilt starts to come back.
const DRINK = {
  dram: { name: 'Wee Dram', duration: 1.2, tilt: 1.3, rim: 0.075, R: 0.056, gy: -0.01, ring: 0xffb030, scale: 4.2, bottom: -0.075, out: 0.66 },
  orange: { name: 'Bruiser Orange', duration: 1.6, tilt: 1.75, rim: 0.265, R: 0.054, gy: -0.04, ring: 0xff7a1a, scale: 2.1, bottom: -0.12, out: 0.68 },
  heavy: { name: 'Pint of Heavy', duration: 2.0, tilt: 1.15, rim: 0.13, R: 0.05, gy: -0.03, ring: 0xd89a4a, scale: 3.0, bottom: -0.13, out: 0.7 },
  energy: { name: 'Bassline Energy', duration: 1.7, tilt: 1.7, rim: 0.135, R: 0.0356, gy: 0, ring: COLOURS.magenta, ring2: COLOURS.cyan, scale: 3.0, bottom: -0.135, out: 0.66 },
  lastorders: { name: 'Last Orders', duration: 2.2, tilt: 1.95, rim: 0.29, R: 0.062, gy: -0.05, ring: 0xffc030, scale: 2.2, bottom: -0.16, out: 0.6 },
};

function buildDrink(id) {
  const recipe = once(`drink:${id}`, () => drinkRecipe(id));
  const group = new THREE.Group();
  const parts = {};
  for (const [name, r] of Object.entries(recipe)) {
    const m = new THREE.Mesh(r.geo, r.mat);
    m.name = name;
    m.position.set(...r.pos);
    if (r.scale) m.scale.set(...r.scale);
    if (r.order) m.renderOrder = r.order;
    if (r.hidden) m.visible = false;
    group.add(m);
    parts[name] = m;
  }
  return { group, parts };
}

export function makeDrinkPickup(id) {
  const D = DRINK[id];
  if (!D) throw new Error(`makeDrinkPickup: unknown drink "${id}"`);
  const g = new THREE.Group();
  g.name = `pickup-drink-${id}`;
  g.add(plinth(D.ring, id === 'lastorders' ? 3.2 : 2.4, D.ring2 ?? null));
  const { group, parts } = buildDrink(id);
  // Pickups read from across a room: the cap and tab stay on, the fizz and puff stay off.
  const item = new THREE.Group();
  item.name = 'item';
  item.add(group);
  item.scale.setScalar(D.scale);
  item.position.y = 0.5 - D.bottom * D.scale;
  g.add(item);
  if (id === 'lastorders') {
    // Embers rise off the bottle: small HDR gold specks, animated by g.userData.update(time) if the integrator calls it.
    const emberGeo = once('ember', () => new THREE.SphereGeometry(0.018, 6, 4));
    const embers = [];
    for (let i = 0; i < 7; i++) {
      const e = new THREE.Mesh(emberGeo, glowBasic(0xffb030, 6, false));
      embers.push(e);
      g.add(e);
    }
    const place = (t) => embers.forEach((e, i) => {
      const f = (t * (0.28 + 0.05 * i) + i * 0.37) % 1;
      const a = i * 2.4 + t * 0.6;
      e.position.set(Math.cos(a) * (0.16 + 0.08 * f), 0.55 + f * 1.1, Math.sin(a) * (0.16 + 0.08 * f));
      e.scale.setScalar(Math.max(0.01, (1 - f) * (0.6 + 0.4 * Math.sin(t * 9 + i))));
    });
    place(0);
    g.userData.update = place;
    // a faint gold column of light above the ring
    const col = new THREE.Mesh(once('ember:col', () => new THREE.CylinderGeometry(0.22, 0.34, 1.5, 18, 1, true)), addHdr(0xffa820, 1.2, 0.04));
    col.position.y = 0.78;
    g.add(col);
  }
  void parts;
  return g;
}

// Freddie's hand: fingers (tubes) wrap round the drink at radius R, height gy; palm and back of the hand sit on +x.
function handGeo(R, gy, seed) {
  const rr = R + 0.012;
  const ring = (y, a0, a1, rad, lift = 0) => {
    const pts = Array.from({ length: 7 }, (_, i) => {
      const t = i / 6;
      const a = lerp(a0, a1, t);
      return [Math.sin(a) * rr, y + lift * t, Math.cos(a) * rr];
    });
    const end = pts[pts.length - 1];
    return [P(tube(pts, rad, 16, 6), SKIN, 'leather'), P(ball(rad * 1.05, 8, 6), SKIN, 'leather', end)];
  };
  return bake([
    ...[[0.033, 0.0125], [0.011, 0.0135], [-0.011, 0.0128], [-0.033, 0.0112]].flatMap(([dy, rad], i) => ring(gy + dy, 1.2, 4.15 - i * 0.12, rad)),
    ...ring(gy + 0.056, 0.95, -0.95, 0.0145, 0.01),
    P(rbox(0.05, 0.1, 0.082, 0.022, true), SKIN, 'leather', [R + 0.03, gy, 0.012]),
    P(rbox(0.032, 0.088, 0.09, 0.02, true), SKIN, 'leather', [R + 0.052, gy, 0.03]),
    P(capsule(0.03, 0.04), SKIN, 'leather', [R + 0.07, gy - 0.04, 0.075], [0.9, 0, 0.3]),
    ...[0.033, 0.011, -0.011, -0.033].map((dy) => P(ball(0.0135, 8, 6), 0xb98870, 'leather', [R + 0.052, gy + dy, -0.02])),
  ], { ...GW, seed });
}

// Forearm from the wrist (y = 0) to the elbow (y = 1): skin, shirt cuff, jacket sleeve, a watch.
function forearmGeo() {
  return bake([
    P(rcyl(0.062, 0.044, 1.0, 0.02, 14, 3), SKIN, 'leather', [0, 0.5, 0]),
    P(rcyl(0.078, 0.074, 0.07, 0.012, 16), C.shirt, 'cloth', [0, 0.23, 0]),
    P(rcyl(0.108, 0.1, 0.7, 0.03, 18, 2), C.jacket, 'cloth', [0, 0.62, 0]),
    P(rcyl(0.049, 0.049, 0.03, 0.008, 16), C.rubber, 'rubber', [0, 0.09, 0]),
    P(rcyl(0.024, 0.024, 0.012, 0.004, 14), C.chrome, 'chrome', [0, 0.09, 0.05], [HALF, 0, 0]),
  ], { ...GW, seed: 11 });
}

const _fb = {
  x: new THREE.Vector3(),
  y: new THREE.Vector3(),
  z: new THREE.Vector3(),
  m: new THREE.Matrix4(),
};

// Point a forearm mesh from wrist `w` to elbow `e`, keeping its +z side towards the camera.
function aimForearm(mesh, w, e) {
  _fb.y.copy(e).sub(w);
  const len = _fb.y.length() || 1;
  _fb.y.divideScalar(len);
  _fb.z.set(0, 0.3, 1);
  _fb.z.addScaledVector(_fb.y, -_fb.z.dot(_fb.y)).normalize();
  _fb.x.crossVectors(_fb.y, _fb.z);
  _fb.m.makeBasis(_fb.x, _fb.y, _fb.z);
  mesh.quaternion.setFromRotationMatrix(_fb.m);
  mesh.position.copy(w);
  mesh.scale.set(1, len, 1);
}

const MOUTH = [-0.22, 0.09, 0.32]; // "Freddie's mouth" in viewmodel space (camera-local about 0, -0.18, -0.4)
const REST = [0.0, 0.03, 0.0];
const ELBOW_R = [0.62, -0.62, 0.85];
const ELBOW_L = [-0.7, -0.62, 0.85];
const _fw = new THREE.Vector3();
const _fe = new THREE.Vector3();

export function makeDrinkViewmodel(id) {
  const D = DRINK[id];
  if (!D) throw new Error(`makeDrinkViewmodel: unknown drink "${id}"`);
  const group = new THREE.Group();
  group.name = `drink-${id}`;
  const rig = new THREE.Group();
  group.add(rig);
  const { group: drinkG, parts } = buildDrink(id);
  const skinMat = pbrMat();
  const both = id === 'lastorders';
  const fore = once('forearm', forearmGeo);

  // Free parts live in the viewmodel root so they can fly off on their own.
  const free = new THREE.Group();
  group.add(free);
  const detach = (m) => { if (m) { drinkG.remove(m); free.add(m); } };
  const bottleParts = both ? ['glass', 'liquid', 'foil', 'label', 'halo'].map((n) => parts[n]) : [];
  if (both) {
    const bottle = new THREE.Group();
    bottle.name = 'bottle';
    for (const p of bottleParts) bottle.add(p);
    drinkG.add(bottle);
    drinkG.userData.bottle = bottle;
  }
  rig.add(drinkG);
  const hand = new THREE.Mesh(once(`hand:${id}`, () => handGeo(D.R, D.gy, 1)), skinMat);
  rig.add(hand);
  const foreR = new THREE.Mesh(fore, skinMat);
  group.add(foreR);
  const wristR = new THREE.Vector3(D.R + 0.07, D.gy - 0.05, 0.085);
  let hand2 = null;
  let foreL = null;
  const gy2 = -0.13;
  const wristL = new THREE.Vector3(-(D.R + 0.07), gy2 - 0.05, 0.085);
  if (both) {
    hand2 = new THREE.Mesh(once('hand:lastorders:2', () => handGeo(0.058, gy2, 2)), skinMat);
    hand2.scale.x = -1;
    rig.add(hand2);
    foreL = new THREE.Mesh(fore, skinMat);
    foreL.scale.x = -1;
    group.add(foreL);
  }
  // Extras that are not part of the rig.
  let glowDisc = null;
  let moustache = null;
  if (both) {
    glowDisc = new THREE.Mesh(once('lo:glow', () => {
      const g = new THREE.CircleGeometry(0.5, 28);
      const P2 = g.attributes.position;
      const col = new Float32Array(P2.count * 3);
      for (let i = 0; i < P2.count; i++) {
        const f = Math.max(0, 1 - Math.hypot(P2.getX(i), P2.getY(i)) / 0.5);
        _c.set(0xffb030).multiplyScalar(0.42 * f * f);
        col.set([_c.r, _c.g, _c.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    }), once('lo:glowmat', () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false })));
    glowDisc.position.set(-0.22, 0.06, 0.42);
    glowDisc.renderOrder = 10;
    glowDisc.visible = false;
    group.add(glowDisc);
  }
  if (id === 'heavy') {
    moustache = new THREE.Mesh(once('moustache', () => bake([
      P(capsule(0.014, 0.07), 0xe8d8b0, 'plastic', [-0.04, -0.004, 0], [0, 0, HALF + 0.3]),
      P(capsule(0.014, 0.07), 0xe8d8b0, 'plastic', [0.04, -0.004, 0], [0, 0, HALF - 0.3]),
      P(ball(0.02, 8, 6), 0xe8d8b0, 'plastic', [0, 0.004, 0.0]),
      P(ball(0.013, 6, 4), 0xe8d8b0, 'plastic', [-0.08, 0.012, 0.0]),
      P(ball(0.013, 6, 4), 0xe8d8b0, 'plastic', [0.08, 0.012, 0.0]),
    ], GW)), glowBasic(0xe8d8b0, 0.85, false));
    moustache.position.set(-0.22, 0.045, 0.4);
    moustache.visible = false;
    moustache.renderOrder = 9;
    group.add(moustache);
  }
  if (id === 'orange') detach(parts.cap);

  // The rig pose as a pure function of k, so the flight of a thrown bottle can reuse it.
  function rigState(k) {
    const up = smooth(clamp(k / 0.2, 0, 1)) * (1 - smooth(clamp((k - 0.75) / 0.25, 0, 1)));
    const tilt = D.tilt * smooth(clamp((k - 0.2) / 0.3, 0, 1)) * (1 - smooth(clamp((k - D.out) / 0.2, 0, 1)));
    const th = lerp(-0.12, 0.2, up) + tilt;
    const sec = k * D.duration;
    const rimY = D.rim * Math.cos(th);
    const rimZ = D.rim * Math.sin(th);
    const px = lerp(REST[0], MOUTH[0], up) + up * 0.006 * Math.sin(sec * 7.3);
    const py = lerp(REST[1], MOUTH[1] - rimY, up) + up * (0.005 * Math.sin(sec * 9.1) + (tilt > 0.3 ? 0.004 * Math.sin(sec * 15) : 0));
    const pz = lerp(REST[2], MOUTH[2] - rimZ, up) + up * 0.005 * Math.cos(sec * 6.1);
    return { up, tilt, th, px, py, pz, roll: up * 0.07 * Math.sin(sec * 3.7), sec };
  }

  function setPose(k) {
    k = clamp(num(k, 0), 0, 1);
    const s = rigState(k);
    let { px, py, pz, th, roll } = s;
    const sec = s.sec;

    // per-drink flavour
    if (id === 'dram') {
      const aah = sstep(0.74, 0.8, k) * (1 - sstep(0.88, 0.95, k));
      roll += Math.sin(sec * 60) * 0.02 * aah;
      py += 0.01 * aah;
      parts.liquid.scale.set(1, Math.max(0.001, 1 - 0.93 * sstep(0.3, 0.52, k)), 1);
      parts.liquid.rotation.x = -0.15 * s.tilt / D.tilt * Math.sin(sec * 11);
    } else if (id === 'orange') {
      parts.liquid.scale.set(1, Math.max(0.001, 1 - 0.93 * sstep(0.32, 0.7, k)), 1);
      const burp = sstep(0.8, 0.84, k) * (1 - sstep(0.88, 0.94, k));
      py += 0.018 * burp;
      th += 0.05 * burp;
      // cap: twist and lift while it is on, then it is dropped and falls out of frame
      const cap = parts.cap;
      const tw = clamp((k - 0.06) / 0.14, 0, 1);
      const tcap = Math.max(0, k - 0.2) * D.duration;
      if (k < 0.2) {
        const a = Math.sin(th) * 0.281;
        cap.position.set(px + 0, py + Math.cos(th) * (0.281 + 0.012 * tw), pz + a);
        cap.rotation.set(th, -tw * Math.PI * 3, 0, 'XYZ');
        cap.rotation.order = 'YXZ';
        cap.rotation.set(th, -tw * Math.PI * 3, 0);
        cap.visible = true;
      } else {
        const a = Math.sin(0.2 + 0.0) * 0.281;
        const base = rigState(0.2);
        const x0 = base.px;
        const y0 = base.py + Math.cos(base.th) * 0.293;
        const z0 = base.pz + Math.sin(base.th) * 0.293 + a * 0;
        cap.position.set(x0 - 0.25 * tcap, y0 + 0.12 * tcap - 1.9 * tcap * tcap, z0 + 0.15 * tcap);
        cap.rotation.order = 'YXZ';
        cap.rotation.set(base.th + tcap * 9, -Math.PI * 3 - tcap * 7, tcap * 5);
        cap.visible = cap.position.y > -1.2;
      }
      const fz = parts.fizz;
      const f = sstep(0.16, 0.2, k) * (1 - sstep(0.26, 0.4, k));
      fz.visible = f > 0.01;
      fz.position.set(px + 0, py + Math.cos(th) * 0.27, pz + Math.sin(th) * 0.27);
      fz.scale.setScalar(0.35 + 0.7 * f + 0.6 * (1 - f) * f);
    } else if (id === 'heavy') {
      const g1 = sstep(0.28, 0.36, k);
      const g2 = sstep(0.42, 0.5, k);
      const g3 = sstep(0.56, 0.64, k);
      const lvl = 1 - 0.3 * g1 - 0.3 * g2 - 0.32 * g3;
      parts.liquid.scale.set(1, Math.max(0.001, lvl), 1);
      parts.foam.position.y = -0.113 + 0.2 * Math.max(0.001, lvl);
      parts.foam.scale.set(1, 0.4 + 0.6 * lvl, 1);
      py += 0.006 * (Math.sin(g1 * Math.PI) + Math.sin(g2 * Math.PI) + Math.sin(g3 * Math.PI));
      th += 0.03 * (Math.sin(g1 * Math.PI) + Math.sin(g2 * Math.PI) + Math.sin(g3 * Math.PI));
      const m = sstep(0.7, 0.76, k) * (1 - sstep(0.84, 0.95, k));
      moustache.visible = m > 0.01;
      moustache.scale.set(0.12 + 0.5 * m, 0.25 + 0.4 * m, 1);
      moustache.position.x = -0.22 - 0.5 * sstep(0.84, 0.95, k);
      roll += Math.sin(sec * 8) * 0.01 * sstep(0.74, 0.8, k) * (1 - sstep(0.86, 0.92, k));
    } else if (id === 'energy') {
      parts.tab.rotation.x = -1.35 * sstep(0.06, 0.16, k);
      const p = clamp((k - 0.1) / 0.28, 0, 1);
      parts.puff.visible = p > 0 && p < 1;
      parts.puff.scale.setScalar(0.25 + 0.8 * Math.sin(p * Math.PI * 0.6) + 0.3 * p);
      parts.puff.position.y = 0.14 + 0.03 * p;
      const sq = sstep(0.7, 0.8, k);
      parts.can.scale.set(1 - 0.24 * sq, 1 - 0.06 * sq, 1 - 0.14 * sq);
      parts.can.rotation.z = 0.12 * sq;
      parts.stripeM.scale.copy(parts.can.scale);
      parts.stripeC.scale.copy(parts.can.scale);
      parts.stripeM.rotation.z = parts.stripeC.rotation.z = 0.12 * sq;
      hand.scale.x = 1 - 0.06 * sq;
      roll += Math.sin(sec * 40) * 0.02 * sq * (1 - sstep(0.82, 0.9, k));
    } else if (id === 'lastorders') {
      const glug = sstep(0.24, 0.32, k) * (1 - sstep(0.6, 0.66, k));
      parts.liquid.scale.set(1, Math.max(0.001, 1 - 0.95 * sstep(0.3, 0.62, k)), 1);
            glowDisc.visible = glug > 0.01 || k > 0.62 && k < 0.78;
      const roar = sstep(0.62, 0.68, k) * (1 - sstep(0.76, 0.8, k));
      glowDisc.scale.setScalar(0.45 + 0.5 * glug + 0.3 * roar);
      glowDisc.material.opacity = 1;
      px += Math.sin(sec * 55) * 0.012 * roar;
      py += Math.cos(sec * 47) * 0.01 * roar;
      roll += Math.sin(sec * 33) * 0.03 * roar;
    }

    rig.position.set(px, py, pz);
    rig.rotation.set(th, 0, roll);
    rig.updateMatrix();

    // the thrown bottle leaves the rig and flies off down and out of frame
    if (both) {
      const bottle = drinkG.userData.bottle;
      const kt = 0.76;
      if (k < kt) {
        if (bottle.parent !== drinkG) {
          free.remove(bottle);
          drinkG.add(bottle);
        }
        bottle.position.set(0, 0, 0);
        bottle.rotation.set(0, 0, 0);
        bottle.visible = true;
      } else {
        if (bottle.parent !== free) {
          drinkG.remove(bottle);
          free.add(bottle);
        }
        const b0 = rigState(kt);
        const t = (k - kt) / (1 - kt);
        bottle.position.set(b0.px - 0.55 * t, b0.py + 0.2 * t - 1.9 * t * t, b0.pz + 0.45 * t);
        bottle.rotation.set(b0.th + 9 * t, 0, b0.roll + 4 * t);
        bottle.visible = bottle.position.y > -1.6;
      }
    }

    // forearms follow the hands
    _fw.copy(wristR).applyMatrix4(rig.matrix);
    _fe.set(...ELBOW_R);
    aimForearm(foreR, _fw, _fe);
    if (both) {
      _fw.copy(wristL).applyMatrix4(rig.matrix);
      _fe.set(...ELBOW_L);
      aimForearm(foreL, _fw, _fe);
      foreL.scale.x = -1;
    }
  }

  setPose(0);
  return { group, setPose, duration: D.duration };
}

// ---------------------------------------------------------------------------------------------
// Freddie himself (third-person model for the Last Orders spin)
// ---------------------------------------------------------------------------------------------

const F = {
  purple: 0x5a2ba6, purpleD: 0x2e1658, pink: 0xff4f9f, jeans: 0x2d4170, jeansL: 0x4a6194, skin: 0xd9a687,
  hair: 0x2a1812, tee: 0xf0efe8, trainer: 0xf1ede4,
};
const F_HIP = 0.92;
const F_NECK = 1.53;
const F_L1 = 0.3;
const F_L2 = 0.36;
const F_SHOULDER = [0.265, 1.38 - F_HIP, 0];

function freddieGeo() {
  const o = { seed: 21 };
  const arm = (hex) => bake([
    P(ball(0.085, 12, 8), hex, 'leather'),
    P(rcyl(0.07, 0.062, 0.3, 0.025, 16), hex, 'leather', [0, -0.15, 0]),
    P(rcyl(0.066, 0.066, 0.025, 0.01, 16), F.pink, 'gloss', [0, -0.2, 0]),
    P(rcyl(0.064, 0.064, 0.04, 0.012, 16), F.purpleD, 'rubber', [0, -0.29, 0]),
  ], { originY: 1.2, ...o });
  return {
    leg: bake([
      P(rcyl(0.1, 0.075, 0.78, 0.04, 16, 3), F.jeans, 'cloth', [0, -0.39, 0]),
      P(rcyl(0.082, 0.082, 0.05, 0.015, 16), F.jeansL, 'cloth', [0, -0.74, 0]),
      P(rbox(0.1, 0.09, 0.02, 0.01), 0x3f5a8c, 'cloth', [0, -0.36, -0.088]),
      P(rbox(0.13, 0.035, 0.3, 0.015), 0xe8e4dc, 'rubber', [0, -0.9025, -0.06]),
      P(rbox(0.115, 0.07, 0.26, 0.04, true), F.trainer, 'gloss', [0, -0.8475, -0.07], [0, 0, 0], [1, 1, 1], { rust: 0.12 }),
      P(rbox(0.11, 0.05, 0.1, 0.03), 0xff6aa8, 'gloss', [0, -0.8575, -0.17]),
      P(rbox(0.1, 0.06, 0.04, 0.015), 0xff6aa8, 'gloss', [0, -0.83, 0.05]),
      ...[0, 1, 2].map((i) => P(rbox(0.07, 0.008, 0.012, 0.003), 0x20202a, 'cloth', [0, -0.808, -0.1 - i * 0.04])),
    ], { originY: F_HIP, ...o }),
    torso: bake([
      P(rcyl(0.215, 0.215, 0.045, 0.012, 20), C.rubber, 'rubber', [0, 0.965, 0]),
      P(rbox(0.05, 0.035, 0.012, 0.005), C.chrome, 'chrome', [0, 0.965, -0.216]),
      P(rbox(0.42, 0.3, 0.25, 0.1, true), F.purple, 'leather', [0, 1.1, 0]),
      P(rbox(0.5, 0.3, 0.27, 0.1, true), F.purple, 'leather', [0, 1.34, 0]),
      P(rbox(0.15, 0.26, 0.04, 0.015), F.tee, 'cloth', [0, 1.33, -0.125]),
      P(rbox(0.012, 0.34, 0.012, 0.004), C.chrome, 'chrome', [0.09, 1.2, -0.138]),
      P(rbox(0.52, 0.04, 0.285, 0.015), F.pink, 'gloss', [0, 1.2, 0]),
      ...[-1, 1].map((s) => P(ball(0.105, 12, 8), F.purple, 'leather', [s * F_SHOULDER[0], 1.38, 0])),
      ...[-1, 1].map((s) => P(rbox(0.1, 0.07, 0.02, 0.01), F.purpleD, 'leather', [s * 0.14, 1.09, -0.128])),
      P(rcyl(0.1, 0.12, 0.08, 0.03, 16), F.purpleD, 'rubber', [0, 1.5, 0]),
    ], { base: [0, F_HIP, 0], ...o }),
    tail: bake([
      P(rcyl(0.235, 0.26, 0.14, 0.04, 22), F.purple, 'leather', [0, 0.93, 0]),
      P(rcyl(0.262, 0.262, 0.03, 0.01, 22), F.pink, 'gloss', [0, 0.89, 0]),
      P(rcyl(0.255, 0.255, 0.04, 0.012, 22), F.purpleD, 'rubber', [0, 0.86, 0]),
    ], { base: [0, F_HIP, 0], ...o }),
    head: bake([
      P(rbox(0.19, 0.24, 0.21, 0.09, true), F.skin, 'leather', [0, 1.65, 0]),
      P(rbox(0.17, 0.07, 0.18, 0.04), F.skin, 'leather', [0, 1.575, -0.015]),
      P(rbox(0.03, 0.045, 0.04, 0.012), 0xcf9878, 'leather', [0, 1.645, -0.115]),
      ...[-1, 1].map((s) => P(ball(0.03, 8, 6), F.skin, 'leather', [s * 0.098, 1.65, 0])),
      ...[-1, 1].map((s) => P(rbox(0.05, 0.012, 0.012, 0.004), 0x1a100c, 'plastic', [s * 0.045, 1.705, -0.108], [0, 0, -s * 0.15])),
      P(rcyl(0.055, 0.062, 0.1, 0.02, 14), F.skin, 'leather', [0, 1.52, 0]),
    ], { base: [0, F_NECK, 0], ...o }),
    mouth: bake([
      P(rbox(0.08, 0.022, 0.01, 0.005), 0x2a0c0c, 'plastic'),
      P(rbox(0.07, 0.011, 0.008, 0.003), 0xf4f0e8, 'plastic', [0, 0.005, -0.003]),
    ], { originY: 1.6, ...o }),
    hair: bake([
      P(rbox(0.2, 0.07, 0.24, 0.04, true), F.hair, 'gloss', [0, 1.78, 0.01]),
      P(rbox(0.17, 0.08, 0.11, 0.035, true), F.hair, 'gloss', [0, 1.805, -0.09], [0.35, 0, 0]),
      P(rbox(0.03, 0.01, 0.1, 0.004), F.pink, 'gloss', [0.03, 1.848, -0.09], [0.35, 0, 0]),
      ...[-1, 1].map((s) => P(rbox(0.025, 0.1, 0.15, 0.01), F.hair, 'gloss', [s * 0.1, 1.73, 0.03])),
      P(rbox(0.18, 0.09, 0.08, 0.03), F.hair, 'gloss', [0, 1.74, 0.1]),
    ], { base: [0, F_NECK, 0], originY: 1.3, ...o }),
    shades: bake([
      P(rbox(0.22, 0.04, 0.05, 0.015), C.black, 'plastic', [0, 1.675, -0.108]),
      ...[-1, 1].map((s) => P(rbox(0.088, 0.048, 0.022, 0.016), 0x2a1030, 'glass', [s * 0.05, 1.672, -0.128])),
      ...[-1, 1].map((s) => P(rbox(0.01, 0.01, 0.12, 0.003), C.black, 'plastic', [s * 0.108, 1.675, -0.05])),
    ], { base: [0, F_NECK, 0], originY: 1.3, ...o }),
    phones: bake([
      P(tube([[-0.14, 1.65, 0], [-0.125, 1.76, 0], [0, 1.815, 0], [0.125, 1.76, 0], [0.14, 1.65, 0]], 0.013, 24, 6), F.pink, 'gloss'),
      ...[-1, 1].flatMap((s) => [
        P(rcyl(0.07, 0.07, 0.05, 0.02, 18), F.pink, 'gloss', [s * 0.14, 1.65, 0], [0, 0, HALF]),
        P(rcyl(0.058, 0.058, 0.03, 0.012, 18), 0x1a1618, 'rubber', [s * 0.115, 1.65, 0], [0, 0, HALF]),
        P(torus(0.06, 0.006, 18, 4), C.chrome, 'chrome', [s * 0.168, 1.65, 0], [0, HALF, 0]),
      ]),
    ], { base: [0, F_NECK, 0], originY: 1.3, ...o }),
    armPurple: arm(F.purple),
    fore: bake([
      P(rcyl(0.062, 0.052, 0.3, 0.02, 16), F.purple, 'leather', [0, -0.15, 0]),
      P(rcyl(0.058, 0.058, 0.025, 0.01, 16), F.pink, 'gloss', [0, -0.08, 0]),
      P(rcyl(0.058, 0.058, 0.045, 0.015, 16), F.purpleD, 'rubber', [0, -0.29, 0]),
      P(rbox(0.095, 0.1, 0.1, 0.04), F.skin, 'leather', [0, -0.37, 0]),
      ...[0, 1, 2].map((i) => P(rbox(0.088, 0.02, 0.03, 0.01), 0xc8947a, 'leather', [0, -0.34 - i * 0.027, -0.052])),
      P(capsule(0.018, 0.04), F.skin, 'leather', [0.05, -0.35, -0.03], [0.4, 0, 0.5]),
    ], { originY: 1.2, ...o }),
    gun: bake([
      P(rbox(0.2, 0.22, 0.3, 0.06, true), 0x2e2f36, 'gloss', [0, 0, -0.1], [0, 0, 0], [1, 1, 1], { rust: 0.2 }),
      ...[0, 1, 2, 3].map((i) => P(rbox(0.17, 0.012, 0.03, 0.004), 0x0a0a0c, 'plastic', [0, 0.112, -0.03 - i * 0.07])),
      P(rcyl(0.085, 0.085, 0.5, 0.02, 22), 0x4a4d54, 'metal', [0, 0.0, -0.45], [HALF, 0, 0], [1, 1, 1], { rust: 0.25 }),
      ...[-0.3, -0.38, -0.46, -0.54, -0.62].map((z) => P(torus(0.09, 0.012, 22, 5), BRASS, 'brass', [0, 0, z])),
      P(rbox(0.05, 0.14, 0.06, 0.02), C.rubber, 'rubber', [0, -0.15, -0.16], [-0.2, 0, 0]),
      ...[-0.05, 0, 0.05].map((d) => P(rbox(0.055, 0.012, 0.065, 0.003), TAPE, 'tape', [0, -0.15 + d, -0.16 + 0.2 * d], [-0.2, 0, 0])),
      P(rbox(0.05, 0.12, 0.05, 0.02), C.rubber, 'rubber', [0, -0.14, -0.38]),
      ...[-0.04, 0, 0.04].map((d) => P(rbox(0.054, 0.012, 0.054, 0.003), TAPE, 'tape', [0, -0.14 + d, -0.38])),
      P(rbox(0.04, 0.05, 0.05, 0.01), C.steel, 'metal', [0, 0.12, -0.5]),
    ], { originY: 1.3, seed: 22 }),
    bell: bake([
      P(lathe([[0.085, 0], [0.1, 0.04], [0.14, 0.12], [0.2, 0.22], [0.235, 0.3], [0.24, 0.31], [0.228, 0.31], [0.19, 0.22], [0.13, 0.12], [0.085, 0.05], [0, 0.05]], 28), 0x555a60, 'metal', [0, 0, -0.7], [-HALF, 0, 0], [1, 1, 1], { rust: 0.2 }),
      P(torus(0.24, 0.015, 28, 5), C.chrome, 'chrome', [0, 0, -1.01]),
      P(rcyl(0.1, 0.1, 0.01, 0.003, 20), 0x1a1410, 'paper', [0, 0, -0.76], [HALF, 0, 0]),
    ], { originY: 1.3, seed: 23 }),
    coreW: ball(0.055, 12, 8),
    coreM: torus(0.12, 0.02, 28, 6),
    lamps: bake([
      P(ball(0.012, 6, 4), 0xffffff, 'plastic', [0.06, 0.092, -0.2]),
      P(ball(0.012, 6, 4), 0xffffff, 'plastic', [-0.06, 0.092, -0.2]),
      P(ball(0.012, 6, 4), 0xffffff, 'plastic', [0, 0.14, -0.5]),
    ], GW),
  };
}

export function makeFreddie() {
  const geo = once('freddie', freddieGeo);
  const mat = pbrMat();
  const meshes = [];
  const mk = (g, m, parent, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  const group = new THREE.Group();
  group.name = 'freddie';
  const root = new THREE.Group();
  group.add(root);
  const legL = mk(geo.leg, mat, root, -0.105, F_HIP, 0);
  const legR = mk(geo.leg, mat, root, 0.105, F_HIP, 0);
  const upper = new THREE.Group();
  upper.position.y = F_HIP;
  root.add(upper);
  mk(geo.torso, mat, upper);
  const tail = mk(geo.tail, mat, upper);
  const headG = new THREE.Group();
  headG.position.y = F_NECK - F_HIP;
  upper.add(headG);
  mk(geo.head, mat, headG);
  mk(geo.hair, mat, headG);
  mk(geo.shades, mat, headG);
  mk(geo.phones, mat, headG);
  const mouth = mk(geo.mouth, mat, headG, 0, 1.588 - F_NECK, -0.108);
  const sh = (s) => new THREE.Vector3(s * F_SHOULDER[0], F_SHOULDER[1], F_SHOULDER[2]);
  const armU = [-1, 1].map((s) => { const m = mk(geo.armPurple, mat, upper); m.userData.side = s; return m; });
  const armF = [-1, 1].map((s) => { const m = mk(geo.fore, mat, upper); m.userData.side = s; return m; });

  // the laser horn, held in front of the belly (hidden when idle)
  const gunG = new THREE.Group();
  gunG.position.set(0, 0.28, -0.1);
  upper.add(gunG);
  mk(geo.gun, mat, gunG);
  mk(geo.bell, mat, gunG);
  const coreW = mk(geo.coreW, glowBasic(0xffffff, 7, false), gunG, 0, 0, -0.8);
  const coreM = mk(geo.coreM, glowBasic(COLOURS.magenta, 6, false), gunG, 0, 0, -0.9);
  mk(geo.lamps, glowBasic(COLOURS.cyan, 5, false), gunG);
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0, -1.02);
  gunG.add(muzzle);

  const _ik = {
    d: new THREE.Vector3(), dir: new THREE.Vector3(), pp: new THREE.Vector3(), e: new THREE.Vector3(), g: new THREE.Vector3(), down: new THREE.Vector3(0, -1, 0), v: new THREE.Vector3(),
  };
  // Two-bone arm solve in the upper-body frame: shoulder S to grip target G, elbow towards `pole`.
  function solveArm(i, G, pole) {
    const s = i === 0 ? -1 : 1;
    const S = sh(s);
    const { d, dir, pp, e, g, down, v } = _ik;
    d.copy(G).sub(S);
    const len = d.length() || 1;
    dir.copy(d).divideScalar(len);
    const dist = clamp(len, 0.05, F_L1 + F_L2 - 0.002);
    const a = (F_L1 * F_L1 - F_L2 * F_L2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, F_L1 * F_L1 - a * a));
    pp.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
    e.copy(S).addScaledVector(dir, a).addScaledVector(pp, h);
    g.copy(S).addScaledVector(dir, dist);
    armU[i].position.copy(S);
    armU[i].quaternion.setFromUnitVectors(down, v.copy(e).sub(S).normalize());
    armF[i].position.copy(e);
    armF[i].quaternion.setFromUnitVectors(down, v.copy(g).sub(e).normalize());
  }

  const _g = [new THREE.Vector3(), new THREE.Vector3()];
  const _pole = [new THREE.Vector3(), new THREE.Vector3()];

  function setPose(state, t, k) {
    t = Math.max(0, num(t, 0));
    k = clamp(num(k, 0), 0, 1);
    const spin = state === 'spin';
    const a = spin ? easeOut(clamp(k / 0.2, 0, 1)) : 0;
    const breathe = Math.sin(t * 2.1);
    const buzz = spin ? a * (Math.sin(t * 71) + 0.6 * Math.sin(t * 53 + 1)) : 0;
    const wind = spin ? 1 - sstep(0.9, 1, k) : 0;

    // legs: relaxed, or braced wide
    const splay = 0.22 * a;
    legL.rotation.set(0.05 * a, 0, -splay);
    legR.rotation.set(-0.05 * a, 0, splay);
    root.position.set(0, -0.92 * (1 - Math.cos(splay)), 0);
    root.rotation.set(0, 0, 0);

    upper.position.set(0, F_HIP, 0);
    upper.rotation.set(0.2 * a + 0.015 * breathe * (1 - a), 0, 0.02 * Math.sin(t * 1.1) * (1 - a));
    upper.scale.set(1, 1 + 0.008 * breathe * (1 - a), 1);
    headG.rotation.set(-0.18 * a + 0.02 * Math.sin(t * 1.3) * (1 - a) + buzz * 0.012, 0.1 * Math.sin(t * 0.8) * (1 - a), buzz * 0.01);
    tail.scale.set(1 + (0.06 + 0.04 * Math.sin(t * 30)) * a, 1, 1 + (0.06 + 0.04 * Math.sin(t * 30)) * a);
    mouth.scale.set(1 + 0.4 * a, 1 + 0.9 * a, 1);

    gunG.visible = spin;
    gunG.position.set(buzz * 0.003, 0.28 + buzz * 0.004, -0.1 + a * 0);
    gunG.rotation.set(buzz * 0.004, buzz * 0.003, 0);
    coreW.scale.setScalar((1 + 0.25 * Math.sin(t * 60)) * (0.3 + 0.7 * wind) * a + 0.001);
    coreM.scale.setScalar((1 + 0.12 * Math.sin(t * 45 + 1)) * (0.3 + 0.7 * wind) * a + 0.001);
    coreM.rotation.z = t * 6;

    // arm targets: hanging when idle, on the horn's grips in the spin
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const idleG = new THREE.Vector3(s * 0.3, -0.06 + 0.01 * breathe, 0.04);
      const gunGrip = i === 1
        ? new THREE.Vector3(0.03, 0.28 - 0.14, -0.1 - 0.16)
        : new THREE.Vector3(-0.03, 0.28 - 0.14, -0.1 - 0.38);
      gunGrip.x += buzz * 0.004;
      gunGrip.y += buzz * 0.005;
      _g[i].copy(idleG).lerp(gunGrip, a);
      _pole[i].set(s * lerp(0.4, 0.8, a), lerp(-0.3, -0.7, a), lerp(0.6, 0.15, a));
      solveArm(i, _g[i], _pole[i]);
    }
    for (const m of meshes) m.matrixAutoUpdate = true;
  }

  setPose('idle', 0, 0);
  return { group, height: 1.8, setPose, muzzle };
}

