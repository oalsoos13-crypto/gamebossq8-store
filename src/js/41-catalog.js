/* 41-catalog.js — catalog module, part 1: product listings.
     GB.catalog.listing(root, opts)  sort/filter engine over a grid of product cards (data-* attributes):
                                     ?sort=best|price-asc|price-desc|discount &stock=1 &sale=1 &brand=A,B &cat=<id>
                                     URL query state (pushState on change, restored on load and back/forward),
                                     live result count, facet counts on chips, empty-filter state + reset.
     GB.catalog.card(item, opts)     client mirror of the server productCard() for compact products.json items
     GB.catalog.price(item)          client mirror of priceBlock() (size sm)
     GB.catalog.toolbar(items, opts) client mirror of renderToolbar() in src/pages/category.mjs
     GB.catalog.meta()               Promise<search/meta.json | null> (featured/new ids, category names + icons)
     GB.catalog.cats()               [{ id, name, icon, url }] in display order (meta or the #gb-menu dialog)
   Category pages (body.page-category) are wired automatically. Contract: src/CONTRACTS.md §7. */

const CATALOG_SORTS = [['best', 'catalog.sortBest'], ['price-asc', 'catalog.sortPriceAsc'], ['price-desc', 'catalog.sortPriceDesc'], ['discount', 'catalog.sortDiscount']];
const CATALOG_ICON_FALLBACK = GB.cfg.catIcons || {};

GB.catalog = GB.catalog || {};

