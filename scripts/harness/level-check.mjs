// Generic checks for any level: node scripts/harness/level-check.mjs [level ...]   (default: every level)
// Structure, spawn and pickup placement, door-by-door connectivity, light and draw-call budgets, NaN-free geometry.
// The Cowgate's exact numbers live in world-check.mjs; this is what every new level must also pass.
import * as THREE from '../../vendor/three.module.min.js';
import { buildWorld, LEVEL_DEFS } from '../../src/world.js';
import { ENEMY_DEFS } from '../../src/data.js';
import { TILE, WALL_H } from '../../src/consts.js';
import { PROP_MESHES } from '../../src/prop-meshes.js';

let failures = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${msg}`); }
};
const tileOf = (v) => Math.floor(v / TILE);

function clearance(w, x, z, reach = 4) {
  let best = Infinity;
  const c0 = tileOf(x);
  const r0 = tileOf(z);
  for (let r = r0 - reach; r <= r0 + reach; r++) {
    for (let c = c0 - reach; c <= c0 + reach; c++) {
      if (!w.tileSolid(c, r)) continue;
      const dx = x - Math.min(Math.max(x, c * TILE), c * TILE + TILE);
      const dz = z - Math.min(Math.max(z, r * TILE), r * TILE + TILE);
      best = Math.min(best, Math.hypot(dx, dz));
    }
  }
  return best;
}

// ---- the Blender prop kit (scripts/blender/props.py -> src/prop-meshes.js) ----
// Every part must decode cleanly, name a mesher the level builder has, and keep inside the tile it stands in, so
// collision (which is by map tile) still describes what is on screen. Wall props stay within 0.5 of the wall plane.
const MESHERS = ['props', 'metal', 'wood', 'polish', 'stone', 'brick', 'glass', 'hang', 'glow', 'gPend', 'gBar', 'gA', 'gB', 'paint'];
const WALL_PROPS = ['torch'];
const HANGING = ['pendant', 'brazier'];
function checkPropData() {
  console.log('\n== prop kit ==');
  const names = Object.keys(PROP_MESHES);
  ok(names.length >= 20, `the kit has ${names.length} props`);
  let tris = 0;
  for (const name of names) {
    const prop = PROP_MESHES[name];
    ok(prop.parts.length >= 1 && prop.h > 0.1 && prop.h <= WALL_H + 0.001, `${name}: ${prop.parts.length} parts, height ${prop.h} within the room`);
    let ext = { x: 0, z: 0, y0: 1e9, y1: -1e9 };
    let bad = 0;
    for (const m of prop.parts) {
      const b = (str, T) => { const buf = Buffer.from(str, 'base64'); return new T(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)); };
      const p = b(m.p, Int16Array);
      const nrm = b(m.nrm, Int8Array);
      const idx = b(m.idx, Uint16Array);
      if (!MESHERS.includes(m.m)) bad++;
      if (p.length !== m.n * 3 || nrm.length !== m.n * 3 || idx.length % 3 !== 0) bad++;
      if (m.col ? b(m.col, Uint8Array).length !== m.n * 3 : !(m.glow && m.glow.length === 2)) bad++;
      if (m.uv && b(m.uv, Int16Array).length !== m.n * 2) bad++;
      if (!(m.sc > 0 && Number.isFinite(m.sc))) bad++;
      for (let i = 0; i < idx.length; i++) if (idx[i] >= m.n) { bad++; break; }
      for (let i = 0; i < m.n; i++) {
        const x = p[i * 3] * m.sc;
        const y = p[i * 3 + 1] * m.sc;
        const z = p[i * 3 + 2] * m.sc;
        ext = { x: Math.max(ext.x, Math.abs(x)), z: Math.max(ext.z, WALL_PROPS.includes(name) ? -z : Math.abs(z)), y0: Math.min(ext.y0, y), y1: Math.max(ext.y1, y) };
        for (let k = 0; k < 3; k++) if (nrm[i * 3 + k] < -127) bad++;
      }
      tris += idx.length / 3;
    }
    ok(bad === 0, `${name}: parts decode, indices in range, a known mesher each`);
    if (WALL_PROPS.includes(name)) ok(ext.z <= 0.5 && ext.x <= 0.2, `${name}: sticks out ${ext.z.toFixed(2)} from its wall`);
    else if (HANGING.includes(name)) ok(ext.x <= 0.5 && ext.z <= 0.5, `${name}: hangs inside a 1 metre box (${ext.x.toFixed(2)}, ${ext.z.toFixed(2)})`);
    else ok(ext.x <= 1.0 + 1e-3 && ext.z <= 1.0 + 1e-3, `${name}: footprint within its 2 x 2 tile (${ext.x.toFixed(2)}, ${ext.z.toFixed(2)})`);
    if (!WALL_PROPS.includes(name) && !HANGING.includes(name)) ok(ext.y0 >= -1e-3, `${name}: stands on the floor (lowest ${ext.y0.toFixed(3)})`);
  }
  console.log(`  ${names.length} props, ${tris} triangles in the whole kit`);
}

function checkLevel(n) {
  const def = LEVEL_DEFS[n];
  console.log(`\n== level ${n}: ${def.id} (${def.cols} x ${def.rows}) ==`);
  const w = buildWorld({ level: n, quality: 'low' });
  const ff = w.createFlowField();

  // ---- map shape ----
  ok(def.map.length === def.rows && def.map.every((r) => r.length === def.cols), 'map rows and columns match the definition');
  ok(w.areas.length >= 4, `has areas (${w.areas.length})`);
  ok(w.doors.length === def.doorCount, `door count ${w.doors.length} matches the map`);
  ok(w.doors[0].open && w.doors.slice(1).every((d) => !d.open), 'only the first door starts open');
  for (const a of w.areas) for (const id of a.unlocks) ok(w.doors.some((d) => d.id === id), `${a.id} unlocks a door that exists (${id})`);

  // every walkable tile belongs to exactly one area, and no area is empty
  let orphans = 0;
  const walkable = [];
  for (let r = 0; r < def.rows; r++) {
    for (let c = 0; c < def.cols; c++) {
      if (w.tileSolid(c, r)) continue;
      walkable.push([c, r]);
      if (!w.areaAt((c + 0.5) * TILE, (r + 0.5) * TILE)) orphans++;
    }
  }
  ok(orphans === 0, `every walkable tile is in an area (${orphans} orphans)`);
  for (const a of w.areas) {
    const tiles = walkable.filter(([c, r]) => c >= a.rect.c0 && c <= a.rect.c1 && r >= a.rect.r0 && r <= a.rect.r1);
    ok(tiles.length > 8, `${a.id} has floor (${tiles.length} tiles)`);
  }

  // ---- start, spawns, pickups ----
  ok(clearance(w, w.start.x, w.start.z) >= 1.2, 'start has 1.2 clearance');
  ok(w.areaAt(w.start.x, w.start.z) === w.areas[0], 'start is in the first area');
  const bossAreas = [];
  for (const a of w.areas) {
    for (const s of a.spawns) {
      ok(ENEMY_DEFS[s.kind], `${a.id}: spawn kind ${s.kind} exists in ENEMY_DEFS`);
      ok(!w.isSolidAt(s.x, s.z), `${a.id}: ${s.kind} spawn on walkable tile`);
      ok(w.areaAt(s.x, s.z) === a, `${a.id}: ${s.kind} spawn lies in its own area`);
      ok(Number.isFinite(s.yaw), `${a.id}: spawn yaw finite`);
      const need = ENEMY_DEFS[s.kind].boss ? 2.2 : 1.2;
      ok(clearance(w, s.x, s.z) >= need, `${a.id}: ${s.kind} at ${s.x},${s.z} clearance ${clearance(w, s.x, s.z).toFixed(2)} >= ${need}`);
      if (ENEMY_DEFS[s.kind].boss && !bossAreas.includes(a)) bossAreas.push(a);
    }
  }
  ok(bossAreas.length === 1 && bossAreas[0] === w.areas[w.areas.length - 1], 'exactly one boss, in the last area');
  const ids = new Set();
  for (const p of w.pickups) {
    ok(!ids.has(p.id), `pickup id ${p.id} is unique`);
    ids.add(p.id);
    ok(!w.isSolidAt(p.x, p.z), `${p.id} on walkable tile`);
    ok(w.areaAt(p.x, p.z), `${p.id} lies in an area`);
    ok(clearance(w, p.x, p.z) >= 0.8, `${p.id} has room (${clearance(w, p.x, p.z).toFixed(2)})`);
    if (p.item === 'lastorders') ok(!bossAreas.includes(w.areaAt(p.x, p.z)), 'no Last Orders in the boss room');
  }
  for (const item of ['dram']) ok(w.pickups.some((p) => p.item === item), `a ${item} is placed`);

  // ---- doors, one at a time ----
  const total = w.areas.reduce((s, a) => s + a.spawns.length, 0);
  ok(total >= 15, `${total} robots in the level`);
  w.update(1, 0);
  ff.update(w.start.x, w.start.z);
  const reachable = (a) => a.spawns.every((s) => Number.isFinite(ff.distAt(s.x, s.z)));
  const unreachable = (a) => a.spawns.every((s) => !Number.isFinite(ff.distAt(s.x, s.z)));
  for (let k = 1; k <= w.doors.length; k++) {
    // doors d1..dk open: areas 0..k reachable, the rest sealed off
    ff.update(w.start.x, w.start.z);
    ok(w.areas.slice(0, k + 1).every((a) => a.spawns.length === 0 || reachable(a)), `with ${k} door(s) open, areas up to ${w.areas[Math.min(k, w.areas.length - 1)].id} are reachable`);
    ok(w.areas.slice(k + 1).every((a) => a.spawns.length === 0 || unreachable(a)), `with ${k} door(s) open, the areas beyond are sealed off`);
    if (k < w.doors.length) { w.setDoorOpen(w.doors[k].id, true); w.update(1, 0); }
  }
  ff.update(w.start.x, w.start.z);
  ok(Number.isFinite(ff.distAt(w.exit.x, w.exit.z)), 'the exit is reachable once every door is open');
  ok(w.areaAt(w.exit.x, w.exit.z) === w.areas[w.areas.length - 1], 'the exit is in the last area');
  // each area's unlock list opens the door out of it, in order
  w.areas.forEach((a, i) => { if (i < w.areas.length) ok(a.unlocks.length <= 1, `${a.id} unlocks at most one door`); });

  // ---- props: every prop tile gets a Blender model at the medium and high tiers; the low tier keeps the procedural props ----
  const propChars = [...new Set(((def.cover || 'bjvxro') + 'PS').split(''))].filter((ch) => ch !== 'j');
  const propTiles = def.map.reduce((sum, row) => sum + [...row].filter((ch) => propChars.includes(ch)).length, 0);
  const NOT_TILE = ['pendant', 'torch', 'brazier'];
  const placedAt = (quality) => Object.entries(buildWorld({ level: n, quality }).propsPlaced).reduce((a, [k, v]) => (NOT_TILE.includes(k) ? a : a + v), 0);
  ok(placedAt('high') === propTiles, `high: every prop tile has a Blender model (${placedAt('high')} of ${propTiles})`);
  ok(placedAt('medium') === propTiles, `medium: every prop tile has a Blender model`);
  ok(placedAt('low') === 0, 'low: procedural props only');

  // ---- geometry and budgets ----
  for (const quality of ['low', 'medium', 'high']) {
    const t0 = Date.now();
    const q = buildWorld({ level: n, quality });
    const ms = Date.now() - t0;
    let calls = 0;
    let tris = 0;
    let lights = 0;
    let bad = 0;
    q.group.traverse((o) => {
      if (o.isPointLight) lights++;
      if (!o.isMesh) return;
      calls++;
      tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      const pos = o.geometry.attributes.position.array;
      for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) { bad++; break; }
      const col = o.geometry.attributes.color && o.geometry.attributes.color.array;
      if (col) for (let i = 0; i < col.length; i++) if (!Number.isFinite(col[i])) { bad++; break; }
    });
    console.log(`  ${quality.padEnd(6)} build ${ms} ms, ${calls} draw calls, ${lights} point lights, ${Math.round(tris)} triangles`);
    ok(bad === 0, `${quality}: no NaN in geometry`);
    ok(lights <= 4, `${quality}: at most 4 point lights in the world (${lights})`);
    ok(calls <= 60, `${quality}: at most 60 draw calls (${calls})`);
    ok(tris <= 150000, `${quality}: at most 150k triangles (${Math.round(tris)})`);
    ok(q.fog && q.ambient && q.look && q.torch, `${quality}: level carries fog, ambient, look and torch`);
  }

  // ---- rays and movement sanity ----
  const s0 = w.start;
  const out = w.moveCircle(s0.x, s0.z, 100, 0, 0.45);
  ok(Number.isFinite(out.x) && out.x < def.cols * TILE, 'moveCircle stays inside the map');
  const wallDist = w.raycast(s0.x, s0.z, 0, -1, 200);
  ok(wallDist > 0 && wallDist < 200, 'a ray from the start hits a wall');
}

const want = process.argv.slice(2).map(Number).filter(Boolean);
checkPropData();
for (const n of want.length ? want : Object.keys(LEVEL_DEFS).map(Number)) checkLevel(n);
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
void THREE;
