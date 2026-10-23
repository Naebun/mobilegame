# Full game plan

Status: draft for the owner to react to. Nothing here is built except level 1. Sizes are relative, not dates.
Where something is a guess, it says so.

## What we are making

A first-person comic horror shooter for the phone browser, set in Edinburgh. Naebun is a DJ, the robots are drinks
machines that have gone wrong, and the whole thing takes about two hours to finish.

Fixed decisions:

- Portrait and landscape (the plan said portrait only; landscape was added on request, see `ROADMAP.md`). Plays in Safari on any iOS device from the past four years (iPhone 14 and newer, and iPads of the
  same age), so Safari 16 or later, WebGL 2, and an A15-class GPU as the floor.
- Linear levels. Every robot is placed in advance, asleep, and wakes when it notices Naebun. Dead robots stay dead.
  Clear an area and its door opens. Nothing comes out of walls.
- Two grey thumb boxes (move left, aim right, auto-fire while the right thumb is down), no aim assist, unlimited ammo
  with limited clips, reload automatic when empty or via the RELOAD button.
- Real surfaces: brick, stone, timber, plaster, iron, warm light. Not sci-fi.
- Names are invented. Dr Fizzbang robots are melee only. Bampot and Nephew robots can shoot.
- Story is a light comic frame: short written lines only.
- Balance is for normal mode only. Debug mode is a testing aid and is never used to tune anything.

## The story frame

Naebun has the closing slot on the last night of the Fringe, at a club in the Cowgate. Somebody restocked the bar with
the wrong sort of drinks machine. They have opinions. Worse, the record bag has been carried off by a bigger act,
the Headliner, who is playing the sunrise show on top of Arthur's Seat. The bag holds the one record that is needed.
Naebun has until dawn to fight across Edinburgh, get it back, and play the set.

Cast, all delivered in a line or two:

- **Naebun.** Tired, dry, professionally unbothered.
- **Cheryl, the agent.** Appears only as voicemails between levels. Always optimistic, always wrong.
- **The Headliner.** Seen on posters and graffiti all the way up, fought at the end.
- **Fizzbang Beverages and Bampot and Nephew.** The two firms behind the robots. Product recall notices and
  safety stickers on the walls are the running gag.

How it is delivered (no cutscenes, no voice acting, so the cost is small):

- A level intro card per level (the existing one).
- One voicemail from Cheryl between levels, as text over a still of the next location.
- Wall posters and recall notices in the levels.
- A few collectible records per level that each carry one joke.
- The death lines that already exist, plus a few per level.
- A closing card.

Sample copy, to set the tone (all placeholder):

- Cheryl, after level 1: "Naebun, good news. The venue is paying in cash. Bad news, the cash is also a robot."
- Recall notice: "UNIT 4471 HAS EXCEEDED ITS PRESSURE RATING. DO NOT SHAKE. DO NOT STAND NEAR. DO NOT BE IN THE CLUB."
- Ending: the record turns out to be scratched. Naebun plays it anyway. It is a banger.

## Shape of the game: 8 core levels, up to 10

The owner is happy with 8 to 10 levels. The plan is 8 core levels of about 15 minutes, which already makes the two
hours, plus two stretch levels that are built only if the level pipeline makes new levels cheap. If both stretch
levels are built, each level can run closer to 12 minutes. Every level costs about the same to design and test
whatever its length, which is why the core is 8 and not 10.

