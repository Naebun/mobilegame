# Placement: the newer robots, weapons, upgrades and records in levels 1 and 2

The owner said to put the prepared enemies, weapons, upgrades and collectibles into the two levels that exist. This file is
the decision, the reasons and the table, so any item can be vetoed by name. Nothing here is level 3, there are no new maps,
areas or bosses, and `src/world.js` and `src/game3d.js` were not changed for it (it is map letters and `src/data.js` only).

Nobody has played any of this. Every win rate below comes from the headless bots in `scripts/sim3d.mjs`, which aim better than a
thumb in a small box. They are a proxy. Where a number is a guess, it says so.

## The table (the veto list)

Tiles are `(column, row)` on the level's map, counted from the top left; one tile is 2 m. "From the door" is the walking
distance from the door each area is entered by, with every door open. The map letter is in brackets.

### Level 1, the Cowgate (the easy level)

| Item | Area | Tile | Why there |
| --- | --- | --- | --- |
| Vending Mimic (`m`) | Cloakroom | (21, 42), against the east wall | The first fight is the lowest-stakes room (two Fizzbangs). The machine stands at the far end of the room and is in sight from the door in, 30 m away, so nothing appears from nowhere. The door out stays shut until it is dead, so the player has a reason to walk up to it. Shot from range it is just a 100 hp robot; walked up to, it costs one 22 hit at most. The area hint now says "Nobody ordered that vending machine." |
| Fizzbang Shaken (`k`) | Dancefloor | (31, 35), replacing a Fizzbang | The big hall, with pillars and speaker stacks to work round. 26 m from the door, so the rattle is heard at 4 Hz long before it is a threat, and there is room to back off and shoot from beyond 3.2 m. It replaces a Fizzbang, so the room has the same number of robots |
| Bampot Longshot (`l`) | Dancefloor | (12, 27), replacing a Bampot | The dancefloor has the most cover on the level (54 shot-blocking tiles counting its walls), and a speaker stack stands straight in front of the door in. 29 m from the door, so the first sight of it is a red line across the room. The hint says "A red line means move." |
| Bampot Nurse (`u`) | Bar | (5, 21), south-west end | She never attacks. She starts 4.5 m from a Fizzbang and 12 m from the Bampots, so a body near her is a melee robot, not a shooter. Her revive reach is 6 m and she never walks to a body, so it only matters if the player ignores her. The hint says "The nurse gets them back up." |
| Airhorn (`W`) | Bar | (2, 21), south-west corner | The bar is a long room with three Fizzbangs, and the level has no weapon in it. A panic button belongs in the room where the player is most likely to be swarmed in melee |
| Extended clips, tier 1 (`C`) | Cloakroom | (21, 45), south-east corner | A nook three tiles from the Mimic, off the straight line to the door. Easy to miss, easy to find if the player looks round the first room |
| Speed loader, tier 1 (`R`) | VIP corridor | (1, 9), west end | In the corridor the player enters at its west end, beside the Launcher. The corridor has no cover, but the nearest robot starts over 30 m away, so the pickup is out of danger |
| Record: Haar on the Water (`q`) | Stairwell | (5, 40), behind the crate by the stairs | The first room has no robots. The first record teaches that records exist, at no risk |
| Record: The Bypass Dub (`y`) | Dancefloor | (2, 24), north-west corner | A corner of the big hall, far from the route to the door and from the Longshot |
| Record: Gala Day, Slow Version (`z`) | Bar | (34, 14), north-east alcove | The alcove behind the wall at the east end of the bar, next to the Dram |
| Record: Pipes and Pressure (`a`) | VIP corridor | (34, 9), east end | The far end of the corridor, by the door to the backstage |
| Record: Wee Hours EP (`p`) | Backstage | (1, 2), exit alcove | Behind the last door, so it is collected after the Bouncer is dead and cannot be fetched during the fight. It is 3 m from the exit circle, so picking it up does not end the level |

### Level 2, the Vaults (the harder level)

