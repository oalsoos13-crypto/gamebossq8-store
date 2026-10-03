/*! GameBoss Q8 · 40e2a908 */
(function () {
'use strict';
const GB = window.GB = window.GB || {};
/* ---- 00-core.js ---- */
try {
/* 00-core.js — the GB namespace: config, DOM helpers, delegation, event bus, safe storage, money,
   i18n, URLs, product data, analytics, attribution, image-failure handling, boot sequence.
   Every file in src/js/ is concatenated (filename order) into ONE IIFE; files talk only through GB.
   Contract: src/CONTRACTS.md §7. */

// `GB` (=== window.GB) is declared by the bundle header in tools/build.mjs.

/* ------------------------------------------------------------------ config + i18n (inline JSON) */
function readJsonScript(id, fallback) {
  var el = document.getElementById(id);
  if (!el) return fallback;
  try { return JSON.parse(el.textContent || 'null') || fallback; } catch (e) { return fallback; }
}
GB.cfg = readJsonScript('gb-config', {});
GB.i18n = readJsonScript('gb-i18n', {});
GB.locale = GB.cfg.locale || document.documentElement.lang || 'ar';
GB.dir = GB.cfg.dir || document.documentElement.dir || 'rtl';
/** Per-page JSON from layout({ pageData }) → <script type="application/json" id="gb-page">. */
GB.page = function () { return readJsonScript('gb-page', null); };

/* ------------------------------------------------------------------ DOM helpers */
GB.$ = function (sel, root) { return (root || document).querySelector(sel); };
GB.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

/** Escape text for HTML (text nodes and quoted attributes). Use for EVERY data value put into innerHTML. */
GB.esc = function (v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  return String(v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};

/** Inline sprite icon markup (same as the server icon()). Directional icons mirror in RTL via CSS. */
const DIRECTIONAL = { 'chevron-forward': 1, 'chevron-back': 1, 'arrow-forward': 1, 'arrow-back': 1 };
GB.icon = function (name, cls) {
  return '<svg class="i i--' + GB.esc(name) + (DIRECTIONAL[name] ? ' i--flip-rtl' : '') + (cls ? ' ' + GB.esc(cls) : '') +
    '" aria-hidden="true" focusable="false"><use href="#i-' + GB.esc(name) + '"/></svg>';
};

/**
 * Delegated events: GB.on('click', '[data-action="x"]', function (e, el) { … }).
 * `el` is the closest ancestor (or target) matching selector; `this` === el. Returns an unsubscribe fn.
 */
GB.on = function (type, selector, handler, root) {
  var host = root || document;
  function fn(e) {
    var t = e.target;
    if (!t || !t.closest) t = t && t.parentElement;
    var el = t && t.closest ? t.closest(selector) : null;
    if (el && (host === document || host.contains(el))) handler.call(el, e, el);
  }
  host.addEventListener(type, fn, type === 'focus' || type === 'blur');
  return function () { host.removeEventListener(type, fn, type === 'focus' || type === 'blur'); };
};

/* ------------------------------------------------------------------ event bus */
const bus = {};
/** GB.listen('cart:change', fn) → unsubscribe. fn(detail). */
GB.listen = function (name, fn) {
  (bus[name] = bus[name] || []).push(fn);
  return function () { bus[name] = (bus[name] || []).filter(function (f) { return f !== fn; }); };
};
/** GB.emit('cart:change', detail). Also dispatches a DOM CustomEvent 'gb:<name>' on document. */
GB.emit = function (name, detail) {
  (bus[name] || []).slice().forEach(function (fn) {
    try { fn(detail); } catch (err) { if (window.console) console.error('[GB] listener for "' + name + '" failed', err); }
  });
  try { document.dispatchEvent(new CustomEvent('gb:' + name, { detail: detail })); } catch (e) { /* old browser */ }
};

/* ------------------------------------------------------------------ boot: GB.ready(fn) runs after ALL modules loaded */
let readyQueue = [], started = false;
GB.ready = function (fn) {
  if (started) { try { fn(); } catch (e) { console.error(e); } } else readyQueue.push(fn);
};
/** Called once by the bundle footer (tools/build.mjs). */
GB.start = function () {
  if (started) return;
  started = true;
  readyQueue.forEach(function (fn) { try { fn(); } catch (e) { if (window.console) console.error('[GB] ready callback failed', e); } });
  readyQueue = [];
  GB.emit('ready', {});
};

/* ------------------------------------------------------------------ storage (never throws; works with storage disabled) */
const PREFIX = GB.cfg.storagePrefix || 'gbq8:v2:';
const memory = {};
let ls = null;
try { ls = window.localStorage; const probe = PREFIX + '__probe'; ls.setItem(probe, '1'); ls.removeItem(probe); } catch (e) { ls = null; }
GB.storage = {
  ok: !!ls,
  prefix: PREFIX,
  /** get('cart', {}) → parsed JSON of 'gbq8:v2:cart' or fallback. */
  get: function (key, fallback) {
    var raw = null;
    try { raw = ls ? ls.getItem(PREFIX + key) : (Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null); } catch (e) { raw = null; }
    if (raw === null || raw === undefined) return fallback;
    try { var v = JSON.parse(raw); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
  },
  /** set('cart', value) → true when persisted (false = memory only for this page view). */
  set: function (key, value) {
    var raw = JSON.stringify(value);
    memory[key] = raw;
    if (!ls) return false;
    try { ls.setItem(PREFIX + key, raw); return true; } catch (e) { return false; }
  },
  remove: function (key) {
    delete memory[key];
    try { if (ls) ls.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
  },
  /** Un-prefixed access (legacy v1 keys only). */
  getRaw: function (fullKey) { try { return ls ? ls.getItem(fullKey) : null; } catch (e) { return null; } },
  removeRaw: function (fullKey) { try { if (ls) ls.removeItem(fullKey); } catch (e) { /* ignore */ } },
};

/* ------------------------------------------------------------------ money (integer fils; mirrors src/core/money.mjs) */
const CURRENCY = { ar: 'د.ك', en: 'KWD' };
/** 16500 → '16.500' (Latin digits, 3 decimals). */
GB.amount = function (fils) {
  var f = Math.round(Number(fils) || 0), neg = f < 0, a = Math.abs(f);
  var kd = String(Math.floor(a / 1000)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + kd + '.' + String(a % 1000).padStart(3, '0');
};
/** 16500 → '16.500 د.ك' (ar) / '16.500 KWD' (en). Plain text (WhatsApp message, aria-labels). */
GB.money = function (fils, locale) { return GB.amount(fils) + ' ' + (CURRENCY[locale || GB.locale] || CURRENCY.ar); };
/** Same markup as the server moneyHtml(): <span class="money"><bdi class="money__n" dir="ltr">…</bdi> <span class="money__c">…</span></span> */
GB.moneyHtml = function (fils, locale) {
  return '<span class="money"><bdi class="money__n" dir="ltr">' + GB.amount(fils) + '</bdi> <span class="money__c">' +
    GB.esc(CURRENCY[locale || GB.locale] || CURRENCY.ar) + '</span></span>';
};
/** Whole-percent discount or 0. */
GB.discountPct = function (priceFils, compareAtFils) {
  return compareAtFils && compareAtFils > priceFils ? Math.round(((compareAtFils - priceFils) / compareAtFils) * 100) : 0;
};

/* ------------------------------------------------------------------ i18n (client subset embedded per page) */
let plural = null;
try { plural = new Intl.PluralRules(GB.locale); } catch (e) { plural = null; }
/** GB.t('common.viewAllN', { n: 5 }). Unknown key → the key itself (and a console warning). */
GB.t = function (key, params) {
  var v = GB.i18n[key];
  if (v === undefined || v === null) {
    if (window.console) console.warn('[GB] missing client i18n key "' + key + '" (mark it "client": true or add its namespace to config.clientI18n)');
    return key;
  }
  if (typeof v === 'object') {
    var n = Number(params && (params.n !== undefined ? params.n : params.count));
    if (!isFinite(n)) n = 0;
    var form = v['=' + n] !== undefined ? v['=' + n] : (plural ? v[plural.select(n)] : undefined);
    v = form !== undefined ? form : v.other;
  }
  return String(v).replace(/\{(\w+)\}/g, function (m, k) {
    return params && params[k] !== undefined && params[k] !== null ? String(params[k]) : m;
  });
};
GB.t.has = function (key) { return Object.prototype.hasOwnProperty.call(GB.i18n, key); };

/* ------------------------------------------------------------------ URLs (mirror src/core/url.mjs) */
const BASE = GB.cfg.base || '/';
const DEFAULT_LOCALE = GB.cfg.defaultLocale || 'ar';
/** GB.url('p/piva-ds5-adapter-10736/') → '/gamebossq8-store/(en/)p/…'. locale defaults to the page locale. */
GB.url = function (route, locale) {
  var r = String(route || '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(r) || r.indexOf('//') === 0) return r;
  r = r.replace(/^\/+/, '');
  var loc = locale || GB.locale;
  if (r === '404.html') return BASE + r;
  return BASE + (loc !== DEFAULT_LOCALE ? loc + '/' : '') + r;
};
/** Absolute URL on the canonical origin (= server abs(); used in shared / WhatsApp links). */
GB.abs = function (route, locale) {
  const o = GB.cfg.origin ? String(GB.cfg.origin).replace(/\/+$/, '') : location.origin;
  return o + GB.url(route, locale);
};
/** Asset path (never locale-prefixed). */
GB.asset = function (p) { return BASE + String(p || '').replace(/^\/+/, ''); };
/** Image src: absolute URLs pass through; site-relative mirrored paths get BASE. */
GB.img = function (src) { return !src ? '' : (/^https?:\/\//i.test(src) ? src : GB.asset(src)); };
/** wa.me link with optional prefilled text. */
GB.wa = function (text) {
  var n = GB.cfg.whatsapp || '';
  return 'https://wa.me/' + n + (text ? '?text=' + encodeURIComponent(text) : '');
};

/* ------------------------------------------------------------------ products.json (compact) */
// item: { id, s (route, no locale), n:{ar,en}, p (priceFils), c (compareAtFils|null), cat, img (url|null), a (availability), b (brand|null) }
let productsPromise = null;
/** GB.products() → Promise<Map<id, item>> (fetched once per page; rejects on network failure — callers must catch). */
GB.products = function () {
  if (!productsPromise) {
    var url = GB.cfg.productsUrl || (GB.$('meta[name="gb:products"]') || {}).content;
    productsPromise = fetch(url, { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('products.json HTTP ' + r.status); return r.json(); })
      .then(function (list) {
        var map = new Map();
        list.forEach(function (p) { map.set(String(p.id), p); });
        GB.productsMap = map;
        return map;
      });
    productsPromise.catch(function () { productsPromise = null; }); // allow a retry later
  }
  return productsPromise;
};
/** Display name of a compact product in the page locale. */
GB.pname = function (p) { return (p && p.n && (p.n[GB.locale] || p.n.ar)) || ''; };
/** Page URL of a compact product. */
GB.purl = function (p, locale) { return GB.url(p.s, locale); };

/* ------------------------------------------------------------------ attribution (first touch, 30 days) */
const SRC_TTL = 30 * 24 * 3600 * 1000;
(function captureSrc() {
  var v = null;
  try {
    var q = new URLSearchParams(location.search);
    v = q.get('src') || q.get('utm_source');
  } catch (e) { v = null; }
  if (!v) return;
  v = String(v).replace(/[^\w.\-]/g, '').slice(0, 32);
  if (!v) return;
  var cur = GB.storage.get('src', null);
  if (cur && cur.v && Date.now() - (cur.at || 0) < SRC_TTL) return; // keep first touch
  GB.storage.set('src', { v: v, at: Date.now() });
})();
/** First-touch source ('ig', 'tt', 'pwa' …) or null. */
GB.src = function () {
  var cur = GB.storage.get('src', null);
  return cur && cur.v && Date.now() - (cur.at || 0) < SRC_TTL ? cur.v : null;
};

/* ------------------------------------------------------------------ analytics: no-op unless GoatCounter is configured */
/** GB.track('add_to_cart', { id: '10736', value: 16500 }). Events: see CONTRACTS.md §7.6. */
GB.track = function (event, props) {
  var a = GB.cfg.analytics || {};
  if (a.provider !== 'goatcounter' || !a.code) return;
  try {
    var gc = window.goatcounter;
    if (!gc || typeof gc.count !== 'function') return;
    var title = event;
    if (props) title += ' ' + Object.keys(props).map(function (k) { return k + '=' + props[k]; }).join(' ');
    gc.count({ path: event, title: title.slice(0, 200), event: true });
  } catch (e) { /* never break the page for analytics */ }
};
GB.ready(function () {
  var a = GB.cfg.analytics || {};
  if (a.provider !== 'goatcounter' || !a.code) return;
  var tries = 0;
  (function pageview() {
    if (window.goatcounter && typeof window.goatcounter.count === 'function') {
      try { window.goatcounter.count({ path: location.pathname + (GB.src() ? '?src=' + GB.src() : '') }); } catch (e) { /* ignore */ }
    } else if (tries++ < 20) setTimeout(pageview, 250);
  })();
});

/* ------------------------------------------------------------------ images: failure → .img-failed (+ .is-failed on .gb-media) */
function markFailed(img) {
  if (!img || img.classList.contains('img-failed')) return;
  img.classList.add('img-failed');
  var box = img.closest && img.closest('.gb-media');
  if (box) box.classList.add('is-failed');
  GB.emit('img:failed', { img: img });
}
document.addEventListener('error', function (e) {
  var t = e.target;
  if (t && t.tagName === 'IMG') markFailed(t);
}, true);
/** Re-check images inside root (call after inserting client-rendered cards). */
GB.checkImages = function (root) {
  GB.$$('img', root || document).forEach(function (img) {
    if (img.complete && img.getAttribute('src') && img.naturalWidth === 0) markFailed(img);
  });
};
GB.ready(function () { GB.checkImages(document); }); // errors that fired before this script ran

} catch (e) { console.error('[GB] src/js/00-core.js failed to initialise', e); }
/* ---- 10-store.js ---- */
try {
/* 10-store.js — client state (localStorage via GB.storage, keys under 'gbq8:v2:'):
     GB.cart   {id: qty}            + 'cartp' {id: addedPriceFils}  → event 'cart:change'
     GB.wish   [id]                                                 → event 'wish:change'
     GB.recent [id] (max 12, newest first)                          → event 'recent:change'
     GB.orders [{ref, at, …, status 'pending'|'sent'}] (max 10)    → event 'orders:change'
     GB.customer  saved checkout details (opt-in only)
   Plus one-time migration of the v1 keys 'gbq8b-cart' / 'gbq8b-wish' (CSV row ids → WooCommerce ids).
   Contract: src/CONTRACTS.md §7.2. Prices are NEVER trusted from storage: lines() reprices from products.json. */

const QTY_MAX = 99;
const ID_RE = /^\d{1,9}$/;
const clampQty = (q) => {
  const n = Math.floor(Number(q));
  return Number.isFinite(n) ? Math.max(0, Math.min(QTY_MAX, n)) : 0;
};

/* ------------------------------------------------------------------ cart */
function readCart() {
  const raw = GB.storage.get('cart', {});
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    Object.keys(raw).forEach((id) => {
      const q = clampQty(raw[id]);
      if (ID_RE.test(id) && q > 0) out[id] = q;
    });
  }
  return out;
}
function readPrices() {
  const raw = GB.storage.get('cartp', {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}
let cart = readCart();
let prices = readPrices();

function saveCart(reason, id) {
  Object.keys(prices).forEach((k) => { if (!cart[k]) delete prices[k]; });
  GB.storage.set('cart', cart);
  GB.storage.set('cartp', prices);
  GB.emit('cart:change', { cart: GB.cart.get(), count: GB.cart.count(), reason, id: id || null });
}

GB.cart = {
  /** Copy of {id: qty}. */
  get() { return Object.assign({}, cart); },
  /** Quantity of one id (0 when absent). */
  qty(id) { return cart[String(id)] || 0; },
  has(id) { return !!cart[String(id)]; },
  /** Number of distinct lines. */
  size() { return Object.keys(cart).length; },
  /** Total quantity (the badge number). */
  count() { return Object.keys(cart).reduce((s, k) => s + cart[k], 0); },
  /**
   * Add qty (default 1) of id; priceFils = the price the customer saw (data-price) for change detection.
   * Returns the new quantity (capped at 99).
   */
  add(id, qty, priceFils) {
    id = String(id);
    if (!ID_RE.test(id)) return 0;
    const q = clampQty((cart[id] || 0) + (qty === undefined ? 1 : clampQty(qty)));
    if (!q) return cart[id] || 0;
    cart[id] = q;
    if (priceFils > 0 && !prices[id]) prices[id] = Math.round(Number(priceFils));
    saveCart('add', id);
    return q;
  },
  /** Set an exact quantity; 0 removes the line. Returns the new quantity. */
  set(id, qty) {
    id = String(id);
    if (!ID_RE.test(id)) return 0;
    const q = clampQty(qty);
    if (q > 0) cart[id] = q; else delete cart[id];
    saveCart(q > 0 ? 'set' : 'remove', id);
    return q;
  },
  remove(id) { id = String(id); if (cart[id]) { delete cart[id]; saveCart('remove', id); } },
  clear() { cart = {}; prices = {}; saveCart('clear'); },

  /**
   * Resolve the cart against products.json (a Map from GB.products()). Drops unknown ids from storage
   * (event reason 'sanitize'). Returns lines in insertion order:
   *   { id, qty, p (compact product), name, url, unitFils, lineFils, availability,
   *     available (false when out_of_stock), backorder, addedPriceFils|null, priceChanged }
   */
  lines(products) {
    const out = [];
    let dropped = false;
    Object.keys(cart).forEach((id) => {
      const p = products && products.get(id);
      if (!p) { delete cart[id]; dropped = true; return; }
      const qty = cart[id];
      const added = prices[id] ? Number(prices[id]) : null;
      out.push({
        id, qty, p,
        name: GB.pname(p),
        url: GB.purl(p),
        unitFils: p.p,
        lineFils: p.p * qty,
        availability: p.a,
        available: p.a !== 'out_of_stock',
        backorder: p.a === 'backorder',
        addedPriceFils: added,
        priceChanged: added !== null && added !== p.p,
      });
    });
    if (dropped) saveCart('sanitize');
    return out;
  },
  /** After telling the customer "تحدّث السعر", store the current prices so the notice is not repeated. */
  ackPrices(products) {
    let changed = false;
    Object.keys(cart).forEach((id) => {
      const p = products && products.get(id);
      if (p && prices[id] !== p.p) { prices[id] = p.p; changed = true; }
    });
    if (changed) GB.storage.set('cartp', prices);
  },
  /**
   * Totals for lines() output, honouring config.delivery (SPEC §5):
   *   { subtotalFils, itemCount (available qty), unavailableCount, confirmed, deliveryFils (null when not confirmed),
   *     totalFils (null when not confirmed), freeOverFils, remainingForFreeFils (null when not confirmed) }
   * Out-of-stock lines are excluded from every number.
   */
  totals(lines) {
    const d = GB.cfg.delivery || {};
    let subtotal = 0, items = 0, unavailable = 0;
    (lines || []).forEach((l) => {
      if (l.available) { subtotal += l.lineFils; items += l.qty; } else unavailable += 1;
    });
    const confirmed = d.confirmed === true;
    let delivery = null, total = null, remaining = null;
    if (confirmed) {
      const free = d.freeOverFils && subtotal >= d.freeOverFils;
      delivery = items === 0 ? 0 : (free ? 0 : (d.feeFils || 0));
      total = subtotal + delivery;
      remaining = d.freeOverFils ? Math.max(0, d.freeOverFils - subtotal) : null;
    }
    return {
      subtotalFils: subtotal, itemCount: items, unavailableCount: unavailable, confirmed,
      deliveryFils: delivery, totalFils: total, freeOverFils: d.freeOverFils || null, remainingForFreeFils: remaining,
    };
  },
};

/* ------------------------------------------------------------------ wishlist */
function readList(key, max) {
  const raw = GB.storage.get(key, []);
  const seen = {};
  return (Array.isArray(raw) ? raw : []).map(String).filter((id) => {
    if (!ID_RE.test(id) || seen[id]) return false;
    seen[id] = 1;
    return true;
  }).slice(0, max || 500);
}
let wish = readList('wish');
function saveWish(id, on, reason) {
  GB.storage.set('wish', wish);
  GB.emit('wish:change', { list: wish.slice(), count: wish.length, id: id || null, on: !!on, reason: reason || (on ? 'add' : 'remove') });
}
GB.wish = {
  list() { return wish.slice(); },
  count() { return wish.length; },
  has(id) { return wish.indexOf(String(id)) !== -1; },
  add(id) { id = String(id); if (ID_RE.test(id) && !GB.wish.has(id)) { wish.unshift(id); saveWish(id, true); } return true; },
  remove(id) { id = String(id); if (GB.wish.has(id)) { wish = wish.filter((x) => x !== id); saveWish(id, false); } return false; },
  /** Toggle; returns the new state (true = in wishlist). */
  toggle(id) { return GB.wish.has(id) ? GB.wish.remove(id) : GB.wish.add(id); },
  clear() { wish = []; saveWish(null, false, 'clear'); },
  /** Drop ids unknown to products.json (Map). */
  sanitize(products) {
    const before = wish.length;
    wish = wish.filter((id) => products.has(id));
    if (wish.length !== before) saveWish(null, false, 'sanitize');
    return wish.slice();
  },
};

/* ------------------------------------------------------------------ recently viewed */
GB.recent = {
  list() { return readList('recent', 12); },
  /** Move id to the front (max 12). */
  push(id) {
    id = String(id);
    if (!ID_RE.test(id)) return;
    const list = [id].concat(GB.recent.list().filter((x) => x !== id)).slice(0, 12);
    GB.storage.set('recent', list);
    GB.emit('recent:change', { list });
  },
  clear() { GB.storage.remove('recent'); GB.emit('recent:change', { list: [] }); },
};

/* ------------------------------------------------------------------ orders (last 10) */
function readOrders() {
  const raw = GB.storage.get('orders', []);
  return Array.isArray(raw) ? raw.filter((o) => o && typeof o.ref === 'string') : [];
}
function saveOrders(list, ref, reason) {
  GB.storage.set('orders', list.slice(0, 10));
  GB.emit('orders:change', { list: list.slice(0, 10), ref: ref || null, reason });
}
GB.orders = {
  /** Newest first. */
  list() { return readOrders(); },
  get(ref) { return readOrders().filter((o) => o.ref === ref)[0] || null; },
  /**
   * Save an order (status defaults to 'pending'). Suggested shape (owned by the cart agent):
   *   { ref, at (ms), locale, lines: [{id, name, qty, unitFils, lineFils, backorder}], totals, customer: {…}, payment, message }
   */
  add(order) {
    const o = Object.assign({ status: 'pending', at: Date.now() }, order);
    const list = [o].concat(readOrders().filter((x) => x.ref !== o.ref));
    saveOrders(list, o.ref, 'add');
    return o;
  },
  /** Patch an order by ref. */
  update(ref, patch) {
    const list = readOrders().map((o) => (o.ref === ref ? Object.assign({}, o, patch) : o));
    saveOrders(list, ref, 'update');
  },
  markSent(ref) { GB.orders.update(ref, { status: 'sent', sentAt: Date.now() }); },
  /** Hide the "complete your order" banner for this ref without marking it sent. */
  dismiss(ref) { GB.orders.update(ref, { dismissed: true }); },
  /** Most recent pending, non-dismissed order younger than 7 days, or null. */
  pending() {
    const week = 7 * 24 * 3600 * 1000;
    return readOrders().filter((o) => o.status === 'pending' && !o.dismissed && Date.now() - (o.at || 0) < week)[0] || null;
  },
};

/* ------------------------------------------------------------------ saved checkout details (opt-in only) */
GB.customer = {
  get() { const c = GB.storage.get('customer', null); return c && typeof c === 'object' ? c : null; },
  set(details) { GB.storage.set('customer', details); },
  clear() { GB.storage.remove('customer'); },
};

/* ------------------------------------------------------------------ v1 → v2 migration (runs once per browser) */
// v1 stored CSV ROW ids. Only rows whose WooCommerce id is a live product are listed (English twins dropped).
const LEGACY_MAP = '1:10736,2:10748,3:10754,4:10765,5:10779,6:10788,7:10795,8:10805,9:10815,10:10828,11:10845,12:10853,13:10856,14:10877,15:10884,16:10892,17:10904,18:10907,19:10915,20:10923,21:10930,22:10938,23:10942,24:10948,25:11161,50:11444,51:11452,52:11459,53:11475,54:11478,55:11488,56:11495,57:11500,58:11510,59:11521,60:11529,61:11542,62:11573,63:11578,64:11597,65:11600,66:11616,67:11623,68:11631,69:11642,70:11651,71:11659,72:11668,73:11675,74:11686,75:11698,76:11708,77:11736,78:11748,79:11761,80:11770,81:11778,82:11791,83:11801,84:11826,85:11834,86:11845,87:11853,88:11864,89:11873,90:11897,91:11899,92:11912,93:11923,94:11930,95:11943,96:11953,97:11962,98:11971,99:11982,100:12000,101:12008,102:12019,103:12028,104:12031,105:12050,106:12063,107:12066,108:12074,109:12078,110:12086,111:12091,112:12102,113:12116,115:12211,116:12250,117:12253,118:12338,119:12354,120:12385,121:12392,122:12400,123:12414,124:12422,125:12489,126:12500,127:12512,128:12521,129:12527,130:12545,131:12561,132:12597,133:12602,134:12605,135:12628,136:12638,137:12645,138:12652,139:12674,140:12677,141:12687,142:12696,143:12705,144:12713,145:12820,146:12833,147:12864,148:12878,149:12906,150:13042,151:13046,152:13067,154:13077,155:13086,156:13094,157:13100,158:13114,159:13121,160:13130,161:13136,162:13141,163:13149,164:13164,165:13167,166:13175,167:13180,168:13194,169:13206,170:13217,171:13225,172:13232,173:13269,174:13273,175:13294,176:13303,177:13313,178:13321,179:13329,180:13338,181:13350,182:13360,183:13369,184:13381,185:13390,186:13396,187:13405,188:13411,189:13421,190:13433,191:21532';
(function migrateLegacy() {
  const rawCart = GB.storage.getRaw('gbq8b-cart');
  const rawWish = GB.storage.getRaw('gbq8b-wish');
  if (rawCart === null && rawWish === null) return;
  const map = {};
  LEGACY_MAP.split(',').forEach((pair) => { const kv = pair.split(':'); map[kv[0]] = kv[1]; });
  let moved = 0;
  try {
    const old = JSON.parse(rawCart || '{}') || {};
    Object.keys(old).forEach((row) => {
      const id = map[String(row)];
      const q = clampQty(old[row]);
      if (id && q > 0) { cart[id] = clampQty((cart[id] || 0) + q); moved++; }
    });
  } catch (e) { /* corrupt v1 data: drop it */ }
  try {
    const oldW = JSON.parse(rawWish || '[]') || [];
    (Array.isArray(oldW) ? oldW : []).forEach((row) => {
      const id = map[String(row)];
      if (id && wish.indexOf(id) === -1) wish.push(id);
    });
  } catch (e) { /* ignore */ }
  GB.storage.set('cart', cart);
  GB.storage.set('wish', wish);
  GB.storage.removeRaw('gbq8b-cart');
  GB.storage.removeRaw('gbq8b-wish');
  GB.migrated = moved;
})();

/* ------------------------------------------------------------------ other tabs */
window.addEventListener('storage', (e) => {
  if (!e.key || e.key.indexOf(GB.storage.prefix) !== 0) return;
  const k = e.key.slice(GB.storage.prefix.length);
  if (k === 'cart' || k === 'cartp') {
    cart = readCart(); prices = readPrices();
    GB.emit('cart:change', { cart: GB.cart.get(), count: GB.cart.count(), reason: 'sync', id: null });
  } else if (k === 'wish') {
    wish = readList('wish');
    GB.emit('wish:change', { list: wish.slice(), count: wish.length, id: null, on: false, reason: 'sync' });
  } else if (k === 'orders') {
    GB.emit('orders:change', { list: readOrders(), ref: null, reason: 'sync' });
  }
});

} catch (e) { console.error('[GB] src/js/10-store.js failed to initialise', e); }
/* ---- 20-ui.js ---- */
try {
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

} catch (e) { console.error('[GB] src/js/20-ui.js failed to initialise', e); }
/* ---- 30-cart.js ---- */
try {
/* 30-cart.js — cart module, part 1 (every page):
     • the #gb-cart drawer (lines, qty stepper, remove, unavailable lines, price-changed notice, totals per
       config.delivery, checkout CTA, empty state)
     • the price-changed check on load (SPEC §4) and the pending-order banner in #gb-banner (SPEC §5)
     • GB.cartUI — markup helpers shared with 31-checkout.js and 32-wishlist.js
   Page-only strings arrive as pageData.cartI18n (checkout/wishlist pages) and are merged into GB.i18n here.
   Contract: src/CONTRACTS.md §6–7. Actions owned here: cart-inc, cart-dec, cart-remove, cart-remove-unavailable,
   cart-retry, cart-banner-dismiss. */

(function mergePageI18n() {
  const pd = GB.page();
  if (pd && pd.cartI18n && typeof pd.cartI18n === 'object') Object.assign(GB.i18n, pd.cartI18n);
})();

/* ------------------------------------------------------------------ shared markup helpers (delegate to the foundation GB.ui renderers) */
const cartIsCheckout = () => document.body.classList.contains('page-checkout');

GB.cartUI = {
  /** <bdi> product name; Latin-only names get lang=en dir=ltr (same rule as the server nameHtml()). */
  nameHtml(name) { return GB.ui.nameHtml({ n: { ar: name, en: name } }); },
  /** Inline (<span>) 1:1 media box (category art placeholder + lazy image) for cart rows. */
  media(item, cls) {
    const src = item.img ? GB.img(item.img) : '';
    return '<span class="gb-media' + (src ? '' : ' is-empty') + (cls ? ' ' + GB.esc(cls) : '') + '">' + GB.ui.art(item.cat, 'gb-media__ph') +
      (src ? '<img class="gb-media__img" src="' + GB.esc(src) + '" alt="" width="800" height="800" loading="lazy" decoding="async">' : '') + '</span>';
  },
  /** Price block for a compact product (same classes as the server priceBlock()). */
  price(item, size) { return GB.ui.price(item, size); },
  stock(availability, cls) { return GB.ui.stock(availability, cls); },
  /**
   * Totals block for GB.cart.totals() output. config.delivery.confirmed=false → "يتأكد على واتساب" and
   * "X + التوصيل", no free-delivery claims; confirmed=true → fee / free + progress towards the threshold.
   */
  totalsHtml(t) {
    let free = '';
    if (t.confirmed && t.freeOverFils && t.itemCount > 0) {
      const reached = t.remainingForFreeFils === 0;
      const pct = Math.max(4, Math.min(100, Math.round((t.subtotalFils / t.freeOverFils) * 100)));
      free = '<div class="gb-cart-free' + (reached ? ' is-reached' : '') + '"><p class="gb-cart-free__text">' + GB.icon(reached ? 'check' : 'truck') + '<span>' +
        GB.esc(reached ? GB.t('cart.freeReached') : GB.t('cart.freeLeft', { amount: GB.money(t.remainingForFreeFils) })) + '</span></p>' +
        '<div class="gb-cart-free__bar" aria-hidden="true"><span style="width:' + pct + '%"></span></div></div>';
    }
    const row = (cls, label, value) => '<div class="gb-cart-sum__row' + (cls ? ' ' + cls : '') + '"><dt>' + GB.esc(label) + '</dt><dd>' + value + '</dd></div>';
    let delivery, total;
    if (t.confirmed) {
      delivery = t.deliveryFils ? GB.moneyHtml(t.deliveryFils) : '<span class="gb-cart-sum__free">' + GB.esc(GB.t('cart.deliveryFree')) + '</span>';
      total = GB.moneyHtml(t.totalFils);
    } else {
      delivery = '<span class="gb-cart-sum__tbc">' + GB.esc(GB.t('cart.deliveryTbc')) + '</span>';
      total = GB.moneyHtml(t.subtotalFils) + ' <span class="gb-cart-sum__plus">' + GB.esc(GB.t('cart.plusDelivery')) + '</span>';
    }
    return free + '<dl class="gb-cart-sum">' + row('', GB.t('cart.subtotal'), GB.moneyHtml(t.subtotalFils)) +
      row('', GB.t('cart.delivery'), delivery) + row('gb-cart-sum__row--total', GB.t('cart.total'), total) + '</dl>';
  },
  /** Ids whose price changed since they were added this page view → {id: oldPriceFils}. */
  priceNotice: {},
  /** Record price changes from lines() and acknowledge them (so the notice is shown once per page view). */
  notePrices(lines, products) {
    let any = false;
    lines.forEach((l) => { if (l.priceChanged && l.addedPriceFils) { GB.cartUI.priceNotice[l.id] = l.addedPriceFils; any = true; } });
    if (any) GB.cart.ackPrices(products);
    return any;
  },
  hasPriceNotice(lines) { return lines.some((l) => GB.cartUI.priceNotice[l.id] && GB.cartUI.priceNotice[l.id] !== l.unitFils); },
  /** Show the drawer state for a fresh render (used after products load). */
  render() { renderCart(); },
};

/* ------------------------------------------------------------------ drawer rendering */
let cartLoadError = false;
let cartLoading = false;
let cartRendering = false;
let cartFocusAfter = null; // array of selectors to try after the next render

function cartEls() { return { body: document.getElementById('gb-cart-body'), foot: document.getElementById('gb-cart-foot') }; }

function cartLoad() {
  if (cartLoading) return;
  cartLoading = true;
  GB.products().then(() => { cartLoading = false; cartLoadError = false; renderCart(); }, () => { cartLoading = false; cartLoadError = true; renderCart(); });
}

function cartEmptyHtml() {
  return '<div class="gb-empty gb-cart-empty">' + GB.icon('cart', 'gb-empty__icon') + '<h3 class="gb-empty__title">' + GB.esc(GB.t('cart.empty')) + '</h3>' +
    '<p class="gb-empty__text">' + GB.esc(GB.t('cart.emptyText')) + '</p><div class="gb-empty__actions">' +
    '<button type="button" class="gb-btn gb-btn--primary" data-dialog-close>' + GB.esc(GB.t('cart.continue')) + '</button>' +
    '<a class="gb-btn gb-btn--light" href="' + GB.esc(GB.url('c/all/')) + '">' + GB.esc(GB.t('cart.browseAll')) + '</a></div></div>';
}

function cartLineHtml(l) {
  const id = GB.esc(l.id);
  const name = l.name;
  const url = GB.esc(l.url);
  const was = GB.cartUI.priceNotice[l.id];
  let notes = '';
  if (was && was !== l.unitFils) notes += '<p class="gb-cart-line__note gb-cart-line__note--price">' + GB.icon('info') + '<span>' + GB.esc(GB.t('cart.priceWas', { amount: GB.money(was) })) + '</span></p>';
  if (l.backorder) notes += '<p class="gb-cart-line__note">' + GB.cartUI.stock('backorder') + '<span>' + GB.esc(GB.t('cart.backorderNote')) + '</span></p>';
  if (!l.available) notes += '<p class="gb-cart-line__note gb-cart-line__note--na">' + GB.icon('alert') + '<span>' + GB.esc(GB.t('cart.unavailableLine')) + '</span></p>';
  let row = '';
  if (l.available) {
    row = '<div class="gb-cart-line__row"><div class="gb-stepper gb-cart-line__qty" role="group" aria-label="' + GB.esc(GB.t('cart.qtyOf', { name })) + '">' +
      '<button type="button" data-action="cart-dec" data-id="' + id + '" aria-label="' + GB.esc(GB.t('cart.decrease', { name })) + '"' + (l.qty <= 1 ? ' disabled' : '') + '>' + GB.icon('minus') + '</button>' +
      '<output>' + l.qty + '</output>' +
      '<button type="button" data-action="cart-inc" data-id="' + id + '" aria-label="' + GB.esc(GB.t('cart.increase', { name })) + '"' + (l.qty >= 99 ? ' disabled' : '') + '>' + GB.icon('plus') + '</button>' +
      '</div><p class="gb-cart-line__total"><span class="gb-sr">' + GB.esc(GB.t('cart.lineTotal')) + ': </span>' + GB.moneyHtml(l.lineFils) + '</p></div>';
  }
  return '<li class="gb-cart-line' + (l.available ? '' : ' is-unavailable') + '" data-id="' + id + '">' +
    '<a class="gb-cart-line__media" href="' + url + '" tabindex="-1" aria-hidden="true">' + GB.cartUI.media(l.p) + '</a>' +
    '<div class="gb-cart-line__main">' +
    '<a class="gb-cart-line__name" href="' + url + '">' + GB.cartUI.nameHtml(name) + '</a>' +
    '<p class="gb-cart-line__unit">' + GB.esc(GB.t('cart.each', { price: GB.money(l.unitFils) })) + '</p>' + notes + row +
    '<button type="button" class="gb-cart-line__remove" data-action="cart-remove" data-id="' + id + '" aria-label="' + GB.esc(GB.t('cart.removeItem', { name })) + '">' +
    GB.icon('trash') + '<span>' + GB.esc(GB.t('cart.remove')) + '</span></button>' +
    '</div></li>';
}

function renderCart() {
  const { body, foot } = cartEls();
  if (!body || !foot || cartRendering) return;
  cartRendering = true;
  try {
    if (GB.cart.size() === 0) {
      body.innerHTML = cartEmptyHtml();
      foot.hidden = true; foot.innerHTML = '';
      return;
    }
    const map = GB.productsMap;
    if (!map) {
      foot.hidden = true; foot.innerHTML = '';
      if (cartLoadError) {
        body.innerHTML = '<div class="gb-alert gb-alert--error gb-cart-error" role="alert">' + GB.icon('alert') + '<div><p>' + GB.esc(GB.t('common.error')) + '</p>' +
          '<button type="button" class="gb-btn gb-btn--light" data-action="cart-retry">' + GB.icon('refresh') + '<span>' + GB.esc(GB.t('common.retry')) + '</span></button></div></div>';
      } else {
        body.innerHTML = '<p class="gb-cart-boot" role="status"><span class="gb-cart-spinner" aria-hidden="true"></span><span>' + GB.esc(GB.t('common.loading')) + '</span></p>';
        cartLoad();
      }
      return;
    }
    const lines = GB.cart.lines(map); // drops unknown ids (emits cart:change 'sanitize'; guarded by cartRendering)
    if (!lines.length) {
      body.innerHTML = cartEmptyHtml();
      foot.hidden = true; foot.innerHTML = '';
      return;
    }
    GB.cartUI.notePrices(lines, map);
    const t = GB.cart.totals(lines);
    let top = '';
    if (GB.cartUI.hasPriceNotice(lines)) top += '<p class="gb-alert gb-cart-notice">' + GB.icon('info') + '<span>' + GB.esc(GB.t('common.priceUpdated')) + '</span></p>';
    if (t.unavailableCount) {
      top += '<div class="gb-alert gb-cart-notice">' + GB.icon('alert') + '<div><p>' + GB.esc(GB.t('cart.unavailableNotice')) + '</p>' +
        '<button type="button" class="gb-btn gb-btn--light gb-cart-notice__btn" data-action="cart-remove-unavailable">' + GB.icon('trash') + '<span>' +
        GB.esc(GB.t('cart.removeUnavailable')) + '</span></button></div></div>';
    }
    body.innerHTML = top + '<ul class="gb-cart-lines" role="list">' + lines.map(cartLineHtml).join('') + '</ul>';
    const onCheckout = cartIsCheckout();
    const cta = t.itemCount > 0
      ? '<a class="gb-btn gb-btn--primary gb-btn--block gb-btn--lg gb-cart-cta" href="' + GB.esc(GB.url('checkout/')) + '"' + (onCheckout ? ' data-dialog-close' : '') + '>' +
        '<span>' + GB.esc(GB.t('cart.checkout')) + '</span>' + GB.icon('arrow-forward') + '</a>'
      : '<p class="gb-alert gb-alert--error">' + GB.icon('alert') + '<span>' + GB.esc(GB.t('cart.allUnavailable')) + '</span></p>';
    foot.innerHTML = GB.cartUI.totalsHtml(t) + '<div class="gb-cart-actions">' + cta +
      '<button type="button" class="gb-btn gb-btn--ghost gb-btn--block" data-dialog-close>' + GB.esc(GB.t('cart.continue')) + '</button></div>';
    foot.hidden = false;
    GB.ui.hydrate(body);
  } finally {
    cartRendering = false;
    cartRestoreFocus();
  }
}

function cartRestoreFocus() {
  const list = cartFocusAfter;
  cartFocusAfter = null;
  if (!list || !GB.dialog.isOpen('gb-cart')) return;
  let el = null;
  for (let i = 0; i < list.length && !el; i++) {
    const c = GB.$(list[i]);
    if (c && !c.disabled) el = c;
  }
  el = el || document.getElementById('gb-cart-title');
  if (el) { try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); } }
}

GB.listen('dialog:open', (d) => { if (d.id === 'gb-cart') renderCart(); });
GB.listen('cart:change', () => { if (GB.dialog.isOpen('gb-cart')) renderCart(); });

/* ------------------------------------------------------------------ drawer actions */
const lineSel = (action, id) => '#gb-cart [data-action="' + action + '"][data-id="' + id + '"]';
GB.on('click', '[data-action="cart-inc"], [data-action="cart-dec"]', (e, el) => {
  e.preventDefault();
  if (el.disabled) return;
  const id = el.getAttribute('data-id');
  const inc = el.getAttribute('data-action') === 'cart-inc';
  const q = GB.cart.qty(id);
  if (!q) return;
  const next = Math.max(1, Math.min(99, q + (inc ? 1 : -1)));
  if (next === q) { if (inc) GB.announce(GB.t('cart.maxQty')); return; }
  cartFocusAfter = [lineSel(el.getAttribute('data-action'), id), lineSel(inc ? 'cart-dec' : 'cart-inc', id)];
  GB.cart.set(id, next);
  const item = GB.productsMap && GB.productsMap.get(id);
  GB.announce(GB.t('cart.qtyNow', { name: item ? GB.pname(item) : '#' + id, n: next }));
  if (inc && item) GB.track('add_to_cart', { id, qty: 1, value: item.p });
});

GB.on('click', '[data-action="cart-remove"]', (e, el) => {
  e.preventDefault();
  const id = el.getAttribute('data-id');
  const li = el.closest('.gb-cart-line');
  const sib = li && (li.nextElementSibling || li.previousElementSibling);
  const sibId = sib && sib.getAttribute('data-id');
  cartFocusAfter = sibId ? [lineSel('cart-remove', sibId)] : ['#gb-cart .gb-cart-empty [data-dialog-close]'];
  const item = GB.productsMap && GB.productsMap.get(id);
  GB.cart.remove(id);
  GB.toast(GB.t('cart.removed', { name: item ? GB.pname(item) : '#' + id }));
});

GB.on('click', '[data-action="cart-remove-unavailable"]', (e) => {
  e.preventDefault();
  const map = GB.productsMap;
  if (!map) return;
  cartFocusAfter = ['#gb-cart [data-action="cart-remove"]', '#gb-cart .gb-cart-empty [data-dialog-close]'];
  GB.cart.lines(map).filter((l) => !l.available).forEach((l) => GB.cart.remove(l.id));
});

GB.on('click', '[data-action="cart-retry"]', (e) => {
  e.preventDefault();
  cartLoadError = false;
  cartFocusAfter = ['#gb-cart-title'];
  renderCart();
});

/* ------------------------------------------------------------------ on load: sanitize + reprice + price-changed notice */
GB.ready(() => {
  if (!GB.cart.size()) return;
  GB.products().then((map) => {
    const lines = GB.cart.lines(map);
    const changed = GB.cartUI.notePrices(lines, map);
    if (GB.dialog.isOpen('gb-cart')) renderCart();
    if (changed) {
      GB.emit('cart:prices', { ids: Object.keys(GB.cartUI.priceNotice) });
      if (!cartIsCheckout()) {
        GB.toast(GB.t('common.priceUpdated'), { timeout: 6000, action: document.getElementById('gb-cart') ? { label: GB.t('common.viewCart'), onClick() { GB.dialog.open('gb-cart'); } } : null });
      }
    }
  }).catch(() => { /* offline or blocked: the drawer shows its own retry state when opened */ });
});

/* ------------------------------------------------------------------ pending-order banner (all pages except checkout) */
let bannerRef = null;
function renderPendingBanner() {
  if (cartIsCheckout()) return;
  const o = GB.orders.pending();
  if (!o) {
    if (bannerRef) { GB.banner.hide(); bannerRef = null; }
    return;
  }
  if (bannerRef === o.ref) return;
  const href = GB.url('checkout/') + '?ref=' + encodeURIComponent(o.ref);
  const b = GB.banner.show(
    '<p class="gb-banner__text gb-cart-pending__text">' + GB.icon('alert') + '<span>' + GB.esc(GB.t('cart.pendingText')) +
    ' <bdi class="gb-cart-pending__ref" dir="ltr">' + GB.esc(o.ref) + '</bdi></span></p>' +
    '<a class="gb-btn gb-btn--primary gb-cart-pending__cta" href="' + GB.esc(href) + '">' + GB.esc(GB.t('cart.pendingCta')) + '</a>' +
    '<button type="button" class="gb-btn gb-btn--ghost gb-btn--icon gb-cart-pending__x" data-action="cart-banner-dismiss" data-ref="' + GB.esc(o.ref) +
    '" aria-label="' + GB.esc(GB.t('cart.pendingDismiss')) + '">' + GB.icon('x') + '</button>');
  if (b) {
    b.setAttribute('role', 'region');
    b.setAttribute('aria-label', GB.t('cart.pendingText'));
  }
  bannerRef = o.ref;
}
GB.ready(renderPendingBanner);
GB.listen('orders:change', () => { bannerRef = null; renderPendingBanner(); });
GB.on('click', '[data-action="cart-banner-dismiss"]', (e, el) => {
  e.preventDefault();
  const ref = el.getAttribute('data-ref');
  GB.orders.dismiss(ref);
  GB.banner.hide();
  bannerRef = null;
  const main = document.getElementById('main');
  if (main) { try { main.focus({ preventScroll: true }); } catch (err) { main.focus(); } }
});

} catch (e) { console.error('[GB] src/js/30-cart.js failed to initialise', e); }
/* ---- 31-checkout.js ---- */
try {
/* 31-checkout.js — cart module, part 2: WhatsApp order builder (GB.order, pure functions, unit-tested by
   tools/verify/cart-message.test.mjs) + the checkout/ page (SPEC §5).
   Flow: validate → ref GB-YYMMDD-XXXX → GB.orders.add (pending) → build message → location.href = wa.me
   SYNCHRONOUSLY inside the submit handler → "one last step" state (reopen WhatsApp <a>, copy text, "sent ✓").
   Actions owned here: checkout-copy, checkout-sent, checkout-retry. Event: checkout:submitted {ref, url}. */

/* ------------------------------------------------------------------ pure order helpers */
const ORDER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const WA_MAX_URL = 6000;
const MSG_SEP = '———';
const GOV_KEYS = { capital: 'checkout.govCapital', hawalli: 'checkout.govHawalli', farwaniya: 'checkout.govFarwaniya', ahmadi: 'checkout.govAhmadi', jahra: 'checkout.govJahra', mubarak: 'checkout.govMubarak' };
const PAY_KEYS = { cod: 'order.payCod', knet_link: 'order.payKnet' };

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits → Latin. */
function normDigits(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0));
}
/** Phone → bare national digits: normalize digits, strip everything else, strip a leading 00965 / 965. */
function normPhone(raw) {
  let d = normDigits(raw).replace(/\D/g, '');
  if (d.length === 13 && d.indexOf('00965') === 0) d = d.slice(5);
  else if (d.length === 11 && d.indexOf('965') === 0) d = d.slice(3);
  return d;
}
const validPhone = (d) => /^[24569]\d{7}$/.test(String(d || ''));
/** Trim, collapse whitespace, Latin digits, cap length. */
function cleanText(s, max) {
  return Array.from(normDigits(s).replace(/\s+/g, ' ').trim()).slice(0, max || 200).join('').trim();
}
/** Clip to max characters (code points) with an ellipsis. */
function clipText(s, max) {
  const a = Array.from(String(s || ''));
  return a.length <= max ? a.join('') : a.slice(0, max - 1).join('').trim() + '…';
}
/** GB-YYMMDD-XXXX (local date; X from a 32-letter alphabet without 0/O/1/I). rand() → [0,1) for tests. */
function makeRef(now, rand) {
  const d = now || new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  let bytes = null;
  if (!rand) {
    try { bytes = new Uint8Array(4); (window.crypto || window.msCrypto).getRandomValues(bytes); } catch (e) { bytes = null; }
  }
  let x = '';
  for (let i = 0; i < 4; i++) {
    const n = bytes ? bytes[i] % 32 : Math.floor((rand || Math.random)() * 32) % 32;
    x += ORDER_ALPHABET[n];
  }
  return 'GB-' + String(d.getFullYear()).slice(2) + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + x;
}
function govName(id) { return GOV_KEYS[id] ? GB.t(GOV_KEYS[id]) : String(id || ''); }
/** "<gov> — <area>، قطعة <>، شارع <>[، جادة <>]، منزل <>" */
function addressText(c) {
  const T = GB.t;
  return [govName(c.governorate) + ' — ' + c.area, T('order.msgBlock', { v: c.block }), T('order.msgStreet', { v: c.street }),
    c.avenue ? T('order.msgAvenue', { v: c.avenue }) : '', T('order.msgHouse', { v: c.house })].filter(Boolean).join(T('order.msgSep'));
}
/**
 * The WhatsApp message (SPEC §5), in the page locale. Shortening levels (used only when the wa.me URL would exceed
 * 6000 chars; Arabic text percent-encodes to ~6 chars per letter, so the fixed part alone is ~1500):
 *   0 full · 1 names ≤ 40 chars · 2 item lines "• [#id] × qty = total" (SPEC) · 3 notes ≤ 60 chars ·
 *   4 all items on one line "• #id×qty، #id×qty…" · 5 notes left out (the full text stays available via "copy").
 * o = { ref, locale, lines: [{id, name, qty, lineFils, backorder}], totals (GB.cart.totals), customer: {name, phone,
 *       governorate, area, block, street, avenue, house, notes}, payment: 'cod'|'knet_link', src, publishId }
 */
function orderText(o, level) {
  const T = GB.t;
  const M = (f) => GB.money(f, o.locale);
  const lv = level || 0;
  const out = [T('order.msgTitle'), T('order.msgRef', { ref: o.ref }), MSG_SEP];
  if (lv >= 4) out.push(T('order.msgLinesCompact', { list: o.lines.map((l) => '#' + l.id + '×' + l.qty).join(T('order.msgSep')) }));
  else o.lines.forEach((l) => {
    if (lv >= 2) { out.push(T('order.msgLineShort', { id: l.id, qty: l.qty, total: M(l.lineFils) })); return; }
    let s = T('order.msgLine', { id: l.id, name: lv >= 1 ? clipText(l.name, 40) : l.name, qty: l.qty, total: M(l.lineFils) });
    if (l.backorder) s += ' ' + T('order.msgBackorder');
    out.push(s);
  });
  out.push(MSG_SEP);
  const t = o.totals;
  out.push(T('order.msgSubtotal', { v: M(t.subtotalFils) }));
  if (t.confirmed) {
    out.push(T('order.msgDelivery', { v: t.deliveryFils ? M(t.deliveryFils) : T('order.msgFree') }));
    out.push(T('order.msgTotal', { v: M(t.totalFils) }));
  } else {
    out.push(T('order.msgDelivery', { v: T('order.msgDeliveryTbc') }));
    out.push(T('order.msgTotal', { v: T('order.msgPlusDelivery', { amount: M(t.subtotalFils) }) }));
  }
  out.push(MSG_SEP);
  const c = o.customer;
  out.push(T('order.msgName', { v: c.name }));
  out.push(T('order.msgPhone', { v: c.phone }));
  out.push(T('order.msgAddress', { v: addressText(c) }));
  if (c.notes && lv < 5) out.push(T('order.msgNotes', { v: lv >= 3 ? clipText(c.notes, 60) : c.notes }));
  out.push(T('order.msgPayment', { v: T(PAY_KEYS[o.payment] || PAY_KEYS.cod) }));
  out.push(MSG_SEP);
  const foot = [];
  if (o.src) foot.push(T('order.msgSource', { v: o.src }));
  foot.push(T('order.msgVersion', { v: o.publishId || GB.cfg.publishId || '' }));
  out.push(foot.join(' · '));
  return out.join('\n');
}
/**
 * Full text (for "copy"), the text actually sent and its wa.me URL. The URL is kept ≤ 6000 chars by shortening
 * step by step (see orderText levels); `over` is true if even the shortest form is longer (the text is then sent
 * anyway: an over-long link still opens on most devices, and the customer can paste the copied text).
 */
function composeOrder(o) {
  const full = orderText(o, 0);
  let level = 0, sent = full, url = GB.wa(full);
  while (url.length > WA_MAX_URL && level < 5) {
    level++;
    sent = orderText(o, level);
    url = GB.wa(sent);
  }
  return { text: full, sent, url, level, over: url.length > WA_MAX_URL };
}
GB.order = { normDigits, normPhone, validPhone, cleanText, clipText, makeRef, text: orderText, compose: composeOrder, address: addressText, MAX_URL: WA_MAX_URL };

/* ------------------------------------------------------------------ checkout page */
const CO_FIELDS = ['name', 'phone', 'governorate', 'area', 'block', 'street', 'avenue', 'house', 'notes'];
const CO_MAX = { name: 60, phone: 12, governorate: 20, area: 40, block: 10, street: 60, avenue: 20, house: 40, notes: 300 };
const CO_REQUIRED = ['name', 'phone', 'governorate', 'area', 'block', 'street', 'house', 'payment'];
const CO_ERR = { name: 'checkout.errName', governorate: 'checkout.errGovernorate', area: 'checkout.errArea', block: 'checkout.errBlock', street: 'checkout.errStreet', house: 'checkout.errHouse', payment: 'checkout.errPayment' };
const CO_LABEL = { name: 'checkout.name', phone: 'checkout.phone', governorate: 'checkout.governorate', area: 'checkout.area', block: 'checkout.block', street: 'checkout.street', house: 'checkout.house', payment: 'checkout.sectionPayment' };

GB.ready(() => {
  if (!document.body.classList.contains('page-checkout')) return;
  const $ = (id) => document.getElementById(id);
  const form = $('checkout-form');
  if (!form) return;
  const page = GB.page() || {};
  const payments = (GB.cfg.payments && GB.cfg.payments.length ? GB.cfg.payments : ['cod', 'knet_link']);
  let attempted = false;
  let tracked = false;
  let doneOrder = null;
  let rendering = false;

  function show(which) {
    ['co-boot', 'co-empty', 'co-main', 'co-done'].forEach((id) => { const el = $(id); if (el) el.hidden = id !== which; });
    const lead = GB.$('.gb-co-head .gb-pagehead__sub');
    if (lead) lead.hidden = which === 'co-done';
  }
  function focusEl(el) { if (el) { try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); } } }

  /* ---------------- order summary */
  function renderSummary() {
    const box = $('co-summary');
    const submit = $('co-submit');
    const map = GB.productsMap;
    if (!box || !map || rendering || doneOrder) return;
    rendering = true;
    try {
      const lines = GB.cart.lines(map);
      if (!lines.length) { show('co-empty'); return; }
      GB.cartUI.notePrices(lines, map);
      const t = GB.cart.totals(lines);
      const avail = lines.filter((l) => l.available);
      const na = lines.filter((l) => !l.available);
      const li = (l) => '<li class="gb-co-line' + (l.available ? '' : ' is-unavailable') + '">' +
        '<span class="gb-co-line__qty"><span class="gb-sr">' + GB.esc(GB.t('common.qty')) + ' </span><bdi dir="ltr">' + l.qty + '×</bdi></span>' +
        '<span class="gb-co-line__name">' + GB.cartUI.nameHtml(l.name) +
        (l.backorder ? ' ' + GB.cartUI.stock('backorder') : '') +
        (l.available ? '' : ' <span class="gb-stock gb-stock--out_of_stock">' + GB.esc(GB.t('checkout.excluded')) + '</span>') + '</span>' +
        (l.available ? '<span class="gb-co-line__total">' + GB.moneyHtml(l.lineFils) + '</span>' : '') + '</li>';
      box.innerHTML = (GB.cartUI.hasPriceNotice(lines) ? '<p class="gb-alert gb-co-notice">' + GB.icon('info') + '<span>' + GB.esc(GB.t('common.priceUpdated')) + '</span></p>' : '') +
        '<ul class="gb-co-lines" role="list">' + avail.concat(na).map(li).join('') + '</ul>' + GB.cartUI.totalsHtml(t) +
        (avail.length ? '' : '<p class="gb-alert gb-alert--error">' + GB.icon('alert') + '<span>' + GB.esc(GB.t('cart.allUnavailable')) + '</span></p>');
      if (submit) submit.disabled = !avail.length;
      if (!tracked && avail.length) {
        tracked = true;
        GB.track('begin_checkout', { value: t.subtotalFils, items: t.itemCount });
      }
    } finally { rendering = false; }
  }
  function loadSummary() {
    const box = $('co-summary');
    const submit = $('co-submit');
    if (submit) submit.disabled = true;
    GB.products().then(renderSummary, () => {
      if (!box) return;
      box.innerHTML = '<div class="gb-alert gb-alert--error" role="alert">' + GB.icon('alert') + '<div><p>' + GB.esc(GB.t('common.error')) + '</p>' +
        '<button type="button" class="gb-btn gb-btn--light" data-action="checkout-retry">' + GB.icon('refresh') + '<span>' + GB.esc(GB.t('common.retry')) + '</span></button></div></div>';
    });
  }
  GB.on('click', '[data-action="checkout-retry"]', (e) => {
    e.preventDefault();
    $('co-summary').innerHTML = '<p class="gb-muted" role="status">' + GB.esc(GB.t('common.loading')) + '</p>';
    loadSummary();
  });
  GB.listen('cart:change', () => {
    if (doneOrder) return;
    if (!GB.cart.size()) { show('co-empty'); return; }
    if ($('co-main').hidden) { show('co-main'); loadSummary(); return; }
    renderSummary();
  });
  GB.listen('cart:prices', renderSummary);

  /* ---------------- form helpers */
  const control = (f) => (f === 'payment' ? GB.$('.gb-co-pays', form) : form.elements[f]);
  function readForm() {
    const v = {};
    CO_FIELDS.forEach((f) => { v[f] = form.elements[f] ? cleanText(form.elements[f].value, CO_MAX[f]) : ''; });
    v.phone = normPhone(form.elements.phone.value);
    const pay = GB.$('input[name="payment"]:checked', form);
    v.payment = pay ? pay.value : '';
    v.save = !!(form.elements.save && form.elements.save.checked);
    return v;
  }
  function errorKey(f, v) {
    if (f === 'phone') return !v.phone ? 'checkout.errPhoneEmpty' : (validPhone(v.phone) ? null : 'checkout.errPhone');
    if (f === 'payment') return payments.indexOf(v.payment) !== -1 ? null : CO_ERR.payment;
    if (f === 'governorate') return GOV_KEYS[v.governorate] ? null : CO_ERR.governorate;
    if (f === 'name') return Array.from(v.name).length >= 2 ? null : CO_ERR.name;
    return v[f] ? null : CO_ERR[f];
  }
  function setError(f, key) {
    const box = $('co-' + f + '-err');
    const el = control(f);
    if (!box || !el) return;
    if (key) {
      box.innerHTML = GB.icon('alert') + '<span>' + GB.esc(GB.t(key)) + '</span>';
      box.hidden = false;
      el.setAttribute('aria-invalid', 'true');
    } else {
      box.innerHTML = '';
      box.hidden = true;
      el.removeAttribute('aria-invalid');
    }
  }
  function focusField(f) {
    const el = f === 'payment' ? (GB.$('input[name="payment"]:checked', form) || GB.$('input[name="payment"]', form)) : form.elements[f];
    focusEl(el);
  }
  function showSummaryErrors(errs) {
    const box = $('co-errors');
    if (!errs.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = GB.icon('alert') + '<div><p class="gb-co-errors__title">' + GB.esc(GB.t('checkout.errSummary', { n: errs.length })) + '</p><ul class="gb-co-errors__list">' +
      errs.map((x) => '<li><a href="#co-' + (x[0] === 'payment' ? 'pay-' + GB.esc(payments[0]) : GB.esc(x[0])) + '" data-co-field="' + GB.esc(x[0]) + '">' +
        GB.esc(GB.t(CO_LABEL[x[0]])) + ': ' + GB.esc(GB.t(x[1])) + '</a></li>').join('') + '</ul></div>';
    box.hidden = false;
  }
  GB.on('click', '[data-co-field]', (e, el) => { e.preventDefault(); focusField(el.getAttribute('data-co-field')); });

  function validateAll() {
    const v = readForm();
    const errs = [];
    CO_REQUIRED.forEach((f) => { const k = errorKey(f, v); setError(f, k); if (k) errs.push([f, k]); });
    return { v, errs };
  }
  // live re-validation once the customer has tried to submit (or the field was already flagged)
  function revalidate(e) {
    const t = e.target;
    if (!t || !t.name) return;
    const f = t.name;
    if (CO_REQUIRED.indexOf(f) === -1) return;
    const flagged = (control(f) || {}).getAttribute && control(f).getAttribute('aria-invalid') === 'true';
    if (!attempted && !flagged) return;
    if (e.type === 'input' && !flagged) return; // don't nag while typing a fresh value
    setError(f, errorKey(f, readForm()));
    if (attempted) {
      const remaining = CO_REQUIRED.map((x) => [x, errorKey(x, readForm())]).filter((x) => x[1]);
      if (!remaining.length) showSummaryErrors([]);
    }
  }
  form.addEventListener('input', revalidate);
  form.addEventListener('change', revalidate);
  form.addEventListener('focusout', (e) => { if (attempted && e.target && e.target.name && e.target.type !== 'radio') revalidate({ type: 'change', target: e.target }); });

  // phone: accept pasted "+965 9793 7556" etc. despite maxlength=12 (normalise before inserting)
  form.elements.phone.addEventListener('paste', (e) => {
    const txt = (e.clipboardData || window.clipboardData || { getData: () => '' }).getData('text');
    if (!txt) return;
    const d = normPhone(txt);
    if (d && d.length <= 12) {
      e.preventDefault();
      form.elements.phone.value = d;
      form.elements.phone.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  // area suggestions per governorate (free text stays allowed)
  function updateAreas() {
    const dl = $('co-area-list');
    const list = (page.areas && page.areas[form.elements.governorate.value]) || [];
    if (dl) dl.innerHTML = list.map((a) => '<option value="' + GB.esc(a) + '"></option>').join('');
  }
  form.elements.governorate.addEventListener('change', updateAreas);

  function prefill() {
    const c = GB.customer.get();
    if (!c) return;
    CO_FIELDS.forEach((f) => { if (f !== 'notes' && typeof c[f] === 'string' && form.elements[f]) form.elements[f].value = c[f]; });
    if (c.payment) { const r = GB.$('input[name="payment"][value="' + String(c.payment).replace(/[^\w]/g, '') + '"]', form); if (r) r.checked = true; }
    if (form.elements.save) form.elements.save.checked = true;
    updateAreas();
  }

  /* ---------------- submit → WhatsApp (synchronous: no await before location.href) */
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    attempted = true;
    const res = validateAll();
    showSummaryErrors(res.errs);
    if (res.errs.length) {
      // bring the role=alert summary into view (below the sticky header), then focus the first invalid field
      const box = $('co-errors');
      try { box.scrollIntoView({ block: 'start', behavior: 'auto' }); } catch (err) { /* old browser */ }
      const f = res.errs[0][0];
      const el = f === 'payment' ? (GB.$('input[name="payment"]:checked', form) || GB.$('input[name="payment"]', form)) : form.elements[f];
      const r = el && el.getBoundingClientRect();
      const visible = r && r.top >= 0 && r.bottom <= (window.innerHeight || 0);
      if (el) { try { el.focus({ preventScroll: !!visible }); } catch (err) { el.focus(); } }
      return;
    }
    const map = GB.productsMap;
    if (!map) return;
    const lines = GB.cart.lines(map).filter((l) => l.available);
    if (!lines.length) return;
    const v = res.v;
    const totals = GB.cart.totals(lines);
    const customer = { name: v.name, phone: v.phone, governorate: v.governorate, area: v.area, block: v.block, street: v.street, avenue: v.avenue, house: v.house, notes: v.notes };
    const order = {
      ref: makeRef(),
      at: Date.now(),
      locale: GB.locale,
      status: 'pending',
      lines: lines.map((l) => ({ id: l.id, name: l.name, qty: l.qty, unitFils: l.unitFils, lineFils: l.lineFils, backorder: l.backorder })),
      totals: { subtotalFils: totals.subtotalFils, itemCount: totals.itemCount, confirmed: totals.confirmed, deliveryFils: totals.deliveryFils, totalFils: totals.totalFils },
      customer,
      payment: v.payment,
      src: GB.src(),
      publishId: GB.cfg.publishId || '',
    };
    const msg = composeOrder(order);
    order.message = msg.text;
    order.waUrl = msg.url;
    order.trimmed = msg.level > 0;
    GB.orders.add(order);
    if (v.save) GB.customer.set(Object.assign({ payment: v.payment }, customer, { notes: undefined }));
    else GB.customer.clear();
    GB.track('wa_handoff', { value: totals.totalFils !== null ? totals.totalFils : totals.subtotalFils, items: totals.itemCount });
    try { history.replaceState(history.state, '', GB.url('checkout/') + '?ref=' + encodeURIComponent(order.ref)); } catch (err) { /* ignore */ }
    renderDone(order, true);
    GB.emit('checkout:submitted', { ref: order.ref, url: msg.url });
    location.href = msg.url;
  });

  /* ---------------- "one last step" / sent states */
  function detailsHtml(o) {
    const c = o.customer || {};
    const items = (o.lines || []).map((l) => '<li class="gb-co-line"><span class="gb-co-line__qty"><span class="gb-sr">' + GB.esc(GB.t('common.qty')) + ' </span><bdi dir="ltr">' +
      GB.esc(l.qty) + '×</bdi></span><span class="gb-co-line__name">' + GB.cartUI.nameHtml(l.name) + (l.backorder ? ' ' + GB.cartUI.stock('backorder') : '') + '</span>' +
      '<span class="gb-co-line__total">' + GB.moneyHtml(l.lineFils) + '</span></li>').join('');
    const t = Object.assign({ itemCount: 0 }, o.totals || {});
    return '<section class="gb-panel gb-co-details" aria-labelledby="co-details-title"><h2 class="gb-co-h" id="co-details-title">' + GB.esc(GB.t('order.details')) + '</h2>' +
      '<h3 class="gb-co-sub">' + GB.esc(GB.t('order.items')) + '</h3><ul class="gb-co-lines" role="list">' + items + '</ul>' + GB.cartUI.totalsHtml(Object.assign({}, t, { itemCount: 0 })) +
      '<dl class="gb-co-facts"><div><dt>' + GB.esc(GB.t('order.deliverTo')) + '</dt><dd>' + GB.esc(c.name) + ' · <bdi dir="ltr">' + GB.esc(c.phone) + '</bdi><br>' +
      GB.esc(addressText(c)) + (c.notes ? '<br>' + GB.esc(c.notes) : '') + '</dd></div>' +
      '<div><dt>' + GB.esc(GB.t('order.payment')) + '</dt><dd>' + GB.esc(GB.t(PAY_KEYS[o.payment] || PAY_KEYS.cod)) + '</dd></div></dl></section>';
  }
  function renderDone(o, focus) {
    doneOrder = o;
    const box = $('co-done');
    const sent = o.status === 'sent';
    const reopen = '<a class="gb-btn ' + (sent ? 'gb-btn--light' : 'gb-btn--wa gb-btn--lg') + '" href="' + GB.esc(o.waUrl || GB.wa(o.message || '')) + '" target="_blank" rel="noopener">' +
      GB.icon('whatsapp') + '<span>' + GB.esc(GB.t('order.reopen')) + '</span><span class="gb-sr"> ' + GB.esc(GB.t('a11y.newTab')) + '</span></a>';
    const copy = '<button type="button" class="gb-btn gb-btn--light" data-action="checkout-copy">' + GB.icon('copy') + '<span>' + GB.esc(GB.t('order.copy')) + '</span></button>';
    let actions;
    if (sent) {
      actions = '<a class="gb-btn gb-btn--primary gb-btn--lg" href="' + GB.esc(GB.url('')) + '">' + GB.esc(GB.t('common.backHome')) + '</a>' + reopen + copy;
    } else {
      actions = reopen + copy +
        '<button type="button" class="gb-btn gb-btn--primary" data-action="checkout-sent" aria-describedby="co-sent-hint"><span>' + GB.esc(GB.t('order.markSent')) + '</span></button>';
    }
    box.innerHTML = '<div class="gb-panel gb-co-done__card' + (sent ? ' is-sent' : '') + '">' +
      '<span class="gb-co-done__icon" aria-hidden="true">' + GB.icon(sent ? 'check' : 'whatsapp') + '</span>' +
      '<h2 class="gb-co-done__title" id="co-done-title" tabindex="-1">' + GB.esc(GB.t(sent ? 'order.sentTitle' : 'order.doneTitle')) + '</h2>' +
      '<p class="gb-co-done__text">' + GB.esc(GB.t(sent ? 'order.sentText' : 'order.doneText')) + '</p>' +
      '<p class="gb-co-ref">' + GB.esc(GB.t('order.refLabel')) + ': <bdi dir="ltr"><strong>' + GB.esc(o.ref) + '</strong></bdi></p>' +
      (o.trimmed && !sent ? '<p class="gb-alert gb-co-trimmed">' + GB.icon('info') + '<span>' + GB.esc(GB.t('order.trimmed')) + '</span></p>' : '') +
      '<div class="gb-co-done__actions">' + actions + '</div>' +
      (sent ? '' : '<p class="gb-hint gb-co-done__hint" id="co-sent-hint">' + GB.esc(GB.t('order.markSentHint')) + '</p>') +
      '<div class="gb-co-copybox" id="co-copybox" hidden><label class="gb-label" for="co-copytext">' + GB.esc(GB.t('order.copyManual')) + '</label>' +
      '<textarea class="gb-textarea gb-co-copybox__text" id="co-copytext" readonly rows="10" aria-label="' + GB.esc(GB.t('order.copyFieldLabel')) + '"></textarea></div>' +
      '</div>' + detailsHtml(o);
    show('co-done');
    if (focus) focusEl($('co-done-title'));
  }
  GB.on('click', '[data-action="checkout-copy"]', (e) => {
    e.preventDefault();
    if (!doneOrder) return;
    const text = doneOrder.message || '';
    const manual = () => {
      const box = $('co-copybox');
      const ta = $('co-copytext');
      if (!box || !ta) return;
      box.hidden = false;
      ta.value = text;
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand && document.execCommand('copy'); } catch (err) { ok = false; }
      if (ok) GB.toast(GB.t('order.copied'));
    };
    if (navigator.clipboard && window.isSecureContext && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(() => GB.toast(GB.t('order.copied')), manual);
    } else manual();
  });
  GB.on('click', '[data-action="checkout-sent"]', (e) => {
    e.preventDefault();
    if (!doneOrder) return;
    GB.orders.markSent(doneOrder.ref);
    const o = GB.orders.get(doneOrder.ref) || Object.assign({}, doneOrder, { status: 'sent' });
    GB.cart.clear();
    renderDone(o, true);
  });

  /* ---------------- boot */
  let ref = null;
  let buy = null;
  try { const qs = new URLSearchParams(location.search); ref = qs.get('ref'); buy = qs.get('buy'); } catch (e) { ref = null; }
  // "Buy now" hand-off from a product page when storage is disabled: ?buy=<id>:<qty> (validated, then removed)
  if (buy && !ref) {
    const m = /^(\d{1,10}):(\d{1,2})$/.exec(buy);
    if (m && !GB.cart.has(m[1])) GB.cart.add(m[1], Number(m[2]));
    try { history.replaceState(history.state, '', GB.url('checkout/')); } catch (e) { /* ignore */ }
  }
  if (ref) {
    const o = GB.orders.get(ref);
    if (o && o.message) { renderDone(o, false); return; }
    GB.toast(GB.t('order.notFound'));
    try { history.replaceState(history.state, '', GB.url('checkout/')); } catch (e) { /* ignore */ }
  }
  if (!GB.cart.size()) { show('co-empty'); return; }
  show('co-main');
  prefill();
  loadSummary();
});

} catch (e) { console.error('[GB] src/js/31-checkout.js failed to initialise', e); }
/* ---- 32-wishlist.js ---- */
try {
/* 32-wishlist.js — cart module, part 3: the wishlist/ page (client-rendered from products.json + GB.wish).
   Move to cart (one / all available), remove, share the list on WhatsApp, empty state, retry on load failure.
   Actions owned here: wishlist-move, wishlist-move-all, wishlist-remove, wishlist-retry. */

GB.ready(() => {
  if (!document.body.classList.contains('page-wishlist')) return;
  const $ = (id) => document.getElementById(id);
  const list = $('wl-list'), empty = $('wl-empty'), boot = $('wl-boot'), tools = $('wl-tools'), count = $('wl-count'), share = $('wl-share');
  if (!list) return;
  const leadText = count ? count.textContent : '';
  let map = null;
  let batching = false;
  let focusAfter = null;

  function cardHtml(item) {
    const id = GB.esc(item.id);
    const name = GB.pname(item);
    const oos = item.a === 'out_of_stock';
    const pct = GB.discountPct(item.p, item.c);
    let action;
    if (oos) {
      const msg = GB.t('common.notifyMsg', { name, id: item.id, url: GB.abs(item.s) });
      action = '<a class="gb-btn gb-btn--notify" href="' + GB.esc(GB.wa(msg)) + '" target="_blank" rel="noopener" aria-label="' +
        GB.esc(GB.t('a11y.notify', { name }) + ' ' + GB.t('a11y.newTab')) + '">' + GB.icon('bell') + '<span>' + GB.esc(GB.t('common.notifyMeShort')) + '</span></a>';
    } else {
      action = '<button type="button" class="gb-btn gb-btn--add" data-action="wishlist-move" data-id="' + id + '" aria-label="' +
        GB.esc(GB.t('wishlist.moveLabel', { name })) + '">' + GB.icon('cart-plus') + '<span>' + GB.esc(GB.t('wishlist.move')) + '</span></button>';
    }
    return '<li class="gb-grid__item" data-id="' + id + '"><article class="gb-card gb-wl-card' + (oos ? ' is-oos' : '') + (pct ? ' is-sale' : '') + '" aria-labelledby="wl-pn-' + id + '">' +
      GB.cartUI.media(item, 'gb-card__media') +
      (pct ? '<div class="gb-card__flags"><span class="gb-flag gb-flag--sale">' + GB.esc(GB.t('price.off', { pct })) + '</span></div>' : '') +
      // remove sits where the heart sits on product cards (top corner of the photo), so "move" gets the full width
      '<button type="button" class="gb-wish gb-card__wish gb-wl-remove" data-action="wishlist-remove" data-id="' + id + '" aria-label="' +
      GB.esc(GB.t('a11y.wishRemove', { name })) + '">' + GB.icon('trash') + '</button>' +
      '<div class="gb-card__body">' + (item.b ? '<p class="gb-card__brand" dir="ltr">' + GB.esc(item.b) + '</p>' : '') +
      '<h2 class="gb-card__title" id="wl-pn-' + id + '"><a class="gb-card__link" href="' + GB.esc(GB.purl(item)) + '">' + GB.cartUI.nameHtml(name) + '</a></h2>' +
      GB.cartUI.price(item, 'sm') + GB.cartUI.stock(item.a, 'gb-card__stock') + '</div>' +
      '<div class="gb-card__actions gb-wl-actions">' + action +
'</div></article></li>';
  }

  /** wa.me share link (no number → the customer picks the chat). Kept under ~1900 chars. */
  function shareUrl(items) {
    const head = GB.t('wishlist.shareMsg');
    let text = head;
    let used = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      const add = '\n• ' + GB.pname(p) + ' — ' + GB.money(p.p) + '\n' + GB.abs(p.s);
      if (encodeURIComponent(text + add).length > 1750) break;
      text += add;
      used++;
    }
    if (used < items.length) text += '\n' + GB.t('wishlist.shareMore', { url: GB.abs('') });
    return 'https://wa.me/?text=' + encodeURIComponent(text);
  }

  function render() {
    if (!map || batching) return;
    const ids = GB.wish.sanitize(map);
    if (boot) boot.hidden = true;
    const items = ids.map((id) => map.get(id)).filter(Boolean);
    if (!items.length) {
      list.hidden = true; list.innerHTML = '';
      tools.hidden = true;
      empty.hidden = false;
      if (count) count.textContent = leadText;
    } else {
      empty.hidden = true;
      list.innerHTML = items.map(cardHtml).join('');
      list.hidden = false;
      tools.hidden = false;
      if (count) count.textContent = GB.t('common.products', { n: items.length });
      if (share) share.href = shareUrl(items);
      const moveAll = GB.$('[data-action="wishlist-move-all"]', tools);
      if (moveAll) moveAll.hidden = !items.some((p) => p.a !== 'out_of_stock');
      GB.ui.hydrate(list);
    }
    const f = focusAfter;
    focusAfter = null;
    if (f) {
      let el = null;
      for (let i = 0; i < f.length && !el; i++) el = GB.$(f[i]);
      el = el || $('wl-title');
      if (el) { try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); } }
    }
  }

  function load() {
    if (boot) {
      boot.hidden = false;
      boot.innerHTML = '<span class="gb-cart-spinner" aria-hidden="true"></span><span>' + GB.esc(GB.t('common.loading')) + '</span>';
    }
    GB.products().then((m) => { map = m; render(); }, () => {
      if (!boot) return;
      boot.innerHTML = '<span class="gb-alert gb-alert--error">' + GB.icon('alert') + '<span>' + GB.esc(GB.t('common.error')) + '</span></span>' +
        '<button type="button" class="gb-btn gb-btn--light" data-action="wishlist-retry">' + GB.icon('refresh') + '<span>' + GB.esc(GB.t('common.retry')) + '</span></button>';
    });
  }

  /** Selectors for the item after (or before) id, used to keep keyboard focus after it disappears. */
  function neighbourFocus(id, action) {
    const li = GB.$('#wl-list > li[data-id="' + id + '"]');
    const sib = li && (li.nextElementSibling || li.previousElementSibling);
    const sid = sib && sib.getAttribute('data-id');
    return sid ? ['#wl-list > li[data-id="' + sid + '"] [data-action="' + action + '"]', '#wl-list > li[data-id="' + sid + '"] [data-action="wishlist-remove"]'] : ['#wl-empty .gb-btn', '#wl-title'];
  }

  GB.listen('wish:change', render);

  GB.on('click', '[data-action="wishlist-move"]', (e, el) => {
    e.preventDefault();
    const id = el.getAttribute('data-id');
    const item = map && map.get(id);
    if (!item || item.a === 'out_of_stock') return;
    focusAfter = neighbourFocus(id, 'wishlist-move');
    GB.cart.add(id, 1, item.p);
    GB.track('add_to_cart', { id, qty: 1, value: item.p });
    GB.wish.remove(id);
    GB.toast(GB.t('wishlist.moved'), { action: { label: GB.t('common.viewCart'), onClick() { GB.dialog.open('gb-cart'); } } });
  });
  GB.on('click', '[data-action="wishlist-move-all"]', (e) => {
    e.preventDefault();
    if (!map) return;
    const ids = GB.wish.list().filter((id) => { const p = map.get(id); return p && p.a !== 'out_of_stock'; });
    if (!ids.length) return;
    batching = true;
    try {
      ids.forEach((id) => { const p = map.get(id); GB.cart.add(id, 1, p.p); GB.track('add_to_cart', { id, qty: 1, value: p.p }); GB.wish.remove(id); });
    } finally { batching = false; }
    focusAfter = ['#wl-list [data-action="wishlist-remove"]', '#wl-empty .gb-btn'];
    render();
    GB.toast(GB.t('wishlist.movedAll', { n: ids.length }), { action: { label: GB.t('common.viewCart'), onClick() { GB.dialog.open('gb-cart'); } } });
  });
  GB.on('click', '[data-action="wishlist-remove"]', (e, el) => {
    e.preventDefault();
    const id = el.getAttribute('data-id');
    focusAfter = neighbourFocus(id, 'wishlist-remove');
    GB.wish.remove(id);
    GB.toast(GB.t('common.wishRemoved'));
  });
  GB.on('click', '[data-action="wishlist-retry"]', (e) => { e.preventDefault(); load(); });

  if (!GB.wish.count()) {
    // nothing saved: no need to download products.json
    if (boot) boot.hidden = true;
    empty.hidden = false;
    GB.listen('wish:change', () => { if (!map && GB.wish.count()) load(); });
    return;
  }
  load();
});

} catch (e) { console.error('[GB] src/js/32-wishlist.js failed to initialise', e); }
/* ---- 40-product.js ---- */
try {
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

} catch (e) { console.error('[GB] src/js/40-product.js failed to initialise', e); }
/* ---- 41-catalog.js ---- */
try {
/* 41-catalog.js — catalog module, part 1: product listings.
     GB.catalog.listing(root, opts)  sort/filter engine over a grid of product cards (data-* attributes):
                                     ?sort=best|price-asc|price-desc|discount &stock=1 &sale=1 &brand=A,B &cat=<id>
                                     URL query state (pushState on change, restored on load and back/forward),
                                     live result count, facet counts on chips, empty-filter state + reset.
     GB.catalog.card(item, opts)     client mirror of the server productCard() for compact products.json items
     GB.catalog.price(item)          client mirror of priceBlock() (size sm)
     GB.catalog.toolbar(items, opts) client mirror of renderToolbar() in src/pages/category.mjs
     GB.catalog.meta()               Promise<search/meta.json | null> (featured/new ids, category names + icons)
     GB.catalog.cats()               [{ id, name, icon, url }] in display order (meta or the #gb-menu dialog)
   Category pages (body.page-category) are wired automatically. Contract: src/CONTRACTS.md §7. */

const CATALOG_SORTS = [['best', 'catalog.sortBest'], ['price-asc', 'catalog.sortPriceAsc'], ['price-desc', 'catalog.sortPriceDesc'], ['discount', 'catalog.sortDiscount']];
const CATALOG_ICON_FALLBACK = GB.cfg.catIcons || {};

GB.catalog = GB.catalog || {};

/* ------------------------------------------------------------------ URL state */
function catalogParse(search) {
  let q;
  try { q = new URLSearchParams(search || ''); } catch (e) { q = new URLSearchParams(''); }
  const sortRaw = q.get('sort');
  const sort = CATALOG_SORTS.some((s) => s[0] === sortRaw) ? sortRaw : 'best';
  const brands = (q.get('brand') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  return {
    sort,
    stock: q.get('stock') === '1',
    sale: q.get('sale') === '1',
    brands,
    cat: String(q.get('cat') || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40),
  };
}
GB.catalog.parse = catalogParse;

/** Write state into the current URL (keeps unrelated params such as q / src). */
function catalogWriteUrl(state, push) {
  let params;
  try { params = new URLSearchParams(location.search); } catch (e) { return; }
  const put = (k, v) => { if (v) params.set(k, v); else params.delete(k); };
  put('sort', state.sort !== 'best' ? state.sort : '');
  put('stock', state.stock ? '1' : '');
  put('sale', state.sale ? '1' : '');
  put('brand', state.brands.length ? state.brands.join(',') : '');
  put('cat', state.cat || '');
  const qs = params.toString();
  const url = location.pathname + (qs ? '?' + qs : '') + location.hash;
  if (url === location.pathname + location.search + location.hash) return;
  try { history[push ? 'pushState' : 'replaceState']({ gbCatalog: 1 }, '', url); } catch (e) { /* sandboxed / file: */ }
  GB.catalog.syncLang();
}
GB.catalog.writeUrl = catalogWriteUrl;

/** Language-switch links carry the current listing/search query to the counterpart page. */
GB.catalog.syncLang = function () {
  let qs = '';
  try {
    const p = new URLSearchParams(location.search);
    p.delete('src'); p.delete('utm_source');
    qs = p.toString();
  } catch (e) { qs = ''; }
  GB.$$('a[data-lang-switch]').forEach((a) => {
    if (!a.hasAttribute('data-href-base')) a.setAttribute('data-href-base', (a.getAttribute('href') || '').split('?')[0]);
    a.setAttribute('href', a.getAttribute('data-href-base') + (qs ? '?' + qs : ''));
  });
};

/* ------------------------------------------------------------------ listing engine */
const AVAIL_GROUP = (it) => (it.avail === 'out_of_stock' ? 1 : 0);
const SORTERS = {
  best: (a, b) => a.i - b.i,
  'price-asc': (a, b) => AVAIL_GROUP(a) - AVAIL_GROUP(b) || a.price - b.price || a.i - b.i,
  'price-desc': (a, b) => AVAIL_GROUP(a) - AVAIL_GROUP(b) || b.price - a.price || a.i - b.i,
  discount: (a, b) => AVAIL_GROUP(a) - AVAIL_GROUP(b) || b.off - a.off || a.i - b.i,
};

/**
 * GB.catalog.listing(root, { countText(shown, total, filtered) → string, onChange(state) }) → controller
 * root must contain: .gb-grid (li.gb-grid__item > article.gb-card[data-*]), optional [data-toolbar] with
 * [data-sort] select, [data-filter=stock|sale|brand|cat][data-value] chips, [data-filter-reset],
 * [data-listing-count], and [data-listing-empty]. Event listeners are delegated on root, so the content may be
 * re-rendered later (call controller.scan()).
 */
GB.catalog.listing = function (root, opts) {
  const o = opts || {};
  const c = {
    root,
    state: catalogParse(location.search),
    items: [],
    brandValues: new Set(),
    catValues: new Set(),
    scan() {
      c.items = GB.$$('.gb-grid > .gb-grid__item', root).map((li, i) => {
        const a = li.querySelector('.gb-card') || li;
        const d = a.dataset || {};
        return { li, i, id: d.id, price: Number(d.price) || 0, off: Number(d.off) || 0, avail: d.avail || 'in_stock', brand: d.brand || '', cat: d.cat || '' };
      });
      c.grid = GB.$('.gb-grid', root);
      c.brandValues = new Set(GB.$$('[data-filter="brand"]', root).map((b) => b.getAttribute('data-value')));
      c.catValues = new Set(GB.$$('[data-filter="cat"]', root).map((b) => b.getAttribute('data-value')).filter(Boolean));
      return c;
    },
    /** Active (sanitised) filters. */
    active() {
      const s = c.state;
      return {
        stock: s.stock && !!GB.$('[data-filter="stock"]', root),
        sale: s.sale && !!GB.$('[data-filter="sale"]', root),
        brands: s.brands.filter((b) => c.brandValues.has(b)),
        cat: c.catValues.has(s.cat) ? s.cat : '',
      };
    },
    apply() {
      const f = c.active();
      const pass = (it, skip) => (skip === 'stock' || !f.stock || it.avail === 'in_stock') &&
        (skip === 'sale' || !f.sale || it.off > 0) &&
        (skip === 'brand' || !f.brands.length || f.brands.indexOf(it.brand) >= 0) &&
        (skip === 'cat' || !f.cat || it.cat === f.cat);
      const filtered = !!(f.stock || f.sale || f.brands.length || f.cat);
      let shown = 0;
      c.items.forEach((it) => { const v = pass(it); it.li.hidden = !v; if (v) shown++; });

      // order (stable; only touch the DOM when it changes)
      if (c.grid) {
        const sorted = c.items.slice().sort(SORTERS[c.state.sort] || SORTERS.best);
        const cur = Array.prototype.slice.call(c.grid.children);
        if (sorted.some((it, k) => cur[k] !== it.li)) {
          const frag = document.createDocumentFragment();
          sorted.forEach((it) => frag.appendChild(it.li));
          c.grid.appendChild(frag);
        }
      }

      // controls
      const sel = GB.$('[data-sort]', root);
      if (sel && sel.value !== c.state.sort) sel.value = c.state.sort;
      GB.$$('[data-filter]', root).forEach((b) => {
        const kind = b.getAttribute('data-filter');
        const val = b.getAttribute('data-value') || '';
        let on = false, n = null;
        if (kind === 'stock') on = f.stock;
        else if (kind === 'sale') on = f.sale;
        else if (kind === 'brand') { on = f.brands.indexOf(val) >= 0; n = c.items.filter((it) => it.brand === val && pass(it, 'brand')).length; }
        else if (kind === 'cat') { on = val ? f.cat === val : !f.cat; n = c.items.filter((it) => (!val || it.cat === val) && pass(it, 'cat')).length; }
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (n !== null) {
          const nEl = b.querySelector('.gb-catalog-chip__n');
          if (nEl && nEl.textContent !== String(n)) nEl.textContent = String(n);
          b.classList.toggle('is-zero', n === 0 && !on);
        }
      });
      GB.$$('.gb-catalog-reset', root).forEach((b) => { b.hidden = !filtered; });
      const empty = GB.$('[data-listing-empty]', root);
      if (empty) empty.hidden = shown > 0;
      const countEl = GB.$('[data-listing-count]', root);
      if (countEl) {
        const total = c.items.length;
        const txt = o.countText ? o.countText(shown, total, filtered)
          : (filtered ? (shown ? GB.t('catalog.filteredCount', { shown, total }) : GB.t('catalog.noneShown')) : GB.t('common.products', { n: total }));
        if (countEl.textContent !== txt) countEl.textContent = txt;
      }
      c.shown = shown;
      if (typeof o.onChange === 'function') o.onChange(c.state, shown);
      return c;
    },
    /** Merge a patch into the state, apply it, and (push=true) record it in history. */
    set(patch, push) {
      c.state = Object.assign({}, c.state, patch || {});
      c.apply();
      if (push !== undefined && push !== null) catalogWriteUrl(c.state, !!push);
      return c;
    },
    /** Re-read state from the URL (load / popstate). */
    fromUrl() { c.state = catalogParse(location.search); return c.apply(); },
  };

  GB.on('click', '[data-filter]', (e, b) => {
    e.preventDefault();
    const kind = b.getAttribute('data-filter');
    const val = b.getAttribute('data-value') || '';
    const f = c.active();
    if (kind === 'stock') c.set({ stock: !f.stock }, true);
    else if (kind === 'sale') c.set({ sale: !f.sale }, true);
    else if (kind === 'brand') {
      const list = f.brands.slice();
      const k = list.indexOf(val);
      if (k >= 0) list.splice(k, 1); else list.push(val);
      c.set({ brands: list }, true);
    } else if (kind === 'cat') c.set({ cat: val && f.cat !== val ? val : '' }, true);
  }, root);
  GB.on('click', '[data-filter-reset]', (e) => {
    e.preventDefault();
    c.set({ stock: false, sale: false, brands: [], cat: '' }, true);
    const first = GB.$('[data-sort]', root) || GB.$('[data-filter]', root);
    // the reset control disappears once filters are cleared: keep keyboard focus inside the toolbar
    if (first && document.activeElement && (document.activeElement === document.body || !root.contains(document.activeElement) || document.activeElement.hidden || document.activeElement.closest('[hidden]'))) {
      try { first.focus({ preventScroll: true }); } catch (err) { first.focus(); }
    }
  }, root);
  GB.on('change', '[data-sort]', (e, sel) => { c.set({ sort: sel.value }, true); }, root);

  c.scan();
  return c;
};

/** Bring a chip into view inside its horizontal scroll row (direction-agnostic, never scrolls the page). */
GB.catalog.revealChip = function (chip) {
  const row = chip && chip.closest('.gb-chips--scroll');
  if (!row) return;
  const r = row.getBoundingClientRect(), b = chip.getBoundingClientRect();
  const pad = 24;
  if (b.left < r.left + pad) row.scrollBy({ left: b.left - r.left - pad });
  else if (b.right > r.right - pad) row.scrollBy({ left: b.right - r.right + pad });
};

/* ------------------------------------------------------------------ meta (search/meta.json) + categories */
let catalogMetaPromise = null;
GB.catalog.meta = function () {
  if (!catalogMetaPromise) {
    catalogMetaPromise = fetch(GB.asset('search/meta.json') + '?v=' + encodeURIComponent(GB.cfg.publishId || ''), { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!m || !Array.isArray(m.cats)) return null;
        m.featuredSet = new Set((m.featured || []).map(String));
        m.freshSet = new Set((m.fresh || []).map(String));
        m.catMap = new Map(m.cats.map((cat) => [cat.id, cat]));
        GB.catalog.metaData = m;
        return m;
      })
      .catch(() => null);
  }
  return catalogMetaPromise;
};
function catIcon(id) {
  const m = GB.catalog.metaData;
  const c = m && m.catMap.get(id);
  return (c && c.icon) || CATALOG_ICON_FALLBACK[id] || 'bundle';
}
/** Categories in display order: [{ id, name, icon, url }]. Uses meta when loaded, else the #gb-menu dialog. */
GB.catalog.cats = function () {
  const m = GB.catalog.metaData;
  if (m) return m.cats.map((c) => ({ id: c.id, name: (c.n && (c.n[GB.locale] || c.n.ar)) || c.id, icon: c.icon, url: GB.url('c/' + c.id + '/') }));
  return GB.$$('#gb-menu .gb-menu__item:not(.gb-menu__item--all)').map((a) => {
    const mm = /\/c\/([a-z0-9-]+)\/$/.exec(a.getAttribute('href') || '');
    if (!mm) return null;
    const nameEl = a.querySelector('.gb-menu__name');
    return { id: mm[1], name: nameEl ? nameEl.textContent : mm[1], icon: catIcon(mm[1]), url: a.getAttribute('href') };
  }).filter(Boolean);
};

/* ------------------------------------------------------------------ client card markup (shared foundation renderer GB.ui.card) */
GB.catalog.nameHtml = function (item, inner) { return GB.ui.nameHtml(item, inner); };
GB.catalog.art = function (cat, cls) { return GB.ui.art(cat, cls); };
/** Inline (<span>) media box for list rows inside links (overlay results); cards use GB.ui.media. */
GB.catalog.media = function (item, cls) {
  const src = item.img ? GB.img(item.img) : '';
  return '<span class="gb-media' + (src ? '' : ' is-empty') + (cls ? ' ' + GB.esc(cls) : '') + '">' + GB.ui.art(item.cat, 'gb-media__ph') +
    (src ? '<img class="gb-media__img" src="' + GB.esc(src) + '" alt="" width="800" height="800" loading="lazy" decoding="async">' : '') + '</span>';
};
GB.catalog.price = function (item, size) { return GB.ui.price(item, size); };
GB.catalog.stock = function (availability, cls) { return GB.ui.stock(availability, cls); };
/** GB.catalog.card(item, { level = 3, idSuffix, nameHtml }) — alias of the foundation GB.ui.card(). */
GB.catalog.card = function (item, opts) { return GB.ui.card(item, opts); };

/** Client mirror of renderToolbar() (src/pages/category.mjs) for compact items (no category chips). */
GB.catalog.toolbar = function (items) {
  const brandCounts = new Map();
  items.forEach((it) => { if (it.b) brandCounts.set(it.b, (brandCounts.get(it.b) || 0) + 1); });
  const brands = Array.from(brandCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const hasNonStock = items.some((it) => it.a !== 'in_stock');
  const hasSale = items.some((it) => it.c);
  const check = GB.icon('check', 'gb-catalog-chip__check');
  const chips = [];
  if (hasNonStock) chips.push('<button type="button" class="gb-chip" data-filter="stock" aria-pressed="false">' + check + '<span>' + GB.esc(GB.t('catalog.inStock')) + '</span></button>');
  if (hasSale) chips.push('<button type="button" class="gb-chip" data-filter="sale" aria-pressed="false">' + check + '<span>' + GB.esc(GB.t('catalog.onSale')) + '</span></button>');
  let brandHtml = '';
  if (brands.length >= 2) {
    brandHtml = (chips.length ? '<span class="gb-catalog-sep" aria-hidden="true"></span>' : '') + '<span class="gb-catalog-brands" role="group" aria-label="' + GB.esc(GB.t('catalog.brand')) + '">' +
      brands.map((b) => '<button type="button" class="gb-chip" data-filter="brand" data-value="' + GB.esc(b[0]) + '" aria-pressed="false"><span dir="ltr">' + GB.esc(b[0]) +
        '</span> <span class="gb-catalog-chip__n">' + b[1] + '</span></button>').join('') + '</span>';
  }
  const any = chips.length || brands.length >= 2;
  return '<div class="gb-catalog-toolbar" data-toolbar><div class="gb-catalog-bar">' +
    '<p class="gb-catalog-count" data-listing-count aria-live="polite" aria-atomic="true"></p>' +
    '<div class="gb-catalog-sort">' + GB.icon('sort') + '<label for="catalog-sort">' + GB.esc(GB.t('catalog.sortLabel')) + '</label><select id="catalog-sort" class="gb-select" data-sort>' +
    CATALOG_SORTS.map((s) => '<option value="' + s[0] + '"' + (s[0] === 'best' ? ' selected' : '') + '>' + GB.esc(GB.t(s[1])) + '</option>').join('') + '</select></div></div>' +
    (any ? '<div class="gb-catalog-filters" role="group" aria-label="' + GB.esc(GB.t('catalog.filters')) + '"><div class="gb-chips gb-chips--scroll gb-catalog-chips">' +
      '<button type="button" class="gb-chip gb-catalog-reset" data-filter-reset hidden>' + GB.icon('x') + '<span>' + GB.esc(GB.t('catalog.reset')) + '</span></button>' +
      chips.join('') + brandHtml + '</div></div>' : '') + '</div>';
};

/* ------------------------------------------------------------------ category pages (c/<id>/ and c/all/) */
GB.ready(() => {
  if (!document.body.classList.contains('page-category')) return;
  const root = GB.$('[data-listing]');
  if (!root) return;
  const ctl = GB.catalog.listing(root);
  GB.catalog.current = ctl;
  ctl.fromUrl();
  catalogWriteUrl(Object.assign({}, ctl.state, ctl.active()), false); // canonicalise the query (drops unknown/invalid values)
  GB.catalog.syncLang();
  const pressedCat = GB.$('[data-filter="cat"][aria-pressed="true"]', root);
  if (pressedCat && pressedCat.getAttribute('data-value')) GB.catalog.revealChip(pressedCat);
  window.addEventListener('popstate', () => {
    ctl.fromUrl();
    GB.catalog.syncLang();
    const pc = GB.$('[data-filter="cat"][aria-pressed="true"]', root);
    if (pc) GB.catalog.revealChip(pc);
  });
  // mark the current category in the categories dialog
  const here = location.pathname.replace(/index\.html$/, '');
  GB.$$('#gb-menu .gb-menu__item').forEach((a) => {
    if ((a.getAttribute('href') || '') === here) a.setAttribute('aria-current', 'page');
  });
});

} catch (e) { console.error('[GB] src/js/41-catalog.js failed to initialise', e); }
/* ---- 42-search.js ---- */
try {
/* 42-search.js — catalog module, part 2: search.
     GB.search.norm(s)          Arabic/Latin normalisation (SPEC §8): strip tashkeel + tatweel, أإآٱ→ا, ة→ه, ى→ي,
                                ؤ→و, ئ→ي, Arabic-Indic/Persian digits → Latin, lowercase, punctuation → space,
                                collapse spaces.
     GB.search.ready()          Promise — products.json (+ optional search/meta.json) indexed
     GB.search.query(q)         [{ item, … }] ranked: exact phrase › name starts with the first word › in stock ›
                                featured › more words matched in the name itself › default catalogue order.
                                Every query word must prefix-match a word of name.ar / name.en / brand (+ Arabic
                                spellings) / category names (+ a small synonym table) — AND semantics.
     GB.search.highlight(text, q) → safe HTML with <mark> around matched word prefixes
     GB.search.recent           recent searches (storage key gbq8:v2:searches, max 6)
   Header overlay: fills #gb-search-body inside the foundation's #gb-search dialog (instant top 8; Enter submits
   the dialog's GET form to search/?q=). Search page (body.page-search): results grid + GB.catalog listing. */

GB.search = GB.search || {};

/* ------------------------------------------------------------------ normalisation */
const S_DROP = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ​-‏‪-‮⁦-⁩]/;
const S_MAP = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ؤ': 'و', 'ئ': 'ي', 'ی': 'ي', 'ک': 'ك' };
let S_WORD;
try { S_WORD = new RegExp('[\\p{L}\\p{N}]', 'u'); } catch (e) { S_WORD = /[0-9A-Za-zÀ-ɏ؀-ۿ]/; }

/** Normalise and keep a map from every output char to its source index (used for highlighting). */
function normMap(input) {
  const s = String(input || '');
  let t = '';
  const map = [];
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    const code = s.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) { i++; ch = ' '; } // astral (emoji…) → separator
    else if (S_DROP.test(ch)) continue;
    else if (S_MAP[ch]) ch = S_MAP[ch];
    else if (code >= 0x0660 && code <= 0x0669) ch = String(code - 0x0660);
    else if (code >= 0x06F0 && code <= 0x06F9) ch = String(code - 0x06F0);
    else { ch = ch.toLowerCase(); if (ch.length !== 1) ch = ch.charAt(0); }
    if (ch !== ' ' && !S_WORD.test(ch)) ch = ' ';
    if (ch === ' ' && (!t || t.charAt(t.length - 1) === ' ')) continue;
    t += ch;
    map.push(i);
  }
  if (t.charAt(t.length - 1) === ' ') { t = t.slice(0, -1); map.pop(); }
  return { t, map };
}
const norm = (s) => normMap(s).t;
GB.search.norm = norm;

/** Arabic proclitic article variants: الشنط → شنط, للايباد → ايباد, والسماعات → سماعات. */
function stripAl(w) {
  if (w.length >= 5 && /^(وال|بال|فال|كال)/.test(w)) return w.slice(3);
  if (w.length >= 4 && /^(ال|لل)/.test(w)) return w.slice(2);
  return '';
}

/* ------------------------------------------------------------------ synonyms (index-side expansion) */
// A product word equal to any member of a group also indexes every other member of that group.
const S_GROUPS = [
  ['ادبتر', 'ادابتر', 'محول', 'adapter', 'adaptor', 'وصله', 'توصيله', 'dongle'],
  ['مروحه', 'مراوح', 'تبريد', 'مبرد', 'مبردات', 'fan', 'fans', 'cooler', 'cooling'],
  ['سماعه', 'سماعات', 'هيدسيت', 'headset', 'headsets', 'headphones', 'earbuds', 'earphones'],
  ['كيبل', 'كيبيل', 'كابل', 'cable', 'cables'],
  ['شاحن', 'شواحن', 'charger', 'chargers'],
  ['ستاند', 'استاند', 'حامل', 'stand', 'stands', 'holder'],
  ['قفاز', 'قفازات', 'جلفز', 'gloves', 'sleeves'],
  ['كفر', 'كفرات', 'مسكه', 'مسكات', 'جراب', 'case', 'cases', 'cover', 'grip'],
  ['ازرار', 'شفت', 'شفتات', 'تريجر', 'trigger', 'triggers'],
  ['يده', 'يدات', 'قير', 'جوستك', 'كنترولر', 'controller', 'controllers', 'gamepad'],
  ['ايباد', 'ايبادات', 'تابلت', 'ipad', 'tablet'],
  ['ايفون', 'iphone'],
  ['تايب', 'type'],
  ['شنطه', 'شنط', 'حقيبه', 'bag', 'bags'],
  ['ببجي', 'pubg'],
];
// Arabic (and spaced) spellings of brands, keyed by the normalised brand.
const S_BRANDS = {
  piva: ['بيفا'],
  plextone: ['بلكستون', 'بليكستون', 'بلاكستون'],
  memo: ['ميمو'],
  hyperx: ['هايبراكس', 'هايبركس', 'هايبر اكس', 'hyper x'],
  flydigi: ['فلاي ديجي', 'فلاي دي جي', 'fly digi'],
  gamesir: ['جيم سير', 'جيمسير', 'جيمسر', 'game sir'],
  ugreen: ['يوقرين', 'يوجرين'],
  redmagic: ['ريد ماجيك', 'ريد مجيك', 'ردمجيك', 'red magic'],
  'gameboss q8': ['جيم بوس', 'game boss'],
  sarafox: ['سارافوكس'],
};
let S_SYN = null;
function synonyms() {
  if (S_SYN) return S_SYN;
  S_SYN = new Map();
  S_GROUPS.forEach((g) => {
    const ng = g.map(norm);
    ng.forEach((w) => S_SYN.set(w, ng));
  });
  return S_SYN;
}

/* ------------------------------------------------------------------ index */
let S_INDEX = null, S_CATS = [], S_READY = null;
function addWords(set, text, joinPairs) {
  const ws = text.split(' ').filter(Boolean);
  ws.forEach((w, k) => {
    set.add(w);
    const s = stripAl(w);
    if (s) set.add(s);
    if (joinPairs && k) set.add(ws[k - 1] + w);
  });
}
function expand(set) {
  const syn = synonyms();
  Array.from(set).forEach((w) => { const g = syn.get(w); if (g) g.forEach((x) => addWords(set, x, true)); });
}
function catNames(id) {
  const m = GB.catalog && GB.catalog.metaData;
  const c = m && m.catMap.get(id);
  if (c) return [c.n.ar, c.n.en];
  const local = S_CATS.find((x) => x.id === id);
  return local ? [local.name] : [];
}
function buildIndex(map) {
  const meta = GB.catalog && GB.catalog.metaData;
  S_CATS = GB.catalog.cats();
  S_INDEX = [];
  let i = 0;
  map.forEach((item) => {
    const nAr = norm(item.n && item.n.ar), nEn = norm(item.n && item.n.en);
    const words = new Set();
    addWords(words, nAr, true);
    addWords(words, nEn, true);
    if (item.b) {
      const b = norm(item.b);
      addWords(words, b, true);
      (S_BRANDS[b] || []).forEach((a) => addWords(words, norm(a), true));
    }
    catNames(item.cat).forEach((n) => addWords(words, norm(n), false));
    expand(words);
    S_INDEX.push({
      item, i: i++, nAr, nEn,
      names: ' ' + nAr + ' ' + nEn + ' ',
      hay: ' ' + Array.from(words).join(' ') + ' ',
      rank: item.a === 'in_stock' ? 0 : (item.a === 'backorder' ? 1 : 2),
      featured: item.f || (meta && meta.featuredSet.has(String(item.id))) ? 1 : 0,
    });
  });
  // categories (for "matching categories" suggestions)
  S_CATS.forEach((c) => {
    const words = new Set();
    catNames(c.id).concat([c.name]).forEach((n) => addWords(words, norm(n), true));
    expand(words);
    c.hay = ' ' + Array.from(words).join(' ') + ' ';
  });
  return S_INDEX;
}
GB.search.ready = function () {
  if (!S_READY) {
    S_READY = Promise.all([GB.products(), GB.catalog.meta()]).then((r) => buildIndex(r[0]));
    S_READY.catch(() => { S_READY = null; }); // allow a retry
  }
  return S_READY;
};

function tokens(q) {
  const qn = norm(q);
  return { qn, toks: qn ? qn.split(' ').map((t) => ({ t, s: stripAl(t) })) : [] };
}
const hit = (hay, tk) => hay.indexOf(' ' + tk.t) >= 0 || (!!tk.s && hay.indexOf(' ' + tk.s) >= 0);

/** Ranked matches for q (requires GB.search.ready() to have resolved). */
GB.search.query = function (q) {
  if (!S_INDEX) return [];
  const { qn, toks } = tokens(q);
  if (!toks.length) return [];
  const out = [];
  for (const e of S_INDEX) {
    let ok = true;
    for (const tk of toks) { if (!hit(e.hay, tk)) { ok = false; break; } }
    if (!ok) continue;
    const exact = (' ' + e.nAr).indexOf(' ' + qn) >= 0 || (' ' + e.nEn).indexOf(' ' + qn) >= 0 ? 1 : 0;
    const start = e.nAr.indexOf(toks[0].t) === 0 || e.nEn.indexOf(toks[0].t) === 0 ? 1 : 0;
    let direct = 0;
    toks.forEach((tk) => { if (hit(e.names, tk)) direct++; });
    out.push({ item: e.item, e, exact, start, direct });
  }
  out.sort((a, b) => (b.exact - a.exact) || (b.start - a.start) || (a.e.rank - b.e.rank) || (b.e.featured - a.e.featured) || (b.direct - a.direct) || (a.e.i - b.e.i));
  return out;
};
/** Categories whose names match every word of q. */
GB.search.categories = function (q) {
  const { toks } = tokens(q);
  if (!toks.length) return [];
  return S_CATS.filter((c) => c.hay && toks.every((tk) => hit(c.hay, tk)));
};

/** Safe HTML of text with <mark> around the word prefixes matched by q. */
GB.search.highlight = function (text, q) {
  const src = String(text || '');
  const { toks } = tokens(q);
  if (!toks.length) return GB.esc(src);
  const { t, map } = normMap(src);
  const ranges = [];
  const isStart = (k) => k === 0 || t.charAt(k - 1) === ' ';
  toks.forEach((tk) => {
    [tk.t, tk.s].filter(Boolean).forEach((w) => {
      let k = t.indexOf(w);
      while (k >= 0) {
        // word start, or right after a proclitic article at the word start (التبريد ← تبريد)
        const art = k >= 2 && /^(ال|لل)$/.test(t.slice(k - 2, k)) && isStart(k - 2);
        const art3 = k >= 3 && /^(وال|بال|فال|كال)$/.test(t.slice(k - 3, k)) && isStart(k - 3);
        if (isStart(k) || art || art3) ranges.push([map[k], map[k + w.length - 1] + 1]);
        k = t.indexOf(w, k + 1);
      }
    });
  });
  if (!ranges.length) return GB.esc(src);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  ranges.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice());
  });
  let html = '', pos = 0;
  merged.forEach((r) => {
    html += GB.esc(src.slice(pos, r[0])) + '<mark class="gb-search-hl">' + GB.esc(src.slice(r[0], r[1])) + '</mark>';
    pos = r[1];
  });
  return html + GB.esc(src.slice(pos));
};

