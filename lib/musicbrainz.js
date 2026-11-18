// MusicBrainz: deep credits (engineers, mixers, instruments, studios). Free, no key, 1 request/second.
import { cacheGet, cacheSet, norm, makeThrottle } from './util.js';

const MB = 'https://musicbrainz.org/ws/2';
const throttle = makeThrottle(1100);

async function mb(path, params = {}) {
  return throttle(async () => {
    const url = new URL(MB + path);
    for (const [k, v] of Object.entries({ ...params, fmt: 'json' })) url.searchParams.set(k, String(v));
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`MB_${res.status}`);
    return res.json();
  });
}

function lucene(s) {
  return (s || '').replace(/([+\-&|!(){}\[\]^"~*?:\\\/])/g, '\\$1');
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const SKIP = new Set(['remixer', 'misc', 'copyright', 'phonographic copyright', 'performer', 'editor']);

function artistRole(rel) {
  const attrs = (rel.attributes || []).map((a) => a.toLowerCase());
  switch (rel.type) {
    case 'producer':
      if (attrs.includes('executive')) return 'Executive producer';
      if (attrs.includes('co')) return 'Co-produced by';
      if (attrs.includes('additional')) return 'Additional production';
      return 'Produced by';
    case 'engineer':
    case 'audio':
    case 'sound':
      return 'Engineered by';
    case 'mix':
      return 'Mixed by';
    case 'mastering':
      return 'Mastered by';
    case 'recording':
      return 'Recorded by';
    case 'programming':
      return 'Programming';
    case 'arranger':
    case 'instrument arranger':
      return 'Arranged by';
    case 'vocal':
      return attrs.includes('lead vocals') ? 'Lead vocals' : attrs.includes('background vocals') ? 'Background vocals' : 'Vocals';
    case 'instrument': {
      const inst = (rel.attributes || []).find((a) => !['additional', 'guest', 'solo'].includes(a.toLowerCase()));
      return inst ? cap(inst) : 'Instruments';
    }
    default:
      return SKIP.has(rel.type) ? null : null;
  }
}

const PLACE_ROLE = { 'recorded at': 'Recorded at', 'mixed at': 'Mixed at', 'mastered at': 'Mastered at', 'engineered at': 'Recorded at' };
const WRITER_TYPES = new Set(['composer', 'lyricist', 'writer']);

export const liteId = (artist, title) => `x:${encodeURIComponent(artist || '')}|${encodeURIComponent(title || '')}`;

function creditName(rec) {
  return (rec['artist-credit'] || []).map((c) => (c.name || (c.artist && c.artist.name) || '') + (c.joinphrase || '')).join('').trim();
}

// MusicBrainz "samples material" links between recordings: forward = this song samples it, backward = it samples this song.
export function parseSamples(rec) {
  const samples = [];
  const sampledIn = [];
  const seen = new Set();
  for (const rel of rec.relations || []) {
    if (rel['target-type'] !== 'recording' || rel.type !== 'samples material' || !rel.recording) continue;
    const r = rel.recording;
    const artist = creditName(r);
    const k = `${rel.direction}|${norm(artist)}|${norm(r.title)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const item = { id: liteId(artist, r.title), title: r.title, artist, art: '' };
    (rel.direction === 'backward' ? sampledIn : samples).push(item);
  }
  return { samples, sampledIn };
}

export function parseRecording(rec) {
  const roles = new Map();
  const add = (role, person, kind = 'artist') => {
    if (!role || !person.name) return;
    if (!roles.has(role)) roles.set(role, { role, kind, people: [] });
    const r = roles.get(role);
    if (!r.people.some((p) => norm(p.name) === norm(person.name))) r.people.push(person);
  };

  for (const rel of rec.relations || []) {
    if (rel['target-type'] === 'artist' && rel.artist) {
      add(artistRole(rel), { name: rel.artist.name, mbid: rel.artist.id });
    } else if (rel['target-type'] === 'place' && rel.place) {
      add(PLACE_ROLE[rel.type], { name: rel.place.name, mbPlaceId: rel.place.id }, 'place');
    } else if (rel['target-type'] === 'work' && rel.work) {
      for (const wr of rel.work.relations || []) {
        if (wr['target-type'] === 'artist' && wr.artist && WRITER_TYPES.has(wr.type)) {
          add('Written by', { name: wr.artist.name, mbid: wr.artist.id });
        }
      }
    }
  }
  return [...roles.values()];
}

export async function getMbCredits(artist, title) {
  const key = `mb2:${norm(artist)}|${norm(title)}`;
  const cached = await cacheGet(key, 14);
  if (cached !== undefined) return cached;

  const query = `recording:"${lucene(title)}" AND artist:"${lucene(artist)}"`;
  const s = await mb('/recording', { query, limit: 15 });
  const candidates = (s.recordings || [])
    .filter((r) => r.score >= 80 && norm(r.title) === norm(title))
    .filter((r) => !/live|remix|instrumental|a ?cappella|edit|demo|karaoke/i.test(r.disambiguation || ''))
    .sort((a, b) => (b.releases ? b.releases.length : 0) - (a.releases ? a.releases.length : 0))
    .slice(0, 3);

  let best = null;
  for (const c of candidates) {
    const rec = await mb(`/recording/${c.id}`, { inc: 'artist-rels+place-rels+work-rels+work-level-rels+recording-rels+artist-credits' });
    const roles = parseRecording(rec);
    const { samples, sampledIn } = parseSamples(rec);
    const found = { url: `https://musicbrainz.org/recording/${c.id}`, roles, samples, sampledIn };
    if (!best) best = found;
    if (roles.length || samples.length || sampledIn.length) {
      best = found;
      break;
    }
  }
  return cacheSet(key, best);
}
