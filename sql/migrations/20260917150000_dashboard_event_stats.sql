-- Dashboard doteraz kvôli počtom fotiek sťahoval z tabuľky photos všetky
-- riadky všetkých eventov a rátal ich v prehliadači. Pri desiatkach eventov
-- so stovkami fotiek je to zbytočne veľa dát. Táto funkcia vráti pre každý
-- event len súhrn: počet fotiek, videí, odkazov a cestu k najnovšej fotke
-- (obrázok na kartu eventu).
--
-- SECURITY INVOKER (predvolené): funkcia beží s právami prihláseného
-- používateľa, takže RLS politiky na photos / guestbook_messages platia
-- ďalej - majiteľ dostane súhrn všetkých eventov, klient len svojich.
create or replace function public.dashboard_event_stats()
returns table (
  event_id uuid,
  photo_count bigint,
  video_count bigint,
  message_count bigint,
  cover_path text
)
language sql
stable
set search_path = public
as $$
  with photo_stats as (
    select
      p.event_id,
      count(*) filter (where p.media_type = 'photo') as photo_count,
      count(*) filter (where p.media_type = 'video') as video_count,
      -- Najnovšia fotka (nie video) ako obrázok na kartu.
      (array_agg(p.storage_path order by p.created_at desc)
         filter (where p.media_type = 'photo'))[1] as cover_path
    from public.photos p
    group by p.event_id
  ),
  message_stats as (
    select m.event_id, count(*) as message_count
    from public.guestbook_messages m
    group by m.event_id
  )
  select
    e.id as event_id,
    coalesce(ps.photo_count, 0) as photo_count,
    coalesce(ps.video_count, 0) as video_count,
    coalesce(ms.message_count, 0) as message_count,
    ps.cover_path
  from public.events e
  left join photo_stats ps on ps.event_id = e.id
  left join message_stats ms on ms.event_id = e.id;
$$;

-- Hostia (anon) dashboard nemajú, funkciu potrebujú len prihlásení.
revoke all on function public.dashboard_event_stats() from public, anon;
grant execute on function public.dashboard_event_stats() to authenticated;
