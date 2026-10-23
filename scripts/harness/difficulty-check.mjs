// Headless checks of the difficulty feature outside the combat numbers (those are in combat-check.mjs), in Node:
//   node scripts/harness/difficulty-check.mjs
// The saved format (old saves, per-mode bests, bad data, the cookie's size), the screen flow NEW GAME -> difficulty ->
// controls -> START with presses and keys, CONTINUE resuming in the saved mode, and debug runs writing nothing. A fake cookie
// jar and local storage stand in for the browser, so the real src/save.js and src/game3d.js run unchanged.
// The ?difficulty= and ?level= URL shortcuts are read once at import, so they are checked in a child process of this script.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHILD = process.argv[2] === 'query';
let failures = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) { failures++; console.error(`FAIL: ${msg}`); }
};

// ---- a browser's worth of storage ----
const jar = new Map();
const ls = new Map();
const wrote = { cookie: 0, ls: 0 };
globalThis.window = {}; // audio.unlock() looks for an AudioContext on it and finds none
globalThis.location = { search: process.env.DC_QUERY || '', pathname: '/mobilegame/', protocol: 'http:' };
globalThis.document = {
  get cookie() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); },
  set cookie(s) {
    const [pair, ...attrs] = s.split('; ');
    const i = pair.indexOf('=');
    wrote.cookie++;
    if (attrs.some((a) => a === 'max-age=0')) jar.delete(pair.slice(0, i));
    else jar.set(pair.slice(0, i), pair.slice(i + 1));
  },
  getElementById: () => null,
};
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => { wrote.ls++; ls.set(k, String(v)); },
  removeItem: (k) => { wrote.ls++; ls.delete(k); },
};
const cookieSave = () => {
  const c = jar.get('fls');
  return c ? JSON.parse(decodeURIComponent(c)) : null;
};
const wipe = () => { jar.clear(); ls.clear(); };
const snapshot = () => JSON.stringify([[...jar], [...ls]]);

const store = await import('../../src/save.js');
const { DIFFICULTY, DIFFICULTY_ORDER, ENEMY_DEFS } = await import('../../src/data.js');
const game = await import('../../src/game3d.js');

const VIEW = { w: 390, h: 844, dpr: 1, safe: { top: 0, bottom: 0 } };
const DT = 1 / 60;
const S = game.getState();
const keys = new Set();
const step = (pressed = [], n = 1) => {
  for (let i = 0; i < n; i++) game.update(DT, { touches: new Map(), pressed, keys, mouse: { dx: 0, dy: 0, wheel: 0, down: false, alt: false, locked: false } }, VIEW);
};
const press = (id) => {
  const b = game.testHook('buttons').find((x) => x.id === id);
  if (!b) throw new Error(`no ${id} button in mode ${S.mode} (${game.testHook('buttons').map((x) => x.id).join()})`);
  step([{ x: b.x + b.w / 2, y: b.y + b.h / 2 }]);
};
const tap = (key) => { keys.add(key); step(); keys.delete(key); step(); };
const fresh = () => { wipe(); game.init(VIEW); game.testHook('torch', { attached: true }); };
const hpOf = (kind) => S.enemies.filter((e) => e.kind === kind).map((e) => e.maxHp);

if (CHILD) {
  // ?difficulty=extra&level=2: the shortcuts, as the dev and the smoke test use them
  game.init(VIEW);
  ok(S.difficulty === 'extra' && S.level === 2, 'the URL shortcut starts level 2 in Extra Hard');
  ok(S.enemies.length > 0 && S.enemies.every((e) => e.maxHp === Math.round(ENEMY_DEFS[e.kind].hp * DIFFICULTY.extra.health)), 'and its robots are Extra Hard robots');
  press('new');
  ok(S.mode === 'difficulty' && game.testHook('buttons').find((b) => b.selected).mode === 'extra', 'NEW GAME opens the difficulty page with the shortcut\'s mode highlighted');
  tap('enter');
  ok(S.mode === 'controls' && S.difficulty === 'extra', 'Enter takes the highlighted one');
  press('start');
  ok(S.mode === 'intro' && S.level === 2 && S.difficulty === 'extra' && S.enemies.every((e) => e.maxHp === Math.round(ENEMY_DEFS[e.kind].hp * DIFFICULTY.extra.health)), 'START GAME begins level 2 in Extra Hard');
  ok(cookieSave() && cookieSave().difficulty === 'extra', 'and saves it');
  console.log(`${checks - failures}/${checks} child checks`);
  process.exit(failures ? 1 : 0);
}

