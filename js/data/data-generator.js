// Deterministic synthetic dataset generator.
// Produces ONE canonical dataset (catalog + Product × Week × Segment history + customers).
// All historical aggregates elsewhere in the app are derived from these records.

import { createRng, round2, clamp } from '../utils.js';
import {
  DATA_SEED, HISTORY_START, HISTORY_WEEKS, FORECAST_START, AS_OF_DATE, SEGMENTS, BRANDS, SUPPLIERS,
  CATEGORIES, ITEM_SEASONAL_OVERRIDES, FEATURED_PRODUCTS, TARGET_PRODUCT_COUNT, CUSTOMER_COUNT,
} from './seed-data.js';

const CATEGORY_CODES = {
  'Home & Kitchen': 'HKT', 'Drinkware': 'DRK', 'Home Decor': 'DEC', 'Stationery': 'STN',
  'Gifts & Accessories': 'GFT', 'Storage & Organization': 'STO', 'Dining': 'DIN',
  'Seasonal Products': 'SEA', 'Personal Accessories': 'ACC',
};

const DAY_MS = 86400000;

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Week-of-year 1..52 used by the seasonal profiles. */
export function weekOfYear(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return clamp(Math.floor((d.getTime() - start) / DAY_MS / 7) + 1, 1, 52);
}

/** 52-length seasonal index (mean = 1) for a profile. */
export function seasonalCurve(profile) {
  const raw = [];
  for (let w = 1; w <= 52; w++) {
    const d = Math.min(Math.abs(w - profile.peak), 52 - Math.abs(w - profile.peak));
    if (profile.type === 'peak') raw.push(1 + profile.amp * 4 * Math.exp(-(d * d) / (2 * 16)));
    else raw.push(1 + profile.amp * Math.cos((2 * Math.PI * d) / 52));
  }
  const mean = raw.reduce((s, v) => s + v, 0) / raw.length;
  return raw.map((v) => v / mean);
}

/** Expected profit (relative units) of a segment mixture at price p. */
function mixtureProfit(p, baseShares, multipliers, e, price, cost) {
  const lr = Math.log(p / price);
  let demand = 0;
  for (let s = 0; s < baseShares.length; s++) demand += baseShares[s] * Math.exp(-e * multipliers[s] * lr);
  return (p - cost) * demand;
}

/**
 * Profit-maximising price for a segment mixture (continuous) within a local window.
 * Coarse grid, then a fine grid around the best coarse point — same resolution as a
 * 360-step scan at a fraction of the cost.
 */
function localOptimum(baseShares, multipliers, e, price, cost) {
  const lo = Math.max(cost * 1.001, price * 0.6);
  const hi = price * 1.6;
  const coarse = 72;
  const step = (hi - lo) / coarse;
  let best = lo;
  let bestProfit = -Infinity;
  for (let i = 0; i <= coarse; i++) {
    const p = lo + step * i;
    const v = mixtureProfit(p, baseShares, multipliers, e, price, cost);
    if (v > bestProfit) [best, bestProfit] = [p, v];
  }
  const from = Math.max(lo, best - step);
  const to = Math.min(hi, best + step);
  for (let i = 0; i <= 10; i++) {
    const p = from + ((to - from) * i) / 10;
    const v = mixtureProfit(p, baseShares, multipliers, e, price, cost);
    if (v > bestProfit) [best, bestProfit] = [p, v];
  }
  return best;
}

/** Calibrate base elasticity so the local optimum lands near targetRatio × price. */
function calibrateElasticity(shares, price, cost, targetRatio) {
  const mult = SEGMENTS.map((s) => s.elasticityMultiplier);
  let lo = 1.3;
  let hi = 5.5;
  const target = targetRatio * price;
  // Optimum price falls as elasticity rises → bisection (16 steps ≈ 0.0001 precision).
  if (localOptimum(shares, mult, lo, price, cost) <= target) return lo;
  if (localOptimum(shares, mult, hi, price, cost) >= target) return hi;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (localOptimum(shares, mult, mid, price, cost) > target) lo = mid;
    else hi = mid;
  }
  return round2((lo + hi) / 2);
}

function retailPrice(rng, lo, hi) {
  const raw = rng.range(lo, hi);
  const endings = [0.99, 0.5, 0.0, 0.49];
  const ending = rng.pick(endings);
  const p = Math.floor(raw) + ending;
  return round2(Math.max(lo * 0.9, p < 1 ? 1.5 : p));
}

function normalise(arr) {
  const t = arr.reduce((s, v) => s + v, 0);
  return arr.map((v) => v / t);
}

