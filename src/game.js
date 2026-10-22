// Freddie's Last Set: top-down horror shooter set in Edinburgh.
// Five levels, each survived until dawn and ended by a boss, with an upgrade pick in between.
// Left thumb moves, right thumb aims and fires. Content lives in levels.js, drawing in draw.js.

import * as audio from './audio.js';
import { ENEMIES, BOSSES, LEVELS, UPGRADES, TOASTS, DEATH_LINES, WIN_LINES } from './levels.js';
import {
  text, rrect, heart, drawFloor, drawObstacle, drawLampGlow, drawFreddie, drawEnemy, drawBoss,
  drawEyes, drawBullet, drawNote, drawSkyline,
} from './draw.js';

const STICK_R = 60;
const DEAD = 0.2;
// Touch aiming is far less precise than a mouse, so Freddie gets help: shots bend towards a nearby enemy,
// and he fires on his own at anything that gets close while the right thumb is off the screen.
const ASSIST_CONE = 0.5; // radians either side of the aim direction
const ASSIST_PULL = 0.85; // 1 = snap fully onto the target
const ASSIST_RANGE = 420;
const AUTO_RANGE = 230;
const BASE_INTERVAL = 0.15;
const BASE_HP = 5;
const BASE_SPEED = 215;
const SAVE_KEY = 'mobilegame.save';
const BEST_KEY = 'mobilegame.best';
const LAST = LEVELS.length - 1;

const S = {
  mode: 'title', // title | intro | play | clear | upgrade | dead | win
  t: 0,
  level: 0,
  levelT: 0,
  introT: 0,
  clearT: 0,
  deadT: 0,
  winT: 0,
  score: 0,
  levelStartScore: 0,
  best: 0,
  newBest: false,
  save: null,
  ups: {},
  st: null,
  shots: 0,
  kills: 0,
  spawnTimer: 0,
  toastIdx: 0,
  bossSpawned: false,
  bossDead: false,
  boss: null,
  banner: null,
  toast: null,
  deadLine: '',
  offers: [],
  shake: 0,
  hurtFlash: 0,
  dawnFlash: 0,
  player: null,
  enemies: [],
  bullets: [],
  ebul: [],
  parts: [],
  pickups: [],
  obs: [],
  rain: [],
  sticks: { move: null, aim: null },
  view: null,
};

export const getState = () => S; // exposed under ?debug for the smoke test

// ---- helpers ----

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, k) => a + (b - a) * k;
const pad2 = (n) => String(n).padStart(2, '0');
const font = (s, w) => `${w} ${s}px system-ui, -apple-system, sans-serif`;

function removeIf(arr, pred) {
  let j = 0;
  for (let i = 0; i < arr.length; i++) if (!pred(arr[i])) arr[j++] = arr[i];
  arr.length = j;
}

function arena(view) {
  return { x0: 12, y0: view.safe.top + 64, x1: view.w - 12, y1: view.h - view.safe.bottom - 12 };
}

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
}

const zeroUps = () => Object.fromEntries(UPGRADES.map((u) => [u.id, 0]));

function stats() {
  const u = S.ups;
  return {
    interval: BASE_INTERVAL * 0.78 ** u.rate,
    shots: 1 + u.twin,
    pierce: u.pierce,
    dmg: 1 + u.dmg,
    maxHp: BASE_HP + u.hp,
    speed: BASE_SPEED * (1 + 0.12 * u.speed),
    light: 1 + 0.25 * u.torch,
  };
}

function layoutObstacles(view) {
  const a = arena(view);
  S.obs = LEVELS[S.level].obstacles.map(([fx, fy, r, kind]) => ({
    x: a.x0 + fx * (a.x1 - a.x0), y: a.y0 + fy * (a.y1 - a.y0), r, kind,
  }));
}

function newPlayer(view) {
  const a = arena(view);
  return {
    x: (a.x0 + a.x1) / 2, y: a.y0 + (a.y1 - a.y0) * 0.82, vx: 0, vy: 0, r: 16,
    hp: S.st.maxHp, aim: -Math.PI / 2, fireT: 0, hurtT: 0,
  };
}

// Pushes a circle out of any obstacle. Returns true if it touched one.
function pushOut(ent) {
  let hit = false;
  for (const o of S.obs) {
    let dx = ent.x - o.x;
    let dy = ent.y - o.y;
    let d = Math.hypot(dx, dy);
    const min = o.r + ent.r;
    if (d < min) {
      if (d < 1e-3) { dx = 1; dy = 0; d = 1; }
      ent.x += (dx / d) * (min - d);
      ent.y += (dy / d) * (min - d);
      hit = true;
    }
  }
  return hit;
}

// ---- lifecycle ----

export function init(view) {
  S.view = view;
  S.best = Number(read(BEST_KEY)) || 0;
  S.save = read(SAVE_KEY);
  S.ups = zeroUps();
  S.st = stats();
  S.level = 0;
  S.player = newPlayer(view);
  layoutObstacles(view);
  initRain(view);
}

export function resize(view) {
  S.view = view;
  if (!S.player) return;
  layoutObstacles(view);
  const a = arena(view);
  S.player.x = clamp(S.player.x, a.x0 + S.player.r, a.x1 - S.player.r);
  S.player.y = clamp(S.player.y, a.y0 + S.player.r, a.y1 - S.player.r);
}

export function gesture() {
  audio.unlock();
}

function initRain(view) {
  S.rain = Array.from({ length: LEVELS[S.level].rain ? 70 : 0 }, () => ({ x: rand(0, view.w), y: rand(0, view.h), s: rand(0.8, 1.3) }));
}

