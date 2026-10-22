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
// d drpepper, w wray, K bouncer, G shotgun, M smg, L launcher, H medkit.
// <map>
const MAP = [
  '####################################',
  '####....xxx.....xx........xx.......#',
  '#..#...............................#',
  '#EE6................d..............#',
  '#EE6......K.....P.......P..........#',
  '#..#..................d............#',
  '####.............................H.#',
  '####..........rr....rr.............#',
  '###############################55###',
  '#.....vvv.....vvv.....vvv..........#',
  '#..................................#',
  '#.L...............d.......d...w..w.#',
  '#..................................#',
  '###44###############################',
  '#...........................#x.....#',
  '#........w..................#......#',
  '#..................w........#...H..#',
  '#...........................#.....x#',
  '#....bbbbbbbbbbbbbbbbbbbb...#.....x#',
  '#..........o................#......#',
  '#..o...d........P....d.............#',
  '#.............d....................#',
  '#.................o.....o..........#',
  '###############################33###',
  '#...........S.jjjjjjjj.S...........#',
  '#...........S.jjjjjjjj.S...........#',
  '#.......d.....jjjjjjjj.............#',
  '#...........w......................#',
  '#v....S...........................S#',
  '#v....S......................P....S#',
  '#.....S...P................d.......#',
  '#..............P........P..........#',
  '#..M........d......................#',
  '#.................................S#',
  '#.....S...P........SS........P....S#',
  '#v....S....................H...d...#',
  '#v....S............................#',
  '#..................................#',
  '###################22###############',
  '########..............##############',
  '#TTT..x#..............##############',
  '#TTT...#....rrr..P....##############',
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

// Look of each area: wall, dado, neon trim, floor pair, ceiling, ambient tint (baked into vertex colours).
const STYLE = {
  stairwell: { wall: 0x7b8088, dado: 0x41454d, neon: null, stripe: 0xfbbf24, floor: [0x575a62, 0x4a4d55], ceil: 0x30333a, tint: [0.95, 1.0, 1.1], jit: 0.1, crate: 0x7a5a36 },
  cloakroom: { wall: 0x8a5040, dado: 0x4a3224, neon: [0xffb347], floor: [0x6b4630, 0x5a3a28], ceil: 0x2f211b, tint: [1.2, 0.95, 0.78], jit: 0.12, crate: 0x4a3326 },
  dancefloor: { wall: 0x30244e, dado: 0x160f28, neon: [COLOURS.magenta, COLOURS.cyan], floor: [0x1d1436, 0x150e28], ceil: 0x0c0818, tint: [0.85, 0.7, 1.25], jit: 0.07, crate: 0x1a1626 },
  bar: { wall: 0x6a4428, dado: 0x2e1d12, neon: [COLOURS.amber, COLOURS.magenta], floor: [0x34303a, 0x1a181e], ceil: 0x21160e, tint: [1.25, 0.95, 0.7], jit: 0.1, crate: 0x4a3a2a },
  vip: { wall: 0x561a38, dado: 0x2e0c20, neon: [0xe0a830], floor: [0x42142c, 0x3a1026], ceil: 0x1e0a18, tint: [1.25, 0.8, 1.0], jit: 0.08, crate: 0x2a1020 },
  backstage: { wall: 0x465062, dado: 0x2a303c, neon: [COLOURS.cyan], floor: [0x373c46, 0x30353e], ceil: 0x1d212a, tint: [0.9, 1.0, 1.25], jit: 0.12, crate: 0x1c1f28 },
};

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
  const KIND_OF = { d: 'drpepper', w: 'wray', K: 'bouncer' };
  const PICK_OF = { G: ['weapon', 'shotgun'], M: ['weapon', 'smg'], L: ['weapon', 'launcher'], H: ['health', 'medkit'] };
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
    ambient: { sky: 0x8a7fc0, ground: 0x2a2038, intensity: 1.0 },
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
    size: { cols: COLS, rows: ROWS },
    tileSolid: (c, r) => blocksMove(c, r),
    tileBlocksShots: (c, r) => blocksShot(c, r),
  };
}

// VISUALS_PLACEHOLDER
function buildVisuals() {
  return { group: new THREE.Group(), clock: 0, doorVisual() {}, animate() {} };
}
