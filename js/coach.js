import { summarizeTransactions, formatMoney, daysBetween, sum } from './utils.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthKeyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function prettyDate(dStr) {
  const [y, m, d] = String(dStr).split('-').map(Number);
  return `${MONTH_NAMES[(m || 1) - 1]} ${d || 1}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Generates plain-language coaching insights from raw transaction data.
 * Entirely rule-based and local — no external API calls, no cost, works offline.
 *
 * Each insight is { id, group, icon, text, priority, action? } where
 * priority is 0 (info) … 3 (critical). Selection sorts by priority and
 * de-duplicates by group so the strongest, most diverse insights win.
 */
export function generateInsights({ transactions, budgetsProgress, goals, categories, netWorthItems = [], forecast, safeToSpend }) {
  const insights = [];
  const now = new Date();
  const thisMonthKey = monthKeyOf(now);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = monthKeyOf(lastMonth);

  const summary = summarizeTransactions(transactions);
  const thisM = summary.byMonth.get(thisMonthKey) || { income: 0, expense: 0, net: 0, categories: new Map() };
  const lastM = summary.byMonth.get(lastMonthKey) || { income: 0, expense: 0, net: 0, categories: new Map() };

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthElapsedPct = (now.getDate() / daysBetween(monthStart, nextMonth)) * 100;

  const catName = (id) => categories.find((c) => c.id === id)?.name;

  // 1. Savings rate
  if (thisM.income > 0) {
    const savingsRate = ((thisM.income - thisM.expense) / thisM.income) * 100;
    if (savingsRate >= 20) {
      insights.push({ id: 'savingsRate', group: 'savings', icon: '💪', text: `Your savings rate is ${savingsRate.toFixed(0)}% this month — excellent discipline.`, priority: 1 });
    } else if (savingsRate < 0) {
      insights.push({ id: 'savingsRate', group: 'savings', icon: '🚨', text: `You're spending more than you're earning this month.`, priority: 3 });
    } else if (savingsRate < 10) {
      insights.push({ id: 'savingsRate', group: 'savings', icon: '💡', text: `Savings rate is ${savingsRate.toFixed(0)}%. Aim for 20% if you can.`, priority: 2 });
    }
  }

  // 2. Spending trend vs last month
  if (lastM.expense > 0) {
    const delta = ((thisM.expense - lastM.expense) / lastM.expense) * 100;
    if (delta <= -5) {
      insights.push({ id: 'spendTrend', group: 'trend', icon: '📉', text: `You spent ${Math.abs(delta).toFixed(0)}% less than last month. Great work!`, priority: 1 });
    } else if (delta >= 10) {
      insights.push({ id: 'spendTrend', group: 'trend', icon: '⚠️', text: `Spending is up ${delta.toFixed(0)}% vs last month — worth a look.`, priority: 2 });
    }
  }

  // 3. Category trend (biggest mover)
  let biggestMover = null;
  thisM.categories.forEach((nowSum, catId) => {
    const prevSum = lastM.categories.get(catId) || 0;
    if (prevSum > 0) {
      const change = ((nowSum - prevSum) / prevSum) * 100;
      if (!biggestMover || Math.abs(change) > Math.abs(biggestMover.change)) {
        biggestMover = { name: catName(catId) || 'A category', change };
      }
    }
  });
  if (biggestMover && Math.abs(biggestMover.change) >= 15) {
    const dir = biggestMover.change > 0 ? 'increasing' : 'decreasing';
    insights.push({ id: 'mover', group: 'mover', icon: biggestMover.change > 0 ? '📈' : '📉', text: `${biggestMover.name} expenses are ${dir} this month.`, priority: 1 });
  }

  // 4. Over-budget count
  const overBudget = budgetsProgress.filter((b) => b.state === 'over');
  if (overBudget.length) {
    insights.push({
      id: 'overBudget', group: 'overBudget', icon: '🧾', priority: 3,
      text: `${overBudget.length} budget${overBudget.length > 1 ? 's are' : ' is'} over limit this month.`,
      action: { label: 'Review budgets', type: 'route', target: 'budgets' },
    });
  }

  // 5. Weekly budget pacing (spent faster than the month has progressed)
  const atRisk = budgetsProgress
    .map((b) => ({ b, gap: b.pct - monthElapsedPct }))
    .filter(({ b, gap }) => b.spent > 0 && b.state !== 'over' && gap >= 15)
    .sort((a, z) => z.gap - a.gap)[0];
  if (atRisk) {
    const { b } = atRisk;
    const cname = b.categories?.name || catName(b.category_id) || 'A budget';
    insights.push({
      id: 'pacing', group: 'pacing', icon: '⏰', priority: 2,
      text: `${cname} budget is ${Math.round(b.pct)}% used with ${Math.round(monthElapsedPct)}% of the month passed — on pace to overspend.`,
      action: { label: 'Go to Budgets', type: 'route', target: 'budgets' },
    });
  }

  // 6. Emergency runway (months of expenses saved)
  const avgMonthlyExpense = sum([0, 1, 2], (i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return summary.byMonth.get(monthKeyOf(d))?.expense || 0;
  }) / 3;
  const balance = summary.totalIncome - summary.totalExpense;
  if (avgMonthlyExpense > 0 && balance > 0) {
    const runway = balance / avgMonthlyExpense;
    if (runway < 3) {
      insights.push({ id: 'runway', group: 'runway', icon: '🛟', priority: 3, text: `You have ${runway.toFixed(1)} months of expenses saved. Aim for 3–6 months of runway.` });
    } else if (runway >= 6) {
      insights.push({ id: 'runway', group: 'runway', icon: '🏦', priority: 1, text: `You have ${runway.toFixed(1)} months of expenses saved — a strong safety net.` });
    }
  }

  // 7. Net worth / debt-to-asset ratio
  const assets = sum(netWorthItems.filter((i) => i.kind === 'asset'), (i) => i.value);
  const liabilities = sum(netWorthItems.filter((i) => i.kind === 'liability'), (i) => i.value);
  if (assets > 0 && liabilities > 0) {
    const ratio = liabilities / assets;
    if (ratio >= 1) {
      insights.push({
        id: 'debtRatio', group: 'debt', icon: '⚠️', priority: 3,
        text: `Your liabilities (${formatMoney(liabilities)}) now match or exceed your assets (${formatMoney(assets)}) — prioritize paying down debt.`,
        action: { label: 'View net worth', type: 'route', target: 'networth' },
      });
    } else if (ratio > 0.5) {
      insights.push({
        id: 'debtRatio', group: 'debt', icon: '💭', priority: 1,
        text: `About ${Math.round(ratio * 100)}% of your assets are offset by debt — consider trimming it.`,
        action: { label: 'View net worth', type: 'route', target: 'networth' },
      });
    }
  }

  // 8. Recurring subscriptions
  const recurringMonthly = sum(transactions.filter((t) => t.type === 'expense' && t.is_recurring && (t.occurred_on || '').slice(0, 7) === thisMonthKey), (t) => t.amount);
  if (recurringMonthly > 0) {
    insights.push({ id: 'recurring', group: 'recurring', icon: '🔁', priority: 1, text: `You're committing ${formatMoney(recurringMonthly)}/month to recurring payments — review subscriptions you no longer use.` });
  }

  // 9. Goal deadline urgency (due soon, under-funded)
  const activeGoals = (goals || []).filter((g) => !g.completed_at);
  activeGoals.forEach((g) => {
    if (g.deadline) {
      const days = daysBetween(now, g.deadline);
      const pct = g.target_amount > 0 ? (g.current_amount / g.target_amount) * 100 : 0;
      if (days >= 0 && days <= 30 && pct < 50) {
        insights.push({
          id: 'goalUrgency', group: 'goalUrgency', icon: '🚨', priority: 3,
          text: `Your "${g.name}" goal is due in ${days}d but only ${Math.round(pct)}% funded — boost contributions.`,
          action: { label: 'Go to Goals', type: 'route', target: 'goals' },
        });
      }
    }
  });

  // 10. Goal runway math (weekly amount needed to hit deadline)
  const goalWithDeadline = activeGoals
    .filter((g) => g.deadline)
    .sort((a, z) => new Date(a.deadline) - new Date(z.deadline))[0];
  if (goalWithDeadline) {
    const remaining = goalWithDeadline.target_amount - goalWithDeadline.current_amount;
    const days = daysBetween(now, goalWithDeadline.deadline);
    if (days > 0 && remaining > 0) {
      const weekly = remaining / (days / 7);
      insights.push({ id: 'goalRunway', group: 'goalRunway', icon: '🎯', priority: 1, text: `Save ${formatMoney(weekly)}/week to hit "${goalWithDeadline.name}" by ${prettyDate(goalWithDeadline.deadline)}.` });
    }
  }

  // 11. Goal milestone
  goals.forEach((g) => {
    const pct = g.target_amount > 0 ? (g.current_amount / g.target_amount) * 100 : 0;
    if (pct >= 50 && pct < 100 && !g.completed_at) {
      insights.push({ id: 'goalMilestone', group: 'goalMilestone', icon: '🏆', priority: 1, text: `You've reached ${Math.round(pct)}% of your "${g.name}" goal.` });
    }
  });

  // 12. Income dip
  if (lastM.income > 0 && thisM.income > 0 && thisM.income < lastM.income * 0.85) {
    const drop = ((lastM.income - thisM.income) / lastM.income) * 100;
    insights.push({ id: 'incomeDip', group: 'income', icon: '📉', priority: 2, text: `Income is down ${drop.toFixed(0)}% this month — watch your spending.` });
  }

  // 13. Spending concentration
  if (thisM.expense > 0 && thisM.categories.size > 0) {
    let topId = null, topSum = 0;
    thisM.categories.forEach((v, id) => { if (v > topSum) { topSum = v; topId = id; } });
    const share = (topSum / thisM.expense) * 100;
    if (share >= 40) {
      insights.push({ id: 'concentration', group: 'concentration', icon: '🎯', priority: 2, text: `${catName(topId) || 'Your top category'} is ${Math.round(share)}% of your spending this month — the best place to trim.` });
    }
  }

  // 14. Anomaly spike (single expense dominating the month)
  const largest = summary.largestExpense;
  if (largest && thisM.expense > 0 && (largest.occurred_on || '').slice(0, 7) === thisMonthKey) {
    const share = (largest.amount / thisM.expense) * 100;
    if (share >= 30) {
      insights.push({ id: 'anomaly', group: 'anomaly', icon: '🔎', priority: 2, text: `One ${formatMoney(largest.amount)} purchase made up ${Math.round(share)}% of this month's spend.` });
    }
  }

  // 15. Cash-flow forecast direction (uses estimated trend)
  if (forecast && !forecast.insufficient) {
    if (forecast.estimatedBalance < balance && forecast.avgDailyNet < 0) {
      insights.push({ id: 'forecast', group: 'forecast', icon: '📉', priority: 2, text: `Cash flow is trending down — estimated balance in ${forecast.forecastDays} days is ${formatMoney(forecast.estimatedBalance)} vs ${formatMoney(balance)} today.` });
    } else if (forecast.estimatedBalance > balance && forecast.avgDailyNet > 0) {
      insights.push({ id: 'forecast', group: 'forecast', icon: '📈', priority: 1, text: `Cash flow looks positive — estimated ${formatMoney(forecast.estimatedBalance)} in ${forecast.forecastDays} days.` });
    }
  }

  // 16. Safe to Spend low
  if (safeToSpend && !safeToSpend.insufficient && safeToSpend.safeDaily != null) {
    if (safeToSpend.safeDaily < 150 && balance > 1000) {
      insights.push({ id: 'safeLow', group: 'safe', icon: '💸', priority: 2, text: `Safe to spend is only ${formatMoney(safeToSpend.safeDaily)}/day after reserving for upcoming bills and goals.` });
    }
  }

  // 17. Sparse-data states
  if (!transactions.length) {
    insights.push({ id: 'onboarding', group: 'onboarding', icon: '👋', priority: 0, text: `Log your first income and expenses and I'll start coaching you.` });
  } else if (summary.months.length <= 1) {
    insights.push({ id: 'oneMonth', group: 'onboarding', icon: '🌱', priority: 0, text: `Great start! A second month of data will let me spot trends for you.` });
  } else if (!budgetsProgress.length) {
    insights.push({
      id: 'noBudgets', group: 'onboarding', icon: '📋', priority: 0,
      text: `You're tracking spending but haven't set budgets yet — set one up to get alerts.`,
      action: { label: 'Set a budget', type: 'modal', target: 'modal-budget' },
    });
  }

  // Enrich with insightType (7 types) and single actionable suggestion where supported by real data
  const typeMap = {
    savings: 'savings', trend: 'spending', mover: 'spending', overBudget: 'budget', pacing: 'budget',
    runway: 'health', debt: 'health', recurring: 'bills', goalUrgency: 'goals', goalRunway: 'goals',
    goalMilestone: 'goals', income: 'cashflow', concentration: 'spending', anomaly: 'spending',
    forecast: 'cashflow', safe: 'cashflow', onboarding: 'health'
  };
  insights.forEach((ins) => {
    ins.insightType = typeMap[ins.group] || ins.group;
    // Confidence per insight (global low if limited history)
    if (!ins.confidence) {
      ins.confidence = (summary.months.length < 2 || transactions.length < 5) ? 'low' : 'high';
    }
    // One actionable suggestion max — grounded in actual budget/headroom
    if (!ins.actionableText) {
      if (ins.group === 'overBudget' && budgetsProgress.length) {
        const over = budgetsProgress.filter(b => b.state === 'over')[0];
        if (over) {
          const saveAmt = Math.min(300, Math.max(50, Math.round(Math.abs(over.remaining) || 100)));
          ins.actionableText = `Consider reducing ${over.categories?.name || 'this category'} spending by ${formatMoney(saveAmt)} this week to stay within your budget.`;
        }
      } else if (ins.group === 'pacing' && budgetsProgress.length) {
        const atRiskItem = budgetsProgress.find(b => b.pct >= 70);
        if (atRiskItem) {
          const headroom = Math.max(0, atRiskItem.amount - atRiskItem.spent);
          const suggestion = Math.min(250, Math.max(50, Math.round(headroom * 0.2) || 80));
          ins.actionableText = `Try limiting ${atRiskItem.categories?.name || 'it'} to ${formatMoney(suggestion)} less this week.`;
        }
      } else if (ins.group === 'concentration' && thisM.expense > 0) {
        const topShare = Math.round((Math.max(...[...thisM.categories.values()]) / thisM.expense) * 100);
        if (topShare >= 40) ins.actionableText = `Aim to trim your top category by ${formatMoney(200)} this week.`;
      }
    }
  });

  // Selection: keep the highest-priority insight per group (no near-duplicates),
  // then sort by urgency and cap at 4.
  const byGroup = new Map();
  insights.forEach((i) => {
    const existing = byGroup.get(i.group);
    if (!existing || i.priority > existing.priority) byGroup.set(i.group, i);
  });
  return [...byGroup.values()]
    .sort((a, z) => z.priority - a.priority)
    .slice(0, 4);
}

