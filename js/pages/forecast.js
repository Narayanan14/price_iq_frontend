// Page 2 — Demand Forecasting: expected demand at a proposed price over a horizon.

import { getState, setState, subscribe, selectProduct, setPriceScenario } from '../state.js';
import { navigate } from '../router.js';
import { getProduct, getDataset } from '../services/product-service.js';
import { predictDemand, demandCurve, sensitivityLabel } from '../services/demand-service.js';
import { pageHeader, cardHeader, periodSelect, horizonText, insightList, errorBox } from '../components/ui.js';
import { kpiCard } from '../components/kpi-card.js';
import { createProductPicker } from '../components/product-picker.js';
import { plot, baseLayout, COLORS } from '../components/chart-utils.js';
import { escapeHtml, icon, fmtGBP, fmtNum, fmtPct, fmtDate, pctChange, round2, throttleFrame, throttle, debounce, refreshIcons, isFiniteNumber } from '../utils.js';

let el;
let picker;
let unsub = [];
let price = null;

const writeScenario = debounce((pid, base, p) => setPriceScenario(pid, base, p), 300);
// While the slider is dragged, KPIs and the main curve update every frame; secondary panels are throttled.
const renderSecondaryThrottled = throttle((p, r, base, weeks) => {
  if (!el) return;
  renderSegments(r);
  renderInsights(p, r, base, weeks);
}, 140);
// Curve arrays are reused while only the price marker moves, so Plotly can skip recomputing the line.
let curveCache = { key: null };

export default {
  mount(container) {
    el = container;
    const s = getState();
    initPrice();
    el.innerHTML = `
      ${pageHeader('Demand Forecasting', 'Estimate product demand under alternative selling prices.', `
        <button class="btn btn-secondary" id="fc-to-opt">${icon('target')}Find optimal price</button>`)}
      <div class="layout-aside">
        <aside class="card input-panel">
          ${cardHeader('Forecast inputs')}
          <div id="fc-picker"></div>
          <div class="product-context" id="fc-context"></div>
          ${periodSelect('fc-period', s.forecastPeriod)}
          <label class="field">
            <span class="field-label">Proposed selling price (£)</span>
            <div class="input-prefix"><span>£</span><input type="number" class="input" id="fc-price" step="0.01" min="0.01" inputmode="decimal" aria-describedby="fc-price-msg"></div>
          </label>
          <div class="field">
            <div class="row-between"><span class="field-label">Price adjustment</span><span class="slider-value" id="fc-slider-val"></span></div>
            <input type="range" id="fc-slider" min="-30" max="40" step="1" aria-label="Price adjustment versus current price">
            <div class="slider-scale"><span>-30%</span><span>0%</span><span>+40%</span></div>
          </div>
          <div id="fc-price-msg" aria-live="polite"></div>
          <button class="btn btn-secondary btn-block" id="fc-reset">${icon('rotate-ccw')}Reset to current price</button>
          <p class="muted small">Demand is predicted by the shared illustrative demand service. Inventory is the stock on hand; no replenishment is assumed within the horizon.</p>
        </aside>
        <div class="stack">
          <div class="kpi-row five" id="fc-kpis"></div>
          <section class="card">
            ${cardHeader('Illustrative Demand Forecast', '<span id="fc-curve-sub"></span>', '<span class="illustrative-tag">Illustrative</span>')}
            <div class="chart chart-md" id="fc-curve"></div>
          </section>
          <div class="grid grid-2">
            <section class="card">
              ${cardHeader('Segment-Level Demand', '<span id="fc-seg-sub"></span>')}
              <div class="chart chart-sm" id="fc-seg"></div>
              <div id="fc-seg-note"></div>
            </section>
            <section class="card">
              ${cardHeader('Forecast Insights')}
              <div id="fc-insights"></div>
            </section>
          </div>
          <section class="card">
            ${cardHeader('Historical Weekly Unit Sales', `Synthetic history · ${fmtDate(getDataset().meta.historyStart)} – ${fmtDate(getDataset().meta.asOf)} · not a forecast`)}
            <div class="chart chart-sm" id="fc-hist"></div>
          </section>
        </div>
      </div>`;

    picker = createProductPicker(el.querySelector('#fc-picker'), { value: s.selectedProductId, onChange: (pid) => selectProduct(pid) });
    bind();
    unsub.push(subscribe(() => {
      picker.setValue(getState().selectedProductId);
      initPrice();
      renderAll();
    }, ['selectedProductId']));
    unsub.push(subscribe(() => {
      el.querySelector('#fc-period').value = String(getState().forecastPeriod);
      renderAll();
    }, ['forecastPeriod']));
    renderAll();
  },
  unmount() {
    unsub.forEach((u) => u());
    unsub = [];
    picker?.destroy();
    el = null;
  },
};

