// Level geometry, collision, pathing and lighting for the first-person game, built from a level definition
// (src/levels/*.js: map, areas, styles, atmosphere). Level 1 (the Cowgate) keeps its dressing in this file; later levels
// bring a decor object (src/levels/*-decor.js) that fills the same slots.
// Everything is procedural and DOM-free, so it also runs under plain Node for headless tests.
// Build order: parse the ASCII map -> queries -> baked-light emitters -> merged geometry -> doors and lights.
import * as THREE from '../vendor/three.module.min.js';
import { TILE, WALL_H, COLOURS } from './consts.js';
import { LEVEL_DEF as COWGATE } from './levels/cowgate.js';
import { LEVEL_DEF as VAULTS } from './levels/vaults.js';
import { makeVaultsDecor } from './levels/vaults-decor.js';
import { PROP_MESHES } from './prop-meshes.js';

const T = TILE;
const makeDecor = (lv, env) => (lv.id === 'vaults' ? makeVaultsDecor(lv, env) : null);
export const LEVEL_DEFS = { 1: COWGATE, 2: VAULTS };


// ---- tile kinds ----
const FLOOR = 0;
const WALL = 1;
const PILLAR = 2;
const SPEAKER = 3;
const STAIRS = 4;
const COVER = 5;
const DOOR = 6;
const SOLID_CHARS = { '#': WALL, P: PILLAR, S: SPEAKER, T: STAIRS };
const COVER_CHARS = 'bjvxro';
const DOOR_OPEN_AT = 0.85; // a door stops being solid once it is this far open
const DOOR_TIME = 0.6;
const DOOR_THICK = 0.5;
const hash = (i, j, n = 0) => ((i * 73856093) ^ (j * 19349663) ^ (n * 83492791)) >>> 0;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const jit = (h, amp) => 1 + (((h >>> 3) % 1000) / 1000 - 0.5) * 2 * amp;


// ---- parse the map ----
function parseMap(lv) {
  const { cols: COLS, rows: ROWS, map: MAP } = lv;
  const solidChars = lv.solid || SOLID_CHARS;
  const coverChars = lv.cover || COVER_CHARS;
  const kind = new Uint8Array(COLS * ROWS);
  const sub = new Array(COLS * ROWS).fill('');
  const doorTiles = {}; // digit -> [[c, r], ...]
  const marks = []; // { ch, c, r }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = MAP[r][c];
      const i = r * COLS + c;
      sub[i] = ch;
      if (solidChars[ch] !== undefined) kind[i] = solidChars[ch];
      else if (coverChars.includes(ch)) kind[i] = COVER;
      else if (ch >= '1' && ch <= String(lv.doorCount)) {
        kind[i] = DOOR;
        (doorTiles[ch] = doorTiles[ch] || []).push([c, r]);
      } else if (ch !== '.') marks.push({ ch, c, r });
    }
  }
  return { kind, sub, doorTiles, marks };
}

const tileCentre = (c, r) => [(c + 0.5) * T, (r + 0.5) * T];

// opts.quality: 'high' (default), 'medium' or 'low'. Texture size, normal and roughness maps, subdivision and effects scale with it.
// opts.level: 1 (the Cowgate, default) or 2 (the Vaults).
export function buildWorld(opts = {}) {
  const quality = opts && QUALITY[opts.quality] ? opts.quality : 'high';
  const lv = (opts && LEVEL_DEFS[opts.level]) || COWGATE;
  const { cols: COLS, rows: ROWS } = lv;
  const { kind, sub, doorTiles, marks } = parseMap(lv);
  const at = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS ? WALL : kind[r * COLS + c]);

  // ---- areas ----
  const areas = lv.areas.map((d) => ({ id: d.id, name: d.name, objective: d.objective, rect: { ...d.rect }, spawns: [], unlocks: [...d.unlocks] }));
  const areaIdx = new Int8Array(COLS * ROWS).fill(-1);
  areas.forEach((a, n) => {
    for (let r = a.rect.r0; r <= a.rect.r1; r++) for (let c = a.rect.c0; c <= a.rect.c1; c++) if (areaIdx[r * COLS + c] < 0) areaIdx[r * COLS + c] = n;
  });
  const areaOfTile = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS ? -1 : areaIdx[r * COLS + c]);

  // ---- doors ----
  const doors = [];
  const doorState = []; // internal: { t, target, tiles, axis, w }
  const doorAtTile = new Int8Array(COLS * ROWS).fill(-1);
  for (let n = 1; n <= lv.doorCount; n++) {
    const tiles = doorTiles[String(n)];
    const [c0, r0] = tiles[0];
    const [c1, r1] = tiles[1];
    const axis = r0 === r1 ? 'x' : 'z';
    const x = ((c0 + c1) / 2 + 0.5) * T;
    const z = ((r0 + r1) / 2 + 0.5) * T;
    const open = n === 1;
    const idx = doors.length;
    doors.push({ id: `d${n}`, x, z, axis, open });
    doorState.push({ t: open ? 1 : 0, tiles, axis });
    tiles.forEach(([c, r]) => { doorAtTile[r * COLS + c] = idx; });
  }
  const doorIndex = (id) => doors.findIndex((d) => d.id === id);

  // ---- spawns, pickups, start, exit ----
  const entryOf = lv.entryDoor.map((id) => (id ? doors.find((d) => d.id === id) : null));
  const pickups = [];
  const counts = {};
  let start = { x: 0, z: 0, yaw: lv.startYaw };
  const exitTiles = [];
  const KIND_OF = lv.kinds;
  const PICK_OF = lv.picks;
  for (const m of marks) {
    const [x, z] = tileCentre(m.c, m.r);
    const an = areaOfTile(m.c, m.r);
    if (m.ch === '@') start = { x, z, yaw: lv.startYaw };
    else if (m.ch === 'E') exitTiles.push([x, z]);
    else if (KIND_OF[m.ch]) {
      const e = entryOf[an];
      const yaw = e ? Math.atan2(-(e.x - x), -(e.z - z)) : 0;
      areas[an].spawns.push({ kind: KIND_OF[m.ch], x, z, yaw });
    } else if (PICK_OF[m.ch]) {
      const [k, item] = PICK_OF[m.ch];
      counts[item] = (counts[item] || 0) + 1;
      pickups.push({ id: `${item}-${counts[item]}`, kind: k, item, x, z });
    }
  }
  const exit = {
    x: exitTiles.reduce((s, p) => s + p[0], 0) / exitTiles.length,
    z: exitTiles.reduce((s, p) => s + p[1], 0) / exitTiles.length,
    r: lv.exitR,
  };

  // ---- tile queries ----
  const doorSolid = (i) => doorState[i].t < DOOR_OPEN_AT;
  const blocksMove = (c, r) => {
    const k = at(c, r);
    return k === FLOOR ? false : k === DOOR ? doorSolid(doorAtTile[r * COLS + c]) : true;
  };
  const blocksShot = (c, r) => {
    const k = at(c, r);
    return k === WALL || k === PILLAR || k === SPEAKER || k === STAIRS || (k === DOOR && doorSolid(doorAtTile[r * COLS + c]));
  };
  const areaAt = (x, z) => {
    const n = areaOfTile(Math.floor(x / T), Math.floor(z / T));
    return n < 0 ? null : areas[n];
  };
  const isSolidAt = (x, z) => blocksMove(Math.floor(x / T), Math.floor(z / T));

  // Push a circle out of every solid tile it overlaps (closest point on the tile box).
  function pushOut(p, rad) {
    let moved = false;
    for (let pass = 0; pass < 4; pass++) {
      let any = false;
      const c0 = Math.floor((p.x - rad) / T);
      const c1 = Math.floor((p.x + rad) / T);
      const r0 = Math.floor((p.z - rad) / T);
      const r1 = Math.floor((p.z + rad) / T);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (!blocksMove(c, r)) continue;
          const x0 = c * T;
          const z0 = r * T;
          const dx = p.x - clamp(p.x, x0, x0 + T);
          const dz = p.z - clamp(p.z, z0, z0 + T);
          const d2 = dx * dx + dz * dz;
          if (d2 >= rad * rad) continue;
          if (d2 > 1e-10) {
            const k = (rad - Math.sqrt(d2)) / Math.sqrt(d2);
            p.x += dx * k;
            p.z += dz * k;
          } else {
            // centre inside the tile (only if something closed on us): leave by the nearest face
            const l = p.x - x0;
            const rt = x0 + T - p.x;
            const u = p.z - z0;
            const dn = z0 + T - p.z;
            const m = Math.min(l, rt, u, dn);
            if (m === l) p.x = x0 - rad;
            else if (m === rt) p.x = x0 + T + rad;
            else if (m === u) p.z = z0 - rad;
            else p.z = z0 + T + rad;
          }
          any = true;
          moved = true;
        }
      }
      if (!any) break;
    }
    return moved;
  }
  function overlaps(p, rad) {
    const e = rad - 1e-6;
    for (let r = Math.floor((p.z - rad) / T); r <= Math.floor((p.z + rad) / T); r++) {
      for (let c = Math.floor((p.x - rad) / T); c <= Math.floor((p.x + rad) / T); c++) {
        if (!blocksMove(c, r)) continue;
        const dx = p.x - clamp(p.x, c * T, c * T + T);
        const dz = p.z - clamp(p.z, r * T, r * T + T);
        if (dx * dx + dz * dz < e * e) return true;
      }
    }
    return false;
  }

  // Small sub-steps (well under the radius) so nothing tunnels and corners resolve cleanly.
  function moveCircle(x, z, dx, dz, rad) {
    const dist = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(dist / 0.2));
    const sx = dx / n;
    const sz = dz / n;
    const p = { x, z };
    let hit = false;
    for (let i = 0; i < n; i++) {
      const px = p.x;
      const pz = p.z;
      p.x += sx;
      p.z += sz;
      if (pushOut(p, rad)) {
        hit = true;
        if (overlaps(p, rad)) { p.x = px; p.z = pz; }
      }
    }
    return { x: p.x, z: p.z, hit };
  }

  // Grid walk. Closed doors are thin slabs in the middle of their tile, so bullets stop at the slab.
  function raycast(ox, oz, dx, dz, maxDist) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-12) return maxDist;
    const ux = dx / len;
    const uz = dz / len;
    let c = Math.floor(ox / T);
    let r = Math.floor(oz / T);
    const sc = ux > 0 ? 1 : -1;
    const sr = uz > 0 ? 1 : -1;
    let tx = ux === 0 ? Infinity : ((ux > 0 ? c + 1 : c) * T - ox) / ux;
    let tz = uz === 0 ? Infinity : ((uz > 0 ? r + 1 : r) * T - oz) / uz;
    const dtx = ux === 0 ? Infinity : T / Math.abs(ux);
    const dtz = uz === 0 ? Infinity : T / Math.abs(uz);
    let t0 = 0;
    for (let guard = 0; guard < 400; guard++) {
      const tNext = Math.min(tx, tz, maxDist);
      if (blocksShot(c, r)) {
        if (at(c, r) !== DOOR) return Math.min(t0, maxDist);
        const d = doors[doorAtTile[r * COLS + c]];
        const along = d.axis === 'x' ? uz : ux; // component across the slab
        const o = d.axis === 'x' ? oz : ox;
        const mid = d.axis === 'x' ? d.z : d.x;
        const lo = mid - DOOR_THICK / 2;
        const hi = mid + DOOR_THICK / 2;
        let a = t0;
        let b = tNext;
        if (Math.abs(along) < 1e-9) {
          if (o < lo || o > hi) a = Infinity;
        } else {
          const ta = (lo - o) / along;
          const tb = (hi - o) / along;
          a = Math.max(a, Math.min(ta, tb));
          b = Math.min(b, Math.max(ta, tb));
        }
        if (a <= b) return Math.min(a, maxDist);
      }
      if (tNext >= maxDist) return maxDist;
      t0 = tNext;
      if (tx < tz) { c += sc; tx += dtx; } else { r += sr; tz += dtz; }
    }
    return maxDist;
  }
  function los(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    if (d < 1e-9) return !blocksShot(Math.floor(ax / T), Math.floor(az / T));
    return raycast(ax, az, bx - ax, bz - az, d) >= d - 1e-6;
  }

  // ---- flow field: Dijkstra over 8-connected tiles from the target ----
  function createFlowField() {
    const dist = new Float64Array(COLS * ROWS).fill(Infinity);
    const heapK = [];
    const heapV = [];
    const push = (k, v) => {
      let i = heapK.length;
      heapK.push(k);
      heapV.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapK[p] <= k) break;
        heapK[i] = heapK[p]; heapV[i] = heapV[p]; i = p;
      }
      heapK[i] = k; heapV[i] = v;
    };
    const pop = () => {
      const v = heapV[0];
      const k = heapK.pop();
      const lv = heapV.pop();
      const n = heapK.length;
      if (n > 0) {
        let i = 0;
        for (;;) {
          let ch = 2 * i + 1;
          if (ch >= n) break;
          if (ch + 1 < n && heapK[ch + 1] < heapK[ch]) ch++;
          if (heapK[ch] >= k) break;
          heapK[i] = heapK[ch]; heapV[i] = heapV[ch]; i = ch;
        }
        heapK[i] = k; heapV[i] = lv;
      }
      return v;
    };
    const walk = new Uint8Array(COLS * ROWS);
    const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const D = Math.SQRT2 * T;
    const ok = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS && walk[r * COLS + c] === 1;
    return {
      update(x, z) {
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) walk[r * COLS + c] = blocksMove(c, r) ? 0 : 1;
        dist.fill(Infinity);
        heapK.length = 0;
        heapV.length = 0;
        const sc = Math.floor(x / T);
        const sr = Math.floor(z / T);
        if (!ok(sc, sr)) return;
        dist[sr * COLS + sc] = 0;
        push(0, sr * COLS + sc);
        while (heapK.length) {
          const k = heapK[0];
          const i = pop();
          if (k > dist[i]) continue;
          const c = i % COLS;
          const r = (i / COLS) | 0;
          for (const [dc, dr] of NB) {
            const nc = c + dc;
            const nr = r + dr;
            if (!ok(nc, nr)) continue;
            if (dc !== 0 && dr !== 0 && (!ok(c + dc, r) || !ok(c, r + dr))) continue;
            const nd = k + (dc !== 0 && dr !== 0 ? D : T);
            if (nd < dist[nr * COLS + nc]) { dist[nr * COLS + nc] = nd; push(nd, nr * COLS + nc); }
          }
        }
      },
      distAt(x, z) {
        const c = Math.floor(x / T);
        const r = Math.floor(z / T);
        return c < 0 || r < 0 || c >= COLS || r >= ROWS ? Infinity : dist[r * COLS + c];
      },
      dirAt(x, z) {
        const c = Math.floor(x / T);
        const r = Math.floor(z / T);
        if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return null;
        const here = dist[r * COLS + c];
        if (!isFinite(here) || here === 0) return null;
        let best = here;
        let bc = -1;
        let br = -1;
        for (const [dc, dr] of NB) {
          const nc = c + dc;
          const nr = r + dr;
          if (!ok(nc, nr)) continue;
          if (dc !== 0 && dr !== 0 && (!ok(c + dc, r) || !ok(c, r + dr))) continue;
          const d = dist[nr * COLS + nc];
          if (d < best) { best = d; bc = nc; br = nr; }
        }
        if (bc < 0) return null;
        const [tx, tz] = tileCentre(bc, br);
        const l = Math.hypot(tx - x, tz - z) || 1;
        return { x: (tx - x) / l, z: (tz - z) / l };
      },
    };
  }

  // ---- doors ----
  function setDoorOpen(id, open) {
    const i = doorIndex(id);
    if (i < 0) return;
    doors[i].open = !!open;
  }

  // ---- visuals ----
  const visuals = buildVisuals({ lv, kind, sub, at, areas, areaOfTile, doors, doorAtTile, doorState, exit, start, raycast, quality });

  function update(dt, time) {
    const t = time === undefined ? (visuals.clock += dt) : time;
    for (let i = 0; i < doors.length; i++) {
      const s = doorState[i];
      const goal = doors[i].open ? 1 : 0;
      if (s.t !== goal) {
        s.t = goal > s.t ? Math.min(goal, s.t + dt / DOOR_TIME) : Math.max(goal, s.t - dt / DOOR_TIME);
      }
      visuals.doorVisual(i, s.t, doors[i].open);
    }
    visuals.animate(t);
  }

  return {
    group: visuals.group,
    level: lv.number,
    id: lv.id,
    fog: lv.fog,
    ambient: lv.ambient,
    look: lv.look,
    torch: lv.torch,
    quality,
    start,
    exit,
    areas,
    doors,
    pickups,
    areaAt,
    isSolidAt,
    blocksShotAt: (x, z) => blocksShot(Math.floor(x / T), Math.floor(z / T)),
    moveCircle,
    raycast,
    los,
    createFlowField,
    setDoorOpen,
    update,
    // extras for tests and tools (not part of the contract)
    textures: visuals.textures,
    propsPlaced: visuals.propsPlaced, // Blender props placed, by name
    size: { cols: COLS, rows: ROWS },
    tileSolid: (c, r) => blocksMove(c, r),
    tileBlocksShots: (c, r) => blocksShot(c, r),
  };
}

// ---- procedural textures ----
// Every surface is generated as three aligned fields: albedo, height and roughness. The normal map is derived from the
// height field, so mortar sits recessed, bricks are domed and chips catch the light. Plain typed arrays, no DOM.
function ihash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((s | 0) + 1, 1013904223);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const sstep = (a, b, v) => { const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a); return t * t * (3 - 2 * t); };

