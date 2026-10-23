// Headless checks of the prepared arsenal (docs/arsenal.md), run against the real game logic in Node:
//   node scripts/harness/arsenal-check.mjs
// The Feedback Beam's damage ramp and meter, the Bass-Drop Grenade's fuse, bounce, radius and stun (bosses less), the
// Airhorn's cone, the SMG's alt-fire and its gating by the upgrade, the clip and reload upgrades, the record pickup and the
// save (round trip, old saves, junk), the HUD strip, and that no level places any of it. Normal mode only.
import * as game from '../../src/game3d.js';
import * as store from '../../src/save.js';
import * as M from '../../src/models.js';
import { LEVEL_DEFS, buildWorld } from '../../src/world.js';
import {
  ENEMY_DEFS, WEAPONS, WEAPON_ORDER, PREPARED_WEAPONS, ALT_FIRE, UPGRADES, RECORDS,
} from '../../src/data.js';

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

function fresh(level = 1) {
  game.init(VIEW);
  game.testHook('level', level);
  game.testHook('torch', { attached: true }); // the torch is already fitted: level 2 would start with the fitting sequence, which holds the hands
  const S = game.getState();
  if (S.debugMode) throw new Error('arsenal-check must run in normal mode');
  S.save = store.fresh();
  const ARS = game.testHook('arsenal');
  S.enemies.forEach((q) => { q.dead = true; q.state = 'dead'; q.robot.group.visible = false; });
  return { S, W: game.getWorld(), ARS, p: S.player };
}
const run = (S, seconds, inp = input(), each) => {
  for (let t = 0; t < seconds; t += DT) {
    game.update(DT, inp, VIEW);
    if (each && each(t) === false) return;
  }
};
// the open lane along tile row 32 of the Cowgate's dance floor: Naebun at x = 20 facing east, z = 65
const LANE = { x: 20, z: 65, yaw: -Math.PI / 2 };
const place = (x, z, yaw) => { game.testHook('teleport', { x, z, yaw }); const S = game.getState(); S.player.health = S.player.maxHealth = 1e6; S.player.pitch = 0; };
// bring a robot back to life, somewhere, awake or not, and make it stand still
function stand(S, kind, x, z, { awake = false, hp = 1e6 } = {}) {
  const e = S.enemies.find((q) => q.kind === kind && q.dead && !q.taken);
  e.taken = true;
  e.dead = false;
  e.state = awake ? 'chase' : 'idle';
  e.stateT = 0;
  e.hp = e.maxHp = hp;
  e.x = x; e.z = z; e.kx = e.kz = 0; e.yaw = 0;
  e.speedMult = 0;
  e.cool = 1e6;
  e.stunT = 0;
  e.robot.group.visible = true;
  return e;
}
// a press on a menu button calls audio.unlock(), which looks at `window` (there is none in Node): an empty one will do
const press = (inp) => { globalThis.window = {}; try { game.update(DT, inp, VIEW); } finally { delete globalThis.window; } };
const hold = (S, key) => { const inp = input(); inp.keys.add(key); return inp; };
const give = (S, w) => { game.testHook('give', w); S.player.weapon = w; S.player.switchT = 0; S.player.fireT = 0; };

// ---- the data and the plumbing ----
{
  const { S, p } = fresh(1);
  ok(JSON.stringify(PREPARED_WEAPONS) === '["beam","grenade","airhorn"]', `prepared weapons are the beam, grenade and airhorn (${PREPARED_WEAPONS})`);
  ok(WEAPON_ORDER.length === 8 && WEAPON_ORDER.every((id) => WEAPONS[id]), 'WEAPON_ORDER lists eight weapons, all defined');
  ok(WEAPON_ORDER.filter((id) => !WEAPONS[id].prepared).join() === 'pistol,shotgun,smg,launcher,vinyl', 'the first five are unchanged');
  game.testHook('giveWeapons');
  ok(!p.owned.beam && !p.owned.grenade && !p.owned.airhorn, 'giveWeapons gives the five weapons only, by default');
  ok(['pistol', 'shotgun', 'smg', 'launcher', 'vinyl'].every((id) => p.owned[id]), 'giveWeapons still gives the five');
  let h = game.testHook('hud');
  ok(h.weapons.length === 5 && h.weapons.every((w) => !WEAPONS[w.id].prepared), `the HUD strip shows five cells in level 1 (${h.weapons.map((w) => w.id)})`);
  game.testHook('give', 'beam');
  h = game.testHook('hud');
  ok(h.weapons.length === 6 && h.weapons[5].id === 'beam' && h.weapons[5].owned, 'a prepared weapon joins the strip once it is owned');
  game.testHook('give', 'all');
  h = game.testHook('hud');
  ok(h.weapons.length === 8, 'with all eight owned the strip has eight cells');
  // cycling visits every owned weapon in WEAPON_ORDER and comes back round
  p.weapon = 'pistol';
  const seen = [];
  for (let i = 0; i < 8; i++) {
    p.switchT = 0;
    run(S, 0.01, hold(S, 'q'));
    run(S, 0.05); // release
    seen.push(p.weapon);
  }
  ok(seen.join() === 'shotgun,smg,launcher,vinyl,beam,grenade,airhorn,pistol', `Q cycles through all eight in order (${seen})`);
}

