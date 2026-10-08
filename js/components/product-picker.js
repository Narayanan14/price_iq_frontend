// Searchable product selector (combobox) shared by every analytical page.

import { getProducts, getProduct, searchProducts, getFeaturedProducts } from '../services/product-service.js';
import { escapeHtml, icon, debounce, refreshIcons, fmtGBP } from '../utils.js';

let pickerSeq = 0;

export function createProductPicker(container, { value, onChange, label = 'Product' }) {
  const id = `pp-${++pickerSeq}`;
  container.classList.add('product-picker');
  container.innerHTML = `
    <span class="field-label" id="${id}-label">${escapeHtml(label)}</span>
    <button type="button" class="picker-btn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${id}-label ${id}-value">
      <span class="picker-value" id="${id}-value"></span>${icon('chevrons-up-down', 'picker-chevron')}
    </button>
    <div class="picker-pop" role="dialog" aria-label="Choose product" hidden>
      <div class="search-input sm">${icon('search')}<input type="search" placeholder="Search name, SKU or category…" aria-label="Search products" autocomplete="off"></div>
      <ul class="picker-list" role="listbox" id="${id}-list"></ul>
    </div>`;
  const btn = container.querySelector('.picker-btn');
  const pop = container.querySelector('.picker-pop');
  const input = pop.querySelector('input');
  const list = pop.querySelector('.picker-list');
  let current = value;
  let items = [];
  let active = 0;

  const renderValue = () => {
    const p = getProduct(current);
    container.querySelector('.picker-value').innerHTML = p
      ? `<span class="pv-name">${escapeHtml(p.productName)}</span><span class="pv-meta">${escapeHtml(p.sku)} · ${escapeHtml(p.category)}</span>`
      : '<span class="pv-name muted">Select a product</span>';
  };

  const renderList = () => {
    const q = input.value.trim();
    if (q) items = searchProducts(q, 40);
    else {
      const featured = getFeaturedProducts();
      items = [...featured, ...getProducts().filter((p) => !p.featured).slice(0, 40)];
    }
    active = Math.max(0, items.findIndex((p) => p.productId === current));
    if (!items.length) {
      list.innerHTML = `<li class="picker-empty">No products match “${escapeHtml(q)}”.</li>`;
      return;
    }
    list.innerHTML = items.map((p, i) => `
      <li role="option" id="${id}-opt-${i}" data-id="${p.productId}" aria-selected="${p.productId === current}" class="${i === active ? 'active' : ''}">
        <div class="po-main"><span class="po-name">${escapeHtml(p.productName)}</span>${p.featured ? '<span class="mini-tag">Featured</span>' : ''}</div>
        <div class="po-meta">${escapeHtml(p.sku)} · ${escapeHtml(p.category)} · ${fmtGBP(p.currentPrice)}</div>
      </li>`).join('') + (q ? '' : `<li class="picker-hint">Showing featured + first 40 of ${getProducts().length}. Type to search all.</li>`);
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };

  const open = () => {
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    input.value = '';
    renderList();
    refreshIcons();
    input.focus();
    document.addEventListener('mousedown', outside);
  };
  const close = (focusBtn = false) => {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', outside);
    if (focusBtn) btn.focus();
  };
  const outside = (e) => {
    if (!container.contains(e.target)) close();
  };
  const choose = (pid) => {
    close(true);
    if (pid && pid !== current) {
      current = pid;
      renderValue();
      onChange?.(pid);
    }
  };
  const highlight = (i) => {
    const lis = list.querySelectorAll('li[data-id]');
    if (!lis.length) return;
    active = (i + lis.length) % lis.length;
    lis.forEach((li, k) => li.classList.toggle('active', k === active));
    lis[active].scrollIntoView({ block: 'nearest' });
  };

  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
  input.addEventListener('input', debounce(renderList, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const li = list.querySelectorAll('li[data-id]')[active]; if (li) choose(li.dataset.id); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(true); }
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) choose(li.dataset.id);
  });

  renderValue();
  return {
    setValue(pid) {
      current = pid;
      renderValue();
    },
    destroy() {
      document.removeEventListener('mousedown', outside);
    },
  };
}