// tileable value noise, px x py lattice cells across the texture
function noiseField(S, px, py, seed) {
  const out = new Float32Array(S * S);
  const lat = new Float32Array(px * py);
  for (let i = 0; i < lat.length; i++) lat[i] = ihash(i % px, (i / px) | 0, seed);
  for (let y = 0; y < S; y++) {
    const fy = (y * py) / S;
    const y0 = fy | 0;
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const r0 = y0 * px;
    const r1 = ((y0 + 1) % py) * px;
    for (let x = 0; x < S; x++) {
      const fx = (x * px) / S;
      const x0 = fx | 0;
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const x1 = (x0 + 1) % px;
      const a = lat[r0 + x0];
      const b = lat[r0 + x1];
      const c = lat[r1 + x0];
      const d = lat[r1 + x1];
      out[y * S + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}
function fbmField(S, p, seed) {
  const a = noiseField(S, p, p, seed);
  const b = noiseField(S, p * 2, p * 2, seed + 1);
  const c = noiseField(S, p * 4, p * 4, seed + 2);
  for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.5 + b[i] * 0.3 + c[i] * 0.2;
  return a;
}
function buildNoise(S) {
  const w = new Float32Array(S * S);
  let s = 12345;
  for (let i = 0; i < w.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; w[i] = s / 4294967296; }
  return {
    f1: fbmField(S, 4, 1), f2: fbmField(S, 5, 11), lo: noiseField(S, 3, 3, 21), mid: noiseField(S, 12, 12, 31),
    drip: noiseField(S, 28, 3, 41), grainX: noiseField(S, 3, 40, 51), w,
  };
}

// brick colours: reds and browns, a few vitrified clinkers, blue-black burnt ones, odd pale ones
const BRICK_COLS = [[158, 74, 54], [142, 62, 46], [168, 90, 60], [122, 72, 54], [134, 86, 62], [150, 70, 58], [176, 104, 70]];

function genBrick(S, N, paint, o) {
  const k = 256 / S;
  const rowTop = [];
  for (let i = 0; i <= 12; i++) rowTop.push(Math.round((i * 256) / 12));
  const tab = [];
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 4; col++) {
      const id = ihash(col, row, 1);
      let base;
      if (id < 0.04) base = [62, 46, 48];
      else if (id < 0.07) base = [48, 50, 64];
      else if (id < 0.1) base = [186, 140, 110];
      else if (id < 0.14) base = [104, 88, 80];
      else base = BRICK_COLS[(id * 977) % BRICK_COLS.length | 0];
      tab.push({ base, k: 0.86 + 0.28 * ihash(col, row, 2), off: (ihash(col, row, 3) - 0.5) * 0.12, glossy: id < 0.07, chip: ihash(col, row, 9) < 0.08 });
    }
  }
  for (let y = 0; y < S; y++) {
    const v = y * k;
    const row = Math.min(11, Math.floor((v * 12) / 256));
    const top = rowTop[row];
    const hr = rowTop[row + 1] - top;
    const ly = v - top;
    const offU = row & 1 ? 32 : 0;
    for (let x = 0; x < S; x++) {
      const idx = y * S + x;
      const u = x * k;
      const bx = (u + offU) % 256;
      const col = (bx / 64) | 0;
      const lx = bx - col * 64;
      const br = tab[row * 4 + col];
      const gr = N.w[idx] - 0.5;
      const f = N.f1[idx];
      const mortar = lx < 2.4 || ly < 2.4;
      let r;
      let g;
      let b;
      let h;
      let rough;
      let chipped = false;
      if (mortar) {
        const kk = 1 + (N.mid[idx] - 0.5) * 0.3 + gr * 0.24;
        r = 124 * kk; g = 118 * kk; b = 106 * kk;
        if (ly < 5 && ly >= 2.4) { r *= 0.8; g *= 0.8; b *= 0.8; }
        h = 0.02 + gr * 0.05;
        rough = 0.95;
      } else {
        const de = Math.min(lx - 2.4, 64 - lx, ly - 2.4, hr - ly);
        const dome = sstep(0, 6, de);
        const n = (f - 0.5) * 34 + gr * 24;
        r = br.base[0] * br.k + n; g = br.base[1] * br.k + n * 0.85; b = br.base[2] * br.k + n * 0.8;
        if (ly < 4.4) { r += 12; g += 10; b += 8; }
        if (hr - ly < 2) { r -= 18; g -= 16; b -= 14; }
        if (lx > 62) { r -= 12; g -= 10; b -= 8; }
        h = 0.3 + 0.42 * dome + (f - 0.5) * 0.34 + (N.mid[idx] - 0.5) * 0.2 + gr * 0.12 + br.off;
        if (N.w[(idx * 7) % N.w.length] > 0.985) { r -= 36; g -= 32; b -= 30; h -= 0.1; }
        if (br.chip && lx > 50 && ly < 14 && lx - 50 > ly - 4) { r = 160 + gr * 20; g = 126 + gr * 20; b = 108 + gr * 20; h -= 0.28; chipped = true; }
        rough = br.glossy ? 0.5 : 0.88 + gr * 0.1;
      }
      if (paint) {
        // whitewash over the same relief: bricks show as soft relief, with drips, damp and peeling patches
        const w = 0.95 + gr * 0.08;
        let pr = 232 * w;
        let pg = 227 * w;
        let pb = 214 * w;
        if (mortar) { pr -= 40; pg -= 40; pb -= 38; } else if (ly < 4.4) { pr += 6; pg += 6; pb += 6; } else if (hr - ly < 2) { pr -= 16; pg -= 16; pb -= 14; }
        const dirt = (N.drip[idx] - 0.5) * 38 + (f - 0.5) * 30;
        pr += dirt; pg += dirt; pb += dirt * 1.1;
        const peel = N.mid[(idx + 7919) % N.mid.length] * 0.55 + N.f2[idx] * 0.45 + gr * 0.06;
        let m = 0;
        if (peel > 0.67) m = Math.min(0.6, (peel - 0.67) / 0.12);
        r = pr + (r - pr) * m; g = pg + (g - pg) * m; b = pb + (b - pb) * m;
        h = h * (0.35 + 0.65 * m) + 0.3 * (1 - m) * (mortar ? 0 : 1) + (mortar ? 0 : 0.06);
        rough = 0.7 + m * 0.2 + N.lo[idx] * 0.1; // eggshell paint
        void chipped;
      }
      const o4 = idx * 4;
      o.alb[o4] = r; o.alb[o4 + 1] = g; o.alb[o4 + 2] = b;
      o.hgt[idx] = h;
      o.rgh[idx] = rough;
    }
  }
}

const STONE_ROWS = [[110, 146], [96, 160], [140, 116], [120, 136]];
function genStone(S, N, o) {
  const k = 256 / S;
  for (let y = 0; y < S; y++) {
    const v = y * k;
    const row = (v / 64) | 0;
    const ly = v - row * 64;
    const off = [0, 48, 16, 80][row];
    for (let x = 0; x < S; x++) {
      const idx = y * S + x;
      const bx = (x * k + 256 - off) % 256;
      let acc = 0;
      let blk = 0;
      let lx = 0;
      let w = 0;
      for (let i = 0; i < 2; i++) {
        const bw = STONE_ROWS[row][i];
        if (bx < acc + bw) { blk = i; lx = bx - acc; w = bw; break; }
        acc += bw;
      }
      const gr = N.w[idx] - 0.5;
      const o4 = idx * 4;
      if (lx < 3 || ly < 3) {
        const kk = 1 + gr * 0.3;
        o.alb[o4] = 66 * kk; o.alb[o4 + 1] = 62 * kk; o.alb[o4 + 2] = 56 * kk;
        o.hgt[idx] = 0.02; o.rgh[idx] = 0.95;
        continue;
      }
      const id = ihash(blk, row, 21);
      const base = id < 0.25 ? [140, 134, 124] : id < 0.55 ? [156, 144, 126] : id < 0.8 ? [146, 128, 112] : [120, 118, 114];
      const kk = 0.9 + 0.2 * ihash(blk, row, 22);
      const n = (N.f1[idx] - 0.5) * 30 + gr * 26;
      let r = base[0] * kk + n;
      let g = base[1] * kk + n;
      let b = base[2] * kk + n * 0.9;
      const de = Math.min(lx - 3, w - lx, ly - 3, 64 - ly);
      const dome = sstep(0, 9, de);
      if (ly < 6) { r += 10; g += 10; b += 8; }
      if (ly > 58 || lx > w - 5) { r -= 18; g -= 18; b -= 16; }
      if (N.lo[idx] > 0.55) { const m = sstep(0.55, 0.8, N.lo[idx]); r *= 1 - 0.12 * m; g *= 1 - 0.1 * m; b *= 1 - 0.14 * m; }
      let h = 0.35 + 0.4 * dome + (N.f2[idx] - 0.5) * 0.45 + gr * 0.1; // hewn, uneven face
      if (N.w[(idx * 13) % N.w.length] > 0.99) { r -= 40; g -= 40; b -= 40; h -= 0.2; }
      o.alb[o4] = r; o.alb[o4 + 1] = g; o.alb[o4 + 2] = b;
      o.hgt[idx] = h;
      o.rgh[idx] = 0.86 + gr * 0.1;
    }
  }
}

const FLAG_ROWS = [[0, 88, [100, 92, 64]], [88, 72, [72, 112, 72]], [160, 96, [96, 80, 80]]];
function genFlag(S, N, o) {
  const k = 256 / S;
  for (let y = 0; y < S; y++) {
    const v = y * k;
    const row = v < 88 ? 0 : v < 160 ? 1 : 2;
    const [top, hh, ws] = FLAG_ROWS[row];
    const ly = v - top;
    for (let x = 0; x < S; x++) {
      const idx = y * S + x;
      const u = x * k;
      let acc = 0;
      let blk = 0;
      let lx = 0;
      let w = 0;
      for (let i = 0; i < 3; i++) {
        if (u < acc + ws[i]) { blk = i; lx = u - acc; w = ws[i]; break; }
        acc += ws[i];
      }
      const gr = N.w[idx] - 0.5;
      const o4 = idx * 4;
      if (lx < 3 || ly < 3) {
        o.alb[o4] = 46 + gr * 14; o.alb[o4 + 1] = 44 + gr * 14; o.alb[o4 + 2] = 42 + gr * 14;
        o.hgt[idx] = 0.02; o.rgh[idx] = 0.95;
        continue;
      }
      const id = ihash(blk, row, 32);
      const base = id < 0.4 ? [118, 118, 116] : id < 0.75 ? [104, 106, 108] : [128, 118, 106];
      const kk = 0.88 + 0.24 * ihash(blk, row, 33);
      const edge = Math.min(lx - 3, w - lx, ly - 3, hh - ly);
      const wear = edge < 8 ? -14 + edge * 1.4 : 6;
      const n = (N.f1[idx] - 0.5) * 44 + gr * 22 + wear;
      let r = base[0] * kk + n;
      let g = base[1] * kk + n;
      let b = base[2] * kk + n;
      const stain = N.lo[(idx + 5000) % N.lo.length];
      if (stain > 0.6) { const m = Math.min(1, (stain - 0.6) * 1.6); r *= 1 - m * 0.22; g *= 1 - m * 0.2; b *= 1 - m * 0.18; }
      if (N.mid[(idx + 999) % N.mid.length] > 0.74 && edge < 22) { g += 12; r -= 8; }
      // worn crowns are polished by boots; damp patches are wet and glossy
      let wetH = 0;
      let rough = 0.82 - 0.32 * sstep(10, 26, edge) * sstep(0.45, 0.6, N.f2[idx]);
      const wet = N.f2[(idx + 12345) % N.f2.length];
      if (wet > 0.62) { const m = sstep(0.62, 0.8, wet); rough = rough * (1 - m) + 0.3 * m; r *= 1 - 0.3 * m; g *= 1 - 0.3 * m; b *= 1 - 0.28 * m; wetH = m; }
      o.alb[o4] = r; o.alb[o4 + 1] = g; o.alb[o4 + 2] = b;
      const hFlag = 0.45 + 0.35 * sstep(0, 7, edge) + (N.f1[idx] - 0.5) * 0.14 + gr * 0.05;
      o.hgt[idx] = hFlag * (1 - wetH) + (0.45 + 0.35 * sstep(0, 7, edge)) * wetH; // wet stone is smooth
      o.rgh[idx] = rough;
    }
  }
}

// eight planks along x, butt joints, knots, stains, scuffs. dark = floor boards, otherwise timber
function genBoards(S, N, dark, o) {
  const k = 256 / S;
  const plank = [];
  for (let pl = 0; pl < 8; pl++) {
    const jx = (ihash(pl, 0, 41) * 256) | 0;
    const segs = [0, 1].map((s) => {
      const id = ihash(pl, s, 43);
      return { base: id < 0.3 ? [82, 54, 34] : id < 0.6 ? [68, 44, 28] : id < 0.85 ? [92, 62, 40] : [54, 36, 26], k: (dark ? 0.78 : 1) * (0.86 + 0.28 * ihash(pl, s, 44)), knot: ihash(pl, s, 47) < 0.25 ? jx + 40 + ihash(pl, s, 48) * 150 : -1 };
    });
    plank.push({ jx, segs });
  }
  for (let y = 0; y < S; y++) {
    const v = y * k;
    const pl = (v / 32) | 0;
    const ly = v - pl * 32;
    const P = plank[pl];
    for (let x = 0; x < S; x++) {
      const idx = y * S + x;
      const u = x * k;
      const gr = N.w[idx] - 0.5;
      const o4 = idx * 4;
      const dj = Math.abs(u - P.jx);
      if (ly < 2 || dj < 1 || u < 0.6) {
        o.alb[o4] = 18 + gr * 8; o.alb[o4 + 1] = 12 + gr * 6; o.alb[o4 + 2] = 8 + gr * 6;
        o.hgt[idx] = 0.0; o.rgh[idx] = 0.9;
        continue;
      }
      const sg = P.segs[u >= P.jx ? 1 : 0];
      const streak = N.grainX[(idx + pl * 977) % N.grainX.length] - 0.5;
      const n = streak * 50 + gr * 16 + (N.mid[idx] - 0.5) * 18;
      let r = sg.base[0] * sg.k + n;
      let g = sg.base[1] * sg.k + n * 0.8;
      let b = sg.base[2] * sg.k + n * 0.6;
      let h = 0.55 + streak * 0.35 + gr * 0.05 + 0.1 * sstep(0, 5, Math.min(ly - 2, 32 - ly));
      if (sg.knot >= 0) {
        const d = Math.hypot((u - sg.knot) * 0.8, ly - 16);
        if (d < 6) { const m = 0.55 + d * 0.05; r *= m; g *= m; b *= m; h -= 0.3 * (1 - d / 6); }
      }
      let rough = 0.72 + gr * 0.1;
      const stain = N.lo[(idx + 3000) % N.lo.length];
      if (stain < 0.4) { const q = sstep(0.4, 0.3, stain); const m = 1 - 0.4 * q; r *= m; g *= m; b *= m; rough = rough * (1 - q) + 0.34 * q; } // spilt drinks: sticky and glossy
      const wear = N.f2[idx];
      if (wear > 0.62) { const m = sstep(0.62, 0.7, wear); r *= 1 + 0.18 * m; g *= 1 + 0.14 * m; b *= 1 + 0.08 * m; rough = rough * (1 - m) + 0.5 * m; }
      if (dj > 2 && dj < 6 && (Math.abs(ly - 7) < 1 || Math.abs(ly - 24) < 1)) { r = 30; g = 24; b = 20; h += 0.15; rough = 0.4; } // nail heads
      o.alb[o4] = r; o.alb[o4 + 1] = g; o.alb[o4 + 2] = b;
      o.hgt[idx] = h;
      o.rgh[idx] = rough;
    }
  }
}

function genCarpet(S, N, o) {
  const k = 256 / S;
  for (let y = 0; y < S; y++) {
    const v = y * k;
    const vv = v % 128;
    for (let x = 0; x < S; x++) {
      const idx = y * S + x;
      const uu = (x * k) % 128;
      const d = Math.abs(uu - 64) + Math.abs(vv - 64);
      const gr = N.w[idx] - 0.5;
      let c = [92, 20, 34];
      let h = 0.45;
      if (Math.abs(d - 52) < 3) { c = [176, 134, 52]; h = 0.7; }
      else if (Math.abs(d - 40) < 2) { c = [124, 30, 44]; h = 0.6; }
      else if (d < 24) { c = (uu + vv) % 16 < 8 ? [34, 46, 48] : [48, 30, 40]; h = 0.5; }
      else if (d > 90) { c = [60, 14, 26]; h = 0.4; }
      const wearN = N.f1[idx];
      const worn = wearN > 0.58 ? (wearN - 0.58) * 2.4 : 0;
      const kk = 0.9 + gr * 0.3 - (N.lo[idx] < 0.28 ? 0.3 : 0);
      const o4 = idx * 4;
      o.alb[o4] = c[0] * kk + worn * 50; o.alb[o4 + 1] = c[1] * kk + worn * 36; o.alb[o4 + 2] = c[2] * kk + worn * 30;
      o.hgt[idx] = h + gr * 0.35 - worn * 0.25; // wool pile
      o.rgh[idx] = 0.93 - worn * 0.1;
    }
  }
}

function genConcrete(S, N, o) {
  const k = 256 / S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const idx = y * S + x;
      const gr = N.w[idx] - 0.5;
      const v = 112 + (N.f1[idx] - 0.5) * 44 + gr * 20;
      let r = v;
      let g = v;
      let b = v - 2;
      let h = 0.5 + (N.f1[idx] - 0.5) * 0.4 + gr * 0.12;
      let rough = 0.85 + gr * 0.1;
      if (N.w[(idx * 3) % N.w.length] > 0.992) { r -= 40; g -= 40; b -= 40; h -= 0.35; }
      const stain = N.lo[(idx + 777) % N.lo.length];
      if (stain > 0.6) { const m = (stain - 0.6) * 1.8; r *= 1 - m * 0.4; g *= 1 - m * 0.42; b *= 1 - m * 0.5; rough -= 0.2 * m; }
      const pol = N.f2[idx];
      if (pol > 0.6) rough = rough * 0.6 + 0.2 * sstep(0.6, 0.7, pol); // trowelled, polished by boots
      const wet = N.mid[(idx + 4321) % N.mid.length];
      if (wet > 0.74) { const m = sstep(0.74, 0.84, wet); rough = rough * (1 - m) + 0.42 * m; r *= 1 - 0.3 * m; g *= 1 - 0.3 * m; b *= 1 - 0.3 * m; h = h * (1 - m) + 0.5 * m; }
      if (x * k < 2 || y * k < 2) { r *= 0.55; g *= 0.55; b *= 0.55; h = 0; } // expansion joints
      const o4 = idx * 4;
      o.alb[o4] = r; o.alb[o4 + 1] = g; o.alb[o4 + 2] = b;
      o.hgt[idx] = h;
      o.rgh[idx] = rough;
    }
  }
}

function genPlaster(S, N, o) {
  for (let idx = 0; idx < S * S; idx++) {
    const gr = N.w[idx] - 0.5;
    const n = (N.f1[idx] - 0.5) * 36;
    let r = 110 + n + gr * 14;
    let g = 100 + n + gr * 14;
    let b = 88 + n * 0.9 + gr * 14;
    const damp = sstep(0.6, 0.85, N.lo[idx]); // broad damp stains
    r -= 26 * damp; g -= 30 * damp; b -= 34 * damp;
    const o4 = idx * 4;
    o.alb[o4] = r; o.alb[o4 + 1] = g; o.alb[o4 + 2] = b;
    o.hgt[idx] = 0.5 + (N.f2[idx] - 0.5) * 0.6 + gr * 0.1; // trowel waves
    o.rgh[idx] = 0.9;
  }
}

