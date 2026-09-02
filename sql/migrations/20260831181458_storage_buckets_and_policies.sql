-- Limity priamo na bucket-e: max 10 MB a len obrázky.
-- Toto je zásadné - bez limitu by ktokoľvek mohol nahrať obrovský alebo
-- spustiteľný súbor a zaplniť/zneužiť úložisko.
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
where id = 'photos';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types,
    public = excluded.public;

drop policy if exists photos_storage_read on storage.objects;
create policy photos_storage_read on storage.objects
  for select using (bucket_id in ('photos', 'avatars'));

-- Hostia nahrávajú bez účtu, preto musí byť insert povolený aj pre anon.
-- Samotný riadok v tabuľke photos ale vznikne až cez RPC, ktoré overí heslo eventu.
drop policy if exists photos_storage_insert on storage.objects;
create policy photos_storage_insert on storage.objects
  for insert with check (bucket_id in ('photos', 'avatars'));

-- Mazať smie len ten, kto smie spravovať event (prvý priečinok v ceste = event_id).
drop policy if exists photos_storage_delete on storage.objects;
create policy photos_storage_delete on storage.objects
  for delete using (
    bucket_id = 'photos'
    and public.can_manage_event(((storage.foldername(name))[1])::uuid)
  );
