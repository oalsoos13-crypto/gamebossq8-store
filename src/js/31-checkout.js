/* 31-checkout.js — cart module, part 2: WhatsApp order builder (GB.order, pure functions, unit-tested by
   tools/verify/cart-message.test.mjs) + the checkout/ page (SPEC §5).
   Flow: validate → ref GB-YYMMDD-XXXX → GB.orders.add (pending) → build message → location.href = wa.me
   SYNCHRONOUSLY inside the submit handler → "one last step" state (reopen WhatsApp <a>, copy text, "sent ✓").
   Actions owned here: checkout-copy, checkout-sent, checkout-retry. Event: checkout:submitted {ref, url}. */

/* ------------------------------------------------------------------ pure order helpers */
const ORDER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const WA_MAX_URL = 6000;
const MSG_SEP = '———';
const GOV_KEYS = { capital: 'checkout.govCapital', hawalli: 'checkout.govHawalli', farwaniya: 'checkout.govFarwaniya', ahmadi: 'checkout.govAhmadi', jahra: 'checkout.govJahra', mubarak: 'checkout.govMubarak' };
const PAY_KEYS = { cod: 'order.payCod', knet_link: 'order.payKnet' };

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits → Latin. */
function normDigits(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0));
}
/** Phone → bare national digits: normalize digits, strip everything else, strip a leading 00965 / 965. */
function normPhone(raw) {
  let d = normDigits(raw).replace(/\D/g, '');
  if (d.length === 13 && d.indexOf('00965') === 0) d = d.slice(5);
  else if (d.length === 11 && d.indexOf('965') === 0) d = d.slice(3);
  return d;
}
const validPhone = (d) => /^[24569]\d{7}$/.test(String(d || ''));
/** Trim, collapse whitespace, Latin digits, cap length. */
function cleanText(s, max) {
  return Array.from(normDigits(s).replace(/\s+/g, ' ').trim()).slice(0, max || 200).join('').trim();
}
/** Clip to max characters (code points) with an ellipsis. */
function clipText(s, max) {
  const a = Array.from(String(s || ''));
  return a.length <= max ? a.join('') : a.slice(0, max - 1).join('').trim() + '…';
}
/** GB-YYMMDD-XXXX (local date; X from a 32-letter alphabet without 0/O/1/I). rand() → [0,1) for tests. */
function makeRef(now, rand) {
  const d = now || new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  let bytes = null;
  if (!rand) {
    try { bytes = new Uint8Array(4); (window.crypto || window.msCrypto).getRandomValues(bytes); } catch (e) { bytes = null; }
  }
  let x = '';
  for (let i = 0; i < 4; i++) {
    const n = bytes ? bytes[i] % 32 : Math.floor((rand || Math.random)() * 32) % 32;
    x += ORDER_ALPHABET[n];
  }
  return 'GB-' + String(d.getFullYear()).slice(2) + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + x;
}
function govName(id) { return GOV_KEYS[id] ? GB.t(GOV_KEYS[id]) : String(id || ''); }
/** "<gov> — <area>، قطعة <>، شارع <>[، جادة <>]، منزل <>" */
function addressText(c) {
  const T = GB.t;
  return [govName(c.governorate) + ' — ' + c.area, T('order.msgBlock', { v: c.block }), T('order.msgStreet', { v: c.street }),
    c.avenue ? T('order.msgAvenue', { v: c.avenue }) : '', T('order.msgHouse', { v: c.house })].filter(Boolean).join(T('order.msgSep'));
}
/**
 * The WhatsApp message (SPEC §5), in the page locale. Shortening levels (used only when the wa.me URL would exceed
 * 6000 chars; Arabic text percent-encodes to ~6 chars per letter, so the fixed part alone is ~1500):
 *   0 full · 1 names ≤ 40 chars · 2 item lines "• [#id] × qty = total" (SPEC) · 3 notes ≤ 60 chars ·
 *   4 all items on one line "• #id×qty، #id×qty…" · 5 notes left out (the full text stays available via "copy").
 * o = { ref, locale, lines: [{id, name, qty, lineFils, backorder}], totals (GB.cart.totals), customer: {name, phone,
 *       governorate, area, block, street, avenue, house, notes}, payment: 'cod'|'knet_link', src, publishId }
 */
