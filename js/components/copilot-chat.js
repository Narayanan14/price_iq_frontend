// Copilot chat UI. ONE conversation store + renderer, mounted by both the full
// Copilot page and the contextual drawer, so there is a single chat implementation.

import { respond, SUGGESTED_QUESTIONS } from '../services/copilot-service.js';
import { getProduct } from '../services/product-service.js';
import { getState, selectProduct, setPriceScenario, setState, subscribe } from '../state.js';
import { navigate } from '../router.js';
import { escapeHtml, icon, refreshIcons, storage, fmtTime, fmtPct, signClass } from '../utils.js';
import { statusBadge } from './kpi-card.js';
import { createProductPicker } from './product-picker.js';
import { toast } from './modal.js';

const KEY = 'priceiq.copilot';
const conversation = {
  messages: storage.get(KEY, [], 'session'),
  typing: false,
};
const views = new Set();

function save() {
  storage.set(KEY, conversation.messages.slice(-60), 'session');
}
function notify() {
  views.forEach((v) => v.render());
}

window.addEventListener('priceiq:copilot-reset', () => {
  conversation.messages = [];
  conversation.typing = false;
  save();
  notify();
});

function welcome() {
  const p = getProduct(getState().copilotContext?.productId);
  return {
    role: 'assistant',
    ts: Date.now(),
    blocks: [{ type: 'text', html: `Hi — I'm the PriceIQ Copilot (guided demo). I answer using the same pricing engine as every page.${p ? ` I'm currently looking at <strong>${escapeHtml(p.productName)}</strong>.` : ''} Ask about recommended prices, price changes, customer segments or portfolio opportunities.` }],
    followUps: SUGGESTED_QUESTIONS.slice(0, 3),
  };
}

export function sendMessage(text) {
  const msg = String(text ?? '').trim();
  if (!msg || conversation.typing) return;
  if (msg.length > 500) {
    toast('Please keep questions under 500 characters.', 'warning');
    return;
  }
  const s = getState();
  conversation.messages.push({ role: 'user', ts: Date.now(), text: msg });
  conversation.typing = true;
  save();
  notify();
  // Short, honest delay for the typing indicator — computation itself is instant.
  setTimeout(() => {
    const res = respond(msg, { productId: s.copilotContext?.productId ?? s.selectedProductId, periodWeeks: getState().forecastPeriod });
    if (res.productId && res.productId !== getState().copilotContext?.productId && getProduct(res.productId)) selectProduct(res.productId);
    conversation.messages.push({ role: 'assistant', ts: Date.now(), blocks: res.blocks, followUps: res.followUps ?? [], intent: res.intent, period: getState().forecastPeriod });
    conversation.typing = false;
    save();
    notify();
  }, 550);
}

function renderBlock(b) {
  switch (b.type) {
    case 'text':
      return `<p>${b.html}</p>`;
    case 'list':
      return `<ul class="cp-list">${b.items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
    case 'compare':
      return `<div class="cp-card"><div class="cp-card-title">${escapeHtml(b.title)}</div>
        <table class="cp-table"><thead><tr><th></th><th class="num">${escapeHtml(b.a)}</th><th class="num">${escapeHtml(b.b)}</th><th class="num">Change</th></tr></thead>
        <tbody>${b.rows.map(([l, x, y, d]) => `<tr><td>${escapeHtml(l)}</td><td class="num">${x}</td><td class="num strong">${y}</td><td class="num"><span class="delta delta-${signClass(d)}">${fmtPct(d, 1, true)}</span></td></tr>`).join('')}</tbody></table></div>`;
    case 'table':
      return `<div class="cp-card"><table class="cp-table"><thead><tr>${b.columns.map((c, i) => `<th class="${b.align?.[i] === 'r' ? 'num' : ''}">${escapeHtml(c)}</th>`).join('')}</tr></thead>
        <tbody>${b.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${b.align?.[i] === 'r' ? 'num' : ''}">${typeof c === 'object' && c && 'delta' in c ? `<span class="delta delta-${signClass(c.delta)}">${fmtPct(c.delta, 1, true)}</span>` : c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    case 'products':
      return `<div class="cp-card cp-products">${b.rows.map((r, i) => `
        <button class="cp-product" data-goto="optimization" data-product="${r.productId}">
          <span class="cp-rank">${i + 1}</span>
          <span class="cp-pname"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.meta)}</small></span>
          <span class="cp-pprice">${r.from} → <strong>${r.to}</strong></span>
          <span class="delta delta-pos">${fmtPct(r.uplift, 1, true)}</span>
        </button>`).join('')}</div>`;
    case 'badge':
      return `<div class="cp-badges">${statusBadge(b.status)}${b.note ? statusBadge('Inventory Constrained') : ''}</div>`;
    case 'actions':
      return `<div class="cp-actions">${b.actions.map((a) => `<button class="btn btn-secondary btn-xs" data-goto="${a.route}" ${a.productId ? `data-product="${a.productId}"` : ''} ${a.scenario ? `data-scenario="${a.scenario.join(',')}"` : ''} ${a.category ? `data-category="${escapeHtml(a.category)}"` : ''}>${escapeHtml(a.label)}${icon('arrow-right')}</button>`).join('')}</div>`;
    default:
      return '';
  }
}

function renderMessage(m, isLast) {
  if (m.role === 'user') {
    return `<div class="msg msg-user"><div class="bubble">${escapeHtml(m.text)}</div><time>${fmtTime(m.ts)}</time></div>`;
  }
  return `<div class="msg msg-assistant">
    <div class="cp-avatar" aria-hidden="true">${icon('sparkles')}</div>
    <div class="msg-body">
      <div class="bubble">${m.blocks.map(renderBlock).join('')}
        <button class="copy-btn" data-copy aria-label="Copy response">${icon('copy')}</button>
      </div>
      <time>${fmtTime(m.ts)}${m.period ? ` · ${m.period}-week horizon` : ''}</time>
      ${isLast && m.followUps?.length ? `<div class="followups">${m.followUps.map((q) => `<button class="chip" data-ask="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div>` : ''}
    </div>
  </div>`;
}

/**
 * Mount a chat view. variant: 'page' | 'drawer'.
 */
export function mountChat(container, { variant = 'page' } = {}) {
  container.classList.add('chat', `chat-${variant}`);
  container.innerHTML = `
    <div class="chat-context">
      <div class="ctx-picker"></div>
      <span class="guided-tag" title="Rule-based demo — no LLM connected">${icon('route')}Guided Copilot Demo</span>
      <button class="icon-btn" data-clear aria-label="Clear conversation" title="Clear conversation">${icon('trash-2')}</button>
    </div>
    <div class="chat-log" role="log" aria-live="polite" aria-label="Copilot conversation"></div>
    <div class="chat-suggest">${SUGGESTED_QUESTIONS.map((q) => `<button class="chip" data-ask="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}</div>
    <form class="chat-input">
      <input type="text" maxlength="500" placeholder="Ask about pricing, scenarios or segments…" aria-label="Message the Copilot">
      <button class="btn btn-primary btn-icon" type="submit" aria-label="Send message">${icon('send-horizontal')}</button>
    </form>`;

  const log = container.querySelector('.chat-log');
  const input = container.querySelector('.chat-input input');
  const picker = createProductPicker(container.querySelector('.ctx-picker'), {
    value: getState().copilotContext?.productId,
    label: 'Product context',
    onChange: (pid) => {
      selectProduct(pid);
      toast(`Copilot context: ${getProduct(pid).productName}`, 'info');
    },
  });

  const view = {
    render() {
      const msgs = conversation.messages.length ? conversation.messages : [welcome()];
      log.innerHTML = msgs.map((m, i) => renderMessage(m, i === msgs.length - 1 && !conversation.typing)).join('') +
        (conversation.typing ? `<div class="msg msg-assistant"><div class="cp-avatar">${icon('sparkles')}</div><div class="bubble typing" aria-label="Copilot is typing"><span></span><span></span><span></span></div></div>` : '');
      container.querySelector('.chat-suggest').classList.toggle('compact', conversation.messages.length > 0);
      container.querySelector('.chat-input button').disabled = conversation.typing;
      refreshIcons();
      log.scrollTop = log.scrollHeight;
    },
  };
  views.add(view);

  container.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = '';
    sendMessage(v);
  });
  container.addEventListener('click', async (e) => {
    const ask = e.target.closest('[data-ask]');
    if (ask) return sendMessage(ask.dataset.ask);
    if (e.target.closest('[data-clear]')) {
      conversation.messages = [];
      save();
      notify();
      toast('Conversation cleared.', 'info');
      return;
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const text = copy.closest('.bubble').innerText.trim();
      try {
        await navigator.clipboard.writeText(text);
        copy.innerHTML = icon('check');
        refreshIcons();
        toast('Response copied to clipboard.');
        setTimeout(() => { copy.innerHTML = icon('copy'); refreshIcons(); }, 1500);
      } catch {
        toast('Clipboard access is not available in this browser.', 'error');
      }
      return;
    }
    const go = e.target.closest('[data-goto]');
    if (go) {
      const pid = go.dataset.product;
      if (go.dataset.scenario && pid) {
        const [a, b] = go.dataset.scenario.split(',').map(Number);
        setPriceScenario(pid, a, b);
      }
      if (go.dataset.category) setState({ selectedCategory: go.dataset.category });
      document.body.classList.remove('drawer-open');
      navigate(go.dataset.goto, pid ? { product: pid } : {});
    }
  });

  const unsub = subscribe((s) => picker.setValue(s.copilotContext?.productId), ['copilotContext']);
  view.render();
  return {
    focus: () => input.focus(),
    destroy() {
      views.delete(view);
      unsub();
      picker.destroy();
    },
  };
}
