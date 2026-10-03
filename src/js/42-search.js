/* 42-search.js — catalog module, part 2: search.
     GB.search.norm(s)          Arabic/Latin normalisation (SPEC §8): strip tashkeel + tatweel, أإآٱ→ا, ة→ه, ى→ي,
                                ؤ→و, ئ→ي, Arabic-Indic/Persian digits → Latin, lowercase, punctuation → space,
                                collapse spaces.
     GB.search.ready()          Promise — products.json (+ optional search/meta.json) indexed
     GB.search.query(q)         [{ item, … }] ranked: exact phrase › name starts with the first word › in stock ›
                                featured › more words matched in the name itself › default catalogue order.
                                Every query word must prefix-match a word of name.ar / name.en / brand (+ Arabic
                                spellings) / category names (+ a small synonym table) — AND semantics.
     GB.search.highlight(text, q) → safe HTML with <mark> around matched word prefixes
     GB.search.recent           recent searches (storage key gbq8:v2:searches, max 6)
   Header overlay: fills #gb-search-body inside the foundation's #gb-search dialog (instant top 8; Enter submits
   the dialog's GET form to search/?q=). Search page (body.page-search): results grid + GB.catalog listing. */

GB.search = GB.search || {};

/* ------------------------------------------------------------------ normalisation */
const S_DROP = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ​-‏‪-‮⁦-⁩]/;
const S_MAP = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ؤ': 'و', 'ئ': 'ي', 'ی': 'ي', 'ک': 'ك' };
let S_WORD;
try { S_WORD = new RegExp('[\\p{L}\\p{N}]', 'u'); } catch (e) { S_WORD = /[0-9A-Za-zÀ-ɏ؀-ۿ]/; }

/** Normalise and keep a map from every output char to its source index (used for highlighting). */
function normMap(input) {
  const s = String(input || '');
  let t = '';
  const map = [];
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    const code = s.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) { i++; ch = ' '; } // astral (emoji…) → separator
    else if (S_DROP.test(ch)) continue;
    else if (S_MAP[ch]) ch = S_MAP[ch];
    else if (code >= 0x0660 && code <= 0x0669) ch = String(code - 0x0660);
    else if (code >= 0x06F0 && code <= 0x06F9) ch = String(code - 0x06F0);
    else { ch = ch.toLowerCase(); if (ch.length !== 1) ch = ch.charAt(0); }
    if (ch !== ' ' && !S_WORD.test(ch)) ch = ' ';
    if (ch === ' ' && (!t || t.charAt(t.length - 1) === ' ')) continue;
    t += ch;
    map.push(i);
  }
  if (t.charAt(t.length - 1) === ' ') { t = t.slice(0, -1); map.pop(); }
  return { t, map };
}
const norm = (s) => normMap(s).t;
GB.search.norm = norm;

/** Arabic proclitic article variants: الشنط → شنط, للايباد → ايباد, والسماعات → سماعات. */
function stripAl(w) {
  if (w.length >= 5 && /^(وال|بال|فال|كال)/.test(w)) return w.slice(3);
  if (w.length >= 4 && /^(ال|لل)/.test(w)) return w.slice(2);
  return '';
}

