import { getSupabase } from './supabaseClient.js';
import { getSession, onAuthChange, wireAuthForms, signOut } from './auth.js';
import { initQuoteCard, showSpecialQuote } from './quotes.js';
import {
  loadCategories, getCategories, fetchTransactions, addTransaction,
  deleteTransaction, bulkAddTransactions, applyFilters, setFilters, renderTransactionList,
} from './transactions.js';
import { fetchBudgets, upsertBudget, deleteBudget, computeBudgetProgress, overallBudgetAdherence, renderBudgetList } from './budgets.js';
import { createCategory, deleteCategory } from './categories.js';
import { fetchGoals, createGoal, contributeToGoal, deleteGoal, renderGoalList } from './goals.js';
import { fetchNetWorthItems, upsertNetWorthItem, deleteNetWorthItem, computeNetWorth, renderNetWorthList, fetchNetWorthSnapshots, ensureTodaySnapshot } from './netWorth.js';
import { generateInsights, renderCoachCard, computeHeadline, answerCoachQuestion, toTypedInsights } from './coach.js';
import { buildVerifiedMetrics, getAIInsights } from './aiCoach.js';
import {
  renderIncomeVsExpense, renderCategoryPie, renderSavingsGrowth, renderCashFlow,
  renderBudgetBreakdown, renderGrowthTimeline, renderHealthRings, renderMoneyTrend, renderForecastMini,
  renderSavingsRateTrend,
} from './charts.js';
import { getMoneyTrendSeries, isValidRange } from './moneyTrend.js';
import { computeCashFlowForecast } from './forecast.js';
import { computeSafeToSpend } from './safeToSpend.js';
import { computeAnalytics } from './analytics.js';
import { runOcr, preloadOcr } from './ocr.js';
import { exportToJson, exportToCsv, exportToExcel, parseImportFile } from './importExport.js';
import { parseCsvWithPreview, buildPreviewFromRows, autoMapHeaders, checkFileSize, parseDateSafe } from './csvImport.js';
import { deleteTransactionsByIds } from './transactions.js';
import { fetchRecurring, addRecurring, deleteRecurring, generateDueTransactions, renderRecurringList } from './recurring.js';
import { parseGcashCsv } from './gcashImport.js';
import { suggestCategoryId } from './autocat.js';
import { financialGrowthReport, categoryReport, renderReportTable } from './reports.js';
import {
  formatMoney, monthKey, sum, toast, debounce,
  summarizeTransactions, emptyMonthSummary, calcHealthScore,
  computeSpendingConsistency, computeEmergencyRunway, computeDebtRatio,
} from './utils.js';

let currentUser = null;
let appBoot = null;
let state = {
  transactions: [],
  summary: { byMonth: new Map(), totalIncome: 0, totalExpense: 0, largestExpense: null, months: [] },
  budgetsProgress: [],
  goals: [],
  netWorthItems: [],
  netWorthSnapshots: [],
  recurring: [],
  moneyTrendRange: localStorage.getItem('nimbus_trend_range') || '30D',
};

// ---------------- THEME ----------------
function initTheme() {
  const saved = localStorage.getItem('nimbus_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('nimbus_theme', next);
    renderAll(); // re-render charts with new theme colors
  });
}

// ---------------- ROUTING ----------------
function initRouting() {
  document.querySelectorAll('[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => goToRoute(btn.dataset.route));
  });
}

