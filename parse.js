// Crate: turns a messy YouTube video title into { artist, title } for searching.
// Loaded before content.js, and also testable in Node.
(function (root) {
  const JUNK_IN_BRACKETS =
    /official|video|audio|lyric|visuali[sz]er|music video|\bhd\b|\bhq\b|\b4k\b|explicit|clean|remaster|\blive\b|\bmv\b|m\/v|prod\.?|directed|dir\.|color coded|sped up|slowed|reverb|extended|bass boosted/i;

  const JUNK_LOOSE =
    /\b(official\s+(music\s+)?video|official\s+audio|official\s+visuali[sz]er|official\s+lyric\s+video|lyric\s+video|lyrics?|visuali[sz]er|music\s+video|audio)\b/gi;

  function cleanChannel(channel) {
    if (!channel) return '';
    return channel
      .replace(/\s*-\s*topic$/i, '')
      .replace(/vevo$/i, '')
      .replace(/\s*\b(official|music|tv|channel|records)\b\s*$/i, '')
      .trim();
  }

  function stripFeat(s) {
    return s
      .replace(/\s*[(\[]with\s+[^)\]]+[)\]]/i, ' ')
      .replace(/\s*\(?\b(feat\.?|ft\.?|featuring)\s+[^\-–—()\[\]]+\)?/i, ' ');
  }

  function tidy(s) {
    return s.replace(/\s+/g, ' ').replace(/^[\s\-–—|:]+|[\s\-–—|:]+$/g, '').trim();
  }

  function parseTitle(raw, channel) {
    let t = (raw || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

    // Drop bracketed junk like (Official Video) or [Lyrics], keep the rest.
    t = t.replace(/[(\[【]([^)\]】]*)[)\]】]/g, (m, inner) => (JUNK_IN_BRACKETS.test(inner) ? ' ' : m));
    // "Song | Official Video" or "Song // Lyrics"
    t = t.replace(/\s(\||\/\/)\s.*$/, '');
    t = t.replace(JUNK_LOOSE, ' ');

    let artist = '';
    let title = '';

    const quoted = t.match(/^(.+?)\s+"(.+?)"/);
    const dashed = t.split(/\s[-–—]\s/);

    if (dashed.length >= 2) {
      artist = dashed[0];
      title = dashed.slice(1).join(' - ');
    } else if (quoted) {
      artist = quoted[1];
      title = quoted[2];
    } else {
      title = t;
      artist = cleanChannel(channel);
    }

    artist = tidy(stripFeat(artist).replace(/\s*[x×&,]\s*$/i, ''));
    title = tidy(stripFeat(title).replace(/^"|"$/g, ''));

    return { artist, title };
  }

  const api = { parseTitle, cleanChannel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CrateParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
