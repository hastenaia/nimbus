import { groupBy, formatMoney } from './utils.js';

export function categoryReport(transactions, categories, type = 'expense') {
  const filtered = transactions.filter((t) => t.type === type);
  const byCat = groupBy(filtered, (t) => t.category_id || 'uncategorized');
  return Object.entries(byCat)
    .map(([catId, txs]) => ({
      category: categories.find((c) => c.id === catId)?.name || 'Uncategorized',
      total: txs.reduce((s, t) => s + Number(t.amount || 0), 0),
      count: txs.length,
    }))
    .sort((a, b) => b.total - a.total);
}

/** Builds the cumulative net-worth growth trend from a `summarizeTransactions` result. */
export function financialGrowthReport(summary, netWorthItems) {
  const assets = netWorthItems.filter((n) => n.kind === 'asset').reduce((s, n) => s + Number(n.value || 0), 0);
  const liabilities = netWorthItems.filter((n) => n.kind === 'liability').reduce((s, n) => s + Number(n.value || 0), 0);
  let running = 0;
  const trend = (summary.months || []).map((m) => {
    running += summary.byMonth.get(m).net;
    return { label: m, value: running };
  });
  return { netWorth: assets - liabilities, assets, liabilities, trend };
}

/** Renders a simple report as printable/exportable HTML text inside a container. */
export function renderReportTable(containerEl, title, rows, columns) {
  if (!containerEl) return;
  const esc = escapeHtml;
  const head = columns.map((c) => `<th style="text-align:left;padding:8px;font-size:11.5px;color:var(--text-faint);">${esc(c.label)}</th>`).join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${columns.map((c) => `<td style="padding:8px;border-top:1px solid var(--border);font-size:13px;">${esc(c.format ? c.format(r[c.key]) : r[c.key])}</td>`).join('')}</tr>`
    )
    .join('');
  containerEl.innerHTML = `
    <h4 style="margin-bottom:10px;">${esc(title)}</h4>
    <table style="width:100%;border-collapse:collapse;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