/* ------------------------------------------------------------------ recent searches */
const RECENT_MAX = 6;
GB.search.recent = {
  list() {
    const v = GB.storage.get('searches', []);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, RECENT_MAX) : [];
  },
  add(q) {
    const v = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (norm(v).length < 2) return;
    const n = norm(v);
    const list = [v].concat(GB.search.recent.list().filter((x) => norm(x) !== n)).slice(0, RECENT_MAX);
    GB.storage.set('searches', list);
  },
  clear() { GB.storage.remove('searches'); },
};

/* ------------------------------------------------------------------ shared markup */
const searchUrl = (q) => GB.url('search/') + (q ? '?q=' + encodeURIComponent(q) : '');
function recentHtml(headingLevel) {
  const list = GB.search.recent.list();
  if (!list.length) return '';
  const h = 'h' + headingLevel;
  return '<div class="gb-search-block gb-search-block--recent"><div class="gb-search-block__head"><' + h + ' class="gb-search-block__title">' + GB.esc(GB.t('search.recent')) + '</' + h + '>' +
    '<button type="button" class="gb-search-clear" data-action="search-clear-recent" aria-label="' + GB.esc(GB.t('search.clearRecentLabel')) + '">' + GB.esc(GB.t('search.clearRecent')) + '</button></div>' +
    '<ul class="gb-chips gb-search-chips" role="list">' + list.map((q) => '<li><a class="gb-chip" href="' + GB.esc(searchUrl(q)) + '" data-search-recent="' + GB.esc(q) + '">' +
      GB.icon('clock') + '<bdi>' + GB.esc(q) + '</bdi></a></li>').join('') + '</ul></div>';
}
function catChipsHtml(cats, titleKey, headingLevel) {
  if (!cats.length) return '';
  const h = 'h' + headingLevel;
  return '<div class="gb-search-block"><' + h + ' class="gb-search-block__title">' + GB.esc(GB.t(titleKey)) + '</' + h + '>' +
    '<ul class="gb-chips gb-search-chips" role="list">' + cats.map((c) => '<li><a class="gb-chip gb-search-catchip" href="' + GB.esc(c.url) + '">' +
      GB.catalog.art(c.id, 'gb-search-catchip__art') + '<span>' + GB.esc(c.name) + '</span></a></li>').join('') + '</ul></div>';
}
function noResultsHtml(q, headingLevel) {
  const h = 'h' + headingLevel;
  return '<div class="gb-empty gb-search-none">' + GB.icon('search', 'gb-empty__icon') +
    '<' + h + ' class="gb-empty__title">' + GB.esc(GB.t('search.noResultsTitle', { q })) + '</' + h + '>' +
    '<p class="gb-empty__text">' + GB.esc(GB.t('search.noResultsText')) + '</p>' +
    '<div class="gb-empty__actions"><a class="gb-btn gb-btn--wa" href="' + GB.esc(GB.wa(GB.t('search.askWaMsg', { q }))) + '" target="_blank" rel="noopener">' +
    GB.icon('whatsapp') + '<span>' + GB.esc(GB.t('search.askWa')) + '</span><span class="gb-sr"> ' + GB.esc(GB.t('a11y.newTab')) + '</span></a></div></div>';
}
function errorHtml() {
  return '<div class="gb-alert gb-alert--error gb-search-error" role="alert">' + GB.icon('alert') + '<span>' + GB.esc(GB.t('common.error')) + '</span>' +
    '<button type="button" class="gb-btn gb-btn--light" data-action="search-retry">' + GB.icon('refresh') + '<span>' + GB.esc(GB.t('common.retry')) + '</span></button></div>';
}
function track(q, n) {
  GB.track('search', { q: q.slice(0, 60), n });
  if (!n) GB.track('search_no_results', { q: q.slice(0, 60) });
}

