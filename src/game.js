// Freddie's Last Set: top-down horror shooter. Freddie is a DJ, the dance floor is full of the dead.
// Left thumb moves, right thumb aims and fires. Everything is drawn as flat vector shapes.

import * as audio from './audio.js';

const STICK_R = 60;
const DEAD = 0.2;
const FIRE_INTERVAL = 0.17;
const MAX_HP = 5;
const BEST_KEY = 'mobilegame.best';
const FLOOR_COLOURS = ['#ff2e93', '#7c3aed', '#22d3ee'];
const WAVE_LINES = [
  'The doors are locked.',
  'Keep the music going.',
  'They can hear the bass.',
  'Do not stop the set.',
  'The lights are failing.',
  'Something big is coming.',
];

const KINDS = {
  shambler: { r: 15, hp: 2, speed: (w) => Math.min(52 + w * 5, 100), score: 10, colour: '#6f9a7a' },
  sprinter: { r: 11, hp: 1, speed: (w) => Math.min(100 + w * 4, 150), score: 15, colour: '#b7c9a3' },
  brute: { r: 23, hp: 7, speed: (w) => 38 + w * 2, score: 40, colour: '#4f6f6a' },
};

const S = {
  mode: 'title', // title | play | dead
  t: 0,
  runT: 0,
  deadT: 0,
  wave: 0,
  score: 0,
  best: 0,
  newBest: false,
  shots: 0,
  kills: 0,
  spawnLeft: 0,
  spawnTimer: 0,
  gap: 2,
  banner: 0,
  shake: 0,
  hurtFlash: 0,
  player: null,
  enemies: [],
  bullets: [],
  parts: [],
  pickups: [],
  sticks: { move: null, aim: null },
};

export const getState = () => S; // exposed under ?debug for the smoke test

// ---- helpers ----

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);

function removeIf(arr, pred) {
  let j = 0;
  for (let i = 0; i < arr.length; i++) if (!pred(arr[i])) arr[j++] = arr[i];
  arr.length = j;
}

function arena(view) {
  return { x0: 12, y0: view.safe.top + 52, x1: view.w - 12, y1: view.h - view.safe.bottom - 12 };
}

function loadBest() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}

function saveBest(v) {
  try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* private mode etc. */ }
}

function newPlayer(view) {
  const a = arena(view);
  return {
    x: (a.x0 + a.x1) / 2, y: (a.y0 + a.y1) / 2, vx: 0, vy: 0, r: 16, speed: 190,
    hp: MAX_HP, aim: -Math.PI / 2, fireT: 0, hurtT: 0,
  };
}

// ---- lifecycle ----

export function init(view) {
  S.best = loadBest();
  S.player = newPlayer(view);
}

export function gesture() {
  audio.unlock();
}

function startRun(view) {
  audio.unlock();
  S.mode = 'play';
  S.runT = 0;
  S.wave = 0;
  S.score = 0;
  S.shots = 0;
  S.kills = 0;
  S.newBest = false;
  S.player = newPlayer(view);
  S.enemies.length = S.bullets.length = S.parts.length = S.pickups.length = 0;
  startWave();
}

function startWave() {
  S.wave++;
  S.spawnLeft = 5 + S.wave * 3;
  S.spawnTimer = 1.0;
  S.banner = 2.4;
  audio.riser();
}

function die() {
  S.mode = 'dead';
  S.deadT = 0;
  S.shake = 0.6;
  if (S.score > S.best) {
    S.best = S.score;
    S.newBest = true;
    saveBest(S.best);
  }
  burst(S.player.x, S.player.y, '#7c3aed', 40, 260);
  audio.gameOver();
}

