// The Cowgate: level geometry, collision, pathing and content for the first-person game.
// Everything is procedural and DOM-free, so it also runs under plain Node for headless tests.
// Build order: parse the ASCII map -> queries -> baked-light emitters -> merged geometry -> doors and lights.
import * as THREE from '../vendor/three.module.min.js';
import { TILE, WALL_H, COLOURS } from './consts.js';

const T = TILE;
const COLS = 36;
const ROWS = 48;

// Legend. Solid: # wall, P pillar, S speaker stack, T stairs. Low cover (blocks walking, not bullets):
// b bar counter, j DJ booth, v booth, x crate or flight case, r coat or costume rail, o round table.
// 1-6 door tiles (two per door), . floor. Markers that sit on floor: @ start, E exit (two tiles),
// d fizzbang, w bampot, K bouncer, G shotgun, M smg, L launcher; drinks H dram, O orange, B heavy, N energy.
// <map>
const MAP = [
  '####################################',
  '####....xxx.....xx........xx.......#',
  '#..#...............................#',
  '#EE6................d..............#',
  '#EE6......K.....P.......P..........#',
  '#..#..................d............#',
  '####.........B...................H.#',
  '####..........rr....rr.............#',
  '###############################55###',
  '#.....vvv...N.vvv..H..vvv..........#',
  '#..................................#',
  '#.L...............d.......d...w..w.#',
  '#..................................#',
  '###44###############################',
  '#...........................#x.....#',
  '#........w..................#......#',
  '#..................w........#...H..#',
  '#...........................#.....x#',
  '#....bbbbbbbbbbbbbbbbbbbbB..#.....x#',
  '#..........o................#......#',
  '#..o...d........P....d.............#',
  '#.............d....................#',
  '#.................o.....o..........#',
  '###############################33###',
  '#...........S.jjjjjjjj.S...........#',
  '#...........S.jjjjjjjjNS...........#',
  '#...d.........jjjjjjjj.............#',
  '#...........w..............d.......#',
  '#v....S...........................S#',
  '#v....S......................P....S#',
  '#.....S...P........................#',
  '#..............P........P.......d..#',
  '#..M...............................#',
  '#.................................S#',
  '#.....S...P........SS........P....S#',
  '#v....S....................H...d...#',
  '#v....S............................#',
  '#..................................#',
  '###################22###############',
  '########..............##############',
  '#TTT..x#..............##############',
  '#TTT...#...Orrr..P....##############',
  '#......#..............##############',
  '#......1..G..d....d...##############',
  '#..@...1.......rrr....##############',
  '#......#..............##############',
  '#x....x#...xx.........##############',
  '####################################',
];
// </map>

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

const AREA_DEFS = [
  { id: 'stairwell', name: 'THE COWGATE: STAIRWELL', objective: 'Head into the club', rect: { c0: 1, r0: 40, c1: 7, r1: 46 }, unlocks: [] },
  { id: 'cloakroom', name: 'THE COWGATE: CLOAKROOM', objective: 'Clear the cloakroom', rect: { c0: 8, r0: 38, c1: 21, r1: 46 }, unlocks: ['d2'] },
  { id: 'dancefloor', name: 'THE COWGATE: DANCEFLOOR', objective: 'Clear the dancefloor', rect: { c0: 1, r0: 23, c1: 34, r1: 37 }, unlocks: ['d3'] },
  { id: 'bar', name: 'THE COWGATE: BAR', objective: 'Clear the bar', rect: { c0: 1, r0: 13, c1: 34, r1: 22 }, unlocks: ['d4'] },
  { id: 'vip', name: 'THE COWGATE: VIP CORRIDOR', objective: 'Clear the VIP corridor', rect: { c0: 1, r0: 8, c1: 34, r1: 12 }, unlocks: ['d5'] },
  { id: 'backstage', name: 'THE COWGATE: BACKSTAGE', objective: 'Take down the bouncer', rect: { c0: 1, r0: 1, c1: 34, r1: 7 }, unlocks: ['d6'] },
];

// ---- parse the map ----
function parseMap() {
  const kind = new Uint8Array(COLS * ROWS);
  const sub = new Array(COLS * ROWS).fill('');
  const doorTiles = {}; // digit -> [[c, r], ...]
  const marks = []; // { ch, c, r }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = MAP[r][c];
      const i = r * COLS + c;
      sub[i] = ch;
      if (SOLID_CHARS[ch] !== undefined) kind[i] = SOLID_CHARS[ch];
      else if (COVER_CHARS.includes(ch)) kind[i] = COVER;
      else if (ch >= '1' && ch <= '6') {
        kind[i] = DOOR;
        (doorTiles[ch] = doorTiles[ch] || []).push([c, r]);
      } else if (ch !== '.') marks.push({ ch, c, r });
    }
  }
  return { kind, sub, doorTiles, marks };
}

const tileCentre = (c, r) => [(c + 0.5) * T, (r + 0.5) * T];

export function buildWorld() {
  const { kind, sub, doorTiles, marks } = parseMap();
  const at = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS ? WALL : kind[r * COLS + c]);

  // ---- areas ----
  const areas = AREA_DEFS.map((d) => ({ id: d.id, name: d.name, objective: d.objective, rect: { ...d.rect }, spawns: [], unlocks: [...d.unlocks] }));
  const areaIdx = new Int8Array(COLS * ROWS).fill(-1);
  areas.forEach((a, n) => {
    for (let r = a.rect.r0; r <= a.rect.r1; r++) for (let c = a.rect.c0; c <= a.rect.c1; c++) if (areaIdx[r * COLS + c] < 0) areaIdx[r * COLS + c] = n;
  });
  const areaOfTile = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS ? -1 : areaIdx[r * COLS + c]);

  // ---- doors ----
  const doors = [];
  const doorState = []; // internal: { t, target, tiles, axis, w }
  const doorAtTile = new Int8Array(COLS * ROWS).fill(-1);
  for (let n = 1; n <= 6; n++) {
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
  const entryOf = [null, doors[0], doors[1], doors[2], doors[3], doors[4]];
  const pickups = [];
  const counts = {};
  let start = { x: 7, z: 89, yaw: -Math.PI / 2 };
  const exitTiles = [];
  const KIND_OF = { d: 'fizzbang', w: 'bampot', K: 'bouncer' };
  const PICK_OF = { G: ['weapon', 'shotgun'], M: ['weapon', 'smg'], L: ['weapon', 'launcher'], H: ['drink', 'dram'], O: ['drink', 'orange'], B: ['drink', 'heavy'], N: ['drink', 'energy'] };
  for (const m of marks) {
    const [x, z] = tileCentre(m.c, m.r);
    const an = areaOfTile(m.c, m.r);
    if (m.ch === '@') start = { x, z, yaw: -Math.PI / 2 };
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
    r: 1.5,
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
  const visuals = buildVisuals({ kind, sub, at, areas, areaOfTile, doors, doorAtTile, doorState, exit, start });

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
    fog: { colour: 0x07040e, near: 5, far: 38 },
    ambient: { sky: 0xc9b9b0, ground: 0x6c5c58, intensity: 1.5 },
    start,
    exit,
    areas,
    doors,
    pickups,
    areaAt,
    isSolidAt,
    moveCircle,
    raycast,
    los,
    createFlowField,
    setDoorOpen,
    update,
    // extras for tests and tools (not part of the contract)
    textures: visuals.textures,
    size: { cols: COLS, rows: ROWS },
    tileSolid: (c, r) => blocksMove(c, r),
    tileBlocksShots: (c, r) => blocksShot(c, r),
  };
}

