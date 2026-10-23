# Naebun's Last Set

A first-person 3D horror shooter for the phone browser, set in a basement club in Edinburgh. Naebun is a DJ,
the club is full of hostile robots, and the speaker weapons are the only way out. Three.js on WebGL, plain ES
modules, no build step for development, no backend.

## The game

Two levels. After level 1, NEXT LEVEL plays a voicemail from Cheryl (Naebun's agent) and starts level 2. Naebun begins
each level with the pistol only and full health; there are no saves. Add `?level=2` to the URL to start a new game on
level 2 (a development shortcut).

**Level 1 is the Cowgate:** a real brick-and-stone basement club, played as one linear route through six areas
(stairwell, cloakroom, dance floor, bar, VIP corridor, backstage). Every robot is placed in the level in advance and
wakes when it notices Naebun; a robot that dies stays dead. Clear every robot in an area and the door out unlocks.
Beat the Bouncer at the end and walk out to finish the level.

- **Enemies:** "Dr Fizzbang" robots only fight in melee. "Bampot and Nephew" robots throw bottles. The Bouncer is a big
  melee brute. Level 2 adds the Shielded Fizzbang (a vending-machine door stops most frontal shots; go round the back,
  use the launcher, or get the shotgun in close) and the Tour Guide boss.
- **Weapons:** found on the floor, each different. Bass Pistol (accurate, starting weapon), Subwoofer Shotgun
  (pellets and knockback), Tweeter SMG (fast, spread grows), Reverb Launcher (explosive), and in level 2 the Vinyl Disc
  (a record that bounces off walls and stops in the first robot it hits).
- **Ammo:** unlimited, but each clip is limited. Reloading is automatic when the clip empties, or press RELOAD.
- **Headshots** do double damage. There is no aim assist.
- **Drinks:** the power-ups. Walk onto one and Naebun drinks it, with a first-person animation. Dram heals, Orange
  speeds Naebun up, Heavy halves damage taken, Energy speeds up fire and reload. **Last Orders** is the super drink: the
  camera goes third person, Naebun spins and a big laser wipes out the robots around Naebun. It never works in a boss
  room. Numbers are in `DRINKS` in `src/data.js`; the design is in `docs/drinks.md`.

**Level 2 is the Vaults:** the arched stone cellars under South Bridge and Mary King's Close, six areas (Blair Street
Steps, the Long Vault, the Cask Cellar, the Close, the Plague Cellar, the Last Tour). It is nearly dark: wall torches and
braziers light pools, and Naebun's own torch does the rest. Design notes and numbers are in `docs/level-2.md`.

## Controls

Two grey boxes on screen. **Left box:** drag to move. **Right box:** drag to aim; while a thumb is down in it,
the weapon fires on its own. **Anywhere else on the screen:** drag to aim only, with no firing (a second
aiming thumb, or a lighter way to look round). **RELOAD** sits under the right box and **SWAP** (next weapon) under the left box. In landscape the boxes sit in the lower corners, clear of the notch, with SWAP and RELOAD beside them and the whole middle of the screen free for the aiming drag.
On a desktop: WASD to move, arrow keys to look, space to fire, R to reload, Q to swap. The controls screen shows these.

**Control modes.** PC mode is the default: the grey touch boxes are hidden, click the game once to capture the mouse, then
move it to aim (no button held), left click fires, the wheel swaps weapon, Esc lets go. A mobile browser switches to mobile
mode on its own at start-up (the grey boxes). SETTINGS on the title screen has CONTROLS: PC / MOBILE to change it (the
choice is remembered and wins over detection) and a three-step MOUSE SENSITIVITY in PC mode. The controls screen shows
whichever mode is active.

**The torch.** Dark levels need it. It is mounted on the gun, a spotlight and a visible beam that point where the gun
points (through the reload dip and the recoil). At the start of the first dark level (level 2) Naebun fits the pistol's torch
by hand and the pistol cannot fire until it is on; every other gun already has one. Lit levels leave it off. F switches it
(PC). Only 2 or 3 of the 10 planned missions are dark.

