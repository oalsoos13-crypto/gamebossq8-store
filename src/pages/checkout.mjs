// src/pages/checkout.mjs — checkout/ (cart module, SPEC §5).
//
// Prerendered shell with every state; src/js/31-checkout.js picks one on load:
//   #co-boot   loading (visible until JS decides)       #co-empty  empty cart
//   #co-main   form + order summary                     #co-done   "one last step" / sent confirmation (?ref=GB-…)
// The form is a native <form novalidate>; field names (stable test hooks):
//   name phone governorate area block street avenue house notes payment(cod|knet_link) save
// Strings the client needs only here are passed as pageData.cartI18n (merged into GB.i18n by 30-cart.js).

/** Locale values of every i18n key starting with one of `prefixes` (client strings for one page only). */
export function cartPageI18n(ctx, prefixes) {
  const out = {};
  for (const [k, v] of Object.entries(ctx.i18n)) {
    if (prefixes.some((p) => k.startsWith(p)) && v && v[ctx.locale] !== undefined) out[k] = v[ctx.locale];
  }
  return out;
}

// Area suggestions for the checkout <datalist> (free text stays allowed). SEED list from the audit
// (scratchpad/audit/kw_areas_seed.json) — the owner should review it; a missing area never blocks an order.
const AREAS = {
  capital: ['مدينة الكويت', 'الشرق', 'المرقاب', 'القبلة', 'دسمان', 'الصوابر', 'الدسمة', 'بنيد القار', 'الدعية', 'المنصورية', 'عبدالله السالم', 'النزهة', 'الفيحاء', 'الشامية', 'الروضة', 'العديلية', 'الخالدية', 'كيفان', 'القادسية', 'قرطبة', 'السرة', 'اليرموك', 'الشويخ', 'غرناطة', 'الصليبيخات', 'الدوحة', 'النهضة', 'القيروان'],
  hawalli: ['حولي', 'الشعب', 'السالمية', 'الرميثية', 'الجابرية', 'مشرف', 'بيان', 'سلوى', 'البدع', 'النقرة', 'ميدان حولي', 'الزهراء', 'الصديق', 'حطين', 'السلام', 'الشهداء', 'مبارك العبدالله'],
  farwaniya: ['الفروانية', 'خيطان', 'جليب الشيوخ', 'العمرية', 'الرابية', 'الرحاب', 'الأندلس', 'إشبيلية', 'الرقعي', 'العارضية', 'صباح الناصر', 'الفردوس', 'عبدالله المبارك', 'الضجيج'],
  ahmadi: ['الأحمدي', 'الفحيحيل', 'المنقف', 'أبو حليفة', 'الفنطاس', 'المهبولة', 'الرقة', 'هدية', 'الصباحية', 'الظهر', 'العقيلة', 'جابر العلي', 'فهد الأحمد', 'الوفرة', 'الخيران', 'صباح الأحمد', 'علي صباح السالم', 'الزور'],
  jahra: ['الجهراء', 'القصر', 'النعيم', 'الواحة', 'تيماء', 'العيون', 'النسيم', 'سعد العبدالله', 'الصليبية', 'أمغرة', 'كبد', 'العبدلي'],
  mubarak: ['مبارك الكبير', 'القرين', 'العدان', 'القصور', 'صبحان', 'الفنيطيس', 'أبو فطيرة', 'المسيلة', 'صباح السالم', 'المسايل', 'أبو الحصانية'],
};

const GOV_KEY = { capital: 'checkout.govCapital', hawalli: 'checkout.govHawalli', farwaniya: 'checkout.govFarwaniya', ahmadi: 'checkout.govAhmadi', jahra: 'checkout.govJahra', mubarak: 'checkout.govMubarak' };
const PAY = { cod: ['checkout.payCod', 'checkout.payCodHint', 'cash'], knet_link: ['checkout.payKnet', 'checkout.payKnetHint', 'card'] };

