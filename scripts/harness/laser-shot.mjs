// Drinks Last Orders on the dance floor and screenshots the third-person spin while the beam is firing.
//   SP=<out dir> [QUERY='&q=low'] [TAG=-name] node scripts/harness/laser-shot.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
const SP = process.env.SP;
const server = spawn('node', ['scripts/serve.mjs', String(process.env.PORT || 8090)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const base = '/opt/pw-browsers';
const exe = readdirSync(base).filter((d) => d.startsWith('chromium-')).map((d) => readdirSync(`${base}/${d}`).filter((x) => x.startsWith('chrome-linux')).map((x) => `${base}/${d}/${x}/chrome`)[0])[0];
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errs.push(m.text()));
await page.goto(`http://localhost:${process.env.PORT || 8090}/?test` + (process.env.QUERY || '&q=low'));
await page.waitForFunction(() => window.__game && window.__game.getState().player, null, { timeout: 90000 });
await page.evaluate(() => {
  const g = window.__game, w = g.getWorld(), S = g.getState();
  g.testHook('play');
  let best = null;
  for (const e of S.enemies) for (const d of [3.5, 5, 7]) for (let k = 0; k < 8; k++) {
    const x = e.x + Math.cos(k * Math.PI / 4) * d, z = e.z + Math.sin(k * Math.PI / 4) * d;
    const a = w.areaAt(x, z);
    if (!a || a.id !== 'dancefloor' || w.isSolidAt(x, z) || S.enemies.some((o) => Math.hypot(o.x - x, o.z - z) < 3)) continue;
    const n = S.enemies.filter((o) => Math.hypot(o.x - x, o.z - z) < 26 && w.los(x, z, o.x, o.z)).length;
    if (!best || n > best.n) best = { x, z, n };
  }
  g.testHook('teleport', best);
  S.banner = null;
  g.testHook('drink', 'lastorders');
});
await page.waitForFunction(() => { const s = window.__game.getState(); return s.laser && s.laser.beam && s.camK > 0.95; }, null, { timeout: 120000, polling: 50 });
for (let i = 0; i < 3; i++) {
  await page.screenshot({ path: `${SP}/laser${process.env.TAG || ''}-${i}.png` });
  await page.waitForTimeout(500);
}
console.log('errors:', errs.length ? errs : 'none');
await b.close(); server.kill();
