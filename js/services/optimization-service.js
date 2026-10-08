// Deterministic grid-search price optimizer built on the shared demand service.
// The recommended price is ALWAYS the best evaluated candidate — never generated independently.
//
// Future API: POST /api/optimize { productId, periodWeeks, constraints }

import { predictDemand, evaluatePrice, requireProduct, validatePeriod, PricingInputError } from './demand-service.js';
import { SEGMENTS, OPPORTUNITY_RULES } from '../data/seed-data.js';
import { round2, pctChange, isFiniteNumber, memoize, fmtGBP, fmtNum } from '../utils.js';

export const DEFAULT_CONSTRAINTS = Object.freeze({
  minPrice: null,
  maxPrice: null,
  maxIncreasePct: 30,
  maxDecreasePct: 20,
  respectInventory: true,
});

/** Price grid step by price band (keeps ~50–80 candidates per product). */
export function priceStep(price) {
  if (price < 5) return 0.05;
  if (price < 25) return 0.1;
  if (price < 60) return 0.25;
  return 0.5;
}

/** Validate user constraints. Returns { constraints, errors[] }. */
export function normaliseConstraints(product, input = {}) {
  const c = { ...DEFAULT_CONSTRAINTS, ...input };
  const errors = [];
  const num = (v) => (v === '' || v == null ? null : Number(v));
  c.minPrice = num(c.minPrice);
  c.maxPrice = num(c.maxPrice);
  c.maxIncreasePct = num(c.maxIncreasePct) ?? DEFAULT_CONSTRAINTS.maxIncreasePct;
  c.maxDecreasePct = num(c.maxDecreasePct) ?? DEFAULT_CONSTRAINTS.maxDecreasePct;
  c.respectInventory = c.respectInventory !== false;

  if (c.minPrice != null && (!isFiniteNumber(c.minPrice) || c.minPrice <= 0)) errors.push('Minimum price must be a positive number.');
  if (c.maxPrice != null && (!isFiniteNumber(c.maxPrice) || c.maxPrice <= 0)) errors.push('Maximum price must be a positive number.');
  if (c.minPrice != null && c.maxPrice != null && c.minPrice > c.maxPrice) errors.push('Minimum price cannot exceed maximum price.');
  if (!isFiniteNumber(c.maxIncreasePct) || c.maxIncreasePct < 0 || c.maxIncreasePct > 100) errors.push('Maximum increase must be between 0% and 100%.');
  if (!isFiniteNumber(c.maxDecreasePct) || c.maxDecreasePct < 0 || c.maxDecreasePct > 50) errors.push('Maximum decrease must be between 0% and 50%.');
  if (c.maxPrice != null && c.maxPrice <= product.unitCost) errors.push(`Maximum price must be above unit cost (£${product.unitCost.toFixed(2)}).`);
  return { constraints: c, errors };
}

export function opportunityStatus(upliftPct) {
  if (!isFiniteNumber(upliftPct)) return 'Near Optimal';
  if (upliftPct >= OPPORTUNITY_RULES.high) return 'High Opportunity';
  if (upliftPct >= OPPORTUNITY_RULES.moderate) return 'Moderate Opportunity';
  return 'Near Optimal';
}

