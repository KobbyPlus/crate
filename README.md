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
3. The settings page opens. Add your keys (instructions are on the page):
   - **Genius** (required): https://genius.com/api-clients
   - **GetSongBPM** (optional, BPM and key): https://getsongbpm.com/api
   - **YouTube Data API v3** (optional, covers): Google Cloud console
4. Open a music video and hit the **Crate** button, or press `Alt+Shift+C`.

Updating from an older version: replace the folder, then hit the reload arrow on Crate's card in `chrome://extensions`.

## Data sources

| Source | What it gives | Key |
|---|---|---|
| Genius | Samples, interpolations, covers list, meanings, base credits, artist pages | Required |
| MusicBrainz | Engineers, mixers, mastering, instruments, studios, songwriters | None |
| GetSongBPM | BPM, key, time signature (backlink required, shown in the footer) | Free |
| YouTube Data API | Popular covers with view counts | Free |
| Wikipedia | Background summary | None |

Notes:
- YouTube's free quota is 10,000 units a day and one cover search uses 100, so covers load only when you open the Covers tab, and results are cached for a week.
- MusicBrainz asks for 1 request per second, so full credits can take a couple of seconds to fill in.
- Everything is cached locally (7 to 30 days depending on the source) so repeat visits are instant.

## Files

| Path | Job |
|---|---|
| `background.js` | Service worker. Routes messages and combines the sources |
| `lib/genius.js`, `lib/musicbrainz.js`, `lib/bpm.js`, `lib/youtube.js`, `lib/wiki.js` | One file per data source |
| `lib/credits.js` | Merges and orders credits from Genius and MusicBrainz |
| `content.js` | Detects what's playing and draws the panel (Shadow DOM, text-only rendering, no innerHTML) |
| `card.js` | Draws the share card |
| `parse.js` | Cleans YouTube titles into artist + title |
| `panel.css` | Panel design |
| `fonts/` | Inter (SIL Open Font License) |

## Before publishing to the Chrome Web Store

- Move the API keys behind a small server (a Cloudflare Worker works) so users don't need their own.
- Add the GetSongBPM backlink to the store listing, as their terms require.
- Write a privacy policy (Crate collects nothing, which makes it short).

## Roadmap

- [ ] Sample map: a visual family tree
- [ ] Spotify and SoundCloud support
- [ ] Discogs for original pressings and label info
- [ ] Firefox port
