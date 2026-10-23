# Naebun's Last Set

## Standing rule: levels
Levels 1 (the Cowgate) and 2 (the Vaults) exist. Level 2 was built with the owner's explicit permission. **Never build
level 3 or any later level (maps, enemies, bosses, textures, story cards, anything that belongs to a future level) without
the owner's explicit permission.** Permission for one level is not permission for the next. Planning documents are fine;
building is not. A feature is built on the levels that exist and tested on both.

First-person 3D horror shooter, phone browser, set in an Edinburgh basement club. Dark comedy tone, light Scottish
voice. Portrait and landscape (the layout follows the screen shape; `hud.layout(view)` and `screens.js` handle both). Three.js (vendored in `vendor/`), plain ES modules, no bundler for development, no backend.
Two levels so far. Read `README.md` for the layout and `docs/fps-design.md` for the module contract.

## Conventions
- **Drinks and weapons are always modelled in Blender**, every one of them, new ones included (the generated data modules
  `src/drink-meshes.js`, `src/weapon-meshes.js` and the script that writes them; never procedural code). That covers weapon
  torches, upgrade pickups and the like. Robots and level dressing may stay procedural or use the prop kit.
- The player character is called Naebun, and the game is "Naebun's Last Set".
- **Control modes:** PC mode (the default: mouse look, the grey touch boxes hidden) and mobile mode (the grey boxes). A
  mobile browser switches to mobile mode on its own at start-up unless the player has chosen on the Settings page.
- **The torch** is mounted on the gun, with a beam that follows where the gun points (not a light on the camera). Only a few
  levels are dark enough to need it (level 2 now, 2 or 3 of the 10 in all); Naebun fits the pistol's torch at the start of
  the first dark level, and every other gun already has one fitted.
- **Prepared objects:** the roadmap's enemies, weapons, upgrades and collectibles may be built and tested ahead of time, but
  they stay unplaced: no level map uses them until the owner says to put them in a level.
- Match the surrounding code: 2-space indent, single quotes, semicolons, short comments that say why. British English.
- `world.js` and `models.js` are procedural only: geometry, flat colours and generated `THREE.DataTexture`s. No image
  files, no canvas textures, no DOM access, so they run under plain Node (used by the headless tests).
- The five drink meshes are modelled in Blender (`scripts/blender/drinks.py`) and generated into `src/drink-meshes.js`,
  which `models.js` decodes. That file is data, not hand-written: change the script and rerun it, never edit the output.
  Geometry and vertex colour only, still no image files. Texture work has not started.
- The five weapons and Naebun's hands and forearms are modelled in Blender too (`scripts/blender/weapons.py` generates
  `src/weapon-meshes.js`; same rules: change the script, never the output). The procedural `WEAPON_PARTS` in `models.js` stay as
  the fallback.
- Level props (barrels, casks, columns, speakers, bar, booths, tombs, carts and more) are modelled in Blender too
  (`scripts/blender/props.py` generates `src/prop-meshes.js`; see `docs/props.md`). `world.js` places them with `placeProp`
  and keeps the procedural props as the fallback and for the low tier. Change the script, never the output.
- Look of the 3D world: gritty and real. Exposed brick, stone, timber, plaster, iron, warm tungsten light. Not
  sci-fi: no neon trim strips, no glowing panels. Neon is limited to a couple of classic bar signs. The 2D UI keeps
  its neon pink and cyan.
- Mobile performance: share geometries and materials, merge static geometry (about 30 draw calls for the level),
  at most 4 point lights in the world plus one on the camera, no shadows, pixel ratio capped at 1.5.
- Content and tuning live in `src/data.js`. Levels are definitions in `src/levels/` (data) plus a decor module for the look
  (`vaults-decor.js`; level 1's dressing is still inside `world.js`), built by `buildWorld({ level })`. Enemies: "Dr Fizzbang"
  robots are melee only, "Bampot and Nephew" robots can shoot. The names are invented, in the spirit of a fizzy-drink brand and a family-firm spirits brand. Do not use real
  brand names, logos or packaging in names, text or models.
- Controls: two grey boxes (move left, aim right). A thumb in the right box auto-fires. A drag that starts anywhere
  else (not in a box or on a button) aims only, no fire. There is no aim assist.
  Ammo is unlimited, clips are not; reload is automatic when empty or via RELOAD. Button taps are read from press
  events, not live touches, so they work at any frame rate. `hud.layout(view)` is the single source of truth for the
  box and button rectangles.
- Mouse look is a setting for computers (Settings page from the title); by default the mouse acts like a finger. Progress is saved by `src/save.js` (cookie plus localStorage); debug runs never write it.
- Menu buttons come from `screens.buttons(mode, view, state)`, used for both drawing and hit testing.
- NEW GAME goes to the controls screen first; only START GAME begins the run.

## Balance rule
Debug mode (home-screen toggle, `DEBUG_MULT` in `game3d.js`) gives Naebun 2x fire rate, 2x damage and 2x health.
**Never balance against it.** All tuning is for normal mode. Debug runs must not write the best score.

## Testing
- `npm run smoke -- <dir>` is the end-to-end test (needs the `?test` hook, `window.__game`, which the page exposes only
  with `?test` in the URL). It waits for conditions: software WebGL is slow.
- `npm run sim` plays the level with bots in plain Node. It is a proxy for a person, not a replacement: use it to check
  the level is winnable and to compare changes, then ask for a human playtest.
- Look at screenshots (`scripts/shot.mjs`, `scripts/harness/level-tour.mjs`) for anything visual. Do not judge the 3D
  look from logs.

## Current state
See `ROADMAP.md`.
