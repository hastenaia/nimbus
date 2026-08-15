-- ============================================================
-- Nimbus Finance — Supabase Schema
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query)
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE where possible.
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- 1. PROFILES (extends auth.users)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  currency text default 'PHP',
  theme text default 'system',            -- 'light' | 'dark' | 'system'
  onboarded boolean default false,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 2. CATEGORIES
-- ------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  type text not null check (type in ('income','expense')),
  icon text default '💸',
  color text default '#6366F1',
  is_default boolean default false,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 3. TRANSACTIONS (income + expenses in one table, distinguished by type)
-- ------------------------------------------------------------
create table if not exists public.transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  type text not null check (type in ('income','expense')),
  amount numeric(12,2) not null check (amount >= 0),
  category_id uuid references public.categories(id) on delete set null,
  payment_method text not null default 'cash'
    check (payment_method in ('cash','gcash','bank','credit_card','other')),
  description text,
  notes text,
  tags text[] default '{}',
  occurred_on date not null default current_date,
  is_recurring boolean default false,
  recurrence_rule text,                  -- e.g. 'monthly', 'weekly'
  attachment_url text,
  source text default 'manual',           -- 'manual' | 'ocr' | 'import'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_transactions_user_date
  on public.transactions(user_id, occurred_on desc);

-- ------------------------------------------------------------
-- 4. BUDGETS (per category, per month)
-- ------------------------------------------------------------
create table if not exists public.budgets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  category_id uuid references public.categories(id) on delete cascade,
  month date not null,                    -- store first-of-month, e.g. 2026-07-01
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz default now(),
  unique (user_id, category_id, month)
);

-- ------------------------------------------------------------
-- 5. SAVINGS GOALS
-- ------------------------------------------------------------
create table if not exists public.savings_goals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  target_amount numeric(12,2) not null check (target_amount > 0),
  current_amount numeric(12,2) not null default 0,
  deadline date,
  icon text default '🎯',
  completed_at timestamptz,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 6. NET WORTH: ASSETS & LIABILITIES (manual entries)
-- ------------------------------------------------------------
create table if not exists public.net_worth_items (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  kind text not null check (kind in ('asset','liability')),
  name text not null,
  value numeric(14,2) not null default 0,
  updated_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 7. RECURRING TRANSACTION TEMPLATES
-- ------------------------------------------------------------
create table if not exists public.recurring_transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  type text not null check (type in ('income','expense')),
  amount numeric(12,2) not null,
  category_id uuid references public.categories(id) on delete set null,
  payment_method text default 'cash',
  description text,
  frequency text not null check (frequency in ('daily','weekly','monthly','yearly')),
  next_run date not null,
  active boolean default true,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 8. OCR IMPORTED TRANSACTIONS (staging area before confirmation)
-- ------------------------------------------------------------
create table if not exists public.ocr_imports (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  raw_text text,
  parsed_amount numeric(12,2),
  parsed_date date,
  parsed_merchant text,
  parsed_reference text,
  parsed_type text,
  image_url text,
  status text default 'pending' check (status in ('pending','confirmed','discarded')),
  confirmed_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 9. MONTHLY REPORTS (cached snapshots, optional/denormalized)
-- ------------------------------------------------------------
create table if not exists public.monthly_reports (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  month date not null,
  total_income numeric(12,2) default 0,
  total_expenses numeric(12,2) default 0,
  savings numeric(12,2) default 0,
  savings_rate numeric(5,2) default 0,
  health_score int default 0,
  generated_at timestamptz default now(),
  unique (user_id, month)
);

-- ------------------------------------------------------------
-- 10. FAVORITE QUOTES
-- ------------------------------------------------------------
create table if not exists public.favorite_quotes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  quote_id text not null,
  quote_text text not null,
  author text,
  category text,
  created_at timestamptz default now(),
  unique (user_id, quote_id)
);

-- ------------------------------------------------------------
-- 11. USER SETTINGS (misc app preferences, key/value)
-- ------------------------------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.savings_goals enable row level security;
alter table public.net_worth_items enable row level security;
alter table public.recurring_transactions enable row level security;
alter table public.ocr_imports enable row level security;
alter table public.monthly_reports enable row level security;
alter table public.favorite_quotes enable row level security;
alter table public.user_settings enable row level security;

-- Generic "own rows only" policy pattern, applied per table.
-- Policies are dropped first so the whole script is safe to re-run.
drop policy if exists "profiles_self" on public.profiles;
create policy "profiles_self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "categories_self" on public.categories;
create policy "categories_self" on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "transactions_self" on public.transactions;
create policy "transactions_self" on public.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "budgets_self" on public.budgets;
create policy "budgets_self" on public.budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "goals_self" on public.savings_goals;
create policy "goals_self" on public.savings_goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "networth_self" on public.net_worth_items;
create policy "networth_self" on public.net_worth_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "recurring_self" on public.recurring_transactions;
create policy "recurring_self" on public.recurring_transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "ocr_self" on public.ocr_imports;
create policy "ocr_self" on public.ocr_imports
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "reports_self" on public.monthly_reports;
create policy "reports_self" on public.monthly_reports
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "quotes_self" on public.favorite_quotes;
create policy "quotes_self" on public.favorite_quotes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "settings_self" on public.user_settings;
create policy "settings_self" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- TRIGGER: auto-create profile + default categories on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data->>'full_name');
  insert into public.user_settings (user_id) values (new.id);

  insert into public.categories (user_id, name, type, icon, color, is_default) values
    (new.id, 'Salary', 'income', '💼', '#34D399', true),
    (new.id, 'Freelance', 'income', '🧑‍💻', '#34D399', true),
    (new.id, 'Allowance', 'income', '🎁', '#34D399', true),
    (new.id, 'Investment', 'income', '📈', '#34D399', true),
    (new.id, 'Food', 'expense', '🍔', '#FF6B6B', true),
    (new.id, 'Transportation', 'expense', '🚗', '#F59E0B', true),
    (new.id, 'Bills', 'expense', '🧾', '#6366F1', true),
    (new.id, 'Shopping', 'expense', '🛍️', '#EC4899', true),
    (new.id, 'Entertainment', 'expense', '🎬', '#8B5CF6', true),
    (new.id, 'Education', 'expense', '📚', '#0EA5E9', true),
    (new.id, 'Health', 'expense', '💊', '#EF4444', true),
    (new.id, 'Savings', 'expense', '🏦', '#10B981', true);

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- STORAGE: bucket for OCR receipt images & attachments
-- (Run once — Storage > New bucket, or via this SQL if the storage
-- schema is available on your project)
-- ============================================================
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
  on conflict (id) do nothing;

drop policy if exists "receipts_owner_read" on storage.objects;
create policy "receipts_owner_read" on storage.objects
  for select using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "receipts_owner_write" on storage.objects;
create policy "receipts_owner_write" on storage.objects
  for insert with check (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "receipts_owner_delete" on storage.objects;
create policy "receipts_owner_delete" on storage.objects
  for delete using (bucket_id = 'receipts' and auth.uid()::text = (storage.foldername(name))[1]);
