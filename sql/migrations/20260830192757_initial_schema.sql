-- events = jeden "projekt" (svadba/event)
create table events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references auth.users(id) on delete set null,
  name text not null,
  event_date date,
  slug text unique not null default gen_random_uuid()::text,
  created_at timestamptz not null default now()
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  storage_path text not null,
  uploaded_by_user_id uuid references auth.users(id) on delete set null,
  uploaded_by_nickname text,
  created_at timestamptz not null default now()
);

create table guestbook_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  nickname text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index photos_event_id_idx on photos(event_id);
create index guestbook_messages_event_id_idx on guestbook_messages(event_id);

alter table events enable row level security;
alter table photos enable row level security;
alter table guestbook_messages enable row level security;

-- events: hostia (aj neprihlasení) musia vediet nacitat event podla slugu/id, aby fungoval QR link
create policy "events_select_public" on events
  for select using (true);

create policy "events_insert_owner" on events
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy "events_update_owner_or_client" on events
  for update using (owner_id = auth.uid() or client_id = auth.uid());

create policy "events_delete_owner" on events
  for delete using (owner_id = auth.uid());

-- photos: galeria aj upload musia fungovat bez uctu (hostia)
create policy "photos_select_public" on photos
  for select using (true);

create policy "photos_insert_public" on photos
  for insert with check (true);

create policy "photos_delete_owner_or_client" on photos
  for delete using (
    exists (
      select 1 from events
      where events.id = photos.event_id
        and (events.owner_id = auth.uid() or events.client_id = auth.uid())
    )
  );

-- guestbook: kazdy hoste moze pisat aj citat, mazat (moderovat) len vlastnik/klient
create policy "guestbook_select_public" on guestbook_messages
  for select using (true);

create policy "guestbook_insert_public" on guestbook_messages
  for insert with check (true);

create policy "guestbook_delete_owner_or_client" on guestbook_messages
  for delete using (
    exists (
      select 1 from events
      where events.id = guestbook_messages.event_id
        and (events.owner_id = auth.uid() or events.client_id = auth.uid())
    )
  );
