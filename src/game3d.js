// Freddie's Last Set, first-person edition. Level 1: the Cowgate.
// Owns the state machine, player, weapons, robots, projectiles, areas and doors, and the three.js renderer.
// Content lives in data.js, the level in world.js, meshes in models.js, 2D drawing in hud.js and screens.js.
// Contract for all of those: docs/fps-design.md.

import * as THREE from '../vendor/three.module.min.js';
import * as audio from './audio.js';
import { WALL_H, EYE, PLAYER_R, COLOURS } from './consts.js';
import { buildWorld } from './world.js';
import {
  makeRobot, makeWeaponModel, makeWeaponPickup, makeHealthPickup, makeProjectile, makeMuzzleFlash, makeImpact,
} from './models.js';
import * as hud from './hud.js';
import * as screens from './screens.js';
import { WEAPONS, WEAPON_ORDER, ENEMY_DEFS, PLAYER, LEVEL, AREA_HINTS, DEATH_LINES } from './data.js';

const TAU = Math.PI * 2;
const HURT_DUR = 0.38; // matches the hurt animation length in models.js
const BEST_KEY = 'mobilegame.fps.best';
const DEBUG_KEY = 'mobilegame.debugMode';
// Debug mode is a testing aid for Freddie only. It must never feed back into balance: enemies, weapons' base stats,
// areas and everything in data.js are tuned for normal mode alone.
const DEBUG_MULT = { fire: 2, damage: 2, health: 2 };
const NORMAL_MULT = { fire: 1, damage: 1, health: 1 };

