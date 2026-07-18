import { getSupabase } from './supabaseClient.js';
import { formatMoney, formatDate, toast, uid } from './utils.js';
import { showSpecialQuote } from './quotes.js';

let categories = [];
let cachedTx = [];
let activeFilters = { search: '', category: 'all', paymentMethod: 'all', type: 'all' };

export async function loadCategories(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .order('name');
  if (error) {
    console.error(error);
    return [];
  }
  categories = data || [];
  return categories;
}

export function getCategories() {
  return categories;
}

export function categoryById(id) {
  return categories.find((c) => c.id === id);
}

export async function fetchTransactions(userId, { from, to } = {}) {
  const supabase = getSupabase();
  let query = supabase
    .from('transactions')
    .select('*, categories(name, icon, color)')
    .eq('user_id', userId)
    .order('occurred_on', { ascending: false });

  if (from) query = query.gte('occurred_on', from);
  if (to) query = query.lte('occurred_on', to);

  const { data, error } = await query;
  if (error) {
    console.error(error);
    return [];
  }
  cachedTx = data || [];
  return cachedTx;
}

export async function addTransaction(userId, payload) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('transactions')
    .insert({ user_id: userId, ...payload })
    .select()
    .single();
  if (error) throw error;
  toast(payload.type === 'income' ? 'Income added' : 'Expense logged');
  showSpecialQuote(payload.type === 'income' ? 'income' : 'expense');
  return data;
}

export async function updateTransaction(id, payload) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('transactions')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  toast('Transaction updated');
  return data;
}

export async function deleteTransaction(id) {
  const supabase = getSupabase();
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
  toast('Transaction deleted');
}

export function applyFilters(list, filters = activeFilters) {
  return list.filter((tx) => {
    if (filters.type !== 'all' && tx.type !== filters.type) return false;
    if (filters.category !== 'all' && tx.category_id !== filters.category) return false;
    if (filters.paymentMethod !== 'all' && tx.payment_method !== filters.paymentMethod) return false;
    if (filters.search) {
      const s = filters.search.toLowerCase();
      const haystack = `${tx.description || ''} ${tx.notes || ''} ${tx.amount} ${tx.payment_method}`.toLowerCase();
      if (!haystack.includes(s)) return false;
    }
    return true;
  });
}

export function setFilters(partial) {
  activeFilters = { ...activeFilters, ...partial };
  return activeFilters;
}

export function renderTransactionList(containerEl, list) {
  if (!containerEl) return;
  if (!list.length) {
    containerEl.innerHTML = `<div class="empty-state"><div class="ico">🧾</div>No transactions yet.<br/>Tap + to add your first one.</div>`;
    return;
  }
  containerEl.innerHTML = list
    .map((tx) => {
      const cat = tx.categories || {};
      const sign = tx.type === 'income' ? '+' : '−';
      return `
      <div class="tx-row" data-id="${tx.id}">
        <div class="tx-icon" style="background:${cat.color ? cat.color + '22' : 'var(--signal-soft)'}">${cat.icon || '💳'}</div>
        <div class="tx-main">
          <div class="tx-title">${escapeHtml(tx.description || cat.name || 'Transaction')}</div>
          <div class="tx-meta">${formatDate(tx.occurred_on)} · ${labelForMethod(tx.payment_method)}${tx.is_recurring ? ' · Recurring' : ''}</div>
        </div>
        <div class="tx-amount ${tx.type}">${sign}${formatMoney(tx.amount)}</div>
      </div>`;
    })
    .join('');
}

function labelForMethod(m) {
  return { cash: 'Cash', gcash: 'GCash', bank: 'Bank', credit_card: 'Credit Card', other: 'Other' }[m] || m;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { cachedTx as getCachedTransactions };
