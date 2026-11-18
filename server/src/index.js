// Crate API server: a small Cloudflare Worker that holds the API keys and caches results.
// The extension calls this instead of Genius / GetSongBPM / YouTube directly, so users need no keys.

const DAY = 86400;

const ID = /^\d{1,12}$/;
const SHORT = (max) => (v) => typeof v === 'string' && v.length > 0 && v.length <= max;
const ONE_OF = (...opts) => (v) => opts.includes(v);
const INT = (min, max) => (v) => /^\d+$/.test(v) && +v >= min && +v <= max;
const VIDEO_IDS = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{11}(,[A-Za-z0-9_-]{11}){0,49}$/.test(v);

// Every route the extension may use. Anything else is rejected.
const ROUTES = [
  {
    match: /^\/genius\/search$/,
    params: { q: SHORT(200), per_page: INT(1, 20) },
    ttl: DAY,
    upstream: (m, p, env) => genius('/search', p, env),
  },
  {
    match: /^\/genius\/songs\/(\d{1,12})$/,
    params: { text_format: ONE_OF('plain') },
    ttl: 7 * DAY,
    upstream: (m, p, env) => genius(`/songs/${m[1]}`, p, env),
  },
  {
    match: /^\/genius\/referents$/,
    params: { song_id: (v) => ID.test(v), text_format: ONE_OF('plain'), per_page: INT(1, 50) },
    required: ['song_id'],
    ttl: 3 * DAY,
    upstream: (m, p, env) => genius('/referents', p, env),
  },
  {
    match: /^\/genius\/artists\/(\d{1,12})$/,
    params: { text_format: ONE_OF('plain') },
    ttl: 7 * DAY,
    upstream: (m, p, env) => genius(`/artists/${m[1]}`, p, env),
  },
  {
    match: /^\/genius\/artists\/(\d{1,12})\/songs$/,
    params: { sort: ONE_OF('popularity', 'title'), per_page: INT(1, 50) },
    ttl: 7 * DAY,
    upstream: (m, p, env) => genius(`/artists/${m[1]}/songs`, p, env),
  },
  {
    match: /^\/bpm\/search$/,
    params: { type: ONE_OF('both', 'song', 'artist'), lookup: SHORT(200) },
    required: ['type', 'lookup'],
    ttl: 30 * DAY,
    upstream: (m, p, env) => bpm(p, env),
  },
  {
    match: /^\/lyrics\/search$/,
    params: { track_name: SHORT(200), artist_name: SHORT(200) },
    required: ['track_name', 'artist_name'],
    ttl: 14 * DAY,
    upstream: (m, p, env) => lyrics(p, env),
  },
  {
    match: /^\/yt\/search$/,
    params: { q: SHORT(200) },
    required: ['q'],
    ttl: 7 * DAY, // a search costs 100 of YouTube's 10,000 daily units, so cache hard
    upstream: (m, p, env) => youtube('/search', { part: 'snippet', type: 'video', maxResults: '25', q: p.q }, env),
  },
  {
    match: /^\/yt\/videos$/,
    params: { id: VIDEO_IDS },
    required: ['id'],
    ttl: DAY,
    upstream: (m, p, env) => youtube('/videos', { part: 'snippet,statistics', id: p.id }, env),
  },
];

// ---------- upstream calls (keys added here, never sent to the browser) ----------
function genius(path, params, env) {
  const url = new URL('https://api.genius.com' + path);
  setParams(url, params);
  return fetch(url, { headers: { Authorization: `Bearer ${env.GENIUS_TOKEN}` } });
}

function bpm(params, env) {
  const url = new URL('https://api.getsong.co/search/');
  setParams(url, { ...params, api_key: env.BPM_KEY });
  return fetch(url, { headers: { 'X-API-KEY': env.BPM_KEY } });
}

function lyrics(params) {
  const url = new URL('https://lrclib.net/api/search');
  setParams(url, params);
  // LRCLIB asks clients to identify themselves.
  return fetch(url, { headers: { 'User-Agent': 'Crate/1.0 (https://github.com/KobbyPlus/crate)' } });
}

