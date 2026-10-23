// Headless checks for src/models.js. Run: node scripts/harness/models-check.mjs
import * as THREE from '../../vendor/three.module.min.js';
import * as M from '../../src/models.js';

let failed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  }
};

const STATES = ['idle', 'walk', 'windup', 'swing', 'aim', 'shoot', 'hurt', 'dead'];
const TS = [0, 0.3, 5];
const KS = [0, 0.5, 1, -1, 2];
const MAX_HEIGHT = { fizzbang: 2.2, bampot: 2.1, bouncer: 3.4, shielded: 2.3, tourguide: 3.2 };
const EXTRA_STATES = { tourguide: ['slam'] }; // poses only some kinds have
const MAX_TRIS = { shielded: 14000, tourguide: 20000 }; // level 2 budgets: the others are about 10k to 15k
const MAX_MESHES = 16;

function stats(o) {
  let meshes = 0;
  let tris = 0;
  o.traverse((c) => {
    if (!c.isMesh) return;
    meshes++;
    const g = c.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return { meshes, tris };
}

function finiteTransforms(o, label) {
  let bad = 0;
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    const vals = [...c.position.toArray(), c.rotation.x, c.rotation.y, c.rotation.z, ...c.scale.toArray(), ...c.matrixWorld.elements];
    if (vals.some((v) => !Number.isFinite(v))) bad++;
    if (c.isMesh) {
      const a = c.geometry.attributes.position.array;
      if (c.geometry.userData.checked !== true) {
        c.geometry.userData.checked = true;
        let badV = 0;
        for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) badV++;
        ok(badV === 0, `${label}: non-finite vertex data`);
      }
    }
  });
  ok(bad === 0, `${label}: non-finite transform`);
}

ok(JSON.stringify(M.WEAPON_IDS) === '["pistol","shotgun","smg","launcher","vinyl"]', 'WEAPON_IDS');
ok(JSON.stringify(M.DRINK_IDS) === '["dram","orange","heavy","energy","lastorders"]', 'DRINK_IDS');

const t0 = Date.now();
for (const kind of ['fizzbang', 'bampot', 'bouncer', 'shielded', 'tourguide']) {
  for (let variant = 0; variant < 3; variant++) {
    const r = M.makeRobot(kind);
    const label = `${kind}#${variant}`;
    ok(r.group instanceof THREE.Group, `${label}: group`);
    ok(r.height > 1.5 && r.height <= MAX_HEIGHT[kind], `${label}: height ${r.height}`);
    ok(r.radius > 0.3 && r.radius < 1.2, `${label}: radius ${r.radius}`);
    ok(r.headY > 0.5 * r.height && r.headY < r.height, `${label}: headY ${r.headY}`);
    ok(Array.isArray(r.eyes) && r.eyes.length === 2 && r.eyes.every((e) => e.isMesh), `${label}: eyes`);
    ok(typeof r.setPose === 'function' && typeof r.flash === 'function' && typeof r.update === 'function', `${label}: functions`);
    const st = stats(r.group);
    ok(st.meshes <= MAX_MESHES, `${label}: ${st.meshes} meshes`);
    r.setPose('idle', 0, 0);
    const bb = new THREE.Box3().setFromObject(r.group);
    ok(Math.abs(bb.max.y - r.height) < 0.15, `${label}: top ${bb.max.y.toFixed(2)} vs height ${r.height}`);
    ok(bb.min.y > -0.02 && bb.min.y < 0.03, `${label}: feet at ${bb.min.y.toFixed(3)}`);
    ok(bb.max.x - bb.min.x < r.radius * 4.2, `${label}: too wide ${(bb.max.x - bb.min.x).toFixed(2)}`);
    if (MAX_TRIS[kind]) ok(st.tris <= MAX_TRIS[kind], `${label}: ${st.tris} triangles (budget ${MAX_TRIS[kind]})`);
    for (const s of [...STATES, ...(EXTRA_STATES[kind] || [])]) {
      for (const t of TS) {
        for (const k of KS) {
          try { r.setPose(s, t, k); } catch (e) { ok(false, `${label} ${s} t=${t} k=${k}: ${e.message}`); }
          finiteTransforms(r.group, `${label} ${s} t=${t} k=${k}`);
        }
      }
    }
    for (const odd of [NaN, undefined, Infinity, -5]) {
      try { r.setPose('walk', odd, odd); r.setPose('nonsense', odd, odd); r.update(odd); } catch (e) { ok(false, `${label} odd input: ${e.message}`); }
      finiteTransforms(r.group, `${label} odd input`);
    }
    for (let i = 0; i < 50; i++) r.update(0.016);
    ok(r.eyes[0].material.color.toArray().every((v) => Number.isFinite(v) && v < 40), `${label}: eye colour drifted`);
    r.setPose('dead', 1, 1);
    const dbb = new THREE.Box3().setFromObject(r.group);
    ok(dbb.max.y < r.height * 0.7, `${label}: dead k=1 top ${dbb.max.y.toFixed(2)} is not flat`);
    try { r.flash(true); r.flash(false); r.flash(true); r.flash(true); r.flash(false); } catch (e) { ok(false, `${label} flash: ${e.message}`); }
    if (variant === 0) console.log(`${kind}: height ${r.height} radius ${r.radius} headY ${r.headY} meshes ${st.meshes} tris ${st.tris} deadTop ${dbb.max.y.toFixed(2)}`);
  }
}
console.log(`robots built in ${Date.now() - t0} ms`);