function product() {
  return getProduct(getState().selectedProductId);
}

function initPrice() {
  const p = product();
  const sc = getState().currentPriceScenario;
  price = sc && sc.productId === p.productId ? sc.scenarioPrice : p.currentPrice;
}

function bind() {
  const priceInput = el.querySelector('#fc-price');
  const slider = el.querySelector('#fc-slider');
  const live = throttleFrame(() => renderOutputs({ live: true }));
  el.querySelector('#fc-period').addEventListener('change', (e) => setState({ forecastPeriod: Number(e.target.value) }));
  slider.addEventListener('input', () => {
    price = round2(product().currentPrice * (1 + Number(slider.value) / 100));
    priceInput.value = price.toFixed(2);
    live();
    writeScenario(product().productId, product().currentPrice, price);
  });
  priceInput.addEventListener('input', () => {
    const v = Number(priceInput.value);
    price = priceInput.value === '' ? NaN : round2(v);
    live();
    if (isFiniteNumber(price) && price > 0) writeScenario(product().productId, product().currentPrice, price);
  });
  priceInput.addEventListener('blur', () => {
    if (isFiniteNumber(price) && price > 0) priceInput.value = price.toFixed(2);
  });
  el.querySelector('#fc-reset').addEventListener('click', () => {
    price = product().currentPrice;
    renderAll();
  });
  el.querySelector('#fc-to-opt').addEventListener('click', () => navigate('optimization', { product: product().productId }));
}

function renderAll() {
  if (!el) return;
  const p = product();
  el.querySelector('#fc-price').value = isFiniteNumber(price) ? price.toFixed(2) : '';
  renderContext(p);
  renderOutputs();
  renderHistory(p);
  refreshIcons();
}

function renderContext(p) {
  el.querySelector('#fc-context').innerHTML = `
    <dl class="ctx-grid">
      <div><dt>SKU</dt><dd class="mono">${escapeHtml(p.sku)}</dd></div>
      <div><dt>Category</dt><dd>${escapeHtml(p.category)}</dd></div>
      <div><dt>Current price</dt><dd>${fmtGBP(p.currentPrice)}</dd></div>
      <div><dt>Unit cost</dt><dd>${fmtGBP(p.unitCost)}</dd></div>
      <div><dt>Inventory</dt><dd>${fmtNum(p.inventory)} units</dd></div>
      <div><dt>Avg weekly units</dt><dd>${fmtNum(p.averageWeeklyUnits, 1)}</dd></div>
    </dl>`;
}

function validate(p) {
  if (!isFiniteNumber(price) || price <= 0) return { error: 'Enter a positive selling price.' };
  if (price > p.currentPrice * 3) return { error: `Price is outside the modelled range (max ${fmtGBP(p.currentPrice * 3)}).` };
  if (price <= p.unitCost) return { warning: `Below unit cost (${fmtGBP(p.unitCost)}) — each unit sold loses money.` };
  if (price < p.currentPrice * 0.5) return { warning: 'More than 50% below the current price — far outside observed prices; treat with caution.' };
  return {};
}

