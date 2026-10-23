# The four prepared enemies

Built ahead of time at the owner's request, for when levels need them (model, definition, AI, sounds, headless checks,
screenshots). The owner has since said to put them in the two levels that exist, so **they are placed**: where, and why, is in
`docs/placement.md`, and `scripts/harness/enemies-check.mjs` asserts that placement area by area (`PLACED` in that file).
Placing them in any further level needs the owner's go-ahead for that level (see `CLAUDE.md`). Nothing here has been played by
a person, heard, or seen on a phone.

All numbers are normal mode (`ENEMY_DEFS` in `src/data.js`, comments there say what each does). Debug mode multiplies
Naebun's damage, fire rate and health only; the enemies' own damage is not scaled and nothing was tuned against it.

## Map letters

Set aside for them before they were placed, and now used by both levels' `KINDS` tables (`src/levels/*.js`):

| Letter | Robot | Kind in `ENEMY_DEFS` |
| --- | --- | --- |
| `k` | Fizzbang Shaken | `shaken` |
| `l` | Bampot Longshot | `longshot` |
| `u` | Bampot Nurse | `nurse` |
| `m` | Vending Mimic | `mimic` |

`enemies-check` counts each letter on each map against the placement table. Adding one to another level is a one-line entry in
that level's `KINDS`, plus the map letter. The spawn faces the area's entry door, as every robot does. A Mimic wants a wall
behind it and its front towards the room, so put it against a wall (the level checks allow a Mimic one tile from a wall, 1.0 m
of clearance, where every other robot needs 1.2) on the side the entry door faces.

`testHook('spawn', { kind, x, z, yaw, area? })` (only through `window.__game` with `?test`, or in Node) adds a robot of any kind
to the running game. The game itself does not use it: the placed robots come from the map letters.

## 1. Fizzbang Shaken (Dr Fizzbang camp, melee, exploder)

A squat fizzy can on spring legs, foam bubbling out of its top, a jagged grin, a pressure dial on its side. 30 hp, 3.6 m/s
(Naebun runs at 4.4, so it can be outrun and shot from range).

- **Rattle.** The rattle rate runs from 4 Hz at 14 m or more to 26 Hz at 2.5 m or less, linearly between. The model shakes
  harder with it (`setPose('walk', t, level)`) and the sound is a tick per rattle, higher and louder as the level climbs
  (`audio.rattle`, ticks closer than 30 ms are dropped).
- **Telegraph.** Inside 3.4 m with a line of sight (or touching) it primes: a hiss, the can swells, glows red, foam heaves up,
  the eyes turn red and a red ring on the floor shows the blast's reach. It lunges at 5.0 m/s, steering at 1.6 rad/s (a
  sidestep can beat the lunge). The fuse is 0.75 s. Touching Naebun bursts it, but never in the first 0.3 s of priming, so the
  telegraph is always at least 0.3 s.
- **Burst.** On fuse end, on touch, or on death (shot, rocket, Last Orders). Radius 3.2 m. Naebun takes 32 at the centre,
  falling linearly to 35 percent at the edge (so 13 at 3 m, nothing beyond 3.2 m). Every other robot in range takes 45 falling
  the same way (a shield does not stop it). A Shaken in the blast primes at once with a fuse of 0.3 x (0.5 + distance / radius)
  seconds, so a row of Shakens ripples; one that the blast kills outright waits the same time before its own burst. A burst Shaken
  is a wreck of foam and cannot be revived.
- **Fair play.** Shooting it from beyond 3.2 m costs nothing. Running straight away from the start of the lunge cost 13 where
  standing still cost 26 (tested, one run). The first pistol shot does not kill it (18 of 30).

## 2. Bampot Longshot (Bampot camp, ranged sniper)

A tall slim bottle in dark green glass on long jointed legs, a tweed flat cap, goggles with a small amber eye and a big scope
lens, a rifle across its chest and a battery pack on its back. 40 hp, 2.3 m/s, wakes at 30 m, range 40 m.

- **Behaviour.** Keeps 12 to 26 m away, backs off inside 12 m, strafes slowly, walks round cover to find a line of sight (it does
  not charge without one). With a line it charges.
- **The shot.** Charge 1.65 s: the red laser follows Naebun for 1.1 s (it can swing at most 2.4 rad/s), then locks for 0.55 s
  (thick, white-hot, a two-beep lock sound, a warning arc on the HUD's damage arcs for a Longshot out of view), then one
  hitscan shot along the locked line for 38 if Naebun is within 0.5 m of the line and nothing solid is in the way. That 0.55 s
  lock is the dodge window: a sidestep of 0.6 m or more after the lock beats it (tested at 0.4 m hit, 0.6 m miss).
- **Cover.** The line stops at the first wall or pillar (`world.raycast`), so standing behind either is safe. Low cover does not
  stop it (shots in this game never are). Losing sight for more than 0.5 s while tracking cancels the charge. Once locked it fires
  whatever happens.
- **Visible in the dark.** The laser is additive HDR with `fog: false`, so it shows at any range and blooms. While it is on Naebun
  it stops about 1.2 m short of him (it has hit something), which also keeps the glare from running through the camera.
  The rifle is carried on the robot's centre line and the shot is a ray from the rifle's pivot, so what the laser shows is the
  shot's line (tested: the model's muzzle sits on that ray).
