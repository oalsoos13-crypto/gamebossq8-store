#!/usr/bin/env node
// tools/prepare-data.mjs — ONE-TIME generator of data/*.json from the audit's cleaned catalog.
//
//   node tools/prepare-data.mjs [--audit <dir>] [--force]
//
// Inputs (AUDIT dir): catalog_clean.json, categories.json, i18n.json (reference only).
// Outputs (REPO/data): config.json, catalog.json, categories.json, i18n.json.
//
// After the first run data/catalog.json is the hand-editable source of truth (tools/import-csv.mjs
// re-imports WooCommerce CSVs into it). Re-running this script OVERWRITES data/*.json, so it refuses
// to do that unless --force is given.
// Zero dependencies (node:fs / node:path / node:url only).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const AUDIT = argVal('--audit', '/tmp/claude-0/-home-user-ddc-approval/e3d6f3de-b38c-5e2a-9697-1356406fa16a/scratchpad/audit');
const FORCE = args.includes('--force');
const DATA = path.join(REPO, 'data');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
function assert(cond, msg) { if (!cond) { console.error('ASSERT FAILED: ' + msg); process.exit(1); } }

if (fs.existsSync(path.join(DATA, 'catalog.json')) && !FORCE) {
  console.error('data/catalog.json already exists. It is the source of truth now; pass --force to regenerate (overwrites manual edits).');
  process.exit(2);
}
fs.mkdirSync(DATA, { recursive: true });

// ---------------------------------------------------------------- categories
const CAT_ORDER = ['mobile', 'trigger', 'tablet', 'glove', 'fan', 'cable', 'case', 'headset', 'stand', 'accessory', 'bag', 'device'];
const CAT_ICON = {
  mobile: 'gamepad', trigger: 'trigger', tablet: 'tablet', glove: 'glove', fan: 'fan', cable: 'cable',
  case: 'case', headset: 'headset', stand: 'stand', accessory: 'accessory', bag: 'bag', device: 'device',
};
const CAT_DESC = {
  mobile: { ar: 'يدات تحكم للموبايل تمنحك تحكماً أدق وراحة أطول أثناء اللعب.', en: 'Mobile controllers for sharper control and longer, more comfortable sessions.' },
  trigger: { ar: 'أزرار وشفتات سريعة الاستجابة لألعاب مثل ببجي وكول أوف ديوتي.', en: 'Fast-response triggers and buttons for games like PUBG and Call of Duty.' },
  tablet: { ar: 'يدات وأزرار مصممة خصيصاً للآيباد والتابلت.', en: 'Controllers and triggers designed for iPad and tablets.' },
  glove: { ar: 'قفازات أصابع تقلّل التعرّق وتجعل اللمس أنعم وأسرع.', en: 'Finger sleeves that cut sweat and keep every swipe smooth and fast.' },
  fan: { ar: 'مراوح تبريد للموبايل والآيباد تحافظ على أداء جهازك أثناء اللعب.', en: 'Phone and iPad coolers that keep your device performing mid-game.' },
  cable: { ar: 'وصلات وأدبترات وكيابل شحن لتشحن جهازك وتلعب في الوقت نفسه.', en: 'Adapters, cables and chargers so you can charge and play at the same time.' },
  case: { ar: 'كفرات ومسكات تحمي جهازك وتثبّته في يدك.', en: 'Cases and grips that protect your device and keep it steady in hand.' },
  headset: { ar: 'سماعات ألعاب بصوت واضح ومايك نقي.', en: 'Gaming headsets and earbuds with clear sound and a clean mic.' },
  stand: { ar: 'ستاندات وحوامل ثابتة للموبايل والآيباد.', en: 'Sturdy stands and holders for phones and iPads.' },
  accessory: { ar: 'إكسسوارات متنوعة تكمّل أدوات اللعب لديك.', en: 'Extra accessories to round out your gaming kit.' },
  bag: { ar: 'شنط وحافظات تحمل أجهزتك وإكسسواراتك بأمان.', en: 'Bags and pouches to carry your devices and gear safely.' },
  device: { ar: 'أجهزة ألعاب مختارة.', en: 'Selected gaming devices.' },
};
const CAT_NAME_FIX = { device: { ar: 'الأجهزة' } }; // typo "اللأجهزة" → "الأجهزة"

