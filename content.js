// Crate content script: detects what's playing on YouTube / YouTube Music and shows the song x-ray.
(() => {
  if (window.__crateLoaded) return;
  window.__crateLoaded = true;

  const IS_MUSIC = location.hostname === 'music.youtube.com';
  const { parseTitle, cleanChannel } = window.CrateParse;
  const ext = (p) => chrome.runtime.getURL(p);

  // Fonts must be declared on the page (Shadow DOM ignores @font-face). Unique names, so YouTube is unaffected.
  if (!document.getElementById('crate-fonts')) {
    const st = document.createElement('style');
    st.id = 'crate-fonts';
    st.textContent =
      `@font-face{font-family:"CrateSans";src:url("${ext('fonts/inter.woff2')}") format("woff2");font-weight:100 900;font-display:swap}`;
    (document.head || document.documentElement).append(st);
  }

  // ---------- safe DOM builder: text only, never innerHTML ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'href') {
        if (/^(https?:\/\/|blob:)/i.test(v)) el.setAttribute('href', v);
      } else if (k === 'src') {
        if (/^(https:\/\/|chrome-extension:\/\/|blob:|data:image\/)/i.test(v)) el.setAttribute('src', v);
      } else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false || kid === '') continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve({ error: 'EXTENSION_RELOADED' });
          else resolve(res || { error: 'NO_RESPONSE' });
        });
      } catch {
        resolve({ error: 'EXTENSION_RELOADED' });
      }
    });
  }

  const ext_link = (href, label, cls) => h('a', { href, target: '_blank', rel: 'noopener', class: cls }, label);

  // ---------- what's playing ----------
  function text(sel) {
    const el = document.querySelector(sel);
    return el ? el.textContent.trim() : '';
  }

  function readNowPlaying() {
    if (IS_MUSIC) {
      const title = text('ytmusic-player-bar .title');
      const byline = text('ytmusic-player-bar .byline');
      if (!title) return null;
      const artist = cleanChannel(byline.split('•')[0].trim());
      return { title, artist, key: `${artist}|${title}`, raw: `${artist} - ${title}` };
    }
    if (location.pathname !== '/watch') return null;
    const raw =
      text('ytd-watch-metadata h1 yt-formatted-string') ||
      document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '');
    const channel = text('ytd-watch-metadata ytd-channel-name a') || text('#owner ytd-channel-name a');
    if (!raw) return null;
    const vid = new URLSearchParams(location.search).get('v') || '';
    return { ...parseTitle(raw, channel), key: `${vid}|${raw}`, raw };
  }

  // ---------- shell ----------
  const host = h('div', { id: 'crate-root' });
  const shadow = host.attachShadow({ mode: 'open' });
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = ext('panel.css');
  const fab = h('button', { class: 'fab', title: 'Dig into this song (Alt+Shift+C)', onclick: () => toggle() },
    h('img', { src: ext('icons/logo.svg'), alt: '' }), h('span', {}, 'Crate'));
  const panel = h('aside', { class: 'panel', 'aria-label': 'Crate' });
  shadow.append(css, fab, panel);

  const S = {
    open: false,
    view: 'empty', // empty | loading | song | artist | pick | crate | error
    current: null,
    song: null,
    extra: null,
    covers: null,
    artist: null,
    candidates: [],
    stack: [],
    tab: 'samples',
    error: '',
    saved: [],
    card: null,
  };

  function mount() {
    if (!document.body.contains(host)) document.body.append(host);
  }

  function toggle(force) {
    S.open = force ?? !S.open;
    panel.classList.toggle('open', S.open);
    fab.classList.toggle('hidden', S.open);
    if (S.open && !S.song && S.view !== 'loading' && S.view !== 'crate') lookupCurrent();
    render();
  }

  // ---------- navigation ----------
  function snapshot() {
    return { view: S.view, song: S.song, extra: S.extra, covers: S.covers, artist: S.artist, tab: S.tab };
  }
  function push() {
    if (['song', 'artist', 'crate'].includes(S.view)) S.stack.push(snapshot());
  }
  function goBack() {
    const prev = S.stack.pop();
    if (!prev) return;
    Object.assign(S, prev);
    render({ top: true });
  }

  // ---------- data ----------
  async function lookupCurrent() {
    const now = readNowPlaying();
    S.current = now;
    S.stack = [];
    if (!now || !now.title) {
      S.view = 'empty';
      S.song = null;
      return render();
    }
    S.view = 'loading';
    render();
    const res = await send({ type: 'lookup', query: { artist: now.artist, title: now.title } });
    if (res.error) return showError(res.error);
    S.candidates = res.candidates || [];
    if (!res.song) {
      S.view = 'pick';
      return render();
    }
    showSong(res.song);
  }

  function showSong(song) {
    S.song = song;
    S.extra = null;
    S.covers = null;
    S.view = 'song';
    S.tab = pickTab(song);
    render({ top: true });
    enrich(song.id);
  }

  async function enrich(id) {
    const res = await send({ type: 'enrich', id });
    if (!S.song || S.song.id !== id) return;
    S.extra = res.error ? { stats: { status: 'error', error: res.error }, credits: S.song.credits, wiki: null } : res;
    if (S.view === 'song') render();
  }

  async function openSong(id, { pin = false } = {}) {
    push();
    S.view = 'loading';
    render();
    const res = await send({ type: 'song', id });
    if (res.error) return showError(res.error);
    if (pin && S.current) send({ type: 'pin', id, query: { artist: S.current.artist, title: S.current.title } });
    showSong(res.song);
  }

  async function loadCovers() {
    if (!S.song || S.covers) return;
    const id = S.song.id;
    S.covers = { status: 'loading' };
    render();
    const res = await send({ type: 'covers', id });
    if (!S.song || S.song.id !== id) return;
    S.covers = res.error ? { status: 'error', error: res.error, fallback: S.song.groups.covered_by } : res;
    render();
  }

  async function openArtist(person) {
    push();
    S.view = 'loading';
    render();
    const res = person.geniusId
      ? await send({ type: 'artist', id: person.geniusId })
      : await send({ type: 'artistByName', name: person.name });
    if (res.error) return showError(res.error);
    S.artist = res.artist || { name: person.name, missing: true, mbid: person.mbid };
    S.view = 'artist';
    render({ top: true });
  }

  async function runSearch(q) {
    if (!q.trim()) return;
    S.view = 'loading';
    render();
    const res = await send({ type: 'search', q });
    if (res.error) return showError(res.error);
    S.candidates = res.candidates || [];
    S.view = 'pick';
    render();
  }

  function pickTab(song) {
    const g = song.groups;
    if (g.samples.length) return 'samples';
    if (g.interp_from.length) return 'interpolations';
    if (g.sampled_in.length) return 'sampled_in';
    if (g.interp_by.length) return 'interpolations';
    return 'meaning';
  }

  function showError(code) {
    S.view = 'error';
    S.error = code;
    render();
  }

  // ---------- saved crate ----------
  const SAVE_KEY = 'crateSaved';
  chrome.storage.local.get(SAVE_KEY).then((o) => {
    S.saved = o[SAVE_KEY] || [];
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SAVE_KEY]) {
      S.saved = changes[SAVE_KEY].newValue || [];
      render();
    }
  });
  const isSaved = (id) => S.saved.some((s) => s.id === id);
  function toggleSave(song) {
    const stats = S.extra && S.extra.stats && S.extra.stats.status === 'ok' ? S.extra.stats : null;
    const next = isSaved(song.id)
      ? S.saved.filter((s) => s.id !== song.id)
      : [{ id: song.id, title: song.title, artist: song.artist, art: song.art, bpm: stats ? stats.bpm : null, key: stats ? stats.key : '', savedAt: Date.now() }, ...S.saved];
    S.saved = next;
    chrome.storage.local.set({ [SAVE_KEY]: next });
    render();
  }

  // ---------- share card ----------
  async function makeCard() {
    const song = S.song;
    S.card = { status: 'loading' };
    render();
    const [art, logo] = await Promise.all([
      song.artFull ? send({ type: 'image', url: song.artFull }) : Promise.resolve({}),
      send({ type: 'image', url: ext('icons/logo.png') }),
    ]);
    const blob = await window.CrateCard.render({
      song,
      stats: S.extra ? S.extra.stats : null,
      art: art.dataUrl || '',
      logo: logo.dataUrl || '',
    });
    if (!S.card) return;
    S.card = { status: 'ready', blob, url: URL.createObjectURL(blob), name: `crate-${slug(song.artist)}-${slug(song.title)}.png` };
    render();
  }
  function closeCard() {
    if (S.card && S.card.url) URL.revokeObjectURL(S.card.url);
    S.card = null;
    render();
  }
  async function copyCard() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': S.card.blob })]);
      S.card.copied = true;
    } catch {
      S.card.copied = 'fail';
    }
    render();
  }
  const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

  // ---------- render helpers ----------
  const fmtViews = (n) =>
    n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
  const ytSearch = (s) => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(`${s.artist} ${s.title}`);

  function songRow(s, { onPick } = {}) {
    return h('li', { class: 'row' },
      h('button', { class: 'row-main', onclick: onPick || (() => openSong(s.id)), title: 'Dig into this one' },
        s.art ? h('img', { class: 'thumb', src: s.art, alt: '', loading: 'lazy' }) : h('div', { class: 'thumb ph' }),
        h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, s.title), h('div', { class: 'row-sub' }, s.artist))),
      h('a', { class: 'play', href: ytSearch(s), target: '_blank', rel: 'noopener', title: 'Find on YouTube' }, '▶'));
  }

  function list(items, opts) {
    return h('ul', { class: 'list' }, items.map((s) => songRow(s, opts && opts(s))));
  }

  function label(text) {
    return h('h4', { class: 'label' }, text);
  }

  function empty(msg, song, extra) {
    return h('div', { class: 'empty' },
      h('p', {}, msg),
      extra || null,
      song ? ext_link(song.url, 'Know one? Add it on Genius →', 'small-link') : null);
  }

  function personChip(p, kind) {
    if (kind === 'place') {
      return p.mbPlaceId
        ? h('a', { class: 'chip place', href: `https://musicbrainz.org/place/${p.mbPlaceId}`, target: '_blank', rel: 'noopener' }, p.name)
        : h('span', { class: 'chip place' }, p.name);
    }
    return h('button', { class: 'chip', onclick: () => openArtist(p), title: `More from ${p.name}` }, p.name);
  }

  // ---------- tabs ----------
  const TABS = [
    ['samples', 'Samples'],
    ['interpolations', 'Interpolations'],
    ['sampled_in', 'Sampled In'],
    ['covers', 'Covers'],
    ['meaning', 'Meaning'],
    ['credits', 'Credits'],
  ];

  function tabCount(song, key) {
    const g = song.groups;
    switch (key) {
      case 'samples': return g.samples.length;
      case 'interpolations': return g.interp_from.length + g.interp_by.length;
      case 'sampled_in': return g.sampled_in.length;
      case 'covers': return S.covers && S.covers.status === 'ok' ? S.covers.list.length : 0;
      case 'meaning': return song.annotations.length;
      case 'credits': return S.extra ? S.extra.credits.reduce((n, r) => n + r.people.length, 0) : 0;
    }
    return 0;
  }

  function tabBody(song) {
    const g = song.groups;
    switch (S.tab) {
      case 'samples':
        return g.samples.length ? list(g.samples) : empty('No samples listed for this song yet.', song);

      case 'sampled_in':
        return g.sampled_in.length ? list(g.sampled_in) : empty('Nobody has been credited with sampling this yet.', song);

      case 'interpolations':
        if (!g.interp_from.length && !g.interp_by.length) return empty('No interpolations listed for this song yet.', song);
        return h('div', {},
          h('p', { class: 'explain' }, 'Melody or lyrics re-played or re-sung, not lifted from the original recording.'),
          g.interp_from.length ? [label('This song interpolates'), list(g.interp_from)] : null,
          g.interp_by.length ? [label('Interpolated by'), list(g.interp_by)] : null);

      case 'covers': {
        const c = S.covers;
        const coverOf = g.cover_of.length ? [label('This song is a cover of'), list(g.cover_of)] : null;
        if (!c || c.status === 'loading') return h('div', {}, coverOf, h('div', { class: 'loading small' }, h('div', { class: 'spin' }), 'Finding popular covers…'));
        const fallback = (c.fallback || []).length ? [label('Covers listed on Genius'), list(c.fallback)] : null;
        if (c.status === 'nokey') {
          return h('div', {}, coverOf,
            h('div', { class: 'notice' }, 'Add a free YouTube API key in settings to see the most-viewed covers.',
              h('button', { class: 'link', onclick: () => send({ type: 'openOptions' }) }, 'Open settings')),
            fallback);
        }
        if (c.status === 'error') {
          const msg = c.error === 'YT_QUOTA' ? 'YouTube’s daily limit is used up. Covers come back tomorrow.' :
            c.error === 'YT_BAD_KEY' ? 'YouTube rejected your API key. Check it in settings.' : `Couldn’t load covers (${c.error}).`;
          return h('div', {}, coverOf, h('div', { class: 'notice' }, msg), fallback);
        }
        const vids = c.list || [];
        return h('div', {}, coverOf,
          h('p', { class: 'explain' }, `Covers with ${fmtViews(c.min)}+ views on YouTube, most watched first.`),
          vids.length
            ? h('ul', { class: 'list' }, vids.map((v) =>
                h('li', { class: 'row' },
                  h('a', { class: 'row-main video', href: v.url },
                    h('div', { class: 'vthumb' }, h('img', { src: v.thumb, alt: '', loading: 'lazy' }), h('span', { class: 'views' }, fmtViews(v.views))),
                    h('div', { class: 'row-text' }, h('div', { class: 'row-title two' }, v.title), h('div', { class: 'row-sub' }, v.channel))))))
            : h('div', { class: 'empty' }, h('p', {}, 'No covers have crossed that view count yet.')),
          fallback);
      }

      case 'meaning': {
        const wiki = S.extra && S.extra.wiki;
        const parts = [];
        if (wiki) parts.push(h('section', { class: 'block' }, label('Background'), h('p', { class: 'prose' }, wiki.extract), ext_link(wiki.url, 'Read more on Wikipedia →', 'small-link')));
        if (song.about) parts.push(h('section', { class: 'block' }, label('About the song'), h('p', { class: 'prose clamp' }, song.about), ext_link(song.url, 'Full story on Genius →', 'small-link')));
        if (song.annotations.length) {
          parts.push(label('Line by line'));
          parts.push(h('ul', { class: 'notes' }, song.annotations.map((a) =>
            h('li', { class: 'note' },
              h('div', { class: 'frag' }, a.fragment, a.verified ? h('span', { class: 'badge' }, 'ARTIST') : null),
              h('p', {}, a.body)))));
        }
        if (!S.extra) parts.push(h('div', { class: 'loading small' }, h('div', { class: 'spin' }), 'Pulling background…'));
        return parts.length ? h('div', {}, parts) : empty('No interpretations yet.', song);
      }

      case 'credits': {
        const credits = S.extra ? S.extra.credits : song.credits;
        const meta = [song.album ? ['Album', song.album] : null, song.release ? ['Released', song.release] : null].filter(Boolean);
        return h('div', {},
          meta.length ? h('div', { class: 'meta' }, meta.map(([k, v]) => h('div', { class: 'meta-cell' }, h('span', { class: 'meta-k' }, k), h('span', { class: 'meta-v' }, v)))) : null,
          credits.length
            ? h('div', { class: 'credits' }, credits.map((r) =>
                h('div', { class: 'credit' }, h('div', { class: 'credit-role' }, r.role), h('div', { class: 'chips' }, r.people.map((p) => personChip(p, r.kind))))))
            : empty('No credits listed yet.', song),
          !S.extra ? h('div', { class: 'loading small' }, h('div', { class: 'spin' }), 'Checking MusicBrainz for full credits…') : null);
      }
    }
  }

  // ---------- stats strip ----------
  function statsStrip() {
    const st = S.extra && S.extra.stats;
    if (!st) return h('div', { class: 'stats' }, ['BPM', 'KEY', 'CAMELOT', 'TIME'].map((k) => h('div', { class: 'stat skeleton' }, h('span', { class: 'stat-k' }, k), h('span', { class: 'stat-v' }, '·'))));
    if (st.status === 'nokey') {
      return h('div', { class: 'notice slim' }, 'Add a free GetSongBPM key to see BPM and key.',
        h('button', { class: 'link', onclick: () => send({ type: 'openOptions' }) }, 'Settings'));
    }
    if (st.status !== 'ok') {
      return h('div', { class: 'notice slim' }, st.status === 'none' ? 'No BPM or key on file for this one yet.' : 'Couldn’t reach GetSongBPM right now.');
    }
    const half = Math.round(st.bpm / 2), dbl = st.bpm * 2;
    return h('div', { class: 'stats' },
      h('div', { class: 'stat', title: `Half time ${half} · Double time ${dbl}` }, h('span', { class: 'stat-k' }, 'BPM'), h('span', { class: 'stat-v' }, st.bpm), h('span', { class: 'stat-s' }, `½ ${half} · 2× ${dbl}`)),
      h('div', { class: 'stat' }, h('span', { class: 'stat-k' }, 'KEY'), h('span', { class: 'stat-v sm' }, st.key || '—')),
      h('div', { class: 'stat' }, h('span', { class: 'stat-k' }, 'CAMELOT'), h('span', { class: 'stat-v' }, st.camelot || '—')),
      h('div', { class: 'stat' }, h('span', { class: 'stat-k' }, 'TIME'), h('span', { class: 'stat-v' }, st.timeSig ? (String(st.timeSig).includes('/') ? st.timeSig : `${st.timeSig}/4`) : '—')));
  }

  // ---------- views ----------
  const ERRORS = {
    NO_TOKEN: 'Add your Genius access token to get started.',
    BAD_TOKEN: 'Your Genius token was rejected. Paste a fresh one in settings.',
    RATE_LIMIT: 'Genius is rate limiting requests. Give it a minute.',
    EXTENSION_RELOADED: 'Crate was updated. Refresh this page.',
  };

  function header() {
    return h('header', { class: 'top' },
      S.stack.length ? h('button', { class: 'icon', onclick: goBack, title: 'Back' }, '←') : null,
      h('div', { class: 'brand' }, h('img', { src: ext('icons/logo.svg'), alt: '' }), h('span', {}, 'Crate')),
      h('button', { class: 'icon crate-btn' + (S.view === 'crate' ? ' on' : ''), onclick: openCrate, title: 'My crate' },
        '▤', S.saved.length ? h('span', { class: 'dot' }, S.saved.length) : null),
      h('button', { class: 'icon', onclick: () => lookupCurrent(), title: 'Back to what’s playing' }, '↻'),
      h('button', { class: 'icon', onclick: () => toggle(false), title: 'Close (Alt+Shift+C)' }, '✕'));
  }

  function openCrate() {
    if (S.view === 'crate') return goBack();
    push();
    S.view = 'crate';
    render({ top: true });
  }

  function renderSong(body) {
    const song = S.song;
    const saved = isSaved(song.id);
    body.append(
      h('div', { class: 'hero' },
        h('div', { class: 'art-wrap' }, song.art ? h('img', { class: 'art', src: song.art, alt: '' }) : h('div', { class: 'art ph' })),
        h('div', { class: 'hero-text' },
          h('div', { class: 'title' }, song.title),
          h('button', { class: 'artist-link', onclick: () => openArtist({ name: song.artist, geniusId: song.artistId }) }, song.artist),
          h('div', { class: 'actions' },
            h('button', { class: 'pill' + (saved ? ' on' : ''), onclick: () => toggleSave(song) }, saved ? '✓ In crate' : '+ Crate'),
            h('button', { class: 'pill', onclick: makeCard }, '↗ Share'),
            !S.stack.length ? h('button', { class: 'pill ghost', onclick: () => { S.view = 'pick'; render(); } }, 'Wrong song?') : null))),
      statsStrip(),
      h('nav', { class: 'tabs' }, TABS.map(([key, name]) => {
        const n = tabCount(song, key);
        return h('button', {
          class: 'tab' + (S.tab === key ? ' active' : ''),
          onclick: () => { S.tab = key; if (key === 'covers') loadCovers(); render(); },
        }, name, n ? h('span', { class: 'count' }, n) : null);
      })),
      h('div', { class: 'content' }, tabBody(song)));
    if (S.tab === 'covers' && !S.covers) queueMicrotask(loadCovers);
  }

  function renderArtist(body) {
    const a = S.artist;
    if (a.missing) {
      body.append(h('div', { class: 'empty' },
        h('p', {}, `${a.name} doesn’t have a Genius page yet.`),
        a.mbid ? ext_link(`https://musicbrainz.org/artist/${a.mbid}`, 'See their credits on MusicBrainz →', 'small-link') : null));
      return;
    }
    body.append(
      h('div', { class: 'hero artist' },
        h('div', { class: 'art-wrap round' }, a.image ? h('img', { class: 'art', src: a.image, alt: '' }) : h('div', { class: 'art ph' })),
        h('div', { class: 'hero-text' }, h('div', { class: 'kicker' }, 'ARTIST'), h('div', { class: 'title' }, a.name),
          ext_link(a.url, 'Genius page →', 'small-link'))),
      a.bio ? h('p', { class: 'prose clamp' }, a.bio) : null,
      label('Most popular'),
      a.songs.length ? list(a.songs) : empty('No songs found.'));
  }

  function renderCrate(body) {
    body.append(h('div', { class: 'section-head' }, h('div', { class: 'kicker' }, 'MY CRATE'),
      S.saved.length ? h('button', { class: 'pill', onclick: copyList }, S.copiedList ? '✓ Copied' : 'Copy list') : null));
    if (!S.saved.length) {
      body.append(h('div', { class: 'empty' }, h('p', {}, 'Your crate is empty.'), h('p', { class: 'muted' }, 'Hit “+ Crate” on any song to save it here.')));
      return;
    }
    body.append(h('ul', { class: 'list' }, S.saved.map((s) =>
      h('li', { class: 'row' },
        h('button', { class: 'row-main', onclick: () => openSong(s.id) },
          s.art ? h('img', { class: 'thumb', src: s.art, alt: '' }) : h('div', { class: 'thumb ph' }),
          h('div', { class: 'row-text' }, h('div', { class: 'row-title' }, s.title),
            h('div', { class: 'row-sub' }, s.artist, s.bpm ? h('span', { class: 'tag' }, `${s.bpm} BPM`) : null, s.key ? h('span', { class: 'tag' }, s.key) : null))),
        h('button', { class: 'play', title: 'Remove', onclick: () => { S.saved = S.saved.filter((x) => x.id !== s.id); chrome.storage.local.set({ [SAVE_KEY]: S.saved }); render(); } }, '✕')))));
  }

  async function copyList() {
    const txt = S.saved.map((s) => `${s.artist} - ${s.title}${s.bpm ? ` (${s.bpm} BPM${s.key ? `, ${s.key}` : ''})` : ''}`).join('\n');
    try {
      await navigator.clipboard.writeText(txt);
      S.copiedList = true;
      render();
      setTimeout(() => { S.copiedList = false; render(); }, 1500);
    } catch {}
  }

  function searchBox(value) {
    let input;
    return h('form', { class: 'search', onsubmit: (e) => { e.preventDefault(); runSearch(input.value); } },
      (input = h('input', { type: 'search', placeholder: 'Search a song or artist', value: value || '' })),
      h('button', { type: 'submit' }, 'Search'));
  }

  function footer() {
    const song = S.song;
    if (S.view !== 'song' || !song) return null;
    const st = S.extra && S.extra.stats;
    const links = [ext_link(song.url, 'Genius')];
    if (st && st.status === 'ok') links.push(ext_link(st.uri || 'https://getsongbpm.com', 'GetSongBPM'));
    if (S.extra && S.extra.mbUrl) links.push(ext_link(S.extra.mbUrl, 'MusicBrainz'));
    if (S.extra && S.extra.wiki) links.push(ext_link(S.extra.wiki.url, 'Wikipedia'));
    if (S.covers && S.covers.status === 'ok') links.push(ext_link('https://www.youtube.com', 'YouTube'));
    return h('footer', { class: 'foot' }, 'Data: ', links.map((l, i) => [i ? ' · ' : '', l]));
  }

  function cardOverlay() {
    if (!S.card) return null;
    return h('div', { class: 'overlay' },
      h('div', { class: 'sheet' },
        h('div', { class: 'sheet-head' }, h('span', { class: 'kicker' }, 'SHARE CARD'), h('button', { class: 'icon', onclick: closeCard }, '✕')),
        S.card.status === 'loading'
          ? h('div', { class: 'loading' }, h('div', { class: 'spin' }), 'Making your card…')
          : [
              h('img', { class: 'card-preview', src: S.card.url, alt: 'Share card preview' }),
              h('div', { class: 'sheet-actions' },
                h('a', { class: 'cta', href: S.card.url, download: S.card.name }, 'Download PNG'),
                h('button', { class: 'cta alt', onclick: copyCard }, S.card.copied === true ? '✓ Copied' : S.card.copied === 'fail' ? 'Copy failed' : 'Copy image')),
              h('p', { class: 'muted center' }, 'Story-sized (1080×1920) for IG and TikTok.'),
            ]));
  }

  function render(opts = {}) {
    const prevBody = panel.querySelector('.body');
    const keep = !opts.top && prevBody ? prevBody.scrollTop : 0;

    panel.replaceChildren();
    panel.append(header());
    const body = h('div', { class: 'body' });
    panel.append(body);

    if (S.view === 'loading') {
      body.append(h('div', { class: 'loading' }, h('div', { class: 'spin' }), 'Digging…'));
    } else if (S.view === 'error') {
      body.append(h('div', { class: 'empty' },
        h('p', {}, ERRORS[S.error] || `Something went wrong (${S.error}).`),
        ['NO_TOKEN', 'BAD_TOKEN'].includes(S.error)
          ? h('button', { class: 'cta', onclick: () => send({ type: 'openOptions' }) }, 'Open settings')
          : h('button', { class: 'cta', onclick: () => lookupCurrent() }, 'Try again')));
    } else if (S.view === 'empty') {
      body.append(h('div', { class: 'empty' },
        h('p', {}, IS_MUSIC ? 'Play a song and Crate will dig in.' : 'Open a music video and Crate will dig in.'),
        searchBox('')));
    } else if (S.view === 'pick') {
      body.append(
        h('p', { class: 'hint' }, S.current ? `Looking for “${S.current.raw}”. Pick the right song:` : 'Pick a song:'),
        searchBox(S.current ? `${S.current.artist} ${S.current.title}`.trim() : ''),
        S.candidates.length
          ? list(S.candidates, (c) => ({ onPick: () => openSong(c.id, { pin: true }) }))
          : h('div', { class: 'empty' }, h('p', {}, 'No matches. Try a different search.')));
    } else if (S.view === 'song' && S.song) renderSong(body);
    else if (S.view === 'artist' && S.artist) renderArtist(body);
    else if (S.view === 'crate') renderCrate(body);

    const f = footer();
    if (f) panel.append(f);
    const o = cardOverlay();
    if (o) panel.append(o);
    if (keep) body.scrollTop = keep;
  }

  // ---------- watch for song changes (YouTube is a single-page app) ----------
  let lastKey = null;
  setInterval(() => {
    mount();
    const now = readNowPlaying();
    fab.classList.toggle('away', !now && !S.open);
    const key = now ? now.key : null;
    if (key !== lastKey) {
      lastKey = key;
      if (S.open && S.view !== 'crate' && !S.card) lookupCurrent();
      else S.song = null;
    }
  }, 1500);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'toggle') toggle();
  });

  mount();
  render();
})();
