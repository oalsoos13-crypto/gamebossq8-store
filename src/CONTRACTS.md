# GameBoss Q8 v2 — Foundation contracts

Binding for every module agent. The SPEC (`SCR/v2/SPEC.md`) wins over this file; this file wins over guesses.
`SCR` = `/tmp/claude-0/-home-user-ddc-approval/e3d6f3de-b38c-5e2a-9697-1356406fa16a/scratchpad`, `REPO` = `/home/user/gamebossq8-store`.

---------------------------------------------------------------------------------------------------------

## 0. File ownership (do NOT edit files you do not own)

| Owner | Files |
|---|---|
| foundation | `tools/build.mjs`, `tools/prepare-data.mjs`, `src/core/*`, `src/css/00-29*`, `src/js/00-29*`, `data/*`, `src/static/assets/fonts/*`, `src/static/favicon.svg`, `src/CONTRACTS.md` |
| product | `src/pages/product.mjs`, `src/js/40-product.js`, `src/css/40-product.css`, `src/i18n/product.json` |
| catalog | `src/pages/category.mjs`, `src/pages/search.mjs`, `src/js/41-catalog.js`, `src/js/42-search.js`, `src/css/41-catalog.css`, `src/i18n/catalog.json` |
| cart | `src/pages/checkout.mjs`, `src/pages/wishlist.mjs`, `src/js/30-cart.js`, `src/js/31-checkout.js`, `src/js/32-wishlist.js`, `src/css/30-cart.css`, `src/i18n/cart.json` |
| home | `src/pages/home.mjs` (replace the placeholder entirely), `src/js/50-home.js`, `src/css/50-home.css`, `src/i18n/home.json` |
| pwa | `src/pages/404.mjs`, `src/pages/offline.mjs`, `src/pages/pwa-files.mjs` (sitemap.xml, robots.txt, manifest.webmanifest, sw.js), `src/js/60-pwa.js`, `src/css/60-pwa.css`, `src/i18n/pwa.json`, `tools/make-icons.mjs`, `src/static/assets/icons/*` |
| content | `src/pages/info.mjs`, `src/css/70-info.css`, `src/i18n/info.json`, `tools/import-csv.mjs`, `tools/mirror-images.mjs`, `docs/*`, `README.md`, removal of `admin/` and root `catalog.json` |
| test | `tools/verify.mjs` (+ `tools/verify/*.mjs`) |

If you need a change in a foundation file: do NOT edit it. Work around it inside your own files if you can and
report the need in `notes_for_integrator` (exact file, exact change, why).

Never `git commit/push/reset/checkout`. Never build into REPO root — always `--out` your own dir (§10).

---------------------------------------------------------------------------------------------------------

## 1. Build pipeline (`tools/build.mjs`, zero npm deps, Node ≥ 20, full build ≈ 0.1–0.5 s)

```
node tools/build.mjs [--out <dir>] [--base /gamebossq8-store/] [--origin https://oalsoos13-crypto.github.io]
                     [--year 2026] [--built-at <iso>] [--set key.path=value]… [--strict] [--quiet]
```
- `--set` overrides any `data/config.json` value; the value is parsed as JSON when possible:
  `--set delivery.confirmed=true --set indexable=false --set analytics.provider='"goatcounter"'`.
- `--strict` makes "internal link points to a file this build did not generate" fatal (default: warning).
  The test agent runs with `--strict` once all modules exist.
- Steps: load `data/*.json` → apply CLI overrides → validate data (fatal on error) → merge i18n
  (`data/i18n.json` + `src/i18n/*.json` in filename order; **a key defined twice = build error**) →
  bundle CSS/JS → write `assets/products.<hash8>.json` → copy `src/static/**` verbatim → import every
  `src/pages/*.mjs` whose name does not start with `_` → call `routes(ctx)` once per locale (`'ar'`, then `'en'`)
  → write outputs → link check → `.nojekyll`, `build.json`, `.build-manifest.json` → delete files listed
  ONLY in the previous manifest (never anything else; never `src/ data/ tools/ docs/ .git/ README.md`).
- `publishId` = first 8 hex of sha1(data/catalog.json + data/config.json [+ the --set list when used]).
- CSS: `src/css/*.css` (not starting with `_`) concatenated in filename order (comments stripped) →
  `assets/app.<hash8>.css`. Fonts are referenced as `url(fonts/…)` (relative to `assets/`).
- JS: `src/js/*.js` (not starting with `_`) syntax-checked, each wrapped in its own `try { … } catch` block, all
  inside ONE IIFE that starts with `const GB = window.GB = window.GB || {};` and ends with `GB.start()` →
  `assets/app.<hash8>.js`, loaded with `defer` on every page.
