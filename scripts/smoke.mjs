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
  check(s0.weapon === 'pistol' && s0.clip === 12 && s0.owned.length === 1, 'Naebun starts with a full Bass Pistol clip and nothing else');
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
  check(walked, `the move box walks Naebun (${Math.hypot(s1.x - s0.x, s1.z - s0.z).toFixed(1)} units)`);
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
  for (let i = 0; i < 6 && (await state()).weapon !== 'launcher'; i++) {
    const was = (await state()).weapon;
    await tap(...center(L.swapBtn));
    await until('s.player.weapon !== a', was, 10000); // software WebGL is slow: wait for the swap, not the clock
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
  check(await until("s.projectiles.some((p) => p.owner === 'enemy')", null, 30000), 'a Bampot and Nephew bot throws bottles when it sees Naebun');
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
  const next = (await hook('buttons')).map((b) => b.id);
  check(next.includes('next') && next.includes('again') && next.includes('menu'), `level 1 complete offers NEXT LEVEL, PLAY AGAIN and MAIN MENU (${next.join(', ')})`);

  // level 2: NEXT LEVEL -> Cheryl's voicemail -> intro -> the Vaults
  await pressButton('next');
  check(await until("s.mode === 'voicemail' && s.level === 2"), 'NEXT LEVEL loads level 2 behind a voicemail card');
  await page.waitForTimeout(4200);
  await shot('voicemail');
  await pressButton('continue');
  check(await until("s.mode === 'intro'"), 'CONTINUE shows the level 2 intro');
  await page.waitForTimeout(1200);
  await shot('intro-2');
  await tap(195, 400);
  check(await until("s.mode === 'play'"), 'play begins on level 2');
  const v0 = await state();
  const v = await page.evaluate(() => {
    const w = window.__game.getWorld();
    const S = window.__game.getState();
    return { id: w.id, level: w.level, kinds: [...new Set(S.enemies.map((e) => e.kind))].sort(), weapons: S.pickups.filter((p) => p.def.kind === 'weapon').map((p) => p.def.item), areas: S.areas.map((a) => a.def.id) };
  });
  check(v.id === 'vaults' && v.level === 2, 'the world is now the Vaults');
  check(v0.weapon === 'pistol' && v0.owned.length === 1 && v0.health === v0.maxHealth, 'Naebun starts level 2 with the pistol only and full health');
  check(v.kinds.includes('shielded') && v.kinds.includes('tourguide') && v.kinds.includes('fizzbang') && v.kinds.includes('bampot'), `level 2 has its robots (${v.kinds.join(', ')})`);
  check(v.weapons.includes('vinyl') && v.weapons.includes('launcher'), `the Vinyl Disc and the launcher lie on the floor (${v.weapons.join(', ')})`);
  const fitting = await hook('torch');
  check(fitting.dark && fitting.attach && !fitting.attached && !fitting.on, 'level 2 is dark and starts with the torch still to be fitted to the pistol');
  check(await until('s.attach && s.attach.k > 0.4', null, 60000), 'the fitting sequence runs');
  await shot('torch-fitting');
  check(await until('!s.attach && s.torch.attached && s.torch.on', null, 90000), 'the torch ends up fitted and on');
  await page.waitForTimeout(800);
  await shot('vaults-start');
  const tele = async (id, d = 4) => page.evaluate(([id, d]) => {
    const g = window.__game;
    const w = g.getWorld();
    const a = w.areas.find((x) => x.id === id);
    const sp = a.spawns[0];
    for (const dd of [d, d + 2, d - 1, 3]) {
      const x = sp.x - Math.sin(sp.yaw) * dd;
      const z = sp.z - Math.cos(sp.yaw) * dd;
      if (!w.isSolidAt(x, z) && w.los(x, z, sp.x, sp.z)) { g.testHook('teleport', { x, z, yaw: sp.yaw + Math.PI }); return true; }
    }
    return false;
  }, [id, d]);
  for (const id of ['longvault', 'casks', 'close', 'plague', 'tour']) {
    await tele(id, 6);
    await page.waitForTimeout(1600);
    await shot(`vaults-${id}`);
  }
  // clear it: the same route rule as level 1, then the exit
  for (const id of v.areas) await hook('killArea', id);
  check(await until('s.areas.every((a) => a.cleared) && s.allClear'), 'every level 2 area reports clear once its robots are dead');
  const exit2 = await page.evaluate(() => window.__game.getWorld().exit);
  await hook('teleport', exit2);
  check(await until("s.mode === 'complete'"), 'reaching the exit completes level 2');
  await page.waitForTimeout(2500);
  await shot('complete-2');
  const last = (await hook('buttons')).map((b) => b.id);
  check(!last.includes('next') && last.includes('again') && last.includes('menu'), `the last level offers no NEXT LEVEL (${last.join(', ')})`);
  await pressButton('menu');
  check(await until("s.mode === 'title' && s.level === 1"), 'MAIN MENU returns to the title, ready for level 1 again');
  const back = await page.waitForFunction(() => window.__game.getWorld().id === 'cowgate', null, { timeout: 30000 }).then(() => true, () => false);
  check(back, 'and the Cowgate is loaded again behind it (the swap waits for a drawn frame)');

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

  // landscape: rotate the phone. The boxes move to the lower corners, SWAP and RELOAD sit beside them, the view narrows
  // its field of view, and the same controls still work.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => window.innerWidth === 844, null, { timeout: 10000 });
  await page.waitForTimeout(800);
  const LL = await hook('layout');
  check(LL.moveBox.y > 195 && LL.lookBox.y > 195 && LL.moveBox.x < 100 && LL.lookBox.x + LL.lookBox.w > 744, `landscape: the boxes sit in the lower corners (${JSON.stringify(LL.moveBox)})`);
  check(LL.swapBtn.x > LL.moveBox.x + LL.moveBox.w && LL.reloadBtn.x + LL.reloadBtn.w < LL.lookBox.x, 'landscape: SWAP and RELOAD sit between the boxes');
  const fovL = await hook('stats');
  check(fovL.aspect > 2 && fovL.fov < 70, `landscape: the vertical field of view narrows (${fovL.fov.toFixed(1)} degrees at aspect ${fovL.aspect.toFixed(2)})`);
  await shot('land-title');
  await pressButton('new');
  check(await until("s.mode === 'controls'"), 'landscape: NEW GAME opens the controls screen');
  await page.waitForTimeout(800);
  await shot('land-controls');
  await pressButton('start');
  await until("s.mode === 'intro'");
  await page.waitForTimeout(800);
  await shot('land-intro');
  await tap(422, 200);
  check(await until("s.mode === 'play'"), 'landscape: tap skips the intro');
  const l0 = await state();
  const [lmx, lmy] = center(LL.moveBox);
  const [llx, lly] = center(LL.lookBox);
  await ptr('pointerdown', 1, lmx, lmy);
  await ptr('pointermove', 1, lmx, lmy - LL.moveBox.h * 0.4);
  check(await until('Math.hypot(s.player.x - a.x, s.player.z - a.z) > 1.5', { x: l0.x, z: l0.z }), 'landscape: the move box walks Naebun');
  await ptr('pointerup', 1, lmx, lmy - LL.moveBox.h * 0.4);
  const ly0 = (await state()).yaw;
  const lshots = (await state()).shots;
  await ptr('pointerdown', 2, llx, lly);
  for (let i = 1; i <= 10; i++) await ptr('pointermove', 2, llx + i * 4, lly);
  check(await until('s.shots > a', lshots), 'landscape: a thumb in the look box fires on its own');
  check(Math.abs((await state()).yaw - ly0) > 0.15, 'landscape: dragging in the look box turns the view');
  await ptr('pointerup', 2, llx, lly);
  const sw0 = (await state()).shots;
  await ptr('pointerdown', 3, 422, 120);
  for (let i = 1; i <= 10; i++) await ptr('pointermove', 3, 422 + i * 5, 120);
  await page.waitForTimeout(600);
  check((await state()).shots === sw0, 'landscape: a free-aim drag in the middle of the screen does not fire');
  await ptr('pointerup', 3, 472, 120);
  await tap(...center(LL.swapBtn));
  await hook('giveWeapons');
  await tap(...center(LL.swapBtn));
  check(await until("s.player.weapon !== 'pistol'"), 'landscape: SWAP works from beside the box');
  await shot('land-play');
  await hook('hurt', 1000);
  check(await until("s.mode === 'dead'"), 'landscape: dies at zero health');
  await page.waitForTimeout(2600);
  await shot('land-dead');
  check((await hook('buttons')).map((b) => b.id).join() === 'retry,menu', 'landscape: RETRY and MAIN MENU are offered');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.innerWidth === 390, null, { timeout: 10000 });
  await page.waitForTimeout(800);
  const LP = await hook('layout');
  const fovP = await hook('stats');
  check(LP.moveBox.y > 500 && fovP.fov === 85, `rotating back restores the portrait layout and 85 degrees (${fovP.fov})`);
  await shot('port-after-rotate');

  // saved progress: finishing the levels above wrote a cookie, and a reload offers CONTINUE
  const cookie = await page.evaluate(() => document.cookie.split('; ').find((c) => c.startsWith('fls=')) || '');
  const saved = cookie ? JSON.parse(decodeURIComponent(cookie.slice(4))) : null;
  check(saved && saved.unlocked === 2 && saved.done.join() === '1,2' && saved.best[1] > 0, `progress is saved in a cookie (${cookie ? decodeURIComponent(cookie).slice(0, 80) : 'none'})`);
  await page.goto(`http://localhost:${port}/?test&q=low&pc`);
  await page.waitForFunction(() => window.__game && window.__game.getState().player, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  const tb = await hook('buttons');
  check(tb.map((b) => b.id).join() === 'resume,new,settings,debug' && tb[0].label === 'CONTINUE: LEVEL 2', `after a reload the title offers ${tb.map((b) => b.label).join(' | ')}`);
  await shot('title-continue');
  await pressButton('resume');
  check(await until("s.mode === 'voicemail' && s.level === 2"), 'CONTINUE goes to level 2 behind its voicemail');
  await page.waitForFunction(() => window.__game.getWorld().id === 'vaults', null, { timeout: 60000 });
  await hook('title');
  await page.waitForFunction(() => window.__game.getWorld().id === 'cowgate', null, { timeout: 60000 });

  // control modes. The phone-sized test browser was detected as mobile above (touch boxes); ?pc forces PC mode
  const modes = await hook('stats');
  check(modes.input === 'pc', `?pc gives PC mode (${modes.input})`);
  await pressButton('settings');
  check(await until("s.mode === 'settings'"), 'SETTINGS opens from the title');
  check((await hook('buttons')).map((b) => b.id).join() === 'input,sens,reset,back', 'the page offers the controls mode, mouse sensitivity, reset and back');
  await page.waitForTimeout(800);
  await shot('settings');
  await pressButton('sens');
  check(await until('s.settings.sens === 2'), 'MOUSE SENSITIVITY steps to HIGH');
  await pressButton('sens');
  await until('s.settings.sens === 0');
  await pressButton('sens');
  await until('s.settings.sens === 1');
  await pressButton('input');
  check(await until("s.settings.input === 'mobile'"), 'CONTROLS switches to MOBILE');
  check((await hook('buttons')).map((b) => b.id).join() === 'input,reset,back', 'mobile mode has no mouse sensitivity');
  const settingsSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('mobilegame.settings')));
  check(settingsSaved && settingsSaved.input === 'mobile', 'the choice is remembered');
  await pressButton('input');
  check(await until("s.settings.input === 'pc'"), 'CONTROLS switches back to PC');
  await page.waitForTimeout(600);
  await pressButton('back');
  await until("s.mode === 'title'");
  await pressButton('new');
  await until("s.mode === 'controls'");
  await page.waitForTimeout(800);
  await shot('controls-pc');
  await pressButton('start');
  await until("s.mode === 'intro'");
  await tap(195, 400);
  check(await until("s.mode === 'play'"), 'play begins in PC mode');
  const my0 = (await state()).yaw;
  await hook('mouse', { dx: 150, dy: 0 });
  check(await until('Math.abs(s.player.yaw - a) > 0.2', my0), 'PC mode: moving the mouse turns the view with no button held');
  const mshots = (await state()).shots;
  await hook('mouse', { down: true });
  check(await until('s.shots > a', mshots), 'PC mode: the left button fires');
  await hook('mouse', null);
  await page.waitForTimeout(1500);
  await shot('mouse-look');
  // reset: two taps
  await hook('title');
  await pressButton('settings');
  await until("s.mode === 'settings'");
  await pressButton('reset');
  await until('s.resetArmed > 0');
  check((await hook('buttons')).find((b) => b.id === 'reset').label === 'TAP AGAIN TO ERASE', 'the first tap on RESET PROGRESS only arms it');
  await pressButton('reset');
  await until('s.save.done.length === 0');
  const cleared = await page.evaluate(() => document.cookie.split('; ').find((c) => c.startsWith('fls=')) || '');
  check(!cleared || JSON.parse(decodeURIComponent(cleared.slice(4))).unlocked === 1, 'the second tap erases the saved progress');
  await pressButton('back');
  await until("s.mode === 'title'");
  check((await hook('buttons')).map((b) => b.id).join() === 'new,settings,debug', 'with nothing saved the title is back to NEW GAME');
  // detection: a phone-sized touch browser with no saved choice starts in mobile mode
  await page.evaluate(() => localStorage.removeItem('mobilegame.settings'));
  await page.goto(`http://localhost:${port}/?test&q=low`);
  await page.waitForFunction(() => window.__game && window.__game.getState().player, null, { timeout: 60000 });
  check((await hook('stats')).input === 'mobile', 'a mobile browser starts in mobile mode on its own');

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? 'SMOKE FAILED' : 'SMOKE OK');
process.exit(failed ? 1 : 0);
