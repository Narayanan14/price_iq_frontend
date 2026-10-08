// Page 1 — Executive Overview: historical performance + illustrative pricing opportunities.

import { getState, setState, subscribe, setPriceScenario } from '../state.js';
import { navigate } from '../router.js';
import { getCategories } from '../services/product-service.js';
import {
  getHistoricalSummary, getWeeklyTrend, getMonthlyTrend, getPortfolioRecommendations,
  getOpportunityKPIs, getCategoryOpportunities, getInsights,
} from '../services/analytics-service.js';
import { pageHeader, cardHeader, segmented, horizonText } from '../components/ui.js';
import { kpiCard, statusBadge, deltaChip, skeletonCards } from '../components/kpi-card.js';
import { DataTable } from '../components/data-table.js';
import { plot, baseLayout, COLORS } from '../components/chart-utils.js';
import { toast } from '../components/modal.js';
import { escapeHtml, icon, fmtGBP, fmtGBPCompact, fmtNum, fmtPct, fmtDate, refreshIcons } from '../utils.js';

const WINDOWS = [
  { value: 13, label: 'Last 13 weeks' },
  { value: 26, label: 'Last 26 weeks' },
  { value: 52, label: 'Last 52 weeks' },
];

let el;
let table;
let unsub = [];
let local = { windowWeeks: 52, granularity: 'week', status: 'All' };

