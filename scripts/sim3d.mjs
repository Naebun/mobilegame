// Headless playtest bot for the first-person levels. Runs the real game logic (src/game3d.js) at 60 Hz in Node,
// with no rendering, driven by a bot that navigates, aims, strafes and picks weapons.
//
//   node scripts/sim3d.mjs [--runs 30] [--skill sloppy|casual|good|both] [--trace SEED] [--level 1|2]
//   node scripts/sim3d.mjs --scenario shaken|longshot|nurse|mimic|pack [--runs 30] [--skill ...] [--blind 1]
//
// NORMAL MODE ONLY: balance is never tuned against debug mode. The bot is a proxy for a person, not a replacement:
// it answers "is the level winnable, and roughly how hard is each area", not "is it fun".
//
// What the bots know about the newer things (docs/enemies-next.md, docs/arsenal.md). All of it is a guess at how a person
// of that skill plays, with delays and misses, and none of it has been checked against a person:
//   Longshot  after the lock, a sidestep out of the locked line (skipped if a wall already covers it), after a reaction time;
//             the sloppy bot often notices too late, the good one almost never.
//   Shaken    walks away from it inside a distance that depends on skill and does not fire at it closer than 3.5 m, so
//             it dies beyond the blast. Cornered, it fights.
//   Nurse     shot first by the good bot, and by the casual bot once she has a body to work on; the sloppy bot reacts only
//             once she is channelling (a revive takes 3.6 s). A harmless target: it walks up to her rather than backing off.
//   Mimic     the good and casual bots shoot a machine they can see from a distance (they suspect it); the sloppy one
//             walks up to it and finds out the hard way.
//   Weapons   Feedback Beam on bosses and mimics, Bass-Drop Grenade on a pack of three, Airhorn when two are on top of it,
//             the SMG's alt-fire when the pedal is fitted. Upgrades and records are picked up within a reach that depends on skill.
// A level without any of these behaves as it always did: every new decision uses its own random stream and is only
// taken when one of the new things exists, so the old numbers stay comparable.
import { pathToFileURL } from 'node:url';
import * as game from '../src/game3d.js';
import { UPGRADES, WEAPONS } from '../src/data.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const RUNS = Number(args.runs || 30);
const SKILLS = args.skill === 'both' || !args.skill ? ['sloppy', 'casual', 'good'] : [args.skill];
const TRACE = args.trace === undefined ? null : Number(args.trace);
const LEVEL = Number(args.level || 1);
const VIEW = { w: 390, h: 844, dpr: 1, safe: { top: 0, bottom: 0 } };
const DT = 1 / 60;
const LIMIT = 900; // seconds of game time before a run counts as stuck

