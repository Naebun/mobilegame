# Textures

Brick, painted brick, stone, flags, boards, ceiling plaster and concrete are baked in Blender and shipped as WebP files in
`assets/textures/`. Carpet is still generated in code. The generated textures (`genBrick` and friends in `src/world.js`) stay as
the fallback for the low tier, every headless test and any failed load. This is the outcome of option D then C in
`docs/texture-options.md`. Numbers below are measured on this branch unless marked as an estimate.

## What is shipped

| Surface | World scale (m per UV unit) | Baked image (m covered) | Files | Bytes |
| --- | --- | --- | --- | --- |
| brick | 0.9 | 1.8 x 0.9, 1024 x 512 | albedo, normal, rough | 77 818 + 158 112 + 14 806 |
| paint (whitewashed brick) | 0.9 | as brick | albedo only; normal and rough are brick's | 80 372 |
| stone | 1.2 | 1.2 x 1.2, 512 x 512 | albedo, normal, rough | 31 774 + 46 868 + 6 622 |
| flag | 2.0 | atlas of 2 layouts, 4 x 2, 1024 x 512 | albedo, normal, rough | 57 198 + 102 178 + 16 522 |
| boards | 1.6 | 1.6 x 1.6, 512 x 512 | albedo, normal, rough | 13 186 + 82 966 + 7 798 |
| floorboards | 1.6 | as boards | none: boards' maps with a 0.78 colour multiplier | 0 |
| plaster (every ceiling) | 2.0 | atlas of 2 variants, 4 x 2, 1024 x 512 | albedo, normal, rough | 40 798 + 102 308 + 7 372 |
| concrete (backstage floor) | 2.4 | 2.4 x 2.4, 512 x 512 | albedo, normal, rough | 27 112 + 60 154 + 4 606 |

19 files, 938 570 bytes (917 KB) in all, against a budget of about 1.3 MB. The first pass was 13 files, 608 384 bytes; plaster,
concrete and the second flag layout added 330 186 bytes (322 KB). Not baked: carpet (see below).

**Why plaster first.** Measured on screen, not guessed (`coverage.mjs`, a scratch script: it paints every mesh one flat colour per
surface, renders first-person views from 40 random open positions at medium, counts pixels; portrait 390 x 844, landscape in
brackets). Plaster is only ever the ceiling, in both levels, and it is the biggest single surface in both: level 1 31 per cent
(27), level 2 34 per cent (29). No wall in either level is plaster: walls are brick, painted brick, stone or boards.

| Level | Largest surfaces, share of the frame, portrait |
| --- | --- |
| 1 (the Cowgate) | plaster ceiling 31, brick 12, floor boards 10, painted brick 9, stone 8, flags 8, concrete 7, boards 4, carpet 1.5 |
| 2 (the Vaults) | plaster ceiling 34, flags 32, stone 16, brick 8, painted brick 5, boards 4 |

By area in level 1: concrete is 33 per cent of the frame in the backstage (boss room) and 0 elsewhere, carpet is 20 per cent of the
VIP corridor and 1.5 overall. Concrete was baked (backstage is the boss fight, and the cost is 92 KB). Carpet was not: a
patterned rug in one corridor, 1.5 per cent of the game's pixels.

Packing, and why. Albedo is lossy WebP quality 82, sRGB. Normal is lossy quality 90 (chroma subsampling blurs the red and
green of a normal map a little, so it gets the higher setting; the decoded mean in the smoke test is (127, 127, 243), a flat
tangent-space normal). Roughness is a grey image at half the size, quality 80, read by three.js from the green channel; at
that size it is 4 to 17 KB, so packing it into another map's alpha (lossless in WebP, so large) or colour channels (the
chroma blur would corrupt it) saved nothing worth the shader work. Occlusion is not a file: the cavity occlusion is multiplied
into the albedo, because the level already bakes its own occlusion and light into vertex colours, and a separate map would
only act on ambient light. Painted brick and floorboards borrow maps (`share` in `src/textures.js`), so they cost one
albedo file and nothing.

## Atlases: plaster and flags

