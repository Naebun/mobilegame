# Freddie's Last Set

Portrait top-down horror shooter set in Edinburgh. Lead character: Freddie, a DJ. Dark comedy tone, Scottish voice but light on dialect. Enemies are the modern undead (stag/hen parties, tourists, buskers). Five levels at real locations, each survived to dawn then a boss, with an upgrade pick between levels. Flat vector art, all audio synthesised (no asset files), no multiplayer or backend. Twin virtual sticks: left moves, right aims and auto-fires.

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
- `?test` in the URL exposes the game module as `window.__game` (used by the smoke test).
- Content changes (new enemy, boss, level, upgrade, joke) belong in `src/levels.js`; only add code to `game.js`/`draw.js` for new behaviour. A new enemy type also needs an `ACCESSORY` entry in `draw.js`.
- Menu buttons come from `buttons(view)` in `game.js`, shared by hit testing and drawing. Do not hard-code button rectangles elsewhere.
- `window.__game.testHook('play', levelIndex | 'boss' | 'killboss' | 'title' | 'buttons')` (needs `?test` in the URL) jumps around the campaign. It sets hp to 999, so never judge lighting from those screenshots.
- Progress is stored under `mobilegame.save` and `mobilegame.best` in localStorage. Wrap every access in try/catch.
- Current focus is level 1 only. Levels 2 to 5 are deliberately parked: do not change them until asked. The record of what is deferred, and why, is in `ROADMAP.md`.
- Debug mode (home-screen toggle, `S.debugMode` in `game.js`) gives Freddie 2x fire rate, 2x damage, 2x health through `DEBUG_MULT` in `stats()`. Never balance against it: all tuning is for normal mode. Debug runs must not write the save or best score. It is separate from the `?test` hook, which is for automated tests.
