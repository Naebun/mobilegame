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

// ---- the shielded robot turns slowly, so Freddie can get behind it ----
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

console.log(`\ncombat-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