function youtube(path, params, env) {
  const url = new URL('https://www.googleapis.com/youtube/v3' + path);
  setParams(url, { ...params, key: env.YOUTUBE_KEY });
  return fetch(url);
}

function setParams(url, params) {
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
}

// ---------- helpers ----------
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

function lyricsOn(env) {
  return String(env.LYRICS_ENABLED ?? 'true').toLowerCase() !== 'false';
}

function originAllowed(origin, env) {
  if (!origin) return true; // service workers in some Chrome versions omit Origin; non-browser use is limited by the rate limiter
  if (!origin.startsWith('chrome-extension://')) return false; // block websites from using the server
  const ids = (env.EXTENSION_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length === 0 || ids.includes(origin.slice('chrome-extension://'.length));
}

function cors(res, origin) {
  const r = new Response(res.body, res);
  if (origin) r.headers.set('Access-Control-Allow-Origin', origin);
  r.headers.set('Vary', 'Origin');
  return r;
}

async function upstreamError(res, service) {
  let reason = '';
  try {
    const body = await res.json();
    reason = (body && body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason) || '';
  } catch {}
  if (service === 'yt' && /quota/i.test(reason)) return json({ error: 'YT_QUOTA' }, 429);
  if (res.status === 429) return json({ error: 'RATE_LIMIT' }, 429);
  if (res.status === 401 || res.status === 403) return json({ error: 'SERVER_KEY_PROBLEM' }, 502);
  if (res.status === 404) return json({ error: 'NOT_FOUND' }, 404);
  return json({ error: `UPSTREAM_${res.status}` }, 502);
}

// ---------- main ----------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      if (!originAllowed(origin, env)) return json({ error: 'FORBIDDEN_ORIGIN' }, 403);
      return cors(new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } }), origin);
    }
    if (request.method !== 'GET') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (url.pathname === '/health') {
      return cors(json({ ok: true, genius: !!env.GENIUS_TOKEN, bpm: !!env.BPM_KEY, youtube: !!env.YOUTUBE_KEY, lyrics: lyricsOn(env) }), origin);
    }
    if (!originAllowed(origin, env)) return json({ error: 'FORBIDDEN_ORIGIN' }, 403);

    let route, m;
    for (const r of ROUTES) {
      m = url.pathname.match(r.match);
      if (m) {
        route = r;
        break;
      }
    }
    if (!route) return cors(json({ error: 'NOT_FOUND' }, 404), origin);

    // Only pass through known, validated params.
    const params = {};
    for (const [k, v] of url.searchParams) {
      const check = route.params[k];
      if (!check || !check(v)) return cors(json({ error: 'BAD_REQUEST', param: k }, 400), origin);
      params[k] = v;
    }
    for (const req of route.required || []) {
      if (!(req in params)) return cors(json({ error: 'BAD_REQUEST', param: req }, 400), origin);
    }

    const service = url.pathname.split('/')[1];
    if (service === 'lyrics') {
      // Kill switch: set LYRICS_ENABLED to "false" and redeploy to turn lyrics off for everyone.
      if (!lyricsOn(env)) return cors(json({ error: 'LYRICS_OFF' }, 503), origin);
    } else {
      const keyName = { genius: 'GENIUS_TOKEN', bpm: 'BPM_KEY', yt: 'YOUTUBE_KEY' }[service];
      if (!env[keyName]) return cors(json({ error: 'SERVICE_DISABLED', service }, 503), origin);
    }

    // Shared cache: one person's lookup speeds up everyone after them.
    const cache = caches.default;
    const sorted = new URL(url.origin + url.pathname);
    Object.keys(params).sort().forEach((k) => sorted.searchParams.set(k, params[k]));
    const cacheKey = new Request(sorted.toString(), { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) return cors(hit, origin);

    // Rate limit only uncached requests, per IP.
    if (env.RATE_LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return cors(json({ error: 'RATE_LIMIT' }, 429), origin);
    }

    let up;
    try {
      up = await route.upstream(m, params, env);
    } catch {
      return cors(json({ error: 'UPSTREAM_UNREACHABLE' }, 502), origin);
    }
    if (!up.ok) return cors(await upstreamError(up, service), origin);

    const body = await up.text();
    const res = new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${route.ttl}` },
    });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return cors(res, origin);
  },
};
