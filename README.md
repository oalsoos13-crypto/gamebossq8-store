# GameBoss Q8 — متجر إكسسوارات الألعاب

متجر إلكتروني ثنائي اللغة (العربية أولاً، والإنجليزية) لإكسسوارات ألعاب الموبايل والآيباد في الكويت.
موقع ثابت سريع يعمل على GitHub Pages، ويمكن تثبيته على الجوال كتطبيق (PWA). **الطلب يُرسل إلى واتساب المتجر** برسالة جاهزة فيها رقم الطلب والمنتجات والمجموع والعنوان.

- المتجر: <https://oalsoos13-crypto.github.io/gamebossq8-store/> · English: <https://oalsoos13-crypto.github.io/gamebossq8-store/en/>
- دليل التشغيل لصاحب المتجر: [`docs/operations.md`](docs/operations.md)
- أسئلة مفتوحة لصاحب المتجر: [`docs/owner-questions.md`](docs/owner-questions.md)

## باختصار

| | |
|---|---|
| المنتجات | 165 منتجاً في 12 قسماً، من ملف تصدير WooCommerce (`data/catalog.json` هو المرجع) |
| الطلب | سلة ← صفحة إتمام الطلب ← رسالة واتساب جاهزة إلى ‎+965 9793 7556 (كاش عند الاستلام أو رابط KNET) |
| اللغات | العربية في الجذر `/`، والإنجليزية تحت `/en/`، ولكل صفحة نظيرتها |
| التقنية | مولّد صفحات بـ Node.js بدون أي حزم خارجية؛ HTML/CSS/JS عادي؛ بدون خادم ولا قاعدة بيانات ولا أسرار |
| الخصوصية | السلة والمفضلة والطلبات محفوظة في متصفح الزبون فقط؛ لا يصلنا إلا ما يرسله على واتساب |

## الأوامر الأساسية

المتطلبات: Node.js 20 أو أحدث. لا يحتاج إلى `npm install`.

```bash
# بناء نسخة للمعاينة (في مجلد مؤقت؛ المجلد الأب يُخدم كجذر حتى تعمل المسارات تحت /gamebossq8-store/)
node tools/build.mjs --out /tmp/gb/gamebossq8-store
python3 -m http.server 8080 -d /tmp/gb          # افتح http://localhost:8080/gamebossq8-store/

# الفحص الآلي الكامل (Playwright + axe-core)
node tools/verify.mjs --out /tmp/gb/gamebossq8-store

# النشر: البناء في جذر المستودع ثم push إلى main (GitHub Pages: الفرع main، المجلد /)
node tools/build.mjs
git add -A && git commit -m "…" && git push

# تحديث المنتجات من ملف تصدير WooCommerce (يدمج ويحافظ على التعديلات اليدوية)
node tools/import-csv.mjs export.csv --dry-run
node tools/import-csv.mjs export.csv

# نقل صور المنتجات من ووردبريس إلى المستودع (قبل إلغاء استضافة ووردبريس)
node tools/mirror-images.mjs --dry-run
node tools/mirror-images.mjs
```

التفاصيل والخطوات الكاملة (تفعيل رسوم التوصيل، الإحصاءات، روابط السوشال، مفتاح إيقاف الـ Service Worker، التراجع، الدومين الخاص) موجودة في [`docs/operations.md`](docs/operations.md).

---

## English

**GameBoss Q8** is a bilingual (Arabic-first, RTL / English, LTR) storefront for mobile and iPad gaming accessories in Kuwait. It is a fast static site on GitHub Pages and an installable PWA. Checkout is a real order flow: it builds a pre-filled WhatsApp message (order ref, `[#id]` lines, totals, address, payment method) to the shop's number. There is no server, no database and no secrets in the client.

### Build, preview, verify, deploy

Requires Node ≥ 20. The build itself has **zero npm dependencies**; Playwright and axe-core are only used by the verification script and are resolved from outside the build path.

