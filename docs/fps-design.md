# First-person rebuild: design contract

This is the contract for turning "Freddie's Last Set" from a top-down shooter into a first-person 3D game. Level 1
only (the Cowgate). Several modules are built in parallel against the APIs below, so **do not change a signature**
without saying so in your final report. If something in here is wrong or impossible, make the smallest sensible
deviation and report it.

## The game in one paragraph

Portrait, first-person, phone browser. Freddie is a DJ in an Edinburgh club basement, fighting robots. The level is
linear: a chain of rooms ("areas") joined by doors. Every enemy is placed in the level in advance, idle, and wakes
when it notices Freddie. Killing an enemy removes it for good. When every enemy in an area is dead the area is
clear, and the door out of it unlocks. Nothing spawns out of walls. Weapons are picked up on the floor and each has
a different effect. Ammo is unlimited but each clip is limited, so Freddie reloads (automatically when empty, or
with a button). Enemies are robots: "Dr Fizzbang" robots only fight in melee; "Bampot and Nephew" robots can shoot.

Controls: two grey boxes on screen. Left box moves (virtual stick). Right box aims by dragging; while a thumb is down
in the right box the weapon fires automatically. A drag that starts anywhere outside both boxes (and their buttons)
also aims, at the same sensitivity, but never fires. There is no aim assist: shots go where the crosshair points. A small
RELOAD button sits under the right box and a small SWAP (next weapon) button under the left box.

## Stack and ground rules

- Plain ES modules, no bundler for development. three.js r160 is vendored at `vendor/three.module.min.js`. Import it
  as `import * as THREE from '../vendor/three.module.min.js';` from files in `src/`.
- Everything is procedural: geometry, flat colours and **procedurally generated `THREE.DataTexture`s** (a typed array
  filled in code: brick, stone, boards). **No image files, no canvas textures, no DOM access** in
  `world.js` or `models.js`, so they also run under plain Node (used for headless tests). `hud.js` and `screens.js`
  only touch the 2D canvas context they are given.
- Look (UPDATED, the user asked for this): a gritty, real, old Edinburgh basement club. Exposed red and brown brick,
  stone, timber, plaster, iron, warm tungsten light. NOT futuristic sci-fi: no neon-lined corridors, no glowing trim
  strips, no clean panels. The 2D UI keeps its neon pink and cyan accents (`src/draw.js`), the 3D world does not. Use `MeshLambertMaterial` for lit surfaces and `MeshBasicMaterial` for glowing parts (neon strips,
  eyes, screens). British English in comments and any visible text. No em dashes in visible text.
- Mobile performance matters. Share geometries and materials between instances (module-level caches). Keep dynamic
  lights few (see world.js). No shadows. No post-processing.
- Code style: match the surrounding code (see `src/engine.js`, `src/audio.js`): 2-space indent, single quotes,
  semicolons, short comments that say why.
- Only edit the files you own (listed in your brief). Put test harness pages in `scripts/harness/` and screenshots in
  your scratchpad directory. Do not commit or push; the integrator does that.
- Shared constants live in `src/consts.js` (TILE, WALL_H, EYE, PLAYER_R, COLOURS). Read it.
- To look at your work: `node scripts/shot.mjs <page> <out.png> [--w 390 --h 844 --dpr 1 --wait 1500 --eval "js"]`
  renders a page in headless Chromium with software WebGL and prints console errors. Use it, look at the PNG, and
  iterate until it genuinely looks good. A working but ugly result is not done.

## Coordinates

x east, y up, z south. Map tile (col, row) centre = `((col + 0.5) * TILE, (row + 0.5) * TILE)`. `yaw` is rotation
about +y in radians; yaw 0 faces -z (north), positive yaw turns left (anticlockwise seen from above), so the forward
vector is `(-sin(yaw), -cos(yaw))` in (x, z). The camera and every model follow this: models face **-z** at yaw 0.

## Module: `src/world.js` (owner: world agent)

The level geometry, collision, pathing data and level content. Exports:

```js
export function buildWorld() -> World
```

