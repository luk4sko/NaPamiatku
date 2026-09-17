-- Nahlasovanie nevhodných fotiek hosťami (mechanizmus "notice and action"
-- podľa nariadenia o digitálnych službách, DSA čl. 16). Hosť nemá účet,
-- preto nahlásenie vytvára SECURITY DEFINER funkcia, ktorá - rovnako ako
-- ostatné guest_* funkcie - najprv overí heslo eventu.

create table public.photo_reports (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.photos(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  -- Nepovinný kontakt, aby sme nahlasujúcemu vedeli oznámiť výsledok.
  reporter_contact text check (reporter_contact is null or char_length(reporter_contact) <= 200),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index photo_reports_event_open_idx
  on public.photo_reports (event_id) where resolved_at is null;

alter table public.photo_reports enable row level security;

-- Nahlásenia vidí a vybavuje organizátor daného eventu alebo majiteľ.
create policy photo_reports_select_manager on public.photo_reports
  for select using (public.can_manage_event(event_id));

create policy photo_reports_update_manager on public.photo_reports
  for update using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

create policy photo_reports_delete_manager on public.photo_reports
  for delete using (public.can_manage_event(event_id));

-- Vloženie priamo do tabuľky nie je povolené nikomu - ide len cez funkciu.

create or replace function public.guest_report_photo(
  p_slug text, p_password text, p_photo_id uuid, p_reason text, p_contact text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_event_id uuid;
  v_report_id uuid;
begin
  v_event_id := public.find_event_by_password(p_slug, p_password);
  if v_event_id is null then raise exception 'Neplatné heslo eventu'; end if;

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

revoke all on function public.guest_report_photo(text, text, uuid, text, text) from public;
grant execute on function public.guest_report_photo(text, text, uuid, text, text) to anon, authenticated;