// ---- the saved format ----
{
  const v1 = { v: 1, unlocked: 2, done: [1], best: { 1: 1500, 2: 900 }, torch: true, records: ['haar'] };
  const a = store.clean(v1);
  ok(a.v === 2 && a.difficulty === 'normal' && a.unlocked === 2 && a.done.join() === '1' && a.torch === true && a.records.join() === 'haar', 'a version 1 save loads: progress, torch and records intact, mode normal');
  ok(a.best.normal[1] === 1500 && a.best.normal[2] === 900 && !Object.keys(a.best.hard).length && !Object.keys(a.best.extra).length, 'and its scores become the normal-mode bests');
  ok(store.bestOf(a, 'normal', 1) === 1500 && store.bestOf(a, 'hard', 1) === 0 && store.bestOf(a, 'extra', 2) === 0, 'bestOf reads one mode and one level');
  // through a real cookie, and through local storage alone
  wipe();
  jar.set('fls', encodeURIComponent(JSON.stringify(v1)));
  ok(store.load().best.normal[2] === 900 && store.load().difficulty === 'normal', 'an old cookie is read');
  wipe();
  ls.set('mobilegame.save', JSON.stringify(v1));
  ok(store.load().best.normal[1] === 1500, 'an old local-storage copy is read');
  // saving an old save back writes the new format
  wipe();
  store.save(a);
  ok(cookieSave().v === 2 && cookieSave().best.normal[1] === 1500 && cookieSave().difficulty === 'normal', 'saving writes version 2');

  // per mode, per level
  const b = store.fresh();
  store.setBest(b, 'hard', 1, 4000);
  store.setBest(b, 'extra', 2, 12000);
  store.setBest(b, 'normal', 1, 800);
  ok(store.bestOf(b, 'hard', 1) === 4000 && store.bestOf(b, 'normal', 1) === 800 && store.bestOf(b, 'extra', 1) === 0 && store.bestOf(b, 'extra', 2) === 12000, 'bests are kept apart by mode and by level');
  const r = store.clean(JSON.parse(JSON.stringify(b)));
  ok(JSON.stringify(r) === JSON.stringify(b), 'a save survives clean() unchanged');
  store.setBest(b, 'bogus', 1, 5);
  ok(store.bestOf(b, 'bogus', 1) === 5 && store.bestOf(b, 'normal', 1) === 5, 'an unknown mode name never gets a table of its own (it is normal)');

  // mode saved and restored
  wipe();
  store.save({ ...store.fresh(), difficulty: 'extra', unlocked: 2, done: [1] });
  ok(store.load().difficulty === 'extra', 'the chosen mode is saved and restored');
  jar.clear();
  ok(store.load().difficulty === 'extra', 'also from local storage alone');
  const m = store.merge(store.clean({ unlocked: 1, difficulty: 'normal', best: { hard: { 1: 100 } } }), store.clean({ unlocked: 2, done: [1], difficulty: 'hard', best: { hard: { 1: 300, 2: 5 }, extra: { 1: 9 }, 1: 50 } }));
  ok(m.difficulty === 'hard' && m.best.hard[1] === 300 && m.best.hard[2] === 5 && m.best.extra[1] === 9 && m.best.normal[1] === 50, 'two copies merge per mode and per level, and the mode of the copy that is further on wins');

  // bad data
  const junk = store.clean({ v: 9, difficulty: 'impossible', best: { insane: { 1: 5 }, hard: { 1: -3, 2: 'x', 3: 100, 0: 7, 1.5: 8 }, extra: 'nope', normal: [1, 2], 1: 'x', constructor: { 1: 1 }, __proto__: { 1: 3 } }, unlocked: 2 });
  ok(junk.difficulty === 'normal' && junk.v === 2, 'an unknown mode is ignored (normal), and the version is rewritten');
  ok(JSON.stringify(junk.best) === '{"normal":{},"hard":{},"extra":{}}', `bad scores, levels and modes are all dropped (${JSON.stringify(junk.best)})`);
  ok(store.clean({ difficulty: 7 }).difficulty === 'normal' && store.clean({ difficulty: ['hard'] }).difficulty === 'normal' && store.clean({ difficulty: null }).difficulty === 'normal', 'a mode that is not a string is ignored');
  ok(store.clean({ best: [1, 2, 3] }).best.normal[1] === undefined && store.clean({ best: 'x' }).best.hard !== undefined, 'a best that is not an object is ignored');
  ok(JSON.stringify(store.clean({ best: { hard: { 1: 4e12, 2: 12.7 } } }).best.hard) === '{"2":12}', 'scores are whole numbers under a trillion');
  ok(JSON.stringify(store.clean('{"difficulty":"hard"}')) === JSON.stringify(store.fresh()), 'a string is not a save');
  for (const raw of ['{', '{"difficulty":"hard"', 'null', '[]', '"hard"']) {
    wipe();
    jar.set('fls', encodeURIComponent(raw));
    ls.set('mobilegame.save', raw);
    ok(JSON.stringify(store.load()) === JSON.stringify(store.fresh()), `a corrupt cookie (${raw}) loads as a fresh save`);
  }

  // the cookie stays small: everything filled in, the biggest scores, all ten records
  wipe();
  const big = store.fresh();
  big.unlocked = 2; big.done = [1, 2]; big.torch = true; big.difficulty = 'extra';
  big.records = ['haar', 'bypass', 'gala', 'pipes', 'wee', 'supper', 'tram', 'hold', 'foot', 'refund'];
  for (const m2 of DIFFICULTY_ORDER) for (const lv of [1, 2]) store.setBest(big, m2, lv, 999999);
  store.save(big);
  ok(jar.get('fls').length < 900, `a full cookie is ${jar.get('fls').length} characters (a browser allows 4096)`);
  store.save(store.fresh());
  ok(jar.get('fls').length < 200 && !('hard' in cookieSave().best), `a fresh save leaves the empty modes out (${jar.get('fls').length} characters)`);

  // RESET PROGRESS
  store.save(big);
  store.reset();
  ok(!jar.has('fls') && !ls.has('mobilegame.save') && JSON.stringify(store.load()) === JSON.stringify(store.fresh()), 'reset erases the lot');
}