/* ------------------------------------------------------------------ synonyms (index-side expansion) */
// A product word equal to any member of a group also indexes every other member of that group.
const S_GROUPS = [
  ['ادبتر', 'ادابتر', 'محول', 'adapter', 'adaptor', 'وصله', 'توصيله', 'dongle'],
  ['مروحه', 'مراوح', 'تبريد', 'مبرد', 'مبردات', 'fan', 'fans', 'cooler', 'cooling'],
  ['سماعه', 'سماعات', 'هيدسيت', 'headset', 'headsets', 'headphones', 'earbuds', 'earphones'],
  ['كيبل', 'كيبيل', 'كابل', 'cable', 'cables'],
  ['شاحن', 'شواحن', 'charger', 'chargers'],
  ['ستاند', 'استاند', 'حامل', 'stand', 'stands', 'holder'],
  ['قفاز', 'قفازات', 'جلفز', 'gloves', 'sleeves'],
  ['كفر', 'كفرات', 'مسكه', 'مسكات', 'جراب', 'case', 'cases', 'cover', 'grip'],
  ['ازرار', 'شفت', 'شفتات', 'تريجر', 'trigger', 'triggers'],
  ['يده', 'يدات', 'قير', 'جوستك', 'كنترولر', 'controller', 'controllers', 'gamepad'],
  ['ايباد', 'ايبادات', 'تابلت', 'ipad', 'tablet'],
  ['ايفون', 'iphone'],
  ['تايب', 'type'],
  ['شنطه', 'شنط', 'حقيبه', 'bag', 'bags'],
  ['ببجي', 'pubg'],
];
// Arabic (and spaced) spellings of brands, keyed by the normalised brand.
const S_BRANDS = {
  piva: ['بيفا'],
  plextone: ['بلكستون', 'بليكستون', 'بلاكستون'],
  memo: ['ميمو'],
  hyperx: ['هايبراكس', 'هايبركس', 'هايبر اكس', 'hyper x'],
  flydigi: ['فلاي ديجي', 'فلاي دي جي', 'fly digi'],
  gamesir: ['جيم سير', 'جيمسير', 'جيمسر', 'game sir'],
  ugreen: ['يوقرين', 'يوجرين'],
  redmagic: ['ريد ماجيك', 'ريد مجيك', 'ردمجيك', 'red magic'],
  'gameboss q8': ['جيم بوس', 'game boss'],
  sarafox: ['سارافوكس'],
};
let S_SYN = null;
function synonyms() {
  if (S_SYN) return S_SYN;
  S_SYN = new Map();
  S_GROUPS.forEach((g) => {
    const ng = g.map(norm);
    ng.forEach((w) => S_SYN.set(w, ng));
  });
  return S_SYN;
}

/* ------------------------------------------------------------------ index */
let S_INDEX = null, S_CATS = [], S_READY = null;
function addWords(set, text, joinPairs) {
  const ws = text.split(' ').filter(Boolean);
  ws.forEach((w, k) => {
    set.add(w);
    const s = stripAl(w);
    if (s) set.add(s);
    if (joinPairs && k) set.add(ws[k - 1] + w);
  });
}
function expand(set) {
  const syn = synonyms();
  Array.from(set).forEach((w) => { const g = syn.get(w); if (g) g.forEach((x) => addWords(set, x, true)); });
}
function catNames(id) {
  const m = GB.catalog && GB.catalog.metaData;
  const c = m && m.catMap.get(id);
  if (c) return [c.n.ar, c.n.en];
  const local = S_CATS.find((x) => x.id === id);
  return local ? [local.name] : [];
}
function buildIndex(map) {
  const meta = GB.catalog && GB.catalog.metaData;
  S_CATS = GB.catalog.cats();
  S_INDEX = [];
  let i = 0;
  map.forEach((item) => {
    const nAr = norm(item.n && item.n.ar), nEn = norm(item.n && item.n.en);
    const words = new Set();
    addWords(words, nAr, true);
    addWords(words, nEn, true);
    if (item.b) {
      const b = norm(item.b);
      addWords(words, b, true);
      (S_BRANDS[b] || []).forEach((a) => addWords(words, norm(a), true));
    }
    catNames(item.cat).forEach((n) => addWords(words, norm(n), false));
    expand(words);
    S_INDEX.push({
      item, i: i++, nAr, nEn,
      names: ' ' + nAr + ' ' + nEn + ' ',
      hay: ' ' + Array.from(words).join(' ') + ' ',
      rank: item.a === 'in_stock' ? 0 : (item.a === 'backorder' ? 1 : 2),
      featured: item.f || (meta && meta.featuredSet.has(String(item.id))) ? 1 : 0,
    });
  });
  // categories (for "matching categories" suggestions)
  S_CATS.forEach((c) => {
    const words = new Set();
    catNames(c.id).concat([c.name]).forEach((n) => addWords(words, norm(n), true));
    expand(words);
    c.hay = ' ' + Array.from(words).join(' ') + ' ';
  });
  return S_INDEX;
}
GB.search.ready = function () {
  if (!S_READY) {
    S_READY = Promise.all([GB.products(), GB.catalog.meta()]).then((r) => buildIndex(r[0]));
    S_READY.catch(() => { S_READY = null; }); // allow a retry
  }
  return S_READY;
};

function tokens(q) {
  const qn = norm(q);
  return { qn, toks: qn ? qn.split(' ').map((t) => ({ t, s: stripAl(t) })) : [] };
}
const hit = (hay, tk) => hay.indexOf(' ' + tk.t) >= 0 || (!!tk.s && hay.indexOf(' ' + tk.s) >= 0);