- Cooldown 3.0 to 4.2 s after the 0.55 s recovery. One shot is 38 of 100 health: three kill.

## 3. Bampot Nurse (Bampot camp, support)

An amber apothecary bottle on stubby clogs, a white nurse's cap with a green cross, a mask, mint-green eyes, a belt of vials,
a drip stand on her back, a syringe in one hand, a lantern in the other. Never attacks (no damage, reach or ranged numbers
exist for her). 40 hp, walks at 1.7 m/s.

- **Revive.** Every 0.2 s, if she has no cooldown, she looks for a body of her own area within 6 m and in sight: not a boss, not
  a Shaken, not another Nurse, not one revived before, dead for less than 14 s. She stands still and channels for 3.6 s (a beam
  from the syringe to the body, a green pillar and a closing ring on the body, the lantern flares, a rising hum). The channel
  survives a hit; it ends if she dies, the body leaves her range (x1.3) or sight, or the body can no longer be revived.
- **When it lands.** The body rises over 0.9 s (the fall played backwards) at 60 percent health, a chime sounds, and it carries
  on awake. Bodies stay visible on the floor while a Nurse of their area lives and the 14 s window is open.
- **Kill order.** Kill her first and nothing comes back. Kill her mid-channel and the body stays down (tested, beam goes out at
  once). Leave her and the robot gets up.
- **Flee.** Nearer than 9 m to Naebun she walks directly away, trying either side if blocked. She is a stationary target while
  channelling and slower than Naebun otherwise, so she can always be caught.

### Revive, kills and the area-clear logic (the decision)

- A Nurse is a robot like any other: she counts in her area's `alive`, so **an area cannot clear while a Nurse lives**. That
  alone means a body can never be revived in an area that has cleared, because the Nurse would have had to die first and a dead
  Nurse revives nothing.
- As belts and braces, `reviveCandidate` also refuses any body whose area is already latched cleared, and a Nurse only revives
  bodies of her own `areaId`. An area's `cleared` flag is a latch (existing behaviour): once set, its doors are open for good,
  and a robot that is alive there later (forced in a test) shows in the count but does not shut a door.
- **Kills and score.** A revive takes the kill back: `S.kills` goes down by one and the robot's score is taken off, so
  `kills` is the number of robots currently dead and the end screen's kills against total stays true. Killing it again gives
  them again. Net effect on score: none, no farming. Tested: after a revive and a second kill, kills equal the robots in the area.
- **Area count.** A revived robot counts for its area again from the moment it gets up (`state: 'rise'`). It was not
  removed from `S.enemies` when it died, so nothing needed re-adding.
- Each robot is revived once (`revives`), so a Nurse cannot stall a level for ever, and a second Nurse cannot ping-pong it.

## 4. Vending Mimic (Dr Fizzbang camp, melee, dormant)

A clean teal drinks machine with a lit window of bottles and cans, a keypad and a lit sign. Unfolds on two hydraulic legs, the
side panels swing out as arms with claws, the sign tips forward and shows two magenta eyes, the delivery flap drops open as a
toothed mouth. 100 hp, 3.1 m/s, melee reach 2.0, 22 damage (windup 0.6 s, swing 0.4 s, cooldown 1.2 s).

- **Dormant.** In the level from the start (nothing appears from nowhere). Immovable (nothing pushes it, not even a shotgun
  blast), ignores gunfire noise and other robots waking its area, counts as a robot for its area and for the totals.
  `idle` state, drawn with the `dormant` pose.
- **Wakes** when Naebun comes within 3.4 m **in sight** (a wall between them does not wake it), or when it is shot.
- **How it is hit while disguised (decision).** Exactly like a robot: the same cylinder (radius 0.62 from the model), 1.92 m
  tall (the machine, not the 2.45 m robot), headshots above 1.62 m, no armour. A level shot does the same to a dormant Mimic as to
  a Fizzbang (tested), and a shot that clears the top of the machine misses. The first hit does its damage and starts the unfold.
- **Unfolding** takes 0.9 s. It can be hurt but cannot attack. It turns to face Naebun. After that it is an ordinary melee
  robot, using the same chase, windup and swing code as the Fizzbang.
- A Nurse can revive a dead Mimic: it gets up awake and does not fold back into a machine.

## Where things are