const TEX_SPEC = {
  // name: [generator, normal strength, normal-map default scale]
  brick: [(S, N, o) => genBrick(S, N, false, o), 7],
  paint: [(S, N, o) => genBrick(S, N, true, o), 5],
  stone: [genStone, 6],
  flag: [genFlag, 6],
  boards: [(S, N, o) => genBoards(S, N, false, o), 4],
  floorboards: [(S, N, o) => genBoards(S, N, true, o), 4],
  carpet: [genCarpet, 3, true],
  concrete: [genConcrete, 4, true],
  plaster: [genPlaster, 3, true],
};

function dataTex(data, w, h, format) {
  const t = new THREE.DataTexture(data, w, h, format, THREE.UnsignedByteType);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// quality: { S, nrm, rgh }. Returns { name: { map, normal, rough } }, the last two null when the tier does without.
function buildTextures(Q) {
  const cache = {}; // noise fields and scratch arrays per size
  const out = {};
  for (const [name, [gen, strength, soft]] of Object.entries(TEX_SPEC)) {
    const S = soft ? Math.min(Q.S, 256) : Q.S; // low-frequency surfaces do not need the big size
    const c = cache[S] || (cache[S] = { N: buildNoise(S), o: { alb: new Float32Array(S * S * 4), hgt: new Float32Array(S * S), rgh: new Float32Array(S * S) } });
    const N = c.N;
    const o = c.o;
    gen(S, N, o);
    const a8 = new Uint8Array(S * S * 4);
    for (let i = 0; i < a8.length; i += 4) {
      a8[i] = clamp(o.alb[i], 0, 255);
      a8[i + 1] = clamp(o.alb[i + 1], 0, 255);
      a8[i + 2] = clamp(o.alb[i + 2], 0, 255);
      a8[i + 3] = 255;
    }
    const map = dataTex(a8, S, S, THREE.RGBAFormat);
    map.colorSpace = THREE.SRGBColorSpace;
    let normal = null;
    let rough = null;
    if (Q.nrm) {
      const kk = (strength * S) / 256;
      const n8 = new Uint8Array(S * S * 4);
      const h = o.hgt;
      for (let y = 0; y < S; y++) {
        const ym = ((y - 1 + S) % S) * S;
        const yp = ((y + 1) % S) * S;
        const yc = y * S;
        for (let x = 0; x < S; x++) {
          const xm = (x - 1 + S) % S;
          const xp = (x + 1) % S;
          const gx = (h[yc + xp] - h[yc + xm]) * 0.5 * kk;
          const gy = (h[yp + x] - h[ym + x]) * 0.5 * kk;
          const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
          const i4 = (yc + x) * 4;
          n8[i4] = (-gx * inv * 0.5 + 0.5) * 255;
          n8[i4 + 1] = (-gy * inv * 0.5 + 0.5) * 255;
          n8[i4 + 2] = (inv * 0.5 + 0.5) * 255;
          n8[i4 + 3] = 255;
        }
      }
      normal = dataTex(n8, S, S, THREE.RGBAFormat);
    }
    if (Q.rgh) {
      const H = S >> 1;
      const r8 = new Uint8Array(H * H * 2);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < H; x++) {
          const i = (y * 2) * S + x * 2;
          const v = (o.rgh[i] + o.rgh[i + 1] + o.rgh[i + S] + o.rgh[i + S + 1]) * 0.25;
          r8[(y * H + x) * 2] = 255; // R unused (a spare occlusion channel)
          r8[(y * H + x) * 2 + 1] = clamp(v, 0.04, 1) * 255;
        }
      }
      rough = dataTex(r8, H, H, THREE.RGFormat);
    }
    out[name] = { map, normal, rough };
  }
  return out;
}

// soft round sprite (alpha in all channels) for steam, light spots and haze
function softSprite(size, power) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const v = Math.pow(Math.max(0, 1 - Math.hypot(dx, dy)), power) * 255;
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = v;
    }
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
function hazeTex() {
  const S = 128;
  const a = noiseField(S, 4, 4, 91);
  const b = noiseField(S, 8, 8, 92);
  const d = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const v = clamp((a[i] * 0.65 + b[i] * 0.35 - 0.3) * 2.2, 0, 1) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = d[i * 4 + 3] = v;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ---- Blender props: scripts/blender/props.py writes prop-meshes.js; each prop is decoded on first use ----
// A prop is a few parts, each tagged with the level mesher it merges into, so materials stay shared and the draw calls
// do not change. Vertex colour already has the model's occlusion and edge wear in it; Mesher.bake adds the level's light.
const propBytes = (s, Type) => {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
  return new Type(u.buffer);
};
const SRGB_LIN = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const propCache = {};
function propData(name) {
  if (name in propCache) return propCache[name];
  const src = PROP_MESHES[name];
  if (!src) return (propCache[name] = null);
  const parts = src.parts.map((m) => {
    const p = propBytes(m.p, Int16Array);
    const pos = new Float32Array(p.length);
    for (let i = 0; i < p.length; i++) pos[i] = p[i] * m.sc;
    const nb = propBytes(m.nrm, Int8Array);
    const nor = new Float32Array(nb.length);
    for (let i = 0; i < nb.length; i++) nor[i] = nb[i] / 127;
    let col;
    if (m.col) {
      const cb = propBytes(m.col, Uint8Array);
      col = new Float32Array(cb.length);
      const g = m.g || 1; // timber is dark: the model asks for a gain on its tint
      for (let i = 0; i < cb.length; i++) col[i] = SRGB_LIN[cb[i]] * g;
    } else { // unlit glow: one HDR colour for the whole part
      const g = mul(rgb(m.glow[0]), m.glow[1]);
      col = new Float32Array(m.n * 3);
      for (let i = 0; i < m.n; i++) col.set(g, i * 3);
    }
    const uv = m.uv ? propBytes(m.uv, Int16Array) : null; // millimetres on round surfaces, -32768 where the mesher picks the coordinates
    return { m: m.m, q: m.q || 0, sw: !!m.sw, tn: !!m.tn, n: m.n, pos, nor, col, uv, idx: propBytes(m.idx, Uint16Array) };
  });
  return (propCache[name] = { h: src.h, parts });
}

// ---- geometry builder: merged BufferGeometry with vertex colours, world-unit UVs and baked light ----
const ONE = [1, 1, 1];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

class Mesher {
  constructor(scale, bake, sway = false) {
    this.s = scale;
    this.bake = bake;
    this.sway = sway;
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = [];
    this.sw = [];
    this.idx = [];
    this.swap = false;
  }

  vert(p, n, c) {
    let u;
    let v;
    if (Math.abs(n[1]) > 0.6) { u = p[0]; v = p[2]; }
    else if (Math.abs(n[0]) > Math.abs(n[2])) { u = p[2]; v = p[1]; }
    else { u = p[0]; v = p[1]; }
    if (this.swap) { const t = u; u = v; v = t; }
    const b = this.bake ? this.bake(p[0], p[1], p[2], n[0], n[1], n[2]) : ONE;
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.col.push(c[0] * b[0], c[1] * b[1], c[2] * b[2]);
    this.uv.push(u / this.s, v / this.s);
    if (this.sway) { const t = clamp((WALL_H - p[1]) / 1.1, 0, 1); this.sw.push(t * t * (3 - 2 * t)); }
    return this.pos.length / 3 - 1;
  }

  // hint: roughly which way the face should point, so winding never has to be worked out by hand
  tri(a, b, c, col, hint) {
    let n = cross3(sub3(b, a), sub3(c, a));
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-9) return;
    n = [n[0] / l, n[1] / l, n[2] / l];
    if (hint && dot3(n, hint) < 0) { const t = b; b = c; c = t; n = [-n[0], -n[1], -n[2]]; }
    this.idx.push(this.vert(a, n, col), this.vert(b, n, col), this.vert(c, n, col));
  }

  quad(a, b, c, d, col, hint) {
    let n = cross3(sub3(b, a), sub3(d, a));
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-9) return;
    n = [n[0] / l, n[1] / l, n[2] / l];
    if (hint && dot3(n, hint) < 0) { const t = b; b = d; d = t; n = [-n[0], -n[1], -n[2]]; }
    const i = this.vert(a, n, col);
    const j = this.vert(b, n, col);
    const k = this.vert(c, n, col);
    const m = this.vert(d, n, col);
    this.idx.push(i, j, k, i, k, m);
  }

  // Shared-vertex patch: a -> b is u, a -> d is v. us and vs are lists of 0..1 split positions, so edges can be
  // finer near corners where the baked occlusion changes fastest. col may be a function (i, j) => colour per vertex.
  grid(a, b, d, us, vs, col, hint) {
    let n = norm3(cross3(sub3(b, a), sub3(d, a)));
    if (hint && dot3(n, hint) < 0) n = [-n[0], -n[1], -n[2]];
    const flip = hint && dot3(norm3(cross3(sub3(b, a), sub3(d, a))), hint) < 0;
    const W = us.length;
    const ids = [];
    for (let j = 0; j < vs.length; j++) {
      for (let i = 0; i < W; i++) {
        const s = us[i];
        const t = vs[j];
        const p = [a[0] + (b[0] - a[0]) * s + (d[0] - a[0]) * t, a[1] + (b[1] - a[1]) * s + (d[1] - a[1]) * t, a[2] + (b[2] - a[2]) * s + (d[2] - a[2]) * t];
        ids.push(this.vert(p, n, typeof col === 'function' ? col(i, j, p) : col));
      }
    }
    for (let j = 0; j < vs.length - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const p0 = ids[j * W + i];
        const p1 = ids[j * W + i + 1];
        const p2 = ids[(j + 1) * W + i + 1];
        const p3 = ids[(j + 1) * W + i];
        if (flip) this.idx.push(p0, p3, p2, p0, p2, p1);
        else this.idx.push(p0, p1, p2, p0, p2, p3);
      }
    }
  }

  box(x0, y0, z0, x1, y1, z1, col, o = {}) {
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], col, [0, 1, 0]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col, [1, 0, 0]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, [-1, 0, 0]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, [0, 0, 1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, [0, 0, -1]);
    if (o.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, [0, -1, 0]);
  }

  // box with chamfered edges, so the edges catch the light. o.floor: stands on the floor, no bevel at the bottom.
  bbox(x0, y0, z0, x1, y1, z1, col, b = 0.04, o = {}) {
    const lo = [x0, y0, z0];
    const hi = [x1, y1, z1];
    b = Math.min(b, (x1 - x0) / 3, (y1 - y0) / 3, (z1 - z0) / 3);
    const noBottom = o.floor || !o.bottom;
    const bl = [b, o.floor ? 0 : b, b];
    const L = (a) => lo[a] + bl[a];
    const H = (a) => hi[a] - b;
    const face = (a, s) => {
      const a2 = (a + 1) % 3;
      const a3 = (a + 2) % 3;
      const plane = s > 0 ? hi[a] : lo[a];
      const p = (u, v) => { const q = [0, 0, 0]; q[a] = plane; q[a2] = u; q[a3] = v; return q; };
      const hint = [0, 0, 0]; hint[a] = s;
      this.quad(p(L(a2), L(a3)), p(H(a2), L(a3)), p(H(a2), H(a3)), p(L(a2), H(a3)), col, hint);
    };
    for (let a = 0; a < 3; a++) for (const s of [-1, 1]) { if (a === 1 && s < 0 && noBottom) continue; face(a, s); }
    const at = (a, sa, a2, sa2, a3, t) => { // point on face a, at the inset edge towards face a2
      const q = [0, 0, 0];
      q[a] = sa > 0 ? hi[a] : lo[a];
      q[a2] = sa2 > 0 ? H(a2) : L(a2);
      q[a3] = t ? H(a3) : L(a3);
      return q;
    };
    for (let a = 0; a < 3; a++) {
      for (let a2 = a + 1; a2 < 3; a2++) {
        const a3 = 3 - a - a2;
        for (const sa of [-1, 1]) {
          for (const sa2 of [-1, 1]) {
            if ((a === 1 && sa < 0 && noBottom) || (a2 === 1 && sa2 < 0 && noBottom)) continue;
            const A = at(a, sa, a2, sa2, a3, 0);
            const B = at(a, sa, a2, sa2, a3, 1);
            const C = at(a2, sa2, a, sa, a3, 1);
            const D = at(a2, sa2, a, sa, a3, 0);
            const hint = [0, 0, 0]; hint[a] = sa; hint[a2] = sa2;
            this.quad(A, B, C, D, col, hint);
          }
        }
      }
    }
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        if (sy < 0 && noBottom) continue;
        for (const sz of [-1, 1]) {
          const px = [sx > 0 ? hi[0] : lo[0], sy > 0 ? H(1) : L(1), sz > 0 ? H(2) : L(2)];
          const py = [sx > 0 ? H(0) : L(0), sy > 0 ? hi[1] : lo[1], sz > 0 ? H(2) : L(2)];
          const pz = [sx > 0 ? H(0) : L(0), sy > 0 ? H(1) : L(1), sz > 0 ? hi[2] : lo[2]];
          this.tri(px, py, pz, col, [sx, sy, sz]);
        }
      }
    }
  }

  frustum(cx, cz, r0, r1, y0, y1, seg, col, caps = true) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      this.quad([cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0],
        [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1], [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1], col, [Math.cos(am), 0.2, Math.sin(am)]);
      if (caps && r1 > 0) this.tri([cx, y1, cz], [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1], [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1], col, [0, 1, 0]);
      if (caps && r0 > 0) this.tri([cx, y0, cz], [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0], col, [0, -1, 0]);
    }
  }

  // open cone between two horizontal rings, bright at one end and fading to the other (light shafts)
  cone(a, ar, b, br, seg, colA, colB) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const P = [[a[0] + Math.cos(a0) * ar, a[1], a[2] + Math.sin(a0) * ar], [a[0] + Math.cos(a1) * ar, a[1], a[2] + Math.sin(a1) * ar],
        [b[0] + Math.cos(a1) * br, b[1], b[2] + Math.sin(a1) * br], [b[0] + Math.cos(a0) * br, b[1], b[2] + Math.sin(a0) * br]];
      const n = norm3(cross3(sub3(P[1], P[0]), sub3(P[3], P[0])));
      const base = this.pos.length / 3;
      const cols = [colA, colA, colB, colB];
      for (let k = 0; k < 4; k++) this.vert(P[k], n, cols[k]);
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  // horizontal round pipe along x or z
  pipe(axis, a0, a1, y, c, r, seg, col) {
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * Math.PI * 2;
      const t1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (t, a) => (axis === 'x' ? [a, y + Math.sin(t) * r, c + Math.cos(t) * r] : [c + Math.cos(t) * r, y + Math.sin(t) * r, a]);
      const tm = (t0 + t1) / 2;
      this.quad(p(t0, a0), p(t1, a0), p(t1, a1), p(t0, a1), col, axis === 'x' ? [0, Math.sin(tm), Math.cos(tm)] : [Math.cos(tm), Math.sin(tm), 0]);
    }
  }

  // prism along any segment (cables, hoses, chain rails)
  tube(a, b, r, col, sides = 4) {
    const d = norm3(sub3(b, a));
    let up = [0, 1, 0];
    if (Math.abs(d[1]) > 0.95) up = [1, 0, 0];
    const u = norm3(cross3(d, up));
    const w = cross3(d, u);
    const ring = (c, i) => { const t = ((i + 0.5) / sides) * Math.PI * 2; return [c[0] + (u[0] * Math.cos(t) + w[0] * Math.sin(t)) * r, c[1] + (u[1] * Math.cos(t) + w[1] * Math.sin(t)) * r, c[2] + (u[2] * Math.cos(t) + w[2] * Math.sin(t)) * r]; };
    for (let i = 0; i < sides; i++) {
      const t = (((i + 0.5) / sides) + 0.5 / sides) * Math.PI * 2;
      const hint = [u[0] * Math.cos(t) + w[0] * Math.sin(t), u[1] * Math.cos(t) + w[1] * Math.sin(t), u[2] * Math.cos(t) + w[2] * Math.sin(t)];
      this.quad(ring(a, i), ring(a, (i + 1) % sides), ring(b, (i + 1) % sides), ring(b, i), col, hint);
    }
  }

  // Append one decoded prop part. Placed at (x, y, z), turned by yaw about y, scaled by sc = [sx, sy, sz]; `tint` multiplies
  // the colour of parts marked tintable. Normals follow the scale, the level's baked light multiplies the colour.
  part(pt, x, y, z, yaw, sc, tint) {
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const swap = this.swap;
    if (pt.sw) this.swap = true;
    const base = this.pos.length / 3;
    const tc = pt.tn && tint ? tint : ONE;
    const { pos, nor, col, n } = pt;
    const uniform = sc[0] === sc[1] && sc[1] === sc[2];
    const P = [0, 0, 0];
    const N = [0, 0, 0];
    const C = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const px = pos[j] * sc[0];
      const pz = pos[j + 2] * sc[2];
      P[0] = x + px * cs + pz * sn;
      P[1] = y + pos[j + 1] * sc[1];
      P[2] = z - px * sn + pz * cs;
      let nx = nor[j];
      let ny = nor[j + 1];
      let nz = nor[j + 2];
      if (!uniform) {
        nx /= sc[0]; ny /= sc[1]; nz /= sc[2];
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
      }
      N[0] = nx * cs + nz * sn;
      N[1] = ny;
      N[2] = -nx * sn + nz * cs;
      C[0] = col[j] * tc[0];
      C[1] = col[j + 1] * tc[1];
      C[2] = col[j + 2] * tc[2];
      this.vert(P, N, C);
      if (pt.uv && pt.uv[i * 2] !== -32768) { // round surface: arc length and height, not the flat projection
        const k = this.uv.length - 2;
        const u = pt.uv[i * 2] / 1000;
        const v = pt.uv[i * 2 + 1] / 1000;
        this.uv[k] = (this.swap ? v : u) / this.s;
        this.uv[k + 1] = (this.swap ? u : v) / this.s;
      }
    }
    for (let i = 0; i < pt.idx.length; i++) this.idx.push(base + pt.idx[i]);
    this.swap = swap;
  }

  mesh(material) {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.sway) g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sw, 1));
    g.setIndex(new THREE.BufferAttribute(this.pos.length / 3 > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false;
    return m;
  }
}

