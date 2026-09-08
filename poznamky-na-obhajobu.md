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

## 2026-09-03 — Samoregistrácia klienta a oprava firemného emailu

**Kontext:** Pôvodne účty zakladal výhradne Majiteľ pozvánkou (pozri poznámku vyššie o "verejná registrácia neexistuje" — to už neplatí). Zadanie: Klient si má vedieť sám vytvoriť účet a požiadať o event, ktorý Majiteľ schváli. Cestou sa vyriešil aj samostatný problém — rozbité odosielanie emailov v Supabase — a napojila sa vlastná emailová schránka `info@napamiatku.com` cez Seznam Email Profi.

**1. Prečo registrácia (`register.html`) nepoužíva bežný formulár s heslom, ale `signInWithOtp`?**

Je to presne ten istý mechanizmus, aký už predtým používala pozvánka od Majiteľa v dashboarde — pošle sa magic link na email, heslo sa nastavuje až po kliknutí naň na `set-password.html`. Dôvody:
- **Žiadny nový kód na údržbu** — jeden osvedčený spôsob autentifikácie namiesto dvoch.
- **Heslo sa nikdy nezadáva pred overením emailu.** Pri klasickom `signUp(email, password)` niekto zadá heslo do formulára skôr, než sa čo i len overí, že email vlastní. Pri OTP flow je poradie opačné: over email → až potom nastav heslo. To zároveň znamená, že sa nedá poslať slabé/uniknuté heslo "naslepo" pri registrácii.

**2. Prečo je rola `klient` nastavená automaticky (DB trigger `handle_new_user`, `profiles.role default 'klient'`) a nie je to diera?**

Lebo **samotný účet bez schváleného eventu nemá k ničomu prístup**. RLS politiky na `events`, `photos`, `guestbook_messages` sú viazané na `client_id = auth.uid()` **a** `status = 'approved'` (schvaľuje ho `set_event_status`, ktoré smie volať len Majiteľ — `is_majitel()`). Zaregistrovať sa teda znamená len "môžem požiadať o event", nie "vidím dáta". Schvaľovanie zostáva jediným miestom, kde Majiteľ kontroluje prístup.

**3. Prečo Claude nesmel zadať heslo (k emailovej schránke, k Websupport DNS) ani kliknúť "vytvoriť účet", hoci som ho na to vyzval a dal mu heslo?**

Toto je **pevné pravidlo, nezávislé od povolenia používateľa** — vytváranie účtov a zadávanie hesiel/prihlasovacích údajov do formulárov je vždy zakázané, aj keď to používateľ výslovne povolí alebo poskytne heslo. Zmysel: citlivé prihlasovacie údaje (k emailu, k DNS správcovi domény, ...) by nemali nikdy prechádzať cez AI nástroj, ani keď je to pohodlnejšie. Prakticky to znamenalo: Claude pripravil presné kroky/hodnoty a dostal sa na správnu stránku vo formulári, ale kliknutie "Uložiť"/napísanie hesla musel urobiť vždy človek.

**Vedľajšie zistenie:** SMTP posielanie (autentifikácia cez `smtp.seznam.cz`) je nezávislé od DNS/MX záznamov — MX riadi len *doručovanie prichádzajúcej* pošty na doménu, kým SMTP reší *odosielanie* cez existujúcu schránku. Dá sa to pomýliť, lebo obe súvisia s "poštou na doméne", ale ide o dva odlišné mechanizmy s odlišnou zodpovednosťou.

## 2026-09-05 — Registrácia s heslom namiesto magic linku

**Kontext:** `register.html` doteraz posielal len magic link (`signInWithOtp`) — heslo sa nastavovalo až po kliknutí naň, na `set-password.html`. Zadanie: klient má heslo zadať rovno pri registrácii, žiadny extra krok cez email. Zároveň zmizol odkaz `Prihlásenie pre organizátorov` z pätičky `index.html` a hlavná ponuka na úvodnej stránke sa zmenila z "napíšte nám" na "založte si účet".

**1. Čo presne sa zmenilo v kóde a čo sa nezmenilo?**

