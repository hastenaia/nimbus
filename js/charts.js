// Thin wrapper around Chart.js (loaded via CDN in index.html as window.Chart).
// Charts render from a `summarizeTransactions()` summary so the transaction
// list is only walked once, and existing Chart instances are updated in place
// (no destroy/recreate churn on every re-render or theme toggle).

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
    animation: { duration: 300, easing: 'easeOutQuart' },
    plugins: { legend: { labels: { color: c.text, boxWidth: 10, font: { size: 11 } } }, tooltip: extra.tooltip || {} },
    scales: extra.noScales
      ? {}
      : {
          x: { ticks: { color: c.text, font: { size: 10.5 } }, grid: { display: false } },
          y: { ticks: { color: c.text, font: { size: 10.5 } }, grid: { color: c.grid } },
        },
    ...extra.options,
  };
}

function formatPeso(v) {
  try {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(v || 0));
  } catch { return `₱${Number(v || 0).toFixed(2)}`; }
}

// Helper to hide canvas when empty and show sibling empty-state div if present
function toggleEmpty(canvasId, isEmpty, message) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const wrap = canvas.closest('div[style*="height"]') || canvas.parentElement;
  const card = canvas.closest('.card');
  let emptyEl = card ? card.querySelector('.chart-empty') : null;
  if (!emptyEl && card && message) {
    emptyEl = document.createElement('div');
    emptyEl.className = 'chart-empty empty-state';
    emptyEl.style.padding = '18px';
    card.appendChild(emptyEl);
  }
  if (emptyEl) {
    emptyEl.textContent = message || '';
    emptyEl.style.display = isEmpty ? 'block' : 'none';
    // ensure icon prefix
    if (isEmpty && !emptyEl.querySelector('.ico')) {
      emptyEl.innerHTML = `<div class="ico">📊</div>${message}`;
    }
  }
  if (canvas) canvas.style.display = isEmpty ? 'none' : 'block';
  // keep wrapper height so card doesn't collapse
  if (wrap && wrap.style) wrap.style.display = isEmpty ? 'none' : 'block';
}

export function destroyChart(canvasId) {
  const inst = instances[canvasId];
  if (inst) { inst.destroy(); delete instances[canvasId]; }
}

/** Render a chart, reusing the existing instance when one exists for this canvas. */
function render(canvasId, config) {
  const el = document.getElementById(canvasId);
  if (!el || !window.Chart) return;
  const existing = instances[canvasId];
  if (existing) {
    existing.data = config.data;
    existing.options = config.options;
    existing.update();
    return;
  }
  instances[canvasId] = new window.Chart(el, config);
}

export function renderIncomeVsExpense(canvasId, summary) {
  const c = themeColors();
  const months = summary.months.slice(-6);
  const income = months.map((m) => summary.byMonth.get(m).income);
  const expense = months.map((m) => summary.byMonth.get(m).expense);

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

/** `monthCategories` is the per-month Map(category_id -> amount) from the summary. */
export function renderCategoryPie(canvasId, monthCategories, categories) {
  const c = themeColors();
  const labels = [];
  const data = [];
  monthCategories.forEach((amount, catId) => {
    const cat = categories.find((x) => x.id === catId);
    labels.push(cat?.name || 'Other');
    data.push(amount);
  });

  render(canvasId, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: c.palette, borderWidth: 0 }] },
    options: { ...baseOptions({ noScales: true }), cutout: '68%' },
  });
}

export function renderSavingsGrowth(canvasId, summary) {
  const c = themeColors();
  const months = summary.months || [];
  // Derived-only: cumulative net savings per month. Single-point is not shown as a line — empty state instead.
  if (months.length < 2) {
    destroyChart(canvasId);
    const msg = !months.length
      ? 'No savings history yet — log a few months of transactions to see growth.'
      : 'Add another month of transactions to see your savings trend. Historical savings tracking starts now — we keep what actually happened.';
    toggleEmpty(canvasId, true, msg);
    return;
  }
  toggleEmpty(canvasId, false);
  let running = 0;
  const data = months.map((m) => {
    running += summary.byMonth.get(m).net;
    return running;
  });
  // If all zeros/flat and only one real delta, still render but with visible points
  const hasVariance = data.some((v, i) => i > 0 && v !== data[i - 1]);

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
          pointRadius: hasVariance ? 0 : 3,
          pointBackgroundColor: c.growth,
        },
      ],
    },
    options: baseOptions({
      tooltip: {
        callbacks: {
          label: (ctx) => ` Savings: ${formatPeso(ctx.parsed.y)}`,
        },
      },
    }),
  });
}

