// Crate share card: draws a 1080x1920 story-sized PNG of a song's breakdown.
(function (root) {
  const C = { bg: '#0C082B', purple: '#3C1361', red: '#BB182E', red2: '#E2475D', text: '#F2ECFF', mute: '#A99BC9', line: 'rgba(242,236,255,0.14)' };

  function loadImg(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => resolve(null);
      i.src = src;
    });
  }

  function wrap(ctx, text, maxW, maxLines) {
    const words = (text || '').split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= maxW) line = test;
      else {
        if (line) lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      let last = kept[maxLines - 1];
      while (ctx.measureText(`${last}…`).width > maxW && last.length) last = last.slice(0, -1);
      kept[maxLines - 1] = `${last.trim()}…`;
      return kept;
    }
    return lines;
  }

  function fit(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
    return `${t.trim()}…`;
  }

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function glow(ctx, x, y, r, color) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function smallCaps(ctx, text, x, y, color, size = 22) {
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px CrateSans`;
    ctx.letterSpacing = `${Math.round(size * 0.16)}px`;
    ctx.fillText(text.toUpperCase(), x, y);
    ctx.letterSpacing = '0px';
  }

  async function render({ song, stats, art, logo }) {
    await Promise.all([document.fonts.load('700 64px CrateSans'), document.fonts.load('500 40px CrateSans')]).catch(() => {});

    const W = 1080, H = 1920, X = 90;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');

    // Background: deep navy with soft purple and red glows
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    glow(ctx, W * 0.85, 120, 900, 'rgba(60,19,97,0.85)');
    glow(ctx, 80, 260, 600, 'rgba(187,24,46,0.18)');
    glow(ctx, W * 0.5, H + 200, 900, 'rgba(60,19,97,0.45)');

    // Header
    const logoImg = await loadImg(logo);
    if (logoImg) ctx.drawImage(logoImg, X, 92, 72, 72);
    ctx.fillStyle = C.text;
    ctx.font = '750 46px CrateSans';
    ctx.letterSpacing = '-1px';
    ctx.textBaseline = 'middle';
    ctx.fillText('Crate', X + 92, 130);
    ctx.letterSpacing = '0px';

    // Cover art: rounded, with a soft red glow
    const size = 740, ax = (W - size) / 2, ay = 230;
    ctx.save();
    ctx.shadowColor = 'rgba(187,24,46,0.45)';
    ctx.shadowBlur = 90;
    ctx.shadowOffsetY = 30;
    rrect(ctx, ax, ay, size, size, 36);
    ctx.fillStyle = C.purple;
    ctx.fill();
    ctx.restore();
    const artImg = await loadImg(art);
    if (artImg) {
      ctx.save();
      rrect(ctx, ax, ay, size, size, 36);
      ctx.clip();
      ctx.drawImage(artImg, ax, ay, size, size);
      ctx.restore();
    }

    // Title + artist
    let y = ay + size + 110;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.text;
    ctx.font = '750 70px CrateSans';
    ctx.letterSpacing = '-1px';
    for (const line of wrap(ctx, song.title, W - X * 2, 2)) {
      ctx.fillText(line, X, y);
      y += 82;
    }
    ctx.letterSpacing = '0px';
    ctx.fillStyle = C.mute;
    ctx.font = '500 44px CrateSans';
    ctx.fillText(fit(ctx, song.artist, W - X * 2), X, y);
    y += 64;

    // Stats
    if (stats && stats.status === 'ok') {
      const cells = [['BPM', String(stats.bpm)], ['Key', stats.key], ['Camelot', stats.camelot]].filter((c) => c[1]);
      const gap = 20, cw = (W - X * 2 - gap * (cells.length - 1)) / cells.length, ch = 150;
      cells.forEach(([label, value], i) => {
        const cx = X + i * (cw + gap);
        rrect(ctx, cx, y, cw, ch, 26);
        ctx.fillStyle = 'rgba(60,19,97,0.5)';
        ctx.fill();
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 2;
        ctx.stroke();
        smallCaps(ctx, label, cx + 28, y + 52, C.mute, 20);
        ctx.fillStyle = C.text;
        ctx.font = '750 48px CrateSans';
        ctx.fillText(fit(ctx, value, cw - 56), cx + 28, y + 114);
      });
      y += ch + 74;
    } else y += 30;

    // Lineage
    const g2 = song.groups;
    const sections = [['Samples', g2.samples], ['Interpolates', g2.interp_from]].filter(([, l]) => l.length);
    let budget = 5;
    for (const [label, list] of sections) {
      if (budget <= 0 || y > H - 260) break;
      smallCaps(ctx, label, X, y, C.red2, 22);
      y += 60;
      const take = list.slice(0, Math.min(budget, 3));
      for (const s of take) {
        ctx.fillStyle = C.text;
        ctx.font = '650 40px CrateSans';
        const t = fit(ctx, s.title, 560);
        ctx.fillText(t, X, y);
        const tw = ctx.measureText(t).width;
        ctx.fillStyle = C.mute;
        ctx.font = '400 36px CrateSans';
        ctx.fillText(fit(ctx, `  ${s.artist}`, W - X * 2 - tw), X + tw, y);
        y += 56;
      }
      if (list.length > take.length) {
        ctx.fillStyle = C.mute;
        ctx.font = '400 32px CrateSans';
        ctx.fillText(`+${list.length - take.length} more`, X, y);
        y += 50;
      }
      budget -= take.length;
      y += 28;
    }
    const sampledBy = g2.sampled_in.length + g2.interp_by.length;
    if (sampledBy && y < H - 200) {
      smallCaps(ctx, 'Its legacy', X, y, C.red2, 22);
      y += 60;
      ctx.fillStyle = C.text;
      ctx.font = '650 40px CrateSans';
      ctx.fillText(`Sampled or interpolated in ${sampledBy} song${sampledBy === 1 ? '' : 's'}`, X, y);
    }

    // Footer
    ctx.fillStyle = C.line;
    ctx.fillRect(X, H - 150, W - X * 2, 2);
    ctx.textAlign = 'center';
    smallCaps(ctx, 'Dig into any song  ·  Crate', W / 2, H - 86, C.mute, 20);

    return new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
  }

  root.CrateCard = { render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
