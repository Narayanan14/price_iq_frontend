// Portfolio analytics: historical aggregates (from the canonical weekly records) and
// illustrative opportunity metrics (from the shared optimizer). The two are kept separate:
// historical numbers never mix with forecast numbers.
// Future API: GET /api/portfolio/history, GET /api/portfolio/opportunities

import { getProducts, getDataset } from './product-service.js';
import { optimizePrice } from './optimization-service.js';
import { sensitivityLabel } from './demand-service.js';
import { OPPORTUNITY_RULES } from '../data/seed-data.js';
import { round2, pctChange, fmtNum } from '../utils.js';

const ALL = 'All';
const inCategory = (category) => (p) => !category || category === ALL || p.category === category;

/** Weekly revenue/profit/units for the last N historical weeks. */
export function getWeeklyTrend(windowWeeks = 52, category = ALL) {
  const { meta } = getDataset();
  const products = getProducts().filter(inCategory(category));
  const start = meta.historyWeeks - windowWeeks;
  const rows = [];
  for (let w = Math.max(0, start); w < meta.historyWeeks; w++) {
    let revenue = 0;
    let grossProfit = 0;
    let units = 0;
    for (const p of products) {
      const wk = p.history[w];
      revenue += wk.revenue;
      grossProfit += wk.grossProfit;
      units += wk.totalUnits;
    }
    rows.push({ week: w, weekStart: meta.weekDates[w], revenue: round2(revenue), grossProfit: round2(grossProfit), units });
  }
  return rows;
}

/** Monthly roll-up of the same weekly records (weeks assigned by their start date). */
export function getMonthlyTrend(windowWeeks = 52, category = ALL) {
  const weeks = getWeeklyTrend(windowWeeks, category);
  const map = new Map();
  for (const w of weeks) {
    const key = w.weekStart.slice(0, 7);
    const row = map.get(key) ?? { month: key, revenue: 0, grossProfit: 0, units: 0, weeks: 0 };
    row.revenue += w.revenue;
    row.grossProfit += w.grossProfit;
    row.units += w.units;
    row.weeks += 1;
    map.set(key, row);
  }
  return [...map.values()].map((r) => ({ ...r, revenue: round2(r.revenue), grossProfit: round2(r.grossProfit) }));
}

export function getHistoricalSummary(windowWeeks = 52, category = ALL) {
  const weeks = getWeeklyTrend(windowWeeks, category);
  const revenue = weeks.reduce((s, w) => s + w.revenue, 0);
  const grossProfit = weeks.reduce((s, w) => s + w.grossProfit, 0);
  const units = weeks.reduce((s, w) => s + w.units, 0);
  let prior = null;
  if (windowWeeks * 2 <= 52) {
    const both = getWeeklyTrend(windowWeeks * 2, category).slice(0, windowWeeks);
    prior = { revenue: both.reduce((s, w) => s + w.revenue, 0), grossProfit: both.reduce((s, w) => s + w.grossProfit, 0) };
  }
  return {
    windowWeeks,
    revenue: round2(revenue),
    grossProfit: round2(grossProfit),
    units,
    marginPct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
    revenueChange: prior ? pctChange(revenue, prior.revenue) : null,
    profitChange: prior ? pctChange(grossProfit, prior.grossProfit) : null,
    productCount: getProducts().filter(inCategory(category)).length,
  };
}

const portfolioCache = new Map();

/** Optimizer result for every product at the default constraints (cached per period). */
export function getPortfolioRecommendations(periodWeeks) {
  if (portfolioCache.has(periodWeeks)) return portfolioCache.get(periodWeeks);
  const rows = getProducts().map((product) => {
    const opt = optimizePrice(product.productId, periodWeeks);
    return {
      product,
      productId: product.productId,
      sku: product.sku,
      productName: product.productName,
      category: product.category,
      currentPrice: opt.currentPrice,
      recommendedPrice: opt.recommendedPrice,
      priceChangePct: opt.priceChangePct,
      upliftPct: opt.expectedProfitUplift,
      upliftAbs: opt.expectedProfitUpliftAbs,
      currentProfit: opt.currentScenario.expectedProfit,
      recommendedProfit: opt.recommendedScenario.expectedProfit,
      status: opt.status,
      inventoryConstrained: opt.inventoryConstrained,
      sensitivity: sensitivityLabel(product.priceSensitivity),
      opt,
    };
  });
  portfolioCache.set(periodWeeks, rows);
  return rows;
}

