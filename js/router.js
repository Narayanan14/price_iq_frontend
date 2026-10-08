// Hash-based client-side router (#/overview, #/optimization?product=P0001).
// Works under any GitHub Pages sub-path and supports browser back/forward.

import { setState, selectProduct, getState } from './state.js';
import { refreshIcons } from './utils.js';
import { purgeCharts } from './components/chart-utils.js';

export const ROUTES = [
  { id: 'overview', label: 'Executive Overview', icon: 'layout-dashboard' },
  { id: 'forecast', label: 'Demand Forecasting', icon: 'chart-line' },
  { id: 'optimization', label: 'Price Optimization', icon: 'target' },
  { id: 'simulator', label: 'What-If Simulator', icon: 'sliders-horizontal' },
  { id: 'customers', label: 'Customer Intelligence', icon: 'users' },
  { id: 'copilot', label: 'GenAI Pricing Copilot', icon: 'sparkles' },
];

let pages = {};
let current = null;
let viewEl = null;

export function parseHash(hash = window.location.hash) {
  const clean = hash.replace(/^#\/?/, '');
  const [path, query = ''] = clean.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  const id = ROUTES.some((r) => r.id === path) ? path : 'overview';
  return { id, params };
}

/** Navigate to a page, optionally selecting a product first. */
export function navigate(id, params = {}) {
  if (params.product) selectProduct(params.product);
  const qs = new URLSearchParams(params).toString();
  const target = `#/${id}${qs ? `?${qs}` : ''}`;
  if (window.location.hash === target) render();
  else window.location.hash = target;
}

function render() {
  const { id, params } = parseHash();
  if (params.product) selectProduct(params.product);
  const page = pages[id];
  if (current?.page?.unmount) {
    try {
      current.page.unmount();
    } catch (err) {
      console.error('Unmount failed', err);
    }
  }
  purgeCharts(viewEl);
  viewEl.innerHTML = '';
  viewEl.classList.remove('view-enter');
  void viewEl.offsetWidth;
  viewEl.classList.add('view-enter');
  setState({ currentPage: id });
  const route = ROUTES.find((r) => r.id === id);
  document.title = `${route.label} · PriceIQ`;
  current = { id, page };
  try {
    page.mount(viewEl, { params, state: getState() });
  } catch (err) {
    console.error(err);
    viewEl.innerHTML = `<div class="card empty-state"><h3>Something went wrong rendering this page</h3><p>Please try another page or reload. The issue has been logged to the browser console.</p></div>`;
  }
  refreshIcons();
  document.querySelector('.main')?.scrollTo({ top: 0 });
  window.scrollTo({ top: 0 });
}

export function initRouter(pageMap, el) {
  pages = pageMap;
  viewEl = el;
  window.addEventListener('hashchange', render);
  if (!window.location.hash) history.replaceState(null, '', '#/overview');
  render();
}

export function currentRouteId() {
  return current?.id ?? 'overview';
}