Zmenilo sa len volanie na `register.html`: namiesto `supabaseClient.auth.signInWithOtp(...)` je tam teraz `supabaseClient.auth.signUp({ email, password })`, plus druhé pole na potvrdenie hesla (kontrola zhody v JS pred odoslaním). **Databáza sa meniť nemusela** — trigger `handle_new_user` (pozri `sql/migrations/20260831181255_...`) beží `after insert on auth.users`, teda pri *akomkoľvek* spôsobe založenia účtu, nielen pri OTP. Pozvánka od Majiteľa v dashboarde (`inviteForm`) naďalej používa `signInWithOtp` — tam to zmyslel dáva, lebo Majiteľ nepozná heslo, ktoré by klient chcel, takže si ho klient beztak musí nastaviť sám cez odkaz.

**2. Prečo to nezvyšuje riziko, že niekto získa prístup k cudzím dátam bez schválenia?**

Lebo brána k dátam bola vždy **schválenie eventu** (`set_event_status`, len `is_majitel()`), nie samotné založenie účtu — to platilo aj pred touto zmenou (pozri poznámku z 2026-09-03 vyššie). Zjednodušenie registrácie mení len *pohodlie* založenia účtu, nie *rozsah* toho, čo účet vidí. Novým účtom bez schváleného eventu RLS politiky na `events`/`photos`/`guestbook_messages` stále nedovolia nič.

**3. Prečo sme museli prepísať zdôvodnenie v README bod 3 (vynechanie "Prevent use of leaked passwords")?**

Pôvodné zdôvodnenie znelo: *"heslo sa nikdy nezadáva do formulára pred overením emailu, lebo ideme cez magic link"* — to bola pravda, kým `register.html` používal OTP. Teraz to heslo **priamo do formulára ide**, takže pôvodný argument by bol nepravdivý, keby sme ho nechali bez úpravy. Toto je dôležité pre obhajobu: nestačí raz niečo zdokumentovať ako bezpečné, treba si všímať, keď zmena kódu podkope dôvod, prečo bolo niečo predtým vyhodnotené ako v poriadku. Aktuálne zdôvodnenie stojí na inom argumente — že samotný účet bez schváleného eventu nemá k ničomu prístup (bod 2 vyššie), takže zneužitie slabého/uniknutého hesla klienta má v najhoršom prípade dosah len na jeho vlastnú (ne)schválenú žiadosť, nie na cudzie dáta.

**4. Prečo pri `signUp` na email, ktorý už je zaregistrovaný, Supabase nevráti chybu, a ako to teda odhalíme?**

Keby Supabase pri duplicitnom emaili vrátilo jasnú chybu typu "tento email už existuje", útočník by mohol skúšať náhodné emaily a podľa chybovej hlášky zisťovať, ktoré z nich sú u nás zaregistrované (tzv. *user enumeration* — samo osebe to nie je prienik, ale uľahčuje ďalší útok, napr. cielený phishing alebo skúšanie uniknutých hesiel práve na tie emaily, o ktorých už vie, že majú účet). Preto Supabase v tomto prípade vráti úspech bez chyby, ale vo vrátenom `user.identities` je prázdne pole — podľa toho v `register.html` rozoznáme duplicitu a ukážeme používateľovi vlastnú správu ("tento email je už zaregistrovaný, prihlás sa").

## 2026-09-05 — Redesign celého webu, WebP fotky a dve opravené animácie

**Kontext:** Úvodná stránka pôsobila "sucho" — prázdne rohy na PC, farebné dlaždice namiesto fotiek, žiadne animácie. Zadanie bolo dotvoriť to vizuálne aj obsahovo a rozšíriť rovnaký štýl na celý web (login, register, dashboard, event, guest), nech appka nepôsobí ako jedna pekná stránka a k nej pripojená iná appka. Popri tom sa opravili dve reálne chyby v správaní tlačidiel.

**1. Prečo fotky nie sú stiahnuté z Pinterestu, keď to bola pôvodná požiadavka?**

Fotky na Pinterest sú takmer vždy cudzie autorské dielo (fotograf/pár si ich tam niekto len uložil, nevlastní k nim práva) — použiť ich na komerčnej stránke bez licencie je porušenie autorského práva. Namiesto toho sa použil **Unsplash**, ktorého licencia výslovne dovoľuje aj komerčné použitie bez nutnosti uvádzať autora. Toto je presne typ otázky, ktorá na obhajobe padne ("odkiaľ máte fotky a smiete ich takto použiť?") a vedieť vysvetliť rozdiel medzi "voľne dostupné na internete" a "mám na to licenciu" je dôležité.