const rawCats = readJson(path.join(AUDIT, 'categories.json'));
const catById = Object.fromEntries(rawCats.map((c) => [c.id, c]));
assert(CAT_ORDER.every((id) => catById[id]), 'all 12 canonical categories exist in AUDIT/categories.json');

// ---------------------------------------------------------------- products
const NAME_AR_FIX = {
  10754: [['مروجة', 'مروحة']],
  13194: [['بريد', 'تبريد']],
  13321: [['مفذ', 'منفذ']],
  11521: [['معناطيسية', 'مغناطيسية']],
  11529: [['مغناطسية', 'مغناطيسية']],
  10938: [['للأجهزةاللوحية', 'للأجهزة اللوحية']],
  13338: [['Hypex', 'HyperX']],
  11770: [[' (نسخة)', '']],
};
const NAME_AR_SET = {
  12628: 'جهاز ريد ماجيك اللوحي نوفا (2024) — 10.9 بوصة، 12 جيجا رام، 256 جيجا، واي فاي، الإصدار العالمي، ميدنايت',
  12906: 'شفتات جيم سير F2 مع مقبض',
};
const DESC_AR_FIX = { 10736: [[/tybe c/gi, 'type-c']] };
// The audit slug for 11912 carried a numeric suffix (collision with 11897); the route already ends
// with -<id>, so give it a distinct readable slug instead of "mobile-triggers-11912-11912".
const SLUG_SET = { 11912: 'mobile-trigger-buttons' };

// English descriptions come from WooCommerce machine translations. Keep one only when it reads as
// acceptable English; anything matching these tells is junk → null (EN page then shows the Arabic text).
const JUNK_EN = [
  /60ww/i, /screw headphones/i, /agency/i, /trigrat/i, /rdmagic/i, /\bplexton\b/i, /fly digi/i,
  /contents of the can/i, /harass/i, /wall camera/i, /acoustics/i, /cita poles/i, /wisp2/i,
  /beer/i, /notable people/i, /hyperrexer/i, /\bdelivery\b\s*$/im, /hand controller/i,
  /closed posteriorly/i, /stand ipads/i, /glove memo/i, /cover piva/i,
];
function cleanEnDesc(s) {
  if (!s) return null;
  const t = String(s).replace(/\r/g, '').trim();
  if (t.length < 40) return null;                   // too thin to be useful
  if (/[؀-ۿ٠-٩]/.test(t)) return null; // mixed Arabic → machine-translation residue
  if (JUNK_EN.some((re) => re.test(t))) return null;
  return t;
}

const toFils = (kwd) => Math.round(Number(kwd) * 1000);
function encodeUrl(u) {
  // percent-encode non-ASCII (e.g. Chinese file names) once, without double-encoding
  try { return encodeURI(decodeURI(u)); } catch { return encodeURI(u); }
}
const tidy = (s) => String(s).replace(/\s+/g, ' ').trim();
// SPEC §7: Latin digits everywhere (Arabic-Indic ٠-٩ and Persian ۰-۹ → 0-9).
const latinDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6F0));

const clean = readJson(path.join(AUDIT, 'catalog_clean.json'));
assert(clean.length === 165, `catalog_clean has 165 products (got ${clean.length})`);

const newestIds = new Set([...clean].sort((a, b) => b.id - a.id).slice(0, 12).map((p) => String(p.id)));