| Item | Area | Tile | Why there |
| --- | --- | --- | --- |
| Bampot Nurse (`u`) | Long Vault | (34, 48) | The Nurse is already met in level 1, so she goes in the first fight of the dark level. She stands 5.7 m from a Fizzbang, 50 m of corridor from the door, so she is reached late, and bodies near her are Fizzbangs |
| Fizzbang Shaken (`k`) | Cask Cellar | (40, 39), 2 m from a Fizzbang | Casks and barrels to work round. It stands next to a Fizzbang, so shooting it from beyond 3.2 m also hits that Fizzbang with the blast (45). 15 m from the door |
| Vending Mimic (`m`) | Mary King's Close | (22, 28), north wall of the street | The player walks the street from the east. A machine in a house doorway is in keeping with the tour. It is in sight from the east end only as a lit window in the dark, 42 m away |
| Bampot Longshot (`l`) | Plague Cellar | (26, 16), replacing the Bampot | The columns in a grid are the best cover in the level, and the laser is visible across the room in the dark. 48 m from the door, so it wakes late. It replaces the room's Bampot, so the room has the same number of robots |
| Bass-Drop Grenade (`Z`) | Plague Cellar | (3, 25), just inside the door | The Plague Cellar is the biggest pack of robots in the level. The pickup is the first thing the player passes |
| Feedback Beam (`F`) | Plague Cellar | (18, 13), below the door to the Last Tour | Found on the way to the boss. The Beam suits a long fight with one tough target (the Tour Guide, a Mimic) |
| Extended clips, tier 1 (`C`) | Long Vault | (30, 47), north wall | Along the wall of the long corridor, 4 m off the centre line: easy to miss, easy to find |
| Speed loader, tier 1 (`R`) | Close | (9, 28), west end | Near the end of the street, before the Plague Cellar |
| Burst pedal (`A`) | Cask Cellar | (31, 41), three tiles from the SMG | The SMG's alt-fire is no use without the SMG, so the pedal is by it |
| Record: Supper After Last Orders (`q`) | Blair Street Steps | (4, 47), behind the stairs | The start room again: no robots |
| Record: Tram Works, Extended Mix (`y`) | Long Vault | (42, 47), east end | Beside the door out, so it is found on the way if the player looks right |
| Record: Cheryl's Hold Music (`z`) | Cask Cellar | (30, 34), north-west corner | A corner of the cellar, far from the entry |
| Record: First Foot First (`a`) | Close | (5, 30), west end | The quiet west end of the street |
| Record: No Refunds, B-Side (`p`) | Plague Cellar | (33, 13), north-east corner | The far corner of the last big room, away from the door in. Not in the boss room |

Upgrades and weapons reset at the start of each level, as the arsenal agent built it, so each level places its own. Upgrade
pickups at the top tier stay on the floor. Level 1 has clip tier 1 and reload tier 1 only; level 2 has the same two plus the
pedal. No second tier of either is placed anywhere (the tiers exist if the owner wants them).

## Reasoning

- **Introduce each robot where it is gentle, then use it harder.** Level 1 holds one of each of the four, each in a different
  room, and level 2 holds one of each again, in a different room from where the level 1 one stood and with more on the line.
  The Mimic is the only one that is a surprise on purpose, and even it is in sight from the door in.
- **Replace before adding.** In level 1 the Shaken replaces a Fizzbang and the Longshot replaces a Bampot, and in level 2 the
  Longshot replaces the Bampot in the Plague Cellar. Level 1 went from 19 to 21 robots (the Mimic and the Nurse are added) and
  level 2 from 24 to 27.
- **The Nurse matters only if she is ignored.** She never walks to a body, her reach is 6 m, and she flees from Naebun inside
  9 m. A body can only be revived if it died within 6 m of her and in her sight. In both levels she starts within 6 m of one
  melee robot and a long way from any shooter. In the final bot runs she revived 0.0 to 0.1 robots a run.
- **Cover and distance for the Shaken and the Longshot.** Neither is placed within 8 m (Shaken) or 14 m (Longshot) of the door
  in, and the Longshot's room has pillars or stacks. The Close, a street with no pillars, has no Longshot for that reason.
- **Nothing in the start room, nothing new in a boss room.** The two start rooms have no robots. No new robot stands in the Bouncer's
  or the Tour Guide's room. The only pickup in a boss area is the level 1 record behind the exit door, so it cannot be
  reached during the fight (asserted by `arsenal-check`).
- **Pickups.** Weapons lie where they suit their role: a panic button in the swarm room, a pack-stopper at the door of the biggest
  pack, a boss weapon on the way to the boss. Upgrades are off the straight line but within sight of it. Records are in corners,
  alcoves and the start rooms; none needs a fight to reach.
- **No change to the save format.** Records were already saved as ids. Records use one map letter each (`q y z a p`, a different
  table in each level), so `src/world.js` did not change.

## What the bots know

`scripts/sim3d.mjs` was taught these. They are guesses at how a person of each skill plays, with delays and misses, and none has
been compared with a person. A level with none of the new things plays exactly as before (checked: identical output on the old
maps, run for run, with `--exact 1`).

