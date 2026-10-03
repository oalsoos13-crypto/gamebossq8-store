// tools/verify/flows-gate.mjs — gate 4 (SPEC §13.4): end-to-end customer flows against the contracts
// (ids, data-action, roles; see src/CONTRACTS.md §6–7 and the module headers). Every flow runs in a fresh context,
// asserts its own steps and then asserts that it produced 0 console errors / failed same-origin requests.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { session, open, money, normAr, idFromHref, sleep, SCR_DEFAULT } from './lib.mjs';

const K = (k) => 'gbq8:v2:' + k;
const getStore = (page, key) => page.evaluate((k) => { const v = localStorage.getItem(k); try { return JSON.parse(v); } catch { return v; } }, K(key));
const T = (page, key, params) => page.evaluate(([k, p]) => (window.GB && GB.t ? GB.t(k, p || {}) : null), [key, params || null]);
const decodeWa = (u) => { try { return new URL(u).searchParams.get('text') || ''; } catch { return ''; } };
const waitFor = async (fn, ms = 6000, step = 100) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(step); } return !!(await fn()); };
const short = (s, n = 220) => (s && s.length > n ? s.slice(0, n) + '…' : s);

async function cartBadge(page) {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-count="cart"]')].find((x) => x.offsetParent !== null || x.closest('[data-count-label]')?.offsetParent !== null) || document.querySelector('[data-count="cart"]');
    return b ? { text: b.textContent.trim(), hidden: b.hidden } : null;
  });
}
async function openDialog(page, id) {
  const opener = page.locator(`[data-dialog-open="${id}"]:visible`).first();
  await opener.click();
  await page.waitForFunction((d) => document.getElementById(d) && document.getElementById(d).open, id, { timeout: 5000 });
  await page.waitForTimeout(120);
  return opener;
}
const isOpen = (page, id) => page.evaluate((d) => !!(document.getElementById(d) && document.getElementById(d).open), id);
const activeInfo = (page) => page.evaluate(() => { const a = document.activeElement; return a ? { id: a.id, tag: a.tagName.toLowerCase(), action: a.getAttribute('data-dialog-open'), text: (a.textContent || '').trim().slice(0, 30) } : null; });
const isActive = (page, locator) => locator.evaluate((el) => el === document.activeElement);

/** Fill the checkout form through its stable field names (src/pages/checkout.mjs). */
async function fillCheckout(page, v) {
  const f = async (n, val) => { if (val !== undefined) await page.locator(`#checkout-form [name="${n}"]`).fill(val); };
  await f('name', v.name);
  await f('phone', v.phone);
  if (v.governorate !== undefined) await page.locator('#checkout-form [name="governorate"]').selectOption(v.governorate);
  await f('area', v.area); await f('block', v.block); await f('street', v.street); await f('avenue', v.avenue); await f('house', v.house); await f('notes', v.notes);
  if (v.payment) await page.locator(`#checkout-form input[name="payment"][value="${v.payment}"]`).check({ force: true });
  if (v.save !== undefined) await page.locator('#checkout-form [name="save"]').setChecked(v.save, { force: true });
}
const CUSTOMER = { name: 'عبدالله الكندري', phone: '٩٧٩٣٧٥٥٦', governorate: 'hawalli', area: 'السالمية', block: '12', street: 'شارع سالم المبارك', avenue: '3', house: '45', notes: 'الاتصال قبل الوصول', payment: 'knet_link', save: false };

async function gotoCheckout(S, loc) {
  await open(S, (loc === 'en' ? 'en/' : '') + 'checkout/');
  await S.page.waitForSelector('#co-main:not([hidden])', { timeout: 8000 });
  await S.page.waitForSelector('#co-submit:not([disabled])', { timeout: 8000 });
  await S.page.waitForSelector('#co-summary li', { timeout: 8000 }).catch(() => {});
}
/** Click submit and wait for the intercepted wa.me navigation. Returns the URL or null. */
async function submitForWa(S) {
  const n = S.wa.length;
  await S.page.locator('#co-submit').click();
  const ok = await waitFor(() => S.wa.length > n, 6000);
  return ok ? S.wa[S.wa.length - 1] : null;
}

/** Expected-message assertions shared by several flows. */
async function assertMessage(c, page, site, url, exp) {
  const text = decodeWa(url);
  const L = exp.loc;
  c('wa.me target is the shop number', /^https:\/\/wa\.me\/96597937556\?text=/.test(url), short(url, 80));
  c('wa.me URL ≤ 6000 chars', url.length <= 6000, url.length);
  const refM = /GB-\d{6}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}/.exec(text);
  c('message has an order ref GB-YYMMDD-XXXX', !!refM, short(text.split('\n').slice(0, 2).join(' | ')));
  c('message title names GameBoss Q8', /GameBoss Q8/.test(text.split('\n')[0] || ''), text.split('\n')[0]);
  const missing = exp.lines.filter((l) => !(exp.compact ? new RegExp(`#${l.id}(?!\\d)`).test(text) : text.includes(`[#${l.id}]`)));
  c(`message lists every available line with [#id] (${exp.lines.length})`, !missing.length, missing.map((l) => l.id));
  if (!exp.compact) {
    const qtyBad = exp.lines.filter((l) => { const line = text.split('\n').find((x) => x.includes(`[#${l.id}]`)) || ''; return !new RegExp(`×\\s*${l.qty}\\b`).test(line) || !line.includes(money(l.lineFils, L)); });
    c('each line shows × qty and its line total', !qtyBad.length, qtyBad.map((l) => ({ id: l.id, line: (text.split('\n').find((x) => x.includes(`[#${l.id}]`)) || '').slice(0, 120) })));
  }
  const leaked = (exp.excluded || []).filter((id) => text.includes(`#${id}`));
  c('out-of-stock lines are excluded from the message', !leaked.length, leaked);
  if (exp.backorder) {
    const bLine = text.split('\n').find((x) => x.includes(`[#${exp.backorder}]`)) || '';
    const tag = await T(page, 'order.msgBackorder');
    const bp = site.byId.get(String(exp.backorder));
    const named = bp && bLine.includes([...(L === 'en' ? bp.n.en : bp.n.ar)].slice(0, 12).join(''));
    // SPEC §5: once the message must be shortened to "• [#id] × qty = total", names and tags are dropped
    c('backorder line is tagged (when item names are kept)', !named || (!!tag && bLine.includes(tag)), { line: bLine, tag, shortened: !named });
  }
  c('subtotal = Σ line totals', text.includes(money(exp.subtotal, L)), money(exp.subtotal, L));
  if (exp.delivery === 'tbc') {
    const tbc = await T(page, 'order.msgDeliveryTbc');
    c('delivery "to be confirmed on WhatsApp" (delivery.confirmed=false)', !!tbc && text.includes(tbc), tbc);
    const ls = text.split('\n').filter((x) => x.includes(money(exp.subtotal, L)));
    c('total = subtotal + delivery placeholder', ls.length >= 2 && ls.some((x) => /\+/.test(x)), ls);
  } else if (exp.delivery === 'fee') {
    c('delivery fee line (confirmed, below threshold)', text.includes(money(exp.fee, L)), money(exp.fee, L));
    c('total = subtotal + fee', text.includes(money(exp.subtotal + exp.fee, L)), money(exp.subtotal + exp.fee, L));
  } else if (exp.delivery === 'free') {
    const free = await T(page, 'order.msgFree');
    c('free delivery at/above threshold (confirmed)', !!free && text.includes(free), free);
    const lines = text.split('\n').filter((x) => x.includes(money(exp.subtotal, L)));
    c('total = subtotal (free delivery)', lines.length >= 2, lines);
  }
  if (exp.customer) {
    const cu = exp.customer;
    const miss = ['area', 'block', 'street', 'house'].filter((k) => !text.includes(cu[k]));
    c('address has area/block/street/house', !miss.length, { miss, text: short(text.split('\n').filter((x) => x.includes(cu.area)).join(' | ')) });
    if (exp.govName) c('address has the governorate name', text.includes(exp.govName), exp.govName);
    c('name present', text.includes(cu.name), cu.name);
    c('phone normalised to Latin digits (٩٧٩٣٧٥٥٦ → 97937556)', text.includes('97937556') && !/[٠-٩]/.test(text.split('\n').find((x) => x.includes('9793')) || ''), (text.split('\n').find((x) => x.includes('9793')) || '').slice(0, 60));
    if (exp.notes) c('notes present', text.includes(exp.notes), exp.notes);
  }
  if (exp.payLabel) c('payment method present', text.includes(exp.payLabel), exp.payLabel);
  const pid = exp.publishId || site.publishId;
  c('publishId (نسخة/version) present', text.includes(pid), pid);
  if (exp.src) c(`source "${exp.src}" present`, text.includes(exp.src), exp.src);
  return { text, ref: refM && refM[0] };
}