/* ------------------------------------------------------------------ header overlay (#gb-search) */
const OVERLAY_TOP = 8;
GB.ready(() => {
  const dialog = document.getElementById('gb-search');
  const body = document.getElementById('gb-search-body');
  const input = document.getElementById('gb-search-input');
  const form = document.getElementById('gb-search-form');
  if (!dialog || !body || !input || !form) return;

  body.innerHTML = '<p class="gb-search-status" id="gb-search-status" role="status" aria-live="polite" aria-atomic="true"></p><div class="gb-search-panel" id="gb-search-panel"></div>';
  const status = document.getElementById('gb-search-status');
  const panel = document.getElementById('gb-search-panel');
  input.setAttribute('aria-describedby', 'gb-search-status');
  let timer = 0, trackTimer = 0, lastTracked = '', seq = 0;

  const setStatus = (txt) => { if (status.textContent !== txt) status.textContent = txt; };
  function idle() {
    setStatus('');
    panel.innerHTML = recentHtml(3) + catChipsHtml(GB.catalog.cats(), 'search.browseCats', 3);
  }
  function render() {
    const q = input.value;
    const qn = norm(q);
    clearTimeout(trackTimer);
    if (!qn) { idle(); return; }
    if (qn.length < 2 && !/\d/.test(qn)) { setStatus(GB.t('search.minChars')); panel.innerHTML = recentHtml(3); return; }
    const my = ++seq;
    if (!S_INDEX) {
      setStatus(GB.t('common.loading'));
      panel.setAttribute('aria-busy', 'true');
      GB.search.ready().then(() => { panel.removeAttribute('aria-busy'); if (my === seq) render(); })
        .catch(() => { panel.removeAttribute('aria-busy'); if (my === seq) { setStatus(''); panel.innerHTML = errorHtml(); } });
      return;
    }
    const res = GB.search.query(q);
    const cats = GB.search.categories(q).slice(0, 3);
    const n = res.length;
    setStatus(GB.t('search.results', { n }));
    if (!n) {
      panel.innerHTML = noResultsHtml(q.trim(), 3) + catChipsHtml(cats.length ? cats : GB.catalog.cats(), cats.length ? 'search.catMatches' : 'search.browseCats', 3);
    } else {
      panel.innerHTML = catChipsHtml(cats, 'search.catMatches', 3) +
        '<div class="gb-search-block"><h3 class="gb-search-block__title gb-sr">' + GB.esc(GB.t('search.products')) + '</h3><ul class="gb-search-list" role="list">' +
        res.slice(0, OVERLAY_TOP).map((r) => itemRow(r.item, q)).join('') + '</ul></div>' +
        '<a class="gb-btn gb-btn--light gb-btn--block gb-search-all" href="' + GB.esc(searchUrl(q.trim())) + '">' + GB.esc(GB.t('search.viewAll', { n })) + GB.icon('arrow-forward') + '</a>';
      GB.checkImages(panel);
    }
    const tq = qn;
    trackTimer = setTimeout(() => { if (tq !== lastTracked) { lastTracked = tq; track(q.trim(), n); } }, 1500);
  }
  function itemRow(item, q) {
    return '<li><a class="gb-search-item" href="' + GB.esc(GB.purl(item)) + '">' + GB.catalog.media(item, 'gb-search-item__media') +
      '<span class="gb-search-item__body"><span class="gb-search-item__name">' + GB.catalog.nameHtml(item, GB.search.highlight(GB.pname(item), q)) + '</span>' +
      '<span class="gb-search-item__meta">' + GB.catalog.price(item) + GB.catalog.stock(item.a) + '</span></span></a></li>';
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 120); });
  form.addEventListener('submit', (e) => {
    const q = input.value.trim();
    if (!norm(q)) { e.preventDefault(); input.focus(); return; }
    input.value = q;
    clearTimeout(trackTimer);
    if (!S_INDEX || GB.search.query(q).length) GB.search.recent.add(q);
    // native GET navigation to search/?q= continues
  });
  GB.listen('dialog:open', (d) => {
    if (d.id !== 'gb-search') return;
    if (!input.value && document.body.classList.contains('page-search')) {
      const pq = GB.$('#search-page-q');
      if (pq && pq.value) input.value = pq.value;
    }
    render();
    GB.search.ready().catch(() => { /* rendered as an error when needed */ });
  });
  // keyboard: ↓ from the input enters the panel; ↑/↓ move through its links/buttons in reading order;
  // ↑ on the first one returns to the input (Tab order is unchanged)
  const focusables = () => GB.$$('a[href], button:not([disabled])', panel).filter((el) => !el.closest('[hidden]'));
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown') return;
    const first = focusables()[0];
    if (first) { e.preventDefault(); first.focus(); }
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = focusables();
    const k = list.indexOf(document.activeElement);
    if (k < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowDown') { if (k < list.length - 1) list[k + 1].focus(); }
    else (k > 0 ? list[k - 1] : input).focus();
  });
  panel.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const recent = t.closest('[data-search-recent]');
    if (recent && !(e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0)) {
      e.preventDefault();
      input.value = recent.getAttribute('data-search-recent');
      render();
      input.focus();
      return;
    }
    if (t.closest('[data-action="search-clear-recent"]')) {
      GB.search.recent.clear();
      GB.announce(GB.t('search.recentCleared'));
      render();
      input.focus();
      return;
    }
    if (t.closest('[data-action="search-retry"]')) { render(); return; }
    if (t.closest('.gb-search-item, .gb-search-all')) {
      clearTimeout(trackTimer);
      const q = input.value.trim();
      if (norm(q)) { GB.search.recent.add(q); if (norm(q) !== lastTracked) track(q, GB.search.query(q).length); }
    }
  });
});

