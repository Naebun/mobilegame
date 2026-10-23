# Difficulty: Hard and Extra Hard

Three modes, all open from the start. The owner asked for them; the choices below are the owner's, the numbers are first guesses
tuned with the bots, and nobody has played either harder mode yet.

## What the modes are
Hard and Extra Hard are multipliers on top of the normal-mode numbers. They change robots and nothing else: the maps, the
pickups, Naebun's weapons, health, drinks, stun durations and the score values are the same in every mode. Extra Hard is bigger
numbers only, not a different game.

The mode is picked once, on the difficulty screen (NEW GAME, then the difficulty screen, then the controls screen, then START
GAME). It applies to the whole run, is saved so CONTINUE resumes in it, and is never changed mid-run. Best scores are kept
separately for each mode and each level.

## The table
In `src/data.js`, `DIFFICULTY`, one block appended at the end of the file.

| | NORMAL | HARD | EXTRA HARD |
| --- | --- | --- | --- |
| Robot damage to Naebun | 1x | 1.5x | 2x |
| Robot health | 1x | 1.25x | 1.5x |
| Robot move speed | 1x | 1.1x | 1.2x |
| Wind-up (telegraph) length | 1x | 0.9x | 0.8x |

Normal is all ones and `defFor` hands back the very same `ENEMY_DEFS` entry, so normal mode cannot drift.

## Where it is applied
Once per robot, when it spawns: `spawnEnemy` in `src/game3d.js` calls `defFor(kind, S.difficulty)` (in `src/data.js`), which returns a
scaled copy of the robot's definition. That copy is `e.def`, and every attack, movement and projectile already reads its numbers
from `e.def`, so nothing else had to change. Hit points are scaled the same way, so the boss bar, the Nurse's revive (a fraction
of the scaled maximum) and the enrage threshold (a fraction of it) all follow.

What the multipliers touch, per number:

