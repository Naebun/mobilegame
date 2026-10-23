// Headless playtest bot for the first-person level. Runs the real game logic (src/game3d.js) at 60 Hz in Node,
// with no rendering, driven by a bot that navigates, aims, strafes and picks weapons.
//
//   node scripts/sim3d.mjs [--runs 30] [--skill sloppy|casual|good|both] [--trace SEED] [--level 1|2]
//
// NORMAL MODE ONLY: balance is never tuned against debug mode. The bot is a proxy for a person, not a replacement:
// it answers "is the level winnable, and roughly how hard is each area", not "is it fun".
import * as game from '../src/game3d.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const RUNS = Number(args.runs || 30);
const SKILLS = args.skill === 'both' || !args.skill ? ['sloppy', 'casual', 'good'] : [args.skill];
const TRACE = args.trace === undefined ? null : Number(args.trace);
const LEVEL = Number(args.level || 1);
const VIEW = { w: 390, h: 844, dpr: 1, safe: { top: 0, bottom: 0 } };
const DT = 1 / 60;
const LIMIT = 900; // seconds of game time before a run counts as stuck

const SKILL = {
  sloppy: { sigma: 0.16, react: 0.55, turn: 3, tol: 0.1 },
  casual: { sigma: 0.07, react: 0.3, turn: 5, tol: 0.06 },
  good: { sigma: 0.025, react: 0.15, turn: 8, tol: 0.04 },
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

const wrap = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

function runOnce(seed, skillName) {
  const rng = mulberry32(seed * 7919 + (skillName === 'good' ? 13 : 0));
  Math.random = rng;
  const gauss = () => Math.sqrt(-2 * Math.log(rng() || 1e-9)) * Math.cos(6.283185 * rng());
  const sk = SKILL[skillName];

  game.init(VIEW);
  game.testHook('level', LEVEL);
  const S = game.getState();
  const W = game.getWorld();
  if (S.debugMode) throw new Error('simulator must run in normal mode');
  const p = S.player;
  const input = { touches: new Map(), pressed: [], keys: new Set() };
  const goalFlow = W.createFlowField();

  let t = 0;
  let react = 0;
  let aimErr = { yaw: 0, pitch: 0 };
  let target = null;
  let strafe = 1;
  let strafeT = 0;
  let swapT = 0;
  let lastHealth = p.health;
  let taken = 0;
  const areaTimes = {};
  const dmgBy = { melee: 0, ranged: 0 };

  while (t < LIMIT && S.mode === 'play') {
    const alive = S.enemies.filter((e) => !e.dead);
    const awake = alive.filter((e) => e.state !== 'idle');
    react -= DT;
    strafeT -= DT;
    swapT -= DT;
    if (strafeT <= 0) { strafe = rng() < 0.5 ? -1 : 1; strafeT = 0.8 + rng() * 1.2; }

    // choose a target: the closest awake enemy we can see, else the closest awake one
    if (react <= 0) {
      react = sk.react;
      let best = null;
      let bd = 1e9;
      for (const e of awake) {
        const d = Math.hypot(e.x - p.x, e.z - p.z);
        const los = W.los(p.x, p.z, e.x, e.z);
        const score = d + (los ? 0 : 40);
        if (score < bd) { bd = score; best = e; }
      }
      target = best;
      aimErr = { yaw: gauss() * sk.sigma, pitch: gauss() * sk.sigma * 0.6 };
    }
    if (target && target.dead) target = null;

    // movement goal
    let gx = 0;
    let gz = 0;
    let moveDir = null;
    const seen = target && W.los(p.x, p.z, target.x, target.z);
    if (target && seen) {
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      const nx = dx / d;
      const nz = dz / d;
      const melee = !target.def.ranged;
      if (melee && d < 5.5) moveDir = { x: -nx + -nz * strafe * 0.6, z: -nz + nx * strafe * 0.6 }; // back off while shooting
      else if (!melee && d > 10) moveDir = { x: nx, z: nz };
      else moveDir = { x: -nz * strafe, z: nx * strafe };
    } else {
      // walk to the nearest reachable thing worth walking to: a weapon we lack, an alive enemy, or the exit
      let goal = null;
      let gd = 1e9;
      const probe = W.createFlowField();
      probe.update(p.x, p.z);
      const consider = (x, z) => {
        const d = probe.distAt(x, z);
        if (d < gd) { gd = d; goal = { x, z }; }
      };
      for (const pk of S.pickups) if (!pk.taken && !(pk.def.kind === 'weapon' && p.owned[pk.def.item])) if (pk.def.kind === 'weapon' || p.health < p.maxHealth * 0.7) consider(pk.def.x, pk.def.z);
      if (!goal) for (const e of alive) consider(e.x, e.z);
      if (!goal && S.allClear) consider(W.exit.x, W.exit.z);
      if (goal) {
        goalFlow.update(goal.x, goal.z);
        const f = goalFlow.dirAt(p.x, p.z);
        if (f) moveDir = f;
        else { gx = goal.x - p.x; gz = goal.z - p.z; moveDir = { x: gx, z: gz }; }
      }
    }

    // aim: turn towards the target (or the way we are walking), at a limited turn rate
    let wantYaw = p.yaw;
    let wantPitch = 0;
    let firing = false;
    if (target && seen) {
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const dist = Math.hypot(dx, dz) || 1;
      const ty = target.h * 0.62;
      wantYaw = Math.atan2(-dx, -dz) + aimErr.yaw;
      wantPitch = Math.atan2(ty - 1.65, dist) + aimErr.pitch;
    } else if (moveDir) {
      wantYaw = Math.atan2(-moveDir.x, -moveDir.z);
    }
    const dyaw = wrap(wantYaw - p.yaw);
    p.yaw = wrap(p.yaw + Math.max(-sk.turn * DT, Math.min(sk.turn * DT, dyaw)));
    p.pitch += Math.max(-4 * DT, Math.min(4 * DT, wantPitch - p.pitch));
    if (target && seen && Math.abs(dyaw) < sk.tol + 0.05) firing = true;

    // weapon choice: shotgun up close, launcher on the boss or groups, SMG otherwise
    if (target && swapT <= 0) {
      const d = Math.hypot(target.x - p.x, target.z - p.z);
      let want = 'pistol';
      if (p.owned.smg) want = 'smg';
      if (d < 7 && p.owned.shotgun) want = 'shotgun';
      if (p.owned.launcher && (target.boss || (d > 5 && awake.length >= 3))) want = 'launcher';
      // a shield eats frontal shots: blast it, or fling a disc (it bounces), or at least get the shotgun in close
      if (target.def.shield) {
        if (p.owned.launcher && d > 3.5) want = 'launcher';
        else if (p.owned.vinyl) want = 'vinyl';
        else if (p.owned.shotgun && d < 3.5) want = 'shotgun';
      }
      if (p.weapon !== want && p.ammo[want] > 0) { input.keys.add('q'); swapT = 0.35; } else input.keys.delete('q');
    } else input.keys.delete('q');

    // keys from the world-space move direction
    for (const k of ['w', 'a', 's', 'd']) input.keys.delete(k);
    if (moveDir) {
      const len = Math.hypot(moveDir.x, moveDir.z) || 1;
      const mx = moveDir.x / len;
      const mz = moveDir.z / len;
      const fwd = -Math.sin(p.yaw) * mx + -Math.cos(p.yaw) * mz;
      const rgt = Math.cos(p.yaw) * mx + -Math.sin(p.yaw) * mz;
      if (fwd > 0.35) input.keys.add('w');
      if (fwd < -0.35) input.keys.add('s');
      if (rgt > 0.35) input.keys.add('d');
      if (rgt < -0.35) input.keys.add('a');
    }
    if (firing) input.keys.add(' '); else input.keys.delete(' ');

    const hb = p.health;
    game.update(DT, input, VIEW);
    t += DT;
    if (p.health < hb) {
      taken += hb - p.health;
      const melee = S.enemies.some((e) => !e.dead && !e.def.ranged && (e.state === 'swing'));
      dmgBy[melee ? 'melee' : 'ranged'] += hb - p.health;
      if (TRACE === seed) console.log(`  t=${t.toFixed(1)} hp ${hb}->${p.health} ${melee ? 'melee' : 'ranged'} area=${S.currentArea && S.currentArea.def.id}`);
    }
    for (const a of S.areas) if (a.cleared && areaTimes[a.def.id] === undefined) {
      areaTimes[a.def.id] = t;
      if (TRACE === seed) console.log(`  t=${t.toFixed(1)} area cleared: ${a.def.id} hp=${Math.round(p.health)}`);
    }
    lastHealth = p.health;
  }

  return {
    won: S.mode === 'complete',
    dead: S.mode === 'dead',
    stuck: S.mode === 'play',
    t,
    health: p.health,
    taken,
    dmgBy,
    diedIn: S.mode === 'dead' ? (S.currentArea && S.currentArea.def.id) : null,
    kills: S.kills,
    shots: S.shots,
    areaTimes,
  };
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '-');

console.log('skill   win%  dead%  stuck%  time(s)  dmgTaken  melee/ranged   died in');
for (const skill of SKILLS) {
  const rs = [];
  for (let s = 1; s <= RUNS; s++) {
    if (TRACE !== null && s !== TRACE) continue;
    rs.push(runOnce(s, skill));
  }
  const wins = rs.filter((r) => r.won);
  const deaths = {};
  for (const r of rs) if (r.diedIn) deaths[r.diedIn] = (deaths[r.diedIn] || 0) + 1;
  console.log(
    `${skill.padEnd(7)} ${f((100 * wins.length) / rs.length).padStart(4)}  ${f((100 * rs.filter((r) => r.dead).length) / rs.length).padStart(5)}  ` +
      `${f((100 * rs.filter((r) => r.stuck).length) / rs.length).padStart(6)}  ${f(avg(wins.map((r) => r.t))).padStart(7)}  ` +
      `${f(avg(rs.map((r) => r.taken))).padStart(8)}  ${f(avg(rs.map((r) => r.dmgBy.melee)))}/${f(avg(rs.map((r) => r.dmgBy.ranged)))}`.padEnd(14) +
      `   ${JSON.stringify(deaths)}`,
  );
}
