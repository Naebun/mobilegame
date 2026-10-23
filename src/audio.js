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
