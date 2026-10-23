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
export const WEAPON_ORDER = ['pistol', 'shotgun', 'smg', 'launcher', 'vinyl', 'beam', 'grenade', 'airhorn']; // the last three are prepared (see below)

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
  name: 'SHIELDED FIZZBANG BOT', hp: 70, speed: 2.7, ranged: false, reach: 1.9, windup: 0.7, swing: 0.45, cooldown: 1.3,
  damage: 16, score: 200, wakeRange: 16, turn: 1.9, shield: { arc: 1.1, mult: 0.12, closeMult: 0.5 },
};
ENEMY_DEFS.tourguide = {
  name: 'THE TOUR GUIDE', boss: true, hp: 360, speed: 2.9, ranged: true, damage: 10, score: 1200, wakeRange: 24,
  shotInterval: [1.9, 2.6], aim: 0.5, shoot: 0.35, projSpeed: 12, keepMin: 6, keepMax: 12, range: 28,
  volley: 3, volleySpread: 0.2, quote: 'Please keep up. And do not touch the exhibits.',
  slam: { reach: 2.4, windup: 0.7, swing: 0.45, cooldown: 2.4, damage: 20 },
  enrage: { at: 0.5, volley: 4, volleySpread: 0.17, shotInterval: [1.0, 1.5], speed: 1.25, line: 'Right. That is it. No refunds.' },
};

// Prepared enemies (docs/enemies-next.md): built and tested, NOT placed in any level. `ai` picks the behaviour in
// game3d.js (updateSpecial). Normal-mode numbers only, like everything here.
// Fizzbang Shaken (Dr Fizzbang camp, so melee only): a can that rattles faster as it nears (`rattle`, in Hz, between `far`
// and `near` metres), primes inside `prime.range` (a lunge at `prime.speed`, steering at `prime.steer` rad/s) and bursts
// when the fuse ends, when it touches Naebun (not within the first 0.3 s of priming), or when it dies. The blast does
// `burst.player` to Naebun and `burst.robots` to every robot inside `burst.radius`, falling to `burst.floor` of that at the
// edge. A Shaken caught in a blast primes at once with a fuse of `burst.chain` x (0.5 + distance / radius) seconds.
ENEMY_DEFS.shaken = {
  name: 'FIZZBANG SHAKEN', ai: 'shaken', hp: 30, speed: 3.6, ranged: false, reach: 1.1, score: 120, wakeRange: 16, noRevive: true,
  rattle: { min: 4, max: 26, near: 2.5, far: 14 },
  prime: { range: 3.4, fuse: 0.75, speed: 5.0, steer: 1.6 },
  burst: { radius: 3.2, player: 32, robots: 45, floor: 0.35, knock: 7, chain: 0.3 },
};
// Bampot Longshot (Bampot camp): keeps its distance and snipes. `charge.track` seconds with a red laser line that follows
// Naebun (swinging no faster than `charge.turn` rad/s), then `charge.lock` seconds with the line frozen and white-hot, then one
// hitscan shot along that line for `damage` if Naebun is within `shot.halfWidth` of it and nothing solid is in the way.
// `charge.lose`: how long it tolerates losing sight while tracking before it gives up. `shot.recover`: pause after firing.
// `shot.warn`: an arc on the HUD (the damage arcs) at the moment of lock, for a Longshot Naebun is not looking at.
ENEMY_DEFS.longshot = {
  name: 'BAMPOT LONGSHOT', ai: 'longshot', hp: 40, speed: 2.3, ranged: true, damage: 38, score: 250, wakeRange: 30, range: 40,
  keepMin: 12, keepMax: 26, cooldown: [3.0, 4.2],
  charge: { track: 1.1, lock: 0.55, turn: 2.4, lose: 0.5 },
  shot: { halfWidth: 0.5, recover: 0.55, aimY: 1.2, warn: true },
};
// Bampot Nurse (Bampot camp, support): never attacks. Revives a dead robot of its own area (not a boss, not a Shaken, not
// another Nurse, each robot once) that lies within `revive.range` and in sight, `revive.time` seconds after it starts, to
// `revive.hp` of its health, if the Nurse is still alive. A body is revivable for `revive.window` seconds. A revive takes
// the kill (and its score) back, so kills and score stay true. It walks away from Naebun at `speed` when nearer than `flee.from`.
ENEMY_DEFS.nurse = {
  name: 'BAMPOT NURSE', ai: 'nurse', hp: 40, speed: 1.7, ranged: false, support: true, noRevive: true, score: 200, wakeRange: 16,
  revive: { range: 6, time: 3.6, hp: 0.6, window: 14, rise: 0.9 },
  flee: { from: 9 },
};
// Vending Mimic (Dr Fizzbang camp, melee only): a drinks machine until Naebun comes within `dormant.wake` metres in sight, or
// shoots it; then `dormant.unfold` seconds of unfolding (it can be hurt, it cannot attack) and an ordinary melee robot.
// While dormant it is hit exactly like a robot (same cylinder: radius from the model, `dormant.h` tall, headshots above
// `dormant.headY`, no armour), counts as a robot for its area, is immovable, and ignores noise and other robots waking.
ENEMY_DEFS.mimic = {
  name: 'VENDING MIMIC', ai: 'mimic', hp: 100, speed: 3.1, ranged: false, reach: 2.0, windup: 0.6, swing: 0.4, cooldown: 1.2,
  damage: 22, score: 300, wakeRange: 3.4, dormant: { wake: 3.4, unfold: 0.9, h: 1.92, headY: 1.62 },
};

