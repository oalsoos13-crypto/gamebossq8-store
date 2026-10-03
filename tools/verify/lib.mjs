// tools/verify/lib.mjs — shared plumbing for tools/verify.mjs (zero deps except Playwright/axe, loaded lazily).
//   • args / site discovery      • static server that behaves like GitHub Pages (404.html fallback, dir redirects)
//   • report recorder (gates → checks)   • Playwright session helper (aborts every external request, records
//     wa.me navigations, collects console errors / page errors / failed same-origin requests)   • small utils

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync, readdirSync, createReadStream } from 'node:fs';
import { join, dirname, extname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOLS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const REPO_DEFAULT = dirname(TOOLS_DIR);
export const SCR_DEFAULT = '/tmp/claude-0/-home-user-ddc-approval/e3d6f3de-b38c-5e2a-9697-1356406fa16a/scratchpad';

/* ------------------------------------------------------------------ args */
export function parseArgs(argv) {
  const a = { only: null, skip: [], site: null, out: null, repo: REPO_DEFAULT, shots: null, build: false, headed: false, jobs: 6, verbose: false, json: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`missing value for ${k}`); return x; };
    if (k === '--site') a.site = v();
    else if (k === '--out') a.out = v();
    else if (k === '--only') a.only = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--skip') a.skip = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--repo') a.repo = v();
    else if (k === '--shots') a.shots = v();
    else if (k === '--report') a.json = v();
    else if (k === '--jobs') a.jobs = Math.max(1, parseInt(v(), 10) || 6);
    else if (k === '--build') a.build = true;
    else if (k === '--headed') a.headed = true;
    else if (k === '--verbose' || k === '-v') a.verbose = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

/** Locate the generated site: `--site <web root containing gamebossq8-store/>` or `--out <the gamebossq8-store dir>`. */
export function findSite(args) {
  let webRoot, outDir;
  if (args.out) { outDir = resolve(args.out); webRoot = dirname(outDir); }
  else if (args.site) {
    webRoot = resolve(args.site);
    const def = join(webRoot, 'gamebossq8-store');
    if (existsSync(join(def, 'build.json')) || args.build) outDir = def;
    else {
      const cand = existsSync(webRoot) ? readdirSync(webRoot).map((d) => join(webRoot, d)).filter((d) => existsSync(join(d, 'build.json'))) : [];
      outDir = cand[0] || def;
    }
  } else throw new Error('pass --site <dir containing gamebossq8-store/> (or --out <dir>/gamebossq8-store)');
  return { webRoot, outDir };
}

/** Load build.json + products json + derived picks. */
export function loadSite(webRoot, outDir) {
  const build = JSON.parse(readFileSync(join(outDir, 'build.json'), 'utf8'));
  const base = build.base || '/gamebossq8-store/';
  const rel = relative(webRoot, outDir).split(sep).join('/');
  if ('/' + rel + '/' !== base) throw new Error(`site layout mismatch: ${outDir} is served at /${rel}/ but build.json base is ${base}`);
  const productsPath = build.assets && build.assets.productsJson;
  const products = productsPath && existsSync(join(outDir, productsPath)) ? JSON.parse(readFileSync(join(outDir, productsPath), 'utf8')) : [];
  const byId = new Map(products.map((p) => [String(p.id), p]));
  return { webRoot, outDir, build, base, products, byId, publishId: build.publishId, prodOrigin: build.origin, picks: pickProducts(products) };
}

