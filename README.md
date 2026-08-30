# NaPamiatku

SaaS webová aplikácia pre svadby a eventy — hostia zdieľajú fotografie na jednom mieste cez QR kód. Maturitný projekt (odbor Mechanik počítačových sietí).

## Stack

- Frontend: HTML5, CSS3, Vanilla JS
- Backend & DB: [Supabase](https://supabase.com) (Auth, PostgreSQL, Storage)

## Roly

- **Vlastník** — vytvára projekty (eventy), má všetky práva
- **Klient** — priradený k jednému projektu, môže mazať fotky
- **Hosť** — bez účtu, zadá prezývku, nahráva/sťahuje fotky a píše do knihy hostí

## Databázová schéma

- `events` — jeden event/projekt (owner, voliteľný client, verejný `slug` pre QR link)
- `photos` — fotky priradené k eventu
- `guestbook_messages` — odkazy hostí

Prístup hostí (bez účtu) je riadený cez Row Level Security a netušiteľný `slug`/`id` eventu.
