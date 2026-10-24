// Naebun's Last Set, first-person edition. Level 1: the Cowgate.
// Owns the state machine, player, weapons, robots, projectiles, areas and doors, and the three.js renderer.
// Content lives in data.js, the level in world.js, meshes in models.js, 2D drawing in hud.js and screens.js.
// Contract for all of those: docs/fps-design.md.

import * as THREE from '../vendor/three.module.min.js';
import * as audio from './audio.js';
import { WALL_H, EYE, PLAYER_R, COLOURS } from './consts.js';
import { buildWorld } from './world.js';
import { loadBaked, bakedBytes } from './textures.js';
import { createPipeline, TIERS, TIER_ORDER } from './gfx.js';
import { makeEnvironment } from './gfx-env.js';
import { createFx } from './fx.js';
import {
  makeRobot, makeWeaponModel, makeWeaponPickup, makeHealthPickup, makeProjectile, makeMuzzleFlash, makeImpact,
} from './models.js';
import * as hud from './hud.js';
import * as screens from './screens.js';
import * as M from './models.js';
import * as store from './save.js';
import { createArsenalPlay } from './arsenal-play.js';
import { createPerf } from './perf.js';
import { WEAPONS, WEAPON_ORDER, ENEMY_DEFS, PLAYER, LEVELS, DEATH_LINES, DRINKS, DRINK_ORDER, DIFFICULTY, DIFFICULTY_ORDER, defFor } from './data.js';

const TAU = Math.PI * 2;
const HURT_DUR = 0.38; // matches the hurt animation length in models.js
const BEST_KEY = 'mobilegame.fps.best'; // the older, localStorage-only best scores: level 1; later levels append their number
const bestKey = (n) => (n > 1 ? `${BEST_KEY}.${n}` : BEST_KEY);
const DEBUG_KEY = 'mobilegame.debugMode';
const QUALITY_KEY = 'mobilegame.quality';
const SETTINGS_KEY = 'mobilegame.settings';
// Mouse sensitivity steps, as a multiple of PLAYER.mouse (radians per mouse count).
const MOUSE_SENS = [{ label: 'LOW', k: 0.6 }, { label: 'MEDIUM', k: 1 }, { label: 'HIGH', k: 1.7 }];
const FX_QUALITY = { high: 1, medium: 0.7, low: 0.4 };
const DEFAULT_TORCH = { colour: 0xfff0d8, intensity: 32, distance: 24, angle: 0.4, penumbra: 0.55, decay: 1.5, beam: 16 };
const DEFAULT_LOOK = { exposure: 1, bloom: 0.5, vignette: 0.35, grade: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1] } };
const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams('');
// Input mode: 'pc' (mouse look and keys, the grey touch boxes hidden) or 'mobile' (the touch boxes). The default is PC; a
// mobile browser switches to mobile at start-up. A choice made on the Settings page is saved and wins. ?pc and ?mobile
// force a mode, for tests.
function detectMobile() {
  if (query.has('mobile')) return true;
  if (query.has('pc')) return false;
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse) and (hover: none)').matches;
  const ipadOs = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1; // iPadOS asks for the desktop site
  return coarse || ipadOs || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}
let mobileBrowser = detectMobile();
const inputMode = () => S.settings.input || (mobileBrowser ? 'mobile' : 'pc');
// Quality: ?q=low|medium|high forces a tier (used by tests); otherwise start from the saved tier (default high)
// and step down automatically if the device is clearly struggling. ?perf (or the P key) shows the readout in src/perf.js.
const Q = { tier: 'high', fixed: false, ema: 1 / 60, frames: 0, last: 0, fps: 60 };
let PERF = null; // the performance readout; null (one check per frame, nothing else) until switched on
// Debug mode is a testing aid for Naebun only. It must never feed back into balance: enemies, weapons' base stats,
// areas and everything in data.js are tuned for normal mode alone.
const DEBUG_MULT = { fire: 2, damage: 2, health: 2 };
const NORMAL_MULT = { fire: 1, damage: 1, health: 1 };
// Difficulty (docs/difficulty.md) is a different thing: it scales the robots, once, when each is spawned (defFor in data.js).
// Debug mode stacks on top of it and neither knows about the other. ?difficulty=hard|extra forces a mode, for tests.
const forcedMode = () => (DIFFICULTY[query.get('difficulty')] ? query.get('difficulty') : null);

const S = {
  mode: 'title', // title | controls | settings | voicemail | intro | play | dead | complete
  torch: { attached: false, on: false, k: 0 }, // the gun torch: fitted to the pistol, switched on, brightness 0..1
  attach: null, // the fitting sequence at the start of the first dark level: { t, k, seated, onT }
  keyF: false,
  settings: { input: null, sens: 1 }, // saved; input is 'pc', 'mobile' or null (detect); sens indexes MOUSE_SENS
  save: store.fresh(), // progress: unlocked level, levels done, best scores (src/save.js: a cookie, mirrored in localStorage)
  resetArmed: 0, // seconds left in which a second tap on RESET PROGRESS erases the save
  mouseLocked: false,
  mouseTest: null, // tests inject mouse input here: { dx, dy, down, wheel }
  level: 1, // the level being played (or about to be)
  mailT: 0,
  pendingLoad: false,
  loadReady: false,
  t: 0,
  runT: 0,
  introT: 0,
  deadT: 0,
  completeT: 0,
  debugMode: false,
  difficulty: 'normal', // normal | hard | extra: this run's mode, fixed from START GAME on (src/data.js DIFFICULTY)
  prevKeys: new Set(), // keys held on the previous menu step, so a key press is one press
  best: 0,
  newBest: false,
  score: 0,
  kills: 0,
  shots: 0,
  totalEnemies: 0,
  deadLine: '',
  player: null,
  enemies: [],
  projectiles: [],
  pickups: [],
  areas: [],
  currentArea: null,
  toast: null,
  banner: null,
  boss: null,
  damageDirs: [],
  hitMarker: 0,
  headshot: false,
  allClear: false,
  camK: 0, // 0 first person .. 1 third person (Last Orders pulls the camera out)
  camYaw: 0, // where the third-person camera sits: behind this heading
  laser: null, // the super power-up spin: { t, dur, charge, yaw0, beam, len, sounded }
  drink: null, // the drink being drunk: { id, t, dur, opened, gulpT, applied }
  buffs: { speed: 0, guard: 0, rapid: 0 }, // seconds left
  view: null,
  ui: { move: { active: false, nx: 0, ny: 0 }, look: { active: false, nx: 0, ny: 0 }, firing: false },
};

let world = null;
let flow = null;
let flowT = 0;
let R = null; // renderer state, null when running headless (tests and simulations)
let layoutCache = null;
let layoutKey = '';
const initialOpen = {};

// ---- helpers ----

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const mult = () => (S.debugMode ? DEBUG_MULT : NORMAL_MULT);

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
}

function layoutFor(view) {
  const key = `${view.w}x${view.h}x${view.safe.top}x${view.safe.bottom}`;
  if (key !== layoutKey) {
    layoutCache = hud.layout(view);
    layoutKey = key;
  }
  return layoutCache;
}

// Drink models come from models.js; until a model exists the old medkit stands in so nothing breaks.
const makeDrinkMesh = (id) => {
  try {
    return M.makeDrinkPickup ? M.makeDrinkPickup(id) : M.makeHealthPickup();
  } catch {
    return M.makeHealthPickup();
  }
};
const buffOn = (name) => S.buffs[name] > 0;

// The prepared arsenal (src/arsenal-play.js, docs/arsenal.md): the Feedback Beam, Bass-Drop Grenade and Airhorn, stun, the SMG's
// alt-fire, upgrades and collectible records. Levels 1 and 2 place it (docs/placement.md); the hooks below are all it needs from here.
const ARS = createArsenalPlay({
  S, M, audio, store, getWorld: () => world, getR: () => R, castRay, damageEnemy, alertNear, forward3, spark, fxHit, toast, mult, bounceOff,
  inputMode: () => inputMode(),
  fireRate: () => mult().fire * (buffOn('rapid') ? DRINKS.energy.mult : 1),
});

const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// ---- lifecycle ----

export function init(view) {
  S.view = view;
  const savedSettings = read(SETTINGS_KEY);
  if (savedSettings && typeof savedSettings === 'object') S.settings = { input: savedSettings.input === 'pc' || savedSettings.input === 'mobile' ? savedSettings.input : null, sens: clamp(Math.round(Number(savedSettings.sens)) || 1, 0, MOUSE_SENS.length - 1) };
  S.save = store.load();
  S.torch.attached = S.save.torch === true;
  for (let n = 1; n <= store.MAX_LEVELS; n++) { // scores from before the cookie save existed: they were normal mode
    const old = Number(read(bestKey(n))) || 0;
    if (old > store.bestOf(S.save, 'normal', n)) store.setBest(S.save, 'normal', n, old);
  }
  S.level = startLevel();
  S.difficulty = startMode();
  S.best = bestFor(S.level);
  S.debugMode = read(DEBUG_KEY) === true;
  const forced = query.get('q');
  const saved = read(QUALITY_KEY);
  Q.fixed = !!TIERS[forced];
  Q.tier = TIERS[forced] ? forced : (TIERS[saved] ? saved : 'high');
  world = buildWorld({ quality: Q.tier, level: S.level, baked: bakedSets() });
  rememberDoors();
  flow = world.createFlowField();
  if (typeof document !== 'undefined' && document.getElementById('gl')) { initRender(view); startBaked(); }
  resetLevel();
  S.mode = 'title';
}

// ?level=2 starts a new game on that level (a development shortcut; the game itself goes 1 then 2).
function startLevel() {
  const n = Number(query.get('level'));
  return n >= 1 && n <= LEVELS.length ? Math.floor(n) : 1;
}

const bestFor = (n) => store.bestOf(S.save, S.difficulty, n);
// The mode a new game starts highlighted in and CONTINUE resumes in: the saved one (or ?difficulty). The run's own mode is S.difficulty.
const startMode = () => forcedMode() || S.save.difficulty;
const setDifficulty = (m) => {
  S.difficulty = DIFFICULTY[m] ? m : 'normal';
  S.best = bestFor(startLevel());
};

function rememberDoors() {
  for (const k of Object.keys(initialOpen)) delete initialOpen[k];
  for (const d of world.doors) initialOpen[d.id] = d.open;
}

const levelInfo = () => LEVELS[S.level - 1];

// Swap the world for another level. The scene keeps its lights; only the level group, fog, ambient and looks change.
function loadLevel(n) {
  S.level = n;
  S.best = bestFor(n);
  if (world && world.level === n) return;
  const old = world;
  world = buildWorld({ quality: Q.tier, level: n, baked: bakedSets() });
  rememberDoors();
  flow = world.createFlowField();
  if (R) {
    R.scene.remove(old.group);
    old.group.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const m of [].concat(o.material)) m.dispose();
    });
    old.disposeTextures(); // generated textures only: the baked ones are shared with the next level
    applyAtmosphere();
    R.scene.add(world.group);
  }
}

// Baked textures (src/textures.js, made by scripts/blender/textures.py): medium and high tiers only, loaded in the background
// from the title screen. The game never waits for them: it starts on the generated textures, which also stay if a file fails
// or the tier is low. When the files arrive they are swapped in at the next moment nobody is playing (a texture upload is a
// small stall), and every level built afterwards takes them directly. ?baked=0 turns them off, for before and after shots.
const BAKED = { state: 'off', sets: null, bytes: 0 }; // off | loading | ready | applied | failed
const bakedSets = () => (BAKED.state === 'ready' || BAKED.state === 'applied') && Q.tier !== 'low' ? BAKED.sets : null;
function startBaked() {
  if (Q.tier === 'low' || query.get('baked') === '0' || typeof Image === 'undefined') return;
  BAKED.state = 'loading';
  loadBaked().then((sets) => {
    BAKED.sets = sets;
    BAKED.bytes = bakedBytes(sets);
    BAKED.state = Object.keys(sets).length ? 'ready' : 'failed';
  });
}
function applyBaked() {
  if (BAKED.state !== 'ready' || !R || Q.tier === 'low') return;
  if (S.mode === 'play' && !query.has('test')) return; // wait for the next menu, death or level change
  world.retexture(BAKED.sets);
  for (const set of Object.values(BAKED.sets)) for (const t of [set.map, set.normal, set.rough]) R.renderer.initTexture(t); // upload now, not on the first frame that needs it
  BAKED.state = 'applied';
}

// Fog, ambient, grade, the camera fill light and the gun torch's settings all come from the level.
function applyAtmosphere() {
  const { scene, hemi, fill } = R;
  scene.background = new THREE.Color(world.fog.colour);
  scene.fog = new THREE.Fog(world.fog.colour, world.fog.near, world.fog.far);
  hemi.color.set(world.ambient.sky);
  hemi.groundColor.set(world.ambient.ground);
  hemi.intensity = world.ambient.intensity;
  const f = world.fill || {};
  fill.color.set(f.colour ?? 0xfff0dd);
  R.fillBase = f.intensity ?? 0;
  fill.intensity = R.fillBase;
  fill.distance = f.range ?? 15;
  fill.decay = f.decay ?? 1.6;
  const t = { ...DEFAULT_TORCH, ...(world.torch || {}) };
  R.torchCfg = t;
  R.spot.color.set(t.colour);
  R.spot.distance = t.distance;
  R.spot.angle = t.angle;
  R.spot.penumbra = t.penumbra;
  R.spot.decay = t.decay;
  R.tbeam.setCone(t.beam, t.angle, t.colour);
  const wl = world.look || {};
  R.look = { ...DEFAULT_LOOK, ...wl, grade: { ...DEFAULT_LOOK.grade, ...(wl.grade || {}) } };
}

// Vertical field of view. Portrait keeps 85; in landscape the same number would give a fish-eye, so it narrows to hold the
// horizontal view near 100 degrees. An iPad's squarer screen lands in between.
export function baseFov(aspect) {
  if (aspect <= 1) return 85;
  return clamp((2 * Math.atan(Math.tan((50 * Math.PI) / 180) / aspect) * 180) / Math.PI, 50, 85);
}

// How far right of centre the weapon sits: in portrait it is nearly central, in landscape it moves out to the right
// so it stays at the edge of a much wider picture.
function weaponX(aspect) {
  const halfW = Math.tan((35 * Math.PI) / 180) * aspect * 0.62; // half the visible width at the weapon's distance
  return clamp(halfW * 0.4, 0.08, 0.4);
}

export function resize(view) {
  S.view = view;
  if (!R) return;
  R.pipeline.resize(view);
  R.camera.aspect = view.w / view.h;
  R.baseFov = baseFov(R.camera.aspect);
  R.fov = R.baseFov;
  R.camera.fov = R.baseFov;
  R.camera.updateProjectionMatrix();
  R.wcam.aspect = view.w / view.h;
  R.wcam.updateProjectionMatrix();
  R.fx.setScale((view.h * R.pipeline.pixelRatio) / (2 * Math.tan((R.camera.fov * Math.PI) / 360)));
}

// Mouse look is wanted only while playing in PC mode. The engine asks every frame, so it also
// lets go of the pointer when we stop wanting it (death, the level-complete screen).
export function wantsMouseLock() {
  return inputMode() === 'pc' && S.mode === 'play';
}

export function pointerLock(locked) {
  S.mouseLocked = locked;
}

function saveSettings() {
  write(SETTINGS_KEY, S.settings);
}

export function gesture() {
  audio.unlock();
}

