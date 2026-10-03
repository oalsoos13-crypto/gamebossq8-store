// tools/verify/layout-gate.mjs — gate 3 (SPEC §13.3): zero horizontal overflow at 320/360/390/414 (isMobile) and
// 768/1280 for home, category, product (long name, sale, no image, out of stock), search (with results), wishlist
// (with items), checkout (with a cart), an info page and the 404 page — both locales; plus the cart drawer open at
// 320. Also the "shots" gate: 390×844 and 1280×800 screenshots of home/category/product/checkout (+ cart) per locale.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { session, open, pool, VIEWPORTS } from './lib.mjs';

/** Storage seed giving the wishlist/checkout pages real content. */
export function seedFor(site) {
  const pk = site.picks;
  const ids = [pk.sale, pk.noImage, pk.longName].filter(Boolean).map((p) => String(p.id));
  const inStockIds = pk.inStock.slice(0, 3).map((p) => String(p.id));
  const cart = {};
  inStockIds.forEach((id, i) => { cart[id] = i + 1; });
  if (pk.oos) cart[pk.oos.id] = 1;
  return { 'gbq8:v2:cart': cart, 'gbq8:v2:wish': [...new Set(ids)] };
}

export function pageTypes(site) {
  const pk = site.picks;
  const list = [
    { key: 'home', route: '' },
    { key: 'category', route: `c/${pk.category}/` },
    { key: 'category-all', route: 'c/all/' },
    pk.longName && { key: 'product-longname', route: pk.longName.s },
    pk.sale && { key: 'product-sale', route: pk.sale.s },
    pk.noImage && { key: 'product-noimage', route: pk.noImage.s },
    pk.oos && { key: 'product-oos', route: pk.oos.s },
    { key: 'search', route: 'search/?q=' + encodeURIComponent('ادبتر'), ready: '#search-results a[href*="/p/"]' },
    { key: 'wishlist', route: 'wishlist/', seed: true, ready: '#wl-list > li' },
    { key: 'checkout', route: 'checkout/', seed: true, ready: '#co-summary .gb-co-lines, #co-main:not([hidden])' },
    { key: 'info', route: 'info/delivery-payment/' },
    { key: '404', route: '404.html' },
  ].filter(Boolean);
  return list;
}

/** In-page overflow probe: document overflow + the worst offending elements. */
async function probe(page, scope = null) {
  return page.evaluate((sel) => {
    const root = sel ? document.querySelector(sel) : document.documentElement;
    const iw = window.innerWidth;
    const doc = document.documentElement;
    const res = { scrollWidth: doc.scrollWidth, innerWidth: iw, bodyScroll: document.body.scrollWidth };
    if (sel && root) { res.scopeScroll = root.scrollWidth; res.scopeClient = root.clientWidth; }
    const off = [];
    const nodes = (sel && root ? root : document.body).querySelectorAll('*');
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right > iw + 1 || r.left < -1) {
        // ignore content inside horizontal scrollers (rails, chips) — they scroll on purpose
        let p = el.parentElement, clipped = false;
        while (p && p !== document.body) {
          const cs = getComputedStyle(p);
          if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) { clipped = true; break; }
          p = p.parentElement;
        }
        if (clipped) continue;
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' && cs.visibility === 'hidden') continue;
        off.push({ el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''), left: Math.round(r.left), right: Math.round(r.right) });
        if (off.length > 6) break;
      }
    }
    res.offenders = off;
    return res;
  }, scope);
}

