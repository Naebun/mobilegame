// Headless check at a phone-sized viewport using synthetic multi-touch events.
// Verifies: no console errors, canvas fills the screen, title -> play -> dead -> play,
// left stick moves Freddie, right stick fires. Screenshots go to the directory in argv[2]
// (default: cwd) as smoke-title.png, smoke-play.png and smoke-dead.png.
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
  const state = () => page.evaluate(() => {
    const s = window.__game.getState();
    return { mode: s.mode, wave: s.wave, shots: s.shots, hp: s.player.hp, x: s.player.x, y: s.player.y, enemies: s.enemies.length };
  });

  await page.goto(`http://localhost:${port}/?debug`);
  await page.waitForTimeout(400);

  const size = await page.evaluate(() => {
    const c = document.getElementById('game');
    return { w: c.width, h: c.height, scrolls: document.documentElement.scrollHeight > innerHeight };
  });
  check(size.w === 1170 && size.h === 2532 && !size.scrolls, `canvas fills viewport ${JSON.stringify(size)}`);
  check((await state()).mode === 'title', 'starts on title');
  await page.screenshot({ path: join(outDir, 'smoke-title.png') });

  await ptr('pointerdown', 5, 200, 500);
  await ptr('pointerup', 5, 200, 500);
  await page.waitForTimeout(100);
  const s0 = await state();
  check(s0.mode === 'play' && s0.wave === 1, 'tap starts wave 1');

  // left thumb pushes right, right thumb aims up
  await ptr('pointerdown', 6, 100, 700);
  await ptr('pointermove', 6, 170, 700);
  await ptr('pointerdown', 7, 300, 700);
  await ptr('pointermove', 7, 300, 620);
  await page.waitForTimeout(5000);
  const s1 = await state();
  check(s1.x > s0.x + 40, `left stick moves Freddie (${Math.round(s0.x)} -> ${Math.round(s1.x)})`);
  check(s1.shots > 10, `right stick fires (${s1.shots} shots)`);
  await page.screenshot({ path: join(outDir, 'smoke-play.png') });

  await ptr('pointerup', 6, 170, 700);
  await ptr('pointerup', 7, 300, 620);

  await page.evaluate(() => { window.__game.getState().player.hp = 0; });
  await page.waitForTimeout(300);
  check((await state()).mode === 'dead', 'dies at 0 hp');
  await page.screenshot({ path: join(outDir, 'smoke-dead.png') });
  await page.waitForTimeout(1000);
  await ptr('pointerdown', 8, 200, 500);
  await ptr('pointerup', 8, 200, 500);
  await page.waitForTimeout(100);
  const s2 = await state();
  check(s2.mode === 'play' && s2.hp === 5 && s2.wave === 1, 'tap restarts a fresh run');

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? 'SMOKE FAILED' : 'SMOKE OK');
process.exit(failed ? 1 : 0);