let products = clean.map((p) => {
  const id = String(p.id);
  let nameAr = NAME_AR_SET[p.id] || p.name_ar;
  for (const [a, b] of NAME_AR_FIX[p.id] || []) nameAr = nameAr.split(a).join(b);
  nameAr = tidy(latinDigits(nameAr));
  let descAr = p.description_ar ? latinDigits(String(p.description_ar).replace(/\r/g, '')).trim() : '';
  for (const [a, b] of DESC_AR_FIX[p.id] || []) descAr = descAr.replace(a, b);
  const priceFils = toFils(p.price);
  const compareAtFils = p.compare_at != null && toFils(p.compare_at) > priceFils ? toFils(p.compare_at) : null;
  const images = [...new Set((p.images || []).map(encodeUrl))];
  // data lens: 13350 has its only images in the description, hosted on gamebossq8.com — use them
  if (!images.length) for (const u of p.description_images || []) if (/^https:\/\/gamebossq8\.com\//.test(u)) images.push(encodeUrl(u));
  return {
    id,
    slug: SLUG_SET[p.id] || p.slug,
    name: { ar: nameAr, en: tidy(p.name_en_suggested) },
    brand: p.brand || null,
    priceFils,
    compareAtFils,
    category: p.category,
    categories: [...new Set([p.category, ...(p.categories || [])])],
    images,
    description: { ar: descAr || null, en: cleanEnDesc(p.description_en) },
    availability: p.availability,
    featured: !!p.featured,
    isNew: newestIds.has(id),
    sort: 0,
  };
});

// default "best match" order within the catalog (lower = earlier). Availability is applied at render
// time (in_stock first), so `sort` only encodes: featured → has image → newest WooCommerce id.
products.sort((a, b) =>
  (b.featured - a.featured) || ((b.images.length > 0) - (a.images.length > 0)) || (Number(b.id) - Number(a.id)));
products.forEach((p, i) => { p.sort = (i + 1) * 10; });
products.sort((a, b) => Number(a.id) - Number(b.id));

// ---------------------------------------------------------------- asserts
const ids = new Set(), slugs = new Set();
for (const p of products) {
  assert(/^\d+$/.test(p.id), `id numeric string: ${p.id}`);
  assert(!ids.has(p.id), `unique id ${p.id}`); ids.add(p.id);
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug) && p.slug.length <= 70, `ascii slug ${p.slug}`);
  assert(!slugs.has(p.slug), `unique slug ${p.slug}`); slugs.add(p.slug);
  assert(Number.isInteger(p.priceFils) && p.priceFils > 0, `priceFils > 0 for ${p.id}`);
  assert(p.compareAtFils === null || (Number.isInteger(p.compareAtFils) && p.compareAtFils > p.priceFils), `compareAt > price for ${p.id}`);
  assert(CAT_ORDER.includes(p.category), `known category for ${p.id}: ${p.category}`);
  assert(['in_stock', 'out_of_stock', 'backorder'].includes(p.availability), `availability for ${p.id}`);
  assert(p.name.ar && p.name.en, `names for ${p.id}`);
  assert(!/[٠-٩۰-۹]/.test(p.name.ar + (p.description.ar || '')), `Latin digits only for ${p.id}`);
  assert(p.images.every((u) => /^https:\/\/[\x21-\x7e]+$/.test(u)), `ascii absolute image urls for ${p.id}`);
}
assert(products.length === 165, '165 products');

// ---------------------------------------------------------------- categories.json
const categories = CAT_ORDER.map((id, i) => {
  const c = catById[id];
  const inCat = products.filter((p) => p.category === id);
  return {
    id,
    order: i + 1,
    name: { ar: (CAT_NAME_FIX[id] && CAT_NAME_FIX[id].ar) || c.name_ar, en: c.name_en },
    description: CAT_DESC[id],
    icon: CAT_ICON[id],
    count: inCat.length,
    inStock: inCat.filter((p) => p.availability !== 'out_of_stock').length,
  };
});
for (const c of categories) assert(c.count > 0, `category ${c.id} non-empty`);
assert(categories.reduce((s, c) => s + c.count, 0) === 165, 'category counts sum to 165');
assert(!categories.some((c) => /اللأجهزة/.test(c.name.ar)), 'typo fixed');