function newGame(view) {
  audio.unlock();
  S.ups = zeroUps();
  S.st = stats();
  S.score = 0;
  S.kills = 0;
  beginLevel(0, view);
}

function continueGame(view) {
  audio.unlock();
  S.ups = { ...zeroUps(), ...S.save.ups };
  S.st = stats();
  S.score = S.save.score || 0;
  beginLevel(clamp(S.save.level || 0, 0, LAST), view);
}

function beginLevel(idx, view) {
  S.level = idx;
  S.levelStartScore = S.score;
  S.levelT = 0;
  S.introT = 0;
  S.mode = 'intro';
  S.boss = null;
  S.bossSpawned = false;
  S.bossDead = false;
  S.spawnTimer = 2.5;
  S.toastIdx = 0;
  S.toast = null;
  S.banner = null;
  S.enemies.length = S.bullets.length = S.ebul.length = S.parts.length = S.pickups.length = 0;
  S.player = newPlayer(view);
  layoutObstacles(view);
  initRain(view);
  audio.setLevel(idx);
  S.save = { level: idx, ups: { ...S.ups }, score: S.score };
  write(SAVE_KEY, S.save);
}

function recordBest() {
  if (S.score > S.best) {
    S.best = S.score;
    S.newBest = true;
    write(BEST_KEY, S.best);
  }
}

function die() {
  S.mode = 'dead';
  S.deadT = 0;
  S.shake = 0.6;
  S.newBest = false;
  S.deadLine = DEATH_LINES[Math.floor(Math.random() * DEATH_LINES.length)];
  recordBest();
  burst(S.player.x, S.player.y, '#7c3aed', 40, 260);
  audio.gameOver();
}

function clearLevel() {
  const L = LEVELS[S.level];
  const bonus = 100 * (S.level + 1);
  S.score += bonus;
  S.mode = 'clear';
  S.clearT = 0;
  S.dawnFlash = 1;
  S.banner = { title: S.level === LAST ? 'DAWN' : 'LEVEL CLEAR', sub: `${L.name}   +${bonus}`, t: 2.6, max: 2.6 };
  for (const e of S.enemies) burst(e.x, e.y, '#c9c2e0', 10, 160);
  S.enemies.length = S.ebul.length = 0;
  audio.dawn();
}

function openUpgrades() {
  const pool = UPGRADES.filter((u) => S.ups[u.id] < u.max);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  S.offers = pool.slice(0, 3);
  S.mode = 'upgrade';
}

function win() {
  S.mode = 'win';
  S.winT = 0;
  S.newBest = false;
  recordBest();
  S.save = null;
  write(SAVE_KEY, null);
}

// ---- spawning ----

// A point just off screen, at least 320px from Freddie so nothing appears on top of him.
function spawnPoint(view, m) {
  const p = S.player;
  let x = 0;
  let y = 0;
  for (let i = 0; i < 8; i++) {
    const side = Math.floor(Math.random() * 4);
    x = side === 0 ? -m : side === 1 ? view.w + m : rand(0, view.w);
    y = side === 2 ? -m : side === 3 ? view.h + m : rand(0, view.h);
    if (Math.hypot(x - p.x, y - p.y) > 320) break;
  }
  return { x, y };
}

function spawnEnemy(type, view, x, y) {
  const k = ENEMIES[type];
  const hpScale = 1 + S.level * 0.12;
  if (x === undefined) ({ x, y } = spawnPoint(view, k.r + 30));
  const hp = Math.ceil(k.hp * hpScale);
  S.enemies.push({
    type, x, y, kx: 0, ky: 0, r: k.r, hp, maxHp: hp, speed: k.speed * (1 + S.level * 0.035) * rand(0.9, 1.1),
    score: k.score, colour: k.colour, accent: k.accent, ai: k.ai, phase: rand(0, 6.28), ang: 0, flash: 0,
    dead: false, boss: false, inside: false, shootT: rand(1, 2.2),
  });
}

function spawnFromMix(prog, view) {
  const L = LEVELS[S.level];
  const mix = L.mix.filter((m) => prog >= m[2]);
  let roll = Math.random() * mix.reduce((s, m) => s + m[1], 0);
  let type = mix[0][0];
  for (const m of mix) {
    roll -= m[1];
    if (roll <= 0) { type = m[0]; break; }
  }
  const pack = ENEMIES[type].pack || 1;
  const { x: px, y: py } = spawnPoint(view, 40);
  for (let i = 0; i < pack; i++) spawnEnemy(type, view, px + rand(-18, 18), py + rand(-18, 18));
}

function spawnBoss(view) {
  const id = LEVELS[S.level].boss;
  const def = BOSSES[id];
  const cd = {};
  for (const [k, v] of Object.entries(def.abilities)) cd[k] = v.every * 0.8;
  const e = {
    type: 'boss', bossId: id, def, boss: true, x: view.w / 2, y: -def.r - 20, kx: 0, ky: 0, r: def.r,
    hp: def.hp, maxHp: def.hp, speed: def.speed, score: def.score, colour: def.colour, ai: 'boss',
    phase: 0, ang: Math.PI / 2, flash: 0, dead: false, inside: false, state: 'walk', stateT: 0, dx: 0, dy: 0, cd,
  };
  S.enemies.push(e);
  S.boss = e;
  S.bossSpawned = true;
  S.banner = { title: def.name, sub: `"${def.quote}"`, t: 3, max: 3 };
  audio.boom();
}