| # | Location | Look and gimmick | New robot | New weapon or upgrade | Boss |
| --- | --- | --- | --- | --- | --- |
| 1 | The Cowgate (built) | Brick basement club | Dr Fizzbang, Bampot and Nephew | Pistol, shotgun, SMG, launcher | The Bouncer |
| 2 | The Vaults (South Bridge, Mary King's Close) | Damp stone arches, nearly dark, the torch matters | Shielded Fizzbang (armoured front: shoot it from behind or blow it up) | Clip upgrade, Vinyl Disc (ricochets) | The Tour Guide |
| 3 | Grassmarket pubs | Warm timber rooms, many small doorways | Fizzbang Turbo (charges in a straight line) | Faster reload | The Landlord (throws barrels) |
| 4 | Royal Mile closes | Outdoors at night, rain, cobbles, narrow closes, steps | Bampot Longshot (sniper, laser line before it fires) | Feedback Beam | The Piper (sonic pulses) |
| 5 | Fringe venue, backstage and stage | Velvet, rigging, stage lights, set pieces on the stage | Bampot Nurse (revives other robots) | Alt-fire for the SMG | The Mascot |
| 6 | Waverley Station | Glass roof, big concourse, platforms | Fizzbang Shaken (explodes when killed) | Bass-Drop Grenade | The Station Master (train hazard) |
| 7 | Princes Street Gardens, Scott Monument | Open gardens, then a climb through the monument | Mini Bampots (small swarms) | Airhorn (shockwave) | The Monument |
| 8 | Arthur's Seat at dawn | Outdoors, rising path, the light comes up as you climb | Everything | Final upgrades | The Headliner |

Stretch levels, slotted in where they fit the route: **Edinburgh Castle and the Esplanade** (between Waverley and the
Gardens: stone ramparts, the One O'Clock Gun as a hazard and a joke) and **Salisbury Crags and the Radical Road**
(just before the summit: a narrow cliff path, wind, long sightlines for ranged robots).

**Approved enemy roster (owner approved all five, none built yet).** Shielded Fizzbang (melee, flank it), Fizzbang
Shaken (melee exploder), Bampot Longshot (ranged sniper with a laser line), Bampot Nurse (support, revives robots) and
the Vending Mimic (a dormant drinks machine that unfolds). They are not tied to level 1 or to the table below, which was
a first draft: the per-level robots in the table are suggestions, and these five are the approved set. Details and the
build notes are in `ROADMAP.md`. They stay unbuilt until the owner says to build them.

All new robots keep the rule: Fizzbang types fight in melee, Bampot types can shoot. The Nurse supports and does not
attack. Eight weapons in total, each with one or two upgrades found in the levels.

## Features to build

**Gameplay**

- Pause menu.
- Checkpoints inside levels, saved so a quit does not lose the level.
- Weapon upgrades found in levels (clip size, reload speed, a second fire mode).
- Secrets: a side room with a weapon or an upgrade in most levels.
- Switch or key doors so not every door depends only on clearing an area.
- Hazards and destructible cover (sparking speakers, barrels).
- Lighting events (a blackout, a swinging lamp).
- Collectible records and a setlist screen that shows what has been found.

**Music as a mechanic** (untested, to prototype early, because it is the idea most specific to a DJ game)

- Gunfire snaps to the beat, so shooting becomes part of the track.
- Each level's track gains layers as areas are cleared.
- A drop meter fills with kills in a row; when full, a bass drop stuns every robot in view.

**Player-facing systems**

- Settings: look sensitivity, field of view, invert Y, volume and a mute button, control box size, swap sides.
- Difficulty: three levels.
- Automatic quality: measure frame time and lower pixel ratio or effects when a device struggles (Low Power Mode caps
  iOS at 30 fps).
- Credits and a clear way to reset saved progress.

**iOS specifics**

- The home-screen icon must be a PNG (180 x 180). iOS ignores the current SVG icon.
- Use dynamic viewport units, so the Safari address bar does not cut the view.
- No haptics (iOS has no Vibration API) and no gyro aiming (needs a permission prompt).
- Safari can clear site storage for sites not added to the home screen. Saves need to survive that gracefully, and the
  game should suggest adding it to the home screen.
- Scale the control boxes up on iPad.

## Technical plan

- **Level pipeline.** Today the one level lives inside `world.js`. Move each level into its own data file with a theme
  (textures, lights, props), and make `buildWorld` take a level definition. A level then needs a map, its spawns and
  pickups, and a theme, not new code. This is the first piece of work after a phone playtest.
- **Tests per level.** Generalise the geometry check and the bot playthrough so every new level is checked for
  connectivity, spawn clearance, closed doors really separating areas, and winnability.
- **Budgets for the A15 floor** (guesses, to confirm on a real device): 60 fps target with 30 as the minimum, at most
  about 60 draw calls and 150k triangles per level, textures at 512 px or less, level load under 3 seconds. Level 1 is
  at 28 draw calls and 66k triangles.
- **Graphics.** See the next section.
- **Frame-rate overlay** behind a `?perf` flag, so numbers can be read off a real phone.
- **Audio.** Stay with synthesis: no files to host, easy to vary per level.
- **Automatic checks.** Run the tests on every pull request, not just locally.
- **Save format.** Versioned, so later changes do not break old saves.

## Graphics direction (the owner wants a more modern look)

Today: flat-shaded low-poly, plain diffuse materials, 256 px generated textures, no shadows, no anti-aliasing, no
post-processing, 3D pixel ratio capped at 1.5. It reads as a clean prototype, not as a modern game. An A15 phone has
room for a lot more, so the question is which upgrades give the biggest visible change for the least cost.

Candidate upgrades, roughly in order of value for cost (all unmeasured on a real phone):

1. **Colour and tone.** Filmic tone mapping, proper exposure, colour grading per level, a vignette and fine film
   grain. Cheap, and changes the mood of every frame.
2. **Bloom** on bulbs, eyes, neon and muzzle flashes, at half resolution. Cheap to moderate. Needs three.js add-on
   files vendored into the repo.
3. **Surface detail.** Replace plain materials with physically based ones (roughness, metalness) and add procedural
   normal maps for brick, stone and boards, so warm lights rake across mortar lines and chips. The brick generator
   already knows where the mortar is, so the normal map can come from the same data. Moderate cost, large visible gain.
4. **Baked ambient occlusion** darkening corners, wall bases and the undersides of beams in the level geometry. No
   run-time cost, and it removes most of the flat look.
5. **Anti-aliasing and resolution.** Multisampling, higher texture resolution (512 px with mipmaps), and a pixel ratio
   that adapts to the device instead of a fixed 1.5.
6. **Atmosphere.** Dust motes in the light, soft light shafts under lamps (faked with additive cones), steam and smoke,
   better muzzle smoke, shell and spark particles, decals for bullet marks and blood-equivalent oil.
7. **Smoother, more detailed models.** Bevelled edges, smooth shading on the robots, more parts and wear, animated
   details (pistons, steam, flickering eyes). More triangles, but robots are few.
8. **Real-time shadows** from one or two key lights. The most expensive item and the one most likely to hurt frame
   rate on the A15 floor. Worth trying for the torch or the main club lights only, after everything above.

What stays out of reach without outside assets: photorealistic textures and models. Procedural generation gets a
stylised, modern look (think a polished indie game), not photographs. Photographic materials would need image files
from a source with a licence that allows it, which also changes the size and load time of the game.

Graphics needs a quality ladder from the start (high, medium, low, chosen automatically from measured frame time),
or the upgrades above will lock out the older devices.

## Phases

| Phase | Contents | Done when |
| --- | --- | --- |
| 0. Level 1 on a real phone | Playtest on an iPhone. Fix feel, sensitivity, speed. Add pause, settings, PNG icon, perf overlay, checkpoints | The owner plays level 1 start to finish on an iPhone and is happy with how it feels and runs |
| 0b. Graphics pass on level 1 | Items 1 to 6 above on the Cowgate, with a quality ladder and before and after screenshots | The owner agrees level 1 looks modern and it still holds frame rate on the floor device |
| 1. Foundations | Level pipeline, three new robots, weapon upgrades, drop meter and beat prototype, story scaffolding (cards, voicemails, posters) | Level 1 is rebuilt on the pipeline with the new features and all tests pass |
| 2. Early game | Levels 2 to 4 | Four levels are playable in a row, about an hour |
| 3. Late game | Levels 5 to 8, the final boss, the closing card | The whole game is playable start to finish |
| 3b. Stretch | The two stretch levels, if the pipeline made levels cheap | Ten levels at about 12 minutes each, or stay at eight |
| 4. Finish | Balance with bots and human playtests, performance on the oldest target device, accessibility, credits | Two hours, stable frame rate on an iPhone 14 and an iPad |

## Risks

- **Performance on real devices** is unmeasured. Everything in the budgets above is a guess until a phone runs it.
- **Touch aiming with no assist over two hours** may frustrate people. The bots cannot tell us. Sensitivity settings and
  difficulty levels are the planned answer. An optional aim-help setting, off by default, is a possible fallback if
  playtests show it is needed. This conflicts with "no aim assist" only if it is on by default, so it is the owner's
  call.
- **Graphics upgrades versus frame rate.** Every item in the graphics list costs something. Doing them before knowing
  real-device numbers risks building a look the floor device cannot run. Phase 0 measures first.
- **Art workload per level.** Eight distinct places is the largest cost. The theme kits (textures, props, lights) need
  to be reused heavily, and level 1 already shows how far procedural textures and a few props go.
- **Balance** comes from bots and from the owner. Real players are likely to find it harder than the bots do.
- **Saves lost on iOS** if storage is cleared, as above.

## Decisions still open

1. Graphics: how far towards "modern" (a polished stylised look from procedural assets, or photographic materials that
   need outside image files and cost load time)?
2. Is an optional aim-help setting (off by default) acceptable as an accessibility option, or ruled out entirely?
3. Three difficulty levels, or one fixed difficulty?
4. Phone-only release as a web app, or is a store release ever in scope? That changes what iOS work is needed.

Decided: story is a light comic frame; 8 to 10 levels (8 core, 2 stretch); about two hours; portrait and landscape; iOS devices
from the past four years.


## The torch and dark missions (added on request)
The torch is mounted on the gun: a spotlight and a visible beam that follow where the gun points. Only 2 or 3 of the 10
missions are dark enough to need it, so a lit mission leaves it off. Level 2 (the Vaults) is the first dark mission, and
the one where Naebun fits the pistol's torch by hand, which tells the player this is a dark mission. Every other gun is
picked up with its torch already fitted, in the gun's own style. Proposed (not decided) other dark missions: level 7,
the climb inside the Scott Monument, and one of the two stretch levels (the castle's dungeons). Each level definition
carries `dark: true` and its torch settings; nothing else about a dark level needs new code.
