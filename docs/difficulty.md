# Difficulty: Hard and Extra Hard

Three modes, all open from the start. The owner asked for them and made the design choices below; the numbers were tuned with the
sim bots, and nobody has played either harder mode yet.

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
| Robot damage to Naebun | 1x | 1.35x | 1.75x |
| Robot health | 1x | 1.2x | 1.35x |
| Robot move speed | 1x | 1.1x | 1.15x |
| Wind-up (telegraph) length | 1x | 0.9x (10 percent quicker) | 0.85x (15 percent quicker) |

These are the tuned values, not the owner's starting ones. The owner's first guess was Hard 1.5 / 1.25 / 1.1 / 0.9 and Extra Hard
2 / 1.5 / 1.2 / 0.8 (damage / health / speed / wind-up). With those, the good bot won 53 percent of runs on level 2 on Hard and 13
percent on Extra Hard, and the casual and sloppy bots almost never won (see below), so both were eased. What was changed and why is
under "Tuning".
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
current table nothing reaches the floor (the shortest scaled warning is the Tour Guide's aim at 0.42 s in Extra Hard, then the Fizzbang
windup, the Bampot's aim and the Longshot's lock at 0.47 s), so it is a guard for future tuning: `combat-check` pushes a x0.1 table through `defFor` and checks
every warning on every kind stays at the floor.

| Warning | Base | Hard | Extra Hard |
| --- | --- | --- | --- |
| Dr Fizzbang windup | 0.55 | 0.50 | 0.47 |
| Shielded Fizzbang windup | 0.70 | 0.63 | 0.59 |
| The Bouncer windup | 0.80 | 0.72 | 0.68 |
| Vending Mimic windup | 0.60 | 0.54 | 0.51 |
| Bampot aim | 0.55 | 0.50 | 0.47 |
| Tour Guide aim | 0.50 | 0.45 | 0.42 |
| Tour Guide slam windup | 0.70 | 0.63 | 0.59 |
| Longshot track, then lock | 1.10, 0.55 | 0.99, 0.50 | 0.94, 0.47 |
| Shaken fuse | 0.75 | 0.68 | 0.64 |
| Mimic unfold | 0.90 | 0.81 | 0.77 |

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
`node scripts/sim3d.mjs --runs 30 --skill both --level N --difficulty normal|hard|extra`, run on the real game logic. Win percent,
then the average damage Naebun took per run (it can top 100 because drinks heal), sloppy / casual / good. These are the tuned
table's numbers and the normal-mode baseline from the same code.

**Level 1 (the Cowgate)**

| Mode | Win % (sloppy / casual / good) | Damage taken | Where the bots died |
| --- | --- | --- | --- |
| Normal | 97 / 100 / 100 | 65 / 42 / 23 | sloppy: backstage 1 |
| Hard | 80 / 93 / 100 | 131 / 68 / 47 | sloppy: backstage 5, VIP corridor 1; casual: backstage 2 |
| Extra Hard | 57 / 90 / 100 | 136 / 105 / 78 | sloppy: VIP corridor 5, backstage 5, dance floor 3; casual: backstage 3 |

**Level 2 (the Vaults)**

| Mode | Win % (sloppy / casual / good) | Damage taken | Where the bots died |
| --- | --- | --- | --- |
| Normal | 83 / 90 / 97 | 146 / 110 / 92 | sloppy: Tour 3, Long Vault 1, Cask Cellar 1; casual: Plague Cellar 2, Tour 1; good: Tour 1 |
| Hard | 13 / 70 / 73 | 158 / 150 / 135 | sloppy: Cask Cellar 6, Close 7, Tour 6, Plague 5, Long Vault 2; casual: Plague 3, Cask 3, Tour 2, Close 1; good: Plague 7, Tour 1 |
| Extra Hard | 3 / 13 / 17 | 168 / 157 / 147 | sloppy: Plague 9, Cask 8, Long Vault 7, Tour 3, Close 2; casual: Plague 7, Cask 7, Tour 5, Long Vault 4, Close 3; good: Plague 15, Tour 4, Long Vault 3, Cask 3 |

A second sample of 60 runs on level 2 (the first 30 seeds are in it, but see the caveat below) for the two bots that matter most:
Hard good 78, casual 47; Extra Hard good 33, casual 22. Pooling both samples, the good bot on level 2 wins about 76 percent on Hard
and about 28 percent on Extra Hard (the casual bot 54 and 19).

How to read them:
- **Hard is clearly harder than Normal and the good bot still mostly wins.** Level 1: the good bot never loses but takes twice the
  damage; the sloppy bot slips from 97 to 80 percent. Level 2: the good bot goes from 97 to about 76 percent, the casual bot from 90
  to about 54, the sloppy bot from 83 to 13.
