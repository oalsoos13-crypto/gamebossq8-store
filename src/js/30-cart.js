/* 30-cart.js — cart module, part 1 (every page):
     • the #gb-cart drawer (lines, qty stepper, remove, unavailable lines, price-changed notice, totals per
       config.delivery, checkout CTA, empty state)
     • the price-changed check on load (SPEC §4) and the pending-order banner in #gb-banner (SPEC §5)
     • GB.cartUI — markup helpers shared with 31-checkout.js and 32-wishlist.js
   Page-only strings arrive as pageData.cartI18n (checkout/wishlist pages) and are merged into GB.i18n here.
   Contract: src/CONTRACTS.md §6–7. Actions owned here: cart-inc, cart-dec, cart-remove, cart-remove-unavailable,
   cart-retry, cart-banner-dismiss. */

(function mergePageI18n() {
  const pd = GB.page();
  if (pd && pd.cartI18n && typeof pd.cartI18n === 'object') Object.assign(GB.i18n, pd.cartI18n);
})();

/* ------------------------------------------------------------------ shared markup helpers (delegate to the foundation GB.ui renderers) */
const cartIsCheckout = () => document.body.classList.contains('page-checkout');

GB.cartUI = {
  /** <bdi> product name; Latin-only names get lang=en dir=ltr (same rule as the server nameHtml()). */
  nameHtml(name) { return GB.ui.nameHtml({ n: { ar: name, en: name } }); },
  /** Inline (<span>) 1:1 media box (category art placeholder + lazy image) for cart rows. */
  media(item, cls) {
    const src = item.img ? GB.img(item.img) : '';
    return '<span class="gb-media' + (src ? '' : ' is-empty') + (cls ? ' ' + GB.esc(cls) : '') + '">' + GB.ui.art(item.cat, 'gb-media__ph') +
      (src ? '<img class="gb-media__img" src="' + GB.esc(src) + '" alt="" width="800" height="800" loading="lazy" decoding="async">' : '') + '</span>';
  },
  /** Price block for a compact product (same classes as the server priceBlock()). */
  price(item, size) { return GB.ui.price(item, size); },
  stock(availability, cls) { return GB.ui.stock(availability, cls); },
  /**
   * Totals block for GB.cart.totals() output. config.delivery.confirmed=false → "يتأكد على واتساب" and
   * "X + التوصيل", no free-delivery claims; confirmed=true → fee / free + progress towards the threshold.
   */
  totalsHtml(t) {
    let free = '';
    if (t.confirmed && t.freeOverFils && t.itemCount > 0) {
      const reached = t.remainingForFreeFils === 0;
      const pct = Math.max(4, Math.min(100, Math.round((t.subtotalFils / t.freeOverFils) * 100)));
      free = '<div class="gb-cart-free' + (reached ? ' is-reached' : '') + '"><p class="gb-cart-free__text">' + GB.icon(reached ? 'check' : 'truck') + '<span>' +
        GB.esc(reached ? GB.t('cart.freeReached') : GB.t('cart.freeLeft', { amount: GB.money(t.remainingForFreeFils) })) + '</span></p>' +
        '<div class="gb-cart-free__bar" aria-hidden="true"><span style="width:' + pct + '%"></span></div></div>';
    }
    const row = (cls, label, value) => '<div class="gb-cart-sum__row' + (cls ? ' ' + cls : '') + '"><dt>' + GB.esc(label) + '</dt><dd>' + value + '</dd></div>';
    let delivery, total;
    if (t.confirmed) {
      delivery = t.deliveryFils ? GB.moneyHtml(t.deliveryFils) : '<span class="gb-cart-sum__free">' + GB.esc(GB.t('cart.deliveryFree')) + '</span>';
      total = GB.moneyHtml(t.totalFils);
    } else {
      delivery = '<span class="gb-cart-sum__tbc">' + GB.esc(GB.t('cart.deliveryTbc')) + '</span>';
      total = GB.moneyHtml(t.subtotalFils) + ' <span class="gb-cart-sum__plus">' + GB.esc(GB.t('cart.plusDelivery')) + '</span>';
    }
    return free + '<dl class="gb-cart-sum">' + row('', GB.t('cart.subtotal'), GB.moneyHtml(t.subtotalFils)) +
      row('', GB.t('cart.delivery'), delivery) + row('gb-cart-sum__row--total', GB.t('cart.total'), total) + '</dl>';
  },
  /** Ids whose price changed since they were added this page view → {id: oldPriceFils}. */
  priceNotice: {},
  /** Record price changes from lines() and acknowledge them (so the notice is shown once per page view). */
  notePrices(lines, products) {
    let any = false;
    lines.forEach((l) => { if (l.priceChanged && l.addedPriceFils) { GB.cartUI.priceNotice[l.id] = l.addedPriceFils; any = true; } });
    if (any) GB.cart.ackPrices(products);
    return any;
  },
  hasPriceNotice(lines) { return lines.some((l) => GB.cartUI.priceNotice[l.id] && GB.cartUI.priceNotice[l.id] !== l.unitFils); },
  /** Show the drawer state for a fresh render (used after products load). */
  render() { renderCart(); },
};

