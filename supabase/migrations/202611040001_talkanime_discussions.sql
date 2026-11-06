create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  created_at timestamptz not null default now()
);

create or replace function public.create_talkanime_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'fan_' || substr(replace(new.id::text, '-', ''), 1, 12))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_talkanime_user_created on auth.users;
create trigger on_talkanime_user_created
  after insert on auth.users
  for each row execute function public.create_talkanime_profile();

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  anime_slug text not null,
  scope text not null check (scope in ('anime', 'episode')),
  season text not null default '',
  episode text not null default '',
  parent_id uuid references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  spoiler boolean not null default false,
  created_at timestamptz not null default now(),
  constraint posts_parent_scope_check check (
    (parent_id is null and scope in ('anime', 'episode')) or parent_id is not null
  )
);

create index if not exists posts_room_created_idx
  on public.posts (anime_slug, scope, season, episode, created_at desc)
  where parent_id is null;
create index if not exists posts_parent_created_idx on public.posts (parent_id, created_at);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.follows (
  user_id uuid not null references public.profiles(id) on delete cascade,
  anime_slug text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, anime_slug)
);

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.follows enable row level security;

drop policy if exists "Profiles are readable" on public.profiles;
create policy "Profiles are readable" on public.profiles for select to anon, authenticated using (true);
drop policy if exists "Users can update their profile" on public.profiles;
create policy "Users can update their profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "Posts are readable" on public.posts;
create policy "Posts are readable" on public.posts for select to anon, authenticated using (true);
drop policy if exists "Users can create their own posts and replies" on public.posts;
create policy "Users can create their own posts and replies" on public.posts for insert to authenticated
  with check (author_id = (select auth.uid()));
drop policy if exists "Users can delete their own posts and replies" on public.posts;
create policy "Users can delete their own posts and replies" on public.posts for delete to authenticated
  using (author_id = (select auth.uid()));

drop policy if exists "Likes are readable" on public.post_likes;
create policy "Likes are readable" on public.post_likes for select to anon, authenticated using (true);
drop policy if exists "Users can like as themselves" on public.post_likes;
create policy "Users can like as themselves" on public.post_likes for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Users can remove their own likes" on public.post_likes;
create policy "Users can remove their own likes" on public.post_likes for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Follows are private to their user" on public.follows;
create policy "Follows are private to their user" on public.follows for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Users can follow as themselves" on public.follows;
create policy "Users can follow as themselves" on public.follows for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Users can unfollow themselves" on public.follows;
create policy "Users can unfollow themselves" on public.follows for delete to authenticated
  using (user_id = (select auth.uid()));

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.posts, public.post_likes to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant insert, delete on public.posts, public.post_likes, public.follows to authenticated;
grant select on public.follows to authenticated;