| Path | What |
| --- | --- |
| `src/data.js` | `ENEMY_DEFS.shaken`, `.longshot`, `.nurse`, `.mimic`, with comments on every number |
| `src/game3d.js` | The block between `PREPARED ENEMIES BEGIN` and `END` (AI, burst, snipe, revive, unfold), plus small hooks: `spawnEnemy` calls `initSpecial`, `updateEnemy` calls `updateSpecial`, `killEnemy` calls `onSpecialKill`, `wake` ignores a dormant robot, `damageEnemy` unfolds a hit Mimic, `separateEnemies` leaves a `fixed` robot alone, `animateWorld` keeps revivable bodies visible, `updatePlay` runs the pending bursts, and `testHook('spawn')` |
| `src/models.js` | Between the `PREPARED ENEMIES` markers: `makeShaken`, `makeLongshot`, `makeNurse`, `makeMimic`, reached through `makeRobot(kind)`; `PREPARED_KINDS` |
| `src/audio.js` | `rattle`, `hiss`, `fizz`, `snipeCharge`, `lock`, `snipe`, `reviveStart`, `reviveDone`, `unfold` (synthesised, like the rest) |
| `src/fx.js` | `foam()`, the Shaken's burst of foam and bubbles |
| `scripts/harness/enemies-check.mjs` | The rules above, in plain Node against the real game logic: 237 checks, the placement among them |
| `scripts/harness/models-check.mjs` | Poses at k of -1, 0, 0.5, 1, 2 and NaN, finite transforms, budgets, silhouettes, each model's extras |
| `scripts/harness/models-enemies.html` | The model viewer for the four (a copy of `models-l2.html` with `pre` and `post` calls, e.g. `setLaser`, `setBeam`) |
| `scripts/harness/enemy-views.mjs` | Real-game screenshots of each, lit and dark, in the states that matter (`OUT=<dir> node scripts/harness/enemy-views.mjs`) |

Model extras the game drives: Shaken `setBlast(r)`; Longshot `setLaser(len, pitch, locked, k)`, `pivot`, `muzzle`; Nurse
`setBeam(lx, ly, lz, k)` (null hides it), `tip`; Mimic poses `dormant` and `unfold` and `dormantHeight`, `dormantHeadY`. Every
model has `idle walk windup swing aim shoot hurt dead` as the contract requires (the ones a robot does not do play its nearest
pose). Triangles: Shaken about 8.4k, Longshot 7.4k, Nurse 5.4k, Mimic 9.4k (the older robots run 6.9k to 14.2k); the Longshot
and Nurse are under the 8k asked for, because they are slimmer than a Fizzbang. Meshes: 14, 23, 20 and 16, of which the laser,
muzzle flash, beam, glow and ring pieces are switched off most of the time.

## Tests run

`enemies-check` 157 of 157, `models-check`, `combat-check` 59 of 59, `ui-check`, `drinks-check`, `world-check` 4381 of 4381,
`level-check` 586 of 586, `npm run smoke`, and `npm run sim` on both levels (level 1: 100 percent for all three bots; level 2:
90, 100, 100 percent over 10 runs, in line with `docs/level-2.md` given the sample size). Those runs were before the placement,
so the sims did not contain any of the four; the placed numbers are in `docs/placement.md`.

## Not verified

- **Nobody has played any of this.** Whether the numbers feel right (the Shaken's lunge, the Longshot's 0.55 s dodge window on
  a thumb in a small box, the Nurse's 3.6 s, the Mimic's 3.4 m) is a guess backed by tests of the rules, not by people.
- **Sound.** Everything new is synthesised and has never been heard. The rattle in particular needs a listen: it is meant to
  rise audibly, but 26 ticks a second of a square wave could be tiresome, and several Shakens at once are throttled to one tick
  per 30 ms in total.
- **How well the bots handle them.** `scripts/sim3d.mjs` now dodges a laser after the lock, walks away from a Shaken and does not
  shoot it inside its blast, shoots a Nurse first (the good bot) or once she has a body (the casual one), and shoots a Mimic
  from range (good and casual) or walks up to it (sloppy). Those are guesses at how a person of each skill plays and have
  never been compared with a person. The sim numbers for the placed levels are in `docs/placement.md`.
- **Performance on a phone.** Only software WebGL. A Longshot's laser and a Shaken's ring are additive overdraw; a crowd of
  Shakens bursting uses the foam particles from the shared pool (36 smoke and 30 spark particles each, from pools of 160 and 280).
- **The Longshot's warning arc** reuses the HUD's damage arcs, which can read as "I was hit". There is a `shot.warn` flag to
  turn it off. A real warning cue (and a hint card for each new enemy, as the levels have for the old ones) belongs to the level
  that introduces it.
- **Pathing round a dormant Mimic.** The flow field does not know the machine is solid; other robots slide round it through
  `separateEnemies`. Fine for one in an alcove, untested in a corridor.
- **Level lighting.** Seen only in the two existing levels via the spawn hook. A Mimic's lit window and sign are visible from
  afar in a dark level (they are meant to look like a working machine), which may give it away; `winMat` and `signMat` in
  `makeMimic` are the dials.
- Several Nurses, a Nurse among Shakens, and a Mimic hit by a Shaken's blast while dormant (it unfolds, takes the damage) are
  covered by the rules but not by a scene.
