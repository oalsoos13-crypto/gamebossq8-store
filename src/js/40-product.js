/* 40-product.js — product page behaviour (body.page-product; server markup from src/pages/product.mjs):
     gallery      scroll-snap slides, prev/next, thumbnails, arrow/Home/End keys, swipe (native), counter "n / N"
     qty stepper  #pdp-qty (1..99; Arabic-Indic / Persian digits normalised) — read by add-to-cart via data-qty-from
     buy now      [data-action="product-buy-now"] → make sure the cart holds the chosen qty, then go to checkout
     share        [data-action="product-share"] → navigator.share, else copy link (+ toast)
     sticky bar   [data-pdp-bar] shown (mobile) once #pdp-cta has scrolled out under the header
     recent       records the view in GB.recent and renders the "recently viewed" rail from products.json
     analytics    view_item on load, wa_inquiry on [data-track="wa_inquiry"] (add_to_cart is tracked by 20-ui.js)
   Contract: src/CONTRACTS.md §7. Strings come from #gb-page (pageData.i18n) or the client i18n subset. */

const PDP_QTY_MAX = 99;
const PDP_RECENT_MAX = 8;

/** '٣' / '۳' → '3', strip everything else; returns '' when no digits. */
function pdpDigits(v) {
  return String(v == null ? '' : v)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\D+/g, '');
}
function pdpClampQty(v) {
  const n = parseInt(pdpDigits(v), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(PDP_QTY_MAX, n);
}
function pdpReduceMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function pdpSetDisabled(btn, off) {
  if (!btn) return;
  if (off) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled');
}

/* ------------------------------------------------------------------ gallery */
function pdpGallery() {
  const g = GB.$('[data-gallery]');
  if (!g) return;
  const track = GB.$('[data-gallery-track]', g);
  const slides = GB.$$('.gb-gallery__slide', track);
  const total = slides.length;
  if (!track || total < 2) return;
  const countEl = GB.$('[data-gallery-count]', g);
  const prev = GB.$('[data-gallery-go="prev"]', g);
  const next = GB.$('[data-gallery-go="next"]', g);
  const thumbs = GB.$$('[data-gallery-thumb]', g);
  const thumbList = GB.$('.gb-gallery__thumbs', g);
  let cur = 0;
  let target = -1;
  let targetTimer = 0;

  function nearest() {
    const tr = track.getBoundingClientRect();
    const mid = tr.left + tr.width / 2;
    let best = 0, dist = Infinity;
    slides.forEach((s, i) => {
      const r = s.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < dist) { dist = d; best = i; }
    });
    return best;
  }
  function revealThumb(t) {
    if (!t || !thumbList) return;
    const lr = thumbList.getBoundingClientRect();
    const r = t.getBoundingClientRect();
    let dx = 0;
    if (r.left < lr.left) dx = r.left - lr.left - 8;
    else if (r.right > lr.right) dx = r.right - lr.right + 8;
    if (dx) thumbList.scrollBy({ left: dx, behavior: pdpReduceMotion() ? 'auto' : 'smooth' });
  }
  function update(i) {
    cur = i;
    if (countEl) countEl.textContent = String(i + 1);
    pdpSetDisabled(prev, i <= 0);
    pdpSetDisabled(next, i >= total - 1);
    thumbs.forEach((t, k) => {
      if (k === i) { t.setAttribute('aria-current', 'true'); revealThumb(t); } else t.removeAttribute('aria-current');
    });
  }
  function go(i) {
    i = Math.max(0, Math.min(total - 1, i));
    const tr = track.getBoundingClientRect();
    const r = slides[i].getBoundingClientRect();
    target = i;
    clearTimeout(targetTimer);
    targetTimer = setTimeout(() => { target = -1; update(nearest()); }, 700);
    // visual delta works in both directions (RTL scrollLeft is negative in modern engines)
    track.scrollBy({ left: r.left - tr.left, behavior: pdpReduceMotion() ? 'auto' : 'smooth' });
    update(i);
  }

  let raf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const n = nearest();
      if (target >= 0) { if (n !== target) return; target = -1; clearTimeout(targetTimer); }
      if (n !== cur) update(n);
    });
  }, { passive: true });

  g.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-gallery-go],[data-gallery-thumb]') : null;
    if (!t || !g.contains(t)) return;
    e.preventDefault();
    if (t.getAttribute('aria-disabled') === 'true') return;
    if (t.hasAttribute('data-gallery-thumb')) go(Number(t.getAttribute('data-gallery-thumb')) || 0);
    else go(cur + (t.getAttribute('data-gallery-go') === 'next' ? 1 : -1));
  });

  track.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const rtl = (document.documentElement.dir || GB.dir) === 'rtl';
    let i = null;
    if (e.key === 'ArrowRight') i = cur + (rtl ? -1 : 1);
    else if (e.key === 'ArrowLeft') i = cur + (rtl ? 1 : -1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = total - 1;
    if (i === null) return;
    e.preventDefault();
    go(i);
  });

  window.addEventListener('resize', () => { target = -1; update(nearest()); }, { passive: true });
  update(0);
}

