// src/core/url.mjs — URL building. BASE is never assumed to be '/'.
//
// A ROUTE is a locale-neutral path relative to the site root, WITHOUT a leading slash:
//   ''                    home
//   'p/<slug>-<id>/'      product          (productRoute(p))
//   'c/<catId>/'          category         (categoryRoute(id))
//   'search/'  'wishlist/'  'checkout/'  'offline/'  'info/<page>/'
//   '404.html'            root-only file
//   may carry '?query' and/or '#hash':  'search/?q=piva'
//
// url(route, locale)  → '/gamebossq8-store/' + ('en/' for English) + route         (for href/src)
// abs(route, locale)  → origin + url(route, locale)                               (canonical, og, sitemap)
// asset(path)         → BASE + path, never locale-prefixed (for assets/*, favicon.svg, sw.js …)

export function normBase(base) {
  let b = String(base || '/').trim();
  if (!b.startsWith('/')) b = '/' + b;
  if (!b.endsWith('/')) b += '/';
  return b.replace(/\/{2,}/g, '/');
}

export function makeUrl({ base, origin, defaultLocale = 'ar' }) {
  const B = normBase(base);
  const O = String(origin || '').replace(/\/+$/, '');
  function url(route = '', locale = defaultLocale) {
    let r = String(route || '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith('//')) return r; // already absolute
    r = r.replace(/^\/+/, '');
    const prefix = locale && locale !== defaultLocale ? locale + '/' : '';
    // '404.html' is root-only; never prefix it
    if (r === '404.html') return B + r;
    return B + prefix + r;
  }
  function abs(route = '', locale = defaultLocale) {
    const u = url(route, locale);
    return /^https?:/i.test(u) ? u : O + u;
  }
  function asset(p) { return B + String(p || '').replace(/^\/+/, ''); }
  return { url, abs, asset, base: B, origin: O };
}

/** Locale-neutral route of a product. */
export const productRoute = (p) => `p/${p.slug}-${p.id}/`;
/** Locale-neutral route of a category. */
export const categoryRoute = (id) => `c/${id}/`;

/**
 * Image URL helper: absolute http(s) URLs pass through (already percent-encoded by prepare-data);
 * site-relative paths (e.g. 'img/p/10736/1.webp' after tools/mirror-images.mjs) get BASE.
 */
export function imageUrl(src, asset) {
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  return asset(src);
}

/** Output file path (relative to --out) for a locale-neutral page path. */
export function outPath(pagePath, locale, defaultLocale = 'ar') {
  const p = String(pagePath).replace(/^\/+/, '');
  return locale === defaultLocale ? p : `${locale}/${p}`;
}
