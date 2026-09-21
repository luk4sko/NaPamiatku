-- Videá z telefónov sú 4K s 15-55 Mbit/s - cez domácu linku servera (~33 Mbit/s
-- upload) sa nedajú prehrať plynulo ani jednému divákovi a HEVC z iPhonu
-- mnohé Android telefóny nevedia prehrať vôbec. Preto ich server po nahratí
-- prekóduje na 1080p H.264 (~4 Mbit/s, 10-15x menšie) a vyrobí náhľadový
-- obrázok (poster). Robí to skript server/transcode.py z cronu; tu je len
-- stav, podľa ktorého vie, čo má na rade, a podľa ktorého galéria vie, či má
-- ukázať "Spracúva sa..." alebo hotové video.

alter table public.photos
  add column video_status text
    check (video_status in ('pending', 'ready', 'failed')),
  add column poster_path text;

comment on column public.photos.video_status is
  'Len pre media_type = video: pending = čaká na prekódovanie, ready = prekódované, failed = nepodarilo sa (ostáva originál). Fotky majú null.';
comment on column public.photos.poster_path is
  'Cesta k náhľadovému JPEG videa v buckete photos (vyrába transcode.py).';

-- Každé nové video začína ako pending - bez ohľadu na to, či ho vložil hosť
-- cez guest_add_photo alebo organizátor priamo. Trigger je istejší než
-- spoliehať sa, že na to nezabudne ani jedna z týchto ciest.
create or replace function public.photos_set_video_status()
returns trigger
language plpgsql
as $$
begin
  if new.media_type = 'video' and new.video_status is null then
    new.video_status := 'pending';
  end if;
  return new;
end;
$$;

create trigger photos_set_video_status
  before insert on public.photos
  for each row execute function public.photos_set_video_status();

-- Videá nahraté pred touto zmenou tiež prekódujeme.
update public.photos set video_status = 'pending'
where media_type = 'video' and video_status is null;

-- Index pre skript: hľadá len čakajúce videá, ktorých je zlomok tabuľky.
create index photos_video_pending_idx on public.photos (created_at)
  where video_status = 'pending';

-- Galéria hostí potrebuje stav a poster. Zmena návratového typu = drop + create.
drop function if exists public.guest_list_photos(text, text);
create function public.guest_list_photos(p_slug text, p_password text)
returns table (
  id uuid, storage_path text, nickname text, created_at timestamptz,
  media_type text, video_status text, poster_path text
)
language plpgsql stable security definer set search_path = public
as $$
declare v_event_id uuid;
begin
  v_event_id := public.find_event_by_password(p_slug, p_password);
  if v_event_id is null then raise exception 'Neplatné heslo eventu'; end if;

  return query
  select p.id, p.storage_path, coalesce(p.uploaded_by_nickname, 'Hosť'), p.created_at,
         p.media_type, p.video_status, p.poster_path
  from public.photos p
  where p.event_id = v_event_id
  order by p.created_at desc;
end;
$$;

grant execute on function public.guest_list_photos(text, text) to anon, authenticated;
