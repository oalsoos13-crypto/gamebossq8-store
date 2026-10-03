// src/core/html.mjs — XSS-safe HTML building.
//
// Every value interpolated into the `html` tagged template is HTML-escaped unless it is a SafeHtml
// (produced by `html`, `raw`, or any core component). Arrays are flattened (each item follows the same
// rule); null / undefined / false / true render as ''.
//
//   html`<a href="${url}">${name}</a>`        → escaped url + name, returns SafeHtml
//   raw('<b>trusted</b>')                     → marks a trusted string as safe (never use on data!)
//   esc('<x>') === '&lt;x&gt;'               → plain string escaping (text and attribute safe)
//   attrs({ id: 'a', hidden: true, 'data-x': 1, title: null }) → SafeHtml ' id="a" hidden data-x="1"'
//   cls('a', cond && 'b', { c: true })        → 'a b c'

export class SafeHtml {
  constructor(s) { this.s = String(s); }
  toString() { return this.s; }
  get length() { return this.s.length; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape a value for use in HTML text or a double/single-quoted attribute. */
export function esc(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
}
/** Alias of esc() — reads better inside attribute values. */
export const attr = esc;

/** Mark a trusted string as safe HTML. NEVER call this on catalog/user data. */
export function raw(s) { return s instanceof SafeHtml ? s : new SafeHtml(s == null ? '' : s); }

export function isSafe(v) { return v instanceof SafeHtml; }

function render(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof SafeHtml) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

/** Tagged template: escapes interpolations by default. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Join several fragments (escaping plain strings) into one SafeHtml. */
export function join(list, sep = '') {
  return new SafeHtml((list || []).map(render).filter((s) => s !== '').join(render(sep)));
}

/** Build an attribute string. true → boolean attr, false/null/undefined → omitted. */
export function attrs(obj) {
  let out = '';
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (!/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(k)) throw new Error('bad attribute name: ' + k);
    out += v === true ? ` ${k}` : ` ${k}="${esc(v)}"`;
  }
  return new SafeHtml(out);
}

/** className helper. Accepts strings, falsy values, arrays and {name: bool} objects. */
export function cls(...parts) {
  const out = [];
  for (const p of parts.flat(Infinity)) {
    if (!p) continue;
    if (typeof p === 'object') { for (const [k, v] of Object.entries(p)) if (v) out.push(k); }
    else out.push(String(p));
  }
  return out.join(' ');
}

/** Serialize data for <script type="application/json|ld+json"> — safe against </script> breakouts. */
export function jsonForScript(v) {
  return new SafeHtml(JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'));
}

/** Clip text to max chars on a word boundary, adding an ellipsis. */
export function clip(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.،:;—–-]+$/u, '') + '…';
}

/** Plain-text version of a catalog description (bullets/newlines collapsed). */
export function plainText(s) {
  return String(s || '').replace(/[•\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when a string contains Arabic letters. */
export const hasArabic = (s) => /[\u0600-\u06FF]/.test(String(s || ''));
