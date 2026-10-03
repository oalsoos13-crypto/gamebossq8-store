// src/pages/home.mjs — Home page (SPEC §8 Home). Owner: home module.
//
// Sections (DOM order = visual order):
//   1. Hero        — copy (eyebrow, H1, sub, CTAs) + one featured in_stock product WITH an image
//                    (deterministic pick; LCP image: eager + fetchpriority=high + <link rel=preload>)
//   2. Trust strip — exactly the four factual claims allowed by SPEC §6
//   3. Categories  — all 12 tiles (art + name + count) → c/<id>/
//   4. Deals rail  — real discounts (compareAt), in_stock, with images, sorted by % off
//   5. Picks rail  — featured, with images, not out of stock (hero product excluded)
//   6. Recently viewed — empty shell filled client-side by src/js/50-home.js (stays hidden while empty)
//   7. One rail per category — up to 8 (in_stock first, images first) + "شاهد الكل (N)" → c/<id>/
//   8. Social CTA  — Instagram, TikTok, WhatsApp (real URLs from config.contact)
// No countdowns, sold counts, ratings or invented claims (SPEC §6).

const RAIL_MAX = 8;
const DEALS_MAX = 12;
const RECENT_MAX = 12;
const AVAIL_RANK = { in_stock: 0, backorder: 1, out_of_stock: 2 };

/** Hero product: featured + in_stock + image; on-sale ones first, then the catalog's default order. */
function pickHero(products, h) {
  const ok = (p) => p.availability === 'in_stock' && h.hasImage(p);
  const pool = products.filter((p) => p.featured && ok(p));
  const list = pool.length ? pool : products.filter(ok);
  if (!list.length) return null;
  return list.map((p, i) => ({ p, i }))
    .sort((a, b) => (h.isOnSale(b.p) ? 1 : 0) - (h.isOnSale(a.p) ? 1 : 0) || a.i - b.i)[0].p;
}

/** Real discounts, in stock, with images; by % off, then absolute saving, then default order. */
function pickDeals(products, h) {
  return products
    .map((p, i) => ({ p, i, pct: h.discountPct(p.priceFils, p.compareAtFils) }))
    .filter((x) => x.pct > 0 && x.p.availability === 'in_stock' && h.hasImage(x.p))
    .sort((a, b) => b.pct - a.pct || (b.p.compareAtFils - b.p.priceFils) - (a.p.compareAtFils - a.p.priceFils) || a.i - b.i)
    .map((x) => x.p);
}

/** Category rail order: in_stock → backorder → out_of_stock; images first inside each group; then default order. */
function pickCategory(list, h) {
  return list.map((p, i) => ({ p, i }))
    .sort((a, b) => AVAIL_RANK[a.p.availability] - AVAIL_RANK[b.p.availability]
      || (h.hasImage(b.p) ? 1 : 0) - (h.hasImage(a.p) ? 1 : 0) || a.i - b.i)
    .map((x) => x.p);
}

