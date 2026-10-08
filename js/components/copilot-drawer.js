// Floating "Ask PriceIQ" button + right-side drawer. Reuses the shared chat component.

import { subscribe, getState } from '../state.js';
import { mountChat } from './copilot-chat.js';
import { icon, refreshIcons } from '../utils.js';

export function initCopilotDrawer() {
  const fab = document.createElement('button');
  fab.className = 'copilot-fab';
  fab.setAttribute('aria-label', 'Ask PriceIQ Copilot');
  fab.innerHTML = `${icon('sparkles')}<span>Ask PriceIQ</span>`;

  const drawer = document.createElement('aside');
  drawer.className = 'copilot-drawer';
  drawer.setAttribute('aria-label', 'PriceIQ Copilot');
  drawer.setAttribute('aria-hidden', 'true');
  drawer.innerHTML = `
    <div class="drawer-head">
      <div class="drawer-title"><span class="cp-avatar sm">${icon('sparkles')}</span><div><strong>PriceIQ Copilot</strong><small>Contextual assistant</small></div></div>
      <div class="drawer-tools">
        <a href="#/copilot" class="icon-btn" aria-label="Open full Copilot page" title="Open full page">${icon('maximize-2')}</a>
        <button class="icon-btn" data-close-drawer aria-label="Close Copilot">${icon('x')}</button>
      </div>
    </div>
    <div class="drawer-body"></div>`;
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  document.body.append(fab, backdrop, drawer);

  let chat = null;
  const open = () => {
    if (!chat) chat = mountChat(drawer.querySelector('.drawer-body'), { variant: 'drawer' });
    document.body.classList.add('drawer-open');
    drawer.setAttribute('aria-hidden', 'false');
    refreshIcons();
    setTimeout(() => chat.focus(), 200);
  };
  const close = () => {
    document.body.classList.remove('drawer-open');
    drawer.setAttribute('aria-hidden', 'true');
  };
  fab.addEventListener('click', open);
  backdrop.addEventListener('click', close);
  drawer.querySelector('[data-close-drawer]').addEventListener('click', close);
  drawer.querySelector('a[href="#/copilot"]').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) close();
  });
  // Hide the floating button on the full Copilot page.
  const sync = () => {
    const onPage = getState().currentPage === 'copilot';
    fab.hidden = onPage;
    if (onPage) close();
  };
  subscribe(sync, ['currentPage']);
  sync();
  refreshIcons();
}
