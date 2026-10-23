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
    shieldBreak: 3.5, // inside this range the blast shoves a shield aside, so it only half stops the pellets
  },
  smg: {
    id: 'smg', name: 'TWEETER SMG', kind: 'hitscan', clip: 30, interval: 0.075, reload: 1.6,
    damage: 7, pellets: 1, spread: 0.012, spreadGrow: 0.004, spreadMax: 0.05, knock: 0.6, range: 50, kick: 0.006, noise: 18,
  },
  launcher: {
    id: 'launcher', name: 'REVERB LAUNCHER', kind: 'projectile', clip: 3, interval: 1.1, reload: 2.4,
    damage: 60, splashRadius: 3.6, splashDamage: 70, speed: 20, knock: 9, kick: 0.07, noise: 24,
  },
  // Level 2. A record flung flat and fast. It bounces off walls (`bounces` times, then it drops) and stops in the first
  // robot it hits, so a bounce is how to reach the unprotected back of a shielded robot.
  vinyl: {
    id: 'vinyl', name: 'VINYL DISC', kind: 'projectile', bounces: 3, clip: 8, interval: 0.42, reload: 1.7,
    damage: 36, speed: 26, life: 3, knock: 2.5, kick: 0.03, noise: 14,
  },
};
export const WEAPON_ORDER = ['pistol', 'shotgun', 'smg', 'launcher', 'vinyl'];

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
    name: 'THE BOUNCER', boss: true, hp: 450, speed: 3.3, ranged: false, reach: 2.7, windup: 0.8, swing: 0.4, cooldown: 1.5,
    damage: 28, score: 1000, wakeRange: 22, quote: 'Not in those trainers.',
  },
};

// Level 2. The shielded one holds a vending-machine door: hits from inside `arc` (radians either side of where it faces)
// do `mult` of their damage, or `closeMult` for a shotgun blast inside the weapon's `shieldBreak` range. Explosions and
// anything from the sides or behind do full damage. `turn` is how fast it can swing round (rad/s; the others use 7), so
// a player who keeps moving can get behind it. The Tour Guide is the boss: a Bampot-camp robot, so it shoots, but it
// also swings its lantern pole at anyone who gets close. At half health it enrages: bigger volleys, faster.
ENEMY_DEFS.shielded = {
  name: 'SHIELDED FIZZBANG BOT', hp: 85, speed: 2.7, ranged: false, reach: 1.9, windup: 0.7, swing: 0.45, cooldown: 1.3,
  damage: 16, score: 200, wakeRange: 16, turn: 1.9, shield: { arc: 1.1, mult: 0.12, closeMult: 0.5 },
};
ENEMY_DEFS.tourguide = {
  name: 'THE TOUR GUIDE', boss: true, hp: 520, speed: 2.9, ranged: true, damage: 12, score: 1200, wakeRange: 24,
  shotInterval: [1.6, 2.3], aim: 0.5, shoot: 0.35, projSpeed: 12, keepMin: 6, keepMax: 12, range: 28,
  volley: 3, volleySpread: 0.2, quote: 'Please keep up. And do not touch the exhibits.',
  slam: { reach: 2.9, windup: 0.7, swing: 0.45, cooldown: 2.4, damage: 24 },
  enrage: { at: 0.5, volley: 5, volleySpread: 0.17, shotInterval: [1.0, 1.5], speed: 1.25, line: 'Right. That is it. No refunds.' },
};

export const PLAYER = {
  health: 100, speed: 4.4,
  // drag sensitivity in radians per pixel, and the continuous turn rate (rad/s) when the thumb rests at the box edge
  lookX: 0.009, lookY: 0.0075, edgeTurn: 2.4,
};

