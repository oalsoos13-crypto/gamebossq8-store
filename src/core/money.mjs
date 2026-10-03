// src/core/money.mjs — Kuwaiti dinar formatting from INTEGER FILS (1 KWD = 1000 fils).
//
// Decision (documented in CONTRACTS.md):
//   amount(16500)            → '16.500'            (Latin digits, always 3 decimals, no grouping < 1000 KWD)
//   money(16500, 'ar')       → '16.500 د.ك'
//   money(16500, 'en')       → '16.500 KWD'
//   moneyHtml(16500, 'ar')   → <span class="money"><bdi class="money__n" dir="ltr">16.500</bdi> <span class="money__c">د.ك</span></span>
// The SAME rules are implemented client-side in src/js/00-core.js (GB.money / GB.amount) and used in
// the WhatsApp message, so every surface shows identical numbers.

import { SafeHtml, esc } from './html.mjs';

export const CURRENCY = { ar: 'د.ك', en: 'KWD' };

export function amount(fils) {
  const f = Math.round(Number(fils) || 0);
  const neg = f < 0;
  const a = Math.abs(f);
  const kd = Math.floor(a / 1000);
  const rest = String(a % 1000).padStart(3, '0');
  const kdStr = String(kd).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + kdStr + '.' + rest;
}

export function money(fils, locale = 'ar') {
  return `${amount(fils)} ${CURRENCY[locale] || CURRENCY.ar}`;
}

export function moneyHtml(fils, locale = 'ar') {
  return new SafeHtml(`<span class="money"><bdi class="money__n" dir="ltr">${esc(amount(fils))}</bdi> <span class="money__c">${esc(CURRENCY[locale] || CURRENCY.ar)}</span></span>`);
}

/** Rounded whole-percent discount, or 0. */
export function discountPct(priceFils, compareAtFils) {
  if (!compareAtFils || compareAtFils <= priceFils) return 0;
  return Math.round(((compareAtFils - priceFils) / compareAtFils) * 100);
}
