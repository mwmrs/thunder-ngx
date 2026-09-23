import { loadSettings, originPattern, revokeOtherOrigins, saveSettings } from "../lib/settings.js";
import { testConnection } from "../lib/paperless.js";

const form = document.getElementById("settings");
const status = document.getElementById("status");

function show(text, kind = "") {
  status.textContent = text;
  status.className = kind;
}

function readForm() {
  return {
    paperlessUrl: form.paperlessUrl.value.trim().replace(/\/+$/, ""),
    apiToken: form.apiToken.value.trim(),
    waitForResult: form.waitForResult.checked,
  };
}

/**
 * Fragt den Zugriff auf die Paperless-Adresse an. Muss ohne vorheriges await
 * direkt im Klick-Handler laufen, sonst verweigert Thunderbird die Anfrage.
 */
function requestAccess(settings) {
  let pattern;
  try {
    pattern = originPattern(settings.paperlessUrl);
  } catch {
    return Promise.reject(new Error("Ungültige Paperless-URL"));
  }
  return messenger.permissions.request({ origins: [pattern] }).then((granted) => {
    if (!granted) throw new Error("Zugriff auf die Paperless-Adresse wurde nicht erlaubt.");
    return pattern;
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const settings = readForm();
  requestAccess(settings)
    .then(async (pattern) => {
      await saveSettings(settings);
      // Nur die aktuelle Paperless-Adresse freigegeben lassen.
      const removed = await revokeOtherOrigins(pattern);
      show(removed.length ? `Gespeichert. Nicht mehr benötigte Freigaben entfernt: ${removed.join(", ")}` : "Gespeichert.", "ok");
    })
    .catch((err) => show(err.message, "error"));
});

document.getElementById("test").addEventListener("click", () => {
  const settings = readForm();
  show("Teste …");
  requestAccess(settings)
    .then(() => testConnection(settings))
    .then(({ version }) => show(`Verbindung und Rechte in Ordnung (Paperless-ngx ${version}).`, "ok"))
    .catch((err) => show(err.message, "error"));
});

loadSettings().then((s) => {
  form.paperlessUrl.value = s.paperlessUrl;
  form.apiToken.value = s.apiToken;
  form.waitForResult.checked = s.waitForResult;
});