function goToRoute(route) {
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${route}`));
  document.querySelectorAll('[data-route]').forEach((btn) => btn.classList.toggle('active', btn.dataset.route === route));
  if (route === 'reports') renderReports();
}

// ---------------- BOOTSTRAP ----------------
async function boot() {
  initTheme();
  initRouting();
  wireModals();
  wireFilters();
  wireAuthForms({ onAuthed: () => showApp() });
  wireCoach();
  wireDelegatedActions();
  wireCategorySuggest();

  const session = await getSession();
  if (session) await showApp(session);
  else showAuthScreen();

  onAuthChange((session) => {
    if (session) showApp(session);
    else showAuthScreen();
  });

  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await signOut();
    currentUser = null;
    showAuthScreen();
  });
}

function showAuthScreen() {
  document.getElementById('auth-screen')?.classList.remove('hidden');
  document.getElementById('app')?.classList.add('hidden');
}

/**
 * Boots the main app exactly once per login. Deduplicates the concurrent
 * triggers (Supabase emits SIGNED_IN inside signInWithPassword while the form
 * also calls onAuthed), which previously double-wired handlers and created
 * duplicate transactions/goals on every save.
 */
function showApp(session) {
  if (currentUser || appBoot) return appBoot || Promise.resolve();
  appBoot = doShowApp(session).finally(() => (appBoot = null));
  return appBoot;
}

async function doShowApp() {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getUser();
  currentUser = data.user;
  if (!currentUser) {
    showAuthScreen();
    return;
  }

  document.getElementById('auth-screen')?.classList.add('hidden');
  document.getElementById('app')?.classList.remove('hidden');
  document.getElementById('app-loading')?.classList.remove('hidden');

  const nameEl = document.getElementById('user-greeting-name');
  if (nameEl) nameEl.textContent = currentUser.user_metadata?.full_name?.split(' ')[0] || 'there';

  try {
    await loadCategories(currentUser.id);
    try {
      const generated = await generateDueTransactions(currentUser.id);
      if (generated > 0) toast(`Logged ${generated} recurring transaction${generated > 1 ? 's' : ''}`);
    } catch (err) {
      console.error('Recurring generation failed:', err);
    }
    await refreshAllData();
    await initQuoteCard(currentUser);
    checkMonthStart();
    renderAll();
    renderCategories();
  } finally {
    document.getElementById('app-loading')?.classList.add('hidden');
  }
}

function checkMonthStart() {
  const today = new Date();
  const key = `nimbus_month_greeted_${today.getFullYear()}-${today.getMonth()}`;
  if (today.getDate() <= 2 && !localStorage.getItem(key)) {
    showSpecialQuote('monthStart');
    localStorage.setItem(key, '1');
  }
}

async function refreshAllData() {
  const [tx, budgets, goals, netWorth, recurring, snapshots] = await Promise.all([
    fetchTransactions(currentUser.id),
    fetchBudgets(currentUser.id, monthKey()),
    fetchGoals(currentUser.id),
    fetchNetWorthItems(currentUser.id),
    fetchRecurring(currentUser.id),
    fetchNetWorthSnapshots(currentUser.id),
  ]);
  state.transactions = tx;
  state.summary = summarizeTransactions(tx);
  const monthSpend = state.summary.byMonth.get(monthKey().slice(0, 7))?.categories || new Map();
  state.budgetsProgress = computeBudgetProgress(budgets, monthSpend);
  state.goals = goals;
  state.netWorthItems = netWorth;
  state.netWorthSnapshots = snapshots || [];
  state.recurring = recurring;
}

// ---------------- RENDER ----------------
function renderAll() {
  renderDashboard();
  renderTransactionsPage();
  renderBudgetsPage();
  renderGoalsPage();
  renderNetWorthPage();
  renderRecurring();
}

function renderRecurring() {
  renderRecurringList(document.getElementById('recurring-list'), state.recurring, getCategories());
}

function renderDashboard() {
  const thisMonth = monthKey().slice(0, 7);
  const s = state.summary;
  const thisM = s.byMonth.get(thisMonth) || emptyMonthSummary();
  const income = thisM.income;
  const expenses = thisM.expense;
  const savings = thisM.net;
  const savingsRate = income > 0 ? (savings / income) * 100 : 0;
  const balance = s.totalIncome - s.totalExpense;

  setText('stat-balance', formatMoney(balance));
  setText('stat-income', formatMoney(income));
  setText('stat-expenses', formatMoney(expenses));
  setText('stat-savings', formatMoney(savings));
  setText('stat-savings-rate', `${savingsRate.toFixed(1)}%`);

  const budgetAdherence = overallBudgetAdherence(state.budgetsProgress);
  const goalProgress = state.goals.length
    ? sum(state.goals, (g) => Math.min(1, g.current_amount / g.target_amount)) / state.goals.length
    : 0;

  // Improved health score with additional derived factors
  const spendingConsistency = computeSpendingConsistency(s);
  const emergencyRunway = computeEmergencyRunway(balance, s);
  const debtRatio = computeDebtRatio(state.netWorthItems);

  renderHealthRings(document.getElementById('health-rings-svg'), {
    savingsPct: Math.min(1, savingsRate / 20),
    budgetPct: budgetAdherence,
    goalPct: goalProgress,
  });
  const healthScore = calcHealthScore({ savingsRate, budgetAdherence, goalProgress, spendingConsistency, emergencyRunway, debtRatio });
  setText('health-score-value', `${healthScore}`);

  const largest = s.largestExpense && (s.largestExpense.occurred_on || '').slice(0, 7) === thisMonth ? s.largestExpense : null;
  setText('stat-largest-expense', largest ? formatMoney(largest.amount) : '—');

  renderTransactionList(document.getElementById('recent-tx-list'), state.transactions.slice(0, 6));

  // Forecast & Safe to Spend computed first so coach can reference them
  const forecast = computeCashFlowForecast({ transactions: state.transactions, recurring: state.recurring, balance });
  const safeToSpend = computeSafeToSpend({ balance, recurring: state.recurring, budgetsProgress: state.budgetsProgress, goals: state.goals, transactions: state.transactions });
  renderForecastCard(forecast);
  renderSafeToSpendCard(safeToSpend);
  renderMoneyTrendCard();

  // Advanced Analytics — reuses summary (no extra queries)
  const analytics = computeAnalytics({ summary: s, categories: getCategories(), currentMonthKey: thisMonth });
  renderAnalyticsMoM(analytics);
  renderAnalyticsInsights(analytics);
  renderSavingsRateTrend('chart-savings-rate-trend', analytics.savingsRateTrend);

  // Local rule-based insights (instant fallback, never fabricated)
  const localInsightsRaw = generateInsights({ ...coachContext(), forecast, safeToSpend });
  const localInsights = toTypedInsights(localInsightsRaw, { summary: s, transactions: state.transactions });
  renderCoachCard(document.getElementById('coach-card-body'), localInsights, { showConfidence: true });
  let headline = computeHeadline(localInsights);
  const headlineEl = document.getElementById('coach-headline');
  if (headlineEl) {
    headlineEl.textContent = headline.text;
    headlineEl.className = `coach-headline ${headline.cls}`;
  }
  // Disclaimer (safety)
  const disclaimerEl = document.getElementById('coach-disclaimer');
  if (disclaimerEl) disclaimerEl.style.display = 'block';

  // Phase 9: Try server-side AI with verified metrics — deduplicated, falls back to local
  try {
    const verified = buildVerifiedMetrics({
      summary: s,
      currentMonthKey: thisMonth,
      transactions: state.transactions,
      budgetsProgress: state.budgetsProgress,
      goals: state.goals,
      categories: getCategories(),
      netWorthItems: state.netWorthItems,
      forecast,
      safeToSpend,
      analytics,
      healthScore,
      recurring: state.recurring,
    });
    // Fire-and-forget AI, but deduped inside aiCoach.js
    getAIInsights(verified).then((aiRes) => {
      if (!aiRes || aiRes.fallback || !aiRes.insights || !aiRes.insights.length) return; // keep local fallback
      // AI insights are already grounded in verified metrics server-side; render with same card
      const mapped = aiRes.insights.map((ins, idx) => ({
        id: `ai-${idx}`,
        group: ins.type || 'ai',
        insightType: ins.type,
        icon: ins.icon || '🤖',
        text: ins.text,
        actionableText: ins.action,
        priority: 2,
        confidence: ins.confidence || 'high',
      }));
      const typedAI = toTypedInsights(mapped, { summary: s, transactions: state.transactions });
      renderCoachCard(document.getElementById('coach-card-body'), typedAI, { showConfidence: true });
      headline = computeHeadline(typedAI);
      if (headlineEl) {
        headlineEl.textContent = `AI · ${headline.text}`;
        headlineEl.className = `coach-headline ${headline.cls}`;
      }
    }).catch(() => { /* keep fallback */ });
  } catch (_) { /* keep fallback */ }

  renderIncomeVsExpense('chart-income-expense', s);
  renderCategoryPie('chart-category-pie', thisM.categories, getCategories());
  renderSavingsGrowth('chart-savings-growth', s);
}

function renderMoneyTrendCard() {
  const range = state.moneyTrendRange || '30D';
  const series = getMoneyTrendSeries(state.transactions, range);
  renderMoneyTrend('chart-money-trend', series);
  // Sync active button states
  document.querySelectorAll('.range-btn').forEach((btn) => {
    const isActive = btn.dataset.range === range;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

function renderForecastCard(forecast) {
  const body = document.getElementById('forecast-body');
  if (!body) return;
  if (forecast.insufficient) {
    body.innerHTML = `<div style="padding:10px 0;color:var(--text-dim);font-size:13.5px;line-height:1.5;">${escapeHtml(forecast.reason)}</div>`;
    const c = document.getElementById('chart-forecast-mini');
    if (c) c.style.display = 'none';
    return;
  }
  const trendIcon = forecast.estimatedBalance >= forecast.currentBalance ? '📈' : '📉';
  const diff = forecast.estimatedBalance - forecast.currentBalance;
  const diffColor = diff >= 0 ? 'var(--growth)' : 'var(--coral)';
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:6px;">
      <div><div class="kpi-sub">Current balance</div><div class="kpi-big mono">${formatMoney(forecast.currentBalance)}</div></div>
      <div><div class="kpi-sub">Estimated balance</div><div class="kpi-big mono" style="color:${diffColor}">${formatMoney(forecast.estimatedBalance)}</div></div>
    </div>
    <div style="margin-top:10px;display:flex;gap:12px;flex-wrap:wrap;font-size:12.5px;color:var(--text-dim);">
      <span>${trendIcon} Next ${forecast.forecastDays} days</span>
      <span>· Avg ${formatMoney(forecast.avgDailyNet)}/day</span>
      ${forecast.recurringExpenses ? `<span>· Upcoming bills ${formatMoney(forecast.recurringExpenses)}</span>` : ''}
    </div>
  `;
  const c = document.getElementById('chart-forecast-mini');
  if (c) c.style.display = 'block';
  renderForecastMini('chart-forecast-mini', forecast.dailySeries);
}

