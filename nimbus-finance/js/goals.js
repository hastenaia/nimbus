import { getSupabase } from './supabaseClient.js';
import { formatMoney, formatDate, daysBetween, toast } from './utils.js';
import { showSpecialQuote } from './quotes.js';

export async function fetchGoals(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('savings_goals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}

export async function createGoal(userId, payload) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('savings_goals')
    .insert({ user_id: userId, ...payload })
    .select()
    .single();
  if (error) throw error;
  toast('Goal created');
  return data;
}

export async function contributeToGoal(goal, amount) {
  const supabase = getSupabase();
  const newAmount = Number(goal.current_amount) + Number(amount);
  const justCompleted = newAmount >= goal.target_amount && !goal.completed_at;
  const patch = { current_amount: newAmount };
  if (justCompleted) patch.completed_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('savings_goals')
    .update(patch)
    .eq('id', goal.id)
    .select()
    .single();
  if (error) throw error;

  const crossedHalf = goal.current_amount / goal.target_amount < 0.5 && newAmount / goal.target_amount >= 0.5;
  if (justCompleted) {
    celebrateGoal(goal.name);
  } else if (crossedHalf) {
    showSpecialQuote('goalMilestone');
  }
  return data;
}

export async function deleteGoal(id) {
  const supabase = getSupabase();
  const { error } = await supabase.from('savings_goals').delete().eq('id', id);
  if (error) throw error;
}

function celebrateGoal(name) {
  toast(`🎉 Goal reached: ${name}!`);
  fireConfetti();
}

function fireConfetti() {
  const colors = ['#34D399', '#818CF8', '#F5A623', '#FF6B6B'];
  for (let i = 0; i < 40; i++) {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed; top:-10px; left:${Math.random() * 100}vw;
      width:8px; height:8px; background:${colors[i % colors.length]};
      z-index:999; border-radius:2px; pointer-events:none;
      animation: confetti-fall ${1.5 + Math.random()}s ease-in forwards;
      transform: rotate(${Math.random() * 360}deg);
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
  if (!document.getElementById('confetti-style')) {
    const style = document.createElement('style');
    style.id = 'confetti-style';
    style.textContent = `@keyframes confetti-fall { to { transform: translateY(100vh) rotate(360deg); opacity: 0; } }`;
    document.head.appendChild(style);
  }
}

export function estimateCompletion(goal, avgMonthlyContribution) {
  if (!avgMonthlyContribution || avgMonthlyContribution <= 0) return null;
  const remaining = goal.target_amount - goal.current_amount;
  const monthsLeft = Math.ceil(remaining / avgMonthlyContribution);
  const d = new Date();
  d.setMonth(d.getMonth() + monthsLeft);
  return d;
}

export function renderGoalList(containerEl, goals) {
  if (!containerEl) return;
  if (!goals.length) {
    containerEl.innerHTML = `<div class="empty-state"><div class="ico">🎯</div>No savings goals yet.</div>`;
    return;
  }
  containerEl.innerHTML = goals
    .map((g) => {
      const pct = Math.min(100, (g.current_amount / g.target_amount) * 100);
      const cls = g.completed_at ? 'ok' : pct >= 70 ? 'ok' : pct >= 30 ? 'warn' : 'over';
      const daysLeft = g.deadline ? daysBetween(new Date(), g.deadline) : null;
      return `
      <div class="card solid" data-goal-id="${g.id}" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:600;">${g.icon || '🎯'} ${escapeHtml(g.name)}</div>
          <div class="mono" style="font-size:13px;">${Math.round(pct)}%</div>
        </div>
        <div class="progress ${g.completed_at ? 'ok' : cls}" style="margin:10px 0;"><span style="width:${pct}%"></span></div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--text-dim);">
          <span>${formatMoney(g.current_amount)} of ${formatMoney(g.target_amount)}</span>
          <span>${g.completed_at ? 'Completed 🎉' : g.deadline ? `${daysLeft}d left` : ''}</span>
        </div>
        ${!g.completed_at ? `<button class="btn btn-ghost btn-sm contribute-btn" data-goal-id="${g.id}" style="margin-top:10px;">+ Add contribution</button>` : ''}
      </div>`;
    })
    .join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
