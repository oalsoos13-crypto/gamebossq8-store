#!/usr/bin/env node
// tools/import-csv.mjs — re-import a WooCommerce product export into data/catalog.json (zero dependencies).
//
//   node tools/import-csv.mjs <woocommerce-export.csv> [options]
//
//   --catalog <file>      catalog to merge into (default: data/catalog.json)
//   --dry-run             print the diff summary, write nothing
//   --check               like --dry-run, but exit with code 1 when anything would change (CI / verification)
//   --keep-removed        products missing from the CSV (deleted or unpublished in WooCommerce) are kept and
//                         marked out_of_stock instead of being removed — their links keep working
//   --take-csv <fields>   comma list of normally-preserved fields to overwrite from the CSV for EXISTING
//                         products: featured, category, name-en, description-en
//   --report <file>       also write the full diff as JSON
//   --anomalies <file>    write data-quality findings (twin price conflicts, products without images, …) as JSON
//   --quiet               only print the one-line summary
//
// What it does (same pipeline as the audit's build_clean.py + tools/prepare-data.mjs, ported to Node):
//   1. Parse the CSV (RFC 4180, BOM, ragged rows, Arabic or English WordPress headers, decimal commas).
//   2. Separate the machine-translated English "twin" rows from the real Arabic products and pair them by image
//      sets (twins are never products; they only seed the English description of NEW products).
//   3. Drop unpublished rows. Clean names (typo table, Latin digits), descriptions (HTML → plain text with "• "
//      bullets), brands (normalised; the product title wins over a wrong attribute), images (deduped, URL-encoded;
//      a product with no gallery uses images from its description when they are hosted on gamebossq8.com).
//      Price = sale price when set, else regular; compareAt = regular only when on sale. All money in fils.
//   4. MERGE into data/catalog.json by WooCommerce id:
//        from the CSV  : name.ar, brand, priceFils, compareAtFils, images (mirrored ones stay local, see
//                        mirror-images.mjs), description.ar, availability
//        preserved     : id, slug (immutable — it is the public URL), name.en, description.en, featured, sort,
//                        category + categories (manual moves survive). Use --take-csv to overwrite some of them.
//        recomputed    : isNew = the 12 highest WooCommerce ids.
//        new products  : English name from the override table or a generated one, unique ASCII slug,
//                        sort placed before every existing product (newest first), featured from the CSV.
//   5. Validate (same asserts as the build) and print a diff summary. Writes only when something changed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ============================================================================ CSV
export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

// logical field → accepted header spellings (WordPress in Arabic or English)
const COLS = {
  id: ['المعرف', 'ID'], type: ['النوع', 'Type'], name: ['الاسم', 'Name'], published: ['تم النشر', 'Published'],
  featured: ['هل هي مميزة؟', 'Is featured?'], short: ['وصف قصير', 'Short description'], long: ['الوصف', 'Description'],
  instock: ['متوفر؟', 'In stock?'], sale: ['سعر التخفيض', 'Sale price'], regular: ['السعر الافتراضي', 'Regular price'],
  cats: ['التصنيفات', 'Categories'], images: ['الصور', 'Images'], sku: ['رمز المنتج (SKU)', 'SKU'],
  attrName: ['اسم السمة 1', 'Attribute 1 name'], attrVal: ['قيمة/قيم السمة 1', 'Attribute 1 value(s)'],
};
const REQUIRED = ['id', 'name', 'published', 'regular', 'sale', 'instock', 'images', 'cats'];

export function readRows(text) {
  const [hdr, ...rows] = parseCSV(text);
  if (!hdr) throw new Error('CSV is empty');
  const idx = {};
  for (const [k, names] of Object.entries(COLS)) idx[k] = hdr.findIndex((h) => names.includes(h.trim()));
  const missing = REQUIRED.filter((k) => idx[k] < 0);
  if (missing.length) throw new Error(`CSV is missing columns: ${missing.map((k) => COLS[k].join(' / ')).join(', ')} — is this a WooCommerce product export?`);
  const get = (r, k) => (idx[k] >= 0 && idx[k] < r.length ? r[idx[k]] : '');
  return rows.map((r, i) => {
    const attrName = get(r, 'attrName').trim();
    return {
      line: i + 2,
      id: get(r, 'id').trim(),
      type: get(r, 'type').trim(),
      name: get(r, 'name'),
      published: get(r, 'published').trim(),
      featured: get(r, 'featured').trim() === '1',
      short: get(r, 'short'),
      long: get(r, 'long'),
      instock: get(r, 'instock').trim(),
      sale: get(r, 'sale'),
      regular: get(r, 'regular'),
      cats: get(r, 'cats').split(',').map((s) => s.trim()).filter(Boolean),
      imagesRaw: get(r, 'images'),
      // attribute 1 holds the brand ("الماركة"); ignore it if the shop ever uses attribute 1 for something else
      brandAttr: !attrName || /الماركة|ماركة|brand/i.test(attrName) ? get(r, 'attrVal').trim() : '',
    };
  });
}

// ============================================================================ helpers (Python parity)
const AR = /[\u0600-\u06FF]/;
// Python str.strip() whitespace set (differs from JS trim on \x1c-\x1f, \x85, \uFEFF)
const PY_WS = '\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PY_STRIP = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, 'g');
const pyStrip = (s) => String(s).replace(PY_STRIP, '');
const collapse = (s) => pyStrip(String(s).replace(new RegExp(`[${PY_WS}]+`, 'g'), ' '));
const num = (s) => { s = pyStrip(s || '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace('٫', '.').replace(',', '.'); return s === '' || Number.isNaN(Number(s)) ? null : Math.round(Number(s) * 1000) / 1000; };
const toFils = (kwd) => Math.round(Number(kwd) * 1000);
const latinDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6F0));
const tidy = (s) => String(s).replace(/\s+/g, ' ').trim();
function encodeUrl(u) { try { return encodeURI(decodeURI(u)); } catch { return encodeURI(u); } }
const uniq = (a) => [...new Set(a)];
const imgs = (d) => uniq(d.imagesRaw.split(',').map((u) => pyStrip(u)).filter(Boolean));

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', times: '×', deg: '°', copy: '©', reg: '®', trade: '™', zwnj: '\u200c', zwj: '\u200d', rlm: '\u200f', lrm: '\u200e' };
function unescapeHtml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, e) => {
    if (e[0] === '#') { const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(cp); } catch { return m; } }
    const v = ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

