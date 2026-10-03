/* 50-home.js — Home page behaviour (owner: home module).
     Recently viewed rail: rendered from GB.recent + products.json; hidden while empty or when products.json fails.
     "Clear history" button (data-action="home-recent-clear").
   Server markup: src/pages/home.mjs (#home-recent shell, page data { home: { recentMax } }; cards come from GB.ui.card). */

/** Client card: the shared foundation renderer, wrapped as a rail item. */
function homeCard(p) {
  return '<li class="gb-rail__item">' + GB.ui.card(p, { idSuffix: 'home-recent' }) + '</li>';
}

GB.ready(() => {
  if (!document.body.classList.contains('page-home')) return;
  const section = GB.$('[data-home-recent]');
  const track = section && GB.$('[data-home-recent-track]', section);
  if (!track) return;
  const pd = (GB.page() || {}).home || {};
  const conf = { max: Number(pd.recentMax) || 12 };
  let shownKey = '';

  function hide() {
    section.hidden = true;
    track.innerHTML = '';
    shownKey = '';
  }

  function render() {
    const ids = GB.recent.list().slice(0, conf.max);
    if (!ids.length) { hide(); return; }
    GB.products().then((map) => {
      const items = GB.recent.list().slice(0, conf.max).map((id) => map.get(String(id))).filter(Boolean);
      if (!items.length) { hide(); return; }
      const key = items.map((p) => p.id).join(',');
      if (key === shownKey && !section.hidden) return;
      shownKey = key;
      track.innerHTML = items.map((p) => homeCard(p)).join('');
      section.hidden = false;
      GB.ui.hydrate(section);
      track.dispatchEvent(new Event('scroll')); // refresh the rail arrows now that the track has content
    }).catch(() => { hide(); }); // secondary feature: stay hidden when products.json is unavailable
  }

  GB.on('click', '[data-action="home-recent-clear"]', (e) => {
    e.preventDefault();
    GB.recent.clear();
    // The section disappears: move focus to the next section heading so keyboard users keep their place.
    const next = section.nextElementSibling && GB.$('.gb-sechead__title', section.nextElementSibling);
    hide();
    GB.announce(GB.t('home.recentCleared'));
    const target = next || document.getElementById('main');
    if (target) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      try { target.focus({ preventScroll: false }); } catch (err) { target.focus(); }
    }
  });

  GB.listen('recent:change', render);
  // Back/forward cache: the visitor may have viewed products since this page was first rendered.
  window.addEventListener('pageshow', (e) => { if (e.persisted) render(); });
  render();
});