// ---- no level places any of it ----
{
  const prepared = new Set([...PREPARED_WEAPONS, ...Object.keys(UPGRADES), ...RECORDS.map((r) => r.id)]);
  let levels = 0;
  for (const [n, def] of Object.entries(LEVEL_DEFS)) {
    levels++;
    for (const [letter, [kind, item]] of Object.entries(def.picks)) {
      ok(kind === 'weapon' || kind === 'drink', `level ${n}: pickup letter ${letter} has a kind that exists (${kind})`);
      ok(!prepared.has(item), `level ${n}: pickup letter ${letter} is not a prepared item (${item})`);
    }
    for (const row of def.map) for (const ch of row) {
      const pk = def.picks[ch];
      if (pk) ok(!prepared.has(pk[1]) && (pk[0] === 'weapon' || pk[0] === 'drink'), `level ${n}: map letter ${ch} places a normal pickup`);
    }
    const w = buildWorld({ level: Number(n), quality: 'low' });
    ok(w.pickups.length > 0 && w.pickups.every((q) => (q.kind === 'weapon' || q.kind === 'drink') && !prepared.has(q.item)), `level ${n}: ${w.pickups.length} built pickups, none of them prepared`);
    for (const a of w.areas) for (const sp of a.spawns) ok(ENEMY_DEFS[sp.kind], `level ${n}: spawn kind ${sp.kind} exists`);
    const g = fresh(Number(n));
    ok(g.S.pickups.every((q) => q.def.kind === 'weapon' || q.def.kind === 'drink'), `level ${n}: no upgrade or record pickup in the game`);
    ok(!g.p.owned.beam && !g.p.owned.grenade && !g.p.owned.airhorn && g.p.upgrades.clip === 0 && g.p.upgrades.altfire === 0, `level ${n}: Naebun starts with none of it`);
  }
  ok(levels >= 2, `checked every level in LEVEL_DEFS (${levels})`);
}

// ---- the Feedback Beam ----
{
  const { S, p } = fresh(1);
  give(S, 'beam');
  const w = WEAPONS.beam;
  ok(p.ammo.beam === w.clip, `the meter starts full (${p.ammo.beam})`);
  place(LANE.x, LANE.z, LANE.yaw);
  const a = stand(S, 'fizzbang', LANE.x + 6, LANE.z);
  const inp = hold(S, ' ');
  const hp = [];
  let meter1 = null;
  run(S, 4, inp, (t) => {
    hp.push(a.hp);
    if (t >= 1 - DT && meter1 === null) meter1 = p.ammo.beam;
  });
  const lost = (t0, t1) => hp[Math.floor(t0 / DT)] - hp[Math.floor(t1 / DT) - 1];
  const early = lost(0, 0.5) / 0.5;
  const late = lost(2.5, 3.5) / 1.0;
  ok(early > w.dps * 0.9 && early < w.dps * 2, `the first half second does about ${w.dps}+ damage a second (${early.toFixed(1)})`);
  ok(late > w.dpsMax * 0.88 && late < w.dpsMax * 1.12, `after ${w.ramp} s on one target it does about ${w.dpsMax} a second (${late.toFixed(1)})`);
  ok(late > early * 2, 'the damage per second ramps up the longer it stays on the target');
  ok(near(meter1, w.clip - w.drain * 1, 3), `the meter drains ${w.drain} units a second while firing (${meter1 && meter1.toFixed(1)} after 1 s)`);
  ok(p.beam.on && p.beam.ramp >= w.ramp, 'the beam is on and the ramp is full');
  // switching to another target starts the ramp again
  const b = stand(S, 'fizzbang', LANE.x + 6, LANE.z + 2.2);
  const hpB = b.hp;
  p.yaw = Math.atan2(-6, -2.2); // round to B
  run(S, 0.5, inp);
  const lostB = hpB - b.hp;
  ok(lostB < w.dpsMax * 0.5 * 0.6, `a new target starts from the low end of the ramp (${lostB.toFixed(1)} damage in 0.5 s)`);
  ok(p.beam.target === b, 'the beam tracks the new target');
  // let go: it stops, then the meter trickles back after a delay
  run(S, 0.05);
  const m0 = p.ammo.beam;
  run(S, w.rechargeDelay - 0.2);
  ok(near(p.ammo.beam, m0, 0.01) && !p.beam.on, 'with the trigger up it stops draining and waits before it recharges');
  run(S, 1.0);
  ok(p.ammo.beam > m0 + w.recharge * 0.5, `the meter recharges when it is left alone (${m0.toFixed(0)} to ${p.ammo.beam.toFixed(0)})`);
  // run it dry: it stops, recharges in full after `reload` seconds
  p.yaw = LANE.yaw;
  p.ammo.beam = 4;
  p.reloadT = 0;
  run(S, 0.5, inp);
  ok(p.ammo.beam <= 0.001 && p.reloadT > 0, 'an empty meter starts the recharge (the beam reload)');
  const hpDry = a.hp;
  run(S, 0.5, inp);
  ok(near(a.hp, hpDry, 0.001), 'no beam while it recharges');
  run(S, w.reload + 0.3);
  ok(near(p.ammo.beam, w.clip, 0.001), `the recharge fills the meter (${p.ammo.beam.toFixed(1)})`);
}
{
  // range: 16 m is inside the beam, 20 m outside; a wall stops it; a stunned or distant robot is just a target
  const { S, p } = fresh(1);
  give(S, 'beam');
  place(LANE.x, LANE.z, LANE.yaw);
  const near16 = stand(S, 'fizzbang', LANE.x + 16, LANE.z);
  run(S, 0.6, hold(S, ' '));
  ok(near16.hp < near16.maxHp, `the beam reaches 16 m (${(near16.maxHp - near16.hp).toFixed(1)} damage)`);
  const far = stand(S, 'fizzbang', LANE.x + 6, LANE.z);
  near16.dead = true; near16.state = 'dead';
  far.x = LANE.x + 19.5;
  p.ammo.beam = WEAPONS.beam.clip;
  run(S, 0.8, hold(S, ' '));
  ok(far.hp === far.maxHp, 'a robot 19.5 m away is out of range');
  // behind a wall: face the south wall of the lane's room with the robot on the other side
  const W = game.getWorld();
  place(LANE.x, LANE.z, 0); // north
  const wall = W.raycast(LANE.x, LANE.z, 0, -1, 40);
  const behind = stand(S, 'fizzbang', LANE.x, LANE.z - wall - 2.5);
  p.ammo.beam = WEAPONS.beam.clip;
  run(S, 0.8, hold(S, ' '));
  ok(wall < 17 && behind.hp === behind.maxHp, `a wall stops the beam (wall ${wall.toFixed(1)} m ahead)`);
}
{
  // debug mode doubles the damage, like the other weapons; the meter and ramp do not change
  const { S } = fresh(1);
  const replay = () => { game.testHook('play'); S.enemies.forEach((q) => { q.dead = true; q.state = 'dead'; q.robot.group.visible = false; }); };
  S.debugMode = true;
  replay();
  give(S, 'beam');
  place(LANE.x, LANE.z, LANE.yaw);
  const e = stand(S, 'fizzbang', LANE.x + 5, LANE.z);
  run(S, 0.5, hold(S, ' '));
  const dbg = e.maxHp - e.hp;
  S.debugMode = false;
  replay();
  give(S, 'beam');
  place(LANE.x, LANE.z, LANE.yaw);
  const e2 = stand(S, 'fizzbang', LANE.x + 5, LANE.z);
  run(S, 0.5, hold(S, ' '));
  const norm = e2.maxHp - e2.hp;
  ok(near(dbg / norm, 2, 0.25), `debug mode doubles beam damage (${(dbg / norm).toFixed(2)}x), as for every weapon`);
}