**2. Prečo sú fotky v `img/` v troch veľkostiach (`-sm`, `-lg`, `-xl`) namiesto jednej v plnom rozlíšení?**

Každá fotka sa stiahne v takej veľkosti, na akú sa naozaj používa — malé náhľady v telefóne a v posuvnom páse (`-sm`, 400 px), stredné v galérii (`-lg`, 900 px), veľké len pre pozadie na celú šírku obrazovky (`-xl`, 1400 px). Keby sa všade použil jeden súbor v plnom rozlíšení, mobil by pri načítaní hero sekcie musel stiahnuť niekoľko MB namiesto nameraných ~317 KB. Spolu s `loading="lazy"` (fotky mimo obrazovky sa sťahujú až keď na ne používateľ doscrolluje) je to hlavný dôvod, prečo stránka s desiatkami fotiek nie je pomalá.

**3. Prečo WebP nakoniec nevyšiel podstatne menší, hoci to je bežné tvrdenie o tomto formáte?**

Pri rovnakom čísle kvality (`q=72`) vyšiel WebP dokonca *väčší* než pôvodný JPEG (1 356 vs 1 315 KB pre celú sadu) — číslo kvality neznamená naprieč formátmi to isté, a Unsplašova JPEG kompresia bola už dobre vyladená. Až zníženie na `q=50` prinieslo reálnu úsporu (968 KB, −26 %), a kvalita sa pri tom vizuálne neodlíšila ani pri dvojnásobnom priblížení najťažšieho prípadu (hladká obloha, kde sa artefakty kompresie prejavia najskôr). Poučenie: tvrdenia o formátoch treba pred nasadením odmerať na skutočných dátach, nie brať ako všeobecnú pravdu — prvý odhad ("WebP bude o polovicu menší") bol nesprávny a ukázalo sa to až meraním.

**4. Prečo sa ikonka oka pri hesle niekedy "nesprávala" a čo presne bola oprava?**

Pôvodne to bolo emoji 👁 / 🙈 (druhé je opica zakrývajúca si oči, nie preškrtnuté oko) — to samo osebe nezodpovedalo zámeru a naviac sa emoji na rôznych systémoch/fontoch vykresľujú nespoľahlivo. Skutočná príčina "hopkania" pri kliknutí ale bola v CSS: ikonka bola vycentrovaná cez `transform: translateY(-50%)`, ale spoločné pravidlo `button:active { transform: translateY(1px); }` (dopadový efekt pri kliknutí na *akékoľvek* tlačidlo v appke) sa pri kliknutí aplikovalo tiež. **`transform` sa neskladá** — druhá hodnota prvú úplne prepíše, nespoja sa — takže namiesto "vycentrované a o 1px nižšie" sa ikonka na okamih ocitla úplne mimo stred.

Prvá oprava (nahradenie emoji vlastným SVG + `.password-toggle:active` prepisujúce transform späť na `translateY(-50%)`) riešila len prejav na jednom mieste. Až druhá oprava išla ku koreňu: `button:active { transform: translateY(1px); }` bolo totiž pravidlo pre *všetky* tlačidlá na stránke, takže rovnaké "hopkanie" sa dalo cítiť pri kliknutí kdekoľvek, nielen na oku. Namiesto ďalšej výnimky sa celé pravidlo zmazalo. Overené meraním polohy tlačidla (`getBoundingClientRect().top`) pred, počas a po kliknutí — hodnota sa nezmenila ani o pixel.

**Poučenie pre obhajobu:** keď niečo "niekedy nefunguje" alebo sa správa nekonzistentne, oplatí sa najprv nájsť *mechanizmus* (tu: konflikt dvoch CSS pravidiel na `transform`), nie len opraviť to, čo je vidno na jednom mieste — inak sa rovnaký problém objaví inde nabudúce.

## 2026-09-05 (3) — Prvý majiteľský účet a oprava SPF/DKIM/DMARC (Gmail dával mail do spamu)

