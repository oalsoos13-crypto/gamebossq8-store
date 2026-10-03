// src/core/head.mjs — the per-page <head> contents (§9). Normally called through layout(ctx, { head: {...} }).
//
// head(ctx, {
//   route,            // REQUIRED locale-neutral route of this page ('' | 'p/x-1/' | 'c/fan/' …)
//   title,            // page title WITHOUT the site suffix; null/undefined → meta.homeTitle (home)
//   titleRaw,         // full <title> used verbatim (skips the template)
//   description,      // ≤155 chars (clipped); default meta.homeDesc
//   og: { type: 'website'|'product', image, imageAlt, product: p },   // product → price/availability metas
//   jsonld: [obj…],   // each emitted as its own <script type="application/ld+json">
//   preloadImage,     // LCP image url → <link rel="preload" as="image" fetchpriority="high">
//   noindex,          // true → <meta name="robots" content="noindex,follow"> (also when config.indexable=false)
//   alternates,       // default true: hreflang ar/en/x-default for `route`; false → none (404, root-only)
//   extra,            // SafeHtml appended at the end of <head>
// })

import { html, raw, clip, jsonForScript, SafeHtml } from './html.mjs';
import { amount } from './money.mjs';
import { imageUrl } from './url.mjs';

const OG_AVAIL = { in_stock: 'in stock', out_of_stock: 'out of stock', backorder: 'available for order' };

export function pageTitle(ctx, title) {
  if (!title) return ctx.t('meta.homeTitle');
  const tpl = ctx.t('meta.titleTemplate', { title: '\u0000' });
  const room = 60 - (tpl.length - 1);
  return tpl.replace('\u0000', clip(title, Math.max(room, 20)));
}

export function head(ctx, o = {}) {
  if (o.route === undefined) throw new Error('head(): route is required');
  const route = o.route;
  const title = o.titleRaw || pageTitle(ctx, o.title);
  const description = clip(o.description || ctx.t('meta.homeDesc'), 155);
  const canonical = ctx.abs(route, ctx.locale);
  const alternates = o.alternates !== false;
  const noindex = o.noindex || ctx.config.indexable === false;
  const og = o.og || {};
  const ogType = og.type || 'website';
  let ogImage = og.image ? imageUrl(og.image, ctx.asset) : ctx.assets.ogImage;
  if (ogImage && !/^https?:/i.test(ogImage)) ogImage = ctx.config.origin.replace(/\/+$/, '') + ogImage;
  const p = og.product;
  const A = ctx.assets;

  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
${noindex ? raw('<meta name="robots" content="noindex,follow">') : raw('<meta name="robots" content="index,follow,max-image-preview:large">')}
<link rel="canonical" href="${canonical}">
${alternates ? html`<link rel="alternate" hreflang="ar" href="${ctx.abs(route, 'ar')}">
<link rel="alternate" hreflang="en" href="${ctx.abs(route, 'en')}">
<link rel="alternate" hreflang="x-default" href="${ctx.abs(route, 'ar')}">` : ''}
<meta name="theme-color" content="${ctx.config.themeColor}">
<meta name="color-scheme" content="light">
<meta name="gb:publish" content="${ctx.publishId}">
<meta name="gb:products" content="${A.productsJson}">
${A.manifest ? html`<link rel="manifest" href="${A.manifest}">` : ''}
<link rel="icon" href="${A.favicon}" type="image/svg+xml">
${A.icon32 ? html`<link rel="icon" href="${A.icon32}" sizes="32x32" type="image/png">` : ''}
${A.appleTouch ? html`<link rel="apple-touch-icon" href="${A.appleTouch}">` : ''}
<meta name="apple-mobile-web-app-title" content="GameBoss Q8">
<meta property="og:site_name" content="${ctx.config.siteName}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${o.ogTitle || title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:locale" content="${ctx.locale === 'ar' ? 'ar_KW' : 'en_US'}">
<meta property="og:locale:alternate" content="${ctx.locale === 'ar' ? 'en_US' : 'ar_KW'}">
${ogImage ? html`<meta property="og:image" content="${ogImage}">
<meta property="og:image:alt" content="${og.imageAlt || ctx.t('meta.ogImageAlt')}">` : ''}
${p ? html`<meta property="product:price:amount" content="${amount(p.priceFils)}">
<meta property="product:price:currency" content="KWD">
<meta property="product:availability" content="${OG_AVAIL[p.availability]}">
<meta property="product:retailer_item_id" content="${p.id}">` : ''}
<meta name="twitter:card" content="summary_large_image">
${ctx.config.imageHosts.map((h) => html`<link rel="preconnect" href="${h}">
<link rel="preconnect" href="${h}" crossorigin>`)}
${A.fontPreload.map((f) => html`<link rel="preload" href="${f}" as="font" type="font/woff2" crossorigin>`)}
${o.preloadImage ? html`<link rel="preload" as="image" href="${imageUrl(o.preloadImage, ctx.asset)}" fetchpriority="high">` : ''}
<link rel="stylesheet" href="${A.css}">
<script src="${A.js}" defer></script>
${(o.jsonld || []).filter(Boolean).map((j) => html`<script type="application/ld+json">${jsonForScript(j)}</script>`)}
${o.extra instanceof SafeHtml ? o.extra : ''}`;
}
