#!/usr/bin/env node
// tools/build.mjs — GameBoss Q8 static site generator (zero npm dependencies; Node ≥ 20).
//
//   node tools/build.mjs [--out <dir>] [--base /gamebossq8-store/] [--origin https://oalsoos13-crypto.github.io]
//                        [--year 2026] [--built-at <iso>] [--set key.path=value]… [--strict] [--quiet]
//
//   --out       output directory (default: the repo root — agents MUST pass their own temp dir)
//   --base      URL base path (default config.base). Always starts and ends with '/'.
//   --origin    site origin for canonical/OG/sitemap (default config.origin)
//   --year      © year in the footer (default config.year)
//   --built-at  optional timestamp written to build.json (omitted by default → reproducible output)
//   --set       override any config value: --set delivery.confirmed=true --set indexable=false
//               values parse as JSON when possible (true/false/null/numbers/"quoted"/[..]/{..}), else string
//   --strict    fail (exit 1) when generated HTML contains internal links that resolve to no generated file
//   --quiet     only print errors and the final summary line
//
// Pipeline: load data → merge i18n → validate → bundle CSS/JS (hashed) → products.<hash>.json → copy
// src/static/** → run every src/pages/*.mjs (not starting with '_') once per locale → write outputs →
// .nojekyll, build.json, .build-manifest.json → delete files that only the PREVIOUS build produced.
// See src/CONTRACTS.md for the page-module contract.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const T0 = performance.now();
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(REPO, 'src');
const DATA = path.join(REPO, 'data');

const core = await import(pathToFileURL(path.join(SRC, 'core', 'index.mjs')).href);
const { makeUrl, normBase, makeT, money, moneyHtml, amount, indexData, validateData, productRoute, categoryRoute, outPath } = core;

// ------------------------------------------------------------------------------------------- CLI
function parseArgs(argv) {
  const o = { set: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const [k, inline] = a.startsWith('--') && eq > 0 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, undefined];
    const next = () => (inline !== undefined ? inline : argv[++i]);
    switch (k) {
      case '--out': o.out = next(); break;
      case '--base': o.base = next(); break;
      case '--origin': o.origin = next(); break;
      case '--year': o.year = next(); break;
      case '--built-at': o.builtAt = next(); break;
      case '--set': o.set.push(next()); break;
      case '--strict': o.strict = true; break;
      case '--quiet': o.quiet = true; break;
      case '--help': case '-h':
        console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
        process.exit(0);
      // eslint-disable-next-line no-fallthrough
      default: fail(`unknown argument "${a}" (see --help)`);
    }
  }
  return o;
}
function fail(msg) { console.error(`build: ERROR: ${msg}`); process.exit(1); }
const args = parseArgs(process.argv.slice(2));
const log = (...m) => { if (!args.quiet) console.log(...m); };

