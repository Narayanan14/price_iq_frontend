// Page 4 — What-If Simulator: baseline vs scenario price via two calls to the demand service.

import { getState, setState, subscribe, selectProduct, setPriceScenario } from '../state.js';
import { navigate } from '../router.js';
import { getProduct } from '../services/product-service.js';
import { simulatePrice } from '../services/simulation-service.js';
import { optimizePrice } from '../services/optimization-service.js';
import { PricingInputError } from '../services/demand-service.js';
import { pageHeader, cardHeader, periodSelect, horizonText, insightList, errorBox } from '../components/ui.js';
import { deltaChip } from '../components/kpi-card.js';
import { createProductPicker } from '../components/product-picker.js';
import { plot, baseLayout, COLORS } from '../components/chart-utils.js';
import { openModal, toast, confirmDialog, promptDialog } from '../components/modal.js';
import { escapeHtml, icon, fmtGBP, fmtNum, fmtPct, fmtDate, pctChange, round2, throttleFrame, throttle, refreshIcons, isFiniteNumber, signClass } from '../utils.js';

let el;
let picker;
let unsub = [];
let baseline;
let scenario;
let lastSim = null;
const selectedForCompare = new Set();
// While dragging, comparison cards update every frame; charts and insights are throttled.
const renderSecondaryThrottled = throttle((sim, weeks) => {
  if (!el) return;
  renderCharts(sim, weeks);
  renderSegments(sim);
  el.querySelector('#sm-insights').innerHTML = insightList(sim.insights);
}, 140);

