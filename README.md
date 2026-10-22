# Freddie's Last Set

A portrait-mode horror shooter for the phone browser, set in Edinburgh. Freddie is a DJ, the night is full of the modern undead (stag dos, hen dos, tour groups, buskers), and his speaker cannon is the only thing between him and dawn. Plain HTML, CSS and JavaScript on a `<canvas>`. No build step, no framework, no backend.

**Campaign:** five levels (the Cowgate, the Royal Mile, the Grassmarket, Princes Street Gardens, Arthur's Seat). Survive until dawn, then a boss arrives. Beat it, pick one of three upgrades, move on. Progress is saved on the device, so CONTINUE works after closing the tab.

**Controls:** left thumb moves, right thumb aims and fires (WASD works on desktop, with the mouse on the right half of the screen to aim).

## Layout

| Path | Purpose |
| --- | --- |
| `index.html` | Page shell, mobile meta tags |
| `src/engine.js` | Canvas sizing (DPR-aware), fixed 60 Hz update loop, multi-touch input, safe-area insets, pause on tab hide |
| `src/game.js` | Rules and flow: modes (title, intro, play, clear, upgrade, dead, win), spawning, bosses, collisions, HUD, menus, saving |
| `src/levels.js` | All content as data: enemies, bosses, the five levels, upgrades, jokes. Tune the game here |
| `src/draw.js` | Flat-vector drawing: floors, obstacles, enemies, bosses, Freddie, title skyline |
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
npm run smoke -- ./shots     # plays every level and boss through the ?debug hook, screenshots land in ./shots (gitignored)
```
