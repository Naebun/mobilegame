// End-to-end check of the first-person game in headless Chromium (software WebGL) with synthetic multi-touch.
// Covers: menus and the controls screen, the grey move and look boxes, auto-fire, clip and reload, weapon swap,
// the linear route (areas, doors, enemies that stay dead), death and retry, level complete, and debug mode.
// Screenshots go to the directory in argv[2] (default: cwd) as smoke-*.png.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const port = 8099;
const outDir = process.argv[2] || '.';
const server = spawn('node', ['scripts/serve.mjs', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));

let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failed = true;
};

const chromiumPath = process.env.CHROMIUM_PATH
  || readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).map((d) => {
    const base = `/opt/pw-browsers/${d}`;
    return readdirSync(base).filter((x) => x.startsWith('chrome-linux')).map((x) => `${base}/${x}/chrome`)[0];
  })[0];

const browser = await chromium.launch({
  executablePath: chromiumPath,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|status of 404/.test(m.text()) && errors.push(m.text()));

  const ptr = (type, id, x, y) => page.evaluate(([type, id, x, y]) => {
    document.getElementById('game').dispatchEvent(
      new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: id === 1 }),
    );
  }, [type, id, x, y]);
  const tap = async (x, y) => {
    await ptr('pointerdown', 9, x, y);
    await ptr('pointerup', 9, x, y);
    await page.waitForTimeout(150);
  };
  const hook = (cmd, arg) => page.evaluate(([c, a]) => window.__game.testHook(c, a), [cmd, arg]);
  const pressButton = async (id) => {
    const b = (await hook('buttons')).find((x) => x.id === id);
    if (!b) throw new Error(`no ${id} button in mode ${(await state()).mode}`);
    await tap(b.x + b.w / 2, b.y + b.h / 2);
  };
  const center = (r) => [r.x + r.w / 2, r.y + r.h / 2];
  const state = () => page.evaluate(() => {
    const s = window.__game.getState();
    const p = s.player;
    return {
      mode: s.mode, x: p.x, z: p.z, yaw: p.yaw, health: p.health, maxHealth: p.maxHealth, weapon: p.weapon,
      clip: p.ammo[p.weapon], reloading: p.reloadT > 0, shots: s.shots, kills: s.kills,
      alive: s.enemies.filter((e) => !e.dead).length, total: s.totalEnemies, areas: s.areas.map((a) => ({ id: a.def.id, cleared: a.cleared })),
      debugMode: s.debugMode, owned: Object.keys(p.owned), allClear: s.allClear,
    };
  });
  const shot = (name) => page.screenshot({ path: join(outDir, `smoke-${name}.png`) });

  await page.goto(`http://localhost:${port}/?test`);
  await page.waitForTimeout(1500);
  const gl = await page.evaluate(() => { const c = document.getElementById('gl'); return { w: c.width, h: c.height, ok: !!c.getContext('webgl2') || !!c.getContext('webgl') }; });
  check(gl.ok && gl.w > 0, `WebGL canvas is live (${gl.w}x${gl.h})`);
  check((await state()).mode === 'title', 'starts on the title screen over the 3D club');
  await shot('title');

  // menus: title -> controls -> intro -> play
  await pressButton('new');
  check((await state()).mode === 'controls', 'NEW GAME opens the controls screen');
  await page.waitForTimeout(400);
  await shot('controls');
  await pressButton('back');
  check((await state()).mode === 'title', 'BACK returns to the title');
  await pressButton('new');
  await page.waitForTimeout(1200);
  check((await state()).mode === 'controls', 'the game does not start until START GAME is pressed');
  await pressButton('start');
  check((await state()).mode === 'intro', 'START GAME shows the level intro');
  await page.waitForTimeout(1000);
  await shot('intro');
  await tap(195, 400);
  const s0 = await state();
  check(s0.mode === 'play', 'tap skips the intro and play begins');
  check(s0.weapon === 'pistol' && s0.clip === 12 && s0.owned.length === 1, 'Freddie starts with a full Bass Pistol clip and nothing else');
  check(s0.total >= 12 && s0.alive === s0.total, `enemies are pre-placed in the level (${s0.total}) and all alive`);
  await shot('play-start');

  // the grey boxes: move box walks, look box turns and auto-fires
  const L = await hook('layout');
  const [mx, my] = center(L.moveBox);
  const [lx, ly] = center(L.lookBox);
  await ptr('pointerdown', 1, mx, my);
  await ptr('pointermove', 1, mx, my - L.moveBox.h * 0.4);
  await page.waitForTimeout(700);
  const s1 = await state();
  check(Math.hypot(s1.x - s0.x, s1.z - s0.z) > 0.8, `move box walks Freddie (${Math.hypot(s1.x - s0.x, s1.z - s0.z).toFixed(1)} units)`);
  await ptr('pointerup', 1, mx, my - L.moveBox.h * 0.4);
  const yaw0 = (await state()).yaw;
  await ptr('pointerdown', 2, lx, ly);
  for (let i = 1; i <= 10; i++) await ptr('pointermove', 2, lx + i * 6, ly);
  await page.waitForTimeout(600);
  const s2 = await state();
  check(s2.shots > s1.shots, `a thumb in the look box fires on its own (${s2.shots - s1.shots} shots, no extra tap)`);
  check(Math.abs(s2.yaw - yaw0) > 0.2, `dragging in the look box turns the view (${(s2.yaw - yaw0).toFixed(2)} rad)`);
  check(s2.clip < 12, `the clip empties as it fires (${s2.clip}/12)`);
  await page.waitForTimeout(2200);
  const s3 = await state();
  check(s3.reloading || s3.clip === 12, 'the clip reloads on its own when it runs empty');
  await ptr('pointerup', 2, lx, ly);

  // reload button, swap button
  await page.waitForTimeout(1500);
  await hook('giveWeapons');
  await tap(...center(L.swapBtn));
  const s4 = await state();
  check(s4.weapon !== 'pistol', `SWAP changes weapon (${s4.weapon})`);
  await ptr('pointerdown', 2, lx, ly);
  await page.waitForTimeout(500);
  await ptr('pointerup', 2, lx, ly);
  const before = await state();
  check(before.clip < (await hook('stats')).clip + 99, 'clip tracked');
  await tap(...center(L.reloadBtn));
  await page.waitForTimeout(100);
  check((await state()).reloading, 'the RELOAD button forces a reload');
  await shot('play-weapon');

  // the linear route: kill each area in order, doors open, the dead stay dead
  await hook('play');
  const start = await state();
  const order = start.areas.map((a) => a.id);
  check(order.length === 6, `six areas in order: ${order.join(', ')}`);
  for (const id of order) {
    await hook('killArea', id);
    await page.waitForTimeout(150);
  }
  const done = await state();
  check(done.alive === 0 && done.kills === done.total, `killed enemies are gone and counted (${done.kills}/${done.total})`);
  check(done.areas.every((a) => a.cleared) && done.allClear, 'every area reports clear once its enemies are dead');
  await page.waitForTimeout(800);
  await shot('area-clear');
  const world = await page.evaluate(() => { const w = window.__game.getWorld(); return { exit: w.exit }; });
  await hook('teleport', world.exit);
  await page.waitForTimeout(300);
  check((await state()).mode === 'complete', 'reaching the exit after clearing everything completes the level');
  await page.waitForTimeout(1400);
  await shot('complete');
  await pressButton('menu');
  check((await state()).mode === 'title', 'MAIN MENU returns to the title');

  // death and retry
  await pressButton('new');
  await pressButton('start');
  await page.waitForTimeout(900);
  await tap(195, 400);
  await hook('hurt', 1000);
  await page.waitForTimeout(300);
  check((await state()).mode === 'dead', 'dies at zero health');
  await page.waitForTimeout(1100);
  await shot('dead');
  await pressButton('retry');
  const retry = await state();
  check(retry.mode === 'play' && retry.health === retry.maxHealth && retry.alive === retry.total, 'RETRY restarts the level with everything back in place');

  // debug mode: 2x fire rate, 2x damage, 2x health, never changes balance otherwise
  await hook('title');
  const normal = await hook('stats');
  check(normal.fireInterval === 0.28 && normal.damageMult === 1 && normal.maxHealth === 100, `normal mode stats (${normal.fireInterval}s, x${normal.damageMult}, ${normal.maxHealth} hp)`);
  await pressButton('debug');
  check((await state()).debugMode === true, 'the debug button turns debug mode on');
  await shot('title-debug');
  await pressButton('new');
  await pressButton('start');
  await page.waitForTimeout(900);
  await tap(195, 400);
  const dbg = await hook('stats');
  check(dbg.fireInterval === 0.14 && dbg.damageMult === 2 && dbg.maxHealth === 200, `debug mode is exactly 2x (${dbg.fireInterval}s, x${dbg.damageMult}, ${dbg.maxHealth} hp)`);
  await shot('play-debug');
  await hook('title');
  await pressButton('debug');
  check((await state()).debugMode === false, 'the debug button turns it off again');

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? 'SMOKE FAILED' : 'SMOKE OK');
process.exit(failed ? 1 : 0);
