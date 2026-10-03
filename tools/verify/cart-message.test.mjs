#!/usr/bin/env node
// tools/verify/cart-message.test.mjs — unit tests for the WhatsApp order message builder (cart module).
//
//   node tools/verify/cart-message.test.mjs        (exit code 1 on failure; zero npm deps)
//
// Runs the REAL browser sources (src/js/00-core.js, 10-store.js, 30-cart.js, 31-checkout.js) inside a
// node:vm sandbox with a tiny DOM stub, the merged i18n dictionary (data/i18n.json + src/i18n/*.json) and
// data/config.json — the same way tools/build.mjs bundles them (one IIFE, one block per file).
// Covers: normal Arabic order, backorder line, 20-item cap (≤ 6000-char wa.me URL), English locale,
// delivery confirmed=false / confirmed=true (fee + free over threshold), phone normalisation, order ref.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* ------------------------------------------------------------------ dictionary + config */
const dict = {};
for (const file of ['data/i18n.json', ...readdirSync(join(ROOT, 'src/i18n')).filter((f) => f.endsWith('.json')).sort().map((f) => 'src/i18n/' + f)]) {
  for (const [k, v] of Object.entries(JSON.parse(read(file)))) if (!k.startsWith('$')) dict[k] = v;
}
const config = JSON.parse(read('data/config.json'));
const PUBLISH = 'abcd1234';

/** Boot the client modules for one locale and delivery config; returns the sandbox GB. */
function boot(locale, delivery, opts = {}) {
  const i18n = {};
  for (const [k, v] of Object.entries(dict)) if (v[locale] !== undefined) i18n[k] = v[locale];
  const cfg = {
    v: 1, publishId: PUBLISH, base: '/gamebossq8-store/', origin: 'https://oalsoos13-crypto.github.io', locale, dir: locale === 'ar' ? 'rtl' : 'ltr',
    defaultLocale: 'ar', productsUrl: '/x.json', whatsapp: config.contact.whatsapp, delivery: { ...config.delivery, ...delivery },
    analytics: { provider: null, code: null }, storagePrefix: 'gbq8:v2:', payments: config.payments, governorates: config.governorates,
  };
  const json = { 'gb-config': JSON.stringify(cfg), 'gb-i18n': JSON.stringify(i18n) };
  const noop = () => {};
  const elStub = { classList: { contains: () => false, add: noop, remove: noop }, setAttribute: noop, getAttribute: () => null };
  const document = {
    getElementById: (id) => (json[id] ? { textContent: json[id] } : null),
    querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    documentElement: { lang: locale, dir: cfg.dir }, body: elStub,
  };
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const window = { addEventListener: noop, localStorage, crypto: globalThis.crypto };
  const location = { search: opts.search || '', origin: 'https://oalsoos13-crypto.github.io', pathname: '/gamebossq8-store/checkout/', href: '' };
  const sandbox = { window, document, location, console, URLSearchParams, Intl, Map, Set, Promise, JSON, Math, Date, Number, String, Array, Object, RegExp, Uint8Array, encodeURIComponent, setTimeout, clearTimeout };
  window.window = window;
  const files = ['src/js/00-core.js', 'src/js/10-store.js', 'src/js/30-cart.js', 'src/js/31-checkout.js'];
  const src = `(function(){'use strict';\nconst GB = window.GB = window.GB || {};\n${files.map((f) => `{\n${read(f)}\n}`).join('\n')}\n})();`;
  vm.runInNewContext(src, sandbox, { filename: 'cart-bundle.js' });
  return window.GB;
}

/* ------------------------------------------------------------------ fixtures */
const LINES = [
  { id: '10736', name: 'وصلة بيفا PIVA DS5', qty: 2, unitFils: 16500, lineFils: 33000, backorder: false },
  { id: '10779', name: 'قفازات جيم بوس', qty: 1, unitFils: 4000, lineFils: 4000, backorder: false },
];
const CUSTOMER_AR = { name: 'عمر عبدالله', phone: '97937556', governorate: 'hawalli', area: 'السالمية', block: '10', street: '5', avenue: '2', house: '12', notes: 'الاتصال قبل الوصول' };
const CUSTOMER_EN = { name: 'Omar Abdullah', phone: '97937556', governorate: 'capital', area: 'Sharq', block: '2', street: 'Ahmad Al-Jaber', avenue: '', house: 'Bldg 7, flat 12', notes: '' };
function totalsFor(GB, lines) {
  // GB.cart.totals() works on resolved lines ({available, qty, lineFils}); reuse it so the test follows the store rules
  return GB.cart.totals(lines.map((l) => ({ ...l, available: true })));
}
function order(GB, over = {}) {
  const lines = over.lines || LINES;
  return { ref: 'GB-261002-7KQ4', locale: GB.locale, lines, totals: totalsFor(GB, lines), customer: CUSTOMER_AR, payment: 'cod', src: null, publishId: PUBLISH, ...over };
}

