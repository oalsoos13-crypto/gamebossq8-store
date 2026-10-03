// src/core/components.mjs — shared server-rendered components. All return SafeHtml.
// Class names (BEM, "gb-" prefix) are part of the contract — see CONTRACTS.md §5 — and are mirrored by
// the client renderer GB.ui.card() in src/js/20-ui.js.

import { html, raw, attrs, cls, esc, hasArabic } from './html.mjs';
import { icon, art } from './icons.mjs';
import { moneyHtml, money, discountPct } from './money.mjs';
import { productRoute, categoryRoute, imageUrl } from './url.mjs';

/** Display name in the page locale. */
export const pname = (ctx, p) => p.name[ctx.locale] || p.name.ar;

/** <bdi> wrapped product name; Latin-only names get lang="en" dir="ltr" (a11y lens §10). */
export function nameHtml(ctx, p) {
  const n = pname(ctx, p);
  return hasArabic(n) ? html`<bdi>${n}</bdi>` : html`<bdi lang="en" dir="ltr">${n}</bdi>`;
}

/** https://wa.me/<number>?text=<encoded> */
export function waLink(ctx, text) {
  const n = ctx.config.contact.whatsapp;
  return text ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : `https://wa.me/${n}`;
}

/** wa.me link asking to be notified when p is back in stock. */
export function notifyLink(ctx, p) {
  return waLink(ctx, ctx.t('common.notifyMsg', { name: pname(ctx, p), id: p.id, url: ctx.abs(productRoute(p), ctx.locale) }));
}

/**
 * 1:1 white media box with category-art placeholder underneath the image.
 * opts: { eager (LCP), index (image index, default 0), alt (default ''), cls }
 * No image → class "is-empty" (placeholder only, "Image coming soon" for SR users when alt requested).
 * Load failure → JS adds .img-failed on <img> and .is-failed on the box (CSS hides the img).
 */
export function productMedia(ctx, p, opts = {}) {
  const cat = ctx.data.catById.get(p.category);
  const src = p.images[opts.index || 0];
  const img = src ? html`<img class="gb-media__img" src="${imageUrl(src, ctx.asset)}" alt="${opts.alt || ''}" width="800" height="800"${opts.eager
    ? raw(' loading="eager" fetchpriority="high"') : raw(' loading="lazy"')} decoding="async">` : '';
  return html`<div class="${cls('gb-media', !src && 'is-empty', opts.cls)}">${art(cat ? cat.icon : 'bundle', { cls: 'gb-media__ph' })}${img}</div>`;
}

/** Availability badge. opts.always → also render for in_stock. */
export function availabilityBadge(ctx, availability, opts = {}) {
  if (availability === 'in_stock' && !opts.always) return html``;
  return html`<span class="${cls('gb-stock', 'gb-stock--' + availability, opts.cls)}">${ctx.t('stock.' + availability)}</span>`;
}

/**
 * Price block: current price, compare-at (struck) and discount %.
 * opts: { size: 'sm'|'md'|'lg', saving: bool (adds "وفّر X د.ك" line) }
 */
export function priceBlock(ctx, p, opts = {}) {
  const pct = discountPct(p.priceFils, p.compareAtFils);
  return html`<div class="${cls('gb-price', opts.size && 'gb-price--' + opts.size, pct && 'is-sale')}"><span class="gb-price__now">${moneyHtml(p.priceFils, ctx.locale)}</span>${
    pct ? html`<s class="gb-price__was"><span class="gb-sr">${ctx.t('price.was')} </span>${moneyHtml(p.compareAtFils, ctx.locale)}</s><span class="gb-price__off"><span aria-hidden="true">${ctx.t('price.off', { pct })}</span><span class="gb-sr">${ctx.t('price.offLabel', { pct })}</span></span>` : ''}${
    pct && opts.saving ? html`<span class="gb-price__save">${ctx.t('price.save', { amount: money(p.compareAtFils - p.priceFils, ctx.locale) })}</span>` : ''}</div>`;
}

/** Wishlist toggle button (state synced client-side by 20-ui.js). */
export function wishButton(ctx, p, opts = {}) {
  const n = pname(ctx, p);
  return html`<button type="button" class="${cls('gb-wish', opts.cls)}" data-action="wish-toggle" data-id="${p.id}" aria-pressed="false"
 data-label-add="${ctx.t('a11y.wishAdd', { name: n })}" data-label-remove="${ctx.t('a11y.wishRemove', { name: n })}" aria-label="${ctx.t('a11y.wishAdd', { name: n })}">${icon('heart', { cls: 'gb-wish__off' })}${icon('heart-fill', { cls: 'gb-wish__on' })}</button>`;
}

