// All sound is synthesised with Web Audio: no files to host or license.
// unlock() must be called from a user gesture. Everything else is a no-op until the context runs.

const BPM = 118;
const SPB = 60 / BPM;
const SIXTEENTH = SPB / 4;
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
    const f = 82.4 * 2 ** (BASS[s] / 12);
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
    osc('triangle', 164.8, t, 2.6, peak, musicBus, { attack: 1.4 });
    osc('triangle', 174.6, t, 2.6, peak, musicBus, { attack: 1.4 });
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

export function setMood(i, isMuffled) {
  intensity = i;
  if (isMuffled !== muffled) {
    muffled = isMuffled;
    if (ac) musicFilter.frequency.setTargetAtTime(isMuffled ? 300 : 18000, ac.currentTime, 0.15);
  }
}

// ---- sound effects ----

export function shoot() {
  if (!running()) return;
  const t = ac.currentTime;
  osc('sine', 260 + Math.random() * 30, t, 0.14, 0.45, sfxBus, { to: 70 });
  noise(t, 0.06, 0.2, sfxBus, { freq: 3000 });
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
