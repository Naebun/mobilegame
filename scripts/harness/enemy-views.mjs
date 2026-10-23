// Screenshots the four prepared enemies in the real game (full render pipeline, HUD, torch), added with testHook('spawn'):
//   OUT=<dir> [ONLY=name,name] [W=390 H=844] [Q=medium] node scripts/harness/enemy-views.mjs
// Each scene teleports Naebun to a straight stretch of floor, spawns what it needs, puts it in a state and HOLDS it there
// (an interval keeps the state's timer where it is) so the frame is the same every run. Level 2 is dark; some scenes run on
// level 1 (lit). None of this is used by any level.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';

const OUT = process.env.OUT;
if (!OUT) { console.error('set OUT=<directory for the screenshots>'); process.exit(2); }
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const server = spawn('node', ['scripts/serve.mjs', String(process.env.PORT || 8095)], { stdio: 'ignore', cwd: process.cwd() });
await new Promise((r) => setTimeout(r, 700));
const base = '/opt/pw-browsers';
const exe = readdirSync(base).filter((d) => d.startsWith('chromium-')).map((d) => readdirSync(`${base}/${d}`).filter((x) => x.startsWith('chrome-linux')).map((x) => `${base}/${d}/${x}/chrome`)[0])[0];
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await b.newContext({ viewport: { width: Number(process.env.W || 390), height: Number(process.env.H || 844) }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errs.push(m.text()));
await page.goto(`http://localhost:${process.env.PORT || 8095}/?test&q=${process.env.Q || 'medium'}`);
await page.waitForFunction(() => window.__game && window.__game.getState().player, null, { timeout: 90000 });

// helpers that live in the page
await page.evaluate(() => {
  const g = window.__game;
  window.H = {
    g,
    S: () => g.getState(),
    // a straight east-west stretch of free floor, `len` long, 1 m clear either side
    lane(len) {
      const W = g.getWorld();
      for (let r = 1; r < 60; r++) for (let c = 1; c < 50; c++) {
        const x0 = (c + 0.5) * 2; const z = (r + 0.5) * 2;
        let good = true;
        for (let d = 0; d <= len && good; d += 0.5) for (const o of [-1, 0, 1]) if (W.isSolidAt(x0 + d, z + o)) good = false;
        if (good) return { x0, z };
      }
      return null;
    },
    reset(level) {
      g.testHook('level', level);
      const S = g.getState();
      S.enemies.forEach((e) => { e.robot.group.visible = false; });
      S.enemies.length = 0;
      S.totalEnemies = 0;
      S.pickups.forEach((p) => { p.mesh.visible = false; });
      S.pickups.length = 0;
      g.testHook('torch', { attached: true, on: true });
      g.testHook('giveWeapons');
      S.player.health = S.player.maxHealth = 1e6;
      S.banner = null;
      S.toast = null;
      if (window.__hold) clearInterval(window.__hold);
      window.__holds = [];
      window.__holds.push(() => { S.banner = null; S.toast = null; });
      window.__hold = setInterval(() => window.__holds.forEach((f) => f()), 8);
    },
    spawn(kind, x, z, yaw) {
      const i = g.testHook('spawn', { kind, x, z, yaw, area: '_view' });
      const e = g.getState().enemies[i];
      e.state = 'chase';
      e.stateT = 1;
      e.cool = 99;
      e.wakeDelay = -1;
      return e;
    },
    look(x, z, yaw, pitch = 0) {
      g.testHook('teleport', { x, z, yaw });
      g.getState().player.pitch = pitch;
    },
    hold(f) { window.__holds.push(f); },
    clone: (o) => JSON.parse(JSON.stringify(o)),
  };
});

// yaw: faces -z at 0; forward = (-sin yaw, -cos yaw). Facing west (towards -x) is yaw pi/2, east is -pi/2.
const WEST = 'Math.PI / 2';
// Frames are slow in software WebGL, so the game takes many 1/60 s steps between two frames and a timer cannot hold a state
// still. These scenes give the robot a private copy of its definition with a very long timer instead (`slow`).
const scenes = [
  // Fizzbang Shaken
  ['sk-rattle-far', 2, `const L = H.lane(20); const e = H.spawn('shaken', L.x0, L.z, -Math.PI / 2); e.speedMult = 0.00001; H.look(L.x0 + 11, L.z, ${WEST});`],
  ['sk-rattle-near', 2, `const L = H.lane(20); const e = H.spawn('shaken', L.x0, L.z, -Math.PI / 2); e.speedMult = 0.00001; H.look(L.x0 + 4.2, L.z, ${WEST});`],
  ['sk-prime', 2, `const L = H.lane(20); const e = H.spawn('shaken', L.x0, L.z, -Math.PI / 2); H.look(L.x0 + 4.5, L.z, ${WEST});
    Object.assign(e, { state: 'prime', chained: true, fuseMax: 1e6, fuse: 0.42e6, primeT: 1 });`],
  ['sk-prime-lit', 1, `const L = H.lane(20); const e = H.spawn('shaken', L.x0, L.z, -Math.PI / 2); H.look(L.x0 + 4.5, L.z, ${WEST});
    Object.assign(e, { state: 'prime', chained: true, fuseMax: 1e6, fuse: 0.42e6, primeT: 1 });`],
  ['sk-chain', 2, `const L = H.lane(20); const a = H.spawn('shaken', L.x0, L.z - 0.8, -Math.PI / 2); const b = H.spawn('shaken', L.x0 + 2.2, L.z + 0.6, -Math.PI / 2); const c = H.spawn('shaken', L.x0 + 4.4, L.z - 0.4, -Math.PI / 2);
    for (const e of [a, b, c]) e.speedMult = 0.00001; H.look(L.x0 + 11, L.z, ${WEST});
    Object.assign(b, { state: 'prime', chained: true, fuseMax: 1e6, fuse: 0.5e6, primeT: 1 });
    Object.assign(c, { state: 'prime', chained: true, fuseMax: 1e6, fuse: 0.2e6, primeT: 1 });`],
  ['sk-dead', 2, `const L = H.lane(20); const e = H.spawn('shaken', L.x0, L.z, -Math.PI / 2); H.look(L.x0 + 7, L.z, ${WEST});
    H.g.testHook('hitEnemy', { i: 0, amount: 100, fx: e.x + 5, fz: e.z });`],
  // Bampot Longshot
  ['ls-track-front', 2, `const L = H.lane(22); const e = H.spawn('longshot', L.x0, L.z, -Math.PI / 2); e.speedMult = 0.00001; H.look(L.x0 + 14, L.z, ${WEST});
    e.def = H.clone(e.def); e.def.charge.track = 999; Object.assign(e, { state: 'charge', stateT: 0.7, locked: false });`],
  ['ls-lock-front', 2, `const L = H.lane(22); const e = H.spawn('longshot', L.x0, L.z, -Math.PI / 2); e.speedMult = 0.00001; H.look(L.x0 + 14, L.z, ${WEST});
    e.def = H.clone(e.def); e.def.charge.track = 0.6; e.def.charge.lock = 999; Object.assign(e, { state: 'charge', stateT: 1.4 });`],
  ['ls-track-side', 2, `const L = H.lane(22); const e = H.spawn('longshot', L.x0, L.z, -Math.PI / 2); e.speedMult = 0.00001; H.look(L.x0 + 7, L.z + 0.9, ${WEST});
    e.def = H.clone(e.def); e.def.charge.track = 999; e.def.charge.turn = 0; Object.assign(e, { state: 'charge', stateT: 0.5, locked: false, yaw: -Math.PI / 2, aimPitch: 0 });`],
  ['ls-lock-side', 2, `const L = H.lane(22); const e = H.spawn('longshot', L.x0, L.z, -Math.PI / 2); e.speedMult = 0.00001; H.look(L.x0 + 7, L.z + 0.9, ${WEST});
    e.def = H.clone(e.def); e.def.charge.track = 0.6; e.def.charge.lock = 999; e.def.charge.turn = 0; Object.assign(e, { state: 'charge', stateT: 1.4, locked: true, yaw: -Math.PI / 2, aimPitch: 0 });`],
  ['ls-idle-lit', 1, `const L = H.lane(20); const e = H.spawn('longshot', L.x0, L.z, -Math.PI / 2); e.speedMult = 0.00001; H.look(L.x0 + 7, L.z, ${WEST});`],
  ['ls-lock-lit', 1, `const L = H.lane(22); const e = H.spawn('longshot', L.x0, L.z, -Math.PI / 2); e.speedMult = 0.00001; H.look(L.x0 + 8, L.z + 0.9, ${WEST});
    e.def = H.clone(e.def); e.def.charge.track = 0.6; e.def.charge.lock = 999; e.def.charge.turn = 0; Object.assign(e, { state: 'charge', stateT: 1.4, locked: true, yaw: -Math.PI / 2, aimPitch: 0 });`],
  // Bampot Nurse
  ['nu-idle-lit', 1, `const L = H.lane(20); const e = H.spawn('nurse', L.x0, L.z, -Math.PI / 2); e.speedMult = 0.00001; H.look(L.x0 + 6, L.z, ${WEST});`],
  ['nu-revive', 2, `const L = H.lane(20); const n = H.spawn('nurse', L.x0, L.z - 0.4, -Math.PI / 2); const f = H.spawn('fizzbang', L.x0 + 2.6, L.z + 0.5, 0);
    n.speedMult = 0.00001; f.cool = 99; H.look(L.x0 + 6.5, L.z + 0.6, ${WEST}, -0.1);
    H.g.testHook('hitEnemy', { i: 1, amount: 1e6, fx: f.x + 5, fz: f.z });
    n.def = H.clone(n.def); n.def.revive.time = 99; Object.assign(n, { state: 'revive', reviveTarget: f, stateT: 49.5 });`],
  ['nu-revive-lit', 1, `const L = H.lane(20); const n = H.spawn('nurse', L.x0, L.z - 0.4, -Math.PI / 2); const f = H.spawn('fizzbang', L.x0 + 2.8, L.z + 0.5, 0);
    n.speedMult = 0.00001; f.cool = 99; H.look(L.x0 + 7, L.z + 0.6, ${WEST}, -0.1);
    H.g.testHook('hitEnemy', { i: 1, amount: 1e6, fx: f.x + 5, fz: f.z });
    n.def = H.clone(n.def); n.def.revive.time = 99; Object.assign(n, { state: 'revive', reviveTarget: f, stateT: 69 });`],
  // Vending Mimic
  ['mi-dormant', 2, `const L = H.lane(20); const e = H.spawn('mimic', L.x0, L.z, -Math.PI / 2); e.state = 'idle'; H.look(L.x0 + 6, L.z, ${WEST});`],
  ['mi-dormant-lit', 1, `const L = H.lane(20); const e = H.spawn('mimic', L.x0, L.z, -Math.PI / 2); e.state = 'idle'; H.look(L.x0 + 6, L.z, ${WEST});`],
  ['mi-unfold-a', 2, `const L = H.lane(20); const e = H.spawn('mimic', L.x0, L.z, -Math.PI / 2); H.look(L.x0 + 5, L.z, ${WEST});
    e.def = H.clone(e.def); e.def.dormant.unfold = 99; Object.assign(e, { state: 'unfold', stateT: 29.7, fixed: false });`],
  ['mi-unfold-b', 2, `const L = H.lane(20); const e = H.spawn('mimic', L.x0, L.z, -Math.PI / 2); H.look(L.x0 + 5, L.z, ${WEST});
    e.def = H.clone(e.def); e.def.dormant.unfold = 99; Object.assign(e, { state: 'unfold', stateT: 54.5, fixed: false });`],
  ['mi-awake', 2, `const L = H.lane(20); const e = H.spawn('mimic', L.x0, L.z, -Math.PI / 2); H.look(L.x0 + 5, L.z, ${WEST}); e.speedMult = 0.00001; e.cool = 99; e.h = e.robot.height;`],
  ['mi-awake-lit', 1, `const L = H.lane(20); const e = H.spawn('mimic', L.x0, L.z, -Math.PI / 2); H.look(L.x0 + 4.5, L.z, ${WEST}); e.speedMult = 0.00001; e.cool = 99;`],
];

for (const [name, level, code] of scenes) {
  if (only && !only.includes(name)) continue;
  await page.evaluate(([level, code]) => {
    window.H.reset(level);
    // eslint-disable-next-line no-new-func
    new Function('H', code)(window.H);
  }, [level, code]);
  await page.waitForTimeout(Number(process.env.WAIT || 2600));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}
console.log('errors:', errs.length ? errs : 'none');
await b.close();
server.kill();
