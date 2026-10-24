// Screenshots the first spawn of each area from its doorway, at phone size, for reviewing the level's look.
// SP=<out dir> [AREAS=cloakroom,bar] node scripts/harness/level-tour.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
const SP = process.env.SP;
const PORT = process.env.PORT || '8092';
const server = spawn('node', ['scripts/serve.mjs', PORT], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const base = '/opt/pw-browsers';
const exe = readdirSync(base).filter((d) => d.startsWith('chromium-')).map((d) => readdirSync(`${base}/${d}`).filter((x) => x.startsWith('chrome-linux')).map((x) => `${base}/${d}/${x}/chrome`)[0])[0];
const b = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await b.newContext({ viewport: { width: Number(process.env.W || 390), height: Number(process.env.H || 844) }, deviceScaleFactor: 1, hasTouch: true, isMobile: true })).newPage();
page.setDefaultTimeout(Number(process.env.TIMEOUT || 30000)); // a busy machine needs longer
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errs.push(m.text()));
await page.goto(`http://localhost:${PORT}/?test` + (process.env.QUERY || ''));
await page.waitForFunction(() => window.__game && window.__game.getState().player, null, { timeout: 60000 });
await page.waitForFunction(() => ['applied', 'failed', 'off'].includes(window.__game.testHook('baked').state), null, { timeout: 90000 }); // baked textures swapped in (or off: ?baked=0)
await page.evaluate(() => window.__game.testHook('play'));
const shots = (process.env.AREAS || 'cloakroom,dancefloor,bar,vip,backstage').split(',');
for (const id of shots) {
  await page.evaluate((id) => {
    const g = window.__game, w = g.getWorld(), S = g.getState();
    const a = w.areas.find((x) => x.id === id);
    const sp = a.spawns[0];
    let placed = false;
    for (const d of [7, 6, 5, 4, 3]) {
      const fx = -Math.sin(sp.yaw), fz = -Math.cos(sp.yaw);
      const x = sp.x + fx * d, z = sp.z + fz * d;
      if (!w.isSolidAt(x, z) && w.los(x, z, sp.x, sp.z)) { g.testHook('teleport', { x, z, yaw: sp.yaw + Math.PI }); placed = true; break; }
    }
    if (!placed) g.testHook('teleport', { x: sp.x, z: sp.z + 3, yaw: 0 });
    S.player.pitch = 0;
    S.banner = null;
  }, id);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SP}/tour${process.env.TAG || ''}-${id}.png` });
  console.log('shot', id);
}
console.log('errors:', errs.length ? errs : 'none');
await b.close(); server.kill();
