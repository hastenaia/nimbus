-- ============================================================
-- Phase 8: Net Worth Snapshots — persistent historical tracking
-- No fake backfill: history begins when feature enabled.
-- ============================================================

-- 1. Table
create table if not exists public.net_worth_snapshots (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null default current_date,
  assets numeric(14,2) not null default 0 check (assets >= 0),
  liabilities numeric(14,2) not null default 0 check (liabilities >= 0),
  net_worth numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, snapshot_date)
);

-- 2. Index for ordered reads
create index if not exists idx_snapshots_user_date
  on public.net_worth_snapshots(user_id, snapshot_date asc);

-- 3. RLS
alter table public.net_worth_snapshots enable row level security;

drop policy if exists "snapshots_self" on public.net_worth_snapshots;
create policy "snapshots_self" on public.net_worth_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4. Safety: ensure net_worth = assets - liabilities via trigger (optional but guarantees consistency)
create or replace function public.set_snapshot_net_worth()
returns trigger as $$
begin
  new.net_worth := coalesce(new.assets,0) - coalesce(new.liabilities,0);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_snapshot_net_worth on public.net_worth_snapshots;
create trigger trg_set_snapshot_net_worth
  before insert or update on public.net_worth_snapshots
  for each row execute function public.set_snapshot_net_worth();