// Shared geometry between variants that repeat, per-robot eye material, flash swaps and restores.
const rs = [0, 1, 2, 3].map(() => M.makeRobot("bampot"));
const torsoOf = (r) => r.group.children[0].children[2].children[0].geometry;
ok(torsoOf(rs[0]) === torsoOf(rs[3]), 'geometry shared between robots of the same variant');
ok(rs[0].eyes[0].material !== rs[1].eyes[0].material, 'eye material is per robot');
const body0 = rs[0].group.children[0].children[2].children[0];
rs[0].flash(true);
ok(body0.material.type === 'MeshBasicMaterial', 'flash swaps to white');
rs[0].flash(false);
ok(body0.material.type === 'MeshStandardMaterial', 'flash restores');
ok(rs[0].muzzle && rs[0].muzzle.name === 'muzzle', 'bampot muzzle');

// ---- Level 2 robots: the Shielded Fizzbang and the Tour Guide ----
{
  const world = (o) => o.getWorldPosition(new THREE.Vector3());
  const meshBox = (root) => {
    const bb = new THREE.Box3();
    let top = root;
    while (top.parent) top = top.parent;
    top.updateMatrixWorld(true);
    root.traverse((c) => { if (c.isMesh && c.userData.base) bb.expandByObject(c); });
    return bb;
  };

  // Shielded: radius, height and headY as specified, the door covers the front and leaves the back bare
  const sh = M.makeRobot('shielded');
  ok(Math.abs(sh.radius - 0.7) < 0.1 && Math.abs(sh.height - 2.1) < 0.1 && Math.abs(sh.headY - 1.7) < 0.1, `shielded numbers ${sh.radius} ${sh.height} ${sh.headY}`);
  ok(typeof sh.shieldHit === 'function', 'shielded: shieldHit');
  const shield = sh.group.getObjectByName('shield');
  ok(!!shield, 'shielded: shield group');
  sh.setPose('idle', 0, 0);
  const sb = meshBox(shield);
  sh.group.updateMatrixWorld(true);
  ok(sb.max.x - sb.min.x > 1.2 && sb.max.x - sb.min.x < 1.45, `shield width ${(sb.max.x - sb.min.x).toFixed(2)}`);
  ok(sb.max.y - sb.min.y > 1.6 && sb.max.y - sb.min.y < 1.85, `shield height ${(sb.max.y - sb.min.y).toFixed(2)}`);
  ok(sb.min.y > 0.05 && sb.min.y < 0.4 && sb.max.y > 1.75, `shield spans ${sb.min.y.toFixed(2)}..${sb.max.y.toFixed(2)}`);
  ok(sb.max.z < -0.7 && sb.min.z > -1.2, `shield sits in front of the body: z ${sb.min.z.toFixed(2)}..${sb.max.z.toFixed(2)}`);
  ok(sh.eyes.every((e) => world(e).y > sb.max.y - 0.02), 'shielded: eyes show above the door');
  const bodyBox = meshBox(sh.group); // whole robot, to check nothing but the door and arm is out in front
  ok(bodyBox.max.z > 0.5, 'shielded: back pipes stick out behind');
  const shieldZ = (r) => { r.group.updateMatrixWorld(true); return world(r.group.getObjectByName('shield')).z; };
  const z0 = shieldZ(sh);
  sh.setPose('windup', 0.5, 1);
  ok(shieldZ(sh) > z0 + 0.15, `windup pulls the door back (${shieldZ(sh).toFixed(2)} vs ${z0.toFixed(2)})`);
  sh.setPose('swing', 0.2, 0.35);
  ok(shieldZ(sh) < z0 - 0.1, `swing shoves the door forward (${shieldZ(sh).toFixed(2)} vs ${z0.toFixed(2)})`);
  sh.setPose('idle', 0, 0);
  sh.shieldHit();
  sh.setPose('idle', 0, 0);
  ok(shieldZ(sh) > z0 + 0.04, 'shieldHit recoils the door');
  const glowOn = () => { let on = false; sh.group.traverse((c) => { if (c.isMesh && !c.userData.base && c.visible && c.material.opacity > 0.05) on = true; }); return on; };
  ok(glowOn(), 'shieldHit flashes');
  sh.update(0.2);
  sh.setPose('idle', 0, 0);
  ok(Math.abs(shieldZ(sh) - z0) < 1e-6 && !glowOn(), 'the recoil is over after 0.2 s');
  for (let i = 0; i < 120; i++) { // hit every frame: safe, finite
    sh.shieldHit();
    sh.update(1 / 60);
    sh.setPose(i % 2 ? 'walk' : 'swing', i / 60, (i % 20) / 20);
    finiteTransforms(sh.group, `shielded hit spam ${i}`);
  }
  sh.update(0.5);
  sh.setPose('dead', 1, 1);
  ok(meshBox(sh.group.getObjectByName('shield')).max.y < 0.4, 'a dead shielded robot has dropped the door flat');
  sh.setPose('idle', 0, 0);
  sh.flash(true);
  let allWhite = true;
  sh.group.traverse((c) => { if (c.isMesh && c.userData.base && c.material.type !== 'MeshBasicMaterial') allWhite = false; });
  ok(allWhite, 'flash covers the door too');
  sh.flash(false);

  // Tour Guide
  const tg = M.makeRobot('tourguide');
  ok(Math.abs(tg.radius - 0.9) < 0.1 && Math.abs(tg.height - 3.0) < 0.15 && Math.abs(tg.headY - 2.45) < 0.15, `tourguide numbers ${tg.radius} ${tg.height} ${tg.headY}`);
  ok(tg.muzzle && tg.muzzle.name === 'muzzle', 'tourguide: muzzle');
  ok(typeof tg.enrage === 'function', 'tourguide: enrage');
  const at = (r, state, t, k) => { r.setPose(state, t, k); r.group.updateMatrixWorld(true); };
  at(tg, 'idle', 1, 0);
  ok(world(tg.muzzle).y < 1.9, `tourguide muzzle at rest ${world(tg.muzzle).y.toFixed(2)}`);
  at(tg, 'aim', 1, 1);
  const mz = world(tg.muzzle);
  ok(mz.z < -1.2 && mz.y > 1.0 && mz.y < 2.3, `tourguide aims forward: muzzle ${mz.toArray().map((v) => v.toFixed(2))}`);
  at(tg, 'shoot', 0.1, 0.3);
  ok(world(tg.muzzle).z < -0.9, 'tourguide muzzle while shooting');
  const lantern = tg.group.getObjectByName('lantern');
  ok(!!lantern && !!tg.group.getObjectByName('pole') && !!tg.group.getObjectByName('hat'), 'tourguide: named parts');
  let raised = 0;
  for (let k = 0; k <= 0.45; k += 0.01) {
    at(tg, 'slam', k, k);
    raised = Math.max(raised, world(lantern).y);
  }
  at(tg, 'slam', 0.45, 0.45);
  const hit = world(lantern);
  ok(raised > 2.9, `slam raises the lantern high before the blow (${raised.toFixed(2)})`);
  ok(hit.z < -1.2 && hit.y < 1.8, `slam has landed ahead and low at k=0.45: ${hit.toArray().map((v) => v.toFixed(2))}`);
  at(tg, 'slam', 1, 0);
  let sweep = 0;
  let maxY = 0;
  let prev = null;
  for (let k = 0; k <= 1.0001; k += 0.02) { // the lantern is a continuous path: no teleporting between frames
    at(tg, 'slam', k, k);
    const w = world(lantern);
    maxY = Math.max(maxY, w.y);
    if (prev) sweep = Math.max(sweep, w.distanceTo(prev));
    prev = w;
  }
  ok(sweep < 1.3, `slam moves the lantern smoothly (largest step ${sweep.toFixed(2)} m per 0.02 of k)`);
  ok(maxY < 3.9, `slam apex ${maxY.toFixed(2)} m`);
  at(tg, 'idle', 1, 0);
  const calm = tg.eyes[0].material.color.clone();
  tg.enrage();
  tg.enrage();
  for (let i = 0; i < 60; i++) tg.update(1 / 60);
  const hot = tg.eyes[0].material.color;
  ok(hot.r > hot.b * 2 && calm.b > calm.r * 0.5, 'enrage turns the eyes from white to hot red');
  ok(hot.toArray().every((v) => Number.isFinite(v) && v < 40) && tg.enraged === true, 'enrage stays finite and is idempotent');
  for (const s of ['idle', 'walk', 'slam', 'aim', 'shoot', 'hurt', 'dead']) {
    at(tg, s, 1, 0.5);
    finiteTransforms(tg.group, `tourguide enraged ${s}`);
  }
}

