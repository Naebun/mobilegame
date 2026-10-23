# Status

Snapshot of where the project stands, 23 October 2026. `ROADMAP.md` is the roadmap and the list of what is unverified;
`docs/HANDOVER.md` has the detail per feature. This file is the short version, and it goes stale quickly.

## On main (PR #8, `9366288`)

- Levels 1 (the Cowgate) and 2 (the Vaults), portrait and landscape.
- PC mode (default, mouse look, grey boxes hidden) and mobile mode. A phone or tablet switches to mobile mode on its own.
- Settings page, saved progress (cookie plus localStorage), CONTINUE on the title.
- The player is Naebun and the game is "Naebun's Last Set".
- Blender models: the drinks, the five weapons with hands, 27 level props, five gun torches and the torch attach hand.
- The torch: mounted on each gun, with a spotlight and beam that follow the gun. Level 2 is dark; Naebun fits the pistol's
  torch by hand at the start. The other guns arrive with one fitted.
- Built but not placed in any level: four enemies (Fizzbang Shaken, Bampot Longshot, Bampot Nurse, Vending Mimic), three
  weapons (Feedback Beam, Bass-Drop Grenade, Airhorn), an SMG alt-fire, clip and reload upgrades, ten records and the
  SETLIST screen.

Checks on that commit: `world-check` 4381/4381, `level-check` 586/586, `combat-check` 59/59, `enemies-check` 157/157,
`arsenal-check` 392/392, `models-check`, `drinks-check`, `ui-check`, the smoke test and `build:artifact` all pass. Bot win
rates (20 runs): level 1 100 percent at every skill; level 2 sloppy 80, casual 80, good 100.

## On branch `playtest-textures-placement` (not merged)

Done on the branch itself:

- Test scripts take `PORT` from the environment, so several can run at once.
- `docs/level-3.md`: the level 3 design (Grassmarket pubs, the Landlord, Fizzbang Turbo). Planning only, nothing built.
- The Vaults are darker outside the torch cone (less ambient and baked light, softer cone edge, thinner beam haze). Checked in
  software screenshots only, after a real-phone screenshot showed too much readable outside the cone.
- The mouse wheel swap counts one event per quiet gap, so a trackpad flick is one swap. Not proved in a browser.

## In progress (four agents, each in its own worktree, none has reported yet)

| Piece | What | State |
| --- | --- | --- |
| Playtest kit and fixes | A `?perf` readout, `docs/playtest.md`, and fixes for the hidden pistol torch, the launcher lamp, the vinyl gooseneck, the Longshot's white laser and the Mimic's glow | running |
| Textures | Blender-baked brick and flagstone first (then stone, timber, plaster if the sizes allow), shipped as WebP, with the generated textures kept as the fallback | running |
| Placement | Teach the sim bots the new enemies and weapons, then place the enemies, weapons, upgrades and records in levels 1 and 2 and balance them | running |
| Hard and Extra Hard | A difficulty screen after NEW GAME, multipliers on robot damage, health, speed and wind-up, bests kept per mode | running |

Next step once they report: merge their branches one at a time (they overlap in `game3d.js`, `data.js`, `smoke.mjs` and the
docs), then run all checks, both sims, the smoke test and `build:artifact` on the combined tree. Nothing goes to `main` until
the owner asks.

## Decisions the owner has made

- Image files are allowed in the repo, for generated textures only. Models stay data modules.
- All three difficulties are open from the start, picked on a screen after NEW GAME, and Extra Hard is bigger numbers only.
- Drinks and weapons are always modelled in Blender.
- Level 3 is Grassmarket pubs, the Landlord and Fizzbang Turbo, as a design only.

## Waiting on the owner

- A go-ahead to build level 3 (and whether in one pass or area by area).
- A playtest of level 2 on a real phone: the dark, the torch, frame rate, touch feel. Test devices are an iPhone 16 Pro and a
  MacBook Air M4. Both are much faster than the plan's A15 floor, so neither shows how an older phone copes.
- When to merge the work above to `main`.

## Not verified

Nobody has played the new enemies, weapons or difficulty modes. No sound has been heard. Every number for the prepared enemies
and weapons, and the Hard and Extra Hard multipliers, is a first guess. The sim bots aim better than a thumb in a small box.
Real pointer lock in Safari, the trackpad swap, and the iPhone safe areas with Safari's bottom tab bar are untested.