// ---- the older localStorage-only bests still migrate, as normal-mode scores ----
{
  wipe();
  ls.set('mobilegame.fps.best', '777');
  ls.set('mobilegame.fps.best.2', '55');
  game.init(VIEW);
  ok(S.save.best.normal[1] === 777 && S.save.best.normal[2] === 55 && !Object.keys(S.save.best.hard).length, 'the old mobilegame.fps.best keys become the normal-mode bests');
  ok(S.best === 777 && S.difficulty === 'normal', 'and the title shows the one for the level it starts on');
}

// ---- the flow: NEW GAME, difficulty, controls, START ----
{
  fresh();
  ok(S.mode === 'title' && S.difficulty === 'normal', 'a fresh game starts on the title in normal mode');
  ok(game.testHook('buttons').map((b) => b.id).join() === 'new,settings,debug', 'the title buttons are as they were');
  press('new');
  ok(S.mode === 'difficulty', 'NEW GAME opens the difficulty page first');
  ok(game.testHook('buttons').map((b) => b.id).join() === 'mode:normal,mode:hard,mode:extra,back', 'three choices and BACK');
  press('back');
  ok(S.mode === 'title', 'BACK returns to the title');
  press('new');
  press('mode:hard');
  ok(S.mode === 'controls' && S.difficulty === 'hard', 'tapping HARD picks it and goes on to the controls page');
  ok(game.testHook('buttons').map((b) => b.id).join() === 'start,back', 'the controls page has START GAME and BACK');
  press('back');
  ok(S.mode === 'difficulty' && S.difficulty === 'hard', 'BACK on the controls page returns to the difficulty page, the pick kept');
  ok(game.testHook('buttons').find((b) => b.selected).mode === 'hard', 'with HARD highlighted');
  press('back');
  ok(S.mode === 'title' && S.difficulty === 'normal', 'BACK to the title drops a pick that was never started');
  ok(!cookieSave() || cookieSave().difficulty === 'normal', 'nothing was saved by browsing');
  press('new');
  press('mode:hard');
  step([], 30);
  ok(S.mode === 'controls', 'the game does not start until START GAME is pressed');
  ok(!cookieSave() || cookieSave().difficulty === 'normal', 'and the mode is not saved before it');
  press('start');
  ok(S.mode === 'intro' && S.difficulty === 'hard', 'START GAME begins the run');
  ok(cookieSave().difficulty === 'hard', 'the choice is in the cookie');
  ok(JSON.parse(ls.get('mobilegame.save')).difficulty === 'hard', 'and in local storage');
  ok(S.enemies.length === 19 && hpOf('fizzbang').every((h) => h === Math.round(60 * DIFFICULTY.hard.health)) && hpOf('bouncer')[0] === Math.round(450 * DIFFICULTY.hard.health), `level 1 robots are Hard robots (fizzbang ${hpOf('fizzbang')[0]} hp, the Bouncer ${hpOf('bouncer')[0]})`);
  step([], 60 * 4);
  ok(S.mode === 'play', 'the intro ends in play');

  // death writes the Hard best, and only the Hard best
  S.score = 700;
  game.testHook('hurt', 1e6);
  ok(S.mode === 'dead' && S.newBest && S.best === 700, 'dying with a score on Hard is a new best');
  ok(cookieSave().best.hard[1] === 700 && !cookieSave().best.normal, 'it is saved under hard, not normal');
  step([], 70);
  ok(game.testHook('buttons').map((b) => b.id).join() === 'retry,menu', 'RETRY and MAIN MENU are offered');
  press('retry');
  ok(S.mode === 'play' && S.difficulty === 'hard' && hpOf('fizzbang').every((h) => h === Math.round(60 * DIFFICULTY.hard.health)), 'RETRY stays in the same mode with fresh Hard robots');
  game.testHook('hurt', 1e6);
  step([], 70);
  press('menu');
  ok(S.mode === 'title' && S.difficulty === 'hard', 'MAIN MENU: the title, still showing the saved mode');

  // finishing level 1 on Hard offers CONTINUE in Hard
  game.testHook('save', { done: [1], unlocked: 2 });
  const tb = game.testHook('buttons');
  ok(tb[0].id === 'resume' && tb[0].label === 'CONTINUE: LEVEL 2 (HARD)', `the title offers ${tb[0].label}`);
  fresh();
  game.testHook('save', { done: [1], unlocked: 2, difficulty: 'extra' });
  game.init(VIEW); // a reload: everything comes back from the cookie
  ok(S.difficulty === 'extra' && game.testHook('buttons')[0].label === 'CONTINUE: LEVEL 2 (EXTRA HARD)', 'after a reload the title offers CONTINUE in the saved mode');
  press('resume');
  ok(S.mode === 'voicemail' && S.difficulty === 'extra' && S.level === 2, 'CONTINUE resumes level 2 in Extra Hard');
  ok(S.enemies.length === 24 && S.enemies.every((e) => e.maxHp === Math.round(ENEMY_DEFS[e.kind].hp * DIFFICULTY.extra.health)), 'with Extra Hard robots');
  ok(S.best === 0, 'and the best shown is the Extra Hard one for that level');
  // a different mode on NEW GAME afterwards: the new run's mode is saved
  S.mode = 'title';
  press('new');
  ok(game.testHook('buttons').find((b) => b.selected).mode === 'extra', 'NEW GAME highlights the last mode used');
  press('mode:normal');
  press('start');
  ok(S.difficulty === 'normal' && cookieSave().difficulty === 'normal' && S.level === 1 && hpOf('fizzbang').every((h) => h === 60), 'picking NORMAL starts level 1 with the normal robots and saves normal');
}