function spawnEnemy(view) {
  const w = S.wave;
  const kind = w >= 5 && Math.random() < 0.12 ? 'brute' : w >= 3 && Math.random() < 0.25 ? 'sprinter' : 'shambler';
  const k = KINDS[kind];
  const side = Math.floor(Math.random() * 4);
  const m = k.r + 30;
  const x = side === 0 ? -m : side === 1 ? view.w + m : rand(0, view.w);
  const y = side === 2 ? -m : side === 3 ? view.h + m : rand(0, view.h);
  S.enemies.push({
    x, y, kx: 0, ky: 0, r: k.r, hp: k.hp, speed: k.speed(w) * rand(0.9, 1.1), score: k.score,
    colour: k.colour, phase: rand(0, 6.28), ang: 0, flash: 0, dead: false,
  });
}

function burst(x, y, colour, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, 6.28);
    const s = rand(0.2, 1) * speed;
    S.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.6), max: 0.6, r: rand(1.5, 4), colour });
  }
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

// ---- update ----

export function update(dt, input, view) {
  S.t += dt;
  audio.tick();
  audio.setMood(clamp((S.wave - 1) / 6, 0, 1), S.mode === 'dead');
  updateParts(dt);
  S.shake = Math.max(0, S.shake - dt);
  S.hurtFlash = Math.max(0, S.hurtFlash - dt * 2);
  S.banner = Math.max(0, S.banner - dt);

  if (S.mode === 'title') {
    if (input.pressed.length) startRun(view);
    return;
  }
  if (S.mode === 'dead') {
    S.deadT += dt;
    if (S.deadT > 0.9 && input.pressed.length) startRun(view);
    return;
  }

  S.runT += dt;
  const p = S.player;
  if (p.hp <= 0) { die(); return; }
  const a = arena(view);

  readSticks(input, view);
  const mv = moveVec(input);
  const aimV = stickVec(S.sticks.aim);

  // Freddie
  const k = Math.min(1, dt * 14);
  p.vx += (mv.x * p.speed - p.vx) * k;
  p.vy += (mv.y * p.speed - p.vy) * k;
  p.x = clamp(p.x + p.vx * dt, a.x0 + p.r, a.x1 - p.r);
  p.y = clamp(p.y + p.vy * dt, a.y0 + p.r, a.y1 - p.r);
  p.hurtT = Math.max(0, p.hurtT - dt);
  p.fireT = Math.max(0, p.fireT - dt);

  let firing = false;
  if (aimV.mag > 0) {
    p.aim = Math.atan2(aimV.y, aimV.x);
    firing = true;
  } else if (mv.mag > 0) {
    p.aim = Math.atan2(mv.uy, mv.ux);
  }
  if (firing && p.fireT <= 0) {
    p.fireT = FIRE_INTERVAL;
    const c = Math.cos(p.aim);
    const s = Math.sin(p.aim);
    S.bullets.push({ x: p.x + c * 26, y: p.y + s * 26, vx: c * 560, vy: s * 560, life: 0.8, r: 6, ang: p.aim, dead: false });
    S.shots++;
    audio.shoot();
  }

  // bullets
  for (const b of S.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || b.x < -40 || b.y < -40 || b.x > view.w + 40 || b.y > view.h + 40) b.dead = true;
  }

  // enemies
  const en = S.enemies;
  for (const e of en) {
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;
    const wob = Math.sin(S.t * 3 + e.phase) * 0.6;
    e.ang = Math.atan2(dy, dx);
    e.x += ((nx - ny * wob) * e.speed + e.kx) * dt;
    e.y += ((ny + nx * wob) * e.speed + e.ky) * dt;
    const decay = 1 - Math.min(1, dt * 9);
    e.kx *= decay;
    e.ky *= decay;
    e.flash = Math.max(0, e.flash - dt);
  }
  for (let i = 0; i < en.length; i++) {
    for (let j = i + 1; j < en.length; j++) {
      const A = en[i];
      const B = en[j];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const min = (A.r + B.r) * 0.9;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        A.x -= (dx / d) * push;
        A.y -= (dy / d) * push;
        B.x += (dx / d) * push;
        B.y += (dy / d) * push;
      }
    }
  }

  // bullets vs enemies
  for (const b of S.bullets) {
    if (b.dead) continue;
    for (const e of en) {
      if (e.dead) continue;
      const dx = e.x - b.x;
      const dy = e.y - b.y;
      const rr = e.r + b.r;
      if (dx * dx + dy * dy > rr * rr) continue;
      b.dead = true;
      e.hp--;
      e.flash = 0.1;
      e.kx += Math.cos(b.ang) * 140;
      e.ky += Math.sin(b.ang) * 140;
      burst(b.x, b.y, '#a3c9a8', 3, 120);
      if (e.hp <= 0) {
        e.dead = true;
        S.score += e.score;
        S.kills++;
        burst(e.x, e.y, '#c026d3', 14, 220);
        audio.kill();
        if (p.hp < MAX_HP && Math.random() < 0.06) S.pickups.push({ x: e.x, y: e.y, life: 10 });
      }
      break;
    }
  }

  // enemies vs Freddie
  if (p.hurtT <= 0) {
    for (const e of en) {
      if (e.dead) continue;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const rr = e.r + p.r * 0.75;
      if (dx * dx + dy * dy > rr * rr) continue;
      p.hp--;
      p.hurtT = 1.1;
      S.shake = 0.4;
      S.hurtFlash = 1;
      const d = Math.hypot(dx, dy) || 1;
      e.kx = (-dx / d) * 300;
      e.ky = (-dy / d) * 300;
      audio.hurt();
      break;
    }
  }

  // pickups
  for (const u of S.pickups) {
    u.life -= dt;
    const dx = p.x - u.x;
    const dy = p.y - u.y;
    if (dx * dx + dy * dy < 26 * 26 && p.hp < MAX_HP) {
      p.hp++;
      u.life = 0;
      audio.pickup();
    }
  }

  removeIf(S.bullets, (b) => b.dead);
  removeIf(en, (e) => e.dead);
  removeIf(S.pickups, (u) => u.life <= 0);

  // waves
  if (S.spawnLeft > 0) {
    S.spawnTimer -= dt;
    if (S.spawnTimer <= 0) {
      spawnEnemy(view);
      S.spawnLeft--;
      S.spawnTimer = Math.max(0.35, 1.1 - S.wave * 0.08);
    }
    S.gap = 2;
  } else if (!en.length) {
    S.gap -= dt;
    if (S.gap <= 0) startWave();
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

function text(ctx, str, x, y, size, colour, align = 'center', weight = 700) {
  ctx.font = `${weight} ${size}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colour;
  ctx.fillText(str, x, y);
}

function heart(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 0.9, y - s * 0.2, x - s * 0.5, y - s * 0.9, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.5, y - s * 0.9, x + s * 0.9, y - s * 0.2, x, y + s * 0.35);
  ctx.closePath();
}

const tileHash = (i, j, n) => ((i * 73856093) ^ (j * 19349663) ^ (n * 83492791)) >>> 0;

function drawFloor(ctx, a, beat) {
  const T = 44;
  ctx.save();
  ctx.beginPath();
  ctx.rect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
  ctx.clip();
  const cols = Math.ceil((a.x1 - a.x0) / T);
  const rows = Math.ceil((a.y1 - a.y0) / T);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = a.x0 + i * T;
      const y = a.y0 + j * T;
      ctx.fillStyle = (i + j) & 1 ? '#231b3a' : '#1c1530';
      ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
      if (tileHash(i, j, beat.count) % 100 < 14) {
        ctx.globalAlpha = 0.06 + 0.3 * beat.pulse;
        ctx.fillStyle = FLOOR_COLOURS[(i + j + beat.count) % 3];
        ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
        ctx.globalAlpha = 1;
      }
    }
  }
  ctx.restore();
  ctx.strokeStyle = '#2a2140';
  ctx.lineWidth = 4;
  ctx.strokeRect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
}

function drawFreddie(ctx, p, beat) {
  const blink = p.hurtT > 0 && Math.floor(S.t * 20) % 2 === 0;
  ctx.fillStyle = `rgba(34,211,238,${0.1 + 0.25 * beat.pulse})`;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r + 6 + beat.pulse * 5, 0, 6.283);
  ctx.fill();

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.aim);
  // speaker cannon
  ctx.fillStyle = '#1f1b2e';
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 2;
  ctx.fillRect(8, -8, 22, 16);
  ctx.strokeRect(8, -8, 22, 16);
  ctx.beginPath();
  ctx.arc(24, 0, 4.5, 0, 6.283);
  ctx.stroke();
  // jacket
  ctx.fillStyle = blink ? '#ffffff' : '#6d28d9';
  ctx.beginPath();
  ctx.arc(0, 0, p.r, 0, 6.283);
  ctx.fill();
  ctx.fillStyle = '#ff2e93';
  ctx.fillRect(-p.r + 2, -2, p.r, 4);
  // head and headphones
  ctx.fillStyle = '#f0c8a0';
  ctx.beginPath();
  ctx.arc(1, 0, 8.5, 0, 6.283);
  ctx.fill();
  ctx.strokeStyle = '#0b0b12';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(0, 10);
  ctx.stroke();
  ctx.fillStyle = '#ff2e93';
  ctx.fillRect(-4, -14, 8, 6);
  ctx.fillRect(-4, 8, 8, 6);
  ctx.restore();
}

function drawEnemy(ctx, e) {
  const bob = Math.sin(S.t * 6 + e.phase) * 2;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.ang);
  ctx.fillStyle = e.flash > 0 ? '#ffffff' : e.colour;
  // arms reaching forward
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(e.r * 0.9 + bob, side * e.r * 0.65, e.r * 0.34, 0, 6.283);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, e.r, 0, 6.283);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(e.r * 0.45, 0, e.r * 0.28, 0, 6.283);
  ctx.fill();
  ctx.restore();
}

function drawEyes(ctx, e) {
  const c = Math.cos(e.ang);
  const s = Math.sin(e.ang);
  for (const side of [-1, 1]) {
    const x = e.x + c * e.r * 0.35 - s * side * e.r * 0.38;
    const y = e.y + s * e.r * 0.35 + c * side * e.r * 0.38;
    ctx.fillStyle = 'rgba(255,40,40,0.25)';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = '#ff2a2a';
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, 6.283);
    ctx.fill();
  }
}

function drawBullet(ctx, b) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.ang);
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = 1 - i * 0.3;
    ctx.strokeStyle = i === 0 ? '#ffffff' : '#22d3ee';
    ctx.lineWidth = 3 - i * 0.6;
    ctx.beginPath();
    ctx.arc(-i * 7, 0, 8 + i * 2, -0.9, 0.9);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawDarkness(ctx, view, p, beat) {
  const hp = S.mode === 'play' || S.mode === 'dead' ? p.hp : MAX_HP;
  const R = 120 + hp * 20 + beat.pulse * 12;
  const strobe = S.wave >= 3 && beat.count % 8 === 0 ? beat.pulse : 0;
  const dark = 0.93 - strobe * 0.4;
  const g = ctx.createRadialGradient(p.x, p.y, R * 0.2, p.x, p.y, R);
  g.addColorStop(0, 'rgba(4,2,8,0)');
  g.addColorStop(1, `rgba(4,2,8,${dark})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.w, view.h);
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

  if (S.wave === 1 && S.runT < 8 && !S.sticks.move && !S.sticks.aim) {
    const y = view.h - view.safe.bottom - 70;
    text(ctx, 'MOVE', view.w * 0.25, y, 14, 'rgba(255,255,255,0.4)');
    text(ctx, 'AIM + FIRE', view.w * 0.75, y, 14, 'rgba(34,211,238,0.55)');
  }
}