function runOptimization(productId, periodWeeks, constraintsKey) {
  const product = requireProduct(productId);
  const weeks = validatePeriod(periodWeeks);
  const { constraints: c, errors } = normaliseConstraints(product, JSON.parse(constraintsKey));
  if (errors.length) throw new PricingInputError(errors[0]);

  const P0 = product.currentPrice;
  const step = priceStep(P0);
  const floor = Math.max(round2(P0 * (1 - c.maxDecreasePct / 100)), c.minPrice ?? 0, round2(product.unitCost + 0.01));
  const ceil = Math.min(round2(P0 * (1 + c.maxIncreasePct / 100)), c.maxPrice ?? Infinity);
  if (ceil < floor) throw new PricingInputError('No candidate prices satisfy these constraints. Widen the allowed range.');

  const kMin = Math.ceil((floor - P0) / step - 1e-9);
  const kMax = Math.floor((ceil - P0) / step + 1e-9);
  const prices = new Set();
  for (let k = kMin; k <= kMax; k++) prices.add(round2(P0 + k * step));
  prices.add(P0); // current price is always shown as the reference point
  const sorted = [...prices].sort((a, b) => a - b);

  const inv = c.respectInventory;
  const current = predictDemand({ productId, price: P0, periodWeeks: weeks, respectInventory: inv });

  const candidatePrices = sorted.map((price) => {
    const r = evaluatePrice({ productId, price, periodWeeks: weeks, respectInventory: inv });
    const eligible = price >= floor - 1e-9 && price <= ceil + 1e-9 && price > product.unitCost;
    return {
      price,
      predictedDemand: r.totalPredictedDemand,
      expectedUnitsSold: r.expectedUnitsSold,
      revenue: r.expectedRevenue,
      grossProfit: r.expectedProfit,
      profitUpliftPct: pctChange(r.expectedProfit, current.expectedProfit),
      inventoryConstraintApplied: r.inventoryConstraintApplied,
      eligible,
      isCurrent: price === P0,
      isRecommended: false,
    };
  });

  let best = null;
  for (const cand of candidatePrices) {
    if (!cand.eligible) continue;
    if (
      !best ||
      cand.grossProfit > best.grossProfit + 0.005 ||
      (Math.abs(cand.grossProfit - best.grossProfit) <= 0.005 && Math.abs(cand.price - P0) < Math.abs(best.price - P0))
    ) best = cand;
  }
  if (!best) throw new PricingInputError('No valid candidate price above unit cost within these constraints.');
  best.isRecommended = true;

  const rec = predictDemand({ productId, price: best.price, periodWeeks: weeks, respectInventory: inv });
  const segmentBreakdown = SEGMENTS.map((seg, i) => {
    const a = current.segmentPredictions[i].predictedDemand;
    const b = rec.segmentPredictions[i].predictedDemand;
    return { segmentId: seg.id, segmentName: seg.name, short: seg.short, color: seg.color, elasticity: rec.segmentPredictions[i].elasticity, currentDemand: a, recommendedDemand: b, changePct: pctChange(b, a) };
  });

  const eligiblePrices = candidatePrices.filter((x) => x.eligible).map((x) => x.price);
  const upliftPct = pctChange(rec.expectedProfit, current.expectedProfit) ?? 0;

  return Object.freeze({
    productId,
    productName: product.productName,
    forecastPeriod: weeks,
    currentPrice: P0,
    recommendedPrice: best.price,
    priceChangePct: pctChange(best.price, P0) ?? 0,
    currentScenario: current,
    recommendedScenario: rec,
    expectedProfitUplift: upliftPct,
    expectedProfitUpliftAbs: round2(rec.expectedProfit - current.expectedProfit),
    expectedRevenueChange: pctChange(rec.expectedRevenue, current.expectedRevenue) ?? 0,
    expectedDemandChange: pctChange(rec.totalPredictedDemand, current.totalPredictedDemand) ?? 0,
    expectedUnitsChange: pctChange(rec.expectedUnitsSold, current.expectedUnitsSold) ?? 0,
    candidatePrices,
    segmentBreakdown,
    status: opportunityStatus(upliftPct),
    inventoryConstrained: current.inventoryConstraintApplied || rec.inventoryConstraintApplied,
    atUpperBound: best.price === eligiblePrices[eligiblePrices.length - 1] && best.price !== P0,
    atLowerBound: best.price === eligiblePrices[0] && best.price !== P0,
    optimizationConstraints: { ...c, step, floor, ceil, candidateCount: candidatePrices.length },
  });
}

const cachedOptimize = memoize(runOptimization, (id, w, key) => `${id}|${w}|${key}`, 4000);

/** Find the profit-maximising price for a product over a forecast horizon. */
export function optimizePrice(productId, periodWeeks, constraints = {}) {
  const product = requireProduct(productId);
  const { constraints: c, errors } = normaliseConstraints(product, constraints);
  if (errors.length) throw new PricingInputError(errors[0]);
  const key = JSON.stringify({ minPrice: c.minPrice, maxPrice: c.maxPrice, maxIncreasePct: c.maxIncreasePct, maxDecreasePct: c.maxDecreasePct, respectInventory: c.respectInventory });
  return cachedOptimize(productId, Number(periodWeeks), key);
}

