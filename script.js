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

  // ----- start -----
  document.getElementById('start-btn').addEventListener('click', () => {
    show('loading');
    runLoading();
  });

  // ----- loading typewriter ("loading..." letter by letter, last char tinted) -----
  function runLoading() {
    const target = 'loading...';
    const el = document.getElementById('loading-text');
    el.innerHTML = '';
    let i = 0;
    const tick = () => {
      if (i >= target.length) {
        // brief pause then advance
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

  // ----- closed -> opened -----
  document.getElementById('envelope-btn').addEventListener('click', () => {
    pickWill();
    show('opened');
  });

  // ----- regenerate -----
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
    fitWill(span);
  }

  // Shrink the will text so any prompt fits on one notebook line.
  function fitWill(span) {
    const parent = span.parentElement;
    const maxWidth = parent.clientWidth - 12;
    let size = 22;
    span.style.fontSize = size + 'px';
    while (span.scrollWidth > maxWidth && size > 11) {
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

  // ----- share -----
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
