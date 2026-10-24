# Status and handover

This file is for a fresh chat taking over. Read it first, then `CLAUDE.md` (binding project rules), then `ROADMAP.md` and
`docs/HANDOVER.md`. Snapshot taken 24 October 2026, after PR #11 merged. It goes stale fast: check `git log origin/main` before
trusting it, and refresh it at the end of any substantial piece of work.

**Where this copy lives.** This version is on the branch `status-after-pr11`; `main`'s copy is older (it says the last round is
unmerged) until a docs PR lands. If `origin/status-after-pr11` exists and is newer than `main`'s file, trust it.

## Docs index

`README.md` (layout and commands), `CLAUDE.md` (binding rules), `ROADMAP.md`, `docs/HANDOVER.md` (detail per feature),
`docs/fps-design.md` (module contract), `docs/full-game-plan.md` (the 8 to 10 level plan), `docs/level-2.md`,
`docs/level-3.md` (design only), `docs/placement.md` (what is where in levels 1 and 2, and why), `docs/enemies-next.md`,
`docs/arsenal.md`, `docs/difficulty.md`, `docs/textures.md` and `docs/texture-options.md`, `docs/props.md`, `docs/drinks.md`,
`docs/playtest.md` (the checklist for a real-phone test, including the `?perf` readout).

## The project in one paragraph

"Naebun's Last Set": a first-person 3D horror shooter for phone browsers, set in an Edinburgh basement club, dark comedy, light
Scottish voice. Three.js r160 vendored in `vendor/`, plain ES modules, no bundler, no backend. Repo `/home/user/mobilegame`,
GitHub `Naebun/mobilegame`, deployed from `main` to GitHub Pages. Two levels exist (the Cowgate, the Vaults). Use they/them for
anyone whose pronouns have not been stated, the owner included.

## State of the code

`main` is at `d43cba4` (PR #11, squash, 24 October). Nothing is in progress and no agents are running. It holds:

- Levels 1 and 2, portrait and landscape; PC mode (default) and mobile mode (picked automatically on a phone or tablet);
  Settings page; saved progress (cookie plus localStorage, save version 2).
- Blender models: drinks, five weapons with hands and torches, 27 level props, the arsenal weapons and upgrade pickups.
- Blender-baked textures on the medium and high tiers (19 WebP files, 917 KB: brick, painted brick, stone, boards, plaster as a
  two-variant atlas, concrete, flags as a two-layout atlas); generated textures stay as the fallback, the low tier and the tests.
- The gun-mounted torch with a hand-fitted pistol torch at the start of level 2 (the only dark level so far).
- Four newer robots (Fizzbang Shaken, Bampot Longshot, Bampot Nurse, Vending Mimic), the Airhorn, Bass-Drop Grenade and Feedback
  Beam, clip, reload and altfire upgrades and ten records, all placed in levels 1 and 2 (`docs/placement.md`). Level 1 has 21
  robots, level 2 has 27.
- Hard and Extra Hard: a difficulty screen after NEW GAME, a `DIFFICULTY` table in `src/data.js` (Hard 1.35 damage, 1.2 health,
  1.1 speed, 0.9 wind-up; Extra Hard 1.75, 1.35, 1.15, 0.85), bests kept per mode (`docs/difficulty.md`).
- Direct weapon selection: tap a cell in the weapon strip on a phone (in portrait the strip is its own row under the score line);
  keys 1 to 8 (fixed slots in `WEAPON_ORDER`), the wheel both ways and Q (quick-swap to the last weapon) on a computer. SWAP still
  cycles forward.
- The Vaults are dark outside the torch cone. The haze came from the grade stage's `lift` in `look.grade` (added in linear light before
  the sRGB conversion, so the old values lifted black to about 8, 16 and 28 percent grey on medium and high; the low tier skips the
  stage). It is now near zero, with ambient 0.08, fill 0.04 and exposure 1.25. Measured in software screenshots only: mean brightness
  outside the cone 0.15 to 0.07. The owner's phone renders brighter than the software renderer, so the owner's reaction decides
  whether it is now too dark; `lift` and the ambient light in `src/levels/vaults.js` are the numbers to raise.
- The playtest kit: `?perf` or the P key shows a readout (`src/perf.js`); the guide is `docs/playtest.md`.
- A repeatable bot sim (`scripts/sim3d.mjs`): the same seed always gives the same run. Numbers measured before 24 October are not
  comparable run for run.
