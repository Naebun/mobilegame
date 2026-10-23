// Game content for the first-person game: weapons, enemies, level text and jokes.
// Plain data, so tuning mostly means editing this file. Debug mode multipliers are NOT here on purpose:
// balance is for normal mode only (see CLAUDE.md).

// kind 'hitscan' fires instantly along the crosshair; 'projectile' launches a rocket.
// Ammo is unlimited: each weapon only has a limited clip, reloaded automatically when empty or by the RELOAD button.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'BASS PISTOL', kind: 'hitscan', clip: 12, interval: 0.28, reload: 1.1,
    damage: 18, pellets: 1, spread: 0.004, knock: 1.5, range: 70, kick: 0.012, noise: 16,
  },
  shotgun: {
    id: 'shotgun', name: 'SUBWOOFER SHOTGUN', kind: 'hitscan', clip: 6, interval: 0.85, reload: 2.0,
    damage: 9, pellets: 8, spread: 0.085, knock: 7, range: 22, kick: 0.06, noise: 20,
  },
  smg: {
    id: 'smg', name: 'TWEETER SMG', kind: 'hitscan', clip: 30, interval: 0.075, reload: 1.6,
    damage: 7, pellets: 1, spread: 0.012, spreadGrow: 0.004, spreadMax: 0.05, knock: 0.6, range: 50, kick: 0.006, noise: 18,
  },
  launcher: {
    id: 'launcher', name: 'REVERB LAUNCHER', kind: 'projectile', clip: 3, interval: 1.1, reload: 2.4,
    damage: 60, splashRadius: 3.6, splashDamage: 70, speed: 20, knock: 9, kick: 0.07, noise: 24,
  },
};
export const WEAPON_ORDER = ['pistol', 'shotgun', 'smg', 'launcher'];

// Dr Fizzbang robots only ever fight in melee. Bampot and Nephew robots can shoot. The Bouncer is a big Dr Fizzbang variant.
export const ENEMY_DEFS = {
  fizzbang: {
    name: 'DR FIZZBANG BOT', hp: 60, speed: 3.4, ranged: false, reach: 1.8, windup: 0.55, swing: 0.4, cooldown: 1.1,
    damage: 12, score: 100, wakeRange: 16,
  },
  bampot: {
    name: 'BAMPOT AND NEPHEW BOT', hp: 45, speed: 2.6, ranged: true, damage: 10, score: 150, wakeRange: 18,
    shotInterval: [1.9, 2.8], aim: 0.55, shoot: 0.35, projSpeed: 11, keepMin: 7, keepMax: 13, range: 24,
  },
  bouncer: {
    name: 'THE BOUNCER', hp: 450, speed: 3.3, ranged: false, reach: 2.7, windup: 0.8, swing: 0.4, cooldown: 1.5,
    damage: 28, score: 1000, wakeRange: 22, quote: 'Not in those trainers.',
  },
};

export const PLAYER = {
  health: 100, speed: 4.4, medkit: 35,
  // drag sensitivity in radians per pixel, and the continuous turn rate (rad/s) when the thumb rests at the box edge
  lookX: 0.009, lookY: 0.0075, edgeTurn: 2.4,
};

export const LEVEL = {
  number: 1,
  name: 'THE COWGATE',
  sub: 'Basement club. Sticky floor. Faulty robots.',
  line: 'The bar was restocked this morning. Nobody checked with what.',
  clock: '02:00',
};

// Shown as a banner when Freddie first steps into an area (keyed by area id); falls back to the area objective.
export const AREA_HINTS = {
  stairwell: 'Walk over weapons to pick them up.',
  cloakroom: 'Dr Fizzbang bots: all fists, no manners.',
  dancefloor: 'Use the speaker stacks for cover.',
  bar: 'Bampot and Nephew bots throw bottles. Keep moving.',
  vip: 'Long corridor. Short temper.',
  backstage: 'Not in those trainers.',
};

export const DEATH_LINES = [
  'Reviewed: one star. "Robotic, and not in a good way."',
  'Not the first DJ to get booed off in Edinburgh.',
  'Last orders, Freddie.',
  'You have had worse Fringe gigs.',
  'The robots were not feeling it.',
  'Turns out the warranty does not cover you.',
];
