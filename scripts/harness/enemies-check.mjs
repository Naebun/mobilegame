// Headless checks of the four prepared enemies, run against the real game logic in Node:
//   node scripts/harness/enemies-check.mjs
// The Fizzbang Shaken, Bampot Longshot, Bampot Nurse and Vending Mimic are built and tested but NOT placed in any level
// (docs/enemies-next.md). Robots are added to the running game with testHook('spawn'). Normal mode only: balance is never
// tuned against debug mode.
import * as game from '../../src/game3d.js';
import * as audio from '../../src/audio.js';
import { ENEMY_DEFS, WEAPONS } from '../../src/data.js';
import { LEVEL_DEFS, buildWorld } from '../../src/world.js';
import { EYE, PLAYER_R } from '../../src/consts.js';

let failures = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${msg}`); }
};
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const VIEW = { w: 390, h: 844, dpr: 1, safe: { top: 0, bottom: 0 } };
const DT = 1 / 60;
const input = () => ({ touches: new Map(), pressed: [], keys: new Set() });
let seed = 11;
Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const KINDS = ['shaken', 'longshot', 'nurse', 'mimic'];

// ---- test rig ----

function fresh(level = 2) {
  game.init(VIEW);
  game.testHook('level', level);
  const S = game.getState();
  if (S.debugMode) throw new Error('enemies-check must run in normal mode');
  S.enemies.length = 0; // the level's own robots are not wanted here; each test spawns what it needs
  S.totalEnemies = 0;
  S.pickups.length = 0; // and nothing to pick up or drink on the way
  game.testHook('torch', { attached: true }); // the torch-fitting sequence at the start of a dark level would hold the pistol
  S.player.maxHealth = S.player.health = 1000;
  return { S, W: game.getWorld() };
}
const run = (seconds, each, inp = input()) => {
  for (let t = 0; t < seconds; t += DT) {
    game.update(DT, inp, VIEW);
    if (each && each(t) === false) return t;
  }
  return seconds;
};
const spawn = (S, kind, x, z, yaw = 0, area) => S.enemies[game.testHook('spawn', { kind, x, z, yaw, area })];
const place = (x, z, yaw = 0) => game.testHook('teleport', { x, z, yaw });
const wake = (e) => { e.state = 'chase'; e.stateT = 1; e.cool = 0; e.checkT = 0; e.wakeDelay = -1; };
const kill = (S, e, fx = e.x + 5, fz = e.z) => game.testHook('hitEnemy', { i: S.enemies.indexOf(e), amount: 1e6, fx, fz });
const hit = (S, e, amount, fx = e.x + 5, fz = e.z, knock = 0, head = false) => game.testHook('hitEnemy', { i: S.enemies.indexOf(e), amount, fx, fz, knock, head });
const hp = () => game.getState().player.health;

// Somewhere to put things: a straight east-west lane of free floor (at least `len` long, 1 m clear either side), a full-height
// pillar with free floor round it on both sides, and a piece of low cover (blocks walking, not shots).
function findLane(W, len) {
  for (let r = 1; r < 60; r++) {
    for (let c = 1; c < 50; c++) {
      const x0 = (c + 0.5) * 2;
      const z = (r + 0.5) * 2;
      let good = true;
      for (let d = 0; d <= len && good; d += 0.5) for (const o of [-1, 0, 1]) if (W.isSolidAt(x0 + d, z + o)) good = false;
      if (good) return { x0, z, x1: x0 + len };
    }
  }
  return null;
}
function findBlock(W, wantFull) {
  for (let r = 2; r < 58; r++) {
    for (let c = 7; c < 44; c++) {
      const x = (c + 0.5) * 2;
      const z = (r + 0.5) * 2;
      if (!W.isSolidAt(x, z) || W.blocksShotAt(x, z) !== wantFull) continue;
      let good = true;
      for (let d = 1.5; d <= 7 && good; d += 0.5) for (const o of [-1, 0, 1]) if (W.isSolidAt(x - d, z + o) || W.isSolidAt(x + d, z + o)) good = false;
      if (good) return { x, z };
    }
  }
  return null;
}

// ---- no level contains them ----
{
  const reserved = ['k', 'l', 'u', 'm']; // map letters set aside for them in docs/enemies-next.md
  const prepared = new Set(KINDS);
  for (const [n, lv] of Object.entries(LEVEL_DEFS)) {
    ok(!Object.values(lv.kinds).some((k) => prepared.has(k)), `level ${n}: the KINDS table has none of the four`);
    ok(!reserved.some((ch) => Object.keys(lv.kinds).includes(ch) || Object.keys(lv.picks).includes(ch)), `level ${n}: the reserved letters are free in KINDS and PICKS`);
    ok(!lv.map.some((row) => reserved.some((ch) => row.includes(ch))), `level ${n}: no map uses a reserved letter`);
    const w = buildWorld({ level: Number(n), quality: 'low' });
    const kinds = w.areas.flatMap((a) => a.spawns.map((s) => s.kind));
    ok(!kinds.some((k) => prepared.has(k)), `level ${n}: no spawn of the four (${kinds.length} spawns)`);
  }
  // the game plays as before: the same number of robots on each level
  for (const [n, want] of [[1, 19], [2, 24]]) {
    const { S } = fresh(n);
    game.testHook('level', n);
    ok(S.enemies.length === want && S.totalEnemies === want, `level ${n} still has ${want} robots (${S.enemies.length})`);
    ok(!S.enemies.some((e) => prepared.has(e.kind)), `level ${n}: none of the four in the running game`);
  }
  ok(KINDS.every((k) => ENEMY_DEFS[k] && ENEMY_DEFS[k].ai === k), 'all four have an ENEMY_DEFS entry with their own ai');
  ok(!KINDS.some((k) => ENEMY_DEFS[k].boss), 'none of the four is a boss');
  ok(!ENEMY_DEFS.shaken.ranged && !ENEMY_DEFS.mimic.ranged, 'Dr Fizzbang camp (Shaken, Mimic) is melee only: ranged false');
  ok(ENEMY_DEFS.longshot.ranged && !ENEMY_DEFS.nurse.ranged && ENEMY_DEFS.nurse.support, 'Bampot camp: the Longshot shoots, the Nurse does not');
}

// ---- Fizzbang Shaken ----
{
  const def = ENEMY_DEFS.shaken;
  const b = def.burst;
  const { S, W } = fresh();
  const lane = findLane(W, 22);
  ok(lane !== null, 'there is a lane of free floor to test on');

  // the rattle rises as it closes in: more Hz, never less
  const e = spawn(S, 'shaken', lane.x0, lane.z, -Math.PI / 2, '_t');
  const rates = [];
  for (const d of [20, 14, 11, 8, 5, 3.6, 2.5, 1.5]) {
    place(lane.x0 + d, lane.z, Math.PI / 2);
    e.x = lane.x0;
    e.z = lane.z;
    wake(e);
    run(DT);
    rates.push([d, e.rattleHz, e.rattle]);
  }
  ok(rates.every((r, i) => i === 0 || r[1] >= rates[i - 1][1] - 1e-9), `rattle rate never falls as it nears: ${rates.map((r) => `${r[0]}m ${r[1].toFixed(1)}Hz`).join(', ')}`);
  ok(near(rates[0][1], def.rattle.min, 0.01) && near(rates[1][1], def.rattle.min, 0.01), `beyond ${def.rattle.far} m it rattles at the slow rate (${def.rattle.min} Hz)`);
  ok(near(rates[6][1], def.rattle.max, 0.01) && near(rates[7][1], def.rattle.max, 0.01), `inside ${def.rattle.near} m it rattles flat out (${def.rattle.max} Hz)`);
  ok(rates[4][1] > rates[2][1] * 1.25 && rates[2][1] > rates[1][1], 'the climb is steady between far and near');
  ok(typeof audio.rattle === 'function' && typeof audio.hiss === 'function' && typeof audio.fizz === 'function', 'the rattle, hiss and burst sounds exist');
  audio.rattle(0.2); audio.hiss(); audio.fizz(); // silent in Node (no audio context), must not throw
  kill(S, e);
  S.enemies.length = 0;

  // it comes at Naebun, primes with a telegraph, and bursts on touching: damage from the falloff, once
  {
    const s = fresh();
    const sh = spawn(s.S, 'shaken', lane.x0, lane.z, -Math.PI / 2, '_t');
    place(lane.x0 + 7, lane.z, Math.PI / 2);
    wake(sh);
    let primeAt = -1;
    let primeDist = 0;
    const t0 = run(8, (t) => {
      if (sh.state === 'prime' && primeAt < 0) { primeAt = t; primeDist = Math.hypot(s.S.player.x - sh.x, s.S.player.z - sh.z); }
      return !sh.burstDone;
    });
    ok(primeAt > 0 && primeDist <= def.prime.range + 0.2 && primeDist > def.prime.range - 0.6, `it primes at the prime range (${primeDist.toFixed(2)} m, range ${def.prime.range})`);
    ok(sh.robot.primed === true, 'the model shows the prime pose (swell, glow, ring)');
    ok(sh.burstDone && sh.dead && s.S.kills === 1, 'it burst and counts as one kill');
    ok(sh.primeT >= 0.3 && sh.primeT <= def.prime.fuse + 0.05, `telegraph before the burst: ${sh.primeT.toFixed(2)} s between prime and burst (at least 0.3, fuse ${def.prime.fuse})`);
    const lost = 1000 - hp();
    const touch = sh.r + PLAYER_R + 0.1;
    const lo = Math.round(b.player * (1 - (1 - b.floor) * (touch + 0.45) / b.radius));
    ok(lost >= lo && lost <= b.player, `a burst on touching hurts Naebun ${lost} (between ${lo} and ${b.player})`);
    void t0;
    // and only once: nothing more happens
    const h1 = hp();
    run(2);
    ok(hp() === h1 && s.S.kills === 1, 'a burst is a one-off (no second blast, no second kill)');
  }

  // the blast: Naebun's damage by distance, zero outside the radius
  const blastAt = (dist) => {
    const s = fresh();
    const sh = spawn(s.S, 'shaken', lane.x0, lane.z, 0, '_t');
    place(lane.x0 + dist, lane.z, 0);
    s.S.player.health = 1000;
    kill(s.S, sh, lane.x0 + 5, lane.z);
    return 1000 - s.S.player.health;
  };
  for (const d of [0.8, 1.6, 2.4, 3.0, 3.15]) {
    const want = Math.round(b.player * (1 - (1 - b.floor) * (d / b.radius)));
    ok(blastAt(d) === want, `blast at ${d} m hurts Naebun ${want} (got ${blastAt(d)})`);
  }
  ok(blastAt(3.3) === 0 && blastAt(5) === 0, `shot from outside ${b.radius} m (3.3 m, 5 m): no damage to Naebun`);
  ok(blastAt(0.8) > blastAt(1.6) && blastAt(1.6) > blastAt(3.0), 'the blast hurts less with distance');

  // other robots in the blast lose health by distance, and none outside it
  const robotAt = (dist) => {
    const s = fresh();
    const sh = spawn(s.S, 'shaken', lane.x0, lane.z, 0, '_t');
    const fz = spawn(s.S, 'fizzbang', lane.x0 + dist, lane.z, 0, '_t');
    place(lane.x0 + 20, lane.z, 0);
    kill(s.S, sh, lane.x0 - 5, lane.z);
    return fz.maxHp - fz.hp;
  };
  for (const d of [1.5, 2.5, 3.0]) {
    const want = b.robots * (1 - (1 - b.floor) * (d / b.radius));
    ok(near(robotAt(d), want, 0.05), `a Fizzbang ${d} m away loses ${want.toFixed(1)} hp (${robotAt(d).toFixed(1)})`);
  }
  ok(robotAt(3.5) === 0, 'a Fizzbang outside the radius is untouched');
  {
    // the shielded one's door does not stop a blast (it pierces)
    const s = fresh();
    const sh = spawn(s.S, 'shaken', lane.x0, lane.z, 0, '_t');
    const sd = spawn(s.S, 'shielded', lane.x0 + 2, lane.z, Math.PI / 2, '_t'); // facing the blast
    place(lane.x0 + 20, lane.z, 0);
    kill(s.S, sh, lane.x0 - 5, lane.z);
    ok(near(sd.maxHp - sd.hp, b.robots * (1 - (1 - b.floor) * (2 / b.radius)), 0.05), 'a blast ignores a shield');
  }

  // chain reaction: a neighbour that survives the blast primes at once and goes off after a short fuse, and sets off the next
  {
    const s = fresh();
    const gap = 2.4;
    const a = spawn(s.S, 'shaken', lane.x0, lane.z, 0, '_t');
    const m = spawn(s.S, 'shaken', lane.x0 + gap, lane.z, 0, '_t');
    const c = spawn(s.S, 'shaken', lane.x0 + 2 * gap, lane.z, 0, '_t');
    place(lane.x0 + 20, lane.z, 0);
    const fall = 1 - (1 - b.floor) * (gap / b.radius);
    ok(b.robots * fall < def.hp, 'at this gap the first blast does not kill its neighbour outright (it must be set off)');
    kill(s.S, a, lane.x0 - 5, lane.z);
    ok(m.state === 'prime' && m.chained && !m.dead && near(m.hp, def.hp - b.robots * fall, 0.05), `the neighbour is hurt (${m.hp.toFixed(1)} hp) and primed by the blast`);
    ok(c.state === 'idle', 'the third, outside the first blast, is untouched for now');
    const fuse = b.chain * (0.5 + gap / b.radius);
    const times = {};
    run(3, (t) => {
      if (m.burstDone && times.m === undefined) times.m = t;
      if (c.burstDone && times.c === undefined) times.c = t;
      return !(m.burstDone && c.burstDone);
    });
    ok(times.m !== undefined && Math.abs(times.m - fuse) < 0.08, `the second goes off after its short fuse (${(times.m || 0).toFixed(2)} s, expected ${fuse.toFixed(2)})`);
    ok(times.c !== undefined && times.c > times.m, `then the third (${(times.c || 0).toFixed(2)} s), so a row ripples`);
    ok(s.S.kills === 3 && [a, m, c].every((x) => x.dead && x.burstDone), 'all three are dead, once each');
    ok(hp() === 1000, 'Naebun, 18 m off, is unhurt by the whole chain');
  }
  // a neighbour that dies in the blast goes off a moment later, not on the same frame
  {
    const s = fresh();
    const a = spawn(s.S, 'shaken', lane.x0, lane.z, 0, '_t');
    const m = spawn(s.S, 'shaken', lane.x0 + 1.0, lane.z, 0, '_t');
    const f = spawn(s.S, 'fizzbang', lane.x0 + 4.0, lane.z, 0, '_t'); // outside the first blast, inside the second
    place(lane.x0 + 20, lane.z, 0);
    kill(s.S, a, lane.x0 - 5, lane.z);
    ok(m.dead && !m.burstDone && f.hp === f.maxHp, 'a neighbour killed by the blast is dead but has not burst yet');
    run(0.6);
    ok(m.burstDone && f.hp < f.maxHp, 'then it bursts, and hurts what the first blast could not reach');
    ok(s.S.kills === 2, 'two kills, no more');
  }
  // dodging: running away from the lunge costs less than standing still
  {
    const hurtBy = (running) => {
      const s = fresh();
      const sh = spawn(s.S, 'shaken', lane.x0, lane.z, 0, '_t');
      place(lane.x0 + def.prime.range + 0.1, lane.z, Math.PI / 2);
      wake(sh);
      s.S.player.health = 1000;
      run(4, () => {
        if (running && sh.state === 'prime') s.S.player.x += 4.4 * DT;
        return !sh.burstDone;
      });
      return 1000 - s.S.player.health;
    };
    const stand = hurtBy(false);
    const flee = hurtBy(true);
    ok(stand > flee && flee < b.player * 0.6, `running from the lunge costs ${flee}, standing still ${stand}`);
  }
  // a Shaken that is shot does flinch but is not otherwise special: two pistol shots kill it
  {
    const s = fresh();
    const sh = spawn(s.S, 'shaken', lane.x0, lane.z, 0, '_t');
    place(lane.x0 + 12, lane.z, Math.PI / 2);
    hit(s.S, sh, WEAPONS.pistol.damage, lane.x0 + 12, lane.z);
    ok(!sh.dead && sh.hp === def.hp - WEAPONS.pistol.damage, 'one pistol shot does not kill it (30 hp)');
    hit(s.S, sh, WEAPONS.pistol.damage, lane.x0 + 12, lane.z);
    ok(sh.dead && sh.burstDone, 'the second does, and it bursts (12 m from Naebun, so harmlessly)');
    ok(hp() === 1000, 'shooting it from range costs nothing');
  }
}

// ---- Bampot Longshot ----
{
  const def = ENEMY_DEFS.longshot;
  const C = def.charge;
  const { W } = fresh();
  const lane = findLane(W, 24);

  // the sequence: a visible red line that tracks, a lock, one heavy shot
  const duel = (onLock, standOff = 14) => {
    const s = fresh();
    const ls = spawn(s.S, 'longshot', lane.x0, lane.z, -Math.PI / 2, '_t');
    place(lane.x0 + standOff, lane.z, Math.PI / 2);
    wake(ls);
    const ev = { charge: -1, lock: -1, fire: -1, lines: [], arcs: 0 };
    let h0 = 1000;
    run(8, (t) => {
      if (ls.state === 'charge' && ev.charge < 0) ev.charge = t;
      if (ls.state === 'charge') ev.lines.push([ls.robot.laserOn, ls.robot.laserLocked, ls.robot.laserLen]);
      if (ls.locked && ev.lock < 0) {
        ev.lock = t;
        ev.arcs = s.S.damageDirs.length;
        if (onLock) onLock(s, ls);
        h0 = s.S.player.health;
      }
      if (ls.state === 'recover' && ev.fire < 0) ev.fire = t;
      return !(ev.fire >= 0 && t > ev.fire + 0.1);
    });
    return { s, ls, ev, dmg: h0 - s.S.player.health, lost: 1000 - s.S.player.health };
  };
  const stand = duel(null);
  ok(stand.ev.charge >= 0 && stand.ev.fire > 0, 'it charges and then fires');
  ok(near(stand.ev.fire - stand.ev.charge, C.track + C.lock, 0.06), `charge takes ${C.track + C.lock} s from first line to shot (${(stand.ev.fire - stand.ev.charge).toFixed(2)})`);
  ok(near(stand.ev.fire - stand.ev.lock, C.lock, 0.06), `the lock lasts ${C.lock} s before the shot, which is the dodge window (${(stand.ev.fire - stand.ev.lock).toFixed(2)})`);
  const lines = stand.ev.lines.slice(1); // (the line is set on the frame after the charge begins)
  ok(lines.length > 60 && lines.every((l) => l[0] && l[2] > 5), 'the laser line is showing, with length, for the whole charge');
  ok(lines[0][1] === false && lines[lines.length - 1][1] === true, 'it starts thin and red (not locked) and ends locked and white-hot');
  ok(stand.ev.arcs >= 1, 'at the lock a warning arc is raised on the HUD (so a Longshot out of view is noticed)');
  ok(stand.lost === def.damage, `standing still in the line costs ${def.damage} (${stand.lost})`);
  ok(def.damage >= 30 && def.damage <= 45, 'a heavy shot: several times a bottle (10)');
  ok(!stand.ls.robot.laserOn || stand.ls.state === 'recover', 'the line goes out after the shot');

  // dodgeable: step out of the line any time inside the lock and it misses
  const dodge = duel((s, ls) => { s.S.player.z += 1.6; });
  ok(dodge.lost === 0, `a sidestep of 1.6 m once the line has locked: no damage (${dodge.lost})`);
  const edgeIn = duel((s, ls) => { s.S.player.z += def.shot.halfWidth - 0.1; });
  ok(edgeIn.lost === def.damage, 'just inside the line width (0.4 m off): still hit');
  const edgeOut = duel((s, ls) => { s.S.player.z += def.shot.halfWidth + 0.1; });
  ok(edgeOut.lost === 0, 'just outside the line width (0.6 m off): missed');
  // the line follows a moving Naebun but only so fast: a strafe at running speed from the very start still gets hit if it stops at the lock
  const strafe = (() => {
    const s = fresh();
    const ls = spawn(s.S, 'longshot', lane.x0, lane.z, -Math.PI / 2, '_t');
    place(lane.x0 + 14, lane.z, Math.PI / 2);
    wake(ls);
    let locked = false;
    run(8, () => {
      if (ls.state === 'charge' && !ls.locked) s.S.player.z += 0.5 * DT * 3; // drifting across, slower than it can swing
      if (ls.locked) locked = true;
      return !(locked && ls.state === 'recover');
    });
    return 1000 - s.S.player.health;
  })();
  ok(strafe === def.damage, 'a slow drift while it tracks does not save you: it keeps up and the lock lands on you');

  // it cannot swing faster than charge.turn
  {
    const s = fresh();
    const ls = spawn(s.S, 'longshot', lane.x0 + 10, lane.z, -Math.PI / 2, '_t'); // faces east, away from the west
    place(lane.x0 + 4, lane.z, Math.PI / 2); // Naebun is west of it, behind it
    ls.yaw = -Math.PI / 2;
    wake(ls);
    ls.state = 'charge';
    ls.stateT = 0;
    ls.locked = false;
    ls.aimPitch = 0;
    const y0 = ls.yaw;
    run(0.5);
    const swung = Math.abs(((ls.yaw - y0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    ok(swung <= C.turn * 0.5 + 0.05 && swung > 0.5, `the line swings at most ${C.turn} rad/s (${swung.toFixed(2)} rad in 0.5 s)`);
  }

  // cover: a wall or pillar stops the shot; low cover does not
  const pillar = findBlock(W, true);
  const low = findBlock(W, false);
  ok(pillar !== null, 'found a full-height pillar to test cover with');
  if (pillar) {
    // a locked line through the pillar: Naebun stands behind it
    const throughPillar = (stand) => {
      const s = fresh();
      const ls = spawn(s.S, 'longshot', pillar.x - 6, pillar.z, -Math.PI / 2, '_t');
      place(stand, pillar.z, Math.PI / 2);
      wake(ls);
      ls.state = 'charge';
      ls.stateT = C.track; // already tracked: the next frame locks, with the line pointing at where Naebun is
      ls.locked = false;
      ls.aimPitch = Math.atan2(def.shot.aimY - 1.5, Math.abs(stand - ls.x));
      ls.yaw = -Math.PI / 2;
      let shots = 0;
      run(1.2, () => {
        if (ls.state === 'recover') shots++;
        return shots === 0;
      });
      return { lost: 1000 - s.S.player.health, fired: ls.state === 'recover' };
    };
    const behind = throughPillar(pillar.x + 5);
    const clear = throughPillar(pillar.x - 2.5);
    ok(behind.fired && behind.lost === 0, `Naebun behind a pillar on the line is not hit (fired ${behind.fired}, lost ${behind.lost})`);
    ok(clear.fired && clear.lost === def.damage, 'the same line with nothing in the way hits');
    // and it cannot start a charge without a line of sight, and gives up if it loses it while tracking
    const s = fresh();
    const ls = spawn(s.S, 'longshot', pillar.x - 6, pillar.z, -Math.PI / 2, '_t');
    place(pillar.x + 5, pillar.z, Math.PI / 2);
    wake(ls);
    ls.speedMult = 0.0001; // hold it still: left to itself it walks round the pillar to find a line, which is the point of cover
    let charged = false;
    run(2, () => { if (ls.state === 'charge') charged = true; });
    ok(!charged, 'no charge without a line of sight');
    ls.state = 'charge';
    ls.stateT = 0;
    ls.locked = false;
    run(C.lose + 0.4);
    ok(ls.state === 'chase' && !ls.robot.laserOn, `it gives up a charge that loses sight for ${C.lose} s while tracking`);
    ok(1000 - hp() === 0, 'and no shot came of it');
  }
  if (low) {
    const s = fresh();
    const ls = spawn(s.S, 'longshot', low.x - 6, low.z, -Math.PI / 2, '_t');
    place(low.x + 5, low.z, Math.PI / 2);
    wake(ls);
    ok(game.getWorld().los(ls.x, ls.z, low.x + 5, low.z), 'low cover does not block sight');
    ls.state = 'charge';
    ls.stateT = C.track;
    ls.aimPitch = Math.atan2(def.shot.aimY - 1.5, 11);
    run(1);
    ok(1000 - hp() === def.damage, 'low cover does not stop the shot (only walls and pillars do)');
  }

  // it keeps its distance and waits out a cooldown between shots
  {
    const s = fresh();
    const ls = spawn(s.S, 'longshot', lane.x0, lane.z, -Math.PI / 2, '_t');
    place(lane.x0 + 14, lane.z, Math.PI / 2);
    s.S.player.health = s.S.player.maxHealth = 1e6;
    wake(ls);
    const fires = [];
    run(16, () => { if (ls.state === 'recover' && ls.stateT === 0) fires.push(s.S.runT); });
    ok(fires.length >= 2, `it fires again (${fires.length} shots in 16 s)`);
    if (fires.length >= 2) {
      const gap = fires[1] - fires[0];
      ok(gap >= def.cooldown[0] + C.track + C.lock - 0.1 && gap <= def.cooldown[1] + C.track + C.lock + def.shot.recover + 1.2, `shots are ${gap.toFixed(1)} s apart (cooldown ${def.cooldown.join('-')} plus the ${(C.track + C.lock).toFixed(2)} s charge)`);
    }
    // close in and it backs off rather than trading blows
    place(ls.x + 5, ls.z, Math.PI / 2);
    ls.state = 'chase';
    ls.cool = 99;
    const d0 = Math.abs(s.S.player.x - ls.x);
    run(2, () => { s.S.player.x = ls.x + 5; });
    ok(Math.hypot(ls.x - s.S.player.x, ls.z - s.S.player.z) >= 5, `at 5 m (inside keepMin ${def.keepMin}) it backs away (was ${d0.toFixed(1)} m)`);
  }
}

// ---- Bampot Nurse ----
{
  const def = ENEMY_DEFS.nurse;
  const R = def.revive;
  const { W } = fresh();
  const lane = findLane(W, 24);
  const setup = (gap = 3, area = 'longvault') => {
    const s = fresh();
    const n = spawn(s.S, 'nurse', lane.x0, lane.z, -Math.PI / 2, area);
    const f = spawn(s.S, 'fizzbang', lane.x0 + gap, lane.z, 0, area);
    place(lane.x0 + 22, lane.z, Math.PI / 2); // far away (the Nurse only flees inside ${flee.from} m)
    wake(n);
    wake(f);
    f.cool = 99; // the Fizzbang does not go for Naebun during these tests
    return { ...s, n, f };
  };

  // timing: a few seconds after the body drops, if she is still alive
  {
    const { S, n, f } = setup(3);
    kill(S, f);
    ok(f.dead && S.kills === 1, 'the Fizzbang is dead and counted');
    let t = -1;
    let sawBeam = false;
    let sawRise = false;
    run(8, (tt) => {
      if (n.state === 'revive' && n.robot.beamOn) sawBeam = true;
      if (f.state === 'rise') sawRise = true;
      if (!f.dead && t < 0) t = tt;
      return f.dead;
    });
    ok(t > 0 && Math.abs(t - R.time) < 0.4, `the body gets up ${R.time} s after the channel starts (${t.toFixed(2)} s after it fell)`);
    ok(sawBeam, 'while she works the revive beam is showing');
    ok(f.state === 'rise' && near(f.hp, f.maxHp * R.hp, 0.5), `it is back at ${R.hp * 100} percent of its health (${f.hp.toFixed(0)} of ${f.maxHp})`);
    ok(S.kills === 0 && S.score === 0, 'the kill (and its score) is taken back, so kills and score stay true');
    run(R.rise + 0.2);
    ok(f.state !== 'rise' && !f.dead, 'after rising it is a normal robot again');
    ok(!n.robot.beamOn, 'the beam goes out when she is done');
    // once only
    kill(S, f);
    run(R.time + 3);
    ok(f.dead && f.revives === 1, 'a robot is revived once, then stays dead');
    ok(S.kills === 1, 'and the second kill counts');
  }
  // range and line of sight
  {
    const near_ = setup(R.range - 0.5);
    kill(near_.S, near_.f);
    run(R.time + 1.2);
    ok(!near_.f.dead, `a body ${R.range - 0.5} m away (inside ${R.range}) is revived`);
    const far_ = setup(R.range + 0.6);
    kill(far_.S, far_.f);
    run(R.time + 4);
    ok(far_.f.dead, `a body ${R.range + 0.6} m away (outside ${R.range}) is not`);
  }
  {
    const pillar = findBlock(W, true);
    ok(pillar !== null, 'found a pillar for the sight-line check');
    if (pillar) {
      const s = fresh();
      const n = spawn(s.S, 'nurse', pillar.x - 2.5, pillar.z, -Math.PI / 2, 'longvault');
      const f = spawn(s.S, 'fizzbang', pillar.x + 2.5, pillar.z, 0, 'longvault');
      place(pillar.x - 20, pillar.z, 0);
      wake(n);
      kill(s.S, f);
      run(R.time + 3);
      ok(f.dead, 'a body behind a pillar (no line of sight, 5 m) is not revived');
    }
  }
  // bosses, Shakens and Nurses are not revived
  {
    const s = fresh();
    const n = spawn(s.S, 'nurse', lane.x0, lane.z, -Math.PI / 2, 'longvault');
    const boss = spawn(s.S, 'tourguide', lane.x0 + 3, lane.z, 0, 'longvault');
    const bouncer = spawn(s.S, 'bouncer', lane.x0 + 3, lane.z + 0.9, 0, 'longvault');
    const sh = spawn(s.S, 'shaken', lane.x0 + 2, lane.z - 0.9, 0, 'longvault');
    const n2 = spawn(s.S, 'nurse', lane.x0 + 1.5, lane.z + 0.9, 0, 'longvault');
    place(lane.x0 + 22, lane.z, Math.PI / 2);
    wake(n);
    for (const x of [boss, bouncer, sh, n2]) kill(s.S, x);
    run(R.time + 4);
    ok(boss.dead && bouncer.dead, 'bosses are not revived (the Tour Guide, the Bouncer)');
    ok(sh.dead && sh.burstDone, 'a burst Shaken leaves no body to revive');
    ok(n2.dead, 'another Nurse is not revived');
    ok(s.S.kills === 4, `all four stay counted (${s.S.kills})`);
  }
  // kill order: the Nurse first and nothing comes back; the Nurse inside the channel and it is cut short
  {
    const a = setup(3);
    kill(a.S, a.n);
    kill(a.S, a.f);
    run(R.time + 4);
    ok(a.f.dead && a.S.kills === 2, 'Nurse first, then the Fizzbang: it stays down');
    const b = setup(3);
    kill(b.S, b.f);
    run(R.time * 0.5);
    ok(b.n.state === 'revive' && b.n.robot.beamOn, 'half way through the channel she is still working');
    kill(b.S, b.n);
    ok(!b.n.robot.beamOn, 'killing her puts the beam out at once');
    run(R.time + 4);
    ok(b.f.dead && b.S.kills === 2, 'killed mid-channel: the body stays down');
    const c = setup(3);
    kill(c.S, c.f);
    run(R.time + 1);
    ok(!c.f.dead, 'control: left alone she does revive it');
  }
  // she is not an attacker
  {
    const { S, n } = setup(3);
    place(n.x + 1.0, n.z, Math.PI / 2);
    S.player.health = 1000;
    n.state = 'chase';
    run(10, () => { place(n.x + 1.0, n.z, Math.PI / 2); });
    ok(hp() === 1000, 'standing next to a Nurse for 10 s costs nothing');
    ok(!def.damage && !def.ranged && !def.reach, 'no attack numbers at all in her definition');
  }
  // she keeps away from Naebun, slowly
  {
    const s = fresh();
    const n = spawn(s.S, 'nurse', lane.x0 + 12, lane.z, -Math.PI / 2, 'longvault');
    place(n.x - 4, lane.z, -Math.PI / 2);
    wake(n);
    let moved = 0;
    let prev = [n.x, n.z];
    const d0 = Math.hypot(n.x - s.S.player.x, n.z - s.S.player.z);
    const t = run(3, () => {
      moved += Math.hypot(n.x - prev[0], n.z - prev[1]);
      prev = [n.x, n.z];
    });
    const speed = moved / t;
    const d1 = Math.hypot(n.x - s.S.player.x, n.z - s.S.player.z);
    ok(d1 > d0 + 2, `she backs away from Naebun (${d0.toFixed(1)} m to ${d1.toFixed(1)} m in 3 s)`);
    ok(speed > def.speed * 0.8 && speed <= def.speed * 1.02, `at her own slow speed, ${speed.toFixed(2)} m/s (${def.speed}), well under Naebun's 4.4`);
  }
}