// A local frame on a wall (or any vertical plane): u along the tangent, y up, d out along the normal.
function frame(cx, cz, nx, nz) {
  const ux = nz;
  const uz = -nx;
  return { cx, cz, nx, nz, p: (u, y, d) => [cx + ux * u + nx * d, y, cz + uz * u + nz * d], n: [nx, 0, nz], t: [ux, 0, uz] };
}
// box in a frame; skips the back face. m.bbox is not used here: wall dressing is flat enough not to need it.
function obox(m, f, u0, u1, y0, y1, d0, d1, col, o = {}) {
  const P = f.p;
  const neg = (v) => [-v[0], -v[1], -v[2]];
  m.quad(P(u0, y0, d1), P(u1, y0, d1), P(u1, y1, d1), P(u0, y1, d1), col, f.n);
  m.quad(P(u1, y0, d0), P(u1, y0, d1), P(u1, y1, d1), P(u1, y1, d0), col, f.t);
  m.quad(P(u0, y0, d0), P(u0, y0, d1), P(u0, y1, d1), P(u0, y1, d0), col, neg(f.t));
  m.quad(P(u0, y1, d0), P(u1, y1, d0), P(u1, y1, d1), P(u0, y1, d1), col, [0, 1, 0]);
  if (o.bottom !== false) m.quad(P(u0, y0, d0), P(u1, y0, d0), P(u1, y0, d1), P(u0, y0, d1), col, [0, -1, 0]);
  if (o.back) m.quad(P(u0, y0, d0), P(u1, y0, d0), P(u1, y1, d0), P(u0, y1, d0), col, neg(f.n));
}
function disc(m, f, u, y, d, r, seg, col) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    m.tri(f.p(u, y, d), f.p(u + Math.cos(a0) * r, y + Math.sin(a0) * r, d), f.p(u + Math.cos(a1) * r, y + Math.sin(a1) * r, d), col, f.n);
  }
}
function annulus(m, f, u, y, d, r0, r1, seg, col) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    m.quad(f.p(u + Math.cos(a0) * r0, y + Math.sin(a0) * r0, d), f.p(u + Math.cos(a0) * r1, y + Math.sin(a0) * r1, d),
      f.p(u + Math.cos(a1) * r1, y + Math.sin(a1) * r1, d), f.p(u + Math.cos(a1) * r0, y + Math.sin(a1) * r0, d), col, f.n);
  }
}
// thin flat tube from (ua, ya) to (ub, yb) lying in the frame plane
function ribbon(m, f, ua, ya, ub, yb, w, d, col) {
  const dx = ub - ua;
  const dy = yb - ya;
  const l = Math.hypot(dx, dy) || 1;
  const qx = (-dy / l) * (w / 2);
  const qy = (dx / l) * (w / 2);
  m.quad(f.p(ua - qx, ya - qy, d), f.p(ub - qx, yb - qy, d), f.p(ub + qx, yb + qy, d), f.p(ua + qx, ya + qy, d), col, f.n);
}
// a flat horizontal blob lying on the floor
function patch(m, cx, y, cz, r, seg, col, wob) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const r0 = r * (1 + (ihash(i, wob, 3) - 0.5) * 0.5);
    const r1 = r * (1 + (ihash(i + 1 === seg ? 0 : i + 1, wob, 3) - 0.5) * 0.5);
    m.tri([cx, y, cz], [cx + Math.cos(a0) * r0, y, cz + Math.sin(a0) * r0], [cx + Math.cos(a1) * r1, y, cz + Math.sin(a1) * r1], col, [0, 1, 0]);
  }
}

const QUALITY = {
  high: { detail: true, S: 512, nrm: true, rgh: true, std: true, bevel: true, fine: true, spots: 40, shafts: true, haze: true, steam: true, sway: true },
  medium: { detail: true, S: 384, nrm: true, rgh: true, std: true, bevel: true, fine: false, spots: 20, shafts: true, haze: false, steam: true, sway: true },
  low: { detail: false, S: 256, nrm: false, rgh: false, std: false, bevel: false, fine: false, spots: 0, shafts: false, haze: false, steam: false, sway: false },
};

const C = {
  iron: [0.2, 0.2, 0.22], ironD: [0.07, 0.07, 0.08], steel: [0.55, 0.55, 0.58], brass: [0.78, 0.56, 0.2], chrome: [0.85, 0.85, 0.88], rust: [0.24, 0.14, 0.09],
  rubber: [0.03, 0.03, 0.035], black: [0.035, 0.035, 0.04], leather: [0.3, 0.06, 0.08],
};
const glowc = (hex, k = 1) => mul(rgb(hex), k); // HDR: k above 1 on purpose, so it blooms

const WALL_YS = [0, 0.3, 0.8, 1.5, 2.5, 3.1, WALL_H];