function renderSafeToSpendCard(res) {
  const body = document.getElementById('safe-body');
  if (!body) return;
  if (res.insufficient) {
    body.innerHTML = `<div style="padding:10px 0;color:var(--text-dim);font-size:13.5px;line-height:1.5;">${escapeHtml(res.reason)}</div>`;
    return;
  }
  const warn = res.warning ? `<div style="margin-top:8px;font-size:12.5px;color:var(--gold);">${escapeHtml(res.warning)}</div>` : '';
  const low = res.lowConfidence ? `<div style="margin-top:6px;font-size:11.5px;color:var(--text-faint);">Low confidence — add more income data for a tighter estimate.</div>` : '';
  body.innerHTML = `
    <div style="margin-top:6px;">
      <div class="kpi-sub" style="letter-spacing:.06em;text-transform:uppercase;font-weight:700;">Safe to Spend</div>
      <div class="kpi-big mono" style="font-size:32px;">${formatMoney(res.safeDaily)}/day</div>
      <div style="font-size:13px;color:var(--text-dim);">${formatMoney(res.safeMonthly)} for the rest of the month · ${res.daysRemaining} days left</div>
    </div>
    <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:var(--text-faint);">
      <span>Upcoming bills: ${formatMoney(res.breakdown.upcomingRecurringExpenses)}</span>
      <span>Reserved for goals: ${formatMoney(res.breakdown.goalReserve)}</span>
      <span>Buffer (${res.buffer > 0 ? Math.round((res.buffer / Math.max(1, res.safeMonthly + res.buffer))*100) : 0}%): ${formatMoney(res.breakdown.buffer)}</span>
      <span>Expected income: ${formatMoney(res.breakdown.expectedIncome)}</span>
    </div>
    ${warn}${low}
  `;
}

function formatDelta(change) {
  if (change == null) return { text: '—', cls: 'neutral', arrow: '' };
  const v = Number(change);
  if (Math.abs(v) < 0.05) return { text: '0.0%', cls: 'neutral', arrow: '→' };
  const arrow = v > 0 ? '↑' : '↓';
  const cls = v > 0 ? 'up' : 'down';
  return { text: `${v > 0 ? '+' : ''}${v.toFixed(1)}%`, cls, arrow: arrow + ' ' };
}

