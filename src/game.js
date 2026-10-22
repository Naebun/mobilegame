// Placeholder scene: a ball that chases your finger. Replace with the real game.

const state = { x: 0, y: 0, r: 28, trail: [] };

export function init(view) {
  state.x = view.w / 2;
  state.y = view.h / 2;
}

export function resize(view) {
  state.x = Math.min(state.x, view.w);
  state.y = Math.min(state.y, view.h);
}

export function update(dt, pointer) {
  if (pointer.down) {
    const k = 1 - Math.pow(0.001, dt); // frame-rate independent easing
    state.x += (pointer.x - state.x) * k;
    state.y += (pointer.y - state.y) * k;
  }
  state.trail.push({ x: state.x, y: state.y });
  if (state.trail.length > 14) state.trail.shift();
}

export function render(ctx, view) {
  ctx.fillStyle = '#101820';
  ctx.fillRect(0, 0, view.w, view.h);

  state.trail.forEach((p, i) => {
    ctx.globalAlpha = (i / state.trail.length) * 0.35;
    ctx.fillStyle = '#4fd1c5';
    ctx.beginPath();
    ctx.arc(p.x, p.y, state.r * (i / state.trail.length), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#4fd1c5';
  ctx.beginPath();
  ctx.arc(state.x, state.y, state.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#9fb3c8';
  ctx.font = '16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Touch and drag', view.w / 2, 48);
}
