// Headless robustness check for src/hud.js and src/screens.js. A recording fake 2D context stands in for the canvas.
// Run: node scripts/harness/ui-check.mjs
import assert from 'node:assert/strict';
import { layout, drawPlayHud, stripCellAt, STRIP_MAX } from '../../src/hud.js';
import { buttons, drawTitle, drawControls, drawIntro, drawDead, drawComplete, drawVoicemail, drawSettings, drawSetlist, drawDifficulty } from '../../src/screens.js';

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
  // landscape: phones with the notch on a side, a small old phone, an iPad, a desktop window
  { w: 844, h: 390, dpr: 3, safe: { top: 0, bottom: 21, left: 47, right: 47 } },
  { w: 932, h: 430, dpr: 3, safe: { top: 0, bottom: 21, left: 59, right: 59 } },
  { w: 667, h: 375, dpr: 2, safe: { top: 0, bottom: 0, left: 0, right: 0 } },
  { w: 568, h: 320, dpr: 2 },
  { w: 1180, h: 820, dpr: 2, safe: { top: 24, bottom: 20, left: 0, right: 0 } },
  { w: 1366, h: 768, dpr: 1 },
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
    debugMode: true, difficulty: 'EXTRA HARD',
    move: { active: true, nx: huge, ny: -huge }, look: { active: true, nx: NaN, ny: 9 }, firing: true,
  },
  { difficulty: 'HARD', score: 123456, timeSec: 754 }, { difficulty: long, debugMode: true }, { difficulty: null }, { difficulty: 5 },
  { toast: { text: '', t: 1 }, banner: { title: '', sub: '', t: 1, max: 1 }, objective: null, areaName: undefined, enemiesLeft: 0 },
  // the prepared arsenal: eight weapons on the strip, a charge meter, upgrade chips and the ALT button, mobile and PC, odd values too
  {
    health: 80, maxHealth: 100, weapon: { id: 'beam', name: 'FEEDBACK BEAM', clip: 63.4, clipSize: 140, reload: null, meter: true },
    weapons: ['pistol', 'shotgun', 'smg', 'launcher', 'vinyl', 'beam', 'grenade', 'airhorn'].map((id, i) => ({ id, name: id, owned: true, active: i === 5 })),
    upgrades: { clip: 2, reload: 1, altfire: 1 }, alt: { cd: 0.4, secs: 1.3, name: 'TWEETER BURST' },
  },
  // PC mode with the slot numbers on the strip (a hidden weapon leaves a gap in the numbers), and odd slot values
  {
    compact: true, weapon: { id: 'launcher', name: 'REVERB LAUNCHER', clip: 3, clipSize: 6, reload: null },
    weapons: ['pistol', 'shotgun', 'smg', 'launcher', 'vinyl', 'grenade'].map((id) => ({ id, name: id, owned: id !== 'smg', active: id === 'launcher', slot: id === 'grenade' ? 7 : undefined })).map((w, i) => (i === 1 ? { ...w, slot: 2 } : i === 2 ? { ...w, slot: NaN } : i === 3 ? { ...w, slot: 1e9 } : i === 4 ? { ...w, slot: 'x' } : w)),
  },
  { compact: true, weapons: Array.from({ length: 9 }, (_, i) => ({ id: 'smg', owned: true, active: i === 0, slot: i + 1 })), upgrades: { clip: 1, reload: 1, altfire: 1 }, debugMode: true },
  {
    weapon: { id: 'smg', name: 'TWEETER SMG', clip: 0, clipSize: 42, reload: 0.3 }, weapons: [{ id: 'smg', owned: true, active: true }, { id: 'beam', owned: true }],
    upgrades: { clip: 1, reload: 0, altfire: 1 }, alt: { cd: 0, secs: 0 }, compact: true, debugMode: true,
  },
  { weapon: { id: 'beam', meter: true, clip: NaN, clipSize: 0 }, upgrades: { clip: NaN, reload: huge, altfire: -3 }, alt: { cd: NaN, secs: NaN }, weapons: Array.from({ length: 20 }, (_, i) => ({ id: i % 3 ? 'grenade' : 'airhorn', owned: !!(i % 2) })) },
  { upgrades: null, alt: null, weapon: { id: 'beam', meter: true, clip: huge, clipSize: huge, reload: 0.5 } },
];