function renderOutputs({ live = false } = {}) {
  if (!el) return;
  const p = product();
  const weeks = getState().forecastPeriod;
  const v = validate(p);
  let r = null;
  let base = null;
  if (!v.error) {
    r = predictDemand({ productId: p.productId, price, periodWeeks: weeks });
    base = predictDemand({ productId: p.productId, price: p.currentPrice, periodWeeks: weeks });
    // Draw the chart before touching other DOM, so Plotly measures an already laid-out page
    // instead of forcing a synchronous reflow of freshly changed content.
    renderCurve(p, weeks, r, base);
  }
  const setHtml = (node, html) => { if (node.innerHTML !== html) node.innerHTML = html; };
  const setText = (node, txt) => { if (node.textContent !== txt) node.textContent = txt; };
  setHtml(el.querySelector('#fc-price-msg'), v.error ? errorBox(v.error) : v.warning ? `<div class="inline-warning">${icon('triangle-alert')}<span>${escapeHtml(v.warning)}</span></div>` : '');
  const slider = el.querySelector('#fc-slider');
  const pct = isFiniteNumber(price) ? pctChange(price, p.currentPrice) : 0;
  const sliderVal = String(Math.max(-30, Math.min(40, Math.round(pct ?? 0))));
  if (slider.value !== sliderVal) slider.value = sliderVal;
  setText(el.querySelector('#fc-slider-val'), isFiniteNumber(pct) ? `${fmtPct(pct, 1, true)} vs current` : '—');
  if (v.error) return;

  const same = price === p.currentPrice;
  const d = (a, b) => (same ? null : pctChange(a, b));

  el.querySelector('#fc-kpis').innerHTML = [
    kpiCard({ label: 'Predicted Demand', value: `${fmtNum(r.totalPredictedDemand)}`, icon: 'chart-line', delta: d(r.totalPredictedDemand, base.totalPredictedDemand), sub: `units · next ${weeks} wk (unconstrained)` }),
    kpiCard({ label: 'Expected Units Sold', value: fmtNum(r.expectedUnitsSold), icon: 'package-check', delta: d(r.expectedUnitsSold, base.expectedUnitsSold), sub: r.inventoryConstraintApplied ? `<span class="warn-text">${icon('package-x')}Capped by inventory (${fmtNum(r.lostDemand)} unmet)</span>` : `Within ${fmtNum(p.inventory)} in stock`, tone: r.inventoryConstraintApplied ? 'warn' : '' }),
    kpiCard({ label: 'Expected Revenue', value: fmtGBP(r.expectedRevenue), icon: 'pound-sterling', delta: d(r.expectedRevenue, base.expectedRevenue), sub: same ? 'At current price' : `vs ${fmtGBP(base.expectedRevenue)} at current` }),
    kpiCard({ label: 'Expected Gross Profit', value: fmtGBP(r.expectedProfit), icon: 'wallet', delta: d(r.expectedProfit, base.expectedProfit), sub: same ? 'At current price' : `vs ${fmtGBP(base.expectedProfit)} at current` }),
    kpiCard({ label: 'Estimated Unit Margin', value: fmtGBP(r.unitMargin), icon: 'percent', sub: `${fmtPct(r.unitMarginPct, 1)} of selling price`, tone: r.unitMargin <= 0 ? 'danger' : '' }),
  ].join('');

  setText(el.querySelector('#fc-curve-sub'), `Demand response curve · ${p.productName} · predicted demand over ${weeks} week${weeks > 1 ? 's' : ''} (${horizonText(weeks)}) at each candidate price`);
  if (live) renderSecondaryThrottled(p, r, base, weeks);
  else {
    renderSegments(r);
    renderInsights(p, r, base, weeks);
  }
  refreshIcons();
}

function renderCurve(p, weeks, r, base) {
  const key = `${p.productId}|${weeks}`;
  if (curveCache.key !== key) {
    // Static traces are built once per product × horizon and passed to Plotly as the same
    // objects on every update, so dragging the slider only re-renders the moving marker.
    const curve = demandCurve(p.productId, weeks);
    const xs = curve.map((c) => c.proposedPrice);
    const ys = curve.map((c) => c.totalPredictedDemand);
    const line = { type: 'scatter', mode: 'lines', name: 'Predicted demand', x: xs, y: ys, line: { color: COLORS.primary, width: 2.5, shape: 'spline' }, fill: 'tozeroy', fillcolor: 'rgba(79,70,229,0.07)', hovertemplate: 'Price £%{x:.2f}<br>Demand %{y:,.0f} units<extra></extra>' };
    const current = { type: 'scatter', mode: 'markers', name: 'Current price', x: [base.proposedPrice], y: [base.totalPredictedDemand], marker: { size: 11, color: '#fff', line: { color: COLORS.baseline, width: 2.5 } }, hovertemplate: 'Current £%{x:.2f}<br>%{y:,.0f} units<extra></extra>' };
    const inventory = p.inventory < Math.max(...ys) * 1.05
      ? { type: 'scatter', mode: 'lines', name: 'Available inventory', x: [xs[0], xs[xs.length - 1]], y: [p.inventory, p.inventory], line: { color: COLORS.warning, width: 1.5, dash: 'dash' }, hovertemplate: 'Inventory %{y:,.0f} units<extra></extra>' }
      : null;
    const layout = baseLayout({
      xaxis: { title: { text: 'Selling price (£)', font: { size: 12 } }, tickprefix: '£' },
      yaxis: { title: { text: 'Predicted demand (units)', font: { size: 12 } }, rangemode: 'tozero' },
    });
    curveCache = { key, line, current, inventory, layout };
  }
  const { line, current, inventory, layout } = curveCache;
  const proposed = { type: 'scatter', mode: 'markers', name: 'Proposed price', x: [r.proposedPrice], y: [r.totalPredictedDemand], marker: { size: 12, color: COLORS.primary, line: { color: '#fff', width: 2 } }, hovertemplate: 'Proposed £%{x:.2f}<br>%{y:,.0f} units<extra></extra>' };
  plot(el.querySelector('#fc-curve'), inventory ? [line, current, proposed, inventory] : [line, current, proposed], layout);
}

