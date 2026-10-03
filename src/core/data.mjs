// src/core/data.mjs — catalog helpers shared by the build and page modules.

export const AVAIL_RANK = { in_stock: 0, backorder: 1, out_of_stock: 2 };

/** Default "الأنسب / best match" comparator: in_stock → backorder → out_of_stock, then `sort` asc, then id desc. */
export function compareDefault(a, b) {
  return (AVAIL_RANK[a.availability] - AVAIL_RANK[b.availability]) || (a.sort - b.sort) || (Number(b.id) - Number(a.id));
}
export const sortDefault = (list) => [...list].sort(compareDefault);

export const isAvailable = (p) => p.availability !== 'out_of_stock';
export const hasImage = (p) => p.images && p.images.length > 0;
export const isOnSale = (p) => !!p.compareAtFils && p.compareAtFils > p.priceFils;

/** Build the ctx.data object from raw JSON. */
export function indexData({ config, catalog, categories }) {
  const products = sortDefault(catalog);
  const byId = new Map(products.map((p) => [p.id, p]));
  const byCat = new Map(categories.map((c) => [c.id, []]));
  for (const p of products) if (byCat.has(p.category)) byCat.get(p.category).push(p);
  // counts are always recomputed from the catalog (categories.json counts may be stale after an import)
  const cats = [...categories].sort((a, b) => a.order - b.order).map((c) => ({
    ...c, count: byCat.get(c.id).length, inStock: byCat.get(c.id).filter((p) => p.availability !== 'out_of_stock').length,
  }));
  const catById = new Map(cats.map((c) => [c.id, c]));
  const brandCounts = new Map();
  for (const p of products) if (p.brand) brandCounts.set(p.brand, (brandCounts.get(p.brand) || 0) + 1);
  const brands = [...brandCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
  return { config, products, categories: cats, byId, byCat, catById, brands };
}

/** Validate catalog/categories; returns an array of error strings (empty = OK). */
export function validateData({ catalog, categories }) {
  const errs = [];
  const catIds = new Set(categories.map((c) => c.id));
  const ids = new Set(), slugs = new Set();
  for (const p of catalog) {
    const where = `product ${p.id}`;
    if (!/^\d+$/.test(String(p.id))) errs.push(`${where}: id must be a numeric string`);
    if (ids.has(p.id)) errs.push(`${where}: duplicate id`); ids.add(p.id);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug || '')) errs.push(`${where}: bad slug "${p.slug}"`);
    if (slugs.has(p.slug)) errs.push(`${where}: duplicate slug "${p.slug}"`); slugs.add(p.slug);
    if (!p.name || !p.name.ar || !p.name.en) errs.push(`${where}: name.ar and name.en required`);
    if (!Number.isInteger(p.priceFils) || p.priceFils <= 0) errs.push(`${where}: priceFils must be an integer > 0`);
    if (p.compareAtFils !== null && !(Number.isInteger(p.compareAtFils) && p.compareAtFils > p.priceFils)) errs.push(`${where}: compareAtFils must be null or an integer > priceFils`);
    if (!catIds.has(p.category)) errs.push(`${where}: unknown category "${p.category}"`);
    if (!['in_stock', 'out_of_stock', 'backorder'].includes(p.availability)) errs.push(`${where}: bad availability "${p.availability}"`);
    if (!Array.isArray(p.images)) errs.push(`${where}: images must be an array`);
    if (!p.description || !(p.description.ar === null || typeof p.description.ar === 'string')) errs.push(`${where}: description.ar must be a string or null`);
    if (p.description && !(p.description.en === null || p.description.en === undefined || typeof p.description.en === 'string')) errs.push(`${where}: description.en must be a string or null`);
    if (!Number.isFinite(p.sort)) errs.push(`${where}: sort must be a number`);
  }
  for (const c of categories) {
    if (!catalog.some((p) => p.category === c.id)) errs.push(`category ${c.id}: empty`);
    if (!c.name || !c.name.ar || !c.name.en) errs.push(`category ${c.id}: name.ar/en required`);
  }
  return errs;
}