| Thing | Sloppy | Casual | Good |
| --- | --- | --- | --- |
| Longshot's laser | Notices the lock 45 percent of the time, sidesteps after 0.3 to 0.6 s | 70 percent, 0.2 to 0.36 s | 90 percent, 0.11 to 0.21 s |
| Fizzbang Shaken | Walks away inside 4.2 m | Inside 5.5 m | Inside 7 m. All three refuse to shoot one closer than 3.5 m, and fight if cornered |
| Nurse | Shoots her only once she is channelling | Once there is a body for her | First, whenever she is in sight |
| Mimic | Walks up to it | Shoots it from 7 m | Shoots it from 10 m |
| Beam | Boss or Mimic inside 8 m | Inside 12 m | Inside 15 m |
| Grenade, Airhorn, SMG alt-fire | Grenade on a pack of three, Airhorn when two are on top of it, alt-fire when the pedal is fitted. Chosen by a direct select (see the last section; until then a special weapon was used only when it was at most 2 presses of SWAP away and the way back at most 3) | same | same |
| Upgrades and records | Fetched within 15 m (records 8 m) | 28 m (14 m) | 60 m (24 m) |

One finding from teaching them (**now fixed**, see "Weapon selection and the bots" below): **SWAP only cycled forward through the owned weapons.** With seven guns (level 2 after the Grenade
and the Beam) the Grenade is four presses from the SMG and three back, about a second with the gun down. A first version of the
bots swapped to it anyway and lost the Plague Cellar far more often (sloppy bot, pickups only, no new robots: 60 percent against
72 percent once the swap cost was counted). A person would hit the same wall. This is a design question for the owner, not
something this change settles: a swap-back button, a weapon wheel or fewer guns per level would all help. The bots now use the
special weapons less than a person who liked them would.

## Numbers

The bot runs below are normal mode, never against debug mode. 30 runs per cell is good for plus or minus 15 points, so
differences of less than about 15 points are not real. "Before" is the unchanged maps with the same bots.

### The final placement, 60 runs per cell

| Level | Bot | Win before | Win after | Damage taken before to after | Where the bots died after (and what killed them) |
| --- | --- | --- | --- | --- | --- |
| 1 | sloppy | 100 | 98 | 69 to 67 | dancefloor 1 (a Fizzbang) |
| 1 | casual | 100 | 100 | 45 to 44 | none |
| 1 | good | 100 | 100 | 24 to 29 | none |
| 2 | sloppy | 63 | 68 | 147 to 131 | Plague Cellar 8, Last Tour 7, Cask Cellar 3, Close 1 (Tour Guide 11, Fizzbang 3, Shielded 2, Bampot 1, bottle 1, Longshot 1) |
| 2 | casual | 93 | 88 | 113 to 95 | Last Tour 5, Plague Cellar 2 (Tour Guide 5, bottle 2) |
| 2 | good | 92 | 93 | 84 to 65 | Plague Cellar 3, Cask Cellar 1 (Tour Guide 3, Bampot 1) |

Targets were level 1 sloppy 85 or more, casual and good 95 or more; level 2 no easier than before and no harder than sloppy 65,
casual 80, good 85. Level 1 meets its targets. Level 2 meets the "no harder than" floors, and is not distinguishable from the
old level 2 at this sample size: the same bots on the old maps scored 63, 93 and 92 here, and 77, 77 and 97 at 30 runs in
`docs/level-2.md`'s way of running them (initialising the game afresh each run, `--exact 1`), so the old level's own numbers
move by about 15 points between runs. Level 2 is clearly harder than level 1 for the sloppy bot (68 against 98) and about equal
for the casual and good bots, which handle every new thing.

The same bots on the old maps also gave: level 1 sloppy 100, casual 100, good 100 and level 2 sloppy 77, casual 77, good 97
(30 runs, `--exact 1`, before any of this).

### How the placement was reached (30 runs each; level 2 win percentages, sloppy / casual / good)

