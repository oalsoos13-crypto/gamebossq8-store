/* 20-ui.js — shared UI behaviour:
     GB.dialog.open(id, trigger) / close(id) / isOpen(id) / current()  (native <dialog>.showModal)
     GB.toast(msg, { action: { label, href | onClick }, timeout })
     GB.announce(msg)                     (polite screen-reader announcement)
     GB.banner.show(html) / hide()       (the #gb-banner slot under the header)
     GB.ui.hydrate(root)                 (sync wishlist buttons + rail arrows + failed images inside root)
     GB.ui.card(item, opts)              (client mirror of the server productCard() for compact products.json items)
     GB.copy(text) → Promise<boolean>    (clipboard API, then the execCommand fallback)
     header / tab-bar count badges, [data-action="add-to-cart"], [data-action="wish-toggle"],
     [data-dialog-open], [data-dialog-close], [data-rail] arrows.
   Contract: src/CONTRACTS.md §7.3–7.5. */

/* ------------------------------------------------------------------ dialogs */
const returnFocus = {};
function dlg(id) { const d = document.getElementById(id); return d && d.tagName === 'DIALOG' ? d : null; }
function focusInto(d) {
  const target = d.querySelector('[data-autofocus]') || d.querySelector('.gb-dialog__title') || d.querySelector('h1,h2,h3');
  if (target) {
    if (!target.hasAttribute('tabindex') && !/^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(target.tagName)) target.setAttribute('tabindex', '-1');
    try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
  }
}
GB.dialog = {
  supported: typeof HTMLDialogElement === 'function' && typeof HTMLDialogElement.prototype.showModal === 'function',
  /** Open a dialog by id. trigger = element that gets focus back on close (default: the active element). */
  open(id, trigger) {
    const d = dlg(id);
    if (!d || !GB.dialog.supported) return false;
    if (d.open) { focusInto(d); return true; }
    GB.$$('dialog.gb-dialog[open]').forEach((o) => { if (o !== d) { returnFocus[o.id] = null; o.close(); } });
    returnFocus[id] = trigger || document.activeElement;
    d.showModal();
    focusInto(d);
    GB.emit('dialog:open', { id, dialog: d, trigger: returnFocus[id] || null });
    return true;
  },
  close(id) {
    const d = id ? dlg(id) : GB.dialog.current();
    if (d && d.open) d.close();
  },
  isOpen(id) { const d = dlg(id); return !!(d && d.open); },
  /** The open gb dialog element or null. */
  current() { return GB.$('dialog.gb-dialog[open]'); },
};
function wireDialog(d) {
  if (d.__gbWired) return;
  d.__gbWired = true;
  d.addEventListener('close', () => {
    const t = returnFocus[d.id];
    returnFocus[d.id] = null;
    if (t && t.isConnected && typeof t.focus === 'function') { try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); } }
    GB.emit('dialog:close', { id: d.id, dialog: d });
  });
  // backdrop click/tap: the click lands on the <dialog> itself outside its box
  d.addEventListener('click', (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) d.close();
  });
}
GB.ready(() => { GB.$$('dialog.gb-dialog').forEach(wireDialog); });
GB.listen('dialog:open', (e) => wireDialog(e.dialog));

GB.on('click', '[data-dialog-open]', (e, el) => {
  if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const id = el.getAttribute('data-dialog-open');
  const d = dlg(id);
  if (!d || !GB.dialog.supported) return; // links fall back to their href
  e.preventDefault();
  wireDialog(d);
  GB.dialog.open(id, el);
});
GB.on('click', '[data-dialog-close]', (e, el) => {
  const d = el.closest('dialog');
  if (d) { e.preventDefault(); d.close(); }
});

/* ------------------------------------------------------------------ live announcements + toast */
GB.announce = (msg) => {
  const live = document.getElementById('gb-live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = String(msg || ''); }, 60);
};

let toastTimer = null;
/**
 * GB.toast('أُضيف إلى السلة ✓', { action: { label: 'عرض السلة', onClick() {…} | href: '…' }, timeout: 4000 })
 * The toast region is role=status (announced politely). While a modal dialog is open the toast is moved
 * inside it (the top layer would hide it otherwise).
 */
GB.toast = (msg, opts) => {
  const el = document.getElementById('gb-toast');
  if (!el) return;
  const o = opts || {};
  const host = GB.dialog.current() || document.body;
  if (el.parentNode !== host) host.appendChild(el);
  el.innerHTML = '<span class="gb-toast__msg">' + GB.esc(msg) + '</span>';
  if (o.action && o.action.label) {
    const a = document.createElement(o.action.href ? 'a' : 'button');
    a.className = 'gb-toast__action';
    a.textContent = o.action.label;
    if (o.action.href) a.href = o.action.href; else a.type = 'button';
    a.addEventListener('click', (e) => {
      hide();
      if (typeof o.action.onClick === 'function') o.action.onClick(e);
    });
    el.appendChild(a);
  }
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, o.timeout || (o.action ? 5000 : 3000));
  function hide() { el.classList.remove('is-show'); }
};
GB.listen('dialog:close', () => {
  const el = document.getElementById('gb-toast');
  if (el && el.parentNode !== document.body) document.body.appendChild(el);
});

