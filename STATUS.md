# Status and handover

This file is for a fresh chat taking over. Read it first, then `CLAUDE.md` (binding project rules), then `ROADMAP.md` and
`docs/HANDOVER.md`. Snapshot taken 23 October 2026, about 22:00 UTC. It goes stale fast: check `git log` and
`git worktree list` before trusting the "in progress" section.

## The project in one paragraph

"Naebun's Last Set": a first-person 3D horror shooter for phone browsers, set in an Edinburgh basement club, dark comedy,
light Scottish voice. Three.js r160 vendored in `vendor/`, plain ES modules, no bundler, no backend. Repo
`/home/user/mobilegame`, GitHub `Naebun/mobilegame`. Two levels exist (the Cowgate, the Vaults). Use they/them for anyone
whose pronouns have not been stated, the owner included.

## Where the code is

| Where | What |
| --- | --- |
| `main` (`9366288`, PR #8, squash) | Everything up to the Blender weapons, torch, prepared enemies and arsenal. This is what is deployed to the owner's phone |
| Branch `playtest-textures-placement` (in `/home/user/mobilegame`, pushed) | The **integration branch**. Forked from `main`. Holds my own small commits (below) and all four agents' merged work. Not merged to `main` |
| Four agent worktrees under `/home/user/mobilegame/.claude/worktrees/` | Now fully merged into the integration branch, so nothing is lost if they go. The branches `worktree-agent-<id>` are local only |

My own commits on the integration branch (all on top of `main`, all pushed):

- Test scripts read `PORT` from the environment, so several can run at once.
- `docs/level-3.md`, the level 3 design. Planning only.
- The Vaults are darker outside the torch cone (`src/levels/vaults.js`: lower ambient, baked tint and fill, softer cone edge;
  `src/game3d.js`: thinner, faster-fading beam haze). Checked in software screenshots only.
- Mouse wheel swap counts one event per 180 ms quiet gap (`src/engine.js`), for trackpad inertia. Not proved in a browser.
- `ROADMAP.md` says level 2 is merged; this `STATUS.md`.

Note: the agent branches forked before some of those commits, so they do not contain the darker Vaults, the wheel fix or the
level 3 doc. Merging them into the integration branch brings everything together.

## Integration state: all four agents' work is merged

The four agents (playtest kit, textures, placement, Hard and Extra Hard) finished and are merged into the integration branch
`playtest-textures-placement`, in that order, with conflicts resolved by hand (mostly harness scripts, `smoke.mjs`,
`sim3d.mjs` and the docs). Their worktrees under `.claude/worktrees/` are no longer needed once this branch is on `main`.
What each brought:

| Piece | What it added |
| --- | --- |
| Playtest kit and fixes | `?perf` readout (`src/perf.js`, P key, `window.__perf`), `docs/playtest.md`, pistol torch moved onto the slide's top rib, launcher lens at the horn's mouth, gooseneck lowered a little, Longshot laser fades near the camera, Mimic glow dimmed while dormant |
| Textures | `scripts/blender/textures.py`, 13 WebP files (594 KB) in `assets/textures/`, `src/textures.js`, `world.retexture`, baked on medium and high only, generated textures remain the fallback and the low tier. `?baked=0` turns it off. Also fixed a texture leak on level swap |
| Placement | Bots taught the newer robots and weapons (`scripts/sim3d.mjs`). Level 1 now has 21 robots, level 2 has 27; the Airhorn, Grenade, Beam, upgrades and ten records are placed. Full table and reasoning: `docs/placement.md` |
| Hard and Extra Hard | `DIFFICULTY` table in `src/data.js`, difficulty screen after NEW GAME, save version 2 with per-mode bests, `--difficulty` on the sim, `docs/difficulty.md`. Tuned table: Hard 1.35 damage, 1.2 health, 1.1 speed, 0.9 wind-up; Extra Hard 1.75, 1.35, 1.15, 0.85 (the first guess was too hard on level 2) |

Test fixes made during the merge: `combat-check` and `difficulty-check` hard-coded the old robot counts (19 and 24); they now
expect 21 and 27.

Checks on the merged tree (24 October): `models-check`, `drinks-check`, `ui-check`, `perf-check` pass; `combat-check` 416/416;
`world-check` 4413/4413; `level-check` 748/748; `enemies-check` 261/261; `arsenal-check` 464/464; `textures-check` 93/93;
`difficulty-check` 84/84; smoke test SMOKE OK (125 checks, `SMOKE_WAIT=90000`); `build:artifact` 4.0 MB with the textures
inlined.

Bot win rates on the merged maps, 30 runs, sloppy / casual / good (a sample, about plus or minus 10 to 15 points):

| Level | Normal | Hard | Extra Hard |
| --- | --- | --- | --- |
| 1 | 97 / 100 / 100 | 73 / 100 / 93 | 53 / 67 / 87 |
| 2 | 67 / 90 / 97 | 10 / 47 / 67 | 3 / 17 / 50 |

The difficulty table was tuned on the maps before placement, so it may want another pass: the Longshot's shot is 67 on Extra Hard.

Still to do on this branch: the owner has not yet asked for it to go to `main`.

## Agreements with the owner

- **Never merge to `main` unless asked.** When asked ("merge to main"), open a PR with the GitHub MCP tools (there is no `gh`
  CLI), check it is mergeable, squash-merge with the expected head SHA. PR #7 and #8 went that way. Do not open a PR
  unprompted.
- **Level 3 and later: never build without the owner's explicit permission** (`CLAUDE.md`). Planning documents are fine. A go-ahead for a design is not a go-ahead to build. `docs/level-3.md` exists and is design only.
- **Prepared objects** (the roadmap's enemies, weapons, upgrades, records) were built unplaced; the owner has since asked for
  them to be placed in levels 1 and 2. That is the placement agent's job and is not yet merged.
- **Drinks and weapons are always modelled in Blender** (`scripts/blender/`), new ones included. Never edit generated data
  modules (`src/*-meshes.js`); change the script and rerun it, and `cmp` two runs.
- **Image files are allowed in the repo for generated textures only.** Models stay data modules. `world.js` and `models.js`
  stay procedural and DOM-free so the headless tests run in plain Node.
- **Balance is for normal mode only, never against debug mode.** Hard and Extra Hard are multipliers on top of normal.
- **Git:** the Stop hook insists on committing and pushing changes, so commit and push the branch you are on at the end of a
  piece of work. `git fetch` once needed the owner's explicit permission; they have since said "you have permission to git
  fetch". Commit trailers on every commit:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01F9FEdkzg4DQGHVPBcyaN4E`. PR bodies end with the "Generated with Claude Code" line and the same session link.
- **Style of replies:** British English, lead with the answer, plain prose, say what is verified and what is not. Give options
  when the owner asks for them (they like choosing). The org instructions also ban em dashes and a list of buzzwords.
- **Owner's test devices:** iPhone 16 Pro and MacBook Air M4. Both are far faster than the plan's A15 floor, so smooth
  there proves nothing for an iPhone 14. iPhone Safari runs at 120 Hz (30 or 60 in Low Power Mode).

## Decisions made so far

- PC mode is the default, mobile mode is picked automatically on a phone or tablet, the Settings page overrides it.
- Torch mounted on the gun, fitted by hand at the start of level 2, already fitted on every other gun. Only 2 or 3 of 10
  levels are dark.
- Level 3 (design only): Grassmarket pubs, the Landlord (barrel thrower), Fizzbang Turbo plus the five existing robots.
- Difficulty: all three modes open from the start, chosen on a screen after NEW GAME, Extra Hard is numbers only.
- Texture plan: bake in Blender, ship WebP, keep the generated textures as fallback (`docs/texture-options.md`).

## Waiting on the owner

- Whether to merge the integration branch to `main` (it holds the textures, the placement and Hard and Extra Hard).

- A go-ahead to build level 3, and whether in one pass or area by area.
- A real-phone playtest of level 2: is the dark too dark after the darkening, does the torch read, frame rate, touch feel.
- When to merge the integration branch to `main`.

## Known issues and unverified

- Nothing new has been played by a person or seen on a phone, and no new sound has been heard. Every number for the prepared
  enemies and weapons and the difficulty multipliers is a first guess. The sim bots aim better than a thumb in a small box
  with no aim assist, and 30 runs is only good for about plus or minus 15 points.
- Real pointer lock in Safari, trackpad swap, iPhone safe areas with Safari's bottom tab bar: untested.
- Level 2 on the high tier is about 145k triangles against a 150k limit.
- The sim bots barely use the Grenade and the Beam. SWAP is a forward-only cycle, and with seven guns in level 2 the placement agent found cycling cost the bots the Plague Cellar. That is a design question for a human playtest: a swap-back, a weapon wheel, or fewer guns per level.
- The Nurse revived almost nothing in the sims (she is killed first), so she may be decoration. The Shaken chain ripple appears in no level (each has one Shaken).
- Per frame the game draws 150k to 330k triangles on high and up to 276 draw calls (robots and pickups behind walls are still drawn); the 145k figure is the empty level only. Check with `?perf` on the iPhone before trusting 'it feels smooth'.
- The Vending Mimic's window still blows out white under torchlight. The pistol torch module sits on the slide (a box on top); the owner has not seen it.
- Texture work, once merged, needs checking on a real phone for decode time and GPU memory.

## How to work here

Setup in a new container: `scripts/setup-blender.sh` (about two minutes, 1 GB; venv at `~/.venvs/blender`). In a git
worktree, `ln -s /home/user/mobilegame/node_modules node_modules`.

Checks, each `node scripts/harness/<name>.mjs`: `models-check`, `drinks-check`, `combat-check` (59), `ui-check` (12 view sizes),
`world-check` (4381), `level-check` (586), `enemies-check` (157), `arsenal-check` (392). Then `PORT=<n> npm run smoke -- <dir>`
(end to end in software WebGL, waits with `until`, so it is slow), `node scripts/sim3d.mjs --level 2 --runs 30`
(the bot proxy; also `--difficulty` once merged) and `npm run build:artifact`. Counts above are as of `main`; they will change
as the agents' work lands.

Screenshots (look at them, never judge the 3D look from logs):
`PORT=<n> WEAPON=launcher TORCH=1 node scripts/harness/game-views.mjs <level> <outdir> "name:tileX,tileZ,yaw"` (world units are
tile coordinates times 2; env `W`, `H`, `Q`), plus `screen-views.mjs`, `enemy-views.mjs`, `arsenal-views.mjs`,
`world-views.mjs`, `level-tour.mjs`. Software WebGL says nothing about phone frame rate.

Blender: `~/.venvs/blender/bin/python scripts/blender/{drinks,weapons,props,arsenal}.py` rewrites the matching data module;
run twice and `cmp`. `preview.py` makes Cycles views.

Pitfalls found the hard way:

- One tap is handled per frame in the smoke test, so wait with `until` between presses.
- The level swap is deferred by a frame; wait for `getWorld().level` before using the new level.
- On level 2 the attach sequence blocks firing and swapping until the torch is fitted: tests and the sim set
  `torch { attached: true }`.
- The engine listens on the `#game` canvas, not `#gl`. Mouse look needs `input.mouse.locked`, set by `pointerlockchange`.
- `testHook` names that exist: `torch`, `mobile`, `setting`, `mouse`, `screen`, `save`, `hitEnemy`, `play`, `level`, `title`,
  `teleport`, `giveWeapons`, `spawn`, `give`, `arsenal`, `hud`.
- Starting several agents' worktrees at once once failed with a git-config error; retrying worked.
- To brief an agent: own worktree (`isolation: "worktree"`), a distinct `PORT`, a lane (files it owns and files it must not
  touch), "do not push, merge or fetch", commit trailers, and a report listing commands run and what was not verified.
- Old session detail, if the file still exists:
  `/root/.claude/projects/-home-user-mobilegame/ed3ea337-f0c8-56e8-b8c9-fbd460f4be73.jsonl`.

## Suggested next steps (superseded items are done: the agents are integrated)

1. Check each worktree (`git -C <path> status`, `git -C <path> log --oneline -5`), finish or re-brief whatever is incomplete.
2. Integrate as described above, run everything, push the integration branch, report numbers to the owner.
3. Ask whether to merge to `main` and whether level 3 is a go.
4. Refresh this file at the end of any substantial piece of work, and update `ROADMAP.md` and `docs/HANDOVER.md` alongside it.
