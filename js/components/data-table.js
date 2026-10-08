// Reusable enterprise data table: search, sort, pagination, CSV export, row actions.

import { escapeHtml, icon, debounce, downloadCSV, refreshIcons } from '../utils.js';
import { toast } from './modal.js';

export class DataTable {
  /**
   * @param {HTMLElement} container
   * @param {object} opts
   *  columns: [{ key, label, align, sortable, render(row), value(row), csv(row), width, className }]
   *  rows, pageSize, searchKeys, searchPlaceholder, exportName, toolbarExtra (html),
   *  onAction(action, row, el), rowClass(row), initialSort {key, dir}, toolbar (bool), emptyMessage
   */
  constructor(container, opts) {
    this.el = container;
    this.o = { pageSize: 10, toolbar: true, emptyMessage: 'No rows match the current filters.', searchKeys: [], ...opts };
    this.rows = opts.rows ?? [];
    this.query = '';
    this.page = 1;
    this.pageSize = this.o.pageSize;
    this.sort = opts.initialSort ?? null;
    this.build();
  }

  build() {
    const o = this.o;
    this.el.classList.add('data-table');
    this.el.innerHTML = `
      ${o.toolbar ? `
      <div class="table-toolbar">
        <div class="search-input sm">
          ${icon('search')}
          <input type="search" class="table-search" placeholder="${escapeHtml(o.searchPlaceholder ?? 'Search…')}" aria-label="${escapeHtml(o.searchPlaceholder ?? 'Search table')}">
        </div>
        <div class="toolbar-extra">${o.toolbarExtra ?? ''}</div>
        ${o.exportName ? `<button class="btn btn-secondary btn-sm table-export">${icon('download')}Export CSV</button>` : ''}
      </div>` : ''}
      <div class="table-scroll"><table><thead></thead><tbody></tbody></table></div>
      ${o.paginate === false ? '' : '<div class="table-footer"></div>'}`;

    this.thead = this.el.querySelector('thead');
    this.tbody = this.el.querySelector('tbody');
    this.footer = this.el.querySelector('.table-footer');

    const search = this.el.querySelector('.table-search');
    if (search) {
      search.addEventListener('input', debounce((e) => {
        this.query = e.target.value.trim().toLowerCase();
        this.page = 1;
        this.renderBody();
      }, 180));
    }
    this.el.querySelector('.table-export')?.addEventListener('click', () => this.exportCSV());

    this.thead.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (!th) return;
      this.toggleSort(th.dataset.sort);
    });
    this.thead.addEventListener('keydown', (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.toggleSort(th.dataset.sort);
      }
    });
    this.tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-row-action]');
      if (!btn || !this.o.onAction) return;
      const row = this.visibleRows.find((r) => String(this.rowId(r)) === btn.dataset.rowId);
      if (row) this.o.onAction(btn.dataset.rowAction, row, btn);
    });
    this.footer?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-page]');
      if (!btn || btn.disabled) return;
      this.page = Number(btn.dataset.page);
      this.renderBody();
    });
    this.footer?.addEventListener('change', (e) => {
      if (e.target.matches('.page-size')) {
        this.pageSize = Number(e.target.value);
        this.page = 1;
        this.renderBody();
      }
    });
    this.renderHead();
    this.renderBody();
  }

  rowId(r) {
    return this.o.rowId ? this.o.rowId(r) : r.id ?? r.productId ?? r.price;
  }

  toggleSort(key) {
    if (this.sort?.key === key) this.sort = { key, dir: this.sort.dir === 'asc' ? 'desc' : 'asc' };
    else this.sort = { key, dir: 'desc' };
    this.page = 1;
    this.renderHead();
    this.renderBody();
  }

  renderHead() {
    this.thead.innerHTML = `<tr>${this.o.columns.map((c) => {
      const sortable = c.sortable !== false && c.key !== 'actions';
      const active = this.sort?.key === c.key;
      const aria = active ? (this.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
      const ic = active ? (this.sort.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down';
      return `<th class="${c.align === 'right' ? 'num' : ''} ${c.align === 'center' ? 'center' : ''}" ${c.width ? `style="width:${c.width}"` : ''} ${sortable ? `data-sort="${c.key}" tabindex="0" aria-sort="${aria}"` : ''}>
        <span class="th-inner">${escapeHtml(c.label)}${sortable ? `<span class="sort-ic ${active ? 'active' : ''}">${icon(ic)}</span>` : ''}</span></th>`;
    }).join('')}</tr>`;
    refreshIcons();
  }

  value(row, key) {
    const col = this.o.columns.find((c) => c.key === key);
    if (col?.value) return col.value(row);
    return row[key];
  }

  filtered() {
    let rows = this.rows;
    if (this.query) {
      const keys = this.o.searchKeys;
      rows = rows.filter((r) => keys.some((k) => String(typeof k === 'function' ? k(r) : r[k] ?? '').toLowerCase().includes(this.query)));
    }
    if (this.sort) {
      const { key, dir } = this.sort;
      const m = dir === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const va = this.value(a, key);
        const vb = this.value(b, key);
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * m;
        return String(va ?? '').localeCompare(String(vb ?? '')) * m;
      });
    }
    return rows;
  }

  renderBody() {
    const all = this.filtered();
    this.filteredRows = all;
    const paginate = this.o.paginate !== false;
    const pages = paginate ? Math.max(1, Math.ceil(all.length / this.pageSize)) : 1;
    this.page = Math.min(this.page, pages);
    const start = paginate ? (this.page - 1) * this.pageSize : 0;
    const slice = paginate ? all.slice(start, start + this.pageSize) : all;
    this.visibleRows = slice;

    if (!slice.length) {
      this.tbody.innerHTML = `<tr><td colspan="${this.o.columns.length}"><div class="table-empty">${icon('search-x')}<span>${escapeHtml(this.o.emptyMessage)}</span></div></td></tr>`;
    } else {
      this.tbody.innerHTML = slice.map((r) => `<tr class="${this.o.rowClass ? this.o.rowClass(r) : ''}">${this.o.columns.map((c) => {
        const content = c.render ? c.render(r) : escapeHtml(r[c.key]);
        return `<td class="${c.align === 'right' ? 'num' : ''} ${c.align === 'center' ? 'center' : ''} ${c.className ?? ''}">${content}</td>`;
      }).join('')}</tr>`).join('');
    }

    if (this.footer) {
      const from = all.length ? start + 1 : 0;
      const to = Math.min(start + this.pageSize, all.length);
      const btns = [];
      const pageBtn = (p, label = p, disabled = false, active = false, aria = `Page ${p}`) => `<button class="page-btn ${active ? 'active' : ''}" data-page="${p}" ${disabled ? 'disabled' : ''} aria-label="${aria}" ${active ? 'aria-current="page"' : ''}>${label}</button>`;
      btns.push(pageBtn(this.page - 1, icon('chevron-left'), this.page === 1, false, 'Previous page'));
      const windowPages = new Set([1, pages, this.page - 1, this.page, this.page + 1].filter((p) => p >= 1 && p <= pages));
      let last = 0;
      [...windowPages].sort((a, b) => a - b).forEach((p) => {
        if (p - last > 1) btns.push('<span class="page-gap">…</span>');
        btns.push(pageBtn(p, p, false, p === this.page));
        last = p;
      });
      btns.push(pageBtn(this.page + 1, icon('chevron-right'), this.page === pages, false, 'Next page'));
      this.footer.innerHTML = `
        <span class="muted">Showing <strong>${from}–${to}</strong> of <strong>${all.length}</strong>${this.query ? ' (filtered)' : ''}</span>
        <div class="pager">
          <label class="muted page-size-label">Rows
            <select class="select select-sm page-size" aria-label="Rows per page">${[10, 25, 50].map((n) => `<option ${n === this.pageSize ? 'selected' : ''}>${n}</option>`).join('')}</select>
          </label>
          ${btns.join('')}
        </div>`;
    }
    refreshIcons();
    this.o.onRender?.(this);
  }

  setRows(rows, { resetPage = true } = {}) {
    this.rows = rows;
    if (resetPage) this.page = 1;
    this.renderBody();
  }

  exportCSV() {
    const rows = this.filtered();
    if (!rows.length) {
      toast('Nothing to export — the table is empty.', 'warning');
      return;
    }
    const cols = this.o.columns.filter((c) => c.key !== 'actions' && c.csv !== false);
    const data = [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => (typeof c.csv === 'function' ? c.csv(r) : this.value(r, c.key))))];
    downloadCSV(`${this.o.exportName}.csv`, data);
    toast(`Exported ${rows.length} rows to ${this.o.exportName}.csv`);
  }
}
