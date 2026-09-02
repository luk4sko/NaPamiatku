# Poznámky na obhajobu

Priebežné poznámky k rozhodnutiam v projekte NaPamiatku — na opakovanie pred obhajobou. Dopĺňa sa po každej pracovnej session.

## 2026-08-31 — Detail eventu (`event.html`)

**1. Prečo sa vlastníctvo eventu kontroluje aj vo frontende, keď RLS je nastavené v Supabase?**

RLS politika `events_select_public` má podmienku `qual: true` — SELECT na tabuľku `events` je povolený úplne komukoľvek (aj neprihlásenému), pretože hostia bez účtu potrebujú vedieť načítať event podľa `id`/`slug`, aby mohli nahrávať fotky.

To ale znamená, že RLS samo osebe nezabráni prihlásenému používateľovi načítať si cudzí event, ak uhádne/skopíruje jeho `id`. Preto `event.html` po načítaní eventu navyše kontroluje v JS:

```js
const hasAccess = event.owner_id === currentUserId || event.client_id === currentUserId;
```

Toto je kontrola len na strane klienta (chráni zobrazenie v appke) — dáta sa dajú z API vytiahnuť aj bez nej (napr. priamym volaním Supabase API), keďže SELECT je verejný. Skutočná ochrana dát pred neautorizovaným zápisom/mazaním je v RLS (`events_update_owner_or_client`, `events_delete_owner`), tá kontrola v JS je len produktová/UX vrstva, ktorá bráni tomu, aby appka *zobrazila* cudzí event.

**2. Prečo pri mazaní fotky (`deletePhoto`) mažem najprv súbor zo Storage a až potom riadok z `photos`?**

Poradie rieši, čo sa stane keď jeden z dvoch krokov zlyhá:
- Najprv zmazať riadok v DB, potom zlyhá mazanie súboru → súbor ostane navždy "osirotený" v Storage, appka o ňom už nevie, nedá sa zmazať cez UI (tichá, neviditeľná chyba).
- Najprv zmazať súbor zo Storage, potom zlyhá mazanie riadku v DB → fotka sa v galérii ešte zobrazí, ale s rozbitým `<img>` (404) — chyba je hneď viditeľná a dá sa opraviť (skús znova zmazať).

Radšej poradie, kde prípadné zlyhanie je viditeľné, než také, čo tichým spôsobom hromadí odpad.

**3. Prečo má `events` samostatný stĺpec `slug`, keď by sa dalo použiť rovno `id`?**

- `id` = interná identita riadku, používa sa vo foreign keys (`photos.event_id`, `guestbook_messages.event_id`) a vo vlastníckej URL (`event.html?id=...`).
- `slug` = verejná identita, ktorá ide von cez QR kód hosťom.

Oddelenie umožňuje napr. neskôr "zneplatniť" starý guest link (vygenerovať nový `slug`) bez toho, aby sa zrušil samotný event alebo jeho vzťahy k fotkám/knihe hostí. Bežný vzorec — oddelenie internej DB identity od verejne zdieľanej identity (podobne ako "invite token" namiesto zdieľania interného ID).