/* ------------------------------------------------------------------ banner slot (#gb-banner under the header) */
GB.banner = {
  /** Show trusted markup (escape data with GB.esc!) inside the banner. */
  show(html) {
    const b = document.getElementById('gb-banner');
    if (!b) return null;
    b.innerHTML = '<div class="gb-wrap gb-banner__in">' + html + '</div>';
    b.hidden = false;
    return b;
  },
  hide() { const b = document.getElementById('gb-banner'); if (b) { b.hidden = true; b.innerHTML = ''; } },
};

/* ------------------------------------------------------------------ count badges */
function setCount(kind, n) {
  GB.$$('[data-count="' + kind + '"]').forEach((b) => {
    b.textContent = n > 99 ? '99+' : String(n);
    b.hidden = n <= 0;
  });
  GB.$$('[data-count-label="' + kind + '"]').forEach((el) => {
    const key = kind === 'cart' ? 'a11y.cartCount' : 'a11y.wishCount';
    el.setAttribute('aria-label', GB.t(key, { n }));
  });
}
GB.ready(() => { setCount('cart', GB.cart.count()); setCount('wish', GB.wish.count()); });
GB.listen('cart:change', (d) => setCount('cart', d.count));
GB.listen('wish:change', (d) => setCount('wish', d.count));

/* ------------------------------------------------------------------ wishlist buttons */
function syncWish(root) {
  GB.$$('[data-action="wish-toggle"][data-id]', root).forEach((b) => {
    const on = GB.wish.has(b.getAttribute('data-id'));
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    const label = b.getAttribute(on ? 'data-label-remove' : 'data-label-add');
    if (label) b.setAttribute('aria-label', label);
  });
}
GB.listen('wish:change', () => syncWish(document));

GB.on('click', '[data-action="wish-toggle"]', (e, el) => {
  e.preventDefault();
  const id = el.getAttribute('data-id');
  if (!id) return;
  const on = GB.wish.toggle(id);
  GB.toast(GB.t(on ? 'common.wishAdded' : 'common.wishRemoved'));
  if (on) GB.track('add_to_wishlist', { id });
});

/* ------------------------------------------------------------------ add to cart */
// <button data-action="add-to-cart" data-id="10736" data-price="16500" [data-qty="2"] [data-qty-from="#qty"] [data-no-toast]>
GB.on('click', '[data-action="add-to-cart"]', (e, el) => {
  e.preventDefault();
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
  const id = el.getAttribute('data-id');
  if (!id) return;
  let qty = Number(el.getAttribute('data-qty')) || 1;
  const from = el.getAttribute('data-qty-from');
  if (from) { const inp = GB.$(from); if (inp) qty = Number(inp.value || inp.textContent) || 1; }
  const price = Number(el.getAttribute('data-price')) || 0;
  GB.cart.add(id, qty, price);
  GB.track('add_to_cart', { id, qty, value: price * qty });
  el.classList.add('is-added');
  clearTimeout(el.__gbAdded);
  el.__gbAdded = setTimeout(() => el.classList.remove('is-added'), 1600);
  GB.emit('cart:added', { id, qty, el });
  if (!el.hasAttribute('data-no-toast')) {
    GB.toast(GB.t('common.addedToCart'), {
      action: document.getElementById('gb-cart') ? { label: GB.t('common.viewCart'), onClick() { GB.dialog.open('gb-cart', el); } } : null,
    });
  }
});