/* ------------------------------------------------------------------ drawer rendering */
let cartLoadError = false;
let cartLoading = false;
let cartRendering = false;
let cartFocusAfter = null; // array of selectors to try after the next render

function cartEls() { return { body: document.getElementById('gb-cart-body'), foot: document.getElementById('gb-cart-foot') }; }

function cartLoad() {
  if (cartLoading) return;
  cartLoading = true;
  GB.products().then(() => { cartLoading = false; cartLoadError = false; renderCart(); }, () => { cartLoading = false; cartLoadError = true; renderCart(); });
}

function cartEmptyHtml() {
  return '<div class="gb-empty gb-cart-empty">' + GB.icon('cart', 'gb-empty__icon') + '<h3 class="gb-empty__title">' + GB.esc(GB.t('cart.empty')) + '</h3>' +
    '<p class="gb-empty__text">' + GB.esc(GB.t('cart.emptyText')) + '</p><div class="gb-empty__actions">' +
    '<button type="button" class="gb-btn gb-btn--primary" data-dialog-close>' + GB.esc(GB.t('cart.continue')) + '</button>' +
    '<a class="gb-btn gb-btn--light" href="' + GB.esc(GB.url('c/all/')) + '">' + GB.esc(GB.t('cart.browseAll')) + '</a></div></div>';
}

function cartLineHtml(l) {
  const id = GB.esc(l.id);
  const name = l.name;
  const url = GB.esc(l.url);
  const was = GB.cartUI.priceNotice[l.id];
  let notes = '';
  if (was && was !== l.unitFils) notes += '<p class="gb-cart-line__note gb-cart-line__note--price">' + GB.icon('info') + '<span>' + GB.esc(GB.t('cart.priceWas', { amount: GB.money(was) })) + '</span></p>';
  if (l.backorder) notes += '<p class="gb-cart-line__note">' + GB.cartUI.stock('backorder') + '<span>' + GB.esc(GB.t('cart.backorderNote')) + '</span></p>';
  if (!l.available) notes += '<p class="gb-cart-line__note gb-cart-line__note--na">' + GB.icon('alert') + '<span>' + GB.esc(GB.t('cart.unavailableLine')) + '</span></p>';
  let row = '';
  if (l.available) {
    row = '<div class="gb-cart-line__row"><div class="gb-stepper gb-cart-line__qty" role="group" aria-label="' + GB.esc(GB.t('cart.qtyOf', { name })) + '">' +
      '<button type="button" data-action="cart-dec" data-id="' + id + '" aria-label="' + GB.esc(GB.t('cart.decrease', { name })) + '"' + (l.qty <= 1 ? ' disabled' : '') + '>' + GB.icon('minus') + '</button>' +
      '<output>' + l.qty + '</output>' +
      '<button type="button" data-action="cart-inc" data-id="' + id + '" aria-label="' + GB.esc(GB.t('cart.increase', { name })) + '"' + (l.qty >= 99 ? ' disabled' : '') + '>' + GB.icon('plus') + '</button>' +
      '</div><p class="gb-cart-line__total"><span class="gb-sr">' + GB.esc(GB.t('cart.lineTotal')) + ': </span>' + GB.moneyHtml(l.lineFils) + '</p></div>';
  }
  return '<li class="gb-cart-line' + (l.available ? '' : ' is-unavailable') + '" data-id="' + id + '">' +
    '<a class="gb-cart-line__media" href="' + url + '" tabindex="-1" aria-hidden="true">' + GB.cartUI.media(l.p) + '</a>' +
    '<div class="gb-cart-line__main">' +
    '<a class="gb-cart-line__name" href="' + url + '">' + GB.cartUI.nameHtml(name) + '</a>' +
    '<p class="gb-cart-line__unit">' + GB.esc(GB.t('cart.each', { price: GB.money(l.unitFils) })) + '</p>' + notes + row +
    '<button type="button" class="gb-cart-line__remove" data-action="cart-remove" data-id="' + id + '" aria-label="' + GB.esc(GB.t('cart.removeItem', { name })) + '">' +
    GB.icon('trash') + '<span>' + GB.esc(GB.t('cart.remove')) + '</span></button>' +
    '</div></li>';
}

