import { getSupabase } from './supabaseClient.js';
import { toast } from './utils.js';

export async function createCategory(userId, { name, type, icon, color }) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('categories')
    .insert({
      user_id: userId,
      name: name.trim(),
      type,
      icon: icon || '💸',
      color: color || '#6366F1',
    })
    .select()
    .single();
  if (error) throw error;
  toast('Category created');
  return data;
}

export async function deleteCategory(id) {
  const supabase = getSupabase();
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
  toast('Category deleted');
}
