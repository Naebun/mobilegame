// All sound is synthesised with Web Audio: no files to host or license.
// unlock() must be called from a user gesture. Everything else is a no-op until the context runs.

let SPB = 60 / 118;
let SIXTEENTH = SPB / 4;
let root = 0; // semitones the bass and drone are shifted by, set per level
const BASS = { 0: 0, 3: 0, 6: 3, 8: 0, 10: 5, 14: -2 }; // step -> semitones above E2

let ac = null;
let sfxBus, musicBus, musicFilter, noiseBuf;
let nextTime = 0;
let step = 0;
let bar = 0;
let beatNo = 0;
let intensity = 0;
let muffled = false;
const kicks = []; // scheduled { t, n } so visuals can follow the audible beat

const running = () => ac && ac.state === 'running';

export function unlock() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    comp.connect(ac.destination);
    const master = ac.createGain();
    master.gain.value = 0.8;
    master.connect(comp);
    musicFilter = ac.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = 18000;
    musicBus = ac.createGain();
    musicBus.gain.value = 0.55;
    musicBus.connect(musicFilter);
    musicFilter.connect(master);
    sfxBus = ac.createGain();
    sfxBus.gain.value = 0.8;
    sfxBus.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    nextTime = ac.currentTime + 0.1;
  }
  if (ac.state !== 'running') ac.resume().catch(() => {});
}

function env(g, t, attack, peak, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function osc(type, freq, t, dur, peak, dest, { attack = 0.005, to } = {}) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + dur);
  const g = ac.createGain();
  env(g, t, attack, peak, dur);
  o.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(t + attack + dur + 0.05);
}

function noise(t, dur, peak, dest, { type = 'highpass', freq = 2000, to } = {}) {
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ac.createGain();
  env(g, t, 0.003, peak, dur);
  s.connect(f);
  f.connect(g);
  g.connect(dest);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.05);
}

// ---- music ----

function scheduleStep(t, s) {
  if (s % 4 === 0) {
    osc('sine', 180, t, 0.14, 0.9, musicBus, { to: 50 });
    noise(t, 0.02, 0.25, musicBus, { freq: 1500 });
    kicks.push({ t, n: beatNo++ });
  }
  if (s % 4 === 2) noise(t, 0.05, 0.12, musicBus, { freq: 7000 });
  else if (intensity > 0.5 && s % 2 === 1) noise(t, 0.03, 0.06, musicBus, { freq: 8000 });
  if (s in BASS) {
    const f = 82.4 * 2 ** ((BASS[s] + root) / 12);
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 350 + intensity * 900;
    const g = ac.createGain();
    env(g, t, 0.01, 0.35, SIXTEENTH * 1.6);
    o.connect(lp);
    lp.connect(g);
    g.connect(musicBus);
    o.start(t);
    o.stop(t + SIXTEENTH * 2);
  }
  if (s === 0 && bar % 2 === 0) {
    // E and F together: a minor second, the unsettling bit
    const peak = 0.04 + intensity * 0.05;
    const k = 2 ** (root / 12);
    osc('triangle', 164.8 * k, t, 2.6, peak, musicBus, { attack: 1.4 });
    osc('triangle', 174.6 * k, t, 2.6, peak, musicBus, { attack: 1.4 });
  }
}

export function tick() {
  if (!running()) return;
  const now = ac.currentTime;
  if (nextTime < now - 0.3) nextTime = now + 0.05; // tab was backgrounded
  while (nextTime < now + 0.15) {
    scheduleStep(nextTime, step % 16);
    step++;
    if (step % 16 === 0) bar++;
    nextTime += SIXTEENTH;
  }
  while (kicks.length > 1 && kicks[1].t <= now) kicks.shift();
}

