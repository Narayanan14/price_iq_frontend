// Page 3 — Price Optimization: grid search over candidate prices via the shared demand service.

import { getState, setState, subscribe, selectProduct, setPriceScenario } from '../state.js';
import { navigate } from '../router.js';
import { getProduct } from '../services/product-service.js';
import { optimizePrice, explainRecommendation, getPricingAlternatives, DEFAULT_CONSTRAINTS, normaliseConstraints } from '../services/optimization-service.js';
import { PricingInputError } from '../services/demand-service.js';
import { pageHeader, cardHeader, periodSelect, horizonText, errorBox } from '../components/ui.js';
import { statusBadge, deltaChip } from '../components/kpi-card.js';
import { createProductPicker } from '../components/product-picker.js';
import { DataTable } from '../components/data-table.js';
import { plot, baseLayout, COLORS } from '../components/chart-utils.js';
import { openModal, toast } from '../components/modal.js';
import { escapeHtml, icon, fmtGBP, fmtNum, fmtPct, downloadCSV, refreshIcons, slug } from '../utils.js';

let el;
let picker;
let table;
let unsub = [];
let constraints = { ...DEFAULT_CONSTRAINTS };
let lastOpt = null;

export default {
  mount(container) {
    el = container;
    const s = getState();
    el.innerHTML = `
      ${pageHeader('Price Optimization', 'Identify profit-maximizing prices using simulated demand-response analysis.', `
        <button class="btn btn-secondary" id="op-export">${icon('download')}Export Analysis</button>`)}
      <section class="card control-bar">
        <div id="op-picker" class="grow"></div>
        ${periodSelect('op-period', s.forecastPeriod)}
        <button class="btn btn-secondary" id="op-toggle-constraints" aria-expanded="false" aria-controls="op-constraints">${icon('sliders-horizontal')}Pricing constraints<span class="count-dot" id="op-cons-count" hidden></span></button>
      </section>
      <section class="card constraints-panel" id="op-constraints" hidden>
        <form id="op-cons-form" class="constraints-grid" novalidate>
          <label class="field"><span class="field-label">Minimum price (£)</span><input class="input" type="number" step="0.01" min="0" name="minPrice" placeholder="No minimum"></label>
          <label class="field"><span class="field-label">Maximum price (£)</span><input class="input" type="number" step="0.01" min="0" name="maxPrice" placeholder="No maximum"></label>
          <label class="field"><span class="field-label">Max price increase (%)</span><input class="input" type="number" step="1" min="0" max="100" name="maxIncreasePct"></label>
          <label class="field"><span class="field-label">Max price decrease (%)</span><input class="input" type="number" step="1" min="0" max="50" name="maxDecreasePct"></label>
          <label class="toggle"><input type="checkbox" name="respectInventory"><span class="toggle-track"></span><span>Respect available inventory</span></label>
          <div class="cons-actions"><button type="button" class="btn btn-ghost" id="op-cons-reset">Reset defaults</button><button type="submit" class="btn btn-primary">Apply constraints</button></div>
          <div id="op-cons-error" class="span-all"></div>
        </form>
      </section>
      <div id="op-error"></div>
      <section class="hero-card" id="op-hero"></section>
      <div class="grid grid-12">
        <section class="card span-8">
          ${cardHeader('Price vs Expected Gross Profit', '<span id="op-curve-sub"></span>')}
          <div class="chart chart-md" id="op-curve"></div>
        </section>
        <section class="card span-4">
          ${cardHeader('Why this price?', 'Generated from the calculated values', '<span class="illustrative-tag">Illustrative</span>')}
          <div id="op-explain"></div>
        </section>
      </div>
      <div class="grid grid-12">
        <section class="card span-7" id="op-candidates-card">
          ${cardHeader('Candidate Price Comparison', '<span id="op-cand-sub"></span>')}
          <div id="op-table"></div>
        </section>
        <section class="card span-5">
          ${cardHeader('Segment Response', 'Predicted demand · current vs recommended price')}
          <div class="chart chart-sm" id="op-seg"></div>
          <div id="op-seg-list"></div>
        </section>
      </div>`;

    picker = createProductPicker(el.querySelector('#op-picker'), { value: s.selectedProductId, onChange: (pid) => selectProduct(pid) });
    fillConstraintForm();
    bind();
    unsub.push(subscribe(() => {
      picker.setValue(getState().selectedProductId);
      constraints = { ...DEFAULT_CONSTRAINTS };
      fillConstraintForm();
      render();
    }, ['selectedProductId']));
    unsub.push(subscribe(() => {
      el.querySelector('#op-period').value = String(getState().forecastPeriod);
      render();
    }, ['forecastPeriod']));
    render();
  },
  unmount() {
    unsub.forEach((u) => u());
    unsub = [];
    picker?.destroy();
    table = null;
    el = null;
  },
};

