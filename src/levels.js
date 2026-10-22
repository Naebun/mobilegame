// Content for the campaign: enemies, bosses, levels, upgrades and the jokes.
// Pure data, no logic, so tuning the game mostly means editing this file.

export const ENEMIES = {
  stag:    { r: 15, hp: 2, speed: 48,  score: 10, colour: '#6f9a7a', accent: '#b91c1c', ai: 'chase' },
  hen:     { r: 11, hp: 1, speed: 94,  score: 15, colour: '#b7c9a3', accent: '#f472b6', ai: 'chase', pack: 2 },
  tourist: { r: 17, hp: 4, speed: 38,  score: 25, colour: '#7c9a8a', accent: '#facc15', ai: 'chase' },
  busker:  { r: 13, hp: 3, speed: 55,  score: 30, colour: '#8aa38b', accent: '#fb923c', ai: 'ranged' },
  bouncer: { r: 23, hp: 8, speed: 36,  score: 40, colour: '#4f6f6a', accent: '#e5e7eb', ai: 'chase' },
};

// abilities: charge (telegraphed dash), summon (spawns a pack), ring (slow bullets in a circle)
export const BOSSES = {
  bouncer: {
    name: 'THE BOUNCER', quote: 'Not in those trainers.', r: 36, hp: 50, speed: 46, score: 300,
    colour: '#2b2b36', abilities: { charge: { every: 4.2, windup: 0.8, dur: 0.55, speed: 430 } },
  },
  guide: {
    name: 'THE TOUR GUIDE', quote: 'Keep up! Mind the umbrella!', r: 36, hp: 65, speed: 44, score: 500,
    colour: '#c2410c', abilities: { summon: { every: 5, count: 4, type: 'tourist' } },
  },
  bestman: {
    name: 'THE BEST MAN', quote: 'Speech! SPEECH!', r: 36, hp: 80, speed: 50, score: 700,
    colour: '#1e3a8a',
    abilities: { charge: { every: 3.4, windup: 0.7, dur: 0.5, speed: 470 }, summon: { every: 8, count: 3, type: 'hen' } },
  },
  mascot: {
    name: 'THE MASCOT', quote: 'Hug?', r: 44, hp: 105, speed: 40, score: 900,
    colour: '#a16207',
    abilities: { charge: { every: 5, windup: 0.9, dur: 0.6, speed: 400 }, ring: { every: 6, n: 12 } },
  },
  headliner: {
    name: 'THE HEADLINER', quote: "You've been a wonderful audience.", r: 42, hp: 160, speed: 48, score: 1500,
    colour: '#6d28d9',
    abilities: {
      charge: { every: 4.5, windup: 0.7, dur: 0.55, speed: 450 },
      ring: { every: 6.5, n: 14 },
      summon: { every: 9, count: 4, type: 'hen' },
    },
  },
};

