// Page 5 — Customer Intelligence: illustrative RFM-style segments (stand-in for K-Means).

import { getState, subscribe, selectProduct } from '../state.js';
import { navigate } from '../router.js';
import { getProduct, getDataset } from '../services/product-service.js';
import { getSegmentSummaries, getNormalisedRFM, getCustomerSample, getSegmentCategoryPreferences, getProductSegmentBreakdown } from '../services/segmentation-service.js';
import { SEGMENTS } from '../data/seed-data.js';
import { pageHeader, cardHeader, segmented } from '../components/ui.js';
import { deltaChip } from '../components/kpi-card.js';
import { createProductPicker } from '../components/product-picker.js';
import { plot, baseLayout, COLORS } from '../components/chart-utils.js';
import { escapeHtml, icon, fmtGBP, fmtGBPCompact, fmtNum, fmtPct, refreshIcons } from '../utils.js';

let el;
let picker;
let unsub = [];
let prefSegment = 'all';

const SEG_ICONS = { 1: 'crown', 2: 'repeat', 3: 'shopping-bag', 4: 'user-x' };

export default {
  mount(container) {
    el = container;
    const s = getState();
    el.innerHTML = `
      ${pageHeader('Customer Intelligence', 'Explore illustrative customer segments and purchasing behaviour.')}
      <div class="notice">${icon('info')}<span><strong>Illustrative segments.</strong> These four groups are built from simulated RFM-style characteristics (recency, frequency, monetary value) for ${fmtNum(getDataset().customers.length)} synthetic customers. They represent the proposed K-Means segmentation component — no clustering model has been trained yet, and real clusters may differ.</span></div>
      <div class="segment-cards" id="cu-cards"></div>
      <div class="grid grid-12">
        <section class="card span-4">
          ${cardHeader('Customer Distribution', 'Share of synthetic customers by segment')}
          <div class="chart chart-sm" id="cu-donut"></div>
        </section>
        <section class="card span-8">
          ${cardHeader('RFM Comparison', 'Segment averages normalised to a 20–100 index · higher = more recent / more frequent / higher spend')}
          <div class="chart chart-sm" id="cu-rfm"></div>
          <div class="rfm-legend">
            <span><strong>Recency</strong> days since last purchase (lower = more recent; inverted in the index)</span>
            <span><strong>Frequency</strong> number of purchases</span>
            <span><strong>Monetary</strong> total customer spending</span>
          </div>
        </section>
      </div>
      <div class="grid grid-12">
        <section class="card span-7">
          ${cardHeader('Customer Value Analysis', 'Purchase frequency vs monetary value · stratified sample of 880 customers · click legend to toggle')}
          <div class="chart chart-md" id="cu-scatter"></div>
        </section>
        <section class="card span-5">
          ${cardHeader('Segment Product Preferences', 'Historical revenue by category', segmented('cu-pref-seg', [{ value: 'all', label: 'All' }, ...SEGMENTS.map((x) => ({ value: x.id, label: x.short }))], prefSegment))}
          <div class="chart chart-md" id="cu-pref"></div>
        </section>
      </div>
      <section class="card">
        ${cardHeader('Product-Specific Segment Analysis', 'Connects customer segments to the demand forecast for a single product', `<button class="btn btn-primary btn-sm" id="cu-analyze">${icon('chart-line')}Analyze Demand for This Product</button>`)}
        <div class="psa-grid">
          <div id="cu-picker"></div>
          <div id="cu-psa-summary" class="psa-summary"></div>
        </div>
        <div class="grid grid-2">
          <div><h3 class="mini-title">Historical sales vs forecast demand share</h3><div class="chart chart-sm" id="cu-psa-chart"></div></div>
          <div><h3 class="mini-title">Illustrative demand response by segment</h3><div id="cu-psa-table"></div></div>
        </div>
      </section>`;

    picker = createProductPicker(el.querySelector('#cu-picker'), { value: s.selectedProductId, onChange: (pid) => selectProduct(pid) });
    el.querySelector('#cu-pref-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      prefSegment = b.dataset.value;
      el.querySelectorAll('#cu-pref-seg button').forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-pressed', String(x === b));
      });
      renderPreferences();
    });
    el.querySelector('#cu-cards').addEventListener('click', (e) => {
      const b = e.target.closest('[data-seg]');
      if (!b) return;
      prefSegment = b.dataset.seg;
      el.querySelectorAll('#cu-pref-seg button').forEach((x) => x.classList.toggle('active', x.dataset.value === prefSegment));
      renderPreferences();
      el.querySelector('#cu-pref').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    el.querySelector('#cu-analyze').addEventListener('click', () => navigate('forecast', { product: getState().selectedProductId }));
    unsub.push(subscribe(() => {
      picker.setValue(getState().selectedProductId);
      renderProduct();
    }, ['selectedProductId', 'forecastPeriod']));

    renderCards();
    renderDonut();
    renderRFM();
    renderScatter();
    renderPreferences();
    renderProduct();
    refreshIcons();
  },
  unmount() {
    unsub.forEach((u) => u());
    unsub = [];
    picker?.destroy();
    el = null;
  },
};

