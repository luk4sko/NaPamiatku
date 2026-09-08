-- guest_add_photo smie volať ktokoľvek (rola anon), kto pozná heslo eventu.
-- Preto sa na jej parametre treba pozerať ako na vstup od cudzieho človeka.
--
-- Doteraz overovala len to, že cesta ZAČÍNA na event_id - zvyšok reťazca mohol
-- byť čokoľvek. Kto pozná heslo eventu, mohol funkciu zavolať priamo (mimo
-- našej stránky) a uložiť si cestu s HTML znakmi, napríklad:
--     <event_id>/x.jpg" onerror="ukradniÚdaje()
-- Galéria túto cestu vkladá do atribútu <img src="...">, takže by sa cudzí
-- kód spustil v prehliadači ostatných hostí aj organizátora (útok XSS).
--
-- Teraz musí cesta presne zodpovedať tvaru, ktorý appka naozaj vytvára:
--     <event_id>/<uuid>.<povolená prípona>
-- Čokoľvek iné funkcia odmietne. Overenie je aj v prehliadači, ale tam je len
-- pre pohodlie - skutočná kontrola musí byť na strane servera, lebo prehliadač
-- si útočník obísť vie, databázu nie.
create or replace function public.guest_add_photo(
  p_slug text, p_password text, p_nickname text, p_storage_path text, p_media_type text default 'photo'
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_event_id uuid;
  v_photo_id uuid;
begin
  v_event_id := public.find_event_by_password(p_slug, p_password);
  if v_event_id is null then raise exception 'Neplatné heslo eventu'; end if;

  if p_storage_path is null or p_storage_path !~ (
    '^' || v_event_id::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|mp4|mov|webm)$'
  ) then
    raise exception 'Neplatná cesta k súboru';
  end if;

  insert into public.photos (event_id, storage_path, uploaded_by_nickname, media_type)
  values (
    v_event_id,
    p_storage_path,
    left(coalesce(nullif(trim(p_nickname), ''), 'Hosť'), 40),
    case when p_media_type = 'video' then 'video' else 'photo' end
  )
  returning id into v_photo_id;

  return v_photo_id;
end;
$$;

grant execute on function public.guest_add_photo(text, text, text, text, text) to anon, authenticated;
