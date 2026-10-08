// Page 6 — PriceIQ Copilot (guided demo). Uses the shared chat component and engine.

import { getState, subscribe } from '../state.js';
import { navigate } from '../router.js';
import { getProduct } from '../services/product-service.js';
import { optimizePrice } from '../services/optimization-service.js';
import { INTENTS } from '../services/copilot-service.js';
import { mountChat } from '../components/copilot-chat.js';
import { pageHeader, cardHeader } from '../components/ui.js';
import { statusBadge } from '../components/kpi-card.js';
import { escapeHtml, icon, fmtGBP, fmtPct, refreshIcons } from '../utils.js';

let el;
let chat;
let unsub = [];

export default {
  mount(container) {
    el = container;
    el.innerHTML = `
      ${pageHeader('PriceIQ Copilot', 'Explore pricing insights through natural-language interaction.')}
      <div class="copilot-layout">
        <section class="card chat-card" id="cp-chat"></section>
        <aside class="stack">
          <section class="card">
            ${cardHeader('Active context')}
            <div id="cp-context"></div>
          </section>
          <section class="card">
            ${cardHeader('Supported intents')}
            <div class="intent-tags">${INTENTS.map((i) => `<span class="intent-tag">${i}</span>`).join('')}</div>
          </section>
        </aside>
      </div>`;
    chat = mountChat(el.querySelector('#cp-chat'), { variant: 'page' });
    el.querySelector('#cp-context').addEventListener('click', (e) => {
      const b = e.target.closest('[data-goto]');
      if (b) navigate(b.dataset.goto, { product: getState().copilotContext.productId });
    });
    unsub.push(subscribe(renderContext, ['copilotContext', 'forecastPeriod']));
    renderContext();
    chat.focus();
  },
  unmount() {
    unsub.forEach((u) => u());
    unsub = [];
    chat?.destroy();
    el = null;
  },
};

function renderContext() {
  if (!el) return;
  const s = getState();
  const p = getProduct(s.copilotContext?.productId);
  if (!p) {
    el.querySelector('#cp-context').innerHTML = '<p class="muted">No product selected.</p>';
    return;
  }
  const opt = optimizePrice(p.productId, s.forecastPeriod);
  el.querySelector('#cp-context').innerHTML = `
    <div class="ctx-product">
      <strong>${escapeHtml(p.productName)}</strong>
      <span class="muted small">${escapeHtml(p.sku)} · ${escapeHtml(p.category)}</span>
    </div>
    <dl class="ctx-grid">
      <div><dt>Current price</dt><dd>${fmtGBP(opt.currentPrice)}</dd></div>
      <div><dt>Recommended</dt><dd class="accent">${fmtGBP(opt.recommendedPrice)}</dd></div>
      <div><dt>Profit uplift</dt><dd>${fmtPct(opt.expectedProfitUplift, 1, true)}</dd></div>
      <div><dt>Horizon</dt><dd>${s.forecastPeriod} week${s.forecastPeriod > 1 ? 's' : ''}</dd></div>
    </dl>
    <div class="cp-badges">${statusBadge(opt.status)}</div>
    <button class="btn btn-secondary btn-sm btn-block" data-goto="optimization">${icon('target')}Open in Price Optimization</button>`;
  refreshIcons();
}