/** Ranked matches for q (requires GB.search.ready() to have resolved). */
GB.search.query = function (q) {
  if (!S_INDEX) return [];
  const { qn, toks } = tokens(q);
  if (!toks.length) return [];
  const out = [];
  for (const e of S_INDEX) {
    let ok = true;
    for (const tk of toks) { if (!hit(e.hay, tk)) { ok = false; break; } }
    if (!ok) continue;
    const exact = (' ' + e.nAr).indexOf(' ' + qn) >= 0 || (' ' + e.nEn).indexOf(' ' + qn) >= 0 ? 1 : 0;
    const start = e.nAr.indexOf(toks[0].t) === 0 || e.nEn.indexOf(toks[0].t) === 0 ? 1 : 0;
    let direct = 0;
    toks.forEach((tk) => { if (hit(e.names, tk)) direct++; });
    out.push({ item: e.item, e, exact, start, direct });
  }
  out.sort((a, b) => (b.exact - a.exact) || (b.start - a.start) || (a.e.rank - b.e.rank) || (b.e.featured - a.e.featured) || (b.direct - a.direct) || (a.e.i - b.e.i));
  return out;
};
/** Categories whose names match every word of q. */
GB.search.categories = function (q) {
  const { toks } = tokens(q);
  if (!toks.length) return [];
  return S_CATS.filter((c) => c.hay && toks.every((tk) => hit(c.hay, tk)));
};

/** Safe HTML of text with <mark> around the word prefixes matched by q. */
GB.search.highlight = function (text, q) {
  const src = String(text || '');
  const { toks } = tokens(q);
  if (!toks.length) return GB.esc(src);
  const { t, map } = normMap(src);
  const ranges = [];
  const isStart = (k) => k === 0 || t.charAt(k - 1) === ' ';
  toks.forEach((tk) => {
    [tk.t, tk.s].filter(Boolean).forEach((w) => {
      let k = t.indexOf(w);
      while (k >= 0) {
        // word start, or right after a proclitic article at the word start (التبريد ← تبريد)
        const art = k >= 2 && /^(ال|لل)$/.test(t.slice(k - 2, k)) && isStart(k - 2);
        const art3 = k >= 3 && /^(وال|بال|فال|كال)$/.test(t.slice(k - 3, k)) && isStart(k - 3);
        if (isStart(k) || art || art3) ranges.push([map[k], map[k + w.length - 1] + 1]);
        k = t.indexOf(w, k + 1);
      }
    });
  });
  if (!ranges.length) return GB.esc(src);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  ranges.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice());
  });
  let html = '', pos = 0;
  merged.forEach((r) => {
    html += GB.esc(src.slice(pos, r[0])) + '<mark class="gb-search-hl">' + GB.esc(src.slice(r[0], r[1])) + '</mark>';
    pos = r[1];
  });
  return html + GB.esc(src.slice(pos));
};

/* ------------------------------------------------------------------ recent searches */
const RECENT_MAX = 6;
GB.search.recent = {
  list() {
    const v = GB.storage.get('searches', []);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, RECENT_MAX) : [];
  },
  add(q) {
    const v = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (norm(v).length < 2) return;
    const n = norm(v);
    const list = [v].concat(GB.search.recent.list().filter((x) => norm(x) !== n)).slice(0, RECENT_MAX);
    GB.storage.set('searches', list);
  },
  clear() { GB.storage.remove('searches'); },
};