/* ------------------------------------------------------------------ search page (search/?q=) */
GB.ready(() => {
  if (!document.body.classList.contains('page-search')) return;
  const form = GB.$('#search-page-form');
  const input = GB.$('#search-page-q');
  const results = GB.$('#search-results');
  const start = GB.$('#search-start');
  const recentBox = GB.$('#search-recent');
  if (!form || !input || !results || !start) return;
  const baseTitle = document.title;
  let current = null; // query currently rendered
  let ctl = null;

  function showRecent() {
    const html = recentHtml(2);
    recentBox.innerHTML = html;
    recentBox.hidden = !html;
  }
  function showStart() {
    current = '';
    results.hidden = true;
    results.innerHTML = '';
    start.hidden = false;
    document.title = baseTitle;
    showRecent();
  }
  function run(q, how) {
    q = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    input.value = q;
    if (!norm(q)) { showStart(); return; }
    if (q === current && ctl) { ctl.fromUrl(); return; }
    current = q;
    document.title = GB.t('search.docTitle', { q });
    results.hidden = false;
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = '<p class="gb-search-loading" role="status">' + GB.esc(GB.t('common.loading')) + '</p>';
    GB.search.ready().then(() => {
      if (current !== q) return;
      results.removeAttribute('aria-busy');
      const res = GB.search.query(q);
      const n = res.length;
      if (how !== 'pop') { if (n) GB.search.recent.add(q); track(q, n); }
      if (!n) {
        results.innerHTML = noResultsHtml(q, 2);
        start.hidden = false;
        showRecent();
        ctl = null;
        GB.announce(GB.t('search.noResultsTitle', { q }));
        return;
      }
      start.hidden = true;
      const cats = GB.search.categories(q).slice(0, 4);
      const items = res.map((r) => r.item);
      results.innerHTML = '<section class="gb-catalog gb-search-listing" data-listing="search" aria-labelledby="search-results-title">' +
        '<h2 class="gb-search-heading" id="search-results-title">' + GB.esc(GB.t('search.resultsFor', { q })) + '</h2>' +
        catChipsHtml(cats, 'search.catMatches', 3) + GB.catalog.toolbar(items) +
        '<ul class="gb-grid gb-catalog__grid" role="list">' + res.map((r) => '<li class="gb-grid__item">' +
          GB.catalog.card(r.item, { nameHtml: GB.search.highlight(GB.pname(r.item), q) }) + '</li>').join('') + '</ul>' +
        '<div class="gb-catalog__empty" data-listing-empty hidden><div class="gb-empty">' + GB.icon('filter', 'gb-empty__icon') +
        '<h3 class="gb-empty__title">' + GB.esc(GB.t('catalog.emptyTitle')) + '</h3><p class="gb-empty__text">' + GB.esc(GB.t('catalog.emptyText')) + '</p>' +
        '<div class="gb-empty__actions"><button type="button" class="gb-btn gb-btn--primary" data-filter-reset>' + GB.icon('refresh') + '<span>' + GB.esc(GB.t('catalog.reset')) + '</span></button></div></div></div>' +
        '</section>';
      if (!ctl) {
        ctl = GB.catalog.listing(results, {
          countText: (shown, total, filtered) => (filtered ? (shown ? GB.t('catalog.filteredCount', { shown, total }) : GB.t('catalog.noneShown')) : GB.t('search.results', { n: total })),
        });
      }
      ctl.scan();
      GB.catalog.current = ctl;
      if (how === 'submit') ctl.set({ sort: 'best', stock: false, sale: false, brands: [], cat: '' }, null);
      else ctl.fromUrl();
      GB.ui.hydrate(results);
    }).catch(() => {
      if (current !== q) return;
      results.removeAttribute('aria-busy');
      results.innerHTML = errorHtml();
      current = null;
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.replace(/\s+/g, ' ').trim();
    const url = searchUrl(norm(q) ? q : '');
    try { history.pushState({ gbSearch: 1 }, '', url); } catch (err) { /* ignore */ }
    GB.catalog.syncLang();
    current = null;
    run(q, 'submit');
    if (norm(q)) { try { input.blur(); } catch (err) { /* ignore */ } }
  });
  results.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('[data-action="search-retry"]')) { current = null; run(input.value, 'retry'); }
  });
  start.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (t && t.closest('[data-action="search-clear-recent"]')) {
      GB.search.recent.clear();
      showRecent();
      GB.announce(GB.t('search.recentCleared'));
      input.focus();
    }
  });
  window.addEventListener('popstate', () => {
    let q = '';
    try { q = new URLSearchParams(location.search).get('q') || ''; } catch (e) { q = ''; }
    GB.catalog.syncLang();
    run(q, 'pop');
  });
  let q0 = '';
  try { q0 = new URLSearchParams(location.search).get('q') || ''; } catch (e) { q0 = ''; }
  GB.catalog.syncLang();
  run(q0, 'load');
});

} catch (e) { console.error('[GB] src/js/42-search.js failed to initialise', e); }
/* ---- 50-home.js ---- */
try {
/* 50-home.js — Home page behaviour (owner: home module).
     Recently viewed rail: rendered from GB.recent + products.json; hidden while empty or when products.json fails.
     "Clear history" button (data-action="home-recent-clear").
   Server markup: src/pages/home.mjs (#home-recent shell, page data { home: { recentMax } }; cards come from GB.ui.card). */

/** Client card: the shared foundation renderer, wrapped as a rail item. */
function homeCard(p) {
  return '<li class="gb-rail__item">' + GB.ui.card(p, { idSuffix: 'home-recent' }) + '</li>';
}

GB.ready(() => {
  if (!document.body.classList.contains('page-home')) return;
  const section = GB.$('[data-home-recent]');
  const track = section && GB.$('[data-home-recent-track]', section);
  if (!track) return;
  const pd = (GB.page() || {}).home || {};
  const conf = { max: Number(pd.recentMax) || 12 };
  let shownKey = '';

  function hide() {
    section.hidden = true;
    track.innerHTML = '';
    shownKey = '';
  }

  function render() {
    const ids = GB.recent.list().slice(0, conf.max);
    if (!ids.length) { hide(); return; }
    GB.products().then((map) => {
      const items = GB.recent.list().slice(0, conf.max).map((id) => map.get(String(id))).filter(Boolean);
      if (!items.length) { hide(); return; }
      const key = items.map((p) => p.id).join(',');
      if (key === shownKey && !section.hidden) return;
      shownKey = key;
      track.innerHTML = items.map((p) => homeCard(p)).join('');
      section.hidden = false;
      GB.ui.hydrate(section);
      track.dispatchEvent(new Event('scroll')); // refresh the rail arrows now that the track has content
    }).catch(() => { hide(); }); // secondary feature: stay hidden when products.json is unavailable
  }

  GB.on('click', '[data-action="home-recent-clear"]', (e) => {
    e.preventDefault();
    GB.recent.clear();
    // The section disappears: move focus to the next section heading so keyboard users keep their place.
    const next = section.nextElementSibling && GB.$('.gb-sechead__title', section.nextElementSibling);
    hide();
    GB.announce(GB.t('home.recentCleared'));
    const target = next || document.getElementById('main');
    if (target) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      try { target.focus({ preventScroll: false }); } catch (err) { target.focus(); }
    }
  });

  GB.listen('recent:change', render);
  // Back/forward cache: the visitor may have viewed products since this page was first rendered.
  window.addEventListener('pageshow', (e) => { if (e.persisted) render(); });
  render();
});

} catch (e) { console.error('[GB] src/js/50-home.js failed to initialise', e); }
/* ---- 60-pwa.js ---- */
try {
/* 60-pwa.js — PWA client (SPEC §10) + offline/404 page behaviour.
     • registers sw.js (https or localhost only) with scope = BASE
     • "update available" toast with an «تحديث» button → SKIP_WAITING → one reload (only when THIS tab asked for it;
       never shown or applied on the checkout page)
     • install chip: beforeinstallprompt (Chromium) or Add-to-Home-Screen steps (iOS Safari); shown from the 2nd visit
       or after an order hand-off, dismissible (30 days), tracked as pwa_install
     • offline page: retry / auto-retry when back online, list of pages already cached on this device
     • 404 page: WhatsApp link carries the missing URL
   Public: GB.pwa = { registration, updateReady, applyUpdate(), install(), showChip(force), hideChip(), state() } */

const PWA_KEY = 'pwa';
const PWA_SESSION = 'gbq8:v2:pwa-session';
const DAY = 864e5;
const isLocalHost = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/.test(location.hostname);
const swAllowed = 'serviceWorker' in navigator && !!GB.cfg.sw && (location.protocol === 'https:' || isLocalHost);
const onCheckout = () => document.body.classList.contains('page-checkout');
const standalone = () => {
  try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; }
};

