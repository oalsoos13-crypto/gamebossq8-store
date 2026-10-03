// src/core/i18n.mjs — dictionary lookup with {param} interpolation and Intl.PluralRules plurals.
//
// Dictionary shape (flat, merged from data/i18n.json + src/i18n/*.json by the build):
//   { "nav.home": { "ar": "الرئيسية", "en": "Home" },
//     "common.products": { "ar": { "zero": "…", "one": "…", "two": "…", "few": "{n} …", "many": "…", "other": "{n} …" },
//                          "en": { "one": "1 product", "other": "{n} products" } },
//     "cart.added": { "ar": "…", "en": "…", "client": true } }   ← client:true also embeds it in pages
//
// t(key, params): plural values pick a form with Intl.PluralRules(locale).select(params.n ?? params.count).
// An exact-number form "=0" / "=1" etc. wins over the CLDR category. Missing keys THROW at build time
// (so typos fail the build) — use has(key) to probe.

const prCache = new Map();
function pluralRules(locale) {
  if (!prCache.has(locale)) prCache.set(locale, new Intl.PluralRules(locale));
  return prCache.get(locale);
}

export function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])));
}

/** Resolve one dictionary entry for a locale (string or plural object) with params. */
export function resolveValue(value, locale, params) {
  if (value && typeof value === 'object') {
    const n = Number(params && (params.n ?? params.count));
    const exact = value['=' + n];
    const form = exact !== undefined ? exact : (value[pluralRules(locale).select(Number.isFinite(n) ? n : 0)] ?? value.other);
    return interpolate(String(form ?? ''), params);
  }
  return interpolate(String(value ?? ''), params);
}

/**
 * makeT(dict, locale) → t(key, params). Throws on unknown key or missing locale value.
 */
export function makeT(dict, locale) {
  function t(key, params) {
    const entry = dict[key];
    if (!entry) throw new Error(`i18n: unknown key "${key}"`);
    const v = entry[locale];
    if (v === undefined || v === null || v === '') throw new Error(`i18n: key "${key}" has no "${locale}" value`);
    return resolveValue(v, locale, params);
  }
  t.has = (key) => Object.prototype.hasOwnProperty.call(dict, key);
  t.locale = locale;
  return t;
}

/**
 * Client subset for one locale: keys whose namespace (text before the first '.') is in `namespaces`,
 * plus any key whose entry has `client: true`. Values are the locale's string or plural object.
 */
export function clientSubset(dict, locale, namespaces) {
  const ns = new Set(namespaces || []);
  const out = {};
  for (const [k, v] of Object.entries(dict)) {
    if (ns.has(k.split('.')[0]) || v.client === true) out[k] = v[locale];
  }
  return out;
}