/* ------------------------------------------------------------------ shared markup */
const searchUrl = (q) => GB.url('search/') + (q ? '?q=' + encodeURIComponent(q) : '');
function recentHtml(headingLevel) {
  const list = GB.search.recent.list();
  if (!list.length) return '';
  const h = 'h' + headingLevel;
  return '<div class="gb-search-block gb-search-block--recent"><div class="gb-search-block__head"><' + h + ' class="gb-search-block__title">' + GB.esc(GB.t('search.recent')) + '</' + h + '>' +
    '<button type="button" class="gb-search-clear" data-action="search-clear-recent" aria-label="' + GB.esc(GB.t('search.clearRecentLabel')) + '">' + GB.esc(GB.t('search.clearRecent')) + '</button></div>' +
    '<ul class="gb-chips gb-search-chips" role="list">' + list.map((q) => '<li><a class="gb-chip" href="' + GB.esc(searchUrl(q)) + '" data-search-recent="' + GB.esc(q) + '">' +
      GB.icon('clock') + '<bdi>' + GB.esc(q) + '</bdi></a></li>').join('') + '</ul></div>';
}
function catChipsHtml(cats, titleKey, headingLevel) {
  if (!cats.length) return '';
  const h = 'h' + headingLevel;
  return '<div class="gb-search-block"><' + h + ' class="gb-search-block__title">' + GB.esc(GB.t(titleKey)) + '</' + h + '>' +
    '<ul class="gb-chips gb-search-chips" role="list">' + cats.map((c) => '<li><a class="gb-chip gb-search-catchip" href="' + GB.esc(c.url) + '">' +
      GB.catalog.art(c.id, 'gb-search-catchip__art') + '<span>' + GB.esc(c.name) + '</span></a></li>').join('') + '</ul></div>';
}
function noResultsHtml(q, headingLevel) {
  const h = 'h' + headingLevel;
  return '<div class="gb-empty gb-search-none">' + GB.icon('search', 'gb-empty__icon') +
    '<' + h + ' class="gb-empty__title">' + GB.esc(GB.t('search.noResultsTitle', { q })) + '</' + h + '>' +
    '<p class="gb-empty__text">' + GB.esc(GB.t('search.noResultsText')) + '</p>' +
    '<div class="gb-empty__actions"><a class="gb-btn gb-btn--wa" href="' + GB.esc(GB.wa(GB.t('search.askWaMsg', { q }))) + '" target="_blank" rel="noopener">' +
    GB.icon('whatsapp') + '<span>' + GB.esc(GB.t('search.askWa')) + '</span><span class="gb-sr"> ' + GB.esc(GB.t('a11y.newTab')) + '</span></a></div></div>';
}
function errorHtml() {
  return '<div class="gb-alert gb-alert--error gb-search-error" role="alert">' + GB.icon('alert') + '<span>' + GB.esc(GB.t('common.error')) + '</span>' +
    '<button type="button" class="gb-btn gb-btn--light" data-action="search-retry">' + GB.icon('refresh') + '<span>' + GB.esc(GB.t('common.retry')) + '</span></button></div>';
}
function track(q, n) {
  GB.track('search', { q: q.slice(0, 60), n });
  if (!n) GB.track('search_no_results', { q: q.slice(0, 60) });
}

