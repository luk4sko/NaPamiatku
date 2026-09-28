-- Politika profiles_update_self (z 20260831181255_add_profiles_and_roles.sql)
-- kontroluje len to, či si používateľ upravuje svoj vlastný riadok
-- (id = auth.uid()), nie ktoré stĺpce mení. Klient tak vedel cez bežné
-- API volanie (supabase.from('profiles').update({role:'majitel'})...)
-- sám sebe zmeniť rolu na majiteľa.
--
-- Rieši sa to triggerom: pri UPDATE na profiles, ak sa mení stĺpec role
-- a požiadavka prišla od prihláseného používateľa (auth.uid() nie je null),
-- ktorý sám nie je majiteľ, zmena sa zamietne. Priame zásahy cez psql
-- (napr. ručné nastavenie prvého majiteľa) nemajú v session žiadny JWT,
-- takže auth.uid() je null a trigger ich nechá prejsť.

create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_majitel() then
    raise exception 'Rolu môže zmeniť len majiteľ.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_self_role_change on public.profiles;
create trigger profiles_prevent_self_role_change
  before update on public.profiles
  for each row execute function public.prevent_self_role_change();