// mix: [enemy type, weight, fraction of the night before it can appear]
// obstacles: [x fraction, y fraction, radius, kind] inside the playable area
export const LEVELS = [
  {
    id: 'cowgate', name: 'THE COWGATE',
    sub: 'Basement club. Sticky floor. Dead punters.',
    line: 'Last orders was an hour ago. Nobody told them.',
    clock: [30, 90], duration: 50, spawn: [2.6, 1.3], cap: 9,
    floor: { pattern: 'tiles', a: '#231b3a', b: '#1c1530', lit: ['#ff2e93', '#7c3aed', '#22d3ee'], wall: '#2a2140' },
    mix: [['stag', 10, 0], ['hen', 3, 0.35]],
    obstacles: [[0.2, 0.3, 22, 'speaker'], [0.8, 0.3, 22, 'speaker'], [0.5, 0.64, 20, 'speaker']],
    boss: 'bouncer',
  },
  {
    id: 'royalmile', name: 'THE ROYAL MILE',
    sub: 'Rain, cobbles and a walking tour that never ended.',
    line: 'Nobody paid for this tour. They are taking it anyway.',
    clock: [105, 165], duration: 55, spawn: [2.4, 1.2], cap: 11, rain: true,
    floor: { pattern: 'cobbles', base: '#0c0b12', stones: ['#272a3a', '#2e3245', '#222536'], wall: '#1d1f2c' },
    mix: [['tourist', 8, 0], ['stag', 6, 0], ['busker', 4, 0.3]],
    obstacles: [[0.25, 0.25, 14, 'lamp'], [0.78, 0.5, 14, 'lamp'], [0.3, 0.72, 20, 'bin'], [0.72, 0.18, 20, 'bin']],
    boss: 'guide',
  },
  {
    id: 'grassmarket', name: 'THE GRASSMARKET',
    sub: 'Stag dos, hen dos and a pub crawl that lost the plot.',
    line: 'Nobody has ever made it to the second pub.',
    clock: [180, 240], duration: 60, spawn: [2.2, 1.1], cap: 13, rain: true,
    floor: { pattern: 'cobbles', base: '#120d0a', stones: ['#3a2e28', '#43342d', '#33282a'], wall: '#2b2019' },
    mix: [['stag', 8, 0], ['hen', 8, 0], ['tourist', 4, 0.2], ['busker', 3, 0.4]],
    obstacles: [[0.22, 0.4, 14, 'lamp'], [0.8, 0.28, 20, 'bin'], [0.5, 0.52, 18, 'bin'], [0.75, 0.75, 14, 'lamp']],
    boss: 'bestman',
  },
  {
    id: 'gardens', name: "PRINCES STREET GARDENS",
    sub: 'Pretty. Quiet. Surrounded.',
    line: 'The buskers have been dead for years. Nobody noticed.',
    clock: [255, 300], duration: 65, spawn: [2.0, 1.0], cap: 15,
    floor: { pattern: 'grass', base: '#0b140f', tuft: '#1f3a28', path: '#2a2c33', wall: '#16241b' },
    mix: [['tourist', 6, 0], ['busker', 6, 0], ['hen', 6, 0], ['stag', 4, 0], ['bouncer', 3, 0.4]],
    obstacles: [[0.5, 0.45, 26, 'monument'], [0.15, 0.22, 24, 'tree'], [0.85, 0.7, 24, 'tree'], [0.82, 0.2, 14, 'lamp'], [0.18, 0.75, 14, 'lamp']],
    boss: 'mascot',
  },
  {
    id: 'arthursseat', name: "ARTHUR'S SEAT",
    sub: 'Up we go. Dawn is coming. So is everyone.',
    line: 'Fifteen minutes to the summit. It was never fifteen minutes.',
    clock: [315, 380], duration: 70, spawn: [1.8, 0.9], cap: 17,
    floor: { pattern: 'grass', base: '#0f1612', tuft: '#34503a', rock: true, wall: '#1d2a22' },
    mix: [['stag', 6, 0], ['hen', 6, 0], ['tourist', 5, 0], ['busker', 5, 0.1], ['bouncer', 5, 0.3]],
    obstacles: [[0.25, 0.3, 28, 'crag'], [0.75, 0.42, 30, 'crag'], [0.45, 0.72, 24, 'crag'], [0.85, 0.15, 22, 'crag']],
    boss: 'headliner',
  },
];

// kind: 'rate' | 'twin' | ... ; max: how many times it can be taken
export const UPGRADES = [
  { id: 'rate',   name: 'FASTER HANDS',  desc: 'Fire 22% faster. Fifteen years of practice, paying off.', max: 3 },
  { id: 'twin',   name: 'TWIN DECKS',    desc: 'One extra blast per shot. Twice the bass, twice the fun.', max: 2 },
  { id: 'pierce', name: 'BASS BOOST',    desc: 'Blasts go through one more enemy. Like a Tuesday.', max: 2 },
  { id: 'dmg',    name: 'DISTORTION',    desc: '+1 damage per blast. Turn it up until something breaks.', max: 2 },
  { id: 'hp',     name: 'CHIPPY SUPPER', desc: '+1 max heart. Deep-fried, naturally.', max: 2 },
  { id: 'speed',  name: 'DANCING SHOES', desc: 'Move 12% faster. Mostly for running away.', max: 2 },
  { id: 'torch',  name: 'PHONE TORCH',   desc: '25% more light. Finally, a use for it.', max: 2 },
];

export const TOASTS = [
  [0.25, 'They can hear the bass.'],
  [0.5, 'Keep moving.'],
  [0.78, 'Is that the sun?'],
];

export const DEATH_LINES = [
  'Reviewed: one star. "Dead on arrival."',
  'Not the first DJ to get booed off in Edinburgh.',
  'Aye, it is like that on a Saturday.',
  'Last orders, Freddie.',
  'You have had worse Fringe gigs.',
  'The crowd was not feeling it.',
];

export const WIN_LINES = [
  'DAWN.',
  'Edinburgh is still standing. Mostly.',
  'Freddie gets paid in exposure.',
];