export default {
  mount(container) {
    el = container;
    const s = getState();
    initPrices();
    el.innerHTML = `
      ${pageHeader('What-If Simulator', 'Explore the financial impact of alternative pricing decisions.', `
        <button class="btn btn-secondary" id="sm-copilot">${icon('sparkles')}Ask Copilot</button>
        <button class="btn btn-primary" id="sm-save">${icon('save')}Save scenario</button>`)}
      <section class="card sim-controls">
        <div class="sim-grid">
          <div id="sm-picker"></div>
          ${periodSelect('sm-period', s.forecastPeriod)}
          <label class="field"><span class="field-label">Baseline price (£)</span><div class="input-prefix"><span>£</span><input type="number" class="input" id="sm-base" step="0.01" min="0.01" inputmode="decimal"></div></label>
          <label class="field"><span class="field-label">Scenario price (£)</span><div class="input-prefix"><span>£</span><input type="number" class="input" id="sm-scen" step="0.01" min="0.01" inputmode="decimal"></div></label>
        </div>
        <div class="sim-slider-row">
          <div class="field grow">
            <div class="row-between"><span class="field-label">Scenario vs baseline</span><span class="slider-value" id="sm-slider-val"></span></div>
            <input type="range" id="sm-slider" min="-30" max="40" step="0.5" aria-label="Scenario price change versus baseline">
          </div>
          <div class="quick-btns" role="group" aria-label="Quick scenarios">
            <button class="chip" data-quick="-10">-10%</button>
            <button class="chip" data-quick="-5">-5%</button>
            <button class="chip" data-quick="5">+5%</button>
            <button class="chip" data-quick="10">+10%</button>
            <button class="chip chip-accent" data-quick="rec">${icon('target')}Recommended Price</button>
          </div>
        </div>
        <div id="sm-msg" aria-live="polite"></div>
      </section>
      <div class="compare-cards" id="sm-cards"></div>
      <section class="card">
        ${cardHeader('Baseline vs Scenario', '<span id="sm-chart-sub"></span>')}
        <div class="grid grid-3 mini-charts">
          <div><h3 class="mini-title">Predicted demand (units)</h3><div class="chart chart-xs" id="sm-c-demand"></div></div>
          <div><h3 class="mini-title">Expected revenue (£)</h3><div class="chart chart-xs" id="sm-c-revenue"></div></div>
          <div><h3 class="mini-title">Expected gross profit (£)</h3><div class="chart chart-xs" id="sm-c-profit"></div></div>
        </div>
      </section>
      <div class="grid grid-2">
        <section class="card">
          ${cardHeader('Segment Impact', 'Demand change by illustrative customer segment')}
          <div class="chart chart-sm" id="sm-seg"></div>
        </section>
        <section class="card">
          ${cardHeader('Scenario Insights', 'Generated from the simulated numbers')}
          <div id="sm-insights"></div>
        </section>
      </div>
      <section class="card">
        ${cardHeader('Saved Scenarios', 'Stored in this browser (localStorage) · results recomputed live by the shared engine', `
          <button class="btn btn-secondary btn-sm" id="sm-compare" disabled>${icon('git-compare')}Compare selected</button>
          <button class="btn btn-ghost btn-sm" id="sm-clear">${icon('trash-2')}Clear saved scenarios</button>`)}
        <div id="sm-saved"></div>
      </section>`;

    picker = createProductPicker(el.querySelector('#sm-picker'), { value: s.selectedProductId, onChange: (pid) => selectProduct(pid) });
    bind();
    unsub.push(subscribe(() => {
      picker.setValue(getState().selectedProductId);
      initPrices();
      renderAll();
    }, ['selectedProductId']));
    unsub.push(subscribe(() => {
      el.querySelector('#sm-period').value = String(getState().forecastPeriod);
      renderAll();
    }, ['forecastPeriod']));
    unsub.push(subscribe(() => renderSaved(), ['savedScenarios']));
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

function initPrices() {
  const p = product();
  const sc = getState().currentPriceScenario;
  if (sc && sc.productId === p.productId) {
    baseline = sc.baselinePrice;
    scenario = sc.scenarioPrice;
  } else {
    baseline = p.currentPrice;
    scenario = round2(p.currentPrice * 1.05);
  }
}

function bind() {
  const live = throttleFrame(() => renderOutputs({ live: true }));
  const baseInput = el.querySelector('#sm-base');
  const scenInput = el.querySelector('#sm-scen');
  const slider = el.querySelector('#sm-slider');
  el.querySelector('#sm-period').addEventListener('change', (e) => setState({ forecastPeriod: Number(e.target.value) }));
  baseInput.addEventListener('input', () => {
    baseline = baseInput.value === '' ? NaN : round2(Number(baseInput.value));
    live();
  });
  scenInput.addEventListener('input', () => {
    scenario = scenInput.value === '' ? NaN : round2(Number(scenInput.value));
    live();
  });
  [baseInput, scenInput].forEach((i) => i.addEventListener('blur', () => syncInputs()));
  slider.addEventListener('input', () => {
    if (!isFiniteNumber(baseline) || baseline <= 0) return;
    scenario = round2(baseline * (1 + Number(slider.value) / 100));
    scenInput.value = scenario.toFixed(2);
    live();
  });
  el.querySelector('.quick-btns').addEventListener('click', (e) => {
    const b = e.target.closest('[data-quick]');
    if (!b) return;
    const p = product();
    if (!isFiniteNumber(baseline) || baseline <= 0) baseline = p.currentPrice;
    if (b.dataset.quick === 'rec') {
      try {
        const opt = optimizePrice(p.productId, getState().forecastPeriod);
        scenario = opt.recommendedPrice;
        toast(`Scenario set to the recommended price ${fmtGBP(scenario)}.`, 'info');
      } catch (err) {
        toast('Could not compute a recommendation for this product.', 'error');
      }
    } else scenario = round2(baseline * (1 + Number(b.dataset.quick) / 100));
    syncInputs();
    renderOutputs();
  });
  el.querySelector('#sm-save').addEventListener('click', saveScenario);
  el.querySelector('#sm-copilot').addEventListener('click', () => navigate('copilot', { product: product().productId }));
  el.querySelector('#sm-clear').addEventListener('click', async () => {
    if (!getState().savedScenarios.length) return toast('There are no saved scenarios to clear.', 'info');
    const ok = await confirmDialog({ title: 'Clear saved scenarios?', message: `This permanently removes ${getState().savedScenarios.length} saved scenario(s) from this browser.`, confirmLabel: 'Clear all', danger: true });
    if (ok) {
      selectedForCompare.clear();
      setState({ savedScenarios: [] });
      toast('Saved scenarios cleared.');
    }
  });
  el.querySelector('#sm-compare').addEventListener('click', compareSaved);
  el.querySelector('#sm-saved').addEventListener('click', onSavedClick);
  el.querySelector('#sm-saved').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-select]');
    if (!cb) return;
    if (cb.checked) selectedForCompare.add(cb.dataset.select);
    else selectedForCompare.delete(cb.dataset.select);
    updateCompareBtn();
  });
}

