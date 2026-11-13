create table if not exists public.thread_ranking_feedback (
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  opinion text not null check (opinion in ('agree', 'disagree')),
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

alter table public.thread_ranking_feedback enable row level security;
revoke all on public.thread_ranking_feedback from anon, authenticated;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create or replace function private.get_fandomroom_ranking_feedback(p_thread_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'agree', count(*) filter (where f.opinion = 'agree'),
    'disagree', count(*) filter (where f.opinion = 'disagree'),
    'my_vote', max(f.opinion) filter (where f.user_id = auth.uid())
  )
  from public.thread_ranking_feedback f
  where f.thread_id = p_thread_id
    and exists (select 1 from public.threads t where t.id = p_thread_id and t.thread_type = 'ranking');
$$;

create or replace function private.submit_fandomroom_ranking_feedback(p_thread_id uuid, p_opinion text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or (select auth.jwt() ->> 'is_anonymous') = 'true' then
    raise exception 'Sign in to vote on a ranking.';
  end if;
  if p_opinion not in ('agree', 'disagree') then
    raise exception 'Choose agree or disagree.';
  end if;
  if not exists (select 1 from public.threads t where t.id = p_thread_id and t.thread_type = 'ranking') then
    raise exception 'Ranking not found.';
  end if;
  insert into public.thread_ranking_feedback (thread_id, user_id, opinion)
  values (p_thread_id, auth.uid(), p_opinion)
  on conflict (thread_id, user_id) do update set opinion = excluded.opinion, created_at = now();
end;
$$;

revoke all on function private.get_fandomroom_ranking_feedback(uuid) from public;
revoke all on function private.submit_fandomroom_ranking_feedback(uuid, text) from public;
grant execute on function private.get_fandomroom_ranking_feedback(uuid) to anon, authenticated;
grant execute on function private.submit_fandomroom_ranking_feedback(uuid, text) to authenticated;

create or replace function public.get_fandomroom_ranking_feedback(p_thread_id uuid)
returns jsonb language sql stable security invoker set search_path = public, private
as $$ select private.get_fandomroom_ranking_feedback(p_thread_id); $$;

create or replace function public.submit_fandomroom_ranking_feedback(p_thread_id uuid, p_opinion text)
returns void language sql security invoker set search_path = public, private
as $$ select private.submit_fandomroom_ranking_feedback(p_thread_id, p_opinion); $$;

revoke all on function public.get_fandomroom_ranking_feedback(uuid) from public;
revoke all on function public.submit_fandomroom_ranking_feedback(uuid, text) from public;
grant execute on function public.get_fandomroom_ranking_feedback(uuid) to anon, authenticated;
grant execute on function public.submit_fandomroom_ranking_feedback(uuid, text) to authenticated;
