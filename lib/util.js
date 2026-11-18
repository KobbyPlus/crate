// Shared helpers for the background service worker.
import { SERVER_URL } from './config.js';

// Calls the Crate server, which adds the API keys and caches results for everyone.
export async function serverGet(path, params = {}) {
  if (!/^https:\/\//.test(SERVER_URL)) throw new Error('NO_SERVER');
  const url = new URL(SERVER_URL.replace(/\/$/, '') + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('SERVER_DOWN');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) throw new Error((body && body.error) || `SERVER_${res.status}`);
  return body;
}

export const DEFAULT_SETTINGS = { coverMin: 100000, showBadge: true };

export async function getSettings() {
  const s = await chrome.storage.sync.get(['coverMin', 'showBadge']);
  return { ...DEFAULT_SETTINGS, ...s, coverMin: Number(s.coverMin) || DEFAULT_SETTINGS.coverMin };
}

export async function cacheGet(key, days = 7) {
  const out = await chrome.storage.local.get(key);
  const hit = out[key];
  if (!hit) return undefined;
  if (Date.now() - hit.t > days * 864e5) return undefined;
  return hit.v;
}

export async function cacheSet(key, v) {
  await chrome.storage.local.set({ [key]: { t: Date.now(), v } });
  return v;
}

export function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// True when two titles are the same song, ignoring brackets, case and punctuation.
export function sameTitle(a, b) {
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y && x === y);
}

export function looseMatch(a, b) {
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y && (x === y || x.includes(y) || y.includes(x)));
}

// Runs async jobs one at a time with a minimum gap (MusicBrainz asks for 1 request/second).
export function makeThrottle(gapMs) {
  let last = 0;
  let chain = Promise.resolve();
  return (job) => {
    const run = chain.then(async () => {
      const wait = Math.max(0, last + gapMs - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return job();
    });
    chain = run.catch(() => {});
    return run;
  };
}

export function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function stripTags(s) {
  return (s || '').replace(/<[^>]*>/g, '');
}