/* ------------------------------------------------------------------ qty stepper */
function pdpQty() {
  const inp = GB.$('#pdp-qty');
  if (!inp) return null;
  const box = inp.closest('[data-stepper]');
  const dec = box && GB.$('[data-step="-1"]', box);
  const inc = box && GB.$('[data-step="1"]', box);
  function set(n) {
    const q = pdpClampQty(n);
    inp.value = String(q);
    pdpSetDisabled(dec, q <= 1);
    pdpSetDisabled(inc, q >= PDP_QTY_MAX);
    return q;
  }
  if (box) {
    box.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-step]') : null;
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      e.preventDefault();
      const q = set(pdpClampQty(inp.value) + Number(b.getAttribute('data-step')));
      GB.announce(GB.t('common.qty') + ': ' + q);
    });
  }
  inp.addEventListener('input', () => {
    const d = pdpDigits(inp.value).slice(0, 2);
    if (d !== inp.value) inp.value = d;
    if (d) { const q = pdpClampQty(d); pdpSetDisabled(dec, q <= 1); pdpSetDisabled(inc, q >= PDP_QTY_MAX); }
  });
  inp.addEventListener('change', () => set(inp.value));
  inp.addEventListener('blur', () => set(inp.value));
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); set(pdpClampQty(inp.value) + 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); set(pdpClampQty(inp.value) - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); set(inp.value); }
  });
  set(inp.value);
  return { get: () => set(inp.value) };
}

/* ------------------------------------------------------------------ share / copy link */
function pdpCopy(url, L) {
  GB.copy(url).then((ok) => {
    if (ok) GB.toast(L.linkCopied || url);
    else GB.toast(L.copyFailed || url, { timeout: 5000 });
  });
}

/* ------------------------------------------------------------------ client card (shared foundation renderer) */
function pdpCard(p, suffix) {
  return '<li class="gb-rail__item">' + GB.ui.card(p, { idSuffix: suffix }) + '</li>';
}

function pdpRecent(prod, page) {
  const before = GB.recent.list().filter((id) => id !== String(prod.id)).slice(0, PDP_RECENT_MAX);
  if (prod.id) GB.recent.push(prod.id);
  const section = GB.$('#pdp-recent');
  const track = section && GB.$('[data-recent-track]', section);
  if (!track || !before.length) return;
  GB.products().then((map) => {
    const items = before.map((id) => map.get(id)).filter(Boolean);
    if (!items.length) return;
    track.innerHTML = items.map((p) => pdpCard(p, 'pdp-recent')).join('');
    section.hidden = false;
    GB.ui.hydrate(section);
    track.dispatchEvent(new Event('scroll')); // refresh the rail arrows now that the track has content
  }).catch(() => { /* secondary feature: stay hidden when products.json is unavailable */ });
}

/* ------------------------------------------------------------------ sticky mobile CTA bar */
function pdpBar() {
  const bar = GB.$('[data-pdp-bar]');
  const cta = GB.$('#pdp-cta');
  if (!bar || !cta) return;
  const header = GB.$('.gb-header');
  let shown = false;
  let raf = 0;
  function set(show) {
    if (show === shown) return;
    shown = show;
    bar.classList.toggle('is-show', show);
    document.body.classList.toggle('pdp-bar-on', show);
  }
  // A scroll listener (not IntersectionObserver): a fast fling or scrollTo() can jump the CTA from below the
  // viewport to above it without an intersection change, which IO would never report.
  function check() {
    raf = 0;
    const top = header ? header.getBoundingClientRect().bottom : 0;
    // shown only once the whole CTA box has scrolled out ABOVE the viewport (under the sticky header)
    set(cta.getBoundingClientRect().bottom < top);
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(check); }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  check();
}

/* ------------------------------------------------------------------ boot */
GB.ready(() => {
  if (!document.body.classList.contains('page-product')) return;
  const page = GB.page() || {};
  const prod = page.product || {};
  const L = page.i18n || {};

  pdpGallery();
  const qty = pdpQty();
  pdpBar();
  pdpRecent(prod, page);
  if (prod.id) GB.track('view_item', { id: prod.id, value: prod.priceFils });

  GB.on('click', '[data-action="product-buy-now"]', (e, el) => {
    e.preventDefault();
    if (el.getAttribute('aria-disabled') === 'true' || el.disabled) return;
    const id = el.getAttribute('data-id');
    const price = Number(el.getAttribute('data-price')) || 0;
    const q = qty ? qty.get() : 1;
    // "Buy now" = make sure the cart holds (at least) the chosen quantity, then continue to checkout.
    if (!GB.cart.has(id)) {
      GB.cart.add(id, q, price);
      GB.track('add_to_cart', { id, qty: q, value: price * q });
    } else if (GB.cart.qty(id) < q) {
      GB.cart.set(id, q);
    }
    const target = page.checkoutUrl || GB.url('checkout/');
    // storage disabled → the in-memory cart dies with this page: hand the line over in the URL (?buy=<id>:<qty>)
    location.href = GB.storage.ok ? target : target + '?buy=' + encodeURIComponent(id + ':' + (GB.cart.qty(id) || q));
  });

  GB.on('click', '[data-action="product-share"]', (e) => {
    e.preventDefault();
    const canon = GB.$('link[rel="canonical"]');
    const url = (canon && canon.href) || prod.url || location.href;
    const data = { title: prod.name || document.title, text: L.shareText || prod.name || '', url };
    let canShare = typeof navigator.share === 'function';
    try { if (canShare && typeof navigator.canShare === 'function') canShare = navigator.canShare(data); } catch (err) { canShare = false; }
    if (canShare) {
      navigator.share(data).catch((err) => { if (!err || err.name !== 'AbortError') pdpCopy(url, L); });
      return;
    }
    pdpCopy(url, L);
  });

  GB.on('click', '[data-track="wa_inquiry"]', (e, el) => {
    GB.track('wa_inquiry', { id: prod.id, kind: el.getAttribute('data-kind') || 'ask' });
  });
});
