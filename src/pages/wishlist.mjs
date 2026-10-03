// src/pages/wishlist.mjs — wishlist/ (cart module, SPEC §8). The list lives in localStorage (GB.wish), so the
// page is a prerendered shell; src/js/32-wishlist.js renders the items from products.json.

import { cartPageI18n } from './checkout.mjs';

export default function routes(ctx) {
  const { html, layout, breadcrumbs, emptyState, icon } = ctx.h;
  const T = ctx.t;
  const route = 'wishlist/';

  const main = html`
<div class="gb-wrap gb-wl">
${breadcrumbs(ctx, [{ name: T('nav.home'), route: '' }, { name: T('wishlist.title'), route }])}
<header class="gb-pagehead gb-wl-head">
<div class="gb-wl-head__text">
<h1 class="gb-pagehead__title" id="wl-title" tabindex="-1">${T('wishlist.title')}</h1>
<p class="gb-pagehead__sub" id="wl-count" aria-live="polite">${T('wishlist.lead')}</p>
</div>
<div class="gb-wl-tools" id="wl-tools" hidden>
<button type="button" class="gb-btn gb-btn--primary" data-action="wishlist-move-all">${icon('cart-plus')}<span>${T('wishlist.moveAll')}</span></button>
<a class="gb-btn gb-btn--wa" id="wl-share" href="https://wa.me/" target="_blank" rel="noopener">${icon('whatsapp')}<span>${T('wishlist.share')}</span><span class="gb-sr"> ${T('a11y.newTab')}</span></a>
</div>
</header>
<noscript><p class="gb-alert">${icon('info')}<span>${T('wishlist.noscript')}</span></p></noscript>
<div id="wl-app" class="gb-wl-app">
<div id="wl-boot" class="gb-cart-boot" role="status"><span class="gb-cart-spinner" aria-hidden="true"></span><span>${T('common.loading')}</span></div>
<div id="wl-empty" hidden>${emptyState(ctx, {
    icon: 'heart', title: T('wishlist.emptyTitle'), text: T('wishlist.emptyText'),
    actions: html`<a class="gb-btn gb-btn--primary" href="${ctx.url('c/all/')}">${T('wishlist.browse')}</a><a class="gb-btn gb-btn--light" href="${ctx.url('')}">${T('common.backHome')}</a>`,
  })}</div>
<ul id="wl-list" class="gb-grid gb-wl-grid" role="list" aria-labelledby="wl-title" hidden></ul>
</div>
</div>`;

  return [{
    route,
    html: layout(ctx, {
      route,
      bodyClass: 'page-wishlist',
      nav: 'wishlist',
      head: { title: T('wishlist.metaTitle'), description: T('wishlist.metaDesc'), noindex: true },
      main,
      pageData: { cartI18n: cartPageI18n(ctx, ['wishlist.']) },
    }),
  }];
}