- `docs/level-3.md`: the level 3 design only (Grassmarket pubs, the Landlord, Fizzbang Turbo). Nothing of level 3 is built.

Branches: all work is on `main`. These remote branches are merged and could not be deleted from here (the git proxy hangs up on
`git push --delete`): `mouse-and-blender`, `playtest-textures-placement`, `status-after-pr9`, `darker-vaults-2`, `tidy-ups`,
`integration-2`. Delete them on GitHub if wanted. Earlier merges: PR #7 (`98a08cd`, level 2, landscape), PR #8 (`9366288`, control
modes, torch, Blender weapons and props), PR #9 (`1a62736`, textures, placement, difficulty, playtest kit); PR #10 was closed as
superseded by #11.

Checks on `main` (24 October): `models-check`, `drinks-check`, `ui-check`, `perf-check` pass; `combat-check` 509/509; `world-check`
4413/4413; `level-check` 748/748; `enemies-check` 261/261; `arsenal-check` 469/469; `textures-check` 127/127; `difficulty-check`
84/84; the smoke test (161 checks, run with `SMOKE_WAIT=90000`) passes; `build:artifact` makes a 4.4 MB file.

Bot win rates on `main` (30 runs, sloppy / casual / good; a sample, about plus or minus 10 to 15 points):

| Level | Normal | Hard | Extra Hard |
| --- | --- | --- | --- |
| 1 | 100 / 100 / 100 | 83 / 100 / 100 | 63 / 70 / 80 |
| 2 | 43 / 90 / 97 | 13 / 47 / 53 | 3 / 7 / 37 |

Level 2 Normal sloppy was 67 before direct weapon selection and is below the placement floor of 65. That is the Feedback Beam
finding below, not noise (60-run measurements: 62 before, 37 after).

**Finding to decide on: the Feedback Beam against the Tour Guide.** With direct selection the bots can reach the Beam and hold it
for 17 to 22 seconds a run. Level 2 win rates (60 runs, `--exact 1`, sloppy / casual / good): before 62 / 82 / 97, after 37 / 83 / 92;
with the Beam pickup removed from the map, 78 / 93 / 95. The Tour Guide killed the sloppy bot 16 times before and 29 times after.
So in these runs the Beam does worse than the launcher against the boss; the agent's reading (untested) is that its damage ramps
only while the crosshair stays on the target. Options: retune the Beam (higher base damage or a faster ramp), move or drop its
pickup, or leave it for a human playtest. No data or rules were changed.

Other things the last round found:

- The new ceilings are clearly better in lit rooms but nearly invisible in the real game, and in the very dark Vaults almost nothing
  of them shows: lighting, not more texture, is the lever for how the Vaults look. The floor boards' 1.6 m repeat clearly shows on
  the dance floor and in the bar and was left alone.
- Estimated GPU memory for the baked maps is 29.7 MiB (a formula, not a measurement). If a phone struggles: drop plaster to one
  variant (-6 MB), then flags (-3 MB), each one constant in `src/consts.js` plus a rebake.
- Thumb reach of the weapon strip row at the top of a tall portrait screen is a guess (the aim thumb has to leave its box); it is on
  the playtest list.

## What is next: the choices

The owner approved tasks 1, 3 and 6 of the last list and they are done (weapon selection, plaster and concrete and the flag atlas,
tidy-ups). Nothing below is started.

**The owner's playtest comes first** (about 20 minutes, iPhone 16 Pro and MacBook Air M4; `docs/playtest.md` is the checklist):

1. Open the game with `?perf` on the address and play level 1 then the Vaults, in portrait and landscape.
2. Send a screenshot of the readout in the Plague Cellar and on the dance floor (the heaviest views).
3. Say whether the Vaults are now too dark, whether the pistol torch looks right, how Hard and Extra Hard feel, whether the strip at
   the top is easy to tap.
4. On the MacBook, check mouse look works, keys 1 to 8 select, the wheel steps and one trackpad flick is one step.

**Work that can be done without a phone:**

