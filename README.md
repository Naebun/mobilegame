# Freddie's Last Set

A first-person 3D horror shooter for the phone browser, set in a basement club in Edinburgh. Freddie is a DJ,
the club is full of hostile robots, and his speaker weapons are the only way out. Three.js on WebGL, plain ES
modules, no build step for development, no backend.

## The game

Level 1 is the Cowgate: a real brick-and-stone basement club, played as one linear route through six areas
(stairwell, cloakroom, dance floor, bar, VIP corridor, backstage). Every robot is placed in the level in advance and
wakes when it notices Freddie; a robot that dies stays dead. Clear every robot in an area and the door out unlocks.
Beat the Bouncer at the end and walk out to finish the level.

- **Enemies:** "Dr Pepper" robots only fight in melee. "Wray and Nephew" robots throw bottles. The Bouncer is a big
  melee brute.
- **Weapons:** found on the floor, each different. Bass Pistol (accurate, starting weapon), Subwoofer Shotgun
  (pellets and knockback), Tweeter SMG (fast, spread grows), Reverb Launcher (explosive).
- **Ammo:** unlimited, but each clip is limited. Reloading is automatic when the clip empties, or press RELOAD.
- **Headshots** do double damage. There is no aim assist.

## Controls

Two grey boxes on screen. **Left box:** drag to move. **Right box:** drag to aim; while a thumb is down in it,
the weapon fires on its own. **RELOAD** sits under the right box and **SWAP** (next weapon) under the left box.
On a desktop: WASD to move, arrow keys to look, space to fire, R to reload, Q to swap.

## Flow

Home screen, then a controls screen, then the level intro. The run starts only when START GAME is pressed on the
controls screen.

**Debug mode** (toggle on the home screen) is a testing aid: Freddie fires twice as fast, deals twice the damage and
has twice the health. Scores are not recorded in debug mode, and a DEBUG MODE badge shows during play. The game is
balanced for normal mode only.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html`, `src/style.css` | Page shell: a WebGL canvas under a transparent 2D canvas for the HUD |
| `src/engine.js` | Loop, canvas sizing, multi-touch input, safe-area insets |
| `src/game3d.js` | State machine, player, weapons and clips, robot AI, projectiles, areas and doors, renderer |
| `src/data.js` | Weapons, enemies, level text and jokes. Tune the game here |
| `src/world.js` | The level: procedural brick, stone and timber, collision, line of sight, path finding |
| `src/models.js` | Robots, weapon models, pickups and projectiles |
| `src/hud.js`, `src/screens.js` | The 2D layer: control boxes, HUD, title, controls, intro, death and completion screens |
| `src/audio.js` | Web Audio synthesis: music loop and every sound effect, no audio files |
| `src/consts.js`, `src/draw.js` | Shared constants and 2D helpers |
| `vendor/three.module.min.js` | three.js r160 (MIT) |
| `docs/fps-design.md` | The module contract the first-person build was made against |

## Run locally

```
npm start            # http://localhost:8080, also prints a LAN address for testing on a phone
```

## Play on your phone from anywhere

`.github/workflows/pages.yml` publishes the site to GitHub Pages on every push to `main`. The URL is
`https://naebun.github.io/mobilegame/`. Share, Add to Home Screen gives a full-screen launch.

## Play it inside Claude

```
npm run build:artifact       # bundles everything, three.js included, into dist/artifact.html (gitignored)
```

Publish that file as a Claude Artifact. It is one self-contained file, so the service worker is skipped there.

## Tests and tools

```
npm run smoke -- ./shots     # headless Chromium with software WebGL and synthetic multi-touch; screenshots to ./shots
npm run sim                  # headless bot plays the real game logic: is the level winnable, how much damage
node scripts/harness/world-check.mjs     # level geometry, collision, rays, flow field (thousands of assertions)
node scripts/harness/models-check.mjs    # every robot pose, every model
node scripts/harness/ui-check.mjs        # HUD and screens at extreme inputs and view sizes
node scripts/shot.mjs <page> <out.png>   # screenshot any page with WebGL, for visual checks
```

Software WebGL runs at a few frames per second, so the smoke test waits for conditions instead of fixed times.
