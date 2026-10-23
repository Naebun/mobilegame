// The performance readout (src/perf.js) in a real headless browser, portrait and landscape:
//   PORT=8201 node scripts/harness/perf-check.mjs [outdir for screenshots]
// Checks: nothing exists without ?perf; with it the panel and window.__perf appear and carry sane numbers; the P key
// switches it on and off; it sits clear of every HUD rectangle in both orientations; a tap copies the summary and the
// fallbacks work when the clipboard is refused; the hook costs next to nothing per frame.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readdirSync, mkdirSync } from 'node:fs';
import { frameStats, percentile, summaryOf } from '../../src/perf.js';

const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT || 8097);
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) failed++; };

// the arithmetic, without a browser
{
  const flat = new Float32Array(100).fill(16.6);
  const s = frameStats(flat);
  ok(Math.abs(s.fps - 1000 / 16.6) < 0.01 && Math.abs(s.p99Ms - 16.6) < 1e-4 && Math.abs(s.worstMs - 16.6) < 1e-4, 'frameStats: a steady 16.6 ms is 60 fps with no spikes');
  const spiky = new Float32Array(200).fill(10);
  spiky[7] = 80;
  spiky[9] = 90;
  spiky[100] = 120;
  const t = frameStats(spiky);
  ok(t.worstMs === 120 && t.p99Ms >= 80 && t.p99Ms <= 120, `frameStats: the 1% low sees the spikes (p99 ${t.p99Ms} ms, worst ${t.worstMs} ms)`);
  ok(frameStats([]).n === 0 && Number.isNaN(frameStats([]).fps), 'frameStats: an empty window is NaN, not a crash');
  ok(percentile([1, 2, 3, 4], 0.5) === 2 && percentile([5], 0.99) === 5, 'percentile: nearest rank');
  ok(summaryOf({ level: 2, area: 'plague', fps: 31.2, avgMs: 32, lowFps: 20, p99Ms: 50, worstMs: 90, jsMs: 4, tier: 'medium', tierFixed: false, tierChanged: true, pixelRatio: 1.5, triangles: 99000, calls: 40, lights: 7, pointLights: 5, width: 390, height: 844, orientation: 'portrait', dpr: 3, bufferW: 585, bufferH: 1266 }).split('|').length >= 10, 'summaryOf: one line, fields separated by |');
}

