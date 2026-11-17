// Crate background service worker. Every API call happens here so keys never touch the YouTube page.
import { getSettings, cacheSet, serverGet } from './lib/util.js';
import { hasServer, SERVER_URL } from './lib/config.js';
import { findSong, getSong, searchSongs, toCandidate, getArtist, findArtistId, matchKey, genius } from './lib/genius.js';
import { getMbCredits } from './lib/musicbrainz.js';
import { getBpm, testBpm } from './lib/bpm.js';
import { getCovers, testYoutube } from './lib/youtube.js';
import { getWiki } from './lib/wiki.js';
import { mergeCredits } from './lib/credits.js';

async function settle(promise) {
  try {
    return { ok: true, data: await promise };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

async function enrich(id) {
  const song = await getSong(id);
  const settings = await getSettings();
  const [bpm, mb, wiki] = await Promise.all([
    settings.bpmKey || hasServer() ? settle(getBpm(song.artist, song.title, settings.bpmKey)) : Promise.resolve({ ok: false, error: 'NO_KEY' }),
    settle(getMbCredits(song.artist, song.title)),
    settle(getWiki(song.artist, song.title)),
  ]);
  return {
    stats: bpm.ok
      ? bpm.data ? { status: 'ok', ...bpm.data } : { status: 'none' }
      : { status: bpm.error === 'NO_KEY' ? 'nokey' : bpm.error === 'SERVICE_DISABLED' ? 'off' : 'error', error: bpm.error },
    credits: mergeCredits(song.credits, mb.ok && mb.data ? mb.data.roles : []),
    mbUrl: mb.ok && mb.data ? mb.data.url : '',
    wiki: wiki.ok ? wiki.data : null,
  };
}

const IMAGE_HOSTS = /^https:\/\/([a-z0-9-]+\.)*genius\.com\//i;

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
      const { bestId, candidates } = await findSong(msg.query);
      return { song: bestId ? await getSong(bestId) : null, candidates };
    }
    case 'song':
      return { song: await getSong(msg.id) };
    case 'enrich':
      return enrich(msg.id);
    case 'covers': {
      const song = await getSong(msg.id);
      const s = await getSettings();
      if (!s.youtubeKey && !hasServer()) return { status: 'nokey', fallback: song.groups.covered_by };
      try {
        const list = await getCovers(song.artist, song.title, s.youtubeKey, s.coverMin);
        return { status: 'ok', list, min: s.coverMin, fallback: song.groups.covered_by };
      } catch (e) {
        if (e.message === 'SERVICE_DISABLED') return { status: 'off', fallback: song.groups.covered_by };
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
    case 'test': {
      const s = await getSettings();
      if (msg.source === 'genius') await genius('/search', { q: 'Kanye West Through the Wire' });
      else if (msg.source === 'bpm') {
        if (!s.bpmKey) throw new Error('NO_KEY');
        await testBpm(s.bpmKey);
      } else if (msg.source === 'youtube') {
        if (!s.youtubeKey) throw new Error('NO_KEY');
        await testYoutube(s.youtubeKey);
      }
      return { ok: true };
    }
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

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const s = await getSettings();
  if (reason === 'install' && !s.geniusToken && !hasServer()) chrome.runtime.openOptionsPage();
});

