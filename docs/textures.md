# Textures

Brick, painted brick, stone, flags and boards are baked in Blender and shipped as WebP files in `assets/textures/`. Carpet,
concrete and plaster are still generated in code. The generated textures (`genBrick` and friends in `src/world.js`) stay as
the fallback for the low tier, every headless test and any failed load. This is the outcome of option D then C in
`docs/texture-options.md`. Numbers below are measured on this branch unless marked as an estimate.

## What is shipped

| Surface | World scale (m per UV unit) | Baked tile (m) | Files | Bytes |
| --- | --- | --- | --- | --- |
| brick | 0.9 | 1.8 x 0.9, 1024 x 512 | albedo, normal, rough | 77 818 + 158 112 + 14 806 |
| paint (whitewashed brick) | 0.9 | as brick | albedo only; normal and rough are brick's | 80 372 |
| stone | 1.2 | 1.2 x 1.2, 512 x 512 | albedo, normal, rough | 31 774 + 46 868 + 6 622 |
| flag | 2.0 | 2.0 x 2.0, 512 x 512 | albedo, normal, rough | 28 488 + 51 062 + 8 512 |
| boards | 1.6 | 1.6 x 1.6, 512 x 512 | albedo, normal, rough | 13 186 + 82 966 + 7 798 |
| floorboards | 1.6 | as boards | none: boards' maps with a 0.78 colour multiplier | 0 |

13 files, 608 384 bytes (594 KB) in all, against a target of about 2.5 MB. Not baked: carpet, concrete, plaster. They are
soft low-frequency surfaces (generated at 256 px) and a baked version would show little for its bytes.

Packing, and why. Albedo is lossy WebP quality 82, sRGB. Normal is lossy quality 90 (chroma subsampling blurs the red and
green of a normal map a little, so it gets the higher setting; the decoded mean in the smoke test is (127, 127, 243), a flat
tangent-space normal). Roughness is a grey image at half the size, quality 80, read by three.js from the green channel; at
that size it is 4 to 15 KB, so packing it into another map's alpha (lossless in WebP, so large) or colour channels (the
chroma blur would corrupt it) saved nothing worth the shader work. Occlusion is not a file: the cavity occlusion is multiplied
into the albedo, because the level already bakes its own occlusion and light into vertex colours, and a separate map would
only act on ambient light. Painted brick and floorboards borrow maps (`share` in `src/textures.js`), so they cost one
albedo file and nothing.

## How it is made (`scripts/blender/textures.py`)

`~/.venvs/blender/bin/python scripts/blender/textures.py [--only brick,flag] [--debug DIR]`. Per surface:

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

**Reproducible.** Fixed seeds, no thread-dependent code. Brick, stone and boards were baked three times in separate
processes and the flags twice (after their last change); every file compared byte-identical with `cmp`. This holds
for this Blender (bpy 5.2.3) and its bundled libwebp; a different bpy build may encode differently.

**Build time.** About 6.5 minutes for all four bakes on this 4-core container with other work running (385 s, 325 s, 348 s in
three full runs): brick 170 to 215 s (168 bricks, 394k vertices, 1024 x 512), flags 45 to 70 s, stone 50 to 80 s, boards
45 to 60 s. The bake is a one-off; nothing runs at build time for the game.

## Conventions that are easy to get wrong

- **Colour space.** Albedo is sRGB (`texture.colorSpace = SRGBColorSpace`); normal and roughness are linear data
  (`NoColorSpace`). Checked in the smoke test.
- **Normal orientation.** Tangent space, OpenGL (+Y up, green is v): Blender's bake gives that, the file's first row is the top
  (v = 1), `THREE.Texture` has `flipY = true`, and three.js r160 builds its tangent frame from UV derivatives, so no flip or
  swizzle is needed. Seen to light correctly in screenshots (edges catch light from the right side), but this is a visual
  check, not an assertion.
- **Repeat.** `texture.repeat = scale / tile` (brick: 0.5 by 1). The Mesher's UV scale is untouched, so the generated texture
  and the baked one drop into the same geometry.
- **Tints.** Level 2's darker tints are vertex colours that multiply the map, so they work unchanged on baked albedo.
- **Mip maps and anisotropy.** Default trilinear mip chain from three.js, anisotropy 4, as the generated ones.
- **No leaks.** `world.retexture` disposes the generated textures it replaces; `world.disposeTextures()` (called when a level
  is replaced) disposes a world's own generated textures and leaves baked ones alone, because they are shared between levels.
  This also fixes an older leak: replacing a level used to dispose materials and geometry but not textures.

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
- **Offline.** `sw.js` precaches the 13 files and the two new modules (cache `mobilegame-v9`).
- **Artifact.** `npm run build:artifact` inlines the files as base64 data URIs through an esbuild plugin that replaces
  `src/textures-inline.js`: 3.9 MB for the whole page, 0.8 MB of it textures (3.2 MB without; `NO_TEXTURES=1` builds that).
  Checked by opening the built file: all six surfaces swapped in.