`World`:

```js
{
  group,            // THREE.Group: every static mesh, door, prop and light. The integrator adds it to the scene.
  fog: { colour, near, far },        // suggested scene fog for this level
  ambient: { sky, ground, intensity }, // suggested HemisphereLight values (integrator creates it)
  start: { x, z, yaw },
  exit: { x, z, r },                 // walking into this circle after the last area is clear completes the level
  areas: [ {
    id,                              // 'stairwell', 'cloakroom', ...
    name,                            // 'THE COWGATE: CLOAKROOM'
    objective,                       // short HUD text, e.g. 'Clear the cloakroom'
    rect: { c0, r0, c1, r1 },        // inclusive tile rectangle; every walkable tile belongs to exactly one area
    spawns: [ { kind, x, z, yaw } ], // kind: 'fizzbang' | 'bampot' | 'bouncer'
    unlocks: [ doorId ],             // doors that open when this area's enemies are all dead (may be empty)
  } ],
  doors: [ { id, x, z, axis, open } ],  // axis 'x' = door slab runs along x (you pass through along z); 'z' = the reverse
  pickups: [ { id, kind, item, x, z } ], // kind 'weapon' (item: 'shotgun' | 'smg' | 'launcher') | 'health' (item: 'medkit')
  // queries (all 2D, in world units, height ignored):
  areaAt(x, z),                      // area object or null
  isSolidAt(x, z),                   // wall, pillar, closed door or low cover
  moveCircle(x, z, dx, dz, r),       // slide a circle of radius r by (dx, dz): returns { x, z, hit }
  raycast(ox, oz, dx, dz, maxDist),  // distance along the unit direction (dx, dz) to the first thing that stops a
                                     // bullet (full-height wall, pillar, closed door), or maxDist. Low cover does NOT stop bullets.
  los(ax, az, bx, bz),               // true if a straight line is not blocked by anything that stops bullets
  createFlowField(),                 // see below
  setDoorOpen(id, open),             // animates the door (slides or lifts over ~0.6s); solid until nearly open
  update(dt, time),                  // animates doors, flickering lights and neon
}
```

Flow field: `const ff = world.createFlowField(); ff.update(x, z)` runs a breadth-first search over walkable tiles from
the tile containing (x, z) (closed doors and low cover count as walls). `ff.dirAt(x, z)` returns a unit-ish
`{ x, z }` step towards the target (towards the neighbouring tile with the smallest distance; use diagonals only when
both adjacent orthogonal tiles are walkable), or `null` if unreachable or already in the target tile. `ff.distAt(x, z)`
returns the path length in world units or `Infinity`. It must be cheap: the level is small (about 40 x 50 tiles) and
`update` is called a few times a second.

Map format: build the level from an ASCII grid inside the module. Suggested legend (your choice, but keep it readable):
`#` wall, `.` floor, `P` pillar (solid, full height), `c` low cover (blocks movement and pathing, not bullets),
digits or letters for doors/spawns/pickups. Row 0 is the north edge.

Rendering requirements: walls, floor and ceiling are merged into a handful of meshes (build your own merged
`BufferGeometry` with only the faces that can be seen; **at most about 40 draw calls for all static level
geometry**). Dynamic lights: **at most 4 PointLights in the whole world group** (the integrator adds one more on the
camera). Neon strips, light fittings, screens and signs use `MeshBasicMaterial`, so they glow without costing lights.
Walls are REAL BRICK (a generated brick DataTexture with mortar, per-brick colour variation, grime), with stone,
whitewashed or painted sections, brick pillars and arches, timber beams and iron pipes. Neon is limited to two or three
classic bar signs. Props are physical: wooden bar, speaker cabinets, DJ booth, crates, coat rail. The level must read as a real room at a glance, not a grey box.

Level content (the Cowgate, a basement nightclub in Edinburgh, sticky floor and flashing lights). One linear route
through six areas, start to finish, each separated from the next by a door. Corridors about 3 tiles wide, rooms
bigger. Target size roughly 36 x 48 tiles. Use real turns and doorways so that line of sight is broken between areas.

