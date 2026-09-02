insert into storage.buckets (id, name, public)
values ('photos', 'photos', true);

create policy "photos_bucket_select_public" on storage.objects
  for select using (bucket_id = 'photos');

create policy "photos_bucket_insert_public" on storage.objects
  for insert with check (bucket_id = 'photos');

create policy "photos_bucket_delete_owner_or_client" on storage.objects
  for delete using (
    bucket_id = 'photos'
    and exists (
      select 1 from events
      where events.id::text = (storage.foldername(name))[1]
        and (events.owner_id = auth.uid() or events.client_id = auth.uid())
    )
  );