function parseValue(v) { try { return JSON.parse(v); } catch { return v; } }
function setPath(obj, keyPath, value) {
  const keys = keyPath.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (o[k] === undefined || o[k] === null || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

// ------------------------------------------------------------------------------------------- data
const readRaw = (p) => fs.readFileSync(p, 'utf8');
const readJson = (p) => { try { return JSON.parse(readRaw(p)); } catch (e) { fail(`${path.relative(REPO, p)}: ${e.message}`); } };

const rawCatalog = readRaw(path.join(DATA, 'catalog.json'));
const rawConfig = readRaw(path.join(DATA, 'config.json'));
const config = JSON.parse(rawConfig);
const catalog = JSON.parse(rawCatalog);
const categories = readJson(path.join(DATA, 'categories.json'));

for (const s of args.set) {
  const i = s.indexOf('=');
  if (i < 1) fail(`--set expects key.path=value, got "${s}"`);
  setPath(config, s.slice(0, i), parseValue(s.slice(i + 1)));
}
if (args.base !== undefined) config.base = args.base;
if (args.origin !== undefined) config.origin = args.origin;
if (args.year !== undefined) config.year = Number(args.year);
config.base = normBase(config.base);
config.origin = String(config.origin).replace(/\/+$/, '');
if (!Number.isInteger(config.year)) fail('--year must be an integer');

const dataErrors = validateData({ catalog, categories });
if (dataErrors.length) fail(`data validation failed:\n  - ${dataErrors.slice(0, 40).join('\n  - ')}${dataErrors.length > 40 ? `\n  … ${dataErrors.length - 40} more` : ''}`);

const publishId = crypto.createHash('sha1').update(rawCatalog).update(rawConfig)
  .update(args.set.length ? JSON.stringify(args.set) : '').digest('hex').slice(0, 8);

// ------------------------------------------------------------------------------------------- i18n
function loadI18n() {
  const files = [path.join(DATA, 'i18n.json')];
  const dir = path.join(SRC, 'i18n');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) files.push(path.join(dir, f));
  const dict = {}, owner = {};
  const errs = [];
  for (const f of files) {
    const rel = path.relative(REPO, f);
    const obj = readJson(f);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { errs.push(`${rel}: must be a flat object { "ns.key": { "ar": …, "en": … } }`); continue; }
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('$')) continue; // "$comment" etc.
      if (owner[k]) { errs.push(`duplicate i18n key "${k}" in ${rel} (already defined in ${owner[k]})`); continue; }
      if (!/^[A-Za-z][\w-]*(\.[\w-]+)+$/.test(k)) errs.push(`${rel}: key "${k}" must be namespaced like "ns.name"`);
      if (!v || typeof v !== 'object' || v.ar === undefined || v.en === undefined) { errs.push(`${rel}: "${k}" needs both "ar" and "en"`); continue; }
      for (const loc of ['ar', 'en']) {
        const val = v[loc];
        if (typeof val === 'string') { if (!val) errs.push(`${rel}: "${k}".${loc} is empty`); }
        else if (!val || typeof val !== 'object' || typeof val.other !== 'string') errs.push(`${rel}: "${k}".${loc} must be a string or a plural object with "other"`);
      }
      owner[k] = rel;
      dict[k] = v;
    }
  }
  if (errs.length) fail(`i18n:\n  - ${errs.join('\n  - ')}`);
  return { dict, files: files.map((f) => path.relative(REPO, f)) };
}
const { dict: I18N, files: i18nFiles } = loadI18n();

// ------------------------------------------------------------------------------------------- output plumbing
const OUT = path.resolve(args.out || REPO);
const PROTECTED = ['src/', 'data/', 'tools/', 'docs/', '.git/', '.github/', 'node_modules/', 'README.md', '.gitignore', 'CNAME'];
const isProtected = (rel) => OUT === REPO && PROTECTED.some((p) => (p.endsWith('/') ? rel.startsWith(p) || rel + '/' === p : rel === p));
const written = new Map(); // rel path → { origin, hash }

function safeRel(rel, origin) {
  const r = String(rel).replace(/\\/g, '/');
  if (!r || r.startsWith('/') || r.split('/').some((s) => s === '..' || s === '.') || /[\0<>:"|?*]/.test(r)) fail(`${origin}: invalid output path "${rel}"`);
  if (isProtected(r)) fail(`${origin}: refusing to write protected path "${r}"`);
  if (r === '.build-manifest.json' || r === 'build.json' || r === '.nojekyll') { if (origin !== 'build') fail(`${origin}: "${r}" is reserved for the build`); }
  return r;
}
function emit(rel, content, origin) {
  const r = safeRel(rel, origin);
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  const hash = crypto.createHash('sha1').update(buf).digest('hex');
  if (written.has(r)) {
    const prev = written.get(r);
    if (prev.hash === hash) return r;
    fail(`output collision: "${r}" emitted by ${prev.origin} and ${origin} with different content`);
  }
  const abs = path.join(OUT, r);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  written.set(r, { origin, hash });
  return r;
}
const hash8 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);

const prevManifestPath = path.join(OUT, '.build-manifest.json');
let prevFiles = [];
if (fs.existsSync(prevManifestPath)) {
  try { prevFiles = JSON.parse(readRaw(prevManifestPath)).files || []; } catch { prevFiles = []; }
}
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------------------------------- static files
const STATIC = path.join(SRC, 'static');
function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else if (e.isFile() && e.name !== '.DS_Store') out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out.sort();
}
const staticFiles = walk(STATIC);
for (const rel of staticFiles) emit(rel, fs.readFileSync(path.join(STATIC, rel)), 'src/static');
const hasStatic = (rel) => staticFiles.includes(rel);