function burst(x, y, colour, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, 6.28);
    const s = rand(0.2, 1) * speed;
    S.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.6), max: 0.6, r: rand(1.5, 4), colour });
  }
}

function fireNote(x, y, ang, speed, life = 3.5) {
  S.ebul.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life, r: 6, ang, dead: false });
}

// ---- input ----

function readSticks(input, view) {
  let move = null;
  let aim = null;
  for (const t of input.touches.values()) {
    if (!t.role) {
      const side = t.sx < view.w / 2 ? 'move' : 'aim';
      let taken = false;
      for (const o of input.touches.values()) if (o !== t && o.role === side) taken = true;
      t.role = taken ? 'none' : side;
    }
    if (t.role === 'move') move = t;
    else if (t.role === 'aim') aim = t;
  }
  S.sticks.move = move;
  S.sticks.aim = aim;
}

// Unit direction plus 0..1 magnitude. The stick base follows if the thumb drifts far away.
function stickVec(t) {
  if (!t) return { x: 0, y: 0, mag: 0 };
  const dx = t.x - t.sx;
  const dy = t.y - t.sy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return { x: 0, y: 0, mag: 0 };
  const far = STICK_R * 1.5;
  if (len > far) {
    t.sx += (dx / len) * (len - far);
    t.sy += (dy / len) * (len - far);
  }
  const mag = Math.min(1, len / STICK_R);
  return { x: dx / len, y: dy / len, mag: mag < DEAD ? 0 : mag };
}

function moveVec(input) {
  const v = stickVec(S.sticks.move);
  if (v.mag > 0) return { x: v.x * v.mag, y: v.y * v.mag, mag: v.mag, ux: v.x, uy: v.y };
  const k = input.keys;
  const kx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
  const ky = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
  const len = Math.hypot(kx, ky);
  if (!len) return { x: 0, y: 0, mag: 0, ux: 0, uy: 0 };
  return { x: kx / len, y: ky / len, mag: 1, ux: kx / len, uy: ky / len };
}

// ---- menus ----

// Button layout is shared by update (hit testing) and render, so the two cannot drift apart.
function buttons(view) {
  const list = [];
  const w = Math.min(view.w - 48, 300);
  const x = (view.w - w) / 2;
  const add = (id, label, y, primary = true, h = 52) => list.push({ id, label, x, y, w, h, primary });
  if (S.mode === 'title') {
    let y = view.h * 0.46;
    if (S.save) {
      add('continue', `CONTINUE  LEVEL ${S.save.level + 1}`, y);
      y += 64;
    }
    add('new', 'NEW GAME', y, !S.save);
  } else if (S.mode === 'dead' && S.deadT > 0.9) {
    add('retry', 'RETRY LEVEL', view.h * 0.6);
    add('new', 'NEW GAME', view.h * 0.6 + 64, false);
  } else if (S.mode === 'win' && S.winT > 1) {
    add('new', 'PLAY AGAIN', view.h * 0.7);
  } else if (S.mode === 'upgrade') {
    const cw = Math.min(view.w - 40, 340);
    const cx = (view.w - cw) / 2;
    S.offers.forEach((u, i) => list.push({ id: u.id, upgrade: u, x: cx, y: view.h * 0.3 + i * 112, w: cw, h: 98 }));
  }
  return list;
}

function handlePress(view, p) {
  for (const b of buttons(view)) {
    if (p.x < b.x || p.x > b.x + b.w || p.y < b.y || p.y > b.y + b.h) continue;
    audio.blip();
    if (b.id === 'new') newGame(view);
    else if (b.id === 'continue') continueGame(view);
    else if (b.id === 'retry') {
      S.score = S.levelStartScore;
      beginLevel(S.level, view);
    } else {
      S.ups[b.id]++;
      S.st = stats();
      beginLevel(S.level + 1, view);
    }
    return;
  }
}

// ---- update ----

export function update(dt, input, view) {
  S.view = view;
  S.t += dt;
  audio.tick();
  const L = LEVELS[S.level];
  const prog = S.bossSpawned ? 1 : clamp(S.levelT / L.duration, 0, 1);
  audio.setMood(clamp((S.level + prog) / LEVELS.length, 0, 1), S.mode === 'dead');
  updateParts(dt);
  S.shake = Math.max(0, S.shake - dt);
  S.hurtFlash = Math.max(0, S.hurtFlash - dt * 2);
  S.dawnFlash = Math.max(0, S.dawnFlash - dt * 0.8);
  if (S.banner && (S.banner.t -= dt) <= 0) S.banner = null;
  if (S.toast && (S.toast.t -= dt) <= 0) S.toast = null;
  for (const r of S.rain) {
    r.y += 520 * r.s * dt;
    r.x -= 110 * r.s * dt;
    if (r.y > view.h) { r.y = -10; r.x = rand(0, view.w + 100); }
  }

  switch (S.mode) {
    case 'title':
    case 'upgrade':
      for (const p of input.pressed) handlePress(view, p);
      break;
    case 'dead':
      S.deadT += dt;
      for (const p of input.pressed) handlePress(view, p);
      break;
    case 'win':
      S.winT += dt;
      for (const p of input.pressed) handlePress(view, p);
      break;
    case 'intro':
      S.introT += dt;
      if (S.introT > 2.8 || (S.introT > 0.7 && input.pressed.length)) S.mode = 'play';
      break;
    case 'clear':
      S.clearT += dt;
      if (S.clearT > 2.6) (S.level === LAST ? win : openUpgrades)();
      break;
    default:
      updatePlay(dt, input, view);
  }
}

