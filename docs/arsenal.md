# The prepared arsenal

Weapons, upgrades and collectibles from the full-game plan, built and tested ahead of the levels that will use them. **None
of it is placed**: no level map contains any of it, nobody can pick any of it up in levels 1 and 2, and those levels play as
before. `scripts/harness/arsenal-check.mjs` asserts that on every level in `LEVEL_DEFS`. Nothing here has been played by a
person or seen on a phone.

## What exists

| Item | Id | Plan says | Where the numbers are |
| --- | --- | --- | --- |
| Feedback Beam | `beam` | level 4 | `WEAPONS.beam` in `src/data.js` |
| Bass-Drop Grenade | `grenade` | level 6 | `WEAPONS.grenade` |
| Airhorn | `airhorn` | level 7 | `WEAPONS.airhorn` |
| SMG alt-fire (Tweeter Burst) | needs the `altfire` upgrade | level 5 | `ALT_FIRE.smg`, `UPGRADES.altfire` |
| Extended clips | upgrade `clip`, two tiers | level 2 | `UPGRADES.clip` |
| Speed loader | upgrade `reload`, two tiers | level 3 | `UPGRADES.reload` |
| Burst pedal | upgrade `altfire` | level 5 | `UPGRADES.altfire` |
| Collectible records | `RECORDS`, ten of them | a few per level | `RECORDS` |
| Setlist screen | title button, mode `setlist` | | `screens.drawSetlist` |

## Rules and numbers (normal mode; debug mode only doubles damage and fire rate, as for every weapon)

