// Shared 2D drawing helpers for the HUD and menu screens. Nothing here owns state.

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
