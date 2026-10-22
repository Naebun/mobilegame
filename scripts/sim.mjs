// Headless balance simulator. Runs the real game logic (src/game.js) at 60 Hz with no rendering, driven by
// bots of different skill, and reports win rates, damage taken and boss-fight lengths per level.
//
//   node scripts/sim.mjs [--level 1..5] [--runs 30] [--bots idle,casual,good] [--builds rand,weak,strong] [--trace SEED]
//   --trace prints every hit taken in the run with that seed (use with one --level, --bots and --builds value)
//
// NORMAL MODE ONLY. Balance is never tuned against debug mode, so this refuses to run with it on.
// A level counts as won when its boss dies. Bots are a proxy for people, not a replacement for playing.
import * as game from '../src/game.js';
import { LEVELS } from '../src/levels.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const RUNS = Number(args.runs || 30);
const BOTS = (args.bots || 'idle,casual,good').split(',');
const BUILDS = (args.builds || 'rand,weak,strong').split(',');
const TRACE = args.trace === undefined ? null : Number(args.trace);
const LEVEL_IDX = args.level ? [Number(args.level) - 1] : LEVELS.map((_, i) => i);
const VIEW = { w: 390, h: 844, dpr: 1, safe: { top: 0, bottom: 0 } };
const DT = 1 / 60;
const LIMIT = 300; // seconds of game time before a run counts as stuck

// Upgrades a player might have after clearing i levels. 'mid' is a sensible build, 'weak' picks the least useful.
// 'rand' is the honest average player: at each level-up the game's own offer logic deals three upgrades and
// one is taken at random. 'weak', 'safe' and 'strong' bracket it with the least useful, a cautious, and the most useful picks, offers ignored.
const PICKS = {
  weak: ['speed', 'torch', 'speed', 'torch'],
  strong: ['rate', 'twin', 'dmg', 'rate'],
  safe: ['hp', 'speed', 'hp', 'torch'], // a cautious player who avoids offence
};
const upsFor = (build, level, rng) => {
  const ups = {};
  if (build === 'rand') {
    for (let i = 0; i < level; i++) {
      const offers = game.testHook('offers', ups);
      const pick = offers[Math.floor(rng() * offers.length)];
      ups[pick] = (ups[pick] || 0) + 1;
    }
    return ups;
  }
  for (const id of PICKS[build].slice(0, level)) ups[id] = (ups[id] || 0) + 1;
  return ups;
};