function product() {
  return getProduct(getState().selectedProductId);
}

function fillConstraintForm() {
  const f = el.querySelector('#op-cons-form');
  f.minPrice.value = constraints.minPrice ?? '';
  f.maxPrice.value = constraints.maxPrice ?? '';
  f.maxIncreasePct.value = constraints.maxIncreasePct;
  f.maxDecreasePct.value = constraints.maxDecreasePct;
  f.respectInventory.checked = constraints.respectInventory;
  el.querySelector('#op-cons-error').innerHTML = '';
  const changed = ['minPrice', 'maxPrice', 'maxIncreasePct', 'maxDecreasePct', 'respectInventory'].filter((k) => constraints[k] !== DEFAULT_CONSTRAINTS[k]).length;
  const dot = el.querySelector('#op-cons-count');
  dot.hidden = changed === 0;
  dot.textContent = changed;
}

function bind() {
  el.querySelector('#op-period').addEventListener('change', (e) => setState({ forecastPeriod: Number(e.target.value) }));
  const toggleBtn = el.querySelector('#op-toggle-constraints');
  toggleBtn.addEventListener('click', () => {
    const panel = el.querySelector('#op-constraints');
    panel.hidden = !panel.hidden;
    toggleBtn.setAttribute('aria-expanded', String(!panel.hidden));
  });
  el.querySelector('#op-cons-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const input = { minPrice: f.minPrice.value, maxPrice: f.maxPrice.value, maxIncreasePct: f.maxIncreasePct.value, maxDecreasePct: f.maxDecreasePct.value, respectInventory: f.respectInventory.checked };
    const { constraints: c, errors } = normaliseConstraints(product(), input);
    if (errors.length) {
      el.querySelector('#op-cons-error').innerHTML = errorBox(errors.join(' '));
      refreshIcons();
      return;
    }
    const prev = constraints;
    constraints = c;
    try {
      optimizePrice(product().productId, getState().forecastPeriod, constraints);
    } catch (err) {
      constraints = prev;
      el.querySelector('#op-cons-error').innerHTML = errorBox(err instanceof PricingInputError ? err.message : 'These constraints could not be applied.');
      refreshIcons();
      return;
    }
    fillConstraintForm();
    render();
    toast('Constraints applied — recommendation recalculated.');
  });
  el.querySelector('#op-cons-reset').addEventListener('click', () => {
    constraints = { ...DEFAULT_CONSTRAINTS };
    fillConstraintForm();
    render();
    toast('Constraints reset to defaults.', 'info');
  });
  el.querySelector('#op-export').addEventListener('click', exportAnalysis);
  el.querySelector('#op-hero').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || !lastOpt) return;
    const p = product();
    if (act === 'simulate') {
      setPriceScenario(p.productId, lastOpt.currentPrice, lastOpt.recommendedPrice);
      navigate('simulator', { product: p.productId });
    } else if (act === 'compare') compareAlternatives();
    else if (act === 'copilot') {
      selectProduct(p.productId);
      navigate('copilot', { product: p.productId });
    } else if (act === 'export') exportAnalysis();
  });
}

