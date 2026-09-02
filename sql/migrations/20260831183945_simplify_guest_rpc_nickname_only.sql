drop policy if exists avatars_cleanup_delete on storage.objects;

-- Storage politiky sa vracajú len na bucket photos.
drop policy if exists photos_storage_read on storage.objects;
create policy photos_storage_read on storage.objects
  for select using (bucket_id = 'photos');

drop policy if exists photos_storage_insert on storage.objects;
create policy photos_storage_insert on storage.objects
  for insert with check (bucket_id = 'photos');

-- Prepísané funkcie pre hostí: namiesto guest_id sa posiela rovno prezývka.
drop function if exists public.guest_list_photos(text, text);
create function public.guest_list_photos(p_slug text, p_password text)
returns table (id uuid, storage_path text, nickname text, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
declare v_event_id uuid;
begin
  v_event_id := public.find_event_by_password(p_slug, p_password);
  if v_event_id is null then raise exception 'Neplatné heslo eventu'; end if;

  return query
  select p.id, p.storage_path, coalesce(p.uploaded_by_nickname, 'Hosť'), p.created_at
  from public.photos p
  where p.event_id = v_event_id
  order by p.created_at desc;
end;
$$;

drop function if exists public.guest_add_photo(text, text, uuid, text);
create function public.guest_add_photo(
  p_slug text, p_password text, p_nickname text, p_storage_path text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_event_id uuid;
  v_photo_id uuid;
begin
  v_event_id := public.find_event_by_password(p_slug, p_password);
  if v_event_id is null then raise exception 'Neplatné heslo eventu'; end if;

  -- Cesta k súboru musí patriť tomuto eventu.
  if p_storage_path is null or p_storage_path not like v_event_id::text || '/%' then
    raise exception 'Neplatná cesta k súboru';
  end if;

  insert into public.photos (event_id, storage_path, uploaded_by_nickname)
  values (v_event_id, p_storage_path, left(coalesce(nullif(trim(p_nickname), ''), 'Hosť'), 40))
  returning id into v_photo_id;

  return v_photo_id;
end;
$$;

drop function if exists public.guest_list_messages(text, text);
create function public.guest_list_messages(p_slug text, p_password text)
returns table (id uuid, message text, nickname text, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
declare v_event_id uuid;
begin
  v_event_id := public.find_event_by_password(p_slug, p_password);
  if v_event_id is null then raise exception 'Neplatné heslo eventu'; end if;

  return query
  select m.id, m.message, coalesce(m.nickname, 'Hosť'), m.created_at
  from public.guestbook_messages m
  where m.event_id = v_event_id
  order by m.created_at desc;
end;
$$;

drop function if exists public.guest_add_message(text, text, uuid, text);
create function public.guest_add_message(
  p_slug text, p_password text, p_nickname text, p_message text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_event_id uuid;
  v_message_id uuid;
begin
  v_event_id := public.find_event_by_password(p_slug, p_password);
  if v_event_id is null then raise exception 'Neplatné heslo eventu'; end if;

  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'Odkaz nesmie byť prázdny';
  end if;
  if length(p_message) > 1000 then
    raise exception 'Odkaz je príliš dlhý (max 1000 znakov)';
  end if;

  insert into public.guestbook_messages (event_id, nickname, message)
  values (v_event_id, left(coalesce(nullif(trim(p_nickname), ''), 'Hosť'), 40), trim(p_message))
  returning id into v_message_id;

  return v_message_id;
end;
$$;

grant execute on function public.guest_list_photos(text, text) to anon, authenticated;
grant execute on function public.guest_add_photo(text, text, text, text) to anon, authenticated;
grant execute on function public.guest_list_messages(text, text) to anon, authenticated;
grant execute on function public.guest_add_message(text, text, text, text) to anon, authenticated;