/* ------------------------------------------------------------------ header overlay (#gb-search) */
const OVERLAY_TOP = 8;
GB.ready(() => {
  const dialog = document.getElementById('gb-search');
  const body = document.getElementById('gb-search-body');
  const input = document.getElementById('gb-search-input');
  const form = document.getElementById('gb-search-form');
  if (!dialog || !body || !input || !form) return;

  body.innerHTML = '<p class="gb-search-status" id="gb-search-status" role="status" aria-live="polite" aria-atomic="true"></p><div class="gb-search-panel" id="gb-search-panel"></div>';
  const status = document.getElementById('gb-search-status');
  const panel = document.getElementById('gb-search-panel');
  input.setAttribute('aria-describedby', 'gb-search-status');
  let timer = 0, trackTimer = 0, lastTracked = '', seq = 0;

  const setStatus = (txt) => { if (status.textContent !== txt) status.textContent = txt; };
  function idle() {
    setStatus('');
    panel.innerHTML = recentHtml(3) + catChipsHtml(GB.catalog.cats(), 'search.browseCats', 3);
  }
  function render() {
    const q = input.value;
    const qn = norm(q);
    clearTimeout(trackTimer);
    if (!qn) { idle(); return; }
    if (qn.length < 2 && !/\d/.test(qn)) { setStatus(GB.t('search.minChars')); panel.innerHTML = recentHtml(3); return; }
    const my = ++seq;
    if (!S_INDEX) {
      setStatus(GB.t('common.loading'));
      panel.setAttribute('aria-busy', 'true');
      GB.search.ready().then(() => { panel.removeAttribute('aria-busy'); if (my === seq) render(); })
        .catch(() => { panel.removeAttribute('aria-busy'); if (my === seq) { setStatus(''); panel.innerHTML = errorHtml(); } });
      return;
    }
    const res = GB.search.query(q);
    const cats = GB.search.categories(q).slice(0, 3);
    const n = res.length;
    setStatus(GB.t('search.results', { n }));
    if (!n) {
      panel.innerHTML = noResultsHtml(q.trim(), 3) + catChipsHtml(cats.length ? cats : GB.catalog.cats(), cats.length ? 'search.catMatches' : 'search.browseCats', 3);
    } else {
      panel.innerHTML = catChipsHtml(cats, 'search.catMatches', 3) +
        '<div class="gb-search-block"><h3 class="gb-search-block__title gb-sr">' + GB.esc(GB.t('search.products')) + '</h3><ul class="gb-search-list" role="list">' +
        res.slice(0, OVERLAY_TOP).map((r) => itemRow(r.item, q)).join('') + '</ul></div>' +
        '<a class="gb-btn gb-btn--light gb-btn--block gb-search-all" href="' + GB.esc(searchUrl(q.trim())) + '">' + GB.esc(GB.t('search.viewAll', { n })) + GB.icon('arrow-forward') + '</a>';
      GB.checkImages(panel);
    }
    const tq = qn;
    trackTimer = setTimeout(() => { if (tq !== lastTracked) { lastTracked = tq; track(q.trim(), n); } }, 1500);
  }
  function itemRow(item, q) {
    return '<li><a class="gb-search-item" href="' + GB.esc(GB.purl(item)) + '">' + GB.catalog.media(item, 'gb-search-item__media') +
      '<span class="gb-search-item__body"><span class="gb-search-item__name">' + GB.catalog.nameHtml(item, GB.search.highlight(GB.pname(item), q)) + '</span>' +
      '<span class="gb-search-item__meta">' + GB.catalog.price(item) + GB.catalog.stock(item.a) + '</span></span></a></li>';
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 120); });
  form.addEventListener('submit', (e) => {
    const q = input.value.trim();
    if (!norm(q)) { e.preventDefault(); input.focus(); return; }
    input.value = q;
    clearTimeout(trackTimer);
    if (!S_INDEX || GB.search.query(q).length) GB.search.recent.add(q);
    // native GET navigation to search/?q= continues
  });
  GB.listen('dialog:open', (d) => {
    if (d.id !== 'gb-search') return;
    if (!input.value && document.body.classList.contains('page-search')) {
      const pq = GB.$('#search-page-q');
      if (pq && pq.value) input.value = pq.value;
    }
    render();
    GB.search.ready().catch(() => { /* rendered as an error when needed */ });
  });
  // keyboard: ↓ from the input enters the panel; ↑/↓ move through its links/buttons in reading order;
  // ↑ on the first one returns to the input (Tab order is unchanged)
  const focusables = () => GB.$$('a[href], button:not([disabled])', panel).filter((el) => !el.closest('[hidden]'));
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown') return;
    const first = focusables()[0];
    if (first) { e.preventDefault(); first.focus(); }
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = focusables();
    const k = list.indexOf(document.activeElement);
    if (k < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowDown') { if (k < list.length - 1) list[k + 1].focus(); }
    else (k > 0 ? list[k - 1] : input).focus();
  });
  panel.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const recent = t.closest('[data-search-recent]');
    if (recent && !(e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0)) {
      e.preventDefault();
      input.value = recent.getAttribute('data-search-recent');
      render();
      input.focus();
      return;
    }
    if (t.closest('[data-action="search-clear-recent"]')) {
      GB.search.recent.clear();
      GB.announce(GB.t('search.recentCleared'));
      render();
      input.focus();
      return;
    }
    if (t.closest('[data-action="search-retry"]')) { render(); return; }
    if (t.closest('.gb-search-item, .gb-search-all')) {
      clearTimeout(trackTimer);
      const q = input.value.trim();
      if (norm(q)) { GB.search.recent.add(q); if (norm(q) !== lastTracked) track(q, GB.search.query(q).length); }
    }
  });
});