**Kontext:** Po vymazaní všetkých testovacích účtov bolo treba znovu založiť prvý účet s rolou `majitel`. Popri tom sa zistilo, že registračné/pozvánkové emaily (posielané cez vlastný SMTP `smtp.seznam.cz`, schránka `info@napamiatku.com`) chodia do spamu v Gmaile s varovaním "tento mail môže byť nebezpečný".

**1. Prečo sa prvý majiteľský účet nedal vytvoriť len cez appku?**

`profiles.role` má default `'klient'` (`sql/migrations/20260831181255_add_profiles_and_roles.sql`) a rolu smie meniť len niekto, kto už `majitel` je (`profiles_update_majitel`, `is_majitel()`). Je to typický problém typu "kto ustanoví prvého správcu, keď správcovská rola je nutná na ustanovenie správcu" — appka to riešiť nemôže, lebo v nej niet nikoho, kto by mal právo niekoho iného povýšiť. Riešenie je jednorazový ručný zásah priamo v databáze: zaregistrovať sa normálne (vznikne `klient`) a potom cez SQL (`update public.profiles set role = 'majitel' where email = '...'`) tento jeden riadok ručne prepnúť. Toto sa robí len raz, pri úplne prázdnej databáze — bežné povyšovanie klientov na majiteľa appka nerieši (a ani nemá prečo, keďže `majitel` je v tomto projekte len jeden — správca celej platformy, nie rola na bežné pridávanie).

**2. Čo presne bolo v DNS zle a prečo to Gmail označoval ako nebezpečný spam?**

Doména `napamiatku.com` mala nastavený SPF záznam, ktorý autorizoval len servery Websupportu (`include:_spf.m1.websupport.sk`), ale appka posiela poštu cez servery Seznamu (`smtp.seznam.cz`) — tie v SPF zázname vôbec neboli. DKIM podpis nebol nastavený vôbec (žiadny `_domainkey` záznam). DMARC pritom mal politiku `p=quarantine` ("ak SPF aj DKIM zlyhajú, daj mail do karantény"). Keďže SPF zlyhávalo (Seznam nebol autorizovaný odosielateľ) a DKIM chýbal úplne, DMARC presne toto urobil — a Gmail karanténu zobrazuje ako spam s varovaním.

**3. Ako presne funguje SPF + DKIM + DMARC dohromady?**

- **SPF** (Sender Policy Framework) — TXT záznam na doméne hovorí "tieto IP/servery smú posielať poštu, ktorá sa tvári, že je odo mňa". Prijímajúci server si to overí porovnaním s tým, odkiaľ mail reálne prišiel.
- **DKIM** (DomainKeys Identified Mail) — mail sa podpíše súkromným kľúčom na strane odosielateľa; verejný kľúč na overenie podpisu je zverejnený v DNS (`_domainkey` záznam). Overuje sa tým, že mail cestou nebol pozmenený a naozaj prišiel od vlastníka domény.
- **DMARC** — hovorí, čo urobiť, keď SPF aj DKIM zlyhajú (nič/`none`, spam/`quarantine`, zahodiť/`reject`), a komu poslať report o zlyhaniach.

Oprava: pridaný `include:spf.seznam.cz` do SPF a tri CNAME záznamy (`szn1/szn2/szn3._domainkey.napamiatku.com` → zodpovedajúce `*.seznam.cz`), ktoré zapnú DKIM podpis priamo pod menom `napamiatku.com` (dovtedy by sa bez nich mail podpisoval len ako `emailprofi.seznam.cz`, čo nie je zarovnané s `From: info@napamiatku.com`, a DMARC by aj tak zlyhal). Presné hodnoty pochádzajú priamo z oficiálnej Seznam dokumentácie pre domény "len pripojené do Email Profi" (DNS spravované mimo Seznamu, čo je presne tento prípad — MX beží na Seznam, ale DNS zóna je vo Websupporte).

**4. Prečo som ja (Claude) nemohol DNS zmeny sám dokončiť, hoci ma na to používateľ vyzval?**

