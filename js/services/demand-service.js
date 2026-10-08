// Shared demand prediction service — the single source of forecast numbers for every page.
//
// Illustrative demand-response model (stands in for the future XGBoost service):
//   Demand_s(P) = BaselineWeekly_s × Σ_weeks SeasonalIndex(week) × (P / P0)^(−e × m_s)
// where P0 is the current shelf price, e the product's base price sensitivity and m_s the
// segment's illustrative sensitivity multiplier. Total demand = Σ segment demand.
//
// Future API: POST /api/demand/predict { productId, price, periodWeeks }

import { getProduct } from './product-service.js';
import { SEGMENTS, FORECAST_START, FORECAST_PERIODS } from '../data/seed-data.js';
import { addDays, weekOfYear } from '../data/data-generator.js';
import { round2, isFiniteNumber, memoize } from '../utils.js';

export class PricingInputError extends Error {}

/** Round values to integers that sum exactly to target. */
export function largestRemainder(values, target) {
  const floors = values.map((v) => Math.floor(v));
  let remaining = target - floors.reduce((a, b) => a + b, 0);
  const order = values.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < order.length && remaining > 0; k++, remaining--) floors[order[k][1]] += 1;
  return floors;
}

export function validatePeriod(periodWeeks) {
  const n = Number(periodWeeks);
  if (!FORECAST_PERIODS.includes(n)) throw new PricingInputError(`Forecast period must be one of ${FORECAST_PERIODS.join(', ')} weeks.`);
  return n;
}

export function validatePrice(price) {
  const n = Number(price);
  if (!isFiniteNumber(n) || n <= 0) throw new PricingInputError('Price must be a positive number.');
  return round2(n);
}

export function requireProduct(productId) {
  const p = getProduct(productId);
  if (!p) throw new PricingInputError('Product not found in the synthetic catalog.');
  return p;
}

/** Forecast weeks for a horizon (Mondays). */
export function forecastWeeks(periodWeeks) {
  return Array.from({ length: periodWeeks }, (_, i) => addDays(FORECAST_START, i * 7));
}

const seasonCache = new Map();

/** Sum of seasonal indices across the forecast horizon (≈ number of weeks × seasonal lift). Cached per product × horizon. */
export function seasonalFactor(product, periodWeeks) {
  const key = `${product.productId}|${periodWeeks}`;
  let v = seasonCache.get(key);
  if (v === undefined) {
    v = forecastWeeks(periodWeeks).reduce((s, d) => s + product.seasonalCurve[weekOfYear(d) - 1], 0);
    seasonCache.set(key, v);
  }
  return v;
}

const elasticityCache = new Map();

/** Illustrative segment elasticities = base sensitivity × segment multiplier (cached per product). */
export function segmentElasticities(product) {
  let v = elasticityCache.get(product.productId);
  if (!v) {
    v = SEGMENTS.map((s) => round2(product.priceSensitivity * s.elasticityMultiplier));
    elasticityCache.set(product.productId, v);
  }
  return v;
}

/**
 * Core demand arithmetic shared by predictDemand() (full result) and evaluatePrice() (lean result),
 * so both always produce identical numbers.
 */
function demandCore(product, P, weeks, respectInventory) {
  // Guard the response curve against extreme extrapolation.
  const ratio = Math.min(3, Math.max(0.33, P / product.currentPrice));
  const seasonSum = seasonalFactor(product, weeks);
  const elasticities = segmentElasticities(product);
  const segmentUnits = elasticities.map((e, s) => Math.max(0, product.segmentBaseWeekly[s] * seasonSum * Math.pow(ratio, -e)));
  const totalPredictedDemand = segmentUnits.reduce((a, b) => a + b, 0);
  const inventoryConstraintApplied = respectInventory && totalPredictedDemand > product.inventory;
  const expectedUnitsSold = inventoryConstraintApplied ? product.inventory : totalPredictedDemand;
  const unitMargin = round2(P - product.unitCost);
  return {
    seasonSum, elasticities, segmentUnits, totalPredictedDemand, inventoryConstraintApplied, expectedUnitsSold, unitMargin,
    expectedRevenue: round2(P * expectedUnitsSold),
    expectedProfit: round2(unitMargin * expectedUnitsSold),
  };
}

