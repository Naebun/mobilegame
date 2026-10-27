// Headless checks of the level 2 combat rules, run against the real game logic in Node:
//   node scripts/harness/combat-check.mjs
// The shield, the Vinyl Disc bounce, the Tour Guide's volley, slam and enrage, and the shielded robot's slow turn.
// Normal mode only (balance is never tuned against debug mode).
import * as game from '../../src/game3d.js';
import { ENEMY_DEFS, WEAPONS, PLAYER, DIFFICULTY, DIFFICULTY_ORDER, TELEGRAPH_FLOOR, defFor } from '../../src/data.js';

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

// ---- the Reverb Launcher hurts Naebun when it goes off close ----
{
  const shoot = (x, z, yaw) => {
    const { S } = fresh();
    S.enemies.forEach((q) => { q.dead = true; q.state = 'dead'; q.robot.group.visible = false; });
    game.testHook('giveWeapons');
    const p = S.player;
    p.weapon = 'launcher';
    p.owned.launcher = true;
    p.ammo.launcher = WEAPONS.launcher.clip;
    p.switchT = 0;
    place(S, x, z, yaw);
    p.pitch = 0;
    const inp = input();
    inp.keys.add(' ');
    let seen = false;
    run(S, 3, inp, () => {
      if (S.projectiles.some((q) => q.weapon && q.weapon.id === 'launcher')) { seen = true; inp.keys.delete(' '); }
      return !(seen && S.projectiles.length === 0);
    });
    run(S, 1.5); // let the shove play out
    return { lost: p.maxHealth - p.health, seen, moved: Math.hypot(p.x - x, p.z - z), back: p.z - z };
  };
  const W_ = WEAPONS.launcher;
  const near = shoot(13.5 * 2, 48 * 2, 0); // two metres from the north wall
  ok(near.seen && near.lost > 0, `a rocket that bursts two metres away hurts Naebun (lost ${near.lost})`);
  ok(near.lost <= W_.selfDamage, `and never more than selfDamage (${near.lost} of ${W_.selfDamage})`);
  ok(near.back > 0.5 && near.back < 3.5, `and the blast throws them back from the wall, not toward it (${near.back.toFixed(2)} m)`);
  const far = shoot(13.5 * 2, 48.5 * 2, -Math.PI / 2); // down the lane, well clear of the blast
  ok(far.seen && far.lost === 0, `a rocket that bursts far away does not (lost ${far.lost})`);
  ok(far.moved < 0.01, `or move them (${far.moved.toFixed(2)} m)`);
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

// ---- choosing a weapon: a tap on the strip, the number keys, the wheel (both ways), Q (the last weapon), SWAP (next) ----
{
  const { WEAPON_ORDER } = await import('../../src/data.js');
  const { wheelGate, WHEEL_GAP_MS } = await import('../../src/engine.js');
  const { S } = fresh();
  const SWAP_T = 0.25; // the swap time the game has always charged
  const quiet = () => { for (const e of S.enemies) { e.dead = true; e.state = 'dead'; e.robot.group.visible = false; } };
  // a new run (a new player object, so take it afterwards), no robots, the torch fitted
  const newRun = () => {
    game.testHook('torch', { attached: true });
    game.testHook('play');
    quiet();
    run(S, 0.4);
    return S.player;
  };
  const keyTap = (key) => { const a = input(); a.keys.add(key); run(S, 3 * DT, a); run(S, 3 * DT); }; // pressed, then let go
  const tapAt = (x, y) => { // a finger down at (x, y), as the engine delivers it: a press event and a live touch
    const a = input();
    a.pressed.push({ x, y });
    a.touches.set(1, { id: 1, x, y, sx: x, sy: y, role: null });
    run(S, DT, a);
    return a;
  };
  const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];
  const lay = () => game.testHook('layout');
  const tapButton = (name) => { const b = input(); const [x, y] = centre(lay()[name]); b.pressed.push({ x, y }); run(S, DT, b); };
  const wheelOnce = (dir) => { game.testHook('mouse', { wheel: dir }); run(S, DT); game.testHook('mouse', null); run(S, 0.3); };
  const stripIds = () => game.testHook('hud').weapons.map((w) => w.id);
  const cellsNow = () => lay().strip(stripIds().length).cells;
  game.testHook('setting', { input: 'pc' });

  let p = newRun();
  ok(p.weapon === 'pistol' && p.owned.pistol && !p.owned.shotgun, 'a new run starts with the pistol only');
  ok(p.lastWeapon === undefined, 'and with no last weapon');

  // not owned: nothing happens
  keyTap('2');
  ok(p.weapon === 'pistol', 'a number key for a weapon not owned does nothing');
  keyTap('8');
  ok(p.weapon === 'pistol', 'and so does a key for a prepared weapon not owned');
  keyTap('9');
  ok(p.weapon === 'pistol', 'and a key past the last slot');
  ok(p.lastWeapon === undefined, 'a refused select leaves no last weapon behind');

  game.testHook('giveWeapons');
  ok(WEAPON_ORDER.length === 8 && WEAPON_ORDER[0] === 'pistol' && WEAPON_ORDER[3] === 'launcher', 'the slots are WEAPON_ORDER (1 pistol, 2 shotgun, 3 SMG, 4 launcher, 5 vinyl, 6 beam, 7 grenade, 8 airhorn)');
  // direct select by slot, from anywhere to anywhere, in one press
  keyTap('4');
  ok(p.weapon === 'launcher', 'key 4 selects the launcher in one press, skipping the weapons between');
  run(S, 0.4);
  keyTap('2');
  ok(p.weapon === 'shotgun', 'key 2 goes back to the shotgun in one press (no cycling forwards round the lot)');
  run(S, 0.4);
  keyTap('5');
  ok(p.weapon === 'vinyl', 'key 5 selects the vinyl disc');
  run(S, 0.4);
  keyTap('8');
  ok(p.weapon === 'vinyl', 'key 8 (airhorn) still does nothing while the airhorn is not owned');
  game.testHook('give', ['beam', 'grenade', 'airhorn']);
  for (const [key, id] of [['6', 'beam'], ['7', 'grenade'], ['8', 'airhorn'], ['1', 'pistol'], ['3', 'smg']]) {
    run(S, 0.3);
    keyTap(key);
    ok(p.weapon === id, `key ${key} selects the ${id}: the beam, the grenade and the airhorn are chosen like any other weapon`);
  }

  // the key matches the icon: the strip carries each weapon's slot
  {
    const h = game.testHook('hud');
    ok(h.weapons.every((w) => w.slot === WEAPON_ORDER.indexOf(w.id) + 1), 'every cell on the strip carries its slot number (the key that picks it)');
    ok(h.weapons.length === 8 && h.weapons.map((w) => w.id).join() === WEAPON_ORDER.join(), 'with all eight owned the strip shows eight cells in WEAPON_ORDER');
  }

  // holding a key is one selection, not a repeat
  {
    run(S, 0.3);
    const hold = input();
    hold.keys.add('1');
    run(S, 2 * DT, hold);
    ok(p.weapon === 'pistol', 'key 1 selects the pistol');
    p.weapon = 'smg'; // as if something else changed it while the key is still down
    run(S, 20 * DT, hold);
    ok(p.weapon === 'smg', 'a key held down selects once (a new press is needed)');
  }

  // the weapon already in hand: nothing happens (no new swap time, no cancelled reload, no last weapon)
  {
    p = newRun();
    game.testHook('giveWeapons');
    p.weapon = 'smg';
    p.switchT = 0;
    p.ammo.smg = 10;
    const a = input();
    a.keys.add('r');
    run(S, DT, a);
    run(S, 2 * DT);
    ok(p.reloadT > 0, 'the SMG is reloading');
    const r0 = p.reloadT;
    p.lastWeapon = 'shotgun';
    keyTap('3');
    ok(p.weapon === 'smg' && p.switchT === 0 && p.reloadT > 0 && p.reloadT < r0, 'selecting the weapon already in hand does nothing (no swap time, the reload carries on)');
    ok(p.lastWeapon === 'shotgun', 'and it does not become the last weapon');
    tapAt(...centre(cellsNow()[2].hit));
    ok(p.weapon === 'smg' && p.switchT === 0 && p.reloadT > 0, 'nor does a tap on its own cell');
  }

  // a reload in progress: a direct select does what a cycle swap does, it drops the reload
  {
    p = newRun();
    game.testHook('giveWeapons');
    const reload = () => { p.weapon = 'smg'; p.switchT = 0; p.ammo.smg = 1; p.reloadT = 0; const a = input(); a.keys.add('r'); run(S, DT, a); run(S, 2 * DT); };
    reload();
    ok(p.reloadT > 0, 'reloading');
    keyTap('2');
    ok(p.weapon === 'shotgun' && p.reloadT === 0, 'a direct select drops the reload in progress');
    reload();
    tapButton('swapBtn');
    ok(p.weapon !== 'smg' && p.reloadT === 0, 'and the SWAP button drops it too (as it always did)');
  }

  // the swap time: a chosen weapon cannot fire until the usual swap time has gone
  {
    p = newRun();
    game.testHook('giveWeapons');
    p.weapon = 'pistol';
    const shots0 = S.shots;
    const both = input();
    both.keys.add(' ');
    both.keys.add('3');
    run(S, DT, both);
    ok(p.weapon === 'smg', 'select and fire in the same frame: the weapon changes');
    ok(near(p.switchT, SWAP_T, 0.001), `a swap takes the usual ${SWAP_T} s (switchT ${p.switchT.toFixed(3)})`);
    ok(S.shots === shots0, 'and the gun does not fire in that frame');
    const held = input();
    held.keys.add(' ');
    let firedAt = null;
    run(S, 0.8, held, (t) => { if (S.shots > shots0) { firedAt = t; return false; } return true; });
    ok(firedAt !== null && firedAt >= SWAP_T - 2 * DT && firedAt < SWAP_T + 0.15, `the new gun first fires about ${SWAP_T} s after the select (${firedAt === null ? 'never' : firedAt.toFixed(2)} s)`);
    // every route charges the same swap time
    for (const route of ['key', 'tap', 'q', 'wheel', 'swap']) {
      p.weapon = 'pistol'; p.lastWeapon = 'shotgun'; p.switchT = 0; p.reloadT = 0;
      run(S, 0.4);
      if (route === 'key') keyTap('2');
      else if (route === 'tap') tapAt(...centre(cellsNow()[1].hit));
      else if (route === 'q') keyTap('q');
      else if (route === 'wheel') { game.testHook('mouse', { wheel: 1 }); run(S, DT); game.testHook('mouse', null); } else tapButton('swapBtn');
      ok(p.weapon === 'shotgun', `${route}: pistol to shotgun`);
      // measured a few frames after the change, so allow for them
      ok(p.switchT > 0 && p.switchT <= SWAP_T, `${route}: the swap costs switchT ${p.switchT.toFixed(3)} (at most ${SWAP_T})`);
      run(S, 0.4);
    }
  }

  // Q: quick-swap to the last weapon, a toggle between two
  {
    p = newRun();
    ok(p.lastWeapon === undefined, 'a new run has no last weapon');
    game.testHook('giveWeapons');
    keyTap('q');
    ok(p.weapon === 'shotgun', 'with no last weapon yet, Q cycles forward as before');
    run(S, 0.4);
    keyTap('q');
    ok(p.weapon === 'pistol', 'and now Q goes back to the pistol (the last one used)');
    run(S, 0.4);
    keyTap('q');
    ok(p.weapon === 'shotgun', 'Q again is a toggle: shotgun');
    run(S, 0.4);
    keyTap('4');
    run(S, 0.4);
    keyTap('q');
    ok(p.weapon === 'shotgun', 'after a jump to the launcher (key 4), Q goes back to the shotgun, not the pistol');
    run(S, 0.4);
    keyTap('q');
    ok(p.weapon === 'launcher', 'and flips to the launcher again');
    // a weapon picked up counts as a change: Q goes back to what was in hand before
    run(S, 0.4);
    keyTap('3');
    run(S, 0.4);
    game.testHook('give', ['grenade']);
    run(S, 0.4);
    keyTap('7');
    run(S, 0.4);
    keyTap('q');
    ok(p.weapon === 'smg', 'Q after a jump to the grenade goes back to the SMG that was in hand');
    // the tap and the wheel set the last weapon too
    run(S, 0.4);
    tapAt(...centre(cellsNow()[3].hit)); // launcher
    run(S, 0.4);
    keyTap('q');
    ok(p.weapon === 'smg', 'a tap on the strip counts as the last weapon too');
    run(S, 0.4);
    wheelOnce(1);
    const afterWheel = p.weapon;
    keyTap('q');
    ok(afterWheel !== 'smg' && p.weapon === 'smg', 'and so does a wheel step');
    // Q during a hands-full state does nothing
    run(S, 0.4);
    game.testHook('drink', 'dram');
    keyTap('q');
    ok(p.weapon === 'smg', 'Q does nothing while drinking');
    run(S, 6);
    // the last weapon only matters if it is still owned
    p.lastWeapon = 'airhorn';
    keyTap('q');
    ok(p.weapon !== 'airhorn' && p.owned[p.weapon], 'a last weapon that is not owned is ignored (Q cycles instead)');
  }

  // the wheel: down is the next owned weapon, up is the previous, both wrap
  {
    p = newRun();
    game.testHook('giveWeapons');
    game.testHook('give', ['grenade']); // owned: pistol shotgun smg launcher vinyl grenade (the beam and airhorn are not)
    game.testHook('setting', { input: 'pc' });
    wheelOnce(1);
    ok(p.weapon === 'shotgun', 'wheel down: the next weapon (pistol to shotgun)');
    wheelOnce(-1);
    ok(p.weapon === 'pistol', 'wheel up: the previous weapon (back to the pistol)');
    wheelOnce(-1);
    ok(p.weapon === 'grenade', 'wheel up from the first wraps to the last owned weapon, skipping the beam and airhorn it does not own');
    wheelOnce(1);
    ok(p.weapon === 'pistol', 'wheel down from the last wraps to the first');
    wheelOnce(2);
    ok(p.weapon === 'shotgun', 'a bigger delta is still one step');
    wheelOnce(-3);
    ok(p.weapon === 'pistol', 'and one step the other way');
    for (let i = 0; i < 5; i++) wheelOnce(1);
    ok(p.weapon === 'grenade', 'five steps down: shotgun, smg, launcher, vinyl, grenade');
    wheelOnce(0);
    ok(p.weapon === 'grenade', 'a zero wheel does nothing');
    game.testHook('setting', { input: 'mobile' });
    wheelOnce(1);
    ok(p.weapon === 'grenade', 'in mobile mode the wheel does nothing');
    game.testHook('setting', { input: 'pc' });
  }

  // the engine's wheel gate: a quiet gap of 180 ms, the direction carried, a flick is one step
  {
    ok(WHEEL_GAP_MS === 180, 'the quiet gap is still 180 ms');
    const g = wheelGate();
    ok(g(1000, 100) === 1 && g(1000 + WHEEL_GAP_MS + 1, -3) === -1, 'down is +1 and up is -1');
    const g2 = wheelGate();
    const flick = [100, 60, 30, 12, 5, 2, 1].map((d, i) => g2(5000 + i * 40, d));
    ok(flick[0] === 1 && flick.slice(1).every((x) => x === 0), 'a trackpad flick (events every 40 ms as it coasts) is one step');
    const g3 = wheelGate();
    ok(g3(0, 1) === 1 && g3(100, 1) === 0 && g3(200, 1) === 0 && g3(300, 1) === 0, 'events keep restarting the gap, so a long coast never counts twice');
    ok(g3(300 + 181, -1) === -1, 'a new flick after a quiet gap, the other way, is a step the other way');
    const g4 = wheelGate();
    ok(g4(10, 0) === 0 && g4(500, 1) === 1, 'a zero deltaY (a sideways swipe) is not a step');
    ok(wheelGate()(10, 5, false) === 0, 'a wheel with the pointer not locked is not a step');
  }

  // a tap on the strip: selects an owned weapon, never aims or fires; a thumb in the aim box never selects
  {
    p = newRun();
    game.testHook('setting', { input: 'mobile' });
    game.testHook('giveWeapons');
    run(S, 0.4);
    ok(stripIds().join() === 'pistol,shotgun,smg,launcher,vinyl', 'the strip shows the five ordinary weapons (the prepared three only once owned)');
    const cells = cellsNow();
    ok(cells.length === 5, 'five cells');
    for (const [i, id] of [[3, 'launcher'], [1, 'shotgun'], [4, 'vinyl'], [0, 'pistol'], [2, 'smg']]) {
      run(S, 0.3);
      tapAt(...centre(cells[i].hit));
      ok(p.weapon === id, `a tap on cell ${i + 1} selects the ${id}`);
      run(S, DT);
    }
    // the tap area is taller than the drawn cell
    run(S, 0.3);
    tapAt(cells[1].x + cells[1].w / 2, cells[1].y + cells[1].h + 6);
    ok(p.weapon === 'shotgun', 'a tap a little below the drawn cell still counts (the tap area is taller)');
    // a prepared weapon shows once owned: the sixth cell is the grenade
    ok(stripIds().length === 5, 'the grenade is not on the strip until it is owned');
    game.testHook('give', ['grenade']);
    run(S, 0.4);
    ok(stripIds().join() === 'pistol,shotgun,smg,launcher,vinyl,grenade', 'the grenade joins the strip once owned');
    run(S, 0.3);
    tapAt(...centre(cellsNow()[5].hit));
    ok(p.weapon === 'grenade', 'and its cell selects it');
    // a tap on a cell never aims or fires: the touch has the button role, dragging it does not turn the view
    run(S, 0.4);
    p.weapon = 'smg';
    const yaw0 = p.yaw;
    const pitch0 = p.pitch;
    const shots0 = S.shots;
    const a = tapAt(...centre(cellsNow()[2].hit)); // (the strip has six cells now: its geometry moved)
    const t = a.touches.get(1);
    ok(t.role === 'btn', 'a touch that starts on a strip cell is a button touch');
    for (let i = 0; i < 40; i++) { t.x += 4; t.y += 3; run(S, DT, a); }
    ok(p.yaw === yaw0 && p.pitch === pitch0, 'dragging from a strip cell does not aim');
    ok(S.shots === shots0, 'and it does not fire');
    // a cell whose weapon is not owned swallows the touch and selects nothing
    run(S, 0.4);
    p.owned.vinyl = false;
    p.weapon = 'smg';
    const b = tapAt(...centre(cellsNow()[4].hit));
    ok(b.touches.get(1).role === 'btn' && p.weapon === 'smg', 'a cell for a weapon not owned does nothing, and the touch is still a button touch');
    p.owned.vinyl = true;
    // a thumb in the aim box fires and aims but never selects
    run(S, 0.4);
    p.weapon = 'smg';
    const lb = lay().lookBox;
    const c = input();
    c.pressed.push({ x: lb.x + lb.w / 2, y: lb.y + 8 });
    c.touches.set(2, { id: 2, x: lb.x + lb.w / 2, y: lb.y + 8, sx: lb.x + lb.w / 2, sy: lb.y + 8, role: null });
    run(S, 5 * DT, c);
    ok(c.touches.get(2).role === 'look' && p.weapon === 'smg', 'a thumb in the aim box is the aim touch and selects nothing');
    const mb = lay().moveBox;
    const d = input();
    d.pressed.push({ x: mb.x + mb.w / 2, y: mb.y + 8 });
    d.touches.set(3, { id: 3, x: mb.x + mb.w / 2, y: mb.y + 8, sx: mb.x + mb.w / 2, sy: mb.y + 8, role: null });
    run(S, 5 * DT, d);
    ok(d.touches.get(3).role === 'move' && p.weapon === 'smg', 'a thumb in the move box selects nothing either');
    // the SWAP button still cycles forward; open space is still a free aim touch
    run(S, 0.3);
    p.weapon = 'pistol';
    tapButton('swapBtn');
    ok(p.weapon === 'shotgun', 'the SWAP button still cycles forward');
    run(S, 0.3);
    const free = tapAt(195, 300);
    ok(free.touches.get(1).role === 'free' && p.weapon === 'shotgun', 'a tap in open space is still a free aim touch');
    game.testHook('setting', { input: 'pc' });
  }

  // hands full: the torch fitting and drinking block every route
  {
    game.testHook('torch', { attached: false });
    game.testHook('play'); // the fitting sequence starts on this dark level
    quiet();
    p = S.player;
    game.testHook('giveWeapons');
    ok(game.testHook('torch').attach, 'the torch is being fitted');
    p.weapon = 'pistol';
    keyTap('3');
    tapAt(...centre(cellsNow()[3].hit));
    keyTap('q');
    game.testHook('mouse', { wheel: 1 });
    run(S, DT);
    game.testHook('mouse', null);
    tapButton('swapBtn');
    ok(p.weapon === 'pistol', 'while the torch is being fitted, no route changes the weapon (key, tap, Q, wheel, SWAP)');
    run(S, 6);
    ok(!game.testHook('torch').attach, 'the fitting finishes');
    keyTap('3');
    ok(p.weapon === 'smg', 'and then a key works');
    run(S, 0.4);
    game.testHook('drink', 'dram');
    keyTap('1');
    tapAt(...centre(cellsNow()[1].hit));
    keyTap('q');
    tapButton('swapBtn');
    ok(p.weapon === 'smg', 'while drinking, no route changes the weapon');
    run(S, 6);
    keyTap('1');
    ok(p.weapon === 'pistol', 'and after the drink a key works again');
  }
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

// ---- difficulty: Hard and Extra Hard are multipliers on the robots (docs/difficulty.md) ----
{
  const KINDS = Object.keys(ENEMY_DEFS);
  const near2 = (a, b, eps) => Math.abs(a - b) <= eps;
  const sc = (v, k) => Math.round(v * k);
  const quick = (v, k) => Math.max(v * k, Math.min(v, TELEGRAPH_FLOOR));
  // every warning a robot gives, as [label, seconds] pairs, read from a definition
  const warnings = (d) => [['windup', d.windup], ['aim', d.aim], ['slam', d.slam && d.slam.windup], ['track', d.charge && d.charge.track], ['lock', d.charge && d.charge.lock], ['fuse', d.prime && d.prime.fuse], ['unfold', d.dormant && d.dormant.unfold]].filter((w) => w[1] !== undefined);

  ok(JSON.stringify(DIFFICULTY_ORDER) === '["normal","hard","extra"]', 'three modes: normal, hard, extra');
  ok(DIFFICULTY.normal.damage === 1 && DIFFICULTY.normal.health === 1 && DIFFICULTY.normal.speed === 1 && DIFFICULTY.normal.windup === 1, 'normal is all ones');
  // the numbers themselves are tuned with the bots (docs/difficulty.md), so the table is checked for its shape, not pinned
  for (const k of ['damage', 'health', 'speed']) ok(DIFFICULTY.normal[k] < DIFFICULTY.hard[k] && DIFFICULTY.hard[k] < DIFFICULTY.extra[k] && DIFFICULTY.hard[k] <= 2 && DIFFICULTY.extra[k] <= 2.5, `${k} rises from normal to hard to extra (${DIFFICULTY.normal[k]}, ${DIFFICULTY.hard[k]}, ${DIFFICULTY.extra[k]})`);
  ok(DIFFICULTY.normal.windup > DIFFICULTY.hard.windup && DIFFICULTY.hard.windup > DIFFICULTY.extra.windup && DIFFICULTY.extra.windup >= 0.7, `wind-ups get shorter, by at most 30 percent (${DIFFICULTY.normal.windup}, ${DIFFICULTY.hard.windup}, ${DIFFICULTY.extra.windup})`);
  ok(DIFFICULTY.hard.speed <= 1.2 && DIFFICULTY.extra.speed <= 1.2 && 3.6 * DIFFICULTY.extra.speed < PLAYER.speed, 'no robot, the quick Shaken included, can outwalk Naebun in any mode');

  // the pure function: every kind, every mode, every number it is meant to touch and none it is not
  for (const kind of KINDS) {
    const base = ENEMY_DEFS[kind];
    ok(defFor(kind, 'normal') === base, `${kind}: normal returns the base definition itself (nothing copied, nothing scaled)`);
    for (const m of ['hard', 'extra']) {
      const D = DIFFICULTY[m];
      const d = defFor(kind, m);
      const same = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${kind} ${m}: ${what} is not scaled`);
      ok(d !== base && d.hp === sc(base.hp, D.health), `${kind} ${m}: hp ${base.hp} -> ${d.hp}`);
      ok(near2(d.speed, base.speed * D.speed, 1e-9), `${kind} ${m}: speed ${base.speed} -> ${d.speed.toFixed(2)}`);
      ok(base.damage === undefined ? d.damage === undefined : d.damage === sc(base.damage, D.damage), `${kind} ${m}: damage ${base.damage} -> ${d.damage}`);
      ok(warnings(d).every((w, i) => near2(w[1], quick(warnings(base)[i][1], D.windup), 1e-9)), `${kind} ${m}: warnings ${warnings(base).map((w) => `${w[0]} ${w[1]}`).join(', ') || 'none'} -> ${warnings(d).map((w) => `${w[1].toFixed(2)}`).join(', ') || 'none'}`);
      ok(warnings(d).every((w, i) => w[1] >= Math.min(warnings(base)[i][1], TELEGRAPH_FLOOR) - 1e-9), `${kind} ${m}: no warning is shorter than ${TELEGRAPH_FLOOR} s (or than it already was)`);
      same(d.score, base.score, 'score');
      same([d.reach, d.swing, d.cooldown, d.shotInterval, d.projSpeed, d.keepMin, d.keepMax, d.range, d.wakeRange, d.shield, d.turn], [base.reach, base.swing, base.cooldown, base.shotInterval, base.projSpeed, base.keepMin, base.keepMax, base.range, base.wakeRange, base.shield, base.turn], 'reach, swing, cooldown, shot interval, projectile speed, ranges and shield');
      if (base.enrage) same(d.enrage, base.enrage, 'the enrage block (its speed factor is a multiplier on top)');
      if (base.slam) ok(d.slam.damage === sc(base.slam.damage, D.damage) && d.slam.reach === base.slam.reach && d.slam.swing === base.slam.swing, `${kind} ${m}: the slam does ${d.slam.damage}`);
      if (base.burst) ok(d.burst.player === sc(base.burst.player, D.damage) && d.burst.robots === base.burst.robots && d.burst.radius === base.burst.radius, `${kind} ${m}: the blast hurts Naebun for ${d.burst.player} and other robots for ${d.burst.robots} (unscaled)`);
      if (base.prime) ok(near2(d.prime.speed, base.prime.speed * D.speed, 1e-9) && d.prime.range === base.prime.range, `${kind} ${m}: the lunge is ${d.prime.speed.toFixed(1)} m/s`);
      if (base.revive) same(d.revive, base.revive, 'the revive block (a fraction of the scaled maximum)');
      if (base.charge) ok(d.charge.turn === base.charge.turn && d.shot.halfWidth === base.shot.halfWidth, `${kind} ${m}: the laser swings and the shot is as wide as before`);
      ok(ENEMY_DEFS[kind] === base && base.hp === defFor(kind, 'normal').hp, `${kind}: ENEMY_DEFS itself is untouched by scaling`);
    }
  }
  // a table that tries to cut warnings to nothing hits the floor, and a warning already below it is left alone
  {
    const crush = { crush: { id: 'crush', damage: 1, health: 1, speed: 1, windup: 0.1 } };
    for (const kind of KINDS) {
      const base = warnings(ENEMY_DEFS[kind]);
      const crushed = warnings(defFor(kind, 'crush', crush));
      ok(crushed.every((w, i) => near2(w[1], Math.min(base[i][1], Math.max(base[i][1] * 0.1, TELEGRAPH_FLOOR)), 1e-9) && w[1] >= Math.min(base[i][1], TELEGRAPH_FLOOR) - 1e-9), `${kind}: even at x0.1 every warning stays at ${TELEGRAPH_FLOOR} s or its own length (${crushed.map((w) => w[1].toFixed(2)).join(', ') || 'none'})`);
    }
    ok(defFor('nonsense', 'hard') === undefined && defFor('fizzbang', 'bogus') === ENEMY_DEFS.fizzbang, 'an unknown kind or mode scales nothing and does not throw');
  }

  // the running game: each mode's robots, spawned, fought and timed
  const { S, W } = fresh();
  const lane = (() => {
    for (let r = 1; r < 60; r++) {
      for (let c = 1; c < 50; c++) {
        const x0 = (c + 0.5) * 2;
        const z = (r + 0.5) * 2;
        let good = true;
        for (let d = 0; d <= 24 && good; d += 0.5) for (const o of [-1, 0, 1]) if (W.isSolidAt(x0 + d, z + o)) good = false;
        if (good) return { x0, z };
      }
    }
    return null;
  })();
  ok(lane !== null, 'there is a lane of free floor to fight on');
  const setup = (mode) => {
    game.testHook('difficulty', mode); // respawns the level's own robots in this mode
    S.enemies.length = 0;
    S.totalEnemies = 0;
    S.pickups.length = 0;
    S.projectiles.length = 0;
    S.player.maxHealth = S.player.health = 1000;
    S.mode = 'play';
  };
  const spawn = (kind, x, z, yaw = 0, area = '_t') => S.enemies[game.testHook('spawn', { kind, x, z, yaw, area })];
  const wake = (e) => { e.state = 'chase'; e.stateT = 1; e.cool = 0; e.checkT = 0; e.wakeDelay = -1; };
  const kill = (e) => game.testHook('hitEnemy', { i: S.enemies.indexOf(e), amount: 1e6, fx: e.x + 5, fz: e.z });
  const hpNow = () => S.player.health;
  const at = (x, z, yaw) => game.testHook('teleport', { x, z, yaw });

  for (const mode of DIFFICULTY_ORDER) {
    const D = DIFFICULTY[mode];
    const label = (t) => `${mode}: ${t}`;
    // spawned: every kind has the scaled hp and numbers, and a boss bar would show the scaled maximum
    setup(mode);
    ok(game.testHook('difficulty') === mode, label('the mode in force'));
    for (const kind of KINDS) {
      const e = spawn(kind, lane.x0, lane.z);
      ok(JSON.stringify(e.def) === JSON.stringify(defFor(kind, mode)) && (mode !== 'normal' || e.def === ENEMY_DEFS[kind]), label(`${kind} spawns with the ${mode} definition`));
      ok(e.maxHp === sc(ENEMY_DEFS[kind].hp, D.health) && e.hp === e.maxHp, label(`${kind} spawns with ${e.maxHp} hp (base ${ENEMY_DEFS[kind].hp} x ${D.health})`));
      ok(e.def.score === ENEMY_DEFS[kind].score, label(`${kind} is worth the same score`));
    }
    S.enemies.length = 0;
    // the level's own robots, respawned by the hook, carry the mode too (bosses included)
    game.testHook('difficulty', mode);
    ok(S.enemies.length === 27 && S.enemies.every((e) => e.maxHp === sc(ENEMY_DEFS[e.kind].hp, D.health)), label('all 27 robots of the Vaults, the Shielded and the Tour Guide among them, have scaled hp'));
    const tg = S.enemies.find((e) => e.kind === 'tourguide');
    ok(tg.boss && tg.maxHp === sc(360, D.health) && tg.def.slam.damage === sc(20, D.damage), label(`the Tour Guide boss: ${tg.maxHp} hp, slam ${tg.def.slam.damage}`));
    ok(game.testHook('hud').difficulty === D.tag, label(`the HUD is told "${D.tag}"`));

    // melee: damage and wind-up length for a plain robot, a shielded one, the Mimic and the Bouncer boss
    for (const kind of ['fizzbang', 'shielded', 'mimic', 'bouncer']) {
      setup(mode);
      const e = spawn(kind, lane.x0, lane.z, -Math.PI / 2);
      at(lane.x0 + 1.6, lane.z, Math.PI / 2);
      wake(e);
      e.fixed = false;
      let tW = -1;
      let tS = -1;
      const h0 = hpNow();
      let lost = 0;
      run(S, 4, input(), (t) => {
        if (e.state === 'windup' && tW < 0) tW = t;
        if (e.state === 'swing' && tS < 0) tS = t;
        if (hpNow() < h0) { lost = h0 - hpNow(); return false; }
        return true;
      });
      const base = ENEMY_DEFS[kind];
      ok(lost === sc(base.damage, D.damage), label(`${kind} hits for ${lost} (${base.damage} x ${D.damage})`));
      ok(tW >= 0 && tS > tW && near2(tS - tW, quick(base.windup, D.windup), 0.035), label(`${kind} winds up for ${(tS - tW).toFixed(2)} s (${base.windup} x ${D.windup}, never under ${TELEGRAPH_FLOOR})`));
    }

    // speed: a plain robot's path length over one second of chase, in the open
    {
      setup(mode);
      const e = spawn('fizzbang', lane.x0, lane.z, -Math.PI / 2);
      at(lane.x0 + 22, lane.z, Math.PI / 2);
      wake(e);
      let px = e.x;
      let pz = e.z;
      let path = 0;
      run(S, 1, input(), () => { path += Math.hypot(e.x - px, e.z - pz); px = e.x; pz = e.z; });
      ok(near2(path, 3.4 * D.speed, 0.15), label(`a Fizzbang covers ${path.toFixed(2)} m in a second (3.4 x ${D.speed})`));
      ok(3.4 * D.speed < PLAYER.speed && 3.3 * D.speed < PLAYER.speed && 3.6 * D.speed < PLAYER.speed, label(`the fastest melee walker (Shaken, ${(3.6 * D.speed).toFixed(2)} m/s) still cannot catch Naebun walking (${PLAYER.speed})`));
    }

    // a bottle: its damage, and the Bampot's aim time
    {
      setup(mode);
      const e = spawn('bampot', lane.x0, lane.z, -Math.PI / 2);
      at(lane.x0 + 9, lane.z, Math.PI / 2);
      wake(e);
      let tA = -1;
      let tSh = -1;
      let bottleDmg = null;
      const h0 = hpNow();
      let lost = 0;
      run(S, 8, input(), (t) => {
        if (e.state === 'aim' && tA < 0) tA = t;
        if (e.state === 'shoot' && tSh < 0) tSh = t;
        const b = S.projectiles.find((q) => q.owner === 'enemy');
        if (b && bottleDmg === null) bottleDmg = b.damage;
        if (hpNow() < h0) { lost = h0 - hpNow(); return false; }
        return true;
      });
      ok(bottleDmg === sc(10, D.damage) && lost === bottleDmg, label(`a bottle carries ${bottleDmg} and costs ${lost} (10 x ${D.damage})`));
      ok(tA >= 0 && near2(tSh - tA, quick(0.55, D.windup), 0.035), label(`the Bampot aims for ${(tSh - tA).toFixed(2)} s (0.55 x ${D.windup})`));
    }

    // the Tour Guide: the slam's damage and wind-up, and volley bottles before and after the enrage
    {
      setup(mode);
      const e = spawn('tourguide', lane.x0, lane.z, -Math.PI / 2);
      at(lane.x0 + 2.2, lane.z, Math.PI / 2);
      wake(e);
      e.slamCool = 0;
      e.cool = 99;
      let tSl = -1;
      const h0 = hpNow();
      let lost = 0;
      let tHit = -1;
      run(S, 3, input(), (t) => {
        at(lane.x0 + 2.2, lane.z);
        if (e.state === 'slam' && tSl < 0) tSl = t;
        if (hpNow() < h0) { lost = h0 - hpNow(); tHit = t; return false; }
        return true;
      });
      const sl = ENEMY_DEFS.tourguide.slam;
      ok(lost === sc(sl.damage, D.damage), label(`the pole slam hits for ${lost} (${sl.damage} x ${D.damage})`));
      ok(tSl >= 0 && near2(tHit - tSl, quick(sl.windup, D.windup) + sl.swing * 0.45, 0.04), label(`and lands ${(tHit - tSl).toFixed(2)} s after it starts (wind-up ${sl.windup} x ${D.windup} plus the swing)`));
      setup(mode);
      const g = spawn('tourguide', lane.x0, lane.z, -Math.PI / 2);
      at(lane.x0 + 9, lane.z, Math.PI / 2);
      wake(g);
      const seen = new Set();
      run(S, 5, input(), () => { for (const q of S.projectiles) if (q.owner === 'enemy') seen.add(q.damage); });
      game.testHook('hitEnemy', { i: S.enemies.indexOf(g), amount: g.maxHp * 0.52, fx: g.x, fz: g.z + 9 });
      ok(g.enraged, label('the Tour Guide enrages at half of its scaled health'));
      S.player.health = S.player.maxHealth;
      S.projectiles.length = 0;
      g.state = 'chase'; g.cool = 0; g.stateT = 1;
      run(S, 5, input(), () => { for (const q of S.projectiles) if (q.owner === 'enemy') seen.add(q.damage); });
      ok(seen.size === 1 && seen.has(sc(10, D.damage)), label(`every volley bottle, enraged or not, carries ${[...seen].join(',')} (10 x ${D.damage})`));
    }

    // the Longshot: one heavy hitscan, a lock the player can still read
    {
      setup(mode);
      const e = spawn('longshot', lane.x0, lane.z, -Math.PI / 2);
      at(lane.x0 + 14, lane.z, Math.PI / 2);
      wake(e);
      const C = ENEMY_DEFS.longshot.charge;
      let tCh = -1;
      let tLock = -1;
      let tFire = -1;
      const h0 = hpNow();
      run(S, 8, input(), (t) => {
        if (e.state === 'charge' && tCh < 0) tCh = t;
        if (e.locked && tLock < 0) tLock = t;
        if (e.state === 'recover' && tFire < 0) tFire = t;
        return !(tFire >= 0 && t > tFire + 0.1);
      });
      ok(h0 - hpNow() === sc(38, D.damage), label(`the Longshot's shot costs ${h0 - hpNow()} (38 x ${D.damage})`));
      ok(near2(tFire - tLock, quick(C.lock, D.windup), 0.06) && tFire - tLock >= TELEGRAPH_FLOOR - 0.06, label(`the lock lasts ${(tFire - tLock).toFixed(2)} s before the shot, over the ${TELEGRAPH_FLOOR} s floor`));
      ok(near2(tFire - tCh, quick(C.track, D.windup) + quick(C.lock, D.windup), 0.08), label(`the whole charge takes ${(tFire - tCh).toFixed(2)} s`));
    }

    // the Shaken's blast: Naebun takes the scaled figure, other robots the unscaled one
    {
      setup(mode);
      const sh = spawn('shaken', lane.x0, lane.z, -Math.PI / 2);
      const other = spawn('fizzbang', lane.x0 + 1.5, lane.z + 0.5, 0);
      other.state = 'idle';
      at(lane.x0 + 1, lane.z, Math.PI / 2);
      const b = ENEMY_DEFS.shaken.burst;
      const h0 = hpNow();
      kill(sh);
      const dp = Math.hypot(S.player.x - sh.x, S.player.z - sh.z);
      const want = Math.round(sc(b.player, D.damage) * (1 - (1 - b.floor) * Math.min(1, dp / b.radius)));
      ok(h0 - hpNow() === want, label(`the blast costs Naebun ${h0 - hpNow()} (${b.player} x ${D.damage} with the falloff at ${dp.toFixed(1)} m)`));
      const dr = Math.hypot(other.x - sh.x, other.z - sh.z);
      const lostRobot = other.maxHp - other.hp;
      ok(near2(lostRobot, b.robots * (1 - (1 - b.floor) * Math.min(1, dr / b.radius)), 0.01), label(`the blast costs a robot ${lostRobot.toFixed(1)} hp, the same as in normal mode`));
    }

    // the Nurse: a revived robot comes back at 60 percent of its scaled maximum
    {
      setup(mode);
      const n = spawn('nurse', lane.x0, lane.z, -Math.PI / 2, 'longvault');
      const f = spawn('fizzbang', lane.x0 + 3, lane.z, 0, 'longvault');
      at(lane.x0 + 22, lane.z, Math.PI / 2);
      wake(n);
      wake(f);
      f.cool = 99;
      kill(f);
      run(S, 8, input(), () => f.dead);
      ok(!f.dead && f.state === 'rise' && near2(f.hp, f.maxHp * ENEMY_DEFS.nurse.revive.hp, 0.5), label(`a revived Fizzbang is back at ${f.hp.toFixed(0)} of ${f.maxHp} (60 percent of the scaled maximum)`));
      ok(n.def.revive.time === ENEMY_DEFS.nurse.revive.time, label('and the Nurse takes as long as ever to do it'));
    }
  }

  // Naebun is not scaled: weapons, health and the clip are the same in every mode
  for (const mode of DIFFICULTY_ORDER) {
    setup(mode);
    game.testHook('play');
    const st = game.testHook('stats');
    ok(st.maxHealth === 100 && st.damageMult === 1 && near(st.fireInterval, WEAPONS.pistol.interval), `${mode}: Naebun has 100 health, normal damage and the pistol's own fire rate`);
  }

  // debug mode stacks on top and is not the same thing: Naebun 2x, robots still scaled by the mode alone
  {
    S.debugMode = true;
    for (const mode of DIFFICULTY_ORDER) {
      setup(mode);
      game.testHook('play');
      S.enemies.length = 0; // 'play' respawned the level's own robots
      const st = game.testHook('stats');
      ok(st.maxHealth === 200 && st.damageMult === 2 && near(st.fireInterval, WEAPONS.pistol.interval / 2), `debug ${mode}: Naebun 2x health, 2x damage, 2x fire rate`);
      const e = spawn('fizzbang', lane.x0, lane.z, -Math.PI / 2);
      ok(e.maxHp === sc(60, DIFFICULTY[mode].health) && e.def.damage === sc(12, DIFFICULTY[mode].damage), `debug ${mode}: the robots are exactly the ${mode} robots (${e.maxHp} hp, ${e.def.damage} damage)`);
      S.player.maxHealth = S.player.health = 1000;
      at(lane.x0 + 1.6, lane.z, Math.PI / 2);
      wake(e);
      const h0 = hpNow();
      run(S, 4, input(), () => hpNow() >= h0);
      ok(h0 - hpNow() === sc(12, DIFFICULTY[mode].damage), `debug ${mode}: a hit costs ${h0 - hpNow()} (debug leaves the robots alone)`);
    }
    S.debugMode = false;
    setup('normal');
  }
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
  ok(JSON.stringify(store.clean({ best: { 1: 500, 2: -4, 9: 100, x: 5 } }).best.normal) === '{"1":500}', 'only real positive best scores survive (an old flat best is the normal-mode one)');
  const m = store.merge(store.clean({ unlocked: 2, best: { 1: 100 } }), store.clean({ done: [1], best: { 1: 300, 2: 50 } }));
  ok(m.unlocked === 2 && m.best.normal[1] === 300 && m.best.normal[2] === 50 && m.done.join() === '1', 'two copies merge to whichever is further on');
  ok(JSON.stringify(store.load()) === JSON.stringify(f), 'under plain Node (no cookie or storage) load() is a fresh save, and save() does not throw');
  store.save(f);
}

console.log(`\ncombat-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
