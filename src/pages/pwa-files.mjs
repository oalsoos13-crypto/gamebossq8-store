// src/pages/pwa-files.mjs — root-only SEO/PWA files (SPEC §9, §10). Emitted ONCE (default-locale call, global: true):
//   sitemap.xml            every indexable page in both locales with xhtml:link hreflang alternates (+ image:image)
//   robots.txt             Allow all + Sitemap line (only effective on a custom domain; see the note inside)
//   manifest.webmanifest   SPEC §10 fields; icons from src/static/assets/icons/ (tools/make-icons.mjs)
//   sw.js                  service worker, scope BASE (strategy below)
//
// Ops switch: `node tools/build.mjs --set pwa.killSwitch=true` publishes a sw.js that deletes every gbq8- cache and
// unregisters itself (emergency rollback for a broken worker). Pages keep registering sw.js, which is harmless.

export const provides = ['manifest.webmanifest', 'sw.js'];

// Info pages are owned by src/pages/info.mjs; same list/slugs as the footer (src/core/layout.mjs INFO_PAGES).
import { ALL_ROUTE } from './category.mjs';

const INFO_SLUGS = ['how-to-order', 'delivery-payment', 'returns', 'about', 'privacy'];
const ICON_DIR = 'assets/icons/';

const xmlEsc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** Absolute, percent-encoded URL for a product image (catalog URLs are already encoded; mirrored paths get origin+BASE). */
function absImage(ctx, src) {
  let u = ctx.h.imageUrl(src, ctx.asset);
  if (!/^https?:/i.test(u)) u = ctx.origin + u;
  // encode anything that is not already a valid URL character (never double-encode existing %XX escapes)
  return u.replace(/[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/g, (c) => encodeURIComponent(c)).replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
}

// ---------------------------------------------------------------------------------------------------- sitemap
function sitemap(ctx) {
  const { data, config } = ctx;
  const pages = [];
  if (config.indexable !== false) {
    pages.push({ route: '' });
    for (const c of data.categories) pages.push({ route: ctx.categoryRoute(c.id) });
    pages.push({ route: ALL_ROUTE }); // c/all/ — indexable CollectionPage of every product (src/pages/category.mjs)
    for (const p of data.products) pages.push({ route: ctx.productRoute(p), images: (p.images || []).slice(0, 5) });
    for (const s of INFO_SLUGS) pages.push({ route: `info/${s}/` });
  }
  const alt = (route) => ctx.locales.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${xmlEsc(ctx.abs(route, l))}"/>`).join('')
    + `<xhtml:link rel="alternate" hreflang="x-default" href="${xmlEsc(ctx.abs(route, ctx.defaultLocale))}"/>`;
  const urls = [];
  for (const pg of pages) {
    const links = alt(pg.route);
    const imgs = (pg.images || []).map((src) => `<image:image><image:loc>${xmlEsc(absImage(ctx, src))}</image:loc></image:image>`).join('');
    for (const l of ctx.locales) urls.push(`<url><loc>${xmlEsc(ctx.abs(pg.route, l))}</loc>${links}${imgs}</url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>
`;
}

// ---------------------------------------------------------------------------------------------------- robots.txt
function robots(ctx) {
  return `# GameBoss Q8 — robots.txt
# Crawlers only read robots.txt at the HOST ROOT. While the store lives under ${ctx.origin}${ctx.base}
# this file is ignored — submit ${ctx.abs('sitemap.xml')} in Google Search Console instead.
# It becomes effective as-is once the store moves to its own domain (build with --base /).
# Utility pages (search, wishlist, checkout, offline, 404) are NOT blocked here on purpose: they carry
# <meta name="robots" content="noindex"> and crawlers must be able to read it.
User-agent: *
Allow: /

Sitemap: ${ctx.abs('sitemap.xml')}
`;
}

// ---------------------------------------------------------------------------------------------------- manifest
function manifest(ctx) {
  const T = (k) => ctx.t(k);
  const png = (file, size, purpose) => ({ src: `${ICON_DIR}${file}`, sizes: `${size}x${size}`, type: 'image/png', purpose });
  const m = {
    id: ctx.base,
    name: T('pwa.appName'),
    short_name: T('pwa.appShortName'),
    description: T('pwa.appDesc'),
    lang: 'ar',
    dir: 'rtl',
    start_url: './?src=pwa',
    scope: './',
    display: 'standalone',
    orientation: 'any',
    theme_color: ctx.config.themeColor || '#F5F5F7',
    background_color: '#F5F5F7',
    categories: ['shopping'],
    prefer_related_applications: false,
    icons: [
      png('icon-192.png', 192, 'any'),
      png('icon-512.png', 512, 'any'),
      png('icon-maskable-512.png', 512, 'maskable'),
      { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      { name: T('pwa.shortcutSearch'), url: './search/?src=pwa', icons: [png('icon-192.png', 192, 'any')] },
      { name: T('pwa.shortcutWishlist'), url: './wishlist/?src=pwa', icons: [png('icon-192.png', 192, 'any')] },
      { name: T('pwa.shortcutEnglish'), url: './en/?src=pwa', icons: [png('icon-192.png', 192, 'any')] },
    ],
  };
  return JSON.stringify(m, null, 2) + '\n';
}

// ---------------------------------------------------------------------------------------------------- sw.js
// Strategy (SPEC §10):
//   navigations          network-first (3 s timeout → cached copy if any, else keep waiting) → cache → offline page
//                        (locale-aware). Successful same-origin HTML is cached in -pages (max 60, search stripped).
//   products.<hash>.json network-first → cached copy → ANY cached products json (an old tab asking for a stale hash
//                        still gets data with the same schema).
//   assets/app.* fonts   cache-first (hashed / immutable) in -shell.
//   favicon, manifest, icons   stale-while-revalidate in -shell.
//   cross-origin (product images on gamebossq8.com, wa.me, analytics) and everything else: NOT handled (browser only).
//   install: precache shell (both offline pages, css, js, fonts, icons, manifest) + products json; does NOT skipWaiting —
//            the page shows an "update available" toast and posts {type:'SKIP_WAITING'}.
//   activate: delete ONLY caches named gbq8-* that are not current (the github.io origin is shared with other apps),
//             prune stale hashed assets inside the current shell cache (code-only deploys keep the same publishId) and
//             then drop the pages cache so no cached page points at a pruned asset; enable navigation preload; claim.
function serviceWorker(ctx) {
  const A = ctx.assets;
  const B = ctx.base;
  const pub = ctx.publishId;
  const offline = Object.fromEntries(ctx.locales.map((l) => [l, ctx.url('offline/', l)]));
  const shell = [
    ...Object.values(offline),
    A.css, A.js,
    ...Object.values(A.fonts),
    A.favicon, A.icon32, ctx.asset(`${ICON_DIR}icon-192.png`),
    A.manifest,
  ].filter(Boolean);
  const cfg = {
    base: B,
    version: pub,
    caches: { shell: `gbq8-${pub}-shell`, pages: `gbq8-${pub}-pages`, data: `gbq8-${pub}-data` },
    shell: [...new Set(shell)],
    products: A.productsJson,
    offline,
    defaultLocale: ctx.defaultLocale,
    locales: ctx.locales,
    navTimeout: 3000,
    maxPages: 60,
  };
  const hdr = `/*! GameBoss Q8 service worker · publish ${pub} · css ${A.files.css} · js ${A.files.js} · data ${A.files.productsJson} */\n`;

  if (ctx.config.pwa && ctx.config.pwa.killSwitch) {
    return `${hdr}/* KILL SWITCH (built with --set pwa.killSwitch=true): remove every GameBoss cache and unregister. */
'use strict';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys()
    .then(function (keys) { return Promise.all(keys.filter(function (k) { return k.indexOf('gbq8-') === 0; }).map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.registration.unregister(); }));
});
`;
  }

  return `${hdr}'use strict';
const CFG = ${JSON.stringify(cfg)};
const SHELL = CFG.caches.shell, PAGES = CFG.caches.pages, DATA = CFG.caches.data;
const SHELL_SET = new Set(CFG.shell);
const ORIGIN = self.location.origin;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    // must-haves (fail the install if missing): offline pages, css, js
    const critical = CFG.shell.filter((u) => /\\/offline\\/$|\\/assets\\/app\\./.test(u));
    await shell.addAll(critical.map((u) => new Request(u, { cache: 'reload' })));
    // nice-to-haves: fonts, icons, manifest, products json (never block the install)
    await Promise.all(CFG.shell.filter((u) => critical.indexOf(u) < 0).map((u) =>
      shell.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    const data = await caches.open(DATA);
    await data.add(new Request(CFG.products, { cache: 'reload' })).catch(() => {});
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const current = [SHELL, PAGES, DATA];
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.indexOf('gbq8-') === 0 && current.indexOf(k) < 0).map((k) => caches.delete(k)));
    // same publishId but new code → prune old hashed bundles; then drop cached pages that reference them
    const shell = await caches.open(SHELL);
    let pruned = 0;
    for (const req of await shell.keys()) {
      const p = new URL(req.url).pathname;
      if (p.indexOf(CFG.base + 'assets/app.') === 0 && !SHELL_SET.has(p)) { await shell.delete(req); pruned++; }
    }
    if (pruned) await caches.delete(PAGES);
    const data = await caches.open(DATA);
    for (const req of await data.keys()) if (new URL(req.url).pathname !== CFG.products) await data.delete(req);
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (e) { /* unsupported */ } }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const d = event.data;
  if (d && d.type === 'SKIP_WAITING') self.skipWaiting();
  else if (d && d.type === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'VERSION', version: CFG.version });
});

function keep(event, promise) { try { event.waitUntil(promise.catch(() => {})); } catch (e) { /* event already finished */ } }
const cacheable = (res) => res && res.ok && res.type === 'basic';

async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

function localeOf(pathname) {
  for (const l of CFG.locales) if (l !== CFG.defaultLocale && pathname.indexOf(CFG.base + l + '/') === 0) return l;
  return CFG.defaultLocale;
}

async function fromCaches(names, key, opts) {
  for (const n of names) {
    const c = await caches.open(n);
    const hit = await c.match(key, opts);
    if (hit) return hit;
  }
  return null;
}

/**
 * Network-first with a soft timeout: after \`timeout\` ms a cached copy (if any) is served while the network keeps
 * running (its response still refreshes the cache); without a cached copy we keep waiting for the network.
 */
function networkFirst(event, { fetcher, cacheName, key, lookup, fallback, timeout }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled && r) { settled = true; resolve(r); } };
    const timer = setTimeout(() => { lookup().then(done, () => {}); }, timeout);
    const net = fetcher().then((res) => {
      if (cacheable(res)) {
        const copy = res.clone();
        keep(event, caches.open(cacheName).then((c) => c.put(key, copy)).then(() => cacheName === PAGES ? trim(PAGES, CFG.maxPages) : null));
      }
      return res;
    });
    keep(event, net);
    net.then(async (res) => {
      clearTimeout(timer);
      if (res.status >= 500) { const hit = await lookup(); if (hit) return done(hit); }
      done(res);
    }, async () => {
      clearTimeout(timer);
      const hit = await lookup().catch(() => null);
      done(hit || await fallback());
    });
  });
}

async function offlinePage(pathname) {
  const url = CFG.offline[localeOf(pathname)] || CFG.offline[CFG.defaultLocale];
  const hit = await fromCaches([SHELL, PAGES], url, { ignoreSearch: true });
  return hit || new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><p style="font:16px system-ui;padding:24px">لا يوجد اتصال بالإنترنت — You are offline.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function onNavigate(event, url) {
  const key = ORIGIN + url.pathname; // one cache entry per page, whatever the query (?q=, ?src=…)
  return networkFirst(event, {
    fetcher: async () => {
      const pre = event.preloadResponse ? await event.preloadResponse.catch(() => null) : null;
      return pre || fetch(event.request);
    },
    cacheName: PAGES,
    key,
    lookup: () => fromCaches([PAGES, SHELL], key, { ignoreSearch: true }),
    fallback: () => offlinePage(url.pathname),
    timeout: CFG.navTimeout,
  });
}

function onProducts(event, url) {
  return networkFirst(event, {
    fetcher: () => fetch(event.request),
    cacheName: DATA,
    key: event.request,
    lookup: async () => {
      const c = await caches.open(DATA);
      const exact = await c.match(event.request, { ignoreSearch: true });
      if (exact) return exact;
      const any = (await c.keys()).find((r) => /\\/assets\\/products\\.[^/]*\\.json$/.test(new URL(r.url).pathname));
      return any ? c.match(any) : null;
    },
    fallback: () => Response.error(),
    timeout: CFG.navTimeout,
  }).then(async (res) => {
    if (res && res.status === 404) { // a stale page asking for an old hash after a deploy
      const c = await caches.open(DATA);
      const any = (await c.keys())[0];
      const hit = any && await c.match(any);
      if (hit) return hit;
    }
    return res;
  });
}

async function cacheFirst(event, req) {
  const c = await caches.open(SHELL);
  const hit = await c.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) { const copy = res.clone(); keep(event, c.put(req, copy)); }
  return res;
}

async function staleWhileRevalidate(event, req) {
  const c = await caches.open(SHELL);
  const hit = await c.match(req, { ignoreSearch: true });
  const net = fetch(req).then((res) => { if (cacheable(res)) { const copy = res.clone(); return c.put(req, copy).then(() => res); } return res; });
  keep(event, net);
  return hit || net;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== ORIGIN) return;                       // cross-origin images, wa.me, analytics: browser only
  const p = url.pathname;
  if (p.indexOf(CFG.base) !== 0) return;                   // other projects on the shared origin
  if (p === CFG.base + 'sw.js') return;
  if (req.mode === 'navigate') { event.respondWith(onNavigate(event, url)); return; }
  if (/\\/assets\\/products\\.[^/]*\\.json$/.test(p)) { event.respondWith(onProducts(event, url)); return; }
  if (p.indexOf(CFG.base + 'assets/app.') === 0 || p.indexOf(CFG.base + 'assets/fonts/') === 0) { event.respondWith(cacheFirst(event, req)); return; }
  if (SHELL_SET.has(p) || p.indexOf(CFG.base + 'assets/icons/') === 0) { event.respondWith(staleWhileRevalidate(event, req)); return; }
  // everything else (mirrored images, sitemap, …): network only
});
`;
}

export default function routes(ctx) {
  if (ctx.locale !== ctx.defaultLocale) return [];
  return [
    { route: 'sitemap.xml', body: sitemap(ctx), global: true },
    { route: 'robots.txt', body: robots(ctx), global: true },
    { route: 'manifest.webmanifest', body: manifest(ctx), global: true },
    { route: 'sw.js', body: serviceWorker(ctx), global: true },
  ];
}
