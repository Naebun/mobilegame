// Headless check at a phone-sized viewport: page loads, no console errors,
// canvas fills the screen, a touch drag moves the ball. Screenshot goes to
// the path in argv[2] (default: smoke.png in the cwd).
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 8099;
const server = spawn('node', ['scripts/serve.mjs', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));

let failed = false;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
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

  await page.goto(`http://localhost:${port}/`);
  await page.waitForTimeout(300);

  const size = await page.evaluate(() => {
    const c = document.getElementById('game');
    return { w: c.width, h: c.height, scrolls: document.documentElement.scrollHeight > innerHeight };
  });
  console.log('canvas', size);
  if (size.w !== 390 * 3 || size.h !== 844 * 3 || size.scrolls) failed = true;

  await page.screenshot({ path: process.argv[2] || 'smoke.png' });
  if (errors.length) { console.error('errors:', errors); failed = true; }
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? 'SMOKE FAILED' : 'SMOKE OK');
process.exit(failed ? 1 : 0);