// ---- the Bass-Drop Grenade ----
{
  const { S, p, ARS } = fresh(1);
  give(S, 'grenade');
  const w = WEAPONS.grenade;
  ok(p.ammo.grenade === 3 && w.clip === 3, 'a clip of a few grenades');
  place(LANE.x, LANE.z, LANE.yaw);
  let flight = null;
  const inp = hold(S, ' ');
  let t0 = null;
  let bounces = 0;
  let lastVy = 0;
  let maxX = 0;
  run(S, 0.03, inp);
  inp.keys.delete(' ');
  flight = S.projectiles.find((q) => q.grenade);
  ok(!!flight && p.ammo.grenade === 2, 'firing throws a grenade and uses one');
  ok(Math.hypot(flight.vx, flight.vz) > 5 && flight.vy > 0, 'it is thrown in an arc (forward and up)');
  let t = 0;
  let gone = null;
  for (; t < 4; t += DT) {
    game.update(DT, input(), VIEW);
    const g = S.projectiles.find((q) => q === flight);
    if (!g) { gone = t; break; }
    if (lastVy < -1 && g.vy > 0) bounces++;
    lastVy = g.vy;
    maxX = Math.max(maxX, g.x);
    if (t0 === null) t0 = 0;
  }
  ok(gone !== null && near(gone + 0.03, w.fuse, 0.12), `the fuse is ${w.fuse} s (it went off after ${gone === null ? 'never' : (gone + 0.03).toFixed(2)} s)`);
  ok(bounces >= 1, `it bounces on the floor before the fuse runs out (${bounces} bounce)`);
  ok(maxX > LANE.x + 4, `it travels a few metres (${(maxX - LANE.x).toFixed(1)} m)`);
  ok(S.projectiles.every((q) => !q.grenade), 'nothing is left flying after the drop');
  void ARS;
}
{
  // a grenade thrown at a wall bounces back off it and never passes through
  const { S, p, W } = fresh(1);
  give(S, 'grenade');
  place(LANE.x, LANE.z, 0); // north, at the wall of the dance floor
  const wall = W.raycast(LANE.x, LANE.z, 0, -1, 40);
  p.pitch = 0.05;
  game.testHook('arsenal').fire(WEAPONS.grenade);
  const g = S.projectiles.find((q) => q.grenade);
  let zMin = 1e9;
  let turned = false;
  for (let t = 0; t < 1.6; t += DT) {
    game.update(DT, input(), VIEW);
    if (!S.projectiles.includes(g)) break;
    zMin = Math.min(zMin, g.z);
    if (g.vz > 0.5 && zMin < LANE.z - 2) turned = true;
    ok(!W.isSolidAt(g.x, g.z), 'the grenade is never inside a wall');
  }
  ok(zMin > LANE.z - wall - 0.05, `it stops at the wall (${wall.toFixed(1)} m away, closest approach ${(LANE.z - zMin).toFixed(2)} m)`);
  ok(turned, 'and rebounds off it');
}
{
  // the bass drop: radius, stun, a little damage, bosses stunned less, walls stop it
  const { S, p, W, ARS } = fresh(1);
  const w = WEAPONS.grenade;
  place(LANE.x, LANE.z, LANE.yaw);
  const gx = LANE.x + 12;
  const dists = [1.5, 4.5, 6.5, 8.5, 12];
  const bots = dists.map((d) => stand(S, 'fizzbang', gx + d, LANE.z, { hp: 500 }));
  const boss = stand(S, 'bouncer', gx - 3, LANE.z + 0.2, { hp: 5000 });
  ARS.bassDrop(gx, 1, LANE.z, w);
  dists.forEach((d, i) => {
    const inside = d - bots[i].r <= w.radius;
    if (inside) {
      ok(near(bots[i].stunT, w.stun, 1e-6), `a robot ${d} m away is stunned for ${w.stun} s (${bots[i].stunT})`);
      const dmg = bots[i].maxHp - bots[i].hp;
      ok(dmg > 0 && dmg <= w.damage, `and takes a little damage (${dmg.toFixed(1)} of at most ${w.damage})`);
    } else {
      ok(!bots[i].stunT && bots[i].hp === bots[i].maxHp, `a robot ${d} m away is outside the ${w.radius} m radius and untouched`);
    }
  });
  ok((bots[0].maxHp - bots[0].hp) > (bots[2].maxHp - bots[2].hp), 'the damage falls off with distance');
  ok(near(boss.stunT, w.stun * w.bossStun, 1e-6) && boss.stunT < w.stun / 2, `a boss is stunned for less (${boss.stunT.toFixed(2)} s against ${w.stun})`);
  ok(boss.hp > boss.maxHp - w.damage - 0.01, 'and hurt as little');
  // walls stop it: a robot the other side of a wall within the radius is not stunned
  const wall = W.raycast(LANE.x, LANE.z, 0, -1, 40);
  const hidden = stand(S, 'fizzbang', LANE.x, LANE.z - wall - 1.2, { hp: 500 });
  ARS.bassDrop(LANE.x, 1, LANE.z, w);
  ok(wall < 5 && !hidden.stunT, `a wall stops the shockwave (wall ${wall.toFixed(1)} m, robot behind it ${(wall + 1.2).toFixed(1)} m)`);
  // a dead robot is left alone
  const dead = S.enemies.find((q) => q.dead);
  dead.x = LANE.x + 2;
  ARS.bassDrop(LANE.x, 1, LANE.z, w);
  ok(!dead.stunT, 'a dead robot is not stunned');
  void p;
}
{
  // a stunned robot does nothing: it will not walk or swing, and it goes back to work when the stun ends
  const control = fresh(1);
  place(LANE.x, LANE.z, LANE.yaw);
  const c = stand(control.S, 'fizzbang', LANE.x + 1.3, LANE.z, { awake: true, hp: 1e6 });
  c.speedMult = 1; c.cool = 0;
  control.p.health = control.p.maxHealth = 1000;
  run(control.S, 2.5);
  ok(control.p.health < 1000, `without a stun the robot hits Naebun (${(1000 - control.p.health).toFixed(0)} damage in 2.5 s)`);
  const { S, p, ARS } = fresh(1);
  place(LANE.x, LANE.z, LANE.yaw);
  const e = stand(S, 'fizzbang', LANE.x + 1.3, LANE.z, { awake: true, hp: 1e6 });
  e.speedMult = 1; e.cool = 0;
  p.health = p.maxHealth = 1000;
  run(S, 0.5); // it is winding up
  ok(['windup', 'swing', 'chase'].includes(e.state), `the robot is attacking (${e.state})`);
  ARS.stun(e, 2.5);
  const x0 = e.x;
  const z0 = e.z;
  const h0 = p.health;
  run(S, 2.3);
  ok(p.health === h0, 'a stunned robot does not hurt Naebun');
  ok(Math.hypot(e.x - x0, e.z - z0) < 0.05 && e.state !== 'swing' && e.state !== 'windup', `and does not move or attack (${e.state})`);
  run(S, 0.3);
  ok(!(e.stunT > 0), 'the stun wears off');
  run(S, 3);
  ok(p.health < h0, 'and then it attacks again');
}
{
  // a stun on a sleeping robot does not wake it
  const { S, ARS } = fresh(1);
  place(LANE.x, LANE.z, LANE.yaw);
  const e = stand(S, 'fizzbang', LANE.x + 14, LANE.z);
  ARS.stun(e, 1);
  run(S, 0.3);
  ok(e.state === 'idle', 'a stun alone does not wake a sleeping robot');
}

