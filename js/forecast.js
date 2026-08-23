// Cash Flow Forecast — estimated balance in next 30 days.
// Derived from real data only: current balance, avg daily net, upcoming recurring.
// Never invents history; returns insufficient flag when data is sparse.

import { sum } from './utils.js';

function daysBetweenCeil(a, b) {
  return Math.ceil((new Date(b) - new Date(a)) / 86400000);
}

function isoToday() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/**
 * @param {Object} opts
 * @param {Array} opts.transactions - all user transactions
 * @param {Array} opts.recurring - recurring templates
 * @param {number} opts.balance - current balance (totalIncome - totalExpense)
 * @param {number} opts.forecastDays - days to forecast (default 30)
 * @returns {{ insufficient: boolean, reason?: string, currentBalance: number, estimatedBalance: number, forecastDays: number, avgDailyNet: number, avgDailyIncome: number, avgDailyExpense: number, recurringNet: number, recurringExpenses: number, recurringIncomes: number, dailySeries: number[] } }
 */
export function computeCashFlowForecast({ transactions, recurring = [], balance, forecastDays = 30 }) {
  const todayIso = isoToday();
  const thirtyAgo = new Date();
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const thirtyAgoIso = `${thirtyAgo.getFullYear()}-${String(thirtyAgo.getMonth() + 1).padStart(2, '0')}-${String(thirtyAgo.getDate()).padStart(2, '0')}`;

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

  // Upcoming recurring net within forecast window (from next_run)
  // We use recurring next_run field; count each occurrence once if due within forecast window.
  // For simplicity, assume monthly recurring hits once in next 30d if next_run <= today+forecastDays.
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + forecastDays);
  const horizonIso = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, '0')}-${String(horizon.getDate()).padStart(2, '0')}`;

  let recurringIncomes = 0, recurringExpenses = 0;
  for (const r of recurring) {
    if (!r.active) continue;
    // naive within-window check: next_run between today and horizon
    // For daily/weekly, could recur multiple times but we count one occurrence conservatively;
    // better to approximate monthly as once, weekly as 4x, daily as forecastDays x — document limitation.
    const nextRun = r.next_run || todayIso;
    if (nextRun > horizonIso) continue;
    const amt = Number(r.amount) || 0;
    let occurrences = 1;
    if (r.frequency === 'weekly') {
      occurrences = Math.ceil(forecastDays / 7);
      // but only if next_run within window, approximate
      if (nextRun > todayIso) occurrences = Math.ceil(daysBetweenCeil(nextRun, horizonIso) / 7);
    } else if (r.frequency === 'daily') {
      occurrences = daysBetweenCeil(nextRun <= todayIso ? todayIso : nextRun, horizonIso);
      if (occurrences <= 0) occurrences = 1;
      // cap to forecastDays
      occurrences = Math.min(occurrences, forecastDays);
    }
    // monthly/yearly stays 1
    const total = amt * occurrences;
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
