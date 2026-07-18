import { sum, groupBy, formatMoney } from './utils.js';

/**
 * Generates plain-language coaching insights from raw transaction data.
 * Entirely rule-based and local — no external API calls, no cost, no
 * dependency on a live LLM connection, so it always works offline.
 */
export function generateInsights({ transactions, budgetsProgress, goals, categories }) {
  const insights = [];
  const now = new Date();
  const thisMonthKey = now.toISOString().slice(0, 7);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = lastMonth.toISOString().slice(0, 7);

  const thisMonthTx = transactions.filter((t) => t.occurred_on.slice(0, 7) === thisMonthKey);
  const lastMonthTx = transactions.filter((t) => t.occurred_on.slice(0, 7) === lastMonthKey);

  const thisExpense = sum(thisMonthTx.filter((t) => t.type === 'expense'), (t) => t.amount);
  const lastExpense = sum(lastMonthTx.filter((t) => t.type === 'expense'), (t) => t.amount);
  const thisIncome = sum(thisMonthTx.filter((t) => t.type === 'income'), (t) => t.amount);

  // 1. Overall spending trend vs last month
  if (lastExpense > 0) {
    const delta = ((thisExpense - lastExpense) / lastExpense) * 100;
    if (delta <= -5) {
      insights.push({ icon: '📉', text: `You spent ${Math.abs(delta).toFixed(0)}% less than last month. Great work!` });
    } else if (delta >= 10) {
      insights.push({ icon: '⚠️', text: `Spending is up ${delta.toFixed(0)}% vs last month — worth a look.` });
    }
  }

  // 2. Category trend (biggest mover)
  const catThis = groupBy(thisMonthTx.filter((t) => t.type === 'expense'), (t) => t.category_id);
  const catLast = groupBy(lastMonthTx.filter((t) => t.type === 'expense'), (t) => t.category_id);
  let biggestMover = null;
  Object.keys(catThis).forEach((catId) => {
    const nowSum = sum(catThis[catId], (t) => t.amount);
    const prevSum = sum(catLast[catId] || [], (t) => t.amount);
    if (prevSum > 0) {
      const change = ((nowSum - prevSum) / prevSum) * 100;
      if (!biggestMover || Math.abs(change) > Math.abs(biggestMover.change)) {
        const cat = categories.find((c) => c.id === catId);
        biggestMover = { name: cat?.name || 'A category', change };
      }
    }
  });
  if (biggestMover && Math.abs(biggestMover.change) >= 15) {
    const dir = biggestMover.change > 0 ? 'increasing' : 'decreasing';
    insights.push({ icon: biggestMover.change > 0 ? '📈' : '📉', text: `${biggestMover.name} expenses are ${dir} this month.` });
  }

  // 3. Savings rate
  if (thisIncome > 0) {
    const savingsRate = ((thisIncome - thisExpense) / thisIncome) * 100;
    if (savingsRate >= 20) {
      insights.push({ icon: '💪', text: `Your savings rate is ${savingsRate.toFixed(0)}% this month — excellent discipline.` });
    } else if (savingsRate < 0) {
      insights.push({ icon: '🚨', text: `You're spending more than you're earning this month.` });
    } else if (savingsRate < 10) {
      insights.push({ icon: '💡', text: `Savings rate is ${savingsRate.toFixed(0)}%. Aim for 20% if you can.` });
    }
  }

  // 4. Budget warnings
  const overBudget = budgetsProgress.filter((b) => b.state === 'over');
  if (overBudget.length) {
    insights.push({ icon: '🧾', text: `${overBudget.length} budget${overBudget.length > 1 ? 's are' : ' is'} over limit this month.` });
  }

  // 5. Goal progress milestones
  goals.forEach((g) => {
    const pct = (g.current_amount / g.target_amount) * 100;
    if (pct >= 50 && pct < 100 && !g.completed_at) {
      insights.push({ icon: '🎯', text: `You've reached ${Math.round(pct)}% of your "${g.name}" goal.` });
    }
  });

  // 6. Largest single expense this month
  const largest = [...thisMonthTx.filter((t) => t.type === 'expense')].sort((a, b) => b.amount - a.amount)[0];
  if (largest) {
    insights.push({ icon: '🔎', text: `Your largest expense this month was ${formatMoney(largest.amount)} (${largest.description || 'unlabeled'}).` });
  }

  if (!insights.length) {
    insights.push({ icon: '👋', text: 'Log a few transactions and I\'ll start surfacing insights here.' });
  }

  return insights.slice(0, 4);
}

export function renderCoachCard(containerEl, insights) {
  if (!containerEl) return;
  containerEl.innerHTML = insights
    .map((i) => `<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;"><span>${i.icon}</span><span style="font-size:13.5px;line-height:1.4;">${i.text}</span></div>`)
    .join('');
}