// ---- the Airhorn ----
{
  const { S, p, W } = fresh(1);
  give(S, 'airhorn');
  const w = WEAPONS.airhorn;
  ok(p.ammo.airhorn === w.clip && w.clip >= 3 && w.clip <= 6, `a few uses per clip (${w.clip})`);
  // the cone, in the open arena at the back of the Cowgate
  const ax = 61;
  const az = 8;
  place(ax, az, -Math.PI / 2); // facing east
  const at = (d, deg) => { const a = -Math.PI / 2 + (deg * Math.PI) / 180; return [ax - Math.sin(a) * d, az - Math.cos(a) * d]; };
  const spots = { centre: at(4, 0), left20: at(4, 20), right25: at(4, -25), wide60: at(4, 60), behind: at(3, 180), far: at(9, 0), edge: at(6.2, 0) };
  const bots = {};
  for (const [k, [x, z]] of Object.entries(spots)) {
    bots[k] = stand(S, 'fizzbang', x, z, { hp: 500 });
    ok(!W.isSolidAt(x, z) || k === 'far', `${k} stands in the open`);
  }
  const start = Object.fromEntries(Object.entries(bots).map(([k, e]) => [k, [e.x, e.z]]));
  game.testHook('arsenal').blast(w, { damage: 1 });
  for (const k of ['centre', 'left20', 'right25']) ok(near(bots[k].stunT, w.stun, 1e-6), `${k} is inside the cone and stunned for ${w.stun} s`);
  for (const k of ['wide60', 'behind', 'far']) ok(!bots[k].stunT, `${k} is outside the cone`);
  ok(bots.edge.stunT > 0, 'just inside the range is still reached (6.2 m, minus the radius of the robot)');
  const dmg = bots.centre.maxHp - bots.centre.hp;
  ok(dmg > 0 && dmg <= w.damage, `little damage (${dmg.toFixed(1)}, at most ${w.damage})`);
  run(S, 0.8);
  const moved = Math.hypot(bots.centre.x - start.centre[0], bots.centre.z - start.centre[1]);
  ok(moved > 0.8 && bots.centre.x > start.centre[0], `knockback shoves it away from Naebun (${moved.toFixed(2)} m)`);
  ok(Math.hypot(bots.wide60.x - start.wide60[0], bots.wide60.z - start.wide60[1]) < 0.01, 'a robot outside the cone is not shoved');
  // a boss is shoved and stunned far less
  const boss = stand(S, 'bouncer', ...at(3.5, 0), { hp: 5000 });
  game.testHook('arsenal').blast(w, { damage: 1 });
  ok(near(boss.stunT, w.stun * w.bossStun, 1e-6), `a boss is stunned for ${boss.stunT.toFixed(2)} s, not ${w.stun}`);
  // using it: the clip runs down one a time with the interval between, and an empty clip reloads
  p.ammo.airhorn = w.clip;
  const inp = hold(S, ' ');
  let shots = 0;
  let prev = p.ammo.airhorn;
  run(S, w.interval * w.clip + 0.8, inp, () => { if (p.ammo.airhorn < prev) shots++; prev = p.ammo.airhorn; });
  ok(shots === w.clip && p.reloadT > 0, `${w.clip} blasts empty the clip and start the reload (${shots})`);
}