function render() {
  if (!el) return;
  const p = product();
  const weeks = getState().forecastPeriod;
  let opt;
  try {
    opt = optimizePrice(p.productId, weeks, constraints);
    el.querySelector('#op-error').innerHTML = '';
  } catch (err) {
    el.querySelector('#op-error').innerHTML = errorBox(err instanceof PricingInputError ? err.message : 'The optimizer could not evaluate this product.');
    refreshIcons();
    return;
  }
  lastOpt = opt;
  renderHero(p, opt, weeks);
  renderCurve(opt);
  renderExplain(opt);
  renderTable(opt);
  renderSegments(opt);
  refreshIcons();
}

function renderHero(p, opt, weeks) {
  const cur = opt.currentScenario;
  const rec = opt.recommendedScenario;
  const dir = opt.recommendedPrice > opt.currentPrice ? 'increase' : opt.recommendedPrice < opt.currentPrice ? 'decrease' : 'hold';
  el.querySelector('#op-hero').innerHTML = `
    <div class="hero-main">
      <div class="hero-product">
        <span class="hero-eyebrow">${icon('sparkles')}Simulated pricing recommendation · next ${weeks} week${weeks > 1 ? 's' : ''} (${horizonText(weeks)})</span>
        <h2>${escapeHtml(p.productName)}</h2>
        <p class="muted">${escapeHtml(p.sku)} · ${escapeHtml(p.category)} · unit cost ${fmtGBP(p.unitCost)} · ${fmtNum(p.inventory)} in stock</p>
        <div class="hero-badges">${statusBadge(opt.status)}${opt.inventoryConstrained ? statusBadge('Inventory Constrained') : ''}</div>
      </div>
      <div class="hero-prices">
        <div class="hp-block"><span class="hp-label">Current price</span><span class="hp-value muted-value">${fmtGBP(opt.currentPrice)}</span></div>
        <div class="hp-arrow ${dir}">${icon(dir === 'increase' ? 'arrow-up-right' : dir === 'decrease' ? 'arrow-down-right' : 'equal')}<span>${dir === 'hold' ? 'Hold' : fmtPct(opt.priceChangePct, 1, true)}</span></div>
        <div class="hp-block"><span class="hp-label">Recommended price</span><span class="hp-value accent">${fmtGBP(opt.recommendedPrice)}</span></div>
      </div>
    </div>
    <div class="hero-metrics">
      <div class="hm"><span class="hm-label">Expected profit uplift</span><span class="hm-value ${opt.expectedProfitUplift > 0.05 ? 'pos' : ''}">${fmtPct(opt.expectedProfitUplift, 1, true)}</span><span class="hm-sub">${fmtGBP(cur.expectedProfit)} → ${fmtGBP(rec.expectedProfit)}</span></div>
      <div class="hm"><span class="hm-label">Expected revenue change</span><span class="hm-value">${fmtPct(opt.expectedRevenueChange, 1, true)}</span><span class="hm-sub">${fmtGBP(cur.expectedRevenue)} → ${fmtGBP(rec.expectedRevenue)}</span></div>
      <div class="hm"><span class="hm-label">Expected demand change</span><span class="hm-value">${fmtPct(opt.expectedDemandChange, 1, true)}</span><span class="hm-sub">${fmtNum(cur.totalPredictedDemand)} → ${fmtNum(rec.totalPredictedDemand)} units</span></div>
      <div class="hm"><span class="hm-label">Unit margin</span><span class="hm-value">${fmtGBP(rec.unitMargin)}</span><span class="hm-sub">from ${fmtGBP(cur.unitMargin)} (${fmtPct(rec.unitMarginPct, 1)} of price)</span></div>
    </div>
    <div class="hero-actions">
      <button class="btn btn-primary" data-act="simulate" ${dir === 'hold' ? 'title="Simulator will open with current price as both baseline and scenario"' : ''}>${icon('sliders-horizontal')}Simulate This Price</button>
      <button class="btn btn-secondary" data-act="compare">${icon('git-compare')}Compare Alternatives</button>
      <button class="btn btn-secondary" data-act="copilot">${icon('sparkles')}Ask PriceIQ Copilot</button>
      <button class="btn btn-ghost" data-act="export">${icon('download')}Export Analysis</button>
    </div>`;
}

