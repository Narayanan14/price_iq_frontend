// KPI card markup helpers.

import { escapeHtml, icon, fmtPct, signClass } from '../utils.js';

/**
 * @param {object} o
 * @param {string} o.label
 * @param {string} o.value      pre-formatted main value
 * @param {string} [o.icon]     lucide icon name
 * @param {string} [o.sub]      secondary line (HTML allowed)
 * @param {number} [o.delta]    % change for the trend chip
 * @param {boolean} [o.invertDelta] treat decreases as good
 * @param {string} [o.tag]      small label e.g. "Historical" / "Illustrative"
 * @param {string} [o.tone]     accent tone class
 * @param {string} [o.title]    tooltip text
 */
export function kpiCard(o) {
  const deltaHtml = o.delta == null || !Number.isFinite(o.delta)
    ? ''
    : `<span class="trend trend-${signClass(o.delta, o.invertDelta)}">${icon(o.delta >= 0 ? 'trending-up' : 'trending-down')}${fmtPct(o.delta, 1, true)}</span>`;
  return `
    <div class="kpi-card ${o.tone ? `kpi-${o.tone}` : ''}" ${o.title ? `title="${escapeHtml(o.title)}"` : ''}>
      <div class="kpi-top">
        <span class="kpi-label">${escapeHtml(o.label)}</span>
        ${o.icon ? `<span class="kpi-icon">${icon(o.icon)}</span>` : ''}
      </div>
      <div class="kpi-value-row"><div class="kpi-value">${o.value}</div>${deltaHtml}</div>
      ${o.sub ? `<div class="kpi-sub">${o.sub}</div>` : ''}
      ${o.tag ? `<span class="kpi-tag">${escapeHtml(o.tag)}</span>` : ''}
    </div>`;
}

export function statusBadge(status) {
  const map = {
    'High Opportunity': 'badge-high',
    'Moderate Opportunity': 'badge-moderate',
    'Near Optimal': 'badge-optimal',
    'Inventory Constrained': 'badge-inventory',
    Active: 'badge-optimal',
    'Low Stock': 'badge-inventory',
    Seasonal: 'badge-moderate',
  };
  return `<span class="badge ${map[status] ?? 'badge-neutral'}">${escapeHtml(status)}</span>`;
}

export function deltaChip(pct, { invert = false, dp = 1 } = {}) {
  if (pct == null || !Number.isFinite(pct)) return '<span class="delta delta-neutral">—</span>';
  return `<span class="delta delta-${signClass(pct, invert)}">${fmtPct(pct, dp, true)}</span>`;
}

export function skeletonCards(n = 4) {
  return Array.from({ length: n }, () => '<div class="kpi-card skeleton"><div class="sk-line w40"></div><div class="sk-line w60 tall"></div><div class="sk-line w80"></div></div>').join('');
}