function updatePlay(dt, input, view) {
  const L = LEVELS[S.level];
  const p = S.player;
  const st = S.st;
  if (p.hp <= 0) { die(); return; }
  const a = arena(view);

  // time, toasts and spawning
  if (!S.bossSpawned) {
    S.levelT += dt;
    const prog = S.levelT / L.duration;
    if (prog >= 1) {
      spawnBoss(view);
    } else {
      const next = TOASTS[S.toastIdx];
      if (next && prog >= next[0]) {
        S.toast = { text: next[1], t: 2.6 };
        S.toastIdx++;
      }
      S.spawnTimer -= dt;
      if (S.spawnTimer <= 0 && S.enemies.length < L.cap) {
        spawnFromMix(prog, view);
        S.spawnTimer = lerp(L.spawn[0], L.spawn[1], prog) / (1 + S.level * 0.08);
      }
    }
  }

  // Freddie
  readSticks(input, view);
  const mv = moveVec(input);
  const aimV = stickVec(S.sticks.aim);
  const k = Math.min(1, dt * 14);
  p.vx += (mv.x * st.speed - p.vx) * k;
  p.vy += (mv.y * st.speed - p.vy) * k;
  p.x = clamp(p.x + p.vx * dt, a.x0 + p.r, a.x1 - p.r);
  p.y = clamp(p.y + p.vy * dt, a.y0 + p.r, a.y1 - p.r);
  pushOut(p);
  p.hurtT = Math.max(0, p.hurtT - dt);
  p.fireT = Math.max(0, p.fireT - dt);

  let firing = false;
  const near = aimV.mag > 0 ? null : nearestEnemy(p, AUTO_RANGE);
  if (aimV.mag > 0) {
    p.aim = assistAim(Math.atan2(aimV.y, aimV.x), p);
    firing = true;
  } else if (near) {
    p.aim = Math.atan2(near.y - p.y, near.x - p.x);
    firing = true;
  } else if (mv.mag > 0) {
    p.aim = Math.atan2(mv.uy, mv.ux);
  }
  if (firing && p.fireT <= 0) {
    p.fireT = st.interval;
    for (let i = 0; i < st.shots; i++) {
      const ang = p.aim + (st.shots === 1 ? 0 : (i - (st.shots - 1) / 2) * 0.2);
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      S.bullets.push({
        x: p.x + c * 26, y: p.y + s * 26, vx: c * 560, vy: s * 560, life: 0.8, r: 6, ang,
        dmg: st.dmg, pierce: st.pierce, hits: [], dead: false,
      });
    }
    S.shots++;
    audio.shoot();
  }

  // Freddie's bullets
  for (const b of S.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || b.x < -40 || b.y < -40 || b.x > view.w + 40 || b.y > view.h + 40) b.dead = true;
    for (const o of S.obs) {
      const dx = b.x - o.x;
      const dy = b.y - o.y;
      if (dx * dx + dy * dy < o.r * o.r) b.dead = true;
    }
  }

  // enemy bullets
  for (const b of S.ebul) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || b.x < -40 || b.y < -40 || b.x > view.w + 40 || b.y > view.h + 40) b.dead = true;
    for (const o of S.obs) {
      const dx = b.x - o.x;
      const dy = b.y - o.y;
      if (dx * dx + dy * dy < o.r * o.r) b.dead = true;
    }
    if (!b.dead && p.hurtT <= 0) {
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const rr = b.r + p.r * 0.7;
      if (dx * dx + dy * dy < rr * rr) {
        b.dead = true;
        damage(1);
      }
    }
  }

  // enemies
  const en = S.enemies;
  for (const e of en) updateEnemy(e, p, dt, view, a);
  for (let i = 0; i < en.length; i++) {
    for (let j = i + 1; j < en.length; j++) {
      const A = en[i];
      const B = en[j];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const min = (A.r + B.r) * 0.9;
      const d2 = dx * dx + dy * dy;
      if (d2 === 0 || d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) * 0.5;
      // a boss shoves the crowd rather than being shoved by it
      const wa = A.boss ? 0 : B.boss ? 2 : 1;
      const wb = B.boss ? 0 : A.boss ? 2 : 1;
      A.x -= (dx / d) * push * wa;
      A.y -= (dy / d) * push * wa;
      B.x += (dx / d) * push * wb;
      B.y += (dy / d) * push * wb;
    }
  }

  // bullets vs enemies
  for (const b of S.bullets) {
    if (b.dead) continue;
    for (const e of en) {
      if (e.dead || b.hits.includes(e)) continue;
      const dx = e.x - b.x;
      const dy = e.y - b.y;
      const rr = e.r + b.r;
      if (dx * dx + dy * dy > rr * rr) continue;
      b.hits.push(e);
      e.hp -= b.dmg;
      e.flash = 0.1;
      const kb = e.boss ? 14 : 140;
      e.kx += Math.cos(b.ang) * kb;
      e.ky += Math.sin(b.ang) * kb;
      burst(b.x, b.y, '#a3c9a8', 3, 120);
      if (b.pierce <= 0) { b.dead = true; break; }
      b.pierce--;
    }
  }
  for (const e of en) {
    if (e.dead || e.hp > 0) continue;
    e.dead = true;
    S.score += e.score;
    S.kills++;
    burst(e.x, e.y, e.boss ? '#fbbf24' : '#c026d3', e.boss ? 60 : 14, e.boss ? 320 : 220);
    audio.kill();
    if (e.boss) {
      S.bossDead = true;
      S.shake = 0.6;
      audio.boom();
    } else if (p.hp < st.maxHp && Math.random() < 0.12) {
      S.pickups.push({ x: e.x, y: e.y, life: 10 });
    }
  }

  // contact damage
  if (p.hurtT <= 0) {
    for (const e of en) {
      if (e.dead) continue;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const rr = e.r + p.r * 0.75;
      if (dx * dx + dy * dy > rr * rr) continue;
      const d = Math.hypot(dx, dy) || 1;
      e.kx = (-dx / d) * (e.boss ? 60 : 300);
      e.ky = (-dy / d) * (e.boss ? 60 : 300);
      damage(e.boss && e.state === 'dash' ? 2 : 1);
      break;
    }
  }

  for (const u of S.pickups) {
    u.life -= dt;
    const dx = p.x - u.x;
    const dy = p.y - u.y;
    if (dx * dx + dy * dy < 26 * 26 && p.hp < st.maxHp) {
      p.hp++;
      u.life = 0;
      audio.pickup();
    }
  }

  removeIf(S.bullets, (b) => b.dead);
  removeIf(S.ebul, (b) => b.dead);
  removeIf(en, (e) => e.dead);
  removeIf(S.pickups, (u) => u.life <= 0);

  if (S.bossDead) clearLevel();
}

