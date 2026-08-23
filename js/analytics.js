// Advanced Analytics — derived from real Supabase data only.
// Reuses summary (single-pass) — no per-category queries.
// Thresholds documented below; never compares user to external population.

function monthKeyFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function prevMonthKey(currKey) {
  // currKey: YYYY-MM
  const [y, m] = currKey.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return monthKeyFromDate(d);
}

/**
 * Percent change: (curr - prev)/|prev| *100. Returns null if prev is 0 or falsy and curr also 0 => null.
 * If prev 0 and curr >0, returns Infinity (caller hides %).
 */
function pctChange(curr, prev) {
  const c = Number(curr) || 0;
  const p = Number(prev) || 0;
  if (p === 0) {
    if (c === 0) return null;
    return null; // insufficient baseline — do not show %
  }
  return ((c - p) / Math.abs(p)) * 100;
}

/**
 * Main analytics computation — reuses existing summary.
 * @param {Object} opts
 * @param {Object} opts.summary - from summarizeTransactions
 * @param {Array} opts.categories
 * @param {string} opts.currentMonthKey - YYYY-MM (usually monthKey().slice(0,7))
 * @returns {Object}
 */
export function computeAnalytics({ summary, categories = [], currentMonthKey }) {
  const currKey = currentMonthKey;
  const prevKey = prevMonthKey(currKey);
  const byMonth = summary.byMonth;
  const curr = byMonth.get(currKey) || { income: 0, expense: 0, net: 0, categories: new Map() };
  const prev = byMonth.get(prevKey) || null;

  const hasPrev = !!prev && (prev.income > 0 || prev.expense > 0);

  // 1. Month-over-Month
  const currRate = curr.income > 0 ? (curr.net / curr.income) * 100 : 0;
  const prevRate = prev && prev.income > 0 ? (prev.net / prev.income) * 100 : null;
  // changeAbs for rate is percentage points difference
  const rateChangeAbs = prevRate != null ? currRate - prevRate : null;
  // For rate, also compute relative change if needed — but we show abs points plus relative hidden if no prev income
  const rateChangePct = prevRate != null && prevRate !== 0 ? ((currRate - prevRate) / Math.abs(prevRate)) * 100 : null;

  const mom = {
    hasPrev,
    income: { curr: curr.income, prev: prev ? prev.income : 0, change: pctChange(curr.income, prev ? prev.income : 0) },
    expenses: { curr: curr.expense, prev: prev ? prev.expense : 0, change: pctChange(curr.expense, prev ? prev.expense : 0) },
    net: { curr: curr.net, prev: prev ? prev.net : 0, change: pctChange(curr.net, prev ? prev.net : 0) },
    savingsRate: { curr: currRate, prev: prevRate, change: rateChangePct, changeAbs: rateChangeAbs },
  };

  // 2. Spending Trend — documented threshold: >5% increase = increasing, <-5% decreasing, else stable.
  // Requires previous month expense >0; otherwise stable/insufficient.
  let spendingTrend = { status: 'stable', label: 'Stable', changePct: null, hasPrev };
  if (hasPrev && prev.expense > 0) {
    const c = mom.expenses.change;
    if (c != null) {
      if (c > 5) spendingTrend = { status: 'increasing', label: 'Increasing', changePct: c, hasPrev: true };
      else if (c < -5) spendingTrend = { status: 'decreasing', label: 'Decreasing', changePct: c, hasPrev: true };
      else spendingTrend = { status: 'stable', label: 'Stable', changePct: c, hasPrev: true };
    }
  } else if (!hasPrev) {
    spendingTrend.label = 'No prior data';
  }

  // 3. Top Spending Categories (current month)
  const catById = new Map(categories.map((c) => [c.id, c]));
  const totalExp = curr.expense;
  const sortedCats = [...curr.categories.entries()]
    .map(([catId, amt]) => {
      const cat = catById.get(catId) || { name: 'Uncategorized', icon: '💳', color: '#6366F1' };
      const prevAmt = prev ? (prev.categories.get(catId) || 0) : 0;
      const change = pctChange(amt, prevAmt);
      // prevAmt 0 => change null (insufficient)
      const pct = totalExp > 0 ? (amt / totalExp) * 100 : 0;
      return {
        categoryId: catId,
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        currentAmount: amt,
        prevAmount: prevAmt,
        pctOfExpenses: pct,
        changePct: change,
      };
    })
    .sort((a, b) => b.currentAmount - a.currentAmount)
    .slice(0, 3);

  // 4. Spending Anomalies — user's own history only.
  // Method: for each category, collect expense per month for last 6 months (including current).
  // Compute mean and stddev excluding current month for baseline (requires >=3 baseline months with data).
  // Flag if current > mean + 1.5*stddev OR current > 2*mean (when stddev small).
  // Also flag single large transaction anomaly: largest expense this month > 2 * avg monthly expense.
  const anomalies = [];
  const monthsWindow = summary.months.slice(-6); // last 6 chronological
  // Build per-category time series
  const perCatHistory = new Map(); // catId -> amounts[]
  for (const mk of monthsWindow) {
    const md = byMonth.get(mk);
    if (!md) continue;
    // Use md.categories for expense per cat; 0 if absent
    // Collect all catIds seen
    const allIds = new Set([...perCatHistory.keys(), ...md.categories.keys()]);
    for (const cid of allIds) {
      if (!perCatHistory.has(cid)) perCatHistory.set(cid, []);
    }
    for (const [cid, amt] of md.categories.entries()) {
      if (!perCatHistory.has(cid)) perCatHistory.set(cid, Array(monthsWindow.length).fill(0));
      // Push handled below via mapping
    }
  }
  // Simpler: iterate monthsWindow to fill history
  const catIdsAll = new Set();
  for (const mk of monthsWindow) {
    const md = byMonth.get(mk);
    if (!md) continue;
    for (const cid of md.categories.keys()) catIdsAll.add(cid);
  }
  for (const cid of catIdsAll) {
    const series = monthsWindow.map((mk) => {
      const md = byMonth.get(mk);
      return md ? (md.categories.get(cid) || 0) : 0;
    });
    if (series.length < 4) continue; // need baseline
    const currAmt = series[series.length - 1];
    if (currAmt <= 0) continue;
    const baseline = series.slice(0, -1); // exclude current
    const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    if (mean <= 0) continue;
    const variance = baseline.reduce((s, v) => s + (v - mean) ** 2, 0) / baseline.length;
    const std = Math.sqrt(variance);
    // Thresholds documented
    const threshold = mean + 1.5 * std;
    const isAnomaly = currAmt > threshold || currAmt > 2 * mean;
    if (isAnomaly) {
      const cat = catById.get(cid) || { name: 'Uncategorized', icon: '💳' };
      anomalies.push({
        categoryId: cid,
        name: cat.name,
        icon: cat.icon,
        current: currAmt,
        avg: mean,
        stddev: std,
        reason: `₱${currAmt.toFixed(0)} vs ~₱${mean.toFixed(0)} avg (last ${baseline.length} mo)`,
      });
    }
  }
  // Large single transaction anomaly (top expense >> avg expense)
  if (summary.largestExpense && curr.expense > 0) {
    const avgExp = monthsWindow.length > 1 ? monthsWindow.slice(0, -1).reduce((s, mk) => s + (byMonth.get(mk)?.expense || 0), 0) / (monthsWindow.length - 1) : 0;
    const largest = summary.largestExpense;
    const largestMonth = (largest.occurred_on || '').slice(0, 7);
    if (largestMonth === currKey && avgExp > 0 && largest.amount > 2 * (avgExp / 4)) { // heuristic: large tx > 0.5*avg monthly chunk
      // Check if not already flagged category anomaly for same amount
      const duplicate = anomalies.some((a) => Math.abs(a.current - largest.amount) < 0.01);
      if (!duplicate && largest.amount / curr.expense > 0.25) {
        anomalies.push({
          categoryId: largest.category_id || 'large-tx',
          name: catById.get(largest.category_id)?.name || 'Large transaction',
          icon: '🔎',
          current: largest.amount,
          avg: avgExp,
          stddev: 0,
          reason: `Single ${largest.amount.toFixed(0)} expense is ${((largest.amount / curr.expense) * 100).toFixed(0)}% of this month`,
        });
      }
    }
  }

  // 5. Savings Rate Trend — last 6 months
  const savingsRateTrend = monthsWindow.map((mk) => {
    const md = byMonth.get(mk);
    const rate = md && md.income > 0 ? (md.net / md.income) * 100 : (md && md.income === 0 && md.expense === 0 ? null : 0);
    return { month: mk, rate, income: md ? md.income : 0, expense: md ? md.expense : 0, net: md ? md.net : 0 };
  }).filter((p) => p.rate !== null); // keep even 0 rates, but drop truly empty (no data) handled via filter above

  // 6. Financial Insight Card — one concise insight, highest priority real-data
  let insight = null;
  // Priority order: anomaly > MoM net big change > spendingTrend > savingsRate > topCategory growth
  if (anomalies.length) {
    const a = anomalies[0];
    insight = { icon: '⚠️', text: `${a.name} spending is significantly higher than your recent average (${a.reason}).`, priority: 3, group: 'anomaly' };
  } else if (hasPrev && mom.net.change != null && Math.abs(mom.net.change) >= 20) {
    const dir = mom.net.change > 0 ? 'increased' : 'decreased';
    insight = { icon: mom.net.change > 0 ? '📈' : '📉', text: `Your net cash flow ${dir} ${Math.abs(mom.net.change).toFixed(0)}% vs last month.`, priority: 2, group: 'net' };
  } else if (hasPrev && mom.expenses.change != null && Math.abs(mom.expenses.change) >= 8) {
    const dir = mom.expenses.change > 0 ? 'increased' : 'decreased';
    insight = { icon: '💸', text: `Your expenses ${dir} ${Math.abs(mom.expenses.change).toFixed(0)}% compared with last month.`, priority: 2, group: 'expenses' };
  } else if (hasPrev && rateChangeAbs != null && Math.abs(rateChangeAbs) >= 5) {
    const dir = rateChangeAbs > 0 ? 'improved' : 'fell';
    insight = { icon: '✨', text: `Your savings rate ${dir} ${Math.abs(rateChangeAbs).toFixed(1)} pts this month (${currRate.toFixed(1)}% vs ${prevRate.toFixed(1)}%).`, priority: 1, group: 'savings' };
  } else if (sortedCats.length >= 2 && sortedCats[0].changePct != null && Math.abs(sortedCats[0].changePct) >= 15) {
    const dir = sortedCats[0].changePct > 0 ? 'growing' : 'down';
    insight = { icon: '🏷️', text: `${sortedCats[0].name} is your fastest-${dir} expense category (${sortedCats[0].changePct > 0 ? '+' : ''}${sortedCats[0].changePct.toFixed(0)}% vs last month).`, priority: 1, group: 'category' };
  } else if (spendingTrend.status !== 'stable' && hasPrev) {
    insight = { icon: spendingTrend.status === 'increasing' ? '📈' : '📉', text: `Spending is ${spendingTrend.label.toLowerCase()} this month (${spendingTrend.changePct > 0 ? '+' : ''}${spendingTrend.changePct.toFixed(0)}% vs last month).`, priority: 1, group: 'trend' };
  } else if (!hasPrev) {
    insight = { icon: '🌱', text: `Log another month to unlock month-over-month insights.`, priority: 0, group: 'onboarding' };
  } else {
    insight = { icon: '✅', text: `Spending is stable this month.`, priority: 0, group: 'stable' };
  }

  return {
    mom,
    spendingTrend,
    topCategories: sortedCats,
    anomalies,
    savingsRateTrend,
    insight,
    currentMonthKey: currKey,
    prevMonthKey: prevKey,
  };
}