const pwaState = () => GB.storage.get(PWA_KEY, {}) || {};
const savePwa = (patch) => { const s = Object.assign(pwaState(), patch); GB.storage.set(PWA_KEY, s); return s; };

GB.pwa = {
  registration: null,
  updateReady: false,
  state: pwaState,
  applyUpdate: () => applyUpdate(),
  install: () => install(),
  showChip: (force) => maybeShowChip(force),
  hideChip: () => hideChip(),
};

/* ------------------------------------------------------------------ service worker + updates */
let wantReload = false, reloading = false;
function doReload() { if (reloading) return; reloading = true; location.reload(); }

function promptUpdate(reg) {
  if (!reg || !reg.waiting || !navigator.serviceWorker.controller) return; // first install: nothing to update
  GB.pwa.updateReady = true;
  GB.emit('pwa:update', { registration: reg });
  if (onCheckout()) return; // never interrupt a checkout — the toast shows on the next page instead
  GB.toast(GB.t('pwa.updateReady'), { action: { label: GB.t('pwa.updateAction'), onClick: applyUpdate }, timeout: 15000 });
}

function applyUpdate() {
  const reg = GB.pwa.registration;
  const w = reg && reg.waiting;
  if (!w) { doReload(); return; }
  wantReload = true;
  w.postMessage({ type: 'SKIP_WAITING' });
  setTimeout(() => { if (wantReload) doReload(); }, 4000); // safety net if controllerchange never fires
}