function renderCart() {
  const { body, foot } = cartEls();
  if (!body || !foot || cartRendering) return;
  cartRendering = true;
  try {
    if (GB.cart.size() === 0) {
      body.innerHTML = cartEmptyHtml();
      foot.hidden = true; foot.innerHTML = '';
      return;
    }
    const map = GB.productsMap;
    if (!map) {
      foot.hidden = true; foot.innerHTML = '';
      if (cartLoadError) {
        body.innerHTML = '<div class="gb-alert gb-alert--error gb-cart-error" role="alert">' + GB.icon('alert') + '<div><p>' + GB.esc(GB.t('common.error')) + '</p>' +
          '<button type="button" class="gb-btn gb-btn--light" data-action="cart-retry">' + GB.icon('refresh') + '<span>' + GB.esc(GB.t('common.retry')) + '</span></button></div></div>';
      } else {
        body.innerHTML = '<p class="gb-cart-boot" role="status"><span class="gb-cart-spinner" aria-hidden="true"></span><span>' + GB.esc(GB.t('common.loading')) + '</span></p>';
        cartLoad();
      }
      return;
    }
    const lines = GB.cart.lines(map); // drops unknown ids (emits cart:change 'sanitize'; guarded by cartRendering)
    if (!lines.length) {
      body.innerHTML = cartEmptyHtml();
      foot.hidden = true; foot.innerHTML = '';
      return;
    }
    GB.cartUI.notePrices(lines, map);
    const t = GB.cart.totals(lines);
    let top = '';
    if (GB.cartUI.hasPriceNotice(lines)) top += '<p class="gb-alert gb-cart-notice">' + GB.icon('info') + '<span>' + GB.esc(GB.t('common.priceUpdated')) + '</span></p>';
    if (t.unavailableCount) {
      top += '<div class="gb-alert gb-cart-notice">' + GB.icon('alert') + '<div><p>' + GB.esc(GB.t('cart.unavailableNotice')) + '</p>' +
        '<button type="button" class="gb-btn gb-btn--light gb-cart-notice__btn" data-action="cart-remove-unavailable">' + GB.icon('trash') + '<span>' +
        GB.esc(GB.t('cart.removeUnavailable')) + '</span></button></div></div>';
    }
    body.innerHTML = top + '<ul class="gb-cart-lines" role="list">' + lines.map(cartLineHtml).join('') + '</ul>';
    const onCheckout = cartIsCheckout();
    const cta = t.itemCount > 0
      ? '<a class="gb-btn gb-btn--primary gb-btn--block gb-btn--lg gb-cart-cta" href="' + GB.esc(GB.url('checkout/')) + '"' + (onCheckout ? ' data-dialog-close' : '') + '>' +
        '<span>' + GB.esc(GB.t('cart.checkout')) + '</span>' + GB.icon('arrow-forward') + '</a>'
      : '<p class="gb-alert gb-alert--error">' + GB.icon('alert') + '<span>' + GB.esc(GB.t('cart.allUnavailable')) + '</span></p>';
    foot.innerHTML = GB.cartUI.totalsHtml(t) + '<div class="gb-cart-actions">' + cta +
      '<button type="button" class="gb-btn gb-btn--ghost gb-btn--block" data-dialog-close>' + GB.esc(GB.t('cart.continue')) + '</button></div>';
    foot.hidden = false;
    GB.ui.hydrate(body);
  } finally {
    cartRendering = false;
    cartRestoreFocus();
  }
}

function cartRestoreFocus() {
  const list = cartFocusAfter;
  cartFocusAfter = null;
  if (!list || !GB.dialog.isOpen('gb-cart')) return;
  let el = null;
  for (let i = 0; i < list.length && !el; i++) {
    const c = GB.$(list[i]);
    if (c && !c.disabled) el = c;
  }
  el = el || document.getElementById('gb-cart-title');
  if (el) { try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); } }
}

GB.listen('dialog:open', (d) => { if (d.id === 'gb-cart') renderCart(); });
GB.listen('cart:change', () => { if (GB.dialog.isOpen('gb-cart')) renderCart(); });

/* ------------------------------------------------------------------ drawer actions */
const lineSel = (action, id) => '#gb-cart [data-action="' + action + '"][data-id="' + id + '"]';
GB.on('click', '[data-action="cart-inc"], [data-action="cart-dec"]', (e, el) => {
  e.preventDefault();
  if (el.disabled) return;
  const id = el.getAttribute('data-id');
  const inc = el.getAttribute('data-action') === 'cart-inc';
  const q = GB.cart.qty(id);
  if (!q) return;
  const next = Math.max(1, Math.min(99, q + (inc ? 1 : -1)));
  if (next === q) { if (inc) GB.announce(GB.t('cart.maxQty')); return; }
  cartFocusAfter = [lineSel(el.getAttribute('data-action'), id), lineSel(inc ? 'cart-dec' : 'cart-inc', id)];
  GB.cart.set(id, next);
  const item = GB.productsMap && GB.productsMap.get(id);
  GB.announce(GB.t('cart.qtyNow', { name: item ? GB.pname(item) : '#' + id, n: next }));
  if (inc && item) GB.track('add_to_cart', { id, qty: 1, value: item.p });
});

