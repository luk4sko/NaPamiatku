-- Automatické mazanie obsahu eventu po 12 mesiacoch.
--
-- Podmienky (§6) a zásady ochrany údajov sľubujú: obsah eventu je dostupný
-- 12 mesiacov od dátumu eventu (ak dátum nie je zadaný, od schválenia),
-- potom ho zmažeme a organizátora upozorníme e-mailom najmenej 14 dní vopred.
--
-- Rozdelenie práce: databáza rozhoduje KTORÉ eventy sú na rade (tieto dve
-- funkcie), skript server/retention.py spúšťaný cronom raz denne to VYKONÁ
-- (pošle e-mail cez SMTP a zmaže súbory cez Storage API - to zo SQL nejde,
-- súbory ležia na disku mimo databázy).

-- Kedy sme organizátora upozornili. Bez toho by cron posielal e-mail každý deň.
alter table public.events
  add column if not exists expiry_warning_sent_at timestamptz;

-- Eventy, ktorým treba poslať upozornenie: do zmazania ostáva 14 dní alebo
-- menej a ešte sme ho neposlali. Vracia aj e-mail organizátora z auth.users,
-- preto SECURITY DEFINER - bežný používateľ do auth.users nevidí.
-- delete_on je deň, ktorý napíšeme do e-mailu: koniec lehoty, ale najskôr
-- o 14 dní - event, ktorý je po lehote už dnes, dostane celých 14 dní.
create or replace function public.retention_events_to_warn()
returns table (id uuid, name text, delete_on date, organizer_email text)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.name,
    greatest(
      (coalesce(e.event_date, e.approved_at::date) + interval '12 months')::date,
      current_date + 14
    ) as delete_on,
    u.email::text as organizer_email
  from public.events e
  join auth.users u on u.id = e.client_id
  where e.status = 'approved'
    and e.expiry_warning_sent_at is null
    and coalesce(e.event_date, e.approved_at::date) + interval '12 months' - interval '14 days' <= current_date
  order by delete_on;
$$;

-- Eventy na zmazanie: lehota uplynula A upozornenie odišlo aspoň pred
-- 14 dňami. Druhá podmienka zaručí sľúbených 14 dní aj eventom, ktoré boli
-- po lehote už v deň nasadenia tejto migrácie - najprv dostanú e-mail.
create or replace function public.retention_events_to_delete()
returns table (id uuid, name text, delete_on date)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.name,
    (coalesce(e.event_date, e.approved_at::date) + interval '12 months')::date as delete_on
  from public.events e
  where e.status = 'approved'
    and coalesce(e.event_date, e.approved_at::date) + interval '12 months' <= current_date
    and e.expiry_warning_sent_at <= now() - interval '14 days'
  order by delete_on;
$$;

-- Obe funkcie čítajú cudzie eventy a e-maily, preto ich smie volať len
-- service_role (kľúč, ktorý má iba skript na serveri) - nikdy anon ani
-- prihlásený používateľ cez REST API.
revoke all on function public.retention_events_to_warn() from public, anon, authenticated;
revoke all on function public.retention_events_to_delete() from public, anon, authenticated;
grant execute on function public.retention_events_to_warn() to service_role;
grant execute on function public.retention_events_to_delete() to service_role;
