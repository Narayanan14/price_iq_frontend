// Small shared markup helpers for page scaffolding.

import { escapeHtml, icon } from '../utils.js';
import { FORECAST_PERIODS, FORECAST_START } from '../data/seed-data.js';
import { addDays } from '../data/data-generator.js';
import { fmtDate } from '../utils.js';

export function pageHeader(title, subtitle, actions = '') {
  return `
    <header class="page-header">
      <div>
        <h1 class="page-title">${escapeHtml(title)}</h1>
        <p class="page-subtitle">${escapeHtml(subtitle)}</p>
      </div>
      <div class="page-actions">${actions}</div>
    </header>`;
}

export function periodSelect(id, value, label = 'Forecast period') {
  return `<label class="field inline">
    <span class="field-label">${escapeHtml(label)}</span>
    <select class="select" id="${id}" aria-label="${escapeHtml(label)}">
      ${FORECAST_PERIODS.map((p) => `<option value="${p}" ${p === value ? 'selected' : ''}>${p} week${p > 1 ? 's' : ''}</option>`).join('')}
    </select>
  </label>`;
}

export function horizonText(weeks) {
  return `${fmtDate(FORECAST_START, { day: 'numeric', month: 'short' })} – ${fmtDate(addDays(FORECAST_START, weeks * 7 - 1), { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function cardHeader(title, sub = '', right = '') {
  return `<div class="card-header"><div><h2 class="card-title">${escapeHtml(title)}</h2>${sub ? `<p class="card-sub">${sub}</p>` : ''}</div>${right ? `<div class="card-tools">${right}</div>` : ''}</div>`;
}

export function insightList(items) {
  if (!items.length) return '<p class="muted">No insights for the current selection.</p>';
  return `<ul class="insight-list">${items.map((i) => `<li class="insight insight-${i.tone}">${icon(i.icon)}<span>${i.text}</span></li>`).join('')}</ul>`;
}

export function errorBox(message) {
  return `<div class="inline-error" role="alert">${icon('circle-alert')}<span>${escapeHtml(message)}</span></div>`;
}

export function segmented(id, options, value) {
  return `<div class="segmented" role="group" id="${id}">${options.map((o) => `<button type="button" data-value="${o.value}" class="${String(o.value) === String(value) ? 'active' : ''}" aria-pressed="${String(o.value) === String(value)}">${escapeHtml(o.label)}</button>`).join('')}</div>`;
}
