-- Apply in Supabase SQL Editor before merging the corresponding frontend PR.
-- Global scores are provisional until game answers are verified server-side.
create table if not exists public.bk_game_results (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 mode text not null check (mode in ('solo','cpu')),
 score integer not null check (score between 0 and 100000),
 played_at timestamptz not null default now()
);
create index if not exists bk_game_results_user_idx on public.bk_game_results(user_id);
alter table public.bk_game_results enable row level security;
revoke all on public.bk_game_results from anon, authenticated;
create table if not exists public.bk_player_name_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 player_id text not null check (length(player_id) between 1 and 64),
 game_id bigint not null references public.bk_game_results(id) on delete cascade,
 named_at timestamptz not null default now(),
 unique(game_id,player_id)
);
create index if not exists bk_player_name_events_player_idx on public.bk_player_name_events(player_id);
alter table public.bk_player_name_events enable row level security;
revoke all on public.bk_player_name_events from anon, authenticated;
create or replace function public.record_career_game(p_mode text,p_score integer,p_player_ids text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_game bigint; v_ids text[];
begin
 if v_uid is null then raise exception 'Sign in required'; end if;
 if p_mode not in ('solo','cpu') or p_score < 0 or p_score > 100000 then raise exception 'Invalid result'; end if;
 if cardinality(p_player_ids)>100000 or cardinality(p_player_ids) is null then raise exception 'Invalid player list'; end if;
 select array_agg(distinct x) into v_ids from unnest(p_player_ids) x where x is not null and length(x) between 1 and 64;
 if coalesce(cardinality(v_ids),0) <> p_score then raise exception 'Score does not match named players'; end if;
 insert into public.bk_game_results(user_id,mode,score) values(v_uid,p_mode,p_score) returning id into v_game;
 insert into public.bk_player_name_events(user_id,player_id,game_id)
 select v_uid,x,v_game from unnest(coalesce(v_ids,array[]::text[])) x;
end $$;
revoke all on function public.record_career_game(text,integer,text[]) from public, anon;
grant execute on function public.record_career_game(text,integer,text[]) to authenticated;
create or replace function public.get_global_leaderboard()
returns table(username text,best_single_game bigint,all_time_players_named bigint)
language sql stable security definer set search_path=public,pg_temp as $$
 select p.username::text,coalesce(max(r.score),0)::bigint,coalesce(sum(r.score),0)::bigint
 from public.profiles p join public.bk_game_results r on r.user_id=p.id
 where p.username is not null
 group by p.id,p.username
 order by max(r.score) desc limit 1000;
$$;
revoke all on function public.get_global_leaderboard() from public, anon;
grant execute on function public.get_global_leaderboard() to authenticated;
-- Rarity data is collected, but rarity percentages are intentionally not exposed yet.
-- SECURITY NOTE: Scores and name events originate in the browser. A malicious client
-- can forge them. Add server-side game session and player validation before prizes
-- or competitive/financial stakes. Protect against duplicate game submissions.
