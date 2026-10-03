// src/core/icons.mjs — one inline SVG sprite per page + <use> references.
//
//   icon('cart')                         → <svg class="i i--cart" aria-hidden="true" focusable="false"><use href="#i-cart"/></svg>
//   icon('arrow-forward', { cls: 'x' })  → directional icons get class "i--flip-rtl" (mirrored in RTL by CSS)
//   icon('heart', { label: 'Wishlist' }) → role="img" + <title> instead of aria-hidden (rarely needed)
//   art('cable')                         → colourful category illustration (64×64 art, v1 style)
//   catArt(category)                     → art(category.icon)
//   sprite()                             → the <svg> sprite emitted ONCE by layout() (do not call yourself)
//
// Client JS uses the same sprite: GB.icon('trash') returns the same markup.
// UI icons are lucide-style: 24×24, stroke=currentColor, 1.8 stroke, round caps/joins.

import { SafeHtml, esc } from './html.mjs';

const S = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

// name → inner SVG markup (24×24 viewBox). Directional icons are drawn pointing RIGHT (LTR "forward").
export const ICONS = {
  search: `<g ${S}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></g>`,
  heart: `<path ${S} d="M12 20.5s-7.5-4.6-9.4-9.1C1.3 8.2 3.4 4.8 6.9 4.8c2.2 0 3.7 1.3 5.1 3.1 1.4-1.8 2.9-3.1 5.1-3.1 3.5 0 5.6 3.4 4.3 6.6-1.9 4.5-9.4 9.1-9.4 9.1z"/>`,
  'heart-fill': `<path fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 20.5s-7.5-4.6-9.4-9.1C1.3 8.2 3.4 4.8 6.9 4.8c2.2 0 3.7 1.3 5.1 3.1 1.4-1.8 2.9-3.1 5.1-3.1 3.5 0 5.6 3.4 4.3 6.6-1.9 4.5-9.4 9.1-9.4 9.1z"/>`,
  cart: `<g ${S}><path d="M5.5 7.5h13l-1.1 10.6a2 2 0 0 1-2 1.9H8.6a2 2 0 0 1-2-1.9z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/></g>`,
  'cart-plus': `<g ${S}><path d="M5.5 7.5h13l-1.1 10.6a2 2 0 0 1-2 1.9H8.6a2 2 0 0 1-2-1.9z"/><path d="M9 7a3 3 0 0 1 6 0M12 11v5M9.5 13.5h5"/></g>`,
  grid: `<g ${S}><rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/></g>`,
  home: `<g ${S}><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/></g>`,
  menu: `<path ${S} d="M4 7h16M4 12h16M4 17h16"/>`,
  x: `<path ${S} d="M6 6l12 12M18 6 6 18"/>`,
  plus: `<path ${S} d="M12 5v14M5 12h14"/>`,
  minus: `<path ${S} d="M5 12h14"/>`,
  check: `<path ${S} d="M5 12.5 10 17.5 19.5 7"/>`,
  trash: `<g ${S}><path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/></g>`,
  'chevron-forward': `<path ${S} d="m9.5 5.5 6.5 6.5-6.5 6.5"/>`,
  'chevron-back': `<path ${S} d="M14.5 5.5 8 12l6.5 6.5"/>`,
  'chevron-down': `<path ${S} d="m6 9.5 6 6 6-6"/>`,
  'arrow-forward': `<path ${S} d="M5 12h14M13 6l6 6-6 6"/>`,
  'arrow-back': `<path ${S} d="M19 12H5M11 6l-6 6 6 6"/>`,
  share: `<g ${S}><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/></g>`,
  copy: `<g ${S}><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/></g>`,
  truck: `<g ${S}><path d="M3 6.5h11v9.5H3zM14 9.5h3.8l3.2 3.4V16h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></g>`,
  cash: `<g ${S}><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v.01M18 14.5v.01"/></g>`,
  card: `<g ${S}><rect x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M2.5 10h19M6.5 15h3"/></g>`,
  chat: `<path ${S} d="M20 14.5a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>`,
  globe: `<g ${S}><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5z"/></g>`,
  info: `<g ${S}><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.01"/></g>`,
  alert: `<g ${S}><path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17v.01"/></g>`,
  image: `<g ${S}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 15.5-4.8-4.8L6 19.5"/></g>`,
  'map-pin': `<g ${S}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></g>`,
  clock: `<g ${S}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></g>`,
  external: `<g ${S}><path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10"/></g>`,
  filter: `<path ${S} d="M4 5.5h16l-6.2 7.3v5.4l-3.6 1.8v-7.2z"/>`,
  sort: `<path ${S} d="M7 4.5v15M3.8 16.3 7 19.5l3.2-3.2M17 19.5v-15M13.8 7.7 17 4.5l3.2 3.2"/>`,
  sliders: `<g ${S}><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></g>`,
  bell: `<g ${S}><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></g>`,
  tag: `<g ${S}><path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8 8a1.5 1.5 0 0 1 0 2.1l-6.9 6.9a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.4"/></g>`,
  sparkles: `<g ${S}><path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.9L12 18.5l-1.8-5.8-5.7-1.9L10.2 9z"/><path d="M19 3.5v3M17.5 5h3"/></g>`,
  box: `<g ${S}><path d="M3.8 7.5 12 3.5l8.2 4v9L12 20.5l-8.2-4z"/><path d="M3.8 7.5 12 11.5l8.2-4M12 11.5v9"/></g>`,
  refresh: `<g ${S}><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4.5v4h-4"/></g>`,
  download: `<g ${S}><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/></g>`,
  'wifi-off': `<g ${S}><path d="M3.5 3.5l17 17M8.5 16.3a5 5 0 0 1 7 0M5 12.6a10 10 0 0 1 4.2-2.4M19 12.6a10 10 0 0 0-3.1-2M2 9a15 15 0 0 1 4.5-2.8M22 9a15 15 0 0 0-9.8-3.9M12 20v.01"/></g>`,
  user: `<g ${S}><circle cx="12" cy="8" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></g>`,
  phone: `<path ${S} d="M5 3.5h3.5l1.8 4.6-2.4 1.5a11 11 0 0 0 6.5 6.5l1.5-2.4 4.6 1.8V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5z"/>`,
  whatsapp: `<path fill="currentColor" d="M12 2.2a9.8 9.8 0 0 0-8.4 14.9L2.2 21.8l4.8-1.3A9.8 9.8 0 1 0 12 2.2zm0 17.9a8.1 8.1 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8.1 8.1 0 1 1 12 20.1zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3a.4.4 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 2.9 2.9 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.6 11.6 0 0 0 4.4 3.9c1.6.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .2-1.2c-.1-.1-.3-.2-.5-.3z"/>`,
  instagram: `<g ${S}><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.3 6.7v.01"/></g>`,
  tiktok: `<path fill="currentColor" d="M16.2 3c.3 2.3 1.8 3.9 4 4.2v3c-1.5 0-2.8-.5-4-1.3v6.6a5.6 5.6 0 1 1-5.6-5.6l.9.1v3.1a2.6 2.6 0 1 0 1.7 2.4V3z"/>`,
};