function syncInputs() {
  if (!el) return;
  el.querySelector('#sm-base').value = isFiniteNumber(baseline) ? baseline.toFixed(2) : '';
  el.querySelector('#sm-scen').value = isFiniteNumber(scenario) ? scenario.toFixed(2) : '';
}

function renderAll() {
  if (!el) return;
  syncInputs();
  renderOutputs();
  renderSaved();
}

function validate(p) {
  if (!isFiniteNumber(baseline) || baseline <= 0) return { error: 'Baseline price must be a positive number.' };
  if (!isFiniteNumber(scenario) || scenario <= 0) return { error: 'Scenario price must be a positive number.' };
  const max = p.currentPrice * 3;
  if (baseline > max || scenario > max) return { error: `Prices above ${fmtGBP(max)} are outside the modelled range for this product.` };
  if (scenario <= p.unitCost) return { warning: `Scenario price is at or below unit cost (${fmtGBP(p.unitCost)}).` };
  return {};
}

function renderOutputs({ live = false } = {}) {
  if (!el) return;
  const p = product();
  const weeks = getState().forecastPeriod;
  const v = validate(p);
  const msg = el.querySelector('#sm-msg');
  msg.innerHTML = v.error ? errorBox(v.error) : v.warning ? `<div class="inline-warning">${icon('triangle-alert')}<span>${escapeHtml(v.warning)}</span></div>` : '';
  const change = isFiniteNumber(baseline) && isFiniteNumber(scenario) ? pctChange(scenario, baseline) : null;
  el.querySelector('#sm-slider').value = String(Math.max(-30, Math.min(40, change ?? 0)));
  el.querySelector('#sm-slider-val').textContent = change == null ? '—' : `${fmtPct(change, 1, true)} (${fmtGBP(baseline)} → ${fmtGBP(scenario)})`;
  el.querySelectorAll('[data-quick]').forEach((b) => b.classList.remove('active'));
  refreshIcons();
  if (v.error) return;

  let sim;
  try {
    sim = simulatePrice({ productId: p.productId, baselinePrice: baseline, scenarioPrice: scenario, periodWeeks: weeks });
  } catch (err) {
    msg.innerHTML = errorBox(err instanceof PricingInputError ? err.message : 'Simulation failed for these inputs.');
    refreshIcons();
    return;
  }
  lastSim = sim;
  setPriceScenario(p.productId, baseline, scenario);
  renderCards(sim);
  if (live) renderSecondaryThrottled(sim, weeks);
  else {
    renderCharts(sim, weeks);
    renderSegments(sim);
    el.querySelector('#sm-insights').innerHTML = insightList(sim.insights);
  }
  refreshIcons();
}

