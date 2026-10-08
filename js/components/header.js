// Top header: breadcrumb, global product search, forecast horizon, notifications, avatar menu.

import { ROUTES, navigate } from '../router.js';
import { getState, setState, subscribe, resetPreferences } from '../state.js';
import { searchProducts } from '../services/product-service.js';
import { getNotifications } from '../services/analytics-service.js';
import { FORECAST_PERIODS, FORECAST_START } from '../data/seed-data.js';
import { escapeHtml, icon, debounce, refreshIcons, fmtGBP, fmtDate } from '../utils.js';
import { openHelpModal } from './help.js';
import { confirmDialog, toast } from './modal.js';

export function initHeader(el) {
  el.innerHTML = `
    <button class="icon-btn mobile-only" id="mobile-nav" aria-label="Open navigation">${icon('menu')}</button>
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="#/overview" aria-label="Home">${icon('house')}</a>
      ${icon('chevron-right', 'bc-sep')}
      <span class="bc-root">PriceIQ</span>
      ${icon('chevron-right', 'bc-sep')}
      <span class="bc-page" aria-current="page"></span>
    </nav>
    <div class="global-search" role="search">
      <div class="search-input">
        ${icon('search')}
        <input type="search" id="global-search" placeholder="Search products, insights, or SKU..." autocomplete="off" aria-label="Search products, insights, or SKU" aria-controls="gs-results" aria-expanded="false">
        <kbd class="kbd">/</kbd>
      </div>
      <div class="dropdown gs-results" id="gs-results" role="listbox" hidden></div>
    </div>
    <div class="header-actions">
      <label class="period-select" title="Forecast horizon used by every analytical page">
        ${icon('calendar-range')}
        <select id="global-period" aria-label="Forecast horizon">
          ${FORECAST_PERIODS.map((p) => `<option value="${p}">Next ${p} week${p > 1 ? 's' : ''}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="proto-badge" id="proto-badge" title="All data and predictions are synthetic and illustrative — click for methodology">${icon('flask-conical')}Interactive Prototype</button>
      <div class="menu-wrap">
        <button class="icon-btn" id="notif-btn" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">${icon('bell')}<span class="notif-dot" hidden></span></button>
        <div class="dropdown notif-panel" id="notif-panel" hidden></div>
      </div>
      <div class="menu-wrap">
        <button class="avatar" id="avatar-btn" aria-label="Workspace menu" aria-haspopup="true" aria-expanded="false">PA</button>
        <div class="dropdown avatar-menu" id="avatar-menu" hidden>
          <div class="am-head"><div class="avatar sm">PA</div><div><strong>Pricing Analyst</strong><small>Demo Workspace</small></div></div>
          <button class="menu-item" data-act="workspace">${icon('briefcase')}Demo Workspace</button>
          <button class="menu-item" data-act="about">${icon('info')}About PriceIQ</button>
          <button class="menu-item danger" data-act="reset">${icon('rotate-ccw')}Reset Demo Preferences</button>
        </div>
      </div>
    </div>`;

  // Breadcrumb + period sync
  const bc = el.querySelector('.bc-page');
  const periodSel = el.querySelector('#global-period');
  const sync = () => {
    const s = getState();
    bc.textContent = ROUTES.find((r) => r.id === s.currentPage)?.label ?? '';
    periodSel.value = String(s.forecastPeriod);
  };
  subscribe(sync, ['currentPage', 'forecastPeriod']);
  sync();
  periodSel.addEventListener('change', () => {
    setState({ forecastPeriod: Number(periodSel.value) });
    toast(`Forecast horizon set to ${periodSel.value} week${periodSel.value === '1' ? '' : 's'} from ${fmtDate(FORECAST_START)}`, 'info');
  });

  el.querySelector('#proto-badge').addEventListener('click', openHelpModal);
  el.querySelector('#mobile-nav').addEventListener('click', () => document.body.classList.toggle('mobile-nav-open'));

  initSearch(el);
  initNotifications(el);
  initAvatar(el);
}

function closeAllMenus(except) {
  document.querySelectorAll('.app-header .dropdown').forEach((d) => {
    if (d !== except) d.hidden = true;
  });
  document.querySelectorAll('.app-header [aria-expanded="true"]').forEach((b) => {
    if (!except || !b.parentElement.contains(except)) b.setAttribute('aria-expanded', 'false');
  });
}

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.menu-wrap') && !e.target.closest('.global-search')) closeAllMenus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllMenus();
  if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]')) {
    e.preventDefault();
    document.getElementById('global-search')?.focus();
  }
});

function initSearch(el) {
  const input = el.querySelector('#global-search');
  const box = el.querySelector('#gs-results');
  let results = [];
  let active = 0;

  const render = () => {
    const q = input.value.trim();
    if (!q) {
      box.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    results = searchProducts(q, 8);
    active = 0;
    box.innerHTML = results.length
      ? `<div class="dd-head">Products · opens in Price Optimization</div>` + results.map((p, i) => `
        <button class="gs-item ${i === 0 ? 'active' : ''}" role="option" data-id="${p.productId}">
          <span class="gs-icon">${icon('package')}</span>
          <span class="gs-text"><strong>${highlight(p.productName, q)}</strong><small>${escapeHtml(p.sku)} · ${escapeHtml(p.category)}</small></span>
          <span class="gs-price">${fmtGBP(p.currentPrice)}</span>
        </button>`).join('')
      : `<div class="dd-empty">${icon('search-x')}<span>No products match “${escapeHtml(q)}”. Try a product name, SKU (e.g. DRK-…) or category.</span></div>`;
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    refreshIcons();
  };
  const choose = (id) => {
    input.value = '';
    box.hidden = true;
    input.blur();
    navigate('optimization', { product: id });
  };
  input.addEventListener('input', debounce(render, 140));
  input.addEventListener('focus', () => input.value && render());
  input.addEventListener('keydown', (e) => {
    const items = box.querySelectorAll('.gs-item');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('active', i === active));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[active]) choose(results[active].productId);
    } else if (e.key === 'Escape') {
      box.hidden = true;
      input.blur();
    }
  });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.gs-item');
    if (b) choose(b.dataset.id);
  });
}

function highlight(text, q) {
  const safe = escapeHtml(text);
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return safe;
  return `${escapeHtml(text.slice(0, idx))}<mark>${escapeHtml(text.slice(idx, idx + q.length))}</mark>${escapeHtml(text.slice(idx + q.length))}`;
}

function initNotifications(el) {
  const btn = el.querySelector('#notif-btn');
  const panel = el.querySelector('#notif-panel');
  const dot = btn.querySelector('.notif-dot');

  const list = () => {
    const { forecastPeriod, dismissedNotifications } = getState();
    return getNotifications(forecastPeriod).filter((n) => !dismissedNotifications.includes(n.id));
  };
  const render = () => {
    const items = list();
    dot.hidden = items.length === 0;
    btn.setAttribute('aria-label', `Notifications (${items.length} unread)`);
    panel.innerHTML = `
      <div class="dd-head row-between"><span>Pricing alerts · next ${getState().forecastPeriod} wk</span>${items.length ? '<button class="link-btn" data-clear>Mark all read</button>' : ''}</div>
      ${items.length ? items.map((n) => `
        <div class="notif-item notif-${n.type}">
          <span class="notif-icon">${icon(n.icon)}</span>
          <button class="notif-body" data-open="${n.id}"><strong>${escapeHtml(n.title)}</strong><span>${escapeHtml(n.text)}</span></button>
          <button class="icon-btn xs" data-dismiss="${n.id}" aria-label="Dismiss notification">${icon('x')}</button>
        </div>`).join('') : `<div class="dd-empty">${icon('bell-off')}<span>You're all caught up. Alerts are recomputed from the pricing engine for the selected horizon.</span></div>`}
      <div class="dd-foot muted small">Alerts are illustrative and computed from synthetic data.</div>`;
    refreshIcons();
  };
  btn.addEventListener('click', () => {
    const willOpen = panel.hidden;
    closeAllMenus(panel);
    panel.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) render();
  });
  panel.addEventListener('click', (e) => {
    const dismiss = e.target.closest('[data-dismiss]');
    const open = e.target.closest('[data-open]');
    const s = getState();
    if (dismiss) {
      setState({ dismissedNotifications: [...s.dismissedNotifications, dismiss.dataset.dismiss] });
      render();
    } else if (e.target.closest('[data-clear]')) {
      setState({ dismissedNotifications: [...s.dismissedNotifications, ...list().map((n) => n.id)] });
      render();
    } else if (open) {
      const n = list().find((x) => x.id === open.dataset.open);
      panel.hidden = true;
      if (n) navigate(n.route, { product: n.productId });
    }
  });
  subscribe(render, ['forecastPeriod', 'dismissedNotifications']);
  render();
}

function initAvatar(el) {
  const btn = el.querySelector('#avatar-btn');
  const menu = el.querySelector('#avatar-menu');
  btn.addEventListener('click', () => {
    const willOpen = menu.hidden;
    closeAllMenus(menu);
    menu.hidden = !willOpen;
    btn.setAttribute('aria-expanded', String(willOpen));
  });
  menu.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (act === 'workspace') toast('You are in the Demo Workspace — a single synthetic retailer with 220 products.', 'info');
    if (act === 'about') openHelpModal();
    if (act === 'reset') {
      const ok = await confirmDialog({ title: 'Reset demo preferences?', message: 'This resets the sidebar, selected product, horizon, dismissed alerts and the Copilot conversation. Saved scenarios are kept.', confirmLabel: 'Reset', danger: true });
      if (ok) {
        resetPreferences();
        setState({ forecastPeriod: 4 });
        window.dispatchEvent(new CustomEvent('priceiq:copilot-reset'));
        navigate('overview');
        toast('Demo preferences reset.');
      }
    }
  });
}
