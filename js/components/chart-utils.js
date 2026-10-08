// Plotly helpers: one visual system for every chart in the app.

import { escapeHtml } from '../utils.js';

export const COLORS = {
  primary: '#4F46E5',
  primaryDark: '#3730A3',
  primaryLight: '#A5B4FC',
  secondary: '#7C3AED',
  success: '#16A34A',
  danger: '#DC2626',
  warning: '#F59E0B',
  text: '#172033',
  muted: '#64748B',
  grid: '#EEF2F7',
  border: '#E7ECF3',
  baseline: '#94A3B8',
};

const FONT = 'Inter, system-ui, -apple-system, Segoe UI, sans-serif';

export function baseLayout(overrides = {}) {
  const { xaxis = {}, yaxis = {}, margin = {}, legend = {}, ...rest } = overrides;
  return {
    font: { family: FONT, size: 12, color: COLORS.muted },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { l: 56, r: 16, t: 12, b: 44, ...margin },
    hovermode: 'closest',
    hoverlabel: { bgcolor: '#FFFFFF', bordercolor: COLORS.border, font: { family: FONT, size: 12, color: COLORS.text }, align: 'left' },
    showlegend: true,
    legend: { orientation: 'h', x: 0, y: 1.12, xanchor: 'left', font: { size: 12, color: COLORS.text }, ...legend },
    xaxis: { gridcolor: COLORS.grid, linecolor: COLORS.border, zeroline: false, tickfont: { size: 11 }, automargin: true, ...xaxis },
    yaxis: { gridcolor: COLORS.grid, linecolor: 'rgba(0,0,0,0)', zeroline: false, tickfont: { size: 11 }, automargin: true, ...yaxis },
    bargap: 0.35,
    ...rest,
  };
}

// Resizing is handled by resizeCharts() below, so Plotly attaches no per-chart window listeners.
const CONFIG = { displayModeBar: false, responsive: false };
const tracked = new Set();

/** Render or update a chart in place (Plotly.react) with graceful failure. */
export function plot(el, traces, layout, config = {}) {
  if (!el) return;
  if (!window.Plotly) {
    el.innerHTML = '<div class="chart-error">Charts could not load (Plotly unavailable). Check your connection and reload.</div>';
    return;
  }
  try {
    el.querySelector(':scope > .chart-skeleton, :scope > .chart-error')?.remove();
    window.Plotly.react(el, traces, layout, { ...CONFIG, ...config });
    tracked.add(el);
  } catch (err) {
    console.error('Chart render failed', err);
    el.innerHTML = `<div class="chart-error">This chart could not be rendered. ${escapeHtml(err.message ?? '')}</div>`;
  }
}

/**
 * Stop tracking charts inside a container (called on page change). Charts are not purged:
 * Plotly may still have an async auto-margin redraw queued, and purging mid-redraw throws.
 * With responsive mode off, Plotly keeps no global references, so detached charts are
 * garbage-collected with their DOM nodes.
 */
export function purgeCharts(root) {
  for (const el of [...tracked]) {
    if (!root || root.contains(el) || !el.isConnected) tracked.delete(el);
  }
}

let resizeTimer;
export function resizeCharts() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    for (const el of tracked) {
      if (el.isConnected && el.offsetParent !== null) {
        try {
          window.Plotly?.Plots.resize(el);
        } catch {
          /* ignore */
        }
      }
    }
  }, 120);
}

window.addEventListener('resize', resizeCharts);

export const gbpTick = { tickprefix: '£', separatethousands: true };
