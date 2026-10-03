// tools/verify/pwa-gate.mjs — gate 6 (SPEC §13.6 + §10): manifest valid + icons exist (and have the declared pixel
// sizes), service worker registers on localhost with scope = BASE, caches are gbq8-<publishId>-*, precache holds the
// offline pages, and an offline navigation to an UNCACHED page shows the offline page in the right locale.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { session, open, sleep } from './lib.mjs';

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

export async function pwaGate(R, env) {
  const { site, browser, srv } = env;
  const { outDir, base, publishId } = site;

  /* ---------------- manifest (static) */
  const mPath = join(outDir, 'manifest.webmanifest');
  let m = null;
  try { m = JSON.parse(readFileSync(mPath, 'utf8')); } catch (e) { R.check('manifest.webmanifest parses', false, String(e.message)); }
  if (m) {
    const want = { id: base, start_url: './?src=pwa', scope: './', display: 'standalone', theme_color: '#F5F5F7', background_color: '#F5F5F7', lang: 'ar', dir: 'rtl', short_name: 'GameBoss Q8' };
    const diff = Object.entries(want).filter(([k, v]) => String(m[k]).toLowerCase() !== String(v).toLowerCase()).map(([k, v]) => `${k}: ${m[k]} ≠ ${v}`);
    R.check('manifest fields (id/start_url/scope/display/colors/lang/dir/short_name)', !diff.length, diff);
    R.check('manifest name', typeof m.name === 'string' && /GameBoss Q8/.test(m.name), m.name);
    const icons = Array.isArray(m.icons) ? m.icons : [];
    const has = (size, purpose) => icons.some((i) => (i.sizes || '').split(/\s+/).includes(size) && (!purpose || (i.purpose || 'any').split(/\s+/).includes(purpose)));
    R.check('manifest icons: 192 + 512 (any) + 512 maskable + svg', has('192x192', 'any') && has('512x512', 'any') && has('512x512', 'maskable') && icons.some((i) => /svg/.test(i.type || i.src)), icons.map((i) => `${i.src} ${i.sizes} ${i.purpose || 'any'}`));
    const bad = [];
    for (const i of [...icons, ...((m.shortcuts || []).flatMap((s) => s.icons || []))]) {
      const f = join(outDir, new URL(i.src, 'http://x' + base).pathname.slice(base.length));
      if (!existsSync(f)) { bad.push(`${i.src}: missing`); continue; }
      if (/png$/i.test(i.src)) {
        const sz = pngSize(readFileSync(f));
        const [w, h] = (i.sizes || '').split('x').map(Number);
        if (!sz || sz.w !== w || sz.h !== h) bad.push(`${i.src}: ${sz ? sz.w + 'x' + sz.h : 'not a PNG'} ≠ ${i.sizes}`);
      }
    }
    for (const s of m.shortcuts || []) {
      const p = new URL(s.url, 'http://x' + base).pathname.slice(base.length);
      if (!existsSync(join(outDir, p, p.endsWith('/') || !p ? 'index.html' : ''))) bad.push(`shortcut ${s.url}: page missing`);
    }
    R.check('every manifest icon/shortcut exists with the declared pixel size', !bad.length, bad);
  }
  const at = join(outDir, 'assets/icons/apple-touch-icon.png');
  const atSize = existsSync(at) ? pngSize(readFileSync(at)) : null;
  R.check('apple-touch-icon 180×180 exists', !!atSize && atSize.w === 180 && atSize.h === 180, atSize);

  /* ---------------- service worker (browser) */
  const swSrc = existsSync(join(outDir, 'sw.js')) ? readFileSync(join(outDir, 'sw.js'), 'utf8') : '';
  // every caches.delete() must be guarded by a gbq8- prefix test (the github.io origin is shared with other projects)
  const delSites = [...swSrc.matchAll(/caches\.delete\(/g)].map((mm) => swSrc.slice(Math.max(0, mm.index - 260), mm.index));
  const unguarded = delSites.filter((ctx) => !/gbq8-|PAGES|SHELL|DATA|CFG\.caches|current/.test(ctx));
  R.check('sw.js exists at BASE root; cache deletion limited to gbq8- caches', !!swSrc && /gbq8-/.test(swSrc) && !unguarded.length, unguarded.map((x) => x.slice(-120)));
  const S = await session(browser, srv, { vp: 'm390', sw: true, offlineOk: true });
  try {
    const page = S.page;
    await open(S, '', { settle: 300 });
    const reg = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { error: 'no serviceWorker' };
      const t = new Promise((r) => setTimeout(() => r(null), 12000));
      const ready = await Promise.race([navigator.serviceWorker.ready, t]);
      if (!ready) return { error: 'navigator.serviceWorker.ready timed out' };
      return { scope: ready.scope, active: !!ready.active, script: ready.active && ready.active.scriptURL };
    });
    R.check('service worker registers on localhost (scope = BASE)', reg && !reg.error && reg.scope === S.origin + base && /\/sw\.js$/.test(reg.script || ''), reg);
    await page.reload({ waitUntil: 'load' });
    await sleep(400);
    const ctl = await page.evaluate(() => !!navigator.serviceWorker.controller);
    R.check('page is controlled by the SW after reload', ctl);
    const caches = await page.evaluate(async () => {
      const keys = await caches.keys();
      const out = {};
      for (const k of keys) { const c = await caches.open(k); out[k] = (await c.keys()).map((r) => new URL(r.url).pathname); }
      return out;
    });
    const names = Object.keys(caches);
    R.check(`cache names are gbq8-${publishId}-*`, names.length > 0 && names.every((n) => n.startsWith(`gbq8-${publishId}-`)), names);
    const all = Object.values(caches).flat();
    const need = [base + 'offline/', base + 'en/offline/', base + (site.build.assets || {}).css, base + (site.build.assets || {}).js];
    const missing = need.filter((u) => !all.some((x) => x === u || x === u + 'index.html'));
    R.check('precache: offline pages (ar+en), app css + js', !missing.length, { missing, cached: all.length });
    R.check('precache: products json', all.some((x) => x.endsWith((site.build.assets || {}).productsJson || '@@')), (site.build.assets || {}).productsJson);
    R.check('cross-origin images are not cached by the SW', !Object.values(caches).flat().some((x) => /wp-content/.test(x)));

    // offline: uncached product page (ar) and an uncached English page
    const p1 = site.products[site.products.length - 1];
    const p2 = site.products[site.products.length - 2];
    await page.goto(S.url('c/' + site.picks.category + '/'), { waitUntil: 'load' }); // cache one page while online
    await sleep(300);
    srv.offline = true;
    await S.ctx.setOffline(true);
    const tryOffline = async (route) => {
      try {
        await page.goto(S.url(route), { waitUntil: 'load', timeout: 15000 });
        await sleep(300);
        return await page.evaluate(() => ({ cls: document.body && document.body.className, lang: document.documentElement.lang, h1: (document.querySelector('h1') || {}).textContent, path: location.pathname }));
      } catch (e) { return { error: String(e.message || e).split('\n')[0] }; }
    };
    const o1 = await tryOffline(p1.s);
    R.check('offline + uncached Arabic page → offline page', o1 && /page-offline/.test(o1.cls || '') && (o1.lang || '').startsWith('ar'), o1);
    const o2 = await tryOffline('en/' + p2.s);
    R.check('offline + uncached English page → English offline page', o2 && /page-offline/.test(o2.cls || '') && (o2.lang || '').startsWith('en'), o2);
    const o3 = await tryOffline('c/' + site.picks.category + '/');
    R.check('offline + previously visited page → served from cache', o3 && /page-category/.test(o3.cls || ''), o3);
    const retry = await page.goto(S.url(p1.s), { waitUntil: 'load', timeout: 15000 }).then(() => page.locator('[data-action="pwa-retry"]').count(), () => 0);
    R.check('offline page offers a retry button', retry > 0, retry);
  } finally {
    srv.offline = false;
    await S.ctx.setOffline(false).catch(() => {});
    const errs = S.errors();
    R.check('PWA flow: 0 console errors (offline network errors excluded)', !errs.length, errs.slice(0, 5));
    await S.close();
  }
}
