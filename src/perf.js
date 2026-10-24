// Performance readout for playtests. Off by default and absent unless asked for: `?perf` in the URL, or the P key on a
// computer. game3d.js holds `null` until then, so the cost with it off is one null check per frame.
//
// It is a DOM panel, not part of the 2D HUD canvas, so it never moves a HUD element, costs no canvas redraw, and its text
// is only rewritten four times a second. Tapping it copies a one-line summary (see summary()); window.__perf holds the
// same numbers while it is on.
//
// What it measures: frame time is the gap between successive render() calls, so it is the real frame cadence, vsync cap
// and GPU stalls included. `js` is how long the render call itself took on the CPU. On a phone, a frame time well above js
// means the GPU is the limit; the two close together means the CPU (or JS) is. Draw calls and triangles come from
// renderer.info and cover every pass in the frame (scene, weapon, and the post-processing passes).

const RING = 240; // frames in the rolling window: about 4 seconds at 60 fps
const REFRESH = 250; // ms between text updates
const SCOPE_MIN = 8; // frames needed before the 1 percent figure means anything

const FONT = '600 10.5px/1.35 ui-monospace, Menlo, Consolas, monospace';

const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : '-');
const k0 = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

// Pure stats over a window of frame times (ms), so the maths can be checked without a browser.
export function frameStats(ms) {
  const n = ms.length;
  if (!n) return { n: 0, avgMs: NaN, fps: NaN, p99Ms: NaN, lowFps: NaN, worstMs: NaN };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += ms[i];
  const sorted = Array.from(ms).sort((a, b) => a - b);
  const avgMs = sum / n;
  // "1 percent low": the frame time that 99 percent of frames beat, and the rate that equals
  const p99Ms = n >= SCOPE_MIN ? percentile(sorted, 0.99) : sorted[n - 1];
  return { n, avgMs, fps: 1000 / avgMs, p99Ms, lowFps: 1000 / p99Ms, worstMs: sorted[n - 1] };
}

/**
 * @param {object} o
 * @param {import('three').WebGLRenderer} o.renderer
 * @param {() => import('three').Scene[]} o.scenes  the scenes drawn each frame (for counting lights)
 * @param {() => object} o.info  { tier, fixed, pixelRatio, level, area } from the game, read at refresh time only
 */
