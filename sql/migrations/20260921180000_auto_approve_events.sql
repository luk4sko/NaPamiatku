-- Schvaľovanie eventov bolo navrhnuté ako obchodná brána (zaplatil -> schválim).
-- Služba je zadarmo, takže každá žiadosť bola aj tak schválená - len s
-- oneskorením, kým bol prevádzkovateľ online. Od teraz je event aktívny hneď
-- po vytvorení. Stĺpec status ostáva: 'rejected' teraz znamená "pozastavený
-- prevádzkovateľom" (moderovanie obsahu, DSA), a set_event_status ho naďalej
-- smie meniť len majiteľ.

alter table public.events alter column status set default 'approved';

-- Čakajúce žiadosti z čias schvaľovania sa aktivujú.
update public.events
set status = 'approved', approved_at = now()
where status = 'pending';

-- Event vzniká rovno ako schválený. Bez schvaľovacej brány má každý overený
-- účet právo tvoriť eventy, preto pribudol strop 20 aktívnych eventov na
-- účet - hrubá ochrana pred hromadným zneužitím, bežného organizátora sa netýka.
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
  if (select count(*) from public.events where client_id = auth.uid() and status = 'approved') >= 20 then
    raise exception 'Máš už 20 aktívnych eventov. Staré eventy najprv zmaž.';
  end if;

  insert into public.events (name, event_date, client_id, status, approved_at, password_hash)
  values (
    trim(p_name),
    p_event_date,
    auth.uid(),
    'approved',
    now(),
    extensions.crypt(p_password, extensions.gen_salt('bf'))
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;
