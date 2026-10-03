#!/usr/bin/env node
// tools/mirror-images.mjs — copy every product image into the repo so the store no longer depends on the
// WordPress host (zero dependencies; Node ≥ 20 for the global fetch). Run it on a machine WITH internet access,
// BEFORE the WordPress hosting is cancelled.
//
//   node tools/mirror-images.mjs [options]
//
//   --dry-run                 list what would be downloaded/rewritten; no network, no writes
//   --catalog <file>          default data/catalog.json
//   --dest <dir>              default src/static/img/p   (served as <BASE>img/p/<id>/<n>.<ext>)
//   --only <id,id,…>          limit to these product ids
//   --concurrency <n>         parallel downloads (default 6)
//   --timeout <ms>            per request (default 30000)   --retries <n> (default 2)
//   --no-rewrite              download only; leave data/catalog.json untouched
//   --rewrite-origin <a>=<b>  fetch from <b> instead of <a> (e.g. the server IP while DNS moves); the catalog
//                             still records the mirrored local path
//
// Result: images saved as src/static/img/p/<productId>/<n>.<ext> (n = 1, 2, … in gallery order), and each
// successfully mirrored URL in data/catalog.json replaced by the site-relative path "img/p/<id>/<n>.<ext>"
// (the renderer adds the base path, so it keeps working after a move to a custom domain). Already-downloaded
// files are reused, so the script can be re-run safely after an interruption. A product whose download failed
// keeps its original URL. src/static/img/p/sources.json records where every file came from.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };
if (flag('--help') || flag('-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 23).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

const DRY = flag('--dry-run');
const REWRITE = !flag('--no-rewrite');
const catPath = path.resolve(val('--catalog', path.join(REPO, 'data', 'catalog.json')));
const dest = path.resolve(val('--dest', path.join(REPO, 'src', 'static', 'img', 'p')));
const only = val('--only') ? new Set(val('--only').split(',').map((s) => s.trim())) : null;
const CONC = Math.max(1, Number(val('--concurrency', 6)) || 6);
const TIMEOUT = Number(val('--timeout', 30000)) || 30000;
const RETRIES = Math.max(0, Number(val('--retries', 2)) || 0);
const [fromOrigin, toOrigin] = (val('--rewrite-origin', '') || '').split('=');
const MAX_BYTES = 15 * 1024 * 1024;   // GitHub Pages / repo hygiene: refuse absurdly large files

// the published path of dest, relative to src/static (default "img/p")
const staticRoot = path.join(REPO, 'src', 'static');
const relDest = path.relative(staticRoot, dest).split(path.sep).join('/');
if (relDest.startsWith('..')) { console.error(`--dest must be inside ${staticRoot}`); process.exit(2); }

const EXT_OK = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
const CT_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
function extOf(url) {
  try { const m = new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]+)$/); return m && EXT_OK.has(m[1]) ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : null; } catch { return null; }
}
function sniff(buf) {   // magic bytes → extension (null = not an image we accept)
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (buf.toString('ascii', 4, 12).startsWith('ftypavi')) return 'avif';
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(url) {
  const src = fromOrigin && toOrigin && url.startsWith(fromOrigin) ? toOrigin + url.slice(fromOrigin.length) : url;
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) await sleep(800 * attempt);
    try {
      const res = await fetch(src, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT), headers: { 'user-agent': 'GameBossQ8-mirror/1.0', accept: 'image/avif,image/webp,image/*;q=0.9' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error('empty response');
      if (buf.length > MAX_BYTES) throw new Error(`too large (${(buf.length / 1048576).toFixed(1)} MB)`);
      const kind = sniff(buf);
      if (!kind) throw new Error(`not an image (content-type ${res.headers.get('content-type') || '?'})`);
      return { buf, kind };
    } catch (e) { lastErr = e; if (/HTTP 4\d\d/.test(e.message)) break; }
  }
  throw lastErr;
}