function buildCatalogSpecs(rng) {
  const specs = FEATURED_PRODUCTS.map((f) => ({ ...f, featured: true }));
  const used = new Set(specs.map((s) => s.productName));
  const combos = [];
  for (const cat of CATEGORIES) {
    for (const item of cat.items) {
      for (const style of cat.styles) combos.push({ cat, item, style });
    }
  }
  // Shuffle deterministically, then take round-robin by category for an even spread.
  for (let i = combos.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [combos[i], combos[j]] = [combos[j], combos[i]];
  }
  const byCat = new Map(CATEGORIES.map((c) => [c.name, []]));
  combos.forEach((c) => byCat.get(c.cat.name).push(c));
  const queues = [...byCat.values()];
  let qi = 0;
  while (specs.length < TARGET_PRODUCT_COUNT) {
    const q = queues[qi % queues.length];
    qi++;
    const c = q.pop();
    if (!c) continue;
    const name = `${c.style} ${c.item[0]}`;
    if (used.has(name)) continue;
    used.add(name);

    const [, subcategory, lo, hi] = c.item;
    const currentPrice = retailPrice(rng, lo, hi);
    // Margin mix: a few low-margin lines, a few premium margins.
    const marginBand = rng.weighted([0.15, 0.6, 0.25]);
    const costRatio = [rng.range(0.66, 0.74), rng.range(0.45, 0.65), rng.range(0.3, 0.45)][marginBand];
    const demandLevel = Math.exp(rng.normal(Math.log(70 * Math.pow(12 / currentPrice, 0.55)), 0.55));
    const seasonal = ITEM_SEASONAL_OVERRIDES[c.item[0]] ?? {
      ...c.cat.seasonal,
      amp: clamp(c.cat.seasonal.amp * rng.range(0.6, 1.3), 0, 1.2),
      peak: ((c.cat.seasonal.peak + rng.int(-2, 2) - 1 + 52) % 52) + 1,
    };
    // Where the profit-maximising price sits relative to today's price (calibration target only).
    const band = rng.weighted([0.36, 0.3, 0.26, 0.08]);
    const targetOptimumRatio = [rng.range(0.98, 1.03), rng.range(1.04, 1.2), rng.range(0.84, 0.96), rng.range(1.2, 1.3)][band];
    const constrained = rng.next() < 0.08;
    const weeksCover = constrained ? rng.range(3.4, 4.6) : rng.range(10, 30);

    specs.push({
      productName: name,
      category: c.cat.name,
      subcategory,
      currentPrice,
      unitCost: round2(currentPrice * costRatio),
      baseWeeklyUnits: clamp(Math.round(demandLevel), 6, 420),
      weeksCover,
      seasonal,
      targetOptimumRatio,
      trend: rng.range(-0.15, 0.25),
      brand: rng.pick(BRANDS),
      supplier: rng.pick(SUPPLIERS),
      featured: false,
    });
  }
  return specs;
}

function segmentSharesFor(spec, rng) {
  if (spec.segmentShares) return spec.segmentShares;
  const raw = SEGMENTS.map((s) => s.unitShare * (s.categoryAffinity[spec.category] ?? 1) * rng.range(0.8, 1.2));
  return normalise(raw);
}

function generateHistory(product, curve, rng, weekDates) {
  const mult = SEGMENTS.map((s) => s.elasticityMultiplier);
  // Historic list price: some products had a different shelf price earlier in the year,
  // and some had short promotions. Featured products keep a clean history.
  let prevPrice = product.currentPrice;
  let changeWeek = 0;
  const promoWeeks = new Set();
  if (!product.featured) {
    if (rng.next() < 0.3) {
      prevPrice = round2(product.currentPrice * rng.range(0.92, 1.05));
      changeWeek = rng.int(12, 44);
    }
    if (rng.next() < 0.4) {
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) promoWeeks.add(rng.int(2, 50));
    }
  }
  const weeks = [];
  for (let w = 0; w < HISTORY_WEEKS; w++) {
    const woy = weekOfYear(weekDates[w]);
    const season = curve[woy - 1];
    const trend = 1 + (product.trend * (w - (HISTORY_WEEKS - 1))) / HISTORY_WEEKS;
    let price = w < changeWeek ? prevPrice : product.currentPrice;
    if (promoWeeks.has(w)) price = round2(price * 0.85);
    const ratio = price / product.currentPrice;
    const units = product.segmentBaseWeekly.map((b, s) => {
      const noise = Math.max(0.55, rng.normal(1, 0.13));
      return Math.max(0, Math.round(b * season * trend * Math.pow(ratio, -product.priceSensitivity * mult[s]) * noise));
    });
    const total = units.reduce((a, b) => a + b, 0);
    weeks.push({ week: w, weekStart: weekDates[w], price, units, totalUnits: total, revenue: round2(price * total), grossProfit: round2((price - product.unitCost) * total), promo: promoWeeks.has(w) });
  }
  return weeks;
}