*(Toto rozhodnutie sa neskôr vyplatilo — v `event.html` je tlačidlo „Zneplatniť odkaz", ktoré volá `regenerate_event_slug()`.)*

## 2026-08-31 (2) — Kompletná appka: roly, heslá eventov, hostia, dary

**1. Prečo hostia nepristupujú k tabuľkám priamo, ale cez `SECURITY DEFINER` funkcie?**

Pôvodne mali `events`, `photos` aj `guestbook_messages` RLS politiku s podmienkou `true` — čiže ktokoľvek s verejným anon kľúčom (ktorý je vidieť v zdrojáku stránky) mohol cez Supabase API vytiahnuť *všetky* eventy, fotky a odkazy zo všetkých podujatí naraz. To je vážna diera: stačilo otvoriť dev tools, opísať kľúč a stiahnuť si cudziu svadbu.

Riešenie: politiky s `true` sme zrušili. Teraz môžu tabuľky čítať len prihlásený Majiteľ a Klient daného eventu. Hosť (neprihlásený) nemá k tabuľkám žiadny prístup — pracuje výhradne cez funkcie ako `guest_list_photos(slug, heslo)`.

`SECURITY DEFINER` znamená, že funkcia beží s právami toho, kto ju vytvoril (vlastník databázy), nie toho, kto ju volá. Vďaka tomu funkcia *vie* čítať tabuľku, aj keď volajúci hosť nie. Zároveň si ale funkcia sama určuje podmienky — na začiatku vždy overí heslo eventu a bez správneho hesla vyhodí chybu.

Kľúčová myšlienka: **hranica bezpečnosti sa presunula z tabuľky do funkcie**. Namiesto „ktokoľvek smie čítať všetko" platí „smieš vidieť presne to, k čomu poznáš heslo".

**2. Prečo je heslo eventu uložené ako `password_hash` a nie ako obyčajný text?**

Heslo sa ukladá cez `crypt(heslo, gen_salt('bf'))` z rozšírenia `pgcrypto` — to je bcrypt hash. Overenie potom vyzerá takto:

```sql
if v_event.password_hash <> extensions.crypt(p_password, v_event.password_hash) then
```

`crypt()` vezme zadané heslo a zahashuje ho **tou istou soľou**, ktorá je uložená v hashi, a výsledky porovná. Nikdy sa teda nedešifruje uložený hash — bcrypt sa naspäť rozšifrovať ani nedá.

Prečo to tak musí byť: keby unikla databáza (záloha, chyba v prístupoch, ukradnutý prístup), pri čitateľných heslách by útočník rovno videl heslá do všetkých podujatí. Pri hashi mu to je na nič. Navyše je bcrypt zámerne **pomalý**, takže sa nedá rýchlo skúšať milióny hesiel za sekundu.

Dôležité: overovanie robí databáza, nie prehliadač. Keby si heslá porovnával JavaScript, musel by hash (alebo heslo) najprv stiahnuť do prehliadača — a tým by ho odovzdal útočníkovi.

**3. Ako sa vlastne dá platiť cez QR kód bez toho, aby appka mala prístup k banke?**

Používame **Pay by Square** — slovenský štandard pre platobné QR kódy (ten istý, čo býva na faktúrach). QR kód nie je platba; je to len **predvyplnený platobný príkaz** zakódovaný do obrázka: IBAN, suma, mena, správa pre príjemcu.

Celý sa vygeneruje v prehliadači hosťa (knižnica `bysquare`). Hosť ho naskenuje vo svojej bankovej aplikácii (Tatra banka a ďalšie ho vedia prečítať), tá mu predvyplní formulár a on platbu **potvrdí sám vo svojej banke**.

Prečo je to dobré riešenie a čo z toho vyplýva pre obhajobu: appka sa nikdy nedostane k peniazom ani k prihlasovacím údajom do banky, nepotrebuje žiadne API kľúče od banky, žiadnu licenciu platobnej inštitúcie a nemá žiadnu zodpovednosť za transakcie. Preto sme sa vedome vyhli integrácii cez bankové API — pridalo by to obrovskú zložitosť aj právnu záťaž bez akéhokoľvek prínosu.

**4. Prečo `escapeHtml()` pri každom výpise textu od hostí?**

Prezývky a odkazy v knihe hostí píšu cudzí ľudia. Keby sme ich vložili priamo cez `innerHTML`, hosť by mohol namiesto želania napísať napr. `<img src=x onerror="...">` a jeho kód by sa spustil v prehliadači každého, kto si stránku otvorí — vrátane organizátora. To je útok **XSS (Cross-Site Scripting)**; útočník by takto vedel napríklad ukradnúť prihlasovaciu session organizátora.

`escapeHtml()` nahradí znaky `< > & " '` ich HTML entitami, takže sa text zobrazí ako text a nie ako značky. Otestované — vložený `<img onerror>` sa v knihe hostí vypíše ako obyčajný text a nespustí sa.

**5. Prečo pribudla tabuľka `profiles` a nestačí `owner_id` v evente?**

`owner_id` viazal práva na konkrétny riadok — „si vlastníkom tohto eventu". Lenže Majiteľ nie je vlastníkom jedného eventu, on je správcom **celej platformy** a musí vidieť aj eventy, ktoré nevytvoril.

Rola je teda vlastnosťou *používateľa*, nie vzťahom k jednému riadku — a preto patrí do samostatnej tabuľky `profiles`. Politiky sa potom pýtajú `is_majitel()` namiesto porovnávania `owner_id`.

Prečo nie rola priamo v `auth.users`: do systémovej tabuľky Supabase sa nemá zasahovať. Štandardné riešenie je vlastná tabuľka `profiles` s `id` ako cudzím kľúčom na `auth.users(id)`, ktorú napĺňa trigger `handle_new_user()` pri vzniku účtu.

## 2026-08-31 (3) — Zjednodušenie hosťa: preč s profilmi

**Čo sa zmenilo:** hosť pôvodne mal „ľahký účet" — tabuľku `guest_profiles` s prezývkou a nepovinnou profilovkou v bucket-e `avatars`. Toto sme celé zrušili. Hosť teraz zadá len heslo eventu a je vnútri; prezývka je nepovinná a ak ju nezadá, appka mu vygeneruje náhodnú.

**1. Prečo sme mohli zahodiť celú tabuľku `guest_profiles`?**

Keď z profilu vypadla profilovka, ostala v ňom už len jedna vec — prezývka. A tú sme aj tak ukladali **denormalizovane** priamo k fotke (`photos.uploaded_by_nickname`) a k odkazu (`guestbook_messages.nickname`), aby sa dali vypísať jedným dopytom bez spájania tabuliek.

Tabuľka teda držala údaj, ktorý sme už mali inde. Samostatná tabuľka má zmysel vtedy, keď entita nesie viac vlastností alebo keď potrebuješ jednu zmenu premietnuť do všetkých záznamov naraz. Pri jedinom textovom údaji je réžia (ďalšia tabuľka, cudzie kľúče, JOIN-y, parameter navyše v každej funkcii) väčšia ako úžitok.

Otázka na obhajobu, ktorá z toho plynie: *„Nie je denormalizácia chyba?"* — Nie vždy. Tu je zámerná: prezývka pri fotke je **historický záznam** toho, kto ju nahral. Keď si hosť neskôr zmení prezývku, staré fotky si správne ponechajú pôvodné meno. Keby bola prezývka len v spoločnej tabuľke, zmena by spätne prepísala autorstvo všetkých starých fotiek — čo je horšie správanie.

**2. Prečo sa prezývka generuje náhodne a nepýtame ju povinne?**

Každý povinný krok pred vstupom stráca ľudí — na svadbe má hosť telefón v jednej ruke a pohár v druhej. Heslo eventu je nutné (bez neho by galéria bola verejná), ale prezývka nie je bezpečnostný prvok, len popisok pri fotke.

Preto: prázdna prezývka nie je chyba, ale sa nahradí náhodnou („Veselý hosť", „Šťastný sused"). Kontrola je na dvoch miestach — v prehliadači pri ukladaní, a ešte raz v databáze:

```sql
left(coalesce(nullif(trim(p_nickname), ''), 'Hosť'), 40)
```

`nullif(trim(...), '')` zmení samé medzery na NULL, `coalesce` doplní náhradu a `left(..., 40)` oreže dĺžku. Pravidlo: **kontrola v prehliadači je pre pohodlie používateľa, kontrola v databáze je tá, ktorá naozaj platí** — prehliadač sa dá obísť, databáza nie.

**3. Prečo sa profilovky museli mazať cez Storage API a nie SQL príkazom?**

Pri rušení bucket-u `avatars` odmietol Postgres príkaz `delete from storage.objects` chybou *„Direct deletion from storage tables is not allowed"*. Supabase má na tých tabuľkách ochranný trigger.

Dôvod: záznam v tabuľke `storage.objects` je len **evidencia** súboru, ktorý fyzicky leží v úložisku (S3). Keby sa dal zmazať riadok priamo SQL-kom, súbor by v úložisku ostal navždy a nikto by o ňom nevedel — presne ten „osirotený súbor" z poznámky z prvej session, len na úrovni celého systému. Storage API zmaže obe veci naraz a udrží ich v súlade.

## 2026-08-31 (4) — Vzhľad: dizajnový systém a úvodná stránka

**1. Čo je „špecificita" v CSS a prečo mi kvôli nej dvakrát nefungoval štýl?**

Keď na jeden prvok sedí viac pravidiel, ktoré nastavujú tú istú vlastnosť, prehliadač nevyberá to posledné — vyberá to **najšpecifickejšie**. Špecificita sa počíta ako trojica (id, trieda, element):

- `.avatar` → (0, 1, 0)
- `.photo img` → (0, 1, 1) ← vyhráva, lebo má navyše element

Práve na toto som narazil dvakrát:

- `.photo img { width: 100% }` prebilo `.avatar { width: 24px }` → profilovky sa roztiahli na celú šírku dlaždice.
- `.section-head p { color: var(--text-muted) }` prebilo `.eyebrow { color: var(--accent) }` → zlatý nadpisok zošedivel.

Riešenie v oboch prípadoch nebolo `!important` (to problém len zamaskuje a spraví CSS neudržateľným), ale **presnejšie zacielenie**:

- `.photo > img` — priamy potomok, teda len samotná fotka; profilovka bola vnorená hlbšie, takže ju pravidlo prestalo zasahovať.
- `.section-head p:not(.eyebrow)` — explicitne vynímame nadpisok.

Poučenie na obhajobu: keď sa štýl „neaplikuje", takmer nikdy nejde o chybu prehliadača — ide o to, že ho prebíja špecifickejší selektor. V dev tools to vidno prečiarknuté.

**2. Prečo je tmavý režim predvolený a ako sa vôbec prepína?**

Farby sú definované ako **CSS premenné** na `:root`. Prepnutie režimu nemení jednotlivé pravidlá, len prepíše hodnoty premenných:

```css
:root { --bg: #14110f; --text: #f5f0ea; }        /* tmavý = predvolený */
[data-theme="light"] { --bg: #faf7f3; --text: #1c1917; }
```

JavaScript len nastaví `data-theme="light"` na `<html>` a uloží voľbu do `localStorage`. Celá appka sa prefarbí naraz, pretože všetky komponenty používajú tie isté premenné namiesto natvrdo zapísaných farieb.

Pôvodne sa režim riadil nastavením systému (`prefers-color-scheme`). Teraz je tmavý natvrdo predvolený, lebo je to **značková voľba** — chceme, aby stránka na každom zariadení vyzerala rovnako, nie aby polovica návštevníkov videla svetlú verziu.

**3. Prečo mockup telefónu na úvodnej stránke nie je obrázok?**

Je poskladaný z obyčajných `<div>` a CSS (rámik, zaoblenie, gradientové dlaždice). Výhody oproti screenshotu: je ostrý na každom rozlíšení, automaticky sa prefarbí v tmavom aj svetlom režime, váži takmer nič a nemusím ho prekresľovať, keď sa appka zmení.

**4. Prečo `<label>` namiesto natívneho `<input type="file">`?**

Natívne pole na výber súboru sa nedá naštýlovať a v každom prehliadači vyzerá inak („Vybrať súbory / Nie je vybratý žiadny súbor"). Preto ho skryjeme (`display: none`) a obalíme do `<label class="file-button">`.

Funguje to preto, lebo kliknutie na `<label>` prehliadač automaticky presmeruje na pole, ktoré label obaľuje — čiže sa otvorí ten istý dialóg. JavaScript ostáva nezmenený, lebo pole stále existuje, len ho nevidno. Bonus: je to prístupné aj pre čítačky obrazovky.

## 2026-09-02 — Nasadenie na napamiatku.com a prečo nemáme "leaked password" ochranu

**Kontext:** Doména `napamiatku.com` (Websupport) je pripojená na Vercel hosting (A záznam `@ → 216.198.79.1`, CNAME `www → *.vercel-dns-017.com`). V Supabase sme nastavili produkčné Site URL/Redirect URL a vlastný SMTP cez `napamiatku@seznam.cz`, aby chodili emaily na pozvánky a obnovu hesla aj z ostrej domény, nielen z lokálneho vývoja.

**1. Čo je "Prevent use of leaked passwords" a prečo sme ju nezapli?**

Je to funkcia Supabase Auth, ktorá pri registrácii/zmene hesla overí zadané heslo oproti databáze **HaveIBeenPwned** — zoznamu hesiel uniknutých z iných služieb (LinkedIn, Adobe a pod.), ktoré kolujú na internete. Ak si niekto zvolí heslo, ktoré je v tomto zozname (napr. `Password123`), Supabase mu ho odmietne.

Vo Vercel/Supabase dashboarde je táto možnosť uzamknutá s textom *"Only available on Pro plan and above"* — na Free pláne, na ktorom projekt beží, sa zapnúť nedá bez platenej Supabase Pro subscription (25 $/mesiac).

**2. Pred akým útokom to chráni a prečo to u nás nie je kritické?**

Rieši to konkrétny útok: **credential stuffing**. Útočník má stiahnutý zoznam miliónov uniknutých kombinácií email:heslo z iných únikov a skúša ich hromadne na cudzej appke — sázka na to, že si niekto recykluje rovnaké heslo všade. Bez tejto funkcie appka len kontroluje dĺžku hesla (min. 6 znakov), nie či je konkrétne heslo už verejne známe.

Riziko je u nás nízke, pretože:
- **Verejná registrácia neexistuje** — účty (Majiteľ/Klient v `auth.users`) zakladá výhradne Majiteľ pozvánkou, nie je to systém s masovou registráciou, na ktorý by sa credential stuffing štatisticky oplatil.
- Počet účtov je malý a pod kontrolou.
- Heslo hosťa (vstup do galérie) je **úplne iný mechanizmus** — nie Supabase Auth heslo, ale `password_hash` v tabuľke `events`, hashovaný cez bcrypt (`pgcrypto`). Tejto funkcie by sa HaveIBeenPwned kontrola ani netýkala, tá platí len pre `auth.users`.

**Záver pre obhajobu:** je to legitímna bezpečnostná vrstva (*defense in depth* — viacero prekrývajúcich sa ochrán, nie spoliehanie sa na jednu), nie diera, ktorú by dalo priamo zneužiť. Vedeli sme o nej, je to platená funkcia Supabase Pro plánu, a vzhľadom na uzavretý okruh účtov na pozvánku sme riziko vyhodnotili ako nízke a rozhodli sa neplatiť za Pro plán — projekt beží ďalej na Free.
