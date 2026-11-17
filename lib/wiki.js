// Wikipedia: short background summary for the song. Free, no key.
import { cacheGet, cacheSet, norm, stripTags } from './util.js';

export function pickPage(results, artist, title) {
  const t = norm(title);
  const a = norm(artist);
  const scored = (results || [])
    .map((r) => {
      const base = norm(r.title.replace(/\(.*\)/, ''));
      if (base !== t) return null;
      let s = 1;
      if (norm(r.title).includes(a)) s += 3;
      if (/\(.*song.*\)/i.test(r.title)) s += 1;
      if (a && norm(stripTags(r.snippet)).includes(a)) s += 2;
      return { r, s };
    })
    .filter(Boolean)
    .sort((x, y) => y.s - x.s);
  return scored.length && scored[0].s >= 3 ? scored[0].r.title : null;
}

export async function getWiki(artist, title) {
  const key = `wiki:${norm(artist)}|${norm(title)}`;
  const cached = await cacheGet(key, 30);
  if (cached !== undefined) return cached;

  const s = new URL('https://en.wikipedia.org/w/api.php');
  Object.entries({ action: 'query', list: 'search', srsearch: `${title} ${artist} song`, srlimit: 8, format: 'json', origin: '*' })
    .forEach(([k, v]) => s.searchParams.set(k, v));
  const sr = await (await fetch(s)).json();
  const page = pickPage(sr.query && sr.query.search, artist, title);
  if (!page) return cacheSet(key, null);

  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.replace(/ /g, '_'))}`);
  if (!res.ok) return cacheSet(key, null);
  const sum = await res.json();
  const extract = (sum.extract || '').trim();
  // Guard against the wrong song with the same name.
  const lastWord = norm(artist).split(' ').pop();
  if (sum.type === 'disambiguation' || !extract || (lastWord && !norm(extract).includes(lastWord))) return cacheSet(key, null);
  return cacheSet(key, {
    title: sum.title,
    extract,
    url: (sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page) || `https://en.wikipedia.org/wiki/${encodeURIComponent(page)}`,
  });
}
