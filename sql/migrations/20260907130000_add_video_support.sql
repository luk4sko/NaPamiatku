-- Bucket 'photos' doteraz prijímal len obrázky do 10 MB (storage_buckets_and_policies).
-- Video z mobilu je bežne desiatky MB, preto zvyšujeme limit a pridávame
-- bežné video formáty (mp4 = Android/väčšina appiek, quicktime = iPhone, webm).
update storage.buckets
set
  allowed_mime_types = array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/webm'
  ],
  file_size_limit = 104857600 -- 100 MB
where id = 'photos';

-- Galéria potrebuje vedieť, či má riadok vykresliť ako <img> alebo <video>.
alter table public.photos
  add column media_type text not null default 'photo'
  check (media_type in ('photo', 'video'));

-- Hostia nahrávajú cez túto RPC funkciu (nemajú vlastný účet) - treba jej
-- pridať parameter s typom média.
drop function if exists public.guest_add_photo(text, text, text, text);
create function public.guest_add_photo(
  p_slug text, p_password text, p_nickname text, p_storage_path text, p_media_type text default 'photo'
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

  insert into public.photos (event_id, storage_path, uploaded_by_nickname, media_type)
  values (
    v_event_id,
    p_storage_path,
    left(coalesce(nullif(trim(p_nickname), ''), 'Hosť'), 40),
    case when p_media_type = 'video' then 'video' else 'photo' end
  )
  returning id into v_photo_id;

  return v_photo_id;
end;
$$;

grant execute on function public.guest_add_photo(text, text, text, text, text) to anon, authenticated;

-- Galéria hostí (guest_list_photos) potrebuje media_type v odpovedi.
drop function if exists public.guest_list_photos(text, text);
create function public.guest_list_photos(p_slug text, p_password text)
returns table (id uuid, storage_path text, nickname text, created_at timestamptz, media_type text)
language plpgsql stable security definer set search_path = public
as $$
declare v_event_id uuid;
begin
  v_event_id := public.find_event_by_password(p_slug, p_password);
  if v_event_id is null then raise exception 'Neplatné heslo eventu'; end if;

  return query
  select p.id, p.storage_path, coalesce(p.uploaded_by_nickname, 'Hosť'), p.created_at, p.media_type
  from public.photos p
  where p.event_id = v_event_id
  order by p.created_at desc;
end;
$$;

grant execute on function public.guest_list_photos(text, text) to anon, authenticated;
