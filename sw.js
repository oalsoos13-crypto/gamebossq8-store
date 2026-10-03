/*! GameBoss Q8 service worker · publish 40e2a908 · css assets/app.429f0da1.css · js assets/app.23c9e763.js · data assets/products.319bb495.json */
'use strict';
const CFG = {"base":"/gamebossq8-store/","version":"40e2a908","caches":{"shell":"gbq8-40e2a908-shell","pages":"gbq8-40e2a908-pages","data":"gbq8-40e2a908-data"},"shell":["/gamebossq8-store/offline/","/gamebossq8-store/en/offline/","/gamebossq8-store/assets/app.429f0da1.css","/gamebossq8-store/assets/app.23c9e763.js","/gamebossq8-store/assets/fonts/tajawal-400-arabic.woff2","/gamebossq8-store/assets/fonts/tajawal-400-latin.woff2","/gamebossq8-store/assets/fonts/tajawal-700-arabic.woff2","/gamebossq8-store/assets/fonts/tajawal-700-latin.woff2","/gamebossq8-store/assets/fonts/tajawal-800-arabic.woff2","/gamebossq8-store/assets/fonts/tajawal-800-latin.woff2","/gamebossq8-store/favicon.svg","/gamebossq8-store/assets/icons/icon-32.png","/gamebossq8-store/assets/icons/icon-192.png","/gamebossq8-store/manifest.webmanifest"],"products":"/gamebossq8-store/assets/products.319bb495.json","offline":{"ar":"/gamebossq8-store/offline/","en":"/gamebossq8-store/en/offline/"},"defaultLocale":"ar","locales":["ar","en"],"navTimeout":3000,"maxPages":60};
const SHELL = CFG.caches.shell, PAGES = CFG.caches.pages, DATA = CFG.caches.data;
const SHELL_SET = new Set(CFG.shell);
const ORIGIN = self.location.origin;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    // must-haves (fail the install if missing): offline pages, css, js
    const critical = CFG.shell.filter((u) => /\/offline\/$|\/assets\/app\./.test(u));
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
 * Network-first with a soft timeout: after `timeout` ms a cached copy (if any) is served while the network keeps
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
      const any = (await c.keys()).find((r) => /\/assets\/products\.[^/]*\.json$/.test(new URL(r.url).pathname));
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
  if (/\/assets\/products\.[^/]*\.json$/.test(p)) { event.respondWith(onProducts(event, url)); return; }
  if (p.indexOf(CFG.base + 'assets/app.') === 0 || p.indexOf(CFG.base + 'assets/fonts/') === 0) { event.respondWith(cacheFirst(event, req)); return; }
  if (SHELL_SET.has(p) || p.indexOf(CFG.base + 'assets/icons/') === 0) { event.respondWith(staleWhileRevalidate(event, req)); return; }
  // everything else (mirrored images, sitemap, …): network only
});
