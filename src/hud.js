// First-person play HUD: a transparent 2D layer drawn over the 3D view.
// layout(view) is shared with touch handling in the game, so its rectangles are the truth for hit testing.
// drawPlayHud(ctx, view, h) only reads the state object h and the canvas context it is given.
// Helpers at the bottom (outlined text, fitting, wrapping, weapon icons) are exported for screens.js.

import { rrect, heart } from './draw.js';

const TAU = Math.PI * 2;
const MAGENTA = '#ff2e93';
const CYAN = '#22d3ee';
const AMBER = '#fbbf24';
const RED = '#ff2a2a';
const FONT = 'system-ui, -apple-system, sans-serif';
const ZERO_SAFE = { top: 0, bottom: 0 };
const WEAPON_COLOURS = { pistol: CYAN, shotgun: AMBER, smg: '#a78bfa', launcher: MAGENTA, vinyl: '#34d399', beam: '#7ff0ff', grenade: '#ff6ec7', airhorn: '#ff9a3a' };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const str = (v) => (v === null || v === undefined ? '' : String(v));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

// ---- layout ----

let cache = null;
let cacheW = -1;
let cacheH = -1;
let cacheB = -1;
let cacheL = -1;
let cacheR = -1;

function inflate(r, d) {
  return { x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 };
}

// Boxes sit in the bottom corners; the RELOAD and SWAP buttons hang under them. The result is cached because the
// game asks for it every frame and the inputs almost never change.
export const isLandscape = (view) => view.w > view.h * 1.05;
export const sideSafe = (view) => ({ left: num(view.safe && view.safe.left), right: num(view.safe && view.safe.right) });

export function layout(view) {
  const safeBottom = num(view.safe && view.safe.bottom);
  const { left: sl, right: sr } = sideSafe(view);
  if (cache && cacheW === view.w && cacheH === view.h && cacheB === safeBottom && cacheL === sl && cacheR === sr) return cache;
  let moveBox;
  let lookBox;
  let swapBtn;
  let reloadBtn;
  let altBtn;
  if (isLandscape(view)) {
    // Boxes in the bottom corners (clear of the notch), SWAP and RELOAD beside them on the inside, so the screen's
    // height goes to the view and the wide middle is free for the aiming drag.
    const size = clamp(view.h * 0.34, 104, 150);
    const bottom = view.h - safeBottom - 16;
    const top = bottom - size;
    moveBox = { x: sl + 22, y: top, w: size, h: size };
    lookBox = { x: view.w - sr - 22 - size, y: top, w: size, h: size };
    const bw = Math.min(size * 0.75, 104);
    swapBtn = { x: moveBox.x + size + 14, y: bottom - 38, w: bw, h: 38 };
    reloadBtn = { x: lookBox.x - 14 - bw, y: bottom - 38, w: bw, h: 38 };
    altBtn = { x: lookBox.x + size - 76, y: top - 52, w: 76, h: 38 };
  } else {
    const size = clamp(Math.min(view.w * 0.4, view.h * 0.24), 120, 180);
    const bottom = view.h - safeBottom - 62;
    const top = bottom - size;
    moveBox = { x: 16, y: top, w: size, h: size };
    lookBox = { x: view.w - 16 - size, y: top, w: size, h: size };
    const bw = size * 0.7;
    const by = bottom + 10;
    swapBtn = { x: moveBox.x + (size - bw) / 2, y: by, w: bw, h: 38 };
    reloadBtn = { x: lookBox.x + (size - bw) / 2, y: by, w: bw, h: 38 };
    altBtn = { x: lookBox.x + size - 76, y: top - 52, w: 76, h: 38 };
  }
  cache = {
    moveBox,
    lookBox,
    reloadBtn,
    swapBtn,
    altBtn, // the SMG's alt-fire, drawn and read only once the SMG has its pedal (the arsenal's upgrade)
    moveHit: inflate(moveBox, 24),
    lookHit: inflate(lookBox, 24),
    reloadHit: inflate(reloadBtn, 10),
    swapHit: inflate(swapBtn, 10),
    altHit: inflate(altBtn, 10),
  };
  cacheW = view.w;
  cacheH = view.h;
  cacheB = safeBottom;
  cacheL = sl;
  cacheR = sr;
  return cache;
}

// ---- shared text helpers ----

const fontOf = (size, weight) => `${weight} ${size}px ${FONT}`;

// Text with a dark outline: legible over the brightest and darkest parts of the 3D scene without a panel.
export function outlined(ctx, s, x, y, size, colour, align = 'center', weight = 700, outline = 'rgba(4,2,8,0.75)') {
  ctx.font = fontOf(size, weight);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2.5, size * 0.2);
  ctx.strokeStyle = outline;
  ctx.strokeText(s, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(s, x, y);
}

const fitCache = new Map();

