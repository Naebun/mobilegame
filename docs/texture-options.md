# Texture options

**Decided: D then C, with A kept as the fallback. Built and measured; see `docs/textures.md`.** The rest of this file is the
planning write-up as it was, kept for the reasoning. The estimates in it are checked against what was built in the last
section.

## Where things are

Every surface (brick, painted brick, stone, flags, boards, floorboards, carpet, concrete, plaster) is generated in code
by `genBrick`, `genStone`, `genFlag` and friends in `src/world.js`, as three aligned fields: albedo, height and
roughness. The normal map is derived from the height. Texture size follows the quality tier: 256, 384 or 512 pixels square.
Level 2 reuses level 1's textures with darker tints.

Measured, albedo only: 2.3 MB of texture data at the low tier, 4.1 MB at medium, 6.8 MB at high. Building a level in Node
takes about 0.75 to 0.95 s, a good part of which is generating these. Nothing is downloaded: the textures cost script
time at load, and no bytes over the wire.

Why this matters: wall and floor surfaces cover most of every frame. The weapon and the robots are the focus of the eye,
but the surfaces set the whole look. The generators give a clean stylised result. They do not give chipped mortar, weathered
timber grain, or the uneven wet shine of old flagstones, which is what "gritty and real" asks for.

## The four ways to do it

### A. Keep it procedural, and improve the generators
No repo change, no new rule, no load cost beyond today's. Limit: it is a stylised look, and each improvement is hand-tuned
noise code. A reasonable fallback in any plan, since the low tier and the headless tests need generated textures anyway.

### B. Bake the textures in Blender, embed them as data in a JS module
The same way the drink meshes ship: a generated module, no image files.
- Raw 512 px, three maps, per material is about 2.4 MB. Nine materials is about 21 MB raw, and base64 adds a third. Far too big.
- Fix: store them compressed (JPEG or PNG inside the module as a data string) and decode in the browser. Decoding needs
  `Image` or `createImageBitmap`, which is DOM, so it could only happen in `game3d.js`, not in `world.js` (which must run
  under Node). That already breaks the "no DOM in world.js" rule in spirit, and it makes the module large (estimate 1.5 to 2.5 MB of text).
- Verdict: all the cost of option C, with none of its simplicity. Not recommended.

### C. Bake in Blender, ship as image files, load at runtime
Textures become real files (for example `assets/textures/brick-albedo.webp`) loaded by `game3d.js` and handed to the
world. `world.js` and `models.js` stay procedural and DOM-free, and the headless tests keep using the generated fallback.
- Size, estimate: 512 px WebP albedo about 40 to 90 KB, normal map about 100 to 200 KB, roughness packed into the normal
  map's alpha or the albedo. Nine materials is roughly 1.5 to 2.5 MB. We have not measured this on real baked output.
- GPU memory, estimate: a 512 px texture with mipmaps is about 1.4 MB; three maps by nine materials is about 38 MB. Fine on
  an iPhone 14 class device. 1024 px would be four times that, which we would not do for the A15 floor.
- WebP decodes on Safari 14 and later, so everything the plan targets (iOS 16 and up) is covered.
- First load downloads the files, then the service worker caches them. Load time goes up by the download. We do not know
  the real cost on a mobile connection.
- Needs the owner to relax the "no image files" rule for these assets, and a place for them in the repo.

### D. Make better textures first, then choose B or C
Blender can do what the generators cannot: model a real brick wall with bevelled, uneven bricks and recessed mortar, a
stone course with chips, a flagged floor with worn edges and uneven height, and bake albedo, normal, roughness and
ambient occlusion from the actual geometry with Cycles (CPU, a minute or two per material). The same Python scripts
and reproducibility rules as the drinks apply. This is a way of making the source art, not a delivery format, so it pairs
with C (or with a smaller version of B if textures turn out small enough).

## Recommendation

Do D then C, in that order, and keep A as the fallback:
1. Bake brick, stone, flag, boards and plaster in Blender at 512 px, tileable, from modelled geometry.
2. Ship them as WebP files, loaded by `game3d.js` for the medium and high tiers. The low tier and every headless test keep the generated textures.
3. Measure real file sizes and build time before committing to the other materials.

Do level 1's brick and flag first. It is the most visible surface in the game and it is a single material swap, so the result is easy to judge in screenshots.

## What we do not know

- The real file sizes of Blender-baked tileable textures. These figures are estimates.
- Decode and upload time on an A15 phone. Desktop numbers will not tell us.
- Whether tiling repeats show on long walls. Baked brick tends to repeat visibly unless there are a few variants, which costs size.
- Whether the owner wants image files in the repo at all.

## Decision and what was measured

The owner confirmed option D then C. Image files may now enter the repo for textures only, in `assets/textures/`. Measured on
the built result:

| Question in this file | Estimate then | Measured |
| --- | --- | --- |
| Real size of Blender-baked tileable textures | 1.5 to 2.5 MB for nine materials | 594 KB for five baked surfaces (13 files); brick albedo 78 KB, brick normal 158 KB, roughness 4 to 15 KB each. A second pass added plaster, concrete and a second flag layout: 917 KB for 19 files in all. Carpet was not baked |
| Bake time | "a minute or two per material" | brick about 3 to 3.5 minutes, the others about 1 minute each, about 6.5 minutes for all (4-core container, other work running) |
| Is the output reproducible | assumed | yes: byte-identical across repeated full runs (`cmp`), for this bpy build |
| GPU memory | about 38 MB for nine materials at 512 px | 17.7 MiB for what is baked (brick is 1024 x 512), about +8 MB over the generated ones at medium (estimates) |
| Do tiling repeats show | probably, without variants | yes for the 0.9 m brick tile; fixed with a 1.8 m tile, fewer outlier bricks and a per-face offset, for about 125 KB. Nothing seen on flags or stone |
| Decode and upload time on an A15 | unknown | still unknown: no phone was available |

What changed from the plan: roughness stayed a separate half-size grey file instead of being packed into another map's alpha
(lossless alpha is large; the files are tiny anyway); occlusion went into the albedo instead of a file; painted brick and
floor boards reuse maps instead of having their own. The visual verdict is in `docs/textures.md` and the hand-over notes.