**Saved progress.** The furthest level unlocked, the levels finished and the best score for each are saved in a cookie
(a year, this page's path only), mirrored in local storage, and merged if both exist. After a level is finished the title
screen offers CONTINUE: LEVEL n (behind that level's voicemail); NEW GAME still starts level 1 and keeps the save. Debug
runs record neither scores nor progress. RESET PROGRESS (two taps) erases it. Mid-level progress is not saved: there are
no checkpoints yet. The code is `src/save.js`.

## Flow

Home screen, then a controls screen, then the level intro. The run starts only when START GAME is pressed on the
controls screen.

**Debug mode** (toggle on the home screen) is a testing aid: Naebun fires twice as fast, deals twice the damage and
has twice the health. Scores are not recorded in debug mode, and a DEBUG MODE badge shows during play. The game is
balanced for normal mode only.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html`, `src/style.css` | Page shell: a WebGL canvas under a transparent 2D canvas for the HUD |
| `src/engine.js` | Loop, canvas sizing, multi-touch input, safe-area insets |
| `src/game3d.js` | State machine, player, weapons and clips, robot AI, projectiles, areas and doors, renderer |
| `src/data.js` | Weapons, enemies, level text and jokes. Tune the game here |
| `src/world.js` | Builds a level from a definition: procedural PBR brick, stone and timber, baked AO and light pools, collision, line of sight, path finding. Level 1's dressing lives here |
| `src/levels/` | Level definitions (map, areas, styles, atmosphere, spawn and pickup letters): `cowgate.js`, `vaults.js`. `vaults-decor.js` dresses level 2 |
| `src/models.js` | Robots, weapon models, pickups, drink pickups and viewmodels, Naebun, projectiles |
| `src/arsenal-meshes.js`, `src/arsenal.js`, `src/arsenal-play.js` | Prepared, unplaced weapons, upgrades and records (`docs/arsenal.md`); the mesh file is generated by `scripts/blender/arsenal.py` |
| `src/weapon-meshes.js` | Generated by `scripts/blender/weapons.py`: weapon meshes and Naebun's hands. Never edit by hand |
| `src/gfx.js`, `src/gfx-env.js`, `src/fx.js` | Render pipeline and quality tiers (HDR, bloom, grade), environment lighting, particles and dust |
| `src/hud.js`, `src/screens.js` | The 2D layer: control boxes, HUD, title, controls, intro, death and completion screens |
| `src/audio.js` | Web Audio synthesis: music loop and every sound effect, no audio files |
| `src/consts.js`, `src/draw.js` | Shared constants and 2D helpers |
| `vendor/three.module.min.js` | three.js r160 (MIT) |
| `docs/fps-design.md` | The module contract the first-person build was made against |
| `docs/graphics-pass.md`, `docs/drinks.md` | Contracts for the graphics pass and the drinks |
| `docs/HANDOVER.md` | Where things stand and how to resume from a cold start |

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
npm run sim                  # headless bot plays the real game logic: is the level winnable, how much damage (--level 2 for the Vaults)
node scripts/harness/world-check.mjs     # level 1 geometry, collision, rays, flow field (thousands of assertions)
node scripts/harness/level-check.mjs     # every level: areas, spawns, pickups, doors one at a time, budgets, NaN-free geometry
node scripts/harness/combat-check.mjs    # level 2 rules in the real game logic: shield, disc bounce, Tour Guide volley, slam, enrage
node scripts/harness/world-views.mjs 2 ./shots "name:x,z,yaw"   # screenshots of a level from tile positions (viewer harness, not the game pipeline)
node scripts/harness/models-check.mjs    # every robot pose, every model
node scripts/harness/ui-check.mjs        # HUD and screens at extreme inputs and view sizes
node scripts/harness/drinks-check.mjs    # every drink, Last Orders rules, pickups
node scripts/harness/tier-fps.mjs        # software frame rate per quality tier (relative only)
scripts/setup-blender.sh                 # installs Blender (bpy) into a venv (about a minute, 1 GB)
~/.venvs/blender/bin/python scripts/blender/drinks.py                    # rebuilds src/drink-meshes.js from the Blender models
~/.venvs/blender/bin/python scripts/blender/weapons.py                   # rebuilds src/weapon-meshes.js (weapons and Naebun's hands)
~/.venvs/blender/bin/python scripts/blender/props.py                     # rebuilds src/prop-meshes.js (level props, see docs/props.md)
~/.venvs/blender/bin/python scripts/blender/drinks.py --preview sheet.png   # also a Cycles contact sheet (about a minute)
~/.venvs/blender/bin/python scripts/blender/weapons.py                   # rebuilds src/weapon-meshes.js: the five weapons and Naebun's hands
~/.venvs/blender/bin/python scripts/blender/weapons.py --preview smg --view fp --png smg.png   # one weapon as the game frames it (also iso, side, top, rear)
~/.venvs/blender/bin/python scripts/blender/weapons.py --sheet sheet.png # contact sheet of all five (about four minutes)
node scripts/shot.mjs <page> <out.png>   # screenshot any page with WebGL, for visual checks
```

Quality tiers: `?q=low|medium|high` forces one; otherwise the game picks high and steps down if frames run slow.
`?perf` shows a frame counter.

Software WebGL runs at a few frames per second, so the smoke test waits for conditions instead of fixed times.