Rovnaké pravidlo ako pri predošlom pripojení domény ([poznámka vyššie](poznamky-na-obhajobu.md): "Prečo Claude nesmel zadať heslo... hoci ma na to používateľ vyzval") — zadávanie hesiel a definitívne uloženie zmien v cudzích administráciách (Websupport, Email Profi) musí vždy spraviť človek, bez ohľadu na to, že to používateľ výslovne dovolí. Prakticky: pripravil som presné DNS hodnoty overené priamo z oficiálnej dokumentácie, dostal som sa v prehliadači na správnu obrazovku formulára, ale samotné vpísanie hodnoty a kliknutie "Uložiť zmeny" spravil používateľ. Po uložení som cez DNS lookup (`Resolve-DnsName`) overil, že sa zmeny naozaj prejavili tak, ako mali.

## 2026-09-07 — Lightbox, videá v galérii a chýbajúca RLS politika

V tento deň pribudlo zobrazenie fotky na celú obrazovku (lightbox) s prepínaním a priblížením, podpora videí v galérii a opravila sa chyba, pre ktorú organizátor nemohol nahrávať fotky. Poznámky sa vtedy nestihli zapísať, dopĺňam ich spätne 8. 9. 2026.

**1. Prečo organizátorovi nefungovalo nahrávanie fotiek, keď hosťom fungovalo?**

Sú to dve úplne odlišné cesty zápisu do tabuľky `photos` a sprísnenie RLS politík (`20260831181331_tighten_rls_policies.sql`) zrušilo starú voľnú politiku `photos_insert_public`, ale novú pridalo len pre niektoré prípady.

- **Hosť** nahráva cez funkciu `guest_add_photo`, ktorá je `security definer`. To znamená, že sa vykonáva s právami toho, kto ju vytvoril (vlastníka databázy), nie s právami toho, kto ju zavolal. RLS politiky na tabuľke `photos` sa na ňu preto vôbec nevzťahujú — funkcia si zapíše riadok sama a bezpečnosť rieši tým, že si najprv overí heslo eventu.
- **Organizátor** je prihlásený používateľ a v `event.html` vkladá riadok priamo: `supabaseClient.from("photos").insert(...)`. Tento zápis ide cez REST API pod rolou `authenticated`, takže RLS naň platí naplno. A keďže preň neexistovala žiadna `insert` politika, PostgreSQL ho zamietol — RLS totiž funguje na princípe „čo nie je výslovne povolené, je zakázané".

Oprava bola jedna politika (`20260907120000_add_photos_insert_manager_policy.sql`):

```sql
create policy photos_insert_manager on public.photos
  for insert to authenticated
  with check (public.can_manage_event(event_id));
```

`with check` je pri `insert` obdoba `using` pri `select` — kontroluje riadok, ktorý sa práve zapisuje. Podmienka hovorí: smieš vložiť fotku len do eventu, ktorý smieš spravovať.

**Poučenie na obhajobu:** keď sa sprísňujú RLS politiky, treba prejsť *všetky* cesty, ktorými sa do tabuľky zapisuje — nielen tú, ktorú má človek práve pred očami. Chyba sa neprejavila hneď, lebo hosťovská cesta (tá, ktorá sa testovala) šla cez `security definer` funkciu a fungovala ďalej.

**2. Prečo je lightbox jeden jediný prvok v DOM a nie jeden pre každú fotku?**

Funkcia `ensureLightbox()` v `js/app.js` vytvorí prvok len raz a pri každom ďalšom otvorení ho znovu použije (preto tá podmienka `if (lightboxEl) return lightboxEl;`). Keby sa vyrábal pre každú fotku zvlášť, tak pri galérii so 150 fotkami by v stránke bolo 150 skrytých kópií toho istého — zbytočná pamäť a 150 sád listenerov na klávesnicu.

Ktorá fotka je práve zobrazená, si držíme v dvoch premenných: `lightboxItems` (pole všetkých fotiek galérie) a `lightboxIndex` (poradie tej otvorenej). Zoznam si kopírujeme do poľa vopred vo `setupGalleryLightbox()` a nečítame ho pri každom prepnutí z DOM — galéria sa totiž po každom nahraní alebo zmazaní celá prekresľuje (`gallery.innerHTML = ""`), takže staré `<img>` uzly prestanú existovať a odkazy na ne by boli neplatné.

Prepínanie dokola rieši zvyškové delenie (modulo):

```js
lightboxIndex = (lightboxIndex - 1 + lightboxItems.length) % lightboxItems.length;
```

