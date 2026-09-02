-- Interná pomocná funkcia: nájde schválený event podľa slug a overí heslo.
-- Vracia id eventu alebo NULL. Nie je dostupná zvonku (revoke nižšie).
create or replace function public.find_event_by_password(p_slug text, p_password text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_event public.events%rowtype;
begin
  select * into v_event
  from public.events
  where slug = p_slug and status = 'approved';

  if not found then
    return null;
  end if;

  -- crypt() zahashuje zadané heslo tou istou soľou ako uložený hash
  -- a porovná výsledok. Heslo v čitateľnej podobe v databáze nikdy nie je.
  if v_event.password_hash is null
     or v_event.password_hash <> extensions.crypt(p_password, v_event.password_hash) then
    return null;
  end if;

  return v_event.id;
end;
$$;

revoke all on function public.find_event_by_password(text, text) from public, anon, authenticated;

-- 1) Otvorenie eventu hosťom - overí heslo a vráti základné info o evente.
create or replace function public.guest_open_event(p_slug text, p_password text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_result json;
begin
  v_event_id := public.find_event_by_password(p_slug, p_password);
  if v_event_id is null then
    return null;
  end if;

  select json_build_object(
    'id', e.id,
    'name', e.name,
    'event_date', e.event_date,
    'gift_enabled', e.gift_enabled,
    'gift_iban', e.gift_iban,
    'gift_recipient', e.gift_recipient,
    'gift_message', e.gift_message
  ) into v_result
  from public.events e
  where e.id = v_event_id;

  return v_result;
end;
$$;

-- 2) Vytvorenie/úprava profilu hosťa. Pri prvom volaní (p_guest_id je null)
-- databáza vygeneruje id, ktoré si prehliadač uloží do localStorage.
create or replace function public.guest_save_profile(
  p_slug text,
  p_password text,
  p_guest_id uuid,
  p_nickname text,
  p_avatar_path text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_guest_id uuid;
begin
  v_event_id := public.find_event_by_password(p_slug, p_password);
  if v_event_id is null then
    raise exception 'Neplatné heslo eventu';
  end if;

  if p_nickname is null or length(trim(p_nickname)) = 0 then
    raise exception 'Prezývka nesmie byť prázdna';
  end if;
  if length(p_nickname) > 40 then
    raise exception 'Prezývka je príliš dlhá';
  end if;

  if p_guest_id is not null then
    update public.guest_profiles
    set nickname = trim(p_nickname),
        avatar_path = coalesce(p_avatar_path, avatar_path)
    where id = p_guest_id and event_id = v_event_id
    returning id into v_guest_id;
  end if;

  if v_guest_id is null then
    insert into public.guest_profiles (event_id, nickname, avatar_path)
    values (v_event_id, trim(p_nickname), p_avatar_path)
    returning id into v_guest_id;
  end if;

  return v_guest_id;
end;
$$;

-- 3) Zoznam fotiek pre hosťa
create or replace function public.guest_list_photos(p_slug text, p_password text)
returns table (
  id uuid,
  storage_path text,
  nickname text,
  avatar_path text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  v_event_id := public.find_event_by_password(p_slug, p_password);
  if v_event_id is null then
    raise exception 'Neplatné heslo eventu';
  end if;

  return query
  select p.id,
         p.storage_path,
         coalesce(g.nickname, p.uploaded_by_nickname, 'Neznámy hosť'),
         g.avatar_path,
         p.created_at
  from public.photos p
  left join public.guest_profiles g on g.id = p.guest_id
  where p.event_id = v_event_id
  order by p.created_at desc;
end;
$$;

-- 4) Pridanie fotky hosťom
create or replace function public.guest_add_photo(
  p_slug text,
  p_password text,
  p_guest_id uuid,
  p_storage_path text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_nickname text;
  v_photo_id uuid;
begin
  v_event_id := public.find_event_by_password(p_slug, p_password);
  if v_event_id is null then
    raise exception 'Neplatné heslo eventu';
  end if;

  -- Cesta k súboru musí patriť tomuto eventu - inak by hosť mohol
  -- do svojho eventu "pripojiť" cudzí súbor z iného eventu.
  if p_storage_path is null or p_storage_path not like v_event_id::text || '/%' then
    raise exception 'Neplatná cesta k súboru';
  end if;

  select nickname into v_nickname
  from public.guest_profiles
  where id = p_guest_id and event_id = v_event_id;

  insert into public.photos (event_id, storage_path, guest_id, uploaded_by_nickname)
  values (v_event_id, p_storage_path, p_guest_id, v_nickname)
  returning id into v_photo_id;

  return v_photo_id;
end;
$$;

-- 5) Kniha hostí - zoznam
create or replace function public.guest_list_messages(p_slug text, p_password text)
returns table (
  id uuid,
  message text,
  nickname text,
  avatar_path text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  v_event_id := public.find_event_by_password(p_slug, p_password);
  if v_event_id is null then
    raise exception 'Neplatné heslo eventu';
  end if;

  return query
  select m.id,
         m.message,
         coalesce(g.nickname, m.nickname, 'Neznámy hosť'),
         g.avatar_path,
         m.created_at
  from public.guestbook_messages m
  left join public.guest_profiles g on g.id = m.guest_id
  where m.event_id = v_event_id
  order by m.created_at desc;
end;
$$;

-- 6) Kniha hostí - pridanie odkazu
create or replace function public.guest_add_message(
  p_slug text,
  p_password text,
  p_guest_id uuid,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_nickname text;
  v_message_id uuid;
begin
  v_event_id := public.find_event_by_password(p_slug, p_password);
  if v_event_id is null then
    raise exception 'Neplatné heslo eventu';
  end if;

  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'Odkaz nesmie byť prázdny';
  end if;
  if length(p_message) > 1000 then
    raise exception 'Odkaz je príliš dlhý (max 1000 znakov)';
  end if;

  select nickname into v_nickname
  from public.guest_profiles
  where id = p_guest_id and event_id = v_event_id;

  insert into public.guestbook_messages (event_id, nickname, message, guest_id)
  values (v_event_id, coalesce(v_nickname, 'Neznámy hosť'), trim(p_message), p_guest_id)
  returning id into v_message_id;

  return v_message_id;
end;
$$;

grant execute on function public.guest_open_event(text, text) to anon, authenticated;
grant execute on function public.guest_save_profile(text, text, uuid, text, text) to anon, authenticated;
grant execute on function public.guest_list_photos(text, text) to anon, authenticated;
grant execute on function public.guest_add_photo(text, text, uuid, text) to anon, authenticated;
grant execute on function public.guest_list_messages(text, text) to anon, authenticated;
grant execute on function public.guest_add_message(text, text, uuid, text) to anon, authenticated;
