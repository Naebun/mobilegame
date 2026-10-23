// Level 1, the Cowgate: a brick-and-stone basement club. Pure data (no three.js), so it also loads under plain Node.
// world.js turns a level definition like this into geometry, collision and lighting.


// Legend. Solid: # wall, P pillar, S speaker stack, T stairs. Low cover (blocks walking, not bullets):
// b bar counter, j DJ booth, v booth, x crate or flight case, r coat or costume rail, o round table.
// 1-6 door tiles (two per door), . floor. Markers that sit on floor: @ start, E exit (two tiles),
// d fizzbang, w bampot, K bouncer, G shotgun, M smg, L launcher; drinks H dram, O orange, B heavy, N energy, X last orders.
// <map>
export const MAP = [
  '####################################',
  '####....xxx.....xx........xx.......#',
  '#..#...............................#',
  '#EE6................d..............#',
  '#EE6......K.....P.......P..........#',
  '#..#..................d............#',
  '####.........B...................H.#',
  '####..........rr....rr.............#',
  '###############################55###',
  '#.....vvv...N.vvv..X..vvv..........#',
  '#..................................#',
  '#.L...............d.......d...w..w.#',
  '#..........................H.......#',
  '###44###############################',
  '#...........................#x.....#',
  '#........w..................#......#',
  '#..................w........#...H..#',
  '#...........................#.....x#',
  '#....bbbbbbbbbbbbbbbbbbbbB..#.....x#',
  '#..........o................#......#',
  '#..o...d........P....d.............#',
  '#.............d....................#',
  '#.................o.....o..........#',
  '###############################33###',
  '#...........S.jjjjjjjj.S...........#',
  '#...........S.jjjjjjjjNS...........#',
  '#...d.........jjjjjjjj.............#',
  '#...........w....X.........d.......#',
  '#v....S...........................S#',
  '#v....S......................P....S#',
  '#.....S...P........................#',
  '#..............P........P.......d..#',
  '#..M...............................#',
  '#.................................S#',
  '#.....S...P........SS........P....S#',
  '#v....S....................H...d...#',
  '#v....S............................#',
  '#..................................#',
  '###################22###############',
  '########..............##############',
  '#TTT..x#..............##############',
  '#TTT...#...Orrr..P....##############',
  '#......#..............##############',
  '#......1..G..d....d...##############',
  '#..@...1.......rrr....##############',
  '#......#..............##############',
  '#x....x#...xx.........##############',
  '####################################',
];

export const AREA_DEFS = [
  { id: 'stairwell', name: 'THE COWGATE: STAIRWELL', objective: 'Head into the club', rect: { c0: 1, r0: 40, c1: 7, r1: 46 }, unlocks: [] },
  { id: 'cloakroom', name: 'THE COWGATE: CLOAKROOM', objective: 'Clear the cloakroom', rect: { c0: 8, r0: 38, c1: 21, r1: 46 }, unlocks: ['d2'] },
  { id: 'dancefloor', name: 'THE COWGATE: DANCEFLOOR', objective: 'Clear the dancefloor', rect: { c0: 1, r0: 23, c1: 34, r1: 37 }, unlocks: ['d3'] },
  { id: 'bar', name: 'THE COWGATE: BAR', objective: 'Clear the bar', rect: { c0: 1, r0: 13, c1: 34, r1: 22 }, unlocks: ['d4'] },
  { id: 'vip', name: 'THE COWGATE: VIP CORRIDOR', objective: 'Clear the VIP corridor', rect: { c0: 1, r0: 8, c1: 34, r1: 12 }, unlocks: ['d5'] },
  { id: 'backstage', name: 'THE COWGATE: BACKSTAGE', objective: 'Take down the bouncer', rect: { c0: 1, r0: 1, c1: 34, r1: 7 }, unlocks: ['d6'] },
];

