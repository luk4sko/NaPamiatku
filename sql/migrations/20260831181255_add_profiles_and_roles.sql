-- Rozšírenie pgcrypto (crypt/gen_salt) - potrebné na hashovanie hesla eventu
create extension if not exists pgcrypto with schema extensions;

-- Tabuľka profilov: každý prihlásený používateľ má rolu majitel alebo klient.
-- Rola je vlastnosť používateľa (platformy), nie konkrétneho eventu.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'klient' check (role in ('majitel', 'klient')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Profil sa vytvorí automaticky pri registrácii/pozvaní používateľa.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Pomocná funkcia: je prihlásený používateľ majiteľ?
-- security definer, aby čítanie profiles nespustilo znova RLS (nekonečná rekurzia).
create or replace function public.is_majitel()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'majitel'
  );
$$;

-- Doplnenie profilov pre už existujúcich používateľov
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- Politiky pre profiles
drop policy if exists profiles_select_self_or_majitel on public.profiles;
create policy profiles_select_self_or_majitel on public.profiles
  for select using (id = auth.uid() or public.is_majitel());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_update_majitel on public.profiles;
create policy profiles_update_majitel on public.profiles
  for update using (public.is_majitel());
