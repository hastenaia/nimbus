import { getSupabase } from './supabaseClient.js';
import { formatMoney, sum, toast, isoLocal } from './utils.js';

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

// ------------------------------------------------------------
// Snapshots — persistent history (Phase 8)
// ------------------------------------------------------------
export async function fetchNetWorthSnapshots(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('net_worth_snapshots')
    .select('*')
    .eq('user_id', userId)
    .order('snapshot_date', { ascending: true });
  if (error) {
    // Table may not exist yet before migration is applied — fail softly, no fake data.
    if (error.code === '42P01') return [];
    console.error(error);
    return [];
  }
  return data || [];
}

/**
 * Create or update a snapshot for a given date (unique per user+date).
 * Uses actual calculated assets/liabilities — never fabricates.
 * Safest flow: called after net_worth_items mutation, once per date via upsert.
 */
export async function upsertNetWorthSnapshot(userId, { snapshot_date, assets, liabilities }) {
  const supabase = getSupabase();
  const date = snapshot_date || isoLocal(new Date());
  const payload = {
    user_id: userId,
    snapshot_date: date,
    assets: Number(assets) || 0,
    liabilities: Number(liabilities) || 0,
    // net_worth auto-set by trigger, but include for clarity
    net_worth: (Number(assets) || 0) - (Number(liabilities) || 0),
  };
  const { data, error } = await supabase
    .from('net_worth_snapshots')
    .upsert(payload, { onConflict: 'user_id,snapshot_date' })
    .select()
    .single();
  if (error) {
    if (error.code === '42P01') {
      console.warn('net_worth_snapshots not yet migrated');
      return null;
    }
    throw error;
  }
  return data;
}

/**
 * Ensure a snapshot exists for today representing current calculated state.
 * Avoids duplicates: upserts on user+snapshot_date unique constraint.
 */
export async function ensureTodaySnapshot(userId, items) {
  const { assets, liabilities } = computeNetWorth(items);
  return upsertNetWorthSnapshot(userId, { snapshot_date: isoLocal(new Date()), assets, liabilities });
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
        <button class="row-del" data-del="${i.id}" aria-label="Delete entry" title="Delete">✕</button>
      </div>`
    )
    .join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
