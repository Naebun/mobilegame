// Headless check of the power-up drinks: walking onto one starts the drinking animation, hands are full while it
// plays, the effect lands near the end, timed effects behave and expire, and a Wee Dram is kept when health is full.
import * as game from '../../src/game3d.js';
import { DRINKS, DRINK_ORDER } from '../../src/data.js';

const VIEW = { w: 390, h: 844, dpr: 1, safe: { top: 0, bottom: 0 } };
const DT = 1 / 60;
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failed++; };

function fresh() {
  Math.random = (() => { let a = 7; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
  game.init(VIEW);
  game.testHook('play');
  return { S: game.getState(), W: game.getWorld(), input: { touches: new Map(), pressed: [], keys: new Set() } };
}
const step = (input, n = 1) => { for (let i = 0; i < n; i++) { game.update(DT, input, VIEW); input.pressed.length = 0; } };
const stats = () => game.testHook('stats');

{
  const { S, input } = fresh();
  const drinks = S.pickups.filter((p) => p.def.kind === 'drink');
  ok(drinks.length >= 1, `the level has drink pickups (${drinks.length})`);
  ok(S.pickups.every((p) => p.def.kind === 'drink' || p.def.kind === 'weapon'), 'every pickup is a weapon or a drink (no medkits)');
  ok(drinks.every((p) => DRINK_ORDER.includes(p.def.item)), 'every drink pickup is one of the four known drinks');
}

// heal: a Wee Dram heals near the end of its animation, and is not wasted at full health
{
  const { S, input } = fresh();
  game.testHook('hurt', 60);
  const before = S.player.health;
  game.testHook('drink', 'dram');
  ok(stats().drinking === 'dram', 'starting a drink marks the player as drinking');
  step(input, 20);
  ok(S.player.health === before, 'the heal has not landed early');
  step(input, Math.ceil((DRINKS.dram.duration + 0.2) * 60));
  ok(S.player.health === Math.min(S.player.maxHealth, before + 35), `a Wee Dram heals 35 (${before} -> ${S.player.health})`);
  ok(stats().drinking === null, 'the animation ends');
}
{
  const { S, W, input } = fresh();
  const pk = S.pickups.find((p) => p.def.kind === 'drink' && p.def.item === 'dram');
  if (pk) {
    game.testHook('teleport', { x: pk.def.x, z: pk.def.z });
    step(input, 5);
    ok(!pk.taken && stats().drinking === null, 'a Wee Dram is left alone at full health');
    game.testHook('hurt', 40);
    step(input, 5);
    ok(pk.taken && stats().drinking === 'dram', 'walking onto it when hurt picks it up and starts the animation');
  } else ok(true, 'no dram pickup in this level (skipped)');
}

// hands are full while drinking
{
  const { S, input } = fresh();
  game.testHook('drink', 'heavy');
  input.keys.add(' ');
  const shots0 = S.shots;
  step(input, 60);
  ok(S.shots === shots0, 'Freddie cannot fire during the animation');
  step(input, Math.ceil(DRINKS.heavy.duration * 60));
  step(input, 30);
  ok(S.shots > shots0, 'firing works again once the drink is done');
  input.keys.delete(' ');
}

// timed effects
for (const id of ['orange', 'heavy', 'energy']) {
  const { S, input } = fresh();
  const d = DRINKS[id];
  game.testHook('drink', id);
  step(input, Math.ceil((d.duration + 0.1) * 60));
  ok(stats().buffs[d.buff] > d.seconds - 1.5, `${d.name} starts a ${d.seconds}s ${d.buff} effect`);
  step(input, Math.ceil((d.seconds + 1) * 60));
  ok(stats().buffs[d.buff] === 0, `${d.name} wears off`);
}
{
  const { S, input } = fresh();
  const hp = S.player.health;
  game.testHook('hurt', 20);
  const plain = hp - S.player.health;
  S.player.hurtT = 0;
  game.testHook('drink', 'heavy');
  step(input, Math.ceil(2.3 * 60));
  const hp2 = S.player.health;
  game.testHook('hurt', 20);
  const guarded = hp2 - S.player.health;
  ok(guarded === plain / 2, `Pint of Heavy halves damage taken (${plain} -> ${guarded})`);
}
{
  // measure speed itself mid-walk, so walls near the start point cannot skew it
  const speedOf = (S, input) => { input.keys.add('w'); step(input, 30); const v = Math.hypot(S.player.vx, S.player.vz); input.keys.delete('w'); step(input, 40); return v; };
  const { S, input } = fresh();
  const base = speedOf(S, input);
  game.testHook('drink', 'orange');
  step(input, Math.ceil(1.9 * 60));
  const fast = speedOf(S, input);
  ok(Math.abs(fast / base - 1.25) < 0.05, `Bruiser Orange makes Freddie 25 percent faster (${base.toFixed(2)} -> ${fast.toFixed(2)} units/s)`);
}
{
  const a = fresh();
  a.input.keys.add(' ');
  const s0 = a.S.shots;
  step(a.input, 90);
  const base = a.S.shots - s0;
  const b = fresh();
  game.testHook('drink', 'energy');
  step(b.input, Math.ceil(2.0 * 60));
  b.input.keys.add(' ');
  const s1 = b.S.shots;
  step(b.input, 90);
  const rapid = b.S.shots - s1;
  ok(rapid > base, `Bassline Energy raises the fire rate (${base} -> ${rapid} shots in 1.5 s)`);
}
// ---- the super power-up: Last Orders ----
const LASER = DRINKS.lastorders.laser;
const wrap = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
const bossAreaOf = (W) => W.areas.find((a) => a.spawns.some((sp) => sp.kind === 'bouncer'));
const centreOf = (W, a) => {
  const sp = a.spawns[0];
  return { x: sp.x, z: sp.z };
};
// A clear spot on the dance floor with several robots in view, not on top of any robot.
const bestSpot = (W, S) => {
  let best = null;
  for (const e of S.enemies) {
    for (const d of [3.5, 5, 7]) {
      for (let k = 0; k < 8; k++) {
        const x = e.x + Math.cos((k * Math.PI) / 4) * d;
        const z = e.z + Math.sin((k * Math.PI) / 4) * d;
        const a = W.areaAt(x, z);
        if (!a || a.id !== 'dancefloor' || W.isSolidAt(x, z) || S.enemies.some((o) => Math.hypot(o.x - x, o.z - z) < 3)) continue;
        const n = S.enemies.filter((o) => !o.boss && Math.hypot(o.x - x, o.z - z) < LASER.radius && W.los(x, z, o.x, o.z)).length;
        if (!best || n > best.n) best = { x, z, n };
      }
    }
  }
  return best;
};

// Plays the drinking animation, then the spin. Reports where Freddie stood and what he did only during the spin.
const runLaser = (input) => {
  const S = game.getState();
  step(input, Math.ceil((DRINKS.lastorders.duration + 0.1) * 60));
  const started = !!game.testHook('stats').laser;
  const startPos = { x: S.player.x, z: S.player.z };
  const shots = S.shots;
  const health = S.player.health;
  let spun = 0;
  let prev = S.player.yaw;
  let guard = 0;
  while (S.laser && guard++ < 1200) {
    step(input, 1);
    spun += Math.abs(wrap(S.player.yaw - prev));
    prev = S.player.yaw;
  }
  return { started, spun, startPos, endPos: { x: S.player.x, z: S.player.z }, firedDuring: S.shots - shots, healthLost: health - S.player.health };
};

{
  const { S, W, input } = fresh();
  const boss = bossAreaOf(W);
  const spot = bestSpot(W, S);
  game.testHook('teleport', { x: spot.x, z: spot.z });
  const p = S.player;
  const alive0 = S.enemies.filter((e) => !e.dead && !e.boss);
  // robots in other rooms and out of reach must survive; same-room robots may charge into range and be caught
  const far = alive0.filter((e) => e.areaId !== 'dancefloor' && Math.hypot(e.x - p.x, e.z - p.z) >= LASER.radius);
  ok(spot.n >= 3, `the dance floor has several robots in the laser's reach from a clear spot (${spot.n})`);
  game.testHook('drink', 'lastorders');
  input.keys.add('w');
  input.keys.add(' ');
  const res = runLaser(input);
  ok(res.started, 'the spin starts when the drink is finished');
  ok(res.spun > 3.5 * Math.PI, `Freddie spins about two full turns (${(res.spun / (2 * Math.PI)).toFixed(2)} turns)`);
  ok(Math.hypot(res.endPos.x - res.startPos.x, res.endPos.z - res.startPos.z) < 0.05, 'Freddie cannot walk during the spin (walk key held the whole time)');
  ok(res.firedDuring === 0, 'Freddie cannot fire during the spin (fire key held the whole time)');
  ok(res.healthLost === 0, 'Freddie takes no damage during the spin');
  const killed = alive0.filter((e) => e.dead);
  ok(killed.length >= spot.n, `the laser wipes out every robot in reach (${killed.length} killed, ${spot.n} were in view at the start)`);
  ok(killed.every((e) => Math.hypot(e.x - res.startPos.x, e.z - res.startPos.z) <= LASER.radius + 1 && W.los(res.startPos.x, res.startPos.z, e.x, e.z)), 'the laser only kills robots that have a clear line to Freddie, never through walls');
  ok(far.every((e) => !e.dead), `robots in other rooms, out of reach, are untouched (${far.length})`);
  ok(S.enemies.filter((e) => e.boss).every((e) => !e.dead), 'the boss is untouched');
  ok(game.testHook('stats').laser === false, 'the spin ends');
  input.keys.delete('w');
  input.keys.delete(' ');
  step(input, 30);
  const before = { x: p.x, z: p.z };
  input.keys.add('w');
  step(input, 30);
  input.keys.delete('w');
  ok(Math.hypot(p.x - before.x, p.z - before.z) > 0.5, 'control comes back afterwards');
  ok(!!boss, 'the level has a boss room');
}

// untouchable during the spin
{
  const { S, W, input } = fresh();
  const here = bestSpot(W, S);
  game.testHook('teleport', { x: here.x, z: here.z });
  game.testHook('drink', 'lastorders');
  step(input, Math.ceil((DRINKS.lastorders.duration + 0.1) * 60));
  const hp = S.player.health;
  game.testHook('hurt', 50);
  ok(game.testHook('stats').laser && S.player.health === hp, 'nothing can hurt Freddie during the spin');
}

// the boss is never hit, even when it is right there and asleep
{
  const { S, W, input } = fresh();
  const boss = S.enemies.find((e) => e.boss);
  const here = bestSpot(W, S);
  game.testHook('teleport', { x: here.x, z: here.z });
  boss.x = here.x + 4;
  boss.z = here.z;
  ok(!game.testHook('stats').laser && boss.state === 'idle', 'the sleeping boss has been placed in the laser path for the test');
  game.testHook('drink', 'lastorders');
  runLaser(input);
  ok(!boss.dead && boss.hp === boss.maxHp, 'the laser never touches a boss, even one standing in its path');
}

// never in a boss room
{
  const { S, W, input } = fresh();
  const boss = bossAreaOf(W);
  const c = centreOf(W, boss);
  game.testHook('teleport', { x: c.x, z: c.z });
  ok(W.areaAt(S.player.x, S.player.z) === boss, 'the player is standing in the boss room');
  // a super drink on the floor of the boss room must not be picked up
  S.pickups.push({ def: { kind: 'drink', item: 'lastorders', x: c.x, z: c.z }, mesh: { position: { y: 0 }, rotation: { y: 0 }, visible: true }, taken: false, phase: 0 });
  step(input, 10);
  ok(!S.pickups[S.pickups.length - 1].taken && !S.drink, 'a Last Orders drink in a boss room cannot be picked up');
  // and drinking one just outside, then walking in, fizzles
  game.testHook('drink', 'lastorders');
  step(input, Math.ceil((DRINKS.lastorders.duration + 0.1) * 60));
  ok(!game.testHook('stats').laser, 'the laser does not fire in a boss room');
}
{
  const { S, W, input } = fresh();
  const here = bestSpot(W, S);
  game.testHook('teleport', { x: here.x, z: here.z });
  const boss = S.enemies.find((e) => e.boss);
  boss.state = 'chase'; // awake
  game.testHook('drink', 'lastorders');
  step(input, Math.ceil((DRINKS.lastorders.duration + 0.1) * 60));
  ok(!game.testHook('stats').laser, 'the laser is refused while a boss is awake');
}

// level 1 holds the right super drinks, and never in a boss room
{
  const { W } = fresh();
  const supers = W.pickups.filter((p) => p.kind === 'drink' && p.item === 'lastorders');
  ok(supers.every((p) => { const a = W.areaAt(p.x, p.z); return a && !a.spawns.some((sp) => sp.kind === 'bouncer'); }), `no Last Orders pickup lies in a boss room (${supers.length} placed)`);
}

console.log(failed ? `${failed} FAILED` : 'drinks-check: all passed');
process.exit(failed ? 1 : 0);
