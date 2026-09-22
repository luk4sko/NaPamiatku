-- Heslo eventu sa ruší. Dôvod je praktický: na akcii (svadba, oslava) heslo
-- nič nechránilo - organizátor ho povedal nahlas do mikrofónu alebo ho
-- vytlačil na kartičku hneď vedľa QR kódu. Kto videl kód, videl aj heslo.
-- Zato spoľahlivo brzdilo hostí: starší ľudia ho preklepli, a kto prišiel
-- neskôr, musel niekoho hľadať a pýtať sa.
--
-- Čím je event chránený teraz: samotným slug-om. Ten je gen_random_uuid(),
-- teda 122 náhodných bitov - uhádnuť sa nedá a vyhľadávače ho nenájdu
-- (guest.html má noindex). Je to model "tajný odkaz", rovnaký aký používa
-- nezverejnené video na YouTube alebo zdieľaný odkaz v Google Drive: kto
-- odkaz má, je dnu; kto ho nemá, nedostane sa k ničomu. Keď odkaz unikne,
-- organizátor ho zneplatní tlačidlom "Vygenerovať nový odkaz"
-- (regenerate_event_slug) a starý QR kód prestane fungovať.
--
-- Čo sa NEMENÍ: heslá účtov organizátorov (Supabase Auth) ostávajú. Tu ide
-- výhradne o heslo, ktoré zadával hosť po naskenovaní QR kódu.

