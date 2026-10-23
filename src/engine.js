// Minimal engine: DPR-aware canvas, fixed-timestep loop, multi-touch pointer input.
// Game code lives in game.js and exports { init, update, render } plus optional { resize, gesture }.

const STEP = 1 / 60;
const MAX_FRAME = 0.25; // clamp after tab switches / stalls

export function start(canvas, game) {
  const ctx = canvas.getContext('2d');
  const view = { w: 0, h: 0, dpr: 1, safe: { top: 0, bottom: 0, left: 0, right: 0 } };
  // touches: live pointers by id ({ id, x, y, sx, sy, role }); pressed: new presses this step.
  // mouse: movement and wheel since the last update (only while the game has the pointer locked), the left button, and
  // whether the pointer is locked. Mouse look is a setting; see wantsMouseLock in the game.
  const input = { touches: new Map(), pressed: [], keys: new Set(), mouse: { dx: 0, dy: 0, wheel: 0, down: false, alt: false, locked: false } };

  // Canvas can't read env(); measure the safe-area insets through a hidden element.
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);

  function resize() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 3);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    const cs = getComputedStyle(probe);
    view.safe.top = parseFloat(cs.paddingTop) || 0;
    view.safe.bottom = parseFloat(cs.paddingBottom) || 0;
    view.safe.left = parseFloat(cs.paddingLeft) || 0; // the notch sits at a side in landscape
    view.safe.right = parseFloat(cs.paddingRight) || 0;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    game.resize?.(view);
  }

  const locked = () => document.pointerLockElement === canvas;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && game.wantsMouseLock?.()) {
      // mouse look: the first click captures the pointer, later clicks are the fire button, and neither is a touch
      if (!locked()) canvas.requestPointerLock?.();
      else if (e.button === 0) input.mouse.down = true;
      else if (e.button === 2) input.mouse.alt = true; // the right button: the SMG's alt-fire, read once per update
      game.gesture?.();
      return;
    }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events have no capturable pointer */ }
    input.touches.set(e.pointerId, {
      id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, role: null,
    });
    input.pressed.push({ x: e.clientX, y: e.clientY });
    game.gesture?.(); // audio must be unlocked inside a user-gesture handler
  });
  canvas.addEventListener('pointermove', (e) => {
    const t = input.touches.get(e.pointerId);
    if (t) { t.x = e.clientX; t.y = e.clientY; }
  });
  const up = (e) => {
    if (e.pointerType === 'mouse' && e.button === 0) input.mouse.down = false;
    input.touches.delete(e.pointerId);
    game.gesture?.(); // iOS only counts touchend/pointerup as an unlocking gesture
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  document.addEventListener('mousemove', (e) => {
    if (!locked()) return;
    input.mouse.dx += e.movementX || 0;
    input.mouse.dy += e.movementY || 0;
  });
  canvas.addEventListener('wheel', (e) => {
    if (locked()) input.mouse.wheel += Math.sign(e.deltaY);
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('pointerlockchange', () => {
    input.mouse.locked = locked();
    if (!input.mouse.locked) input.mouse.down = false;
    game.pointerLock?.(input.mouse.locked);
  });

  window.addEventListener('keydown', (e) => { input.keys.add(e.key.toLowerCase()); game.gesture?.(); });
  window.addEventListener('keyup', (e) => input.keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => { input.keys.clear(); input.touches.clear(); });

  // iOS Safari ignores touch-action for some gestures; belt and braces.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('resize', resize);
  // iOS reports the old size for a moment after a rotation, so measure again once it has settled
  window.addEventListener('orientationchange', () => { resize(); setTimeout(resize, 120); setTimeout(resize, 450); });

  let last = performance.now();
  let acc = 0;
  let running = true;

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    last = performance.now();
    if (!running) input.touches.clear();
  });

  function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;
    acc += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    while (acc >= STEP) {
      game.update(STEP, input, view);
      input.pressed.length = 0;
      input.mouse.dx = input.mouse.dy = input.mouse.wheel = 0;
      input.mouse.alt = false;
      acc -= STEP;
    }
    // let the mouse go as soon as the game stops wanting it (death, the menus), so the menu buttons can be clicked
    if (locked() && !game.wantsMouseLock?.()) document.exitPointerLock?.();
    game.render(ctx, view, acc / STEP);
  }

  resize();
  game.init?.(view);
  requestAnimationFrame(frame);
}