1. `stairwell` (start, no enemies). Short concrete stairwell/entrance. Objective: 'Head into the club'. Its exit door
   starts open (set `open: true` in `doors`).
2. `cloakroom`: 2 x `fizzbang`. A shotgun pickup (`item: 'shotgun'`) in plain sight near the entrance.
3. `dancefloor`: the main room, large, with speaker stacks / pillars as cover and a DJ booth at the far end.
   4 x `fizzbang` and 1 x `bampot` (the bampot bot stands back, near the DJ booth). A `medkit`, and an `smg` pickup in a nook.
4. `bar`: a long bar counter (low cover) across the room. 2 x `bampot` behind the counter and 3 x `fizzbang`. A `medkit`.
5. `vip`: a long VIP corridor with a couple of booths. 2 x `fizzbang` midway and 2 x `bampot` at the far end. A
   `launcher` pickup at its start.
6. `backstage`: a big open room with an exit at the far end. 1 x `bouncer` (the boss) and 2 x `fizzbang`. A `medkit`
   by the entrance. `exit` is just past the far door.

Doors: the door at the end of each of areas 2 to 6 is listed in that area's `unlocks`, closed at the start. The door
out of the stairwell is open. Enemy spawns must sit on walkable tiles, not inside cover or against walls, at least
`1.2` units from any solid. Spread them out and face them sensibly (`yaw`). Enemies in an area should not be visible
from the previous area's doorway at the moment the door opens, except where you choose to show one deliberately.

## Module: `src/models.js` (owner: models agent)

Pure mesh builders and pose animation. All models face -z at yaw 0, origin at the feet (robots/pickups) or at the
hand grip (weapon viewmodels). Exports:

```js
export function makeRobot(kind) -> Robot          // kind: 'fizzbang' | 'bampot' | 'bouncer'
export function makeWeaponModel(id) -> THREE.Group  // first-person viewmodel
export function makeWeaponPickup(id) -> THREE.Group // floor pickup
export function makeHealthPickup() -> THREE.Group
export function makeProjectile(kind) -> THREE.Group // kind: 'bottle' (enemy shot) | 'rocket' (player launcher)
export function makeMuzzleFlash() -> THREE.Object3D  // small additive flash, hidden/shown by the integrator
export function makeImpact() -> THREE.Object3D       // small spark burst mesh for bullet impacts (scaled and faded by the integrator)
export const WEAPON_IDS = ['pistol', 'shotgun', 'smg', 'launcher'];
```

`Robot`:

```js
{
  group,            // THREE.Group, origin at the feet, facing -z
  height,           // total height in world units (fizzbang ~2.1, bampot ~2.0, bouncer ~3.3)
  radius,           // collision radius (fizzbang 0.55, bampot 0.5, bouncer 0.95)
  headY,            // y above which a hit counts as a headshot
  eyes,             // array of the glowing eye meshes (so the integrator can brighten them when alerted)
  setPose(state, t, k),  // state: 'idle' | 'walk' | 'windup' | 'swing' | 'aim' | 'shoot' | 'hurt' | 'dead'
                         // t = seconds since the state began, k = 0..1 progress through timed states
                         // (windup, swing, shoot, dead). Must be safe to call every frame with any values.
  flash(on),        // true = tint the whole robot white for a hit flash, false = restore
}
```

Look of the robots (they are enemies of a dark-comedy Edinburgh game, so they should be funny and menacing, built
from simple primitives: boxes, cylinders, spheres, cones):

- `fizzbang` ("Dr Fizzbang bot", melee only): a tall cylindrical can-shaped body in dark maroon with a silver rim and
  a lighter band, a boxy head with a visor and two glowing orange-red eyes, thick pneumatic piston arms ending in
  big fists, short stubby legs that actually walk (alternate swing). Swing = one arm raised then slammed down.
