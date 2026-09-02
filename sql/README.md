# Databázová schéma

`migrations/` obsahuje presnú históriu SQL migrácií tak, ako boli spustené na
Supabase projekte NaPamiatku (`iaaaeplkexaqzjrfdzwc`), v poradí podľa časovej
značky v názve súboru. Spustením všetkých za sebou na prázdnej Postgres
databáze s rozšíreniami Supabase (`auth`, `storage`) vznikne rovnaká schéma:
tabuľky `profiles`, `events`, `photos`, `guestbook_messages`, RLS politiky,
`SECURITY DEFINER` funkcie pre hostí (`guest_open_event`, `guest_list_photos`,
`guest_add_photo`, `guest_list_messages`, `guest_add_message`) a funkcie pre
žiadosti o event (`request_event`, `set_event_status`, `set_event_password`,
`regenerate_event_slug`).

Bezpečnostný model a dôvody jednotlivých rozhodnutí sú vysvetlené v
[`poznamky-na-obhajobu.md`](../poznamky-na-obhajobu.md) a zhrnuté v hlavnom
[`README.md`](../README.md).
