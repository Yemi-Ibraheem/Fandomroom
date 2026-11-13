-- Grant the Fandom Room owner account editorial administration capabilities.
-- The account must already exist in Supabase Auth when this migration runs.
insert into public.blog_editors (user_id)
select id from auth.users where lower(email) = 'info@fandomroom.com'
on conflict (user_id) do nothing;

create or replace function public.grant_fandomroom_blog_superuser()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if lower(coalesce(new.email, '')) = 'info@fandomroom.com' then
    insert into public.blog_editors (user_id) values (new.id) on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.grant_fandomroom_blog_superuser() from public, anon, authenticated;
drop trigger if exists grant_fandomroom_blog_superuser on auth.users;
create trigger grant_fandomroom_blog_superuser
after insert or update of email on auth.users
for each row execute function public.grant_fandomroom_blog_superuser();

-- Blog editors can see drafts and manage all articles; Premium members manage their own.
drop policy if exists "Published articles are public" on public.blog_posts;
create policy "Published articles are public" on public.blog_posts
for select to anon using (published);
create policy "Authenticated authors and editors can read articles" on public.blog_posts
for select to authenticated using (
  published
  or author_id = (select auth.uid())
  or exists(select 1 from public.blog_editors e where e.user_id = (select auth.uid()))
);

drop policy if exists "Editors and Premium members can update articles" on public.blog_posts;
create policy "Editors and Premium members can update articles" on public.blog_posts
for update to authenticated
using (
  exists(select 1 from public.blog_editors e where e.user_id = (select auth.uid()))
  or (author_id = (select auth.uid()) and coalesce((select auth.jwt() -> 'app_metadata' ->> 'plan'), '') = 'premium')
)
with check (
  exists(select 1 from public.blog_editors e where e.user_id = (select auth.uid()))
  or (author_id = (select auth.uid()) and coalesce((select auth.jwt() -> 'app_metadata' ->> 'plan'), '') = 'premium')
);

drop policy if exists "Authors can remove their articles" on public.blog_posts;
drop policy if exists "Editors and Premium members can remove articles" on public.blog_posts;
create policy "Editors and Premium members can remove articles" on public.blog_posts
for delete to authenticated
using (
  exists(select 1 from public.blog_editors e where e.user_id = (select auth.uid()))
  or (author_id = (select auth.uid()) and coalesce((select auth.jwt() -> 'app_metadata' ->> 'plan'), '') = 'premium')
);

drop policy if exists "Authors can remove their article comments" on public.blog_comments;
drop policy if exists "Authors and editors can remove article comments" on public.blog_comments;
create policy "Authors and editors can remove article comments" on public.blog_comments
for delete to authenticated
using (
  author_id = (select auth.uid())
  or exists(select 1 from public.blog_editors e where e.user_id = (select auth.uid()))
);

-- Editors are trusted site administrators; Premium remains the creator entitlement for everyone else.
create or replace function public.require_premium_for_thread_creation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.blog_editors e where e.user_id = (select auth.uid()))
    and coalesce((select auth.jwt() -> 'app_metadata' ->> 'plan'), '') <> 'premium' then
    raise exception 'Creating polls and rankings is a Fandom Room Premium feature.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.require_premium_for_thread_creation() from public, anon, authenticated;

