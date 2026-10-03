/* 10-store.js — client state (localStorage via GB.storage, keys under 'gbq8:v2:'):
     GB.cart   {id: qty}            + 'cartp' {id: addedPriceFils}  → event 'cart:change'
     GB.wish   [id]                                                 → event 'wish:change'
     GB.recent [id] (max 12, newest first)                          → event 'recent:change'
     GB.orders [{ref, at, …, status 'pending'|'sent'}] (max 10)    → event 'orders:change'
     GB.customer  saved checkout details (opt-in only)
   Plus one-time migration of the v1 keys 'gbq8b-cart' / 'gbq8b-wish' (CSV row ids → WooCommerce ids).
   Contract: src/CONTRACTS.md §7.2. Prices are NEVER trusted from storage: lines() reprices from products.json. */

const QTY_MAX = 99;
const ID_RE = /^\d{1,9}$/;
const clampQty = (q) => {
  const n = Math.floor(Number(q));
  return Number.isFinite(n) ? Math.max(0, Math.min(QTY_MAX, n)) : 0;
};

/* ------------------------------------------------------------------ cart */
function readCart() {
  const raw = GB.storage.get('cart', {});
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    Object.keys(raw).forEach((id) => {
      const q = clampQty(raw[id]);
      if (ID_RE.test(id) && q > 0) out[id] = q;
    });
  }
  return out;
}
function readPrices() {
  const raw = GB.storage.get('cartp', {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}
let cart = readCart();
let prices = readPrices();

function saveCart(reason, id) {
  Object.keys(prices).forEach((k) => { if (!cart[k]) delete prices[k]; });
  GB.storage.set('cart', cart);
  GB.storage.set('cartp', prices);
  GB.emit('cart:change', { cart: GB.cart.get(), count: GB.cart.count(), reason, id: id || null });
}

GB.cart = {
  /** Copy of {id: qty}. */
  get() { return Object.assign({}, cart); },
  /** Quantity of one id (0 when absent). */
  qty(id) { return cart[String(id)] || 0; },
  has(id) { return !!cart[String(id)]; },
  /** Number of distinct lines. */
  size() { return Object.keys(cart).length; },
  /** Total quantity (the badge number). */
  count() { return Object.keys(cart).reduce((s, k) => s + cart[k], 0); },
  /**
   * Add qty (default 1) of id; priceFils = the price the customer saw (data-price) for change detection.
   * Returns the new quantity (capped at 99).
   */
  add(id, qty, priceFils) {
    id = String(id);
    if (!ID_RE.test(id)) return 0;
    const q = clampQty((cart[id] || 0) + (qty === undefined ? 1 : clampQty(qty)));
    if (!q) return cart[id] || 0;
    cart[id] = q;
    if (priceFils > 0 && !prices[id]) prices[id] = Math.round(Number(priceFils));
    saveCart('add', id);
    return q;
  },
  /** Set an exact quantity; 0 removes the line. Returns the new quantity. */
  set(id, qty) {
    id = String(id);
    if (!ID_RE.test(id)) return 0;
    const q = clampQty(qty);
    if (q > 0) cart[id] = q; else delete cart[id];
    saveCart(q > 0 ? 'set' : 'remove', id);
    return q;
  },
  remove(id) { id = String(id); if (cart[id]) { delete cart[id]; saveCart('remove', id); } },
  clear() { cart = {}; prices = {}; saveCart('clear'); },

  /**
   * Resolve the cart against products.json (a Map from GB.products()). Drops unknown ids from storage
   * (event reason 'sanitize'). Returns lines in insertion order:
   *   { id, qty, p (compact product), name, url, unitFils, lineFils, availability,
   *     available (false when out_of_stock), backorder, addedPriceFils|null, priceChanged }
   */
  lines(products) {
    const out = [];
    let dropped = false;
    Object.keys(cart).forEach((id) => {
      const p = products && products.get(id);
      if (!p) { delete cart[id]; dropped = true; return; }
      const qty = cart[id];
      const added = prices[id] ? Number(prices[id]) : null;
      out.push({
        id, qty, p,
        name: GB.pname(p),
        url: GB.purl(p),
        unitFils: p.p,
        lineFils: p.p * qty,
        availability: p.a,
        available: p.a !== 'out_of_stock',
        backorder: p.a === 'backorder',
        addedPriceFils: added,
        priceChanged: added !== null && added !== p.p,
      });
    });
    if (dropped) saveCart('sanitize');
    return out;
  },
  /** After telling the customer "تحدّث السعر", store the current prices so the notice is not repeated. */
  ackPrices(products) {
    let changed = false;
    Object.keys(cart).forEach((id) => {
      const p = products && products.get(id);
      if (p && prices[id] !== p.p) { prices[id] = p.p; changed = true; }
    });
    if (changed) GB.storage.set('cartp', prices);
  },
  /**
   * Totals for lines() output, honouring config.delivery (SPEC §5):
   *   { subtotalFils, itemCount (available qty), unavailableCount, confirmed, deliveryFils (null when not confirmed),
   *     totalFils (null when not confirmed), freeOverFils, remainingForFreeFils (null when not confirmed) }
   * Out-of-stock lines are excluded from every number.
   */
  totals(lines) {
    const d = GB.cfg.delivery || {};
    let subtotal = 0, items = 0, unavailable = 0;
    (lines || []).forEach((l) => {
      if (l.available) { subtotal += l.lineFils; items += l.qty; } else unavailable += 1;
    });
    const confirmed = d.confirmed === true;
    let delivery = null, total = null, remaining = null;
    if (confirmed) {
      const free = d.freeOverFils && subtotal >= d.freeOverFils;
      delivery = items === 0 ? 0 : (free ? 0 : (d.feeFils || 0));
      total = subtotal + delivery;
      remaining = d.freeOverFils ? Math.max(0, d.freeOverFils - subtotal) : null;
    }
    return {
      subtotalFils: subtotal, itemCount: items, unavailableCount: unavailable, confirmed,
      deliveryFils: delivery, totalFils: total, freeOverFils: d.freeOverFils || null, remainingForFreeFils: remaining,
    };
  },
};

/* ------------------------------------------------------------------ wishlist */
function readList(key, max) {
  const raw = GB.storage.get(key, []);
  const seen = {};
  return (Array.isArray(raw) ? raw : []).map(String).filter((id) => {
    if (!ID_RE.test(id) || seen[id]) return false;
    seen[id] = 1;
    return true;
  }).slice(0, max || 500);
}
let wish = readList('wish');
function saveWish(id, on, reason) {
  GB.storage.set('wish', wish);
  GB.emit('wish:change', { list: wish.slice(), count: wish.length, id: id || null, on: !!on, reason: reason || (on ? 'add' : 'remove') });
}
GB.wish = {
  list() { return wish.slice(); },
  count() { return wish.length; },
  has(id) { return wish.indexOf(String(id)) !== -1; },
  add(id) { id = String(id); if (ID_RE.test(id) && !GB.wish.has(id)) { wish.unshift(id); saveWish(id, true); } return true; },
  remove(id) { id = String(id); if (GB.wish.has(id)) { wish = wish.filter((x) => x !== id); saveWish(id, false); } return false; },
  /** Toggle; returns the new state (true = in wishlist). */
  toggle(id) { return GB.wish.has(id) ? GB.wish.remove(id) : GB.wish.add(id); },
  clear() { wish = []; saveWish(null, false, 'clear'); },
  /** Drop ids unknown to products.json (Map). */
  sanitize(products) {
    const before = wish.length;
    wish = wish.filter((id) => products.has(id));
    if (wish.length !== before) saveWish(null, false, 'sanitize');
    return wish.slice();
  },
};

/* ------------------------------------------------------------------ recently viewed */
GB.recent = {
  list() { return readList('recent', 12); },
  /** Move id to the front (max 12). */
  push(id) {
    id = String(id);
    if (!ID_RE.test(id)) return;
    const list = [id].concat(GB.recent.list().filter((x) => x !== id)).slice(0, 12);
    GB.storage.set('recent', list);
    GB.emit('recent:change', { list });
  },
  clear() { GB.storage.remove('recent'); GB.emit('recent:change', { list: [] }); },
};

/* ------------------------------------------------------------------ orders (last 10) */
function readOrders() {
  const raw = GB.storage.get('orders', []);
  return Array.isArray(raw) ? raw.filter((o) => o && typeof o.ref === 'string') : [];
}
function saveOrders(list, ref, reason) {
  GB.storage.set('orders', list.slice(0, 10));
  GB.emit('orders:change', { list: list.slice(0, 10), ref: ref || null, reason });
}
GB.orders = {
  /** Newest first. */
  list() { return readOrders(); },
  get(ref) { return readOrders().filter((o) => o.ref === ref)[0] || null; },
  /**
   * Save an order (status defaults to 'pending'). Suggested shape (owned by the cart agent):
   *   { ref, at (ms), locale, lines: [{id, name, qty, unitFils, lineFils, backorder}], totals, customer: {…}, payment, message }
   */
  add(order) {
    const o = Object.assign({ status: 'pending', at: Date.now() }, order);
    const list = [o].concat(readOrders().filter((x) => x.ref !== o.ref));
    saveOrders(list, o.ref, 'add');
    return o;
  },
  /** Patch an order by ref. */
  update(ref, patch) {
    const list = readOrders().map((o) => (o.ref === ref ? Object.assign({}, o, patch) : o));
    saveOrders(list, ref, 'update');
  },
  markSent(ref) { GB.orders.update(ref, { status: 'sent', sentAt: Date.now() }); },
  /** Hide the "complete your order" banner for this ref without marking it sent. */
  dismiss(ref) { GB.orders.update(ref, { dismissed: true }); },
  /** Most recent pending, non-dismissed order younger than 7 days, or null. */
  pending() {
    const week = 7 * 24 * 3600 * 1000;
    return readOrders().filter((o) => o.status === 'pending' && !o.dismissed && Date.now() - (o.at || 0) < week)[0] || null;
  },
};

/* ------------------------------------------------------------------ saved checkout details (opt-in only) */
GB.customer = {
  get() { const c = GB.storage.get('customer', null); return c && typeof c === 'object' ? c : null; },
  set(details) { GB.storage.set('customer', details); },
  clear() { GB.storage.remove('customer'); },
};

/* ------------------------------------------------------------------ v1 → v2 migration (runs once per browser) */
// v1 stored CSV ROW ids. Only rows whose WooCommerce id is a live product are listed (English twins dropped).
const LEGACY_MAP = '1:10736,2:10748,3:10754,4:10765,5:10779,6:10788,7:10795,8:10805,9:10815,10:10828,11:10845,12:10853,13:10856,14:10877,15:10884,16:10892,17:10904,18:10907,19:10915,20:10923,21:10930,22:10938,23:10942,24:10948,25:11161,50:11444,51:11452,52:11459,53:11475,54:11478,55:11488,56:11495,57:11500,58:11510,59:11521,60:11529,61:11542,62:11573,63:11578,64:11597,65:11600,66:11616,67:11623,68:11631,69:11642,70:11651,71:11659,72:11668,73:11675,74:11686,75:11698,76:11708,77:11736,78:11748,79:11761,80:11770,81:11778,82:11791,83:11801,84:11826,85:11834,86:11845,87:11853,88:11864,89:11873,90:11897,91:11899,92:11912,93:11923,94:11930,95:11943,96:11953,97:11962,98:11971,99:11982,100:12000,101:12008,102:12019,103:12028,104:12031,105:12050,106:12063,107:12066,108:12074,109:12078,110:12086,111:12091,112:12102,113:12116,115:12211,116:12250,117:12253,118:12338,119:12354,120:12385,121:12392,122:12400,123:12414,124:12422,125:12489,126:12500,127:12512,128:12521,129:12527,130:12545,131:12561,132:12597,133:12602,134:12605,135:12628,136:12638,137:12645,138:12652,139:12674,140:12677,141:12687,142:12696,143:12705,144:12713,145:12820,146:12833,147:12864,148:12878,149:12906,150:13042,151:13046,152:13067,154:13077,155:13086,156:13094,157:13100,158:13114,159:13121,160:13130,161:13136,162:13141,163:13149,164:13164,165:13167,166:13175,167:13180,168:13194,169:13206,170:13217,171:13225,172:13232,173:13269,174:13273,175:13294,176:13303,177:13313,178:13321,179:13329,180:13338,181:13350,182:13360,183:13369,184:13381,185:13390,186:13396,187:13405,188:13411,189:13421,190:13433,191:21532';
(function migrateLegacy() {
  const rawCart = GB.storage.getRaw('gbq8b-cart');
  const rawWish = GB.storage.getRaw('gbq8b-wish');
  if (rawCart === null && rawWish === null) return;
  const map = {};
  LEGACY_MAP.split(',').forEach((pair) => { const kv = pair.split(':'); map[kv[0]] = kv[1]; });
  let moved = 0;
  try {
    const old = JSON.parse(rawCart || '{}') || {};
    Object.keys(old).forEach((row) => {
      const id = map[String(row)];
      const q = clampQty(old[row]);
      if (id && q > 0) { cart[id] = clampQty((cart[id] || 0) + q); moved++; }
    });
  } catch (e) { /* corrupt v1 data: drop it */ }
  try {
    const oldW = JSON.parse(rawWish || '[]') || [];
    (Array.isArray(oldW) ? oldW : []).forEach((row) => {
      const id = map[String(row)];
      if (id && wish.indexOf(id) === -1) wish.push(id);
    });
  } catch (e) { /* ignore */ }
  GB.storage.set('cart', cart);
  GB.storage.set('wish', wish);
  GB.storage.removeRaw('gbq8b-cart');
  GB.storage.removeRaw('gbq8b-wish');
  GB.migrated = moved;
})();

/* ------------------------------------------------------------------ other tabs */
window.addEventListener('storage', (e) => {
  if (!e.key || e.key.indexOf(GB.storage.prefix) !== 0) return;
  const k = e.key.slice(GB.storage.prefix.length);
  if (k === 'cart' || k === 'cartp') {
    cart = readCart(); prices = readPrices();
    GB.emit('cart:change', { cart: GB.cart.get(), count: GB.cart.count(), reason: 'sync', id: null });
  } else if (k === 'wish') {
    wish = readList('wish');
    GB.emit('wish:change', { list: wish.slice(), count: wish.length, id: null, on: false, reason: 'sync' });
  } else if (k === 'orders') {
    GB.emit('orders:change', { list: readOrders(), ref: null, reason: 'sync' });
  }
});