// ---- procedural textures ----
// DataTextures from plain typed arrays: no canvas, no images, so they build under Node too.
const TEX = 256;
function ihash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((s | 0) + 1, 1013904223);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// tileable value noise: px x py lattice cells across the texture
function tn(x, y, px, py, s) {
  const fx = (x / TEX) * px;
  const fy = (y / TEX) * py;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = ihash(x0 % px, y0 % py, s);
  const b = ihash((x0 + 1) % px, y0 % py, s);
  const c = ihash(x0 % px, (y0 + 1) % py, s);
  const d = ihash((x0 + 1) % px, (y0 + 1) % py, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fbm = (x, y, s) => tn(x, y, 4, 4, s) * 0.5 + tn(x, y, 8, 8, s + 1) * 0.3 + tn(x, y, 16, 16, s + 2) * 0.2;

function makeTex(fn) {
  const data = new Uint8Array(TEX * TEX * 4);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const c = fn(x, y);
      const i = (y * TEX + x) * 4;
      data[i] = clamp(c[0], 0, 255);
      data[i + 1] = clamp(c[1], 0, 255);
      data[i + 2] = clamp(c[2], 0, 255);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const BRICK_COLS = [[158, 74, 54], [142, 62, 46], [168, 90, 60], [122, 72, 54], [134, 86, 62], [150, 70, 58], [176, 104, 70]];
// 4 bricks across, 12 courses: one tile is about 0.9 x 0.9 world units (brick 0.225 x 0.075)
function brickPixel(x, y, paint) {
  const rows = 12;
  const row = Math.min(rows - 1, Math.floor((y * rows) / TEX));
  const top = Math.round((row * TEX) / rows);
  const h = Math.round(((row + 1) * TEX) / rows) - top;
  const ly = y - top;
  const bx = (x + (row & 1 ? 32 : 0)) % TEX;
  const col = (bx / 64) | 0;
  const lx = bx - col * 64;
  const grain = ihash(x, y, 4) - 0.5;
  const mortar = lx < 2 || ly < 2;
  const id = ihash(col, row, 1);
  let r;
  let g;
  let b;
  if (mortar) {
    const k = 1 + (tn(x, y, 32, 32, 6) - 0.5) * 0.3 + grain * 0.22;
    r = 124 * k; g = 118 * k; b = 106 * k;
    if (ly < 5 && ly >= 2) { r *= 0.8; g *= 0.8; b *= 0.8; }
  } else {
    let base;
    if (id < 0.04) base = [62, 46, 48];
    else if (id < 0.07) base = [48, 50, 64];
    else if (id < 0.1) base = [186, 140, 110];
    else if (id < 0.14) base = [104, 88, 80];
    else base = BRICK_COLS[(id * 977) % BRICK_COLS.length | 0];
    const k = 0.86 + 0.28 * ihash(col, row, 2);
    const n = (fbm(x, y, 3) - 0.5) * 34 + grain * 24;
    r = base[0] * k + n; g = base[1] * k + n * 0.85; b = base[2] * k + n * 0.8;
    if (ly < 4) { r += 12; g += 10; b += 8; }
    if (ly >= h - 2) { r -= 18; g -= 16; b -= 14; }
    if (lx >= 62) { r -= 12; g -= 10; b -= 8; }
    if (ihash(x, y, 5) > 0.985) { r -= 36; g -= 32; b -= 30; }
    // chipped corner showing paler core
    if (ihash(col, row, 9) < 0.07 && lx > 50 && ly < 14 && lx - 50 > ly - 4) { r = 160 + grain * 20; g = 126 + grain * 20; b = 108 + grain * 20; }
  }
  if (!paint) return [r, g, b];
  // whitewash: bricks only show as relief, with peeling patches and drips
  const w = 0.95 + grain * 0.08;
  let pr = 232 * w;
  let pg = 227 * w;
  let pb = 214 * w;
  if (mortar) { pr -= 40; pg -= 40; pb -= 38; }
  else if (ly < 4) { pr += 6; pg += 6; pb += 6; }
  else if (ly >= h - 2) { pr -= 16; pg -= 16; pb -= 14; }
  const drip = tn(x, y, 24, 3, 11);
  const dirt = (drip - 0.5) * 36 + (fbm(x, y, 12) - 0.5) * 30;
  pr += dirt; pg += dirt; pb += dirt * 1.1;
  const peel = tn(x, y, 12, 12, 13) * 0.7 + tn(x, y, 32, 32, 15) * 0.3 + (ihash(x, y, 14) - 0.5) * 0.06;
  if (peel > 0.74) {
    const m = clamp((peel - 0.74) / 0.06, 0, 0.75);
    pr = pr + (r - pr) * m; pg = pg + (g - pg) * m; pb = pb + (b - pb) * m;
  }
  return [pr, pg, pb];
}

// ashlar blocks: 4 courses of 64px, block widths vary per course
const STONE_ROWS = [[110, 146], [96, 160], [140, 116], [120, 136]];
function stonePixel(x, y) {
  const row = (y / 64) | 0;
  const ly = y - row * 64;
  const off = [0, 48, 16, 80][row];
  const bx = (x + TEX - off) % TEX;
  let acc = 0;
  let blk = 0;
  let lx = 0;
  let w = 0;
  for (let i = 0; i < STONE_ROWS[row].length; i++) {
    if (bx < acc + STONE_ROWS[row][i]) { blk = i; lx = bx - acc; w = STONE_ROWS[row][i]; break; }
    acc += STONE_ROWS[row][i];
  }
  const grain = ihash(x, y, 4) - 0.5;
  if (lx < 3 || ly < 3) {
    const k = 1 + grain * 0.3;
    return [66 * k, 62 * k, 56 * k];
  }
  const id = ihash(blk, row, 21);
  const base = id < 0.25 ? [140, 134, 124] : id < 0.55 ? [156, 144, 126] : id < 0.8 ? [146, 128, 112] : [120, 118, 114];
  const k = 0.9 + 0.2 * ihash(blk, row, 22);
  const n = (fbm(x, y, 23) - 0.5) * 30 + grain * 26;
  let r = base[0] * k + n;
  let g = base[1] * k + n;
  let b = base[2] * k + n * 0.9;
  if (ly < 6) { r += 10; g += 10; b += 8; }
  if (ly > 58 || lx > w - 5) { r -= 18; g -= 18; b -= 16; }
  if (tn(x, y, 5, 5, 24) > 0.72) { r *= 0.9; g *= 0.91; b *= 0.88; }
  if (ihash(x, y, 25) > 0.99) { r -= 40; g -= 40; b -= 40; }
  return [r, g, b];
}

const FLAG_ROWS = [[0, 88, [100, 92, 64]], [88, 72, [72, 112, 72]], [160, 96, [96, 80, 80]]];
function flagPixel(x, y) {
  let row = 2;
  if (y < 88) row = 0; else if (y < 160) row = 1;
  const [top, h, ws] = FLAG_ROWS[row];
  const ly = y - top;
  let acc = 0;
  let blk = 0;
  let lx = 0;
  let w = 0;
  for (let i = 0; i < ws.length; i++) {
    if (x < acc + ws[i]) { blk = i; lx = x - acc; w = ws[i]; break; }
    acc += ws[i];
  }
  const grain = ihash(x, y, 31) - 0.5;
  if (lx < 3 || ly < 3) return [46 + grain * 14, 44 + grain * 14, 42 + grain * 14];
  const id = ihash(blk, row, 32);
  const base = id < 0.4 ? [118, 118, 116] : id < 0.75 ? [104, 106, 108] : [128, 118, 106];
  const k = 0.88 + 0.24 * ihash(blk, row, 33);
  const edge = Math.min(lx - 3, w - lx, ly - 3, h - ly);
  const wear = edge < 8 ? -14 + edge * 1.4 : 6; // worn crown, darker rounded edges
  const n = (fbm(x, y, 34) - 0.5) * 44 + grain * 22 + wear;
  let r = base[0] * k + n;
  let g = base[1] * k + n;
  let b = base[2] * k + n;
  const stain = tn(x, y, 6, 6, 35);
  if (stain > 0.64) { const m = (stain - 0.64) * 2.2; r *= 1 - m * 0.45; g *= 1 - m * 0.4; b *= 1 - m * 0.35; }
  const moss = tn(x, y, 10, 10, 36);
  if (moss > 0.74 && edge < 22) { g += 12; r -= 8; }
  return [r, g, b];
}

// eight planks along x, butt joints, stains, scuffs
function boardPixel(x, y, dark) {
  const pl = (y / 32) | 0;
  const ly = y - pl * 32;
  const jx = (ihash(pl, 0, 41) * TEX) | 0;
  const seg = x >= jx ? 1 : 0;
  const grain = ihash(x, y, 42) - 0.5;
  const joint = Math.abs(x - jx) < 1 || x === 0;
  if (ly < 2 || joint) return [18 + grain * 8, 12 + grain * 6, 8 + grain * 6];
  const id = ihash(pl, seg, 43);
  const base = id < 0.3 ? [82, 54, 34] : id < 0.6 ? [68, 44, 28] : id < 0.85 ? [92, 62, 40] : [54, 36, 26];
  const k = (dark ? 0.78 : 1) * (0.86 + 0.28 * ihash(pl, seg, 44));
  const streak = tn(x, y + pl * 40, 3, 48, 45) - 0.5;
  const n = streak * 50 + grain * 16 + (tn(x, y, 24, 12, 46) - 0.5) * 18;
  let r = base[0] * k + n;
  let g = base[1] * k + n * 0.8;
  let b = base[2] * k + n * 0.6;
  const kn = ihash(pl, seg, 47);
  if (kn < 0.22) {
    const kx = jx + 40 + kn * 300;
    const d = Math.hypot(((x - kx + TEX) % TEX) * 0.8, ly - 16);
    if (d < 6) { r *= 0.55 + d * 0.05; g *= 0.55 + d * 0.05; b *= 0.55 + d * 0.05; }
  }
  const stain = tn(x, y, 5, 5, 48);
  if (stain < 0.34) { const m = 0.6 + stain * 0.9; r *= m; g *= m; b *= m; }
  const wear = tn(x, y, 14, 6, 49);
  if (wear > 0.72) { r *= 1.18; g *= 1.14; b *= 1.08; }
  if (Math.abs(x - jx) < 6 && (ly === 7 || ly === 24) && Math.abs(x - jx) > 2) { r = 30; g = 24; b = 20; } // nail heads
  return [r, g, b];
}

// worn patterned carpet: lattice of gold diamonds on claret
function carpetPixel(x, y) {
  const u = x % 128;
  const v = y % 128;
  const d = Math.abs(u - 64) + Math.abs(v - 64);
  const grain = ihash(x, y, 51) - 0.5;
  let c = [92, 20, 34];
  if (Math.abs(d - 52) < 3) c = [176, 134, 52];
  else if (Math.abs(d - 40) < 2) c = [124, 30, 44];
  else if (d < 24) c = (u + v) % 16 < 8 ? [34, 46, 48] : [48, 30, 40];
  else if (d > 90) c = [60, 14, 26];
  else if (Math.abs(u - 64) < 3 && Math.abs(v) % 128 < 6) c = [176, 134, 52];
  const wearN = fbm(x, y, 52);
  const worn = wearN > 0.58 ? (wearN - 0.58) * 2.4 : 0;
  const k = 0.9 + grain * 0.3 - (tn(x, y, 7, 7, 53) < 0.28 ? 0.3 : 0);
  return [c[0] * k + worn * 50, c[1] * k + worn * 36, c[2] * k + worn * 30];
}

function concretePixel(x, y) {
  const grain = ihash(x, y, 61) - 0.5;
  let v = 112 + (fbm(x, y, 62) - 0.5) * 44 + grain * 20;
  let r = v;
  let g = v;
  let b = v - 2;
  if (ihash(x >> 1, y >> 1, 63) > 0.992) { r -= 40; g -= 40; b -= 40; }
  const stain = tn(x, y, 5, 5, 65);
  if (stain > 0.6) { const m = (stain - 0.6) * 1.8; r *= 1 - m * 0.4; g *= 1 - m * 0.42; b *= 1 - m * 0.5; }
  if (x < 2 || y < 2) { r *= 0.55; g *= 0.55; b *= 0.55; } // expansion joints
  return [r, g, b];
}

function plasterPixel(x, y) {
  const grain = ihash(x, y, 71) - 0.5;
  const n = (fbm(x, y, 72) - 0.5) * 36;
  let r = 110 + n + grain * 14;
  let g = 100 + n + grain * 14;
  let b = 88 + n * 0.9 + grain * 14;
  const ring = Math.abs(tn(x, y, 4, 4, 73) - 0.5);
  if (ring < 0.014 && tn(x, y, 3, 3, 75) > 0.5) { r -= 16; g -= 20; b -= 24; } // damp tide marks
  return [r, g, b];
}

function buildTextures() {
  return {
    brick: makeTex((x, y) => brickPixel(x, y, false)),
    paint: makeTex((x, y) => brickPixel(x, y, true)),
    stone: makeTex(stonePixel),
    flag: makeTex(flagPixel),
    boards: makeTex((x, y) => boardPixel(x, y, false)),
    floorboards: makeTex((x, y) => boardPixel(x, y, true)),
    carpet: makeTex(carpetPixel),
    concrete: makeTex(concretePixel),
    plaster: makeTex(plasterPixel),
  };
}

// ---- geometry builder: merged BufferGeometry with vertex colours, world-unit UVs and baked light ----
const ONE = [1, 1, 1];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

class Mesher {
  constructor(scale, bake) {
    this.s = scale;
    this.bake = bake;
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = [];
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

  // a -> b is u, a -> d is v; split into nu x nv so baked light varies across big faces
  grid(a, b, c, d, col, nu, nv, hint) {
    const P = (s, t) => [a[0] + (b[0] - a[0]) * s + (d[0] - a[0]) * t, a[1] + (b[1] - a[1]) * s + (d[1] - a[1]) * t, a[2] + (b[2] - a[2]) * s + (d[2] - a[2]) * t];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        this.quad(P(i / nu, j / nv), P((i + 1) / nu, j / nv), P((i + 1) / nu, (j + 1) / nv), P(i / nu, (j + 1) / nv), col, hint);
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

  // open cone/frustum between two horizontal rings (spotlight beams)
  cone(a, ar, b, br, seg, col) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      this.quad([a[0] + Math.cos(a0) * ar, a[1], a[2] + Math.sin(a0) * ar], [a[0] + Math.cos(a1) * ar, a[1], a[2] + Math.sin(a1) * ar],
        [b[0] + Math.cos(a1) * br, b[1], b[2] + Math.sin(a1) * br], [b[0] + Math.cos(a0) * br, b[1], b[2] + Math.sin(a0) * br], col, [Math.cos(a0), 0, Math.sin(a0)]);
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

  mesh(material) {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
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
// box in a frame; skips the back face
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
function vgrid(m, f, u0, u1, y0, y1, d, col, nu, nv) {
  if (typeof col !== 'function') { m.grid(f.p(u0, y0, d), f.p(u1, y0, d), f.p(u1, y1, d), f.p(u0, y1, d), col, nu, nv, f.n); return; }
  for (let j = 0; j < nv; j++) { // col(i, j) gives each cell its own tone, which hides the texture repeat
    for (let i = 0; i < nu; i++) {
      const ua = u0 + ((u1 - u0) * i) / nu;
      const ub = u0 + ((u1 - u0) * (i + 1)) / nu;
      const ya = y0 + ((y1 - y0) * j) / nv;
      const yb = y0 + ((y1 - y0) * (j + 1)) / nv;
      m.quad(f.p(ua, ya, d), f.p(ub, ya, d), f.p(ub, yb, d), f.p(ua, yb, d), col(i, j), f.n);
    }
  }
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
// a flat horizontal disc or octagon lying on a surface
function patch(m, cx, y, cz, r, seg, col, wob) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const r0 = r * (1 + (ihash(i, wob, 3) - 0.5) * 0.5);
    const r1 = r * (1 + (ihash(i + 1 === seg ? 0 : i + 1, wob, 3) - 0.5) * 0.5);
    m.tri([cx, y, cz], [cx + Math.cos(a0) * r0, y, cz + Math.sin(a0) * r0], [cx + Math.cos(a1) * r1, y, cz + Math.sin(a1) * r1], col, [0, 1, 0]);
  }
}

const AREA_STYLE = {
  // ambient tint baked into vertex colours (it is multiplied with the texture, so it stays low and warm)
  stairwell: { tint: [0.94, 0.94, 1.03] },
  cloakroom: { tint: [1.14, 0.89, 0.67] },
  dancefloor: { tint: [1.0, 0.76, 0.78] },
  bar: { tint: [1.14, 0.89, 0.62] },
  vip: { tint: [1.02, 0.72, 0.67] },
  backstage: { tint: [0.84, 0.90, 1.01] },
};
const WALL_STYLE = {
  stairwell: { upper: 'stone', ut: [1.0, 1.0, 0.96], dado: 0 },
  cloakroom: { upper: 'brick', ut: [1.0, 0.94, 0.9], dado: 1.15, dmesh: 'paint', dt: [0.2, 0.34, 0.25] },
  dancefloor: { upper: 'brick', ut: [0.82, 0.72, 0.72], dado: 0 },
  bar: { upper: 'brick', ut: [1.05, 0.9, 0.82], dado: 1.2, dmesh: 'wood', dt: [0.62, 0.46, 0.32] },
  vip: { upper: 'paint', ut: [0.98, 0.88, 0.72], dado: 1.3, dmesh: 'paint', dt: [0.46, 0.1, 0.14] },
  backstage: { upper: 'paint', ut: [0.8, 0.84, 0.84], dado: 1.2, dmesh: 'paint', dt: [0.12, 0.26, 0.2] },
};
const FLOOR_STYLE = { stairwell: 'flag', cloakroom: 'flag', dancefloor: 'floorboards', bar: 'floorboards', vip: 'carpet', backstage: 'concrete' };
const FLOOR_TINT = { stairwell: [0.95, 0.95, 1.0], cloakroom: [1.0, 0.92, 0.88], dancefloor: [0.9, 0.82, 0.8], bar: [1.0, 0.9, 0.8], vip: [1.0, 0.9, 0.9], backstage: [0.95, 1.0, 1.05] };

const C = {
  iron: [0.06, 0.06, 0.07], ironL: [0.16, 0.16, 0.17], brass: [0.55, 0.4, 0.14], steel: [0.4, 0.4, 0.42],
  timber: [0.36, 0.24, 0.15], timberL: [0.62, 0.44, 0.27], black: [0.035, 0.035, 0.04], stone: [0.9, 0.86, 0.78],
  leather: [0.3, 0.06, 0.08], red: [0.5, 0.06, 0.06],
};
const glowc = (hex, k = 1) => mul(rgb(hex), k);

function buildVisuals(ctx) {
  const { kind, sub, at, areas, areaOfTile, doors, doorAtTile, doorState } = ctx;
  const tex = buildTextures();
  const aid = (an) => areas[an].id;

  // ---- light sources: positions in tile units (centre of tile c is c + 0.5) ----
  const E = [];
  const emit = (c, r, y, hex, k, rad) => E.push({ x: c * T, y, z: r * T, col: rgb(hex), k, r: rad });
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
  PENDANT.forEach(([, ps]) => ps.forEach(([c, r]) => emit(c, r, 2.6, 0xffa24a, 1.0, 8.5)));
  BULBS.forEach(([id, ps]) => ps.forEach(([c, r]) => emit(c, r, 2.7, id === 'stairwell' ? 0xffb85a : 0xffd890, id === 'stairwell' ? 1.4 : 0.9, 9)));
  CANS.forEach(([c, r, red]) => emit(c, r, 2.8, red ? 0xff2a18 : 0xff8a1c, 0.75, 9));
  emit(17.5, 30.5, 2.6, 0xffc890, 0.5, 9); // mirror ball catching the spots
  emit(4.5, 41.0, 2.4, 0x9fb8ff, 0.9, 8); // street light down the steps
  emit(2.5, 4.0, 1.4, 0xa8ffc0, 0.8, 7); // fire exit
  emit(17.5, 14.5, 1.6, 0xffa040, 0.8, 11); emit(8.5, 14.5, 1.6, 0xffa040, 0.7, 9); emit(23.5, 14.5, 1.6, 0xffa040, 0.7, 9); // back bar
  emit(1.2, 16.5, 1.6, 0xff5a9a, 0.7, 6); // bar sign
  emit(34.6, 30.5, 1.6, 0x5aa0ff, 0.7, 6); // dancefloor sign
  emit(18, 24.5, 1.8, 0xff3020, 0.5, 8); // DJ booth spill

  const TINT = areas.map((a) => AREA_STYLE[a.id].tint);
  const solidish = (c, r) => { const k = at(c, r); return k === WALL ? 1 : k === PILLAR || k === SPEAKER || k === STAIRS ? 0.8 : k === COVER ? 0.4 : 0; };
  const smooth = (v) => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
  const bake = (x, y, z, nx, ny, nz) => {
    let an = areaOfTile(Math.floor((x + nx * 0.2) / T), Math.floor((z + nz * 0.2) / T));
    if (an < 0) an = 0;
    const t = TINT[an];
    let R = t[0];
    let G = t[1];
    let B = t[2];
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      const dx = e.x - x;
      const dy = e.y - y;
      const dz = e.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= e.r * e.r) continue;
      const d = Math.sqrt(d2);
      let f = 1 - d / e.r;
      f *= f;
      const ndl = d > 1e-4 ? (nx * dx + ny * dy + nz * dz) / d : 1;
      const w = f * e.k * (0.3 + 0.7 * Math.max(0, ndl));
      R += e.col[0] * w; G += e.col[1] * w; B += e.col[2] * w;
    }
    let ao;
    if (Math.abs(ny) > 0.6) {
      const c0 = Math.floor((x - 0.45) / T);
      const c1 = Math.floor((x + 0.45) / T);
      const r0 = Math.floor((z - 0.45) / T);
      const r1 = Math.floor((z + 0.45) / T);
      ao = 1 - 0.13 * (solidish(c0, r0) + solidish(c1, r0) + solidish(c0, r1) + solidish(c1, r1));
      if (y > 1) ao *= 0.85;
    } else {
      ao = 0.5 + 0.5 * smooth(y / 1.9); // grime and damp climbing from the floor
      ao *= 1 - 0.2 * smooth((y - 3.0) / 0.4);
    }
    return [Math.min(1.5, R * ao), Math.min(1.5, G * ao), Math.min(1.5, B * ao)];
  };

  const M = {
    brick: new Mesher(0.9, bake), paint: new Mesher(0.9, bake), stone: new Mesher(1.2, bake),
    flag: new Mesher(2.0, bake), floorboards: new Mesher(1.6, bake), carpet: new Mesher(1.6, bake), concrete: new Mesher(2.4, bake),
    plaster: new Mesher(2.0, bake), wood: new Mesher(1.6, bake), props: new Mesher(1, bake),
    glow: new Mesher(1, null), neon: new Mesher(1, null), beams: new Mesher(1, null), ball: null,
  };
  const wallMesher = (name) => M[name];

  // ---- walls: every visible tile face, banded so the baked grime gradient has vertices to work with ----
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
  const hw = T / 2;
  for (const f of faces) {
    const st = WALL_STYLE[f.id];
    let upper = st.upper;
    let ut = st.ut;
    if (f.id === 'dancefloor' && f.h % 6 === 0) { upper = 'paint'; ut = [0.2, 0.17, 0.18]; } // painted over black
    if (f.id === 'cloakroom' && f.h % 8 === 0) { upper = 'paint'; ut = [0.95, 0.88, 0.74]; }
    if (f.id === 'bar' && f.h % 9 === 0) { upper = 'paint'; ut = [0.7, 0.55, 0.4]; }
    const jc = (c, y0) => (i, jj) => {
      const q = hash(f.h + i * 131, jj * 17 + Math.round(y0 * 10), 5);
      const k = jit(q, 0.1);
      return [c[0] * k, c[1] * k * jit(q >>> 5, 0.04), c[2] * k];
    };
    const segs = st.dado > 0 ? [[0, st.dado, st.dmesh, st.dt], [st.dado, WALL_H, upper, ut]] : [[0, WALL_H, upper, ut]];
    for (const [y0, y1, mesh, col] of segs) {
      const m = wallMesher(mesh);
      m.swap = mesh === 'wood'; // vertical boarding
      vgrid(m, f.f, -hw, hw, y0, y1, 0, jc(col, y0), 4, Math.max(1, Math.ceil((y1 - y0) / 0.85)));
      m.swap = false;
    }
    // skirting and dado rail
    obox(M.wood, f.f, -hw, hw, 0, 0.16, 0, 0.04, [0.3, 0.22, 0.16], { bottom: false });
    if (st.dado > 0) obox(M.wood, f.f, -hw, hw, st.dado - 0.02, st.dado + 0.06, 0, 0.07, [0.34, 0.24, 0.16], { bottom: false });
  }

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
      for (let sz = 0; sz < 2; sz++) {
        for (let sx = 0; sx < 2; sx++) {
          const j = jit(hash(c * 2 + sx, r * 2 + sz, 5), 0.07);
          const a = x0 + sx;
          const b = z0 + sz;
          fm.quad([a, 0, b + 1], [a + 1, 0, b + 1], [a + 1, 0, b], [a, 0, b], [ft[0] * j, ft[1] * j, ft[2] * j], [0, 1, 0]);
        }
      }
      const cj = jit(hash(c, r, 9), 0.08);
      M.plaster.quad([x0, WALL_H, z0], [x0 + T, WALL_H, z0], [x0 + T, WALL_H, z0 + T], [x0, WALL_H, z0 + T], [0.85 * cj, 0.78 * cj, 0.7 * cj], [0, -1, 0]);
    }
  }

  // ---- stone arches over every doorway, and the doors themselves ----
  const SPRING = 2.45;
  const doorLeaves = [];
  doors.forEach((d, i) => {
    const span = d.axis === 'x' ? [1, 0] : [0, 1];
    const nrm = d.axis === 'x' ? [0, 1] : [1, 0];
    const half = 2;
    const th = 0.5;
    const rise = WALL_H - SPRING;
    const N = 10;
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
        const inward = [span[0] * -mx, SPRING - my, span[1] * -mx];
        M.stone.quad(P(a0, y0, -th), P(a1, y1, -th), P(a1, y1, th), P(a0, y0, th), [0.85, 0.8, 0.72], inward);
      }
    }
    // keystone
    const kf = frame(d.x + nrm[0] * th, d.z + nrm[1] * th, nrm[0], nrm[1]);
    obox(M.stone, kf, -0.22, 0.22, WALL_H - 0.5, WALL_H, 0, 0.06, [1, 0.96, 0.88], { bottom: false });
    const kb = frame(d.x - nrm[0] * th, d.z - nrm[1] * th, -nrm[0], -nrm[1]);
    obox(M.stone, kb, -0.22, 0.22, WALL_H - 0.5, WALL_H, 0, 0.06, [1, 0.96, 0.88], { bottom: false });

    // the leaf: vertical timber boards with iron straps, built around its own origin
    const lm = new Mesher(1.6, null);
    const lf = frame(0, 0, nrm[0], nrm[1]);
    lm.swap = true;
    obox(lm, lf, -1.95, 1.95, 0, WALL_H, -0.25, 0.25, [0.42, 0.3, 0.2], { back: true });
    lm.swap = false;
    for (const y of [0.45, 1.65, 2.85]) obox(lm, lf, -1.95, 1.95, y, y + 0.22, -0.28, 0.28, [0.08, 0.08, 0.09], { back: true, bottom: true });
    obox(lm, lf, -0.07, 0.07, 0, WALL_H, -0.28, 0.28, [0.08, 0.08, 0.09], { back: true, bottom: true });
    for (const sg of [-1, 1]) obox(lm, lf, sg * 0.35 - 0.06, sg * 0.35 + 0.06, 1.0, 1.55, 0.25, 0.4, [0.5, 0.36, 0.14], { back: true }); // brass pulls
    doorLeaves.push({ mesh: lm, i });

    // indicator lamps either side, in a cage, red while locked
    const gm = new Mesher(1, null);
    for (const sg of [-1, 1]) {
      const g = frame(d.x + nrm[0] * sg * 0.95, d.z + nrm[1] * sg * 0.95, nrm[0] * sg, nrm[1] * sg);
      obox(gm, g, -0.16, 0.16, 3.0, 3.22, -0.06, 0.08, [0.04, 0.04, 0.045], { back: true });
      obox(gm, g, -0.1, 0.1, 3.05, 3.17, 0.0, 0.1, [1, 1, 1], { back: true });
    }
    doorLeaves[doorLeaves.length - 1].lamp = gm;
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
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = sub[r * COLS + c];
      const k = at(c, r);
      if (k === FLOOR || k === WALL || k === DOOR) continue;
      const cx = (c + 0.5) * T;
      const cz = (r + 0.5) * T;
      const an = areaOfTile(c, r);
      const id = aid(an);
      const h = hash(c, r, 17);
      if (ch === 'P') {
        M.brick.box(cx - 0.85, 0.3, cz - 0.85, cx + 0.85, WALL_H - 0.25, cz + 0.85, [0.9, 0.78, 0.74]);
        M.stone.box(cx - 1, 0, cz - 1, cx + 1, 0.3, cz + 1, [0.9, 0.86, 0.8]);
        M.stone.box(cx - 1, WALL_H - 0.25, cz - 1, cx + 1, WALL_H, cz + 1, [0.9, 0.86, 0.8]);
      } else if (ch === 'S') {
        M.props.box(cx - 0.95, 0, cz - 0.95, cx + 0.95, 2.8, cz + 0.95, [0.06, 0.06, 0.065]);
        for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nk = at(c + nx, r + nz);
          if (nk === WALL || nk === SPEAKER || nk === PILLAR || nk === STAIRS) continue;
          const f = frame(cx + nx * 0.95, cz + nz * 0.95, nx, nz);
          for (const yy of [0.5, 1.45]) {
            disc(M.props, f, 0, yy, 0.012, 0.43, 12, [0.025, 0.025, 0.028]);
            annulus(M.props, f, 0, yy, 0.02, 0.3, 0.4, 12, [0.2, 0.2, 0.21]);
            disc(M.props, f, 0, yy, 0.03, 0.3, 12, [0.07, 0.07, 0.075]);
            disc(M.props, f, 0, yy, 0.05, 0.09, 8, [0.12, 0.12, 0.125]);
          }
          obox(M.props, f, -0.7, 0.7, 2.0, 2.65, 0, 0.1, [0.045, 0.045, 0.05], { bottom: false });
          for (const u of [-0.35, 0.35]) { disc(M.props, f, u, 2.33, 0.115, 0.17, 10, [0.02, 0.02, 0.022]); disc(M.props, f, u, 2.33, 0.125, 0.06, 6, [0.14, 0.14, 0.15]); }
          for (const yy of [0.96, 1.92]) obox(M.props, f, -0.95, 0.95, yy - 0.02, yy + 0.02, 0, 0.03, [0.14, 0.14, 0.15], { bottom: false });
          obox(M.props, f, -0.14, 0.14, 1.0, 1.08, 0.0, 0.07, [0.16, 0.16, 0.17], { bottom: false }); // handle
        }
      } else if (ch === 'b') {
        M.wood.box(cx - 0.9, 0, cz - 0.9, cx + 0.9, 1.0, cz + 0.9, [0.4, 0.27, 0.18]);
        M.wood.box(cx - 1.0, 1.0, cz - 1.0, cx + 1.0, 1.1, cz + 1.0, [0.78, 0.58, 0.4]);
        M.props.pipe('x', cx - 1, cx + 1, 0.2, cz + 1.0 + 0.12, 0.035, 6, C.brass);
        const n = h % 4;
        for (let b = 0; b < n; b++) {
          const bx = cx - 0.7 + ihash(c, r, 20 + b) * 1.4;
          const bz = cz - 0.5 + ihash(c, r, 30 + b) * 1.0;
          const col = [[0.25, 0.14, 0.04], [0.06, 0.2, 0.1], [0.5, 0.5, 0.45], [0.2, 0.08, 0.06]][(h + b) % 4];
          M.props.frustum(bx, bz, 0.05, 0.05, 1.1, 1.38, 6, col);
          M.props.frustum(bx, bz, 0.02, 0.02, 1.38, 1.5, 6, col);
        }
        if (h % 6 === 0) { M.props.box(cx - 0.12, 1.1, cz + 0.4, cx + 0.12, 1.4, cz + 0.55, C.steel); M.props.box(cx - 0.03, 1.1, cz + 0.2, cx + 0.03, 1.55, cz + 0.4, C.steel); }
      } else if (ch === 'j') {
        if (done.has('j')) continue;
        done.add('j');
        const [c0, r0, c1, r1] = scanBox('j', c, r);
        const x0 = c0 * T + 0.05;
        const x1 = (c1 + 1) * T - 0.05;
        const z0 = r0 * T + 0.05;
        const z1 = (r1 + 1) * T - 0.05;
        M.props.box(x0, 0, z0, x1, 1.1, z1, [0.08, 0.065, 0.06]);
        M.wood.box(x0 - 0.04, 1.1, z0 - 0.04, x1 + 0.04, 1.17, z1 + 0.04, [0.3, 0.2, 0.13]);
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
        for (const dx of [-4.1, 4.1]) {
          M.props.box(cxm + dx - 0.55, 1.17, zm - 0.4, cxm + dx + 0.55, 1.29, zm + 0.4, [0.1, 0.1, 0.11]);
          M.props.frustum(cxm + dx - 0.05, zm, 0.31, 0.31, 1.29, 1.32, 14, [0.52, 0.52, 0.54]);
          M.props.frustum(cxm + dx - 0.05, zm, 0.29, 0.29, 1.32, 1.335, 14, [0.02, 0.02, 0.025]);
          M.props.frustum(cxm + dx - 0.05, zm, 0.08, 0.08, 1.335, 1.345, 8, [0.6, 0.12, 0.1]);
          M.props.box(cxm + dx + 0.38, 1.29, zm - 0.32, cxm + dx + 0.42, 1.34, zm + 0.1, C.steel);
        }
        M.props.box(cxm - 0.6, 1.17, zm - 0.3, cxm + 0.6, 1.3, zm + 0.3, [0.07, 0.07, 0.08]);
        for (let k2 = 0; k2 < 5; k2++) M.props.frustum(cxm - 0.45 + k2 * 0.225, zm - 0.12, 0.035, 0.035, 1.3, 1.34, 6, [0.5, 0.5, 0.5]);
        for (let k2 = 0; k2 < 2; k2++) M.props.box(cxm - 0.35 + k2 * 0.5, 1.3, zm + 0.08, cxm - 0.25 + k2 * 0.5, 1.33, zm + 0.24, [0.55, 0.45, 0.1]);
        M.props.box(cxm + 1.2, 1.17, zm - 0.3, cxm + 2.0, 1.2, zm + 0.2, [0.12, 0.12, 0.13]); // laptop base
        M.props.box(cxm + 1.2, 1.2, zm - 0.3, cxm + 2.0, 1.6, zm - 0.27, [0.1, 0.1, 0.11]);
        M.glow.box(cxm + 1.24, 1.23, zm - 0.268, cxm + 1.96, 1.57, zm - 0.262, glowc(0x6a8fb0, 0.5));
        M.props.frustum(cxm - 2.2, zm + 0.5, 0.05, 0.05, 1.17, 1.45, 6, [0.6, 0.55, 0.4]); M.props.frustum(cxm - 2.2, zm + 0.5, 0.045, 0.045, 1.45, 1.5, 6, [0.5, 0.35, 0.05]); // a pint
      } else if (ch === 'v') {
        const col = [0.3, 0.06, 0.08];
        M.props.box(cx - 0.95, 0, cz - 0.95, cx + 0.95, 0.5, cz + 0.95, col);
        M.props.box(cx - 0.9, 0.5, cz - 0.9, cx + 0.9, 0.58, cz + 0.9, [0.36, 0.08, 0.1]);
        for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          if (at(c + nx, r + nz) !== WALL) continue;
          const f = frame(cx + nx * 0.5, cz + nz * 0.5, -nx, -nz);
          obox(M.props, f, -0.95, 0.95, 0.5, 1.3, -0.45, 0.45, col, { bottom: false });
          obox(M.props, f, -0.95, 0.95, 1.3, 1.35, -0.46, 0.46, C.brass, { bottom: false });
          break;
        }
      } else if (ch === 'x') {
        if (id === 'stairwell' || id === 'cloakroom') {
          const hh = 0.9 + (h % 5) * 0.08;
          M.wood.box(cx - 0.8, 0, cz - 0.75, cx + 0.8, hh, cz + 0.75, [0.55, 0.42, 0.27]);
          M.props.box(cx - 0.82, hh * 0.3, cz - 0.77, cx + 0.82, hh * 0.3 + 0.07, cz + 0.77, C.ironL);
          M.props.box(cx - 0.82, hh * 0.75, cz - 0.77, cx + 0.82, hh * 0.75 + 0.07, cz + 0.77, C.ironL);
        } else if (id === 'bar') {
          for (const [r0, r1, y0, y1] of [[0.62, 0.78, 0, 0.5], [0.78, 0.62, 0.5, 1.02]]) M.wood.frustum(cx, cz, r0, r1, y0, y1, 12, [0.48, 0.34, 0.22], y1 > 1);
          for (const [y, rr] of [[0.14, 0.7], [0.5, 0.79], [0.88, 0.7]]) M.props.frustum(cx, cz, rr + 0.02, rr + 0.02, y, y + 0.07, 12, C.ironL, false);
        } else {
          const hh = 0.85 + (h % 4) * 0.12;
          M.props.box(cx - 0.85, 0, cz - 0.7, cx + 0.85, hh, cz + 0.7, [0.05, 0.05, 0.055]);
          for (const [ex, ez] of [[-0.85, -0.7], [0.85, -0.7], [-0.85, 0.7], [0.85, 0.7]]) M.props.box(cx + ex - 0.04, 0, cz + ez - 0.04, cx + ex + 0.04, hh, cz + ez + 0.04, C.steel);
          M.props.box(cx - 0.86, hh - 0.05, cz - 0.71, cx + 0.86, hh, cz + 0.71, C.steel);
          const sc = patternCols[h % patternCols.length];
          M.props.box(cx - 0.3, 0.3, cz + 0.7, cx + 0.2, 0.55, cz + 0.712, sc);
        }
      } else if (ch === 'r') {
        const costume = id === 'backstage';
        const cols = costume ? [[0.6, 0.12, 0.2], [0.75, 0.62, 0.15], [0.12, 0.35, 0.45], [0.5, 0.2, 0.55], [0.8, 0.8, 0.78]] : [[0.1, 0.1, 0.14], [0.22, 0.17, 0.12], [0.3, 0.3, 0.32], [0.16, 0.08, 0.1], [0.12, 0.2, 0.16], [0.35, 0.28, 0.2]];
        for (const sx of [-0.85, 0.85]) M.props.box(cx + sx - 0.04, 0, cz - 0.04, cx + sx + 0.04, 1.55, cz + 0.04, C.ironL);
        M.props.box(cx - 0.9, 1.5, cz - 0.03, cx + 0.9, 1.55, cz + 0.03, C.ironL);
        M.props.box(cx - 0.9, 0.0, cz - 0.55, cx - 0.82, 0.05, cz + 0.55, C.ironL);
        M.props.box(cx + 0.82, 0.0, cz - 0.55, cx + 0.9, 0.05, cz + 0.55, C.ironL);
        for (let k2 = 0; k2 < 6; k2++) {
          const x = cx - 0.72 + k2 * 0.29;
          const len = 0.8 + ihash(c * 8 + k2, r, 70) * 0.35;
          M.props.box(x - 0.13, 1.5 - len, cz - 0.11, x + 0.13, 1.5, cz + 0.11, cols[(h + k2) % cols.length]);
          M.props.box(x - 0.02, 1.5, cz - 0.02, x + 0.02, 1.62, cz + 0.02, C.steel);
        }
      } else if (ch === 'o') {
        M.props.frustum(cx, cz, 0.1, 0.1, 0, 0.8, 6, C.ironL);
        M.wood.frustum(cx, cz, 0.52, 0.52, 0.78, 0.86, 12, [0.62, 0.45, 0.28]);
        M.props.frustum(cx, cz, 0.3, 0.3, 0, 0.04, 8, C.ironL);
        M.glow.box(cx - 0.04, 0.86, cz - 0.04, cx + 0.04, 0.93, cz + 0.04, glowc(0xffa040, 0.9));
        for (let s = 0; s < 3; s++) {
          const a = (s / 3) * Math.PI * 2 + (h % 7) * 0.2;
          const sx = cx + Math.cos(a) * 0.76;
          const sz = cz + Math.sin(a) * 0.76;
          M.props.frustum(sx, sz, 0.06, 0.06, 0, 0.55, 5, C.ironL, false);
          M.props.frustum(sx, sz, 0.2, 0.2, 0.55, 0.64, 8, [0.3, 0.06, 0.08]);
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
          M.stone.box(x0, 0, za, x1, (s + 1) * 0.3, z1, [0.92, 0.88, 0.82]);
        }
        M.stone.box(x0, 0, r0 * T, x1, n * 0.3, zTop, [0.9, 0.86, 0.8]); // landing
        M.props.box(x1 - 0.06, n * 0.3, r0 * T + 0.3, x1, n * 0.3 + 0.95, z1 - 0.1, C.ironL); // rail
        // the street door at the top: cold light spilling down the steps
        const f = frame((x0 + x1) / 2, r0 * T, 0, 1);
        M.glow.grid(f.p(-1.3, n * 0.3, 0.02), f.p(1.3, n * 0.3, 0.02), f.p(1.3, n * 0.3 + 1.9, 0.02), f.p(-1.3, n * 0.3 + 1.9, 0.02), glowc(0x8aa8e0, 0.85), 1, 1, f.n);
        obox(M.stone, f, -1.5, -1.3, n * 0.3, n * 0.3 + 2.0, 0, 0.12, [0.9, 0.86, 0.8], { bottom: false });
        obox(M.stone, f, 1.3, 1.5, n * 0.3, n * 0.3 + 2.0, 0, 0.12, [0.9, 0.86, 0.8], { bottom: false });
        obox(M.stone, f, -1.5, 1.5, n * 0.3 + 1.9, n * 0.3 + 2.05, 0, 0.12, [0.9, 0.86, 0.8], { bottom: false });
      }
    }
  }

  // ---- ceilings: timber beams across the rooms, brick ribs in the VIP, iron pipes ----
  for (const an of [1, 2, 3, 5]) {
    const a = areas[an];
    for (let c = a.rect.c0 + 2; c <= a.rect.c1; c += 4) {
      let start = -1;
      for (let r = a.rect.r0; r <= a.rect.r1 + 1; r++) {
        const open = r <= a.rect.r1 && at(c, r) !== WALL && at(c, r) !== DOOR && areaOfTile(c, r) === an;
        if (open && start < 0) start = r;
        if (!open && start >= 0) {
          M.wood.box((c + 0.5) * T - 0.17, WALL_H - 0.36, start * T, (c + 0.5) * T + 0.17, WALL_H, r * T, [0.34, 0.23, 0.15]);
          start = -1;
        }
      }
    }
  }
  for (const c of [7, 12, 17, 22, 27]) { // VIP: brick ribs spanning the corridor
    const x = (c + 0.5) * T;
    const z0 = 9 * T;
    const z1 = 13 * T;
    const hz = (z1 - z0) / 2;
    const mz = (z0 + z1) / 2;
    const N = 12;
    for (let k = 0; k < N; k++) {
      const ua = -hz + (2 * hz * k) / N;
      const ub = -hz + (2 * hz * (k + 1)) / N;
      const ya = 2.3 + 0.75 * Math.sqrt(Math.max(0, 1 - (ua / hz) ** 2));
      const yb = 2.3 + 0.75 * Math.sqrt(Math.max(0, 1 - (ub / hz) ** 2));
      const col = [0.78, 0.66, 0.62];
      for (const [sx, nx] of [[0.25, 1], [-0.25, -1]]) M.brick.quad([x + sx, ya, mz + ua], [x + sx, yb, mz + ub], [x + sx, WALL_H, mz + ub], [x + sx, WALL_H, mz + ua], col, [nx, 0, 0]);
      M.brick.quad([x - 0.25, ya, mz + ua], [x + 0.25, ya, mz + ua], [x + 0.25, yb, mz + ub], [x - 0.25, yb, mz + ub], col, [0, -1, 0]);
    }
  }
  const PIPES = [
    ['stairwell', 'x', 8, 14, 3.2, 81.2], ['cloakroom', 'x', 17, 44, 3.2, 79.3], ['dancefloor', 'x', 3, 68, 3.22, 48.7], ['dancefloor', 'z', 49, 75, 3.22, 2.7],
    ['bar', 'x', 3, 56, 3.22, 29.3], ['backstage', 'x', 9, 68, 3.2, 2.7], ['backstage', 'x', 9, 68, 3.0, 3.1], ['vip', 'x', 3, 68, 3.05, 18.4],
  ];
  for (const [, axis, a0, a1, y, cc] of PIPES) {
    M.props.pipe(axis, a0, a1, y, cc, 0.07, 8, [0.15, 0.12, 0.1]);
    for (let a = a0 + 2; a < a1; a += 5) {
      if (axis === 'x') M.props.box(a - 0.03, y, cc - 0.03, a + 0.03, WALL_H, cc + 0.03, C.ironL);
      else M.props.box(cc - 0.03, y, a - 0.03, cc + 0.03, WALL_H, a + 0.03, C.ironL);
    }
  }

  // ---- lamps ----
  const pendant = (c, r, shade) => {
    const x = c * T;
    const z = r * T;
    const y = 2.55;
    M.props.box(x - 0.015, y + 0.25, z - 0.015, x + 0.015, WALL_H, z + 0.015, C.black);
    M.props.frustum(x, z, 0.1, 0.34, y, y + 0.28, 10, shade, true);
    M.glow.frustum(x, z, 0.1, 0.1, y - 0.04, y + 0.02, 6, glowc(0xffd9a0, 1.0), true);
    const f = frame(x, z, 0, 1);
    M.glow.quad([x - 0.26, y + 0.005, z + 0.26], [x + 0.26, y + 0.005, z + 0.26], [x + 0.26, y + 0.005, z - 0.26], [x - 0.26, y + 0.005, z - 0.26], glowc(0xffc080, 0.55), [0, -1, 0]);
    void f;
  };
  const SHADES = [[0.1, 0.22, 0.15], [0.55, 0.5, 0.38], [0.06, 0.06, 0.07], [0.4, 0.1, 0.1]];
  for (const [id, ps] of PENDANT) ps.forEach(([c, r], i) => pendant(c, r, id === 'vip' ? [0.35, 0.08, 0.1] : SHADES[(i + (id === 'bar' ? 1 : 0)) % SHADES.length]));
  for (const [, ps] of BULBS) {
    for (const [c, r] of ps) {
      const x = c * T;
      const z = r * T;
      M.props.box(x - 0.012, 2.6, z - 0.012, x + 0.012, WALL_H, z + 0.012, C.black);
      M.props.frustum(x, z, 0.035, 0.035, 2.55, 2.62, 6, C.iron);
      M.glow.frustum(x, z, 0.03, 0.065, 2.5, 2.55, 8, glowc(0xffe2a8, 1.05), false);
      M.glow.frustum(x, z, 0.065, 0.065, 2.43, 2.5, 8, glowc(0xffe2a8, 1.05), false);
      M.glow.frustum(x, z, 0.065, 0.0, 2.37, 2.43, 8, glowc(0xffe2a8, 1.05), false);
    }
  }
  // stage rigs over the dancefloor
  for (const [z, x0, x1] of [[27.5, 8, 32], [36, 11, 29]]) {
    for (const dz of [-0.12, 0.12]) M.props.pipe('x', x0 * T, x1 * T, 3.05, z * T + dz, 0.04, 6, C.iron);
    for (let x = x0 * T; x < x1 * T; x += 1.5) M.props.box(x - 0.015, 3.05, z * T - 0.12, x + 0.015, 3.15, z * T + 0.12, C.iron);
    for (const sx of [x0 * T + 0.4, x1 * T - 0.4]) M.props.box(sx - 0.03, 3.05, z * T - 0.03, sx + 0.03, WALL_H, z * T + 0.03, C.ironL);
  }
  const beamTris = [];
  CANS.forEach(([c, r, red], i) => {
    const x = c * T;
    const z = r * T;
    M.props.frustum(x, z, 0.2, 0.15, 2.7, 3.05, 8, [0.04, 0.04, 0.045]);
    M.props.box(x - 0.2, 3.0, z - 0.03, x + 0.2, 3.05, z + 0.03, C.ironL);
    M.glow.quad([x - 0.14, 2.695, z + 0.14], [x + 0.14, 2.695, z + 0.14], [x + 0.14, 2.695, z - 0.14], [x - 0.14, 2.695, z - 0.14], glowc(red ? 0xff3a22 : 0xffa030, 1.0), [0, -1, 0]);
    beamTris.push({ x, z, red, i });
  });
  for (const b of beamTris) {
    const tx = b.x + (ihash(b.i, 1, 5) - 0.5) * 5;
    const tz = b.z + (ihash(b.i, 2, 5) - 0.5) * 5;
    const col = glowc(b.red ? 0xff2a18 : 0xff8a1c, 1);
    M.beams.cone([b.x, 2.68, b.z], 0.12, [tx, 0.02, tz], 1.1, 10, col);
  }

  // ---- wall dressing: posters, alcoves, extinguishers, banners ----
  const poster = (f, u, y, w, hgt, col, h) => {
    obox(M.props, f, u - w / 2 - 0.04, u + w / 2 + 0.04, y - 0.04, y + hgt + 0.04, 0, 0.012, [0.72, 0.68, 0.56], { bottom: false });
    obox(M.props, f, u - w / 2, u + w / 2, y, y + hgt, 0, 0.018, col, { bottom: false });
    obox(M.props, f, u - w / 2 + 0.06, u + w / 2 - 0.06, y + hgt * 0.55, y + hgt * 0.7, 0, 0.024, [0.85, 0.82, 0.7], { bottom: false });
    obox(M.props, f, u - w / 2 + 0.06, u + w / 2 - 0.06, y + 0.08, y + 0.2, 0, 0.024, [0.1, 0.1, 0.1], { bottom: false });
    void h;
  };
  const POSTER_COLS = [[0.65, 0.12, 0.1], [0.78, 0.6, 0.12], [0.1, 0.4, 0.45], [0.08, 0.08, 0.1], [0.55, 0.18, 0.4], [0.2, 0.3, 0.6]];
  const alcove = (f, w, mode) => {
    const spring = 1.5;
    const rise = 0.65;
    const N = 10;
    const inner = [];
    const outer = [];
    for (let k = 0; k <= N; k++) {
      const th = Math.PI - (Math.PI * k) / N;
      inner.push([(w / 2) * Math.cos(th), spring + rise * Math.sin(th)]);
      outer.push([(w / 2 + 0.2) * Math.cos(th), spring + (rise + 0.2) * Math.sin(th)]);
    }
    const dark = mode === 'mirror' ? [0.16, 0.19, 0.2] : [0.05, 0.035, 0.03];
    M.props.quad(f.p(-w / 2, 0.16, 0.012), f.p(w / 2, 0.16, 0.012), f.p(w / 2, spring, 0.012), f.p(-w / 2, spring, 0.012), dark, f.n);
    for (let k = 0; k < N; k++) {
      M.props.tri(f.p(0, spring, 0.012), f.p(inner[k][0], inner[k][1], 0.012), f.p(inner[k + 1][0], inner[k + 1][1], 0.012), dark, f.n);
      M.stone.quad(f.p(inner[k][0], inner[k][1], 0.1), f.p(outer[k][0], outer[k][1], 0.1), f.p(outer[k + 1][0], outer[k + 1][1], 0.1), f.p(inner[k + 1][0], inner[k + 1][1], 0.1), [0.95, 0.9, 0.82], f.n);
      M.stone.quad(f.p(outer[k][0], outer[k][1], 0.0), f.p(outer[k][0], outer[k][1], 0.1), f.p(outer[k + 1][0], outer[k + 1][1], 0.1), f.p(outer[k + 1][0], outer[k + 1][1], 0.0), [0.8, 0.76, 0.7], [outer[k][0] + outer[k + 1][0], outer[k][1] + outer[k + 1][1] - spring, 0].map((v, q) => (q === 0 ? v * f.t[0] : q === 1 ? v : v * f.t[2])));
    }
    obox(M.stone, f, -w / 2 - 0.2, -w / 2, 0, spring, 0, 0.1, [0.95, 0.9, 0.82], { bottom: false });
    obox(M.stone, f, w / 2, w / 2 + 0.2, 0, spring, 0, 0.1, [0.95, 0.9, 0.82], { bottom: false });
    obox(M.stone, f, -w / 2 - 0.2, w / 2 + 0.2, 0.12, 0.18, 0, 0.16, [0.9, 0.86, 0.78], { bottom: false }); // sill
    if (mode === 'shelves') {
      for (const y of [0.55, 1.0, 1.45]) {
        obox(M.wood, f, -w / 2, w / 2, y, y + 0.04, 0, 0.3, [0.45, 0.32, 0.2], { bottom: false });
        for (let b = 0; b < 4; b++) {
          const col = [[0.28, 0.15, 0.04], [0.06, 0.22, 0.1], [0.5, 0.5, 0.44], [0.22, 0.08, 0.05], [0.4, 0.28, 0.08]][(f.cx * 3 + f.cz + b + y * 7) % 5 | 0];
          const u = -w / 2 + 0.17 + b * 0.32;
          M.props.frustum(f.cx + f.t[0] * u + f.n[0] * 0.14, f.cz + f.t[2] * u + f.n[2] * 0.14, 0.045, 0.045, y + 0.04, y + 0.25, 6, col);
          M.props.frustum(f.cx + f.t[0] * u + f.n[0] * 0.14, f.cz + f.t[2] * u + f.n[2] * 0.14, 0.018, 0.018, y + 0.25, y + 0.36, 6, col);
        }
      }
    } else if (mode === 'bulb') {
      M.glow.box(f.cx + f.n[0] * 0.2 - 0.04, 1.1, f.cz + f.n[2] * 0.2 - 0.04, f.cx + f.n[0] * 0.2 + 0.04, 1.2, f.cz + f.n[2] * 0.2 + 0.04, glowc(0xff6a30, 0.9));
    } else if (mode === 'mirror') {
      obox(M.props, f, -w / 2 + 0.03, w / 2 - 0.03, 0.3, spring, 0.02, 0.03, [0.25, 0.28, 0.3], { bottom: false });
    }
  };
  for (const fc of faces) {
    const id = fc.id;
    const { c, r, nx, nz, h, f } = fc;
    if (fc.jamb) continue;
    if (id === 'bar' && r === 13 && nz === 1 && c >= 5 && c <= 24 && c % 2 === 1) { alcove(f, 1.3, 'shelves'); continue; }
    if (id === 'cloakroom' && r === 38 && nz === 1 && c >= 9 && c <= 16 && c % 2 === 1) { alcove(f, 1.3, 'bulb'); continue; }
    if (id === 'vip' && ((r === 8 && nz === 1 && c % 4 === 2 && c >= 6 && c <= 28) || (r === 13 && nz === -1 && c % 4 === 0 && c >= 8 && c <= 28))) { alcove(f, 1.3, 'mirror'); continue; }
    if (id === 'dancefloor' && r === 23 && nz === 1 && [3, 6, 9, 24, 27].includes(c)) { alcove(f, 1.3, 'bulb'); continue; }
    if (id === 'dancefloor' && r === 23 && nz === 1 && c >= 14 && c <= 21) { // banners behind the DJ
      obox(M.props, f, -0.8, 0.8, 1.5, 3.1, 0, 0.03, c % 2 ? [0.4, 0.06, 0.07] : [0.12, 0.1, 0.16], { bottom: false });
      obox(M.props, f, -0.8, 0.8, 3.0, 3.1, 0, 0.04, C.brass, { bottom: false });
      continue;
    }
    if (h % 5 === 0 && (id === 'cloakroom' || id === 'dancefloor' || id === 'backstage' || id === 'stairwell')) {
      poster(f, ((h >>> 4) % 5) * 0.2 - 0.4, 1.35 + ((h >>> 8) % 4) * 0.2, 0.7, 1.0, POSTER_COLS[h % POSTER_COLS.length], h);
    } else if (h % 23 === 1 && id !== 'vip') {
      obox(M.props, f, -0.1, 0.1, 0.55, 1.0, 0, 0.18, [0.55, 0.06, 0.05], { bottom: false });
      obox(M.props, f, -0.04, 0.04, 1.0, 1.1, 0.04, 0.1, C.iron, { bottom: false });
    }
    void nx;
  }
  // exit signs: green boxes over the doors, and the fire door at the end
  const signs = new Mesher(1, null);
  doors.forEach((d) => {
    const nrm = d.axis === 'x' ? [0, 1] : [1, 0];
    for (const sg of [-1, 1]) {
      const f = frame(d.x + nrm[0] * sg * 1.18, d.z + nrm[1] * sg * 1.18, nrm[0] * sg, nrm[1] * sg);
      if (d.id !== 'd1') {
        obox(M.props, f, -0.32, 0.32, 3.0, 3.26, -0.04, 0.0, C.black, { bottom: false, back: true });
        obox(signs, f, -0.28, 0.28, 3.02, 3.24, 0.0, 0.015, glowc(0x35d07a, 0.9), { bottom: false });
      }
    }
  });
  {
    const f = frame(2.02, 8, 1, 0); // west wall of the exit alcove
    M.glow.grid(f.p(-1.7, 0, 0.0), f.p(1.7, 0, 0.0), f.p(1.7, 2.6, 0.0), f.p(-1.7, 2.6, 0.0), glowc(0xb8f0c8, 0.8), 1, 1, f.n);
    obox(M.stone, f, -1.95, -1.7, 0, 2.8, 0, 0.15, [0.9, 0.86, 0.8], { bottom: false });
    obox(M.stone, f, 1.7, 1.95, 0, 2.8, 0, 0.15, [0.9, 0.86, 0.8], { bottom: false });
    obox(M.stone, f, -1.95, 1.95, 2.6, 2.8, 0, 0.15, [0.9, 0.86, 0.8], { bottom: false });
    obox(signs, f, -0.5, 0.5, 2.9, 3.15, 0, 0.02, glowc(0x35d07a, 1), { bottom: false });
    // green floor mark where the exit circle is
    const ex = ctx.exit;
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2;
      const a1 = ((i + 1) / 24) * Math.PI * 2;
      M.glow.quad([ex.x + Math.cos(a0) * 1.15, 0.03, ex.z + Math.sin(a0) * 1.15], [ex.x + Math.cos(a0) * 1.35, 0.03, ex.z + Math.sin(a0) * 1.35],
        [ex.x + Math.cos(a1) * 1.35, 0.03, ex.z + Math.sin(a1) * 1.35], [ex.x + Math.cos(a1) * 1.15, 0.03, ex.z + Math.sin(a1) * 1.15], glowc(0x35d07a, 0.55), [0, 1, 0]);
    }
  }
  // two classic neon bar signs: a cocktail glass and a lightning bolt (no lettering)
  {
    const f = frame(2.0, 33, 1, 0); // bar, west wall rows 15-17 (z 30-36)
    const col = glowc(0xff4f9a, 1);
    const w = 0.05;
    ribbon(M.neon, f, -0.45, 2.1, 0.45, 2.1, w, 0.04, col);
    ribbon(M.neon, f, -0.45, 2.1, 0, 1.45, w, 0.04, col);
    ribbon(M.neon, f, 0.45, 2.1, 0, 1.45, w, 0.04, col);
    ribbon(M.neon, f, 0, 1.45, 0, 0.95, w, 0.04, col);
    ribbon(M.neon, f, -0.3, 0.95, 0.3, 0.95, w, 0.04, col);
    ribbon(M.neon, f, 0.15, 2.1, 0.3, 2.45, w, 0.04, col);
    const g = frame(70 - 2.0, 61, -1, 0); // dancefloor, east wall, rows 29-31
    const b2 = glowc(0x4a9aff, 1);
    ribbon(M.neon, g, 0.25, 2.5, -0.2, 1.7, w, 0.04, b2);
    ribbon(M.neon, g, -0.2, 1.7, 0.2, 1.7, w, 0.04, b2);
    ribbon(M.neon, g, 0.2, 1.7, -0.25, 0.8, w, 0.04, b2);
  }
  // sticky patches and spilled drinks
  for (const [c, r, rad] of [[8.5, 33.5, 0.9], [22, 29.5, 0.7], [27.5, 33, 0.8], [12, 36, 0.6], [30, 26, 0.7], [16, 29, 0.5], [9.5, 20.5, 0.8], [20, 22, 0.6], [26, 20, 0.7], [4.5, 16.5, 0.6]]) {
    patch(M.props, c * T, 0.015, r * T, rad, 9, [0.02, 0.016, 0.014], c * 7 + r);
  }

  // ---- materials and meshes ----
  const lam = (map) => new THREE.MeshLambertMaterial({ map, vertexColors: true });
  const group = new THREE.Group();
  group.name = 'cowgate';
  const add = (m) => { if (m) group.add(m); return m; };
  add(M.brick.mesh(lam(tex.brick)));
  add(M.paint.mesh(lam(tex.paint)));
  add(M.stone.mesh(lam(tex.stone)));
  add(M.flag.mesh(lam(tex.flag)));
  add(M.floorboards.mesh(lam(tex.floorboards)));
  add(M.carpet.mesh(lam(tex.carpet)));
  add(M.concrete.mesh(lam(tex.concrete)));
  const ceilMesh = add(M.plaster.mesh(lam(tex.plaster)));
  if (ceilMesh) ceilMesh.userData.ceil = true;
  add(M.wood.mesh(lam(tex.boards)));
  add(M.props.mesh(new THREE.MeshLambertMaterial({ vertexColors: true })));
  add(M.glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true })));
  add(signs.mesh(new THREE.MeshBasicMaterial({ vertexColors: true })));
  const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  add(M.neon.mesh(neonMat));
  const beamMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
  const beamMesh = add(M.beams.mesh(beamMat));
  if (beamMesh) beamMesh.renderOrder = 2;

  // mirror ball
  const ballGeo = new THREE.IcosahedronGeometry(0.4, 1);
  const ball = new THREE.Mesh(ballGeo, new THREE.MeshLambertMaterial({ color: 0x909098, emissive: 0x100e0c, flatShading: true }));
  ball.position.set(17.5 * T, 2.55, 30.5 * T);
  group.add(ball);
  const cord = new Mesher(1, null);
  cord.box(17.5 * T - 0.015, 3.0, 30.5 * T - 0.015, 17.5 * T + 0.015, WALL_H, 30.5 * T + 0.015, [0.05, 0.05, 0.05]);
  add(cord.mesh(new THREE.MeshBasicMaterial({ vertexColors: true })));

  // doors
  const leafMat = lam(tex.boards);
  const doorObjs = doorLeaves.map(({ mesh, lamp, i }) => {
    const leaf = mesh.mesh(leafMat);
    const d = doors[i];
    leaf.position.set(d.x, 0, d.z);
    const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xff2a18 });
    const lampMesh = lamp.mesh(lampMat);
    group.add(leaf);
    group.add(lampMesh);
    return { leaf, lampMat };
  });

  // lights: four, one per big room that needs warmth. The integrator adds the camera light.
  const lights = {
    dance: new THREE.PointLight(0xff4a22, 18, 26, 1.6),
    bar: new THREE.PointLight(0xffa860, 15, 22, 1.6),
    vip: new THREE.PointLight(0xff9a70, 12, 24, 1.6),
    back: new THREE.PointLight(0xdfe8d8, 14, 24, 1.6),
  };
  lights.dance.position.set(17.5 * T, 2.6, 31 * T);
  lights.bar.position.set(14 * T, 2.6, 18 * T);
  lights.vip.position.set(17.5 * T, 2.4, 11 * T);
  lights.back.position.set(19 * T, 2.7, 4 * T);
  Object.values(lights).forEach((l) => group.add(l));
  const base = { dance: 18, bar: 15, vip: 12, back: 14 };
  const red = new THREE.Color(0xff3a1c);
  const amber = new THREE.Color(0xff9a30);

  function doorVisual(i, t, open) {
    const o = doorObjs[i];
    o.leaf.position.y = t * (WALL_H + 0.1);
    o.leaf.visible = t < 0.999;
    o.lampMat.color.setHex(open ? 0x3ddc84 : 0xff2a18);
  }
  function animate(time) {
    const beat = (time * 118) / 60;
    const fr = beat - Math.floor(beat);
    const pulse = Math.pow(1 - fr, 3);
    lights.dance.color.copy(red).lerp(amber, 0.5 + 0.5 * Math.sin(time * 0.9));
    lights.dance.intensity = base.dance * (0.82 + 0.18 * pulse);
    lights.bar.intensity = base.bar * (0.94 + 0.06 * Math.sin(time * 13.1) * Math.sin(time * 7.3));
    lights.vip.intensity = base.vip * (0.96 + 0.04 * Math.sin(time * 2.1));
    lights.back.intensity = base.back * (ihash(Math.floor(time * 11), 0, 91) < 0.05 ? 0.35 : 1); // tired tube
    beamMat.opacity = 0.03 + 0.03 * pulse;
    const ok = ihash(Math.floor(time * 10), 0, 92) > 0.08;
    neonMat.color.setScalar(ok ? 0.92 + 0.08 * Math.sin(time * 40) : 0.25);
    ball.rotation.y = time * 0.6;
  }

  return { group, clock: 0, doorVisual, animate, textures: tex };
}
