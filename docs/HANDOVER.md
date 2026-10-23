# Handover: Naebun's Last Set

Written so the chat can be cleared and work resumed from a cold start. Read this, then `CLAUDE.md`, `ROADMAP.md` and
`README.md`. The status section is the part most likely to be stale, so check it against `git log` first.

## Standing rules from the owner
- **Levels 1 and 2 exist.** Level 2 was built with explicit permission (branch `level-2`, not merged). Never build level 3 or later without explicit permission.
- **Of the five approved enemy ideas in `ROADMAP.md`, only the Shielded Fizzbang is built (level 2).** Approval is not a go-ahead to build the rest.
- **Never balance against debug mode.** Debug is 2x fire rate, 2x damage, 2x health. Debug runs do not write the best
  score.
- **Nothing goes to `main` until the owner says so.** Squash-merge by PR when asked. (Last go-ahead: "Merge all", PR #4.)
- **Blender makes the models and the textures.** Textures were approved (option D then C in `docs/texture-options.md`): baked in Blender, shipped as WebP in `assets/textures/`, which is the only place image files may enter the repo. See the Textures section below.
- Robots are melee ("Dr Fizzbang") or ranged ("Bampot and Nephew"). Invented names, never real brands.
- Controls: two grey boxes, left moves, right aims and auto-fires, no aim assist. Unlimited ammo, limited clips.
- Last Orders (the super drink) never triggers in the boss room, does not stop time, and switches to a third-person
  camera while Naebun spins.
- Org style: British English, plain peer tone, no em dashes. Say what is verified and what is assumed.

## The game in one paragraph
Portrait first-person 3D horror shooter for the phone browser, set in a Cowgate basement club in Edinburgh. Dark
comedy, light Scottish voice. Six linear areas, pre-placed sleeping robots that wake on noticing Naebun, doors that
open when an area is clear, four floor-pickup weapons, a Bouncer boss. Drinks are the power-ups, each with a
first-person drinking animation. Three.js r160 is vendored, plain ES modules, no backend. Full-game plan (about two
hours, 8 to 10 levels, iOS from the last four years) is in `docs/full-game-plan.md`.

## Level 2 (branch `level-2`)
Read `docs/level-2.md`. In short: `buildWorld({ level })` takes a definition from `src/levels/`; `vaults-decor.js` dresses
level 2 through hooks in `world.js`; level 1's dressing is still inline in `world.js` behind `COW`. `game3d.js` has
`loadLevel` and a deferred swap (the world is rebuilt after a frame showing the new screen has drawn). New tests:
`level-check.mjs`, `combat-check.mjs`, `game-views.mjs` (screenshots in the real pipeline), `world-views.mjs`. Open: a human
playtest of level 2 (difficulty, the dark, touch), a phone frame-rate check, and merging when the owner says so.

## Branches
Everything is merged to `main` (PR #4, squash, with the owner's go-ahead: "Merge all"). That PR carried the robot
rename, the full-game plan, the graphics pass, drinks and Last Orders. The branches `rename-robots` and
`graphics-pass` are now redundant. `tune-levels` is parked top-down tuning; ignore it. Start new work on a new branch
from `main`.

## What exists on `main`
- **Render pipeline** (`src/gfx.js`): HDR target, bloom, ACES, grade, vignette, hurt tint, grain. Three tiers (high,
  medium, low), auto-drop when frames run slow, `?q=low|medium|high`, `?perf`, `?test`.
- **World** (`src/world.js`): PBR brick, stone, timber and plaster from generated data textures, baked AO and light
  pools, mirror ball, light shafts. 11 drink pickups and 3 weapons placed, none in the boss room.
- **Models** (`src/models.js`): battered robots, weapons, pickups, projectiles, drink pickups and viewmodels, Naebun
  for the third-person view.
- **Drinks** (`src/data.js` `DRINKS`, `docs/drinks.md`): Dram (heal), Orange (speed), Heavy (guard), Energy (rapid
  fire), Last Orders (laser).
- **Particles and env light**: `src/fx.js`, `src/gfx-env.js`.
- Contracts between modules: `docs/fps-design.md`, `docs/graphics-pass.md`, `docs/drinks.md`.

## Status at handover (check against `git log`)
Done and verified headless (now on `main`): the models agent's work is integrated (robot `update` and pickup
`userData.update` are now called from `game3d.js`), level exposure raised to 1.3, `world-check` 4368/4368,
`models-check`, `drinks-check` and `ui-check` pass, the smoke test passes (38 checks), and the bot run beats the level
(casual 100, good 100, sloppy 93 percent). The Claude Artifact was republished as version 7 and includes all of this.

Still open:
1. Review screenshots of each drinking animation and the Naebun third-person spin. Level and robot shots were
   reviewed. The others were only checked by the models agent.
2. Cost on a real phone is unknown. Software numbers are in `ROADMAP.md`. High and medium cost about the same there,
   so tiers may need re-spacing once a phone has been tried.
3. Sloppy-bot win rate fell from 100 to 93 percent after the graphics pass (backstage deaths). Probably the bigger
   robot hitboxes and shapes. Not tuned. A human playtest should decide.
4. A human playtest: difficulty, touch feel, audio and frame rate are all unverified on a real phone.

## How to run and check
```
npm start                                  # local server
npm run smoke -- ./shots                   # end to end, headless Chromium, needs the ?test hook
npm run sim                                # bot playthrough, level winnable at three skills
node scripts/harness/world-check.mjs
node scripts/harness/models-check.mjs
node scripts/harness/ui-check.mjs
node scripts/harness/drinks-check.mjs
node scripts/shot.mjs <page> <out.png>     # screenshots, for anything visual
npm run build:artifact                     # dist/artifact.html, one self-contained file
```
Software WebGL runs at a few frames per second, so tests wait on conditions, not timers. Look at screenshots for
anything visual.

## Blender
The container is ephemeral, so the install does not persist. Run `scripts/setup-blender.sh` (about two minutes,
about 1 GB). It creates a venv at `~/.venvs/blender`, installs `bpy` (5.2.3 at the time) and runs
`scripts/blender-check.py`.

Verified: Cycles on CPU renders, a 16x16 bake works, the glTF exporter is present. EEVEE is not usable headless. The
GPU library warnings on start-up only mean there is no GPU.

**Drinks.** `scripts/blender/drinks.py` (with `kit.py`, `preview.py`) models the five drinks and writes
`src/drink-meshes.js`: packed int16 positions, int8 normals, uint16 indices, and for painted parts sRGB vertex colour
with ambient occlusion and edge wear baked in, plus roughness and metalness. `models.js` decodes it into the same part
names and pivots the animation already used, so `makeDrinkPickup` and `makeDrinkViewmodel` did not change. The
output is byte-for-byte reproducible (three runs compared); keep it that way, which is why the script avoids bmesh
extrude, bevel and primitive operators (they order output by pointer hash). The fizz, puff and halo discs and the hand
are still code. About 19k triangles for all five drinks and 370 KB of source; trim segment counts in `drinks.py` first
if load time matters.

**Weapons and hands.** `scripts/blender/weapons.py` models the five weapons and Naebun's hands and forearms and writes
`src/weapon-meshes.js` (same packed format, about 620 KB, byte-for-byte reproducible). Parts: `body`, `pump` (shotgun fore-end,
with the left hand as its child), `cradle` (vinyl platter; the record is still code so it can spin) and `hands`. Muzzle
and lamp positions travel in the data. `makeWeaponModel(id, { hands: false })` leaves the hands off (pickups use it);
the procedural `WEAPON_PARTS` in `models.js` stay as the fallback for a weapon missing from the data. `kit.py` gained
`loft` (a section swept along a path: grips, fingers, sleeves), `sweep`/`curve`, more surface types and a per-part
smoothing angle; `drinks.py` output is unchanged (checked with `cmp`). Previews: `weapons.py --preview smg --view fp`.

Textures: decided and built, see the Textures section.

## Open questions for the owner
1. Whether the baked textures look right on a phone, and whether plaster, carpet and concrete should be baked too (they are
   still generated). Say if the robots or Naebun should move to Blender too.
2. Playtest feedback on difficulty and look.

## Landscape (branch `level-2`)
Added on the owner's request, replacing the earlier "portrait only" decision. `hud.layout(view)` has a landscape branch
(boxes in the lower corners, SWAP and RELOAD beside them, side insets from the notch); `screens.js` puts words left and
buttons in a right column (`frame()`, `landscape()`), with a four-column controls page; `baseFov()` in `game3d.js` narrows
the vertical field of view as the screen widens (85 degrees in portrait, about 58 at 2.16:1) and `weaponX()` moves the
viewmodel out to the right. Tested by `ui-check` (12 view sizes, side insets), the smoke test (rotate to 844 x 390 and
back) and screenshots from `scripts/harness/screen-views.mjs`. Not tested: a real phone rotating, iOS reporting a stale
size after rotation (the engine re-measures at 0, 120 and 450 ms to cover it), real thumb reach on the landscape boxes.

## Control modes, settings page and saved progress
Two modes: PC (default: the grey boxes and buttons are hidden, the mouse aims with no button held, left click fires) and
mobile (the boxes). `detectMobile()` in `game3d.js` picks mobile on a phone or tablet at start-up (matchMedia plus user
agent; `?pc` and `?mobile` force it for tests); a choice saved on the Settings page wins. Settings (`screens.drawSettings`):
CONTROLS (PC or MOBILE), SENSITIVITY (PC only) and RESET PROGRESS (two taps). `engine.js` handles pointer lock, movement,
the left button and the wheel (`input.mouse`), and `wantsMouseLock()` says when it is wanted (playing, in PC mode), so the
engine lets go in the menus. The controls screen has a PC page with keycaps and a mouse diagram. `src/save.js` keeps the
furthest level unlocked, levels done, best scores and whether the torch is fitted in a cookie (name `fls`, a year, this
page's path) and in localStorage, merging both on load; the title offers CONTINUE once level 2 is unlocked. Tested headless
by `combat-check` (aim, fire, wheel, sensitivity, the save format) and in the smoke test (detection, both modes, cookie
written, reload offers CONTINUE, settings, reset). Not tested: a real mouse and real pointer lock (the tests inject input),
Safari's cookie expiry rules (it may drop script-set cookies after about a week without a visit; local storage has the
same limit for sites not added to the home screen, which is why both are written).

## The torch
A level definition says `dark: true` (level 2 does; level 1 does not), plus `fill` (a tiny light on the camera) and
`torch` (the spotlight and beam settings). The torch is part of each weapon model: `makeWeaponModel` has `torch` and `lens`
meshes and `userData.lens` ({ pos, dir }, dir always -z) and `userData.setTorch({ mounted, on, k })`. Each frame
`game3d.js` `updateTorch()` reads the lens in the weapon scene, converts it for the main camera (the two cameras have
different fields of view) and places a SpotLight and a beam cone there, so the light follows the gun through the reload dip,
the recoil and the swap. The four pickup guns arrive with a torch fitted; the pistol does not. At the start of a dark level
without a fitted torch `S.attach` runs `makeTorchAttach()` (a left hand carries the module to the pistol, a click at `k` 0.6,
the hand withdraws) and the pistol cannot fire until it ends; the fitted state is saved. F toggles the torch on a computer.
Models are in `scripts/blender/weapons.py` (five torches, the attach hand; `preview.py` views `lside`, `liso`, `lfront`);
tests are in `models-check`, `combat-check` and the smoke test (`torch-fitting`). Playtest-prep fixes (all seen in software-rendered screenshots only): the pistol's torch module now clips on the
top of the slide, where the camera sees it (it was under the slide and hidden); the launcher's lens is at the mouth of its own
mini horn (it sat 0.04 m down the throat); the vinyl gooseneck peaks 0.034 m lower. The earlier note that the shotgun's beam starts inside its horn flare was not acted on: the shotgun's lens is a plain tube light
beside the barrel (the horn lamp that had the problem is the launcher's). Not seen: a real phone.

## Blender assets (weapons, hands, props)
Drinks, weapons (with their torches) plus Naebun's hands, and 27 level props are modelled in Blender and generated into data modules
(`src/drink-meshes.js`, `src/weapon-meshes.js`, `src/prop-meshes.js`) by `scripts/blender/{drinks,weapons,props}.py`. Never
edit the output; each is reproducible (run twice and `cmp`). `models.js` decodes weapons and falls back to the older procedural
models; `world.js` places props with `placeProp` and falls back to procedural props (the low tier uses them, to stay inside
its triangle cap). Details and the prop ranking: `docs/props.md`. Known: level 2 high is close to the 150k triangle limit
(about 145k); the weapons' left forearms read as plain purple tubes in portrait; the Vaults are dark enough that old and new
props are hard to tell apart; nothing has been seen on a phone. Textures: see the Textures section and `docs/textures.md`.

## Prepared objects (built, not placed)
At the owner's request the roadmap's enemies, weapons, upgrades and collectibles are built and tested ahead of their levels.
No level map uses any of them. Enemies (Fizzbang Shaken, Bampot Longshot, Bampot Nurse, Vending Mimic): `docs/enemies-next.md`,
`scripts/harness/enemies-check.mjs`. Arsenal (Feedback Beam, Bass-Drop Grenade, Airhorn, the SMG alt-fire, clip and reload
upgrades, ten collectible records and the SETLIST screen): `docs/arsenal.md`, `scripts/blender/arsenal.py` (writes
`src/arsenal-meshes.js`), `src/arsenal.js`, `src/arsenal-play.js`, `scripts/harness/arsenal-check.mjs`. Every number is a first
guess; nothing has been played by a person or heard. The sim bots cannot dodge a laser, run from a Shaken, hunt a Nurse or
use the new weapons, so they need teaching before these go into a level. Level 3 and later are still not to be built.

## The owner's test devices
An iPhone 16 Pro and a MacBook Air M4. Both are much faster than the plan's floor (an A15, so an iPhone 14), which means a
smooth frame rate on either says nothing about an older phone: keep the pixel ratio cap, the light count and the triangle
budget as they are, and use the `?perf` readout (see `docs/playtest.md`) to look at
frame time, not just whether it feels smooth. The iPhone's display is 120 Hz in Safari (30 or 60 in Low Power Mode), so
nothing may assume 60 frames a second; the loop is fixed-step and reads taps from events, but test it. The Mac is PC mode
with a trackpad: two-finger scroll sends wheel events that keep coming as the scroll coasts, so the wheel swap only counts
an event after a quiet gap of 180 ms (`engine.js`); the right button (alt-fire) is a two-finger click or a control-click.
Not tested on either: real pointer lock in Safari, trackpad swap, the iPhone safe areas with Safari's bottom tab bar.

## Playtest kit (performance readout, guide)
`?perf` (or the P key on a computer) shows `src/perf.js`: a DOM panel, top left under the health bar, with frame rate (rolling
four-second average and the 1 percent low), frame time, JS time of the render call, tier, pixel ratio, drawing size, triangles,
draw calls, lights, viewport and orientation, level and area. Tap it to copy a one-line summary (clipboard API, then a
selection copy, then a box to long-press). `window.__perf` carries the same numbers while it is on. Off, it costs one null check
per frame. `scripts/harness/perf-check.mjs` tests it in both orientations. The guide for whoever holds the phone is
`docs/playtest.md`. No adaptive quality was added: `trackFrame` in `game3d.js` already steps the tier down when frames stay under
about 25 fps, and it remembers the lower tier in local storage, which a playtest should know about (the guide says how to pin a
tier with `?q=`).

## Textures
Brick, painted brick, stone, flags and boards (and the floor boards, which are the boards darker) are baked in Blender and
shipped as WebP; carpet, concrete and plaster are still generated. Read `docs/textures.md` for the numbers and the reasoning.
- **Source art:** `scripts/blender/textures.py` models each surface as real geometry over a seamless tile (bevelled uneven
  bricks, recessed joints that vary in depth, worn flagstones at different heights, chips), bakes albedo, tangent normal,
  roughness, occlusion and a mask with Cycles on the CPU at twice the final size, averages down, then adds grain, pits, stains
  and wood grain in numpy from tileable noise. Output is byte-for-byte reproducible (two full runs compared with `cmp`).
  About 6 minutes for everything on this container. Never edit the WebP files; change the script and rerun.
- **Delivery:** `assets/textures/<name>-albedo|normal|rough.webp`, 0.6 MB in all. `src/textures.js` loads them (DOM allowed)
  and builds `THREE.Texture`s, flagged `userData.baked`. `world.js` stays DOM-free: `buildWorld({ baked })` uses finished
  textures for the surfaces it is given, and `world.retexture(sets)` swaps them into a built world, disposing the generated
  textures it replaces (baked ones are shared between levels and never disposed). `game3d.js` starts loading at start-up on
  medium and high, swaps in when nobody is playing (title, menus, death, level end), and passes the set to every level built
  afterwards. The low tier, Node and any failed load keep the generated textures. `?baked=0` forces that for comparisons.
- **Brick tile is 1.8 m by 0.9 m** (the generated one was 0.9 m square): `texture.repeat` carries the difference, and each brick
  wall face starts a whole number of double courses up the tile (`Mesher.off`), so the same bricks do not stack in a column.
- **Tests:** `scripts/harness/textures-check.mjs` (Node), the baked checks in `scripts/smoke.mjs`. The smoke test is bound by software frame rate: on a busy machine (load above 15) its 20 s waits expire, so `SMOKE_WAIT=90000` stretches them, and `pressButton` now waits for a delayed button. `EXTRA='&baked=0'` runs it on the generated textures.
- **Not known:** decode and upload time, GPU memory and frame rate on a phone. See `docs/textures.md`.