// ---- the same things in level 2 (the Vaults): the shield, the dark, the arena at the back ----
{
  const { S, p, W, ARS } = fresh(2);
  const ax = 28;
  const az = 10;
  place(ax, az, -Math.PI / 2);
  const at = (d, deg) => { const a = -Math.PI / 2 + (deg * Math.PI) / 180; return [ax - Math.sin(a) * d, az - Math.cos(a) * d]; };
  ok([...[0, 1, 2, 3, 4, 5, 6].map((d) => at(d, 0))].every(([x, z]) => !W.isSolidAt(x, z)), 'the level 2 arena is open');
  // the airhorn ignores a shield and still stuns and shoves a shielded robot facing Naebun
  give(S, 'airhorn');
  const sh = stand(S, 'shielded', ...at(3, 0), { hp: 500 });
  sh.yaw = -Math.PI / 2 + Math.PI; // facing west, towards Naebun: the shield is up
  const h0 = sh.hp;
  ARS.blast(WEAPONS.airhorn, { damage: 1 });
  ok(sh.stunT > 0 && h0 - sh.hp > WEAPONS.airhorn.damage * 0.5, `a shield does not stop the airhorn (${(h0 - sh.hp).toFixed(1)} damage, stunned ${sh.stunT.toFixed(2)} s)`);
  // and a shot from the front would have been stopped, so the stun is worth having
  sh.hp = sh.maxHp;
  const through = game.testHook('hitEnemy', { i: S.enemies.indexOf(sh), amount: 20, fx: ax, fz: az, opts: {} });
  ok(through < 20 * 0.2, `(a bullet from the front is mostly stopped: ${through.toFixed(1)} of 20)`);
  // the bass drop: stuns the shielded one, a fizzbang and a boss together
  const f = stand(S, 'fizzbang', ...at(5, 90), { hp: 500 });
  const boss = stand(S, 'tourguide', ...at(4.5, -90), { hp: 5000 });
  ARS.bassDrop(ax, 1, az, WEAPONS.grenade);
  ok(sh.stunT > 0 && f.stunT > 0 && boss.stunT > 0 && boss.stunT < f.stunT, `the drop stuns a shielded robot, a fizzbang and the boss (${sh.stunT}, ${f.stunT}, ${boss.stunT.toFixed(2)})`);
  // a stunned boss is held for a moment and then fights again
  boss.state = 'chase';
  boss.speedMult = 1;
  boss.cool = 0;
  const bx = boss.x;
  const bz = boss.z;
  run(S, 0.8);
  ok(Math.hypot(boss.x - bx, boss.z - bz) < 0.4, 'a stunned boss stands still');
  // beam on the shielded one: the shield still applies (a hitscan from the front), so the beam is a poor answer to it
  give(S, 'beam');
  place(ax, az, -Math.PI / 2);
  sh.x = ax + 4; sh.z = az; sh.stunT = 0; sh.hp = sh.maxHp = 1e6; sh.yaw = -Math.PI / 2; // facing east, away from Naebun: its back to the gun
  run(S, 0.5, hold(S, ' '));
  const back = sh.maxHp - sh.hp;
  sh.hp = sh.maxHp; sh.yaw = Math.PI / 2; p.ammo.beam = WEAPONS.beam.clip; p.beam.ramp = 0; p.beam.target = null;
  run(S, 0.2);
  run(S, 0.5, hold(S, ' '));
  const front = sh.maxHp - sh.hp;
  ok(back > 0 && front < back * 0.4, `the beam hits a shield like any bullet (${front.toFixed(1)} from the front, ${back.toFixed(1)} from behind)`);
}

