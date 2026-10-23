// Screenshots every menu screen and the play view at a chosen size (default landscape phone):
//   W=844 H=390 node scripts/harness/screen-views.mjs <outdir> [screens, comma separated]
// Screens: title, controls, settings, intro, voicemail, dead, complete, play. Level 2 is used for intro/play so the long text shows.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
const out = process.argv[2];
const want = (process.argv[3] || 'title,controls,intro,voicemail,dead,complete,play').split(',');
const W = Number(process.env.W || 844);
const H = Number(process.env.H || 390);
const server = spawn('node', ['scripts/serve.mjs', String(process.env.PORT || 8095)], { stdio: 'ignore', cwd: process.cwd() });
await new Promise((r) => setTimeout(r, 700));
const base = '/opt/pw-browsers';
const exe = readdirSync(base).filter((d) => d.startsWith('chromium-')).map((d) => readdirSync(`${base}/${d}`).filter((x) => x.startsWith('chrome-linux')).map((x) => `${base}/${d}/${x}/chrome`)[0])[0];
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errs.push(m.text()));
await page.goto(`http://localhost:${process.env.PORT || 8095}/?test&q=${process.env.Q || 'medium'}&level=${process.env.LEVEL || 2}${process.env.PC ? '&pc' : ''}`);
await page.waitForFunction(() => window.__game && window.__game.getState().player, null, { timeout: 90000 });
const tag = `${W}x${H}`;
for (const name of want) {
  if (name === 'play') {
    await page.evaluate(() => { window.__game.testHook('play'); window.__game.getState().player.health = 1e6; window.__game.testHook('giveWeapons'); });
  } else {
    await page.evaluate((n) => window.__game.testHook('screen', n), name);
  }
  // software WebGL is slow, so wait on game time (the screens fade buttons in after a second or so), not the clock
  await page.waitForFunction(([n, min]) => { const s = window.__game.getState(); return n === 'complete' ? s.completeT > min : n === 'dead' ? s.deadT > min : n === 'voicemail' ? s.mailT > min : true; }, [name, 2.5], { timeout: 60000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/screen-${tag}-${name}.png` });
  console.log('shot', name);
}
console.log('errors:', errs.length ? errs : 'none');
await b.close();
server.kill();
