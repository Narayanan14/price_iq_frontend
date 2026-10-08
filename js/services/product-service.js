// Product catalog access. Owns the single canonical synthetic dataset instance.
// Future API: GET /api/products, GET /api/products/{id}

import { generateDataset } from '../data/data-generator.js';

const DATASET = generateDataset();
const BY_ID = new Map(DATASET.products.map((p) => [p.productId, p]));

export const DEFAULT_PRODUCT_ID = DATASET.products.find((p) => p.productName === 'Ceramic Coffee Mug')?.productId ?? DATASET.products[0].productId;

export function getDataset() {
  return DATASET;
}

export function getProducts() {
  return DATASET.products;
}

export function getProduct(productId) {
  return BY_ID.get(productId) ?? null;
}

export function getCategories() {
  return DATASET.categories;
}

export function getFeaturedProducts() {
  return DATASET.products.filter((p) => p.featured);
}

/** Rank products by how well they match a free-text query (name, SKU, category). */
export function searchProducts(query, limit = 8) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const p of DATASET.products) {
    const name = p.productName.toLowerCase();
    const sku = p.sku.toLowerCase();
    const cat = p.category.toLowerCase();
    const sub = p.subcategory.toLowerCase();
    const hay = `${name} ${sku} ${cat} ${sub} ${p.brand.toLowerCase()}`;
    if (!terms.every((t) => hay.includes(t))) continue;
    let score = 0;
    if (sku === q) score += 100;
    if (name === q) score += 90;
    if (name.startsWith(q)) score += 40;
    if (sku.startsWith(q)) score += 35;
    if (name.includes(q)) score += 20;
    if (cat.includes(q)) score += 6;
    if (p.featured) score += 3;
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.productName.localeCompare(b.p.productName));
  return scored.slice(0, limit).map((s) => s.p);
}

/**
 * Find the product best referenced in free text (used by the Copilot).
 * Requires the full product name, or a strong partial (≥2 distinctive words) match.
 */
export function findProductInText(text) {
  const t = String(text ?? '').toLowerCase();
  const skuMatch = t.match(/\b[a-z]{3}-\d{5}\b/);
  if (skuMatch) {
    const p = DATASET.products.find((x) => x.sku.toLowerCase() === skuMatch[0]);
    if (p) return p;
  }
  let best = null;
  let bestScore = 0;
  for (const p of DATASET.products) {
    const name = p.productName.toLowerCase();
    if (t.includes(name)) {
      const score = 100 + name.length;
      if (score > bestScore) [best, bestScore] = [p, score];
      continue;
    }
    const words = name.split(/\s+/).filter((w) => w.length > 2);
    const hits = words.filter((w) => new RegExp(`\\b${w.replace(/[^a-z0-9]/g, '')}s?\\b`).test(t)).length;
    if (hits >= 2 && hits >= words.length - 1) {
      const score = hits * 10 + (hits === words.length ? 20 : 0);
      if (score > bestScore) [best, bestScore] = [p, score];
    }
  }
  return best;
}