function orderText(o, level) {
  const T = GB.t;
  const M = (f) => GB.money(f, o.locale);
  const lv = level || 0;
  const out = [T('order.msgTitle'), T('order.msgRef', { ref: o.ref }), MSG_SEP];
  if (lv >= 4) out.push(T('order.msgLinesCompact', { list: o.lines.map((l) => '#' + l.id + '×' + l.qty).join(T('order.msgSep')) }));
  else o.lines.forEach((l) => {
    if (lv >= 2) { out.push(T('order.msgLineShort', { id: l.id, qty: l.qty, total: M(l.lineFils) })); return; }
    let s = T('order.msgLine', { id: l.id, name: lv >= 1 ? clipText(l.name, 40) : l.name, qty: l.qty, total: M(l.lineFils) });
    if (l.backorder) s += ' ' + T('order.msgBackorder');
    out.push(s);
  });
  out.push(MSG_SEP);
  const t = o.totals;
  out.push(T('order.msgSubtotal', { v: M(t.subtotalFils) }));
  if (t.confirmed) {
    out.push(T('order.msgDelivery', { v: t.deliveryFils ? M(t.deliveryFils) : T('order.msgFree') }));
    out.push(T('order.msgTotal', { v: M(t.totalFils) }));
  } else {
    out.push(T('order.msgDelivery', { v: T('order.msgDeliveryTbc') }));
    out.push(T('order.msgTotal', { v: T('order.msgPlusDelivery', { amount: M(t.subtotalFils) }) }));
  }
  out.push(MSG_SEP);
  const c = o.customer;
  out.push(T('order.msgName', { v: c.name }));
  out.push(T('order.msgPhone', { v: c.phone }));
  out.push(T('order.msgAddress', { v: addressText(c) }));
  if (c.notes && lv < 5) out.push(T('order.msgNotes', { v: lv >= 3 ? clipText(c.notes, 60) : c.notes }));
  out.push(T('order.msgPayment', { v: T(PAY_KEYS[o.payment] || PAY_KEYS.cod) }));
  out.push(MSG_SEP);
  const foot = [];
  if (o.src) foot.push(T('order.msgSource', { v: o.src }));
  foot.push(T('order.msgVersion', { v: o.publishId || GB.cfg.publishId || '' }));
  out.push(foot.join(' · '));
  return out.join('\n');
}
/**
 * Full text (for "copy"), the text actually sent and its wa.me URL. The URL is kept ≤ 6000 chars by shortening
 * step by step (see orderText levels); `over` is true if even the shortest form is longer (the text is then sent
 * anyway: an over-long link still opens on most devices, and the customer can paste the copied text).
 */
function composeOrder(o) {
  const full = orderText(o, 0);
  let level = 0, sent = full, url = GB.wa(full);
  while (url.length > WA_MAX_URL && level < 5) {
    level++;
    sent = orderText(o, level);
    url = GB.wa(sent);
  }
  return { text: full, sent, url, level, over: url.length > WA_MAX_URL };
}
GB.order = { normDigits, normPhone, validPhone, cleanText, clipText, makeRef, text: orderText, compose: composeOrder, address: addressText, MAX_URL: WA_MAX_URL };

