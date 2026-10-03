// src/pages/product.mjs — one page per product per locale at p/<slug>-<id>/ (SPEC §8 Product, §7 gallery, §9 SEO).
//
// Server-rendered: breadcrumbs, gallery (scroll-snap slides + thumbnails + counter), brand, H1, price/compare/saving,
// availability, qty stepper, Add to cart / Buy now (or Notify for out_of_stock), Ask on WhatsApp, Share, delivery &
// payment notes, description (EN falls back to the Arabic text in a lang="ar" dir="rtl" block), product info list,
// related rail (same category, in_stock first, 8), an empty "recently viewed" rail shell and the mobile sticky CTA bar.
// Client behaviour lives in src/js/40-product.js (keyed off body.page-product + #gb-page JSON).

import {
  html, raw, cls, clip, plainText, icon, art, layout, breadcrumbs, priceBlock, availabilityBadge, wishButton,
  nameHtml, pname, waLink, notifyLink, rail, productRoute, categoryRoute, imageUrl, graph, ldProduct, ldBreadcrumbs,
  moneyHtml, money, isAvailable,
} from '../core/index.mjs';

const RELATED_MAX = 8;

/** Related products: same category, best-match order (in_stock → backorder → out_of_stock), excluding p. */
function related(ctx, p) {
  return (ctx.data.byCat.get(p.category) || []).filter((x) => x.id !== p.id).slice(0, RELATED_MAX);
}

function metaDescription(ctx, p) {
  const T = ctx.t;
  const name = pname(ctx, p);
  const price = money(p.priceFils, ctx.locale);
  // Never mix scripts in the meta description: EN pages only use an English description.
  const desc = ctx.locale === 'ar' ? p.description.ar : p.description.en;
  if (desc) return clip(T('product.metaDesc', { name, price, desc: plainText(desc) }), 155);
  return clip(T('product.metaDescFallback', { name, price }), 155);
}

function gallery(ctx, p) {
  const T = ctx.t;
  const name = pname(ctx, p);
  const imgs = p.images;
  const total = imgs.length;
  const cat = ctx.data.catById.get(p.category);
  const artKey = cat ? cat.icon : 'bundle';

  if (!total) {
    return html`<section class="gb-gallery is-empty" aria-label="${T('product.galleryLabel')}">
<div class="gb-gallery__stage">
<div class="gb-media gb-gallery__media is-empty">${art(artKey, { cls: 'gb-media__ph' })}<p class="gb-gallery__noimg">${T('common.noImage')}</p></div>
${wishButton(ctx, p, { cls: 'gb-gallery__wish' })}
</div>
</section>`;
  }

  const alt = (i) => (total === 1 ? name : T('product.imageAlt', { name, n: i + 1, total }));
  const slides = imgs.map((src, i) => html`<div class="gb-gallery__slide" role="group" aria-roledescription="slide" aria-label="${T('product.slideLabel', { n: i + 1, total })}" data-index="${i}">
<div class="gb-media gb-gallery__media">${art(artKey, { cls: 'gb-media__ph' })}<img class="gb-media__img" src="${imageUrl(src, ctx.asset)}" alt="${alt(i)}" width="800" height="800"${i === 0
    ? raw(' loading="eager" fetchpriority="high"') : raw(' loading="lazy"')} decoding="async"></div>
</div>`);

  const multi = total > 1;
  return html`<section class="${cls('gb-gallery', multi && 'is-multi')}" aria-roledescription="carousel" aria-label="${T('product.galleryLabel')}" data-gallery data-total="${total}">
<div class="gb-gallery__stage">
<div class="gb-gallery__track" data-gallery-track${multi ? html` tabindex="0" aria-label="${T('product.galleryHint')}"` : ''}>${slides}</div>
${multi ? html`<button type="button" class="gb-gallery__nav gb-gallery__nav--prev" data-gallery-go="prev" aria-label="${T('product.prevImage')}" aria-disabled="true">${icon('chevron-back')}</button>
<button type="button" class="gb-gallery__nav gb-gallery__nav--next" data-gallery-go="next" aria-label="${T('product.nextImage')}">${icon('chevron-forward')}</button>
<p class="gb-gallery__count" aria-hidden="true"><bdi dir="ltr"><span data-gallery-count>1</span> / ${total}</bdi></p>` : ''}
${wishButton(ctx, p, { cls: 'gb-gallery__wish' })}
</div>
${multi ? html`<ul class="gb-gallery__thumbs" role="list">${imgs.map((src, i) => html`<li><button type="button" class="gb-gallery__thumb" data-gallery-thumb="${i}" aria-label="${T('product.thumbLabel', { n: i + 1, total })}"${i === 0 ? raw(' aria-current="true"') : ''}>
<span class="gb-media gb-gallery__thumbmedia">${art(artKey, { cls: 'gb-media__ph' })}<img class="gb-media__img" src="${imageUrl(src, ctx.asset)}" alt="" width="800" height="800" loading="lazy" decoding="async"></span></button></li>`)}</ul>` : ''}
</section>`;
}

