// Guided Copilot engine: deterministic intent router + response builder.
// No LLM is connected. Every number comes from the same services the pages use.
// Future API: POST /api/copilot/chat { message, context } (LLM with tool calls to these services)

import { getProduct, findProductInText, getCategories } from './product-service.js';
import { optimizePrice, explainRecommendation } from './optimization-service.js';
import { simulatePrice } from './simulation-service.js';
import { getProductSegmentBreakdown } from './segmentation-service.js';
import { getTopOpportunities, getCategoryOpportunities, getOpportunityKPIs } from './analytics-service.js';
import { sensitivityLabel, PricingInputError } from './demand-service.js';
import { round2, fmtGBP, fmtNum, fmtPct, escapeHtml } from '../utils.js';

export const INTENTS = [
  'PRICE_RECOMMENDATION', 'RECOMMENDATION_EXPLANATION', 'PRICE_INCREASE_SIMULATION', 'PRICE_DECREASE_SIMULATION',
  'PRICE_COMPARISON', 'SEGMENT_ANALYSIS', 'TOP_OPPORTUNITIES', 'CATEGORY_ANALYSIS', 'PRODUCT_OVERVIEW', 'HELP',
];

export const SUGGESTED_QUESTIONS = [
  'What is the recommended price for this product?',
  'Why is this price recommended?',
  'What happens if I increase the price by 5%?',
  'Compare the current price with the recommended price.',
  'Which customer segment contributes most to demand?',
  'Which products have the highest profit opportunities?',
  'What happens if I reduce the price by 10%?',
  'Show the top pricing opportunities in Home & Kitchen.',
];

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, 'twenty five': 25, 'twenty-five': 25, thirty: 30, forty: 40, fifty: 50,
};

const CATEGORY_ALIASES = {
  'Home & Kitchen': ['home & kitchen', 'home and kitchen', 'kitchen'],
  'Drinkware': ['drinkware', 'drink ware', 'mugs', 'cups'],
  'Home Decor': ['home decor', 'home décor', 'decor', 'décor'],
  'Stationery': ['stationery', 'stationary'],
  'Gifts & Accessories': ['gifts & accessories', 'gifts and accessories', 'gifts', 'gift'],
  'Storage & Organization': ['storage & organization', 'storage and organization', 'storage', 'organisation', 'organization'],
  'Dining': ['dining', 'tableware'],
  'Seasonal Products': ['seasonal products', 'seasonal', 'christmas'],
  'Personal Accessories': ['personal accessories', 'accessories'],
};

/** Normalise free text: lowercase, number words → digits, "percent" → "%". */
export function normalise(text) {
  let t = ` ${String(text ?? '').toLowerCase().replace(/[’']/g, "'")} `;
  for (const [w, n] of Object.entries(NUMBER_WORDS).sort((a, b) => b[0].length - a[0].length)) {
    t = t.replace(new RegExp(`\\b${w}\\b`, 'g'), String(n));
  }
  t = t.replace(/\s*(per\s?cent|percent|pct|pc)\b/g, '%');
  return t.replace(/\s+/g, ' ').trim();
}

function findCategory(t) {
  // Prefer the longest alias so "personal accessories" beats "accessories".
  let best = null;
  let len = 0;
  for (const [cat, aliases] of Object.entries(CATEGORY_ALIASES)) {
    for (const a of aliases) {
      if (t.includes(a) && a.length > len) [best, len] = [cat, a.length];
    }
  }
  return getCategories().includes(best) ? best : null;
}

