# mobilegame

Mobile-first web game. Vanilla JS (ES modules) on a 2D canvas. No bundler, no runtime dependencies. Keep it that way unless there is a real need.

## Conventions
- Game code goes in `src/`; engine concerns (loop, input, canvas) stay in `engine.js`, game logic in `game.js` or new modules it imports.
- Update with the fixed `dt` passed in; never use wall-clock time in `update`. Render only reads state.
- Draw in CSS pixels (`view.w`, `view.h`). The engine applies the DPR transform.
- Input is pointer events only (works for touch and mouse). Touch targets at least 44px.
- Respect safe areas (notches); use `env(safe-area-inset-*)` for any DOM UI.
- New files under `src/` or `assets/` must be added to `ASSETS` in `sw.js` and, for new top-level paths, to the "Stage site" step in `.github/workflows/pages.yml`.
- Test on a phone-sized viewport (390x844) before calling something done: `npm run smoke`.
- British English in comments and docs.
