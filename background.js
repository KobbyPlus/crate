// Crate background service worker. Keyed APIs go through the Crate server; free sources are called directly.
import { getSettings, cacheSet, serverGet, norm } from './lib/util.js';
import { hasServer, SERVER_URL } from './lib/config.js';
import { findSong, getSong, searchSongs, toCandidate, getArtist, findArtistId, matchKey } from './lib/genius.js';
import { getMbCredits } from './lib/musicbrainz.js';
import { getBpm } from './lib/bpm.js';
import { getCovers } from './lib/youtube.js';
import { getWiki } from './lib/wiki.js';
import { getCatalog } from './lib/catalog.js';
import { getLyrics } from './lib/lyrics.js';
import { buildLiteSong, parseLiteId } from './lib/lite.js';
import { mergeCredits } from './lib/credits.js';

async function settle(promise) {
  try {
    return { ok: true, data: await promise };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

// Genius first; if Genius doesn't have the song, build it from MusicBrainz + iTunes/Deezer.
async function getAnySong(id) {
  if (!String(id).startsWith('x:')) return getSong(id);
  const q = parseLiteId(id);
  const { bestId } = await findSong(q).catch(() => ({}));
  return bestId ? getSong(bestId) : buildLiteSong(q.artist, q.title);
}

function addMissing(list, extra) {
  const have = new Set(list.map((s) => norm(s.title)));
  return [...list, ...(extra || []).filter((s) => !have.has(norm(s.title)))];
}

async function enrich(id) {
  const song = await getAnySong(id);
  const [bpm, mb, wiki, cat] = await Promise.all([
    settle(getBpm(song.artist, song.title)),
    settle(getMbCredits(song.artist, song.title)),
    settle(getWiki(song.artist, song.title)),
    settle(getCatalog(song.artist, song.title)),
  ]);
  const mbData = mb.ok ? mb.data : null;
  const groups = {
    ...song.groups,
    samples: addMissing(song.groups.samples, mbData && mbData.samples),
    sampled_in: addMissing(song.groups.sampled_in, mbData && mbData.sampledIn),
  };
  return {
    stats: bpm.ok
      ? bpm.data ? { status: 'ok', ...bpm.data } : { status: 'none' }
      : { status: bpm.error === 'SERVICE_DISABLED' || bpm.error === 'NO_SERVER' ? 'off' : 'error', error: bpm.error },
    credits: mergeCredits(song.credits, mbData ? mbData.roles : []),
    mbUrl: mbData ? mbData.url : '',
    wiki: wiki.ok ? wiki.data : null,
    catalog: cat.ok ? cat.data : null,
    groups,
  };
}

const IMAGE_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(genius\.com|mzstatic\.com|dzcdn\.net)\//i;

async function imageData(url) {
  const own = url.startsWith(chrome.runtime.getURL(''));
  if (!own && !IMAGE_HOSTS.test(url)) throw new Error('BLOCKED_HOST');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IMG_${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${res.headers.get('content-type') || 'image/png'};base64,${btoa(bin)}`;
}

async function handle(msg) {
  switch (msg.type) {
    case 'lookup': {
      const q = { artist: msg.query.artist || '', title: msg.query.title || '' };
      const { bestId, candidates } = await findSong(q);
      if (bestId) return { song: await getSong(bestId), candidates };
      return { song: await buildLiteSong(q.artist, q.title), candidates };
    }
    case 'song':
      return { song: await getAnySong(msg.id) };
    case 'enrich':
      return enrich(msg.id);
    case 'covers': {
      const song = await getAnySong(msg.id);
      const s = await getSettings();
      try {
        const list = await getCovers(song.artist, song.title, s.coverMin);
        return { status: 'ok', list, min: s.coverMin, fallback: song.groups.covered_by };
      } catch (e) {
        if (e.message === 'SERVICE_DISABLED' || e.message === 'NO_SERVER') return { status: 'off', fallback: song.groups.covered_by };
        throw e;
      }
    }
    case 'lyrics': {
      const song = await getAnySong(msg.id);
      let duration = msg.duration || null;
      if (!duration) {
        const cat = await getCatalog(song.artist, song.title).catch(() => null);
        duration = cat && cat.durationSec;
      }
      try {
        return { status: 'ok', lyrics: await getLyrics(song.artist, song.title, duration) };
      } catch (e) {
        if (['LYRICS_OFF', 'NO_SERVER'].includes(e.message)) return { status: 'off' };
        throw e;
      }
    }
    case 'artist':
      return { artist: await getArtist(msg.id) };
    case 'artistByName': {
      const id = await findArtistId(msg.name);
      return { artist: id ? await getArtist(id) : null };
    }
    case 'search':
      return { candidates: (await searchSongs(msg.q)).slice(0, 8).map(toCandidate) };
    case 'pin':
      await cacheSet(matchKey(msg.query), msg.id);
      return { ok: true };
    case 'image':
      return { dataUrl: await imageData(msg.url) };
    case 'serverStatus': {
      if (!hasServer()) return { configured: false };
      try {
        return { configured: true, url: SERVER_URL, ...(await serverGet('/health')) };
      } catch (e) {
        return { configured: true, url: SERVER_URL, ok: false, error: e.message };
      }
    }
    case 'openOptions':
      chrome.runtime.openOptionsPage();
      return { ok: true };
    default:
      throw new Error('UNKNOWN');
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e.message || String(e) }));
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => chrome.runtime.openOptionsPage());
});
