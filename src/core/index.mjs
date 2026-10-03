// src/core/index.mjs — single import point for page modules:
//   import { html, layout, productCard, rail, breadcrumbs, ldProduct, graph } from '../core/index.mjs';
// The same namespace is also available as ctx.h.

export * from './html.mjs';
export * from './i18n.mjs';
export * from './url.mjs';
export { amount, money, moneyHtml, discountPct, CURRENCY } from './money.mjs';
export * from './icons.mjs';
export * from './jsonld.mjs';
export { head, pageTitle } from './head.mjs';
export * from './components.mjs';
export { layout, header, footer, tabbar, dialogs } from './layout.mjs';
export * from './data.mjs';