// Shrinks the font until the string fits, then truncates with an ellipsis if even the minimum size is too wide.
// Results are cached by input so steady text costs nothing per frame.
export function fit(ctx, s, maxW, size, weight = 700, min = 9) {
  let src = s;
  if (src.length > 160) src = src.slice(0, 160);
  const key = `${weight}|${size}|${Math.round(maxW)}|${min}|${src}`;
  let e = fitCache.get(key);
  if (e) return e;
  ctx.font = fontOf(size, weight);
  let w = ctx.measureText(src).width;
  let sz = size;
  let out = src;
  if (w > maxW) {
    sz = Math.max(min, Math.floor((size * maxW) / Math.max(1, w)));
    ctx.font = fontOf(sz, weight);
    if (ctx.measureText(src).width > maxW) {
      let lo = 0;
      let hi = src.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ctx.measureText(`${src.slice(0, mid)}…`).width <= maxW) lo = mid;
        else hi = mid - 1;
      }
      out = `${src.slice(0, lo)}…`;
    }
    w = ctx.measureText(out).width;
  }
  e = { str: out, size: sz, w };
  if (fitCache.size > 300) fitCache.clear();
  fitCache.set(key, e);
  return e;
}

const wrapCache = new Map();

// Greedy word wrap. Returns a cached array: callers must not modify it.
export function wrapLines(ctx, s, maxW, size, weight = 500, maxLines = 8) {
  const src = s.length > 400 ? s.slice(0, 400) : s;
  const key = `${weight}|${size}|${Math.round(maxW)}|${maxLines}|${src}`;
  let lines = wrapCache.get(key);
  if (lines) return lines;
  ctx.font = fontOf(size, weight);
  lines = [];
  let cur = '';
  for (const word of src.split(/\s+/)) {
    if (!word) continue;
    const trial = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(trial).width > maxW) {
      lines.push(cur);
      cur = word;
    } else cur = trial;
    // a single word wider than the line gets chopped so it cannot run off the screen
    while (ctx.measureText(cur).width > maxW && cur.length > 1) {
      let n = Math.max(1, Math.floor((cur.length * maxW) / ctx.measureText(cur).width));
      if (n >= cur.length) n = cur.length - 1;
      lines.push(cur.slice(0, n));
      cur = cur.slice(n);
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) lines.length = maxLines;
  if (wrapCache.size > 200) wrapCache.clear();
  wrapCache.set(key, lines);
  return lines;
}

// Draws wrapped text and returns its height.
export function paragraph(ctx, s, x, y, maxW, size, colour, align = 'center', weight = 500, lh = size * 1.4, outline) {
  const lines = wrapLines(ctx, s, maxW, size, weight);
  for (let i = 0; i < lines.length; i++) outlined(ctx, lines[i], x, y + i * lh, size, colour, align, weight, outline);
  return lines.length * lh;
}

// ---- weapon icons ----

function poly(ctx, a) {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  for (let i = 2; i < a.length; i += 2) ctx.lineTo(a[i], a[i + 1]);
  ctx.closePath();
  ctx.fill();
}

// Small side-on silhouettes, drawn in a 22 x 14 unit box centred on (cx, cy) and scaled to width w.
export function weaponIcon(ctx, id, cx, cy, w, colour) {
  const k = w / 22;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.fillStyle = colour;
  switch (id) {
    case 'pistol':
      rrect(ctx, -9, -5, 17, 5, 1.5);
      ctx.fill();
      ctx.fillRect(8, -4, 2, 3);
      poly(ctx, [-6, 0, -1, 0, -2.5, 7, -7, 7]);
      break;
    case 'shotgun':
      ctx.fillRect(-2, -4.5, 13, 3);
      ctx.fillRect(-2, -0.5, 10, 2.5);
      ctx.fillRect(-8, -4.5, 7, 5.5);
      poly(ctx, [-11, -3, -8, -3, -8, 4, -11, 6]);
      ctx.fillRect(10, -5.5, 1.5, 5);
      break;
    case 'smg':
      ctx.fillRect(-8, -5.5, 15, 5);
      ctx.fillRect(7, -4.5, 4, 2.4);
      ctx.fillRect(-3, -0.5, 3.5, 8.5);
      poly(ctx, [-8, -0.5, -4.5, -0.5, -5.5, 5, -8.5, 5]);
      break;
    case 'launcher':
      rrect(ctx, -10, -4.5, 15, 9, 3);
      ctx.fill();
      poly(ctx, [5, -4.5, 11, -8, 11, 8, 5, 4.5]);
      ctx.fillRect(-4, 4, 3, 5);
      break;
    case 'vinyl': // a record with a spindle hole, and a notch for the flinger
      ctx.beginPath();
      ctx.arc(0, 0, 6.5, 0, TAU);
      ctx.moveTo(2.6, 0);
      ctx.arc(0, 0, 2.6, 0, TAU, true);
      ctx.fill('evenodd');
      ctx.fillRect(7, -1, 5, 2);
      break;
    case 'beam': // a microphone ball on a wedge, with rays
      rrect(ctx, -10, -4, 13, 8, 1.5);
      ctx.fill();
      poly(ctx, [-8, 3, -3, 3, -4.5, 9, -9, 9]);
      ctx.fillRect(3, -1, 3, 2);
      ctx.beginPath();
      ctx.arc(8.5, 0, 3.6, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = colour;
      ctx.beginPath();
      ctx.moveTo(12.5, -3); ctx.lineTo(15, -5.5);
      ctx.moveTo(12.8, 0); ctx.lineTo(16, 0);
      ctx.moveTo(12.5, 3); ctx.lineTo(15, 5.5);
      ctx.stroke();
      break;
    case 'grenade': // a drum on a handle
      rrect(ctx, -6.5, -8, 13, 9, 2.5);
      ctx.fill();
      ctx.fillRect(-2.2, 0.5, 4.4, 8);
      ctx.fillRect(-4, 7.5, 8, 2);
      break;
    case 'airhorn': // a flared horn on a can
      poly(ctx, [-9, -1.4, 0, -2.4, 10, -7, 10, 7, 0, 2.4, -9, 1.4]);
      rrect(ctx, -9, 1, 5.5, 8, 1.5);
      ctx.fill();
      break;
    default:
      rrect(ctx, -8, -5, 16, 10, 3);
      ctx.fill();
  }
  ctx.restore();
}

// ---- panels ----

// Mid-grey translucent panel with a dark outer line and a light inner one, so it reads on bright and dark scenes.
export function panel(ctx, x, y, w, h, r, fill, light, lightA = 0.5) {
  rrect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.38)';
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = lightA;
  ctx.strokeStyle = light;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function corners(ctx, x, y, w, h, inset, len) {
  const x0 = x + inset;
  const y0 = y + inset;
  const x1 = x + w - inset;
  const y1 = y + h - inset;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + len); ctx.lineTo(x0, y0); ctx.lineTo(x0 + len, y0);
  ctx.moveTo(x1 - len, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + len);
  ctx.moveTo(x1, y1 - len); ctx.lineTo(x1, y1); ctx.lineTo(x1 - len, y1);
  ctx.moveTo(x0 + len, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - len);
  ctx.stroke();
}