/** Plain-language explanation built from the actual optimization numbers. */
export function explainRecommendation(opt) {
  const cur = opt.currentScenario;
  const rec = opt.recommendedScenario;
  const pts = [];
  const priceDelta = opt.priceChangePct;
  const marginChange = pctChange(rec.unitMargin, cur.unitMargin);
  const fmt = (v) => fmtGBP(v);
  const pct = (v) => `${Math.abs(v).toFixed(1)}%`;

  if (Math.abs(priceDelta) < 0.01) {
    pts.push(`The current price of ${fmt(opt.currentPrice)} already delivers the highest expected gross profit among ${opt.candidatePrices.filter((c) => c.eligible).length} evaluated candidate prices.`);
    pts.push('Moving the price in either direction is estimated to reduce gross profit: higher prices lose too much demand, while lower prices give away too much unit margin.');
  } else if (priceDelta > 0) {
    pts.push(`Raising the price by ${pct(priceDelta)} (to ${fmt(opt.recommendedPrice)}) increases unit margin from ${fmt(cur.unitMargin)} to ${fmt(rec.unitMargin)}${marginChange != null ? ` (+${marginChange.toFixed(1)}%)` : ''}.`);
    if (cur.inventoryConstraintApplied) {
      pts.push(`At the current price, predicted demand (${fmtNum(cur.totalPredictedDemand)} units) exceeds available inventory (${fmtNum(cur.inventoryAvailable)} units), so a higher price captures more margin on the same limited stock.`);
    } else {
      pts.push(`Predicted demand falls by ${pct(opt.expectedDemandChange)} (${fmtNum(cur.totalPredictedDemand)} → ${fmtNum(rec.totalPredictedDemand)} units), but the margin gain outweighs the lost volume.`);
    }
  } else {
    pts.push(`Lowering the price by ${pct(priceDelta)} (to ${fmt(opt.recommendedPrice)}) is estimated to lift demand by ${pct(opt.expectedDemandChange)} (${fmtNum(cur.totalPredictedDemand)} → ${fmtNum(rec.totalPredictedDemand)} units).`);
    pts.push(`Unit margin narrows from ${fmt(cur.unitMargin)} to ${fmt(rec.unitMargin)}, but the extra volume more than compensates because this product is relatively price-sensitive (base elasticity ${opt.currentScenario.assumptions.baseElasticity.toFixed(2)}).`);
  }
  if (Math.abs(priceDelta) >= 0.01) {
    pts.push(`Expected gross profit over ${opt.forecastPeriod} week${opt.forecastPeriod > 1 ? 's' : ''} moves from ${fmt(cur.expectedProfit)} to ${fmt(rec.expectedProfit)} (${opt.expectedProfitUplift >= 0 ? '+' : '-'}${pct(opt.expectedProfitUplift)}).`);
  }
  const mostSensitive = [...opt.segmentBreakdown].sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0))[0];
  if (mostSensitive && Math.abs(mostSensitive.changePct ?? 0) >= 0.5) {
    pts.push(`${mostSensitive.segmentName} show the largest illustrative response (${(mostSensitive.changePct >= 0 ? '+' : '') + mostSensitive.changePct.toFixed(1)}% demand).`);
  }
  if (rec.inventoryConstraintApplied) pts.push('Inventory remains the binding limit at the recommended price — expected units sold are capped at available stock.');
  if (opt.atUpperBound) pts.push(`The recommendation sits at the upper limit of the allowed range (+${opt.optimizationConstraints.maxIncreasePct}%); profit may still rise beyond it, so validate with a controlled test before moving further.`);
  if (opt.atLowerBound) pts.push(`The recommendation sits at the lower limit of the allowed range (−${opt.optimizationConstraints.maxDecreasePct}%).`);
  return pts;
}

/**
 * Alternative pricing strategies derived from an optimization result. Each strategy is
 * re-evaluated with the shared demand service so it is directly comparable to the recommendation.
 * @param {object} opt result of optimizePrice()
 * @returns {Array<{key:string,label:string,note:string,price:number,result:object,profitVsCurrentPct:number|null}>}
 */
export function getPricingAlternatives(opt) {
  const c = opt.optimizationConstraints;
  const eligible = opt.candidatePrices.filter((x) => x.eligible);
  const revenueMax = eligible.reduce((a, b) => (b.revenue > a.revenue ? b : a));
  const volumeMax = eligible.reduce((a, b) => (b.expectedUnitsSold > a.expectedUnitsSold ? b : a));
  const midpoint = round2(Math.round((opt.currentPrice + opt.recommendedPrice) / 2 / c.step) * c.step);
  const hold = opt.recommendedPrice === opt.currentPrice;
  const strategies = [
    { key: 'current', label: hold ? 'Current price (already optimal)' : 'Current price', note: 'Status quo', price: opt.currentPrice },
    ...(hold ? [] : [{ key: 'recommended', label: 'Profit-maximising (recommended)', note: 'Highest expected gross profit', price: opt.recommendedPrice }]),
    { key: 'conservative', label: 'Conservative step', note: 'Half-way move toward the recommendation', price: midpoint },
    { key: 'revenue', label: 'Revenue-maximising', note: 'Highest expected revenue', price: revenueMax.price },
    { key: 'volume', label: 'Volume-maximising', note: 'Most units within constraints', price: volumeMax.price },
  ];
  const seen = new Set();
  return strategies
    .filter((s) => {
      const k = s.price.toFixed(2);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((s) => {
      const result = predictDemand({ productId: opt.productId, price: s.price, periodWeeks: opt.forecastPeriod, respectInventory: c.respectInventory });
      return { ...s, result, profitVsCurrentPct: pctChange(result.expectedProfit, opt.currentScenario.expectedProfit) };
    });
}
