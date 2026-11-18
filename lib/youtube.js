// YouTube Data API: popular covers with real view counts.
// Quota note: one search costs 100 units of the free 10,000/day, so covers load only when the tab is opened.
import { cacheGet, cacheSet, norm, decodeEntities, serverGet } from './util.js';

const JUNK = /\b(reaction|react|reacts|karaoke|tutorial|lesson|how to|lyrics?|8d|slowed|sped up|nightcore|remix|mashup|type beat|instrumental remake|backing track)\b/i;

// YouTube calls go through the Crate server, which holds the key and caches searches for everyone.
function yt(path, params) {
  return serverGet('/yt' + path, params);
}

export function filterCovers(videos, artist, title) {
  const t = norm(title);
  const a = norm(artist);
  return videos
    .map((v) => ({
      videoId: v.id,
      title: decodeEntities(v.snippet.title),
      channel: decodeEntities(v.snippet.channelTitle),
      views: Number(v.statistics && v.statistics.viewCount) || 0,
      thumb: (v.snippet.thumbnails && (v.snippet.thumbnails.medium || v.snippet.thumbnails.default) || {}).url || '',
      url: `https://www.youtube.com/watch?v=${v.id}`,
    }))
    .filter((v) => /\bcover(ed)?\b/i.test(v.title))
    .filter((v) => norm(v.title).includes(t))
    .filter((v) => !JUNK.test(v.title))
    .filter((v) => !(a && norm(v.channel).includes(a)))
    .sort((x, y) => y.views - x.views);
}

export async function getCovers(artist, title, min) {
  const key = `yt:${norm(artist)}|${norm(title)}`;
  let all = await cacheGet(key, 7);
  if (all === undefined) {
    const search = await yt('/search', { q: `${title} ${artist} cover` });
    const ids = (search.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
    let videos = [];
    if (ids.length) videos = (await yt('/videos', { id: ids.join(',') })).items || [];
    all = await cacheSet(key, filterCovers(videos, artist, title));
  }
  return all.filter((v) => v.views >= min).slice(0, 10);
}