function renderAnalyticsMoM(a) {
  const grid = document.getElementById('analytics-mom-grid');
  const trendEl = document.getElementById('analytics-spending-trend');
  if (!grid) return;
  const m = a.mom;
  const mk = (val, change) => {
    const d = formatDelta(change);
    // For expenses, increase is bad (red), decrease is good (green) — invert color
    // But keep generic: we color net/income up = green, expenses up = red.
    return { d, val };
  };
  // Build 4 cells: Income, Expenses, Net, Savings Rate
  const incomeDelta = formatDelta(m.income.change);
  const expDelta = formatDelta(m.expenses.change);
  // For expenses delta, swap color: up is bad
  const expCls = expDelta.cls === 'up' ? 'down' : expDelta.cls === 'down' ? 'up' : 'neutral';
  const netDelta = formatDelta(m.net.change);
  const rateDelta = m.savingsRate.changeAbs != null ? { text: `${m.savingsRate.changeAbs > 0 ? '+' : ''}${m.savingsRate.changeAbs.toFixed(1)} pts`, cls: m.savingsRate.changeAbs > 0 ? 'up' : m.savingsRate.changeAbs < 0 ? 'down' : 'neutral', arrow: m.savingsRate.changeAbs > 0 ? '↑ ' : m.savingsRate.changeAbs < 0 ? '↓ ' : '→ ' } : { text: '—', cls: 'neutral', arrow: '' };

  grid.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;">
      <div style="background:var(--surface-solid);border:1px solid var(--border);border-radius:12px;padding:12px;">
        <div class="kpi-sub" style="margin-bottom:4px;">Income</div>
        <div class="mono" style="font-weight:700;font-size:16px;">${formatMoney(m.income.curr)}</div>
        <div class="stat-delta ${incomeDelta.cls}" style="font-size:11.5px;">${incomeDelta.arrow}${incomeDelta.text}${!m.hasPrev ? '<span style="color:var(--text-faint);font-weight:400;"> · no prior data</span>' : ''}</div>
      </div>
      <div style="background:var(--surface-solid);border:1px solid var(--border);border-radius:12px;padding:12px;">
        <div class="kpi-sub" style="margin-bottom:4px;">Expenses</div>
        <div class="mono" style="font-weight:700;font-size:16px;">${formatMoney(m.expenses.curr)}</div>
        <div class="stat-delta ${expCls}" style="font-size:11.5px;">${expDelta.arrow}${expDelta.text}${!m.hasPrev ? '<span style="color:var(--text-faint);font-weight:400;"> · no prior data</span>' : ''}</div>
      </div>
      <div style="background:var(--surface-solid);border:1px solid var(--border);border-radius:12px;padding:12px;">
        <div class="kpi-sub" style="margin-bottom:4px;">Net Cash Flow</div>
        <div class="mono" style="font-weight:700;font-size:16px;color:${m.net.curr >=0 ? 'var(--growth)' : 'var(--coral)'}">${formatMoney(m.net.curr)}</div>
        <div class="stat-delta ${netDelta.cls}" style="font-size:11.5px;">${netDelta.arrow}${netDelta.text}${!m.hasPrev ? '<span style="color:var(--text-faint);font-weight:400;"> · no prior data</span>' : ''}</div>
      </div>
      <div style="background:var(--surface-solid);border:1px solid var(--border);border-radius:12px;padding:12px;">
        <div class="kpi-sub" style="margin-bottom:4px;">Savings Rate</div>
        <div class="mono" style="font-weight:700;font-size:16px;">${m.savingsRate.curr.toFixed(1)}%</div>
        <div class="stat-delta ${rateDelta.cls}" style="font-size:11.5px;">${rateDelta.arrow}${rateDelta.text}${!m.hasPrev ? '<span style="color:var(--text-faint);font-weight:400;"> · no prior data</span>' : ''}</div>
      </div>
    </div>`;
  if (trendEl) {
    // Spending trend doc: >5% increase = increasing, <-5% decreasing, else stable
    const t = a.spendingTrend;
    const icon = t.status === 'increasing' ? '📈' : t.status === 'decreasing' ? '📉' : '➖';
    const color = t.status === 'increasing' ? 'var(--coral)' : t.status === 'decreasing' ? 'var(--growth)' : 'var(--text-faint)';
    const pctStr = t.changePct != null ? ` (${t.changePct >0?'+':''}${t.changePct.toFixed(1)}% vs last month)` : '';
    const doc = '<span style="font-size:10px;color:var(--text-faint);"> · threshold ±5%</span>';
    trendEl.innerHTML = `<span style="color:${color};font-weight:600;">${icon} Spending is ${t.label.toLowerCase()}</span><span>${pctStr}</span>${doc}`;
  }
}

function renderAnalyticsInsights(a) {
  const insightEl = document.getElementById('analytics-insight-body');
  const topEl = document.getElementById('analytics-top-cats');
  const anomEl = document.getElementById('analytics-anomalies');
  if (insightEl) {
    const ins = a.insight;
    if (ins) {
      insightEl.innerHTML = `<div class="coach-insight"><span class="coach-insight-ico">${ins.icon}</span><div class="coach-insight-body">${escapeHtml(ins.text)}</div></div>`;
    } else {
      insightEl.innerHTML = `<div style="color:var(--text-faint);font-size:13px;">No insight yet.</div>`;
    }
  }
  if (topEl) {
    if (!a.topCategories.length) {
      topEl.innerHTML = `<div style="color:var(--text-faint);font-size:12.5px;">No expense categories this month.</div>`;
    } else {
      topEl.innerHTML = a.topCategories.map((tc, idx) => {
        const ch = tc.changePct == null ? '<span style="color:var(--text-faint);">— no prior data</span>' : `<span class="mono" style="color:${tc.changePct>0?'var(--coral)':'var(--growth)'}">${tc.changePct>0?'+':''}${tc.changePct.toFixed(1)}% vs last month</span>`;
        return `<div class="tx-row" style="padding:8px 0;">
          <div class="tx-icon" style="background:${tc.color ? tc.color+'22' : 'var(--signal-soft)'}">${tc.icon||'🏷️'}</div>
          <div class="tx-main">
            <div class="tx-title" style="font-size:13px;">${idx+1}. ${escapeHtml(tc.name)} <span style="font-weight:400;color:var(--text-faint);font-size:11.5px;">· ${tc.pctOfExpenses.toFixed(1)}% of expenses</span></div>
            <div class="tx-meta">${formatMoney(tc.currentAmount)} · ${ch}</div>
          </div>
        </div>`;
      }).join('');
    }
  }
  if (anomEl) {
    if (!a.anomalies.length) {
      anomEl.innerHTML = `<div style="font-size:12px;color:var(--text-faint);margin-top:8px;">No spending anomalies detected — based on your own history (mean + 1.5×stddev).</div>`;
    } else {
      anomEl.innerHTML = `<div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--gold);margin-bottom:6px;">Spending Anomalies</div>` +
        a.anomalies.map((an) => `<div style="font-size:12.5px;color:var(--text-dim);display:flex;gap:8px;margin-top:4px;"><span>${an.icon||'⚠️'}</span><span>${escapeHtml(an.name)} — ${escapeHtml(an.reason)}</span></div>`).join('');
    }
  }
}

function renderTransactionsPage() {
  const filters = setFilters({});
  const filtered = applyFilters(state.transactions, filters);
  renderTransactionList(document.getElementById('tx-full-list'), filtered);
}

function renderBudgetsPage() {
  renderBudgetList(document.getElementById('budget-list'), state.budgetsProgress);
  renderBudgetBreakdown('chart-budget-breakdown', state.budgetsProgress);
}

function renderGoalsPage() {
  renderGoalList(document.getElementById('goals-list'), state.goals);
}

function renderNetWorthPage() {
  renderNetWorthList(document.getElementById('networth-list'), state.netWorthItems);
  const { assets, liabilities, netWorth } = computeNetWorth(state.netWorthItems);
  setText('networth-assets', formatMoney(assets));
  setText('networth-liabilities', formatMoney(liabilities));
  setText('networth-total', formatMoney(netWorth));
  // Phase 8: prefer persistent snapshots; fallback to derived only if no snapshots yet (no fake history)
  let trend = [];
  if (state.netWorthSnapshots && state.netWorthSnapshots.length) {
    trend = state.netWorthSnapshots.map((s) => ({
      label: s.snapshot_date,
      value: Number(s.net_worth),
      assets: Number(s.assets),
      liabilities: Number(s.liabilities),
    }));
  } else {
    const growth = financialGrowthReport(state.summary, state.netWorthItems);
    trend = growth.trend;
    // If still empty/single point, Growth Timeline will show inception message via charts.js
  }
  renderGrowthTimeline('chart-growth-timeline', trend);
  renderCashFlow('chart-cash-flow', state.summary);
  // Show inception notice when no history (supplements chart empty state)
  const noticeEl = document.getElementById('networth-inception-notice');
  if (noticeEl) {
    if (!state.netWorthSnapshots.length) {
      const first = state.netWorthSnapshots[0] || null;
      const dateStr = first ? first.snapshot_date : new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      if ((trend.length < 2 && state.netWorthSnapshots.length === 0) || state.summary.months.length < 2) {
        noticeEl.textContent = `Historical tracking begins on ${dateStr} — no fake history. Your first snapshot will be created when you add assets/liabilities.`;
        noticeEl.style.display = 'block';
      } else {
        noticeEl.style.display = 'none';
      }
    } else if (state.netWorthSnapshots.length === 1) {
      noticeEl.textContent = `Historical tracking begins on ${state.netWorthSnapshots[0].snapshot_date}. Add another day’s snapshot to see growth.`;
      noticeEl.style.display = 'block';
    } else {
      noticeEl.style.display = 'none';
    }
  }
}

