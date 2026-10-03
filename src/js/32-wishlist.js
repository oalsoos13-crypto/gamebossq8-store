/* 32-wishlist.js — cart module, part 3: the wishlist/ page (client-rendered from products.json + GB.wish).
   Move to cart (one / all available), remove, share the list on WhatsApp, empty state, retry on load failure.
   Actions owned here: wishlist-move, wishlist-move-all, wishlist-remove, wishlist-retry. */

GB.ready(() => {
  if (!document.body.classList.contains('page-wishlist')) return;
  const $ = (id) => document.getElementById(id);
  const list = $('wl-list'), empty = $('wl-empty'), boot = $('wl-boot'), tools = $('wl-tools'), count = $('wl-count'), share = $('wl-share');
  if (!list) return;
  const leadText = count ? count.textContent : '';
  let map = null;
  let batching = false;
  let focusAfter = null;

  function cardHtml(item) {
    const id = GB.esc(item.id);
    const name = GB.pname(item);
    const oos = item.a === 'out_of_stock';
    const pct = GB.discountPct(item.p, item.c);
    let action;
    if (oos) {
      const msg = GB.t('common.notifyMsg', { name, id: item.id, url: GB.abs(item.s) });
      action = '<a class="gb-btn gb-btn--notify" href="' + GB.esc(GB.wa(msg)) + '" target="_blank" rel="noopener" aria-label="' +
        GB.esc(GB.t('a11y.notify', { name }) + ' ' + GB.t('a11y.newTab')) + '">' + GB.icon('bell') + '<span>' + GB.esc(GB.t('common.notifyMeShort')) + '</span></a>';
    } else {
      action = '<button type="button" class="gb-btn gb-btn--add" data-action="wishlist-move" data-id="' + id + '" aria-label="' +
        GB.esc(GB.t('wishlist.moveLabel', { name })) + '">' + GB.icon('cart-plus') + '<span>' + GB.esc(GB.t('wishlist.move')) + '</span></button>';
    }
    return '<li class="gb-grid__item" data-id="' + id + '"><article class="gb-card gb-wl-card' + (oos ? ' is-oos' : '') + (pct ? ' is-sale' : '') + '" aria-labelledby="wl-pn-' + id + '">' +
      GB.cartUI.media(item, 'gb-card__media') +
      (pct ? '<div class="gb-card__flags"><span class="gb-flag gb-flag--sale">' + GB.esc(GB.t('price.off', { pct })) + '</span></div>' : '') +
      // remove sits where the heart sits on product cards (top corner of the photo), so "move" gets the full width
      '<button type="button" class="gb-wish gb-card__wish gb-wl-remove" data-action="wishlist-remove" data-id="' + id + '" aria-label="' +
      GB.esc(GB.t('a11y.wishRemove', { name })) + '">' + GB.icon('trash') + '</button>' +
      '<div class="gb-card__body">' + (item.b ? '<p class="gb-card__brand" dir="ltr">' + GB.esc(item.b) + '</p>' : '') +
      '<h2 class="gb-card__title" id="wl-pn-' + id + '"><a class="gb-card__link" href="' + GB.esc(GB.purl(item)) + '">' + GB.cartUI.nameHtml(name) + '</a></h2>' +
      GB.cartUI.price(item, 'sm') + GB.cartUI.stock(item.a, 'gb-card__stock') + '</div>' +
      '<div class="gb-card__actions gb-wl-actions">' + action +
'</div></article></li>';
  }

  /** wa.me share link (no number → the customer picks the chat). Kept under ~1900 chars. */
  function shareUrl(items) {
    const head = GB.t('wishlist.shareMsg');
    let text = head;
    let used = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      const add = '\n• ' + GB.pname(p) + ' — ' + GB.money(p.p) + '\n' + GB.abs(p.s);
      if (encodeURIComponent(text + add).length > 1750) break;
      text += add;
      used++;
    }
    if (used < items.length) text += '\n' + GB.t('wishlist.shareMore', { url: GB.abs('') });
    return 'https://wa.me/?text=' + encodeURIComponent(text);
  }

  function render() {
    if (!map || batching) return;
    const ids = GB.wish.sanitize(map);
    if (boot) boot.hidden = true;
    const items = ids.map((id) => map.get(id)).filter(Boolean);
    if (!items.length) {
      list.hidden = true; list.innerHTML = '';
      tools.hidden = true;
      empty.hidden = false;
      if (count) count.textContent = leadText;
    } else {
      empty.hidden = true;
      list.innerHTML = items.map(cardHtml).join('');
      list.hidden = false;
      tools.hidden = false;
      if (count) count.textContent = GB.t('common.products', { n: items.length });
      if (share) share.href = shareUrl(items);
      const moveAll = GB.$('[data-action="wishlist-move-all"]', tools);
      if (moveAll) moveAll.hidden = !items.some((p) => p.a !== 'out_of_stock');
      GB.ui.hydrate(list);
    }
    const f = focusAfter;
    focusAfter = null;
    if (f) {
      let el = null;
      for (let i = 0; i < f.length && !el; i++) el = GB.$(f[i]);
      el = el || $('wl-title');
      if (el) { try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); } }
    }
  }

  function load() {
    if (boot) {
      boot.hidden = false;
      boot.innerHTML = '<span class="gb-cart-spinner" aria-hidden="true"></span><span>' + GB.esc(GB.t('common.loading')) + '</span>';
    }
    GB.products().then((m) => { map = m; render(); }, () => {
      if (!boot) return;
      boot.innerHTML = '<span class="gb-alert gb-alert--error">' + GB.icon('alert') + '<span>' + GB.esc(GB.t('common.error')) + '</span></span>' +
        '<button type="button" class="gb-btn gb-btn--light" data-action="wishlist-retry">' + GB.icon('refresh') + '<span>' + GB.esc(GB.t('common.retry')) + '</span></button>';
    });
  }

  /** Selectors for the item after (or before) id, used to keep keyboard focus after it disappears. */
  function neighbourFocus(id, action) {
    const li = GB.$('#wl-list > li[data-id="' + id + '"]');
    const sib = li && (li.nextElementSibling || li.previousElementSibling);
    const sid = sib && sib.getAttribute('data-id');
    return sid ? ['#wl-list > li[data-id="' + sid + '"] [data-action="' + action + '"]', '#wl-list > li[data-id="' + sid + '"] [data-action="wishlist-remove"]'] : ['#wl-empty .gb-btn', '#wl-title'];
  }

  GB.listen('wish:change', render);

  GB.on('click', '[data-action="wishlist-move"]', (e, el) => {
    e.preventDefault();
    const id = el.getAttribute('data-id');
    const item = map && map.get(id);
    if (!item || item.a === 'out_of_stock') return;
    focusAfter = neighbourFocus(id, 'wishlist-move');
    GB.cart.add(id, 1, item.p);
    GB.track('add_to_cart', { id, qty: 1, value: item.p });
    GB.wish.remove(id);
    GB.toast(GB.t('wishlist.moved'), { action: { label: GB.t('common.viewCart'), onClick() { GB.dialog.open('gb-cart'); } } });
  });
  GB.on('click', '[data-action="wishlist-move-all"]', (e) => {
    e.preventDefault();
    if (!map) return;
    const ids = GB.wish.list().filter((id) => { const p = map.get(id); return p && p.a !== 'out_of_stock'; });
    if (!ids.length) return;
    batching = true;
    try {
      ids.forEach((id) => { const p = map.get(id); GB.cart.add(id, 1, p.p); GB.track('add_to_cart', { id, qty: 1, value: p.p }); GB.wish.remove(id); });
    } finally { batching = false; }
    focusAfter = ['#wl-list [data-action="wishlist-remove"]', '#wl-empty .gb-btn'];
    render();
    GB.toast(GB.t('wishlist.movedAll', { n: ids.length }), { action: { label: GB.t('common.viewCart'), onClick() { GB.dialog.open('gb-cart'); } } });
  });
  GB.on('click', '[data-action="wishlist-remove"]', (e, el) => {
    e.preventDefault();
    const id = el.getAttribute('data-id');
    focusAfter = neighbourFocus(id, 'wishlist-remove');
    GB.wish.remove(id);
    GB.toast(GB.t('common.wishRemoved'));
  });
  GB.on('click', '[data-action="wishlist-retry"]', (e) => { e.preventDefault(); load(); });

  if (!GB.wish.count()) {
    // nothing saved: no need to download products.json
    if (boot) boot.hidden = true;
    empty.hidden = false;
    GB.listen('wish:change', () => { if (!map && GB.wish.count()) load(); });
    return;
  }
  load();
});
