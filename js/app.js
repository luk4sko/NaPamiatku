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

function updateThemeButtons() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.textContent = isDark ? "☀️" : "🌙";
    button.title = isDark ? "Prepnúť na svetlý režim" : "Prepnúť na tmavý režim";
  });
}

/* ---------- Ikonka očka pri heslách ---------- */

// Ku každému <input type="password"> vnútri .password-field pridá tlačidlo,
// ktoré prepína medzi type="password" a type="text".
function setupPasswordToggles() {
  document.querySelectorAll(".password-field").forEach((wrapper) => {
    const input = wrapper.querySelector("input");
    if (!input || wrapper.querySelector(".password-toggle")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "password-toggle";
    button.textContent = "👁";
    button.title = "Zobraziť heslo";

    button.addEventListener("click", () => {
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      button.textContent = isHidden ? "🙈" : "👁";
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
    window.location.href = "login.html";
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
  window.location.href = "login.html";
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
