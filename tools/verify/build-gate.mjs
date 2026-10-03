// tools/verify/build-gate.mjs — gate 1 (SPEC §13.1 + §9 SEO + §6 honesty): static assertions on the generated files.
// No browser. Reads <out>/build.json, the products json, every generated .html, sitemap.xml, robots.txt, manifest,
// and (when the repo is available) the source data/catalog.json + data/categories.json.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { walk, fileToRoute, short } from './lib.mjs';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeEntities = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
});

const BANNED = [
  ['الأكثر مبيعاً', /الأكثر\s+مبيع/], ['best seller', /best[\s-]?sell(er|ing)/i], ['sold count', /(تم\s+بيع|sold\s+\d+|\d+\s+sold)/i],
  ['ratings/stars', /aggregateRating|ratingValue|★★/], ['24h shipping', /(شحن|توصيل)\s+خلال\s+24|24[\s-]?hour\s+(shipping|delivery)/i],
  ['authorised dealers', /وكلاء\s+معتمد|وكيل\s+معتمد|authori[sz]ed\s+(dealer|reseller)/i], ['100% original', /أصلي\s*100|100\s*%\s*(original|authentic|أصلي)/i],
  ['secure encrypted payment', /دفع\s+آمن|secure\s+(&\s+encrypted\s+)?payment/i], ['card/Apple Pay', /apple\s*pay|آبل\s*باي|ابل\s*باي/i],
  ['newsletter', /newsletter|النشرة\s+البريدية|اشترك\s+في\s+نشرت/i], ['countdown timer', /countdown|العد\s+التنازلي/i],
  ['shippingDetails / return policy JSON-LD', /"shippingDetails"|"hasMerchantReturnPolicy"/],
];

