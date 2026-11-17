// Shared helpers for the background service worker.

export const DEFAULT_SETTINGS = { coverMin: 100000 };

export async function getSettings() {
  const s = await chrome.storage.sync.get(['geniusToken', 'bpmKey', 'youtubeKey', 'coverMin']);
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
