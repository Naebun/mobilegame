// Flat-vector drawing helpers. Nothing here owns state: everything is passed in, so game.js stays about rules.

const TAU = Math.PI * 2;

export const hash = (i, j, n = 0) => ((i * 73856093) ^ (j * 19349663) ^ (n * 83492791)) >>> 0;

export function text(ctx, str, x, y, size, colour, align = 'center', weight = 700) {
  ctx.font = `${weight} ${size}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colour;
  ctx.fillText(str, x, y);
}

export function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function heart(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 0.9, y - s * 0.2, x - s * 0.5, y - s * 0.9, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.5, y - s * 0.9, x + s * 0.9, y - s * 0.2, x, y + s * 0.35);
  ctx.closePath();
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

// ---- floors ----

export function drawFloor(ctx, a, f, beat) {
  const w = a.x1 - a.x0;
  const h = a.y1 - a.y0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(a.x0, a.y0, w, h);
  ctx.clip();

  if (f.pattern === 'tiles') {
    const T = 44;
    for (let j = 0; j < Math.ceil(h / T); j++) {
      for (let i = 0; i < Math.ceil(w / T); i++) {
        const x = a.x0 + i * T + 1;
        const y = a.y0 + j * T + 1;
        ctx.fillStyle = (i + j) & 1 ? f.a : f.b;
        ctx.fillRect(x, y, T - 2, T - 2);
        if (hash(i, j, beat.count) % 100 < 14) {
          ctx.globalAlpha = 0.06 + 0.3 * beat.pulse;
          ctx.fillStyle = f.lit[(i + j + beat.count) % f.lit.length];
          ctx.fillRect(x, y, T - 2, T - 2);
          ctx.globalAlpha = 1;
        }
      }
    }
  } else if (f.pattern === 'cobbles') {
    ctx.fillStyle = f.base;
    ctx.fillRect(a.x0, a.y0, w, h);
    const H = 22;
    const W = 34;
    for (let j = 0; j < Math.ceil(h / H); j++) {
      const off = j & 1 ? W / 2 : 0;
      for (let i = -1; i < Math.ceil(w / W) + 1; i++) {
        ctx.fillStyle = f.stones[hash(i, j, 3) % f.stones.length];
        ctx.fillRect(a.x0 + i * W - off + 1.5, a.y0 + j * H + 1.5, W - 3, H - 3);
      }
    }
  } else {
    ctx.fillStyle = f.base;
    ctx.fillRect(a.x0, a.y0, w, h);
    if (f.path) {
      ctx.save();
      ctx.translate((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2);
      ctx.rotate(-0.35);
      ctx.fillStyle = f.path;
      ctx.fillRect(-h, -28, h * 2, 56);
      ctx.restore();
    }
    const T = 24;
    ctx.fillStyle = f.tuft;
    for (let j = 0; j < Math.ceil(h / T); j++) {
      for (let i = 0; i < Math.ceil(w / T); i++) {
        const hv = hash(i, j, 7);
        if (hv % 3 === 0) continue;
        const x = a.x0 + i * T + (hv % 18);
        const y = a.y0 + j * T + ((hv >> 8) % 18);
        ctx.fillRect(x, y, 2, 6);
        ctx.fillRect(x + 4, y + 2, 2, 4);
        if (f.rock && hv % 17 === 0) {
          ctx.fillStyle = '#26302a';
          circle(ctx, x, y, 9);
          ctx.fill();
          ctx.fillStyle = f.tuft;
        }
      }
    }
  }
  ctx.restore();
  ctx.strokeStyle = f.wall;
  ctx.lineWidth = 4;
  ctx.strokeRect(a.x0, a.y0, w, h);
}

// ---- obstacles ----

export function drawObstacle(ctx, o, beat) {
  const { x, y, r } = o;
  switch (o.kind) {
    case 'speaker':
      ctx.fillStyle = '#14101c';
      ctx.strokeStyle = '#3b2f5a';
      ctx.lineWidth = 3;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.strokeRect(x - r, y - r, r * 2, r * 2);
      ctx.strokeStyle = `rgba(34,211,238,${0.3 + 0.5 * beat.pulse})`;
      circle(ctx, x, y, r * (0.55 + beat.pulse * 0.1));
      ctx.stroke();
      break;
    case 'bin':
      ctx.fillStyle = '#3f4651';
      circle(ctx, x, y, r);
      ctx.fill();
      ctx.fillStyle = '#58606c';
      circle(ctx, x, y, r * 0.72);
      ctx.fill();
      break;
    case 'lamp':
      ctx.fillStyle = '#0c0c10';
      circle(ctx, x, y, r * 0.55);
      ctx.fill();
      ctx.strokeStyle = '#55555f';
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    case 'monument':
      ctx.fillStyle = '#4b5060';
      circle(ctx, x, y, r);
      ctx.fill();
      ctx.fillStyle = '#6b7080';
      circle(ctx, x, y, r * 0.65);
      ctx.fill();
      ctx.fillStyle = '#8a8fa0';
      circle(ctx, x, y, r * 0.3);
      ctx.fill();
      break;
    case 'tree':
      ctx.fillStyle = '#10261a';
      circle(ctx, x, y, r);
      ctx.fill();
      ctx.fillStyle = '#17362a';
      circle(ctx, x - r * 0.15, y - r * 0.15, r * 0.65);
      ctx.fill();
      break;
    default: // crag
      ctx.fillStyle = '#2f3732';
      circle(ctx, x, y, r);
      ctx.fill();
      ctx.fillStyle = '#3d4640';
      circle(ctx, x - r * 0.25, y - r * 0.2, r * 0.6);
      ctx.fill();
      ctx.fillStyle = '#262d29';
      circle(ctx, x + r * 0.45, y + r * 0.35, r * 0.4);
      ctx.fill();
  }
}

// Warm pools drawn on top of the darkness so lamps read as lit.
export function drawLampGlow(ctx, o, flicker) {
  const R = 78;
  const g = ctx.createRadialGradient(o.x, o.y, 2, o.x, o.y, R);
  g.addColorStop(0, `rgba(255,190,90,${0.38 * flicker})`);
  g.addColorStop(1, 'rgba(255,190,90,0)');
  ctx.fillStyle = g;
  ctx.fillRect(o.x - R, o.y - R, R * 2, R * 2);
  ctx.fillStyle = '#ffd98a';
  circle(ctx, o.x, o.y, 3.5);
  ctx.fill();
}

// ---- characters ----

export function drawFreddie(ctx, p, beat, t) {
  const blink = p.hurtT > 0 && Math.floor(t * 20) % 2 === 0;
  ctx.fillStyle = `rgba(34,211,238,${0.1 + 0.25 * beat.pulse})`;
  circle(ctx, p.x, p.y, p.r + 6 + beat.pulse * 5);
  ctx.fill();

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.aim);
  ctx.fillStyle = '#1f1b2e';
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 2;
  ctx.fillRect(8, -8, 22, 16);
  ctx.strokeRect(8, -8, 22, 16);
  circle(ctx, 24, 0, 4.5);
  ctx.stroke();
  ctx.fillStyle = blink ? '#ffffff' : '#6d28d9';
  circle(ctx, 0, 0, p.r);
  ctx.fill();
  ctx.fillStyle = '#ff2e93';
  ctx.fillRect(-p.r + 2, -2, p.r, 4);
  ctx.fillStyle = '#f0c8a0';
  circle(ctx, 1, 0, 8.5);
  ctx.fill();
  ctx.strokeStyle = '#0b0b12';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(0, 10);
  ctx.stroke();
  ctx.fillStyle = '#ff2e93';
  ctx.fillRect(-4, -14, 8, 6);
  ctx.fillRect(-4, 8, 8, 6);
  ctx.restore();
}

// Accessories are drawn in the enemy's local frame: +x is the way it is facing.
const ACCESSORY = {
  stag(ctx, e) {
    ctx.strokeStyle = e.accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, e.r - 2, Math.PI * 0.55, Math.PI * 1.45);
    ctx.stroke();
  },
  hen(ctx, e) {
    ctx.strokeStyle = e.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-e.r * 0.7, -e.r * 0.7);
    ctx.lineTo(e.r * 0.7, e.r * 0.7);
    ctx.stroke();
    ctx.strokeStyle = '#fbcfe8';
    ctx.lineWidth = 1.5;
    circle(ctx, -e.r * 0.1, 0, e.r * 0.45);
    ctx.stroke();
  },
  tourist(ctx, e) {
    ctx.fillStyle = e.accent;
    ctx.fillRect(-e.r * 1.2, -e.r * 0.5, e.r * 0.6, e.r);
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(e.r * 0.8, e.r * 0.6);
    ctx.lineTo(e.r * 2, e.r * 0.2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(e.r * 1.9, e.r * 0.05, 5, 8);
  },
  busker(ctx, e) {
    ctx.fillStyle = e.accent;
    circle(ctx, -e.r * 0.1, e.r * 0.85, e.r * 0.5);
    ctx.fill();
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-e.r * 0.1, e.r * 0.85);
    ctx.lineTo(e.r * 0.9, -e.r * 0.2);
    ctx.moveTo(-e.r * 0.3, e.r * 0.85);
    ctx.lineTo(-e.r * 0.8, -e.r * 0.6);
    ctx.stroke();
  },
  bouncer(ctx, e) {
    ctx.fillStyle = '#16161d';
    ctx.beginPath();
    ctx.ellipse(0, 0, e.r * 0.7, e.r * 1.1, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = e.accent;
    circle(ctx, e.r * 0.2, -e.r * 0.5, 2.5);
    ctx.fill();
  },
};

export function drawEnemy(ctx, e, t) {
  const bob = Math.sin(t * 6 + e.phase) * 2;
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.ang);
  ctx.fillStyle = e.flash > 0 ? '#ffffff' : e.colour;
  for (const side of [-1, 1]) {
    circle(ctx, e.r * 0.9 + bob, side * e.r * 0.65, e.r * 0.34);
    ctx.fill();
  }
  circle(ctx, 0, 0, e.r);
  ctx.fill();
  if (e.flash <= 0) ACCESSORY[e.type]?.(ctx, e);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  circle(ctx, e.r * 0.45, 0, e.r * 0.28);
  ctx.fill();
  ctx.restore();
}

export function drawBoss(ctx, e, t) {
  const r = e.r;
  const windup = e.state === 'windup';
  const flash = e.flash > 0 || (windup && Math.floor(t * 14) % 2 === 0);

  if (windup) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.ang);
    ctx.fillStyle = `rgba(255,40,40,${0.12 + 0.1 * Math.sin(t * 20)})`;
    ctx.fillRect(0, -r * 0.8, 900, r * 1.6);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.ang);
  const body = flash ? '#ffffff' : e.colour;
  for (const side of [-1, 1]) {
    ctx.fillStyle = flash ? '#ffffff' : '#7c9a8a';
    circle(ctx, r * 0.85, side * r * 0.7, r * 0.3);
    ctx.fill();
  }
  ctx.fillStyle = body;
  circle(ctx, 0, 0, r);
  ctx.fill();

  switch (e.bossId) {
    case 'bouncer':
      ctx.fillStyle = flash ? '#ffffff' : '#3b3b4a';
      ctx.beginPath();
      ctx.ellipse(-r * 0.1, 0, r * 0.55, r * 1.15, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#6f9a7a';
      circle(ctx, r * 0.15, 0, r * 0.4);
      ctx.fill();
      ctx.fillStyle = '#05050a';
      ctx.fillRect(r * 0.3, -r * 0.3, r * 0.2, r * 0.6);
      break;
    case 'guide': {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i & 1 ? '#b91c1c' : '#1f2937';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r * 1.15, (i * TAU) / 8, ((i + 1) * TAU) / 8);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#e5e7eb';
      circle(ctx, 0, 0, 4);
      ctx.fill();
      break;
    }
    case 'bestman':
      ctx.fillStyle = '#6f9a7a';
      circle(ctx, r * 0.1, 0, r * 0.42);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-r * 0.6, -r * 0.1, r * 0.5, r * 0.2);
      ctx.fillStyle = '#fbbf24';
      circle(ctx, r * 0.8, r * 0.7, r * 0.2);
      ctx.fill();
      ctx.fillStyle = '#ef4444';
      circle(ctx, -r * 0.2, -r * 0.55, 4);
      ctx.fill();
      break;
    case 'mascot':
      ctx.fillStyle = flash ? '#ffffff' : '#78350f';
      circle(ctx, -r * 0.2, -r * 0.95, r * 0.35);
      ctx.fill();
      circle(ctx, -r * 0.2, r * 0.95, r * 0.35);
      ctx.fill();
      ctx.fillStyle = '#fef3c7';
      circle(ctx, r * 0.35, -r * 0.35, r * 0.28);
      ctx.fill();
      circle(ctx, r * 0.35, r * 0.35, r * 0.28);
      ctx.fill();
      ctx.fillStyle = '#111';
      circle(ctx, r * 0.45, -r * 0.35, r * 0.1);
      ctx.fill();
      circle(ctx, r * 0.45, r * 0.35, r * 0.1);
      ctx.fill();
      break;
    default: { // headliner
      ctx.fillStyle = flash ? '#ffffff' : '#fbbf24';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rr = i & 1 ? r * 0.35 : r * 0.8;
        const ang = (i * Math.PI) / 5 - Math.PI / 2;
        ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e5e7eb';
      ctx.fillRect(r * 0.7, -2, r * 0.7, 4);
      circle(ctx, r * 1.45, 0, 5);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function drawEyes(ctx, e) {
  const c = Math.cos(e.ang);
  const s = Math.sin(e.ang);
  const big = e.boss ? 3.5 : 2.2;
  for (const side of [-1, 1]) {
    const x = e.x + c * e.r * 0.35 - s * side * e.r * 0.38;
    const y = e.y + s * e.r * 0.35 + c * side * e.r * 0.38;
    ctx.fillStyle = 'rgba(255,40,40,0.25)';
    circle(ctx, x, y, big * 2.3);
    ctx.fill();
    ctx.fillStyle = '#ff2a2a';
    circle(ctx, x, y, big);
    ctx.fill();
  }
}

export function drawBullet(ctx, b) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.ang);
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = 1 - i * 0.3;
    ctx.strokeStyle = i === 0 ? '#ffffff' : '#22d3ee';
    ctx.lineWidth = 3 - i * 0.6;
    ctx.beginPath();
    ctx.arc(-i * 7, 0, 8 + i * 2, -0.9, 0.9);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// Enemy shots are musical notes, because of course they are.
export function drawNote(ctx, b) {
  ctx.fillStyle = '#fb923c';
  ctx.strokeStyle = '#fb923c';
  ctx.lineWidth = 2;
  circle(ctx, b.x, b.y, 5);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(b.x + 4.5, b.y);
  ctx.lineTo(b.x + 4.5, b.y - 13);
  ctx.lineTo(b.x + 10, b.y - 9);
  ctx.stroke();
}

// ---- title backdrop: moon and a rough Old Town skyline ----

function poly(ctx, pts, w, base, H) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * w, base - pts[0][1] * H);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * w, base - pts[i][1] * H);
  ctx.closePath();
  ctx.fill();
}

export function drawSkyline(ctx, w, h) {
  const base = h;
  const H = Math.min(260, h * 0.3);

  ctx.fillStyle = '#d6d3f0';
  circle(ctx, w * 0.78, h * 0.12, 22);
  ctx.fill();
  ctx.fillStyle = '#0a0612';
  circle(ctx, w * 0.78 + 9, h * 0.12 - 4, 20);
  ctx.fill();

  ctx.fillStyle = '#140d24';
  // Arthur's Seat
  ctx.beginPath();
  ctx.moveTo(w * 0.6, base);
  ctx.bezierCurveTo(w * 0.72, base - H * 0.95, w * 0.88, base - H * 1.05, w * 1.02, base - H * 0.3);
  ctx.lineTo(w * 1.02, base);
  ctx.closePath();
  ctx.fill();
  // castle rock and castle
  poly(ctx, [
    [0, 0], [0, 0.75], [0.03, 0.75], [0.03, 0.88], [0.045, 0.88], [0.045, 0.8], [0.06, 0.8], [0.06, 0.92],
    [0.085, 0.92], [0.085, 1.0], [0.1, 1.0], [0.1, 0.9], [0.14, 0.9], [0.14, 0.82], [0.18, 0.78],
    [0.24, 0.55], [0.3, 0.38], [0.36, 0.3], [0.36, 0],
  ], w, base, H);
  // Royal Mile ridge with the St Giles crown and the Scott Monument spire
  poly(ctx, [
    [0.34, 0], [0.34, 0.3], [0.4, 0.34], [0.42, 0.46], [0.43, 0.46], [0.43, 0.54], [0.44, 0.62], [0.455, 0.84],
    [0.47, 0.62], [0.48, 0.54], [0.48, 0.46], [0.5, 0.42], [0.54, 0.36], [0.57, 0.3], [0.58, 0.3],
    [0.59, 0.6], [0.6, 0.92], [0.61, 0.6], [0.62, 0.3], [0.66, 0.2], [0.66, 0],
  ], w, base, H);
  // a few lit windows
  ctx.fillStyle = 'rgba(250,204,21,0.55)';
  for (let i = 0; i < 26; i++) {
    const hv = hash(i, 5, 11);
    const x = w * (0.38 + (hv % 100) / 100 * 0.24);
    const y = base - 6 - ((hv >> 8) % 100) / 100 * H * 0.22;
    ctx.fillRect(x, y, 2.5, 3);
  }
}