// ---- bests are kept per mode ----
{
  fresh();
  game.testHook('difficulty', 'hard');
  game.testHook('play');
  S.score = 900;
  game.testHook('hurt', 1e6);
  game.testHook('difficulty', 'normal');
  game.testHook('play');
  S.score = 400;
  game.testHook('hurt', 1e6);
  game.testHook('difficulty', 'extra');
  game.testHook('play');
  S.score = 1500;
  game.testHook('hurt', 1e6);
  const c = cookieSave();
  ok(c.best.hard[1] === 900 && c.best.normal[1] === 400 && c.best.extra[1] === 1500, `three modes, three bests, kept apart (${JSON.stringify(c.best)})`);
  game.testHook('difficulty', 'normal');
  game.testHook('play');
  S.score = 300;
  game.testHook('hurt', 1e6);
  ok(!S.newBest && S.best === 400 && cookieSave().best.normal[1] === 400, 'a lower score in a mode does not replace its best');
  game.testHook('difficulty', 'hard');
  ok(S.best === 900, 'switching mode shows that mode\'s best');
  game.testHook('screen', 'complete'); // resetLevel zeroes the score, then completeLevel adds the time bonus
  ok(cookieSave().best.hard[1] >= 900 && cookieSave().best.hard[1] === S.best, 'finishing a level writes the mode\'s best too');
  ok(cookieSave().best.extra[1] === 1500 && cookieSave().best.normal[1] === 400, 'and leaves the others alone');
}