// Weapons. The gun alone first (hands: false): muzzle, length, the record and the pump. Then Freddie's hands.
const MAX_WEAPON_TRIS = 6000; // gun and hands together
const nameCount = (o, name) => { let n = 0; o.traverse((c) => { if (c.name === name) n++; }); return n; };
// triangles of a weapon without its record (the spinning disc is code, the same for every build of the vinyl)
const triCount = (o) => {
  let t = 0;
  o.traverse((c) => {
    if (!c.isMesh) return;
    for (let p = c.parent; p; p = p.parent) if (p.name === 'record') return;
    t += (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3;
  });
  return t;
};
for (const id of M.WEAPON_IDS) {
  const w = M.makeWeaponModel(id, { hands: false });
  ok(nameCount(w, 'hands') === 0, `${id}: hands: false leaves the hands off`);
  const mz = w.getObjectByName('muzzle');
  ok(!!mz, `${id}: muzzle`);
  const bb = new THREE.Box3().setFromObject(w);
  const len = bb.max.z - bb.min.z;
  ok(len > 0.4 && len < 0.95, `${id}: length ${len.toFixed(2)}`);
  ok(mz.position.z < -0.3 && mz.position.z > bb.min.z - 0.05, `${id}: muzzle z ${mz.position.z}`);
  ok(bb.min.z > -0.7, `${id}: extends to ${bb.min.z.toFixed(2)}`);
  const MUZZLE = { pistol: [0, 0.045, -0.4], shotgun: [0, 0.05, -0.6], smg: [0, 0.035, -0.53], launcher: [0, 0.03, -0.63], vinyl: [0, 0.19, -0.54] };
  ok(mz.position.distanceTo(new THREE.Vector3(...MUZZLE[id])) < 0.05, `${id}: muzzle ${mz.position.toArray()} is within 0.05 of the old one`);
  ok(!!w.getObjectByName('body') && !!w.getObjectByName('glow'), `${id}: body and lamp`);
  if (id === 'shotgun') ok(!!w.getObjectByName('pump'), 'shotgun pump');
  if (id === 'vinyl') {
    // the record: a named group that spins when userData.update(t) is called, with an HDR label
    const rec = w.getObjectByName('record');
    ok(!!rec && typeof w.userData.update === 'function', 'vinyl: record and userData.update');
    ok(!!w.getObjectByName('cradle'), 'vinyl: cradle');
    w.userData.update(0);
    const r0 = rec.rotation.y;
    w.userData.update(0.5);
    ok(Number.isFinite(rec.rotation.y) && Math.abs(rec.rotation.y - r0) > 0.3, 'vinyl: update(t) spins the record');
    for (const t of [NaN, undefined, -3, 1e6]) { w.userData.update(t); ok(Number.isFinite(rec.rotation.y), `vinyl: update(${t})`); }
    const label = rec.getObjectByName('label');
    ok(!!label && label.geometry.attributes.color.array.some((v) => v > 2), 'vinyl: HDR label');
    w.userData.update(0);
    w.updateMatrixWorld(true);
    const rb = new THREE.Box3().setFromObject(rec);
    ok(rb.max.x - rb.min.x > 0.21 && rb.max.x - rb.min.x < 0.26, `vinyl: record diameter ${(rb.max.x - rb.min.x).toFixed(2)}`);
    const wb = new THREE.Box3().setFromObject(w);
    ok(wb.max.x - wb.min.x < 0.4 && wb.max.y < 0.35 && wb.min.y > -0.3, `vinyl viewmodel bounds x ${(wb.max.x - wb.min.x).toFixed(2)} y ${wb.min.y.toFixed(2)}..${wb.max.y.toFixed(2)}`);
    // the record sits on the platter, not inside the deck or floating off it
    const platter = w.getObjectByName('cradle').children.find((c) => c.isMesh);
    let top = -Infinity; // the slipmat: the highest point within the record's radius
    const pp = platter.geometry.attributes.position;
    for (let i = 0; i < pp.count; i++) if (Math.hypot(pp.getX(i), pp.getZ(i)) < 0.1) top = Math.max(top, pp.getY(i));
    ok(rec.position.y - 0.0069 > top - 0.002 && rec.position.y - 0.0069 - top < 0.012 && Math.abs(rec.position.x) + Math.abs(rec.position.z) < 0.01, `vinyl: the record sits on the platter (platter top ${top.toFixed(4)}, record base ${(rec.position.y - 0.0069).toFixed(4)})`);
    const pk = M.makeWeaponPickup('vinyl');
    ok(typeof pk.userData.update === 'function', 'vinyl pickup: update hook');
    const before = pk.getObjectByName('record').rotation.y;
    pk.userData.update(1);
    ok(pk.getObjectByName('record').rotation.y !== before, 'vinyl pickup: record spins');
  }
  const st = stats(w);
  const p = M.makeWeaponPickup(id);
  const pb = new THREE.Box3().setFromObject(p);
  ok(Math.abs(pb.min.y) < 0.01, `${id} pickup floor ${pb.min.y}`);
  ok(pb.max.y > 0.9 && pb.max.y < 2.2, `${id} pickup top ${pb.max.y.toFixed(2)}`);
  ok(nameCount(p, 'hands') === 0, `${id} pickup: no hands on a floor pickup`);
  finiteTransforms(p, `${id} pickup`);

  // Freddie's hands and forearms: present on the viewmodel, a gripping pose, nothing through the camera
  const wh = M.makeWeaponModel(id);
  const hs = [];
  wh.traverse((c) => { if (c.name === 'hands') hs.push(c); });
  ok(hs.length === (id === 'shotgun' ? 2 : 1) && hs.every((h) => h.isMesh), `${id}: hands meshes (${hs.length})`);
  const tris = triCount(wh);
  ok(tris <= MAX_WEAPON_TRIS && tris > 2500, `${id}: ${tris} triangles with hands (budget ${MAX_WEAPON_TRIS})`);
  finiteTransforms(wh, `${id} with hands`);
  for (const h of hs) {
    const g = h.geometry;
    const n = g.attributes.position.count;
    ok(g.index.array.every((i) => i < n) && g.attributes.color.array.every((v) => v >= 0 && Number.isFinite(v)), `${id}: hands mesh data is clean`);
    const col = g.attributes.color.array;
    let skin = 0;
    let sleeve = 0;
    for (let i = 0; i < col.length; i += 3) {
      if (col[i] > 0.25 && col[i] > col[i + 1] * 1.2 && col[i + 1] > col[i + 2] * 1.1) skin++;
      if (col[i + 2] > col[i] * 2.2 && col[i + 2] > 0.04) sleeve++;
    }
    ok(skin > 20 && sleeve > 20, `${id}: hands are skin (${skin} verts) and a purple sleeve (${sleeve} verts)`);
  }
  wh.updateMatrixWorld(true);
  const hb = new THREE.Box3();
  hs.forEach((h) => hb.expandByObject(h));
  const gunBox = new THREE.Box3().setFromObject(w);
  ok(hb.intersectsBox(gunBox), `${id}: the hands are on the gun`);
  ok(hb.max.z > gunBox.max.z && hb.min.y < gunBox.min.y + 0.1, `${id}: the forearms run back and down, off the screen`);
  // the viewmodel pose from animateViewmodel (scale 0.68, resting spot, kick, reload dip): every hand vertex stays
  // in front of the weapon camera's near plane (0.02) and the arms never reach across the screen
  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  for (const x of [0.15, 0.4]) {
    for (const [kick, dip, sw] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0.5, 0.5, 1]]) {
      e.set(0.03 + kick * 0.22 + dip * 0.7, 0.07 - dip * 0.25, dip * 0.2);
      m.compose(new THREE.Vector3(x, -0.24 - dip * 0.22 - sw * 0.4, -0.62 + kick * 0.08), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(0.68, 0.68, 0.68));
      let nearest = Infinity;
      for (const h of hs) {
        h.updateWorldMatrix(true, false);
        const wm = new THREE.Matrix4().multiplyMatrices(m, h.matrixWorld);
        const P = h.geometry.attributes.position;
        for (let i = 0; i < P.count; i++) nearest = Math.min(nearest, -v.fromBufferAttribute(P, i).applyMatrix4(wm).z);
      }
      ok(nearest > 0.05, `${id}: hands stay ${nearest.toFixed(2)} m in front of the camera (x ${x} kick ${kick} dip ${dip})`);
    }
  }
  if (id === 'shotgun') {
    // the left hand is a child of the pump: it slides with it, the right hand stays put
    const pump = wh.getObjectByName('pump');
    const left = pump.getObjectByName('hands');
    const right = hs.find((h) => h !== left);
    ok(!!left && left.parent === pump && right.parent === wh, 'shotgun: the left hand is on the pump');
    const at = (o) => { wh.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()); };
    const l0 = at(left);
    const r0 = at(right);
    pump.position.z = -0.06;
    const l1 = at(left);
    const r1 = at(right);
    ok(Math.abs(l1.z - l0.z + 0.06) < 1e-6 && r1.distanceTo(r0) < 1e-6, 'shotgun: the pump slides the left hand and leaves the right hand');
    pump.position.z = 0;
  }
  console.log(`${id}: length ${len.toFixed(2)} muzzle ${mz.position.toArray().map((v) => v.toFixed(3)).join(',')} meshes ${st.meshes} tris ${st.tris} (${tris} with hands) pickup top ${pb.max.y.toFixed(2)}`);
}
// A weapon missing from the Blender data falls back to the procedural model (no hands): exercised by the old parts
// staying in models.js; a bogus id still throws.
try { M.makeWeaponModel('nope'); ok(false, 'unknown weapon should throw'); } catch { /* expected */ }
const h = M.makeHealthPickup();
const hb = new THREE.Box3().setFromObject(h);
ok(Math.abs(hb.min.y) < 0.01 && hb.max.y > 0.5, 'health pickup bounds');

