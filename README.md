# Freddie's Last Set

A portrait-mode horror shooter for the phone browser. Freddie is a DJ, the dance floor is full of the dead, and the speaker cannon is the only thing between him and the encore. Plain HTML, CSS and JavaScript on a `<canvas>`. No build step, no framework, no backend.

**Controls:** left thumb moves, right thumb aims and fires (WASD works on desktop, with the mouse on the right half of the screen to aim).

## Layout

| Path | Purpose |
| --- | --- |
| `index.html` | Page shell, mobile meta tags |
| `src/engine.js` | Canvas sizing (DPR-aware), fixed 60 Hz update loop, multi-touch input, safe-area insets, pause on tab hide |
| `src/game.js` | The game: waves, enemies, light radius, HUD. Exports `init`, `update(dt, input, view)`, `render(ctx, view)`, `gesture` |
| `src/audio.js` | Web Audio synthesis: beat-synced music loop and all sound effects, no audio files |
| `src/main.js` | Wires the two together, registers the service worker |
| `sw.js`, `manifest.webmanifest` | Offline fallback and "Add to Home Screen" support |
| `scripts/serve.mjs` | Dev server (no dependencies) |
| `scripts/smoke.mjs` | Headless phone-viewport check with screenshot |

## Run locally

```
npm start            # http://localhost:8080, also prints a LAN address
```

Open the LAN address on a phone on the same Wi-Fi to test on the device.

## Play on your phone from anywhere

The workflow in `.github/workflows/pages.yml` publishes the site to GitHub Pages on every push to `main`.
One-off setup: repository Settings, Pages, Source: **GitHub Actions**. The URL is `https://<owner>.github.io/mobilegame/`.
Then use Share, Add to Home Screen for a full-screen launch.

Pages on a private repository needs a paid GitHub plan. If that applies, make the repo public or host the folder elsewhere (Netlify, Cloudflare Pages).

## Smoke test

```
npm install                  # first time only; set CHROMIUM_PATH to reuse an installed Chromium
npm run smoke -- ./shots     # synthetic multi-touch run, screenshots land in ./shots (gitignored)
```