const BOT = {
  idle: { thumbs: false },
  // casual wanders about like a person holding a thumb on the screen, but never reacts to notes or charges
  casual: { thumbs: true, sigma: 0.3, react: 0.35, range: 170, dodge: false, fireRange: 380, wander: true },
  good: { thumbs: true, sigma: 0.1, react: 0.12, range: 200, dodge: true, fireRange: 460 },
};

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runOnce(levelIdx, botKind, build, seed) {
  const rng = mulberry32(seed * 7919 + levelIdx * 104729);
  Math.random = rng;
  const gauss = () => Math.sqrt(-2 * Math.log(rng() || 1e-9)) * Math.cos(6.283185 * rng());

  game.init(VIEW);
  game.testHook('playWith', { level: levelIdx, ups: upsFor(build, levelIdx, rng) });
  const S = game.getState();
  if (S.debugMode) throw new Error('simulator must run in normal mode');
  const p = S.player;
  const bot = BOT[botKind];
  const input = { touches: new Map(), pressed: [], keys: new Set() };
  const moveT = { id: 1, x: 100, y: 700, sx: 100, sy: 700, role: null };
  const aimT = { id: 2, x: 300, y: 700, sx: 300, sy: 700, role: null };
  if (bot.thumbs) {
    input.touches.set(1, moveT);
    input.touches.set(2, aimT);
  }
  const a = { x0: 12, y0: VIEW.safe.top + 64, x1: VIEW.w - 12, y1: VIEW.h - 12 };
  let aimAngle = -Math.PI / 2;
  let hasTarget = false;
  let aimTimer = 0;
  let wanderT = 0;
  let wanderAngle = 0;
  let wanderMoving = false;
  let bossAt = null;
  const hits = { melee: 0, boss: 0, note: 0 };
  let t = 0;

  while (t < LIMIT && S.mode === 'play') {
    if (bot.thumbs) {
      // aim: pick the nearest enemy every `react` seconds, with human-sized error
      aimTimer -= DT;
      if (aimTimer <= 0) {
        aimTimer = bot.react;
        let best = null;
        let bestD = bot.fireRange;
        for (const e of S.enemies) {
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (!e.dead && d < bestD) { bestD = d; best = e; }
        }
        hasTarget = !!best;
        if (best) aimAngle = Math.atan2(best.y - p.y, best.x - p.x) + gauss() * bot.sigma;
      }
      aimT.x = aimT.sx + (hasTarget ? Math.cos(aimAngle) * 60 : 0);
      aimT.y = aimT.sy + (hasTarget ? Math.sin(aimAngle) * 60 : 0);

      // move: push away from nearby enemies, keep off the walls, drift back to the middle when it is quiet
      let mx = 0;
      let my = 0;
      for (const e of S.enemies) {
        if (e.dead) continue;
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        const range = (e.boss ? 300 : bot.range) + e.r;
        if (d < range) {
          const w = (1 - d / range) ** 2 * (e.boss ? 1.5 : 1);
          mx += (dx / d) * w;
          my += (dy / d) * w;
        }
        if (bot.dodge && e.boss && (e.state === 'windup' || e.state === 'dash')) {
          // sidestep the charge lane
          const px = -Math.sin(e.ang);
          const py = Math.cos(e.ang);
          const side = Math.sign(dx * px + dy * py) || 1;
          mx += px * side * 2;
          my += py * side * 2;
        }
      }
      if (bot.dodge) {
        for (const b of S.ebul) {
          const dx = p.x - b.x;
          const dy = p.y - b.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < 90) { mx += (dx / d) * (1 - d / 90) * 2; my += (dy / d) * (1 - d / 90) * 2; }
        }
      }
      if (bot.wander) {
        // pick a new heading every 0.8 to 1.8s, standing still about a quarter of the time
        wanderT -= DT;
        if (wanderT <= 0) {
          wanderT = 0.8 + rng();
          wanderAngle = rng() * 6.283;
          wanderMoving = rng() < 0.75;
        }
        if (wanderMoving) {
          mx += Math.cos(wanderAngle) * 0.5;
          my += Math.sin(wanderAngle) * 0.5;
        }
      }
      const M = 70;
      if (p.x < a.x0 + M) mx += (1 - (p.x - a.x0) / M) * 1.2;
      if (p.x > a.x1 - M) mx -= (1 - (a.x1 - p.x) / M) * 1.2;
      if (p.y < a.y0 + M) my += (1 - (p.y - a.y0) / M) * 1.2;
      if (p.y > a.y1 - M) my -= (1 - (a.y1 - p.y) / M) * 1.2;
      if (Math.hypot(mx, my) < 0.05) {
        mx += ((a.x0 + a.x1) / 2 - p.x) * 0.004;
        my += ((a.y0 + a.y1) * 0.6 - p.y) * 0.004;
      }
      const len = Math.hypot(mx, my);
      const mag = len < 0.03 ? 0 : Math.min(1, len * 1.5);
      moveT.x = moveT.sx + (len ? (mx / len) * 60 * mag : 0);
      moveT.y = moveT.sy + (len ? (my / len) * 60 * mag : 0);
    }

    const hpBefore = p.hp;
    const noteNear = S.ebul.some((b) => Math.hypot(b.x - p.x, b.y - p.y) < b.r + p.r * 0.7 + 8);
    const bossNear = S.boss && !S.boss.dead && Math.hypot(S.boss.x - p.x, S.boss.y - p.y) < S.boss.r + p.r + 8;
    game.update(DT, input, VIEW);
    input.pressed.length = 0;
    t += DT;
    if (p.hp < hpBefore) {
      const cause = noteNear ? 'note' : bossNear ? 'boss' : 'melee';
      hits[cause] += hpBefore - p.hp;
      if (TRACE === seed) {
        const near = S.enemies.filter((e) => Math.hypot(e.x - p.x, e.y - p.y) < e.r + 60).map((e) => e.type).join(',');
        const kinds = {};
        for (const e of S.enemies) kinds[e.type] = (kinds[e.type] || 0) + 1;
        console.log(`  t=${t.toFixed(1).padStart(5)} hp ${hpBefore}->${p.hp} cause=${cause} notes=${S.ebul.length} near=[${near}] alive=${JSON.stringify(kinds)} pos=${Math.round(p.x)},${Math.round(p.y)}`);
      }
    }
    if (S.bossSpawned && bossAt === null) bossAt = t;
  }

  const won = S.mode === 'clear';
  return {
    won,
    stuck: S.mode === 'play',
    t,
    hpLost: S.st.maxHp - Math.max(0, p.hp),
    maxHp: S.st.maxHp,
    diedAtBoss: !won && S.bossSpawned,
    bossFight: bossAt === null ? null : t - bossAt,
    bossReached: bossAt !== null,
    hits,
    kills: S.kills,
  };
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '-');

console.log('level  bot     build  win%  boss%  stuck  clear(s)  hpLost  bossFight(s)  damage: melee/boss/note');
for (const li of LEVEL_IDX) {
  for (const bot of BOTS) {
    for (const build of BUILDS) {
      if (bot === 'idle' && build !== BUILDS[0]) continue; // the idle bot ignores builds
      const rs = [];
      for (let s = 1; s <= RUNS; s++) {
        if (TRACE !== null && s !== TRACE) continue;
        rs.push(runOnce(li, bot, build, s));
      }
      const wins = rs.filter((r) => r.won);
      const hit = (k) => avg(rs.map((r) => r.hits[k]));
      console.log(
        `${String(li + 1).padStart(3)}    ${bot.padEnd(7)} ${build.padEnd(6)} ${f((100 * wins.length) / rs.length, 0).padStart(4)}  ` +
          `${f((100 * rs.filter((r) => r.bossReached).length) / rs.length, 0).padStart(5)}  ${String(rs.filter((r) => r.stuck).length).padStart(5)}  ` +
          `${f(avg(wins.map((r) => r.t)), 0).padStart(8)}  ${f(avg(wins.map((r) => r.hpLost))).padStart(6)}  ` +
          `${f(avg(rs.filter((r) => r.bossFight != null && r.won).map((r) => r.bossFight)), 0).padStart(12)}  ` +
          `${f(hit('melee'))}/${f(hit('boss'))}/${f(hit('note'))}`,
      );
    }
  }
}