function textOf(html) {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

/** Map a URL found in a page to a file path under outDir, or a problem string. */
function resolveRef(raw, pageRoute, ctx) {
  const v = decodeEntities(raw.trim());
  if (!v || v[0] === '#' || /^(mailto|tel|javascript|data|blob|sms|whatsapp):/i.test(v)) return { skip: true };
  if (/\{[a-z_]+\}/.test(v)) return { skip: true }; // URL templates (SearchAction)
  let path;
  if (/^https?:\/\//i.test(v)) {
    const prod = ctx.prodOrigin + ctx.base;
    if (v.startsWith(prod)) path = v.slice(ctx.prodOrigin.length);
    else return { skip: true, external: true };
  } else if (v.startsWith('//')) return { skip: true, external: true };
  else if (v[0] === '/') {
    if (!v.startsWith(ctx.base)) return { problem: 'root-absolute URL outside BASE (hard-coded "/")' };
    path = v;
  } else {
    // relative to the page directory
    const dir = ctx.base + pageRoute.replace(/[^/]*$/, '');
    path = new URL(v, 'http://x' + dir).pathname;
  }
  path = path.split('#')[0].split('?')[0];
  try { path = decodeURIComponent(path); } catch { return { problem: 'bad URL encoding' }; }
  const rel = path.slice(ctx.base.length);
  const file = join(ctx.outDir, rel);
  if (path.endsWith('/')) return existsSync(join(file, 'index.html')) ? { ok: true, rel } : { missing: rel || '(root)' };
  if (existsSync(file) && statSync(file).isFile()) return { ok: true, rel };
  if (existsSync(join(file, 'index.html'))) return { ok: true, rel, noSlash: true };
  return { missing: rel };
}

export async function buildGate(R, env) {
  const { site, args } = env;
  const { outDir, build, products, base, prodOrigin, publishId } = site;
  const ctx = { outDir, base, prodOrigin };

  /* ---------------- build.json + required files */
  R.check('build.json: publishId is 8 hex', /^[0-9a-f]{8}$/.test(publishId || ''), publishId);
  R.check('build.json: 165 products', build.counts && build.counts.products === 165, build.counts && build.counts.products);
  const required = ['index.html', 'en/index.html', '404.html', 'sitemap.xml', 'robots.txt', 'manifest.webmanifest', 'sw.js', '.nojekyll', 'search/index.html',
    'wishlist/index.html', 'checkout/index.html', 'offline/index.html', 'en/offline/index.html', 'en/checkout/index.html', 'en/search/index.html', 'en/wishlist/index.html'];
  for (const k of ['how-to-order', 'delivery-payment', 'returns', 'about', 'privacy']) required.push(`info/${k}/index.html`, `en/info/${k}/index.html`);
  const missingReq = required.filter((f) => !existsSync(join(outDir, f)));
  R.check('required output files exist (both locales)', !missingReq.length, missingReq);
  R.check('no admin/ or root catalog.json in the output', !existsSync(join(outDir, 'admin')) && !existsSync(join(outDir, 'catalog.json')));

  /* ---------------- client products json */
  R.check('products json: 165 items', products.length === 165, products.length);
  {
    const ids = new Set(), slugs = new Set(), bad = [];
    for (const p of products) {
      const id = String(p.id);
      if (ids.has(id)) bad.push(`dup id ${id}`); ids.add(id);
      if (slugs.has(p.s)) bad.push(`dup s ${p.s}`); slugs.add(p.s);
      if (!Number.isInteger(p.p) || p.p <= 0) bad.push(`${id} price ${p.p}`);
      if (p.c !== null && p.c !== undefined && !(Number.isInteger(p.c) && p.c > p.p)) bad.push(`${id} compareAt ${p.c} <= ${p.p}`);
      if (!['in_stock', 'out_of_stock', 'backorder'].includes(p.a)) bad.push(`${id} availability ${p.a}`);
      if (!p.n || !p.n.ar || !p.n.en) bad.push(`${id} missing name`);
      if (!new RegExp(`^p/[a-z0-9-]+-${id}/$`).test(p.s || '')) bad.push(`${id} bad s ${p.s}`);
      else if (!existsSync(join(outDir, p.s, 'index.html')) || !existsSync(join(outDir, 'en', p.s, 'index.html'))) bad.push(`${id} page missing (ar or en)`);
    }
    R.check('products json: unique ids/slugs, prices > 0, compareAt > price, pages exist in both locales', !bad.length, bad.slice(0, 20));
  }

  /* ---------------- source data (repo) */
  const repoData = args.repo && join(args.repo, 'data');
  if (repoData && existsSync(join(repoData, 'catalog.json'))) {
    const cat = JSON.parse(readFileSync(join(repoData, 'catalog.json'), 'utf8'));
    const cats = JSON.parse(readFileSync(join(repoData, 'categories.json'), 'utf8'));
    const bad = [];
    const ids = new Set(), slugs = new Set();
    for (const p of cat) {
      if (ids.has(p.id)) bad.push('dup id ' + p.id); ids.add(p.id);
      if (slugs.has(p.slug)) bad.push('dup slug ' + p.slug); slugs.add(p.slug);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug || '')) bad.push(`${p.id} slug not ascii-kebab: ${p.slug}`);
      if (!Number.isInteger(p.priceFils) || p.priceFils <= 0) bad.push(`${p.id} priceFils ${p.priceFils}`);
      if (p.compareAtFils !== null && !(Number.isInteger(p.compareAtFils) && p.compareAtFils > p.priceFils)) bad.push(`${p.id} compareAtFils ${p.compareAtFils}`);
      if (!p.name || !p.name.ar || !p.name.en) bad.push(`${p.id} name`);
      if (!Array.isArray(p.images)) bad.push(`${p.id} images not array`);
      else if (new Set(p.images).size !== p.images.length) bad.push(`${p.id} duplicate images`);
    }
    R.check('data/catalog.json: 165 products', cat.length === 165, cat.length);
    R.check('data/catalog.json: unique ids & slugs, valid prices', !bad.length, bad.slice(0, 20));
    const empty = cats.filter((c) => !cat.some((p) => p.category === c.id || (p.categories || []).includes(c.id))).map((c) => c.id);
    R.check('every category is non-empty', cats.length === 12 && !empty.length, { categories: cats.length, empty });
    const catPages = cats.filter((c) => !existsSync(join(outDir, 'c', c.id, 'index.html')) || !existsSync(join(outDir, 'en/c', c.id, 'index.html'))).map((c) => c.id);
    R.check('every category has a page in both locales', !catPages.length, catPages);
  } else R.check('source data available (--repo)', false, 'data/catalog.json not found under ' + args.repo);

  /* ---------------- every generated HTML */
  const htmlFiles = walk(outDir, (p) => p.endsWith('.html'));
  R.check('HTML pages generated', htmlFiles.length > 300, htmlFiles.length);
  const broken = new Map(); // target → [pages]
  const problems = { rootAbs: [], ldBad: [], jsonBad: [], h1: [], title: [], desc: [], langDir: [], publish: [], baseTag: [], hreflang: [], canonical: [], img: [], lcp: [], manifest: [], banned: [], noSlash: [] };
  const noindexRoutes = new Set();
  const indexable = new Set();
  let refs = 0;
  for (const rel of htmlFiles) {
    const src = readFileSync(join(outDir, rel), 'utf8');
    const route = fileToRoute(rel);
    const isEn = rel.startsWith('en/');
    const is404 = rel === '404.html' || rel.startsWith('en/404/');
    const noScripts = src.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

    // internal references
    const seen = new Set();
    const add = (raw, kind) => {
      const r = resolveRef(raw, route, ctx);
      if (r.skip) return;
      refs++;
      if (r.problem) { if (problems.rootAbs.length < 30) problems.rootAbs.push(`${rel}: ${kind}="${short(raw, 80)}" ${r.problem}`); return; }
      if (r.missing !== undefined && !seen.has(r.missing)) {
        seen.add(r.missing);
        if (!broken.has(r.missing)) broken.set(r.missing, []);
        broken.get(r.missing).push(rel);
      }
      if (r.noSlash && problems.noSlash.length < 10) problems.noSlash.push(`${rel}: ${raw}`);
    };
    for (const m of noScripts.matchAll(/\s(href|src|action|poster|data-href-base)\s*=\s*"([^"]*)"/gi)) add(m[2], m[1]);
    for (const m of noScripts.matchAll(/\ssrcset\s*=\s*"([^"]*)"/gi)) for (const part of m[1].split(',')) add(part.trim().split(/\s+/)[0], 'srcset');
    for (const m of noScripts.matchAll(/<meta\b[^>]*\scontent\s*=\s*"((?:https?:\/\/|\/)[^"]*)"/gi)) add(m[1], 'meta content');

    // JSON-LD + JSON data blocks
    for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = m[1];
      const tm = /type\s*=\s*"([^"]+)"/i.exec(attrs);
      const type = tm ? tm[1].toLowerCase() : '';
      if (type === 'application/ld+json') {
        try {
          const ld = JSON.parse(m[2]);
          const urls = [];
          JSON.stringify(ld, (k, v) => { if (typeof v === 'string' && v.startsWith(prodOrigin + base)) urls.push(v); return v; });
          urls.forEach((u) => add(u, 'json-ld'));
          const txt = m[2];
          if (/"aggregateRating"|"shippingDetails"|"hasMerchantReturnPolicy"/.test(txt)) problems.banned.push(`${rel}: forbidden JSON-LD property`);
        } catch (e) { problems.ldBad.push(`${rel}: ${e.message}`); }
      } else if (type === 'application/json' || type === 'application/manifest+json') {
        try { JSON.parse(m[2]); } catch (e) { problems.jsonBad.push(`${rel}#${(/id\s*=\s*"([^"]+)"/.exec(attrs) || [])[1] || '?'}: ${e.message}`); }
      }
    }

    // structure / SEO
    const h1 = (noScripts.match(/<h1[\s>]/gi) || []).length;
    if (h1 !== 1) problems.h1.push(`${rel}: ${h1}`);
    const tt = /<title>([\s\S]*?)<\/title>/i.exec(src);
    const title = tt ? decodeEntities(tt[1]).trim() : '';
    if (!title || [...title].length > 60) problems.title.push(`${rel}: ${[...title].length} "${short(title, 70)}"`);
    const dm = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(src);
    const desc = dm ? decodeEntities(dm[1]) : '';
    if (!desc || [...desc].length > 155) problems.desc.push(`${rel}: ${[...desc].length}`);
    const hm = /<html\b[^>]*>/i.exec(src);
    const htmlTag = hm ? hm[0] : '';
    const wantLang = isEn ? 'en' : 'ar', wantDir = isEn ? 'ltr' : 'rtl';
    if (!new RegExp(`\\slang="${wantLang}`).test(htmlTag) || !new RegExp(`\\sdir="${wantDir}"`).test(htmlTag)) problems.langDir.push(`${rel}: ${htmlTag}`);
    const pm = /<meta\s+name="gb:publish"\s+content="([^"]*)"/i.exec(src);
    if (!pm || pm[1] !== publishId) problems.publish.push(`${rel}: ${pm ? pm[1] : 'missing'}`);
    if (/<base\s/i.test(src)) problems.baseTag.push(rel);
    if (!/<link\s+rel="manifest"/i.test(src)) problems.manifest.push(rel);
    const noindex = /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(src);
    if (noindex) noindexRoutes.add(route); else indexable.add(route);
    if (!is404) {
      const langs = ['ar', 'en', 'x-default'].filter((l) => !new RegExp(`<link\\s+rel="alternate"\\s+hreflang="${l}"`, 'i').test(src));
      if (langs.length) problems.hreflang.push(`${rel}: missing ${langs.join(',')}`);
      const cm = /<link\s+rel="canonical"\s+href="([^"]+)"/i.exec(src);
      const own = prodOrigin + base + route;
      if (!cm) problems.canonical.push(`${rel}: missing`);
      else if (decodeEntities(cm[1]) !== own && !noindex) problems.canonical.push(`${rel}: ${cm[1]} != ${own}`);
    }
    for (const m of noScripts.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      if (!/\salt="/i.test(tag) || !/\swidth="/i.test(tag) || !/\sheight="/i.test(tag)) { if (problems.img.length < 20) problems.img.push(`${rel}: ${short(tag, 140)}`); }
    }
    const lcp = (noScripts.match(/<img\b[^>]*fetchpriority="high"/gi) || []).length;
    if (lcp > 1) problems.lcp.push(`${rel}: ${lcp}`);
    // honesty (visible text + JSON-LD)
    const text = textOf(src);
    for (const [label, re] of BANNED) if (re.test(text) && problems.banned.length < 30) problems.banned.push(`${rel}: ${label} — "${short((text.match(re) || [''])[0], 40)}"`);
  }
  const brokenList = [...broken.entries()].map(([t, pages]) => `${t} ← ${pages.length} page(s) e.g. ${pages[0]}`);
  R.check(`every internal href/src resolves to a generated file (${refs} refs, ${htmlFiles.length} pages)`, !brokenList.length, brokenList.slice(0, 25));
  R.check('no root-absolute URLs outside BASE', !problems.rootAbs.length, problems.rootAbs);
  R.check('directory links end with "/"', !problems.noSlash.length, problems.noSlash);
  R.check('every JSON-LD block parses (and has no rating/shipping/return-policy props)', !problems.ldBad.length, problems.ldBad.slice(0, 10));
  R.check('every JSON data block (#gb-config/#gb-i18n/#gb-page) parses', !problems.jsonBad.length, problems.jsonBad.slice(0, 10));
  R.check('exactly one <h1> per page', !problems.h1.length, problems.h1.slice(0, 15));
  R.check('<title> present and ≤ 60 chars', !problems.title.length, problems.title.slice(0, 15));
  R.check('meta description present and ≤ 155 chars', !problems.desc.length, problems.desc.slice(0, 15));
  R.check('<html lang dir> matches the locale', !problems.langDir.length, problems.langDir.slice(0, 10));
  R.check('gb:publish meta = build publishId on every page', !problems.publish.length, problems.publish.slice(0, 10));
  R.check('no <base href>', !problems.baseTag.length, problems.baseTag.slice(0, 10));
  R.check('manifest linked from every page', !problems.manifest.length, problems.manifest.slice(0, 10));
  R.check('hreflang ar/en/x-default on every page (except 404)', !problems.hreflang.length, problems.hreflang.slice(0, 10));
  R.check('canonical present and self-referencing on indexable pages', !problems.canonical.length, problems.canonical.slice(0, 10));
  R.check('<img> has alt + width + height', !problems.img.length, problems.img.slice(0, 10));
  R.check('at most one fetchpriority=high <img> per page', !problems.lcp.length, problems.lcp.slice(0, 10));
  R.check('honesty rules: no banned claims (SPEC §6)', !problems.banned.length, problems.banned);

  /* ---------------- sitemap / robots */
  const sm = existsSync(join(outDir, 'sitemap.xml')) ? readFileSync(join(outDir, 'sitemap.xml'), 'utf8') : '';
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decodeEntities(m[1]));
  const alts = [...sm.matchAll(/<xhtml:link[^>]*href="([^"]+)"/g)].map((m) => decodeEntities(m[1]));
  const smMissing = [...new Set([...locs, ...alts])].map((u) => [u, resolveRef(u, '', ctx)]).filter(([, r]) => r.missing !== undefined || r.problem || r.external).map(([u]) => u);
  R.check(`sitemap: every <loc>/alternate URL exists (${locs.length} locs)`, locs.length > 300 && !smMissing.length, { locs: locs.length, missing: smMissing.slice(0, 10) });
  const util = locs.filter((u) => /\/(checkout|wishlist|offline|search|404)(\/|\.html)/.test(u));
  R.check('sitemap: no checkout/wishlist/offline/search/404 URLs', !util.length, util.slice(0, 10));
  {
    const locRoutes = new Set(locs.map((u) => u.slice((prodOrigin + base).length)));
    const notInSitemap = [...indexable].filter((r) => !locRoutes.has(r) && !/^(en\/)?404/.test(r));
    const noindexInSitemap = [...locRoutes].filter((r) => noindexRoutes.has(r));
    R.check('sitemap = exactly the indexable pages', !notInSitemap.length && !noindexInSitemap.length, { notInSitemap: notInSitemap.slice(0, 10), noindexInSitemap: noindexInSitemap.slice(0, 10) });
  }
  const robots = existsSync(join(outDir, 'robots.txt')) ? readFileSync(join(outDir, 'robots.txt'), 'utf8') : '';
  R.check('robots.txt has a Sitemap line pointing at sitemap.xml', new RegExp(`^Sitemap:\\s*${(prodOrigin + base).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}sitemap\\.xml`, 'm').test(robots));
}
