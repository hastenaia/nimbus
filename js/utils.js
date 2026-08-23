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
 * Financial Health Score (0-100) — improved v1, derived-only.
 * Weighted blend of:
 *  - Savings rate (30%): 20%+ = full marks
 *  - Budget adherence (25%): staying under budget across categories
 *  - Goal progress (10%): average completion of active savings goals
 *  - Spending consistency (15%): low variance vs coefficient of variation of monthly expenses
 *  - Emergency runway (10%): balance covers 1-3 months expenses
 *  - Debt ratio (10%): liabilities/assets if available
 *  If a component cannot be calculated reliably (no budgets, no goals, no net worth, <2 months),
 *  it is treated as neutral 0.5 for that component and documented — we do NOT fabricate.
 *  LIMITATION: spending consistency requires >=2 months; debt/runway require netWorthItems.
 */
export function calcHealthScore({ savingsRate, budgetAdherence, goalProgress, spendingConsistency, emergencyRunway, debtRatio }) {
  const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  const savingsScore = Math.min(1, Math.max(0, savingsRate / 20)) * 30;
  const budgetScore = clamp01(budgetAdherence) * 25;
  const goalScore = clamp01(goalProgress) * 10;
  // spendingConsistency expected 0..1 (1 = very stable); fallback neutral 0.5
  const consistencyScore = (spendingConsistency == null ? 0.5 : clamp01(spendingConsistency)) * 15;
  const runwayScore = (emergencyRunway == null ? 0.5 : clamp01(emergencyRunway)) * 10;
  // debtRatio is liabilities/assets where 0 = no debt (good), 1+ = bad; convert to score: 1 - min(1, ratio)
  let debtScoreNorm = 0.5;
  if (debtRatio != null) {
    const r = Number(debtRatio);
    debtScoreNorm = 1 - Math.min(1, Math.max(0, r));
  }
  const debtScore = debtScoreNorm * 10;
  return Math.round(savingsScore + budgetScore + goalScore + consistencyScore + runwayScore + debtScore);
}

// Helpers for health score sub-components (used by app.js — keep pure and testable)
export function computeSpendingConsistency(summary, monthsWindow = 6) {
  // Coefficient of variation: stddev/mean of monthly expenses; consistency = 1 - min(1, cv)
  // Returns 0..1 or null if insufficient months.
  const months = (summary.months || []).slice(-monthsWindow);
  if (months.length < 2) return null;
  const exps = months.map((m) => summary.byMonth.get(m)?.expense || 0);
  const mean = exps.reduce((a, b) => a + b, 0) / exps.length;
  if (mean <= 0) return 0.5;
  const variance = exps.reduce((s, v) => s + (v - mean) ** 2, 0) / exps.length;
  const std = Math.sqrt(variance);
  const cv = std / mean;
  return Math.max(0, Math.min(1, 1 - Math.min(1, cv)));
}

export function computeEmergencyRunway(balance, summary) {
  // months of runway = balance / avgMonthlyExpense (last 3 months)
  const months = (summary.months || []).slice(-3);
  if (!months.length) return null;
  const avg = months.reduce((s, m) => s + (summary.byMonth.get(m)?.expense || 0), 0) / 3;
  if (avg <= 0) return null;
  const runway = balance / avg;
  // normalize: 0mo=0, 1mo=0.33, 3mo=1
  return Math.min(1, runway / 3);
}

export function computeDebtRatio(netWorthItems) {
  if (!netWorthItems || !netWorthItems.length) return null;
  const assets = netWorthItems.filter((i) => i.kind === 'asset').reduce((s, n) => s + Number(n.value || 0), 0);
  const liabs = netWorthItems.filter((i) => i.kind === 'liability').reduce((s, n) => s + Number(n.value || 0), 0);
  if (assets <= 0) return null;
  return liabs / assets;
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
