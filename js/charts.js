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

// Helper to show/hide chart vs empty state inside the SAME height wrapper.
// Empty message is centered within the chart area; no duplicate elements; wrap height preserved.
function toggleEmpty(canvasId, isEmpty, message) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const wrap = canvas.closest('div[style*="height"]') || canvas.parentElement;
  if (!wrap) return;
  // Ensure wrap can position overlay
  if (!wrap.dataset.emptyInit) {
    wrap.style.position = 'relative';
    wrap.dataset.emptyInit = '1';
  }
  let emptyEl = wrap.querySelector(':scope > .chart-empty');
  if (!emptyEl && message) {
    emptyEl = document.createElement('div');
    emptyEl.className = 'chart-empty empty-state';
    // Overlay centered inside wrap; wrap height already set inline (e.g. 260px)
    emptyEl.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px;text-align:center;';
    wrap.appendChild(emptyEl);
  }
  if (emptyEl) {
    if (message) emptyEl.innerHTML = `<div class="ico">📊</div>${message}`;
    emptyEl.style.display = isEmpty ? 'flex' : 'none';
  }
  canvas.style.display = isEmpty ? 'none' : 'block';
  // Never hide wrap — keep height so card doesn't collapse; empty overlays it
  wrap.style.display = 'block';
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
  // Phase 8: prefers persistent snapshots; falls back to derived only if no snapshots.
  // If hist <2, show appropriate empty state with inception date if available.
  if (hist.length < 2) {
    destroyChart(canvasId);
    let msg = 'Not enough history to show net-worth growth yet. Your historical net-worth tracking begins now — add assets/liabilities and keep logging transactions.';
    if (hist.length === 1 && hist[0].label) {
      msg = `Historical tracking begins on ${hist[0].label}. Add another snapshot to see growth.`;
    } else if (hist.length === 0) {
      // Check if we have a single inception date elsewhere — caller may pass empty; generic message stands.
      msg = 'No net-worth history yet. Historical tracking begins on ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' — add assets/liabilities to create your first snapshot.';
    }
    // If caller provided 1 point, show that point's date as inception
    toggleEmpty(canvasId, true, msg);
    return;
  }
  toggleEmpty(canvasId, false);
  const values = hist.map((p) => p.value);
  const hasVariance = values.some((v, i) => i > 0 && v !== values[i - 1]);
  // Multi-dataset: Net Worth + Assets + Liabilities (all from snapshots)
  const hasAssetsLiabilities = hist.some((p) => p.assets != null || p.liabilities != null);
  const datasets = [
    {
      label: 'Net Worth',
      data: values,
      borderColor: c.signal,
      backgroundColor: c.signal + '22',
      fill: true,
      tension: 0.35,
      pointRadius: hasVariance ? 0 : 3,
      pointBackgroundColor: c.signal,
      borderWidth: 2,
    },
  ];
  if (hasAssetsLiabilities) {
    datasets.push({
      label: 'Assets',
      data: hist.map((p) => p.assets ?? 0),
      borderColor: c.growth,
      backgroundColor: 'transparent',
      tension: 0.35,
      pointRadius: 0,
      borderWidth: 1.5,
      borderDash: [4, 4],
      fill: false,
    });
    datasets.push({
      label: 'Liabilities',
      data: hist.map((p) => p.liabilities ?? 0),
      borderColor: c.coral,
      backgroundColor: 'transparent',
      tension: 0.35,
      pointRadius: 0,
      borderWidth: 1.5,
      borderDash: [4, 4],
      fill: false,
    });
  }
  render(canvasId, {
    type: 'line',
    data: {
      labels: hist.map((p) => p.label),
      datasets,
    },
    options: baseOptions({
      tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatPeso(ctx.parsed.y)}` } },
    }),
  });
}

export function renderMoneyTrend(canvasId, series) {
  const c = themeColors();
  const pts = series?.points || [];
  const canvas = document.getElementById(canvasId);
  // Accessibility: role + descriptive label
  if (canvas) {
    canvas.setAttribute('role', 'img');
    const rangeLabel = series?.range ? ` for the last ${series.range.toLowerCase()}` : '';
    canvas.setAttribute('aria-label', `Money trend${rangeLabel} showing income, expenses, and net cash flow`);
  }
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
  const canvas = document.getElementById(canvasId);
  if (!dailySeries || dailySeries.length < 2) {
    destroyChart(canvasId);
    // Hide canvas without showing chart-empty (body already shows insufficient text)
    if (canvas) canvas.style.display = 'none';
    // Also hide any prior chart-empty overlay in this wrap
    const wrap = canvas?.closest('div[style*="height"]');
    const emptyEl = wrap?.querySelector(':scope > .chart-empty');
    if (emptyEl) emptyEl.style.display = 'none';
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

export function renderSavingsRateTrend(canvasId, trend) {
  const c = themeColors();
  const pts = trend || [];
  // Need at least 2 points to draw trend; otherwise empty state
  if (pts.length < 2) {
    destroyChart(canvasId);
    toggleEmpty(canvasId, true, pts.length === 0 ? 'No income history yet — log income to see savings rate trend.' : 'Add another month to see savings rate trend.');
    return;
  }
  toggleEmpty(canvasId, false);
  const canvas = document.getElementById(canvasId);
  if (canvas) {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Savings rate trend showing income minus expenses divided by income over time');
  }
  const labels = pts.map((p) => p.month);
  const data = pts.map((p) => p.rate);
  const opts = baseOptions({
    tooltip: {
      callbacks: {
        label: (ctx) => ` Savings rate: ${ctx.parsed.y.toFixed(1)}%`,
        afterLabel: (ctx) => {
          const pt = pts[ctx.dataIndex];
          return ` Net: ${formatPeso(pt.net)} · Income: ${formatPeso(pt.income)}`;
        },
      },
    },
  });
  opts.scales = {
    x: { ticks: { color: c.text, font: { size: 10.5 } }, grid: { display: false } },
    y: {
      ticks: {
        color: c.text,
        font: { size: 10.5 },
        callback: (v) => `${v}%`,
      },
      grid: { color: c.grid },
      suggestedMin: -10,
      suggestedMax: 40,
    },
  };
  render(canvasId, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Savings Rate',
          data,
          borderColor: c.growth,
          backgroundColor: c.growth + '22',
          fill: true,
          tension: 0.35,
          pointRadius: data.length > 6 ? 0 : 3,
          pointBackgroundColor: c.growth,
          borderWidth: 2,
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
