-- Fandom Room poll and ranking threads. Safe to apply to projects that already
-- have the discussion schema from 202611040001_talkanime_discussions.sql.

create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  thread_type text not null check (thread_type in ('poll', 'ranking')),
  title text not null check (char_length(trim(title)) between 5 and 180),
  context text not null default '' check (char_length(context) <= 1000),
  topic text not null default 'Anime',
  anime_slug text not null default 'general',
  poll_mode text check (poll_mode in ('single', 'multiple')),
  ranking_mode text check (ranking_mode in ('full', 'top_three')),
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  constraint thread_mode_matches_type check (
    (thread_type = 'poll' and poll_mode is not null and ranking_mode is null)
    or (thread_type = 'ranking' and ranking_mode is not null and poll_mode is null)
  ),
  constraint thread_closing_time_future check (closes_at is null or closes_at > created_at)
);

create index if not exists threads_created_idx on public.threads (created_at desc);
create index if not exists threads_topic_created_idx on public.threads (topic, created_at desc);

create table if not exists public.thread_items (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 100),
  image_url text not null,
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  unique (thread_id, position),
  unique (id, thread_id)
);
create index if not exists thread_items_thread_idx on public.thread_items (thread_id, position);

create table if not exists public.thread_responses (
  thread_id uuid not null references public.threads(id) on delete cascade,
  item_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  position integer check (position is null or position > 0),
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id, item_id),
  foreign key (item_id, thread_id) references public.thread_items(id, thread_id) on delete cascade,
  unique (thread_id, user_id, position)
);
create index if not exists thread_responses_thread_idx on public.thread_responses (thread_id, item_id);

create table if not exists public.thread_comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  parent_id uuid,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique (id, thread_id),
  foreign key (parent_id, thread_id) references public.thread_comments(id, thread_id) on delete cascade
);
create index if not exists thread_comments_created_idx on public.thread_comments (thread_id, created_at);

alter table public.threads enable row level security;
alter table public.thread_items enable row level security;
alter table public.thread_responses enable row level security;
alter table public.thread_comments enable row level security;

drop policy if exists "Threads are public to read" on public.threads;
create policy "Threads are public to read" on public.threads for select to anon, authenticated using (true);
drop policy if exists "Signed-in users can create threads" on public.threads;
create policy "Signed-in users can create threads" on public.threads for insert to authenticated
  with check (author_id = (select auth.uid()));
drop policy if exists "Authors can delete their threads" on public.threads;
create policy "Authors can delete their threads" on public.threads for delete to authenticated
  using (author_id = (select auth.uid()));

drop policy if exists "Thread items are public to read" on public.thread_items;
create policy "Thread items are public to read" on public.thread_items for select to anon, authenticated using (true);
drop policy if exists "Authors can add thread items" on public.thread_items;
create policy "Authors can add thread items" on public.thread_items for insert to authenticated
  with check (exists (select 1 from public.threads t where t.id = thread_id and t.author_id = (select auth.uid())));
drop policy if exists "Authors can delete thread items" on public.thread_items;

drop policy if exists "Users can only read their own thread responses" on public.thread_responses;
create policy "Users can only read their own thread responses" on public.thread_responses for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Users can only read their own thread responses anon" on public.thread_responses;
drop policy if exists "Users can comment on public threads" on public.thread_comments;
create policy "Users can comment on public threads" on public.thread_comments for select to anon, authenticated using (true);
drop policy if exists "Signed-in users can add thread comments" on public.thread_comments;
create policy "Signed-in users can add thread comments" on public.thread_comments for insert to authenticated
  with check (author_id = (select auth.uid()) and (select auth.jwt() ->> 'is_anonymous') is distinct from 'true');
drop policy if exists "Authors can delete their thread comments" on public.thread_comments;
create policy "Authors can delete their thread comments" on public.thread_comments for delete to authenticated
  using (author_id = (select auth.uid()));

grant usage on schema public to anon, authenticated;
revoke all on public.threads, public.thread_items, public.thread_responses, public.thread_comments from anon, authenticated;
grant select on public.threads, public.thread_items, public.thread_comments to anon, authenticated;
grant delete on public.threads to authenticated;
grant insert, delete on public.thread_comments to authenticated;
grant select on public.thread_responses to authenticated;