function renderSegments(r) {
  const segs = [...r.segmentPredictions].reverse();
  el.querySelector('#fc-seg-sub').textContent = `${fmtNum(r.totalPredictedDemand)} units at ${fmtGBP(r.proposedPrice)} · segments sum to total predicted demand`;
  plot(el.querySelector('#fc-seg'), [{
    type: 'bar', orientation: 'h',
    y: segs.map((s) => s.segmentName), x: segs.map((s) => s.displayUnits),
    text: segs.map((s) => `${fmtNum(s.displayUnits)} · ${fmtPct(s.share * 100, 0)}`), textposition: 'outside', cliponaxis: false,
    textfont: { size: 11, color: COLORS.text },
    marker: { color: segs.map((s) => s.color), cornerradius: 3 },
    customdata: segs.map((s) => [s.elasticity, (s.share * 100).toFixed(1)]),
    hovertemplate: '<b>%{y}</b><br>%{x:,} units (%{customdata[1]}%)<br>Illustrative elasticity %{customdata[0]}<extra></extra>',
  }], baseLayout({ showlegend: false, margin: { l: 8, r: 70, t: 4, b: 30 }, bargap: 0.4, xaxis: { rangemode: 'tozero' } }));
  el.querySelector('#fc-seg-note').innerHTML = r.inventoryConstraintApplied
    ? `<div class="inline-warning">${icon('package-x')}<span>Predicted demand (${fmtNum(r.totalPredictedDemand)}) exceeds inventory; expected units sold are capped at ${fmtNum(r.expectedUnitsSold)}. Segment bars show demand before the inventory cap.</span></div>`
    : '';
}

function renderInsights(p, r, base, weeks) {
  const items = [];
  const dp = pctChange(r.proposedPrice, p.currentPrice);
  if (Math.abs(dp ?? 0) >= 0.05) {
    items.push({ tone: 'neutral', icon: dp > 0 ? 'arrow-up-right' : 'arrow-down-right', text: `A ${fmtPct(dp, 1, true)} price change moves predicted demand ${fmtPct(pctChange(r.totalPredictedDemand, base.totalPredictedDemand), 1, true)} and gross profit ${fmtPct(pctChange(r.expectedProfit, base.expectedProfit), 1, true)}.` });
  } else {
    items.push({ tone: 'neutral', icon: 'info', text: 'Showing the forecast at the current shelf price. Move the slider to explore alternative prices.' });
  }
  items.push({ tone: 'neutral', icon: 'activity', text: `Price sensitivity is <strong>${sensitivityLabel(p.priceSensitivity).toLowerCase()}</strong> (base elasticity ${p.priceSensitivity.toFixed(2)}): a 1% price rise reduces demand by roughly ${p.priceSensitivity.toFixed(1)}% before segment mix effects.` });
  const sf = r.assumptions.seasonalFactor;
  items.push({ tone: sf > 1.05 ? 'pos' : sf < 0.95 ? 'warn' : 'neutral', icon: 'calendar-range', text: `Seasonal index for ${horizonText(weeks)} is <strong>${sf.toFixed(2)}</strong> — ${sf > 1.05 ? 'an above-average selling period' : sf < 0.95 ? 'a below-average selling period' : 'close to an average period'} for this product.` });
  const top = [...r.segmentPredictions].sort((a, b) => b.predictedDemand - a.predictedDemand)[0];
  items.push({ tone: 'neutral', icon: 'users', text: `${escapeHtml(top.segmentName)} contribute the largest share of demand (${fmtPct(top.share * 100, 0)}).` });
  if (r.inventoryConstraintApplied) items.push({ tone: 'warn', icon: 'package-x', text: `Inventory constraint applied: ${fmtNum(r.lostDemand)} units of demand cannot be served from ${fmtNum(p.inventory)} in stock.` });
  else if (p.inventory < r.totalPredictedDemand * 1.25) items.push({ tone: 'warn', icon: 'package', text: `Stock cover is tight: inventory is within 25% of predicted demand.` });
  el.querySelector('#fc-insights').innerHTML = insightList(items);
}

function renderHistory(p) {
  const h = p.history;
  plot(el.querySelector('#fc-hist'), [{
    type: 'bar', name: 'Units sold', x: h.map((w) => w.weekStart), y: h.map((w) => w.totalUnits),
    marker: { color: h.map((w) => (w.promo ? COLORS.secondary : COLORS.primaryLight)), cornerradius: 2 },
    customdata: h.map((w) => [w.price.toFixed(2), w.promo ? ' · promotion' : '']),
    hovertemplate: 'Week of %{x|%d %b %Y}<br>%{y:,} units at £%{customdata[0]}%{customdata[1]}<extra></extra>',
  }], baseLayout({ showlegend: false, bargap: 0.25, margin: { t: 4 }, xaxis: { type: 'date', tickformat: '%b %y' }, yaxis: { title: { text: 'Units', font: { size: 12 } } } }));
}