const inside = (r, v) => r.x >= 0 && r.y >= 0 && r.x + r.w <= v.w && r.y + r.h <= v.h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const v of views) {
  const L = layout(v);
  const names = ['moveBox', 'lookBox', 'reloadBtn', 'swapBtn', 'altBtn'];
  for (const n of names) assert.ok(inside(L[n], v), `${n} outside ${v.w}x${v.h}`);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) assert.ok(!overlap(L[names[i]], L[names[j]]), `${names[i]} overlaps ${names[j]} at ${v.w}x${v.h}`);
  }
  for (const [hit, base] of [['moveHit', 'moveBox'], ['lookHit', 'lookBox']]) {
    assert.equal(L[hit].w, L[base].w + 48);
    assert.equal(L[hit].x, L[base].x - 24);
  }
  for (const [hit, base] of [['reloadHit', 'reloadBtn'], ['swapHit', 'swapBtn'], ['altHit', 'altBtn']]) {
    assert.equal(L[hit].w, L[base].w + 20);
    assert.equal(L[hit].y, L[base].y - 10);
  }
  const bottom = v.h - ((v.safe && v.safe.bottom) || 0);
  assert.ok(L.reloadBtn.y + L.reloadBtn.h <= bottom, 'buttons run into the bottom safe area');
  const sl = (v.safe && v.safe.left) || 0;
  const sr = (v.safe && v.safe.right) || 0;
  assert.ok(L.moveBox.x >= sl && L.lookBox.x + L.lookBox.w <= v.w - sr, `control boxes run into a side safe area at ${v.w}x${v.h}`);
  if (v.w > v.h * 1.05) {
    assert.ok(L.moveBox.y > v.h * 0.4, 'landscape boxes sit in the lower half');
    assert.ok(L.swapBtn.x >= L.moveBox.x + L.moveBox.w && L.reloadBtn.x + L.reloadBtn.w <= L.lookBox.x, 'landscape SWAP and RELOAD sit between the boxes');
  }
  assert.ok(layout(v) === L, 'layout should be cached for identical input');

  // the weapon strip (tap a cell to pick that weapon): every cell and its tap area inside the view and the side insets, a
  // tap area about 40 px where the screen allows, no cell overlapping another or any control, in both orientations
  {
    const land = v.w > v.h * 1.05;
    const safeTop = (v.safe && v.safe.top) || 0;
    const ctrl = ['moveBox', 'lookBox', 'reloadBtn', 'swapBtn', 'altBtn', 'moveHit', 'lookHit', 'reloadHit', 'swapHit', 'altHit'];
    assert.ok(L.strip(3) === L.strip(3), 'the strip is cached per count');
    assert.deepEqual(L.strip(0).cells, [], 'no weapons, no cells');
    assert.equal(L.strip(99).cells.length, STRIP_MAX, 'at most eight cells');
    assert.equal(L.strip(NaN).cells.length, 0);
    assert.equal(L.strip(-2).cells.length, 0);
    for (let n = 1; n <= STRIP_MAX; n++) {
      const st = L.strip(n);
      assert.equal(st.cells.length, n);
      let prev = null;
      for (const c of st.cells) {
        for (const r of [c, c.hit]) {
          assert.ok(inside(r, v), `strip cell (n=${n}) outside ${v.w}x${v.h}`);
          assert.ok(r.x >= sl && r.x + r.w <= v.w - sr, `strip cell (n=${n}) in a side inset at ${v.w}x${v.h}`);
          assert.ok(r.y >= safeTop, `strip cell (n=${n}) in the top inset at ${v.w}x${v.h}`);
          for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isFinite(r[k]));
        }
        assert.ok(c.hit.x <= c.x && c.hit.x + c.hit.w >= c.x + c.w && c.hit.y <= c.y && c.hit.y + c.hit.h >= c.y + c.h, 'the tap area covers the drawn cell');
        assert.ok(c.hit.h >= 40, `tap area is ${c.hit.h} px tall at ${v.w}x${v.h}`);
        assert.ok(c.hit.w >= (v.w >= 360 ? 40 : 36), `tap area is ${c.hit.w.toFixed(1)} px wide (n=${n}) at ${v.w}x${v.h}`);
        assert.ok(c.w >= 30 && c.h >= 26, 'the drawn cell is a readable size');
        if (prev) {
          assert.ok(c.x > prev.x + prev.w, 'cells run left to right with a gap');
          assert.ok(!overlap(c.hit, prev.hit), 'tap areas of neighbouring cells never overlap');
        }
        prev = c;
        for (const k of ctrl) assert.ok(!overlap(c.hit, L[k]), `strip cell (n=${n}) overlaps ${k} at ${v.w}x${v.h}`);
      }
      assert.ok(st.bottom > st.cells[0].y && Number.isFinite(st.bottom));
      // the hit test agrees with the rectangles: a cell's centre is that cell, the middle of the move and aim boxes is nothing
      st.cells.forEach((c, i) => assert.equal(stripCellAt(v, n, c.x + c.w / 2, c.y + c.h / 2), i));
      assert.equal(stripCellAt(v, n, L.moveBox.x + L.moveBox.w / 2, L.moveBox.y + L.moveBox.h / 2), -1);
      assert.equal(stripCellAt(v, n, L.lookBox.x + L.lookBox.w / 2, L.lookBox.y + L.lookBox.h / 2), -1);
      for (const k of ['reloadBtn', 'swapBtn', 'altBtn']) assert.equal(stripCellAt(v, n, L[k].x + L[k].w / 2, L[k].y + L[k].h / 2), -1, `${k} is not a strip cell`);
    }
    // landscape keeps the strip beside the health bar on the top row; portrait gives it a row of its own below the score line
    const c8 = L.strip(8).cells;
    if (land) assert.ok(c8[0].y < 12 + safeTop, 'landscape strip sits on the top row');
    else assert.ok(c8[0].y >= safeTop + 48 && c8[0].x >= sl + 16, 'portrait strip sits below the health and score lines');
    assert.equal(stripCellAt(v, 8, -5, -5), -1);
    assert.equal(stripCellAt(v, 8, NaN, NaN), -1);
  }

  const ctx = fakeCtx();
  for (const h of hudStates) drawPlayHud(ctx, v, h);

  // every menu button stays on screen, clear of the side insets, and nothing overlaps, in both orientations
  const bstates = [undefined, null, {}, { t: -1 }, { t: 0.5 }, { t: 5, debugMode: true }, { t: huge }, { t: NaN }, { t: 3, hasNext: true }, { t: 3, input: 'pc', sensLabel: 'MEDIUM', debugMode: true, resumeLevel: 2, resetArmed: true }, { t: 3, input: 'mobile' }, { t: 3, records: 4, resumeLevel: 2, debugMode: true }, { t: 3, records: 10 }, { t: 3, records: NaN }, { t: 3, records: huge }, { t: 1, difficulty: 'hard', resumeLevel: 2 }, { t: 1, difficulty: 'extra', resumeLevel: 2, debugMode: true, records: 4 }, { t: 1, difficulty: 'bogus', input: 'pc' }, { t: 1, difficulty: 'extra', input: 'mobile' }, { t: 1, difficulty: null, input: 'pc' }];
  for (const mode of ['title', 'difficulty', 'controls', 'settings', 'setlist', 'dead', 'complete', 'voicemail', 'bogus']) {
    for (const s of bstates) {
      const list = buttons(mode, v, s);
      assert.ok(Array.isArray(list));
      for (const b of list) {
        assert.ok(b.id && b.label, 'button needs id and label');
        assert.ok(inside(b, v), `button ${b.id} (${mode}) outside ${v.w}x${v.h}`);
        assert.ok(b.x >= sl && b.x + b.w <= v.w - sr, `button ${b.id} (${mode}) in a side inset at ${v.w}x${v.h}`);
        assert.ok(b.y + b.h <= v.h - ((v.safe && v.safe.bottom) || 0) + 0.5, `button ${b.id} (${mode}) in the bottom inset at ${v.w}x${v.h}`);
      }
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!overlap(list[i], list[j]), `buttons overlap in ${mode}`);
    }
  }
  assert.deepEqual(buttons('title', v, { t: 0 }).map((b) => b.id), ['new', 'settings', 'debug']);
  assert.deepEqual(buttons('title', v, { t: 0, resumeLevel: 2 }).map((b) => b.id), ['resume', 'new', 'settings', 'debug']);
  // the SETLIST button appears beside SETTINGS only once a record is found, and shares its row
  assert.deepEqual(buttons('title', v, { t: 0, records: 0 }).map((b) => b.id), ['new', 'settings', 'debug']);
  assert.deepEqual(buttons('title', v, { t: 0, records: 1 }).map((b) => b.id), ['new', 'settings', 'setlist', 'debug']);
  assert.deepEqual(buttons('title', v, { t: 0, records: 3, resumeLevel: 2 }).map((b) => b.id), ['resume', 'new', 'settings', 'setlist', 'debug']);
  {
    const a = buttons('title', v, { t: 0, records: 3 });
    const base = buttons('title', v, { t: 0 });
    const se = a.find((b) => b.id === 'settings');
    const sl2 = a.find((b) => b.id === 'setlist');
    assert.ok(se.y === sl2.y && se.h === sl2.h && sl2.x >= se.x + se.w, 'SETLIST sits beside SETTINGS');
    assert.ok(Math.abs(sl2.x + sl2.w - (base.find((b) => b.id === 'settings').x + base.find((b) => b.id === 'settings').w)) < 1e-6, 'the two share the old SETTINGS width');
    assert.equal(sl2.label, 'SETLIST 3/10');
    assert.deepEqual(buttons('setlist', v, { t: 0 }).map((b) => b.id), ['back']);
  }
  assert.equal(buttons('title', v, { t: 0, resumeLevel: 2 })[0].label, 'CONTINUE: LEVEL 2');
  assert.equal(buttons('title', v, { t: 0, resumeLevel: 2, difficulty: 'normal' })[0].label, 'CONTINUE: LEVEL 2', 'normal adds nothing to CONTINUE');
  assert.equal(buttons('title', v, { t: 0, resumeLevel: 2, difficulty: 'hard' })[0].label, 'CONTINUE: LEVEL 2 (HARD)');
  assert.equal(buttons('title', v, { t: 0, resumeLevel: 2, difficulty: 'extra' })[0].label, 'CONTINUE: LEVEL 2 (EXTRA HARD)');
  assert.equal(buttons('title', v, { t: 0, resumeLevel: 2, difficulty: 'bogus' })[0].label, 'CONTINUE: LEVEL 2', 'an unknown mode adds nothing');
  // the difficulty page: three choices and BACK, inside the screen and the insets, clear of each other, big enough to hit
  for (const sel of [undefined, 'normal', 'hard', 'extra', 'bogus']) {
    for (const input of ['pc', 'mobile', undefined]) {
      const d = buttons('difficulty', v, { t: 0, difficulty: sel, input });
      assert.deepEqual(d.map((b) => b.id), ['mode:normal', 'mode:hard', 'mode:extra', 'back'], 'three choices, then BACK');
      assert.deepEqual(d.map((b) => b.label), ['NORMAL', 'HARD', 'EXTRA HARD', 'BACK']);
      assert.deepEqual(d.slice(0, 3).map((b) => b.mode), ['normal', 'hard', 'extra']);
      assert.deepEqual(d.slice(0, 3).map((b) => b.n), [1, 2, 3], 'the number keys');
      assert.ok(d.slice(0, 3).every((b) => typeof b.sub === 'string' && b.sub.length > 5 && b.sub.length < 60), 'one short line each');
      assert.equal(d.filter((b) => b.selected).length, 1, 'exactly one choice is highlighted');
      assert.equal(d.find((b) => b.selected).mode, ['normal', 'hard', 'extra'].includes(sel) ? sel : 'normal', 'the highlight follows the current mode (normal if unknown)');
      for (const b of d.slice(0, 3)) assert.ok(b.w >= 120 && b.h >= 52, `choice ${b.id} is a fair touch target at ${v.w}x${v.h} (${b.w.toFixed(0)}x${b.h.toFixed(0)})`);
      const sel0 = d.slice(0, 3);
      for (const b of sel0) assert.ok(b.y + b.h <= d[3].y, `choice ${b.id} stays above BACK`);
      assert.ok(sel0.every((b) => b.y >= ((v.safe && v.safe.top) || 0) + 50), 'and below the heading');
    }
  }
  {
    const d = buttons('difficulty', v, { t: 0 });
    if (v.w > v.h * 1.05) assert.ok(d[0].y === d[1].y && d[1].y === d[2].y && d[0].x < d[1].x && d[1].x < d[2].x, 'landscape: side by side');
    else assert.ok(d[0].x === d[1].x && d[0].y < d[1].y && d[1].y < d[2].y, 'portrait: one column');
  }
  assert.deepEqual(buttons('settings', v, { t: 0, input: 'pc' }).map((b) => b.id), ['input', 'sens', 'reset', 'back']);
  assert.deepEqual(buttons('settings', v, { t: 0, input: 'mobile' }).map((b) => b.id), ['input', 'reset', 'back']);
  assert.equal(buttons('settings', v, { input: 'pc' })[0].label, 'CONTROLS: PC');
  assert.equal(buttons('settings', v, { input: 'mobile' })[0].label, 'CONTROLS: MOBILE');
  assert.equal(buttons('settings', v, { resetArmed: true }).find((b) => b.id === 'reset').label, 'TAP AGAIN TO ERASE');
  assert.deepEqual(buttons('controls', v, { t: 0 }).map((b) => b.id), ['start', 'back']);
  assert.deepEqual(buttons('dead', v, { t: 0.9 }).map((b) => b.id), []);
  assert.deepEqual(buttons('dead', v, { t: 0.91 }).map((b) => b.id), ['retry', 'menu']);
  assert.deepEqual(buttons('complete', v, { t: 1 }).map((b) => b.id), []);
  assert.deepEqual(buttons('complete', v, { t: 1.01 }).map((b) => b.id), ['again', 'menu']);
  assert.deepEqual(buttons('complete', v, { t: 1.01, hasNext: true }).map((b) => b.id), ['next', 'again', 'menu']);
  assert.deepEqual(buttons('voicemail', v, { t: 0.8 }).map((b) => b.id), []);
  assert.deepEqual(buttons('voicemail', v, { t: 0.81 }).map((b) => b.id), ['continue']);
  assert.equal(buttons('title', v, { debugMode: true }).find((b) => b.id === 'debug').label, 'DEBUG MODE: ON');
  assert.equal(buttons('title', v, { debugMode: false }).find((b) => b.id === 'debug').label, 'DEBUG MODE: OFF');

  const ts = [undefined, null, {}, { t: 0 }, { t: 3.3, debugMode: true, best: huge }, { t: huge }, { t: NaN, best: NaN }];
  for (const s of ts) {
    drawTitle(ctx, v, s);
    drawControls(ctx, v, s);
    drawIntro(ctx, v, s);
    drawDead(ctx, v, s);
    drawComplete(ctx, v, s);
    drawVoicemail(ctx, v, s);
    drawSettings(ctx, v, s);
    drawSetlist(ctx, v, s);
    drawDifficulty(ctx, v, s);
  }
  for (const d of [undefined, 'normal', 'hard', 'extra', 'bogus', null, 7]) {
    for (const input of ['pc', 'mobile']) drawDifficulty(ctx, v, { t: 2, difficulty: d, input });
    drawTitle(ctx, v, { t: 2, difficulty: d, resumeLevel: 2, best: 1234, levelName: 'THE COWGATE', levelNumber: 1 });
    drawDead(ctx, v, { t: 3, difficulty: d, levelName: long, score: 5, best: 9 });
    drawComplete(ctx, v, { t: 3, difficulty: d, score: 5, best: 9, newBest: true, kills: 2, totalEnemies: 2 });
    drawComplete(ctx, v, { t: 3, difficulty: d, score: 5, best: 9, kills: 2, totalEnemies: 2, hasNext: true });
  }
  for (const found of [undefined, null, 'haar', [], ['haar'], ['haar', 'gala', 5, null, {}, 'nope'], ['haar', 'bypass', 'gala', 'pipes', 'wee', 'supper', 'tram', 'hold', 'foot', 'refund'], Array.from({ length: 50 }, (_, i) => `x${i}`)]) {
    drawSetlist(ctx, v, { t: 1, found });
  }
  drawSettings(ctx, v, { t: 1, input: 'pc', sensLabel: long, saved: long, resetArmed: true });
  drawSettings(ctx, v, { t: 1, input: 'mobile', saved: long });
  for (const input of ['pc', 'mobile']) { drawControls(ctx, v, { t: 2, input }); drawTitle(ctx, v, { t: 2, input }); }
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
