import { getSupabase } from './supabaseClient.js';
import { formatMoney, sum, toast } from './utils.js';

export async function fetchNetWorthItems(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('net_worth_items')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}

export async function upsertNetWorthItem(userId, item) {
  const supabase = getSupabase();
  const payload = { user_id: userId, updated_at: new Date().toISOString(), ...item };
  const { data, error } = await supabase.from('net_worth_items').upsert(payload).select().single();
  if (error) throw error;
  toast('Saved');
  return data;
}

export async function deleteNetWorthItem(id) {
  const supabase = getSupabase();
  const { error } = await supabase.from('net_worth_items').delete().eq('id', id);
  if (error) throw error;
}

export function computeNetWorth(items) {
  const assets = sum(items.filter((i) => i.kind === 'asset'), (i) => i.value);
  const liabilities = sum(items.filter((i) => i.kind === 'liability'), (i) => i.value);
  return { assets, liabilities, netWorth: assets - liabilities };
}

export function renderNetWorthList(containerEl, items) {
  if (!containerEl) return;
  if (!items.length) {
    containerEl.innerHTML = `<div class="empty-state"><div class="ico">🏦</div>Add your assets and liabilities to see your net worth.</div>`;
    return;
  }
  containerEl.innerHTML = items
    .map(
      (i) => `
      <div class="tx-row" data-id="${i.id}">
        <div class="tx-icon" style="background:${i.kind === 'asset' ? 'var(--growth-soft)' : 'var(--coral-soft)'}">${i.kind === 'asset' ? '📈' : '📉'}</div>
        <div class="tx-main">
          <div class="tx-title">${escapeHtml(i.name)}</div>
          <div class="tx-meta">${i.kind === 'asset' ? 'Asset' : 'Liability'}</div>
        </div>
        <div class="tx-amount ${i.kind === 'asset' ? 'income' : 'expense'}">${formatMoney(i.value)}</div>
      </div>`
    )
    .join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
