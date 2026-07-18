import { getSupabase } from './supabaseClient.js';
import { formatMoney, monthKey, toast, sum } from './utils.js';

export async function fetchBudgets(userId, month = monthKey()) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('budgets')
    .select('*, categories(name, icon, color)')
    .eq('user_id', userId)
    .eq('month', month);
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}

export async function upsertBudget(userId, categoryId, month, amount) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('budgets')
    .upsert({ user_id: userId, category_id: categoryId, month, amount }, { onConflict: 'user_id,category_id,month' })
    .select()
    .single();
  if (error) throw error;
  toast('Budget saved');
  return data;
}

export async function deleteBudget(id) {
  const supabase = getSupabase();
  const { error } = await supabase.from('budgets').delete().eq('id', id);
  if (error) throw error;
}

/** Combine budgets with actual month spend per category. */
export function computeBudgetProgress(budgets, transactions) {
  return budgets.map((b) => {
    const spent = sum(
      transactions.filter((t) => t.type === 'expense' && t.category_id === b.category_id),
      (t) => t.amount
    );
    const pct = b.amount > 0 ? Math.min(999, (spent / b.amount) * 100) : 0;
    let state = 'ok';
    if (pct >= 100) state = 'over';
    else if (pct >= 80) state = 'warn';
    return { ...b, spent, remaining: b.amount - spent, pct, state };
  });
}

export function overallBudgetAdherence(progress) {
  if (!progress.length) return 1;
  const withinBudget = progress.filter((p) => p.state !== 'over').length;
  return withinBudget / progress.length;
}

export function renderBudgetList(containerEl, progress) {
  if (!containerEl) return;
  if (!progress.length) {
    containerEl.innerHTML = `<div class="empty-state"><div class="ico">🎯</div>No budgets set for this month.</div>`;
    return;
  }
  containerEl.innerHTML = progress
    .map((b) => {
      const cat = b.categories || {};
      const cls = b.state === 'over' ? 'over' : b.state === 'warn' ? 'warn' : 'ok';
      return `
      <div class="field" data-budget-id="${b.id}">
        <div style="display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:6px;">
          <span>${cat.icon || ''} ${cat.name || 'Category'}</span>
          <span class="mono">${formatMoney(b.spent)} / ${formatMoney(b.amount)}</span>
        </div>
        <div class="progress ${cls}"><span style="width:${Math.min(100, b.pct)}%"></span></div>
        ${b.state === 'over' ? '<div class="tx-meta" style="color:var(--coral);margin-top:4px;">Over budget</div>' : ''}
      </div>`;
    })
    .join('');
}
