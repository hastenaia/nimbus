import { DEFAULT_CURRENCY } from './config.js';

export function formatMoney(amount, currency = DEFAULT_CURRENCY) {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function formatDate(d, opts = { month: 'short', day: 'numeric' }) {
  return new Date(d).toLocaleDateString('en-US', opts);
}

export function monthKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function daysBetween(a, b) {
  return Math.ceil((new Date(b) - new Date(a)) / 86400000);
}

/**
 * Single-pass transaction summary used by dashboard, charts, coach and
 * budget progress — avoids re-filtering/re-summing the list on every render.
 * Returns per-month { income, expense, net, categories } plus totals and the
 * largest single expense.
 */
export function summarizeTransactions(transactions) {
  const byMonth = new Map();
  let totalIncome = 0;
  let totalExpense = 0;
  let largestExpense = null;

  for (const t of transactions) {
    const month = (t.occurred_on || '').slice(0, 7) || 'unknown';
    const amount = Number(t.amount) || 0;

    let m = byMonth.get(month);
    if (!m) {
      m = { income: 0, expense: 0, net: 0, categories: new Map() };
      byMonth.set(month, m);
    }

    if (t.type === 'income') {
      m.income += amount;
      m.net += amount;
      totalIncome += amount;
    } else {
      m.expense += amount;
      m.net -= amount;
      totalExpense += amount;
      if (!largestExpense || amount > largestExpense.amount) largestExpense = t;
      const key = t.category_id || 'uncategorized';
      m.categories.set(key, (m.categories.get(key) || 0) + amount);
    }
  }

  return { byMonth, totalIncome, totalExpense, largestExpense, months: [...byMonth.keys()].sort() };
}

export function emptyMonthSummary() {
  return { income: 0, expense: 0, net: 0, categories: new Map() };
}

export function toast(message) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Financial Health Score (0-100).
 * Weighted blend of:
 *  - Savings rate (40%): 20%+ savings rate = full marks
 *  - Budget adherence (30%): staying under budget across categories
 *  - Goal progress (10%): average completion of active savings goals
 *  - Baseline (20%): everyone starts with a head start.
 */
export function calcHealthScore({ savingsRate, budgetAdherence, goalProgress }) {
  const savingsScore = Math.min(1, Math.max(0, savingsRate / 20)) * 40;
  const budgetScore = Math.min(1, Math.max(0, budgetAdherence)) * 30;
  const goalScore = Math.min(1, Math.max(0, goalProgress)) * 10;
  return Math.round(savingsScore + budgetScore + goalScore + 20);
}

export function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

export function sum(arr, sel = (x) => x) {
  return arr.reduce((s, x) => s + Number(sel(x) || 0), 0);
}

const loadedScripts = new Set();

/** Loads a classic <script> (e.g. a CDN global) on demand, cached per URL. */
export function loadScript(src) {
  if (loadedScripts.has(src)) return Promise.resolve();
  loadedScripts.add(src);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(s);
  });
}