- Output collisions (two modules emitting the same path with different content) are a build error.

## 2. Page modules (`src/pages/<name>.mjs`)

```js
// optional: root-only files this module emits, so the build/head can reference them
export const provides = ['manifest.webmanifest', 'sw.js'];

export default function routes(ctx) {            // may be async; called once per locale
  return [
    { route: 'p/piva-ds5-adapter-10736/', html: layout(ctx, {...}) },   // → p/…/index.html  (ar)  |  en/p/…/index.html (en)
    { route: 'search/data.txt', body: '…' },                             // non-HTML, still locale-prefixed for en
    ...(ctx.locale === ctx.defaultLocale ? [{ route: 'sw.js', body: swSource, global: true }] : []), // root-only
  ];
}
```
Route/output convention:
- `route` is **locale-neutral, no leading slash**. `''` or a value ending in `/` → `<route>index.html`; anything
  else is used as the file path (`'404.html'`, `'sitemap.xml'`). `path: 'p/x-1/index.html'` (SPEC wording) is
  accepted as an alias of `route`.
- The build writes the Arabic result as-is and prefixes `en/` to the English one — unless `global: true`, which
  writes the path verbatim (use it for root-only files: `404.html`, `sitemap.xml`, `robots.txt`,
  `manifest.webmanifest`, `sw.js`). Emit global files from ONE locale only (`ctx.locale === ctx.defaultLocale`).
- `html` (or `body`) may be a string, a SafeHtml or a Buffer. Return `[]` to emit nothing for a locale.
- Files beginning with `_` in `src/pages/` are ignored (use them for private helpers you import yourself).
- Routes in use: home `''` · product `p/<slug>-<id>/` (`productRoute(p)`) · category `c/<catId>/`
  (`categoryRoute(id)`) · `search/` · `wishlist/` · `checkout/` · `info/<how-to-order|delivery-payment|returns|about|privacy>/`
  · `offline/` · `404.html` (root only, both locales handled client-side).

## 3. `ctx` (one object per locale)

| key | value |
|---|---|
| `locale` / `otherLocale` / `defaultLocale` / `locales` | `'ar'`/`'en'` · the other · `'ar'` · `['ar','en']` |
| `dir` | `'rtl'` / `'ltr'` |
| `config` | merged `data/config.json` incl. CLI overrides (`delivery`, `contact`, `analytics`, `indexable`, `governorates`, `payments`, `clientI18n`, `trustBrands`, `imageHosts`, `base`, `origin`, `year`) |
| `data` | `{ config, products, categories, byId, byCat, catById, brands }` — `products` = all 165 sorted best-match (in_stock → backorder → out_of_stock, then `sort`, then id desc); `byId: Map<id,p>`; `byCat: Map<catId,p[]>` (same order); `categories` in display order with fresh `count`/`inStock`; `catById: Map`; `brands: [{name,count}]` |
| `t(key, params)` | i18n lookup (§8). Unknown key or missing locale value **throws** (build fails). `ctx.has(key)` probes. |
| `url(route, locale = ctx.locale)` | `'/gamebossq8-store/' + ('en/' if en) + route` — every internal href/src |
| `abs(route, locale = ctx.locale)` | `origin + url()` — canonical, og:url, JSON-LD, sitemap |
| `asset(path)` | `BASE + path`, never locale-prefixed (`ctx.asset('favicon.svg')`) |
| `base` / `origin` | `'/gamebossq8-store/'` / `'https://oalsoos13-crypto.github.io'` |
| `money(fils, locale?)` / `moneyHtml(fils, locale?)` / `amount(fils)` | §4.3 |
| `productRoute(p)` / `categoryRoute(id)` / `pname(p)` | route helpers; `pname` = name in ctx.locale |
| `assets` | `{ css, js, productsJson, favicon, icon32, appleTouch, ogImage, logo, manifest, sw, fonts: {arabic400, latin400, arabic700, latin700, arabic800, latin800}, fontPreload: [..], files: {css, js, productsJson} }` — URLs (already BASE-prefixed); icon/manifest/sw entries are `null` until the pwa agent's files exist |
| `publishId`, `year`, `builtAt` | build identity, © year (from `--year`, default 2026) |
| `i18n` | the merged dictionary (read-only) |
| `h` | the whole `src/core/index.mjs` namespace (all exports in §4) |
| `clientConfig(extra)` | the object embedded as `#gb-config` (used by `layout()`; you rarely call it) |

## 4. `src/core` exports (import from `../core/index.mjs`, or use `ctx.h.*`)

