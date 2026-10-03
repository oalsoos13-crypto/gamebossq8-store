// src/core/layout.mjs — the full document: <head>, chrome (header, tab bar, footer, FAB), dialog shells,
// toast/live regions, inline config + i18n JSON. Page modules only supply <main> content.
//
// layout(ctx, {
//   route,          // REQUIRED locale-neutral route (also used for head(), lang switch and active nav)
//   head: {…},      // options for head() (route is filled in); OR a SafeHtml string used verbatim
//   main,           // SafeHtml: content of <main id="main">
//   bodyClass,      // extra <body> classes, e.g. 'page-product'
//   altRoute,       // route of the counterpart page in the other locale (default: same route; null → other home)
//   nav,            // active tab: 'home'|'categories'|'search'|'wishlist'|'cart'|null (default derived from route)
//   tabbar,         // default true; false hides the mobile bottom tab bar (checkout)
//   fab,            // default true; false hides the floating WhatsApp button
//   pageData,       // optional JSON-serialisable object → <script type="application/json" id="gb-page"> (read with GB.page())
// })

import { html, raw, jsonForScript, SafeHtml, attrs } from './html.mjs';
import { head as renderHead } from './head.mjs';
import { icon, sprite, art } from './icons.mjs';
import { categoryRoute } from './url.mjs';
import { clientSubset } from './i18n.mjs';
import { waLink } from './components.mjs';

const INFO_PAGES = [
  ['how-to-order', 'footer.howToOrder'],
  ['delivery-payment', 'footer.deliveryPayment'],
  ['returns', 'footer.returns'],
  ['about', 'footer.aboutUs'],
  ['privacy', 'footer.privacy'],
];

function navFromRoute(route) {
  if (route === '') return 'home';
  if (route.startsWith('search/')) return 'search';
  if (route.startsWith('wishlist/')) return 'wishlist';
  if (route.startsWith('c/')) return 'categories';
  return null;
}

function langSwitch(ctx, altRoute, extraCls) {
  const other = ctx.locale === 'ar' ? 'en' : 'ar';
  const href = altRoute === null ? ctx.url('', other) : ctx.url(altRoute, other);
  // header: short visible label ("EN" / "عربي") + full SR label; footer (extraCls set): full visible label
  if (extraCls) return html`<a class="gb-lang ${extraCls}" href="${href}" hreflang="${other}" lang="${other}" data-lang-switch>${icon('globe')}<span>${ctx.t('nav.switchLang')}</span></a>`;
  return html`<a class="gb-lang" href="${href}" hreflang="${other}" lang="${other}" data-lang-switch><span aria-hidden="true">${ctx.t('nav.switchLangShort')}</span><span class="gb-sr">${ctx.t('nav.switchLang')}</span></a>`;
}

export function header(ctx, o) {
  const T = ctx.t;
  return html`<header class="gb-header" id="gb-header">
<div class="gb-wrap gb-header__bar">
<a class="gb-logo" href="${ctx.url('')}" aria-label="${T('nav.homeLabel')}"><span class="gb-logo__mark" aria-hidden="true">G</span><span class="gb-logo__word" aria-hidden="true" dir="ltr">GameBoss<i> Q8</i></span></a>
<button type="button" class="gb-header__cats gb-only-desk" data-dialog-open="gb-menu" aria-haspopup="dialog" aria-controls="gb-menu">${icon('grid')}<span>${T('nav.categories')}</span></button>
<a class="gb-searchbtn" href="${ctx.url('search/')}" data-dialog-open="gb-search" aria-haspopup="dialog" aria-controls="gb-search">${icon('search')}<span class="gb-searchbtn__ph">${T('nav.searchPlaceholder')}</span><span class="gb-sr">${T('nav.search')}</span></a>
<div class="gb-header__actions">
<a class="gb-iconbtn gb-only-mob" href="${waLink(ctx, T('common.waGreeting'))}" target="_blank" rel="noopener" aria-label="${T('nav.chatWhatsapp')} ${T('a11y.newTab')}">${icon('whatsapp')}</a>
${langSwitch(ctx, o.altRoute)}
<a class="gb-iconbtn gb-only-desk" href="${ctx.url('wishlist/')}" data-count-label="wish" aria-label="${T('nav.wishlist')}">${icon('heart')}<span class="gb-count" data-count="wish" aria-hidden="true" hidden>0</span></a>
<button type="button" class="gb-iconbtn gb-only-desk" data-dialog-open="gb-cart" aria-haspopup="dialog" aria-controls="gb-cart" data-count-label="cart" aria-label="${T('a11y.cartCount', { n: 0 })}">${icon('cart')}<span class="gb-count" data-count="cart" aria-hidden="true" hidden>0</span></button>
</div>
</div>
</header>`;
}