function renderCurve(opt) {
  const c = opt.candidatePrices;
  const eligible = c.filter((x) => x.eligible);
  const cur = c.find((x) => x.isCurrent);
  const rec = c.find((x) => x.isRecommended);
  el.querySelector('#op-curve-sub').textContent = `${c.length} candidate prices · ${fmtGBP(opt.optimizationConstraints.floor)}–${fmtGBP(opt.optimizationConstraints.ceil)} in ${fmtGBP(opt.optimizationConstraints.step)} steps · each evaluated by the shared demand service`;
  const custom = (arr) => arr.map((x) => [fmtNum(x.expectedUnitsSold), fmtGBP(x.revenue), fmtPct(x.profitUpliftPct, 1, true)]);
  const traces = [
    { type: 'scatter', mode: 'lines', name: 'Expected gross profit', x: eligible.map((x) => x.price), y: eligible.map((x) => x.grossProfit), customdata: custom(eligible), line: { color: COLORS.primary, width: 2.5 }, fill: 'tozeroy', fillcolor: 'rgba(79,70,229,0.06)', hovertemplate: '<b>£%{x:.2f}</b><br>Gross profit £%{y:,.2f} (%{customdata[2]})<br>Units sold %{customdata[0]} · Revenue %{customdata[1]}<extra></extra>' },
  ];
  const outside = c.filter((x) => !x.eligible);
  if (outside.length) traces.push({ type: 'scatter', mode: 'markers', name: 'Outside constraints', x: outside.map((x) => x.price), y: outside.map((x) => x.grossProfit), marker: { color: COLORS.baseline, size: 6, symbol: 'circle-open' }, hovertemplate: '£%{x:.2f} · outside constraints<extra></extra>' });
  traces.push({ type: 'scatter', mode: 'markers', name: 'Current price', x: [cur.price], y: [cur.grossProfit], marker: { size: 12, color: '#fff', line: { color: COLORS.baseline, width: 2.5 } }, hovertemplate: 'Current £%{x:.2f}<br>£%{y:,.2f}<extra></extra>' });
  traces.push({ type: 'scatter', mode: 'markers', name: 'Recommended price', x: [rec.price], y: [rec.grossProfit], marker: { size: 13, color: COLORS.primary, symbol: 'diamond', line: { color: '#fff', width: 2 } }, hovertemplate: 'Recommended £%{x:.2f}<br>£%{y:,.2f}<extra></extra>' });
  const ys = c.map((x) => x.grossProfit);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = (maxY - minY) * 0.15 || maxY * 0.1 || 1;
  plot(el.querySelector('#op-curve'), traces, baseLayout({
    shapes: [{ type: 'line', x0: rec.price, x1: rec.price, yref: 'paper', y0: 0, y1: 1, line: { color: COLORS.primary, width: 1, dash: 'dot' } }],
    annotations: [{ x: rec.price, y: rec.grossProfit, text: `Max £${rec.grossProfit.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`, showarrow: false, yshift: 18, font: { size: 11, color: COLORS.primaryDark } }],
    xaxis: { title: { text: 'Candidate selling price (£)', font: { size: 12 } }, tickprefix: '£' },
    yaxis: { title: { text: 'Expected gross profit (£)', font: { size: 12 } }, tickprefix: '£', range: [Math.max(0, minY - pad), maxY + pad] },
  }));
}

function renderExplain(opt) {
  const pts = explainRecommendation(opt);
  el.querySelector('#op-explain').innerHTML = `<ul class="explain-list">${pts.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
    <p class="muted small">Based on an illustrative demand-response model with segment-specific price sensitivities; not a trained model output.</p>`;
}

