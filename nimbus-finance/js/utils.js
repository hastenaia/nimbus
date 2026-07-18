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

export function startOfMonth(date = new Date()) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function daysBetween(a, b) {
  return Math.ceil((new Date(b) - new Date(a)) / 86400000);
}

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
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
 *  - Cash flow trend (20%): income - expenses positive & improving
 *  - Goal progress (10%): average completion of active savings goals
 */
export function calcHealthScore({ savingsRate, budgetAdherence, cashFlowTrend, goalProgress }) {
  const savingsScore = Math.min(1, Math.max(0, savingsRate / 0.20)) * 40;
  const budgetScore = Math.min(1, Math.max(0, budgetAdherence)) * 30;
  const trendScore = Math.min(1, Math.max(0, (cashFlowTrend + 1) / 2)) * 20;
  const goalScore = Math.min(1, Math.max(0, goalProgress)) * 10;
  return Math.round(savingsScore + budgetScore + trendScore + goalScore);
}

export function scoreLabel(score) {
  if (score >= 85) return { label: 'Excellent', color: 'var(--growth)' };
  if (score >= 65) return { label: 'Good', color: 'var(--growth)' };
  if (score >= 45) return { label: 'Fair', color: 'var(--gold)' };
  return { label: 'Needs attention', color: 'var(--coral)' };
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