export const AREA_STYLE = {
  // ambient tint baked into vertex colours; low on purpose, the baked pools and the real lights do the lighting
  stairwell: { tint: [0.46, 0.5, 0.6] },
  cloakroom: { tint: [0.6, 0.46, 0.36] },
  dancefloor: { tint: [0.52, 0.37, 0.4] },
  bar: { tint: [0.6, 0.46, 0.34] },
  vip: { tint: [0.52, 0.36, 0.34] },
  backstage: { tint: [0.44, 0.5, 0.58] },
};
export const WALL_STYLE = {
  stairwell: { upper: 'stone', ut: [1.0, 1.0, 0.96], dado: 0 },
  cloakroom: { upper: 'brick', ut: [1.0, 0.94, 0.9], dado: 1.15, dmesh: 'paint', dt: [0.2, 0.34, 0.25] },
  dancefloor: { upper: 'brick', ut: [0.82, 0.72, 0.72], dado: 0 },
  bar: { upper: 'brick', ut: [1.05, 0.9, 0.82], dado: 1.2, dmesh: 'wood', dt: [0.62, 0.46, 0.32] },
  vip: { upper: 'paint', ut: [0.98, 0.88, 0.72], dado: 1.3, dmesh: 'paint', dt: [0.46, 0.1, 0.14] },
  backstage: { upper: 'paint', ut: [0.8, 0.84, 0.84], dado: 1.2, dmesh: 'paint', dt: [0.12, 0.26, 0.2] },
};
export const FLOOR_STYLE = { stairwell: 'flag', cloakroom: 'flag', dancefloor: 'floorboards', bar: 'floorboards', vip: 'carpet', backstage: 'concrete' };
export const FLOOR_TINT = { stairwell: [0.95, 0.95, 1.0], cloakroom: [1.0, 0.92, 0.88], dancefloor: [0.9, 0.82, 0.8], bar: [1.0, 0.9, 0.8], vip: [1.0, 0.9, 0.9], backstage: [0.95, 1.0, 1.05] };

// Marker letters on the map: enemy kinds and floor pickups (kind, item).
export const KINDS = { d: 'fizzbang', w: 'bampot', K: 'bouncer' };
export const PICKS = {
  G: ['weapon', 'shotgun'], M: ['weapon', 'smg'], L: ['weapon', 'launcher'],
  H: ['drink', 'dram'], O: ['drink', 'orange'], B: ['drink', 'heavy'], N: ['drink', 'energy'], X: ['drink', 'lastorders'],
};

export const LEVEL_DEF = {
  id: 'cowgate',
  number: 1,
  cols: 36,
  rows: 48,
  map: MAP,
  areas: AREA_DEFS,
  areaStyle: AREA_STYLE,
  wallStyle: WALL_STYLE,
  floorStyle: FLOOR_STYLE,
  floorTint: FLOOR_TINT,
  doorCount: 6, // door digits 1..6 on the map; door n is 'd<n>', and only the first starts open
  entryDoor: [null, 'd1', 'd2', 'd3', 'd4', 'd5'], // the door each area is entered by, per area index (robots face it)
  kinds: KINDS,
  picks: PICKS,
  startYaw: -Math.PI / 2,
  exitR: 1.5,
  fog: { colour: 0x0b0608, near: 6, far: 40 },
  ambient: { sky: 0xb0a09a, ground: 0x6e5c54, intensity: 2.2 },
  look: { exposure: 1.3, bloom: 0.55, vignette: 0.35, grade: { lift: [0.012, 0.004, 0.016], gamma: [1.0, 0.98, 0.95], gain: [1.05, 1.0, 0.94] } },
  dark: false, // lit by the club's own lights; the gun torch is not needed (and stays off unless Naebun switches it on)
  fill: { colour: 0xfff0dd, intensity: 1.2, range: 15, decay: 1.6 }, // a gentle light on the camera, part of this level's look
  torch: { colour: 0xfff0d8, intensity: 32, distance: 24, angle: 0.4, penumbra: 0.55, decay: 1.5, beam: 16 },
};
