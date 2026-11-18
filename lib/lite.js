// "Lite" song pages for songs Genius doesn't have, built from MusicBrainz + iTunes/Deezer.
import { cacheGet, cacheSet } from './util.js';
import { getCatalog } from './catalog.js';
import { getMbCredits, liteId } from './musicbrainz.js';

export function parseLiteId(id) {
  const [a, t] = String(id).slice(2).split('|');
  return { artist: decodeURIComponent(a || ''), title: decodeURIComponent(t || '') };
}

export async function buildLiteSong(artist, title) {
  const id = liteId(artist, title);
  const key = `lite:${id}`;
  const cached = await cacheGet(key, 7);
  if (cached) return cached;
  const [cat, mb] = await Promise.all([getCatalog(artist, title).catch(() => null), getMbCredits(artist, title).catch(() => null)]);
  const song = {
    id,
    lite: true,
    title: (cat && cat.title) || title,
    artist: (cat && cat.artist) || artist,
    artistId: null,
    art: (cat && cat.art) || '',
    artFull: (cat && cat.artFull) || '',
    url: (mb && mb.url) || (cat && (cat.apple || cat.deezer)) || '',
    release: (cat && cat.release) || '',
    album: (cat && cat.album) || '',
    about: '',
    groups: {
      samples: mb ? mb.samples : [],
      interp_from: [],
      sampled_in: mb ? mb.sampledIn : [],
      interp_by: [],
      cover_of: [],
      covered_by: [],
    },
    annotations: [],
    credits: [],
  };
  return cacheSet(key, song);
}