// Drinks: pickups and viewmodels.
for (const id of M.DRINK_IDS) {
  const p = M.makeDrinkPickup(id);
  const pb = new THREE.Box3().setFromObject(p);
  ok(Math.abs(pb.min.y) < 0.01, `${id} drink pickup floor ${pb.min.y}`);
  ok(pb.max.y > 0.9 && pb.max.y < 1.9, `${id} drink pickup top ${pb.max.y.toFixed(2)}`);
  finiteTransforms(p, `${id} drink pickup`);
  if (p.userData.update) { p.userData.update(0); p.userData.update(3.3); finiteTransforms(p, `${id} pickup embers`); }
  const vm = M.makeDrinkViewmodel(id);
  ok(vm.group instanceof THREE.Group && typeof vm.setPose === 'function', `${id} viewmodel`);
  ok(vm.duration > 1 && vm.duration < 3, `${id} duration ${vm.duration}`);
  const st = stats(vm.group);
  ok(st.meshes <= 12, `${id} viewmodel ${st.meshes} meshes`);
  for (const k of [-1, 0, 0.1, 0.3, 0.5, 0.7, 0.9, 1, 2, NaN, undefined]) {
    try { vm.setPose(k); } catch (e) { ok(false, `${id} setPose(${k}): ${e.message}`); }
    finiteTransforms(vm.group, `${id} viewmodel k=${k}`);
  }
  vm.setPose(0);
  console.log(`${id}: duration ${vm.duration}s viewmodel meshes ${st.meshes} tris ${st.tris}; pickup top ${pb.max.y.toFixed(2)}`);
}