### 4.1 HTML safety (`html.mjs`) — XSS-safe by default
- ``html`…${value}…` `` → `SafeHtml`. Interpolations are escaped unless they are `SafeHtml`; arrays are flattened;
  `null/undefined/false/true` render as `''`. **Always build markup with `html```**; never concatenate data strings.
- `raw(str)` marks trusted markup (NEVER on catalog/user data). `esc(v)` / `attr(v)` escape a string.
- `attrs({id:'a', hidden:true, 'data-x':1, title:null})` → `' id="a" hidden data-x="1"'`.
- `cls('a', cond && 'b', {c: true})` → `'a b c'`. `join(list, sep)`.
- `jsonForScript(v)` → JSON safe inside `<script type="application/json|ld+json">`.
- `clip(s, max)` word-boundary ellipsis · `plainText(desc)` strips bullets/newlines · `hasArabic(s)`.

### 4.2 URLs (`url.mjs`)
`productRoute(p)` → `'p/<slug>-<id>/'` · `categoryRoute(id)` → `'c/<id>/'` · `imageUrl(src, ctx.asset)` (absolute
URLs pass through, site-relative mirrored paths get BASE) · `makeUrl`, `normBase`, `outPath` (build internals).

### 4.3 Money (`money.mjs`) — integer fils only, Latin digits, 3 decimals
`amount(16500)` → `'16.500'` · `money(16500,'ar')` → `'16.500 د.ك'` · `money(16500,'en')` → `'16.500 KWD'`
(amount first in BOTH locales — same as the WhatsApp message) ·
`moneyHtml(fils, locale)` → `<span class="money"><bdi class="money__n" dir="ltr">16.500</bdi> <span class="money__c">د.ك</span></span>` ·
`discountPct(price, compareAt)` → whole % or 0 · `CURRENCY`. Client mirrors: `GB.amount/money/moneyHtml/discountPct`.

### 4.4 i18n (`i18n.mjs`)
`makeT(dict, locale)`, `resolveValue`, `interpolate`, `clientSubset(dict, locale, namespaces)` (build internals; use `ctx.t`).

### 4.5 Icons (`icons.mjs`) — one sprite per page (emitted by `layout()`), referenced with `<use>`
- `icon(name, {cls, label, size})` → `<svg class="i i--name" aria-hidden="true" focusable="false"><use href="#i-name"/></svg>`
  (`label` → `role="img" aria-label`). Directional icons (`chevron-forward`, `chevron-back`, `arrow-forward`,
  `arrow-back`) are drawn for LTR and get `i--flip-rtl` (mirrored by CSS in RTL). Unknown name throws.
- UI icons: search heart heart-fill cart cart-plus grid home menu x plus minus check trash chevron-forward
  chevron-back chevron-down arrow-forward arrow-back share copy truck cash card chat globe info alert image
  map-pin clock external filter sort sliders bell tag sparkles box refresh download wifi-off user phone
  whatsapp instagram tiktok.
- `art(key, {cls})` → colourful 64×64 illustration (`<use href="#art-key">`). Category keys (= `category.icon`):
  gamepad trigger tablet glove fan cable case headset stand accessory bag device; extras bundle adapter screen
  keyboard (unknown key → bundle). `catArt(category)`.
- Client: `GB.icon(name, cls)` returns the same `<svg><use>` markup (the sprite is on every page).

### 4.6 `head(ctx, opts)` (`head.mjs`) — normally via `layout(ctx, { head: opts })`
`{ route (filled by layout), title (without suffix; null → meta.homeTitle), titleRaw, description (clipped to 155),
og: { type: 'website'|'product', image, imageAlt, product: p }, ogTitle, jsonld: [obj…], preloadImage (LCP url),
noindex, alternates (default true; false → no hreflang), extra (SafeHtml) }`.
Emits charset, viewport (viewport-fit=cover), `<title>` (`<Page> | GameBoss Q8`, ≤ 60 ch), description, robots
(`noindex,follow` when `noindex` or `config.indexable === false`), canonical, hreflang ar/en/x-default, theme-color,
`gb:publish`, `gb:products`, manifest/icons when present, OG (+ `product:price:amount|currency|availability`),
twitter card, preconnect to image hosts, font preloads, CSS, deferred JS, JSON-LD scripts. `pageTitle(ctx, title)`.