// ============================================================================ categories
export const RAW2CANON = {
  'الوصلات و الشواحن': 'cable', 'مراوح تبريد الموبايل و الايباد': 'fan', 'كفرات': 'case', 'السماعات': 'headset',
  'يدات الموبايل': 'mobile', 'يدات الايباد والتابلت': 'tablet', 'ازرار و شفتات': 'trigger', 'قفازات': 'glove',
  'ستاندات': 'stand', 'الشنط': 'bag', 'اكسسوارات': 'accessory', 'اللأجهزة': 'device', 'الأجهزة': 'device',
  // English strings used by the translation plugin rows
  'Connectors and Chargers': 'cable', 'Cooling fans for mobile and iPad': 'fan', 'Covers': 'case', 'Headphones': 'headset',
  'Mobile hands': 'mobile', 'IPad and tablet hands': 'tablet', 'Buttons and flanges': 'trigger', 'Gloves': 'glove', 'Stands': 'stand',
};
const EN_CATS = new Set(['Connectors and Chargers', 'Cooling fans for mobile and iPad', 'Covers', 'Headphones', 'Mobile hands', 'IPad and tablet hands', 'Buttons and flanges', 'Gloves', 'Stands']);

// ============================================================================ descriptions
export function cleanDesc(raw) {
  if (!raw || !pyStrip(raw)) return [null, []];
  let s = raw.replace(/\r/g, '').split('\\n').join('\n');
  const pics = [...s.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1]);
  s = s.replace(/<img[^>]*>/gi, '');
  s = s.replace(/<\s*li[^>]*>/gi, '\n• ');
  s = s.replace(/<\s*br\s*\/?>/gi, '\n');
  s = s.replace(/<\/\s*(p|li|ul|ol|h\d|div)\s*>/gi, '\n');
  s = s.replace(/<\s*(p|h\d|div|ul|ol)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = unescapeHtml(s).replace(/\u00a0/g, ' ');
  const lines = s.split('\n').map((l) => pyStrip(l.replace(/[ \t]+/g, ' ')));
  const out = []; let blank = false;
  for (const l of lines) {
    if (l === '' || l === '•') { blank = out.length > 0; continue; }
    if (blank && out.length && !(l.startsWith('•') && out[out.length - 1].startsWith('•'))) out.push('');
    out.push(l); blank = false;
  }
  const txt = pyStrip(out.join('\n'));
  return [txt || null, pics];
}
function bestDesc(d) {
  const [longT, p1] = cleanDesc(d.long);
  const [shortT, p2] = cleanDesc(d.short);
  let txt;
  if (longT && shortT && !longT.includes(shortT) && !shortT.includes(longT)) txt = shortT + '\n\n' + longT;
  else txt = longT && (!shortT || longT.length >= shortT.length) ? longT : shortT;
  return [txt, uniq([...p1, ...p2])];
}

// ============================================================================ brands
const BRAND_NORM = { PIVA: 'PIVA', Plextone: 'Plextone', Memo: 'MEMO', Redmagic: 'RedMagic', Ugreen: 'UGREEN', Flydigi: 'Flydigi', Hyperx: 'HyperX', GamebossQ8: 'GameBoss Q8', Gamesir: 'GameSir', Sarafox: 'Sarafox', JSAUS: 'JSAUS', Other: null, '': null };
const BRAND_IN_NAME = [
  [/بيفا|piva/i, 'PIVA'], [/بلكستون|بليكستون|plextone/i, 'Plextone'], [/ميمو|memo/i, 'MEMO'],
  [/ريد ?ماج|ردمجيك|ريد مجيك|red ?magic/i, 'RedMagic'], [/يوقرين|ugreen/i, 'UGREEN'],
  [/فلاي ?دي ?جي|فلاي ديجي|flydigi/i, 'Flydigi'], [/هايبر ?اكس|هايبراكس|هايبركس|hyper ?x/i, 'HyperX'],
  [/جيم بوس/i, 'GameBoss Q8'], [/جيم ?سير|جيمسر|gamesir/i, 'GameSir'], [/فايرفوكس/i, 'Sarafox'], [/jsaus/i, 'JSAUS'],
];
function brandOf(d) {
  const a = d.brandAttr;
  const attr = a in BRAND_NORM ? BRAND_NORM[a] : (a || null);
  const inName = (BRAND_IN_NAME.find(([rx]) => rx.test(d.name)) || [])[1] || null;
  return { attr, inName, brand: attr && inName && attr !== inName ? inName : (attr || inName) };
}

