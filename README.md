# Crate

**Dig into any song.** A Chrome extension that x-rays whatever you're playing on YouTube or YouTube Music.

BPM and key data provided by [GetSongBPM](https://getsongbpm.com).

- **Samples, Interpolations, Sampled In:** the song's family tree. Click any song to keep digging.
- **Covers:** only the most-viewed YouTube covers (100K+ views by default, adjustable).
- **BPM, key, Camelot, time signature:** plus half-time and double-time BPM for producers and DJs.
- **Meaning:** Wikipedia background, the Genius story, and line-by-line annotations.
- **Credits:** producers, writers, engineers, mixers, instruments and studios. Every name is clickable.
- **My Crate:** save songs you dig up, then copy the list.
- **Share card:** export a story-sized (1080×1920) image for IG and TikTok.
- **Shortcut:** `Alt+Shift+C` opens and closes the panel.

## Install

1. Unzip and keep the `crate` folder somewhere permanent.
2. Go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick `crate`.
3. Open a music video and hit the **Crate** button, or press `Alt+Shift+C`.

No API keys needed. Crate talks to its own small server (`server/`), which holds the keys and caches results for everyone. Developers can still add their own keys under **Settings → Use your own API keys**.

Updating from an older version: replace the folder, then hit the reload arrow on Crate's card in `chrome://extensions`.

## Data sources

| Source | What it gives | Through |
|---|---|---|
| Genius | Samples, interpolations, covers list, meanings, base credits, artist pages | Crate server |
| MusicBrainz | Engineers, mixers, mastering, instruments, studios, songwriters | Direct, no key |
| GetSongBPM | BPM, key, time signature (backlink shown in the footer) | Crate server |
| YouTube Data API | Popular covers with view counts | Crate server |
| Wikipedia | Background summary | Direct, no key |

Notes:
- YouTube's free quota is 10,000 units a day and one cover search uses 100, so covers load only when you open the Covers tab, and results are cached for a week.
- MusicBrainz asks for 1 request per second, so full credits can take a couple of seconds to fill in.
- Everything is cached locally (7 to 30 days depending on the source) so repeat visits are instant.

## Files

| Path | Job |
|---|---|
| `background.js` | Service worker. Routes messages and combines the sources |
| `lib/config.js` | The Crate server URL |
| `server/` | The key-holding Cloudflare Worker |
| `lib/genius.js`, `lib/musicbrainz.js`, `lib/bpm.js`, `lib/youtube.js`, `lib/wiki.js` | One file per data source |
| `lib/credits.js` | Merges and orders credits from Genius and MusicBrainz |
| `content.js` | Detects what's playing and draws the panel (Shadow DOM, text-only rendering, no innerHTML) |
| `card.js` | Draws the share card |
| `parse.js` | Cleans YouTube titles into artist + title |
| `panel.css` | Panel design |
| `fonts/` | Inter (SIL Open Font License) |

## Server

See [server/README.md](server/README.md) to deploy the key-holding server on Cloudflare's free tier.

## Before publishing to the Chrome Web Store

- Lock the server to Crate's store ID (`EXTENSION_IDS` in `server/wrangler.toml`).
- Add the GetSongBPM backlink to the store listing, as their terms require.
- Write a privacy policy (Crate collects nothing, which makes it short).

## Roadmap

- [ ] Sample map: a visual family tree
- [ ] Spotify and SoundCloud support
- [ ] Discogs for original pressings and label info
- [ ] Firefox port