export function createPerf({ renderer, scenes, info }) {
  if (typeof document === 'undefined') return null;
  const ring = new Float32Array(RING);
  let head = 0;
  let count = 0;
  let last = 0;
  let renderStart = 0;
  let jsMs = 0;
  let jsAvg = 0;
  let nextRefresh = 0;
  let lightsAt = 0;
  let lights = { all: 0, point: 0 };
  let firstTier = null;
  let tierChanges = 0;
  let lastTier = null;

  const el = document.createElement('div');
  el.id = 'perf';
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', 'Performance readout. Tap to copy a summary.');
  el.style.cssText = [
    'position:fixed', 'z-index:5', 'box-sizing:border-box', 'padding:3px 6px', 'white-space:pre', 'pointer-events:auto',
    'background:rgba(0,0,0,0.58)', 'color:#9dff9d', `font:${FONT}`, 'border-radius:4px', 'cursor:pointer',
    '-webkit-user-select:none', 'user-select:none', 'touch-action:manipulation', 'max-width:calc(100vw - 8px)',
  ].join(';');
  const text = document.createElement('div');
  const status = document.createElement('div');
  status.style.cssText = 'color:#ffd27d';
  el.append(text, status);
  document.body.appendChild(el);

  // the fallback when no copy route works: the summary in a box the player can long-press and copy
  let area = null;
  const showManual = (s) => {
    if (!area) {
      area = document.createElement('textarea');
      area.readOnly = true;
      area.rows = 3;
      area.style.cssText = `display:block;width:210px;max-width:calc(100vw - 20px);margin-top:3px;font:${FONT};background:#111;color:#9dff9d;border:1px solid #444;-webkit-user-select:text;user-select:text`;
      area.addEventListener('pointerdown', (e) => e.stopPropagation());
      area.addEventListener('click', (e) => e.stopPropagation());
      el.appendChild(area);
    }
    area.value = s;
    area.style.display = 'block';
    try { area.focus(); area.select(); area.setSelectionRange(0, s.length); } catch { /* the box is still there to long-press */ }
  };

  const copyViaSelection = (s) => {
    const t = document.createElement('textarea');
    t.value = s;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;left:0;top:0;opacity:0;font-size:16px'; // 16px: iOS zooms smaller inputs on focus
    document.body.appendChild(t);
    let done = false;
    try {
      t.focus();
      t.select();
      t.setSelectionRange(0, s.length);
      done = document.execCommand('copy');
    } catch { done = false; }
    t.remove();
    return done;
  };

  let statusTimer = 0;
  const say = (msg, ms = 2500) => {
    status.textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ''; }, ms);
  };

  const P = {
    el,
    // latest numbers; also exposed as window.__perf by the caller
    fps: NaN, avgMs: NaN, p99Ms: NaN, lowFps: NaN, worstMs: NaN, jsMs: NaN,
    tier: '', tierFixed: false, tierChanged: false, pixelRatio: NaN, triangles: 0, calls: 0, lights: 0, pointLights: 0,
    geometries: 0, textures: 0, width: 0, height: 0, orientation: '', dpr: 1, bufferW: 0, bufferH: 0, level: 0, area: '',
    frames: 0,
    summary() { return summaryOf(P); },
    copy: null,
  };

  function countLights() {
    let all = 0;
    let point = 0;
    for (const sc of scenes()) {
      sc.traverse((o) => {
        if (!o.isLight || !o.visible) return;
        all++;
        if (o.isPointLight || o.isSpotLight) point++;
      });
    }
    lights = { all, point };
  }

  function refresh(now) {
    const win = count < RING ? ring.subarray(0, count) : ring;
    const st = frameStats(win);
    const i = info();
    const ri = renderer.info;
    if (now - lightsAt > 1000) { countLights(); lightsAt = now; }
    const buf = renderer.getDrawingBufferSize(_v2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (firstTier === null) firstTier = lastTier = i.tier;
    if (i.tier !== lastTier) { tierChanges++; lastTier = i.tier; }
    Object.assign(P, {
      fps: st.fps, avgMs: st.avgMs, p99Ms: st.p99Ms, lowFps: st.lowFps, worstMs: st.worstMs, jsMs: jsAvg,
      tier: i.tier, tierFixed: !!i.fixed, tierChanged: tierChanges > 0, pixelRatio: i.pixelRatio,
      triangles: ri.render.triangles, calls: ri.render.calls, lights: lights.all, pointLights: lights.point,
      geometries: ri.memory.geometries, textures: ri.memory.textures,
      width: w, height: h, orientation: w > h ? 'landscape' : 'portrait', dpr: window.devicePixelRatio || 1,
      bufferW: buf.x, bufferH: buf.y, level: i.level, area: i.area || '', frames: st.n,
    });
    text.textContent = [
      `${f1(P.fps)} fps  ${f1(P.avgMs)} ms  js ${f1(P.jsMs)}`,
      `1% low ${f1(P.lowFps)} fps (${f1(P.p99Ms)} ms)  max ${f1(P.worstMs)}`,
      `${P.tier}${P.tierFixed ? ' (fixed)' : P.tierChanged ? ` (auto, was ${firstTier})` : ''}  ratio ${(+P.pixelRatio).toFixed(2)}  buf ${P.bufferW}x${P.bufferH}`,
      `tris ${k0(P.triangles)}  calls ${P.calls}  lights ${P.lights} (pt ${P.pointLights})`,
      `${w}x${h} ${P.orientation}  L${P.level} ${P.area}`,
    ].join('\n');
  }
  const _v2 = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; }, floor() { this.x = Math.floor(this.x); this.y = Math.floor(this.y); return this; } }; // stands in for a Vector2

  // keep the panel clear of the HUD: top-left, below the health bar, score and objective lines, inside the notch's inset
  function place(view) {
    const top = (view && view.safe ? view.safe.top : 0) + (window.innerWidth > window.innerHeight ? 58 : 152); // portrait: under the weapon strip's row and the area, objective and status lines
    const left = (view && view.safe ? view.safe.left : 0) + 4;
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }

  async function copy() {
    const s = summaryOf(P);
    P.lastCopied = s;
    if (area) area.style.display = 'none';
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(s);
        say('copied');
        return true;
      }
    } catch { /* refused (permissions, or not a secure page): try the older route */ }
    if (copyViaSelection(s)) { say('copied'); return true; }
    say('copy blocked: press and hold the box, then copy', 8000);
    showManual(s);
    return false;
  }
  P.copy = copy;
  el.addEventListener('click', (e) => { e.stopPropagation(); copy(); });
  // a press on the panel must not reach the game as a touch (the engine listens on the canvas, so this is belt and braces)
  el.addEventListener('pointerdown', (e) => e.stopPropagation());

  // call at the very start of render()
  P.begin = (now) => {
    if (last) {
      ring[head] = now - last;
      head = (head + 1) % RING;
      if (count < RING) count++;
    }
    last = now;
    renderStart = now;
  };
  // call after the frame has been submitted
  P.end = (now, view) => {
    jsMs = now - renderStart;
    jsAvg += (jsMs - jsAvg) * 0.05;
    if (now >= nextRefresh) {
      nextRefresh = now + REFRESH;
      refresh(now);
      place(view);
    }
  };
  P.destroy = () => { clearTimeout(statusTimer); el.remove(); };
  P.reset = () => { head = count = 0; last = 0; };
  return P;
}

export function summaryOf(p) {
  const tier = `${p.tier}${p.tierFixed ? ' fixed' : p.tierChanged ? ' auto-dropped' : ''}`;
  const ua = typeof navigator !== 'undefined' ? ((/\(([^)]*)\)/.exec(navigator.userAgent || '') || [])[1] || '').slice(0, 48) : '';
  return [
    `perf L${p.level} ${p.area}`.trim(),
    `${f1(p.fps)} fps avg (${f1(p.avgMs)} ms)`,
    `1% low ${f1(p.lowFps)} fps (${f1(p.p99Ms)} ms), max ${f1(p.worstMs)} ms`,
    `js ${f1(p.jsMs)} ms`,
    `tier ${tier}`,
    `ratio ${(+p.pixelRatio).toFixed(2)}`,
    `${p.triangles} tris`,
    `${p.calls} calls`,
    `${p.lights} lights (${p.pointLights} point/spot)`,
    `${p.width}x${p.height} ${p.orientation} dpr ${(+p.dpr).toFixed(2)} buf ${p.bufferW}x${p.bufferH}`,
    ua,
  ].filter(Boolean).join(' | ');
}