const SKILL = {
  sloppy: {
    sigma: 0.16, react: 0.55, turn: 3, tol: 0.1,
    lockReact: 0.45, lockNotice: 0.45, shakenAvoid: 4.2, nurse: 'late', mimicShoot: 0, reach: 15, recordReach: 8,
  },
  casual: {
    sigma: 0.07, react: 0.3, turn: 5, tol: 0.06,
    lockReact: 0.28, lockNotice: 0.7, shakenAvoid: 5.5, nurse: 'seen', mimicShoot: 7, reach: 28, recordReach: 14,
  },
  good: {
    sigma: 0.025, react: 0.15, turn: 8, tol: 0.04,
    lockReact: 0.16, lockNotice: 0.9, shakenAvoid: 7, nurse: 'first', mimicShoot: 10, reach: 60, recordReach: 24,
  },
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
const kindOf = (e) => e.kind;

// Scenarios: a few robots in the open dancefloor of level 1 (nothing else awake), to check that a bot copes with one new
// thing at a time. The player stands at the south end, the robots are 14 to 20 m up the room.
const SCENARIOS = {
  shaken: { kinds: ['shaken', 'shaken', 'shaken'] },
  longshot: { kinds: ['longshot'] },
  nurse: { kinds: ['nurse', 'fizzbang', 'fizzbang'] },
  mimic: { kinds: ['mimic'] },
  pack: { kinds: ['fizzbang', 'fizzbang', 'fizzbang', 'fizzbang'] },
};

let inited = false;

export function runOnce(seed, skillName, opts = {}) {
  const level = opts.level || LEVEL;
  const rng = mulberry32(seed * 7919 + (skillName === 'good' ? 13 : 0));
  const rng2 = mulberry32(seed * 104729 + 17 + (skillName === 'good' ? 5 : 0)); // for the newer decisions only
  Math.random = rng;
  const gauss = () => Math.sqrt(-2 * Math.log(rng() || 1e-9)) * Math.cos(6.283185 * rng());
  const sk = { ...SKILL[skillName], ...(opts.skill || {}) };

  // Building a world takes seconds, so the game is initialised once per process and each run just resets the level (the
  // robots, pickups and player). `--exact 1` initialises afresh every run, which is what this file did before: it gives the
  // same runs as the old simulator on an unchanged level, but takes about twice as long.
  if (!inited || args.exact === '1') game.init(VIEW);
  inited = true;
  game.testHook('level', level);
  game.testHook('torch', { attached: true }); // the bot never watches the torch being fitted
  const S = game.getState();
  const W = game.getWorld();
  if (S.debugMode) throw new Error('simulator must run in normal mode');
  const p = S.player;
  if (opts.scenario) {
    // an arena on level 1's dancefloor: clear the level's own robots and pickups, then spawn the scenario's
    S.enemies.length = 0;
    S.pickups.length = 0;
    const sc = SCENARIOS[opts.scenario];
    game.testHook('teleport', { x: 17 * 2 + 1, z: 36 * 2 + 1, yaw: 0 });
    p.yaw = 0;
    S.totalEnemies = 0;
    sc.kinds.forEach((kind, i) => {
      const near = Number(args.dist || 16) / 2; // metres to rows
      const col = kind === 'longshot' ? 17 + 2 : kind === 'mimic' ? 17 : 14 + i * 3;
      const row = kind === 'longshot' ? Math.round(36 - Math.max(near, 7)) : Math.round(36 - near) - (kind === 'mimic' ? 0 : i % 2);
      const idx = game.testHook('spawn', { kind, x: col * 2 + 1, z: row * 2 + 1, yaw: 0, area: 'dancefloor' });
      const e = S.enemies[idx];
      if (kind !== 'mimic') { e.state = 'chase'; e.stateT = 1; e.cool = 0.5; e.wakeDelay = -1; }
    });
  }
  const input = { touches: new Map(), pressed: [], keys: new Set() };
  // A flow field only changes with its start tile and with which doors are solid, so the bot recomputes it then and not every
  // frame (the answers are identical, this is only to make the runs quicker).
  const doorSig = () => W.doors.map((d) => (W.isSolidAt(d.x, d.z) ? 1 : 0)).join('');
  const cachedFlow = () => {
    const f = W.createFlowField();
    let key = '';
    return {
      update(x, z) {
        const k = `${Math.floor(x / 2)},${Math.floor(z / 2)}|${doorSig()}`;
        if (k !== key) { key = k; f.update(x, z); }
      },
      distAt: (x, z) => f.distAt(x, z),
      dirAt: (x, z) => f.dirAt(x, z),
    };
  };
  const goalFlow = cachedFlow();
  const probe = cachedFlow();

  let t = 0;
  let react = 0;
  let aimErr = { yaw: 0, pitch: 0 };
  let target = null;
  let strafe = 1;
  let strafeT = 0;
  let swapT = 0;
  let taken = 0;
  const areaTimes = {};
  const dmgBy = { melee: 0, ranged: 0, sniper: 0, blast: 0 };
  const diedTo = {};
  let lastSource = '';
  const burstSeen = new Set();
  const lock = new Map(); // longshot -> { t0, notice, react, dir } for the shot it is charging now
  const use = { grenade: 0, airhorn: 0, alt: 0, beam: 0, lasers: 0, sniped: 0, dodged: 0, revives: 0 };
  let prevAmmo = { grenade: 0, airhorn: 0 };
  let altPress = false;
  let prevAltLeft = 0;
  let prevRevives = 0;

  // Where can a walker go from here? Used for running away: the heading that gets furthest from `from`, with room to run.
  const room = (dx, dz, steps = 8) => {
    let x = p.x;
    let z = p.z;
    let got = 0;
    for (let s = 0; s < steps; s++) {
      const mv = W.moveCircle(x, z, dx * 0.6, dz * 0.6, 0.45);
      const g = Math.hypot(mv.x - x, mv.z - z);
      if (g < 0.45) break;
      x = mv.x;
      z = mv.z;
      got += g;
    }
    return got;
  };
  const awayFrom = (fx, fz) => {
    const ax = p.x - fx;
    const az = p.z - fz;
    const al = Math.hypot(ax, az) || 1;
    let best = null;
    let bs = -1e9;
    let bestRoom = 0;
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const r = room(dx, dz);
      const score = (Math.min(r, 4.8) / 4.8) * 1.2 + ((dx * ax + dz * az) / al) * 1.6;
      if (score > bs) { bs = score; best = { x: dx, z: dz }; bestRoom = r; }
    }
    return bestRoom < 1.5 ? null : best; // cornered: no point running
  };

  const hpFrac = () => p.health / p.maxHealth;
  const bodyForNurse = (n) => S.enemies.some((c) => c.dead && !c.boss && !c.def.noRevive && c.revives < 1 && c.areaId === n.areaId && c.deadT < 14);

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
      const cand = awake.slice();
      // a drinks machine that has not moved: the careful bots shoot it from a distance, the sloppy one walks up to it
      if (sk.mimicShoot > 0) {
        for (const e of alive) if (e.def.ai === 'mimic' && e.state === 'idle') cand.push(e);
      }
      for (const e of cand) {
        const d = Math.hypot(e.x - p.x, e.z - p.z);
        const los = W.los(p.x, p.z, e.x, e.z);
        let score = d + (los ? 0 : 40);
        const ai = e.def.ai;
        if (ai === 'mimic' && e.state === 'idle') {
          if (!los || d > sk.mimicShoot || d < 3.6) continue;
          score += 6; // awake things first
        } else if (ai === 'shaken') {
          if (los && d < 11) score -= sk.nurse === 'late' ? 6 : 14;
        } else if (ai === 'nurse') {
          const hunt = sk.nurse === 'first' || (sk.nurse === 'seen' && (e.state === 'revive' || bodyForNurse(e)) ) || e.state === 'revive';
          if (hunt && los) score -= 30;
        } else if (ai === 'longshot') {
          if (los && sk.nurse !== 'late') score -= 8;
        }
        if (score < bd) { bd = score; best = e; }
      }
      target = best;
      aimErr = { yaw: gauss() * sk.sigma, pitch: gauss() * sk.sigma * 0.6 };
    }
    if (target && target.dead) target = null;

    const seen = target && W.los(p.x, p.z, target.x, target.z);
    const tdist = target ? Math.hypot(target.x - p.x, target.z - p.z) : 0;

    // ---- the Longshot's lock: a sidestep out of the frozen line ----
    let dodgeDir = null;
    for (const e of alive) {
      if (e.def.ai !== 'longshot') continue;
      if (e.state !== 'charge' || !e.locked) { lock.delete(e); continue; }
      let L = lock.get(e);
      if (!L) {
        const pv = e.robot.pivot || { up: 1.5, fwd: 0.3 };
        const hx = -Math.sin(e.yaw);
        const hz = -Math.cos(e.yaw);
        const ox = e.x + hx * pv.fwd;
        const oz = e.z + hz * pv.fwd;
        const wall = W.raycast(ox, oz, hx, hz, e.def.range);
        const along = (p.x - ox) * hx + (p.z - oz) * hz;
        const lateral = Math.abs((p.x - ox) * hz - (p.z - oz) * hx);
        const threatened = along > 0 && along < wall && lateral < e.def.shot.halfWidth + 0.5;
        use.lasers++;
        L = { t0: t, hx, hz, ox, oz, wall, threatened, notice: threatened && rng2() < sk.lockNotice, react: sk.lockReact * (0.7 + 0.6 * rng2()), side: 0 };
        lock.set(e, L);
      }
      if (L.notice && t - L.t0 >= L.react) {
        const lateral = (p.x - L.ox) * L.hz - (p.z - L.oz) * L.hx; // signed
        if (Math.abs(lateral) < 1.0) {
          // step to whichever side the line is already on (or has more room), and keep going the same way
          if (!L.side) {
            const r1 = room(L.hz, -L.hx, 4);
            const r2 = room(-L.hz, L.hx, 4);
            L.side = Math.abs(lateral) > 0.1 ? Math.sign(lateral) : (r1 >= r2 ? 1 : -1);
            if ((L.side > 0 ? r1 : r2) < 1.0) L.side = -L.side;
            use.dodged++;
          }
          dodgeDir = { x: L.hz * L.side, z: -L.hx * L.side };
        }
      }
    }

    // ---- a Shaken closing in: walk away from it, shoot it from beyond the blast ----
    let shaken = null;
    let shakenD = 1e9;
    for (const e of awake) {
      if (e.def.ai !== 'shaken') continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < shakenD && (d < sk.shakenAvoid || (e.state === 'prime' && d < sk.shakenAvoid + 2))) { shaken = e; shakenD = d; }
    }
    let fleeDir = null;
    if (shaken) fleeDir = awayFrom(shaken.x, shaken.z);

    // movement goal
    let gx = 0;
    let gz = 0;
    let moveDir = null;
    const nearReach = (d) => d <= sk.reach;
    if (target && seen) {
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      const nx = dx / d;
      const nz = dz / d;
      const melee = !target.def.ranged;
      if (target.def.support) { // a nurse never attacks: walk up to her, then hold a steady range
        if (d > 7) moveDir = { x: nx, z: nz };
        else moveDir = { x: -nz * strafe, z: nx * strafe };
      } else if (target.def.ai === 'mimic' && target.state === 'idle') {
        if (d > sk.mimicShoot - 1.5) moveDir = { x: nx, z: nz };
        else moveDir = { x: -nz * strafe, z: nx * strafe };
      } else if (melee && d < 5.5) moveDir = { x: -nx + -nz * strafe * 0.6, z: -nz + nx * strafe * 0.6 }; // back off while shooting
      else if (!melee && d > 10) moveDir = { x: nx, z: nz };
      else moveDir = { x: -nz * strafe, z: nx * strafe };
    } else {
      // walk to the nearest reachable thing worth walking to: a weapon we lack, an alive enemy, or the exit
      let goal = null;
      let gd = 1e9;
      probe.update(p.x, p.z);
      const consider = (x, z) => {
        const d = probe.distAt(x, z);
        if (d < gd) { gd = d; goal = { x, z }; }
      };
      for (const pk of S.pickups) {
        if (pk.taken) continue;
        const k = pk.def.kind;
        if (k === 'upgrade') {
          if ((p.upgrades[pk.def.item] || 0) < UPGRADES[pk.def.item].tiers.length && nearReach(probe.distAt(pk.def.x, pk.def.z))) consider(pk.def.x, pk.def.z);
        } else if (k === 'record') {
          if (awake.length === 0 && probe.distAt(pk.def.x, pk.def.z) <= sk.recordReach) consider(pk.def.x, pk.def.z);
        } else if (k === 'weapon' && WEAPONS[pk.def.item].prepared) {
          if (!p.owned[pk.def.item] && nearReach(probe.distAt(pk.def.x, pk.def.z))) consider(pk.def.x, pk.def.z);
        } else if (!(k === 'weapon' && p.owned[pk.def.item])) if (k === 'weapon' || p.health < p.maxHealth * 0.7) consider(pk.def.x, pk.def.z);
      }
      if (!goal) for (const e of alive) consider(e.x, e.z);
      if (!goal && S.allClear) consider(W.exit.x, W.exit.z);
      if (goal) {
        goalFlow.update(goal.x, goal.z);
        const f = goalFlow.dirAt(p.x, p.z);
        if (f) moveDir = f;
        else { gx = goal.x - p.x; gz = goal.z - p.z; moveDir = { x: gx, z: gz }; }
      }
    }
    if (fleeDir) moveDir = fleeDir;
    if (dodgeDir) moveDir = dodgeDir;

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
    // never shoot a Shaken that is inside its own blast of Naebun: it bursts when it dies
    if (firing && target.def.ai === 'shaken' && tdist < target.def.burst.radius + 0.3) firing = false;

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
      // the newer weapons (only when owned, so a level without them plays as before)
      const live = (id) => p.owned[id] && p.ammo[id] > 0;
      if (live('beam') && p.ammo.beam > 22 && seen && d <= 15 && (target.boss || target.def.ai === 'mimic')) want = 'beam';
      const grenadeFlying = S.projectiles.some((pr) => pr.grenade);
      const pack = awake.filter((e) => !e.boss && !(e.stunT > 0) && !e.def.support && Math.hypot(e.x - p.x, e.z - p.z) < 6.5 && W.los(p.x, p.z, e.x, e.z));
      if (live('grenade') && !grenadeFlying && (pack.length >= 3 || (pack.length >= 2 && hpFrac() < 0.5))) want = 'grenade';
      const onTop = awake.filter((e) => !e.def.ranged && !e.def.support && e.def.ai !== 'shaken' && !(e.stunT > 0) && Math.hypot(e.x - p.x, e.z - p.z) < 3.4 && W.los(p.x, p.z, e.x, e.z));
      if (live('airhorn') && (onTop.length >= 2 || (onTop.length >= 1 && hpFrac() < 0.45))) want = 'airhorn';
      if (p.weapon !== want && p.ammo[want] > 0) { input.keys.add('q'); swapT = 0.35; } else input.keys.delete('q');
    } else input.keys.delete('q');
    // a grenade is thrown once, not three times in a row
    if (p.weapon === 'grenade' && S.projectiles.some((pr) => pr.grenade)) firing = false;

    // the SMG's second mode, when the pedal is fitted: a burst when the target is close enough to be sure of
    altPress = false;
    if (p.weapon === 'smg' && p.upgrades.altfire > 0 && p.alt.cd <= 0 && p.alt.left <= 0 && firing && p.ammo.smg >= 4 && p.reloadT <= 0 && p.switchT <= 0 && tdist < 14) altPress = true;
    if (altPress) input.keys.add('e'); else input.keys.delete('e');

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
    const lsFiring = new Set(alive.filter((e) => e.def.ai === 'longshot' && e.state === 'charge' && e.stateT >= e.def.charge.track + e.def.charge.lock - DT * 1.5).map((e) => e));
    game.update(DT, input, VIEW);
    t += DT;
    if (p.health < hb) {
      taken += hb - p.health;
      // who did it: a sniper's shot this frame, a Shaken's burst, a swing, or (otherwise) a bottle
      const sniper = [...lsFiring].find((e) => e.state === 'recover');
      const burst = S.enemies.find((e) => e.def.ai === 'shaken' && e.burstDone && !burstSeen.has(e));
      let cat;
      let who;
      if (sniper) { cat = 'sniper'; who = 'longshot'; use.sniped++; } else if (burst) { cat = 'blast'; who = 'shaken'; } else {
        const sw = S.enemies.find((e) => !e.dead && !e.def.ranged && e.state === 'swing');
        if (sw) { cat = 'melee'; who = kindOf(sw); } else {
          cat = 'ranged';
          const sh = S.enemies.filter((e) => !e.dead && e.def.ranged && e.state !== 'idle').sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
          who = sh ? kindOf(sh) : 'bottle';
        }
      }
      dmgBy[cat] += hb - p.health;
      lastSource = who;
      if (TRACE === seed) console.log(`  t=${t.toFixed(1)} hp ${hb}->${p.health} ${cat} (${who}) area=${S.currentArea && S.currentArea.def.id}`);
    }
    for (const e of S.enemies) if (e.def.ai === 'shaken' && e.burstDone) burstSeen.add(e);
    for (const a of S.areas) if (a.cleared && areaTimes[a.def.id] === undefined) {
      areaTimes[a.def.id] = t;
      if (TRACE === seed) console.log(`  t=${t.toFixed(1)} area cleared: ${a.def.id} hp=${Math.round(p.health)}`);
    }
    // usage counters (what the bot did with the newer weapons)
    if (p.ammo.grenade < prevAmmo.grenade) use.grenade++;
    if (p.ammo.airhorn < prevAmmo.airhorn) use.airhorn++;
    prevAmmo = { grenade: p.ammo.grenade || 0, airhorn: p.ammo.airhorn || 0 };
    if (p.alt.left > 0 && prevAltLeft === 0) use.alt++;
    prevAltLeft = p.alt.left;
    if (p.beam && p.beam.on) use.beam += DT;
    const revs = S.enemies.reduce((s, e) => s + (e.revives || 0), 0);
    if (revs > prevRevives) use.revives += revs - prevRevives;
    prevRevives = revs;
    if (opts.scenario && (S.enemies.every((e) => e.dead) || t > 90)) break;
  }

  if (S.mode === 'dead') diedTo[lastSource || '?'] = 1;
  const scenarioDone = opts.scenario ? S.enemies.every((e) => e.dead) : false;
  return {
    won: opts.scenario ? scenarioDone && S.mode === 'play' : S.mode === 'complete',
    dead: S.mode === 'dead',
    stuck: S.mode === 'play' && !(opts.scenario && scenarioDone),
    t,
    health: p.health,
    taken,
    dmgBy,
    diedIn: S.mode === 'dead' ? (S.currentArea && S.currentArea.def.id) : null,
    diedTo,
    kills: S.kills,
    shots: S.shots,
    areaTimes,
    records: S.runRecords.length,
    upgrades: { ...p.upgrades },
    owned: Object.keys(p.owned).filter((k) => p.owned[k]),
    use,
  };
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '-');