let passed = 0;
const results = [];
function test(name, fn) {
  try { fn(); passed++; results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); }
}

/* ------------------------------------------------------------------ tests */
test('Arabic message, delivery not confirmed: exact SPEC §5 format', () => {
  const GB = boot('ar', { confirmed: false });
  const text = GB.order.text(order(GB, { src: 'ig' }), 0);
  const expected = [
    '🛒 طلب جديد — GameBoss Q8',
    'رقم الطلب: GB-261002-7KQ4',
    '———',
    '• [#10736] وصلة بيفا PIVA DS5 × 2 = 33.000 د.ك',
    '• [#10779] قفازات جيم بوس × 1 = 4.000 د.ك',
    '———',
    'المجموع: 37.000 د.ك',
    'التوصيل: يتأكد على واتساب',
    'الإجمالي: 37.000 د.ك + التوصيل',
    '———',
    'الاسم: عمر عبدالله',
    'الهاتف: 97937556',
    'العنوان: حولي — السالمية، قطعة 10، شارع 5، جادة 2، منزل 12',
    'ملاحظات: الاتصال قبل الوصول',
    'طريقة الدفع: كاش عند الاستلام',
    '———',
    'المصدر: ig · نسخة: abcd1234',
  ].join('\n');
  assert.equal(text, expected);
  const c = GB.order.compose(order(GB, { src: 'ig' }));
  assert.equal(c.level, 0);
  assert.ok(c.url.startsWith('https://wa.me/96597937556?text='), c.url.slice(0, 40));
  assert.equal(decodeURIComponent(c.url.split('?text=')[1]), expected);
  assert.ok(c.url.length <= 6000, 'url ' + c.url.length);
});

test('no src → footer is only the version; no avenue/notes → omitted; KNET payment label', () => {
  const GB = boot('ar', { confirmed: false });
  const text = GB.order.text(order(GB, { customer: { ...CUSTOMER_AR, avenue: '', notes: '' }, payment: 'knet_link' }), 0);
  const lines = text.split('\n');
  assert.equal(lines[lines.length - 1], 'نسخة: abcd1234');
  assert.ok(lines.includes('العنوان: حولي — السالمية، قطعة 10، شارع 5، منزل 12'), text);
  assert.ok(!lines.some((l) => l.startsWith('ملاحظات:')));
  assert.ok(lines.includes('طريقة الدفع: رابط دفع KNET'));
});

test('backorder line is suffixed "(طلب مسبق)"', () => {
  const GB = boot('ar', { confirmed: false });
  const lines = [LINES[0], { id: '13432', name: 'منتج طلب مسبق', qty: 1, unitFils: 9000, lineFils: 9000, backorder: true }];
  const text = GB.order.text(order(GB, { lines }), 0);
  assert.ok(text.split('\n').includes('• [#13432] منتج طلب مسبق × 1 = 9.000 د.ك (طلب مسبق)'), text);
  assert.ok(text.split('\n').includes('• [#10736] وصلة بيفا PIVA DS5 × 2 = 33.000 د.ك'));
});

test('delivery confirmed=true below threshold: fee 1.500 and numeric total', () => {
  const GB = boot('ar', { confirmed: true, feeFils: 1500, freeOverFils: 25000 });
  const lines = [LINES[1]]; // 4.000
  const t = totalsFor(GB, lines);
  assert.equal(t.deliveryFils, 1500);
  const text = GB.order.text(order(GB, { lines }), 0).split('\n');
  assert.ok(text.includes('المجموع: 4.000 د.ك'));
  assert.ok(text.includes('التوصيل: 1.500 د.ك'));
  assert.ok(text.includes('الإجمالي: 5.500 د.ك'), text.join('\n'));
});

test('delivery confirmed=true at/over threshold: free delivery', () => {
  const GB = boot('ar', { confirmed: true, feeFils: 1500, freeOverFils: 25000 });
  const text = GB.order.text(order(GB), 0).split('\n'); // 37.000
  assert.ok(text.includes('التوصيل: مجاني'));
  assert.ok(text.includes('الإجمالي: 37.000 د.ك'));
  const exact = [{ id: '1', name: 'x', qty: 1, unitFils: 25000, lineFils: 25000, backorder: false }];
  assert.equal(totalsFor(GB, exact).deliveryFils, 0);
});