/** One-line sentiment headline derived from the strongest insight priority. */
export function computeHeadline(insights) {
  const maxP = Math.max(0, ...insights.map((i) => i.priority));
  if (maxP >= 3) return { text: 'Let\'s fix your spending 🚨', cls: 'bad' };
  if (maxP === 2) return { text: 'Needs a closer look ⚠️', cls: 'warn' };
  if (maxP === 1) return { text: 'Small wins to consider 💡', cls: 'ok' };
  return { text: 'Ready when you are 👋', cls: 'ok' };
}

/**
 * Rule-based answers for the "Ask the coach" chips. No LLM — deterministic
 * and offline, mirroring generateInsights.
 */
export function answerCoachQuestion(question, data, amount) {
  const { transactions, budgetsProgress, goals, categories } = data;
  const thisMonthKey = monthKeyOf(new Date());
  const summary = summarizeTransactions(transactions);
  const thisM = summary.byMonth.get(thisMonthKey) || { income: 0, expense: 0, net: 0, categories: new Map() };
  const catName = (id) => categories.find((c) => c.id === id)?.name;

  if (question === 'cut') {
    const rows = [...thisM.categories.entries()].sort((a, z) => z[1] - a[1]).slice(0, 3);
    if (!thisM.expense || !rows.length) {
      return { icon: '🤷', text: 'No expenses this month yet — log some and I can point out where to trim.' };
    }
    const list = rows.map(([id, v]) => `${catName(id) || 'Uncategorized'} (${Math.round((v / thisM.expense) * 100)}%)`).join(', ');
    const top = catName(rows[0][0]) || 'your top category';
    return { icon: '✂️', text: `Top spending this month: ${list}. Focus your cuts on ${top}.` };
  }

  if (question === 'afford') {
    if (!amount) return { icon: '🤷', text: 'Enter an amount and I\'ll tell you if it fits.' };
    const surplus = thisM.net;
    const balance = summary.totalIncome - summary.totalExpense;
    const share = thisM.income > 0 ? (amount / thisM.income) * 100 : 0;
    if (surplus <= 0) {
      return { icon: '🚫', text: `Your monthly surplus is ${formatMoney(surplus)} — ${formatMoney(amount)} doesn't fit this month without dipping into savings (balance ${formatMoney(balance)}).` };
    }
    if (amount > surplus) {
      return { icon: '⚠️', text: `${formatMoney(amount)} is ${Math.round(share)}% of your income but exceeds this month's surplus of ${formatMoney(surplus)}.` };
    }
    if (share >= 30) {
      return { icon: '🤔', text: `${formatMoney(amount)} is ${Math.round(share)}% of your monthly income and you have ${formatMoney(surplus)} of surplus — doable, but keep it rare.` };
    }
    return { icon: '✅', text: `${formatMoney(amount)} is only ${Math.round(share)}% of your income and fits within this month's surplus of ${formatMoney(surplus)}.` };
  }

  if (question === 'track') {
    if (!budgetsProgress.length) {
      return { icon: '📋', text: 'No budgets set yet — set one up and I\'ll track your pacing.' };
    }
    const onPace = budgetsProgress.filter((b) => b.state === 'healthy').length;
    const over = budgetsProgress.filter((b) => b.state === 'over').map((b) => b.categories?.name || 'a category');
    const atRisk = budgetsProgress.filter((b) => b.state === 'warning' || b.state === 'critical').map((b) => b.categories?.name || 'a category');
    let msg = `${onPace} of ${budgetsProgress.length} budgets are on pace.`;
    if (over.length) msg += ` Over: ${over.join(', ')}.`;
    else if (atRisk.length) msg += ` At risk: ${atRisk.join(', ')}.`;
    else msg += ' Nothing over budget — nice.';
    return { icon: '📊', text: msg };
  }

  return { icon: '💬', text: 'Ask me about cutting costs, affording a purchase, or your budget pacing.' };
}

