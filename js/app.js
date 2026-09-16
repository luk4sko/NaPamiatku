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
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", toggleTheme);
  });
});