| Try | What it was | Level 1 | Level 2 |
| --- | --- | --- | --- |
| A | Longshot in the Long Vault, two Shakens in the Cask Cellar, Nurse in the Plague Cellar by the Bampot | 100 / 90 / 97 | 47 / 83 / 87 |
| B | Longshot and Nurse both in the Plague Cellar, one Shaken, nurse moved away from the level 1 Bampots; bots swap to special weapons freely | 97 / 97 / 97 | 43 / 80 / 93 |
| B2 | the same maps, bots count the cost of SWAP | 97 / 100 / 100 | 57 / 87 / 97 |
| C | Longshot in the Cask Cellar, Nurse in the Long Vault, Plague Cellar as it was | not run | 60 / 90 / 100 |
| D (final) | Longshot in the Plague Cellar, Nurse in the Long Vault | 98 / 100 / 100 (60 runs) | 63 / 93 / 97 (60 runs: 68 / 88 / 93) |

What the tries showed:

- A Longshot in the first fight of the dark level (try A) killed the sloppy bot there three times in 30, with the pistol
  only. It stands in the Plague Cellar now, where the columns are cover and the player has most of the guns.
- A Nurse standing by the Bampots (level 1 bar, try A) killed the casual bot three times in the bar: a revived Bampot keeps
  throwing. She stands by a Fizzbang now.
- Taking out each robot kind in turn from try B (sloppy bot, 40 runs each, level 2) moved the win rate by 15 points or less in
  every case, which is inside the noise, so no single kind is the culprit; the Shaken is the one whose removal moved it most
  (43 to 58). All four robots together cost about 17 points; the new pickups, once the swap cost was counted, cost about nothing
  (72 percent with pickups and no new robots, against 63 to 77 on the old map).
- Before the bots counted the cost of SWAP, the same pickups cost the sloppy bot about 10 points, nearly all of it in the Plague
  Cellar (12 deaths there against 4). The likely cause is the bot cycling through seven guns to reach the Grenade in the middle
  of a fight. That is an inference from where the deaths were; it was not tested on its own.
- Because the bots use the special weapons so little now, these numbers say almost nothing about what the Grenade, Beam and
  Airhorn do for a player. The pickups are probably worth more to a person who uses them than the table shows, or less if
  SWAP gets in the way for them as well.


## Weapon selection and the bots (after direct selection)

Direct selection (`docs/HANDOVER.md`, Weapon selection) replaced the forward-only cycle as the way to choose a weapon. The bots in
`scripts/sim3d.mjs` now pick the weapon they want in one action (the number key for its slot, the same code path as a tap on the
strip), paying the game's 0.25 s swap plus their own 0.35 s pause before deciding again. Their decision rules are unchanged: only the
"at most 2 presses away" limit is gone. Normal mode, 60 runs per skill, `--exact 1` (a fresh game each run, so before and after use the
same seeds and the same clock), win percent sloppy / casual / good. "Before" is the old bots on the game as it stood, "after" the new
bots on the new game. 60 runs is good for about plus or minus 6 points on one number.

| Map | Before | After | After, bots also lose 0.35 s of aiming and moving per select (a guess at a thumb leaving its control) |
| --- | --- | --- | --- |
| Level 1 | 98 / 98 / 100 | 100 / 97 / 100 | not run |
| Level 2 | 62 / 82 / 97 | 37 / 83 / 92 | 52 / 85 / 88 |
| Level 2, Beam pickup removed from the map, both sides | 62 / 95 / 90 | 78 / 93 / 95 | not run |

Damage taken per run (sloppy / casual / good): level 1 70 / 44 / 21 before, 65 / 46 / 18 after; level 2 141 / 98 / 68 before, 138 / 88 / 67 after.
Where they died: level 1 before, one sloppy in the VIP corridor and one casual in the bar; after, two casuals in the bar. Level 2 sloppy, before:
Plague Cellar 14, Tour 7, Long Vault 1, Cask Cellar 1; after: Plague Cellar 21, Tour 12, Long Vault 2, Cask Cellar 2, Close 1 (killed by the
Tour Guide 16 times before, 29 after). Level 2 casual: Tour 4 and Plague 7 before, Tour 4 and Plague 6 after. Good: Tour 1 and Plague 1 before,
Plague 3 and Tour 2 after.

What each special weapon was used for (per run, sloppy / casual / good):

| | Level 1 before | Level 1 after | Level 2 before | Level 2 after |
| --- | --- | --- | --- | --- |
| Grenade throws | 0 | 0 | 4.2 / 3.2 / 2.9 | 2.5 / 2.4 / 1.1 |
| Airhorn blasts | 2.2 / 4.8 / 6.0 | 0.9 / 0.1 / 0.1 | 0 | 0 |
| Beam, seconds firing | 0 | 0 | 8.2 / 9.4 / 5.2 | 10.8 / 8.0 / 7.3 |
| SMG alt-fire bursts | 0 | 0 | 6.0 / 4.3 / 4.1 | 6.1 / 4.5 / 3.9 |
| Weapon selects (new bots only) | | 13 / 11 / 10 | | 23 / 22 / 22 |