const nameLen = (p) => Math.max([...(p.n.ar || '')].length, [...(p.n.en || '')].length);
/** Representative products for overflow / flows (deterministic). */
export function pickProducts(products) {
  if (!products.length) return {};
  const byLen = [...products].sort((a, b) => nameLen(b) - nameLen(a) || String(a.id).localeCompare(String(b.id)));
  const inStock = byLen.filter((p) => p.a === 'in_stock');
  const used = new Set();
  const take = (list) => { const p = list.find((x) => !used.has(x.id)) || list[0] || null; if (p) used.add(p.id); return p; };
  const longName = take(byLen.filter((p) => p.img)) || take(byLen);
  const sale = take(inStock.filter((p) => p.c && p.img));
  const noImage = take(byLen.filter((p) => !p.img && p.a === 'in_stock')) || take(byLen.filter((p) => !p.img));
  const oos = take(byLen.filter((p) => p.a === 'out_of_stock'));
  const backorder = products.find((p) => p.a === 'backorder') || null;
  const cheap = [...inStock].sort((a, b) => a.p - b.p);
  // the category with the most products that has a sale item, ≥2 brands and at least one non in_stock product
  const cats = {};
  for (const p of products) (cats[p.cat] = cats[p.cat] || []).push(p);
  const catScore = Object.entries(cats).map(([id, list]) => ({
    id, n: list.length, sale: list.some((p) => p.c), brands: new Set(list.map((p) => p.b).filter(Boolean)).size,
    nonStock: list.some((p) => p.a !== 'in_stock'),
  }));
  const rich = catScore.filter((c) => c.sale && c.brands >= 2 && c.nonStock).sort((a, b) => b.n - a.n)[0] || catScore.sort((a, b) => b.n - a.n)[0];
  return {
    longName, sale, noImage, oos, backorder, category: rich && rich.id,
    inStock: inStock.slice(), // longest names first
    cheapest: cheap[0] || null,
    under: (fils) => cheap.filter((p) => p.p < fils),
  };
}

/* ------------------------------------------------------------------ static server (GitHub Pages-like) */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

/**
 * Serve `root` on 127.0.0.1:<free port>. Missing paths under `base` get `<base>404.html` with status 404 (like Pages);
 * a directory without a trailing slash gets a 301. `srv.offline = true` drops every connection (simulates no network).
 */