test('delivery confirmed=false: no fee, no free claim', () => {
  const GB = boot('ar', { confirmed: false });
  const t = totalsFor(GB, LINES);
  assert.equal(t.deliveryFils, null);
  assert.equal(t.totalFils, null);
  const text = GB.order.text(order(GB), 0);
  assert.ok(!/مجاني/.test(text));
});

test('English locale: English labels, KWD, ", " separators', () => {
  const GB = boot('en', { confirmed: false });
  const lines = [{ id: '10736', name: 'PIVA DS5 Adapter', qty: 2, unitFils: 16500, lineFils: 33000, backorder: true }];
  const text = GB.order.text(order(GB, { lines, customer: CUSTOMER_EN, payment: 'knet_link', src: 'tt' }), 0);
  const expected = [
    '🛒 New order — GameBoss Q8',
    'Order no.: GB-261002-7KQ4',
    '———',
    '• [#10736] PIVA DS5 Adapter × 2 = 33.000 KWD (pre-order)',
    '———',
    'Subtotal: 33.000 KWD',
    'Delivery: to be confirmed on WhatsApp',
    'Total: 33.000 KWD + delivery',
    '———',
    'Name: Omar Abdullah',
    'Phone: 97937556',
    'Address: Capital — Sharq, Block 2, Street Ahmad Al-Jaber, House Bldg 7, flat 12',
    'Payment: KNET payment link',
    '———',
    'Source: tt · Version: abcd1234',
  ].join('\n');
  assert.equal(text, expected);
});

test('English + confirmed=true: Delivery: Free / fee', () => {
  const GB = boot('en', { confirmed: true, feeFils: 1500, freeOverFils: 25000 });
  const big = GB.order.text(order(GB, { customer: CUSTOMER_EN }), 0).split('\n');
  assert.ok(big.includes('Delivery: Free') && big.includes('Total: 37.000 KWD'), big.join('\n'));
  const small = GB.order.text(order(GB, { lines: [LINES[1]], customer: CUSTOMER_EN }), 0).split('\n');
  assert.ok(small.includes('Delivery: 1.500 KWD') && small.includes('Total: 5.500 KWD'), small.join('\n'));
});

test('length cap: 20-item cart → id-only lines and wa.me URL ≤ 6000; full text kept for copy', () => {
  const GB = boot('ar', { confirmed: false });
  const lines = Array.from({ length: 20 }, (_, i) => ({
    id: String(11000 + i * 37), name: 'يد تحكم احترافية للموبايل مع مروحة تبريد وشاشة عرض رقم ' + (i + 1), qty: (i % 3) + 1,
    unitFils: 7500 + i * 250, lineFils: (7500 + i * 250) * ((i % 3) + 1), backorder: i === 4,
  }));
  const o = order(GB, { lines, src: 'ig' });
  const c = GB.order.compose(o);
  assert.ok(c.level >= 2, 'level ' + c.level);
  assert.ok(c.url.length <= 6000, 'url length ' + c.url.length);
  assert.equal(c.over, false);
  const sent = decodeURIComponent(c.url.split('?text=')[1]);
  assert.equal(sent, c.sent);
  // every item id and quantity is still in the sent text (no item is ever dropped)
  lines.forEach((l) => assert.ok(sent.includes('#' + l.id + '×' + l.qty) || sent.includes('[#' + l.id + '] × ' + l.qty), 'missing ' + l.id));
  assert.ok(!sent.includes(lines[0].name), 'names are left out at this length');
  assert.ok(sent.includes('رقم الطلب: GB-261002-7KQ4') && sent.includes('الإجمالي: ') && sent.includes('العنوان: ') && sent.includes('طريقة الدفع: '));
  // the full text (for "copy order text") still has every name and the backorder marker
  assert.equal(c.text, GB.order.text(o, 0));
  assert.ok(c.text.includes(lines[19].name) && c.text.includes('(طلب مسبق)'));
});

test('length cap levels: 2 = "• [#id] × qty = total" (SPEC), 4 = one compact line, 5 = notes left out', () => {
  const GB = boot('ar', { confirmed: false });
  const o = order(GB, { lines: [LINES[0], { ...LINES[1], backorder: true }] });
  const l2 = GB.order.text(o, 2).split('\n').filter((l) => l.startsWith('• '));
  assert.deepEqual(l2, ['• [#10736] × 2 = 33.000 د.ك', '• [#10779] × 1 = 4.000 د.ك']);
  const t4 = GB.order.text(o, 4).split('\n');
  assert.ok(t4.includes('• #10736×2، #10779×1'), t4.join('\n'));
  assert.ok(t4.some((l) => l.startsWith('ملاحظات:')));
  assert.ok(!GB.order.text(o, 5).includes('ملاحظات:'));
  const en = boot('en', { confirmed: false });
  assert.ok(en.order.text({ ...order(en), customer: CUSTOMER_EN }, 4).split('\n').includes('• #10736×2, #10779×1'));
});

