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
  const { S, input } = fresh();
  const dist = () => { const x0 = S.player.x; const z0 = S.player.z; input.keys.add('w'); step(input, 60); input.keys.delete('w'); step(input, 30); return Math.hypot(S.player.x - x0, S.player.z - z0); };
  const base = dist();
  game.testHook('drink', 'orange');
  step(input, Math.ceil(1.9 * 60));
  const fast = dist();
  ok(fast > base * 1.1, `Bruiser Orange makes Freddie faster (${base.toFixed(2)} -> ${fast.toFixed(2)} units)`);
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
console.log(failed ? `${failed} FAILED` : 'drinks-check: all passed');
process.exit(failed ? 1 : 0);
