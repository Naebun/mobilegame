// Headless robustness check for src/hud.js and src/screens.js. A recording fake 2D context stands in for the canvas.
// Run: node scripts/harness/ui-check.mjs
import assert from 'node:assert/strict';
import { layout, drawPlayHud } from '../../src/hud.js';
import { buttons, drawTitle, drawControls, drawIntro, drawDead, drawComplete, drawVoicemail } from '../../src/screens.js';

let calls = 0;
function fakeCtx() {
  const grad = { addColorStop() {} };
  const target = {
    measureText: (s) => ({ width: String(s).length * 6.5 }),
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return (...a) => { calls++; return a; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

const views = [
  { w: 320, h: 480, dpr: 2, safe: { top: 0, bottom: 0 } },
  { w: 360, h: 640, dpr: 3, safe: { top: 0, bottom: 0 } },
  { w: 390, h: 844, dpr: 3, safe: { top: 47, bottom: 34 } },
  { w: 430, h: 932, dpr: 3, safe: { top: 47, bottom: 34 } },
  { w: 600, h: 1200, dpr: 1, safe: { top: 0, bottom: 0 } },
  { w: 360, h: 640, dpr: 1 }, // safe missing altogether
];

const long = 'WWWWWWWWWW '.repeat(60);
const huge = 1e21;
const hudStates = [
  {},
  { weapon: null, weapons: [], boss: null, toast: null, banner: null, damageDirs: [], move: null, look: null },
  { health: -50, maxHealth: 0, hurt: 5, weapon: { clip: -3, clipSize: 0, reload: 2 }, hitMarker: -1 },
  { health: huge, maxHealth: huge, hurt: NaN, score: huge, timeSec: huge, enemiesLeft: huge },
  {
    health: 10, maxHealth: 100, hurt: 1,
    damageDirs: Array.from({ length: 40 }, (_, i) => ({ bearing: i * 7, t: i / 20 - 0.2 })).concat([null, {}]),
    weapon: { id: 'x', name: long, clip: huge, clipSize: huge, reload: 0.5 },
    weapons: Array.from({ length: 12 }, (_, i) => ({ id: i % 2 ? 'smg' : 'unknown', name: long, owned: i % 3 === 0, active: i === 4 })),
    hitMarker: 1, headshot: true,
    toast: { text: long, t: 99 }, banner: { title: long, sub: long, t: 0, max: 0 },
    objective: long, areaName: long, enemiesLeft: 1,
    boss: { name: long, hp: huge, maxHp: 0 },
    debugMode: true,
    move: { active: true, nx: huge, ny: -huge }, look: { active: true, nx: NaN, ny: 9 }, firing: true,
  },
  { toast: { text: '', t: 1 }, banner: { title: '', sub: '', t: 1, max: 1 }, objective: null, areaName: undefined, enemiesLeft: 0 },
];

const inside = (r, v) => r.x >= 0 && r.y >= 0 && r.x + r.w <= v.w && r.y + r.h <= v.h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const v of views) {
  const L = layout(v);
  const names = ['moveBox', 'lookBox', 'reloadBtn', 'swapBtn'];
  for (const n of names) assert.ok(inside(L[n], v), `${n} outside ${v.w}x${v.h}`);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) assert.ok(!overlap(L[names[i]], L[names[j]]), `${names[i]} overlaps ${names[j]} at ${v.w}x${v.h}`);
  }
  for (const [hit, base] of [['moveHit', 'moveBox'], ['lookHit', 'lookBox']]) {
    assert.equal(L[hit].w, L[base].w + 48);
    assert.equal(L[hit].x, L[base].x - 24);
  }
  for (const [hit, base] of [['reloadHit', 'reloadBtn'], ['swapHit', 'swapBtn']]) {
    assert.equal(L[hit].w, L[base].w + 20);
    assert.equal(L[hit].y, L[base].y - 10);
  }
  const bottom = v.h - ((v.safe && v.safe.bottom) || 0);
  assert.ok(L.reloadBtn.y + L.reloadBtn.h <= bottom, 'buttons run into the bottom safe area');
  assert.ok(layout(v) === L, 'layout should be cached for identical input');

  const ctx = fakeCtx();
  for (const h of hudStates) drawPlayHud(ctx, v, h);

  const bstates = [undefined, null, {}, { t: -1 }, { t: 0.5 }, { t: 5, debugMode: true }, { t: huge }, { t: NaN }, { t: 3, hasNext: true }];
  for (const mode of ['title', 'controls', 'dead', 'complete', 'voicemail', 'bogus']) {
    for (const s of bstates) {
      const list = buttons(mode, v, s);
      assert.ok(Array.isArray(list));
      for (const b of list) {
        assert.ok(b.id && b.label, 'button needs id and label');
        assert.ok(inside(b, v), `button ${b.id} (${mode}) outside ${v.w}x${v.h}`);
      }
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!overlap(list[i], list[j]), `buttons overlap in ${mode}`);
    }
  }
  assert.deepEqual(buttons('title', v, { t: 0 }).map((b) => b.id), ['new', 'debug']);
  assert.deepEqual(buttons('controls', v, { t: 0 }).map((b) => b.id), ['start', 'back']);
  assert.deepEqual(buttons('dead', v, { t: 0.9 }).map((b) => b.id), []);
  assert.deepEqual(buttons('dead', v, { t: 0.91 }).map((b) => b.id), ['retry', 'menu']);
  assert.deepEqual(buttons('complete', v, { t: 1 }).map((b) => b.id), []);
  assert.deepEqual(buttons('complete', v, { t: 1.01 }).map((b) => b.id), ['again', 'menu']);
  assert.deepEqual(buttons('complete', v, { t: 1.01, hasNext: true }).map((b) => b.id), ['next', 'again', 'menu']);
  assert.deepEqual(buttons('voicemail', v, { t: 0.8 }).map((b) => b.id), []);
  assert.deepEqual(buttons('voicemail', v, { t: 0.81 }).map((b) => b.id), ['continue']);
  assert.equal(buttons('title', v, { debugMode: true })[1].label, 'DEBUG MODE: ON');
  assert.equal(buttons('title', v, { debugMode: false })[1].label, 'DEBUG MODE: OFF');

  const ts = [undefined, null, {}, { t: 0 }, { t: 3.3, debugMode: true, best: huge }, { t: huge }, { t: NaN, best: NaN }];
  for (const s of ts) {
    drawTitle(ctx, v, s);
    drawControls(ctx, v, s);
    drawIntro(ctx, v, s);
    drawDead(ctx, v, s);
    drawComplete(ctx, v, s);
    drawVoicemail(ctx, v, s);
  }
  drawVoicemail(ctx, v, { t: 4, mail: { from: long, lines: [long, '', null, 'Do not shake anything.', long, long, long] } });
  drawVoicemail(ctx, v, { t: 0.2, mail: { from: 'CHERYL (AGENT)', lines: 'not an array' } });
  drawComplete(ctx, v, { t: 3, hasNext: true, title: long, line: long, sub: long, score: 5, kills: 2, totalEnemies: 2 });
  const lv = { number: 1, name: long, sub: long, line: long, clock: [30, 90] };
  drawIntro(ctx, v, { t: 2, level: lv });
  drawIntro(ctx, v, { t: 2, level: { number: huge, name: '', clock: null } });
  drawIntro(ctx, v, { t: 2, level: { name: 'X', clock: 90 } });
  drawDead(ctx, v, { t: 3, line: long, score: huge, best: -5, newBest: true, debugMode: true, levelName: long });
  drawComplete(ctx, v, { t: 3, score: huge, best: 0, newBest: true, timeSec: huge, kills: huge, totalEnemies: 0, debugMode: true });
  drawComplete(ctx, v, { t: 3, score: -1, timeSec: -1, kills: 3, totalEnemies: 3 });
}

console.log(`ui-check ok: ${views.length} views, ${calls} canvas calls recorded`);