function renderCards() {
  el.querySelector('#cu-cards').innerHTML = getSegmentSummaries().map((s) => `
    <article class="segment-card" style="--seg:${s.color}">
      <div class="seg-head"><span class="seg-icon">${icon(SEG_ICONS[s.id])}</span><div><h3>${escapeHtml(s.name)}</h3><p>${escapeHtml(s.description)}</p></div></div>
      <div class="seg-stats">
        <div><span>Customers</span><strong>${fmtNum(s.customerCount)}</strong><small>${fmtPct(s.customerPct, 0)} of base</small></div>
        <div><span>Revenue share</span><strong>${fmtPct(s.revenueShare, 1)}</strong><small>${fmtGBPCompact(s.revenue)}</small></div>
        <div><span>Avg order value</span><strong>${fmtGBP(s.avgOrderValue, 0)}</strong></div>
        <div><span>Avg frequency</span><strong>${s.avgFrequency.toFixed(1)}</strong><small>orders / yr</small></div>
        <div><span>Avg monetary</span><strong>${fmtGBP(s.avgMonetary, 0)}</strong></div>
        <div><span>Avg recency</span><strong>${fmtNum(s.avgRecency)} d</strong></div>
      </div>
      <div class="seg-foot"><span class="muted small">Illustrative elasticity multiplier ×${s.elasticityMultiplier.toFixed(1)}</span><button class="link-btn" data-seg="${s.id}">Category mix ${icon('arrow-right')}</button></div>
    </article>`).join('');
}

function renderDonut() {
  const s = getSegmentSummaries();
  plot(el.querySelector('#cu-donut'), [{
    type: 'pie', hole: 0.62, labels: s.map((x) => x.name), values: s.map((x) => x.customerCount),
    marker: { colors: s.map((x) => x.color), line: { color: '#fff', width: 2 } }, sort: false, direction: 'clockwise',
    textinfo: 'percent', textfont: { color: '#fff', size: 11 }, hovertemplate: '<b>%{label}</b><br>%{value:,} customers (%{percent})<extra></extra>',
  }], baseLayout({
    margin: { l: 8, r: 8, t: 8, b: 8 }, legend: { orientation: 'h', y: -0.08, x: 0.5, xanchor: 'center', font: { size: 11 } },
    annotations: [{ text: `<b>${fmtNum(s.reduce((a, b) => a + b.customerCount, 0))}</b><br><span style="font-size:11px;color:#64748B">customers</span>`, showarrow: false, font: { size: 20, color: COLORS.text } }],
  }));
}

function renderRFM() {
  const n = getNormalisedRFM();
  const dims = ['Recency', 'Frequency', 'Monetary'];
  const vals = [n.recency, n.frequency, n.monetary];
  const raw = n.raw;
  plot(el.querySelector('#cu-rfm'), SEGMENTS.map((seg, i) => ({
    type: 'bar', name: seg.name, x: dims, y: vals.map((v) => v[i]),
    marker: { color: seg.color, cornerradius: 3 },
    customdata: [[`${fmtNum(raw[i].avgRecency)} days`], [`${raw[i].avgFrequency.toFixed(1)} orders`], [fmtGBP(raw[i].avgMonetary, 0)]],
    hovertemplate: `<b>${seg.name}</b><br>%{x}: %{customdata[0]}<br>Index %{y}<extra></extra>`,
  })), baseLayout({ barmode: 'group', bargap: 0.25, bargroupgap: 0.08, margin: { t: 34 }, yaxis: { range: [0, 110], title: { text: 'Index', font: { size: 12 } } } }));
}

function renderScatter() {
  const sample = getCustomerSample(220);
  plot(el.querySelector('#cu-scatter'), SEGMENTS.map((seg) => {
    const pts = sample.filter((c) => c.segmentId === seg.id);
    return {
      type: 'scatter', mode: 'markers', name: seg.name, x: pts.map((c) => c.frequency), y: pts.map((c) => c.monetaryValue),
      customdata: pts.map((c) => [c.customerId, fmtGBP(c.averageOrderValue, 0), c.recencyDays]),
      marker: { color: seg.color, size: 8, opacity: 0.72, line: { color: '#fff', width: 1 } },
      hovertemplate: `<b>%{customdata[0]}</b> · ${seg.name}<br>Frequency %{x} orders<br>Monetary £%{y:,.0f}<br>AOV %{customdata[1]} · last purchase %{customdata[2]} days ago<extra></extra>`,
    };
  }), baseLayout({
    margin: { t: 34 },
    xaxis: { title: { text: 'Purchase frequency (orders)', font: { size: 12 } } },
    yaxis: { title: { text: 'Monetary value (£, log scale)', font: { size: 12 } }, type: 'log', tickprefix: '£', tickformat: '~s' },
  }));
}