GB.on('click', '[data-action="cart-remove"]', (e, el) => {
  e.preventDefault();
  const id = el.getAttribute('data-id');
  const li = el.closest('.gb-cart-line');
  const sib = li && (li.nextElementSibling || li.previousElementSibling);
  const sibId = sib && sib.getAttribute('data-id');
  cartFocusAfter = sibId ? [lineSel('cart-remove', sibId)] : ['#gb-cart .gb-cart-empty [data-dialog-close]'];
  const item = GB.productsMap && GB.productsMap.get(id);
  GB.cart.remove(id);
  GB.toast(GB.t('cart.removed', { name: item ? GB.pname(item) : '#' + id }));
});

GB.on('click', '[data-action="cart-remove-unavailable"]', (e) => {
  e.preventDefault();
  const map = GB.productsMap;
  if (!map) return;
  cartFocusAfter = ['#gb-cart [data-action="cart-remove"]', '#gb-cart .gb-cart-empty [data-dialog-close]'];
  GB.cart.lines(map).filter((l) => !l.available).forEach((l) => GB.cart.remove(l.id));
});

GB.on('click', '[data-action="cart-retry"]', (e) => {
  e.preventDefault();
  cartLoadError = false;
  cartFocusAfter = ['#gb-cart-title'];
  renderCart();
});

/* ------------------------------------------------------------------ on load: sanitize + reprice + price-changed notice */
GB.ready(() => {
  if (!GB.cart.size()) return;
  GB.products().then((map) => {
    const lines = GB.cart.lines(map);
    const changed = GB.cartUI.notePrices(lines, map);
    if (GB.dialog.isOpen('gb-cart')) renderCart();
    if (changed) {
      GB.emit('cart:prices', { ids: Object.keys(GB.cartUI.priceNotice) });
      if (!cartIsCheckout()) {
        GB.toast(GB.t('common.priceUpdated'), { timeout: 6000, action: document.getElementById('gb-cart') ? { label: GB.t('common.viewCart'), onClick() { GB.dialog.open('gb-cart'); } } : null });
      }
    }
  }).catch(() => { /* offline or blocked: the drawer shows its own retry state when opened */ });
});

/* ------------------------------------------------------------------ pending-order banner (all pages except checkout) */
let bannerRef = null;
function renderPendingBanner() {
  if (cartIsCheckout()) return;
  const o = GB.orders.pending();
  if (!o) {
    if (bannerRef) { GB.banner.hide(); bannerRef = null; }
    return;
  }
  if (bannerRef === o.ref) return;
  const href = GB.url('checkout/') + '?ref=' + encodeURIComponent(o.ref);
  const b = GB.banner.show(
    '<p class="gb-banner__text gb-cart-pending__text">' + GB.icon('alert') + '<span>' + GB.esc(GB.t('cart.pendingText')) +
    ' <bdi class="gb-cart-pending__ref" dir="ltr">' + GB.esc(o.ref) + '</bdi></span></p>' +
    '<a class="gb-btn gb-btn--primary gb-cart-pending__cta" href="' + GB.esc(href) + '">' + GB.esc(GB.t('cart.pendingCta')) + '</a>' +
    '<button type="button" class="gb-btn gb-btn--ghost gb-btn--icon gb-cart-pending__x" data-action="cart-banner-dismiss" data-ref="' + GB.esc(o.ref) +
    '" aria-label="' + GB.esc(GB.t('cart.pendingDismiss')) + '">' + GB.icon('x') + '</button>');
  if (b) {
    b.setAttribute('role', 'region');
    b.setAttribute('aria-label', GB.t('cart.pendingText'));
  }
  bannerRef = o.ref;
}
GB.ready(renderPendingBanner);
GB.listen('orders:change', () => { bannerRef = null; renderPendingBanner(); });
GB.on('click', '[data-action="cart-banner-dismiss"]', (e, el) => {
  e.preventDefault();
  const ref = el.getAttribute('data-ref');
  GB.orders.dismiss(ref);
  GB.banner.hide();
  bannerRef = null;
  const main = document.getElementById('main');
  if (main) { try { main.focus({ preventScroll: true }); } catch (err) { main.focus(); } }
});