A 2 m tile repeating every 2 m shows. The ceilings are the worst case: the Long Vault and Mary King's Close are 60 to 76 m by
10 m and the generated plaster had one dark damp blotch per tile (a row of identical blotches). A flag floor of nine slabs
shows a regular three-course rhythm. So these two textures are atlases, 1024 x 512, two 512 px tiles side by side
(`CEIL_VARIANTS` and `FLAG_VARIANTS` in `src/consts.js`).

- **world.js gives each ceiling or floor tile one variant** through `Mesher.off`, the same UV offset the brick walls use: the
  offset puts that tile's texture coordinate on `[k, k + 1]` for variant k, a whole number of tiles, and the manifest repeat is
  `1 / variants`. The generated texture is one tile wide, so it ignores the offset: geometry does not depend on whether baked
  textures have arrived, and a world built before the swap needs no rebuild. The variant is `floor(ihash(c, r) * N)`; the
  bare `hash` is parity-biased and would give a chessboard.
- **Plaster variants share one background** (trowel pads, pits, grain, soft stains: the same seeds) and each has its own cracks,
  chips, patches and damp stains, all kept 14 cm clear of the tile edge. So any two variants join without a seam, and a mip
  level that bleeds across the atlas cell border blends two identical backgrounds.
- **Flag variants are two layouts** that both start a slab at x = 0 and fill the row to 2 m, so a joint runs along every tile
  edge; where two variants meet the courses jog, which is how flagging looks. Each variant has its own noise (a seed offset).
- **Calibration is over the whole atlas** (one gain), so the variants keep the same brightness.
- Cost of the atlas against a single tile: plaster +1 tile (about 75 KB), flags +1 tile (88 KB), GPU +3 MB each (estimate).
- `textures-check` asserts the atlas sizes and, for both levels and both baked tiers, that every ceiling and flag tile's u is
  its own tile plus a whole-tile offset, inside `0..N`, and that all variants are used.
- Concrete is not an atlas. Its expansion joints sit on the tile edge, and a 2.4 m UV unit does not line up with the 2 m floor
  tiles, so a per-tile variant would need a 2.0 m slab (a change to the generated fallback too). The repeat shows less than
  before (see Tiling) but is still there.

## How it is made (`scripts/blender/textures.py`)

`~/.venvs/blender/bin/python scripts/blender/textures.py [--only brick,flag,plaster,concrete] [--debug DIR]`. The default is
all six (painted brick comes out with brick). There are two kinds of surface.

**Block surfaces** (brick, flag, stone, boards):

1. **Geometry.** Every brick, stone, flagstone or plank is a small mesh: a grid with lines packed into the bevel, a rounded
   arris (radius varies per stone), an uneven face (per-block height and tilt plus slow undulation), a wobbling edge, and chips
   knocked out of corners. Joints are one plane that varies in depth, some deep and some nearly flush. Colour, roughness and a
   mask (joint, chip, per-block random) are per-vertex attributes. The layout copies the generated texture's (4 by 12 bricks
   becomes 8 by 12, flags and stone as before), so wall styles and tints keep meaning what they meant.
2. **Tiling.** Nine copies of the tile are laid out and only the centre is baked, so occlusion and bevels run across the seam
   and the result tiles exactly. All noise is tileable (value noise on a wrapping lattice), because Blender's noise nodes do
   not tile.
3. **Bake.** Cycles on the CPU, selected-to-active onto a flat target quad: diffuse colour, tangent normal, emission (the
   mask), roughness at twice the final size (4 samples a pixel, then averaged down; normals averaged and renormalised), and
   ambient occlusion at the final size with 32 samples.
4. **Detail in numpy.** Grain, pits, sooty patches, drips, damp, pale salts (brick, stone, flags), wood grain, knots and
   scuffing (boards), micro relief added to the normal, the gentle slopes of the baked normal lifted (they are real but
   invisible at 1:1), wet and polished patches on the flags. Then albedo is scaled so its mean matches the old generated
   texture's, because the level's exposure and tints were set against those.
5. **Encode.** Through a byte image in Non-Color so nothing is colour-transformed, as WebP.

