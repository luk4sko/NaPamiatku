-- Hosť už nemá žiadny profil ani profilovku - stačí prezývka,
-- ktorá sa ukladá priamo k fotke a k odkazu. Tabuľka guest_profiles
-- sa tým stáva zbytočnou.

alter table public.photos drop column if exists guest_id;
alter table public.guestbook_messages drop column if exists guest_id;

drop table if exists public.guest_profiles cascade;

drop function if exists public.guest_save_profile(text, text, uuid, text, text);

-- Dočasné povolenie, aby sa dali cez Storage API zmazať staré profilovky.
drop policy if exists avatars_cleanup_delete on storage.objects;
create policy avatars_cleanup_delete on storage.objects
  for delete to authenticated using (bucket_id = 'avatars');