function main() {
  const scenario = args.scenario || null;
  const blind = args.blind === '1'; // a bot that does not know about the newer things, for comparison
  console.log('skill   win%  dead%  stuck%  time(s)  dmgTaken  melee/ranged   died in');
  for (const skill of SKILLS) {
    const rs = [];
    const opts = scenario ? { scenario, level: 1 } : {};
    if (blind) opts.skill = { lockNotice: 0, shakenAvoid: 0, nurse: 'late', mimicShoot: 0 };
    for (let s = 1; s <= RUNS; s++) {
      if (TRACE !== null && s !== TRACE) continue;
      rs.push(runOnce(s, skill, opts));
    }
    const wins = rs.filter((r) => r.won);
    const deaths = {};
    for (const r of rs) if (r.diedIn) deaths[r.diedIn] = (deaths[r.diedIn] || 0) + 1;
    const killers = {};
    for (const r of rs) for (const [k, v] of Object.entries(r.diedTo)) killers[k] = (killers[k] || 0) + v;
    console.log(
      `${skill.padEnd(7)} ${f((100 * wins.length) / rs.length).padStart(4)}  ${f((100 * rs.filter((r) => r.dead).length) / rs.length).padStart(5)}  ` +
        `${f((100 * rs.filter((r) => r.stuck).length) / rs.length).padStart(6)}  ${f(avg(wins.map((r) => r.t))).padStart(7)}  ` +
        `${f(avg(rs.map((r) => r.taken))).padStart(8)}  ${f(avg(rs.map((r) => r.dmgBy.melee)))}/${f(avg(rs.map((r) => r.dmgBy.ranged)))}`.padEnd(14) +
        `   ${JSON.stringify(deaths)}`,
    );
    const extra = ['sniper', 'blast'].filter((k) => rs.some((r) => r.dmgBy[k] > 0)).map((k) => `${k} ${f(avg(rs.map((r) => r.dmgBy[k])))}`);
    const useSum = (k) => f(avg(rs.map((r) => r.use[k])), 1);
    const bits = [];
    if (extra.length) bits.push(`avg damage from ${extra.join(', ')}`);
    if (rs.some((r) => r.use.lasers)) bits.push(`longshot lasers ${useSum('lasers')}/run, dodged ${useSum('dodged')}, hits ${useSum('sniped')}`);
    if (rs.some((r) => r.records)) bits.push(`records ${f(avg(rs.map((r) => r.records)), 1)}`);
    if (rs.some((r) => r.use.revives)) bits.push(`revives ${useSum('revives')}`);
    if (rs.some((r) => r.use.grenade || r.use.airhorn || r.use.alt || r.use.beam)) bits.push(`grenades ${useSum('grenade')}, airhorns ${useSum('airhorn')}, alt bursts ${useSum('alt')}, beam ${useSum('beam')} s`);
    if (rs.some((r) => r.upgrades.clip || r.upgrades.reload || r.upgrades.altfire)) bits.push(`upgrades clip ${f(avg(rs.map((r) => r.upgrades.clip)), 1)} reload ${f(avg(rs.map((r) => r.upgrades.reload)), 1)} altfire ${f(avg(rs.map((r) => r.upgrades.altfire)), 1)}`);
    if (Object.keys(killers).length) bits.push(`killed by ${JSON.stringify(killers)}`);
    if (bits.length) console.log(`        ${bits.join('; ')}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
