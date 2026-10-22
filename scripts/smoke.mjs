// Headless check at a phone-sized viewport using synthetic multi-touch events.
// Covers: menus, both sticks, all five levels and bosses via the ?debug hook, level clear,
// upgrade pick, death and retry, win, and save/continue. Screenshots go to the directory in
// argv[2] (default: cwd) as smoke-*.png.
import { spawn } from 'node:child_process';
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

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const ptr = (type, id, x, y) =>
    page.evaluate(([type, id, x, y]) => {
      document.getElementById('game').dispatchEvent(
        new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: id === 6 }),
      );
    }, [type, id, x, y]);
  const tap = async (x, y) => {
    await ptr('pointerdown', 9, x, y);
    await ptr('pointerup', 9, x, y);
    await page.waitForTimeout(120);
  };
  const dbg = (cmd, arg) => page.evaluate(([c, a]) => window.__game.testHook(c, a), [cmd, arg]);
  const state = () => page.evaluate(() => {
    const s = window.__game.getState();
    return {
      mode: s.mode, level: s.level, shots: s.shots, x: s.player.x, score: s.score, boss: !!s.boss,
      enemies: s.enemies.length, offers: s.offers.length, upSum: Object.values(s.ups).reduce((a, b) => a + b, 0),
      hasSave: !!s.save, saveLevel: s.save?.level, debugMode: s.debugMode,
      interval: s.st.interval, dmg: s.st.dmg, maxHp: s.st.maxHp, hp: s.player.hp,
    };
  });
  const shot = (name) => page.screenshot({ path: join(outDir, `smoke-${name}.png`) });

  await page.goto(`http://localhost:${port}/?test`);
  await page.waitForTimeout(400);

  const size = await page.evaluate(() => {
    const c = document.getElementById('game');
    return { w: c.width, h: c.height, scrolls: document.documentElement.scrollHeight > innerHeight };
  });
  check(size.w === 1170 && size.h === 2532 && !size.scrolls, `canvas fills viewport ${JSON.stringify(size)}`);
  check((await state()).mode === 'title', 'starts on title');
  await shot('title');

  // NEW GAME button sits at 46% of the height
  await tap(195, 844 * 0.46 + 26);
  check((await state()).mode === 'intro', 'NEW GAME shows the level intro');
  await page.waitForTimeout(900);
  await shot('intro');
  await tap(195, 600);
  check((await state()).mode === 'play', 'tap skips the intro');

  const s0 = await state();
  await ptr('pointerdown', 6, 100, 700);
  await ptr('pointermove', 6, 170, 700);
  await ptr('pointerdown', 7, 300, 700);
  await ptr('pointermove', 7, 300, 620);
  await page.waitForTimeout(4000);
  const s1 = await state();
  check(s1.x > s0.x + 40, `left stick moves Freddie (${Math.round(s0.x)} -> ${Math.round(s1.x)})`);
  check(s1.shots > 10, `right stick fires (${s1.shots} shots)`);
  await shot('play-real');
  await ptr('pointerup', 6, 170, 700);
  await ptr('pointerup', 7, 300, 620);

  // every level: play, boss, clear, then upgrade (or win after the last)
  for (let i = 0; i < 5; i++) {
    await dbg('play', i);
    await page.waitForTimeout(4500);
    const play = await state();
    check(play.mode === 'play' && play.level === i && (play.enemies > 0 || play.score > 0), `level ${i + 1} plays and spawns enemies`);
    await shot(`level${i + 1}`);
    await dbg('boss');
    await page.waitForTimeout(2500);
    const boss = await state();
    check(boss.boss, `level ${i + 1} boss arrives`);
    await shot(`boss${i + 1}`);
    await dbg('killboss');
    await page.waitForTimeout(300);
    check((await state()).mode === 'clear', `level ${i + 1} clears when the boss dies`);
    await page.waitForTimeout(2900);
    const after = await state();
    if (i < 4) {
      check(after.mode === 'upgrade' && after.offers === 3, `level ${i + 1} offers 3 upgrades`);
      if (i === 0) await shot('upgrade');
      await tap(195, 844 * 0.3 + 40);
      const next = await state();
      check(next.mode === 'intro' && next.level === i + 1 && next.upSum === 1, `upgrade pick starts level ${i + 2}`);
    } else {
      check(after.mode === 'win', 'finishing level 5 wins');
      await page.waitForTimeout(1200);
      await shot('win');
    }
  }

  // with no thumbs down, Freddie still defends himself against enemies that get close
  await dbg('play', 0);
  const idle0 = (await state()).shots;
  await page.waitForTimeout(16000);
  const idle1 = (await state()).shots;
  check(idle1 > idle0, `auto-fires at close enemies with no touch (${idle1 - idle0} shots)`);

  // death and retry
  await dbg('play', 1);
  await page.evaluate(() => { window.__game.getState().player.hp = 0; });
  await page.waitForTimeout(300);
  check((await state()).mode === 'dead', 'dies at 0 hp');
  await page.waitForTimeout(1000);
  await shot('dead');
  await tap(195, 844 * 0.6 + 26);
  const retry = await state();
  check(retry.mode === 'intro' && retry.level === 1, 'RETRY LEVEL restarts the same level');

  // progress persists across a reload
  await page.reload();
  await page.waitForTimeout(500);
  const reloaded = await state();
  check(reloaded.mode === 'title' && reloaded.hasSave && reloaded.saveLevel === 1, 'save survives a reload');
  await shot('title-continue');
  await tap(195, 844 * 0.46 + 26);
  const cont = await state();
  check(cont.mode === 'intro' && cont.level === 1, 'CONTINUE resumes at the saved level');

  // debug mode: 2x fire rate, 2x damage, 2x health, and it never touches the real save or best score
  const tapButton = async (id) => {
    const list = await dbg('buttons');
    const b = list.find((x) => x.id === id);
    if (!b) throw new Error(`no ${id} button`);
    await tap(b.x + b.w / 2, b.y + b.h / 2);
  };
  const stored = (key) => page.evaluate((k) => localStorage.getItem(k), key);
  const normal = await state();
  check(!normal.debugMode && normal.interval === 0.15 && normal.dmg === 1 && normal.maxHp === 5, `normal mode stats (${normal.interval}s, ${normal.dmg} dmg, ${normal.maxHp} hp)`);
  const saveBefore = await stored('mobilegame.save');
  const bestBefore = await stored('mobilegame.best');

  await dbg('title');
  await shot('title-normal');
  await tapButton('debug');
  check((await state()).debugMode === true, 'debug button turns debug mode on');
  await shot('title-debug');
  await page.reload();
  await page.waitForTimeout(500);
  check((await state()).debugMode === true, 'debug mode stays on after a reload');
  await tapButton('new');
  const dbgRun = await state();
  check(dbgRun.interval === 0.075 && dbgRun.dmg === 2 && dbgRun.maxHp === 10 && dbgRun.hp === 10, `debug stats are exactly 2x (${dbgRun.interval}s, ${dbgRun.dmg} dmg, ${dbgRun.maxHp} hp)`);
  await page.waitForTimeout(3200);
  await shot('play-debug');
  await dbg('play', 2);
  await page.evaluate(() => { const g = window.__game.getState(); g.player.hp = 0; });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__game.getState().score = 99999; });
  await page.waitForTimeout(1200);
  await shot('dead-debug');
  check((await stored('mobilegame.save')) === saveBefore, 'debug run leaves the real save untouched');
  check((await stored('mobilegame.best')) === bestBefore, 'debug run leaves the best score untouched');
  await tapButton('menu');
  check((await state()).mode === 'title', 'MAIN MENU returns to the home screen');
  await tapButton('debug');
  check((await state()).debugMode === false, 'debug button turns debug mode off');
  await tapButton('new');
  const back = await state();
  check(back.interval === 0.15 && back.dmg === 1 && back.maxHp === 5, 'normal stats are back with debug off');

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? 'SMOKE FAILED' : 'SMOKE OK');
process.exit(failed ? 1 : 0);