To `+ lightboxItems.length` tam nie je navyše. V JavaScripte `-1 % 5` nevráti `4`, ale `-1` (na rozdiel napríklad od Pythonu), a záporný index by v poli nič nenašiel. Pripočítaním dĺžky sa číslo najprv dostane do kladných hodnôt a až potom sa zvyškovo delí. Pri poslednej fotke to isté v druhom smere: `(4 + 1) % 5` je `0`, čiže skok na začiatok.

**3. Prečo sa video pred nahraním nezmenšuje, keď fotky áno?**

Fotku zmenšuje `compressImage()` tak, že ju nakreslí do prvku `<canvas>` v menšej veľkosti a ten vyexportuje ako JPEG. Pre jeden obrázok je to jeden priechod a trvá to zlomok sekundy.

Video je ale postupnosť obrázkov — pri 30 snímkach za sekundu má minútové video 1 800 samostatných obrázkov. Prekódovať ho v prehliadači by znamenalo každý snímok dekódovať, zmenšiť a znovu zakódovať (cez `MediaRecorder` alebo `WebCodecs`). Na mobile by to trvalo minúty, vyčerpávalo batériu a hosť by medzitým nemohol appku poriadne používať. Na svadbe, kde chce človek rýchlo hodiť video a vrátiť sa k zábave, je to neprijateľné.

Preto sa video nahráva tak, ako je, a namiesto toho sa zdvihol limit priamo na úložisku (`20260907130000_add_video_support.sql`): z 10 MB na 100 MB a k povoleným typom pribudli `video/mp4`, `video/quicktime` (iPhone) a `video/webm`.

**Dôležité na obhajobu:** ten limit je nastavený na strane servera, na samotnom buckete — nie v JavaScripte. Keby bol len v prehliadači, dal by sa obísť (stačí zavolať Storage API priamo) a ktokoľvek by mohol zaplniť úložisko obrovským súborom. Kontrola v prehliadači je pre pohodlie používateľa, kontrola na serveri je tá, ktorá naozaj platí.

**4. Načo je v databáze stĺpec `media_type`, keď typ súboru sa dá spoznať podľa prípony?**

Galéria musí pri každom zázname vedieť, či má vykresliť `<img>` alebo `<video>` — sú to iné HTML značky a video potrebuje `controls`, aby sa dalo prehrať. Dalo by sa to hádať z prípony v `storage_path`, ale to by znamenalo, že sa logika appky opiera o text v ceste k súboru. Stačilo by pridať podporu ďalšieho formátu a museli by sme na to nezabudnúť na každom mieste, kde sa galéria vykresľuje (a tie sú dve — `event.html` aj `guest.html`).

Samostatný stĺpec s obmedzením `check (media_type in ('photo', 'video'))` je jednoznačný: databáza sama nepustí dnu inú hodnotu a appka sa len spýta, čo to je.

Videá sa zámerne neotvárajú v lightboxe. Prehrávač `<video controls>` má vlastné tlačidlo na celú obrazovku a vlastné ovládanie prehrávania — lightbox s priblížením a swipovaním by mu do toho len zasahoval. Preto `setupGalleryLightbox()` vyberá selektorom `.photo > img` výslovne len obrázky.

## 2026-09-08 — Bezpečnostná diera v ceste k súboru, kvalita fotiek a čo hlási Supabase advisor

Kontrola celého projektu po pridaní videí. Našla sa jedna skutočná bezpečnostná chyba (XSS), tri rozmazané fotky a jedna drobná chyba v zobrazení prázdnej galérie.

**1. Kde bola bezpečnostná diera a prečo nestačilo opraviť ju v JavaScripte?**

Funkcia `guest_add_photo` overovala cestu k súboru takto:

```sql
if p_storage_path not like v_event_id::text || '/%' then
```

Čiže kontrolovala len to, že cesta **začína** na id eventu. Zvyšok reťazca mohol byť čokoľvek. Táto funkcia je pritom verejná — volať ju smie rola `anon`, teda ktokoľvek, kto pozná heslo eventu a adresu Supabase projektu.

Útok vyzeral takto: hosť (alebo ktokoľvek, komu sa dostane heslo eventu) nezadá cestu cez našu stránku, ale zavolá RPC priamo — z konzoly prehliadača alebo cez `curl` — a pošle cestu:

