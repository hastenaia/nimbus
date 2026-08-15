// Recurring transaction templates + auto-generation.
// Uses the existing recurring_transactions table. On login, generateDueTransactions
// inserts any occurrences that are due and advances each template's next_run,
// so re-opening the app never duplicates entries.

import { getSupabase } from './supabaseClient.js';
import { formatMoney, formatDate, toast } from './utils.js';

export async function fetchRecurring(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('recurring_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('next_run');
  if (error) throw error;
  return data || [];
}

export async function addRecurring(userId, payload) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('recurring_transactions')
    .insert({ user_id: userId, ...payload })
    .select()
    .single();
  if (error) throw error;
  toast('Recurring transaction saved');
  return data;
}

export async function updateRecurring(id, payload) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('recurring_transactions')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRecurring(id) {
  const supabase = getSupabase();
  const { error } = await supabase.from('recurring_transactions').delete().eq('id', id);
  if (error) throw error;
  toast('Recurring transaction deleted');
}

const FREQUENCY_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

export function frequencyLabel(f) {
  return FREQUENCY_LABELS[f] || f;
}

function addMonths(date, months) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
}

/** Next occurrence after `date` for a frequency (returns a Date at UTC midnight). */
export function advanceDate(frequency, date) {
  const d = new Date(date);
  if (frequency === 'daily') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  if (frequency === 'weekly') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 7));
  if (frequency === 'monthly') return addMonths(d, 1);
  if (frequency === 'yearly') return addMonths(d, 12);
  return d;
}

function parseUtc(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function localTodayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

/**
 * Inserts a transaction for every occurrence that has come due, then advances
 * next_run. Catches up missed occurrences (capped per template as a safety
 * valve) so the data reflects what actually happened. Returns count inserted.
 */
export async function generateDueTransactions(userId) {
  const supabase = getSupabase();
  const todayIso = localTodayIso();

  const { data: templates, error } = await supabase
    .from('recurring_transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true)
    .lte('next_run', todayIso);
  if (error) throw error;
  if (!templates?.length) return 0;

  const toInsert = [];
  const toUpdate = [];
  const CAP = 24;

  for (const tpl of templates) {
    let next = parseUtc(tpl.next_run);
    let count = 0;
    while (iso(next) <= todayIso && count < CAP) {
      toInsert.push({
        user_id: userId,
        type: tpl.type,
        amount: tpl.amount,
        category_id: tpl.category_id,
        payment_method: tpl.payment_method || 'cash',
        description: tpl.description || 'Recurring',
        occurred_on: iso(next),
        is_recurring: true,
        source: 'recurring',
      });
      next = advanceDate(tpl.frequency, next);
      count++;
    }
    if (count) toUpdate.push({ id: tpl.id, next_run: iso(next) });
  }

  if (toInsert.length) {
    const { error: insErr } = await supabase.from('transactions').insert(toInsert);
    if (insErr) throw insErr;
  }
  for (const u of toUpdate) {
    const { error: upErr } = await supabase.from('recurring_transactions').update(u).eq('id', u.id);
    if (upErr) throw upErr;
  }
  return toInsert.length;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderRecurringList(containerEl, items, categories) {
  if (!containerEl) return;
  if (!items.length) {
    containerEl.innerHTML = `<div class="empty-state"><div class="ico">🔁</div>No recurring transactions yet.<br/>Add one above and it will be logged automatically when due.</div>`;
    return;
  }
  const catById = new Map((categories || []).map((c) => [c.id, c]));
  containerEl.innerHTML = items
    .map((r) => {
      const cat = catById.get(r.category_id) || {};
      const sign = r.type === 'income' ? '+' : '−';
      return `
      <div class="tx-row" data-id="${r.id}">
        <div class="tx-icon" style="background:${cat.color ? cat.color + '22' : 'var(--signal-soft)'}">${cat.icon || '🔁'}</div>
        <div class="tx-main">
          <div class="tx-title">${escapeHtml(r.description || cat.name || 'Recurring')}</div>
          <div class="tx-meta">${frequencyLabel(r.frequency)} · next ${formatDate(r.next_run)}</div>
        </div>
        <div class="tx-amount ${r.type}">${sign}${formatMoney(r.amount)}</div>
        <button class="row-del" data-del="${r.id}" aria-label="Delete recurring transaction" title="Delete">✕</button>
      </div>`;
    })
    .join('');
}