// { pulse: 1 on the kick decaying to 0, count: running beat number }
export function beat() {
  if (running() && kicks.length && kicks[0].t <= ac.currentTime) {
    return { pulse: Math.exp(-(ac.currentTime - kicks[0].t) * 7), count: kicks[0].n };
  }
  const t = performance.now() / 1000; // before audio starts, keep the visuals alive
  return { pulse: Math.exp(-(t % SPB) * 7), count: Math.floor(t / SPB) };
}

// Each level is a little faster and in a different key.
export function setLevel(i) {
  SPB = 60 / (118 + i * 4);
  SIXTEENTH = SPB / 4;
  root = [0, -2, 3, 5, 7][i] ?? 0;
}

export function setMood(i, isMuffled) {
  intensity = i;
  if (isMuffled !== muffled) {
    muffled = isMuffled;
    if (ac) musicFilter.frequency.setTargetAtTime(isMuffled ? 300 : 18000, ac.currentTime, 0.15);
  }
}

// ---- sound effects ----

// Each weapon sounds different: the pistol is a clean bass thump, the shotgun a wide boom, the SMG a dry tick.
export function shoot(kind = 'pistol') {
  if (!running()) return;
  const t = ac.currentTime;
  if (kind === 'shotgun') {
    osc('sine', 150, t, 0.3, 0.7, sfxBus, { to: 38 });
    noise(t, 0.28, 0.5, sfxBus, { type: 'lowpass', freq: 3500, to: 300 });
  } else if (kind === 'smg') {
    osc('square', 420 + Math.random() * 40, t, 0.05, 0.18, sfxBus, { to: 160 });
    noise(t, 0.04, 0.22, sfxBus, { freq: 4500 });
  } else if (kind === 'launcher') {
    osc('sawtooth', 200, t, 0.35, 0.4, sfxBus, { to: 55 });
    noise(t, 0.3, 0.25, sfxBus, { type: 'bandpass', freq: 500, to: 2000 });
  } else if (kind === 'vinyl') {
    // a record flung off the deck: a scratch, then a thin whirr
    osc('sawtooth', 900, t, 0.12, 0.2, sfxBus, { to: 240 });
    osc('triangle', 330, t + 0.03, 0.2, 0.25, sfxBus, { to: 620 });
    noise(t, 0.12, 0.2, sfxBus, { type: 'bandpass', freq: 2500, to: 900 });
  } else {
    osc('sine', 260 + Math.random() * 30, t, 0.14, 0.45, sfxBus, { to: 70 });
    noise(t, 0.06, 0.2, sfxBus, { freq: 3000 });
  }
}

// A shot landing on a robot's shield: a short dull clang, no damage worth the name.
export function clang() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('square', 820, t, 0.09, 0.14, sfxBus, { to: 700 });
  osc('square', 1370, t, 0.06, 0.1, sfxBus, { to: 1250 });
  noise(t, 0.04, 0.12, sfxBus, { freq: 3200 });
}

// A vinyl disc glancing off a wall: a bright ping that bends down.
export function ricochet() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sine', 2100 + Math.random() * 300, t, 0.25, 0.14, sfxBus, { to: 1100 });
  osc('triangle', 1250, t, 0.12, 0.08, sfxBus, { to: 700 });
}

// The torch clicking home on the rail: a short dry clack and a tick.
export function torchClick() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('square', 240, t, 0.05, 0.2, sfxBus, { to: 110 });
  osc('square', 1800, t + 0.03, 0.03, 0.1, sfxBus, { to: 1200 });
  noise(t, 0.04, 0.16, sfxBus, { freq: 3500 });
}

// The torch switching on: a small rising hum and a click.
export function torchOn() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sine', 180, t, 0.25, 0.12, sfxBus, { to: 520, attack: 0.05 });
  osc('square', 1500, t, 0.03, 0.12, sfxBus, { to: 900 });
}

export function reload(done = false) {
  if (!running()) return;
  const t = ac.currentTime;
  if (done) {
    osc('square', 300, t, 0.05, 0.2, sfxBus, { to: 520 });
    noise(t, 0.04, 0.2, sfxBus, { freq: 5000 });
  } else {
    osc('square', 180, t, 0.05, 0.18, sfxBus, { to: 110 });
    noise(t, 0.05, 0.15, sfxBus, { freq: 2500 });
  }
}

