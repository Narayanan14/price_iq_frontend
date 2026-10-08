// Collapsible left navigation (72px icon rail ↔ 240px labelled).

import { ROUTES } from '../router.js';
import { getState, setState, subscribe } from '../state.js';
import { icon, refreshIcons } from '../utils.js';
import { APP_VERSION } from '../data/seed-data.js';
import { openHelpModal } from './help.js';

export function initSidebar(el) {
  el.innerHTML = `
    <div class="sb-brand">
      <a href="#/overview" class="brand-mark" aria-label="PriceIQ home">${brandSvg()}</a>
      <div class="brand-text"><strong>PriceIQ</strong><span>Pricing Intelligence</span></div>
    </div>
    <button class="sb-toggle" aria-label="Expand sidebar" aria-expanded="false">${icon('panel-left-open')}</button>
    <nav class="sb-nav" aria-label="Primary">
      ${ROUTES.map((r) => `
        <a href="#/${r.id}" class="sb-link" data-route="${r.id}" data-tooltip="${r.label}" aria-label="${r.label}">
          ${icon(r.icon)}<span class="sb-label">${r.label}</span>
        </a>`).join('')}
    </nav>
    <div class="sb-bottom">
      <button class="sb-link" data-tooltip="Help & About" aria-label="Help and About" id="sb-help">${icon('circle-help')}<span class="sb-label">Help & About</span></button>
      <div class="sb-status" data-tooltip="Interactive prototype · ${APP_VERSION}">
        <span class="status-dot"></span>
        <span class="sb-label"><strong>Interactive Prototype</strong><small>Illustrative analytics · ${APP_VERSION}</small></span>
      </div>
    </div>`;

  const toggle = el.querySelector('.sb-toggle');
  const apply = () => {
    const { sidebarExpanded, currentPage } = getState();
    document.body.classList.toggle('sb-expanded', sidebarExpanded);
    toggle.setAttribute('aria-expanded', String(sidebarExpanded));
    toggle.setAttribute('aria-label', sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar');
    toggle.innerHTML = icon(sidebarExpanded ? 'panel-left-close' : 'panel-left-open');
    el.querySelectorAll('.sb-link[data-route]').forEach((a) => {
      const on = a.dataset.route === currentPage;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    refreshIcons();
  };
  toggle.addEventListener('click', () => setState({ sidebarExpanded: !getState().sidebarExpanded }));
  el.querySelector('#sb-help').addEventListener('click', openHelpModal);
  // Close the mobile drawer after navigating.
  el.querySelector('.sb-nav').addEventListener('click', () => document.body.classList.remove('mobile-nav-open'));
  subscribe(apply, ['sidebarExpanded', 'currentPage']);
  apply();
}

export function brandSvg() {
  return `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
    <defs><linearGradient id="bg-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4F46E5"/><stop offset="1" stop-color="#7C3AED"/></linearGradient></defs>
    <rect width="32" height="32" rx="9" fill="url(#bg-g)"/>
    <path d="M9 21.5 L14 15.5 L17.5 18.5 L23 11" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="23" cy="11" r="2.2" fill="#fff"/>
  </svg>`;
}
