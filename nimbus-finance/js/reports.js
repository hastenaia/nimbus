import { sum, groupBy, formatMoney } from './utils.js';

export function monthlyReport(transactions, month /* 'YYYY-MM' */) {
  const tx = transactions.filter((t) => t.occurred_on.startsWith(month));
  const income = sum(tx.filter((t) => t.type === 'income'), (t) => t.amount);
  const expenses = sum(tx.filter((t) => t.type === 'expense'), (t) => t.amount);
  return {
    month,
    income,
    expenses,
    savings: income - expenses,
    savingsRate: income > 0 ? ((income - expenses) / income) * 100 : 0,
    transactionCount: tx.length,
  };
}

export function yearlyReport(transactions, year /* 'YYYY' */) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const perMonth = months.map((m) => monthlyReport(transactions, m));
  return {
    year,
    perMonth,
    totalIncome: sum(perMonth, (m) => m.income),
    totalExpenses: sum(perMonth, (m) => m.expenses),
    totalSavings: sum(perMonth, (m) => m.savings),
  };
}

export function categoryReport(transactions, categories, type = 'expense') {
  const filtered = transactions.filter((t) => t.type === type);
  const byCat = groupBy(filtered, (t) => t.category_id || 'uncategorized');
  return Object.entries(byCat)
    .map(([catId, txs]) => ({
      category: categories.find((c) => c.id === catId)?.name || 'Uncategorized',
      total: sum(txs, (t) => t.amount),
      count: txs.length,
    }))
    .sort((a, b) => b.total - a.total);
}

export function budgetReport(budgetProgress) {
  return budgetProgress.map((b) => ({
    category: b.categories?.name || 'Category',
    budgeted: b.amount,
    spent: b.spent,
    remaining: b.remaining,
    pct: b.pct,
  }));
}

export function savingsReport(goals) {
  return goals.map((g) => ({
    name: g.name,
    target: g.target_amount,
    current: g.current_amount,
    pct: (g.current_amount / g.target_amount) * 100,
    completed: !!g.completed_at,
  }));
}

export function financialGrowthReport(transactions, netWorthItems) {
  const assets = sum(netWorthItems.filter((n) => n.kind === 'asset'), (n) => n.value);
  const liabilities = sum(netWorthItems.filter((n) => n.kind === 'liability'), (n) => n.value);
  const byMonth = groupBy(transactions, (t) => t.occurred_on.slice(0, 7));
  const months = Object.keys(byMonth).sort();
  let running = 0;
  const trend = months.map((m) => {
    const inc = sum(byMonth[m].filter((t) => t.type === 'income'), (t) => t.amount);
    const exp = sum(byMonth[m].filter((t) => t.type === 'expense'), (t) => t.amount);
    running += inc - exp;
    return { label: m, value: running };
  });
  return { netWorth: assets - liabilities, assets, liabilities, trend };
}

/** Renders a simple report as printable/exportable HTML text inside a container. */
export function renderReportTable(containerEl, title, rows, columns) {
  if (!containerEl) return;
  const head = columns.map((c) => `<th style="text-align:left;padding:8px;font-size:11.5px;color:var(--text-faint);">${c.label}</th>`).join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${columns.map((c) => `<td style="padding:8px;border-top:1px solid var(--border);font-size:13px;">${c.format ? c.format(r[c.key]) : r[c.key]}</td>`).join('')}</tr>`
    )
    .join('');
  containerEl.innerHTML = `
    <h4 style="margin-bottom:10px;">${title}</h4>
    <table style="width:100%;border-collapse:collapse;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  `;
}