| # | Task | Why |
| --- | --- | --- |
| A | Decide the Feedback Beam | See the finding above. Retune, move or drop it, or wait for the playtest |
| B | Re-tune Hard and Extra Hard | The multipliers were tuned before placement and before direct selection. Level 2 Hard is a wall for the sloppy bot and Extra Hard is a wall for all but the good bot. The Longshot's shot is 67 on Extra Hard, two thirds of Naebun's health. Re-run all three modes on both levels, normal mode only for the base numbers; best done after A |
| C | Stop drawing robots and pickups that cannot be seen | A frame draws 150k to 330k triangles on high (up to 276 draw calls) because things behind walls inside the view cone are still drawn. The playtest agent's cause is a guess. Measure with `?perf` first |
| D | Light the Vaults better rather than add texture | The ceilings and walls barely show in the dark. A few more wall torches or brighter pools near them would help the baked work show. Wait for the owner's reaction to the darkening |
| E | Two-layout floor boards | The boards' 1.6 m repeat shows on the dance floor and in the bar |
| F | Sound and music | Everything is synthesised and nobody has heard it. Ambience for the dark Vaults would help most |

**Level 3** is designed and not built. It needs the owner's explicit go-ahead, and a go-ahead for the design is not that.

## Agreements with the owner

- **Never merge to `main` unless asked.** When asked ("merge", "merge to main"), open a PR with the GitHub MCP tools (there is no
  `gh` CLI; load them with ToolSearch), check it is mergeable, squash-merge with the expected head SHA. PRs #7, #8, #9 and #11 went
  that way. Do not open a PR unprompted.