function renderReports() {
  const container = document.getElementById('reports-body');
  if (!container) return;
  const cat = categoryReport(state.transactions, getCategories(), 'expense');
  renderReportTable(container, 'Expenses by Category', cat, [
    { key: 'category', label: 'Category' },
    { key: 'total', label: 'Total', format: formatMoney },
    { key: 'count', label: 'Transactions' },
  ]);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderCategories() {
  const el = document.getElementById('category-list');
  if (!el) return;
  const cats = getCategories();
  if (!cats.length) {
    el.innerHTML = `<div class="empty-state"><div class="ico">🏷️</div>No categories yet. Add your first one above.</div>`;
    return;
  }
  el.innerHTML = cats
    .map((c) => `
      <div class="tx-row" data-id="${c.id}">
        <div class="tx-icon" style="background:${c.color ? c.color + '22' : 'var(--signal-soft)'}">${c.icon || '💸'}</div>
        <div class="tx-main">
          <div class="tx-title">${escapeHtml(c.name)}</div>
          <div class="tx-meta">${c.type === 'income' ? 'Income' : 'Expense'}${c.is_default ? ' · Default' : ''}</div>
        </div>
        <button class="row-del" data-del="${c.id}" aria-label="Delete category" title="Delete">✕</button>
      </div>`)
    .join('');
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ---------------- MODALS / FORMS ----------------
function wireModals() {
  wireTransactionModal();
  wireBudgetModal();
  wireGoalModal();
  wireNetWorthModal();
  wireOcrModal();
  wireCategoryModal();
  wireCategoryList();
  wireImportExport();
  wireRowDeletes();
  wireRecurringModal();
  wireRecurringList();

  document.querySelectorAll('[data-open-modal]').forEach((btn) => {
    btn.addEventListener('click', () => openModal(btn.dataset.openModal));
  });
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.modal-backdrop')?.classList.remove('open'));
  });
}

function openModal(id) {
  populateCategorySelects();
  if (id === 'modal-ocr') preloadOcr();
  document.getElementById(id)?.classList.add('open');
}

function populateCategorySelects() {
  const cats = getCategories();
  document.querySelectorAll('.category-select').forEach((sel) => {
    const currentType = sel.dataset.filterType;
    const options = cats.filter((c) => !currentType || c.type === currentType);
    const keepAll = sel.querySelector('option[value="all"]') !== null;
    sel.innerHTML =
      (keepAll ? '<option value="all">All</option>' : '') +
      options.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
  });
}

function wireTransactionModal() {
  const form = document.getElementById('tx-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await addTransaction(currentUser.id, {
        type: fd.get('type'),
        amount: parseFloat(fd.get('amount')),
        category_id: fd.get('category_id') || null,
        payment_method: fd.get('payment_method'),
        description: fd.get('description'),
        notes: fd.get('notes'),
        occurred_on: fd.get('occurred_on'),
        is_recurring: fd.get('is_recurring') === 'on',
      });
      form.reset();
      document.getElementById('modal-tx')?.classList.remove('open');
      await refreshAllData();
      renderAll();
    } catch (err) {
      toast(err.message || 'Could not save transaction');
    }
  });
}

function wireBudgetModal() {
  const form = document.getElementById('budget-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await upsertBudget(currentUser.id, fd.get('category_id'), monthKey(), parseFloat(fd.get('amount')));
      form.reset();
      document.getElementById('modal-budget')?.classList.remove('open');
      await refreshAllData();
      renderAll();
    } catch (err) {
      toast(err.message || 'Could not save budget');
    }
  });
}

function wireRecurringModal() {
  const form = document.getElementById('recurring-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await addRecurring(currentUser.id, {
        type: fd.get('type'),
        amount: parseFloat(fd.get('amount')),
        category_id: fd.get('category_id'),
        payment_method: fd.get('payment_method'),
        description: fd.get('description'),
        frequency: fd.get('frequency'),
        next_run: fd.get('next_run') || new Date().toISOString().slice(0, 10),
      });
      form.reset();
      document.getElementById('modal-recurring')?.classList.remove('open');
      state.recurring = await fetchRecurring(currentUser.id);
      renderRecurring();
    } catch (err) {
      toast(err.message || 'Could not save recurring transaction');
    }
  });
}

function wireRecurringList() {
  document.getElementById('recurring-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.row-del');
    if (!btn || !confirm('Delete this recurring transaction?')) return;
    try {
      await deleteRecurring(btn.dataset.del);
      state.recurring = await fetchRecurring(currentUser.id);
      renderRecurring();
    } catch (err) {
      toast(err.message || 'Could not delete');
    }
  });
}

function wireCategorySuggest() {
  const desc = document.querySelector('#tx-form [name="description"]');
  const typeSel = document.querySelector('#tx-form [name="type"]');
  const catSel = document.querySelector('#tx-form [name="category_id"]');
  if (!desc || !typeSel || !catSel) return;

  const apply = debounce(() => {
    const suggested = suggestCategoryId(desc.value, typeSel.value, getCategories(), state.transactions);
    if (catSel.value === '' || catSel.value === (suggested || '')) {
      if (suggested) catSel.value = suggested;
    }
  }, 300);

  desc.addEventListener('input', apply);
  typeSel.addEventListener('change', () => {
    catSel.value = '';
    if (desc.value.trim()) apply();
  });
}

function wireGoalModal() {
  const form = document.getElementById('goal-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await createGoal(currentUser.id, {
        name: fd.get('name'),
        target_amount: parseFloat(fd.get('target_amount')),
        current_amount: parseFloat(fd.get('current_amount') || 0),
        deadline: fd.get('deadline') || null,
        icon: fd.get('icon') || '🎯',
      });
      form.reset();
      document.getElementById('modal-goal')?.classList.remove('open');
      await refreshAllData();
      renderAll();
    } catch (err) {
      toast(err.message || 'Could not create goal');
    }
  });

  document.getElementById('goals-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.contribute-btn');
    if (!btn) return;
    const amount = prompt('How much would you like to add?');
    if (!amount || isNaN(parseFloat(amount))) return;
    const goal = state.goals.find((g) => g.id === btn.dataset.goalId);
    if (!goal) return;
    try {
      await contributeToGoal(goal, parseFloat(amount));
      await refreshAllData();
      renderAll();
    } catch (err) {
      toast(err.message || 'Could not add contribution');
    }
  });
}

function wireNetWorthModal() {
  const form = document.getElementById('networth-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      const saved = await upsertNetWorthItem(currentUser.id, {
        kind: fd.get('kind'),
        name: fd.get('name'),
        value: parseFloat(fd.get('value')),
      });
      // Phase 8: snapshot today's calculated state after mutation (upsert per user+date, no duplicates)
      try {
        const freshItems = await fetchNetWorthItems(currentUser.id);
        await ensureTodaySnapshot(currentUser.id, freshItems);
      } catch (snapErr) { console.warn('snapshot failed', snapErr); }
      form.reset();
      document.getElementById('modal-networth')?.classList.remove('open');
      await refreshAllData();
      renderAll();
    } catch (err) {
      toast(err.message || 'Could not save entry');
    }
  });
}