// ---- SMG alt-fire ----
{
  const { S, p } = fresh(1);
  give(S, 'smg');
  const a = ALT_FIRE.smg;
  const smg = WEAPONS.smg;
  ok(a.damage === smg.damage * 2, 'the burst does double damage');
  place(LANE.x, LANE.z, LANE.yaw);
  const e = stand(S, 'fizzbang', LANE.x + 10, LANE.z);
  // no upgrade: E does nothing
  run(S, 0.1, hold(S, 'e'));
  run(S, 0.1);
  ok(p.ammo.smg === smg.clip && p.alt.cd === 0 && e.hp === e.maxHp, 'without the altfire upgrade, E does nothing');
  ok(!game.testHook('arsenal').altAvailable(), 'and the alt-fire is not available');
  game.testHook('give', 'altfire');
  ok(game.testHook('arsenal').altAvailable() && p.upgrades.altfire === 1, 'the altfire upgrade unlocks it');
  // not on another weapon
  p.weapon = 'pistol';
  p.switchT = 0;
  run(S, 0.1, hold(S, 'e'));
  run(S, 0.1);
  ok(p.alt.cd === 0 && p.ammo.pistol === WEAPONS.pistol.clip, 'E does nothing with the pistol in hand');
  // on the SMG: four rounds, tight, double damage
  p.weapon = 'smg';
  p.switchT = 0;
  const ammo0 = p.ammo.smg;
  let hits = 0;
  let hp0 = e.hp;
  const dmgs = [];
  run(S, 0.1, hold(S, 'e'), () => { if (e.hp < hp0) { dmgs.push(hp0 - e.hp); hp0 = e.hp; hits++; } });
  run(S, 0.5, input(), () => { if (e.hp < hp0) { dmgs.push(hp0 - e.hp); hp0 = e.hp; hits++; } });
  ok(p.ammo.smg === ammo0 - a.rounds, `the burst fires ${a.rounds} rounds from the clip (${ammo0 - p.ammo.smg})`);
  ok(hits >= a.rounds - 1 && dmgs.every((d) => near(d, a.damage, 0.01) || near(d, a.damage * 2, 0.01)), `each round does ${a.damage} (or ${a.damage * 2} on the head): ${dmgs.map((d) => d.toFixed(0))}`);
  ok(p.alt.cd > a.cooldown - 0.7, `then a ${a.cooldown} s cooldown (${p.alt.cd.toFixed(2)} left)`);
  // a second press inside the cooldown does nothing; after it, it works again
  const a1 = p.ammo.smg;
  run(S, 0.1, hold(S, 'e'));
  run(S, 0.1);
  ok(p.ammo.smg === a1, 'a press during the cooldown does nothing');
  run(S, a.cooldown);
  run(S, 0.1, hold(S, 'e'));
  run(S, 0.4);
  ok(p.ammo.smg === a1 - a.rounds, 'after the cooldown it fires again');
  // the burst is tight: no spread to speak of at 10 m (all rounds hit a robot 0.55 m wide)
  p.alt.cd = 0;
  e.hp = e.maxHp = 1e6;
  const hpT = e.hp;
  p.ammo.smg = smg.clip;
  run(S, 0.1, hold(S, 'e'));
  run(S, 0.5);
  ok(hpT - e.hp >= a.rounds * a.damage - 0.01, `all ${a.rounds} rounds land at 10 m (${(hpT - e.hp).toFixed(0)} damage)`);
  // an empty clip: the burst does not start; a short clip fires what is left
  p.alt.cd = 0;
  p.ammo.smg = 2;
  run(S, 0.1, hold(S, 'e'));
  run(S, 0.5);
  ok(p.ammo.smg <= 0 || p.reloadT > 0, 'with two rounds left the burst fires them and the gun reloads');
}
{
  // PC mouse (right button) and the mobile ALT button
  const { S, p } = fresh(1);
  give(S, 'smg');
  game.testHook('give', 'altfire');
  game.testHook('setting', { input: 'pc' });
  place(LANE.x, LANE.z, LANE.yaw);
  game.testHook('mouse', { down: false, alt: true });
  run(S, 0.2);
  ok(p.ammo.smg < WEAPONS.smg.clip, `the right mouse button fires the burst (${WEAPONS.smg.clip - p.ammo.smg} rounds)`);
  game.testHook('mouse', null);
  run(S, 3.5);
  p.ammo.smg = WEAPONS.smg.clip;
  p.switchT = 0;
  game.testHook('setting', { input: 'mobile' });
  game.testHook('mobile', true);
  const L = game.testHook('layout');
  const press = { x: L.altBtn.x + L.altBtn.w / 2, y: L.altBtn.y + L.altBtn.h / 2 };
  ok(L.altBtn.y + L.altBtn.h < L.lookBox.y && L.altBtn.x + L.altBtn.w <= L.lookBox.x + L.lookBox.w + 1, 'the ALT button sits just above the aim box');
  const inp = input();
  inp.pressed.push(press);
  game.update(DT, inp, VIEW);
  run(S, 0.5);
  ok(p.ammo.smg < WEAPONS.smg.clip, 'tapping ALT fires the burst in mobile mode');
  // not available (no pedal): a tap on the same spot does nothing, and is not a button
  const s2 = fresh(1);
  give(s2.S, 'smg');
  game.testHook('setting', { input: 'mobile' });
  const inp2 = input();
  inp2.pressed.push(press);
  game.update(DT, inp2, VIEW);
  run(s2.S, 0.4);
  ok(s2.p.ammo.smg === WEAPONS.smg.clip, 'ALT does nothing before the upgrade');
  let h = game.testHook('hud');
  ok(h.alt === null, 'and the HUD has no ALT button');
  game.testHook('give', 'altfire');
  h = game.testHook('hud');
  ok(h.alt && h.alt.cd === 0, 'the HUD shows ALT, ready, once the upgrade is owned with the SMG in hand');
  s2.p.weapon = 'pistol';
  ok(game.testHook('hud').alt === null, 'but not with another weapon in hand');
  game.testHook('setting', { input: null });
}

