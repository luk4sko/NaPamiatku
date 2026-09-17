// Spoločné funkcie pre všetky stránky NaPamiatku.
// Načítava sa až po js/supabaseClient.js.

/* ---------- Svetlý / tmavý režim ---------- */

// Režim si pamätáme v localStorage, aby zostal aj po zatvorení prehliadača.
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("napamiatku-theme", theme);
}

function initTheme() {
  // Tmavý režim je značkový a predvolený. Svetlý si používateľ zapne sám
  // a jeho voľba potom zostáva uložená.
  applyTheme(localStorage.getItem("napamiatku-theme") || "dark");
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
  updateThemeButtons();
}

// Ikonky sú tenké obrysové SVG (stroke), nie emoji - emoji vykresľuje každý
// systém inak a v tlačidle pôsobí ako cudzí prvok. currentColor znamená, že
// sa ikona farbí podľa textu tlačidla, takže funguje v oboch režimoch.
const SUN_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/>' +
  '<path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4 17 7M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4"/></svg>';

const MOON_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M20.5 14.3A8.6 8.6 0 0 1 9.7 3.5a8.6 8.6 0 1 0 10.8 10.8Z"/></svg>';

function updateThemeButtons() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    // Tlačidlo ponúka opak aktuálneho stavu: v tmavom režime slniečko.
    button.innerHTML = isDark ? SUN_ICON : MOON_ICON;
    button.title = isDark ? "Prepnúť na svetlý režim" : "Prepnúť na tmavý režim";
  });
}

/* ---------- Ikonka očka pri heslách ---------- */

// Vlastné SVG namiesto emoji 👁 / 🙈 - emoji sa na niektorých systémoch
// vykresľujú nespoľahlivo (iný font, chýbajúci glyf) a "opica zakrývajúca oči"
// navyše vizuálne nezodpovedá tomu, čo má znamenať (heslo je/nie je viditeľné).
// Obe SVG sú v DOM stále, prepína sa len trieda "hidden" - bez animácie.
const EYE_OPEN_SVG = `
  <svg class="eye-icon eye-open" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>`;
const EYE_CLOSED_SVG = `
  <svg class="eye-icon eye-closed hidden" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
    <circle cx="12" cy="12" r="3" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </svg>`;

// Ku každému <input type="password"> vnútri .password-field pridá tlačidlo,
// ktoré prepína medzi type="password" a type="text".
function setupPasswordToggles() {
  document.querySelectorAll(".password-field").forEach((wrapper) => {
    const input = wrapper.querySelector("input");
    if (!input || wrapper.querySelector(".password-toggle")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "password-toggle";
    button.innerHTML = EYE_OPEN_SVG + EYE_CLOSED_SVG;
    button.title = "Zobraziť heslo";

    button.addEventListener("click", () => {
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      // Viditeľné heslo = preškrtnuté oko, skryté heslo = obyčajné oko.
      button.querySelector(".eye-open").classList.toggle("hidden", isHidden);
      button.querySelector(".eye-closed").classList.toggle("hidden", !isHidden);
      button.title = isHidden ? "Skryť heslo" : "Zobraziť heslo";
    });

    wrapper.appendChild(button);
  });
}

/* ---------- Prihlásenie a role ---------- */

// Vráti session, alebo presmeruje na login, ak používateľ nie je prihlásený.
async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "/login";
    return null;
  }
  return session;
}

// Načíta profil (hlavne rolu) prihláseného používateľa.
async function loadProfile(userId) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", userId)
    .maybeSingle();

  if (error) return null;
  return data;
}