export function door() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sawtooth', 90, t, 0.6, 0.25, sfxBus, { to: 50, attack: 0.05 });
  noise(t, 0.5, 0.2, sfxBus, { type: 'bandpass', freq: 300, to: 900 });
}

// A heavy robot fist landing on Naebun.
export function melee() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sine', 120, t, 0.25, 0.7, sfxBus, { to: 40 });
  noise(t, 0.15, 0.4, sfxBus, { type: 'lowpass', freq: 1500, to: 200 });
}

// A robot lobbing a bottle.
export function spit() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('triangle', 500, t, 0.15, 0.2, sfxBus, { to: 250 });
  noise(t, 0.1, 0.12, sfxBus, { type: 'bandpass', freq: 1500, to: 600 });
}

export function kill() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sawtooth', 180, t, 0.25, 0.3, sfxBus, { to: 50 });
  noise(t, 0.25, 0.25, sfxBus, { type: 'lowpass', freq: 1200, to: 200 });
}

export function hurt() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('square', 110, t, 0.3, 0.3, sfxBus, { to: 55 });
  osc('square', 116.5, t, 0.3, 0.3, sfxBus, { to: 58 });
  noise(t, 0.2, 0.3, sfxBus, { type: 'lowpass', freq: 2000, to: 300 });
}

export function pickup() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sine', 660, t, 0.12, 0.3, sfxBus);
  osc('sine', 990, t + 0.08, 0.2, 0.3, sfxBus);
}

export function riser() {
  if (!running()) return;
  const t = ac.currentTime;
  noise(t, 1.4, 0.18, sfxBus, { type: 'bandpass', freq: 300, to: 3000 });
  osc('sine', 90, t, 1.4, 0.2, sfxBus, { to: 360, attack: 0.6 });
}

export function gameOver() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sawtooth', 220, t, 1.8, 0.4, sfxBus, { to: 30, attack: 0.01 });
  noise(t, 0.6, 0.3, sfxBus, { type: 'lowpass', freq: 800, to: 60 });
}

export function boom() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sine', 110, t, 0.9, 0.6, sfxBus, { to: 28 });
  noise(t, 0.5, 0.35, sfxBus, { type: 'lowpass', freq: 600, to: 60 });
}

export function whoosh() {
  if (!running()) return;
  const t = ac.currentTime;
  noise(t, 0.4, 0.3, sfxBus, { type: 'bandpass', freq: 400, to: 2500 });
}

export function blip() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('square', 520, t, 0.07, 0.15, sfxBus, { to: 780 });
}

export function dawn() {
  if (!running()) return;
  const t = ac.currentTime;
  [523.3, 659.3, 784, 1046.5].forEach((f, i) => osc('sine', f, t + i * 0.14, 1.2, 0.2, sfxBus, { attack: 0.03 }));
}

// ---- drinks ----

// Opening the drink: a can tab and hiss, a screw cap and fizz, a glass clink.
export function drinkOpen(id) {
  if (!running()) return;
  const t = ac.currentTime;
  if (id === 'energy') {
    osc('square', 1800, t, 0.03, 0.12, sfxBus, { to: 900 });
    noise(t + 0.03, 0.35, 0.3, sfxBus, { freq: 5500 });
  } else if (id === 'orange') {
    osc('triangle', 700, t, 0.12, 0.1, sfxBus, { to: 1100 });
    noise(t + 0.08, 0.5, 0.28, sfxBus, { freq: 4000 });
  } else {
    osc('sine', 2400, t, 0.25, 0.14, sfxBus, { to: 2300 });
    osc('sine', 3600, t, 0.18, 0.06, sfxBus);
  }
}

// One swallow: a low glug with a little bubble.
export function gulp() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sine', 150 + Math.random() * 30, t, 0.11, 0.35, sfxBus, { to: 80 });
  noise(t, 0.08, 0.1, sfxBus, { type: 'bandpass', freq: 700, to: 300 });
}

