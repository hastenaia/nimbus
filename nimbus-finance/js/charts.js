// Thin wrapper around Chart.js (loaded via CDN in index.html as window.Chart)
import { groupBy, sum, formatMoney } from './utils.js';

const instances = {};

function themeColors() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    text: dark ? '#A6ACBA' : '#5C6270',
    grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,17,21,0.06)',
    growth: dark ? '#34D399' : '#1FA37A',
    coral: dark ? '#FF6B6B' : '#E4573D',
    signal: dark ? '#818CF8' : '#5457D6',
    gold: dark ? '#F5A623' : '#C9820A',
    palette: ['#5457D6', '#1FA37A', '#E4573D', '#C9820A', '#EC4899', '#0EA5E9', '#8B5CF6', '#10B981'],
  };
}

function baseOptions(extra = {}) {
  const c = themeColors();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600, easing: 'easeOutQuart' },
    plugins: { legend: { labels: { color: c.text, boxWidth: 10, font: { size: 11 } } } },
    scales: extra.noScales
      ? {}
      : {
          x: { ticks: { color: c.text, font: { size: 10.5 } }, grid: { display: false } },
          y: { ticks: { color: c.text, font: { size: 10.5 } }, grid: { color: c.grid } },
        },
    ...extra.options,
  };
}

function render(canvasId, config) {
  const el = document.getElementById(canvasId);
  if (!el || !window.Chart) return;
  if (instances[canvasId]) instances[canvasId].destroy();
  instances[canvasId] = new window.Chart(el, config);
}

export function renderIncomeVsExpense(canvasId, transactions) {
  const c = themeColors();
  const byMonth = groupBy(transactions, (t) => t.occurred_on.slice(0, 7));
  const months = Object.keys(byMonth).sort().slice(-6);
  const income = months.map((m) => sum(byMonth[m].filter((t) => t.type === 'income'), (t) => t.amount));
  const expense = months.map((m) => sum(byMonth[m].filter((t) => t.type === 'expense'), (t) => t.amount));

  render(canvasId, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        { label: 'Income', data: income, backgroundColor: c.growth, borderRadius: 6 },
        { label: 'Expenses', data: expense, backgroundColor: c.coral, borderRadius: 6 },
      ],
    },
    options: baseOptions(),
  });
}

export function renderCategoryPie(canvasId, transactions, categories) {
  const c = themeColors();
  const expenses = transactions.filter((t) => t.type === 'expense');
  const byCat = groupBy(expenses, (t) => t.category_id || 'uncategorized');
  const labels = [];
  const data = [];
  Object.entries(byCat).forEach(([catId, txs]) => {
    const cat = categories.find((x) => x.id === catId);
    labels.push(cat?.name || 'Other');
    data.push(sum(txs, (t) => t.amount));
  });

  render(canvasId, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: c.palette, borderWidth: 0 }] },
    options: { ...baseOptions({ noScales: true }), cutout: '68%' },
  });
}

export function renderSavingsGrowth(canvasId, transactions) {
  const c = themeColors();
  const byMonth = groupBy(transactions, (t) => t.occurred_on.slice(0, 7));
  const months = Object.keys(byMonth).sort();
  let running = 0;
  const data = months.map((m) => {
    const inc = sum(byMonth[m].filter((t) => t.type === 'income'), (t) => t.amount);
    const exp = sum(byMonth[m].filter((t) => t.type === 'expense'), (t) => t.amount);
    running += inc - exp;
    return running;
  });

  render(canvasId, {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Cumulative Savings',
          data,
          borderColor: c.growth,
          backgroundColor: c.growth + '22',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
      ],
    },
    options: baseOptions(),
  });
}

export function renderCashFlow(canvasId, transactions) {
  const c = themeColors();
  const byMonth = groupBy(transactions, (t) => t.occurred_on.slice(0, 7));
  const months = Object.keys(byMonth).sort().slice(-6);
  const flow = months.map((m) => {
    const inc = sum(byMonth[m].filter((t) => t.type === 'income'), (t) => t.amount);
    const exp = sum(byMonth[m].filter((t) => t.type === 'expense'), (t) => t.amount);
    return inc - exp;
  });

  render(canvasId, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Net Cash Flow',
          data: flow,
          backgroundColor: flow.map((v) => (v >= 0 ? c.growth : c.coral)),
          borderRadius: 6,
        },
      ],
    },
    options: baseOptions(),
  });
}

export function renderBudgetBreakdown(canvasId, budgetProgress) {
  const c = themeColors();
  render(canvasId, {
    type: 'bar',
    data: {
      labels: budgetProgress.map((b) => b.categories?.name || 'Category'),
      datasets: [
        { label: 'Spent', data: budgetProgress.map((b) => b.spent), backgroundColor: c.signal, borderRadius: 6 },
        { label: 'Budget', data: budgetProgress.map((b) => b.amount), backgroundColor: c.grid, borderRadius: 6 },
      ],
    },
    options: { ...baseOptions(), indexAxis: 'y' },
  });
}

export function renderGrowthTimeline(canvasId, netWorthHistory) {
  const c = themeColors();
  render(canvasId, {
    type: 'line',
    data: {
      labels: netWorthHistory.map((p) => p.label),
      datasets: [
        {
          label: 'Net Worth',
          data: netWorthHistory.map((p) => p.value),
          borderColor: c.signal,
          backgroundColor: c.signal + '22',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
      ],
    },
    options: baseOptions(),
  });
}

/** Draws the signature concentric "health rings" SVG (Savings / Budget / Goals). */
export function renderHealthRings(svgEl, { savingsPct, budgetPct, goalPct }) {
  if (!svgEl) return;
  const c = themeColors();
  const rings = [
    { r: 54, pct: savingsPct, color: c.growth },
    { r: 40, pct: budgetPct, color: c.signal },
    { r: 26, pct: goalPct, color: c.gold },
  ];
  const size = 130;
  const center = size / 2;

  svgEl.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svgEl.innerHTML = rings
    .map((ring) => {
      const circumference = 2 * Math.PI * ring.r;
      const offset = circumference * (1 - Math.min(1, Math.max(0, ring.pct)));
      return `
        <circle cx="${center}" cy="${center}" r="${ring.r}" fill="none" stroke="${c.grid}" stroke-width="9"/>
        <circle cx="${center}" cy="${center}" r="${ring.r}" fill="none" stroke="${ring.color}" stroke-width="9"
          stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
          transform="rotate(-90 ${center} ${center})" style="transition: stroke-dashoffset 1s cubic-bezier(.22,1,.36,1)"/>
      `;
    })
    .join('');
}
