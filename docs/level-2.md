# Level 2: the Vaults

Built on request, with the owner's explicit permission for level 2 only. Level 3 and later are still not to be built
without permission (see `CLAUDE.md`). Numbers marked "bot" come from the headless bot, which is a proxy for a person. We
have not had a human play this level, and nothing here has been seen on a real phone.

## Story and flow

Level 1 ends on NEXT LEVEL. A voicemail card from Cheryl (Freddie's agent) plays, then the level 2 intro, then play.
Freddie starts level 2 with the pistol only and full health, same as level 1. There is no save data, and no carry-over of
weapons. Best scores are kept per level (`mobilegame.fps.best` for level 1, `mobilegame.fps.best.2` for level 2). Debug
runs still never write a best score.

`?level=2` starts a new game on level 2, for development. The game itself goes 1 then 2.

## The place

Six linear areas under South Bridge and Mary King's Close. A door out of each unlocks when its robots are dead, like
level 1. The numbers are what the bot saw, not a promise for people.

| # | Area | Shape | Robots | Pickups |
| --- | --- | --- | --- | --- |
| 1 | Blair Street Steps | Start room, stairs up to the street (cold light) | none | Dram |
| 2 | The Long Vault | 32 x 5 tiles, columns down the middle, torches 12 tiles apart, dark between | 2 Fizzbang, 1 Bampot | Shotgun, Dram |
| 3 | Cask Cellar | 13 x 12, stacks and barrels for cover, brazier | 3 Fizzbang, 1 Bampot, 1 Shielded | SMG, Vinyl Disc, Heavy, Orange, Dram |
| 4 | Mary King's Close | 38 x 5 street, house doors and lit windows, carts, hanging lanterns | 3 Fizzbang, 2 Bampot, 2 Shielded | Launcher, Energy, 2 Dram |
| 5 | The Plague Cellar | 32 x 14, columns in a grid, tombs, skull niches, hanging braziers | 3 Fizzbang, 1 Bampot, 1 Shielded | Last Orders, Heavy, Orange, 2 Dram |
| 6 | The Last Tour | 31 x 10, columns, tombs, banners, braziers; exit alcove behind the last door | the Tour Guide, 1 Bampot, 2 Fizzbang | Heavy, 3 Dram |

24 robots including the boss, against 19 in level 1.

## New things

**Shielded Fizzbang** (melee, Dr Fizzbang camp). It carries a vending-machine door. A hit from inside 63 degrees of the
way it faces does 12 percent of its damage. Explosions ignore the shield. A shotgun blast inside 3.5 m does half
(`shieldBreak` on the weapon, `closeMult` on the shield). It turns slowly (1.9 rad/s, the others 7), so a player who
keeps moving gets behind it. All numbers are in `ENEMY_DEFS.shielded` and `WEAPONS.shotgun` in `src/data.js`.

**Vinyl Disc** (weapon, 8 in the clip). A flat, fast disc that bounces off walls, floor and ceiling up to three times
and stops in the first robot it hits. The bounce is how to reach a shielded robot's back from the front.

**The Tour Guide** (boss, Bampot camp, so it shoots). Fans three bottles at a time, and swings its lantern pole at
anyone inside 2.4 m (24 damage, dodgeable in the wind-up). Below half health it enrages: five bottles, shorter gaps, 25
percent faster. Last Orders is refused in its room, like the Bouncer's.

## Look

Nearly dark on purpose. The baked ambient tint is a third of level 1's, the fog is near and black, and the world's four
point lights are braziers and lamps. Wall torches light pools through the baked light (no extra lights). Freddie's own
torch is much stronger than in level 1 (`LEVEL_DEF.torch` in `src/levels/vaults.js`). Flames are soft crossed quads
drawn additively and re-shaped every frame. The ceiling is flat with stone arch ribs under it; a true barrel vault was
tried on paper and dropped, because doors in the long walls would be cut off by the curve.

Still procedural: no image files. Level 2 reuses level 1's generated stone, flag, brick and plaster textures with
darker tints.

## Where things are

| Path | What |
| --- | --- |
| `src/levels/vaults.js` | The map, areas, styles, atmosphere, spawn and pickup letters (pure data) |
| `src/levels/vaults-decor.js` | The dressing: torches, columns, ribs, barrels, tombs, carts, skull niches, flames |
| `src/world.js` | `buildWorld({ level })` and the hooks the decor plugs into (`plan`, `lights`, `prop`, `dress`, `finish`, `animate`) |
| `src/game3d.js` | Level loading (`loadLevel`, the deferred swap), shields, the boss's volley, slam and enrage, the disc |
| `scripts/harness/level-check.mjs`, `combat-check.mjs` | Structure and combat rules |

## Balance, as far as a bot can tell

Normal mode only; never against debug mode. The headless bot (`npm run sim -- --level 2 --runs 30`) is a proxy for a
person and plays better than a thumb in a small box with no aim assist. Last run, after tuning:

| Bot skill | Win | Average damage taken (level 1 for comparison) | Where the losses were |
| --- | --- | --- | --- |
| sloppy | 83 percent | 147 (71) | Plague Cellar 4, Tour Guide 1 |
| casual | 97 percent | 106 (44) | Plague Cellar 1 |
| good | 90 percent | 90 (26) | Plague Cellar 2, Tour Guide 1 |

So level 2 is meant to be clearly harder than level 1, which every bot beats every time. "Good" scoring below "casual"
is run-to-run noise at 30 runs, or the good bot's fast turning catching on columns; we have not dug into which. Two
tuning passes were needed: the first build (34 robots, 5 Bampots in the Plague Cellar, a 520 hp boss) beat the sloppy bot
10 percent of the time. What changed: fewer robots, fewer Bampots, one Shielded in the Plague Cellar instead of two, more
drams, boss 520 to 360 hp, bottle damage 12 to 10, slower fire. A human playtest should decide whether it is now too hard
or too soft. The numbers live in `ENEMY_DEFS` and the map letters.

## Tests run

- `node scripts/harness/level-check.mjs`: every level, structure, spawns, pickups, doors one at a time, budgets. Passes.
- `node scripts/harness/combat-check.mjs`: shield arc and factors, shotgun break, explosion pierce, slow turn, disc bounce
  and hit, boss volley, slam damage, enrage. 26 of 26.
- `node scripts/harness/world-check.mjs`: level 1, unchanged, 4368 of 4368.
- `npm run sim` (level 1) gives the same numbers as before the refactor (100, 100, 100 percent).
- `npm run smoke`: level 1 through NEXT LEVEL, the voicemail, level 2, to its exit and back to the title.
- `models-check`, `ui-check`, `drinks-check`: pass.
- Screenshots of every area and the new robots, taken in the real render pipeline (software WebGL, medium tier), were
  looked at. Frame rate and look on a real phone are not known.

## Not verified

- Anything on a real phone: frame rate, load time (a level swap builds the world in a few hundred ms on this machine,
  untested on an A15), touch feel in the dark.
- Audio: the Vinyl Disc, shield clang and ricochet sounds are synthesised and have never been heard by a person.
- Whether the level is fun. The bot cannot tell us, and nobody has played it.
- The Tour Guide's slam reach and bottle fan against real thumbs.
