-- Database events send small, authenticated payloads to the Vercel email endpoint.
-- Store the matching webhook secret in Supabase Vault before enabling delivery.
create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;

create table if not exists public.post_like_milestones (
  post_id uuid not null references public.posts(id) on delete cascade,
  milestone integer not null check (milestone in (1, 10, 50, 100)),
  created_at timestamptz not null default now(),
  primary key (post_id, milestone)
);
alter table public.post_like_milestones enable row level security;
revoke all on public.post_like_milestones from anon, authenticated;

create or replace function public.fandomroom_send_notification(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'fandomroom_notification_webhook_secret'
  limit 1;

  -- The application can still operate while email delivery is being configured.
  if v_secret is null or v_secret = '' then return; end if;

  perform net.http_post(
    url := 'https://www.fandomroom.com/api/notifications',
    body := p_payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notification-secret', v_secret)
  );
end;
$$;
revoke all on function public.fandomroom_send_notification(jsonb) from public, anon, authenticated;

create or replace function public.fandomroom_notify_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The extension creates anonymous auth.users rows; those are not signups.
  if new.is_anonymous is not true and new.email is not null then
    perform public.fandomroom_send_notification(jsonb_build_object(
      'type', 'new_signup',
      'event_id', 'signup:' || new.id::text,
      'user_id', new.id::text,
      'user_email', new.email,
      'created_at', new.created_at
    ));
  end if;
  return new;
end;
$$;
drop trigger if exists fandomroom_notify_signup on auth.users;
create trigger fandomroom_notify_signup
  after insert on auth.users
  for each row execute function public.fandomroom_notify_signup();

create or replace function public.fandomroom_notify_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient_id uuid;
  v_recipient_email text;
  v_actor_username text;
begin
  if new.parent_id is null then
    select t.author_id into v_recipient_id
    from public.threads t where t.id = new.thread_id;
  else
    select c.author_id into v_recipient_id
    from public.thread_comments c where c.id = new.parent_id;
  end if;

  if v_recipient_id is null or v_recipient_id = new.author_id then return new; end if;

  select u.email into v_recipient_email from auth.users u where u.id = v_recipient_id;
  select p.username into v_actor_username from public.profiles p where p.id = new.author_id;
  if v_recipient_email is null then return new; end if;

  perform public.fandomroom_send_notification(jsonb_build_object(
    'type', case when new.parent_id is null then 'thread_comment' else 'comment_reply' end,
    'event_id', 'comment:' || new.id::text,
    'recipient_email', v_recipient_email,
    'actor_username', v_actor_username,
    'body', new.body,
    'thread_id', new.thread_id::text,
    'comment_id', new.id::text,
    'created_at', new.created_at
  ));
  return new;
end;
$$;
drop trigger if exists fandomroom_notify_comment on public.thread_comments;
create trigger fandomroom_notify_comment
  after insert on public.thread_comments
  for each row execute function public.fandomroom_notify_comment();

create or replace function public.fandomroom_notify_like_milestone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts%rowtype;
  v_recipient_email text;
  v_actor_username text;
  v_like_count integer;
  v_milestone integer;
begin
  select p.* into v_post from public.posts p where p.id = new.post_id;
  if not found or v_post.author_id = new.user_id then return new; end if;

  select count(*)::integer into v_like_count
  from public.post_likes l where l.post_id = new.post_id;
  if v_like_count not in (1, 10, 50, 100) then return new; end if;
  v_milestone := v_like_count;

  insert into public.post_like_milestones (post_id, milestone)
  values (new.post_id, v_milestone)
  on conflict do nothing;
  if not found then return new; end if;

  select u.email into v_recipient_email from auth.users u where u.id = v_post.author_id;
  select p.username into v_actor_username from public.profiles p where p.id = new.user_id;
  if v_recipient_email is null then return new; end if;

  perform public.fandomroom_send_notification(jsonb_build_object(
    'type', 'like_milestone',
    'event_id', 'like:' || new.post_id::text || ':' || v_milestone::text,
    'recipient_email', v_recipient_email,
    'actor_username', v_actor_username,
    'body', v_post.body,
    'post_id', new.post_id::text,
    'milestone', v_milestone,
    'created_at', new.created_at
  ));
  return new;
end;
$$;
drop trigger if exists fandomroom_notify_like_milestone on public.post_likes;
create trigger fandomroom_notify_like_milestone
  after insert on public.post_likes
  for each row execute function public.fandomroom_notify_like_milestone();