/** Parse a message into an intent with extracted entities. Pure and deterministic. */
export function parseMessage(text, context = {}) {
  const t = normalise(text);
  const pct = t.match(/(\d+(?:\.\d+)?)\s*%/);
  const price = t.match(/£\s*(\d+(?:\.\d{1,2})?)/) ?? t.match(/\b(\d+(?:\.\d{1,2})?)\s*(?:pounds|gbp|quid)\b/) ?? t.match(/\b(?:at|to|of|price)\s+(\d+\.\d{2})\b/);
  const up = /\b(increase|increasing|raise|raising|higher|hike|up|more|premium|lift|bump)\b/.test(t);
  const down = /\b(decrease|decreasing|reduce|reducing|lower|lowering|cut|cutting|drop|dropping|discount|less|cheaper|down|markdown)\b/.test(t);
  const product = findProductInText(text);
  const category = findCategory(t);
  const productId = product?.productId ?? context.productId ?? null;
  const entities = {
    productId,
    productMentioned: !!product,
    category,
    percent: pct ? Number(pct[1]) : null,
    price: price ? Number(price[1]) : null,
  };

  let intent = null;
  if (/\b(help|what can you do|what can i ask|capabilities|how does this work)\b/.test(t)) intent = 'HELP';
  else if (/\b(segment|segments|customer|customers|loyalist|loyalists|value seeker|value seekers|occasional|at-risk|at risk|who buys|shoppers)\b/.test(t)) intent = 'SEGMENT_ANALYSIS';
  else if (entities.price != null && !/\b(compare|versus|vs)\b/.test(t)) intent = 'PRICE_SIMULATION_EXPLICIT';
  else if (entities.percent != null && (up || down || /\b(what if|what happens|impact|simulate)\b/.test(t))) intent = down && !up ? 'PRICE_DECREASE_SIMULATION' : up && !down ? 'PRICE_INCREASE_SIMULATION' : /\b(reduce|lower|cut|decrease|discount)\b/.test(t) ? 'PRICE_DECREASE_SIMULATION' : 'PRICE_INCREASE_SIMULATION';
  else if (/\b(what if|what happens if|simulate)\b/.test(t) && (up || down)) intent = down && !up ? 'PRICE_DECREASE_SIMULATION' : 'PRICE_INCREASE_SIMULATION';
  else if (/\b(top|best|highest|biggest|largest|most|greatest)\b.*\b(opportunit|uplift|profit)/.test(t) || /\bwhich products\b/.test(t) || /\bopportunities\b/.test(t)) intent = category ? 'CATEGORY_ANALYSIS' : 'TOP_OPPORTUNITIES';
  else if (category && !entities.productMentioned && /\b(category|categories|how is|how are|performing|doing|overview|in)\b/.test(t)) intent = 'CATEGORY_ANALYSIS';
  else if (/\b(why|explain|reason|reasons|rationale|justify|justification|how did you|how was)\b/.test(t)) intent = 'RECOMMENDATION_EXPLANATION';
  else if (/\b(compare|comparison|versus|vs\.?|difference between)\b/.test(t)) intent = 'PRICE_COMPARISON';
  else if (/\b(recommend|recommended|recommendation|optimal|optimum|best price|ideal price|optimi[sz]e|what price|should (we|i) (charge|price|set)|right price)\b/.test(t)) intent = 'PRICE_RECOMMENDATION';
  else if (entities.productMentioned || /\b(tell me about|overview|summary|details|performance|how is|how's)\b/.test(t)) intent = 'PRODUCT_OVERVIEW';

  if (intent === 'PRICE_INCREASE_SIMULATION' || intent === 'PRICE_DECREASE_SIMULATION') {
    entities.percentAssumed = entities.percent == null;
    if (entities.percent == null) entities.percent = 5;
  }
  return { intent, entities, normalised: t };
}

const period = (w) => `${w} week${w > 1 ? 's' : ''}`;
const strong = (s) => `<strong>${s}</strong>`;
const name = (p) => strong(escapeHtml(p.productName));

function kpiBlock(title, a, b, rows) {
  return { type: 'compare', title, a, b, rows };
}

function needsProduct(productId) {
  if (productId && getProduct(productId)) return null;
  return {
    blocks: [{ type: 'text', html: 'Which product should I look at? Mention a product name or SKU (for example “Ceramic Coffee Mug”), or pick one with the product chip above.' }],
  };
}

function recommendation(productId, weeks) {
  const p = getProduct(productId);
  const opt = optimizePrice(productId, weeks);
  const cur = opt.currentScenario;
  const rec = opt.recommendedScenario;
  const same = opt.recommendedPrice === opt.currentPrice;
  const html = same
    ? `For ${name(p)}, the current price of ${strong(fmtGBP(opt.currentPrice))} is already the illustrative profit-maximising price over the next ${period(weeks)}. Expected demand is ${strong(fmtNum(cur.totalPredictedDemand))} units and expected gross profit ${strong(fmtGBP(cur.expectedProfit))}.`
    : `For ${name(p)}, the illustrative profit-maximising price is ${strong(fmtGBP(opt.recommendedPrice))}, compared with the current price of ${strong(fmtGBP(opt.currentPrice))} (${fmtPct(opt.priceChangePct, 1, true)}).<br><br>
       At the recommended price, expected demand is ${strong(fmtNum(rec.totalPredictedDemand))} units over the next ${period(weeks)}, compared with ${fmtNum(cur.totalPredictedDemand)} units at the current price (${fmtPct(opt.expectedDemandChange, 1, true)}).
       ${opt.expectedDemandChange < 0 ? 'Although demand decreases' : 'Although unit margin narrows'}, expected gross profit moves from ${fmtGBP(cur.expectedProfit)} to ${strong(fmtGBP(rec.expectedProfit))}, a ${strong(fmtPct(opt.expectedProfitUplift, 1, true))} change.`;
  return {
    blocks: [
      { type: 'text', html },
      kpiBlock(`Current vs recommended · next ${period(weeks)}`, 'Current', 'Recommended', [
        ['Selling price', fmtGBP(opt.currentPrice), fmtGBP(opt.recommendedPrice), opt.priceChangePct],
        ['Predicted demand', fmtNum(cur.totalPredictedDemand), fmtNum(rec.totalPredictedDemand), opt.expectedDemandChange],
        ['Expected revenue', fmtGBP(cur.expectedRevenue), fmtGBP(rec.expectedRevenue), opt.expectedRevenueChange],
        ['Expected gross profit', fmtGBP(cur.expectedProfit), fmtGBP(rec.expectedProfit), opt.expectedProfitUplift],
      ]),
      { type: 'badge', status: opt.status, note: opt.inventoryConstrained ? 'Inventory constrained' : null },
      { type: 'actions', actions: [
        { label: 'Open in Price Optimization', route: 'optimization', productId },
        ...(same ? [] : [{ label: 'Simulate this price', route: 'simulator', productId, scenario: [opt.currentPrice, opt.recommendedPrice] }]),
      ] },
    ],
    followUps: ['Why is this price recommended?', 'What happens if I increase the price by 5%?', 'Which customer segment contributes most to demand?'],
  };
}

function explanation(productId, weeks) {
  const p = getProduct(productId);
  const opt = optimizePrice(productId, weeks);
  const points = explainRecommendation(opt);
  return {
    blocks: [
      { type: 'text', html: `Here is why ${strong(fmtGBP(opt.recommendedPrice))} is recommended for ${name(p)} (current ${fmtGBP(opt.currentPrice)}, next ${period(weeks)}):` },
      { type: 'list', items: points.map(escapeHtml) },
      { type: 'text', html: `<span class="muted">Method: the optimizer evaluated ${opt.candidatePrices.length} candidate prices from ${fmtGBP(opt.optimizationConstraints.floor)} to ${fmtGBP(opt.optimizationConstraints.ceil)} in ${fmtGBP(opt.optimizationConstraints.step)} steps, calling the shared demand service for each, and selected the highest expected gross profit. Base price sensitivity: ${p.priceSensitivity.toFixed(2)} (${sensitivityLabel(p.priceSensitivity).toLowerCase()}). Illustrative assumptions only.</span>` },
      { type: 'actions', actions: [{ label: 'View price–profit curve', route: 'optimization', productId }] },
    ],
    followUps: ['Compare the current price with the recommended price.', 'What happens if I reduce the price by 10%?'],
  };
}

function simulation(productId, weeks, scenarioPrice, label) {
  const p = getProduct(productId);
  if (scenarioPrice <= 0) throw new PricingInputError('The scenario price must be positive.');
  const sim = simulatePrice({ productId, baselinePrice: p.currentPrice, scenarioPrice, periodWeeks: weeks });
  const d = sim.deltas;
  const verb = d.profit.abs >= 0 ? 'increase' : 'decrease';
  const blocks = [
    { type: 'text', html: `${label} ${name(p)} from ${fmtGBP(p.currentPrice)} to ${strong(fmtGBP(sim.scenarioPrice))} over the next ${period(weeks)}: predicted demand moves from ${fmtNum(d.demand.baseline)} to ${strong(fmtNum(d.demand.scenario))} units (${fmtPct(d.demand.pct, 1, true)}), revenue changes ${fmtPct(d.revenue.pct, 1, true)}, and gross profit would ${verb} from ${fmtGBP(d.profit.baseline)} to ${strong(fmtGBP(d.profit.scenario))} (${fmtPct(d.profit.pct, 1, true)}).` },
    kpiBlock(`Baseline vs scenario · next ${period(weeks)}`, 'Baseline', 'Scenario', [
      ['Selling price', fmtGBP(sim.baselinePrice), fmtGBP(sim.scenarioPrice), sim.priceChangePct],
      ['Predicted demand', fmtNum(d.demand.baseline), fmtNum(d.demand.scenario), d.demand.pct],
      ['Expected units sold', fmtNum(d.units.baseline), fmtNum(d.units.scenario), d.units.pct],
      ['Expected revenue', fmtGBP(d.revenue.baseline), fmtGBP(d.revenue.scenario), d.revenue.pct],
      ['Expected gross profit', fmtGBP(d.profit.baseline), fmtGBP(d.profit.scenario), d.profit.pct],
    ]),
    { type: 'table', columns: ['Segment', 'Baseline', 'Scenario', 'Change'], align: ['l', 'r', 'r', 'r'], rows: sim.segmentImpact.map((s) => [escapeHtml(s.segmentName), fmtNum(s.baseline), fmtNum(s.scenario), { delta: s.pct }]) },
    { type: 'list', items: sim.insights.map((i) => escapeHtml(i.text)) },
    { type: 'actions', actions: [{ label: 'Open in What-If Simulator', route: 'simulator', productId, scenario: [sim.baselinePrice, sim.scenarioPrice] }] },
  ];
  return { blocks, followUps: ['What is the recommended price for this product?', 'Which customer segment contributes most to demand?'] };
}

function comparison(productId, weeks) {
  const p = getProduct(productId);
  const opt = optimizePrice(productId, weeks);
  const cur = opt.currentScenario;
  const rec = opt.recommendedScenario;
  const unitMarginPct = rec.unitMargin && cur.unitMargin ? ((rec.unitMargin - cur.unitMargin) / Math.abs(cur.unitMargin)) * 100 : null;
  return {
    blocks: [
      { type: 'text', html: opt.recommendedPrice === opt.currentPrice
        ? `For ${name(p)} the current and recommended prices are the same (${fmtGBP(opt.currentPrice)}), so there is no change to compare. Nearby candidates are shown below.`
        : `Side-by-side for ${name(p)} over the next ${period(weeks)}. The recommended price changes gross profit by ${strong(fmtPct(opt.expectedProfitUplift, 1, true))} (${opt.expectedProfitUpliftAbs >= 0 ? '+' : '−'}${fmtGBP(Math.abs(opt.expectedProfitUpliftAbs))}).` },
      kpiBlock('Current vs recommended', 'Current', 'Recommended', [
        ['Selling price', fmtGBP(opt.currentPrice), fmtGBP(opt.recommendedPrice), opt.priceChangePct],
        ['Unit margin', fmtGBP(cur.unitMargin), fmtGBP(rec.unitMargin), unitMarginPct],
        ['Predicted demand', fmtNum(cur.totalPredictedDemand), fmtNum(rec.totalPredictedDemand), opt.expectedDemandChange],
        ['Expected units sold', fmtNum(cur.expectedUnitsSold), fmtNum(rec.expectedUnitsSold), opt.expectedUnitsChange],
        ['Expected revenue', fmtGBP(cur.expectedRevenue), fmtGBP(rec.expectedRevenue), opt.expectedRevenueChange],
        ['Expected gross profit', fmtGBP(cur.expectedProfit), fmtGBP(rec.expectedProfit), opt.expectedProfitUplift],
      ]),
      { type: 'actions', actions: [
        { label: 'Compare in simulator', route: 'simulator', productId, scenario: [opt.currentPrice, opt.recommendedPrice] },
        { label: 'See all candidates', route: 'optimization', productId },
      ] },
    ],
    followUps: ['Why is this price recommended?', 'What happens if I increase the price by 5%?'],
  };
}

function segments(productId, weeks) {
  const p = getProduct(productId);
  const b = getProductSegmentBreakdown(productId, weeks);
  const top = [...b.segments].sort((a, c) => c.forecastDemand - a.forecastDemand)[0];
  const sens = [...b.segments].sort((a, c) => c.elasticity - a.elasticity)[0];
  const units = b.forecast.segmentPredictions.map((s) => s.displayUnits);
  return {
    blocks: [
      { type: 'text', html: `For ${name(p)} at ${fmtGBP(b.price)}, ${strong(escapeHtml(top.segmentName))} contribute the most predicted demand over the next ${period(weeks)}: ${strong(fmtNum(top.forecastDemand))} of ${fmtNum(b.forecast.totalPredictedDemand)} units (${fmtPct(top.forecastShare, 1)}). Historically they accounted for ${fmtPct(top.historicalShare, 1)} of this product's units.<br><br>${strong(escapeHtml(sens.segmentName))} are the most price-responsive (illustrative elasticity ${sens.elasticity.toFixed(2)}): a 5% price increase changes their demand by ${fmtPct(sens.responseUp5, 1, true)}.` },
      { type: 'table', columns: ['Segment', 'Forecast units', 'Share', 'Elasticity', '+5% price'], align: ['l', 'r', 'r', 'r', 'r'], rows: b.segments.map((s, i) => [escapeHtml(s.segmentName), fmtNum(units[i]), fmtPct(s.forecastShare, 1), s.elasticity.toFixed(2), { delta: s.responseUp5 }]) },
      { type: 'text', html: '<span class="muted">Segments are illustrative RFM-style groups; segment elasticities are assumptions, not estimates from a trained model.</span>' },
      { type: 'actions', actions: [{ label: 'Open Customer Intelligence', route: 'customers', productId }, { label: 'Segment demand forecast', route: 'forecast', productId }] },
    ],
    followUps: ['What happens if I increase the price by 5%?', 'Why is this price recommended?'],
  };
}

function productList(rows) {
  return { type: 'products', rows: rows.map((r) => ({ productId: r.productId, name: r.productName, meta: `${r.sku} · ${r.category}`, from: fmtGBP(r.currentPrice), to: fmtGBP(r.recommendedPrice), uplift: r.upliftPct, upliftAbs: fmtGBP(r.upliftAbs), status: r.status })) };
}

function topOpportunities(weeks) {
  const rows = getTopOpportunities(5, weeks);
  const k = getOpportunityKPIs(weeks);
  return {
    blocks: [
      { type: 'text', html: `Across ${fmtNum(k.productsAnalyzed)} products, ${strong(fmtNum(k.opportunities))} show an illustrative profit uplift of 2% or more over the next ${period(weeks)}, worth ${strong(fmtGBP(k.potentialUpliftAbs))} in total (${fmtPct(k.potentialUpliftPct, 1, true)} portfolio gross profit). The five largest by £ uplift:` },
      productList(rows),
      { type: 'actions', actions: [{ label: 'Open opportunities table', route: 'overview' }] },
    ],
    followUps: [`Why is this price recommended?`, 'Show the top pricing opportunities in Home & Kitchen.'],
  };
}

function categoryAnalysis(category, weeks) {
  const cat = getCategoryOpportunities(weeks).find((c) => c.category === category);
  const rows = getTopOpportunities(5, weeks, category);
  if (!cat) return { blocks: [{ type: 'text', html: `I couldn't find the category “${escapeHtml(category)}”.` }] };
  return {
    blocks: [
      { type: 'text', html: `${strong(escapeHtml(category))}: ${fmtNum(cat.opportunities)} of ${fmtNum(cat.products)} products are pricing opportunities over the next ${period(weeks)}, adding an estimated ${strong(fmtGBP(cat.upliftAbs))} gross profit (${fmtPct(cat.upliftPct, 1, true)} of the category's forecast profit). Average simulated price sensitivity is ${cat.avgSensitivity.toFixed(2)}.${rows.length ? ' Top opportunities:' : ''}` },
      ...(rows.length ? [productList(rows)] : [{ type: 'text', html: 'No products in this category currently exceed the 2% uplift threshold — prices look close to optimal.' }]),
      { type: 'actions', actions: [{ label: `Filter overview to ${category}`, route: 'overview', category }] },
    ],
    followUps: ['Which products have the highest profit opportunities?'],
  };
}

function overview(productId, weeks) {
  const p = getProduct(productId);
  const opt = optimizePrice(productId, weeks);
  return {
    blocks: [
      { type: 'text', html: `${name(p)} (${escapeHtml(p.sku)}) · ${escapeHtml(p.category)} › ${escapeHtml(p.subcategory)}. Sells at ${fmtGBP(p.currentPrice)} with unit cost ${fmtGBP(p.unitCost)} (${fmtPct(((p.currentPrice - p.unitCost) / p.currentPrice) * 100, 1)} margin). Over the last 52 weeks it sold ${fmtNum(p.historicalUnitsSold)} units for ${fmtGBP(p.historicalRevenue)} revenue (synthetic history). ${fmtNum(p.inventory)} units are in stock; price sensitivity is ${sensitivityLabel(p.priceSensitivity).toLowerCase()} (${p.priceSensitivity.toFixed(2)}).<br><br>Recommended price for the next ${period(weeks)}: ${strong(fmtGBP(opt.recommendedPrice))} (${fmtPct(opt.expectedProfitUplift, 1, true)} expected gross profit).` },
      { type: 'badge', status: opt.status, note: opt.inventoryConstrained ? 'Inventory constrained' : null },
      { type: 'actions', actions: [{ label: 'Analyze', route: 'optimization', productId }, { label: 'Forecast demand', route: 'forecast', productId }] },
    ],
    followUps: ['Why is this price recommended?', 'Which customer segment contributes most to demand?'],
  };
}

function help() {
  return {
    blocks: [
      { type: 'text', html: 'I can answer questions using the PriceIQ pricing engine (illustrative, synthetic data):' },
      { type: 'list', items: [
        '<strong>Recommendations</strong> — “What is the recommended price for Ceramic Coffee Mug?”',
        '<strong>Explanations</strong> — “Why is this price recommended?”',
        '<strong>Scenarios</strong> — “What if I raise the price by 5%?”, “What happens at £12.50?”',
        '<strong>Comparisons</strong> — “Compare the current price with the recommended price.”',
        '<strong>Segments</strong> — “Which customer segment contributes most to demand?”',
        '<strong>Portfolio</strong> — “Top pricing opportunities in Dining.”',
      ] },
    ],
  };
}

export const UNSUPPORTED_MESSAGE = 'I can help with product pricing recommendations, demand scenarios, customer segments, and portfolio opportunities. Try asking about a specific product or price adjustment.';

/**
 * Answer a message. Returns { intent, productId, blocks, followUps }.
 * context: { productId, periodWeeks }
 */
export function respond(text, context) {
  const weeks = context.periodWeeks;
  const parsed = parseMessage(text, context);
  const { intent, entities } = parsed;
  const pid = entities.productId;
  try {
    let res;
    switch (intent) {
      case 'HELP': res = help(); break;
      case 'TOP_OPPORTUNITIES': res = topOpportunities(weeks); break;
      case 'CATEGORY_ANALYSIS': res = categoryAnalysis(entities.category, weeks); break;
      case 'PRICE_RECOMMENDATION': res = needsProduct(pid) ?? recommendation(pid, weeks); break;
      case 'RECOMMENDATION_EXPLANATION': res = needsProduct(pid) ?? explanation(pid, weeks); break;
      case 'PRICE_COMPARISON': res = needsProduct(pid) ?? comparison(pid, weeks); break;
      case 'SEGMENT_ANALYSIS': res = needsProduct(pid) ?? segments(pid, weeks); break;
      case 'PRODUCT_OVERVIEW': res = needsProduct(pid) ?? overview(pid, weeks); break;
      case 'PRICE_INCREASE_SIMULATION':
      case 'PRICE_DECREASE_SIMULATION': {
        res = needsProduct(pid);
        if (!res) {
          const p = getProduct(pid);
          const sign = intent === 'PRICE_INCREASE_SIMULATION' ? 1 : -1;
          const pct = Math.min(Math.abs(entities.percent), 60);
          const label = `${entities.percentAssumed ? '(Assuming 5%.) ' : ''}${sign > 0 ? 'Increasing' : 'Reducing'} the price by ${pct}% takes`;
          res = simulation(pid, weeks, round2(p.currentPrice * (1 + (sign * pct) / 100)), label);
        }
        break;
      }
      case 'PRICE_SIMULATION_EXPLICIT':
        res = needsProduct(pid) ?? simulation(pid, weeks, round2(entities.price), 'Setting the price of');
        break;
      default:
        res = { blocks: [{ type: 'text', html: escapeHtml(UNSUPPORTED_MESSAGE) }], followUps: SUGGESTED_QUESTIONS.slice(0, 3) };
    }
    return { intent: intent === 'PRICE_SIMULATION_EXPLICIT' ? (entities.price >= (getProduct(pid)?.currentPrice ?? 0) ? 'PRICE_INCREASE_SIMULATION' : 'PRICE_DECREASE_SIMULATION') : intent ?? 'UNSUPPORTED', productId: pid, ...res };
  } catch (err) {
    const msg = err instanceof PricingInputError ? err.message : 'I could not complete that calculation.';
    if (!(err instanceof PricingInputError)) console.error(err);
    return { intent: 'ERROR', productId: pid, blocks: [{ type: 'text', html: `${escapeHtml(msg)} Try a different price or product.` }] };
  }
}