function renderCards(sim) {
  const d = sim.deltas;
  const card = (label, key, fmt, note = '') => {
    const x = d[key];
    const absTxt = key === 'demand' || key === 'units' ? `${x.abs >= 0 ? '+' : '−'}${fmtNum(Math.abs(x.abs))}` : `${x.abs >= 0 ? '+' : '−'}${fmtGBP(Math.abs(x.abs))}`;
    return `<div class="cmp-card">
      <span class="cmp-label">${label}</span>
      <div class="cmp-values"><div><small>Baseline</small><span>${fmt(x.baseline)}</span></div>${icon('arrow-right', 'cmp-arrow')}<div><small>Scenario</small><strong>${fmt(x.scenario)}</strong></div></div>
      <div class="cmp-delta"><span class="delta delta-${signClass(x.abs)}">${absTxt}</span>${deltaChip(x.pct)}</div>
      ${note ? `<span class="cmp-note">${note}</span>` : ''}
    </div>`;
  };
  el.querySelector('#sm-cards').innerHTML = [
    card('Predicted demand', 'demand', (v) => `${fmtNum(v)}`),
    card('Expected units sold', 'units', (v) => fmtNum(v), sim.scenario.inventoryConstraintApplied || sim.baseline.inventoryConstraintApplied ? `${icon('package-x')}Inventory cap ${fmtNum(sim.scenario.inventoryAvailable)}` : ''),
    card('Expected revenue', 'revenue', (v) => fmtGBP(v)),
    card('Expected gross profit', 'profit', (v) => fmtGBP(v)),
    card('Unit margin', 'unitMargin', (v) => fmtGBP(v)),
  ].join('');
}

function renderCharts(sim, weeks) {
  el.querySelector('#sm-chart-sub').textContent = `${sim.product.productName} · next ${weeks} week${weeks > 1 ? 's' : ''} (${horizonText(weeks)}) · axes start at zero`;
  const mini = (id, a, b, fmtHover, prefix = '') => plot(el.querySelector(id), [{
    type: 'bar', x: [`Baseline ${fmtGBP(sim.baselinePrice)}`, `Scenario ${fmtGBP(sim.scenarioPrice)}`], y: [a, b],
    marker: { color: ['#CBD5E1', COLORS.primary], cornerradius: 4 },
    text: [fmtHover(a), fmtHover(b)], textposition: 'outside', cliponaxis: false, textfont: { size: 12, color: COLORS.text },
    hovertemplate: `%{x}<br>${prefix}%{y:,.0f}<extra></extra>`,
  }], baseLayout({ showlegend: false, bargap: 0.45, margin: { l: 48, r: 8, t: 20, b: 36 }, yaxis: { rangemode: 'tozero', tickprefix: prefix, tickformat: '~s' } }));
  mini('#sm-c-demand', sim.deltas.demand.baseline, sim.deltas.demand.scenario, (v) => fmtNum(v));
  mini('#sm-c-revenue', sim.deltas.revenue.baseline, sim.deltas.revenue.scenario, (v) => fmtGBP(v, 0), '£');
  mini('#sm-c-profit', sim.deltas.profit.baseline, sim.deltas.profit.scenario, (v) => fmtGBP(v, 0), '£');
}

function renderSegments(sim) {
  const segs = [...sim.segmentImpact].reverse();
  plot(el.querySelector('#sm-seg'), [{
    type: 'bar', orientation: 'h', y: segs.map((s) => s.segmentName), x: segs.map((s) => s.pct ?? 0),
    marker: { color: segs.map((s) => s.color), cornerradius: 3 },
    text: segs.map((s) => `${fmtPct(s.pct, 1, true)} (${fmtNum(s.baseline)} → ${fmtNum(s.scenario)})`), textposition: 'outside', cliponaxis: false, textfont: { size: 11, color: COLORS.text },
    hovertemplate: '<b>%{y}</b><br>%{x:+.1f}% demand<extra></extra>',
  }], baseLayout({ showlegend: false, margin: { l: 8, r: 24, t: 4, b: 30 }, bargap: 0.4, xaxis: { ticksuffix: '%', zeroline: true, zerolinecolor: COLORS.baseline, range: symmetricRange(segs.map((s) => s.pct ?? 0)) } }));
}

function symmetricRange(vals) {
  const m = Math.max(1, ...vals.map((v) => Math.abs(v))) * 1.9;
  return [-m, m];
}

// ---------- Saved scenarios ----------

async function saveScenario() {
  const p = product();
  const v = validate(p);
  if (v.error) return toast(v.error, 'error');
  const weeks = getState().forecastPeriod;
  const name = await promptDialog({ title: 'Save scenario', label: 'Scenario name', value: `${p.productName} @ ${fmtGBP(scenario)}` });
  if (!name) return;
  const sc = { id: `sc-${Date.now().toString(36)}`, name, productId: p.productId, baselinePrice: baseline, scenarioPrice: scenario, periodWeeks: weeks, createdAt: new Date().toISOString() };
  setState({ savedScenarios: [...getState().savedScenarios, sc] });
  toast(`Scenario “${name}” saved.`);
}

