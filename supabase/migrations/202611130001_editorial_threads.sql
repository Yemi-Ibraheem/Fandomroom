-- Public editorial articles and their comments for the /blog section.
create table if not exists public.blog_editors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100),
  title text not null check (char_length(trim(title)) between 5 and 180),
  excerpt text not null check (char_length(trim(excerpt)) between 20 and 300),
  content text not null check (char_length(trim(content)) between 100 and 50000),
  cover_image text,
  topic text not null default 'Anime',
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not published or published_at is not null)
);
create index if not exists blog_posts_published_idx on public.blog_posts (published_at desc) where published;

create table if not exists public.blog_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.blog_posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists blog_comments_post_idx on public.blog_comments (post_id, created_at);

alter table public.blog_editors enable row level security;
alter table public.blog_posts enable row level security;
alter table public.blog_comments enable row level security;
drop policy if exists "Editors can see editorial permissions" on public.blog_editors;
create policy "Editors can see editorial permissions" on public.blog_editors for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Published articles are public" on public.blog_posts;
create policy "Published articles are public" on public.blog_posts for select to anon, authenticated using (published or author_id = (select auth.uid()));
drop policy if exists "Editors can create articles" on public.blog_posts;
drop policy if exists "Editors and Premium members can create articles" on public.blog_posts;
create policy "Editors and Premium members can create articles" on public.blog_posts for insert to authenticated with check (author_id = (select auth.uid()) and (exists(select 1 from public.blog_editors e where e.user_id = (select auth.uid())) or coalesce((select auth.jwt() -> 'app_metadata' ->> 'plan'), '') = 'premium'));
drop policy if exists "Editors can update articles" on public.blog_posts;
drop policy if exists "Editors and Premium members can update articles" on public.blog_posts;
create policy "Editors and Premium members can update articles" on public.blog_posts for update to authenticated using (author_id = (select auth.uid()) and (exists(select 1 from public.blog_editors e where e.user_id = (select auth.uid())) or coalesce((select auth.jwt() -> 'app_metadata' ->> 'plan'), '') = 'premium')) with check (author_id = (select auth.uid()) and (exists(select 1 from public.blog_editors e where e.user_id = (select auth.uid())) or coalesce((select auth.jwt() -> 'app_metadata' ->> 'plan'), '') = 'premium'));
drop policy if exists "Editors can remove articles" on public.blog_posts;
drop policy if exists "Authors can remove their articles" on public.blog_posts;
create policy "Authors can remove their articles" on public.blog_posts for delete to authenticated using (author_id = (select auth.uid()) and (exists(select 1 from public.blog_editors e where e.user_id = (select auth.uid())) or coalesce((select auth.jwt() -> 'app_metadata' ->> 'plan'), '') = 'premium'));
drop policy if exists "Comments are public on published articles" on public.blog_comments;
create policy "Comments are public on published articles" on public.blog_comments for select to anon, authenticated using (exists(select 1 from public.blog_posts p where p.id = post_id and p.published));
drop policy if exists "Members can comment on published articles" on public.blog_comments;
create policy "Members can comment on published articles" on public.blog_comments for insert to authenticated with check ((select auth.jwt() ->> 'is_anonymous') is distinct from 'true' and author_id = (select auth.uid()) and exists(select 1 from public.blog_posts p where p.id = post_id and p.published));
drop policy if exists "Authors can remove their article comments" on public.blog_comments;
create policy "Authors can remove their article comments" on public.blog_comments for delete to authenticated using (author_id = (select auth.uid()));
grant usage on schema public to anon, authenticated;
revoke all on public.blog_editors, public.blog_posts, public.blog_comments from anon, authenticated;
grant select on public.blog_posts, public.blog_comments to anon, authenticated;
grant select on public.blog_editors to authenticated;
grant insert, update, delete on public.blog_posts to authenticated;
grant insert, delete on public.blog_comments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blog-images', 'blog-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "Blog cover images are public" on storage.objects;
create policy "Blog cover images are public" on storage.objects for select to anon, authenticated using (bucket_id = 'blog-images');
drop policy if exists "Editors can upload blog cover images" on storage.objects;
drop policy if exists "Editors and Premium members can upload blog cover images" on storage.objects;
create policy "Editors and Premium members can upload blog cover images" on storage.objects for insert to authenticated with check (bucket_id = 'blog-images' and (select auth.uid())::text = (storage.foldername(name))[1] and (exists(select 1 from public.blog_editors e where e.user_id = (select auth.uid())) or coalesce((select auth.jwt() -> 'app_metadata' ->> 'plan'), '') = 'premium'));

-- Enforce Premium access for new community polls and rankings, including RPC inserts.
create or replace function public.require_premium_for_thread_creation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() -> 'app_metadata' ->> 'plan'), '') <> 'premium' then
    raise exception 'Creating polls and rankings is a Fandom Room Premium feature.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.require_premium_for_thread_creation() from public, anon, authenticated;
drop trigger if exists premium_required_for_thread_creation on public.threads;
create trigger premium_required_for_thread_creation before insert on public.threads
for each row execute function public.require_premium_for_thread_creation();