// The satisfied noise afterwards: an aah, a burp, a sigh, or a crushed can.
export function drinkDone(id) {
  if (!running()) return;
  const t = ac.currentTime;
  if (id === 'orange') {
    osc('sawtooth', 95, t, 0.4, 0.3, sfxBus, { to: 50, attack: 0.02 });
    noise(t, 0.25, 0.12, sfxBus, { type: 'lowpass', freq: 600, to: 150 });
  } else if (id === 'heavy') {
    noise(t, 0.7, 0.2, sfxBus, { type: 'bandpass', freq: 800, to: 350 });
  } else if (id === 'energy') {
    noise(t, 0.18, 0.35, sfxBus, { type: 'bandpass', freq: 3500, to: 1200 });
    osc('square', 2200, t, 0.05, 0.1, sfxBus, { to: 1500 });
  } else {
    noise(t, 0.55, 0.2, sfxBus, { type: 'bandpass', freq: 1000, to: 600 });
  }
}

// ---- the super laser ----

// A rising charge-up hum before the beam fires.
export function laserCharge() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sawtooth', 70, t, 0.5, 0.3, sfxBus, { to: 520, attack: 0.1 });
  osc('sine', 140, t, 0.5, 0.25, sfxBus, { to: 1040, attack: 0.1 });
  noise(t, 0.5, 0.2, sfxBus, { type: 'bandpass', freq: 300, to: 3000 });
}

// The beam itself: a deep roar with a bright whine on top, for as long as it sweeps.
export function laserBeam(seconds) {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sawtooth', 55, t, seconds, 0.4, sfxBus, { attack: 0.08 });
  osc('square', 110, t, seconds, 0.18, sfxBus, { attack: 0.08 });
  osc('sine', 880, t, seconds, 0.12, sfxBus, { to: 1200, attack: 0.15 });
  noise(t, seconds, 0.25, sfxBus, { type: 'lowpass', freq: 1800, to: 900 });
}

// The beam cuts out with a heavy thump.
export function laserEnd() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sine', 130, t, 0.7, 0.7, sfxBus, { to: 30 });
  noise(t, 0.6, 0.4, sfxBus, { type: 'lowpass', freq: 1200, to: 120 });
}

// ---- prepared enemies (docs/enemies-next.md) ----

// One tick of a Fizzbang Shaken's rattle: a bead in a tin. `level` 0..1: higher is louder and higher, so the rattle
// climbs as it closes in. Ticks closer than 30 ms are dropped so a crowd of them cannot flood the context.
let lastRattle = 0;
export function rattle(level = 0) {
  if (!running()) return;
  const t = ac.currentTime;
  if (t - lastRattle < 0.03) return;
  lastRattle = t;
  const l = Math.max(0, Math.min(1, level));
  osc('square', 700 + l * 1500 + Math.random() * 120, t, 0.035, 0.05 + 0.1 * l, sfxBus, { to: 380 + l * 500 });
  noise(t, 0.03, 0.06 + 0.12 * l, sfxBus, { freq: 2600 + l * 3200 });
}

// A can about to go: a rising hiss with a whine under it.
export function hiss() {
  if (!running()) return;
  const t = ac.currentTime;
  noise(t, 0.75, 0.3, sfxBus, { type: 'highpass', freq: 2200, to: 6500 });
  osc('sine', 420, t, 0.75, 0.12, sfxBus, { to: 1500, attack: 0.1 });
}

// The burst: a fizzy whump with a spray of pops on top.
export function fizz() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sine', 240, t, 0.4, 0.6, sfxBus, { to: 55 });
  noise(t, 0.7, 0.45, sfxBus, { type: 'bandpass', freq: 3000, to: 600 });
  noise(t, 0.12, 0.4, sfxBus, { type: 'lowpass', freq: 1500, to: 200 });
  for (let i = 0; i < 6; i++) osc('sine', 900 + Math.random() * 1600, t + 0.05 + Math.random() * 0.4, 0.05, 0.12, sfxBus, { to: 300 });
}

