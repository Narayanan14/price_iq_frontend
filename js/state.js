// Lightweight centralised store. Pages read and write shared selections here
// instead of keeping duplicated local state.

import { storage, round2 } from './utils.js';
import { DEFAULT_PERIOD, FORECAST_PERIODS } from './data/seed-data.js';
import { DEFAULT_PRODUCT_ID, getProduct } from './services/product-service.js';

const LS = { sidebar: 'priceiq.sidebarExpanded', scenarios: 'priceiq.savedScenarios', dismissed: 'priceiq.dismissedNotifications' };
const SS = { selection: 'priceiq.selection' };

const savedSelection = storage.get(SS.selection, {}, 'session');
const initialProduct = getProduct(savedSelection.selectedProductId) ? savedSelection.selectedProductId : DEFAULT_PRODUCT_ID;

const state = {
  currentPage: 'overview',
  selectedProductId: initialProduct,
  forecastPeriod: FORECAST_PERIODS.includes(savedSelection.forecastPeriod) ? savedSelection.forecastPeriod : DEFAULT_PERIOD,
  selectedCategory: 'All',
  sidebarExpanded: storage.get(LS.sidebar, false) === true,
  currentPriceScenario: savedSelection.currentPriceScenario ?? null,
  savedScenarios: sanitiseScenarios(storage.get(LS.scenarios, [])),
  copilotContext: { productId: initialProduct },
  dismissedNotifications: storage.get(LS.dismissed, []),
};

function sanitiseScenarios(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((s) => s && typeof s.id === 'string' && getProduct(s.productId) && Number.isFinite(s.baselinePrice) && Number.isFinite(s.scenarioPrice));
}

const listeners = new Set();

export function getState() {
  return state;
}

/** Update state and notify subscribers with the list of changed keys. */
export function setState(patch) {
  const changed = [];
  for (const [k, v] of Object.entries(patch)) {
    if (state[k] !== v) {
      state[k] = v;
      changed.push(k);
    }
  }
  if (!changed.length) return;
  persist(changed);
  listeners.forEach((fn) => {
    try {
      fn(state, changed);
    } catch (err) {
      console.error('State listener failed', err);
    }
  });
}

/** Subscribe to changes. Optional keys filter. Returns an unsubscribe function. */
export function subscribe(fn, keys = null) {
  const wrapped = (s, changed) => {
    if (!keys || changed.some((k) => keys.includes(k))) fn(s, changed);
  };
  listeners.add(wrapped);
  return () => listeners.delete(wrapped);
}

function persist(changed) {
  if (changed.includes('sidebarExpanded')) storage.set(LS.sidebar, state.sidebarExpanded);
  if (changed.includes('savedScenarios')) {
    if (!storage.set(LS.scenarios, state.savedScenarios)) window.dispatchEvent(new CustomEvent('priceiq:storage-error'));
  }
  if (changed.includes('dismissedNotifications')) storage.set(LS.dismissed, state.dismissedNotifications);
  if (changed.some((k) => ['selectedProductId', 'forecastPeriod', 'currentPriceScenario'].includes(k))) {
    storage.set(SS.selection, { selectedProductId: state.selectedProductId, forecastPeriod: state.forecastPeriod, currentPriceScenario: state.currentPriceScenario }, 'session');
  }
}

/** Select a product everywhere (pages + Copilot context). */
export function selectProduct(productId) {
  if (!getProduct(productId)) return false;
  const patch = { selectedProductId: productId, copilotContext: { productId } };
  if (state.currentPriceScenario && state.currentPriceScenario.productId !== productId) patch.currentPriceScenario = null;
  setState(patch);
  return true;
}

export function setPriceScenario(productId, baselinePrice, scenarioPrice) {
  setState({ currentPriceScenario: { productId, baselinePrice: round2(baselinePrice), scenarioPrice: round2(scenarioPrice) } });
}

export function resetPreferences() {
  storage.remove(LS.sidebar);
  storage.remove(LS.dismissed);
  storage.remove(SS.selection, 'session');
  storage.remove('priceiq.copilot', 'session');
  setState({ sidebarExpanded: false, dismissedNotifications: [], selectedProductId: DEFAULT_PRODUCT_ID, copilotContext: { productId: DEFAULT_PRODUCT_ID }, currentPriceScenario: null, selectedCategory: 'All' });
}