function buyBox(ctx, p) {
  const T = ctx.t;
  const name = pname(ctx, p);
  const askHref = waLink(ctx, T('product.askMsg', { name, id: p.id, url: ctx.abs(productRoute(p)) }));
  const ask = html`<a class="gb-btn gb-btn--light gb-pdp__ask" href="${askHref}" target="_blank" rel="noopener" data-track="wa_inquiry" data-kind="ask">${icon('whatsapp')}<span>${T('product.ask')}</span><span class="gb-sr"> ${T('a11y.newTab')}</span></a>`;
  const share = html`<button type="button" class="gb-btn gb-btn--light gb-pdp__share" data-action="product-share" aria-label="${T('product.shareLabel')}">${icon('share')}<span aria-hidden="true">${T('product.share')}</span></button>`;

  if (p.availability === 'out_of_stock') {
    return html`<div class="gb-pdp__buy" id="pdp-cta">
<p class="gb-alert gb-pdp__note">${icon('info')}<span>${T('product.oosNote')}</span></p>
<div class="gb-pdp__ctas">
<button type="button" class="gb-btn gb-btn--primary gb-btn--lg gb-pdp__add" disabled>${icon('x')}<span>${T('stock.out_of_stock')}</span></button>
<a class="gb-btn gb-btn--wa gb-btn--lg gb-pdp__notify" href="${notifyLink(ctx, p)}" target="_blank" rel="noopener" data-track="wa_inquiry" data-kind="notify">${icon('bell')}<span>${T('common.notifyMe')}</span><span class="gb-sr"> ${T('a11y.newTab')}</span></a>
</div>
<div class="gb-pdp__more">${ask}${share}</div>
</div>`;
  }

  return html`<div class="gb-pdp__buy" id="pdp-cta">
${p.availability === 'backorder' ? html`<p class="gb-alert gb-pdp__note">${icon('clock')}<span>${T('product.backorderNote')}</span></p>` : ''}
<div class="gb-pdp__qty">
<label class="gb-label" for="pdp-qty">${T('common.qty')}</label>
<div class="gb-stepper" data-stepper>
<button type="button" data-step="-1" aria-label="${T('product.qtyDec')}" aria-controls="pdp-qty" aria-disabled="true">${icon('minus')}</button>
<input id="pdp-qty" name="qty" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="1" maxlength="2" dir="ltr">
<button type="button" data-step="1" aria-label="${T('product.qtyInc')}" aria-controls="pdp-qty">${icon('plus')}</button>
</div>
</div>
<div class="gb-pdp__ctas">
<button type="button" class="gb-btn gb-btn--primary gb-btn--lg gb-pdp__add" data-action="add-to-cart" data-id="${p.id}" data-price="${p.priceFils}" data-qty-from="#pdp-qty">${icon('cart-plus')}<span>${T('common.addToCart')}</span></button>
<button type="button" class="gb-btn gb-btn--accent gb-btn--lg gb-pdp__now" data-action="product-buy-now" data-id="${p.id}" data-price="${p.priceFils}">${icon('arrow-forward')}<span>${T('product.buyNow')}</span></button>
</div>
<div class="gb-pdp__more">${ask}${share}</div>
</div>`;
}