function renderPreferences() {
  const segId = prefSegment === 'all' ? null : Number(prefSegment);
  const rows = getSegmentCategoryPreferences(segId).slice().reverse();
  const seg = segId ? SEGMENTS.find((s) => s.id === segId) : null;
  plot(el.querySelector('#cu-pref'), [{
    type: 'bar', orientation: 'h', y: rows.map((r) => r.category), x: rows.map((r) => r.revenue),
    marker: { color: seg ? seg.color : COLORS.primary, cornerradius: 3 },
    text: rows.map((r) => `${fmtPct(r.share, 1)}${r.index != null ? ` · idx ${r.index}` : ''}`), textposition: 'outside', cliponaxis: false, textfont: { size: 11, color: COLORS.muted },
    customdata: rows.map((r) => [fmtNum(r.units), r.purchaseWeeks, r.index ?? 100]),
    hovertemplate: '<b>%{y}</b><br>Revenue £%{x:,.0f}<br>%{customdata[0]} units · purchased in %{customdata[1]} product-weeks<br>Index vs all customers %{customdata[2]}<extra></extra>',
  }], baseLayout({ showlegend: false, margin: { l: 8, r: 96, t: 4, b: 36 }, bargap: 0.35, xaxis: { tickprefix: '£', tickformat: '~s' } }));
}

function renderProduct() {
  if (!el) return;
  const weeks = getState().forecastPeriod;
  const p = getProduct(getState().selectedProductId);
  const b = getProductSegmentBreakdown(p.productId, weeks);
  const units = b.forecast.segmentPredictions.map((x) => x.displayUnits);
  const top = [...b.segments].sort((x, y) => y.historicalShare - x.historicalShare)[0];
  el.querySelector('#cu-psa-summary').innerHTML = `
    <div><span>Current price</span><strong>${fmtGBP(p.currentPrice)}</strong></div>
    <div><span>Forecast demand (${weeks} wk)</span><strong>${fmtNum(b.forecast.totalPredictedDemand)} units</strong></div>
    <div><span>Largest historical segment</span><strong>${escapeHtml(top.short)} · ${fmtPct(top.historicalShare, 0)}</strong></div>
    <div><span>Historical units (52 wk)</span><strong>${fmtNum(p.historicalUnitsSold)}</strong></div>`;
  plot(el.querySelector('#cu-psa-chart'), [
    { type: 'bar', name: 'Historical sales share', x: b.segments.map((s) => s.short), y: b.segments.map((s) => s.historicalShare), marker: { color: '#CBD5E1', cornerradius: 3 }, customdata: b.segments.map((s) => fmtNum(s.historicalUnits)), hovertemplate: '%{x}<br>Historical %{y:.1f}% (%{customdata} units)<extra></extra>' },
    { type: 'bar', name: `Forecast demand share (${weeks} wk)`, x: b.segments.map((s) => s.short), y: b.segments.map((s) => s.forecastShare), marker: { color: b.segments.map((s) => s.color), cornerradius: 3 }, customdata: units.map((u) => fmtNum(u)), hovertemplate: '%{x}<br>Forecast %{y:.1f}% (%{customdata} units)<extra></extra>' },
  ], baseLayout({ barmode: 'group', bargap: 0.3, margin: { t: 30 }, yaxis: { ticksuffix: '%', rangemode: 'tozero' } }));
  el.querySelector('#cu-psa-table').innerHTML = `<div class="table-scroll"><table class="simple-table">
    <thead><tr><th>Segment</th><th class="num">Forecast units</th><th class="num">Elasticity</th><th class="num">Price −5%</th><th class="num">Price +5%</th></tr></thead>
    <tbody>${b.segments.map((s, i) => `<tr><td><span class="seg-dot" style="background:${s.color}"></span>${escapeHtml(s.segmentName)}</td><td class="num">${fmtNum(units[i])}</td><td class="num">${s.elasticity.toFixed(2)}</td><td class="num">${deltaChip(s.responseDown5)}</td><td class="num">${deltaChip(s.responseUp5)}</td></tr>`).join('')}
    <tr class="total-row"><td>Total</td><td class="num">${fmtNum(b.forecast.totalPredictedDemand)}</td><td></td><td></td><td></td></tr></tbody></table></div>
    <p class="muted small">Demand response at ±5% of the current price, from the shared demand service. Elasticities are illustrative assumptions.</p>`;
  refreshIcons();
}
