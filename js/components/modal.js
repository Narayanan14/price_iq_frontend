// Modal dialogs, confirmations and toast notifications.

import { escapeHtml, icon, refreshIcons } from '../utils.js';

let lastFocus = null;

/**
 * Open a modal. actions: [{ label, variant, onClick(close) }]
 * Returns a close() function.
 */
export function openModal({ title, body, actions = [], size = '' }) {
  closeModal();
  lastFocus = document.activeElement;
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-header">
        <h2 id="modal-title">${escapeHtml(title)}</h2>
        <button class="icon-btn" data-close aria-label="Close dialog">${icon('x')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${actions.length ? `<div class="modal-footer">${actions.map((a, i) => `<button class="btn ${a.variant ?? 'btn-secondary'}" data-action="${i}">${escapeHtml(a.label)}</button>`).join('')}</div>` : ''}
    </div>`;
  root.classList.add('open');
  refreshIcons();
  const close = () => closeModal();
  root.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
  root.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', () => {
      const a = actions[Number(el.dataset.action)];
      if (a?.onClick) a.onClick(close);
      else close();
    });
  });
  const focusable = root.querySelector('.modal-body input, .modal-footer .btn-primary, .modal-footer .btn, .modal-header .icon-btn');
  focusable?.focus();
  return close;
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (!root || !root.classList.contains('open')) return;
  root.classList.remove('open');
  root.innerHTML = '';
  lastFocus?.focus?.();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (v) => {
      if (!resolved) {
        resolved = true;
        resolve(v);
      }
    };
    openModal({
      title,
      size: 'modal-sm',
      body: `<p class="modal-text">${escapeHtml(message)}</p>`,
      actions: [
        { label: 'Cancel', variant: 'btn-secondary', onClick: (close) => { done(false); close(); } },
        { label: confirmLabel, variant: danger ? 'btn-danger' : 'btn-primary', onClick: (close) => { done(true); close(); } },
      ],
    });
    const root = document.getElementById('modal-root');
    root.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => done(false)));
  });
}

export function promptDialog({ title, label, value = '', confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    openModal({
      title,
      size: 'modal-sm',
      body: `<label class="field"><span class="field-label">${escapeHtml(label)}</span><input class="input" id="prompt-input" maxlength="60" value="${escapeHtml(value)}"></label>`,
      actions: [
        { label: 'Cancel', onClick: (close) => { resolve(null); close(); } },
        {
          label: confirmLabel,
          variant: 'btn-primary',
          onClick: (close) => {
            const v = document.getElementById('prompt-input').value.trim();
            resolve(v || null);
            close();
          },
        },
      ],
    });
    const input = document.getElementById('prompt-input');
    input?.select();
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.querySelector('#modal-root .btn-primary')?.click();
    });
  });
}

/** Toast notification. type: success | error | info | warning */
export function toast(message, type = 'success', timeout = 3200) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const icons = { success: 'circle-check', error: 'circle-alert', info: 'info', warning: 'triangle-alert' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(icons[type] ?? 'info')}<span>${escapeHtml(message)}</span>`;
  root.appendChild(el);
  refreshIcons();
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, timeout);
}
