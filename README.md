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

- **Majiteľ** — prevádzkovateľ. Vytvára účty klientom, schvaľuje žiadosti o eventy, vidí a spravuje všetko.
- **Klient** — má pridelený vlastný event. Požiada oň, nastaví mu heslo pre hostí, mazať fotky a odkazy.
- **Hosť** — bez účtu a bez prihlasovania. Naskenuje QR kód, zadá heslo eventu a rovno je vnútri. Prezývka je nepovinná — ak si žiadnu nezvolí, appka mu vygeneruje náhodnú (napr. „Veselý hosť"). Nahráva a sťahuje fotky, píše do knihy hostí, môže poslať dar.

Verejná registrácia neexistuje — účty zakladá výhradne Majiteľ.

## Stránky

| Súbor | Účel |
|---|---|
| `index.html` | Verejná úvodná (predajná) stránka |
| `login.html` | Prihlásenie + obnova hesla |
| `set-password.html` | Nastavenie hesla po pozvánke / po obnove |
| `dashboard.html` | Podľa role: schvaľovanie a správa účtov (Majiteľ) / žiadosť o event (Klient) |
| `event.html` | Správa jedného eventu — fotky, kniha hostí, QR kód, nastavenia, dary |
| `guest.html` | Verejná stránka pre hostí (cez `?slug=`) |

## Databázová schéma

- `profiles` — rola používateľa (`majitel` / `klient`), vytvára sa triggerom pri registrácii
- `events` — event/projekt (`client_id`, `status`, `password_hash`, verejný `slug`, nastavenia darov)
- `photos` — fotky priradené k eventu (prezývka autora je uložená priamo pri fotke)
- `guestbook_messages` — odkazy hostí

Hosť nemá v databáze žiadny vlastný riadok ani účet — prezývka je len text uložený pri fotke a odkaze, a v prehliadači hosťa v `localStorage`.

## Ako je to zabezpečené

Hostia nemajú účet, ale **nemajú ani priamy prístup k tabuľkám**. RLS politiky dovolia čítať a mazať dáta len Majiteľovi a Klientovi daného eventu. Hosť pracuje výhradne cez `SECURITY DEFINER` funkcie (`guest_open_event`, `guest_list_photos`, `guest_add_photo`, `guest_list_messages`, `guest_add_message`), ktoré pri **každom** volaní znova overia heslo eventu v databáze.

Heslo eventu je uložené ako bcrypt hash (`pgcrypto`), nikdy v čitateľnej podobe. Overuje ho databáza, nie prehliadač.

Ďalšie opatrenia:
- Storage bucket `photos` má limit veľkosti (10 MB) a povolené len obrázkové MIME typy
- `guest_add_photo` overuje, že cesta k súboru patrí danému eventu (nedá sa „pripojiť" cudzí súbor)
- Všetok text od hostí sa vypisuje cez `escapeHtml()` — ochrana proti XSS
- `slug` je oddelený od `id`, takže sa dá zneplatniť starý QR kód bez zrušenia eventu

## Čo treba nastaviť v Supabase dashboarde

Toto sa nedá spraviť z kódu:

1. **Authentication → URL Configuration** — pridať Site URL a Redirect URLs (`https://<domena>/set-password.html`), inak nebudú fungovať odkazy z emailov na ostrej doméne.
2. **Authentication → SMTP** — predvolený Supabase mailer posiela len pár emailov za hodinu a slúži na testovanie. Pre ostrú prevádzku treba nastaviť vlastný SMTP (firemný mail).
3. **Authentication → Password protection** — zapnúť kontrolu uniknutých hesiel (HaveIBeenPwned).

## Spustenie lokálne

```bash
python -m http.server 5501
```
