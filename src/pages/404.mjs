// src/pages/404.mjs — not-found handling (SPEC §3, §8). GitHub Pages serves the ROOT 404.html for every missing path
// under BASE, in both locales, at the requested URL. So:
//   404.html (global, Arabic document) runs a tiny inline script in <head> (before first paint):
//     • /p/<anything>-<id>/ or /p/<id>/ (either locale) → looks the id up in products.json and location.replace()s to
//       the product's CURRENT URL in the same locale (query + hash kept). While it looks, the page shows
//       "Finding the right page…" instead of the 404 content (html.nf-wait).
//     • any other /en/… path → location.replace() to the English not-found page en/404/?from=<path>, which restores
//       the original address with history.replaceState (so the English customer gets an English page and the URL
//       they typed stays in the address bar).
//     • otherwise → the helpful Arabic 404: search box, popular categories, home + WhatsApp.
//   en/404/ (English document, noindex) — the English twin of the helpful 404.
// Without JavaScript both pages simply show the helpful 404 content.

function inlineScript(ctx, isRoot) {
  const { raw, jsonForScript } = ctx.h;
  const cfg = jsonForScript({ base: ctx.base, products: ctx.assets.productsJson, en: ctx.url('404/', 'en'), locales: ctx.locales, def: ctx.defaultLocale });
  // NOTE: plain ES5, no dependencies — runs before the deferred bundle, inside <head>.
  const rootJs = `(function(){var C=${cfg},B=C.base,L=location,P=L.pathname,D=document.documentElement;
if(P.indexOf(B)!==0)return;var rest=P.slice(B.length),loc=C.def;
for(var i=0;i<C.locales.length;i++){var l=C.locales[i];if(l!==C.def&&(rest===l||rest.indexOf(l+'/')===0)){loc=l;rest=rest.slice(l.length+1);break;}}
try{rest=decodeURIComponent(rest);}catch(e){}
var m=/^p\\/(?:.*-)?(\\d{2,9})\\/?(?:index\\.html?)?$/.exec(rest);
function toEn(){if(P.indexOf(C.en)===0){D.className=D.className.replace(/(^|\\s)nf-wait(\\s|$)/,' ');return;}L.replace(C.en+'?from='+encodeURIComponent(P+L.search+L.hash));}
function show(){if(loc!==C.def){toEn();return;}D.className=D.className.replace(/(^|\\s)nf-wait(\\s|$)/,' ');}
if(!m){if(loc!==C.def){D.className+=' nf-wait';toEn();}return;}
D.className+=' nf-wait';var done=false,t=setTimeout(function(){if(!done){done=true;show();}},5000);
try{fetch(C.products,{credentials:'same-origin'}).then(function(r){if(!r.ok)throw 0;return r.json();}).then(function(list){if(done)return;done=true;clearTimeout(t);
for(var j=0;j<list.length;j++){if(String(list[j].id)===m[1]){var to=B+(loc!==C.def?loc+'/':'')+list[j].s;if(to!==P){L.replace(to+L.search+L.hash);return;}break;}}show();})
['catch'](function(){if(!done){done=true;clearTimeout(t);show();}});}catch(e){done=true;clearTimeout(t);show();}
})();`;
  const enJs = `(function(){var C=${cfg};try{var f=new URLSearchParams(location.search).get('from');
if(f&&f.indexOf(C.base)===0&&f.indexOf('//')!==0)history.replaceState(history.state,'',f);}catch(e){}})();`;
  return raw(`<script>${isRoot ? rootJs : enJs}</script>`);
}

export default function routes(ctx) {
  const { html, layout, icon, categoryGrid, waLink } = ctx.h;
  const T = ctx.t;
  const isRoot = ctx.locale === ctx.defaultLocale;
  const route = isRoot ? '404.html' : '404/';
  // popular = most products in stock first (keeps the display order for ties)
  const popular = [...ctx.data.categories].sort((a, b) => (b.inStock - a.inStock) || (a.order - b.order)).slice(0, 6);

  const main = html`
<div class="gb-wrap gb-nf">
<div class="gb-nf__wait" role="status" aria-live="polite"><span class="gb-nf__spinner" aria-hidden="true"></span><span>${T('notfound.checking')}</span></div>
<div class="gb-nf__body">
<section class="gb-nf__hero" aria-labelledby="nf-title">
<div class="gb-nf__badge" aria-hidden="true">404</div>
<p class="gb-eyebrow">${T('notfound.eyebrow')}</p>
<h1 class="gb-nf__title" id="nf-title" tabindex="-1">${T('notfound.title')}</h1>
<p class="gb-nf__text">${T('notfound.text')}</p>
<form class="gb-nf__search" role="search" action="${ctx.url('search/')}" method="get">
<label class="gb-sr" for="nf-q">${T('notfound.searchLabel')}</label>
${icon('search', { cls: 'gb-nf__search-icon' })}
<input class="gb-input gb-nf__input" id="nf-q" name="q" type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="${T('nav.searchPlaceholder')}">
<button class="gb-btn gb-btn--primary" type="submit">${T('nav.searchSubmit')}</button>
</form>
<div class="gb-nf__actions">
<a class="gb-btn gb-btn--light" href="${ctx.url('')}">${icon('home')}<span>${T('common.backHome')}</span></a>
<a class="gb-btn gb-btn--wa" href="${waLink(ctx, T('notfound.waText', { url: ctx.abs('') }))}" target="_blank" rel="noopener" data-nf-wa>${icon('whatsapp')}<span>${T('notfound.askWa')}</span><span class="gb-sr"> ${T('a11y.newTab')}</span></a>
</div>
</section>
<section class="gb-nf__cats" aria-labelledby="nf-cats">
<h2 class="gb-nf__h" id="nf-cats">${T('notfound.catsTitle')}</h2>
${categoryGrid(ctx, popular)}
</section>
</div>
</div>`;

  return [{
    route,
    global: isRoot,
    html: layout(ctx, {
      route,
      altRoute: null,
      nav: null,
      bodyClass: 'page-notfound',
      head: {
        title: T('notfound.metaTitle'),
        description: T('notfound.metaDesc'),
        noindex: true,
        alternates: false,
        extra: inlineScript(ctx, isRoot),
      },
      main,
      pageData: { waText: T('notfound.waText', { url: '{url}' }) },
    }),
  }];
}
