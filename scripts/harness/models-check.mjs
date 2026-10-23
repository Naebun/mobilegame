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
const MAX_HEIGHT = { fizzbang: 2.2, bampot: 2.1, bouncer: 3.4 };
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

ok(JSON.stringify(M.WEAPON_IDS) === '["pistol","shotgun","smg","launcher"]', 'WEAPON_IDS');
ok(JSON.stringify(M.DRINK_IDS) === '["dram","orange","heavy","energy","lastorders"]', 'DRINK_IDS');

const t0 = Date.now();
for (const kind of ['fizzbang', 'bampot', 'bouncer']) {
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
    for (const s of STATES) {
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

for (const id of M.WEAPON_IDS) {
  const w = M.makeWeaponModel(id);
  const mz = w.getObjectByName('muzzle');
  ok(!!mz, `${id}: muzzle`);
  const bb = new THREE.Box3().setFromObject(w);
  const len = bb.max.z - bb.min.z;
  ok(len > 0.4 && len < 0.95, `${id}: length ${len.toFixed(2)}`);
  ok(mz.position.z < -0.3 && mz.position.z > bb.min.z - 0.05, `${id}: muzzle z ${mz.position.z}`);
  ok(bb.min.z > -0.7, `${id}: extends to ${bb.min.z.toFixed(2)}`);
  if (id === 'shotgun') ok(!!w.getObjectByName('pump'), 'shotgun pump');
  const st = stats(w);
  const p = M.makeWeaponPickup(id);
  const pb = new THREE.Box3().setFromObject(p);
  ok(Math.abs(pb.min.y) < 0.01, `${id} pickup floor ${pb.min.y}`);
  ok(pb.max.y > 0.9 && pb.max.y < 2.2, `${id} pickup top ${pb.max.y.toFixed(2)}`);
  finiteTransforms(p, `${id} pickup`);
  console.log(`${id}: length ${len.toFixed(2)} muzzle ${mz.position.toArray().map((v) => v.toFixed(3)).join(',')} meshes ${st.meshes} tris ${st.tris} pickup top ${pb.max.y.toFixed(2)}`);
}
const h = M.makeHealthPickup();
const hb = new THREE.Box3().setFromObject(h);
ok(Math.abs(hb.min.y) < 0.01 && hb.max.y > 0.5, 'health pickup bounds');

// Drinks: pickups and viewmodels.
for (const id of M.DRINK_IDS) {
  const p = M.makeDrinkPickup(id);
  const pb = new THREE.Box3().setFromObject(p);
  ok(Math.abs(pb.min.y) < 0.01, `${id} drink pickup floor ${pb.min.y}`);
  ok(pb.max.y > 0.9 && pb.max.y < 1.8, `${id} drink pickup top ${pb.max.y.toFixed(2)}`);
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

for (const kind of ['bottle', 'rocket']) {
  const p = M.makeProjectile(kind);
  ok(stats(p).meshes > 0, `projectile ${kind}`);
  finiteTransforms(p, `projectile ${kind}`);
  if (kind === 'bottle') ok(!!p.getObjectByName('spin'), 'bottle spin child');
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