## Cost

| | Measured or estimated |
| --- | --- |
| Extra bytes over the wire, first visit | 594 KB (measured), then cached by the service worker |
| Artifact size | 3.99 MB with textures, 3.20 MB without (measured) |
| GPU memory for the baked maps | 17.7 MiB (estimate: RGBA8 plus a third for mips, every texture counted once; the smoke test prints it) |
| GPU memory freed by the swap | the six generated surfaces: about 10 MB at medium, 18 MB at high (estimate); carpet, concrete and plaster stay generated |
| Net GPU memory | about +8 MB at medium, about the same at high (estimate) |
| Level build time in Node | 0.4 to 0.8 s less per level once baked textures exist, because those six surfaces are not generated (measured, noisy) |
| Frame time | not measured usefully (see below) |

**Frame rate in software WebGL: no usable measurement.** `tier-fps.mjs` was run twice per tier with and without `?baked=0`
while the other two engineers were also running browsers on the same 4 cores (load average above 30). It gave 0.1 to 0.6 fps
for every combination with no consistent order (medium generated 0.1 and 0.3, baked 0.6 and 0.5), so it shows nothing except
that the machine was busy. Do not quote it. A fair comparison needs a quiet machine, and even then it would be CPU-bound.

**Unknown, and worth stating plainly:** decode time, GPU upload time, memory and frame rate on an A15 phone. Nothing here was
seen on a phone. The software-WebGL frame rate says almost nothing about a phone GPU: it is CPU-bound and does not model
texture bandwidth or cache behaviour. Baked brick is 1024 x 512, twice the pixels of any generated texture, so brick walls
sample more memory; the likely worst case is a medium-tier phone, where the old textures were 384 px.

## Verdict, from screenshots

Medium tier, portrait (390 x 844) and landscape (844 x 390), both levels, before (`?baked=0`) and after, from
`game-views.mjs` and `world-views.mjs` (`level-tour.mjs` was used for the first check). Honest summary: **better, and clearly so
on some surfaces, modest on others.**

- **Floor boards (dancefloor, bar): clearly better.** The generated boards read as a flat brown grid with blotches; the baked
  ones have grain, knots, scuffing, narrow dark gaps and a proper sheen. This is the biggest gain.
- **Painted brick (dancefloor wall, VIP, backstage): clearly better.** The generated wash was a blotchy plaster; the baked one
  is whitewash over real brick, with the courses showing through and some peeling.
- **Brick (cloakroom, bar): better but subtle.** Deeper joints, chipped corners, uneven faces and more variety of tone. In
  the lit, saturated red of the bar it reads as more real and less like a tile, but a player would not call it a different
  game. Calibrating the mean colour to the old texture (so lighting and tints still work) keeps the overall look the same by
  design; the difference is in the detail.
- **Flags (stairwell, cloakroom floor, all of the Vaults): modestly better.** Slabs sit at different heights, with worn
  edges, damp and polished patches. In the Vaults the torch finds wet slabs and gives a glossier, bluer sparkle than before.
  In the dark it is hard to tell from the old floor except for that gloss.
- **Stone (stairwell, Vaults walls): hardly changed at screenshot scale.** The gain is mostly in the chipped edges and joints,
  which are visible only close up under the torch.

What we would change next: bake plaster (the ceilings are still the generated texture and now look flatter than the walls),
add a second flag variant if big open floors show a 2 m repeat, and look at everything on a phone, where screen size and
brightness change what reads. Nothing was seen on a phone, and level 2 in particular is dark enough that screenshots
flatter nothing and hide a lot.

## Tiling

The generated brick repeated every 0.9 m. The baked brick tile is twice as wide (1.8 by 0.9 m) with fewer outlier bricks
(clinkers, pale and blue-black bricks are about 6 per cent of bricks instead of 14), and each wall face starts a whole
number of double courses up the tile (`Mesher.off`, 0 to 0.75 m in 0.15 m steps from the face's hash). The bond stays
continuous across faces but the same bricks do not stack in a column. Cost: brick files are twice the size they would be
for a 0.9 m tile (about 125 KB of the 594 KB). Flags (2 m) and stone (1.2 m) repeat as before; long corridors showed no obvious
repeat in screenshots. A flag floor of nine slabs repeating every 2 m could still show on a very large open floor; the
Vaults are dark enough that we did not see it.

## If you change it

Edit `scripts/blender/textures.py` (the `SPECS` table holds the numbers: arris radius, joint depth, unevenness, grain, boost,
palette targets), rerun it, copy nothing by hand (it writes straight into `assets/textures/`), update the sw.js list if
files were added, and run `node scripts/harness/textures-check.mjs`, which fails if the file list, the manifest in
`src/textures.js` and `sw.js` disagree. Adding a surface: add a block layout and a `SPECS` entry, an entry in `BAKED`, and use
`world.js`'s `textured(name)` slot. Plaster, carpet and concrete would be the next ones.