// ------------------------------------------------------------------------------------------- CSS / JS bundles
function listSrc(dir, ext) {
  const d = path.join(SRC, dir);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(ext) && !f.startsWith('_')).sort() : [];
}
function minifyCss(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}
const cssFiles = listSrc('css', '.css');
const css = cssFiles.map((f) => `/* ${f} */\n` + minifyCss(readRaw(path.join(SRC, 'css', f)))).join('\n');
const cssRel = emit(`assets/app.${hash8(css)}.css`, css, 'css');

const jsFiles = listSrc('js', '.js');
const jsParts = [];
for (const f of jsFiles) {
  const code = readRaw(path.join(SRC, 'js', f));
  try { new vm.Script(`'use strict';{\n${code}\n}`, { filename: `src/js/${f}` }); } catch (e) {
    fail(`src/js/${f}: syntax error: ${e.message}${e.stack ? '\n' + e.stack.split('\n').slice(0, 3).join('\n') : ''}`);
  }
  // each module is its own block (const/let/function stay private) and a crash in one module never stops the others
  jsParts.push(`/* ---- ${f} ---- */\ntry {\n${code}\n} catch (e) { console.error('[GB] src/js/${f} failed to initialise', e); }`);
}
// The bundle ends by calling GB.start(), which runs every GB.ready(fn) callback in registration order.
const js = `/*! GameBoss Q8 · ${publishId} */\n(function () {\n'use strict';\nconst GB = window.GB = window.GB || {};\n${jsParts.join('\n')}\nif (window.GB && typeof window.GB.start === 'function') window.GB.start();\n})();\n`;
const jsRel = emit(`assets/app.${hash8(js)}.js`, js, 'js');

// ------------------------------------------------------------------------------------------- products.json
const data = indexData({ config, catalog, categories });
const compact = data.products.map((p) => ({
  id: p.id, s: productRoute(p), n: { ar: p.name.ar, en: p.name.en }, p: p.priceFils, c: p.compareAtFils,
  cat: p.category, img: p.images[0] || null, a: p.availability, b: p.brand || null,
  // flags only when true (keeps the file small): f = featured, nw = isNew ("جديد" badge)
  ...(p.featured ? { f: 1 } : {}), ...(p.isNew ? { nw: 1 } : {}),
}));
// category → art icon key, embedded in #gb-config so client-rendered cards (GB.ui.card) need no page data
const catIcons = Object.fromEntries(data.categories.map((c) => [c.id, c.icon]));
const productsJson = JSON.stringify(compact);
const productsRel = emit(`assets/products.${hash8(productsJson)}.json`, productsJson, 'products');

// ------------------------------------------------------------------------------------------- page modules
const PAGES = path.join(SRC, 'pages');
const pageFiles = fs.existsSync(PAGES) ? fs.readdirSync(PAGES).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort() : [];
const modules = [];
for (const f of pageFiles) {
  let mod;
  try { mod = await import(pathToFileURL(path.join(PAGES, f)).href); } catch (e) { fail(`src/pages/${f}: failed to import: ${e.stack || e.message}`); }
  if (typeof mod.default !== 'function') fail(`src/pages/${f}: must default-export function routes(ctx)`);
  modules.push({ file: f, routes: mod.default, provides: Array.isArray(mod.provides) ? mod.provides : [] });
}
const provided = new Set(modules.flatMap((m) => m.provides));

