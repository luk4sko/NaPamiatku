# NaPamiatku

SaaS webová aplikácia pre svadby a eventy — hostia zdieľajú fotografie na jednom mieste cez QR kód. Maturitný projekt (odbor Mechanik počítačových sietí).

## Stack

- Frontend: HTML5, CSS3, Vanilla JS (bez frameworku, bez build procesu)
- Backend & DB: [Supabase](https://supabase.com) (Auth, PostgreSQL, Storage)
- Knižnice z CDN: `@supabase/supabase-js`, `qrcode` (generovanie QR), `bysquare` (Pay by Square)
- Písma: Playfair Display (nadpisy) + Inter (text) z Google Fonts, s náhradou na systémové písma

## Vzhľad

Farby sú CSS premenné na `:root`; svetlý režim ich prepisuje cez `[data-theme="light"]`. **Predvolený je tmavý režim**, voľba používateľa sa pamätá v `localStorage`. Rozloženie je mobile-first, galéria je masonry cez CSS stĺpce.

## Roly

- **Majiteľ** — prevádzkovateľ (admin). Vidí a spravuje všetky eventy, môže event pozastaviť pre hostí alebo zmazať (moderovanie, nahlásený obsah), pozýva klientov.
- **Klient** — má pridelený vlastný event. Vytvorí ho, rozdá QR kód a odkaz, maže fotky a odkazy, vie odkaz zneplatniť.
- **Hosť** — bez účtu, bez prihlasovania a bez hesla. Naskenuje QR kód a rovno je vnútri. Prezývka je nepovinná — ak si žiadnu nezvolí, appka mu vygeneruje náhodnú (napr. „Veselý hosť"). Nahráva a sťahuje fotky, píše do knihy hostí, môže poslať dar.

Klient si účet zakladá sám na `register.html`. Majiteľ ho môže založiť aj ručne (pozvánkou z dashboardu) — obe cesty vedú k rovnakému výsledku, len jedna ich vytvorí sama a druhá počká na pozvánku. Nový účet dostane rolu `klient` automaticky (DB trigger). Event je aktívny hneď po vytvorení (schvaľovanie bolo zrušené 2026-09-21 — služba je zadarmo, takže brána nemala čo strážiť); ochranou pred zneužitím je overený e-mail, strop 20 aktívnych eventov na účet a možnosť majiteľa event pozastaviť.

## Stránky

| Súbor | Účel |
|---|---|
| `index.html` | Verejná úvodná (predajná) stránka |
| `register.html` | Registrácia Klienta (email → odkaz na nastavenie hesla) |
| `login.html` | Prihlásenie |
| `forgot-password.html` | Zabudnuté heslo — odoslanie odkazu na obnovu |
| `set-password.html` | Nastavenie hesla po pozvánke / po obnove |
| `dashboard.html` | Prehľad eventov s náhľadmi a počtami fotiek; Majiteľ vidí všetky eventy a spravuje účty |
| `event.html` | Správa jedného eventu — fotky (filter, výber, ZIP, živé obnovovanie), kniha hostí (tlač, export), QR kód + tlačiteľná kartička, nastavenia, dary |
| `guest.html` | Neverejná stránka pre hostí (cez `?slug=`): meno → fotky, kniha hostí, dary |
| `podmienky.html` | Obchodné podmienky, pravidlá obsahu a nahlasovanie (DSA), sprostredkovateľská doložka |
| `ochrana-osobnych-udajov.html` | Zásady ochrany osobných údajov (GDPR čl. 13) |
| `cookies.html` | Informácie o cookies a úložisku prehliadača + vyhlásenie Cookiebot |

## Databázová schéma

- `profiles` — rola používateľa (`majitel` / `klient`), vytvára sa triggerom pri registrácii
- `events` — event/projekt (`client_id`, `status`, tajný `slug`, nastavenia darov)
- `photos` — fotky priradené k eventu (prezývka autora je uložená priamo pri fotke)
- `guestbook_messages` — odkazy hostí

Plná história SQL migrácií (presne v poradí, ako boli spustené na Supabase) je v [`sql/migrations`](sql/migrations).

Hosť nemá v databáze žiadny vlastný riadok ani účet — prezývka je len text uložený pri fotke a odkaze, a v prehliadači hosťa v `localStorage`.

## Ako je to zabezpečené

Hostia nemajú účet, ale **nemajú ani priamy prístup k tabuľkám**. RLS politiky dovolia čítať a mazať dáta len Majiteľovi a Klientovi daného eventu. Hosť pracuje výhradne cez `SECURITY DEFINER` funkcie (`guest_open_event`, `guest_list_photos`, `guest_add_photo`, `guest_list_messages`, `guest_add_message`), ktoré pri **každom** volaní znova overia v databáze, že slug patrí existujúcemu a aktívnemu eventu (`find_event_by_slug`).

Vstup pre hostí stráži samotný `slug`: je to `gen_random_uuid()`, teda 122 náhodných bitov, ktoré sa nedajú uhádnuť ani vyskúšať hrubou silou, a `guest.html` má `noindex`, takže odkaz nenájdu vyhľadávače. Je to model „tajný odkaz" (ako nezverejnené video na YouTube). Keď odkaz unikne, organizátor ho zneplatní cez `regenerate_event_slug` a starý QR kód prestane fungovať. Heslá eventov boli zrušené 2026-09-22 — na akcii sa hovorili nahlas a tlačili vedľa QR kódu, takže nič nechránili, len brzdili hostí (migrácia `20260922120000_remove_event_passwords.sql`).

Ďalšie opatrenia:
- Storage bucket `photos` má limit veľkosti (100 MB, rovnaký ako `FILE_SIZE_LIMIT` storage služby) a povolené len obrázkové a video MIME typy; video väčšie ako 100 MB odmietne už prehliadač (`videoSizeError()`)
- `guest_add_photo` overuje, že cesta k súboru patrí danému eventu (nedá sa „pripojiť" cudzí súbor)
- Všetok text od hostí sa vypisuje cez `escapeHtml()` — ochrana proti XSS
- `slug` je oddelený od `id`, takže sa dá zneplatniť starý QR kód bez zrušenia eventu

## Nasadenie

- **Doména:** napamiatku.com
- **Hosting:** [Vercel](https://vercel.com) — statický web bez build kroku, stačí pripojiť GitHub repozitár a nastaviť ako Root Directory koreň projektu (žiadny framework, žiadny build command).
- **Pošta na vlastnej doméne:** [Seznam Email Profi](https://emailprofi.seznam.cz) (bezplatné pripojenie vlastnej domény) — MX záznamy nastavené u registrátora (Websupport.sk), schránka `info@napamiatku.com` slúži ako oficiálny kontakt aj ako odosielateľ pre Supabase auth emaily.

## Automatické mazanie po 12 mesiacoch

Podmienky sľubujú, že obsah eventu zmažeme 12 mesiacov od dátumu eventu a organizátora upozorníme e-mailom 14 dní vopred. Robí to [`server/retention.py`](server/retention.py), ktorý na serveri spúšťa cron raz denne (o 4:00):

- databáza rozhoduje, ktoré eventy sú na rade — funkcie `retention_events_to_warn()` a `retention_events_to_delete()` (migrácia `20260918100000_event_retention.sql`), volateľné len so `service_role` kľúčom;
- skript pošle upozornenie cez Seznam SMTP (nastavenie číta z `.env` Supabase stacku, nič nie je uložené dvakrát), zapíše `events.expiry_warning_sent_at`, a po lehote zmaže súbory cez Storage API a riadok eventu (kaskáda zmaže fotky, odkazy aj nahlásenia);
- event dostane vždy aspoň 14 dní od upozornenia, aj keby bol po lehote skôr;
- `--dry-run` len vypíše, čo by sa stalo; `--test-email adresa` pošle skúšobný e-mail.

Na server sa kopíruje ručne (`scp server/retention.py lukasko@server:/home/lukasko/servers/napamiatku-web/`), cron riadok: `0 4 * * * /usr/bin/python3 /home/lukasko/servers/napamiatku-web/retention.py >> /home/lukasko/servers/napamiatku-web/retention.log 2>&1`.

## Čo bolo treba nastaviť v Supabase dashboarde

Toto sa nedá spraviť z kódu:

1. ✅ **Authentication → URL Configuration** — Site URL `https://napamiatku.com` a Redirect URL `https://napamiatku.com/set-password`, inak by nefungovali odkazy z emailov na ostrej doméne.
2. ✅ **Authentication → Emails → SMTP Settings** — predvolený Supabase mailer posiela len pár emailov za hodinu a slúži na testovanie. Pre ostrú prevádzku vlastný SMTP cez schránku na vlastnej doméne (Seznam Email Profi):
   - Host: `smtp.seznam.cz`
   - Port: `465` (SSL/TLS)
   - Username / Sender email: `info@napamiatku.com` (pri vlastnej doméne sa ako username zadáva celá emailová adresa)
   - Password: heslo k tejto schránke (nie heslo k inému seznam.cz účtu)
3. ⏭️ **Authentication → Sign In / Providers → Email → Prevent use of leaked passwords** — kontrola hesla oproti HaveIBeenPwned je funkcia **Supabase Pro plánu**, na Free pláne je uzamknutá. Vedome sme ju vynechali. Klient si heslo zadáva priamo pri registrácii (`register.html`, `signUp`) aj pri obnove hesla, takže táto kontrola by sa reálne zišla — bez nej môže niekto použiť aj uniknuté/slabé heslo. Riziko zmierňuje to, že samotný účet bez schváleného eventu nemá k ničomu prístup (žiadne fotky, žiadne dáta klientov) — zneužitie slabého hesla znamená v najhoršom prípade falošnú žiadosť o event, nie únik dát. Pozvánka od Majiteľa (v dashboarde) naďalej ide cez `signInWithOtp` (magic link), tam sa heslo nastavuje až po overení emailu. Aktualizovaný dôvod je rozpísaný v [`poznamky-na-obhajobu.md`](poznamky-na-obhajobu.md).

## Spustenie lokálne

```bash
python -m http.server 5501
```
