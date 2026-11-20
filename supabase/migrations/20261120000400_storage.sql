-- ============================================================================
-- MORGGY — 0004 storage
-- Product imagery lives in a public-read bucket. Only staff can write to it.
-- ============================================================================
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy product_images_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-images');

create policy product_images_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_staff());

create policy product_images_staff_update on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_staff())
  with check (bucket_id = 'product-images' and public.is_staff());

create policy product_images_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_staff());

commit;