export function serve(root, base) {
  const srv = { root, base, offline: false, log: [], port: 0, origin: '' };
  const sockets = new Set();
  const server = createServer((req, res) => {
    if (srv.offline) { req.socket.destroy(); return; }
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
    const file = resolve(join(root, path));
    if (!file.startsWith(resolve(root))) { res.writeHead(403); res.end(); return; }
    const send = (f, status) => {
      const type = TYPES[extname(f).toLowerCase()] || 'application/octet-stream';
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
      if (req.method === 'HEAD') { res.end(); return; }
      createReadStream(f).pipe(res);
    };
    let st = null;
    try { st = statSync(file); } catch { st = null; }
    if (st && st.isDirectory()) {
      if (!path.endsWith('/')) { res.writeHead(301, { location: path + '/' + (new URL(req.url, 'http://x').search || '') }); res.end(); return; }
      const idx = join(file, 'index.html');
      if (existsSync(idx)) { srv.log.push([200, path]); return send(idx, 200); }
      st = null;
    }
    if (st && st.isFile()) { srv.log.push([200, path]); return send(file, 200); }
    srv.log.push([404, path]);
    const nf = join(root, base, '404.html');
    if (path.startsWith(base) && existsSync(nf)) return send(nf, 404);
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  srv.start = () => new Promise((ok, ko) => {
    server.once('error', ko);
    server.listen(0, '127.0.0.1', () => { srv.port = server.address().port; srv.origin = `http://127.0.0.1:${srv.port}`; ok(srv); });
  });
  srv.stop = () => new Promise((ok) => { for (const s of sockets) s.destroy(); server.close(() => ok()); });
  return srv;
}

/* ------------------------------------------------------------------ report */
export class Report {
  constructor(meta) { this.meta = meta; this.gates = []; this.current = null; }
  gate(id, title) {
    const g = { id, title, checks: [], startedAt: Date.now(), ms: 0, error: null };
    this.gates.push(g);
    this.current = g;
    return g;
  }
  check(name, pass, info) {
    const g = this.current;
    const c = { name, pass: !!pass };
    if (info !== undefined && info !== null && !(Array.isArray(info) && !info.length && pass)) c.info = info;
    g.checks.push(c);
    if (this.onCheck) this.onCheck(g, c);
    return !!pass;
  }
  /** Run fn; an exception becomes a failed check named `name`. Returns fn's value or undefined. */
  async step(name, fn) {
    try { return await fn(); } catch (e) {
      this.check(name, false, { error: String((e && e.message) || e).split('\n').slice(0, 6).join('\n') });
      return undefined;
    }
  }
  end(g) { g.ms = Date.now() - g.startedAt; }
  summary() {
    const gates = this.gates.map((g) => {
      const failed = g.checks.filter((c) => !c.pass).length;
      return { id: g.id, title: g.title, pass: failed === 0 && !g.error && g.checks.length > 0, checks: g.checks.length, failed, ms: g.ms, error: g.error };
    });
    return { pass: gates.every((g) => g.pass), gates };
  }
  toJSON() { return { ...this.meta, finishedAt: new Date().toISOString(), summary: this.summary(), gates: this.gates }; }
}

/* ------------------------------------------------------------------ Playwright */
let PW = null;
export function playwright() {
  if (PW) return PW;
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const tries = [process.env.GB_VERIFY_NODE_MODULES && join(process.env.GB_VERIFY_NODE_MODULES, '..', 'package.json'),
    join(SCR_DEFAULT, 'v2', 'package.json'), join(SCR_DEFAULT, 'audit', 'package.json'), join(REPO_DEFAULT, 'package.json'), import.meta.url].filter(Boolean);
  let lastErr;
  for (const t of tries) {
    try {
      const req = createRequire(t);
      const pw = req('playwright');
      const axePath = req.resolve('axe-core/axe.min.js');
      PW = { chromium: pw.chromium, axeSource: readFileSync(axePath, 'utf8') };
      return PW;
    } catch (e) { lastErr = e; }
  }
  throw new Error('cannot load playwright + axe-core (tried SCR/v2, SCR/audit node_modules, NODE_PATH): ' + (lastErr && lastErr.message));
}

export const VIEWPORTS = {
  m320: { width: 320, height: 700, mobile: true },
  m360: { width: 360, height: 740, mobile: true },
  m390: { width: 390, height: 844, mobile: true },
  m414: { width: 414, height: 896, mobile: true },
  t768: { width: 768, height: 1024, mobile: false },
  d1280: { width: 1280, height: 800, mobile: false },
};

const WA_HOSTS = new Set(['wa.me', 'api.whatsapp.com', 'web.whatsapp.com']);

/**
 * New browser context + page bound to one served site.
 * opts: { vp: 'm390' | {width,height,mobile}, sw: false (block service workers), allow404: false, permissions, offlineOk }
 * Returns a session: { ctx, page, origin, base, url(path), errors(), failed(), wa: [urls], newPage(), close() }.
 */
export async function session(browser, srv, opts = {}) {
  const vp = typeof opts.vp === 'string' ? VIEWPORTS[opts.vp] : (opts.vp || VIEWPORTS.m390);
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1,
    serviceWorkers: opts.sw ? 'allow' : 'block',
    reducedMotion: 'reduce',
    locale: opts.locale || 'ar-KW',
    permissions: opts.permissions || [],
  });
  ctx.setDefaultTimeout(opts.timeout || 12000);
  ctx.setDefaultNavigationTimeout(opts.timeout || 20000);
  const S = { ctx, srv, origin: srv.origin, base: srv.base, wa: [], external: new Set(), errs: [], fails: [], pages: [] };
  await ctx.route('**/*', (route) => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch { return route.abort(); }
    if (u.origin === srv.origin) return route.continue();
    if (WA_HOSTS.has(u.hostname)) {
      S.wa.push(req.url());
      // 204 keeps the current document (the checkout's "one last step" state stays testable)
      return route.fulfill({ status: 204, body: '' });
    }
    S.external.add(u.host);
    return route.abort('failed');
  });
  S.track = (page) => {
    S.pages.push(page);
    page.on('console', (m) => {
      const type = m.type();
      const text = m.text();
      const loc = (m.location() && m.location().url) || '';
      if (type === 'error') {
        // aborted external resources (product images on gamebossq8.com etc.) are expected
        if (/Failed to load resource/.test(text) && loc && !loc.startsWith(srv.origin)) return;
        if (/Failed to load resource/.test(text) && /net::ERR_FAILED/.test(text) && !loc) return;
        if (opts.allow404 && /status of 404/.test(text)) return;
        if (opts.offlineOk && /Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_FAILED|ERR_CONNECTION|ERR_EMPTY_RESPONSE/.test(text)) return;
        S.errs.push({ url: page.url(), text: text.slice(0, 400), at: loc });
      } else if (type === 'warning' && /^\[GB\]/.test(text)) {
        S.errs.push({ url: page.url(), text: 'console.warn ' + text.slice(0, 300) });
      }
    });
    page.on('pageerror', (e) => S.errs.push({ url: page.url(), text: 'pageerror: ' + String(e.message || e).slice(0, 400) }));
    page.on('requestfailed', (r) => {
      const u = r.url();
      if (!u.startsWith(srv.origin)) return;
      const f = r.failure() && r.failure().errorText;
      if (/ERR_ABORTED/.test(f || '')) return; // navigation away / cancelled by the page
      if (opts.offlineOk) return;
      S.fails.push({ url: u, error: f, page: page.url() });
    });
    page.on('response', (r) => {
      const u = r.url();
      if (!u.startsWith(srv.origin) || r.status() < 400) return;
      if (opts.allow404 && r.status() === 404 && r.request().isNavigationRequest()) return;
      S.fails.push({ url: u, status: r.status(), page: page.url() });
    });
    return page;
  };
  S.newPage = async () => S.track(await ctx.newPage());
  S.page = await S.newPage();
  S.url = (p = '') => srv.origin + srv.base + String(p).replace(/^\//, '');
  S.errors = () => S.errs.slice();
  S.failed = () => S.fails.slice();
  S.clean = () => { S.errs.length = 0; S.fails.length = 0; };
  S.close = () => ctx.close().catch(() => {});
  /** Write localStorage on the site origin before the first real page load. */
  S.seed = async (items, page = S.page) => {
    await page.goto(S.url('robots.txt'));
    await page.evaluate((it) => {
      localStorage.clear();
      for (const [k, v] of Object.entries(it || {})) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }, items);
  };
  return S;
}