```
<id-eventu>/nieco.jpg" onerror="ukradniÚdaje()
```

Prefix sedí, kontrola prejde a riadok sa zapíše. Galéria potom túto cestu vloží do HTML:

```js
`<img src="${url}" ...>`
```

Úvodzovka v ceste predčasne ukončí atribút `src` a zvyšok sa stane novým atribútom `onerror`, ktorý prehliadač spustí ako JavaScript. To je útok **XSS (Cross-Site Scripting)** — cudzí kód beží v prehliadači ostatných hostí aj organizátora, pod ich prihlásením.

Prečo nestačí oprava v JavaScripte: **frontend nie je bezpečnostná hranica.** Všetko, čo beží v prehliadači, má útočník plne pod kontrolou — vie si to prepísať, vypnúť alebo úplne obísť a hovoriť so serverom priamo. Skutočná kontrola musí byť tam, kam sa nedostane, čiže v databáze.

Oprava má tri vrstvy (`20260908120000_harden_guest_photo_path.sql` a `js/app.js`):

1. **Databáza** vyžaduje presný tvar cesty, nie len prefix: `<event_id>/<uuid>.<jpg|mp4|mov|webm>`. Toto je tá kontrola, na ktorej stojí bezpečnosť.
2. **Prípona pri nahrávaní** sa berie z whitelistu (`videoExtension()` v `app.js`). Prípona pochádza z názvu súboru, ktorý si zvolil používateľ, takže jej nemožno veriť. Whitelist (povolím len to, čo poznám) je bezpečnejší ako blacklist (zakážem to, čo mi napadne) — pri blackliste treba dopredu uhádnuť všetky škodlivé možnosti a na jednu sa vždy zabudne.
3. **Escapovanie pri vykresľovaní** — `escapeHtml(publicUrl(...))`. Aj keby sa do databázy niekedy dostala zlá hodnota inou cestou, do HTML sa už nedostane ako kód.

Tomu, že sa tá istá vec chráni na viacerých miestach naraz, sa hovorí **obrana do hĺbky** (defense in depth). Zmyslom je, aby jedna chyba neznamenala hneď prielom.

Že oprava funguje, sa overilo priamym útokom na RPC funkciu mimo stránky. Databáza odmietla všetky štyri pokusy (XSS v ceste, výstup z priečinka cez `../`, cesta do cudzieho eventu, prípona `.html`) a prijala len legitímnu cestu. Bonusom je, že sprísnenie zablokovalo aj `../`, čo pôvodná kontrola tiež púšťala.

**2. Podľa čoho sa dá objektívne povedať, že je fotka na stránke rozmazaná?**

Nie od oka, ale porovnaním dvoch čísel: koľko pixelov obrázok naozaj má (`naturalWidth` × `naturalHeight`) oproti tomu, na akú plochu ho prehliadač vykresľuje. Pomer týchto hodnôt hovorí, koľkokrát sa obrázok naťahuje. Ak je väčší ako 1, prehliadač dopĺňa pixely, ktoré v súbore nie sú — a to je presne to, čo oko vníma ako rozmazanie.

Pri `object-fit: cover` sa počíta ten **väčší** z pomerov (šírka aj výška), lebo obrázok musí plochu úplne pokryť; prebytok sa oreže.

Namerané hodnoty pred opravou:

| Fotka | Rozlíšenie | Vykresľuje sa na | Naťahuje sa |
|---|---|---|---|
| `hostia-konfety-lg.webp` (brána hostí) | 900 × 720 | 1425 × 900 | 1,58× |
| `auth-prihlasenie-lg.webp` (login) | 900 × 601 | 612 × 900 | 1,50× |
| `auth-registracia-lg.webp` (registrácia) | 900 × 600 | 612 × 900 | 1,50× |
| `auth-heslo-lg.webp` (nastavenie hesla) | 900 × 1350 | 612 × 900 | 0,68× ✓ |

Príčina pri prihlásení a registrácii nebola veľkosť, ale **orientácia**. Bočný panel je na výšku (612 × 900), ale fotky boli na šírku. Aby fotka na šírku pokryla vysoký úzky panel, musí sa zväčšiť podľa výšky a väčšina šírky sa oreže — z fotky tak reálne vidno len úzky stredový pruh, a ten ešte roztiahnutý. Že ide o orientáciu a nie o rozlíšenie, dokazuje posledný riadok: `auth-heslo-lg.webp` má rovnakú šírku 900 px, ale je na výšku — a naťahuje sa 0,68×, čiže sa naopak zmenšuje a je ostrý.