export const DIRECTIONAL = new Set(['chevron-forward', 'chevron-back', 'arrow-forward', 'arrow-back']);

// Category illustrations (64×64), v1 premium style: D = graphite, A = accent blue, L = light grey.
const D = '#2C2F36', A = '#2450FF', L = '#C7CAD2';
export const ART = {
  gamepad: `<path d="M20 22h24c7 0 12 5 13 13l1 8c1 6-3 9-7 9-3 0-5-2-7-5l-2-3H22l-2 3c-2 3-4 5-7 5-4 0-8-3-7-9l1-8c1-8 6-13 13-13z" fill="${D}"/><rect x="16" y="30" width="4" height="12" rx="2" fill="#fff"/><rect x="12" y="34" width="12" height="4" rx="2" fill="#fff"/><circle cx="45" cy="33" r="3" fill="${A}"/><circle cx="51" cy="39" r="3" fill="#fff"/><circle cx="45" cy="45" r="2.4" fill="#fff"/>`,
  trigger: `<path d="M18 16c-4 0-7 3-7 8v14c0 5 3 8 7 8h6V16h-6z" fill="${D}"/><path d="M46 16c4 0 7 3 7 8v14c0 5-3 8-7 8h-6V16h6z" fill="${A}"/><rect x="27" y="22" width="10" height="22" rx="4" fill="${L}"/>`,
  tablet: `<rect x="14" y="8" width="36" height="48" rx="5" fill="${D}"/><rect x="18" y="13" width="28" height="34" rx="2.5" fill="#fff"/><circle cx="24" cy="20" r="2.6" fill="${A}"/><circle cx="40" cy="20" r="2.6" fill="${L}"/><path d="M22 40h20" stroke="${L}" stroke-width="2.4" stroke-linecap="round"/>`,
  glove: `<path d="M22 28V14a3.2 3.2 0 0 1 6.4 0v11m0 0V10a3.2 3.2 0 0 1 6.4 0v14m0 0V13a3.2 3.2 0 0 1 6.4 0v19c0 11-5 18-15 18s-12-7-12-12c0-4 1.4-5.4 1.4-9l-2.6-5a3.2 3.2 0 0 1 5.8-2.6L22 28z" fill="${D}"/><path d="M28 40h8" stroke="${A}" stroke-width="2.4" stroke-linecap="round"/>`,
  fan: `<rect x="10" y="10" width="44" height="44" rx="11" fill="${D}"/><circle cx="32" cy="32" r="6" fill="#fff"/><path d="M32 32c0-11-3-17-8-17s-5 11 8 17zM32 32c11 0 17-3 17-8s-11-5-17 8zM32 32c0 11 3 17 8 17s5-11-8-17zM32 32c-11 0-17 3-17 8s11 5 17-8z" fill="${A}" opacity=".92"/>`,
  cable: `<path d="M16 16v10a10 10 0 0 0 10 10h12a10 10 0 0 1 10 10v2" stroke="${D}" stroke-width="4.5" stroke-linecap="round" fill="none"/><rect x="11" y="9" width="10" height="11" rx="2.5" fill="${A}"/><rect x="43" y="44" width="10" height="11" rx="2.5" fill="${D}"/>`,
  case: `<rect x="18" y="6" width="28" height="52" rx="8" fill="${D}"/><rect x="35" y="12" width="9" height="9" rx="2.5" fill="#fff"/><circle cx="39.5" cy="14.5" r="1.8" fill="${A}"/><circle cx="39.5" cy="19" r="1.8" fill="${L}"/>`,
  headset: `<path d="M14 40V32a18 18 0 0 1 36 0v8" stroke="${D}" stroke-width="4.5" stroke-linecap="round" fill="none"/><rect x="9" y="37" width="11" height="18" rx="5.5" fill="${D}"/><rect x="44" y="37" width="11" height="18" rx="5.5" fill="${A}"/>`,
  stand: `<rect x="10" y="10" width="36" height="26" rx="4" fill="${D}"/><rect x="14" y="14" width="28" height="18" rx="2" fill="#fff"/><rect x="24" y="36" width="8" height="12" fill="${D}"/><rect x="14" y="48" width="28" height="5" rx="2.5" fill="${A}"/>`,
  accessory: `<rect x="9" y="16" width="26" height="36" rx="5" fill="${D}"/><rect x="13" y="21" width="18" height="26" rx="2" fill="#fff" opacity=".9"/><circle cx="45" cy="22" r="9" fill="none" stroke="${A}" stroke-width="5"/><rect x="38" y="38" width="16" height="16" rx="4" fill="${L}"/><circle cx="46" cy="46" r="3" fill="${D}"/>`,
  bag: `<rect x="16" y="20" width="32" height="34" rx="6" fill="${D}"/><path d="M20 20v-2a12 12 0 0 1 24 0" stroke="${A}" stroke-width="3.5" fill="none"/><rect x="22" y="30" width="20" height="9" rx="2" fill="${A}"/><rect x="27" y="44" width="10" height="4" rx="2" fill="#fff"/>`,
  device: `<rect x="6" y="15" width="52" height="34" rx="6" fill="${D}"/><rect x="11" y="20" width="42" height="24" rx="2.5" fill="#fff"/><path d="M29 26.5v11l9-5.5z" fill="${A}"/><rect x="24" y="51" width="16" height="3" rx="1.5" fill="${L}"/>`,
  // extra art kept for future categories (bundle / adapter / screen / keyboard)
  bundle: `<rect x="12" y="24" width="40" height="30" rx="5" fill="${D}"/><path d="M12 24h40l-4-8H16l-4 8z" fill="${A}"/><rect x="29" y="16" width="6" height="38" fill="#fff" opacity=".9"/>`,
  adapter: `<rect x="12" y="20" width="40" height="24" rx="6" fill="${D}"/><rect x="18" y="27" width="10" height="4" rx="2" fill="${A}"/><rect x="18" y="35" width="16" height="3" rx="1.5" fill="#fff"/><circle cx="44" cy="32" r="3.5" fill="#fff"/>`,
  screen: `<rect x="16" y="8" width="32" height="48" rx="5" fill="${D}"/><rect x="20" y="13" width="24" height="38" rx="2" fill="#fff"/><path d="M32 20l10 4v6c0 7-4 11-10 13-6-2-10-6-10-13v-6l10-4z" fill="${A}"/><path d="m28 30 3 3 6-6" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  keyboard: `<rect x="6" y="18" width="52" height="30" rx="6" fill="${D}"/><g fill="#fff"><rect x="12" y="24" width="6" height="5" rx="1.5"/><rect x="21" y="24" width="6" height="5" rx="1.5"/><rect x="30" y="24" width="6" height="5" rx="1.5"/><rect x="39" y="24" width="6" height="5" rx="1.5"/><rect x="12" y="32" width="6" height="5" rx="1.5"/><rect x="30" y="32" width="6" height="5" rx="1.5"/></g><rect x="21" y="32" width="6" height="5" rx="1.5" fill="${A}"/><rect x="20" y="40" width="24" height="4" rx="2" fill="#fff"/><rect x="46" y="24" width="6" height="13" rx="1.5" fill="${A}"/>`,
};

/** The page sprite (emitted once by layout()). */
export function sprite() {
  let s = '<svg xmlns="http://www.w3.org/2000/svg" class="gb-sprite" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">';
  for (const [n, body] of Object.entries(ICONS)) s += `<symbol id="i-${n}" viewBox="0 0 24 24">${body}</symbol>`;
  for (const [n, body] of Object.entries(ART)) s += `<symbol id="art-${n}" viewBox="0 0 64 64">${body}</symbol>`;
  return new SafeHtml(s + '</svg>');
}

/** UI icon. opts: { cls, label, size } */
export function icon(name, opts = {}) {
  if (!ICONS[name]) throw new Error(`icon: unknown "${name}"`);
  const c = ['i', `i--${name}`, DIRECTIONAL.has(name) ? 'i--flip-rtl' : '', opts.cls || ''].filter(Boolean).join(' ');
  const size = opts.size ? ` width="${+opts.size}" height="${+opts.size}"` : '';
  const a11y = opts.label ? ` role="img" aria-label="${esc(opts.label)}"` : ' aria-hidden="true" focusable="false"';
  return new SafeHtml(`<svg class="${esc(c)}"${size}${a11y}><use href="#i-${name}"/></svg>`);
}

/** Category illustration. */
export function art(key, opts = {}) {
  const k = ART[key] ? key : 'bundle';
  return new SafeHtml(`<svg class="art art--${k}${opts.cls ? ' ' + esc(opts.cls) : ''}" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><use href="#art-${k}"/></svg>`);
}

/** Illustration for a category object ({icon}) or category id via ctx.data.catById. */
export function catArt(catOrIcon, opts) {
  const key = typeof catOrIcon === 'string' ? catOrIcon : (catOrIcon && catOrIcon.icon);
  return art(key, opts);
}
