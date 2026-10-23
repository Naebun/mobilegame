// Saved progress: the furthest level unlocked, which levels are done, and the best score for each.
// Stored in a first-party cookie (a year, this page's path only) and mirrored in localStorage. Either can be blocked or
// cleared, so both are read and merged, and every write is wrapped: with neither available the game just does not remember.
// Nothing here touches the DOM at import, so it also loads under plain Node (where load() returns a fresh save).

import { RECORDS } from './data.js';

const COOKIE = 'fls';
const LS_KEY = 'mobilegame.save';
const MAX_AGE = 60 * 60 * 24 * 365;
export const MAX_LEVELS = 2; // the number of levels that exist; unlocked never goes past it

export const fresh = () => ({ v: 1, unlocked: 1, done: [], best: {}, torch: false, records: [] }); // torch: the pistol's torch has been fitted

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
  if (raw.best && typeof raw.best === 'object') {
    for (const [k, v] of Object.entries(raw.best)) {
      const n = Number(k);
      const b = Math.floor(Number(v));
      if (Number.isInteger(n) && n >= 1 && n <= MAX_LEVELS && b > 0 && b < 1e12) out.best[n] = b;
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
  for (const n of Object.keys({ ...a.best, ...b.best })) out.best[n] = Math.max(a.best[n] || 0, b.best[n] || 0);
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

export function save(p) {
  const s = clean(p);
  const json = JSON.stringify(s);
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