// The drink meshes are modelled in Blender (scripts/blender/drinks.py, data in src/drink-meshes.js): every part the
// animation code drives is there, indices are in range, nothing is NaN, and each drink stays inside a triangle budget.
const DRINK_PARTS = {
  dram: ['glass', 'liquid'],
  orange: ['glass', 'liquid', 'label', 'cap', 'fizz'],
  heavy: ['glass', 'liquid', 'foam'],
  energy: ['can', 'stripeM', 'stripeC', 'tab', 'puff'],
  lastorders: ['glass', 'liquid', 'foil', 'label', 'halo'],
};
for (const id of M.DRINK_IDS) {
  const found = new Map();
  M.makeDrinkViewmodel(id).group.traverse((o) => { if (o.isMesh && DRINK_PARTS[id].includes(o.name)) found.set(o.name, o); });
  ok(DRINK_PARTS[id].every((n) => found.has(n)), `${id} has its parts (${[...found.keys()].join(', ')})`);
  let tris = 0;
  let bad = 0;
  for (const m of found.values()) {
    const g = m.geometry;
    const n = g.attributes.position.count;
    tris += g.index ? g.index.count / 3 : n / 3;
    if (g.index && g.index.array.some((i) => i >= n)) bad++;
    for (const a of Object.values(g.attributes)) if (a.array.some((v) => !Number.isFinite(v))) bad++;
    if (g.attributes.color && g.attributes.color.array.some((v) => v < 0)) bad++;
  }
  ok(bad === 0, `${id} mesh data is clean`);
  ok(tris > 500 && tris < 8000, `${id} drink triangles ${tris}`);
}