export function tabbar(ctx, o) {
  const T = ctx.t;
  const cur = (k) => (o.nav === k ? raw(' aria-current="page"') : '');
  return html`<nav class="gb-tabbar" aria-label="${T('nav.tabbar')}"><ul role="list">
<li><a class="gb-tab" href="${ctx.url('')}"${cur('home')}>${icon('home')}<span>${T('nav.home')}</span></a></li>
<li><button type="button" class="gb-tab" data-dialog-open="gb-menu" aria-haspopup="dialog" aria-controls="gb-menu"${o.nav === 'categories' ? raw(' data-current="true"') : ''}>${icon('grid')}<span>${T('nav.categories')}</span></button></li>
<li><a class="gb-tab" href="${ctx.url('search/')}" data-dialog-open="gb-search" aria-haspopup="dialog" aria-controls="gb-search"${cur('search')}>${icon('search')}<span>${T('nav.search')}</span></a></li>
<li><a class="gb-tab" href="${ctx.url('wishlist/')}" data-count-label="wish"${cur('wishlist')}>${icon('heart')}<span>${T('nav.wishlist')}</span><span class="gb-count" data-count="wish" aria-hidden="true" hidden>0</span></a></li>
<li><button type="button" class="gb-tab" data-dialog-open="gb-cart" aria-haspopup="dialog" aria-controls="gb-cart" data-count-label="cart" aria-label="${T('a11y.cartCount', { n: 0 })}">${icon('cart')}<span aria-hidden="true">${T('nav.cart')}</span><span class="gb-count" data-count="cart" aria-hidden="true" hidden>0</span></button></li>
</ul></nav>`;
}

