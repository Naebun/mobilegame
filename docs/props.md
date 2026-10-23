# Prop kit (Blender)

The furniture and dressing of both levels is modelled in Blender and plugged into the level builder. `scripts/blender/props.py`
builds 27 models (11,260 triangles in all) and writes `src/prop-meshes.js` (generated: change the script, rerun it, never edit the output). `src/world.js`
decodes them and merges them into the level's existing meshers, so the draw calls do not change. Where a prop is missing from
the data, or the quality tier is `low`, the old procedural version still runs.

```
~/.venvs/blender/bin/python scripts/blender/props.py                        # regenerate src/prop-meshes.js (about 10 s)
~/.venvs/blender/bin/python scripts/blender/props.py --only speaker,table --preview /tmp/sheet.png   # Cycles contact sheet
```

The output is byte for byte repeatable (run twice and `cmp`). No bmesh extrude, bevel or primitive operators: faces are
hand-built with an explicit outward hint, so nothing is ordered by pointer hash. The file carries its own small copy of the
kit helpers (bevelled box, lathe, tube, prisms) because `kit.py` belongs to the weapons work.

## What is in it

| Model | Used for | Meshers | Notes |
| --- | --- | --- | --- |
| `column_a` | L2 `P` | stone | plinth, moulded base, swelling shaft, astragal, echinus, abacus to the ceiling |
| `pillar` | L1 `P` | stone, brick | chamfered brick shaft on a stone plinth, corbelled capital |
| `barrel_a/b/c` | L2 `o`, L1 bar kegs | wood, metal, props | oak staves, hoops, dished head, bung; b is darker and rusty, c is pale with brass hoops |
| `cask_stack` | L2 `S` | wood, metal | four standing casks (outer arc only) with two long ones lying across them |
| `chest_a/b` | L2 `x` | wood, metal | iron-bound, barrel lid, brass lock plate, end handles |
| `tomb_a/b/c` | L2 `c` | stone, props | panelled chest tomb; a has a cross, b a worn effigy, c a velvet runner (the Last Tour) |
| `cart_a/b` | L2 `n` | wood, metal, props | spoked wheels, shafts resting on the ground inside the tile; b carries sacks |
| `speaker` | L1 `S` | props, metal | three cabinets stepping back, two woofers, horns; faces the middle of the dancefloor |
| `flight_a/b/c` | L1 `x` (backstage, VIP, dancefloor) | props, metal | black ply, alloy rails, ball corners, latches, gaff tape; three heights |
| `crate_a/b` | L1 `x` (stairwell, cloakroom) | wood, metal, props | slatted, corner posts, iron bands, stencilled patch |
| `table` | L1 `o` | polish, metal, props, glass, glow | pedestal table, three stools, candle (glow part), glass |
| `rail_a/b` | L1 `r` | props, metal | six coats on hangers; a winter, b costumes |
| `booth` | L1 `v` | props, metal | buttoned leather seat, channelled backrest against the wall |
| `bar` | L1 `b` | props, wood, polish, metal | oxblood painted panelled front (it reads in the dark, timber does not), polished top, brass rail and band, stainless back counter; bottles are still code |
| `torch` | L2 wall torches | metal, props | plate, arm, cup, charred rag; the flame is the level's flame sprite |
| `brazier` | L2 hanging braziers | metal, props, hang | bowl with ribs and embers, three chains |
| `pendant` | L1 pendant lamps | hang (tintable), metal | shade, brass rim, chain; the bulb glow, shafts and light stay procedural |

Not modelled (ranked last for look per triangle, or too tangled with the map): the DJ booth (24 tiles of one bespoke
arrangement with equipment on top), stairs, brass sconces, lanterns, niches, door frames, posters, stage cans. They are all
still procedural.

## How it plugs in

- Parts are authored on the floor around the origin in Blender axes (x right, y depth, z up); the front is -y, which the
  export turns into +z. `placeProp(name, x, z, { y, yaw, s, tint })` in `buildVisuals` appends every part to the mesher
  named in the data (`Mesher.part`). Yaw 0 faces +z. Wall props have their back on the wall plane; hang them with `yaw =
  atan2(nx, nz)` of the wall face.
- Vertex colour holds albedo, edge wear and baked ambient occlusion (props stand on a virtual floor, wall props on a virtual
  wall). `Mesher.bake` then multiplies in the level's own ambient and light pools exactly as it does for walls, so a prop in a
  torch pool is lit and one in the dark is dark. Roughness and metalness come from the world mesher, not the model.
- Textured meshers (wood, stone, brick, polish) multiply their texture by vertex colour, so parts for them are authored as a
  tint (`L(r, g, b)` writes linear colour the way `world.js` does). Round parts carry cylindrical texture coordinates in the
  data (arc length and height in mm), because the mesher's flat projection smears across a smooth cylinder; everything else
  uses the mesher's own projection.
- Chamfer strips on boxes take the worn-edge colour (a face tag, not a vertex effect), lathes wear at their hard rims.
- `gain` on a part: the game multiplies its colour by it. Timber textures are very dark and the Vaults are dark too, so the
  wooden props there ask for 1.8 (the texture still shows; it is just not black).
- A part has a quality tier `q`: 0 and 1 draw at medium and high, 2 only at high. The `low` tier draws no Blender props at
  all and keeps the cheaper procedural ones, so it costs what it always did.
- Models stay inside their 2 x 2 m tile (checked by `level-check`), so collision, which is by map tile, still describes
  what is on screen. Cart shafts rest on the floor at the tile edge for that reason.

## Budgets (measured with `buildWorld` in Node, high quality unless stated)

| | Level 1 before | Level 1 after | Level 2 before | Level 2 after |
| --- | --- | --- | --- | --- |
| triangles, high | 118,061 | 126,659 | 128,183 | 144,948 |
| triangles, medium | 98,781 | 106,303 | 76,135 | 95,060 |
| triangles, low | 69,453 | 69,453 | 57,625 | 57,625 |
| vertices, high | 201,269 | 197,599 | 172,375 | 178,978 |
| draw calls (low / medium / high) | 28 / 32 / 33 | 28 / 32 / 33 | 19 / 19 / 19 | 19 / 19 / 19 |

World-check budgets level 1 at 130k triangles and level-check any level at 150k. To pay for the props in level 2 the floor
grid's extra 0.25 / 0.75 lines are now only cut where a light pool reaches the tile (between the torches the coarse grid
carries everything there is to see).

## Adding or changing a prop

1. Write a function in `props.py` that returns a `Model` and add it to `KIT`. Use `bevbox` (chamfer box; under 7.5 cm it
   becomes a plain box), `lathe` (profile with the solid on its right: up an outer wall, then in across a top), `tube`,
   `prism_xz/yz/xy`. Give every part a mesher name and a tier.
2. Run the script and look at the `flipped` figure it prints (faces whose normal points inward; a few false alarms come from
   open lathes), then a contact sheet.
3. Call `placeProp` from the level code with a procedural fallback behind it.
4. `node scripts/harness/level-check.mjs` checks every model decodes, stays in its tile and stands on the floor, and that
   every prop tile of every level gets a model at medium and high.

## What we do not know

- Nothing here has been seen on a phone. The triangle and vertex numbers are headless; frame rate on a real device is untested.
- The look was judged from software-rendered screenshots (`scripts/harness/game-views.mjs` style) and Cycles contact sheets,
  not from a person playing.