// The Longshot starting to charge: a thin whine that climbs for the whole charge, `seconds` long.
export function snipeCharge(seconds = 1.65) {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sine', 500, t, seconds, 0.1, sfxBus, { to: 2200, attack: 0.4 });
  osc('triangle', 250, t, seconds, 0.07, sfxBus, { to: 1100, attack: 0.4 });
}

// The line locks: two quick high beeps, so the player knows the aim has stopped moving.
export function lock() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('square', 1760, t, 0.05, 0.14, sfxBus);
  osc('square', 2349, t + 0.08, 0.06, 0.14, sfxBus);
}

// The shot itself: a flat crack, a heavy thump and a long tail.
export function snipe() {
  if (!running()) return;
  const t = ac.currentTime;
  noise(t, 0.12, 0.7, sfxBus, { freq: 1500 });
  osc('sine', 200, t, 0.5, 0.8, sfxBus, { to: 40 });
  osc('sawtooth', 1100, t, 0.1, 0.3, sfxBus, { to: 180 });
  noise(t + 0.05, 0.6, 0.3, sfxBus, { type: 'lowpass', freq: 500, to: 80 });
}

// A Nurse starting to revive: a soft rising hum for the `seconds` of the channel.
export function reviveStart(seconds = 3.6) {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sine', 220, t, seconds, 0.08, sfxBus, { to: 520, attack: 0.3 });
  osc('triangle', 330, t, seconds, 0.05, sfxBus, { to: 780, attack: 0.5 });
}

// A robot getting back up: a bright little rising chime and a clank.
export function reviveDone() {
  if (!running()) return;
  const t = ac.currentTime;
  [392, 523.3, 659.3, 784].forEach((f, i) => osc('sine', f, t + i * 0.07, 0.4, 0.16, sfxBus, { attack: 0.02 }));
  osc('square', 130, t, 0.12, 0.2, sfxBus, { to: 70 });
}

// The Vending Mimic coming apart into a robot: servo whine, clanks, a hydraulic hiss.
export function unfold() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sawtooth', 110, t, 0.8, 0.2, sfxBus, { to: 330, attack: 0.1 });
  osc('square', 150, t + 0.15, 0.1, 0.25, sfxBus, { to: 70 });
  osc('square', 120, t + 0.45, 0.1, 0.25, sfxBus, { to: 60 });
  noise(t + 0.2, 0.5, 0.2, sfxBus, { type: 'bandpass', freq: 2500, to: 800 });
}

// ---------------------------------------------------------------------------------------------
// The prepared arsenal (docs/arsenal.md)
// ---------------------------------------------------------------------------------------------

// The Feedback Beam: a low buzz with a squeal that climbs while it stays on one target (k 0 to 1). beamHum(false) stops it.
let beamNodes = null;
export function beamHum(on, k = 0) {
  if (!running()) return;
  const t = ac.currentTime;
  if (!on) {
    if (beamNodes) {
      const b = beamNodes;
      beamNodes = null;
      b.gain.gain.cancelScheduledValues(t);
      b.gain.gain.setTargetAtTime(0.0001, t, 0.04);
      b.oscs.forEach((o) => o.stop(t + 0.3));
    }
    return;
  }
  if (!beamNodes) {
    const gain = ac.createGain();
    gain.gain.value = 0.0001;
    gain.connect(sfxBus);
    const mk = (type, f, g) => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ac.createGain();
      og.gain.value = g;
      o.connect(og);
      og.connect(gain);
      o.start();
      return { o, og };
    };
    const hum = mk('sawtooth', 98, 0.5);
    const beat = mk('square', 101, 0.3);
    const squeal = mk('sine', 1500, 0.05);
    beamNodes = { gain, hum, beat, squeal, oscs: [hum.o, beat.o, squeal.o] };
    gain.gain.setTargetAtTime(0.16, t, 0.03);
  }
  const b = beamNodes;
  b.squeal.o.frequency.setTargetAtTime(1500 + k * 2200, t, 0.08);
  b.squeal.og.gain.setTargetAtTime(0.05 + k * 0.45, t, 0.08);
  b.hum.o.frequency.setTargetAtTime(98 + k * 24, t, 0.1);
}

