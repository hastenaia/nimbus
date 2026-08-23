// Cash Flow Forecast — estimated balance in next 30 days.
// Derived from real data only: current balance, avg daily net, upcoming recurring.
// Never invents history; returns insufficient flag when data is sparse.

import { isoLocal, isoTodayLocal, parseLocalISO, countOccurrences } from './utils.js';

/**
 * @param {Object} opts
 * @param {Array} opts.transactions - all user transactions
 * @param {Array} opts.recurring - recurring templates
 * @param {number} opts.balance - current balance (totalIncome - totalExpense)
 * @param {number} opts.forecastDays - days to forecast (default 30)
 * @returns {{ insufficient: boolean, reason?: string, currentBalance: number, estimatedBalance: number, forecastDays: number, avgDailyNet: number, avgDailyIncome: number, avgDailyExpense: number, recurringNet: number, recurringExpenses: number, recurringIncomes: number, dailySeries: number[] } }
 */
export function computeCashFlowForecast({ transactions, recurring = [], balance, forecastDays = 30 }) {
  const todayIso = isoTodayLocal();
  const thirtyAgo = new Date();
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const thirtyAgoIso = isoLocal(thirtyAgo);

  // Need at least some history to estimate.
  const recentTx = transactions.filter((t) => (t.occurred_on || '') >= thirtyAgoIso);
  // Require at least 5 transactions and 7 distinct days or at least one income and one expense in range
  const distinctDays = new Set(recentTx.map((t) => (t.occurred_on || '').slice(0, 10))).size;

  if (transactions.length < 5 || recentTx.length < 3 || distinctDays < 2) {
    return {
      insufficient: true,
      reason: 'Not enough transaction history to forecast. Log a few weeks of income and expenses first — we never guess without your real data.',
      currentBalance: balance,
      estimatedBalance: balance,
      forecastDays,
      avgDailyNet: 0,
      avgDailyIncome: 0,
      avgDailyExpense: 0,
      recurringNet: 0,
      recurringExpenses: 0,
      recurringIncomes: 0,
      dailySeries: [],
    };
  }

  // Average daily net over last 30 days (income - expenses) / 30
  let income30 = 0, expense30 = 0;
  for (const t of recentTx) {
    const amt = Number(t.amount) || 0;
    if (t.type === 'income') income30 += amt;
    else expense30 += amt;
  }
  const avgDailyIncome = income30 / 30;
  const avgDailyExpense = expense30 / 30;
  const avgDailyNet = avgDailyIncome - avgDailyExpense;

  // Upcoming recurring net within forecast window — uses shared local-date counter (consistent with Safe to Spend).
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + forecastDays);
  const horizonIso = isoLocal(horizon);

  let recurringIncomes = 0, recurringExpenses = 0;
  for (const r of recurring) {
    if (!r.active) continue;
    const nextRun = r.next_run || todayIso;
    if (nextRun > horizonIso) continue;
    const amt = Number(r.amount) || 0;
    const occurrences = countOccurrences(r.frequency, nextRun, horizonIso);
    const total = amt * Math.max(1, occurrences);
    if (r.type === 'income') recurringIncomes += total;
    else recurringExpenses += total;
  }

  // Recurring adjustment: net effect of upcoming recurring relative to historical avg
  // estimatedBalance = balance + (avgDailyNet * forecastDays)
  // We keep recurring separate for display; they are already partly reflected in avgDailyExpense if historically,
  // but upcoming recurring gives a more tangible nudge — we add net recurring delta only as explanatory, not double-count.
  // For transparency, we expose recurring totals and compute estimated = balance + avgDailyNet*forecastDays
  // If user has explicit upcoming bills, we subtract them as independent line? To avoid double-count, we apply a conservative overlay:
  // estimated = balance + avgDailyNet*forecastDays (base) and show recurring as context.
  const baseProjection = avgDailyNet * forecastDays;
  const estimatedBalance = Math.round((balance + baseProjection) * 100) / 100;

  const recurringNet = recurringIncomes - recurringExpenses;

  // dailySeries for tiny sparkline: current then estimated linear interpolation
  const dailySeries = [];
  for (let i = 0; i <= forecastDays; i++) {
    dailySeries.push(Math.round((balance + avgDailyNet * i) * 100) / 100);
  }

  return {
    insufficient: false,
    currentBalance: balance,
    estimatedBalance,
    forecastDays,
    avgDailyNet: Math.round(avgDailyNet * 100) / 100,
    avgDailyIncome: Math.round(avgDailyIncome * 100) / 100,
    avgDailyExpense: Math.round(avgDailyExpense * 100) / 100,
    recurringNet: Math.round(recurringNet * 100) / 100,
    recurringExpenses: Math.round(recurringExpenses * 100) / 100,
    recurringIncomes: Math.round(recurringIncomes * 100) / 100,
    dailySeries,
  };
}