### 4.7 JSON-LD (`jsonld.mjs`) — return plain objects; pass `graph(...)` in `head.jsonld`
`graph(...nodes)` · `ldOrganization(ctx)` (OnlineStore, `@id` abs('')#org) · `ldWebsite(ctx)` (WebSite + SearchAction
`search/?q={search_term_string}`) · `ldBreadcrumbs(ctx, [{name, route}…])` · `ldProduct(ctx, p)` (Product + Offer:
price `"16.500"`, KWD, InStock/OutOfStock/BackOrder, NewCondition) · `ldCollection(ctx, {route, name, description,
products})` (CollectionPage + ItemList) · `AVAILABILITY_URL`. No shippingDetails / return policy / ratings.

### 4.8 Components (`components.mjs`) — all return SafeHtml
| function | output / notes |
|---|---|
| `productCard(ctx, p, {eager, level=3, cls, showStock, idSuffix})` | `<article class="gb-card [is-oos] [is-sale]" data-id data-cat data-brand data-price data-compare data-off data-avail data-sort data-new data-featured>` with media, flags (sale %, new), wish toggle, brand, `<hN class="gb-card__title" id="pn-<id>[-suffix]">` 2-line clamp link (stretched over the card), price block, availability badge (non in_stock, or always with `showStock`), add button / notify link. Pass a unique `idSuffix` when the same product can appear twice on a page. |
| `productGrid(ctx, products, {cls, card: {...}, eagerFirst})` | `<ul class="gb-grid" role="list"><li class="gb-grid__item">card</li>…</ul>` (2/3/4 columns) |
| `productMedia(ctx, p, {eager, index, alt, cls})` | `<div class="gb-media [is-empty]">` category art placeholder + `<img class="gb-media__img" width=800 height=800 loading=lazy decoding=async>` (`eager` → `loading=eager fetchpriority=high`). Failed load → JS adds `img-failed` (img) + `is-failed` (box); CSS shows the placeholder. |
| `priceBlock(ctx, p, {size: 'sm'|'md'|'lg', saving})` | `.gb-price[.is-sale] > .gb-price__now, s.gb-price__was, .gb-price__off, .gb-price__save` |
| `availabilityBadge(ctx, availability, {always, cls})` | `.gb-stock.gb-stock--<availability>` (empty for in_stock unless `always`) |
| `addButton(ctx, p, {cls, qty})` | in_stock/backorder: `<button class="gb-btn gb-btn--add" data-action="add-to-cart" data-id data-price [data-qty]>`; out_of_stock: `<a class="gb-btn gb-btn--notify" href="wa.me…">` "بلّغني" |
| `wishButton(ctx, p, {cls})` | `<button class="gb-wish" data-action="wish-toggle" data-id aria-pressed data-label-add data-label-remove>` |
| `breadcrumbs(ctx, [{name, route}…])` | `<nav class="gb-crumbs" aria-label><ol>`; last item = current page (`aria-current="page"`, no link) |
| `rail(ctx, {id, title, subtitle, eyebrow, products, seeAllRoute, seeAllCount, seeAllAria, cls, eagerFirst})` | `<section class="gb-rail" id aria-labelledby="<id>-title">` heading + scroll-snap `ul.gb-rail__track` + desktop arrows `[data-rail=prev|next]`. Returns '' for an empty list. |
| `sectionHeading(ctx, {id, title, eyebrow, subtitle, level=2, action: {route, label, ariaLabel}})` | `.gb-sechead` with optional "view all" `.gb-link` |
| `categoryTile(ctx, cat)` / `categoryGrid(ctx, cats?)` | `a.gb-cat` (art, name, count) / `ul.gb-cats` (3/4/6 columns) |
| `emptyState(ctx, {icon, title, text, actions, level=2, cls})` | `.gb-empty` |
| `nameHtml(ctx, p)` | `<bdi>` name; Latin-only names get `lang="en" dir="ltr"` |
| `waLink(ctx, text)` / `notifyLink(ctx, p)` | `https://wa.me/96597937556?text=…` |
| `pname(ctx, p)` | display name |

### 4.9 `layout(ctx, opts)` (`layout.mjs`) — the whole document
```js
layout(ctx, {
  route: 'c/fan/',          // REQUIRED, locale-neutral (head canonical/hreflang, lang switch, active tab)
  head: { title, description, og, jsonld, preloadImage, noindex },   // → head()
  main: html`…`,            // content of <main id="main" tabindex="-1">
  bodyClass: 'page-category',   // ALWAYS set page-<name>; page JS keys off it
  altRoute: 'c/fan/',       // counterpart route in the other locale (default = route; null → other home, no hreflang)
  nav: 'categories',        // active tab: home|categories|search|wishlist|null (default derived from route)
  tabbar: true, fab: true,  // false hides the mobile tab bar / floating WhatsApp button (body gets no-tabbar / no-fab)
  pageData: {...},          // JSON → <script type="application/json" id="gb-page"> (read with GB.page())
})
```
Body order: skip link → sprite → `header.gb-header` → `#gb-banner` (hidden slot) → `main#main` → `footer.gb-footer`
→ `nav.gb-tabbar` (mobile < 900px) → `a.gb-fab` (WhatsApp) → dialog shells (§6) → `#gb-toast` (role=status) →
`#gb-live` (sr-only polite region) → `#gb-config` JSON → `#gb-i18n` JSON → `#gb-page` JSON.
Also exported: `header`, `footer`, `tabbar`, `dialogs` (do not call them yourself).

