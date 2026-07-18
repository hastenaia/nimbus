import { getSupabase } from './supabaseClient.js';
import { getSession, onAuthChange, wireAuthForms, signOut } from './auth.js';
import { initQuoteCard, showSpecialQuote } from './quotes.js';
import {
  loadCategories, getCategories, fetchTransactions, addTransaction, updateTransaction,
  deleteTransaction, applyFilters, setFilters, renderTransactionList,
} from './transactions.js';
import { fetchBudgets, upsertBudget, computeBudgetProgress, overallBudgetAdherence, renderBudgetList } from './budgets.js';
import { fetchGoals, createGoal, contributeToGoal, renderGoalList } from './goals.js';
import { fetchNetWorthItems, upsertNetWorthItem, computeNetWorth, renderNetWorthList } from './netWorth.js';
import { generateInsights, renderCoachCard } from './coach.js';
import {
  renderIncomeVsExpense, renderCategoryPie, renderSavingsGrowth, renderCashFlow,
  renderBudgetBreakdown, renderGrowthTimeline, renderHealthRings,
} from './charts.js';
import { runOcr } from './ocr.js';
import { exportToJson, exportToCsv, exportToExcel, parseImportFile } from './importExport.js';
import { financialGrowthReport, categoryReport, renderReportTable } from './reports.js';
import { formatMoney, monthKey, sum, toast, debounce } from './utils.js';

let currentUser = null;
let state = {
  transactions: [],
  budgetsProgress: [],
  goals: [],
  netWorthItems: [],
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
  wireAuthForms({ onAuthed: () => showApp() });

  const session = await getSession();
  if (session) {
    await showApp(session);
  } else {
    showAuthScreen();
  }

  onAuthChange(async (session) => {
    if (session && !currentUser) await showApp(session);
    if (!session) showAuthScreen();
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

async function showApp(session) {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getUser();
  currentUser = data.user;
  if (!currentUser) return showAuthScreen();

  document.getElementById('auth-screen')?.classList.add('hidden');
  document.getElementById('app')?.classList.remove('hidden');

  const nameEl = document.getElementById('user-greeting-name');
  if (nameEl) nameEl.textContent = currentUser.user_metadata?.full_name?.split(' ')[0] || 'there';

  await loadCategories(currentUser.id);
  await refreshAllData();
  await initQuoteCard(currentUser);
  checkMonthStart();
  wireModals();
  wireFilters();
  renderAll();
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
  const [tx, budgets, goals, netWorth] = await Promise.all([
    fetchTransactions(currentUser.id),
    fetchBudgets(currentUser.id, monthKey()),
    fetchGoals(currentUser.id),
    fetchNetWorthItems(currentUser.id),
  ]);
  state.transactions = tx;
  state.budgetsProgress = computeBudgetProgress(budgets, tx.filter((t) => t.occurred_on.startsWith(monthKey().slice(0, 7))));
  state.goals = goals;
  state.netWorthItems = netWorth;
}

// ---------------- RENDER ----------------
function renderAll() {
  renderDashboard();
  renderTransactionsPage();
  renderBudgetsPage();
  renderGoalsPage();
  renderNetWorthPage();
}

function renderDashboard() {
  const thisMonth = monthKey().slice(0, 7);
  const monthTx = state.transactions.filter((t) => t.occurred_on.startsWith(thisMonth));
  const income = sum(monthTx.filter((t) => t.type === 'income'), (t) => t.amount);
  const expenses = sum(monthTx.filter((t) => t.type === 'expense'), (t) => t.amount);
  const savings = income - expenses;
  const savingsRate = income > 0 ? (savings / income) * 100 : 0;
  const balance = sum(state.transactions.filter((t) => t.type === 'income'), (t) => t.amount) -
    sum(state.transactions.filter((t) => t.type === 'expense'), (t) => t.amount);

  setText('stat-balance', formatMoney(balance));
  setText('stat-income', formatMoney(income));
  setText('stat-expenses', formatMoney(expenses));
  setText('stat-savings', formatMoney(savings));
  setText('stat-savings-rate', `${savingsRate.toFixed(1)}%`);

  const budgetAdherence = overallBudgetAdherence(state.budgetsProgress);
  const goalProgress = state.goals.length
    ? sum(state.goals, (g) => Math.min(1, g.current_amount / g.target_amount)) / state.goals.length
    : 0;

  renderHealthRings(document.getElementById('health-rings-svg'), {
    savingsPct: Math.min(1, savingsRate / 20),
    budgetPct: budgetAdherence,
    goalPct: goalProgress,
  });
  const healthScore = Math.round(
    Math.min(1, Math.max(0, savingsRate / 20)) * 40 + budgetAdherence * 30 + goalProgress * 10 + 20
  );
  setText('health-score-value', `${healthScore}`);

  // Largest expense + upcoming (recurring) placeholder
  const largest = [...monthTx.filter((t) => t.type === 'expense')].sort((a, b) => b.amount - a.amount)[0];
  setText('stat-largest-expense', largest ? formatMoney(largest.amount) : '—');

  renderTransactionList(document.getElementById('recent-tx-list'), state.transactions.slice(0, 6));

  renderCoachCard(
    document.getElementById('coach-card-body'),
    generateInsights({
      transactions: state.transactions,
      budgetsProgress: state.budgetsProgress,
      goals: state.goals,
      categories: getCategories(),
    })
  );

  renderIncomeVsExpense('chart-income-expense', state.transactions);
  renderCategoryPie('chart-category-pie', monthTx, getCategories());
  renderSavingsGrowth('chart-savings-growth', state.transactions);
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
  const growth = financialGrowthReport(state.transactions, state.netWorthItems);
  renderGrowthTimeline('chart-growth-timeline', growth.trend);
  renderCashFlow('chart-cash-flow', state.transactions);
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
  wireImportExport();

  document.querySelectorAll('[data-open-modal]').forEach((btn) => {
    btn.addEventListener('click', () => openModal(btn.dataset.openModal));
  });
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('.modal-backdrop')?.classList.remove('open'));
  });
}

