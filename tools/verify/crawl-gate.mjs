// tools/verify/crawl-gate.mjs — gate 2 (SPEC §13.2): load EVERY generated HTML page (both locales) and require
// 0 console errors (+ "[GB]" warnings such as missing client i18n keys), 0 uncaught page errors and 0 failed or
// ≥400 same-origin requests. External requests are aborted; the expected aborted-image console lines are filtered.

import { session, pool, walk, fileToRoute } from './lib.mjs';

export async function crawlGate(R, env) {
  const { site, browser, srv, args } = env;
  const files = walk(site.outDir, (p) => p.endsWith('.html')).sort();
  const routes = files.map(fileToRoute);
  const jobs = Math.max(1, Math.min(args.jobs + 2, 10));
  const sessions = [];
  for (let i = 0; i < jobs; i++) sessions.push(await session(browser, srv, { vp: i % 2 ? 'm390' : 'd1280' }));
  const bad = [];
  let loaded = 0;
  const statusBad = [];
  await pool(routes, jobs, async (route, k, w) => {
    const S = sessions[w];
    // one page object per worker; reuse it
    const page = S.page;
    const before = { e: S.errs.length, f: S.fails.length };
    let resp = null;
    try {
      resp = await page.goto(S.url(route), { waitUntil: 'load', timeout: 20000 });
      await page.waitForTimeout(120);
      loaded++;
    } catch (e) {
      bad.push({ route, error: String(e.message || e).split('\n')[0] });
      return;
    }
    if (resp && resp.status() >= 400 && route !== '404.html') statusBad.push(`${route}: HTTP ${resp.status()}`);
    const errs = S.errs.slice(before.e);
    const fails = S.fails.slice(before.f);
    if (errs.length || fails.length) bad.push({ route, errors: errs.map((x) => x.text).slice(0, 4), failed: fails.map((x) => `${x.status || x.error} ${x.url.replace(S.origin, '')}`).slice(0, 4) });
  });
  for (const S of sessions) await S.close();
  R.check(`all ${routes.length} pages load (HTTP 200)`, loaded === routes.length && !statusBad.length, { loaded, statusBad: statusBad.slice(0, 10) });
  const withErr = bad.filter((b) => b.errors && b.errors.length);
  const withFail = bad.filter((b) => b.failed && b.failed.length);
  const crashed = bad.filter((b) => b.error);
  R.check('0 console errors on every page', !withErr.length, withErr.slice(0, 12).map((b) => ({ route: b.route, errors: b.errors })));
  R.check('0 failed same-origin requests on every page', !withFail.length, withFail.slice(0, 12).map((b) => ({ route: b.route, failed: b.failed })));
  R.check('no navigation errors', !crashed.length, crashed.slice(0, 10));
  // summarise distinct messages so a single bug repeated on 330 pages reads as one line
  if (withErr.length) {
    const distinct = {};
    withErr.forEach((b) => b.errors.forEach((t) => { distinct[t] = (distinct[t] || 0) + 1; }));
    R.check('distinct console errors (summary)', false, Object.entries(distinct).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => `${n}× ${t}`));
  }
}
