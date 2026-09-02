-- Event teraz patrí Klientovi (client_id) a musí ho schváliť Majiteľ.
alter table public.events
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  add column if not exists password_hash text,
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists gift_enabled boolean not null default false,
  add column if not exists gift_iban text,
  add column if not exists gift_recipient text,
  add column if not exists gift_message text;

-- Migrácia existujúcich dát: doterajší owner_id bol tvorca eventu -> je to klient eventu.
update public.events
set client_id = owner_id
where client_id is null;

update public.events
set status = 'approved'
where status = 'pending' and password_hash is null;

-- owner_id už nepotrebujeme (Majiteľ má prístup cez rolu, nie cez vlastníctvo riadku).
alter table public.events alter column owner_id drop not null;

-- Profil hosťa - "ľahký účet" bez emailu a hesla.
-- id generuje databáza a klient si ho uloží do localStorage.
create table if not exists public.guest_profiles (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  nickname text not null,
  avatar_path text,
  created_at timestamptz not null default now()
);

alter table public.guest_profiles enable row level security;

alter table public.photos
  add column if not exists guest_id uuid references public.guest_profiles(id) on delete set null;

alter table public.guestbook_messages
  add column if not exists guest_id uuid references public.guest_profiles(id) on delete set null;

create index if not exists photos_event_id_idx on public.photos(event_id);
create index if not exists guestbook_event_id_idx on public.guestbook_messages(event_id);
create index if not exists events_client_id_idx on public.events(client_id);
create index if not exists guest_profiles_event_id_idx on public.guest_profiles(event_id);
