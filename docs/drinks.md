# Power-up drinks

The owner's rule: **power-ups are drinks**. When Freddie walks onto one, there is a first-person drinking animation of
that drink, then the effect applies. All drink names are invented (no real brands, logos or packaging). This replaces
the old medkit.

## The four drinks (ids are used in code)

| id | Name | Looks like | Effect | Animation (about) |
| --- | --- | --- | --- | --- |
| `dram` | Wee Dram | a small whisky glass, amber, with a rim of light | Heals 35 health at once (replaces the medkit) | 1.2 s: raise, tip the whole glass back in one go, a satisfied "aah", lower |
| `orange` | Bruiser Orange | a glass bottle of fizzy orange with a screw cap, bright orange liquid | 25 percent faster movement for 20 s | 1.6 s: twist the cap off (fizz), swig, a burp, lower |
| `heavy` | Pint of Heavy | a pint glass of dark ale with a foam head | Takes 50 percent less damage for 20 s ("liquid courage") | 2.0 s: raise, big gulp (foam moustache), sigh, lower |
| `energy` | Bassline Energy | a slim energy can, black with a magenta and cyan stripe | 50 percent faster fire rate and much faster reloads for 15 s | 1.7 s: crack the tab (pssht), chug, crush the can slightly, lower |

Effects are applied at the moment the drink is finished (about 65 percent through the animation), and the toast says
what it did. Freddie cannot fire during the animation (it is short), but can still move.

## For the models agent (`src/models.js`)

New exports (keep everything else as it is):

```js
export const DRINK_IDS = ['dram', 'orange', 'heavy', 'energy'];
export function makeDrinkPickup(id) -> THREE.Group   // origin on the floor, about 1.0 to 1.3 tall in total
export function makeDrinkViewmodel(id) -> { group, setPose(k), duration }
```

- `makeDrinkPickup`: the drink itself floating about 0.5 above a glowing floor ring (HDR colour in the drink's own tint:
  amber, orange, deep brown with a cream head, magenta and cyan), slightly larger than life so it reads from across a
  room. The integrator bobs and spins it. It must be recognisably the drink at 10 metres in dim light. Replaces
  `makeHealthPickup()` in the game (keep that function; it is harmless).
- `makeDrinkViewmodel`: Freddie's right hand and forearm (a sleeve cuff, a bare or gloved hand, a wristband is fine)
  holding the drink, as a first-person viewmodel in the same convention as the weapon viewmodels: the `group` is
  added to the weapon-scene root, which the integrator positions at camera-local about (0.15, -0.24, -0.62) scaled
  0.68; build it around that. `setPose(k)` takes k from 0 to 1 over the whole drinking animation and must be safe for
  any value (clamp). `duration` is the seconds the integrator should play it over (use the table, a bit of
  tuning is fine).
- The animation timeline for every drink: 0 to 0.2 the drink rises from the lower right resting position to the lower
  centre of the view, near the camera (roughly x 0, y -0.18, z -0.4, this is "Freddie's mouth" just below the frame);
  0.2 to 0.75 it tilts back (rotation about x towards the camera, up to about 1.3 rad, bottles and cans further than
  glasses) while the liquid level (a scaled inner mesh) falls; 0.75 to 1 it lowers and returns to the start. Flavour
  details per the table (the orange's cap twists off early and is held in the other hand or dropped; the can's tab
  clicks and the can squashes a little at the end; the pint grows a foam moustache that wipes off). A slight hand
  wobble and sway makes it feel alive.
- Keep it cheap: up to 12 meshes per viewmodel, shared geometry and materials, HDR only on tiny glints (the liquid
  catching light, the can stripe). Standard PBR materials as the graphics pass asks.
- Add a case to `scripts/harness/models-check.mjs` (every drink, `setPose` at k in {-1, 0, 0.3, 0.7, 1, 2}, no NaNs,
  mesh counts) and a harness page that shows each drink's animation frames in a contact sheet, at 390 x 844, using the
  weapon camera (fov 70).

## For the world agent (`src/world.js`)

- The pickup kind `'health'` / item `'medkit'` goes away. A new kind: `{ id, kind: 'drink', item: 'dram' | 'orange' | 'heavy' | 'energy', x, z }`.
  `kind: 'weapon'` is unchanged. Update the level, its tests and any text (the harness checks).
- Convert every existing medkit into a `dram`. Add power-up drinks so there are about **eight** in the level, placed to
  suit the room (keep each on a walkable tile with clearance, not hidden inside cover, and a few in light side nooks
  that reward looking around):
  - cloakroom: `orange` near the coat rails.
  - dancefloor: `dram` (existing), `energy` on the DJ booth or beside the speaker stacks.
  - bar: `heavy` on the bar counter end or a nearby table (a pint on the bar is the joke), `dram` (existing).
  - vip: `orange` or `energy` in a booth, `dram` in a side nook.
  - backstage: `dram` (existing) by the entrance and `heavy` before the boss.
  Roughly one drink per area from the cloakroom on, more where the fights are harder (bar, backstage).
- Pickups do not need extra meshes in the world; the integrator creates the models from `makeDrinkPickup`.
