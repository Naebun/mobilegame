// Screenshots a page from this repo in headless Chromium with software WebGL, for checking 3D and HUD work.
//   node scripts/shot.mjs <path-from-repo-root> <out.png> [--w 390] [--h 844] [--dpr 1] [--wait 1500] [--eval "js to run in the page first"]
// Prints console errors and page errors. Exits 1 if there were any.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [, , pagePath, out, ...rest] = process.argv;
if (!pagePath || !out) {
  console.error('usage: node scripts/shot.mjs <path> <out.png> [--w N] [--h N] [--dpr N] [--wait ms] [--eval js]');
  process.exit(2);
}
const opt = Object.fromEntries(rest.reduce((a, v, i) => (v.startsWith('--') ? [...a, [v.slice(2), rest[i + 1]]] : a), []));
const port = 8100 + Math.floor(Math.random() * 800);
const server = spawn('node', ['scripts/serve.mjs', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const chromiumPath = process.env.CHROMIUM_PATH
  || readdirSync('/opt/pw-browsers').filter((d) => d.startsWith('chromium-')).map((d) => {
    const base = `/opt/pw-browsers/${d}`;
    return readdirSync(base).filter((x) => x.startsWith('chrome-linux')).map((x) => `${base}/${x}/chrome`)[0];
  })[0];

const errors = [];
const browser = await chromium.launch({
  executablePath: chromiumPath,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const ctx = await browser.newContext({
    viewport: { width: Number(opt.w || 390), height: Number(opt.h || 844) },
    deviceScaleFactor: Number(opt.dpr || 1),
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|status of 404/.test(m.text())) errors.push(`console: ${m.text()}`);
    else if (m.type() === 'log' && opt.logs) console.log(`log: ${m.text()}`);
  });
  await page.goto(`http://localhost:${port}/${pagePath.replace(/^\//, '')}`);
  await page.waitForTimeout(Number(opt.wait || 1500));
  if (opt.eval) {
    const result = await page.evaluate(opt.eval);
    if (result !== undefined) console.log('eval:', JSON.stringify(result));
    await page.waitForTimeout(Number(opt.wait2 || 600));
  }
  await page.screenshot({ path: out });
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`ok ${out}`);
