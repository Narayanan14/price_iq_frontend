// PriceIQ application bootstrap.

import { initRouter } from './router.js';
import { initSidebar } from './components/sidebar.js';
import { initHeader } from './components/header.js';
import { initCopilotDrawer } from './components/copilot-drawer.js';
import { toast } from './components/modal.js';
import { resizeCharts } from './components/chart-utils.js';
import { subscribe } from './state.js';
import { refreshIcons } from './utils.js';

import overview from './pages/overview.js';
import forecast from './pages/forecast.js';
import optimization from './pages/optimization.js';
import simulator from './pages/simulator.js';
import customers from './pages/customers.js';
import copilot from './pages/copilot.js';

function boot() {
  initSidebar(document.getElementById('sidebar'));
  initHeader(document.getElementById('header'));
  initCopilotDrawer();
  initRouter({ overview, forecast, optimization, simulator, customers, copilot }, document.getElementById('view'));

  // Charts need a resize after the sidebar width transition finishes.
  subscribe(() => setTimeout(resizeCharts, 260), ['sidebarExpanded']);
  window.addEventListener('priceiq:storage-error', () => toast('Could not save to browser storage — changes will last for this session only.', 'warning'));
  document.getElementById('boot-loader')?.remove();
  refreshIcons();
}

try {
  boot();
} catch (err) {
  console.error(err);
  const view = document.getElementById('view');
  if (view) view.innerHTML = '<div class="card empty-state"><h3>PriceIQ could not start</h3><p>Please reload the page. If the problem persists, check your internet connection (charts and icons load from public CDNs).</p></div>';
  document.getElementById('boot-loader')?.remove();
}