const S = {
  mode: 'title', // title | controls | intro | play | dead | complete
  t: 0,
  runT: 0,
  introT: 0,
  deadT: 0,
  completeT: 0,
  debugMode: false,
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

const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// ---- lifecycle ----

export function init(view) {
  S.view = view;
  S.best = Number(read(BEST_KEY)) || 0;
  S.debugMode = read(DEBUG_KEY) === true;
  world = buildWorld();
  for (const d of world.doors) initialOpen[d.id] = d.open;
  flow = world.createFlowField();
  if (typeof document !== 'undefined' && document.getElementById('gl')) initRender(view);
  resetLevel();
  S.mode = 'title';
}

export function resize(view) {
  S.view = view;
  if (!R) return;
  R.renderer.setPixelRatio(Math.min(view.dpr, 2));
  R.renderer.setSize(view.w, view.h, false);
  R.camera.aspect = view.w / view.h;
  R.camera.updateProjectionMatrix();
  R.wcam.aspect = view.w / view.h;
  R.wcam.updateProjectionMatrix();
}

export function gesture() {
  audio.unlock();
}

function initRender(view) {
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.autoClear = false;
  renderer.setClearColor(COLOURS.bg, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(world.fog.colour);
  scene.fog = new THREE.Fog(world.fog.colour, world.fog.near, world.fog.far);
  scene.add(new THREE.HemisphereLight(world.ambient.sky, world.ambient.ground, world.ambient.intensity));
  scene.add(world.group);
  const camera = new THREE.PerspectiveCamera(85, view.w / view.h, 0.05, 80);
  camera.rotation.order = 'YXZ';
  const torch = new THREE.PointLight(0xfff0dd, 1.2, 15, 1.6);
  camera.add(torch);
  scene.add(camera);

  // The weapon is drawn in its own pass with a cleared depth buffer so it never clips into walls.
  const wscene = new THREE.Scene();
  wscene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(0.5, 1, 0.6);
  wscene.add(sun);
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

  const impacts = [];
  for (let i = 0; i < 24; i++) {
    const o = makeImpact();
    o.visible = false;
    scene.add(o);
    impacts.push({ obj: o, t: 0 });
  }

  R = { renderer, scene, camera, torch, wscene, wcam, wroot, models, flashes, impacts, explosions: [], flashT: 0, muzzleT: 0 };
  resize(view);
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

  for (const def of world.pickups) {
    const mesh = def.kind === 'weapon' ? makeWeaponPickup(def.item) : makeHealthPickup();
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
  flowT = 0;
  flow.update(S.player.x, S.player.z);
}

function toTitle() {
  S.mode = 'title';
  resetLevel();
  audio.setMood(0.1, false);
}

function beginRun() {
  audio.unlock();
  resetLevel();
  S.mode = 'intro';
  S.introT = 0;
  audio.setLevel(0);
}

// ---- enemies ----

function spawnEnemy(area, sp) {
  const def = ENEMY_DEFS[sp.kind];
  const robot = makeRobot(sp.kind);
  robot.group.position.set(sp.x, 0, sp.z);
  robot.group.rotation.y = sp.yaw;
  if (R) R.scene.add(robot.group);
  S.enemies.push({
    kind: sp.kind, def, robot, x: sp.x, z: sp.z, yaw: sp.yaw, hp: def.hp, maxHp: def.hp, r: robot.radius, h: robot.height,
    headY: robot.headY, areaId: area.id, state: 'idle', stateT: 0, animT: rand(0, 5), cool: rand(0.3, 1),
    wakeDelay: -1, checkT: rand(0, 0.2), kx: 0, kz: 0, hurtT: 0, flashT: 0, deadT: 0, dead: false,
    strafe: Math.random() < 0.5 ? 1 : -1, acted: false, boss: sp.kind === 'bouncer',
  });
}

function wake(e, delay = 0) {
  if (e.state !== 'idle' || e.wakeDelay >= 0) return;
  e.wakeDelay = delay;
}

function wakeArea(areaId, exceptE) {
  for (const o of S.enemies) if (o !== exceptE && o.areaId === areaId && o.state === 'idle') wake(o, rand(0.15, 0.7));
}

// A gunshot or a shout: idle robots close enough, with a way to reach Freddie, come looking.
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

function damageEnemy(e, amount, head, fromX, fromZ, knock) {
  if (e.dead) return;
  e.hp -= amount;
  e.flashT = 0.08;
  e.hurtT = HURT_DUR;
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

function killEnemy(e) {
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
}

function updateEnemy(e, dt) {
  const p = S.player;
  const def = e.def;
  e.animT += dt;
  e.cool = Math.max(0, e.cool - dt);
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

  // knockback
  if (Math.abs(e.kx) + Math.abs(e.kz) > 0.05) {
    const mv = world.moveCircle(e.x, e.z, e.kx * dt, e.kz * dt, e.r);
    e.x = mv.x;
    e.z = mv.z;
    const decay = Math.exp(-dt * 7);
    e.kx *= decay;
    e.kz *= decay;
  }

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
      const sp = def.speed * dt * ((d < def.keepMin || los) ? 0.8 : 1);
      if (dirx || dirz) {
        const mv = world.moveCircle(e.x, e.z, dirx * sp, dirz * sp, e.r);
        e.x = mv.x;
        e.z = mv.z;
        moving = true;
      }
      e.robot.setPose(moving ? 'walk' : 'idle', e.animT, 0);
      if (e.hurtT > 0) e.robot.setPose('hurt', HURT_DUR - e.hurtT, 1 - e.hurtT / HURT_DUR);
      if (los && d < def.range && e.cool <= 0 && e.stateT > 0.4) {
        e.state = 'aim';
        e.stateT = 0;
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
        fireBottle(e);
      }
      if (e.stateT >= def.shoot) {
        e.state = 'chase';
        e.stateT = 0;
        e.cool = rand(def.shotInterval[0], def.shotInterval[1]);
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
        const mv = world.moveCircle(e.x, e.z, dirx * def.speed * dt, dirz * def.speed * dt, e.r);
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

  e.yaw += clamp(wrap(face - e.yaw), -7 * dt, 7 * dt);
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
      const wa = A.boss ? 0.2 : 1;
      const wb = B.boss ? 0.2 : 1;
      let mv = world.moveCircle(A.x, A.z, (-dx / d) * push * wa, (-dz / d) * push * wa, A.r);
      A.x = mv.x;
      A.z = mv.z;
      mv = world.moveCircle(B.x, B.z, (dx / d) * push * wb, (dz / d) * push * wb, B.r);
      B.x = mv.x;
      B.z = mv.z;
    }
  }
}

function fireBottle(e) {
  const p = S.player;
  const dx = p.x - e.x;
  const dz = p.z - e.z;
  const d = Math.hypot(dx, dz) || 1;
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

// ---- player ----

function hurtPlayer(amount, srcX, srcZ, melee) {
  const p = S.player;
  if (S.mode !== 'play' || p.health <= 0) return;
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
    write(BEST_KEY, S.best);
  }
  audio.gameOver();
}

function completeLevel() {
  S.mode = 'complete';
  S.completeT = 0;
  S.newBest = false;
  S.score += Math.max(0, Math.round((300 - S.runT) * 10));
  if (!S.debugMode && S.score > S.best) {
    S.best = S.score;
    S.newBest = true;
    write(BEST_KEY, S.best);
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

// Reads the touches: assigns each to the move box, the look box or a button on first contact, then
// returns { mx, mz (move, -1..1), yawD, pitchD, firing, reload, swap }.
function readControls(input, view, dt) {
  const L = layoutFor(view);
  const out = { mx: 0, mz: 0, yawD: 0, pitchD: 0, firing: false, reload: false, swap: false };
  let moveTaken = false;
  let lookTaken = false;
  for (const t of input.touches.values()) {
    if (t.role === 'move') moveTaken = true;
    else if (t.role === 'look') lookTaken = true;
  }
  for (const t of input.touches.values()) {
    if (t.role) continue;
    if (inRect(t.sx, t.sy, L.reloadHit)) { t.role = 'btn'; out.reload = true; }
    else if (inRect(t.sx, t.sy, L.swapHit)) { t.role = 'btn'; out.swap = true; }
    else if (!moveTaken && inRect(t.sx, t.sy, L.moveHit)) { t.role = 'move'; moveTaken = true; }
    else if (!lookTaken && inRect(t.sx, t.sy, L.lookHit)) { t.role = 'look'; lookTaken = true; }
    else t.role = 'none';
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
  const ky = (k.has('arrowleft') ? 1 : 0) - (k.has('arrowright') ? 1 : 0);
  const kp = (k.has('arrowup') ? 1 : 0) - (k.has('arrowdown') ? 1 : 0);
  out.yawD += ky * 2.2 * dt;
  out.pitchD += kp * 1.6 * dt;
  if (k.has(' ')) out.firing = true;
  if (k.has('r') && !S.keyR) out.reload = true;
  if (k.has('q') && !S.keyQ) out.swap = true;
  S.keyR = k.has('r');
  S.keyQ = k.has('q');
  ui.firing = out.firing;
  return out;
}

// ---- weapons ----

function startReload() {
  const p = S.player;
  const w = WEAPONS[p.weapon];
  if (p.reloadT > 0 || p.ammo[p.weapon] >= w.clip) return;
  p.reloadT = w.reload;
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
  const m = mult();
  p.ammo[p.weapon]--;
  p.fireT = w.interval / m.fire;
  p.kick = Math.min(1, p.kick + w.kick * 8);
  S.shots++;
  audio.shoot(w.id);
  alertNear(p.x, p.z, w.noise);
  if (R) {
    R.muzzleT = 0.06;
    R.flashT = 0.05;
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
      damageEnemy(hit.enemy, w.damage * m.damage * (head ? 2 : 1), head, p.x, p.z, w.knock / w.pellets * (w.pellets > 1 ? 2 : 1));
      spark(hit.x, hit.y, hit.z);
    } else if (hit.t < w.range - 0.01) {
      spark(hit.x - d.x * 0.05, hit.y - d.y * 0.05, hit.z - d.z * 0.05);
    }
  }
}

function launchRocket(w) {
  const p = S.player;
  const f = forward3(p.yaw, p.pitch);
  const mesh = makeProjectile('rocket');
  const sx = p.x + f.x * 0.7 + Math.cos(p.yaw) * 0.25;
  const sy = EYE - 0.2 + f.y * 0.7;
  const sz = p.z + f.z * 0.7 - Math.sin(p.yaw) * 0.25;
  mesh.position.set(sx, sy, sz);
  mesh.rotation.order = 'YXZ';
  mesh.rotation.set(p.pitch, p.yaw, 0);
  if (R) R.scene.add(mesh);
  S.projectiles.push({
    owner: 'player', mesh, x: sx, y: sy, z: sz, vx: f.x * w.speed, vy: f.y * w.speed, vz: f.z * w.speed,
    life: 4, weapon: w, dir: f,
  });
}

function explode(pr, x, y, z) {
  const w = pr.weapon;
  const m = mult();
  audio.boom();
  S.player.shake = Math.max(S.player.shake, 0.25);
  if (R) {
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
    damageEnemy(e, w.splashDamage * fall * m.damage, false, x, z, w.knock);
  }
  alertNear(x, z, 22);
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
  if (ctl.swap) cycleWeapon();
  if (ctl.reload) startReload();
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) {
      p.reloadT = 0;
      p.ammo[p.weapon] = w.clip;
      audio.reload(true);
    }
  } else if (p.ammo[p.weapon] <= 0) {
    startReload();
  }
  if (ctl.firing && p.reloadT <= 0 && p.fireT <= 0 && p.switchT <= 0 && p.ammo[p.weapon] > 0) fire();
}

// ---- projectiles, effects, pickups, areas ----

function updateProjectiles(dt) {
  const p = S.player;
  for (const pr of S.projectiles) {
    pr.life -= dt;
    const step = Math.hypot(pr.vx, pr.vy, pr.vz) * dt;
    const d = { x: pr.vx * dt / step, y: pr.vy * dt / step, z: pr.vz * dt / step };
    if (pr.owner === 'player') {
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
    if (Math.hypot(pk.def.x - p.x, pk.def.z - p.z) > 1.2) continue;
    if (pk.def.kind === 'health') {
      if (p.health >= p.maxHealth) continue;
      p.health = Math.min(p.maxHealth, p.health + PLAYER.medkit * mult().health);
      toast('MEDKIT');
    } else {
      const w = WEAPONS[pk.def.item];
      if (p.owned[w.id]) continue;
      p.owned[w.id] = true;
      p.ammo[w.id] = w.clip;
      selectWeapon(w.id);
      toast(`${w.name} PICKED UP`);
    }
    pk.taken = true;
    pk.mesh.visible = false;
    audio.pickup();
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
      if (!S.banner) S.banner = { title: here.name, sub: AREA_HINTS[here.id] || here.objective, t: 2.8, max: 2.8 };
    }
  }
  S.allClear = S.areas.every((a) => a.cleared);
  if (S.allClear && Math.hypot(p.x - world.exit.x, p.z - world.exit.z) < world.exit.r) completeLevel();
}

// ---- update ----

function stateFor(mode) {
  switch (mode) {
    case 'title': return { t: S.t, debugMode: S.debugMode, best: S.best };
    case 'controls': return { t: S.t };
    case 'dead': return { t: S.deadT, line: S.deadLine, score: S.score, best: S.best, newBest: S.newBest, debugMode: S.debugMode, levelName: LEVEL.name };
    case 'complete':
      return {
        t: S.completeT, score: S.score, best: S.best, newBest: S.newBest, timeSec: S.runT, kills: S.kills,
        totalEnemies: S.totalEnemies, debugMode: S.debugMode,
      };
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
    switch (b.id) {
      case 'new': S.mode = 'controls'; break;
      case 'back': S.mode = 'title'; break;
      case 'start': beginRun(); break;
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

export function update(dt, input, view) {
  S.view = view;
  S.t += dt;
  audio.tick();
  world.update(dt, S.t);
  if (S.banner && (S.banner.t -= dt) <= 0) S.banner = null;
  if (S.toast && (S.toast.t -= dt) <= 0) S.toast = null;
  S.hitMarker = Math.max(0, S.hitMarker - dt * 5);

  switch (S.mode) {
    case 'title':
    case 'controls':
    case 'dead':
    case 'complete':
      if (S.mode === 'dead') S.deadT += dt;
      if (S.mode === 'complete') S.completeT += dt;
      if (S.mode === 'dead' || S.mode === 'complete') {
        for (const e of S.enemies) if (e.state === 'dead') updateEnemy(e, dt);
      }
      handlePresses(input, view);
      audio.setMood(S.mode === 'title' || S.mode === 'controls' ? 0.1 : 0.4, S.mode === 'dead');
      break;
    case 'intro':
      S.introT += dt;
      if (S.introT > 3.2 || (S.introT > 0.8 && input.pressed.length)) S.mode = 'play';
      break;
    default:
      updatePlay(dt, input, view);
  }
}

function updatePlay(dt, input, view) {
  const p = S.player;
  S.runT += dt;
  const ctl = readControls(input, view, dt);

  // look
  p.yaw = wrap(p.yaw + ctl.yawD);
  p.pitch = clamp(p.pitch + ctl.pitchD, -1.2, 1.2);

  // move: forward is (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw)
  const sp = PLAYER.speed;
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

  updateWeapon(dt, ctl);

  flowT -= dt;
  if (flowT <= 0) {
    flowT = 0.25;
    flow.update(p.x, p.z);
  }
  for (const e of S.enemies) updateEnemy(e, dt);
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

const hudState = {
  health: 0, maxHealth: 0, hurt: 0, damageDirs: null, weapon: { id: '', name: '', clip: 0, clipSize: 0, reload: null },
  weapons: null, hitMarker: 0, headshot: false, toast: null, banner: null, objective: '', enemiesLeft: 0, areaName: '',
  boss: null, score: 0, timeSec: 0, debugMode: false, move: null, look: null, firing: false,
};

function buildHudState() {
  const p = S.player;
  const w = WEAPONS[p.weapon];
  const h = hudState;
  h.health = Math.ceil(p.health);
  h.maxHealth = p.maxHealth;
  h.hurt = p.hurt;
  h.damageDirs = S.damageDirs;
  h.weapon = { id: w.id, name: w.name, clip: p.ammo[w.id], clipSize: w.clip, reload: p.reloadT > 0 ? 1 - p.reloadT / w.reload : null };
  h.weapons = WEAPON_ORDER.map((id) => ({ id, name: WEAPONS[id].name, owned: !!p.owned[id], active: id === p.weapon }));
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
  h.move = S.ui.move;
  h.look = S.ui.look;
  h.firing = S.ui.firing;
  return h;
}

function placeCamera() {
  const { camera } = R;
  const p = S.player;
  if (S.mode === 'title' || S.mode === 'controls') {
    // slow drift through the dance floor as a backdrop for the menus
    const a = world.areas.find((x) => x.id === 'dancefloor') || world.areas[0];
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
  const sh = p.shake * p.shake * 0.5;
  camera.position.set(p.x + (Math.random() - 0.5) * sh * 0.3, y, p.z + (Math.random() - 0.5) * sh * 0.3);
  camera.rotation.set(p.pitch + (Math.random() - 0.5) * sh * 0.2, p.yaw, roll + (Math.random() - 0.5) * sh * 0.2);
}

function animateWorld() {
  for (const e of S.enemies) {
    e.robot.group.position.set(e.x, 0, e.z);
    e.robot.group.rotation.y = e.yaw;
    if (e.state === 'dead' && e.deadT > 3.5) e.robot.group.visible = false;
  }
}

function animateViewmodel(dt) {
  const p = S.player;
  const { models, flashes, wroot } = R;
  for (const id of WEAPON_ORDER) models[id].visible = id === p.weapon && (S.mode === 'play' || S.mode === 'intro');
  const w = WEAPONS[p.weapon];
  const bobX = Math.cos(p.bobT * 0.5) * 0.012 * p.moveMag;
  const bobY = Math.abs(Math.sin(p.bobT * 0.5)) * 0.014 * p.moveMag;
  const reloading = p.reloadT > 0 ? 1 - p.reloadT / w.reload : 0;
  const dip = Math.sin(reloading * Math.PI);
  const sw = p.switchT / 0.25;
  const baseX = p.weapon === 'launcher' ? 0.05 : 0.07;
  wroot.position.set(baseX + bobX, -0.2 + bobY - dip * 0.22 - sw * 0.4, -0.58 + p.kick * 0.09);
  wroot.rotation.set(0.03 + p.kick * 0.22 + dip * 0.7, 0.07 + dip * -0.25, dip * 0.2);
  R.muzzleT = Math.max(0, R.muzzleT - dt);
  for (const id of WEAPON_ORDER) {
    flashes[id].visible = id === p.weapon && R.muzzleT > 0;
    if (flashes[id].visible) flashes[id].rotation.z = Math.random() * TAU;
  }
  R.flashT = Math.max(0, R.flashT - dt);
  R.torch.intensity = 1.2 + (R.flashT > 0 ? 2.5 : 0);
}

export function render(ctx, view, alpha) {
  const dtv = 1 / 60;
  ctx.clearRect(0, 0, view.w, view.h);
  if (!R) return;
  placeCamera();
  animateWorld();
  animateViewmodel(dtv);
  R.renderer.clear();
  R.renderer.render(R.scene, R.camera);
  if (S.mode === 'play' || S.mode === 'intro') {
    R.renderer.clearDepth();
    R.renderer.render(R.wscene, R.wcam);
  }

  switch (S.mode) {
    case 'title':
      screens.drawTitle(ctx, view, stateFor('title'));
      break;
    case 'controls':
      screens.drawControls(ctx, view, stateFor('controls'));
      break;
    case 'intro':
      screens.drawIntro(ctx, view, { t: S.introT, level: LEVEL });
      break;
    case 'dead':
      hud.drawPlayHud(ctx, view, buildHudState());
      screens.drawDead(ctx, view, stateFor('dead'));
      break;
    case 'complete':
      screens.drawComplete(ctx, view, stateFor('complete'));
      break;
    default:
      hud.drawPlayHud(ctx, view, buildHudState());
  }
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
    case 'title': toTitle(); return undefined;
    case 'teleport': S.player.x = arg.x; S.player.z = arg.z; if (arg.yaw !== undefined) S.player.yaw = arg.yaw; return undefined;
    case 'killArea':
      for (const e of S.enemies) if (e.areaId === arg && !e.dead) damageEnemy(e, 1e6, false, e.x, e.z, 0);
      return undefined;
    case 'giveWeapons':
      for (const id of WEAPON_ORDER) { S.player.owned[id] = true; S.player.ammo[id] = WEAPONS[id].clip; }
      return undefined;
    case 'layout': return layoutFor(v);
    case 'hurt': hurtPlayer(arg, S.player.x, S.player.z + 5, false); return undefined;
    case 'stats': {
      const w = WEAPONS[S.player.weapon];
      return { fireInterval: w.interval / mult().fire, damageMult: mult().damage, maxHealth: S.player.maxHealth, weapon: w.id, clip: S.player.ammo[w.id], reloading: S.player.reloadT > 0 };
    }
    default: return undefined;
  }
}
