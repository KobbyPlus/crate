// Genius: song match, samples / interpolations / covers, meanings, base credits, artist pages.
import { cacheGet, cacheSet, norm, serverGet } from './util.js';

// Genius calls go through the Crate server, which holds the token.
export async function genius(path, params = {}) {
  return (await serverGet('/genius' + path, params)).response;
}

// ---------- matching ----------
export function scoreHit(r, q) {
  const t = norm(r.title);
  const a = norm(r.primary_artist && r.primary_artist.name);
  const qt = norm(q.title);
  const qa = norm(q.artist);
  let s = 0;
  if (t && t === qt) s += 5;
  else if (t && qt && (t.includes(qt) || qt.includes(t))) s += 3;
  if (qa && a) {
    if (a === qa) s += 4;
    else if (a.includes(qa) || qa.includes(a)) s += 2;
  }
  if (/^genius\b/.test(a) || /translation|romanized/.test(t)) s -= 8;
  return s;
}

export function toCandidate(r) {
  return {
    id: r.id,
    title: r.title,
    artist: r.primary_artist ? r.primary_artist.name : '',
    artistId: r.primary_artist ? r.primary_artist.id : null,
    art: r.song_art_image_thumbnail_url || r.header_image_thumbnail_url || '',
  };
}

export async function searchSongs(query) {
  const res = await genius('/search', { q: query, per_page: 10 });
  return res.hits.filter((h) => h.type === 'song').map((h) => h.result);
}

export function matchKey(q) {
  return `match:${norm(q.artist)}|${norm(q.title)}`;
}

// A match must agree on the title AND (when we know it) the artist, otherwise we fall back to other sources
// instead of showing the wrong song.
export function isConfident(score, q) {
  return score >= (q.artist ? 7 : 5);
}

export async function findSong(q) {
  const cachedId = await cacheGet(matchKey(q), 30);
  const seen = new Map();
  const queries = [[q.artist, q.title].filter(Boolean).join(' ')];
  if (q.artist) queries.push(q.title);
  for (const query of queries) {
    for (const r of await searchSongs(query)) if (!seen.has(r.id)) seen.set(r.id, r);
    const best = [...seen.values()].map((r) => scoreHit(r, q)).sort((a, b) => b - a)[0];
    if (best !== undefined && isConfident(best, q)) break;
  }
  const ranked = [...seen.values()].map((r) => ({ r, s: scoreHit(r, q) })).sort((x, y) => y.s - x.s);
  const candidates = ranked.slice(0, 6).map((x) => toCandidate(x.r));
  const bestId = cachedId || (ranked.length && isConfident(ranked[0].s, q) ? ranked[0].r.id : null);
  if (bestId && !cachedId) await cacheSet(matchKey(q), bestId);
  return { bestId, candidates };
}

// ---------- song ----------
const REL_GROUP = {
  samples: 'samples',
  interpolates: 'interp_from',
  sampled_in: 'sampled_in',
  interpolated_by: 'interp_by',
  cover_of: 'cover_of',
  covered_by: 'covered_by',
};

function people(list) {
  return (list || []).filter((a) => a && a.name).map((a) => ({ name: a.name, geniusId: a.id }));
}

function cleanText(text) {
  const t = (text || '').trim();
  return t === '?' ? '' : t;
}

export function shapeSong(song, referents) {
  const groups = { samples: [], interp_from: [], sampled_in: [], interp_by: [], cover_of: [], covered_by: [] };
  for (const rel of song.song_relationships || []) {
    const bucket = REL_GROUP[rel.relationship_type];
    if (!bucket) continue;
    for (const s of rel.songs || []) groups[bucket].push(toCandidate(s));
  }

  const annotations = (referents || [])
    .map((ref) => {
      const ann = (ref.annotations || [])[0];
      const body = ann && ann.body && ann.body.plain ? ann.body.plain.trim() : '';
      if (!body) return null;
      return { fragment: ref.fragment || '', body, verified: Boolean(ann.verified), votes: ann.votes_total || 0 };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.verified) - Number(a.verified) || b.votes - a.votes);

  const credits = [
    { role: 'Featuring', people: people(song.featured_artists) },
    { role: 'Produced by', people: people(song.producer_artists) },
    { role: 'Written by', people: people(song.writer_artists) },
    ...(song.custom_performances || []).map((p) => ({ role: p.label, people: people(p.artists) })),
  ].filter((r) => r.role && r.people.length);

  return {
    id: song.id,
    title: song.title,
    artist: song.primary_artist ? song.primary_artist.name : '',
    artistId: song.primary_artist ? song.primary_artist.id : null,
    art: song.song_art_image_thumbnail_url || '',
    artFull: song.song_art_image_url || song.header_image_url || song.song_art_image_thumbnail_url || '',
    url: song.url,
    release: song.release_date_for_display || '',
    album: song.album ? song.album.name : '',
    about: cleanText(song.description && song.description.plain),
    groups,
    annotations,
    credits,
  };
}

export async function getSong(id) {
  const key = `song3:${id}`;
  const cached = await cacheGet(key);
  if (cached) return cached;
  const [songRes, refRes] = await Promise.all([
    genius(`/songs/${id}`, { text_format: 'plain' }),
    genius('/referents', { song_id: id, text_format: 'plain', per_page: 30 }).catch(() => ({ referents: [] })),
  ]);
  return cacheSet(key, shapeSong(songRes.song, refRes.referents));
}

// ---------- artists ----------
export async function getArtist(id) {
  const key = `artist:${id}`;
  const cached = await cacheGet(key);
  if (cached) return cached;
  const [a, s] = await Promise.all([
    genius(`/artists/${id}`, { text_format: 'plain' }),
    genius(`/artists/${id}/songs`, { sort: 'popularity', per_page: 20 }),
  ]);
  const ar = a.artist;
  return cacheSet(key, {
    id,
    name: ar.name,
    image: ar.image_url || '',
    bio: cleanText(ar.description && ar.description.plain),
    url: ar.url,
    songs: (s.songs || []).map(toCandidate),
  });
}

export async function findArtistId(name) {
  const res = await genius('/search', { q: name, per_page: 20 });
  const target = norm(name);
  for (const h of res.hits) {
    const r = h.result;
    const all = [r.primary_artist, ...(r.featured_artists || [])].filter(Boolean);
    const hit = all.find((a) => norm(a.name) === target);
    if (hit) return hit.id;
  }
  return null;
}
