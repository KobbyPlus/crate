// Offline tests for the Crate server. Run: node test.mjs
import assert from 'node:assert/strict';
import worker from './src/index.js';

const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => store.set(r.url, res) } };
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ u, auth: init.headers && (init.headers.Authorization || init.headers['X-API-KEY']) });
  if (u.includes('api.genius.com/search')) return new Response(JSON.stringify({ response: { hits: [] } }), { status: 200 });
  if (u.includes('api.genius.com/songs/1')) return new Response(JSON.stringify({ response: { song: { id: 1 } } }), { status: 200 });
  if (u.includes('api.genius.com/songs/2')) return new Response('{}', { status: 401 });
  if (u.includes('api.getsong.co')) return new Response(JSON.stringify({ search: [{ tempo: 84 }] }), { status: 200 });
  if (u.includes('lrclib.net/api/search')) return new Response(JSON.stringify([{ trackName: 'Through the Wire', artistName: 'Kanye West', syncedLyrics: '[00:01.00] line' }]), { status: 200 });
  if (u.includes('youtube/v3/search')) return new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 });
  return new Response('{}', { status: 404 });
};
let limited = false;
const env = { GENIUS_TOKEN: 'secret-genius', BPM_KEY: 'secret-bpm', YOUTUBE_KEY: 'secret-yt', EXTENSION_IDS: '', RATE_LIMITER: { limit: async () => ({ success: !limited }) } };
const ctx = { waitUntil: (p) => p };
const EXT = 'chrome-extension://abcdefghijklmnop';
const get = async (path, origin = EXT, e = env) => {
  const res = await worker.fetch(new Request('https://crate-api.test' + path, { headers: origin ? { Origin: origin } : {} }), e, ctx);
  await new Promise((r) => setTimeout(r, 0));
  return { status: res.status, body: await res.json().catch(() => null), cors: res.headers.get('Access-Control-Allow-Origin') };
};

let r = await get('/health');
assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, genius: true, bpm: true, youtube: true, lyrics: true });

r = await get('/genius/search?q=through%20the%20wire&per_page=10');
assert.equal(r.status, 200); assert.equal(r.cors, EXT);
assert.equal(calls.at(-1).auth, 'Bearer secret-genius');
assert.ok(!JSON.stringify(r.body).includes('secret'), 'key must never reach the client');

const before = calls.length;
r = await get('/genius/search?per_page=10&q=through%20the%20wire');
assert.equal(calls.length, before, 'second identical request (any param order) is served from cache');

r = await get('/genius/search?q=x', 'https://evil.example');
assert.equal(r.status, 403, 'websites are blocked');

r = await get('/genius/search?q=x', EXT, { ...env, EXTENSION_IDS: 'someotherid' });
assert.equal(r.status, 403, 'locked to listed extension IDs');

r = await get('/genius/search?q=x&access_token=steal');
assert.equal(r.status, 400, 'unknown params rejected');

r = await get('/genius/account');
assert.equal(r.status, 404, 'unlisted Genius endpoints blocked');

r = await get('/genius/songs/1?text_format=plain');
assert.equal(r.status, 200); assert.equal(r.body.response.song.id, 1);

r = await get('/genius/songs/2');
assert.equal(r.status, 502); assert.equal(r.body.error, 'SERVER_KEY_PROBLEM');

r = await get('/bpm/search?type=both&lookup=song%3AThrough%20the%20Wire%20artist%3AKanye%20West');
assert.equal(r.status, 200); assert.equal(r.body.search[0].tempo, 84);
assert.ok(calls.at(-1).u.includes('api_key=secret-bpm'));

r = await get('/yt/search?q=through%20the%20wire%20cover');
assert.equal(r.status, 429); assert.equal(r.body.error, 'YT_QUOTA');

r = await get('/yt/videos?id=../../etc');
assert.equal(r.status, 400, 'video ids validated');

r = await get('/bpm/search?type=both&lookup=x', EXT, { ...env, BPM_KEY: '' });
assert.equal(r.status, 503); assert.equal(r.body.error, 'SERVICE_DISABLED');

r = await get('/lyrics/search?track_name=Through%20the%20Wire&artist_name=Kanye%20West');
assert.equal(r.status, 200); assert.equal(r.body[0].trackName, 'Through the Wire');
assert.ok(calls.at(-1).u.startsWith('https://lrclib.net/api/search'));

r = await get('/lyrics/search?track_name=Other&artist_name=Someone', EXT, { ...env, LYRICS_ENABLED: 'false' });
assert.equal(r.status, 503); assert.equal(r.body.error, 'LYRICS_OFF', 'kill switch turns lyrics off');

r = await get('/lyrics/search?q=anything');
assert.equal(r.status, 400, 'only structured lyric lookups allowed');

limited = true;
r = await get('/genius/search?q=brand%20new%20query');
assert.equal(r.status, 429); assert.equal(r.body.error, 'RATE_LIMIT');
r = await get('/genius/search?q=through%20the%20wire&per_page=10');
assert.equal(r.status, 200, 'cached results still served while rate limited');

console.log('Server: all tests passed');