### 4.10 Data (`data.mjs`)
`compareDefault`, `sortDefault(list)`, `AVAIL_RANK`, `isAvailable(p)` (not out_of_stock), `hasImage(p)`, `isOnSale(p)`,
`indexData`, `validateData`.

## 5. Data schemas

`data/catalog.json` (165, hand-editable source of truth; see SPEC §2):
`{ id: "10736", slug, name: {ar, en}, brand|null, priceFils, compareAtFils|null (> priceFils), category, categories[],
images: [absolute https urls] (may be empty), description: {ar: string|null, en: string|null}, availability:
"in_stock"|"out_of_stock"|"backorder", featured, isNew (12 newest ids), sort (int, lower first) }`.
Descriptions are plain text with `• ` bullets and `\n` → render inside an element with class `gb-prose`
(`white-space: pre-line`). `description.en === null` → EN page shows the Arabic text in a `lang="ar" dir="rtl"` block.

`data/categories.json` (display order): `{ id, order, name: {ar,en}, description: {ar,en}, icon, count, inStock }`.

`assets/products.<hash>.json` (client): array of
`{ id, s: 'p/<slug>-<id>/', n: {ar,en}, p: priceFils, c: compareAtFils|null, cat, img: url|null, a: availability, b: brand|null, f?: 1 (featured), nw?: 1 (isNew) }`
(`f`/`nw` are present only when true).

## 6. CSS contract (tokens in `00-tokens.css`; never hard-code colours that exist as tokens)

Tokens: `--bg --surface --surface-2 --tint --tint-2 --ink --ink-soft --ink-mute --line --line-soft --line-strong
--accent --accent-ink --accent-soft --good(-soft) --warn(-soft) --sale(-soft) --wa --wa-ink --focus --font
--fs-xs/sm/md/lg/h3/h2/h1 --r(22) --r-sm(16) --r-xs(12) --r-pill --sh-sm --sh --sh-lg --maxw --gutter --header-h
--tabbar-h (0 on desktop) --safe-b --tap(44px) --ease --ease-out --dur --z-header --z-fab --z-tabbar --z-toast`.
`--gb-bottom-stack`: set it on `body` (e.g. `body.page-product { --gb-bottom-stack: 72px }` on mobile) when you add a
sticky bottom bar; the FAB and toast move up by that amount. Breakpoints: 600px, 900px (mobile chrome < 900), 1000px.

Layout/utility classes: `.gb-wrap` (max-width + gutters), `.gb-section`, `.gb-pagehead(__title|__sub)`,
`.gb-only-desk`, `.gb-only-mob`, `.gb-sr`, `.gb-muted`, `.gb-ltr`, `.gb-clamp-2`, `.gb-prose`, `.gb-panel`, `.gb-eyebrow`.
Rules: grids use `repeat(N, minmax(0,1fr))`; children `min-width:0`; long text `overflow-wrap:anywhere`; logical
properties only (`inset-inline-*`, `margin-inline-*`, `text-align: start`); no `body{overflow-x:hidden}`; `[hidden]` is
`display:none !important`; inputs are ≥ 16px; targets ≥ 44px.

Shared components (`25-components.css`): `.gb-btn` + `--primary --accent --light --ghost --wa --danger --add --notify
--block --lg --icon` (`.is-added` feedback state), `.gb-link`, `.gb-chips(--scroll)` / `.gb-chip` (`aria-pressed=true` or
`.is-active` = selected), `.gb-flag(--sale|--new)`, `.gb-stock(--in_stock|--out_of_stock|--backorder)`, `.gb-media`,
`.gb-card…`, `.gb-wish`, `.gb-price…`, `.gb-sechead…`, `.gb-rail…`, `.gb-cats/.gb-cat…`, `.gb-menu…`, `.gb-searchform…`,
forms: `.gb-field .gb-label .gb-req .gb-hint .gb-input .gb-select .gb-textarea .gb-error .gb-check .gb-radio
.gb-fieldset .gb-option .gb-alert(--error|--ok)`, `.gb-stepper` (buttons + `<output>`/`<input>`), `.gb-crumbs`,
`.gb-empty…`, `.money .money__n .money__c`.
Dialogs (`20-layout.css`): `dialog.gb-dialog` + variant `--drawer` (inline-end edge; add `--start` for inline-start),
`--top` (search sheet), `--sheet` (bottom sheet), `--center`; parts `.gb-dialog__head .gb-dialog__title
.gb-dialog__close .gb-dialog__body .gb-dialog__foot`. Banner: `.gb-banner > .gb-wrap.gb-banner__in > .gb-banner__text`.
Toast: `.gb-toast(.is-show) > .gb-toast__msg + .gb-toast__action`.
Module CSS must be scoped under its page body class (`.page-product …`) or its own `gb-<module>-…` prefix.

