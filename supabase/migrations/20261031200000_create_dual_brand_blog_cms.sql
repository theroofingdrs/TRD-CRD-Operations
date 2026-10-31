-- Shared TRD / CRD blog publishing CMS.
-- Owner-only authoring; published articles are publicly readable.

create table if not exists public.crm_blog_posts (
  id uuid primary key default gen_random_uuid(),
  division_id text not null references public.crm_divisions(id),
  title text not null,
  slug text not null,
  excerpt text not null default '',
  body_markdown text not null default '',
  category text not null default 'General',
  featured_image_path text,
  featured_image_alt text not null default '',
  seo_title text,
  seo_description text,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'published', 'archived')),
  published_at timestamptz,
  scheduled_at timestamptz,
  archived_at timestamptz,
  author_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_blog_posts_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint crm_blog_posts_title_not_blank check (length(btrim(title)) > 0)
);

create unique index if not exists crm_blog_posts_division_slug_uidx
  on public.crm_blog_posts (division_id, slug);
create index if not exists crm_blog_posts_publication_idx
  on public.crm_blog_posts (division_id, status, published_at desc, scheduled_at);
create index if not exists crm_blog_posts_updated_idx
  on public.crm_blog_posts (updated_at desc);

create or replace function public.crm_blog_posts_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists crm_blog_posts_updated_at on public.crm_blog_posts;
create trigger crm_blog_posts_updated_at
before update on public.crm_blog_posts
for each row execute function public.crm_blog_posts_set_updated_at();

alter table public.crm_blog_posts enable row level security;

-- The Data API no longer exposes new public tables automatically.
grant select on public.crm_blog_posts to anon, authenticated;
grant insert, update, delete on public.crm_blog_posts to authenticated;

drop policy if exists crm_blog_posts_public_read on public.crm_blog_posts;
create policy crm_blog_posts_public_read
on public.crm_blog_posts for select to anon
using (
  (status = 'published' and published_at is not null and published_at <= now())
  or (status = 'scheduled' and scheduled_at is not null and scheduled_at <= now())
);

drop policy if exists crm_blog_posts_authenticated_read on public.crm_blog_posts;
create policy crm_blog_posts_authenticated_read
on public.crm_blog_posts for select to authenticated
using (
  app_private.is_crm_owner()
  or (status = 'published' and published_at is not null and published_at <= now())
  or (status = 'scheduled' and scheduled_at is not null and scheduled_at <= now())
);

drop policy if exists crm_blog_posts_owner_insert on public.crm_blog_posts;
create policy crm_blog_posts_owner_insert
on public.crm_blog_posts for insert to authenticated
with check (app_private.is_crm_owner() and (author_id is null or author_id = (select auth.uid())));

drop policy if exists crm_blog_posts_owner_update on public.crm_blog_posts;
create policy crm_blog_posts_owner_update
on public.crm_blog_posts for update to authenticated
using (app_private.is_crm_owner())
with check (app_private.is_crm_owner());

drop policy if exists crm_blog_posts_owner_delete on public.crm_blog_posts;
create policy crm_blog_posts_owner_delete
on public.crm_blog_posts for delete to authenticated
using (app_private.is_crm_owner());

-- Separate public image bucket: only article imagery belongs here, never CRM documents.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('roof-doctors-blog-media', 'roof-doctors-blog-media', true, 15728640,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists crm_blog_media_owner_insert on storage.objects;
create policy crm_blog_media_owner_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'roof-doctors-blog-media'
  and app_private.is_crm_owner()
  and (storage.foldername(name))[1] in ('trd', 'crd')
);

drop policy if exists crm_blog_media_owner_update on storage.objects;
create policy crm_blog_media_owner_update
on storage.objects for update to authenticated
using (bucket_id = 'roof-doctors-blog-media' and app_private.is_crm_owner())
with check (bucket_id = 'roof-doctors-blog-media' and app_private.is_crm_owner());

drop policy if exists crm_blog_media_owner_delete on storage.objects;
create policy crm_blog_media_owner_delete
on storage.objects for delete to authenticated
using (bucket_id = 'roof-doctors-blog-media' and app_private.is_crm_owner());

comment on table public.crm_blog_posts is 'Owner-managed public blog articles for The ROOF Doctors (TRD) and Commercial ROOF Doctors (CRD).';
comment on column public.crm_blog_posts.body_markdown is 'Markdown article body rendered by the public website; never store trusted raw HTML here.';
