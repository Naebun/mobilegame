// Level 2 dressing: stone vaults, torches, casks, tombs, hanging braziers. world.js calls these hooks in order:
//   plan(face) and lights(emit, ...) before the light bake, init(kit) once the meshers exist, prop(...) per map tile,
//   dress() for everything else, finish(...) when materials are made, animate(t) every frame.
// Procedural only (no image files, no DOM), like world.js. Torches and flames flicker through shared materials, so
// the whole level costs two extra draw calls.
import * as THREE from '../../vendor/three.module.min.js';
import { TILE, WALL_H } from '../consts.js';

const T = TILE;

// Wall torches are planned per face; hanging braziers and lanterns are listed here in tile units.
const BRAZIERS = [
  ['casks', [[36.5, 40]]],
  ['plague', [[11, 18], [23, 18], [17, 22], [5, 15], [29, 24]]],
  ['tour', [[12, 4.5], [24, 4.5], [12, 9.5], [30, 9.5]]],
];
const LANTERNS = [[10.5, 30.5], [18.5, 30.5], [26.5, 30.5], [34.5, 30.5]];
const PUDDLES = [
  [20, 49.5, 0.9], [34, 48, 0.7], [26, 51, 0.6], [6, 50, 0.7], [37, 42, 0.8], [33, 38, 0.6], [14, 30, 0.7], [27, 31, 0.9], [38, 29.5, 0.6],
  [10, 20, 0.9], [20, 17, 0.7], [27, 23, 0.8], [5, 18, 0.6], [14, 25, 0.6], [12, 6, 0.7], [27, 8, 0.8], [20, 3.5, 0.6],
];
const VAULT_RIBS = [ // [axis the arch spans, fixed tile coordinate, from tile, to tile, spring height]
  ...[12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42].map((c) => ['z', c + 0.5, 47, 52, 2.4]),
  ...[36, 39, 42].map((r) => ['x', r + 0.5, 30, 43, 2.55]),
  ...[8, 14, 20, 26].map((c) => ['z', c + 0.5, 13, 27, 2.7]),
  ...[10, 18, 26].map((c) => ['z', c + 0.5, 2, 12, 2.7]),
];
const BEAMS = [6, 10, 14, 18, 22, 26, 30, 34, 38, 42]; // close: timber beams across the street at these columns

