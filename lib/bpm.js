// GetSongBPM: tempo, key, time signature. Free key, backlink to getsongbpm.com required.
import { cacheGet, cacheSet, norm, looseMatch, serverGet } from './util.js';

const CAMELOT = {
  'C': '8B', 'G': '9B', 'D': '10B', 'A': '11B', 'E': '12B', 'B': '1B', 'F#': '2B', 'Gb': '2B',
  'Db': '3B', 'C#': '3B', 'Ab': '4B', 'G#': '4B', 'Eb': '5B', 'D#': '5B', 'Bb': '6B', 'A#': '6B', 'F': '7B',
  'Am': '8A', 'Em': '9A', 'Bm': '10A', 'F#m': '11A', 'Gbm': '11A', 'C#m': '12A', 'Dbm': '12A',
  'G#m': '1A', 'Abm': '1A', 'D#m': '2A', 'Ebm': '2A', 'Bbm': '3A', 'A#m': '3A', 'Fm': '4A', 'Cm': '5A',
  'Gm': '6A', 'Dm': '7A',
};

export function normalizeKey(raw) {
  if (!raw) return '';
  let k = String(raw).trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  k = k.replace(/\s*(minor|min)$/i, 'm').replace(/\s*(major|maj)$/i, '');
  const m = k.match(/^([A-Ga-g])([#b]?)(m?)$/);
  if (!m) return String(raw).trim();
  return m[1].toUpperCase() + m[2] + m[3];
}

export function toCamelot(key) {
  return CAMELOT[normalizeKey(key)] || '';
}

export function prettyKey(key) {
  const k = normalizeKey(key);
  const m = k.match(/^([A-G])([#b]?)(m?)$/);
  if (!m) return k;
  const acc = m[2] === '#' ? '♯' : m[2] === 'b' ? '♭' : '';
  return `${m[1]}${acc} ${m[3] ? 'minor' : 'major'}`;
}

function shapeItem(it) {
  const artist = Array.isArray(it.artist) ? it.artist[0] : it.artist;
  return {
    id: it.id || it.song_id || '',
    title: it.title || it.song_title || '',
    uri: it.uri || it.song_uri || '',
    artist: artist ? artist.name || '' : '',
    tempo: Number(it.tempo) || null,
    key: it.key_of || '',
    camelot: it.camelot || '',
    timeSig: it.time_sig ? String(it.time_sig) : '',
  };
}

export function pickBest(list, artist, title) {
  const items = (Array.isArray(list) ? list : []).map(shapeItem).filter((i) => i.tempo);
  return (
    items.find((i) => norm(i.title) === norm(title) && looseMatch(i.artist, artist)) ||
    items.find((i) => norm(i.title) === norm(title)) ||
    null
  );
}

// GetSongBPM calls go through the Crate server, which holds the key.
function call(params) {
  return serverGet('/bpm/search', params);
}

function listFrom(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.search)) return json.search;
  return [];
}

export async function getBpm(artist, title) {
  const key = `bpm:${norm(artist)}|${norm(title)}`;
  const cached = await cacheGet(key, 30);
  if (cached !== undefined) return cached;

  let best = pickBest(listFrom(await call({ type: 'both', lookup: `song:${title} artist:${artist}` })), artist, title);
  if (!best) best = pickBest(listFrom(await call({ type: 'song', lookup: title })), artist, title);

  const out = best
    ? {
        bpm: best.tempo,
        key: prettyKey(best.key),
        camelot: best.camelot || toCamelot(best.key),
        timeSig: best.timeSig,
        uri: best.uri || 'https://getsongbpm.com',
      }
    : null;
  return cacheSet(key, out);
}