export function renderCashFlow(canvasId, summary) {
  const c = themeColors();
  const months = summary.months.slice(-6);
  const flow = months.map((m) => summary.byMonth.get(m).net);

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
  const hist = netWorthHistory || [];
  // Derived-only: trend = cumulative net from transactions. Without snapshots history is thin.
  // LIMITATION: when <2 months, we cannot reconstruct past net worth — show empty state, not fake points.
  if (hist.length < 2) {
    destroyChart(canvasId);
    toggleEmpty(canvasId, true, 'Not enough history to show net-worth growth yet. Your historical net-worth tracking begins now — add assets/liabilities and keep logging transactions.');
    return;
  }
  toggleEmpty(canvasId, false);
  const values = hist.map((p) => p.value);
  const hasVariance = values.some((v, i) => i > 0 && v !== values[i - 1]);
  render(canvasId, {
    type: 'line',
    data: {
      labels: hist.map((p) => p.label),
      datasets: [
        {
          label: 'Net Worth',
          data: values,
          borderColor: c.signal,
          backgroundColor: c.signal + '22',
          fill: true,
          tension: 0.35,
          pointRadius: hasVariance ? 0 : 3,
          pointBackgroundColor: c.signal,
        },
      ],
    },
    options: baseOptions({
      tooltip: { callbacks: { label: (ctx) => ` Net Worth: ${formatPeso(ctx.parsed.y)}` } },
    }),
  });
}

export function renderMoneyTrend(canvasId, series) {
  const c = themeColors();
  const pts = series?.points || [];
  if (!pts.length || pts.length < 2) {
    destroyChart(canvasId);
    toggleEmpty(canvasId, true, 'Not enough transaction history to show this trend yet. Log income and expenses and it will appear here.');
    return;
  }
  toggleEmpty(canvasId, false);
  const labels = pts.map((p) => p.label);
  const opts = baseOptions({
    tooltip: {
      mode: 'index',
      intersect: false,
      callbacks: {
        title: (items) => (pts[items[0].dataIndex]?.key || items[0].label),
        label: (ctx) => {
          const pref = ctx.dataset.label === 'Income' ? 'Income' : ctx.dataset.label === 'Expenses' ? 'Expenses' : 'Net';
          return ` ${pref}: ${formatPeso(ctx.parsed.y)}`;
        },
      },
    },
  });
  opts.interaction = { mode: 'index', intersect: false };
  opts.scales = {
    x: { ticks: { color: c.text, font: { size: 10.5 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 }, grid: { display: false } },
    y: { ticks: { color: c.text, font: { size: 10.5 }, callback: (v) => formatPeso(v) }, grid: { color: c.grid } },
  };
  render(canvasId, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Income',
          data: pts.map((p) => p.income),
          borderColor: c.growth,
          backgroundColor: 'transparent',
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
          fill: false,
        },
        {
          label: 'Expenses',
          data: pts.map((p) => p.expense),
          borderColor: c.coral,
          backgroundColor: 'transparent',
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
          fill: false,
        },
        {
          label: 'Net Cash Flow',
          data: pts.map((p) => p.net),
          borderColor: c.signal,
          backgroundColor: c.signal + '18',
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2,
          fill: false,
        },
      ],
    },
    options: opts,
  });
}

export function renderForecastMini(canvasId, dailySeries) {
  const c = themeColors();
  if (!dailySeries || dailySeries.length < 2) {
    destroyChart(canvasId);
    return;
  }
  toggleEmpty(canvasId, false);
  const labels = dailySeries.map((_, i) => `${i}`);
  const opts = baseOptions({
    tooltip: { callbacks: { label: (ctx) => ` ${formatPeso(ctx.parsed.y)}` } },
  });
  opts.plugins = { ...opts.plugins, legend: { display: false } };
  opts.scales = {
    x: { display: false },
    y: { ticks: { color: c.text, font: { size: 9 } }, grid: { color: c.grid } },
  };
  render(canvasId, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          data: dailySeries,
          borderColor: c.signal,
          backgroundColor: c.signal + '14',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 1.8,
        },
      ],
    },
    options: opts,
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