/* ------------------------------------------------------------------ search page (search/?q=) */
GB.ready(() => {
  if (!document.body.classList.contains('page-search')) return;
  const form = GB.$('#search-page-form');
  const input = GB.$('#search-page-q');
  const results = GB.$('#search-results');
  const start = GB.$('#search-start');
  const recentBox = GB.$('#search-recent');
  if (!form || !input || !results || !start) return;
  const baseTitle = document.title;
  let current = null; // query currently rendered
  let ctl = null;

  function showRecent() {
    const html = recentHtml(2);
    recentBox.innerHTML = html;
    recentBox.hidden = !html;
  }
  function showStart() {
    current = '';
    results.hidden = true;
    results.innerHTML = '';
    start.hidden = false;
    document.title = baseTitle;
    showRecent();
  }
  function run(q, how) {
    q = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    input.value = q;
    if (!norm(q)) { showStart(); return; }
    if (q === current && ctl) { ctl.fromUrl(); return; }
    current = q;
    document.title = GB.t('search.docTitle', { q });
    results.hidden = false;
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = '<p class="gb-search-loading" role="status">' + GB.esc(GB.t('common.loading')) + '</p>';
    GB.search.ready().then(() => {
      if (current !== q) return;
      results.removeAttribute('aria-busy');
      const res = GB.search.query(q);
      const n = res.length;
      if (how !== 'pop') { if (n) GB.search.recent.add(q); track(q, n); }
      if (!n) {
        results.innerHTML = noResultsHtml(q, 2);
        start.hidden = false;
        showRecent();
        ctl = null;
        GB.announce(GB.t('search.noResultsTitle', { q }));
        return;
      }
      start.hidden = true;
      const cats = GB.search.categories(q).slice(0, 4);
      const items = res.map((r) => r.item);
      results.innerHTML = '<section class="gb-catalog gb-search-listing" data-listing="search" aria-labelledby="search-results-title">' +
        '<h2 class="gb-search-heading" id="search-results-title">' + GB.esc(GB.t('search.resultsFor', { q })) + '</h2>' +
        catChipsHtml(cats, 'search.catMatches', 3) + GB.catalog.toolbar(items) +
        '<ul class="gb-grid gb-catalog__grid" role="list">' + res.map((r) => '<li class="gb-grid__item">' +
          GB.catalog.card(r.item, { nameHtml: GB.search.highlight(GB.pname(r.item), q) }) + '</li>').join('') + '</ul>' +
        '<div class="gb-catalog__empty" data-listing-empty hidden><div class="gb-empty">' + GB.icon('filter', 'gb-empty__icon') +
        '<h3 class="gb-empty__title">' + GB.esc(GB.t('catalog.emptyTitle')) + '</h3><p class="gb-empty__text">' + GB.esc(GB.t('catalog.emptyText')) + '</p>' +
        '<div class="gb-empty__actions"><button type="button" class="gb-btn gb-btn--primary" data-filter-reset>' + GB.icon('refresh') + '<span>' + GB.esc(GB.t('catalog.reset')) + '</span></button></div></div></div>' +
        '</section>';
      if (!ctl) {
        ctl = GB.catalog.listing(results, {
          countText: (shown, total, filtered) => (filtered ? (shown ? GB.t('catalog.filteredCount', { shown, total }) : GB.t('catalog.noneShown')) : GB.t('search.results', { n: total })),
        });
      }
      ctl.scan();
      GB.catalog.current = ctl;
      if (how === 'submit') ctl.set({ sort: 'best', stock: false, sale: false, brands: [], cat: '' }, null);
      else ctl.fromUrl();
      GB.ui.hydrate(results);
    }).catch(() => {
      if (current !== q) return;
      results.removeAttribute('aria-busy');
      results.innerHTML = errorHtml();
      current = null;
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.replace(/\s+/g, ' ').trim();
    const url = searchUrl(norm(q) ? q : '');
    try { history.pushState({ gbSearch: 1 }, '', url); } catch (err) { /* ignore */ }
    GB.catalog.syncLang();
    current = null;
    run(q, 'submit');
    if (norm(q)) { try { input.blur(); } catch (err) { /* ignore */ } }
  });
  results.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('[data-action="search-retry"]')) { current = null; run(input.value, 'retry'); }
  });
  start.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (t && t.closest('[data-action="search-clear-recent"]')) {
      GB.search.recent.clear();
      showRecent();
      GB.announce(GB.t('search.recentCleared'));
      input.focus();
    }
  });
  window.addEventListener('popstate', () => {
    let q = '';
    try { q = new URLSearchParams(location.search).get('q') || ''; } catch (e) { q = ''; }
    GB.catalog.syncLang();
    run(q, 'pop');
  });
  let q0 = '';
  try { q0 = new URLSearchParams(location.search).get('q') || ''; } catch (e) { q0 = ''; }
  GB.catalog.syncLang();
  run(q0, 'load');
});
