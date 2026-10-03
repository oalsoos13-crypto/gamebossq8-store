// src/pages/info.mjs — store information pages (SPEC §8 "Info pages"). Owner: content module.
//
// Routes (both locales):  info/how-to-order/  info/delivery-payment/  info/returns/  info/about/  info/privacy/
//
// Honesty (SPEC §6): no invented delivery times, fees, warranties or return terms. Copy that depends on
// configuration is computed at build time:
//   - delivery fee / free-delivery threshold only when config.delivery.confirmed === true
//   - analytics statement from config.analytics (GoatCounter on/off)
//   - third-party image hosts from the catalog itself (disappears once images are mirrored)
//
// Styling: src/css/70-info.css (all selectors under .gb-info; design tokens only).

const PAGES = [
  { slug: 'how-to-order', titleKey: 'footer.howToOrder', icon: 'cart' },
  { slug: 'delivery-payment', titleKey: 'footer.deliveryPayment', icon: 'truck' },
  { slug: 'returns', titleKey: 'footer.returns', icon: 'refresh' },
  { slug: 'about', titleKey: 'footer.aboutUs', icon: 'info' },
  { slug: 'privacy', titleKey: 'footer.privacy', icon: 'user' },
];

export default function routes(ctx) {
  const h = ctx.h;
  const { html, raw, layout, icon, breadcrumbs, waLink, graph, ldBreadcrumbs, ldOrganization, categoryRoute, moneyHtml } = h;
  const T = ctx.t;
  const c = ctx.config.contact;
  const newTab = html`<span class="gb-sr"> ${T('a11y.newTab')}</span>`;

  /* ------------------------------------------------------------------ shared pieces */
  const secHead = (id, ic, title) => html`<h2 class="gb-info__h" id="${id}"><span class="gb-info__ic" aria-hidden="true">${icon(ic)}</span><span>${title}</span></h2>`;
  const checkList = (items, ic = 'check') => html`<ul class="gb-info__list" role="list">${items.map((txt) => html`<li>${icon(ic)}<span>${txt}</span></li>`)}</ul>`;
  const waBtn = (text, label, cls = 'gb-btn gb-btn--wa') => html`<a class="${cls}" href="${waLink(ctx, text)}" target="_blank" rel="noopener">${icon('whatsapp')}<span>${label}</span>${newTab}</a>`;

  function aside(cur, waText) {
    return html`<aside class="gb-info__aside" aria-label="${T('info.navLabel')}">
<nav class="gb-panel gb-info__nav" aria-labelledby="gb-info-nav-title">
<h2 id="gb-info-nav-title">${T('info.navTitle')}</h2>
<ul role="list">${PAGES.map((pg) => html`<li><a href="${ctx.url(`info/${pg.slug}/`)}"${pg.slug === cur ? raw(' aria-current="page"') : ''}>${icon(pg.icon)}<span>${T(pg.titleKey)}</span>${icon('chevron-forward')}</a></li>`)}</ul>
</nav>
<section class="gb-panel gb-info__help" aria-labelledby="gb-info-help-title">
<h2 id="gb-info-help-title">${T('info.helpTitle')}</h2>
<p>${T('info.helpText')}</p>
${waBtn(waText || T('info.waGeneral'), T('nav.chatWhatsapp'), 'gb-btn gb-btn--wa gb-btn--block gb-btn--lg')}
<p class="gb-info__call"><span>${T('info.helpCall')}</span><a href="tel:${c.phone}">${icon('phone')}<bdi dir="ltr">${c.phoneDisplay}</bdi></a></p>
</section>
</aside>`;
  }

  function page(slug, { lead, description, main, waText, jsonld = [] }) {
    const pg = PAGES.find((p) => p.slug === slug);
    const route = `info/${slug}/`;
    const title = T(pg.titleKey);
    const crumbs = [{ name: T('nav.home'), route: '' }, { name: title, route }];
    const body = html`<div class="gb-wrap gb-info gb-info--${slug}">
${breadcrumbs(ctx, crumbs)}
<header class="gb-pagehead gb-info__head">
<p class="gb-eyebrow">${T('nav.info')}</p>
<h1 class="gb-pagehead__title">${title}</h1>
<p class="gb-pagehead__sub">${lead}</p>
</header>
<div class="gb-info__layout">
<div class="gb-info__main">${main}</div>
${aside(slug, waText)}
</div>
</div>`;
    return {
      route,
      html: layout(ctx, {
        route,
        bodyClass: `page-info page-info-${slug}`,
        head: { title, description, jsonld: [graph(ldBreadcrumbs(ctx, crumbs), ...jsonld)] },
        main: body,
      }),
    };
  }

  /* ------------------------------------------------------------------ how to order */
  const steps = [1, 2, 3, 4, 5];
  const howMain = html`<section class="gb-info__sec" aria-labelledby="gb-info-steps">
<h2 class="gb-sr" id="gb-info-steps">${T('info.how.stepsTitle')}</h2>
<ol class="gb-info__steps" role="list">${steps.map((n) => html`<li class="gb-info__step"><span class="gb-info__num" aria-hidden="true">${n}</span><div><h3><span class="gb-sr">${n}. </span>${T(`info.how.s${n}Title`)}</h3><p>${T(`info.how.s${n}Text`)}</p></div></li>`)}</ol>
<p class="gb-alert" role="note">${icon('info')}<span>${T('info.how.important')}</span></p>
</section>
<section class="gb-panel gb-info__sec" aria-labelledby="gb-info-tips">
${secHead('gb-info-tips', 'sparkles', T('info.how.tipsTitle'))}
${checkList([T('info.how.tip1'), T('info.how.tip2'), T('info.how.tip3'), T('info.how.tip4')])}
<div class="gb-info__actions">
<a class="gb-btn gb-btn--primary" href="${ctx.url('')}">${icon('home')}<span>${T('info.shopNow')}</span></a>
<a class="gb-btn gb-btn--light" href="${ctx.url(categoryRoute(ctx.data.categories[0].id))}" data-dialog-open="gb-menu" aria-haspopup="dialog" aria-controls="gb-menu">${icon('grid')}<span>${T('info.browseCats')}</span></a>
</div>
</section>`;

  /* ------------------------------------------------------------------ delivery & payment */
  const d = ctx.config.delivery || {};
  const govs = (ctx.config.governorates || []).filter((g) => T.has(`info.dp.gov.${g}`));
  const pays = ctx.config.payments || ['cod', 'knet_link'];
  const feeBlock = d.confirmed
    ? html`<p class="gb-info__fact">${icon('tag')}<span>${raw(T('info.dp.feeConfirmed', { fee: '\u0000' }).replace('\u0000', String(moneyHtml(d.feeFils, ctx.locale)).replace(/\$/g, '$$$$')))}</span></p>
${d.freeOverFils ? html`<p class="gb-info__fact">${icon('truck')}<span>${raw(T('info.dp.freeOver', { amount: '\u0000' }).replace('\u0000', String(moneyHtml(d.freeOverFils, ctx.locale))))}</span></p>` : ''}`
    : html`<p class="gb-info__fact">${icon('chat')}<span>${T('info.dp.feeTbc')}</span></p>`;
  const dpMain = html`<section class="gb-panel gb-info__sec" aria-labelledby="gb-info-delivery">
${secHead('gb-info-delivery', 'truck', T('info.dp.deliveryTitle'))}
<p>${T('info.dp.areas')}</p>
<ul class="gb-info__tags" role="list">${govs.map((g) => html`<li class="gb-info__tag">${icon('map-pin')}<span>${T(`info.dp.gov.${g}`)}</span></li>`)}</ul>
<h3 class="gb-info__sub">${T('info.dp.feeTitle')}</h3>
${feeBlock}
<h3 class="gb-info__sub">${T('info.dp.timeTitle')}</h3>
<p class="gb-info__fact">${icon('clock')}<span>${T('info.dp.timeText')}</span></p>
</section>
<section class="gb-panel gb-info__sec" aria-labelledby="gb-info-pay">
${secHead('gb-info-pay', 'cash', T('info.dp.payTitle'))}
<div class="gb-info__cards">
${pays.includes('cod') ? html`<div class="gb-info__card"><h3>${icon('cash')}<span>${T('info.dp.codTitle')}</span></h3><p>${T('info.dp.codText')}</p></div>` : ''}
${pays.includes('knet_link') ? html`<div class="gb-info__card"><h3>${icon('card')}<span>${T('info.dp.knetTitle')}</span></h3><p>${T('info.dp.knetText')}</p></div>` : ''}
</div>
<p class="gb-alert gb-alert--ok" role="note">${icon('info')}<span>${T('info.dp.noCard')} ${T('info.dp.currency')}</span></p>
</section>`;

  /* ------------------------------------------------------------------ returns */
  const retMain = html`<section class="gb-panel gb-info__sec" aria-labelledby="gb-info-ask">
${secHead('gb-info-ask', 'chat', T('info.ret.noticeTitle'))}
<p>${T('info.ret.notice')}</p>
<div class="gb-info__actions">${waBtn(T('info.ret.waMsg'), T('info.ret.cta'))}</div>
</section>
<section class="gb-panel gb-info__sec" aria-labelledby="gb-info-before">
${secHead('gb-info-before', 'search', T('info.ret.beforeTitle'))}
${checkList([T('info.ret.before1'), T('info.ret.before2')])}
</section>
<section class="gb-panel gb-info__sec" aria-labelledby="gb-info-receive">
${secHead('gb-info-receive', 'box', T('info.ret.receiveTitle'))}
${checkList([T('info.ret.receive1'), T('info.ret.receive2'), T('info.ret.receive3')])}
</section>`;

  /* ------------------------------------------------------------------ about */
  const cats = ctx.data.categories;
  const brands = ctx.config.trustBrands || [];
  const contacts = [
    { href: waLink(ctx, T('common.waGreeting')), ic: 'whatsapp', label: T('info.about.waLabel'), value: c.phoneDisplay, ltr: true, ext: true },
    { href: `tel:${c.phone}`, ic: 'phone', label: T('info.about.phoneLabel'), value: c.phoneDisplay, ltr: true },
    { href: c.instagram, ic: 'instagram', label: T('info.about.igLabel'), value: '@' + c.instagram.replace(/\/+$/, '').split('/').pop(), ltr: true, ext: true },
    { href: c.tiktok, ic: 'tiktok', label: T('info.about.ttLabel'), value: c.tiktok.replace(/\/+$/, '').split('/').pop(), ltr: true, ext: true },
  ];
  const aboutMain = html`<section class="gb-panel gb-info__sec" aria-labelledby="gb-info-who">
${secHead('gb-info-who', 'sparkles', T('info.about.whoTitle'))}
<p>${T('info.about.who1')}</p>
<p>${T('info.about.who2', { products: T('common.products', { n: ctx.data.products.length }), cats: T('info.about.cats', { n: cats.length }) })}</p>
${brands.length ? html`<h3 class="gb-info__sub">${T('info.about.brandsTitle')}</h3>
<p class="gb-muted">${T('info.about.brandsText')}</p>
<ul class="gb-info__tags" role="list">${brands.map((b) => html`<li class="gb-info__tag" lang="en" dir="ltr">${b}</li>`)}</ul>` : ''}
</section>
<section class="gb-panel gb-info__sec" aria-labelledby="gb-info-work">
${secHead('gb-info-work', 'check', T('info.about.howTitle'))}
${checkList([T('info.about.how1'), T('info.about.how2'), T('info.about.how3')])}
</section>
<section class="gb-panel gb-info__sec" aria-labelledby="gb-info-cats">
${secHead('gb-info-cats', 'grid', T('info.about.catsTitle'))}
<ul class="gb-info__cats" role="list">${cats.map((cat) => html`<li><a href="${ctx.url(categoryRoute(cat.id))}"><span>${cat.name[ctx.locale]}</span><small>${cat.count}</small></a></li>`)}</ul>
</section>
<section class="gb-panel gb-info__sec" aria-labelledby="gb-info-contact">
${secHead('gb-info-contact', 'chat', T('info.about.contactTitle'))}
<ul class="gb-info__contacts" role="list">${contacts.map((it) => html`<li><a class="gb-info__contact" href="${it.href}"${it.ext ? raw(' target="_blank" rel="noopener"') : ''}>${icon(it.ic)}<span><small>${it.label}</small><b dir="ltr">${it.value}</b></span>${it.ext ? newTab : ''}</a></li>`)}</ul>
</section>`;

  /* ------------------------------------------------------------------ privacy */
  const analyticsOn = !!(ctx.config.analytics && ctx.config.analytics.provider === 'goatcounter' && ctx.config.analytics.code);
  const imgHosts = [...new Set(ctx.data.products.flatMap((p) => p.images).filter((u) => /^https?:\/\//i.test(u))
    .map((u) => { try { return new URL(u).hostname; } catch { return null; } }).filter(Boolean))].sort();
  const third = [T('info.priv.tWa'), T('info.priv.tHost')];
  if (imgHosts.length) third.push(T('info.priv.tImages', { hosts: imgHosts.join(ctx.locale === 'ar' ? '، ' : ', ') }));
  third.push(T('info.priv.tFonts'), T(analyticsOn ? 'info.priv.tAnalyticsOn' : 'info.priv.tAnalyticsOff'));
  const privMain = html`<section class="gb-panel gb-info__sec" aria-labelledby="gb-info-local">
${secHead('gb-info-local', 'box', T('info.priv.localTitle'))}
<p>${T('info.priv.localIntro')}</p>
<div style="margin-block-start:12px">${checkList(['lCart', 'lWish', 'lRecent', 'lOrders', 'lCustomer', 'lSrc', 'lOffline'].map((k) => T(`info.priv.${k}`)), 'check')}</div>
<p class="gb-alert gb-alert--ok" role="note">${icon('info')}<span>${T('info.priv.localNote')}</span></p>
</section>
<section class="gb-panel gb-info__sec" aria-labelledby="gb-info-send">
${secHead('gb-info-send', 'whatsapp', T('info.priv.sendTitle'))}
<p>${T('info.priv.send1')}</p>
<p>${T('info.priv.send2')}</p>
</section>
<section class="gb-panel gb-info__sec" aria-labelledby="gb-info-third">
${secHead('gb-info-third', 'globe', T('info.priv.thirdTitle'))}
${checkList(third, 'info')}
</section>
<section class="gb-panel gb-info__sec" aria-labelledby="gb-info-control">
${secHead('gb-info-control', 'sliders', T('info.priv.controlTitle'))}
${checkList([T('info.priv.c1'), T('info.priv.c2'), T('info.priv.c3')])}
</section>`;

  return [
    page('how-to-order', { lead: T('info.how.lead'), description: T('info.how.metaDesc'), main: howMain }),
    page('delivery-payment', { lead: T('info.dp.lead'), description: T('info.dp.metaDesc'), main: dpMain, waText: T('info.dp.waMsg') }),
    page('returns', { lead: T('info.ret.lead'), description: T('info.ret.metaDesc'), main: retMain, waText: T('info.ret.waMsg') }),
    page('about', { lead: T('info.about.lead'), description: T('info.about.metaDesc'), main: aboutMain, jsonld: [ldOrganization(ctx)] }),
    page('privacy', { lead: T('info.priv.lead'), description: T('info.priv.metaDesc'), main: privMain, waText: T('info.priv.waMsg') }),
  ];
}