function wireOcrModal() {
  const input = document.getElementById('ocr-file-input');
  const progressEl = document.getElementById('ocr-progress');
  const confirmForm = document.getElementById('ocr-confirm-form');

  input?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    progressEl.textContent = 'Reading receipt… 0%';
    document.getElementById('ocr-confirm-section')?.classList.add('hidden');
    try {
      const { parsed } = await runOcr(file, (pct) => {
        progressEl.textContent = `Reading receipt… ${pct}%`;
      });
      progressEl.textContent = 'Review and correct before saving:';
      document.getElementById('ocr-confirm-section')?.classList.remove('hidden');
      document.getElementById('ocr-amount').value = parsed.amount || '';
      document.getElementById('ocr-date').value = parsed.date || '';
      document.getElementById('ocr-merchant').value = parsed.merchant || '';
      document.getElementById('ocr-reference').value = parsed.reference || '';
      document.getElementById('ocr-type').value = parsed.type || 'expense';
    } catch (err) {
      progressEl.textContent = 'Could not read this image. Try a clearer screenshot.';
      console.error(err);
    }
  });

  confirmForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(confirmForm);
    try {
      await addTransaction(currentUser.id, {
        type: fd.get('type'),
        amount: parseFloat(fd.get('amount')),
        payment_method: 'gcash',
        description: fd.get('merchant') || 'GCash transaction',
        notes: fd.get('reference') ? `Ref: ${fd.get('reference')}` : '',
        occurred_on: fd.get('date') || new Date().toISOString().slice(0, 10),
        source: 'ocr',
      });
      confirmForm.reset();
      document.getElementById('modal-ocr')?.classList.remove('open');
      await refreshAllData();
      renderAll();
    } catch (err) {
      toast(err.message || 'Could not save transaction');
    }
  });
}

function wireCategoryModal() {
  const form = document.getElementById('category-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await createCategory(currentUser.id, {
        name: fd.get('name'),
        type: fd.get('type'),
        icon: fd.get('icon'),
        color: fd.get('color'),
      });
      form.reset();
      const icon = form.querySelector('[name="icon"]');
      const color = form.querySelector('[name="color"]');
      if (icon) icon.value = '💸';
      if (color) color.value = '#6366F1';
      document.getElementById('modal-category')?.classList.remove('open');
      await loadCategories(currentUser.id);
      populateCategorySelects();
      renderCategories();
      renderAll();
    } catch (err) {
      toast(err.message || 'Could not create category');
    }
  });
}

function wireCategoryList() {
  document.getElementById('category-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.row-del');
    if (!btn || !confirm('Delete this category? Budgets for it will be removed too.')) return;
    try {
      await deleteCategory(btn.dataset.del);
      setFilters({ category: 'all' });
      const filter = document.getElementById('tx-filter-category');
      if (filter) filter.value = 'all';
      await loadCategories(currentUser.id);
      populateCategorySelects();
      renderCategories();
      renderAll();
    } catch (err) {
      toast(err.message || 'Could not delete category');
    }
  });
}

let pendingPreview = null;
let pendingHeaders = null;

function formatMoneyCompact(n){ try{return new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(n)}catch{return `₱${Number(n).toFixed(2)}`} }

function renderImportPreview(preview) {
  pendingPreview = preview;
  const statsEl = document.getElementById('import-preview-stats');
  const mapEl = document.getElementById('import-mapping');
  const errEl = document.getElementById('import-preview-errors');
  const headEl = document.getElementById('import-preview-head');
  const bodyEl = document.getElementById('import-preview-body');
  const dupCountEl = document.getElementById('dup-count');
  const confirmBtn = document.getElementById('import-confirm-btn');
  const undoEl = document.getElementById('import-undo');
  if (undoEl) undoEl.style.display = 'none';

  if (!preview || preview.empty) {
    statsEl.innerHTML = `<div style="padding:12px;color:var(--coral);">Empty file — no rows found.</div>`;
    if (confirmBtn) confirmBtn.disabled = true;
    return;
  }
  const s = preview.stats;
  const warn = checkFileSize(s.total);
  statsEl.innerHTML = `
    <div style="border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--text-faint);">Rows</div><div class="mono" style="font-weight:700;">${s.total}</div></div>
    <div style="border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--text-faint);">Valid</div><div class="mono" style="font-weight:700;color:var(--growth);">${s.valid}</div></div>
    <div style="border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--text-faint);">Invalid</div><div class="mono" style="font-weight:700;color:var(--coral);">${s.invalid}</div></div>
    <div style="border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--text-faint);">Duplicates</div><div class="mono" style="font-weight:700;color:var(--gold);">${s.duplicates}</div></div>
    <div style="border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--text-faint);">Income</div><div class="mono" style="font-weight:700;">${s.income} · ${formatMoneyCompact(s.totalIncome)}</div></div>
    <div style="border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--text-faint);">Expenses</div><div class="mono" style="font-weight:700;">${s.expense} · ${formatMoneyCompact(s.totalExpense)}</div></div>
    ${warn ? `<div style="grid-column:1/-1;font-size:11px;color:var(--gold);text-align:center;">${warn.warn}</div>` : '' }
  `;
  // Column mapping UI
  const allFields = ['date','amount','type','category','description','payment_method','notes'];
  const labels = {date:'Date *', amount:'Amount *', type:'Type', category:'Category', description:'Description', payment_method:'Payment Method', notes:'Notes'};
  mapEl.innerHTML = allFields.map(field => {
    const cur = preview.mapping[field] || '';
    const opts = ['<option value="">— not mapped —</option>'].concat(preview.headers.map(h=> `<option value="${escapeHtml(h)}" ${h===cur?'selected':''}>${escapeHtml(h)}</option>`)).join('');
    return `<div class="field" style="margin-bottom:4px;"><label style="font-size:11px;">${labels[field]}</label><select data-map-field="${field}" style="font-size:12.5px;padding:6px 8px;">${opts}</select></div>`;
  }).join('');
  // wire mapping changes
  mapEl.querySelectorAll('select').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      const field = sel.dataset.mapField;
      const val = sel.value;
      if (val) preview.mapping[field]=val; else delete preview.mapping[field];
      const newPreview = buildPreviewFromRows(preview.headers, preview._dataRows || [], preview.mapping, state.transactions);
      newPreview._dataRows = preview._dataRows;
      newPreview.headers = preview.headers;
      renderImportPreview(newPreview);
    });
  });

  // Errors
  if (s.invalid > 0) {
    const errs = preview.invalidRows.slice(0,8).flatMap(v=> v.errors).join('<br>');
    const more = s.invalid > 8 ? `<div style="color:var(--text-faint);">+ ${s.invalid-8} more invalid rows</div>` : '';
    errEl.innerHTML = `<div style="font-weight:600;">Invalid rows:</div>${errs}${more}`;
  } else errEl.innerHTML = `<div style="color:var(--growth);">All rows passed validation.</div>`;

  if (dupCountEl) dupCountEl.textContent = String(s.duplicates);

  // Table head
  headEl.innerHTML = `<th style="padding:6px;text-align:left;">#</th><th style="padding:6px;text-align:left;">Status</th><th style="padding:6px;text-align:left;">Date</th><th style="padding:6px;text-align:left;">Amount</th><th style="padding:6px;text-align:left;">Type</th><th style="padding:6px;text-align:left;">Description</th><th style="padding:6px;text-align:left;">Error</th>`;
  const skipDup = document.getElementById('import-skip-duplicates')?.checked;
  bodyEl.innerHTML = preview.validated.slice(0,50).map((v,i)=>{
    const isDup = preview.dupIdxSet.has(v.idx);
    const status = !v.valid ? `<span style="color:var(--coral);font-weight:600;">Invalid</span>` : (isDup && skipDup ? `<span style="color:var(--gold);">Skip (dup)</span>` : isDup ? `<span style="color:var(--gold);">Dup</span>` : `<span style="color:var(--growth);">Valid</span>`);
    const err = v.errors.join('; ');
    const n = v.normalized;
    return `<tr style="border-top:1px solid var(--border);${!v.valid?'background:var(--coral-soft);':''}${isDup && skipDup?'opacity:0.55;':''}"><td style="padding:6px;">${i+1}</td><td style="padding:6px;">${status}</td><td style="padding:6px;">${escapeHtml(n.occurred_on)}</td><td style="padding:6px;" class="mono">${escapeHtml(String(n.amount))}</td><td style="padding:6px;">${escapeHtml(n.type)}</td><td style="padding:6px;">${escapeHtml(n.description||'')}</td><td style="padding:6px;color:var(--coral);font-size:11px;">${escapeHtml(err)}</td></tr>`;
  }).join('') + (preview.validated.length>50 ? `<tr><td colspan="7" style="padding:8px;text-align:center;color:var(--text-faint);">+ ${preview.validated.length-50} more rows not shown</td></tr>` : '');

  if (confirmBtn) confirmBtn.disabled = s.valid === 0 || (s.valid - (skipDup? s.duplicates:0) <=0);
  document.getElementById('modal-import-preview')?.classList.add('open');
}

