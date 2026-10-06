-- Každá hosťovská fotka dostane náhodný kľúč uložený iba v prehliadači, z ktorého
-- ju hosť nahral. Bez neho nie je možné fotku odstrániť.
alter table public.photos
  add column if not exists guest_delete_token uuid;

-- Server túto krátku frontu spracuje cez Storage API, aby spolu s databázovým
-- záznamom odstránil aj samotný súbor a prípadný náhľad videa.
create table if not exists public.guest_photo_delete_queue (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

alter table public.guest_photo_delete_queue enable row level security;
revoke all on table public.guest_photo_delete_queue from anon, authenticated;

-- Starú verziu musíme odstrániť, aby sa nedala pridať fotka bez kľúča.
drop function if exists public.guest_add_photo(text, text, text, text);

create function public.guest_add_photo(
  p_slug text,
  p_nickname text,
  p_storage_path text,
  p_media_type text,
  p_owner_token uuid
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

  if p_owner_token is null or p_storage_path is null or p_storage_path !~ (
    '^' || v_event_id::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|mp4|mov|webm)$'
  ) then
    raise exception 'Neplatná fotka';
  end if;

  insert into public.photos (
    event_id, storage_path, uploaded_by_nickname, media_type, guest_delete_token
  ) values (
    v_event_id,
    p_storage_path,
    left(coalesce(nullif(trim(p_nickname), ''), 'Hosť'), 40),
    case when p_media_type = 'video' then 'video' else 'photo' end,
    p_owner_token
  ) returning id into v_photo_id;

  return v_photo_id;
end;
$$;

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

  delete from public.photos
  where id = p_photo_id
    and event_id = v_event_id
    and guest_delete_token = p_owner_token
  returning storage_path, poster_path into v_storage_path, v_poster_path;

  if not found then
    raise exception 'Môžeš zmazať iba svoju fotku';
  end if;

  insert into public.guest_photo_delete_queue (storage_path)
  select v_storage_path
  union all
  select v_poster_path where v_poster_path is not null
  on conflict (storage_path) do nothing;
end;
$$;

revoke all on function public.guest_add_photo(text, text, text, text, uuid) from public;
grant execute on function public.guest_add_photo(text, text, text, text, uuid) to anon, authenticated;

revoke all on function public.guest_delete_photo(text, uuid, uuid) from public;
grant execute on function public.guest_delete_photo(text, uuid, uuid) to anon, authenticated;
