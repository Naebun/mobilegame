// Screenshots the pistol's torch-fitting sequence in the real game (level 2, dark) at chosen points of the animation,
// then the fitted pistol with the torch off and on:
//   OUT=<dir> [W=390 H=844] [KS=0.1,0.3,0.45,0.58,0.64,0.85] [Q=medium] PORT=8201 node scripts/harness/attach-views.mjs
// The fitting runs on game time, which software WebGL cannot keep still, so each frame is held by pinning S.attach.t.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync, mkdirSync } from 'node:fs';

const OUT = process.env.OUT;
if (!OUT) { console.error('set OUT=<directory for the screenshots>'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const port = Number(process.env.PORT || 8096);
const ks = (process.env.KS || '0.1,0.3,0.45,0.58,0.64,0.85').split(',').map(Number);
const tag = `${process.env.W || 390}x${process.env.H || 844}`;
const server = spawn('node', ['scripts/serve.mjs', String(port)], { stdio: 'ignore', cwd: process.cwd() });
await new Promise((r) => setTimeout(r, 700));
const base = '/opt/pw-browsers';
const exe = readdirSync(base).filter((d) => d.startsWith('chromium-')).map((d) => readdirSync(`${base}/${d}`).filter((x) => x.startsWith('chrome-linux')).map((x) => `${base}/${d}/${x}/chrome`)[0])[0];
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await b.newContext({ viewport: { width: Number(process.env.W || 390), height: Number(process.env.H || 844) }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errs.push(m.text()));
await page.goto(`http://localhost:${port}/?test&q=${process.env.Q || 'medium'}&mobile`);
await page.waitForFunction(() => window.__game && window.__game.getState().player, null, { timeout: 90000 });
await page.evaluate(() => {
  const g = window.__game;
  g.testHook('level', 2);
  const S = g.getState();
  S.player.health = S.player.maxHealth = 1e6;
  S.banner = null;
  S.toast = null;
  window.__hold = null;
});
await page.waitForFunction(() => window.__game.getWorld().level === 2 && window.__game.getState().attach, null, { timeout: 90000 });
for (const k of ks) {
  await page.evaluate((k) => {
    const S = window.__game.getState();
    if (window.__hold) clearInterval(window.__hold);
    window.__hold = setInterval(() => { if (S.attach) S.attach.t = 0.5 + k * 2.8; S.banner = null; S.toast = null; }, 4);
  }, k);
  await page.waitForTimeout(Number(process.env.WAIT || 2500));
  await page.screenshot({ path: `${OUT}/attach-${tag}-k${String(k).replace('.', '')}.png` });
  console.log('shot', k);
}
// fitted, off and on
await page.evaluate(() => {
  clearInterval(window.__hold);
  const g = window.__game;
  g.testHook('torch', { attached: true, on: false });
  g.getState().banner = null;
  window.__hold = setInterval(() => { g.getState().banner = null; g.getState().toast = null; }, 4);
});
await page.waitForTimeout(Number(process.env.WAIT || 2500));
await page.screenshot({ path: `${OUT}/attach-${tag}-fitted-off.png` });
await page.evaluate(() => window.__game.testHook('torch', { attached: true, on: true }));
await page.waitForTimeout(Number(process.env.WAIT || 2500));
await page.screenshot({ path: `${OUT}/attach-${tag}-fitted-on.png` });
console.log('errors:', errs.length ? errs : 'none');
await b.close();
server.kill();