export const PLAYER = {
  health: 100, speed: 4.4,
  // drag sensitivity in radians per pixel, and the continuous turn rate (rad/s) when the thumb rests at the box edge
  lookX: 0.009, lookY: 0.0075, edgeTurn: 2.4,
  // mouse look, radians per mouse count at MEDIUM sensitivity
  mouse: 0.0022,
};

// One entry per level. `hints` is the banner under an area's name when Naebun first steps into it (keyed by area id),
// `done*` is the level-complete text, `voicemail` plays before the level starts (Cheryl, the agent), `titleArea` is the
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
    doneSub: 'Naebun gets paid in exposure.',
    voicemail: null,
  },
  {
    number: 2,
    name: 'THE VAULTS',
    sub: 'Damp stone. No signal. Tours cancelled.',
    line: 'Bring a torch. Bring a plan.',
    clock: '03:10',
    titleArea: 'plague',
    hints: {
      steps: 'Pitch black down here. Fit the torch to the pistol.',
      longvault: 'Dark between the torches. Stay out of it.',
      casks: 'Shields stop shots from the front. Go round the back.',
      close: 'Tight corners. Check them before you turn them.',
      plague: 'The Vinyl Disc bounces. Use the walls.',
      tour: 'The last tour of the night.',
    },
    doneTitle: 'TOUR OVER.',
    doneLine: 'The Vaults are quiet. Nobody has asked for a refund.',
    doneSub: 'Somewhere above, a bag is on its way up a hill.',
    voicemail: {
      from: 'CHERYL (AGENT)',
      lines: [
        'Naebun, good news. The venue is paying in cash.',
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
  'Last orders, Naebun.',
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
// wipes out every robot around Naebun. It does not stop time. Rules: never in a boss room, never hurts a boss, and is
// refused while a boss is awake. Naebun cannot move or fire during the spin and cannot be hurt.
DRINKS.lastorders = {
  id: 'lastorders', name: 'LAST ORDERS', super: true, duration: 2.2, line: 'Time, gentlemen, please.',
  laser: { seconds: 3.4, charge: 0.45, tail: 0.3, turns: 2, radius: 26, width: 0.9 },
};
export const DRINK_ORDER = ['dram', 'orange', 'heavy', 'energy', 'lastorders'];

// ---------------------------------------------------------------------------------------------
// The prepared arsenal (docs/arsenal.md). Built and tested ahead of the levels that will use them, and not placed in any
// level yet. `prepared: true` keeps a weapon off the HUD strip until Naebun owns it and out of giveWeapons' default.
// kind 'beam' is a held-trigger hitscan, 'grenade' a thrown bouncing projectile, 'cone' an instant shockwave in front.
// Every number here is for normal mode (debug mode only multiplies damage and fire rate, as for the other weapons).
// ---------------------------------------------------------------------------------------------

// Feedback Beam: no clip, a charge meter. Holding the trigger drains `drain` units a second and burns whatever the
// crosshair rests on, at `dps` rising to `dpsMax` over `ramp` seconds on the same target (the feedback builds). Let go and
// the meter trickles back after `rechargeDelay`; run it dry, or tap RELOAD, and it recharges in full over `reload`.
WEAPONS.beam = {
  id: 'beam', name: 'FEEDBACK BEAM', kind: 'beam', prepared: true, clip: 100, interval: 0.1, reload: 2.2, range: 18,
  drain: 20, dps: 24, dpsMax: 96, ramp: 2, tick: 0.1, grace: 0.3, rechargeDelay: 0.7, recharge: 16, noise: 8, kick: 0.004,
};
// Bass-Drop Grenade: thrown in an arc, bounces (`bounce` keeps this much speed), and after `fuse` seconds drops the bass:
// a shockwave out to `radius` that hurts a little and stuns every robot it reaches for `stun` seconds (`bossStun` of that
// for a boss). Walls stop it, as they stop sound a robot would notice.
WEAPONS.grenade = {
  id: 'grenade', name: 'BASS-DROP GRENADE', kind: 'grenade', prepared: true, clip: 3, interval: 0.9, reload: 2.2,
  speed: 12, lift: 3.2, gravity: 16, bounce: 0.45, fuse: 1.7, radius: 7, damage: 14, stun: 3.5, bossStun: 0.3, knock: 5, noise: 14, kick: 0.05,
};
// Airhorn: an instant shockwave in a cone `arc` radians either side of the crosshair out to `range`. Shoves robots back,
// stuns them briefly and does little damage. It ignores shields (it is a wave, not a bullet).
WEAPONS.airhorn = {
  id: 'airhorn', name: 'AIRHORN', kind: 'cone', prepared: true, clip: 4, interval: 0.9, reload: 2, range: 7, arc: 0.62,
  damage: 8, stun: 1.4, bossStun: 0.3, knock: 14, noise: 22, kick: 0.07,
};
export const PREPARED_WEAPONS = Object.keys(WEAPONS).filter((id) => WEAPONS[id].prepared);

// SMG alt-fire, available once the `altfire` upgrade is owned: a short, tight burst of `rounds` rounds at double damage
// (the SMG does 7), `gap` seconds apart, then `cooldown` before it can be used again. The rounds come out of the clip.
export const ALT_FIRE = {
  smg: { name: 'TWEETER BURST', rounds: 4, gap: 0.05, damage: 14, spread: 0.004, cooldown: 3.2, range: 60, knock: 1.2, noise: 18 },
};

// Upgrades are pickups found in levels, kept for the run (not saved). Each tier of `clip` multiplies every weapon's clip
// (and the Feedback Beam's meter); each tier of `reload` multiplies every reload time.
export const UPGRADES = {
  clip: { id: 'clip', name: 'EXTENDED CLIPS', short: 'CLIP', tiers: [1.4, 1.8], line: 'Every clip holds more.' },
  reload: { id: 'reload', name: 'SPEED LOADER', short: 'LOAD', tiers: [0.75, 0.55], line: 'Every reload is quicker.' },
  altfire: { id: 'altfire', name: 'BURST PEDAL', short: 'ALT', tiers: [1], line: 'The Tweeter SMG has a second mode.' },
};
export const UPGRADE_ORDER = ['clip', 'reload', 'altfire'];

// Collectible records, each with one joke. Found records are saved (src/save.js) and listed on the SETLIST screen.
// Label colours on the model repeat every four records. The ids are what the save stores, so never rename one.
export const RECORDS = [
  { id: 'haar', title: 'HAAR ON THE WATER', line: 'Eleven minutes of fog and a tambourine. Very Leith.' },
  { id: 'bypass', title: 'THE BYPASS DUB', line: 'Recorded in traffic. Released in traffic.' },
  { id: 'gala', title: 'GALA DAY, SLOW VERSION', line: 'Played at the wrong speed. Nobody noticed. It was a gala.' },
  { id: 'pipes', title: 'PIPES AND PRESSURE', line: 'Bagpipes over a four-four kick. The robots are undecided.' },
  { id: 'wee', title: 'WEE HOURS EP', line: 'Shorter than your overdraft. Just.' },
  { id: 'supper', title: 'SUPPER AFTER LAST ORDERS', line: 'Deep-fried pizza in twelve inch. Edinburgh at its finest.' },
  { id: 'tram', title: 'TRAM WORKS, EXTENDED MIX', line: 'Ten years of roadworks over a click track.' },
  { id: 'hold', title: "CHERYL'S HOLD MUSIC", line: 'She swears this counts as a release.' },
  { id: 'foot', title: 'FIRST FOOT FIRST', line: 'A Hogmanay banger. Nobody has found the coal.' },
  { id: 'refund', title: 'NO REFUNDS, B-SIDE', line: "The Tour Guide's greatest hit. No refunds." },
];

// ---------------------------------------------------------------------------------------------
// Difficulty (docs/difficulty.md). Hard and Extra Hard are multipliers on top of the normal-mode numbers above, picked once
// per run on the difficulty screen and saved. They change robots only: never Naebun's weapons, health, pickups, stun
// durations or score values, and never the maps or what is placed where. Normal is all 1s and leaves ENEMY_DEFS untouched.
// Balance is still for normal mode alone: tune the table below, never the base numbers against it, and never against debug.
//   damage  multiplies what a robot does to Naebun: melee, slam, bottles, the Longshot's shot, the Shaken's blast on Naebun
//   health  multiplies a robot's hp (a Nurse's revive is a fraction of the new maximum, so it follows)
//   speed   multiplies how fast a robot walks (the Shaken's lunge too); projectile speed and the enrage factor are left alone
//   windup  multiplies how long a robot telegraphs before it strikes (0.9 = 10 percent quicker); see TELEGRAPH_FLOOR
// ---------------------------------------------------------------------------------------------
export const DIFFICULTY = {
  normal: { id: 'normal', name: 'NORMAL', tag: '', line: 'The game as designed.', damage: 1, health: 1, speed: 1, windup: 1 },
  hard: { id: 'hard', name: 'HARD', tag: 'HARD', line: 'Robots hit harder, last longer and move faster.', damage: 1.5, health: 1.25, speed: 1.1, windup: 0.9 },
  extra: { id: 'extra', name: 'EXTRA HARD', tag: 'EXTRA HARD', line: 'Double damage, tougher and quicker again.', damage: 2, health: 1.5, speed: 1.2, windup: 0.8 },
};
export const DIFFICULTY_ORDER = ['normal', 'hard', 'extra'];
// A warning is never shortened below this many seconds (a wind-up already shorter than it is left as it is). It is the time
// Naebun gets to see a swing, a lock or a fuse and step out of it, so it matters more than any multiplier.
export const TELEGRAPH_FLOOR = 0.35;

const quicker = (secs, k) => (Number.isFinite(secs) ? Math.max(secs * k, Math.min(secs, TELEGRAPH_FLOOR)) : secs);
const scaled = (v, k) => (Number.isFinite(v) ? Math.round(v * k) : v);

// The numbers of one robot kind in one mode. Normal returns the very same object. Called once per robot, when it is spawned,
// so every attack and every movement afterwards reads the scaled numbers from `e.def` and nothing else has to know.
export function defFor(kind, mode = 'normal', table = DIFFICULTY) {
  const base = ENEMY_DEFS[kind];
  const d = table[mode];
  if (!base || !d || (d.damage === 1 && d.health === 1 && d.speed === 1 && d.windup === 1)) return base;
  const out = { ...base };
  if (base.hp !== undefined) out.hp = scaled(base.hp, d.health);
  if (base.speed !== undefined) out.speed = base.speed * d.speed;
  if (base.damage !== undefined) out.damage = scaled(base.damage, d.damage);
  if (base.windup !== undefined) out.windup = quicker(base.windup, d.windup);
  if (base.aim !== undefined) out.aim = quicker(base.aim, d.windup); // a ranged robot's raise-and-aim
  if (base.slam) out.slam = { ...base.slam, damage: scaled(base.slam.damage, d.damage), windup: quicker(base.slam.windup, d.windup) };
  if (base.charge) out.charge = { ...base.charge, track: quicker(base.charge.track, d.windup), lock: quicker(base.charge.lock, d.windup) }; // Longshot
  if (base.prime) out.prime = { ...base.prime, fuse: quicker(base.prime.fuse, d.windup), speed: base.prime.speed * d.speed }; // Shaken
  if (base.burst) out.burst = { ...base.burst, player: scaled(base.burst.player, d.damage) }; // `robots` (damage to other robots) stays
  if (base.dormant) out.dormant = { ...base.dormant, unfold: quicker(base.dormant.unfold, d.windup) }; // Mimic
  return out;
}
