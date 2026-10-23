// Level 2, the Vaults: the arched stone cellars under South Bridge and Mary King's Close. Nearly dark, so Naebun's torch
// and the wall torches matter. Pure data (no three.js), so it also loads under plain Node. src/levels/vaults-decor.js
// dresses it and src/world.js builds it.

// Legend. Solid: # wall, P stone column, S stacked casks (blocks shots), T stairs. Low cover (blocks walking, not
// bullets): o barrel, x chest, c stone tomb, n hand cart. 1-6 door tiles (two per door), . floor.
// Markers that sit on floor: @ start, E exit (four tiles), d fizzbang, w bampot, s shielded fizzbang, g the Tour Guide,
// G shotgun, M smg, L launcher, V vinyl disc; drinks H dram, O orange, B heavy, N energy, X last orders.
export const MAP = [
  '############################################',
  '############################################',
  '####...............................#########',
  '####....c.............c.......c....#########',
  '####..............P................#########',
  '#EE6......P...............P........#########',
  '#EE6....................g..........#########',
  '####............w...............P..#########',
  '####......P.........d..............#########',
  '####..............P.......P..d.....#########',
  '####.H........cH...H..c..........B.#########',
  '####...............................#########',
  '################55##########################',
  '##................................##########',
  '##.H............................B.##########',
  '##...c............................##########',
  '##......P.....P..o..P.....w.......##########',
  '##............................o...##########',
  '##....d....c...........c..........##########',
  '##...............X................##########',
  '##......P.....P.....P.....P.......##########',
  '##.o..............................##########',
  '##........s......c......d....c....##########',
  '##..O.............................##########',
  '##......P.....P.d...P.....P.......##########',
  '##.........c...................c..##########',
  '##..............................H.##########',
  '######44####################################',
  '#####.......nn..................n..........#',
  '#####...........s.......d...........d......#',
  '#####....o..w.......o.....N.o.s............#',
  '#####.....d...........w............o.......#',
  '#####.H...........n.....nn....H.........L..#',
  '########################################33##',
  '##############################.............#',
  '##############################..w..........#',
  '##############################.B.SS..d..o.O#',
  '##############################........S....#',
  '##############################........S...o#',
  '##############################..o..........#',
  '##############################......o...d.H#',
  '##############################....S....o...#',
  '##############################.............#',
  '##############################.o.d..s....S.#',
  '##############################.M...o......V#',
  '##############################.............#',
  '########################################22##',
  '#TTT......#.o........................o.....#',
  '#TTT...xx.#.......d........................#',
  '#.........1....P.....P.....P.....P.....P.w.#',
  '#.........1..G......................d......#',
  '#...@.....#.......o.........o.............H#',
  '#.......H.##################################',
  '#x.......x##################################',
  '############################################',
];

export const AREA_DEFS = [
  { id: 'steps', name: 'THE VAULTS: BLAIR STREET STEPS', objective: 'Head down into the Vaults', rect: { c0: 1, r0: 47, c1: 10, r1: 53 }, unlocks: [] },
  { id: 'longvault', name: 'THE VAULTS: THE LONG VAULT', objective: 'Clear the Long Vault', rect: { c0: 11, r0: 47, c1: 42, r1: 51 }, unlocks: ['d2'] },
  { id: 'casks', name: 'THE VAULTS: CASK CELLAR', objective: 'Clear the Cask Cellar', rect: { c0: 30, r0: 34, c1: 42, r1: 45 }, unlocks: ['d3'] },
  { id: 'close', name: "THE VAULTS: MARY KING'S CLOSE", objective: 'Clear the Close', rect: { c0: 5, r0: 28, c1: 42, r1: 32 }, unlocks: ['d4'] },
  { id: 'plague', name: 'THE VAULTS: THE PLAGUE CELLAR', objective: 'Clear the Plague Cellar', rect: { c0: 2, r0: 13, c1: 33, r1: 26 }, unlocks: ['d5'] },
  { id: 'tour', name: 'THE VAULTS: THE LAST TOUR', objective: 'Stop the Tour Guide', rect: { c0: 1, r0: 2, c1: 34, r1: 11 }, unlocks: ['d6'] },
];

