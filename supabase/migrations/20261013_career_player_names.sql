-- Run this migration in the Supabase SQL Editor before enabling career ranks.
-- One unique MLB player per authenticated user. Guests have no records.
create table if not exists public.career_player_names (
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id text not null check (length(player_id) between 1 and 64),
  first_named_at timestamptz not null default now(),
  primary key (user_id, player_id)
);
alter table public.career_player_names enable row level security;
create policy "Users read own career players" on public.career_player_names
  for select to authenticated using (auth.uid() = user_id);
create policy "Users insert own career players" on public.career_player_names
  for insert to authenticated with check (auth.uid() = user_id);
grant select, insert on public.career_player_names to authenticated;
-- NOTE: This client-written collection is not cheat-proof. For competitive
-- rankings, validate answers server-side before granting progression.
