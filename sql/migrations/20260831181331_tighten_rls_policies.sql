-- Zrušíme staré, príliš voľné politiky (mali podmienku "true" = ktokoľvek).
drop policy if exists events_select_public on public.events;
drop policy if exists events_insert_owner on public.events;
drop policy if exists events_update_owner_or_client on public.events;
drop policy if exists events_delete_owner on public.events;

drop policy if exists photos_select_public on public.photos;
drop policy if exists photos_insert_public on public.photos;
drop policy if exists photos_delete_owner_or_client on public.photos;

drop policy if exists guestbook_select_public on public.guestbook_messages;
drop policy if exists guestbook_insert_public on public.guestbook_messages;
drop policy if exists guestbook_delete_owner_or_client on public.guestbook_messages;

-- Pomocná funkcia: smie prihlásený používateľ spravovať tento event?
create or replace function public.can_manage_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_majitel() or exists (
    select 1 from public.events
    where id = p_event_id and client_id = auth.uid()
  );
$$;

-- EVENTS: vidí ho iba Majiteľ (všetky) alebo Klient (svoje). Hostia sa k nemu
-- dostanú len cez RPC funkcie nižšie, ktoré overia heslo eventu.
create policy events_select_manager on public.events
  for select using (public.is_majitel() or client_id = auth.uid());

create policy events_update_manager on public.events
  for update using (public.is_majitel() or client_id = auth.uid())
  with check (public.is_majitel() or client_id = auth.uid());

create policy events_delete_majitel on public.events
  for delete using (public.is_majitel());

-- PHOTOS: čítanie a mazanie len pre správcov eventu. Hostia nahrávajú cez RPC.
create policy photos_select_manager on public.photos
  for select using (public.can_manage_event(event_id));

create policy photos_delete_manager on public.photos
  for delete using (public.can_manage_event(event_id));

-- GUESTBOOK: to isté.
create policy guestbook_select_manager on public.guestbook_messages
  for select using (public.can_manage_event(event_id));

create policy guestbook_delete_manager on public.guestbook_messages
  for delete using (public.can_manage_event(event_id));

-- GUEST PROFILES: správcovia vidia, hostia pracujú cez RPC.
create policy guest_profiles_select_manager on public.guest_profiles
  for select using (public.can_manage_event(event_id));

create policy guest_profiles_delete_manager on public.guest_profiles
  for delete using (public.can_manage_event(event_id));
