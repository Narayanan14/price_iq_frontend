// Shared formatting, maths and DOM helpers used across PriceIQ.

/** Deterministic seeded PRNG (mulberry32). Same seed → same sequence on every reload. */
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // Approximately normal via Box–Muller, clamped to ±3σ.
    normal: (mean = 0, sd = 1) => {
      const u = Math.max(next(), 1e-9);
      const v = next();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return mean + sd * Math.max(-3, Math.min(3, z));
    },
    weighted: (weights) => {
      const total = weights.reduce((s, w) => s + w, 0);
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
      }
      return weights.length - 1;
    },
  };
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
export const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Division that never returns NaN or Infinity.
 * @param {number} numerator
 * @param {number} denominator
 * @param {*} [fallback=null] value returned when the result is undefined (e.g. denominator 0)
 */
export function safeDivide(numerator, denominator, fallback = null) {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator) || denominator === 0) return fallback;
  const v = numerator / denominator;
  return Number.isFinite(v) ? v : fallback;
}

/** Percentage change that never returns NaN/Infinity. Returns null when undefined (base 0). */
export function pctChange(next, base) {
  const ratio = safeDivide(next - base, Math.abs(base));
  return ratio == null ? null : ratio * 100;
}

const gbp2 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gbp0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const num0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

export function fmtGBP(v, dp = 2) {
  if (!isFiniteNumber(v)) return '—';
  return dp === 0 ? gbp0.format(v) : gbp2.format(v);
}

/** Compact currency: £1.24M, £842.1K, £96.40 */
export function fmtGBPCompact(v) {
  if (!isFiniteNumber(v)) return '—';
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}£${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}£${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sign}£${(a / 1e3).toFixed(1)}K`;
  return fmtGBP(v, a >= 1000 ? 0 : 2);
}

export function fmtNum(v, dp = 0) {
  if (!isFiniteNumber(v)) return '—';
  return dp === 0 ? num0.format(v) : num1.format(v);
}

export function fmtCompact(v) {
  if (!isFiniteNumber(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return num0.format(v);
}

/** Percent with optional explicit sign. Null-safe. */
export function fmtPct(v, dp = 1, signed = false) {
  if (!isFiniteNumber(v)) return '—';
  const s = Math.abs(v).toFixed(dp);
  if (!signed) return `${v < 0 ? '-' : ''}${s}%`;
  if (Number(s) === 0) return `${(0).toFixed(dp)}%`;
  return `${v > 0 ? '+' : '-'}${s}%`;
}

export function fmtDate(d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', opts);
}

export function fmtTime(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** rAF-coalesced callback: runs at most once per frame with the latest args. */
export function throttleFrame(fn) {
  let queued = false;
  let lastArgs;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...lastArgs);
    });
  };
}

const iconCache = new Map();
const pascalCase = (name) => name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());

/**
 * Inline SVG markup for a Lucide icon. SVG strings are built once per icon name and cached,
 * so rendering never needs a DOM-wide scan. Falls back to a placeholder that refreshIcons()
 * upgrades if the icon library has not loaded.
 */
export function icon(name, cls = '') {
  let svg = iconCache.get(name);
  if (svg === undefined && window.lucide?.icons) {
    svg = null;
    try {
      const node = window.lucide.icons[pascalCase(name)];
      if (node) {
        const el = window.lucide.createElement(node);
        el.removeAttribute('class');
        el.setAttribute('stroke-width', '1.8');
        svg = el.outerHTML;
      }
    } catch {
      svg = null;
    }
    iconCache.set(name, svg);
  }
  if (svg) return svg.replace('<svg ', `<svg class="lucide lucide-${name} icon ${cls}" aria-hidden="true" focusable="false" `);
  return `<i data-lucide="${name}" class="icon ${cls}" aria-hidden="true"></i>`;
}

/** Upgrade any remaining <i data-lucide> placeholders (only scans when some exist). */
export function refreshIcons() {
  try {
    if (window.lucide?.createIcons && document.querySelector('i[data-lucide]')) window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
  } catch (err) {
    console.warn('Icon rendering failed', err);
  }
}

/** Run at most once per `ms`, always including a trailing call with the latest arguments. */
export function throttle(fn, ms = 120) {
  let last = 0;
  let timer = null;
  let lastArgs;
  return (...args) => {
    lastArgs = args;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) {
      clearTimeout(timer);
      timer = null;
      last = Date.now();
      fn(...lastArgs);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...lastArgs);
      }, wait);
    }
  };
}

export function memoize(fn, keyFn, maxSize = 5000) {
  const cache = new Map();
  const wrapped = (...args) => {
    const key = keyFn(...args);
    if (cache.has(key)) return cache.get(key);
    const value = fn(...args);
    if (cache.size >= maxSize) cache.delete(cache.keys().next().value);
    cache.set(key, value);
    return value;
  };
  wrapped.clear = () => cache.clear();
  return wrapped;
}

/** localStorage/sessionStorage wrappers that never throw (private mode, quota, disabled). */
export const storage = {
  get(key, fallback, area = 'local') {
    try {
      const store = area === 'session' ? window.sessionStorage : window.localStorage;
      const raw = store.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value, area = 'local') {
    try {
      const store = area === 'session' ? window.sessionStorage : window.localStorage;
      store.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key, area = 'local') {
    try {
      const store = area === 'session' ? window.sessionStorage : window.localStorage;
      store.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
};

function csvCell(v) {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Trigger a browser download of rows (array of arrays; first row = header). */
export function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const sum = (arr, fn = (x) => x) => arr.reduce((s, x) => s + fn(x), 0);

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function signClass(v, invert = false) {
  if (!isFiniteNumber(v) || Math.abs(v) < 0.05) return 'neutral';
  const positive = invert ? v < 0 : v > 0;
  return positive ? 'pos' : 'neg';
}