- **Extra Hard is a real challenge, and on level 2 close to a wall for anyone but the best aim.** The good bot loses about two runs
  in three on level 2 (about 28 to 33 percent wins) and the casual bot four in five. On level 1 it is gentler: the good bot still wins
  every time, the casual bot 90 percent, the sloppy bot 57.
- **One table cannot fit both levels.** Level 2 is already the harder level in Normal (the good bot takes 92 damage there against 23),
  so any table that puts the good bot's Extra Hard win rate near a third on level 2 leaves level 1 easy for it. The table is set from
  level 2, as the harder of the two, and the level 1 numbers are what that gives.
- **Where it bites.** On level 2 the Plague Cellar and the Tour Guide take most of the deaths in the harder modes, the Cask
  Cellar's shielded robots next. On level 1, the VIP corridor and backstage (the Bouncer). Ranged damage dominates on level 2
  (the good bot takes about 100 ranged against 35 melee on Hard), so the Bampot bottles and the boss volleys are what hurts.
- **Health and speed move the result more than damage does.** In the tuning runs (good bot, level 2, 30 runs) a table with 1.5 damage
  and unchanged health won 67 percent, while 1.25 damage with 1.25 health and 1.1 speed won 50, and 1.3 / 1.15 / 1.05 won 87.

**Tuning.** The owner's first guesses were Hard 1.5 damage / 1.25 health / 1.1 speed / 0.9 wind-up and Extra Hard 2 / 1.5 / 1.2 / 0.8.
Thirty runs of each on both levels:

| First guess | Level 1 win % | Level 1 damage | Level 2 win % | Level 2 damage |
| --- | --- | --- | --- | --- |
| Hard | 97 / 93 / 100 | 130 / 81 / 52 | 7 / 27 / 53 | 170 / 160 / 132 |
| Extra Hard | 30 / 80 / 90 | 158 / 131 / 92 | 3 / 7 / 13 | 165 / 157 / 167 |

On level 2 that is a wall: the good bot, which aims better than any person will, won 53 percent on Hard and 13 on Extra Hard. Hard was
meant to be "still winnable most of the time", so it was eased to 1.35 / 1.2 / 1.1 / 0.9 (good bot 73 to 78 percent). Extra Hard went to
1.75 / 1.35 / 1.15 / 0.85 (good bot 17 to 33 percent) so it loses often without being a coin you cannot win. Other tables tried, good
bot on level 2 (30 runs each): Hard 1.3 / 1.15 / 1.05 / 0.95 won 87; 1.25 / 1.25 / 1.1 / 0.9 won 50; 1.5 / 1.0 / 1.1 / 0.9 won 67; Extra
Hard 1.7 / 1.3 / 1.2 / 0.8 won 50; 1.8 / 1.3 / 1.15 / 0.85 won 17; 2.0 / 1.25 / 1.15 / 0.85 won 20; 1.6 / 1.3 / 1.15 / 0.85 won 52 in
60 runs (too soft for the brief). Nothing was tuned against debug mode.

**Caveats, plainly.**
- **The bots are far better than a thumb.** They aim with a small random error, turn at a fixed rate and never mis-tap a button. The
  sloppy bot is the nearest to a person and it is still better than a person in a small box with no aim assist.
  People will do worse than every row here, in every mode, and the gap between Normal and the harder modes may be wider for them.
- **The numbers are samples.** The sim is not a pure function of its seed: `S.t`, the game clock the ranged robots' strafe uses, is
  not reset between runs in one process, so the same seed gives a different run after a different history (checked: the same eight
  seeds run forwards and backwards give different results; the same command run twice gives identical output). Each 30-run row is
  therefore a sample with a standard error of about 9 points at 50 percent, and differences under about 15 points mean nothing. The
  `--skill good` 30 versus 60 run gap on Extra Hard (17 against 33 percent) is that noise.
- **The bots cannot use the prepared enemies or weapons** (no level places them), so none of these numbers say anything about the
  Shaken, Longshot, Nurse or Mimic under the multipliers. Those are covered by `combat-check` for the numbers, not for how they play.

## Not verified
- Nobody has played either mode. The bots aim far better than a thumb in a small box with no aim assist, so people will do worse than
  the numbers above in every mode, and the gap between Normal and the harder modes may feel different from the bots' gap.
- No phone was used. The difficulty screen was checked in screenshots at several phone, tablet and desktop sizes in headless Chromium.
- The multipliers are starting values. Whether Hard is "clearly harder than Normal and still winnable most of the time" for a person is a
  guess until someone plays it.
