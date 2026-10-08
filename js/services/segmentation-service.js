// Customer segmentation analytics over the synthetic customer and history records.
// Segments are ILLUSTRATIVE RFM-style groups — a stand-in for the future K-Means model.
// Future API: GET /api/segments, GET /api/segments/products/{productId}

import { getDataset, getProducts } from './product-service.js';
import { predictDemand, requireProduct } from './demand-service.js';
import { SEGMENTS } from '../data/seed-data.js';
import { pctChange, round2 } from '../utils.js';

let summaryCache = null;

export function getSegmentDefinitions() {
  return SEGMENTS;
}

export function getSegmentById(id) {
  return SEGMENTS.find((s) => s.id === Number(id)) ?? null;
}

/** Per-segment customer statistics, and revenue from the same history records used elsewhere. */
export function getSegmentSummaries() {
  if (summaryCache) return summaryCache;
  const { customers } = getDataset();
  const products = getProducts();
  const revenue = SEGMENTS.map(() => 0);
  const units = SEGMENTS.map(() => 0);
  for (const p of products) {
    for (const wk of p.history) {
      wk.units.forEach((u, s) => {
        units[s] += u;
        revenue[s] += u * wk.price;
      });
    }
  }
  const totalRevenue = revenue.reduce((a, b) => a + b, 0);
  const totalCustomers = customers.length;
  summaryCache = SEGMENTS.map((seg, i) => {
    const cs = customers.filter((c) => c.segmentId === seg.id);
    const n = cs.length || 1;
    const sumF = cs.reduce((s, c) => s + c.frequency, 0);
    const sumM = cs.reduce((s, c) => s + c.monetaryValue, 0);
    const sumR = cs.reduce((s, c) => s + c.recencyDays, 0);
    return {
      ...seg,
      customerCount: cs.length,
      customerPct: (cs.length / totalCustomers) * 100,
      avgRecency: sumR / n,
      avgFrequency: sumF / n,
      avgMonetary: sumM / n,
      avgOrderValue: sumF > 0 ? sumM / sumF : 0,
      revenue: round2(revenue[i]),
      revenueShare: totalRevenue > 0 ? (revenue[i] / totalRevenue) * 100 : 0,
      units: units[i],
    };
  });
  return summaryCache;
}

/** RFM averages normalised to 0–100 across segments. Recency is inverted so higher = more recent. */
export function getNormalisedRFM() {
  const s = getSegmentSummaries();
  const norm = (vals, invert = false) => {
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    return vals.map((v) => {
      const x = max === min ? 1 : (v - min) / (max - min);
      return Math.round((invert ? 1 - x : x) * 80 + 20);
    });
  };
  return {
    recency: norm(s.map((x) => x.avgRecency), true),
    frequency: norm(s.map((x) => x.avgFrequency)),
    monetary: norm(s.map((x) => x.avgMonetary)),
    raw: s,
  };
}

/** Deterministic stratified customer sample for scatter plots. */
export function getCustomerSample(perSegment = 220) {
  const { customers } = getDataset();
  return SEGMENTS.flatMap((seg) => {
    const cs = customers.filter((c) => c.segmentId === seg.id);
    const step = Math.max(1, cs.length / perSegment);
    const out = [];
    for (let i = 0; i < cs.length && out.length < perSegment; i += step) out.push(cs[Math.floor(i)]);
    return out;
  });
}

/** Revenue and units by segment × category from history. segmentId null → all segments. */
export function getSegmentCategoryPreferences(segmentId = null) {
  const { categories } = getDataset();
  const products = getProducts();
  const idx = segmentId == null ? null : SEGMENTS.findIndex((s) => s.id === Number(segmentId));
  const rows = new Map(categories.map((c) => [c, { category: c, revenue: 0, units: 0, purchaseWeeks: 0 }]));
  for (const p of products) {
    const row = rows.get(p.category);
    for (const wk of p.history) {
      const u = idx == null ? wk.totalUnits : wk.units[idx];
      row.units += u;
      row.revenue += u * wk.price;
      if (u > 0) row.purchaseWeeks += 1;
    }
  }
  const list = [...rows.values()];
  const total = list.reduce((s, r) => s + r.revenue, 0);
  list.forEach((r) => {
    r.revenue = round2(r.revenue);
    r.share = total > 0 ? (r.revenue / total) * 100 : 0;
  });
  // Index vs all-customer mix: >100 means the segment over-indexes on this category.
  if (idx != null) {
    const all = getSegmentCategoryPreferences(null);
    list.forEach((r) => {
      const base = all.find((a) => a.category === r.category)?.share ?? 0;
      r.index = base > 0 ? Math.round((r.share / base) * 100) : 100;
    });
  }
  return list.sort((a, b) => b.revenue - a.revenue);
}

/**
 * Product-level segment analysis: historical contribution + forecast contribution
 * + illustrative response to a ±5% price change. Uses the shared demand service.
 */
export function getProductSegmentBreakdown(productId, periodWeeks, price = null) {
  const product = requireProduct(productId);
  const P = price ?? product.currentPrice;
  const histUnits = SEGMENTS.map(() => 0);
  const histRevenue = SEGMENTS.map(() => 0);
  for (const wk of product.history) {
    wk.units.forEach((u, s) => {
      histUnits[s] += u;
      histRevenue[s] += u * wk.price;
    });
  }
  const totalHist = histUnits.reduce((a, b) => a + b, 0);
  const at = predictDemand({ productId, price: P, periodWeeks });
  const up = predictDemand({ productId, price: round2(P * 1.05), periodWeeks });
  const down = predictDemand({ productId, price: round2(P * 0.95), periodWeeks });
  return {
    product,
    price: P,
    periodWeeks: at.forecastPeriod,
    forecast: at,
    segments: SEGMENTS.map((seg, i) => ({
      segmentId: seg.id,
      segmentName: seg.name,
      short: seg.short,
      color: seg.color,
      historicalUnits: histUnits[i],
      historicalRevenue: round2(histRevenue[i]),
      historicalShare: totalHist > 0 ? (histUnits[i] / totalHist) * 100 : 0,
      forecastDemand: at.segmentPredictions[i].predictedDemand,
      forecastShare: at.segmentPredictions[i].share * 100,
      elasticity: at.segmentPredictions[i].elasticity,
      responseUp5: pctChange(up.segmentPredictions[i].predictedDemand, at.segmentPredictions[i].predictedDemand),
      responseDown5: pctChange(down.segmentPredictions[i].predictedDemand, at.segmentPredictions[i].predictedDemand),
    })),
  };
}
