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

## Names and brands
"Dr Pepper" and "Wray and Nephew" are real brands, used in text only; the robots are generic battered machines with no
logos. The GitHub Pages site is public, so rename them in `src/data.js` before sharing widely if that matters.

## Parked
- **Top-down version.** Replaced by this rebuild. It is in git history on `main` (squash commits up to PR #2).
- **Top-down tuning work for levels 2 to 5** (a headless balance simulator and tuning passes) is on the branch
  `tune-levels`, unmerged. It only applies to the top-down game.
- **Levels 2 and later** do not exist in the first-person game yet.

## Rule: balance is for normal mode only
Debug mode (2x fire rate, 2x damage, 2x health) is a testing aid. Never tune enemies, weapons, areas or anything in
`src/data.js` against it.