export const isOpportunity = (r) => r.upliftPct >= OPPORTUNITY_RULES.moderate;

export function getOpportunityKPIs(periodWeeks, category = ALL) {
  const rows = getPortfolioRecommendations(periodWeeks).filter(inCategory(category));
  const opps = rows.filter(isOpportunity);
  const currentProfit = rows.reduce((s, r) => s + r.currentProfit, 0);
  const recommendedProfit = rows.reduce((s, r) => s + r.recommendedProfit, 0);
  const avgChange = rows.length ? rows.reduce((s, r) => s + r.priceChangePct, 0) / rows.length : 0;
  const avgChangeOpp = opps.length ? opps.reduce((s, r) => s + r.priceChangePct, 0) / opps.length : 0;
  return {
    productsAnalyzed: rows.length,
    opportunities: opps.length,
    highOpportunities: rows.filter((r) => r.status === 'High Opportunity').length,
    opportunityShare: rows.length ? (opps.length / rows.length) * 100 : 0,
    currentForecastProfit: round2(currentProfit),
    recommendedForecastProfit: round2(recommendedProfit),
    potentialUpliftAbs: round2(recommendedProfit - currentProfit),
    potentialUpliftPct: pctChange(recommendedProfit, currentProfit) ?? 0,
    avgPriceChangePct: avgChange,
    avgPriceChangeOppPct: avgChangeOpp,
    increases: rows.filter((r) => r.priceChangePct > 0.05).length,
    decreases: rows.filter((r) => r.priceChangePct < -0.05).length,
    constrained: rows.filter((r) => r.inventoryConstrained).length,
  };
}

export function getCategoryOpportunities(periodWeeks) {
  const rows = getPortfolioRecommendations(periodWeeks);
  const map = new Map();
  for (const r of rows) {
    const c = map.get(r.category) ?? { category: r.category, products: 0, opportunities: 0, upliftAbs: 0, currentProfit: 0, sensitivitySum: 0 };
    c.products += 1;
    c.currentProfit += r.currentProfit;
    c.sensitivitySum += r.product.priceSensitivity;
    if (isOpportunity(r)) {
      c.opportunities += 1;
      c.upliftAbs += r.upliftAbs;
    }
    map.set(r.category, c);
  }
  return [...map.values()]
    .map((c) => ({ ...c, upliftAbs: round2(c.upliftAbs), avgSensitivity: c.sensitivitySum / c.products, upliftPct: c.currentProfit > 0 ? (c.upliftAbs / c.currentProfit) * 100 : 0 }))
    .sort((a, b) => b.upliftAbs - a.upliftAbs);
}

export function getTopOpportunities(n = 5, periodWeeks = 4, category = ALL) {
  return getPortfolioRecommendations(periodWeeks)
    .filter(inCategory(category))
    .filter(isOpportunity)
    .sort((a, b) => b.upliftAbs - a.upliftAbs)
    .slice(0, n);
}