### Dialog shells (present on every page, filled by modules)
| dialog | heading (focus target) | containers you fill | owner of content |
|---|---|---|---|
| `#gb-cart` (drawer) | `#gb-cart-title` "سلة المشتريات" | `#gb-cart-body` (lines / empty state), `#gb-cart-foot` (totals + checkout CTA; has `hidden` — unhide it) | cart agent (render on `dialog:open` id `gb-cart` and on `cart:change`) |
| `#gb-search` (top sheet) | `#gb-search-title` | `form#gb-search-form` (GET `search/`, `input#gb-search-input[name=q]` has `data-autofocus` so it receives focus), `#gb-search-body` (instant results) | catalog agent |
| `#gb-menu` (start drawer) | `#gb-menu-title` | `#gb-menu-body` is pre-rendered (12 category links + info links); may be enhanced (e.g. `aria-current`) | foundation |
Openers: any element with `data-dialog-open="<id>"` (links keep their `href` as no-JS fallback). Closers:
`[data-dialog-close]` inside the dialog. Header/tab-bar buttons carry `aria-haspopup="dialog" aria-controls`.

## 7. Client JS (`GB` namespace)

Conventions: each `src/js/NN-name.js` is a plain script body inside its own block in one IIFE — use `const`/`let`/
`function` (block-scoped, private), **never top-level `var` or `return`**, no imports/exports. Do DOM-dependent init
inside `GB.ready(fn)` (runs after ALL modules loaded, in registration order). Guard page-specific code:
`GB.ready(() => { if (!document.body.classList.contains('page-product')) return; … })`.
Build client markup with `GB.esc()` on every data value. After injecting cards/markup call `GB.ui.hydrate(root)`.

### 7.1 Core (`00-core.js`)
| API | notes |
|---|---|
| `GB.cfg` | `#gb-config`: `{ v, publishId, base, origin, locale, dir, defaultLocale, productsUrl, sw, whatsapp, phone, delivery: {feeFils, freeOverFils, confirmed}, analytics: {provider, code}, storagePrefix, currency, indexable, contact, payments, governorates, catIcons: {catId: artKey}, route, altUrl }` |
| `GB.i18n`, `GB.t(key, params)`, `GB.t.has(key)` | client subset (§8); plurals via `params.n`; unknown key → returns the key + console.warn |
| `GB.locale`, `GB.dir`, `GB.page()` | page locale/dir; `#gb-page` JSON or null |
| `GB.$(sel, root)`, `GB.$$(sel, root)` → Array | |
| `GB.on(type, selector, handler(e, el), root?)` → unsubscribe | delegated (document by default) |
| `GB.emit(name, detail)`, `GB.listen(name, fn)` → unsubscribe | bus; also dispatches DOM `gb:<name>` on document |
| `GB.ready(fn)`, `GB.start()` | boot (start is called by the bundle) |
| `GB.storage.get(key, fallback)`, `.set(key, v)` → persisted?, `.remove(key)`, `.ok`, `.prefix`, `.getRaw/.removeRaw(fullKey)` | keys are auto-prefixed `gbq8:v2:`; never throws; falls back to memory |
| `GB.amount(f)`, `GB.money(f, loc?)`, `GB.moneyHtml(f, loc?)`, `GB.discountPct(p, c)` | = server §4.3 |
| `GB.url(route, loc?)`, `GB.abs(route, loc?)`, `GB.asset(path)`, `GB.img(src)`, `GB.wa(text)` | = server url/abs; `GB.wa` → `https://wa.me/<n>?text=…` |
| `GB.products()` → `Promise<Map<id, item>>` | fetched once per page (on demand only); rejects on failure (catch it, show `common.error` + retry); `GB.productsMap` after load |
| `GB.pname(item)`, `GB.purl(item, loc?)` | compact-item name / page URL |
| `GB.src()` | first-touch `?src=`/`utm_source` (30 days) or null — include in WhatsApp messages |
| `GB.track(event, props)` | no-op unless `config.analytics.provider === 'goatcounter'` and `code`. Events: `view_item`, `add_to_cart` (fired by 20-ui), `begin_checkout`, `wa_handoff` (`value` fils), `wa_inquiry`, `search`, `search_no_results`, `pwa_install` |
| `GB.icon(name, cls)`, `GB.esc(v)`, `GB.checkImages(root)` | |