// ---- upgrades ----
{
  const { S, p, ARS } = fresh(1);
  game.testHook('giveWeapons');
  p.weapon = 'pistol';
  const c0 = WEAPONS.pistol.clip;
  ok(ARS.clipOf(WEAPONS.pistol) === c0 && ARS.reloadMult() === 1, 'no upgrades: clips and reloads are as before');
  ok(ARS.takeUpgrade('clip') && p.upgrades.clip === 1, 'a clip upgrade is taken');
  const c1 = ARS.clipOf(WEAPONS.pistol);
  ok(c1 === Math.round(c0 * UPGRADES.clip.tiers[0]) && c1 > c0, `the pistol's clip grows from ${c0} to ${c1}`);
  ok(Object.keys(WEAPONS).every((id) => ARS.clipOf(WEAPONS[id]) > WEAPONS[id].clip), 'every weapon gets a bigger clip, the smallest too');
  ok(ARS.clipOf(WEAPONS.launcher) >= WEAPONS.launcher.clip + 1, `even the launcher gains a round (${WEAPONS.launcher.clip} to ${ARS.clipOf(WEAPONS.launcher)})`);
  ok(p.ammo.pistol === c1, `the extra rounds arrive at once (${p.ammo.pistol})`);
  ok(S.toast && /CLIP/.test(S.toast.text), `a toast says so (${S.toast && S.toast.text})`);
  // it is applied in the real reload code
  p.ammo.pistol = 0;
  p.reloadT = 0;
  run(S, WEAPONS.pistol.reload + 0.3);
  ok(p.ammo.pistol === c1, `a reload fills the bigger clip (${p.ammo.pistol})`);
  ok(ARS.takeUpgrade('clip') && ARS.clipOf(WEAPONS.pistol) === Math.round(c0 * UPGRADES.clip.tiers[1]), 'a second tier grows it again');
  S.toast = null;
  ok(!ARS.takeUpgrade('clip') && p.upgrades.clip === 2, 'there is no third tier: the pickup would stay');
  // reload speed
  p.ammo.pistol = 0;
  p.reloadT = 0;
  run(S, 0.1);
  ok(near(p.reloadTotal, WEAPONS.pistol.reload, 1e-9), 'before the reload upgrade a reload takes the usual time');
  p.reloadT = 0;
  p.ammo.pistol = 0;
  ok(ARS.takeUpgrade('reload') && near(ARS.reloadMult(), UPGRADES.reload.tiers[0]), 'a reload upgrade is taken');
  run(S, 0.1);
  ok(near(p.reloadTotal, WEAPONS.pistol.reload * UPGRADES.reload.tiers[0], 1e-9), `a reload is faster (${p.reloadTotal.toFixed(2)} s against ${WEAPONS.pistol.reload})`);
  const left = p.reloadT;
  run(S, left + 0.05);
  ok(p.ammo.pistol === ARS.clipOf(WEAPONS.pistol), 'and it still fills the clip');
  // it stacks with the energy drink (a multiplier on top)
  p.upgrades.reload = 2;
  ok(near(ARS.reloadMult(), UPGRADES.reload.tiers[1]), 'a second reload tier is faster again');
  ok(ARS.takeUpgrade('altfire') && p.upgrades.altfire === 1 && !ARS.takeUpgrade('altfire'), 'the altfire upgrade is taken once');
  // per run, not saved
  const saved = store.clean(JSON.parse(JSON.stringify(S.save)));
  ok(!('upgrades' in saved) && !JSON.stringify(saved).includes('altfire'), 'upgrades are not in the save');
  game.testHook('play'); // a fresh run
  ok(game.getState().player.upgrades.clip === 0 && game.getState().player.upgrades.altfire === 0, 'a new run starts without them');
  // the HUD
  game.testHook('give', ['clip', 'reload']);
  const h = game.testHook('hud');
  ok(h.upgrades.clip === 1 && h.upgrades.reload === 1 && h.upgrades.altfire === 0 && h.weapon.clipSize > WEAPONS.pistol.clip, 'the HUD state carries the upgrades and the bigger clip size');
}
{
  // picking things up by walking over them
  const { S, p } = fresh(1);
  const putPickup = (def, mesh) => {
    const pk = { def: { id: `t-${def.item}`, x: p.x, z: p.z, ...def }, mesh, taken: false, phase: 0 };
    S.pickups.push(pk);
    return pk;
  };
  place(LANE.x, LANE.z, LANE.yaw);
  const up = putPickup({ kind: 'upgrade', item: 'clip' }, M.makeUpgradePickup('clip'));
  run(S, 0.1);
  ok(up.taken && p.upgrades.clip === 1 && !up.mesh.visible, 'walking over an upgrade picks it up');
  p.upgrades.clip = 2;
  const up2 = putPickup({ kind: 'upgrade', item: 'clip' }, M.makeUpgradePickup('clip'));
  run(S, 0.1);
  ok(!up2.taken && up2.mesh.visible, 'an upgrade at the top tier is left where it lies');
  const wp = putPickup({ kind: 'weapon', item: 'beam' }, M.makeWeaponPickup('beam'));
  run(S, 0.1);
  ok(wp.taken && p.owned.beam && p.weapon === 'beam' && p.ammo.beam === WEAPONS.beam.clip + Math.max(1, Math.round(WEAPONS.beam.clip * UPGRADES.clip.tiers[1]) - WEAPONS.beam.clip), `a prepared weapon is picked up like the others (meter ${p.ammo.beam})`);
  for (const id of ['grenade', 'airhorn']) {
    const pk = putPickup({ kind: 'weapon', item: id }, M.makeWeaponPickup(id));
    run(S, 0.1);
    ok(pk.taken && p.owned[id], `the ${id} is picked up`);
  }
}

// ---- collectible records ----
{
  const { S, p, ARS } = fresh(1);
  ok(RECORDS.length >= 8 && RECORDS.length <= 14, `about ten records (${RECORDS.length})`);
  ok(new Set(RECORDS.map((r) => r.id)).size === RECORDS.length, 'record ids are unique');
  ok(RECORDS.every((r) => r.title && r.line && r.line.length < 80 && !/[—–]/.test(r.title + r.line)), 'every record has a title and a short line, and no em dashes');
  ok(S.save.records.length === 0, 'a fresh save has found none');
  // walk over one
  place(LANE.x, LANE.z, LANE.yaw);
  const pk = { def: { id: 'rec', kind: 'record', item: 'gala', x: p.x, z: p.z }, mesh: M.makeRecordPickup(2), taken: false, phase: 0 };
  S.pickups.push(pk);
  run(S, 0.1);
  ok(pk.taken && S.save.records.join() === 'gala', 'walking over a record finds it and saves it');
  S.banner = null;
  ARS.takeRecord('haar');
  ok(S.banner && /HAAR/.test(S.banner.title) && S.banner.sub.includes(RECORDS.find((r) => r.id === 'haar').line), 'the joke is shown');
  ok(S.toast && /2 OF/.test(S.toast.text), `and a toast counts them (${S.toast && S.toast.text})`);
  // the round trip through the save format
  const round = store.clean(JSON.parse(JSON.stringify(S.save)));
  ok(round.records.join() === 'haar,gala', 'the records survive a save round trip');
  game.testHook('give', ['haar', 'pipes']);
  ok(S.save.records.join() === 'haar,gala,pipes', `records are kept in list order (${S.save.records})`);
  const again = ARS.takeRecord('gala');
  ok(again && S.save.records.length === 3 && /ALREADY/.test(S.toast.text), 'a record found twice is not counted twice');
  ok(!ARS.takeRecord('nope'), 'an unknown record is ignored');
  // the title shows the setlist button only now
  game.testHook('title');
  const list = game.testHook('buttons');
  ok(list.some((b) => b.id === 'setlist') && list.find((b) => b.id === 'setlist').label === `SETLIST 3/${RECORDS.length}`, `the title has a SETLIST button (${list.map((b) => b.id)})`);
  const b = list.find((q) => q.id === 'setlist');
  const inp = input();
  inp.pressed.push({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  press(inp);
  ok(S.mode === 'setlist', 'tapping it opens the setlist');
  const sl = game.testHook('buttons');
  ok(sl.length === 1 && sl[0].id === 'back', 'the setlist has a BACK button');
  const inp2 = input();
  inp2.pressed.push({ x: sl[0].x + 5, y: sl[0].y + 5 });
  press(inp2);
  ok(S.mode === 'title', 'and BACK returns to the title');
}
{
  // no records yet: no SETLIST button; a debug run finds records for the joke but does not save them
  const { S, p, ARS } = fresh(1);
  game.testHook('title');
  ok(!game.testHook('buttons').some((b) => b.id === 'setlist'), 'no SETLIST button before the first record');
  S.debugMode = true;
  game.testHook('play');
  place(LANE.x, LANE.z, LANE.yaw);
  ARS.takeRecord('haar');
  ok(S.save.records.length === 0 && S.runRecords.includes('haar'), 'a debug run does not write the save');
  ok(S.banner && /HAAR/.test(S.banner.title), 'but still shows the joke');
  S.debugMode = false;
  void p;
}
{
  // the save: round trip, an old save without the field, junk
  const old = { v: 1, unlocked: 2, done: [1], best: { 1: 4200 } }; // a cookie from before records
  const o = store.clean(old);
  ok(Array.isArray(o.records) && o.records.length === 0 && o.unlocked === 2 && o.done.join() === '1' && o.best[1] === 4200, 'an old save without the field still loads, with no records');
  const oldTorch = store.clean({ v: 1, unlocked: 1, done: [], best: {}, torch: true });
  ok(oldTorch.torch === true && oldTorch.records.length === 0, 'and one from the torch version');
  const junk = [null, undefined, 5, 'x', [], {}, { records: 5 }, { records: 'haar' }, { records: { 0: 'haar' } }, { records: [1, null, {}, [], 'nope', '', 'HAAR', 'haar '] },
    { records: ['haar', 'haar', 'gala', 'gala'] }, { records: Array.from({ length: 500 }, (_, i) => `x${i}`) }, { records: [{ toString: () => 'haar' }] }, { records: [['haar']] }];
  for (const j of junk) {
    const c = store.clean(j);
    ok(Array.isArray(c.records) && c.records.every((id) => RECORDS.some((r) => r.id === id)) && new Set(c.records).size === c.records.length, `junk is rejected: ${String(JSON.stringify(j)).slice(0, 60)} gives [${c.records}]`);
    ok(c.v === 1 && c.unlocked >= 1 && Array.isArray(c.done) && typeof c.best === 'object', 'and the rest of the save is still valid');
  }
  ok(store.clean({ records: ['haar', 'haar', 'gala', 'gala'] }).records.join() === 'haar,gala', 'duplicates are dropped');
  ok(store.merge(store.clean({ records: ['haar'] }), store.clean({ records: ['gala'] })).records.join() === 'haar,gala', 'two copies of a save merge their records');
  ok(store.fresh().records.length === 0, 'a fresh save has an empty list');
  ok(JSON.stringify(store.clean(JSON.parse(JSON.stringify(store.merge(store.clean({ records: ['wee', 'haar'] }), store.fresh()))))) === JSON.stringify(store.merge(store.clean({ records: ['wee', 'haar'] }), store.fresh())), 'clean is stable on its own output');
}

console.log(`\narsenal-check: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
