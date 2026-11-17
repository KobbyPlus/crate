const FIELDS = ['geniusToken', 'bpmKey', 'youtubeKey'];
const $ = (id) => document.getElementById(id);

function say(el, msg, ok) {
  el.textContent = msg;
  el.className = `status ${ok ? 'ok' : 'bad'}`;
}

async function save() {
  const data = { coverMin: Number($('coverMin').value) };
  for (const f of FIELDS) data[f] = $(f).value.trim();
  await chrome.storage.sync.set(data);
}

chrome.storage.sync.get([...FIELDS, 'coverMin']).then((s) => {
  for (const f of FIELDS) if (s[f]) $(f).value = s[f];
  $('coverMin').value = String(s.coverMin || 100000);
});

$('save').addEventListener('click', async () => {
  await save();
  say($('saved'), 'Saved. Open a music video on YouTube and hit Crate.', true);
});

const MESSAGES = {
  NO_TOKEN: 'Paste a token first.',
  NO_KEY: 'Paste a key first.',
  BAD_TOKEN: 'Genius rejected that token. Generate a new one.',
  BPM_BAD_KEY: 'GetSongBPM rejected that key.',
  YT_BAD_KEY: 'YouTube rejected that key. Make sure the YouTube Data API is enabled.',
  YT_QUOTA: 'Key works, but today’s YouTube quota is used up.',
};

document.querySelectorAll('[data-test]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const source = btn.dataset.test;
    const out = document.querySelector(`[data-status="${source}"]`);
    await save();
    say(out, 'Testing…', true);
    const res = await chrome.runtime.sendMessage({ type: 'test', source });
    if (res && res.ok) say(out, 'Connected.', true);
    else say(out, MESSAGES[res && res.error] || `Couldn’t connect (${res ? res.error : 'no response'}).`, false);
  });
});

// Server status
(async () => {
  const el = document.getElementById('server');
  const st = await chrome.runtime.sendMessage({ type: 'serverStatus' });
  el.textContent = '';
  const dot = document.createElement('span');
  dot.className = 'dotok';
  if (!st || !st.configured) {
    dot.className = 'dotok dotbad';
    el.append(dot, 'No server set up in this build. Add your own keys below to use Crate.');
    document.getElementById('adv').open = true;
  } else if (!st.ok) {
    dot.className = 'dotok dotbad';
    el.append(dot, `Can’t reach the Crate server right now (${st.error}). Your own keys below will be used if you add them.`);
  } else {
    const off = ['genius', 'bpm', 'youtube'].filter((k) => !st[k]);
    el.append(dot, 'Connected. No keys needed.' + (off.length ? ` (Not enabled on the server yet: ${off.join(', ')}.)` : ''));
  }
})();
