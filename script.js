(function () {
  const screens = {
    start: document.querySelector('[data-screen="start"]'),
    loading: document.querySelector('[data-screen="loading"]'),
    closed: document.querySelector('[data-screen="closed"]'),
    opened: document.querySelector('[data-screen="opened"]'),
  };

  function show(name) {
    Object.entries(screens).forEach(([k, el]) => {
      if (k === name) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    });
  }

  document.getElementById('start-btn').addEventListener('click', () => {
    show('loading');
    runLoading();
  });

  function runLoading() {
    const target = 'loading...';
    const el = document.getElementById('loading-text');
    el.innerHTML = '';
    let i = 0;
    const tick = () => {
      if (i >= target.length) {
        setTimeout(() => {
          show('closed');
        }, 500);
        return;
      }
      const stable = target.slice(0, i);
      const next = target[i];
      el.innerHTML =
        escapeHtml(stable) + '<span class="new">' + escapeHtml(next) + '</span>';
      i += 1;
      setTimeout(tick, 160);
    };
    tick();
  }

  document.getElementById('envelope-btn').addEventListener('click', () => {
    show('opened');
    pickWill();
  });

  let lastWill = null;
  function pickWill() {
    const wills = window.WILLS || [];
    if (wills.length === 0) return;
    let next;
    let guard = 0;
    do {
      next = wills[Math.floor(Math.random() * wills.length)];
      guard += 1;
    } while (next === lastWill && wills.length > 1 && guard < 10);
    lastWill = next;
    const span = document.getElementById('will-text');
    span.textContent = next;
    requestAnimationFrame(() => fitWill(span));
    // Re-fit once the pixel font has actually loaded (it's wider than the
    // system fallback, so a pre-load fit can underestimate the real width).
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => fitWill(span));
    }
  }

  function fitWill(span) {
    const parent = span.parentElement;
    const available = parent.clientWidth - 24;
    if (available <= 0) return;
    let size = 22;
    span.style.fontSize = size + 'px';
    while (span.scrollWidth > available && size > 9) {
      size -= 1;
      span.style.fontSize = size + 'px';
    }
  }

  document.getElementById('regen-btn').addEventListener('click', () => {
    const row = document.querySelector('.row--text');
    row.classList.remove('flip');
    void row.offsetWidth;
    row.classList.add('flip');
    setTimeout(() => {
      pickWill();
    }, 180);
  });

  document.getElementById('share-btn').addEventListener('click', async () => {
    const text = `My free will: ${lastWill}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'free will generator', text });
        return;
      } catch (_) {
        /* user cancelled, fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('copied to clipboard');
    } catch (_) {
      toast(text);
    }
  });

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }
})();
