# mobilegame

A mobile web game, played in the phone browser. Plain HTML, CSS and JavaScript on a `<canvas>`. No build step, no framework.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html` | Page shell, mobile meta tags |
| `src/engine.js` | Canvas sizing (DPR-aware), fixed 60 Hz update loop, pointer input, pause on tab hide |
| `src/game.js` | The game itself. Exports `init`, `resize`, `update(dt, pointer, view)`, `render(ctx, view)` |
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
npm i -D playwright          # first time only; reuse an installed Chromium via CHROMIUM_PATH
npm run smoke -- shot.png
```