const server = spawn('node', ['scripts/serve.mjs', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const base = '/opt/pw-browsers';
const exe = process.env.CHROMIUM_PATH || readdirSync(base).filter((d) => d.startsWith('chromium-')).map((d) => readdirSync(`${base}/${d}`).filter((x) => x.startsWith('chrome-linux')).map((x) => `${base}/${d}/${x}/chrome`)[0])[0];
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  for (const [W, H, name] of [[390, 844, 'portrait'], [844, 390, 'landscape']]) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, permissions: [] });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errs.push(m.text()));
    const ready = () => page.waitForFunction(() => window.__game && window.__game.getState().player, null, { timeout: 90000 });

    // off: nothing in the page
    await page.goto(`http://localhost:${port}/?test&q=low&level=2`);
    await ready();
    await page.evaluate(() => { window.__game.testHook('play'); window.__game.getState().player.health = 1e6; });
    await page.waitForTimeout(800);
    ok(await page.evaluate(() => !document.getElementById('perf') && window.__perf === undefined), `${name}: without ?perf there is no panel and no window.__perf`);
    // the P key switches it on, and off again
    await page.keyboard.press('p');
    await page.waitForFunction(() => !!document.getElementById('perf') && !!window.__perf, null, { timeout: 15000 });
    ok(true, `${name}: the P key switches it on`);
    await page.keyboard.press('p');
    await page.waitForFunction(() => !document.getElementById('perf') && window.__perf === undefined, null, { timeout: 15000 });
    ok(true, `${name}: P again removes the panel and window.__perf`);

    // on
    await page.goto(`http://localhost:${port}/?test&perf&q=low&level=2`);
    await ready();
    await page.evaluate(() => { const g = window.__game; g.testHook('play'); g.getState().player.health = 1e6; g.testHook('torch', { attached: true, on: true }); });
    await page.waitForFunction(() => window.__perf && window.__perf.frames >= 6 && window.__perf.triangles > 0, null, { timeout: 90000 });
    const P = await page.evaluate(() => { const p = window.__perf; return { fps: p.fps, avgMs: p.avgMs, p99Ms: p.p99Ms, worstMs: p.worstMs, jsMs: p.jsMs, tier: p.tier, tierFixed: p.tierFixed, ratio: p.pixelRatio, tris: p.triangles, calls: p.calls, lights: p.lights, point: p.pointLights, w: p.width, h: p.height, o: p.orientation, bw: p.bufferW, bh: p.bufferH, level: p.level, area: p.area, summary: p.summary() }; });
    console.log(`  ${name}:`, P.summary);
    ok(P.fps > 0 && P.avgMs > 0 && P.p99Ms >= P.avgMs * 0.5 && P.worstMs >= P.p99Ms - 1e-6, `${name}: frame numbers are sane (${P.fps.toFixed(1)} fps, avg ${P.avgMs.toFixed(0)} ms, 1% low ${P.p99Ms.toFixed(0)} ms, max ${P.worstMs.toFixed(0)} ms)`);
    ok(P.tier === 'low' && P.tierFixed && P.ratio >= 1, `${name}: tier low (fixed by ?q), ratio ${P.ratio}`);
    ok(P.tris > 1000 && P.calls > 5 && P.lights >= 3 && P.point >= 1, `${name}: ${P.tris} triangles, ${P.calls} draw calls, ${P.lights} lights (${P.point} point or spot)`);
    ok(P.w === W && P.h === H && P.o === name && P.bw >= W && P.bh >= H, `${name}: viewport ${P.w}x${P.h} ${P.o}, buffer ${P.bw}x${P.bh}`);
    ok(P.level === 2 && typeof P.area === 'string' && P.area.length > 0, `${name}: level ${P.level}, area ${P.area}`);
    ok(P.jsMs >= 0 && P.jsMs < 5000, `${name}: render call takes ${P.jsMs.toFixed(1)} ms of JS`);

    // clear of the HUD: the panel's box against every HUD rectangle and the play boxes
    await page.evaluate(() => window.__game.testHook('mobile', true));
    await page.waitForTimeout(600);
    const geo = await page.evaluate(() => {
      const r = document.getElementById('perf').getBoundingClientRect();
      const L = window.__game.testHook('layout');
      return { panel: { x: r.x, y: r.y, w: r.width, h: r.height }, boxes: ['moveBox', 'lookBox', 'reloadBtn', 'swapBtn'].map((k) => [k, L[k]]) };
    });
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    ok(geo.panel.x >= 0 && geo.panel.y >= 0 && geo.panel.x + geo.panel.w <= W && geo.panel.y + geo.panel.h <= H, `${name}: the panel is on screen (${JSON.stringify(geo.panel)})`);
    ok(geo.boxes.every(([k, b]) => !hit(geo.panel, b)), `${name}: the panel overlaps no control box or button`);
    // the HUD's own top strip: health, score (to y 52) and the weapon row (right). The panel starts below the score line.
    ok(geo.panel.y > 52, `${name}: the panel starts below the health and score line (y ${geo.panel.y})`);
    if (out) await page.screenshot({ path: `${out}/perf-${name}.png` });

    // a tap on the panel does not reach the game as a touch
    const touchesBefore = await page.evaluate(() => window.__game.getState().shots);
    // copy: a granted clipboard, then a refused one with the older route, then neither
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => { document.getElementById('perf').click(); });
    await page.waitForFunction(() => /copied/.test(document.getElementById('perf').innerText), null, { timeout: 5000 }).catch(() => {});
    const copied = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch { return null; } });
    ok(copied === null || /^perf L2/.test(copied), `${name}: the tap copies the summary (${copied === null ? 'clipboard read not allowed here, so the route was not read back' : copied.slice(0, 40) + '...'})`);
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('refused')) }, configurable: true }); });
    const via = await page.evaluate(async () => {
      const orig = document.execCommand;
      let called = 0;
      document.execCommand = (c) => { called++; return c === 'copy'; };
      await window.__perf.copy();
      document.execCommand = orig;
      return { called, text: document.getElementById('perf').innerText };
    });
    ok(via.called === 1 && /copied/.test(via.text), `${name}: a refused clipboard falls back to a selection copy`);
    const manual = await page.evaluate(async () => {
      document.execCommand = () => false;
      await window.__perf.copy();
      const ta = document.querySelector('#perf textarea');
      return { text: document.getElementById('perf').innerText, box: !!ta && /^perf L2/.test(ta.value) && ta.style.display !== 'none' };
    });
    ok(manual.box && /press and hold/.test(manual.text), `${name}: with every copy route blocked the summary shows in a box to long-press`);
    ok((await page.evaluate(() => window.__game.getState().shots)) === touchesBefore, `${name}: copying fired nothing in the game`);

    // the cost of the hook itself, on a fake frame stream: begin and end only, without the text refresh
    const cost = await page.evaluate(() => {
      const p = window.__perf;
      const n = 20000;
      const t0 = performance.now();
      let t = 1e6;
      for (let i = 0; i < n; i++) { p.begin(t); t += 16.7; p.end(t - 16, { safe: { top: 0, left: 0 } }); }
      return (performance.now() - t0) / n * 1000; // microseconds, including the occasional refresh
    });
    ok(cost < 200, `${name}: the readout costs ${cost.toFixed(1)} us per frame on this machine`);
    ok(errs.length === 0, `${name}: no page errors ${errs.length ? JSON.stringify(errs) : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `${failed} FAILED` : 'all perf checks passed');
process.exit(failed ? 1 : 0);