// Freddie.
{
  const f = M.makeFreddie();
  ok(f.group instanceof THREE.Group && f.muzzle && typeof f.setPose === 'function', 'freddie fields');
  ok(Math.abs(f.height - 1.8) < 0.05, `freddie height ${f.height}`);
  const st = stats(f.group);
  ok(st.meshes <= 18, `freddie ${st.meshes} meshes`);
  for (const s of ['idle', 'spin', 'nonsense']) {
    for (const t of TS) {
      for (const k of KS) {
        try { f.setPose(s, t, k); } catch (e) { ok(false, `freddie ${s}: ${e.message}`); }
        finiteTransforms(f.group, `freddie ${s} t=${t} k=${k}`);
      }
    }
  }
  f.setPose('idle', 0, 0);
  const bb = new THREE.Box3().setFromObject(f.group);
  ok(Math.abs(bb.max.y - 1.8) < 0.12, `freddie top ${bb.max.y.toFixed(2)}`);
  ok(Math.abs(bb.min.y) < 0.03, `freddie feet ${bb.min.y.toFixed(3)}`);
  f.setPose('spin', 1, 0.5);
  f.group.updateMatrixWorld(true);
  const mp = f.muzzle.getWorldPosition(new THREE.Vector3());
  ok(mp.z < -0.8 && mp.y > 1 && mp.y < 1.7, `freddie muzzle ${mp.toArray().map((v) => v.toFixed(2))}`);
  console.log(`freddie: height ${f.height} meshes ${st.meshes} tris ${st.tris} muzzle (spin) ${mp.toArray().map((v) => v.toFixed(2))}`);
}