What this says, and how far to trust it:

- **Direct selection helps the bots when the Beam is out of the picture.** With the Beam pickup removed on both sides, the sloppy bot
  goes from 62 to 78 and the good one from 90 to 95; the casual bot is the same within the noise (95 and 93). That is the effect the change was for,
  and it is about as large as the swap-cost finding above suggested (60 against 72).
- **With the Beam in, the sloppy bot gets worse (62 to 37) and the good one a little (97 to 92).** The cause is the Beam rule, which this change did
  not touch: use the Beam on a boss or a Mimic inside a range set by aim steadiness. Before, the Beam was mostly out of reach in the cycle; now every
  bot reaches it and holds it for 17 to 22 s a run, and the Tour Guide kills the sloppy bot 29 times in 60 instead of 16. Taking the Beam
  out of the map restores the win rate, so in these runs holding it against the Tour Guide does worse than the launcher the bots would
  otherwise use. Our reading, not tested: its damage only climbs while the crosshair stays on the target, and a wobbling aim restarts the climb.
  We have not tried it with a person. If people turn out the same, the Beam wants a retune or the bots' rule wants changing; both are the
  placement engineer's call and neither was touched here.
- **The old special-weapon numbers were partly incidental.** A picked-up weapon is selected on pickup, and the old bots spent several swap presses
  cycling away from it while still firing. The Airhorn's 2.2 to 6.0 blasts a run on level 1 fell to 0.1 to 0.9 once the bots could leave it in one
  press and only used it by their rule. That is an inference from the code, not something we isolated.
- **The bots still have no cost for reaching the strip.** The right-hand column adds 0.35 s of no aiming, walking or firing per select. It is a guess
  at a thumb leaving its control, and the sloppy bot's 52 against 37 shows how noisy these numbers are, not that a cost helps.
  Nobody has measured how long a real thumb takes to hit a cell at the top of a tall phone.

## What to watch in a playtest

- **The Longshot's lock.** 0.55 s to sidestep 0.6 m with a thumb in a small box is the guess the whole design rests on. If players
  cannot do it, the Plague Cellar and the dancefloor are the first places it will show. The numbers to turn are
  `ENEMY_DEFS.longshot.charge` and `damage` in `src/data.js`.
- **Whether anyone finds the Mimic before it finds them.** The hint line gives it away a little on purpose. Check whether the
  cloakroom door feels stuck ("one robot left, where?").
- **The Shaken's rattle in a group.** Level 1 and 2 have one each, so the chain ripple is not exercised by any level.
- **Whether the Nurse is noticed at all.** In the bot runs she is almost always killed before she revives anything. If players
  never see a revive, she is decoration, and a second Nurse or a Nurse next to the Bampots would make her matter.
- **Weapon swapping.** Direct selection exists now (a tap on the strip, number keys, wheel, Q). Watch whether players pick up the Grenade
  and Beam and never use them, and whether anyone can reach the strip at the top of the screen with a thumb mid-fight.
- **The Beam against the Tour Guide.** In the bot runs it is a worse boss weapon than the launcher (see the last section). Watch whether people
  who select it for the boss do worse than people who keep the launcher.
- **Records.** Whether five a level feels like a hunt or like clutter, and whether the exit-alcove one in level 1 is found.
- **Level 2 for a weak player.** The sloppy bot is at the edge of what was asked for (see the numbers); the Plague Cellar and the
  Tour Guide are where it dies.

## Not verified

- Nobody has played it. No phone was used. None of the new sounds has been heard.
- The bots' skill levels are guesses, and the bot never gets lost, fumbles a touch or looks at the wrong thing.
- The bots collect upgrades and records within a reach; how many a person finds is unknown.
- The look of each item in its real spot was checked in screenshots in portrait and landscape (see the report that came with this
  change), not on a phone.

## How to change it

Edit the map letter in `src/levels/cowgate.js` or `vaults.js` and the matching table in `scripts/harness/enemies-check.mjs`
(`PLACED`, `ROBOTS`), `scripts/harness/arsenal-check.mjs` (`PLACED`) and, for level 1, `scripts/harness/world-check.mjs`. A
Mimic may stand one tile from a wall (1.0 m of clearance); every other robot needs 1.2. Run `level-check`, `world-check`,
`enemies-check`, `arsenal-check`, the smoke test and the sims on both levels afterwards.
