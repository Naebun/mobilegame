# Level 3: the Grassmarket (design only)

This is a planning document. Nothing in it is built, and nothing here is permission to build. `CLAUDE.md` says level 3
needs the owner's explicit go-ahead, and a go-ahead for this document is not that. Every number is a proposal we have
not tested. Where we do not know something, it says so.

## Choices the owner made

| Question | Choice | Why we think it fits |
| --- | --- | --- |
| Setting | Grassmarket pubs | Fully lit and warm, so it contrasts with the dark Vaults. It reuses the indoor pipeline and keeps the A15 performance budget safe. Timber and plaster are two of the baked textures |
| Boss | The Landlord | A barrel thrower. The barrels can be shot early, which rewards aiming and stays readable on a thumb |
| New robot | Fizzbang Turbo, plus the five existing | One new robot gives the level its own identity. The Shielded, Shaken, Longshot, Nurse and Mimic already exist and can be recombined |

Not a dark level. Level 2 is the first torch level, and the torch is meant for 2 or 3 of the 10. The level sets
`dark: false`, the torch stays on every gun and F still switches it on for anyone who wants it.

## Story and flow

Level 2 ends on NEXT LEVEL, as level 1 does. A Cheryl voicemail plays, then the level 3 intro card, then play. Naebun
starts with the pistol only and full health, the same as the other levels (weapons do not carry over; the saved torch
state does).

Placeholder copy, in the same tone as the others:

- Cheryl: "Naebun, I have found you a pub with a stage. Several pubs, actually. They are all connected, and I would not
  say they are all friendly."
- Intro line: "Last orders was an hour ago. Nobody told the robots."
- Recall notice for the walls: "KEG 12 HAS BEEN RECLASSIFIED AS A WEAPON. THE LANDLORD HAS BEEN ASKED TO STOP."
- Boss quote: "Time, gentlemen, please."

Pub names are invented. No real pub, brewery or drink brand appears in names, signs or models (`CLAUDE.md`).

## The place

Six linear areas, a door out of each opening when its robots are dead, as in levels 1 and 2. Rooms are small, which is
the point: many doorways and corners. Sightlines are short except in the Quiz Room, and the Longshot gets that room.

| # | Area | Shape | Robots (proposed) | Job in the level |
| --- | --- | --- | --- | --- |
| 1 | Victoria Street Steps | Stairs up from the Vaults into a cobbled back alley | none | Start room, a Dram, the first look at the warm light |
| 2 | The Snug Row | A run of five small timber snugs off a short bar, doorways between them | 3 Fizzbang, 1 Turbo | Introduces the Turbo in a corridor-like space where a sidestep through a doorway beats it |
| 3 | The Quiz Room | One big room, round tables as low cover, a stage at the far end | 2 Fizzbang, 2 Bampot, 1 Longshot | The only long sightline, so the Longshot's laser matters. Cover is tables and pillars |
| 4 | The Kitchen | Tight, steel counters, pass-through hatches | 3 Shaken, 1 Fizzbang, 1 Nurse | Shakens in a small room make distance the whole question. The Nurse stands behind the pass |
| 5 | The Function Room | Wide, long tables, a fruit machine and a drinks machine against the wall | 2 Turbo, 1 Shielded, 1 Mimic, 1 Bampot | The drinks machine is the Mimic. Turbos use the long lanes between the tables |
| 6 | The Landlord's Lounge | Boss arena: a horseshoe bar, barrel racks, a clear floor | the Landlord, 2 Fizzbang (and 1 Turbo after the enrage) | The Landlord. Last Orders is refused here, as in the other boss rooms |

About 27 robots including the boss, against 24 in level 2 and 19 in level 1. This is a first guess. It is lit, so more
robots is not the same as harder as it was in the dark; we expect the Turbo and the Shaken to be what hurts.

## New things

**Fizzbang Turbo** (melee, Dr Fizzbang camp). A can with a stripe and a wind-up key. It walks, stops, rattles for 0.7 s
with a dust trail and a floor mark along its line, then charges in a straight line at 9 m/s. A charge that hits Naebun
does 18. A charge that misses and hits a wall or pillar stuns it for 1.8 s and it takes 1.5 times damage while stunned.
Charge, then a 3 s cooldown. It does not turn mid-charge, so a sidestep or a doorway beats it, and a shotgun point-blank
as it arrives is still a good answer. Starting numbers: 55 hp, walking speed 2.8. The Nurse does not revive it
(Shaken and Nurses are already excluded, and a charging revived robot is a lot for one room; we have not tested this).

