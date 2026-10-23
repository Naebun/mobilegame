// Software-WebGL frame rate per quality tier at phone size, standing in the dancefloor. Relative numbers only:
// a phone GPU is a different machine. node scripts/harness/tier-fps.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
const server = spawn('node', ['scripts/serve.mjs', String(process.env.PORT || 8093)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const base = '/opt/pw-browsers';
const exe = readdirSync(base).filter((d) => d.startsWith('chromium-')).map((d) => readdirSync(`${base}/${d}`).filter((x) => x.startsWith('chrome-linux')).map((x) => `${base}/${d}/${x}/chrome`)[0])[0];
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const q of ['low', 'medium', 'high']) {
  const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })).newPage();
  await page.goto(`http://localhost:${process.env.PORT || 8093}/?test&q=${q}`);
  await page.waitForFunction(() => window.__game && window.__game.getState().player, null, { timeout: 60000 });
  await page.evaluate(() => window.__game.testHook('play'));
  await page.evaluate(() => {
    const g = window.__game, sp = g.getWorld().areas.find((a) => a.id === 'dancefloor').spawns[0];
    g.testHook('teleport', { x: sp.x, z: sp.z + 5, yaw: 0 });
  });
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0;
    const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < 10000) requestAnimationFrame(tick); else res(n / ((performance.now() - t0) / 1000)); };
    requestAnimationFrame(tick);
  }));
  console.log(q, fps.toFixed(1), 'fps');
  await page.close();
}
await b.close();
server.kill();
