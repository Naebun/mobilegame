# Roadmap and deferred work

## Current focus: level 1 (the Cowgate)

The owner is testing level 1 by hand, using debug mode on the home screen. Until they say otherwise, do not
change levels 2 to 5, their bosses, or anything that only affects them. Work on level 1 and on shared systems
only when asked.

## Deferred: levels 2 to 5 (come back to these)

Levels 2 to 5 exist and play through in the automated smoke test, but a person has not played them. Nothing
below has been reviewed against real play:

- Level 2, the Royal Mile (rain, buskers, boss: the Tour Guide)
- Level 3, the Grassmarket (stag and hen parties, boss: the Best Man)
- Level 4, Princes Street Gardens (monument, trees, boss: the Mascot)
- Level 5, Arthur's Seat (rocks, dawn lighting, boss: the Headliner)

Open questions for when we return:

- Difficulty. The only evidence is a crude bot (a player who never touches the screen): it survives level 1,
  and dies after roughly 50 to 60 seconds on levels 3 and 5. That is not a substitute for human play.
- Boss fights have never been played by a person: the charge, summon and ring attacks, their timings and
  their health.
- The upgrade screen, and whether three picks from seven give enough variety across five levels.
- Per-level obstacle layouts, enemy mixes, and the Edinburgh jokes on those levels.
- The title-screen skyline is a rough silhouette.

## Rule: balance is for normal mode only

Debug mode (2x fire rate, 2x damage, 2x health for Freddie) is a testing aid. Never tune enemies, spawns,
bosses, upgrades or anything in `src/levels.js` against it. Balance only against normal mode.
