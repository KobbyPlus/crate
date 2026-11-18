const $ = (id) => document.getElementById(id);

chrome.storage.sync.get(['coverMin', 'showBadge']).then((s) => {
  $('coverMin').value = String(s.coverMin || 100000);
  $('showBadge').checked = s.showBadge !== false;
});

$('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({ coverMin: Number($('coverMin').value), showBadge: $('showBadge').checked });
  const out = $('saved');
  out.textContent = 'Saved.';
  out.className = 'status ok';
});

(async () => {
  const el = $('server');
  const st = await chrome.runtime.sendMessage({ type: 'serverStatus' });
  el.textContent = '';
  const dot = document.createElement('span');
  dot.className = 'dotok';
  if (!st || !st.configured) {
    dot.className = 'dotok dotbad';
    el.append(dot, 'This build isn’t connected to a Crate server yet (developer setup: see server/README.md).');
  } else if (!st.ok) {
    dot.className = 'dotok dotbad';
    el.append(dot, `Can’t reach the Crate server right now (${st.error}). Try again in a minute.`);
  } else {
    const off = [['genius', 'Genius'], ['bpm', 'BPM'], ['youtube', 'covers'], ['lyrics', 'lyrics']].filter(([k]) => !st[k]).map(([, n]) => n);
    el.append(dot, 'Connected. Everything’s ready.' + (off.length ? ` (Not switched on yet: ${off.join(', ')}.)` : ''));
  }
})();