create or replace function public.create_fandomroom_thread(
  p_thread_id uuid,
  p_thread_type text,
  p_title text,
  p_context text,
  p_topic text,
  p_anime_slug text,
  p_poll_mode text,
  p_ranking_mode text,
  p_closes_at timestamptz,
  p_items jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_count integer;
begin
  if v_user is null or (select auth.jwt() ->> 'is_anonymous') = 'true' then raise exception 'Create an account and sign in to create a thread.' using errcode = '28000'; end if;
  if p_thread_type not in ('poll', 'ranking') then raise exception 'Choose a poll or ranking.'; end if;
  if p_title is null or char_length(trim(p_title)) not between 5 and 180 then raise exception 'Title must be 5 to 180 characters.'; end if;
  if p_context is not null and char_length(p_context) > 1000 then raise exception 'Context must be 1000 characters or fewer.'; end if;
  if pg_catalog.jsonb_typeof(p_items) <> 'array' then raise exception 'Add image choices to this thread.'; end if;
  v_count := pg_catalog.jsonb_array_length(p_items);
  if v_count < 2 or v_count > 12 then raise exception 'Add between 2 and 12 image choices.'; end if;
  if p_thread_type = 'poll' and (p_poll_mode not in ('single', 'multiple') or p_ranking_mode is not null) then raise exception 'Choose a valid poll response format.'; end if;
  if p_thread_type = 'ranking' and (p_ranking_mode not in ('full', 'top_three') or p_poll_mode is not null or p_closes_at is not null) then raise exception 'Choose a valid ranking format.'; end if;
  if p_closes_at is not null and p_closes_at <= pg_catalog.now() then raise exception 'Choose a future poll closing time.'; end if;

  insert into public.threads (id, author_id, thread_type, title, context, topic, anime_slug, poll_mode, ranking_mode, closes_at)
  values (p_thread_id, v_user, p_thread_type, trim(p_title), coalesce(p_context, ''), coalesce(nullif(trim(p_topic), ''), 'Anime'), coalesce(nullif(trim(p_anime_slug), ''), 'general'), p_poll_mode, p_ranking_mode, p_closes_at);

  insert into public.thread_items (thread_id, label, image_url, position)
  select p_thread_id, trim(item.value ->> 'label'), item.value ->> 'image_url', item.ordinality::integer
  from pg_catalog.jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
  where pg_catalog.jsonb_typeof(item.value) = 'object'
    and pg_catalog.char_length(trim(coalesce(item.value ->> 'label', ''))) between 1 and 100
    and (item.value ->> 'image_url') like 'https://zbayifekoqasimvqreav.supabase.co/storage/v1/object/public/thread-images/%';

  if (select pg_catalog.count(*) from public.thread_items i where i.thread_id = p_thread_id) <> v_count then
    raise exception 'Each choice needs a label and an uploaded image.';
  end if;
  return p_thread_id;
end;
$$;

create or replace function public.submit_fandomroom_poll_vote(p_thread_id uuid, p_item_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_mode text;
  v_closes timestamptz;
  v_count integer;
  v_distinct integer;
  v_items integer;
begin
  if v_user is null or (select auth.jwt() ->> 'is_anonymous') = 'true' then raise exception 'Create an account and sign in to vote.' using errcode = '28000'; end if;
  select t.poll_mode, t.closes_at into v_mode, v_closes from public.threads t where t.id = p_thread_id and t.thread_type = 'poll';
  if not found then raise exception 'Poll not found.'; end if;
  if v_closes is not null and v_closes <= pg_catalog.now() then raise exception 'This poll is closed.'; end if;
  v_count := coalesce(pg_catalog.cardinality(p_item_ids), 0);
  select pg_catalog.count(distinct x.item_id) into v_distinct from pg_catalog.unnest(coalesce(p_item_ids, array[]::uuid[])) as x(item_id);
  if v_count < 1 or v_count <> v_distinct or (v_mode = 'single' and v_count <> 1) then raise exception 'Choose a valid number of options.'; end if;
  select pg_catalog.count(*) into v_items from public.thread_items i where i.thread_id = p_thread_id and i.id = any(p_item_ids);
  if v_items <> v_count then raise exception 'One or more choices do not belong to this poll.'; end if;
  delete from public.thread_responses r where r.thread_id = p_thread_id and r.user_id = v_user;
  insert into public.thread_responses (thread_id, item_id, user_id, position)
  select p_thread_id, picked.item_id, v_user, null from pg_catalog.unnest(p_item_ids) as picked(item_id);
end;
$$;

create or replace function public.submit_fandomroom_ranking(p_thread_id uuid, p_item_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_mode text;
  v_count integer;
  v_distinct integer;
  v_total integer;
begin
  if v_user is null or (select auth.jwt() ->> 'is_anonymous') = 'true' then raise exception 'Create an account and sign in to rank.' using errcode = '28000'; end if;
  select t.ranking_mode into v_mode from public.threads t where t.id = p_thread_id and t.thread_type = 'ranking';
  if not found then raise exception 'Ranking not found.'; end if;
  v_count := coalesce(pg_catalog.cardinality(p_item_ids), 0);
  select pg_catalog.count(distinct x.item_id) into v_distinct from pg_catalog.unnest(coalesce(p_item_ids, array[]::uuid[])) as x(item_id);
  select pg_catalog.count(*) into v_total from public.thread_items i where i.thread_id = p_thread_id;
  if v_count < 2 or v_count <> v_distinct or (v_mode = 'full' and v_count <> v_total) or (v_mode = 'top_three' and v_count <> least(3, v_total)) then
    raise exception 'Submit a valid order for this ranking.';
  end if;
  if (select pg_catalog.count(*) from public.thread_items i where i.thread_id = p_thread_id and i.id = any(p_item_ids)) <> v_count then
    raise exception 'One or more items do not belong to this ranking.';
  end if;
  delete from public.thread_responses r where r.thread_id = p_thread_id and r.user_id = v_user;
  insert into public.thread_responses (thread_id, item_id, user_id, position)
  select p_thread_id, item_id, v_user, ordinality::integer from pg_catalog.unnest(p_item_ids) with ordinality as picked(item_id, ordinality);
end;
$$;

create or replace function public.get_fandomroom_poll_results(p_thread_id uuid)
returns table (item_id uuid, response_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in to view poll results.' using errcode = '28000'; end if;
  if not exists (select 1 from public.threads t where t.id = p_thread_id and t.thread_type = 'poll') then raise exception 'Poll not found.'; end if;
  if not exists (select 1 from public.thread_responses r where r.thread_id = p_thread_id and r.user_id = (select auth.uid())) then
    raise exception 'Vote to see the results.';
  end if;
  return query
    select i.id, pg_catalog.count(r.user_id)
    from public.thread_items i
    left join public.thread_responses r on r.item_id = i.id and r.thread_id = i.thread_id
    where i.thread_id = p_thread_id
    group by i.id, i.position
    order by i.position;
end;
$$;

create or replace function public.get_fandomroom_ranking_results(p_thread_id uuid)
returns table (item_id uuid, average_position numeric, ranking_count bigint)
language sql stable security definer set search_path = '' as $$
  select i.id, pg_catalog.round(pg_catalog.avg(r.position), 2), pg_catalog.count(distinct r.user_id)
  from public.thread_items i
  left join public.thread_responses r on r.item_id = i.id and r.thread_id = i.thread_id
  join public.threads t on t.id = i.thread_id and t.thread_type = 'ranking'
  where i.thread_id = p_thread_id
  group by i.id, i.position
  order by pg_catalog.avg(r.position) nulls last, i.position;
$$;

revoke all on function public.create_fandomroom_thread(uuid, text, text, text, text, text, text, text, timestamptz, jsonb) from public, anon;
revoke all on function public.submit_fandomroom_poll_vote(uuid, uuid[]) from public, anon;
revoke all on function public.submit_fandomroom_ranking(uuid, uuid[]) from public, anon;
revoke all on function public.get_fandomroom_poll_results(uuid) from public, anon;
revoke all on function public.get_fandomroom_ranking_results(uuid) from public, anon;
grant execute on function public.create_fandomroom_thread(uuid, text, text, text, text, text, text, timestamptz, jsonb) to authenticated;
grant execute on function public.submit_fandomroom_poll_vote(uuid, uuid[]) to authenticated;
grant execute on function public.submit_fandomroom_ranking(uuid, uuid[]) to authenticated;
grant execute on function public.get_fandomroom_poll_results(uuid) to authenticated;
grant execute on function public.get_fandomroom_ranking_results(uuid) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('thread-images', 'thread-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Thread images are public to read" on storage.objects;
create policy "Thread images are public to read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'thread-images');
drop policy if exists "Signed-in users upload to their own folder" on storage.objects;
create policy "Signed-in users upload to their own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'thread-images' and (storage.foldername(name))[1] = (select auth.uid())::text and (select auth.jwt() ->> 'is_anonymous') is distinct from 'true');
drop policy if exists "Users update their own thread images" on storage.objects;
create policy "Users update their own thread images" on storage.objects for update to authenticated
  using (bucket_id = 'thread-images' and (storage.foldername(name))[1] = (select auth.uid())::text and (select auth.jwt() ->> 'is_anonymous') is distinct from 'true')
  with check (bucket_id = 'thread-images' and (storage.foldername(name))[1] = (select auth.uid())::text and (select auth.jwt() ->> 'is_anonymous') is distinct from 'true');
drop policy if exists "Users delete their own thread images" on storage.objects;
create policy "Users delete their own thread images" on storage.objects for delete to authenticated
  using (bucket_id = 'thread-images' and (storage.foldername(name))[1] = (select auth.uid())::text and (select auth.jwt() ->> 'is_anonymous') is distinct from 'true');
