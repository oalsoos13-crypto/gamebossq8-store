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
