// src/pages/search.mjs — search/ page shell (?q=) + search/meta.json (catalog module).
//
// The page is a prerendered shell (heading, search form, category suggestions). src/js/42-search.js reads ?q=,
// searches the compact products.json and renders the results (sortable/filterable through GB.catalog).
// search/meta.json (root-only, tiny) carries what products.json lacks for ranking and rendering:
// featured + new ids and both-locale category names/icons. It is optional at runtime (search degrades
// gracefully when it cannot be fetched).

export default function routes(ctx) {
  const { html, layout, breadcrumbs, categoryGrid, icon } = ctx.h;
  const T = ctx.t;
  const route = 'search/';
  const crumbs = [{ name: T('nav.home'), route: '' }, { name: T('nav.search'), route }];

  const main = html`
<div class="gb-wrap gb-search-page">
${breadcrumbs(ctx, crumbs)}
<header class="gb-pagehead">
  <h1 class="gb-pagehead__title" id="search-title">${T('search.title')}</h1>
</header>
<form class="gb-search-pageform" id="search-page-form" role="search" action="${ctx.url(route)}" method="get">
  <label class="gb-sr" for="search-page-q">${T('search.inputLabel')}</label>
  ${icon('search', { cls: 'gb-search-pageform__icon' })}
  <input class="gb-input gb-search-pageform__input" id="search-page-q" name="q" type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" maxlength="80" placeholder="${T('nav.searchPlaceholder')}" aria-describedby="search-page-hint">
  <button class="gb-btn gb-btn--primary gb-search-pageform__submit" type="submit">${T('nav.searchSubmit')}</button>
</form>
<p class="gb-hint gb-search-pagehint" id="search-page-hint">${T('search.hint')}</p>
<div class="gb-search-app" id="search-app">
  <div id="search-results" class="gb-search-results" hidden></div>
  <div id="search-start" class="gb-search-start">
    <div id="search-recent" class="gb-search-recent" hidden></div>
    <noscript><p class="gb-alert">${icon('info')}<span>${T('search.noscript')}</span></p></noscript>
    <section class="gb-section gb-search-cats" aria-labelledby="search-cats-title">
      <div class="gb-sechead"><div class="gb-sechead__text"><h2 class="gb-sechead__title" id="search-cats-title">${T('search.browseCats')}</h2></div>
      <a class="gb-link" href="${ctx.url('c/all/')}"><span>${T('catalog.viewAllProducts')}</span>${icon('arrow-forward')}</a></div>
      ${categoryGrid(ctx)}
    </section>
  </div>
</div>
</div>`;

  const out = [{
    route,
    html: layout(ctx, {
      route,
      bodyClass: 'page-search',
      nav: 'search',
      head: { title: T('search.metaTitle'), description: T('search.metaDesc'), noindex: true },
      main,
    }),
  }];

  if (ctx.locale === ctx.defaultLocale) {
    const meta = {
      v: ctx.publishId,
      cats: ctx.data.categories.map((c) => ({ id: c.id, icon: c.icon, n: { ar: c.name.ar, en: c.name.en } })),
      featured: ctx.data.products.filter((p) => p.featured).map((p) => p.id),
      fresh: ctx.data.products.filter((p) => p.isNew).map((p) => p.id),
    };
    out.push({ route: 'search/meta.json', body: JSON.stringify(meta), global: true });
  }
  return out;
}