export default {
  mount(container) {
    el = container;
    const s = getState();
    el.innerHTML = `
      ${pageHeader('Executive Overview', 'Portfolio-wide pricing intelligence and profitability insights.', `
        <label class="field inline"><span class="field-label">Analysis period</span>
          <select class="select" id="ov-window" aria-label="Historical analysis period">${WINDOWS.map((w) => `<option value="${w.value}" ${w.value === local.windowWeeks ? 'selected' : ''}>${w.label}</option>`).join('')}</select>
        </label>
        <label class="field inline"><span class="field-label">Category</span>
          <select class="select" id="ov-category" aria-label="Category filter"><option value="All">All categories</option>${getCategories().map((c) => `<option ${c === s.selectedCategory ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>
        </label>
        <button class="btn btn-secondary" id="ov-refresh">${icon('refresh-cw')}Refresh analytics</button>`)}
      <div class="pill-tabs" id="ov-tabs" role="tablist" aria-label="Category quick filter"></div>
      <section class="card kpi-panel" id="ov-kpis"><div class="kpi-grid">${skeletonCards(6)}</div></section>
      <div class="grid grid-12">
        <section class="card span-8">
          ${cardHeader('Revenue & Gross Profit Trend', 'Synthetic historical sales · aggregated from product × week × segment records', segmented('ov-gran', [{ value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }], local.granularity))}
          <div class="chart chart-lg" id="ov-trend"><div class="chart-skeleton"></div></div>
        </section>
        <section class="card span-4">
          ${cardHeader('Pricing Opportunities by Category', 'Estimated gross-profit uplift · click a bar to filter')}
          <div class="chart chart-lg" id="ov-cat"><div class="chart-skeleton"></div></div>
        </section>
      </div>
      <section class="card">
        ${cardHeader('Key Insights', 'Computed from the synthetic dataset and the shared pricing engine')}
        <div class="insight-cards" id="ov-insights"></div>
      </section>
      <section class="card">
        ${cardHeader('Product Pricing Opportunities', '<span id="ov-table-sub"></span>', '<span class="illustrative-tag">Illustrative</span>')}
        <div id="ov-table"></div>
      </section>`;

    bindControls();
    unsub.push(subscribe(() => renderAll(), ['forecastPeriod']));
    unsub.push(subscribe(() => {
      el.querySelector('#ov-category').value = getState().selectedCategory;
      renderAll();
    }, ['selectedCategory']));
    // Let the skeleton paint before the (fast) portfolio computation.
    requestAnimationFrame(() => setTimeout(() => el && renderAll(), 30));
  },
  unmount() {
    unsub.forEach((u) => u());
    unsub = [];
    table = null;
    el = null;
  },
};

function bindControls() {
  el.querySelector('#ov-window').addEventListener('change', (e) => {
    local.windowWeeks = Number(e.target.value);
    renderKPIs();
    renderTrend();
  });
  el.querySelector('#ov-category').addEventListener('change', (e) => setState({ selectedCategory: e.target.value }));
  el.querySelector('#ov-refresh').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    btn.classList.add('spinning');
    setTimeout(() => {
      renderAll();
      btn.classList.remove('spinning');
      toast('Analytics recomputed from the synthetic dataset.');
    }, 250);
  });
  el.querySelector('#ov-gran').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    local.granularity = b.dataset.value;
    el.querySelectorAll('#ov-gran button').forEach((x) => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
    renderTrend();
  });
  el.querySelector('#ov-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (b) setState({ selectedCategory: b.dataset.cat });
  });
  el.querySelector('#ov-insights').addEventListener('click', (e) => {
    const b = e.target.closest('[data-product]');
    if (b) navigate('optimization', { product: b.dataset.product });
  });
}

function renderAll() {
  if (!el) return;
  renderTabs();
  renderKPIs();
  renderTrend();
  renderCategoryChart();
  renderInsights();
  renderTable();
  refreshIcons();
}

function renderTabs() {
  const cat = getState().selectedCategory;
  el.querySelector('#ov-tabs').innerHTML = ['All', ...getCategories()].map((c) => `<button role="tab" aria-selected="${c === cat}" class="pill ${c === cat ? 'active' : ''}" data-cat="${escapeHtml(c)}">${c === 'All' ? 'All categories' : escapeHtml(c)}</button>`).join('');
}

function renderKPIs() {
  const { forecastPeriod: weeks, selectedCategory: cat } = getState();
  const h = getHistoricalSummary(local.windowWeeks, cat);
  const k = getOpportunityKPIs(weeks, cat);
  const prior = h.revenueChange != null ? ` vs prior ${local.windowWeeks} wks` : '';
  el.querySelector('#ov-kpis').innerHTML = `
    <div class="kpi-groups">
      <div class="kpi-group">
        <div class="kpi-group-label">${icon('history')}Historical performance · ${local.windowWeeks === 52 ? 'last 52 weeks' : `last ${local.windowWeeks} weeks`}${cat !== 'All' ? ` · ${escapeHtml(cat)}` : ''}</div>
        <div class="kpi-grid three">
          ${kpiCard({ label: 'Products Analyzed', value: fmtNum(k.productsAnalyzed), icon: 'package', sub: `${fmtNum(h.units)} units sold in period` })}
          ${kpiCard({ label: 'Historical Revenue', value: fmtGBPCompact(h.revenue), icon: 'pound-sterling', delta: h.revenueChange, sub: h.revenueChange != null ? `Change${prior}` : `${fmtDate(getWeeklyTrend(local.windowWeeks)[0].weekStart, { month: 'short', year: 'numeric' })} – Oct 2026` })}
          ${kpiCard({ label: 'Estimated Gross Profit', value: fmtGBPCompact(h.grossProfit), icon: 'wallet', delta: h.profitChange, sub: `${fmtPct(h.marginPct, 1)} gross margin` })}
        </div>
      </div>
      <div class="kpi-group">
        <div class="kpi-group-label accent">${icon('sparkles')}Estimated profit opportunity · next ${weeks} week${weeks > 1 ? 's' : ''} (${horizonText(weeks)})</div>
        <div class="kpi-grid three">
          ${kpiCard({ label: 'Pricing Opportunities', value: fmtNum(k.opportunities), icon: 'target', sub: `${k.highOpportunities} high · ${fmtPct(k.opportunityShare, 0)} of products ≥ 2% uplift`, tone: 'accent' })}
          ${kpiCard({ label: 'Potential Profit Uplift', value: `+${fmtGBPCompact(k.potentialUpliftAbs)}`, icon: 'trending-up', sub: `${fmtPct(k.potentialUpliftPct, 1, true)} vs ${fmtGBPCompact(k.currentForecastProfit)} forecast at current prices`, tone: 'accent' })}
          ${kpiCard({ label: 'Avg Recommended Price Change', value: fmtPct(k.avgPriceChangePct, 1, true), icon: 'arrow-up-down', sub: `${k.increases} increases · ${k.decreases} decreases · ${fmtNum(k.productsAnalyzed - k.increases - k.decreases)} hold`, tone: 'accent' })}
        </div>
      </div>
    </div>`;
}

function renderTrend() {
  const cat = getState().selectedCategory;
  const node = el.querySelector('#ov-trend');
  let x;
  let rev;
  let gp;
  let custom;
  if (local.granularity === 'month') {
    const rows = getMonthlyTrend(local.windowWeeks, cat);
    x = rows.map((r) => `${r.month}-01`);
    rev = rows.map((r) => r.revenue);
    gp = rows.map((r) => r.grossProfit);
    custom = rows.map((r) => [`${r.weeks} wks`, r.revenue > 0 ? ((r.grossProfit / r.revenue) * 100).toFixed(1) : '0']);
  } else {
    const rows = getWeeklyTrend(local.windowWeeks, cat);
    x = rows.map((r) => r.weekStart);
    rev = rows.map((r) => r.revenue);
    gp = rows.map((r) => r.grossProfit);
    custom = rows.map((r) => [`Week of ${fmtDate(r.weekStart)}`, r.revenue > 0 ? ((r.grossProfit / r.revenue) * 100).toFixed(1) : '0']);
  }
  const hover = (label) => `<b>${label}</b><br>%{customdata[0]}<br>£%{y:,.0f}<br>Margin %{customdata[1]}%<extra></extra>`;
  plot(node, [
    { type: 'bar', name: 'Revenue', x, y: rev, customdata: custom, marker: { color: COLORS.primaryLight, cornerradius: 3 }, hovertemplate: hover('Revenue') },
    { type: 'bar', name: 'Gross profit', x, y: gp, customdata: custom, marker: { color: COLORS.primary, cornerradius: 3 }, hovertemplate: hover('Gross profit') },
  ], baseLayout({
    barmode: 'overlay',
    bargap: local.granularity === 'month' ? 0.45 : 0.3,
    hovermode: 'x unified',
    yaxis: { tickprefix: '£', tickformat: '~s' },
    xaxis: { type: 'date', tickformat: local.granularity === 'month' ? '%b %Y' : '%d %b', hoverformat: local.granularity === 'month' ? '%B %Y' : '%d %b %Y' },
  }));
}

function renderCategoryChart() {
  const { forecastPeriod: weeks, selectedCategory: sel } = getState();
  const cats = getCategoryOpportunities(weeks).slice().sort((a, b) => a.upliftAbs - b.upliftAbs);
  const node = el.querySelector('#ov-cat');
  plot(node, [{
    type: 'bar',
    orientation: 'h',
    y: cats.map((c) => c.category),
    x: cats.map((c) => c.upliftAbs),
    text: cats.map((c) => `${c.opportunities} opps`),
    textposition: 'outside',
    cliponaxis: false,
    textfont: { size: 11, color: COLORS.muted },
    customdata: cats.map((c) => [c.opportunities, c.products, c.upliftPct.toFixed(1)]),
    marker: { color: cats.map((c) => (sel === 'All' || sel === c.category ? COLORS.primary : '#C7D2FE')), cornerradius: 3 },
    hovertemplate: '<b>%{y}</b><br>%{customdata[0]} of %{customdata[1]} products are opportunities<br>Uplift £%{x:,.0f} (+%{customdata[2]}%)<extra></extra>',
  }], baseLayout({ showlegend: false, margin: { l: 8, r: 56, t: 4, b: 36 }, xaxis: { tickprefix: '£', tickformat: '~s' }, yaxis: { automargin: true }, bargap: 0.38 }));
  node.removeAllListeners?.('plotly_click');
  node.on?.('plotly_click', (ev) => {
    const c = ev.points?.[0]?.y;
    if (c) setState({ selectedCategory: getState().selectedCategory === c ? 'All' : c });
  });
}

function renderInsights() {
  const { forecastPeriod: weeks, selectedCategory: cat } = getState();
  const items = getInsights(weeks, cat);
  el.querySelector('#ov-insights').innerHTML = items.map((i) => `
    <div class="insight-card tone-${i.tone}">
      <span class="ic">${icon(i.icon)}</span>
      <div><strong>${escapeHtml(i.title)}</strong><p>${escapeHtml(i.text)}</p>${i.productId ? `<button class="link-btn" data-product="${i.productId}">Analyze ${icon('arrow-right')}</button>` : ''}</div>
    </div>`).join('') || '<p class="muted">No insights for this selection.</p>';
}

function tableRows() {
  const { forecastPeriod: weeks, selectedCategory: cat } = getState();
  let rows = getPortfolioRecommendations(weeks).filter((r) => cat === 'All' || r.category === cat);
  if (local.status === 'Inventory Constrained') rows = rows.filter((r) => r.inventoryConstrained);
  else if (local.status === 'Opportunities') rows = rows.filter((r) => r.status !== 'Near Optimal');
  else if (local.status !== 'All') rows = rows.filter((r) => r.status === local.status);
  return rows;
}

function renderTable() {
  const host = el.querySelector('#ov-table');
  const filtersActive = () => getState().selectedCategory !== 'All' || local.status !== 'All';
  const toolbarExtra = `
    <select class="select select-sm" id="ov-status" aria-label="Filter by status">
      ${['All', 'Opportunities', 'High Opportunity', 'Moderate Opportunity', 'Near Optimal', 'Inventory Constrained'].map((s) => `<option value="${s}" ${s === local.status ? 'selected' : ''}>${s === 'All' ? 'All statuses' : s === 'Opportunities' ? 'Opportunities only' : s}</option>`).join('')}
    </select>
    <span class="filter-chip" id="ov-filter-chip" ${filtersActive() ? '' : 'hidden'}>${icon('filter')}<span></span><button class="link-btn" id="ov-reset">Reset filters</button></span>`;
  if (!table) {
    table = new DataTable(host, {
      columns: [
        { key: 'sku', label: 'SKU', render: (r) => `<span class="mono">${escapeHtml(r.sku)}</span>` },
        { key: 'productName', label: 'Product Name', render: (r) => `<button class="cell-link" data-row-action="analyze" data-row-id="${r.productId}">${escapeHtml(r.productName)}</button>${r.product.featured ? '<span class="mini-tag">Featured</span>' : ''}` },
        { key: 'category', label: 'Category', render: (r) => `<span class="muted">${escapeHtml(r.category)}</span>` },
        { key: 'currentPrice', label: 'Current Price', align: 'right', render: (r) => fmtGBP(r.currentPrice), csv: (r) => r.currentPrice.toFixed(2) },
        { key: 'recommendedPrice', label: 'Recommended Price', align: 'right', render: (r) => `<strong>${fmtGBP(r.recommendedPrice)}</strong>`, csv: (r) => r.recommendedPrice.toFixed(2) },
        { key: 'priceChangePct', label: 'Price Change %', align: 'right', render: (r) => `<span class="num-plain">${fmtPct(r.priceChangePct, 1, true)}</span>`, csv: (r) => r.priceChangePct.toFixed(1) },
        { key: 'upliftPct', label: 'Expected Profit Uplift %', align: 'right', render: (r) => deltaChip(r.upliftPct), csv: (r) => r.upliftPct.toFixed(1) },
        { key: 'status', label: 'Opportunity Status', render: (r) => `${statusBadge(r.status)}${r.inventoryConstrained ? statusBadge('Inventory Constrained') : ''}`, csv: (r) => r.status + (r.inventoryConstrained ? ' / Inventory Constrained' : '') },
        { key: 'actions', label: 'Action', sortable: false, render: (r) => `<div class="row-actions"><button class="btn btn-xs btn-primary-soft" data-row-action="analyze" data-row-id="${r.productId}">${icon('target')}Analyze</button><button class="btn btn-xs btn-ghost" data-row-action="simulate" data-row-id="${r.productId}">${icon('sliders-horizontal')}Simulate</button></div>` },
      ],
      rows: tableRows(),
      searchKeys: ['sku', 'productName', 'category'],
      searchPlaceholder: 'Search SKU, product or category…',
      exportName: 'priceiq-pricing-opportunities',
      initialSort: { key: 'upliftPct', dir: 'desc' },
      toolbarExtra,
      rowClass: (r) => (r.status === 'High Opportunity' ? 'row-high' : ''),
      onAction: (action, r) => {
        if (action === 'analyze') navigate('optimization', { product: r.productId });
        if (action === 'simulate') {
          setPriceScenario(r.productId, r.currentPrice, r.recommendedPrice);
          navigate('simulator', { product: r.productId });
        }
      },
    });
    host.querySelector('#ov-status').addEventListener('change', (e) => {
      local.status = e.target.value;
      table.setRows(tableRows());
      updateFilterChip();
    });
    host.addEventListener('click', (e) => {
      if (e.target.closest('#ov-reset')) {
        local.status = 'All';
        host.querySelector('#ov-status').value = 'All';
        if (getState().selectedCategory !== 'All') setState({ selectedCategory: 'All' });
        else table.setRows(tableRows());
        updateFilterChip();
        toast('Filters reset.', 'info');
      }
    });
  } else {
    table.setRows(tableRows());
  }
  updateFilterChip();
  const weeks = getState().forecastPeriod;
  el.querySelector('#ov-table-sub').textContent = `Optimizer results for all ${fmtNum(getPortfolioRecommendations(weeks).length)} products · next ${weeks} week${weeks > 1 ? 's' : ''} · opportunity = expected profit uplift ≥ 2%`;
}

function updateFilterChip() {
  const chip = el?.querySelector('#ov-filter-chip');
  if (!chip) return;
  const cat = getState().selectedCategory;
  const parts = [];
  if (cat !== 'All') parts.push(cat);
  if (local.status !== 'All') parts.push(local.status === 'Opportunities' ? 'Opportunities only' : local.status);
  chip.hidden = parts.length === 0;
  chip.querySelector('span').textContent = parts.join(' · ');
}