**Field surfaces** (plaster, concrete; `run_field`, `plaster_field`, `concrete_field`). One continuous skin rather than
blocks. The surface is a heightfield on a periodic grid (2.5 mm for plaster, 3 mm for concrete, about 0.8 million vertices),
so it tiles exactly; the grid is wrapped into a 14 cm margin, meshed and baked exactly as above (same bake calls, same
supersampling, same calibration). What is modelled as geometry:

- plaster: trowel pads (a Voronoi of tilted planes with soft ridges where one pad meets the next, plus slow waves), blown-lime
  pits, hairline cracks (wandering V-grooves from 4 to 6 mm wide at the mouth, tapering, with branches), chips where the plaster
  has come off to show brick or lath (steep walls, a crumbled lip, irregular outline), raised repair patches (some with a hairline
  gap round them), damp stains with a dark tide line, and a grey bloom of soot. Everything except the stains' colour and the
  soot is real relief, so the occlusion in the cracks and chips comes from Cycles.
- concrete: low trowel waves, air holes, expansion joints on the tile edge (a groove with a chamfer each side), hairline cracks,
  oil, damp and polished boot-track patches (these change roughness as well as colour), and worn skin where the grit shows.

Then the numpy pass adds grain, dark flecks, pale lime lumps, trowel stripes and sand in the micro relief, and the calibration.

**Reproducible.** Fixed seeds, no thread-dependent code. Plaster, concrete and flags were baked three times in separate processes
(the files in `assets/textures/` and two fresh runs into scratch directories); all nine files compared byte-identical with
`cmp`. Brick, stone and boards were not rebaked in this pass (their code is unchanged and the seed offset is 0 for them), so
their files are the ones from the first pass, which were compared three times then. This holds for this Blender (bpy 5.2.3)
and its bundled libwebp; a different bpy build may encode differently.

**Build time.** Plaster 2 variants: 89 to 154 s (two bakes of 36 to 74 s each; the spread is the other engineer's work running
on the same 4 cores). Concrete: 41 to 95 s. Flags, two layouts: 28 to 44 s. The three together, from a cold start: 221 s and
174 s in two runs (with a browser test running in one of them). The first pass's brick (170 to 215 s), stone and boards are
unchanged, so the whole set is still about 8 to 10 minutes. The bake is a one-off; nothing runs at build time for the game.

## Conventions that are easy to get wrong

- **Colour space.** Albedo is sRGB (`texture.colorSpace = SRGBColorSpace`); normal and roughness are linear data
  (`NoColorSpace`). Checked in the smoke test.
- **Normal orientation.** Tangent space, OpenGL (+Y up, green is v): Blender's bake gives that, the file's first row is the top
  (v = 1), `THREE.Texture` has `flipY = true`, and three.js r160 builds its tangent frame from UV derivatives, so no flip or
  swizzle is needed. Seen to light correctly in screenshots (edges catch light from the right side), but this is a visual
  check, not an assertion. On a ceiling the normal faces down and the tangent frame still comes from the UVs; the plaster
  looked right from below in the screenshots.
- **Repeat.** `texture.repeat = scale / tile` (brick: 0.5 by 1; plaster and flags: 0.5 by 1 because the image is two tiles
  wide). The Mesher's UV scale is untouched, so the generated texture and the baked one drop into the same geometry.
- **Tints.** Level 2's darker tints are vertex colours that multiply the map, so they work unchanged on baked albedo.
  Plaster, concrete and flags are calibrated to the mean sRGB of the generated texture they replace (plaster 107.6, 97.4, 85.2;
  concrete 104.8, 104.8, 102.6; the smoke test decodes them and checks 107 98 85 and 105 105 103).
- **Mip maps and anisotropy.** Default trilinear mip chain from three.js, anisotropy 4, as the generated ones.
- **No leaks.** `world.retexture` disposes the generated textures it replaces; `world.disposeTextures()` (called when a level
  is replaced) disposes a world's own generated textures and leaves baked ones alone, because they are shared between levels.

## How it reaches the game

- `world.js` is still DOM-free and loads nothing. `buildWorld({ baked })` uses finished textures for the surfaces it is given
  and does not generate those. `world.retexture(sets)` swaps them into a built world (medium and high only; low is Lambert with
  no normal or roughness maps). `world.bakedNames` lists what is baked.