async function handleImportFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const isCsv = ext === 'csv';
  const isJson = ext === 'json';
  const isXlsx = ext === 'xlsx' || ext === 'xls';
  try {
    let preview;
    if (isCsv) {
      const text = await file.text();
      if (!text.trim()) {
        pendingPreview = { empty:true, stats:{total:0} };
        renderImportPreview(pendingPreview);
        return;
      }
      preview = parseCsvWithPreview(text, state.transactions);
      // _dataRows already attached by parseCsvWithPreview
    } else if (isJson) {
      const text = await file.text();
      let data;
      try{ data = JSON.parse(text);}catch{ throw new Error('Invalid JSON file');}
      const arr = Array.isArray(data)? data : [data];
      if (!arr.length) { pendingPreview={empty:true, stats:{total:0}}; renderImportPreview(pendingPreview); return; }
      const headers = Object.keys(arr[0]||{});
      const dataRows = arr.map(obj=> headers.map(h=> obj[h] ?? ''));
      const mapping = autoMapHeaders(headers);
      if (!mapping.date && headers.length>0) mapping.date=headers[0];
      if (!mapping.amount && headers.length>1) mapping.amount=headers[1];
      preview = buildPreviewFromRows(headers, dataRows, mapping, state.transactions);
      preview._dataRows = dataRows;
      preview.headers = headers;
    } else if (isXlsx) {
      // reuse generic parser then build preview via auto mapping
      const rows = await parseImportFile(file); // normalized rows (but we need raw for preview)
      // For simplicity, treat normalized rows as already parsed: construct preview from them
      const headers = ['date','amount','type','category','description','payment_method','notes'];
      const dataRows = rows.map(r=> [r.occurred_on, r.amount, r.type, r.categoryName||'', r.description||'', r.payment_method||'', r.notes||'']);
      const mapping = {date:'date',amount:'amount',type:'type',category:'category',description:'description',payment_method:'payment_method',notes:'notes'};
      preview = buildPreviewFromRows(headers, dataRows, mapping, state.transactions);
      preview._dataRows = dataRows;
      preview.headers = headers;
    } else {
      throw new Error('Unsupported file type. Use CSV, XLSX, or JSON.');
    }
    // Empty file check
    if (preview.stats.total === 0) {
      toast('Empty file — no rows found');
      return;
    }
    renderImportPreview(preview);
  } catch (err) {
    toast(err.message || 'Import preview failed');
  }
}

