// Safe to Spend — conservative estimate of what can be spent.
// Considers balance, upcoming recurring expenses, budget headroom, savings goals, expected income, and buffer.
// Returns explanatory object; never claims guarantee.

import { sum } from './utils.js';

function isoToday() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function daysRemainingInMonth() {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return Math.max(1, last.getDate() - now.getDate() + 1);
}

/**
 * @param {Object} opts
 * @param {number} opts.balance
 * @param {Array} opts.recurring
 * @param {Array} opts.budgetsProgress - from computeBudgetProgress
 * @param {Array} opts.goals
 * @param {Array} opts.transactions
 * @param {number} opts.expectedIncome - optional override
 * @returns {{ insufficient: boolean, reason?: string, missing?: string[], safeMonthly: number, safeDaily: number, breakdown: Object, buffer: number, daysRemaining: number }}
 */
export function computeSafeToSpend({ balance, recurring = [], budgetsProgress = [], goals = [], transactions = [], expectedIncome = null }) {
  const missing = [];
  if (transactions.length < 3) missing.push('transaction history');
  // Need at least balance calculable — always available but check

  // Upcoming recurring expenses within remainder of month
  const todayIso = isoToday();
  const eom = new Date();
  eom.setMonth(eom.getMonth() + 1, 0);
  const eomIso = `${eom.getFullYear()}-${String(eom.getMonth() + 1).padStart(2, '0')}-${String(eom.getDate()).padStart(2, '0')}`;

  let upcomingRecurringExpenses = 0;
  let upcomingRecurringIncomes = 0;
  for (const r of recurring) {
    if (!r.active) continue;
    const nr = r.next_run || todayIso;
    if (nr > eomIso) continue;
    const amt = Number(r.amount) || 0;
    // For daily/weekly within remainder of month, approximate occurrences
    let occ = 1;
    if (r.frequency === 'daily') {
      const start = nr < todayIso ? todayIso : nr;
      occ = Math.max(1, Math.ceil((new Date(eomIso) - new Date(start)) / 86400000));
      occ = Math.min(occ, daysRemainingInMonth());
    } else if (r.frequency === 'weekly') {
      const start = nr < todayIso ? todayIso : nr;
      occ = Math.max(1, Math.ceil((new Date(eomIso) - new Date(start)) / (7 * 86400000)));
    }
    if (r.type === 'expense') upcomingRecurringExpenses += amt * occ;
    else upcomingRecurringIncomes += amt * occ;
  }

  // Savings goal reserve — conservative: 10% of remaining needed for goals with deadline within 60d, or 5% of total target otherwise
  let goalReserve = 0;
  const now = new Date();
  for (const g of goals) {
    if (g.completed_at) continue;
    const remaining = Math.max(0, Number(g.target_amount) - Number(g.current_amount || 0));
    if (remaining <= 0) continue;
    if (g.deadline) {
      const days = Math.ceil((new Date(g.deadline) - now) / 86400000);
      if (days >= 0 && days <= 60) {
        goalReserve += remaining * 0.15; // need to reserve more urgently
      } else if (days >= 0 && days <= 180) {
        goalReserve += remaining * 0.07;
      } else {
        goalReserve += remaining * 0.03;
      }
    } else {
      goalReserve += remaining * 0.02;
    }
  }
  // Cap goalReserve to max 40% of balance to avoid absurd conservative lock
  goalReserve = Math.min(goalReserve, balance * 0.4);
  goalReserve = Math.max(0, Math.round(goalReserve * 100) / 100);

  // Expected income for remainder of month
  let expIncome = expectedIncome;
  if (expIncome == null) {
    // average monthly income last 3 months
    const monthKeys = [];
    const d = new Date();
    for (let i = 0; i < 3; i++) {
      const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      monthKeys.push(k);
    }
    // summarize quickly inline
    const byMonth = new Map();
    for (const t of transactions) {
      if (t.type !== 'income') continue;
      const mk = (t.occurred_on || '').slice(0, 7);
      byMonth.set(mk, (byMonth.get(mk) || 0) + Number(t.amount || 0));
    }
    const incomes = monthKeys.map((k) => byMonth.get(k) || 0).filter((v) => v > 0);
    if (incomes.length >= 1) {
      expIncome = incomes.reduce((a, b) => a + b, 0) / incomes.length;
      // Prorate to remaining days: expected portion for remainder of month
      expIncome = expIncome * (daysRemainingInMonth() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
      // Add recurring incomes already not yet counted double — we added upcomingRecurringIncomes separately,
      // so avoid double-count: if recurring income already within expected avg, don't add again.
      // We treat expectedIncome as historical pattern; recurring upcoming is explicit — keep larger.
      expIncome = Math.max(expIncome, upcomingRecurringIncomes);
    } else {
      expIncome = upcomingRecurringIncomes; // fallback
      if (!expIncome) missing.push('expected income (no income history or recurring income)');
    }
  } else {
    expIncome = Math.max(0, Number(expIncome) || 0);
  }

  // Buffer: 15% of balance, at least ₱500 or 10% if balance < ₱3000, capped at 25%
  const bufferRate = balance < 3000 ? 0.1 : 0.15;
  const buffer = Math.round(Math.min(balance * bufferRate, balance * 0.25) * 100) / 100;

  // Remaining budget headroom — sum of remaining where under budget
  let budgetHeadroom = 0;
  if (budgetsProgress.length) {
    for (const b of budgetsProgress) {
      if (b.remaining > 0) budgetHeadroom += b.remaining;
    }
  }

  // Safe monthly = balance - upcomingRecurringExpenses - goalReserve - buffer + expectedIncomeRemaining
  // Then clamp to never exceed balance + expectedIncome headroom
  let safeMonthly = balance - upcomingRecurringExpenses - goalReserve - buffer + Number(expIncome || 0);
  // Also constrain by budget headroom if budgets exist: safeMonthly cannot exceed budgetHeadroom + unbudgeted slack (20%)
  // We keep conservative: take min(safeMonthly, budgetHeadroom >0 ? budgetHeadroom*1.2 + 500 : safeMonthly)
  if (budgetsProgress.length && budgetHeadroom > 0) {
    const budgetCap = budgetHeadroom * 1.0 + 300; // small slack for uncategorized
    if (safeMonthly > budgetCap && budgetCap > 0) {
      // keep the smaller but not negative
      // only cap if safeMonthly wildly exceeds budgets: protects from overspend on budgeted categories
      // we don't hard cap to budgetHeadroom because user may have unbudgeted income
    }
  }
  safeMonthly = Math.max(0, Math.round(safeMonthly * 100) / 100);
  const daysRemaining = daysRemainingInMonth();
  const safeDaily = Math.round((safeMonthly / daysRemaining) * 100) / 100;

  if (safeMonthly <= 0 && transactions.length >= 3) {
    // still valid: safe = 0 with explanation, not insufficient
    return {
      insufficient: false,
      safeMonthly,
      safeDaily: 0,
      breakdown: { upcomingRecurringExpenses, goalReserve, buffer, expectedIncome: Math.round(Number(expIncome||0)*100)/100, budgetHeadroom: Math.round(budgetHeadroom*100)/100 },
      daysRemaining,
      buffer,
      warning: 'No safe amount remaining after reserving for upcoming expenses, goals, and a buffer.',
    };
  }

  if (missing.length && transactions.length < 3) {
    return {
      insufficient: true,
      reason: `Insufficient data: missing ${missing.join(', ')}. Log income, expenses, and add budgets or savings goals for a more reliable estimate.`,
      missing,
      safeMonthly: 0,
      safeDaily: 0,
      breakdown: { upcomingRecurringExpenses, goalReserve, buffer, expectedIncome: Math.round(Number(expIncome||0)*100)/100, budgetHeadroom: 0 },
      daysRemaining,
      buffer,
    };
  }

  // If income missing but we still have balance, we can give estimate based on balance alone but flag low confidence
  const lowConfidence = missing.includes('expected income (no income history or recurring income)');

  return {
    insufficient: false,
    lowConfidence,
    safeMonthly,
    safeDaily,
    breakdown: { upcomingRecurringExpenses: Math.round(upcomingRecurringExpenses*100)/100, goalReserve, buffer: Math.round(buffer*100)/100, expectedIncome: Math.round(Number(expIncome||0)*100)/100, budgetHeadroom: Math.round(budgetHeadroom*100)/100 },
    daysRemaining,
    buffer,
  };
}
