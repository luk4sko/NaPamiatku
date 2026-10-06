-- Hosť nemá účet, preto je vlastníctvo jeho fotiek viazané na náhodný UUID
-- uložený len v localStorage konkrétneho prehliadača. Do databázy sa neukladá
-- samotný kľúč, iba jeho SHA-256 hash. Poznanie ID fotky alebo prezývky teda
-- nestačí na jej zmazanie.
alter table public.photos
  add column if not exists guest_owner_token_hash bytea;

comment on column public.photos.guest_owner_token_hash is
  'SHA-256 tajného UUID hosťa; oprávňuje odstrániť len fotku nahranú z toho istého prehliadača.';

-- Frontend nemá service_role, takže súbory nemaže priamo. Funkcia ich zaradí
-- do fronty a server/transcode.py ich odstráni cez Storage API so service_role
-- pri svojom najbližšom minútovom behu. Priame DELETE z storage.objects by
-- nechalo fyzický súbor v úložisku.
create table if not exists public.guest_photo_delete_queue (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

alter table public.guest_photo_delete_queue enable row level security;
revoke all on table public.guest_photo_delete_queue from anon, authenticated;

/* ---------- Nahratie s dôkazom vlastníctva ---------- */

-- Parameter p_owner_token mení podpis funkcie, preto najprv odstránime
-- starú štvorparametrovú verziu. Inak by sa dala volať popri novej a vložiť
-- fotku bez dôkazu vlastníctva.
drop function if exists public.guest_add_photo(text, text, text, text);

create or replace function public.guest_add_photo(
  p_slug text,
  p_nickname text,
  p_storage_path text,
  p_media_type text default 'photo',
  p_owner_token uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_photo_id uuid;
begin
  v_event_id := public.find_event_by_slug(p_slug);
  if v_event_id is null then raise exception 'Event sa nenašiel'; end if;
  if p_owner_token is null then raise exception 'Chýba overenie vlastníctva fotky'; end if;

  if p_storage_path is null or p_storage_path !~ (
    '^' || v_event_id::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|mp4|mov|webm)$'
  ) then
    raise exception 'Neplatná cesta k súboru';
  end if;

  insert into public.photos (
    event_id, storage_path, uploaded_by_nickname, media_type, guest_owner_token_hash
  )
  values (
    v_event_id,
    p_storage_path,
    left(coalesce(nullif(trim(p_nickname), ''), 'Hosť'), 40),
    case when p_media_type = 'video' then 'video' else 'photo' end,
    extensions.digest(p_owner_token::text, 'sha256')
  )
  returning id into v_photo_id;

  return v_photo_id;
end;
$$;

/* ---------- Zoznam vracia len bezpečný príznak vlastníctva ---------- */

drop function if exists public.guest_list_photos(text);
create function public.guest_list_photos(p_slug text, p_owner_token uuid default null)
returns table (
  id uuid, storage_path text, nickname text, created_at timestamptz,
  media_type text, video_status text, poster_path text, is_mine boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  v_event_id := public.find_event_by_slug(p_slug);
  if v_event_id is null then raise exception 'Event sa nenašiel'; end if;

  return query
  select
    p.id,
    p.storage_path,
    coalesce(p.uploaded_by_nickname, 'Hosť'),
    p.created_at,
    p.media_type,
    p.video_status,
    p.poster_path,
    p_owner_token is not null
      and p.guest_owner_token_hash = extensions.digest(p_owner_token::text, 'sha256')
  from public.photos p
  where p.event_id = v_event_id
  order by p.created_at desc;
end;
$$;

/* ---------- Zmazanie vlastnej fotky ---------- */

create or replace function public.guest_delete_photo(
  p_slug text,
  p_photo_id uuid,
  p_owner_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_storage_path text;
  v_poster_path text;
begin
  v_event_id := public.find_event_by_slug(p_slug);
  if v_event_id is null then raise exception 'Event sa nenašiel'; end if;
  if p_owner_token is null then raise exception 'Chýba overenie vlastníctva fotky'; end if;

  select p.storage_path, p.poster_path
    into v_storage_path, v_poster_path
  from public.photos p
  where p.id = p_photo_id
    and p.event_id = v_event_id
    and p.guest_owner_token_hash = extensions.digest(p_owner_token::text, 'sha256')
  for update;

  if not found then
    raise exception 'Môžeš zmazať iba fotku, ktorú si nahral z tohto zariadenia';
  end if;

  delete from public.photos where id = p_photo_id;

  insert into public.guest_photo_delete_queue (storage_path)
  select v_storage_path
  union all
  select v_poster_path where v_poster_path is not null
  on conflict (storage_path) do nothing;
end;
$$;

revoke all on function public.guest_add_photo(text, text, text, text, uuid) from public, anon;
grant execute on function public.guest_add_photo(text, text, text, text, uuid) to anon, authenticated;

revoke all on function public.guest_list_photos(text, uuid) from public;
grant execute on function public.guest_list_photos(text, uuid) to anon, authenticated;

revoke all on function public.guest_delete_photo(text, uuid, uuid) from public, anon;
grant execute on function public.guest_delete_photo(text, uuid, uuid) to anon, authenticated;