export default function routes(ctx) {
  const h = ctx.h;
  const { html, layout, icon, categoryGrid, rail, sectionHeading, priceBlock, availabilityBadge, addButton, wishButton,
    nameHtml, pname, productMedia, waLink, graph, ldOrganization, ldWebsite, productRoute, categoryRoute, imageUrl } = h;
  const T = ctx.t;
  const products = ctx.data.products;
  const contact = ctx.config.contact;
  const newTab = html`<span class="gb-sr"> ${T('a11y.newTab')}</span>`;

  /* ---------------------------------------------------------------- data */
  const hero = pickHero(products, h);
  const deals = pickDeals(products, h).slice(0, DEALS_MAX);
  const picks = products.filter((p) => p.featured && h.hasImage(p) && p.availability !== 'out_of_stock' && (!hero || p.id !== hero.id));

  /* ---------------------------------------------------------------- 1. hero */
  let heroCard = '';
  if (hero) {
    const href = ctx.url(productRoute(hero));
    heroCard = html`<article class="gb-home-hero__card" aria-labelledby="home-hero-pname">
<div class="gb-home-hero__media">
<span class="gb-home-hero__tag">${icon('sparkles')}<span>${T('home.heroPick')}</span></span>
${wishButton(ctx, hero, { cls: 'gb-home-hero__wish' })}
<a class="gb-home-hero__imglink" href="${href}" tabindex="-1" aria-hidden="true">${productMedia(ctx, hero, { eager: true })}</a>
</div>
<div class="gb-home-hero__info">
${hero.brand ? html`<p class="gb-home-hero__brand" dir="ltr">${hero.brand}</p>` : ''}
<h2 class="gb-home-hero__pname" id="home-hero-pname"><a href="${href}">${nameHtml(ctx, hero)}</a></h2>
${priceBlock(ctx, hero, { size: 'lg', saving: true })}
</div>
<div class="gb-home-hero__actions">
${addButton(ctx, hero, { cls: 'gb-home-hero__add' })}
<a class="gb-btn gb-btn--light gb-home-hero__more" href="${href}" aria-label="${T('home.viewProductLabel', { name: pname(ctx, hero) })}"><span>${T('home.viewProduct')}</span>${icon('arrow-forward')}</a>
</div>
</article>`;
  }

  const heroSection = html`<section class="gb-home-hero" aria-labelledby="home-title">
<div class="gb-wrap gb-home-hero__grid">
<div class="gb-home-hero__copy">
<p class="gb-eyebrow gb-home-hero__eyebrow">${T('home.eyebrow')}</p>
<h1 class="gb-home-hero__title" id="home-title">${T('home.heroTitle')}</h1>
<p class="gb-home-hero__sub">${T('home.heroSub')}</p>
<div class="gb-home-hero__cta">
<a class="gb-btn gb-btn--primary gb-btn--lg" href="#home-cats">${icon('grid')}<span>${T('home.shopNow')}</span></a>
${deals.length ? html`<a class="gb-link" href="#home-deals"><span>${T('home.seeDeals')}</span>${icon('arrow-forward')}</a>` : ''}
</div>
</div>
${hero ? html`<div class="gb-home-hero__stage">${heroCard}</div>` : ''}
</div>
</section>`;

  /* ---------------------------------------------------------------- 2. trust strip (SPEC §6 exact claims) */
  const trustItems = [
    { ic: 'whatsapp', title: T('home.trustWa') },
    { ic: 'cash', title: T('home.trustPay') },
    { ic: 'truck', title: T('home.trustDelivery') },
    { ic: 'tag', title: T('home.trustBrands'), sub: (ctx.config.trustBrands || []).join(' · ') },
  ];
  const trust = html`<section class="gb-home-trust" aria-labelledby="home-trust-title">
<div class="gb-wrap">
<h2 class="gb-sr" id="home-trust-title">${T('home.trustLabel')}</h2>
<ul class="gb-home-trust__list" role="list">${trustItems.map((it) => html`<li class="gb-home-trust__item"><span class="gb-home-trust__ic">${icon(it.ic)}</span><span class="gb-home-trust__text"><span class="gb-home-trust__title">${it.title}</span>${it.sub ? html`<span class="gb-home-trust__sub" dir="ltr">${it.sub}</span>` : ''}</span></li>`)}</ul>
</div>
</section>`;

  /* ---------------------------------------------------------------- 3. categories */
  const cats = html`<section class="gb-wrap gb-section gb-home-cats" id="home-cats" aria-labelledby="home-cats-title" tabindex="-1">
${sectionHeading(ctx, { id: 'home-cats-title', title: T('home.catsTitle'), subtitle: T('home.catsSub'),
    action: { route: 'c/all/', label: `${T('catalog.viewAllProducts')} (${products.length})` } })}
${categoryGrid(ctx)}
</section>`;

  /* ---------------------------------------------------------------- 4/5. deals + picks */
  // "view all" → every real discount on c/all/ with the sale filter on (the rail itself is in-stock + photo only)
  const saleCount = products.filter((p) => h.isOnSale(p)).length;
  const dealsRail = rail(ctx, { id: 'home-deals', title: T('home.dealsTitle'), subtitle: T('home.dealsSub'), products: deals, cls: 'gb-home-rail gb-home-rail--deals',
    seeAllRoute: 'c/all/?sale=1', seeAllCount: saleCount, seeAllAria: `${T('home.dealsTitle')}: ${T('common.viewAllN', { n: saleCount })}` });
  const picksRail = rail(ctx, { id: 'home-picks', title: T('home.picksTitle'), subtitle: T('home.picksSub'), products: picks, cls: 'gb-home-rail' });

  /* ---------------------------------------------------------------- 6. recently viewed (client-filled) */
  const recent = html`<section class="gb-rail gb-home-rail gb-home-recent" id="home-recent" aria-labelledby="home-recent-title" hidden data-home-recent>
<div class="gb-sechead"><div class="gb-sechead__text"><h2 class="gb-sechead__title" id="home-recent-title">${T('home.recentTitle')}</h2></div>
<button type="button" class="gb-btn gb-btn--ghost gb-home-recent__clear" data-action="home-recent-clear" aria-label="${T('home.recentClearLabel')}">${icon('trash')}<span>${T('home.recentClear')}</span></button></div>
<div class="gb-rail__viewport">
<button type="button" class="gb-rail__nav gb-rail__nav--prev" data-rail="prev" aria-label="${T('a11y.scrollPrev')}" tabindex="-1">${icon('chevron-back')}</button>
<ul class="gb-rail__track" role="list" data-home-recent-track></ul>
<button type="button" class="gb-rail__nav gb-rail__nav--next" data-rail="next" aria-label="${T('a11y.scrollNext')}" tabindex="-1">${icon('chevron-forward')}</button>
</div>
</section>`;

  /* ---------------------------------------------------------------- 7. one rail per category */
  const catRails = ctx.data.categories.map((cat) => {
    const name = cat.name[ctx.locale];
    return rail(ctx, {
      id: `home-cat-${cat.id}`,
      title: name,
      subtitle: cat.description && cat.description[ctx.locale],
      products: pickCategory(ctx.data.byCat.get(cat.id) || [], h).slice(0, RAIL_MAX),
      seeAllRoute: categoryRoute(cat.id),
      seeAllCount: cat.count,
      seeAllAria: `${T('a11y.seeAllCat', { cat: name })} (${cat.count})`,
      cls: 'gb-home-rail gb-home-rail--cat',
    });
  });

  /* ---------------------------------------------------------------- 8. social CTA */
  const social = html`<section class="gb-wrap gb-section gb-home-social" aria-labelledby="home-social-title">
<div class="gb-home-social__box">
<div class="gb-home-social__copy">
<p class="gb-eyebrow">${T('home.socialEyebrow')}</p>
<h2 class="gb-home-social__title" id="home-social-title">${T('home.socialTitle')}</h2>
<p class="gb-home-social__text">${T('home.socialText')}</p>
</div>
<ul class="gb-home-social__links" role="list">
<li><a class="gb-btn gb-btn--light gb-btn--lg gb-home-social__btn" href="${contact.instagram}" target="_blank" rel="noopener">${icon('instagram')}<span>${T('footer.instagram')}</span><bdi class="gb-home-social__handle" dir="ltr">@game_bossq8</bdi>${newTab}</a></li>
<li><a class="gb-btn gb-btn--light gb-btn--lg gb-home-social__btn" href="${contact.tiktok}" target="_blank" rel="noopener">${icon('tiktok')}<span>${T('footer.tiktok')}</span><bdi class="gb-home-social__handle" dir="ltr">@gamebossq8</bdi>${newTab}</a></li>
<li><a class="gb-btn gb-btn--wa gb-btn--lg gb-home-social__btn" href="${waLink(ctx, T('common.waGreeting'))}" target="_blank" rel="noopener">${icon('whatsapp')}<span>${T('home.socialWa')}</span>${newTab}</a></li>
</ul>
</div>
</section>`;

  const main = html`${heroSection}
${trust}
${cats}
<div class="gb-wrap gb-home-rails">
${dealsRail}
${picksRail}
${recent}
${catRails}
</div>
${social}`;

  // OG image: the brand image once the pwa module provides one, otherwise the hero product photo.
  const ogImage = !ctx.assets.ogImage && hero ? hero.images[0] : null;

  return [{
    route: '',
    html: layout(ctx, {
      route: '',
      bodyClass: 'page-home',
      nav: 'home',
      head: {
        title: null,
        description: T('meta.homeDesc'),
        og: ogImage ? { type: 'website', image: ogImage, imageAlt: pname(ctx, hero) } : { type: 'website' },
        jsonld: [graph(ldOrganization(ctx), ldWebsite(ctx))],
        preloadImage: hero ? imageUrl(hero.images[0], ctx.asset) : null,
      },
      main,
      pageData: {
        home: {
          recentMax: RECENT_MAX,
        },
      },
    }),
  }];
}