export function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

// ---- control boxes ----

// Knob offset from nx, ny (-1..1 each), kept inside the unit circle so the knob never leaves its ring.
function stickOffset(s, reach, out) {
  let nx = clamp(num(s && s.nx), -1, 1);
  let ny = clamp(num(s && s.ny), -1, 1);
  const len = Math.hypot(nx, ny);
  if (len > 1) { nx /= len; ny /= len; }
  out.x = nx * reach;
  out.y = ny * reach;
}

const off = { x: 0, y: 0 };

function drawMoveBox(ctx, b, st, t) {
  const active = !!(st && st.active);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  panel(ctx, b.x, b.y, b.w, b.h, 18, active ? 'rgba(150,154,168,0.44)' : 'rgba(120,124,138,0.34)', '#ffffff', active ? 0.75 : 0.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  corners(ctx, b.x, b.y, b.w, b.h, 8, 10);

  // faint guide ring and four chevrons so it reads as a stick
  const ringR = b.w * 0.3;
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  circle(ctx, cx, cy, ringR);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  const cd = b.w * 0.36;
  const cs = 4;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const px = cx + ux * cd;
    const py = cy + uy * cd;
    ctx.beginPath();
    ctx.moveTo(px + ux * cs, py + uy * cs);
    ctx.lineTo(px - ux * cs - uy * cs, py - uy * cs + ux * cs);
    ctx.lineTo(px - ux * cs + uy * cs, py - uy * cs - ux * cs);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  outlined(ctx, 'MOVE', cx, b.y + 14, 11, 'rgba(255,255,255,0.6)', 'center', 800);

  const kr = b.w * 0.19;
  stickOffset(st, b.w / 2 - kr - 9, off);
  const kx = cx + (active ? off.x : 0);
  const ky = cy + (active ? off.y : 0);
  if (active) {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(kx, ky);
    ctx.stroke();
  }
  circle(ctx, kx, ky, kr);
  ctx.fillStyle = active ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.3)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();
  circle(ctx, kx, ky, kr * 0.45);
  ctx.fillStyle = active ? 'rgba(150,154,168,0.9)' : 'rgba(255,255,255,0.18)';
  ctx.fill();
  void t;
}