```bash
node tools/build.mjs --out /tmp/gb/gamebossq8-store        # private preview build
python3 -m http.server 8080 -d /tmp/gb                     # → http://localhost:8080/gamebossq8-store/
node tools/verify.mjs --out /tmp/gb/gamebossq8-store       # quality gates (links, console, overflow, flows, axe, PWA)
node tools/build.mjs                                       # production build into the repo root
git add -A && git commit -m "…" && git push                # GitHub Pages serves main:/ automatically
```

`tools/build.mjs` flags: `--out <dir>` (default: repo root), `--base /gamebossq8-store/`, `--origin https://oalsoos13-crypto.github.io`, `--year 2026`, `--built-at <iso>`, `--set key.path=value` (overrides `data/config.json`, e.g. `--set delivery.confirmed=true`), `--strict` (broken internal links are fatal), `--quiet`.
The build records the files it generated in `.build-manifest.json`, and the next build into the same directory deletes only those files. It never touches `src/`, `data/`, `tools/`, `docs/`, `.git/` or this README.

### Data and operations

- `data/catalog.json` is the hand-editable source of truth (165 products, integer prices in fils, stable WooCommerce ids, immutable slugs). The build validates it and refuses bad data.
- `node tools/import-csv.mjs <export.csv>` re-runs the WooCommerce cleaning pipeline. It skips the English translation twins and unpublished rows, cleans names, descriptions, brands and images, and applies the sale-price rule. It then **merges** into the catalog, keeping the manual fields (slug, English name and description, featured, sort, category), and prints a diff summary. Options: `--dry-run`, `--check`, `--keep-removed`, `--take-csv <fields>`, `--report`, `--anomalies`. Run against the original export, it reproduces the current catalog byte for byte.
- `node tools/mirror-images.mjs` (run it on a networked machine before WordPress hosting is cancelled) downloads every product image to `src/static/img/p/<id>/<n>.<ext>` and rewrites the catalog to site-relative `img/p/…` paths. It is resumable, has `--dry-run`, and later CSV imports keep the mirrored paths.
- Delivery fees stay hidden until the owner confirms them (`config.delivery.confirmed`). Analytics stay off unless GoatCounter is configured. The service worker has a kill switch: `--set pwa.killSwitch=true`.
- Owner-facing guides are in Arabic: `docs/operations.md` and `docs/owner-questions.md`.

### Project structure

```
data/                 catalog.json · categories.json · config.json · i18n.json   (source of truth)
src/core/             server-side render helpers: html escaping, urls, money, i18n, icons, head, JSON-LD, components, layout
src/pages/*.mjs       auto-discovered page modules (home, category, product, search, wishlist, checkout, info, 404, offline, PWA files)
src/js/NN-*.js        browser modules, bundled in order into assets/app.<hash>.js (GB namespace)
src/css/NN-*.css      styles, bundled in order into assets/app.<hash>.css
src/i18n/*.json       per-module UI strings (Arabic + English)
src/static/           copied verbatim (fonts, icons, favicon, mirrored product images)
src/CONTRACTS.md      contracts between modules (APIs, routes, CSS tokens, i18n rules)
tools/                build.mjs · verify.mjs · import-csv.mjs · mirror-images.mjs · make-icons.mjs · prepare-data.mjs
docs/                 operations.md · owner-questions.md  (Arabic, for the shop owner)
index.html, en/, p/, c/, info/, search/, wishlist/, checkout/, offline/, assets/, sw.js, …   ← generated by the build (do not edit)
```

URLs: home `/gamebossq8-store/` · product `p/<slug>-<id>/` · category `c/<id>/` · `search/?q=` · `wishlist/` · `checkout/` · `info/<how-to-order|delivery-payment|returns|about|privacy>/`, all mirrored under `en/`.

---
GameBoss Q8 · الكويت · [Instagram](https://www.instagram.com/game_bossq8/) · [TikTok](https://www.tiktok.com/@gamebossq8) · [WhatsApp](https://wa.me/96597937556)