/* ------------------------------------------------------------------ rails: prev/next arrows (desktop pointer) */
function railState(vp) {
  const track = vp.querySelector('.gb-rail__track');
  if (!track) return;
  const max = track.scrollWidth - track.clientWidth;
  const pos = Math.abs(track.scrollLeft); // RTL scrollLeft is ≤ 0 in modern browsers
  const prev = vp.querySelector('[data-rail="prev"]');
  const next = vp.querySelector('[data-rail="next"]');
  if (prev) prev.disabled = pos <= 2;
  if (next) next.disabled = pos >= max - 2;
}
function wireRails(root) {
  GB.$$('.gb-rail__viewport', root).forEach((vp) => {
    if (vp.__gbRail) return;
    vp.__gbRail = true;
    const track = vp.querySelector('.gb-rail__track');
    if (!track) return;
    let raf = 0;
    track.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => railState(vp)); }, { passive: true });
    railState(vp);
  });
}
GB.on('click', '[data-rail]', (e, el) => {
  const vp = el.closest('.gb-rail__viewport');
  const track = vp && vp.querySelector('.gb-rail__track');
  if (!track) return;
  const forward = el.getAttribute('data-rail') === 'next';
  const sign = (GB.dir === 'rtl' ? -1 : 1) * (forward ? 1 : -1);
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  track.scrollBy({ left: sign * track.clientWidth * 0.9, behavior: reduce ? 'auto' : 'smooth' });
});
window.addEventListener('resize', () => GB.$$('.gb-rail__viewport').forEach(railState), { passive: true });

/* ------------------------------------------------------------------ hydrate (call after injecting client-rendered markup) */
GB.ui = GB.ui || {};
GB.ui.hydrate = (root) => {
  const r = root || document;
  syncWish(r);
  wireRails(r);
  GB.checkImages(r);
};
GB.ready(() => GB.ui.hydrate(document));

/* ------------------------------------------------------------------ client product card (mirror of productCard() in src/core/components.mjs) */
/** <bdi> name; Latin-only names get lang="en" dir="ltr". inner = trusted markup (e.g. a search highlight). */
GB.ui.nameHtml = function (item, inner) {
  const n = GB.pname(item);
  const body = inner || GB.esc(n);
  return /[\u0600-\u06FF]/.test(n) ? '<bdi>' + body + '</bdi>' : '<bdi lang="en" dir="ltr">' + body + '</bdi>';
};
/** Category illustration (<svg><use href="#art-…">) for a category id. */
GB.ui.art = function (cat, cls) {
  const k = GB.esc((GB.cfg.catIcons && GB.cfg.catIcons[cat]) || 'bundle');
  return '<svg class="art art--' + k + (cls ? ' ' + GB.esc(cls) : '') + '" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><use href="#art-' + k + '"/></svg>';
};
/** 1:1 media box with the category placeholder under the (lazy) image. */
GB.ui.media = function (item, cls) {
  const src = item.img ? GB.img(item.img) : '';
  return '<div class="gb-media' + (src ? '' : ' is-empty') + (cls ? ' ' + GB.esc(cls) : '') + '">' + GB.ui.art(item.cat, 'gb-media__ph') +
    (src ? '<img class="gb-media__img" src="' + GB.esc(src) + '" alt="" width="800" height="800" loading="lazy" decoding="async">' : '') + '</div>';
};
GB.ui.price = function (item, size) {
  const pct = GB.discountPct(item.p, item.c);
  return '<div class="gb-price gb-price--' + (size || 'sm') + (pct ? ' is-sale' : '') + '"><span class="gb-price__now">' + GB.moneyHtml(item.p) + '</span>' +
    (pct ? '<s class="gb-price__was"><span class="gb-sr">' + GB.esc(GB.t('price.was')) + ' </span>' + GB.moneyHtml(item.c) + '</s>' +
      '<span class="gb-price__off"><span aria-hidden="true">' + GB.esc(GB.t('price.off', { pct })) + '</span><span class="gb-sr">' + GB.esc(GB.t('price.offLabel', { pct })) + '</span></span>' : '') +
    '</div>';
};
GB.ui.stock = function (availability, cls) {
  if (!availability || availability === 'in_stock') return '';
  return '<span class="gb-stock gb-stock--' + GB.esc(availability) + (cls ? ' ' + GB.esc(cls) : '') + '">' + GB.esc(GB.t('stock.' + availability)) + '</span>';
};
/**
 * GB.ui.card(item, { level = 3, idSuffix, nameHtml (trusted inner markup), cls }) → '<article class="gb-card" …>'
 * item = compact products.json entry. Same classes and data-* attributes as the server productCard(), so
 * hydration, listings (sort/filter) and the add/wish handlers work alike. Call GB.ui.hydrate(root) after inserting.
 */