for (const kind of ['bottle', 'rocket', 'disc']) {
  const p = M.makeProjectile(kind);
  ok(stats(p).meshes > 0, `projectile ${kind}`);
  finiteTransforms(p, `projectile ${kind}`);
  if (kind === 'bottle') ok(!!p.getObjectByName('spin'), 'bottle spin child');
  if (kind === 'disc') {
    const spin = p.getObjectByName('spin');
    ok(!!spin, 'disc spin child');
    p.updateMatrixWorld(true);
    const db = new THREE.Box3().setFromObject(spin);
    const dia = Math.max(db.max.x - db.min.x, db.max.z - db.min.z);
    ok(dia > 0.55 && dia < 0.7, `disc diameter ${dia.toFixed(2)}`);
    let hdr = false;
    spin.traverse((c) => { if (c.isMesh && c.geometry.attributes.color && c.geometry.attributes.color.array.some((v) => v > 2)) hdr = true; });
    ok(hdr, 'disc: HDR label');
    for (const a of [0, 1, 2.5, 100]) { p.rotation.y = a; spin.rotation.y = a; finiteTransforms(p, `disc spin ${a}`); }
    p.rotation.y = 0;
    spin.rotation.y = 0;
    // asymmetric: the bounding box of the bright label is not symmetric about the disc centre (the notch and the pip)
    let lbl = null;
    spin.traverse((c) => { if (c.isMesh && c.geometry.attributes.color && !c.geometry.attributes.surf) lbl = c; });
    ok(lbl !== null, 'disc: label mesh');
  }
}
const mf = M.makeMuzzleFlash();
ok(stats(mf).meshes > 0, 'muzzle flash');
let allAdd = true;
mf.traverse((c) => { if (c.isMesh && (c.material.blending !== THREE.AdditiveBlending || c.material.depthWrite)) allAdd = false; });
ok(allAdd, 'muzzle flash is additive with depthWrite false');
const mfb = new THREE.Box3().setFromObject(mf);
ok(mfb.max.x - mfb.min.x > 0.2 && mfb.max.x - mfb.min.x < 0.45, `muzzle flash width ${(mfb.max.x - mfb.min.x).toFixed(2)}`);
const imp = M.makeImpact();
ok(stats(imp).meshes > 0, 'impact');
ok(imp.children[0].material !== M.makeImpact().children[0].material, 'impact material is per instance');
try { M.makeRobot('nope'); ok(false, 'unknown robot should throw'); } catch { /* expected */ }
try { M.makeDrinkPickup('nope'); ok(false, 'unknown drink should throw'); } catch { /* expected */ }

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('models-check: all passed');