function resultFor(sc) {
  try {
    return simulatePrice({ productId: sc.productId, baselinePrice: sc.baselinePrice, scenarioPrice: sc.scenarioPrice, periodWeeks: sc.periodWeeks });
  } catch {
    return null;
  }
}

function renderSaved() {
  if (!el) return;
  const list = getState().savedScenarios;
  [...selectedForCompare].forEach((id) => { if (!list.some((s) => s.id === id)) selectedForCompare.delete(id); });
  const host = el.querySelector('#sm-saved');
  if (!list.length) {
    host.innerHTML = `<div class="empty-inline">${icon('bookmark')}<span>No saved scenarios yet. Adjust a price and click <strong>Save scenario</strong> to keep it for comparison.</span></div>`;
  } else {
    host.innerHTML = `<div class="table-scroll"><table class="simple-table"><thead><tr><th class="center" style="width:36px"><span class="sr-only">Select</span></th><th>Scenario</th><th>Product</th><th class="num">Baseline</th><th class="num">Scenario</th><th class="num">Period</th><th class="num">Demand Δ</th><th class="num">Profit Δ</th><th>Saved</th><th class="num">Actions</th></tr></thead><tbody>
      ${list.map((sc) => {
        const r = resultFor(sc);
        const p = getProduct(sc.productId);
        return `<tr>
          <td class="center"><input type="checkbox" data-select="${sc.id}" ${selectedForCompare.has(sc.id) ? 'checked' : ''} aria-label="Select ${escapeHtml(sc.name)} for comparison"></td>
          <td><strong>${escapeHtml(sc.name)}</strong></td>
          <td class="muted">${escapeHtml(p?.productName ?? 'Unknown product')}</td>
          <td class="num">${fmtGBP(sc.baselinePrice)}</td>
          <td class="num">${fmtGBP(sc.scenarioPrice)}</td>
          <td class="num">${sc.periodWeeks} wk</td>
          <td class="num">${r ? deltaChip(r.deltas.demand.pct) : '—'}</td>
          <td class="num">${r ? deltaChip(r.deltas.profit.pct) : '—'}</td>
          <td class="muted small">${fmtDate(sc.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
          <td class="num"><div class="row-actions end">
            <button class="btn btn-xs btn-primary-soft" data-load="${sc.id}">${icon('upload')}Load</button>
            <button class="icon-btn xs" data-rename="${sc.id}" aria-label="Rename ${escapeHtml(sc.name)}">${icon('pencil')}</button>
            <button class="icon-btn xs" data-delete="${sc.id}" aria-label="Delete ${escapeHtml(sc.name)}">${icon('trash-2')}</button>
          </div></td></tr>`;
      }).join('')}</tbody></table></div>`;
  }
  updateCompareBtn();
  refreshIcons();
}

function updateCompareBtn() {
  const btn = el?.querySelector('#sm-compare');
  if (!btn) return;
  btn.disabled = selectedForCompare.size < 2;
  btn.innerHTML = `${icon('git-compare')}Compare selected${selectedForCompare.size ? ` (${selectedForCompare.size})` : ''}`;
  refreshIcons();
}

async function onSavedClick(e) {
  const list = getState().savedScenarios;
  const load = e.target.closest('[data-load]');
  const rename = e.target.closest('[data-rename]');
  const del = e.target.closest('[data-delete]');
  if (load) {
    const sc = list.find((s) => s.id === load.dataset.load);
    if (!sc) return;
    setPriceScenario(sc.productId, sc.baselinePrice, sc.scenarioPrice);
    setState({ forecastPeriod: sc.periodWeeks });
    if (sc.productId !== getState().selectedProductId) selectProduct(sc.productId);
    setPriceScenario(sc.productId, sc.baselinePrice, sc.scenarioPrice);
    initPrices();
    renderAll();
    el.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`Loaded “${sc.name}”.`, 'info');
  } else if (rename) {
    const sc = list.find((s) => s.id === rename.dataset.rename);
    const name = await promptDialog({ title: 'Rename scenario', label: 'Scenario name', value: sc.name, confirmLabel: 'Rename' });
    if (name) {
      setState({ savedScenarios: list.map((s) => (s.id === sc.id ? { ...s, name } : s)) });
      toast('Scenario renamed.');
    }
  } else if (del) {
    const sc = list.find((s) => s.id === del.dataset.delete);
    const ok = await confirmDialog({ title: 'Delete scenario?', message: `Delete “${sc.name}”? This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (ok) {
      selectedForCompare.delete(sc.id);
      setState({ savedScenarios: list.filter((s) => s.id !== sc.id) });
      toast('Scenario deleted.');
    }
  }
}

function compareSaved() {
  const items = getState().savedScenarios.filter((s) => selectedForCompare.has(s.id)).map((sc) => ({ sc, r: resultFor(sc), p: getProduct(sc.productId) })).filter((x) => x.r);
  if (items.length < 2) return toast('Select at least two scenarios to compare.', 'warning');
  const metric = (label, f) => `<tr><td>${label}</td>${items.map((x) => `<td class="num">${f(x)}</td>`).join('')}</tr>`;
  openModal({
    title: 'Compare saved scenarios',
    size: 'modal-lg',
    body: `<div class="table-scroll"><table class="simple-table compare-table"><thead><tr><th>Metric</th>${items.map((x) => `<th class="num">${escapeHtml(x.sc.name)}</th>`).join('')}</tr></thead><tbody>
      ${metric('Product', (x) => escapeHtml(x.p.productName))}
      ${metric('Forecast period', (x) => `${x.sc.periodWeeks} weeks`)}
      ${metric('Baseline → scenario price', (x) => `${fmtGBP(x.sc.baselinePrice)} → <strong>${fmtGBP(x.sc.scenarioPrice)}</strong>`)}
      ${metric('Scenario demand', (x) => `${fmtNum(x.r.scenario.totalPredictedDemand)} ${deltaChip(x.r.deltas.demand.pct)}`)}
      ${metric('Scenario units sold', (x) => fmtNum(x.r.scenario.expectedUnitsSold))}
      ${metric('Scenario revenue', (x) => `${fmtGBP(x.r.scenario.expectedRevenue)} ${deltaChip(x.r.deltas.revenue.pct)}`)}
      ${metric('Scenario gross profit', (x) => `<strong>${fmtGBP(x.r.scenario.expectedProfit)}</strong> ${deltaChip(x.r.deltas.profit.pct)}`)}
      ${metric('Profit change (£)', (x) => `${x.r.deltas.profit.abs >= 0 ? '+' : '−'}${fmtGBP(Math.abs(x.r.deltas.profit.abs))}`)}
    </tbody></table></div><div class="chart chart-sm" id="cmp-chart"></div>
    <p class="muted small">Scenarios with different products or periods are shown side by side; compare £ values with care when periods differ.</p>`,
    actions: [{ label: 'Close' }],
  });
  plot(document.getElementById('cmp-chart'), [
    { type: 'bar', name: 'Baseline gross profit', x: items.map((x) => x.sc.name), y: items.map((x) => x.r.baseline.expectedProfit), marker: { color: '#CBD5E1', cornerradius: 3 }, hovertemplate: '%{x}<br>Baseline £%{y:,.0f}<extra></extra>' },
    { type: 'bar', name: 'Scenario gross profit', x: items.map((x) => x.sc.name), y: items.map((x) => x.r.scenario.expectedProfit), marker: { color: COLORS.primary, cornerradius: 3 }, hovertemplate: '%{x}<br>Scenario £%{y:,.0f}<extra></extra>' },
  ], baseLayout({ barmode: 'group', margin: { t: 30, b: 50 }, yaxis: { tickprefix: '£', rangemode: 'tozero', tickformat: '~s' } }));
}