const U = makeUrl({ base: config.base, origin: config.origin, defaultLocale: config.defaultLocale || 'ar' });
const fontRel = (w, s) => `assets/fonts/tajawal-${w}-${s}.woff2`;
const assets = {
  css: U.asset(cssRel),
  js: U.asset(jsRel),
  productsJson: U.asset(productsRel),
  favicon: U.asset('favicon.svg'),
  icon32: hasStatic('assets/icons/icon-32.png') ? U.asset('assets/icons/icon-32.png') : null,
  appleTouch: hasStatic('assets/icons/apple-touch-icon.png') ? U.asset('assets/icons/apple-touch-icon.png') : null,
  ogImage: hasStatic('assets/icons/og-default.png') ? U.abs('assets/icons/og-default.png') : null,
  logo: hasStatic('assets/icons/icon-512.png') ? config.origin + U.asset('assets/icons/icon-512.png') : null,
  manifest: provided.has('manifest.webmanifest') ? U.asset('manifest.webmanifest') : null,
  sw: provided.has('sw.js') ? U.asset('sw.js') : null,
  fonts: Object.fromEntries(['400', '700', '800'].flatMap((w) => ['arabic', 'latin'].map((s) => [`${s}${w}`, U.asset(fontRel(w, s))]))),
  fontPreload: [],
  files: { css: cssRel, js: jsRel, productsJson: productsRel },
};
for (const k of Object.keys(assets.fonts)) if (!hasStatic(fontRel(k.replace(/\D/g, ''), k.replace(/\d/g, '')))) fail(`missing font file src/static/${fontRel(k.replace(/\D/g, ''), k.replace(/\d/g, ''))}`);
if (!hasStatic('favicon.svg')) fail('missing src/static/favicon.svg');

const year = config.year;
const locales = config.locales || ['ar', 'en'];
function makeCtx(locale) {
  const t = makeT(I18N, locale);
  const fontPreload = locale === 'ar' ? [assets.fonts.arabic400, assets.fonts.arabic700] : [assets.fonts.latin400, assets.fonts.latin700];
  const ctx = {
    locale,
    dir: locale === 'ar' ? 'rtl' : 'ltr',
    otherLocale: locale === 'ar' ? 'en' : 'ar',
    defaultLocale: config.defaultLocale || 'ar',
    locales,
    config,
    data,
    i18n: I18N,
    t,
    has: t.has,
    url: (route = '', loc = locale) => U.url(route, loc),
    abs: (route = '', loc = locale) => U.abs(route, loc),
    asset: U.asset,
    base: U.base,
    origin: U.origin,
    money: (fils, loc = locale) => money(fils, loc),
    moneyHtml: (fils, loc = locale) => moneyHtml(fils, loc),
    amount,
    productRoute,
    categoryRoute,
    pname: (p) => p.name[locale] || p.name.ar,
    assets: { ...assets, fontPreload },
    publishId,
    year,
    builtAt: args.builtAt || null,
    h: core,
    clientConfig(extra = {}) {
      return {
        v: 1,
        publishId,
        base: U.base,
        origin: U.origin,
        locale,
        dir: locale === 'ar' ? 'rtl' : 'ltr',
        defaultLocale: config.defaultLocale || 'ar',
        productsUrl: assets.productsJson,
        sw: assets.sw,
        whatsapp: config.contact.whatsapp,
        phone: config.contact.phone,
        delivery: config.delivery,
        analytics: config.analytics,
        storagePrefix: config.storagePrefix || 'gbq8:v2:',
        currency: locale === 'ar' ? 'د.ك' : 'KWD',
        indexable: config.indexable !== false,
        contact: config.contact,
        payments: config.payments,
        governorates: config.governorates,
        catIcons,
        ...extra,
      };
    },
  };
  return ctx;
}