export function footer(ctx, o) {
  const T = ctx.t;
  const c = ctx.config.contact;
  const ext = (href, label, ic, extra) => html`<a href="${href}" target="_blank" rel="noopener"${extra || ''}>${icon(ic)}<span>${label}</span><span class="gb-sr"> ${T('a11y.newTab')}</span></a>`;
  return html`<footer class="gb-footer">
<div class="gb-wrap">
<div class="gb-footer__grid">
<section class="gb-footer__about" aria-label="GameBoss Q8">
<a class="gb-logo" href="${ctx.url('')}" aria-label="${T('nav.homeLabel')}"><span class="gb-logo__mark" aria-hidden="true">G</span><span class="gb-logo__word gb-logo__word--always" aria-hidden="true" dir="ltr">GameBoss<i> Q8</i></span></a>
<p>${T('footer.about')}</p>
<ul class="gb-social" role="list">
<li><a href="${waLink(ctx, T('common.waGreeting'))}" target="_blank" rel="noopener" aria-label="${T('footer.whatsapp')} ${T('a11y.newTab')}">${icon('whatsapp')}</a></li>
<li><a href="${c.instagram}" target="_blank" rel="noopener" aria-label="${T('footer.instagram')} ${T('a11y.newTab')}">${icon('instagram')}</a></li>
<li><a href="${c.tiktok}" target="_blank" rel="noopener" aria-label="${T('footer.tiktok')} ${T('a11y.newTab')}">${icon('tiktok')}</a></li>
</ul>
</section>
<section aria-labelledby="gb-f-cats"><h2 class="gb-footer__h" id="gb-f-cats">${T('footer.categories')}</h2>
<ul class="gb-footer__links gb-footer__links--cols" role="list">${ctx.data.categories.map((cat) => html`<li><a href="${ctx.url(categoryRoute(cat.id))}">${cat.name[ctx.locale]}</a></li>`)}</ul></section>
<section aria-labelledby="gb-f-help"><h2 class="gb-footer__h" id="gb-f-help">${T('footer.help')}</h2>
<ul class="gb-footer__links" role="list">${INFO_PAGES.map(([slug, key]) => html`<li><a href="${ctx.url(`info/${slug}/`)}">${T(key)}</a></li>`)}</ul></section>
<section aria-labelledby="gb-f-contact"><h2 class="gb-footer__h" id="gb-f-contact">${T('footer.contact')}</h2>
<ul class="gb-footer__links" role="list">
<li>${ext(waLink(ctx, T('common.waGreeting')), T('footer.whatsapp'), 'whatsapp')}</li>
<li><a href="tel:${c.phone}">${icon('phone')}<span dir="ltr">${c.phoneDisplay}</span></a></li>
<li>${ext(c.instagram, T('footer.instagram'), 'instagram')}</li>
<li>${ext(c.tiktok, T('footer.tiktok'), 'tiktok')}</li>
<li>${langSwitch(ctx, o.altRoute, 'gb-lang--footer')}</li>
</ul></section>
</div>
<div class="gb-footer__bottom"><p>${T('footer.rights', { year: ctx.year })}</p><p>${T('footer.madeIn')}</p></div>
</div>
</footer>`;
}

/** Empty dialog shells. Module agents fill the *-body / *-foot containers (see CONTRACTS.md §6). */
export function dialogs(ctx) {
  const T = ctx.t;
  const close = (label) => html`<button type="button" class="gb-dialog__close" data-dialog-close aria-label="${label}">${icon('x')}</button>`;
  return html`<dialog id="gb-cart" class="gb-dialog gb-dialog--drawer" aria-labelledby="gb-cart-title">
<div class="gb-dialog__head"><h2 class="gb-dialog__title" id="gb-cart-title" tabindex="-1">${T('common.cartTitle')}</h2>${close(T('common.closeCart'))}</div>
<div class="gb-dialog__body" id="gb-cart-body"></div>
<div class="gb-dialog__foot" id="gb-cart-foot" hidden></div>
</dialog>
<dialog id="gb-search" class="gb-dialog gb-dialog--top" aria-labelledby="gb-search-title">
<div class="gb-dialog__head"><h2 class="gb-dialog__title" id="gb-search-title" tabindex="-1">${T('common.searchTitle')}</h2>${close(T('common.closeSearch'))}</div>
<form class="gb-searchform" id="gb-search-form" role="search" action="${ctx.url('search/')}" method="get">
<label class="gb-sr" for="gb-search-input">${T('nav.search')}</label>
${icon('search', { cls: 'gb-searchform__icon' })}
<input class="gb-input gb-searchform__input" id="gb-search-input" name="q" type="search" data-autofocus enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="${T('nav.searchPlaceholder')}">
<button class="gb-btn gb-btn--primary gb-searchform__submit" type="submit">${T('nav.searchSubmit')}</button>
</form>
<div class="gb-dialog__body" id="gb-search-body"></div>
</dialog>
<dialog id="gb-menu" class="gb-dialog gb-dialog--drawer gb-dialog--start" aria-labelledby="gb-menu-title">
<div class="gb-dialog__head"><h2 class="gb-dialog__title" id="gb-menu-title" tabindex="-1">${T('common.menuTitle')}</h2>${close(T('common.closeMenu'))}</div>
<div class="gb-dialog__body" id="gb-menu-body">
<ul class="gb-menu" role="list">${ctx.data.categories.map((cat) => html`<li><a class="gb-menu__item" href="${ctx.url(categoryRoute(cat.id))}">${art(cat.icon, { cls: 'gb-menu__art' })}<span class="gb-menu__name">${cat.name[ctx.locale]}</span><span class="gb-menu__count">${cat.count}</span></a></li>`)}</ul>
<ul class="gb-menu gb-menu--plain gb-menu--all" role="list"><li><a class="gb-menu__item gb-menu__item--all" href="${ctx.url('c/all/')}">${icon('grid', { cls: 'gb-menu__icon' })}<span class="gb-menu__name">${T('nav.allProducts')}</span><span class="gb-menu__count">${ctx.data.products.length}</span></a></li></ul>
<h3 class="gb-menu__h">${T('nav.info')}</h3>
<ul class="gb-menu gb-menu--plain" role="list">${INFO_PAGES.map(([slug, key]) => html`<li><a class="gb-menu__item" href="${ctx.url(`info/${slug}/`)}"><span class="gb-menu__name">${T(key)}</span></a></li>`)}</ul>
</div>
</dialog>`;
}

