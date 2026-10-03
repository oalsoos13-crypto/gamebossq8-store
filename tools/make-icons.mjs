#!/usr/bin/env node
// tools/make-icons.mjs — generate the PWA / favicon / Open Graph PNGs from the brand "G" mark
// (src/static/favicon.svg — the same mark as the header) with Playwright screenshots.
// Run ONCE (and again only when the mark changes); the outputs are committed under src/static/assets/icons/.
//
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/make-icons.mjs [--playwright <dir with node_modules/playwright>]
//
// Outputs (src/static/assets/icons/):
//   icon-32.png            32×32   rounded square, transparent corners (browser tab fallback for favicon.svg)
//   apple-touch-icon.png   180×180 full-bleed square (iOS rounds the corners itself)
//   icon-192.png           192×192 rounded square, transparent corners   (manifest, purpose "any")
//   icon-512.png           512×512 rounded square, transparent corners   (manifest, purpose "any"; JSON-LD logo)
//   icon-maskable-512.png  512×512 full-bleed, glyph inside the central 80% safe zone (manifest, purpose "maskable")
//   og-default.png         1200×630 brand card used as the default og:image
//
// This script is a dev tool: it may import Playwright (the site build itself never does).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, 'src', 'static', 'assets', 'icons');
const FONTS = path.join(REPO, 'src', 'static', 'assets', 'fonts');

function loadPlaywright() {
  const argi = process.argv.indexOf('--playwright');
  const candidates = [
    argi > 0 ? process.argv[argi + 1] : null,
    process.env.GB_PLAYWRIGHT_DIR,
    REPO,
    '/tmp/claude-0/-home-user-ddc-approval/e3d6f3de-b38c-5e2a-9697-1356406fa16a/scratchpad/audit',
  ].filter(Boolean);
  for (const dir of candidates) {
    try { return createRequire(path.join(path.resolve(dir), 'package.json'))('playwright'); } catch { /* try next */ }
  }
  console.error('make-icons: cannot find the "playwright" package. Pass --playwright <dir containing node_modules/playwright>.');
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------- the mark
const favicon = fs.readFileSync(path.join(REPO, 'src', 'static', 'favicon.svg'), 'utf8');
const vb = /viewBox="([^"]+)"/.exec(favicon);
if (!vb) throw new Error('favicon.svg has no viewBox');
const [, , VW, VH] = vb[1].split(/\s+/).map(Number);
const inner = favicon.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const bgRect = /<rect\b[^>]*\/>/.exec(inner);
if (!bgRect) throw new Error('favicon.svg: expected a background <rect/> as the first element');
const glyph = inner.replace(bgRect[0], ''); // the "G" stroke + accent dot
const bgFill = (/fill="([^"]+)"/.exec(bgRect[0]) || [, '#1D1D1F'])[1];

/** SVG of the mark. shape: 'rounded' (as favicon) | 'square' (full bleed). scale: glyph scale about the centre. */
function markSvg({ shape = 'rounded', scale = 1 } = {}) {
  const cx = VW / 2, cy = VH / 2;
  const bg = shape === 'rounded' ? bgRect[0] : `<rect width="${VW}" height="${VH}" fill="${bgFill}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}">${bg}<g transform="translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})">${glyph}</g></svg>`;
}

const fontFace = (w, s) => {
  const f = path.join(FONTS, `tajawal-${w}-${s}.woff2`);
  return `@font-face{font-family:Tajawal;font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(f).toString('base64')}) format("woff2");}`;
};

const page = (body, w, h, extraCss = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFace(400, 'arabic')}${fontFace(400, 'latin')}${fontFace(800, 'arabic')}${fontFace(800, 'latin')}
html,body{margin:0;padding:0;background:transparent;width:${w}px;height:${h}px;overflow:hidden}
svg.mark{display:block;width:${w}px;height:${h}px}
${extraCss}</style></head><body>${body}</body></html>`;

const ICONS = [
  { file: 'icon-32.png', size: 32, svg: markSvg() },
  { file: 'apple-touch-icon.png', size: 180, svg: markSvg({ shape: 'square', scale: 0.92 }) },
  { file: 'icon-192.png', size: 192, svg: markSvg() },
  { file: 'icon-512.png', size: 512, svg: markSvg() },
  { file: 'icon-maskable-512.png', size: 512, svg: markSvg({ shape: 'square', scale: 0.78 }) },
];

const OG_W = 1200, OG_H = 630;
const ogHtml = page(`<main class="og">
  <div class="og__mark">${markSvg().replace('<svg ', '<svg class="m" ')}</div>
  <div class="og__text">
    <p class="og__word" dir="ltr">GameBoss<span> Q8</span></p>
    <p class="og__ar" dir="rtl" lang="ar">إكسسوارات ألعاب الموبايل في الكويت</p>
    <p class="og__en" dir="ltr">Mobile gaming accessories · Kuwait</p>
  </div>
</main>`, OG_W, OG_H, `
.og{box-sizing:border-box;width:${OG_W}px;height:${OG_H}px;background:#F5F5F7;display:flex;align-items:center;gap:56px;padding:0 90px;font-family:Tajawal,sans-serif;color:#1D1D1F;
  background-image:radial-gradient(circle at 88% 12%, #EDF1FF 0, rgba(237,241,255,0) 46%),radial-gradient(circle at 8% 100%, #E4E6EB 0, rgba(228,230,235,0) 40%)}
.og__mark .m{width:220px;height:220px;display:block;filter:drop-shadow(0 30px 50px rgba(20,20,45,.28))}
.og__text{display:flex;flex-direction:column;gap:14px;min-width:0}
.og__text p{margin:0}
.og__word{font-weight:800;font-size:88px;letter-spacing:-2px;line-height:1}
.og__word span{font-weight:400;color:#707078}
.og__ar{font-weight:800;font-size:42px;line-height:1.3;white-space:nowrap;text-align:left}
.og__en{font-weight:400;font-size:32px;color:#5C5C63}`);

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
try {
  fs.mkdirSync(OUT, { recursive: true });
  for (const ic of ICONS) {
    const ctx = await browser.newContext({ viewport: { width: ic.size, height: ic.size }, deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    await pg.setContent(page(ic.svg.replace('<svg ', '<svg class="mark" '), ic.size, ic.size));
    await pg.screenshot({ path: path.join(OUT, ic.file), omitBackground: true, clip: { x: 0, y: 0, width: ic.size, height: ic.size } });
    await ctx.close();
    console.log(`make-icons: ${ic.file} (${ic.size}×${ic.size})`);
  }
  const ctx = await browser.newContext({ viewport: { width: OG_W, height: OG_H }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  await pg.setContent(ogHtml);
  await pg.evaluate(() => document.fonts.ready);
  await pg.screenshot({ path: path.join(OUT, 'og-default.png'), clip: { x: 0, y: 0, width: OG_W, height: OG_H } });
  await ctx.close();
  console.log(`make-icons: og-default.png (${OG_W}×${OG_H})`);
} finally {
  await browser.close();
}
console.log(`make-icons: OK → ${path.relative(REPO, OUT)}/`);