function registerSw() {
  navigator.serviceWorker.register(GB.cfg.sw, { scope: GB.cfg.base, updateViaCache: 'none' }).then((reg) => {
    if (!reg) return; // registration blocked (some embedded/automation browsers resolve without a registration)
    GB.pwa.registration = reg;
    GB.emit('pwa:registered', { registration: reg });
    if (reg.waiting) promptUpdate(reg);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => { if (nw.state === 'installed') promptUpdate(reg); });
    });
    // long-lived tabs: look for a new deploy when the customer comes back to the tab
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 30 * 60e3) return;
      lastCheck = Date.now();
      reg.update().catch(() => {});
    });
  }).catch((err) => { if (window.console) console.warn('[GB] service worker registration failed', err); });
}

if (swAllowed) {
  // another tab (or our own SKIP_WAITING) activated a new worker: reload only if THIS tab asked for it
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (wantReload) doReload(); });
  if (document.readyState === 'complete') registerSw();
  else window.addEventListener('load', registerSw, { once: true });
}

/* ------------------------------------------------------------------ install chip */
let deferredPrompt = null;
let chipTimer = 0;

const ua = navigator.userAgent || '';
const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// Only Safari can add to the Home Screen reliably; in-app browsers (Instagram, TikTok, Facebook…) cannot.
const isIosSafari = isIos && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|Instagram|FBAN|FBAV|TikTok|musical_ly|BytedanceWebview|Line\/|Snapchat/i.test(ua);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // we offer our own, quieter chip instead of the browser's mini-infobar
  deferredPrompt = e;
  scheduleChip();
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  hideChip();
  savePwa({ installed: Date.now() });
  GB.track('pwa_install', { platform: isIos ? 'ios' : 'web' });
  GB.toast(GB.t('pwa.installed'));
});