/** Computed insight cards for the overview. */
export function getInsights(periodWeeks, category = ALL) {
  const rows = getPortfolioRecommendations(periodWeeks).filter(inCategory(category));
  const out = [];
  if (!rows.length) return out;
  const top = [...rows].sort((a, b) => b.upliftAbs - a.upliftAbs)[0];
  if (top && top.upliftAbs > 0) {
    out.push({ icon: 'trophy', tone: 'primary', title: 'Highest profit opportunity', text: `${top.productName}: ${fmtPrice(top.currentPrice)} → ${fmtPrice(top.recommendedPrice)} adds an estimated ${fmtPrice(top.upliftAbs)} gross profit (+${top.upliftPct.toFixed(1)}%) over ${periodWeeks} wk.`, productId: top.productId });
  }
  const constrained = rows.filter((r) => r.opt.currentScenario.inventoryConstraintApplied);
  if (constrained.length) {
    const worst = [...constrained].sort((a, b) => b.opt.currentScenario.lostDemand - a.opt.currentScenario.lostDemand)[0];
    out.push({ icon: 'package-x', tone: 'warn', title: `${constrained.length} product${constrained.length > 1 ? 's' : ''} inventory constrained`, text: `Predicted demand exceeds stock at current prices. Largest gap: ${worst.productName} (${fmtNum(worst.opt.currentScenario.lostDemand)} units unmet).`, productId: worst.productId });
  }
  const cats = getCategoryOpportunities(periodWeeks).filter((c) => category === ALL || c.category === category);
  const sensitive = [...cats].sort((a, b) => b.avgSensitivity - a.avgSensitivity)[0];
  if (sensitive) {
    out.push({ icon: 'activity', tone: 'neutral', title: 'Most price-sensitive category', text: `${sensitive.category} has the highest average simulated elasticity (${sensitive.avgSensitivity.toFixed(2)}); price increases there carry the most volume risk.` });
  }
  const near = rows.filter((r) => r.status === 'Near Optimal');
  out.push({ icon: 'circle-check', tone: 'pos', title: `${near.length} products near optimal`, text: `${((near.length / rows.length) * 100).toFixed(0)}% of analysed products are within ${OPPORTUNITY_RULES.moderate}% of their estimated maximum gross profit at today's price.` });
  const decreases = rows.filter((r) => isOpportunity(r) && r.priceChangePct < 0);
  if (decreases.length) {
    out.push({ icon: 'arrow-down-right', tone: 'neutral', title: `${decreases.length} opportunities from price cuts`, text: `Not every opportunity is an increase — for these products, extra volume outweighs the lower margin.` });
  }
  return out;
}

/** Pricing alerts for the notification panel (computed, not canned). */
export function getNotifications(periodWeeks) {
  const rows = getPortfolioRecommendations(periodWeeks);
  const list = [];
  getTopOpportunities(3, periodWeeks).forEach((r) => {
    list.push({ id: `opp-${r.productId}`, type: 'opportunity', icon: 'sparkles', title: 'Pricing opportunity', text: `${r.productName} could add +${r.upliftPct.toFixed(1)}% gross profit at ${fmtPrice(r.recommendedPrice)}.`, productId: r.productId, route: 'optimization' });
  });
  rows.filter((r) => r.opt.currentScenario.unitMarginPct < 30).sort((a, b) => a.opt.currentScenario.unitMarginPct - b.opt.currentScenario.unitMarginPct).slice(0, 2).forEach((r) => {
    list.push({ id: `margin-${r.productId}`, type: 'margin', icon: 'triangle-alert', title: 'Margin below 30% threshold', text: `${r.productName} runs at ${r.opt.currentScenario.unitMarginPct.toFixed(1)}% unit margin.`, productId: r.productId, route: 'optimization' });
  });
  rows.filter((r) => r.opt.currentScenario.inventoryConstraintApplied).slice(0, 2).forEach((r) => {
    list.push({ id: `inv-${r.productId}`, type: 'inventory', icon: 'package-x', title: 'Inventory constraint', text: `${r.productName}: predicted demand ${fmtNum(r.opt.currentScenario.totalPredictedDemand)} vs ${fmtNum(r.product.inventory)} in stock.`, productId: r.productId, route: 'forecast' });
  });
  const bigDrop = [...rows].filter((r) => isOpportunity(r)).sort((a, b) => a.opt.expectedDemandChange - b.opt.expectedDemandChange)[0];
  if (bigDrop) {
    list.push({ id: `demand-${bigDrop.productId}`, type: 'demand', icon: 'trending-down', title: 'Significant simulated demand change', text: `Recommended price for ${bigDrop.productName} shifts demand ${bigDrop.opt.expectedDemandChange.toFixed(1)}% — review before acting.`, productId: bigDrop.productId, route: 'simulator' });
  }
  return list;
}

function fmtPrice(v) {
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