- **Level 3 and later: never build without the owner's explicit permission** (`CLAUDE.md`). Planning documents are fine.
- **Prepared objects** (the roadmap's enemies, weapons, upgrades, records) are placed in levels 1 and 2 at the owner's request.
  Anything still prepared and unplaced stays unplaced.
- **Drinks and weapons are always modelled in Blender** (`scripts/blender/`), new ones included. Never edit generated data
  modules (`src/*-meshes.js`) or `assets/textures/*.webp`; change the script and rerun it, and `cmp` two runs.
- **Image files are allowed in the repo for generated textures only.** Models stay data modules. `world.js` and `models.js` stay
  procedural and DOM-free so the headless tests run in plain Node.
- **Balance is for normal mode only, never against debug mode.** Hard and Extra Hard are multipliers on top of normal.
- **Git:** the Stop hook insists on committing and pushing, so commit and push the branch you are on at the end of a piece of
  work. The owner has said you may `git fetch`. Commit trailers on every commit:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01F9FEdkzg4DQGHVPBcyaN4E`. PR bodies end with the "Generated with Claude Code"
  line and the same session link. After a PR is merged, start follow-up work on a fresh branch from `origin/main`.
- **Style of replies:** British English, lead with the answer, plain prose, say what is verified and what is not. Give options when
  the owner asks for them (they like choosing). The org instructions also ban em dashes and a list of buzzwords. Never put the
  owner's email address in a file that goes to GitHub.
- **Owner's test devices:** iPhone 16 Pro and MacBook Air M4. Both are far faster than the plan's A15 floor (iPhone 14), so
  smooth there proves nothing for an older phone. iPhone Safari runs at 120 Hz (30 or 60 in Low Power Mode). Real-phone
  screenshots from the owner have already found things the software renderer hid.

## Decisions made so far

- PC mode is the default, mobile mode is picked automatically on a phone or tablet, the Settings page overrides it.
- The torch is mounted on the gun, fitted by hand at the start of level 2, already fitted on every other gun. Only 2 or 3 of the 10
  levels are dark.
- Level 3 (design only): Grassmarket pubs, the Landlord (barrel thrower), Fizzbang Turbo plus the five existing robots.
- Difficulty: all three modes open from the start, chosen on a screen after NEW GAME, Extra Hard is numbers only.
- Textures: bake in Blender, ship WebP, keep the generated textures as the fallback (`docs/textures.md`).

## Known issues and unverified

- Nobody has played the merged build. No new sound has been heard. Every number for the newer robots and weapons and the
  difficulty multipliers is a first guess. The sim bots aim better than a thumb in a small box with no aim assist.
- Not tested on a device: the weapon strip taps, keys 1 to 8, the wheel and Q, real pointer lock in Safari, the trackpad swap fix (one event per 180 ms quiet gap in `engine.js`), the
  iPhone safe areas with Safari's bottom tab bar, texture decode time and GPU memory, frame rate on any phone.
- Level 2 on the high tier is about 145k triangles in the static world; with robots and pickups in view a frame is much heavier.
- The Nurse revived almost nothing in the sims (she is killed first), so she may be decoration. The Shaken's chain ripple appears in
  no level (each has one Shaken).
- The Vending Mimic's window still blows out white under torchlight. The pistol torch is a box on top of the slide and the owner has
  not yet seen it.
- The Vaults darkening was judged from software screenshots; the numbers to raise if it is too dark are `lift` (in `look.grade`), the
  ambient light and the baked tint in `src/levels/vaults.js`.

## How to work here

Setup in a new container: `scripts/setup-blender.sh` (about two minutes, 1 GB; venv at `~/.venvs/blender`). In a git worktree,
`ln -s /home/user/mobilegame/node_modules node_modules`.

Checks, each `node scripts/harness/<name>.mjs`: `models-check`, `drinks-check`, `combat-check`, `ui-check` (12 view sizes),
`world-check`, `level-check`, `enemies-check`, `arsenal-check`, `perf-check`, `textures-check`, `difficulty-check`. Then
`PORT=<n> SMOKE_WAIT=90000 npm run smoke -- <dir>` (end to end in software WebGL, waits with `until`, slow), the bot proxy
`node scripts/sim3d.mjs --level 2 --difficulty hard --runs 30` (levels 1 or 2, difficulty normal, hard or extra) and
`npm run build:artifact`. A busy machine makes the smoke test and `world-check`'s build-time checks flake; re-run on a quiet one.

Screenshots (look at them, never judge the 3D look from logs):
`PORT=<n> WEAPON=launcher TORCH=1 node scripts/harness/game-views.mjs <level> <outdir> "name:tileX,tileZ,yaw"` (world units are tile
coordinates times 2; env `W`, `H`, `Q`, `EXTRA='&baked=0'`), plus `screen-views.mjs`, `enemy-views.mjs`, `arsenal-views.mjs`,
`world-views.mjs`, `level-tour.mjs`, `attach-views.mjs`. Software WebGL says nothing about phone frame rate.

Blender: `~/.venvs/blender/bin/python scripts/blender/{drinks,weapons,props,arsenal,textures}.py` rewrites the matching data
module or textures (textures take about 6 minutes); run twice and `cmp`. `preview.py` makes Cycles views.

Pitfalls found the hard way:

- One tap is handled per frame in the smoke test, so wait with `until` between presses.
- The level swap is deferred by a frame; wait for `getWorld().level` before using the new level.
- On level 2 the attach sequence blocks firing and swapping until the torch is fitted: tests and the sim set `torch { attached: true }`.
- The engine listens on the `#game` canvas, not `#gl`. Mouse look needs `input.mouse.locked`, set by `pointerlockchange`.
- `testHook` names include `torch`, `mobile`, `setting`, `mouse`, `screen`, `save`, `hitEnemy`, `play`, `level`, `title`, `teleport`,
  `giveWeapons`, `spawn`, `give`, `arsenal`, `hud`, `difficulty`, `baked`, `buttons`; read `testHook` in `src/game3d.js` for the list.
- Tests that hard-code robot counts break when placement changes them (they were 19 and 24, now 21 and 27).
- Starting several agents' worktrees at once once failed with a git-config error; retrying worked. An agent's worktree forks from
  `main` or the current branch at the time, so check what an agent's branch contains before merging it.
- `git push --delete` is refused by the git proxy ("remote end hung up"), so merged remote branches cannot be removed from here.
- The real phone renders brighter than the software renderer, so a look judged from software screenshots (the Vaults' darkness
  above all) needs the owner's eyes on a device. The dark level's brightness is set by the grade stage in `src/gfx.js`
  (`lift`, `exposure`) as much as by the lights; the low tier skips the grade stage and is much darker.
- `world-check`'s build-time checks flake on a busy machine; the smoke test needs `SMOKE_WAIT=90000` there.
- `testHook('strip')` returns the weapon strip cells for tests; the strip's rectangles come from `hud.layout(view).strip(n)`.
- To brief an agent: own worktree (`isolation: "worktree"`), a distinct `PORT`, a lane (files it owns and files it must not touch),
  "do not push, merge or fetch", commit trailers, and a report listing commands run and what was not verified. A fresh chat does not
  receive an old chat's agent reports, so merge agent work before clearing the chat.
- Old session detail, if the file still exists:
  `/root/.claude/projects/-home-user-mobilegame/ed3ea337-f0c8-56e8-b8c9-fbd460f4be73.jsonl`.
