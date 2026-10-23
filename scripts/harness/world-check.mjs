// Headless checks for src/world.js: node scripts/harness/world-check.mjs
import * as THREE from '../../vendor/three.module.min.js';
import { buildWorld } from '../../src/world.js';
import { TILE } from '../../src/consts.js';

let failures = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${msg}`); }
};
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const section = (s) => console.log(`\n${s}`);

// deterministic RNG so failures reproduce
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const openAll = (w) => {
  w.doors.forEach((d) => w.setDoorOpen(d.id, true));
  w.update(1, 0);
};
const tileOf = (v) => Math.floor(v / TILE);
// distance from a point to the nearest solid tile box (what a circle of that radius would touch)
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

// ---------------------------------------------------------------- 1 spawns
section('1. spawn clearance');
{
  const w = buildWorld();
  ok(w.areas.length === 6, 'six areas');
  ok(clearance(w, w.start.x, w.start.z) >= 1.2, 'start has 1.2 clearance');
  const want = { stairwell: 0, cloakroom: 3, dancefloor: 5, bar: 6, vip: 4, backstage: 3 }; // with the placed Mimic, Shaken, Longshot and Nurse (docs/placement.md)
  for (const a of w.areas) {
    ok(a.spawns.length === want[a.id], `${a.id} spawn count ${a.spawns.length}`);
    for (const s of a.spawns) {
      ok(!w.isSolidAt(s.x, s.z), `${a.id} spawn on walkable tile`);
      ok(w.areaAt(s.x, s.z) === a, `${a.id} spawn lies in its own area`);
      const cl = clearance(w, s.x, s.z);
      const need = s.kind === 'mimic' ? 1.0 : 1.2; // a Mimic stands against a wall
      ok(cl >= need, `${a.id} ${s.kind} at ${s.x},${s.z} clearance ${cl.toFixed(2)} >= ${need}`);
      ok(Number.isFinite(s.yaw), `${a.id} spawn yaw finite`);
    }
  }
  const kinds = (id) => w.areas.find((a) => a.id === id).spawns.reduce((m, s) => ((m[s.kind] = (m[s.kind] || 0) + 1), m), {});
  const eq = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  ok(eq(kinds('cloakroom'), { fizzbang: 2, mimic: 1 }), 'cloakroom: 2 fizzbang and a dormant mimic');
  ok(eq(kinds('dancefloor'), { fizzbang: 3, shaken: 1, longshot: 1 }), 'dancefloor: 3 fizzbang, 1 shaken, 1 longshot');
  ok(eq(kinds('bar'), { bampot: 2, fizzbang: 3, nurse: 1 }), 'bar: 2 bampot 3 fizzbang and a nurse');
  ok(eq(kinds('vip'), { fizzbang: 2, bampot: 2 }), 'vip: 2 fizzbang 2 bampot');
  ok(eq(kinds('backstage'), { bouncer: 1, fizzbang: 2 }), 'backstage: bouncer + 2 fizzbang');
  // the bouncer needs room: clearance bigger than its radius
  const boss = w.areas[5].spawns.find((s) => s.kind === 'bouncer');
  ok(clearance(w, boss.x, boss.z) >= 1.9, 'bouncer has room');
}

// ---------------------------------------------------------------- 2 connectivity
section('2. flow field and doors');
{
  const w = buildWorld();
  const ff = w.createFlowField();
  // doors as shipped: only d1 open
  const reach = (id) => w.areas.find((a) => a.id === id).spawns.every((s) => Number.isFinite(ff.distAt(s.x, s.z)));
  const none = (id) => w.areas.find((a) => a.id === id).spawns.every((s) => !Number.isFinite(ff.distAt(s.x, s.z)));
  ff.update(w.start.x, w.start.z);
  ok(reach('cloakroom'), 'cloakroom reachable through the open stairwell door');
  ok(none('dancefloor') && none('bar') && none('vip') && none('backstage'), 'closed d2 separates the dancefloor');
  ok(!Number.isFinite(ff.distAt(w.exit.x, w.exit.z)), 'exit unreachable at the start');
  const order = ['dancefloor', 'bar', 'vip', 'backstage'];
  order.forEach((id, i) => {
    w.setDoorOpen(`d${i + 2}`, true);
    w.update(1, 0);
    ff.update(w.start.x, w.start.z);
    ok(reach(id), `${id} reachable once d${i + 2} is open`);
    const next = order[i + 1];
    if (next) ok(none(next), `${next} still cut off by closed d${i + 3}`);
  });
  ok(!Number.isFinite(ff.distAt(w.exit.x, w.exit.z)), 'exit cut off by closed d6');
  w.setDoorOpen('d6', true);
  w.update(1, 0);
  ff.update(w.start.x, w.start.z);
  ok(Number.isFinite(ff.distAt(w.exit.x, w.exit.z)), 'exit reachable with every door open');
  for (const p of w.pickups) ok(Number.isFinite(ff.distAt(p.x, p.z)), `pickup ${p.id} reachable`);
  // distances increase along the chain
  const far = w.areas.map((a) => Math.min(...(a.spawns.length ? a.spawns : [{ x: w.start.x, z: w.start.z }]).map((s) => ff.distAt(s.x, s.z))));
  for (let i = 1; i < far.length; i++) ok(far[i] > far[i - 1], `area ${i} is further than area ${i - 1} (${far[i].toFixed(0)} vs ${far[i - 1].toFixed(0)})`);
  // dirAt: following it from the start reaches the exit without leaving walkable tiles
  ff.update(w.exit.x, w.exit.z);
  let x = w.start.x;
  let z = w.start.z;
  let steps = 0;
  while (steps++ < 4000) {
    const d = ff.dirAt(x, z);
    if (!d) break;
    const m = w.moveCircle(x, z, d.x * 0.3, d.z * 0.3, 0.45);
    x = m.x; z = m.z;
  }
  ok(Math.hypot(x - w.exit.x, z - w.exit.z) < TILE * 1.5, `following dirAt walks from the start to the exit (ended ${x.toFixed(1)},${z.toFixed(1)} after ${steps} steps)`);
  ok(ff.dirAt(w.exit.x, w.exit.z) === null, 'dirAt is null in the target tile');
  // every walkable tile gets a finite distance with doors open (no sealed pockets)
  let pockets = 0;
  for (let r = 0; r < w.size.rows; r++) for (let c = 0; c < w.size.cols; c++) {
    if (!w.tileSolid(c, r) && !Number.isFinite(ff.distAt((c + 0.5) * TILE, (r + 0.5) * TILE))) pockets++;
  }
  ok(pockets === 0, `no sealed pockets (${pockets})`);
  ff.update(-5, -5);
  ok(!Number.isFinite(ff.distAt(w.start.x, w.start.z)), 'update from outside the map gives Infinity');
}

// ---------------------------------------------------------------- 3 moveCircle
section('3. moveCircle');
{
  const w = buildWorld();
  openAll(w);
  const bad = (x, z, r) => {
    const reach = Math.ceil(r / TILE) + 1;
    return clearance(w, x, z, reach) < r - 1e-4;
  };
  for (const r of [0.45, 0.95]) {
    let tested = 0;
    let inside = 0;
    for (let n = 0; n < 6000; n++) {
      const x = rnd() * w.size.cols * TILE;
      const z = rnd() * w.size.rows * TILE;
      if (bad(x, z, r)) continue;
      const ang = rnd() * Math.PI * 2;
      const sp = n % 3 === 0 ? 20 : n % 3 === 1 ? 6 : 0.4;
      const m = w.moveCircle(x, z, Math.cos(ang) * sp, Math.sin(ang) * sp, r);
      tested++;
      if (bad(m.x, m.z, r)) inside++;
      if (w.isSolidAt(m.x, m.z)) inside++;
    }
    ok(tested > 1000 && inside === 0, `r=${r}: ${tested} random pushes, ${inside} ended inside a solid`);
    // zig-zag pushes into corners, many small calls
    let stuck = 0;
    for (let n = 0; n < 300; n++) {
      let x = w.start.x;
      let z = w.start.z;
      for (let k = 0; k < 120; k++) {
        const a = rnd() * Math.PI * 2;
        const m = w.moveCircle(x, z, Math.cos(a) * 1.5, Math.sin(a) * 1.5, r);
        x = m.x; z = m.z;
        if (bad(x, z, r)) { stuck++; break; }
      }
    }
    ok(stuck === 0, `r=${r}: random walk never entered a solid (${stuck})`);
    // corners: from each room corner push diagonally at 20 units
    const corners = [[1, 25, -1, -1], [34, 25, 1, -1], [2, 33, -1, 1], [34, 36, 1, 1], [2, 45, -1, 1], [8, 45, -1, 1]];
    for (const [c, rr, sx, sz] of corners) {
      const m = w.moveCircle((c + 0.5) * TILE, (rr + 0.5) * TILE, sx * 20, sz * 20, 0.45);
      ok(!bad(m.x, m.z, 0.45), `corner push from tile ${c},${rr} stays out of solids`);
    }
  }
  // sliding: dancefloor, open floor, push diagonally into the north wall of the room (row 23 is wall at x<31)
  const sx0 = 20 * TILE;
  const sz0 = 37 * TILE;
  const m = w.moveCircle(sx0, sz0, 1.5, 4, 0.45); // into the south wall (row 38 wall at col 15..18)
  ok(near(m.x, sx0 + 1.5, 1e-6) || m.hit, 'free move is unobstructed or reports a hit');
  const wallZ = 38 * TILE; // south wall of the dancefloor at col 12
  const a = w.moveCircle(12.5 * TILE, wallZ - 1.0, 1.0, 3.0, 0.45);
  ok(a.hit, 'pushing into a wall reports hit');
  ok(near(a.z, wallZ - 0.45, 1e-4), `stops 0.45 from the wall (z=${a.z.toFixed(3)})`);
  ok(near(a.x, 12.5 * TILE + 1.0, 1e-3), `slides along the wall (x moved ${(a.x - 12.5 * TILE).toFixed(3)} of 1.0)`);
  const b = w.moveCircle(12.5 * TILE, wallZ - 1.0, -2.0, 0.5, 0.45);
  ok(!b.hit && near(b.x, 12.5 * TILE - 2.0) && near(b.z, wallZ - 0.5), 'free move returns exact position, no hit');
  // a closed door blocks a circle; an open one lets it through
  const w2 = buildWorld();
  const d2 = w2.doors.find((d) => d.id === 'd2');
  const before = { x: d2.x, z: d2.z + 3.0 };
  const blocked = w2.moveCircle(before.x, before.z, 0, -10, 0.45);
  ok(blocked.hit && blocked.z > d2.z + TILE / 2, 'closed door stops the player');
  w2.setDoorOpen('d2', true);
  w2.update(1, 0);
  const through = w2.moveCircle(before.x, before.z, 0, -10, 0.45);
  ok(through.z < d2.z - TILE, 'open door lets the player through');
  // the bouncer (0.95) fits through every doorway
  for (const d of w2.doors) {
    w2.setDoorOpen(d.id, true);
  }
  w2.update(1, 0);
  for (const d of w2.doors) {
    const dx = d.axis === 'x' ? 0 : 4;
    const dz = d.axis === 'x' ? 4 : 0;
    const m2 = w2.moveCircle(d.x - dx, d.z - dz, dx * 2, dz * 2, 0.95);
    ok(!m2.hit && near(m2.x, d.x + dx) && near(m2.z, d.z + dz), `bouncer passes through ${d.id}`);
  }
}

// ---------------------------------------------------------------- 4 raycast
section('4. raycast');
{
  const w = buildWorld();
  const S = w.start;
  // straight west at the stairwell wall (col 0 occupies x 0..2)
  ok(near(w.raycast(S.x, S.z, -1, 0, 100), S.x - 2), `west wall distance ${w.raycast(S.x, S.z, -1, 0, 100)} = ${S.x - 2}`);
  ok(near(w.raycast(S.x, S.z, -3, 0, 100), S.x - 2), 'direction is normalised');
  ok(near(w.raycast(S.x, S.z, -1, 0, 3), 3), 'clamped to maxDist');
  ok(near(w.raycast(S.x, S.z, 0, 0, 7), 7), 'zero direction returns maxDist');
  // east through the open d1, over the low coat rails at row 44, to the cloakroom's east wall at x=44
  ok(near(w.raycast(S.x, S.z, 1, 0, 100), 44 - S.x), `through open d1 and over low cover (${w.raycast(S.x, S.z, 1, 0, 100).toFixed(3)} = ${44 - S.x})`);
  // north from the cloakroom at d2 (cols 19-20, row 38): closed door slab is 0.5 thick, centred on z = 77
  const d2 = w.doors.find((d) => d.id === 'd2');
  const ox = d2.x;
  const oz = 81;
  ok(near(w.raycast(ox, oz, 0, -1, 100), oz - (d2.z + 0.25)), `closed door stops the ray at the slab (${w.raycast(ox, oz, 0, -1, 100).toFixed(3)})`);
  ok(!w.los(ox, oz, ox, 60), 'los blocked by closed door');
  w.setDoorOpen('d2', true);
  w.update(1, 0);
  // now the ray continues until the baffle speakers at row 34 (z = 70)
  ok(near(w.raycast(ox, oz, 0, -1, 100), oz - 70), `open door lets the ray through to the speaker stack (${w.raycast(ox, oz, 0, -1, 100).toFixed(3)} = ${oz - 70})`);
  ok(w.los(ox, oz, ox, 72), 'los clear through the open door');
  // low cover: a ray across the bar counter (row 18, z 36..38) is not stopped by it
  const bx = 10 * TILE + 1;
  ok(near(w.raycast(bx, 41, 0, -1, 12), 12) || w.raycast(bx, 41, 0, -1, 12) > 11.9, 'bar counter does not stop a ray');
  ok(w.los(bx, 41, bx, 31), 'los over the bar counter');
  ok(w.isSolidAt(bx, 37), 'bar counter is solid to walking');
  // starting inside a wall
  ok(w.raycast(1, 1, 1, 0, 10) === 0, 'ray starting inside a wall returns 0');
  // brute-force cross-check against fine sampling (all doors open so tiles are the truth)
  w.doors.forEach((d) => w.setDoorOpen(d.id, true));
  w.update(1, 0);
  let wrong = 0;
  let tested = 0;
  for (let n = 0; n < 3000; n++) {
    const x = rnd() * w.size.cols * TILE;
    const z = rnd() * w.size.rows * TILE;
    if (w.tileBlocksShots(tileOf(x), tileOf(z))) continue;
    const a = rnd() * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const maxD = 5 + rnd() * 60;
    let want = maxD;
    for (let t = 0; t < maxD; t += 0.005) {
      if (w.tileBlocksShots(tileOf(x + dx * t), tileOf(z + dz * t))) { want = t; break; }
    }
    const got = w.raycast(x, z, dx, dz, maxD);
    tested++;
    // a ray that clips a wall corner by less than the sampling step is the sampler's miss, not the DDA's
    const clip = got < want && w.tileBlocksShots(tileOf(x + dx * (got + 1e-4)), tileOf(z + dz * (got + 1e-4)));
    if (Math.abs(got - want) > 0.02 && !clip) { wrong++; if (wrong < 4) console.log('  ray mismatch', { x, z, dx, dz, maxD, got, want }); }
  }
  ok(wrong === 0, `${tested} random rays agree with fine sampling (${wrong} differ)`);
}

// ---------------------------------------------------------------- 5 los agrees with raycast
section('5. los');
{
  const w = buildWorld();
  let wrong = 0;
  for (let n = 0; n < 4000; n++) {
    const ax = rnd() * w.size.cols * TILE;
    const az = rnd() * w.size.rows * TILE;
    const bx = ax + (rnd() - 0.5) * 50;
    const bz = az + (rnd() - 0.5) * 50;
    const d = Math.hypot(bx - ax, bz - az);
    const viaRay = w.raycast(ax, az, bx - ax, bz - az, d) >= d - 1e-6;
    if (w.los(ax, az, bx, bz) !== viaRay) wrong++;
    if (w.los(ax, az, bx, bz) !== w.los(bx, bz, ax, az) && w.tileBlocksShots(tileOf(ax), tileOf(az)) === false && w.tileBlocksShots(tileOf(bx), tileOf(bz)) === false) {
      // symmetric when both ends are in open space (door slabs make this exact too)
      wrong++;
    }
  }
  ok(wrong === 0, `los agrees with raycast and is symmetric (${wrong} mismatches)`);
  // adjacent areas separated by walls
  const a = w.start;
  ok(!w.los(a.x, a.z, w.exit.x, w.exit.z), 'no line of sight from the start to the exit');
  ok(w.los(7, 86, 7, 92), 'los inside the stairwell');
}

// ---------------------------------------------------------------- 6 areas partition
section('6. areas');
{
  const w = buildWorld();
  ok(w.doors[0].open === true && w.doors.slice(1).every((d) => d.open === false), 'only d1 starts open');
  openAll(w);
  let walk = 0;
  for (let r = 0; r < w.size.rows; r++) for (let c = 0; c < w.size.cols; c++) {
    const x = (c + 0.5) * TILE;
    const z = (r + 0.5) * TILE;
    const inRects = w.areas.filter((a) => c >= a.rect.c0 && c <= a.rect.c1 && r >= a.rect.r0 && r <= a.rect.r1);
    if (!w.tileSolid(c, r)) {
      walk++;
      ok(inRects.length === 1, `walkable tile ${c},${r} is in exactly one rect (${inRects.length})`);
      ok(w.areaAt(x, z) === inRects[0], `areaAt matches rect at ${c},${r}`);
    }
    ok(inRects.length <= 1, `rects overlap at ${c},${r}`);
  }
  ok(walk > 400, `walkable tile count ${walk}`);
  ok(w.areaAt(-5, -5) === null && w.areaAt(1e4, 1e4) === null, 'areaAt outside the map is null');
  // each door tile belongs to the area it unlocks from
  w.areas.forEach((a) => a.unlocks.forEach((id) => {
    const d = w.doors.find((q) => q.id === id);
    ok(w.areaAt(d.x, d.z) === a, `${id} sits in ${a.id}`);
  }));
  ok(w.areas[0].unlocks.length === 0, 'stairwell unlocks nothing');
  ok(w.areaAt(w.start.x, w.start.z).id === 'stairwell', 'start is in the stairwell');
  ok(w.areaAt(w.exit.x, w.exit.z).id === 'backstage', 'exit is in the backstage rect');
}

// ---------------------------------------------------------------- 7 pickups and exit
section('7. pickups and exit');
{
  const w = buildWorld();
  openAll(w);
  const items = w.pickups.map((p) => `${p.kind}:${p.item}`).sort().join(',');
  const want = ['drink:dram', 'drink:dram', 'drink:dram', 'drink:dram', 'drink:energy', 'drink:energy', 'drink:heavy', 'drink:heavy', 'drink:lastorders', 'drink:lastorders', 'drink:orange', 'weapon:launcher', 'weapon:shotgun', 'weapon:smg', 'weapon:airhorn', 'upgrade:clip', 'upgrade:reload', 'record:haar', 'record:bypass', 'record:gala', 'record:pipes', 'record:wee'].sort().join(',');
  ok(items === want, `pickup set ${items}`);
  ok(w.pickups.every((p) => p.kind !== 'health' && p.item !== 'medkit'), 'no medkits any more');
  ok(w.pickups.filter((p) => p.kind === 'drink').length === 11, 'eleven drinks in the level (nine power-ups and two last orders)');
  const lo = w.pickups.filter((p) => p.item === 'lastorders');
  ok(lo.length === 2, `exactly two lastorders (${lo.length})`);
  w.areas.forEach((a, i) => { // the owner's hard rule: never a super laser in a boss room or its doorway
    if (!a.spawns.some((s) => s.kind === 'bouncer')) return;
    const entry = w.doors[i - 1];
    for (const p of lo) {
      ok(w.areaAt(p.x, p.z) !== a, `lastorders ${p.id} is not inside the boss room (${a.id})`);
      ok(Math.hypot(p.x - entry.x, p.z - entry.z) >= 6, `lastorders ${p.id} is at least 6 units from the boss room door ${entry.id}`);
    }
  });
  const ids = new Set(w.pickups.map((p) => p.id));
  ok(ids.size === w.pickups.length, 'pickup ids are unique');
  for (const p of w.pickups) {
    ok(!w.isSolidAt(p.x, p.z) && clearance(w, p.x, p.z) >= 0.9, `${p.id} is on open floor with room to walk onto`);
  }
  ok(!w.isSolidAt(w.exit.x, w.exit.z), 'exit centre is walkable');
  ok(clearance(w, w.exit.x, w.exit.z) >= w.exit.r * 0.8, 'exit circle is mostly open floor');
  const inArea = (id) => w.pickups.filter((q) => q.id === id).map((q) => w.areaAt(q.x, q.z).id)[0];
  ok(inArea('shotgun-1') === 'cloakroom', 'shotgun in the cloakroom');
  ok(inArea('smg-1') === 'dancefloor', 'smg on the dancefloor');
  ok(inArea('launcher-1') === 'vip', 'launcher in the vip corridor');
  // the placed arsenal (docs/placement.md): one weapon, two upgrades and five records
  ok(inArea('airhorn-1') === 'bar', 'airhorn in the bar');
  ok(inArea('clip-1') === 'cloakroom' && inArea('reload-1') === 'vip', 'clip upgrade in the cloakroom, reload upgrade in the vip corridor');
  for (const [id, area] of [['haar', 'stairwell'], ['bypass', 'dancefloor'], ['gala', 'bar'], ['pipes', 'vip'], ['wee', 'backstage']]) ok(inArea(`${id}-1`) === area, `record ${id} in the ${area}`);
  const wee = w.pickups.find((p) => p.item === 'wee');
  ok(Math.hypot(wee.x - w.exit.x, wee.z - w.exit.z) > w.exit.r + 1, 'the backstage record lies beside the exit, outside its circle (finding it does not end the level)');
  const drinksIn = (area) => w.pickups.filter((p) => p.kind === 'drink' && w.areaAt(p.x, p.z).id === area).map((p) => p.item).sort().join(',');
  ok(drinksIn('stairwell') === '', 'no drinks in the stairwell');
  ok(drinksIn('cloakroom') === 'orange', `cloakroom drinks: ${drinksIn('cloakroom')}`);
  ok(drinksIn('dancefloor') === 'dram,energy,lastorders', `dancefloor drinks: ${drinksIn('dancefloor')}`);
  ok(drinksIn('bar') === 'dram,heavy', `bar drinks: ${drinksIn('bar')}`);
  ok(drinksIn('vip') === 'dram,energy,lastorders', `vip drinks: ${drinksIn('vip')}`);
  ok(drinksIn('backstage') === 'dram,heavy', `backstage drinks: ${drinksIn('backstage')}`);
  for (const p of w.pickups) console.log(`  ${p.id.padEnd(11)} ${w.areaAt(p.x, p.z).id.padEnd(10)} tile ${Math.floor(p.x / TILE)},${Math.floor(p.z / TILE)}`);
}

// ---------------------------------------------------------------- 8 door animation
section('8. doors animate');
{
  const w = buildWorld();
  const d = w.doors.find((q) => q.id === 'd3');
  ok(w.isSolidAt(d.x, d.z), 'closed door is solid');
  w.setDoorOpen('d3', true);
  ok(d.open === true, 'door.open follows setDoorOpen');
  ok(w.isSolidAt(d.x, d.z), 'still solid straight after the command');
  w.update(0.2, 0.2);
  ok(w.isSolidAt(d.x, d.z), 'solid at a third open');
  w.update(0.2, 0.4);
  ok(w.isSolidAt(d.x, d.z), 'solid at two thirds open');
  w.update(0.15, 0.55);
  ok(!w.isSolidAt(d.x, d.z), 'passable once nearly open');
  ok(w.los(d.x, d.z + 3, d.x, d.z - 3), 'bullets pass once nearly open');
  w.setDoorOpen('d3', false);
  w.update(0.3, 0.9);
  ok(w.isSolidAt(d.x, d.z), 'closing makes it solid again');
  ok(w.doors[0].open && !w.isSolidAt(w.doors[0].x, w.doors[0].z), 'd1 starts open and passable');
  w.update(0.01);
  w.update(0.01, undefined);
}

// ---------------------------------------------------------------- 9 enemies hidden at the door
section('9. nothing visible from the previous area when a door opens');
{
  const w = buildWorld();
  const names = ['d2', 'd3', 'd4', 'd5', 'd6'];
  const lines = [];
  for (let i = 1; i < 5; i++) {
    const w2 = buildWorld();
    const id = names[i - 1];
    const d = w2.doors.find((q) => q.id === id);
    w2.setDoorOpen(id, true);
    w2.update(1, 0);
    const prev = w2.areas[i];
    const next = w2.areas[i + 1];
    const spans = [-1.6, -0.8, 0, 0.8, 1.6];
    const backs = [1.5, 2.5, 3.5, 5];
    let seen = 0;
    const who = [];
    for (const sp of spans) {
      for (const bk of backs) {
        for (const sgn of [-1, 1]) {
          const px = d.axis === 'x' ? d.x + sp : d.x + sgn * bk;
          const pz = d.axis === 'x' ? d.z + sgn * bk : d.z + sp;
          if (w2.areaAt(px, pz) !== prev || w2.isSolidAt(px, pz)) continue;
          for (const s of next.spawns) {
            if (w2.los(px, pz, s.x, s.z)) { seen++; who.push(`${s.kind}@${(s.x / TILE - 0.5) | 0},${(s.z / TILE - 0.5) | 0}`); }
          }
        }
      }
    }
    lines.push(`${id}: ${[...new Set(who)].join(' ') || 'none'}`);
    ok(seen === 0, `${next.id} enemies hidden from the ${id} doorway (${[...new Set(who)].join(' ')})`);
  }
  lines.forEach((l) => console.log('  ' + l));
}

// ---------------------------------------------------------------- 10 render budget and geometry sanity, per quality tier
section('10. render budget, per quality tier');
{
  const budget = { high: 130000, medium: 130000, low: 75000 };
  const reference = buildWorld();
  const tiers = ['high', 'medium', 'low'];
  ok(reference.quality === 'high', 'default quality is high');
  ok(buildWorld({ quality: 'nonsense' }).quality === 'high', 'unknown quality falls back to high');
  ok(buildWorld({}).quality === 'high', 'empty options give high');
  for (const q of tiers) {
    const t0 = performance.now();
    const w = buildWorld({ quality: q });
    const ms = performance.now() - t0;
    let meshes = 0;
    let lights = 0;
    let tris = 0;
    let badTri = 0;
    let nanVerts = 0;
    let standard = 0;
    let withNormalMap = 0;
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const n = new THREE.Vector3();
    const sn = new THREE.Vector3();
    w.group.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        const g = o.geometry;
        const pos = g.attributes.position;
        const nor = g.attributes.normal;
        const idx = g.index;
        tris += (idx ? idx.count : pos.count) / 3;
        for (let i = 0; i < pos.count * 3; i++) if (!Number.isFinite(pos.array[i])) { nanVerts++; break; }
        if (o.material.isMeshStandardMaterial) standard++;
        if (o.material.normalMap) withNormalMap++;
        // winding must agree with the stored normals (a back-face bug is invisible in Node otherwise)
        if (o.material && o.material.side !== THREE.DoubleSide && nor && idx) {
          for (let i = 0; i < idx.count; i += 3) {
            for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx.getX(i + k));
            e1.subVectors(v[1], v[0]);
            e2.subVectors(v[2], v[0]);
            n.crossVectors(e1, e2);
            if (n.lengthSq() < 1e-12) continue;
            sn.fromBufferAttribute(nor, idx.getX(i));
            if (n.normalize().dot(sn) < 0.5) badTri++;
          }
        }
        const col = g.attributes.color;
        if (col) for (let i = 0; i < col.array.length; i++) if (!Number.isFinite(col.array[i])) { nanVerts++; break; }
      }
      if (o.isPointLight) lights++;
    });
    console.log(`  ${q.padEnd(6)} build ${ms.toFixed(0)} ms, ${meshes} draw calls, ${lights} point lights, ${tris} triangles, ${standard} standard materials, ${withNormalMap} with normal maps`);
    ok(meshes <= 40, `${q}: draw calls ${meshes} <= 40`);
    ok(lights <= 4, `${q}: point lights ${lights} <= 4`);
    ok(tris <= budget[q], `${q}: triangles ${tris} <= ${budget[q]}`);
    ok(ms < (q === 'high' ? 2500 : 1800), `${q}: build time ${ms.toFixed(0)} ms is sane (target under 1500 for high on a quiet machine)`);
    ok(nanVerts === 0, `${q}: no NaN vertices or colours`);
    ok(badTri === 0, `${q}: triangle winding agrees with normals (${badTri} bad)`);
    ok(w.fog && w.ambient && w.group && w.look, `${q}: fog, ambient, group and look present`);
    ok(q === 'low' ? standard === 0 : standard > 10, `${q}: material model (${standard} standard)`);
    ok(q === 'low' ? withNormalMap === 0 : withNormalMap >= 8, `${q}: normal maps (${withNormalMap})`);
    // the level itself must not depend on the tier
    let diff = 0;
    for (let r = 0; r < w.size.rows; r++) for (let c = 0; c < w.size.cols; c++) if (w.tileSolid(c, r) !== reference.tileSolid(c, r)) diff++;
    ok(diff === 0 && JSON.stringify(w.pickups) === JSON.stringify(reference.pickups) && JSON.stringify(w.areas) === JSON.stringify(reference.areas), `${q}: same level data as high`);
    // every animated thing stays finite and cheap over a long run
    const t1 = performance.now();
    for (let i = 0; i < 600; i++) w.update(1 / 60, i / 60);
    const upd = performance.now() - t1;
    let dyn = 0;
    w.group.traverse((o) => { if (o.isMesh && o.geometry.attributes.position.usage === THREE.DynamicDrawUsage) for (const x of o.geometry.attributes.position.array) if (!Number.isFinite(x)) dyn++; });
    console.log(`  ${q.padEnd(6)} 600 update() calls: ${upd.toFixed(1)} ms`);
    ok(dyn === 0, `${q}: dynamic vertices stay finite`);
    ok(upd < 400, `${q}: update() is cheap (${upd.toFixed(1)} ms for 600)`);
  }
  const look = reference.look;
  ok(look.exposure > 0.5 && look.exposure < 2 && look.bloom > 0 && look.vignette >= 0 && Array.isArray(look.grade.lift) && Array.isArray(look.grade.gamma) && Array.isArray(look.grade.gain), 'look hints are sane');
  // HDR emissive parts exist (vertex colours above 1 on basic materials) and ordinary surfaces stay at 0 to ~3
  let hdr = 0;
  reference.group.traverse((o) => { if (o.isMesh && o.material.isMeshBasicMaterial && o.geometry.attributes.color) for (const x of o.geometry.attributes.color.array) if (x > 1.5) { hdr++; break; } });
  ok(hdr >= 4, `HDR glow meshes present (${hdr})`);
  const ff = reference.createFlowField();
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) ff.update(reference.start.x, reference.start.z);
  console.log(`  flow field update: ${((performance.now() - t1) / 20).toFixed(2)} ms each`);
}

// ---------------------------------------------------------------- 11 Blender props in level 1
section('11. Blender props in the Cowgate');
{
  const hi = buildWorld({ quality: 'high' });
  const lo = buildWorld({ quality: 'low' });
  const placed = hi.propsPlaced;
  const kinds = (re) => Object.entries(placed).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0);
  // the map decides these numbers: 10 P, 16 S, 4 o, 10 r, 20 b, 13 v, 15 x (7 flight cases, 5 crates, 3 kegs), 18 pendant lamps
  const want = [['pillar', /^pillar$/, 10], ['speaker', /^speaker$/, 16], ['table', /^table$/, 4], ['rail', /^rail_/, 10], ['bar', /^bar$/, 20],
    ['booth', /^booth$/, 13], ['flight case', /^flight_/, 7], ['crate', /^crate_/, 5], ['keg', /^barrel_/, 3], ['pendant', /^pendant$/, 18]];
  for (const [what, re, n] of want) ok(kinds(re) === n, `high: ${n} ${what}(s) placed (${kinds(re)})`);
  ok(Object.keys(lo.propsPlaced).length === 0, 'low: procedural props only, so the cheapest tier is unchanged');
  // props never change what the player can walk through or shoot through
  let diff = 0;
  for (let r = 0; r < hi.size.rows; r++) for (let c = 0; c < hi.size.cols; c++) if (hi.tileSolid(c, r) !== lo.tileSolid(c, r) || hi.tileBlocksShots(c, r) !== lo.tileBlocksShots(c, r)) diff++;
  ok(diff === 0, `props (high) and procedural (low) block movement and shots on the same tiles (${diff} differ)`);
  // every vertex the props add carries finite colour and normals of unit length
  let badN = 0;
  hi.group.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.normal) return;
    const nr = o.geometry.attributes.normal.array;
    for (let i = 0; i < nr.length; i += 3) { const l = Math.hypot(nr[i], nr[i + 1], nr[i + 2]); if (!(l > 0.97 && l < 1.03)) { badN++; break; } }
  });
  ok(badN === 0, `high: every mesh has unit normals (${badN} meshes do not)`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