// --- Phase 9: Typed insight helpers with confidence ---
function confidenceFor(insights, monthsOfHistory, txCount) {
  // Global low confidence if limited history
  if (monthsOfHistory < 2 || txCount < 5) return 'low';
  return 'high';
}

/**
 * Ensure coverage for 7 insight types. Existing generateInsights already covers them,
 * but this helper normalizes to types: spending, budget, savings, cashflow, bills, goals, health
 * and adds confidence + single actionable suggestion where supported.
 */
export function toTypedInsights(insights, ctx) {
  const months = ctx.summary?.months?.length ?? 0;
  const txCount = ctx.transactions?.length ?? 0;
  const conf = confidenceFor(insights, months, txCount);
  return insights.map((ins) => ({
    ...ins,
    confidence: ins.confidence || conf,
    // tag type if missing
    insightType: ins.insightType || ins.group || 'general',
  }));
}

export function renderCoachCard(containerEl, insights, opts = {}) {
  if (!containerEl) return;
  const showConfidence = opts.showConfidence ?? false;
  containerEl.innerHTML = insights
    .map((i) => {
      const action = i.action
        ? `<button class="btn btn-ghost btn-sm" ${i.action.type === 'route' ? `data-route="${i.action.target}"` : `data-open-modal="${i.action.target}"`} style="margin-top:8px;">${i.action.label}</button>`
        : '';
      // Only one actionable suggestion per insight — already enforced by generateInsights (single action)
      const actionable = i.actionableText ? `<div style="margin-top:6px;font-size:12.5px;color:var(--text-dim);"><em>→ ${escapeHtml(i.actionableText)}</em></div>` : '';
      const confBadge = showConfidence && i.confidence === 'low'
        ? `<div style="margin-top:4px;font-size:11px;color:var(--gold);">Your transaction history is limited, so this insight may not reflect your normal spending pattern.</div>`
        : '';
      // Avoid professional advice claims — disclaimer handled at card level
      return `
      <div class="coach-insight" data-insight-type="${escapeHtml(i.insightType || i.group || '')}">
        <span class="coach-insight-ico">${i.icon}</span>
        <div class="coach-insight-body">
          <div>${escapeHtml(i.text)}</div>
          ${actionable}
          ${action}
          ${confBadge}
        </div>
      </div>`;
    })
    .join('');
  // Append global low-confidence notice if needed
  if (showConfidence && insights.some((x) => x.confidence === 'low')) {
    // already per-insight, no duplicate
  }
}

// Preserve original render for callers not passing opts
export function renderCoachCardLegacy(containerEl, insights) {
  return renderCoachCard(containerEl, insights, { showConfidence: false });
}