// Ambient tint baked into vertex colours. Much lower than level 1: here the torches do the lighting.
export const AREA_STYLE = {
  steps: { tint: [0.3, 0.34, 0.44] },
  longvault: { tint: [0.2, 0.23, 0.3] },
  casks: { tint: [0.3, 0.24, 0.2] },
  close: { tint: [0.26, 0.24, 0.22] },
  plague: { tint: [0.2, 0.27, 0.27] },
  tour: { tint: [0.3, 0.22, 0.22] },
};
export const WALL_STYLE = {
  steps: { upper: 'stone', ut: [0.9, 0.92, 0.95], dado: 0 },
  longvault: { upper: 'stone', ut: [0.8, 0.82, 0.8], dado: 0 },
  casks: { upper: 'brick', ut: [0.7, 0.58, 0.52], dado: 1.0, dmesh: 'wood', dt: [0.46, 0.34, 0.24] },
  close: { upper: 'paint', ut: [0.74, 0.68, 0.58], dado: 1.1, dmesh: 'stone', dt: [0.7, 0.68, 0.64] },
  plague: { upper: 'stone', ut: [0.68, 0.74, 0.7], dado: 0 },
  tour: { upper: 'brick', ut: [0.62, 0.5, 0.46], dado: 1.2, dmesh: 'paint', dt: [0.28, 0.1, 0.14] },
};
export const FLOOR_STYLE = { steps: 'flag', longvault: 'flag', casks: 'flag', close: 'flag', plague: 'flag', tour: 'flag' };
export const FLOOR_TINT = { steps: [0.9, 0.92, 1.0], longvault: [0.8, 0.84, 0.88], casks: [0.86, 0.78, 0.7], close: [0.8, 0.78, 0.72], plague: [0.72, 0.84, 0.8], tour: [0.84, 0.74, 0.7] };

export const KINDS = { d: 'fizzbang', w: 'bampot', s: 'shielded', g: 'tourguide' };
export const PICKS = {
  G: ['weapon', 'shotgun'], M: ['weapon', 'smg'], L: ['weapon', 'launcher'], V: ['weapon', 'vinyl'],
  H: ['drink', 'dram'], O: ['drink', 'orange'], B: ['drink', 'heavy'], N: ['drink', 'energy'], X: ['drink', 'lastorders'],
};

export const LEVEL_DEF = {
  id: 'vaults',
  number: 2,
  cols: 44,
  rows: 55,
  map: MAP,
  areas: AREA_DEFS,
  areaStyle: AREA_STYLE,
  wallStyle: WALL_STYLE,
  floorStyle: FLOOR_STYLE,
  floorTint: FLOOR_TINT,
  solid: { '#': 1, P: 2, S: 3, T: 4 }, // tile kinds: wall, pillar, speaker (here: casks), stairs
  cover: 'oxcn',
  doorCount: 6,
  entryDoor: [null, 'd1', 'd2', 'd3', 'd4', 'd5'],
  kinds: KINDS,
  picks: PICKS,
  startYaw: -Math.PI / 2,
  exitR: 1.5,
  fog: { colour: 0x04060a, near: 2, far: 26 },
  ambient: { sky: 0x7d8cab, ground: 0x34302f, intensity: 0.75 },
  look: { exposure: 1.35, bloom: 0.7, vignette: 0.5, grade: { lift: [0.006, 0.012, 0.022], gamma: [0.98, 1.0, 1.02], gain: [1.0, 1.0, 1.04] } },
  torch: { colour: 0xffd9a0, intensity: 3.4, range: 16, decay: 1.5 },
};