### 7.2 State (`10-store.js`) — storage keys `gbq8:v2:<key>`
| API | notes |
|---|---|
| `GB.cart.get()` `{id: qty}` · `.qty(id)` · `.has(id)` · `.size()` lines · `.count()` total qty | key `cart` (SPEC format) + key `cartp` `{id: addedPriceFils}` |
| `GB.cart.add(id, qty=1, priceFils?)` → new qty (1..99) · `.set(id, qty)` (0 removes) · `.remove(id)` · `.clear()` | each emits `cart:change` |
| `GB.cart.lines(productsMap)` → `[{id, qty, p, name, url, unitFils, lineFils, availability, available, backorder, addedPriceFils, priceChanged}]` | drops unknown ids (emits `cart:change` reason `sanitize`); prices always from products.json |
| `GB.cart.ackPrices(productsMap)` | after showing `common.priceUpdated`, store current prices |
| `GB.cart.totals(lines)` → `{subtotalFils, itemCount, unavailableCount, confirmed, deliveryFils, totalFils, freeOverFils, remainingForFreeFils}` | out_of_stock excluded; `deliveryFils/totalFils/remainingForFreeFils` are `null` while `delivery.confirmed` is false (show "يتأكد على واتساب" / "+ التوصيل", no free-delivery claims) |
| `GB.wish.list()` · `.count()` · `.has(id)` · `.add(id)` · `.remove(id)` · `.toggle(id)` → bool · `.clear()` · `.sanitize(map)` | key `wish`; emits `wish:change` |
| `GB.recent.list()` · `.push(id)` (max 12) · `.clear()` | key `recent`; emits `recent:change` |
| `GB.orders.list()` · `.get(ref)` · `.add(order)` · `.update(ref, patch)` · `.markSent(ref)` · `.dismiss(ref)` · `.pending()` | key `orders` (last 10, newest first; `status 'pending'|'sent'`); emits `orders:change` |
| `GB.customer.get()` · `.set(details)` · `.clear()` | key `customer` — only when the customer ticked "احفظ بياناتي" |
| legacy | `gbq8b-cart`/`gbq8b-wish` (v1 CSV row ids) are migrated once on load and removed (`GB.migrated` = lines moved) |

### 7.3 UI (`20-ui.js`)
| API | notes |
|---|---|
| `GB.dialog.open(id, triggerEl?)` · `.close(id?)` · `.isOpen(id)` · `.current()` · `.supported` | `showModal()`; focus → `[data-autofocus]` else `.gb-dialog__title`; Esc, backdrop click and close buttons close; focus returns to the trigger; opening one gb dialog closes another; scroll locked while open |
| `GB.toast(msg, {action: {label, href | onClick}, timeout})` | moves inside an open modal so it stays visible |
| `GB.announce(msg)` | polite SR message via `#gb-live` |
| `GB.banner.show(html)` / `.hide()` | `#gb-banner` slot (pending-order banner is rendered by the cart agent: `.gb-banner__text` + `.gb-btn` links; escape data!) |
| `GB.ui.hydrate(root)` | sync wish buttons, wire rail arrows, mark failed images |
| `GB.ui.card(item, {level, idSuffix, nameHtml, cls})` | the ONE client product card (mirror of `productCard()`; same classes + `data-*`) for compact products.json items. Helpers: `GB.ui.nameHtml(item, inner)`, `GB.ui.art(cat, cls)`, `GB.ui.media(item, cls)`, `GB.ui.price(item, size)`, `GB.ui.stock(avail, cls)`. Used by the product recently-viewed rail, home recently-viewed rail, search results (`GB.catalog.card` is an alias) and cart/wishlist helpers (`GB.cartUI.*` delegate). |
| `GB.copy(text)` → `Promise<boolean>` | clipboard API, then the hidden-textarea `execCommand('copy')` fallback |
Automatic: count badges `[data-count="cart|wish"]` (text + `hidden` when 0) and their labels `[data-count-label="cart|wish"]`
(`a11y.cartCount` / `a11y.wishCount`) stay in sync; wish buttons get `aria-pressed` + label.