function openModal(id) {
  populateCategorySelects();
  document.getElementById(id)?.classList.add('open');
}

function populateCategorySelects() {
  const cats = getCategories();
  document.querySelectorAll('.category-select').forEach((sel) => {
    const currentType = sel.dataset.filterType;
    const options = cats.filter((c) => !currentType || c.type === currentType);
    sel.innerHTML = options.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
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

  document.getElementById('tx-full-list')?.addEventListener('click', async (e) => {
    const row = e.target.closest('.tx-row');
    if (!row) return;
    if (confirm('Delete this transaction?')) {
      await deleteTransaction(row.dataset.id);
      await refreshAllData();
      renderAll();
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
    await contributeToGoal(goal, parseFloat(amount));
    await refreshAllData();
    renderAll();
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

function wireImportExport() {
  document.getElementById('export-json-btn')?.addEventListener('click', () => exportToJson(state.transactions));
  document.getElementById('export-csv-btn')?.addEventListener('click', () => exportToCsv(state.transactions));
  document.getElementById('export-excel-btn')?.addEventListener('click', () => {
    try {
      exportToExcel(state.transactions);
    } catch (err) {
      toast(err.message);
    }
  });

  document.getElementById('import-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const rows = await parseImportFile(file);
      let count = 0;
      for (const row of rows) {
        const cat = getCategories().find((c) => c.name.toLowerCase() === (row.categoryName || '').toLowerCase());
        await addTransaction(currentUser.id, {
          type: row.type,
          amount: row.amount,
          category_id: cat?.id || null,
          payment_method: row.payment_method,
          description: row.description,
          notes: row.notes,
          occurred_on: row.occurred_on,
          source: 'import',
        });
        count++;
      }
      toast(`Imported ${count} transactions`);
      await refreshAllData();
      renderAll();
    } catch (err) {
      toast(err.message || 'Import failed');
    }
  });
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
}

document.addEventListener('DOMContentLoaded', boot);
