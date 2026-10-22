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
const MAX_HEIGHT = { drpepper: 2.2, wray: 2.1, bouncer: 3.4 };

function meshCount(o) {
  let n = 0;
  o.traverse((c) => { if (c.isMesh) n++; });
  return n;
}

function finiteTransforms(o, label) {
  let bad = 0;
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    const vals = [...c.position.toArray(), c.rotation.x, c.rotation.y, c.rotation.z, ...c.scale.toArray(), ...c.matrixWorld.elements];
    if (vals.some((v) => !Number.isFinite(v))) bad++;
  });
  ok(bad === 0, `${label}: non-finite transform`);
}

ok(JSON.stringify(M.WEAPON_IDS) === '["pistol","shotgun","smg","launcher"]', 'WEAPON_IDS');

for (const kind of ['drpepper', 'wray', 'bouncer']) {
  const r = M.makeRobot(kind);
  ok(r.group instanceof THREE.Group, `${kind}: group`);
  ok(r.height > 1.5 && r.height <= MAX_HEIGHT[kind], `${kind}: height ${r.height}`);
  ok(r.radius > 0.3 && r.radius < 1.2, `${kind}: radius ${r.radius}`);
  ok(r.headY > 0.5 * r.height && r.headY < r.height, `${kind}: headY ${r.headY}`);
  ok(Array.isArray(r.eyes) && r.eyes.length === 2 && r.eyes.every((e) => e.isMesh), `${kind}: eyes`);
  ok(typeof r.setPose === 'function' && typeof r.flash === 'function', `${kind}: functions`);
  const n = meshCount(r.group);
  ok(n <= 12, `${kind}: ${n} meshes`);
  // Bounding box sanity at idle: the model should roughly match its declared height.
  r.setPose('idle', 0, 0);
  const bb = new THREE.Box3().setFromObject(r.group);
  ok(Math.abs(bb.max.y - r.height) < 0.15, `${kind}: top ${bb.max.y.toFixed(2)} vs height ${r.height}`);
  ok(bb.min.y > -0.01 && bb.min.y < 0.02, `${kind}: feet at ${bb.min.y.toFixed(3)}`);
  for (const s of STATES) {
    for (const t of TS) {
      for (const k of KS) {
        try { r.setPose(s, t, k); } catch (e) { ok(false, `${kind} ${s} t=${t} k=${k}: ${e.message}`); }
        finiteTransforms(r.group, `${kind} ${s} t=${t} k=${k}`);
      }
    }
  }
  for (const odd of [NaN, undefined, Infinity, -5]) {
    try { r.setPose('walk', odd, odd); r.setPose('nonsense', odd, odd); } catch (e) { ok(false, `${kind} odd input: ${e.message}`); }
    finiteTransforms(r.group, `${kind} odd input`);
  }
  r.setPose('dead', 1, 1);
  const dbb = new THREE.Box3().setFromObject(r.group);
  ok(dbb.max.y < r.height * 0.7, `${kind}: dead k=1 top ${dbb.max.y.toFixed(2)} is not flat`);
  try { r.flash(true); r.flash(false); r.flash(true); r.flash(true); r.flash(false); } catch (e) { ok(false, `${kind} flash: ${e.message}`); }
  console.log(`${kind}: height ${r.height} radius ${r.radius} headY ${r.headY} meshes ${n} deadTop ${dbb.max.y.toFixed(2)}`);
}

// Shared geometry between instances.
const a = M.makeRobot('wray');
const b = M.makeRobot('wray');
ok(a.group.children[0].children[0].geometry === b.group.children[0].children[0].geometry, 'geometry shared');
let sharedMat = true;
a.group.traverse((c) => { if (c.isMesh && c.userData.base === a.eyes[0].userData.base) sharedMat = false; });
ok(a.eyes[0].material !== b.eyes[0].material, 'eye material is per robot');
a.flash(true);
ok(a.group.children[0].children[0].material.type === 'MeshBasicMaterial', 'flash swaps to white');
a.flash(false);
ok(a.group.children[0].children[0].material.type === 'MeshLambertMaterial', 'flash restores');

for (const id of M.WEAPON_IDS) {
  const w = M.makeWeaponModel(id);
  const mz = w.getObjectByName('muzzle');
  ok(!!mz, `${id}: muzzle`);
  const bb = new THREE.Box3().setFromObject(w);
  const len = bb.max.z - bb.min.z;
  ok(len > 0.4 && len < 0.9, `${id}: length ${len.toFixed(2)}`);
  ok(mz.position.z < -0.3 && mz.position.z > bb.min.z - 0.05, `${id}: muzzle z ${mz.position.z}`);
  ok(bb.min.z > -0.7, `${id}: extends to ${bb.min.z.toFixed(2)}`);
  const p = M.makeWeaponPickup(id);
  const pb = new THREE.Box3().setFromObject(p);
  ok(Math.abs(pb.min.y) < 0.01, `${id} pickup floor ${pb.min.y}`);
  ok(pb.max.y > 0.9 && pb.max.y < 2.2, `${id} pickup top ${pb.max.y.toFixed(2)}`);
  finiteTransforms(p, `${id} pickup`);
  console.log(`${id}: length ${len.toFixed(2)} muzzle ${mz.position.toArray().map((v) => v.toFixed(3)).join(',')} z-range ${bb.min.z.toFixed(2)}..${bb.max.z.toFixed(2)} y-range ${bb.min.y.toFixed(2)}..${bb.max.y.toFixed(2)} pickup top ${pb.max.y.toFixed(2)}`);
}
const h = M.makeHealthPickup();
const hb = new THREE.Box3().setFromObject(h);
ok(Math.abs(hb.min.y) < 0.01 && hb.max.y > 0.5, 'health pickup bounds');
for (const kind of ['bottle', 'rocket']) {
  const p = M.makeProjectile(kind);
  ok(meshCount(p) > 0, `projectile ${kind}`);
  finiteTransforms(p, `projectile ${kind}`);
}
const mf = M.makeMuzzleFlash();
ok(meshCount(mf) > 0, 'muzzle flash');
let allAdd = true;
mf.traverse((c) => { if (c.isMesh && (c.material.blending !== THREE.AdditiveBlending || c.material.depthWrite)) allAdd = false; });
ok(allAdd, 'muzzle flash is additive with depthWrite false');
const mfb = new THREE.Box3().setFromObject(mf);
ok(mfb.max.x - mfb.min.x > 0.2 && mfb.max.x - mfb.min.x < 0.4, `muzzle flash width ${(mfb.max.x - mfb.min.x).toFixed(2)}`);
ok(meshCount(M.makeImpact()) > 0, 'impact');
try { M.makeRobot('nope'); ok(false, 'unknown robot should throw'); } catch { /* expected */ }

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('models-check: all passed');
