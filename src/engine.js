// Minimal engine: DPR-aware canvas, fixed-timestep loop, pointer input.
// Game code lives in game.js and only needs to export { init, update, render }.

const STEP = 1 / 60;
const MAX_FRAME = 0.25; // clamp after tab switches / stalls

export function start(canvas, game) {
  const ctx = canvas.getContext('2d');
  const view = { w: 0, h: 0, dpr: 1 };
  const pointer = { x: 0, y: 0, down: false, pressed: false, released: false };

  function resize() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 3);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    game.resize?.(view);
  }

  function setPointer(e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    setPointer(e);
    pointer.down = pointer.pressed = true;
  });
  canvas.addEventListener('pointermove', setPointer);
  const up = (e) => {
    setPointer(e);
    pointer.down = false;
    pointer.released = true;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  // iOS Safari ignores touch-action for some gestures; belt and braces.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  let last = performance.now();
  let acc = 0;
  let running = true;

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    last = performance.now();
  });

  function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;
    acc += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    while (acc >= STEP) {
      game.update(STEP, pointer, view);
      pointer.pressed = pointer.released = false;
      acc -= STEP;
    }
    game.render(ctx, view, acc / STEP);
  }

  resize();
  game.init?.(view);
  requestAnimationFrame(frame);
}
