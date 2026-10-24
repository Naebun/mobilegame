// Headless check of the baked texture hand-off (plain Node, no DOM, no WebP decoding):
//  - the files in assets/textures/ exist, are WebP, and their sizes agree with the manifest in src/textures.js
//  - the generated textures stay on the low tier and in every Node run, whatever is offered
//  - on medium and high, a baked set built in or swapped in replaces the generated texture, the old one is disposed,
//    a shared baked texture is never disposed, and the level's tints are untouched (they live in vertex colours)
//  - the game's own start-up in Node (no Image, no document) keeps the generated textures
// The browser side (the files really decode, the swap happens on the title screen, low loads nothing) is in smoke.mjs.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import * as THREE from '../../vendor/three.module.min.js';
import { buildWorld } from '../../src/world.js';
import { BAKED, bakedNames, ownFiles } from '../../src/textures.js';
import { CEIL_VARIANTS, TILE } from '../../src/consts.js';
import * as game from '../../src/game3d.js';

let failed = 0;
let total = 0;
const ok = (cond, msg) => { total++; if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); };
const DIR = new URL('../../assets/textures/', import.meta.url);

// ---- the files ----
function webpSize(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const fmt = buf.toString('latin1', 12, 16);
  if (fmt === 'VP8 ') return { fmt, w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (fmt === 'VP8L') { const b = buf.readUInt32LE(21); return { fmt, w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  if (fmt === 'VP8X') return { fmt, w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
  return null;
}
let bytes = 0;
const dimsOf = {};
for (const name of bakedNames()) {
  const def = BAKED[name];
  const dims = {};
  for (const [kind, file] of ownFiles(name)) {
    const f = new URL(file, DIR);
    ok(existsSync(f), `${file} exists`);
    if (!existsSync(f)) continue;
    bytes += statSync(f).size;
    dims[kind] = webpSize(readFileSync(f));
    ok(!!dims[kind], `${file} is a WebP file (${dims[kind] && dims[kind].fmt} ${dims[kind] && dims[kind].w}x${dims[kind] && dims[kind].h})`);
  }
  dimsOf[name] = dims;
  const alb = dims.map || (def.share && dimsOf[def.share] && dimsOf[def.share].map);
  if (def.share) {
    ok(!!dimsOf[def.share], `${name} borrows from ${def.share}, which has files of its own`);
    ok(BAKED[def.share].scale === def.scale && BAKED[def.share].tile.join() === def.tile.join(), `${name} and ${def.share} share one scale and tile`);
    if (dims.map && dimsOf[def.share].map) ok(dims.map.w === dimsOf[def.share].map.w && dims.map.h === dimsOf[def.share].map.h, `${name}: albedo is the same size as ${def.share}'s maps`);
  }
  if (dims.map && dims.normal && dims.rough) {
    ok(dims.map.w === dims.normal.w && dims.map.h === dims.normal.h, `${name}: albedo and normal are the same size`);
    ok(dims.rough.w * 2 === dims.map.w && dims.rough.h * 2 === dims.map.h, `${name}: roughness is half size`);
  }
  if (alb) {
    ok(Math.abs(alb.w / alb.h - def.tile[0] / def.tile[1]) < 1e-6, `${name}: the image aspect matches the tile in the manifest (${def.tile.join(' x ')} m)`);
    ok((alb.w & (alb.w - 1)) === 0 && (alb.h & (alb.h - 1)) === 0, `${name}: power-of-two size (clean mip chain)`);
  }
}
// the service worker precaches them (addAll fails the whole install if one is missing, so the list must be exact)
{
  const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
  const listed = [...sw.matchAll(/'assets\/textures\/([^']+)'/g)].map((m) => m[1]).sort();
  const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.webp')).sort();
  ok(JSON.stringify(listed) === JSON.stringify(onDisk), `sw.js precaches exactly the ${onDisk.length} files in assets/textures/`);
  ok(sw.includes("'src/textures.js'") && sw.includes("'src/textures-inline.js'"), 'sw.js precaches src/textures.js and its inline stub');
}
console.log(`     baked files: ${(bytes / 1024).toFixed(0)} KB in total`);
ok(bytes > 0 && bytes < 1.3 * 1024 * 1024, 'the baked files stay inside the 1.3 MB budget');

// ---- the plaster atlas: CEIL_VARIANTS tiles side by side, and world.js points each ceiling tile at one of them ----
{
  const pm = dimsOf.plaster && dimsOf.plaster.map;
  ok(pm && pm.w === CEIL_VARIANTS * pm.h, `plaster atlas is ${CEIL_VARIANTS} square tiles side by side (${pm && pm.w}x${pm && pm.h})`);
  ok(BAKED.plaster.tile[0] === 2 * CEIL_VARIANTS && BAKED.plaster.tile[1] === 2 && BAKED.plaster.scale === 2, 'the manifest tile for plaster is CEIL_VARIANTS 2 m tiles wide, 2 m tall, at world scale 2');
  for (const lv of [1, 2]) {
    for (const q of ['low', 'medium']) {
      const w = buildWorld({ quality: q, level: lv });
      let ceil = null;
      w.group.traverse((o) => { if (o.isMesh && o.userData.ceil) ceil = o; });
      const pos = ceil.geometry.attributes.position;
      const uv = ceil.geometry.attributes.uv;
      let whole = true;
      let inside = true;
      const used = new Set();
      for (let i = 0; i < pos.count; i++) {
        const d = uv.getX(i) - pos.getX(i) / TILE; // a whole number of tiles: the variant offset
        if (Math.abs(d - Math.round(d)) > 1e-4) whole = false;
        if (uv.getX(i) < -1e-4 || uv.getX(i) > CEIL_VARIANTS + 1e-4) inside = false;
        if (Math.abs(pos.getX(i) / TILE - Math.round(pos.getX(i) / TILE)) > 0.1) used.add(Math.floor(uv.getX(i))); // interior vertices only: a tile's edge belongs to two
      }
      ok(whole && inside, `level ${lv} ${q}: every ceiling tile's u is its own tile plus a whole-tile variant offset, inside 0..${CEIL_VARIANTS}`);
      if (q !== 'low') ok(used.size >= CEIL_VARIANTS, `level ${lv} ${q}: the ceiling uses ${CEIL_VARIANTS} variants (${[...used].sort().join(', ')})`);
      w.disposeTextures();
    }
  }
}

// ---- fake baked sets: real three.js textures with no image, flagged like src/textures.js flags them ----
const fakeSet = () => {
  const out = {};
  for (const n of bakedNames()) {
    const mk = () => { const t = new THREE.Texture(); t.userData.baked = true; t.repeat.set(0.5, 1); t.addEventListener('dispose', () => { t.userData.disposed = (t.userData.disposed || 0) + 1; }); return t; };
    out[n] = { map: mk(), normal: mk(), rough: mk(), ns: 1 };
  }
  return out;
};
const usesMap = (w, tex) => { let n = 0; w.group.traverse((o) => { if (o.isMesh && o.material.map === tex) n++; }); return n; };
const watch = (t) => { const r = { n: 0 }; t.addEventListener('dispose', () => r.n++); return r; };

for (const q of ['medium', 'high']) {
  // built in: the generated texture for that surface is never made
  const set = fakeSet();
  const w = buildWorld({ quality: q, level: 1, baked: set });
  ok(w.textures.brick === set.brick.map && w.textures.flag === set.flag.map, `${q}: buildWorld({ baked }) uses the baked textures given`);
  ok(usesMap(w, set.brick.map) >= 1 && usesMap(w, set.flag.map) >= 1, `${q}: the brick and flag meshes carry the baked maps`);
  ok(w.textures.carpet.isDataTexture, `${q}: surfaces without a baked set (carpet) stay generated`);
  ok(JSON.stringify(w.bakedNames.sort()) === JSON.stringify(bakedNames().sort()), `${q}: bakedNames lists them (${w.bakedNames.join(', ')})`);
  let brickMat = null;
  w.group.traverse((o) => { if (o.isMesh && o.material.map === set.brick.map) brickMat = o.material; });
  ok(brickMat.vertexColors && brickMat.roughnessMap === set.brick.rough && brickMat.normalMap === set.brick.normal, `${q}: tints stay in vertex colours and the normal and roughness maps come with the albedo`);
  ok(brickMat.map.repeat.x === 0.5, `${q}: the baked tile repeat is kept`);
  w.disposeTextures();
  ok(!set.brick.map.userData.disposed && !set.flag.normal.userData.disposed, `${q}: disposeTextures leaves shared baked textures alone`);
  ok(w.textures.carpet.isDataTexture, `${q}: (generated ones are still there to dispose)`);

  // swapped in later: what the title screen does once the files arrive
  const w2 = buildWorld({ quality: q, level: 2 });
  const oldBrick = w2.textures.brick;
  const oldNormal = [];
  w2.group.traverse((o) => { if (o.isMesh && o.material.map === oldBrick) oldNormal.push(o.material.normalMap); });
  const d = [watch(oldBrick), watch(oldNormal[0])];
  ok(oldBrick.isDataTexture && w2.bakedNames.length === 0, `${q} level 2: starts on generated textures`);
  const set2 = fakeSet();
  const done = w2.retexture(set2);
  ok(done.length === bakedNames().length, `${q} level 2: retexture swaps every surface (${done.join(', ')})`);
  ok(usesMap(w2, oldBrick) === 0 && usesMap(w2, set2.brick.map) >= 1, `${q} level 2: no mesh still carries the old generated brick`);
  ok(d[0].n === 1 && d[1].n === 1, `${q} level 2: the old generated albedo and normal textures were disposed once (GPU copies freed)`);
  ok(!set2.brick.map.userData.disposed, `${q} level 2: the new baked textures were not disposed`);
  ok(w2.textures.brick === set2.brick.map, `${q} level 2: world.textures follows the swap`);
  ok(w2.retexture(set2).length === 0, `${q} level 2: swapping the same set twice is a no-op`);
  ok(w2.retexture(null).length === 0 && w2.retexture({}).length === 0 && w2.retexture({ nothing: { map: new THREE.Texture() } }).length === 0, `${q} level 2: empty and unknown sets are ignored`);
  w2.disposeTextures();
  ok(!set2.flag.map.userData.disposed, `${q} level 2: baked textures survive the world being disposed (the next level reuses them)`);
}

// ---- low tier and plain Node keep the generated textures ----
{
  const set = fakeSet();
  const w = buildWorld({ quality: 'low', level: 1, baked: set });
  ok(w.textures.brick.isDataTexture && w.bakedNames.length === 0, 'low: buildWorld ignores baked textures');
  ok(w.retexture(set).length === 0 && w.textures.brick.isDataTexture, 'low: retexture does nothing');
  let lambert = true;
  w.group.traverse((o) => { if (o.isMesh && o.material.normalMap) lambert = false; });
  ok(lambert, 'low: no normal maps anywhere (Lambert, as before)');
  const w0 = buildWorld({ quality: 'medium', level: 1 });
  ok(w0.bakedNames.length === 0 && w0.textures.brick.isDataTexture, 'Node default: generated textures, nothing baked');
}
{
  Math.random = (() => { let a = 7; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  game.init({ w: 390, h: 844, dpr: 1, safe: { top: 0, bottom: 0 } });
  const b = game.testHook('baked');
  ok(b.state === 'off' && b.names.length === 0, `the game starting in Node does not load baked textures (state ${b.state})`);
}

console.log(`\n${total - failed}/${total} checks passed`);
process.exit(failed ? 1 : 0);
