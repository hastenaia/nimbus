// Nimbus AI Financial Intelligence — client-side helper
// - Builds verified-only metrics with type tags: actual | estimated | forecast | missing
// - Keeps API keys server-side: calls Supabase Edge Function ai-coach
// - Deduplicates requests, preserves fallback

import { SUPABASE_URL, SUPABASE_ANON_KEY, AI_COACH_ENABLED } from './config.js';
import { getSupabase } from './supabaseClient.js';

let lastMetricsHash = null;
let lastResult = null;
let inFlight = null;

// tiny hash for dedup (no crypto needed)
function hashMetrics(m) {
  return JSON.stringify(m);
}

function isAIConfigured() {
  if (!AI_COACH_ENABLED) return false;
  if (!SUPABASE_URL) return false;
  if (localStorage.getItem('nimbus_ai_disabled') === '1') return false;
  return true;
}

/**
 * Build verified metrics payload.
 * Only includes values that actually exist; missing are marked {type:'missing'}.
 * Callers must pass already-computed contexts (no extra queries).
 */
export function buildVerifiedMetrics(ctx) {
  const {
    summary,               // summarizeTransactions result
    currentMonthKey,       // YYYY-MM
    transactions, budgetsProgress, goals, categories, netWorthItems,
    forecast, safeToSpend, analytics, healthScore, recurring,
  } = ctx;

  const byMonth = summary.byMonth;
  const curr = byMonth.get(currentMonthKey) || { income: 0, expense: 0, net: 0, categories: new Map() };
  const balance = summary.totalIncome - summary.totalExpense;

  // Helper to wrap value with provenance
  const actual = (value, source) => ({ value, type: 'actual', source });
  const estimated = (value, source) => ({ value, type: 'estimated', source });
  const forecastWrap = (value, source) => ({ value, type: 'forecast', source });
  const missing = (reason) => ({ value: null, type: 'missing', reason });

  const monthsOfHistory = summary.months.length;
  const transactionCount = transactions.length;
  const lowHistory = monthsOfHistory < 2 || transactionCount < 5;

  // Core
  const metrics = {
    transactionCount: actual(transactionCount, 'transactions.length'),
    monthsOfHistory: actual(monthsOfHistory, 'summary.months'),
    confidence: lowHistory ? actual('low', 'monthsOfHistory<2 or tx<5') : actual('high', 'sufficient history'),
    currentBalance: Number.isFinite(balance) ? actual(balance, 'totalIncome-totalExpense') : missing('no transactions'),
    monthlyIncome: curr.income > 0 || curr.expense > 0 ? actual(curr.income, `byMonth[${currentMonthKey}].income`) : missing('no income this month'),
    monthlyExpenses: actual(curr.expense, `byMonth[${currentMonthKey}].expense`),
    netCashFlow: actual(curr.net, 'income-expense'),
    savingsRate: curr.income > 0 ? actual((curr.net / curr.income) * 100, '(net/income)*100') : missing('zero income — safe handling'),
    budgetUtilization: budgetsProgress.length
      ? actual(budgetsProgress.map(b => ({ category: b.categories?.name || b.category_id, spent: b.spent, budget: b.amount, pct: b.pct, state: b.state })), 'computeBudgetProgress')
      : missing('no budgets'),
    topSpendingCategories: analytics?.topCategories?.length
      ? actual(analytics.topCategories.map(c => ({ name: c.name, currentAmount: c.currentAmount, pctOfExpenses: c.pctOfExpenses, changePct: c.changePct })), 'analytics.topCategories')
      : (curr.expense === 0 ? missing('no expenses') : actual([], 'no categories')),
    spendingTrend: analytics?.spendingTrend
      ? actual(analytics.spendingTrend, 'analytics.spendingTrend threshold ±5% documented')
      : missing('insufficient prior month'),
    upcomingRecurringExpenses: recurring?.length
      ? estimated(
          recurring.filter(r => r.active).map(r => ({ description: r.description, frequency: r.frequency, amount: r.amount, next_run: r.next_run })),
          'recurring_transactions filtered active'
        )
      : missing('no recurring'),
    forecast: forecast
      ? (forecast.insufficient ? missing(forecast.reason) : forecastWrap({ estimatedBalance: forecast.estimatedBalance, avgDailyNet: forecast.avgDailyNet, forecastDays: forecast.forecastDays }, 'computeCashFlowForecast'))
      : missing('no forecast'),
    safeToSpend: safeToSpend
      ? (safeToSpend.insufficient ? missing(safeToSpend.reason) : estimated({ safeDaily: safeToSpend.safeDaily, safeMonthly: safeToSpend.safeMonthly, buffer: safeToSpend.buffer }, 'computeSafeToSpend'))
      : missing('no safeToSpend'),
    savingsGoalProgress: goals?.length
      ? actual(goals.map(g => ({ name: g.name, current: g.current_amount, target: g.target_amount, pct: g.target_amount >0 ? (g.current_amount/g.target_amount)*100 : 0 })), 'savings_goals')
      : missing('no goals'),
    financialHealthScore: Number.isFinite(healthScore) ? actual(healthScore, 'calcHealthScore') : missing('insufficient data'),
    categoriesCount: actual(categories.length, 'categories.length'),
    balanceLabel: actual(balance < 0 ? 'negative' : balance === 0 ? 'zero' : 'positive', 'balance sign'),
  };

  // Never fabricate: strip any undefined computed values to missing
  return metrics;
}

/**
 * Call server-side AI. Returns {configured, insights?, disclaimer?, fallback?, reason?}
 * Deduplicated per metrics hash. No duplicate requests on dashboard re-renders.
 */
export async function getAIInsights(verifiedMetrics) {
  const hash = hashMetrics(verifiedMetrics);

  if (hash === lastMetricsHash && lastResult) {
    return lastResult;
  }
  if (inFlight) return inFlight;

  if (!isAIConfigured()) {
    const res = { configured: false, fallback: true, reason: 'AI not configured' };
    lastMetricsHash = hash;
    lastResult = res;
    return res;
  }

  // Build endpoint — Supabase Edge Function convention
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/ai-coach`;

  inFlight = (async () => {
    try {
      const supabase = getSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const headers = {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      };
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ metrics: verifiedMetrics }),
      });

      if (resp.status === 503 || resp.status === 502 || resp.status === 500) {
        // Fallback signal from server
        const fallback = await resp.json().catch(() => ({}));
        const res = { configured: resp.status === 503 ? false : true, fallback: true, reason: fallback.reason || `status ${resp.status}` };
        lastMetricsHash = hash;
        lastResult = res;
        return res;
      }
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        console.warn('AI coach http error', resp.status, txt);
        const res = { configured: true, fallback: true, reason: `http ${resp.status}` };
        lastMetricsHash = hash;
        lastResult = res;
        return res;
      }
      const data = await resp.json();
      // data: {configured, insights, disclaimer, fallback}
      lastMetricsHash = hash;
      lastResult = data;
      return data;
    } catch (err) {
      console.warn('AI coach fetch failed', err);
      const res = { configured: true, fallback: true, reason: String(err) };
      lastMetricsHash = hash;
      lastResult = res;
      return res;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function clearAICache() {
  lastMetricsHash = null;
  lastResult = null;
}