### 7.4 `data-action` conventions (delegated, work on server- and client-rendered markup)
- `data-action="add-to-cart" data-id data-price [data-qty="2"] [data-qty-from="#css-selector"] [data-no-toast]` →
  `GB.cart.add`, `.is-added` for 1.6 s, toast "أُضيف إلى السلة ✓" + "عرض السلة", `GB.track('add_to_cart')`,
  event `cart:added {id, qty, el}`. Disabled / `aria-disabled="true"` buttons are ignored.
- `data-action="wish-toggle" data-id [data-label-add] [data-label-remove]` → `GB.wish.toggle` + toast.
- `data-dialog-open="<id>"`, `data-dialog-close`, `data-rail="prev|next"`.
- New actions belong to the module that owns them: name them `data-action="<module>-<verb>"` and handle them with
  `GB.on('click', '[data-action="cart-remove"]', …)`.

### 7.5 Events
`ready` · `cart:change {cart, count, reason: add|set|remove|clear|sanitize|sync, id}` · `cart:added {id, qty, el}` ·
`wish:change {list, count, id, on, reason}` · `recent:change {list}` · `orders:change {list, ref, reason}` ·
`dialog:open {id, dialog, trigger}` · `dialog:close {id, dialog}` · `img:failed {img}`. Modules may add their own
events prefixed with their module name (`search:results`, `checkout:submitted`).

## 8. i18n

- Dictionary: flat keys `"<namespace>.<name>": { "ar": "…", "en": "…" }`; plural values are objects
  `{ "zero","one","two","few","many","other" }` (Intl.PluralRules; `"=0"` exact forms allowed) selected by `params.n`.
  `{param}` placeholders. Keys starting with `$` (e.g. `"$comment"`) are ignored.
- Foundation (`data/i18n.json`) owns: `meta.* nav.* common.* footer.* a11y.* price.* stock.*`.
- Each module owns `src/i18n/<module>.json` with its OWN prefix only: `product.*`, `catalog.*` (and `search.*`),
  `cart.*` (and `checkout.*`, `wishlist.*`, `order.*`), `home.*`, `pwa.*` (and `offline.*`, `notfound.*`), `info.*`.
  A key defined in two files fails the build. Reuse foundation keys instead of copying them.
- Client embedding rule: every page embeds (`#gb-i18n`) all keys whose namespace is in `config.clientI18n`
  (`common, a11y, price, stock, nav`) **plus every key that has `"client": true`**:
  `"cart.empty": { "ar": "سلتك فارغة", "en": "Your cart is empty", "client": true }`. Mark only what JS needs.
- Copy: natural Gulf-friendly Modern Standard Arabic; concise natural English; Latin digits; honesty rules (SPEC §6).

## 9. Accessibility & quality rules every module must keep
One `<h1>` per page (the placeholder home uses `#home-title`). Section headings via `aria-labelledby`. Product names in
`<bdi>` (`nameHtml`). Prices via `moneyHtml`. Images: `alt=""` in cards, product name on the product page, width/height
800, lazy except the single LCP image (`eager` + `head.preloadImage`). External links `target="_blank" rel="noopener"`
plus `a11y.newTab` text. Errors `role="alert"`. Zero console errors, zero horizontal overflow (320–1280), axe 0
serious/critical in both locales and with dialogs open.

## 10. Build, serve and test in a private dir

```bash
cd /home/user/gamebossq8-store
SCR=/tmp/claude-0/-home-user-ddc-approval/e3d6f3de-b38c-5e2a-9697-1356406fa16a/scratchpad
NAME=product                                    # your module name
OUT=$SCR/v2/site-$NAME/gamebossq8-store         # the parent dir is the web root → pages live under /gamebossq8-store/
node tools/build.mjs --out $OUT                 # add --set delivery.confirmed=true etc. as needed
python3 -m http.server 87NN --bind 127.0.0.1 -d $SCR/v2/site-$NAME &   # pick a free port per agent
# open http://127.0.0.1:87NN/gamebossq8-store/  and  …/gamebossq8-store/en/
```
Playwright: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, resolve packages with
`createRequire('$SCR/audit/package.json')('playwright')` (and `'axe-core'`). NEVER run `playwright install`.
Abort every request whose origin is not `http://127.0.0.1:<port>` (gamebossq8.com and *.github.io are unreachable);
the resulting "Failed to load resource: net::ERR_FAILED" console lines for blocked product images are expected —
filter exactly those, and treat any other console error as a failure. Product images therefore always fail in tests
and show the category-art placeholder (`.img-failed`). A working example harness (dialogs, badges, persistence,
legacy migration, storage-disabled, axe, overflow): `$SCR/v2/foundation-test.mjs`.
