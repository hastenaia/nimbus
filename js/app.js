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
import { fetchNetWorthItems, upsertNetWorthItem, deleteNetWorthItem, computeNetWorth, renderNetWorthList } from './netWorth.js';
import { generateInsights, renderCoachCard, computeHeadline, answerCoachQuestion } from './coach.js';
import {
  renderIncomeVsExpense, renderCategoryPie, renderSavingsGrowth, renderCashFlow,
  renderBudgetBreakdown, renderGrowthTimeline, renderHealthRings, renderMoneyTrend, renderForecastMini,
} from './charts.js';
import { getMoneyTrendSeries, isValidRange } from './moneyTrend.js';
import { computeCashFlowForecast } from './forecast.js';
import { computeSafeToSpend } from './safeToSpend.js';
import { runOcr, preloadOcr } from './ocr.js';
import { exportToJson, exportToCsv, exportToExcel, parseImportFile } from './importExport.js';
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
  const [tx, budgets, goals, netWorth, recurring] = await Promise.all([
    fetchTransactions(currentUser.id),
    fetchBudgets(currentUser.id, monthKey()),
    fetchGoals(currentUser.id),
    fetchNetWorthItems(currentUser.id),
    fetchRecurring(currentUser.id),
  ]);
  state.transactions = tx;
  state.summary = summarizeTransactions(tx);
  const monthSpend = state.summary.byMonth.get(monthKey().slice(0, 7))?.categories || new Map();
  state.budgetsProgress = computeBudgetProgress(budgets, monthSpend);
  state.goals = goals;
  state.netWorthItems = netWorth;
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

  const insights = generateInsights({ ...coachContext(), forecast, safeToSpend });
  renderCoachCard(document.getElementById('coach-card-body'), insights);
  const headline = computeHeadline(insights);
  const headlineEl = document.getElementById('coach-headline');
  if (headlineEl) {
    headlineEl.textContent = headline.text;
    headlineEl.className = `coach-headline ${headline.cls}`;
  }

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
  const growth = financialGrowthReport(state.summary, state.netWorthItems);
  renderGrowthTimeline('chart-growth-timeline', growth.trend);
  renderCashFlow('chart-cash-flow', state.summary);
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
      await upsertNetWorthItem(currentUser.id, {
        kind: fd.get('kind'),
        name: fd.get('name'),
        value: parseFloat(fd.get('value')),
      });
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
    try {
      const rows = await parseImportFile(file);
      const valid = rows.filter((r) => Number(r.amount) > 0);
      if (!valid.length) {
        toast('No valid rows to import');
        return;
      }
      const cats = new Map(getCategories().map((c) => [c.name.toLowerCase(), c]));
      await bulkAddTransactions(currentUser.id, valid.map((r) => ({
        type: r.type,
        amount: r.amount,
        category_id: r.categoryName ? (cats.get(r.categoryName.toLowerCase())?.id ?? null) : null,
        payment_method: r.payment_method,
        description: r.description,
        notes: r.notes,
        occurred_on: r.occurred_on,
        source: 'import',
      })));
      toast(`Imported ${valid.length} transactions`);
      e.target.value = '';
      await refreshAllData();
      renderAll();
    } catch (err) {
      toast(err.message || 'Import failed');
    }
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
      await bulkAddTransactions(currentUser.id, rows.map((r) => ({
        type: r.type,
        amount: r.amount,
        category_id: r.categoryName ? (cats.get(r.categoryName.toLowerCase())?.id ?? null) : null,
        payment_method: 'gcash',
        description: r.description,
        notes: r.notes,
        occurred_on: r.occurred_on,
        source: 'import',
      })));
      toast(`Imported ${rows.length} (${expense} expense / ${income} income)${skipped ? ` · ${skipped} skipped` : ''}`);
      e.target.value = '';
      await refreshAllData();
      renderAll();
    } catch (err) {
      toast(err.message || 'GCash import failed');
      e.target.value = '';
    }
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