function assurances(ctx) {
  const T = ctx.t;
  const d = ctx.config.delivery || {};
  const delivery = d.confirmed === true
    ? T('product.deliveryConfirmed', { fee: money(d.feeFils, ctx.locale), free: money(d.freeOverFils, ctx.locale) })
    : T('product.deliveryPending');
  return html`<ul class="gb-pdp__assure" role="list">
<li>${icon('truck')}<span>${delivery}</span></li>
<li>${icon('cash')}<span>${T('product.payment')}</span></li>
<li>${icon('whatsapp')}<span>${T('product.orderWa')}</span></li>
</ul>`;
}

function description(ctx, p) {
  const T = ctx.t;
  const own = p.description[ctx.locale];
  let body;
  if (own) {
    body = html`<div class="gb-prose gb-pdp__prose">${own}</div>`;
  } else if (ctx.locale !== 'ar' && p.description.ar) {
    body = html`<p class="gb-pdp__desclabel">${T('product.descArabic')}</p><div class="gb-prose gb-pdp__prose" lang="ar" dir="rtl">${p.description.ar}</div>`;
  } else {
    const askHref = waLink(ctx, T('product.askMsg', { name: pname(ctx, p), id: p.id, url: ctx.abs(productRoute(p)) }));
    body = html`<p class="gb-pdp__descempty">${T('product.descEmpty')}</p>
<p><a class="gb-link" href="${askHref}" target="_blank" rel="noopener" data-track="wa_inquiry" data-kind="ask">${icon('whatsapp')}<span>${T('product.ask')}</span><span class="gb-sr"> ${T('a11y.newTab')}</span></a></p>`;
  }
  return html`<section class="gb-panel gb-pdp__desc" aria-labelledby="pdp-desc-title">
<h2 class="gb-pdp__h2" id="pdp-desc-title">${T('product.descTitle')}</h2>
${body}
</section>`;
}

function infoList(ctx, p) {
  const T = ctx.t;
  const cat = ctx.data.catById.get(p.category);
  return html`<section class="gb-panel gb-pdp__info" aria-labelledby="pdp-info-title">
<h2 class="gb-pdp__h2" id="pdp-info-title">${T('product.infoTitle')}</h2>
<dl class="gb-pdp__dl">
${p.brand ? html`<div><dt>${T('product.brand')}</dt><dd><a href="${ctx.url('search/?q=' + encodeURIComponent(p.brand))}" aria-label="${T('product.brandLink', { brand: p.brand })}"><bdi dir="ltr">${p.brand}</bdi></a></dd></div>` : ''}
${cat ? html`<div><dt>${T('product.category')}</dt><dd><a href="${ctx.url(categoryRoute(cat.id))}">${cat.name[ctx.locale]}</a></dd></div>` : ''}
<div><dt>${T('product.availability')}</dt><dd>${availabilityBadge(ctx, p.availability, { always: true })}</dd></div>
<div><dt>${T('product.number')}</dt><dd><bdi dir="ltr">#${p.id}</bdi></dd></div>
</dl>
</section>`;
}

function stickyBar(ctx, p) {
  const T = ctx.t;
  const action = p.availability === 'out_of_stock'
    ? html`<a class="gb-btn gb-btn--wa gb-pdp-bar__btn" href="${notifyLink(ctx, p)}" target="_blank" rel="noopener" data-track="wa_inquiry" data-kind="notify">${icon('bell')}<span>${T('common.notifyMeShort')}</span><span class="gb-sr"> ${T('a11y.newTab')}</span></a>`
    : html`<button type="button" class="gb-btn gb-btn--primary gb-pdp-bar__btn" data-action="add-to-cart" data-id="${p.id}" data-price="${p.priceFils}" data-qty-from="#pdp-qty" aria-label="${T('a11y.addToCart', { name: pname(ctx, p) })}">${icon('cart-plus')}<span>${T('common.addToCart')}</span></button>`;
  return html`<div class="gb-pdp-bar" id="pdp-bar" role="region" aria-label="${T('product.barLabel')}" data-pdp-bar>
<div class="gb-pdp-bar__in">
<div class="gb-pdp-bar__text"><p class="gb-pdp-bar__name">${nameHtml(ctx, p)}</p><p class="gb-pdp-bar__price">${moneyHtml(p.priceFils, ctx.locale)}${p.availability !== 'in_stock' ? html` <span class="${cls('gb-stock', 'gb-stock--' + p.availability)}">${T('stock.' + p.availability)}</span>` : ''}</p></div>
${action}
</div>
</div>`;
}