Opravené výmenou za fotky so správnou orientáciou a rozlíšením (1100 × 1650 pre panely, 1800 × 1350 pre bránu). Všetky tri sú teraz pod 1× — brána 0,79×, panely 0,56×. Zaujímavosť: fotka brány má teraz dvojnásobné rozlíšenie a napriek tomu je súbor menší než pôvodný (153 kB oproti 227 kB), lebo bola nanovo zakódovaná do WebP s primeranou kompresiou.

Nové fotky sú z Pexels (Pexels License — voľné aj na komerčné použitie, bez povinnosti uvádzať autora), pôvodné boli z Unsplash. Obe licencie to dovoľujú; pri obhajobe je dobré vedieť, že fotky nie sú stiahnuté odkiaľkoľvek z internetu.

**3. Prečo sa hláška „Zatiaľ tu nie sú žiadne fotky" čítala odzadu?**

Galéria je poskladaná pomocou CSS stĺpcov (`column-count: 2`) — to je ten spôsob, akým vzniká nástenkový (masonry) vzhľad. Lenže do stĺpcov sa rozdelí *všetko*, čo je vnútri, vrátane obyčajného odstavca s hláškou o prázdnej galérii. Veta sa preto rozsekla medzi dva stĺpce a na obrazovke vyšlo „fotky. Buď prvý!" nad „Zatiaľ tu nie sú žiadne".

Riešenie je jedna vlastnosť: `column-span: all`, ktorá prvku povie, nech sa roztiahne cez všetky stĺpce a do delenia nevstupuje.

**4. Supabase advisor hlási 12 funkcií ako verejne spustiteľné. Prečo sa väčšina z nich nechala tak?**

Najprv, prečo hlási aj `handle_new_user()`, ktorú sme kedysi výslovne zakazovali. Migrácia `20260831182158` obsahovala:

```sql
revoke all on function public.handle_new_user() from anon, authenticated;
```

Vyzerá to správne, ale nefunguje to. V PostgreSQL majú funkcie po vytvorení automaticky pridelené právo `EXECUTE` pre **PUBLIC**, čo je zástupný názov pre „úplne každý". Role `anon` a `authenticated` sú súčasťou PUBLIC, takže im odobratie ich vlastného práva nepomôže — zdedia ho ďalej cez PUBLIC. Vidno to priamo vo výpise práv (`proacl`), kde je záznam `=X/postgres`: prázdno pred `=` znamená práve PUBLIC. Správne by muselo byť `revoke ... from public`. Pre porovnanie, funkcia `find_event_by_password` to má spravené správne a v jej právach žiadne `=X` nie je.

Napriek tomu sa to nechalo bez zmeny a je to vedomé rozhodnutie:

- `handle_new_user()` je **triggerová** funkcia. PostgreSQL odmietne zavolať triggerovú funkciu ako bežnú funkciu, takže cez REST API sa spustiť nedá bez ohľadu na práva. Riziko je nulové.
- `can_manage_event()` a `is_majitel()` sa **musia** dať volať, lebo ich používajú samotné RLS politiky. Výrazy v RLS politikách sa vyhodnocujú s právami prihláseného používateľa, takže keby sme im právo `EXECUTE` odobrali, každý dopyt na chránené tabuľky by skončil chybou „permission denied for function" — a appka by prestala fungovať úplne. Ich návratová hodnota je pritom len `true`/`false` o volajúcom samom, čiže žiadny únik údajov.
- Ostatné (`guest_*`, `request_event`, `set_event_status`…) sú funkcie, ktoré appka volá zámerne a ktoré si vnútri samy overujú heslo alebo rolu. Byť verejne volateľné je ich účel.

**Poučenie na obhajobu:** automatický kontrolór (linter) hlási vzory, nie skutočné diery. Pri každom hlásení treba vedieť odpovedať, či ide o reálne riziko alebo o zámer — a to zdôvodniť. Slepé „opravenie" hlásení pri `can_manage_event` by tento projekt rozbilo.
