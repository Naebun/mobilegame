// Screenshots the real game (full render pipeline, HUD, robots) from chosen tile positions:
//   node scripts/harness/game-views.mjs <level> <outdir> "name:x,z,yaw[,pitch]" ...        (tile coordinates, yaw in radians)
// Doors are opened and robots left asleep unless WAKE=1. TORCH=1 fits the torch and switches it on (TORCH=0 fitted but off). Q=low|medium|high (default medium), W and H set the viewport.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
const [, , level, out, ...views] = process.argv;
const PORT = process.env.PORT || '8094';
const server = spawn('node', ['scripts/serve.mjs', PORT], { stdio: 'ignore', cwd: process.cwd() });
await new Promise((r) => setTimeout(r, 700));
const base = '/opt/pw-browsers';
const exe = readdirSync(base).filter((d) => d.startsWith('chromium-')).map((d) => readdirSync(`${base}/${d}`).filter((x) => x.startsWith('chrome-linux')).map((x) => `${base}/${d}/${x}/chrome`)[0])[0];
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await b.newContext({ viewport: { width: Number(process.env.W || 390), height: Number(process.env.H || 844) }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })).newPage();
page.setDefaultTimeout(Number(process.env.TIMEOUT || 30000)); // a busy machine needs longer
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errs.push(m.text()));
await page.goto(`http://localhost:${PORT}/?test&q=${process.env.Q || 'medium'}${process.env.EXTRA || ''}`);
await page.waitForFunction(() => window.__game && window.__game.getState().player, null, { timeout: 90000 });
await page.waitForFunction(() => ['applied', 'failed', 'off'].includes(window.__game.testHook('baked').state), null, { timeout: 90000 }); // baked textures swapped in (or off: ?baked=0)
await page.evaluate((n) => window.__game.testHook('level', n), Number(level));
await page.waitForFunction((n) => window.__game.getWorld().level === n, Number(level), { timeout: 90000 });
await page.evaluate((w) => { window.__weapon = w; }, process.env.WEAPON || '');
if (process.env.TORCH) await page.evaluate((on) => window.__game.testHook('torch', { attached: true, on: on !== '0' }), process.env.TORCH);
await page.evaluate(() => {
  const g = window.__game;
  for (const d of g.getWorld().doors) g.getWorld().setDoorOpen(d.id, true);
  g.testHook('giveWeapons');
  const S = g.getState();
  S.player.health = S.player.maxHealth = 1e6; // never die while looking
  if (window.__weapon) S.player.weapon = window.__weapon;
  if (!window.__wake) for (const e of S.enemies) e.wakeDelay = -1;
});
for (const v of views) {
  const [name, rest] = v.split(':');
  const [x, z, yaw, pitch] = rest.split(',').map(Number);
  await page.evaluate(([x, z, yaw, pitch]) => {
    const g = window.__game;
    g.testHook('teleport', { x: (x + 0.5) * 2, z: (z + 0.5) * 2, yaw });
    const S = g.getState();
    S.player.pitch = pitch || 0;
    S.banner = null;
    S.toast = null;
  }, [x, z, yaw, pitch]);
  await page.waitForTimeout(Number(process.env.WAIT || 2200));
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
}
console.log('errors:', errs.length ? errs : 'none');
await b.close();
server.kill();
