# Handover: Freddie's Last Set

Written so the chat can be cleared and work resumed from a cold start. Read this, then `CLAUDE.md`, `ROADMAP.md` and
`README.md`. The status section is the part most likely to be stale, so check it against `git log` first.

## Standing rules from the owner
- **Level 1 only.** Never build a later level without explicit permission. Features are built and tested on level 1.
- **The five approved enemy ideas are recorded in `ROADMAP.md` and are not built.** Approval is not a go-ahead to build.
- **Never balance against debug mode.** Debug is 2x fire rate, 2x damage, 2x health. Debug runs do not write the best
  score.
- **Nothing goes to `main` until the owner says so.** Squash-merge by PR when asked.
- **Blender is installed but texture work has not started.** The owner said "don't start that". Wait to be told.
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

## Branches
| Branch | State |
| --- | --- |
| `main` | First-person game (PR #3). Does not have the robot rename, the graphics pass, drinks or Last Orders |
| `rename-robots` | Robot rename plus the full-game plan. **Unmerged. The owner has not answered whether to merge it** |
| `graphics-pass` | Everything newer: graphics pipeline, new world, new models, drinks, Last Orders, third-person camera, Blender check. **Unmerged, not authorised to merge** |
| `tune-levels` | Parked top-down tuning. Ignore |

`graphics-pass` was branched from the rename work, so merging it also carries the rename.

## What exists on `graphics-pass`
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
Done and tested: game logic, drinks, Last Orders flow, world checks (4368 assertions), headless smoke and sim.
Still open:
1. Final report from the models agent (drinks, Freddie, graphics pass) and a review of its work.
2. Look at screenshots of the new world, robots, each drinking animation and the Freddie spin. Nobody has judged the
   3D look from screenshots since the graphics pass landed. Tune `world.look` (exposure, bloom, vignette, grade)
   against `src/gfx.js`.
3. Per-tier cost. Software WebGL before the pass: low 5.2, medium 2.6, high 1.8 fps. Compare after. Real phone
   performance is **unmeasured**.
4. Run everything (below), rebuild `dist/artifact.html`, republish the Claude Artifact (last published version
   predates the graphics work), update README for the new modules.
5. A human playtest. Difficulty, touch feel, audio and frame rate are all unverified on a real phone.

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

Not decided: how Blender output reaches the game. `world.js` and `models.js` are procedural only (no image files, run
under plain Node) and three.js textures are generated in code. Baked textures would need either committed image
files or data embedded in the modules, which changes that rule. Raise it with the owner before starting.

## Open questions for the owner
1. Merge `rename-robots` to `main`? (Asked, unanswered.)
2. Merge `graphics-pass` to `main`, once it is reviewed?
3. When to start Blender texture work, and whether image files may enter the repo.
4. Playtest feedback on difficulty and look.