// The grenade leaving Naebun's hand: a short whoosh and a clink of the pin.
export function grenadeThrow() {
  if (!running()) return;
  const t = ac.currentTime;
  noise(t, 0.22, 0.28, sfxBus, { type: 'bandpass', freq: 500, to: 1800 });
  osc('triangle', 1900, t, 0.06, 0.12, sfxBus, { to: 1300 });
  osc('sine', 120, t, 0.12, 0.25, sfxBus, { to: 70 });
}

// The grenade hitting something solid: a dull metal knock, a little different each time.
export function grenadeBounce() {
  if (!running()) return;
  const t = ac.currentTime;
  const f = 150 + Math.random() * 50;
  osc('triangle', f, t, 0.1, 0.3, sfxBus, { to: f * 0.5 });
  osc('square', f * 4.2, t, 0.03, 0.08, sfxBus, { to: f * 3 });
  noise(t, 0.05, 0.15, sfxBus, { type: 'lowpass', freq: 2200 });
}

// The bass drop: a sub sweep down the floor, a thump, a wash of low noise.
export function bassDrop() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sine', 150, t, 1.1, 0.95, sfxBus, { to: 28 });
  osc('triangle', 300, t, 0.35, 0.3, sfxBus, { to: 55 });
  noise(t, 0.7, 0.4, sfxBus, { type: 'lowpass', freq: 500, to: 60 });
  noise(t, 0.05, 0.3, sfxBus, { type: 'highpass', freq: 3000 });
}

// The airhorn: three horns blaring together, a little out of tune, with a wobble.
export function airhorn() {
  if (!running()) return;
  const t = ac.currentTime;
  const out = ac.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.42, t + 0.015);
  out.gain.setValueAtTime(0.42, t + 0.38);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3400;
  out.connect(lp);
  lp.connect(sfxBus);
  const lfo = ac.createOscillator();
  lfo.frequency.value = 9;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 5;
  lfo.connect(lfoGain);
  [466, 587.3, 698.5, 932].forEach((f, i) => {
    const o = ac.createOscillator();
    o.type = i === 3 ? 'sine' : 'sawtooth';
    o.frequency.value = f * (1 + (i - 1.5) * 0.004);
    lfoGain.connect(o.frequency);
    const g = ac.createGain();
    g.gain.value = i === 3 ? 0.2 : 0.3;
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.7);
  });
  lfo.start(t);
  lfo.stop(t + 0.7);
  noise(t, 0.12, 0.2, sfxBus, { type: 'bandpass', freq: 1800 });
}

// One round of the SMG's alt-fire burst: the SMG's own sound.
export function burst() {
  shoot('smg');
}

// An upgrade picked up: three quick rising notes and a click.
export function upgrade() {
  if (!running()) return;
  const t = ac.currentTime;
  [523.3, 659.3, 784, 1046.5].forEach((f, i) => osc('triangle', f, t + i * 0.075, 0.25, 0.2, sfxBus, { attack: 0.01 }));
  osc('square', 220, t, 0.05, 0.12, sfxBus, { to: 440 });
}

// A record found: a scratch, then a chime.
export function recordFound() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sawtooth', 1000, t, 0.16, 0.18, sfxBus, { to: 180 });
  noise(t, 0.14, 0.18, sfxBus, { type: 'bandpass', freq: 2400, to: 700 });
  [880, 1318.5, 1760].forEach((f, i) => osc('sine', f, t + 0.18 + i * 0.09, 0.5, 0.16, sfxBus, { attack: 0.01 }));
}