GB.ui.card = function (item, opts) {
  const o = opts || {};
  const esc = GB.esc;
  const name = GB.pname(item);
  const pct = GB.discountPct(item.p, item.c);
  const oos = item.a === 'out_of_stock';
  const isNew = !!item.nw;
  const level = Math.min(Math.max(Number(o.level) || 3, 2), 6);
  const titleId = 'pn-' + esc(item.id) + (o.idSuffix ? '-' + esc(o.idSuffix) : '');
  const flags = [];
  if (pct) flags.push('<span class="gb-flag gb-flag--sale">' + esc(GB.t('price.off', { pct })) + '</span>');
  if (isNew && !oos) flags.push('<span class="gb-flag gb-flag--new">' + esc(GB.t('stock.new')) + '</span>');
  const wishAdd = GB.t('a11y.wishAdd', { name });
  const wish = '<button type="button" class="gb-wish gb-card__wish" data-action="wish-toggle" data-id="' + esc(item.id) + '" aria-pressed="false" data-label-add="' +
    esc(wishAdd) + '" data-label-remove="' + esc(GB.t('a11y.wishRemove', { name })) + '" aria-label="' + esc(wishAdd) + '">' +
    GB.icon('heart', 'gb-wish__off') + GB.icon('heart-fill', 'gb-wish__on') + '</button>';
  const action = oos
    ? '<a class="gb-btn gb-btn--notify gb-card__add" href="' + esc(GB.wa(GB.t('common.notifyMsg', { name, id: item.id, url: GB.abs(item.s) }))) +
      '" target="_blank" rel="noopener" aria-label="' + esc(GB.t('a11y.notify', { name }) + ' ' + GB.t('a11y.newTab')) + '">' + GB.icon('bell') +
      '<span>' + esc(GB.t('common.notifyMeShort')) + '</span></a>'
    : '<button type="button" class="gb-btn gb-btn--add gb-card__add" data-action="add-to-cart" data-id="' + esc(item.id) + '" data-price="' + esc(item.p) +
      '" aria-label="' + esc(GB.t('a11y.addToCart', { name })) + '">' + GB.icon('cart-plus') + '<span>' + esc(GB.t('common.addToCart')) + '</span></button>';
  return '<article class="gb-card' + (oos ? ' is-oos' : '') + (pct ? ' is-sale' : '') + (o.cls ? ' ' + esc(o.cls) : '') + '" data-id="' + esc(item.id) +
    '" data-cat="' + esc(item.cat) + '" data-brand="' + esc(item.b || '') + '" data-price="' + esc(item.p) + '" data-compare="' + esc(item.c || '') +
    '" data-off="' + pct + '" data-avail="' + esc(item.a) + '" data-new="' + (isNew ? 1 : 0) + '" data-featured="' + (item.f ? 1 : 0) + '">' +
    GB.ui.media(item, 'gb-card__media') +
    (flags.length ? '<div class="gb-card__flags">' + flags.join('') + '</div>' : '') + wish +
    '<div class="gb-card__body">' + (item.b ? '<p class="gb-card__brand" dir="ltr">' + esc(item.b) + '</p>' : '') +
    '<h' + level + ' class="gb-card__title" id="' + titleId + '"><a class="gb-card__link" href="' + esc(GB.purl(item)) + '">' + GB.ui.nameHtml(item, o.nameHtml) +
    '</a></h' + level + '>' + GB.ui.price(item) + GB.ui.stock(item.a, 'gb-card__stock') + '</div>' +
    '<div class="gb-card__actions">' + action + '</div></article>';
};

/* ------------------------------------------------------------------ copy to clipboard */
/** GB.copy(text) → Promise<boolean>: async clipboard API (secure contexts), else a hidden-textarea execCommand. */
GB.copy = function (text) {
  const value = String(text == null ? '' : text);
  function legacy() {
    let ok = false;
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText = 'position:fixed;inset-block-start:0;inset-inline-start:0;width:1px;height:1px;opacity:0;';
    (GB.dialog.current() || document.body).appendChild(ta);
    const active = document.activeElement;
    try { ta.select(); ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    if (active && typeof active.focus === 'function') { try { active.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    return ok;
  }
  try {
    if (navigator.clipboard && window.isSecureContext && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(value).then(() => true, () => legacy());
    }
  } catch (e) { /* fall through */ }
  return Promise.resolve(legacy());
};

/* storage disabled → tell the customer once per page view when they first add something */
GB.listen('cart:change', (d) => {
  if (!GB.storage.ok && d.reason === 'add' && !GB.__storageWarned) {
    GB.__storageWarned = true;
    setTimeout(() => GB.toast(GB.t('common.storageOff'), { timeout: 6000 }), 3200);
  }
});
