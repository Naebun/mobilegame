# Roadmap and deferred work

## Current state: level 1, first person

The game was rebuilt from a top-down shooter into a first-person 3D game. Level 1 (the Cowgate) is playable end to
end: six linear areas, pre-placed robots, door unlocking, four weapons, a boss, and a completion screen.

Verified by automated tests: the whole flow in a real headless browser (menus, both control boxes, auto-fire, clip and
reload, swap, rockets, enemy bottles, areas and doors, death and retry, completion, debug mode); the level geometry and
collision; a headless bot beats the level every time at three aim skills.

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
- Orientation: portrait only.
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

## Parked
- **Top-down version.** Replaced by this rebuild. It is in git history on `main` (squash commits up to PR #2).
- **Top-down tuning work for levels 2 to 5** (a headless balance simulator and tuning passes) is on the branch
  `tune-levels`, unmerged. It only applies to the top-down game.
- **Levels 2 and later** do not exist in the first-person game yet.

## Rule: balance is for normal mode only
Debug mode (2x fire rate, 2x damage, 2x health) is a testing aid. Never tune enemies, weapons, areas or anything in
`src/data.js` against it.