export default function routes(ctx) {
  const { html, layout, breadcrumbs, emptyState, icon, waLink } = ctx.h;
  const T = ctx.t;
  const route = 'checkout/';
  const govs = (ctx.config.governorates || Object.keys(GOV_KEY)).filter((g) => GOV_KEY[g]);
  const pays = (ctx.config.payments || Object.keys(PAY)).filter((p) => PAY[p]);

  const req = html`<span class="gb-req" aria-hidden="true">*</span>`;
  const opt = html` <span class="gb-co-opt">${T('checkout.optional')}</span>`;
  const err = (f) => html`<p class="gb-error" id="co-${f}-err" hidden></p>`;
  /** One labelled text field. o: { f, label, required, hint, type, attrs (SafeHtml), wide } */
  const field = (o) => {
    const described = [o.hint ? `co-${o.f}-hint` : '', `co-${o.f}-err`].filter(Boolean).join(' ');
    return html`<div class="${o.wide ? 'gb-field gb-co-wide' : 'gb-field'}" data-field="${o.f}">
<label class="gb-label" for="co-${o.f}">${o.label}${o.required ? req : opt}</label>
${o.hint ? html`<p class="gb-hint" id="co-${o.f}-hint">${o.hint}</p>` : ''}
${o.control || html`<input class="gb-input" id="co-${o.f}" name="${o.f}" type="${o.type || 'text'}"${o.required ? html` required aria-required="true"` : ''} aria-describedby="${described}"${o.attrs || ''}>`}
${err(o.f)}
</div>`;
  };
  const stepHead = (n, id, key) => html`<h2 class="gb-co-h" id="${id}"><span class="gb-co-step" aria-hidden="true">${n}</span><span>${T(key)}</span></h2>`;

  const govSelect = html`<select class="gb-select" id="co-governorate" name="governorate" required aria-required="true" autocomplete="address-level1" aria-describedby="co-governorate-err">
<option value="">${T('checkout.governoratePick')}</option>
${govs.map((g) => html`<option value="${g}">${T(GOV_KEY[g])}</option>`)}
</select>`;
  const notes = html`<textarea class="gb-textarea" id="co-notes" name="notes" rows="3" maxlength="300" aria-describedby="co-notes-hint co-notes-err"></textarea>`;

  const form = html`<form class="gb-co-form" id="checkout-form" action="${ctx.url(route)}" method="post" novalidate>
<div class="gb-alert gb-alert--error gb-co-errors" id="co-errors" role="alert" tabindex="-1" hidden></div>
<div class="gb-co-cols">
<div class="gb-co-fields">
<p class="gb-co-reqnote">${T('checkout.required')}</p>
<section class="gb-panel gb-co-sec" aria-labelledby="co-h-contact">
${stepHead(1, 'co-h-contact', 'checkout.sectionContact')}
<div class="gb-co-grid">
${field({ f: 'name', label: T('checkout.name'), required: true, wide: true, attrs: html` autocomplete="name" maxlength="60" enterkeyhint="next"` })}
${field({ f: 'phone', label: T('checkout.phone'), required: true, wide: true, type: 'tel', hint: T('checkout.phoneHint'), attrs: html` inputmode="tel" autocomplete="tel-national" dir="ltr" maxlength="16" enterkeyhint="next"` })}
</div>
</section>
<section class="gb-panel gb-co-sec" aria-labelledby="co-h-address">
${stepHead(2, 'co-h-address', 'checkout.sectionAddress')}
<div class="gb-co-grid">
${field({ f: 'governorate', label: T('checkout.governorate'), required: true, control: govSelect })}
${field({ f: 'area', label: T('checkout.area'), required: true, attrs: html` autocomplete="address-level2" maxlength="40" list="co-area-list" enterkeyhint="next"` })}
${field({ f: 'block', label: T('checkout.block'), required: true, attrs: html` inputmode="numeric" maxlength="10" enterkeyhint="next"` })}
${field({ f: 'street', label: T('checkout.street'), required: true, attrs: html` autocomplete="address-line1" maxlength="60" enterkeyhint="next"` })}
${field({ f: 'avenue', label: T('checkout.avenue'), attrs: html` maxlength="20" enterkeyhint="next"` })}
${field({ f: 'house', label: T('checkout.house'), required: true, hint: T('checkout.houseHint'), attrs: html` autocomplete="address-line2" maxlength="40" enterkeyhint="next"` })}
${field({ f: 'notes', label: T('checkout.notes'), wide: true, hint: T('checkout.notesHint'), control: notes })}
</div>
<datalist id="co-area-list"></datalist>
</section>
<section class="gb-panel gb-co-sec" aria-labelledby="co-h-pay">
${stepHead(3, 'co-h-pay', 'checkout.sectionPayment')}
<div class="gb-co-pays" role="radiogroup" aria-labelledby="co-h-pay" aria-required="true" aria-describedby="co-payment-err" data-field="payment">
${pays.map((p, i) => html`<label class="gb-option gb-co-pay" for="co-pay-${p}"><input type="radio" id="co-pay-${p}" name="payment" value="${p}"${i === 0 ? html` checked` : ''}>
<span class="gb-co-pay__text"><span class="gb-co-pay__title">${T(PAY[p][0])}</span><span class="gb-co-pay__hint">${T(PAY[p][1])}</span></span>${icon(PAY[p][2], { cls: 'gb-co-pay__icon' })}</label>`)}
</div>
${err('payment')}
</section>
<div class="gb-co-save">
<label class="gb-check" for="co-save"><input type="checkbox" id="co-save" name="save" value="1" aria-describedby="co-save-hint"><span>${T('checkout.save')}</span></label>
<p class="gb-hint" id="co-save-hint">${T('checkout.saveHint')} <a class="gb-co-link" href="${ctx.url('info/privacy/')}">${T('checkout.privacyLink')}</a></p>
</div>
</div>
<aside class="gb-co-aside" aria-labelledby="co-h-review">
<section class="gb-panel gb-co-sum">
${stepHead(4, 'co-h-review', 'checkout.sectionReview')}
<div id="co-summary" class="gb-co-sum__body" aria-live="polite"><p class="gb-muted">${T('common.loading')}</p></div>
<button type="button" class="gb-btn gb-btn--light gb-btn--block gb-co-edit" data-dialog-open="gb-cart" aria-haspopup="dialog" aria-controls="gb-cart">${icon('cart')}<span>${T('checkout.editCart')}</span></button>
</section>
<div class="gb-co-submit">
<button type="submit" class="gb-btn gb-btn--wa gb-btn--block gb-btn--lg" id="co-submit" aria-describedby="co-submit-note">${icon('whatsapp')}<span>${T('checkout.submit')}</span></button>
<p class="gb-hint gb-co-submit__note" id="co-submit-note">${T('checkout.submitNote')}</p>
</div>
</aside>
</div>
</form>`;

  const main = html`
<div class="gb-wrap gb-co">
${breadcrumbs(ctx, [{ name: T('nav.home'), route: '' }, { name: T('checkout.title'), route }])}
<header class="gb-pagehead gb-co-head">
<h1 class="gb-pagehead__title" id="co-title" tabindex="-1">${T('checkout.title')}</h1>
<p class="gb-pagehead__sub">${T('checkout.lead')}</p>
</header>
<noscript><p class="gb-alert">${icon('info')}<span>${T('checkout.noscript')} <a class="gb-co-link" href="${waLink(ctx, T('common.waGreeting'))}" target="_blank" rel="noopener">${T('nav.chatWhatsapp')}<span class="gb-sr"> ${T('a11y.newTab')}</span></a></span></p></noscript>
<div id="co-boot" class="gb-cart-boot" role="status"><span class="gb-cart-spinner" aria-hidden="true"></span><span>${T('common.loading')}</span></div>
<div id="co-empty" hidden>${emptyState(ctx, {
    icon: 'cart', title: T('cart.empty'), text: T('checkout.emptyText'),
    actions: html`<a class="gb-btn gb-btn--primary" href="${ctx.url('')}">${T('common.backHome')}</a><a class="gb-btn gb-btn--light" href="${ctx.url('c/all/')}">${T('cart.browseAll')}</a>`,
  })}</div>
<div id="co-main" hidden>${form}</div>
<section id="co-done" class="gb-co-done" aria-labelledby="co-done-title" hidden></section>
</div>`;

  return [{
    route,
    html: layout(ctx, {
      route,
      bodyClass: 'page-checkout',
      nav: null,
      tabbar: false,
      fab: false,
      head: { title: T('checkout.metaTitle'), description: T('checkout.metaDesc'), noindex: true },
      main,
      pageData: {
        cartI18n: cartPageI18n(ctx, ['checkout.', 'order.']),
        govs: Object.fromEntries(govs.map((g) => [g, T(GOV_KEY[g])])),
        areas: AREAS,
        privacyUrl: ctx.url('info/privacy/'),
      },
    }),
  }];
}
