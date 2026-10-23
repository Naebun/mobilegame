// Saved progress: the furthest level unlocked, which levels are done, the difficulty chosen, and the best score for each
// level in each difficulty (kept apart, so an Extra Hard score never hides a Normal one).
// Stored in a first-party cookie (a year, this page's path only) and mirrored in localStorage. Either can be blocked or
// cleared, so both are read and merged, and every write is wrapped: with neither available the game just does not remember.
// Nothing here touches the DOM at import, so it also loads under plain Node (where load() returns a fresh save).

import { RECORDS, DIFFICULTY_ORDER } from './data.js';

const COOKIE = 'fls';
const LS_KEY = 'mobilegame.save';
const MAX_AGE = 60 * 60 * 24 * 365;
export const MAX_LEVELS = 2; // the number of levels that exist; unlocked never goes past it

export const MODES = DIFFICULTY_ORDER; // 'normal', 'hard', 'extra': any other mode name in a save is ignored
const isMode = (m) => typeof m === 'string' && MODES.includes(m);
const noBest = () => Object.fromEntries(MODES.map((m) => [m, {}]));

// v2 added `difficulty` (the mode of the latest run, which CONTINUE resumes in) and made `best` per mode: best[mode][level].
// A v1 save has no difficulty and best[level], and those scores are its normal-mode bests.
export const fresh = () => ({ v: 2, unlocked: 1, done: [], best: noBest(), difficulty: 'normal', torch: false, records: [] }); // torch: the pistol's torch has been fitted

export const bestOf = (save, mode, level) => (save.best[isMode(mode) ? mode : 'normal'] || {})[level] || 0;
export function setBest(save, mode, level, score) {
  const m = isMode(mode) ? mode : 'normal';
  if (!save.best[m]) save.best[m] = {};
  save.best[m][level] = score;
}

// Only ids of records that exist survive, once each, in the order of the list: anything else in the field is dropped.
const cleanRecords = (raw) => {
  const have = new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []);
  return RECORDS.map((r) => r.id).filter((id) => have.has(id));
};

// Coerce anything we read into a valid save (a hand-edited or old cookie must not break the game).
export function clean(raw) {
  const out = fresh();
  if (!raw || typeof raw !== 'object') return out;
  out.torch = raw.torch === true;
  out.records = cleanRecords(raw.records); // the ids of the collectible records found; older saves have none
  const u = Math.floor(Number(raw.unlocked));
  if (u >= 1) out.unlocked = Math.min(MAX_LEVELS, u);
  if (Array.isArray(raw.done)) out.done = [...new Set(raw.done.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_LEVELS))].sort();
  if (isMode(raw.difficulty)) out.difficulty = raw.difficulty;
  if (raw.best && typeof raw.best === 'object' && !Array.isArray(raw.best)) {
    const take = (mode, level, v) => {
      const n = Number(level);
      const b = Math.floor(Number(v));
      if (Number.isInteger(n) && n >= 1 && n <= MAX_LEVELS && b > 0 && b < 1e12) out.best[mode][n] = Math.max(out.best[mode][n] || 0, b);
    };
    for (const [k, v] of Object.entries(raw.best)) {
      if (isMode(k)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) for (const [lv, sc] of Object.entries(v)) take(k, lv, sc);
      } else take('normal', k, v); // a v1 save: best[level] is the normal-mode score
    }
  }
  for (const n of out.done) out.unlocked = Math.max(out.unlocked, Math.min(MAX_LEVELS, n + 1));
  return out;
}

// Two copies of a save (the cookie and local storage) merge to whichever is further on, level by level.
export function merge(a, b) {
  const out = fresh();
  out.unlocked = Math.max(a.unlocked, b.unlocked);
  out.torch = a.torch || b.torch;
  out.records = cleanRecords([...(a.records || []), ...(b.records || [])]);
  out.done = [...new Set([...a.done, ...b.done])].sort();
  for (const m of MODES) for (const n of Object.keys({ ...a.best[m], ...b.best[m] })) out.best[m][n] = Math.max(a.best[m][n] || 0, b.best[m][n] || 0);
  out.difficulty = b.unlocked > a.unlocked ? b.difficulty : a.difficulty; // the copy that is further on knows the mode it was played in
  return out;
}

const cookiePath = () => (typeof location !== 'undefined' ? location.pathname.replace(/[^/]*$/, '') || '/' : '/');

function readCookie() {
  try {
    const m = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE}=`));
    return m ? clean(JSON.parse(decodeURIComponent(m.slice(COOKIE.length + 1)))) : null;
  } catch { return null; }
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? clean(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function load() {
  const c = typeof document !== 'undefined' ? readCookie() : null;
  const l = typeof localStorage !== 'undefined' ? readLocal() : null;
  return c && l ? merge(c, l) : c || l || fresh();
}

// What is written: the same save without the empty modes, so the cookie stays small (clean() puts them back on reading).
const compact = (s) => ({ ...s, best: Object.fromEntries(MODES.filter((m) => Object.keys(s.best[m]).length).map((m) => [m, s.best[m]])) });

export function save(p) {
  const s = clean(p);
  const json = JSON.stringify(compact(s));
  try {
    const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE}=${encodeURIComponent(json)}; max-age=${MAX_AGE}; path=${cookiePath()}; SameSite=Lax${secure}`;
  } catch { /* cookies blocked, or no document */ }
  try { localStorage.setItem(LS_KEY, json); } catch { /* private mode etc. */ }
  return s;
}

export function reset() {
  try { document.cookie = `${COOKIE}=; max-age=0; path=${cookiePath()}; SameSite=Lax`; } catch { /* nothing to clear */ }
  try { localStorage.removeItem(LS_KEY); } catch { /* nothing to clear */ }
  return fresh();
}