/* ------------------------------------------------------------------ URL state */
function catalogParse(search) {
  let q;
  try { q = new URLSearchParams(search || ''); } catch (e) { q = new URLSearchParams(''); }
  const sortRaw = q.get('sort');
  const sort = CATALOG_SORTS.some((s) => s[0] === sortRaw) ? sortRaw : 'best';
  const brands = (q.get('brand') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  return {
    sort,
    stock: q.get('stock') === '1',
    sale: q.get('sale') === '1',
    brands,
    cat: String(q.get('cat') || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40),
  };
}
GB.catalog.parse = catalogParse;

/** Write state into the current URL (keeps unrelated params such as q / src). */
function catalogWriteUrl(state, push) {
  let params;
  try { params = new URLSearchParams(location.search); } catch (e) { return; }
  const put = (k, v) => { if (v) params.set(k, v); else params.delete(k); };
  put('sort', state.sort !== 'best' ? state.sort : '');
  put('stock', state.stock ? '1' : '');
  put('sale', state.sale ? '1' : '');
  put('brand', state.brands.length ? state.brands.join(',') : '');
  put('cat', state.cat || '');
  const qs = params.toString();
  const url = location.pathname + (qs ? '?' + qs : '') + location.hash;
  if (url === location.pathname + location.search + location.hash) return;
  try { history[push ? 'pushState' : 'replaceState']({ gbCatalog: 1 }, '', url); } catch (e) { /* sandboxed / file: */ }
  GB.catalog.syncLang();
}
GB.catalog.writeUrl = catalogWriteUrl;

/** Language-switch links carry the current listing/search query to the counterpart page. */
GB.catalog.syncLang = function () {
  let qs = '';
  try {
    const p = new URLSearchParams(location.search);
    p.delete('src'); p.delete('utm_source');
    qs = p.toString();
  } catch (e) { qs = ''; }
  GB.$$('a[data-lang-switch]').forEach((a) => {
    if (!a.hasAttribute('data-href-base')) a.setAttribute('data-href-base', (a.getAttribute('href') || '').split('?')[0]);
    a.setAttribute('href', a.getAttribute('data-href-base') + (qs ? '?' + qs : ''));
  });
};

/* ------------------------------------------------------------------ listing engine */
const AVAIL_GROUP = (it) => (it.avail === 'out_of_stock' ? 1 : 0);
const SORTERS = {
  best: (a, b) => a.i - b.i,
  'price-asc': (a, b) => AVAIL_GROUP(a) - AVAIL_GROUP(b) || a.price - b.price || a.i - b.i,
  'price-desc': (a, b) => AVAIL_GROUP(a) - AVAIL_GROUP(b) || b.price - a.price || a.i - b.i,
  discount: (a, b) => AVAIL_GROUP(a) - AVAIL_GROUP(b) || b.off - a.off || a.i - b.i,
};

/**
 * GB.catalog.listing(root, { countText(shown, total, filtered) → string, onChange(state) }) → controller
 * root must contain: .gb-grid (li.gb-grid__item > article.gb-card[data-*]), optional [data-toolbar] with
 * [data-sort] select, [data-filter=stock|sale|brand|cat][data-value] chips, [data-filter-reset],
 * [data-listing-count], and [data-listing-empty]. Event listeners are delegated on root, so the content may be
 * re-rendered later (call controller.scan()).
 */
GB.catalog.listing = function (root, opts) {
  const o = opts || {};
  const c = {
    root,
    state: catalogParse(location.search),
    items: [],
    brandValues: new Set(),
    catValues: new Set(),
    scan() {
      c.items = GB.$$('.gb-grid > .gb-grid__item', root).map((li, i) => {
        const a = li.querySelector('.gb-card') || li;
        const d = a.dataset || {};
        return { li, i, id: d.id, price: Number(d.price) || 0, off: Number(d.off) || 0, avail: d.avail || 'in_stock', brand: d.brand || '', cat: d.cat || '' };
      });
      c.grid = GB.$('.gb-grid', root);
      c.brandValues = new Set(GB.$$('[data-filter="brand"]', root).map((b) => b.getAttribute('data-value')));
      c.catValues = new Set(GB.$$('[data-filter="cat"]', root).map((b) => b.getAttribute('data-value')).filter(Boolean));
      return c;
    },
    /** Active (sanitised) filters. */
    active() {
      const s = c.state;
      return {
        stock: s.stock && !!GB.$('[data-filter="stock"]', root),
        sale: s.sale && !!GB.$('[data-filter="sale"]', root),
        brands: s.brands.filter((b) => c.brandValues.has(b)),
        cat: c.catValues.has(s.cat) ? s.cat : '',
      };
    },
    apply() {
      const f = c.active();
      const pass = (it, skip) => (skip === 'stock' || !f.stock || it.avail === 'in_stock') &&
        (skip === 'sale' || !f.sale || it.off > 0) &&
        (skip === 'brand' || !f.brands.length || f.brands.indexOf(it.brand) >= 0) &&
        (skip === 'cat' || !f.cat || it.cat === f.cat);
      const filtered = !!(f.stock || f.sale || f.brands.length || f.cat);
      let shown = 0;
      c.items.forEach((it) => { const v = pass(it); it.li.hidden = !v; if (v) shown++; });

      // order (stable; only touch the DOM when it changes)
      if (c.grid) {
        const sorted = c.items.slice().sort(SORTERS[c.state.sort] || SORTERS.best);
        const cur = Array.prototype.slice.call(c.grid.children);
        if (sorted.some((it, k) => cur[k] !== it.li)) {
          const frag = document.createDocumentFragment();
          sorted.forEach((it) => frag.appendChild(it.li));
          c.grid.appendChild(frag);
        }
      }

      // controls
      const sel = GB.$('[data-sort]', root);
      if (sel && sel.value !== c.state.sort) sel.value = c.state.sort;
      GB.$$('[data-filter]', root).forEach((b) => {
        const kind = b.getAttribute('data-filter');
        const val = b.getAttribute('data-value') || '';
        let on = false, n = null;
        if (kind === 'stock') on = f.stock;
        else if (kind === 'sale') on = f.sale;
        else if (kind === 'brand') { on = f.brands.indexOf(val) >= 0; n = c.items.filter((it) => it.brand === val && pass(it, 'brand')).length; }
        else if (kind === 'cat') { on = val ? f.cat === val : !f.cat; n = c.items.filter((it) => (!val || it.cat === val) && pass(it, 'cat')).length; }
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (n !== null) {
          const nEl = b.querySelector('.gb-catalog-chip__n');
          if (nEl && nEl.textContent !== String(n)) nEl.textContent = String(n);
          b.classList.toggle('is-zero', n === 0 && !on);
        }
      });
      GB.$$('.gb-catalog-reset', root).forEach((b) => { b.hidden = !filtered; });
      const empty = GB.$('[data-listing-empty]', root);
      if (empty) empty.hidden = shown > 0;
      const countEl = GB.$('[data-listing-count]', root);
      if (countEl) {
        const total = c.items.length;
        const txt = o.countText ? o.countText(shown, total, filtered)
          : (filtered ? (shown ? GB.t('catalog.filteredCount', { shown, total }) : GB.t('catalog.noneShown')) : GB.t('common.products', { n: total }));
        if (countEl.textContent !== txt) countEl.textContent = txt;
      }
      c.shown = shown;
      if (typeof o.onChange === 'function') o.onChange(c.state, shown);
      return c;
    },
    /** Merge a patch into the state, apply it, and (push=true) record it in history. */
    set(patch, push) {
      c.state = Object.assign({}, c.state, patch || {});
      c.apply();
      if (push !== undefined && push !== null) catalogWriteUrl(c.state, !!push);
      return c;
    },
    /** Re-read state from the URL (load / popstate). */
    fromUrl() { c.state = catalogParse(location.search); return c.apply(); },
  };

  GB.on('click', '[data-filter]', (e, b) => {
    e.preventDefault();
    const kind = b.getAttribute('data-filter');
    const val = b.getAttribute('data-value') || '';
    const f = c.active();
    if (kind === 'stock') c.set({ stock: !f.stock }, true);
    else if (kind === 'sale') c.set({ sale: !f.sale }, true);
    else if (kind === 'brand') {
      const list = f.brands.slice();
      const k = list.indexOf(val);
      if (k >= 0) list.splice(k, 1); else list.push(val);
      c.set({ brands: list }, true);
    } else if (kind === 'cat') c.set({ cat: val && f.cat !== val ? val : '' }, true);
  }, root);
  GB.on('click', '[data-filter-reset]', (e) => {
    e.preventDefault();
    c.set({ stock: false, sale: false, brands: [], cat: '' }, true);
    const first = GB.$('[data-sort]', root) || GB.$('[data-filter]', root);
    // the reset control disappears once filters are cleared: keep keyboard focus inside the toolbar
    if (first && document.activeElement && (document.activeElement === document.body || !root.contains(document.activeElement) || document.activeElement.hidden || document.activeElement.closest('[hidden]'))) {
      try { first.focus({ preventScroll: true }); } catch (err) { first.focus(); }
    }
  }, root);
  GB.on('change', '[data-sort]', (e, sel) => { c.set({ sort: sel.value }, true); }, root);

  c.scan();
  return c;
};

/** Bring a chip into view inside its horizontal scroll row (direction-agnostic, never scrolls the page). */
GB.catalog.revealChip = function (chip) {
  const row = chip && chip.closest('.gb-chips--scroll');
  if (!row) return;
  const r = row.getBoundingClientRect(), b = chip.getBoundingClientRect();
  const pad = 24;
  if (b.left < r.left + pad) row.scrollBy({ left: b.left - r.left - pad });
  else if (b.right > r.right - pad) row.scrollBy({ left: b.right - r.right + pad });
};

/* ------------------------------------------------------------------ meta (search/meta.json) + categories */
let catalogMetaPromise = null;
GB.catalog.meta = function () {
  if (!catalogMetaPromise) {
    catalogMetaPromise = fetch(GB.asset('search/meta.json') + '?v=' + encodeURIComponent(GB.cfg.publishId || ''), { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!m || !Array.isArray(m.cats)) return null;
        m.featuredSet = new Set((m.featured || []).map(String));
        m.freshSet = new Set((m.fresh || []).map(String));
        m.catMap = new Map(m.cats.map((cat) => [cat.id, cat]));
        GB.catalog.metaData = m;
        return m;
      })
      .catch(() => null);
  }
  return catalogMetaPromise;
};
function catIcon(id) {
  const m = GB.catalog.metaData;
  const c = m && m.catMap.get(id);
  return (c && c.icon) || CATALOG_ICON_FALLBACK[id] || 'bundle';
}
/** Categories in display order: [{ id, name, icon, url }]. Uses meta when loaded, else the #gb-menu dialog. */
GB.catalog.cats = function () {
  const m = GB.catalog.metaData;
  if (m) return m.cats.map((c) => ({ id: c.id, name: (c.n && (c.n[GB.locale] || c.n.ar)) || c.id, icon: c.icon, url: GB.url('c/' + c.id + '/') }));
  return GB.$$('#gb-menu .gb-menu__item:not(.gb-menu__item--all)').map((a) => {
    const mm = /\/c\/([a-z0-9-]+)\/$/.exec(a.getAttribute('href') || '');
    if (!mm) return null;
    const nameEl = a.querySelector('.gb-menu__name');
    return { id: mm[1], name: nameEl ? nameEl.textContent : mm[1], icon: catIcon(mm[1]), url: a.getAttribute('href') };
  }).filter(Boolean);
};

