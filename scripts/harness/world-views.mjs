// Screenshots a level from chosen tile positions with every door open: node scripts/harness/world-views.mjs <level> <outdir> "name:x,z,yaw[,pitch]" ... (Q=low|medium|high)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
const [, , level, out, ...views] = process.argv;
const server = spawn('node', ['scripts/serve.mjs', String(process.env.PORT || 8093)], { stdio: 'ignore', cwd: process.cwd() });
await new Promise((r) => setTimeout(r, 700));
const base = '/opt/pw-browsers';
const exe = readdirSync(base).filter((d) => d.startsWith('chromium-')).map((d) => readdirSync(`${base}/${d}`).filter((x) => x.startsWith('chrome-linux')).map((x) => `${base}/${d}/${x}/chrome`)[0])[0];
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errs.push(m.text()));
await page.goto(`http://localhost:${process.env.PORT || 8093}/scripts/harness/world-view.html?level=${level}&q=${process.env.Q || 'high'}`);
await page.waitForTimeout(3500);
await page.evaluate(() => window.openDoors(['d1', 'd2', 'd3', 'd4', 'd5', 'd6']));
for (const v of views) {
  const [name, rest] = v.split(':');
  const [x, z, yaw, pitch] = rest.split(',').map(Number);
  await page.evaluate(([x, z, yaw, pitch]) => window.cam(x, z, yaw, pitch || 0, 85), [x, z, yaw, pitch]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
}
console.log('errors:', errs.length ? errs : 'none');
await b.close(); server.kill();
