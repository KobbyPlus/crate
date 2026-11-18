// Catalog: artwork, album, release date, genre and length from Apple's iTunes catalog, with Deezer as backup.
// Both are free and need no key. Used to fill in songs Genius doesn't have, and for "Listen on" links.
import { cacheGet, cacheSet, norm, looseMatch } from './util.js';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function pickItunes(results, artist, title) {
  const songs = (results || []).filter((r) => r.kind === 'song' || r.wrapperType === 'track');
  const hit =
    songs.find((r) => norm(r.trackName) === norm(title) && looseMatch(r.artistName, artist)) ||
    songs.find((r) => looseMatch(r.trackName, title) && looseMatch(r.artistName, artist));
  if (!hit) return null;
  const art = (hit.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/600x600bb.');
  return {
    title: hit.trackName,
    artist: hit.artistName,
    album: hit.collectionName || '',
    release: fmtDate(hit.releaseDate),
    genre: hit.primaryGenreName || '',
    durationSec: hit.trackTimeMillis ? Math.round(hit.trackTimeMillis / 1000) : null,
    art: (hit.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/300x300bb.'),
    artFull: art,
    apple: hit.trackViewUrl || '',
    deezer: '',
  };
}

export function pickDeezer(data, artist, title) {
  const hit =
    (data || []).find((r) => norm(r.title) === norm(title) && looseMatch(r.artist && r.artist.name, artist)) ||
    (data || []).find((r) => looseMatch(r.title, title) && looseMatch(r.artist && r.artist.name, artist));
  if (!hit) return null;
  return {
    title: hit.title,
    artist: hit.artist ? hit.artist.name : '',
    album: hit.album ? hit.album.title : '',
    release: '',
    genre: '',
    durationSec: hit.duration || null,
    art: hit.album ? hit.album.cover_medium || '' : '',
    artFull: hit.album ? hit.album.cover_xl || hit.album.cover_big || '' : '',
    apple: '',
    deezer: hit.link || '',
  };
}

async function itunes(artist, title) {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', `${artist} ${title}`);
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', '10');
  const res = await fetch(url);
  if (!res.ok) return null;
  return pickItunes((await res.json()).results, artist, title);
}

async function deezer(artist, title) {
  const url = new URL('https://api.deezer.com/search');
  url.searchParams.set('q', `artist:"${artist}" track:"${title}"`);
  url.searchParams.set('limit', '10');
  const res = await fetch(url);
  if (!res.ok) return null;
  return pickDeezer((await res.json()).data, artist, title);
}

export async function getCatalog(artist, title) {
  if (!title) return null;
  const key = `cat:${norm(artist)}|${norm(title)}`;
  const cached = await cacheGet(key, 30);
  if (cached !== undefined) return cached;
  const [a, d] = await Promise.all([itunes(artist, title).catch(() => null), deezer(artist, title).catch(() => null)]);
  let out = a || d;
  if (a && d) out = { ...d, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v)), deezer: d.deezer };
  return cacheSet(key, out || null);
}
