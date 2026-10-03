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