const catalog = JSON.parse(fs.readFileSync(catPath, 'utf8'));
const jobs = [];
for (const p of catalog) {
  if (only && !only.has(String(p.id))) continue;
  p.images.forEach((url, i) => {
    if (!/^https?:\/\//i.test(url)) return;   // already local
    jobs.push({ p, i, url, n: i + 1, ext: extOf(url) });
  });
}
const products = new Set(jobs.map((j) => j.p.id)).size;
console.log(`mirror-images: ${jobs.length} remote images in ${products} products → ${path.relative(REPO, dest) || dest}${DRY ? ' (dry run)' : ''}`);

if (DRY) {
  const hosts = {};
  for (const j of jobs) { const h = new URL(j.url).host; hosts[h] = (hosts[h] || 0) + 1; }
  for (const j of jobs.slice(0, 12)) console.log(`  #${j.p.id} ${j.n}: ${j.url}\n      → ${relDest}/${j.p.id}/${j.n}.${j.ext || '<detected>'}`);
  if (jobs.length > 12) console.log(`  … ${jobs.length - 12} more`);
  console.log(`hosts: ${JSON.stringify(hosts)}`);
  console.log(`unknown extensions (type detected after download): ${jobs.filter((j) => !j.ext).length}`);
  console.log(REWRITE ? `would rewrite ${jobs.length} catalog URLs to "${relDest}/<id>/<n>.<ext>"` : 'catalog would not be changed (--no-rewrite)');
  process.exit(0);
}

const sourcesPath = path.join(dest, 'sources.json');
const sources = fs.existsSync(sourcesPath) ? JSON.parse(fs.readFileSync(sourcesPath, 'utf8')) : {};
let done = 0, reused = 0, bytes = 0;
const failed = [];
async function worker(queue) {
  for (let j; (j = queue.shift());) {
    const dir = path.join(dest, String(j.p.id));
    const existing = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.replace(/\.[^.]+$/, '') === String(j.n) && !f.endsWith('.tmp')) : null;
    try {
      let file = existing && sources[`${relDest}/${j.p.id}/${existing}`] === j.url ? existing : null;
      if (file && fs.statSync(path.join(dir, file)).size > 0) reused++;
      else {
        const { buf, kind } = await download(j.url);
        fs.mkdirSync(dir, { recursive: true });
        if (existing) fs.rmSync(path.join(dir, existing), { force: true });
        file = `${j.n}.${kind}`;
        fs.writeFileSync(path.join(dir, file) + '.tmp', buf);
        fs.renameSync(path.join(dir, file) + '.tmp', path.join(dir, file));
        bytes += buf.length;
      }
      const rel = `${relDest}/${j.p.id}/${file}`;
      sources[rel] = j.url;
      if (REWRITE) j.p.images[j.i] = rel;
      done++;
    } catch (e) {
      failed.push({ id: j.p.id, n: j.n, url: j.url, error: e.message });
    }
    const total = done + failed.length;
    if (total % 25 === 0 || total === jobs.length) process.stdout.write(`  ${total}/${jobs.length}\r`);
  }
}
const queue = [...jobs];
await Promise.all(Array.from({ length: Math.min(CONC, queue.length || 1) }, () => worker(queue)));
process.stdout.write('\n');

if (done) {
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(sourcesPath, JSON.stringify(Object.fromEntries(Object.entries(sources).sort()), null, 2) + '\n');
}
if (REWRITE && done) {
  const tmp = catPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2) + '\n');
  fs.renameSync(tmp, catPath);
}
console.log(`mirrored ${done} images (${reused} already on disk, ${(bytes / 1048576).toFixed(1)} MB downloaded), ${failed.length} failed`);
for (const f of failed) console.log(`  FAILED #${f.id} image ${f.n}: ${f.error} — ${f.url}`);
if (REWRITE && done) console.log(`updated ${path.relative(REPO, catPath) || catPath}; failed images keep their original URL. Next: build, check a few product pages, then publish.`);
process.exit(failed.length ? 1 : 0);
