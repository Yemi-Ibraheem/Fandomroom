-- Keep the public article read policy independent from the private editor table.
-- PostgREST anon reads otherwise fail with permission denied when the editor
-- membership predicate is evaluated for public routes.
drop policy if exists "Published articles are public" on public.blog_posts;
drop policy if exists "Authenticated authors and editors can read articles" on public.blog_posts;
drop policy if exists "Blog articles are public to anon" on public.blog_posts;
drop policy if exists "Authenticated readers can access editorial articles" on public.blog_posts;

create policy "Blog articles are public to anon" on public.blog_posts
for select to anon using (published);

create policy "Authenticated readers can access editorial articles" on public.blog_posts
for select to authenticated using (
  published
  or author_id = (select auth.uid())
  or exists(select 1 from public.blog_editors e where e.user_id = (select auth.uid()))
);
