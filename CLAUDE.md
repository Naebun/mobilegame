# Freddie's Last Set

Portrait top-down horror shooter. Lead character: Freddie, a DJ. Flat vector art, all audio synthesised (no asset files), no multiplayer or backend. Twin virtual sticks: left moves, right aims and auto-fires.

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
- Audio: only call `audio.unlock()` from input handlers (browsers block it otherwise). Visuals that follow the music read `audio.beat()`.
- `?debug` in the URL exposes the game module as `window.__game` (used by the smoke test).
