// Menu screens for the first-person game: title, controls, level intro, dead and level complete.
// Everything is drawn over the live 3D scene, so overlays are translucent. The look is the 2D game's: magenta and
// cyan neon on near-black, heavy type, rounded buttons, dark-comedy wording.
// buttons(mode, view, state) is the single source of truth for button rectangles (hit testing and drawing).

import { text, rrect, drawSkyline, hash } from './draw.js';
import { outlined, fit, wrapLines, paragraph, weaponIcon, panel, corners, circle } from './hud.js';

const MAGENTA = '#ff2e93';
const CYAN = '#22d3ee';
const AMBER = '#fbbf24';
const ZERO_SAFE = { top: 0, bottom: 0 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const str = (v) => (v === null || v === undefined ? '' : String(v));
const safe = (view) => view.safe || ZERO_SAFE;
const pad2 = (n) => String(n).padStart(2, '0');

// Short lines for the integrator to pick from if it wants first-person-specific death lines.
export const DEATH_LINES_3D = [
  'Reviewed: one star. "Dead on arrival."',
  'Beaten by a fizzy drink. In your own club.',
  'The robots were not feeling the set.',
  'Last orders, Freddie.',
  'Not the first DJ to get booed off in Edinburgh.',
  'Aye, it is like that on a Saturday.',
  'You have had worse Fringe gigs.',
  'That bottle was only meant to be recycled.',
];

// Title block geometry, shared by buttons() and drawTitle() so short screens never stack buttons on the tagline.
function titleGeom(view) {
  const top = num(safe(view).top);
  const short = view.h < 560;
  const size = short ? 46 : 52;
  const cy = top + view.h * (short ? 0.14 : 0.15) + 22;
  return { size, cy, bottom: cy + size * 2 + 14 + 24 + 12 };
}

// ---- buttons ----

export function buttons(mode, view, state) {
  const st = state || {};
  const t = num(st.t);
  const sb = num(safe(view).bottom);
  const list = [];
  const w = Math.min(view.w - 48, 300);
  const x = (view.w - w) / 2;
  const add = (id, label, y, primary = true, h = 52, accent = null) => list.push({ id, label, x, y, w, h, primary, accent });
  if (mode === 'title') {
    const y = Math.max(view.h * 0.46, titleGeom(view).bottom);
    add('new', 'NEW GAME', y);
    add('debug', `DEBUG MODE: ${st.debugMode ? 'ON' : 'OFF'}`, y + 68, false, 40, st.debugMode ? AMBER : null);
  } else if (mode === 'controls') {
    if (view.h < 560) {
      const y = view.h - sb - 100;
      add('start', 'START GAME', y, true, 46);
      add('back', 'BACK', y + 52, false, 38);
    } else {
      const y = view.h - sb - 126;
      add('start', 'START GAME', y);
      add('back', 'BACK', y + 60, false, 44);
    }
  } else if (mode === 'dead' && t > 0.9) {
    add('retry', 'RETRY LEVEL', view.h * 0.6);
    add('menu', 'MAIN MENU', view.h * 0.6 + 64, false, 44);
  } else if (mode === 'complete' && t > 1) {
    if (st.hasNext) {
      const y = Math.min(view.h * 0.7, view.h - sb - 164); // three buttons: keep them on short screens
      add('next', 'NEXT LEVEL', y);
      add('again', 'PLAY AGAIN', y + 62, false, 44);
      add('menu', 'MAIN MENU', y + 114, false, 40);
    } else {
      add('again', 'PLAY AGAIN', view.h * 0.7);
      add('menu', 'MAIN MENU', view.h * 0.7 + 64, false, 44);
    }
  } else if (mode === 'voicemail' && t > 0.8) {
    add('continue', 'CONTINUE', view.h - sb - 96);
  }
  return list;
}

function drawButton(ctx, b, alpha = 1) {
  ctx.globalAlpha = alpha;
  rrect(ctx, b.x, b.y + 3, b.w, b.h, 12);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  rrect(ctx, b.x, b.y, b.w, b.h, 12);
  ctx.fillStyle = b.primary ? MAGENTA : b.accent ? 'rgba(251,191,36,0.16)' : 'rgba(255,255,255,0.1)';
  ctx.fill();
  if (b.primary) {
    rrect(ctx, b.x + 3, b.y + 3, b.w - 6, b.h * 0.4, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fill();
  }
  rrect(ctx, b.x, b.y, b.w, b.h, 12);
  ctx.strokeStyle = b.primary ? '#ff7ab8' : b.accent || 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 2;
  ctx.stroke();
  const small = b.h < 48;
  const f = fit(ctx, b.label, b.w - 20, small ? 14 : 17, 700, 10);
  text(ctx, f.str, b.x + b.w / 2, b.y + b.h / 2 + 0.5, f.size, b.accent || '#ffffff', 'center', 700);
  ctx.globalAlpha = 1;
}

function drawButtons(ctx, list, t, delay) {
  for (const b of list) drawButton(ctx, b, delay === undefined ? 1 : clamp((t - delay) / 0.3, 0, 1));
}

// Chunky title type: dark drop, outline, fill.
function heavy(ctx, s, x, y, size, colour, outline = 'rgba(4,2,8,0.8)') {
  text(ctx, s, x, y + Math.max(2, size * 0.07), size, 'rgba(0,0,0,0.5)', 'center', 800);
  outlined(ctx, s, x, y, size, colour, 'center', 800, outline);
}

function dim(ctx, view, a, colour = '4,2,8') {
  ctx.fillStyle = `rgba(${colour},${a})`;
  ctx.fillRect(0, 0, view.w, view.h);
}

// ---- title ----

export function drawTitle(ctx, view, state) {
  const st = state || {};
  const t = num(st.t);
  const cx = view.w / 2;
  const { cy, size: big } = titleGeom(view);
  dim(ctx, view, 0.55);
  ctx.globalAlpha = 0.92;
  drawSkyline(ctx, view.w, view.h);
  ctx.globalAlpha = 1;

  const f = fit(ctx, "FREDDIE'S", view.w - 40, big, 800, 28);
  heavy(ctx, "FREDDIE'S", cx, cy, f.size, MAGENTA);
  // the neon sign stutters now and then
  const flick = Math.floor(t * 14) % 41 === 0 || Math.floor(t * 14) % 41 === 2 ? 0.55 : 1;
  ctx.globalAlpha = flick;
  heavy(ctx, 'LAST SET', cx, cy + f.size + 2, f.size, CYAN);
  ctx.globalAlpha = 1;
  const y1 = cy + f.size * 2 + 14;
  outlined(ctx, 'Edinburgh. 2am. Everyone is dead.', cx, y1, 15, '#c9c2e0', 'center', 500);

  // "Level 1: the Cowgate" with the best score on the same line, so short screens do not collide
  const lvl = 'Level 1: the Cowgate';
  const best = num(st.best) > 0 ? `BEST ${Math.floor(num(st.best))}` : '';
  ctx.font = '700 13px system-ui, -apple-system, sans-serif';
  const lw = ctx.measureText(lvl).width;
  const bw = best ? ctx.measureText(best).width : 0;
  const gap = best ? 22 : 0;
  const x0 = cx - (lw + bw + gap) / 2;
  outlined(ctx, lvl, x0, y1 + 24, 13, CYAN, 'left', 700);
  if (best) outlined(ctx, best, x0 + lw + gap, y1 + 24, 13, '#c9c2e0', 'left', 700);

  const list = buttons('title', view, st);
  drawButtons(ctx, list);
  if (st.debugMode) {
    const d = list[1];
    outlined(ctx, '2x fire rate, 2x damage, 2x health', cx, d.y + d.h + 18, 12, AMBER, 'center', 600);
    outlined(ctx, 'Scores are not recorded', cx, d.y + d.h + 36, 12, 'rgba(251,191,36,0.75)', 'center', 500);
  }
  outlined(ctx, 'Left thumb moves. Right thumb aims and fires. Drag anywhere else to aim.', cx, view.h - num(safe(view).bottom) - 16, 12, 'rgba(255,255,255,0.6)', 'center', 500);
}

// ---- controls ----

// Animated knob in a grey box: moves round the ring, lighting the chevron it leans towards.
function moveDiagram(ctx, cx, cy, bs, t) {
  const x = cx - bs / 2;
  const y = cy - bs / 2;
  panel(ctx, x, y, bs, bs, 14, 'rgba(120,124,138,0.4)', '#ffffff');
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  corners(ctx, x, y, bs, bs, 6, 8);
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1.2;
  circle(ctx, cx, cy, bs * 0.3);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const a = t * 1.5;
  const r = 0.62 + 0.38 * Math.sin(t * 0.8);
  const reach = bs / 2 - bs * 0.17 - 6;
  const kx = cx + Math.cos(a) * r * reach;
  const ky = cy + Math.sin(a) * r * reach;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2;
    const near = Math.max(0, Math.cos(a - ang));
    ctx.globalAlpha = 0.25 + 0.75 * near * near * near;
    const px = cx + Math.cos(ang) * bs * 0.37;
    const py = cy + Math.sin(ang) * bs * 0.37;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    ctx.beginPath();
    ctx.moveTo(px + ux * 4, py + uy * 4);
    ctx.lineTo(px - ux * 4 - uy * 4, py - uy * 4 + ux * 4);
    ctx.lineTo(px - ux * 4 + uy * 4, py - uy * 4 - ux * 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(kx, ky);
  ctx.stroke();
  circle(ctx, kx, ky, bs * 0.17);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();
}

// Finger dot dragging inside a cyan-lit box, with blast arcs flying off in the aim direction.
function lookDiagram(ctx, cx, cy, bs, t) {
  const x = cx - bs / 2;
  const y = cy - bs / 2;
  panel(ctx, x, y, bs, bs, 14, 'rgba(120,124,138,0.4)', '#ffffff');
  rrect(ctx, x, y, bs, bs, 14);
  ctx.fillStyle = CYAN;
  ctx.globalAlpha = 0.14;
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.6;
  corners(ctx, x, y, bs, bs, 6, 8);
  const reach = bs / 2 - bs * 0.1 - 8;
  const pos = (tt, out) => {
    out.x = cx + Math.sin(tt * 1.1) * 0.7 * reach;
    out.y = cy + Math.sin(tt * 1.7 + 1) * 0.45 * reach;
  };
  const p = { x: 0, y: 0 };
  // fading drag trail
  for (let i = 5; i >= 1; i--) {
    pos(t - i * 0.07, p);
    ctx.globalAlpha = 0.5 - i * 0.08;
    circle(ctx, p.x, p.y, bs * 0.06);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  pos(t, p);
  // blast arcs leave the dot, upwards
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 3; i++) {
    const k = (t * 1.6 + i / 3) % 1;
    ctx.globalAlpha = (1 - k) * 0.9;
    ctx.beginPath();
    ctx.arc(p.x, p.y, bs * 0.12 + k * bs * 0.28, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  circle(ctx, p.x, p.y, bs * 0.1);
  ctx.fillStyle = CYAN;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke();
  circle(ctx, p.x, p.y, bs * 0.04);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

// A small button the same shape as the in-game ones.
function miniButton(ctx, x, y, w, h, label, fillA, edge, textColour) {
  panel(ctx, x, y, w, h, 10, fillA, edge);
  outlined(ctx, label, x + w / 2, y + h / 2 + 0.5, 12.5, textColour, 'center', 800);
}

// RELOAD: six pips empty out, the button pulses amber, a fill sweeps across, the pips come back.
function reloadDiagram(ctx, cx, cy, w, t) {
  const bh = 32;
  const bx = cx - w / 2;
  const by = cy - bh / 2 + 9;
  const cyc = (t % 4.2) / 4.2;
  let clip = 6;
  let prog = -1;
  if (cyc < 0.4) clip = 6 - Math.floor((cyc / 0.4) * 7);
  else if (cyc < 0.55) clip = 0;
  else if (cyc < 0.9) {
    prog = (cyc - 0.55) / 0.35;
    clip = 0;
  }
  clip = Math.max(0, Math.min(6, clip));
  const empty = clip === 0 && prog < 0;
  const pulse = 0.5 + 0.5 * Math.sin(t * 9);
  const pw = 9;
  const px0 = cx - (6 * pw + 5 * 4) / 2;
  for (let i = 0; i < 6; i++) {
    rrect(ctx, px0 + i * (pw + 4), cy - 25, pw, 10, 3);
    ctx.fillStyle = i < clip ? '#ffffff' : 'rgba(255,255,255,0.15)';
    ctx.fill();
  }
  miniButton(ctx, bx, by, w, bh, prog >= 0 ? 'RELOADING' : 'RELOAD', empty ? 'rgba(251,191,36,0.3)' : 'rgba(120,124,138,0.4)', empty ? AMBER : '#ffffff', empty ? '#ffe9a8' : '#ffffff');
  if (empty) {
    rrect(ctx, bx, by, w, bh, 10);
    ctx.fillStyle = AMBER;
    ctx.globalAlpha = 0.1 + 0.28 * pulse;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (prog >= 0) {
    const fw = (w - 6) * prog;
    if (fw > 1) {
      rrect(ctx, bx + 3, by + 3, fw, bh - 6, Math.min(7, fw / 2));
      ctx.fillStyle = CYAN;
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    outlined(ctx, 'RELOADING', bx + w / 2, by + bh / 2 + 0.5, 12.5, '#ffffff', 'center', 800);
  }
}

const SWAP_ICONS = ['pistol', 'shotgun', 'smg'];
const SWAP_COLOURS = [CYAN, AMBER, '#a78bfa'];

// SWAP: a thumb taps the button and the highlighted weapon moves along.
function swapDiagram(ctx, cx, cy, w, t) {
  const bh = 32;
  const bx = cx - w / 2;
  const by = cy - bh / 2 + 9;
  const step = t / 1.3;
  const idx = Math.floor(step) % 3;
  const k = step % 1;
  const tap = k < 0.25 ? 1 - k / 0.25 : 0;
  const iw = 34;
  for (let i = 0; i < 3; i++) {
    const x = cx + (i - 1) * (iw + 6) - iw / 2;
    const on = i === idx;
    rrect(ctx, x, cy - 30, iw, 20, 6);
    ctx.fillStyle = on ? 'rgba(34,211,238,0.28)' : 'rgba(4,2,8,0.45)';
    ctx.fill();
    ctx.lineWidth = on ? 2 : 1;
    ctx.strokeStyle = on ? CYAN : 'rgba(255,255,255,0.25)';
    ctx.stroke();
    ctx.globalAlpha = on ? 1 : 0.5;
    weaponIcon(ctx, SWAP_ICONS[i], x + iw / 2, cy - 20, 20, SWAP_COLOURS[i]);
    ctx.globalAlpha = 1;
  }
  miniButton(ctx, bx, by, w, bh, 'SWAP', 'rgba(120,124,138,0.4)', '#ffffff', '#ffffff');
  if (tap > 0) {
    rrect(ctx, bx, by, w, bh, 10);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = tap * 0.3;
    ctx.fill();
    ctx.globalAlpha = 1;
    circle(ctx, cx, by + bh / 2, 6 + (1 - tap) * 16);
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = tap * 0.7;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

const CELLS = [
  { kind: 'move', sub: 'LEFT THUMB', head: 'MOVE', cap: 'Drag in the box to walk. Up is forwards.' },
  { kind: 'look', sub: 'RIGHT THUMB', head: 'AIM AND FIRE', cap: 'Hold to fire. Drag to aim. Dragging anywhere outside the boxes aims too, without firing. No aim assist.' },
  { kind: 'swap', sub: 'UNDER THE LEFT BOX', head: 'SWAP', cap: 'Walk over weapons to pick them up. SWAP cycles them.' },
  { kind: 'reload', sub: 'UNDER THE RIGHT BOX', head: 'RELOAD', cap: 'Reloads on its own when the clip is empty. Tap RELOAD to do it early. Ammo is unlimited, clips are not.' },
];
const TIP = 'Clear every robot in an area to unlock the next door.';

export function drawControls(ctx, view, state) {
  const st = state || {};
  const t = num(st.t);
  const cx = view.w / 2;
  const top = num(safe(view).top);
  dim(ctx, view, 0.8);
  const titleY = top + Math.max(view.h < 560 ? 22 : 30, view.h * 0.055);
  heavy(ctx, 'CONTROLS', cx, titleY, view.h < 560 ? 24 : 28, MAGENTA);

  const list = buttons('controls', view, st);
  const startY = list[0].y;
  const colGap = 12;
  const cw = (view.w - 32 - colGap) / 2;
  const capSize = view.w < 380 ? 11.5 : view.w < 420 ? 12.5 : 13.5;
  const capLh = capSize + 3.5;
  const capLines = (c) => wrapLines(ctx, c.cap, cw - 6, capSize, 500, 6).length;
  const cap1 = Math.max(capLines(CELLS[0]), capLines(CELLS[1])) * capLh;
  const cap2 = Math.max(capLines(CELLS[2]), capLines(CELLS[3])) * capLh;
  const tipH = view.h < 560 ? 30 : 34;
  const headH = 11 + 20 + 4;
  const avail = startY - 10 - tipH - (titleY + 18);
  const diagH2 = view.h < 560 ? 50 : 56;
  const fixed = headH * 2 + cap1 + cap2 + diagH2 + 5 * 7;
  const bs = clamp(avail - fixed, view.h < 560 ? 44 : 58, Math.min(cw * 0.62, 132));
  const total = bs + diagH2 + headH * 2 + cap1 + cap2;
  const gap = clamp((avail - total) / 3, 7, 56);
  const lead = Math.max(0, (avail - total - gap * 3) / 2);

  let y = titleY + 18 + lead + gap * 0.7;
  const rows = [
    { h: bs, cap: cap1, cells: [CELLS[0], CELLS[1]] },
    { h: diagH2, cap: cap2, cells: [CELLS[2], CELLS[3]] },
  ];
  for (const row of rows) {
    for (let i = 0; i < 2; i++) {
      const c = row.cells[i];
      const ccx = 16 + cw / 2 + i * (cw + colGap);
      const dcy = y + row.h / 2;
      if (c.kind === 'move') moveDiagram(ctx, ccx, dcy, bs, t);
      else if (c.kind === 'look') lookDiagram(ctx, ccx, dcy, bs, t);
      else if (c.kind === 'swap') swapDiagram(ctx, ccx, dcy, Math.min(cw - 24, 104), t);
      else reloadDiagram(ctx, ccx, dcy, Math.min(cw - 24, 104), t);
      let ty = y + row.h + 12;
      outlined(ctx, c.sub, ccx, ty, 10.5, '#9fb3c8', 'center', 600);
      ty += 16;
      const hf = fit(ctx, c.head, cw - 6, 17, 800, 11);
      outlined(ctx, hf.str, ccx, ty, hf.size, c.kind === 'look' ? CYAN : '#ffffff', 'center', 800);
      paragraph(ctx, c.cap, ccx, ty + 19, cw - 6, capSize, '#d6d0ea', 'center', 500, capLh);
    }
    y += row.h + headH + row.cap + gap;
  }

  // tip strip, just above the buttons
  const ty = startY - 10 - tipH + 4;
  rrect(ctx, 16, ty, view.w - 32, tipH - 6, 10);
  ctx.fillStyle = 'rgba(255,46,147,0.14)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,46,147,0.6)';
  ctx.stroke();
  const tf = fit(ctx, TIP, view.w - 56, 13, 700, 9);
  outlined(ctx, tf.str, cx, ty + (tipH - 6) / 2 + 0.5, tf.size, '#ffe0ef', 'center', 700, 'rgba(4,2,8,0)');
  drawButtons(ctx, list);
}

// ---- intro ----

// clock may be a ready-made string, minutes after midnight, or the 2D game's [start, end] pair.
function clockText(c) {
  if (typeof c === 'string') return c;
  const m = Math.floor(num(Array.isArray(c) ? c[0] : c, -1));
  if (m < 0) return '';
  return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
}

export function drawIntro(ctx, view, state) {
  const st = state || {};
  const t = num(st.t);
  const lv = st.level || {};
  const cx = view.w / 2;
  const top = num(safe(view).top);
  const y0 = Math.max(view.h * 0.3, top + 80);
  dim(ctx, view, 0.62);
  const a = clamp(t / 0.4, 0, 1);
  ctx.globalAlpha = a;
  const slide = (1 - a) * 12;
  outlined(ctx, `LEVEL ${Math.floor(num(lv.number, 1))}`, cx, y0 + slide, 14, '#9fb3c8', 'center', 600);
  const f = fit(ctx, str(lv.name), view.w - 40, 38, 800, 18);
  heavy(ctx, f.str, cx, y0 + 44 + slide, f.size, MAGENTA);
  let y = y0 + 88;
  const clock = clockText(lv.clock);
  if (clock) {
    outlined(ctx, clock, cx, y, 24, CYAN, 'center', 700);
    y += 44;
  }
  if (lv.sub) y += paragraph(ctx, str(lv.sub), cx, y, view.w - 64, 16, '#e5e0f5', 'center', 600);
  if (lv.line) paragraph(ctx, str(lv.line), cx, y + 10, view.w - 64, 15, '#b8c6d6', 'center', 500);
  if (t > 0.7 && Math.floor(t * 1.6) % 2 === 0) outlined(ctx, 'TAP TO START', cx, Math.max(view.h * 0.72, y + 70), 18, '#ffffff', 'center', 700);
  ctx.globalAlpha = 1;
}

// ---- voicemail ----

// A voicemail from Cheryl, shown between levels: dark card, a caller strip, her lines one after another.
export function drawVoicemail(ctx, view, state) {
  const st = state || {};
  const t = num(st.t);
  const mail = st.mail || {};
  const lines = Array.isArray(mail.lines) ? mail.lines : [];
  const cx = view.w / 2;
  const top = num(safe(view).top);
  dim(ctx, view, 0.86);
  const a = clamp(t / 0.5, 0, 1);
  ctx.globalAlpha = a;
  const y0 = Math.max(view.h * 0.16, top + 60);
  outlined(ctx, 'NEW VOICEMAIL', cx, y0, 13, CYAN, 'center', 700);
  const pulse = 0.5 + 0.5 * Math.sin(t * 5);
  circle(ctx, cx - 78, y0 + 34, 5 + pulse * 1.5);
  ctx.fillStyle = '#ff5a7a';
  ctx.fill();
  outlined(ctx, str(mail.from).toUpperCase() || 'UNKNOWN CALLER', cx + 8, y0 + 34, 17, '#ffffff', 'center', 800);
  outlined(ctx, `0:${pad2(Math.min(59, 12 + lines.length * 4))}`, cx, y0 + 60, 12, '#9fb3c8', 'center', 600);
  let y = y0 + 104;
  const w = view.w - 56;
  lines.forEach((ln, i) => {
    const la = clamp((t - 0.7 - i * 1.1) / 0.5, 0, 1);
    if (la <= 0) return;
    ctx.globalAlpha = a * la;
    y += paragraph(ctx, `"${str(ln)}"`, cx, y + (1 - la) * 6, w, 16, i % 2 ? '#e5e0f5' : '#ffffff', 'center', 500, 22) + 14;
  });
  ctx.globalAlpha = 1;
  drawButtons(ctx, buttons('voicemail', view, st), t, 0.8);
}

// ---- dead ----

export function drawDead(ctx, view, state) {
  const st = state || {};
  const t = num(st.t);
  const cx = view.w / 2;
  const top = num(safe(view).top);
  dim(ctx, view, 0.66 * clamp(t / 0.5, 0, 1), '14,2,8');
  const a = clamp((t - 0.1) / 0.4, 0, 1);
  ctx.globalAlpha = a;
  const y0 = Math.max(view.h * 0.2, top + 70);
  const f = fit(ctx, 'THE SET IS OVER', view.w - 40, 34, 800, 20);
  heavy(ctx, f.str, cx, y0 + (1 - a) * -10, f.size, MAGENTA);
  if (st.levelName) outlined(ctx, str(st.levelName), cx, y0 + 36, 14, '#9fb3c8', 'center', 600);
  let y = y0 + 70;
  if (st.line) y += paragraph(ctx, str(st.line), cx, y, view.w - 64, 16, '#e5e0f5', 'center', 500, 22);
  y = Math.max(view.h * 0.46, y + 18);
  outlined(ctx, `Score ${Math.floor(num(st.score))}`, cx, y, 20, '#ffffff', 'center', 700);
  if (st.debugMode) outlined(ctx, 'DEBUG RUN: not recorded', cx, y + 28, 14, AMBER, 'center', 600);
  else outlined(ctx, st.newBest ? 'NEW BEST' : `Best ${Math.floor(num(st.best))}`, cx, y + 28, 14, st.newBest ? CYAN : '#c9c2e0', 'center', 600);
  ctx.globalAlpha = 1;
  drawButtons(ctx, buttons('dead', view, st), t, 0.9);
}

// ---- complete ----

const CONFETTI = [MAGENTA, CYAN, AMBER, '#a78bfa'];

function fmtTime(sec) {
  const s = Math.floor(clamp(num(sec), 0, 5999 * 60 + 59));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

export function drawComplete(ctx, view, state) {
  const st = state || {};
  const t = num(st.t);
  const cx = view.w / 2;
  const top = num(safe(view).top);
  dim(ctx, view, 0.5);
  dim(ctx, view, 0.14, '255,170,90');

  // confetti, cheap: a few dozen tumbling rectangles
  for (let i = 0; i < 30; i++) {
    const hv = hash(i, 9, 3);
    const speed = 50 + (hv % 60);
    const x = ((hv >> 3) % 1000) / 1000 * view.w + Math.sin(t * 1.5 + i) * 14;
    const y = ((t * speed + ((hv >> 12) % 1000)) % (view.h + 40)) - 20;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * 3 + i);
    ctx.globalAlpha = clamp(t / 0.6, 0, 1) * 0.85;
    ctx.fillStyle = CONFETTI[hv % 4];
    ctx.fillRect(-3, -2, 6, 4);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  const a = clamp(t / 0.5, 0, 1);
  ctx.globalAlpha = a;
  const y0 = Math.max(view.h * 0.2, top + 70);
  const f = fit(ctx, str(st.title) || 'CLEARED.', view.w - 40, 54, 800, 28);
  heavy(ctx, f.str, cx, y0 - (1 - a) * 12, f.size, AMBER);
  let y = y0 + 44;
  y += paragraph(ctx, str(st.line) || 'The Cowgate is quiet. Mostly.', cx, y, view.w - 64, 18, '#ffffff', 'center', 600);
  y += paragraph(ctx, str(st.sub) || 'Freddie gets paid in exposure.', cx, y + 4, view.w - 64, 15, '#e5e0f5', 'center', 500);

  // stats row
  const kills = Math.floor(num(st.kills));
  const total = Math.floor(num(st.totalEnemies));
  const ease = 1 - (1 - clamp((t - 0.3) / 0.9, 0, 1)) ** 3;
  const sy = Math.max(view.h * 0.42, y + 28);
  const cw = (view.w - 32) / 3;
  const cells = [
    ['ROBOTS', total > 0 ? `${kills} / ${total}` : String(kills)],
    ['TIME', fmtTime(st.timeSec)],
    ['SCORE', String(Math.round(num(st.score) * ease))],
  ];
  for (let i = 0; i < 3; i++) {
    const x = 16 + cw * (i + 0.5);
    outlined(ctx, cells[i][0], x, sy, 11, '#9fb3c8', 'center', 600);
    const vf = fit(ctx, cells[i][1], cw - 8, 24, 800, 12);
    outlined(ctx, vf.str, x, sy + 26, vf.size, '#ffffff', 'center', 800);
  }
  let ny = sy + 62;
  if (total > 0 && kills >= total) {
    outlined(ctx, 'Every last robot. Nobody asked.', cx, ny, 13, AMBER, 'center', 600);
    ny += 22;
  }
  if (st.debugMode) outlined(ctx, 'DEBUG RUN: not recorded', cx, ny, 14, AMBER, 'center', 600);
  else outlined(ctx, st.newBest ? 'NEW BEST' : `Best ${Math.floor(num(st.best))}`, cx, ny, 14, st.newBest ? CYAN : '#c9c2e0', 'center', 600);
  ctx.globalAlpha = 1;
  drawButtons(ctx, buttons('complete', view, st), t, 1);
}