-- Nová interná pomocná funkcia. Overuje už len to, že event existuje a je
-- aktívny - takže pozastavenie eventu majiteľom (status = 'rejected')
-- naďalej okamžite odreže hostí.
create or replace function public.find_event_by_slug(p_slug text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  select id into v_event_id
  from public.events
  where slug = p_slug and status = 'approved';

  return v_event_id;
end;
$$;

revoke all on function public.find_event_by_slug(text) from public, anon, authenticated;

-- Starým funkciám sa mení zoznam parametrov, a to je pre Postgres iná
-- funkcia - "create or replace" by preto vyrobilo druhú verziu vedľa starej.
-- Preto drop + create.

/* ---------- 1) Otvorenie eventu ---------- */

drop function if exists public.guest_open_event(text, text);
create function public.guest_open_event(p_slug text)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  v_event_id uuid;
  v_result json;
begin
  v_event_id := public.find_event_by_slug(p_slug);
  if v_event_id is null then return null; end if;

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

/* ---------- 2) Zoznam fotiek ---------- */

drop function if exists public.guest_list_photos(text, text);
create function public.guest_list_photos(p_slug text)
returns table (
  id uuid, storage_path text, nickname text, created_at timestamptz,
  media_type text, video_status text, poster_path text
)
language plpgsql stable security definer set search_path = public
as $$
declare v_event_id uuid;
begin
  v_event_id := public.find_event_by_slug(p_slug);
  if v_event_id is null then raise exception 'Event sa nenašiel'; end if;

  return query
  select p.id, p.storage_path, coalesce(p.uploaded_by_nickname, 'Hosť'), p.created_at,
         p.media_type, p.video_status, p.poster_path
  from public.photos p
  where p.event_id = v_event_id
  order by p.created_at desc;
end;
$$;

/* ---------- 3) Pridanie fotky ---------- */

-- Kontrola tvaru cesty ostáva nedotknutá a je teraz o to dôležitejšia:
-- funkciu smie volať rola anon, takže na jej parametre sa treba pozerať ako
-- na vstup od cudzieho človeka. Podrobne v migrácii
-- 20260908120000_harden_guest_photo_path.sql.
drop function if exists public.guest_add_photo(text, text, text, text, text);
create function public.guest_add_photo(
  p_slug text, p_nickname text, p_storage_path text, p_media_type text default 'photo'
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_event_id uuid;
  v_photo_id uuid;
begin
  v_event_id := public.find_event_by_slug(p_slug);
  if v_event_id is null then raise exception 'Event sa nenašiel'; end if;

  if p_storage_path is null or p_storage_path !~ (
    '^' || v_event_id::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|mp4|mov|webm)$'
  ) then
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

/* ---------- 4) Kniha hostí - zoznam ---------- */

drop function if exists public.guest_list_messages(text, text);
create function public.guest_list_messages(p_slug text)
returns table (id uuid, message text, nickname text, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
declare v_event_id uuid;
begin
  v_event_id := public.find_event_by_slug(p_slug);
  if v_event_id is null then raise exception 'Event sa nenašiel'; end if;

  return query
  select m.id, m.message, coalesce(m.nickname, 'Hosť'), m.created_at
  from public.guestbook_messages m
  where m.event_id = v_event_id
  order by m.created_at desc;
end;
$$;

/* ---------- 5) Kniha hostí - pridanie ---------- */

drop function if exists public.guest_add_message(text, text, text, text);
create function public.guest_add_message(
  p_slug text, p_nickname text, p_message text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_event_id uuid;
  v_message_id uuid;
begin
  v_event_id := public.find_event_by_slug(p_slug);
  if v_event_id is null then raise exception 'Event sa nenašiel'; end if;

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

/* ---------- 6) Nahlásenie fotky ---------- */

drop function if exists public.guest_report_photo(text, text, uuid, text, text);
create function public.guest_report_photo(
  p_slug text, p_photo_id uuid, p_reason text, p_contact text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_event_id uuid;
  v_report_id uuid;
begin
  v_event_id := public.find_event_by_slug(p_slug);
  if v_event_id is null then raise exception 'Event sa nenašiel'; end if;

  -- Fotka musí patriť tomuto eventu (hosť nemôže nahlasovať cudzie eventy).
  if not exists (select 1 from public.photos where id = p_photo_id and event_id = v_event_id) then
    raise exception 'Fotka neexistuje';
  end if;

  -- Ochrana pred zahltením: najviac 20 nahlásení na event za hodinu.
  if (select count(*) from public.photo_reports
      where event_id = v_event_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Príliš veľa nahlásení, skús to neskôr';
  end if;

  insert into public.photo_reports (photo_id, event_id, reason, reporter_contact)
  values (p_photo_id, v_event_id, trim(p_reason), nullif(trim(p_contact), ''))
  returning id into v_report_id;

  return v_report_id;
end;
$$;

/* ---------- 7) Vytvorenie eventu bez hesla ---------- */

drop function if exists public.request_event(text, date, text);
create function public.request_event(p_name text, p_event_date date)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_event_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Musíš byť prihlásený';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Názov eventu nesmie byť prázdny';
  end if;
  if (select count(*) from public.events where client_id = auth.uid() and status = 'approved') >= 20 then
    raise exception 'Máš už 20 aktívnych eventov. Staré eventy najprv zmaž.';
  end if;

  insert into public.events (name, event_date, client_id, status, approved_at)
  values (trim(p_name), p_event_date, auth.uid(), 'approved', now())
  returning id into v_event_id;

  return v_event_id;
end;
$$;

/* ---------- 8) Upratanie po heslách ---------- */

drop function if exists public.set_event_password(uuid, text);
drop function if exists public.find_event_by_password(text, text);

-- Hashe už nemá čo overovať - preč aj z databázy, nech sa v zálohách
-- nepovaľuje niečo, čo appka nepoužíva.
alter table public.events drop column if exists password_hash;

/* ---------- Práva ---------- */

grant execute on function public.guest_open_event(text) to anon, authenticated;
grant execute on function public.guest_list_photos(text) to anon, authenticated;
grant execute on function public.guest_add_photo(text, text, text, text) to anon, authenticated;
grant execute on function public.guest_list_messages(text) to anon, authenticated;
grant execute on function public.guest_add_message(text, text, text) to anon, authenticated;
revoke all on function public.guest_report_photo(text, uuid, text, text) from public;
grant execute on function public.guest_report_photo(text, uuid, text, text) to anon, authenticated;
grant execute on function public.request_event(text, date) to authenticated;