/** Add-to-cart button (or notify link for out_of_stock). opts: { label: 'full'|'icon', cls, qty } */
export function addButton(ctx, p, opts = {}) {
  const n = pname(ctx, p);
  if (p.availability === 'out_of_stock') {
    return html`<a class="${cls('gb-btn', 'gb-btn--notify', opts.cls)}" href="${notifyLink(ctx, p)}" target="_blank" rel="noopener" aria-label="${ctx.t('a11y.notify', { name: n })} ${ctx.t('a11y.newTab')}">${icon('bell')}<span>${ctx.t('common.notifyMeShort')}</span></a>`;
  }
  return html`<button type="button" class="${cls('gb-btn', 'gb-btn--add', opts.cls)}" data-action="add-to-cart" data-id="${p.id}" data-price="${p.priceFils}"${opts.qty ? html` data-qty="${opts.qty}"` : ''} aria-label="${ctx.t('a11y.addToCart', { name: n })}">${icon('cart-plus')}<span>${ctx.t('common.addToCart')}</span></button>`;
}

/**
 * Product card. opts: { eager (LCP image), level (heading level, default 3), cls, showStock }
 * data-* attributes power client-side sorting/filtering (catalog agent):
 *   data-id data-cat data-brand data-price data-compare data-off data-avail data-sort data-new data-featured
 */
export function productCard(ctx, p, opts = {}) {
  const level = opts.level || 3;
  const pct = discountPct(p.priceFils, p.compareAtFils);
  const href = ctx.url(productRoute(p));
  const titleId = `pn-${p.id}${opts.idSuffix ? '-' + opts.idSuffix : ''}`;
  const badges = [];
  if (pct) badges.push(html`<span class="gb-flag gb-flag--sale">${ctx.t('price.off', { pct })}</span>`);
  if (p.isNew && p.availability !== 'out_of_stock') badges.push(html`<span class="gb-flag gb-flag--new">${ctx.t('stock.new')}</span>`);
  return html`<article class="${cls('gb-card', p.availability === 'out_of_stock' && 'is-oos', pct && 'is-sale', opts.cls)}"${attrs({
    'data-id': p.id, 'data-cat': p.category, 'data-brand': p.brand || '', 'data-price': p.priceFils, 'data-compare': p.compareAtFils || '',
    'data-off': pct, 'data-avail': p.availability, 'data-sort': p.sort, 'data-new': p.isNew ? 1 : 0, 'data-featured': p.featured ? 1 : 0,
  })}>
${productMedia(ctx, p, { eager: opts.eager, cls: 'gb-card__media' })}
${badges.length ? html`<div class="gb-card__flags">${badges}</div>` : ''}
${wishButton(ctx, p, { cls: 'gb-card__wish' })}
<div class="gb-card__body">
${p.brand ? html`<p class="gb-card__brand" dir="ltr">${p.brand}</p>` : ''}
${raw(`<h${level} class="gb-card__title" id="${esc(titleId)}">`)}<a class="gb-card__link" href="${href}">${nameHtml(ctx, p)}</a>${raw(`</h${level}>`)}
${priceBlock(ctx, p, { size: 'sm' })}
${availabilityBadge(ctx, p.availability, { always: opts.showStock, cls: 'gb-card__stock' })}
</div>
<div class="gb-card__actions">${addButton(ctx, p, { cls: 'gb-card__add' })}</div>
</article>`;
}

/** Grid of product cards: <ul class="gb-grid"> … */
export function productGrid(ctx, products, opts = {}) {
  return html`<ul class="${cls('gb-grid', opts.cls)}" role="list">${products.map((p, i) => html`<li class="gb-grid__item">${productCard(ctx, p, { ...opts.card, eager: opts.eagerFirst && i === 0 })}</li>`)}</ul>`;
}

/** Breadcrumbs: items = [{ name, route }…]; the last item is the current page (no link). */
export function breadcrumbs(ctx, items) {
  return html`<nav class="gb-crumbs" aria-label="${ctx.t('a11y.breadcrumb')}"><ol>${items.map((it, i) => {
    const last = i === items.length - 1;
    return html`<li>${last ? html`<span aria-current="page">${it.name}</span>` : html`<a href="${ctx.url(it.route)}">${it.name}</a>${icon('chevron-forward', { cls: 'gb-crumbs__sep' })}`}</li>`;
  })}</ol></nav>`;
}