// One entry per level. `hints` is the banner under an area's name when Freddie first steps into it (keyed by area id),
// `done*` is the level-complete text, `voicemail` plays before the level starts (Cheryl, his agent), `titleArea` is the
// area the menu backdrop drifts through.
export const LEVELS = [
  {
    number: 1,
    name: 'THE COWGATE',
    sub: 'Basement club. Sticky floor. Faulty robots.',
    line: 'The bar was restocked this morning. Nobody checked with what.',
    clock: '02:00',
    titleArea: 'dancefloor',
    hints: {
      stairwell: 'Walk over weapons to pick them up.',
      cloakroom: 'Dr Fizzbang bots: all fists, no manners.',
      dancefloor: 'Use the speaker stacks for cover.',
      bar: 'Bampot and Nephew bots throw bottles. Keep moving.',
      vip: 'Long corridor. Short temper.',
      backstage: 'Not in those trainers.',
    },
    doneTitle: 'CLEARED.',
    doneLine: 'The Cowgate is quiet. Mostly.',
    doneSub: 'Freddie gets paid in exposure.',
    voicemail: null,
  },
  {
    number: 2,
    name: 'THE VAULTS',
    sub: 'Damp stone. No signal. Tours cancelled.',
    line: 'Your torch works. Your luck, less so.',
    clock: '03:10',
    titleArea: 'plague',
    hints: {
      steps: 'Pistol only. The torch is not optional.',
      longvault: 'Dark between the torches. Stay out of it.',
      casks: 'Shielded bots: go round the back, or bring something loud.',
      close: 'Tight corners. Check them before you turn them.',
      plague: 'Vinyl Disc bounces. Use the walls.',
      tour: 'The last tour of the night.',
    },
    doneTitle: 'TOUR OVER.',
    doneLine: 'The Vaults are quiet. Nobody has asked for a refund.',
    doneSub: 'Somewhere above, a bag is on its way up a hill.',
    voicemail: {
      from: 'CHERYL (AGENT)',
      lines: [
        'Freddie, good news. The venue is paying in cash.',
        'Bad news, the cash is also a robot.',
        'Your bag went down into the Vaults under South Bridge. I have booked you on the 3am tour. Group rate.',
        'Do not shake anything.',
      ],
    },
  },
];
export const LEVEL = LEVELS[0]; // older callers
// Kept for older callers: level 1's area hints.
export const AREA_HINTS = LEVELS[0].hints;

export const DEATH_LINES = [
  'Reviewed: one star. "Robotic, and not in a good way."',
  'Not the first DJ to get booed off in Edinburgh.',
  'Last orders, Freddie.',
  'You have had worse Fringe gigs.',
  'The robots were not feeling it.',
  'Turns out the warranty does not cover you.',
];

// Power-ups are drinks. Walking onto one plays a first-person drinking animation (the model's `duration` is the
// length of the animation), then the effect lands at about 65 percent through it. All names are invented.
// heal: instant health. buff: a timed effect for `seconds`. These numbers are for normal mode only.
export const DRINKS = {
  dram: { id: 'dram', name: 'WEE DRAM', heal: 35, duration: 1.2, line: 'Aaah. That hit the spot.' },
  orange: {
    id: 'orange', name: 'BRUISER ORANGE', buff: 'speed', mult: 1.25, seconds: 20, duration: 1.6, label: 'FAST', line: 'Fizzy. Faster.',
  },
  heavy: {
    id: 'heavy', name: 'PINT OF HEAVY', buff: 'guard', mult: 0.5, seconds: 20, duration: 2.0, label: 'TOUGH', line: 'Liquid courage.',
  },
  energy: {
    id: 'energy', name: 'BASSLINE ENERGY', buff: 'rapid', mult: 1.5, reload: 0.35, seconds: 15, duration: 1.7, label: 'RAPID', line: 'Everything is louder.',
  },
};
// The super power-up. Drinking it (the usual animation) is followed by a spin on the spot with a huge laser that
// wipes out every robot around Freddie. It does not stop time. Rules: never in a boss room, never hurts a boss, and is
// refused while a boss is awake. Freddie cannot move or fire during the spin and cannot be hurt.
DRINKS.lastorders = {
  id: 'lastorders', name: 'LAST ORDERS', super: true, duration: 2.2, line: 'Time, gentlemen, please.',
  laser: { seconds: 3.4, charge: 0.45, tail: 0.3, turns: 2, radius: 26, width: 0.9 },
};
export const DRINK_ORDER = ['dram', 'orange', 'heavy', 'energy', 'lastorders'];