function generateCustomers(rng, segmentRevenue, segmentCategoryRevenue, categories) {
  const customers = [];
  let id = 10001;
  SEGMENTS.forEach((seg, si) => {
    const count = Math.round(CUSTOMER_COUNT * seg.customerShare);
    const weights = [];
    const rows = [];
    for (let i = 0; i < count; i++) {
      const [r0, r1] = seg.rfm.recency;
      const [f0, f1] = seg.rfm.frequency;
      const [m0, m1] = seg.rfm.monetaryWeight;
      // Skewed draws so distributions look organic rather than uniform.
      const recencyDays = Math.round(r0 + (r1 - r0) * Math.pow(rng.next(), 1.4));
      const frequency = Math.max(1, Math.round(f0 + (f1 - f0) * Math.pow(rng.next(), 1.3)));
      const w = (m0 + (m1 - m0) * Math.pow(rng.next(), 1.6)) * (0.6 + frequency / f1);
      weights.push(w);
      rows.push({ recencyDays, frequency });
    }
    const wTotal = weights.reduce((a, b) => a + b, 0);
    const catWeights = categories.map((c) => segmentCategoryRevenue[si][c] ?? 0);
    rows.forEach((r, i) => {
      // Monetary values are scaled so each segment's customers sum to that segment's historical revenue.
      const monetaryValue = round2((weights[i] / wTotal) * segmentRevenue[si]);
      const prefs = new Set();
      while (prefs.size < 3) prefs.add(categories[rng.weighted(catWeights)]);
      customers.push({
        customerId: `C${id++}`,
        segmentId: seg.id,
        recencyDays: r.recencyDays,
        frequency: r.frequency,
        totalOrders: r.frequency,
        monetaryValue,
        totalSpend: monetaryValue,
        averageOrderValue: round2(monetaryValue / r.frequency),
        preferredCategories: [...prefs],
      });
    });
  });
  return customers;
}

/** Build the full dataset. Pure and deterministic for a given seed. */
export function generateDataset(seed = DATA_SEED) {
  const rng = createRng(seed);
  const weekDates = Array.from({ length: HISTORY_WEEKS }, (_, i) => addDays(HISTORY_START, i * 7));
  const specs = buildCatalogSpecs(rng);
  const seqByCat = {};

  const products = specs.map((spec, idx) => {
    const shares = segmentSharesFor(spec, rng);
    const priceSensitivity = calibrateElasticity(shares, spec.currentPrice, spec.unitCost, spec.targetOptimumRatio);
    const code = CATEGORY_CODES[spec.category];
    seqByCat[code] = (seqByCat[code] ?? 100) + 7 + (idx % 5);
    const base = spec.baseWeeklyUnits;
    const curve = seasonalCurve(spec.seasonal);
    // Stock cover is set against seasonally adjusted demand at the start of the forecast window.
    const seasonNow = Math.max(1, curve[weekOfYear(FORECAST_START) - 1]);
    const inventory = spec.inventory ?? Math.max(20, Math.round(base * spec.weeksCover * seasonNow));
    const product = {
      productId: `P${String(idx + 1).padStart(4, '0')}`,
      sku: `${code}-${String(seqByCat[code]).padStart(5, '0')}`,
      productName: spec.productName,
      category: spec.category,
      subcategory: spec.subcategory,
      brand: spec.brand,
      supplier: spec.supplier,
      currentPrice: spec.currentPrice,
      unitCost: spec.unitCost,
      inventory,
      priceSensitivity,
      baseWeeklyUnits: base,
      segmentDemandDistribution: shares.map((v) => round2(v * 100) / 100),
      segmentBaseWeekly: shares.map((v) => base * v),
      seasonalProfile: spec.seasonal,
      trend: spec.trend,
      featured: !!spec.featured,
      demoRole: spec.demoRole ?? null,
      lastUpdated: addDays(AS_OF_DATE, -((idx * 7) % 19)),
    };
    product.seasonalCurve = curve;
    product.history = generateHistory(product, curve, rng, weekDates);
    product.historicalUnitsSold = product.history.reduce((s, w) => s + w.totalUnits, 0);
    product.historicalRevenue = round2(product.history.reduce((s, w) => s + w.revenue, 0));
    product.historicalGrossProfit = round2(product.history.reduce((s, w) => s + w.grossProfit, 0));
    product.averageWeeklyUnits = round2(product.historicalUnitsSold / HISTORY_WEEKS);
    const cover = inventory / Math.max(1, base);
    product.productStatus = cover < 4 ? 'Low Stock' : spec.seasonal.amp >= 0.75 && spec.seasonal.type === 'peak' ? 'Seasonal' : 'Active';
    return product;
  });

  // Segment and segment × category revenue from the same history records.
  const categories = CATEGORIES.map((c) => c.name);
  const segmentRevenue = SEGMENTS.map(() => 0);
  const segmentCategoryRevenue = SEGMENTS.map(() => ({}));
  for (const p of products) {
    for (const wk of p.history) {
      wk.units.forEach((u, s) => {
        const rev = u * wk.price;
        segmentRevenue[s] += rev;
        segmentCategoryRevenue[s][p.category] = (segmentCategoryRevenue[s][p.category] ?? 0) + rev;
      });
    }
  }
  const customers = generateCustomers(rng, segmentRevenue, segmentCategoryRevenue, categories);

  return {
    meta: {
      seed,
      historyStart: HISTORY_START,
      historyWeeks: HISTORY_WEEKS,
      forecastStart: FORECAST_START,
      asOf: AS_OF_DATE,
      weekDates,
      generatedRecords: products.length * HISTORY_WEEKS * SEGMENTS.length,
    },
    products,
    customers,
    categories,
  };
}