// ---- keyboard on the difficulty page ----
{
  fresh();
  press('new');
  tap('1');
  ok(S.mode === 'controls' && S.difficulty === 'normal', '1 picks NORMAL and goes on');
  press('back');
  tap('2');
  ok(S.mode === 'controls' && S.difficulty === 'hard', '2 picks HARD');
  press('back');
  tap('3');
  ok(S.mode === 'controls' && S.difficulty === 'extra', '3 picks EXTRA HARD');
  press('back');
  ok(S.mode === 'difficulty', 'back on the page');
  tap('arrowup');
  ok(S.difficulty === 'hard' && S.mode === 'difficulty' && game.testHook('buttons').find((b) => b.selected).mode === 'hard', 'Up moves the highlight');
  tap('arrowup');
  tap('arrowup');
  ok(S.difficulty === 'normal', 'Up stops at the first');
  keys.add('arrowdown');
  step(); step(); step(); // held for three frames: one move
  keys.delete('arrowdown');
  step();
  ok(S.difficulty === 'hard', 'a held key is one press');
  tap('arrowdown');
  tap('arrowdown');
  ok(S.difficulty === 'extra', 'Down stops at the last one');
  tap('enter');
  ok(S.mode === 'controls' && S.difficulty === 'extra', 'Enter takes the highlighted choice');
  press('back');
  tap('escape');
  ok(S.mode === 'title' && S.difficulty === 'normal', 'Escape goes back to the title and drops the pick');
  press('new');
  keys.add('2');
  step();
  ok(S.mode === 'controls' && S.difficulty === 'hard', 'a key picks while it is held down');
  press('back'); // the key is still down
  step([], 3);
  ok(S.mode === 'difficulty', 'a key still held from the previous page is not a new press');
  keys.clear();
  step();
  keys.add('5'); keys.add('a'); keys.add('w');
  step([], 3);
  ok(S.mode === 'difficulty', 'other keys do nothing');
  keys.clear();
  step();
  tap('2');
  tap('1');
  tap('enter');
  tap('escape');
  ok(S.mode === 'controls' && S.difficulty === 'hard', 'the controls page does not take those keys');
}

// ---- debug runs write nothing ----
{
  fresh();
  game.testHook('save', { difficulty: 'normal', done: [1], unlocked: 2, best: { normal: { 1: 250 } } });
  const before = snapshot();
  const w0 = { ...wrote };
  S.debugMode = true;
  press('new');
  press('mode:extra');
  press('start');
  ok(S.difficulty === 'extra' && S.mode === 'intro', 'a debug run can pick Extra Hard');
  ok(hpOf('fizzbang').every((h) => h === Math.round(60 * DIFFICULTY.extra.health)) && S.player.maxHealth === 200, 'with Extra Hard robots, and Naebun on 2x health');
  ok(snapshot() === before && wrote.cookie === w0.cookie && wrote.ls === w0.ls, 'starting it wrote neither the cookie nor local storage');
  step([], 60 * 5);
  S.score = 99999;
  game.testHook('hurt', 1e6);
  ok(S.mode === 'dead' && !S.newBest && snapshot() === before, 'dying in a debug run records no best');
  game.testHook('screen', 'complete');
  ok(S.mode === 'complete' && snapshot() === before, 'completing a debug run records no best and no progress');
  step([], 70);
  press('menu');
  ok(S.mode === 'title' && S.difficulty === 'normal', 'back on the title the debug run\'s mode is forgotten (the saved one shows)');
}

// ---- ?difficulty= and ?level=, read at import: a child process ----
{
  try {
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), 'query'], { env: { ...process.env, DC_QUERY: '?level=2&difficulty=extra' }, stdio: 'inherit' });
    ok(true, '?level=2&difficulty=extra: the shortcuts work (child checks above)');
  } catch {
    ok(false, '?level=2&difficulty=extra: the shortcuts work');
  }
}

console.log(`\ndifficulty-check: ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
