# Graphics pass: polished stylised, generated in code

Goal (owner's words: "more modern than they currently are"): a polished stylised look, like a good modern indie game,
not photographs. Everything is still generated in code: no image files. Level 1 (the Cowgate) only for now. This
document is the contract between the renderer (integrator), `src/world.js` (world agent) and `src/models.js`
(models agent). The API of both modules stays as in `docs/fps-design.md` except where this file says otherwise.

## Device floor and budgets

Target: any iOS device from the past four years (iPhone 14 / A15 and newer, iPads of the same age). Safari 16, WebGL 2.
Nothing can be measured on a real phone here, so budgets are conservative guesses:

- Static level: at most 40 draw calls and **130k triangles**. Level build (Node, `buildWorld()`): under 1.5 s on this
  machine, which is a proxy; the phone will be slower, so keep generation loops tight (typed arrays, no per-pixel
  closures or allocations).
- At most **4 dynamic point lights** in the world group (plus one on the camera). No shadow maps.
- Everything must still run under plain Node, no DOM, no canvas. Textures are generated `THREE.DataTexture`s.
- Quality ladder: `buildWorld({ quality })` takes `'high' | 'medium' | 'low'` (default `'high'`). Texture size:
  high 512, medium 384 (use 512 generation downsampled, or generate at 384; your call), low 256. Low must cost
  about what the current game costs.

## Colour pipeline (renderer side, so you know what you are feeding)

The scene is rendered in linear light into a half-float target, then a post pass does bloom, filmic tone mapping,
vignette and grain. So:

- Diffuse colours given as hex are fine (three converts sRGB to linear). Albedo `DataTexture`s: set
  `texture.colorSpace = THREE.SRGBColorSpace`. Normal and roughness maps: leave as no colour space.
- **Emissive and glowing parts must use HDR colours** so they bloom: `new THREE.Color(0xffc080).multiplyScalar(3)`
  on a `MeshBasicMaterial` (bulbs, lamp shades, robot eyes, indicator lamps, neon, muzzle flash). Typical power 2 to 6.
  Do not clamp. Ordinary surfaces stay at normal 0 to 1 values.
- `scene.environment` is set by the renderer (`src/gfx-env.js`, a procedural dark warm room), so
  `MeshStandardMaterial` metals and glossy surfaces get reflections. In your own harness, create it with
  `makeEnvironment(renderer)` and set `scene.environment`, set `renderer.toneMapping = THREE.ACESFilmicToneMapping`, and
  use warm dim lights, so your screenshots look like the game.

## For the world agent (`src/world.js`)

Make level 1 look modern while keeping every API point, the geometry queries and all existing tests passing
(`scripts/harness/world-check.mjs`; extend it where useful).

1. **Physically based materials.** Use `MeshStandardMaterial` for brick, stone, boards, plaster, concrete, carpet,
   metal and timber, with sensible `roughness` and `metalness`. Wet or polished parts (dance floor boards, puddles,
   bar top) are glossier.
2. **Procedural normal maps** (and roughness maps where it helps) for brick, stone blocks, flagstones, boards,
   plaster, concrete, carpet. Derive them from the same height data you use for the albedo, so mortar lines sit
   recessed, bricks are slightly domed, chips and cracks catch the light. This is the biggest single visual gain.
   Mipmaps on, anisotropy 4 where supported (set `texture.anisotropy = 4`).
3. **Baked ambient occlusion in vertex colours.** Darken wall bases, wall-to-wall corners, floor edges, areas under
   beams, behind pillars, archway reveals. To get smooth results, subdivide big floor and wall faces enough (but watch
   the triangle budget). It must be free at run time.
4. **Baked coloured light pools.** The level is lit by 4 real lights, but a club has dozens of sources: pendant lamps,
   wall lights, stage lights, the bar's back lights, neon, exit signs. Bake those into the vertex colours of the static
   geometry as soft warm, amber and red pools with falloff, with occlusion so light does not leak through walls
   (use tile-level visibility, e.g. a cheap raycast from each baked light to the tiles in its radius, then look vertices
   up by tile). The baked term multiplies or adds to the albedo as you judge best. The 4 real lights then add moving
   and flickering highlights on top.
5. **Atmosphere in the geometry.** Soft light shafts under lamps and stage lights (additive cones or planes with a
   vertical gradient, `depthWrite: false`, HDR-ish but faint), a mirror ball that throws moving light spots over the
   dance floor walls (animated in `update(dt, time)`), flickering lamps, hanging chains and cables with slight sway,
   steam from a pipe, a faint ground haze plane or fog bands. Cheap and tasteful, not noisy.
6. **Detail and wear.** Grime streaks, water stains, damp patches near the floor, peeling paint, scuffed floors,
   bullet-hole-ready flat spots are fine. Posters, bottles on the back bar, glasses, barrels, crates, cable runs, vents,
   pipes with highlights. Proportions should feel real (doors, bar height, ceiling).
7. Suggested ambient and fog may change: return updated `fog` and `ambient` values (the renderer reads them), and add
   `world.look = { exposure, bloom, vignette, grade: { lift, gamma, gain } }` with your recommended starting values
   for the post pass (exposure around 1.0, bloom strength around 0.5, vignette around 0.35). The renderer treats these
   as hints.
8. Final report: triangle count, draw calls, lights, build time in Node for each quality tier, and screenshots paths.

## For the models agent (`src/models.js`)

Keep the API, states, sizes (heights, radii, `headY`) and `muzzle` / `spin` extras.

1. **Physically based materials** (`MeshStandardMaterial`): scuffed painted metal, chrome, rubber, rust. Vertex-colour
   wear (darker towards the floor and in crevices, lighter on edges) is encouraged, as is per-robot slight variation.
2. **Smooth, bevelled forms.** Use smooth shading (computed vertex normals) with bevelled or rounded boxes and capsules,
   not flat-shaded primitives. More parts are allowed: **up to 16 meshes per robot**. Add detail that sells the
   character: pistons and hoses with highlights, vents, bolts, a dented panel, rubber collars, a visible coin slot and
   buttons on the Fizzbang, a label and cap on the Bampot, the Bouncer's jacket lapels and bow tie.
3. **HDR emissive** eyes and indicator lamps (see colour pipeline), so they bloom. Eyes should flicker slightly.
   `robot.eyes` stays an array of meshes whose material colour the integrator may brighten.
4. **Animation polish.** More follow-through (overshoot on the swing, recoil, flinch), subtle idle breathing and
   head tracking is not needed. Keep `setPose` safe for any inputs as today. If it helps, expose an optional
   `robot.update(dt)` for self-running details (steam puffs, eye flicker, hose sway); the integrator will call it if present.
5. **Weapon viewmodels:** higher detail and PBR materials (scuffed steel, black rubber, wood, tape, brass, paper
   speaker cones with chrome rims), small HDR indicator lamp. Keep muzzle positions and the `muzzle` / `pump` names.
   Pickups: a glowing floor ring (HDR) with the item floating above it.
6. **Effects:** `makeMuzzleFlash`, `makeImpact`, projectile meshes: HDR and additive so they bloom. The bottle's
   burning rag and the rocket's flame trail should glow.
7. Keep geometry and materials shared per kind; the whole robot roster (about 19 robots) must stay cheap.
8. Final report: mesh and triangle counts per robot, anything the integrator needs.