**The Landlord** (boss, Dr Fizzbang camp, so melee, plus the barrels as his one ranged tool). 420 hp to start. He lifts a
barrel and rolls it down a marked lane (the lane glows on the floor for 0.8 s before the barrel leaves). A barrel does 20
to Naebun and bursts on walls, pillars and the horseshoe bar. Shooting a rolling barrel bursts it early. A barrel that
bursts near the Landlord hurts him, so aiming at barrels is the intended skill. He swings a bar towel at anyone inside 2.4
m. Below half health he enrages: two barrels at a time, shorter gaps, 20 percent faster, and a Turbo arrives once.
Weakness to be tuned in play: that a barrel burst is worth more than a bullet. We do not know yet whether the lanes read
clearly enough on a small screen.

The tone, with the existing bosses, is that a robot boss is a person's fixed idea made of aluminium. The Landlord's is
closing time.

## Look

Warm timber, plaster, a little brick, brass and green leather, tungsten lamps: the opposite of the Vaults. Baked pools
under each lamp, a small camera fill, no more than the four world lights `CLAUDE.md` allows, and flames only as the
fireplace in the Snug Row and the Lounge. No neon except one classic bar sign.

It uses the baked brick, flag and plaster textures and needs a baked timber board texture for the floors and
panelling. If the texture work does not cover timber by then, level 3 would use the generated one.

## What would need building

All of this waits for the go-ahead. Rough size is a guess: small, medium or large.

| Piece | What | Size |
| --- | --- | --- |
| Level data | `src/levels/grassmarket.js` (map, areas, styles, atmosphere, pickups) | medium |
| Dressing | `src/levels/grassmarket-decor.js`, using `world.js` hooks as `vaults-decor.js` does | medium |
| Props, modelled in Blender | Bar and pumps, snug partitions, round tables, a pool table, a dartboard, a fruit machine, kegs, hanging pub signs. Several exist in the prop kit (bar, booth, barrels, casks); the rest are new in `scripts/blender/props.py` | medium to large |
| Fizzbang Turbo | Model, definition in `src/data.js`, charge AI, stun on impact, sounds, `enemies-check` cases, a bot that handles it | medium |
| The Landlord | Model, barrel volley and lanes, burst rules, enrage, sounds, checks | medium to large |
| Pickups | The clip and reload upgrades already exist; which tier appears here depends on `docs/placement.md`. Records: five more jokes if the owner wants records here | small |
| Story | Voicemail after level 2, level 3 intro, recall notices, death lines | small |
| Wiring | NEXT LEVEL after level 2, level 3 best score key, unlock in `save.js`, `?level=3`, `sw.js`, the completion screen moves to level 3 | small |
| Bots and balance | Teach the bots the Turbo and the barrels, then tune with `npm run sim` in normal mode only | medium |
| Tests | `level-check`, `world-check`, `combat-check` and `smoke` extended for level 3 | small |

## Budgets and risks

- Triangles: level 2 on the high tier is about 145k of the 150k limit. Pub rooms have many walls and many props, so we
  expect level 3 to need merged static geometry and the low tier's procedural props. We have not measured it.
- Narrow doorways and corners with a thumb in a small box and no aim assist may frustrate people. The Turbo in the Snug
  Row is the likeliest place. Only a human playtest will tell us.
- Lit rooms show far more of every robot than the Vaults did, so the look of the robots matters more here.
- The Turbo and the barrel lanes depend on telegraphs reading at phone size. We do not know that they do.
- Nothing about the new content has been heard or played by a person, and none of the levels has been seen on a phone.

## Decisions still open for the owner

1. Go-ahead to build level 3, and whether to build it in one pass or area by area.
2. Records: five more jokes for level 3, or fewer.
3. Whether level 3 should have its own weapon pickup. The plan's draft only listed faster reload; the other new
   weapons are already built and being placed in levels 1 and 2.
4. Pub names, which are invented. We can suggest a list.
