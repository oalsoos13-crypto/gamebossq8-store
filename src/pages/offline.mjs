// src/pages/offline.mjs — offline/ (per locale, noindex). Precached by sw.js and served for any navigation that fails
// while offline (at the URL the customer asked for). src/js/60-pwa.js adds: retry (reloads the requested URL), auto-retry
// when the connection returns, and a list of pages this device already has in the service-worker cache.

const INFO = [
  ['how-to-order', 'footer.howToOrder'],
  ['delivery-payment', 'footer.deliveryPayment'],
  ['returns', 'footer.returns'],
  ['about', 'footer.aboutUs'],
  ['privacy', 'footer.privacy'],
];

export default function routes(ctx) {
  const { html, layout, icon } = ctx.h;
  const T = ctx.t;
  const route = 'offline/';

  const main = html`
<div class="gb-wrap gb-off">
<section class="gb-off__hero" aria-labelledby="off-title">
<div class="gb-off__icon" aria-hidden="true">${icon('wifi-off')}</div>
<p class="gb-eyebrow">${T('offline.eyebrow')}</p>
<h1 class="gb-off__title" id="off-title" tabindex="-1">${T('offline.title')}</h1>
<p class="gb-off__text">${T('offline.text')}</p>
<p class="gb-off__note">${icon('cart')}<span>${T('offline.cartSafe')}</span></p>
<div class="gb-off__actions">
<button type="button" class="gb-btn gb-btn--primary" data-action="pwa-retry">${icon('refresh')}<span>${T('offline.retry')}</span></button>
<a class="gb-btn gb-btn--light" href="${ctx.url('')}">${icon('home')}<span>${T('common.backHome')}</span></a>
</div>
<p class="gb-off__status" id="off-status" role="status" aria-live="polite"></p>
</section>
<section class="gb-off__saved" id="off-saved" aria-labelledby="off-saved-title" hidden>
<h2 class="gb-off__h" id="off-saved-title">${T('offline.savedTitle')}</h2>
<p class="gb-off__sub">${T('offline.savedText')}</p>
<ul class="gb-off__list" id="off-list" role="list"></ul>
</section>
</div>`;

  return [{
    route,
    html: layout(ctx, {
      route,
      nav: null,
      bodyClass: 'page-offline',
      head: { title: T('offline.metaTitle'), description: T('offline.metaDesc'), noindex: true },
      main,
      pageData: {
        labels: {
          home: T('nav.home'),
          search: T('nav.search'),
          wishlist: T('nav.wishlist'),
          checkout: T('nav.cart'),
          checking: T('offline.checking'),
          stillOffline: T('offline.stillOffline'),
          backOnline: T('offline.backOnline'),
        },
        cats: Object.fromEntries(ctx.data.categories.map((c) => [c.id, c.name[ctx.locale]])),
        info: Object.fromEntries(INFO.map(([slug, key]) => [slug, T(key)])),
      },
    }),
  }];
}