// ---------------------------------------------------------------- config.json
const config = {
  siteName: 'GameBoss Q8',
  origin: 'https://oalsoos13-crypto.github.io',
  base: '/gamebossq8-store/',
  year: 2026,
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
  indexable: true,
  themeColor: '#F5F5F7',
  contact: {
    whatsapp: '96597937556',
    phone: '+96597937556',
    phoneDisplay: '+965 9793 7556',
    instagram: 'https://www.instagram.com/game_bossq8/',
    tiktok: 'https://www.tiktok.com/@gamebossq8',
  },
  delivery: { feeFils: 1500, freeOverFils: 25000, confirmed: false },
  payments: ['cod', 'knet_link'],
  governorates: ['capital', 'hawalli', 'farwaniya', 'ahmadi', 'jahra', 'mubarak'],
  analytics: { provider: null, code: null },
  trustBrands: ['PIVA', 'HyperX', 'Plextone', 'MEMO', 'RedMagic'],
  imageHosts: ['https://gamebossq8.com'],
  clientI18n: ['common', 'a11y', 'price', 'stock', 'nav'],
  storagePrefix: 'gbq8:v2:',
};

// ---------------------------------------------------------------- i18n.json (foundation namespaces only)
// Modules own src/i18n/<module>.json with their own prefixes. Keys here: meta nav common footer a11y price stock.
const L = (ar, en) => ({ ar, en });
const i18n = {
  'meta.siteName': L('GameBoss Q8', 'GameBoss Q8'),
  'meta.titleTemplate': L('{title} | GameBoss Q8', '{title} | GameBoss Q8'),
  'meta.homeTitle': L('GameBoss Q8 | إكسسوارات ألعاب الموبايل في الكويت', 'GameBoss Q8 | Mobile Gaming Accessories in Kuwait'),
  'meta.homeDesc': L('إكسسوارات ألعاب الموبايل في الكويت: يدات تحكم، شفتات، مراوح تبريد، وصلات وسماعات. اطلب بسهولة عبر واتساب وادفع كاش عند الاستلام.',
    'Mobile gaming accessories in Kuwait: controllers, triggers, cooling fans, adapters and headsets. Order easily on WhatsApp and pay cash on delivery.'),
  'meta.tagline': L('إكسسوارات ألعاب الموبايل في الكويت', 'Mobile gaming accessories in Kuwait'),
  'meta.ogImageAlt': L('GameBoss Q8 — إكسسوارات الألعاب', 'GameBoss Q8 — Gaming accessories'),

  'nav.skip': L('تخطَّ إلى المحتوى', 'Skip to content'),
  'nav.homeLabel': L('GameBoss Q8 — الرئيسية', 'GameBoss Q8 — Home'),
  'nav.main': L('التنقل الرئيسي', 'Main navigation'),
  'nav.tabbar': L('التنقل السريع', 'Quick navigation'),
  'nav.home': L('الرئيسية', 'Home'),
  'nav.categories': L('الأقسام', 'Categories'),
  'nav.allCategories': L('كل الأقسام', 'All categories'),
  'nav.search': L('بحث', 'Search'),
  'nav.searchPlaceholder': L('ابحث عن يد، شفتات، مروحة، أدبتر…', 'Search controllers, triggers, fans, adapters…'),
  'nav.searchSubmit': L('ابحث', 'Search'),
  'nav.wishlist': L('المفضلة', 'Wishlist'),
  'nav.cart': L('السلة', 'Cart'),
  'nav.whatsapp': L('واتساب', 'WhatsApp'),
  'nav.chatWhatsapp': L('راسلنا على واتساب', 'Chat with us on WhatsApp'),
  'nav.switchLang': L('English', 'العربية'),
  'nav.switchLangShort': L('EN', 'عربي'),
  'nav.info': L('معلومات المتجر', 'Store info'),

  'common.close': L('إغلاق', 'Close'),
  'common.closeCart': L('إغلاق السلة', 'Close cart'),
  'common.closeSearch': L('إغلاق البحث', 'Close search'),
  'common.closeMenu': L('إغلاق قائمة الأقسام', 'Close categories menu'),
  'common.cartTitle': L('سلة المشتريات', 'Your cart'),
  'common.searchTitle': L('البحث في المتجر', 'Search the store'),
  'common.menuTitle': L('الأقسام', 'Categories'),
  'common.viewAll': L('شاهد الكل', 'View all'),
  'common.viewAllN': L('شاهد الكل ({n})', 'View all ({n})'),
  'common.addToCart': L('أضف للسلة', 'Add to cart'),
  'common.addedToCart': L('أُضيف إلى السلة ✓', 'Added to cart ✓'),
  'common.viewCart': L('عرض السلة', 'View cart'),
  'common.notifyMe': L('بلّغني لما يتوفر', 'Notify me when available'),
  'common.notifyMeShort': L('بلّغني', 'Notify me'),
  'common.notifyMsg': L('مرحباً، أودّ أن تبلغوني عند توفّر: {name} [#{id}]\n{url}', 'Hi, please let me know when this is back in stock: {name} [#{id}]\n{url}'),
  'common.waGreeting': L('مرحباً GameBoss Q8 👋', 'Hi GameBoss Q8 👋'),
  'common.wishAdded': L('أُضيف إلى المفضلة ♡', 'Saved to wishlist ♡'),
  'common.wishRemoved': L('أُزيل من المفضلة', 'Removed from wishlist'),
  'common.noImage': L('الصورة قريباً', 'Image coming soon'),
  'common.loading': L('جاري التحميل…', 'Loading…'),
  'common.error': L('حدث خطأ غير متوقع، يُرجى المحاولة مرة أخرى', 'Something went wrong, please try again'),
  'common.retry': L('أعد المحاولة', 'Try again'),
  'common.currency': L('د.ك', 'KWD'),
  'common.backHome': L('العودة إلى الرئيسية', 'Back to home'),
  'common.priceUpdated': L('تحدّث سعر بعض المنتجات في سلتك', 'Some prices in your cart have been updated'),
  'common.dismiss': L('إخفاء', 'Dismiss'),
  'common.qty': L('الكمية', 'Quantity'),
  'common.unavailable': L('غير متوفر حالياً', 'Currently unavailable'),
  'common.storageOff': L('التخزين معطّل في متصفحك، لذلك لن تُحفظ السلة بعد إغلاق الصفحة.', 'Storage is disabled in your browser, so your cart won’t be saved after you leave.'),
  'common.products': L(
    { zero: 'لا توجد منتجات', one: 'منتج واحد', two: 'منتجان', few: '{n} منتجات', many: '{n} منتجاً', other: '{n} منتج' },
    { one: '1 product', other: '{n} products' }),

  'price.now': L('السعر', 'Price'),
  'price.was': L('السعر قبل', 'Was'),
  'price.save': L('وفّر {amount}', 'Save {amount}'),
  'price.off': L('-{pct}%', '-{pct}%'),
  'price.offLabel': L('خصم {pct}%', '{pct}% off'),

  'stock.in_stock': L('متوفر', 'In stock'),
  'stock.out_of_stock': L('نفدت الكمية', 'Out of stock'),
  'stock.backorder': L('طلب مسبق', 'Pre-order'),
  'stock.new': L('جديد', 'New'),

  'a11y.addToCart': L('أضف {name} إلى السلة', 'Add {name} to cart'),
  'a11y.wishAdd': L('أضف {name} إلى المفضلة', 'Add {name} to wishlist'),
  'a11y.wishRemove': L('أزل {name} من المفضلة', 'Remove {name} from wishlist'),
  'a11y.notify': L('بلّغني لما يتوفر {name}', 'Notify me when {name} is available'),
  'a11y.cartCount': L(
    { zero: 'السلة فارغة', one: 'السلة، فيها منتج واحد', two: 'السلة، فيها منتجان', few: 'السلة، فيها {n} منتجات', many: 'السلة، فيها {n} منتجاً', other: 'السلة، فيها {n} منتج' },
    { one: 'Cart, 1 item', other: 'Cart, {n} items' }),
  'a11y.wishCount': L(
    { zero: 'المفضلة فارغة', one: 'المفضلة، فيها منتج واحد', two: 'المفضلة، فيها منتجان', few: 'المفضلة، فيها {n} منتجات', many: 'المفضلة، فيها {n} منتجاً', other: 'المفضلة، فيها {n} منتج' },
    { zero: 'Wishlist, empty', one: 'Wishlist, 1 item', other: 'Wishlist, {n} items' }),
  'a11y.breadcrumb': L('مسار التنقل', 'Breadcrumb'),
  'a11y.newTab': L('(يفتح في نافذة جديدة)', '(opens in a new tab)'),
  'a11y.seeAllCat': L('شاهد كل منتجات {cat}', 'See all {cat}'),
  'a11y.scrollPrev': L('السابق', 'Previous'),
  'a11y.scrollNext': L('التالي', 'Next'),

  'footer.about': L('متجر كويتي لإكسسوارات ألعاب الموبايل والآيباد: يدات تحكم، شفتات، مراوح تبريد، وصلات وسماعات. اطلب عبر واتساب ونوصل طلبك داخل الكويت.',
    'A Kuwaiti store for mobile and iPad gaming accessories: controllers, triggers, cooling fans, adapters and headsets. Order on WhatsApp, delivered within Kuwait.'),
  'footer.categories': L('الأقسام', 'Categories'),
  'footer.help': L('المساعدة', 'Help'),
  'footer.contact': L('تواصل معنا', 'Contact'),
  'footer.howToOrder': L('طريقة الطلب', 'How to order'),
  'footer.deliveryPayment': L('التوصيل والدفع', 'Delivery & payment'),
  'footer.returns': L('الاستبدال والإرجاع', 'Returns & exchanges'),
  'footer.aboutUs': L('من نحن', 'About us'),
  'footer.privacy': L('الخصوصية', 'Privacy'),
  'footer.whatsapp': L('واتساب', 'WhatsApp'),
  'footer.call': L('اتصل بنا', 'Call us'),
  'footer.instagram': L('انستقرام', 'Instagram'),
  'footer.tiktok': L('تيك توك', 'TikTok'),
  'footer.language': L('اللغة', 'Language'),
  'footer.rights': L('© {year} GameBoss Q8. جميع الحقوق محفوظة.', '© {year} GameBoss Q8. All rights reserved.'),
  'footer.madeIn': L('صُنع في الكويت لعشّاق الألعاب', 'Made in Kuwait for gamers'),
};
for (const [k, v] of Object.entries(i18n)) assert(v.ar && v.en, `i18n ${k} has ar+en`);