function nearestEnemy(p, range) {
  let best = null;
  let bestD = range;
  for (const e of S.enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y) - e.r;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// Pulls the aim angle towards the enemy closest to the line the thumb is pointing along.
function assistAim(angle, p) {
  let best = null;
  let bestScore = Infinity;
  let bestDiff = 0;
  for (const e of S.enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > ASSIST_RANGE) continue;
    let diff = Math.atan2(e.y - p.y, e.x - p.x) - angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    // a wider cone for close targets, where the same angular error is a bigger miss
    if (Math.abs(diff) > ASSIST_CONE * (1 + 120 / d) * 0.7) continue;
    const score = Math.abs(diff) + d / 2000;
    if (score < bestScore) { bestScore = score; best = e; bestDiff = diff; }
  }
  return best ? angle + bestDiff * ASSIST_PULL : angle;
}

function damage(n) {
  const p = S.player;
  p.hp -= n;
  p.hurtT = 1.6;
  for (const e of S.enemies) {
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 150 && !e.boss) {
      e.kx += (dx / d) * 380;
      e.ky += (dy / d) * 380;
    }
  }
  S.shake = 0.4;
  S.hurtFlash = 1;
  audio.hurt();
}

function updateEnemy(e, p, dt, view, a) {
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const nx = dx / d;
  const ny = dy / d;
  e.flash = Math.max(0, e.flash - dt);
  if (!e.inside && e.x > a.x0 && e.x < a.x1 && e.y > a.y0 && e.y < a.y1) e.inside = true;

  if (e.boss) {
    updateBoss(e, p, dt, view, a, d);
  } else {
    let vx;
    let vy;
    e.ang = Math.atan2(dy, dx);
    if (e.ai === 'ranged') {
      const dir = d > 270 ? 1 : d < 190 ? -1 : 0;
      const strafe = Math.sin(S.t * 1.2 + e.phase) * 0.5;
      vx = (nx * dir - ny * strafe) * e.speed;
      vy = (ny * dir + nx * strafe) * e.speed;
      e.shootT -= dt;
      if (e.shootT <= 0 && e.inside) {
        e.shootT = rand(2.4, 3.2);
        fireNote(e.x, e.y, e.ang, 150);
      }
    } else {
      const wob = Math.sin(S.t * 3 + e.phase) * 0.6;
      vx = (nx - ny * wob) * e.speed;
      vy = (ny + nx * wob) * e.speed;
    }
    e.x += (vx + e.kx) * dt;
    e.y += (vy + e.ky) * dt;
    if (e.ai === 'ranged' && e.inside) {
      e.x = clamp(e.x, a.x0 + e.r, a.x1 - e.r);
      e.y = clamp(e.y, a.y0 + e.r, a.y1 - e.r);
    }
  }
  const decay = 1 - Math.min(1, dt * 9);
  e.kx *= decay;
  e.ky *= decay;
  if (pushOut(e) && e.boss && e.state === 'dash') e.state = 'walk';
}

function updateBoss(e, p, dt, view, a, d) {
  const ab = e.def.abilities;
  if (e.state === 'windup') {
    e.ang = Math.atan2(p.y - e.y, p.x - e.x);
    e.stateT -= dt;
    if (e.stateT <= 0) {
      e.dx = Math.cos(e.ang);
      e.dy = Math.sin(e.ang);
      e.state = 'dash';
      e.stateT = ab.charge.dur;
      audio.whoosh();
    }
    return;
  }
  if (e.state === 'dash') {
    e.x += e.dx * ab.charge.speed * dt;
    e.y += e.dy * ab.charge.speed * dt;
    e.stateT -= dt;
    const out = e.inside && (e.x < a.x0 + e.r * 0.5 || e.x > a.x1 - e.r * 0.5 || e.y < a.y0 + e.r * 0.5 || e.y > a.y1 - e.r * 0.5);
    if (e.stateT <= 0 || out) {
      e.state = 'walk';
      if (e.inside) {
        e.x = clamp(e.x, a.x0 + e.r * 0.5, a.x1 - e.r * 0.5);
        e.y = clamp(e.y, a.y0 + e.r * 0.5, a.y1 - e.r * 0.5);
      }
    }
    return;
  }

  e.ang = Math.atan2(p.y - e.y, p.x - e.x);
  e.x += (Math.cos(e.ang) * e.speed + e.kx) * dt;
  e.y += (Math.sin(e.ang) * e.speed + e.ky) * dt;
  if (!e.inside) return; // walk on before using abilities

  for (const key of Object.keys(ab)) e.cd[key] -= dt;
  if (ab.charge && e.cd.charge <= 0) {
    e.cd.charge = ab.charge.every;
    e.state = 'windup';
    e.stateT = ab.charge.windup;
  } else if (ab.summon && e.cd.summon <= 0) {
    e.cd.summon = ab.summon.every;
    for (let i = 0; i < ab.summon.count; i++) {
      const ang = (i / ab.summon.count) * 6.283 + rand(0, 1);
      spawnEnemy(ab.summon.type, view, e.x + Math.cos(ang) * e.r * 1.4, e.y + Math.sin(ang) * e.r * 1.4);
    }
    burst(e.x, e.y, '#c9c2e0', 20, 200);
    audio.whoosh();
  } else if (ab.ring && e.cd.ring <= 0) {
    e.cd.ring = ab.ring.every;
    const off = rand(0, 6.28);
    for (let i = 0; i < ab.ring.n; i++) fireNote(e.x, e.y, off + (i / ab.ring.n) * 6.283, 130, 4);
    audio.boom();
  }
}