- `src/textures.js` (DOM allowed) fetches the files in parallel, decodes them (`Image.decode()`, off the main thread), makes
  textures, and resolves with whatever loaded. A surface whose files failed is simply absent. It never rejects.
- `game3d.js` starts loading after the renderer is up, on medium and high only. When the files have arrived it swaps them into
  the current world at the next moment nobody is playing (title, menus, death, level end; immediately under `?test`), uploads
  them to the GPU then (`renderer.initTexture`), and passes them to every level built afterwards, which also skips generating
  those surfaces. The game never waits: it starts on the generated textures.
- `?baked=0` keeps the generated textures (for before and after screenshots). `testHook('baked')` reports the state.
- **Offline.** `sw.js` precaches the 19 files and the two modules (cache `mobilegame-v10`).
- **Artifact.** `npm run build:artifact` inlines the files as base64 data URIs through an esbuild plugin that replaces
  `src/textures-inline.js`: 4.43 MB for the whole page, 1.22 MB of it textures (3.2 MB without; `NO_TEXTURES=1` builds that).
  Checked by opening the built file over file:// with `?test`: all eight surfaces swapped in, no page errors.

## Cost

| | Measured or estimated |
| --- | --- |
| Extra bytes over the wire, first visit | 917 KB in all (measured), 322 KB of it new in this pass; then cached by the service worker |
| Artifact size | 4.43 MB with textures, 3.20 MB without (measured) |
| GPU memory for the baked maps | 29.7 MiB (estimate: RGBA8 plus a third for mips, every texture counted once; the smoke test prints it). It was 17.7 MiB before this pass: plaster atlas +6.3, concrete +3.1, the second flag layout +3.1 |
| GPU memory freed by the swap | the eight generated surfaces: about 11.5 MB at medium, 19.5 MB at high (estimate) |
| Net GPU memory | about +18 MB at medium, about +10 MB at high over the all-generated build (estimate) |
| Level build time in Node | less once baked textures exist, because those surfaces are not generated (measured on the first pass, 0.4 to 0.8 s; not re-measured) |
| Frame time | not measured usefully (see below) |

**Frame rate in software WebGL: no usable measurement.** On the first pass `tier-fps.mjs` gave 0.1 to 0.6 fps for every
combination with no consistent order while three engineers were using the same 4 cores. It shows nothing but that the machine was
busy, and it was not repeated. A fair comparison needs a quiet machine, and even then it would be CPU-bound.

**Unknown, and worth stating plainly:** decode time, GPU upload time, memory and frame rate on an A15 phone. Nothing here was
seen on a phone. Three new maps are 1024 x 512 (plaster albedo and normal, flag albedo and normal) and brick is too, so the
ceiling and floor, which are most of the screen, now sample bigger textures than before. If 30 MB of texture memory is too
much for a medium-tier phone, the first thing to try is dropping the plaster atlas to one variant (-6 MB), then the flag atlas
(-3 MB); both are one constant in `src/consts.js` plus a rebake. WebP decode in Safari has not been tested.

## Verdict, from screenshots

Medium tier, portrait (390 x 844) and landscape (844 x 390), both levels, HEAD against this branch, from `game-views.mjs` (real
game, torch on in level 2), `world-views.mjs` (camera light, every door open, so the ceilings are lit), `level-tour.mjs` and
`screen-views.mjs`. Honest summary: **better where you can see it, and you often cannot.**

- **Ceilings under good light (world-views, the lit rooms of the Cowgate): clearly better.** The generated plaster was a
  smooth tan field with one blurred dark blotch per tile, repeating in a row. The baked plaster has hairline cracks, damp
  stains with tide lines, chips showing brick, repair patches, pits and trowel relief that catches the light. Different tiles
  look different. The chips came out slightly cartoonish (small dark-red holes with a chalky edge) and were made smaller and
  rarer after the first look.
