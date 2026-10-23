# Roadmap and deferred work

## Standing rule
Levels 1 and 2 are built. Level 2 was built with the owner's explicit permission. No later level is to be built without
the owner's explicit permission, however obvious the next step looks.

## Level 2 (the Vaults), on branch `level-2`, not merged
Built on request: the level pipeline (`buildWorld({ level })`, definitions in `src/levels/`), the Vaults (six areas,
nearly dark, torches), the Shielded Fizzbang, the Vinyl Disc, the Tour Guide boss, NEXT LEVEL with a Cheryl voicemail,
and per-level best scores. Details, numbers and what is not verified: `docs/level-2.md`. Nothing here has been played by a
person or seen on a phone.

## Current state: level 1, first person

The game was rebuilt from a top-down shooter into a first-person 3D game. Level 1 (the Cowgate) is playable end to
end: six linear areas, pre-placed robots, door unlocking, four weapons, a boss, and a completion screen.

Verified by automated tests: the whole flow in a real headless browser (menus, both control boxes, auto-fire, clip and
reload, swap, rockets, enemy bottles, areas and doors, death and retry, completion, debug mode); the level geometry and
collision; a headless bot beats the level every time at three aim skills.

## Graphics pass, drinks and Last Orders (merged to main in PR #4)
Added since the first-person rebuild: an HDR render pipeline with bloom and grading and three quality tiers, a PBR
level with baked light, battered detailed robots, particles, five drinks with drinking animations, and the Last Orders
laser with a third-person spin. Verified headless: world (4368 checks), models, drinks, UI, the full smoke test (38
checks) and the bot run (casual and good bots win every time, a sloppy bot wins 93 percent of runs and loses in the
backstage). Screenshots of the level and robots were reviewed; exposure was raised once.

Known and unmeasured:
- **Cost on a real phone.** Software WebGL, dancefloor view: low 3.0, medium 1.3, high 1.2 fps. That only says high
  and medium cost about the same as each other there and low is cheaper; it says nothing about an A15 GPU. The level
  is about 118k triangles and a full robot roster is up to about 150k if all were in view. If phones struggle, trim the
  robots first (the models agent offered to), then the level.
- **The drinking animations and the Freddie spin** have not been reviewed frame by frame in screenshots by the owner.
- **Blender** now makes the five drink models (`scripts/blender/drinks.py` writes `src/drink-meshes.js`). Geometry and
  baked vertex colour only. Texture work has not started and needs the owner's go-ahead, plus a decision on whether
  image files may enter a repo that is procedural-only today. Robots, weapons, Freddie and the level are still
  procedural code, not Blender.

## Not verified: needs a human playing on a phone
- **Difficulty.** Bots aim far better than a thumb in a small box. A sloppy bot still wins every time, losing about
  60 percent of its health on average. Real players will likely find it harder, since there is no aim assist.
  Debug mode exists for testing. Enemy numbers are in `src/data.js`.
- **Frame rate and load time on real phones.** Only software rendering was measured (a few frames per second, which
  says nothing about a phone GPU). The level builds in about a second in a desktop browser. If it is slow on a phone,
  the first levers are pixel ratio (1.5 now), light count and texture size.
- **Touch feel.** Look sensitivity (`PLAYER.lookX`, `lookY`), the edge-turn rate, box sizes and the dead zone.
- **Audio.** Synthesised, never heard by a person. Weapon sounds are new.
- **The look.** The brick, stone and timber basement was checked in screenshots only.

## Names
The robots use invented names: "Dr Fizzbang" (melee) and "Bampot and Nephew" (ranged). They replaced two real brand
names at the owner's request. The earlier names still appear in the public git history (old commit messages and
pull request text); rewriting history was not requested, so it was left alone. No trademark search has been done on
the new names.

## Decisions for the full game
- Length: about two hours to complete.
- Orientation: portrait and landscape (landscape added after the first draft of this plan, on the owner's request). The manifest no longer locks the orientation.
- Devices: any iOS device released in the past four years (as of October 2026: iPhone 14 and newer, plus iPads of the
  same age). That means Safari 16 or later, WebGL 2, and an A15-class GPU as the performance floor. Consequences:
  - iOS has no Vibration API, so no haptics.
  - Audio only starts after a tap (already handled in `gesture()`).
  - Gyro aiming would need a permission prompt; not planned.
  - Low Power Mode caps the frame rate at 30; the fixed-step loop already copes, but test it.
  - iPads count, so layouts must work at about 820 x 1180 in portrait. It works today, but the control boxes keep
    their phone size (180 px cap in `hud.layout`) and look small there. Scale them up on large screens.
- Story: a light comic frame (short written lines, no cutscenes, no voice acting).
- Levels: 8 to 10 (8 core, 2 stretch).
- Graphics: the owner wants a more modern look than the current flat-shaded low-poly. Direction still to decide.
- The full plan is in `docs/full-game-plan.md`.

## Approved enemy ideas (not built)

The owner approved all five of these for the game. Number 1 is now built (level 2); the other four are **not built and must not be added** until the owner says so.
They are not tied to level 1 and may appear in any level. Approval of an enemy is not permission to build a later
level (see the standing rule). The melee and ranged rule holds: Fizzbang robots only fight in melee, Bampot robots can
shoot.

| # | Robot | Camp | Idea |
| --- | --- | --- | --- |
| 1 | Shielded Fizzbang | Melee | **Built, in level 2.** Carries a vending-machine door as a shield. Shots from the front do almost nothing, so the player flanks it, shoots it from behind, or uses the launcher or shotgun up close |
| 2 | Fizzbang Shaken | Melee, exploder | A shaken can that rattles faster as it nears, then bursts in a fizzy blast when it dies or touches Freddie. It can set off neighbouring robots, so shooting it close is a mistake |
| 3 | Bampot Longshot | Ranged, sniper | A tall bottle robot with a visible laser line that charges for a moment, then fires one heavy shot. Makes cover matter |
| 4 | Bampot Nurse | Support | Does not attack, but revives dead robots after a few seconds unless killed first. Makes kill order matter |
| 5 | Vending Mimic | Melee, dormant | An ordinary-looking drinks machine in a corner that unfolds into a robot when Freddie walks past. It is in the level from the start, so nothing appears from nowhere |

Notes for whoever builds them: each needs a model and poses in `src/models.js`, a definition in `src/data.js`, AI in
`src/game3d.js`, placement in the level data, a bot and headless check, and a screenshot review. The idea of the first
three for level 1 (Shielded, Longshot, Mimic) was suggested but not approved for level 1 specifically.

## Parked
- **Top-down version.** Replaced by this rebuild. It is in git history on `main` (squash commits up to PR #2).
- **Top-down tuning work for levels 2 to 5** (a headless balance simulator and tuning passes) is on the branch
  `tune-levels`, unmerged. It only applies to the top-down game.
- **Levels 3 and later** do not exist in the first-person game yet.

## Rule: balance is for normal mode only
Debug mode (2x fire rate, 2x damage, 2x health) is a testing aid. Never tune enemies, weapons, areas or anything in
`src/data.js` against it.