function initRender(view) {
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.setClearColor(COLOURS.bg, 1);

  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  scene.add(hemi);
  scene.add(world.group);
  const camera = new THREE.PerspectiveCamera(85, view.w / view.h, 0.05, 80);
  camera.rotation.order = 'YXZ';
  const fill = new THREE.PointLight(0xfff0dd, 1.2, 15, 1.6); // a small light on the camera; strength and reach come from the level
  camera.add(fill);
  const spot = new THREE.SpotLight(0xfff0d8, 0, 24, 0.4, 0.55, 1.5); // the gun torch: placed on the lens every frame
  scene.add(spot, spot.target);
  const tbeam = makeTorchBeam();
  scene.add(tbeam.mesh);
  scene.add(camera);

  // The weapon is drawn in its own pass with a cleared depth buffer so it never clips into walls.
  const wscene = new THREE.Scene();
  wscene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(0.5, 1, 0.6);
  wscene.add(sun);
  const env = makeEnvironment(renderer);
  scene.environment = env;
  wscene.environment = env;
  const wcam = new THREE.PerspectiveCamera(70, view.w / view.h, 0.02, 10);
  const wroot = new THREE.Group();
  wscene.add(wroot);
  const models = {};
  const flashes = {};
  for (const id of WEAPON_ORDER) {
    const m = makeWeaponModel(id);
    m.visible = false;
    wroot.add(m);
    models[id] = m;
    const flash = makeMuzzleFlash();
    flash.visible = false;
    (m.getObjectByName('muzzle') || m).add(flash);
    flashes[id] = flash;
  }

  let attachRig = null; // the left hand fitting the pistol's torch (a Blender model; absent if the models do not have it)
  if (M.makeTorchAttach) {
    attachRig = M.makeTorchAttach();
    attachRig.group.visible = false;
    wroot.add(attachRig.group);
  }

  const drinkVms = {};
  if (M.makeDrinkViewmodel) {
    for (const id of DRINK_ORDER) {
      if (M.DRINK_IDS && !M.DRINK_IDS.includes(id)) continue;
      const vm = M.makeDrinkViewmodel(id);
      vm.group.visible = false;
      wroot.add(vm.group);
      drinkVms[id] = vm;
    }
  }

  // Naebun himself, seen only when Last Orders pulls the camera out to third person
  const naebun = M.makeNaebun ? M.makeNaebun() : fallbackNaebun();
  naebun.group.visible = false;
  scene.add(naebun.group);

  // the laser: a white-hot core inside a wide magenta glow, both HDR so they bloom; unit length along -z
  const beam = new THREE.Group();
  const beamPart = (w, colour, power, opacity) => {
    const geo = new THREE.BoxGeometry(w, w, 1);
    geo.translate(0, 0, -0.5);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colour).multiplyScalar(power), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    beam.add(m);
    return m;
  };
  const beamCore = beamPart(0.16, 0xffffff, 9, 1);
  const beamMid = beamPart(0.5, 0xff8ad8, 4, 0.55);
  const beamGlow = beamPart(1.1, 0xff2e93, 2.4, 0.3);
  beam.visible = false;
  scene.add(beam);

  const impacts = [];
  for (let i = 0; i < 24; i++) {
    const o = makeImpact();
    o.visible = false;
    scene.add(o);
    impacts.push({ obj: o, t: 0 });
  }

  const pipeline = createPipeline(renderer, view, Q.tier);
  const fx = createFx(scene);
  fx.setQuality(FX_QUALITY[Q.tier]);
  R = { renderer, scene, camera, hemi, fill, fillBase: 0, spot, tbeam, torchCfg: DEFAULT_TORCH, attachRig, wscene, wcam, wroot, models, flashes, impacts, explosions: [], flashT: 0, muzzleT: 0, pipeline, fx, look: null, drinkVms, beam, beamParts: [beamCore, beamMid, beamGlow], fov: 85, baseFov: 85, naebun };
  applyAtmosphere();
  resize(view);
  initPerf();
}

// The performance readout: ?perf in the URL, or the P key, switches it on (and off). Nothing exists until then.
function setPerf(on) {
  if (on && !PERF && R) {
    PERF = createPerf({
      renderer: R.renderer,
      scenes: () => [R.scene, R.wscene],
      info: () => {
        const area = world.areaAt(S.player.x, S.player.z);
        return { tier: R.pipeline.tier, fixed: Q.fixed, pixelRatio: R.pipeline.pixelRatio, level: S.level, area: area ? area.id : '' };
      },
    });
    if (PERF) window.__perf = PERF; // the latest numbers, for tests and for reading off a connected phone
  } else if (!on && PERF) {
    PERF.destroy();
    PERF = null;
    delete window.__perf;
  }
}

function initPerf() {
  if (typeof window === 'undefined') return;
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'p' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) setPerf(!PERF);
  });
  if (query.has('perf')) setPerf(true);
}