/**
 * Section heading row with optional "view all" link.
 * opts: { id, title, eyebrow, subtitle, level (2), action: { route, label, ariaLabel } }
 */
export function sectionHeading(ctx, o) {
  const level = o.level || 2;
  return html`<div class="gb-sechead"><div class="gb-sechead__text">${o.eyebrow ? html`<p class="gb-eyebrow">${o.eyebrow}</p>` : ''}${raw(`<h${level} class="gb-sechead__title"${o.id ? ` id="${esc(o.id)}"` : ''}>`)}${o.title}${raw(`</h${level}>`)}${o.subtitle ? html`<p class="gb-sechead__sub">${o.subtitle}</p>` : ''}</div>${o.action ? html`<a class="gb-link" href="${ctx.url(o.action.route)}"${o.action.ariaLabel ? html` aria-label="${o.action.ariaLabel}"` : ''}><span>${o.action.label}</span>${icon('arrow-forward')}</a>` : ''}</div>`;
}

/**
 * Horizontal product rail (scroll-snap). Returns '' when products is empty.
 * opts: { id (required, unique per page), title, subtitle, eyebrow, products, seeAllRoute, seeAllCount, seeAllAria, cls, eagerFirst }
 */
export function rail(ctx, o) {
  if (!o.products || !o.products.length) return html``;
  const hid = `${o.id}-title`;
  const action = o.seeAllRoute !== undefined && o.seeAllRoute !== null ? {
    route: o.seeAllRoute,
    label: o.seeAllCount ? ctx.t('common.viewAllN', { n: o.seeAllCount }) : ctx.t('common.viewAll'),
    ariaLabel: o.seeAllAria,
  } : null;
  return html`<section class="${cls('gb-rail', o.cls)}" id="${o.id}" aria-labelledby="${hid}">
${sectionHeading(ctx, { id: hid, title: o.title, subtitle: o.subtitle, eyebrow: o.eyebrow, action })}
<div class="gb-rail__viewport">
<button type="button" class="gb-rail__nav gb-rail__nav--prev" data-rail="prev" aria-label="${ctx.t('a11y.scrollPrev')}" tabindex="-1">${icon('chevron-back')}</button>
<ul class="gb-rail__track" role="list">${o.products.map((p, i) => html`<li class="gb-rail__item">${productCard(ctx, p, { eager: o.eagerFirst && i === 0, idSuffix: o.id })}</li>`)}</ul>
<button type="button" class="gb-rail__nav gb-rail__nav--next" data-rail="next" aria-label="${ctx.t('a11y.scrollNext')}" tabindex="-1">${icon('chevron-forward')}</button>
</div>
</section>`;
}

/** Category tile (link to c/<id>/) with art, name and product count. */
export function categoryTile(ctx, cat, opts = {}) {
  return html`<a class="${cls('gb-cat', opts.cls)}" href="${ctx.url(categoryRoute(cat.id))}">${art(cat.icon, { cls: 'gb-cat__art' })}<span class="gb-cat__name">${cat.name[ctx.locale]}</span><span class="gb-cat__count">${ctx.t('common.products', { n: cat.count })}</span></a>`;
}

/** Grid of all category tiles. */
export function categoryGrid(ctx, cats = ctx.data.categories, opts = {}) {
  return html`<ul class="${cls('gb-cats', opts.cls)}" role="list">${cats.map((c) => html`<li>${categoryTile(ctx, c)}</li>`)}</ul>`;
}

/** Empty state. o: { icon, title, text, actions (SafeHtml), level (2), cls } */
export function emptyState(ctx, o) {
  const level = o.level || 2;
  return html`<div class="${cls('gb-empty', o.cls)}">${icon(o.icon || 'box', { cls: 'gb-empty__icon' })}${raw(`<h${level} class="gb-empty__title">`)}${o.title}${raw(`</h${level}>`)}${o.text ? html`<p class="gb-empty__text">${o.text}</p>` : ''}${o.actions ? html`<div class="gb-empty__actions">${o.actions}</div>` : ''}</div>`;
}

export { money, moneyHtml, discountPct };