function drawHud(ctx, view) {
  const p = S.player;
  const top = view.safe.top + 26;
  for (let i = 0; i < MAX_HP; i++) {
    heart(ctx, 22 + i * 26, top, 11);
    if (i < p.hp) {
      ctx.fillStyle = '#ff2e93';
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255,46,147,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  text(ctx, String(S.score), view.w - 16, top, 22, '#ffffff', 'right');
  text(ctx, `WAVE ${S.wave}`, view.w / 2 + 28, top, 13, 'rgba(255,255,255,0.45)', 'center', 600);

  if (S.banner > 0 && S.mode === 'play') {
    ctx.globalAlpha = Math.min(1, S.banner / 0.8);
    text(ctx, `WAVE ${S.wave}`, view.w / 2, view.h * 0.3, 44, '#ff2e93');
    text(ctx, WAVE_LINES[(S.wave - 1) % WAVE_LINES.length], view.w / 2, view.h * 0.3 + 38, 16, '#c9c2e0', 'center', 500);
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

function drawTitle(ctx, view) {
  const cx = view.w / 2;
  const cy = view.h * 0.28;
  ctx.fillStyle = 'rgba(4,2,8,0.3)';
  ctx.fillRect(0, 0, view.w, view.h);
  text(ctx, "FREDDIE'S", cx, cy, 52, '#ff2e93', 'center', 800);
  text(ctx, 'LAST SET', cx, cy + 54, 52, '#22d3ee', 'center', 800);
  text(ctx, 'Survive the night. Keep the beat.', cx, cy + 108, 15, '#c9c2e0', 'center', 500);
  if (Math.floor(S.t * 1.6) % 2 === 0) text(ctx, 'TAP TO START', cx, view.h * 0.66, 22, '#ffffff');
  if (S.best > 0) text(ctx, `BEST ${S.best}`, cx, view.h * 0.66 + 36, 15, '#c9c2e0', 'center', 600);
  text(ctx, 'Left thumb: move   Right thumb: aim and fire', cx, view.h - view.safe.bottom - 36, 13, 'rgba(255,255,255,0.45)', 'center', 500);
}

function drawDead(ctx, view) {
  const cx = view.w / 2;
  ctx.fillStyle = 'rgba(4,2,8,0.6)';
  ctx.fillRect(0, 0, view.w, view.h);
  text(ctx, 'THE SET IS OVER', cx, view.h * 0.3, 34, '#ff2e93', 'center', 800);
  text(ctx, `Wave ${S.wave}   Score ${S.score}`, cx, view.h * 0.3 + 46, 18, '#ffffff', 'center', 600);
  text(ctx, S.newBest ? 'NEW BEST' : `Best ${S.best}`, cx, view.h * 0.3 + 76, 15, S.newBest ? '#22d3ee' : '#c9c2e0', 'center', 600);
  if (S.deadT > 0.9 && Math.floor(S.t * 1.6) % 2 === 0) text(ctx, 'TAP TO PLAY AGAIN', cx, view.h * 0.62, 20, '#ffffff');
}

export function render(ctx, view) {
  const a = arena(view);
  const p = S.player;
  const beat = audio.beat();

  ctx.fillStyle = '#050309';
  ctx.fillRect(0, 0, view.w, view.h);

  ctx.save();
  if (S.shake > 0) ctx.translate(rand(-1, 1) * S.shake * 14, rand(-1, 1) * S.shake * 14);

  drawFloor(ctx, a, beat);
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
  for (const e of S.enemies) drawEnemy(ctx, e);
  for (const b of S.bullets) drawBullet(ctx, b);
  drawFreddie(ctx, p, beat);
  drawDarkness(ctx, view, p, beat);
  for (const e of S.enemies) drawEyes(ctx, e);

  ctx.restore();

  if (S.mode === 'play') {
    drawSticks(ctx, view);
    drawHud(ctx, view);
  } else if (S.mode === 'title') {
    drawTitle(ctx, view);
  } else {
    drawHud(ctx, view);
    drawDead(ctx, view);
  }
}