function updateParts(dt) {
  for (const q of S.parts) {
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    q.vx *= 0.92;
    q.vy *= 0.92;
    q.life -= dt;
  }
  removeIf(S.parts, (q) => q.life <= 0);
}

// ---- render ----

function wrap(ctx, str, maxW, size, weight) {
  ctx.font = font(size, weight);
  const lines = [];
  let line = '';
  for (const word of str.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = word;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

// Draws wrapped text and returns the height used.
function paragraph(ctx, str, x, y, maxW, size, colour, align = 'center', weight = 500, lh = size * 1.4) {
  const lines = wrap(ctx, str, maxW, size, weight);
  lines.forEach((l, i) => text(ctx, l, x, y + i * lh, size, colour, align, weight));
  return lines.length * lh;
}

function fitSize(ctx, str, maxW, size, weight) {
  ctx.font = font(size, weight);
  const w = ctx.measureText(str).width;
  return w > maxW ? Math.floor((size * maxW) / w) : size;
}

function dawnAmount() {
  const L = LEVELS[S.level];
  const prog = S.bossSpawned || S.mode === 'clear' || S.mode === 'upgrade' || S.mode === 'win' ? 1 : clamp(S.levelT / L.duration, 0, 1);
  return ((S.level + prog) / LEVELS.length) ** 2 * 0.7;
}

function drawDarkness(ctx, view, p, beat, dawn) {
  const frac = S.mode === 'play' || S.mode === 'dead' ? clamp(p.hp / S.st.maxHp, 0, 1) : 1;
  const R = (130 + 110 * frac + beat.pulse * 12) * S.st.light;
  const strobe = S.level === 0 && S.levelT > 20 && beat.count % 8 === 0 ? beat.pulse : 0;
  const dark = 0.93 - dawn * 0.55 - strobe * 0.4;
  const g = ctx.createRadialGradient(p.x, p.y, R * 0.2, p.x, p.y, R);
  g.addColorStop(0, 'rgba(4,2,8,0)');
  g.addColorStop(1, `rgba(4,2,8,${dark})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);
  if (dawn > 0.02) {
    ctx.fillStyle = `rgba(255,140,80,${dawn * 0.14})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }
}

function drawRain(ctx) {
  if (!S.rain.length) return;
  ctx.strokeStyle = 'rgba(170,190,255,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const r of S.rain) {
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x - 3, r.y + 11 * r.s);
  }
  ctx.stroke();
}

function drawSticks(ctx, view) {
  const draw = (t, colour) => {
    if (!t) return;
    const dx = t.x - t.sx;
    const dy = t.y - t.sy;
    const len = Math.hypot(dx, dy) || 1;
    const m = Math.min(len, STICK_R);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(t.sx, t.sy, STICK_R, 0, 6.283);
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(t.sx + (dx / len) * m, t.sy + (dy / len) * m, 24, 0, 6.283);
    ctx.fill();
  };
  draw(S.sticks.move, 'rgba(255,255,255,0.22)');
  draw(S.sticks.aim, 'rgba(34,211,238,0.3)');

  if (S.level === 0 && S.levelT < 8 && !S.sticks.move && !S.sticks.aim) {
    const y = view.h - view.safe.bottom - 70;
    text(ctx, 'MOVE', view.w * 0.25, y, 14, 'rgba(255,255,255,0.4)');
    text(ctx, 'AIM + FIRE', view.w * 0.75, y, 14, 'rgba(34,211,238,0.55)');
  }
}