function countVisit() {
  let fresh = true;
  try {
    const ss = window.sessionStorage;
    if (ss.getItem(PWA_SESSION)) fresh = false; else ss.setItem(PWA_SESSION, '1');
  } catch (e) { fresh = !GB.__pwaCounted; }
  GB.__pwaCounted = true;
  if (fresh) { const s = pwaState(); savePwa({ visits: (s.visits || 0) + 1 }); }
}

function eligible() {
  if (standalone() || onCheckout()) return false;
  if (!deferredPrompt && !isIosSafari) return false;
  const s = pwaState();
  if (s.installed) return false;
  if (s.dismissed && Date.now() - s.dismissed < 30 * DAY) return false;
  let orders = 0;
  try { orders = GB.orders ? GB.orders.list().length : 0; } catch (e) { orders = 0; }
  return (s.visits || 0) >= 2 || orders > 0;
}

function scheduleChip() {
  clearTimeout(chipTimer);
  chipTimer = setTimeout(() => maybeShowChip(false), 2500); // never compete with the first paint / LCP
}

function chipEl() { return document.getElementById('gb-pwa-chip'); }
function maybeShowChip(force) {
  if (!force && !eligible()) return false;
  let chip = chipEl();
  if (!chip) {
    chip = document.createElement('aside');
    chip.className = 'gb-pwa-chip';
    chip.id = 'gb-pwa-chip';
    chip.setAttribute('aria-label', GB.t('pwa.installRegion'));
    chip.innerHTML =
      '<button type="button" class="gb-pwa-chip__go" data-action="pwa-install">' + GB.icon('download') +
      '<span>' + GB.esc(GB.t('pwa.installAction')) + '</span></button>' +
      '<button type="button" class="gb-pwa-chip__x" data-action="pwa-dismiss" aria-label="' + GB.esc(GB.t('common.dismiss')) + '">' +
      GB.icon('x') + '</button>';
    const toast = document.getElementById('gb-toast');
    document.body.insertBefore(chip, toast && toast.parentNode === document.body ? toast : null);
  }
  chip.hidden = false;
  requestAnimationFrame(() => chip.classList.add('is-show'));
  return true;
}
function hideChip() { const c = chipEl(); if (c) { c.classList.remove('is-show'); c.hidden = true; } }