**Feedback Beam.** Hold the trigger: a hitscan along the crosshair, range 18 m, ten ticks a second. The damage per second
starts at 24 and climbs linearly to 96 over 2 s on the same target, and drops back to the start when the target changes or
the beam has been off a target for 0.3 s. There is no clip: a charge meter of 100 units drains 20 a second (5 s of beam).
Let go and it waits 0.7 s, then trickles back at 16 a second. Run it dry, or tap RELOAD, and it recharges in full over 2.2 s
(the beam's "reload"). It hits shields like any bullet. Visible beam in the world, five LEDs on the gun as the meter, a HUD
percentage and bar in place of `clip / ∞`.

**Bass-Drop Grenade.** Clip of 3. Thrown at 12 m/s with a 3.2 m/s lift under gravity 16, bounces off the floor, ceiling,
walls and robots keeping 45 percent of its speed, and drops the bass 1.7 s after the throw. The shockwave reaches 7 m,
deals up to 14 damage (falling to half at the edge), shoves a little and **stuns every robot it reaches for 3.5 s**; a boss
is stunned for 30 percent of that (1.05 s). Walls stop it: a robot with no line to the blast is untouched. Stars circle a
stunned robot's head. A stun alone does not wake a sleeping robot (the damage does).

**Stun** (any source): `e.stunT` seconds. A stunned robot cannot walk, swing, shoot or prime; an attack in progress is
cancelled; it still slides where it was shoved and shows a dazed lean. It goes back to work when it wears off. The hook is one
line in `updateEnemy` (`ARS.stunStep`) so a new robot type is stunned without extra code, unless its AI keeps timers of its own
that should freeze.

**Airhorn.** Clip of 4, 0.9 s between blasts, reload 2.0 s. An instant shockwave in a cone 0.62 rad either side of the
crosshair (about 71 degrees across), 7 m from the edge of the robot, needing a line of sight. 8 damage (falling to half), a
shove of 14 (a tenth of that for a boss), a 1.4 s stun (30 percent for a boss). It ignores shields.

**SMG alt-fire (Tweeter Burst).** Only with the `altfire` upgrade and the SMG in hand. Four rounds from the clip, 0.05 s apart,
double damage (14 against 7), spread 0.004 (the SMG's is 0.012 and grows), then a 3.2 s cooldown. Not while reloading or
swapping, or with an empty clip (with fewer than four rounds it fires what is left). Inputs: PC, right mouse button or **E**;
mobile, a small **ALT** button above the aim box that exists only while it is available (`hud.layout(view).altBtn` and
`altHit`; the game reads presses there only when it is available). The HUD shows ALT with a cooldown fill, and in PC mode a
pill naming the key.

**Upgrades.** Per run, not saved: they live in `S.player.upgrades` and start from nothing with every new level, like the
weapons do (`resetLevel`). `clip`: every weapon's clip (and the beam's meter) times 1.4, then 1.8, rounded, always at least one
more round; the owned weapons gain the difference at once. `reload`: every reload time times 0.75, then 0.55 (it stacks with the
Bassline Energy drink's). A pickup at the top tier stays on the floor. The HUD shows small chips down the right edge (a glyph and
a pip per tier) and a toast says what changed.

**Records.** Walking over one finds it: a toast with the count, a banner with its title and its joke, and the first time (not in
a debug run) it is saved. A record found twice is not counted twice. The title gets a SETLIST button beside SETTINGS only once
one is found; the setlist lists the ten, the found ones with their line, the rest as locked slots.

**Save format.** `src/save.js` gained `records`: an array of record ids. `clean()` keeps only ids that exist in `RECORDS`, once
each, in list order, so junk (numbers, objects, unknown or repeated ids, a string, thousands of entries) is dropped; an old save
without the field loads with none; `merge()` takes the union. The version stays 1 because the change is additive. Never rename a
record id: it is what the save stores.

## How it is wired

- `scripts/blender/arsenal.py` writes `src/arsenal-meshes.js` (never edit it; run the script twice and `cmp`). It imports
  `kit.py` and copies the few `weapons.py` helpers it needs. Run `~/.venvs/blender/bin/python scripts/blender/arsenal.py`; add
  `--preview beam --view iso|left|fp|pick --png out.png` for a Cycles preview (`--dist`, `--spin`, `--crop`).
- `src/arsenal.js` decodes the meshes and builds the objects (viewmodels, floor pickups, the grenade in flight, the upgrade and
  record pickups, and the beam, shockwave and stun-star effects). `models.js` hands it the shared material and geometry helpers
  and re-exports `makeUpgradePickup`, `makeRecordPickup`, `makeBeam`, `makeShockwave`, `makeStunMark`; `makeWeaponModel`,
  `makeWeaponPickup` and `makeProjectile` pass the new ids over in one line each. `WEAPON_IDS` still lists the five.
- `src/arsenal-play.js` holds the rules. `game3d.js` creates it (`ARS`) and calls it from `fire`, `updateWeapon`,
  `updateProjectiles`, `updatePickups`, `updateEnemy`, `resetLevel`, `readControls`, `buildHudState` and `render`; the grenade is a
  projectile with `grenade: true` and its own flight.
- Torch: the beam and the airhorn carry a mounted torch to the same contract as the other guns (`torch` and `lens` meshes,
  `userData.lens = { pos, dir }`, `userData.setTorch({ mounted, on, k })`). The grenade is thrown and has none; its `setTorch` does
  nothing, and `game3d`'s `lensOf` falls back to the muzzle for it, so a lit torch still shines from there.
- `WEAPON_ORDER` has eight ids. The HUD strip shows a `prepared` weapon only once it is owned (levels 1 and 2 still show five
  cells) and fits eight. `testHook('giveWeapons')` still gives the five; `testHook('give', 'beam' | ['clip', 'gala'] | 'all' |
  { weapons, upgrades, records })` gives anything, and `testHook('arsenal')` returns the rules object for checks.
- `engine.js` reads the right mouse button (`input.mouse.alt`, consumed once per update).
- `sw.js` lists the three new files for offline use.

## Placing them in a level later (not done; needs the owner's go-ahead)

1. Pick a free letter on the map and add it to the level's `PICKS` in `src/levels/*.js`: `Z: ['weapon', 'beam']`,
   `k: ['upgrade', 'clip']`, `q: ['record', 'haar']`. `world.js` already passes `kind` and `item` through. Floor pickups
   take a whole tile, away from walls, not in a boss room.
2. `game3d.js` already makes the right mesh and handles the pickup for kinds `weapon`, `upgrade` and `record`.
3. A record needs one letter per record because `PICKS` maps a letter to one item; for ten records either spend ten letters or
   teach `world.js` an `extraPickups` list on the level definition (a small change, not made).
4. To keep upgrades between levels, copy `p.upgrades` in `nextLevel()`: today they reset with the player, like weapons.
5. Remove `prepared: true` from a weapon's data only if it should always show on the strip; leaving it keeps the strip tidy
   until the weapon is owned, and that is the intended behaviour.
6. Level checks: `arsenal-check.mjs` asserts that no level places a prepared item. Update that assertion when one does.

## Checks

`node scripts/harness/arsenal-check.mjs` (392 checks: damage ramp, meter, range and walls, grenade fuse, bounce, radius, stun
and bosses, shield and cone for the airhorn, alt-fire gating and cooldown, clip and reload upgrades, pickups, the record save
round trip, old and junk saves, setlist buttons, the HUD strip, and no prepared item in any level); `models-check.mjs` (finite
models, 3k to 6k triangles per held weapon with hands and torch, the torch API, the effects); `ui-check.mjs` (ALT button
rectangle in twelve view sizes with safe-area insets, the setlist and the title row in portrait and landscape).
`node scripts/harness/arsenal-views.mjs <dir> [scenes]` screenshots it all in the real pipeline, portrait and landscape.

## Not verified

- Feel and balance. The beam, grenade and airhorn numbers are first guesses, checked only by the headless rules; no level was
  tuned and no bot plays with them. Whether 5 s of beam, a 3.5 s stun or a 7 m cone is right needs a person.
- Real devices: frame rate with the extra effects (additive rings and the beam), touch reach of the ALT button, safe-area
  behaviour on a real notch, audio (all new sounds are synthesised and unheard).
- The viewmodels were seen in software-rendered screenshots only. The beam, grenade and airhorn sit a little under the aim box on a
  portrait phone, as the other guns do. The grenade's throw animation (swing, vanish, rise) is simple and was not watched
  moving. The shockwave shapes are plain rings and a cone of rings.
- The setlist on a very short screen (320 by 480) truncates long jokes with an ellipsis; seen only in the 390 and 844 sizes.
- The torch lens on the beam gun and the airhorn was checked in level 2 screenshots, not on a phone.
