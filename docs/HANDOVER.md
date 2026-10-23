# Handover: Freddie's Last Set

Written so the chat can be cleared and work resumed from a cold start. Read this, then `CLAUDE.md`, `ROADMAP.md` and
`README.md`. The status section is the part most likely to be stale, so check it against `git log` first.

## Standing rules from the owner
- **Levels 1 and 2 exist.** Level 2 was built with explicit permission (branch `level-2`, not merged). Never build level 3 or later without explicit permission.
- **Of the five approved enemy ideas in `ROADMAP.md`, only the Shielded Fizzbang is built (level 2).** Approval is not a go-ahead to build the rest.
- **Never balance against debug mode.** Debug is 2x fire rate, 2x damage, 2x health. Debug runs do not write the best
  score.
- **Nothing goes to `main` until the owner says so.** Squash-merge by PR when asked. (Last go-ahead: "Merge all", PR #4.)
- **Blender makes the drink models; texture work has not started.** The owner said "don't start that" about textures. Wait to be told.
- Robots are melee ("Dr Fizzbang") or ranged ("Bampot and Nephew"). Invented names, never real brands.
- Controls: two grey boxes, left moves, right aims and auto-fires, no aim assist. Unlimited ammo, limited clips.
- Last Orders (the super drink) never triggers in the boss room, does not stop time, and switches to a third-person
  camera while Freddie spins.
- Org style: British English, plain peer tone, no em dashes. Say what is verified and what is assumed.

## The game in one paragraph
Portrait first-person 3D horror shooter for the phone browser, set in a Cowgate basement club in Edinburgh. Dark
comedy, light Scottish voice. Six linear areas, pre-placed sleeping robots that wake on noticing Freddie, doors that
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
- **Models** (`src/models.js`): battered robots, weapons, pickups, projectiles, drink pickups and viewmodels, Freddie
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
1. Review screenshots of each drinking animation and the Freddie third-person spin. Level and robot shots were
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

Still not decided: how Blender *textures* would reach the game. `world.js` and `models.js` are procedural only (no
image files, run under plain Node). Baked textures would need either committed image files or more data embedded in
modules, which changes that rule. Raise it with the owner before starting.

## Open questions for the owner
1. When to start Blender texture work, and whether image files may enter the repo. (Models are done for the drinks;
   say if the robots, weapons or Freddie should move to Blender too.)
2. Playtest feedback on difficulty and look.

## Landscape (branch `level-2`)
Added on the owner's request, replacing the earlier "portrait only" decision. `hud.layout(view)` has a landscape branch
(boxes in the lower corners, SWAP and RELOAD beside them, side insets from the notch); `screens.js` puts words left and
buttons in a right column (`frame()`, `landscape()`), with a four-column controls page; `baseFov()` in `game3d.js` narrows
the vertical field of view as the screen widens (85 degrees in portrait, about 58 at 2.16:1) and `weaponX()` moves the
viewmodel out to the right. Tested by `ui-check` (12 view sizes, side insets), the smoke test (rotate to 844 x 390 and
back) and screenshots from `scripts/harness/screen-views.mjs`. Not tested: a real phone rotating, iOS reporting a stale
size after rotation (the engine re-measures at 0, 120 and 450 ms to cover it), real thumb reach on the landscape boxes.
