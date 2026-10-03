#!/usr/bin/env node
// tools/verify.mjs — the automated quality gate for the GameBoss Q8 storefront (SPEC §13). Exit code 1 on any failure.
//
//   node tools/verify.mjs --site <web root that contains gamebossq8-store/>      (or: --out <web root>/gamebossq8-store)
//        [--only build,unit,crawl,overflow,flows,a11y,pwa,shots]  [--skip …]  [--build]  [--jobs 6]
//        [--repo <source repo, default: this checkout>]  [--shots <dir>]  [--report <file>]  [--verbose]
//
// Gates:
//   build     static asserts on the generated files: 165 products, unique ids/slugs, prices, categories non-empty,
//             every internal href/src resolves (both locales), sitemap URLs exist, JSON-LD parses, SEO + honesty rules
//   unit      tools/verify/cart-message.test.mjs (WhatsApp message builder unit tests, owned by the cart module)
//   crawl     every generated HTML page: 0 console errors, 0 failed same-origin requests
//   overflow  scrollWidth ≤ innerWidth at 320/360/390/414 (isMobile) + 768/1280 on all listed page types, both locales
//   flows     cart, legacy migration, out-of-stock, dialogs, search (Arabic variants), category sort/filter/URL state,
//             wishlist, checkout validation + Arabic digits + wa.me message, confirmation, delivery-confirmed variant
//             (a second build with --set delivery.confirmed=true), 20-item cap, 404 recovery, storage disabled
//   a11y      axe-core: 0 serious/critical on the listed pages (both locales) and with dialogs open
//   pwa       manifest + icons, SW registration on localhost, caches, offline fallback for an uncached page
//   shots     390×844 + 1280×800 screenshots of home/category/product/checkout/cart per locale
//
// The site is served by a built-in static server that behaves like GitHub Pages (missing paths → <base>404.html with
// status 404, directory redirects). Every request to any other origin is aborted (gamebossq8.com product images,
// fonts CDNs, analytics…); navigations to wa.me are intercepted (204) and recorded so the order message can be decoded.
// Output: a readable console summary, <site>/verify-report.json, screenshots in SCR/v2/shots/ (or --shots).
// Needs Playwright + axe-core (resolved from SCR/v2 or SCR/audit node_modules, or NODE_PATH); Chromium from
// PLAYWRIGHT_BROWSERS_PATH (default /opt/pw-browsers). Never runs `playwright install`.

import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseArgs, findSite, loadSite, serve, Report, playwright, SCR_DEFAULT, short } from './verify/lib.mjs';
import { buildGate } from './verify/build-gate.mjs';
import { crawlGate } from './verify/crawl-gate.mjs';
import { overflowGate, shotsGate } from './verify/layout-gate.mjs';
import { flowsGate } from './verify/flows-gate.mjs';
import { a11yGate } from './verify/a11y-gate.mjs';
import { pwaGate } from './verify/pwa-gate.mjs';

