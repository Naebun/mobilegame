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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|status of 404/.test(m.text()) && errors.push(m.text()));

  const ptr = (type, id, x, y) => page.evaluate(([type, id, x, y]) => {
    document.getElementById('game').dispatchEvent(
      new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: id === 1 }),
    );
  }, [type, id, x, y]);
  // Software WebGL runs at a few frames a second, so poll the game for a condition instead of sleeping.
  const until = async (expr, arg, timeout = 20000) => {
    try {
      await page.waitForFunction(([e, a]) => new Function('s', 'a', `return (${e})`)(window.__game.getState(), a), [expr, arg], { timeout, polling: 100 });
      return true;
    } catch { return false; }
  };
  const tap = async (x, y) => {
    await ptr('pointerdown', 9, x, y);
    await ptr('pointerup', 9, x, y);
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

  // medium tier: the full post pipeline (HDR, bloom, MSAA) at a cost software WebGL can bear
  await page.goto(`http://localhost:${port}/?test&q=medium`);
  await page.waitForFunction(() => window.__game && window.__game.getState().player, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const gl = await page.evaluate(() => { const c = document.getElementById('gl'); return { w: c.width, h: c.height, ok: !!c.getContext('webgl2') || !!c.getContext('webgl') }; });
  check(gl.ok && gl.w > 0, `WebGL canvas is live (${gl.w}x${gl.h})`);
  check((await state()).mode === 'title', 'starts on the title screen over the 3D club');
  await shot('title');

  // menus: title -> controls -> intro -> play
  await pressButton('new');
  check(await until("s.mode === 'controls'"), 'NEW GAME opens the controls screen');
  await shot('controls');
  await pressButton('back');
  check(await until("s.mode === 'title'"), 'BACK returns to the title');
  await pressButton('new');
  await until("s.mode === 'controls'");
  await page.waitForTimeout(1500);
  check((await state()).mode === 'controls', 'the game does not start until START GAME is pressed');
  await pressButton('start');
  check(await until("s.mode === 'intro'"), 'START GAME shows the level intro');
  await page.waitForTimeout(1200);
  await shot('intro');
  await tap(195, 400);
  check(await until("s.mode === 'play'"), 'tap skips the intro and play begins');
  const s0 = await state();
  check(s0.weapon === 'pistol' && s0.clip === 12 && s0.owned.length === 1, 'Freddie starts with a full Bass Pistol clip and nothing else');
  check(s0.total >= 12 && s0.alive === s0.total, `enemies are pre-placed in the level (${s0.total}) and all alive`);
  await page.waitForTimeout(1000);
  await shot('play-start');

  // the grey boxes: the move box walks, the look box turns and auto-fires
  const L = await hook('layout');
  const [mx, my] = center(L.moveBox);
  const [lx, ly] = center(L.lookBox);
  await ptr('pointerdown', 1, mx, my);
  await ptr('pointermove', 1, mx, my - L.moveBox.h * 0.4);
  const walked = await until('Math.hypot(s.player.x - a.x, s.player.z - a.z) > 1.5', { x: s0.x, z: s0.z });
  const s1 = await state();
  check(walked, `the move box walks Freddie (${Math.hypot(s1.x - s0.x, s1.z - s0.z).toFixed(1)} units)`);
  await ptr('pointerup', 1, mx, my - L.moveBox.h * 0.4);
  const yaw0 = (await state()).yaw;
  await ptr('pointerdown', 2, lx, ly);
  for (let i = 1; i <= 10; i++) await ptr('pointermove', 2, lx + i * 6, ly);
  check(await until('s.shots > a', s1.shots), 'a thumb held in the look box fires on its own, with no extra tap');
  const s2 = await state();
  check(Math.abs(s2.yaw - yaw0) > 0.2, `dragging in the look box turns the view (${(s2.yaw - yaw0).toFixed(2)} rad)`);
  check(s2.clip < 12, `the clip empties as it fires (${s2.clip}/12)`);
  check(await until('s.player.reloadT > 0', null, 30000), 'the clip reloads on its own when it runs empty');
  await ptr('pointerup', 2, lx, ly);
  await until('s.player.reloadT === 0 && s.player.ammo.pistol === 12', null, 30000);

  // free aim: a drag that starts outside both boxes turns the view but never fires
  const yawF = (await state()).yaw;
  const shotsF = (await state()).shots;
  await ptr('pointerdown', 3, 195, 250);
  for (let i = 1; i <= 10; i++) await ptr('pointermove', 3, 195 + i * 6, 250);
  check(await until('Math.abs(s.player.yaw - a) > 0.2', yawF), 'dragging anywhere outside the boxes aims');
  await page.waitForTimeout(800);
  check((await state()).shots === shotsF, 'a free-aim touch does not fire');
  await ptr('pointerup', 3, 255, 250);

  // swap and reload buttons
  await hook('giveWeapons');
  await tap(...center(L.swapBtn));
  check(await until("s.player.weapon !== 'pistol'"), `SWAP changes weapon (${(await state()).weapon})`);
  const full = (await hook('stats')).clip;
  await ptr('pointerdown', 2, lx, ly);
  await until('s.player.ammo[s.player.weapon] < a', full, 30000);
  await ptr('pointerup', 2, lx, ly);
  await tap(...center(L.reloadBtn));
  check(await until('s.player.reloadT > 0', null, 8000), 'the RELOAD button forces a reload before the clip is empty');
  await shot('play-weapon');

  // the launcher: a rocket flies, explodes and hurts a robot; the render path for explosions must not error
  await hook('play');
  await hook('giveWeapons');
  for (let i = 0; i < 4 && (await state()).weapon !== 'launcher'; i++) {
    await tap(...center(L.swapBtn));
    await page.waitForTimeout(400);
  }
  check((await state()).weapon === 'launcher', 'the Reverb Launcher can be selected');
  await ptr('pointerdown', 2, lx, ly);
  check(await until('s.shots >= 2'), 'the launcher fires rockets');
  await ptr('pointerup', 2, lx, ly);
  check(await until('s.projectiles.length === 0', null, 15000), 'rockets explode on impact and clean up');

  // enemy bottles: a Bampot and Nephew bot with a clear line of sight throws one
  await hook('play');
  await page.evaluate(() => {
    const g = window.__game;
    const w = g.getWorld();
    const e = g.getState().enemies.find((x) => x.kind === 'bampot');
    for (const d of [8, 7, 6, 5, 4]) {
      const x = e.x - Math.sin(e.yaw) * d;
      const z = e.z - Math.cos(e.yaw) * d;
      if (!w.isSolidAt(x, z) && w.los(x, z, e.x, e.z)) { g.testHook('teleport', { x, z, yaw: e.yaw + Math.PI }); break; }
    }
  });
  check(await until("s.projectiles.some((p) => p.owner === 'enemy')", null, 30000), 'a Bampot and Nephew bot throws bottles when it sees Freddie');
  await shot('bottles');

  // Last Orders: drink, switch to third person, spin with the laser, clear the room, return to first person
  await hook('play');
  await page.evaluate(() => {
    const g = window.__game;
    const w = g.getWorld();
    const S = g.getState();
    let best = null;
    for (const e of S.enemies) {
      for (const d of [3.5, 5, 7]) {
        for (let k = 0; k < 8; k++) {
          const x = e.x + Math.cos((k * Math.PI) / 4) * d;
          const z = e.z + Math.sin((k * Math.PI) / 4) * d;
          const a = w.areaAt(x, z);
          if (!a || a.id !== 'dancefloor' || w.isSolidAt(x, z) || S.enemies.some((o) => Math.hypot(o.x - x, o.z - z) < 3)) continue;
          const n = S.enemies.filter((o) => Math.hypot(o.x - x, o.z - z) < 26 && w.los(x, z, o.x, o.z)).length;
          if (!best || n > best.n) best = { x, z, n };
        }
      }
    }
    g.testHook('teleport', best);
    g.testHook('drink', 'lastorders');
  });
  check(await until('s.drink !== null', null, 8000), 'drinking Last Orders plays the drinking animation first');
  check(await until('s.laser !== null && s.camK > 0.9', null, 60000), 'the spin starts and the camera goes third person');
  await until('s.laser && s.laser.beam', null, 30000);
  await shot('laser');
  check(await until('s.laser === null', null, 60000), 'the spin ends');
  check(await until('s.camK === 0', null, 20000), 'the camera returns to first person');
  const dancefloor = await page.evaluate(() => window.__game.getState().areas.find((a) => a.def.id === 'dancefloor').cleared);
  check(dancefloor, 'the laser cleared the dance floor and its door opened');

  // the linear route: kill each area in order, doors open, the dead stay dead
  await hook('play');
  const start = await state();
  const order = start.areas.map((a) => a.id);
  check(order.length === 6, `six areas in order: ${order.join(', ')}`);
  for (const id of order) await hook('killArea', id);
  check(await until('s.areas.every((a) => a.cleared) && s.allClear'), 'every area reports clear once its enemies are dead');
  const done = await state();
  check(done.alive === 0 && done.kills === done.total, `killed enemies are gone and counted (${done.kills}/${done.total})`);
  await shot('area-clear');
  const exit = await page.evaluate(() => window.__game.getWorld().exit);
  await hook('teleport', exit);
  check(await until("s.mode === 'complete'"), 'reaching the exit after clearing everything completes the level');
  await page.waitForTimeout(2500);
  await shot('complete');
  await pressButton('menu');
  check(await until("s.mode === 'title'"), 'MAIN MENU returns to the title');

  // death and retry
  await pressButton('new');
  await until("s.mode === 'controls'");
  await pressButton('start');
  await until("s.mode === 'intro'");
  await tap(195, 400);
  await until("s.mode === 'play'");
  await hook('hurt', 1000);
  check(await until("s.mode === 'dead'"), 'dies at zero health');
  await page.waitForTimeout(2200);
  await shot('dead');
  await pressButton('retry');
  check(await until("s.mode === 'play'"), 'RETRY restarts the level');
  const retry = await state();
  check(retry.health === retry.maxHealth && retry.alive === retry.total, 'RETRY puts health and every enemy back in place');

  // debug mode: 2x fire rate, 2x damage, 2x health, and nothing else about balance changes
  await hook('title');
  const normal = await hook('stats');
  check(normal.fireInterval === 0.28 && normal.damageMult === 1 && normal.maxHealth === 100, `normal mode stats (${normal.fireInterval}s, x${normal.damageMult}, ${normal.maxHealth} hp)`);
  await pressButton('debug');
  check(await until('s.debugMode === true'), 'the debug button turns debug mode on');
  await shot('title-debug');
  await pressButton('new');
  await until("s.mode === 'controls'");
  await pressButton('start');
  await until("s.mode === 'intro'");
  await tap(195, 400);
  await until("s.mode === 'play'");
  const dbg = await hook('stats');
  check(dbg.fireInterval === 0.14 && dbg.damageMult === 2 && dbg.maxHealth === 200, `debug mode is exactly 2x (${dbg.fireInterval}s, x${dbg.damageMult}, ${dbg.maxHealth} hp)`);
  await page.waitForTimeout(1200);
  await shot('play-debug');
  await hook('title');
  await pressButton('debug');
  check(await until('s.debugMode === false'), 'the debug button turns it off again');

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? 'SMOKE FAILED' : 'SMOKE OK');
process.exit(failed ? 1 : 0);