// ---------------------------------------------------------------- legacy id map (v1 row id → WC id)
// Only rows whose WooCommerce id survives in the v2 catalog (English twins / unpublished are dropped).
const rowMap = readJson(path.join(AUDIT, 'ops_rowid_to_wcid.json'));
const legacy = Object.entries(rowMap).filter(([, wc]) => ids.has(String(wc))).map(([row, wc]) => `${row}:${wc}`).join(',');

// ---------------------------------------------------------------- write
writeJson(path.join(DATA, 'config.json'), config);
writeJson(path.join(DATA, 'catalog.json'), products);
writeJson(path.join(DATA, 'categories.json'), categories);
writeJson(path.join(DATA, 'i18n.json'), i18n);

const summary = {
  products: products.length,
  categories: categories.length,
  inStock: products.filter((p) => p.availability === 'in_stock').length,
  outOfStock: products.filter((p) => p.availability === 'out_of_stock').length,
  backorder: products.filter((p) => p.availability === 'backorder').length,
  onSale: products.filter((p) => p.compareAtFils).length,
  featured: products.filter((p) => p.featured).length,
  withImages: products.filter((p) => p.images.length).length,
  descEn: products.filter((p) => p.description.en).length,
  i18nKeys: Object.keys(i18n).length,
  legacyPairs: legacy.split(',').length,
  counts: Object.fromEntries(categories.map((c) => [c.id, c.count])),
};
console.log(JSON.stringify(summary));
console.log('LEGACY_MAP=' + legacy);