function renderTable(opt) {
  const rows = opt.candidatePrices.map((c) => ({ ...c, id: c.price.toFixed(2), statusText: c.isRecommended ? 'Recommended' : c.isCurrent ? 'Current' : !c.eligible ? 'Outside constraints' : c.inventoryConstraintApplied ? 'Inventory capped' : '' }));
  el.querySelector('#op-cand-sub').textContent = `Sorted by gross profit · uplift vs current price (${fmtGBP(opt.currentPrice)})`;
  if (!table) {
    table = new DataTable(el.querySelector('#op-table'), {
      columns: [
        { key: 'price', label: 'Candidate Price', align: 'right', render: (r) => `<strong>${fmtGBP(r.price)}</strong>`, csv: (r) => r.price.toFixed(2) },
        { key: 'predictedDemand', label: 'Predicted Demand', align: 'right', render: (r) => fmtNum(r.predictedDemand), csv: (r) => Math.round(r.predictedDemand) },
        { key: 'expectedUnitsSold', label: 'Units Sold', align: 'right', render: (r) => fmtNum(r.expectedUnitsSold), csv: (r) => Math.round(r.expectedUnitsSold) },
        { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => fmtGBP(r.revenue), csv: (r) => r.revenue.toFixed(2) },
        { key: 'grossProfit', label: 'Gross Profit', align: 'right', render: (r) => fmtGBP(r.grossProfit), csv: (r) => r.grossProfit.toFixed(2) },
        { key: 'profitUpliftPct', label: 'Profit Uplift %', align: 'right', render: (r) => deltaChip(r.profitUpliftPct), csv: (r) => (r.profitUpliftPct ?? 0).toFixed(1) },
        { key: 'statusText', label: 'Status', render: (r) => (r.isRecommended ? '<span class="badge badge-high">Recommended</span>' : r.isCurrent ? '<span class="badge badge-neutral">Current</span>' : r.statusText ? `<span class="muted small">${r.statusText}</span>` : '') },
      ],
      rows,
      toolbar: true,
      searchKeys: [(r) => r.price.toFixed(2), 'statusText'],
      searchPlaceholder: 'Find a price, e.g. 12.50',
      initialSort: { key: 'grossProfit', dir: 'desc' },
      pageSize: 10,
      rowClass: (r) => (r.isRecommended ? 'row-recommended' : r.isCurrent ? 'row-current' : !r.eligible ? 'row-muted' : ''),
    });
  } else table.setRows(rows);
}

function renderSegments(opt) {
  const s = opt.segmentBreakdown;
  const cur = opt.currentScenario.segmentPredictions;
  const rec = opt.recommendedScenario.segmentPredictions;
  plot(el.querySelector('#op-seg'), [
    { type: 'bar', name: `Current ${fmtGBP(opt.currentPrice)}`, x: s.map((x) => x.short), y: cur.map((x) => x.displayUnits), marker: { color: '#CBD5E1', cornerradius: 3 }, hovertemplate: '%{x}<br>Current: %{y:,} units<extra></extra>' },
    { type: 'bar', name: `Recommended ${fmtGBP(opt.recommendedPrice)}`, x: s.map((x) => x.short), y: rec.map((x) => x.displayUnits), marker: { color: COLORS.primary, cornerradius: 3 }, hovertemplate: '%{x}<br>Recommended: %{y:,} units<extra></extra>' },
  ], baseLayout({ barmode: 'group', bargap: 0.3, bargroupgap: 0.08, margin: { t: 30, b: 30 }, yaxis: { rangemode: 'tozero', title: { text: 'Units', font: { size: 12 } } } }));
  const sorted = [...s].sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));
  el.querySelector('#op-seg-list').innerHTML = `<ul class="seg-list">${sorted.map((x) => `
    <li><span class="seg-dot" style="background:${x.color}"></span><span class="seg-name">${escapeHtml(x.segmentName)}</span><span class="muted small">e=${x.elasticity.toFixed(2)}</span>${deltaChip(x.changePct)}</li>`).join('')}</ul>`;
}