// The torch beam: an open cone from the lens, drawn additively and brightest at its edges-on silhouette fade, so it reads as
// light in dusty air. Radius and length are set by uniforms; the mesh is placed and aimed each frame.
function makeTorchBeam() {
  const SEG = 28;
  const dir = [];
  const along = [];
  const idx = [];
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * TAU;
      dir.push(Math.cos(a), Math.sin(a));
      along.push(ring);
    }
  }
  for (let i = 0; i < SEG; i++) idx.push(i, i + 1, SEG + 1 + i + 1, i, SEG + 1 + i + 1, SEG + 1 + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(dir.length / 2 * 3), 3)); // unused, but three wants one
  g.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 2));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1000);
  const u = { uL: { value: 10 }, uR0: { value: 0.03 }, uR1: { value: 3 }, uI: { value: 0 }, uColor: { value: new THREE.Color(0xfff0d8) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: `
      attribute vec2 aDir; attribute float aT;
      uniform float uL; uniform float uR0; uniform float uR1;
      varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        float r = mix(uR0, uR1, aT);
        vec3 p = vec3(aDir * r, -aT * uL);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vT = aT;
        vN = normalize(normalMatrix * vec3(aDir, 0.0));
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uI; uniform vec3 uColor;
      varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        float f = abs(dot(normalize(vN), normalize(vV)));
        float a = pow(f, 1.7) * pow(1.0 - vT, 2.4) * smoothstep(0.0, 0.05, vT) * uI;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.visible = false;
  return {
    mesh,
    u,
    setCone(length, angle, colour) {
      u.uColor.value.set(colour);
      this.length = length;
      this.tanA = Math.tan(angle * 0.85);
    },
    length: 16,
    tanA: 0.35,
  };
}

// Stand-in until models.js provides makeNaebun: a simple figure with a cannon, enough to see the spin.
function fallbackNaebun() {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
  const box = (w, h, d, x, y, z, c) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  box(0.55, 0.8, 0.32, 0, 1.15, 0, 0x6d28d9);
  box(0.2, 0.75, 0.2, -0.14, 0.4, 0, 0x2a3a5a);
  box(0.2, 0.75, 0.2, 0.14, 0.4, 0, 0x2a3a5a);
  box(0.3, 0.3, 0.3, 0, 1.75, 0, 0xf0c8a0);
  box(0.36, 0.1, 0.36, 0, 1.92, 0, 0xff2e93);
  box(0.16, 0.16, 0.9, -0.2, 1.25, -0.5, 0x6d28d9);
  box(0.16, 0.16, 0.9, 0.2, 1.25, -0.5, 0x6d28d9);
  box(0.5, 0.5, 0.7, 0, 1.25, -1.0, 0x333344);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 1.25, -1.4);
  g.add(muzzle);
  return { group: g, height: 1.9, setPose() {}, muzzle };
}

function resetLevel() {
  for (const e of S.enemies) if (R) R.scene.remove(e.robot.group);
  S.enemies.length = 0;
  for (const pr of S.projectiles) if (R) R.scene.remove(pr.mesh);
  S.projectiles.length = 0;
  for (const pk of S.pickups) if (R) R.scene.remove(pk.mesh);
  S.pickups.length = 0;
  if (R) {
    for (const x of R.explosions) R.scene.remove(x.mesh);
    R.explosions.length = 0;
  }

  for (const d of world.doors) world.setDoorOpen(d.id, initialOpen[d.id]);
  world.update(3, S.t); // finish any door animation immediately

  S.areas = world.areas.map((a) => ({ def: a, alive: a.spawns.length, cleared: a.spawns.length === 0, announced: false }));
  for (const a of world.areas) for (const sp of a.spawns) spawnEnemy(a, sp);
  S.totalEnemies = S.enemies.length;

  for (const raw of world.pickups) {
    const def = raw.kind === 'health' ? { ...raw, kind: 'drink', item: 'dram' } : raw; // older levels had medkits
    const mesh = ARS.meshFor(def) || (def.kind === 'weapon' ? makeWeaponPickup(def.item) : makeDrinkMesh(def.item));
    mesh.position.set(def.x, 0, def.z);
    if (R) R.scene.add(mesh);
    S.pickups.push({ def, mesh, taken: false, phase: rand(0, TAU) });
  }

  const m = mult();
  S.player = {
    x: world.start.x, z: world.start.z, yaw: world.start.yaw, pitch: 0, vx: 0, vz: 0,
    health: PLAYER.health * m.health, maxHealth: PLAYER.health * m.health,
    weapon: 'pistol', owned: { pistol: true }, ammo: { pistol: WEAPONS.pistol.clip },
    reloadT: 0, fireT: 0, heat: 0, switchT: 0.25, bobT: 0, moveMag: 0, kick: 0, hurt: 0, shake: 0,
  };
  ARS.reset(); // the arsenal's run state: upgrades, the alt-fire, the beam
  S.runT = 0;
  S.score = 0;
  S.kills = 0;
  S.shots = 0;
  S.toast = null;
  S.banner = null;
  S.boss = null;
  S.damageDirs.length = 0;
  S.hitMarker = 0;
  S.allClear = false;
  S.currentArea = null;
  S.newBest = false;
  S.drink = null;
  S.laser = null;
  S.camK = 0;
  S.buffs.speed = S.buffs.guard = S.buffs.rapid = 0;
  // the torch: a dark level starts with the fitting sequence (once; the pistol keeps it after), a lit one with the torch off
  S.attach = world.dark && !S.torch.attached ? { t: 0, k: 0, seated: false, onT: -1 } : null;
  S.torch.on = world.dark && S.torch.attached;
  S.torch.k = S.torch.on ? 1 : 0;
  flowT = 0;
  flow.update(S.player.x, S.player.z);
}

// Building a level takes a moment, so in the browser the swap waits until a frame showing the new screen has been drawn.
function requestLevel(n) {
  if (!R) { loadLevel(n); resetLevel(); return; }
  S.level = n;
  S.pendingLoad = true;
  S.loadReady = false;
}

function toTitle() {
  S.mode = 'title';
  setDifficulty(startMode()); // a pick that was never started (or a debug run's) does not stay on the title
  if (world.level !== startLevel()) requestLevel(startLevel());
  else resetLevel();
  audio.setMood(0.1, false);
}

function beginRun() {
  audio.unlock();
  if (S.level === 1) S.torch.attached = false; // a new game: the pistol has no torch until the first dark level
  if (!S.debugMode && S.save.difficulty !== S.difficulty) { // the run's mode is saved so CONTINUE resumes in it; a debug run never writes it
    S.save.difficulty = S.difficulty;
    store.save(S.save);
  }
  loadLevel(S.level);
  resetLevel();
  S.mode = 'intro';
  S.introT = 0;
  audio.setLevel(S.level - 1);
}

// Title, CONTINUE: back to the furthest level unlocked, behind its voicemail (a returning player has heard the first level's story).
function resumeGame() {
  const n = Math.min(S.save.unlocked, LEVELS.length);
  audio.unlock();
  S.torch.attached = S.save.torch === true;
  S.difficulty = startMode(); // CONTINUE resumes in the saved mode
  if (world.level !== n || S.pendingLoad) requestLevel(n);
  else { S.level = n; S.best = bestFor(n); resetLevel(); }
  audio.setLevel(n - 1);
  if (n > 1 && LEVELS[n - 1].voicemail) {
    S.mode = 'voicemail';
    S.mailT = 0;
  } else {
    S.mode = 'intro';
    S.introT = 0;
  }
}

// Level complete, NEXT LEVEL: load the next level behind a voicemail card (or straight to its intro if it has none).
function nextLevel() {
  requestLevel(S.level + 1);
  audio.setLevel(S.level - 1);
  if (levelInfo().voicemail) {
    S.mode = 'voicemail';
    S.mailT = 0;
  } else {
    S.mode = 'intro';
    S.introT = 0;
  }
}

// ---- enemies ----

function spawnEnemy(area, sp) {
  const def = defFor(sp.kind, S.difficulty); // the run's difficulty is applied here and nowhere else
  const robot = makeRobot(sp.kind);
  robot.group.position.set(sp.x, 0, sp.z);
  robot.group.rotation.y = sp.yaw;
  if (R) R.scene.add(robot.group);
  S.enemies.push({
    kind: sp.kind, def, robot, x: sp.x, z: sp.z, yaw: sp.yaw, hp: def.hp, maxHp: def.hp, r: robot.radius, h: robot.height,
    headY: robot.headY, areaId: area.id, state: 'idle', stateT: 0, animT: rand(0, 5), cool: rand(0.3, 1),
    wakeDelay: -1, checkT: rand(0, 0.2), kx: 0, kz: 0, hurtT: 0, flashT: 0, deadT: 0, dead: false,
    strafe: Math.random() < 0.5 ? 1 : -1, acted: false, boss: !!def.boss, shieldT: 0, slamCool: 0, speedMult: 1, enraged: false,
  });
  initSpecial(S.enemies[S.enemies.length - 1]);
}

function wake(e, delay = 0) {
  if (e.state !== 'idle' || e.wakeDelay >= 0 || e.def.dormant) return; // a dormant Mimic is woken only by unfoldMimic()
  e.wakeDelay = delay;
}

function wakeArea(areaId, exceptE) {
  for (const o of S.enemies) if (o !== exceptE && o.areaId === areaId && o.state === 'idle') wake(o, rand(0.15, 0.7));
}

// A gunshot or a shout: idle robots close enough, with a way to reach Naebun, come looking.
function alertNear(x, z, range) {
  for (const e of S.enemies) {
    if (e.state !== 'idle' || e.wakeDelay >= 0) continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d < range && world.los(e.x, e.z, x, z)) {
      wake(e, rand(0.1, 0.4));
      wakeArea(e.areaId, e);
    }
  }
}

// How much of a hit a shielded robot lets through: 1 from the sides and behind, less from the front. `opts.pierce` is
// for explosions; `opts.dist` and `opts.shieldBreak` let a point-blank shotgun blast shove the shield aside.
function shieldFactor(e, fromX, fromZ, opts) {
  const sh = e.def.shield;
  if (!sh || opts.pierce) return 1;
  const tx = fromX - e.x;
  const tz = fromZ - e.z;
  const l = Math.hypot(tx, tz) || 1;
  const cos = (-Math.sin(e.yaw) * tx - Math.cos(e.yaw) * tz) / l;
  if (cos < Math.cos(sh.arc)) return 1;
  return opts.shieldBreak && opts.dist < opts.shieldBreak ? sh.closeMult : sh.mult;
}

function damageEnemy(e, amount, head, fromX, fromZ, knock, opts = {}) {
  if (e.dead) return;
  const through = shieldFactor(e, fromX, fromZ, opts);
  if (through < 1) {
    amount *= through;
    knock *= 0.25;
    if (e.shieldT <= 0) {
      e.shieldT = 0.12; // one clang per burst, not one per pellet
      audio.clang();
    }
    if (e.robot.shieldHit) e.robot.shieldHit();
  } else {
    e.flashT = 0.08;
    e.hurtT = HURT_DUR;
  }
  e.hp -= amount;
  if (e.def.enrage && !e.enraged && e.hp > 0 && e.hp <= e.maxHp * e.def.enrage.at) enrage(e);
  if (e.def.dormant && e.state === 'idle' && e.hp > 0) { // shot while disguised: it takes the hit like any robot, then unfolds, and stays put
    unfoldMimic(e);
    knock = 0;
  }
  if (e.state === 'idle') {
    wake(e, 0);
    wakeArea(e.areaId, e);
  }
  if (knock) {
    const dx = e.x - fromX;
    const dz = e.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    const k = knock * (e.boss ? 0.1 : 1);
    e.kx += (dx / d) * k;
    e.kz += (dz / d) * k;
  }
  S.hitMarker = 1;
  S.headshot = head;
  if (e.hp <= 0) killEnemy(e);
}

// The Tour Guide loses patience at half health: faster, bigger volleys.
function enrage(e) {
  e.enraged = true;
  e.speedMult = e.def.enrage.speed;
  if (e.robot.enrage) e.robot.enrage();
  S.banner = { title: e.def.name, sub: `"${e.def.enrage.line}"`, t: 3, max: 3 };
  audio.riser();
}

function killEnemy(e) {
  if (R) R.fx.wreck(e.x, e.h * 0.6, e.z);
  e.dead = true;
  e.state = 'dead';
  e.deadT = 0;
  S.kills++;
  S.score += e.def.score;
  audio.kill();
  if (e.boss) {
    S.boss = null;
    audio.boom();
    S.player.shake = Math.max(S.player.shake, 0.5);
  }
  if (e.def.ai) onSpecialKill(e);
}

function updateEnemy(e, dt) {
  const p = S.player;
  const def = e.def;
  e.animT += dt;
  if (e.robot.update) e.robot.update(dt);
  e.cool = Math.max(0, e.cool - dt);
  e.slamCool = Math.max(0, e.slamCool - dt);
  e.shieldT = Math.max(0, e.shieldT - dt);
  e.hurtT = Math.max(0, e.hurtT - dt);
  if (e.flashT > 0) {
    e.flashT -= dt;
    if (e.flashT <= 0) e.robot.flash(false);
    else e.robot.flash(true);
  }

  if (e.state === 'dead') {
    e.deadT += dt;
    e.robot.setPose('dead', e.deadT, clamp(e.deadT / 0.9, 0, 1));
    return;
  }
  if (e.stunT > 0 && ARS.stunStep(e, dt)) return; // stunned (the arsenal): it does nothing until it wears off

  // knockback
  if (Math.abs(e.kx) + Math.abs(e.kz) > 0.05) {
    const mv = world.moveCircle(e.x, e.z, e.kx * dt, e.kz * dt, e.r);
    e.x = mv.x;
    e.z = mv.z;
    const decay = Math.exp(-dt * 7);
    e.kx *= decay;
    e.kz *= decay;
  }

  if ((def.ai || e.state === 'rise') && updateSpecial(e, dt)) return; // the prepared enemies, and any robot getting back up

  const dx = p.x - e.x;
  const dz = p.z - e.z;
  const d = Math.hypot(dx, dz) || 1;
  const toPlayer = Math.atan2(-dx, -dz);

  if (e.state === 'idle') {
    e.robot.setPose('idle', e.animT, 0);
    if (e.wakeDelay >= 0) {
      e.wakeDelay -= dt;
      if (e.wakeDelay <= 0) {
        e.state = 'chase';
        e.stateT = 0;
        e.wakeDelay = -1;
        if (e.boss) {
          S.boss = e;
          S.banner = { title: def.name, sub: `"${def.quote}"`, t: 3, max: 3 };
          audio.riser();
        }
      }
      return;
    }
    e.checkT -= dt;
    if (e.checkT <= 0) {
      e.checkT = 0.15;
      if (d < def.wakeRange && world.los(e.x, e.z, p.x, p.z)) {
        wake(e, 0);
        wakeArea(e.areaId, e);
      }
    }
    return;
  }

  e.stateT += dt;
  let moving = false;
  let face = e.yaw;

  if (def.ranged) {
    const los = world.los(e.x, e.z, p.x, p.z);
    if (e.state === 'chase') {
      face = los ? toPlayer : e.yaw;
      let dirx = 0;
      let dirz = 0;
      if (!los || d > def.keepMax) {
        const f = (!los || d > 14) ? flow.dirAt(e.x, e.z) : null;
        if (f) { dirx = f.x; dirz = f.z; } else { dirx = dx / d; dirz = dz / d; }
        face = Math.atan2(-dirx, -dirz);
      } else if (d < def.keepMin) {
        dirx = -dx / d;
        dirz = -dz / d;
      } else {
        dirx = (-dz / d) * e.strafe;
        dirz = (dx / d) * e.strafe;
        if (Math.sin(S.t * 0.7 + e.animT) > 0.95) e.strafe = -e.strafe;
      }
      const sp = def.speed * e.speedMult * dt * ((d < def.keepMin || los) ? 0.8 : 1);
      if (dirx || dirz) {
        const mv = world.moveCircle(e.x, e.z, dirx * sp, dirz * sp, e.r);
        e.x = mv.x;
        e.z = mv.z;
        moving = true;
      }
      e.robot.setPose(moving ? 'walk' : 'idle', e.animT, 0);
      if (e.hurtT > 0) e.robot.setPose('hurt', HURT_DUR - e.hurtT, 1 - e.hurtT / HURT_DUR);
      if (def.slam && d < def.slam.reach && e.slamCool <= 0 && e.stateT > 0.3) {
        e.state = 'slam';
        e.stateT = 0;
        e.acted = false;
      } else if (los && d < def.range && e.cool <= 0 && e.stateT > 0.4) {
        e.state = 'aim';
        e.stateT = 0;
      }
    } else if (e.state === 'slam') {
      // the boss swings its pole at anyone who crowds it; dodge by stepping out of reach during the wind-up
      const sl = def.slam;
      face = toPlayer;
      e.robot.setPose('slam', e.stateT, clamp(e.stateT / (sl.windup + sl.swing), 0, 1));
      if (!e.acted && e.stateT >= sl.windup + sl.swing * 0.45) {
        e.acted = true;
        if (d < sl.reach + 0.7) hurtPlayer(sl.damage, e.x, e.z, true);
      }
      if (e.stateT >= sl.windup + sl.swing) {
        e.state = 'chase';
        e.stateT = 0;
        e.slamCool = sl.cooldown;
        e.cool = Math.max(e.cool, 0.6);
      }
    } else if (e.state === 'aim') {
      face = toPlayer;
      e.robot.setPose('aim', e.stateT, clamp(e.stateT / def.aim, 0, 1));
      if (e.stateT >= def.aim) {
        e.state = 'shoot';
        e.stateT = 0;
        e.acted = false;
      }
    } else if (e.state === 'shoot') {
      face = toPlayer;
      e.robot.setPose('shoot', e.stateT, clamp(e.stateT / def.shoot, 0, 1));
      if (!e.acted) {
        e.acted = true;
        const en = e.enraged ? def.enrage : def;
        const n = en.volley || 1;
        for (let i = 0; i < n; i++) fireBottle(e, (i - (n - 1) / 2) * (en.volleySpread || 0));
      }
      if (e.stateT >= def.shoot) {
        e.state = 'chase';
        e.stateT = 0;
        const iv = (e.enraged && def.enrage.shotInterval) || def.shotInterval;
        e.cool = rand(iv[0], iv[1]);
      }
    }
  } else {
    // melee robots: chase, wind up, swing, recover
    if (e.state === 'chase') {
      const los = world.los(e.x, e.z, p.x, p.z);
      let dirx = dx / d;
      let dirz = dz / d;
      if (!los || d > 10) {
        const f = flow.dirAt(e.x, e.z);
        if (f) { dirx = f.x; dirz = f.z; }
      }
      face = Math.atan2(-dirx, -dirz);
      if (d > def.reach * 0.8) {
        const mv = world.moveCircle(e.x, e.z, dirx * def.speed * e.speedMult * dt, dirz * def.speed * e.speedMult * dt, e.r);
        e.x = mv.x;
        e.z = mv.z;
        moving = true;
      }
      e.robot.setPose(moving ? 'walk' : 'idle', e.animT, 0);
      if (e.hurtT > 0) e.robot.setPose('hurt', HURT_DUR - e.hurtT, 1 - e.hurtT / HURT_DUR);
      if (d < def.reach && e.cool <= 0 && e.stateT > 0.2) {
        e.state = 'windup';
        e.stateT = 0;
      }
    } else if (e.state === 'windup') {
      face = toPlayer;
      e.robot.setPose('windup', e.stateT, clamp(e.stateT / def.windup, 0, 1));
      if (e.stateT >= def.windup) {
        e.state = 'swing';
        e.stateT = 0;
        e.acted = false;
      }
    } else if (e.state === 'swing') {
      e.robot.setPose('swing', e.stateT, clamp(e.stateT / def.swing, 0, 1));
      if (!e.acted && e.stateT >= def.swing * 0.45) {
        e.acted = true;
        // the player can dodge during the wind-up by stepping out of reach
        if (d < def.reach + 0.7) hurtPlayer(def.damage, e.x, e.z, true);
      }
      if (e.stateT >= def.swing) {
        e.state = 'chase';
        e.stateT = 0;
        e.cool = def.cooldown;
      }
    }
  }

  const turn = (def.turn || 7) * dt;
  e.yaw += clamp(wrap(face - e.yaw), -turn, turn);
}

function separateEnemies() {
  const en = S.enemies;
  for (let i = 0; i < en.length; i++) {
    const A = en[i];
    if (A.dead) continue;
    for (let j = i + 1; j < en.length; j++) {
      const B = en[j];
      if (B.dead) continue;
      const dx = B.x - A.x;
      const dz = B.z - A.z;
      const min = (A.r + B.r) * 0.9;
      const d2 = dx * dx + dz * dz;
      if (d2 <= 1e-6 || d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) * 0.5;
      const wa = A.fixed ? 0 : A.boss ? 0.2 : 1; // a dormant Mimic is a machine: nothing shoves it
      const wb = B.fixed ? 0 : B.boss ? 0.2 : 1;
      let mv = world.moveCircle(A.x, A.z, (-dx / d) * push * wa, (-dz / d) * push * wa, A.r);
      A.x = mv.x;
      A.z = mv.z;
      mv = world.moveCircle(B.x, B.z, (dx / d) * push * wb, (dz / d) * push * wb, B.r);
      B.x = mv.x;
      B.z = mv.z;
    }
  }
}

function fireBottle(e, off = 0) {
  const p = S.player;
  let dx = p.x - e.x;
  let dz = p.z - e.z;
  const d = Math.hypot(dx, dz) || 1;
  if (off) { // fan the volley out sideways around the line to Naebun
    const c = Math.cos(off);
    const sn = Math.sin(off);
    [dx, dz] = [dx * c - dz * sn, dx * sn + dz * c];
  }
  let sx = e.x + (dx / d) * 0.7;
  let sz = e.z + (dz / d) * 0.7;
  let sy = 1.3;
  if (R && e.robot.muzzle) {
    const v = new THREE.Vector3();
    e.robot.group.position.set(e.x, 0, e.z);
    e.robot.group.rotation.y = e.yaw;
    e.robot.group.updateMatrixWorld(true);
    e.robot.muzzle.getWorldPosition(v);
    sx = v.x;
    sy = v.y;
    sz = v.z;
  }
  const mesh = makeProjectile('bottle');
  mesh.position.set(sx, sy, sz);
  if (R) R.scene.add(mesh);
  const sp = e.def.projSpeed;
  const dy = (EYE - 0.2 - sy) / d;
  S.projectiles.push({
    owner: 'enemy', mesh, x: sx, y: sy, z: sz, vx: (dx / d) * sp, vy: dy * sp, vz: (dz / d) * sp,
    life: 4, damage: e.def.damage, spin: rand(0, TAU),
  });
  audio.spit();
}

// >>> PREPARED ENEMIES BEGIN (game logic for the four newer enemies, placed in levels 1 and 2: docs/placement.md)
// ---- The four newer enemies (docs/enemies-next.md): built and tested ahead of time, now placed in levels 1 and 2 ----
// Four kinds have an `ai` in their ENEMY_DEFS entry. updateEnemy() hands them to updateSpecial(), which returns true when it
// has done the whole update (movement, turning and pose) and false to leave the usual code to it (a sleeping robot, a
// Mimic that has finished unfolding). Models: src/models.js, between the PREPARED ENEMIES markers.

const pendingBursts = []; // Shakens killed by a blast, waiting for their own burst so a chain ripples instead of going off at once
let blastDelay = 0; // set while a blast is hurting robots: how long a Shaken killed by it waits before it bursts

function initSpecial(e) {
  const def = e.def;
  e.revives = 0;
  e.burstDone = false;
  e.fixed = false;
  if (!def.ai) return;
  Object.assign(e, {
    rattle: 0, rattleHz: 0, rattleT: 0, primeT: 0, fuse: 0, fuseMax: 0, lunge: 0, chained: false,
    locked: false, aimPitch: 0, loseT: 0, tracerT: 0, tracerLen: 0, reviveTarget: null, reviveT: 0, riseDur: 0.9,
  });
  if (def.ai === 'shaken' && e.robot.setBlast) e.robot.setBlast(def.burst.radius);
  if (def.ai === 'mimic') {
    e.h = def.dormant.h; // a drinks machine is shorter than the robot it turns into
    e.headY = def.dormant.headY;
    e.fixed = true;
    e.robot.setPose('dormant', 0, 0);
  }
}

function updateSpecial(e, dt) {
  if (e.state === 'rise') return updateRise(e, dt);
  switch (e.def.ai) {
    case 'shaken': return updateShaken(e, dt);
    case 'longshot': return updateLongshot(e, dt);
    case 'nurse': return updateNurse(e, dt);
    case 'mimic': return updateMimic(e, dt);
    default: return false;
  }
}

// Called when a robot with an `ai` dies, from killEnemy().
function onSpecialKill(e) {
  const def = e.def;
  if (def.ai === 'shaken' && !e.burstDone) {
    if (blastDelay > 0) {
      e.deadT = -blastDelay; // its pop starts when its burst does
      pendingBursts.push(e);
    } else burstShaken(e);
  }
  if (def.ai === 'longshot') e.robot.setLaser(0, 0);
  if (def.ai === 'nurse') e.robot.setBeam(null);
}

function updatePendingBursts() {
  for (let i = pendingBursts.length - 1; i >= 0; i--) {
    const e = pendingBursts[i];
    if (e.burstDone || !S.enemies.includes(e)) { pendingBursts.splice(i, 1); continue; }
    if (e.deadT >= 0) {
      pendingBursts.splice(i, 1);
      burstShaken(e);
    }
  }
}

// A body stays on the floor (visible) while a Nurse of its area is alive and could still revive it.
function corpseHeld(e) {
  return !e.boss && !e.def.noRevive && !e.burstDone && e.revives < 1 && e.deadT < 14
    && S.enemies.some((n) => !n.dead && n.def.ai === 'nurse' && n.areaId === e.areaId);
}

// ---- Fizzbang Shaken ----

const rattleLevel = (def, d) => clamp(1 - (d - def.rattle.near) / (def.rattle.far - def.rattle.near), 0, 1);

function tickRattle(e, lv, dt) {
  const r = e.def.rattle;
  e.rattle = lv;
  e.rattleHz = r.min + (r.max - r.min) * lv;
  e.rattleT += dt * e.rattleHz;
  if (e.rattleT >= 1) {
    e.rattleT -= Math.floor(e.rattleT);
    if (Math.hypot(e.x - S.player.x, e.z - S.player.z) < 22) audio.rattle(lv);
  }
}

function primeShaken(e, yaw, fuse) {
  e.state = 'prime';
  e.stateT = 0;
  e.primeT = 0;
  e.fuse = e.fuseMax = fuse;
  e.lunge = yaw;
  audio.hiss();
}

function updateShaken(e, dt) {
  if (e.state !== 'chase' && e.state !== 'prime') return false; // asleep: the usual idle code
  const p = S.player;
  const def = e.def;
  e.stateT += dt;
  const dx = p.x - e.x;
  const dz = p.z - e.z;
  const d = Math.hypot(dx, dz) || 1;
  const toPlayer = Math.atan2(-dx, -dz);
  const touch = e.r + PLAYER_R + 0.1;
  if (e.state === 'chase') {
    const los = world.los(e.x, e.z, p.x, p.z);
    let dirx = dx / d;
    let dirz = dz / d;
    if (!los || d > 10) {
      const f = flow.dirAt(e.x, e.z);
      if (f) { dirx = f.x; dirz = f.z; }
    }
    const sp = def.speed * e.speedMult * dt;
    const mv = world.moveCircle(e.x, e.z, dirx * sp, dirz * sp, e.r);
    e.x = mv.x;
    e.z = mv.z;
    e.yaw += clamp(wrap(Math.atan2(-dirx, -dirz) - e.yaw), -7 * dt, 7 * dt);
    tickRattle(e, rattleLevel(def, d), dt);
    if (e.hurtT > 0) e.robot.setPose('hurt', HURT_DUR - e.hurtT, e.rattle);
    else e.robot.setPose('walk', e.animT, e.rattle);
    if ((los && d <= def.prime.range) || d <= touch) primeShaken(e, toPlayer, def.prime.fuse);
  } else {
    e.primeT += dt;
    e.fuse -= dt;
    if (!e.chained) { // a lunge that steers slowly, so a sidestep can still beat it
      e.lunge += clamp(wrap(toPlayer - e.lunge), -def.prime.steer * dt, def.prime.steer * dt);
      const sp = def.prime.speed * dt;
      const mv = world.moveCircle(e.x, e.z, -Math.sin(e.lunge) * sp, -Math.cos(e.lunge) * sp, e.r);
      e.x = mv.x;
      e.z = mv.z;
      e.yaw = e.lunge;
    }
    tickRattle(e, 1, dt);
    e.robot.setPose('prime', e.animT, clamp(1 - e.fuse / e.fuseMax, 0, 1));
    if (e.fuse <= 0 || (!e.chained && e.primeT >= 0.3 && d <= touch)) burstShaken(e);
  }
  return true;
}

// A Shaken that has been caught in someone else's blast goes off after a short fuse, wherever it is standing.
function chainPrime(o, delay) {
  if (o.dead || o.burstDone) return;
  if (o.state === 'prime') {
    o.fuse = Math.min(o.fuse, delay);
    return;
  }
  o.state = 'prime';
  o.stateT = 0;
  o.primeT = 0;
  o.fuse = o.fuseMax = delay;
  o.chained = true;
  o.lunge = o.yaw;
}

function burstShaken(e) {
  if (e.burstDone) return;
  e.burstDone = true;
  const b = e.def.burst;
  const p = S.player;
  audio.fizz();
  p.shake = Math.max(p.shake, 0.35);
  if (R) {
    R.fx.foam(e.x, 0.9, e.z, b.radius);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd6ec, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.position.set(e.x, 0.9, e.z);
    R.scene.add(mesh);
    R.explosions.push({ mesh, t: 0, radius: b.radius });
  }
  const dp = Math.hypot(p.x - e.x, p.z - e.z);
  if (dp < b.radius) hurtPlayer(Math.round(b.player * (1 - (1 - b.floor) * clamp(dp / b.radius, 0, 1))), e.x, e.z, false);
  for (const o of S.enemies) {
    if (o === e || o.dead) continue;
    const d = Math.hypot(o.x - e.x, o.z - e.z);
    if (d > b.radius) continue;
    const fall = 1 - (1 - b.floor) * clamp(d / b.radius, 0, 1);
    const shaken = o.def.ai === 'shaken';
    const delay = b.chain * (0.5 + d / b.radius);
    blastDelay = shaken ? delay : 0;
    damageEnemy(o, b.robots * fall, false, e.x, e.z, b.knock, { pierce: true });
    blastDelay = 0;
    if (shaken) chainPrime(o, delay);
  }
  if (!e.dead) {
    e.hp = 0;
    killEnemy(e);
  }
  alertNear(e.x, e.z, 22);
}

// ---- Bampot Longshot ----

function updateLongshot(e, dt) {
  if (e.state !== 'chase' && e.state !== 'charge' && e.state !== 'recover') return false;
  const p = S.player;
  const def = e.def;
  const C = def.charge;
  e.stateT += dt;
  const dx = p.x - e.x;
  const dz = p.z - e.z;
  const d = Math.hypot(dx, dz) || 1;
  const toPlayer = Math.atan2(-dx, -dz);
  const los = world.los(e.x, e.z, p.x, p.z);
  const pv = e.robot.pivot || { up: 1.5, fwd: 0.3 };

  if (e.state === 'chase') {
    let face = los ? toPlayer : e.yaw;
    let dirx = 0;
    let dirz = 0;
    if (!los || d > def.keepMax) {
      const f = (!los || d > 14) ? flow.dirAt(e.x, e.z) : null;
      if (f) { dirx = f.x; dirz = f.z; } else { dirx = dx / d; dirz = dz / d; }
      face = Math.atan2(-dirx, -dirz);
    } else if (d < def.keepMin) {
      dirx = -dx / d;
      dirz = -dz / d;
    } else {
      dirx = (-dz / d) * e.strafe;
      dirz = (dx / d) * e.strafe;
      if (Math.sin(S.t * 0.5 + e.animT) > 0.97) e.strafe = -e.strafe;
    }
    let moving = false;
    if (dirx || dirz) {
      const sp = def.speed * e.speedMult * dt * (los ? 0.7 : 1);
      const mv = world.moveCircle(e.x, e.z, dirx * sp, dirz * sp, e.r);
      e.x = mv.x;
      e.z = mv.z;
      moving = true;
    }
    e.yaw += clamp(wrap(face - e.yaw), -7 * dt, 7 * dt);
    e.robot.setLaser(0, 0);
    if (e.hurtT > 0) e.robot.setPose('hurt', HURT_DUR - e.hurtT, 0);
    else e.robot.setPose(moving ? 'walk' : 'idle', e.animT, 0);
    if (los && d < def.range && d > 4 && e.cool <= 0 && e.stateT > 0.5) {
      e.state = 'charge';
      e.stateT = 0;
      e.locked = false;
      e.loseT = 0;
      audio.snipeCharge(C.track + C.lock);
    }
    return true;
  }

  if (e.state === 'charge') {
    const total = C.track + C.lock;
    if (e.stateT < C.track) {
      // tracking: the line follows Naebun, but only as fast as it can swing
      if (los) e.loseT = 0;
      else if ((e.loseT += dt) > C.lose) {
        e.state = 'chase';
        e.stateT = 0;
        e.cool = 1;
        e.robot.setLaser(0, 0);
        return true;
      }
      e.yaw += clamp(wrap(toPlayer - e.yaw), -C.turn * dt, C.turn * dt);
      e.aimPitch = Math.atan2(def.shot.aimY - pv.up, Math.max(1, d - pv.fwd));
    } else if (!e.locked) {
      e.locked = true;
      audio.lock();
      if (def.shot.warn) S.damageDirs.push({ bearing: wrap(p.yaw - toPlayer + Math.PI), t: 1 });
    }
    const hx = -Math.sin(e.yaw);
    const hz = -Math.cos(e.yaw);
    const ox = e.x + hx * pv.fwd;
    const oz = e.z + hz * pv.fwd;
    const wall = world.raycast(ox, oz, hx, hz, def.range);
    const cp = Math.max(0.3, Math.cos(e.aimPitch));
    // the line runs to the first wall; if it is on Naebun it stops short of him (it has hit something), which also keeps
    // a glaring beam from running through the camera
    const along = (p.x - ox) * hx + (p.z - oz) * hz;
    const lateral = Math.abs((p.x - ox) * hz - (p.z - oz) * hx);
    let reach = Math.min(def.range, wall) / cp;
    if (along > 0 && along < wall && lateral < def.shot.halfWidth + 0.2) reach = Math.min(reach, (along - 1.2) / cp);
    const len = Math.max(0.5, reach - 0.96); // the beam starts at the muzzle, 0.96 m along the barrel
    const k = clamp(e.stateT / total, 0, 1);
    e.robot.setLaser(len, e.aimPitch, e.locked, k, laserNear(e, pv, len));
    e.robot.setPose('aim', e.stateT, k);
    if (e.stateT >= total) {
      fireSnipe(e, pv, wall, cp);
      e.state = 'recover';
      e.stateT = 0;
      e.tracerT = 0.14;
      e.tracerLen = len;
    }
    return true;
  }

  // recover: the shot has gone; the tracer lingers a moment
  e.tracerT -= dt;
  if (e.tracerT > 0) e.robot.setLaser(e.tracerLen, e.aimPitch, true, 1, laserNear(e, pv, e.tracerLen));
  else e.robot.setLaser(0, e.aimPitch);
  e.robot.setPose('shoot', e.stateT, clamp(e.stateT / def.shot.recover, 0, 1));
  if (e.stateT >= def.shot.recover) {
    e.state = 'chase';
    e.stateT = 0;
    e.cool = rand(def.cooldown[0], def.cooldown[1]);
    e.robot.setLaser(0, 0);
  }
  return true;
}

// The shot: a straight line from the rifle's pivot along the locked yaw and pitch. It hurts Naebun if Naebun is within the
// line's half-width and the line is not stopped by a wall or pillar first. Low cover does not stop it.
// How clear the camera is of a Longshot's laser, 0 (on top of it) to 1 (5 m or more away). models.js thins and dims the line by
// it, so a line aimed at the player does not flood the screen. Only the drawing changes: the line itself is the shot line.
function laserNear(e, pv, len) {
  const p = S.player;
  const cp = Math.cos(e.aimPitch);
  const dx = -Math.sin(e.yaw) * cp;
  const dy = Math.sin(e.aimPitch);
  const dz = -Math.cos(e.yaw) * cp;
  const sx = e.x - Math.sin(e.yaw) * (pv.fwd + 0.96 * cp);
  const sy = pv.up + dy * 0.96;
  const sz = e.z - Math.cos(e.yaw) * (pv.fwd + 0.96 * cp);
  const t = clamp((p.x - sx) * dx + (EYE - sy) * dy + (p.z - sz) * dz, 0, len); // the closest point on the line to the camera
  const d = Math.hypot(sx + dx * t - p.x, sy + dy * t - EYE, sz + dz * t - p.z);
  const n = clamp((d - 1.2) / 3.8, 0, 1);
  return n * n * (3 - 2 * n);
}

function fireSnipe(e, pv, wall, cp) {
  const p = S.player;
  const def = e.def;
  const hx = -Math.sin(e.yaw);
  const hz = -Math.cos(e.yaw);
  const ox = e.x + hx * pv.fwd;
  const oz = e.z + hz * pv.fwd;
  const rx = p.x - ox;
  const rz = p.z - oz;
  const along = rx * hx + rz * hz;
  const lateral = Math.abs(rx * hz - rz * hx);
  const y = pv.up + Math.tan(e.aimPitch) * along;
  audio.snipe();
  if (along > 0 && along < wall - 0.05 && lateral < def.shot.halfWidth && y > 0.05 && y < EYE + 0.25) {
    hurtPlayer(def.damage, e.x, e.z, false);
  }
  if (R) {
    const t = Math.min(wall, def.range);
    const iy = clamp(pv.up + Math.tan(e.aimPitch) * t, 0.05, WALL_H - 0.05);
    R.fx.sparks(ox + hx * t, iy, oz + hz * t, -hx, 0.2, -hz, 10);
    R.fx.muzzle(ox + hx * 0.9, pv.up, oz + hz * 0.9, hx, 0, hz);
  }
}

// ---- Bampot Nurse ----

// Can this Nurse revive that robot now? `slack` widens the range a little, so a channel does not snap over a step.
function reviveCandidate(n, c, slack = 1) {
  const R_ = n.def.revive;
  if (!c.dead || c.boss || c.def.noRevive || c.burstDone || c.revives >= 1 || c.areaId !== n.areaId) return false;
  if (c.deadT < 0 || c.deadT > R_.window) return false;
  const a = S.areas.find((x) => x.def.id === c.areaId);
  if (a && a.cleared) return false; // never into an area that has already been cleared: its door is open for good
  return Math.hypot(c.x - n.x, c.z - n.z) <= R_.range * slack && world.los(n.x, n.z, c.x, c.z);
}

function endChannel(n, cool = 0.6) {
  n.state = 'chase';
  n.stateT = 0;
  n.reviveTarget = null;
  n.cool = cool;
  n.robot.setBeam(null);
}

function updateNurse(e, dt) {
  if (e.state !== 'chase' && e.state !== 'revive') return false;
  const p = S.player;
  const def = e.def;
  const R_ = def.revive;
  e.stateT += dt;

  if (e.state === 'revive') {
    const c = e.reviveTarget;
    if (!c || !reviveCandidate(e, c, 1.3)) {
      endChannel(e);
      return true;
    }
    const tx = c.x - e.x;
    const tz = c.z - e.z;
    e.yaw += clamp(wrap(Math.atan2(-tx, -tz) - e.yaw), -7 * dt, 7 * dt);
    const k = clamp(e.stateT / R_.time, 0, 1);
    if (e.hurtT > 0) e.robot.setPose('hurt', HURT_DUR - e.hurtT, 0);
    else e.robot.setPose('revive', e.stateT, k);
    // the beam's end in the Nurse's own space (the group is kept in step with the logic so the two agree)
    e.robot.group.position.set(e.x, 0, e.z);
    e.robot.group.rotation.y = e.yaw;
    const cs = Math.cos(e.yaw);
    const sn = Math.sin(e.yaw);
    e.robot.setBeam(tx * cs - tz * sn, 0.3, tx * sn + tz * cs, k);
    if (e.stateT >= R_.time) {
      reviveEnemy(c, e);
      endChannel(e, 1.2);
    }
    return true;
  }

  // chase: look for a body to revive, else keep out of Naebun's way
  e.checkT -= dt;
  if (e.checkT <= 0) {
    e.checkT = 0.2;
    let best = null;
    let bd = Infinity;
    for (const c of S.enemies) {
      if (!reviveCandidate(e, c)) continue;
      const d = Math.hypot(c.x - e.x, c.z - e.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (best && e.cool <= 0) {
      e.state = 'revive';
      e.stateT = 0;
      e.reviveTarget = best;
      audio.reviveStart(R_.time);
      return true;
    }
  }
  const dx = e.x - p.x;
  const dz = e.z - p.z;
  const d = Math.hypot(dx, dz) || 1;
  let moving = false;
  let face = e.yaw;
  if (d < def.flee.from) {
    // away from Naebun, round whatever is in the way: try the straight-away heading, then either side
    const sp = def.speed * e.speedMult * dt;
    let bestMv = null;
    let bestScore = -1;
    for (const a of [0, 0.7 * e.strafe, -0.7 * e.strafe, 1.4 * e.strafe, -1.4 * e.strafe]) {
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      const dirx = (dx / d) * cs - (dz / d) * sn;
      const dirz = (dx / d) * sn + (dz / d) * cs;
      const mv = world.moveCircle(e.x, e.z, dirx * sp, dirz * sp, e.r);
      const gain = (mv.x - e.x) * dirx + (mv.z - e.z) * dirz;
      if (gain > bestScore) { bestScore = gain; bestMv = { mv, dirx, dirz }; }
      if (gain > sp * 0.85) break;
    }
    if (bestMv && bestScore > 1e-5) {
      e.x = bestMv.mv.x;
      e.z = bestMv.mv.z;
      face = Math.atan2(-bestMv.dirx, -bestMv.dirz);
      moving = true;
    } else e.strafe = -e.strafe; // cornered: try the other way next time
  } else face = Math.atan2(-(p.x - e.x), -(p.z - e.z)); // far enough: just watch
  e.yaw += clamp(wrap(face - e.yaw), -7 * dt, 7 * dt);
  e.robot.setBeam(null);
  if (e.hurtT > 0) e.robot.setPose('hurt', HURT_DUR - e.hurtT, 0);
  else e.robot.setPose(moving ? 'walk' : 'idle', e.animT, 0);
  return true;
}

// The body gets up. The kill is taken back (kills and score stay true), the robot rises over `rise` seconds and then
// carries on as if freshly woken. Its area counts it again from this moment; a cleared area never reaches here.
function reviveEnemy(c, nurse) {
  const R_ = nurse.def.revive;
  c.dead = false;
  c.state = 'rise';
  c.stateT = 0;
  c.deadT = 0;
  c.hp = c.maxHp * R_.hp;
  c.revives++;
  c.kx = c.kz = 0;
  c.hurtT = 0;
  c.flashT = 0;
  c.cool = 1;
  c.riseDur = R_.rise;
  c.wakeDelay = -1;
  if (c.def.ai === 'mimic') {
    c.h = c.robot.height;
    c.headY = c.robot.headY;
    c.fixed = false;
  }
  c.robot.flash(false);
  c.robot.group.visible = true;
  S.kills = Math.max(0, S.kills - 1);
  S.score = Math.max(0, S.score - c.def.score);
  audio.reviveDone();
  if (R) R.fx.sparks(c.x, 0.4, c.z, 0, 1, 0, 14);
}

function updateRise(e, dt) {
  e.stateT += dt;
  const k = clamp(e.stateT / e.riseDur, 0, 1);
  e.robot.setPose('dead', (1 - k) * 0.9, 1 - k); // the fall, played backwards
  if (k >= 1) {
    e.state = 'chase';
    e.stateT = 0;
    e.cool = Math.max(e.cool, 0.8);
  }
  return true;
}

// ---- Vending Mimic ----

function unfoldMimic(e) {
  if (e.state !== 'idle') return;
  e.state = 'unfold';
  e.stateT = 0;
  e.fixed = false;
  e.h = e.robot.height;
  e.headY = e.robot.headY;
  audio.unfold();
}

function updateMimic(e, dt) {
  const p = S.player;
  const D = e.def.dormant;
  if (e.state === 'idle') {
    // a drinks machine: noise and other robots waking do not touch it (wake() ignores it); only Naebun's nearness or a shot
    e.robot.setPose('dormant', e.animT, 0);
    e.checkT -= dt;
    if (e.checkT <= 0) {
      e.checkT = 0.1;
      if (Math.hypot(p.x - e.x, p.z - e.z) < D.wake && world.los(e.x, e.z, p.x, p.z)) unfoldMimic(e);
    }
    return true;
  }
  if (e.state === 'unfold') {
    e.stateT += dt;
    e.yaw += clamp(wrap(Math.atan2(-(p.x - e.x), -(p.z - e.z)) - e.yaw), -3 * dt, 3 * dt);
    e.robot.setPose('unfold', e.stateT, clamp(e.stateT / D.unfold, 0, 1));
    if (e.stateT >= D.unfold) {
      e.state = 'chase';
      e.stateT = 0;
      e.cool = 0.5;
    }
    return true;
  }
  return false; // awake: an ordinary melee robot
}
// <<< PREPARED ENEMIES END

// ---- player ----

function hurtPlayer(amount, srcX, srcZ, melee) {
  const p = S.player;
  if (S.mode !== 'play' || p.health <= 0) return;
  if (S.laser) return; // the spin makes Naebun untouchable
  if (buffOn('guard')) amount = Math.max(1, Math.round(amount * DRINKS.heavy.mult));
  p.health -= amount;
  p.hurt = 1;
  p.shake = Math.max(p.shake, 0.3);
  const vx = srcX - p.x;
  const vz = srcZ - p.z;
  S.damageDirs.push({ bearing: wrap(p.yaw - Math.atan2(-vx, -vz)), t: 1 });
  if (melee) audio.melee();
  else audio.hurt();
  if (p.health <= 0) {
    p.health = 0;
    die();
  }
}

function die() {
  S.mode = 'dead';
  S.deadT = 0;
  S.deadLine = DEATH_LINES[Math.floor(Math.random() * DEATH_LINES.length)];
  S.newBest = false;
  if (!S.debugMode && S.score > S.best) {
    S.best = S.score;
    S.newBest = true;
    store.setBest(S.save, S.difficulty, S.level, S.best);
    store.save(S.save);
  }
  audio.gameOver();
}

function completeLevel() {
  S.mode = 'complete';
  S.completeT = 0;
  S.newBest = false;
  S.score += Math.max(0, Math.round((300 - S.runT) * 10));
  if (!S.debugMode) { // a debug run neither records a score nor counts as progress
    if (!S.save.done.includes(S.level)) S.save.done.push(S.level);
    S.save.unlocked = Math.max(S.save.unlocked, Math.min(store.MAX_LEVELS, S.level + 1));
    store.save(S.save);
  }
  if (!S.debugMode && S.score > S.best) {
    S.best = S.score;
    S.newBest = true;
    store.setBest(S.save, S.difficulty, S.level, S.best);
    store.save(S.save);
  }
  audio.dawn();
}

// ---- input ----

function stickFrom(t, box, dead) {
  const hw = box.w / 2;
  const hh = box.h / 2;
  let nx = clamp((t.x - (box.x + hw)) / (hw * 0.85), -1, 1);
  let ny = clamp((t.y - (box.y + hh)) / (hh * 0.85), -1, 1);
  const m = Math.hypot(nx, ny);
  if (m > 1) { nx /= m; ny /= m; }
  if (dead && m < dead) return { nx: 0, ny: 0, rx: nx, ry: ny };
  return { nx, ny, rx: nx, ry: ny };
}

// Reads the touches: assigns each to the move box, the look box, a button or free aim on first contact, then
// returns { mx, mz (move, -1..1), yawD, pitchD, firing, reload, swap }. Buttons are read from tap events.
function readControls(input, view, dt) {
  const L = layoutFor(view);
  const out = { mx: 0, mz: 0, yawD: 0, pitchD: 0, firing: false, reload: false, swap: false, torch: false, alt: false };
  const altOn = inputMode() === 'mobile' && ARS.altAvailable(); // the ALT button exists only once the SMG has its pedal
  let moveTaken = false;
  let lookTaken = false;
  for (const t of input.touches.values()) {
    if (t.role === 'move') moveTaken = true;
    else if (t.role === 'look') lookTaken = true;
  }
  // Buttons react to the press event itself, not to a live touch, so a quick tap is never lost between frames.
  for (const press of input.pressed) {
    if (inRect(press.x, press.y, L.reloadHit)) out.reload = true;
    else if (inRect(press.x, press.y, L.swapHit)) out.swap = true;
    else if (altOn && inRect(press.x, press.y, L.altHit)) out.alt = true;
  }
  for (const t of input.touches.values()) {
    if (t.role) continue;
    if (inRect(t.sx, t.sy, L.reloadHit) || inRect(t.sx, t.sy, L.swapHit) || (altOn && inRect(t.sx, t.sy, L.altHit))) t.role = 'btn';
    else if (!moveTaken && inRect(t.sx, t.sy, L.moveHit)) { t.role = 'move'; moveTaken = true; }
    else if (!lookTaken && inRect(t.sx, t.sy, L.lookHit)) { t.role = 'look'; lookTaken = true; }
    else if (inRect(t.sx, t.sy, L.moveHit) || inRect(t.sx, t.sy, L.lookHit)) t.role = 'none'; // a box already in use
    else t.role = 'free'; // anywhere else on the screen: aim only, no fire
    t.lx = t.sx;
    t.ly = t.sy;
  }

  const ui = S.ui;
  ui.move.active = false;
  ui.look.active = false;
  for (const t of input.touches.values()) {
    if (t.role === 'move') {
      const s = stickFrom(t, L.moveBox, 0.14);
      ui.move.active = true;
      ui.move.nx = s.rx;
      ui.move.ny = s.ry;
      out.mx = s.nx;
      out.mz = -s.ny;
    } else if (t.role === 'look') {
      const hw = L.lookBox.w / 2;
      const hh = L.lookBox.h / 2;
      const nx = clamp((t.x - (L.lookBox.x + hw)) / hw, -1, 1);
      const ny = clamp((t.y - (L.lookBox.y + hh)) / hh, -1, 1);
      ui.look.active = true;
      ui.look.nx = nx;
      ui.look.ny = ny;
      out.yawD -= (t.x - t.lx) * PLAYER.lookX;
      out.pitchD -= (t.y - t.ly) * PLAYER.lookY;
      if (Math.abs(nx) > 0.65) out.yawD -= Math.sign(nx) * ((Math.abs(nx) - 0.65) / 0.35) * PLAYER.edgeTurn * dt;
      t.lx = t.x;
      t.ly = t.y;
      out.firing = true;
    } else if (t.role === 'free') {
      out.yawD -= (t.x - t.lx) * PLAYER.lookX;
      out.pitchD -= (t.y - t.ly) * PLAYER.lookY;
      t.lx = t.x;
      t.ly = t.y;
    }
  }

  // keyboard, for testing on a desktop
  const k = input.keys;
  if (!ui.move.active) {
    const kx = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    const kz = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0);
    const len = Math.hypot(kx, kz);
    if (len) { out.mx = kx / len; out.mz = kz / len; }
  }
  // mouse look: moving the mouse aims, the left button fires, the wheel swaps weapons
  const mouse = S.mouseTest || input.mouse;
  if (wantsMouseLock() && mouse && (mouse === S.mouseTest || mouse.locked)) {
    const sens = PLAYER.mouse * MOUSE_SENS[S.settings.sens].k;
    out.yawD -= mouse.dx * sens;
    out.pitchD -= mouse.dy * sens;
    if (mouse.down) out.firing = true;
    if (mouse.wheel) out.swap = true;
    if (mouse.alt) out.alt = true; // the right button: the SMG's alt-fire
  }
  if (S.mouseTest) S.mouseTest = { ...S.mouseTest, dx: 0, dy: 0, wheel: 0, alt: false };
  const ky = (k.has('arrowleft') ? 1 : 0) - (k.has('arrowright') ? 1 : 0);
  const kp = (k.has('arrowup') ? 1 : 0) - (k.has('arrowdown') ? 1 : 0);
  out.yawD += ky * 2.2 * dt;
  out.pitchD += kp * 1.6 * dt;
  if (k.has(' ')) out.firing = true;
  if (k.has('r') && !S.keyR) out.reload = true;
  if (k.has('q') && !S.keyQ) out.swap = true;
  if (k.has('e') && !S.keyE) out.alt = true;
  S.keyE = k.has('e');
  if (k.has('f') && !S.keyF) out.torch = true;
  S.keyF = k.has('f');
  S.keyR = k.has('r');
  S.keyQ = k.has('q');
  ui.firing = out.firing;
  return out;
}

// ---- weapons ----

function startReload() {
  const p = S.player;
  const w = WEAPONS[p.weapon];
  if (p.reloadT > 0 || p.ammo[p.weapon] >= ARS.clipOf(w)) return;
  p.reloadTotal = w.reload * (buffOn('rapid') ? DRINKS.energy.reload : 1) * ARS.reloadMult();
  p.reloadT = p.reloadTotal;
  audio.reload(false);
}

function cycleWeapon() {
  const p = S.player;
  const owned = WEAPON_ORDER.filter((id) => p.owned[id]);
  if (owned.length < 2) return;
  selectWeapon(owned[(owned.indexOf(p.weapon) + 1) % owned.length]);
}

function selectWeapon(id) {
  const p = S.player;
  if (id === p.weapon) return;
  p.weapon = id;
  p.reloadT = 0;
  p.switchT = 0.25;
  p.heat = 0;
  audio.reload(true);
}

function forward3(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

// Nearest thing a ray hits: a wall, the floor or ceiling, or an enemy (cylinder test). d must be a unit vector.
function castRay(ox, oy, oz, d, maxDist, skipEnemies) {
  let tMax = maxDist;
  const hl = Math.hypot(d.x, d.z);
  if (hl > 1e-6) tMax = Math.min(tMax, world.raycast(ox, oz, d.x / hl, d.z / hl, maxDist * hl) / hl);
  if (d.y < -1e-6) tMax = Math.min(tMax, -oy / d.y);
  else if (d.y > 1e-6) tMax = Math.min(tMax, (WALL_H - oy) / d.y);
  let hit = null;
  let hitY = 0;
  if (!skipEnemies) {
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-9) {
      for (const e of S.enemies) {
        if (e.dead) continue;
        const fx = ox - e.x;
        const fz = oz - e.z;
        const b = 2 * (fx * d.x + fz * d.z);
        const c = fx * fx + fz * fz - e.r * e.r;
        const disc = b * b - 4 * a * c;
        if (disc < 0) continue;
        const s = Math.sqrt(disc);
        let t0 = (-b - s) / (2 * a);
        if (t0 < 0) t0 = (-b + s) / (2 * a);
        if (t0 < 0 || t0 >= tMax) continue;
        const y = oy + d.y * t0;
        if (y < 0 || y > e.h) continue;
        hit = e;
        hitY = y;
        tMax = t0;
      }
    }
  }
  return { t: tMax, enemy: hit, head: !!hit && hitY > hit.headY, x: ox + d.x * tMax, y: oy + d.y * tMax, z: oz + d.z * tMax };
}

function fire() {
  const p = S.player;
  const w = WEAPONS[p.weapon];
  if (ARS.handles(w)) { ARS.fire(w); return; } // the grenade and the airhorn
  const m = mult();
  p.ammo[p.weapon]--;
  p.fireT = w.interval / m.fire / (buffOn('rapid') ? DRINKS.energy.mult : 1);
  p.kick = Math.min(1, p.kick + w.kick * 8);
  S.shots++;
  audio.shoot(w.id);
  alertNear(p.x, p.z, w.noise);
  if (R) {
    R.muzzleT = 0.06;
    R.flashT = 0.05;
    const f0 = forward3(p.yaw, p.pitch);
    R.fx.muzzle(p.x + f0.x * 0.9 + Math.cos(p.yaw) * 0.18, EYE - 0.15 + f0.y * 0.9, p.z + f0.z * 0.9 - Math.sin(p.yaw) * 0.18, f0.x, f0.y, f0.z);
  }

  if (w.kind === 'projectile') {
    launchRocket(w);
    return;
  }
  const f = forward3(p.yaw, p.pitch);
  const right = { x: Math.cos(p.yaw), y: 0, z: -Math.sin(p.yaw) };
  const up = {
    x: right.y * f.z - right.z * f.y, y: right.z * f.x - right.x * f.z, z: right.x * f.y - right.y * f.x,
  };
  const spread = w.spread + (w.spreadGrow ? Math.min(w.spreadMax - w.spread, p.heat * w.spreadGrow) : 0);
  p.heat += 1;
  for (let i = 0; i < w.pellets; i++) {
    const ang = rand(0, TAU);
    const r = spread * Math.sqrt(Math.random());
    const ca = Math.cos(ang) * r;
    const sa = Math.sin(ang) * r;
    const dx = f.x + right.x * ca + up.x * sa;
    const dy = f.y + right.y * ca + up.y * sa;
    const dz = f.z + right.z * ca + up.z * sa;
    const len = Math.hypot(dx, dy, dz);
    const d = { x: dx / len, y: dy / len, z: dz / len };
    const hit = castRay(p.x, EYE, p.z, d, w.range, false);
    if (hit.enemy) {
      const head = hit.head;
      damageEnemy(hit.enemy, w.damage * m.damage * (head ? 2 : 1), head, p.x, p.z, w.knock / w.pellets * (w.pellets > 1 ? 2 : 1), { dist: hit.t, shieldBreak: w.shieldBreak });
      spark(hit.x, hit.y, hit.z);
      fxHit(hit, d, true, w.pellets);
    } else if (hit.t < w.range - 0.01) {
      spark(hit.x - d.x * 0.05, hit.y - d.y * 0.05, hit.z - d.z * 0.05);
      fxHit(hit, d, false, w.pellets);
    }
  }
}

function launchRocket(w) {
  const p = S.player;
  const f = forward3(p.yaw, p.pitch);
  const mesh = makeProjectile(w.bounces !== undefined ? 'disc' : 'rocket');
  const sx = p.x + f.x * 0.7 + Math.cos(p.yaw) * 0.25;
  const sy = EYE - 0.2 + f.y * 0.7;
  const sz = p.z + f.z * 0.7 - Math.sin(p.yaw) * 0.25;
  mesh.position.set(sx, sy, sz);
  mesh.rotation.order = 'YXZ';
  mesh.rotation.set(p.pitch, p.yaw, 0);
  if (R) R.scene.add(mesh);
  S.projectiles.push({
    owner: 'player', mesh, x: sx, y: sy, z: sz, vx: f.x * w.speed, vy: f.y * w.speed, vz: f.z * w.speed,
    life: w.life || 4, weapon: w, dir: f, bounces: w.bounces,
  });
}

// Which way a wall faces where a disc struck it, worked out by probing the tiles just ahead on each axis.
function bounceOff(pr, hx, hz) {
  const sx = Math.sign(pr.vx) * 0.12;
  const sz = Math.sign(pr.vz) * 0.12;
  const bx = world.blocksShotAt(hx + sx, hz);
  const bz = world.blocksShotAt(hx, hz + sz);
  if (bx && !bz) pr.vx = -pr.vx;
  else if (bz && !bx) pr.vz = -pr.vz;
  else { pr.vx = -pr.vx; pr.vz = -pr.vz; }
}

// One step of a vinyl disc: it damages the first robot it reaches (and stops), and rebounds off walls, floor and ceiling.
function stepDisc(pr, d, step) {
  const m = mult();
  const hit = castRay(pr.x, pr.y, pr.z, d, step + 0.2, false);
  if (hit.t >= step + 0.2) return false; // clear air this frame
  if (hit.enemy) {
    const w = pr.weapon;
    damageEnemy(hit.enemy, w.damage * m.damage * (hit.head ? 2 : 1), hit.head, pr.x, pr.z, w.knock, {});
    spark(hit.x, hit.y, hit.z);
    fxHit(hit, d, true, 1);
    pr.life = -1;
    return true;
  }
  if (hit.t > step + 0.1) return false;
  if (pr.bounces <= 0) {
    spark(hit.x - d.x * 0.05, hit.y - d.y * 0.05, hit.z - d.z * 0.05);
    pr.life = -1;
    return true;
  }
  pr.bounces--;
  if (hit.y <= 0.02 || hit.y >= WALL_H - 0.02) pr.vy = -pr.vy;
  else bounceOff(pr, hit.x, hit.z);
  pr.x = hit.x - d.x * 0.1;
  pr.y = clamp(hit.y, 0.1, WALL_H - 0.1);
  pr.z = hit.z - d.z * 0.1;
  spark(hit.x, hit.y, hit.z);
  fxHit(hit, d, false, 4);
  audio.ricochet();
  return true; // moved already this frame
}

function explode(pr, x, y, z) {
  const w = pr.weapon;
  const m = mult();
  audio.boom();
  S.player.shake = Math.max(S.player.shake, 0.25);
  if (R) {
    R.fx.explosion(x, y, z, w.splashRadius);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.position.set(x, y, z);
    R.scene.add(mesh);
    R.explosions.push({ mesh, t: 0, radius: w.splashRadius });
  }
  for (const e of S.enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - x, e.z - z) - e.r;
    if (d > w.splashRadius || y > e.h + w.splashRadius) continue;
    const fall = 1 - clamp(d / w.splashRadius, 0, 1) * 0.65;
    damageEnemy(e, w.splashDamage * fall * m.damage, false, x, z, w.knock, { pierce: true });
  }
  alertNear(x, z, 22);
}

// Sparks, oil and smoke where a shot lands. Fewer per pellet for shotguns so the pool is never swamped.
function fxHit(hit, d, robot, pellets) {
  if (!R) return;
  const n = Math.max(2, Math.round(7 / Math.sqrt(pellets)));
  R.fx.sparks(hit.x, hit.y, hit.z, -d.x, 0.3, -d.z, n);
  if (robot) R.fx.oil(hit.x, hit.y, hit.z, Math.max(1, Math.round(n / 2)));
  else R.fx.smoke(hit.x - d.x * 0.05, hit.y, hit.z - d.z * 0.05, 1, 0.3, 0.3, 0.4);
}

function spark(x, y, z) {
  if (!R) return;
  const slot = R.impacts.reduce((a, b) => (b.t < a.t ? b : a));
  slot.t = 1;
  slot.obj.position.set(x, y, z);
  slot.obj.visible = true;
}

function updateWeapon(dt, ctl) {
  const p = S.player;
  const w = WEAPONS[p.weapon];
  p.fireT = Math.max(0, p.fireT - dt);
  p.switchT = Math.max(0, p.switchT - dt);
  p.heat = Math.max(0, p.heat - dt * 6);
  p.kick = Math.max(0, p.kick - dt * 6);
  if (S.drink || S.laser || S.attach) {
    // hands are full: no firing, reloading or swapping until the drink is done (or the torch is fitted)
    p.fireT = Math.max(p.fireT, 0.1);
    return;
  }
  if (ctl.swap) cycleWeapon();
  if (ctl.reload) startReload();
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) {
      p.reloadT = 0;
      p.ammo[p.weapon] = ARS.clipOf(w);
      audio.reload(true);
    }
  } else if (p.ammo[p.weapon] <= 0) {
    startReload();
  }
  ARS.updateAlt(dt, ctl); // the SMG's alt-fire: a press, a burst in progress, the cooldown
  if (WEAPONS[p.weapon].kind === 'beam') { ARS.beamFrame(dt, ctl.firing); return; } // the Feedback Beam: a held trigger and a meter, no shots
  if (ctl.firing && p.reloadT <= 0 && p.fireT <= 0 && p.switchT <= 0 && p.ammo[p.weapon] > 0) fire();
}

// ---- projectiles, effects, pickups, areas ----

function updateProjectiles(dt) {
  const p = S.player;
  for (const pr of S.projectiles) {
    if (pr.grenade) { ARS.stepGrenade(pr, dt); continue; } // the Bass-Drop Grenade has its own flight
    pr.life -= dt;
    const step = Math.hypot(pr.vx, pr.vy, pr.vz) * dt;
    const d = { x: pr.vx * dt / step, y: pr.vy * dt / step, z: pr.vz * dt / step };
    if (pr.owner === 'player' && pr.bounces !== undefined) {
      if (stepDisc(pr, d, step)) { pr.mesh.position.set(pr.x, pr.y, pr.z); continue; }
      pr.mesh.rotation.y += dt * 24;
    } else if (pr.owner === 'player') {
      const hit = castRay(pr.x, pr.y, pr.z, d, step + 0.2, false);
      if (hit.t < step + 0.2 && (hit.enemy || hit.t <= step + 0.1)) {
        explode(pr, hit.x, hit.y, hit.z);
        pr.life = -1;
        continue;
      }
    } else {
      const hl = Math.hypot(d.x, d.z);
      if (hl > 1e-6 && world.raycast(pr.x, pr.z, d.x / hl, d.z / hl, step * hl + 0.15) < step * hl + 0.1) {
        pr.life = -1;
        continue;
      }
      if (Math.hypot(pr.x - p.x, pr.z - p.z) < PLAYER_R + 0.3 && pr.y > 0.1 && pr.y < 1.9) {
        hurtPlayer(pr.damage, pr.x - pr.vx, pr.z - pr.vz, false);
        pr.life = -1;
        continue;
      }
      pr.spin += dt * 12;
    }
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.z += pr.vz * dt;
    pr.mesh.position.set(pr.x, pr.y, pr.z);
    if (pr.owner === 'enemy') pr.mesh.rotation.y = pr.spin;
    if (pr.y < 0.05 && pr.owner === 'enemy') pr.life = -1;
  }
  for (let i = S.projectiles.length - 1; i >= 0; i--) {
    if (S.projectiles[i].life > 0) continue;
    if (R) R.scene.remove(S.projectiles[i].mesh);
    S.projectiles.splice(i, 1);
  }
}

function updateEffects(dt) {
  if (!R) return;
  for (const im of R.impacts) {
    if (im.t <= 0) continue;
    im.t -= dt * 4;
    if (im.t <= 0) im.obj.visible = false;
    else im.obj.scale.setScalar(Math.max(0.01, im.t));
  }
  for (let i = R.explosions.length - 1; i >= 0; i--) {
    const x = R.explosions[i];
    x.t += dt * 3.5;
    x.mesh.scale.setScalar(0.4 + x.t * x.radius * 0.9);
    x.mesh.material.opacity = Math.max(0, 0.8 * (1 - x.t));
    if (x.t >= 1) {
      R.scene.remove(x.mesh);
      x.mesh.geometry.dispose();
      x.mesh.material.dispose();
      R.explosions.splice(i, 1);
    }
  }
}

function updatePickups(dt) {
  const p = S.player;
  for (const pk of S.pickups) {
    if (pk.taken) continue;
    pk.phase += dt;
    pk.mesh.position.y = 0.05 + Math.sin(pk.phase * 2.2) * 0.06;
    pk.mesh.rotation.y += dt * 1.4;
    if (pk.mesh.userData && pk.mesh.userData.update) pk.mesh.userData.update(S.t);
    if (Math.hypot(pk.def.x - p.x, pk.def.z - p.z) > 1.2) continue;
    if (pk.def.kind === 'drink') {
      if (S.drink) continue; // one drink at a time
      if (pk.def.item === 'dram' && p.health >= p.maxHealth) continue; // keep it for when it is needed
      if (DRINKS[pk.def.item].super && laserBlocked()) {
        if (!S.toast) toast('LAST ORDERS: NOT IN HERE');
        continue;
      }
      startDrink(pk.def.item);
    } else if (pk.def.kind === 'upgrade') {
      if (!ARS.takeUpgrade(pk.def.item)) continue; // already at the top tier: leave it
    } else if (pk.def.kind === 'record') {
      if (!ARS.takeRecord(pk.def.item)) continue;
    } else {
      const w = WEAPONS[pk.def.item];
      if (p.owned[w.id]) continue;
      p.owned[w.id] = true;
      p.ammo[w.id] = ARS.clipOf(w);
      selectWeapon(w.id);
      toast(`${w.name} PICKED UP`);
    }
    pk.taken = true;
    pk.mesh.visible = false;
    audio.pickup();
  }
}

// ---- drinks ----

function startDrink(id) {
  const p = S.player;
  const dr = DRINKS[id];
  const vm = R && R.drinkVms[id];
  S.drink = { id, t: 0, dur: vm ? vm.duration : dr.duration, opened: false, gulpT: 0, applied: false };
  p.reloadT = 0; // reloading is interrupted, the clip stays as it was
}

function applyDrink(id) {
  const p = S.player;
  const dr = DRINKS[id];
  if (dr.heal) {
    p.health = Math.min(p.maxHealth, p.health + dr.heal * mult().health);
    toast(`${dr.name}: +${Math.round(dr.heal * mult().health)} HEALTH`);
  } else {
    S.buffs[dr.buff] = dr.seconds;
    toast(`${dr.name}: ${dr.label} FOR ${dr.seconds}S`);
  }
  audio.pickup();
}

function updateDrink(dt) {
  const d = S.drink;
  if (!d) return;
  d.t += dt;
  const k = d.t / d.dur;
  if (!d.opened && k >= 0.12) {
    d.opened = true;
    audio.drinkOpen(d.id);
  }
  if (k >= 0.3 && k <= 0.72) {
    d.gulpT -= dt;
    if (d.gulpT <= 0) {
      d.gulpT = 0.17;
      audio.gulp();
    }
  }
  if (!d.applied && k >= 0.65) {
    d.applied = true;
    audio.drinkDone(d.id);
    if (DRINKS[d.id].super) audio.pickup(); // the super drink's effect is the laser, which starts when the animation ends
    else applyDrink(d.id);
  }
  if (k >= 1) {
    S.drink = null;
    if (DRINKS[d.id].super) {
      if (laserBlocked()) toast('THE LASER FIZZLES');
      else startLaser();
    }
  }
}

// ---- the super power-up: Last Orders ----

// The laser must never fire in a boss room, and never while a boss is awake.
function inBossArea(x, z) {
  const a = world.areaAt(x, z);
  return !!a && a.spawns.some((s) => ENEMY_DEFS[s.kind].boss);
}

function laserBlocked() {
  const p = S.player;
  return inBossArea(p.x, p.z) || S.enemies.some((e) => e.boss && !e.dead && e.state !== 'idle');
}

function startLaser() {
  const p = S.player;
  const cfg = DRINKS.lastorders.laser;
  S.camYaw = p.yaw;
  S.laser = { t: 0, dur: cfg.seconds, charge: cfg.charge, tail: cfg.tail, yaw0: p.yaw, beam: false, len: 0, sounded: false, ended: false };
  p.vx = p.vz = 0;
  S.banner = { title: 'LAST ORDERS!', sub: DRINKS.lastorders.line, t: 2.4, max: 2.4 };
  audio.laserCharge();
}

function vaporise(e, p) {
  damageEnemy(e, 1e9, false, p.x, p.z, 0);
  if (R) R.fx.explosion(e.x, e.h * 0.5, e.z, 1.6);
}

// Kills every non-boss robot with a clear line to Naebun inside the beam's arc (and, at the very end, any that
// slipped through), as the view spins. Bosses are never touched.
function updateLaser(dt) {
  const L = S.laser;
  const p = S.player;
  const cfg = DRINKS.lastorders.laser;
  L.t += dt;
  p.vx = p.vz = 0;
  p.pitch += (0 - p.pitch) * Math.min(1, dt * 8);
  const spinFor = L.dur - L.charge - L.tail;
  const k = clamp((L.t - L.charge) / spinFor, 0, 1);
  const prev = p.yaw;
  p.yaw = wrap(L.yaw0 + k * k * (3 - 2 * k) * cfg.turns * TAU);
  L.beam = L.t >= L.charge && L.t < L.dur - L.tail;
  if (L.beam && !L.sounded) {
    L.sounded = true;
    audio.laserBeam(spinFor + 0.2);
  }
  if (L.beam) {
    const dx = -Math.sin(p.yaw);
    const dz = -Math.cos(p.yaw);
    L.len = Math.min(cfg.radius, world.raycast(p.x, p.z, dx, dz, cfg.radius));
    const sweep = Math.abs(wrap(p.yaw - prev));
    for (const e of S.enemies) {
      if (e.dead || e.boss) continue;
      const ex = e.x - p.x;
      const ez = e.z - p.z;
      const d = Math.hypot(ex, ez);
      if (d > cfg.radius) continue;
      const diff = Math.abs(wrap(Math.atan2(-ex, -ez) - p.yaw));
      if (diff <= Math.max(Math.atan2(cfg.width + e.r, Math.max(d, 0.5)), sweep) && world.los(p.x, p.z, e.x, e.z)) vaporise(e, p);
    }
    if (R) R.fx.sparks(p.x + dx * L.len, 1.1, p.z + dz * L.len, -dx, 0.2, -dz, 4);
  }
  if (L.t >= L.dur) {
    for (const e of S.enemies) {
      if (e.dead || e.boss || Math.hypot(e.x - p.x, e.z - p.z) > cfg.radius) continue;
      if (world.los(p.x, p.z, e.x, e.z)) vaporise(e, p);
    }
    audio.laserEnd();
    S.laser = null;
    S.player.shake = Math.max(S.player.shake, 0.4);
  }
}

function toast(text) {
  S.toast = { text, t: 2.4 };
}

function updateAreas() {
  const p = S.player;
  for (const a of S.areas) {
    let alive = 0;
    for (const e of S.enemies) if (e.areaId === a.def.id && !e.dead) alive++;
    a.alive = alive;
    if (!a.cleared && alive === 0) {
      a.cleared = true;
      for (const id of a.def.unlocks) world.setDoorOpen(id, true);
      audio.door();
      S.banner = { title: 'AREA CLEAR', sub: 'The door is open.', t: 2.2, max: 2.2 };
    }
  }
  const here = world.areaAt(p.x, p.z);
  if (here && (!S.currentArea || S.currentArea.def.id !== here.id)) {
    const a = S.areas.find((x) => x.def.id === here.id);
    S.currentArea = a;
    if (a && !a.announced) {
      a.announced = true;
      if (!S.banner) S.banner = { title: here.name, sub: levelInfo().hints[here.id] || here.objective, t: 2.8, max: 2.8 };
    }
  }
  S.allClear = S.areas.every((a) => a.cleared);
  if (S.allClear && Math.hypot(p.x - world.exit.x, p.z - world.exit.z) < world.exit.r) completeLevel();
}

// ---- update ----

// One line for the Settings page: how far the saved game is and the best scores.
function progressText() {
  const bests = S.save.best[S.save.difficulty];
  const best = Object.keys(bests).map((n) => `L${n} ${bests[n]}`).join('  ');
  const mode = DIFFICULTY[S.save.difficulty].tag;
  return `Furthest level: ${S.save.unlocked}${S.save.done.length ? `   Done: ${S.save.done.join(', ')}` : ''}${best ? `   Best${mode ? ` (${mode})` : ''}: ${best}` : ''}`;
}

function stateFor(mode) {
  switch (mode) {
    case 'settings': return { t: S.t, input: inputMode(), sensLabel: MOUSE_SENS[S.settings.sens].label, resetArmed: S.resetArmed > 0, saved: progressText() };
    case 'setlist': return { t: S.t, found: S.save.records.slice() };
    case 'difficulty': return { t: S.t, input: inputMode(), difficulty: S.difficulty };
    case 'title': return { t: S.t, records: S.save.records.length, input: inputMode(), resumeLevel: S.save.unlocked > 1 ? Math.min(S.save.unlocked, LEVELS.length) : 0, difficulty: S.difficulty, debugMode: S.debugMode, best: bestFor(startLevel()), levelNumber: LEVELS[startLevel() - 1].number, levelName: LEVELS[startLevel() - 1].name };
    case 'controls': return { t: S.t, input: inputMode() };
    case 'dead': return { t: S.deadT, line: S.deadLine, score: S.score, best: S.best, newBest: S.newBest, debugMode: S.debugMode, difficulty: S.difficulty, levelName: levelInfo().name };
    case 'complete':
      return {
        t: S.completeT, score: S.score, best: S.best, newBest: S.newBest, timeSec: S.runT, kills: S.kills,
        totalEnemies: S.totalEnemies, debugMode: S.debugMode, difficulty: S.difficulty, hasNext: S.level < LEVELS.length,
        title: levelInfo().doneTitle, line: levelInfo().doneLine, sub: levelInfo().doneSub,
      };
    case 'voicemail': return { t: S.mailT, mail: levelInfo().voicemail, level: levelInfo() };
    default: return { t: S.t };
  }
}

function handlePresses(input, view) {
  for (const press of input.pressed) {
    const list = screens.buttons(S.mode, view, stateFor(S.mode));
    const b = list.find((x) => press.x >= x.x && press.x <= x.x + x.w && press.y >= x.y && press.y <= x.y + x.h);
    if (!b) continue;
    audio.unlock();
    audio.blip();
    switch (b.mode ? 'mode' : b.id) {
      case 'new': S.mode = 'difficulty'; break;
      case 'back':
        if (S.mode === 'controls') S.mode = 'difficulty';
        else { S.mode = 'title'; setDifficulty(startMode()); } // leaving the difficulty page (or any other) unpicks an unstarted choice
        break;
      case 'settings': S.mode = 'settings'; S.resetArmed = 0; break;
      case 'setlist': S.mode = 'setlist'; break;
      case 'resume': resumeGame(); break;
      case 'reset': // two taps: the first arms it, the second erases the saved progress and scores
        if (S.resetArmed > 0) {
          S.save = store.reset();
          setDifficulty(startMode());
          S.resetArmed = 0;
        } else S.resetArmed = 4;
        break;
      case 'input': S.settings.input = inputMode() === 'pc' ? 'mobile' : 'pc'; saveSettings(); break;
      case 'sens': S.settings.sens = (S.settings.sens + 1) % MOUSE_SENS.length; saveSettings(); break;
      case 'start': S.level = startLevel(); beginRun(); break;
      case 'mode': setDifficulty(b.mode); S.mode = 'controls'; break; // a choice on the difficulty page: pick it and go on
      case 'next': nextLevel(); break;
      case 'continue': S.mode = 'intro'; S.introT = 0; break;
      case 'debug':
        S.debugMode = !S.debugMode;
        write(DEBUG_KEY, S.debugMode);
        break;
      case 'retry':
        resetLevel();
        S.mode = 'play';
        break;
      case 'again': beginRun(); break;
      case 'menu': toTitle(); break;
      default:
    }
    return; // one press per frame is plenty, and a mode change invalidates the button list
  }
}

// The difficulty page also answers the keyboard: 1 2 3 pick, Up and Down move the highlight, Enter picks it, Escape goes back.
// `input.keys` holds what is down, so a press is a key that was not down on the previous menu step.
function handleDifficultyKeys(input) {
  const down = (k) => input.keys.has(k) && !S.prevKeys.has(k);
  const at = DIFFICULTY_ORDER.indexOf(S.difficulty);
  let pick = null;
  DIFFICULTY_ORDER.forEach((m, i) => { if (down(String(i + 1))) pick = m; });
  if (!pick && down('enter')) pick = S.difficulty;
  if (down('arrowup') && at > 0) setDifficulty(DIFFICULTY_ORDER[at - 1]);
  if (down('arrowdown') && at < DIFFICULTY_ORDER.length - 1) setDifficulty(DIFFICULTY_ORDER[at + 1]);
  if (pick) {
    audio.blip();
    setDifficulty(pick);
    S.mode = 'controls';
  } else if (down('escape')) {
    audio.blip();
    S.mode = 'title';
    setDifficulty(startMode());
  }
}

export function update(dt, input, view) {
  S.view = view;
  S.t += dt;
  audio.tick();
  if (S.pendingLoad && S.loadReady) {
    S.pendingLoad = false;
    loadLevel(S.level);
    resetLevel();
  }
  if (BAKED.state === 'ready') applyBaked();
  world.update(dt, S.t);
  if (S.banner && (S.banner.t -= dt) <= 0) S.banner = null;
  if (S.toast && (S.toast.t -= dt) <= 0) S.toast = null;
  S.hitMarker = Math.max(0, S.hitMarker - dt * 5);
  if (S.resetArmed > 0) S.resetArmed = Math.max(0, S.resetArmed - dt);
  S.camK += ((S.laser && S.laser.t < S.laser.dur - 0.15 ? 1 : 0) - S.camK) * Math.min(1, dt * 7);
  if (S.camK < 0.002) S.camK = 0;

  switch (S.mode) {
    case 'title':
    case 'difficulty':
    case 'controls':
    case 'settings':
    case 'setlist':
    case 'dead':
    case 'complete':
      if (S.mode === 'difficulty') handleDifficultyKeys(input);
      S.prevKeys.clear();
      for (const k of input.keys) S.prevKeys.add(k);
      if (S.mode === 'dead') S.deadT += dt;
      if (S.mode === 'complete') S.completeT += dt;
      if (S.mode === 'dead' || S.mode === 'complete') {
        for (const e of S.enemies) if (e.state === 'dead') updateEnemy(e, dt);
      }
      handlePresses(input, view);
      audio.setMood(S.mode === 'title' || S.mode === 'difficulty' || S.mode === 'controls' || S.mode === 'settings' || S.mode === 'setlist' ? 0.1 : 0.4, S.mode === 'dead');
      break;
    case 'voicemail':
      S.mailT += dt;
      handlePresses(input, view);
      audio.setMood(0.1, false);
      break;
    case 'intro':
      S.introT += dt;
      if (S.introT > 3.2 || (S.introT > 0.8 && input.pressed.length)) S.mode = 'play';
      break;
    default:
      updatePlay(dt, input, view);
  }
}

// ---- the gun torch ----

const SEAT_K = 0.6; // how far through the fitting animation the torch clicks home (the Blender rig reports its own, see updateTorch)
const FIT_TIME = 2.8; // seconds of hand movement, after a short pause

// A quick stutter as the torch comes on: 0 dark, 1 full.
const flickerOn = (t) => (t < 0.12 ? 0 : t < 0.22 ? 1 : t < 0.32 ? 0.15 : t < 0.4 ? 1 : t < 0.48 ? 0.35 : 1);

function torchOnPistolMounted() {
  return S.torch.attached || (!!S.attach && S.attach.k >= (R && R.attachRig ? R.attachRig.seatK || SEAT_K : SEAT_K));
}

// Fitting sequence, switch and brightness. Runs only while playing; the light and beam themselves are placed in render.
function updateTorchLogic(dt, ctl) {
  const T = S.torch;
  const A = S.attach;
  if (A) {
    A.t += dt;
    A.k = clamp((A.t - 0.5) / FIT_TIME, 0, 1);
    const seat = R && R.attachRig ? R.attachRig.seatK || SEAT_K : SEAT_K;
    if (!A.seated && A.k >= seat) {
      A.seated = true;
      audio.torchClick();
    }
    if (A.k >= 1) {
      if (A.onT < 0) { A.onT = 0; audio.torchOn(); }
      A.onT += dt;
      T.k = flickerOn(A.onT);
      if (A.onT > 0.9) {
        S.attach = null;
        T.attached = true;
        T.on = true;
        T.k = 1;
        if (!S.debugMode) {
          S.save.torch = true;
          store.save(S.save);
        }
        S.toast = { text: 'TORCH ON', t: 2.2 };
      }
    } else T.k = 0;
    return;
  }
  const mounted = S.player.weapon !== 'pistol' || T.attached;
  if (ctl.torch && mounted) {
    T.on = !T.on;
    audio.torchClick();
  }
  if (!mounted) T.on = false;
  T.k += ((T.on ? 1 : 0) - T.k) * Math.min(1, dt * 14);
  if (Math.abs(T.k - (T.on ? 1 : 0)) < 0.01) T.k = T.on ? 1 : 0;
}

function updatePlay(dt, input, view) {
  const p = S.player;
  S.runT += dt;
  const ctl = readControls(input, view, dt);
  updateTorchLogic(dt, ctl);
  if (S.laser) {
    // the spin owns the view: no walking, turning, firing, reloading or swapping
    ctl.mx = ctl.mz = ctl.yawD = ctl.pitchD = 0;
    ctl.firing = ctl.reload = ctl.swap = false;
    updateLaser(dt);
  }

  // look
  p.yaw = wrap(p.yaw + ctl.yawD);
  p.pitch = clamp(p.pitch + ctl.pitchD, -1.2, 1.2);

  // move: forward is (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw)
  const sp = PLAYER.speed * (buffOn('speed') ? DRINKS.orange.mult : 1);
  const tvx = (-Math.sin(p.yaw) * ctl.mz + Math.cos(p.yaw) * ctl.mx) * sp;
  const tvz = (-Math.cos(p.yaw) * ctl.mz - Math.sin(p.yaw) * ctl.mx) * sp;
  const k = Math.min(1, dt * 14);
  p.vx += (tvx - p.vx) * k;
  p.vz += (tvz - p.vz) * k;
  const mv = world.moveCircle(p.x, p.z, p.vx * dt, p.vz * dt, PLAYER_R);
  p.x = mv.x;
  p.z = mv.z;
  for (const e of S.enemies) {
    if (e.dead) continue;
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const min = e.r + PLAYER_R * 0.9;
    const d = Math.hypot(dx, dz);
    if (d < min && d > 1e-4) {
      const push = world.moveCircle(p.x, p.z, (dx / d) * (min - d), (dz / d) * (min - d), PLAYER_R);
      p.x = push.x;
      p.z = push.z;
    }
  }
  p.moveMag = Math.hypot(p.vx, p.vz) / sp;
  p.bobT += dt * p.moveMag * 9;
  p.hurt = Math.max(0, p.hurt - dt * 1.6);
  p.shake = Math.max(0, p.shake - dt);

  for (const name of Object.keys(S.buffs)) S.buffs[name] = Math.max(0, S.buffs[name] - dt);
  updateDrink(dt);
  updateWeapon(dt, ctl);

  flowT -= dt;
  if (flowT <= 0) {
    flowT = 0.25;
    flow.update(p.x, p.z);
  }
  for (const e of S.enemies) updateEnemy(e, dt);
  updatePendingBursts();
  separateEnemies();
  updateProjectiles(dt);
  updatePickups(dt);
  updateEffects(dt);
  updateAreas();

  for (let i = S.damageDirs.length - 1; i >= 0; i--) {
    S.damageDirs[i].t -= dt / 1.5;
    if (S.damageDirs[i].t <= 0) S.damageDirs.splice(i, 1);
  }
  const intensity = clamp(0.2 + 0.1 * S.areas.findIndex((a) => !a.cleared), 0.1, 0.8);
  audio.setMood(intensity, false);
}

// ---- render ----

const BUFF_MAX = { speed: DRINKS.orange.seconds, guard: DRINKS.heavy.seconds, rapid: DRINKS.energy.seconds };
const hudState = {
  health: 0, maxHealth: 0, hurt: 0, damageDirs: null, weapon: { id: '', name: '', clip: 0, clipSize: 0, reload: null },
  weapons: null, hitMarker: 0, headshot: false, toast: null, banner: null, objective: '', enemiesLeft: 0, areaName: '',
  boss: null, score: 0, timeSec: 0, debugMode: false, difficulty: '', move: null, look: null, firing: false, buffs: null, cinematic: 0,
};

function buildHudState() {
  const p = S.player;
  const w = WEAPONS[p.weapon];
  const h = hudState;
  h.health = Math.ceil(p.health);
  h.maxHealth = p.maxHealth;
  h.hurt = p.hurt;
  h.damageDirs = S.damageDirs;
  h.weapon = { id: w.id, name: w.name, clip: p.ammo[w.id], clipSize: ARS.clipOf(w), reload: p.reloadT > 0 ? 1 - p.reloadT / (p.reloadTotal || w.reload) : null };
  h.weapons = WEAPON_ORDER.filter((id) => !WEAPONS[id].prepared || p.owned[id]).map((id) => ({ id, name: WEAPONS[id].name, owned: !!p.owned[id], active: id === p.weapon })); // a prepared weapon shows once owned
  ARS.hud(h); // upgrades, the alt-fire button, the beam's meter
  h.hitMarker = S.hitMarker;
  h.headshot = S.headshot;
  h.toast = S.toast;
  h.banner = S.banner;
  const area = S.currentArea;
  h.objective = area ? area.def.objective : '';
  h.enemiesLeft = area ? area.alive : 0;
  h.areaName = area ? area.def.name : '';
  h.boss = S.boss && !S.boss.dead ? { name: S.boss.def.name, hp: Math.max(0, S.boss.hp), maxHp: S.boss.maxHp } : null;
  h.score = S.score;
  h.timeSec = S.runT;
  h.debugMode = S.debugMode;
  h.difficulty = DIFFICULTY[S.difficulty].tag; // '' in normal mode
  h.cinematic = S.camK;
  h.buffs = Object.entries(S.buffs).filter(([, t]) => t > 0).map(([id, t]) => ({ id, t, max: BUFF_MAX[id] }));
  h.move = S.ui.move;
  h.look = S.ui.look;
  h.firing = S.ui.firing;
  h.compact = inputMode() === 'pc'; // PC mode: the grey touch boxes and buttons are hidden
  h.hint = wantsMouseLock() && !S.mouseLocked && !S.mouseTest ? 'CLICK TO AIM WITH THE MOUSE   ESC TO LET GO' : null;
  return h;
}

function placeCamera() {
  const { camera } = R;
  const p = S.player;
  if (S.mode === 'title' || S.mode === 'difficulty' || S.mode === 'controls' || S.mode === 'settings' || S.mode === 'setlist') {
    // slow drift through the dance floor as a backdrop for the menus
    const a = world.areas.find((x) => x.id === levelInfo().titleArea) || world.areas[0];
    const cx = ((a.rect.c0 + a.rect.c1 + 1) / 2) * 2;
    const cz = ((a.rect.r0 + a.rect.r1 + 1) / 2) * 2;
    camera.position.set(cx + Math.sin(S.t * 0.15) * 3, 2.2, cz + Math.cos(S.t * 0.15) * 3);
    camera.rotation.set(-0.08, S.t * 0.12, 0);
    return;
  }
  const bob = Math.sin(p.bobT) * 0.045 * clamp(p.moveMag, 0, 1);
  let y = EYE + bob;
  let roll = 0;
  if (S.mode === 'dead') {
    const k = clamp(S.deadT / 0.8, 0, 1);
    y = EYE * (1 - k) + 0.35 * k;
    roll = 0.9 * k;
  }
  const laser = S.laser && S.laser.beam;
  const sh = p.shake * p.shake * 0.5 + (laser ? 0.04 : 0);
  let cx = p.x + (Math.random() - 0.5) * sh * 0.3;
  let cz = p.z + (Math.random() - 0.5) * sh * 0.3;
  let yaw = p.yaw;
  let pitch = p.pitch + (Math.random() - 0.5) * sh * 0.2;
  roll += (Math.random() - 0.5) * sh * 0.2;
  let fov = R.baseFov;

  // Last Orders: ease out to a third-person camera behind and above Naebun, looking at him
  const k = S.camK;
  if (k > 0) {
    const e = k * k * (3 - 2 * k);
    const tx = p.x;
    const tz = p.z;
    const ty = 1.15;
    const bx = Math.sin(S.camYaw);
    const bz = Math.cos(S.camYaw);
    const dist = Math.min(5.2, Math.max(1.6, world.raycast(tx, tz, bx, bz, 5.8) - 0.45)); // never inside a wall
    const tpx = tx + bx * dist;
    const tpz = tz + bz * dist;
    const tpy = 2.7;
    const tpYaw = Math.atan2(-(tx - tpx), -(tz - tpz));
    const tpPitch = Math.atan2(ty - tpy, Math.hypot(tx - tpx, tz - tpz));
    cx += (tpx - cx) * e;
    cz += (tpz - cz) * e;
    y += (tpy - y) * e;
    yaw += wrap(tpYaw - yaw) * e;
    pitch += (tpPitch - pitch) * e;
    roll *= 1 - e;
    fov += (R.baseFov * (72 / 85) - fov) * e;
  }
  if (Math.abs(R.fov - fov) > 0.02) {
    R.fov = fov;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  camera.position.set(cx, y, cz);
  camera.rotation.set(pitch, yaw, roll);

  // Naebun appears once the camera is out, spinning with the cannon; the beam leaves the cannon
  const F = R.naebun;
  F.group.visible = S.mode === 'play' && k > 0.2;
  if (F.group.visible) {
    F.group.position.set(p.x, 0, p.z);
    F.group.rotation.y = p.yaw;
    F.setPose(S.laser ? 'spin' : 'idle', S.laser ? S.laser.t : S.t, S.laser ? clamp(S.laser.t / S.laser.dur, 0, 1) : 0);
  }
  const bv = R.beam;
  bv.visible = !!laser;
  if (laser) {
    const L = S.laser;
    let ox = p.x - Math.sin(p.yaw) * 0.9;
    let oy = 1.2;
    let oz = p.z - Math.cos(p.yaw) * 0.9;
    if (F.muzzle) {
      F.group.updateMatrixWorld(true);
      const v = R.tmpV || (R.tmpV = new THREE.Vector3());
      F.muzzle.getWorldPosition(v);
      ox = v.x;
      oy = v.y;
      oz = v.z;
    }
    bv.position.set(ox, oy, oz);
    bv.rotation.set(0, p.yaw, 0);
    const pulse = 1 + Math.sin(S.t * 40) * 0.08;
    const len = Math.max(1, L.len - 0.9);
    R.beamParts[0].scale.set(pulse, pulse, len);
    R.beamParts[1].scale.set(pulse * 1.1, pulse * 1.1, len);
    R.beamParts[2].scale.set(pulse * 1.3, pulse * 1.3, len);
  }
}

function animateWorld() {
  for (const e of S.enemies) {
    e.robot.group.position.set(e.x, 0, e.z);
    e.robot.group.rotation.y = e.yaw;
    if (e.state === 'dead' && e.deadT > 3.5 && !corpseHeld(e)) e.robot.group.visible = false;
  }
}

function animateViewmodel(dt) {
  const p = S.player;
  const { models, flashes, wroot } = R;
  const drinking = S.drink && R.drinkVms[S.drink.id];
  for (const id of WEAPON_ORDER) models[id].visible = !drinking && !S.laser && id === p.weapon && (S.mode === 'play' || S.mode === 'intro');
  for (const id of Object.keys(R.drinkVms)) R.drinkVms[id].group.visible = !!drinking && S.drink.id === id;
  if (models.vinyl && models.vinyl.visible && models.vinyl.userData.update) models.vinyl.userData.update(S.t); // the record turns
  const w = WEAPONS[p.weapon];
  const bobX = Math.cos(p.bobT * 0.5) * 0.012 * p.moveMag;
  const bobY = Math.abs(Math.sin(p.bobT * 0.5)) * 0.014 * p.moveMag;
  const reloading = p.reloadT > 0 ? 1 - p.reloadT / (p.reloadTotal || w.reload) : 0;
  const dip = Math.sin(reloading * Math.PI);
  const sw = p.switchT / 0.25;
  const baseX = weaponX(R.wcam.aspect) - (p.weapon === 'launcher' || p.weapon === 'vinyl' ? 0.03 : 0);
  wroot.scale.setScalar(0.68);
  if (drinking) {
    // the drink animation owns the pose; the root stays at the usual resting spot
    wroot.position.set(0.15, -0.24, -0.62);
    wroot.rotation.set(0, 0, 0);
    R.drinkVms[S.drink.id].setPose(S.drink.t / S.drink.dur);
  } else {
    wroot.position.set(baseX + bobX, (R.wcam.aspect < 1 ? -0.205 : -0.24) + bobY - dip * 0.22 - sw * 0.4, -0.62 + p.kick * 0.08);
    wroot.rotation.set(0.03 + p.kick * 0.22 + dip * 0.7, 0.07 + dip * -0.25, dip * 0.2);
    if (S.attach) {
      // while the torch is fitted the pistol comes up and rolls a little, so its top (where the module clips on) faces the left hand
      const lift = Math.sin(clamp(S.attach.k, 0, 1) * Math.PI);
      wroot.position.z += 0.05 * lift;
      wroot.position.y += 0.035 * lift;
      wroot.position.x -= 0.03 * lift;
      wroot.rotation.x += 0.12 * lift;
      wroot.rotation.z += 0.3 * lift;
    }
  }
  // the shotgun's pump (and the left hand on it) slides back and forward in the gap between shots
  const pump = models.shotgun.getObjectByName('pump');
  if (pump) {
    const k = p.weapon === 'shotgun' && p.fireT > 0 ? 1 - p.fireT / (WEAPONS.shotgun.interval / mult().fire) : 1;
    pump.position.z = k > 0.15 && k < 0.85 ? Math.sin((Math.PI * (k - 0.15)) / 0.7) * 0.09 : 0;
  }
  R.muzzleT = Math.max(0, R.muzzleT - dt);
  for (const id of WEAPON_ORDER) {
    flashes[id].visible = id === p.weapon && R.muzzleT > 0;
    if (flashes[id].visible) flashes[id].rotation.z = Math.random() * TAU;
  }
  R.flashT = Math.max(0, R.flashT - dt);
  R.fill.intensity = R.fillBase + (R.flashT > 0 ? 2.5 : 0); // the muzzle flash lights the room a little
}

// ---- the gun torch: spot light and beam on the lens, pointing where the gun points ----

const _tp = new THREE.Vector3();
const _td = new THREE.Vector3();
const _tz = new THREE.Vector3(0, 0, -1);

// Where a model's torch lens is, and which way it shines, in the weapon's own frame. Models carry userData.lens; until they
// do (or if the procedural fallback is in use) the lens sits just under and behind the muzzle, pointing the way it does.
function lensOf(model) {
  if (model.userData.lens) return model.userData.lens;
  const m = model.getObjectByName('muzzle');
  const at = m ? m.position : { x: 0, y: 0, z: -0.4 };
  return { pos: [at.x, at.y - 0.04, at.z + 0.05], dir: [0, 0, -1] };
}

function updateTorch() {
  const { camera, wcam, wroot, models, spot, tbeam, attachRig } = R;
  const p = S.player;
  const T = S.torch;
  const drinking = !!S.drink;
  // each gun shows or hides its mounted torch (the pistol's only once it has been fitted) and lights the lens
  const pistolMounted = torchOnPistolMounted();
  const lit = T.k > 0.01 && S.mode === 'play' && !drinking && !S.laser && S.camK < 0.05;
  for (const id of WEAPON_ORDER) {
    const u = models[id].userData;
    if (u.setTorch) u.setTorch({ mounted: id === 'pistol' ? pistolMounted : true, on: lit && id === p.weapon, k: T.k });
  }
  if (attachRig) {
    attachRig.group.visible = !!S.attach && p.weapon === 'pistol' && S.mode === 'play';
    if (attachRig.group.visible) attachRig.setPose(S.attach.k);
  }
  const mounted = p.weapon !== 'pistol' || pistolMounted;
  if (!lit || !mounted) {
    spot.intensity = 0;
    tbeam.mesh.visible = false;
    return;
  }
  const model = models[p.weapon];
  const lens = lensOf(model);
  wroot.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  _tp.set(lens.pos[0], lens.pos[1], lens.pos[2]).applyMatrix4(model.matrixWorld);
  _td.set(lens.dir[0], lens.dir[1], lens.dir[2]).transformDirection(model.matrixWorld);
  // the weapon is drawn with its own, narrower lens: scale sideways so the beam starts where the lens is on screen
  const r = Math.tan((camera.fov * Math.PI) / 360) / Math.tan((wcam.fov * Math.PI) / 360);
  _tp.x *= r;
  _tp.y *= r;
  _td.x *= r;
  _td.y *= r;
  _td.normalize();
  _tp.applyMatrix4(camera.matrixWorld);
  _td.transformDirection(camera.matrixWorld);
  const cfg = R.torchCfg;
  const flick = 0.97 + 0.03 * Math.sin(S.t * 31) * Math.sin(S.t * 7.3);
  spot.position.copy(_tp);
  spot.target.position.copy(_tp).addScaledVector(_td, 6);
  spot.target.updateMatrixWorld();
  spot.intensity = cfg.intensity * T.k * flick;
  // the beam stops at the first wall, floor or ceiling
  let len = cfg.beam;
  const hl = Math.hypot(_td.x, _td.z);
  if (hl > 1e-6) len = Math.min(len, world.raycast(_tp.x, _tp.z, _td.x / hl, _td.z / hl, cfg.beam * hl) / hl);
  if (_td.y < -1e-6) len = Math.min(len, -_tp.y / _td.y);
  else if (_td.y > 1e-6) len = Math.min(len, (WALL_H - _tp.y) / _td.y);
  len = Math.max(0.3, len);
  const u = tbeam.u;
  u.uL.value = len;
  u.uR0.value = 0.025;
  u.uR1.value = tbeam.tanA * len;
  u.uI.value = 0.12 * T.k * flick;
  tbeam.mesh.position.copy(_tp);
  tbeam.mesh.quaternion.setFromUnitVectors(_tz, _td);
  tbeam.mesh.visible = true;
}

// Steps the quality down when the device is clearly struggling (under about 25 fps for a few seconds).
// Never steps up within a session, and the tier is remembered for next time. A 30 fps cap (Low Power Mode) is not
// treated as struggling: that would lower quality without making anything faster.
function trackFrame(dt) {
  Q.frames++;
  Q.ema += (dt - Q.ema) * 0.04;
  Q.fps = 1 / Q.ema;
  if (Q.fixed || Q.frames < 150 || Q.frames % 90 !== 0) return;
  if (Q.ema > 0.04) {
    const next = TIER_ORDER[TIER_ORDER.indexOf(Q.tier) + 1];
    if (!next) return;
    Q.tier = next;
    Q.frames = 0;
    Q.ema = 1 / 60;
    R.pipeline.setTier(next);
    R.fx.setQuality(FX_QUALITY[next]);
    resize(S.view);
    write(QUALITY_KEY, next);
  }
}

let vignetteGrad = null;
let vignetteKey = '';
function drawVignette(ctx, view) {
  const key = `${view.w}x${view.h}`;
  if (key !== vignetteKey) {
    vignetteGrad = ctx.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.3, view.w / 2, view.h / 2, Math.hypot(view.w, view.h) * 0.55);
    vignetteGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vignetteGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
    vignetteKey = key;
  }
  ctx.fillStyle = vignetteGrad;
  ctx.fillRect(0, 0, view.w, view.h);
}

export function render(ctx, view, alpha) {
  const dtv = 1 / 60;
  ctx.clearRect(0, 0, view.w, view.h);
  if (!R) return;
  if (PERF) PERF.begin(performance.now());
  if (S.pendingLoad) S.loadReady = true; // this frame shows the new screen; the world swaps on the next update
  placeCamera();
  animateWorld();
  animateViewmodel(dtv);
  ARS.animate(dtv); // the beam, shockwaves, stun stars and the grenade's throw
  updateTorch();
  const now = performance.now();
  const dt = Math.min(0.05, Q.last ? (now - Q.last) / 1000 : 1 / 60);
  Q.last = now;
  trackFrame(dt);
  R.fx.update(dt, R.camera, S.mode !== 'dead');
  R.renderer.info.reset();
  const showWeapon = (S.mode === 'play' || S.mode === 'intro') && S.camK < 0.05;
  R.pipeline.render(R.scene, R.camera, showWeapon ? R.wscene : null, R.wcam, R.look, {
    time: S.t, hurt: S.mode === 'play' ? S.player.hurt : 0, flash: R.flashT > 0 || (S.laser && S.laser.beam) ? 1 : 0,
  });
  if (R.pipeline.tier === 'low') drawVignette(ctx, view);

  switch (S.mode) {
    case 'title':
      screens.drawTitle(ctx, view, stateFor('title'));
      break;
    case 'difficulty':
      screens.drawDifficulty(ctx, view, stateFor('difficulty'));
      break;
    case 'controls':
      screens.drawControls(ctx, view, stateFor('controls'));
      break;
    case 'settings':
      screens.drawSettings(ctx, view, stateFor('settings'));
      break;
    case 'setlist':
      screens.drawSetlist(ctx, view, stateFor('setlist'));
      break;
    case 'voicemail':
      screens.drawVoicemail(ctx, view, stateFor('voicemail'));
      break;
    case 'intro':
      screens.drawIntro(ctx, view, { t: S.introT, level: levelInfo() });
      break;
    case 'dead': {
      const hs = buildHudState();
      if (view.w > view.h * 1.05) hs.cinematic = 1; // landscape: the control boxes would sit under the buttons
      hud.drawPlayHud(ctx, view, hs);
      screens.drawDead(ctx, view, stateFor('dead'));
      break;
    }
    case 'complete':
      screens.drawComplete(ctx, view, stateFor('complete'));
      break;
    default:
      hud.drawPlayHud(ctx, view, buildHudState());
  }
  if (PERF) PERF.end(performance.now(), view);
}

// ---- tests ----

export const getState = () => S;
export const getWorld = () => world;

// Reachable only through window.__game (?test). Lets the smoke test and headless simulations drive the game.
export function testHook(cmd, arg) {
  const v = S.view;
  switch (cmd) {
    case 'buttons': return screens.buttons(S.mode, v, stateFor(S.mode));
    case 'play': resetLevel(); S.mode = 'play'; return undefined;
    case 'level': loadLevel(arg); resetLevel(); S.mode = 'play'; return undefined;
    case 'title': toTitle(); return undefined;
    case 'difficulty': // set this run's mode ('normal' | 'hard' | 'extra') and respawn the robots in it; returns the mode in force
      if (arg !== undefined) { setDifficulty(arg); S.best = bestFor(S.level); resetLevel(); }
      return S.difficulty;
    case 'teleport': S.player.x = arg.x; S.player.z = arg.z; if (arg.yaw !== undefined) S.player.yaw = arg.yaw; return undefined;
    case 'killArea':
      for (const e of S.enemies) if (e.areaId === arg && !e.dead) damageEnemy(e, 1e6, false, e.x, e.z, 0);
      return undefined;
    case 'giveWeapons': // the five weapons the levels have; give 'all' for the prepared ones too
      for (const id of WEAPON_ORDER) if (!WEAPONS[id].prepared) { S.player.owned[id] = true; S.player.ammo[id] = WEAPONS[id].clip; }
      return undefined;
    case 'give': ARS.give(arg); return undefined; // 'beam', ['clip', 'gala'] or { weapons, upgrades, records }: weapons, upgrades and records by id
    case 'arsenal': return ARS; // the arsenal's own functions, for the headless checks
    case 'hud': return buildHudState(); // what the HUD is told, for the headless checks
    case 'layout': return layoutFor(v);
    case 'hurt': hurtPlayer(arg, S.player.x, S.player.z + 5, false); return undefined;
    case 'screen': // jump to a menu screen, for screenshots: title | controls | intro | voicemail | dead | complete
      if (arg === 'title') toTitle();
      else if (arg === 'difficulty') S.mode = 'difficulty';
      else if (arg === 'controls') S.mode = 'controls';
      else if (arg === 'settings') S.mode = 'settings';
      else if (arg === 'setlist') S.mode = 'setlist';
      else if (arg === 'intro') beginRun();
      else if (arg === 'voicemail') { S.level = 2; S.mode = 'voicemail'; S.mailT = 0; }
      else if (arg === 'dead') { resetLevel(); S.mode = 'play'; die(); }
      else if (arg === 'complete') { resetLevel(); S.mode = 'play'; completeLevel(); }
      return undefined;
    case 'baked': return { state: BAKED.state, bytes: BAKED.bytes, names: [...world.bakedNames], loaded: BAKED.sets ? Object.keys(BAKED.sets) : [] }; // baked texture status, for tests
    case 'drink': startDrink(arg); return undefined;
    case 'torch': // { attached, on } to set; returns the torch state either way (headless tests and screenshots)
      if (arg && arg.attached !== undefined) { S.torch.attached = !!arg.attached; if (S.torch.attached) S.attach = null; }
      if (arg && arg.on !== undefined) { S.torch.on = !!arg.on; S.torch.k = S.torch.on ? 1 : 0; }
      return { ...S.torch, attach: S.attach ? { ...S.attach } : null, dark: world.dark };
    case 'save': S.save = store.clean({ ...S.save, ...arg }); store.save(S.save); return undefined; // set progress for tests
    case 'mobile': mobileBrowser = !!arg; return undefined; // pretend the browser is (or is not) a mobile one
    case 'setting': Object.assign(S.settings, arg); return undefined; // { input: 'pc' | 'mobile' | null, sens }
    case 'mouse': S.mouseTest = arg ? { dx: 0, dy: 0, wheel: 0, down: false, ...arg } : null; return undefined; // inject mouse input
    case 'spawn': { // add a robot of any kind to the running game (not used by any level); returns its index in S.enemies
      const area = arg.area ? { id: arg.area } : world.areaAt(arg.x, arg.z) || { id: '_test' };
      spawnEnemy(area, { kind: arg.kind, x: arg.x, z: arg.z, yaw: arg.yaw || 0 });
      S.totalEnemies++;
      return S.enemies.length - 1;
    }
    case 'hitEnemy': { // headless combat checks: damage enemy arg.i as if shot from (arg.fx, arg.fz); returns the hp it lost
      const e = S.enemies[arg.i];
      const hp0 = e.hp;
      damageEnemy(e, arg.amount, !!arg.head, arg.fx, arg.fz, arg.knock || 0, arg.opts || {});
      return hp0 - e.hp;
    }
    case 'stats': {
      const w = WEAPONS[S.player.weapon];
      return {
        fireInterval: w.interval / mult().fire, damageMult: mult().damage, maxHealth: S.player.maxHealth, weapon: w.id, clip: S.player.ammo[w.id],
        input: inputMode(), sens: S.settings.sens, reloading: S.player.reloadT > 0, fov: R ? R.camera.fov : null, aspect: R ? R.camera.aspect : null, buffs: { ...S.buffs }, drinking: S.drink ? S.drink.id : null, laser: !!S.laser, yaw: S.player.yaw, third: S.camK > 0.5, camK: S.camK, health: S.player.health,
      };
    }
    default: return undefined;
  }
}
