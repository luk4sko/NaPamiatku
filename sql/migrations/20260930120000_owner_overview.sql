-- Panel "Prehľad" v dashboarde majiteľa: súhrnné čísla o celej službe
-- (klienti, akcie, fotky, hostia, úložisko) a vývoj po týždňoch.
--
-- Návštevnosť webu (koľko ľudí prišlo na stránku) meria Umami. Tu sú čísla
-- priamo z databázy - sú presné, lebo ich neovplyvní ad-blocker ani to,
-- či návštevník odmietol meranie.
--
-- SECURITY DEFINER: funkcia beží s právami toho, kto ju vytvoril (postgres),
-- takže vidí aj tabuľku storage.objects (veľkosť súborov), ku ktorej bežný
-- používateľ prístup nemá. RLS sa tu NEuplatní - preto hneď na začiatku
-- ručne overíme, že volá majiteľ. Bez tejto kontroly by si súhrn celej
-- služby prečítal ktokoľvek prihlásený.
create or replace function public.owner_overview()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- Týždne rátame v slovenskom čase, nie v UTC servera - inak by fotka
  -- z nedele 23:30 padla do nasledujúceho týždňa.
  this_week timestamp := date_trunc('week', now() at time zone 'Europe/Bratislava');
  result json;
begin
  if not public.is_majitel() then
    raise exception 'Prehľad vidí len majiteľ.' using errcode = '42501';
  end if;

  select json_build_object(
    'clients', (select count(*) from profiles where role = 'klient'),
    'clients_30d', (select count(*) from profiles
                    where role = 'klient' and created_at > now() - interval '30 days'),
    -- Zaregistrovali sa, ale akciu nezaložili - tu ľudia "odpadávajú".
    'clients_without_event', (select count(*) from profiles p
                              where p.role = 'klient'
                                and not exists (select 1 from events e where e.client_id = p.id)),

    'events', (select count(*) from events where status <> 'rejected'),
    'events_30d', (select count(*) from events
                   where status <> 'rejected' and created_at > now() - interval '30 days'),
    'events_upcoming', (select count(*) from events
                        where status <> 'rejected' and event_date >= current_date),

    'photos', (select count(*) from photos where media_type = 'photo'),
    'videos', (select count(*) from photos where media_type = 'video'),
    'messages', (select count(*) from guestbook_messages),
    -- Hosť nemá účet, poznáme ho len podľa mena, ktoré zadal. Rovnaké meno
    -- v rámci jednej akcie = jeden hosť (približné, ale na prehľad stačí).
    'guests', (select count(*) from (
                 select event_id, lower(trim(uploaded_by_nickname)) from photos
                 where coalesce(trim(uploaded_by_nickname), '') <> ''
                 union
                 select event_id, lower(trim(nickname)) from guestbook_messages
               ) as distinct_guests),
    'last_upload_at', (select max(created_at) from photos),

    -- Koľko miesta zaberajú všetky súbory na disku servera (v bajtoch).
    'storage_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects),

    -- Posledných 12 týždňov (od pondelka), najstarší prvý - na graf.
    'weeks', (select json_agg(json_build_object(
                'week', to_char(w.week, 'YYYY-MM-DD'),
                'clients', (select count(*) from profiles p where p.role = 'klient'
                            and date_trunc('week', p.created_at at time zone 'Europe/Bratislava') = w.week),
                'events', (select count(*) from events e
                           where date_trunc('week', e.created_at at time zone 'Europe/Bratislava') = w.week),
                'uploads', (select count(*) from photos ph
                            where date_trunc('week', ph.created_at at time zone 'Europe/Bratislava') = w.week),
                'messages', (select count(*) from guestbook_messages m
                             where date_trunc('week', m.created_at at time zone 'Europe/Bratislava') = w.week)
              ) order by w.week)
              from generate_series(this_week - interval '11 weeks', this_week, interval '1 week') as w(week)),

    -- 5 akcií s najväčším počtom fotiek a videí.
    'top_events', (select coalesce(json_agg(t), '[]'::json) from (
                     select e.id, e.name, e.event_date,
                            count(ph.id) as uploads,
                            (select count(*) from guestbook_messages m where m.event_id = e.id) as messages
                     from events e
                     left join photos ph on ph.event_id = e.id
                     where e.status <> 'rejected'
                     group by e.id
                     order by count(ph.id) desc, e.created_at desc
                     limit 5
                   ) as t)
  ) into result;

  return result;
end;
$$;

-- Hostia (anon) ju nesmú ani zavolať; prihlásený klient ju zavolať môže,
-- ale kontrola is_majitel() vyššie ho odmietne.
revoke all on function public.owner_overview() from public, anon;
grant execute on function public.owner_overview() to authenticated;