function buildVisuals(ctx) {
  const { lv, kind, sub, at, areas, areaOfTile, doors, doorAtTile, raycast, quality } = ctx;
  const { cols: COLS, rows: ROWS } = lv;
  const { areaStyle: AREA_STYLE, wallStyle: WALL_STYLE, floorStyle: FLOOR_STYLE, floorTint: FLOOR_TINT } = lv;
  const Q = QUALITY[quality];
  const tex = buildTextures(Q);
  const aid = (an) => areas[an].id;
  const sprite = Q.spots || Q.steam ? softSprite(64, 1.6) : null;
  const COW = lv.id === 'cowgate';
  const D = COW ? null : makeDecor(lv, { Q, areas, at, areaOfTile, doors, doorAtTile, exit: ctx.exit, start: ctx.start, hash, ihash });

  // ---- wall faces (data first: the decor below decides which lights exist before anything is baked) ----
  const faces = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (at(c, r) !== WALL) continue;
      for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nc = c + nx;
        const nr = r + nz;
        if (at(nc, nr) === WALL) continue;
        const an = areaOfTile(nc, nr);
        if (an < 0) continue;
        faces.push({ c, r, nx, nz, an, id: aid(an), f: frame((c + 0.5) * T + (nx * T) / 2, (r + 0.5) * T + (nz * T) / 2, nx, nz), h: hash(c, r, nx * 3 + nz + 7), jamb: at(nc, nr) === DOOR });
      }
    }
  }
  // which faces get what, decided once
  const plan = new Map();
  for (const fc of faces) {
    const { c, r, nz, h, id } = fc;
    if (fc.jamb) continue;
    let what = null;
    if (D) what = D.plan(fc);
    else if (id === 'bar' && r === 13 && nz === 1 && c >= 5 && c <= 24 && c % 2 === 1) what = 'alcove-shelves';
    else if (id === 'cloakroom' && r === 38 && nz === 1 && c >= 9 && c <= 16 && c % 2 === 1) what = 'alcove-bulb';
    else if (id === 'vip' && r === 8 && nz === 1 && c % 4 === 2 && c >= 6 && c <= 28) what = 'alcove-mirror';
    else if (id === 'vip' && r === 13 && nz === -1 && c % 4 === 0 && c >= 8 && c <= 28) what = 'alcove-mirror';
    else if (id === 'vip' && r === 8 && nz === 1 && c % 4 === 0 && c >= 4 && c <= 30 && c !== 32) what = 'sconce';
    else if (id === 'vip' && r === 13 && nz === -1 && c % 4 === 2 && c >= 6 && c <= 30) what = 'sconce';
    else if (id === 'cloakroom' && r === 47 && nz === -1 && c >= 10 && c <= 20 && c % 3 === 1) what = 'sconce';
    else if (id === 'dancefloor' && r === 23 && nz === 1 && [3, 6, 9, 24, 27].includes(c)) what = 'alcove-bulb';
    else if (id === 'dancefloor' && r === 23 && nz === 1 && c >= 14 && c <= 21) what = 'banner';
    else if (h % 5 === 0 && (id === 'cloakroom' || id === 'dancefloor' || id === 'backstage' || id === 'stairwell')) what = 'poster';
    else if (h % 23 === 1 && id !== 'vip') what = 'extinguisher';
    else if (h % 11 === 2 && (id === 'stairwell' || id === 'backstage' || id === 'cloakroom' || id === 'dancefloor')) what = 'cables';
    else if (h % 13 === 3 && (id === 'stairwell' || id === 'backstage' || id === 'cloakroom' || id === 'dancefloor')) what = 'vent';
    if (what) plan.set(fc, what);
  }

  // ---- light sources: positions in tile units (centre of tile c is c + 0.5) ----
  const E = [];
  const emit = (c, r, y, hex, k, rad, down = false) => E.push({ x: c * T, y, z: r * T, col: rgb(hex), k, r: rad, down, vis: null });
  const PENDANT = [
    ['cloakroom', [[10.5, 42.5], [15.5, 42.5], [19.5, 41.5], [14.5, 45.5]]],
    ['bar', [[3.5, 16.5], [9.5, 16.5], [15.5, 16.5], [21.5, 16.5], [6.5, 20.5], [13.5, 20.5], [20.5, 20.5], [31.5, 16.5], [31.5, 20.5]]],
    ['vip', [[8.5, 11], [16.5, 11], [24.5, 11], [32.5, 11], [2.5, 11]]],
  ];
  const BULBS = [['stairwell', [[4.5, 44.5]]], ['backstage', [[6.5, 3.5], [11.5, 5.5], [17.5, 2.5], [21.5, 5.5], [27.5, 3.5], [32.5, 5.5]]]];
  const CANS = [ // dancefloor stage lights: [x, z, red?] on two trusses
    [10, 27.5, 1], [15, 27.5, 0], [20, 27.5, 1], [25, 27.5, 0], [30, 27.5, 1],
    [14, 36, 0], [20, 36, 1], [26, 36, 0],
  ];
  if (D) D.lights(emit, faces, plan);
  if (COW) {
  PENDANT.forEach(([, ps]) => ps.forEach(([c, r]) => emit(c, r, 2.6, 0xffa24a, 1.25, 8.5, true)));
  BULBS.forEach(([id, ps]) => ps.forEach(([c, r]) => emit(c, r, 2.6, id === 'stairwell' ? 0xffb85a : 0xffd890, id === 'stairwell' ? 1.7 : 1.05, 9, true)));
  CANS.forEach(([c, r, red]) => emit(c, r, 2.8, red ? 0xff2412 : 0xff7a14, 1.35, 11, true));
  emit(17.5, 30.5, 2.6, 0xffc890, 0.45, 9);
  emit(4.5, 41.0, 2.4, 0x9fb8ff, 1.0, 8);
  emit(2.5, 4.0, 1.4, 0xa8ffc0, 0.9, 7);
  emit(17.5, 14.5, 1.6, 0xffa040, 1.0, 11); emit(8.5, 14.5, 1.6, 0xffa040, 0.85, 9); emit(23.5, 14.5, 1.6, 0xffa040, 0.85, 9);
  emit(1.2, 16.5, 1.6, 0xff5a9a, 0.9, 6);
  emit(34.6, 30.5, 1.6, 0x5aa0ff, 0.9, 6);
  emit(18, 24.5, 1.8, 0xff3020, 0.6, 8);
  emit(17.5, 27.5, 1.6, 0xffc860, 0.9, 5); // the last orders on the dancefloor
  emit(19.5, 9.5, 1.6, 0xffc860, 0.9, 5); // and the one in the VIP alcove
  for (const [fc, what] of plan) {
    if (what === 'sconce') emit((fc.f.cx + fc.nx * 0.3) / T, (fc.f.cz + fc.nz * 0.3) / T, 1.9, 0xffa860, 0.85, 5.5);
    if (what === 'alcove-bulb') emit((fc.f.cx + fc.nx * 0.3) / T, (fc.f.cz + fc.nz * 0.3) / T, 1.2, 0xff6a30, 0.7, 4);
  }
  }

  // Tile-level occlusion: for every light, a 0.5 unit grid of "can this cell see the light", so pools stop at walls.
  const VC = 0.5;
  const GW = (COLS * T) / VC;
  const GH = (ROWS * T) / VC;
  const lightBlocked = (c, r) => { const k = at(c, r); return k === WALL || k === PILLAR || k === SPEAKER || k === STAIRS || (k === DOOR && doorAtTile[r * COLS + c] !== 0); };
  const segClear = (ex, ez, tx, tz) => {
    const dx = tx - ex;
    const dz = tz - ez;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return true;
    const ux = dx / len;
    const uz = dz / len;
    let c = Math.floor(ex / T);
    let r = Math.floor(ez / T);
    const ec = c;
    const er = r;
    const tc = Math.floor(tx / T);
    const tr = Math.floor(tz / T);
    const sc = ux > 0 ? 1 : -1;
    const sr = uz > 0 ? 1 : -1;
    let tX = ux === 0 ? Infinity : ((ux > 0 ? c + 1 : c) * T - ex) / ux;
    let tZ = uz === 0 ? Infinity : ((uz > 0 ? r + 1 : r) * T - ez) / uz;
    const dX = ux === 0 ? Infinity : T / Math.abs(ux);
    const dZ = uz === 0 ? Infinity : T / Math.abs(uz);
    for (let g = 0; g < 200; g++) {
      if (!(c === ec && r === er) && !(c === tc && r === tr) && lightBlocked(c, r)) return false;
      if (c === tc && r === tr) return true;
      if (tX < tZ) { if (tX > len) return true; c += sc; tX += dX; } else { if (tZ > len) return true; r += sr; tZ += dZ; }
    }
    return true;
  };
  for (const e of E) {
    const gx0 = Math.max(0, Math.floor((e.x - e.r) / VC));
    const gx1 = Math.min(GW - 1, Math.floor((e.x + e.r) / VC));
    const gz0 = Math.max(0, Math.floor((e.z - e.r) / VC));
    const gz1 = Math.min(GH - 1, Math.floor((e.z + e.r) / VC));
    const gw = gx1 - gx0 + 1;
    const gh = gz1 - gz0 + 1;
    const vis = new Float32Array(gw * gh);
    const solid = new Uint8Array(gw * gh);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const cx = (gx0 + i + 0.5) * VC;
        const cz = (gz0 + j + 0.5) * VC;
        const tc = Math.floor(cx / T);
        const tr = Math.floor(cz / T);
        if (at(tc, tr) !== FLOOR && at(tc, tr) !== COVER && at(tc, tr) !== DOOR) { solid[j * gw + i] = 1; continue; }
        if (Math.hypot(cx - e.x, cz - e.z) > e.r) continue;
        vis[j * gw + i] = segClear(e.x, e.z, cx, cz) ? 1 : 0;
      }
    }
    // dilate into solid cells so vertices on wall faces see the light of the open cell in front of them
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        if (!solid[j * gw + i]) continue;
        let m = 0;
        if (i > 0 && !solid[j * gw + i - 1]) m = Math.max(m, vis[j * gw + i - 1]);
        if (i < gw - 1 && !solid[j * gw + i + 1]) m = Math.max(m, vis[j * gw + i + 1]);
        if (j > 0 && !solid[(j - 1) * gw + i]) m = Math.max(m, vis[(j - 1) * gw + i]);
        if (j < gh - 1 && !solid[(j + 1) * gw + i]) m = Math.max(m, vis[(j + 1) * gw + i]);
        vis[j * gw + i] = m;
      }
    }
    Object.assign(e, { vis, gx0, gz0, gw, gh });
  }
  const visAt = (e, x, z) => {
    const gx = x / VC - 0.5 - e.gx0;
    const gz = z / VC - 0.5 - e.gz0;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const g = (a, b) => (a < 0 || b < 0 || a >= e.gw || b >= e.gh ? 0 : e.vis[b * e.gw + a]);
    return (g(i, j) * (1 - fx) + g(i + 1, j) * fx) * (1 - fz) + (g(i, j + 1) * (1 - fx) + g(i + 1, j + 1) * fx) * fz;
  };

  // ---- the bake: ambient tint, smooth ambient occlusion, then occluded coloured pools ----
  const TINT = areas.map((a) => AREA_STYLE[a.id].tint);
  const GAIN = Q.std ? 1 : 1.4; // Lambert has no environment diffuse, so the low tier is lifted a little
  const SW = new Float32Array(COLS * ROWS); // solid weight per tile, and whether anything solid is within one tile
  const SNEAR = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const k = at(c, r); SW[r * COLS + c] = k === WALL || k === PILLAR || k === SPEAKER || k === STAIRS ? 1 : k === COVER ? 0.55 : 0; }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let any = 0;
      for (let rr = Math.max(0, r - 1); rr <= Math.min(ROWS - 1, r + 1); rr++) for (let cc = Math.max(0, c - 1); cc <= Math.min(COLS - 1, c + 1); cc++) if (SW[rr * COLS + cc]) any = 1;
      SNEAR[r * COLS + c] = any;
    }
  }
  const solidW = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS ? 1 : SW[r * COLS + c]);
  const nearSolid = (x, z, oc, or) => { // distance to the nearest solid tile box, weaker for low cover
    const c0 = Math.floor(x / T);
    const r0 = Math.floor(z / T);
    if (c0 >= 0 && r0 >= 0 && c0 < COLS && r0 < ROWS && !SNEAR[r0 * COLS + c0]) return 9;
    let best = 9;
    for (let rr = r0 - 1; rr <= r0 + 1; rr++) {
      for (let cc = c0 - 1; cc <= c0 + 1; cc++) {
        if (cc === oc && rr === or) continue;
        const w = solidW(cc, rr);
        if (!w) continue;
        const dx = x - clamp(x, cc * T, cc * T + T);
        const dz = z - clamp(z, rr * T, rr * T + T);
        const d = Math.hypot(dx, dz) / w;
        if (d < best) best = d;
      }
    }
    return best;
  };
  const smooth = (v) => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
  let lastArea = 0;
  const BEAMS = []; // ceiling beams: [x, z0, z1], so the plaster under them can be darkened
  const bake = (x, y, z, nx, ny, nz) => {
    const sx = x + nx * 0.12;
    const sz = z + nz * 0.12;
    const an0 = areaOfTile(Math.floor(sx / T), Math.floor(sz / T));
    if (an0 >= 0) lastArea = an0;
    const t = TINT[lastArea];
    const oc = Math.floor((x - nx * 0.05) / T);
    const or = Math.floor((z - nz * 0.05) / T);
    let ao;
    if (Math.abs(ny) > 0.6) {
      const d = nearSolid(x, z, oc, or);
      ao = 1 - 0.62 * (1 - clamp(d / 1.15, 0, 1)) ** 2;
      if (ny < 0) { // ceiling: darker under beams and towards the walls
        for (let i = 0; i < BEAMS.length; i++) { const b = BEAMS[i]; if (z >= b[1] - 0.2 && z <= b[2] + 0.2) ao *= 1 - 0.45 * (1 - clamp(Math.abs(x - b[0]) / 1.1, 0, 1)) ** 2; }
        ao *= 0.95;
      } else if (y > 0.5) ao *= 0.8;
    } else {
      const d = nearSolid(sx, sz, oc, or);
      ao = 1 - 0.5 * (1 - clamp(d / 0.95, 0, 1)) ** 2;
      ao *= 0.42 + 0.58 * smooth(y / 1.9); // damp and grime climbing from the floor
      ao *= 1 - 0.28 * smooth((y - 2.9) / 0.5);
    }
    let R = t[0] * ao;
    let G = t[1] * ao;
    let B = t[2] * ao;
    const aoP = 0.55 + 0.45 * ao;
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      const dx = e.x - x;
      const dy = e.y - y;
      const dz = e.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= e.r * e.r) continue;
      const v = visAt(e, sx, sz);
      if (v < 0.003) continue;
      const d = Math.sqrt(d2);
      let f = 1 - d / e.r;
      f *= f;
      const ndl = d > 1e-4 ? (nx * dx + ny * dy + nz * dz) / d : 1;
      let w = f * e.k * (0.3 + 0.7 * Math.max(0, ndl)) * v * aoP;
      if (e.down) w *= 0.45 + 0.55 * clamp((e.y - y) / Math.max(d, 0.01) + 0.15, 0, 1);
      R += e.col[0] * w; G += e.col[1] * w; B += e.col[2] * w;
    }
    return [Math.min(3, R * GAIN), Math.min(3, G * GAIN), Math.min(3, B * GAIN)];
  };

  // ---- meshers, one per material ----
  const sway = Q.sway;
  const M = {
    brick: new Mesher(0.9, bake), paint: new Mesher(0.9, bake), stone: new Mesher(1.2, bake),
    flag: new Mesher(2.0, bake), floorboards: new Mesher(1.6, bake), carpet: new Mesher(1.6, bake), concrete: new Mesher(2.4, bake),
    plaster: new Mesher(2.0, bake), wood: new Mesher(1.6, bake), polish: new Mesher(1.6, bake),
    props: new Mesher(1, bake), metal: new Mesher(1, bake), glass: new Mesher(1, bake), hang: new Mesher(1, bake, sway),
    glow: new Mesher(1, null), gPend: new Mesher(1, null, sway), gBar: new Mesher(1, null, sway), gA: new Mesher(1, null, sway), gB: new Mesher(1, null, sway),
    neon: new Mesher(1, null), shaftS: new Mesher(1, null), shaftL: new Mesher(1, null),
  };
  const bb = (m, x0, y0, z0, x1, y1, z1, col, b = 0.04, floor = false) => (Q.bevel ? m.bbox(x0, y0, z0, x1, y1, z1, col, b, { floor }) : m.box(x0, y0, z0, x1, y1, z1, col));
  // Blender props: parts above this quality tier are left out. Returns false when the prop is not in the data, so the
  // caller can fall back to its procedural version. o: { y, yaw, s (number or [sx, sy, sz]), tint }.
  const propTier = Q.fine ? 2 : Q.detail ? 1 : 0;
  const propsPlaced = {};
  const placeProp = (name, x, z, o = {}) => {
    const d = Q.detail ? propData(name) : null; // the low tier keeps the cheaper procedural props
    if (!d) return false;
    const sc = Array.isArray(o.s) ? o.s : [o.s || 1, o.s || 1, o.s || 1];
    propsPlaced[name] = (propsPlaced[name] || 0) + 1;
    for (const pt of d.parts) {
      const m = M[pt.m];
      if (pt.q <= propTier && m) m.part(pt, x, o.y || 0, z, o.yaw || 0, sc, o.tint);
    }
    return true;
  };
  const hasProp = (name) => Q.detail && propData(name) !== null;
  if (D) D.init({ THREE, M, bb, obox, disc, annulus, ribbon, patch, frame, Mesher, C, glowc, mul, rgb, jit, clamp, WALL_H, T, faces, sub, raycast, placeProp, hasProp });

  // ---- walls: every visible tile face, subdivided where the baked occlusion and light change fastest ----
  const hw = T / 2;
  const U_FINE = [0, 0.25, 0.75, 1];
  const U_COARSE = [0, 0.5, 1];
  const rowsFor = (y0, y1) => {
    const ys = [y0];
    for (const y of WALL_YS) if (y > y0 + 0.05 && y < y1 - 0.05 && (Q.fine || y === 0.8 || y === 2.5)) ys.push(y);
    ys.push(y1);
    return ys.map((y) => (y - y0) / (y1 - y0));
  };
  for (const f of faces) {
    const st = WALL_STYLE[f.id];
    let upper = st.upper;
    let ut = st.ut;
    if (D) { const v = D.wallVariant(f, st); if (v) { upper = v[0]; ut = v[1]; } }
    if (f.id === 'dancefloor' && f.h % 6 === 0) { upper = 'paint'; ut = [0.2, 0.17, 0.18]; } // painted over black
    if (f.id === 'cloakroom' && f.h % 8 === 0) { upper = 'paint'; ut = [0.95, 0.88, 0.74]; }
    if (f.id === 'bar' && f.h % 9 === 0) { upper = 'paint'; ut = [0.7, 0.55, 0.4]; }
    const segs = st.dado > 0 ? [[0, st.dado, st.dmesh, st.dt], [st.dado, WALL_H, upper, ut]] : [[0, WALL_H, upper, ut]];
    for (const [y0, y1, mesh, col] of segs) {
      const m = M[mesh];
      m.swap = mesh === 'wood'; // vertical boarding
      const jc = (i, j) => { // smooth per-vertex tone drift, so one texture does not read as one tile
        const q = hash(f.h + i * 131, j * 17 + Math.round(y0 * 10), 5);
        const k = jit(q, 0.12);
        return [col[0] * k, col[1] * k * jit(q >>> 5, 0.04), col[2] * k];
      };
      m.grid(f.f.p(-hw, y0, 0), f.f.p(hw, y0, 0), f.f.p(-hw, y1, 0), Q.fine ? U_FINE : U_COARSE, rowsFor(y0, y1), jc, f.f.n);
      m.swap = false;
    }
    obox(M.wood, f.f, -hw, hw, 0, 0.16, 0, 0.04, [0.3, 0.22, 0.16], { bottom: false });
    if (st.dado > 0) obox(M.wood, f.f, -hw, hw, st.dado - 0.02, st.dado + 0.06, 0, 0.07, [0.34, 0.24, 0.16], { bottom: false });
  }

  // timber beams across the rooms: planned now so the plaster under them can be baked darker
  const beamBoxes = [];
  if (COW) for (const an of [1, 2, 3, 5]) {
    const a = areas[an];
    for (let c = a.rect.c0 + 2; c <= a.rect.c1; c += 4) {
      let start = -1;
      for (let r = a.rect.r0; r <= a.rect.r1 + 1; r++) {
        const open = r <= a.rect.r1 && at(c, r) !== WALL && at(c, r) !== DOOR && areaOfTile(c, r) === an;
        if (open && start < 0) start = r;
        if (!open && start >= 0) {
          beamBoxes.push([(c + 0.5) * T, start * T, r * T]);
          BEAMS.push([(c + 0.5) * T, start * T, r * T]);
          start = -1;
        }
      }
    }
  }
  const VIP_RIBS = [7, 12, 17, 22, 27];

  // ---- floors and ceilings ----
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (at(c, r) === WALL) continue;
      const an = areaOfTile(c, r);
      if (an < 0) continue;
      const id = aid(an);
      const fm = M[FLOOR_STYLE[id]];
      const ft = FLOOR_TINT[id];
      const x0 = c * T;
      const z0 = r * T;
      const sol = (dc, dr) => solidW(c + dc, r + dr) > 0;
      const us = [0, 0.5, 1];
      const vs = [0, 0.5, 1];
      if (Q.fine) { // extra lines next to walls and props, where the occlusion gradient lives
        if (sol(-1, 0)) us.splice(1, 0, 0.2);
        if (sol(1, 0)) us.splice(us.length - 1, 0, 0.8);
        if (sol(0, -1)) vs.splice(1, 0, 0.2);
        if (sol(0, 1)) vs.splice(vs.length - 1, 0, 0.8);
      }
      const colf = (i, j, p) => { const k = jit(hash(Math.round(p[0] * 4), Math.round(p[2] * 4), 5), 0.07); return [ft[0] * k, ft[1] * k, ft[2] * k]; };
      // dark level: the baked pools are the lighting, so the floor samples them finer (the ceiling keeps the coarse grid)
      // (only where a light pool reaches this tile: between the torches the coarse grid carries everything there is to see)
      const pooled = D && E.some((e) => Math.hypot((c + 0.5) * T - e.x, (r + 0.5) * T - e.z) < e.r + 1.5);
      const fus = Q.fine && pooled ? [...us, 0.25, 0.75].sort((a, b) => a - b) : us;
      const fvs = Q.fine && pooled ? [...vs, 0.25, 0.75].sort((a, b) => a - b) : vs;
      fm.grid([x0, 0, z0], [x0 + T, 0, z0], [x0, 0, z0 + T], fus, fvs, colf, [0, 1, 0]);
      const cj = (i, j, p) => { const k = jit(hash(Math.round(p[0] * 4), Math.round(p[2] * 4), 9), 0.08); return [0.9 * k, 0.82 * k, 0.74 * k]; };
      if (!(D && D.ceilingTile(c, r, an, cj))) M.plaster.grid([x0, WALL_H, z0], [x0 + T, WALL_H, z0], [x0, WALL_H, z0 + T], Q.detail ? us : [0, 1], Q.detail ? vs : [0, 1], cj, [0, -1, 0]);
    }
  }

  // ---- stone arches over every doorway, and the doors themselves ----
  const SPRING = 2.45;
  const doorLeaves = [];
  const lampM = new Mesher(1, null); // all door indicator lamps in one mesh, recoloured when a door unlocks
  const lampRanges = [];
  doors.forEach((d, i) => {
    const span = d.axis === 'x' ? [1, 0] : [0, 1];
    const nrm = d.axis === 'x' ? [0, 1] : [1, 0];
    const half = 2;
    const th = 0.5;
    const rise = WALL_H - SPRING;
    const N = Q.fine ? 14 : 8;
    const P = (a, y, dd) => [d.x + span[0] * a + nrm[0] * dd, y, d.z + span[1] * a + nrm[1] * dd];
    for (const side of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= N; k++) {
        const a = side * half * (1 - k / N);
        pts.push([a, SPRING + rise * Math.sqrt(Math.max(0, 1 - (a / half) ** 2))]);
      }
      for (let k = 0; k < N; k++) {
        const [a0, y0] = pts[k];
        const [a1, y1] = pts[k + 1];
        const jj = [0.92, 0.88, 0.8];
        M.stone.tri(P(side * half, WALL_H, th), P(a0, y0, th), P(a1, y1, th), jj, nrm);
        M.stone.tri(P(side * half, WALL_H, -th), P(a0, y0, -th), P(a1, y1, -th), jj, [-nrm[0], 0, -nrm[1]]);
        const mx = (a0 + a1) / 2;
        const my = (y0 + y1) / 2;
        M.stone.quad(P(a0, y0, -th), P(a1, y1, -th), P(a1, y1, th), P(a0, y0, th), [0.85, 0.8, 0.72], [span[0] * -mx, SPRING - my, span[1] * -mx]);
      }
    }
    for (const sg of [1, -1]) { // keystone and a moulded arch ring on both faces
      const kf = frame(d.x + nrm[0] * th * sg, d.z + nrm[1] * th * sg, nrm[0] * sg, nrm[1] * sg);
      obox(M.stone, kf, -0.24, 0.24, WALL_H - 0.55, WALL_H, 0, 0.07, [1, 0.96, 0.88], { bottom: false });
      for (let k = 0; k < 8; k++) {
        const t0 = (k / 8) * Math.PI;
        const t1 = ((k + 1) / 8) * Math.PI;
        const e = (t, rr) => kf.p(Math.cos(t) * rr, SPRING + rise * Math.sin(t) * (rr / half), 0.03);
        if (k % 2 === 0) M.stone.quad(e(t0, 1.78), e(t0, 2.0), e(t1, 2.0), e(t1, 1.78), [1, 0.95, 0.86], kf.n);
      }
    }

    // the leaf: vertical timber planks with iron straps and rivets, built around its own origin
    const lm = new Mesher(1.6, null);
    const lf = frame(0, 0, nrm[0], nrm[1]);
    lm.swap = true;
    for (let pk = 0; pk < 8; pk++) {
      const u0 = -1.95 + pk * 0.4875;
      const kk = 0.85 + 0.3 * ihash(i, pk, 77);
      obox(lm, lf, u0 + 0.01, u0 + 0.4775, 0, WALL_H, -0.25, 0.25, [0.8 * kk, 0.56 * kk, 0.36 * kk], { back: true });
    }
    lm.swap = false;
    for (const y of [0.45, 1.65, 2.85]) {
      obox(lm, lf, -1.95, 1.95, y, y + 0.2, -0.28, 0.28, [0.09, 0.09, 0.1], { back: true, bottom: true });
      if (Q.detail) for (let rv = 0; rv < 9; rv++) for (const sg of [-1, 1]) obox(lm, lf, -1.8 + rv * 0.45 - 0.035, -1.8 + rv * 0.45 + 0.035, y + 0.07, y + 0.13, sg > 0 ? 0.28 : -0.31, sg > 0 ? 0.31 : -0.28, [0.3, 0.3, 0.32], { back: true });
    }
    for (const sg of [-1, 1]) obox(lm, lf, sg * 0.35 - 0.05, sg * 0.35 + 0.05, 1.0, 1.55, 0.25, 0.4, [0.7, 0.5, 0.18], { back: true });
    doorLeaves.push({ mesh: lm, i });

    // indicator lamps either side, in a cage; HDR red while locked, green once the area is clear
    const a0 = lampM.pos.length / 3;
    for (const sg of [-1, 1]) {
      const g = frame(d.x + nrm[0] * sg * 0.95, d.z + nrm[1] * sg * 0.95, nrm[0] * sg, nrm[1] * sg);
      obox(lampM, g, -0.16, 0.16, 3.0, 3.22, -0.06, 0.08, [0.04, 0.04, 0.045], { back: true });
    }
    const aMid = lampM.pos.length / 3;
    for (const sg of [-1, 1]) {
      const g = frame(d.x + nrm[0] * sg * 0.95, d.z + nrm[1] * sg * 0.95, nrm[0] * sg, nrm[1] * sg);
      obox(lampM, g, -0.1, 0.1, 3.05, 3.17, 0.0, 0.1, [1, 1, 1], { back: true });
    }
    lampRanges.push([aMid, lampM.pos.length / 3, a0]);
  });

  // ---- props, one tile at a time ----
  const done = new Set();
  const scanBox = (ch, c0, r0) => {
    let c1 = c0;
    let r1 = r0;
    while (sub[r0 * COLS + c1 + 1] === ch) c1++;
    while (sub[(r1 + 1) * COLS + c0] === ch) r1++;
    return [c0, r0, c1, r1];
  };
  const patternCols = [[0.26, 0.2, 0.3], [0.22, 0.14, 0.12], [0.32, 0.3, 0.22], [0.12, 0.14, 0.2], [0.34, 0.12, 0.14], [0.18, 0.2, 0.16], [0.4, 0.34, 0.26]];
  const BOTTLE = [[0.28, 0.15, 0.04], [0.05, 0.2, 0.09], [0.55, 0.55, 0.5], [0.22, 0.07, 0.05], [0.4, 0.27, 0.07], [0.04, 0.1, 0.2]];
  const bottle = (x, y, z, h, col) => { // glass bottle: body, shoulder, neck
    const bs = Q.detail ? 7 : 5;
    M.glass.frustum(x, z, 0.045, 0.045, y, y + h * 0.55, bs, col);
    M.glass.frustum(x, z, 0.045, 0.018, y + h * 0.55, y + h * 0.75, bs, col, false);
    M.glass.frustum(x, z, 0.018, 0.018, y + h * 0.75, y + h, 5, col);
  };
  // Level 1's props from the Blender kit (scripts/blender/props.py). Each case returns false when its model is missing from
  // the data, and the procedural version below runs instead. Models stand inside their tile, so collision is unchanged.
  const quarter = (h, n = 4) => ((h >>> 5) % n) * (Math.PI * 2 / n);
  const cowProp = (ch, c, r, cx, cz, id, h) => {
    if (ch === 'P') return placeProp('pillar', cx, cz);
    if (ch === 'S') { // speaker stacks face the middle of the dancefloor
      const fx = 17.5 * T - cx;
      const fz = 30.5 * T - cz;
      const [nx, nz] = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
      return placeProp('speaker', cx, cz, { yaw: Math.atan2(nx, nz) });
    }
    if (ch === 'o') return placeProp('table', cx, cz, { yaw: ((h >>> 4) % 628) / 100 });
    if (ch === 'r') return placeProp(id === 'backstage' ? 'rail_b' : 'rail_a', cx, cz);
    if (ch === 'b') {
      if (!placeProp('bar', cx, cz)) return false;
      const n = h % 4; // bottles, glasses and the odd beer tap on the polished top (customer side is +z)
      for (let b = 0; b < n; b++) {
        const bx = cx - 0.7 + ihash(c, r, 20 + b) * 1.4;
        const bz = cz + 0.25 + ihash(c, r, 30 + b) * 0.6;
        if (b % 2 === 0) bottle(bx, 1.12, bz, 0.4, BOTTLE[(h + b) % BOTTLE.length]);
        else { M.glass.frustum(bx, bz, 0.04, 0.05, 1.12, 1.28, 8, [0.65, 0.65, 0.6]); M.glass.frustum(bx, bz, 0.04, 0.04, 1.12, 1.19, 8, [0.5, 0.3, 0.06], false); }
      }
      if (h % 6 === 0) { M.metal.box(cx - 0.12, 1.12, cz + 0.55, cx + 0.12, 1.42, cz + 0.7, C.chrome); M.metal.box(cx - 0.03, 1.12, cz + 0.35, cx + 0.03, 1.57, cz + 0.55, C.chrome); }
      return true;
    }
    if (ch === 'v') {
      for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (at(c + nx, r + nz) === WALL) return placeProp('booth', cx, cz, { yaw: Math.atan2(-nx, -nz) });
      }
      return false;
    }
    if (ch === 'x') {
      const yaw = quarter(h);
      if (id === 'stairwell' || id === 'cloakroom') return placeProp(h % 2 ? 'crate_a' : 'crate_b', cx, cz, { yaw });
      if (id === 'bar') return placeProp('barrel_c', cx, cz, { yaw: ((h >>> 4) % 628) / 100 });
      return placeProp(['flight_a', 'flight_b', 'flight_c', 'flight_b'][h % 4], cx, cz, { yaw: yaw % Math.PI });
    }
    return false;
  };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = sub[r * COLS + c];
      const k = at(c, r);
      if (k === FLOOR || k === WALL || k === DOOR) continue;
      if (D) { D.prop(ch, c, r, k); continue; }
      const cx = (c + 0.5) * T;
      const cz = (r + 0.5) * T;
      const an = areaOfTile(c, r);
      const id = aid(an);
      const h = hash(c, r, 17);
      if (cowProp(ch, c, r, cx, cz, id, h)) continue;
      if (ch === 'P') {
        M.brick.box(cx - 0.85, 0.3, cz - 0.85, cx + 0.85, WALL_H - 0.25, cz + 0.85, [0.9, 0.78, 0.74]);
        bb(M.stone, cx - 1, 0, cz - 1, cx + 1, 0.34, cz + 1, [0.9, 0.86, 0.8], 0.06, true);
        bb(M.stone, cx - 1, WALL_H - 0.28, cz - 1, cx + 1, WALL_H, cz + 1, [0.9, 0.86, 0.8], 0.06);
        bb(M.stone, cx - 0.92, 0.34, cz - 0.92, cx + 0.92, 0.46, cz + 0.92, [0.88, 0.84, 0.78], 0.03);
      } else if (ch === 'S') {
        for (const [y0, y1] of [[0, 0.95], [0.95, 1.9], [1.9, 2.8]]) bb(M.props, cx - 0.95, y0 + 0.01, cz - 0.95, cx + 0.95, y1 - 0.01, cz + 0.95, [0.07, 0.07, 0.075], 0.05, y0 === 0);
        for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nk = at(c + nx, r + nz);
          if (nk === WALL || nk === SPEAKER || nk === PILLAR || nk === STAIRS) continue;
          const f = frame(cx + nx * 0.95, cz + nz * 0.95, nx, nz);
          for (const yy of [0.5, 1.45]) {
            disc(M.props, f, 0, yy, 0.012, 0.43, 14, [0.02, 0.02, 0.022]);
            annulus(M.metal, f, 0, yy, 0.02, 0.3, 0.4, 14, [0.32, 0.32, 0.34]);
            annulus(M.props, f, 0, yy, 0.03, 0.12, 0.3, 14, [0.07, 0.07, 0.075]);
            disc(M.props, f, 0, yy, 0.06, 0.1, 10, [0.12, 0.12, 0.125]);
          }
          obox(M.props, f, -0.7, 0.7, 2.0, 2.65, 0, 0.1, [0.045, 0.045, 0.05], { bottom: false });
          for (const u of [-0.35, 0.35]) { disc(M.props, f, u, 2.33, 0.115, 0.17, 10, [0.02, 0.02, 0.022]); annulus(M.metal, f, u, 2.33, 0.125, 0.1, 0.17, 10, [0.4, 0.4, 0.42]); }
          for (const yy of [0.96, 1.92]) obox(M.metal, f, -0.95, 0.95, yy - 0.02, yy + 0.02, 0, 0.03, [0.3, 0.3, 0.32], { bottom: false });
          obox(M.metal, f, -0.14, 0.14, 1.0, 1.08, 0.0, 0.07, C.steel, { bottom: false }); // handle
          for (const sx of [-0.85, 0.85]) for (const yy of [0.12, 2.68]) obox(M.metal, f, sx - 0.07, sx + 0.07, yy - 0.07, yy + 0.07, 0, 0.05, C.steel, { bottom: false }); // corners
        }
      } else if (ch === 'b') {
        bb(M.wood, cx - 0.9, 0, cz - 0.9, cx + 0.9, 1.0, cz + 0.9, [0.4, 0.27, 0.18], 0.035, true);
        bb(M.polish, cx - 1.0, 1.0, cz - 1.0, cx + 1.0, 1.1, cz + 1.0, [0.8, 0.58, 0.38], 0.04);
        M.metal.pipe('x', cx - 1, cx + 1, 0.2, cz + 1.0 + 0.12, 0.035, 8, C.brass);
        for (const sx of [-0.9, 0.9]) M.metal.box(cx + sx - 0.025, 0.12, cz + 1.0 + 0.06, cx + sx + 0.025, 0.28, cz + 1.0 + 0.14, C.brass);
        const n = h % 4;
        for (let b = 0; b < n; b++) {
          const bx = cx - 0.7 + ihash(c, r, 20 + b) * 1.4;
          const bz = cz - 0.5 + ihash(c, r, 30 + b) * 1.0;
          if (b % 2 === 0) bottle(bx, 1.1, bz, 0.4, BOTTLE[(h + b) % BOTTLE.length]);
          else { M.glass.frustum(bx, bz, 0.04, 0.05, 1.1, 1.26, 8, [0.65, 0.65, 0.6]); M.glass.frustum(bx, bz, 0.04, 0.04, 1.1, 1.17, 8, [0.5, 0.3, 0.06], false); } // a glass
        }
        if (h % 6 === 0) { M.metal.box(cx - 0.12, 1.1, cz + 0.4, cx + 0.12, 1.4, cz + 0.55, C.chrome); M.metal.box(cx - 0.03, 1.1, cz + 0.2, cx + 0.03, 1.55, cz + 0.4, C.chrome); } // a beer tap
      } else if (ch === 'j') {
        if (done.has('j')) continue;
        done.add('j');
        const [c0, r0, c1, r1] = scanBox('j', c, r);
        const x0 = c0 * T + 0.05;
        const x1 = (c1 + 1) * T - 0.05;
        const z0 = r0 * T + 0.05;
        const z1 = (r1 + 1) * T - 0.05;
        bb(M.props, x0, 0, z0, x1, 1.1, z1, [0.08, 0.065, 0.06], 0.05, true);
        bb(M.polish, x0 - 0.05, 1.1, z0 - 0.05, x1 + 0.05, 1.18, z1 + 0.05, [0.4, 0.26, 0.17], 0.04);
        const f = frame((x0 + x1) / 2, z1, 0, 1);
        const W = (x1 - x0) / 2;
        for (let s = 0; s < 14; s++) { // old stickers on the front
          const u = -W + 0.4 + ihash(s, 1, 61) * (2 * W - 0.8);
          const y = 0.25 + ihash(s, 2, 61) * 0.6;
          const sc = [[0.7, 0.1, 0.1], [0.8, 0.75, 0.55], [0.85, 0.7, 0.1], [0.1, 0.4, 0.45], [0.25, 0.25, 0.28]][s % 5];
          obox(M.props, f, u, u + 0.25 + ihash(s, 3, 61) * 0.3, y, y + 0.18 + ihash(s, 4, 61) * 0.25, 0, 0.012, sc, { bottom: false });
        }
        const cxm = (x0 + x1) / 2;
        const zm = (z0 + z1) / 2;
        for (const dx of [-4.1, 4.1]) { // turntables
          bb(M.props, cxm + dx - 0.6, 1.18, zm - 0.42, cxm + dx + 0.6, 1.3, zm + 0.42, [0.1, 0.1, 0.11], 0.03);
          M.metal.frustum(cxm + dx - 0.08, zm, 0.31, 0.31, 1.3, 1.325, 18, C.steel);
          M.props.frustum(cxm + dx - 0.08, zm, 0.29, 0.29, 1.325, 1.34, 18, [0.015, 0.015, 0.02]);
          M.props.frustum(cxm + dx - 0.08, zm, 0.09, 0.09, 1.34, 1.35, 10, [0.6, 0.12, 0.1]);
          M.metal.box(cxm + dx + 0.4, 1.3, zm - 0.33, cxm + dx + 0.44, 1.37, zm + 0.1, C.chrome);
          M.metal.tube([cxm + dx + 0.42, 1.37, zm - 0.3], [cxm + dx + 0.12, 1.36, zm + 0.0], 0.012, C.chrome);
        }
        bb(M.props, cxm - 0.62, 1.18, zm - 0.32, cxm + 0.62, 1.31, zm + 0.32, [0.07, 0.07, 0.08], 0.03);
        for (let k2 = 0; k2 < 6; k2++) M.metal.frustum(cxm - 0.5 + k2 * 0.2, zm - 0.15, 0.03, 0.03, 1.31, 1.35, 6, C.steel);
        for (let k2 = 0; k2 < 2; k2++) M.props.box(cxm - 0.35 + k2 * 0.55, 1.31, zm + 0.06, cxm - 0.25 + k2 * 0.55, 1.34, zm + 0.26, [0.7, 0.55, 0.1]);
        bb(M.props, cxm + 1.2, 1.18, zm - 0.3, cxm + 2.05, 1.21, zm + 0.2, [0.12, 0.12, 0.13], 0.01);
        M.props.box(cxm + 1.2, 1.21, zm - 0.3, cxm + 2.05, 1.62, zm - 0.27, [0.1, 0.1, 0.11]);
        M.glow.box(cxm + 1.24, 1.24, zm - 0.268, cxm + 2.01, 1.58, zm - 0.262, glowc(0x6a9fd0, 1.6));
        bottle(cxm - 2.3, 1.18, zm + 0.5, 0.42, [0.4, 0.27, 0.07]);
        for (const sx of [-1, 1]) { // studio monitors on the corners
          bb(M.props, cxm + sx * 6.9 - 0.3, 1.18, zm - 0.3, cxm + sx * 6.9 + 0.3, 1.78, zm + 0.3, [0.06, 0.06, 0.065], 0.04);
          const mf = frame(cxm + sx * 6.9, zm + 0.3, 0, 1);
          disc(M.props, mf, 0, 1.4, 0.005, 0.2, 12, [0.02, 0.02, 0.022]);
          annulus(M.metal, mf, 0, 1.4, 0.01, 0.12, 0.2, 12, [0.4, 0.4, 0.42]);
          disc(M.props, mf, 0, 1.68, 0.005, 0.06, 8, [0.02, 0.02, 0.022]);
        }
        for (let k2 = 0; k2 < 4; k2++) bb(M.props, x1 + 0.1, 0, z1 - 1.5 + k2 * 0.35 - 0.3, x1 + 0.55, 0.38, z1 - 1.5 + k2 * 0.35 + 0.0, [0.1 + 0.05 * k2, 0.08, 0.07], 0.01, true); // a stack of record sleeves
      } else if (ch === 'v') {
        const col = [0.3, 0.06, 0.08];
        bb(M.props, cx - 0.95, 0, cz - 0.95, cx + 0.95, 0.5, cz + 0.95, col, 0.07, true);
        bb(M.props, cx - 0.9, 0.5, cz - 0.9, cx + 0.9, 0.62, cz + 0.9, [0.38, 0.08, 0.1], 0.05);
        for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          if (at(c + nx, r + nz) !== WALL) continue;
          const f = frame(cx + nx * 0.5, cz + nz * 0.5, -nx, -nz);
          const bx = nx !== 0 ? [cx + nx * 0.5 - 0.45, cx + nx * 0.5 + 0.45] : null;
          void bx;
          obox(M.props, f, -0.95, 0.95, 0.5, 1.3, -0.45, 0.45, col, { bottom: false });
          obox(M.metal, f, -0.95, 0.95, 1.3, 1.35, -0.46, 0.46, C.brass, { bottom: false });
          if (Q.detail) for (let bt = 0; bt < 5; bt++) for (let bj = 0; bj < 3; bj++) disc(M.metal, f, -0.72 + bt * 0.36, 0.72 + bj * 0.24, 0.452 - 0.9 + 0.9, 0.025, 6, C.brass); // buttoned leather
          break;
        }
      } else if (ch === 'x') {
        if (id === 'stairwell' || id === 'cloakroom') {
          const hh = 0.9 + (h % 5) * 0.08;
          bb(M.wood, cx - 0.8, 0, cz - 0.75, cx + 0.8, hh, cz + 0.75, [0.58, 0.44, 0.28], 0.035, true);
          for (const y of [hh * 0.28, hh * 0.72]) bb(M.metal, cx - 0.82, y, cz - 0.77, cx + 0.82, y + 0.07, cz + 0.77, C.iron, 0.01);
        } else if (id === 'bar') {
          for (const [r0, r1, y0, y1] of [[0.62, 0.78, 0, 0.5], [0.78, 0.62, 0.5, 1.02]]) M.wood.frustum(cx, cz, r0, r1, y0, y1, 14, [0.5, 0.36, 0.23], y1 > 1);
          for (const [y, rr] of [[0.14, 0.7], [0.5, 0.79], [0.88, 0.7]]) M.metal.frustum(cx, cz, rr + 0.02, rr + 0.02, y, y + 0.07, 14, C.iron, false);
          M.metal.frustum(cx, cz, 0.06, 0.06, 1.02, 1.1, 6, C.brass);
        } else {
          const hh = 0.85 + (h % 4) * 0.12;
          bb(M.props, cx - 0.85, 0, cz - 0.7, cx + 0.85, hh, cz + 0.7, [0.05, 0.05, 0.055], 0.04, true);
          for (const [ex, ez] of [[-0.85, -0.7], [0.85, -0.7], [-0.85, 0.7], [0.85, 0.7]]) M.metal.box(cx + ex - 0.05, 0, cz + ez - 0.05, cx + ex + 0.05, hh, cz + ez + 0.05, C.steel);
          M.metal.box(cx - 0.87, hh - 0.05, cz - 0.72, cx + 0.87, hh, cz + 0.72, C.steel);
          M.metal.box(cx - 0.3, hh * 0.5 - 0.06, cz + 0.7, cx - 0.1, hh * 0.5 + 0.06, cz + 0.76, C.chrome); // latch
          const sc = patternCols[h % patternCols.length];
          M.props.box(cx + 0.1, 0.3, cz + 0.7, cx + 0.6, 0.55, cz + 0.712, sc);
        }
      } else if (ch === 'r') {
        const costume = id === 'backstage';
        const cols = costume ? [[0.6, 0.12, 0.2], [0.75, 0.62, 0.15], [0.12, 0.35, 0.45], [0.5, 0.2, 0.55], [0.8, 0.8, 0.78]] : [[0.1, 0.1, 0.14], [0.22, 0.17, 0.12], [0.3, 0.3, 0.32], [0.16, 0.08, 0.1], [0.12, 0.2, 0.16], [0.35, 0.28, 0.2]];
        for (const sx of [-0.85, 0.85]) M.metal.box(cx + sx - 0.035, 0, cz - 0.035, cx + sx + 0.035, 1.55, cz + 0.035, C.iron);
        M.metal.pipe('x', cx - 0.9, cx + 0.9, 1.52, cz, 0.03, 8, C.steel);
        M.metal.box(cx - 0.92, 0.0, cz - 0.55, cx - 0.84, 0.05, cz + 0.55, C.iron);
        M.metal.box(cx + 0.84, 0.0, cz - 0.55, cx + 0.92, 0.05, cz + 0.55, C.iron);
        for (let k2 = 0; k2 < 6; k2++) {
          const x = cx - 0.72 + k2 * 0.29;
          const len = 0.8 + ihash(c * 8 + k2, r, 70) * 0.35;
          bb(M.props, x - 0.13, 1.5 - len, cz - 0.11, x + 0.13, 1.45, cz + 0.11, cols[(h + k2) % cols.length], 0.05);
          M.metal.tube([x - 0.12, 1.45, cz], [x, 1.55, cz], 0.012, C.steel);
          M.metal.tube([x + 0.12, 1.45, cz], [x, 1.55, cz], 0.012, C.steel);
        }
      } else if (ch === 'o') {
        M.metal.frustum(cx, cz, 0.1, 0.1, 0, 0.8, 8, C.iron);
        M.polish.frustum(cx, cz, 0.54, 0.54, 0.78, 0.86, 16, [0.66, 0.48, 0.3]);
        M.metal.frustum(cx, cz, 0.32, 0.32, 0, 0.04, 10, C.iron);
        M.glass.frustum(cx + 0.18, cz - 0.12, 0.05, 0.04, 0.86, 1.0, 8, [0.6, 0.6, 0.55]);
        M.gPend.frustum(cx - 0.12, cz + 0.05, 0.03, 0.03, 0.86, 0.94, 6, glowc(0xffa040, 3));
        for (let s = 0; s < 3; s++) {
          const a = (s / 3) * Math.PI * 2 + (h % 7) * 0.2;
          const sx = cx + Math.cos(a) * 0.76;
          const sz = cz + Math.sin(a) * 0.76;
          M.metal.frustum(sx, sz, 0.05, 0.05, 0, 0.55, 6, C.iron, false);
          bb(M.props, sx - 0.2, 0.55, sz - 0.2, sx + 0.2, 0.66, sz + 0.2, [0.32, 0.06, 0.08], 0.04);
        }
      } else if (ch === 'T') {
        if (done.has('T')) continue;
        done.add('T');
        const [c0, r0, c1, r1] = scanBox('T', c, r);
        const x0 = c0 * T;
        const x1 = (c1 + 1) * T;
        const z1 = (r1 + 1) * T; // foot of the steps
        const zTop = r0 * T + 1.2;
        const n = 6;
        for (let s = 0; s < n; s++) {
          const za = z1 - ((s + 1) * (z1 - zTop)) / n;
          bb(M.stone, x0, 0, za, x1, (s + 1) * 0.3, z1, [0.92, 0.88, 0.82], 0.03, true);
        }
        bb(M.stone, x0, 0, r0 * T, x1, n * 0.3, zTop, [0.9, 0.86, 0.8], 0.03, true); // landing
        M.metal.tube([x1 - 0.1, 0.95, z1 - 0.1], [x1 - 0.1, n * 0.3 + 0.95, zTop], 0.035, C.iron, 6);
        for (const [zz, yy] of [[z1 - 0.1, 0], [zTop, n * 0.3]]) M.metal.box(x1 - 0.13, yy, zz - 0.03, x1 - 0.07, yy + 0.95, zz + 0.03, C.iron);
        // the street door at the top: cold light spilling down the steps
        const f = frame((x0 + x1) / 2, r0 * T, 0, 1);
        M.glow.grid(f.p(-1.3, n * 0.3, 0.02), f.p(1.3, n * 0.3, 0.02), f.p(-1.3, n * 0.3 + 1.9, 0.02), [0, 1], [0, 1], glowc(0x8aa8e0, 2.2), f.n);
        obox(M.stone, f, -1.5, -1.3, n * 0.3, n * 0.3 + 2.0, 0, 0.12, [0.9, 0.86, 0.8], { bottom: false });
        obox(M.stone, f, 1.3, 1.5, n * 0.3, n * 0.3 + 2.0, 0, 0.12, [0.9, 0.86, 0.8], { bottom: false });
        obox(M.stone, f, -1.5, 1.5, n * 0.3 + 1.9, n * 0.3 + 2.05, 0, 0.12, [0.9, 0.86, 0.8], { bottom: false });
      }
    }
  }

  // ---- ceilings: timber beams, brick ribs in the VIP, iron pipes ----
  const STEAM = COW ? [[44, 3.1, 3.5, 0, 1], [12.5, 3.1, 81.9, 0, 1]] : [];
  if (COW) {
  for (const [x, z0, z1] of beamBoxes) {
    bb(M.wood, x - 0.17, WALL_H - 0.36, z0, x + 0.17, WALL_H, z1, [0.4, 0.28, 0.18], 0.035);
    for (let z = z0 + 2; z < z1 - 1; z += 4) bb(M.metal, x - 0.2, WALL_H - 0.3, z - 0.07, x + 0.2, WALL_H - 0.22, z + 0.07, C.iron, 0.01); // iron strap
  }
  for (const c of VIP_RIBS) {
    const x = (c + 0.5) * T;
    const hz = 4;
    const mz = 9 * T + hz;
    const NR = Q.fine ? 14 : 8;
    for (let k = 0; k < NR; k++) {
      const ua = -hz + (2 * hz * k) / NR;
      const ub = -hz + (2 * hz * (k + 1)) / NR;
      const ya = 2.3 + 0.75 * Math.sqrt(Math.max(0, 1 - (ua / hz) ** 2));
      const yb = 2.3 + 0.75 * Math.sqrt(Math.max(0, 1 - (ub / hz) ** 2));
      const col = [0.8, 0.68, 0.64];
      for (const [sx, nx] of [[0.25, 1], [-0.25, -1]]) M.brick.quad([x + sx, ya, mz + ua], [x + sx, yb, mz + ub], [x + sx, WALL_H, mz + ub], [x + sx, WALL_H, mz + ua], col, [nx, 0, 0]);
      M.brick.quad([x - 0.25, ya, mz + ua], [x + 0.25, ya, mz + ua], [x + 0.25, yb, mz + ub], [x - 0.25, yb, mz + ub], col, [0, -1, 0]);
    }
  }
  const PIPES = [
    ['x', 8, 14, 3.2, 81.2], ['x', 17, 44, 3.2, 79.3], ['x', 3, 68, 3.22, 48.7], ['z', 49, 75, 3.22, 2.7],
    ['x', 3, 56, 3.22, 29.3], ['x', 9, 68, 3.2, 2.7], ['x', 9, 68, 3.0, 3.1], ['x', 3, 68, 3.05, 18.4],
  ];
  for (const [axis, a0, a1, y, cc] of PIPES) {
    M.metal.pipe(axis, a0, a1, y, cc, 0.07, Q.detail ? 10 : 6, C.rust);
    for (let a = a0 + 2; a < a1; a += 5) {
      if (Q.detail) M.metal.pipe(axis, a - 0.07, a + 0.07, y, cc, 0.1, 8, [0.3, 0.3, 0.32]); // flange
      if (axis === 'x') M.metal.box(a - 0.03, y, cc - 0.03, a + 0.03, WALL_H, cc + 0.03, C.iron);
      else M.metal.box(cc - 0.03, y, a - 0.03, cc + 0.03, WALL_H, a + 0.03, C.iron);
    }
  }
  // steam valves: a red wheel on the backstage and stairwell pipes (the steam itself is animated below)
  for (const [x, y, z] of STEAM) {
    M.metal.box(x - 0.1, y - 0.12, z - 0.5, x + 0.1, y + 0.08, z - 0.3, C.iron);
    M.metal.frustum(x, z - 0.52, 0.16, 0.16, y - 0.02, y + 0.0, 10, [0.55, 0.08, 0.06]);
  }

  // ---- lamps ----
  const chain = (x, z, y0, y1) => { if (!Q.detail) { M.hang.box(x - 0.012, y0, z - 0.012, x + 0.012, y1, z + 0.012, C.ironD); return; } for (let l = 0, y = y1; y > y0; y -= 0.075, l++) { if (l % 2) M.hang.box(x - 0.018, y - 0.07, z - 0.006, x + 0.018, y, z + 0.006, C.ironD); else M.hang.box(x - 0.006, y - 0.07, z - 0.018, x + 0.006, y, z + 0.018, C.ironD); } };
  const SHADES = [[0.1, 0.24, 0.16], [0.6, 0.55, 0.4], [0.07, 0.07, 0.08], [0.45, 0.1, 0.1]];
  const pendant = (c, r, gm, shade, hex) => {
    const x = c * T;
    const z = r * T;
    const y = 2.45;
    if (!placeProp('pendant', x, z, { y, tint: mul(shade, 1 / 0.9) })) { // chain, shade and brass rim: the model, else boxes and cones
      chain(x, z, y + 0.3, WALL_H);
      M.hang.frustum(x, z, 0.36, 0.08, y, y + 0.3, 12, shade, false);
      M.metal.frustum(x, z, 0.37, 0.37, y - 0.01, y + 0.02, 12, C.brass, false);
    }
    gm.frustum(x, z, 0.05, 0.05, y + 0.02, y + 0.12, 8, glowc(hex, 6), true);
    gm.tri([x - 0.3, y + 0.03, z], [x, y + 0.03, z + 0.3], [x + 0.3, y + 0.03, z], glowc(hex, 2.4), [0, -1, 0]);
    gm.tri([x - 0.3, y + 0.03, z], [x + 0.3, y + 0.03, z], [x, y + 0.03, z - 0.3], glowc(hex, 2.4), [0, -1, 0]);
    if (Q.shafts) { M.shaftL.cone([x, y + 0.02, z], 0.32, [x, 0.02, z], 1.35, 10, mul(rgb(hex), 0.035), [0, 0, 0]); M.shaftL.cone([x, y + 0.02, z], 0.18, [x, 0.02, z], 0.75, 10, mul(rgb(hex), 0.035), [0, 0, 0]); }
  };
  for (const [id, ps] of PENDANT) {
    ps.forEach(([c, r], i) => pendant(c, r, id === 'bar' ? M.gBar : M.gPend, id === 'vip' ? [0.4, 0.07, 0.1] : SHADES[(i + (id === 'bar' ? 1 : 0)) % SHADES.length], id === 'vip' ? 0xffa070 : 0xffb870));
  }
  for (const [id, ps] of BULBS) {
    const gm = id === 'stairwell' ? M.gA : M.gB;
    for (const [c, r] of ps) {
      const x = c * T;
      const z = r * T;
      M.hang.tube([x, WALL_H, z], [x, 2.62, z], 0.012, C.rubber, 4);
      M.hang.frustum(x, z, 0.035, 0.035, 2.55, 2.62, 8, C.iron);
      gm.frustum(x, z, 0.03, 0.065, 2.5, 2.55, 10, glowc(0xffe2a8, 5.5), false);
      gm.frustum(x, z, 0.065, 0.065, 2.43, 2.5, 10, glowc(0xffe2a8, 5.5), false);
      gm.frustum(x, z, 0.065, 0.0, 2.37, 2.43, 10, glowc(0xffe2a8, 5.5), false);
      if (Q.shafts) { M.shaftL.cone([x, 2.4, z], 0.12, [x, 0.02, z], 1.5, 10, mul(rgb(0xffd890), 0.022), [0, 0, 0]); M.shaftL.cone([x, 2.4, z], 0.07, [x, 0.02, z], 0.8, 10, mul(rgb(0xffd890), 0.022), [0, 0, 0]); }
    }
  }
  // stage rigs over the dancefloor
  for (const [z, x0, x1] of [[27.5, 8, 32], [36, 11, 29]]) {
    for (const dz of [-0.12, 0.12]) M.metal.pipe('x', x0 * T, x1 * T, 3.05, z * T + dz, 0.04, 8, C.steel);
    for (let x = x0 * T; x < x1 * T; x += 1.2) M.metal.tube([x, 3.05, z * T - 0.12], [x + 0.6, 3.15, z * T + 0.12], 0.012, C.steel);
    for (const sx of [x0 * T + 0.4, x1 * T - 0.4]) M.metal.box(sx - 0.03, 3.05, z * T - 0.03, sx + 0.03, WALL_H, z * T + 0.03, C.iron);
  }
  const canTargets = [];
  CANS.forEach(([c, r, red], i) => {
    const x = c * T;
    const z = r * T;
    M.props.frustum(x, z, 0.2, 0.15, 2.7, 3.05, 12, [0.05, 0.05, 0.055]);
    M.metal.frustum(x, z, 0.215, 0.215, 2.69, 2.73, 12, C.steel, false);
    M.metal.box(x - 0.22, 3.0, z - 0.03, x + 0.22, 3.06, z + 0.03, C.iron);
    M.glow.frustum(x, z, 0.14, 0.14, 2.68, 2.69, 12, glowc(red ? 0xff3018 : 0xff8a28, 4.5), true);
    const tx = x + (ihash(i, 1, 5) - 0.5) * 5;
    const tz = z + (ihash(i, 2, 5) - 0.5) * 5;
    canTargets.push([x, z, tx, tz, red]);
    if (Q.shafts) { const sc = mul(rgb(red ? 0xff2a14 : 0xff8420), 0.075); M.shaftS.cone([x, 2.66, z], 0.13, [tx, 0.02, tz], 1.25, 12, sc, [0, 0, 0]); M.shaftS.cone([x, 2.66, z], 0.08, [tx, 0.02, tz], 0.65, 12, sc, [0, 0, 0]); }
  });

  // ---- wall dressing ----
  const poster = (f, u, y, w, hgt, col) => {
    obox(M.props, f, u - w / 2 - 0.04, u + w / 2 + 0.04, y - 0.04, y + hgt + 0.04, 0, 0.012, [0.72, 0.68, 0.56], { bottom: false });
    obox(M.props, f, u - w / 2, u + w / 2, y, y + hgt, 0, 0.018, col, { bottom: false });
    obox(M.props, f, u - w / 2 + 0.06, u + w / 2 - 0.06, y + hgt * 0.55, y + hgt * 0.7, 0, 0.024, [0.85, 0.82, 0.7], { bottom: false });
    obox(M.props, f, u - w / 2 + 0.06, u + w / 2 - 0.06, y + 0.08, y + 0.2, 0, 0.024, [0.1, 0.1, 0.1], { bottom: false });
    if (Q.detail) for (const [pu, py] of [[-1, 1], [1, 1], [-1, 0], [1, 0]]) M.metal.box(u + pu * (w / 2 - 0.03) - 0.015, y + py * (hgt - 0.06) + 0.02, 0.02, u + pu * (w / 2 - 0.03) + 0.015, y + py * (hgt - 0.06) + 0.05, 0.03, C.steel); // drawing pins
  };
  const POSTER_COLS = [[0.65, 0.12, 0.1], [0.78, 0.6, 0.12], [0.1, 0.4, 0.45], [0.08, 0.08, 0.1], [0.55, 0.18, 0.4], [0.2, 0.3, 0.6]];
  const alcove = (f, w, mode, h) => {
    const spring = 1.5;
    const rise = 0.65;
    const N = Q.fine ? 12 : 8;
    const inner = [];
    const outer = [];
    for (let k = 0; k <= N; k++) {
      const th = Math.PI - (Math.PI * k) / N;
      inner.push([(w / 2) * Math.cos(th), spring + rise * Math.sin(th)]);
      outer.push([(w / 2 + 0.2) * Math.cos(th), spring + (rise + 0.2) * Math.sin(th)]);
    }
    const dark = mode === 'mirror' ? [0.62, 0.66, 0.7] : [0.05, 0.035, 0.03];
    const pm = mode === 'mirror' ? M.glass : M.props;
    pm.quad(f.p(-w / 2, 0.16, 0.012), f.p(w / 2, 0.16, 0.012), f.p(w / 2, spring, 0.012), f.p(-w / 2, spring, 0.012), dark, f.n);
    for (let k = 0; k < N; k++) {
      pm.tri(f.p(0, spring, 0.012), f.p(inner[k][0], inner[k][1], 0.012), f.p(inner[k + 1][0], inner[k + 1][1], 0.012), dark, f.n);
      M.stone.quad(f.p(inner[k][0], inner[k][1], 0.1), f.p(outer[k][0], outer[k][1], 0.1), f.p(outer[k + 1][0], outer[k + 1][1], 0.1), f.p(inner[k + 1][0], inner[k + 1][1], 0.1), [0.95, 0.9, 0.82], f.n);
      const mx = (inner[k][0] + inner[k + 1][0]) / 2;
      const my = (inner[k][1] + inner[k + 1][1]) / 2 - spring;
      M.stone.quad(f.p(inner[k][0], inner[k][1], 0.0), f.p(inner[k][0], inner[k][1], 0.1), f.p(inner[k + 1][0], inner[k + 1][1], 0.1), f.p(inner[k + 1][0], inner[k + 1][1], 0.0), [0.7, 0.66, 0.6], [-mx * f.t[0], -my, -mx * f.t[2]]);
    }
    obox(M.stone, f, -w / 2 - 0.2, -w / 2, 0, spring, 0, 0.1, [0.95, 0.9, 0.82], { bottom: false });
    obox(M.stone, f, w / 2, w / 2 + 0.2, 0, spring, 0, 0.1, [0.95, 0.9, 0.82], { bottom: false });
    obox(M.stone, f, -w / 2 - 0.2, w / 2 + 0.2, 0.12, 0.18, 0, 0.16, [0.9, 0.86, 0.78], { bottom: false }); // sill
    if (mode === 'shelves') {
      for (const y of [0.55, 1.0, 1.45]) {
        obox(M.wood, f, -w / 2, w / 2, y, y + 0.04, 0, 0.3, [0.5, 0.36, 0.22], { bottom: false });
        for (let b = 0; b < 4; b++) {
          const u = -w / 2 + 0.17 + b * 0.32;
          const bx = f.cx + f.t[0] * u + f.n[0] * 0.14;
          const bz = f.cz + f.t[2] * u + f.n[2] * 0.14;
          bottle(bx, y + 0.04, bz, 0.36 + ihash(h, b, y * 10) * 0.08, BOTTLE[(h + b + (y * 5 | 0)) % BOTTLE.length]);
        }
      }
      obox(M.glow, f, -w / 2 + 0.05, w / 2 - 0.05, 1.43, 1.45, 0.02, 0.3, glowc(0xffa848, 2.4), { bottom: true }); // the back-bar strip light
    } else if (mode === 'bulb') {
      M.glow.frustum(f.cx + f.n[0] * 0.2, f.cz + f.n[2] * 0.2, 0.04, 0.06, 1.1, 1.2, 8, glowc(0xff6a30, 5));
    } else if (mode === 'mirror') {
      obox(M.metal, f, -w / 2 + 0.02, w / 2 - 0.02, 0.28, 0.32, 0.02, 0.05, C.brass, { bottom: false });
    }
  };
  for (const fc of faces) {
    const what = plan.get(fc);
    if (!what) continue;
    const { h, f } = fc;
    if (what === 'alcove-shelves') alcove(f, 1.3, 'shelves', h);
    else if (what === 'alcove-bulb') alcove(f, 1.3, 'bulb', h);
    else if (what === 'alcove-mirror') alcove(f, 1.3, 'mirror', h);
    else if (what === 'banner') {
      obox(M.props, f, -0.8, 0.8, 1.5, 3.1, 0, 0.03, fc.c % 2 ? [0.4, 0.06, 0.07] : [0.12, 0.1, 0.16], { bottom: false });
      obox(M.metal, f, -0.84, 0.84, 3.06, 3.12, 0, 0.06, C.brass, { bottom: false });
    } else if (what === 'poster') poster(f, ((h >>> 4) % 5) * 0.2 - 0.4, 1.35 + ((h >>> 8) % 4) * 0.2, 0.7, 1.0, POSTER_COLS[h % POSTER_COLS.length]);
    else if (what === 'extinguisher') {
      M.props.frustum(f.p(0, 0, 0.12)[0], f.p(0, 0, 0.12)[2], 0.09, 0.09, 0.55, 1.05, 10, [0.6, 0.06, 0.05]);
      M.metal.frustum(f.p(0, 0, 0.12)[0], f.p(0, 0, 0.12)[2], 0.03, 0.03, 1.05, 1.14, 6, C.chrome);
      obox(M.metal, f, -0.12, 0.12, 0.62, 0.66, 0, 0.22, C.iron, { bottom: false });
    } else if (what === 'cables') {
      for (const [y, off] of [[2.2, 0], [2.32, 0.03]]) {
        let prev = null;
        for (let k = 0; k <= 8; k++) {
          const u = -0.95 + (1.9 * k) / 8;
          const sag = 0.14 * (1 - (2 * (k / 8) - 1) ** 2);
          const p = f.p(u, y - sag, 0.04 + off);
          if (prev) M.props.tube(prev, p, 0.016, C.rubber, 4);
          prev = p;
        }
        for (const u of [-0.95, 0.95]) obox(M.metal, f, u - 0.03, u + 0.03, y - 0.04, y + 0.04, 0, 0.05 + off, C.steel, { bottom: false });
      }
    } else if (what === 'vent' && Q.detail) {
      obox(M.metal, f, -0.38, 0.38, 2.05, 2.58, 0, 0.04, C.iron, { bottom: false });
      obox(M.props, f, -0.3, 0.3, 2.12, 2.5, 0.04, 0.045, [0.01, 0.01, 0.012], { bottom: false });
      for (let s = 0; s < 5; s++) obox(M.metal, f, -0.3, 0.3, 2.16 + s * 0.075, 2.2 + s * 0.075, 0.04, 0.09, C.steel, { bottom: false });
    } else if (what === 'sconce') {
      obox(M.metal, f, -0.07, 0.07, 1.6, 2.0, 0, 0.03, C.brass, { bottom: false });
      const p0 = f.p(0, 1.78, 0.2);
      M.metal.tube(f.p(0, 1.78, 0.03), p0, 0.014, C.brass, 4);
      M.hang.frustum(p0[0], p0[2], 0.06, 0.2, 1.8, 2.02, 12, [0.75, 0.6, 0.4], false);
      M.gPend.frustum(p0[0], p0[2], 0.03, 0.03, 1.8, 1.9, 8, glowc(0xffb870, 6));
      M.gPend.tri([p0[0] - 0.17, 2.0, p0[2]], [p0[0], 2.0, p0[2] + 0.17], [p0[0] + 0.17, 2.0, p0[2]], glowc(0xffb870, 1.5), [0, 1, 0]);
      M.gPend.tri([p0[0] - 0.17, 2.0, p0[2]], [p0[0] + 0.17, 2.0, p0[2]], [p0[0], 2.0, p0[2] - 0.17], glowc(0xffb870, 1.5), [0, 1, 0]);
    }
  }
  // exit signs: green boxes over the doors, and the fire door at the end
  doors.forEach((d) => {
    const nrm = d.axis === 'x' ? [0, 1] : [1, 0];
    for (const sg of [-1, 1]) {
      const f = frame(d.x + nrm[0] * sg * 1.18, d.z + nrm[1] * sg * 1.18, nrm[0] * sg, nrm[1] * sg);
      if (d.id !== 'd1') {
        M.hang.tube(f.p(-0.2, WALL_H, -0.02), f.p(-0.2, 3.26, -0.02), 0.008, C.ironD, 4);
        M.hang.tube(f.p(0.2, WALL_H, -0.02), f.p(0.2, 3.26, -0.02), 0.008, C.ironD, 4);
        obox(M.hang, f, -0.32, 0.32, 3.0, 3.26, -0.04, 0.0, C.black, { bottom: false, back: true });
        obox(M.gPend, f, -0.28, 0.28, 3.02, 3.24, 0.0, 0.015, glowc(0x35d07a, 3.2), { bottom: false });
      }
    }
  });
  {
    const f = frame(2.02, 8, 1, 0); // west wall of the exit alcove
    M.glow.grid(f.p(-1.7, 0, 0.0), f.p(1.7, 0, 0.0), f.p(-1.7, 2.6, 0.0), [0, 1], [0, 0.5, 1], (i, j) => glowc(0xb8f0c8, 1.2 + 1.2 * j * 0.5), f.n);
    obox(M.stone, f, -1.95, -1.7, 0, 2.8, 0, 0.15, [0.9, 0.86, 0.8], { bottom: false });
    obox(M.stone, f, 1.7, 1.95, 0, 2.8, 0, 0.15, [0.9, 0.86, 0.8], { bottom: false });
    obox(M.stone, f, -1.95, 1.95, 2.6, 2.8, 0, 0.15, [0.9, 0.86, 0.8], { bottom: false });
    obox(M.glow, f, -0.5, 0.5, 2.9, 3.15, 0, 0.02, glowc(0x35d07a, 3.5), { bottom: false });
    const ex = ctx.exit;
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2;
      const a1 = ((i + 1) / 24) * Math.PI * 2;
      M.glow.quad([ex.x + Math.cos(a0) * 1.15, 0.03, ex.z + Math.sin(a0) * 1.15], [ex.x + Math.cos(a0) * 1.35, 0.03, ex.z + Math.sin(a0) * 1.35],
        [ex.x + Math.cos(a1) * 1.35, 0.03, ex.z + Math.sin(a1) * 1.35], [ex.x + Math.cos(a1) * 1.15, 0.03, ex.z + Math.sin(a1) * 1.15], glowc(0x35d07a, 1.8), [0, 1, 0]);
    }
  }
  // two classic neon bar signs: a cocktail glass and a lightning bolt (no lettering)
  {
    const f = frame(2.0, 33, 1, 0);
    const col = glowc(0xff4f9a, 3.6);
    const w = 0.06;
    ribbon(M.neon, f, -0.45, 2.1, 0.45, 2.1, w, 0.05, col);
    ribbon(M.neon, f, -0.45, 2.1, 0, 1.45, w, 0.05, col);
    ribbon(M.neon, f, 0.45, 2.1, 0, 1.45, w, 0.05, col);
    ribbon(M.neon, f, 0, 1.45, 0, 0.95, w, 0.05, col);
    ribbon(M.neon, f, -0.3, 0.95, 0.3, 0.95, w, 0.05, col);
    ribbon(M.neon, f, 0.15, 2.1, 0.3, 2.45, w, 0.05, col);
    const g = frame(70 - 2.0, 61, -1, 0);
    const b2 = glowc(0x4a9aff, 3.6);
    ribbon(M.neon, g, 0.25, 2.5, -0.2, 1.7, w, 0.05, b2);
    ribbon(M.neon, g, -0.2, 1.7, 0.2, 1.7, w, 0.05, b2);
    ribbon(M.neon, g, 0.2, 1.7, -0.25, 0.8, w, 0.05, b2);
    for (const ff of [f, g]) for (const u of [-0.3, 0.3]) M.metal.box(ff.p(u, 0, 0)[0] - 0.02, 0.8, ff.p(u, 0, 0)[2] - 0.02, ff.p(u, 0, 0)[0] + 0.02, 2.5, ff.p(u, 0, 0)[2] + 0.02, C.iron); // sign mounts
  }
  // wet floor: glossy puddles on the flags, sticky spills on the boards
  for (const [c, r, rad, wet] of [[8.5, 33.5, 0.9, 0], [22, 29.5, 0.7, 0], [27.5, 33, 0.8, 0], [12, 36, 0.6, 0], [30, 26, 0.7, 0], [16, 29, 0.5, 0], [9.5, 20.5, 0.8, 0], [20, 22, 0.6, 0], [26, 20, 0.7, 0], [4.5, 16.5, 0.6, 0], [14, 45, 0.9, 1], [18, 40.5, 0.7, 1], [4.5, 43, 0.6, 1], [5.5, 45.5, 0.5, 1], [16.5, 46, 0.6, 1]]) {
    patch(M.glass, c * T, 0.016, r * T, rad * 0.8, 11, wet ? [0.03, 0.04, 0.05] : [0.025, 0.02, 0.018], c * 7 + r);
  }
  } // end of the Cowgate dressing
  if (D) D.dress();

  // ---- the mirror ball, its spots, haze and steam ----
  const BX = 17.5 * T;
  const BY = 2.55;
  const BZ = 30.5 * T;
  if (COW) M.metal.tube([BX, BY + 0.38, BZ], [BX, WALL_H, BZ], 0.012, C.steel, 4);
  const hazeM = new Mesher(14, null);
  if (COW && Q.haze) {
    for (const [x0, z0, x1, z1] of [[2, 48, 70, 76], [2, 28, 56, 46], [2, 18, 70, 26]]) {
      const fade = (a, lo, hi) => clamp(Math.min(a - lo, hi - a) / 5, 0, 1); // soft borders, so the sheet has no visible edge
      const us = [0, 0.04, 0.12, 0.88, 0.96, 1];
      hazeM.grid([x0, 0.55, z0], [x1, 0.55, z0], [x0, 0.55, z1], us, [0, 0.1, 0.5, 0.9, 1], (i, j, p) => { const k = fade(p[0], x0, x1) * fade(p[2], z0, z1); return [k, k, k]; }, [0, 1, 0]);
    }
  }

  // ---- materials and meshes ----
  const swayU = { value: 0 };
  const withSway = (mat) => {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = swayU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uTime;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.x += sin(uTime * 1.7 + position.z * 0.31 + position.x * 0.23) * 0.05 * aSway;\n  transformed.z += cos(uTime * 1.3 + position.x * 0.29 + position.z * 0.17) * 0.05 * aSway;');
    };
    mat.customProgramCacheKey = () => 'sway';
    return mat;
  };
  const textured = (name, ns = 1, env = 1) => {
    const t = tex[name];
    if (!Q.std) return new THREE.MeshLambertMaterial({ map: t.map, vertexColors: true });
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(ns, ns), roughnessMap: t.rough, roughness: 1, metalness: 0, vertexColors: true, envMapIntensity: env });
  };
  const flat = (rough, metal, env = 1, swayed = false) => {
    const m = Q.std ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal, envMapIntensity: env }) : new THREE.MeshLambertMaterial({ vertexColors: true });
    return swayed && Q.sway ? withSway(m) : m;
  };
  const basic = (swayed = false) => { const m = new THREE.MeshBasicMaterial({ vertexColors: true }); return swayed && Q.sway ? withSway(m) : m; };
  const group = new THREE.Group();
  group.name = lv.id;
  const add = (m) => { if (m) group.add(m); return m; };
  add(M.brick.mesh(textured('brick', 1.0)));
  add(M.paint.mesh(textured('paint', 1.0)));
  add(M.stone.mesh(textured('stone', 1.0)));
  add(M.flag.mesh(textured('flag', 1.0, 0.9)));
  add(M.floorboards.mesh(textured('floorboards', 1.0, 0.5)));
  add(M.carpet.mesh(textured('carpet', 0.8)));
  add(M.concrete.mesh(textured('concrete', 0.9, 0.4)));
  const ceilMesh = add(M.plaster.mesh(textured('plaster', 0.7)));
  if (ceilMesh) ceilMesh.userData.ceil = true;
  add(M.wood.mesh(textured('boards', 1.0, 0.5)));
  const polishMat = Q.std ? new THREE.MeshStandardMaterial({ map: tex.boards.map, normalMap: tex.boards.normal, roughness: 0.42, metalness: 0, vertexColors: true, envMapIntensity: 0.3 }) : new THREE.MeshLambertMaterial({ map: tex.boards.map, vertexColors: true });
  add(M.polish.mesh(polishMat));
  add(M.props.mesh(flat(0.7, 0)));
  add(M.metal.mesh(flat(0.38, 0.9, 1.0)));
  add(M.glass.mesh(flat(0.07, 0, 1.2)));
  add(M.hang.mesh(flat(0.6, 0.2, 1, true)));
  add(M.glow.mesh(basic()));
  const gMat = { pend: basic(true), bar: basic(true), a: basic(true), b: basic(true) };
  add(M.gPend.mesh(gMat.pend));
  add(M.gBar.mesh(gMat.bar));
  add(M.gA.mesh(gMat.a));
  add(M.gB.mesh(gMat.b));
  const neonMat = basic();
  add(M.neon.mesh(neonMat));
  const additive = (opacity) => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const shaftSMat = additive(0.8);
  const shaftLMat = additive(1);
  for (const [m, mat] of [[M.shaftS, shaftSMat], [M.shaftL, shaftLMat]]) { const mesh = add(m.mesh(mat)); if (mesh) mesh.renderOrder = 2; }

  // mirror ball: faceted, chrome, turning; its light spots are a small dynamic mesh of soft additive quads
  const ball = !COW ? null : new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 2), Q.std
    ? new THREE.MeshStandardMaterial({ color: 0xd8d8e0, metalness: 1, roughness: 0.06, flatShading: true, envMapIntensity: 2.2 })
    : new THREE.MeshLambertMaterial({ color: 0x909098, emissive: 0x100e0c, flatShading: true }));
  if (ball) { ball.position.set(BX, BY, BZ); group.add(ball); }
  let spots = null;
  const SPOTN = COW ? Q.spots : 0;
  if (SPOTN) {
    const pos = new Float32Array(SPOTN * 12);
    const uv = new Float32Array(SPOTN * 8);
    const col = new Float32Array(SPOTN * 12);
    const idx = new Uint16Array(SPOTN * 6);
    const PAL = [0xffe2b0, 0xff9a60, 0xff4a3a, 0xa8c8ff, 0xffd070];
    for (let k = 0; k < SPOTN; k++) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], k * 8);
      idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
      const c = mul(rgb(PAL[k % PAL.length]), 1.7);
      for (let v = 0; v < 4; v++) col.set(c, k * 12 + v * 3);
    }
    const g = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pa);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(BX, 1.5, BZ), 40);
    spots = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: sprite, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    spots.frustumCulled = false;
    spots.renderOrder = 3;
    group.add(spots);
  }
  const ELEV = Array.from({ length: SPOTN }, (_, k) => -(0.2 + 0.8 * ihash(k, 1, 3)));
  const ANG0 = Array.from({ length: SPOTN }, (_, k) => (k / SPOTN) * Math.PI * 2 + ihash(k, 2, 3) * 0.35);
  const updateSpots = (t) => {
    const pos = spots.geometry.attributes.position.array;
    for (let k = 0; k < SPOTN; k++) {
      const a = ANG0[k] + t * 0.42;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const tn2 = Math.tan(-ELEV[k]);
      const d = raycast(BX, BZ, dx, dz, 40);
      const df = BY / tn2;
      const o = k * 12;
      if (df < d) { // lands on the floor
        const cx = BX + dx * df;
        const cz = BZ + dz * df;
        const s = 0.12 + 0.045 * df;
        pos.set([cx - s, 0.03, cz - s, cx + s, 0.03, cz - s, cx + s, 0.03, cz + s, cx - s, 0.03, cz + s], o);
        continue;
      }
      const y = BY - tn2 * d;
      if (y < 0.12 || y > 3.15 || d >= 40) { pos.fill(0, o, o + 12); pos[o + 1] = pos[o + 4] = pos[o + 7] = pos[o + 10] = -9; continue; }
      const px = BX + dx * d;
      const pz = BZ + dz * d;
      const fx = Math.abs(px - Math.round(px / T) * T);
      const fz = Math.abs(pz - Math.round(pz / T) * T);
      const nx = fx < fz ? -Math.sign(dx) : 0;
      const nz = fx < fz ? 0 : -Math.sign(dz);
      const cx = px + nx * 0.03;
      const cz = pz + nz * 0.03;
      const tx = -nz;
      const tz = nx;
      const s = 0.12 + 0.03 * d;
      const sy = s * 1.1;
      pos.set([cx - tx * s, y - sy, cz - tz * s, cx + tx * s, y - sy, cz + tz * s, cx + tx * s, y + sy, cz + tz * s, cx - tx * s, y + sy, cz - tz * s], o);
    }
    spots.geometry.attributes.position.needsUpdate = true;
  };

  // haze hangs low over the big rooms and drifts
  let hazeTexture = null;
  if (COW && Q.haze) {
    hazeTexture = hazeTex();
    const hm = new THREE.MeshBasicMaterial({ map: hazeTexture, color: new THREE.Color(0xc89060).multiplyScalar(0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const hz = hazeM.mesh(hm);
    hz.renderOrder = 1;
    group.add(hz);
  }

  // steam leaking from two pipes: crossed soft quads, rising and fading
  let steam = null;
  const NP = 6;
  const SN = Q.steam ? STEAM.length : 0;
  if (SN) {
    const n = SN * NP * 2;
    const pos = new Float32Array(n * 12);
    const col = new Float32Array(n * 12);
    const uv = new Float32Array(n * 8);
    const idx = new Uint16Array(n * 6);
    for (let k = 0; k < n; k++) { uv.set([0, 0, 1, 0, 1, 1, 0, 1], k * 8); idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6); }
    const g = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    const ca = new THREE.BufferAttribute(col, 3);
    ca.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pa);
    g.setAttribute('color', ca);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(30, 1.5, 40), 80);
    steam = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: sprite, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    steam.frustumCulled = false;
    steam.renderOrder = 3;
    group.add(steam);
  }
  const updateSteam = (t) => {
    const pos = steam.geometry.attributes.position.array;
    const col = steam.geometry.attributes.color.array;
    let q = 0;
    STEAM.forEach(([ox, oy, oz], si) => {
      for (let i = 0; i < NP; i++) {
        const life = (t * 0.3 + i / NP + si * 0.37) % 1;
        const travel = life * 1.5;
        const x = ox + Math.sin(t * 0.7 + i * 2.1 + si) * 0.15 * life;
        const y = oy - travel * 0.45 + life * life * 1.1;
        const z = oz + travel;
        const s = 0.12 + 0.65 * life;
        const a = Math.pow(Math.sin(Math.PI * life), 1.4) * 0.28;
        for (let kind = 0; kind < 2; kind++) {
          const o = q * 12;
          if (kind === 0) pos.set([x - s, y - s, z, x + s, y - s, z, x + s, y + s, z, x - s, y + s, z], o);
          else pos.set([x, y - s, z - s, x, y - s, z + s, x, y + s, z + s, x, y + s, z - s], o);
          for (let v = 0; v < 4; v++) { col[o + v * 3] = a * 0.9; col[o + v * 3 + 1] = a * 0.92; col[o + v * 3 + 2] = a; }
          q++;
        }
      }
    });
    steam.geometry.attributes.position.needsUpdate = true;
    steam.geometry.attributes.color.needsUpdate = true;
  };

  // doors
  const leafMat = textured('boards', 1.0);
  const doorObjs = doorLeaves.map(({ mesh, i }) => {
    const leaf = mesh.mesh(leafMat);
    leaf.position.set(doors[i].x, 0, doors[i].z);
    group.add(leaf);
    return { leaf, last: null };
  });
  const lampMesh = lampM.mesh(basic());
  group.add(lampMesh);
  const RED = [4, 0.45, 0.2];
  const GREEN = [0.5, 3.6, 1.2];
  const paintLamp = (i, open) => {
    const [a, b] = lampRanges[i];
    const ca = lampMesh.geometry.attributes.color;
    const c = open ? GREEN : RED;
    for (let v = a; v < b; v++) ca.setXYZ(v, c[0], c[1], c[2]);
    ca.needsUpdate = true;
  };
  doors.forEach((d, i) => paintLamp(i, d.open));

  // lights: four, one per big room that needs warmth. The integrator adds the camera light.
  const lights = COW ? {
    dance: new THREE.PointLight(0xff4a22, 40, 26, 2),
    bar: new THREE.PointLight(0xffa860, 26, 22, 2),
    vip: new THREE.PointLight(0xff9a70, 20, 24, 2),
    back: new THREE.PointLight(0xdfe8d8, 24, 24, 2),
  } : {};
  if (COW) {
    lights.dance.position.set(17.5 * T, 2.6, 31 * T);
    lights.bar.position.set(14 * T, 2.6, 18 * T);
    lights.vip.position.set(17.5 * T, 2.4, 11 * T);
    lights.back.position.set(19 * T, 2.7, 4 * T);
  }
  Object.values(lights).forEach((l) => group.add(l));
  if (D) D.finish({ group, textured, flat, basic, additive, sprite });
  const base = { dance: 40, bar: 26, vip: 20, back: 24 };
  const red = new THREE.Color(0xff3a1c);
  const amber = new THREE.Color(0xff9a30);

  function doorVisual(i, t, open) {
    const o = doorObjs[i];
    o.leaf.position.y = t * (WALL_H + 0.1);
    o.leaf.visible = t < 0.999;
    if (o.last !== open) { o.last = open; paintLamp(i, open); }
  }
  function animate(time) {
    const beat = (time * 118) / 60;
    const fr = beat - Math.floor(beat);
    const pulse = Math.pow(1 - fr, 3);
    swayU.value = time;
    const flickBar = 0.94 + 0.06 * Math.sin(time * 13.1) * Math.sin(time * 7.3);
    const tired = ihash(Math.floor(time * 11), 0, 91) < 0.05 ? 0.3 : 1;
    const bulbA = ihash(Math.floor(time * 13), 0, 93) < 0.1 ? 0.2 : 0.96 + 0.04 * Math.sin(time * 31);
    if (COW) {
      lights.dance.color.copy(red).lerp(amber, 0.5 + 0.5 * Math.sin(time * 0.9));
      lights.dance.intensity = base.dance * (0.82 + 0.18 * pulse);
      lights.bar.intensity = base.bar * flickBar;
      lights.vip.intensity = base.vip * (0.96 + 0.04 * Math.sin(time * 2.1));
      lights.back.intensity = base.back * tired;
    }
    gMat.bar.color.setScalar(flickBar);
    gMat.b.color.setScalar(tired);
    gMat.a.color.setScalar(bulbA);
    gMat.pend.color.setScalar(0.97 + 0.03 * Math.sin(time * 2.7));
    shaftSMat.opacity = 0.55 + 0.45 * pulse;
    const ok = ihash(Math.floor(time * 10), 0, 92) > 0.08;
    neonMat.color.setScalar(ok ? 0.92 + 0.08 * Math.sin(time * 40) : 0.25);
    if (ball) ball.rotation.y = time * 0.42;
    if (spots) updateSpots(time);
    if (D) D.animate(time);
    if (steam) updateSteam(time);
    if (hazeTexture) { hazeTexture.offset.x = time * 0.006; hazeTexture.offset.y = time * 0.003; }
  }

  const textures = {};
  for (const [name, t] of Object.entries(tex)) textures[name] = t.map;
  return { group, clock: 0, doorVisual, animate, textures, propsPlaced };
}
