// Baked textures: loads the WebP files in assets/textures/ (made by scripts/blender/textures.py) into three.js textures.
// This is the one module that touches the DOM for textures. world.js stays procedural and DOM-free: it is handed finished
// textures (buildWorld({ baked }) or world.retexture(sets)) and otherwise keeps the generated ones, which are also what the
// low tier and every headless test use. Nothing here is required for the game to run: if a file is missing or slow, the
// generated texture stays. Files per surface: albedo (sRGB), normal (linear, OpenGL +Y) and roughness (linear grey, read
// from the green channel), the roughness at half the size. Details and sizes: docs/textures.md.
import * as THREE from '../vendor/three.module.min.js';
import { CEIL_VARIANTS, FLAG_VARIANTS } from './consts.js';
import INLINE from './textures-inline.js'; // null in the repo; scripts/build-artifact.mjs swaps in data URIs for the single-file build

// tile: the baked tile's size in metres [across, up]. scale: the metres one UV unit covers in world.js (the Mesher scale
// for that surface). The texture's repeat is scale / tile, so a baked tile bigger than the generated one just repeats less.
// ns: a multiplier on the material's normalScale. tint: a colour multiplier. files: which maps the surface has of its own
// (default all three); the rest come from `share`, so painted brick reuses brick's relief and floor boards the boards' whole
// set (darker, by tint), with no second copy in memory. A shared surface must have the same scale and tile as its source.
export const BAKED = {
  brick: { tile: [1.8, 0.9], scale: 0.9, ns: 1 },
  paint: { tile: [1.8, 0.9], scale: 0.9, ns: 0.7, files: ['map'], share: 'brick' },
  flag: { tile: [2 * FLAG_VARIANTS, 2], scale: 2, ns: 1 }, // an atlas of FLAG_VARIANTS layouts, 2 m each; world.js gives each floor tile one
  stone: { tile: [1.2, 1.2], scale: 1.2, ns: 1 },
  boards: { tile: [1.6, 1.6], scale: 1.6, ns: 1 },
  // ceiling plaster: an atlas of CEIL_VARIANTS tiles side by side, 2 m each; world.js gives each ceiling tile its own variant
  plaster: { tile: [2 * CEIL_VARIANTS, 2], scale: 2, ns: 1 },
  floorboards: { tile: [1.6, 1.6], scale: 1.6, ns: 1, files: [], share: 'boards', tint: 0.78 },
  concrete: { tile: [2.4, 2.4], scale: 2.4, ns: 1 }, // one slab, expansion joints on the tile edge
};
const FILES = { map: 'albedo', normal: 'normal', rough: 'rough' };
export const bakedNames = () => Object.keys(BAKED);
// [kind, file name] for the maps a surface has of its own
export const ownFiles = (name) => (BAKED[name].files || Object.keys(FILES)).map((k) => [k, `${name}-${FILES[k]}.webp`]);

function urlFor(file) {
  if (INLINE) return INLINE[file] || null;
  try { return new URL(`../assets/textures/${file}`, import.meta.url).href; } catch (e) { return null; }
}

async function loadImage(url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  if (img.decode) await img.decode(); // decode off the main thread now, so the upload later is not a stall
  else await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  return img;
}

function toTexture(img, kind, rep, aniso) {
  const t = new THREE.Texture(img);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (kind === 'map') t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(rep[0], rep[1]); // the roughness map is half size but covers the same tile, so the same repeat
  t.userData.baked = true; // shared between levels: world.js never disposes these
  t.needsUpdate = true;
  return t;
}

// Loads every surface in parallel. Resolves with { name: { map, normal, rough, ns, tint } } for the surfaces whose files all
// arrived; a surface that failed is left out (and the generated one stays). Never rejects.
export async function loadBaked(names = bakedNames(), aniso = 4) {
  const out = {};
  await Promise.all(names.map(async (name) => {
    const def = BAKED[name];
    if (!def || !ownFiles(name).length) return;
    try {
      const rep = [def.scale / def.tile[0], def.scale / def.tile[1]];
      const imgs = await Promise.all(ownFiles(name).map(async ([k, file]) => {
        const url = urlFor(file);
        if (!url) throw new Error('no url');
        return [k, await loadImage(url)];
      }));
      const set = { ns: def.ns };
      for (const [k, img] of imgs) set[k] = toTexture(img, k, rep, aniso);
      out[name] = set;
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('baked texture skipped:', name, e && e.message);
    }
  }));
  // surfaces that borrow maps from another one (a source that failed takes them with it)
  const own = { ...out };
  for (const name of names) {
    const def = BAKED[name];
    if (!def || !def.share) continue;
    const src = own[def.share];
    const mine = own[name] || (ownFiles(name).length === 0 ? {} : null);
    if (!src || !mine) { delete out[name]; continue; }
    out[name] = { ns: def.ns, map: mine.map || src.map, normal: mine.normal || src.normal, rough: mine.rough || src.rough };
    if (def.tint) out[name].tint = def.tint;
  }
  return out;
}

// Rough GPU cost of a set, in bytes: RGBA8 plus a third for the mip chain, every distinct texture counted once at its own size.
export function bakedBytes(sets) {
  const seen = new Set();
  let n = 0;
  for (const s of Object.values(sets || {})) {
    for (const t of [s.map, s.normal, s.rough]) {
      if (!t || !t.image || seen.has(t)) continue;
      seen.add(t);
      n += t.image.width * t.image.height * 4 * (4 / 3);
    }
  }
  return Math.round(n);
}