| Multiplier | Numbers it scales (every robot kind that has them) |
| --- | --- |
| damage | `damage` (melee swing, bottle, Longshot shot), the Tour Guide's `slam.damage`, the Shaken's `burst.player` (the blast on Naebun) |
| health | `hp`, rounded to a whole number |
| speed | `speed`, and the Shaken's lunge `prime.speed` |
| wind-up | `windup` (melee), `aim` (a Bampot's aim), `slam.windup`, the Longshot's `charge.track` and `charge.lock`, the Shaken's `prime.fuse`, the Mimic's `dormant.unfold` |

What it leaves alone, on purpose:
- `burst.robots`, the Shaken's blast on other robots. It is damage to robots, not to Naebun.
- Projectile speed (`projSpeed`), reach, swing length, cooldowns and shot intervals, ranges, wake ranges, the shield, the turn rate, the
  enrage multipliers (the Tour Guide's enrage speed factor multiplies the already scaled speed), the Nurse's revive time and share.
  The brief was damage, health, speed and wind-up. Cooldowns and shot intervals are a fifth lever if Extra Hard turns out too soft.
- Score values (a harder robot is worth the same).
- Naebun: weapons, damage, clips, health, drinks, stun durations and the Last Orders laser.

## The telegraph floor
`TELEGRAPH_FLOOR = 0.35` seconds. No warning is shortened below it, and a warning that is already shorter is left as it was. The
formula is `max(secs x k, min(secs, 0.35))`. It is the time Naebun gets to see a swing, a lock or a fuse and step out. With the
current table nothing reaches the floor (the shortest scaled warning is the Tour Guide's aim at 0.40 s in Extra Hard, then the Fizzbang
windup, the Bampot's aim and the Longshot's lock at 0.44 s), so it is a guard for future tuning: `combat-check` pushes a x0.1 table through `defFor` and checks
every warning on every kind stays at the floor.

| Warning | Base | Hard | Extra Hard |
| --- | --- | --- | --- |
| Dr Fizzbang windup | 0.55 | 0.50 | 0.44 |
| Shielded Fizzbang windup | 0.70 | 0.63 | 0.56 |
| The Bouncer windup | 0.80 | 0.72 | 0.64 |
| Vending Mimic windup | 0.60 | 0.54 | 0.48 |
| Bampot aim | 0.55 | 0.50 | 0.44 |
| Tour Guide aim | 0.50 | 0.45 | 0.40 |
| Tour Guide slam windup | 0.70 | 0.63 | 0.56 |
| Longshot track, then lock | 1.10, 0.55 | 0.99, 0.50 | 0.88, 0.44 |
| Shaken fuse | 0.75 | 0.68 | 0.60 |
| Mimic unfold | 0.90 | 0.81 | 0.72 |

## Debug mode
Unchanged and independent. Debug gives Naebun 2x fire rate, damage and health and does nothing to robots, so debug on Hard is
Hard robots against a double-strength Naebun. Debug runs still write neither a best score nor the saved mode (`difficulty-check`
asserts the cookie and local storage are byte-for-byte unchanged by a debug run on Extra Hard). Never balance against it.

## The screen
`screens.buttons('difficulty', view, state)` returns three cards (`mode:normal`, `mode:hard`, `mode:extra`, each with a `sub` line
and a number key) and BACK, used for both drawing and hit testing. Portrait stacks the cards in a column; landscape sets them
side by side so a 320 pt tall phone still fits. Tapping a card picks it and goes on to the controls screen. PC: 1, 2, 3 pick, Up
and Down move the highlight, Enter takes it, Escape goes back. The highlight starts on the saved mode. BACK on the controls screen
returns here. Leaving to the title without starting drops the pick.

The mode shows in four places when it is not normal: the CONTINUE button ("CONTINUE: LEVEL 2 (HARD)"), the title's level line, the
HUD score line, and the death and completion screens.

## Save
`src/save.js`, version 2: `difficulty` (the mode of the latest started, non-debug run) and `best[mode][level]`. A version 1 save
(no `difficulty`, `best[level]`) loads with its scores as the normal-mode bests, and the older `mobilegame.fps.best*` local
storage scores migrate the same way. `clean()` ignores unknown modes, bad levels, non-numbers and non-objects. The cookie leaves
empty modes out; a fully filled one (three modes, two levels, all ten records) is 464 characters as written (254 before URL encoding; a browser allows 4096). RESET PROGRESS erases the lot.

## Tests
- `node scripts/harness/combat-check.mjs`: `defFor` for every kind and mode, the floor, and the running game: each robot kind's
  health, melee and slam damage and wind-up, bottle, Longshot and Shaken damage, the aim and lock times, walking speed, the Nurse's
  revive health, Naebun unscaled, debug stacking. Normal is asserted identical to `ENEMY_DEFS`.
- `node scripts/harness/difficulty-check.mjs`: the save format (old saves, per mode bests, bad data, cookie size), the flow, the
  keyboard, CONTINUE in the saved mode, debug runs writing nothing, and the `?level=2&difficulty=extra` shortcuts.
- `node scripts/harness/ui-check.mjs`: the difficulty screen at all 12 view sizes.
- `npm run smoke`: NEW GAME, HARD, controls, START in a browser, Hard robots, the cookie, CONTINUE in Hard, a Normal best kept apart
  from the Hard one, the number keys.

## Bots
BOTNUMBERS

## Not verified
- Nobody has played either mode. The bots aim far better than a thumb in a small box with no aim assist, so people will do worse than
  the numbers above in every mode, and the gap between Normal and the harder modes may feel different from the bots' gap.
- No phone was used. The difficulty screen was checked in screenshots at several phone, tablet and desktop sizes in headless Chromium.
- The multipliers are starting values. Whether Hard is "clearly harder than Normal and still winnable most of the time" for a person is a
  guess until someone plays it.