- **Ceilings in the real game: nearly invisible, before and after.** The Cowgate ceiling is a dark brown sheet in
  `game-views` except directly under a light, and in the Vaults the torch lights a disc about a metre across on the ceiling
  and nothing else: plaster only reads when the player looks up into that disc (one crack and a chip were seen there, in one view; the
  other views showed a plain lit disc). Level 2 is very dark now (the grade lift is gone and the ambient is low), so the new
  plaster, like the previous texture pass, mostly cannot be seen in the dark. The torch with a wall torch close by shows
  brick walls and flags well and the ceiling faintly.
- **Flag floors: better, modestly.** The two layouts remove the regular three-course rhythm; the courses jog and the slab tones
  no longer repeat every 2 m. In the long Vaults corridor and the Cask Cellar, before, the same pattern marched away from the
  camera; after, it does not. Under the torch the floor reads about as before (wet slabs glint).
- **Concrete (backstage): better.** The generated floor was a pale grey with dark blotches repeating every 2.4 m. The baked one
  has slab joints, a few soft stains, air holes and hairline cracks. The one slab still repeats every 2.4 m, but with two
  soft stains and a joint, not one dark blot, it is less obvious. The backstage is also dark in the game.
- **Not changed from the first pass:** brick, painted brick, stone, boards.

What we would change next: (1) the dark. The new plaster and the earlier baked textures are wasted where nothing lights them, so
the real lever for how the Vaults look is lighting (a wider or brighter torch cone, a faint cold ambient on the ceiling) and not more
texture, and that is the owner's call; (2) a second concrete variant on a 2.0 m slab if the repeat bothers anyone; (3) the floor
boards (1.6 m, one tile) repeat visibly in the dance floor and the bar, and want the same two-layout treatment; (4) everything on
a phone. We would not bake carpet.

## Tiling

Checked with `world-views.mjs` from a corner and down the length of each space, before and after, in landscape: the Long Vault
and Mary King's Close ceilings and floors, the Cask Cellar and Plague Cellar floors and ceilings, the Cowgate dancefloor, bar and
VIP ceilings, the backstage floor.

- **Brick**: unchanged from the first pass. 1.8 m tile, fewer outlier bricks, a per-face vertical offset (`Mesher.off`).
- **Plaster ceilings**: with one 2 m tile the repeat would have shown (the old generated blotch did). With the two-variant
  atlas, random per tile, no regular repeat showed in the Long Vault, the Close, the Plague Cellar or the Cowgate rooms. Two
  variants is the minimum: you can find the same crack twice in a view of a large ceiling if you look, because there are only
  two. The features are a few per tile, so it reads as a few cracks, not a pattern. A third variant would cost about 75 KB
  and 3 MB of GPU memory.
- **Flags**: a 2 m repeat did show on the big floors (Cask Cellar, Long Vault) as a rhythm of three courses. Fixed with the
  second layout; cost 88 KB on the wire, +3 MB of GPU memory (estimate), 28 to 44 s of bake.
- **Stone** (1.2 m): not seen to repeat on any wall in either level. Not changed.
- **Concrete**: the repeat every 2.4 m shows in the backstage when you look for it (the stains and cracks line up); it is
  softer than before, and joints between slabs make a repeat look natural. Not fixed.
- **Floor boards** (not in this pass): the 1.6 m repeat of the generated and baked floor boards shows on the dance floor. Left alone.

## If you change it

Edit `scripts/blender/textures.py` (the `SPECS` table holds the numbers: arris radius, joint depth, unevenness, grain, boost,
palette targets, and for plaster and concrete the variant list with seeds and feature counts), rerun it, copy nothing by hand
(it writes straight into `assets/textures/`), update the sw.js list if files were added, and run
`node scripts/harness/textures-check.mjs`, which fails if the file list, the manifest in `src/textures.js` and `sw.js` disagree
or the atlas arithmetic is off. Adding a surface: add a block layout or a field function and a `SPECS` entry, an entry in
`BAKED`, and use `world.js`'s `textured(name)` slot. To change the number of plaster or flag variants, change `CEIL_VARIANTS` or
`FLAG_VARIANTS` in `src/consts.js`, add or remove entries in the `variants` list (plaster) or the layouts in `flag_blocks` and
`nvar` (flags), and rebake. Carpet would be the next surface.