function wireImportExport() {
  document.getElementById('export-json-btn')?.addEventListener('click', () => exportToJson(state.transactions));
  document.getElementById('export-csv-btn')?.addEventListener('click', () => exportToCsv(state.transactions));
  document.getElementById('export-excel-btn')?.addEventListener('click', async () => {
    try {
      await exportToExcel(state.transactions);
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('import-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await handleImportFile(file);
    e.target.value = '';
  });

  document.getElementById('gcash-import-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { rows, skipped, income, expense } = parseGcashCsv(text, {
        categories: getCategories(),
        transactions: state.transactions,
      });
      if (!rows.length) {
        toast(skipped ? `No new rows — ${skipped} already logged or unreadable` : 'No rows found in this GCash export');
        return;
      }
      const cats = new Map(getCategories().map((c) => [c.name.toLowerCase(), c]));
      const inserted = await bulkAddTransactions(currentUser.id, rows.map((r) => ({
        type: r.type,
        amount: r.amount,
        category_id: r.categoryName ? (cats.get(r.categoryName.toLowerCase())?.id ?? null) : null,
        payment_method: 'gcash',
        description: r.description,
        notes: r.notes,
        occurred_on: r.occurred_on,
        source: 'import',
      })));
      localStorage.setItem(`nimbus_last_import_${currentUser.id}`, JSON.stringify(inserted.map(x=>x.id)));
      document.getElementById('import-summary-text') && (document.getElementById('import-summary-text').textContent = `${inserted.length} GCash rows (${expense} expense / ${income} income)`);
      document.getElementById('import-undo') && (document.getElementById('import-undo').style.display='block');
      document.getElementById('modal-import-preview')?.classList.add('open');
      // also show preview stats in modal for consistency
      toast(`Imported ${rows.length} (${expense} expense / ${income} income)${skipped ? ` · ${skipped} skipped` : ''}`);
      e.target.value = '';
      await refreshAllData();
      renderAll();
    } catch (err) {
      toast(err.message || 'GCash import failed');
      e.target.value = '';
    }
  });

  // Confirm import button
  document.getElementById('import-confirm-btn')?.addEventListener('click', async () => {
    if (!pendingPreview) return;
    const btn = document.getElementById('import-confirm-btn');
    btn.disabled = true;
    btn.textContent = 'Importing…';
    try {
      const skipDup = document.getElementById('import-skip-duplicates')?.checked;
      const dupSet = pendingPreview.dupIdxSet;
      const toInsert = pendingPreview.validated.filter(v=> v.valid && !(skipDup && dupSet.has(v.idx))).map(v=> v.normalized);
      if (!toInsert.length) { toast('No rows to import after filtering'); return; }
      const cats = new Map(getCategories().map((c) => [c.name.toLowerCase(), c]));
      const payload = toInsert.map(r=> ({
        type: r.type,
        amount: Math.abs(Number(r.amount)),
        category_id: r.categoryName ? (cats.get(String(r.categoryName).toLowerCase())?.id ?? null) : null,
        payment_method: r.payment_method,
        description: r.description,
        notes: r.notes,
        occurred_on: r.occurred_on,
        source: 'import',
      }));
      const inserted = await bulkAddTransactions(currentUser.id, payload);
      localStorage.setItem(`nimbus_last_import_${currentUser.id}`, JSON.stringify(inserted.map(x=>x.id)));
      document.getElementById('import-summary-text') && (document.getElementById('import-summary-text').textContent = `${inserted.length} transactions — ${pendingPreview.stats.income} income / ${pendingPreview.stats.expense} expense. Invalid ${pendingPreview.stats.invalid}, duplicates ${skipDup? 'skipped' : 'included'}.`);
      const undoEl = document.getElementById('import-undo');
      if (undoEl) undoEl.style.display='block';
      toast(`Imported ${inserted.length} transactions`);
      await refreshAllData();
      renderAll();
    } catch (err) {
      toast(err.message || 'Import failed');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirm Import';
    }
  });

  document.getElementById('import-skip-duplicates')?.addEventListener('change', ()=>{
    if (pendingPreview) renderImportPreview(pendingPreview);
  });

  document.getElementById('import-undo-btn')?.addEventListener('click', async ()=>{
    if (!confirm('Undo last import? This will delete the recently imported transactions.')) return;
    try{
      const key = `nimbus_last_import_${currentUser?.id || ''}`;
      const ids = JSON.parse(localStorage.getItem(key) || localStorage.getItem('nimbus_last_import')||'[]');
      if (!ids.length) { toast('No import to undo'); return; }
      await deleteTransactionsByIds(ids);
      localStorage.removeItem(key);
      localStorage.removeItem('nimbus_last_import');
      document.getElementById('import-undo').style.display='none';
      document.getElementById('modal-import-preview')?.classList.remove('open');
      toast(`Undid ${ids.length} imported transactions`);
      await refreshAllData();
      renderAll();
    } catch(err){ toast(err.message || 'Undo failed'); }
  });
}

/** Delegated explicit-delete buttons across all list containers. */
function wireRowDeletes() {
  const attach = (id, del) =>
    document.getElementById(id)?.addEventListener('click', async (e) => {
      const btn = e.target.closest('.row-del');
      if (!btn || !confirm('Delete this item?')) return;
      try {
        await del(btn.dataset.del);
        // Phase 8: after net worth delete, snapshot updated state (no duplicate per date)
        if (id === 'networth-list') {
          try {
            const fresh = await fetchNetWorthItems(currentUser.id);
            await ensureTodaySnapshot(currentUser.id, fresh);
          } catch (snapErr) { console.warn('snapshot failed', snapErr); }
        }
        await refreshAllData();
        renderAll();
      } catch (err) {
        toast(err.message || 'Could not delete');
      }
    });

  attach('tx-full-list', deleteTransaction);
  attach('recent-tx-list', deleteTransaction);
  attach('goals-list', deleteGoal);
  attach('networth-list', deleteNetWorthItem);
  attach('budget-list', deleteBudget);
}

function wireFilters() {
  const searchInput = document.getElementById('tx-search-input');
  searchInput?.addEventListener(
    'input',
    debounce((e) => {
      setFilters({ search: e.target.value });
      renderTransactionsPage();
    }, 200)
  );

  ['tx-filter-category', 'tx-filter-method', 'tx-filter-type'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', (e) => {
      const map = { 'tx-filter-category': 'category', 'tx-filter-method': 'paymentMethod', 'tx-filter-type': 'type' };
      setFilters({ [map[id]]: e.target.value });
      renderTransactionsPage();
    });
  });

  // Money Trend range toggle
  document.getElementById('money-trend-card')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.range-btn');
    if (!btn || !isValidRange(btn.dataset.range)) return;
    state.moneyTrendRange = btn.dataset.range;
    localStorage.setItem('nimbus_trend_range', state.moneyTrendRange);
    renderMoneyTrendCard();
  });
  // Keyboard accessibility: Enter/Space handled natively for button
}

function coachContext() {
  return {
    transactions: state.transactions,
    budgetsProgress: state.budgetsProgress,
    goals: state.goals,
    categories: getCategories(),
    netWorthItems: state.netWorthItems,
  };
}

function wireCoach() {
  document.querySelectorAll('[data-coach-q]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.coachQ;
      let amount = null;
      if (q === 'afford') {
        const input = prompt('What amount do you want to check?');
        if (!input || isNaN(parseFloat(input))) return;
        amount = parseFloat(input);
      }
      const answer = answerCoachQuestion(q, coachContext(), amount);
      const el = document.getElementById('coach-answer');
      if (el) el.innerHTML = `<div class="coach-answer-row"><span>${answer.icon}</span><span>${escapeHtml(answer.text)}</span></div>`;
    });
  });
}

/** Delegated listeners so dynamically-rendered coach action buttons work. */
function wireDelegatedActions() {
  document.addEventListener('click', (e) => {
    const routeBtn = e.target.closest('[data-route]');
    if (routeBtn?.dataset.route) {
      goToRoute(routeBtn.dataset.route);
      return;
    }
    const modalBtn = e.target.closest('[data-open-modal]');
    if (modalBtn?.dataset.openModal) openModal(modalBtn.dataset.openModal);
  });
}

document.addEventListener('DOMContentLoaded', boot);