- `bampot` ("Bampot and Nephew bot", can shoot): a tall bottle-shaped body (wide base, narrow neck) in off-white/cream
  with a dark label band, a head that is the bottle neck with a cap, glowing cyan or yellow eyes, one arm replaced by
  a short cannon barrel. `aim` raises the cannon, `shoot` recoils it.
- `bouncer`: a large, wide `fizzbang` variant: black "dinner jacket" slab shoulders, a bow-tie-shaped detail, earpiece
  light, bigger fists. Same states.
- No logos, no lettering, no copies of real packaging. Evoke only: colour, silhouette, silliness.
- ≤ 12 meshes per robot. Shared geometries and materials via module-level caches (clone materials only if you need
  per-robot `flash`, preferably by swapping material references on a flag instead of cloning per frame).
- `dead`: a collapse/fall-apart animation over k = 0..1 (topple, parts offset, sparks not required) ending with the
  group lying flat or sunk, so the integrator can fade/remove it after k reaches 1.

Weapons (viewmodels are held low-right in first person, barrel pointing -z, about 0.55 units long, with a child
`Object3D` named `muzzle` at the barrel tip, in the model's local space). They are bass-music themed:
`pistol` = "Bass Pistol" (compact, cyan lit), `shotgun` = "Subwoofer Shotgun" (chunky, speaker cone on the muzzle, pump),
`smg` = "Tweeter SMG" (slim, long magazine, small speaker grille), `launcher` = "Reverb Launcher" (fat tube, big cone
horn, magenta lit). Pickups use the same model scaled up, mounted on a small glowing ring/plinth, origin on the floor,
bobbing handled by the integrator. `makeMuzzleFlash()` is a star/cone in additive-blended yellow-white, about 0.3 wide.

## Module: `src/hud.js` and `src/screens.js` (owner: UI agent)

All 2D canvas drawing (a transparent canvas lies over the 3D view). Use `text`, `rrect`, `heart`, `drawSkyline`, `hash`
from `src/draw.js` (import them; do not modify that file). Reference for the existing menu look and wording: the 2D
game's `src/game.js` (read only; it will be replaced). `view` is `{ w, h, dpr, safe: { top, bottom } }` in CSS pixels.

### `src/hud.js`

```js
export function layout(view) -> {
  moveBox, lookBox,        // grey control boxes, each { x, y, w, h }
  reloadBtn, swapBtn,      // small buttons under lookBox and moveBox respectively
  moveHit, lookHit,        // the boxes inflated by 24px each side: where a touch may START to count
  reloadHit, swapHit,      // the buttons inflated by 10px
}
export function drawPlayHud(ctx, view, h)
```

Layout: box size `clamp(min(view.w * 0.4, view.h * 0.24), 120, 180)`, square. Boxes sit in the bottom corners, 16px
from the side edges (plus nothing for safe areas on the sides), with their bottoms at
`view.h - view.safe.bottom - 62` so the buttons fit under them: buttons are `0.7 * size` wide, 38px tall, centred
under their box with a 10px gap. Everything must fit a 360 x 640 phone and a 430 x 932 phone.

`drawPlayHud` draws, from a state object `h`:

```js
h = {
  health, maxHealth,                 // numbers (100 / 100; debug mode doubles both)
  hurt,                              // 0..1 red edge vignette strength
  damageDirs: [ { bearing, t } ],    // bearing in radians relative to view: 0 ahead, +PI/2 to the right; t 1 -> 0 fades
  weapon: { id, name, clip, clipSize, reload },  // reload: null, or 0..1 progress while reloading
  weapons: [ { id, name, owned, active } ],
  hitMarker,                         // 0..1 crosshair hit flash; headshot: boolean tints it
  headshot,
  toast,                             // { text, t } or null (small line near the top, fades with t seconds left)
  banner,                            // { title, sub, t, max } or null (big centre text, fades out)
  objective,                         // string, e.g. 'Clear the cloakroom'
  enemiesLeft,                       // number left in the current area (0 shows 'Area clear, go through the door')
  areaName,
  boss,                              // { name, hp, maxHp } or null
  score, timeSec,
  debugMode,                         // true: small amber DEBUG MODE badge
  move: { active, nx, ny },          // knob offset inside the move box, each -1..1
  look: { active, nx, ny },          // finger position inside the look box, each -1..1 (clamped)
  firing,                            // true while the right thumb is down
}
```

What it shows: the two grey boxes, semi-transparent mid grey (clearly visible over bright and dark scenes, with a faint
border and corner ticks, and a faint label: 'MOVE' / 'AIM + FIRE'). A knob in the move box that follows `move`; a dot
in the look box that follows `look`; the look box glows cyan while `firing`. RELOAD under the right box (pulses when the
clip is empty; shows a progress fill while reloading), SWAP under the left box. A crosshair at screen centre (small,
precise, gap in the middle; flashes on `hitMarker`, differently for `headshot`). Health bar top left with the number.
Ammo bottom centre between the boxes: weapon name, then `clip / ∞`. A compact row of weapon icons/names near the top
right (owned ones lit, active one highlighted, unowned dim). Objective and area name top centre; the boss bar under the
top row when `boss` is set. Directional damage arcs around the crosshair from `damageDirs`. Red vignette from `hurt`.
It must remain legible in a 360 x 640 viewport and not cover the middle of the screen.

### `src/screens.js`

```js
export function buttons(mode, view, state) -> [ { id, label, x, y, w, h, primary, accent } ]
// mode: 'title' | 'controls' | 'dead' | 'complete'. Hit testing in the game uses these exact rectangles.
export function drawTitle(ctx, view, state)      // state: { t, debugMode, best }
export function drawControls(ctx, view, state)   // state: { t }
export function drawIntro(ctx, view, state)      // state: { t, level: { number, name, sub, line, clock } }
export function drawDead(ctx, view, state)       // state: { t, line, score, best, newBest, debugMode, levelName }
export function drawComplete(ctx, view, state)   // state: { t, score, best, newBest, timeSec, kills, totalEnemies, debugMode }
```

Button ids: title: `new` (primary, 'NEW GAME'), `debug` ('DEBUG MODE: ON/OFF', small, amber accent when on, with the two
explanatory lines "2x fire rate, 2x damage, 2x health" and "Scores are not recorded" under it when on). controls: `start`
('START GAME', primary) and `back` ('BACK', small). dead: `retry` ('RETRY LEVEL', primary, only once `state.t > 0.9`),
`menu` ('MAIN MENU'). complete: `again` ('PLAY AGAIN', primary), `menu` ('MAIN MENU'), shown once `state.t > 1`.
`buttons` must take `state` so it can apply those delays and the debug label. Keep the existing look: title text
"FREDDIE'S" magenta over "LAST SET" cyan, the skyline and moon on the title, "Edinburgh. 2am. Everyone is dead." Add the line
"Level 1: the Cowgate" on the title. All screens are drawn over a live 3D scene, so use translucent dark overlays, not
opaque backgrounds, except the title which should be a heavier dim (about 0.55) so the 3D club shows through.

The controls screen must teach the new scheme with animated diagrams: a grey box with a knob moving (MOVE, left thumb);
a grey box with a finger dot dragging and blast arcs (AIM AND FIRE, right thumb: "Hold to fire. Drag to aim. There is no
aim assist."); the RELOAD button ("Reloads on its own when the clip is empty. Tap RELOAD to do it early. Ammo is
unlimited, clips are not."); the SWAP button ("Walk over weapons to pick them up. SWAP cycles them."); and a tip line:
"Clear every robot in an area to unlock the next door." Must fit 360 x 640 and 430 x 932.

Test with a harness page that fakes a canvas and states (see `scripts/harness/` for the pattern) at 390 x 844, 360 x 640
and 430 x 932, and look at the screenshots.

## Integrator's side (not for module owners)

`src/game3d.js` owns the state machine, player, weapons and ammo, enemy AI, projectiles, pickups, the three.js
renderer, scoring, debug mode and wiring to the modules above. `src/engine.js` is adapted to pass touches in the
new scheme. Module owners never need to touch these.