/* ------------------------------------------------------------------ client card markup (shared foundation renderer GB.ui.card) */
GB.catalog.nameHtml = function (item, inner) { return GB.ui.nameHtml(item, inner); };
GB.catalog.art = function (cat, cls) { return GB.ui.art(cat, cls); };
/** Inline (<span>) media box for list rows inside links (overlay results); cards use GB.ui.media. */
GB.catalog.media = function (item, cls) {
  const src = item.img ? GB.img(item.img) : '';
  return '<span class="gb-media' + (src ? '' : ' is-empty') + (cls ? ' ' + GB.esc(cls) : '') + '">' + GB.ui.art(item.cat, 'gb-media__ph') +
    (src ? '<img class="gb-media__img" src="' + GB.esc(src) + '" alt="" width="800" height="800" loading="lazy" decoding="async">' : '') + '</span>';
};
GB.catalog.price = function (item, size) { return GB.ui.price(item, size); };
GB.catalog.stock = function (availability, cls) { return GB.ui.stock(availability, cls); };
/** GB.catalog.card(item, { level = 3, idSuffix, nameHtml }) — alias of the foundation GB.ui.card(). */
GB.catalog.card = function (item, opts) { return GB.ui.card(item, opts); };

/** Client mirror of renderToolbar() (src/pages/category.mjs) for compact items (no category chips). */
GB.catalog.toolbar = function (items) {
  const brandCounts = new Map();
  items.forEach((it) => { if (it.b) brandCounts.set(it.b, (brandCounts.get(it.b) || 0) + 1); });
  const brands = Array.from(brandCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const hasNonStock = items.some((it) => it.a !== 'in_stock');
  const hasSale = items.some((it) => it.c);
  const check = GB.icon('check', 'gb-catalog-chip__check');
  const chips = [];
  if (hasNonStock) chips.push('<button type="button" class="gb-chip" data-filter="stock" aria-pressed="false">' + check + '<span>' + GB.esc(GB.t('catalog.inStock')) + '</span></button>');
  if (hasSale) chips.push('<button type="button" class="gb-chip" data-filter="sale" aria-pressed="false">' + check + '<span>' + GB.esc(GB.t('catalog.onSale')) + '</span></button>');
  let brandHtml = '';
  if (brands.length >= 2) {
    brandHtml = (chips.length ? '<span class="gb-catalog-sep" aria-hidden="true"></span>' : '') + '<span class="gb-catalog-brands" role="group" aria-label="' + GB.esc(GB.t('catalog.brand')) + '">' +
      brands.map((b) => '<button type="button" class="gb-chip" data-filter="brand" data-value="' + GB.esc(b[0]) + '" aria-pressed="false"><span dir="ltr">' + GB.esc(b[0]) +
        '</span> <span class="gb-catalog-chip__n">' + b[1] + '</span></button>').join('') + '</span>';
  }
  const any = chips.length || brands.length >= 2;
  return '<div class="gb-catalog-toolbar" data-toolbar><div class="gb-catalog-bar">' +
    '<p class="gb-catalog-count" data-listing-count aria-live="polite" aria-atomic="true"></p>' +
    '<div class="gb-catalog-sort">' + GB.icon('sort') + '<label for="catalog-sort">' + GB.esc(GB.t('catalog.sortLabel')) + '</label><select id="catalog-sort" class="gb-select" data-sort>' +
    CATALOG_SORTS.map((s) => '<option value="' + s[0] + '"' + (s[0] === 'best' ? ' selected' : '') + '>' + GB.esc(GB.t(s[1])) + '</option>').join('') + '</select></div></div>' +
    (any ? '<div class="gb-catalog-filters" role="group" aria-label="' + GB.esc(GB.t('catalog.filters')) + '"><div class="gb-chips gb-chips--scroll gb-catalog-chips">' +
      '<button type="button" class="gb-chip gb-catalog-reset" data-filter-reset hidden>' + GB.icon('x') + '<span>' + GB.esc(GB.t('catalog.reset')) + '</span></button>' +
      chips.join('') + brandHtml + '</div></div>' : '') + '</div>';
};

/* ------------------------------------------------------------------ category pages (c/<id>/ and c/all/) */
GB.ready(() => {
  if (!document.body.classList.contains('page-category')) return;
  const root = GB.$('[data-listing]');
  if (!root) return;
  const ctl = GB.catalog.listing(root);
  GB.catalog.current = ctl;
  ctl.fromUrl();
  catalogWriteUrl(Object.assign({}, ctl.state, ctl.active()), false); // canonicalise the query (drops unknown/invalid values)
  GB.catalog.syncLang();
  const pressedCat = GB.$('[data-filter="cat"][aria-pressed="true"]', root);
  if (pressedCat && pressedCat.getAttribute('data-value')) GB.catalog.revealChip(pressedCat);
  window.addEventListener('popstate', () => {
    ctl.fromUrl();
    GB.catalog.syncLang();
    const pc = GB.$('[data-filter="cat"][aria-pressed="true"]', root);
    if (pc) GB.catalog.revealChip(pc);
  });
  // mark the current category in the categories dialog
  const here = location.pathname.replace(/index\.html$/, '');
  GB.$$('#gb-menu .gb-menu__item').forEach((a) => {
    if ((a.getAttribute('href') || '') === here) a.setAttribute('aria-current', 'page');
  });
});
