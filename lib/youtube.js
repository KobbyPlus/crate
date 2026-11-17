// YouTube Data API: popular covers with real view counts.
// Quota note: one search costs 100 units of the free 10,000/day, so covers load only when the tab is opened.
import { cacheGet, cacheSet, norm, decodeEntities } from './util.js';

const API = 'https://www.googleapis.com/youtube/v3';
const JUNK = /\b(reaction|react|reacts|karaoke|tutorial|lesson|how to|lyrics?|8d|slowed|sped up|nightcore|remix|mashup|type beat|instrumental remake|backing track)\b/i;

async function yt(path, params, apiKey) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries({ ...params, key: apiKey })) url.searchParams.set(k, String(v));
  const res = await fetch(url);
  if (!res.ok) {
    let reason = '';
    try {
      const j = await res.json();
      reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || '';
    } catch {}
    if (/quota/i.test(reason)) throw new Error('YT_QUOTA');
    if (res.status === 400 || res.status === 403) throw new Error('YT_BAD_KEY');
    throw new Error(`YT_${res.status}`);
  }
  return res.json();
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

export async function getCovers(artist, title, apiKey, min) {
  const key = `yt:${norm(artist)}|${norm(title)}`;
  let all = await cacheGet(key, 7);
  if (all === undefined) {
    const search = await yt('/search', { part: 'snippet', type: 'video', maxResults: 25, q: `${title} ${artist} cover` }, apiKey);
    const ids = (search.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
    let videos = [];
    if (ids.length) videos = (await yt('/videos', { part: 'snippet,statistics', id: ids.join(',') }, apiKey)).items || [];
    all = await cacheSet(key, filterCovers(videos, artist, title));
  }
  return all.filter((v) => v.views >= min).slice(0, 10);
}

export async function testYoutube(apiKey) {
  await yt('/videos', { part: 'id', id: 'dQw4w9WgXcQ' }, apiKey);
  return true;
}
