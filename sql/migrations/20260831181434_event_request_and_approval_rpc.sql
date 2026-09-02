-- Klient požiada o event. Event vznikne so stavom 'pending' a heslom,
-- ktoré si Klient zvolí. Heslo sa ukladá zahashované (bcrypt), nikdy čitateľné.
create or replace function public.request_event(
  p_name text,
  p_event_date date,
  p_password text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
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
  if p_password is null or length(p_password) < 4 then
    raise exception 'Heslo eventu musí mať aspoň 4 znaky';
  end if;

  insert into public.events (name, event_date, client_id, status, password_hash)
  values (
    trim(p_name),
    p_event_date,
    auth.uid(),
    'pending',
    extensions.crypt(p_password, extensions.gen_salt('bf'))
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

-- Majiteľ schváli alebo zamietne žiadosť.
create or replace function public.set_event_status(p_event_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_majitel() then
    raise exception 'Len majiteľ môže meniť stav eventu';
  end if;
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Neplatný stav';
  end if;

  update public.events
  set status = p_status,
      approved_by = case when p_status = 'approved' then auth.uid() else null end,
      approved_at = case when p_status = 'approved' then now() else null end
  where id = p_event_id;
end;
$$;

-- Zmena hesla eventu (Klient svojho eventu alebo Majiteľ).
create or replace function public.set_event_password(p_event_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.can_manage_event(p_event_id) then
    raise exception 'Nemáš právo meniť tento event';
  end if;
  if p_password is null or length(p_password) < 4 then
    raise exception 'Heslo eventu musí mať aspoň 4 znaky';
  end if;

  update public.events
  set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf'))
  where id = p_event_id;
end;
$$;

-- Vygenerovanie nového slug-u = zneplatnenie starého QR kódu/odkazu,
-- bez toho aby sa stratili fotky alebo kniha hostí.
create or replace function public.regenerate_event_slug(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
begin
  if not public.can_manage_event(p_event_id) then
    raise exception 'Nemáš právo meniť tento event';
  end if;

  update public.events
  set slug = gen_random_uuid()::text
  where id = p_event_id
  returning slug into v_slug;

  return v_slug;
end;
$$;

grant execute on function public.request_event(text, date, text) to authenticated;
grant execute on function public.set_event_status(uuid, text) to authenticated;
grant execute on function public.set_event_password(uuid, text) to authenticated;
grant execute on function public.regenerate_event_slug(uuid) to authenticated;
