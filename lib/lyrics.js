// Lyrics from LRCLIB (free, open, crowd-sourced), fetched through the Crate server so they can be switched off centrally.
import { cacheGet, cacheSet, norm, looseMatch, serverGet } from './util.js';

export function parseLrc(text) {
  const out = [];
  for (const line of (text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/);
    if (!m) continue;
    const frac = m[3] ? Number(`0.${m[3]}`) : 0;
    out.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text: m[4].trim() });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function pickLyrics(list, artist, title, duration) {
  const items = (Array.isArray(list) ? list : []).filter(
    (i) => norm(i.trackName) === norm(title) && looseMatch(i.artistName, artist) && (i.syncedLyrics || i.plainLyrics || i.instrumental),
  );
  const score = (i) =>
    (i.syncedLyrics ? 2 : 0) + (duration && i.duration && Math.abs(i.duration - duration) <= 3 ? 3 : 0) - (duration && i.duration ? Math.abs(i.duration - duration) / 60 : 0);
  return items.sort((a, b) => score(b) - score(a))[0] || null;
}

export async function getLyrics(artist, title, duration) {
  const key = `lyr:${norm(artist)}|${norm(title)}`;
  const cached = await cacheGet(key, 14);
  if (cached !== undefined) return cached;
  const list = await serverGet('/lyrics/search', { track_name: title, artist_name: artist });
  const hit = pickLyrics(list, artist, title, duration);
  const out = hit
    ? {
        instrumental: Boolean(hit.instrumental),
        synced: parseLrc(hit.syncedLyrics),
        plain: (hit.plainLyrics || '').trim(),
      }
    : null;
  return cacheSet(key, out);
}