// ============================================================================ English names & slugs (for NEW products)
const TYPE_WORDS = [
  [/شاشة حماية/, 'Screen Protector'], [/حماية الساموراي/, 'Samurai Screen Protector'],
  [/كرت (ال)?صوت/, 'Sound Card Adapter'], [/قطعة العقرب/, 'Scorpion Keyboard & Mouse Adapter'],
  [/قطعة معدنية/, 'Magnetic Metal Plate'], [/علاقة/, 'Keychain'], [/كيب ورد|للكيبورد/, 'Keyboard'],
  [/ماوس/, 'Gaming Mouse'], [/مايك/, 'Microphone'], [/جهاز .*اللوحي/, 'Gaming Tablet'],
  [/^عرض/, 'Bundle'], [/شنطة/, 'Bag'], [/ستاند|استاند/, 'Stand'],
  [/كفر|حماية سيليكون/, 'Case'], [/مسك/, 'Grip'],
  [/مروحة|مروجة|تبريد|بريد/, 'Cooling Fan'], [/سماعة/, 'Headset'], [/قفاز|جلفز/, 'Finger Sleeves'],
  [/يدة|يد تحكم|^يد /, 'Controller'], [/ازرار|تريجر|شفتات/, 'Triggers'],
  [/كيبيل|كيبل/, 'Cable'], [/ادبتر|ادابتر|أدبتر|وصلة|توصيلة|كوع/, 'Adapter'],
  [/شاحن|شحن/, 'Charger'],
];
const W = '[\\p{L}\\p{N}_]'; // Python's Unicode \w for the \b boundaries below
const MOD_WORDS = [
  [/للايباد|الايباد|ايباد|لايباد/, 'iPad'], [/التابلت|التابليت/, 'Tablet'], [/للموبايل|موبايل|للهواتف/, 'Mobile'],
  [/للايفون|ايفون/, 'iPhone'], [/لاب ?توب|للاب/, 'Laptop'], [/للسويتش/, 'Switch'],
  [/(\d+)\s*اصابع/, '\\1-Finger'], [/اربع اصابع/, '4-Finger'], [/اصبعين/, '2-Finger'], [/يد كاملة/, 'Full-Hand'],
  [/(\d+)\s*منافذ/, '\\1-Port'], [/ثلاث منافذ/, '3-Port'], [/اربع منافذ/, '4-Port'],
  [/(\d+)\s*واط/, '\\1W'], [/(\d+)"?\s*انش/, '\\1-inch'], [/(\d+)\s*متر/, '\\1m'],
  [/مغناطيسي|مغناطسية|معناطيسية/, 'Magnetic'], [/مائي/, 'Liquid'], [/وايرليس/, 'Wireless'],
  [/تيربو/, 'Turbo'], [/البرو|برو/, 'Pro'], [/ماكس/, 'Max'], [/نوفا/, 'Nova'], [/كلاود ?3/, 'Cloud III'],
  [/كلاود ?2/, 'Cloud II'], [/ويسب/, 'Wasp'], [/فيدر/, 'Vader'], [/فالكون/, 'Falcon'], [/ستنغر ليزر/, 'Stinger Laser'],
  [/ايثرنت|انترنت/, 'Ethernet'], [/ميل\/فيميل/, 'Male-Female'], [/كوع/, 'Elbow'], [/قصيرة/, 'Short'],
  [/كيبيل طويل/, 'Long Cable'], [/تطويل/, 'Extension'], [/سلكون|سيليكون/, 'Silicone'], [/جايروسكوب/, 'Gyroscope'],
  [/رابل|ربل/, 'Rubber'], [/اضاءة|ار جي بي/, 'RGB'], [/ريموت/, 'Remote'], [/جمجمة/, 'Skull'],
  [/للبثوث|بث مباشر/, 'Streaming'], [/متنقل/, 'Power'], [new RegExp(`(?<!${W})سلك(?!${W})`, 'u'), 'Wired'], [/الاصدار الرابع/, 'V4'],
  [/الاصدار الجديد/, 'New'], [/يد واحد/, 'One-Handed'], [/المهام/, 'Multi-Purpose'], [/للتنقل/, 'Travel'],
  [/بعدة جيب/, 'Multi-Pocket'], [/سارة/, 'Sara'], [/نيشان|Nishan/, 'Nishan'], [/اكسبيريا/, 'Xperia'],
  [/لايتننج|لتنينج|اللايتننق/, 'Lightning'], [/ايواكس/, 'AUX'], [/تايب سي/, 'Type-C'],
];
// hand-reviewed English names (from the audit); used only when a product is added for the first time
export const EN_OVERRIDE = {
  10754: 'Plextone EX1 Cooling Fan', 10930: 'UGREEN USB to Ethernet Adapter', 10948: 'Stinger Laser Mobile Triggers',
  11623: 'Ghost Rider Skull Keychain', 11982: 'Magnetic Metal Plate for Cooling Fans', 12561: 'GameBoss Bundle 1 (Case + Screen Protector + Gloves)',
  12628: 'RedMagic Nova Gaming Tablet 10.9" 12GB/256GB Wi-Fi', 12638: 'Scorpion Pro 2 Keyboard & Mouse Adapter 8-Port Ethernet',
  12645: 'Scorpion 2 Keyboard & Mouse Adapter 6-Port', 12864: 'Pro Gaming Stand', 12878: 'New 8-Finger Controller (6 Grip)',
  13086: 'iPhone 30W Gaming Charger', 13094: 'AUX to Lightning Adapter (iPhone)', 13141: 'Elbow Adapter for Mobile & iPad',
  13396: 'GameBoss Q8 Samurai Screen Protector', 13360: 'Gaming Mouse (Basic)', 13390: 'Gaming Mouse',
  12422: 'PIVA iPad M4 11-inch Case with Type-C Adapter & Fan Mount', 12414: 'PIVA iPad M4 Case with Type-C Adapter',
  12489: 'GameBoss GBC-100 iPad 11-inch M4 2024 Case', 12500: 'GameBoss GBC-100 iPad 11-inch M2 Case',
  12250: 'Sarafox iPad M4 2024 11-inch Case', 12253: 'Sarafox iPad M4 2024 13-inch Case', 11770: 'Plextone RX3 Pro AUX Headset',
  11761: 'Plextone RX3 Pro Type-C Headset', 13321: 'Plextone M7 Headset with Charging Port', 13329: 'PIVA G510 Sound Card Adapter',
  13338: 'HyperX Cirro Buds Pro', 13350: 'PIVA U100 & A100 Headset', 12545: 'HyperX Earbuds 2 Wired', 10923: 'HyperX Cloud Earbuds Wired',
  10805: 'HyperX Cloud III Headset', 10915: 'HyperX Cloud II Headset', 12512: 'Flydigi Cyberfox X1 Gaming Headset',
  10884: 'Flydigi Wasp 2 Controller', 10877: 'Flydigi Vader 2 Pro Controller', 10815: 'GameSir F2 Triggers',
  12906: 'GameSir F2 Triggers with Handle', 10942: 'GameSir F4 Falcon Controller', 11778: 'GameSir F7 iPad Controller',
  10828: 'PIVA BR5 Max iPad Cooling Fan', 10736: 'PIVA DS5 Adapter', 10748: 'PIVA Type-C Elbow Connector',
  12063: 'PIVA Type-C Elbow Connector (Short)', 10765: 'PIVA iPad Case with Built-in Type-C Adapter',
  13121: 'Plextone 6in1 Pro Adapter (Long Cable)', 13217: 'Plextone GS5 Adapter', 13225: 'Plextone GS1 2in1 Adapter',
  10795: 'Plextone GS1 Elbow Adapter', 10856: 'Plextone GS2 Adapter', 10938: 'Plextone Tablet Stand', 13180: 'PIVA B2 Max Cooling Fan',
  13194: 'PIVA B21 Cooling Fan', 13206: 'PIVA HB5 Pro Cooling Fan', 13421: 'PIVA VD03 Live-Streaming Capture Adapter',
  13433: 'MEMO ZH10 Keyboard & Mouse Adapter', 13411: 'MEMO DL-100 Controller with Cooling Fan', 12833: 'JSAUS 12in1 RGB Adapter',
  11873: 'MEMO Triggers with Cooling Fan', 12211: 'RedMagic 5 Pro 36W Cooling Fan', 12050: 'PIVA Case for Cooling Fans',
  11943: 'MEMO 6-Finger Mobile Controller with Cooling Fan', 12078: 'Lightning to Ethernet & Charging Adapter (iPhone)',
  13136: 'Mobile 4-Grip Triggers (6-Finger Play)', 13077: 'Mobile Turbo Triggers (4 Speeds)', 13405: 'iPad 12.9 Rubber Grips',
  13167: 'Plextone Type-C to Type-C 66W Gaming Cable', 13175: 'Plextone USB to Type-C 66W Gaming Cable',
  13100: 'PIVA Type-C to Type-C 100W Gaming Cable', 13114: 'PIVA Type-C to Type-C 240W Gaming Cable',
  12652: 'PIVA iPhone 13/14/15 Pro Max Gaming Case', 12338: 'Xperia MG-2S Headset', 13294: 'Sara Liquid Cooling Fan (Cooling + Charging)',
  10892: 'MEMO 4-Button iPad & Tablet Triggers', 13381: 'Gaming Keyboard', 13369: 'One-Handed Gaming Keyboard',
  12820: 'PIVA Elbow Adapter with Grip', 13303: 'PIVA X41 Audio Adapter',
};
function latinTokens(name) {
  const out = [];
  for (let t of name.match(/[A-Za-z0-9][A-Za-z0-9.+\-/]*/g) || []) {
    t = t.replace(/^[-/.]+|[-/.]+$/g, '');
    if (!t || ['w', 'c', 'tybe', 'of', 'from', 'with'].includes(t.toLowerCase())) continue;
    out.push(t);
  }
  return out;
}
export function suggestEn(rawName, brand) {
  const name = rawName.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
  const typ = (TYPE_WORDS.find(([rx]) => rx.test(name)) || [])[1] || null;
  let mods = [];
  for (const [rx, rep] of MOD_WORDS) {
    const m = name.match(rx);
    if (!m) continue;
    const v = rep.includes('\\') ? rep.replace(/\\(\d)/g, (_, n) => m[n] || '') : rep;
    if (!mods.includes(v)) mods.push(v);
  }
  let lat = latinTokens(name.replace(/\d+(\.\d+)?"?\s*(اصابع|واط|منافذ|متر|انش|سرعات|ازرار)/g, ' '));
  if (/\d+\s*(اصابع|واط|منافذ|متر|انش)/.test(name)) lat = lat.filter((t) => !/^\d+$/.test(t) || t === '2');
  const parts = [];
  if (brand) parts.push(brand);
  for (const t of lat) {
    if (brand && brand.toLowerCase().replace(/ /g, '').includes(t.toLowerCase().replace(/ /g, ''))) continue;
    if (parts.some((p) => p.toLowerCase() === t.toLowerCase())) continue;
    parts.push(t);
  }
  const low = parts.join(' ').toLowerCase();
  mods = mods.filter((m) => !low.includes(m.toLowerCase()));
  const LEAD = ['Pro', 'Max', 'Turbo', 'Nova'];
  if (typ && !low.includes(typ.toLowerCase())) {
    parts.push(...mods.filter((m) => LEAD.includes(m)), ...mods.filter((m) => !LEAD.includes(m)), typ);
  } else parts.push(...mods);
  return collapse(parts.join(' ')) || null;
}
export function slugify(s) {
  s = s.toLowerCase().replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/"/g, '');
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  return s.slice(0, 70).replace(/-+$/, '');
}

// ============================================================================ v2 data-layer fixes (same as prepare-data)
const NAME_AR_FIX = {
  10754: [['مروجة', 'مروحة']], 13194: [['بريد', 'تبريد']], 13321: [['مفذ', 'منفذ']], 11521: [['معناطيسية', 'مغناطيسية']],
  11529: [['مغناطسية', 'مغناطيسية']], 10938: [['للأجهزةاللوحية', 'للأجهزة اللوحية']], 13338: [['Hypex', 'HyperX']], 11770: [[' (نسخة)', '']],
};
// full replacements, applied ONLY while WooCommerce still has the original (messy) title
const NAME_AR_SET = {
  12628: ['جهاز ريد ماجيك اللوحي نوفا 10 - 2024 256 جيجا, 12 جيجا رام, 10.9 بوصة ,واي فاي, الاصدار العالمي – ميدنايت',
    'جهاز ريد ماجيك اللوحي نوفا (2024) — 10.9 بوصة، 12 جيجا رام، 256 جيجا، واي فاي، الإصدار العالمي، ميدنايت'],
  12906: ['F2 Gamesir with Handle', 'شفتات جيم سير F2 مع مقبض'],
};
const DESC_AR_FIX = { 10736: [[/tybe c/gi, 'type-c']] };
const JUNK_EN = [
  /60ww/i, /screw headphones/i, /agency/i, /trigrat/i, /rdmagic/i, /\bplexton\b/i, /fly digi/i,
  /contents of the can/i, /harass/i, /wall camera/i, /acoustics/i, /cita poles/i, /wisp2/i,
  /beer/i, /notable people/i, /hyperrexer/i, /\bdelivery\b\s*$/im, /hand controller/i,
  /closed posteriorly/i, /stand ipads/i, /glove memo/i, /cover piva/i,
];
function cleanEnDesc(s) {
  if (!s) return null;
  const t = String(s).replace(/\r/g, '').trim();
  if (t.length < 40 || /[؀-ۿ٠-٩]/.test(t) || JUNK_EN.some((re) => re.test(t))) return null;
  return t;
}
const AVAIL = { 1: 'in_stock', 0: 'out_of_stock', backorder: 'backorder' };

// ============================================================================ pipeline: CSV rows → clean products
export function buildFromRows(R) {
  const problems = [];   // fatal row problems (reported, row skipped)
  const notes = [];      // non-fatal observations
  const enIds = R.filter((d) => d.cats.some((c) => EN_CATS.has(c))).map((d) => Number(d.id));
  const lo = enIds.length ? Math.min(...enIds) : Infinity, hi = enIds.length ? Math.max(...enIds) : -Infinity;
  const isEn = (d) => d.cats.some((c) => EN_CATS.has(c)) || (Number(d.id) >= lo && Number(d.id) <= hi && !AR.test(d.name + d.short + d.long));
  const EN = R.filter(isEn), ARR = R.filter((d) => !isEn(d));

  // pair English twins → Arabic products by image-set similarity
  const jacc = (a, b) => { const A = new Set(a), B = new Set(b); const u = new Set([...A, ...B]); let i = 0; for (const x of A) if (B.has(x)) i++; return u.size ? i / u.size : 0; };
  const shared = (a, b) => { const B = new Set(b); return [...new Set(a)].filter((x) => B.has(x)).length; };
  const cand = new Map();
  for (const e of EN) {
    const ei = imgs(e);
    cand.set(e.id, ARR.map((a) => [jacc(ei, imgs(a)), shared(ei, imgs(a)), a]).sort((x, y) => (y[0] - x[0]) || (y[1] - x[1])).slice(0, 3));
  }
  const pairs = new Map(), used = new Set(), secondary = [], unpaired = [];
  for (const e of [...EN].sort((x, y) => (cand.get(y.id)[0]?.[0] || 0) - (cand.get(x.id)[0]?.[0] || 0))) {
    const top = cand.get(e.id)[0]; if (!top) continue;
    const [s, , a] = top;
    let rule = null;
    if (s >= 0.5) rule = 'image_jaccard>=0.5';
    else if (imgs(e).length && imgs(a).length && imgs(e)[0] === imgs(a)[0] && num(e.regular) === num(a.regular)) rule = 'same_first_image+same_price';
    if (rule && !used.has(a.id)) { pairs.set(e.id, { en: e, ar: a, rule, jaccard: Math.round(s * 100) / 100 }); used.add(a.id); }
  }
  for (const e of EN) {
    if (pairs.has(e.id)) continue;
    const top = cand.get(e.id)[0];
    if (top && top[1] >= 2) secondary.push({ en_id: e.id, ar_id: top[2].id }); else unpaired.push(e.id);
  }
  const twinOf = new Map([...pairs.values()].map((p) => [p.ar.id, p.en]));

  const products = [], unpublished = [], twinPriceConflicts = [], brandConflicts = [];
  for (const d of ARR) {
    if (d.published !== '1') { unpublished.push({ id: d.id, name: collapse(d.name), published: d.published }); continue; }
    if (!/^\d+$/.test(d.id)) { problems.push(`line ${d.line}: missing/invalid ID "${d.id}"`); continue; }
    if (d.type && !['simple', 'بسيط'].includes(d.type)) notes.push(`line ${d.line} (#${d.id}): product type "${d.type}" — imported as a simple product`);
    const reg = num(d.regular), sale = num(d.sale);
    const [price, compare] = sale !== null ? [sale, reg] : [reg, null];
    if (price === null || !(price > 0)) { problems.push(`line ${d.line} (#${d.id} ${collapse(d.name)}): no valid price — skipped`); continue; }
    const canon = [];
    for (const c of d.cats) {
      if (RAW2CANON[c]) canon.push(RAW2CANON[c]);
      else notes.push(`line ${d.line} (#${d.id}): unknown WooCommerce category "${c}" — add it to RAW2CANON in tools/import-csv.mjs`);
    }
    const availability = AVAIL[d.instock];
    if (!availability) { problems.push(`line ${d.line} (#${d.id}): unknown stock status "${d.instock}" — skipped`); continue; }
    const [descAr, pics] = bestDesc(d);
    const twin = twinOf.get(d.id) || null;
    const { attr, inName, brand } = brandOf(d);
    if (attr && inName && attr !== inName) brandConflicts.push({ id: d.id, name: collapse(d.name), attribute: attr, title: inName });
    if (twin && (num(twin.regular) !== reg || num(twin.sale) !== sale)) {
      twinPriceConflicts.push({ id: d.id, en_id: twin.id, name: collapse(d.name), en_name: collapse(twin.name), ar: { regular: reg, sale }, en: { regular: num(twin.regular), sale: num(twin.sale) } });
    }
    products.push({
      id: Number(d.id), rawName: d.name, name_ar: collapse(d.name), brand, price, compare_at: compare,
      category: canon[0] || null, categories: uniq(canon), images: imgs(d), description_ar: descAr,
      description_en: twin ? bestDesc(twin)[0] : null, availability, featured: d.featured, description_images: pics,
      en_twin: twin ? twin.id : null,
    });
  }
  return { products, en: EN.length, pairs: pairs.size, secondary, unpaired, unpublished, twinPriceConflicts, brandConflicts, problems, notes };
}

// clean record → the CSV-owned part of a v2 product (identical to tools/prepare-data.mjs)
// url → mirrored site-relative path, from tools/mirror-images.mjs (src/static/img/p/sources.json)
let LOCAL = new Map();
export function setMirrorSources(sources) { LOCAL = new Map(Object.entries(sources || {}).map(([rel, url]) => [url, rel])); }
const localize = (u) => LOCAL.get(u) || u;

export function csvFields(c) {
  let nameAr = NAME_AR_SET[c.id] && collapse(NAME_AR_SET[c.id][0]) === c.name_ar ? NAME_AR_SET[c.id][1] : c.name_ar;
  for (const [a, b] of NAME_AR_FIX[c.id] || []) nameAr = nameAr.split(a).join(b);
  nameAr = tidy(latinDigits(nameAr));
  let descAr = c.description_ar ? latinDigits(String(c.description_ar).replace(/\r/g, '')).trim() : '';
  for (const [a, b] of DESC_AR_FIX[c.id] || []) descAr = descAr.replace(a, b);
  const priceFils = toFils(c.price);
  const compareAtFils = c.compare_at != null && toFils(c.compare_at) > priceFils ? toFils(c.compare_at) : null;
  const images = uniq(c.images.map(encodeUrl));
  if (!images.length) for (const u of c.description_images || []) if (/^https:\/\/gamebossq8\.com\//.test(u)) images.push(encodeUrl(u));
  return { nameAr, brand: c.brand || null, priceFils, compareAtFils, images: uniq(images.map(localize)), descAr: descAr || null, availability: c.availability };
}

// ============================================================================ merge
const KEY_ORDER = ['id', 'slug', 'name', 'brand', 'priceFils', 'compareAtFils', 'category', 'categories', 'images', 'description', 'availability', 'featured', 'isNew', 'sort'];
const ordered = (p) => Object.fromEntries(KEY_ORDER.map((k) => [k, p[k]]));
const TAKE = new Set(['featured', 'category', 'name-en', 'description-en']);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function merge(existing, built, { keepRemoved = false, take = new Set(), validCats = null } = {}) {
  const byId = new Map(existing.map((p) => [String(p.id), p]));
  const incoming = new Map(built.products.map((c) => [String(c.id), c]));
  const report = { added: [], removed: [], kept: [], price: [], compareAt: [], availability: [], nameAr: [], brand: [], images: [], descAr: [], featured: [], categoryHint: [], taken: [] };
  const out = [];
  const slugs = new Set(existing.map((p) => p.slug));
  let minSort = existing.reduce((m, p) => Math.min(m, p.sort), Infinity);
  if (!Number.isFinite(minSort)) minSort = 10;

  for (const p of existing) {
    const c = incoming.get(String(p.id));
    if (!c) {
      if (keepRemoved) {
        const kept = { ...p, availability: 'out_of_stock' };
        report.kept.push({ id: p.id, name: p.name.ar, was: p.availability });
        out.push(kept);
      } else report.removed.push({ id: p.id, name: p.name.ar, slug: p.slug });
      continue;
    }
    const f = csvFields(c);
    const n = structuredClone(p);
    const label = { id: p.id, name: f.nameAr };
    if (n.priceFils !== f.priceFils) report.price.push({ ...label, from: n.priceFils, to: f.priceFils });
    if (n.compareAtFils !== f.compareAtFils) report.compareAt.push({ ...label, from: n.compareAtFils, to: f.compareAtFils });
    if (n.availability !== f.availability) report.availability.push({ ...label, from: n.availability, to: f.availability });
    if (n.name.ar !== f.nameAr) report.nameAr.push({ id: p.id, from: n.name.ar, to: f.nameAr });
    if (n.brand !== f.brand) report.brand.push({ ...label, from: n.brand, to: f.brand });
    if (!same(n.images, f.images)) report.images.push({ ...label, from: n.images.length, to: f.images.length });
    if (n.description.ar !== f.descAr) report.descAr.push({ ...label, from: (n.description.ar || '').length, to: (f.descAr || '').length });
    Object.assign(n, { brand: f.brand, priceFils: f.priceFils, compareAtFils: f.compareAtFils, images: f.images, availability: f.availability });
    n.name = { ar: f.nameAr, en: n.name.en };
    n.description = { ar: f.descAr, en: n.description.en };
    // preserved fields — report when WooCommerce disagrees, overwrite only with --take-csv
    if (c.category && (c.category !== p.category || !same(uniq([c.category, ...c.categories]), p.categories))) {
      if (take.has('category') && (!validCats || validCats.has(c.category))) {
        report.taken.push({ ...label, field: 'category', from: p.category, to: c.category });
        n.category = c.category; n.categories = uniq([c.category, ...c.categories]);
      } else report.categoryHint.push({ ...label, kept: p.category, csv: c.category });
    }
    if (c.featured !== p.featured) {
      if (take.has('featured')) { report.taken.push({ ...label, field: 'featured', from: p.featured, to: c.featured }); n.featured = c.featured; }
      else report.featured.push({ ...label, kept: p.featured, csv: c.featured });
    }
    if (take.has('name-en')) {
      const en = tidy(EN_OVERRIDE[c.id] || suggestEn(c.rawName, c.brand) || p.name.en);
      if (en !== p.name.en) { report.taken.push({ ...label, field: 'name.en', from: p.name.en, to: en }); n.name.en = en; }
    }
    if (take.has('description-en')) {
      const en = cleanEnDesc(c.description_en);
      if (en !== p.description.en) { report.taken.push({ ...label, field: 'description.en', from: !!p.description.en, to: !!en }); n.description.en = en; }
    }
    out.push(n);
  }
  // new products: newest first, placed before every existing product in the default order
  const fresh = built.products.filter((c) => !byId.has(String(c.id))).sort((a, b) => b.id - a.id);
  // slugs are claimed oldest id first, so a collision gives the "-2" suffix to the newer product
  const freshSlug = new Map();
  for (const c of [...fresh].reverse()) {
    const en = tidy(EN_OVERRIDE[c.id] || suggestEn(c.rawName, c.brand) || `Product ${c.id}`);
    const base = slugify(en) || `product-${c.id}`;
    let slug = base;
    for (let k = 2; slugs.has(slug); k++) slug = `${base.slice(0, 66)}-${k}`;
    slugs.add(slug);
    freshSlug.set(c.id, { en, slug });
  }
  fresh.forEach((c, i) => {
    const f = csvFields(c);
    const { en, slug } = freshSlug.get(c.id);
    let category = c.category;
    if (!category || (validCats && !validCats.has(category))) category = 'accessory';
    out.push({
      id: String(c.id), slug, name: { ar: f.nameAr, en }, brand: f.brand, priceFils: f.priceFils, compareAtFils: f.compareAtFils,
      category, categories: uniq([category, ...c.categories.filter((x) => !validCats || validCats.has(x))]), images: f.images,
      description: { ar: f.descAr, en: cleanEnDesc(c.description_en) }, availability: f.availability, featured: !!c.featured,
      isNew: false, sort: minSort - 10 * (fresh.length - i),
    });
    report.added.push({ id: String(c.id), name: f.nameAr, en, slug, category, price: f.priceFils, images: f.images.length });
  });
  // isNew = the 12 highest WooCommerce ids
  const newest = new Set([...out].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 12).map((p) => String(p.id)));
  const newFlag = [];
  for (const p of out) { const v = newest.has(String(p.id)); if (p.isNew !== v) newFlag.push(p.id); p.isNew = v; }
  report.isNew = newFlag;
  out.sort((a, b) => Number(a.id) - Number(b.id));
  return { catalog: out.map(ordered), report };
}

// ============================================================================ validation (mirrors the build)
export function validate(catalog, validCats) {
  const errs = [], ids = new Set(), slugs = new Set();
  for (const p of catalog) {
    if (!/^\d+$/.test(p.id)) errs.push(`id not numeric: ${p.id}`);
    if (ids.has(p.id)) errs.push(`duplicate id ${p.id}`); ids.add(p.id);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug) || p.slug.length > 70) errs.push(`bad slug ${p.slug} (#${p.id})`);
    if (slugs.has(p.slug)) errs.push(`duplicate slug ${p.slug}`); slugs.add(p.slug);
    if (!Number.isInteger(p.priceFils) || p.priceFils <= 0) errs.push(`#${p.id}: priceFils must be > 0`);
    if (p.compareAtFils !== null && !(Number.isInteger(p.compareAtFils) && p.compareAtFils > p.priceFils)) errs.push(`#${p.id}: compareAtFils must be > priceFils`);
    if (validCats && !validCats.has(p.category)) errs.push(`#${p.id}: unknown category ${p.category}`);
    if (!['in_stock', 'out_of_stock', 'backorder'].includes(p.availability)) errs.push(`#${p.id}: availability ${p.availability}`);
    if (!p.name.ar || !p.name.en) errs.push(`#${p.id}: missing name`);
    if (/[٠-٩۰-۹]/.test(p.name.ar + (p.description.ar || ''))) errs.push(`#${p.id}: Arabic-Indic digits left`);
    if (!p.images.every((u) => /^https:\/\/[\x21-\x7e]+$/.test(u) || /^img\/p\/[\x21-\x7e]+$/.test(u) || /^\/[\x21-\x7e]+$/.test(u))) errs.push(`#${p.id}: bad image url`);
  }
  if (validCats) for (const c of validCats) if (!catalog.some((p) => p.category === c)) errs.push(`category "${c}" would be empty`);
  return errs;
}

// ============================================================================ CLI
const fils = (f) => (f == null ? '—' : (f / 1000).toFixed(3));
function printReport(r, built, quiet) {
  const line = `import-csv: ${r.added.length} added, ${r.removed.length} removed${r.kept.length ? `, ${r.kept.length} kept as out of stock` : ''}, ${r.price.length} price, ${r.compareAt.length} compare-at, ${r.availability.length} availability, ${r.nameAr.length} name, ${r.images.length} image, ${r.descAr.length} description, ${r.brand.length} brand changes`;
  if (quiet) { console.log(line); return; }
  console.log(`CSV: ${built.products.length} published products, ${built.en} English twin rows (${built.pairs} paired, ${built.secondary.length} secondary, ${built.unpaired.length} unpaired), ${built.unpublished.length} unpublished`);
  const sec = (title, list, fmt) => { if (!list.length) return; console.log(`\n${title} (${list.length}):`); for (const x of list.slice(0, 40)) console.log('  ' + fmt(x)); if (list.length > 40) console.log(`  … ${list.length - 40} more (use --report)`); };
  sec('ADDED — review the generated English names/slugs before publishing', r.added, (x) => `#${x.id} ${x.name} → ${x.en} [${x.category}] ${fils(x.price)} KWD, ${x.images} images, slug ${x.slug}`);
  sec('REMOVED (not in CSV or unpublished)', r.removed, (x) => `#${x.id} ${x.name}`);
  sec('KEPT AS OUT OF STOCK (--keep-removed)', r.kept, (x) => `#${x.id} ${x.name}`);
  sec('PRICE', r.price, (x) => `#${x.id} ${x.name}: ${fils(x.from)} → ${fils(x.to)}`);
  sec('COMPARE-AT (was price)', r.compareAt, (x) => `#${x.id} ${x.name}: ${fils(x.from)} → ${fils(x.to)}`);
  sec('AVAILABILITY', r.availability, (x) => `#${x.id} ${x.name}: ${x.from} → ${x.to}`);
  sec('ARABIC NAME', r.nameAr, (x) => `#${x.id}: ${x.from} → ${x.to}`);
  sec('BRAND', r.brand, (x) => `#${x.id} ${x.name}: ${x.from} → ${x.to}`);
  sec('IMAGES', r.images, (x) => `#${x.id} ${x.name}: ${x.from} → ${x.to} images`);
  sec('ARABIC DESCRIPTION', r.descAr, (x) => `#${x.id} ${x.name}: ${x.from} → ${x.to} chars`);
  sec('OVERWRITTEN FROM CSV (--take-csv)', r.taken, (x) => `#${x.id} ${x.field}: ${JSON.stringify(x.from)} → ${JSON.stringify(x.to)}`);
  sec('NOTE: category differs in WooCommerce (kept the catalog value; --take-csv category to apply)', r.categoryHint, (x) => `#${x.id} ${x.name}: kept ${x.kept}, CSV ${x.csv}`);
  sec('NOTE: featured differs in WooCommerce (kept; --take-csv featured to apply)', r.featured, (x) => `#${x.id} ${x.name}: kept ${x.kept}, CSV ${x.csv}`);
  if (r.isNew.length) console.log(`\n"new" badge recomputed (12 highest ids): ${r.isNew.length} products changed`);
  sec('WARNINGS', built.notes, (x) => x);
  sec('SKIPPED ROWS', built.problems, (x) => x);
  console.log('\n' + line);
}

async function main(argv) {
  const args = argv.slice(2);
  const flag = (n) => args.includes(n);
  const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const valued = new Set(['--catalog', '--report', '--anomalies', '--take-csv']);
  const positional = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
  if (!positional.length || flag('--help') || flag('-h')) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split("\n").slice(1, 16).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return positional.length ? 0 : 2;
  }
  const csvPath = path.resolve(positional[0]);
  const catPath = path.resolve(val('--catalog') || path.join(REPO, 'data', 'catalog.json'));
  const take = new Set((val('--take-csv') || '').split(',').map((s) => s.trim()).filter(Boolean));
  for (const t of take) if (!TAKE.has(t)) throw new Error(`--take-csv: unknown field "${t}" (allowed: ${[...TAKE].join(', ')})`);
  const dry = flag('--dry-run') || flag('--check');

  const built = buildFromRows(readRows(fs.readFileSync(csvPath, 'utf8')));
  const existing = fs.existsSync(catPath) ? JSON.parse(fs.readFileSync(catPath, 'utf8')) : [];
  if (!Array.isArray(existing)) throw new Error(`${catPath} must be a JSON array`);
  const catFile = path.join(REPO, 'data', 'categories.json');
  const validCats = fs.existsSync(catFile) ? new Set(JSON.parse(fs.readFileSync(catFile, 'utf8')).map((c) => c.id)) : null;

  const sourcesFile = path.join(REPO, 'src', 'static', 'img', 'p', 'sources.json');
  if (fs.existsSync(sourcesFile)) setMirrorSources(JSON.parse(fs.readFileSync(sourcesFile, 'utf8')));
  const { catalog, report } = merge(existing, built, { keepRemoved: flag('--keep-removed'), take, validCats });
  const errs = validate(catalog, validCats);
  printReport(report, built, flag('--quiet'));
  if (val('--report')) fs.writeFileSync(val('--report'), JSON.stringify({ csv: csvPath, report, warnings: built.notes, skipped: built.problems }, null, 2) + '\n');
  if (val('--anomalies')) {
    fs.writeFileSync(val('--anomalies'), JSON.stringify({
      twinPriceConflicts: built.twinPriceConflicts, brandConflicts: built.brandConflicts, unpublished: built.unpublished,
      withoutImages: catalog.filter((p) => !p.images.length).map((p) => ({ id: p.id, name: p.name.ar, en: p.name.en, category: p.category, availability: p.availability })),
      withoutDescription: catalog.filter((p) => !p.description.ar).map((p) => p.id),
    }, null, 2) + '\n');
  }
  if (errs.length) { console.error('\nVALIDATION FAILED — nothing written:\n  ' + errs.join('\n  ')); return 1; }

  const next = JSON.stringify(catalog, null, 2) + '\n';
  const prev = fs.existsSync(catPath) ? fs.readFileSync(catPath, 'utf8') : '';
  const changed = next !== prev;
  if (!changed) { console.log(`No changes: ${path.relative(process.cwd(), catPath) || catPath} already matches the CSV.`); return 0; }
  if (dry) { console.log(flag('--check') ? 'CHECK FAILED: the catalog differs from the CSV (run without --check to apply).' : 'Dry run: nothing written.'); return flag('--check') ? 1 : 0; }
  const tmp = catPath + '.tmp';
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, catPath);
  console.log(`Wrote ${path.relative(process.cwd(), catPath) || catPath} (${catalog.length} products). Next: node tools/build.mjs --out <dir> and review, then publish.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then((code) => process.exit(code), (e) => { console.error('import-csv: ' + e.message); process.exit(1); });
}
