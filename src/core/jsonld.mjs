// src/core/jsonld.mjs — schema.org builders (§9). Return plain objects; pass them to head({ jsonld: [...] }).
//
//   graph(...nodes)                      → { '@context': 'https://schema.org', '@graph': nodes }
//   ldOrganization(ctx)                  → OnlineStore node (@id abs('')#org)
//   ldWebsite(ctx)                       → WebSite + SearchAction (search/?q={search_term_string})
//   ldBreadcrumbs(ctx, [{name, route}])  → BreadcrumbList (last item may omit route → current page)
//   ldProduct(ctx, p)                    → Product + Offer (price "16.500", KWD, availability, NewCondition)
//   ldCollection(ctx, {route, name, description, products}) → CollectionPage + ItemList of product urls
// NO shippingDetails, NO hasMerchantReturnPolicy, NO aggregateRating (spec §9).

import { amount } from './money.mjs';
import { productRoute } from './url.mjs';
import { clip, plainText } from './html.mjs';
import { imageUrl } from './url.mjs';

export const AVAILABILITY_URL = {
  in_stock: 'https://schema.org/InStock',
  out_of_stock: 'https://schema.org/OutOfStock',
  backorder: 'https://schema.org/BackOrder',
};

export const graph = (...nodes) => ({ '@context': 'https://schema.org', '@graph': nodes.flat().filter(Boolean) });

export function ldOrganization(ctx) {
  const c = ctx.config.contact;
  const node = {
    '@type': 'OnlineStore',
    '@id': ctx.abs('', 'ar') + '#org',
    name: ctx.config.siteName,
    alternateName: 'جيم بوس',
    url: ctx.abs('', ctx.locale),
    sameAs: [c.instagram, c.tiktok],
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: c.phone,
      contactType: 'customer service',
      areaServed: 'KW',
      availableLanguage: ['ar', 'en'],
      url: `https://wa.me/${c.whatsapp}`,
    },
    address: { '@type': 'PostalAddress', addressCountry: 'KW' },
  };
  if (ctx.assets.logo) node.logo = ctx.assets.logo;
  return node;
}

export function ldWebsite(ctx) {
  return {
    '@type': 'WebSite',
    '@id': ctx.abs('', ctx.locale) + '#website',
    url: ctx.abs('', ctx.locale),
    name: ctx.config.siteName,
    inLanguage: ctx.locale,
    publisher: { '@id': ctx.abs('', 'ar') + '#org' },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: ctx.abs('search/', ctx.locale) + '?q={search_term_string}' },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function ldBreadcrumbs(ctx, items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => {
      const li = { '@type': 'ListItem', position: i + 1, name: it.name };
      if (it.route !== undefined && it.route !== null) li.item = ctx.abs(it.route, ctx.locale);
      return li;
    }),
  };
}

export function ldProduct(ctx, p) {
  const route = productRoute(p);
  const url = ctx.abs(route, ctx.locale);
  const cat = ctx.data.catById.get(p.category);
  const desc = p.description[ctx.locale] || p.description.ar || '';
  const node = {
    '@type': 'Product',
    '@id': url + '#product',
    name: p.name[ctx.locale] || p.name.ar,
    sku: p.id,
    url,
    category: cat ? cat.name[ctx.locale] : p.category,
    offers: {
      '@type': 'Offer',
      url,
      price: amount(p.priceFils),
      priceCurrency: 'KWD',
      availability: AVAILABILITY_URL[p.availability],
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': ctx.abs('', 'ar') + '#org' },
    },
  };
  if (p.images.length) node.image = p.images.map((u) => absImage(ctx, u));
  if (desc) node.description = clip(plainText(desc), 500);
  if (p.brand) node.brand = { '@type': 'Brand', name: p.brand };
  return node;
}

export function ldCollection(ctx, { route, name, description, products }) {
  const url = ctx.abs(route, ctx.locale);
  return {
    '@type': 'CollectionPage',
    '@id': url,
    url,
    name,
    description,
    inLanguage: ctx.locale,
    isPartOf: { '@id': ctx.abs('', ctx.locale) + '#website' },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: products.length,
      itemListElement: products.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: ctx.abs(productRoute(p), ctx.locale) })),
    },
  };
}

function absImage(ctx, u) {
  const s = imageUrl(u, ctx.asset);
  return /^https?:/i.test(s) ? s : ctx.config.origin.replace(/\/+$/, '') + s;
}