export function makeVaultsDecor(lv, env) {
  const { Q, areas, at, areaOfTile, doors, hash, ihash } = env;
  let k = null;
  const disc = (...a) => k.disc(...a);
  const annulus = (...a) => k.annulus(...a);
  let flames = null; // { mesh, mat, pos } once built
  const lamps = []; // real point lights: { light, base, kind }

  const jitter = (h, a) => 1 + (((h >>> 3) % 1000) / 1000 - 0.5) * 2 * a;
  const STONE = [0.7, 0.7, 0.68];
  const STONE_D = [0.5, 0.5, 0.5];
  const WOOD = [0.42, 0.3, 0.2];
  const WOOD_D = [0.3, 0.21, 0.14];

  // ---- planning ----
  function plan(fc) {
    const { c, r, nx, nz, h, id } = fc;
    const northWall = nz === 1;
    const southWall = nz === -1;
    const westWall = nx === 1;
    const eastWall = nx === -1;
    if (id === 'steps') {
      if (southWall && c === 5) return 'torch';
      if (northWall && c === 7) return 'torch';
      if (h % 7 === 0) return 'poster';
      return null;
    }
    if (id === 'longvault') {
      if (northWall && (c === 14 || c === 26 || c === 38)) return 'torch';
      if (southWall && (c === 20 || c === 32)) return 'torch';
      if (northWall && c % 6 === 2) return 'niche';
      if (southWall && c % 6 === 5) return 'niche';
      if (h % 13 === 0) return 'poster';
      if (h % 9 === 1) return 'cobweb';
      return null;
    }
    if (id === 'casks') {
      if (westWall && (r === 37 || r === 43)) return 'torch';
      if (eastWall && r === 40) return 'torch';
      if (northWall && c >= 31 && c <= 38 && c % 2 === 1) return 'rack';
      if (southWall && c >= 31 && c <= 37 && c % 3 === 1) return 'niche';
      if (h % 11 === 0) return 'poster';
      return null;
    }
    if (id === 'close') {
      if (northWall && c >= 9 && c <= 39 && c % 6 === 3) return 'doorway';
      if (southWall && c >= 8 && c <= 36 && c % 6 === 0) return 'doorway';
      if (northWall && c >= 10 && c <= 38 && c % 6 === 0) return 'window';
      if (southWall && c >= 9 && c <= 37 && c % 6 === 3) return 'window';
      if (northWall && (c === 20 || c === 31)) return 'sign';
      if (h % 9 === 0) return 'poster';
      return null;
    }
    if (id === 'plague') {
      if (westWall && r % 4 === 2) return 'skulls';
      if (eastWall && r % 4 === 2) return 'skulls';
      if (northWall && c % 6 === 2 && c !== 16 && c !== 17) return 'skulls';
      if (southWall && c % 6 === 4 && c !== 6 && c !== 7) return 'skulls';
      if (westWall && (r === 17 || r === 23)) return 'chains';
      if (northWall && (c === 8 || c === 26)) return 'torch';
      if (southWall && (c === 14 || c === 28)) return 'torch';
      if (h % 8 === 0) return 'cobweb';
      return null;
    }
    if (id === 'tour') {
      if (northWall && (c === 8 || c === 16 || c === 24 || c === 32)) return 'torch';
      if (southWall && (c === 8 || c === 28)) return 'torch';
      if (northWall && (c === 12 || c === 20 || c === 28)) return 'banner';
      if (southWall && (c === 12 || c === 22)) return 'poster';
      return null;
    }
    return null;
  }

  function lights(emit, faces, planMap) {
    for (const [fc, what] of planMap) {
      const x = (fc.f.cx + fc.nx * 0.35) / T;
      const z = (fc.f.cz + fc.nz * 0.35) / T;
      if (what === 'torch') emit(x, z, 1.95, 0xff8a38, 2.1, 9);
      else if (what === 'window') emit(x, z, 1.5, 0xffb060, 0.55, 4.2);
      else if (what === 'doorway') emit(x, z, 1.5, 0xff9a50, 0.3, 3.2);
    }
    emit(4.5, 46.5, 2.4, 0xa8c0ff, 1.0, 8); // cold street light down the steps
    for (const [id, ps] of BRAZIERS) for (const [c, r] of ps) emit(c, r, 2.35, id === 'plague' ? 0xffa050 : 0xff8040, id === 'tour' ? 1.25 : 1.05, 9, true);
    for (const [c, r] of LANTERNS) emit(c, r, 2.4, 0xffb060, 0.9, 8, true);
    emit(2, 5.5, 1.6, 0xaecbff, 0.9, 6); // the way out
  }

  function wallVariant(f) {
    if (f.id === 'longvault' && f.h % 7 === 0) return ['brick', [0.62, 0.52, 0.5]]; // an older patch of brick
    if (f.id === 'close' && f.h % 5 === 0) return ['stone', [0.72, 0.7, 0.66]];
    return null;
  }

  // ---- geometry ----
  function init(kit) {
    k = kit;
  }

  const ceilingTile = () => false; // flat ceiling; the stone ribs below carry the vaulted look

  // Flames are crossed soft quads with a teardrop texture, drawn additively and re-shaped every frame (see finish).
  const FL = []; // { x, y, z, s, ph }
  function flame(x, y, z, size) {
    FL.push({ x, y, z, s: size, ph: FL.length * 1.37 });
  }

  // torch bracket with a flame on a wall face
  function torch(f, i) {
    const { M, obox, C } = k;
    obox(M.metal, f, -0.04, 0.04, 1.5, 1.75, 0, 0.05, C.iron, { bottom: false });
    const p = f.p(0, 1.75, 0.24);
    M.metal.tube(f.p(0, 1.55, 0.03), [p[0], 1.62, p[2]], 0.02, C.iron, 4);
    M.metal.frustum(p[0], p[2], 0.06, 0.09, 1.6, 1.82, 8, C.iron, false);
    M.props.frustum(p[0], p[2], 0.05, 0.05, 1.62, 1.86, 8, [0.12, 0.08, 0.05]);
    flame(p[0], 1.84, p[2], 1.25);
    void i;
  }

  function niche(f, mode, h) {
    const { M, obox, C } = k;
    const w = 1.2;
    const spring = 1.4;
    const rise = 0.6;
    const N = Q.fine ? 10 : 6;
    const dark = [0.03, 0.028, 0.03];
    M.props.quad(f.p(-w / 2, 0.2, 0.012), f.p(w / 2, 0.2, 0.012), f.p(w / 2, spring, 0.012), f.p(-w / 2, spring, 0.012), dark, f.n);
    for (let n = 0; n < N; n++) {
      const a0 = Math.PI - (Math.PI * n) / N;
      const a1 = Math.PI - (Math.PI * (n + 1)) / N;
      const p0 = [(w / 2) * Math.cos(a0), spring + rise * Math.sin(a0)];
      const p1 = [(w / 2) * Math.cos(a1), spring + rise * Math.sin(a1)];
      const q0 = [(w / 2 + 0.16) * Math.cos(a0), spring + (rise + 0.16) * Math.sin(a0)];
      const q1 = [(w / 2 + 0.16) * Math.cos(a1), spring + (rise + 0.16) * Math.sin(a1)];
      M.props.tri(f.p(0, spring, 0.012), f.p(p0[0], p0[1], 0.012), f.p(p1[0], p1[1], 0.012), dark, f.n);
      M.stone.quad(f.p(p0[0], p0[1], 0.1), f.p(q0[0], q0[1], 0.1), f.p(q1[0], q1[1], 0.1), f.p(p1[0], p1[1], 0.1), [0.8, 0.78, 0.74], f.n);
    }
    obox(M.stone, f, -w / 2 - 0.16, -w / 2, 0, spring, 0, 0.1, [0.78, 0.76, 0.72], { bottom: false });
    obox(M.stone, f, w / 2, w / 2 + 0.16, 0, spring, 0, 0.1, [0.78, 0.76, 0.72], { bottom: false });
    obox(M.stone, f, -w / 2, w / 2, 0.18, 0.26, 0, 0.3, [0.7, 0.68, 0.64], { bottom: false }); // shelf
    if (mode === 'bottles') {
      for (let b = 0; b < 3; b++) {
        const u = -0.35 + b * 0.35;
        const q = f.p(u, 0, 0.16);
        k.M.glass.frustum(q[0], q[2], 0.045, 0.045, 0.26, 0.5, 6, [[0.28, 0.15, 0.04], [0.05, 0.2, 0.09], [0.4, 0.27, 0.07]][(h + b) % 3]);
        k.M.glass.frustum(q[0], q[2], 0.02, 0.02, 0.5, 0.62, 5, [0.3, 0.3, 0.3]);
      }
    } else if (mode === 'candle') {
      const q = f.p(0, 0, 0.14);
      M.props.frustum(q[0], q[2], 0.035, 0.03, 0.26, 0.46, 6, [0.8, 0.78, 0.66]);
      flame(q[0], 0.46, q[2], 0.5);
    }
  }

  function skull(x, y, z, yaw, s = 1) {
    const { M } = k;
    const bone = [0.78, 0.74, 0.62];
    M.props.frustum(x, z, 0.075 * s, 0.075 * s, y + 0.07 * s, y + 0.2 * s, 7, bone);
    M.props.frustum(x, z, 0.05 * s, 0.04 * s, y + 0.0, y + 0.07 * s, 7, bone, false);
    const dx = Math.cos(yaw);
    const dz = Math.sin(yaw);
    for (const sg of [-1, 1]) M.props.box(x + dx * 0.075 * s - dz * sg * 0.032 * s - 0.016 * s, y + 0.1 * s, z + dz * 0.075 * s + dx * sg * 0.032 * s - 0.016 * s, x + dx * 0.075 * s - dz * sg * 0.032 * s + 0.016 * s, y + 0.14 * s, z + dz * 0.075 * s + dx * sg * 0.032 * s + 0.016 * s, [0.02, 0.02, 0.02]);
  }

  function skulls(f, h) {
    const { M, obox } = k;
    niche(f, 'none', h);
    // a stack of skulls and long bones on the shelf and floor of the niche
    const rows = [[0.26, 4], [0.45, 3], [0.64, 2]];
    rows.forEach(([y, n], ri) => {
      for (let s = 0; s < n; s++) {
        const u = -0.34 + (0.68 * (s + 0.5)) / n + (ri % 2) * 0.04;
        const p = f.p(u, 0, 0.17 + ri * 0.01);
        skull(p[0], y, p[2], Math.atan2(f.n[2], f.n[0]), 1.0);
      }
    });
    obox(M.props, f, -0.5, 0.5, 0.2, 0.26, 0.04, 0.28, [0.7, 0.66, 0.54], { bottom: false });
  }

  function cobweb(f) {
    const { M } = k;
    const col = [0.5, 0.5, 0.5];
    const u0 = (ihash(f.cx, f.cz, 4) < 0.5 ? -1 : 1) * 0.95;
    for (let i = 0; i < 4; i++) {
      const a = (i / 3) * Math.PI * 0.5;
      M.props.tube(f.p(u0, WALL_H - 0.02, 0.03), f.p(u0 - Math.sign(u0) * Math.sin(a) * 0.7, WALL_H - Math.cos(a) * 0.7, 0.03), 0.004, col, 3);
    }
    M.props.tube(f.p(u0 - Math.sign(u0) * 0.35, WALL_H - 0.35, 0.03), f.p(u0 - Math.sign(u0) * 0.5, WALL_H - 0.4, 0.03), 0.004, col, 3);
  }

  function poster(f, h, big) {
    const { M, obox, disc, C } = k;
    const cols = [[0.72, 0.64, 0.46], [0.5, 0.18, 0.14], [0.2, 0.28, 0.4], [0.62, 0.55, 0.3]];
    const col = cols[h % cols.length];
    const w = big ? 1.2 : 0.7;
    const hh = big ? 1.6 : 0.95;
    const u = (((h >>> 4) % 3) - 1) * 0.25;
    const y = 1.2 + ((h >>> 8) % 3) * 0.2;
    obox(M.props, f, u - w / 2 - 0.03, u + w / 2 + 0.03, y - 0.03, y + hh + 0.03, 0, 0.012, [0.3, 0.26, 0.2], { bottom: false });
    obox(M.props, f, u - w / 2, u + w / 2, y, y + hh, 0, 0.02, col, { bottom: false });
    // a ghost: round head, a wavy sheet, two eyes
    const gx = u;
    const gy = y + hh * 0.55;
    disc(M.props, f, gx, gy + 0.18, 0.03, 0.12, 8, [0.9, 0.9, 0.86]);
    obox(M.props, f, gx - 0.12, gx + 0.12, gy - 0.12, gy + 0.18, 0, 0.03, [0.9, 0.9, 0.86], { bottom: false });
    for (const s of [-1, 1]) disc(M.props, f, gx + s * 0.05, gy + 0.2, 0.034, 0.025, 5, [0.05, 0.05, 0.06]);
    obox(M.props, f, u - w / 2 + 0.06, u + w / 2 - 0.06, y + 0.08, y + 0.2, 0, 0.026, [0.1, 0.08, 0.06], { bottom: false });
    if (Q.detail) for (const [pu, py] of [[-1, 1], [1, 1]]) M.metal.box(u + pu * (w / 2 - 0.03) - 0.015, y + py * (hh - 0.06) + 0.02, 0.02, u + pu * (w / 2 - 0.03) + 0.015, y + py * (hh - 0.06) + 0.05, 0.03, C.steel);
  }

  function rack(f, h) {
    // casks stacked on their sides, end on to the wall
    const { M, C } = k;
    for (let row = 0; row < 2; row++) {
      for (let s = 0; s < 2; s++) {
        const u = -0.45 + s * 0.9 + (row ? 0.0 : 0);
        const y = 0.55 + row * 1.0;
        const p = f.p(u, y, 0.5);
        const hex = [[0.4, 0.28, 0.18], [0.36, 0.25, 0.16], [0.45, 0.32, 0.2]][(h + s + row) % 3];
        // axis horizontal along the wall normal: stacked frusta, built as a pipe along the normal
        const a0 = f.p(u, y, 0.02);
        const a1 = f.p(u, y, 0.98);
        if (Math.abs(f.n[0]) > 0.5) M.wood.pipe('x', Math.min(a0[0], a1[0]), Math.max(a0[0], a1[0]), y, p[2], 0.44, 10, hex);
        else M.wood.pipe('z', Math.min(a0[2], a1[2]), Math.max(a0[2], a1[2]), y, p[0], 0.44, 10, hex);
        const rimA = f.p(u, y, 0.99);
        disc(M.wood, f, u, y, 0.99, 0.43, 10, [0.34, 0.24, 0.15]);
        disc(M.metal, f, u, y, 1.0, 0.05, 6, C.iron);
        void rimA;
      }
    }
  }

  function doorway(f, h) {
    const { M, obox, disc, C } = k;
    // a house door in the close: timber planks in a stone frame, a step, a lantern hook
    const hh = 2.05;
    obox(M.stone, f, -0.62, -0.5, 0, hh + 0.2, 0, 0.12, [0.68, 0.66, 0.62], { bottom: false });
    obox(M.stone, f, 0.5, 0.62, 0, hh + 0.2, 0, 0.12, [0.68, 0.66, 0.62], { bottom: false });
    obox(M.stone, f, -0.66, 0.66, hh, hh + 0.2, 0, 0.14, [0.7, 0.68, 0.64], { bottom: false });
    const col = [[0.34, 0.2, 0.14], [0.2, 0.26, 0.2], [0.3, 0.12, 0.12], [0.26, 0.22, 0.32]][h % 4];
    for (let p = 0; p < 4; p++) obox(M.wood, f, -0.5 + p * 0.25 + 0.01, -0.5 + (p + 1) * 0.25 - 0.01, 0.0, hh, 0.0, 0.06, [col[0] * (0.9 + 0.1 * (p % 2)), col[1], col[2]], { bottom: false });
    for (const y of [0.4, 1.6]) obox(M.metal, f, -0.5, 0.5, y, y + 0.1, 0.06, 0.08, C.ironD, { bottom: false });
    obox(M.stone, f, -0.7, 0.7, 0, 0.1, 0.1, 0.32, [0.62, 0.6, 0.56], { bottom: false });
    disc(M.metal, f, 0.35, 1.0, 0.085, 0.04, 6, C.brass);
  }

  function windowShutter(f, h) {
    const { M, obox, C } = k;
    obox(M.stone, f, -0.4, 0.4, 1.35, 1.45, 0, 0.14, [0.68, 0.66, 0.62], { bottom: false });
    obox(M.stone, f, -0.4, 0.4, 2.15, 2.25, 0, 0.14, [0.68, 0.66, 0.62], { bottom: false });
    for (const s of [-1, 1]) obox(M.stone, f, s * 0.4 - 0.05, s * 0.4 + 0.05, 1.35, 2.25, 0, 0.12, [0.66, 0.64, 0.6], { bottom: false });
    k.M.glow.quad(f.p(-0.35, 1.45, 0.03), f.p(0.35, 1.45, 0.03), f.p(0.35, 2.15, 0.03), f.p(-0.35, 2.15, 0.03), k.glowc(0xff9a40, 1.6 + (h % 3) * 0.3), f.n);
    obox(k.M.props, f, -0.35, 0.35, 1.78, 1.82, 0.035, 0.05, [0.05, 0.04, 0.04], { bottom: false }); // glazing bar
    obox(k.M.props, f, -0.02, 0.02, 1.45, 2.15, 0.035, 0.05, [0.05, 0.04, 0.04], { bottom: false });
    void C;
  }

  function sign(f, h) {
    const { M, obox, C } = k;
    obox(M.metal, f, -0.04, 0.04, 2.45, 2.55, 0, 0.9, C.iron, { bottom: false });
    M.metal.tube(f.p(0.0, 2.5, 0.0), f.p(0.0, 2.1, 0.9), 0.015, C.iron, 4);
    const col = [[0.5, 0.12, 0.1], [0.12, 0.28, 0.2], [0.6, 0.5, 0.15]][h % 3];
    for (const s of [-1, 1]) M.hang.tube(f.p(s * 0.3, 2.1, 0.9), f.p(s * 0.3, 2.5, 0.9), 0.008, C.ironD, 3);
    obox(M.props, f, -0.42, 0.42, 1.78, 2.1, 0.85, 0.9, col, { bottom: false });
    obox(M.props, f, -0.3, 0.3, 1.9, 1.98, 0.9, 0.91, [0.9, 0.8, 0.5], { bottom: false });
  }

  function banner(f, h) {
    const { M, obox, disc, C } = k;
    obox(M.props, f, -0.7, 0.7, 1.2, 3.05, 0, 0.03, h % 2 ? [0.38, 0.05, 0.07] : [0.1, 0.12, 0.2], { bottom: false });
    obox(M.metal, f, -0.75, 0.75, 3.02, 3.09, 0, 0.07, C.brass, { bottom: false });
    obox(M.props, f, -0.5, 0.5, 1.9, 2.0, 0, 0.04, [0.8, 0.65, 0.2], { bottom: false });
    disc(M.props, f, 0, 2.5, 0.035, 0.22, 10, [0.85, 0.85, 0.8]); // a ghost, again
    for (const s of [-1, 1]) disc(M.props, f, s * 0.08, 2.55, 0.04, 0.035, 5, [0.05, 0.05, 0.06]);
    for (const s of [-0.5, -0.17, 0.17, 0.5]) obox(M.props, f, s - 0.05, s + 0.05, 1.05, 1.2, 0, 0.03, [0.8, 0.65, 0.2], { bottom: false });
  }

  function chains(f) {
    const { M, C } = k;
    for (const u of [-0.45, 0.45]) {
      let prev = f.p(u, 2.9, 0.06);
      for (let n = 1; n <= 8; n++) {
        const q = f.p(u + (n % 2 ? 0.02 : -0.02), 2.9 - n * 0.2, 0.06 + n * 0.012);
        M.hang.tube(prev, q, 0.012, C.ironD, 4);
        prev = q;
      }
      M.metal.frustum(prev[0], prev[2], 0.07, 0.07, prev[1] - 0.04, prev[1] + 0.02, 8, C.iron, false); // a manacle
    }
    k.obox(M.metal, f, -0.6, 0.6, 2.88, 2.95, 0, 0.1, C.iron, { bottom: false });
  }

  // ---- props, one tile at a time ----
  function barrel(cx, cz, h, big = 1) {
    const { M } = k;
    const wood = [[0.42, 0.29, 0.18], [0.36, 0.25, 0.16], [0.46, 0.33, 0.2]][h % 3];
    const seg = Q.detail ? 12 : 8;
    const r = 0.46 * big;
    M.wood.frustum(cx, cz, r * 0.86, r, 0, 0.3 * big, seg, wood, false);
    M.wood.frustum(cx, cz, r, r, 0.3 * big, 0.7 * big, seg, wood, false);
    M.wood.frustum(cx, cz, r, r * 0.86, 0.7 * big, 1.0 * big, seg, wood, true);
    for (const [y, rr] of [[0.1, 0.89], [0.36, 1.0], [0.64, 1.0], [0.9, 0.89]]) M.metal.frustum(cx, cz, r * rr + 0.012, r * rr + 0.012, y * big, (y + 0.05) * big, seg, k.C.ironD, false);
    M.props.frustum(cx, cz, r * 0.2, r * 0.2, 1.0 * big, 1.02 * big, 6, [0.1, 0.07, 0.05]);
  }

  function prop(ch, c, r, kind) {
    const { M, bb, obox, frame, annulus, disc, C } = k;
    const cx = (c + 0.5) * T;
    const cz = (r + 0.5) * T;
    const h = hash(c, r, 17);
    if (ch === 'P') {
      const seg = Q.detail ? 12 : 8;
      M.stone.frustum(cx, cz, 0.56, 0.5, 0.3, WALL_H - 0.3, seg, [0.78, 0.76, 0.72], false);
      bb(M.stone, cx - 0.78, 0, cz - 0.78, cx + 0.78, 0.34, cz + 0.78, [0.72, 0.7, 0.66], 0.05, true);
      bb(M.stone, cx - 0.68, 0.34, cz - 0.68, cx + 0.68, 0.46, cz + 0.68, [0.7, 0.68, 0.64], 0.03);
      bb(M.stone, cx - 0.8, WALL_H - 0.5, cz - 0.8, cx + 0.8, WALL_H, cz + 0.8, [0.72, 0.7, 0.66], 0.05);
      bb(M.stone, cx - 0.66, WALL_H - 0.62, cz - 0.66, cx + 0.66, WALL_H - 0.5, cz + 0.66, [0.7, 0.68, 0.64], 0.03);
    } else if (ch === 'S') {
      // a stack of casks: four standing, one lying across the top
      for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) barrel(cx + dx, cz + dz, h + dx * 3 + dz * 5, 1.0);
      for (const dx of [-0.5, 0.5]) {
        const hex = [0.4, 0.28, 0.18];
        M.wood.pipe('z', cz - 0.9, cz + 0.9, 1.45, cx + dx, 0.45, 10, hex);
        for (const zz of [-0.55, 0.55]) M.metal.pipe('z', cz + zz - 0.03, cz + zz + 0.03, 1.45, cx + dx, 0.47, 10, C.ironD);
      }
      bb(M.wood, cx - 0.98, 1.0, cz - 0.98, cx + 0.98, 1.06, cz + 0.98, WOOD_D, 0.02);
      bb(M.wood, cx - 0.92, 1.88, cz - 0.92, cx + 0.92, 1.94, cz + 0.92, WOOD_D, 0.02);
    } else if (ch === 'o') {
      barrel(cx, cz, h);
      if (h % 5 === 0) M.glass.frustum(cx + 0.7, cz + 0.65, 0.34, 0.34, 0, 0.025, 10, [0.02, 0.025, 0.03]); // a spill
    } else if (ch === 'x') {
      const hh = 0.8 + (h % 3) * 0.05;
      bb(M.wood, cx - 0.8, 0, cz - 0.55, cx + 0.8, hh, cz + 0.55, WOOD, 0.04, true);
      bb(M.wood, cx - 0.82, hh, cz - 0.57, cx + 0.82, hh + 0.2, cz + 0.57, [0.38, 0.27, 0.18], 0.06);
      for (const sx of [-0.55, 0.55]) bb(M.metal, cx + sx - 0.06, 0, cz - 0.6, cx + sx + 0.06, hh + 0.2, cz + 0.6, C.ironD, 0.01, true);
      M.metal.box(cx - 0.08, hh * 0.55, cz + 0.55, cx + 0.08, hh * 0.55 + 0.16, cz + 0.6, C.brass);
    } else if (ch === 'c') {
      const tour = areaOfTile(c, r) === areas.length - 1;
      bb(M.stone, cx - 0.62, 0, cz - 0.95, cx + 0.62, 0.62, cz + 0.95, tour ? [0.62, 0.58, 0.56] : STONE, 0.05, true);
      bb(M.stone, cx - 0.7, 0.62, cz - 1.0, cx + 0.7, 0.8, cz + 1.0, tour ? [0.7, 0.64, 0.62] : [0.78, 0.76, 0.72], 0.05);
      obox(M.stone, frame(cx, cz - 0.0, 0, 1), -0.07, 0.07, 0.8, 0.84, -0.7, 0.6, [0.5, 0.48, 0.46], { bottom: false }); // carved cross
      obox(M.stone, frame(cx, cz, 0, 1), -0.3, 0.3, 0.8, 0.84, 0.3, 0.38, [0.5, 0.48, 0.46], { bottom: false });
      if (tour) M.props.box(cx - 0.5, 0.8, cz - 0.1, cx + 0.5, 0.84, cz + 0.5, [0.35, 0.05, 0.08]); // velvet runner
    } else if (ch === 'n') {
      const dir = h % 2; // cart faces x or z
      const ax = dir ? 1 : 0;
      const az = dir ? 0 : 1;
      bb(M.wood, cx - (ax ? 0.9 : 0.55), 0.55, cz - (az ? 0.9 : 0.55), cx + (ax ? 0.9 : 0.55), 0.7, cz + (az ? 0.9 : 0.55), WOOD, 0.02);
      for (const s of [-1, 1]) {
        const g = frame(cx + (az ? s * 0.6 : 0), cz + (ax ? s * 0.6 : 0), az ? s : 0, ax ? s : 0);
        annulus(M.wood, g, 0, 0.42, 0.02, 0.28, 0.42, 12, WOOD_D);
        annulus(M.metal, g, 0, 0.42, 0.04, 0.4, 0.44, 12, C.ironD);
        disc(M.metal, g, 0, 0.42, 0.04, 0.06, 6, C.iron);
        for (let sp = 0; sp < 4; sp++) {
          const a = (sp / 4) * Math.PI;
          k.ribbon(M.wood, g, -Math.cos(a) * 0.3, 0.42 - Math.sin(a) * 0.3, Math.cos(a) * 0.3, 0.42 + Math.sin(a) * 0.3, 0.04, 0.03, WOOD_D);
        }
      }
      // sides and two handles
      for (const s of [-1, 1]) M.wood.box(cx + (az ? s * 0.55 : -0.9) - (az ? 0.03 : 0), 0.7, cz + (ax ? s * 0.55 : -0.9) - (ax ? 0.03 : 0), cx + (az ? s * 0.55 : 0.9) + (az ? 0.03 : 0), 0.95, cz + (ax ? s * 0.55 : 0.9) + (ax ? 0.03 : 0), WOOD_D);
      const hx = ax ? 1.5 : 0;
      const hz = az ? 1.5 : 0;
      for (const s of [-1, 1]) M.wood.tube([cx + (ax ? 0.9 : s * 0.3), 0.62, cz + (az ? 0.9 : s * 0.3)], [cx + hx, 0.5, cz + hz + (ax ? s * 0.3 : 0)], 0.03, WOOD_D, 4);
      if (h % 3 === 0) bb(M.props, cx - 0.3, 0.7, cz - 0.3, cx + 0.3, 1.05, cz + 0.3, [0.45, 0.4, 0.3], 0.04); // a sack
    } else if (ch === 'T') {
      stairs(c, r);
    }
    void kind;
  }

  const doneStairs = { done: false };
  function stairs(c, r) {
    if (doneStairs.done) return;
    doneStairs.done = true;
    const { M, bb, frame, obox, C } = k;
    let c1 = c;
    let r1 = r;
    while (k.sub[r * lv.cols + c1 + 1] === 'T') c1++;
    while (k.sub[(r1 + 1) * lv.cols + c] === 'T') r1++;
    const x0 = c * T;
    const x1 = (c1 + 1) * T;
    const z1 = (r1 + 1) * T;
    const zTop = r * T + 1.2;
    const n = 6;
    for (let s = 0; s < n; s++) {
      const za = z1 - ((s + 1) * (z1 - zTop)) / n;
      bb(M.stone, x0, 0, za, x1, (s + 1) * 0.3, z1, [0.76, 0.74, 0.7], 0.03, true);
    }
    bb(M.stone, x0, 0, r * T, x1, n * 0.3, zTop, [0.74, 0.72, 0.68], 0.03, true);
    M.metal.tube([x1 - 0.1, 0.95, z1 - 0.1], [x1 - 0.1, n * 0.3 + 0.95, zTop], 0.035, C.iron, 6);
    // the street door at the top: cold light spilling down the steps
    const f = frame((x0 + x1) / 2, r * T, 0, 1);
    M.glow.grid(f.p(-1.3, n * 0.3, 0.02), f.p(1.3, n * 0.3, 0.02), f.p(-1.3, n * 0.3 + 1.9, 0.02), [0, 1], [0, 1], k.glowc(0x8aa8e0, 2.0), f.n);
    obox(M.stone, f, -1.5, -1.3, n * 0.3, n * 0.3 + 2.0, 0, 0.12, [0.7, 0.68, 0.64], { bottom: false });
    obox(M.stone, f, 1.3, 1.5, n * 0.3, n * 0.3 + 2.0, 0, 0.12, [0.7, 0.68, 0.64], { bottom: false });
    obox(M.stone, f, -1.5, 1.5, n * 0.3 + 1.9, n * 0.3 + 2.05, 0, 0.12, [0.7, 0.68, 0.64], { bottom: false });
  }

  // a stone arch between two points on the ceiling: a spandrel panel on both faces plus the underside of the ring
  function arch(axis, fixed, a0, a1, spring) {
    const { M } = k;
    const N = Q.fine ? 14 : 8;
    const half = (a1 - a0) / 2;
    const mid = (a0 + a1) / 2;
    const rise = WALL_H - spring;
    const P = (a, y, d) => (axis === 'z' ? [fixed + d, y, a] : [a, y, fixed + d]);
    const col = [0.62, 0.6, 0.57];
    for (let n = 0; n < N; n++) {
      const ua = -half + (2 * half * n) / N;
      const ub = -half + (2 * half * (n + 1)) / N;
      const ya = spring + rise * Math.sqrt(Math.max(0, 1 - (ua / half) ** 2));
      const yb = spring + rise * Math.sqrt(Math.max(0, 1 - (ub / half) ** 2));
      const ha = ya - 0.0;
      void ha;
      for (const [d, nrm] of [[0.28, axis === 'z' ? [1, 0, 0] : [0, 0, 1]], [-0.28, axis === 'z' ? [-1, 0, 0] : [0, 0, -1]]]) {
        M.stone.quad(P(mid + ua, ya + 0.0, d), P(mid + ub, yb, d), P(mid + ub, WALL_H, d), P(mid + ua, WALL_H, d), col, nrm);
      }
      M.stone.quad(P(mid + ua, ya, -0.28), P(mid + ub, yb, -0.28), P(mid + ub, yb, 0.28), P(mid + ua, ya, 0.28), [0.55, 0.53, 0.5], [0, -1, 0]);
    }
  }

  // ---- everything else ----
  function brazier(x, z) {
    const { M, C } = k;
    const y = 2.3;
    const top = WALL_H;
    for (const a of [0, Math.PI * 0.67, Math.PI * 1.33]) {
      const px = x + Math.cos(a) * 0.3;
      const pz = z + Math.sin(a) * 0.3;
      M.hang.tube([x, top, z], [px, y + 0.15, pz], 0.012, C.ironD, 4);
    }
    M.metal.frustum(x, z, 0.14, 0.34, y - 0.12, y + 0.18, 10, C.iron, true);
    M.metal.frustum(x, z, 0.35, 0.35, y + 0.15, y + 0.2, 10, C.ironD, false);
    M.props.frustum(x, z, 0.3, 0.3, y + 0.17, y + 0.2, 8, [0.06, 0.03, 0.02]);
    flame(x, y + 0.2, z, 2.2);
    flame(x + 0.12, y + 0.2, z - 0.1, 1.5);
  }

  function dress() {
    const { M, C, frame, obox, patch, glowc } = k;
    // arched ribs
    for (const [axis, fixed, a0, a1, spring] of VAULT_RIBS) arch(axis, fixed * T, a0 * T, a1 * T, spring);
    // timber beams over the close
    for (const c of BEAMS) {
      const x = (c + 0.5) * T;
      k.bb(M.wood, x - 0.17, WALL_H - 0.4, 28 * T, x + 0.17, WALL_H, 33 * T, [0.36, 0.25, 0.16], 0.035);
    }
    // wall features
    for (const fc of k.faces) {
      const what = k.planMap.get(fc);
      if (!what) continue;
      const f = fc.f;
      const i = (fc.c * 31 + fc.r * 17) | 0;
      if (what === 'torch') torch(f, i);
      else if (what === 'niche') niche(f, fc.h % 3 === 0 ? 'bottles' : fc.h % 3 === 1 ? 'candle' : 'none', fc.h);
      else if (what === 'skulls') skulls(f, fc.h);
      else if (what === 'cobweb') cobweb(f);
      else if (what === 'poster') poster(f, fc.h, fc.id === 'tour');
      else if (what === 'rack') rack(f, fc.h);
      else if (what === 'doorway') doorway(f, fc.h);
      else if (what === 'window') windowShutter(f, fc.h);
      else if (what === 'sign') sign(f, fc.h);
      else if (what === 'banner') banner(f, fc.h);
      else if (what === 'chains') chains(f);
    }
    // braziers and lanterns
    BRAZIERS.forEach(([, ps]) => ps.forEach(([c, r]) => brazier(c * T, r * T)));
    for (const [c, r] of LANTERNS) {
      const x = c * T;
      const z = r * T;
      for (let y = WALL_H; y > 2.75; y -= 0.1) M.hang.box(x - 0.008, y - 0.08, z - 0.008, x + 0.008, y, z + 0.008, C.ironD);
      M.metal.frustum(x, z, 0.14, 0.14, 2.45, 2.75, 6, C.ironD, true);
      M.glass.frustum(x, z, 0.12, 0.12, 2.5, 2.7, 6, [0.5, 0.45, 0.3]);
      flame(x, 2.5, z, 0.9);
    }
    // puddles on the flags
    for (const [c, r, rad] of PUDDLES) patch(M.glass, c * T, 0.016, r * T, rad * 0.9, 11, [0.02, 0.03, 0.04], c * 7 + r);
    // exit: a cold glow floor ring where the way out is, and a lit arch over the alcove
    const ex = k.exit;
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2;
      const a1 = ((i + 1) / 24) * Math.PI * 2;
      M.glow.quad([ex.x + Math.cos(a0) * 1.15, 0.03, ex.z + Math.sin(a0) * 1.15], [ex.x + Math.cos(a0) * 1.35, 0.03, ex.z + Math.sin(a0) * 1.35],
        [ex.x + Math.cos(a1) * 1.35, 0.03, ex.z + Math.sin(a1) * 1.35], [ex.x + Math.cos(a1) * 1.15, 0.03, ex.z + Math.sin(a1) * 1.15], glowc(0x8ab8ff, 1.8), [0, 1, 0]);
    }
    const fe = frame(2.02, 11, 1, 0);
    M.glow.grid(fe.p(-1.0, 0, 0.0), fe.p(1.0, 0, 0.0), fe.p(-1.0, 2.6, 0.0), [0, 1], [0, 0.5, 1], (i, j) => glowc(0xb8d0f0, 1.0 + 1.2 * j * 0.5), fe.n);
    obox(M.glow, fe, -0.5, 0.5, 2.9, 3.15, 0, 0.02, glowc(0x8ab8ff, 3.2), { bottom: false });
    const bits = (frame2) => frame2; // keeps the helper list explicit for readers
    void bits;
  }

  // ---- materials, lights, animation ----
  function flameTexture() {
    const W = 32;
    const H = 64;
    const data = new Uint8Array(W * H * 4);
    for (let j = 0; j < H; j++) {
      const v = j / (H - 1); // 0 at the base, 1 at the tip
      const width = 0.46 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + v * 0.88)), 0.75) * (1 - 0.4 * v);
      for (let i = 0; i < W; i++) {
        const u = Math.abs(i / (W - 1) - 0.5);
        const e = Math.max(0, 1 - u / Math.max(width, 0.001));
        const a = Math.pow(e, 0.9) * Math.pow(1 - v, 0.55);
        const core = Math.pow(e, 2.2) * (1 - v * 0.8); // white-yellow in the middle, orange at the edges
        const o = (j * W + i) * 4;
        data[o] = 255;
        data[o + 1] = Math.round(90 + 150 * core);
        data[o + 2] = Math.round(10 + 150 * core * core);
        data[o + 3] = Math.round(255 * Math.min(1, a));
      }
    }
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  function buildFlames(group) {
    const n = FL.length;
    if (!n) return;
    const QN = 3; // crossed quads per flame
    const pos = new Float32Array(n * QN * 12);
    const uv = new Float32Array(n * QN * 8);
    const col = new Float32Array(n * QN * 12);
    const idx = new Uint16Array(n * QN * 6);
    for (let q = 0; q < n * QN; q++) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], q * 8);
      idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
      for (let v = 0; v < 4; v++) col.set([2.6, 1.25, 0.45], q * 12 + v * 3); // HDR orange, so it blooms
    }
    const g = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pa);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(lv.cols * T / 2, 2, lv.rows * T / 2), 120);
    const mat = new THREE.MeshBasicMaterial({ map: flameTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    group.add(mesh);
    flames = { mesh, mat, pos: pa };
  }

  function updateFlames(t) {
    if (!flames) return;
    const a = flames.pos.array;
    let o = 0;
    for (let i = 0; i < FL.length; i++) {
      const f = FL[i];
      const flick = 0.5 + 0.5 * Math.sin(t * 11 + f.ph * 3) * Math.sin(t * 6.3 + f.ph);
      const h = 0.7 * f.s * (0.82 + 0.3 * flick);
      const w = 0.17 * f.s * (0.9 + 0.2 * (1 - flick));
      const swx = Math.sin(t * 7.1 + f.ph) * 0.07 * f.s;
      const swz = Math.cos(t * 5.3 + f.ph * 2) * 0.05 * f.s;
      for (let q = 0; q < 3; q++) {
        const ang = (q * Math.PI) / 3;
        const dx = Math.cos(ang) * w;
        const dz = Math.sin(ang) * w;
        const tx = f.x + swx;
        const tz = f.z + swz;
        a[o] = f.x - dx; a[o + 1] = f.y; a[o + 2] = f.z - dz;
        a[o + 3] = f.x + dx; a[o + 4] = f.y; a[o + 5] = f.z + dz;
        a[o + 6] = tx + dx * 0.3; a[o + 7] = f.y + h; a[o + 8] = tz + dz * 0.3;
        a[o + 9] = tx - dx * 0.3; a[o + 10] = f.y + h; a[o + 11] = tz - dz * 0.3;
        o += 12;
      }
    }
    flames.pos.needsUpdate = true;
  }

  function finish({ group }) {
    buildFlames(group);
    updateFlames(0);
    const mk = (hex, power, range, x, y, z, kind) => {
      const light = new THREE.PointLight(hex, power, range, 2);
      light.position.set(x * T, y, z * T);
      group.add(light);
      lamps.push({ light, base: power, kind });
    };
    mk(0xff8a3a, 12, 15, 36.5, 2.2, 40, 'fire');
    mk(0xffa860, 11, 15, 22.5, 2.4, 30.5, 'lamp');
    mk(0xffa050, 14, 22, 17, 2.4, 20, 'fire');
    mk(0xff7a40, 20, 22, 19, 2.4, 6.5, 'fire');
  }

  function animate(t) {
    updateFlames(t);
    const fa = 0.82 + 0.18 * Math.sin(t * 13.1) * Math.sin(t * 7.7) + 0.06 * Math.sin(t * 31.0);
    const fb = 0.82 + 0.18 * Math.sin(t * 11.3 + 1.7) * Math.sin(t * 8.9) + 0.06 * Math.sin(t * 27.0);
    lamps.forEach((l, i) => {
      const f = (i % 2 ? fa : fb);
      l.light.intensity = l.base * (l.kind === 'lamp' ? 0.92 + 0.08 * f : 0.78 + 0.28 * f);
    });
  }

  return {
    plan(fc) {
      const w = plan(fc);
      return w;
    },
    lights(emit, faces, planMap) {
      this.planMap = planMap;
      lights(emit, faces, planMap);
    },
    wallVariant,
    init(kit) {
      init({ ...kit, planMap: this.planMap, exit: env.exit });
    },
    ceilingTile,
    prop,
    dress,
    finish,
    animate,
  };
}