// Iniciály do kruhového avatara v lište: "Lukáš Brtko" -> "LB",
// pri chýbajúcom mene prvé písmeno e-mailu.
function initials(name, email) {
  const source = (name || "").trim() || (email || "").split("@")[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

// Vypíše do hlavičky, kto je práve prihlásený. Session aj profil berie ako
// parametre - stránka ich už má načítané, takže sa profil nedopytuje druhýkrát.
// V lište je len avatar s iniciálami; meno, e-mail a rola sú v rozbaľovacom menu.
function renderIdentity(session, profile) {
  const roleLabel = profile && profile.role === "majitel" ? "Majiteľ" : "Klient";
  const fullName = profile && profile.full_name;

  document.querySelectorAll("[data-identity]").forEach((slot) => {
    const set = (selector, text) => {
      const el = slot.querySelector(selector);
      if (el) el.textContent = text;
    };
    set("[data-identity-avatar]", initials(fullName, session.user.email));
    set("[data-identity-name]", fullName || session.user.email.split("@")[0]);
    set("[data-identity-email]", session.user.email);
    set("[data-identity-role]", roleLabel);
    // Skryté zostáva dovtedy, kým údaje nemáme - inak by v lište blikol
    // prázdny odznak ešte pred odpoveďou zo servera.
    slot.hidden = false;
  });
}

// Rozbaľovacie menu pod avatarom: klik naň otvorí, klik mimo alebo Escape zavrie.
function setupIdentityMenus() {
  document.querySelectorAll("[data-identity]").forEach((slot) => {
    const toggle = slot.querySelector("[data-identity-toggle]");
    if (!toggle) return;
    const setOpen = (open) => {
      slot.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(!slot.classList.contains("open"));
    });
    document.addEventListener("click", (event) => {
      if (!slot.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });
  });
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "/login";
}

function setupLogoutButtons() {
  document.querySelectorAll("[data-logout]").forEach((button) => {
    button.addEventListener("click", logout);
  });
}

/* ---------- Pomocné funkcie ---------- */

// Ochrana proti XSS: text od hostí nikdy nevkladáme priamo do innerHTML.
// Bez tohto by hosť mohol do prezývky napísať <script> a spustiť si kód
// v prehliadači ostatných návštevníkov.
function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showMessage(element, text, type) {
  element.textContent = text;
  element.className = "message" + (type ? " " + type : "");
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("sk-SK");
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("sk-SK", {
    day: "numeric", month: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// "17. septembra 2026" - do nadpisov, kde je miesto a číselný zápis pôsobí úradne.
function formatDateLong(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("sk-SK", { day: "numeric", month: "long", year: "numeric" });
}

// Slovenčina má tri tvary množného čísla: 1 deň, 2-4 dni, 5+ dní.
function plural(count, one, few, many) {
  if (count === 1) return one;
  if (count >= 2 && count <= 4) return few;
  return many;
}

// Dátum eventu ako ľudská veta: "o 12 dní", "zajtra", "pred 3 týždňami".
// Presný dátum ukazujeme vedľa; toto je len rýchla orientácia.
function relativeDate(value) {
  if (!value) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  const days = Math.round((date - today) / 86400000);

  if (days === 0) return "dnes";
  if (days === 1) return "zajtra";
  if (days === -1) return "včera";

  const abs = Math.abs(days);
  const future = days > 0;
  let count, unit;
  if (abs < 14) {
    count = abs;
    unit = future ? plural(count, "deň", "dni", "dní") : plural(count, "dňom", "dňami", "dňami");
  } else if (abs < 60) {
    count = Math.round(abs / 7);
    unit = future ? plural(count, "týždeň", "týždne", "týždňov") : plural(count, "týždňom", "týždňami", "týždňami");
  } else if (abs < 365) {
    count = Math.round(abs / 30);
    unit = future ? plural(count, "mesiac", "mesiace", "mesiacov") : plural(count, "mesiacom", "mesiacmi", "mesiacmi");
  } else {
    count = Math.round(abs / 365);
    unit = future ? plural(count, "rok", "roky", "rokov") : plural(count, "rokom", "rokmi", "rokmi");
  }
  return (future ? "o " : "pred ") + count + " " + unit;
}

// Verejná adresa súboru v Supabase Storage.
function publicUrl(bucket, path) {
  if (!path) return "";
  return supabaseClient.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/* ---------- Práca s obrázkami ---------- */

// Zmenší veľké fotky pred nahraním. Fotka z mobilu má bežne 4-8 MB;
// po zmenšení na max 2400 px má okolo 0,5 MB, čo šetrí dáta hosťom
// aj miesto v úložisku. Menšie fotky necháme tak, ako sú, aby sme
// zbytočne nezhoršovali kvalitu.
async function compressImage(file) {
  const MAX_SIZE = 2400;
  const SKIP_UNDER_BYTES = 1.5 * 1024 * 1024;

  if (file.size < SKIP_UNDER_BYTES) return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIZE / Math.max(bitmap.width, bitmap.height));

  if (scale === 1 && file.size < 4 * 1024 * 1024) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85)
  );

  // Ak by zmenšenie nepomohlo, radšej necháme originál.
  return blob && blob.size < file.size ? blob : file;
}

// Príponu berieme z názvu súboru, ktorý si zvolil používateľ - a tomu sa
// veriť nedá. Namiesto vyhadzovania podozrivých znakov povolíme len prípony,
// ktoré naozaj podporujeme (rovnaké formáty ako pripúšťa bucket "photos");
// čokoľvek iné dostane mp4. Tento prístup sa volá whitelist a je bezpečnejší
// ako blacklist - nemusíme dopredu uhádnuť všetko, čo by mohlo uškodiť.
const ALLOWED_VIDEO_EXTENSIONS = ["mp4", "mov", "webm"];

function videoExtension(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  return ALLOWED_VIDEO_EXTENSIONS.includes(extension) ? extension : "mp4";
}

// Stiahnutie fotky. Atribút download na odkaze na cudziu doménu prehliadač
// ignoruje, preto si súbor najprv stiahneme ako blob a až ten uložíme.
async function downloadFile(url, filename) {
  const response = await fetch(url);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function copyToClipboard(text, messageElement) {
  navigator.clipboard.writeText(text).then(() => {
    if (messageElement) {
      showMessage(messageElement, "Skopírované!", "ok");
      setTimeout(() => showMessage(messageElement, ""), 2000);
    }
  });
}

/* ---------- Lightbox (fotka na celú obrazovku, s prepínaním a priblížením) ---------- */

// Prvok sa vytvorí len raz a znova sa použije pre každú ďalšiu otvorenú fotku.
let lightboxEl = null;
// Fotky z aktuálne otvorenej galérie a index tej, čo sa práve zobrazuje -
// vďaka tomu vieme prepínať šípkami/swipom bez opätovného čítania z DOM.
let lightboxItems = [];
let lightboxIndex = 0;
// Priblíženie fotky: mierka (1 = normálne, do 4 = najviac) a posun stredu v px.
let zoomScale = 1;
let panX = 0;
let panY = 0;
// Nastaví sa v setupLightboxZoom(); volá ju showLightboxPhoto() pri každom prepnutí fotky.
let resetLightboxZoom = () => {};

function ensureLightbox() {
  if (lightboxEl) return lightboxEl;

  lightboxEl = document.createElement("div");
  lightboxEl.className = "lightbox hidden";
  lightboxEl.innerHTML = `
    <button type="button" class="lightbox-close" aria-label="Zavrieť">✕</button>
    <button type="button" class="lightbox-arrow lightbox-prev hidden" aria-label="Predchádzajúca fotka">‹</button>
    <img />
    <button type="button" class="lightbox-arrow lightbox-next hidden" aria-label="Ďalšia fotka">›</button>
  `;
  document.body.appendChild(lightboxEl);
  const img = lightboxEl.querySelector("img");

  const close = () => lightboxEl.classList.add("hidden");
  lightboxEl.querySelector(".lightbox-close").addEventListener("click", close);
  lightboxEl.querySelector(".lightbox-prev").addEventListener("click", showPrevPhoto);
  lightboxEl.querySelector(".lightbox-next").addEventListener("click", showNextPhoto);

  // Klik na tmavé pozadie mimo fotky a šípok tiež zatvorí.
  lightboxEl.addEventListener("click", (event) => {
    if (event.target === lightboxEl) close();
  });

  document.addEventListener("keydown", (event) => {
    if (lightboxEl.classList.contains("hidden")) return;
    if (event.key === "Escape") close();
    if (event.key === "ArrowLeft") showPrevPhoto();
    if (event.key === "ArrowRight") showNextPhoto();
  });

  setupLightboxZoom(lightboxEl, img);

  return lightboxEl;
}

// Priblíženie a posúvanie fotky: na počítači koliesko myši a dvojklik,
// na mobile stiahnutie/roztiahnutie dvoma prstami (pinch). Priblíženie je
// vždy voči stredu fotky - nesleduje presne, kam si klikol/stiahol prsty,
// čo by vyžadovalo prepočet oproti prirodzeným rozmerom obrázka. Kým je
// fotka priblížená, jeden prst/ťahanie myšou ju posúva namiesto toho,
// aby prepínal na ďalšiu fotku.
function setupLightboxZoom(lightbox, img) {
  const MIN_SCALE = 1;
  const MAX_SCALE = 4;

  function applyTransform() {
    img.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
    img.classList.toggle("zoomed", zoomScale > MIN_SCALE);
  }

  function setZoom(scale) {
    zoomScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    if (zoomScale === MIN_SCALE) { panX = 0; panY = 0; }
    applyTransform();
  }
  resetLightboxZoom = () => setZoom(MIN_SCALE);

  lightbox.addEventListener("wheel", (event) => {
    event.preventDefault();
    setZoom(zoomScale * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });

  img.addEventListener("dblclick", () => setZoom(zoomScale > MIN_SCALE ? MIN_SCALE : 2.5));

  // Ťahanie myšou, len keď je fotka priblížená (inak by to prekážalo klikaniu).
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

  img.addEventListener("mousedown", (event) => {
    if (zoomScale <= MIN_SCALE) return;
    isDragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    panStartX = panX;
    panStartY = panY;
    event.preventDefault();
  });
  window.addEventListener("mousemove", (event) => {
    if (!isDragging) return;
    panX = panStartX + (event.clientX - dragStartX);
    panY = panStartY + (event.clientY - dragStartY);
    applyTransform();
  });
  window.addEventListener("mouseup", () => { isDragging = false; });

  // Dotyk: jeden prst mimo priblíženia = swipe medzi fotkami (nižšie),
  // jeden prst v priblížení = posúvanie, dva prsty = pinch-zoom.
  let touchStartX = 0, touchStartY = 0;
  let pinchStartDistance = 0, pinchStartScale = 1;

  function touchDistance(touches) {
    return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  }

  lightbox.addEventListener("touchstart", (event) => {
    if (event.touches.length === 2) {
      pinchStartDistance = touchDistance(event.touches);
      pinchStartScale = zoomScale;
    } else if (event.touches.length === 1) {
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
      panStartX = panX;
      panStartY = panY;
    }
  });

  lightbox.addEventListener("touchmove", (event) => {
    if (event.touches.length === 2) {
      event.preventDefault();
      setZoom(pinchStartScale * (touchDistance(event.touches) / pinchStartDistance));
    } else if (event.touches.length === 1 && zoomScale > MIN_SCALE) {
      event.preventDefault();
      panX = panStartX + (event.touches[0].clientX - touchStartX);
      panY = panStartY + (event.touches[0].clientY - touchStartY);
      applyTransform();
    }
  }, { passive: false });

  // Swipe na mobile: prst doľava = ďalšia fotka, doprava = predchádzajúca.
  // Zvislý pohyb (scroll) aj koniec pinchu (ešte drží druhý prst) ignorujeme.
  lightbox.addEventListener("touchend", (event) => {
    if (zoomScale > MIN_SCALE || event.touches.length > 0) return;
    const deltaX = event.changedTouches[0].clientX - touchStartX;
    const deltaY = event.changedTouches[0].clientY - touchStartY;
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    if (deltaX < 0) showNextPhoto(); else showPrevPhoto();
  });
}

function showLightboxPhoto() {
  const item = lightboxItems[lightboxIndex];
  const img = lightboxEl.querySelector("img");
  img.src = item.url;
  img.alt = item.alt || "";
  resetLightboxZoom();

  // Šípky nemá zmysel ukazovať, keď je v galérii len jedna fotka.
  const showArrows = lightboxItems.length > 1;
  lightboxEl.querySelectorAll(".lightbox-arrow").forEach((button) => {
    button.classList.toggle("hidden", !showArrows);
  });
}

function showPrevPhoto() {
  lightboxIndex = (lightboxIndex - 1 + lightboxItems.length) % lightboxItems.length;
  showLightboxPhoto();
}

function showNextPhoto() {
  lightboxIndex = (lightboxIndex + 1) % lightboxItems.length;
  showLightboxPhoto();
}

function openLightbox(items, index) {
  const lightbox = ensureLightbox();
  lightboxItems = items;
  lightboxIndex = index;
  showLightboxPhoto();
  lightbox.classList.remove("hidden");
}

// Klik na ktorúkoľvek fotku v galérii ju otvorí na celú obrazovku aj so
// zvyškom galérie, aby sa dalo medzi fotkami prepínať. Volá sa vždy po
// prekreslení galérie, keďže staré <img> uzly zmiznú s ňou.
function setupGalleryLightbox(gallery) {
  const images = Array.from(gallery.querySelectorAll(".photo > img"));
  const items = images.map((img) => ({ url: img.src, alt: img.alt }));

  images.forEach((img, index) => {
    img.addEventListener("click", () => openLightbox(items, index));
  });
}

/* ---------- Ikony ---------- */

// Jedna sada tenkých obrysových ikon pre celú appku (rovnaký štýl ako na
// úvodnej stránke). Kreslia sa cez currentColor, takže farbu preberajú z
// textu okolo - fungujú v tmavom aj svetlom režime a v tlačidlách.
const ICONS = {
  camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3a1.8 1.8 0 0 1 1.8 1.8v8.4A1.8 1.8 0 0 1 20 20H4a1.8 1.8 0 0 1-1.8-1.8V9.8A1.8 1.8 0 0 1 4 8Z"/><circle cx="12" cy="14" r="3.3"/>',
  chat: '<path d="M20.5 12.6c0 3.9-3.8 7-8.5 7-1 0-2-.15-2.9-.42l-5 1.42 1.5-4.1c-1.2-1.2-2.1-2.5-2.1-3.9 0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7Z"/>',
  gift: '<rect x="3.2" y="9.2" width="17.6" height="3.8" rx="1.1"/><path d="M4.9 13v6a1.8 1.8 0 0 0 1.8 1.8h10.6A1.8 1.8 0 0 0 19.1 19v-6M12 9.2v11.6"/><path d="M12 9.2S10.9 3.6 8.3 3.6a2.6 2.6 0 0 0 0 5.6M12 9.2s1.1-5.6 3.7-5.6a2.6 2.6 0 0 1 0 5.6"/>',
  download: '<path d="M12 3.6v11.2M7.8 10.6 12 14.8l4.2-4.2M4.2 16.8v1.9a1.8 1.8 0 0 0 1.8 1.8h12a1.8 1.8 0 0 0 1.8-1.8v-1.9"/>',
  upload: '<path d="M12 15.6V4.4M7.8 8.6 12 4.4l4.2 4.2M4.2 16.8v1.9a1.8 1.8 0 0 0 1.8 1.8h12a1.8 1.8 0 0 0 1.8-1.8v-1.9"/>',
  lock: '<rect x="4.6" y="10.4" width="14.8" height="10.2" rx="2.3"/><path d="M8.2 10.4V7.7a3.8 3.8 0 0 1 7.6 0v2.7"/>',
  key: '<circle cx="8" cy="14.5" r="3.8"/><path d="m10.8 11.7 8.7-8.7M17 5l2.5 2.5M14.5 7.5 17 10"/>',
  qr: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/><path d="M13.5 13.5h3v3h-3zM20.5 13.5v3M16.5 20.5h4M20.5 18.5v2"/>',
  settings: '<path d="M4 7h9M18 7h2M4 17h4M13 17h7"/><circle cx="15.5" cy="7" r="2.3"/><circle cx="10.5" cy="17" r="2.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.8 12.2a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v6M14 11v6"/>',
  print: '<path d="M7 8V3.5h10V8M7 17H4.5A1.5 1.5 0 0 1 3 15.5v-5A1.5 1.5 0 0 1 4.5 9h15a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17"/><rect x="7" y="14" width="10" height="6.5" rx="1"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c0-3.6 2.8-6 6.2-6s6.2 2.4 6.2 6"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6.2M21.2 20c0-3-1.9-5.2-4.6-5.8"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>',
  video: '<rect x="3" y="6.5" width="13" height="11" rx="2"/><path d="m16 10 5-2.5v9L16 14"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.6"/><path d="m20.5 15.5-4.5-4.5-7 7M3.5 18l4-4 3 3"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  logout: '<path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10M15 16l4-4-4-4M19 12H9"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/>',
  inbox: '<path d="M3.5 13.5 6 5.5h12l2.5 8v4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-4Z"/><path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/>',
  sparkles: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.2l-1.8-5.6L4.5 10.8 10.2 9Z"/><path d="M19 3v3M17.5 4.5h3M5 17v3M3.5 18.5h3"/>',
  select: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12.5 2.8 2.8L16.5 9"/>',
  pencil: '<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13 7 4 4"/>',
  heart: '<path d="M12 20.5s-8-4.9-8-11A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8 2.5c0 6.1-8 11-8 11Z"/>',
  hourglass: '<path d="M7 3.5h10M7 20.5h10M8 3.5v3.2c0 1.5.7 2.9 1.9 3.8L12 12l-2.1 1.5A4.7 4.7 0 0 0 8 17.3v3.2M16 3.5v3.2c0 1.5-.7 2.9-1.9 3.8L12 12l2.1 1.5a4.7 4.7 0 0 1 1.9 3.8v3.2"/>',
  zip: '<path d="M6 3.5h8l4.5 4.5v11A1.5 1.5 0 0 1 17 20.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M14 3.5V8h4.5M10 7h2M10 10h2M10 13h2M10 16h2"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4 17 7M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4"/>',
  moon: '<path d="M20.5 14.3A8.6 8.6 0 0 1 9.7 3.5a8.6 8.6 0 1 0 10.8 10.8Z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  sort: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  flag: '<path d="M5 21V4M5 4h11l-1.5 3.5L16 11H5"/>',
};

function icon(name, className) {
  return '<svg class="ui-icon' + (className ? " " + className : "") + '" viewBox="0 0 24 24" aria-hidden="true">' +
    (ICONS[name] || "") + "</svg>";
}

// Doplní ikony do prvkov s data-icon="názov" - v HTML tak stačí napísať
// <span data-icon="camera"></span> a nemusí sa tam kopírovať celé SVG.
function hydrateIcons(root) {
  // Zástupný <span> sa nahradí priamo <svg>, aby bola ikona priamym
  // potomkom tlačidla - na tom stojí pravidlo button:has(> .ui-icon).
  (root || document).querySelectorAll("[data-icon]").forEach((el) => {
    el.outerHTML = icon(el.dataset.icon);
  });
}

/* ---------- Toasty (krátke oznámenia vpravo dole) ---------- */

// Náhrada za alert(): lístok, ktorý sa objaví, chvíľu visí a sám zmizne.
// Neblokuje stránku a nevyzerá ako chybové okno systému.
function showToast(text, type) {
  let host = document.querySelector(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  const toast = document.createElement("div");
  toast.className = "toast" + (type ? " " + type : "");
  toast.setAttribute("role", "status");
  toast.innerHTML = icon(type === "error" ? "alert" : type === "ok" ? "check" : "info") + "<span></span>";
  toast.querySelector("span").textContent = text;
  host.appendChild(toast);

  // Trieda "in" sa pridáva až v ďalšom snímku, aby prebehol prechod (fade-in).
  requestAnimationFrame(() => toast.classList.add("in"));
  setTimeout(() => {
    toast.classList.remove("in");
    setTimeout(() => toast.remove(), 400);
  }, type === "error" ? 5000 : 3200);
}

/* ---------- Potvrdzovací dialóg ---------- */

// Náhrada za confirm(): <dialog> v štýle stránky. Vracia Promise<boolean>,
// takže sa používa ako `if (!(await confirmDialog({...}))) return;`.
function confirmDialog({ title, text, confirmLabel, cancelLabel, danger }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog";
    dialog.innerHTML = `
      <form method="dialog" class="dialog-body">
        <div class="dialog-icon ${danger ? "danger" : ""}">${icon(danger ? "trash" : "info")}</div>
        <h3></h3>
        <p class="muted"></p>
        <div class="dialog-actions">
          <button type="submit" class="secondary" value="cancel"></button>
          <button type="submit" class="${danger ? "danger-solid" : ""}" value="ok"></button>
        </div>
      </form>`;
    dialog.querySelector("h3").textContent = title;
    dialog.querySelector("p").textContent = text || "";
    dialog.querySelector('[value="cancel"]').textContent = cancelLabel || "Zrušiť";
    dialog.querySelector('[value="ok"]').textContent = confirmLabel || "Potvrdiť";

    // Klik na tmavé pozadie mimo okna = zrušiť.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close("cancel");
    });
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "ok");
      dialog.remove();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

// Bežný <dialog> v HTML (napr. formulár na nový event): zavrie sa klikom
// mimo okna alebo tlačidlom [data-dialog-close].
function setupDialog(dialog) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.querySelectorAll("[data-dialog-close]").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });
}

/* ---------- Prázdne stavy a načítavanie ---------- */

// Namiesto holého "Zatiaľ nič." - ikona v krúžku, nadpis, veta a prípadne tlačidlo.
function emptyState({ iconName, title, text, action }) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">${icon(iconName || "sparkles")}</div>
      <h3>${escapeHtml(title)}</h3>
      ${text ? "<p>" + escapeHtml(text) + "</p>" : ""}
      ${action || ""}
    </div>`;
}

// Sivé "kostry" kariet, kým sa načítavajú dáta - stránka neposkakuje a
// používateľ vidí, že sa niečo deje.
function skeletonCards(count, className) {
  return Array.from({ length: count || 3 }, () =>
    `<div class="skeleton-card ${className || ""}"><div class="skeleton skeleton-block"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div>`
  ).join("");
}

/* ---------- Záložky ---------- */

// Tlačidlá .tab[data-tab] prepínajú panely [data-panel]. Aktívna záložka sa
// zapíše do URL (#fotky), takže po obnovení stránky ostane otvorená tá istá.
function setupTabs(root) {
  const scope = root || document;
  const tabs = Array.from(scope.querySelectorAll(".tab[data-tab]"));
  const panels = Array.from(scope.querySelectorAll("[data-panel]"));
  if (tabs.length === 0) return;

  function activate(name, updateHash) {
    tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
    panels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== name));
    if (updateHash) history.replaceState(null, "", "#" + name);
    scope.dispatchEvent(new CustomEvent("tabchange", { detail: name }));
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => activate(tab.dataset.tab, true)));

  const fromHash = location.hash.slice(1);
  const initial = tabs.find((tab) => tab.dataset.tab === fromHash && !tab.classList.contains("hidden"));
  activate(initial ? initial.dataset.tab : tabs[0].dataset.tab, false);
  return activate;
}

/* ---------- Dávkové vykresľovanie dlhých zoznamov ---------- */

// Pod zoznam pridá "Zobraziť ďalšie (zvyšok)" a zároveň sleduje, či sa
// tlačidlo dostalo do výrezu okna - vtedy načíta ďalšiu dávku samo.
// Používateľ tak scrolluje plynulo, ale stránka nikdy nevykreslí všetko naraz.
function renderLoadMore(container, total, onMore) {
  const shown = container.querySelectorAll(".photo, .event-card").length;
  if (shown >= total) return;
  const remaining = total - shown;
  // V <ul> musí byť <li>, inde stačí <div>.
  const wrap = document.createElement(container.tagName === "UL" ? "li" : "div");
  wrap.className = "load-more";
  wrap.innerHTML = `<button type="button" class="secondary">${icon("download")}Zobraziť ďalšie (${remaining})</button>`;
  wrap.querySelector("button").addEventListener("click", onMore);
  container.appendChild(wrap);

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        onMore();
      }
    }, { rootMargin: "400px" });
    observer.observe(wrap);
  }
}

/* ---------- Drag & drop pre nahrávanie ---------- */

// Súbory sa dajú do zóny pretiahnuť myšou alebo vybrať cez skrytý <input>.
// Obe cesty končia v tej istej funkcii onFiles(files).
function setupDropzone(zone, input, onFiles) {
  const accept = (file) => file.type.startsWith("image/") || file.type.startsWith("video/");

  ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, (event) => {
    event.preventDefault();
    zone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach((name) => zone.addEventListener(name, (event) => {
    event.preventDefault();
    zone.classList.remove("dragover");
  }));
  zone.addEventListener("drop", (event) => {
    const files = Array.from(event.dataTransfer.files).filter(accept);
    if (files.length) onFiles(files);
  });
  input.addEventListener("change", () => {
    const files = Array.from(input.files).filter(accept);
    // Vyprázdnenie umožní vybrať tie isté súbory znova - prehliadač inak
    // pre rovnaký výber "change" nespustí.
    input.value = "";
    if (files.length) onFiles(files);
  });
}

// Zoznam nahrávaných súborov s vlastným stavom pre každý z nich.
// Vracia objekt, cez ktorý upload hlási pokrok: start(i), done(i), fail(i, msg).
function createUploadList(container, files) {
  container.innerHTML = files.map((file, index) => `
    <li class="upload-item" data-index="${index}">
      <span class="upload-thumb">${file.type.startsWith("video/") ? icon("video") : ""}</span>
      <span class="upload-name">${escapeHtml(file.name)}</span>
      <span class="upload-state">${icon("clock")}</span>
    </li>`).join("");
  container.classList.remove("hidden");

  // Náhľady fotiek cez objectURL - nečítame celý súbor do pamäte ako base64.
  files.forEach((file, index) => {
    if (!file.type.startsWith("image/")) return;
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);
    container.querySelector(`[data-index="${index}"] .upload-thumb`).appendChild(img);
  });

  const item = (index) => container.querySelector(`[data-index="${index}"]`);
  return {
    start(index) {
      item(index).classList.add("uploading");
      item(index).querySelector(".upload-state").innerHTML = '<span class="spinner"></span>';
    },
    done(index) {
      item(index).classList.remove("uploading");
      item(index).classList.add("done");
      item(index).querySelector(".upload-state").innerHTML = icon("check");
    },
    fail(index, message) {
      item(index).classList.remove("uploading");
      item(index).classList.add("failed");
      item(index).querySelector(".upload-state").innerHTML = icon("x");
      item(index).title = message || "";
    },
    finish(delay) {
      setTimeout(() => { container.classList.add("hidden"); container.innerHTML = ""; }, delay || 2500);
    },
  };
}

/* ---------- Hromadné stiahnutie (ZIP) ---------- */

// JSZip sa načíta až pri prvom použití - väčšina návštev ZIP nikdy nespraví.
let zipLibraryPromise = null;
function loadZipLibrary() {
  if (!zipLibraryPromise) {
    zipLibraryPromise = import("https://esm.sh/jszip@3.10.1").then((m) => m.default);
  }
  return zipLibraryPromise;
}

// items: [{ url, filename }]. Súbory sa sťahujú po jednom a balia v prehliadači;
// onProgress(done, total) hlási pokrok, aby sa dalo ukázať "12 z 40".
async function downloadAsZip(items, zipName, onProgress) {
  const JSZip = await loadZipLibrary();
  const zip = new JSZip();
  let done = 0;
  for (const item of items) {
    const response = await fetch(item.url);
    zip.file(item.filename, await response.blob());
    done += 1;
    if (onProgress) onProgress(done, items.length);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = zipName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

// Názov súboru bez diakritiky a medzier - do ZIPu a pre stiahnuté fotky.
function safeFilename(text) {
  return String(text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "")
    .toLowerCase() || "napamiatku";
}

/* ---------- QR kódy ---------- */

// Knižnice načítavame až keď sú naozaj treba (dynamický import).
let qrLibraryPromise = null;
function loadQrLibrary() {
  if (!qrLibraryPromise) {
    qrLibraryPromise = import("https://esm.sh/qrcode@1.5.4").then((m) => m.default);
  }
  return qrLibraryPromise;
}

async function makeQrDataUrl(text, size) {
  const QRCode = await loadQrLibrary();
  return QRCode.toDataURL(text, {
    width: size || 600,
    margin: 2,
    errorCorrectionLevel: "M",
  });
}

// Pay by Square - slovenský štandard pre platobné QR kódy.
// Ten istý formát, aký je na faktúrach; načíta ho aj appka Tatra banky.
let bySquarePromise = null;
function loadBySquare() {
  if (!bySquarePromise) {
    bySquarePromise = import("https://esm.sh/bysquare@2.9.0");
  }
  return bySquarePromise;
}

async function makePaymentQrDataUrl({ iban, amount, message, recipient }) {
  const bySquare = await loadBySquare();

  const payment = {
    type: 1, // 1 = jednorazová platba
    bankAccounts: [{ iban: iban.replace(/\s/g, "") }],
    currencyCode: "EUR",
  };
  if (amount > 0) payment.amount = amount;
  if (message) payment.paymentNote = message;
  if (recipient) payment.beneficiary = { name: recipient };

  const encoded = bySquare.encode({ payments: [payment] });
  return makeQrDataUrl(encoded, 500);
}

/* ---------- Spustenie na každej stránke ---------- */

initTheme();

document.addEventListener("DOMContentLoaded", () => {
  updateThemeButtons();
  setupPasswordToggles();
  setupLogoutButtons();
  setupIdentityMenus();
  hydrateIcons();
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", toggleTheme);
  });

  // Lišta po odscrollovaní stmavne a dostane tieň (rovnako ako na úvode).
  const siteNav = document.querySelector(".site-nav");
  if (siteNav) {
    const onScroll = () => siteNav.classList.toggle("scrolled", window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }
});