// ---- Nurse and the area-clear logic ----
{
  const def = ENEMY_DEFS.nurse;
  const R = def.revive;
  const { W } = fresh();
  const lane = findLane(W, 24);
  const areaOf = (S, id) => S.areas.find((a) => a.def.id === id);
  const door = (W2, id) => W2.doors.find((d) => d.id === id);
  const rig = () => {
    const s = fresh();
    // the area under test, 'longvault' (its door is d2) gets robots; everything else has none and clears at once, which is fine
    const n = spawn(s.S, 'nurse', lane.x0, lane.z, -Math.PI / 2, 'longvault');
    const f = spawn(s.S, 'fizzbang', lane.x0 + 3, lane.z, 0, 'longvault');
    place(lane.x0 + 22, lane.z, Math.PI / 2);
    wake(n);
    wake(f);
    f.cool = 99;
    s.W.setDoorOpen('d2', false);
    return { ...s, n, f };
  };
  {
    // a body waiting to be revived does not clear the area, because the Nurse is alive and counts as a robot
    const { S, W: W2, n, f } = rig();
    run(0.2);
    ok(!areaOf(S, 'longvault').cleared && areaOf(S, 'longvault').alive === 2, 'two robots, area not clear');
    kill(S, f);
    run(1);
    ok(areaOf(S, 'longvault').alive === 1 && !areaOf(S, 'longvault').cleared && !door(W2, 'd2').open, 'with the Fizzbang down and the Nurse alive the area is not clear and the door is shut');
    let during = true;
    run(R.time + 0.5, () => { if (areaOf(S, 'longvault').cleared || door(W2, 'd2').open) during = false; });
    ok(during, 'the door never opens while she is channelling');
    ok(!f.dead && areaOf(S, 'longvault').alive === 2 && !areaOf(S, 'longvault').cleared, 'the revived robot counts again: two alive, not clear');
    // kill both properly: Nurse first, then the body, then the area clears and the door opens
    kill(S, n);
    kill(S, f);
    run(0.5);
    ok(areaOf(S, 'longvault').cleared && door(W2, 'd2').open, 'when the last of them is dead the area clears and the door opens');
    ok(S.kills === S.enemies.length && S.kills === 2, `kills match the robots (${S.kills} of ${S.enemies.length}) after a revive and a second kill`);
  }
  {
    // kill the body, then the Nurse before the revive lands: the area clears with the body still down
    const { S, W: W2, n, f } = rig();
    kill(S, f);
    run(1.5);
    kill(S, n);
    run(0.5);
    ok(areaOf(S, 'longvault').cleared && door(W2, 'd2').open && f.dead, 'Nurse killed mid-channel: the area clears, the body stays down');
    run(R.time + 3);
    ok(f.dead && areaOf(S, 'longvault').cleared && door(W2, 'd2').open, 'and nothing comes back afterwards');
  }
  {
    // an area that has already been cleared never gets a revive, and its door stays open whatever happens
    const s = fresh();
    run(0.5); // nothing in 'longvault': it clears and d2 opens
    const A = areaOf(s.S, 'longvault');
    ok(A.cleared && door(s.W, 'd2').open, 'setup: the Long Vault is clear and its door is open');
    const n = spawn(s.S, 'nurse', lane.x0, lane.z, -Math.PI / 2, 'longvault');
    const f = spawn(s.S, 'fizzbang', lane.x0 + 3, lane.z, 0, 'longvault');
    place(lane.x0 + 22, lane.z, Math.PI / 2);
    wake(n);
    wake(f);
    f.cool = 99;
    kill(s.S, f);
    run(R.time + 3);
    ok(f.dead && f.revives === 0, 'a body in an already-cleared area is not revived');
    ok(A.cleared && door(s.W, 'd2').open, 'and the open door stays open (a cleared area is latched)');
    // even a robot that does come back in a cleared area (forced) does not shut the door
    f.dead = false;
    f.state = 'chase';
    run(1);
    ok(A.cleared && door(s.W, 'd2').open && A.alive >= 1, 'a robot alive in a cleared area: the count shows it, the door stays open');
  }
  {
    // both killed in the same frame (Last Orders, say): nothing revives, the area clears
    const { S, W: W2, n, f } = rig();
    game.testHook('killArea', 'longvault');
    run(R.time + 2);
    ok(n.dead && f.dead && areaOf(S, 'longvault').cleared && door(W2, 'd2').open, 'everything killed at once: clear, open, no revive');
    ok(S.kills === 2, 'two kills');
  }
  {
    // the Nurse must belong to the same area: a body in the next area is not hers to revive
    const s = fresh();
    const n = spawn(s.S, 'nurse', lane.x0, lane.z, -Math.PI / 2, 'longvault');
    const f = spawn(s.S, 'fizzbang', lane.x0 + 3, lane.z, 0, 'casks');
    place(lane.x0 + 22, lane.z, Math.PI / 2);
    wake(n);
    kill(s.S, f);
    run(R.time + 3);
    ok(f.dead, 'a body that belongs to another area is not revived by this Nurse');
  }
}