function drawHud(ctx, view) {
  const L = LEVELS[S.level];
  const p = S.player;
  const top = view.safe.top + 26;
  const gap = S.st.maxHp > 6 ? 23 : 26;
  for (let i = 0; i < S.st.maxHp; i++) {
    heart(ctx, 22 + i * gap, top, 11);
    if (i < p.hp) {
      ctx.fillStyle = '#ff2e93';
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255,46,147,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  const prog = S.bossSpawned ? 1 : clamp(S.levelT / L.duration, 0, 1);
  const mins = Math.round(lerp(L.clock[0], L.clock[1], prog));
  text(ctx, `${pad2(Math.floor(mins / 60) % 24)}:${pad2(mins % 60)}`, view.w / 2 + 36, top, 18, 'rgba(255,255,255,0.7)', 'center', 600);
  text(ctx, String(S.score), view.w - 16, top, 22, '#ffffff', 'right');

  if (S.boss && !S.boss.dead) {
    const bw = view.w - 32;
    const y = view.safe.top + 44;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    rrect(ctx, 16, y, bw, 16, 8);
    ctx.fill();
    ctx.fillStyle = '#b91c1c';
    rrect(ctx, 16, y, Math.max(12, (bw * S.boss.hp) / S.boss.maxHp), 16, 8);
    ctx.fill();
    text(ctx, S.boss.def.name, view.w / 2, y + 8.5, 11, '#ffffff', 'center', 700);
  }

  if (S.banner) {
    ctx.globalAlpha = Math.min(1, S.banner.t / 0.8);
    const size = fitSize(ctx, S.banner.title, view.w - 40, 40, 800);
    text(ctx, S.banner.title, view.w / 2, view.h * 0.3, size, '#ff2e93', 'center', 800);
    paragraph(ctx, S.banner.sub, view.w / 2, view.h * 0.3 + 36, view.w - 56, 16, '#c9c2e0', 'center', 500);
    ctx.globalAlpha = 1;
  }
  if (S.toast) {
    ctx.globalAlpha = Math.min(1, S.toast.t / 0.6);
    text(ctx, S.toast.text, view.w / 2, view.safe.top + 86, 15, '#c9c2e0', 'center', 500);
    ctx.globalAlpha = 1;
  }
  if (S.hurtFlash > 0) {
    const g = ctx.createRadialGradient(view.w / 2, view.h / 2, view.h * 0.25, view.w / 2, view.h / 2, view.h * 0.7);
    g.addColorStop(0, 'rgba(255,0,40,0)');
    g.addColorStop(1, `rgba(255,0,40,${0.45 * S.hurtFlash})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);
  }
}

function drawButton(ctx, b) {
  rrect(ctx, b.x, b.y, b.w, b.h, 12);
  ctx.fillStyle = b.primary ? '#ff2e93' : 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.strokeStyle = b.primary ? '#ff2e93' : 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2, 17, '#ffffff', 'center', 700);
}

function drawCard(ctx, b) {
  const u = b.upgrade;
  rrect(ctx, b.x, b.y, b.w, b.h, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fill();
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, u.name, b.x + 16, b.y + 26, 18, '#22d3ee', 'left', 800);
  text(ctx, `${S.ups[u.id]}/${u.max}`, b.x + b.w - 16, b.y + 26, 13, 'rgba(255,255,255,0.5)', 'right', 600);
  paragraph(ctx, u.desc, b.x + 16, b.y + 54, b.w - 32, 13, '#d6d0ea', 'left', 500, 18);
}

function drawTitle(ctx, view) {
  const cx = view.w / 2;
  const cy = view.h * 0.18;
  drawSkyline(ctx, view.w, view.h);
  text(ctx, "FREDDIE'S", cx, cy, 52, '#ff2e93', 'center', 800);
  text(ctx, 'LAST SET', cx, cy + 54, 52, '#22d3ee', 'center', 800);
  text(ctx, 'Edinburgh. 2am. Everyone is dead.', cx, cy + 106, 15, '#c9c2e0', 'center', 500);
  for (const b of buttons(view)) drawButton(ctx, b);
  if (S.best > 0) text(ctx, `BEST ${S.best}`, cx, view.h * 0.46 - 30, 14, '#c9c2e0', 'center', 600);
  text(ctx, 'Left thumb: move   Right thumb: aim and fire', cx, view.h - view.safe.bottom - 210, 13, 'rgba(255,255,255,0.45)', 'center', 500);
}

function drawIntro(ctx, view) {
  const L = LEVELS[S.level];
  const cx = view.w / 2;
  ctx.fillStyle = 'rgba(4,2,8,0.72)';
  ctx.fillRect(0, 0, view.w, view.h);
  const a = clamp(S.introT / 0.4, 0, 1);
  ctx.globalAlpha = a;
  text(ctx, `LEVEL ${S.level + 1} OF ${LEVELS.length}`, cx, view.h * 0.3, 14, '#9fb3c8', 'center', 600);
  const size = fitSize(ctx, L.name, view.w - 40, 38, 800);
  text(ctx, L.name, cx, view.h * 0.3 + 44, size, '#ff2e93', 'center', 800);
  const mins = L.clock[0];
  text(ctx, `${pad2(Math.floor(mins / 60) % 24)}:${pad2(mins % 60)}`, cx, view.h * 0.3 + 90, 24, '#22d3ee', 'center', 700);
  let y = view.h * 0.3 + 134;
  y += paragraph(ctx, L.sub, cx, y, view.w - 64, 16, '#e5e0f5', 'center', 600);
  paragraph(ctx, L.line, cx, y + 10, view.w - 64, 15, '#9fb3c8', 'center', 500);
  if (S.introT > 0.7 && Math.floor(S.t * 1.6) % 2 === 0) text(ctx, 'TAP TO START', cx, view.h * 0.72, 18, '#ffffff');
  ctx.globalAlpha = 1;
}

function drawUpgrade(ctx, view) {
  const cx = view.w / 2;
  ctx.fillStyle = 'rgba(4,2,8,0.82)';
  ctx.fillRect(0, 0, view.w, view.h);
  text(ctx, `${LEVELS[S.level].name} SURVIVED`, cx, view.h * 0.12, fitSize(ctx, `${LEVELS[S.level].name} SURVIVED`, view.w - 40, 24, 800), '#ff2e93', 'center', 800);
  text(ctx, 'Pick an upgrade', cx, view.h * 0.12 + 36, 16, '#c9c2e0', 'center', 500);
  for (const b of buttons(view)) drawCard(ctx, b);
}

function drawDead(ctx, view) {
  const cx = view.w / 2;
  ctx.fillStyle = 'rgba(4,2,8,0.65)';
  ctx.fillRect(0, 0, view.w, view.h);
  text(ctx, 'THE SET IS OVER', cx, view.h * 0.2, fitSize(ctx, 'THE SET IS OVER', view.w - 40, 34, 800), '#ff2e93', 'center', 800);
  text(ctx, LEVELS[S.level].name, cx, view.h * 0.2 + 36, 14, '#9fb3c8', 'center', 600);
  paragraph(ctx, S.deadLine, cx, view.h * 0.2 + 70, view.w - 64, 16, '#e5e0f5', 'center', 500);
  text(ctx, `Score ${S.score}`, cx, view.h * 0.46, 20, '#ffffff', 'center', 700);
  text(ctx, S.newBest ? 'NEW BEST' : `Best ${S.best}`, cx, view.h * 0.46 + 28, 14, S.newBest ? '#22d3ee' : '#c9c2e0', 'center', 600);
  for (const b of buttons(view)) drawButton(ctx, b);
}

function drawWin(ctx, view) {
  const cx = view.w / 2;
  ctx.fillStyle = 'rgba(255,170,90,0.16)';
  ctx.fillRect(0, 0, view.w, view.h);
  text(ctx, WIN_LINES[0], cx, view.h * 0.2, 56, '#fbbf24', 'center', 800);
  paragraph(ctx, WIN_LINES[1], cx, view.h * 0.2 + 56, view.w - 64, 18, '#ffffff', 'center', 600);
  paragraph(ctx, WIN_LINES[2], cx, view.h * 0.2 + 100, view.w - 64, 15, '#e5e0f5', 'center', 500);
  text(ctx, `Final score ${S.score}`, cx, view.h * 0.5, 22, '#ffffff', 'center', 700);
  text(ctx, S.newBest ? 'NEW BEST' : `Best ${S.best}`, cx, view.h * 0.5 + 30, 14, S.newBest ? '#22d3ee' : '#c9c2e0', 'center', 600);
  for (const b of buttons(view)) drawButton(ctx, b);
}

export function render(ctx, view) {
  const L = LEVELS[S.level];
  const a = arena(view);
  const p = S.player;
  const beat = audio.beat();
  const dawn = dawnAmount();

  ctx.fillStyle = '#050309';
  ctx.fillRect(0, 0, view.w, view.h);

  ctx.save();
  if (S.shake > 0) ctx.translate(rand(-1, 1) * S.shake * 14, rand(-1, 1) * S.shake * 14);

  drawFloor(ctx, a, L.floor, beat);
  for (const o of S.obs) drawObstacle(ctx, o, beat);
  for (const u of S.pickups) {
    ctx.globalAlpha = u.life < 2 ? 0.5 + 0.5 * Math.sin(S.t * 12) : 1;
    heart(ctx, u.x, u.y, 13 + beat.pulse * 3);
    ctx.fillStyle = '#ff2e93';
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  for (const q of S.parts) {
    ctx.globalAlpha = clamp(q.life / q.max, 0, 1);
    ctx.fillStyle = q.colour;
    ctx.beginPath();
    ctx.arc(q.x, q.y, q.r, 0, 6.283);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const e of S.enemies) (e.boss ? drawBoss : drawEnemy)(ctx, e, S.t);
  for (const e of S.enemies) {
    if (e.ai === 'ranged' && e.shootT < 0.35 && e.inside) {
      ctx.strokeStyle = '#fb923c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 4, 0, 6.283);
      ctx.stroke();
    }
  }
  for (const b of S.bullets) drawBullet(ctx, b);
  for (const b of S.ebul) drawNote(ctx, b);
  drawFreddie(ctx, p, beat, S.t);
  drawRain(ctx);
  drawDarkness(ctx, view, p, beat, dawn);
  for (const o of S.obs) if (o.kind === 'lamp') drawLampGlow(ctx, o, 0.85 + 0.15 * Math.sin(S.t * 9 + o.x));
  for (const e of S.enemies) drawEyes(ctx, e);

  ctx.restore();

  if (S.dawnFlash > 0) {
    ctx.fillStyle = `rgba(255,230,190,${0.55 * S.dawnFlash})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  switch (S.mode) {
    case 'title':
      ctx.fillStyle = 'rgba(4,2,8,0.35)';
      ctx.fillRect(0, 0, view.w, view.h);
      drawTitle(ctx, view);
      break;
    case 'intro':
      drawIntro(ctx, view);
      break;
    case 'upgrade':
      drawUpgrade(ctx, view);
      break;
    case 'dead':
      drawHud(ctx, view);
      drawDead(ctx, view);
      break;
    case 'win':
      drawWin(ctx, view);
      break;
    default:
      drawSticks(ctx, view);
      drawHud(ctx, view);
  }
}

// Test hook, reachable only through window.__game (?debug). Lets the smoke test jump around the campaign.
export function debug(cmd, arg) {
  const v = S.view;
  if (cmd === 'play') {
    S.ups = zeroUps();
    S.st = stats();
    S.score = 0;
    beginLevel(arg, v);
    S.mode = 'play';
    S.player.hp = 999;
  } else if (cmd === 'boss') {
    S.levelT = LEVELS[S.level].duration;
  } else if (cmd === 'killboss') {
    if (S.boss) S.boss.hp = 0;
  }
}