function install(trigger) {
  if (deferredPrompt) {
    const p = deferredPrompt;
    deferredPrompt = null; // a prompt can only be used once
    hideChip();
    Promise.resolve(p.prompt()).then(() => p.userChoice).then((choice) => {
      if (!choice || choice.outcome !== 'accepted') savePwa({ dismissed: Date.now() });
    }).catch(() => {});
    return;
  }
  if (isIosSafari || GB.__pwaForceIos) openIosHelp(trigger);
}

function openIosHelp(trigger) {
  let d = document.getElementById('gb-pwa-ios');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'gb-pwa-ios';
    d.className = 'gb-dialog gb-dialog--sheet gb-pwa-ios';
    d.setAttribute('aria-labelledby', 'gb-pwa-ios-title');
    d.innerHTML =
      '<div class="gb-dialog__head"><h2 class="gb-dialog__title" id="gb-pwa-ios-title" tabindex="-1">' + GB.esc(GB.t('pwa.iosTitle')) + '</h2>' +
      '<button type="button" class="gb-dialog__close" data-dialog-close aria-label="' + GB.esc(GB.t('common.close')) + '">' + GB.icon('x') + '</button></div>' +
      '<div class="gb-dialog__body"><p class="gb-pwa-ios__lead">' + GB.esc(GB.t('pwa.iosLead')) + '</p>' +
      '<ol class="gb-pwa-ios__steps">' +
      ['pwa.iosStep1', 'pwa.iosStep2', 'pwa.iosStep3'].map((k) => '<li>' + GB.esc(GB.t(k)) + '</li>').join('') + '</ol>' +
      '<button type="button" class="gb-btn gb-btn--primary gb-btn--block" data-dialog-close>' + GB.esc(GB.t('pwa.iosDone')) + '</button></div>';
    document.body.appendChild(d);
    d.addEventListener('close', () => { savePwa({ dismissed: Date.now() }); hideChip(); });
  }
  GB.dialog.open('gb-pwa-ios', trigger || chipEl());
}

GB.on('click', '[data-action="pwa-install"]', (e, el) => { e.preventDefault(); install(el); });
GB.on('click', '[data-action="pwa-dismiss"]', (e) => {
  e.preventDefault();
  savePwa({ dismissed: Date.now() });
  hideChip();
});

GB.ready(() => {
  countVisit();
  if (isIosSafari) scheduleChip();
});

/* ------------------------------------------------------------------ offline page */
GB.ready(() => {
  if (!document.body.classList.contains('page-offline')) return;
  const pd = GB.page() || {};
  const L = pd.labels || {};
  const status = document.getElementById('off-status');
  const isFallback = location.pathname !== GB.url('offline/'); // served by the SW in place of another page
  let busy = false;

  function retry() {
    if (!isFallback) { location.href = GB.url(''); return; }
    if (busy) return;
    if (navigator.onLine === false) { if (status) status.textContent = L.stillOffline || ''; return; }
    busy = true;
    if (status) status.textContent = L.checking || '';
    // HEAD bypasses the service worker's page cache (it only handles GET) → a real connectivity probe
    fetch(location.href, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' })
      .then(() => doReload(), () => { busy = false; if (status) status.textContent = L.stillOffline || ''; });
  }
  GB.on('click', '[data-action="pwa-retry"]', (e) => { e.preventDefault(); retry(); });
  window.addEventListener('online', () => { if (L.backOnline) GB.toast(L.backOnline); retry(); });

  // pages this device already has in the service-worker cache (current publish, current locale)
  if (!('caches' in window)) return;
  const cacheName = 'gbq8-' + GB.cfg.publishId + '-pages';
  const prefix = GB.url('');
  // the default locale lives at BASE, so its prefix also matches the other locales' folders (en/…) — skip those
  const others = GB.locale === GB.cfg.defaultLocale ? ['en'] : [];
  caches.has(cacheName).then((ok) => (ok ? caches.open(cacheName).then((c) => c.keys()) : []))
    .then((reqs) => {
      const seen = {};
      const routes = [];
      reqs.slice().reverse().forEach((r) => {
        let p;
        try { p = new URL(r.url).pathname; } catch (e) { return; }
        if (p.indexOf(prefix) !== 0) return;
        const route = p.slice(prefix.length).replace(/index\.html$/, '');
        if (others.some((l) => route === l + '/' || route.indexOf(l + '/') === 0)) return;
        if (seen[route] || /^(offline|404|checkout)\//.test(route)) return;
        seen[route] = true;
        routes.push(route);
      });
      if (!routes.length) return;
      const needProducts = routes.some((r) => /^p\//.test(r));
      return (needProducts ? GB.products().catch(() => null) : Promise.resolve(null)).then((map) => {
        const byRoute = {};
        if (map) map.forEach((item) => { byRoute[item.s] = item; });
        const items = routes.map((route) => {
          let label = null, ic = 'chevron-forward';
          if (route === '') { label = L.home; ic = 'home'; }
          else if (route === 'search/') { label = L.search; ic = 'search'; }
          else if (route === 'wishlist/') { label = L.wishlist; ic = 'heart'; }
          else if (/^c\/[^/]+\/$/.test(route)) { label = (pd.cats || {})[route.slice(2, -1)]; ic = 'grid'; }
          else if (/^info\/[^/]+\/$/.test(route)) { label = (pd.info || {})[route.slice(5, -1)]; ic = 'info'; }
          else if (/^p\//.test(route)) {
            const it = byRoute[route];
            label = it ? GB.pname(it) : route.slice(2, -1).replace(/-\d+$/, '').replace(/-/g, ' ');
            ic = 'tag';
          }
          return label ? { route, label, ic } : null;
        }).filter(Boolean).slice(0, 12);
        if (!items.length) return;
        const list = document.getElementById('off-list');
        list.innerHTML = items.map((it) => '<li><a class="gb-off__link" href="' + GB.esc(GB.url(it.route)) + '">' +
          GB.icon(it.ic, 'gb-off__link-icon') + '<bdi class="gb-off__link-label">' + GB.esc(it.label) + '</bdi>' +
          GB.icon('chevron-forward', 'gb-off__link-go') + '</a></li>').join('');
        document.getElementById('off-saved').hidden = false;
      });
    })
    .catch(() => { /* cache API unavailable: the list simply stays hidden */ });
});

/* ------------------------------------------------------------------ 404 page */
GB.ready(() => {
  if (!document.body.classList.contains('page-notfound')) return;
  const pd = GB.page() || {};
  const wa = GB.$('[data-nf-wa]');
  if (wa && pd.waText) wa.href = GB.wa(pd.waText.replace('{url}', location.href));
});

} catch (e) { console.error('[GB] src/js/60-pwa.js failed to initialise', e); }
if (window.GB && typeof window.GB.start === 'function') window.GB.start();
})();