test('length cap: a very long note is clipped before items are compacted further', () => {
  const GB = boot('ar', { confirmed: false });
  const notes = 'يرجى الاتصال قبل الوصول بنصف ساعة لأن المنزل في نهاية الشارع بجانب المسجد والبوابة الثانية '.repeat(3).trim();
  const c = GB.order.compose(order(GB, { customer: { ...CUSTOMER_AR, notes: GB.order.cleanText(notes, 300) } }));
  assert.ok(c.url.length <= 6000, 'url ' + c.url.length);
  assert.ok(c.text.includes(GB.order.cleanText(notes, 300)), 'copy text keeps the full note');
});

test('length cap: a 3-item cart keeps full names; a larger cart first truncates names to 40 chars', () => {
  const GB = boot('ar', { confirmed: false });
  const long = 'سماعة ألعاب احترافية مع ميكروفون قابل للفصل وإضاءة RGB وصوت محيطي 7.1';
  const lines = Array.from({ length: 3 }, (_, i) => ({ id: String(12000 + i), name: long + ' ' + i, qty: 1, unitFils: 10000, lineFils: 10000, backorder: false }));
  const o = order(GB, { lines });
  const l1 = GB.order.text(o, 1).split('\n').filter((l) => l.startsWith('• '));
  l1.forEach((l) => { const name = l.replace(/^• \[#\d+\] /, '').replace(/ × .*$/, ''); assert.ok(Array.from(name).length <= 40, name); assert.ok(name.endsWith('…')); });
  const c = GB.order.compose(o);
  assert.ok(c.url.length <= 6000 && c.level === 0, `3 items should send full names: level ${c.level} len ${c.url.length}`);
  const big = order(GB, { lines: Array.from({ length: 14 }, (_, i) => ({ id: String(12000 + i), name: long + ' ' + i, qty: 1, unitFils: 10000, lineFils: 10000, backorder: false })) });
  const cb = GB.order.compose(big);
  assert.ok(cb.url.length <= 6000 && cb.level >= 1, `14 items: level ${cb.level} len ${cb.url.length}`);
});

test('phone normalisation: Arabic/Persian digits, 965 / 00965 prefixes, validity', () => {
  const GB = boot('ar', { confirmed: false });
  const { normPhone, validPhone } = GB.order;
  assert.equal(normPhone('٩٧٩٣٧٥٥٦'), '97937556');
  assert.equal(normPhone('۹۷۹۳۷۵۵۶'), '97937556');
  assert.equal(normPhone('+965 9793 7556'), '97937556');
  assert.equal(normPhone('00965 97937556'), '97937556');
  assert.equal(normPhone('٠٠٩٦٥٥٥١٢٣٤٥٦'), '55123456');
  assert.equal(normPhone('96512345'), '96512345'); // an 8-digit number starting with 965 is kept
  assert.ok(validPhone(normPhone('٩٧٩٣٧٥٥٦')));
  assert.ok(validPhone('22123456') && validPhone('41234567') && validPhone('51234567') && validPhone('61234567'));
  assert.ok(!validPhone(normPhone('12')) && !validPhone('31234567') && !validPhone('81234567') && !validPhone('9123456') && !validPhone('912345678'));
});

test('order ref: GB-YYMMDD-XXXX with the 32-letter alphabet', () => {
  const GB = boot('ar', { confirmed: false });
  const ref = GB.order.makeRef(new Date(2026, 9, 2, 21, 14));
  assert.match(ref, /^GB-261002-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  assert.equal(GB.order.makeRef(new Date(2026, 0, 5), () => 0), 'GB-260105-2222');
  assert.equal(GB.order.makeRef(new Date(2026, 0, 5), () => 0.9999), 'GB-260105-ZZZZ');
  const seen = new Set(Array.from({ length: 200 }, () => GB.order.makeRef()));
  assert.ok(seen.size > 190, 'refs should be random');
});

test('cleanText: digits normalised, whitespace collapsed, capped', () => {
  const GB = boot('ar', { confirmed: false });
  assert.equal(GB.order.cleanText('  قطعة   ١٢\n', 40), 'قطعة 12');
  assert.equal(GB.order.cleanText('x'.repeat(80), 60).length, 60);
});

/* ------------------------------------------------------------------ report */
for (const r of results) console.log(r[0] + ' ' + r[1] + (r[2] ? '\n     ' + r[2].split('\n').join('\n     ') : ''));
const failed = results.length - passed;
console.log(`\ncart-message: ${passed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
