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

// Weapons. The gun alone first (hands: false): muzzle, length, the record and the pump. Then Naebun's hands.
const MAX_WEAPON_TRIS = 6000; // gun and hands together
const nameCount = (o, name) => { let n = 0; o.traverse((c) => { if (c.name === name) n++; }); return n; };
// triangles of a weapon without its record (the spinning disc is code, the same for every build of the vinyl) and
// without its torch (budgeted on its own below)
const triCount = (o) => {
  let t = 0;
  o.traverse((c) => {
    if (!c.isMesh || c.name === 'torch' || c.name === 'lens') return;
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
  // The torch: a mounted body and a separate glowing lens, a beam start and direction in the gun's frame, setTorch.
  {
    const tm = w.getObjectByName('torch');
    const lm = w.getObjectByName('lens');
    ok(!!tm && !!lm && tm.isMesh && lm.isMesh && tm.parent === w && lm.parent === w, `${id}: torch and lens meshes`);
    const L = w.userData.lens;
    ok(L && L.pos.length === 3 && L.dir.length === 3 && [...L.pos, ...L.dir].every(Number.isFinite), `${id}: userData.lens is finite`);
    const lp = new THREE.Vector3(...L.pos);
    const ld = new THREE.Vector3(...L.dir);
    ok(Math.abs(ld.length() - 1) < 1e-6 && ld.z < -0.99, `${id}: the beam points along -z (${ld.toArray()})`);
    ok(lp.distanceTo(mz.position) < 0.35, `${id}: lens ${lp.distanceTo(mz.position).toFixed(2)} m from the muzzle`);
    const tb = new THREE.Box3().setFromObject(tm);
    const lb = new THREE.Box3().setFromObject(lm);
    ok(lp.z - tb.min.z < 0.06, `${id}: the lens is at the front of the torch (${(lp.z - tb.min.z).toFixed(3)} m behind its front)`);
    ok(lb.expandByScalar(0.003).containsPoint(lp), `${id}: userData.lens.pos is on the lens mesh`);
    const nTorch = (tm.geometry.index.count + lm.geometry.index.count) / 3;
    ok(tm.geometry.index.count / 3 >= 600 && nTorch <= 1500, `${id}: torch ${tm.geometry.index.count / 3} + lens ${lm.geometry.index.count / 3} triangles`);
    ok(lm.material.type === 'MeshBasicMaterial' && tm.material.type === 'MeshStandardMaterial', `${id}: lens is a basic glow material, the body is the shared PBR one`);
    // states: default mounted (not the pistol) and off; on drives the HDR glow with k; mounted false hides both
    const lit = (o) => o.material.color.r;
    const def = id !== 'pistol';
    ok(tm.visible === def && lm.visible === def, `${id}: default torch ${def ? 'mounted' : 'not mounted'}`);
    ok(lit(lm) < 0.5, `${id}: the lens starts unlit (${lit(lm).toFixed(2)})`);
    w.userData.setTorch({ mounted: true, on: true });
    ok(tm.visible && lm.visible && lit(lm) > 3 && lm.material.color.g > 3 && lm.material.color.b > 2.5, `${id}: on gives an HDR warm white (${lm.material.color.toArray().map((v) => v.toFixed(1))})`);
    w.userData.setTorch({ mounted: true, on: true, k: 0.5 });
    const half = lit(lm);
    w.userData.setTorch({ mounted: true, on: true, k: 0 });
    const zero = lit(lm);
    w.userData.setTorch({ mounted: true, on: true, k: 1 });
    ok(zero < half && half < lit(lm), `${id}: k scales the glow (${zero.toFixed(2)} < ${half.toFixed(2)} < ${lit(lm).toFixed(2)})`);
    w.userData.setTorch({ on: false });
    ok(lit(lm) < 0.5 && tm.visible, `${id}: on false puts the lens out and leaves the torch mounted`);
    w.userData.setTorch({ mounted: false, on: true });
    ok(!tm.visible && !lm.visible, `${id}: mounted false hides the torch and lens`);
    w.userData.setTorch({ mounted: true });
    ok(tm.visible && lm.visible && lit(lm) > 3, `${id}: an omitted on keeps its value`);
    for (const odd of [undefined, null, {}, { k: NaN }, { k: -3 }, { k: 9 }, { mounted: undefined, on: undefined, k: Infinity }]) {
      try { w.userData.setTorch(odd); } catch (e) { ok(false, `${id}: setTorch(${JSON.stringify(odd)}): ${e.message}`); }
      ok(Number.isFinite(lit(lm)) && lit(lm) < 40, `${id}: setTorch(${JSON.stringify(odd)}) stays finite`);
    }
    w.userData.setTorch({ mounted: def, on: false });
    const m2 = M.makeWeaponModel(id, { hands: false, torch: !def });
    ok(m2.getObjectByName('torch').visible === !def, `${id}: the torch option sets the starting state`);
    const m3 = M.makeWeaponModel(id, { hands: false });
    ok(m3.getObjectByName('lens').material !== lm.material, `${id}: each model has its own lens material`);
    // the lens colour is the only per-model state: the shared geometry and body material are not copied
    ok(m3.getObjectByName('torch').geometry === tm.geometry && m3.getObjectByName('torch').material === tm.material, `${id}: torch geometry and material are shared`);
  }
  const st = stats(w);
  const p = M.makeWeaponPickup(id);
  // a floor pickup shows the fitted torch, unlit; the pistol's has none yet
  {
    const pt = p.getObjectByName('torch');
    const pl = p.getObjectByName('lens');
    const want = id !== 'pistol';
    ok(!!pt && !!pl && pt.visible === want && pl.visible === want, `${id} pickup: torch ${want ? 'shown' : 'hidden'}`);
    ok(pl.material.color.r < 0.5, `${id} pickup: the lens is unlit`);
    const vb = new THREE.Box3();
    p.updateMatrixWorld(true);
    p.getObjectByName('item').traverseVisible((o) => { if (o.isMesh) vb.expandByObject(o); });
    const ctr = vb.getCenter(new THREE.Vector3());
    ok(Math.abs(ctr.x) < 0.06 && Math.abs(ctr.z) < 0.06, `${id} pickup: what shows is centred on the spin axis (${ctr.x.toFixed(2)}, ${ctr.z.toFixed(2)})`);
  }
  const pb = new THREE.Box3().setFromObject(p);
  ok(Math.abs(pb.min.y) < 0.01, `${id} pickup floor ${pb.min.y}`);
  ok(pb.max.y > 0.9 && pb.max.y < 2.2, `${id} pickup top ${pb.max.y.toFixed(2)}`);
  ok(nameCount(p, 'hands') === 0, `${id} pickup: no hands on a floor pickup`);
  finiteTransforms(p, `${id} pickup`);

  // Naebun's hands and forearms: present on the viewmodel, a gripping pose, nothing through the camera
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
// The pistol's torch attach rig: Naebun's left hand brings the loose torch to the rail, seats it, and withdraws.
{
  const rig = M.makeTorchAttach();
  ok(rig.group instanceof THREE.Group && typeof rig.setPose === 'function' && rig.seatK > 0.4 && rig.seatK < 0.8, `attach rig: group, setPose and seatK ${rig.seatK}`);
  const pistol = M.makeWeaponModel('pistol', { hands: false });
  const root = new THREE.Group();
  root.add(pistol, rig.group);
  const loose = rig.group.getObjectByName('looseTorch');
  const hand = rig.group.getObjectByName('attachHand');
  ok(!!loose && !!hand && !!loose.getObjectByName('torch') && !!loose.getObjectByName('lens'), 'attach rig: hand, loose torch and lens');
  ok(loose.getObjectByName('torch').geometry === pistol.getObjectByName('torch').geometry && loose.getObjectByName('lens').geometry === pistol.getObjectByName('lens').geometry, 'attach rig: the loose torch shares the mounted torch geometry');
  const handTris = hand.geometry.index.count / 3;
  ok(handTris > 400 && handTris <= 1200, `attach rig: hand ${handTris} triangles`);
  for (const k of [-1, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 2, NaN, undefined, null, Infinity, -Infinity]) {
    try { rig.setPose(k); } catch (e) { ok(false, `attach rig setPose(${k}): ${e.message}`); }
    finiteTransforms(rig.group, `attach rig k=${k}`);
  }
  // colours: skin and the purple sleeve, as on the other hands
  {
    const col = hand.geometry.attributes.color.array;
    let skin = 0;
    let sleeve = 0;
    for (let i = 0; i < col.length; i += 3) {
      if (col[i] > 0.25 && col[i] > col[i + 1] * 1.2 && col[i + 1] > col[i + 2] * 1.1) skin++;
      if (col[i + 2] > col[i] * 2.2 && col[i + 2] > 0.04) sleeve++;
    }
    ok(skin > 20 && sleeve > 20, `attach rig: the hand is skin (${skin} verts) and a purple sleeve (${sleeve} verts)`);
  }
  // visibility: shown from 0 up to just before 1, invisible at 1; the loose torch goes at seatK
  rig.setPose(0);
  ok(rig.group.visible && loose.visible, 'attach rig: shown with its torch at 0');
  rig.setPose(rig.seatK - 0.01);
  ok(rig.group.visible && loose.visible, 'attach rig: the loose torch is shown just before seatK');
  rig.setPose(rig.seatK);
  ok(rig.group.visible && !loose.visible, 'attach rig: the loose torch is hidden from seatK');
  rig.setPose(0.99);
  ok(rig.group.visible && !loose.visible, 'attach rig: still shown at 0.99');
  rig.setPose(1);
  ok(!rig.group.visible, 'attach rig: invisible at 1');
  rig.setPose(2);
  ok(!rig.group.visible, 'attach rig: invisible past 1');
  rig.setPose(NaN);
  ok(rig.group.visible, 'attach rig: NaN counts as 0');
  // at seatK the loose torch is exactly the mounted one (compared as world boxes, within 2 mm)
  const boxOf = (o) => new THREE.Box3().setFromObject(o);
  pistol.userData.setTorch({ mounted: true });
  const same = (a, b) => a.min.distanceTo(b.min) < 0.002 && a.max.distanceTo(b.max) < 0.002;
  const dist = (k) => {
    rig.setPose(k);
    root.updateMatrixWorld(true);
    return boxOf(loose.getObjectByName('torch')).getCenter(new THREE.Vector3()).distanceTo(boxOf(pistol.getObjectByName('torch')).getCenter(new THREE.Vector3()));
  };
  rig.setPose(rig.seatK);
  root.updateMatrixWorld(true);
  ok(same(boxOf(loose.getObjectByName('torch')), boxOf(pistol.getObjectByName('torch'))), 'attach rig: the loose torch is the mounted torch at seatK');
  ok(same(boxOf(loose.getObjectByName('lens')), boxOf(pistol.getObjectByName('lens'))), 'attach rig: the loose lens is the mounted lens at seatK');
  ok(dist(rig.seatK - 0.002) < 0.003, `attach rig: the click is continuous (${(dist(rig.seatK - 0.002) * 1000).toFixed(1)} mm off 2 thousandths before the seat)`);
  // the hand is in the same place relative to the torch at every k (it holds it): a rigid group
  rig.setPose(0.3);
  root.updateMatrixWorld(true);
  const rel = (o) => boxOf(o).getCenter(new THREE.Vector3()).distanceTo(boxOf(loose.getObjectByName('torch')).getCenter(new THREE.Vector3()));
  const r1 = rel(hand);
  rig.setPose(0.5);
  root.updateMatrixWorld(true);
  ok(Math.abs(rel(hand) - r1) < 1e-4, 'attach rig: the hand and the loose torch move as one');
  // the approach closes in, the withdrawal opens out
  const d = [0, 0.1, 0.2, 0.3, 0.36, 0.45].map(dist);
  ok(d.every((v, i) => i === 0 || v < d[i - 1]), `attach rig: the approach closes in (${d.map((v) => v.toFixed(2)).join(' > ')})`);
  const handPos = (k) => {
    rig.setPose(k);
    root.updateMatrixWorld(true);
    return boxOf(hand).getCenter(new THREE.Vector3());
  };
  const seatPos = handPos(rig.seatK);
  const w = [0.7, 0.8, 0.9, 0.99].map((k) => handPos(k).distanceTo(seatPos));
  ok(w.every((v, i) => i === 0 || v > w[i - 1]) && w[0] < 0.02, `attach rig: the hand withdraws (${w.map((v) => v.toFixed(2)).join(' < ')})`);
  // seen from the game's weapon camera (fov 70, the viewmodel root as animateViewmodel places it): out of frame at 0,
  // in frame at the seat, nothing through the near plane, in portrait and landscape
  const tan = Math.tan((70 * Math.PI) / 360);
  for (const [aspect, x, y] of [[390 / 844, 0.08, -0.205], [844 / 390, 0.375, -0.24], [1, 0.15, -0.24]]) {
    const wm = new THREE.Matrix4().compose(new THREE.Vector3(x, y, -0.62), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.03, 0.07, 0)), new THREE.Vector3(0.68, 0.68, 0.68));
    const view = (k) => {
      rig.setPose(k);
      rig.group.updateMatrixWorld(true);
      let inFrame = 0;
      let handIn = 0;
      let near = Infinity;
      const v = new THREE.Vector3();
      if (!rig.group.visible) return { inFrame, handIn, near };
      rig.group.traverseVisible((o) => {
        if (!o.isMesh) return;
        const P = o.geometry.attributes.position;
        const m = new THREE.Matrix4().multiplyMatrices(wm, o.matrixWorld);
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(m);
          const depth = -v.z;
          near = Math.min(near, depth);
          if (depth > 0.02 && Math.abs(v.x) <= depth * tan * aspect && Math.abs(v.y) <= depth * tan) {
            inFrame++;
            if (o === hand) handIn++;
          }
        }
      });
      return { inFrame, handIn, near };
    };
    const tag = `aspect ${aspect.toFixed(2)}`;
    const v0 = view(0);
    ok(v0.inFrame === 0, `attach rig: out of frame at k = 0 (${tag}, ${v0.inFrame} vertices in frame)`);
    const vs = view(rig.seatK);
    ok(vs.handIn > 150, `attach rig: the hand is in frame at the seat (${tag}, ${vs.handIn} vertices)`);
    for (const k of [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.99]) {
      const vk = view(k);
      ok(vk.near > 0.05, `attach rig: stays ${vk.near.toFixed(2)} m in front of the camera (${tag}, k ${k})`);
    }
    const seen = [0.2, 0.4, 0.5].map((k) => view(k).handIn);
    ok(seen.every((n) => n > 0), `attach rig: the hand is in frame through the approach (${tag}, ${seen})`);
  }
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

// Naebun.
{
  const f = M.makeNaebun();
  ok(f.group instanceof THREE.Group && f.muzzle && typeof f.setPose === 'function', 'naebun fields');
  ok(Math.abs(f.height - 1.8) < 0.05, `naebun height ${f.height}`);
  const st = stats(f.group);
  ok(st.meshes <= 18, `naebun ${st.meshes} meshes`);
  for (const s of ['idle', 'spin', 'nonsense']) {
    for (const t of TS) {
      for (const k of KS) {
        try { f.setPose(s, t, k); } catch (e) { ok(false, `naebun ${s}: ${e.message}`); }
        finiteTransforms(f.group, `naebun ${s} t=${t} k=${k}`);
      }
    }
  }
  f.setPose('idle', 0, 0);
  const bb = new THREE.Box3().setFromObject(f.group);
  ok(Math.abs(bb.max.y - 1.8) < 0.12, `naebun top ${bb.max.y.toFixed(2)}`);
  ok(Math.abs(bb.min.y) < 0.03, `naebun feet ${bb.min.y.toFixed(3)}`);
  f.setPose('spin', 1, 0.5);
  f.group.updateMatrixWorld(true);
  const mp = f.muzzle.getWorldPosition(new THREE.Vector3());
  ok(mp.z < -0.8 && mp.y > 1 && mp.y < 1.7, `naebun muzzle ${mp.toArray().map((v) => v.toFixed(2))}`);
  console.log(`naebun: height ${f.height} meshes ${st.meshes} tris ${st.tris} muzzle (spin) ${mp.toArray().map((v) => v.toFixed(2))}`);
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

// ---- The prepared arsenal (src/arsenal.js, modelled in scripts/blender/arsenal.py): three weapons, upgrades, records, effects ----
{
  ok(JSON.stringify(M.ARSENAL_WEAPON_IDS) === '["beam","grenade","airhorn"]', 'ARSENAL_WEAPON_IDS');
  ok(JSON.stringify(M.ARSENAL_UPGRADE_IDS) === '["clip","reload","altfire"]', 'ARSENAL_UPGRADE_IDS');
  const v3 = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
  const hasTorch = { beam: true, airhorn: true, grenade: false };
  for (const id of M.ARSENAL_WEAPON_IDS) {
    const w = M.makeWeaponModel(id, { hands: false });
    ok(nameCount(w, 'hands') === 0, `${id}: hands: false leaves the hands off`);
    const mz = w.getObjectByName('muzzle');
    ok(!!mz && !!w.getObjectByName('body') && !!w.getObjectByName('glow'), `${id}: muzzle, body and lamp`);
    const bb = new THREE.Box3().setFromObject(w);
    ok(bb.min.z > -0.7 && bb.min.z < -0.05 && bb.max.z < 0.45, `${id}: extends z ${bb.min.z.toFixed(2)} to ${bb.max.z.toFixed(2)}`);
    ok(mz.position.z < -0.05 && mz.position.z > bb.min.z - 0.05, `${id}: muzzle z ${mz.position.z}`);
    finiteTransforms(w, `${id} (arsenal)`);
    const p = M.makeWeaponPickup(id);
    const pb = new THREE.Box3().setFromObject(p);
    ok(Math.abs(pb.min.y) < 0.01 && pb.max.y > 0.9 && pb.max.y < 2.2, `${id} pickup: floor ${pb.min.y.toFixed(2)}, top ${pb.max.y.toFixed(2)}`);
    ok(nameCount(p, 'hands') === 0, `${id} pickup: no hands`);
    finiteTransforms(p, `${id} pickup (arsenal)`);

    const wh = M.makeWeaponModel(id);
    const hs = [];
    wh.traverse((c) => { if (c.name === 'hands') hs.push(c); });
    ok(hs.length === 1 && hs[0].isMesh, `${id}: Naebun's hand is there (${hs.length})`);
    const tris = stats(wh).tris; // every mesh: body, lamp, lights, hands and the torch
    ok(tris >= 3000 && tris <= MAX_WEAPON_TRIS, `${id}: ${tris} triangles with hands and torch (3000 to ${MAX_WEAPON_TRIS})`);
    finiteTransforms(wh, `${id} with hands (arsenal)`);
    console.log(`${id} (arsenal): ${tris} triangles with hands and torch, pickup top ${pb.max.y.toFixed(2)}, length ${(bb.max.z - bb.min.z).toFixed(2)}`);
    {
      const g = hs[0].geometry;
      const n = g.attributes.position.count;
      ok(g.index.array.every((i) => i < n) && g.attributes.color.array.every((x) => x >= 0 && Number.isFinite(x)), `${id}: hands mesh data is clean`);
    }
    // the same viewmodel pose as the other guns (portrait and landscape): every hand vertex stays well in front of the camera
    wh.updateMatrixWorld(true);
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

    // the torch API: `torch` and `lens` meshes, userData.lens, userData.setTorch({ mounted, on, k }), mounted and off to begin with
    ok(typeof wh.userData.setTorch === 'function', `${id}: setTorch exists`);
    const torchM = wh.getObjectByName('torch');
    const lensM = wh.getObjectByName('lens');
    if (hasTorch[id]) {
      ok(!!torchM && !!lensM && torchM.isMesh && lensM.isMesh && lensM.material.type === 'MeshBasicMaterial', `${id}: torch and lens meshes, the lens a basic material`);
      ok(wh.userData.lens && v3(wh.userData.lens.pos) && v3(wh.userData.lens.dir), `${id}: userData.lens has pos and dir`);
      const d = new THREE.Vector3(...wh.userData.lens.dir);
      ok(Math.abs(d.length() - 1) < 1e-6 && d.z < -0.9, `${id}: the lens looks forward (${wh.userData.lens.dir})`);
      const lp = new THREE.Vector3(...wh.userData.lens.pos);
      const lb = new THREE.Box3().setFromObject(lensM);
      ok(lb.expandByScalar(0.01).containsPoint(lp), `${id}: userData.lens.pos is on the lens (${lp.toArray().map((x) => x.toFixed(3))})`);
      ok(torchM.visible && lensM.visible, `${id}: new weapons start mounted`);
      const off = lensM.material.color.clone();
      ok(Math.max(off.r, off.g, off.b) < 0.5, `${id}: the lens is dark glass while off`);
      wh.userData.setTorch({ on: true });
      ok(Math.max(lensM.material.color.r, lensM.material.color.g) > 2, `${id}: lit, the lens is HDR (${lensM.material.color.r.toFixed(1)})`);
      wh.userData.setTorch({ on: true, k: 0 });
      ok(Math.max(lensM.material.color.r, lensM.material.color.g) < 0.5, `${id}: k = 0 is dark again`);
      wh.userData.setTorch({ on: true, k: 0.5 });
      const half = lensM.material.color.r;
      wh.userData.setTorch({ k: 1 });
      ok(lensM.material.color.r > half && half > 0.5, `${id}: brightness follows k, and omitted keys keep their value`);
      wh.userData.setTorch({ mounted: false });
      ok(!torchM.visible && !lensM.visible, `${id}: unmounted hides the torch and the lens`);
      wh.userData.setTorch({ mounted: true, on: false });
      ok(torchM.visible && lensM.visible && Math.max(lensM.material.color.r, lensM.material.color.g) < 0.5, `${id}: mounted and off again`);
      for (let i = 0; i < 200; i++) wh.userData.setTorch({ mounted: true, on: i % 3 === 0, k: [NaN, undefined, -3, 9, 0.4][i % 5] });
      ok([lensM.material.color.r, lensM.material.color.g, lensM.material.color.b].every((x) => Number.isFinite(x) && x < 12), `${id}: setTorch every frame with odd values stays finite`);
      const other = M.makeWeaponModel(id);
      other.userData.setTorch({ on: true });
      wh.userData.setTorch({ on: false });
      ok(other.getObjectByName('lens').material !== lensM.material, `${id}: each model has its own lens material`);
      const pu = M.makeWeaponModel(id, { hands: false, torch: false });
      ok(!pu.getObjectByName('torch').visible, `${id}: { torch: false } starts unmounted`);
    } else {
      ok(!torchM && !lensM && !wh.userData.lens, `${id}: it is thrown, so it has no torch`);
      wh.userData.setTorch({ mounted: true, on: true, k: 1 }); // harmless
    }
  }
  // the Feedback Beam's meter and emitter
  {
    const b = M.makeWeaponModel('beam');
    const vis = () => [0, 1, 2, 3, 4].map((i) => b.getObjectByName(`led${i}`).visible);
    ok(vis().every(Boolean), 'beam: all five LEDs light when the meter is full');
    for (const [f, n] of [[0, 0], [0.01, 1], [0.2, 1], [0.21, 2], [0.5, 3], [0.99, 5], [1, 5], [1.7, 5], [-1, 0], [NaN, 0]]) {
      b.userData.setCharge(f);
      ok(vis().filter(Boolean).length === n, `beam: setCharge(${f}) lights ${n} LED(s) (${vis().filter(Boolean).length})`);
    }
    const em = b.getObjectByName('emitter');
    b.userData.setBeam(false);
    const dim = em.material.color.r + em.material.color.g + em.material.color.b;
    b.userData.setBeam(true, 1);
    const hot = em.material.color.r + em.material.color.g + em.material.color.b;
    ok(hot > dim * 2 && Math.max(em.material.color.r, em.material.color.g) > 2, `beam: the emitter blazes while the beam is on (${dim.toFixed(1)} to ${hot.toFixed(1)})`);
    for (const k of [NaN, undefined, -2, 7]) b.userData.setBeam(true, k);
    ok(Number.isFinite(em.material.color.r), 'beam: setBeam copes with odd values');
    ok(M.makeWeaponModel('beam').getObjectByName('emitter').material !== em.material, 'beam: each model has its own emitter material');
  }
  // the grenade in flight
  {
    const g = M.makeProjectile('grenade');
    const spin = g.getObjectByName('spin');
    ok(!!spin && typeof g.userData.setFuse === 'function', 'grenade projectile: a spin child and setFuse');
    const gb = new THREE.Box3().setFromObject(g);
    ok(gb.max.y - gb.min.y > 0.2 && gb.max.y - gb.min.y < 0.8, `grenade projectile: ${(gb.max.y - gb.min.y).toFixed(2)} m across`);
    for (const f of [1, 0.5, 0.1, 0, -1, 2, NaN]) for (const t of [0, 3.3, NaN]) g.userData.setFuse(f, t);
    spin.rotation.x = 2.2;
    finiteTransforms(g, 'grenade projectile');
    ok(stats(g).tris < 4000, `grenade projectile: ${stats(g).tris} triangles`);
    try { M.makeProjectile('nope'); } catch { ok(false, 'the old projectile kinds still fall through to the bottle'); }
  }
  // upgrade pickups and records
  for (const id of M.ARSENAL_UPGRADE_IDS) {
    const p = M.makeUpgradePickup(id);
    const pb = new THREE.Box3().setFromObject(p);
    ok(Math.abs(pb.min.y) < 0.01 && pb.max.y > 0.9 && pb.max.y < 1.9, `${id} upgrade pickup: floor ${pb.min.y.toFixed(2)}, top ${pb.max.y.toFixed(2)}`);
    ok(!!p.getObjectByName('item') && stats(p).tris > 800 && stats(p).tris < 5000, `${id} upgrade pickup: ${stats(p).tris} triangles`);
    finiteTransforms(p, `${id} upgrade pickup`);
    let glow = false;
    p.traverse((c) => { if (c.isMesh && c.material.color && Math.max(c.material.color.r, c.material.color.g, c.material.color.b) > 2) glow = true; });
    ok(glow, `${id} upgrade pickup: something glows (HDR)`);
  }
  try { M.makeUpgradePickup('nope'); ok(false, 'unknown upgrade should throw'); } catch { /* expected */ }
  {
    const looks = new Set();
    for (const i of [0, 1, 2, 3, 4, 7, 8, -1, NaN, 2.6]) {
      const p = M.makeRecordPickup(i);
      const pb = new THREE.Box3().setFromObject(p);
      ok(Math.abs(pb.min.y) < 0.01 && pb.max.y > 0.9 && pb.max.y < 1.9, `record ${i}: floor ${pb.min.y.toFixed(2)}, top ${pb.max.y.toFixed(2)}`);
      finiteTransforms(p, `record ${i}`);
      ok(stats(p).tris > 500 && stats(p).tris < 4000, `record ${i}: ${stats(p).tris} triangles`);
      if (i >= 0 && i < 4) {
        let h = 0;
        p.getObjectByName('item').traverse((c) => { if (c.isMesh) h += c.geometry.attributes.color.array.reduce((a, x, k) => a + x * (k + 1) % 7, 0); });
        looks.add(h.toFixed(3));
      }
    }
    ok(looks.size === 4, `four label variants look different (${looks.size})`);
    ok(M.makeRecordPickup(0).name === M.makeRecordPickup(4).name && M.makeRecordPickup(1).name !== M.makeRecordPickup(0).name, 'the variant repeats every four records');
  }
  // the effects
  {
    const bm = M.makeBeam();
    for (const len of [0, 1, 18, NaN, undefined, -3]) for (const r of [0, 0.5, 1, NaN, 9, -1]) { bm.update(len, r, 3.3); finiteTransforms(bm.group, `beam fx ${len} ${r}`); }
    ok(bm.group.children.length >= 4, 'beam fx: core, sheath, glow and a spot');
    for (const kind of ['ring', 'cone']) {
      const sw = M.makeShockwave(kind);
      for (const k of [-1, 0, 0.3, 0.7, 1, 2, NaN]) for (const radius of [7, 0, 20]) { sw.update(k, radius, 0.62); finiteTransforms(sw.group, `${kind} wave k=${k}`); }
      sw.update(0.5, 7, 0.62);
      const sb = new THREE.Box3().setFromObject(sw.group);
      ok(sb.max.x - sb.min.x > 2, `${kind} wave: reaches out at k = 0.5 (${(sb.max.x - sb.min.x).toFixed(1)} m across)`);
      sw.group.traverse((c) => { if (c.isMesh) ok(c.material.blending === THREE.AdditiveBlending && !c.material.depthWrite, `${kind} wave: additive, no depth write`); });
    }
    ok(M.makeShockwave('ring').materials !== M.makeShockwave('ring').materials, 'waves have their own materials');
    const st = M.makeStunMark();
    for (const t of [0, 1.7, NaN, undefined, 1e6]) { st.update(t); finiteTransforms(st.group, `stun mark ${t}`); }
  }
  // the mesh data itself
  {
    const hole = [];
    for (const id of M.ARSENAL_WEAPON_IDS) {
      const wh = M.makeWeaponModel(id);
      wh.traverse((c) => {
        if (!c.isMesh || !c.geometry.index) return;
        const n = c.geometry.attributes.position.count;
        if (c.geometry.index.array.some((i) => i >= n) || c.geometry.attributes.position.array.some((x) => !Number.isFinite(x))) hole.push(`${id}/${c.name}`);
      });
    }
    ok(hole.length === 0, `arsenal mesh indices are in range and finite (${hole})`);
  }
}

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('models-check: all passed');
