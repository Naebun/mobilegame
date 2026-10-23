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
| Branch `playtest-textures-placement` (in `/home/user/mobilegame`, pushed, head `4086cd9` when written) | The **integration branch**. Forked from `main`. Holds my own small commits (below) and is where the four agents' work should be merged. Not merged to `main` |
| Four agent worktrees under `/home/user/mobilegame/.claude/worktrees/` | Each agent's unmerged work, on a local branch named `worktree-agent-<id>`. **Local to this container and not pushed.** If the container is reclaimed before they are merged or pushed, that work is gone |

My own commits on the integration branch (all on top of `main`, all pushed):

- Test scripts read `PORT` from the environment, so several can run at once.
- `docs/level-3.md`, the level 3 design. Planning only.
- The Vaults are darker outside the torch cone (`src/levels/vaults.js`: lower ambient, baked tint and fill, softer cone edge;
  `src/game3d.js`: thinner, faster-fading beam haze). Checked in software screenshots only.
- Mouse wheel swap counts one event per 180 ms quiet gap (`src/engine.js`), for trackpad inertia. Not proved in a browser.
- `ROADMAP.md` says level 2 is merged; this `STATUS.md`.

Note: the agent branches forked before some of those commits, so they do not contain the darker Vaults, the wheel fix or the
level 3 doc. Merging them into the integration branch brings everything together.

## In progress: four agents (spawned by the previous chat)

A fresh chat will **not** receive their completion messages. Look at each worktree directly. If an agent's work looks
unfinished, you can brief a new agent in the same worktree or finish it yourself. Do not clear the chat while they are still
running if you can avoid it.

| Piece | Worktree and branch (id) | Last commit seen | Brief in short |
| --- | --- | --- | --- |
| Playtest kit and visual fixes | `agent-a0e968e42d8423870` | `5bf1b2f` vinyl gooseneck | `?perf` readout (`src/perf.js`, P key, `window.__perf`), `docs/playtest.md`, fix the hidden pistol torch, launcher lamp, gooseneck, Longshot laser blob, Mimic glow. Owns `weapons.py`, `weapon-meshes.js`, the torch and enemy bits of `models.js` |
| Textures | `agent-ad5988b83f3eaa676` | no commits yet, 19 files changed | Blender-baked tileable brick and flagstone first (then stone, timber, plaster), WebP in `assets/textures/`, loader `src/textures.js`, generated textures stay as the low-tier and Node fallback. Updates the "no image files" rule in `CLAUDE.md` |
| Placement | `agent-ac666eb0ec6334ba4` | `fcb28a8` bots taught the new robots and weapons | Part A: teach `scripts/sim3d.mjs` bots the Longshot, Shaken, Nurse, Mimic and new weapons. Part B: place the prepared enemies, weapons, upgrades and ten records in levels 1 and 2, write `docs/placement.md`, rebalance, flip the "nothing is placed" assertions in `enemies-check` and `arsenal-check` |
| Hard and Extra Hard | `agent-a4c45d83ea3d21186` | `e6c8ded` difficulty screen | `DIFFICULTY` table in `src/data.js`, difficulty screen after NEW GAME, save v2 with per-mode bests, `--difficulty` flag on the sim, `docs/difficulty.md`. Multipliers: Hard 1.5x damage, 1.25x health, 1.1x speed, wind-ups 10 percent quicker; Extra Hard 2x, 1.5x, 1.2x, 20 percent quicker. Telegraph floor about 0.35 s |

Each worktree also has uncommitted changes (5, 19, 16 and 7 files when written), so the agents were mid-task. Each agent was
told to commit on its own branch, never push or merge, and to finish with a report (what it built, every command run, what it
did not verify). Those reports are in the old chat only.

### How to integrate them

1. In `/home/user/mobilegame` (integration branch), merge them one at a time, smallest first: playtest kit, textures,
   difficulty, placement last. Conflict hotspots: `src/game3d.js`, `src/data.js`, `src/world.js`, `scripts/smoke.mjs`,
   `scripts/sim3d.mjs`, `scripts/harness/enemies-check.mjs`, `arsenal-check.mjs`, `CLAUDE.md`, `README.md`, `docs/HANDOVER.md`,
   `ROADMAP.md`. Regenerated data modules (`src/weapon-meshes.js`) should come from re-running the script, not hand merging.
2. After each merge run the headless checks. At the end run all of them (below), both sims at 30 runs, the smoke test and
   `npm run build:artifact`.
3. Re-check the level 2 look after textures land (the darker Vaults numbers were tuned on generated textures).
4. Only merge to `main` when the owner says so (see agreements).

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

- A go-ahead to build level 3, and whether in one pass or area by area.
- A real-phone playtest of level 2: is the dark too dark after the darkening, does the torch read, frame rate, touch feel.
- When to merge the integration branch to `main`.

## Known issues and unverified

- Nothing new has been played by a person or seen on a phone, and no new sound has been heard. Every number for the prepared
  enemies and weapons and the difficulty multipliers is a first guess. The sim bots aim better than a thumb in a small box
  with no aim assist, and 30 runs is only good for about plus or minus 15 points.
- Real pointer lock in Safari, trackpad swap, iPhone safe areas with Safari's bottom tab bar: untested.
- Level 2 on the high tier is about 145k triangles against a 150k limit.
- Level 2 bot win rates at the last measurement (20 runs): sloppy 80, casual 80, good 100. Level 1: 100 at every skill.
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

## Suggested next steps

1. Check each worktree (`git -C <path> status`, `git -C <path> log --oneline -5`), finish or re-brief whatever is incomplete.
2. Integrate as described above, run everything, push the integration branch, report numbers to the owner.
3. Ask whether to merge to `main` and whether level 3 is a go.
4. Refresh this file at the end of any substantial piece of work, and update `ROADMAP.md` and `docs/HANDOVER.md` alongside it.