// ---- Vending Mimic ----
{
  const def = ENEMY_DEFS.mimic;
  const D = def.dormant;
  const { W } = fresh();
  const lane = findLane(W, 24);
  const areaOf = (S, id) => S.areas.find((a) => a.def.id === id);
  const setup = (dist = 8) => {
    const s = fresh();
    const m = spawn(s.S, 'mimic', lane.x0, lane.z, Math.PI / 2, 'longvault'); // facing east, the way the player will come
    place(lane.x0 + dist, lane.z, Math.PI / 2);
    return { ...s, m };
  };

  // dormant: still, short, counted, hit like any robot
  {
    const { S, m } = setup(8);
    ok(m.state === 'idle' && m.fixed && near(m.h, D.h, 1e-9) && near(m.headY, D.headY, 1e-9), 'it starts dormant: idle, immovable, a machine tall');
    ok(m.robot.height > m.h && m.robot.dormantHeight === D.h, 'the awake robot is taller than the machine');
    run(5);
    ok(m.state === 'idle', 'dormant for 5 s with Naebun 8 m off in plain sight');
    ok(areaOf(S, 'longvault').alive === 1 && !areaOf(S, 'longvault').cleared, 'it counts as a robot for its area: alive 1, not clear');
    ok(S.totalEnemies === 1, 'and in the total');
  }
  // noise and other robots do not wake it
  {
    const { S, m } = setup(8);
    const f = spawn(S, 'fizzbang', lane.x0 + 4, lane.z + 1.2, 0, 'longvault');
    const inp = input();
    inp.keys.add(' '); // fire the pistol (facing away from the machine): a gunshot wakes idle robots that can see Naebun
    place(lane.x0 + 8, lane.z, -Math.PI / 2);
    run(1.5, () => { S.player.pitch = 0; }, inp);
    ok(f.state !== 'idle', 'control: a gunshot wakes an ordinary robot');
    ok(m.state === 'idle', 'but not the Mimic (it ignores noise and the area being woken)');
    hit(S, f, 5, lane.x0 + 9, lane.z);
    run(0.5);
    ok(m.state === 'idle', 'nor another robot in its area being hit');
  }
  // walking up to it
  {
    const wakeAt = (dist) => {
      const s = setup(dist);
      run(0.5);
      return s.m.state !== 'idle';
    };
    ok(!wakeAt(D.wake + 0.4) && wakeAt(D.wake - 0.4), `it unfolds when Naebun comes inside ${D.wake} m (3.8 m: no, 3.0 m: yes)`);
    const pillar = findBlock(W, true);
    if (pillar) {
      const s = fresh();
      const m = spawn(s.S, 'mimic', pillar.x - 1.3, pillar.z, 0, 'longvault');
      place(pillar.x + 1.6, pillar.z, 0); // 2.9 m away, but the pillar is between them
      run(1);
      ok(m.state === 'idle', 'a wall between them (2.9 m, no line of sight): it stays disguised');
    }
  }
  // the unfolding: vulnerable, harmless, then a melee robot
  {
    const { S, m } = setup(3.0);
    S.player.health = 1000;
    run(0.3);
    ok(m.state === 'unfold' && !m.fixed && near(m.h, m.robot.height, 1e-9), 'it is unfolding and now the robot\'s height');
    const h1 = m.hp;
    hit(S, m, 20, lane.x0 + 3, lane.z);
    ok(m.hp === h1 - 20, 'it can be hurt while it unfolds');
    ok(hp() === 1000, 'and cannot hurt Naebun yet');
    run(D.unfold + 0.1);
    ok(m.state !== 'unfold' && m.state !== 'idle', 'unfolded after the unfold time into a chasing robot');
    place(lane.x0 + 1.25, lane.z, Math.PI / 2);
    let first = 0;
    run(4, () => { if (hp() < 1000 && !first) { first = 1000 - hp(); return false; } return true; });
    ok(first === def.damage, `then it fights like a Fizzbang: a swing for ${def.damage} (${first})`);
  }
  // shot while disguised
  {
    const { S, m } = setup(8);
    const x0 = m.x;
    const z0 = m.z;
    hit(S, m, 10, lane.x0 + 8, lane.z, 6);
    ok(m.hp === def.hp - 10 && m.state === 'unfold', 'a shot while disguised does its damage and wakes it');
    run(0.1);
    ok(m.x === x0 && m.z === z0, 'a hit does not shove a machine about');
  }
  // bullets: the dormant machine is hit exactly like a robot
  {
    const shootAt = (kind, pitch) => {
      const s = fresh();
      const e = spawn(s.S, kind, lane.x0, lane.z, Math.PI / 2, 'longvault');
      if (kind === 'mimic') e.checkT = 99; // stay disguised for the test (it would unfold if it saw Naebun close)
      place(lane.x0 + 8, lane.z, Math.PI / 2);
      s.S.player.pitch = pitch;
      s.S.player.switchT = 0;
      const inp = input();
      inp.keys.add(' ');
      run(0.12, () => { s.S.player.pitch = pitch; s.S.player.x = lane.x0 + 8; }, inp);
      return e.maxHp - e.hp;
    };
    const mimicHit = shootAt('mimic', 0);
    const fizzHit = shootAt('fizzbang', 0);
    ok(mimicHit > 0 && mimicHit === fizzHit, `a level shot does the same to a dormant Mimic as to a Fizzbang (${mimicHit} and ${fizzHit}: both 'head' height, the same rule)`);
    const low_ = shootAt('mimic', -0.12);
    ok(low_ === WEAPONS.pistol.damage, `a body shot does the pistol's ${WEAPONS.pistol.damage} (${low_}), no armour`);
    const over = shootAt('mimic', 0.06); // passes over a 1.92 m machine
    ok(over === 0, 'a shot that clears the top of the machine misses it (the hit shape is the machine, not the awake robot)');
    const s = fresh();
    const m = spawn(s.S, 'mimic', lane.x0, lane.z, Math.PI / 2, 'longvault');
    unfoldAndShoot(s, m);
  }
  function unfoldAndShoot(s, m) {
    place(lane.x0 + 8, lane.z, Math.PI / 2);
    m.state = 'chase';
    m.fixed = false;
    m.h = m.robot.height;
    m.headY = m.robot.headY;
    m.cool = 99;
    m.x = lane.x0;
    m.z = lane.z;
    s.S.player.pitch = 0.06;
    s.S.player.switchT = 0;
    const inp = input();
    inp.keys.add(' ');
    run(0.12, () => { s.S.player.pitch = 0.06; s.S.player.x = lane.x0 + 8; m.x = lane.x0; m.z = lane.z; }, inp);
    ok(m.maxHp - m.hp > 0, 'the same shot hits it once it is awake and taller');
  }
  // a machine is not shoved about by other robots
  {
    const { S, m } = setup(8);
    const f = spawn(S, 'fizzbang', m.x + 0.4, m.z, 0, 'longvault');
    wake(f);
    f.cool = 99;
    const x0 = m.x;
    const z0 = m.z;
    run(1);
    ok(m.x === x0 && m.z === z0 && Math.hypot(f.x - m.x, f.z - m.z) > 0.4, 'a robot crowding it is pushed off; the machine does not move');
  }
  // area clear: a dormant Mimic holds the door shut, and killing it opens it
  {
    const { S, W: W2, m } = setup(12);
    W2.setDoorOpen('d2', false);
    run(2);
    ok(!areaOf(S, 'longvault').cleared && !W2.doors.find((d) => d.id === 'd2').open, 'a dormant Mimic is the only robot in the area: the door stays shut');
    kill(S, m);
    run(0.3);
    ok(areaOf(S, 'longvault').cleared && W2.doors.find((d) => d.id === 'd2').open && S.kills === 1, 'killed while dormant: the area clears, the door opens, one kill');
  }
  // revived by a Nurse it comes back awake
  {
    const s = fresh();
    const n = spawn(s.S, 'nurse', lane.x0, lane.z, -Math.PI / 2, 'longvault');
    const m = spawn(s.S, 'mimic', lane.x0 + 3, lane.z, 0, 'longvault');
    place(lane.x0 + 22, lane.z, Math.PI / 2);
    wake(n);
    kill(s.S, m);
    run(ENEMY_DEFS.nurse.revive.time + ENEMY_DEFS.nurse.revive.rise + 1);
    ok(!m.dead && m.state !== 'idle' && m.state !== 'unfold' && !m.fixed && m.revives === 1, 'a revived Mimic gets up as a robot (it does not fold back into a machine)');
  }
}

// ---- models and sounds are wired up ----
{
  const M = await import('../../src/models.js');
  ok(JSON.stringify(M.PREPARED_KINDS) === JSON.stringify(KINDS), 'models.js lists the four kinds');
  const r = M.makeRobot('longshot');
  ok(r.pivot && r.pivot.up === 1.5 && r.pivot.fwd === 0.3 && typeof r.setLaser === 'function', 'Longshot: pivot and laser');
  ok(typeof M.makeRobot('nurse').setBeam === 'function' && typeof M.makeRobot('shaken').setBlast === 'function', 'Nurse: beam; Shaken: blast ring');
  for (const f of ['rattle', 'hiss', 'fizz', 'snipeCharge', 'lock', 'snipe', 'reviveStart', 'reviveDone', 'unfold']) {
    ok(typeof audio[f] === 'function', `audio.${f} exists`);
    audio[f]();
  }
}

console.log(`\nenemies-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