/**
 * Lean evaluation of one price (no segment detail, no caching) — used by the optimizer's
 * candidate grid. Numbers are identical to predictDemand() for the same inputs.
 */
export function evaluatePrice({ productId, price, periodWeeks, respectInventory = true }) {
  const product = requireProduct(productId);
  const c = demandCore(product, validatePrice(price), validatePeriod(periodWeeks), !!respectInventory);
  return {
    totalPredictedDemand: c.totalPredictedDemand,
    expectedUnitsSold: c.expectedUnitsSold,
    expectedRevenue: c.expectedRevenue,
    expectedProfit: c.expectedProfit,
    inventoryConstraintApplied: c.inventoryConstraintApplied,
  };
}

function computeDemand(productId, price, periodWeeks, respectInventory) {
  const product = requireProduct(productId);
  const P = validatePrice(price);
  const weeks = validatePeriod(periodWeeks);
  const core = demandCore(product, P, weeks, respectInventory);
  const { seasonSum, totalPredictedDemand, inventoryConstraintApplied, expectedUnitsSold, unitMargin } = core;

  // Expected values are kept continuous so profit curves are smooth; integer display units
  // are allocated with the largest-remainder method so segments always sum to the shown total.
  const displayUnits = largestRemainder(core.segmentUnits, Math.round(totalPredictedDemand));
  const segmentPredictions = SEGMENTS.map((seg, s) => ({
    segmentId: seg.id, segmentName: seg.name, short: seg.short, color: seg.color,
    elasticity: core.elasticities[s],
    predictedDemand: core.segmentUnits[s],
    share: totalPredictedDemand > 0 ? core.segmentUnits[s] / totalPredictedDemand : 0,
    displayUnits: displayUnits[s],
  }));

  return Object.freeze({
    productId,
    proposedPrice: P,
    forecastPeriod: weeks,
    totalPredictedDemand,
    segmentPredictions,
    expectedUnitsSold,
    lostDemand: totalPredictedDemand - expectedUnitsSold,
    expectedRevenue: core.expectedRevenue,
    expectedProfit: core.expectedProfit,
    unitMargin,
    unitMarginPct: P > 0 ? (unitMargin / P) * 100 : 0,
    inventoryAvailable: product.inventory,
    inventoryConstraintApplied,
    respectInventory,
    assumptions: {
      referencePrice: product.currentPrice,
      unitCost: product.unitCost,
      baseElasticity: product.priceSensitivity,
      seasonalFactor: round2(seasonSum / weeks),
      forecastStart: FORECAST_START,
      forecastEnd: addDays(FORECAST_START, weeks * 7 - 1),
      model: 'Illustrative constant-elasticity response (mock of future XGBoost service)',
    },
  });
}

const cachedDemand = memoize(computeDemand, (id, p, w, inv) => `${id}|${round2(Number(p))}|${w}|${inv ? 1 : 0}`, 20000);

/**
 * Predict demand for a product at a selling price over a forecast horizon.
 * @returns frozen result object (shared/cached — do not mutate)
 */
export function predictDemand({ productId, price, periodWeeks, respectInventory = true }) {
  return cachedDemand(productId, Number(price), Number(periodWeeks), !!respectInventory);
}

/** Demand curve across a price range — always produced by calling predictDemand. */
export function demandCurve(productId, periodWeeks, { fromRatio = 0.7, toRatio = 1.4, points = 57, respectInventory = true } = {}) {
  const product = requireProduct(productId);
  const lo = product.currentPrice * fromRatio;
  const hi = product.currentPrice * toRatio;
  const out = [];
  for (let i = 0; i < points; i++) {
    const price = round2(lo + ((hi - lo) * i) / (points - 1));
    out.push(predictDemand({ productId, price, periodWeeks, respectInventory }));
  }
  return out;
}

export function sensitivityLabel(e) {
  if (e < 1.8) return 'Low';
  if (e < 3) return 'Moderate';
  return 'High';
}