const GATES = [
  ['build', 'Build asserts (generated files)', buildGate, false],
  ['unit', 'Order-message unit tests', unitGate, false],
  ['crawl', 'Crawl: every page, 0 console errors / failed requests', crawlGate, true],
  ['overflow', 'No horizontal overflow (320–1280, both locales)', overflowGate, true],
  ['flows', 'Customer flows', flowsGate, true],
  ['a11y', 'axe-core: 0 serious/critical', a11yGate, true],
  ['pwa', 'PWA: manifest, icons, service worker, offline', pwaGate, true],
  ['shots', 'Screenshots', shotsGate, true],
];

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` }
  : { g: (s) => s, r: (s) => s, y: (s) => s, b: (s) => s, d: (s) => s };

function usage() {
  console.log(`usage: node tools/verify.mjs --site <dir containing gamebossq8-store/> [--only ${GATES.map((g) => g[0]).join(',')}] [--skip …] [--build] [--jobs N] [--repo <dir>] [--shots <dir>] [--report <file>] [--verbose]`);
}

async function unitGate(R, env) {
  const test = join(env.args.repo, 'tools/verify/cart-message.test.mjs');
  if (!existsSync(test)) { R.check('cart-message.test.mjs present', false, test); return; }
  const r = spawnSync(process.execPath, [test], { cwd: env.args.repo, encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const tail = out.trim().split('\n').slice(-12);
  R.check('tools/verify/cart-message.test.mjs exits 0', r.status === 0, r.status === 0 ? tail.slice(-1) : tail);
}

function runBuild(repo, outDir, extra = []) {
  const r = spawnSync(process.execPath, [join(repo, 'tools/build.mjs'), '--out', outDir, '--quiet', ...extra], { cwd: repo, encoding: 'utf8', timeout: 180000 });
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); usage(); process.exit(2); }
  if (args.help) { usage(); return; }
  args.repo = resolve(args.repo);
  args.shots = resolve(args.shots || join(SCR_DEFAULT, 'v2', 'shots'));
  const { webRoot, outDir } = findSite(args);
  const t0 = Date.now();
  const R = new Report({ tool: 'tools/verify.mjs', startedAt: new Date().toISOString(), site: webRoot, out: outDir, repo: args.repo, argv: process.argv.slice(2) });
  const selected = GATES.filter(([id]) => (!args.only || args.only.includes(id)) && !args.skip.includes(id));
  const unknown = (args.only || []).concat(args.skip).filter((x) => !GATES.some((g) => g[0] === x));
  if (unknown.length) { console.error('unknown gate(s): ' + unknown.join(', ')); usage(); process.exit(2); }

  console.log(C.b('GameBoss Q8 — verify') + C.d(`  site=${webRoot}`));
  if (args.build) {
    process.stdout.write(C.d(`building ${outDir} … `));
    const b = runBuild(args.repo, outDir, ['--strict']);
    console.log(b.ok ? C.g('ok') : C.r('FAILED'));
    if (!b.ok) { console.log(b.out.split('\n').slice(-20).join('\n')); process.exit(1); }
  }
  if (!existsSync(join(outDir, 'build.json'))) { console.error(C.r(`no build.json in ${outDir} — build first (or pass --build)`)); process.exit(1); }
  const site = loadSite(webRoot, outDir);
  R.meta.publishId = site.publishId;
  R.meta.picks = Object.fromEntries(Object.entries(site.picks).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && v.id).map(([k, v]) => [k, `${v.id} ${v.s}`]));
  R.meta.picks.category = site.picks.category;
  console.log(C.d(`publishId=${site.publishId} products=${site.products.length} picks: ${Object.entries(R.meta.picks).map(([k, v]) => `${k}=${String(v).split(' ')[0]}`).join(' ')}`));

  const needBrowser = selected.some((g) => g[3]);
  const servers = [];
  const temps = [];
  let browser = null;
  const env = { args, site, pw: null, browser: null, srv: null };
  R.onCheck = (g, c) => { if (!c.pass || args.verbose) console.log(`    ${c.pass ? C.g('✓') : C.r('✗')} ${c.name}${!c.pass && c.info !== undefined ? C.d('  ' + short(c.info, 600)) : ''}`); };
  try {
    if (needBrowser) {
      env.pw = playwright();
      const srv = serve(webRoot, site.base);
      await srv.start();
      servers.push(srv);
      env.srv = srv;
      browser = await env.pw.chromium.launch({ headless: !args.headed });
      env.browser = browser;
      console.log(C.d(`serving ${srv.origin}${site.base}  (external requests aborted)`));
      // lazily build + serve a variant of the site (e.g. delivery.confirmed=true) in a temp dir
      env.variant = async (extra) => {
        const dir = mkdtempSync(join(tmpdir(), 'gbq8-verify-'));
        temps.push(dir);
        const vOut = join(dir, site.base.replace(/^\/|\/$/g, '') || 'site');
        const b = runBuild(args.repo, vOut, ['--base', site.base, '--origin', site.prodOrigin, ...extra]);
        if (!b.ok) throw new Error('variant build failed: ' + b.out.split('\n').slice(-5).join(' | '));
        const vs = serve(dir, site.base);
        await vs.start();
        servers.push(vs);
        return vs;
      };
    }
    for (const [id, title, fn] of selected) {
      const g = R.gate(id, title);
      console.log(`\n${C.b('▶ ' + id)} ${C.d(title)}`);
      try { await fn(R, env); } catch (e) {
        g.error = String((e && e.stack) || e).split('\n').slice(0, 4).join('\n');
        console.log('    ' + C.r('gate crashed: ') + g.error);
      }
      R.end(g);
      const failed = g.checks.filter((c) => !c.pass).length;
      console.log(`  ${failed || g.error ? C.r('FAIL') : C.g('PASS')} ${g.checks.length - failed}/${g.checks.length} checks ${C.d(`(${(g.ms / 1000).toFixed(1)}s)`)}`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const s of servers) await s.stop().catch(() => {});
    for (const d of temps) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
  }

  const sum = R.summary();
  const reportFile = resolve(args.json || join(webRoot, 'verify-report.json'));
  const json = R.toJSON();
  json.ms = Date.now() - t0;
  writeFileSync(reportFile, JSON.stringify(json, null, 2));
  console.log('\n' + C.b('Summary'));
  for (const g of sum.gates) console.log(`  ${g.pass ? C.g('PASS') : C.r('FAIL')}  ${g.id.padEnd(9)} ${String(g.checks - g.failed).padStart(4)}/${String(g.checks).padEnd(4)} ${C.d(g.title)}${g.error ? C.r('  (crashed)') : ''}`);
  const failedChecks = R.gates.flatMap((g) => g.checks.filter((c) => !c.pass).map((c) => `[${g.id}] ${c.name}`));
  if (failedChecks.length) {
    console.log('\n' + C.r(`${failedChecks.length} failing check(s):`));
    failedChecks.slice(0, 60).forEach((x) => console.log('  - ' + x));
    if (failedChecks.length > 60) console.log(`  … ${failedChecks.length - 60} more in the report`);
  }
  console.log(`\n${sum.pass ? C.g('ALL GATES PASSED') : C.r('VERIFY FAILED')}  ${C.d(`${((Date.now() - t0) / 1000).toFixed(1)}s · report ${reportFile}${selected.some((g) => g[0] === 'shots') ? ' · shots ' + args.shots : ''}`)}`);
  process.exitCode = sum.pass ? 0 : 1;
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