/** goto + wait for the app to boot (GB started) and the network to settle a little. */
export async function open(S, path, { page = S.page, wait = 'load', settle = 250 } = {}) {
  const resp = await page.goto(S.url(path), { waitUntil: wait });
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => (document.fonts && document.fonts.ready) || null).catch(() => {});
  if (settle) await page.waitForTimeout(settle);
  return resp;
}

/* ------------------------------------------------------------------ utils */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async (_, w) => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k, w); }
  });
  await Promise.all(workers);
  return out;
}

export function walk(dir, filter = () => true, out = [], rootDir = dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, out, rootDir);
    else if (filter(p)) out.push(relative(rootDir, p).split(sep).join('/'));
  }
  return out;
}

/** 'p/x-1/index.html' → 'p/x-1/' ; '404.html' → '404.html' (route relative to BASE). */
export const fileToRoute = (rel) => (rel === 'index.html' ? '' : rel.endsWith('/index.html') ? rel.slice(0, -'index.html'.length) : rel);

export const amount = (f) => (Math.round(f) / 1000).toFixed(3);
export const money = (f, loc) => amount(f) + (loc === 'en' ? ' KWD' : ' د.ك');

/** SPEC §8 Arabic search normalisation (independent re-implementation for expectations). */
export function normAr(s) {
  return String(s || '').toLowerCase()
    .replace(/[ً-ٰٟۖ-ۭ]/g, '').replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6F0))
    .replace(/\s+/g, ' ').trim();
}

export const idFromHref = (href) => { const m = /-(\d+)\/?(?:[?#].*)?$/.exec(String(href || '')); return m ? m[1] : null; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const short = (v, n = 160) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };
