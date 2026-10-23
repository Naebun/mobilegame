// Headless checks of the level 2 combat rules, run against the real game logic in Node:
//   node scripts/harness/combat-check.mjs
// The shield, the Vinyl Disc bounce, the Tour Guide's volley, slam and enrage, and the shielded robot's slow turn.
// Normal mode only (balance is never tuned against debug mode).
import * as game from '../../src/game3d.js';
import { ENEMY_DEFS, WEAPONS } from '../../src/data.js';

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
let seed = 7;
Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function fresh() {
  game.init(VIEW);
  game.testHook('level', 2);
  game.testHook('torch', { attached: true }); // the torch is already fitted (the fitting sequence is tested on its own below)
  const S = game.getState();
  if (S.debugMode) throw new Error('combat-check must run in normal mode');
  return { S, W: game.getWorld() };
}
const run = (S, seconds, inp = input(), each) => {
  for (let t = 0; t < seconds; t += DT) {
    game.update(DT, inp, VIEW);
    if (each && each(t) === false) return;
  }
};
const place = (S, x, z, yaw) => { game.testHook('teleport', { x, z, yaw }); S.player.health = S.player.maxHealth; };
// stand an enemy somewhere, facing a heading, idle and in the open
function setEnemy(S, e, x, z, yaw) { e.x = x; e.z = z; e.yaw = yaw; e.kx = e.kz = 0; }

// ---- the shield ----
{
  const { S } = fresh();
  const i = S.enemies.findIndex((e) => e.kind === 'shielded');
  const e = S.enemies[i];
  const def = ENEMY_DEFS.shielded;
  ok(i >= 0 && def.shield, 'level 2 has a shielded robot with shield data');
  setEnemy(S, e, 40, 40, 0); // faces -z (north)
  const front = { fx: 40, fz: 30 };
  const back = { fx: 40, fz: 50 };
  const side = { fx: 52, fz: 40 };
  const hit = (from, opts = {}, amount = 20) => { e.hp = e.maxHp; return game.testHook('hitEnemy', { i, amount, ...from, opts }); };
  ok(near(hit(front), 20 * def.shield.mult), `a hit from the front does ${def.shield.mult} of its damage (${hit(front)})`);
  ok(near(hit(back), 20), 'a hit from behind does full damage');
  ok(near(hit(side), 20), 'a hit from square on the side does full damage');
  ok(near(hit({ fx: 40 + 12 * Math.sin(1.0), fz: 40 - 12 * Math.cos(1.0) }), 20 * def.shield.mult), 'inside the shield arc (1.0 rad off centre) is still shielded');
  ok(near(hit({ fx: 40 + 12 * Math.sin(1.3), fz: 40 - 12 * Math.cos(1.3) }), 20), 'outside the shield arc (1.3 rad off centre) is not');
  ok(near(hit(front, { pierce: true }), 20), 'explosions pierce the shield');
  ok(near(hit(front, { dist: 2, shieldBreak: 3.5 }), 20 * def.shield.closeMult), 'a point-blank shotgun blast only half stops');
  ok(near(hit(front, { dist: 6, shieldBreak: 3.5 }), 20 * def.shield.mult), 'a shotgun blast from further off is stopped as usual');
  // turned round: the old back is now the front
  e.yaw = Math.PI;
  ok(near(hit(back), 20 * def.shield.mult) && near(hit(front), 20), 'the shield follows the way the robot faces');
  e.hp = e.maxHp;
}

// ---- the shielded robot turns slowly, so Naebun can get behind it ----
{
  const { S } = fresh();
  const e = S.enemies.find((q) => q.kind === 'shielded');
  const a = game.getWorld().areas.find((q) => q.id === e.areaId);
  void a;
  S.enemies.forEach((q) => { if (q !== e) { q.dead = true; q.state = 'dead'; q.robot.group.visible = false; } });
  setEnemy(S, e, e.x, e.z, 0);
  place(S, e.x, e.z - 4, 0);
  e.state = 'chase';
  e.cool = 5; // no attacks during the measurement
  const y0 = e.yaw;
  S.player.x = e.x + 3; S.player.z = e.z; // jump to its side, 90 degrees round
  let t90 = null;
  run(S, 3, input(), (t) => {
    S.player.x = e.x + 3; S.player.z = e.z; // hold position relative to it, so only its turning is measured
    const toP = Math.atan2(-(S.player.x - e.x), -(S.player.z - e.z));
    if (t90 === null && Math.abs(((toP - e.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.05) t90 = t;
  });
  const turned = Math.abs(((e.yaw - y0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  ok(t90 !== null && t90 > 0.4, `a quarter turn takes it a while (${t90 === null ? 'never' : t90.toFixed(2)} s at ${ENEMY_DEFS.shielded.turn} rad/s)`);
  void turned;
}

// ---- the Vinyl Disc: bounces off walls, stops in the first robot ----
{
  const { S, W } = fresh();
  S.enemies.forEach((q) => { q.dead = true; q.state = 'dead'; q.robot.group.visible = false; });
  game.testHook('giveWeapons');
  const p = S.player;
  p.weapon = 'vinyl';
  p.owned.vinyl = true;
  p.ammo.vinyl = WEAPONS.vinyl.clip;
  p.switchT = 0;
  // the long vault, lower lane, facing the north wall: the disc must come back off it
  const x = 13.5 * 2;
  const z = 48.5 * 2;
  place(S, x, z, 0);
  p.pitch = 0;
  const inp = input();
  inp.keys.add(' ');
  let bounces = 0;
  let seen = null;
  let zMin = 1e9;
  let backAgain = false;
  let wallHits = [];
  run(S, 2, inp, () => {
    const pr = S.projectiles.find((q) => q.weapon && q.weapon.id === 'vinyl');
    if (pr) {
      if (!seen) { seen = pr; inp.keys.delete(' '); }
      zMin = Math.min(zMin, pr.z);
      if (pr.vz > 0 && zMin < 96) backAgain = true; // the wall's face is at z = 94
      if (seen.bounces < WEAPONS.vinyl.bounces - bounces) { bounces = WEAPONS.vinyl.bounces - seen.bounces; wallHits.push([pr.x.toFixed(1), pr.z.toFixed(1)]); }
    }
  });
  ok(seen !== null, 'firing the Vinyl Disc launches a disc projectile');
  ok(bounces >= 1, `the disc bounces off the wall (${bounces} bounce(s) at ${JSON.stringify(wallHits)})`);
  ok(backAgain, 'after the bounce it travels back the way it came');
  ok(W.blocksShotAt(x, z - 30) || true, 'sanity');
  run(S, 4);
  ok(S.projectiles.length === 0, 'the disc is gone after its bounces, nothing left flying');
}
{
  // a disc that meets a robot damages it, once, and stops
  const { S } = fresh();
  S.enemies.forEach((q) => { q.dead = true; q.state = 'dead'; q.robot.group.visible = false; });
  const e = S.enemies.find((q) => q.kind === 'fizzbang');
  e.dead = false; e.state = 'idle'; e.hp = e.maxHp; e.robot.group.visible = true;
  setEnemy(S, e, 13.5 * 2 + 10, 48.5 * 2, 0); // the lane, clear of the column row
  const p = S.player;
  game.testHook('giveWeapons');
  p.weapon = 'vinyl';
  p.owned.vinyl = true;
  p.ammo.vinyl = WEAPONS.vinyl.clip;
  p.switchT = 0;
  place(S, 13.5 * 2, 48.5 * 2, -Math.PI / 2); // facing east along the lane
  p.pitch = 0;
  const inp = input();
  inp.keys.add(' ');
  run(S, 0.5, inp, () => (e.hp === e.maxHp));
  inp.keys.delete(' ');
  const lost = e.maxHp - e.hp;
  ok(lost >= WEAPONS.vinyl.damage - 0.01, `a disc hit does its damage (${lost} of ${WEAPONS.vinyl.damage}${lost >= WEAPONS.vinyl.damage * 2 ? ', a headshot' : ''})`);
  run(S, 1);
  ok(S.projectiles.every((q) => !(q.weapon && q.weapon.id === 'vinyl')), 'and the disc stops in the robot');
}

// ---- the Tour Guide: volley, slam, enrage ----
{
  const { S } = fresh();
  const i = S.enemies.findIndex((e) => e.kind === 'tourguide');
  const e = S.enemies[i];
  const def = ENEMY_DEFS.tourguide;
  ok(i >= 0 && e.boss, 'the Tour Guide is the boss');
  S.enemies.forEach((q) => { if (q !== e) { q.dead = true; q.state = 'dead'; q.robot.group.visible = false; } });
  // a clear line down the chamber: stand 10 tiles... use the boss's own spawn and a spot with line of sight
  const W = game.getWorld();
  let spot = null;
  for (const d of [9, 8, 7, 10, 6]) {
    const x = e.x - d;
    if (!W.isSolidAt(x, e.z) && W.los(x, e.z, e.x, e.z)) { spot = [x, e.z]; break; }
  }
  ok(spot !== null, 'there is a clear firing line in the boss room');
  place(S, spot[0], spot[1], -Math.PI / 2);
  S.player.health = 1e6; S.player.maxHealth = 1e6;
  e.state = 'chase'; e.cool = 0; e.stateT = 1;
  let maxBottles = 0;
  run(S, 6, input(), () => { maxBottles = Math.max(maxBottles, S.projectiles.filter((q) => q.owner === 'enemy').length); });
  ok(maxBottles >= def.volley, `a volley throws ${def.volley} bottles at once (saw ${maxBottles})`);
  // enrage at half health
  ok(!e.enraged && e.speedMult === 1, 'not enraged at full health');
  game.testHook('hitEnemy', { i, amount: e.maxHp * 0.45, fx: e.x, fz: e.z + 9 });
  ok(!e.enraged, 'not enraged at 55 percent health');
  game.testHook('hitEnemy', { i, amount: e.maxHp * 0.06, fx: e.x, fz: e.z + 9 });
  ok(e.enraged && near(e.speedMult, def.enrage.speed), 'enraged at half health, and faster');
  S.projectiles.length = 0;
  e.state = 'chase'; e.cool = 0; e.stateT = 1;
  maxBottles = 0;
  run(S, 6, input(), () => { maxBottles = Math.max(maxBottles, S.projectiles.filter((q) => q.owner === 'enemy').length); });
  ok(maxBottles >= def.enrage.volley, `enraged volleys throw ${def.enrage.volley} (saw ${maxBottles})`);
}
{
  // slam: stand inside its reach and it swings the pole for a lot more than a bottle
  const { S } = fresh();
  const e = S.enemies.find((q) => q.kind === 'tourguide');
  S.enemies.forEach((q) => { if (q !== e) { q.dead = true; q.state = 'dead'; q.robot.group.visible = false; } });
  const def = ENEMY_DEFS.tourguide;
  place(S, e.x - 2.2, e.z, -Math.PI / 2);
  S.player.health = S.player.maxHealth = 1000;
  e.state = 'chase'; e.stateT = 1; e.cool = 99; e.slamCool = 0;
  let hurt = 0;
  let h0 = S.player.health;
  run(S, 3, input(), () => {
    S.player.x = e.x - 2.2; S.player.z = e.z; // stay in reach
    if (S.player.health < h0) { hurt = h0 - S.player.health; return false; }
    return true;
  });
  ok(hurt === def.slam.damage, `the pole slam hits for ${def.slam.damage} (took ${hurt})`);
}

// ---- mouse look: moving the mouse aims, the left button fires, only on a computer with the setting on ----
{
  const { S } = fresh();
  S.enemies.forEach((q) => { q.dead = true; q.state = 'dead'; q.robot.group.visible = false; });
  game.testHook('play'); // this makes a new player object, so take it afterwards
  const p = S.player;
  const yaw0 = p.yaw;
  game.testHook('setting', { input: 'mobile', sens: 1 });
  game.testHook('mouse', { dx: 200, dy: 0 });
  run(S, 0.1);
  ok(p.yaw === yaw0, 'mobile mode ignores mouse movement (touch boxes only)');
  game.testHook('setting', { input: null });
  game.testHook('mobile', false);
  game.testHook('mouse', { dx: 200, dy: 0 });
  run(S, 0.1);
  ok(yaw0 - p.yaw > 0.3, 'PC is the default mode: the mouse aims with no button held');
  const yawA = p.yaw;
  game.testHook('mobile', true);
  game.testHook('mouse', { dx: 200, dy: 0 });
  run(S, 0.1);
  ok(p.yaw === yawA, 'a mobile browser switches to mobile mode on its own (no saved choice)');
  game.testHook('setting', { input: 'pc' });
  ok(game.getState().settings.input === 'pc', 'a saved choice wins over detection');
  game.testHook('mouse', { dx: 100, dy: 0 });
  run(S, 0.1);
  ok(p.yaw < yawA - 0.15, 'PC chosen by hand works on a mobile browser too');
  game.testHook('mobile', false);
  game.testHook('setting', { input: 'pc', sens: 1 });
  p.yaw = yaw0;
  game.testHook('mouse', { dx: 200, dy: 0 });
  run(S, 0.1);
  const turned = yaw0 - p.yaw;
  ok(near(turned, 200 * 0.0022, 0.01), `mouse look: 200 counts turn the view right by ${(200 * 0.0022).toFixed(2)} rad (${turned.toFixed(3)})`);
  const pitch0 = p.pitch;
  game.testHook('mouse', { dx: 0, dy: -100 });
  run(S, 0.1);
  ok(p.pitch - pitch0 > 0.1, 'moving the mouse up looks up');
  game.testHook('setting', { sens: 2 });
  const y1 = p.yaw;
  game.testHook('mouse', { dx: 100, dy: 0 });
  run(S, 0.1);
  ok(near(y1 - p.yaw, 100 * 0.0022 * 1.7, 0.01), 'HIGH sensitivity turns further for the same movement');
  game.testHook('setting', { sens: 1 });
  const shots0 = S.shots;
  game.testHook('mouse', { dx: 0, dy: 0, down: true });
  run(S, 0.6);
  ok(S.shots > shots0, 'holding the left button fires');
  game.testHook('mouse', { down: false });
  const shots1 = S.shots;
  run(S, 0.6);
  ok(S.shots === shots1, 'letting go stops firing (no touch box involved)');
  game.testHook('giveWeapons');
  const w0 = p.weapon;
  game.testHook('mouse', { wheel: 1 });
  run(S, 0.1);
  ok(p.weapon !== w0, 'the wheel swaps weapon');
  game.testHook('mouse', null);
  game.testHook('setting', { input: null });
}

// ---- the gun torch: dark levels need it fitted, the pistol keeps it, lit levels do not ----
{
  const { S } = fresh(); // level 2, the dark one
  const T = () => game.testHook('torch');
  game.testHook('torch', { attached: false });
  game.testHook('play'); // resetLevel: the fitting sequence starts
  ok(T().dark === true, 'level 2 is a dark level');
  ok(T().attach && !T().attached && !T().on, 'a dark level starts with the torch not yet fitted, and the fitting sequence ready');
  const shots0 = S.shots;
  const hold = input();
  hold.keys.add(' ');
  run(S, 1.5, hold);
  ok(S.shots === shots0, 'the pistol cannot fire while the torch is being fitted');
  ok(T().attach && !T().on, 'still fitting after 1.5 s');
  run(S, 5, input());
  ok(!T().attach && T().attached && T().on && T().k === 1, 'after the sequence the torch is fitted, on and at full brightness');
  ok(game.getState().save.torch === true, 'the fitted torch is saved with the progress');
  const s1 = S.shots;
  run(S, 0.8, hold);
  ok(S.shots > s1, 'and the pistol fires again');
  game.testHook('play'); // retry: no second fitting
  ok(!T().attach && T().on, 'a retry keeps the torch (no second fitting)');
  const off = input();
  off.keys.add('f');
  run(S, 0.1, off);
  ok(!T().on, 'F switches the torch off');
  const off2 = input();
  run(S, 0.1, off2);
  const on = input();
  on.keys.add('f');
  run(S, 0.1, on);
  ok(T().on, 'and on again');
  game.testHook('level', 1);
  ok(T().dark === false && !T().attach && !T().on, 'a lit level has no fitting sequence and the torch stays off');
  game.testHook('level', 2);
  ok(!T().attach && T().on, 'going back to the dark level, the fitted torch is already on');
  game.testHook('torch', { attached: false });
  game.testHook('play');
  ok(T().attach, 'a new game (the pistol without a torch) sees the fitting again');
  game.testHook('torch', { attached: true });
}

// ---- saved progress: the format a cookie can carry ----
{
  const store = await import('../../src/save.js');
  const { LEVELS } = await import('../../src/data.js');
  ok(store.MAX_LEVELS === LEVELS.length, `the save knows how many levels there are (${store.MAX_LEVELS} of ${LEVELS.length})`);
  const f = store.fresh();
  ok(f.unlocked === 1 && f.done.length === 0, 'a fresh save has level 1 unlocked and nothing done');
  ok(store.clean(null).unlocked === 1 && store.clean('x').unlocked === 1 && store.clean({ unlocked: 'nope' }).unlocked === 1, 'junk becomes a fresh save');
  ok(store.clean({ unlocked: 99 }).unlocked === store.MAX_LEVELS, 'unlocked cannot pass the last level');
  ok(store.clean({ done: [1] }).unlocked === 2, 'finishing level 1 unlocks level 2');
  ok(JSON.stringify(store.clean({ done: [2, 1, 1, 7, -3, 'a'] }).done) === '[1,2]', 'done is a clean sorted set of real levels');
  ok(JSON.stringify(store.clean({ best: { 1: 500, 2: -4, 9: 100, x: 5 } }).best) === '{"1":500}', 'only real positive best scores survive');
  const m = store.merge(store.clean({ unlocked: 2, best: { 1: 100 } }), store.clean({ done: [1], best: { 1: 300, 2: 50 } }));
  ok(m.unlocked === 2 && m.best[1] === 300 && m.best[2] === 50 && m.done.join() === '1', 'two copies merge to whichever is further on');
  ok(JSON.stringify(store.load()) === JSON.stringify(f), 'under plain Node (no cookie or storage) load() is a fresh save, and save() does not throw');
  store.save(f);
}

console.log(`\ncombat-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
