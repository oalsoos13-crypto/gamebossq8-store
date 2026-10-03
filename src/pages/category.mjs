// src/pages/category.mjs — category listings c/<catId>/ (12) + the all-products listing c/all/ (catalog module).
//
// Every product of the listing is prerendered (best-match order: in_stock → backorder → out_of_stock).
// The toolbar (sort select + filter chips) is progressive enhancement driven by src/js/41-catalog.js, which
// reorders / hides the prerendered <li> items through the cards' data-* attributes and mirrors the state in
// the URL query (?sort=&stock=1&sale=1&brand=A,B[&cat=<id> on c/all/]).
// The toolbar markup here is mirrored by GB.catalog.toolbar() in 41-catalog.js (search page) — keep in sync.

// ---------------------------------------------------------------------------------------------- shared bits
export const ALL_ROUTE = 'c/all/';
export const SORTS = [
  ['best', 'catalog.sortBest'],
  ['price-asc', 'catalog.sortPriceAsc'],
  ['price-desc', 'catalog.sortPriceDesc'],
  ['discount', 'catalog.sortDiscount'],
];

/** Brands present in a product list, most frequent first: [{ name, count }]. */
export function brandFacets(products) {
  const m = new Map();
  for (const p of products) if (p.brand) m.set(p.brand, (m.get(p.brand) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
}

/**
 * Toolbar: [category chips (c/all/ only)] · result count (aria-live) + sort select · filter chips
 * (in-stock only, on sale, brands when ≥ 2, clear). Chips that cannot change the result are not rendered.
 */
export function renderToolbar(ctx, products, opts = {}) {
  const { html, icon } = ctx.h;
  const T = ctx.t;
  const brands = brandFacets(products);
  const hasNonStock = products.some((p) => p.availability !== 'in_stock');
  const hasSale = products.some((p) => p.compareAtFils);
  const chipN = (n) => html`<span class="gb-catalog-chip__n">${n}</span>`;
  const cats = opts.cats ? html`<div class="gb-catalog-cats" role="group" aria-label="${T('catalog.category')}"><div class="gb-chips gb-chips--scroll gb-catalog-chips">
<button type="button" class="gb-chip" data-filter="cat" data-value="" aria-pressed="true">${T('catalog.allCats')} ${chipN(products.length)}</button>
${ctx.data.categories.map((c) => html`<button type="button" class="gb-chip" data-filter="cat" data-value="${c.id}" aria-pressed="false">${c.name[ctx.locale]} ${chipN(c.count)}</button>`)}
</div></div>` : '';
  const filterChips = [];
  if (hasNonStock) filterChips.push(html`<button type="button" class="gb-chip" data-filter="stock" aria-pressed="false">${icon('check', { cls: 'gb-catalog-chip__check' })}<span>${T('catalog.inStock')}</span></button>`);
  if (hasSale) filterChips.push(html`<button type="button" class="gb-chip" data-filter="sale" aria-pressed="false">${icon('check', { cls: 'gb-catalog-chip__check' })}<span>${T('catalog.onSale')}</span></button>`);
  const brandChips = brands.length >= 2 ? html`${filterChips.length ? html`<span class="gb-catalog-sep" aria-hidden="true"></span>` : ''}<span class="gb-catalog-brands" role="group" aria-label="${T('catalog.brand')}">${brands.map((b) => html`<button type="button" class="gb-chip" data-filter="brand" data-value="${b.name}" aria-pressed="false"><span dir="ltr">${b.name}</span> ${chipN(b.count)}</button>`)}</span>` : '';
  const anyFilter = filterChips.length || brands.length >= 2;
  return html`<div class="gb-catalog-toolbar" data-toolbar>
${cats}
<div class="gb-catalog-bar">
<p class="gb-catalog-count" data-listing-count aria-live="polite" aria-atomic="true">${T('common.products', { n: products.length })}</p>
<div class="gb-catalog-sort">${icon('sort')}<label for="catalog-sort">${T('catalog.sortLabel')}</label><select id="catalog-sort" class="gb-select" data-sort>${SORTS.map(([v, k]) => html`<option value="${v}"${v === 'best' ? html` selected` : ''}>${T(k)}</option>`)}</select></div>
</div>
${anyFilter ? html`<div class="gb-catalog-filters" role="group" aria-label="${T('catalog.filters')}"><div class="gb-chips gb-chips--scroll gb-catalog-chips">
<button type="button" class="gb-chip gb-catalog-reset" data-filter-reset hidden>${icon('x')}<span>${T('catalog.reset')}</span></button>
${filterChips}${brandChips}
</div></div>` : ''}
</div>`;
}

export default function routes(ctx) {
  const out = ctx.data.categories.map((cat) => categoryPage(ctx, cat));
  out.push(allPage(ctx));
  return out;
}

function firstImage(products) {
  const p = products.find((x) => x.images.length && x.availability !== 'out_of_stock') || products.find((x) => x.images.length);
  return p ? p.images[0] : null;
}

function categoryPage(ctx, cat) {
  const { html, layout, breadcrumbs, graph, ldCollection, ldBreadcrumbs, categoryGrid } = ctx.h;
  const T = ctx.t;
  const route = ctx.categoryRoute(cat.id);
  const name = cat.name[ctx.locale];
  const desc = cat.description[ctx.locale];
  const products = ctx.data.byCat.get(cat.id);
  const countText = T('common.products', { n: products.length });
  const crumbs = [{ name: T('nav.home'), route: '' }, { name, route }];
  const lcp = products[0] && products[0].images.length ? products[0].images[0] : null;
  const others = ctx.data.categories.filter((c) => c.id !== cat.id);

  const main = html`
<div class="gb-wrap gb-catalog-page">
${breadcrumbs(ctx, crumbs)}
<header class="gb-pagehead gb-catalog-head">
  <h1 class="gb-pagehead__title" id="catalog-title">${name}</h1>
  <p class="gb-pagehead__sub">${desc}</p>
</header>
${listing(ctx, products, { kind: 'category', titleId: 'catalog-title' })}
<section class="gb-section gb-catalog-more" aria-labelledby="catalog-more-title">
  <div class="gb-sechead"><div class="gb-sechead__text"><h2 class="gb-sechead__title" id="catalog-more-title">${T('catalog.otherCats')}</h2></div>
  <a class="gb-link" href="${ctx.url(ALL_ROUTE)}"><span>${T('catalog.viewAllProducts')}</span>${ctx.h.icon('arrow-forward')}</a></div>
  ${categoryGrid(ctx, others)}
</section>
</div>`;

  return {
    route,
    html: layout(ctx, {
      route,
      bodyClass: 'page-category',
      nav: 'categories',
      head: {
        title: T('catalog.metaTitle', { name }),
        description: T('catalog.metaDesc', { desc, count: countText }),
        og: { type: 'website', image: firstImage(products), imageAlt: name },
        preloadImage: lcp,
        jsonld: [graph(
          ldCollection(ctx, { route, name, description: desc, products }),
          ldBreadcrumbs(ctx, crumbs),
        )],
      },
      main,
      pageData: { catalog: { kind: 'category', cat: cat.id, total: products.length } },
    }),
  };
}

function allPage(ctx) {
  const { html, layout, breadcrumbs, graph, ldCollection, ldBreadcrumbs } = ctx.h;
  const T = ctx.t;
  const route = ALL_ROUTE;
  const name = T('catalog.allTitle');
  const desc = T('catalog.allDesc');
  const products = ctx.data.products;
  const countText = T('common.products', { n: products.length });
  const crumbs = [{ name: T('nav.home'), route: '' }, { name, route }];
  const lcp = products[0] && products[0].images.length ? products[0].images[0] : null;

  const main = html`
<div class="gb-wrap gb-catalog-page">
${breadcrumbs(ctx, crumbs)}
<header class="gb-pagehead gb-catalog-head">
  <h1 class="gb-pagehead__title" id="catalog-title">${name}</h1>
  <p class="gb-pagehead__sub">${desc}</p>
</header>
${listing(ctx, products, { kind: 'all', titleId: 'catalog-title' })}
</div>`;

  return {
    route,
    html: layout(ctx, {
      route,
      bodyClass: 'page-category page-category-all',
      nav: 'categories',
      head: {
        title: T('catalog.allMetaTitle'),
        description: T('catalog.metaDesc', { desc, count: countText }),
        og: { type: 'website', image: firstImage(products), imageAlt: name },
        preloadImage: lcp,
        jsonld: [graph(
          ldCollection(ctx, { route, name, description: desc, products }),
          ldBreadcrumbs(ctx, crumbs),
        )],
      },
      main,
      pageData: { catalog: { kind: 'all', total: products.length } },
    }),
  };
}

/** Toolbar + full prerendered grid + (hidden) empty-filter state. */
function listing(ctx, products, o) {
  const { html, productGrid, emptyState, icon } = ctx.h;
  const T = ctx.t;
  return html`<section class="gb-catalog" data-listing="${o.kind}" aria-labelledby="catalog-results-title">
<h2 class="gb-sr" id="catalog-results-title">${T('catalog.resultsHeading')}</h2>
${renderToolbar(ctx, products, { cats: o.kind === 'all' })}
${productGrid(ctx, products, { cls: 'gb-catalog__grid', eagerFirst: true })}
<div class="gb-catalog__empty" data-listing-empty hidden>
${emptyState(ctx, {
    icon: 'filter',
    level: 3,
    title: T('catalog.emptyTitle'),
    text: T('catalog.emptyText'),
    actions: html`<button type="button" class="gb-btn gb-btn--primary" data-filter-reset>${icon('refresh')}<span>${T('catalog.reset')}</span></button>`,
  })}
</div>
</section>`;
}
