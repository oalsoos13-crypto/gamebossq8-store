// tools/verify/a11y-gate.mjs — gate 5 (SPEC §13.5): axe-core, 0 serious/critical violations on home, category,
// product (sale + out of stock), checkout (form, and with the error summary shown), search (results), wishlist,
// an info page and the 404 page — both locales, desktop and mobile — plus with the cart / search / menu dialogs open.

import { session, open, pool } from './lib.mjs';
import { seedFor } from './layout-gate.mjs';

async function runAxe(page, axeSource) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({
      id: v.id, impact: v.impact, n: v.nodes.length, help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 140), why: (n.failureSummary || '').split('\n').slice(1, 2).join(' ').slice(0, 160) })),
    }));
  });
}

export async function a11yGate(R, env) {
  const { site, browser, srv, args } = env;
  const { axeSource } = env.pw;
  const pk = site.picks;
  const seed = seedFor(site);
  const states = [
    { key: 'home', route: '' },
    { key: 'category', route: `c/${pk.category}/` },
    pk.sale && { key: 'product (sale)', route: pk.sale.s },
    pk.oos && { key: 'product (out of stock)', route: pk.oos.s },
    pk.noImage && { key: 'product (no image)', route: pk.noImage.s },
    { key: 'checkout', route: 'checkout/', ready: '#co-summary li' },
    { key: 'checkout (errors shown)', route: 'checkout/', ready: '#co-summary li', act: async (page) => { await page.locator('#checkout-form [name="name"]').fill(''); await page.locator('#co-submit').click(); await page.waitForTimeout(300); } },
    { key: 'search (results)', route: 'search/?q=' + encodeURIComponent('بيفا'), ready: '#search-results a[href*="/p/"]' },
    { key: 'wishlist', route: 'wishlist/', ready: '#wl-list > li' },
    { key: 'info', route: 'info/how-to-order/' },
    { key: '404', route: '404.html', noEn: true },
    { key: 'cart dialog open', route: '', dialog: 'gb-cart', ready2: '#gb-cart li[data-id]' },
    { key: 'search dialog with results', route: '', dialog: 'gb-search', type: 'ادبتر', ready2: '#gb-search-body a[href*="/p/"]' },
    { key: 'menu dialog open', route: '', dialog: 'gb-menu' },
  ].filter(Boolean);
  const tasks = [];
  for (const vp of ['d1280', 'm390']) for (const loc of ['ar', 'en']) for (const st of states) {
    if (st.noEn && loc === 'en') continue;
    if (vp === 'm390' && !['home', 'product (sale)', 'checkout', 'cart dialog open', 'search dialog with results', 'menu dialog open', 'category'].includes(st.key)) continue;
    tasks.push({ vp, loc, st });
  }
  const results = [];
  // one context per (vp, loc) worker group
  const groups = {};
  for (const t of tasks) (groups[t.vp + t.loc] = groups[t.vp + t.loc] || []).push(t);
  await pool(Object.values(groups), Math.max(2, Math.min(4, args.jobs)), async (list) => {
    const S = await session(browser, srv, { vp: list[0].vp });
    try {
      await S.seed(seed);
      for (const t of list) {
        const r = { ...t, st: t.st.key };
        try {
          const route = (t.loc === 'en' && t.st.route !== '404.html' ? 'en/' : '') + t.st.route;
          await open(S, route, { settle: 250 });
          if (t.st.ready) await S.page.waitForSelector(t.st.ready, { timeout: 6000 }).catch(() => { r.notReady = true; });
          if (t.st.act) await t.st.act(S.page);
          if (t.st.dialog) {
            await S.page.locator(`[data-dialog-open="${t.st.dialog}"]:visible`).first().click();
            await S.page.waitForFunction((d) => document.getElementById(d).open, t.st.dialog, { timeout: 5000 });
            if (t.st.type) await S.page.locator('#gb-search-input').fill(t.st.type);
            if (t.st.ready2) await S.page.waitForSelector(t.st.ready2, { timeout: 6000 }).catch(() => { r.notReady = true; });
            await S.page.waitForTimeout(250);
          }
          r.v = await runAxe(S.page, axeSource);
        } catch (e) { r.error = String(e.message || e).split('\n')[0]; }
        results.push(r);
      }
    } finally { await S.close(); }
  });
  const byState = {};
  for (const r of results) (byState[r.st] = byState[r.st] || []).push(r);
  for (const st of states) {
    const list = byState[st.key] || [];
    const bad = list.filter((r) => r.error || (r.v && r.v.length));
    const info = bad.map((r) => ({ at: `${r.vp} ${r.loc}`, error: r.error, violations: (r.v || []).map((v) => ({ id: v.id, impact: v.impact, n: v.n, nodes: v.nodes })) }));
    R.check(`axe 0 serious/critical: ${st.key} (${list.map((r) => r.vp + '/' + r.loc).join(', ')})`, list.length > 0 && !bad.length, info.slice(0, 4));
    const nr = list.filter((r) => r.notReady);
    if (nr.length) R.check(`axe ran on rendered content: ${st.key}`, false, nr.map((r) => `${r.vp} ${r.loc}`));
  }
}