export function layout(ctx, o = {}) {
  if (o.route === undefined) throw new Error('layout(): route is required');
  const route = o.route;
  const opts = {
    altRoute: o.altRoute === undefined ? route : o.altRoute,
    nav: o.nav === undefined ? navFromRoute(route) : o.nav,
  };
  const headHtml = o.head instanceof SafeHtml ? o.head : renderHead(ctx, { route, ...(o.head || {}), alternates: (o.head && o.head.alternates !== undefined) ? o.head.alternates : opts.altRoute !== null });
  const cfg = ctx.clientConfig({ route, altUrl: opts.altRoute === null ? ctx.url('', ctx.locale === 'ar' ? 'en' : 'ar') : ctx.url(opts.altRoute, ctx.locale === 'ar' ? 'en' : 'ar') });
  const bodyCls = ['gb', o.bodyClass, o.tabbar === false ? 'no-tabbar' : '', o.fab === false ? 'no-fab' : ''].filter(Boolean).join(' ');
  const analytics = ctx.config.analytics && ctx.config.analytics.provider === 'goatcounter' && ctx.config.analytics.code
    ? html`<script data-goatcounter="https://${ctx.config.analytics.code}.goatcounter.com/count" data-goatcounter-settings='{"no_onload":true}' async src="https://gc.zgo.at/count.js"></script>` : '';
  return html`<!doctype html>
<html lang="${ctx.locale}" dir="${ctx.dir}"${attrs({ 'data-base': ctx.base, 'data-publish': ctx.publishId })}>
<head>
${headHtml}
${analytics}
</head>
<body class="${bodyCls}">
<a class="gb-skip" href="#main">${ctx.t('nav.skip')}</a>
${sprite()}
${header(ctx, opts)}
<div class="gb-banner" id="gb-banner" hidden></div>
<main id="main" tabindex="-1">
${o.main || ''}
</main>
${footer(ctx, opts)}
${o.tabbar === false ? '' : tabbar(ctx, opts)}
${o.fab === false ? '' : html`<a class="gb-fab" href="${waLink(ctx, ctx.t('common.waGreeting'))}" target="_blank" rel="noopener" aria-label="${ctx.t('nav.chatWhatsapp')} ${ctx.t('a11y.newTab')}">${icon('whatsapp')}</a>`}
${dialogs(ctx)}
<div class="gb-toast" id="gb-toast" role="status" aria-live="polite" aria-atomic="true"></div>
<div class="gb-sr" id="gb-live" aria-live="polite" aria-atomic="true"></div>
<script type="application/json" id="gb-config">${jsonForScript(cfg)}</script>
<script type="application/json" id="gb-i18n">${jsonForScript(clientSubset(ctx.i18n, ctx.locale, ctx.config.clientI18n))}</script>
${o.pageData !== undefined ? html`<script type="application/json" id="gb-page">${jsonForScript(o.pageData)}</script>` : ''}
</body>
</html>
`;
}