export async function overflowGate(R, env) {
  const { site, browser, srv, args } = env;
  const types = pageTypes(site);
  const vps = ['m320', 'm360', 'm390', 'm414', 't768', 'd1280'];
  const tasks = [];
  for (const vp of vps) for (const loc of ['ar', 'en']) tasks.push({ vp, loc });
  const seed = seedFor(site);
  const results = [];
  await pool(tasks, Math.max(2, args.jobs), async ({ vp, loc }) => {
    const S = await session(browser, srv, { vp });
    try {
      await S.seed(seed);
      for (const t of types) {
        const route = (loc === 'en' && t.route !== '404.html' ? 'en/' : '') + t.route;
        const r = { vp, loc, page: t.key };
        try {
          await open(S, route, { settle: 200 });
          if (t.ready) await S.page.waitForSelector(t.ready, { timeout: 6000 }).catch(() => { r.notReady = t.ready; });
          await S.page.waitForTimeout(150);
          const p = await probe(S.page);
          r.ok = p.scrollWidth <= p.innerWidth;
          r.data = p;
        } catch (e) { r.ok = false; r.error = String(e.message || e).split('\n')[0]; }
        results.push(r);
      }
      if (vp === 'm320') {
        // cart drawer open at the narrowest width
        const r = { vp, loc, page: 'cart-dialog' };
        try {
          await open(S, loc === 'en' ? 'en/' : '');
          await S.page.locator('[data-dialog-open="gb-cart"]:visible').first().click();
          await S.page.waitForSelector('#gb-cart .gb-cart-line', { timeout: 6000 });
          await S.page.waitForTimeout(200);
          const p = await probe(S.page, '#gb-cart');
          r.ok = p.scrollWidth <= p.innerWidth && (p.scopeScroll === undefined || p.scopeScroll <= p.scopeClient + 1);
          r.data = p;
        } catch (e) { r.ok = false; r.error = String(e.message || e).split('\n')[0]; }
        results.push(r);
      }
    } finally { await S.close(); }
  });
  const byPage = {};
  for (const r of results) (byPage[r.page] = byPage[r.page] || []).push(r);
  for (const [pageKey, list] of Object.entries(byPage)) {
    const bad = list.filter((r) => !r.ok);
    R.check(`no horizontal overflow: ${pageKey} (${list.length} viewport×locale)`, !bad.length,
      bad.slice(0, 6).map((r) => ({ vp: r.vp, loc: r.loc, error: r.error, scrollWidth: r.data && r.data.scrollWidth, innerWidth: r.data && r.data.innerWidth, scope: r.data && r.data.scopeScroll !== undefined ? `${r.data.scopeScroll}/${r.data.scopeClient}` : undefined, offenders: r.data && r.data.offenders.slice(0, 3) })));
    const nr = list.filter((r) => r.notReady);
    if (nr.length) R.check(`content rendered before measuring: ${pageKey}`, false, nr.slice(0, 4).map((r) => `${r.vp} ${r.loc}: ${r.notReady} never appeared`));
  }
}

export async function shotsGate(R, env) {
  const { site, browser, srv, args } = env;
  const dir = args.shots;
  mkdirSync(dir, { recursive: true });
  const pk = site.picks;
  const seed = seedFor(site);
  const pages = [
    { key: 'home', route: '' },
    { key: 'category', route: `c/${pk.category}/` },
    { key: 'product', route: (pk.sale || pk.longName).s },
    { key: 'checkout', route: 'checkout/', ready: '#co-summary .gb-co-lines' },
    { key: 'cart', route: '', dialog: 'gb-cart' },
  ];
  const tasks = [];
  for (const vp of ['m390', 'd1280']) for (const loc of ['ar', 'en']) tasks.push({ vp, loc });
  const made = [], failed = [];
  await pool(tasks, 4, async ({ vp, loc }) => {
    const S = await session(browser, srv, { vp });
    try {
      await S.seed(seed);
      for (const p of pages) {
        const file = join(dir, `${p.key}-${loc}-${VIEWPORTS[vp].width}.png`);
        try {
          await open(S, (loc === 'en' ? 'en/' : '') + p.route, { settle: 300 });
          if (p.ready) await S.page.waitForSelector(p.ready, { timeout: 6000 }).catch(() => {});
          if (p.dialog) {
            await S.page.locator(`[data-dialog-open="${p.dialog}"]:visible`).first().click();
            await S.page.waitForSelector('#gb-cart .gb-cart-line', { timeout: 6000 }).catch(() => {});
            await S.page.waitForTimeout(250);
          }
          await S.page.screenshot({ path: file });
          made.push(file);
        } catch (e) { failed.push(`${file}: ${String(e.message || e).split('\n')[0]}`); }
      }
    } finally { await S.close(); }
  });
  R.check(`screenshots written to ${dir}`, made.length === tasks.length * pages.length && !failed.length, failed.length ? failed : `${made.length} files`);
}