function drawLookBox(ctx, b, st, firing, t) {
  const active = !!(st && st.active);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  panel(ctx, b.x, b.y, b.w, b.h, 18, active ? 'rgba(150,154,168,0.44)' : 'rgba(120,124,138,0.34)', '#ffffff', active ? 0.75 : 0.5);
  if (firing) {
    // cyan wash plus a heavier cyan frame: unmistakable even in the corner of the eye
    const pulse = 0.5 + 0.5 * Math.sin(t * 22);
    rrect(ctx, b.x, b.y, b.w, b.h, 18);
    ctx.fillStyle = CYAN;
    ctx.globalAlpha = 0.16 + 0.07 * pulse;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = firing ? CYAN : 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  corners(ctx, b.x, b.y, b.w, b.h, 8, 10);

  // faint reticle at rest
  if (!active) {
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    const r = b.w * 0.16;
    circle(ctx, cx, cy, r);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r - 7, cy); ctx.lineTo(cx - r + 4, cy);
    ctx.moveTo(cx + r - 4, cy); ctx.lineTo(cx + r + 7, cy);
    ctx.moveTo(cx, cy - r - 7); ctx.lineTo(cx, cy - r + 4);
    ctx.moveTo(cx, cy + r - 4); ctx.lineTo(cx, cy + r + 7);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  outlined(ctx, firing ? 'FIRING' : 'AIM + FIRE', cx, b.y + 14, 11, firing ? CYAN : 'rgba(255,255,255,0.6)', 'center', 800);

  if (active) {
    const dr = b.w * 0.095;
    stickOffset(st, b.w / 2 - dr - 14, off);
    const dx = cx + off.x;
    const dy = cy + off.y;
    ctx.strokeStyle = firing ? 'rgba(34,211,238,0.45)' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(dx, dy);
    ctx.stroke();
    if (firing) {
      // ripples leave the finger, like blasts
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 2; i++) {
        const k = (t * 3.2 + i * 0.5) % 1;
        ctx.globalAlpha = (1 - k) * 0.85;
        circle(ctx, dx, dy, dr + 4 + k * b.w * 0.2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    circle(ctx, dx, dy, dr);
    ctx.fillStyle = firing ? CYAN : 'rgba(255,255,255,0.88)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    circle(ctx, dx, dy, dr * 0.42);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
}

// ---- buttons ----

function drawReload(ctx, b, w, t) {
  const reloading = w && w.reload !== null && w.reload !== undefined;
  const empty = w && num(w.clip, 1) <= 0 && !reloading;
  const pulse = 0.5 + 0.5 * Math.sin(t * 9);
  panel(ctx, b.x, b.y, b.w, b.h, 11, empty ? 'rgba(251,191,36,0.26)' : 'rgba(120,124,138,0.34)', empty ? AMBER : '#ffffff', empty ? 0.5 + 0.5 * pulse : 0.5);
  if (empty) {
    rrect(ctx, b.x, b.y, b.w, b.h, 11);
    ctx.fillStyle = AMBER;
    ctx.globalAlpha = 0.12 + 0.3 * pulse;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  let label = 'RELOAD';
  if (reloading) {
    const p = clamp(num(w.reload), 0, 1);
    const fw = (b.w - 6) * p;
    if (fw > 1) {
      rrect(ctx, b.x + 3, b.y + 3, fw, b.h - 6, Math.min(8, fw / 2));
      ctx.fillStyle = CYAN;
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    label = 'RELOADING';
  }
  const f = fit(ctx, label, b.w - 12, 13, 800, 9);
  outlined(ctx, f.str, b.x + b.w / 2, b.y + b.h / 2 + 0.5, f.size, empty ? '#ffe9a8' : '#ffffff', 'center', 800);
}

function drawSwap(ctx, b) {
  panel(ctx, b.x, b.y, b.w, b.h, 11, 'rgba(120,124,138,0.34)', '#ffffff');
  const f = fit(ctx, 'SWAP', b.w - 38, 13, 800, 9);
  const mid = b.x + b.w / 2;
  outlined(ctx, f.str, mid + 10, b.y + b.h / 2 + 0.5, f.size, '#ffffff', 'center', 800);
  // circular arrow
  const ix = mid - f.w / 2 - 5;
  const iy = b.y + b.h / 2;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(ix, iy, 6, -2.6, 1.2);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  const ex = ix + Math.cos(1.2) * 6;
  const ey = iy + Math.sin(1.2) * 6;
  ctx.moveTo(ex + 3.8, ey - 2.6);
  ctx.lineTo(ex - 4.4, ey - 2.2);
  ctx.lineTo(ex + 0.6, ey + 3.8);
  ctx.closePath();
  ctx.fill();
}

// ---- readouts ----

function drawAmmo(ctx, view, L, w, t) {
  // Between the two buttons: the gap between the boxes themselves is too narrow on a 360 px phone.
  const gx0 = L.swapBtn.x + L.swapBtn.w + 3;
  const gx1 = L.reloadBtn.x - 3;
  const gw = Math.max(40, gx1 - gx0);
  const cx = (gx0 + gx1) / 2;
  const y = L.swapBtn.y;
  const clip = Math.max(0, Math.floor(num(w && w.clip)));
  const size = num(w && w.clipSize, 0);
  const reloading = w && w.reload !== null && w.reload !== undefined;
  const frac = size > 0 ? clip / size : 1;
  let colour = '#ffffff';
  if (clip <= 0) colour = Math.sin(t * 9) > 0 ? RED : '#ff8a8a';
  else if (frac <= 0.34) colour = AMBER;
  const meter = !!(w && w.meter); // the Feedback Beam has a charge meter in place of a clip
  const f = fit(ctx, meter ? `${Math.round(frac * 100)}%` : `${clip} / ∞`, gw, 25, 800, 13);
  ctx.globalAlpha = reloading ? 0.5 : 1;
  outlined(ctx, f.str, cx, y + 12, f.size, colour, 'center', 800);
  ctx.globalAlpha = 1;
  if (reloading) {
    const bw = Math.min(gw, 62);
    rrect(ctx, cx - bw / 2, y + 25, bw, 4, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    const p = clamp(num(w.reload), 0, 1);
    if (p > 0.03) {
      rrect(ctx, cx - bw / 2, y + 25, bw * p, 4, 2);
      ctx.fillStyle = CYAN;
      ctx.fill();
    }
  } else if (meter) {
    const bw = Math.min(gw, 62);
    rrect(ctx, cx - bw / 2, y + 25, bw, 4, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    if (frac > 0.03) {
      rrect(ctx, cx - bw / 2, y + 25, bw * clamp(frac, 0, 1), 4, 2);
      ctx.fillStyle = frac <= 0.25 ? AMBER : '#7ff0ff';
      ctx.fill();
    }
  }
  const name = fit(ctx, str(w && w.name), gw, 11, 700, 7.5);
  outlined(ctx, name.str, cx, y + 34, name.size, 'rgba(34,211,238,0.95)', 'center', 700);
}

function drawHealth(ctx, view, h, top, t) {
  const max = Math.max(1, num(h.maxHealth, 100));
  const hp = clamp(num(h.health, 0), 0, max);
  const f = hp / max;
  const low = f < 0.3;
  const y = top + 16;
  const sl = sideSafe(view).left;
  const hx = 16 + sl + 9;
  const bx = 16 + sl + 24;
  const bw = clamp(view.w * 0.29, 88, 124);
  const pulse = low ? 0.5 + 0.5 * Math.sin(t * 10) : 0;
  heart(ctx, hx, y, 11.5);
  ctx.fillStyle = low ? (pulse > 0.5 ? RED : MAGENTA) : MAGENTA;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(4,2,8,0.7)';
  ctx.stroke();
  rrect(ctx, bx, y - 7, bw, 14, 7);
  ctx.fillStyle = 'rgba(4,2,8,0.6)';
  ctx.fill();
  const fw = (bw - 4) * f;
  if (fw > 1) {
    rrect(ctx, bx + 2, y - 5, fw, 10, Math.min(5, fw / 2));
    ctx.fillStyle = low ? (pulse > 0.5 ? RED : '#ff5c5c') : MAGENTA;
    ctx.fill();
    // highlight strip: gives the bar some body without a gradient
    rrect(ctx, bx + 2, y - 5, fw, 4, Math.min(2, fw / 2));
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fill();
  }
  rrect(ctx, bx, y - 7, bw, 14, 7);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = low ? RED : 'rgba(255,255,255,0.4)';
  ctx.stroke();
  const n = fit(ctx, String(Math.ceil(hp)), 44, 15, 800, 10);
  outlined(ctx, n.str, bx + bw + 7, y + 0.5, n.size, low ? '#ff8a8a' : '#ffffff', 'left', 800);
}

const BUFF_COLOURS = { speed: '#fb923c', guard: '#d6a45a', rapid: '#e879f9' };
const BUFF_LABELS = { speed: 'FAST', guard: 'TOUGH', rapid: 'RAPID' };

// Timed drink effects: small pills stacked above the move box, each draining as its effect runs out.
function drawBuffs(ctx, L, buffs) {
  const x = L.moveBox.x;
  const w = L.moveBox.w;
  let y = L.moveBox.y - 30;
  for (const b of buffs) {
    const colour = BUFF_COLOURS[b.id] || AMBER;
    const f = clamp(num(b.t) / Math.max(0.001, num(b.max, 1)), 0, 1);
    rrect(ctx, x, y, w, 20, 10);
    ctx.fillStyle = 'rgba(4,2,8,0.62)';
    ctx.fill();
    if (f > 0.02) {
      rrect(ctx, x + 2, y + 2, (w - 4) * f, 16, 8);
      ctx.globalAlpha = f < 0.2 ? 0.45 + 0.35 * Math.sin(now() * 14) : 0.78;
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    outlined(ctx, `${BUFF_LABELS[b.id] || str(b.id).toUpperCase()}  ${Math.ceil(num(b.t))}s`, x + w / 2, y + 10.5, 10.5, '#ffffff', 'center', 800);
    y -= 24;
  }
}

function drawWeapons(ctx, view, ws, top) {
  const n = Math.min(ws.length, 8);
  if (!n) return;
  const gap = n > 6 ? 3 : 4;
  const cw = Math.min(34, (Math.max(60, view.w * (n > 6 ? 0.47 : 0.4)) - gap * (n - 1)) / n);
  const ch = 26;
  let x = view.w - 16 - sideSafe(view).right - n * cw - (n - 1) * gap;
  const y = top + 3;
  for (let i = 0; i < n; i++) {
    const w = ws[i] || {};
    const owned = !!w.owned;
    const active = !!w.active;
    rrect(ctx, x, y, cw, ch, 7);
    ctx.fillStyle = active ? 'rgba(34,211,238,0.28)' : owned ? 'rgba(4,2,8,0.55)' : 'rgba(4,2,8,0.3)';
    ctx.fill();
    ctx.lineWidth = active ? 2 : 1.2;
    ctx.strokeStyle = active ? CYAN : owned ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.14)';
    ctx.stroke();
    ctx.globalAlpha = owned ? 1 : 0.28;
    weaponIcon(ctx, w.id, x + cw / 2, y + ch / 2, Math.min(22, cw - (n > 6 ? 5 : 8)), owned ? (WEAPON_COLOURS[w.id] || '#e5e0f5') : '#c9c2e0');
    ctx.globalAlpha = 1;
    x += cw + gap;
  }
}

function drawBoss(ctx, view, boss, y) {
  const ss = sideSafe(view);
  const x = 16 + ss.left;
  const bw = view.w - 32 - ss.left - ss.right;
  const max = Math.max(1, num(boss.maxHp, 1));
  const f = clamp(num(boss.hp, 0) / max, 0, 1);
  rrect(ctx, x, y, bw, 16, 8);
  ctx.fillStyle = 'rgba(4,2,8,0.62)';
  ctx.fill();
  const fw = (bw - 4) * f;
  if (fw > 1) {
    rrect(ctx, x + 2, y + 2, fw, 12, Math.min(6, fw / 2));
    ctx.fillStyle = '#d6232b';
    ctx.fill();
    rrect(ctx, x + 2, y + 2, fw, 4.5, Math.min(2.2, fw / 2));
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fill();
  }
  rrect(ctx, x, y, bw, 16, 8);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,120,120,0.7)';
  ctx.stroke();
  const f2 = fit(ctx, str(boss.name).toUpperCase(), bw - 24, 10.5, 800, 8);
  outlined(ctx, f2.str, view.w / 2, y + 8.5, f2.size, '#ffffff', 'center', 800);
}

// ---- the arsenal: the SMG's alt-fire and the upgrades owned ----

// Mobile mode: a small ALT button above the aim box, drawn only while the SMG is in hand with its pedal fitted. A fill rises
// while it recharges. PC mode: a pill above the ammo readout that names the keys.
function drawAlt(ctx, L, alt, compact, t) {
  const cd = clamp(num(alt.cd), 0, 1);
  const ready = cd <= 0;
  const pulse = 0.5 + 0.5 * Math.sin(t * 8);
  let b = L.altBtn;
  if (compact) {
    const w = 118;
    const cx = (L.swapBtn.x + L.swapBtn.w + L.reloadBtn.x) / 2;
    b = { x: cx - w / 2, y: L.swapBtn.y - 28, w, h: 20 };
  }
  panel(ctx, b.x, b.y, b.w, b.h, compact ? 10 : 11, ready ? 'rgba(139,108,255,0.3)' : 'rgba(120,124,138,0.34)', ready ? '#c4b5fd' : '#ffffff', ready ? 0.6 + 0.4 * pulse : 0.5);
  if (!ready) {
    ctx.save();
    rrect(ctx, b.x + 2, b.y + 2, b.w - 4, b.h - 4, compact ? 8 : 9);
    ctx.clip();
    ctx.fillStyle = 'rgba(8,4,16,0.5)';
    ctx.fillRect(b.x, b.y, b.w * cd, b.h);
    ctx.restore();
  }
  const label = compact ? (ready ? 'E  BURST READY' : `E  BURST ${Math.max(0, num(alt.secs)).toFixed(1)}s`) : 'ALT';
  const f = fit(ctx, label, b.w - 10, compact ? 11 : 15, 800, 8);
  outlined(ctx, f.str, b.x + b.w / 2, b.y + b.h / 2 + 0.5, f.size, ready ? '#ede9fe' : 'rgba(255,255,255,0.6)', 'center', 800);
}

const UPGRADE_COLOURS = { clip: '#fbbf24', reload: '#22d3ee', altfire: '#a78bfa' };

// Upgrades owned: small chips down the right edge under the weapon row, each a glyph with a pip per tier.
function drawUpgrades(ctx, view, up, y0) {
  const x = view.w - 16 - sideSafe(view).right - 26;
  let y = y0;
  for (const id of ['clip', 'reload', 'altfire']) {
    const tier = Math.floor(num(up && up[id]));
    if (tier < 1) continue;
    const colour = UPGRADE_COLOURS[id];
    rrect(ctx, x, y, 26, 24, 7);
    ctx.fillStyle = 'rgba(4,2,8,0.55)';
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = colour;
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.strokeStyle = colour;
    const cx = x + 13;
    const cy = y + 10;
    if (id === 'clip') { // a magazine
      ctx.lineWidth = 1.6;
      rrect(ctx, cx - 4.5, cy - 6.5, 9, 13, 2);
      ctx.stroke();
      for (let i = 0; i < 3; i++) ctx.fillRect(cx - 2.4, cy - 4 + i * 3.4, 4.8, 1.8);
    } else if (id === 'reload') { // a circular arrow
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, 5, -2.5, 1.5);
      ctx.stroke();
      poly(ctx, [cx + 0.5, cy + 5.2, cx + 5.4, cy + 2.4, cx + 4.6, cy + 7.2]);
    } else { // a bolt
      poly(ctx, [cx + 1.5, cy - 7, cx - 4, cy + 1, cx - 0.4, cy + 1, cx - 1.8, cy + 7, cx + 4, cy - 1.2, cx + 0.4, cy - 1.2]);
    }
    for (let i = 0; i < Math.min(tier, 3); i++) { // a pip per tier
      circle(ctx, cx - (Math.min(tier, 3) - 1) * 2.5 + i * 5, y + 20.2, 1.5);
      ctx.fill();
    }
    y += 28;
  }
}

// ---- screen effects ----

const vignetteCache = new WeakMap();

// Drawn in an ellipse-scaled unit space so the red hugs the edges of a tall phone screen as well as a wide one.
function drawVignette(ctx, view, k) {
  let g = vignetteCache.get(ctx);
  if (!g) {
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.45);
    g.addColorStop(0, 'rgba(255,0,40,0)');
    g.addColorStop(0.5, 'rgba(255,0,40,0)');
    g.addColorStop(0.72, 'rgba(255,0,40,0.3)');
    g.addColorStop(1, 'rgba(255,0,40,0.8)');
    vignetteCache.set(ctx, g);
  }
  ctx.save();
  ctx.translate(view.w / 2, view.h / 2);
  ctx.scale(view.w / 2, view.h / 2);
  ctx.globalAlpha = clamp(k, 0, 1);
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawDamageArcs(ctx, cx, cy, ring, dirs) {
  const n = Math.min(dirs.length, 8);
  for (let i = 0; i < n; i++) {
    const d = dirs[i];
    if (!d) continue;
    const a = num(d.bearing) - Math.PI / 2; // canvas 0 is right, bearing 0 is ahead (up)
    const k = clamp(num(d.t), 0, 1);
    if (k <= 0) continue;
    const half = 0.34;
    ctx.beginPath();
    ctx.arc(cx, cy, ring + 14, a - half, a + half);
    ctx.arc(cx, cy, ring, a + half, a - half, true);
    ctx.closePath();
    ctx.globalAlpha = Math.min(1, k * 1.3) * 0.92;
    ctx.fillStyle = RED;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,200,200,0.8)';
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawCrosshair(ctx, cx, cy) {
  const gap = 5;
  const len = 9;
  ctx.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    ctx.lineWidth = pass ? 2 : 4.5;
    ctx.strokeStyle = pass ? 'rgba(255,255,255,0.95)' : 'rgba(4,2,8,0.6)';
    ctx.beginPath();
    ctx.moveTo(cx - gap - len, cy); ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
    ctx.moveTo(cx, cy - gap - len); ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
    ctx.stroke();
  }
  circle(ctx, cx, cy, 1.6);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

const DIAG = Math.SQRT1_2;

function drawHitMarker(ctx, cx, cy, k, head) {
  if (k <= 0) return;
  const r0 = 9 + (1 - k) * 5;
  const len = head ? 11 : 7;
  const r1 = r0 + len;
  ctx.lineCap = 'round';
  ctx.globalAlpha = Math.min(1, k * 1.4);
  for (let pass = 0; pass < 2; pass++) {
    ctx.lineWidth = (head ? 3.4 : 2.4) + (pass ? 0 : 2.6);
    ctx.strokeStyle = pass ? (head ? '#ff4040' : '#ffffff') : 'rgba(4,2,8,0.6)';
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const sx = i & 1 ? 1 : -1;
      const sy = i & 2 ? 1 : -1;
      ctx.moveTo(cx + sx * DIAG * r0, cy + sy * DIAG * r0);
      ctx.lineTo(cx + sx * DIAG * r1, cy + sy * DIAG * r1);
    }
    ctx.stroke();
  }
  if (head) {
    circle(ctx, cx, cy, r1 + 3 + (1 - k) * 6);
    ctx.lineWidth = 2;
    ctx.strokeStyle = AMBER;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawToast(ctx, view, toast, y) {
  const k = clamp(num(toast.t) / 0.5, 0, 1);
  if (k <= 0) return;
  const s = str(toast.text);
  if (!s) return;
  const f = fit(ctx, s, view.w - 56, 14, 600, 10);
  const w = f.w + 26;
  ctx.globalAlpha = k;
  rrect(ctx, (view.w - w) / 2, y - 14, w, 28, 14);
  ctx.fillStyle = 'rgba(4,2,8,0.6)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(201,194,224,0.35)';
  ctx.stroke();
  outlined(ctx, f.str, view.w / 2, y + 0.5, f.size, '#e5e0f5', 'center', 600, 'rgba(4,2,8,0)');
  ctx.globalAlpha = 1;
}

function drawBanner(ctx, view, b) {
  const tLeft = num(b.t);
  const max = Math.max(0.01, num(b.max, tLeft || 1));
  const age = max - tLeft;
  const k = Math.min(1, tLeft / 0.7) * Math.min(1, Math.max(0, age) / 0.12 + 0.01);
  if (k <= 0) return;
  const title = str(b.title);
  const sub = str(b.sub);
  const land = isLandscape(view); // short screen: lower, so it clears the objective text at the top
  const cy = view.h * (land ? 0.4 : 0.3);
  const ft = fit(ctx, title, view.w - 40, land ? 34 : 42, 800, 18);
  let subLines = null;
  let subH = 0;
  if (sub) {
    subLines = wrapLines(ctx, sub, view.w - 56, 16, 600, 3);
    subH = subLines.length * 22;
  }
  ctx.globalAlpha = k;
  // soft band behind the words keeps them legible over a bright wall
  ctx.fillStyle = 'rgba(4,2,8,0.3)';
  ctx.fillRect(0, cy - 30, view.w, 60 + (subH ? subH - 6 : 0));
  const pop = 1 + 0.22 * Math.max(0, 1 - age / 0.2);
  ctx.save();
  ctx.translate(view.w / 2, cy);
  ctx.scale(pop, pop);
  outlined(ctx, ft.str, 0, 0, ft.size, MAGENTA, 'center', 800);
  ctx.restore();
  if (subLines) {
    for (let i = 0; i < subLines.length; i++) outlined(ctx, subLines[i], view.w / 2, cy + 30 + i * 22, 16, '#e5e0f5', 'center', 600);
  }
  ctx.globalAlpha = 1;
}

function fmtTime(sec) {
  const s = Math.floor(clamp(num(sec), 0, 5999 * 60 + 59));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

function drawDebugBadge(ctx, view, y) {
  const w = 72;
  const x = view.w - 16 - sideSafe(view).right - w;
  rrect(ctx, x, y - 8, w, 16, 8);
  ctx.fillStyle = 'rgba(251,191,36,0.2)';
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = AMBER;
  ctx.stroke();
  outlined(ctx, 'DEBUG MODE', x + w / 2, y + 0.5, 9, AMBER, 'center', 800, 'rgba(4,2,8,0)');
}

// ---- main entry ----

const EMPTY = [];

export function drawPlayHud(ctx, view, h) {
  const t = num(h.t, now());
  const sf = view.safe || ZERO_SAFE;
  const top = num(sf.top);
  const L = layout(view);
  const cx = view.w / 2;
  const cy = view.h / 2;
  const w = h.weapon || null;
  const dirs = Array.isArray(h.damageDirs) ? h.damageDirs : EMPTY;
  ctx.save();

  if (num(h.hurt) > 0) drawVignette(ctx, view, h.hurt);
  if (dirs.length) drawDamageArcs(ctx, cx, cy, clamp(Math.min(view.w, view.h) * 0.2, 66, 104), dirs);
  // Last Orders pulls the game into third person: the aiming furniture steps aside
  const cine = clamp(num(h.cinematic), 0, 1);
  const furniture = cine < 0.3;
  if (furniture) {
    drawCrosshair(ctx, cx, cy);
    drawHitMarker(ctx, cx, cy, clamp(num(h.hitMarker), 0, 1), !!h.headshot);
  }

  // top left: health, then score and time
  drawHealth(ctx, view, h, top, t);
  outlined(ctx, `SCORE ${Math.floor(clamp(num(h.score), 0, 1e12))}   ${fmtTime(h.timeSec)}`, 18 + sideSafe(view).left, top + 40, 11, 'rgba(255,255,255,0.8)', 'left', 700);

  // top right: weapon row, then the debug badge
  if (furniture) drawWeapons(ctx, view, Array.isArray(h.weapons) ? h.weapons : EMPTY, top);
  if (h.debugMode) drawDebugBadge(ctx, view, top + 40);
  if (furniture && h.upgrades) drawUpgrades(ctx, view, h.upgrades, top + (h.debugMode ? 58 : 36));

  // top centre: area, objective, status
  const maxW = view.w - 32 - 2 * Math.max(sideSafe(view).left, sideSafe(view).right);
  let y = top + 60;
  const area = str(h.areaName);
  if (area) {
    const f = fit(ctx, area, maxW, 11, 800, 8);
    outlined(ctx, f.str, cx, y, f.size, 'rgba(34,211,238,0.9)', 'center', 800);
  }
  y += 19;
  const obj = str(h.objective);
  if (obj) {
    const f = fit(ctx, obj, maxW, 15, 800, 10);
    outlined(ctx, f.str, cx, y, f.size, '#ffffff', 'center', 800);
  }
  y += 19;
  if (typeof h.enemiesLeft === 'number' && Number.isFinite(h.enemiesLeft) && h.enemiesLeft >= 0) {
    if (h.enemiesLeft === 0) {
      const f = fit(ctx, 'Area clear, go through the door', maxW, 12.5, 700, 9);
      outlined(ctx, f.str, cx, y, f.size, '#86efac', 'center', 700);
    } else {
      const n = Math.floor(h.enemiesLeft);
      outlined(ctx, `${n} ${n === 1 ? 'robot' : 'robots'} left`, cx, y, 12.5, MAGENTA, 'center', 700);
    }
  }
  y += 14;
  if (h.boss) {
    drawBoss(ctx, view, h.boss, y);
    y += 22;
  }
  if (h.toast) drawToast(ctx, view, h.toast, y + 18);

  // controls (with mouse look the boxes and buttons go: the mouse and keys do their jobs)
  if (furniture) {
    if (!h.compact) {
      drawMoveBox(ctx, L.moveBox, h.move, t);
      drawLookBox(ctx, L.lookBox, h.look, !!h.firing, t);
      drawReload(ctx, L.reloadBtn, w, t);
      drawSwap(ctx, L.swapBtn);
    }
    drawAmmo(ctx, view, L, w, t);
    if (h.alt) drawAlt(ctx, L, h.alt, !!h.compact, t);
  }
  if (h.hint) {
    const f = fit(ctx, str(h.hint), view.w - 48, 15, 800, 10);
    const bw = f.w + 30;
    rrect(ctx, cx - bw / 2, cy + 52, bw, 32, 16);
    ctx.fillStyle = 'rgba(4,2,8,0.7)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = CYAN;
    ctx.stroke();
    outlined(ctx, f.str, cx, cy + 68, f.size, '#ffffff', 'center', 800, 'rgba(4,2,8,0)');
  }
  if (Array.isArray(h.buffs) && h.buffs.length) drawBuffs(ctx, L, h.buffs);

  if (h.banner) drawBanner(ctx, view, h.banner);
  ctx.restore();
}