/* ------------------------------------------------------------------ checkout page */
const CO_FIELDS = ['name', 'phone', 'governorate', 'area', 'block', 'street', 'avenue', 'house', 'notes'];
const CO_MAX = { name: 60, phone: 12, governorate: 20, area: 40, block: 10, street: 60, avenue: 20, house: 40, notes: 300 };
const CO_REQUIRED = ['name', 'phone', 'governorate', 'area', 'block', 'street', 'house', 'payment'];
const CO_ERR = { name: 'checkout.errName', governorate: 'checkout.errGovernorate', area: 'checkout.errArea', block: 'checkout.errBlock', street: 'checkout.errStreet', house: 'checkout.errHouse', payment: 'checkout.errPayment' };
const CO_LABEL = { name: 'checkout.name', phone: 'checkout.phone', governorate: 'checkout.governorate', area: 'checkout.area', block: 'checkout.block', street: 'checkout.street', house: 'checkout.house', payment: 'checkout.sectionPayment' };

GB.ready(() => {
  if (!document.body.classList.contains('page-checkout')) return;
  const $ = (id) => document.getElementById(id);
  const form = $('checkout-form');
  if (!form) return;
  const page = GB.page() || {};
  const payments = (GB.cfg.payments && GB.cfg.payments.length ? GB.cfg.payments : ['cod', 'knet_link']);
  let attempted = false;
  let tracked = false;
  let doneOrder = null;
  let rendering = false;

  function show(which) {
    ['co-boot', 'co-empty', 'co-main', 'co-done'].forEach((id) => { const el = $(id); if (el) el.hidden = id !== which; });
    const lead = GB.$('.gb-co-head .gb-pagehead__sub');
    if (lead) lead.hidden = which === 'co-done';
  }
  function focusEl(el) { if (el) { try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); } } }

  /* ---------------- order summary */
  function renderSummary() {
    const box = $('co-summary');
    const submit = $('co-submit');
    const map = GB.productsMap;
    if (!box || !map || rendering || doneOrder) return;
    rendering = true;
    try {
      const lines = GB.cart.lines(map);
      if (!lines.length) { show('co-empty'); return; }
      GB.cartUI.notePrices(lines, map);
      const t = GB.cart.totals(lines);
      const avail = lines.filter((l) => l.available);
      const na = lines.filter((l) => !l.available);
      const li = (l) => '<li class="gb-co-line' + (l.available ? '' : ' is-unavailable') + '">' +
        '<span class="gb-co-line__qty"><span class="gb-sr">' + GB.esc(GB.t('common.qty')) + ' </span><bdi dir="ltr">' + l.qty + '×</bdi></span>' +
        '<span class="gb-co-line__name">' + GB.cartUI.nameHtml(l.name) +
        (l.backorder ? ' ' + GB.cartUI.stock('backorder') : '') +
        (l.available ? '' : ' <span class="gb-stock gb-stock--out_of_stock">' + GB.esc(GB.t('checkout.excluded')) + '</span>') + '</span>' +
        (l.available ? '<span class="gb-co-line__total">' + GB.moneyHtml(l.lineFils) + '</span>' : '') + '</li>';
      box.innerHTML = (GB.cartUI.hasPriceNotice(lines) ? '<p class="gb-alert gb-co-notice">' + GB.icon('info') + '<span>' + GB.esc(GB.t('common.priceUpdated')) + '</span></p>' : '') +
        '<ul class="gb-co-lines" role="list">' + avail.concat(na).map(li).join('') + '</ul>' + GB.cartUI.totalsHtml(t) +
        (avail.length ? '' : '<p class="gb-alert gb-alert--error">' + GB.icon('alert') + '<span>' + GB.esc(GB.t('cart.allUnavailable')) + '</span></p>');
      if (submit) submit.disabled = !avail.length;
      if (!tracked && avail.length) {
        tracked = true;
        GB.track('begin_checkout', { value: t.subtotalFils, items: t.itemCount });
      }
    } finally { rendering = false; }
  }
  function loadSummary() {
    const box = $('co-summary');
    const submit = $('co-submit');
    if (submit) submit.disabled = true;
    GB.products().then(renderSummary, () => {
      if (!box) return;
      box.innerHTML = '<div class="gb-alert gb-alert--error" role="alert">' + GB.icon('alert') + '<div><p>' + GB.esc(GB.t('common.error')) + '</p>' +
        '<button type="button" class="gb-btn gb-btn--light" data-action="checkout-retry">' + GB.icon('refresh') + '<span>' + GB.esc(GB.t('common.retry')) + '</span></button></div></div>';
    });
  }
  GB.on('click', '[data-action="checkout-retry"]', (e) => {
    e.preventDefault();
    $('co-summary').innerHTML = '<p class="gb-muted" role="status">' + GB.esc(GB.t('common.loading')) + '</p>';
    loadSummary();
  });
  GB.listen('cart:change', () => {
    if (doneOrder) return;
    if (!GB.cart.size()) { show('co-empty'); return; }
    if ($('co-main').hidden) { show('co-main'); loadSummary(); return; }
    renderSummary();
  });
  GB.listen('cart:prices', renderSummary);

  /* ---------------- form helpers */
  const control = (f) => (f === 'payment' ? GB.$('.gb-co-pays', form) : form.elements[f]);
  function readForm() {
    const v = {};
    CO_FIELDS.forEach((f) => { v[f] = form.elements[f] ? cleanText(form.elements[f].value, CO_MAX[f]) : ''; });
    v.phone = normPhone(form.elements.phone.value);
    const pay = GB.$('input[name="payment"]:checked', form);
    v.payment = pay ? pay.value : '';
    v.save = !!(form.elements.save && form.elements.save.checked);
    return v;
  }
  function errorKey(f, v) {
    if (f === 'phone') return !v.phone ? 'checkout.errPhoneEmpty' : (validPhone(v.phone) ? null : 'checkout.errPhone');
    if (f === 'payment') return payments.indexOf(v.payment) !== -1 ? null : CO_ERR.payment;
    if (f === 'governorate') return GOV_KEYS[v.governorate] ? null : CO_ERR.governorate;
    if (f === 'name') return Array.from(v.name).length >= 2 ? null : CO_ERR.name;
    return v[f] ? null : CO_ERR[f];
  }
  function setError(f, key) {
    const box = $('co-' + f + '-err');
    const el = control(f);
    if (!box || !el) return;
    if (key) {
      box.innerHTML = GB.icon('alert') + '<span>' + GB.esc(GB.t(key)) + '</span>';
      box.hidden = false;
      el.setAttribute('aria-invalid', 'true');
    } else {
      box.innerHTML = '';
      box.hidden = true;
      el.removeAttribute('aria-invalid');
    }
  }
  function focusField(f) {
    const el = f === 'payment' ? (GB.$('input[name="payment"]:checked', form) || GB.$('input[name="payment"]', form)) : form.elements[f];
    focusEl(el);
  }
  function showSummaryErrors(errs) {
    const box = $('co-errors');
    if (!errs.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = GB.icon('alert') + '<div><p class="gb-co-errors__title">' + GB.esc(GB.t('checkout.errSummary', { n: errs.length })) + '</p><ul class="gb-co-errors__list">' +
      errs.map((x) => '<li><a href="#co-' + (x[0] === 'payment' ? 'pay-' + GB.esc(payments[0]) : GB.esc(x[0])) + '" data-co-field="' + GB.esc(x[0]) + '">' +
        GB.esc(GB.t(CO_LABEL[x[0]])) + ': ' + GB.esc(GB.t(x[1])) + '</a></li>').join('') + '</ul></div>';
    box.hidden = false;
  }
  GB.on('click', '[data-co-field]', (e, el) => { e.preventDefault(); focusField(el.getAttribute('data-co-field')); });

  function validateAll() {
    const v = readForm();
    const errs = [];
    CO_REQUIRED.forEach((f) => { const k = errorKey(f, v); setError(f, k); if (k) errs.push([f, k]); });
    return { v, errs };
  }
  // live re-validation once the customer has tried to submit (or the field was already flagged)
  function revalidate(e) {
    const t = e.target;
    if (!t || !t.name) return;
    const f = t.name;
    if (CO_REQUIRED.indexOf(f) === -1) return;
    const flagged = (control(f) || {}).getAttribute && control(f).getAttribute('aria-invalid') === 'true';
    if (!attempted && !flagged) return;
    if (e.type === 'input' && !flagged) return; // don't nag while typing a fresh value
    setError(f, errorKey(f, readForm()));
    if (attempted) {
      const remaining = CO_REQUIRED.map((x) => [x, errorKey(x, readForm())]).filter((x) => x[1]);
      if (!remaining.length) showSummaryErrors([]);
    }
  }
  form.addEventListener('input', revalidate);
  form.addEventListener('change', revalidate);
  form.addEventListener('focusout', (e) => { if (attempted && e.target && e.target.name && e.target.type !== 'radio') revalidate({ type: 'change', target: e.target }); });

  // phone: accept pasted "+965 9793 7556" etc. despite maxlength=12 (normalise before inserting)
  form.elements.phone.addEventListener('paste', (e) => {
    const txt = (e.clipboardData || window.clipboardData || { getData: () => '' }).getData('text');
    if (!txt) return;
    const d = normPhone(txt);
    if (d && d.length <= 12) {
      e.preventDefault();
      form.elements.phone.value = d;
      form.elements.phone.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  // area suggestions per governorate (free text stays allowed)
  function updateAreas() {
    const dl = $('co-area-list');
    const list = (page.areas && page.areas[form.elements.governorate.value]) || [];
    if (dl) dl.innerHTML = list.map((a) => '<option value="' + GB.esc(a) + '"></option>').join('');
  }
  form.elements.governorate.addEventListener('change', updateAreas);

  function prefill() {
    const c = GB.customer.get();
    if (!c) return;
    CO_FIELDS.forEach((f) => { if (f !== 'notes' && typeof c[f] === 'string' && form.elements[f]) form.elements[f].value = c[f]; });
    if (c.payment) { const r = GB.$('input[name="payment"][value="' + String(c.payment).replace(/[^\w]/g, '') + '"]', form); if (r) r.checked = true; }
    if (form.elements.save) form.elements.save.checked = true;
    updateAreas();
  }

  /* ---------------- submit → WhatsApp (synchronous: no await before location.href) */
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    attempted = true;
    const res = validateAll();
    showSummaryErrors(res.errs);
    if (res.errs.length) {
      // bring the role=alert summary into view (below the sticky header), then focus the first invalid field
      const box = $('co-errors');
      try { box.scrollIntoView({ block: 'start', behavior: 'auto' }); } catch (err) { /* old browser */ }
      const f = res.errs[0][0];
      const el = f === 'payment' ? (GB.$('input[name="payment"]:checked', form) || GB.$('input[name="payment"]', form)) : form.elements[f];
      const r = el && el.getBoundingClientRect();
      const visible = r && r.top >= 0 && r.bottom <= (window.innerHeight || 0);
      if (el) { try { el.focus({ preventScroll: !!visible }); } catch (err) { el.focus(); } }
      return;
    }
    const map = GB.productsMap;
    if (!map) return;
    const lines = GB.cart.lines(map).filter((l) => l.available);
    if (!lines.length) return;
    const v = res.v;
    const totals = GB.cart.totals(lines);
    const customer = { name: v.name, phone: v.phone, governorate: v.governorate, area: v.area, block: v.block, street: v.street, avenue: v.avenue, house: v.house, notes: v.notes };
    const order = {
      ref: makeRef(),
      at: Date.now(),
      locale: GB.locale,
      status: 'pending',
      lines: lines.map((l) => ({ id: l.id, name: l.name, qty: l.qty, unitFils: l.unitFils, lineFils: l.lineFils, backorder: l.backorder })),
      totals: { subtotalFils: totals.subtotalFils, itemCount: totals.itemCount, confirmed: totals.confirmed, deliveryFils: totals.deliveryFils, totalFils: totals.totalFils },
      customer,
      payment: v.payment,
      src: GB.src(),
      publishId: GB.cfg.publishId || '',
    };
    const msg = composeOrder(order);
    order.message = msg.text;
    order.waUrl = msg.url;
    order.trimmed = msg.level > 0;
    GB.orders.add(order);
    if (v.save) GB.customer.set(Object.assign({ payment: v.payment }, customer, { notes: undefined }));
    else GB.customer.clear();
    GB.track('wa_handoff', { value: totals.totalFils !== null ? totals.totalFils : totals.subtotalFils, items: totals.itemCount });
    try { history.replaceState(history.state, '', GB.url('checkout/') + '?ref=' + encodeURIComponent(order.ref)); } catch (err) { /* ignore */ }
    renderDone(order, true);
    GB.emit('checkout:submitted', { ref: order.ref, url: msg.url });
    location.href = msg.url;
  });

  /* ---------------- "one last step" / sent states */
  function detailsHtml(o) {
    const c = o.customer || {};
    const items = (o.lines || []).map((l) => '<li class="gb-co-line"><span class="gb-co-line__qty"><span class="gb-sr">' + GB.esc(GB.t('common.qty')) + ' </span><bdi dir="ltr">' +
      GB.esc(l.qty) + '×</bdi></span><span class="gb-co-line__name">' + GB.cartUI.nameHtml(l.name) + (l.backorder ? ' ' + GB.cartUI.stock('backorder') : '') + '</span>' +
      '<span class="gb-co-line__total">' + GB.moneyHtml(l.lineFils) + '</span></li>').join('');
    const t = Object.assign({ itemCount: 0 }, o.totals || {});
    return '<section class="gb-panel gb-co-details" aria-labelledby="co-details-title"><h2 class="gb-co-h" id="co-details-title">' + GB.esc(GB.t('order.details')) + '</h2>' +
      '<h3 class="gb-co-sub">' + GB.esc(GB.t('order.items')) + '</h3><ul class="gb-co-lines" role="list">' + items + '</ul>' + GB.cartUI.totalsHtml(Object.assign({}, t, { itemCount: 0 })) +
      '<dl class="gb-co-facts"><div><dt>' + GB.esc(GB.t('order.deliverTo')) + '</dt><dd>' + GB.esc(c.name) + ' · <bdi dir="ltr">' + GB.esc(c.phone) + '</bdi><br>' +
      GB.esc(addressText(c)) + (c.notes ? '<br>' + GB.esc(c.notes) : '') + '</dd></div>' +
      '<div><dt>' + GB.esc(GB.t('order.payment')) + '</dt><dd>' + GB.esc(GB.t(PAY_KEYS[o.payment] || PAY_KEYS.cod)) + '</dd></div></dl></section>';
  }
  function renderDone(o, focus) {
    doneOrder = o;
    const box = $('co-done');
    const sent = o.status === 'sent';
    const reopen = '<a class="gb-btn ' + (sent ? 'gb-btn--light' : 'gb-btn--wa gb-btn--lg') + '" href="' + GB.esc(o.waUrl || GB.wa(o.message || '')) + '" target="_blank" rel="noopener">' +
      GB.icon('whatsapp') + '<span>' + GB.esc(GB.t('order.reopen')) + '</span><span class="gb-sr"> ' + GB.esc(GB.t('a11y.newTab')) + '</span></a>';
    const copy = '<button type="button" class="gb-btn gb-btn--light" data-action="checkout-copy">' + GB.icon('copy') + '<span>' + GB.esc(GB.t('order.copy')) + '</span></button>';
    let actions;
    if (sent) {
      actions = '<a class="gb-btn gb-btn--primary gb-btn--lg" href="' + GB.esc(GB.url('')) + '">' + GB.esc(GB.t('common.backHome')) + '</a>' + reopen + copy;
    } else {
      actions = reopen + copy +
        '<button type="button" class="gb-btn gb-btn--primary" data-action="checkout-sent" aria-describedby="co-sent-hint"><span>' + GB.esc(GB.t('order.markSent')) + '</span></button>';
    }
    box.innerHTML = '<div class="gb-panel gb-co-done__card' + (sent ? ' is-sent' : '') + '">' +
      '<span class="gb-co-done__icon" aria-hidden="true">' + GB.icon(sent ? 'check' : 'whatsapp') + '</span>' +
      '<h2 class="gb-co-done__title" id="co-done-title" tabindex="-1">' + GB.esc(GB.t(sent ? 'order.sentTitle' : 'order.doneTitle')) + '</h2>' +
      '<p class="gb-co-done__text">' + GB.esc(GB.t(sent ? 'order.sentText' : 'order.doneText')) + '</p>' +
      '<p class="gb-co-ref">' + GB.esc(GB.t('order.refLabel')) + ': <bdi dir="ltr"><strong>' + GB.esc(o.ref) + '</strong></bdi></p>' +
      (o.trimmed && !sent ? '<p class="gb-alert gb-co-trimmed">' + GB.icon('info') + '<span>' + GB.esc(GB.t('order.trimmed')) + '</span></p>' : '') +
      '<div class="gb-co-done__actions">' + actions + '</div>' +
      (sent ? '' : '<p class="gb-hint gb-co-done__hint" id="co-sent-hint">' + GB.esc(GB.t('order.markSentHint')) + '</p>') +
      '<div class="gb-co-copybox" id="co-copybox" hidden><label class="gb-label" for="co-copytext">' + GB.esc(GB.t('order.copyManual')) + '</label>' +
      '<textarea class="gb-textarea gb-co-copybox__text" id="co-copytext" readonly rows="10" aria-label="' + GB.esc(GB.t('order.copyFieldLabel')) + '"></textarea></div>' +
      '</div>' + detailsHtml(o);
    show('co-done');
    if (focus) focusEl($('co-done-title'));
  }
  GB.on('click', '[data-action="checkout-copy"]', (e) => {
    e.preventDefault();
    if (!doneOrder) return;
    const text = doneOrder.message || '';
    const manual = () => {
      const box = $('co-copybox');
      const ta = $('co-copytext');
      if (!box || !ta) return;
      box.hidden = false;
      ta.value = text;
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand && document.execCommand('copy'); } catch (err) { ok = false; }
      if (ok) GB.toast(GB.t('order.copied'));
    };
    if (navigator.clipboard && window.isSecureContext && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(() => GB.toast(GB.t('order.copied')), manual);
    } else manual();
  });
  GB.on('click', '[data-action="checkout-sent"]', (e) => {
    e.preventDefault();
    if (!doneOrder) return;
    GB.orders.markSent(doneOrder.ref);
    const o = GB.orders.get(doneOrder.ref) || Object.assign({}, doneOrder, { status: 'sent' });
    GB.cart.clear();
    renderDone(o, true);
  });

  /* ---------------- boot */
  let ref = null;
  let buy = null;
  try { const qs = new URLSearchParams(location.search); ref = qs.get('ref'); buy = qs.get('buy'); } catch (e) { ref = null; }
  // "Buy now" hand-off from a product page when storage is disabled: ?buy=<id>:<qty> (validated, then removed)
  if (buy && !ref) {
    const m = /^(\d{1,10}):(\d{1,2})$/.exec(buy);
    if (m && !GB.cart.has(m[1])) GB.cart.add(m[1], Number(m[2]));
    try { history.replaceState(history.state, '', GB.url('checkout/')); } catch (e) { /* ignore */ }
  }
  if (ref) {
    const o = GB.orders.get(ref);
    if (o && o.message) { renderDone(o, false); return; }
    GB.toast(GB.t('order.notFound'));
    try { history.replaceState(history.state, '', GB.url('checkout/')); } catch (e) { /* ignore */ }
  }
  if (!GB.cart.size()) { show('co-empty'); return; }
  show('co-main');
  prefill();
  loadSummary();
});