function compareAlternatives() {
  const p = product();
  const weeks = getState().forecastPeriod;
  const opt = lastOpt;
  const rows = getPricingAlternatives(opt).map((x) => ({ label: x.label, note: x.note, price: x.price, r: x.result, upl: x.profitVsCurrentPct }));
  openModal({
    title: `Compare pricing alternatives · ${p.productName}`,
    size: 'modal-lg',
    body: `<p class="muted">Each alternative is evaluated by the same demand service over the next ${weeks} week${weeks > 1 ? 's' : ''}.</p>
      <div class="table-scroll"><table class="simple-table"><thead><tr><th>Strategy</th><th class="num">Price</th><th class="num">Demand</th><th class="num">Units sold</th><th class="num">Revenue</th><th class="num">Gross profit</th><th class="num">vs current</th><th></th></tr></thead>
      <tbody>${rows.map((x) => `<tr class="${x.price === opt.recommendedPrice ? 'row-recommended' : ''}"><td><strong>${escapeHtml(x.label)}</strong><br><span class="muted small">${escapeHtml(x.note)}</span></td><td class="num">${fmtGBP(x.price)}</td><td class="num">${fmtNum(x.r.totalPredictedDemand)}</td><td class="num">${fmtNum(x.r.expectedUnitsSold)}</td><td class="num">${fmtGBP(x.r.expectedRevenue)}</td><td class="num"><strong>${fmtGBP(x.r.expectedProfit)}</strong></td><td class="num">${deltaChip(x.upl)}</td><td><button class="btn btn-xs btn-ghost" data-sim="${x.price}">Simulate</button></td></tr>`).join('')}</tbody></table></div>`,
    actions: [{ label: 'Close' }],
  });
  refreshIcons();
  document.querySelectorAll('#modal-root [data-sim]').forEach((b) => b.addEventListener('click', () => {
    setPriceScenario(p.productId, opt.currentPrice, Number(b.dataset.sim));
    document.querySelector('#modal-root [data-close]')?.click();
    navigate('simulator', { product: p.productId });
  }));
}

function exportAnalysis() {
  if (!lastOpt) return;
  const p = product();
  const o = lastOpt;
  const head = [
    ['PriceIQ price optimization (illustrative, synthetic data)'],
    ['Product', p.productName], ['SKU', p.sku], ['Category', p.category],
    ['Forecast period (weeks)', o.forecastPeriod], ['Unit cost', p.unitCost.toFixed(2)], ['Inventory', p.inventory],
    ['Current price', o.currentPrice.toFixed(2)], ['Recommended price', o.recommendedPrice.toFixed(2)],
    ['Expected profit uplift %', o.expectedProfitUplift.toFixed(2)],
    ['Constraints', `min ${o.optimizationConstraints.minPrice ?? '-'}; max ${o.optimizationConstraints.maxPrice ?? '-'}; +${o.optimizationConstraints.maxIncreasePct}% / -${o.optimizationConstraints.maxDecreasePct}%; inventory ${o.optimizationConstraints.respectInventory ? 'respected' : 'ignored'}`],
    [],
    ['Candidate price', 'Predicted demand', 'Expected units sold', 'Revenue', 'Gross profit', 'Profit uplift %', 'Eligible', 'Current', 'Recommended', 'Inventory capped'],
  ];
  const rows = o.candidatePrices.map((c) => [c.price.toFixed(2), c.predictedDemand.toFixed(1), c.expectedUnitsSold.toFixed(1), c.revenue.toFixed(2), c.grossProfit.toFixed(2), (c.profitUpliftPct ?? 0).toFixed(2), c.eligible ? 'yes' : 'no', c.isCurrent ? 'yes' : '', c.isRecommended ? 'yes' : '', c.inventoryConstraintApplied ? 'yes' : '']);
  downloadCSV(`priceiq-optimization-${slug(p.sku)}-${o.forecastPeriod}wk.csv`, [...head, ...rows]);
  toast(`Exported ${rows.length} candidate prices.`);
}
