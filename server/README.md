# Crate server

A tiny Cloudflare Worker that holds Crate's API keys so users can install the extension and go, with no keys of their own.

**What it does**
- Adds your Genius, GetSongBPM and YouTube keys to requests, and fetches lyrics from LRCLIB. The keys never reach anyone's browser.
- Only allows the exact endpoints Crate uses, with validated parameters.
- Blocks websites from using it (only Chrome extensions are allowed, and you can lock it to Crate's ID).
- Caches every answer at Cloudflare's edge, shared by all users (1 to 30 days depending on the data).
- Rate limits each user to 120 uncached requests a minute.

Free tier: Cloudflare Workers allows 100,000 requests a day for free.

## Deploy (about 10 minutes, one time)

You need [Node.js](https://nodejs.org) (LTS) and a free [Cloudflare account](https://dash.cloudflare.com/sign-up).

```bash
cd server
npm install
npx wrangler login                    # opens the browser, click Allow
npx wrangler secret put GENIUS_TOKEN  # paste your Genius token, press Enter
npx wrangler secret put YOUTUBE_KEY   # paste your YouTube key
npx wrangler secret put BPM_KEY       # paste your GetSongBPM key (skip until you have it)
npx wrangler deploy
```

`deploy` prints a URL like `https://crate-api.<your-subdomain>.workers.dev`. Then:

1. Open `lib/config.js` in the extension and set `SERVER_URL` to that URL.
2. Reload Crate in `chrome://extensions`.
3. Crate's settings page should say **Connected. No keys needed.**

Any service without a key is simply hidden in Crate (for example, BPM stays hidden until you add `BPM_KEY`). Add a missing key later with the same `secret put` command. Keys update without redeploying.

## Lyrics off switch

Lyrics come from LRCLIB, a free community lyrics database. If a rights holder ever objects, turn lyrics off for every user instantly, no extension update needed:

1. In `wrangler.toml`, set `LYRICS_ENABLED = "false"`.
2. Run `npx wrangler deploy`.

Crate then shows "Lyrics aren't available right now" with a link to the song's Genius page.

## Lock it to your extension (recommended once it's on the Chrome Web Store)

Set `EXTENSION_IDS` in `wrangler.toml` to your extension's ID (shown in `chrome://extensions`), then run `npx wrangler deploy` again.

## Limits to know

- **YouTube** gives 10,000 quota units a day and a cover search costs 100, so about 100 *new* songs' covers a day across all users. Cached songs don't count. If Crate grows, request a free quota increase from Google.
- **GetSongBPM** allows 3,000 requests an hour per key.
- **Genius** has no published hard limit, but be respectful. The cache handles most of the load.

## Test

```bash
node test.mjs
```