export default function routes(ctx) {
  const T = ctx.t;
  return ctx.data.products.map((p) => {
    const route = productRoute(p);
    const name = pname(ctx, p);
    const cat = ctx.data.catById.get(p.category);
    const crumbs = [
      { name: T('nav.home'), route: '' },
      ...(cat ? [{ name: cat.name[ctx.locale], route: categoryRoute(cat.id) }] : []),
      { name, route },
    ];
    const rel = related(ctx, p);
    const main = html`
<div class="gb-wrap gb-pdp" data-product-id="${p.id}">
${breadcrumbs(ctx, crumbs)}
<div class="gb-pdp__top">
${gallery(ctx, p)}
<div class="gb-pdp__summary">
${p.brand ? html`<p class="gb-pdp__brand"><bdi dir="ltr">${p.brand}</bdi></p>` : ''}
<h1 class="gb-pdp__title">${nameHtml(ctx, p)}</h1>
<div class="gb-pdp__pricerow">${priceBlock(ctx, p, { size: 'lg', saving: true })}</div>
<p class="gb-pdp__meta">${availabilityBadge(ctx, p.availability, { always: true })}<span class="gb-pdp__sku">${T('product.sku', { id: p.id })}</span></p>
${buyBox(ctx, p)}
${assurances(ctx)}
</div>
</div>
<div class="gb-pdp__details">
${description(ctx, p)}
${infoList(ctx, p)}
</div>
${rail(ctx, {
  id: 'pdp-related',
  title: T('product.related'),
  subtitle: cat ? T('product.relatedSub', { cat: cat.name[ctx.locale] }) : null,
  products: rel,
  seeAllRoute: cat ? categoryRoute(cat.id) : null,
  seeAllCount: cat ? cat.count : null,
  seeAllAria: cat ? T('a11y.seeAllCat', { cat: cat.name[ctx.locale] }) : null,
})}
<section class="gb-rail gb-pdp__recent" id="pdp-recent" aria-labelledby="pdp-recent-title" hidden>
<div class="gb-sechead"><div class="gb-sechead__text"><h2 class="gb-sechead__title" id="pdp-recent-title">${T('product.recent')}</h2></div></div>
<div class="gb-rail__viewport">
<button type="button" class="gb-rail__nav gb-rail__nav--prev" data-rail="prev" aria-label="${T('a11y.scrollPrev')}" tabindex="-1">${icon('chevron-back')}</button>
<ul class="gb-rail__track" role="list" data-recent-track></ul>
<button type="button" class="gb-rail__nav gb-rail__nav--next" data-rail="next" aria-label="${T('a11y.scrollNext')}" tabindex="-1">${icon('chevron-forward')}</button>
</div>
</section>
</div>
${stickyBar(ctx, p)}`;

    return {
      route,
      html: layout(ctx, {
        route,
        bodyClass: cls('page-product', 'pdp-avail--' + p.availability),
        nav: null,
        head: {
          title: name,
          description: metaDescription(ctx, p),
          og: { type: 'product', image: p.images[0] || null, imageAlt: name, product: p },
          preloadImage: p.images[0] || null,
          jsonld: [graph(ldProduct(ctx, p), ldBreadcrumbs(ctx, crumbs))],
        },
        main,
        pageData: {
          product: {
            id: p.id,
            priceFils: p.priceFils,
            availability: p.availability,
            available: isAvailable(p),
            name,
            url: ctx.abs(route),
          },
          checkoutUrl: ctx.url('checkout/'),
          i18n: {
            shareText: T('product.shareText', { name }),
            linkCopied: T('product.linkCopied'),
            copyFailed: T('product.copyFailed'),
          },
        },
      }),
    };
  });
}
