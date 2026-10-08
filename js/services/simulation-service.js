// What-if simulation: two calls to the shared demand service, compared side by side.
// Future API: POST /api/simulate { productId, baselinePrice, scenarioPrice, periodWeeks }

import { predictDemand, requireProduct, validatePrice } from './demand-service.js';
import { optimizePrice } from './optimization-service.js';
import { SEGMENTS } from '../data/seed-data.js';
import { round2, pctChange, fmtGBP, fmtNum } from '../utils.js';

function delta(a, b) {
  return { baseline: a, scenario: b, abs: round2(b - a), pct: pctChange(b, a) };
}

export function simulatePrice({ productId, baselinePrice, scenarioPrice, periodWeeks, respectInventory = true }) {
  const product = requireProduct(productId);
  const bp = validatePrice(baselinePrice);
  const sp = validatePrice(scenarioPrice);
  const baseline = predictDemand({ productId, price: bp, periodWeeks, respectInventory });
  const scenario = predictDemand({ productId, price: sp, periodWeeks, respectInventory });

  const segmentImpact = SEGMENTS.map((seg, i) => {
    const a = baseline.segmentPredictions[i].predictedDemand;
    const b = scenario.segmentPredictions[i].predictedDemand;
    return { segmentId: seg.id, segmentName: seg.name, short: seg.short, color: seg.color, baseline: a, scenario: b, abs: b - a, pct: pctChange(b, a) };
  });

  const result = {
    productId,
    product,
    periodWeeks: baseline.forecastPeriod,
    baselinePrice: bp,
    scenarioPrice: sp,
    priceChangePct: pctChange(sp, bp),
    baseline,
    scenario,
    deltas: {
      demand: delta(baseline.totalPredictedDemand, scenario.totalPredictedDemand),
      units: delta(baseline.expectedUnitsSold, scenario.expectedUnitsSold),
      revenue: delta(baseline.expectedRevenue, scenario.expectedRevenue),
      profit: delta(baseline.expectedProfit, scenario.expectedProfit),
      unitMargin: delta(baseline.unitMargin, scenario.unitMargin),
    },
    segmentImpact,
    belowCost: sp <= product.unitCost,
  };
  result.insights = scenarioInsights(result, periodWeeks, respectInventory);
  return result;
}

/** Simulate a ±% change from the current shelf price. */
export function simulatePercentChange(productId, pct, periodWeeks) {
  const product = requireProduct(productId);
  return simulatePrice({ productId, baselinePrice: product.currentPrice, scenarioPrice: round2(product.currentPrice * (1 + pct / 100)), periodWeeks });
}

function scenarioInsights(r, periodWeeks, respectInventory) {
  const out = [];
  const d = r.deltas;
  const p = (v) => (v == null ? 'n/a' : `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}%`);
  const priceUp = r.scenarioPrice > r.baselinePrice;
  const priceDown = r.scenarioPrice < r.baselinePrice;

  if (r.belowCost) {
    out.push({ tone: 'neg', icon: 'triangle-alert', text: `The scenario price (${fmtGBP(r.scenarioPrice)}) is at or below unit cost (${fmtGBP(r.product.unitCost)}), so every unit sold loses money.` });
  }
  if (!priceUp && !priceDown) {
    out.push({ tone: 'neutral', icon: 'equal', text: 'Scenario and baseline prices are identical — adjust the scenario price to see the impact.' });
    return out;
  }
  if (priceUp && d.profit.abs > 0) out.push({ tone: 'pos', icon: 'trending-up', text: `Unit margin rose ${p(d.unitMargin.pct)} while demand moved ${p(d.demand.pct)}; the margin gain outweighs lost volume, lifting gross profit by ${fmtGBP(Math.abs(d.profit.abs))} (${p(d.profit.pct)}).` });
  if (priceUp && d.profit.abs <= 0) out.push({ tone: 'neg', icon: 'trending-down', text: `The higher price increased unit margin (${p(d.unitMargin.pct)}) but demand declined ${p(d.demand.pct)}, so gross profit fell ${p(d.profit.pct)}. A price increase does not automatically improve profit.` });
  if (priceDown && d.profit.abs > 0) out.push({ tone: 'pos', icon: 'trending-up', text: `The lower price increased demand by ${p(d.demand.pct)}, enough to offset the thinner margin — gross profit improves ${p(d.profit.pct)}.` });
  if (priceDown && d.profit.abs <= 0) out.push({ tone: 'neg', icon: 'trending-down', text: `The lower price increased demand ${p(d.demand.pct)} but reduced unit margin ${p(d.unitMargin.pct)}, so gross profit declined ${p(d.profit.pct)}.` });

  if (d.revenue.pct != null && Math.sign(d.revenue.abs) !== Math.sign(d.profit.abs) && Math.abs(d.revenue.abs) > 0.5) {
    out.push({ tone: 'neutral', icon: 'git-compare', text: `Revenue and profit move in opposite directions here (revenue ${p(d.revenue.pct)}, profit ${p(d.profit.pct)}) — optimising for revenue alone would give a different answer.` });
  }
  if (respectInventory && r.scenario.inventoryConstraintApplied) {
    out.push({ tone: 'warn', icon: 'package-x', text: `Inventory constraint: scenario demand of ${fmtNum(r.scenario.totalPredictedDemand)} units exceeds the ${fmtNum(r.scenario.inventoryAvailable)} units in stock, limiting additional sales.` });
  } else if (respectInventory && r.baseline.inventoryConstraintApplied) {
    out.push({ tone: 'warn', icon: 'package', text: `At the baseline price demand exceeds available stock (${fmtNum(r.baseline.inventoryAvailable)} units); the scenario price brings demand within inventory.` });
  }
  const top = [...r.segmentImpact].sort((a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0))[0];
  if (top && top.pct != null && Math.abs(top.pct) >= 0.5) {
    out.push({ tone: 'neutral', icon: 'users', text: `${top.segmentName} respond most strongly (${p(top.pct)} demand), reflecting their higher illustrative price sensitivity.` });
  }
  try {
    const opt = optimizePrice(r.productId, periodWeeks, { respectInventory });
    if (Math.abs(r.scenarioPrice - opt.recommendedPrice) < 0.005) {
      out.push({ tone: 'pos', icon: 'target', text: `This is the optimizer's recommended price — it generates the highest expected gross profit (${fmtGBP(opt.recommendedScenario.expectedProfit)}) within the default range.` });
    } else if (r.scenario.expectedProfit < opt.recommendedScenario.expectedProfit) {
      const gap = opt.recommendedScenario.expectedProfit - r.scenario.expectedProfit;
      out.push({ tone: 'neutral', icon: 'target', text: `The recommended price of ${fmtGBP(opt.recommendedPrice)} would generate ${fmtGBP(gap)} more gross profit than this scenario.` });
    }
  } catch {
    /* optimizer insight is optional */
  }
  return out;
}