export async function flowsGate(R, env) {
  const { site, browser, srv } = env;
  const pk = site.picks;
  const P = site.byId;
  const flows = [];
  const flow = (name, opts, fn) => flows.push({ name, opts, fn });

  /* ================================================================ 1. add to cart from a card + persistence */
  flow('cart: add from card, badge, persistence', { vp: 'm390' }, async (S, c) => {
    const page = S.page;
    await S.seed({});
    await open(S, `c/${pk.category}/`);
    const btns = page.locator('main [data-listing] .gb-card [data-action="add-to-cart"]:visible');
    const n = await btns.count();
    c('category page has add-to-cart buttons', n > 1, n);
    const first = btns.nth(0), second = btns.nth(1);
    const id1 = await first.getAttribute('data-id'), id2 = await second.getAttribute('data-id');
    await first.scrollIntoViewIfNeeded(); await first.click();
    await first.click();
    await second.scrollIntoViewIfNeeded(); await second.click();
    await page.waitForTimeout(150);
    const cart = await getStore(page, 'cart');
    c('storage gbq8:v2:cart = {id: qty}', cart && cart[id1] === 2 && cart[id2] === 1 && Object.keys(cart).length === 2, cart);
    c('added button shows feedback (.is-added)', await first.evaluate((el) => el.classList.contains('is-added')).catch(() => false));
    const toast = await page.evaluate(() => { const t = document.getElementById('gb-toast'); return t && t.classList.contains('is-show') ? t.textContent.trim() : null; });
    c('toast confirms the add', !!toast, toast);
    const b = await cartBadge(page);
    c('cart badge = 3', b && b.text === '3' && !b.hidden, b);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(200);
    const b2 = await cartBadge(page);
    c('badge persists after reload', b2 && b2.text === '3' && !b2.hidden, b2);
    const oosCards = await page.evaluate(() => [...document.querySelectorAll('main .gb-card[data-avail="out_of_stock"]')].map((a) => ({ id: a.dataset.id, add: !!a.querySelector('[data-action="add-to-cart"]:not([disabled]):not([aria-disabled="true"])') })));
    c('out-of-stock cards have no add-to-cart button', oosCards.every((x) => !x.add), { checked: oosCards.length, withAdd: oosCards.filter((x) => x.add).map((x) => x.id) });
  });

  /* ================================================================ 2. product page: qty + add + buy now */
  flow('product: qty stepper, add to cart, buy now', { vp: 'm390' }, async (S, c) => {
    const page = S.page;
    const p = pk.sale || pk.inStock[0];
    await S.seed({});
    await open(S, p.s);
    const cta = page.locator('#pdp-cta');
    c('product page has #pdp-cta', await cta.count() === 1);
    const inc = cta.locator('[data-step="1"]');
    await inc.click(); await inc.click();
    const q = await page.locator('#pdp-qty').inputValue();
    c('qty stepper +2 → 3', q === '3', q);
    await page.locator('#pdp-qty').fill('٤');
    await page.locator('#pdp-qty').blur();
    const q2 = await page.locator('#pdp-qty').inputValue();
    c('qty accepts Arabic-Indic digit (٤ → 4)', q2 === '4', q2);
    await page.locator('#pdp-qty').fill('3'); await page.locator('#pdp-qty').blur();
    await cta.locator('[data-action="add-to-cart"]').first().click();
    await page.waitForTimeout(150);
    const cart = await getStore(page, 'cart');
    c('add-to-cart adds the chosen qty', cart && cart[p.id] === 3, cart);
    const b = await cartBadge(page);
    c('badge = 3', b && b.text === '3', b);
    const price = await page.evaluate(() => document.querySelector('#pdp-cta [data-action="add-to-cart"]')?.getAttribute('data-price'));
    c('add button carries the product price', Number(price) === p.p, { price, expected: p.p });
    if (p.c) {
      const pct = Math.round((1 - p.p / p.c) * 100);
      const txt = await page.locator('main').innerText();
      c('sale product shows the real discount %', new RegExp(`${pct}\\s*%|%\\s*${pct}`).test(txt), pct);
    }
    const buy = page.locator('[data-action="product-buy-now"]').first();
    if (await buy.count()) {
      await Promise.all([page.waitForURL(/\/checkout\/?(\?|$)/, { timeout: 8000 }), buy.click()]);
      const cart2 = await getStore(page, 'cart');
      c('buy now → checkout with the item in the cart', /\/checkout\/$/.test(new URL(page.url()).pathname) && cart2 && cart2[p.id] >= 3, { url: page.url(), cart: cart2 });
    } else c('buy now button exists', false);
  });

  /* ================================================================ 3. out of stock */
  flow('out of stock: not addable, notify via WhatsApp', { vp: 'm390' }, async (S, c) => {
    const page = S.page;
    const p = pk.oos;
    if (!p) { c('an out_of_stock product exists', false); return; }
    await S.seed({});
    await open(S, p.s);
    const adds = await page.locator('#pdp-cta [data-action="add-to-cart"]:not([disabled]):not([aria-disabled="true"])').count();
    c('no enabled add-to-cart on an out_of_stock product page', adds === 0, adds);
    const anyAdd = await page.locator(`[data-action="add-to-cart"][data-id="${p.id}"]:not([disabled]):not([aria-disabled="true"])`).count();
    c('no add-to-cart for this id anywhere on the page', anyAdd === 0, anyAdd);
    const notify = page.locator('#pdp-cta a[href^="https://wa.me/"]').first();
    const href = (await notify.count()) ? await notify.getAttribute('href') : null;
    const txt = href ? decodeWa(href) : '';
    c('"notify me" wa.me link with the product id', !!href && txt.includes(p.id), short(txt, 120));
    c('notify link opens in a new tab safely', href ? (await notify.getAttribute('target')) === '_blank' && /noopener/.test(await notify.getAttribute('rel') || '') : false);
  });

  /* ================================================================ 4. cart drawer: lines, qty, remove, OOS, dialog a11y */
  flow('cart drawer: qty/remove/unavailable + focus, Esc, close, backdrop', { vp: 'm390' }, async (S, c) => {
    const page = S.page;
    const [a, b] = pk.inStock.filter((p) => p.id !== (pk.oos && pk.oos.id)).slice(5, 7);
    const o = pk.oos;
    const cart = { [a.id]: 1, [b.id]: 2 };
    if (o) cart[o.id] = 1;
    await S.seed({ [K('cart')]: cart });
    await open(S, '');
    const opener = await openDialog(page, 'gb-cart');
    await page.waitForSelector('#gb-cart [data-id] [data-action="cart-remove"], #gb-cart .gb-cart-line', { timeout: 6000 });
    const st = await activeInfo(page);
    c('cart opens as a modal <dialog>, focus on its heading', await isOpen(page, 'gb-cart') && st && st.id === 'gb-cart-title', st);
    const ids = await page.evaluate(() => [...document.querySelectorAll('#gb-cart li[data-id]')].map((li) => li.dataset.id));
    c('drawer lists every line', Object.keys(cart).every((id) => ids.includes(id)), ids);
    if (o) {
      const un = await page.evaluate((id) => { const li = document.querySelector(`#gb-cart li[data-id="${id}"]`); return li ? { cls: li.className, inc: !!li.querySelector('[data-action="cart-inc"]'), remove: !!li.querySelector('[data-action="cart-remove"]') } : null; }, o.id);
      c('out_of_stock line shown as unavailable with a remove button, no qty stepper', un && /is-unavailable/.test(un.cls) && !un.inc && un.remove, un);
    }
    const foot = async () => page.evaluate(() => { const f = document.getElementById('gb-cart-foot'); return f && !f.hidden ? f.innerText : ''; });
    const sub1 = a.p + 2 * b.p;
    let ft = await foot();
    c('subtotal excludes unavailable lines', ft.includes(money(sub1, 'ar').split(' ')[0]), { expected: money(sub1, 'ar'), foot: short(ft, 160) });
    const tbc = await T(page, 'cart.deliveryTbc');
    c('delivery "to be confirmed" (confirmed=false), no free-delivery bar', !!tbc && ft.includes(tbc) && !(await page.locator('#gb-cart .gb-cart-free').count()), tbc);
    await page.locator(`#gb-cart [data-action="cart-inc"][data-id="${a.id}"]`).click();
    await page.waitForTimeout(150);
    await page.locator(`#gb-cart [data-action="cart-dec"][data-id="${b.id}"]`).click();
    await page.waitForTimeout(150);
    const c2 = await getStore(page, 'cart');
    c('+ / − change quantities (storage)', c2[a.id] === 2 && c2[b.id] === 1, c2);
    const outA = await page.locator(`#gb-cart li[data-id="${a.id}"] output`).textContent().catch(() => null);
    c('line shows the new qty', String(outA).trim() === '2', outA);
    ft = await foot();
    c('totals re-computed', ft.includes(money(2 * a.p + b.p, 'ar').split(' ')[0]), money(2 * a.p + b.p, 'ar'));
    c('focus stays inside the dialog after a qty change', await page.evaluate(() => !!document.activeElement.closest('#gb-cart')));
    if (o) {
      await page.locator(`#gb-cart [data-action="cart-remove"][data-id="${o.id}"]`).click();
      await page.waitForTimeout(150);
      const c3 = await getStore(page, 'cart');
      c('remove deletes the line', !c3[o.id] && (await page.locator(`#gb-cart li[data-id="${o.id}"]`).count()) === 0, c3);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    c('Escape closes the cart', !(await isOpen(page, 'gb-cart')));
    c('focus returns to the opener', await isActive(page, opener), await activeInfo(page));
    await openDialog(page, 'gb-cart');
    await page.locator('#gb-cart .gb-dialog__close, #gb-cart [data-dialog-close]').first().click();
    await page.waitForTimeout(150);
    c('close button closes', !(await isOpen(page, 'gb-cart')));
    await openDialog(page, 'gb-cart');
    const closeSize = await page.evaluate(() => { const b = document.querySelector('#gb-cart .gb-dialog__close') || document.querySelector('#gb-cart [data-dialog-close]'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: r.width, h: r.height }; });
    c('close button ≥ 44×44', !!closeSize && closeSize.w >= 43.5 && closeSize.h >= 43.5, closeSize);
    const box = await page.locator('#gb-cart').boundingBox();
    const vw = page.viewportSize().width;
    let x = null;
    if (box) { if (box.x > 12) x = 6; else if (box.x + box.width < vw - 12) x = vw - 6; }
    if (x !== null) {
      await page.mouse.click(x, 420);
      await page.waitForTimeout(150);
      c('backdrop click closes', !(await isOpen(page, 'gb-cart')), { box, x });
    } else c('drawer leaves a backdrop strip at 390px', false, box);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(250);
    const b3 = await cartBadge(page);
    c('cart persists across reload', b3 && b3.text === '3', b3);
  });

  /* ================================================================ 5. legacy migration */
  flow('legacy v1 cart migration (row ids → WooCommerce ids)', { vp: 'm390' }, async (S, c) => {
    const page = S.page;
    const mapFile = join(SCR_DEFAULT, 'audit', 'ops_rowid_to_wcid.json');
    let rowMap = null;
    try { rowMap = JSON.parse(readFileSync(mapFile, 'utf8')); } catch { rowMap = null; }
    const legacyCart = { 1: 2, 2: 1, 26: 1, 999: 3 };
    const legacyWish = [2, 30, 4, 9999];
    let expCart = null, expWish = null;
    if (rowMap) {
      expCart = {};
      for (const [row, q] of Object.entries(legacyCart)) { const id = rowMap[row] && String(rowMap[row]); if (id && P.has(id)) expCart[id] = (expCart[id] || 0) + q; }
      expWish = [...new Set(legacyWish.map((r) => rowMap[r] && String(rowMap[r])).filter((id) => id && P.has(id)))];
    } else { expCart = { 10736: 2, 10748: 1 }; expWish = ['10748', '10765']; }
    await S.seed({ 'gbq8b-cart': legacyCart, 'gbq8b-wish': legacyWish });
    await open(S, '');
    await page.waitForTimeout(200);
    const st = await page.evaluate(() => ({ cart: localStorage.getItem('gbq8:v2:cart'), wish: localStorage.getItem('gbq8:v2:wish'), lc: localStorage.getItem('gbq8b-cart'), lw: localStorage.getItem('gbq8b-wish') }));
    const cart = JSON.parse(st.cart || '{}'), wish = JSON.parse(st.wish || '[]');
    const sameCart = JSON.stringify(Object.entries(cart).map(([k, v]) => [String(k), v]).sort()) === JSON.stringify(Object.entries(expCart).map(([k, v]) => [String(k), v]).sort());
    c('cart migrated: mapped ids kept, English twins/unknown rows dropped', sameCart, { got: cart, expected: expCart });
    c('wishlist migrated', JSON.stringify([...wish].map(String).sort()) === JSON.stringify([...expWish].sort()), { got: wish, expected: expWish });
    c('legacy keys removed', st.lc === null && st.lw === null, { lc: st.lc, lw: st.lw });
    const total = Object.values(expCart).reduce((x, y) => x + y, 0);
    const b = await cartBadge(page);
    c('badge reflects migrated cart', b && b.text === String(total), b);
    await page.reload({ waitUntil: 'load' });
    const again = await getStore(page, 'cart');
    c('migration runs once (stable after reload)', JSON.stringify(again) === JSON.stringify(cart), again);
  });

  /* ================================================================ 6. price changed notice */
  flow('price changed since added → notice', { vp: 'm390' }, async (S, c) => {
    const page = S.page;
    const p = pk.inStock[3];
    await S.seed({ [K('cart')]: { [p.id]: 1 }, [K('cartp')]: { [p.id]: p.p + 1000 } });
    await open(S, '');
    const msg = await T(page, 'common.priceUpdated');
    const shown = await waitFor(() => page.evaluate((m) => { const t = document.getElementById('gb-toast'); return !!(t && t.textContent.includes(m)); }, msg), 4000);
    c('"price updated" notice shown on load', shown, msg);
    await openDialog(page, 'gb-cart');
    await page.waitForSelector('#gb-cart li[data-id]', { timeout: 6000 });
    const ft = await page.evaluate(() => document.getElementById('gb-cart-foot').innerText);
    c('cart uses the current price, never the stored one', ft.includes(money(p.p, 'ar').split(' ')[0]), { expected: money(p.p, 'ar') });
  });

  /* ================================================================ 7. menu + search dialogs (mobile + desktop) */
  for (const vp of ['m390', 'd1280']) {
    flow(`dialogs (${vp}): menu + search focus / Esc / return focus`, { vp }, async (S, c) => {
      const page = S.page;
      await S.seed({});
      await open(S, 'en/');
      for (const id of ['gb-menu', 'gb-search']) {
        const opener = await openDialog(page, id);
        const a = await activeInfo(page);
        const want = id === 'gb-search' ? 'gb-search-input' : 'gb-menu-title';
        c(`${id}: opens modal, focus → #${want}`, a && a.id === want, a);
        const role = await page.evaluate((d) => { const el = document.getElementById(d); return { tag: el.tagName, labelled: el.getAttribute('aria-labelledby') || el.getAttribute('aria-label') }; }, id);
        c(`${id}: native <dialog> with an accessible name`, role.tag === 'DIALOG' && !!role.labelled, role);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        c(`${id}: Escape closes`, !(await isOpen(page, id)));
        c(`${id}: focus returns to the trigger`, await isActive(page, opener), await activeInfo(page));
      }
      const scroll = await page.evaluate(() => getComputedStyle(document.documentElement).overflow + '/' + getComputedStyle(document.body).overflow);
      c('scroll lock released after closing', !/hidden/.test(scroll), scroll);
    });
  }

  /* ================================================================ 8. search (Arabic variants) */
  flow('search: overlay + page, Arabic normalisation (hamza / ta marbuta / brand)', { vp: 'm390' }, async (S, c) => {
    const page = S.page;
    await S.seed({});
    await open(S, '');
    await openDialog(page, 'gb-search');
    const overlay = async (q) => {
      await page.locator('#gb-search-input').fill('');
      await page.waitForTimeout(200);
      await page.locator('#gb-search-input').fill(q);
      let last = null, stable = 0;
      for (let i = 0; i < 40 && stable < 3; i++) {
        await sleep(120);
        const cur = await page.evaluate(() => [...document.querySelectorAll('#gb-search-body a[href*="/p/"]')].map((a) => a.getAttribute('href')).join('|'));
        if (cur && cur === last) stable++; else stable = 0;
        last = cur;
      }
      return (last || '').split('|').filter(Boolean).map(idFromHref);
    };
    const words = (s) => normAr(s).replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(Boolean);
    const strip = (w) => (w.length >= 5 && /^(وال|بال|فال|كال)/.test(w) ? w.slice(3) : w.length >= 4 && /^(ال|لل)/.test(w) ? w.slice(2) : w);
    const nameHit = (p, t) => words(p.n.ar + ' ' + p.n.en).some((w) => w.startsWith(t) || strip(w).startsWith(t));
    const r1 = await overlay('ادبتر');
    const r2 = await overlay('أدبتر');
    c('"ادبتر" → results', r1.length > 0, r1);
    c('"أدبتر" (hamza) → same results as "ادبتر"', r2.length > 0 && r1.join() === r2.join(), { r1, r2 });
    c('"ادبتر" top result is an adapter', r1.length > 0 && nameHit(P.get(r1[0]), 'ادبتر') || (r1[0] && /adapt/i.test(P.get(r1[0]).n.en)), r1[0] && P.get(r1[0]).n.ar);
    const r3 = await overlay('بيفا');
    c('"بيفا" → PIVA products', r3.length > 0 && r3.some((id) => P.get(id) && P.get(id).b === 'PIVA'), r3.map((id) => P.get(id) && P.get(id).b));
    const r4 = await overlay('PIVA');
    c('"PIVA" → only PIVA products', r4.length > 0 && r4.every((id) => P.get(id) && (P.get(id).b === 'PIVA' || /piva|بيفا/i.test(P.get(id).n.ar + P.get(id).n.en))), r4.map((id) => P.get(id) && P.get(id).b));
    const r5 = await overlay('مروحه');
    c('"مروحه" (ta marbuta) → fans', r5.length > 0 && r5.slice(0, 4).every((id) => P.get(id) && (P.get(id).cat === 'fan' || nameHit(P.get(id), 'مروحه'))), r5.map((id) => P.get(id) && P.get(id).cat));
    c('overlay shows at most 8 results + "all results" link', r5.length <= 8 && (await page.locator('#gb-search-body a[href*="search/?q="]').count()) > 0, r5.length);
    const r6 = await overlay('zzqxw');
    c('no-results query shows no products', r6.length === 0, r6);
    await page.keyboard.press('Escape');
    // full results page
    for (const [q, t] of [['مروحه', 'مروحه'], ['أدبتر', 'ادبتر']]) {
      await open(S, 'search/?q=' + encodeURIComponent(q));
      await page.waitForSelector('#search-results a[href*="/p/"]', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(250);
      const got = new Set((await page.evaluate(() => [...document.querySelectorAll('#search-results a[href*="/p/"]')].map((a) => a.getAttribute('href')))).map(idFromHref));
      const expected = site.products.filter((p) => nameHit(p, t)).map((p) => String(p.id));
      const miss = expected.filter((id) => !got.has(id));
      c(`search page ?q=${q}: every product whose name has "${t}" is found (${expected.length})`, got.size > 0 && !miss.length, { found: got.size, missing: miss.slice(0, 8) });
    }
    await open(S, 'en/search/?q=PIVA');
    await page.waitForSelector('#search-results a[href*="/p/"]', { timeout: 8000 }).catch(() => {});
    const en = await page.evaluate(() => [...document.querySelectorAll('#search-results a[href*="/p/"]')].map((a) => a.getAttribute('href')));
    c('English search page links stay in /en/', en.length > 0 && en.every((h) => h.includes('/en/p/')), en.slice(0, 3));
    const piva = site.products.filter((p) => p.b === 'PIVA').length;
    c(`"PIVA" search page finds all ${piva} PIVA products`, new Set(en.map(idFromHref)).size >= piva, new Set(en.map(idFromHref)).size);
  });

  /* ================================================================ 9. category sort/filter + URL state */
  flow('category: sort + filters + URL state + back/reload', { vp: 'd1280' }, async (S, c) => {
    const page = S.page;
    await S.seed({});
    const route = `c/${pk.category}/`;
    await open(S, route);
    const visible = () => page.evaluate(() => [...document.querySelectorAll('main [data-listing] .gb-grid > li')].filter((li) => !li.hidden && li.getClientRects().length).map((li) => { const a = li.querySelector('[data-id]'); return { id: a.dataset.id, price: +a.dataset.price, avail: a.dataset.avail, brand: a.dataset.brand || '', off: +(a.dataset.off || 0), compare: a.dataset.compare }; }));
    const all = await visible();
    c('category prerenders all its products', all.length >= 2, all.length);
    const firstOos = all.findIndex((x) => x.avail === 'out_of_stock');
    c('default order: in-stock first', firstOos === -1 || all.slice(firstOos).every((x) => x.avail === 'out_of_stock'), all.map((x) => x.avail[0]).join(''));
    await page.locator('main select[data-sort]').selectOption('price-asc');
    await page.waitForTimeout(200);
    let v = await visible();
    const grp = (x) => (x.avail === 'out_of_stock' ? 1 : 0);
    const sorted = v.every((x, i) => i === 0 || grp(v[i - 1]) < grp(x) || (grp(v[i - 1]) === grp(x) && v[i - 1].price <= x.price));
    c('sort price ascending (out of stock last)', sorted && v.length === all.length, v.map((x) => x.price).slice(0, 12));
    c('URL has ?sort=price-asc', new URL(page.url()).searchParams.get('sort') === 'price-asc', page.url());
    await page.locator('main select[data-sort]').selectOption('price-desc');
    await page.waitForTimeout(150);
    v = await visible();
    c('sort price descending', v.every((x, i) => i === 0 || grp(v[i - 1]) < grp(x) || (grp(v[i - 1]) === grp(x) && v[i - 1].price >= x.price)), v.map((x) => x.price).slice(0, 12));
    const stockChip = page.locator('main [data-filter="stock"]');
    if (await stockChip.count()) {
      await stockChip.first().click();
      await page.waitForTimeout(150);
      v = await visible();
      const expectN = all.filter((x) => x.avail === 'in_stock').length;
      c('"in stock only" filter', v.length === expectN && v.every((x) => x.avail === 'in_stock'), { shown: v.length, expectN });
      c('URL has stock=1 and chip aria-pressed=true', new URL(page.url()).searchParams.get('stock') === '1' && (await stockChip.first().getAttribute('aria-pressed')) === 'true', page.url());
    } else c('category has a stock filter chip', false);
    const saleChip = page.locator('main [data-filter="sale"]');
    if (await saleChip.count()) {
      await saleChip.first().click();
      await page.waitForTimeout(150);
      v = await visible();
      c('"on sale" filter (combined with stock)', v.length > 0 && v.every((x) => x.avail === 'in_stock' && (x.off > 0 || (x.compare && +x.compare > x.price))), v.map((x) => x.id));
      c('URL has sale=1', new URL(page.url()).searchParams.get('sale') === '1', page.url());
      await saleChip.first().click();
      await page.waitForTimeout(100);
    }
    const brandChips = page.locator('main [data-filter="brand"]');
    if (await brandChips.count()) {
      const val = await brandChips.first().getAttribute('data-value');
      await brandChips.first().click();
      await page.waitForTimeout(150);
      v = await visible();
      c(`brand filter "${val}"`, v.length > 0 && v.every((x) => x.brand === val), { val, brands: [...new Set(v.map((x) => x.brand))] });
      c('URL has brand=', new URL(page.url()).searchParams.get('brand') === val, page.url());
    }
    const urlBefore = page.url();
    const idsBefore = (await visible()).map((x) => x.id).join();
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(300);
    const idsAfter = (await visible()).map((x) => x.id).join();
    c('reload restores sort + filters from the URL', idsAfter === idsBefore && page.url() === urlBefore && (await page.locator('main select[data-sort]').inputValue()) === 'price-desc', { before: idsBefore.slice(0, 60), after: idsAfter.slice(0, 60) });
    const sw = await page.locator('a[data-lang-switch]').first().getAttribute('href');
    c('language switch keeps the listing query', /sort=price-desc/.test(sw || ''), sw);
    await page.goBack({ waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(300);
    const back = new URL(page.url()).searchParams;
    c('back button steps to the previous listing state', !back.get('brand') || back.get('brand') !== new URL(urlBefore).searchParams.get('brand'), page.url());
    await open(S, route + '?sort=discount&sale=1');
    await page.waitForTimeout(200);
    v = await visible();
    c('deep link ?sort=discount&sale=1 applies on load', v.length > 0 && v.every((x) => x.off > 0 || (x.compare && +x.compare > x.price)) && v.every((x, i) => i === 0 || grp(v[i - 1]) < grp(x) || v[i - 1].off >= x.off), v.map((x) => x.off));
  });

  /* ================================================================ 10. wishlist */
  flow('wishlist: toggle, page list, move to cart, remove, empty state', { vp: 'm390' }, async (S, c) => {
    const page = S.page;
    await S.seed({});
    await open(S, `c/${pk.category}/`);
    const toggles = page.locator('main [data-listing] .gb-card[data-avail="in_stock"] [data-action="wish-toggle"]');
    const id1 = await toggles.nth(0).getAttribute('data-id');
    const id2 = await toggles.nth(1).getAttribute('data-id');
    await toggles.nth(0).click(); await toggles.nth(1).click();
    await page.waitForTimeout(120);
    c('wish toggle sets aria-pressed=true', (await toggles.nth(0).getAttribute('aria-pressed')) === 'true');
    const wl = await getStore(page, 'wish');
    c('storage gbq8:v2:wish holds both ids', Array.isArray(wl) && wl.map(String).includes(id1) && wl.map(String).includes(id2), wl);
    await toggles.nth(1).click(); await page.waitForTimeout(100); await toggles.nth(1).click(); await page.waitForTimeout(100);
    c('toggle off/on round-trips', (await getStore(page, 'wish')).map(String).includes(id2));
    await open(S, 'wishlist/');
    await page.waitForSelector('#wl-list > li', { timeout: 6000 });
    const ids = await page.evaluate(() => [...document.querySelectorAll('#wl-list > li')].map((li) => li.dataset.id || li.querySelector('[data-id]')?.dataset.id));
    c('wishlist page lists the saved products', ids.includes(id1) && ids.includes(id2) && ids.length === 2, ids);
    await page.locator(`#wl-list [data-action="wishlist-move"][data-id="${id1}"]`).click();
    await page.waitForTimeout(200);
    const cart = await getStore(page, 'cart');
    const wish2 = (await getStore(page, 'wish')) || [];
    c('"move to cart" adds to cart and removes from wishlist', cart && cart[id1] === 1 && !wish2.map(String).includes(id1), { cart, wish: wish2 });
    await page.locator(`#wl-list [data-action="wishlist-remove"][data-id="${id2}"]`).click();
    await page.waitForTimeout(200);
    c('remove → empty state', await page.locator('#wl-empty').isVisible() && (await page.locator('#wl-list > li:visible').count()) === 0);
    const wb = await page.evaluate(() => { const b = document.querySelector('[data-count="wish"]'); return b ? { t: b.textContent.trim(), h: b.hidden } : null; });
    c('wish badge cleared', !wb || wb.h || wb.t === '0', wb);
  });

  /* ================================================================ 11. checkout: validation, Arabic digits, wa.me message, confirmation */
  flow('checkout: validation → Arabic-digit phone → wa.me message → confirmation', { vp: 'm390', permissions: ['clipboard-read', 'clipboard-write'] }, async (S, c) => {
    const page = S.page;
    // short names so the message is not shortened (names + backorder tag kept); the 20-item flow covers the cap
    const lines = [...pk.inStock].sort((x, y) => [...x.n.ar].length - [...y.n.ar].length).slice(0, 1);
    const bo = pk.backorder;
    const cart = { [lines[0].id]: 2 };
    if (bo) cart[bo.id] = 1;
    if (pk.oos) cart[pk.oos.id] = 1;
    await S.seed({ [K('cart')]: cart });
    await open(S, '?src=ig');
    await gotoCheckout(S, 'ar');
    // empty submit
    await page.locator('#checkout-form [name="name"]').fill('');
    let n0 = S.wa.length;
    await page.locator('#co-submit').click();
    await page.waitForTimeout(300);
    const errBox = await page.evaluate(() => { const b = document.getElementById('co-errors'); return b ? { hidden: b.hidden, role: b.getAttribute('role'), items: b.querySelectorAll('li').length } : null; });
    c('empty submit → role=alert error summary', errBox && !errBox.hidden && errBox.role === 'alert' && errBox.items >= 5, errBox);
    const a1 = await activeInfo(page);
    c('focus moves to the first invalid field (name)', a1 && a1.id === 'co-name', a1);
    const inv = await page.evaluate(() => ['name', 'phone', 'area', 'block', 'street', 'house'].map((f) => { const el = document.querySelector(`#checkout-form [name="${f}"]`); const d = (el.getAttribute('aria-describedby') || '').split(/\s+/).map((x) => document.getElementById(x)).filter((x) => x && !x.hidden && x.textContent.trim()); return { f, invalid: el.getAttribute('aria-invalid'), described: d.length }; }));
    c('invalid fields get aria-invalid + a described inline error', inv.every((x) => x.invalid === 'true' && x.described > 0), inv);
    c('no WhatsApp navigation on invalid submit', S.wa.length === n0);
    // bad phone
    await fillCheckout(page, { ...CUSTOMER, phone: '12', notes: 'اتصل قبل الوصول' });
    n0 = S.wa.length;
    await page.locator('#co-submit').click();
    await page.waitForTimeout(300);
    const ph = await page.evaluate(() => ({ inv: document.querySelector('#co-phone').getAttribute('aria-invalid'), err: (document.getElementById('co-phone-err') || {}).textContent, hidden: (document.getElementById('co-phone-err') || {}).hidden, active: document.activeElement && document.activeElement.id }));
    c('phone "12" rejected with a specific inline error, focus on phone', ph.inv === 'true' && !ph.hidden && !!(ph.err || '').trim() && ph.active === 'co-phone', ph);
    c('no WhatsApp navigation with a bad phone', S.wa.length === n0);
    const others = await page.evaluate(() => ['name', 'area', 'block', 'street', 'house'].filter((f) => document.querySelector(`#checkout-form [name="${f}"]`).getAttribute('aria-invalid') === 'true'));
    c('fixed fields are no longer flagged', !others.length, others);
    const inputs = await page.evaluate(() => [...document.querySelectorAll('#checkout-form input:not([type=radio]):not([type=checkbox]), #checkout-form select, #checkout-form textarea')].map((el) => parseFloat(getComputedStyle(el).fontSize)));
    c('form controls ≥ 16px (no iOS zoom)', inputs.every((x) => x >= 16), inputs);
    // Arabic-Indic digits accepted
    await page.locator('#checkout-form [name="phone"]').fill(CUSTOMER.phone);
    const url = await submitForWa(S);
    c('Arabic-digit phone "٩٧٩٣٧٥٥٦" accepted → navigates to wa.me', !!url, url && short(url, 80));
    if (!url) return;
    const avail = lines.map((p) => ({ id: String(p.id), qty: cart[p.id], lineFils: p.p * cart[p.id] }));
    if (bo) avail.push({ id: String(bo.id), qty: 1, lineFils: bo.p });
    const govName = await T(page, 'checkout.govHawalli');
    const payLabel = await T(page, 'order.payKnet');
    const { text, ref } = await assertMessage(c, page, site, url, {
      loc: 'ar', lines: avail, excluded: pk.oos ? [pk.oos.id] : [], backorder: bo && bo.id, subtotal: avail.reduce((s, l) => s + l.lineFils, 0),
      delivery: 'tbc', customer: { ...CUSTOMER, phone: '97937556' }, govName, payLabel, notes: 'اتصل قبل الوصول', src: 'ig',
    });
    c('message is in Arabic for the Arabic UI', /[؀-ۿ]/.test(text.split('\n')[1] || ''), text.split('\n')[1]);
    // confirmation state
    await page.waitForSelector('#co-done:not([hidden])', { timeout: 5000 }).catch(() => {});
    const done = await page.evaluate(() => { const d = document.getElementById('co-done'); return d ? { hidden: d.hidden, text: d.innerText } : null; });
    c('"one last step" state shown with the order ref', done && !done.hidden && ref && done.text.includes(ref), done && short(done.text, 120));
    const reopen = await page.evaluate(() => { const a = [...document.querySelectorAll('#co-done a[href^="https://wa.me/"]')][0]; return a ? a.getAttribute('href') : null; });
    c('"Reopen WhatsApp" is a real <a href> to the same message', reopen === url, short(reopen || '', 80));
    const orders = await getStore(page, 'orders');
    c('order saved as pending (gbq8:v2:orders)', Array.isArray(orders) && orders[0] && orders[0].ref === ref && orders[0].status === 'pending', orders && orders[0] && { ref: orders[0].ref, status: orders[0].status });
    c('customer details NOT saved without opt-in', (await getStore(page, 'customer')) === null);
    const copyBtn = page.locator('#co-done [data-action="checkout-copy"]');
    if (await copyBtn.count()) {
      await copyBtn.click();
      await page.waitForTimeout(300);
      const clip = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch { return null; } });
      const ta = await page.evaluate(() => { const t = document.getElementById('co-copytext'); return t && !t.closest('[hidden]') ? t.value : null; });
      const copied = clip || ta || '';
      c('"Copy order text" copies the full message', copied.includes(ref) && copied.includes(`[#${avail[0].id}]`), short(copied, 80));
    } else c('copy button present', false);
    // pending banner elsewhere
    await open(S, '');
    const ban = await page.evaluate(() => { const b = document.getElementById('gb-banner'); return b ? { hidden: b.hidden || !b.innerHTML.trim(), text: b.innerText, link: !!b.querySelector('a[href*="checkout/?ref="]') } : null; });
    c('pending-order banner on other pages with "complete order"', ban && !ban.hidden && ban.text.includes(ref) && ban.link, ban);
    await open(S, 'checkout/?ref=' + encodeURIComponent(ref));
    await page.waitForSelector('#co-done:not([hidden]) [data-action="checkout-sent"]', { timeout: 6000 });
    await page.locator('#co-done [data-action="checkout-sent"]').click();
    await page.waitForTimeout(250);
    const o2 = await getStore(page, 'orders');
    const cart2 = await getStore(page, 'cart');
    c('"Order sent ✓" marks the order sent and clears the cart', o2 && o2[0].status === 'sent' && (!cart2 || !Object.keys(cart2).length), { status: o2 && o2[0].status, cart: cart2 });
    await open(S, '');
    const ban2 = await page.evaluate(() => { const b = document.getElementById('gb-banner'); return b ? (b.hidden || !b.innerText.trim()) : true; });
    c('banner gone once sent', ban2);
  });

  /* ================================================================ 12. checkout English + save details */
  flow('checkout (en): English message + opt-in saved details', { vp: 'd1280' }, async (S, c) => {
    const page = S.page;
    const p = pk.inStock[12];
    const bo = pk.backorder;
    await S.seed({ [K('cart')]: bo ? { [p.id]: 1, [bo.id]: 1 } : { [p.id]: 1 } });
    await gotoCheckout(S, 'en');
    await fillCheckout(page, { ...CUSTOMER, phone: '96597937556', payment: 'cod', save: true });
    const url = await submitForWa(S);
    c('submit → wa.me', !!url);
    if (!url) return;
    const text = decodeWa(url);
    c('English UI → English message (title/labels Latin)', !/[؀-ۿ]/.test(text.split('\n')[0]) && /KWD/.test(text), short(text, 120));
    c('English product name used', text.includes(p.n.en), p.n.en);
    c('amounts "x.xxx KWD"', text.includes(money(p.p, 'en')), money(p.p, 'en'));
    if (bo) {
      const tag = await T(page, 'order.msgBackorder');
      const line = text.split('\n').find((x) => x.includes(`[#${bo.id}]`)) || '';
      c('backorder line tagged (pre-order)', !!tag && line.includes(tag) && line.includes(bo.n.en), { line, tag });
    }
    const pay = await T(page, 'order.payCod');
    c('payment = cash on delivery', !!pay && text.includes(pay), pay);
    const cust = await getStore(page, 'customer');
    c('phone with 965 prefix normalised in the message', text.includes('97937556') && !text.includes('96597937556'), (text.split('\n').find((x) => x.includes('9793')) || '').slice(0, 60));
    c('details saved only with opt-in', cust && cust.phone === '97937556' && cust.area === CUSTOMER.area, cust);
    // prefill on next visit
    await S.seed({ [K('cart')]: { [p.id]: 1 }, [K('customer')]: cust });
    await gotoCheckout(S, 'en');
    const pre = await page.locator('#checkout-form [name="area"]').inputValue();
    c('saved details prefill the form', pre === CUSTOMER.area, pre);
  });

  /* ================================================================ 13. 20-item length cap */
  flow('checkout: 20-item cart respects the 6000-char wa.me cap', { vp: 'd1280' }, async (S, c) => {
    const page = S.page;
    const items = pk.inStock.slice(0, 20);
    const cart = Object.fromEntries(items.map((p, i) => [p.id, (i % 3) + 1]));
    await S.seed({ [K('cart')]: cart });
    await gotoCheckout(S, 'ar');
    await fillCheckout(page, { ...CUSTOMER, notes: 'الرجاء الاتصال قبل التوصيل بنصف ساعة، والبيت في الزاوية بجانب المسجد، البوابة السوداء.' });
    const url = await submitForWa(S);
    c('submit → wa.me', !!url);
    if (!url) return;
    c(`wa.me URL ≤ 6000 chars (${url.length})`, url.length <= 6000, url.length);
    const text = decodeWa(url);
    const miss = items.filter((p) => !new RegExp(`#${p.id}(?!\\d)`).test(text)).map((p) => p.id);
    c('every item id still in the (shortened) message', !miss.length, miss);
    c('totals + ref survive shortening', /GB-\d{6}-\w{4}/.test(text) && text.includes(money(items.reduce((s, p) => s + p.p * cart[p.id], 0), 'ar')), short(text.split('\n').slice(-8).join(' | '), 200));
    const orders = await getStore(page, 'orders');
    const full = orders && orders[0] && orders[0].message;
    c('full untruncated text kept for "Copy order text"', !!full && items.every((p) => full.includes(`[#${p.id}]`) && full.includes(p.n.ar)), full && full.length);
  });

  /* ================================================================ 14. delivery confirmed=true variant */
  flow('delivery confirmed=true variant (second build)', { vp: 'm390', variant: 'confirmed' }, async (S, c) => {
    const page = S.page;
    const cfg = await (async () => { await open(S, ''); return page.evaluate(() => GB.cfg.delivery); })();
    c('variant build has delivery.confirmed=true', cfg && cfg.confirmed === true, cfg);
    const fee = (cfg && cfg.feeFils) || 1500, free = (cfg && cfg.freeOverFils) || 25000;
    const small = pk.under(free - 100).filter((p) => p.p * 1 < free)[2] || pk.cheapest;
    await S.seed({ [K('cart')]: { [small.id]: 1 } });
    await open(S, '');
    await openDialog(page, 'gb-cart');
    await page.waitForSelector('#gb-cart li[data-id]', { timeout: 6000 });
    let ft = await page.evaluate(() => document.getElementById('gb-cart-foot').innerText);
    c('below threshold: fee shown + total = subtotal + fee', ft.includes(money(fee, 'ar').split(' ')[0]) && ft.includes(money(small.p + fee, 'ar').split(' ')[0]), short(ft, 200));
    c('free-delivery progress bar appears', (await page.locator('#gb-cart .gb-cart-free').count()) > 0);
    await page.keyboard.press('Escape');
    await gotoCheckout(S, 'ar');
    await fillCheckout(page, CUSTOMER);
    let url = await submitForWa(S);
    const vPid = await page.evaluate(() => GB.cfg.publishId);
    if (url) await assertMessage(c, page, site, url, { loc: 'ar', lines: [{ id: String(small.id), qty: 1, lineFils: small.p }], subtotal: small.p, delivery: 'fee', fee, publishId: vPid });
    else c('submit → wa.me (fee case)', false);
    const qty = Math.ceil(free / small.p) + 1;
    await S.seed({ [K('cart')]: { [small.id]: Math.min(99, qty) } });
    const sub = small.p * Math.min(99, qty);
    await open(S, '');
    await openDialog(page, 'gb-cart');
    await page.waitForSelector('#gb-cart li[data-id]', { timeout: 6000 });
    ft = await page.evaluate(() => document.getElementById('gb-cart-foot').innerText);
    const freeTxt = await T(page, 'cart.deliveryFree');
    c(`≥ ${money(free, 'ar')}: delivery free, total = subtotal`, sub >= free && !!freeTxt && ft.includes(freeTxt), { sub, foot: short(ft, 200) });
    await page.keyboard.press('Escape');
    await gotoCheckout(S, 'ar');
    await fillCheckout(page, CUSTOMER);
    url = await submitForWa(S);
    if (url) await assertMessage(c, page, site, url, { loc: 'ar', lines: [{ id: String(small.id), qty: Math.min(99, qty), lineFils: sub }], subtotal: sub, delivery: 'free', publishId: vPid });
    else c('submit → wa.me (free case)', false);
  });

  /* ================================================================ 15. 404 recovery */
  flow('404: old product URL recovery + helpful not-found', { vp: 'm390', allow404: true }, async (S, c) => {
    const page = S.page;
    const target = P.get('10736') || site.products[0];
    await page.goto(S.url(`p/old-slug-${target.id}/`));
    const ok = await page.waitForURL((u) => u.pathname.endsWith('/' + target.s), { timeout: 8000 }).then(() => true, () => false);
    c(`/p/old-slug-${target.id}/ → ${target.s}`, ok, page.url());
    await page.goto(S.url(`en/p/whatever-${target.id}/?src=ig`));
    const ok2 = await page.waitForURL((u) => u.pathname.endsWith('/en/' + target.s), { timeout: 8000 }).then(() => true, () => false);
    c('English old URL → English product page (locale preserved)', ok2 && (await page.evaluate(() => document.documentElement.lang)).startsWith('en'), page.url());
    c('query string preserved across the redirect', new URL(page.url()).searchParams.get('src') === 'ig', page.url());
    await page.goto(S.url('p/gone-99999999/'));
    await page.waitForTimeout(800);
    const nf = await page.evaluate(() => ({ cls: document.body.className, h1: (document.querySelector('h1') || {}).textContent, search: !!document.querySelector('main form[role="search"] input[name="q"], main form input[name="q"]'), cats: document.querySelectorAll('main a[href*="/c/"]').length, wait: document.documentElement.classList.contains('nf-wait') }));
    c('unknown product id → helpful 404 (search + categories)', /page-notfound/.test(nf.cls) && !!nf.h1 && nf.search && nf.cats >= 3 && !nf.wait, nf);
    await page.goto(S.url('en/no-such-page/'));
    await page.waitForTimeout(800);
    const nfe = await page.evaluate(() => ({ lang: document.documentElement.lang, path: location.pathname, cls: document.body.className }));
    c('unknown English path → English 404, address kept', nfe.lang.startsWith('en') && /page-notfound/.test(nfe.cls) && nfe.path.endsWith('/en/no-such-page/'), nfe);
  });

  /* ================================================================ 16. storage disabled */
  flow('storage disabled: site still works in memory', { vp: 'm390' }, async (S, c) => {
    const page = S.page;
    await S.ctx.addInitScript(() => { try { Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } }); } catch (e) { /* ignore */ } });
    await open(S, `c/${pk.category}/`);
    const btn = page.locator('main [data-listing] .gb-card [data-action="add-to-cart"]:visible').first();
    await btn.click();
    await page.waitForTimeout(150);
    const b = await cartBadge(page);
    c('add to cart works without storage', b && b.text === '1', b);
    await openDialog(page, 'gb-cart');
    const ok = await page.waitForSelector('#gb-cart li[data-id]', { timeout: 6000 }).then(() => true, () => false);
    c('cart drawer renders without storage', ok);
  });

  /* ---------------------------------------------------------------- run */
  let variantSrv = null;
  for (const f of flows) {
    let srvFor = srv;
    if (f.opts.variant === 'confirmed') {
      if (!variantSrv) variantSrv = await R.step('build + serve delivery.confirmed=true variant', () => env.variant(['--set', 'delivery.confirmed=true']));
      if (!variantSrv) continue;
      srvFor = variantSrv;
    }
    const S = await session(browser, srvFor, f.opts);
    const c = (name, pass, info) => R.check(`${f.name} › ${name}`, pass, info);
    try {
      await R.step(`${f.name} › (flow crashed)`, () => f.fn(S, c));
      const errs = S.errors(), fails = S.failed();
      c('0 console errors / failed same-origin requests', !errs.length && !fails.length, { errors: errs.slice(0, 5), failed: fails.slice(0, 5) });
    } finally { await S.close(); }
  }
}
