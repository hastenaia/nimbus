import { getSupabase } from './supabaseClient.js';
import { formatMoney, toast, monthKey } from './utils.js';

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

/** Combine budgets with actual month spend per category.
 *  `monthSpend` is a Map(category_id -> amount), ideally from a single
 *  `summarizeTransactions()` pass so this is O(budgets) not O(budgets x tx).
 *  Thresholds per spec: healthy <70, warning 70-90, critical 90-100, over >100.
 *  Adds `daysRemaining` and richer `remaining` for the card. */
export function computeBudgetProgress(budgets, monthSpend = new Map()) {
  const now = new Date();
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysRemaining = Math.max(0, lastOfMonth - now.getDate() + 1);
  const daysInMonth = lastOfMonth;
  return budgets.map((b) => {
    const spent = monthSpend.get(b.category_id) || 0;
    const pct = b.amount > 0 ? Math.min(999, (spent / b.amount) * 100) : 0;
    let state = 'healthy';
    if (pct > 100) state = 'over';
    else if (pct >= 90) state = 'critical';
    else if (pct >= 70) state = 'warning';
    else state = 'healthy';
    // legacy alias for overallBudgetAdherence / existing styles: map to ok/warn/over for CSS
    const cssState = state === 'over' ? 'over' : (state === 'warning' || state === 'critical') ? 'warn' : 'ok';
    return { ...b, spent, remaining: Math.round((b.amount - spent) * 100) / 100, pct: Math.round(pct * 10) / 10, state, cssState, daysRemaining, daysInMonth };
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
  const statusMeta = (b) => {
    if (b.state === 'over') return { icon: '🚨', text: `Over budget by ${formatMoney(Math.abs(b.remaining))}.`, color: 'var(--coral)' };
    if (b.state === 'critical') return { icon: '⚠️', text: `You're close to exceeding this budget. ${formatMoney(b.remaining)} remaining · ${b.daysRemaining}d left.`, color: 'var(--coral)' };
    if (b.state === 'warning') return { icon: '⚠️', text: `${Math.round(b.pct)}% used · ${formatMoney(b.remaining)} remaining · ${b.daysRemaining}d left in period.`, color: 'var(--gold)' };
    return { icon: '✓', text: `${Math.round(b.pct)}% used · ${formatMoney(b.remaining)} remaining · ${b.daysRemaining}d left.`, color: 'var(--growth)' };
  };
  const labelFor = (s) => s === 'over' ? 'Over Budget' : s === 'critical' ? 'Critical' : s === 'warning' ? 'Warning' : 'Healthy';
  containerEl.innerHTML = progress
    .map((b) => {
      const cat = b.categories || {};
      const cls = b.cssState || (b.state === 'over' ? 'over' : b.state === 'warning' || b.state === 'critical' ? 'warn' : 'ok');
      const meta = statusMeta(b);
      return `
      <div class="field" data-budget-id="${b.id}" style="padding:8px 0; border-bottom:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13.5px;margin-bottom:6px;">
          <span style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:11px; padding:3px 7px; border-radius:100px; background:var(--border); color:var(--text-dim); font-weight:700; text-transform:uppercase; letter-spacing:.04em;">${labelFor(b.state)}</span>
            <span><span>${cat.icon || ''}</span> ${cat.name || 'Category'}</span>
          </span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span class="mono" style="font-weight:700;">${formatMoney(b.spent)} / ${formatMoney(b.amount)}</span>
            <span class="mono" style="font-size:12px; color:var(--text-faint);">${Math.round(b.pct)}%</span>
            <button class="row-del" data-del="${b.id}" aria-label="Delete budget for ${cat.name || 'category'}" title="Delete">✕</button>
          </span>
        </div>
        <div class="progress ${cls}"><span style="width:${Math.min(100, b.pct)}%"></span></div>
        <div class="tx-meta" style="color:${meta.color};margin-top:6px;display:flex;gap:6px;align-items:center;">
          <span aria-hidden="true">${meta.icon}</span><span>${meta.text}</span>
        </div>
      </div>`;
    })
    .join('');
}