const pageCounts = {};
for (const m of modules) {
  pageCounts[m.file] = 0;
  for (const locale of locales) {
    const ctx = makeCtx(locale);
    let res;
    try { res = await m.routes(ctx); } catch (e) { fail(`src/pages/${m.file} (${locale}): ${e.stack || e.message}`); }
    if (res === undefined || res === null) continue;
    if (!Array.isArray(res)) fail(`src/pages/${m.file} (${locale}): routes() must return an array`);
    for (const item of res) {
      if (!item || typeof item !== 'object') fail(`src/pages/${m.file} (${locale}): bad route entry`);
      let p = item.path;
      if (p === undefined && item.route !== undefined) p = String(item.route).endsWith('/') || item.route === '' ? `${item.route}index.html` : item.route;
      if (typeof p !== 'string' || !p) fail(`src/pages/${m.file} (${locale}): entry without path`);
      const body = item.html !== undefined ? item.html : item.body;
      if (body === undefined || body === null) fail(`src/pages/${m.file} (${locale}): "${p}" has no html/body`);
      const rel = item.global ? p : outPath(p, locale, ctx.defaultLocale);
      emit(rel, Buffer.isBuffer(body) ? body : String(body), `src/pages/${m.file}`);
      pageCounts[m.file]++;
    }
  }
}
for (const p of provided) if (!written.has(p)) fail(`a page module declares provides "${p}" but never emitted it`);

// ------------------------------------------------------------------------------------------- link check
const htmlFiles = [...written.keys()].filter((f) => f.endsWith('.html'));
const broken = [];
const B = U.base;
for (const f of htmlFiles) {
  const src = fs.readFileSync(path.join(OUT, f), 'utf8');
  for (const m of src.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    let u = m[1].replace(/&amp;/g, '&');
    if (!u.startsWith(B)) {
      if (u.startsWith('/') && !u.startsWith('//')) broken.push(`${f}: "${u}" is root-relative but outside BASE`);
      continue;
    }
    u = u.slice(B.length).split('#')[0].split('?')[0];
    try { u = decodeURIComponent(u); } catch { /* keep raw */ }
    const target = u === '' || u.endsWith('/') ? `${u}index.html` : u;
    if (!written.has(target)) broken.push(`${f}: ${m[1]}`);
  }
}

// ------------------------------------------------------------------------------------------- meta files
emit('.nojekyll', '', 'build');
const counts = {
  products: data.products.length,
  categories: data.categories.length,
  html: htmlFiles.length,
  files: written.size + 2,
  pagesByModule: pageCounts,
};
const buildJson = { publishId, ...(args.builtAt ? { builtAt: args.builtAt } : {}), base: U.base, origin: U.origin, year, counts,
  assets: { css: cssRel, js: jsRel, productsJson: productsRel }, i18n: i18nFiles, overrides: args.set };
emit('build.json', JSON.stringify(buildJson, null, 2) + '\n', 'build');
const files = [...written.keys(), '.build-manifest.json'].sort();
fs.writeFileSync(prevManifestPath, JSON.stringify({ publishId, files }, null, 2) + '\n');

// ------------------------------------------------------------------------------------------- cleanup of stale outputs
let removed = 0;
const keep = new Set(files);
const dirs = new Set();
for (const rel of prevFiles) {
  if (keep.has(rel)) continue;
  if (typeof rel !== 'string' || rel.startsWith('/') || rel.split('/').includes('..') || isProtected(rel)) continue;
  const abs = path.join(OUT, rel);
  if (!abs.startsWith(OUT + path.sep)) continue;
  try { fs.unlinkSync(abs); removed++; dirs.add(path.dirname(abs)); } catch { /* already gone */ }
}
for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
  let cur = d;
  while (cur.startsWith(OUT + path.sep)) {
    try { if (fs.readdirSync(cur).length) break; fs.rmdirSync(cur); } catch { break; }
    cur = path.dirname(cur);
  }
}

// ------------------------------------------------------------------------------------------- report
const ms = Math.round(performance.now() - T0);
if (broken.length) {
  const msg = `${broken.length} internal link(s) point to files this build did not generate${args.strict ? '' : ' (warning; --strict makes this fatal)'}:\n  - ${broken.slice(0, 25).join('\n  - ')}${broken.length > 25 ? `\n  … ${broken.length - 25} more` : ''}`;
  if (args.strict) fail(msg);
  if (!args.quiet) console.warn(`build: WARN: ${msg}`);
}
log(`build: modules ${JSON.stringify(pageCounts)}`);
console.log(`build: OK publishId=${publishId} out=${OUT} base=${U.base} html=${htmlFiles.length} files=${files.length} removed=${removed} brokenLinks=${broken.length} ${ms}ms`);
